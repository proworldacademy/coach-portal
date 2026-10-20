/* The roster feed — the one place outside the site that may read who is enrolled: GET /api/roster?key=…
   Built for the concierge (so it recognises a family that texts, without Monday) and the morning digest. Read-only, one
   key, set by an owner from the backend's Notifications panel (settings/notify.rosterKey). The answer is cached a minute.
   Each player comes once, with the parent's name, phone and email from players/<id>/private/contact, and — for the
   concierge — the same rows shaped like a Monday board (name, group, columns) so its roster code reads them as before. */
'use strict';
const crypto = require('crypto');
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');
const NOTIFY = require('./notify');
const ROSTER = require('./roster');

const MIN_KEY = 24;
const TTL_MS = 60 * 1000;
let cache = { at: 0, body: null };

function forget() { cache = { at: 0, body: null }; }
function newKey() { return crypto.randomBytes(24).toString('base64url'); }
function sameKey(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length >= MIN_KEY && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* The key the caller sent, from the query string or the X-Roster-Key header. */
function keyOf(req) {
  const h = req.headers ? req.headers['x-roster-key'] : '';
  const q = req.query ? req.query.key : '';
  return String(h || q || '').trim();
}

async function requireKey(db, req) {
  const s = await NOTIFY.settings(db, true);
  if (!s.rosterKey || String(s.rosterKey).length < MIN_KEY) throw S.err(503, 'feed_off', 'The roster feed is not switched on — an owner sets its key on the backend (Players & billing → Notifications).');
  if (!sameKey(keyOf(req), s.rosterKey)) throw S.err(401, 'key', 'That roster key is not right.');
}

/* Monday-style status words the concierge already understands: "Active" (training now), "New Players" (signed up, not
   started), "Away", "Finished". */
function statusWord(p, today) {
  if (p.status === 'finished') return 'Finished';
  if (p.status === 'away') return 'Away';
  const start = p.enroll && p.enroll.start;
  if (p.status === 'active' && start && start > today) return 'New Players';
  return p.status === 'active' ? 'Active' : (p.status || 'Active');
}

function programOf(p) {
  const en = p.enroll || {};
  const prog = en.program ? CAT.program(en.program) : null;
  return { program: en.program || '', programName: en.programName || (prog ? prog.name : ''), plan: en.planLabel || en.plan || '', days: Array.isArray(en.days) ? en.days : [], start: en.start || '', monthly: en.monthly || null, hold: !!en.hold, endsOn: en.endsOn || null, next: en.next || null, status: en.status || '' };
}

/* Everyone on the roster (players only — try-outs are not families yet), parents attached. */
async function roster(db, opts) {
  opts = opts || {};
  if (!opts.fresh && cache.body && Date.now() - cache.at < TTL_MS) return cache.body;
  const today = CAL.todayET();
  const snap = await db.collection('players').get();
  const players = [];
  for (const d of snap.docs) {
    const x = d.data() || {};
    if (!x.name) continue;
    let c = {};
    try { const cs = await db.doc('players/' + d.id + '/private/contact').get(); c = cs.exists ? (cs.data() || {}) : {}; } catch (e) { c = {}; }
    const { first, last } = ROSTER.splitName(x.name);
    players.push({
      id: d.id, name: x.name, first, last, shortName: ROSTER.shortName(x.name),
      status: x.status || 'active', statusWord: statusWord(x, today),
      group: x.group || '', groupLabel: ROSTER.GROUP_LABEL[x.group] || '', coach: x.coach || '', coach2: x.coach2 || '',
      sport: x.sport || (x.group ? 'tennis' : ''), source: x.source || '', since: x.createdAt || null,
      enroll: programOf(x),
      parent: { name: c.guardian || '', phone: c.phone || '', email: c.email || '' }
    });
  }
  players.sort((a, b) => a.name.localeCompare(b.name));
  // the concierge's shape: one row per player, the parent's details as named columns
  const rows = players.map((p) => ({ id: p.id, name: p.name, group: p.statusWord, columns: { 'Parent': p.parent.name, 'Phone': p.parent.phone, 'Email': p.parent.email, 'Program': p.enroll.programName || p.groupLabel, 'Coach': p.coach } }));
  const counts = { players: players.length, active: players.filter((p) => p.statusWord === 'Active').length, upcoming: players.filter((p) => p.statusWord === 'New Players').length, away: players.filter((p) => p.statusWord === 'Away').length, finished: players.filter((p) => p.statusWord === 'Finished').length, withPhone: players.filter((p) => p.parent.phone).length, withEmail: players.filter((p) => p.parent.email).length };
  const body = { at: new Date().toISOString(), today, source: 'proworld-backend', counts, players, rows };
  cache = { at: Date.now(), body };
  return body;
}

module.exports = { roster, requireKey, newKey, sameKey, keyOf, forget, MIN_KEY };
