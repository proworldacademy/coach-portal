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
async function view(db) { const b = await get(db, true); return { notes: b.notes, learned: b.learned, open: b.open, at: b.at, max: MAX_NOTES }; }

module.exports = { get, text, catalog, wonder, admin, view, POLICIES, _reset: () => { cache = { at: 0, data: null }; } };
