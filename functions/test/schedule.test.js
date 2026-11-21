'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const SCH = require('../lib/schedule'); const C = require('../lib/coachcal'); const COURTS = require('../lib/courts');
const { fakeDb } = require('./fake-db');

/* The rest of the one schedule (Nov 20, 2026). Invented people; a Monday far ahead. */
const DAY = '2027-03-01'; const NOW = Date.parse('2027-02-01T15:00:00Z');
const kid = (i, coach, time, prog, days) => ({ name: 'Kid ' + i, coach, status: 'active', enroll: { days: days || ['Mon'], programName: prog, pbp: { time } } });
const seed = () => { const o = {
  'backend/state': { blocks: [{ id: 'old', label: 'Afterschool', courts: ['1', '2'], dows: [1], start: 16, end: 18 }, { id: 't', label: 'Open', courts: ['8', '9', '10', '11', '12'], dows: [1], start: 8, end: 20, event: true }], bookings: [], privates: [] },
  'groups/after': { coaches: ['Nico', 'Lee'], directors: ['kam@example.test'] } };
  for (let i = 0; i < 6; i++) o['players/a' + i] = kid(i, 'Nico', '04:00 PM-06:00 PM', 'Afterschool');
  for (let i = 0; i < 8; i++) o['players/u' + i] = kid('u' + i, 'Lee', '04:30 PM-06:00 PM', '10 & Under');
  for (let i = 0; i < 12; i++) o['players/h' + i] = kid('h' + i, 'Ana', '07:45 AM-09:45 AM', 'High Performance');
  return o; };
const fresh = () => { C._clock(() => NOW); C._reset(); SCH._clock(() => NOW); return fakeDb(seed()); };
const coach = { email: 'nico@example.test', name: 'Nico Example', keys: ['nico'] };
const dir = { email: 'kam@example.test', name: 'Kam Example', keys: ['kam'], director: true };
const owner = { email: 'own@example.test', name: 'Olive Owner', keys: ['olive'], owner: true, admin: true, director: true };

test('who may touch whose calendar', async () => {
  const db = fresh();
  assert.deepEqual((await SCH.scope(db, coach)).keys, ['nico']);
  const dk = (await SCH.scope(db, dir)).keys; assert.ok(dk.includes('lee') && dk.includes('nico') && !dk.includes('ana'));
  assert.ok((await SCH.scope(db, owner)).keys.includes('ana'));
  const w = await SCH.week(db, coach, { coach: 'ana', from: DAY }); assert.equal(w.coach, 'nico'); assert.equal(w.coaches.length, 0);
  const wd = await SCH.week(db, dir, { coach: 'lee', from: DAY }); assert.equal(wd.coach, 'lee'); assert.equal(wd.canEdit, true);
  await assert.rejects(SCH.setHours(db, coach, { coach: 'ana', from: 8, to: 12 }), (e) => e.status === 403);
});

test('hours: a coach sets when families can book', async () => {
  const db = fresh(); await SCH.setHours(db, coach, { from: 9, to: 12, closed: ['Mon'] });
  const w = await SCH.week(db, coach, { from: DAY }); assert.deepEqual(w.hours, { from: 9, to: 12, closed: ['mon'] });
  assert.equal(w.days[0].open, 0); assert.equal(w.days[1].open, 5);       // Tuesday: 9 to 12, hour lessons on the half hour
});

test('a full day off goes through an owner', async () => {
  const db = fresh(); const told = [];
  await assert.rejects(SCH.setOff(db, coach, { date: DAY, start: 7, end: 19 }), (e) => e.code === 'fullday');
  await SCH.setOff(db, coach, { date: DAY, start: 12, end: 13 });
  const r = await SCH.askOff(db, coach, { from: '2027-03-02', to: '2027-03-03', note: 'Family' }, { tellOwners: async (t) => told.push(t) });
  assert.equal(r.status, 'pending'); assert.equal(told.length, 1);
  let w = await SCH.week(db, owner, { coach: 'nico', from: DAY }); assert.equal(w.requests.length, 1); assert.equal(w.pending.length, 1); assert.ok(w.days[1].open > 0);
  await assert.rejects(SCH.decideOff(db, dir, { id: r.id, ok: true }), (e) => e.status === 403);
  await SCH.decideOff(db, owner, { id: r.id, ok: true }, { tellCoach: async (n, t) => told.push(t) });
  w = await SCH.week(db, coach, { from: DAY }); assert.equal(w.days[1].open, 0); assert.equal(w.days[2].open, 0); assert.ok(w.days[3].open > 0); assert.equal(w.pending.length, 0);
  assert.match(told[1], /approved/);
});

test('a coach adds a private: own players only, a real court, no double booking', async () => {
  const db = fresh(); const said = [];
  const s = await SCH.coachSlots(db, coach, { date: DAY, start: 10 }); assert.ok(s.slots.some((x) => x.start === 10)); assert.ok(s.courts.some((c) => c.id === '5')); assert.ok(!s.courts.some((c) => c.id === '8'));
  await assert.rejects(SCH.coachBook(db, coach, { player: 'h0', date: DAY, start: 10, court: '5' }), (e) => e.status === 403);
  const b = await SCH.coachBook(db, coach, { player: 'a0', date: DAY, start: 10, court: '5' }, { tellDesk: async (t) => said.push(t) }); assert.equal(b.courtName, 'Court 5');
  await assert.rejects(SCH.coachBook(db, coach, { player: 'a1', date: DAY, start: 10.5, court: '6' }), (e) => e.status === 409);
  await assert.rejects(SCH.coachBook(db, dir, { coach: 'lee', player: 'u0', date: DAY, start: 10, court: '5' }), (e) => e.status === 409);
  const w = await SCH.week(db, coach, { from: DAY }); const it = w.days[0].items.find((x) => x.what === 'private'); assert.equal(it.origin, 'coach'); assert.equal(it.ack, true);
  await SCH.coachCancel(db, coach, { id: b.id }); assert.ok((await COURTS.free(db, DAY, 10, 60, 'tennis')).some((c) => c.id === '5'));
});

test('a family reserves a court: free courts only, one a day, cancel frees it', async () => {
  const db = fresh(); const fam = { email: 'maria@example.test', name: 'Maria Example', member: true };
  const today = require('../lib/calendar').todayET(); const d = require('../lib/calendar').addDays(today, 2);
  const s = await SCH.rentSlots(db, fam, { date: d }); assert.ok(s.slots.length > 0);
  const st = s.slots[s.slots.length - 1].start; const cs = (await SCH.rentSlots(db, fam, { date: d, start: st })).courts; assert.ok(cs.length > 0);
  const b = await SCH.rentBook(db, fam, { date: d, start: st, court: cs[0].id }, {});
  assert.ok(!(await SCH.rentSlots(db, fam, { date: d, start: st })).courts.some((c) => c.id === cs[0].id));
  await assert.rejects(SCH.rentBook(db, fam, { date: d, start: st, court: cs[1].id }, {}), (e) => e.code === 'limit');
  await assert.rejects(SCH.rentBook(db, { email: 'x@example.test', member: true }, { date: d, start: st, court: cs[0].id }, {}), (e) => e.status === 409);
  assert.equal((await SCH.rentList(db, fam)).list.length, 1);
  await SCH.rentCancel(db, fam, { id: b.id }, {}); assert.equal((await SCH.rentList(db, fam)).list.length, 0);
  await assert.rejects(SCH.rentSlots(db, fam, { date: require('../lib/calendar').addDays(today, 30) }), (e) => e.status === 400);
});

test('the academy plan: two a court, four for 10 and under, one bank, around what is taken', async () => {
  const db = fresh(); const p = await SCH.plan(db, DAY);
  const hp = p.sessions.find((s) => s.label === 'High Performance'); assert.equal(hp.courts.length, 6);
  assert.ok(!hp.courts.some((c) => ['9', '10', '11', '12'].includes(c)));                      // the tournament keeps its courts from 8
  const as = p.sessions.find((s) => s.label === 'Afterschool'); assert.deepEqual(as.courts, ['5', '6', '7']);   // 6 players, the bank of three
  const u = p.sessions.find((s) => s.label === '10 and under'); assert.equal(u.courts.length, 2); assert.equal(u.perCourt, 4);
  assert.ok(!u.courts.some((c) => as.courts.includes(c)));
  await SCH.coachBook(db, coach, { player: 'a0', date: DAY, start: 13, court: '5' }, {});       // a private elsewhere in the day does not matter
  const out = await SCH.applyPlan(db, owner, { date: DAY }); assert.equal(out.days[0].sessions, 3);
  assert.ok(!(await COURTS.free(db, DAY, 16, 60, 'tennis')).some((c) => c.id === '5'));
  const w = await SCH.week(db, coach, { from: DAY }); assert.ok(w.days[0].plan.some((x) => /Afterschool/.test(x.label) && /Court 5/.test(x.courts)));
  const again = await SCH.applyPlan(db, owner, { date: DAY }); assert.equal(again.days[0].halfHours, out.days[0].halfHours);
  await assert.rejects(SCH.applyPlan(db, coach, { date: DAY }), (e) => e.status === 403);
});

test('rain: renters and privates are told, the same people hear the courts are ready', async () => {
  const db = fresh(); const CALm = require('../lib/calendar'); const today = CALm.todayET(new Date(NOW)); const n = C.nowET(NOW); const h = Math.ceil(n.h * 2) / 2 + 0.5;
  await db.doc('rentals/r1').set({ email: 'renter@example.test', name: 'Rita', date: today, start: h, dur: 60, court: '5', status: 'confirmed' });
  await db.doc('familyPrivates/p1').set({ email: 'maria@example.test', playerName: 'Kid', date: today, start: h, dur: 60, status: 'confirmed' });
  await db.doc('rentals/r2').set({ email: 'late@example.test', date: today, start: h + 6, dur: 60, court: '6', status: 'confirmed' });
  const sent = []; const deps = { tellFamily: async (e, m) => sent.push([e, m.subject]), tellStaff: async () => {} };
  const pre = await SCH.rain(db, owner, {}, deps); assert.equal(pre.rentals, 1); assert.equal(pre.privates, 1); assert.equal(sent.length, 0);
  await assert.rejects(SCH.rain(db, coach, { send: 'rain' }, deps), (e) => e.status === 403);
  const a = await SCH.rain(db, owner, { send: 'rain' }, deps); assert.equal(a.sent, 2); assert.ok(sent.every((x) => /Rain delay/.test(x[1])));
  const b = await SCH.rain(db, owner, { send: 'ready' }, deps); assert.equal(b.sent, 2); assert.match(sent[3][1], /ready/);
  await assert.rejects(SCH.rain(db, owner, { send: 'ready' }, deps), (e) => e.status === 400);
});

test('someone who is not an academy family pays by card: held while paying, theirs once paid, freed if not', async () => {
  const db = fresh(); const CALm = require('../lib/calendar'); const d = CALm.addDays(CALm.todayET(), 2); const out = { email: 'pat@example.test', name: 'Pat Example' }; const said = []; let paid = false;
  const deps = { checkout: async (o) => { said.push(o.cents); return { url: 'https://pay.example/' + o.id, id: 'cs_1' }; }, paid: async () => ({ paid, intent: 'pi_1' }), tellDesk: async (t) => said.push(t), tellFamily: async () => {} };
  await assert.rejects(SCH.rentBook(db, out, { date: d, start: 10, dur: 90, court: '5' }, {}), (e) => e.status === 503);
  const b = await SCH.rentBook(db, out, { date: d, start: 10, dur: 90, court: '5' }, deps); assert.equal(b.cents, 3000); assert.match(b.pay, /pay\.example/);
  assert.ok(!(await SCH.rentSlots(db, out, { date: d, start: 10, dur: 60 })).courts.some((c) => c.id === '5'));         // held while they pay
  assert.equal((await SCH.rentList(db, out)).list[0].pending, true);
  assert.equal((await SCH.rentConfirm(db, out, { id: b.id }, deps)).ok, false);                                          // not paid yet
  await assert.rejects(SCH.rentConfirm(db, { email: 'x@example.test' }, { id: b.id }, deps), (e) => e.status === 404);
  paid = true; const c = await SCH.rentConfirm(db, out, { id: b.id }, deps); assert.equal(c.status, 'confirmed'); assert.ok(said.some((t) => /Paid \$30\.00/.test(String(t))));
  assert.equal((await SCH.rentConfirm(db, out, { id: b.id }, deps)).status, 'confirmed');                                // asked twice: told once
  assert.equal(said.filter((t) => /Paid \$30\.00/.test(String(t))).length, 1);
  // one that is never paid goes back on the schedule
  const d2 = CALm.addDays(d, 1); paid = false; const b2 = await SCH.rentBook(db, out, { date: d2, start: 9, court: '6' }, deps);
  SCH._clock(() => NOW + 40 * 60000); assert.equal(await SCH.rentSweep(db), 1); SCH._clock(() => NOW);
  assert.ok((await SCH.rentSlots(db, out, { date: d2, start: 9, dur: 60 })).courts.some((c2) => c2.id === '6')); assert.ok(b2.id);
  // an academy family still reserves for free
  const fam = await SCH.rentBook(db, { email: 'maria@example.test', name: 'Maria', member: true }, { date: d, start: 12, court: '6' }, {}); assert.equal(fam.pay, undefined);
});

test('a profile without a child: sign up, add an adult, book with it', async () => {
  const CL = require('../lib/client'); const db = fresh();
  await assert.rejects(CL.signup(db, { email: 'pat@example.test', name: 'Pat Example', phone: '12' }, {}), (e) => e.code === 'phone');
  await CL.signup(db, { email: 'Pat@Example.test', name: 'Pat Example', phone: '561 555 0100' }, { isTeam: async () => false, onFile: async () => false });
  assert.equal((await CL.get(db, 'pat@example.test')).name, 'Pat Example');
  await CL.signup(db, { email: 'pat@example.test', name: 'Someone Else', phone: '561 555 0199' }, {}); assert.equal((await CL.get(db, 'pat@example.test')).name, 'Pat Example');   // never overwritten from outside
  const who = { email: 'pat@example.test', name: 'Pat Example' }; const a = await CL.addPerson(db, who, { name: 'Pat Example' });
  await assert.rejects(CL.addPerson(db, who, { name: 'pat example' }), (e) => e.status === 409);
  const people = CL.people(await CL.get(db, who.email)); assert.equal(people.length, 1); assert.equal(people[0].id, a.person.id);
  const s = await C.familySlots(db, who, { player: a.person.id, date: DAY, coach: 'nico' }, people); assert.ok(s.slots.length > 0);
  await CL.removePerson(db, who, { id: a.person.id }); assert.equal(CL.people(await CL.get(db, who.email)).length, 0);
});
