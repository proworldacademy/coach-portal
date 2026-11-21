/* The team's own messaging (Antonio, Nov 15, 2026: "replicate Slack inside our app" — channels, direct messages, group messages).
   The page (/team) reads and writes the chats straight from the database, live; the rules (firestore.rules, teamChats) decide who sees what.
   The engine does the three things a page cannot:
     people()  — the names of the team, for anyone on it (the staff list itself is for directors only);
     notify()  — after a message is written, the phones of the other people in that chat get a notification (shared with lib/push.js);
     post()    — what the engine used to say only on Slack (new players, the front desk's alerts) also lands in the matching channel.
   teamChats/<id>            { kind: 'channel' | 'dm' | 'group', name, topic, private, everyone, members: [e-mail], createdBy, createdAt, last: { at, by, name, text } }
   teamChats/<id>/messages   { by, name, text, at, th? (the message it answers), mentions?: [e-mail], everyone?: true, edited?, deleted?, reactions?, replies?, pushed? }
   teamReads/<e-mail>        { r: { <chat>: when read }, mute: { <chat>: true }, left: { <chat>: true } }
   A notification never throws: a missed ping must not undo a message. */
'use strict';
const S = require('./stripe');
const PUSH = require('./push');

const BOT = 'proworld@bot';
const CHANNELS = { coaches: 'new-enrollments', desk: 'front-desk-alerts', attendance: 'full-time-attendance' };   // the two Slack webhooks of lib/notify.js, by name
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;
const plain = (t) => String(t || '').replace(/<(https?:[^|>\s]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>\s]+)>/g, '$1').replace(/```/g, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

/* The team, for the people picker and the names beside messages: everyone active on the staff list. No pages, no notes — a name, a role, an address. */
async function people(db) {
  const snap = await db.collection('staff').get(); const out = [];
  snap.docs.forEach((d) => { const r = d.data() || {}; if (r.active !== true) return; out.push({ email: String(d.id).toLowerCase(), name: S.clean(r.name, 80) || String(d.id).split('@')[0], role: r.owner === true ? 'owner' : S.clean(r.role, 20) || 'team' }); });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { people: out };
}

/* Who is here now (Nov 19, 2026): a phone or a computer with the Locker Room open says so once a minute; the answer is everyone seen in
   the last quarter of an hour. One record (teamState/here), written by the engine only, so no one's reading list is opened to the others. */
/* Each person's own profile for the whole app (Nov 21, 2026): a photo and a colour, set by that person only. One record
   (teamState/profiles), written by the engine; `v` moves when anyone changes theirs, so the pages ask for it only when it moved. */
const PROFILE_COLORS = ['', 'lime', 'pink', 'grey'];
async function profiles(db) { try { const s = await db.doc('teamState/profiles').get(); const d = s.exists ? (s.data() || {}) : {}; return { v: Number(d.v || 0), p: d.p || {} }; } catch (e) { return { v: 0, p: {} }; } }
async function setProfile(db, who, body) {
  const me = String((who && who.email) || '').toLowerCase(); if (!me) throw S.err(403, 'who', 'Sign in again.');
  const rec = {}; const now = CLOCK();
  if (body.color !== undefined) { const c = String(body.color || ''); if (!PROFILE_COLORS.includes(c)) throw S.err(400, 'color', 'Pick one of the colours.'); rec.color = c; }
  if (body.photo !== undefined) { const ph = String(body.photo || ''); if (ph && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(ph) || ph.length > 40000)) throw S.err(400, 'photo', 'That photo is too big. Pick another one.'); rec.photo = ph; }
  if (!Object.keys(rec).length) throw S.err(400, 'empty', 'Nothing to save.'); rec.at = now;
  await db.doc('teamState/profiles').set({ v: now, p: { [me]: rec } }, { merge: true });
  return { ok: true, v: now, me: rec };
}
async function here(db, who, body) {
  const now = CLOCK(); const me = String((who && who.email) || '').toLowerCase(); const ref = db.doc('teamState/here');
  let at = {}; try { const s = await ref.get(); at = (s.exists && (s.data() || {}).at) || {}; } catch (e) { at = {}; }
  if (me) { at[me] = now; await ref.set({ at: { [me]: now } }, { merge: true }); }
  const out = {}; Object.keys(at).forEach((e) => { const t = Number(at[e] || 0); if (now - t < 15 * 60000) out[e] = now - t; });
  const pr = await profiles(db); const res = { here: out, pv: pr.v };
  if (body && Number(body.pv) !== pr.v) res.profiles = pr.p;
  return res;
}

/* Who hears about a message: the others in the chat, minus whoever muted it. A mention or @channel gets through a mute. */
let CLOCK = () => Date.now();   // the tests set the hour
async function listeners(db, chat, chatId, fromEmail, msg) {
  const members = (Array.isArray(chat.members) ? chat.members : []).map((e) => String(e || '').toLowerCase()).filter((e) => e && e !== fromEmail);
  const loud = new Set((Array.isArray(msg.mentions) ? msg.mentions : []).map((e) => String(e || '').toLowerCase())); const all = msg.everyone === true;
  const out = []; const hr = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(CLOCK()))); const night = hr >= 21 || hr < 7;
  for (const e of members) {
    if (all || loud.has(e)) { out.push(e); continue; }
    let muted = false; try { const r = await db.doc('teamReads/' + e).get(); const x = (r.exists && r.data()) || {}; muted = !!(x.mute || {})[chatId] || (night && x.quiet === true && chat.kind === 'channel'); } catch (err) { muted = false; }   // quiet at night (the person's own switch): a channel waits for the morning, a direct message and a mention do not
    if (!muted) out.push(e);
  }
  return out;
}
async function fanOut(db, emails, note) {
  const out = { sent: 0, gone: 0, failed: 0, to: emails.length };
  for (let i = 0; i < emails.length; i += 10) { try { const r = await PUSH.send(db, emails.slice(i, i + 10), note); out.sent += r.sent || 0; out.gone += r.gone || 0; out.failed += r.failed || 0; } catch (e) { out.failed++; } }
  return out;
}
const titleOf = (chat, name) => (chat.kind === 'channel' ? '#' + (chat.name || 'channel') + ' · ' + name : chat.kind === 'group' ? name + ' · ' + (chat.name || 'group') : name);

/* The page calls this right after it writes a message: POST /api/team/notify { chat, id }. Only the author, only once per message. */
async function notify(db, who, body) {
  const chatId = String((body && body.chat) || ''); const id = String((body && body.id) || '');
  if (!ID_OK.test(chatId) || !ID_OK.test(id)) throw S.err(400, 'message', 'Which message?');
  const cref = db.doc('teamChats/' + chatId); const csnap = await cref.get(); if (!csnap.exists) throw S.err(404, 'chat', 'No such chat.');
  const chat = csnap.data() || {}; const me = String(who.email || '').toLowerCase();
  if (!(Array.isArray(chat.members) && chat.members.map((e) => String(e).toLowerCase()).includes(me))) throw S.err(403, 'chat', 'You are not in this chat.');
  const mref = cref.collection('messages').doc(id); const msnap = await mref.get(); if (!msnap.exists) throw S.err(404, 'message', 'No such message.');
  const msg = msnap.data() || {};
  if (String(msg.by || '').toLowerCase() !== me) throw S.err(403, 'message', 'Not your message.');
  if (msg.pushed) return { ok: true, sent: 0, again: true };
  if (msg.call) return { ok: true, sent: 0, call: true };   // a call rings by itself
  await mref.set({ pushed: Date.now() }, { merge: true });
  const to = await listeners(db, chat, chatId, me, msg);
  const name = S.clean(msg.name, 60) || S.clean(who.name, 60) || 'ProWorld';
  const r = await fanOut(db, to, { title: titleOf(chat, name), body: plain(msg.text).slice(0, 170) || (Array.isArray(msg.files) && msg.files.length ? (/^image\//.test(String(msg.files[0].type || '')) ? '📷 Photo' : '📎 ' + S.clean(msg.files[0].name, 80)) : msg.call ? 'Started a call' : 'New message'), url: '/team#/c/' + chatId, tag: 'team-' + chatId });
  return Object.assign({ ok: true }, r);
}

/* The engine's own voice in a channel (the alerts Slack used to get). Nothing happens until that channel exists. Never throws. */
async function post(db, which, text, lines) {
  try {
    const chatId = CHANNELS[which] || which; if (!db || !ID_OK.test(String(chatId))) return false;
    const cref = db.doc('teamChats/' + chatId); const csnap = await cref.get(); if (!csnap.exists) return false;
    const chat = csnap.data() || {}; const at = Date.now();
    const body = String(lines && lines.length ? lines.filter(Boolean).join('\n') : text || '').slice(0, 3900); if (!body.trim()) return false;
    const mref = cref.collection('messages').doc('b' + at.toString(36) + Math.random().toString(36).slice(2, 8));
    const msg = { by: BOT, name: 'ProWorld', bot: true, text: body, at, pushed: at };
    await mref.set(msg);
    await cref.set({ last: { at, by: BOT, name: 'ProWorld', text: plain(text || body).slice(0, 140) } }, { merge: true });
    const to = await listeners(db, chat, chatId, BOT, msg);
    await fanOut(db, to, { title: '#' + (chat.name || chatId), body: plain(text || body).slice(0, 170), url: '/team#/c/' + chatId, tag: 'team-' + chatId });
    return true;
  } catch (e) { console.error('team post error', e.message); return false; }
}

/* A line from the system to one person (what used to be a Slack direct message: the weekly contact reminder, a private booked): a direct
   message from "ProWorld" in their Team list, with a notification. Never throws. */
function botChatId(email) { let a = 5381, b = 52711; const s = String(email || '').toLowerCase(); for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); a = ((a * 33) ^ ch) >>> 0; b = ((b * 33) ^ ch) >>> 0; } return 'bot_' + a.toString(36) + b.toString(36); }
async function direct(db, email, text) {
  try {
    email = String(email || '').toLowerCase(); const body = String(text || '').slice(0, 3900); if (!db || !email.includes('@') || !body.trim()) return false;
    const chatId = botChatId(email); const cref = db.doc('teamChats/' + chatId); const csnap = await cref.get(); const at = Date.now();
    if (!csnap.exists) await cref.set({ kind: 'dm', bot: true, members: [BOT, email].sort(), createdBy: BOT, createdAt: at });
    await cref.collection('messages').doc('b' + at.toString(36) + Math.random().toString(36).slice(2, 8)).set({ by: BOT, name: 'ProWorld', bot: true, text: body, at, pushed: at });
    await cref.set({ last: { at, by: BOT, name: 'ProWorld', text: plain(body).slice(0, 140) } }, { merge: true });
    let muted = false; try { const r = await db.doc('teamReads/' + email).get(); muted = !!(r.exists && ((r.data() || {}).mute || {})[chatId]); } catch (e) { muted = false; }
    if (!muted) await fanOut(db, [email], { title: 'ProWorld', body: plain(body).slice(0, 170), url: '/team#/c/' + chatId, tag: 'team-' + chatId });
    return true;
  } catch (e) { console.error('team direct error', e.message); return false; }
}

/* What another system of ours says to the team (the concierge handing a family to a person, its daily check): POST /api/team/hook with the
   roster feed key it already holds. { channel?: 'concierge', text, lines? } — Slack's own shape ({ text }) is accepted as it is. */
const HOOK_CHANNELS = ['concierge', 'front-desk-alerts', 'new-enrollments', 'full-time-attendance', 'announcements'];
async function hook(db, body) {
  const b = body || {}; const channel = HOOK_CHANNELS.includes(String(b.channel || '')) ? String(b.channel) : 'concierge';
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 12).map((l) => String(l == null ? '' : l).slice(0, 1500)) : null;
  const text = String(b.text || (lines && lines[0]) || '').slice(0, 3900); if (!text.trim()) throw S.err(400, 'text', 'Nothing to post.');
  return { ok: await post(db, channel, text, lines) };
}

/* Calls (Nov 15, 2026). The phones talk to each other directly (WebRTC); the engine does two things. ice(): the list of relay servers a
   call may need when two phones cannot reach each other (settings/turn { keyId, token }: a Cloudflare Realtime TURN key, owners only;
   without it, the public address finders only, which is enough on most Wi-Fi). ring(): the notification "… is calling" to the others. */
let fetchImpl = (...a) => fetch(...a);
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
async function turnConfig(db) { try { const s = await db.doc('settings/turn').get(); const d = s.exists ? (s.data() || {}) : {}; const keyId = String(d.keyId || '').trim(); const token = String(d.token || '').trim(); return /^[A-Za-z0-9]{16,64}$/.test(keyId) && token.length >= 20 ? { keyId, token } : null; } catch (e) { return null; } }
async function ice(db) {
  const c = await turnConfig(db); if (!c) return { iceServers: STUN, relay: false };
  try {
    const r = await fetchImpl('https://rtc.live.cloudflare.com/v1/turn/keys/' + c.keyId + '/credentials/generate-ice-servers', { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 14400 }) });
    if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
    const clean = list.filter((x) => x && x.urls).map((x) => ({ urls: (Array.isArray(x.urls) ? x.urls : [x.urls]).filter((u) => /^(stun|turn|turns):/.test(String(u)) && !/:53(\?|$)/.test(String(u))), username: x.username, credential: x.credential })).filter((x) => x.urls.length);
    if (!clean.length) throw new Error('empty'); return { iceServers: clean, relay: clean.some((x) => x.urls.some((u) => /^turns?:/.test(u))) };
  } catch (e) { console.error('turn error', e.message); return { iceServers: STUN, relay: false }; }
}
async function turnReady(db) { const c = await turnConfig(db); if (!c) return { set: false, ready: false }; const r = await ice(db); return { set: true, ready: r.relay }; }
async function ring(db, who, body) {
  const id = String((body && body.call) || ''); if (!ID_OK.test(id)) throw S.err(400, 'call', 'Which call?');
  const ref = db.doc('teamCalls/' + id); const snap = await ref.get(); if (!snap.exists) throw S.err(404, 'call', 'No such call.');
  const c = snap.data() || {}; const me = String(who.email || '').toLowerCase();
  if (String(c.by || '').toLowerCase() !== me) throw S.err(403, 'call', 'Not your call.');
  if (c.rang) return { ok: true, sent: 0, again: true };
  await ref.set({ rang: Date.now() }, { merge: true });
  const to = (Array.isArray(c.members) ? c.members : []).map((e) => String(e || '').toLowerCase()).filter((e) => e && e !== me && e !== BOT);
  const name = S.clean(c.byName, 60) || S.clean(who.name, 60) || 'Someone';
  const r = await fanOut(db, to, { title: (c.kind === 'video' ? '📹 ' : '📞 ') + name + ' is calling', body: c.title ? S.clean(c.title, 80) + ' · tap to join' : 'Tap to join', url: '/team#/call/' + id, tag: 'call-' + id });
  return Object.assign({ ok: true }, r);
}
function _useFetch(f) { fetchImpl = f || ((...a) => fetch(...a)); }

module.exports = { _clock: (f) => { CLOCK = f || (() => Date.now()); }, people, here, setProfile, profiles, notify, post, direct, hook, ice, ring, turnReady, botChatId, plain, BOT, CHANNELS, _useFetch };
