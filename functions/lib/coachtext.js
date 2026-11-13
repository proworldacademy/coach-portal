/* Messages from the coach to the family, from the Coach Portal, through the academy's JustCall line (Antonio, Nov 4, 2026):
   "they don't have to open two apps." A coach never opens JustCall. The academy has one number; every text a coach sends from
   the portal goes out from it, signed with the coach's name ("- Coach Casey, ProWorld Academy") so the family knows who writes.
   A reply from the family comes back through the JustCall webhook (sms.js keeps it as a smsLog line, kind 'reply'), shows on the
   player's page and in the portal's Messages view, and the coach hears on Slack. A text sent here ticks the week by itself
   (contacts/{playerId}_{Monday}, source 'portal') — no JustCall read needed.

   Chats (Antonio, Nov 4 evening): "like iMessage — I'm texting the mother, and then I'm texting the group chat; that's a separate
   chat." Every family has one chat per number on the player's page (Mother · Father · Guardian · the player) and any number of
   group chats (Mother & Father, everyone…). A chat is named by the numbers in it — its key is the numbers' last four digits,
   sorted, joined with '+' ('0100' is the mother's chat, '0100+0109' the parents' chat) — so a chat survives a slot being renamed
   and no full number ever travels to the page. A group text goes to each member as their own text (one JustCall text per
   number — the carriers' SMS has no shared group thread); in the portal it reads as one chat with everyone's replies. A reply
   lands in the chat the family last heard from on that number (the group if the last text to the mother was a group text, her
   own chat otherwise), like answering the last message on a phone; before any text, in the number's own chat.

   What lives where
   - smsBatches / smsLog        the record, the same shape as the front desk's Messages (one batch, one line per text; `from: 'portal'`,
                                `to: mother|father|guardian|player`, `conv: <chat key>`), so the desk's family thread shows the coach's texts too
   - coachThreads/<playerId>    the inbox rows: `convs[key]` = members, the last line either way, lastOutAt, lastReplyAt — written on
                                every portal text and every reply; the top-level `last` is the family's latest across chats
   - coachInbox/<email>         { read: { '<playerId>|<key>': when the coach last opened that chat } } → unread = a reply after that
   Who may text whom: the player's own coach (coach or coach2 on the record), or a director. Only to a number on the player's
   page (the confirmed contacts, the numbers on file) — never a typed number. A family that said STOP, or whose consent was
   switched off, is not texted; the page says so and the coach calls instead.
   The signature is deliberately NOT the automated footer ("Reply here with any question" / "Sent automatically"): the AI that
   answers the academy's line treats a text without it as a person taking over, and stays out of that family's thread. */
/* Every coach on their own number (Antonio, Nov 6: "every coach is getting their own JustCall number… I don't want coaches
   having access to all the chats, just what's happening on their JustCall, on their number"). A coach with a JustCall number
   (staff/<email>.justcallNumber, else the number of their JustCall seat under the same e-mail) texts from it, and their chats
   show only the lines on it: what they sent from the portal or from the JustCall app (the contact sync keeps those as lines),
   and what the family wrote back to that number. A coach with no number yet sees only what they sent and the answers to it.
   Directors and owners see every line, as before. Every line carries `line` = the JustCall number it went through. */
'use strict';
const S = require('./stripe');
const NOTIFY = require('./notify');
const PUSH = require('./push');
const SMS = require('./sms');
const CONTACTS = require('./contacts');
const CAL = require('./calendar');

const SITE = 'https://proworld-coach-portal.web.app';
const MAX_BODY = 600;
const MAX_MEMBERS = 6;            // a family's chat: the numbers on the player's page, never a list
const PACE_MS = 1200;             // JustCall takes 30 texts a minute in a burst; a group text to three numbers paces itself
const SLOTS = CONTACTS.SLOTS;
const SLOT_WORD = { mother: 'Mother', father: 'Father', guardian: 'Guardian', player: 'The player' };
const ADULT = ['mother', 'father', 'guardian'];

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const e164 = (v) => NOTIFY.e164(v);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, n);
const tail = (phone) => String(phone || '').slice(-4);
const preview = (body) => clean(String(body || '').replace(/\n- [^\n]*$/, ''), 140);   // a text without its signature line ("- Coach Kim, …", the desk's footer)
const shortName = (who) => who.coachAs || who.firstName || first(who.name) || who.email;
const signature = (who) => `- Coach ${shortName(who)}, ProWorld Academy`;
const optedOutError = (msg) => /opt(ed)?[ -]?out|unsubscrib|blacklist|blocked|\bdnd\b|do not (disturb|message)/i.test(String(msg || ''));
const own = (who, p) => !!who.director || [p.coach, p.coach2].some((c) => c && who.keys.includes(fold(first(c))));
const pidOf = (v) => { const pid = clean(v, 60); if (!/^[a-z0-9-]{1,60}$/i.test(pid)) throw S.err(400, 'player', 'A player id is required.'); return pid; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pace = (ms) => sleep(ms);

/* The coach's own JustCall number: on the staff record, else their JustCall seat's (looked up once in ten minutes). */
const SEATS = { at: 0, byEmail: new Map() };
async function ownLine(db, who) {
  if (!who) return '';
  const set = e164(who.justcallNumber || ''); if (set) return set;
  if (Date.now() - SEATS.at > 600000) {
    try { const r = await CONTACTS.justcallUsers(db); if (r && r.ok) { SEATS.byEmail = new Map(r.users.map((u) => [u.email, (u.own || [])[0] || ''])); SEATS.at = Date.now(); } } catch (e) { /* no seat known: the academy line */ }
  }
  return SEATS.byEmail.get(String(who.email || '').toLowerCase()) || '';
}
/* What one coach may see of a family's record: a director everything; a coach the lines on their own number — or, before they
   have one, the texts they sent and the family's answers to those numbers after them. */
function scopeLines(who, mine, outs, ins) {
  if (who.director) return { outs, ins };
  if (mine) return { outs: outs.filter((l) => l.line === mine), ins: ins.filter((l) => l.line === mine) };
  const o = outs.filter((l) => l.by === who.email); const first = new Map(); o.forEach((l) => { if (!first.has(l.phone) || l.at < first.get(l.phone)) first.set(l.phone, l.at); });
  return { outs: o, ins: ins.filter((l) => first.has(l.phone) && (l.at || 0) > first.get(l.phone) && !l.line) };
}

/* The chat key: the last four digits of every number in it, sorted, joined with '+'. One number → its own chat. */
const convKey = (phones) => Array.from(new Set((phones || []).map(tail).filter(Boolean))).sort().join('+');
const keyOk = (k) => /^\d{4}(\+\d{4}){0,5}$/.test(String(k || ''));
const slotRank = (s) => { const i = SLOTS.indexOf(s); return i < 0 ? SLOTS.length : i; };
const publicMember = (m) => ({ slot: m.slot || '', word: m.slot ? SLOT_WORD[m.slot] : 'On file', name: m.name || '', tail: tail(m.phone) || m.tail || '' });
/* "Mother & Father", "Mother, Father & The player", "Mother · Pat" */
function titleOf(members) {
  const ms = (members || []).slice().sort((a, b) => slotRank(a.slot) - slotRank(b.slot) || String(a.tail || '').localeCompare(String(b.tail || '')));
  const word = (m) => (m.slot ? SLOT_WORD[m.slot] : m.name ? m.name : 'Number …' + (m.tail || ''));
  if (ms.length === 1) return word(ms[0]) + (ms[0].slot && ms[0].name ? ' · ' + ms[0].name : '');
  const w = ms.map(word); return w.length ? w.slice(0, -1).join(', ') + ' & ' + w[w.length - 1] : 'Family';
}

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

/* coachThreads/<pid>: what the inbox lists — per chat its members and the last line either way; on top, the family's latest. */
async function touchThread(db, p, line, conv) {
  const last = { at: line.at, dir: line.dir, body: clean(line.body, 140), by: clean(line.by, 60) };
  const doc = { playerId: p.id, playerName: p.name || p.id, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '', last, updatedAt: Date.now() };
  doc[line.dir === 'in' ? 'lastReplyAt' : 'lastOutAt'] = line.at;
  if (conv && conv.key) {
    const c = { key: conv.key, members: (conv.members || []).map((m) => ({ phone: m.phone || '', tail: tail(m.phone) || m.tail || '', slot: m.slot || '', name: clean(m.name, 80) })), title: titleOf(conv.members || []), last, updatedAt: Date.now() };
    c[line.dir === 'in' ? 'lastReplyAt' : 'lastOutAt'] = line.at;
    doc.convs = { [conv.key]: c };
  }
  await db.doc('coachThreads/' + p.id).set(doc, { merge: true });
}

/* The week ticks itself: the coach reached the family. A week already green (by hand or by JustCall) is left as it is. */
async function tickWeek(db, who, p, tos, at) {
  const week = CONTACTS.weekOf(CAL.todayET(at)); const ref = db.doc(`contacts/${p.id}_${week}`);
  const cur = await ref.get(); const old = cur.exists ? (cur.data() || {}) : null;
  if (old && old.done === true) return { week, ticked: false, already: true };
  const slots = tos.map((t) => t.slot); const adult = slots.some((s) => s !== 'player'), kid = slots.includes('player');
  await ref.set({ playerId: p.id, playerName: p.name || p.id, group: p.group || '', coach: p.coach || '', week, done: true, by: shortName(who), byEmail: who.email, at, how: 'text', who: adult && kid ? 'both' : kid ? 'player' : 'parents', source: 'portal' }, { merge: true });
  return { week, ticked: true };
}

/* Who the text goes to: a chat key (its numbers), a list of numbers or slots, or one number / one slot — always numbers on the player's page. */
function recipientsOf(body, numbers) {
  const want = [].concat(body.to || []).map((v) => e164(v)).filter(Boolean);
  const slots = [].concat(body.slot || []).map((v) => clean(v, 12)).filter(Boolean);
  const key = clean(body.conv, 40);
  let tos = [];
  if (key) {
    if (!keyOk(key)) throw S.err(400, 'conv', 'That chat is not one of this family\'s.');
    const tails = key.split('+'); tos = tails.map((t) => numbers.find((n) => tail(n.phone) === t) || null);
    if (tos.some((t) => !t)) throw S.err(400, 'to', 'A number in that chat is no longer on the player\'s page. Open the player and check the contacts.');
  } else {
    tos = want.map((w) => numbers.find((n) => n.phone === w) || null).concat(slots.map((sl) => numbers.find((n) => n.slot === sl) || null));
    if (tos.length && tos.some((t) => !t)) throw S.err(400, 'to', 'Pick one of the numbers on the player\'s page.');   // nothing is dropped quietly: a number not on the page refuses the whole text
  }
  const seen = new Set(); tos = tos.filter(Boolean).filter((t) => (seen.has(t.phone) ? false : (seen.add(t.phone), true)));
  if (!tos.length) throw S.err(400, 'to', 'Pick one of the numbers on the player\'s page.');
  if (tos.length > MAX_MEMBERS) throw S.err(400, 'to', `A chat can hold up to ${MAX_MEMBERS} numbers.`);
  return tos;
}

/* One text, now — to one number or to every number in a chat. Written to the record first (a batch and its lines, like the
   desk's Messages), then sent one by one; each line says what JustCall did with it. */
async function text(db, who, body) {
  body = body || {};
  const pid = pidOf(body.player); const p = await playerOf(db, who, pid);
  const msg = SMS.gsmSafe(clean(body.body, MAX_BODY)); if (!msg) throw S.err(400, 'body', 'Write the message first.');
  const { numbers, optOut, optOutWhy } = await numbersOf(db, pid);
  if (!numbers.length) throw S.err(409, 'numbers', 'No number on file for this family. Add one under Contacts for JustCall on the player\'s page.');
  if (optOut) throw S.err(403, 'optout', `${optOutWhy} Call them instead.`);
  const tos = recipientsOf(body, numbers); const key = convKey(tos.map((t) => t.phone));
  const ln = await SMS.line(db);
  if (!ln.connected) throw S.err(409, 'keys', 'JustCall is not connected yet — an owner pastes the API key under Players & billing → Notifications.');
  const mineLine = await ownLine(db, who); const fromNum = mineLine || ln.from;
  if (!fromNum) throw S.err(409, 'from', 'The academy\'s JustCall number is not set (Players & billing → Notifications).');
  const s = await NOTIFY.settings(db, true);
  const full = (msg + '\n' + signature(who)).slice(0, 1600);
  const at = Date.now(); const batchRef = db.collection('smsBatches').doc();
  const seg = SMS.segments(full);
  const lines = []; let sent = 0, failed = 0, lastErr = '';
  for (let i = 0; i < tos.length; i++) {
    const to = tos[i]; const lineRef = db.collection('smsLog').doc();
    if (i) await pace(PACE_MS);
    let r = null, err = '';
    try { r = await SMS.justcallSend({ key: s.justcallKey, secret: s.justcallSecret }, fromNum, to.phone, full); } catch (e) { err = String(e.message || e).slice(0, 200); }
    const line = { batch: batchRef.id, at: at + i, by: who.email, byName: who.name || who.email, player: p.id, playerName: p.name || p.id, group: p.group || '', program: '', coach: p.coach || '', phone: to.phone, to: to.slot || '', toName: to.name || '', conv: key, body: full, status: r ? 'sent' : 'failed', reason: '', attempts: 1, justcallId: r ? r.id : '', delivery: '', error: r ? '' : err, from: 'portal', line: fromNum };
    if (r) { line.sentAt = Date.now(); sent++; } else { line.failedAt = Date.now(); failed++; lastErr = err; if (optedOutError(err)) { try { await SMS.setOptIn(db, p.id, false, { source: 'justcall', by: 'justcall', phone: to.phone }); } catch (e) { /* the line says failed */ } } }
    lines.push(Object.assign({ id: lineRef.id }, line)); await lineRef.set(line);
  }
  await batchRef.set({ at, by: who.email, byName: who.name || who.email, text: full, footer: '', template: 'coach', thread: 'f:' + p.id, threadLabel: p.name || p.id, portal: true, conv: key, segments: seg.segments, encoding: seg.encoding, state: 'done', counts: { total: tos.length, sent, failed, skipped: 0, queued: 0 }, doneAt: Date.now() });
  if (!sent) throw S.err(502, 'justcall', 'JustCall did not take it: ' + lastErr);
  const tick = await tickWeek(db, who, p, tos.filter((t, i) => lines[i].status === 'sent'), at);
  await touchThread(db, p, { at, dir: 'out', body: msg, by: shortName(who) }, { key, members: tos });
  const out = { ok: true, lines: lines.map(publicLine), tick, conv: key, title: titleOf(tos), to: tos.map((t) => ({ slot: t.slot, name: t.name, tail: tail(t.phone) })), sent, failed };
  out.line = out.lines[0]; if (tos.length === 1) out.to = out.to[0];   // the one-number shape the page knew first
  return out;
}

/* A family's "Yes" or "Start" is an opt-in to the engine, but to the coach it is an answer: it shows as their words ("Yes, we
   will be there"), with a small "texts on" note. STOP shows as a note (and their words, when they wrote more than the word). */
const BARE_START = /^\s*(start|unstop|subscribe)\s*[.!]*\s*$/i;
function publicLine(l) {
  if (l.kind === 'reply') return { id: l.id, at: l.at || 0, dir: 'in', body: String(l.body || ''), tail: tail(l.phone), conv: l.conv || '' };
  if (l.kind === 'optin') { const body = String(l.body || '').trim(); return { id: l.id, at: l.at || 0, dir: 'in', body: body && !BARE_START.test(body) ? body : 'START', tail: tail(l.phone), conv: l.conv || '', note: 'texts on' }; }
  if (l.kind === 'optout') return { id: l.id, at: l.at || 0, dir: 'sys', body: 'The family replied STOP: no more texts to this number.', words: String(l.body || '').trim().slice(0, 200), tail: tail(l.phone), conv: l.conv || '' };
  return { id: l.id, at: l.at || 0, dir: 'out', body: String(l.body || ''), by: l.byName || l.by || '', status: l.status || '', delivery: l.delivery || '', error: l.error || '', to: l.to || '', toName: l.toName || '', tail: tail(l.phone), portal: l.from === 'portal', conv: l.conv || tail(l.phone), batch: l.batch || '' };
}

/* Every line of this family's record, in order, each filed in its chat: a text sent from here or from the desk carries its key
   (a desk text, or one from before chats existed, is the number's own chat); a reply or STOP/START goes to the chat the family
   last heard from on that number. */
function fileLines(outs, ins) {
  const sorted = ins.slice().sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)));
  const dedup = []; sorted.forEach((l) => { const prev = dedup[dedup.length - 1]; if (prev && prev.kind === l.kind && prev.phone === l.phone && String(prev.body || '') === String(l.body || '') && Math.abs((l.at || 0) - (prev.at || 0)) < 120000) return; dedup.push(l); });   // JustCall sends two events per text; a STOP/START kept twice shows once
  const all = outs.map((l) => Object.assign({}, l, { conv: l.conv || tail(l.phone) })).concat(dedup).sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)));
  const lastTo = {};
  all.forEach((l) => { if (!l.kind) lastTo[l.phone] = l.conv; else l.conv = lastTo[l.phone] || tail(l.phone); });
  return all;
}
/* The chats of one family: one per number on the page, every group that was ever texted, and — before any group exists — the
   parents together (the adults with a number; everyone, when the page has no two adults). */
function chatsOf(numbers, lines, read, pid) {
  const byTail = new Map(numbers.map((n) => [tail(n.phone), n]));
  const members = (key) => String(key).split('+').map((t) => byTail.get(t) || { phone: '', tail: t, slot: '', name: '' });
  const convs = new Map();
  const seed = (key) => { if (!key || convs.has(key)) return; const ms = members(key); convs.set(key, { key, members: ms, title: titleOf(ms), count: 0, last: null, lastOutAt: 0, lastReplyAt: 0, unread: false, suggested: false }); };
  numbers.forEach((n) => seed(tail(n.phone)));
  lines.forEach((l) => seed(l.conv));
  const adults = numbers.filter((n) => ADULT.includes(n.slot));
  const together = adults.length >= 2 ? convKey(adults.map((n) => n.phone)) : numbers.length >= 2 ? convKey(numbers.map((n) => n.phone)) : '';
  if (together && !convs.has(together)) { seed(together); convs.get(together).suggested = true; }
  lines.forEach((l) => { const c = convs.get(l.conv); if (!c) return; c.count++; c.last = { at: l.at || 0, dir: l.kind ? 'in' : 'out', body: l.kind === 'optout' ? 'STOP' : preview(l.body), by: l.kind ? 'family' : (l.byName || l.by || '') , tail: tail(l.phone) }; if (l.kind) c.lastReplyAt = Math.max(c.lastReplyAt, l.at || 0); else c.lastOutAt = Math.max(c.lastOutAt, l.at || 0); });
  convs.forEach((c) => { const seen = Math.max(read[pid + '|' + c.key] || 0, read[pid] || 0); c.unread = c.lastReplyAt > seen; });
  return Array.from(convs.values()).sort((a, b) => (a.members.length - b.members.length) || (a.members.length === 1 ? slotRank(a.members[0].slot) - slotRank(b.members[0].slot) : 0) || String(a.key).localeCompare(String(b.key)));
}

/* The whole conversation with one family, chat by chat: everything sent to this player's family (the coach's texts and the
   front desk's), every reply, STOP/START. Opening a chat (`conv`) marks it read for this coach. */
async function thread(db, who, pid, opts) {
  opts = opts || {}; pid = pidOf(pid);
  const p = await playerOf(db, who, pid);
  const { numbers, optOut, optOutWhy, consent } = await numbersOf(db, pid);
  const outs = (await db.collection('smsLog').where('player', '==', pid).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((l) => l.status !== 'skipped' && !l.kind);
  const ins0 = (await db.collection('smsLog').where('by', '==', 'family').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((l) => Array.isArray(l.players) && l.players.includes(pid));
  const mineLine = await ownLine(db, who); const sc = scopeLines(who, mineLine, outs, ins0);
  const all = fileLines(sc.outs, sc.ins);
  const key = clean(opts.conv, 40);
  if (key && keyOk(key) && opts.markRead !== false) { try { await db.doc('coachInbox/' + who.email).set({ email: who.email, read: { [pid + '|' + key]: Date.now() } }, { merge: true }); } catch (e) { /* a mark only */ } }
  const mark = await db.doc('coachInbox/' + who.email).get(); const read = (mark.exists && (mark.data() || {}).read) || {};
  const chats = chatsOf(numbers, all, read, pid);
  if (who.director) await fileConvs(db, p, chats);   // the shared inbox rows hold every line; a coach's own view is computed, never written
  const convs = chats.map((c) => Object.assign({}, c, { members: c.members.map(publicMember) }));
  const lines = all.slice(-400).map(publicLine);
  const ln = await SMS.line(db);
  return { player: { id: p.id, name: p.name || p.id, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '', status: p.status || 'active' }, numbers: numbers.map((n) => ({ slot: n.slot, word: n.slot ? SLOT_WORD[n.slot] : 'On file', name: n.name, phone: n.phone, tail: tail(n.phone) })), convs, optOut, optOutWhy, consent, line: { connected: ln.connected, from: (mineLine || ln.from) ? tail(mineLine || ln.from) : '', own: !!mineLine }, signature: signature(who), lines };
}

/* The chats as the inbox lists them, written onto coachThreads/<pid>.convs (only the chats with a line in them). A thread
   from before chats existed (PR #26: no `convs`) is completed this way the first time the family is opened or listed. */
async function fileConvs(db, p, chats) {
  const convs = {};
  chats.filter((c) => c.count).forEach((c) => { convs[c.key] = { key: c.key, members: c.members.map((m) => ({ phone: m.phone || '', tail: m.tail || tail(m.phone), slot: m.slot || '', name: clean(m.name, 80) })), title: c.title, last: c.last, lastOutAt: c.lastOutAt || 0, lastReplyAt: c.lastReplyAt || 0, updatedAt: Date.now() }; });
  if (!Object.keys(convs).length) return convs;
  try { await db.doc('coachThreads/' + p.id).set({ playerId: p.id, playerName: p.name || p.id, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '', convs, convsAt: Date.now() }, { merge: true }); } catch (e) { /* the page still has the chats */ }
  return convs;
}
async function rebuildConvs(db, p, ins) {
  const { numbers } = await numbersOf(db, p.id);
  const outs = (await db.collection('smsLog').where('player', '==', p.id).get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((l) => l.status !== 'skipped' && !l.kind);
  const mine = ins.filter((l) => Array.isArray(l.players) && l.players.includes(p.id));
  return fileConvs(db, p, chatsOf(numbers, fileLines(outs, mine), {}, p.id));
}

/* "I read this chat" — the mark alone, when the page already has the lines. */
async function markRead(db, who, body) {
  body = body || {}; const pid = pidOf(body.player); const key = clean(body.conv, 40);
  if (!keyOk(key)) throw S.err(400, 'conv', 'Which chat?');
  await playerOf(db, who, pid);
  await db.doc('coachInbox/' + who.email).set({ email: who.email, read: { [pid + '|' + key]: Date.now() } }, { merge: true });
  return { ok: true, player: pid, conv: key };
}

/* The inbox: every family of mine (a director: every active player), as a messages app lists them — one row per chat with
   texts in it (something new first, then by the last line), then the families with no texts yet, by name, each ready for a
   first text. A thread from before chats existed (no `convs`) is rebuilt from the record on the spot (a few reads, once). */
async function inbox(db, who) {
  const players = (await db.collection('players').where('status', '==', 'active').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((p) => p.name && own(who, p));
  const ids = new Set(players.map((p) => p.id));
  const mark = await db.doc('coachInbox/' + who.email).get(); const read = (mark.exists && (mark.data() || {}).read) || {};
  if (!who.director) return coachInbox(db, who, players, read);
  const threads = new Map(); (await db.collection('coachThreads').get()).docs.forEach((d) => { const t = d.data() || {}; if (ids.has(t.playerId)) threads.set(t.playerId, t); });
  const legacy = players.filter((p) => { const t = threads.get(p.id); return t && t.last && !(t.convs && typeof t.convs === 'object' && Object.keys(t.convs).length); }).slice(0, 25);
  if (legacy.length) {
    const ins = (await db.collection('smsLog').where('by', '==', 'family').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
    for (const p of legacy) { try { const convs = await rebuildConvs(db, p, ins); threads.set(p.id, Object.assign({}, threads.get(p.id), { convs })); } catch (e) { /* listed as the family's chat below */ } }
  }
  const rows = [], quiet = [];
  players.forEach((p) => {
    const t = threads.get(p.id) || null; const base = { id: p.id, name: p.name, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '' };
    const convs = t && t.convs && typeof t.convs === 'object' ? Object.values(t.convs).filter((c) => c && c.key) : [];
    const seenAll = Math.max(read[p.id] || 0, ...Object.keys(read).filter((k) => k.startsWith(p.id + '|')).map((k) => read[k] || 0));   // a thread from before chats: any mark on this family counts
    if (!convs.length && t && t.last) convs.push({ key: '', members: [], title: 'Family', last: t.last, lastReplyAt: t.lastReplyAt || 0, lastOutAt: t.lastOutAt || 0, legacy: true });
    if (!convs.length) { quiet.push(Object.assign({}, base, { conv: '', title: '', members: [], last: null, unread: false, lastReplyAt: 0, quiet: true })); return; }
    convs.forEach((c) => { const seen = c.legacy ? seenAll : Math.max(read[p.id + '|' + c.key] || 0, read[p.id] || 0); const lastReplyAt = c.lastReplyAt || 0;
      rows.push(Object.assign({}, base, { conv: c.key, title: c.title || titleOf(c.members || []), members: (c.members || []).map(publicMember), last: c.last ? { at: c.last.at || 0, dir: c.last.dir || 'out', body: c.last.body || '', by: c.last.by || '' } : null, unread: lastReplyAt > seen, lastReplyAt })); });
  });
  rows.sort((a, b) => (Number(b.unread) - Number(a.unread)) || (((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0)) || a.name.localeCompare(b.name) || a.conv.localeCompare(b.conv));
  quiet.sort((a, b) => a.name.localeCompare(b.name));
  return { unread: rows.filter((r) => r.unread).length, unreadFamilies: new Set(rows.filter((r) => r.unread).map((r) => r.id)).size, rows, quiet, families: players.length, at: Date.now() };
}

/* A coach's inbox, from their own lines only (their number, or what they sent): one row per chat with a line, then every other
   family of theirs, quiet. Two reads: the lines on their number (or by them), the family replies. */
async function coachInbox(db, who, players, read) {
  const mineLine = await ownLine(db, who); const ids = new Set(players.map((p) => p.id));
  const outsAll = mineLine ? (await db.collection('smsLog').where('line', '==', mineLine).get()).docs : (await db.collection('smsLog').where('by', '==', who.email).get()).docs;
  const outs = outsAll.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((l) => !l.kind && l.status !== 'skipped' && ids.has(l.player));
  const ins0 = (await db.collection('smsLog').where('by', '==', 'family').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
  const rows = [], quiet = [];
  for (const p of players) {
    const base = { id: p.id, name: p.name, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '' };
    const sc = scopeLines(who, mineLine, outs.filter((l) => l.player === p.id), ins0.filter((l) => Array.isArray(l.players) && l.players.includes(p.id)));
    if (!sc.outs.length && !sc.ins.length) { quiet.push(Object.assign({}, base, { conv: '', title: '', members: [], last: null, unread: false, lastReplyAt: 0, quiet: true })); continue; }
    const { numbers } = await numbersOf(db, p.id);
    chatsOf(numbers, fileLines(sc.outs, sc.ins), read, p.id).filter((c) => c.count).forEach((c) => rows.push(Object.assign({}, base, { conv: c.key, title: c.title, members: c.members.map(publicMember), last: c.last ? { at: c.last.at, dir: c.last.dir, body: c.last.body, by: c.last.by } : null, unread: c.unread, lastReplyAt: c.lastReplyAt })));
  }
  rows.sort((a, b) => (Number(b.unread) - Number(a.unread)) || (((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0)) || a.name.localeCompare(b.name) || a.conv.localeCompare(b.conv));
  quiet.sort((a, b) => a.name.localeCompare(b.name));
  return { unread: rows.filter((r) => r.unread).length, unreadFamilies: new Set(rows.filter((r) => r.unread).map((r) => r.id)).size, rows, quiet, families: players.length, at: Date.now(), line: mineLine ? tail(mineLine) : '' };
}

/* Which chat a reply belongs to: the chat of the last text this number got from this family's record — a group text puts the
   answer in the group, a direct text in the number's own chat; a number never texted answers in its own chat. */
async function convOfReply(db, pid, phone) {
  const key1 = tail(phone); if (!key1) return { key: '', members: [] };
  const outs = (await db.collection('smsLog').where('player', '==', pid).get()).docs.map((d) => d.data() || {}).filter((l) => !l.kind && l.status !== 'skipped' && l.phone);
  const mine = outs.filter((l) => l.phone === phone).sort((a, b) => (b.at || 0) - (a.at || 0));
  const key = mine.length ? (mine[0].conv || key1) : key1;
  const seen = new Map(); outs.filter((l) => (l.conv || tail(l.phone)) === key).forEach((l) => { if (!seen.has(l.phone)) seen.set(l.phone, { phone: l.phone, slot: l.to || '', name: l.toName || '' }); });
  if (!seen.has(phone)) seen.set(phone, { phone, slot: '', name: '' });
  try { const { numbers } = await numbersOf(db, pid); seen.forEach((m) => { const n = numbers.find((x) => x.phone === m.phone); if (n) { m.slot = n.slot || m.slot; m.name = n.name || m.name; } }); } catch (e) { /* names are a nicety */ }
  return { key, members: Array.from(seen.values()) };
}

/* A reply came in (the JustCall webhook kept it): the inbox row of the right chat, and the coach's Slack — once per coach,
   however many siblings share the number. Needs the Slack bot token; without it the portal's red number is the reminder. */
async function onReply(db, ev) {
  ev = ev || {}; const ids = Array.from(new Set((ev.players || []).map((x) => String(x || '')).filter(Boolean))).slice(0, 10);
  const at = ev.at || Date.now(); const body = clean(ev.text, 600); const phone = e164(ev.phone || ''); const out = { threads: 0, dms: 0, coaches: [] };
  if (!ids.length) return out;
  const staff = await CONTACTS.staffIndex(db); const told = new Set();
  /* a reply to a coach's own number is that coach's: only they hear about it (Nov 6) */
  const toLine = e164(ev.line || ''); let lineOwner = '';
  if (toLine) { for (const st of staff.list) { if (e164(st.justcallNumber || '') === toLine || (await ownLine(db, { email: st.email, justcallNumber: st.justcallNumber })) === toLine) { lineOwner = st.email; break; } } }
  for (const pid of ids) {
    const snap = await db.doc('players/' + pid).get(); if (!snap.exists) continue;
    const p = Object.assign({ id: pid }, snap.data() || {});
    const conv = phone ? await convOfReply(db, pid, phone) : { key: '', members: [] };
    await touchThread(db, p, { at, dir: 'in', body, by: 'family' }, conv); out.threads++;
    for (const c of [p.coach, p.coach2]) {
      const s = c && CONTACTS.staffFor(staff, c); if (!s || told.has(s.email)) continue; if (lineOwner && s.email !== lineOwner) continue; told.add(s.email); out.coaches.push(s.short || s.name);
      const w = String(p.name || pid).trim().split(/\s+/); const short = w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0];
      const whoWrote = conv.members.length > 1 ? (conv.members.find((m) => m.phone === phone) || {}) : {};
      const line = `${short}'s family wrote back${whoWrote.slot ? ' (' + SLOT_WORD[whoWrote.slot].toLowerCase().replace('the ', '') + ')' : ''}: "${body.slice(0, 160)}${body.length > 160 ? '…' : ''}" Answer from the portal: ${SITE}/portal#/messages/${encodeURIComponent(pid)}${conv.key ? '/' + conv.key : ''}`;
      if (s.slackId && !ev.dry && await NOTIFY.slackDm(db, s.slackId, line)) out.dms++;
      /* and the coach's phone, when it has notifications on (Nov 13): who wrote, the first words, a tap opens the chat */
      if (!ev.dry) { try { const r = await PUSH.send(db, [s.email], { title: `${short}'s family`, body: body.slice(0, 140), url: `/portal#/messages/${encodeURIComponent(pid)}${conv.key ? '/' + conv.key : ''}`, tag: 'chat-' + pid }); out.pushes = (out.pushes || 0) + r.sent; } catch (e) { /* a nicety */ } }
    }
  }
  return out;
}

module.exports = { text, thread, inbox, markRead, onReply, numbersOf, signature, own, convKey, titleOf, scopeLines, ownLine, MAX_BODY, _seats: (m) => { SEATS.byEmail = new Map(Object.entries(m || {})); SEATS.at = Date.now(); }, _usePace: (fn) => { pace = fn || sleep; } };
