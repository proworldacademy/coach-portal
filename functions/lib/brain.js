/* One brain for every assistant (Nov 21, 2026 — "connect both the AIs… it should be one AI learning everything").

   What the academy's assistants know lives here, once: the client app's "Ask ProWorld" reads it on every question, and the
   website's assistant (the concierge) reads the same text from GET /api/brain with the roster key, the way it reads the roster.

     settings/brain { notes, learned: [{ id, q, a, at, by }], open: [{ id, q, at, n, src }], at, by }   engine and owners only

   · the catalog (programs, camps, prices): lib/catalog.js, never typed twice
   · the policies: POLICIES below
   · notes: what management writes on the Dashboard ("What the AI knows")
   · learned: answers management taught it. A question an assistant could not answer lands in `open` (names taken out); an owner
     types the answer once and from then on every assistant gives it. That is how it learns: nothing it makes up is kept.

   Owners: GET /api/admin/brain, POST /api/admin/brain { action: save | teach | forget, … }.
   The website's assistant: GET /api/brain (X-Roster-Key) → { text, at }, and POST /api/brain/open { q } to hand in what it could not answer. */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');
const CAT = require('./catalog');

const DOC = 'settings/brain';
const MAX_NOTES = 6000, MAX_LEARNED = 80, MAX_OPEN = 40;
const POLICIES = 'A missed session can be made up on another day in the same month; a make-up not used by the end of the month does not carry into the next month; an exception (a week sick, for instance) is decided by Admin, case by case. A private lesson is one hour and is booked at least 24 hours ahead; to change one inside 24 hours, write to Admin. The rate of a private lesson is handled by Admin: never state a price for a private. Academics are not offered. Contact: info@proworldacademy.com, (561) 403-0008, 651 Egret Cir, Delray Beach, FL 33444.';
const clip = (s, n) => String(s == null ? '' : s).replace(/[ \t]+/g, ' ').trim().slice(0, n);
const money = (n) => '$' + Number(n).toLocaleString('en-US');
const id = () => crypto.randomBytes(6).toString('hex');
let cache = { at: 0, data: null };

async function get(db, fresh) {
  if (!fresh && cache.data && Date.now() - cache.at < 60 * 1000) return cache.data;
  let d = {}; try { const s = await db.doc(DOC).get(); d = s.exists ? (s.data() || {}) : {}; } catch (e) { d = {}; }
  const data = { notes: String(d.notes || ''), learned: Array.isArray(d.learned) ? d.learned : [], open: Array.isArray(d.open) ? d.open : [], at: Number(d.at) || 0 };
  cache = { at: Date.now(), data }; return data;
}
const put = async (db, data, who) => { const out = { notes: data.notes, learned: data.learned, open: data.open, at: Date.now(), by: (who && who.email) || 'engine' }; await db.doc(DOC).set(out); cache = { at: 0, data: null }; return out; };

/* the academy's facts, from the catalog the enrollment page sells from */
function catalog(today) {
  const progs = CAT.PROGRAMS.filter((p) => !p.hidden).map((p) => {
    if (p.say) return `· ${p.say}`;   // the academy's own wording for a program whose published plans moved ahead of the billing lines
    const plans = (p.plans || []).filter((x) => x.monthly).map((x) => `${x.label} ${money(x.monthly)} a month`).join('; ');
    const extra = [p.dropin ? `one session ${money(p.dropin.price)}` : '', p.trial ? `${p.trial.label} ${money(p.trial.price)}` : ''].filter(Boolean).join('; ');
    return `· ${String(p.name).split('|')[0].trim()} (${p.ages}; ${p.time}${Array.isArray(p.days) && p.days.length ? '; ' + p.days.join(' ') : ''}): ${[plans, extra].filter(Boolean).join('; ') || 'ask Admin for the plans'}`;
  });
  const camps = [];
  for (const g of CAT.campsComing(today)) for (const cid of g.ids) { const c = CAT.CAMPS.find((x) => x.id === cid); if (c) camps.push(`· [${c.id}] ${c.name} (${c.ages}; ${c.dates}): ${(c.options || []).map((o) => `${o.label} ${money(o.price)}`).join('; ')}`); }
  const court = CAT.COURTS && CAT.COURTS.hard ? `Court rental: ${money(CAT.COURTS.hard.price)} an hour for a family that is not in a program; free for academy families.` : '';
  return { progs, camps, court };
}

/* what every assistant is told, in one text */
function text(b, today) {
  const f = catalog(today); b = b || {};
  return [
    'PROGRAMS AND PRICES:\n' + f.progs.join('\n'),
    f.camps.length ? 'CAMPS COMING UP (the id is in brackets):\n' + f.camps.join('\n') : 'No camp is on sale right now.',
    f.court,
    'POLICIES: ' + POLICIES,
    b.notes ? 'NOTES FROM MANAGEMENT (these win over anything above when they differ):\n' + clip(b.notes, MAX_NOTES) : '',
    (b.learned || []).length ? 'ANSWERS MANAGEMENT TAUGHT (give these when the question matches):\n' + b.learned.slice(0, MAX_LEARNED).map((x) => `· Q: ${clip(x.q, 200)}\n  A: ${clip(x.a, 500)}`).join('\n') : ''
  ].filter(Boolean).join('\n\n');
}

/* a question an assistant could not answer: kept once, counted when it comes back */
async function wonder(db, q, src) {
  q = clip(q, 240); if (q.length < 6) return { ok: false };
  const b = await get(db, true); const key = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); const open = b.open.slice();
  const had = open.find((x) => String(x.q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === key);
  if (had) { had.n = (Number(had.n) || 1) + 1; had.at = Date.now(); } else open.unshift({ id: id(), q, at: Date.now(), n: 1, src: src === 'web' ? 'web' : 'app' });
  await put(db, { notes: b.notes, learned: b.learned, open: open.slice(0, MAX_OPEN) }, null); return { ok: true };
}

async function admin(db, who, body) {
  body = body || {}; const act = S.clean(body.action, 20); const b = await get(db, true);
  if (act === 'save') { const notes = String(body.notes || '').replace(/\r/g, '').trim(); if (notes.length > MAX_NOTES) throw S.err(400, 'long', 'That is too long: keep it under ' + MAX_NOTES + ' characters.'); await put(db, { notes, learned: b.learned, open: b.open }, who); }
  else if (act === 'teach') { const q = clip(body.q, 240), a = clip(body.a, 600); if (!q || !a) throw S.err(400, 'what', 'The question and the answer.');
    const learned = [{ id: id(), q, a, at: Date.now(), by: who.email }].concat(b.learned).slice(0, MAX_LEARNED); await put(db, { notes: b.notes, learned, open: b.open.filter((x) => x.id !== S.clean(body.id, 20)) }, who); }
  else if (act === 'forget') { const k = S.clean(body.id, 20); await put(db, { notes: b.notes, learned: b.learned.filter((x) => x.id !== k), open: b.open.filter((x) => x.id !== k) }, who); }
  else throw S.err(400, 'action', 'Which action?');
  return view(db);
}
/* The weekly review (Nov 22, 2026). What families asked the two assistants in the last seven days, read from assistantLog (the client
   app writes it on every question; the website's assistant hands its questions in through `note`). Names, e-mails and numbers were
   taken out before anything was written. Nothing here is made up by a model: questions are sorted into subjects by their words. */
const TOPICS = [
  ['Prices and billing', /price|cost|how much|fee|\$|pay|bill|invoice|charge|refund|discount|card/i],
  ['Camps', /camp|thanksgiving|winter break|spring break|summer/i],
  ['Private lessons', /private|lesson|1 on 1|one on one/i],
  ['Schedule and days', /schedule|what time|when|hours|days|calendar|session|today|tomorrow|week/i],
  ['Not coming and make-ups', /absen|not coming|can.?t make|cannot make|miss|sick|make.?up|away|travel/i],
  ['Courts', /court|rent|reserve/i],
  ['Programs and signing up', /program|enroll|sign.?up|join|try.?out|trial|level|group|after.?school|full.?time|10 ?(&|and)? ?under/i],
  ['Coaches and reports', /coach|report|assessment|progress|feedback/i]
];
const topicOf = (q) => { for (const t of TOPICS) if (t[1].test(q)) return t[0]; return 'Other'; };
/* a question the website's assistant was asked: logged for the review, never shown to anyone but the owners */
async function note(db, body) {
  const q = clip((body || {}).q, 240); if (q.length < 3) return { ok: false };
  const ch = ['web', 'whatsapp', 'instagram', 'sms', 'messenger'].includes(String((body || {}).channel)) ? String(body.channel) : 'web';
  await db.collection('assistantLog').add({ at: Date.now(), day: require('./calendar').todayET(), q, a: '', action: body.handed === true ? 'request' : '', took: 0, src: 'web', channel: ch }); return { ok: true };
}
async function review(db, now) {
  now = now || Date.now(); const day = 864e5; const from = now - 7 * day, before = from - 7 * day; const rows = [];
  try { (await db.collection('assistantLog').where('at', '>=', before).get()).docs.forEach((d) => { const x = d.data() || {}; if (Number(x.at) <= now) rows.push(x); }); } catch (e) { /* an empty week */ }
  const wk = rows.filter((x) => x.at >= from), prev = rows.filter((x) => x.at < from);
  const by = new Map(); wk.forEach((x) => { const t = topicOf(String(x.q || '')); if (!by.has(t)) by.set(t, { topic: t, n: 0, admin: 0, ex: [] }); const o = by.get(t); o.n++; if (x.action === 'request') o.admin++; if (o.ex.length < 3 && x.q && !o.ex.includes(x.q)) o.ex.push(x.q); });
  const acts = {}; wk.forEach((x) => { if (x.action) acts[x.action] = (acts[x.action] || 0) + 1; });
  const days = {}; wk.forEach((x) => { const k = new Date(x.at).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }); days[k] = (days[k] || 0) + 1; });
  const busiest = Object.keys(days).sort((a, b) => days[b] - days[a])[0] || '';
  const b = await get(db, true); const open = (b.open || []).filter((o) => Number(o.at) >= from);
  const sent = wk.filter((x) => x.action === 'request');
  return { from, to: now, total: wk.length, app: wk.filter((x) => x.src !== 'web').length, web: wk.filter((x) => x.src === 'web').length, before: prev.length,
    toAdmin: sent.length, toAdminEx: sent.slice(-5).reverse().map((x) => x.q).filter(Boolean), booked: (acts.private || 0) + (acts.court || 0) + (acts.camp || 0) + (acts.program || 0), actions: acts,
    topics: Array.from(by.values()).sort((x, y) => y.n - x.n), busiest, unanswered: open.map((o) => ({ q: o.q, n: o.n || 1, src: o.src })), unansweredAll: (b.open || []).length, taught: (b.learned || []).filter((l) => Number(l.at) >= from).length };
}
/* One line for the Monday note to the owners. */
function headline(r) { return `AI review, last 7 days: ${r.total} question${r.total === 1 ? '' : 's'} (${r.app} in the app, ${r.web} on the website and messages), ${r.toAdmin} sent to Admin, ${r.unansweredAll} waiting for an answer from you. Open the Dashboard.`; }
async function view(db) { const b = await get(db, true); return { notes: b.notes, learned: b.learned, open: b.open, at: b.at, max: MAX_NOTES }; }

module.exports = { get, text, catalog, wonder, admin, view, note, review, headline, topicOf, POLICIES, _reset: () => { cache = { at: 0, data: null }; } };
