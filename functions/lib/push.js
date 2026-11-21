/* Notifications on the coach's phone (Antonio and Lorenzo, Nov 13, 2026): "when the coaches download the app they get notifications,
   like any other app". Standard Web Push: the phone's browser (Chrome on a Samsung; on an iPhone the app added to the Home Screen,
   iOS 16.4 or later) hands the portal a subscription, the engine keeps it under the person's e-mail and sends to it when a family
   writes back. The signing keys (VAPID) are made by the engine the first time and kept in settings/push — nobody pastes a key.
   Subscriptions live in pushSubs/<id>, engine only (no rule opens it). A phone that no longer accepts (404/410) is forgotten. */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');

const SUBJECT = 'mailto:info@proworldacademy.com';
let sender = null;                                   // the tests swap the network out
function _useSender(fn) { sender = fn; }
function lib() { return require('web-push'); }

let KEYS = null;
async function keys(db) {
  if (KEYS) return KEYS;
  const ref = db.doc('settings/push'); const snap = await ref.get(); const d = snap.exists ? (snap.data() || {}) : {};
  if (d.publicKey && d.privateKey) { KEYS = { publicKey: d.publicKey, privateKey: d.privateKey }; return KEYS; }
  const k = lib().generateVAPIDKeys();
  await ref.set({ publicKey: k.publicKey, privateKey: k.privateKey, createdAt: Date.now() }, { merge: true });
  KEYS = { publicKey: k.publicKey, privateKey: k.privateKey }; return KEYS;
}
const idOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);
function cleanSub(sub) {
  const endpoint = String((sub && sub.endpoint) || '');
  if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint)) throw S.err(400, 'subscription', 'This phone did not hand over a subscription.');
  const k = (sub && sub.keys) || {}; const p256dh = String(k.p256dh || ''), auth = String(k.auth || '');
  if (!/^[A-Za-z0-9_\-+/=]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_\-+/=]{8,100}$/.test(auth)) throw S.err(400, 'subscription', 'This phone did not hand over a subscription.');
  return { endpoint, keys: { p256dh, auth } };
}
async function subscribe(db, who, body) {
  const sub = cleanSub(body && body.subscription); const id = idOf(sub.endpoint);
  await db.doc('pushSubs/' + id).set({ email: who.email, endpoint: sub.endpoint, keys: sub.keys, ua: S.clean(body && body.ua, 200), at: Date.now() });
  return { ok: true };
}
async function unsubscribe(db, who, body) {
  const endpoint = String((body && body.endpoint) || ''); if (!endpoint) return { ok: true };
  const ref = db.doc('pushSubs/' + idOf(endpoint)); const snap = await ref.get();
  if (snap.exists && (snap.data() || {}).email === who.email) await ref.delete();
  return { ok: true };
}
/* Send one notification to every phone of these people. Returns how many went out. Never throws: a notification is a nicety. */
/* ── The App Store app (Nov 15, 2026): the phone's own notifications, through Apple (APNs) ──
   A phone that runs the app hands over a device token (POST /api/coach/push/apns); it is kept in pushSubs like a web subscription, with
   kind 'apns'. Apple wants every send signed with the academy's APNs key: settings/apns { keyId, p8, teamId?, bundle? }, owners only, typed once
   on the Dashboard. Not set → the app's phones are skipped, the web ones still get theirs. A token Apple no longer knows (410, or 400
   BadDeviceToken / Unregistered) is forgotten. */
const APNS_HOST = 'https://api.push.apple.com'; const TEAM = 'PDHM2GBBB6'; const BUNDLE = 'com.proworldacademy.app';
let apnsSender = null; let APNS = null; let JWT = null;
function _useApns(fn) { apnsSender = fn; }
const pem = (p8) => { const t = String(p8 || '').trim(); return /BEGIN PRIVATE KEY/.test(t) ? t : '-----BEGIN PRIVATE KEY-----\n' + (t.replace(/[^A-Za-z0-9+/=]/g, '').match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n'; };
async function apnsConfig(db) {
  if (APNS && Date.now() - APNS.at < 5 * 60 * 1000) return APNS.cfg;
  const snap = await db.doc('settings/apns').get(); const d = snap.exists ? (snap.data() || {}) : {};
  const keyId = String(d.keyId || '').trim(); const p8 = String(d.p8 || '').trim();
  const cfg = keyId && p8 ? { keyId, p8: pem(p8), teamId: String(d.teamId || TEAM), bundle: String(d.bundle || BUNDLE) } : null;
  APNS = { at: Date.now(), cfg }; return cfg;
}
async function apnsReady(db) { APNS = null; const c = await apnsConfig(db); if (!c) return false; try { crypto.createPrivateKey(c.p8); return true; } catch (e) { return false; } }
function apnsJwt(cfg) {
  const now = Math.floor(Date.now() / 1000); if (JWT && JWT.kid === cfg.keyId && now - JWT.iat < 40 * 60) return JWT.token;      // Apple: reuse for up to an hour
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const head = b64({ alg: 'ES256', kid: cfg.keyId }), body = b64({ iss: cfg.teamId, iat: now });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: crypto.createPrivateKey(cfg.p8), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  JWT = { kid: cfg.keyId, iat: now, token: head + '.' + body + '.' + sig }; return JWT.token;
}
function apnsPost(cfg, token, payload) {
  return new Promise((resolve, reject) => {
    const http2 = require('http2'); const client = http2.connect(APNS_HOST); let done = false; const end = (fn, v) => { if (done) return; done = true; try { client.close(); } catch (e) { /* closed */ } fn(v); };
    client.on('error', (e) => end(reject, e)); client.setTimeout(8000, () => end(reject, new Error('apns timeout')));
    const req = client.request({ ':method': 'POST', ':path': '/3/device/' + token, authorization: 'bearer ' + apnsJwt(cfg), 'apns-topic': cfg.bundle, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600), 'content-type': 'application/json' });
    let status = 0, data = ''; req.on('response', (h) => { status = Number(h[':status']) || 0; }); req.setEncoding('utf8'); req.on('data', (c) => { data += c; });
    req.on('end', () => { let reason = ''; try { reason = (JSON.parse(data || '{}').reason) || ''; } catch (e) { reason = ''; } if (status === 200) end(resolve, { ok: true }); else { const err = new Error('apns ' + status + ' ' + reason); err.statusCode = status; err.reason = reason; end(reject, err); } });
    req.on('error', (e) => end(reject, e)); req.end(JSON.stringify(payload));
  });
}
const cleanToken = (t) => { const v = String(t || '').trim().toLowerCase(); if (!/^[0-9a-f]{64,200}$/.test(v)) throw S.err(400, 'token', 'This phone did not hand over a notification token.'); return v; };
async function registerApns(db, who, body) {
  const token = cleanToken(body && body.token);
  await db.doc('pushSubs/' + idOf('apns:' + token)).set({ email: who.email, kind: 'apns', token, ua: S.clean(body && body.ua, 200), at: Date.now() });
  return { ok: true };
}
async function unregisterApns(db, who, body) {
  let token = ''; try { token = cleanToken(body && body.token); } catch (e) { return { ok: true }; }
  const ref = db.doc('pushSubs/' + idOf('apns:' + token)); const snap = await ref.get();
  if (snap.exists && String((snap.data() || {}).email || '') === who.email) await ref.delete();
  return { ok: true };
}

async function send(db, emails, note) {
  const list = Array.from(new Set((emails || []).map((e) => String(e || '').toLowerCase()).filter(Boolean))).slice(0, 10); const out = { sent: 0, gone: 0, failed: 0 };
  if (!list.length) return out;
  /* Quiet at night for a client profile (Nov 21, 2026): 9 pm to 6 am nothing buzzes the phone of someone who asked for that. Staff
     have their own switch in the Locker Room; this one reads clients/<e-mail>.quiet and leaves everyone else alone. */
  const hr = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if ((hr >= 21 || hr < 6) && note.urgent !== true) { for (const e of list.slice()) { try { const c = await db.doc('clients/' + e).get(); if (c.exists && (c.data() || {}).quiet === true) list.splice(list.indexOf(e), 1); } catch (err) { /* told as usual */ } } if (!list.length) return out; }
  let subs = [];
  try { const snap = await db.collection('pushSubs').where('email', 'in', list).get(); subs = snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {})); } catch (e) { return out; }
  if (!subs.length) return out;
  const payload = JSON.stringify({ title: S.clean(note.title, 80) || 'PROWORLD', body: S.clean(note.body, 180), url: String(note.url || '/portal'), tag: S.clean(note.tag, 80) });
  let k = null; let apns = null; let apnsRead = false;
  for (const s of subs) {
    try {
      if (s.kind === 'apns') {
        if (!apnsRead) { apnsRead = true; try { apns = await apnsConfig(db); } catch (e) { apns = null; } }
        if (!apns) { out.skipped = (out.skipped || 0) + 1; continue; }
        const p = { aps: { alert: { title: S.clean(note.title, 80) || 'ProWorld', body: S.clean(note.body, 180) }, sound: 'default', 'thread-id': S.clean(note.tag, 80) || 'proworld' }, url: String(note.url || '/portal') };
        if (apnsSender) await apnsSender(s.token, p, apns); else await apnsPost(apns, s.token, p);
        out.sent++; continue;
      }
      if (!k) { try { k = await keys(db); } catch (e) { out.failed++; continue; } }
      if (sender) await sender({ endpoint: s.endpoint, keys: s.keys }, payload);
      else await lib().sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { vapidDetails: { subject: SUBJECT, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 3600, urgency: 'high' });
      out.sent++;
    } catch (e) {
      const code = e && (e.statusCode || e.status);
      if (code === 404 || code === 410 || (s.kind === 'apns' && code === 400 && /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(String(e.reason || '')))) { out.gone++; try { await db.doc('pushSubs/' + s.id).delete(); } catch (e2) { /* next time */ } } else out.failed++;
    }
  }
  return out;
}
module.exports = { keys, subscribe, unsubscribe, send, registerApns, unregisterApns, apnsReady, _useSender, _useApns, _reset: () => { KEYS = null; APNS = null; JWT = null; } };
