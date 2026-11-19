/* The coach's calendar (Antonio, Nov 19, 2026): "each coach has a calendar… it shows what academy hours they are doing and what
   their available spots are for privates… working hours 7 am to 7 pm… if I am a client and I click on the day, I book a private,
   I pick Nico, I see all his available slots."

   What a coach's day is made of:
   · academy hours — worked out from the players on their name: each player's training days and session time (the Play by Point
     time on the record, "04:00 PM-06:30 PM"), put together. No hand-typed timetable; it follows the roster.
   · privates — the ones booked on the backend (backend/state.privates) and the ones a family booked here (familyPrivates/<id>).
   · time off — what the coach (or a director) blocked: coachCal/<key>.off = [{ date, start, end }].
   · working hours — 7 to 19 every day unless coachCal/<key>.hours = { from, to } says otherwise.
   An open slot = inside the working hours, in the future, and touching none of the above. Half-hour starts.

   A family books a slot → familyPrivates/<id> { player, playerName, coach, key, kind, date, start, dur, email, status:'booked' }.
   The slot leaves the coach's calendar at once, the coach and the front desk hear it, and the front desk puts it on a court and
   on the books from the Privates tab (the rate and the charge stay with the academy; nothing is charged from here). */
'use strict';
const S = require('./stripe');
const CAL = require('./calendar');

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const first = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const DOW3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const OPEN = 7, CLOSE = 19;                       // the working day, until a coach sets their own
const KINDS = { tennis: 'Tennis private', fitness: 'Fitness private', mental: 'Mental private' };
/* Who gives what besides tennis, until the team list carries it (settings/coachCal { fitness:[names], mental:[names], hide:[names] } overrides). */
const DEFAULTS = { fitness: ['Tara'], mental: ['Toño'], hide: ['Sebastien', 'Paolo'] };
/* The names on the players are first names or nicknames; the backend's privates carry full names. */
const ALIAS = { et: ['etienne', 'pierreetienne', 'pierre'], mauri: ['mauricio'], tono: ['tonio', 'antoniofernandez'], kamryn: ['kam'], quinnton: ['quinton'] };
const sameCoach = (key, name) => { const f = fold(first(name)); const k = fold(key); if (!f || !k) return false; return f === k || (ALIAS[k] || []).includes(f) || Object.keys(ALIAS).some((a) => a === f && (ALIAS[a] || []).includes(k)); };

function fmtT(h) { const H = Math.floor(h), M = Math.round((h - H) * 60); const hh = ((H + 11) % 12) + 1; return hh + ':' + String(M).padStart(2, '0') + ' ' + (H >= 12 ? 'PM' : 'AM'); }
/* "04:00 PM-06:30 PM, 07:45 AM-09:45 AM" → [[16, 18.5], [7.75, 9.75]] */
function ranges(text) {
  const out = []; const re = /(\d{1,2}):(\d{2})\s*([AP]M)\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)/gi; let m;
  const h = (hh, mm, ap) => { let x = Number(hh) % 12; if (/pm/i.test(ap)) x += 12; return x + Number(mm) / 60; };
  while ((m = re.exec(String(text || '')))) { const a = h(m[1], m[2], m[3]), b = h(m[4], m[5], m[6]); if (b > a) out.push([a, b]); }
  return out;
}
const merge = (list) => { const s = list.slice().sort((a, b) => a[0] - b[0]); const out = []; for (const r of s) { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); } return out; };

/* The roster, read once every few minutes per engine instance: 1,200 records are not read for every tap on a day. */
let ROSTER = null; let CLOCK = () => Date.now();
async function roster(db) {
  if (ROSTER && CLOCK() - ROSTER.at < 5 * 60 * 1000) return ROSTER.list;
  const snap = await db.collection('players').get();
  const list = snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((p) => !p.status || p.status === 'active');
  ROSTER = { at: CLOCK(), list }; return list;
}
async function config(db) { try { const s = await db.doc('settings/coachCal').get(); return Object.assign({}, DEFAULTS, s.exists ? (s.data() || {}) : {}); } catch (e) { return DEFAULTS; } }

/* The academy hours of one coach: { mon: [[16, 18.5]], … } from the players on their name. A player with no days on file counts Monday to Friday. */
function academyHours(players, key) {
  const by = {}; DOW3.forEach((d) => { by[d] = []; });
  for (const p of players) {
    if (![p.coach, p.coach2, p.coach3].some((c) => c && sameCoach(key, c))) continue;
    const en = p.enroll || {}; const rs = ranges((en.pbp && en.pbp.time) || en.time || ''); if (!rs.length) continue;
    let days = (Array.isArray(en.days) ? en.days : []).map((d) => String(d).slice(0, 3).toLowerCase()).filter((d) => DOW3.includes(d));
    if (!days.length) days = ['mon', 'tue', 'wed', 'thu', 'fri'];
    days.forEach((d) => rs.forEach((r) => by[d].push(r)));
  }
  DOW3.forEach((d) => { by[d] = merge(by[d]); });
  return by;
}
/* Every coach a family can book, by kind. Tennis: the names on the active players, less the fitness and mental names and anyone hidden. */
async function coaches(db, kind) {
  const cfg = await config(db); const hide = (cfg.hide || []).map(fold);
  if (kind === 'fitness' || kind === 'mental') return (cfg[kind] || []).map((n) => ({ key: fold(n), name: n }));
  const players = await roster(db); const seen = new Map(); const not = (cfg.fitness || []).map(fold);
  for (const p of players) for (const c of [p.coach, p.coach2, p.coach3]) { const n = first(c); const k = fold(n); if (!k || hide.includes(k) || not.includes(k)) continue; if (!seen.has(k)) seen.set(k, { key: k, name: n, n: 0 }); seen.get(k).n++; }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ key: c.key, name: c.name }));
}
async function calDoc(db, key) { try { const s = await db.doc('coachCal/' + key).get(); return s.exists ? (s.data() || {}) : {}; } catch (e) { return {}; } }
/* The privates on a coach's name between two dates, from both places; the same lesson is counted once. */
async function privatesOf(db, key, from, to) {
  const out = [];
  try { const st = await db.doc('backend/state').get(); const list = st.exists ? ((st.data() || {}).privates || []) : [];
    (Array.isArray(list) ? list : []).forEach((x) => { if (x && isDate(x.date) && x.date >= from && x.date <= to && sameCoach(key, x.coach)) out.push({ id: x.id || '', date: x.date, start: Number(x.start), dur: Number(x.dur) || 1, pid: x.pid || '', src: 'desk' }); }); } catch (e) { /* the page's record is unreadable: the family ones still count */ }
  try { const snap = await db.collection('familyPrivates').where('key', '==', key).get();
    snap.docs.forEach((d) => { const x = d.data() || {}; if (x.status === 'canceled' || !isDate(x.date) || x.date < from || x.date > to) return; const start = Number(x.start), dur = (Number(x.dur) || 60) / 60;
      if (out.some((o) => o.date === x.date && o.start === start)) return;   // already put on a court by the front desk
      out.push({ id: d.id, date: x.date, start, dur, pid: x.player || '', playerName: x.playerName || '', kind: x.kind || 'tennis', src: 'family', status: x.status || 'booked' }); }); } catch (e) { /* none yet */ }
  return out.sort((a, b) => (a.date + String(a.start).padStart(5, '0')).localeCompare(b.date + String(b.start).padStart(5, '0')));
}
function nowET(now) { const d = now ? new Date(now) : new Date(CLOCK()); const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }); const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value])); return { date: CAL.todayET(d), h: Number(p.hour) + Number(p.minute) / 60 }; }

/* One day of one coach: the pieces and the open starts for a lesson of `durMin`. Pure once the data is in hand (tested). */
function dayOf({ date, academy, privates, cal, durMin, now }) {
  const w = DOW3[CAL.dow(date)]; const hours = cal && cal.hours ? cal.hours : {}; const from = Number.isFinite(Number(hours.from)) ? Number(hours.from) : OPEN, to = Number.isFinite(Number(hours.to)) ? Number(hours.to) : CLOSE;
  const busy = [];
  (academy[w] || []).forEach((r) => busy.push({ a: r[0], b: r[1], what: 'academy' }));
  (privates || []).filter((x) => x.date === date).forEach((x) => busy.push({ a: x.start, b: x.start + x.dur, what: 'private', id: x.id, src: x.src, pid: x.pid, playerName: x.playerName || '', kind: x.kind || '' }));
  ((cal && cal.off) || []).filter((o) => o && o.date === date).forEach((o) => busy.push({ a: Number(o.start), b: Number(o.end), what: 'off' }));
  const dur = (Number(durMin) || 60) / 60; const slots = [];
  for (let h = from; h + dur <= to + 1e-9; h += 0.5) {
    if (now && (date < now.date || (date === now.date && h <= now.h + 1))) continue;        // not in the past, and not inside the next hour
    if (busy.some((x) => h < x.b - 1e-9 && h + dur > x.a + 1e-9)) continue;
    slots.push({ start: h, label: fmtT(h) });
  }
  return { date, from, to, busy: busy.sort((x, y) => x.a - y.a), slots };
}
async function slotsFor(db, key, date, durMin) {
  const [players, cal, pv] = await Promise.all([roster(db), calDoc(db, key), privatesOf(db, key, date, date)]);
  return dayOf({ date, academy: academyHours(players, key), privates: pv, cal, durMin, now: nowET() });
}

/* ── the family's side ── */
const AHEAD_DAYS = 370;
async function familySlots(db, who, body, players) {
  const kind = KINDS[body.kind] ? body.kind : 'tennis'; const date = String(body.date || ''); const p = (players || []).find((x) => x.id === S.clean(body.player, 60));
  if (!p) throw S.err(404, 'player', 'Which player?');
  const today = CAL.todayET(); if (!isDate(date) || date < today || date > CAL.addDays(today, AHEAD_DAYS)) throw S.err(400, 'date', 'Pick a day from today on.');
  const list = await coaches(db, kind); const mine = [p.coach, p.coach2, p.coach3].map((c) => fold(first(c))).filter(Boolean);
  const cs = list.map((c) => Object.assign({ mine: mine.includes(c.key) }, c)).sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
  const key = fold(body.coach); const dur = [30, 60, 90].includes(Number(body.dur)) ? Number(body.dur) : 60;
  if (!key) return { kind, kindLabel: KINDS[kind], date, coaches: cs, coach: '', slots: [] };
  const c = cs.find((x) => x.key === key); if (!c) throw S.err(404, 'coach', 'That coach does not give this lesson.');
  const day = await slotsFor(db, key, date, dur);
  return { kind, kindLabel: KINDS[kind], date, coaches: cs, coach: key, coachName: c.name, dur, slots: day.slots };
}
async function familyBook(db, who, body, players, deps) {
  const kind = KINDS[body.kind] ? body.kind : 'tennis'; const date = String(body.date || ''); const start = Number(body.start); const dur = [30, 60, 90].includes(Number(body.dur)) ? Number(body.dur) : 60;
  const p = (players || []).find((x) => x.id === S.clean(body.player, 60)); if (!p) throw S.err(404, 'player', 'Which player?');
  const key = fold(body.coach); const list = await coaches(db, kind); const c = list.find((x) => x.key === key); if (!c) throw S.err(404, 'coach', 'Pick a coach.');
  if (!isDate(date) || !Number.isFinite(start)) throw S.err(400, 'slot', 'Pick a time.');
  const id = `${key}_${date}_${String(Math.round(start * 100)).padStart(4, '0')}`; const ref = db.doc('familyPrivates/' + id);
  const day = await slotsFor(db, key, date, dur);
  if (!day.slots.some((s) => Math.abs(s.start - start) < 1e-9)) throw S.err(409, 'taken', 'That time was just taken. Pick another one.');
  const rec = { player: p.id, playerName: p.name || '', coach: c.name, key, kind, date, start, dur, email: who.email, by: who.name || who.email, status: 'booked', at: CLOCK() };
  // the id is the slot itself: two families tapping the same time cannot both get it
  try { await ref.create(rec); } catch (e) { const was = await ref.get(); if (was.exists && (was.data() || {}).status !== 'canceled') throw S.err(409, 'taken', 'That time was just taken. Pick another one.'); await ref.set(rec); }
  const when = `${new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${fmtT(start)}`;
  const line = `${KINDS[kind]} booked by the family: ${p.name} with ${c.name}, ${when} (${dur} min).`;
  try { if (deps && deps.tellCoach) await deps.tellCoach(c.name, `New private: ${p.name}, ${when} (${dur} min). Booked by the family in the app. The front desk confirms the court.`); } catch (e) { /* a notice is a nicety */ }
  try { if (deps && deps.tellDesk) await deps.tellDesk(line); } catch (e) { /* same */ }
  return { ok: true, id, coach: c.name, date, start, dur, time: fmtT(start), kindLabel: KINDS[kind] };
}
async function familyCancel(db, who, body, players, deps) {
  const id = S.clean(body.id, 80); const ref = db.doc('familyPrivates/' + id); const snap = await ref.get(); const x = snap.exists ? (snap.data() || {}) : null;
  if (!x || !(players || []).some((p) => p.id === x.player)) throw S.err(404, 'private', 'That private is not on this account.');
  const now = nowET(); const hoursAway = (new Date(x.date + 'T00:00:00Z').getTime() - new Date(now.date + 'T00:00:00Z').getTime()) / 36e5 + x.start - now.h;
  if (hoursAway < 24) throw S.err(400, 'late', 'Inside 24 hours a private is changed with the admin team. Write to Admin in Messages.');
  await ref.set({ status: 'canceled', canceledAt: CLOCK(), canceledBy: who.email }, { merge: true });
  const when = `${x.date} at ${fmtT(x.start)}`;
  try { if (deps && deps.tellCoach) await deps.tellCoach(x.coach, `Private canceled by the family: ${x.playerName}, ${when}.`); } catch (e) { /* nicety */ }
  try { if (deps && deps.tellDesk) await deps.tellDesk(`Private canceled by the family: ${x.playerName} with ${x.coach}, ${when}.`); } catch (e) { /* nicety */ }
  return { ok: true };
}
/* What a family sees of its own bookings: from today on. */
async function familyList(db, playerIds, today) {
  const out = []; const ids = Array.from(new Set(playerIds || [])).slice(0, 10); if (!ids.length) return out;
  try { const snap = await db.collection('familyPrivates').where('player', 'in', ids).get();
    snap.docs.forEach((d) => { const x = d.data() || {}; if (x.status === 'canceled' || !isDate(x.date) || x.date < today) return; out.push({ id: d.id, pid: x.player, date: x.date, start: Number(x.start), time: fmtT(Number(x.start)), coach: first(x.coach), kind: x.kind || 'tennis', dur: x.dur || 60, own: true }); }); } catch (e) { /* none */ }
  return out;
}

/* ── the coach's side: a week of their calendar, and time off ── */
async function week(db, who, body) {
  const all = await coaches(db, 'tennis'); const cfg = await config(db); (cfg.fitness || []).concat(cfg.mental || []).forEach((n) => { const k = fold(n); if (!all.some((c) => c.key === k)) all.push({ key: k, name: n }); });
  const own = (who.keys || []).map(fold).find((k) => all.some((c) => c.key === k || sameCoach(c.key, k))) || fold((who.keys || [])[0] || '');
  const ownKey = (all.find((c) => c.key === own || sameCoach(c.key, own)) || {}).key || own;
  const key = who.director ? (fold(body.coach) || ownKey || (all[0] && all[0].key) || '') : ownKey;
  if (!key) throw S.err(404, 'coach', 'No players are on your name yet, so there is no calendar to show.');
  const today = CAL.todayET(); let from = isDate(body.from) ? body.from : today; from = CAL.addDays(from, -((CAL.dow(from) + 6) % 7));   // the Monday of that week
  const to = CAL.addDays(from, 6);
  const [players, cal, pv] = await Promise.all([roster(db), calDoc(db, key), privatesOf(db, key, from, to)]);
  const academy = academyHours(players, key); const names = new Map(players.map((p) => [p.id, p.name]));
  const days = []; let hAcademy = 0, hPrivate = 0;
  for (let i = 0; i < 7; i++) { const date = CAL.addDays(from, i); const d = dayOf({ date, academy, privates: pv, cal, durMin: 60, now: nowET() });
    d.busy.forEach((b) => { if (b.what === 'academy') hAcademy += b.b - b.a; if (b.what === 'private') hPrivate += b.b - b.a; });
    days.push({ date, hours: [d.from, d.to], items: d.busy.map((b) => ({ what: b.what, a: b.a, b: b.b, time: fmtT(b.a) + ' – ' + fmtT(b.b), who: b.what === 'private' ? (b.playerName || names.get(b.pid) || '') : '', src: b.src || '', kind: b.kind || '' })), open: d.slots.length, openTimes: d.slots.map((s) => s.label) }); }
  const name = (all.find((c) => c.key === key) || {}).name || key;
  return { coach: key, coachName: name, coaches: who.director ? all : [], from, to, today, days, totals: { academy: Math.round(hAcademy * 100) / 100, privates: Math.round(hPrivate * 100) / 100 }, canEdit: who.director || key === ownKey };
}
async function setOff(db, who, body) {
  const all = await coaches(db, 'tennis'); const ownKey = (all.find((c) => (who.keys || []).map(fold).some((k) => c.key === k || sameCoach(c.key, k))) || {}).key || fold((who.keys || [])[0] || '');
  const key = who.director && body.coach ? fold(body.coach) : ownKey; if (!key) throw S.err(404, 'coach', 'Which coach?');
  const date = String(body.date || ''); const start = Number(body.start), end = Number(body.end);
  if (!isDate(date) || date < CAL.todayET()) throw S.err(400, 'date', 'Pick a day from today on.');
  const ref = db.doc('coachCal/' + key); const cal = await calDoc(db, key); let off = (Array.isArray(cal.off) ? cal.off : []).filter((o) => o && isDate(o.date) && o.date >= CAL.addDays(CAL.todayET(), -7));
  if (body.remove) off = off.filter((o) => !(o.date === date && Number(o.start) === start));
  else { if (!(end > start) || start < 0 || end > 24) throw S.err(400, 'time', 'The end is before the start.'); off.push({ date, start, end, by: who.email, at: CLOCK() }); }
  await ref.set({ off, updatedAt: CLOCK(), updatedBy: who.email }, { merge: true });
  return { ok: true, off: off.length };
}
/* The front desk's list: what families booked and is not on a court yet. */
async function deskList(db) {
  const today = CAL.todayET(); const out = [];
  try { const snap = await db.collection('familyPrivates').where('date', '>=', today).get();
    snap.docs.forEach((d) => { const x = d.data() || {}; if (x.status === 'canceled') return; out.push({ id: d.id, player: x.player, playerName: x.playerName, coach: x.coach, kind: x.kind, kindLabel: KINDS[x.kind] || 'Private', date: x.date, start: Number(x.start), dur: x.dur || 60, time: fmtT(Number(x.start)), status: x.status || 'booked', by: x.by || '' }); }); } catch (e) { /* none */ }
  return { list: out.sort((a, b) => (a.date + String(a.start).padStart(5, '0')).localeCompare(b.date + String(b.start).padStart(5, '0'))) };
}
async function deskMark(db, who, body) { const id = S.clean(body.id, 80); const ref = db.doc('familyPrivates/' + id); const s = await ref.get(); if (!s.exists) throw S.err(404, 'private', 'Not found.'); const st = body.status === 'canceled' ? 'canceled' : 'confirmed'; await ref.set({ status: st, markedBy: who.email, markedAt: CLOCK() }, { merge: true }); return { ok: true, status: st }; }

module.exports = { KINDS, ranges, merge, academyHours, dayOf, sameCoach, fmtT, coaches, slotsFor, familySlots, familyBook, familyCancel, familyList, week, setOff, deskList, deskMark,
  _clock: (f) => { CLOCK = f || (() => Date.now()); ROSTER = null; }, _reset: () => { ROSTER = null; } };
