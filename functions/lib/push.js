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
async function send(db, emails, note) {
  const list = Array.from(new Set((emails || []).map((e) => String(e || '').toLowerCase()).filter(Boolean))).slice(0, 10); const out = { sent: 0, gone: 0, failed: 0 };
  if (!list.length) return out;
  let subs = [];
  try { const snap = await db.collection('pushSubs').where('email', 'in', list).get(); subs = snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {})); } catch (e) { return out; }
  if (!subs.length) return out;
  const payload = JSON.stringify({ title: S.clean(note.title, 80) || 'PROWORLD', body: S.clean(note.body, 180), url: String(note.url || '/portal'), tag: S.clean(note.tag, 80) });
  let k = null; try { k = await keys(db); } catch (e) { return out; }
  for (const s of subs) {
    try {
      if (sender) await sender({ endpoint: s.endpoint, keys: s.keys }, payload);
      else await lib().sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { vapidDetails: { subject: SUBJECT, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 3600, urgency: 'high' });
      out.sent++;
    } catch (e) {
      const code = e && (e.statusCode || e.status);
      if (code === 404 || code === 410) { out.gone++; try { await db.doc('pushSubs/' + s.id).delete(); } catch (e2) { /* next time */ } } else out.failed++;
    }
  }
  return out;
}
module.exports = { keys, subscribe, unsubscribe, send, _useSender, _reset: () => { KEYS = null; } };
