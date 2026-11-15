/* E-mail from the engine (Nov 14, 2026): one use so far — the sign-in code a parent types to open the family account (lib/signin.js).
   Sent through the academy's own mailbox over SMTP. The mailbox and its app password live in settings/mail (owners only, typed once on the
   Dashboard by an owner — never in a file, never in a chat): { user, pass, from?, host?, port? }. Not set up → a clear 503, nothing sent. */
'use strict';
const S = require('./stripe');
let transportFactory = null;                         // the tests swap the network out
function _useTransport(fn) { transportFactory = fn; }

async function config(db) {
  const snap = await db.doc('settings/mail').get(); const d = snap.exists ? (snap.data() || {}) : {};
  const user = String(d.user || '').trim(); const pass = String(d.pass || '').replace(/\s+/g, '');
  if (!user || !pass) throw S.err(503, 'mail', 'E-mail from PROWORLD is not set up yet.');
  return { user, pass, from: String(d.from || '').trim() || `ProWorld Academy <${user}>`, host: String(d.host || 'smtp.gmail.com'), port: Number(d.port) || 465 };
}
async function ready(db) { try { await config(db); return true; } catch (e) { return false; } }

async function send(db, msg) {
  const c = await config(db);
  const make = transportFactory || ((cfg) => require('nodemailer').createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } }));
  try { await make(c).sendMail({ from: c.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }); }
  catch (e) { console.error('mail: send failed', (e && e.code) || '', (e && e.responseCode) || ''); throw S.err(502, 'mail', 'The e-mail could not be sent. Try again in a minute.'); }
  return { sent: true };
}
module.exports = { send, ready, _useTransport };
