'use strict';
/* A profile of a person, with or without a child (Antonio, Nov 21, 2026: "the base should be just a profile of a person… then,
   okay, I'm going to enroll my child"). Anyone can make one: a name, an e-mail and a phone. With it they sign in with the same
   six-digit code as the families, reserve a court (paid by card), and add themselves or another adult to take privates.
     clients/<e-mail>   { name, phone, people: [{ id, name }], at }    written by the engine only
   Enrolling a child is the existing enrollment: the child lands on the roster and the account becomes a family account. */
const crypto = require('crypto');
const S = require('./stripe');
let CLOCK = () => Date.now();
const norm = (e) => String(e || '').trim().toLowerCase();
const okEmail = (e) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
const okPhone = (p) => String(p || '').replace(/\D/g, '').length >= 10;
const pid = (email, name) => 'c_' + crypto.createHash('sha256').update(email + '|' + String(name).toLowerCase()).digest('hex').slice(0, 14);

async function get(db, email) { try { const s = await db.doc('clients/' + norm(email)).get(); return s.exists ? (s.data() || {}) : null; } catch (e) { return null; } }
/* The people on a profile, in the shape the calendar takes for a player. */
function people(c) { return ((c && c.people) || []).map((p) => ({ id: p.id, name: p.name, adult: true })); }
/* Sign-up, before any sign-in: the profile is written, then the page asks for the six-digit code. Someone already on file is
   answered the same way and nothing of theirs is changed, so the form never tells a stranger whose e-mail is known. */
async function signup(db, body, deps) {
  const email = norm(body.email); const name = S.clean(body.name, 80); const phone = S.clean(body.phone, 30);
  if (!okEmail(email)) throw S.err(400, 'email', 'That e-mail does not look right.');
  if (name.length < 2) throw S.err(400, 'name', 'Add your name.');
  if (!okPhone(phone)) throw S.err(400, 'phone', 'Add a phone number we can reach you on.');
  if (deps && deps.isTeam && await deps.isTeam(email)) throw S.err(409, 'team', 'This e-mail is a team login. Sign in on the team side.');
  const ref = db.doc('clients/' + email); const was = await ref.get();
  if (!was.exists && !(deps && deps.onFile && await deps.onFile(email))) { await ref.set({ name, phone, people: [], at: CLOCK(), src: 'signup' }); try { if (deps && deps.tellDesk) await deps.tellDesk(`New profile in the app: ${name}.`); } catch (e) { /* nicety */ } }
  return { ok: true };
}
/* Signed in: the name and the phone on the profile. A family that never made one gets it here the first time they add a person. */
async function save(db, who, body) {
  const email = norm(who.email); const cur = (await get(db, email)) || { people: [], at: CLOCK(), src: 'family' };
  const name = body.name !== undefined ? S.clean(body.name, 80) : cur.name || who.name || ''; const phone = body.phone !== undefined ? S.clean(body.phone, 30) : cur.phone || '';
  if (name.length < 2) throw S.err(400, 'name', 'Add your name.');
  await db.doc('clients/' + email).set(Object.assign({}, cur, { name, phone, updatedAt: CLOCK() })); return { ok: true, name, phone };
}
/* "+" next to the players: an adult who takes privates or reserves courts. A child goes through the enrollment instead. */
async function addPerson(db, who, body) {
  const email = norm(who.email); const name = S.clean(body.name, 80); if (name.length < 2) throw S.err(400, 'name', 'Add the name.');
  const cur = (await get(db, email)) || { name: who.name || name, phone: '', people: [], at: CLOCK(), src: 'family' }; const list = Array.isArray(cur.people) ? cur.people.slice() : [];
  const id = pid(email, name); if (list.some((p) => p.id === id)) throw S.err(409, 'there', name + ' is already on your account.');
  if (list.length >= 6) throw S.err(400, 'limit', 'Six people is the most on one account. Write to Admin to add more.');
  list.push({ id, name, at: CLOCK() }); await db.doc('clients/' + email).set(Object.assign({}, cur, { people: list, updatedAt: CLOCK() }));
  return { ok: true, person: { id, name, adult: true } };
}
async function removePerson(db, who, body) {
  const email = norm(who.email); const cur = await get(db, email); if (!cur) throw S.err(404, 'person', 'Not on your account.');
  const list = (cur.people || []).filter((p) => p.id !== S.clean(body.id, 40)); await db.doc('clients/' + email).set(Object.assign({}, cur, { people: list, updatedAt: CLOCK() })); return { ok: true };
}
module.exports = { get, people, signup, save, addPerson, removePerson, pid, _clock: (f) => { CLOCK = f || (() => Date.now()); } };
