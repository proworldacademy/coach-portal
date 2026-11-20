/* The courts, and who holds them (Antonio, Nov 19, 2026): "that schedule is absolutely everything for us… it has to be always
   in sync… if a parent books a private, they need to see the schedule of the coach, and it needs a court."

   The campus, as he gave it:
   · hard: the Stadium court (on its own) and courts 1 to 12, in banks 1–4, 5–7 and 8–12
   · clay: courts 13 and 14 (one bank) and court 15 (the clay court the size of the Stadium, on its own)
   · coming: two more hard courts in the back, 16 and 17, and a third soccer field. They are listed here and marked `soon`, so
     nothing can be booked on them until the mark comes off.
   · the soccer fields A and B (and C, soon).

   Who holds a court, and the one rule: first come, and nobody is ever bumped. The academy's blocks, the events (a tournament
   blocks its own courts), the rentals and the front desk's privates are what the Courts page keeps (backend/state). What the
   engine itself books (a private taken by a family in the app) is kept here, one record per court per half hour:
       courtHolds/<date>_<court>_<hhmm>  { date, court, h, ref, what, label, coach, player, by, at }
   The id is the half hour itself, and a hold is written in one transaction that also reads the Courts page's record, so the same
   court at the same time cannot be given twice. The Courts page reads these holds and treats them as taken. */
'use strict';
const S = require('./stripe');

const COURTS = [];
const add = (id, name, type, kind, bank, extra) => COURTS.push(Object.assign({ id, name, type, kind, bank }, extra || {}));
for (let i = 1; i <= 4; i++) add(String(i), 'Court ' + i, 'hard', 'tennis', 'h1');
for (let i = 5; i <= 7; i++) add(String(i), 'Court ' + i, 'hard', 'tennis', 'h2');
for (let i = 8; i <= 12; i++) add(String(i), 'Court ' + i, 'hard', 'tennis', 'h3');
add('S', 'Stadium', 'hard', 'tennis', 'stadium');
add('13', 'Court 13', 'clay', 'tennis', 'c1'); add('14', 'Court 14', 'clay', 'tennis', 'c1');
add('15', 'Court 15', 'clay', 'tennis', 'c2');
add('16', 'Court 16', 'hard', 'tennis', 'h4', { soon: true }); add('17', 'Court 17', 'hard', 'tennis', 'h4', { soon: true });
add('A', 'Field A', 'field', 'soccer', 'f'); add('B', 'Field B', 'field', 'soccer', 'f'); add('C', 'Field C', 'field', 'soccer', 'f', { soon: true });
const OPEN_H = 7, END_H = 21;
const byId = (id) => COURTS.find((c) => c.id === String(id)) || null;
const nameOf = (id) => { const c = byId(id); return c ? c.name : (id ? 'Court ' + id : ''); };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const holdId = (date, court, h) => `${date}_${court}_${String(Math.round(h * 100)).padStart(4, '0')}`;
const halves = (start, durH) => { const out = []; for (let h = start; h < start + durH - 1e-9; h += 0.5) out.push(Math.round(h * 2) / 2); return out; };
const dowOf = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/* The Courts page's own record, read the way the page reads it. */
function blockAt(state, court, date, h) {
  const dow = dowOf(date); const ex = Array.isArray(state.exceptions) ? state.exceptions : [];
  for (const b of (Array.isArray(state.blocks) ? state.blocks : [])) {
    if (!b || !Array.isArray(b.courts) || !b.courts.map(String).includes(court) || !Array.isArray(b.dows) || !b.dows.includes(dow) || h < Number(b.start) || h >= Number(b.end)) continue;
    if (b.from && date < b.from) continue; if (b.until && date > b.until) continue;
    if (ex.some((x) => x && String(x.court) === court && x.date === date && Number(x.h) === h)) continue;
    return b;
  }
  return null;
}
function bookingAt(state, court, date, h) { return (Array.isArray(state.bookings) ? state.bookings : []).find((b) => b && String(b.court) === court && b.date === date && h >= Number(b.start) && h < Number(b.start) + Number(b.dur)) || null; }
/* Is this court free for the whole run? `holds` = the set of "court|h" already held on that day. */
function isFree(state, holds, court, date, start, durH) {
  for (const h of halves(start, durH)) { if (h < OPEN_H || h >= END_H || blockAt(state, court, date, h) || bookingAt(state, court, date, h) || holds.has(court + '|' + h)) return false; }
  return true;
}
function freeCourts(state, holds, date, start, durH, kind) { return COURTS.filter((c) => !c.soon && c.kind === (kind || 'tennis') && isFree(state, holds, c.id, date, start, durH)); }

async function pageState(db, t) { const ref = db.doc('backend/state'); const s = t ? await t.get(ref) : await ref.get(); return s.exists ? (s.data() || {}) : {}; }
async function holdsOn(db, date) {
  const out = []; if (!isDate(date)) return out;
  const snap = await db.collection('courtHolds').where('date', '==', date).get();
  snap.docs.forEach((d) => { const x = d.data() || {}; out.push({ id: d.id, court: String(x.court), h: Number(x.h), ref: x.ref || '', what: x.what || 'private', label: x.label || '', coach: x.coach || '', player: x.player || '' }); });
  return out;
}
const setOf = (holds) => new Set(holds.map((x) => x.court + '|' + x.h));
/* The courts free for a lesson: what a family (or anyone booking through the engine) is offered. */
async function free(db, date, start, durMin, kind) {
  if (!isDate(date) || !Number.isFinite(Number(start))) return [];
  const [state, holds] = await Promise.all([pageState(db), holdsOn(db, date)]);
  if (!Array.isArray(state.blocks)) return [];                    // the staff schedule did not load: offer nothing rather than a court that may be taken
  return freeCourts(state, setOf(holds), date, Number(start), (Number(durMin) || 60) / 60, kind).map((c) => ({ id: c.id, name: c.name, type: c.type }));
}
/* Inside a transaction: check the court for the whole run and queue the holds. Throws 409 when any half hour is gone. All the
   reads happen here, before the caller's own writes. */
async function holdIn(t, db, o) {
  const c = byId(o.court); if (!c || c.soon) throw S.err(400, 'court', 'Pick a court.');
  const durH = (Number(o.durMin) || 60) / 60; const hs = halves(Number(o.start), durH); const state = await pageState(db, t);
  if (!Array.isArray(state.blocks)) throw S.err(503, 'schedule', 'The court schedule is not available right now. Please call the front desk.');
  const refs = hs.map((h) => db.doc('courtHolds/' + holdId(o.date, c.id, h))); const snaps = [];
  for (const r of refs) snaps.push(await t.get(r));
  const gone = S.err(409, 'court', 'That court was just taken. Pick another one.');
  hs.forEach((h, i) => { if (h < OPEN_H || h >= END_H || blockAt(state, c.id, o.date, h) || bookingAt(state, c.id, o.date, h) || snaps[i].exists) throw gone; });
  hs.forEach((h, i) => t.set(refs[i], { date: o.date, court: c.id, h, ref: o.ref || '', what: o.what || 'private', label: S.clean(o.label, 80), coach: S.clean(o.coach, 60), player: S.clean(o.player, 80), by: o.by || '', at: Date.now() }));
  return { court: c.id, courtName: c.name, type: c.type };
}
/* Give the court back: every hold made for `ref`. */
async function release(db, ref) {
  if (!ref) return 0; const snap = await db.collection('courtHolds').where('ref', '==', ref).get(); let n = 0;
  for (const d of snap.docs) { await d.ref.delete(); n++; }
  return n;
}
/* For the Courts page: a day's holds, each run as one line. */
async function dayHolds(db, date) {
  const hs = await holdsOn(db, date); const by = new Map();
  hs.forEach((x) => { const k = x.ref + '|' + x.court; if (!by.has(k)) by.set(k, { ref: x.ref, court: x.court, start: x.h, end: x.h + 0.5, what: x.what, label: x.label, coach: x.coach, player: x.player }); const r = by.get(k); r.start = Math.min(r.start, x.h); r.end = Math.max(r.end, x.h + 0.5); });
  return { date, holds: Array.from(by.values()) };
}

module.exports = { COURTS, OPEN_H, END_H, byId, nameOf, holdId, halves, blockAt, bookingAt, isFree, freeCourts, free, holdIn, release, holdsOn, dayHolds };
