/* Ask ProWorld: the assistant in the client account (Nov 21, 2026 — "can we add the AI to the client's portal… answer all the
   questions and book stuff as well"; mockup approved the same day: the line under the names, questions and booking together).

     POST /api/family/ask { player, message, history: [{ role, text }], context: { … what the page shows for that player … } }
       → { reply, card }

   What it is: one question to Claude with the academy's facts (programs, camps and prices from the catalog, the policies, the
   contact) and what the page already shows for the ONE player selected. Claude answers in plain words and may name ONE thing to do.
   The engine turns that into a card with real data (a coach's open times, a day, a camp). Nothing is booked, marked or sent here:
   the card's Confirm button calls the routes the page already uses (private/book, days, request), with their own checks.

   What it never does: act without the parent's tap; speak of another family or of a brother or sister (only the selected player's
   lines are in the prompt); quote a private lesson's rate, decide a refund or an exception (those go to Admin as a request); name a
   staff member for an admin matter.

   Kept for the weekly review: assistantLog/<id> { at, day, q, a, action, took }, with names, e-mails and numbers taken out, engine
   only. One family asks at most DAILY questions a day (assistantUse/<hash>_<day>). Same key as the idea engine (settings/ai). */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');
const CAL = require('./calendar');
const CAT = require('./catalog');
const CC = require('./coachcal');
const IDEAS = require('./ideas');
const BRAIN = require('./brain');

const MODEL = 'claude-sonnet-5-5';
const API = 'https://api.anthropic.com/v1/messages';
const DAILY = 40;
/* What it remembers (Nov 21, 2026 — "can the AI keep memory… so it remembers what parents asked"): the last KEEP questions a parent
   asked about ONE player, for KEEP_DAYS days, with what it answered and what it offered to do. assistantMemory/<hash of the e-mail
   and the player> { items: [{ at, day, q, a, action }] }, engine only. It is that family's own conversation, so the names stay in;
   it is never read for another player or another family, and what is older than KEEP_DAYS is dropped the next time they ask.
   POST /api/family/ask/forget clears it. */
const KEEP_DAYS = 90, KEEP = 24;
const memRef = (db, email, pid) => db.doc('assistantMemory/' + crypto.createHash('sha256').update('pw:' + String(email).toLowerCase() + '|' + String(pid)).digest('hex').slice(0, 40));
async function recall(db, email, pid, now) { try { const s = await memRef(db, email, pid).get(); const items = s.exists ? ((s.data() || {}).items || []) : []; return items.filter((m) => m && now - Number(m.at) < KEEP_DAYS * 864e5).slice(-KEEP); } catch (e) { return []; } }
async function forget(db, who, players) { for (const p of players || []) { try { await memRef(db, who.email, p.id).delete(); } catch (e) { /* nothing kept */ } } return { ok: true }; }
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const money = (n) => '$' + Number(n).toLocaleString('en-US');
let poster = null;                       // tests put a stand-in for Claude here
let CLOCK = () => Date.now();
function _useModel(fn) { poster = fn; }

async function ready(db) { try { return /^sk-ant-/.test(String((await IDEAS.settings(db)).anthropicKey || '')); } catch (e) { return false; } }

/* the academy's facts come from the one brain every assistant reads (lib/brain.js) */
const facts = (today) => BRAIN.catalog(today);

function scrub(text, names) {
  let t = clip(text, 600).replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[e-mail]').replace(/\(?\+?\d[\d\s().-]{7,}\d/g, '[number]');
  for (const n of names || []) { const w = String(n || '').trim(); if (w.length < 3) continue; t = t.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '[name]'); }
  return t;
}

function prompt(today, now, p, ctx, coachNames, brain, before) {
  const dow = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const c = ctx || {}; const first = clip(c.name, 30) || clip(String(p.name || '').split(' ')[0], 30) || 'the player';
  const lines = [
    `Name: ${first}. Program: ${clip(c.program, 60) || 'none on file'}.`,
    c.times ? `Training hours by day: ${clip(c.times, 240)}.` : '',
    c.coming ? `The next days on the schedule: ${clip(c.coming, 700)}.` : '',
    c.privates ? `Privates booked: ${clip(c.privates, 300)}.` : 'No private is booked.',
    `Make-up sessions to use: ${Number(c.makeups) || 0}${Number(c.makeups) ? ' (they expire ' + clip(c.makeupsUntil, 12) + ')' : ''}.`,
    c.coaches ? `Coaches: ${clip(c.coaches, 120)}.` : '',
    c.charges ? `What the family paid lately (date, item, player, amount; from the Billing screen): ${clip(c.charges, 900)}. Explain a charge from this list plainly; for a refund, a dispute or anything not on the list, send it to Admin.` : ''
  ].filter(Boolean);
  return [
    'You are "Ask ProWorld", the assistant inside the ProWorld Academy client app (a tennis, soccer and fitness academy in Delray Beach, Florida). A parent or an adult player writes to you. Be short, warm and plain: one to three sentences, no lists unless asked, no emoji, no em dashes. Answer in the language the person writes in.',
    `TODAY: ${dow}, ${today}, ${CC.fmtT(now.h)} in Florida.`,
    'THE PLAYER THIS CONVERSATION IS ABOUT (the only one you may speak of; never mention any other child or family):\n' + lines.join('\n'),
    (before || []).length ? `WHAT THIS PARENT ASKED ABOUT THIS PLAYER BEFORE (the last ${KEEP_DAYS} days, oldest first; use it so they do not have to repeat themselves, and do not bring it up unless it helps):\n` + before.map((m) => `· ${m.day}: asked "${clip(m.q, 160)}"${m.action ? ' → ' + m.action : ''}${m.a ? '; you said "' + clip(m.a, 160) + '"' : ''}`).join('\n') : '',
    brain || BRAIN.text({}, today),
    `PRIVATE LESSON COACHES: tennis ${coachNames.tennis.join(', ') || 'none'}; fitness ${coachNames.fitness.join(', ') || 'none'}; mental ${coachNames.mental.join(', ') || 'none'}.`,
    'RULES: You never book, cancel, mark or send anything yourself. When the person wants something done, name ONE action and the app shows a card they confirm; say in the reply what the card is for, never that it is already done. Refunds, discounts, exceptions, invoices, billing disputes and anything you are not sure of go to Admin (the action "admin"); say "Admin", never a person\'s name. If you do not know, say so, offer Admin, and set "unknown" to true. Never invent a time, a price or a rule that is not above.',
    'ACTIONS (at most one; null when the answer is only words):\n' +
      '{"type":"private","kind":"tennis|fitness|mental","date":"YYYY-MM-DD","coach":"<first name, or empty for the player\'s own coach>","part":"morning|afternoon|evening|any"} — book a private; pick the date they asked for (resolve "Thursday", "tomorrow" from TODAY; never a past day)\n' +
      '{"type":"away","date":"YYYY-MM-DD"} — the player is not coming to a training day\n' +
      '{"type":"makeup","date":"YYYY-MM-DD"} — add a make-up day\n' +
      '{"type":"court","date":"YYYY-MM-DD"} — reserve a court\n' +
      '{"type":"camp","id":"<camp id from the list>"} — sign up for a camp\n' +
      '{"type":"program"} — enroll in or add a program\n' +
      '{"type":"admin","subject":"<5 words>","text":"<the request, written for Admin in the parent\'s voice, 1–2 sentences>"} — pass something to Admin\n' +
      '{"type":"open","where":"schedule|billing|messages|reports|account"} — open a part of the app',
    'Answer with ONE JSON object only: {"reply":"<your words>","action":null or one action,"unknown":true only when you could not answer from what is above}.'
  ].filter(Boolean).join('\n\n');
}

function parse(raw) {
  const text = String(raw || ''); const i = text.indexOf('{'); if (i < 0) return { reply: clip(text, 700), action: null };
  let d = 0, q = false, esc = false, end = text.length;
  for (let k = i; k < text.length; k++) { const ch = text[k]; if (q) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') q = false; continue; } if (ch === '"') q = true; else if (ch === '{') d++; else if (ch === '}') { d--; if (!d) { end = k + 1; break; } } }
  try { const o = JSON.parse(text.slice(i, end)); return Object.assign({ reply: clip(o.reply, 900), action: o.action && typeof o.action === 'object' ? o.action : null }, o.unknown === true ? { unknown: true } : {}); } catch (e) { return { reply: clip(text.replace(/^\s*\{\s*"reply"\s*:\s*"/, '').replace(/"\s*,\s*"action"[\s\S]*$/, ''), 700), action: null }; }
}

/* the action Claude named → a card with real data, or nothing when it does not hold up */
async function cardOf(db, who, players, p, a, today) {
  if (!a || typeof a.type !== 'string') return null;
  const date = isDate(a.date) && a.date >= today && a.date <= CAL.addDays(today, 370) ? a.date : '';
  if (a.type === 'private') {
    const kind = CC.KINDS[a.kind] ? a.kind : 'tennis'; const day = date || CAL.addDays(today, 1);
    const first = await CC.familySlots(db, who, { player: p.id, kind, date: day, dur: 60 }, players); const cs = first.coaches || []; if (!cs.length) return { type: 'none', text: 'No coach gives that lesson yet. Admin can help.' };
    const asked = CC.fold(CC.first(a.coach || '')); const c = cs.find((x) => x.key === asked) || cs.find((x) => x.mine) || cs[0];
    const o = await CC.familySlots(db, who, { player: p.id, kind, coach: c.key, date: day, dur: 60 }, players);
    const part = String(a.part || 'any'); const inPart = (h) => (part === 'morning' ? h < 12 : part === 'afternoon' ? h >= 12 && h < 17 : part === 'evening' ? h >= 17 : true);
    let slots = (o.slots || []).filter((s) => inPart(s.start)); if (!slots.length) slots = o.slots || [];
    return { type: 'private', player: p.id, kind, coach: c.key, coachName: c.name, date: day, slots: slots.slice(0, 8), next: (o.next || []).slice(0, 4) };
  }
  if (a.type === 'away' || a.type === 'makeup' || a.type === 'court') return date ? { type: a.type, player: p.id, date } : null;
  if (a.type === 'camp') { const g = CAT.campsComing(today).find((x) => x.ids.includes(String(a.id || ''))) || CAT.campsComing(today)[0]; return g ? { type: 'camp', id: g.ids.includes(String(a.id || '')) ? String(a.id) : g.ids[0], title: g.title, dates: g.dates } : null; }
  if (a.type === 'program') return { type: 'program' };
  if (a.type === 'admin') { const text = clip(a.text, 500); return text ? { type: 'admin', player: p.id, kind: /invoice/i.test(String(a.subject || '') + ' ' + text) ? 'invoice' : 'admin', subject: clip(a.subject, 60) || 'A question for Admin', text } : null; }
  if (a.type === 'open') { const where = ['schedule', 'billing', 'messages', 'reports', 'account'].includes(a.where) ? a.where : ''; return where ? { type: 'open', where } : null; }
  return null;
}

async function ask(db, who, body, players) {
  body = body || {}; const p = (players || []).find((x) => x.id === S.clean(body.player, 80)); if (!p) throw S.err(404, 'player', 'Which player?');
  const message = clip(body.message, 600); if (!message) throw S.err(400, 'message', 'Type your question.');
  const st = await IDEAS.settings(db); const key = String(st.anthropicKey || '');
  if (!poster && !/^sk-ant-/.test(key)) throw S.err(409, 'nokey', 'The assistant is not switched on yet.');
  const now = CC.nowET(); const today = now.date;   // one clock for both (the tests set it), so a dated action is judged against the same day
  const useRef = db.doc('assistantUse/' + crypto.createHash('sha256').update('pw:' + String(who.email).toLowerCase()).digest('hex').slice(0, 32) + '_' + today);
  const use = await useRef.get(); const n = use.exists ? Number((use.data() || {}).n) || 0 : 0;
  if (n >= DAILY) throw S.err(429, 'many', 'That is a lot of questions for one day. For anything else, write to Admin in Messages.');
  await useRef.set({ n: n + 1, at: Date.now() });
  const names = { tennis: [], fitness: [], mental: [] };
  await Promise.all(Object.keys(names).map(async (k) => { try { names[k] = (await CC.coaches(db, k)).map((c) => c.name); } catch (e) { names[k] = []; } }));
  const nowMs = CLOCK(); const before = await recall(db, who.email, p.id, nowMs); const brain = await BRAIN.get(db);
  const sys = prompt(today, now, p, body.context || {}, names, BRAIN.text(brain, today), before);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((h) => ({ role: h && h.role === 'assistant' ? 'assistant' : 'user', content: clip(h && h.text, 700) })).filter((h) => h.content);
  while (history.length && history[0].role !== 'user') history.shift();
  const msgs = history.concat([{ role: 'user', content: message + '\n\n(Answer with the JSON object only.)' }]);
  const t0 = Date.now(); let raw = '';
  if (poster) raw = await poster({ system: sys, messages: msgs });
  else {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 700, system: sys, messages: msgs }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw S.err(502, 'claude', 'The assistant could not answer just now. Try again, or write to Admin in Messages.');
    raw = (j.content || []).map((c) => c.text || '').join('');
  }
  const out = parse(raw); let card = null;
  try { card = await cardOf(db, who, players, p, out.action, today); } catch (e) { card = null; }
  let reply = out.reply || (card ? 'Here it is.' : 'I did not get that. Could you say it another way?');
  if (card && card.type === 'none') { reply = card.text; card = null; }
  if (card && card.type === 'private' && !card.slots.length) reply = card.next.length ? `Coach ${card.coachName} has no open time that day. A private is booked at least 24 hours ahead. Here are the next open days.` : `Coach ${card.coachName} has no open time in the next weeks. Admin can help find one.`;
  const did = card ? ({ private: 'offered times for a ' + (card.kind || 'tennis') + ' private on ' + card.date, away: 'offered to mark ' + card.date + ' as not coming', makeup: 'offered a make-up day on ' + card.date, court: 'offered a court on ' + card.date, camp: 'showed the camp sign-up', program: 'showed the programs', admin: 'offered to send it to Admin', open: 'opened ' + card.where }[card.type] || '') : '';
  try { await memRef(db, who.email, p.id).set({ items: before.concat([{ at: nowMs, day: today, q: clip(message, 300), a: clip(reply, 300), action: did }]).slice(-KEEP), at: nowMs }); } catch (e) { /* the answer does not wait for the memory */ }
  if (out.unknown || (card && card.type === 'admin')) { try { const hide0 = [who.name, p.name, (body.context || {}).name].join(' ').split(/\s+/).filter(Boolean); await BRAIN.wonder(db, scrub(message, hide0), 'app'); } catch (e) { /* the weekly review still has the log */ } }
  try { const hide = [who.name, p.name, (body.context || {}).name].join(' ').split(/\s+/).filter(Boolean); await db.collection('assistantLog').add({ at: Date.now(), day: today, q: scrub(message, hide), a: scrub(reply, hide), action: card ? card.type : '', took: Date.now() - t0, src: 'app' }); } catch (e) { /* the answer does not wait for the log */ }
  return { reply, card };
}

module.exports = { ask, ready, facts, parse, scrub, cardOf, prompt, recall, forget, DAILY, KEEP_DAYS, KEEP, MODEL, _useModel, _clock: (f) => { CLOCK = f || (() => Date.now()); } };
