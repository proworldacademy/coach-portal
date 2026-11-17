/* Calls through Twilio (Nov 17, 2026): the pass the app gets, what Twilio is told for a call out and a call in, the owners' set-up. */
'use strict';
const test = require('node:test'); const assert = require('node:assert'); const crypto = require('crypto');
const { fakeDb } = require('./fake-db'); const VOICE = require('../lib/voice');
const AC = 'AC' + 'a'.repeat(32), SK = 'SK' + 'b'.repeat(32), SECRET = 's'.repeat(32), KEY = 'k'.repeat(48);
const seed = (extra) => fakeDb(Object.assign({
  'settings/twilio': { accountSid: AC, keySid: SK, keySecret: SECRET, appSid: 'AP' + 'c'.repeat(32), hookKey: KEY },
  'staff/lee@example.test': { name: 'Lee Coach', role: 'coach', active: true, voiceNumber: '+15615550100' },
  'staff/kim@example.test': { name: 'Kim Coach', role: 'coach', active: true },
  'staff/gone@example.test': { name: 'Gone', role: 'coach', active: false, voiceNumber: '+15615550199' }
}, extra || {}));
const dec = (p) => JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

test('nothing is ready until the three values are saved and connected', async () => {
  assert.deepEqual(await VOICE.token(fakeDb({}), { email: 'lee@example.test' }), { ready: false });
  assert.equal((await VOICE.status(fakeDb({}))).set, false);
});
test('the pass is signed with the key secret, for this person, for an hour', async () => {
  const t = await VOICE.token(seed(), { email: 'lee@example.test' }, { now: 1800000000000 });
  const [h, p, sig] = t.token.split('.'); const pay = dec(p);
  assert.equal(dec(h).cty, 'twilio-fpa;v=1'); assert.equal(pay.iss, SK); assert.equal(pay.sub, AC); assert.equal(pay.exp - pay.iat, 3600);
  assert.equal(pay.grants.identity, 'lee_example_test'); assert.equal(pay.grants.voice.incoming.allow, true); assert.ok(pay.grants.voice.outgoing.application_sid.startsWith('AP'));
  assert.equal(sig, crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'));
  assert.equal(t.canCall, true); assert.equal((await VOICE.token(seed(), { email: 'kim@example.test' })).canCall, false);
  assert.ok(!JSON.stringify(t).includes(SECRET));
});
test('a call out from the app goes from the coach\'s own number', async () => {
  const x = await VOICE.twiml(seed(), KEY, { From: 'client:lee_example_test', To: '(561) 555-0142' });
  assert.match(x, /<Dial callerId="\+15615550100"[^>]*><Number>\+15615550142<\/Number><\/Dial>/);
});
test('a person with no number, or a bad number, places no call', async () => {
  assert.ok(!/<Dial/.test(await VOICE.twiml(seed(), KEY, { From: 'client:kim_example_test', To: '+15615550142' })));
  assert.ok(!/<Dial/.test(await VOICE.twiml(seed(), KEY, { From: 'client:lee_example_test', To: '<Number>911' })));
  assert.ok(!/<Dial/.test(await VOICE.twiml(seed(), KEY, { From: 'client:gone_example_test', To: '+15615550142' })));
});
test('a call in rings the app of the person who has that number', async () => {
  assert.match(await VOICE.twiml(seed(), KEY, { From: '+15615550142', To: '+15615550100' }), /<Client>lee_example_test<\/Client>/);
  assert.ok(!/<Client>/.test(await VOICE.twiml(seed(), KEY, { From: '+15615550142', To: '+15615550199' })));   // switched-off person
});
test('a wrong address gets nothing', async () => {
  await assert.rejects(() => VOICE.twiml(seed(), 'x'.repeat(48), { From: '+1', To: '+1' }), (e) => e.status === 401);
  await assert.rejects(() => VOICE.twiml(seed(), '', {}), (e) => e.status === 401);
});
test('Connect makes the application and keeps its id; assign points the number at it and moves it between people', async () => {
  const calls = []; const db = seed({ 'settings/twilio': { accountSid: AC, keySid: SK, keySecret: SECRET } });
  VOICE._useFetch(async (url, o) => { calls.push([o.method, url.replace(/^.*Accounts\/AC[a-f0-9]+/, ''), o.body || '']);
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (/\/Applications\.json$/.test(url)) return ok({ sid: 'APnew' });
    if (/IncomingPhoneNumbers\.json/.test(url)) return ok({ incoming_phone_numbers: [{ sid: 'PN1', phone_number: '+15615550100', voice_application_sid: '' }] });
    return ok({}); });
  const st = await VOICE.setup(db); assert.equal(st.ready, true);
  const saved = db._docs.get('settings/twilio'); assert.equal(saved.appSid, 'APnew'); assert.ok(saved.hookKey.length >= 32);
  assert.ok(decodeURIComponent(calls[0][2]).includes('/api/voice/twiml/' + saved.hookKey));
  await VOICE.assign(db, { number: '+15615550100', email: 'kim@example.test' });
  assert.equal(db._docs.get('staff/kim@example.test').voiceNumber, '+15615550100'); assert.equal(db._docs.get('staff/lee@example.test').voiceNumber, '');
  assert.ok(calls.some((c) => c[0] === 'POST' && /IncomingPhoneNumbers\/PN1/.test(c[1]) && /VoiceApplicationSid=APnew/.test(c[2])));
  await assert.rejects(() => VOICE.assign(db, { number: '+15615559999', email: 'kim@example.test' }), (e) => e.status === 404);
});
