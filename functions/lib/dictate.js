/* Dictation (Nov 22, 2026 — "in the app, anything you can create by dictation… so I can dictate, kind of like Wispr Flow").

   A microphone on every text box of the app (shared/dictate.js): the person talks, taps stop, and the words land in the box.
   The recording goes to the engine, the engine hands it to the transcription service, the text comes back. Nothing is kept:
   not the recording, not the text.

     POST /api/dictate { audio: <base64>, mime }   anyone signed in: the team or a family   → { text }
     GET  /api/dictate/ready                        → { ready }
     GET/POST /api/admin/dictate                    owners: is the key on file · save it (settings/dictate { openaiKey }, never returned)

   The service is OpenAI's transcription API (the academy's own key). Models are tried newest first; one that the account does not
   have is skipped, so a model retired by the provider does not stop dictation. A person may send DAILY recordings a day, each up
   to MAX_BYTES (about two minutes). */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');
const CAL = require('./calendar');

const API = 'https://api.openai.com/v1/audio/transcriptions';
const MODELS = ['gpt-4o-mini-transcribe', 'gpt-transcribe', 'whisper-1'];
const MAX_BYTES = 3 * 1024 * 1024, DAILY = 300;
/* words the academy uses, so they come out spelled right */
const HINT = 'ProWorld Academy, Locker Room, 10 & Under, Full Time, Afterschool, private lesson, make-up session, Delray Beach.';
const EXT = { 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
let cache = { at: 0, data: null }; let poster = null;
function _useService(fn) { poster = fn; cache = { at: 0, data: null }; }

async function settings(db, fresh) {
  if (!fresh && cache.data && Date.now() - cache.at < 60 * 1000) return cache.data;
  let d = {}; try { const s = await db.doc('settings/dictate').get(); d = s.exists ? (s.data() || {}) : {}; } catch (e) { d = {}; }
  cache = { at: Date.now(), data: d }; return d;
}
const keyOk = (k) => /^sk-[A-Za-z0-9_-]{20,}$/.test(String(k || ''));
async function ready(db) { return keyOk((await settings(db)).openaiKey); }

async function saveKey(db, who, body) {
  const key = String((body && body.key) || '').trim(); if (!keyOk(key)) throw S.err(400, 'key', 'That does not look like an OpenAI API key. It starts with sk-.');
  await db.doc('settings/dictate').set({ openaiKey: key, at: Date.now(), by: who.email }); cache = { at: 0, data: null };
  return { ready: true };
}

/* one try at the service with one model; { text } or { skip: true } when the account does not have that model */
async function once(key, buf, mime, model, hint) {
  if (poster) return poster({ model, mime, bytes: buf.length, hint });
  const fd = new FormData(); fd.append('file', new Blob([buf], { type: mime }), 'speech.' + (EXT[mime] || 'm4a')); fd.append('model', model); fd.append('response_format', 'json'); if (hint) fd.append('prompt', hint);
  const r = await fetch(API, { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd }); const j = await r.json().catch(() => ({}));
  if (r.ok) return { text: String(j.text || '') };
  const msg = String((j.error && (j.error.message || j.error.code)) || ''); const code = String((j.error && j.error.code) || '');
  if (r.status === 404 || code === 'model_not_found' || /model/i.test(msg) && /(not exist|not found|access|deprecat|unsupported)/i.test(msg)) return { skip: true };
  if (r.status === 400 && hint && /prompt/i.test(msg)) return { noHint: true };
  if (r.status === 401) throw S.err(502, 'key', 'The dictation key was refused. An owner can paste a new one on the Dashboard.');
  if (r.status === 429) throw S.err(502, 'busy', 'Dictation is busy or out of credit. Try again in a moment.');
  throw S.err(502, 'service', 'Dictation could not read that. Try again.');
}

async function transcribe(db, who, body) {
  body = body || {}; const st = await settings(db); if (!poster && !keyOk(st.openaiKey)) throw S.err(409, 'nokey', 'Dictation is not switched on yet.');
  const mime = String(body.mime || 'audio/mp4').split(';')[0].trim().toLowerCase(); if (!EXT[mime]) throw S.err(400, 'mime', 'That recording cannot be read.');
  const raw = String(body.audio || ''); if (!raw || raw.length > MAX_BYTES * 1.4) throw S.err(raw ? 413 : 400, 'audio', raw ? 'That is too long for one go. Keep it under two minutes.' : 'Nothing was recorded.');
  const buf = Buffer.from(raw, 'base64'); if (buf.length < 800) throw S.err(400, 'short', 'That was too short. Hold on a little longer.'); if (buf.length > MAX_BYTES) throw S.err(413, 'audio', 'That is too long for one go. Keep it under two minutes.');
  const day = CAL.todayET(); const useRef = db.doc('dictateUse/' + crypto.createHash('sha256').update('pw:' + String(who.email).toLowerCase()).digest('hex').slice(0, 32) + '_' + day);
  const use = await useRef.get(); const n = use.exists ? Number((use.data() || {}).n) || 0 : 0; if (n >= DAILY) throw S.err(429, 'many', 'That is a lot of dictation for one day. Type the rest.');
  await useRef.set({ n: n + 1, at: Date.now() });
  const models = [String(st.model || '')].concat(MODELS).filter((m, i, a) => m && a.indexOf(m) === i);
  for (const m of models) {
    let out = await once(st.openaiKey, buf, mime, m, HINT); if (out && out.noHint) out = await once(st.openaiKey, buf, mime, m, '');
    if (out && out.skip) continue;
    let text = String((out && out.text) || '').replace(/\s+/g, ' ').trim();
    if (text && HINT.indexOf(text) >= 0) text = '';   // silence can come back as the hint itself
    return { text };
  }
  throw S.err(502, 'model', 'Dictation is not available on this key. An owner can check the account.');
}

module.exports = { transcribe, ready, saveKey, settings, MODELS, MAX_BYTES, DAILY, _useService };
