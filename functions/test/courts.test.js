'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const COURTS = require('../lib/courts');
const C = require('../lib/coachcal');
const { fakeDb } = require('./fake-db');

/* The courts and the privates that hold them (Nov 19, 2026). Invented people; a Monday far ahead so nothing is in the past. */
const DAY = '2027-03-01';   // a Monday
const seed = () => ({
  'players/p1': { name: 'Ada Example', coach: 'Nico', status: 'active', enroll: { days: ['Mon'], pbp: { time: '04:00 PM-06:00 PM' } } },
  'backend/state': { blocks: [{ id: 'b1', label: 'Afterschool', courts: ['1', '2', '3'], dows: [1, 2, 3, 4, 5], start: 16, end: 18 }], exceptions: [{ court: '3', date: DAY, h: 16 }], bookings: [{ id: 'k1', court: '5', date: DAY, start: 10, dur: 1, name: 'A renter' }], privates: [] },
  'groups/after': { coaches: ['Nico'], directors: ['kam@example.test'] }
});
const who = { email: 'parent@example.test', name: 'Pat Parent' }; const players = [{ id: 'p1', name: 'Ada Example', coach: 'Nico' }];

test('the campus: Stadium and 1 to 12 hard, 13 to 15 clay, 16, 17 and Field C not open yet', () => {
  const t = COURTS.COURTS.filter((c) => c.kind === 'tennis');
  assert.equal(t.filter((c) => c.type === 'hard' && !c.soon).length, 13); assert.deepEqual(t.filter((c) => c.type === 'clay').map((c) => c.id), ['13', '14', '15']);
  assert.deepEqual(COURTS.COURTS.filter((c) => c.soon).map((c) => c.id), ['16', '17', 'C']); assert.equal(COURTS.byId('S').name, 'Stadium');
  assert.deepEqual(['1', '4', '5', '7', '8', '12'].map((i) => COURTS.byId(i).bank), ['h1', 'h1', 'h2', 'h2', 'h3', 'h3']);
});
test('free courts: an academy block, a released half hour, a rental and a hold all count', async () => {
  const db = fakeDb(seed());
  let f = (await COURTS.free(db, DAY, 16, 60)).map((c) => c.id);
  assert.ok(!f.includes('1') && !f.includes('2') && !f.includes('3'), 'court 3 is released for 4:00 only, so the hour is not free'); assert.ok(f.includes('4') && f.includes('S') && f.includes('13') && !f.includes('16'));
  assert.ok((await COURTS.free(db, DAY, 16, 30)).some((c) => c.id === '3'), 'the released half hour is free');
  assert.ok(!(await COURTS.free(db, DAY, 10, 60)).some((c) => c.id === '5'), 'the rental keeps court 5');
  assert.ok((await COURTS.free(db, DAY, 11, 60)).some((c) => c.id === '5')); assert.equal((await COURTS.free(db, DAY, 20.5, 60)).length, 0, 'nothing runs past closing');
});
test('a family books a private: the coach and the court go together, and neither can be given twice', async () => {
  const db = fakeDb(seed()); C._clock(() => Date.parse('2027-02-20T15:00:00Z')); const told = [];
  const deps = { tellCoach: async (n, t) => told.push(['coach', n, t]), tellDesk: async (t) => told.push(['desk', t]), tellFamily: async (e, m) => told.push(['family', e, m.subject, m.text]) };
  try {
    const cs = await C.familyCourts(db, who, { player: 'p1', kind: 'tennis', coach: 'nico', date: DAY, start: 10, dur: 60 }, players);
    assert.ok(cs.needs && cs.courts.some((c) => c.id === '6') && !cs.courts.some((c) => c.id === '5'));
    await assert.rejects(() => C.familyBook(db, who, { player: 'p1', kind: 'tennis', coach: 'nico', date: DAY, start: 10, dur: 60 }, players, deps), /court/i, 'a tennis private needs a court');
    await assert.rejects(() => C.familyBook(db, who, { player: 'p1', kind: 'tennis', coach: 'nico', date: DAY, start: 10, dur: 60, court: '5' }, players, deps), /court was just taken/);
    assert.ok(!db._docs.has('familyPrivates/nico_' + DAY + '_1000'), 'no court, no lesson: nothing is left behind');
    const out = await C.familyBook(db, who, { player: 'p1', kind: 'tennis', coach: 'nico', date: DAY, start: 10, dur: 60, court: '6' }, players, deps);
    assert.equal(out.courtName, 'Court 6'); const rec = db._docs.get('familyPrivates/' + out.id); assert.equal(rec.status, 'confirmed'); assert.equal(rec.court, '6'); assert.equal(rec.ackAt, 0);
    assert.ok(db._docs.has('courtHolds/' + DAY + '_6_1000') && db._docs.has('courtHolds/' + DAY + '_6_1050') && !db._docs.has('courtHolds/' + DAY + '_6_1100'));
    assert.ok(told.some((x) => x[0] === 'coach' && /Court 6/.test(x[2]) && /Received/.test(x[2])) && told.some((x) => x[0] === 'family' && /confirmed/.test(x[2]) && /Where: Court 6/.test(x[3])) && told.some((x) => x[0] === 'desk'));
    assert.ok(!(await COURTS.free(db, DAY, 10.5, 30)).some((c) => c.id === '6'), 'the court is gone for everyone else');
    await assert.rejects(() => C.familyBook(db, who, { player: 'p1', kind: 'tennis', coach: 'nico', date: DAY, start: 10, dur: 60, court: '7' }, players, deps), /time was just taken/, 'the coach is taken');
    // the coach's week shows the court and that it is not marked yet; Received by the coach, not by another coach
    const wk = await C.week(db, { email: 'nico@example.test', keys: ['Nico'], director: false }, { from: DAY }); const it = wk.days[0].items.find((i) => i.what === 'private');
    assert.equal(it.court, 'Court 6'); assert.equal(it.ack, false); assert.equal(it.id, out.id);
    await assert.rejects(() => C.ack(db, { email: 'eric@example.test', keys: ['Eric'], director: false }, { id: out.id }), /another coach/);
    await C.ack(db, { email: 'nico@example.test', keys: ['Nico'], director: false }, { id: out.id }); assert.ok(db._docs.get('familyPrivates/' + out.id).ackAt > 0);
    // cancelled by the family: the court comes back
    await C.familyCancel(db, who, { id: out.id }, players, deps); assert.ok(!db._docs.has('courtHolds/' + DAY + '_6_1000')); assert.ok((await COURTS.free(db, DAY, 10, 60)).some((c) => c.id === '6'));
    // fitness takes no court
    db._docs.set('settings/coachCal', { fitness: ['Tara'], mental: ['Toño'], hide: [] });
    assert.deepEqual(await C.familyCourts(db, who, { player: 'p1', kind: 'fitness', coach: 'tara', date: DAY, start: 11, dur: 60 }, players), { needs: false, courts: [] });
    const fit = await C.familyBook(db, who, { player: 'p1', kind: 'fitness', coach: 'tara', date: DAY, start: 11, dur: 60 }, players, deps); assert.equal(fit.court, ''); assert.ok(told.some((x) => x[0] === 'coach' && x[1] === 'Tara'));
  } finally { C._clock(null); }
});
test('not marked Received: the coach after one hour and after three, the director after six or when the lesson is close, quiet at night', () => {
  const at = 1e12; const H = 36e5; const x = { status: 'confirmed', at, ackAt: 0, nudges: 0 };
  assert.equal(C.chaseStep(x, at + 0.5 * H, 48, 12), null); assert.equal(C.chaseStep(x, at + 1.1 * H, 48, 12), 'coach');
  assert.equal(C.chaseStep(Object.assign({}, x, { nudges: 1 }), at + 2 * H, 48, 12), null); assert.equal(C.chaseStep(Object.assign({}, x, { nudges: 1 }), at + 3.2 * H, 48, 12), 'coach');
  assert.equal(C.chaseStep(Object.assign({}, x, { nudges: 2 }), at + 6.1 * H, 48, 12), 'director'); assert.equal(C.chaseStep(Object.assign({}, x, { nudges: 2, dirAt: 5 }), at + 9 * H, 48, 12), null);
  assert.equal(C.chaseStep(x, at + 0.6 * H, 2.5, 12), 'director', 'a lesson three hours away goes to the director after half an hour');
  assert.equal(C.chaseStep(x, at + 2 * H, 48, 23), null, 'not at night'); assert.equal(C.chaseStep(x, at + 2 * H, 10, 23), 'coach', 'unless the lesson is in the morning');
  assert.equal(C.chaseStep(Object.assign({}, x, { ackAt: 5 }), at + 9 * H, 48, 12), null); assert.equal(C.chaseStep(Object.assign({}, x, { status: 'canceled' }), at + 9 * H, 48, 12), null);
});
test('the chase writes to the coach, then to the director of the coach\'s group', async () => {
  const db = fakeDb(seed()); const at = Date.parse('2027-02-25T15:00:00Z'); const told = [];
  db._docs.set('familyPrivates/nico_' + DAY + '_1000', { player: 'p1', playerName: 'Ada Example', coach: 'Nico', key: 'nico', kind: 'tennis', date: DAY, start: 10, dur: 60, court: '6', status: 'confirmed', at, ackAt: 0, nudges: 0 });
  const deps = { tellCoach: async (n, t) => told.push(['coach', n, t]), tellDirectors: async (e, t) => told.push(['dir', e, t]) };
  let out = await C.chase(db, at + 1.2 * 36e5, deps); assert.deepEqual(out, { coach: 1, director: 0 }); assert.match(told[0][2], /Court 6/);
  out = await C.chase(db, at + 1.5 * 36e5, deps); assert.deepEqual(out, { coach: 0, director: 0 }, 'not twice in a row');
  out = await C.chase(db, at + 6.5 * 36e5, deps); assert.equal(out.director, 1); assert.deepEqual(told[told.length - 1][1], ['kam@example.test']); assert.match(told[told.length - 1][2], /Nico has not marked/);
  out = await C.chase(db, at + 8 * 36e5, deps); assert.equal(out.director, 0, 'the director is told once');
});

test('no staff schedule on file: nothing is offered and nothing can be held', async () => {
  const db = fakeDb({ 'backend/state': { privates: [] } });
  assert.deepEqual(await COURTS.free(db, '2026-12-01', 10, 60, 'tennis'), []);
  await assert.rejects(db.runTransaction((t) => COURTS.holdIn(t, db, { date: '2026-12-01', court: '5', start: 10, durMin: 60, ref: 'x' })), (e) => e.status === 503);
});
