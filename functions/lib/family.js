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
const REQUEST_KINDS = { court: 'Court reservation', private: 'Private lesson', change: 'Plan change', message: 'Message' };

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
const TITLES = { quarterly_hp: 'Quarterly Player Assessment', quarterly: 'Quarterly Player Assessment', quarterly_u: 'Under 12 Player Assessment', monthly: 'Monthly Player Report', camp_snapshot: 'Camp Week Snapshot', camp_performance: 'Camp Performance Report', u10: 'Under 10 Player Progress Update' };
const NOTE_FIELDS = [
  ['strengths', 'Key strengths', ['p_strengths', 'ob_strengths']],
  ['tennis', 'Tennis', ['tennis_overall']],
  ['fitness', 'Fitness', ['fitness_overall']],
  ['mental', 'Mental performance', ['mental_overall']],
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

/* ── the whole picture for one signed-in parent ── */
async function me(db, stripe, who, opts) {
  opts = opts || {};
  const today = opts.today || CAL.todayET();
  const { players, customers } = await findPlayers(db, stripe, who.email);
  const att = await attendance(db, players, today);
  const out = [];
  for (const p of players) {
    const en = p.enroll || {};
    const prog = en.program ? CAT.program(en.program) : null;
    out.push({
      id: p.id, name: p.name, shortName: ROSTER.shortName(p.name), group: p.group || '', groupLabel: ROSTER.GROUP_LABEL[p.group] || (p.sport === 'soccer' ? 'Soccer' : p.sport === 'fitness' ? 'Fitness' : ''),
      coach: firstName(p.coach), coach2: firstName(p.coach2), status: p.status || 'active', source: p.source || '',
      enroll: en.program || en.subscription ? { program: en.program || '', programName: en.programName || (prog ? prog.name : ''), programShort: en.programShort || (prog ? prog.short : ''), plan: en.plan || '', planLabel: en.planLabel || '', days: Array.isArray(en.days) ? en.days : [], start: en.start || '', monthly: en.monthly || null, status: en.status || '', hold: !!en.hold, holdReason: en.holdReason || '', endsOn: en.endsOn || null, next: en.next || null, subscription: en.subscription || '' } : null,
      purchases: (Array.isArray(p.purchases) ? p.purchases : []).slice(-10).reverse().map((x) => ({ at: x.at, label: x.label, cents: x.cents, kind: x.kind, sessions: x.sessions || 0, hours: x.hours || 0 })),
      attendance: att[p.id],
      reports: await reports(db, p.id)
    });
  }
  const bill = await billing(stripe, customers, today);
  let requests = [];
  try { requests = (await db.collection('familyRequests').where('email', '==', who.email).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 10).map((r) => ({ id: r.id, kind: r.kind, kindLabel: REQUEST_KINDS[r.kind] || r.kind, player: r.playerName || '', text: r.text, when: r.when || '', at: r.at, state: r.state || 'open', reply: r.reply || '' })); } catch (e) { requests = []; }
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

module.exports = { requireFamily, findPlayers, attendance, reports, reportOf, billing, me, portal, request, REQUEST_KINDS, TITLES };
