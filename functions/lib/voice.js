/* Calls to families from inside the app (Nov 17, 2026 — Antonio: "call back and forth through the app without having to sign into JustCall").
   Twilio carries the call; the app is the phone. An owner pastes three values on the Dashboard (settings/twilio: the Account SID and an
   API key's SID and secret — never the account's Auth Token); "Connect" then makes the one Twilio application that points at this engine.
   Each coach is given one Twilio number (staff/<email>.voiceNumber). What this file answers:
     token(db, who)    a one-hour pass that lets the signed-in person's app place and receive calls as themselves
     twiml(db, body)   what Twilio asks when a call starts: from the app → dial the family from the coach's number; from outside → ring the coach's app
     setup / status / assign   the owners' side
   Nothing here is used until settings/twilio exists; the JustCall dialer stays the fallback. */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');
const ROSTER = require('./roster');
let fetchImpl = (...a) => fetch(...a);
const API = 'https://api.twilio.com/2010-04-01/Accounts/';
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const xml = (s) => String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
/* Twilio's name for a person in the app: letters, digits and underscores only, so the e-mail is folded */
const identity = (email) => String(email || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 120);
const e164 = (n) => { const d = String(n || '').replace(/[^\d+]/g, ''); if (/^\+[1-9]\d{7,14}$/.test(d)) return d; const x = d.replace(/\D/g, ''); if (x.length === 10) return '+1' + x; if (x.length === 11 && x[0] === '1') return '+' + x; return ''; };

async function config(db) {
  const snap = await db.doc('settings/twilio').get(); const c = snap.exists ? snap.data() || {} : {};
  const ok = /^AC[0-9a-f]{32}$/i.test(String(c.accountSid || '')) && /^SK[0-9a-f]{32}$/i.test(String(c.keySid || '')) && String(c.keySecret || '').length >= 20;
  return ok ? c : null;
}
async function call(c, method, path, form) {
  const r = await fetchImpl(API + c.accountSid + path, { method, headers: Object.assign({ authorization: 'Basic ' + Buffer.from(c.keySid + ':' + c.keySecret).toString('base64') }, form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), body: form ? new URLSearchParams(form).toString() : undefined });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) throw S.err(r.status === 401 ? 400 : 502, 'twilio', r.status === 401 ? 'Twilio did not accept those values. Check the Account SID and the API key.' : 'Twilio answered ' + r.status + (j && j.message ? ': ' + String(j.message).slice(0, 160) : ''));
  return j || {};
}
/* the owners' "Connect": one Twilio application whose calls ask this engine what to do, at an address only Twilio is given */
async function setup(db) {
  const c = await config(db); if (!c) throw S.err(400, 'unset', 'Paste the Account SID and the API key first.');
  const hookKey = c.hookKey && String(c.hookKey).length >= 32 ? c.hookKey : crypto.randomBytes(24).toString('hex');
  const url = ROSTER.SITE + '/api/voice/twiml/' + hookKey;
  const form = { FriendlyName: 'ProWorld app calls', VoiceUrl: url, VoiceMethod: 'POST' };
  const app = c.appSid ? await call(c, 'POST', '/Applications/' + c.appSid + '.json', form) : await call(c, 'POST', '/Applications.json', form);
  await db.doc('settings/twilio').set({ appSid: app.sid, hookKey, connectedAt: Date.now() }, { merge: true });
  return status(db);
}
async function numbers(c) { const j = await call(c, 'GET', '/IncomingPhoneNumbers.json?PageSize=100'); return (j.incoming_phone_numbers || []).map((n) => ({ sid: n.sid, number: n.phone_number, name: n.friendly_name || '', app: n.voice_application_sid || '' })); }
async function status(db) {
  const c = await config(db); if (!c) return { set: false, ready: false, numbers: [], people: [] };
  let nums = []; let err = '';
  try { nums = await numbers(c); } catch (e) { err = e.message; }
  const staff = (await db.collection('staff').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((r) => r.active === true);
  const byNum = new Map(staff.filter((r) => r.voiceNumber).map((r) => [r.voiceNumber, r]));
  return { set: true, ready: !!c.appSid && !err, error: err, trial: undefined, numbers: nums.map((n) => ({ number: n.number, name: n.name, linked: n.app === c.appSid, person: byNum.has(n.number) ? { email: byNum.get(n.number).id, name: byNum.get(n.number).name || byNum.get(n.number).id } : null })), people: staff.map((r) => ({ email: r.id, name: r.name || r.id, number: r.voiceNumber || '' })).sort((a, b) => a.name.localeCompare(b.name)) };
}
/* one number, one person: the number's calls are pointed at the application, and the person's line on the team list carries it */
async function assign(db, body) {
  const c = await config(db); if (!c || !c.appSid) throw S.err(400, 'unset', 'Connect Twilio first.');
  const number = e164(body && body.number); const email = String((body && body.email) || '').trim().toLowerCase();
  const nums = await numbers(c); const n = nums.find((x) => x.number === number); if (!n) throw S.err(404, 'number', 'That number is not on the Twilio account.');
  const all = (await db.collection('staff').get()).docs;
  for (const d of all) { if ((d.data() || {}).voiceNumber === number && d.id !== email) await d.ref.set({ voiceNumber: '' }, { merge: true }); }
  if (email) { const p = all.find((d) => d.id === email); if (!p || (p.data() || {}).active !== true) throw S.err(404, 'person', 'That person is not on the team list.'); await p.ref.set({ voiceNumber: number }, { merge: true }); }
  if (n.app !== c.appSid) await call(c, 'POST', '/IncomingPhoneNumbers/' + n.sid + '.json', { VoiceApplicationSid: c.appSid });
  return status(db);
}
/* the pass the app shows Twilio: signed with the API key's secret, good for an hour, for this person only */
async function token(db, who, opts) {
  const c = await config(db); if (!c || !c.appSid) return { ready: false };
  const snap = await db.doc('staff/' + who.email).get(); const rec = snap.exists ? snap.data() || {} : {};
  const now = Math.floor(((opts && opts.now) || Date.now()) / 1000); const id = identity(who.email);
  const head = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
  const pay = { jti: c.keySid + '-' + now, iss: c.keySid, sub: c.accountSid, iat: now, exp: now + 3600, grants: { identity: id, voice: { incoming: { allow: true }, outgoing: { application_sid: c.appSid } } } };
  const body = b64(head) + '.' + b64(pay);
  const sig = crypto.createHmac('sha256', c.keySecret).update(body).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return { ready: true, token: body + '.' + sig, identity: id, number: rec.voiceNumber || '', canCall: !!rec.voiceNumber };
}
/* What Twilio is told when a call starts. `key` is the secret in the address; a wrong one gets nothing. */
async function twiml(db, key, body) {
  const snap = await db.doc('settings/twilio').get(); const c = snap.exists ? snap.data() || {} : {};
  const want = String(c.hookKey || ''); const given = String(key || '');
  if (want.length < 32 || given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) throw S.err(401, 'key', 'That address is not right.');
  const say = (t) => '<?xml version="1.0" encoding="UTF-8"?><Response><Say>' + xml(t) + '</Say></Response>';
  const from = String((body && body.From) || ''); const staff = (await db.collection('staff').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((r) => r.active === true);
  if (from.startsWith('client:')) {
    // from the app: the coach calls a family. The caller id is the coach's own number; a person with no number cannot call out.
    const me = staff.find((r) => identity(r.id) === from.slice(7)); const to = e164(body.To);
    if (!me || !me.voiceNumber) return say('Your ProWorld line is not set up yet. Ask an owner to give you a number.');
    if (!to) return say('That number does not look right.');
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="' + xml(me.voiceNumber) + '" answerOnBridge="true"><Number>' + xml(to) + '</Number></Dial></Response>';
  }
  // from outside: a family calls a coach's number, and the coach's app rings
  const owner = staff.find((r) => r.voiceNumber && r.voiceNumber === e164(body && body.To));
  if (!owner) return say('Thank you for calling ProWorld Academy. This line is not in use. Please text the front desk.');
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25" answerOnBridge="true"><Client>' + xml(identity(owner.id)) + '</Client></Dial><Say>Your coach cannot pick up right now. Please send a text and they will get back to you.</Say></Response>';
}
module.exports = { config, setup, status, assign, token, twiml, identity, e164, _useFetch: (f) => { fetchImpl = f; } };
