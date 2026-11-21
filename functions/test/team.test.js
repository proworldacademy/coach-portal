'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TEAM = require('../lib/team');
const PUSH = require('../lib/push');
const NOTIFY = require('../lib/notify');
const { fakeDb } = require('./fake-db');

/* The team's own messaging (Nov 15, 2026). Invented people only; nothing leaves the test. */
const SUB = (n) => ({ endpoint: 'https://push.example.test/send/' + n + '-abcdefghij', keys: { p256dh: 'BPc0'.repeat(20), auth: 'authauthauthauth' } });
const KIM = { email: 'kim@example.test', name: 'Kim Coach' };
async function world() {
  PUSH._reset();
  const db = fakeDb({
    'staff/kim@example.test': { name: 'Kim Coach', role: 'coach', active: true, pages: ['coach-portal'] },
    'staff/lee@example.test': { name: 'Lee Coach', role: 'coach', active: true },
    'staff/dee@example.test': { name: 'Dee Director', role: 'director', active: true },
    'staff/old@example.test': { name: 'Gone Person', role: 'coach', active: false },
    'teamChats/general': { kind: 'channel', name: 'general', private: false, members: ['kim@example.test', 'lee@example.test', 'dee@example.test'], createdBy: 'dee@example.test' },
    'teamChats/general/messages/m1': { by: 'kim@example.test', name: 'Kim Coach', text: 'Courts are *dry*, see <https://example.test/a|the plan>', at: 10 },
    'teamChats/dm_x': { kind: 'dm', members: ['kim@example.test', 'lee@example.test'], createdBy: 'kim@example.test' },
    'teamChats/dm_x/messages/m2': { by: 'lee@example.test', name: 'Lee Coach', text: 'hi', at: 11 },
    'teamChats/new-enrollments': { kind: 'channel', name: 'new-enrollments', private: true, members: ['dee@example.test'], createdBy: 'dee@example.test' },
    'teamReads/lee@example.test': { mute: { general: true } }
  });
  for (const [i, e] of ['kim@example.test', 'lee@example.test', 'dee@example.test'].entries()) await PUSH.subscribe(db, { email: e }, { subscription: SUB(i + 1) });
  const got = []; PUSH._useSender(async (sub, payload) => { got.push([sub.endpoint.match(/send\/(\d)/)[1], JSON.parse(payload)]); });
  return { db, got };
}

test('the people list: the active team only, names and roles, nothing else', async () => {
  const { db } = await world(); const r = await TEAM.people(db);
  assert.deepEqual(r.people.map((p) => p.email), ['dee@example.test', 'kim@example.test', 'lee@example.test']);
  assert.deepEqual(Object.keys(r.people[0]).sort(), ['email', 'name', 'role']);
  PUSH._useSender(null);
});
test('a message notifies the others in the chat once; a muted chat stays quiet', async () => {
  const { db, got } = await world();
  const r = await TEAM.notify(db, KIM, { chat: 'general', id: 'm1' });
  assert.equal(r.sent, 1); assert.deepEqual(got.map((g) => g[0]), ['3']);                     // Dee; Lee muted #general; Kim wrote it
  assert.equal(got[0][1].title, '#general · Kim Coach'); assert.equal(got[0][1].body, 'Courts are dry, see the plan'); assert.equal(got[0][1].url, '/team#/c/general');
  const again = await TEAM.notify(db, KIM, { chat: 'general', id: 'm1' }); assert.equal(again.again, true); assert.equal(got.length, 1);
  PUSH._useSender(null);
});
test('a mention gets through a mute', async () => {
  const { db, got } = await world();
  await db.doc('teamChats/general/messages/m3').set({ by: 'kim@example.test', name: 'Kim Coach', text: '@Lee Coach court 4?', at: 12, mentions: ['lee@example.test'] });
  await TEAM.notify(db, KIM, { chat: 'general', id: 'm3' });
  assert.deepEqual(got.map((g) => g[0]).sort(), ['2', '3']);
  PUSH._useSender(null);
});
test('only the author, only a member, only a real message', async () => {
  const { db } = await world();
  await assert.rejects(() => TEAM.notify(db, KIM, { chat: 'dm_x', id: 'm2' }), /Not your message/);
  await assert.rejects(() => TEAM.notify(db, { email: 'dee@example.test' }, { chat: 'dm_x', id: 'm2' }), /not in this chat/);
  await assert.rejects(() => TEAM.notify(db, KIM, { chat: 'general', id: 'nope' }), /No such message/);
  await assert.rejects(() => TEAM.notify(db, KIM, { chat: '../staff', id: 'm1' }), /Which message/);
  PUSH._useSender(null);
});
test('a direct message is titled with the sender', async () => {
  const { db, got } = await world();
  await TEAM.notify(db, { email: 'lee@example.test', name: 'Lee Coach' }, { chat: 'dm_x', id: 'm2' });
  assert.equal(got[0][0], '1'); assert.equal(got[0][1].title, 'Lee Coach');
  PUSH._useSender(null);
});
test('what the engine said on Slack also lands in the channel, when the channel exists', async () => {
  const { db, got } = await world(); NOTIFY._useFetch(async () => ({ ok: true }));
  await NOTIFY.slack(db, 'coaches', 'New player: Bo K. — Afterschool', ['*New player: Bo K.* — Afterschool', '<https://example.test/p|Open Bo>']);
  const msgs = [...db._docs.keys()].filter((k) => k.startsWith('teamChats/new-enrollments/messages/'));
  assert.equal(msgs.length, 1); const m = db._docs.get(msgs[0]); assert.equal(m.bot, true); assert.match(m.text, /\*New player: Bo K\.\*/);
  assert.equal(db._docs.get('teamChats/new-enrollments').last.text, 'New player: Bo K. — Afterschool');
  assert.deepEqual(got.map((g) => g[0]), ['3']);
  await NOTIFY.slack(db, 'desk', 'Enrolled online: Bo K.');                                  // no front-desk-alerts channel yet: nothing, no error
  assert.equal([...db._docs.keys()].filter((k) => k.startsWith('teamChats/front-desk-alerts')).length, 0);
  NOTIFY._useFetch(null); PUSH._useSender(null);
});

test('a line from the system to one person: a direct message from ProWorld, with a notification', async () => {
  const { db, got } = await world();
  assert.equal(await TEAM.direct(db, 'Kim@example.test', 'Weekly contact: 3 families still to reach.'), true);
  const id = TEAM.botChatId('kim@example.test'); const chat = db._docs.get('teamChats/' + id);
  assert.deepEqual(chat.members, ['kim@example.test', TEAM.BOT].sort()); assert.equal(chat.kind, 'dm'); assert.equal(chat.last.text, 'Weekly contact: 3 families still to reach.');
  assert.deepEqual(got.map((g) => g[0]), ['1']); assert.equal(got[0][1].title, 'ProWorld');
  await TEAM.direct(db, 'kim@example.test', 'Second line.'); assert.equal([...db._docs.keys()].filter((k) => k.startsWith('teamChats/' + id + '/messages/')).length, 2);
  assert.equal(await TEAM.direct(db, '', 'x'), false);
  PUSH._useSender(null);
});
test('the hook for our other systems: the concierge channel by default, only known channels', async () => {
  const { db } = await world();
  await db.doc('teamChats/concierge').set({ kind: 'channel', name: 'concierge', private: true, members: ['dee@example.test'], createdBy: 'dee@example.test' });
  assert.deepEqual(await TEAM.hook(db, { text: '*A family* is ready for you' }), { ok: true });
  assert.deepEqual(await TEAM.hook(db, { channel: 'staff', text: 'x' }), { ok: true });                    // an unknown channel falls back to concierge
  assert.equal([...db._docs.keys()].filter((k) => k.startsWith('teamChats/concierge/messages/')).length, 2);
  await assert.rejects(() => TEAM.hook(db, { text: '  ' }), /Nothing to post/);
  PUSH._useSender(null);
});
test('calls: the relay list comes from Cloudflare when a key is set, the public finders otherwise', async () => {
  const { db } = await world();
  let r = await TEAM.ice(db); assert.equal(r.relay, false); assert.match(r.iceServers[0].urls[0], /^stun:/);
  await db.doc('settings/turn').set({ keyId: 'a'.repeat(32), token: 't'.repeat(40) });
  let asked = null; TEAM._useFetch(async (url, o) => { asked = [url, o.headers.authorization, o.body]; return { ok: true, status: 201, json: async () => ({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' }] }) }; });
  r = await TEAM.ice(db); assert.equal(r.relay, true); assert.match(asked[0], /keys\/a{32}\/credentials\/generate-ice-servers$/); assert.equal(asked[1], 'Bearer ' + 't'.repeat(40));
  assert.equal(r.iceServers[1].urls.length, 2);                                                           // port 53 is dropped (browsers refuse it)
  assert.deepEqual(await TEAM.turnReady(db), { set: true, ready: true });
  TEAM._useFetch(async () => ({ ok: false, status: 403, json: async () => ({}) })); r = await TEAM.ice(db); assert.equal(r.relay, false);   // a bad key never breaks a call
  TEAM._useFetch(null); PUSH._useSender(null);
});
test('calls: the others are rung once, by the caller only', async () => {
  const { db, got } = await world();
  await db.doc('teamCalls/c1').set({ chat: 'general', kind: 'video', by: 'kim@example.test', byName: 'Kim Coach', title: '#general', members: ['kim@example.test', 'lee@example.test', 'dee@example.test'], at: 1, state: 'live' });
  const r = await TEAM.ring(db, KIM, { call: 'c1' }); assert.equal(r.sent, 2); assert.equal(got[0][1].title, 'Kim Coach is calling'); assert.equal(got[0][1].body, '#general · Video call · tap to join'); assert.equal(got[0][1].url, '/team#/call/c1');
  assert.equal(got[0][1].ring, undefined);                                                                  // a channel's call is a plain notification: the whole channel does not ring
  assert.equal((await TEAM.ring(db, KIM, { call: 'c1' })).again, true);
  await assert.rejects(() => TEAM.ring(db, { email: 'lee@example.test' }, { call: 'c1' }), /Not your call/);
  PUSH._useSender(null);
});
test('calls: a direct call rings; when it ends unanswered the other gets "Missed call" in its place, once, without a sound', async () => {
  const { db, got } = await world();
  await db.doc('teamCalls/c2').set({ chat: 'dm_x', kind: 'audio', by: 'kim@example.test', byName: 'Kim Coach', title: 'Kim Coach', members: ['kim@example.test', 'lee@example.test'], at: 1, state: 'live' });
  const r = await TEAM.ring(db, KIM, { call: 'c2' }); assert.equal(r.sent, 1);
  assert.deepEqual(got[0][1], { title: 'Kim Coach is calling', body: 'Voice call · tap to join', url: '/team#/call/c2', tag: 'call-c2', ring: true });
  assert.equal((await TEAM.ringEnd(db, KIM, { call: 'c2' })).live, true); assert.equal(got.length, 1);       // still going: nothing is sent
  await db.doc('teamCalls/c2').set({ state: 'ended' }, { merge: true });
  await assert.rejects(() => TEAM.ringEnd(db, { email: 'dee@example.test' }, { call: 'c2' }), /Not your call/);
  const e = await TEAM.ringEnd(db, KIM, { call: 'c2', joined: [] }); assert.equal(e.sent, 1);
  assert.deepEqual(got[1][1], { title: 'Missed call from Kim Coach', body: 'Tap to open the chat', url: '/team#/c/dm_x', tag: 'call-c2', quiet: true });
  assert.equal((await TEAM.ringEnd(db, KIM, { call: 'c2' })).again, true); assert.equal(got.length, 2);
  // a call that was answered: whoever joined is not told they missed it
  await db.doc('teamCalls/c3').set({ chat: 'dm_x', kind: 'audio', by: 'kim@example.test', byName: 'Kim Coach', title: 'Kim Coach', members: ['kim@example.test', 'lee@example.test'], at: 1, state: 'live' });
  await TEAM.ring(db, KIM, { call: 'c3' }); await db.doc('teamCalls/c3').set({ state: 'ended' }, { merge: true });
  const a = await TEAM.ringEnd(db, { email: 'lee@example.test' }, { call: 'c3', joined: ['kim@example.test', 'LEE@example.test'] }); assert.equal(a.sent, 0); assert.equal(got.length, 3);
  PUSH._useSender(null);
});

test('quiet at night: a channel waits for the morning, a mention still gets through, the day is as before', async () => {
  const at = (h) => () => Date.parse('2026-11-17T' + String(h + 5).padStart(2, '0') + ':30:00Z');   // Eastern time is UTC-5 in November
  let w = await world(); await w.db.doc('teamReads/dee@example.test').set({ quiet: true }, { merge: true });
  TEAM._clock(at(13)); let r = await TEAM.notify(w.db, KIM, { chat: 'general', id: 'm1' }); assert.equal(r.sent, 1);
  w = await world(); await w.db.doc('teamReads/dee@example.test').set({ quiet: true }, { merge: true });
  TEAM._clock(() => Date.parse('2026-11-18T03:30:00Z')); r = await TEAM.notify(w.db, KIM, { chat: 'general', id: 'm1' }); assert.equal(r.sent, 0);   // 10:30 pm
  await w.db.doc('teamChats/general/messages/m1').set({ pushed: null, mentions: ['dee@example.test'] }, { merge: true });
  r = await TEAM.notify(w.db, KIM, { chat: 'general', id: 'm1' }); assert.equal(r.sent, 1);
  TEAM._clock(null); PUSH._useSender(null);
});

test('here now: whoever asks is noted, and the answer is everyone seen in the last quarter of an hour', async () => {
  const { db } = await world(); let now = 1000000000000; TEAM._clock(() => now);
  try {
    let r = await TEAM.here(db, { email: 'Kim@Example.test' }); assert.deepEqual(r.here, { 'kim@example.test': 0 });
    now += 2 * 60000; r = await TEAM.here(db, { email: 'lee@example.test' }); assert.deepEqual(r.here, { 'kim@example.test': 120000, 'lee@example.test': 0 });
    now += 14 * 60000; r = await TEAM.here(db, { email: 'dee@example.test' }); assert.deepEqual(Object.keys(r.here).sort(), ['dee@example.test', 'lee@example.test'], 'sixteen minutes without a word and Kim is no longer listed');
  } finally { TEAM._clock(null); }
});
