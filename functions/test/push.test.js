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

// ── the App Store app: Apple's notifications (Nov 15, 2026) ──
test('a phone with the app registers a token; a send goes to it through Apple when the key is set', async () => {
  PUSH._reset(); const calls = []; PUSH._useApns(async (token, payload, cfg) => { calls.push({ token, payload, cfg }); });
  const { fakeDb } = require('./fake-db'); const tok = 'a'.repeat(64);
  const db = fakeDb({ 'settings/apns': { keyId: 'ABC1234567', p8: 'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg' } });
  await PUSH.registerApns(db, { email: 'lee@example.test' }, { token: tok.toUpperCase(), ua: 'iPhone' });
  const out = await PUSH.send(db, ['lee@example.test'], { title: "Di's family", body: 'Yes, we will be there', url: '/portal#/messages/as-di-m', tag: 'chat-as-di-m' });
  assert.equal(out.sent, 1); assert.equal(calls[0].token, tok); assert.equal(calls[0].payload.aps.alert.title, "Di's family"); assert.equal(calls[0].payload.url, '/portal#/messages/as-di-m'); assert.equal(calls[0].cfg.bundle, 'com.proworldacademy.app');
  PUSH._useApns(null);
});
test('a call rings on the app: the ringtone, time-sensitive, short-lived, and "Missed call" replaces it without a sound', async () => {
  PUSH._reset(); const calls = []; PUSH._useApns(async (token, payload, cfg, opt) => { calls.push({ payload, opt }); });
  const { fakeDb } = require('./fake-db');
  const db = fakeDb({ 'settings/apns': { keyId: 'ABC1234567', p8: 'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg' } });
  await PUSH.registerApns(db, { email: 'lee@example.test' }, { token: 'b'.repeat(64) });
  await PUSH.send(db, ['lee@example.test'], { title: 'Kim is calling', body: 'Voice call', url: '/team#/call/c9', tag: 'call-c9', ring: true });
  assert.equal(calls[0].payload.aps.sound, 'ring.wav'); assert.equal(calls[0].payload.aps['interruption-level'], 'time-sensitive'); assert.deepEqual(calls[0].opt, { ttl: 60, collapse: 'call-c9' });
  await PUSH.send(db, ['lee@example.test'], { title: 'Missed call from Kim', body: '', url: '/team#/c/x', tag: 'call-c9', quiet: true });
  assert.equal(calls[1].payload.aps.sound, undefined); assert.equal(calls[1].payload.aps['interruption-level'], undefined); assert.deepEqual(calls[1].opt, { ttl: 3600, collapse: 'call-c9' });
  await PUSH.send(db, ['lee@example.test'], { title: 'A message', body: 'hi', tag: 'team-x' });
  assert.equal(calls[2].payload.aps.sound, 'default'); assert.deepEqual(calls[2].opt, { ttl: 3600, collapse: '' });
  PUSH._useApns(null);
});
test('who has notifications on: a phone on file is on, a phone that said no is blocked, the rest are not yet', async () => {
  PUSH._reset(); const { fakeDb } = require('./fake-db'); const db = fakeDb({});
  await PUSH.registerApns(db, { email: 'kim@example.test' }, { token: 'c'.repeat(64) }); await PUSH.setState(db, { email: 'kim@example.test' }, { state: 'granted' });
  await PUSH.setState(db, { email: 'lee@example.test' }, { state: 'denied' }); await PUSH.setState(db, { email: 'dee@example.test' }, { state: 'prompt' });
  await PUSH.subscribe(db, { email: 'web@example.test' }, { subscription: SUB(7) });
  await assert.rejects(() => PUSH.setState(db, KIM, { state: 'whatever' }));
  const r = await PUSH.who(db, ['kim', 'lee', 'dee', 'web', 'new'].map((n) => ({ email: n + '@example.test', name: n })));
  assert.deepEqual(r.people.map((p) => p.status), ['on', 'blocked', 'asked', 'browser', 'never']); assert.equal(r.people[0].app, 1);
  assert.equal((await PUSH.who(db, { people: [{ email: 'kim@example.test', name: 'kim' }] })).people[0].status, 'on');   // the team list as lib/team.js hands it over
});
test('without the Apple key the app phones are skipped, not failed; a token Apple forgot is removed; a bad token is refused', async () => {
  PUSH._reset(); const { fakeDb } = require('./fake-db'); const tok = 'b'.repeat(64);
  const db = fakeDb({}); await PUSH.registerApns(db, { email: 'lee@example.test' }, { token: tok });
  const a = await PUSH.send(db, ['lee@example.test'], { title: 't', body: 'b' }); assert.equal(a.sent, 0); assert.equal(a.skipped, 1); assert.equal(a.failed, 0);
  PUSH._reset(); await db.doc('settings/apns').set({ keyId: 'ABC1234567', p8: 'MIGT' });
  PUSH._useApns(async () => { const e = new Error('gone'); e.statusCode = 410; throw e; });
  const b = await PUSH.send(db, ['lee@example.test'], { title: 't', body: 'b' }); assert.equal(b.gone, 1);
  const c = await PUSH.send(db, ['lee@example.test'], { title: 't', body: 'b' }); assert.equal(c.sent + c.gone + c.failed, 0);
  await assert.rejects(PUSH.registerApns(db, { email: 'lee@example.test' }, { token: 'nope' }), (e) => e.status === 400);
  PUSH._useApns(null); PUSH._reset();
});
