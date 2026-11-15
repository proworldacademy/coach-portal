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
