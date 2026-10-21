/* The parents' details, pulled from Monday into the backend — once, and again whenever Monday changes.
   Monday's ACCOUNTING board carries every family the academy has had: one row per player, with the guardian's name, phone
   and e-mail, in a group that says where they stand (Active, New Players, Away, Finished, Older clients, Opt out).
   This module reads that board with the academy's Monday API token (settings/notify.mondayToken, pasted by an owner on the
   Notifications panel, never in a repo) and:
     · writes players/<id>/private/contact for every player already on the roster (matched by name) — unless the parent
       typed their own details at an online enrollment, which always win;
     · creates the players the roster does not have yet, with the status their Monday group says (away / finished, or
       active for the Active and New Players groups), so the concierge, the roster feed and the family portal know every
       family; a created player carries `accounting {id, group}` so a second run updates instead of duplicating.
   Never changes an existing player's status, group or coach (the Monday sync and the staff own those); never deletes.
   Owners only, from the backend page: preview first (counts and the names to check), then import. */
'use strict';
const ROSTER = require('./roster');
const NOTIFY = require('./notify');
const S = require('./stripe');

const API = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';
const DEFAULT_BOARD = '2140058342';           // ACCOUNTING
const PAGE = 500;
const BATCH = 400;

const fetcher = () => (typeof fetch === 'function' ? fetch : null);
let override = null;                          // the tests swap the network out
function _useFetch(fn) { override = fn; }
function net() { return override || fetcher(); }

/* ── Monday ── */
async function gql(token, query, variables) {
  const f = net(); if (!f) throw S.err(500, 'fetch', 'No network in this runtime.');
  const r = await f(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': API_VERSION }, body: JSON.stringify({ query, variables: variables || {} }) });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok || !j || j.errors || j.error_message) {
    const msg = (j && (j.error_message || (j.errors && j.errors[0] && j.errors[0].message))) || ('Monday answered ' + r.status);
    throw S.err(r.status === 401 || r.status === 403 || /not authenticated|invalid token/i.test(msg) ? 401 : 502, 'monday', 'Monday: ' + msg);
  }
  return j.data;
}

const ITEM_FIELDS = 'id name group { id title } column_values (ids: $cols) { id text value type }';
/* The board's columns first (cheap), then the rows with only the columns this module reads — a board with twenty columns
   and a thousand rows would otherwise blow Monday's complexity budget. */
async function fetchBoard(token, boardId) {
  const head = await gql(token, 'query ($ids: [ID!]) { boards (ids: $ids) { id name columns { id title type } } }', { ids: [String(boardId)] });
  const board = head && head.boards && head.boards[0];
  if (!board) throw S.err(404, 'board', 'Monday board ' + boardId + ' was not found with this token.');
  const cols = pickColumns(board.columns || []);
  const ids = ['last', 'guardian', 'phone', 'phone2', 'email', 'email2', 'dob', 'playerGroup', 'statusText'].map((k) => cols[k] && cols[k].id).filter(Boolean);
  const first = await gql(token, `query ($ids: [ID!], $limit: Int!, $cols: [String!]) { boards (ids: $ids) { items_page (limit: $limit) { cursor items { ${ITEM_FIELDS} } } } }`, { ids: [String(boardId)], limit: PAGE, cols: ids });
  const page0 = first && first.boards && first.boards[0] && first.boards[0].items_page;
  const items = (page0 && page0.items) || [];
  let cursor = page0 && page0.cursor;
  let guard = 0;
  while (cursor && guard++ < 60) {
    const more = await gql(token, `query ($cursor: String!, $limit: Int!, $cols: [String!]) { next_items_page (cursor: $cursor, limit: $limit) { cursor items { ${ITEM_FIELDS} } } }`, { cursor, limit: PAGE, cols: ids });
    const page = more && more.next_items_page;
    if (!page) break;
    items.push(...(page.items || []));
    cursor = page.cursor;
  }
  return { id: String(board.id), name: board.name || '', columns: board.columns || [], items };
}

/* Which column is which — by title first, then by Monday's column type. */
function pickColumns(columns) {
  const cols = columns || [];
  const byTitle = (re) => cols.find((c) => re.test(c.title || ''));
  const byType = (type, not) => cols.find((c) => c.type === type && !not.includes(c.id));
  const last = byTitle(/^last\s*name$|surname|apellido/i) || null;                              // the board keeps the player's first name as the row and the last name in a column
  const guardian = byTitle(/guardian/i) || byTitle(/parent|mother|father|account holder|payer|customer name|client name/i) || null;
  const phone = byTitle(/phone\s*main/i) || byType('phone', []) || byTitle(/phone|mobile|cell|whats/i) || null;
  const phone2 = cols.find((c) => c !== phone && (c.type === 'phone' || /phone|mobile|cell|whats/i.test(c.title || ''))) || null;
  const email = byTitle(/customer\s*e-?mail/i) || byType('email', []) || byTitle(/e-?mail/i) || null;
  const email2 = cols.find((c) => c !== email && (c.type === 'email' || /e-?mail/i.test(c.title || ''))) || null;
  const dob = byTitle(/birth|\bdob\b/i) || null;
  const playerGroup = byTitle(/^player\s*group$/i) || null;                                     // BOYS / GIRLS / U12 / U10 … — a hint for where a new player goes
  const statusText = cols.find((c) => c.type === 'status' && /^status$/i.test(c.title || '')) || null;   // AFTER-SCHOOL / PRO | GIRLS …
  return { last, guardian, phone, phone2, email, email2, dob, playerGroup, statusText };
}

function textOf(cv) {
  if (!cv) return '';
  let v = null; try { v = cv.value ? JSON.parse(cv.value) : null; } catch (e) { v = null; }
  if (cv.type === 'email' && v && v.email) return String(v.email).trim();
  if (cv.type === 'phone' && v && v.phone) return String(v.phone).trim();
  return String(cv.text || '').trim();
}
function phoneOf(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length < 10) return '';
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
}
function emailOf(s) { const e = String(s || '').trim().toLowerCase(); return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e) ? e : ''; }

/* The group a row sits in says what the player is to the academy. */
function standingOf(groupTitle) {
  const g = String(groupTitle || '').trim().toLowerCase();
  if (/^active/.test(g)) return { status: 'active', word: 'active' };
  if (/^new/.test(g)) return { status: 'active', word: 'new' };
  if (/away/.test(g)) return { status: 'away', word: 'away' };
  if (/opt.?out/.test(g)) return { status: 'finished', word: 'finished', optOut: true };
  if (/finish|older|former|past|inactive|left/.test(g)) return { status: 'finished', word: 'finished' };
  return null;                                                              // a group we do not understand: read, never written
}

/* "RAISS" → "Raiss"; anything not shouted is left as typed. */
function properCase(s) {
  const t = String(s || '').trim();
  if (!t || t !== t.toUpperCase() || t.length < 3) return t;
  return t.toLowerCase().replace(/(^|[\s'-])([a-z\u00e0-\u00ff])/g, (m, a, b) => a + b.toUpperCase());
}
function fullNameOf(itemName, lastName) {
  const first = String(itemName || '').replace(/\s+/g, ' ').trim();
  const last = properCase(String(lastName || '').replace(/\s+/g, ' ').trim());
  if (!last) return first;
  if (!first) return last;
  const f = ROSTER.fold(first), l = ROSTER.fold(last);
  if (f === l || f.endsWith(' ' + l) || f.split(' ').length > 1 && f.endsWith(l)) return first;   // the row already carries the whole name
  return first + ' ' + last;
}
/* Where a player the roster does not know yet most likely goes, from the board's own words. Only the clear cases; the rest
   stay unplaced for the front desk. */
function groupHint(playerGroup, statusText) {
  const g = ROSTER.fold(playerGroup), st = ROSTER.fold(statusText);
  if (/after/.test(st)) return 'as';
  if (/\bpro\b|full/.test(st)) return 'ft';
  if (/^u ?(4|5|6|7|8|9|10)\b|\b10 ?u\b|under|tots|red ball|orange/.test(g) || /\bu ?(8|10)\b/.test(st)) return 'u10';
  if (/^u ?12\b/.test(g)) return 'as';
  return '';
}

function rowOf(item, cols) {
  const cv = {}; (item.column_values || []).forEach((c) => { cv[c.id] = c; });
  const get = (col) => (col ? textOf(cv[col.id]) : '');
  const standing = standingOf(item.group && item.group.title);
  const phones = [phoneOf(get(cols.phone)), phoneOf(get(cols.phone2))].filter(Boolean);
  const emails = [emailOf(get(cols.email)), emailOf(get(cols.email2))].filter(Boolean);
  return {
    id: String(item.id), name: fullNameOf(item.name, get(cols.last)), group: (item.group && item.group.title) || '',
    playerGroup: S.clean(get(cols.playerGroup), 40), statusText: S.clean(get(cols.statusText), 40),
    standing,
    guardian: S.clean(get(cols.guardian), 100),
    phone: phones[0] || '', phone2: phones[1] && phones[1] !== phones[0] ? phones[1] : '',
    email: emails[0] || '', email2: emails[1] && emails[1] !== emails[0] ? emails[1] : '',
    dob: /^\d{4}-\d{2}-\d{2}$/.test(get(cols.dob)) ? get(cols.dob) : ''
  };
}

/* ── the roster as it is ── */
async function loadRoster(db) {
  const snap = await db.collection('players').get();
  const players = snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
  const byName = {}; const byShort = {}; const byAccounting = {};
  const add = (map, key, p) => { if (!key) return; (map[key] || (map[key] = [])).push(p); };
  for (const p of players) {
    add(byName, ROSTER.fold(p.name), p);
    const { first, last } = ROSTER.splitName(p.name);
    if (first && last) add(byShort, ROSTER.fold(first) + ' ' + ROSTER.fold(last).charAt(0), p);
    if (p.accounting && p.accounting.id) byAccounting[String(p.accounting.id)] = p;
  }
  return { players, byName, byShort, byAccounting, ids: new Set(players.map((p) => p.id)) };
}

const rank = (p) => (p.status === 'active' ? 0 : p.status === 'away' ? 1 : 2) * 10 + (p.source === 'enroll' ? 0 : 1);
function matchRow(row, roster) {
  if (roster.byAccounting[row.id]) return { player: roster.byAccounting[row.id], how: 'id' };
  const key = ROSTER.fold(row.name); if (!key) return { player: null, how: 'no-name' };
  const same = roster.byName[key] || [];
  if (same.length === 1) return { player: same[0], how: 'name' };
  if (same.length > 1) { const best = same.slice().sort((a, b) => rank(a) - rank(b)); return { player: best[0], how: 'name', note: 'more than one ' + row.name + ' on the roster' }; }
  const { first, last } = ROSTER.splitName(row.name);
  if (first && last) {
    /* A roster record that carries only an initial for the last name ("Mireille D.") is the same player as the board's
       "Mireille Daley". A record with a full, different last name is somebody else, whatever the initial. */
    const near = (roster.byShort[ROSTER.fold(first) + ' ' + ROSTER.fold(last).charAt(0)] || []).filter((p) => ROSTER.fold(ROSTER.splitName(p.name).last).length <= 1);
    if (near.length === 1) return { player: near[0], how: 'short', note: row.name + ' ↔ ' + near[0].name + ' (please check)' };
    if (near.length > 1) return { player: null, how: 'ambiguous', note: row.name + ' could be ' + near.map((p) => p.name).join(' or ') };
  }
  return { player: null, how: 'none' };
}

function newId(row, standing, taken) {
  const { first, last } = ROSTER.splitName(row.name);
  const base = `${standing.status === 'active' ? 'new' : 'past'}-${ROSTER.slug(first)}${last ? '-' + ROSTER.slug(last).charAt(0) : ''}`;
  let id = base; if (taken.has(id)) id = base + '-' + String(row.id).slice(-4);
  let n = 2; while (taken.has(id)) id = base + '-' + String(row.id).slice(-4) + '-' + n++;
  taken.add(id); return id;
}

/* ── the plan: what an import would do, with nothing written ── */
async function plan(db, board) {
  const cols = pickColumns(board.columns);
  const rows = board.items.map((it) => rowOf(it, cols)).filter((r) => r.name);
  const roster = await loadRoster(db);
  const taken = new Set(roster.ids);
  const out = { board: { id: board.id, name: board.name, rows: board.items.length }, columns: { guardian: cols.guardian && cols.guardian.title, phone: cols.phone && cols.phone.title, phone2: cols.phone2 && cols.phone2.title, email: cols.email && cols.email.title, email2: cols.email2 && cols.email2.title, dob: cols.dob && cols.dob.title },
    groups: {}, matched: 0, contactsToWrite: 0, keptFromEnrollment: 0, duplicateRows: 0, create: { active: 0, away: 0, finished: 0 }, skipped: { noContact: 0, unknownGroup: 0, ambiguous: 0 }, check: [], writes: [] };
  const contactCache = {};
  const contactOf = async (pid) => { if (!(pid in contactCache)) { try { const d = await db.doc('players/' + pid + '/private/contact').get(); contactCache[pid] = d.exists ? (d.data() || {}) : null; } catch (e) { contactCache[pid] = null; } } return contactCache[pid]; };
  for (const row of rows) {
    out.groups[row.group || '(no group)'] = (out.groups[row.group || '(no group)'] || 0) + 1;
    const hasContact = !!(row.phone || row.email || row.guardian);
    const m = matchRow(row, roster);
    if (m.note) out.check.push(m.note);
    if (m.player && m.player.planned) {
      // the same player twice on the board: the later row refreshes the record planned a moment ago
      out.duplicateRows++;
      out.writes.push({ kind: 'contact', pid: m.player.id, row });
      continue;
    }
    if (m.player) {
      out.matched++;
      const p = m.player;
      const c = await contactOf(p.id);
      const own = c && c.source === 'enroll' && (c.phone || c.email);
      if (own) { out.keptFromEnrollment++; out.writes.push({ kind: 'mark', pid: p.id, row }); continue; }
      if (!hasContact) { out.writes.push({ kind: 'mark', pid: p.id, row }); continue; }
      out.contactsToWrite++;
      out.writes.push({ kind: 'contact', pid: p.id, row });
      continue;
    }
    if (m.how === 'ambiguous') { out.skipped.ambiguous++; continue; }
    if (!row.standing) { out.skipped.unknownGroup++; continue; }
    if (!hasContact) { out.skipped.noContact++; continue; }
    const pid = newId(row, row.standing, taken);
    out.create[row.standing.status]++;
    out.writes.push({ kind: 'create', pid, row });
    // the same name twice on the board (a duplicate row) refreshes the record just planned instead of making a second one
    const made = { id: pid, name: row.name, status: row.standing.status, source: 'monday', accounting: { id: row.id }, planned: true };
    (roster.byName[ROSTER.fold(row.name)] || (roster.byName[ROSTER.fold(row.name)] = [])).push(made);
    roster.byAccounting[row.id] = made;
  }
  out.check = out.check.slice(0, 60);
  return out;
}

function contactDoc(row, now) {
  const c = { guardian: row.guardian || '', email: row.email || '', phone: row.phone || '', source: 'monday', accountingId: row.id, accountingGroup: row.group, updatedAt: now };
  if (row.phone2) c.phone2 = row.phone2;
  if (row.email2) c.email2 = row.email2;
  if (row.dob) c.dob = row.dob;
  if (row.standing && row.standing.optOut) c.optOut = true;
  return c;
}

/* ── the import itself ── */
async function apply(db, planned, who) {
  const now = Date.now();
  const ops = [];
  for (const w of planned.writes) {
    const mark = { accounting: { id: w.row.id, group: w.row.group, board: planned.board.id, syncedAt: now } };
    if (w.kind === 'mark') { ops.push({ path: 'players/' + w.pid, data: mark, merge: true }); continue; }
    if (w.kind === 'contact') {
      ops.push({ path: 'players/' + w.pid, data: mark, merge: true });
      ops.push({ path: `players/${w.pid}/private/contact`, data: contactDoc(w.row, now), merge: true });
      continue;
    }
    const st = w.row.standing;
    const doc = { name: w.row.name, shortName: ROSTER.shortName(w.row.name), group: st.status === 'active' ? groupHint(w.row.playerGroup, w.row.statusText) : '', tier: '', coach: '', coach2: '', fitness: '', status: st.status, source: 'monday',
      createdAt: now, updatedAt: now, createdBy: 'Monday import (' + (who || 'owner') + ')', accounting: Object.assign({}, mark.accounting, { playerGroup: w.row.playerGroup || '', statusText: w.row.statusText || '' }) };
    ops.push({ path: 'players/' + w.pid, data: doc, merge: false });
    ops.push({ path: `players/${w.pid}/private/contact`, data: contactDoc(w.row, now), merge: false });
  }
  // one write per document: a duplicate row on the board folds into the record planned just before it
  const byPath = new Map();
  for (const op of ops) {
    const have = byPath.get(op.path);
    if (!have) { byPath.set(op.path, { path: op.path, data: Object.assign({}, op.data), merge: op.merge }); continue; }
    Object.assign(have.data, op.data); have.merge = have.merge && op.merge;
  }
  const writes = [...byPath.values()];
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    for (const op of writes.slice(i, i + BATCH)) batch.set(db.doc(op.path), op.data, op.merge ? { merge: true } : undefined);
    await batch.commit();
  }
  const summary = { at: now, by: who || '', board: planned.board, columns: planned.columns, groups: planned.groups, matched: planned.matched, contactsWritten: planned.contactsToWrite, keptFromEnrollment: planned.keptFromEnrollment, duplicateRows: planned.duplicateRows, created: planned.create, skipped: planned.skipped, writes: writes.length };
  try { await db.doc('imports/monday-' + now).set(summary); } catch (e) { /* the summary is a courtesy */ }
  return summary;
}

async function tokenOf(db) {
  const s = await NOTIFY.settings(db, true);
  const token = String(s.mondayToken || '').trim();
  if (!token) throw S.err(503, 'monday_off', 'No Monday API token yet — an owner pastes it on the backend (Players & billing → Notifications → Monday).');
  return { token, board: String(s.mondayBoard || DEFAULT_BOARD).trim() || DEFAULT_BOARD };
}

async function preview(db) {
  const { token, board } = await tokenOf(db);
  const b = await fetchBoard(token, board);
  const p = await plan(db, b);
  delete p.writes;                                                           // counts and names to check only; nothing a family typed
  return p;
}
async function importAll(db, who) {
  const { token, board } = await tokenOf(db);
  const b = await fetchBoard(token, board);
  const p = await plan(db, b);
  const done = await apply(db, p, who);
  done.check = p.check;
  return done;
}

module.exports = { preview, importAll, plan, apply, fetchBoard, pickColumns, rowOf, standingOf, matchRow, fullNameOf, groupHint, DEFAULT_BOARD, _useFetch };
