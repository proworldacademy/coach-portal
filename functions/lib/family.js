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
  admin: 'Registration and billing' };

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
  if (stripe && stripe.customers && stripe.customers.list) {
    try {
      for await (const c of stripe.customers.list({ email, limit: 20 })) {
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
  return { customers: customers.map((c) => ({ id: c.id, name: c.name, email: c.email, hasCard: !!c.hasCard })), subscriptions, openInvoices };
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
async function daysOf(db, pid, today) {
  let docs = [];
  try { docs = (await db.collection('familyDays').where('player', '==', pid).get()).docs.map((d) => d.data() || {}); } catch (e) { docs = []; }
  const from = CAL.addDays(today, -BACK);
  return docs.filter((d) => isDate(d.date) && d.date >= from && (d.kind === 'away' || d.kind === 'makeup')).map((d) => ({ date: d.date, kind: d.kind })).sort((a, b) => CAL.cmp(a.date, b.date));
}
function makeupsLeft(days, missed) { return Math.max(0, days.filter((d) => d.kind === 'away').length + (missed || 0) - days.filter((d) => d.kind === 'makeup').length); }
const sayDay = (d) => { const p = CAL.parts(d); return `${CAL.MONTHS[p.m].slice(0, 3)} ${p.d}`; };
/* The director of the player's group hears it at once (Nov 17, 2026 — Antonio: "the moment I hit 'she cannot make it', a notification
   goes to the director of the group"): a line from ProWorld in the director's Locker Room, with the push that goes with it. The
   group's director is groups/<id>.director (a name, or several); a group with none on file tells every director. No family
   contact details in the line. */
async function tellDirector(db, p, text) {
  try {
    const CONTACTS = require('./contacts'); const TEAM = require('./team');
    let g = {}; try { const x = await db.doc('groups/' + (p.group || '-')).get(); g = x.exists ? (x.data() || {}) : {}; } catch (e) { g = {}; }
    const staff = await CONTACTS.staffIndex(db); const to = new Set();
    String(g.director || '').split(/,|&|\/|\band\b/i).map((n) => n.trim()).filter(Boolean).forEach((n) => { const st = CONTACTS.staffFor(staff, n); if (st && st.email) to.add(st.email); });
    if (!to.size) { const all = await db.collection('staff').get(); all.docs.forEach((d) => { const x = d.data() || {}; if (x.active !== false && String(x.role || '').toLowerCase() === 'director') to.add(d.id.toLowerCase()); }); }
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
    if (makeupsLeft(have, att[p.id].missed) < 1) throw S.err(400, 'credit', 'A make-up day goes with a day missed. Mark the day away first, or write to Admin.');
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

/* ── the whole picture for one signed-in parent ── */
async function me(db, stripe, who, opts) {
  opts = opts || {};
  const today = opts.today || CAL.todayET();
  const { players, customers } = await findPlayers(db, stripe, who.email);
  const att = await attendance(db, players, today);
  const out = [];
  const closed = []; for (let d = today, i = 0; i <= AHEAD; i++, d = CAL.addDays(d, 1)) { const w = CAL.dow(d); if (w && w < 6 && !isOpen(d)) closed.push(d); }   // weekdays with no training (a break): the calendar greys them
  for (const p of players) {
    const en = p.enroll || {};
    const prog = en.program ? CAT.program(en.program) : null;
    const dz = await daysOf(db, p.id, today);
    out.push({
      id: p.id, name: p.name, shortName: ROSTER.shortName(p.name), group: p.group || '', groupLabel: ROSTER.GROUP_LABEL[p.group] || (p.sport === 'soccer' ? 'Soccer' : p.sport === 'fitness' ? 'Fitness' : ''),
      coach: firstName(p.coach), coach2: firstName(p.coach2), coaches: coachesOf(p).map((c) => ({ key: c.key, name: c.name })), status: p.status || 'active', source: p.source || '',
      enroll: en.program || en.subscription ? { program: en.program || '', programName: en.programName || (prog ? prog.name : ''), programShort: en.programShort || (prog ? prog.short : ''), plan: en.plan || '', planLabel: en.planLabel || '', days: Array.isArray(en.days) ? en.days : [], start: en.start || '', monthly: en.monthly || null, status: en.status || '', hold: !!en.hold, holdReason: en.holdReason || '', endsOn: en.endsOn || null, next: en.next || null, subscription: en.subscription || '' } : null,
      purchases: (Array.isArray(p.purchases) ? p.purchases : []).slice(-10).reverse().map((x) => ({ at: x.at, label: x.label, cents: x.cents, kind: x.kind, sessions: x.sessions || 0, hours: x.hours || 0 })),
      attendance: att[p.id],
      days: dz, makeupsLeft: makeupsLeft(dz, att[p.id] && att[p.id].missed), openDays: openDays(p), closed,
      reports: await reports(db, p.id)
    });
  }
  const bill = await billing(stripe, customers, today);
  let requests = [];
  try { requests = (await db.collection('familyRequests').where('email', '==', who.email).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 10).map((r) => ({ id: r.id, kind: r.kind, kindLabel: REQUEST_KINDS[r.kind] || r.kind, player: r.playerName || '', playerId: r.player || '', text: r.text, when: r.when || '', at: r.at, state: r.state || 'open', reply: r.reply || '' })); } catch (e) { requests = []; }
  return { today, email: who.email, name: who.name || (bill.customers[0] && bill.customers[0].name) || '', players: out, billing: bill, requests, frontDesk: NOTIFY.FRONT_DESK, enrollUrl: ROSTER.SITE + '/enroll', known: out.length > 0 || bill.customers.length > 0 };
}

/* ── the family's Stripe account page (card, invoices, receipts) ── */
async function portal(stripe, who, db) {
  const { customers } = await findPlayers(db, stripe, who.email);
  const c = customers[0];
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

module.exports = { requireFamily, findPlayers, attendance, reports, reportOf, billing, me, portal, request, days, daysOf, makeupsLeft, chat, message, coachesOf, REQUEST_KINDS, TITLES };
