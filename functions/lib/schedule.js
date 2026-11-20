'use strict';
/* One schedule, the rest of it (Nov 20, 2026). Everything here sits on the two records stage 1 made the truth:
     familyPrivates/<coach>_<date>_<start>   a private, whoever booked it (a family, the coach, a director, an owner)
     courtHolds/<date>_<court>_<hhmm>        one half hour of one court, taken by a private, a rental or the academy plan
   and adds:
     who may touch whose calendar            owners and admins anyone; a director the coaches of their groups; a coach only their own
     timeOff/<coach>_<from>_<to>             a full day or more off: asked for by the coach, decided by an owner
     rentals/<id>                            a court a family reserved in the app
     settings/rain                           the rain notice: who was told, so "the courts are ready" reaches the same people
   Order of who gets a court: the academy plan never moves a private, a rental, a tournament or maintenance; it works around them. */
const S = require('./stripe');
const CAL = require('./calendar');
const CC = require('./coachcal');
const COURTS = require('./courts');
const { fold, first, isDate, fmtT, DOW3 } = CC;

let CLOCK = () => Date.now();
const DOWN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayText = (date) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const each = (from, to) => { const out = []; for (let d = from; d <= to && out.length < 400; d = CAL.addDays(d, 1)) out.push(d); return out; };

/* ── who may touch whose calendar ── */
async function everyCoach(db) {
  const all = await CC.coaches(db, 'tennis'); const cfg = await CC.config(db);
  (cfg.fitness || []).forEach((n) => { const k = fold(n); if (!all.some((c) => c.key === k)) all.push({ key: k, name: n, kind: 'fitness' }); });
  (cfg.mental || []).forEach((n) => { const k = fold(n); if (!all.some((c) => c.key === k)) all.push({ key: k, name: n, kind: 'mental' }); });
  const fit = (cfg.fitness || []).map(fold), men = (cfg.mental || []).map(fold);
  return all.map((c) => Object.assign({ kind: fit.includes(c.key) ? 'fitness' : men.includes(c.key) ? 'mental' : 'tennis' }, c));
}
async function scope(db, who) {
  const all = await everyCoach(db); const keys = (who.keys || []).map(fold);
  const own = (all.find((c) => keys.some((k) => c.key === k || CC.sameCoach(c.key, k))) || {}).key || keys[0] || '';
  if (who.owner || who.admin) return { level: who.owner ? 'owner' : 'admin', own, all, keys: all.map((c) => c.key) };
  const mine = new Set(own ? [own] : []);
  if (who.director) {
    try { const snap = await db.collection('groups').get(); const me = String(who.email || '').toLowerCase();
      snap.docs.forEach((d) => { const g = d.data() || {}; if (!(Array.isArray(g.directors) ? g.directors : []).some((e) => String(e).toLowerCase() === me)) return;
        (Array.isArray(g.coaches) ? g.coaches : []).forEach((n) => { const c = all.find((x) => CC.sameCoach(x.key, n)); if (c) mine.add(c.key); }); }); } catch (e) { /* no groups yet: their own calendar only */ }
  }
  return { level: who.director && mine.size > 1 ? 'director' : 'coach', own, all, keys: Array.from(mine) };
}
/* The coach a request is about: the one asked for when it is in reach, otherwise the person's own. */
function pick(sc, asked) { const k = fold(asked); if (k && sc.keys.includes(k)) return k; if (k && k !== sc.own) throw S.err(403, 'coach', 'That calendar is not yours to change.'); if (!sc.own) throw S.err(404, 'coach', 'No players are on your name yet, so there is no calendar.'); return sc.own; }
const nameOf = (sc, key) => (sc.all.find((c) => c.key === key) || {}).name || key;

/* ── the week, as this person may see it ── */
async function week(db, who, body) {
  const sc = await scope(db, who); const asked = fold(body && body.coach); const real = (k) => sc.all.some((c) => c.key === k);
  const key = asked && sc.keys.includes(asked) ? asked : (real(sc.own) ? sc.own : (sc.keys.find(real) || sc.own || ''));   // someone who coaches nobody (an owner, a director) opens on the first coach in reach
  const out = await CC.week(db, Object.assign({}, who, { director: true }), Object.assign({}, body, { coach: key }));
  out.coaches = sc.keys.length > 1 ? sc.all.filter((c) => sc.keys.includes(c.key)).map((c) => ({ key: c.key, name: c.name })) : [];
  out.canEdit = sc.keys.includes(out.coach); out.level = sc.level; out.kind = (sc.all.find((c) => c.key === out.coach) || {}).kind || 'tennis';
  const cal = await CC.calDoc(db, out.coach); const h = cal.hours || {};
  out.hours = { from: Number.isFinite(Number(h.from)) ? Number(h.from) : 7, to: Number.isFinite(Number(h.to)) ? Number(h.to) : 19, closed: Array.isArray(h.closed) ? h.closed : [] };
  // time off that is waiting for an owner, and (for an owner) every request that is waiting
  out.pending = []; out.requests = [];
  try { const snap = await db.collection('timeOff').where('status', '==', 'pending').get();
    snap.docs.forEach((d) => { const x = d.data() || {}; const r = { id: d.id, coach: x.coach, key: x.key, from: x.from, to: x.to, note: x.note || '', short: !!x.short, by: x.by || '', privates: 0 };
      if (x.key === out.coach) out.pending.push(r); if (who.owner) out.requests.push(r); }); } catch (e) { /* none */ }
  for (const r of out.requests) { try { r.privates = (await CC.privatesOf(db, r.key, r.from, r.to)).length; } catch (e) { /* shown as 0 */ } }
  // the courts the academy plan gave each session, so a coach reads the court next to the hours
  for (const d of out.days) { d.plan = []; try { const hs = (await COURTS.dayHolds(db, d.date)).holds.filter((x) => x.what === 'academy'); const by = new Map();
    hs.forEach((x) => { const k = x.ref; if (!by.has(k)) by.set(k, { label: x.label, start: x.start, end: x.end, courts: [] }); by.get(k).courts.push(x.court); });
    d.plan = Array.from(by.values()).sort((a, b) => a.start - b.start).map((x) => ({ label: x.label, time: fmtT(x.start) + ' – ' + fmtT(x.end), courts: courtList(x.courts) })); } catch (e) { /* no plan that day */ } }
  return out;
}
function courtList(ids) { const cs = ids.map((i) => COURTS.byId(i)).filter(Boolean).sort((a, b) => COURTS.COURTS.indexOf(a) - COURTS.COURTS.indexOf(b)); return cs.map((c) => c.name).join(', '); }

/* ── hours and time off ── */
async function setHours(db, who, body) {
  const sc = await scope(db, who); const key = pick(sc, body.coach); const from = Number(body.from), to = Number(body.to);
  if (!(to > from) || from < 5 || to > 22 || (from * 2) % 1 || (to * 2) % 1) throw S.err(400, 'hours', 'Pick a start and an end, on the hour or the half hour.');
  const closed = (Array.isArray(body.closed) ? body.closed : []).map((d) => String(d).slice(0, 3).toLowerCase()).filter((d) => DOW3.includes(d));
  await db.doc('coachCal/' + key).set({ hours: { from, to, closed }, updatedAt: CLOCK(), updatedBy: who.email }, { merge: true });
  return { ok: true, hours: { from, to, closed } };
}
/* A few hours off: free to set. Eight hours or more in one day is a day off, and a day off goes through an owner. */
async function setOff(db, who, body) {
  const sc = await scope(db, who); const key = pick(sc, body.coach);
  if (!body.remove && !who.owner && Number(body.end) - Number(body.start) >= 8) throw S.err(400, 'fullday', 'A full day off needs approval from management. Use "Ask for days off".');
  return CC.setOff(db, Object.assign({}, who, { director: true }), Object.assign({}, body, { coach: key }));
}
async function writeOff(db, key, from, to, tag) {
  const ref = db.doc('coachCal/' + key); const cal = await CC.calDoc(db, key); const days = each(from, to);
  const off = (Array.isArray(cal.off) ? cal.off : []).filter((o) => o && !(days.includes(o.date) && Number(o.start) <= 0 && Number(o.end) >= 24));
  days.forEach((date) => off.push(Object.assign({ date, start: 0, end: 24, at: CLOCK() }, tag)));
  await ref.set({ off, updatedAt: CLOCK() }, { merge: true });
}
async function askOff(db, who, body, deps) {
  const sc = await scope(db, who); const key = pick(sc, body.coach); const today = CAL.todayET(); const from = String(body.from || ''), to = String(body.to || body.from || '');
  if (!isDate(from) || !isDate(to) || from < today || to < from) throw S.err(400, 'dates', 'Pick the first and the last day off, from today on.');
  if (each(from, to).length > 60) throw S.err(400, 'dates', 'That is more than 60 days. Talk to management first.');
  const coach = nameOf(sc, key); const note = S.clean(body.note, 300); const id = `${key}_${from}_${to}`; const short = from < CAL.addDays(today, 14);
  if (who.owner) { await writeOff(db, key, from, to, { req: id, by: who.email }); await db.doc('timeOff/' + id).set({ key, coach, from, to, note, status: 'approved', by: who.email, at: CLOCK(), decidedBy: who.email, decidedAt: CLOCK() }); return { ok: true, status: 'approved', id }; }
  await db.doc('timeOff/' + id).set({ key, coach, from, to, note, status: 'pending', short, by: who.email, at: CLOCK() });
  const span = from === to ? dayText(from) : `${dayText(from)} to ${dayText(to)}`;
  try { if (deps && deps.tellOwners) await deps.tellOwners(`Time off request: ${coach}, ${span}.${short ? ' Less than two weeks of notice.' : ''}${note ? ' Note: ' + note : ''} Open the Calendar in the Coach Portal to approve or decline.`); } catch (e) { /* the request is on the calendar either way */ }
  return { ok: true, status: 'pending', id, short };
}
async function decideOff(db, who, body, deps) {
  if (!who.owner) throw S.err(403, 'owner', 'Time off is approved by an owner.');
  const id = S.clean(body.id, 80); const ref = db.doc('timeOff/' + id); const s = await ref.get(); const x = s.exists ? (s.data() || {}) : null;
  if (!x || x.status !== 'pending') throw S.err(404, 'request', 'That request is not waiting any more.');
  const ok = body.ok === true; if (ok) await writeOff(db, x.key, x.from, x.to, { req: id, by: who.email });
  await ref.set({ status: ok ? 'approved' : 'declined', decidedBy: who.email, decidedAt: CLOCK(), reply: S.clean(body.note, 300) }, { merge: true });
  const span = x.from === x.to ? dayText(x.from) : `${dayText(x.from)} to ${dayText(x.to)}`;
  try { if (deps && deps.tellCoach) await deps.tellCoach(x.coach, ok ? `Your time off is approved: ${span}. It is on your calendar and families cannot book you on those days.` : `Your time off request for ${span} was not approved.${body.note ? ' ' + S.clean(body.note, 300) : ''} Please talk to management.`); } catch (e) { /* nicety */ }
  return { ok: true, status: ok ? 'approved' : 'declined' };
}
async function withdrawOff(db, who, body) {
  const id = S.clean(body.id, 80); const ref = db.doc('timeOff/' + id); const s = await ref.get(); const x = s.exists ? (s.data() || {}) : null;
  if (!x || x.status !== 'pending') throw S.err(404, 'request', 'That request is not waiting any more.');
  const sc = await scope(db, who); if (!sc.keys.includes(x.key)) throw S.err(403, 'coach', 'That request is not yours.');
  await ref.set({ status: 'withdrawn', decidedAt: CLOCK() }, { merge: true }); return { ok: true };
}

/* ── a private put on the calendar by the coach, a director or an owner ── */
async function coachPlayers(db, who, body) {
  const sc = await scope(db, who); const key = pick(sc, body.coach); const players = await CC.roster(db); const q = fold(body.q);
  const mine = players.filter((p) => [p.coach, p.coach2, p.coach3].some((c) => c && CC.sameCoach(key, c)));
  const more = q.length >= 2 && sc.level !== 'coach' ? players.filter((p) => fold(p.name).includes(q) && !mine.includes(p)).slice(0, 20) : [];
  const row = (p) => ({ id: p.id, name: p.name || '' });
  return { coach: key, players: mine.map(row).sort((a, b) => a.name.localeCompare(b.name)), more: more.map(row) };
}
async function dayFor(db, key, date, dur) {
  const [players, cal, pv] = await Promise.all([CC.roster(db), CC.calDoc(db, key), CC.privatesOf(db, key, date, date)]);
  // staff may book up to the minute and outside the hours families are offered: only what is already on the calendar is in the way
  const now = CC.nowET(); return CC.dayOf({ date, academy: CC.academyHours(players, key), privates: pv, cal: { off: cal.off, hours: { from: COURTS.OPEN_H, to: COURTS.END_H } }, durMin: dur, now: { date: now.date, h: now.h, lead: 0 } });
}
const durOf = (v) => ([30, 60, 90, 120].includes(Number(v)) ? Number(v) : 60);
async function coachSlots(db, who, body) {
  const sc = await scope(db, who); const key = pick(sc, body.coach); const date = String(body.date || ''); if (!isDate(date) || date < CAL.todayET()) throw S.err(400, 'date', 'Pick a day from today on.');
  const dur = durOf(body.dur); const kind = (sc.all.find((c) => c.key === key) || {}).kind || 'tennis'; const day = await dayFor(db, key, date, dur);
  const start = Number(body.start); const courts = kind === 'tennis' && Number.isFinite(start) && body.start !== '' && body.start != null ? await COURTS.free(db, date, start, dur, 'tennis') : [];
  return { coach: key, kind, date, dur, slots: day.slots, courts, needsCourt: kind === 'tennis' };
}
async function coachBook(db, who, body, deps) {
  const sc = await scope(db, who); const key = pick(sc, body.coach); const c = sc.all.find((x) => x.key === key) || { key, name: key, kind: 'tennis' };
  const date = String(body.date || ''); const start = Number(body.start); const dur = durOf(body.dur); const kind = c.kind || 'tennis';
  if (!isDate(date) || !Number.isFinite(start)) throw S.err(400, 'slot', 'Pick a day and a time.');
  const players = await CC.roster(db); const p = players.find((x) => x.id === S.clean(body.player, 60)); if (!p) throw S.err(404, 'player', 'Pick a player.');
  if (sc.level === 'coach' && ![p.coach, p.coach2, p.coach3].some((n) => n && CC.sameCoach(key, n))) throw S.err(403, 'player', 'That player is not on your name. Ask your director to add the private.');
  const day = await dayFor(db, key, date, dur);
  if (!day.slots.some((s) => Math.abs(s.start - start) < 1e-9)) throw S.err(409, 'taken', 'That time is not free on the calendar. Pick another one.');
  const needsCourt = kind === 'tennis'; const court = needsCourt ? S.clean(body.court, 4) : ''; if (needsCourt && !COURTS.byId(court)) throw S.err(400, 'court', 'Pick a court.');
  let email = ''; try { const feed = await require('./feed').roster(db); const f = (feed.players || []).find((x) => x.id === p.id); email = String((f && f.parent && f.parent.email) || '').trim().toLowerCase(); } catch (e) { /* the family is told by the coach */ }
  const id = `${key}_${date}_${String(Math.round(start * 100)).padStart(4, '0')}`; const ref = db.doc('familyPrivates/' + id);
  const rec = { player: p.id, playerName: p.name || '', coach: c.name, key, kind, date, start, dur, email, by: who.name || who.email, origin: 'coach', status: 'confirmed', court, at: CLOCK(), ackAt: CLOCK(), ackBy: who.email, nudges: 0 };
  let held = null;
  await db.runTransaction(async (t) => {
    const was = await t.get(ref); if (was.exists && (was.data() || {}).status !== 'canceled') throw S.err(409, 'taken', 'That time is already taken. Pick another one.');
    held = needsCourt ? await COURTS.holdIn(t, db, { date, court, start, durMin: dur, ref: id, what: 'private', label: first(c.name) + ' · ' + (p.name || ''), coach: c.name, player: p.name || '', by: who.email }) : null;
    t.set(ref, rec);
  });
  const when = CC.whenText(date, start); const where = held ? held.courtName : '';
  const mine = (who.keys || []).map(fold).some((k) => k === key || CC.sameCoach(key, k));
  try { if (!mine && deps && deps.tellCoach) await deps.tellCoach(c.name, `New private on your calendar: ${p.name}, ${when} (${dur} min)${where ? ', ' + where : ''}. Added by ${sc.level === 'director' ? 'your director' : 'management'}.`); } catch (e) { /* nicety */ }
  try { if (deps && deps.tellDesk) await deps.tellDesk(`${CC.KINDS[kind]} added by staff: ${p.name} with ${c.name}, ${when} (${dur} min)${where ? ', ' + where : ''}.`); } catch (e) { /* same */ }
  try { if (email && deps && deps.tellFamily) await deps.tellFamily(email, { subject: `Private lesson confirmed: ${p.name}, ${when}`, text: ['Hello,', '', `${p.name}'s ${CC.KINDS[kind].toLowerCase()} is on the calendar.`, '', `Coach: ${c.name}`, `When: ${when} (${dur} minutes)`].concat(where ? [`Where: ${where}`] : []).concat(['', 'If this time does not work, write to Admin in Messages.', '', 'ProWorld Academy']).join('\n'), push: { title: 'Private confirmed', body: `${p.name} with ${first(c.name)}, ${when}${where ? ', ' + where : ''}.`, url: '/family', tag: 'private-' + id } }); } catch (e) { /* same */ }
  return { ok: true, id, time: fmtT(start), courtName: where, toldFamily: !!email };
}
async function coachCancel(db, who, body, deps) {
  const id = S.clean(body.id, 80); const ref = db.doc('familyPrivates/' + id); const s = await ref.get(); const x = s.exists ? (s.data() || {}) : null;
  if (!x || x.status === 'canceled') throw S.err(404, 'private', 'That private is not on the calendar any more.');
  const sc = await scope(db, who); if (!sc.keys.includes(x.key)) throw S.err(403, 'private', 'That private is on another coach.');
  if (sc.level === 'coach' && x.origin !== 'coach') throw S.err(403, 'private', 'A private the family booked is changed with your director or the admin team.');
  await ref.set({ status: 'canceled', canceledAt: CLOCK(), canceledBy: who.email }, { merge: true });
  try { await COURTS.release(db, id); } catch (e) { /* next sweep */ }
  const when = CC.whenText(x.date, Number(x.start));
  try { if (deps && deps.tellDesk) await deps.tellDesk(`Private canceled by staff: ${x.playerName} with ${x.coach}, ${when}.`); } catch (e) { /* nicety */ }
  try { if (x.email && deps && deps.tellFamily) await deps.tellFamily(x.email, { subject: `Private lesson canceled: ${x.playerName}, ${when}`, text: ['Hello,', '', `${x.playerName}'s private with ${x.coach} on ${when} was canceled by the academy.`, '', 'To book another time, open the app or write to Admin in Messages.', '', 'ProWorld Academy'].join('\n'), push: { title: 'Private canceled', body: `${x.playerName} with ${first(x.coach)}, ${when}.`, url: '/family', tag: 'private-' + id } }); } catch (e) { /* same */ }
  return { ok: true };
}

/* ── a court a family reserves ── */
const RENT = { aheadDays: 7, maxMin: 120, perDay: 1 };          // settings/rental overrides these
async function rentRules(db) { try { const s = await db.doc('settings/rental').get(); return Object.assign({}, RENT, s.exists ? (s.data() || {}) : {}); } catch (e) { return RENT; } }
const rentDur = (v, r) => { const n = Number(v); return [30, 60, 90, 120].includes(n) && n <= r.maxMin ? n : 60; };
/* The times with at least one court free. A court can be taken up to the minute it starts. */
async function rentSlots(db, who, body) {
  const r = await rentRules(db); const today = CAL.todayET(); const date = String(body.date || ''); const dur = rentDur(body.dur, r);
  if (!isDate(date) || date < today || date > CAL.addDays(today, r.aheadDays)) throw S.err(400, 'date', `A court is reserved up to ${r.aheadDays} days ahead.`);
  const now = CC.nowET(); const start = Number(body.start);
  if (Number.isFinite(start) && body.start !== '' && body.start != null) return { date, dur, start, courts: await COURTS.free(db, date, start, dur, 'tennis') };
  const state = (await db.doc('backend/state').get()); const st = state.exists ? (state.data() || {}) : {}; const slots = [];
  if (Array.isArray(st.blocks)) { const held = new Set((await COURTS.holdsOn(db, date)).map((x) => x.court + '|' + x.h));
    for (let h = COURTS.OPEN_H; h + dur / 60 <= COURTS.END_H + 1e-9; h += 0.5) { if (date === now.date && h < now.h - 1e-9) continue; const n = COURTS.freeCourts(st, held, date, h, dur / 60, 'tennis').length; if (n) slots.push({ start: h, label: fmtT(h), free: n }); } }
  return { date, dur, slots, rules: { aheadDays: r.aheadDays, maxMin: r.maxMin } };
}
async function rentMine(db, email, today) {
  const out = []; try { const snap = await db.collection('rentals').where('email', '==', email).get();
    snap.docs.forEach((d) => { const x = d.data() || {}; if (x.status === 'canceled' || x.date < today) return; out.push({ id: d.id, date: x.date, start: Number(x.start), dur: x.dur, time: fmtT(Number(x.start)), court: COURTS.nameOf(x.court) }); }); } catch (e) { /* none */ }
  return out.sort((a, b) => (a.date + String(a.start).padStart(5, '0')).localeCompare(b.date + String(b.start).padStart(5, '0')));
}
async function rentList(db, who) { return { list: await rentMine(db, String(who.email || '').toLowerCase(), CAL.todayET()) }; }
async function rentBook(db, who, body, deps) {
  const r = await rentRules(db); const today = CAL.todayET(); const now = CC.nowET(); const date = String(body.date || ''); const start = Number(body.start); const dur = rentDur(body.dur, r);
  if (!isDate(date) || date < today || date > CAL.addDays(today, r.aheadDays) || !Number.isFinite(start)) throw S.err(400, 'slot', 'Pick a day and a time.');
  if (date === now.date && start < now.h - 1e-9) throw S.err(400, 'past', 'That time has already started. Pick the next one.');
  const court = S.clean(body.court, 4); const c = COURTS.byId(court); if (!c || c.kind !== 'tennis') throw S.err(400, 'court', 'Pick a court.');
  const email = String(who.email || '').toLowerCase(); const mine = (await rentMine(db, email, today)).filter((x) => x.date === date);
  if (mine.length >= r.perDay) throw S.err(400, 'limit', r.perDay === 1 ? 'You already have a court that day. Cancel it first to pick another time.' : `That is the limit of ${r.perDay} courts in one day.`);
  const id = 'rent_' + date.replace(/-/g, '') + '_' + court + '_' + String(Math.round(start * 100)).padStart(4, '0'); const ref = db.doc('rentals/' + id);
  const name = who.name || email; let held = null;
  await db.runTransaction(async (t) => {
    held = await COURTS.holdIn(t, db, { date, court, start, durMin: dur, ref: id, what: 'rental', label: 'Rental · ' + name, player: name, by: email });
    t.set(ref, { email, name, date, start, dur, court, price: 0, status: 'confirmed', at: CLOCK() });
  });
  const when = CC.whenText(date, start);
  try { if (deps && deps.tellDesk) await deps.tellDesk(`Court reserved in the app: ${name}, ${when} (${dur} min), ${held.courtName}.`); } catch (e) { /* nicety */ }
  try { if (deps && deps.tellFamily) await deps.tellFamily(email, { subject: `Court reserved: ${when}`, text: [`Hello${who.name ? ' ' + first(who.name) : ''},`, '', 'Your court is reserved.', '', `When: ${when} (${dur} minutes)`, `Where: ${held.courtName}`, '', 'You can cancel it in the app any time before it starts.', '', 'ProWorld Academy'].join('\n'), push: { title: 'Court reserved', body: `${when}, ${held.courtName}.`, url: '/family', tag: id } }); } catch (e) { /* same */ }
  return { ok: true, id, time: fmtT(start), courtName: held.courtName };
}
async function rentCancel(db, who, body, deps) {
  const id = S.clean(body.id, 80); const ref = db.doc('rentals/' + id); const s = await ref.get(); const x = s.exists ? (s.data() || {}) : null; const email = String(who.email || '').toLowerCase();
  if (!x || x.status === 'canceled' || (x.email !== email && !who.admin && !who.owner)) throw S.err(404, 'rental', 'That court is not on this account.');
  await ref.set({ status: 'canceled', canceledAt: CLOCK(), canceledBy: email }, { merge: true });
  try { await COURTS.release(db, id); } catch (e) { /* next sweep */ }
  try { if (deps && deps.tellDesk) await deps.tellDesk(`Court canceled in the app: ${x.name}, ${CC.whenText(x.date, Number(x.start))}, ${COURTS.nameOf(x.court)}.`); } catch (e) { /* nicety */ }
  return { ok: true };
}

/* ── rain ── */
const RAIN_TEXT = {
  rain: { subject: 'Rain delay at ProWorld Academy', push: 'It is raining at the academy. The courts are closed for now. We will let you know as soon as they are ready.',
    text: ['Hello,', '', 'It is raining at the academy right now and the courts are closed for the moment.', '', 'We will write to you as soon as the rain stops and the courts are ready to play. You do not need to do anything until then.', '', 'Thank you for your patience.', '', 'ProWorld Academy', '(561) 403-0008'] },
  ready: { subject: 'The courts are ready at ProWorld Academy', push: 'The rain has stopped and the courts are ready to play.',
    text: ['Hello,', '', 'The rain has stopped and the courts are ready to play.', '', 'If your time has already passed, write to Admin in the app or call the front desk and we will help you move it.', '', 'Thank you for your patience. We look forward to seeing you on court.', '', 'ProWorld Academy', '(561) 403-0008'] }
};
/* Who is on a court between now and `hours` from now: rentals, privates, and the academy players of the sessions in that window. */
async function rainWho(db, hours, now) {
  const n = CC.nowET(now); const a = n.h, b = n.h + (Number(hours) || 3); const date = n.date; const hit = (s, e) => s < b && e > a;
  const rentals = new Map(), privates = new Map(), academy = new Map();
  const st = await db.doc('backend/state').get(); const state = st.exists ? (st.data() || {}) : {};
  (state.bookings || []).forEach((x) => { if (x.date === date && hit(Number(x.start), Number(x.start) + Number(x.dur || 1)) && x.email) rentals.set(String(x.email).toLowerCase(), x.name || ''); });
  try { (await db.collection('rentals').where('date', '==', date).get()).docs.forEach((d) => { const x = d.data() || {}; if (x.status !== 'canceled' && hit(Number(x.start), Number(x.start) + Number(x.dur || 60) / 60) && x.email) rentals.set(x.email, x.name || ''); }); } catch (e) { /* none */ }
  let feed = { players: [] }; try { feed = await require('./feed').roster(db); } catch (e) { /* no contacts: the list is shorter */ }
  const mail = new Map((feed.players || []).map((p) => [p.id, String((p.parent && p.parent.email) || '').trim().toLowerCase()]));
  try { (await db.collection('familyPrivates').where('date', '==', date).get()).docs.forEach((d) => { const x = d.data() || {}; if (x.status === 'canceled' || !hit(Number(x.start), Number(x.start) + Number(x.dur || 60) / 60)) return; const e = x.email || mail.get(x.player) || ''; if (e) privates.set(e, x.playerName || ''); }); } catch (e) { /* none */ }
  (state.privates || []).forEach((x) => { if (x.date === date && hit(Number(x.start), Number(x.start) + Number(x.dur || 1))) { const e = mail.get(x.pid) || ''; if (e) privates.set(e, ''); } });
  sessionsOn(await CC.roster(db), date).forEach((s) => { if (hit(s.start, s.end)) s.players.forEach((p) => { const e = mail.get(p.id) || ''; if (e) academy.set(e, p.name || ''); }); });
  return { date, from: fmtT(a), to: fmtT(b), rentals: Array.from(rentals.keys()), privates: Array.from(privates.keys()), academy: Array.from(academy.keys()) };
}
async function rain(db, who, body, deps) {
  if (!who.owner && !who.admin && who.role !== 'desk') throw S.err(403, 'owner', 'The rain notice is sent by management or the front desk.');
  const ref = db.doc('settings/rain'); const cur = await ref.get(); const was = cur.exists ? (cur.data() || {}) : {}; const today = CAL.todayET();
  const on = !!(was.on && was.date === today);
  if (body.send !== 'rain' && body.send !== 'ready') { const w = await rainWho(db, body.hours); return { on, since: on ? was.at : 0, sent: on ? (was.emails || []).length : 0, rentals: w.rentals.length, privates: w.privates.length, academy: w.academy.length, from: w.from, to: w.to, texts: { rain: RAIN_TEXT.rain.text.join('\n'), ready: RAIN_TEXT.ready.text.join('\n') } }; }
  let emails = [];
  if (body.send === 'rain') { const w = await rainWho(db, body.hours); emails = Array.from(new Set(w.rentals.concat(w.privates).concat(body.academy === true ? w.academy : [])));
    await ref.set({ on: true, date: today, at: CLOCK(), by: who.email, emails: Array.from(new Set((on ? was.emails || [] : []).concat(emails))), academy: w.academy.length });
    try { if (deps && deps.tellStaff) await deps.tellStaff(`Rain: the courts are closed for now. ${emails.length} famil${emails.length === 1 ? 'y was' : 'ies were'} told (rentals and privates${body.academy === true ? ' and academy sessions' : ''}).${body.academy === true ? '' : ` Directors: ${w.academy.length} academy famil${w.academy.length === 1 ? 'y is' : 'ies are'} on the schedule in the next hours. Please get in touch with your groups.`}`); } catch (e) { /* nicety */ }
  } else { if (!on) throw S.err(400, 'rain', 'No rain notice is out today.'); emails = was.emails || []; await ref.set({ on: false, readyAt: CLOCK(), readyBy: who.email }, { merge: true });
    try { if (deps && deps.tellStaff) await deps.tellStaff('The rain has stopped and the courts are ready. The families who got the rain notice were told.'); } catch (e) { /* nicety */ } }
  const m = RAIN_TEXT[body.send]; let sent = 0;
  for (const e of emails) { try { await deps.tellFamily(e, { subject: m.subject, text: m.text.join('\n'), push: { title: m.subject, body: m.push, url: '/family', tag: 'rain' } }); sent++; } catch (err) { /* the next one */ } }
  return { ok: true, on: body.send === 'rain', sent, total: emails.length };
}

/* ── the academy's courts, worked out from who is enrolled ── */
/* The sessions of a day: the players who train that weekday, grouped by their hours. Mornings and the 2 pm session play two to a
   court; after school starts at two and may go up to four when courts are short; 10 and under play four to a court. */
function sessionsOn(players, date) {
  const w = DOW3[CAL.dow(date)]; const by = new Map();
  for (const p of players) {
    const en = p.enroll || {}; const rs = CC.ranges((en.pbp && en.pbp.time) || en.time || ''); if (!rs.length) continue;
    let days = (Array.isArray(en.days) ? en.days : []).map((d) => String(d).slice(0, 3).toLowerCase()).filter((d) => DOW3.includes(d)); if (!days.length) days = ['mon', 'tue', 'wed', 'thu', 'fri'];
    if (!days.includes(w)) continue;
    const prog = String(en.programName || en.programShort || en.program || ''); const u10 = /10\s*(&|and)?\s*u|under\s*10|u\s*10|red ball|orange ball|green ball/i.test(prog);
    if (/soccer|fitness|mental/i.test(prog)) continue;
    rs.forEach((r) => { const k = (u10 ? 'u10' : 'reg') + '|' + r[0] + '|' + r[1]; if (!by.has(k)) by.set(k, { u10, start: r[0], end: r[1], players: [], progs: new Map() }); const s = by.get(k); s.players.push({ id: p.id, name: p.name || '' }); if (prog) s.progs.set(prog, (s.progs.get(prog) || 0) + 1); });
  }
  return Array.from(by.values()).map((s) => { const top = Array.from(s.progs.entries()).sort((a, b) => b[1] - a[1])[0]; const per = s.u10 ? 4 : 2; const max = s.u10 || s.start >= 15 ? 4 : 2;
    return { label: s.u10 ? '10 and under' : (top ? top[0] : s.start < 12 ? 'Morning session' : s.start < 15 ? 'Afternoon session' : 'After school'), start: s.start, end: s.end, n: s.players.length, players: s.players, per, max, want: Math.ceil(s.players.length / per), least: Math.ceil(s.players.length / max) }; })
    .sort((a, b) => a.start - b.start || b.n - a.n);
}
/* the half hours a session touches: 7:45 to 9:45 takes 7:30 to 10:00 */
const span = (s) => { const a = Math.floor(s.start * 2) / 2, b = Math.ceil(s.end * 2) / 2; return COURTS.halves(a, b - a); };
const isAcademyBlock = (b) => !(b.tag ? b.tag !== 'academy' : (b.private || b.event));
/* The plan for one day. Nothing is written. A court counts as taken when a tournament, maintenance, a rental or a private has it;
   the academy's own fixed blocks do not count, the plan replaces them. A group stays inside one bank when a bank can take it. */
async function plan(db, date) {
  if (!isDate(date)) throw S.err(400, 'date', 'Pick a day.');
  const st = await db.doc('backend/state').get(); const state = st.exists ? (st.data() || {}) : {};
  if (!Array.isArray(state.blocks)) throw S.err(503, 'schedule', 'The court schedule is not available right now.');
  const hard = Object.assign({}, state, { blocks: state.blocks.filter((b) => !isAcademyBlock(b)) });
  const holds = (await COURTS.holdsOn(db, date)).filter((x) => x.what !== 'academy'); const held = new Set(holds.map((x) => x.court + '|' + x.h));
  const courts = COURTS.COURTS.filter((c) => c.kind === 'tennis' && !c.soon); const banks = []; courts.forEach((c) => { let b = banks.find((x) => x.id === c.bank); if (!b) { b = { id: c.bank, courts: [] }; banks.push(b); } b.courts.push(c); });
  const used = []; void banks; const sessions = sessionsOn(await CC.roster(db), date);
  const out = sessions.map((s, i) => {
    const hs = span(s);
    const open = (c) => hs.every((h) => h >= COURTS.OPEN_H && h < COURTS.END_H && !COURTS.blockAt(hard, c.id, date, h) && !COURTS.bookingAt(hard, c.id, date, h) && !held.has(c.id + '|' + h)) && !used.some((u) => u.court === c.id && hs.includes(u.h));
    // every run of `want` free courts, in the order they stand on the campus: the one inside a single bank wins (the smallest bank
    // that can take the group, so the big banks stay whole); when no bank can, the run that spans the fewest banks and the least ground
    const free = courts.filter(open); const idx = (c) => COURTS.COURTS.indexOf(c); const size = Math.min(s.want, free.length); let got = [];
    if (size) { const inBank = (id) => free.filter((c) => c.bank === id).length; let best = null;
      for (let i = 0; i + size <= free.length; i++) { const part = free.slice(i, i + size); const nb = new Set(part.map((c) => c.bank)).size; const score = [nb, idx(part[size - 1]) - idx(part[0]), nb === 1 ? inBank(part[0].bank) : 0, i];
        if (!best || score.some((v, k) => v !== best.score[k]) && score.find((v, k) => v !== best.score[k]) < best.score[score.findIndex((v, k) => v !== best.score[k])]) best = { part, score }; }
      got = best.part; }
    got.forEach((c) => hs.forEach((h) => used.push({ court: c.id, h })));
    const per = got.length ? Math.ceil(s.n / got.length) : 0;
    return { ref: 'plan_' + date + '_' + i, label: s.label, start: s.start, end: s.end, time: fmtT(s.start) + ' – ' + fmtT(s.end), players: s.n, want: s.want, courts: got.map((c) => c.id), courtNames: got.map((c) => c.name).join(', '), perCourt: per,
      note: !got.length ? 'No court is free at this time.' : got.length < s.least ? `Short of courts: ${per} players a court.` : got.length < s.want ? `Courts are tight: ${per} players a court.` : new Set(got.map((c) => c.bank)).size > 1 ? 'Split over two banks.' : '' };
  });
  return { date, day: dayText(date), sessions: out, fixed: state.blocks.filter(isAcademyBlock).length };
}
/* Put the plan on the courts: last plan of that day out, this one in. Privates and rentals booked meanwhile win. */
async function applyPlan(db, who, body) {
  if (!who.owner && !who.admin && !who.director) throw S.err(403, 'director', 'The court plan is set by a director or management.');
  const from = String(body.date || ''); const days = Math.min(Math.max(Number(body.days) || 1, 1), 14); const out = [];
  for (const date of each(from, CAL.addDays(from, days - 1))) {
    const p = await plan(db, date);
    const old = (await db.collection('courtHolds').where('date', '==', date).get()).docs.filter((d) => (d.data() || {}).what === 'academy'); for (const d of old) await d.ref.delete();
    let n = 0;
    for (const s of p.sessions) for (const court of s.courts) for (const h of span(s)) {
      const ref = db.doc('courtHolds/' + COURTS.holdId(date, court, h));
      try { await db.runTransaction(async (t) => { const was = await t.get(ref); if (was.exists) return; t.set(ref, { date, court, h, ref: s.ref, what: 'academy', label: `${s.label} · ${s.players} players`, coach: '', player: '', by: who.email || 'plan', at: CLOCK() }); n++; }); } catch (e) { /* that half hour stays as it is */ }
    }
    out.push({ date, sessions: p.sessions.length, halfHours: n });
  }
  return { ok: true, days: out };
}
async function clearPlan(db, who, body) {
  if (!who.owner && !who.admin && !who.director) throw S.err(403, 'director', 'The court plan is set by a director or management.');
  const date = String(body.date || ''); if (!isDate(date)) throw S.err(400, 'date', 'Pick a day.');
  const old = (await db.collection('courtHolds').where('date', '==', date).get()).docs.filter((d) => (d.data() || {}).what === 'academy'); for (const d of old) await d.ref.delete();
  return { ok: true, removed: old.length };
}
/* Every night, when settings/courtPlan.auto is on: the next seven days. */
async function nightly(db, log) {
  let cfg = {}; try { const s = await db.doc('settings/courtPlan').get(); cfg = s.exists ? (s.data() || {}) : {}; } catch (e) { return { ran: false }; }
  if (cfg.auto !== true) return { ran: false };
  const out = await applyPlan(db, { owner: true, email: 'plan' }, { date: CAL.todayET(), days: 7 }); if (log) log('court plan: ' + JSON.stringify(out.days)); return { ran: true, days: out.days };
}
async function planAuto(db, who, body) { if (!who.owner) throw S.err(403, 'owner', 'Only an owner switches the nightly plan.'); await db.doc('settings/courtPlan').set({ auto: body.on === true, by: who.email, at: CLOCK() }, { merge: true }); return { ok: true, auto: body.on === true }; }
async function planState(db) { try { const s = await db.doc('settings/courtPlan').get(); return { auto: !!(s.exists && (s.data() || {}).auto === true) }; } catch (e) { return { auto: false }; } }

module.exports = { scope, week, setHours, setOff, askOff, decideOff, withdrawOff, coachPlayers, coachSlots, coachBook, coachCancel, rentSlots, rentBook, rentCancel, rentList, rentMine, rain, rainWho, RAIN_TEXT, sessionsOn, plan, applyPlan, clearPlan, nightly, planAuto, planState, DOWN,
  _clock: (f) => { CLOCK = f || (() => Date.now()); } };
