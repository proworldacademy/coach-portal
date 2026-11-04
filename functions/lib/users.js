/* Sign-in accounts for the team (Antonio, Nov 4, 2026): "just make it e-mail and password, and that's it" — not everyone has a
   Google account. The staff list on the Dashboard still decides who may open what; this is only the account behind the
   e-mail. Owners set it up from People & access: the engine creates the Firebase Auth user for a staff e-mail (marked
   verified: an owner vouched for the address), hands back a password-reset link the owner can send on, or sets a temporary
   password the owner reads out. Nobody can create their own account (sign-up is off in the Firebase console); the gate only
   signs people in. A Google account that already exists keeps its id: a reset link adds a password to it. */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');

const SITE = 'https://proworld-coach-portal.web.app';
let authOverride = null;                                  // the tests swap the Admin SDK out
function _useAuth(a) { authOverride = a; }
function auth() { return authOverride || require('firebase-admin/auth').getAuth(); }

const emailOf = (v) => { const e = String(v || '').trim().toLowerCase(); if (!/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(e)) throw S.err(400, 'email', 'An e-mail address is needed.'); return e; };
const notFound = (e) => e && (e.code === 'auth/user-not-found' || /no user record/i.test(String(e.message || '')));
const pub = (u) => ({ uid: u.uid, email: String(u.email || '').toLowerCase(), verified: u.emailVerified === true, disabled: u.disabled === true, providers: (u.providerData || []).map((p) => p.providerId), password: (u.providerData || []).some((p) => p.providerId === 'password'), lastSignIn: (u.metadata && u.metadata.lastSignInTime) || null, created: (u.metadata && u.metadata.creationTime) || null });

/* The account behind an e-mail, created if there is none (verified, with a password nobody knows until a reset sets one). */
async function ensure(email, name) {
  email = emailOf(email);
  let u = null; try { u = await auth().getUserByEmail(email); } catch (e) { if (!notFound(e)) throw e; }
  if (!u) { u = await auth().createUser({ email, emailVerified: true, password: crypto.randomBytes(24).toString('base64url'), displayName: String(name || '').trim().slice(0, 80) || undefined }); return { created: true, user: pub(u) }; }
  if (u.emailVerified !== true) u = await auth().updateUser(u.uid, { emailVerified: true });   // an owner vouches for the address; the gate refuses unverified ones
  return { created: false, user: pub(u) };
}
/* A link that lets the person set (or reset) their password — the owner sends it on (text, WhatsApp) or the gate e-mails one. */
async function resetLink(email, name) {
  const got = await ensure(email, name);
  const link = await auth().generatePasswordResetLink(got.user.email, { url: SITE + '/' });
  return Object.assign(got, { link });
}
/* A temporary password an owner reads out to the person; they change it with "Forgot your password?" whenever they like. */
async function setPassword(email, password, name) {
  const pw = String(password || '');
  if (pw.length < 8 || pw.length > 64) throw S.err(400, 'password', 'A password of 8 characters or more.');
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) throw S.err(400, 'password', 'Use letters and at least one number.');
  const got = await ensure(email, name);
  const u = await auth().updateUser(got.user.uid, { password: pw, emailVerified: true });
  return { created: got.created, user: pub(u) };
}
/* The sign-in state of several e-mails at once (the People & access table): none · password · google, last sign-in. */
async function status(emails) {
  const list = Array.from(new Set((emails || []).map((e) => String(e || '').trim().toLowerCase()).filter((e) => /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(e)))).slice(0, 100);
  const out = {}; list.forEach((e) => { out[e] = null; });
  if (!list.length) return out;
  const res = await auth().getUsers(list.map((email) => ({ email })));
  (res.users || []).forEach((u) => { const e = String(u.email || '').toLowerCase(); if (e in out) out[e] = pub(u); });
  return out;
}

module.exports = { ensure, resetLink, setPassword, status, _useAuth };
