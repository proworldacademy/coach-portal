'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PUSH = require('../lib/push');
const { fakeDb } = require('./fake-db');

/* Notifications on the phone (Nov 13, 2026). Invented staff only; the network is swapped out. */
const KIM = { email: 'kim@example.test' }; const LEE = { email: 'lee@example.test' };
const SUB = (n) => ({ endpoint: 'https://push.example.test/send/' + n + '-abcdefghij', keys: { p256dh: 'BPc0'.repeat(20), auth: 'authauthauthauth' } });

test('the keys are made once and kept', async () => {
  PUSH._reset(); const db = fakeDb({});
  const a = await PUSH.keys(db); PUSH._reset(); const b = await PUSH.keys(db);
  assert.ok(a.publicKey.length > 40 && a.privateKey.length > 20);
  assert.equal(a.publicKey, b.publicKey);
});
test('a phone subscribes under its person; a bad subscription is refused', async () => {
  const db = fakeDb({});
  await PUSH.subscribe(db, KIM, { subscription: SUB(1), ua: 'test phone' });
  await assert.rejects(() => PUSH.subscribe(db, KIM, { subscription: { endpoint: 'http://not-secure', keys: {} } }));
  await assert.rejects(() => PUSH.subscribe(db, KIM, { subscription: { endpoint: SUB(2).endpoint, keys: { p256dh: '', auth: '' } } }));
});
test('a notification goes to that person\'s phones only; a phone that is gone is forgotten', async () => {
  PUSH._reset(); const db = fakeDb({});
  await PUSH.subscribe(db, KIM, { subscription: SUB(1) }); await PUSH.subscribe(db, KIM, { subscription: SUB(2) }); await PUSH.subscribe(db, LEE, { subscription: SUB(3) });
  const got = [];
  PUSH._useSender(async (sub, payload) => { if (/\/2-/.test(sub.endpoint)) { const e = new Error('gone'); e.statusCode = 410; throw e; } got.push([sub.endpoint, JSON.parse(payload)]); });
  const r = await PUSH.send(db, ['kim@example.test'], { title: 'Bo K.\'s family', body: 'Thanks, see you Thursday', url: '/portal#/messages/ft-bo-k' });
  assert.deepEqual([r.sent, r.gone, r.failed], [1, 1, 0]);
  assert.equal(got.length, 1); assert.match(got[0][0], /\/1-/); assert.equal(got[0][1].url, '/portal#/messages/ft-bo-k');
  const r2 = await PUSH.send(db, ['kim@example.test'], { title: 'x', body: 'y' });
  assert.deepEqual([r2.sent, r2.gone], [1, 0]);                       // the gone phone was removed
  await PUSH.unsubscribe(db, LEE, { endpoint: SUB(1).endpoint });     // not Lee's phone: stays
  const r3 = await PUSH.send(db, ['kim@example.test'], { title: 'x', body: 'y' }); assert.equal(r3.sent, 1);
  await PUSH.unsubscribe(db, KIM, { endpoint: SUB(1).endpoint });
  const r4 = await PUSH.send(db, ['kim@example.test'], { title: 'x', body: 'y' }); assert.equal(r4.sent, 0);
  PUSH._useSender(null);
});
