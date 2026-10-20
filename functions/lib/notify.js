/* What the engine says on its own, and to whom.
   Slack — two incoming webhooks: one for the coaches (new players, holds, spots released) and one for the front desk
   (everything, with the family's details). Texts — the academy's JustCall line, the same API the concierge uses.
   The settings live in the database, settings/notify, written by an owner from the backend page (Players & billing →
   Notifications): { slackCoaches, slackDesk, justcallKey, justcallSecret, justcallNumber, textsOn }. Missing settings mean
   "do nothing", never an error: a missed ping must never fail a payment or an enrollment.
   Every text ends with the same two sentences on purpose — the concierge recognises them as automatic and does not treat
   our message as a human taking over the family's thread. Keep them if you change the wording. */
'use strict';

const JUSTCALL_API = 'https://api.justcall.io/v2.1';
const MAX_SMS = 1200;
const SIGN = 'Reply here with any question. Sent automatically by ProWorld Academy.';
const FRONT_DESK = '(561) 403-0008';

let cache = { at: 0, data: null };
async function settings(db, fresh) {
  if (!db) return {};
  if (!fresh && cache.data && Date.now() - cache.at < 60 * 1000) return cache.data;
  let data = {};
  try { const snap = await db.doc('settings/notify').get(); data = snap.exists ? (snap.data() || {}) : {}; } catch (e) { data = {}; }
  cache = { at: Date.now(), data };
  return data;
}
function forget() { cache = { at: 0, data: null }; }

/* JustCall wants E.164; a bare 10-digit number is North American. */
function e164(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.charAt(0) === '+') return '+' + raw.slice(1).replace(/[^\d]/g, '');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.length === 10 ? '+1' + digits : digits.length === 11 && digits[0] === '1' ? '+' + digits : '+' + digits;
}

const fetcher = () => (typeof fetch === 'function' ? fetch : null);
let override = null;                              // the tests swap the network out
function _useFetch(fn) { override = fn; }
function net() { return override || fetcher(); }

/* A Slack message. `which` is 'coaches' or 'desk'; with only one webhook set, everything goes there. Returns true when posted. */
async function slack(db, which, text, lines) {
  try {
    const s = await settings(db);
    const hook = (which === 'coaches' ? s.slackCoaches : s.slackDesk) || s.slackDesk || s.slackCoaches;
    if (!hook || !/^https:\/\/hooks\.slack\.com\//.test(String(hook))) return false;
    const f = net(); if (!f) return false;
    const body = { text: String(text).slice(0, 2900) };
    if (lines && lines.length) body.blocks = [{ type: 'section', text: { type: 'mrkdwn', text: lines.filter(Boolean).join('\n').slice(0, 2900) } }];
    const res = await f(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { console.error('slack failed', which, res.status); return false; }
    return true;
  } catch (e) { console.error('slack error', e.message); return false; }
}

/* A text to a family. Only when texts are switched on and the JustCall keys are set. Returns true when sent. */
async function text(db, to, body) {
  try {
    const s = await settings(db);
    const number = e164(to); if (!number) return false;
    if (s.textsOn !== true || !s.justcallKey || !s.justcallSecret) return false;
    const from = e164(s.justcallNumber || '+15614030008');
    const f = net(); if (!f) return false;
    const msg = (String(body).trim() + ' ' + SIGN).slice(0, MAX_SMS);
    const res = await f(JUSTCALL_API + '/texts/new', {
      method: 'POST',
      headers: { Authorization: s.justcallKey + ':' + s.justcallSecret, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ justcall_number: from, contact_number: number, body: msg })
    });
    if (!res.ok) { console.error('justcall failed', res.status); return false; }
    return true;
  } catch (e) { console.error('justcall error', e.message); return false; }
}

/* The test message an owner sends from the backend page to see that the keys work. */
async function test(db, phone) {
  forget();
  const s = await settings(db, true);
  const out = { coaches: false, desk: false, text: false, textsOn: s.textsOn === true, hasKeys: !!(s.justcallKey && s.justcallSecret) };
  if (s.slackCoaches) out.coaches = await slack(db, 'coaches', 'Test from the PROWORLD backend — the coaches channel is connected.');
  if (s.slackDesk) out.desk = await slack(db, 'desk', 'Test from the PROWORLD backend — the front desk channel is connected.');
  if (phone) out.text = await text(db, phone, 'ProWorld Academy: this is a test from the backend. Texts to families are switched on.');
  return out;
}

module.exports = { settings, forget, e164, slack, text, test, SIGN, FRONT_DESK, _useFetch };
