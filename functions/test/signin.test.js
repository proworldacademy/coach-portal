'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { fakeDb } = require('./fake-db'); const SIGNIN = require('../lib/signin'); const MAIL = require('../lib/mail');

function world(over) {
  const sent = []; let t = 1000000; const db = fakeDb({});
  const deps = Object.assign({ onFile: async (e) => e === 'maria@example.com', isTeam: async (e) => e === 'coach@example.com', mail: async (m) => { sent.push(m); }, now: () => t, code: () => '482913', login: async (e) => ({ pass: 'p-' + e }) }, over || {});
  return { db, deps, sent, tick: (ms) => { t += ms; } };
}

test('a parent on file gets a code and signs in with it, once', async () => {
  const w = world();
  assert.deepEqual(await SIGNIN.start(w.db, w.deps, ' Maria@Example.com '), { ok: true });
  assert.equal(w.sent.length, 1); assert.equal(w.sent[0].to, 'maria@example.com'); assert.match(w.sent[0].subject, /482 913/); assert.match(w.sent[0].text, /482 913/);
  assert.deepEqual(await SIGNIN.finish(w.db, w.deps, 'maria@example.com', '482 913'), { pass: 'p-maria@example.com' });
  await assert.rejects(SIGNIN.finish(w.db, w.deps, 'maria@example.com', '482913'), (e) => e.status === 403);
});

test('an address that is not on file gets the same answer and no e-mail, and no code works', async () => {
  const w = world();
  assert.deepEqual(await SIGNIN.start(w.db, w.deps, 'stranger@example.com'), { ok: true });
  assert.equal(w.sent.length, 0);
  await assert.rejects(SIGNIN.finish(w.db, w.deps, 'stranger@example.com', '482913'), (e) => e.status === 403);
});

test('a team login never gets a code (its password must not be replaced)', async () => {
  const w = world();
  await assert.rejects(SIGNIN.start(w.db, w.deps, 'coach@example.com'), (e) => e.status === 409 && e.code === 'team');
  assert.equal(w.sent.length, 0);
});

test('a wrong code counts, five tries end it, ten minutes end it', async () => {
  const w = world(); await SIGNIN.start(w.db, w.deps, 'maria@example.com');
  for (let i = 0; i < 5; i++) await assert.rejects(SIGNIN.finish(w.db, w.deps, 'maria@example.com', '000000'), (e) => e.status === 403);
  await assert.rejects(SIGNIN.finish(w.db, w.deps, 'maria@example.com', '482913'), (e) => e.status === 429);
  const v = world(); await SIGNIN.start(v.db, v.deps, 'maria@example.com'); v.tick(SIGNIN.TTL + 1);
  await assert.rejects(SIGNIN.finish(v.db, v.deps, 'maria@example.com', '482913'), (e) => e.status === 403);
});

test('three codes in fifteen minutes, then wait', async () => {
  const w = world();
  for (let i = 0; i < 3; i++) { await SIGNIN.start(w.db, w.deps, 'maria@example.com'); w.tick(1000); }
  await assert.rejects(SIGNIN.start(w.db, w.deps, 'maria@example.com'), (e) => e.status === 429);
  w.tick(15 * 60 * 1000); assert.deepEqual(await SIGNIN.start(w.db, w.deps, 'maria@example.com'), { ok: true });
});

test('a failed e-mail leaves no code behind; a bad address is refused', async () => {
  const w = world({ mail: async () => { const e = new Error('down'); e.status = 502; throw e; } });
  await assert.rejects(SIGNIN.start(w.db, w.deps, 'maria@example.com'), (e) => e.status === 502);
  await assert.rejects(SIGNIN.finish(w.db, w.deps, 'maria@example.com', '482913'), (e) => e.status === 403);
  await assert.rejects(SIGNIN.start(w.db, w.deps, 'not-an-email'), (e) => e.status === 400);
});

test('mail: not set up is a clear 503; set up sends through the mailbox', async () => {
  await assert.rejects(MAIL.send(fakeDb({}), { to: 'a@example.com', subject: 's', text: 't' }), (e) => e.status === 503);
  const out = []; MAIL._useTransport((cfg) => ({ sendMail: async (m) => { out.push({ cfg, m }); } }));
  await MAIL.send(fakeDb({ 'settings/mail': { user: 'desk@example.com', pass: 'abcd efgh ijkl mnop' } }), { to: 'a@example.com', subject: 's', text: 't' });
  assert.equal(out[0].cfg.pass, 'abcdefghijklmnop'); assert.equal(out[0].m.from, 'ProWorld Academy <desk@example.com>'); MAIL._useTransport(null);
});
