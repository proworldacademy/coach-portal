/* The plan assistant (Antonio, Nov 9, 2026): "I would like Manu to be able to have this conversation with you in the app… no fixes to
   functionality or design, just the content." The Marketing page sends the month's plan and a message; Claude answers in plain words
   and returns the content changes as operations the page applies (move a post to a day, swap, remove, edit, add). It knows the
   season (the calendar), the facts, and the timing rules Antonio set: event posts on the day of the event, last-spots ads in the
   three days before a camp, school-break posts before the break, never content about parents' DMs. Same key as the idea engine. */
'use strict';
const S = require('./stripe');
const IDEAS = require('./ideas');

const MODEL = 'claude-sonnet-5-5';
const API = 'https://api.anthropic.com/v1/messages';
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

async function stateDoc(db, name) {
  try { const s = await db.doc('apps/marketing/state/' + name).get(); if (!s.exists) return null; const x = s.data() || {}; return x.json ? JSON.parse(x.json).v : x; } catch (e) { return null; }
}

/* assist(db, who, { month, weeks:[{ws, dates, locked, items:[{id, day, date, who, kind, format, title, hook, desc, posted}]}], message, history:[{role, text}] })
   → { reply, ops:[{op:'move', id, day, ws?} | {op:'remove', id} | {op:'edit', id, title?, hook?, desc?, format?, who?} | {op:'add', ws, day, who, format, title, hook, desc}] } */
async function assist(db, who, b) {
  const st = await IDEAS.settings(db);
  const key = String(st.anthropicKey || '');
  if (!/^sk-ant-/.test(key)) throw S.err(409, 'nokey', 'The assistant has no key yet. An owner pastes the Anthropic API key on the backend (Messages → Settings → Idea engine).');
  const message = clip(b.message, 1500); if (!message) throw S.err(400, 'message', 'Say what you want changed.');
  const weeks = Array.isArray(b.weeks) ? b.weeks.slice(0, 6) : [];
  const history = Array.isArray(b.history) ? b.history.slice(-8) : [];
  const [strategy, calendar, priorities] = await Promise.all([stateDoc(db, 'strategy'), stateDoc(db, 'calendar'), stateDoc(db, 'priorities')]);
  const today = new Date().toISOString().slice(0, 10);
  const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const events = (calendar && Array.isArray(calendar.events) ? calendar.events : []).filter((e) => e && e.start && e.end >= plus(-14) && e.start <= plus(84)).sort((a, c) => String(a.start).localeCompare(String(c.start)));
  const season = events.map((e) => '· ' + clip(e.name, 90) + ': ' + e.start + (e.end && e.end !== e.start ? ' → ' + e.end : '') + (e.kind ? ' (' + e.kind + ')' : ''));
  const plan = weeks.map((w) => 'WEEK ' + w.ws + ' (' + clip(w.dates, 40) + (w.locked ? ', set' : ', draft') + '):\n' + (w.items || []).slice(0, 40).map((i) => '  - id=' + i.id + ' · ' + i.day + ' ' + (i.date || '') + ' · ' + clip(i.who, 20) + ' · ' + clip(i.format, 14) + ' · "' + clip(i.title, 90) + '"' + (i.hook ? ' · hook: ' + clip(i.hook, 80) : '') + (i.desc ? ' · ' + clip(i.desc, 140) : '') + (i.posted ? ' · POSTED' : '')).join('\n')).join('\n');

  const sys = [
    'You are the content assistant inside PROWORLD Academy\'s marketing plan (a tennis + soccer + fitness academy on one campus in Delray Beach, Florida: 16 courts — 12 hard, 3 Har-Tru clay, a stadium court — two turf fields, a lakeside clubhouse with a gym, player lounge and physio room). The marketing manager talks to you; you change the CONTENT of the plan — which post goes on which day, what it says, who films it, what to add or remove. You never change how the app works or looks.',
    'TODAY: ' + today + '. Days run Mon…Sun; "Spare" is a post in hand with no day. A week is keyed by its Sunday (ws); a post\'s date is shown next to its day.',
    'TIMING RULES (Antonio): a post about an event (a tournament, a match day, a result, a visit) goes on the day it happens or the day after — never two weeks later; the coach sends the clip that day. A "last spots" ad or reminder for a camp runs in the 3 days before the camp starts (and may be boosted those 3 days), not during the camp. A "school is out / camp is on" post goes the day school closes or the day before, never after the break. Nothing about replying to parents\' DMs or private messages on screen; talk about the plan we build for each player instead. The campus is our biggest difference: facility content is always welcome (drone of the campus, the courts while players train, the clubhouse, the gym, a coach walking the grounds with the facts: 16 courts, 12 hard, 3 clay, a stadium court, two turf fields).',
    'VOICE for anything you write: bold, direct, plain English; say what we do, no comparisons with other academies; never the phrase "Where Champions Are Made"; "personalized", never "boutique"; academics are not offered.',
    strategy && strategy.facts ? 'FACTS: ' + clip(JSON.stringify(strategy.facts), 1500) : '',
    priorities ? 'STANDING PRIORITIES: ' + clip(JSON.stringify(priorities), 800) : '',
    season.length ? 'THE SEASON:\n' + season.join('\n') : '',
    'THE PLAN ON SCREEN:\n' + plan,
    'Answer with ONE JSON object only: {"reply": "<2–6 short lines in plain words: what you changed and why, or what you suggest / need to know>", "ops": [ ... ]}. Operations, applied in order: {"op":"move","id":"<id>","day":"Mon|…|Sun|Spare","ws":"<Sunday YYYY-MM-DD, only when it changes week>"} (if another post has that day, the two swap days); {"op":"remove","id":"<id>"}; {"op":"edit","id":"<id>","title"?,"hook"?,"desc"?,"format"?,"who"?}; {"op":"add","ws":"<Sunday>","day":"…","who":"<coach name or Production>","format":"Talking Head|Reel|Carousel|Static Post|Ad Video|Story","title":"…","hook":"…","desc":"⏱ <length> · what is filmed or designed"}. Only ids from the plan. A POSTED item is never moved or removed. When the request is unclear or would need a decision (which coach, which day), ask in the reply and return no ops. Keep ops minimal and exact.'
  ].filter(Boolean).join('\n\n');
  const msgs = history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: clip(h.text, 1200) })).concat([{ role: 'user', content: message }]);

  const t0 = Date.now();
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 3000, temperature: 0.3, system: sys, messages: msgs }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw S.err(502, 'claude', 'The assistant could not answer (' + (j && j.error && j.error.message ? clip(j.error.message, 160) : r.status) + ').');
  const text = (j.content || []).map((c) => c.text || '').join('');
  let out = null;
  try { const m = text.match(/\{[\s\S]*\}/); out = JSON.parse(m ? m[0] : text); } catch (e) { out = { reply: clip(text, 1200), ops: [] }; }
  const OPS = ['move', 'remove', 'edit', 'add'];
  const ops = (Array.isArray(out.ops) ? out.ops : []).filter((o) => o && OPS.includes(o.op)).slice(0, 30);
  return { reply: clip(out.reply || '', 1500), ops, model: MODEL, took: Date.now() - t0 };
}

module.exports = { assist };
