/* A parent signs in with a code sent to their e-mail (Antonio, Nov 14, 2026: "do a code by e-mail for the parents"). Google and the e-mailed
   link do not work inside the App Store app; six digits do, everywhere.
     POST /api/family/code          { email }         → always { ok: true } (never says whether the address is on file)
     POST /api/family/code/verify   { email, code }   → { pass }: a one-time password the page signs in with, straight away
   Rules: a code goes only to an address that is on file for a family (roster or Stripe) and is not a team login (the team signs in with its
   own password; a code must never reset it). Six digits, ten minutes, five tries, three codes per fifteen minutes per address. Kept as a hash
   in signinCodes/<hash of the address> (engine only; no rule opens it). On a right code the engine marks the address verified on its Firebase
   login and sets a long random password nobody sees or keeps; the next code replaces it. */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');

const TTL = 10 * 60 * 1000, WINDOW = 15 * 60 * 1000, MAX_SENDS = 3, MAX_TRIES = 5;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const norm = (e) => String(e || '').trim().toLowerCase();
const okEmail = (e) => /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/.test(e) && e.length <= 160;
const ref = (db, email) => db.collection('signinCodes').doc(sha('pw:' + email).slice(0, 40));

function letter(code) {
  const spaced = code.slice(0, 3) + ' ' + code.slice(3);
  return {
    subject: `${spaced} is your ProWorld code`,
    text: `Your ProWorld Academy sign-in code is ${spaced}.\n\nType it in the app or on the family page. It works once, for ten minutes.\n\nIf you did not ask for it, ignore this e-mail: nobody can sign in without the code.\n\nProWorld Academy · 651 Egret Cir, Delray Beach, FL · (561) 403-0008`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:440px;margin:0 auto;padding:28px 22px;color:#0A0A0A"><p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6F6F6B;margin:0 0 10px">ProWorld Academy</p><p style="font-size:17px;margin:0 0 16px">Your sign-in code</p><p style="font-size:40px;font-weight:800;letter-spacing:.12em;background:#E2FE78;border-radius:14px;padding:18px 0;text-align:center;margin:0 0 18px">${spaced}</p><p style="font-size:14px;line-height:1.5;color:#3A3A37;margin:0 0 10px">Type it in the app or on the family page. It works once, for ten minutes.</p><p style="font-size:13px;line-height:1.5;color:#6F6F6B;margin:0">If you did not ask for it, ignore this e-mail: nobody can sign in without the code.</p></div>`
  };
}

/* deps: { onFile(email) → bool, isTeam(email) → bool, mail(msg), now?, code? } */
async function start(db, deps, rawEmail) {
  const email = norm(rawEmail); if (!okEmail(email)) throw S.err(400, 'email', 'That e-mail does not look right.');
  const now = deps.now ? deps.now() : Date.now();
  if (await deps.isTeam(email)) throw S.err(409, 'team', 'This e-mail is a team login. Sign in on the team side with your password.');
  const r = ref(db, email); const snap = await r.get(); const d = snap.exists ? (snap.data() || {}) : {};
  const sends = (Array.isArray(d.sends) ? d.sends : []).filter((t) => now - t < WINDOW);
  if (sends.length >= MAX_SENDS) throw S.err(429, 'slow', 'A code was just sent. Check your e-mail, or try again in a few minutes.');
  if (!(await deps.onFile(email))) { await r.set({ sends: sends.concat(now), exp: 0, hash: '', tries: 0, at: now }); return { ok: true }; }   // same answer, nothing sent
  const code = deps.code ? deps.code() : String(crypto.randomInt(0, 1000000)).padStart(6, '0'); const salt = crypto.randomBytes(8).toString('hex');
  await deps.mail(Object.assign({ to: email }, letter(code)));          // a failed send leaves no code behind
  await r.set({ sends: sends.concat(now), exp: now + TTL, hash: sha(salt + ':' + code), salt, tries: 0, at: now });
  return { ok: true };
}

/* deps: { login(email) → { pass }, now? } */
async function finish(db, deps, rawEmail, rawCode) {
  const email = norm(rawEmail); const code = String(rawCode || '').replace(/\D/g, '');
  if (!okEmail(email) || code.length !== 6) throw S.err(400, 'code', 'Type the six digits from the e-mail.');
  const now = deps.now ? deps.now() : Date.now();
  const r = ref(db, email); const snap = await r.get(); const d = snap.exists ? (snap.data() || {}) : {};
  const bad = () => S.err(403, 'code', 'That code is not right, or it has expired. Ask for a new one.');
  if (!d.hash || !d.exp || now > d.exp) throw bad();
  if ((d.tries || 0) >= MAX_TRIES) throw S.err(429, 'tries', 'Too many tries. Ask for a new code.');
  const good = crypto.timingSafeEqual(Buffer.from(sha(d.salt + ':' + code)), Buffer.from(String(d.hash)));
  if (!good) { await r.set(Object.assign({}, d, { tries: (d.tries || 0) + 1 })); throw bad(); }
  await r.set({ sends: d.sends || [], exp: 0, hash: '', tries: 0, at: now, used: now });          // once
  return deps.login(email);
}

/* the real sign-in: the address's Firebase login gets a fresh random password and is marked verified (the code proved the mailbox) */
async function firebaseLogin(email) {
  const auth = require('firebase-admin/auth').getAuth(); const pass = crypto.randomBytes(24).toString('base64url');
  let u = null; try { u = await auth.getUserByEmail(email); } catch (e) { if (!e || e.code !== 'auth/user-not-found') throw e; }
  if (u) await auth.updateUser(u.uid, { password: pass, emailVerified: true }); else await auth.createUser({ email, password: pass, emailVerified: true });
  return { pass };
}
module.exports = { start, finish, firebaseLogin, letter, TTL, MAX_SENDS, MAX_TRIES };
