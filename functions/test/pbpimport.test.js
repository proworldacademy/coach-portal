'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { fakeDb } = require('./fake-db'); const PBP = require('../lib/pbpimport');
const seed = () => fakeDb({
  'players/a1': { name: 'Mia Rivera', group: 'as', status: 'active' },
  'players/a2': { name: 'Liam R', group: 'ft', status: 'away' },
  'players/a3': { name: 'Old Timer', group: '', status: 'finished' },
  'players/a4': { name: 'Stays Here', group: 'u10', status: 'active' },
  'players/a5': { name: 'Tess Tour', group: 'tour', status: 'active' }
});
const ROWS = [
  { child: 'Mia Rivera', age: 12, parent: 'Maria Rivera', email: 'Maria@Example.com', phone: '(561) 555-0102', program: 'Afterschool | Fall 2026', days: ['Tue', 'Thu'], plan: '2 Days per week | Monthly' },
  { child: 'Mia Rivera', parent: 'Maria Rivera', email: 'maria@example.com', program: 'Fitness | Fall 2026', days: ['Mon'], plan: 'Monthly' },
  { child: 'Liam Rivera', parent: 'Maria Rivera', email: 'maria@example.com', phone: '5615550102', program: 'Full Time Program | Fall 2026', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], plan: 'Monthly' },
  { child: 'Nora New', parent: 'Nick New', email: 'nick@example.com', phone: '5615550199', program: '10 & Under Pathway | Fall 2026', days: ['Sat'], plan: '10 FLEX Sessions | Tennis Only' },
  { child: 'Old Timer', parent: 'Olga Timer', email: 'olga@example.com', program: 'Afterschool | Fall 2026', days: ['Wed'], plan: '1 Day per week | Monthly' },
  { child: 'Tess Tour', parent: 'Tom Tour', email: 'tom@example.com', program: 'Full Time Program | Fall 2026', days: ['Mon', 'Wed'], plan: 'Monthly' }
];
test('the Play by Point import: preview writes nothing; apply sets the days, the status and the contact card, adds who is missing, removes nobody', async () => {
  const db = seed();
  const pv = await PBP.preview(db, ROWS);
  assert.equal(pv.rows, 5);   // Mia's two programs are one child: the school-day program decides the days
  assert.deepEqual(pv.update.map((u) => u.name).sort(), ['Liam R', 'Mia Rivera', 'Old Timer', 'Tess Tour']);
  assert.equal(pv.update.find((u) => u.name === 'Liam R').how, 'first name + initial');
  assert.deepEqual(pv.create.map((c) => c.child), ['Nora New']); assert.equal(pv.create[0].bySession, true);
  assert.deepEqual(pv.notInPbp.map((p) => p.name), ['Stays Here']);
  assert.equal((await db.doc('players/a1').get()).data().enroll, undefined);
  const out = await PBP.apply(db, ROWS, { email: 'owner@example.com' });
  assert.deepEqual([out.updated, out.created], [4, 1]);
  const mia = (await db.doc('players/a1').get()).data();
  assert.deepEqual(mia.enroll.days, ['Tue', 'Thu']); assert.equal(mia.enroll.programShort, 'Afterschool'); assert.deepEqual(mia.enroll.pbp.also, ['Fitness | Fall 2026']);
  const c = (await db.doc('players/a1/private/contact').get()).data();
  assert.deepEqual([c.guardian, c.email, c.phone], ['Maria Rivera', 'maria@example.com', '5615550102']);
  assert.equal((await db.doc('players/a2').get()).data().status, 'active');
  assert.equal((await db.doc('players/a3').get()).data().status, 'active'); assert.equal((await db.doc('players/a3').get()).data().group, 'as');
  assert.equal((await db.doc('players/a5').get()).data().group, 'tour');
  assert.equal((await db.doc('players/a4').get()).data().status, 'active');
  const all = (await db.collection('players').get()).docs.map((d) => d.data());
  const nora = all.find((p) => p.name === 'Nora New'); assert.equal(nora.group, 'u10'); assert.equal(nora.enroll.days, undefined); assert.equal(nora.enroll.pbp.bySession, true);
  // a second run changes nothing more
  const again = await PBP.preview(db, ROWS); assert.equal(again.create.length, 0); assert.equal(again.update.every((u) => u.changes.length === 0), true);
});
