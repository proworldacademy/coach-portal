/* Messages from the coach to the family, from the Coach Portal, through the academy's JustCall line (Antonio, Nov 4, 2026):
   "they don't have to open two apps." A coach never opens JustCall. The academy has one number; every text a coach sends from
   the portal goes out from it, signed with the coach's name ("- Coach Casey, ProWorld Academy") so the family knows who writes.
   A reply from the family comes back through the JustCall webhook (sms.js keeps it as a smsLog line, kind 'reply'), shows on the
   player's page and in the portal's Messages view, and the coach hears on Slack. A text sent here ticks the week by itself
   (contacts/{playerId}_{Monday}, source 'portal') — no JustCall read needed.

   What lives where
   - smsBatches / smsLog        the record, the same shape as the front desk's Messages (one batch, one line per text; `from: 'portal'`,
                                `to: mother|father|guardian|player`), so the desk's family thread shows the coach's texts too
   - coachThreads/<playerId>    the inbox row: the last line either way, lastOutAt, lastReplyAt — written on every portal text and every reply
   - coachInbox/<email>         { read: { playerId: when the coach last opened that thread } } → unread = a reply after that
   Who may text whom: the player's own coach (coach or coach2 on the record), or a director. Only to a number on the player's
   page (the confirmed contacts, the numbers on file) — never a typed number. A family that said STOP, or whose consent was
   switched off, is not texted; the page says so and the coach calls instead.
   The signature is deliberately NOT the automated footer ("Reply here with any question" / "Sent automatically"): the AI that
   answers the academy's line treats a text without it as a person taking over, and stays out of that family's thread. */
'use strict';
const S = require('./stripe');
const NOTIFY = require('./notify');
const SMS = require('./sms');
const CONTACTS = require('./contacts');
const CAL = require('./calendar');

const SITE = 'https://proworld-coach-portal.web.app';
const MAX_BODY = 600;
const SLOTS = CONTACTS.SLOTS;
const SLOT_WORD = { mother: 'Mother', father: 'Father', guardian: 'Guardian', player: 'The player' };

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const e164 = (v) => NOTIFY.e164(v);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, n);
const tail = (phone) => String(phone || '').slice(-4);
const shortName = (who) => who.coachAs || who.firstName || first(who.name) || who.email;
const signature = (who) => `- Coach ${shortName(who)}, ProWorld Academy`;
const optedOutError = (msg) => /opt(ed)?[ -]?out|unsubscrib|blacklist|blocked|\bdnd\b|do not (disturb|message)/i.test(String(msg || ''));
const own = (who, p) => !!who.director || [p.coach, p.coach2].some((c) => c && who.keys.includes(fold(first(c))));
const pidOf = (v) => { const pid = clean(v, 60); if (!/^[a-z0-9-]{1,60}$/i.test(pid)) throw S.err(400, 'player', 'A player id is required.'); return pid; };

async function playerOf(db, who, pid) {
  const snap = await db.doc('players/' + pid).get(); if (!snap.exists) throw S.err(404, 'player', 'No such player.');
  const p = Object.assign({ id: pid }, snap.data() || {});
  if (!own(who, p)) throw S.err(403, 'own', `Only ${p.coach ? 'Coach ' + p.coach : "this player's coach"} or a director can message this family.`);
  return p;
}

/* The family's numbers as the player's page shows them: the confirmed contacts first (mother · father · guardian · the player),
   then what is on file. And whether the family may be texted at all. */
async function numbersOf(db, pid) {
  const [c, s, k] = (await Promise.all([db.doc(`players/${pid}/private/contact`).get(), db.doc(`players/${pid}/private/sms`).get(), db.doc(`contactCheck/${pid}`).get()])).map((x) => (x.exists ? (x.data() || {}) : {}));
  const list = [];
  const put = (slot, phone, name, source) => {
    const n = e164(phone); if (!n || !SMS.validPhone(n)) return;
    const cur = list.find((x) => x.phone === n);
    if (cur) { if (slot && !cur.slot) { cur.slot = slot; if (name) cur.name = clean(name, 80); } return; }
    list.push({ slot: slot || '', phone: n, name: clean(name, 80), source });
  };
  const slots = k.slots || {};
  SLOTS.forEach((sl) => { const x = slots[sl]; if (x && x.state === 'ok' && x.phone) put(sl, x.phone, x.name, 'check'); });
  put('', c.phone, c.guardian, 'contact'); put('', c.phone2, '', 'contact'); put('', s.phone, c.guardian, 'consent');
  const optOut = c.optOut === true || s.optIn === false;   // "Requested to OPT OUT" from the contacts import, STOP from the family, or consent switched off by staff
  return { numbers: list, optOut, optOutWhy: c.optOut === true ? 'The family asked for no texts (on file).' : s.optIn === false ? (s.source === 'stop' ? 'The family replied STOP.' : 'Texts are switched off for this family.') : '', consent: s.optIn === true };
}

/* coachThreads/<pid>: what the inbox lists — the last line either way, when the family last wrote, when the coach last did. */
async function touchThread(db, p, line) {
  const doc = { playerId: p.id, playerName: p.name || p.id, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '', last: { at: line.at, dir: line.dir, body: clean(line.body, 140), by: clean(line.by, 60) }, updatedAt: Date.now() };
  doc[line.dir === 'in' ? 'lastReplyAt' : 'lastOutAt'] = line.at;
  await db.doc('coachThreads/' + p.id).set(doc, { merge: true });
}

/* The week ticks itself: the coach reached the family. A week already green (by hand or by JustCall) is left as it is. */
async function tickWeek(db, who, p, to, at) {
  const week = CONTACTS.weekOf(CAL.todayET(at)); const ref = db.doc(`contacts/${p.id}_${week}`);
  const cur = await ref.get(); const old = cur.exists ? (cur.data() || {}) : null;
  if (old && old.done === true) return { week, ticked: false, already: true };
  await ref.set({ playerId: p.id, playerName: p.name || p.id, group: p.group || '', coach: p.coach || '', week, done: true, by: shortName(who), byEmail: who.email, at, how: 'text', who: to.slot === 'player' ? 'player' : 'parents', source: 'portal' }, { merge: true });
  return { week, ticked: true };
}

/* One text, now. Written to the record first (a batch and its line, like the desk's Messages), then sent; the line says what JustCall did. */
async function text(db, who, body) {
  body = body || {};
  const pid = pidOf(body.player); const p = await playerOf(db, who, pid);
  const msg = SMS.gsmSafe(clean(body.body, MAX_BODY)); if (!msg) throw S.err(400, 'body', 'Write the message first.');
  const { numbers, optOut, optOutWhy } = await numbersOf(db, pid);
  if (!numbers.length) throw S.err(409, 'numbers', 'No number on file for this family. Add one under Contacts for JustCall on the player\'s page.');
  if (optOut) throw S.err(403, 'optout', `${optOutWhy} Call them instead.`);
  const want = e164(body.to || ''); const slot = clean(body.slot, 12);
  const to = (want && numbers.find((n) => n.phone === want)) || (slot && numbers.find((n) => n.slot === slot)) || null;
  if (!to) throw S.err(400, 'to', 'Pick one of the numbers on the player\'s page.');
  const ln = await SMS.line(db);
  if (!ln.connected) throw S.err(409, 'keys', 'JustCall is not connected yet — an owner pastes the API key under Players & billing → Notifications.');
  if (!ln.from) throw S.err(409, 'from', 'The academy\'s JustCall number is not set (Players & billing → Notifications).');
  const s = await NOTIFY.settings(db, true);
  const full = (msg + '\n' + signature(who)).slice(0, 1600);
  const at = Date.now(); const batchRef = db.collection('smsBatches').doc(); const lineRef = db.collection('smsLog').doc();
  const seg = SMS.segments(full);
  let r = null, err = '';
  try { r = await SMS.justcallSend({ key: s.justcallKey, secret: s.justcallSecret }, ln.from, to.phone, full); } catch (e) { err = String(e.message || e).slice(0, 200); }
  const line = { batch: batchRef.id, at, by: who.email, byName: who.name || who.email, player: p.id, playerName: p.name || p.id, group: p.group || '', program: '', coach: p.coach || '', phone: to.phone, to: to.slot || '', toName: to.name || '', body: full, status: r ? 'sent' : 'failed', reason: '', attempts: 1, justcallId: r ? r.id : '', delivery: '', error: r ? '' : err, from: 'portal' };
  if (r) line.sentAt = Date.now(); else line.failedAt = Date.now();
  await batchRef.set({ at, by: who.email, byName: who.name || who.email, text: full, footer: '', template: 'coach', thread: 'f:' + p.id, threadLabel: p.name || p.id, portal: true, segments: seg.segments, encoding: seg.encoding, state: 'done', counts: { total: 1, sent: r ? 1 : 0, failed: r ? 0 : 1, skipped: 0, queued: 0 }, doneAt: Date.now() });
  await lineRef.set(line);
  if (!r) {
    if (optedOutError(err)) { try { await SMS.setOptIn(db, p.id, false, { source: 'justcall', by: 'justcall', phone: to.phone }); } catch (e) { /* the line says failed */ } }
    throw S.err(502, 'justcall', 'JustCall did not take it: ' + err);
  }
  const tick = await tickWeek(db, who, p, to, at);
  await touchThread(db, p, { at, dir: 'out', body: msg, by: shortName(who) });
  return { ok: true, line: publicLine(Object.assign({ id: lineRef.id }, line)), tick, to: { slot: to.slot, name: to.name, tail: tail(to.phone) } };
}

function publicLine(l) {
  if (l.kind === 'reply') return { id: l.id, at: l.at || 0, dir: 'in', body: String(l.body || ''), tail: tail(l.phone) };
  if (l.kind === 'optout' || l.kind === 'optin') return { id: l.id, at: l.at || 0, dir: 'sys', body: l.kind === 'optout' ? 'The family replied STOP: no more texts to this number.' : 'The family replied START: texts are back on.', tail: tail(l.phone) };
  return { id: l.id, at: l.at || 0, dir: 'out', body: String(l.body || ''), by: l.byName || l.by || '', status: l.status || '', delivery: l.delivery || '', error: l.error || '', to: l.to || '', toName: l.toName || '', tail: tail(l.phone), portal: l.from === 'portal' };
}

/* The whole conversation with one family: everything sent to this player's family (the coach's texts and the front desk's),
   every reply, STOP/START. Opening it marks it read for this coach. */
async function thread(db, who, pid, opts) {
  opts = opts || {}; pid = pidOf(pid);
  const p = await playerOf(db, who, pid);
  const { numbers, optOut, optOutWhy, consent } = await numbersOf(db, pid);
  const outs = (await db.collection('smsLog').where('player', '==', pid).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((l) => l.status !== 'skipped' && !l.kind);
  const ins = (await db.collection('smsLog').where('by', '==', 'family').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((l) => Array.isArray(l.players) && l.players.includes(pid));
  const lines = outs.concat(ins).map(publicLine).sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id))).slice(-200);
  if (opts.markRead !== false) { try { await db.doc('coachInbox/' + who.email).set({ email: who.email, read: { [pid]: Date.now() } }, { merge: true }); } catch (e) { /* a mark only */ } }
  const ln = await SMS.line(db);
  return { player: { id: p.id, name: p.name || p.id, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '', status: p.status || 'active' }, numbers: numbers.map((n) => ({ slot: n.slot, word: n.slot ? SLOT_WORD[n.slot] : 'On file', name: n.name, phone: n.phone, tail: tail(n.phone) })), optOut, optOutWhy, consent, line: { connected: ln.connected, from: ln.from ? tail(ln.from) : '' }, signature: signature(who), lines };
}

/* The inbox: one row per player of mine (a director: every active player), the last line, and whether the family wrote since
   I last opened the thread. Rows with something new first, then by the last line. */
async function inbox(db, who) {
  const players = (await db.collection('players').where('status', '==', 'active').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((p) => p.name && own(who, p));
  const ids = new Set(players.map((p) => p.id));
  const threads = new Map(); (await db.collection('coachThreads').get()).docs.forEach((d) => { const t = d.data() || {}; if (ids.has(t.playerId)) threads.set(t.playerId, t); });
  const mark = await db.doc('coachInbox/' + who.email).get(); const read = (mark.exists && (mark.data() || {}).read) || {};
  const rows = players.map((p) => { const t = threads.get(p.id) || null; const unread = !!(t && t.lastReplyAt && t.lastReplyAt > (read[p.id] || 0));
    return { id: p.id, name: p.name, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '', last: t && t.last ? { at: t.last.at || 0, dir: t.last.dir || 'out', body: t.last.body || '', by: t.last.by || '' } : null, unread, lastReplyAt: (t && t.lastReplyAt) || 0 }; });
  rows.sort((a, b) => (Number(b.unread) - Number(a.unread)) || (((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0)) || a.name.localeCompare(b.name));
  return { unread: rows.filter((r) => r.unread).length, rows, at: Date.now() };
}

/* A reply came in (the JustCall webhook kept it): the inbox row, and the coach's Slack — once per coach, however many
   siblings share the number. Needs the Slack bot token; without it the portal's red number is the reminder. */
async function onReply(db, ev) {
  ev = ev || {}; const ids = Array.from(new Set((ev.players || []).map((x) => String(x || '')).filter(Boolean))).slice(0, 10);
  const at = ev.at || Date.now(); const body = clean(ev.text, 600); const out = { threads: 0, dms: 0, coaches: [] };
  if (!ids.length) return out;
  const staff = await CONTACTS.staffIndex(db); const told = new Set();
  for (const pid of ids) {
    const snap = await db.doc('players/' + pid).get(); if (!snap.exists) continue;
    const p = Object.assign({ id: pid }, snap.data() || {});
    await touchThread(db, p, { at, dir: 'in', body, by: 'family' }); out.threads++;
    for (const c of [p.coach, p.coach2]) {
      const s = c && CONTACTS.staffFor(staff, c); if (!s || told.has(s.email)) continue; told.add(s.email); out.coaches.push(s.short || s.name);
      const w = String(p.name || pid).trim().split(/\s+/); const short = w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0];
      const line = `${short}'s family wrote back: "${body.slice(0, 160)}${body.length > 160 ? '…' : ''}" Answer from the portal: ${SITE}/portal#/p/${encodeURIComponent(pid)}`;
      if (s.slackId && !ev.dry && await NOTIFY.slackDm(db, s.slackId, line)) out.dms++;
    }
  }
  return out;
}

module.exports = { text, thread, inbox, onReply, numbersOf, signature, own, MAX_BODY };
