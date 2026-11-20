'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const PAY = require('../lib/payroll'); const C = require('../lib/coachcal'); const SCH = require('../lib/schedule');
const { fakeDb } = require('./fake-db');
/* Payroll from the schedule (Nov 20, 2026). Invented people and rates. */
const NOW = Date.parse('2027-02-01T15:00:00Z');
const seed = () => ({ 'backend/state': { blocks: [], bookings: [], privates: [] },
  'players/a': { name: 'Ada Example', coach: 'Nico', status: 'active', enroll: { days: ['Mon', 'Wed'], pbp: { time: '04:00 PM-06:00 PM' } } },
  'players/b': { name: 'Ben Example', coach: 'Lee', status: 'active', enroll: { days: ['Mon'], pbp: { time: '04:00 PM-05:00 PM' } } } });
const fresh = () => { C._clock(() => NOW); C._reset(); SCH._clock(() => NOW); PAY._clock(() => NOW); return fakeDb(seed()); };
const owner = { email: 'own@example.test', owner: true, admin: true, director: true, keys: ['olive'] }; const nico = { email: 'nico@example.test', name: 'Nico', keys: ['nico'] };

test('hours and pay come from the calendar', async () => {
  const db = fresh(); await assert.rejects(PAY.report(db, nico, { from: '2027-03-01', to: '2027-03-07' }), (e) => e.status === 403);
  await PAY.setRate(db, owner, { coach: 'nico', hourly: 40, privPrice: 150, privPct: 70 });
  await SCH.coachBook(db, nico, { player: 'a', date: '2027-03-02', start: 10, dur: 60, court: '5' }, {});
  await SCH.askOff(db, owner, { coach: 'nico', from: '2027-03-03', to: '2027-03-03' }, {});          // Wednesday off: its two hours do not count
  const r = await PAY.report(db, owner, { from: '2027-03-01', to: '2027-03-07' }); const n = r.rows.find((x) => x.key === 'nico');
  assert.equal(n.academyHours, 2); assert.equal(n.privateHours, 1); assert.equal(n.privatePerHour, 105);
  assert.deepEqual(n.pay, { academy: 80, privates: 105, extras: 0, total: 185 });
  const l = r.rows.find((x) => x.key === 'lee'); assert.equal(l.academyHours, 1); assert.equal(l.rate.set, false); assert.equal(r.noRate, 1);
});
test('extras: a coach asks, an owner approves', async () => {
  const CALm = require('../lib/calendar'); const T = CALm.todayET(); const D1 = CALm.addDays(T, -2), D2 = CALm.addDays(T, -1), F = CALm.addDays(T, -6), FUT = CALm.addDays(T, 5);
  const db = fresh(); const told = []; await PAY.setRate(db, owner, { coach: 'nico', hourly: 40, privPrice: 150, privPct: 70 });
  await assert.rejects(PAY.addExtra(db, nico, { date: FUT, label: 'Tournament', hours: 4 }), (e) => e.code === 'date');
  const x = await PAY.addExtra(db, nico, { date: D1, label: 'Tournament', hours: 4 }, { tellOwners: async (t) => told.push(t) }); assert.equal(x.status, 'pending'); assert.equal(told.length, 1);
  let r = await PAY.report(db, owner, { from: F, to: T }); assert.equal(r.pending, 1); assert.equal(r.rows.find((y) => y.key === 'nico').pay.extras, 0);
  await PAY.decideExtra(db, owner, { id: x.id, ok: true }); await PAY.addExtra(db, owner, { coach: 'nico', date: D2, label: 'Bonus', amount: 50 });
  r = await PAY.report(db, owner, { from: F, to: T }); assert.equal(r.rows.find((y) => y.key === 'nico').pay.extras, 210);
  assert.equal((await PAY.myExtras(db, nico)).list.length, 2);
});
