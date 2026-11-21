'use strict';
const test = require('node:test'); const assert = require('node:assert');
const C = require('../lib/coachcal');

test('session times on a record become hours', () => {
  assert.deepStrictEqual(C.ranges('04:00 PM-06:30 PM'), [[16, 18.5]]);
  assert.deepStrictEqual(C.ranges('07:45 AM-09:45 AM, 04:00 PM-06:00 PM'), [[7.75, 9.75], [16, 18]]);
  assert.deepStrictEqual(C.ranges('nothing'), []);
});
test('the names on players and on the backend are the same coach', () => {
  assert.ok(C.sameCoach('nico', 'Nico Fernandez')); assert.ok(C.sameCoach('et', 'Etienne Dumas')); assert.ok(C.sameCoach('mauri', 'Mauricio Paiva')); assert.ok(C.sameCoach('tono', 'Toño Fernandez'));
  assert.ok(!C.sameCoach('nico', 'Eric Samuelsson'));
});
test('academy hours come from the players on the coach, a coach in two groups gets both', () => {
  const players = [
    { coach: 'Eric', enroll: { days: ['Mon', 'Wed'], pbp: { time: '04:00 PM-06:30 PM' } } },
    { coach: 'Nico', coach2: 'Eric', enroll: { days: [], pbp: { time: '07:45 AM-09:45 AM' } } },
    { coach: 'Kamryn', enroll: { days: ['Mon'], pbp: { time: '04:30 PM-06:00 PM' } } }];
  const a = C.academyHours(players, 'eric');
  assert.deepStrictEqual(a.mon, [[7.75, 9.75], [16, 18.5]]); assert.deepStrictEqual(a.tue, [[7.75, 9.75]]); assert.deepStrictEqual(a.sat, []);
});
test('open times: inside 7 to 7, around the academy hours, a private and time off; nothing in the past', () => {
  const academy = { sun: [], mon: [[16, 18.5]], tue: [], wed: [], thu: [], fri: [], sat: [] };
  const d = C.dayOf({ date: '2026-11-23', academy, privates: [{ date: '2026-11-23', start: 10, dur: 1 }], cal: { off: [{ date: '2026-11-23', start: 12, end: 14 }] }, durMin: 60, now: { date: '2026-11-19', h: 14 } });
  const starts = d.slots.map((s) => s.start);
  assert.ok(starts.includes(7) && starts.includes(9) && !starts.includes(9.5) && !starts.includes(10) && starts.includes(11));
  assert.ok(!starts.includes(11.5) && !starts.includes(13) && starts.includes(14) && starts.includes(15) && !starts.includes(15.5) && !starts.includes(17));
  assert.ok(!starts.includes(18) && starts.includes(18.5) === false);   // 18:30 + 1 h would pass 7 PM
  const today = C.dayOf({ date: '2026-11-19', academy, privates: [], cal: {}, durMin: 60, now: { date: '2026-11-19', h: 14 } });
  assert.strictEqual(today.slots[0].start, 15.5);                        // not inside the next hour
  assert.strictEqual(C.dayOf({ date: '2026-11-18', academy, privates: [], cal: {}, durMin: 60, now: { date: '2026-11-19', h: 14 } }).slots.length, 0);
});

test('10 & Under: the afternoon on weekdays, the morning on Saturday; every other program keeps all its hours', () => {
  const CC = require('../lib/coachcal');
  const en = { programName: '10 & Under Advanced', days: ['Mon', 'Wed', 'Sat'], pbp: { time: '04:30 PM-06:30 PM, 09:00 AM-10:30 AM' } };
  assert.deepEqual(CC.timesByDay(en), { mon: '4:30–6:30 PM', wed: '4:30–6:30 PM', sat: '9:00–10:30 AM' });
  assert.deepEqual(CC.rangesOn(en, 'sat'), [[9, 10.5]]); assert.deepEqual(CC.rangesOn(en, 'tue'), [[16.5, 18.5]]);
  assert.deepEqual(CC.timesByDay({ programName: 'Full Time', days: ['Mon'], time: '07:45 AM-09:30 AM, 02:00 PM-04:00 PM' }), { mon: '7:45–9:30 AM, 2:00–4:00 PM' });
  assert.deepEqual(CC.timesByDay({ programName: '10 & Under Pathway', days: ['Tue'], time: '04:30 PM-06:00 PM' }), { tue: '4:30–6:00 PM' });
  const players = [{ coach: 'Kim', enroll: en }];
  const h = CC.academyHours(players, 'kim'); assert.deepEqual(h.sat, [[9, 10.5]]); assert.deepEqual(h.mon, [[16.5, 18.5]]);
});
