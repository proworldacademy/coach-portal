/* "View as" on the engine (Nov 16, 2026): only an owner's X-View-As is honoured, the answer is scoped as that person and marked viewing. */
'use strict';
const test = require('node:test'); const assert = require('node:assert');
const authMod = require('firebase-admin/auth'); const fsMod = require('firebase-admin/firestore');
const ADMIN = require('../lib/admin');
const STAFF = {
  'lee@example.test': { name: 'Lee Coach', role: 'coach', coachAs: 'Lee', active: true, pages: ['coach-portal'] },
  'mia@example.test': { name: 'Mia Marketing', role: 'marketing', active: true, pages: ['mkt'] },
  'dee@example.test': { name: 'Dee Director', role: 'director', active: true, pages: ['coach-portal'] }
};
const TOKENS = {
  owner: { uid: 'PDKJkouns6g6zA1jrABJijEr3oq2', email: 'owner@example.test', email_verified: true, name: 'Olive Owner', firebase: { sign_in_provider: 'password' } },
  owner2: { uid: 'OLWbZu29WVUWUbN8W9HdPpOZgmj2', email: 'owner2@example.test', email_verified: true, name: 'Otto Owner', firebase: { sign_in_provider: 'password' } },
  dee: { uid: 'u-dee', email: 'dee@example.test', email_verified: true, name: 'Dee Director', firebase: { sign_in_provider: 'password' } }
};
let patched = true;
try {
  Object.defineProperty(authMod, 'getAuth', { configurable: true, value: () => ({ verifyIdToken: async (t) => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; } }) });
  Object.defineProperty(fsMod, 'getFirestore', { configurable: true, value: () => ({ doc: (p) => ({ get: async () => { const r = STAFF[p.replace('staff/', '')]; return { exists: !!r, data: () => r }; } }) }) });
} catch (e) { patched = false; }
const req = (tok, as) => ({ headers: Object.assign({ authorization: 'Bearer ' + tok }, as ? { 'x-view-as': as } : {}) });

test('an owner without the header is the owner', { skip: !patched }, async () => {
  const w = await ADMIN.requireCoach(req('owner')); assert.equal(w.owner, true); assert.equal(w.director, true); assert.ok(!w.viewing);
});
test('both owner sign-ins are owners', { skip: !patched }, async () => {
  const w = await ADMIN.requireCoach(req('owner2')); assert.equal(w.owner, true);
  const s = await ADMIN.requireStaff(req('owner2')); assert.equal(s.owner, true);
});
test('an owner viewing as a coach is scoped as that coach, and marked', { skip: !patched }, async () => {
  const w = await ADMIN.requireCoach(req('owner', 'Lee@Example.test'));
  assert.equal(w.viewing, true); assert.equal(w.owner, false); assert.equal(w.director, false); assert.equal(w.email, 'lee@example.test'); assert.deepEqual(w.keys, ['lee', 'lee']); assert.equal(w.realEmail, 'owner@example.test');
});
test('viewing as someone with no Coach Portal is refused', { skip: !patched }, async () => {
  await assert.rejects(() => ADMIN.requireCoach(req('owner', 'mia@example.test')), (e) => e.status === 403);
  await assert.rejects(() => ADMIN.requireCoach(req('owner', 'nobody@example.test')), (e) => e.status === 403);
});
test('the header from anyone else changes nothing', { skip: !patched }, async () => {
  const w = await ADMIN.requireCoach(req('dee', 'lee@example.test'));
  assert.equal(w.email, 'dee@example.test'); assert.equal(w.director, true); assert.ok(!w.viewing);
});

test('a director reads a coach\'s chats, reading only; not another director\'s; a coach reads nobody\'s', { skip: !patched }, async () => {
  const dee = await ADMIN.requireCoach(req('dee'));
  const w = await ADMIN.readAs(dee, 'lee@example.test'); assert.equal(w.viewing, true); assert.equal(w.email, 'lee@example.test'); assert.equal(w.director, false); assert.equal(w.owner, false); assert.equal(w.realEmail, 'dee@example.test');
  await assert.rejects(() => ADMIN.readAs(dee, 'dee@example.test'), (e) => e.status === 403);
  await assert.rejects(() => ADMIN.readAs(dee, 'mia@example.test'), (e) => e.status === 404);
  await assert.rejects(() => ADMIN.readAs({ director: false, email: 'lee@example.test' }, 'dee@example.test'), (e) => e.status === 403);
  const own = await ADMIN.requireCoach(req('owner')); assert.equal((await ADMIN.readAs(own, 'dee@example.test')).viewing, true);
});
