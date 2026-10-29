/* The idea engine, live (Antonio, Oct 28, 2026): "if I press Swap I want new ideas; an AI generator should be giving me new
   ideas all the time", and a prompt on the page to steer it ("more about the campus for Nico"). The page asks here; this calls
   Claude with the record as context — the strategy, the priorities, the pillars, the recipe, the coaches, the archive of real posts
   and the banks — and returns fresh ideas in the bank's own shape, none of which repeats what went out or what is already in the
   bank. The key lives on settings/ai.anthropicKey (owners paste it on the backend, like the Slack bot token); the page never sees it. */
'use strict';
const S = require('./stripe');

const MODEL = 'claude-sonnet-5-5';
const API = 'https://api.anthropic.com/v1/messages';
let cache = { at: 0, data: null };

async function settings(db, fresh) {
  if (!fresh && cache.data && Date.now() - cache.at < 60 * 1000) return cache.data;
  let data = {};
  try { const s = await db.doc('settings/ai').get(); data = s.exists ? (s.data() || {}) : {}; } catch (e) { data = {}; }
  cache = { at: Date.now(), data };
  return data;
}
const forget = () => { cache = { at: 0, data: null }; };

// the marketing record is stored as {json: "{at, v}"} per document (the page's own format)
async function stateDoc(db, name) {
  try { const s = await db.doc('apps/marketing/state/' + name).get(); if (!s.exists) return null; const x = s.data() || {}; return x.json ? JSON.parse(x.json).v : x; } catch (e) { return null; }
}
async function shards(db, col) {
  const out = [];
  try { const s = await db.collection('apps/marketing/' + col).get(); s.docs.forEach((d) => { const x = d.data() || {}; try { const v = x.json ? JSON.parse(x.json).v : x.v; if (Array.isArray(v)) out.push(...v); else if (v && typeof v === 'object') out.push(...Object.values(v)); } catch (e) { /* skip */ } }); } catch (e) { /* skip */ }
  return out;
}

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const words = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4).map((w) => w.replace(/(ies|es|s)$/, '')));
function overlaps(a, b, need) { const A = words(a), B = words(b); let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return n >= need && n / Math.min(A.size || 1, B.size || 1) >= 0.4; }

/* ideas(db, who, {coach, direction, n, format}) → { ideas: [{id, title, format, day, pillar, desc, hook, coach}], model, took } */
async function ideas(db, who, b) {
  const st = await settings(db);
  const key = String(st.anthropicKey || '');
  if (!/^sk-ant-/.test(key)) throw S.err(409, 'nokey', 'The idea engine has no key yet. An owner pastes the Anthropic API key on the backend (Messages → Settings → Idea engine).');
  const coach = clip(b.coach, 40);
  const direction = clip(b.direction, 600);
  const n = Math.max(1, Math.min(8, Number(b.n) || 5));
  const format = clip(b.format, 30);

  const [strategy, priorities, pillars, recipe, team] = await Promise.all([stateDoc(db, 'strategy'), stateDoc(db, 'priorities'), stateDoc(db, 'pillars'), stateDoc(db, 'recipe'), stateDoc(db, 'team')]);
  const archive = (await shards(db, 'archive')).filter((p) => p && p.date).sort((a, c) => String(c.date).localeCompare(String(a.date))).slice(0, 60);
  const banks = await shards(db, 'ideaBank');
  const bankTitles = banks.map((i) => i && i.title).filter(Boolean);
  const prod = await stateDoc(db, 'prodBank');
  const prodTitles = Array.isArray(prod) ? prod.map((i) => i && i.title).filter(Boolean) : [];
  const avoid = archive.map((p) => '· ' + clip(p.title, 90) + (p.coach && p.coach !== '—' ? ' (' + p.coach + ')' : '')).concat(bankTitles.slice(0, 120).map((t) => '· ' + clip(t, 90)), prodTitles.slice(0, 60).map((t) => '· ' + clip(t, 90)));

  const sys = [
    'You write Instagram content ideas for PROWORLD, a high-performance tennis, soccer, fitness and mental-performance academy on one campus in Delray Beach, Florida: 16 courts (12 hard, 3 Har-Tru clay, a stadium court), two turf fields, a lakeside clubhouse with a gym, player lounge and physio room. Programs: Full Time, Afterschool, 10 & Under, soccer clinics, camps (Thanksgiving Nov 23–27, Winter Dec 21–Jan 1).',
    'Voice: bold, direct, champion-minded; short confident lines; plain English; say what we do, no comparisons with named academies; never the phrase "Where Champions Are Made"; "personalized", never "boutique"; academics are not offered yet.',
    strategy ? 'STRATEGY: ' + clip(JSON.stringify(strategy), 1800) : '',
    priorities ? 'STANDING PRIORITIES: ' + clip(JSON.stringify(priorities), 1200) : '',
    pillars ? 'PILLARS: ' + clip(JSON.stringify(pillars), 900) : '',
    recipe ? 'RECIPE (per 2 weeks): ' + clip(JSON.stringify(recipe), 400) : '',
    team ? 'TEAM: ' + clip(JSON.stringify(team), 300) : '',
    'WHAT WORKS NOW: parent-facing carousels that answer one honest question ("Red, Orange or Green ball? Here is the honest difference") get 5–10x the views and most of the saves; coach talking-head reels sit at 1–1.6K views and work best when the coach tells one concrete thing from the court. The campus is our biggest difference: show it.',
    'ALREADY DONE OR ALREADY IN THE BANK — never repeat these topics, angles or hooks, not even reworded:',
    avoid.join('\n'),
    'Return ONLY a JSON array, no prose, of exactly N objects: {"title": string (a working title, ≤ 70 chars), "format": one of "Talking Head" | "Reel" | "Carousel" | "Static Post" | "Ad Video" | "Story", "pillar": short, "desc": 1–3 sentences on what is filmed or designed and the key beats (⏱ length for video), "hook": the first line said or shown, in quotes}. Every idea must be new ground, concrete, and shootable this week on campus.'
  ].filter(Boolean).join('\n\n');
  const user = [
    coach ? 'Coach: ' + coach + '. Write every idea in this coach\'s own voice and area (' + (coach === 'Tara' ? 'fitness and nutrition' : coach === 'Tonio' ? 'mental performance' : coach === 'Kam' || coach === 'Kamryn' ? '10 & Under' : coach === 'Flo' || coach === 'Florian' ? 'tour team and tournaments' : 'tennis coaching') + ').' : 'No specific coach: production pieces (carousels, statics, reels shot by the photographer).',
    format ? 'Format: ' + format + ' only.' : '',
    direction ? 'DIRECTION FROM THE TEAM (follow it first): ' + direction : 'Direction: whatever this coach has not covered yet, varied across the pillars.',
    'N = ' + n + '.'
  ].filter(Boolean).join('\n');

  const t0 = Date.now();
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 2500, temperature: 1, system: sys, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw S.err(502, 'claude', 'The idea engine could not answer (' + (j && j.error && j.error.message ? clip(j.error.message, 160) : r.status) + ').');
  const text = (j.content || []).map((c) => c.text || '').join('');
  let list = [];
  try { const m = text.match(/\[[\s\S]*\]/); list = JSON.parse(m ? m[0] : text); } catch (e) { throw S.err(502, 'parse', 'The idea engine answered in a shape the page cannot read. Try again.'); }
  if (!Array.isArray(list)) list = [];
  const FORMATS = ['Talking Head', 'Reel', 'Carousel', 'Static Post', 'Ad Video', 'Story'];
  const seen = archive.map((p) => (p.title || '') + ' ' + (p.desc || '')).concat(bankTitles, prodTitles);
  const out = [];
  for (const i of list) {
    if (!i || !i.title) continue;
    const title = clip(i.title, 90), desc = clip(i.desc, 600), hook = clip(i.hook, 200);
    if (seen.some((s) => overlaps(title + ' ' + desc, s, 4))) continue;   // the model slipped: same ground as something we have
    out.push({ id: 'ai_' + Date.now().toString(36) + '_' + out.length, title, format: FORMATS.includes(i.format) ? i.format : (coach ? 'Talking Head' : 'Carousel'), pillar: clip(i.pillar, 40), desc, hook, coach: coach || 'Production', by: 'engine-live', askedBy: who.email, direction, at: new Date().toISOString() });
    if (out.length >= n) break;
  }
  return { ideas: out, model: MODEL, took: Date.now() - t0, dropped: list.length - out.length };
}

module.exports = { ideas, settings, forget };
