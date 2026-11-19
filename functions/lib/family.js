/* The family portal's engine side: what a parent may see and do, and nothing else.
   A parent signs in on /family with Google or an e-mailed link; the engine verifies the token and matches the e-mail to
   the families it knows — the parent e-mail under players/<id>/private/contact (written by the enrollment engine, the
   Monday sync or the front desk) and the Stripe customers with that e-mail (every plan and purchase). Everything the page
   shows comes from here, through the admin SDK; the database rules never open a family's data to the browser.
   What a family gets: their players (group, coach, plan, days, status, what happens on the 1st), this month's attendance
   from the posted lists, their purchases, the reports the coaches marked as sent, the open invoices and a link to their
   Stripe account page — and a way to ask the front desk for a court, a private or anything else. */
'use strict';
const admin = require('firebase-admin');
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');
const ROSTER = require('./roster');
const NOTIFY = require('./notify');
const ADMIN = require('./admin');
const FEED = require('./feed');

if (!require('firebase-admin/app').getApps().length) require('firebase-admin/app').initializeApp();

const KEEP_REPORTS = 12;
const REQUEST_KINDS = { court: 'Court reservation', private: 'Private lesson', change: 'Plan change', message: 'Message',
  // the client home (Nov 17, 2026): a parent says a player cannot make a session, asks for a make-up day, or writes to the coach
  absence: 'Cannot make a session', makeup: 'Make-up day', coach: 'Message for the coach',
  admin: 'Registration and billing', invoice: 'Invoice' };

/* ── who is asking ── */
async function requireFamily(req, opts) {
  opts = opts || {};
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw S.err(401, 'signin', 'Sign in first.');
  let decoded;
  try { decoded = opts.verify ? await opts.verify(token) : await require('firebase-admin/auth').getAuth().verifyIdToken(token, true); } catch (e) { throw S.err(401, 'token', 'Your sign-in has expired — sign in again.'); }
  const email = String(decoded.email || '').trim().toLowerCase();
  if (!email) throw S.err(403, 'email', 'This sign-in has no e-mail address on it.');
  if (decoded.email_verified !== true) throw S.err(403, 'verified', 'Please use Google or the e-mailed link to sign in, so we know the address is yours.');
  return { uid: decoded.uid, email, name: decoded.name || '', provider: decoded.firebase && decoded.firebase.sign_in_provider || '' };
}

/* ── the family's players: by the parent e-mail on the roster (the cached roster feed — no index to maintain, a minute
   old at most, refreshed when it finds nobody), then by the Stripe customers with that e-mail ── */
async function findPlayers(db, stripe, email) {
  const ids = new Set();
  const customers = [];
  try {
    const same = (p) => String(p.parent.email || '').trim().toLowerCase() === email;
    let feed = await FEED.roster(db);
    if (!feed.players.some(same)) feed = await FEED.roster(db, { fresh: true });
    for (const p of feed.players) if (same(p)) ids.add(p.id);
  } catch (e) { /* the Stripe route below still finds enrolled families */ }
  /* Another parent the family added in its account (Nov 19, 2026): familyLogins/<e-mail> = { players: [...] }, written by the
     engine only. That e-mail signs in and sees the same players, and the bills kept under the family's main e-mail. */
  const billEmails = new Set([email]);
  try {
    const l = await db.doc('familyLogins/' + email).get(); const lp = l.exists ? ((l.data() || {}).players || []) : [];
    for (const id of lp) { ids.add(id); try { const c = await db.doc(`players/${id}/private/contact`).get(); const m = String((c.exists && (c.data() || {}).email) || '').trim().toLowerCase(); if (m) billEmails.add(m); } catch (e) { /* no contact */ } }
  } catch (e) { /* no added sign-ins */ }
  if (stripe && stripe.customers && stripe.customers.list) {
    try {
      for (const em of billEmails) for await (const c of stripe.customers.list({ email: em, limit: 20 })) {
        customers.push({ id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '', hasCard: !!(c.invoice_settings && c.invoice_settings.default_payment_method) });
        try { for (const d of (await db.collection('enrollments').where('customer', '==', c.id).get()).docs) { const l = d.data() || {}; if (l.player) ids.add(l.player); } } catch (e) { /* no ledger */ }
      }
    } catch (e) { /* Stripe down: the roster match is enough to show the players */ }
  }
  const players = [];
  for (const id of ids) {
    const snap = await db.doc('players/' + id).get();
    if (snap.exists) players.push(Object.assign({ id }, snap.data()));
  }
  players.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { players, customers };
}

/* ── this month's attendance from the posted lists ── */
function monthRange(today) {
  const p = CAL.parts(today);
  const from = `${p.y}-${String(p.m + 1).padStart(2, '0')}-01`;
  const to = `${p.y}-${String(p.m + 1).padStart(2, '0')}-31`;
  return { from, to, label: `${CAL.MONTHS[p.m]} ${p.y}` };
}
async function attendance(db, players, today) {
  const r = monthRange(today);
  let sheets = [];
  try { sheets = (await db.collection('sheets').where('date', '>=', r.from).where('date', '<=', r.to).get()).docs.map((d) => d.data() || {}); } catch (e) { sheets = []; }
  const byPlayer = {};
  for (const p of players) byPlayer[p.id] = { month: r.label, from: r.from, to: r.to, days: [], present: 0, missed: 0 };
  for (const s of sheets) {
    if (!s.posted || !s.courts) continue;
    const noshow = new Set((s.recon && Array.isArray(s.recon.noshow)) ? s.recon.noshow : []);
    for (const p of players) {
      let present = false;
      for (const court of Object.keys(s.courts)) for (const e of (s.courts[court] || [])) if (e && e.pid === p.id && e.present) present = true;
      if (present) { byPlayer[p.id].days.push({ date: s.date, session: s.sid || '', present: true }); byPlayer[p.id].present++; }
      else if (noshow.has(p.id)) { byPlayer[p.id].days.push({ date: s.date, session: s.sid || '', present: false }); byPlayer[p.id].missed++; }
    }
  }
  for (const id of Object.keys(byPlayer)) byPlayer[id].days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return byPlayer;
}

/* ── the reports the coaches sent: final, marked "sent to parents" ── */
const TITLES = { report3m: '3-Month Report', quarterly_hp: 'Quarterly Player Assessment', quarterly: 'Quarterly Player Assessment', quarterly_u: 'Under 12 Player Assessment', quarterly_u12: 'Under 12 Player Assessment', progress_u10: 'Under 10 Player Progress Update', monthly: 'Monthly Player Report', camp_snapshot: 'Camp Week Snapshot', camp_performance: 'Camp Performance Report', u10: 'Under 10 Player Progress Update' };
// the 3-month report (Nov 2026) leads with the goals, then how to get there per pillar; the older forms keep their own fields
const NOTE_FIELDS = [
  ['goals', 'The goals for the next 3 months', ['r_goals']],
  ['strengths', 'Key strengths', ['p_strengths', 'ob_strengths']],
  ['tennis', 'Tennis', ['r_tennis', 'tennis_overall', 'mo_tennis']],
  ['fitness', 'Fitness', ['r_fitness', 'fitness_overall', 'mo_fitness']],
  ['mental', 'Mental performance', ['r_mental', 'mental_overall', 'mo_mental']],
  ['competition', 'Competition', ['r_comp', 'mo_comp']],
  ['next', 'What comes next', ['next_focus', 'wk_next', 'cp_next']],
  ['parents', 'A note from your coach', ['s_parents']]
];
const FOCUS_FIELDS = ['tk_f1', 'tk_f2', 'tk_f3', 'wk_f1', 'wk_f2', 'wk_f3'];
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
function firstName(s) { return String(s || '').trim().split(/\s+/)[0] || ''; }
function reportOf(a, v) {
  v = v || {};
  const scores = {}; for (const [k, f] of [['tennis', 'sc_tennis'], ['fitness', 'sc_fitness'], ['mental', 'sc_mental'], ['overall', 'sc_overall']]) if (has(v[f])) scores[k] = v[f];
  const notes = []; for (const [id, label, fields] of NOTE_FIELDS) { const f = fields.find((x) => has(v[x])); if (f) notes.push({ id, label, text: String(v[f]).trim() }); }
  const focus = FOCUS_FIELDS.filter((f) => has(v[f])).map((f) => String(v[f]).trim());
  return { id: a.id, type: a.type || '', title: TITLES[a.type] || 'Player report', period: a.period || '', date: a.evalDate || '', sentAt: a.sent || null, coach: firstName(a.coach), scores, focus, notes };
}
async function reports(db, pid) {
  let docs = [];
  try { docs = (await db.collection('assessments').where('playerId', '==', pid).get()).docs; } catch (e) { docs = []; }
  const out = [];
  for (const d of docs) {
    const a = Object.assign({ id: d.id }, d.data() || {});
    if (a.status !== 'final' || a.sentToParents !== true) continue;
    let v = {};
    try { const b = await db.doc(`assessments/${d.id}/body/values`).get(); v = b.exists ? ((b.data() || {}).v || {}) : {}; } catch (e) { v = {}; }
    out.push(reportOf(a, v));
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return out.slice(0, KEEP_REPORTS);
}

/* ── billing: every plan and open invoice of the family's Stripe customers ── */
async function billing(stripe, customers, today) {
  const subscriptions = []; const openInvoices = [];
  if (!stripe) return { customers, subscriptions, openInvoices };
  for (const c of customers) {
    try {
      for await (const sub of stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20, expand: ['data.items.data.price', 'data.latest_invoice'] })) {
        if (sub.status === 'canceled' && sub.canceled_at && Date.now() / 1000 - sub.canceled_at > 120 * 86400) continue;
        const { program, plan } = ADMIN.planOf(sub); const m = sub.metadata || {};
        const end = S.periodEnd(sub); const nextDate = end ? CAL.dateOfUnixET(end) : null;
        const nextCents = plan && nextDate && sub.status !== 'canceled' && !sub.cancel_at_period_end ? (plan.every ? plan.monthly * 100 : CAL.firstChargeCents(plan.monthly * 100, nextDate, m.start)) : null;
        const li = sub.latest_invoice && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
        subscriptions.push({ id: sub.id, customer: c.id, player: m.player || '', program: program ? program.short : (m.program || ''), plan: plan ? plan.label : (m.plan_label || ''), days: String(m.days || '').split(',').filter(Boolean), monthly: plan ? plan.monthly : null, cycle: plan ? CAT.cycleWord(plan) : 'a month', status: sub.status, hold: m.hold === 'true', cancelAtPeriodEnd: !!sub.cancel_at_period_end, paused: !!sub.pause_collection, start: m.start || CAL.dateOfUnixET(sub.created), next: nextDate ? { date: nextDate, cents: nextCents } : null, latestInvoice: li ? { status: li.status, amountDue: li.amount_due, url: li.hosted_invoice_url || null, created: CAL.dateOfUnixET(li.created) } : null });
      }
    } catch (e) { /* a customer with no plans */ }
    try {
      for await (const inv of stripe.invoices.list({ customer: c.id, status: 'open', limit: 20 })) openInvoices.push({ id: inv.id, customer: c.id, created: CAL.dateOfUnixET(inv.created), amountDue: inv.amount_due, description: inv.description || (inv.lines && inv.lines.data && inv.lines.data[0] && inv.lines.data[0].description) || 'Invoice', url: inv.hosted_invoice_url || null, kind: (inv.metadata || {}).kind || (S.invoiceSubscription(inv) ? 'tuition' : 'one-off') });
    } catch (e) { /* no invoices */ }
  }
  /* the last invoices paid (Nov 19, 2026): parents ask for one for a scholarship or their accountant; Stripe keeps the PDF */
  const paid = [];
  for (const c of customers) { try { let n = 0; for await (const inv of stripe.invoices.list({ customer: c.id, status: 'paid', limit: 12 })) { if (n++ >= 12) break; paid.push({ id: inv.id, date: CAL.dateOfUnixET(inv.created), cents: inv.amount_paid, description: inv.description || (inv.lines && inv.lines.data && inv.lines.data[0] && inv.lines.data[0].description) || 'Invoice', pdf: inv.invoice_pdf || inv.hosted_invoice_url || '' }); } } catch (e) { /* none */ } }
  paid.sort((a, b) => CAL.cmp(b.date, a.date));
  return { customers: customers.map((c) => ({ id: c.id, name: c.name, email: c.email, hasCard: !!c.hasCard })), subscriptions, openInvoices, paidInvoices: paid.slice(0, 12) };
}

/* ── the schedule (Nov 17, 2026 — Antonio: "my daughter is not going to come in for 2 weeks: I can put that on the schedule,
   mark her absent for those 2 weeks, and add a make-up on that calendar as well") ──
   familyDays/<player>_<date> = { player, playerName, date, kind: 'away' | 'makeup', email, at } — one document a day, written here
   only. The attendance board reads them: an away player is not expected that day (so no no-show), a make-up player is.
   A family may take as many make-up days as the days it gave notice for (from a month back) plus the days missed this month. */
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AHEAD = 90; const BACK = 31; const MAX_RANGE = 62;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const dowOf = (d) => DOW3[CAL.dow(d)];
const cap3 = (d) => { const x = String(d || '').slice(0, 3).toLowerCase(); return x ? x[0].toUpperCase() + x.slice(1) : ''; };
function trainDays(p) { const en = p.enroll || {}; return (Array.isArray(en.days) ? en.days : []).map(cap3).filter((d) => DOW3.includes(d)); }
function openDays(p) { const en = p.enroll || {}; const prog = en.program ? CAT.program(en.program) : null; const d = prog && Array.isArray(prog.days) ? prog.days.map(cap3).filter((x) => DOW3.includes(x)) : []; return d.length ? d : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']; }
const isOpen = (d) => { try { return CAL.isTrainingDay(d); } catch (e) { return true; } };
/* By the session (Nov 18, 2026 — management: "people that have the flex sessions should have the calendar open, and mark which
   sessions they are attending… the 7:45, the 9:45, the afterschool"). The sessions a player of each group can pick; the ids are
   the attendance board's own (backend SESSIONS), so a booked player is expected in that session and nowhere else. */
const SESSION_MENU = {
  ft: [{ id: 'ft1', time: '7:45 AM', label: 'Morning 1' }, { id: 'ft2', time: '9:30 AM', label: 'Morning 2' }, { id: 'pm2', time: '2:00 PM', label: 'Afternoon' }, { id: 'as', time: '4:00 PM', label: 'Afterschool' }],
  tour: [{ id: 'ft1', time: '7:45 AM', label: 'Morning 1' }, { id: 'ft2', time: '9:30 AM', label: 'Morning 2' }, { id: 'pm2', time: '2:00 PM', label: 'Afternoon' }, { id: 'as', time: '4:00 PM', label: 'Afterschool' }],
  as: [{ id: 'as', time: '4:00 PM', label: 'Afterschool' }],
  u10: [{ id: 'u10', time: '4:30 PM', label: '10 & Under' }]
};
const isFlex = (p) => { const en = p.enroll || {}; return !!(en.pbp && en.pbp.bySession) || en.kind === 'pack'; };
const menuOf = (p) => (isFlex(p) ? (SESSION_MENU[p.group] || []) : []);
async function daysOf(db, pid, today) {
  let docs = [];
  try { docs = (await db.collection('familyDays').where('player', '==', pid).get()).docs.map((d) => d.data() || {}); } catch (e) { docs = []; }
  const from = CAL.addDays(today, -BACK);
  return docs.filter((d) => isDate(d.date) && d.date >= from && (d.kind === 'away' || d.kind === 'makeup' || d.kind === 'book')).map((d) => Object.assign({ date: d.date, kind: d.kind }, d.kind === 'book' ? { sessions: Array.isArray(d.sessions) ? d.sessions : [] } : {})).sort((a, b) => CAL.cmp(a.date, b.date));
}
/* The make-up rule (Nov 19, 2026, management): a session missed is made up in the same month. A day away in November is used on
   another day in November, or it waits on the account until the month ends; it does not roll into December. An exception (a
   week of illness) is decided by the admin team, case by case, not here. `month` is 'YYYY-MM'; the days missed without notice
   (`missed`) are this month's and count only for the current month. */
function makeupsLeft(days, missed, month) {
  const inM = (d) => !month || String(d.date).slice(0, 7) === month;
  return Math.max(0, days.filter((d) => d.kind === 'away' && inM(d)).length + (missed || 0) - days.filter((d) => d.kind === 'makeup' && inM(d)).length);
}
const sayDay = (d) => { const p = CAL.parts(d); return `${CAL.MONTHS[p.m].slice(0, 3)} ${p.d}`; };
/* The director of the player's group hears it at once (Nov 17, 2026 — Antonio: "the moment I hit 'she cannot make it', a notification
   goes to the director of the group"): a line from ProWorld in the director's Locker Room, with the push that goes with it. The
   group's director is groups/<id>.director (a name, or several); a group with none on file tells every director. No family
   contact details in the line. */
/* Who directs which group, as management gave it on Nov 17, 2026. Campers: nobody yet (they have their own groups). A group not listed here tells every director. */
const GROUP_DIRECTORS = { ft: ['Tonio', 'Nico'], as: ['Nico', 'Kamryn'], u10: ['Kamryn'], tour: ['Nico', 'Tonio'], camp: [] };
async function tellDirector(db, p, text) {
  try {
    const CONTACTS = require('./contacts'); const TEAM = require('./team');
    let g = {}; try { const x = await db.doc('groups/' + (p.group || '-')).get(); g = x.exists ? (x.data() || {}) : {}; } catch (e) { g = {}; }
    const staff = await CONTACTS.staffIndex(db); const to = new Set();
    // groups/<id>.directors: the directors' sign-ins set on the Coach Board (Nov 18, 2026); groups/<id>.notify is the older hand-set list; otherwise GROUP_DIRECTORS below. (`director` on the group is only the label the portal shows.)
    const set = Array.isArray(g.directors) && g.directors.length ? g.directors : (Array.isArray(g.notify) ? g.notify : null);
    const listed = !!set; (set || []).forEach((e) => { e = String(e || '').toLowerCase(); if (e.includes('@')) to.add(e); });
    if (!listed) (GROUP_DIRECTORS[p.group] || []).forEach((n) => { const st = CONTACTS.staffFor(staff, n); if (st && st.email) to.add(st.email); });
    const known = listed || Object.prototype.hasOwnProperty.call(GROUP_DIRECTORS, p.group || '');
    if (!to.size && !known) { const all = await db.collection('staff').get(); all.docs.forEach((d) => { const x = d.data() || {}; if (x.active !== false && String(x.role || '').toLowerCase() === 'director') to.add(d.id.toLowerCase()); }); }
    for (const e of to) await TEAM.direct(db, e, text);
    return [...to];
  } catch (e) { console.error('family tellDirector error', e.message); return []; }
}
async function days(db, who, body, players, opts) {
  opts = opts || {}; body = body || {}; const today = opts.today || CAL.todayET();
  const p = (players || []).find((x) => x.id === S.clean(body.player, 60));
  if (!p) throw S.err(404, 'player', 'Which player?');
  const action = String(body.action || '');
  const ref = (d) => db.doc(`familyDays/${p.id}_${d}`);
  const base = { player: p.id, playerName: p.name || p.id, email: who.email, at: Date.now() };
  const have = await daysOf(db, p.id, today);
  const range = () => {
    const from = S.clean(body.from || body.date, 10); let to = S.clean(body.to || body.from || body.date, 10);
    if (!isDate(from) || !isDate(to)) throw S.err(400, 'date', 'Pick the day.');
    if (to < from) to = from;
    if (from < today) throw S.err(400, 'past', 'That day has passed.');
    if (to > CAL.addDays(from, MAX_RANGE)) throw S.err(400, 'long', 'For more than two months away, write to Admin so the plan can be put on hold.');
    const out = []; for (let d = from; d <= to; d = CAL.addDays(d, 1)) out.push(d); return { from, to, all: out };
  };
  if (action === 'away') {
    const r = range(); const mine = trainDays(p); const set = mine.length ? mine : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const hit = r.all.filter((d) => (set.includes(dowOf(d)) && isOpen(d)) || have.some((x) => x.date === d && x.kind === 'makeup'));
    if (!hit.length) throw S.err(400, 'none', `${ROSTER.shortName(p.name)} has no training on ${r.from === r.to ? 'that day' : 'those days'}.`);
    for (const d of hit) await ref(d).set(Object.assign({ date: d, kind: 'away' }, base));
    await NOTIFY.slack(db, 'desk', `*Away* — ${p.name}`, [r.from === r.to ? sayDay(r.from) : `${sayDay(r.from)} to ${sayDay(r.to)} · ${hit.length} session${hit.length === 1 ? '' : 's'}`, `Marked by the family (${who.email}) in the client account. The attendance board already has it.`, S.clean(body.note, 300)].filter(Boolean));
    const grp = p.enroll && (p.enroll.programShort || p.enroll.programName) ? ` (${p.enroll.programShort || p.enroll.programName})` : '';
    await tellDirector(db, p, `*${p.name}*${grp} cannot make it: ${r.from === r.to || hit.length === 1 ? dowOf(hit[0]) + ' ' + sayDay(hit[0]) : `${sayDay(hit[0])} to ${sayDay(hit[hit.length - 1])}, ${hit.length} sessions`}. The family marked it in the app. The attendance shows the player greyed out.`);
    return { ok: true, action, dates: hit };
  }
  if (action === 'back') {
    const r = range(); const hit = have.filter((x) => x.kind === 'away' && x.date >= r.from && x.date <= r.to).map((x) => x.date);
    for (const d of hit) await ref(d).delete();
    if (hit.length) await NOTIFY.slack(db, 'desk', `*Coming after all* — ${p.name}`, [hit.length === 1 ? sayDay(hit[0]) : `${sayDay(hit[0])} to ${sayDay(hit[hit.length - 1])} · ${hit.length} sessions`, `Changed by the family (${who.email}) in the client account.`]);
    if (hit.length) await tellDirector(db, p, `*${p.name}* is coming after all: ${hit.length === 1 ? dowOf(hit[0]) + ' ' + sayDay(hit[0]) : `${sayDay(hit[0])} to ${sayDay(hit[hit.length - 1])}`}. The family changed it in the app.`);
    return { ok: true, action, dates: hit };
  }
  if (action === 'makeup') {
    const d = S.clean(body.date, 10);
    if (!isDate(d)) throw S.err(400, 'date', 'Pick the day.');
    if (d < today) throw S.err(400, 'past', 'That day has passed.');
    if (d > CAL.addDays(today, AHEAD)) throw S.err(400, 'far', 'Pick a day in the next three months.');
    if (trainDays(p).includes(dowOf(d)) && !have.some((x) => x.date === d && x.kind === 'away')) throw S.err(400, 'training', `${ROSTER.shortName(p.name)} already trains that day.`);
    if (!openDays(p).includes(dowOf(d)) || !isOpen(d)) throw S.err(400, 'closed', 'There is no session of this program that day.');
    if (have.some((x) => x.date === d && x.kind === 'makeup')) return { ok: true, action, dates: [d] };
    const att = await attendance(db, [p], today);
    const mth = d.slice(0, 7); const thisMonth = mth === today.slice(0, 7);
    if (makeupsLeft(have, thisMonth ? att[p.id].missed : 0, mth) < 1) throw S.err(400, 'credit', have.some((x) => x.kind === 'away') ? 'A make-up day is used in the same month as the day missed. Pick a day in that month, or write to Admin.' : 'A make-up day goes with a day missed. Mark the day away first, or write to Admin.');
    await ref(d).set(Object.assign({ date: d, kind: 'makeup' }, base));
    await NOTIFY.slack(db, 'desk', `*Make-up day* — ${p.name}`, [`${dowOf(d)} ${sayDay(d)}`, `Picked by the family (${who.email}) in the client account. The attendance board expects the player that day. Not possible? Tell the family.`]);
    await tellDirector(db, p, `*${p.name}* comes for a make-up day: ${dowOf(d)} ${sayDay(d)}. The family picked it in the app. The attendance expects the player that day.`);
    return { ok: true, action, dates: [d] };
  }
  if (action === 'nomakeup') {
    const d = S.clean(body.date, 10);
    if (!isDate(d) || d < today) throw S.err(400, 'date', 'Pick the day.');
    if (have.some((x) => x.date === d && x.kind === 'makeup')) { await ref(d).delete(); await NOTIFY.slack(db, 'desk', `*Make-up day removed* — ${p.name}`, [`${dowOf(d)} ${sayDay(d)}`, `Removed by the family (${who.email}).`]); }
    return { ok: true, action, dates: [d] };
  }
  if (action === 'book') {   // a by-the-session player picks the sessions of one day; an empty pick takes the day off again
    const menu = menuOf(p); if (!menu.length) throw S.err(400, 'fixed', 'This player has fixed training days. Mark a day away instead.');
    const d = S.clean(body.date, 10);
    if (!isDate(d) || d < today) throw S.err(400, 'date', 'Pick a day from today on.');
    if (d > CAL.addDays(today, AHEAD)) throw S.err(400, 'far', 'Pick a day in the next three months.');
    if (!openDays(p).includes(dowOf(d)) || !isOpen(d)) throw S.err(400, 'closed', 'There is no session that day.');
    const pick = (Array.isArray(body.sessions) ? body.sessions : []).map((x) => String(x)).filter((x) => menu.some((m) => m.id === x));
    const was = have.find((x) => x.date === d && x.kind === 'book');
    if (!pick.length) { if (was) { await ref(d).delete(); await NOTIFY.slack(db, 'desk', `*Session taken off* — ${p.name}`, [`${dowOf(d)} ${sayDay(d)}`, `Changed by the family (${who.email}) in the client account.`]); } return { ok: true, action, dates: [d], sessions: [] }; }
    await ref(d).set(Object.assign({ date: d, kind: 'book', sessions: pick }, base));
    const said = pick.map((x) => { const m = menu.find((y) => y.id === x); return `${m.time} ${m.label}`; }).join(', ');
    await NOTIFY.slack(db, 'desk', `*Session booked* — ${p.name}`, [`${dowOf(d)} ${sayDay(d)} · ${said}`, `Picked by the family (${who.email}) in the client account. The attendance expects the player in ${pick.length === 1 ? 'that session' : 'those sessions'}.`]);
    return { ok: true, action, dates: [d], sessions: pick };
  }
  throw S.err(400, 'action', 'Unknown change.');
}

/* ── messages (Nov 17, 2026 — Antonio: "I should have my coaches that are linked to each player, and also the admin… for any
   question about registrations, billing and things like that") ──
   To a coach: the words land in that coach's chat with the family in the Coach Portal, as if the parent had texted the coach's
   number (lib/coachtext.js fromApp); the coach answers there, the answer goes to the parent's phone and shows here. To Admin:
   a request the front desk and the billing people read and answer (familyRequests, kind 'admin'). No staff name ever shows for Admin. */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
function coachesOf(p) { const out = []; for (const c of [p.coach, p.coach2, p.coach3]) { const n = firstName(c); const k = fold(n); if (k && !out.some((x) => x.key === k)) out.push({ key: k, name: n, full: c }); } return out; }
const ADMIN_KINDS = ['admin', 'message', 'change', 'court', 'private', 'makeup'];
function target(p, to) {
  const all = coachesOf(p); to = fold(to);
  if (to === 'all') { if (all.length < 2) throw S.err(400, 'to', 'Who is this for?'); return { conv: 'all', coaches: all, title: all.map((c) => 'Coach ' + c.name).join(' and ') }; }
  const one = all.find((c) => c.key === to); if (!one) throw S.err(400, 'to', 'Who is this for?');
  return { conv: one.key, coaches: [one], title: 'Coach ' + one.name };
}
async function chat(db, who, body, players) {
  body = body || {}; const to = fold(body.to);
  let reqs = [];
  try { reqs = (await db.collection('familyRequests').where('email', '==', who.email).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})); } catch (e) { reqs = []; }
  const fromReq = (r) => { const out = [{ at: r.at || 0, dir: 'me', body: String(r.text || ''), tag: r.kind === 'admin' || r.kind === 'coach' ? '' : (REQUEST_KINDS[r.kind] || '') + (r.playerName ? ' · ' + ROSTER.shortName(r.playerName) : '') }]; if (r.reply) out.push({ at: r.repliedAt || (r.at || 0) + 1, dir: 'them', body: String(r.reply), by: 'Admin' }); return out; };
  if (to === 'admin') {
    const lines = []; reqs.filter((r) => ADMIN_KINDS.includes(r.kind)).forEach((r) => lines.push(...fromReq(r)));
    return { to: 'admin', title: 'Admin', lines: lines.sort((a, b) => a.at - b.at).slice(-200) };
  }
  const p = (players || []).find((x) => x.id === S.clean(body.player, 60)); if (!p) throw S.err(404, 'player', 'Which player?');
  const t = target(p, to);
  const lines = await require('./coachtext').appThread(db, p, who.email, t);
  reqs.filter((r) => r.kind === 'coach' && r.player === p.id && (r.appConv || '') === t.conv).forEach((r) => lines.push(...fromReq(r)));
  return { to: t.conv, player: p.id, title: t.title, lines: lines.sort((a, b) => a.at - b.at).slice(-200) };
}
async function message(db, who, body, players) {
  body = body || {}; const to = fold(body.to); const text = S.clean(body.text, 600);
  if (!text) throw S.err(400, 'text', 'Write your message first.');
  const p = (players || []).find((x) => x.id === S.clean(body.player, 60)) || null;
  if (to === 'admin') { const out = await request(db, who, { kind: 'admin', text, player: p ? p.id : '', name: body.name }, players); return { ok: true, to: 'admin', id: out.id }; }
  if (!p) throw S.err(404, 'player', 'Which player?');
  const t = target(p, to);
  const out = await require('./coachtext').fromApp(db, p, who, t, text);
  // a coach with no sign-in yet, or a family with no number on file: the front desk passes it on, so no message is lost
  if (out.missing.length) { const doc = { email: who.email, name: who.name || '', phone: '', kind: 'coach', player: p.id, playerName: p.name, text, when: '', at: Date.now(), state: 'open', source: 'family', appConv: t.conv, forCoach: out.missing.join(', ') };
    await db.collection('familyRequests').add(doc);
    await NOTIFY.slack(db, 'desk', `*Message for Coach ${out.missing.join(' and Coach ')}* — ${p.name}`, [`From ${who.name || who.email} · ${who.email}`, text, 'Written in the client account. This coach cannot be reached in the app yet: please pass it on.']); }
  return { ok: true, to: t.conv, reached: out.sent.length, passed: out.missing.length };
}

/* ── how to reach each coach and Admin from the family's own phone (Nov 18, 2026 — management: "they're using their own phone…
   add the options to text message, WhatsApp, or e-mail") ──
   A coach: the coach's own academy number (the JustCall number the coach texts from, so the text lands in the coach's Contact)
   and the coach's e-mail. A coach with no number of their own: the academy line. Admin: the academy line and info@. WhatsApp only
   shows where a WhatsApp number is on file (settings/contact.whatsapp for Admin, staff/<e-mail>.whatsapp for a coach): a link to
   a number that is not on WhatsApp opens an error. */
const ACADEMY_LINE = '+15614030008'; const ACADEMY_MAIL = 'info@proworldacademy.com';
async function waysOf(db, players) {
  const out = { admin: { sms: ACADEMY_LINE, email: ACADEMY_MAIL, whatsapp: '' }, coaches: {} };
  try {
    try { const x = await db.doc('settings/contact').get(); const c = x.exists ? (x.data() || {}) : {}; if (c.whatsapp) out.admin.whatsapp = String(c.whatsapp).replace(/[^\d+]/g, ''); if (c.sms) out.admin.sms = String(c.sms).replace(/[^\d+]/g, ''); if (c.email) out.admin.email = String(c.email); } catch (e) { /* the defaults */ }
    const CONTACTS = require('./contacts'); const COACHTEXT = require('./coachtext'); const staff = await CONTACTS.staffIndex(db);
    for (const p of players) for (const c of coachesOf(p)) {
      if (out.coaches[c.key]) continue;
      const st = CONTACTS.staffFor(staff, c.full || c.name);
      let own = ''; try { own = st ? await COACHTEXT.ownLine(db, { email: st.email, justcallNumber: st.justcallNumber }) : ''; } catch (e) { own = ''; }
      out.coaches[c.key] = { sms: own || ACADEMY_LINE, own: !!own, email: st ? st.email : '', whatsapp: st && st.whatsapp ? String(st.whatsapp).replace(/[^\d+]/g, '') : '' };
    }
  } catch (e) { console.error('family waysOf error', e.message); }
  return out;
}

/* ── more people on a player's messages (Nov 18, 2026 — management: "let's say my wife's number is not added and I want to include
   her… or a fitness trainer outside… give me the option to add numbers") ──
   The parent adds a name and a mobile number to the player's contact card (private/contact.extra, four at most). The coaches see
   that number with the family's others in Contact and can text it or put it in a group chat. The family only ever sees the name
   and the last four digits back. */
const tail4 = (v) => String(v || '').replace(/\D+/g, '').slice(-4);
async function peopleOf(db, pid) {
  try { const x = await db.doc(`players/${pid}/private/contact`).get(); const c = x.exists ? (x.data() || {}) : {}; return (Array.isArray(c.extra) ? c.extra : []).map((e) => ({ name: String(e.name || ''), tail: tail4(e.phone) })); } catch (e) { return []; }
}
async function people(db, who, body, players) {
  body = body || {}; const p = (players || []).find((x) => x.id === S.clean(body.player, 60)); if (!p) throw S.err(404, 'player', 'Which player?');
  const ref = db.doc(`players/${p.id}/private/contact`); const snap = await ref.get(); const c = snap.exists ? (snap.data() || {}) : {};
  let extra = Array.isArray(c.extra) ? c.extra.slice() : [];
  if (body.remove) { const t = tail4(body.remove); const nm = fold(body.name); extra = extra.filter((e) => !(tail4(e.phone) === t && (!nm || fold(e.name) === nm))); }
  else {
    const name = S.clean(body.name, 60); let digits = String(body.phone || '').replace(/\D+/g, ''); if (digits.length === 10) digits = '1' + digits;
    if (!name) throw S.err(400, 'name', 'Whose number is it?');
    if (digits.length < 11 || digits.length > 15) throw S.err(400, 'phone', 'That does not look like a mobile number. Include the area code.');
    if (extra.some((e) => String(e.phone).replace(/\D+/g, '') === digits)) throw S.err(400, 'dup', 'That number is already on the list.');
    if (extra.length >= 4) throw S.err(400, 'full', 'Four extra numbers is the most. Remove one first.');
    extra.push({ name, phone: '+' + digits, by: who.email, at: Date.now() });
    // one text of consent to the new number (Nov 18, 2026 — management: "the other person should just get a text of consent"): who added them, for which player, and how to stop
    let told = false; try { told = await NOTIFY.text(db, '+' + digits, `${who.name || 'A parent'} added you to ${ROSTER.shortName(p.name)}'s messages at ProWorld Academy. The coaches may text you about ${ROSTER.shortName(p.name)}'s training. Reply STOP if you do not want these texts.`); } catch (e) { told = false; }
    extra[extra.length - 1].told = told;
    await NOTIFY.slack(db, 'desk', `*New number on a player's messages* — ${p.name}`, [`${name} · number ending ${digits.slice(-4)}`, `Added by the family (${who.email}) in the client account. The coaches see it in Contact.`]);
  }
  await ref.set({ extra, updatedAt: Date.now() }, { merge: true });
  return { ok: true, people: extra.map((e) => ({ name: e.name, tail: tail4(e.phone) })) };
}

/* ── the account (Nov 19, 2026 — management: "a client in their portal has account information: change e-mails, add a parent,
   add phone numbers, add a different e-mail, save a card") ──
   What the family sees: the e-mails that can sign in (the main one is where the academy writes), the phone numbers on file, and
   whether a card is saved. What it can do: add a parent or a contact (a name with an e-mail, a mobile, or both), make another
   e-mail the main one, remove what it added. The card itself is kept by Stripe, on Stripe's own page; nothing of it is here.
   players/<id>/private/contact.logins = [{ email, name, by, at }] and familyLogins/<e-mail>.players mirror each other. */
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ''));
const low = (v) => String(v || '').trim().toLowerCase();
async function contactOf(db, pid) { try { const x = await db.doc(`players/${pid}/private/contact`).get(); return x.exists ? (x.data() || {}) : {}; } catch (e) { return {}; } }
async function accountOf(db, who, players, customers) {
  const emails = new Map(); const phones = new Map();
  for (const p of players || []) {
    const c = await contactOf(db, p.id);
    const main = low(c.email); if (main) emails.set(main, Object.assign(emails.get(main) || {}, { email: main, name: String(c.guardian || ''), main: true }));
    for (const l of (Array.isArray(c.logins) ? c.logins : [])) { const e = low(l.email); if (e && !emails.has(e)) emails.set(e, { email: e, name: String(l.name || ''), main: false }); }
    [[c.phone, 'On file'], [c.phone2, 'On file']].forEach(([ph, w]) => { const t = tail4(ph); if (t && !phones.has(t)) phones.set(t, { tail: t, name: w, fixed: true }); });
    for (const x of (Array.isArray(c.extra) ? c.extra : [])) { const t = tail4(x.phone); if (t && !phones.has(t)) phones.set(t, { tail: t, name: String(x.name || ''), fixed: false }); }
  }
  if (!emails.has(who.email)) emails.set(who.email, { email: who.email, name: who.name || '', main: !Array.from(emails.values()).some((e) => e.main) });
  return { email: who.email, emails: Array.from(emails.values()).map((e) => Object.assign(e, { me: e.email === who.email })).sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0) || a.email.localeCompare(b.email)),
    phones: Array.from(phones.values()), card: (customers || []).some((c) => c.hasCard), hasBilling: (customers || []).length > 0 };
}
async function account(db, who, body, players) {
  body = body || {}; players = players || []; if (!players.length) throw S.err(404, 'player', 'There is no player on this account yet.');
  const act = S.clean(body.action, 20); const short = players.map((p) => ROSTER.shortName(p.name)).join(' and ');
  const setLogin = async (email, add) => {
    const ref = db.doc('familyLogins/' + email); const snap = await ref.get(); const cur = new Set(snap.exists ? ((snap.data() || {}).players || []) : []);
    players.forEach((p) => (add ? cur.add(p.id) : cur.delete(p.id)));
    await ref.set({ players: Array.from(cur), by: who.email, updatedAt: Date.now() }, { merge: true });
  };
  if (act === 'add') {
    const name = S.clean(body.name, 60); const email = low(S.clean(body.email, 120)); let digits = String(body.phone || '').replace(/\D+/g, ''); if (digits.length === 10) digits = '1' + digits;
    if (!name) throw S.err(400, 'name', 'What is their name?');
    if (!email && !digits) throw S.err(400, 'what', 'Add an e-mail, a mobile number, or both.');
    if (email && !isEmail(email)) throw S.err(400, 'email', 'That e-mail does not look right.');
    if (digits && (digits.length < 11 || digits.length > 15)) throw S.err(400, 'phone', 'That does not look like a mobile number. Include the area code.');
    let addedEmail = false, addedPhone = false, told = false;
    for (const p of players) {
      const ref = db.doc(`players/${p.id}/private/contact`); const c = await contactOf(db, p.id); const patch = {};
      if (email && low(c.email) !== email) { const logins = Array.isArray(c.logins) ? c.logins.slice() : []; if (!logins.some((l) => low(l.email) === email)) { if (logins.length >= 4) throw S.err(400, 'full', 'Four extra e-mails is the most. Remove one first.'); logins.push({ email, name, by: who.email, at: Date.now() }); patch.logins = logins; addedEmail = true; } }
      if (digits) { const extra = Array.isArray(c.extra) ? c.extra.slice() : []; const on = [c.phone, c.phone2].concat(extra.map((e) => e.phone)).some((x) => String(x || '').replace(/\D+/g, '').slice(-10) === digits.slice(-10));
        if (!on) { if (extra.length >= 4) throw S.err(400, 'full', 'Four extra numbers is the most. Remove one first.'); extra.push({ name, phone: '+' + digits, by: who.email, at: Date.now() }); patch.extra = extra; addedPhone = true; } }
      if (Object.keys(patch).length) await ref.set(Object.assign(patch, { updatedAt: Date.now() }), { merge: true });
    }
    if (email) await setLogin(email, true);
    if (!addedEmail && !addedPhone) throw S.err(400, 'dup', 'That is already on your account.');
    if (addedPhone) { try { told = await NOTIFY.text(db, '+' + digits, `${who.name || 'A parent'} added you to ${short}'s account at ProWorld Academy. The coaches may text you about training. Reply STOP if you do not want these texts.`); } catch (e) { told = false; } }
    try { await NOTIFY.slack(db, 'desk', `*A family added a contact to its account* — ${players.map((p) => p.name).join(', ')}`, [`${name}${addedEmail ? ' · an e-mail that can now sign in' : ''}${addedPhone ? ' · a number ending ' + digits.slice(-4) : ''}`, `Added by the family (${who.email}) in the client account.`]); } catch (e) { /* a notice only */ }
    return { ok: true, addedEmail, addedPhone, told };
  }
  if (act === 'email-remove') {
    const email = low(body.email); if (!email) throw S.err(400, 'email', 'Which e-mail?');
    if (email === who.email) throw S.err(400, 'self', 'That is the e-mail you are signed in with. Sign in with another one to remove it.');
    for (const p of players) { const c = await contactOf(db, p.id); if (low(c.email) === email) throw S.err(400, 'main', 'That is the main e-mail. Make another one the main e-mail first.');
      const logins = (Array.isArray(c.logins) ? c.logins : []).filter((l) => low(l.email) !== email); await db.doc(`players/${p.id}/private/contact`).set({ logins, updatedAt: Date.now() }, { merge: true }); }
    await setLogin(email, false); return { ok: true };
  }
  if (act === 'email-main') {
    const email = low(body.email); if (!isEmail(email)) throw S.err(400, 'email', 'Which e-mail?');
    for (const p of players) {
      const c = await contactOf(db, p.id); const old = low(c.email); if (old === email) continue;
      let logins = Array.isArray(c.logins) ? c.logins.slice() : []; const mine = logins.find((l) => low(l.email) === email);
      if (!mine && email !== who.email) throw S.err(400, 'unknown', 'Add that e-mail to the account first.');
      logins = logins.filter((l) => low(l.email) !== email);
      if (old && !logins.some((l) => low(l.email) === old)) logins.push({ email: old, name: String(c.guardian || ''), by: who.email, at: Date.now() });   // the old one still signs in, until the family removes it
      await db.doc(`players/${p.id}/private/contact`).set({ email, logins, updatedAt: Date.now() }, { merge: true });
      if (old) { const ref = db.doc('familyLogins/' + old); const sn = await ref.get(); const cur = new Set(sn.exists ? ((sn.data() || {}).players || []) : []); cur.add(p.id); await ref.set({ players: Array.from(cur), by: who.email, updatedAt: Date.now() }, { merge: true }); }
    }
    await setLogin(email, true);
    try { await NOTIFY.slack(db, 'desk', `*A family changed its main e-mail* — ${players.map((p) => p.name).join(', ')}`, [`Changed by the family (${who.email}) in the client account. The old e-mail still signs in until they remove it.`]); } catch (e) { /* a notice only */ }
    try { FEED.forget && FEED.forget(); } catch (e) { /* the feed refreshes within a minute */ }
    return { ok: true };
  }
  /* The family keeps its own profile (Nov 19, 2026 — management: "they should be able to change their profile themselves, and any
     change updates the player's profile"): the parent's name and the numbers on file. The change is written on every player of
     the family, so the coaches' Contact and the player's page show it at once. The front desk is told. */
  if (act === 'name') {
    const name = S.clean(body.name, 80); if (!name || name.length < 2) throw S.err(400, 'name', 'What is your name?');
    for (const p of players) { const c = await contactOf(db, p.id); const patch = {};
      if (!low(c.email) || low(c.email) === who.email) patch.guardian = name;
      else { const logins = (Array.isArray(c.logins) ? c.logins : []).map((l) => (low(l.email) === who.email ? Object.assign({}, l, { name }) : l)); patch.logins = logins; }
      await db.doc(`players/${p.id}/private/contact`).set(Object.assign(patch, { updatedAt: Date.now() }), { merge: true }); }
    try { await NOTIFY.slack(db, 'desk', `*A family changed the name on its account* — ${players.map((p) => p.name).join(', ')}`, [`Now: ${name}`, `Changed by the family (${who.email}) in the client account.`]); } catch (e) { /* a notice only */ }
    try { FEED.forget && FEED.forget(); } catch (e) { /* refreshes within a minute */ }
    return { ok: true };
  }
  if (act === 'phone-change') {
    const t = tail4(body.tail); let digits = String(body.phone || '').replace(/\D+/g, ''); if (digits.length === 10) digits = '1' + digits;
    if (!t) throw S.err(400, 'phone', 'Which number?');
    if (digits.length < 11 || digits.length > 15) throw S.err(400, 'phone', 'That does not look like a mobile number. Include the area code.');
    const next = '+' + digits; let n = 0;
    for (const p of players) { const c = await contactOf(db, p.id); const patch = {};
      if (tail4(c.phone) === t) patch.phone = next; else if (tail4(c.phone2) === t) patch.phone2 = next;
      else if ((Array.isArray(c.extra) ? c.extra : []).some((x) => tail4(x.phone) === t)) patch.extra = c.extra.map((x) => (tail4(x.phone) === t ? Object.assign({}, x, { phone: next, by: who.email, at: Date.now() }) : x));
      if (Object.keys(patch).length) { n++; await db.doc(`players/${p.id}/private/contact`).set(Object.assign(patch, { updatedAt: Date.now() }), { merge: true }); } }
    if (!n) throw S.err(404, 'phone', 'That number is not on this account.');
    let told = false; try { told = await NOTIFY.text(db, next, `This number is now on file for ${short} at ProWorld Academy. The coaches may text you about training. Reply STOP if you do not want these texts.`); } catch (e) { told = false; }
    try { await NOTIFY.slack(db, 'desk', `*A family changed a phone number on its account* — ${players.map((p) => p.name).join(', ')}`, [`The number ending ${t} is now one ending ${digits.slice(-4)}.`, `Changed by the family (${who.email}) in the client account. The coaches' Contact uses the new number.`]); } catch (e) { /* a notice only */ }
    try { FEED.forget && FEED.forget(); } catch (e) { /* refreshes within a minute */ }
    return { ok: true, told };
  }
  if (act === 'phone-remove') {
    const t = tail4(body.tail); if (!t) throw S.err(400, 'phone', 'Which number?');
    let n = 0; for (const p of players) { const c = await contactOf(db, p.id); const extra = Array.isArray(c.extra) ? c.extra : []; const keep = extra.filter((e) => tail4(e.phone) !== t); if (keep.length !== extra.length) { n++; await db.doc(`players/${p.id}/private/contact`).set({ extra: keep, updatedAt: Date.now() }, { merge: true }); } }
    if (!n) throw S.err(400, 'fixed', 'That number is the one on file with the academy. Write to Admin to change it.');
    return { ok: true };
  }
  throw S.err(400, 'action', 'Unknown action.');
}

/* ── renewing here (Nov 18, 2026 — management: "now that we have the clients in the programs they're in, we renew them through our
   app… December 1st") ──
   A player brought over from Play by Point with no plan here yet gets a "Renew" card: the program and the days-a-week plan read
   from Play by Point, the days the child is booked on, billing from the next 1st. A plan our catalog does not sell online (one
   day a week, four days, a pack of sessions, a drop-in) says so, and the card sends the parent to Admin. */
function renewOf(p, today) {
  const en = p.enroll || {}; if (!en.pbp || en.subscription) return null;
  const nm = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const prog = CAT.PROGRAMS.find((x) => nm(x.name) === nm(en.programName));
  const plan = String(en.pbp.plan || ''); const first = CAL.parts(today); const start = `${first.m === 11 ? first.y + 1 : first.y}-${String(first.m === 11 ? 1 : first.m + 2).padStart(2, '0')}-01`;
  const month = CAL.MONTHS_LONG[first.m === 11 ? 0 : first.m + 1];
  const base = { month, start, programName: en.programName || '', planName: plan };
  if (!prog || en.pbp.bySession) return Object.assign(base, { online: false });
  let pick = null;
  if (prog.id === 'fulltime') pick = /intensive/i.test(plan) ? 'intensive' : /core/i.test(plan) && /month/i.test(plan) ? 'core' : null;
  else { const m = plan.match(/(\d)\s*days?/i); const n = m ? Number(m[1]) : 0; const pl = (prog.plans || []).find((x) => !x.every && Number(x.days) === n); pick = pl ? pl.id : null; }
  const pl = pick ? CAT.plan(prog.id, pick) : null;
  if (!pl) return Object.assign(base, { online: false });
  const days = trainDays(p); const fit = days.length === Number(pl.days) || Number(pl.days) >= (prog.days || []).length;
  return Object.assign(base, { online: true, program: prog.id, plan: pl.id, monthly: pl.monthly || null, days: fit ? (Number(pl.days) >= (prog.days || []).length ? prog.days : days) : [] });
}

/* ── the whole picture for one signed-in parent ── */
async function me(db, stripe, who, opts) {
  opts = opts || {};
  const today = opts.today || CAL.todayET();
  const { players, customers } = await findPlayers(db, stripe, who.email);
  const att = await attendance(db, players, today);
  /* the privates booked for these players, from today on (Nov 19, 2026): the calendar marks them, the schedule lists them */
  const tp = CAL.parts(today); const monthEnd = CAL.addDays(`${tp.m === 11 ? tp.y + 1 : tp.y}-${String(((tp.m + 1) % 12) + 1).padStart(2, '0')}-01`, -1);   // the last day a make-up of this month can be used
  let privates = [];
  try { const st = (await db.doc('backend/state').get()); const list = st.exists ? ((st.data() || {}).privates || []) : []; const mine = new Set(players.map((p) => p.id));
    const hm = (v) => { const h = Math.floor(Number(v)); const m = Math.round((Number(v) - h) * 60); return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
    privates = (Array.isArray(list) ? list : []).filter((x) => x && mine.has(x.pid) && isDate(x.date) && x.date >= today).map((x) => ({ pid: x.pid, date: x.date, start: Number(x.start), time: Number.isFinite(Number(x.start)) ? hm(x.start) : '', coach: firstName(x.coach) })).sort((a, b) => CAL.cmp(a.date, b.date)); } catch (e) { privates = []; }
  const out = [];
  try { const own = await require('./coachcal').familyList(db, players.map((p) => p.id), today); own.forEach((o) => { if (!privates.some((x) => x.pid === o.pid && x.date === o.date && x.start === o.start)) privates.push(o); }); } catch (e) { /* the desk's privates still show */ }
  const closed = []; for (let d = today, i = 0; i <= AHEAD; i++, d = CAL.addDays(d, 1)) { const w = CAL.dow(d); if (w && w < 6 && !isOpen(d)) closed.push(d); }   // weekdays with no training (a break): the calendar greys them
  for (const p of players) {
    const en = p.enroll || {};
    const prog = en.program ? CAT.program(en.program) : null;
    const dz = await daysOf(db, p.id, today);
    out.push({
      id: p.id, name: p.name, shortName: ROSTER.shortName(p.name), group: p.group || '', groupLabel: ROSTER.GROUP_LABEL[p.group] || (p.sport === 'soccer' ? 'Soccer' : p.sport === 'fitness' ? 'Fitness' : ''),
      coach: firstName(p.coach), coach2: firstName(p.coach2), coaches: coachesOf(p).map((c) => ({ key: c.key, name: c.name })), status: p.status || 'active', source: p.source || '',
      renew: renewOf(p, today),
      enroll: en.program || en.subscription || en.programName || (Array.isArray(en.days) && en.days.length) ? {   // a player brought over from Play by Point has days and a program name, no plan here yet
        program: en.program || '', time: (en.pbp && en.pbp.time) || en.time || '', programName: en.programName || (prog ? prog.name : ''), programShort: en.programShort || (prog ? prog.short : ''), plan: en.plan || '', planLabel: en.planLabel || '', days: Array.isArray(en.days) ? en.days : [], start: en.start || '', monthly: en.monthly || null, status: en.status || '', hold: !!en.hold, holdReason: en.holdReason || '', endsOn: en.endsOn || null, next: en.next || null, subscription: en.subscription || '' } : null,
      purchases: (Array.isArray(p.purchases) ? p.purchases : []).slice(-10).reverse().map((x) => ({ at: x.at, label: x.label, cents: x.cents, kind: x.kind, sessions: x.sessions || 0, hours: x.hours || 0 })),
      attendance: att[p.id],
      flex: isFlex(p), sessions: menuOf(p), people: await peopleOf(db, p.id),
      days: dz, makeupsLeft: makeupsLeft(dz, att[p.id] && att[p.id].missed, today.slice(0, 7)), makeupsUntil: monthEnd, privates: privates.filter((x) => x.pid === p.id).map((x) => ({ date: x.date, time: x.time, coach: x.coach, id: x.own ? x.id : '', kind: x.kind || '' })).sort((a, b) => String(a.date).localeCompare(String(b.date))), openDays: openDays(p), closed,
      reports: await reports(db, p.id)
    });
  }
  const bill = await billing(stripe, customers, today);
  let requests = [];
  try { requests = (await db.collection('familyRequests').where('email', '==', who.email).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 10).map((r) => ({ id: r.id, kind: r.kind, kindLabel: REQUEST_KINDS[r.kind] || r.kind, player: r.playerName || '', playerId: r.player || '', text: r.text, when: r.when || '', at: r.at, state: r.state || 'open', reply: r.reply || '' })); } catch (e) { requests = []; }
  let news = []; try { news = await require('./news').forFamily(db, players.map((p) => p.group), today); } catch (e) { news = []; }
  return { news, camps: CAT.campsComing ? CAT.campsComing(today) : [], account: await accountOf(db, who, players, customers), ways: await waysOf(db, players), today, email: who.email, name: who.name || (bill.customers[0] && bill.customers[0].name) || '', players: out, billing: bill, requests, frontDesk: NOTIFY.FRONT_DESK, enrollUrl: ROSTER.SITE + '/enroll', known: out.length > 0 || bill.customers.length > 0 };
}

/* ── the family's Stripe account page (card, invoices, receipts) ── */
async function portal(stripe, who, db) {
  const { customers, players } = await findPlayers(db, stripe, who.email);
  let c = customers[0];
  /* Nov 19, 2026: a family brought over from Play by Point has no payment account here yet. Saving a card makes one (a name and
     an e-mail at Stripe; nothing is charged), so the card is there when the family renews. */
  if (!c && stripe && players.length) { const made = await S.findOrCreateCustomer(stripe, { email: who.email, name: who.name || '', by: 'client-account' }); c = made && { id: made.id }; }
  if (!c) throw S.err(404, 'customer', 'We do not have a payment account under this e-mail yet. Enroll a player first, or text the front desk at ' + NOTIFY.FRONT_DESK + '.');
  return { url: await S.portalUrl(stripe, c.id, ROSTER.SITE + '/family') };
}

/* ── a request to the front desk: filed, and posted to the desk channel ── */
async function request(db, who, body, players) {
  const kind = REQUEST_KINDS[body.kind] ? body.kind : 'message';
  const text = S.clean(body.text, 600);
  if (!text) throw S.err(400, 'text', 'Tell us what you need.');
  const when = S.clean(body.when, 80);
  const pid = S.clean(body.player, 60);
  const p = (players || []).find((x) => x.id === pid) || null;
  const doc = { email: who.email, name: S.clean(body.name, 80) || who.name || '', phone: S.clean(body.phone, 30), kind, player: p ? p.id : '', playerName: p ? p.name : '', text, when, at: Date.now(), state: 'open', source: 'family' };
  const ref = await db.collection('familyRequests').add(doc);
  const lines = [`*Family request — ${REQUEST_KINDS[kind]}*${p ? ' — ' + p.name : ''}`, `From ${doc.name || who.email}${doc.phone ? ' · ' + doc.phone : ''} · ${who.email}`, when ? `When: ${when}` : '', text, `Reply from the backend (Front desk → Family requests) or by text.`].filter(Boolean);
  await NOTIFY.slack(db, 'desk', lines[0], lines.slice(1));
  return { ok: true, id: ref.id, kind, kindLabel: REQUEST_KINDS[kind] };
}

module.exports = { account, accountOf, people, SESSION_MENU, requireFamily, findPlayers, attendance, reports, reportOf, billing, me, portal, request, days, daysOf, makeupsLeft, chat, message, coachesOf, REQUEST_KINDS, TITLES };
