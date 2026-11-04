'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const USERS = require('../lib/users');

/* A stand-in for the Admin SDK's auth: users by e-mail, the calls lib/users.js makes. Invented people only. */
function fakeAuth(seed) {
  const users = new Map(); let n = 1;
  (seed || []).forEach((u) => users.set(u.email, Object.assign({ uid: 'u' + n++, emailVerified: false, disabled: false, providerData: [], metadata: {} }, u)));
  const nf = () => { const e = new Error('There is no user record corresponding to the provided identifier.'); e.code = 'auth/user-not-found'; return e; };
  const byUid = (uid) => [...users.values()].find((u) => u.uid === uid);
  return {
    calls: [],
    async getUserByEmail(email) { const u = users.get(email); if (!u) throw nf(); return u; },
    async createUser(p) { this.calls.push(['create', p.email]); const u = { uid: 'u' + n++, email: p.email, emailVerified: !!p.emailVerified, disabled: false, displayName: p.displayName, providerData: [{ providerId: 'password' }], metadata: { creationTime: 'Wed, 04 Nov 2026 20:00:00 GMT' }, _pw: p.password }; users.set(p.email, u); return u; },
    async updateUser(uid, p) { this.calls.push(['update', uid, Object.keys(p).join(',')]); const u = byUid(uid); if (!u) throw nf(); Object.assign(u, p.emailVerified !== undefined ? { emailVerified: p.emailVerified } : {}); if (p.password) { u._pw = p.password; if (!u.providerData.some((x) => x.providerId === 'password')) u.providerData.push({ providerId: 'password' }); } return u; },
    async generatePasswordResetLink(email, opts) { this.calls.push(['link', email, opts && opts.url]); if (!users.get(email)) throw nf(); return 'https://proworld-coach-portal.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE-' + email.split('@')[0] + '&continueUrl=' + encodeURIComponent(opts.url); },
    async getUsers(ids) { return { users: ids.map((i) => users.get(i.email)).filter(Boolean), notFound: ids.filter((i) => !users.get(i.email)) }; }
  };
}

test('an owner sets up a sign-in: the account is created verified with a password nobody knows, the reset link sets it', async () => {
  const A = fakeAuth([]); USERS._useAuth(A);
  const out = await USERS.resetLink('New.Coach@Example.test', 'New Coach');
  assert.equal(out.created, true); assert.equal(out.user.email, 'new.coach@example.test'); assert.equal(out.user.verified, true); assert.equal(out.user.password, true);
  assert.match(out.link, /^https:\/\/proworld-coach-portal\.firebaseapp\.com\/__\/auth\/action\?mode=resetPassword&oobCode=CODE-new\.coach&continueUrl=https%3A%2F%2Fproworld-coach-portal\.web\.app%2F$/);
  assert.deepEqual(A.calls[0], ['create', 'new.coach@example.test']);
  const again = await USERS.ensure('new.coach@example.test'); assert.equal(again.created, false);   // the second time: the same account
  await assert.rejects(USERS.ensure('not an e-mail'), (e) => e.status === 400);
});

test('an account somebody made alone (unverified) is vouched for by the owner; a Google-only account keeps its id and gains a password', async () => {
  const A = fakeAuth([{ email: 'self@example.test', emailVerified: false, providerData: [{ providerId: 'password' }] }, { email: 'g@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }], metadata: { lastSignInTime: 'Tue, 03 Nov 2026 10:00:00 GMT' } }]); USERS._useAuth(A);
  const a = await USERS.ensure('self@example.test'); assert.equal(a.user.verified, true); assert.deepEqual(A.calls.pop(), ['update', 'u1', 'emailVerified']);
  const st = await USERS.status(['g@example.test', 'nobody@example.test', 'SELF@example.test']);
  assert.equal(st['nobody@example.test'], null); assert.equal(st['g@example.test'].password, false); assert.deepEqual(st['g@example.test'].providers, ['google.com']); assert.equal(st['g@example.test'].lastSignIn, 'Tue, 03 Nov 2026 10:00:00 GMT'); assert.equal(st['self@example.test'].verified, true);
  const p = await USERS.setPassword('g@example.test', 'Courts2026', 'G Example');
  assert.equal(p.created, false); assert.equal(p.user.uid, 'u2'); assert.equal(p.user.password, true);   // the same account, now with a password
  await assert.rejects(USERS.setPassword('g@example.test', 'short1'), (e) => e.code === 'password');
  await assert.rejects(USERS.setPassword('g@example.test', 'nonumberhere'), (e) => e.code === 'password');
});
