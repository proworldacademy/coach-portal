'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const N = require('../lib/notices');
const PUSH = require('../lib/push');
const SMS = require('../lib/sms');
const NOTIFY = require('../lib/notify');
const { fakeDb } = require('./fake-db');

/* Notifications for the parents (Nov 22, 2026). Invented families; the phones and JustCall are stand-ins. */
const SUB = (n) => ({ endpoint: 'https://push.example.test/send/' + n + '-abcdefghij', keys: { p256dh: 'BPc0'.repeat(20), auth: 'authauthauthauth' } });
const at = (s) => Date.parse(s);                                       // 2026-12-10T15:00Z = 10 am in Florida
const seed = () => ({
  'settings/notify': { justcallKey: 'k', justcallSecret: 's', justcallNumber: '+15614030008', textsOn: true },
  'players/as-ada': { name: 'Ada Example', group: 'as', status: 'active' },
  'players/as-ada/private/contact': { email: 'Pat@Example.test', guardian: 'Pat Example', logins: [{ email: 'sam@example.test', name: 'Sam Example' }] },
  'players/u10-bo': { name: 'Bo Sample', group: 'u10', status: 'active', purchases: [{ kind: 'camp', camp: 'wiu10' }] },
  'players/u10-bo/private/contact': { email: 'lee@example.test', guardian: 'Lee Sample', phone: '(561) 555-0102' },
  'players/u10-bo/private/sms': { optIn: true, at: 1, source: 'enroll', phone: '+15615550102' },
  'players/ft-cy': { name: 'Cy Trial', group: 'ft', status: 'active' },
  'players/ft-cy/private/contact': { email: 'kim@example.test', guardian: 'Kim Trial', phone: '(561) 555-0103' },
  'players/ft-cy/private/sms': { optIn: true, at: 1, source: 'enroll', phone: '+15615550103' },
  'players/old-dee': { name: 'Dee Gone', group: 'as', status: 'finished' },
  'players/old-dee/private/contact': { email: 'gone@example.test' }
});
const OWNER = { email: 'owner@example.test', name: 'Owner', owner: true, texting: true };
async function setup(now) {
  PUSH._reset(); NOTIFY.forget(); const db = fakeDb(seed()); N._clock(() => at(now));
  await PUSH.subscribe(db, { email: 'pat@example.test' }, { subscription: SUB(1) });
  const pushes = []; PUSH._useSender(async (sub, payload) => { pushes.push([sub.endpoint, JSON.parse(payload)]); });
  const texts = []; SMS._useFetch(async (url, o) => { const b = JSON.parse(o.body); texts.push(b); return { ok: true, status: 200, json: async () => ({ data: { id: 'jc_' + texts.length } }) }; });
  return { db, pushes, texts };
}
const fast = { textBudgetMs: 10000, textDelayMs: 0 };
const done = () => { PUSH._useSender(null); SMS._useFetch(null); N._clock(null); };

test('notices: the families are the live players\' parents, with every e-mail that signs in', async () => {
  const { db } = await setup('2026-12-01T15:00:00Z');
  const dir = await N.directory(db); assert.equal(dir.length, 3);
  const pat = dir.find((f) => f.key === 'pat@example.test'); assert.deepEqual(Array.from(pat.emails).sort(), ['pat@example.test', 'sam@example.test']);
  assert.equal((await N.count(db, { kind: 'news', group: '' })).families, 3);
  assert.deepEqual(await N.count(db, { kind: 'weather', group: 'u10', text: true }), { families: 1, app: 0, text: 1 });
  assert.deepEqual(await N.count(db, { kind: 'camp', group: 'nocamp', camp: 'wi13' }), { families: 2, app: 1, text: 0 }, 'the family that bought the camp is left out, and a camp never goes by text');
  done();
});

test('notices: weather goes to the phones now, a text to the families without the app, and it sits behind the bell', async () => {
  const { db, pushes, texts } = await setup('2026-12-01T15:00:00Z');
  const out = await N.create(db, OWNER, { kind: 'weather', title: 'Rain delay', body: 'We are watching the weather.', text: true }, fast);
  assert.deepEqual(out.stats, { families: 3, app: 1, phones: 1, text: 2 });
  assert.equal(pushes.length, 1); assert.equal(pushes[0][1].title, 'Rain delay'); assert.equal(pushes[0][1].url, '/family#notices');
  assert.deepEqual(texts.map((t) => t.contact_number).sort(), ['+15615550102', '+15615550103']); assert.match(texts[0].body, /^Rain delay\. We are watching the weather\./);
  const sam = await N.forFamily(db, 'Sam@example.test'); assert.equal(sam.unread, 1); assert.equal(sam.items[0].title, 'Rain delay');
  N._clock(() => at('2026-12-01T15:05:00Z')); await N.markRead(db, 'sam@example.test'); assert.equal((await N.forFamily(db, 'sam@example.test')).unread, 0);
  assert.equal((await N.forFamily(db, 'pat@example.test')).unread, 1, 'each parent has their own read mark');
  assert.equal((await N.forFamily(db, 'gone@example.test')).items.length, 0);
  done();
});

test('notices: a parent who switched a kind off does not get it; no texting permission, no text', async () => {
  const { db, pushes, texts } = await setup('2026-12-01T15:00:00Z');
  assert.deepEqual((await N.setPrefs(db, 'pat@example.test', { weather: false, junk: true })).prefs, { weather: false, events: true, camps: true, text: true });
  await N.setPrefs(db, 'lee@example.test', { text: false });
  const out = await N.create(db, { email: 'dir@example.test', name: 'Director', director: true }, { kind: 'weather', title: 'Courts closed today', body: 'Sessions are off.', text: true }, fast);
  assert.equal(pushes.length, 0); assert.equal(texts.length, 0); assert.equal(out.stats.families, 3);
  assert.equal((await N.forFamily(db, 'pat@example.test')).items.length, 0); assert.equal((await N.forFamily(db, 'sam@example.test')).items.length, 1);
  const out2 = await N.create(db, OWNER, { kind: 'weather', title: 'We are back on', body: 'Sessions are on.', text: true }, fast);
  assert.equal(out2.stats.text, 1); assert.deepEqual(texts.map((t) => t.contact_number), ['+15615550103'], 'the parent who said no texts is left alone');
  await assert.rejects(() => N.create(db, OWNER, { kind: 'news', title: '', body: 'x' }), /title/);
  await assert.rejects(() => N.create(db, OWNER, { kind: 'camp', group: 'nocamp', camp: 'nope', title: 'Camp', body: 'x' }), /camp/);
  done();
});

test('notices: one given a time waits for the clock, can be cancelled, and reminds the evening before', async () => {
  const { db, pushes } = await setup('2026-12-01T15:00:00Z');
  const a = await N.create(db, OWNER, { kind: 'event', group: 'as', title: 'Mental session', body: 'Wednesday at 5 PM in the clubhouse.', date: '2026-12-09', sendAt: at('2026-12-02T15:00:00Z'), remind: true, post: true });
  const b = await N.create(db, OWNER, { kind: 'news', title: 'Later', body: 'x', sendAt: at('2026-12-03T15:00:00Z') });
  assert.ok(a.scheduled && b.scheduled); assert.equal(pushes.length, 0);
  assert.equal((await db.collection('familyNews').get()).docs.length, 1, 'the event also shows in Coming up');
  let l = await N.list(db, OWNER); assert.equal(l.scheduled.length, 2); assert.equal(l.sent.length, 0); assert.equal(l.texting, true);
  await N.cancel(db, OWNER, { id: b.id }); await assert.rejects(() => N.cancel(db, OWNER, { id: b.id }), /already/);
  assert.deepEqual(await N.tick(db), { sent: 0, reminders: 0, camps: 0, texts: 0 });
  N._clock(() => at('2026-12-02T15:01:00Z')); assert.equal((await N.tick(db)).sent, 1); assert.equal(pushes.length, 1);
  assert.equal((await N.tick(db)).sent, 0, 'once');
  l = await N.list(db, OWNER); assert.deepEqual(l.waitingReminders.map((x) => x.date), ['2026-12-09']);
  N._clock(() => at('2026-12-08T17:00:00Z')); assert.equal((await N.tick(db)).reminders, 0, 'noon is not the evening');
  N._clock(() => at('2026-12-08T23:10:00Z')); assert.equal((await N.tick(db)).reminders, 1);
  assert.equal(pushes.length, 2); assert.equal(pushes[1][1].title, 'Tomorrow: Mental session');
  assert.equal((await N.tick(db)).reminders, 0); assert.equal((await N.forFamily(db, 'pat@example.test')).items.length, 2);
  assert.equal((await N.forFamily(db, 'kim@example.test')).items.length, 0, 'Full Time was not in the group');
  done();
});

test('notices: a camp reminds by itself ten and three days before, only the families not signed up, unless switched off', async () => {
  const { db, pushes } = await setup('2026-12-11T15:00:00Z');                  // Winter Camp starts Dec 21
  const t = await N.tick(db); assert.equal(t.camps, 1); assert.equal(pushes.length, 1);
  assert.match(pushes[0][1].title, /Winter Camp 2026 starts in 10 days/); assert.equal(pushes[0][1].url, '/enroll?camp=wi13');
  assert.equal((await N.tick(db)).camps, 0);
  assert.equal((await N.forFamily(db, 'lee@example.test')).items.length, 0, 'already signed up');
  assert.equal((await N.forFamily(db, 'kim@example.test')).items.length, 1);
  N._clock(() => at('2026-12-12T15:00:00Z')); assert.equal((await N.tick(db)).camps, 0);
  await N.saveSettings(db, OWNER, { campAuto: false });
  N._clock(() => at('2026-12-18T15:00:00Z')); assert.equal((await N.tick(db)).camps, 0);
  await N.saveSettings(db, OWNER, { campAuto: true }); assert.equal((await N.tick(db)).camps, 1);
  N._clock(() => at('2026-12-18T08:00:00Z')); const l = await N.list(db, OWNER); assert.equal(l.sent.filter((x) => x.auto).length, 2); assert.equal(l.sent[0].by, '');
  done();
});
