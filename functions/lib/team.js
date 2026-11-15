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
const CHANNELS = { coaches: 'new-enrollments', desk: 'front-desk-alerts' };   // the two Slack webhooks of lib/notify.js, by name
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;
const plain = (t) => String(t || '').replace(/<(https?:[^|>\s]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>\s]+)>/g, '$1').replace(/```/g, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

/* The team, for the people picker and the names beside messages: everyone active on the staff list. No pages, no notes — a name, a role, an address. */
async function people(db) {
  const snap = await db.collection('staff').get(); const out = [];
  snap.docs.forEach((d) => { const r = d.data() || {}; if (r.active !== true) return; out.push({ email: String(d.id).toLowerCase(), name: S.clean(r.name, 80) || String(d.id).split('@')[0], role: r.owner === true ? 'owner' : S.clean(r.role, 20) || 'team' }); });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { people: out };
}

/* Who hears about a message: the others in the chat, minus whoever muted it. A mention or @channel gets through a mute. */
async function listeners(db, chat, chatId, fromEmail, msg) {
  const members = (Array.isArray(chat.members) ? chat.members : []).map((e) => String(e || '').toLowerCase()).filter((e) => e && e !== fromEmail);
  const loud = new Set((Array.isArray(msg.mentions) ? msg.mentions : []).map((e) => String(e || '').toLowerCase())); const all = msg.everyone === true;
  const out = [];
  for (const e of members) {
    if (all || loud.has(e)) { out.push(e); continue; }
    let muted = false; try { const r = await db.doc('teamReads/' + e).get(); muted = !!(r.exists && ((r.data() || {}).mute || {})[chatId]); } catch (err) { muted = false; }
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
  await mref.set({ pushed: Date.now() }, { merge: true });
  const to = await listeners(db, chat, chatId, me, msg);
  const name = S.clean(msg.name, 60) || S.clean(who.name, 60) || 'ProWorld';
  const r = await fanOut(db, to, { title: titleOf(chat, name), body: plain(msg.text).slice(0, 170) || 'New message', url: '/team#/c/' + chatId, tag: 'team-' + chatId });
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

module.exports = { people, notify, post, plain, BOT, CHANNELS };
