'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MONDAY = require('../lib/mondayimport');
const NOTIFY = require('../lib/notify');
const FEED = require('../lib/feed');
const { fakeDb } = require('./fake-db');

/* A stand-in for Monday's API: the ACCOUNTING board's columns and rows, invented families only. */
const COLUMNS = [
  { id: 'name', title: 'Name', type: 'name' }, { id: 'text', title: 'Last Name', type: 'text' }, { id: 'group0', title: 'Player Group', type: 'status' }, { id: 'status_x', title: 'Status', type: 'status' },
  { id: 'text0', title: 'Guardian Name', type: 'text' }, { id: 'phone', title: 'Phone Main', type: 'phone' },
  { id: 'email', title: 'Customer Email', type: 'email' }, { id: 'email4', title: 'Email', type: 'email' }, { id: 'phone2', title: 'Phone 2 (other parent)', type: 'phone' },
  { id: 'numbers', title: 'Balance', type: 'numbers' }, { id: 'status', title: 'Status', type: 'color' }, { id: 'date', title: 'Enroll Date', type: 'date' }
];
function item(id, name, group, c) {
  c = c || {};
  const cv = [];
  // the board keeps the first name as the row and the last name in a column; a few rows carry the whole name
  const parts = name.split(' '); const first = c.wholeName ? name : parts[0]; const last = c.wholeName ? '' : (c.lastAs || parts.slice(1).join(' '));
  name = first;
  cv.push({ id: 'text', type: 'text', text: last, value: last ? JSON.stringify(last) : null });
  if (c.playerGroup) cv.push({ id: 'group0', type: 'status', text: c.playerGroup, value: JSON.stringify({ index: 1 }) });
  if (c.statusText) cv.push({ id: 'status_x', type: 'status', text: c.statusText, value: JSON.stringify({ index: 2 }) });
  if (c.guardian !== undefined) cv.push({ id: 'text0', type: 'text', text: c.guardian, value: JSON.stringify(c.guardian) });
  if (c.phone !== undefined) cv.push({ id: 'phone', type: 'phone', text: c.phone, value: c.phone ? JSON.stringify({ phone: c.phone.replace(/\D/g, ''), countryShortName: 'US' }) : null });
  if (c.email !== undefined) cv.push({ id: 'email', type: 'email', text: c.emailText || c.email, value: c.email ? JSON.stringify({ email: c.email, text: c.emailText || c.email }) : null });
  if (c.email2 !== undefined) cv.push({ id: 'email4', type: 'email', text: c.email2, value: c.email2 ? JSON.stringify({ email: c.email2, text: c.email2 }) : null });
  if (c.phone2 !== undefined) cv.push({ id: 'phone2', type: 'phone', text: c.phone2, value: c.phone2 ? JSON.stringify({ phone: c.phone2, countryShortName: 'US' }) : null });
  return { id: String(id), name, group: { id: group.toLowerCase().replace(/\W+/g, '_'), title: group }, column_values: cv };
}
const ROWS = [
  item(1001, 'Liam Rivera', 'Active', { guardian: 'Maria Rivera', phone: '+1 561-555-0102', email: 'Maria.Rivera@example.com', emailText: 'Maria' }),       // on the roster already, no contact yet
  item(1002, 'Mia Rivera', 'Active', { guardian: 'Maria Rivera', phone: '5615550102', email: 'maria.rivera@example.com' }),                             // on the roster with the parent's own (enrollment) details
  item(1003, 'Noah Kim', 'Away', { guardian: 'Grace Kim', phone: '(561) 555-0103', email: '', email2: 'grace.kim@example.com', phone2: '5615550113' }),  // on the roster; e-mail in the second column
  item(1004, 'Zoe Carter', 'Finished', { guardian: 'Pat Carter', phone: '5615550104', email: 'pat.carter@example.com', lastAs: 'CARTER' }),               // not on the roster → past player (last name shouted on the board)
  item(1005, 'Zoe Carter', 'OLDER CLIENTS', { guardian: 'Pat Carter', phone: '5615550104', email: 'pat.carter@example.com' }),                            // the same player twice on the board
  item(1006, 'Eli Brooks', 'Active', { guardian: 'Sam Brooks', phone: '5615550106', email: 'sam.brooks@example.com', playerGroup: 'BOYS', statusText: 'AFTER-SCHOOL' }),   // not on the roster, training → new active player, afterschool
  item(1007, 'Ava Nolan', 'Requested to OPT OUT', { guardian: 'Dee Nolan', phone: '5615550107', email: '' }),                                             // opted out → finished, flagged
  item(1008, 'Old Timer', 'OLDER CLIENTS', { guardian: '', phone: '', email: '' }),                                                                        // nothing to reach them by → skipped
  item(1009, 'Ben Shaw', 'Try outs', { guardian: 'Kim Shaw', phone: '5615550109', email: 'kim.shaw@example.com' }),                                        // a group the engine does not know → skipped
  item(1010, 'Lucas Perez', 'Away', { guardian: 'Ana Perez', phone: '5615550110', email: 'ana.perez@example.com' }),                                       // short-name match: roster has "Lucas P."-style record "Lucas Perez-Gomez"? no: two Lucas P. on the roster → ambiguous
  item(1011, 'Nina Walsh', 'New Players / Re Enrolled', { guardian: 'Tom Walsh', phone: '5615550111', email: 'tom.walsh@example.com', playerGroup: 'U10', wholeName: true })   // signed up, not started → active; the whole name on the row
];
function wireMonday(rows, opts) {
  opts = opts || {};
  const calls = [];
  MONDAY._useFetch(async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ headers: init.headers, body });
    if (opts.status) return { ok: false, status: opts.status, json: async () => ({ error_message: opts.message || 'Not Authenticated' }) };
    const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
    if (/columns \{/.test(body.query)) return ok({ boards: [{ id: '2140058342', name: 'ACCOUNTING', columns: COLUMNS }] });
    const limit = body.variables.limit; const wanted = body.variables.cols || [];
    const slice = (from) => rows.slice(from, from + limit).map((it) => Object.assign({}, it, { column_values: it.column_values.filter((cv) => wanted.includes(cv.id)) }));
    if (/items_page/.test(body.query) && !/next_items_page/.test(body.query)) return ok({ boards: [{ items_page: { cursor: rows.length > limit ? 'c:' + limit : null, items: slice(0) } }] });
    const from = parseInt(String(body.variables.cursor).split(':')[1], 10);
    return ok({ next_items_page: { cursor: rows.length > from + limit ? 'c:' + (from + limit) : null, items: slice(from) } });
  });
  return calls;
}
function seed() {
  return fakeDb({
    'settings/notify': { mondayToken: 'tok-123', textsOn: false },
    'players/ft-liam-r': { name: 'Liam Rivera', shortName: 'Liam R.', group: 'ft', coach: 'Eric Samuelsson', status: 'active', source: 'monday', createdAt: 1 },
    'players/as-mia-r': { name: 'Mia Rivera', shortName: 'Mia R.', group: 'as', coach: 'Kamryn Taub', status: 'active', source: 'enroll', createdAt: 2 },
    'players/as-mia-r/private/contact': { guardian: 'Maria A. Rivera', email: 'maria.rivera@example.com', phone: '5615550102', source: 'enroll' },
    'players/u10-noah-k': { name: 'Noah Kim', group: 'u10', coach: '', status: 'active', source: 'coach' },
    'players/ft-lucas-p': { name: 'Lucas Pereira', group: 'ft', status: 'active', source: 'monday' },
    'players/as-lucas-p': { name: 'Lucas Pinto', group: 'as', status: 'active', source: 'monday' }
  });
}

test('columns are found by title and type; a row keeps the parent and both ways to reach them', () => {
  const cols = MONDAY.pickColumns(COLUMNS);
  assert.equal(cols.last.title, 'Last Name'); assert.equal(cols.playerGroup.title, 'Player Group'); assert.equal(cols.statusText.title, 'Status');
  assert.equal(cols.guardian.title, 'Guardian Name'); assert.equal(cols.phone.title, 'Phone Main'); assert.equal(cols.email.title, 'Customer Email');
  assert.equal(cols.email2.title, 'Email'); assert.equal(cols.phone2.title, 'Phone 2 (other parent)'); assert.equal(cols.dob, null);
  const r = MONDAY.rowOf(ROWS[0], cols);
  assert.deepEqual([r.name, r.guardian, r.phone, r.email, r.standing.status], ['Liam Rivera', 'Maria Rivera', '5615550102', 'maria.rivera@example.com', 'active']);
  const n = MONDAY.rowOf(ROWS[2], cols);
  assert.deepEqual([n.email, n.email2, n.phone, n.phone2, n.standing.status], ['grace.kim@example.com', '', '5615550103', '5615550113', 'away']);
  assert.deepEqual(MONDAY.standingOf('Requested to OPT OUT'), { status: 'finished', word: 'finished', optOut: true });
  assert.deepEqual(MONDAY.standingOf('New Players / Re Enrolled'), { status: 'active', word: 'new' });
  assert.equal(MONDAY.standingOf('Try outs'), null);
  assert.equal(MONDAY.rowOf(ROWS[3], cols).name, 'Zoe Carter', 'a shouted last name is calmed down');
  assert.equal(MONDAY.rowOf(ROWS[10], cols).name, 'Nina Walsh', 'a row that already carries the whole name is kept');
  assert.equal(MONDAY.fullNameOf('Ana Maria', 'DE LA CRUZ'), 'Ana Maria De La Cruz');
  assert.equal(MONDAY.fullNameOf('Liam Rivera', 'Rivera'), 'Liam Rivera');
  assert.deepEqual([MONDAY.groupHint('BOYS', 'AFTER-SCHOOL'), MONDAY.groupHint('GIRLS', 'PRO | GIRLS'), MONDAY.groupHint('U10', ''), MONDAY.groupHint('U12', ''), MONDAY.groupHint('BOYS', '')], ['as', 'ft', 'u10', 'as', '']);
});

test('the preview counts what an import would do and names the players to check — never a parent detail', async () => {
  NOTIFY.forget(); const db = seed(); const calls = wireMonday(ROWS);
  const p = await MONDAY.preview(db);
  assert.equal(calls[0].headers.Authorization, 'tok-123');
  assert.ok(calls[1].body.variables.cols.includes('phone') && !calls[1].body.variables.cols.includes('numbers'), 'only the contact columns are asked for');
  assert.equal(p.board.rows, 11);
  assert.equal(p.matched, 3);                              // Liam, Mia, Noah
  assert.equal(p.contactsToWrite, 2);                      // Liam and Noah; Mia's parent typed her own
  assert.equal(p.keptFromEnrollment, 1);
  assert.equal(p.duplicateRows, 1);
  assert.deepEqual(p.create, { active: 2, away: 0, finished: 2 });   // Eli + Nina; Zoe + Ava
  assert.deepEqual(p.skipped, { noContact: 1, unknownGroup: 1, ambiguous: 1 });
  assert.ok(p.check.some((c) => /Lucas Perez could be Lucas Pereira or Lucas Pinto/.test(c)), JSON.stringify(p.check));
  assert.equal(p.writes, undefined);
  const text = JSON.stringify(p);
  assert.ok(!/5615550|example\.com|Maria|Grace/.test(text), 'no phone, e-mail or parent name in the preview');
  assert.equal(db._writes.length, 0, 'the preview writes nothing');
});

test('the import writes the parents, adds the missing players with their standing, and the feed carries them', async () => {
  NOTIFY.forget(); FEED.forget(); const db = seed(); wireMonday(ROWS);
  const out = await MONDAY.importAll(db, 'owner@example.com');
  assert.equal(out.contactsWritten, 2); assert.deepEqual(out.created, { active: 2, away: 0, finished: 2 });
  // Liam: the parent from Monday, marked as such
  const liam = db._docs.get('players/ft-liam-r/private/contact');
  assert.deepEqual([liam.guardian, liam.phone, liam.email, liam.source, liam.accountingId], ['Maria Rivera', '5615550102', 'maria.rivera@example.com', 'monday', '1001']);
  assert.equal(db._docs.get('players/ft-liam-r').status, 'active', 'status untouched');
  assert.equal(db._docs.get('players/ft-liam-r').coach, 'Eric Samuelsson', 'coach untouched');
  assert.equal(db._docs.get('players/ft-liam-r').accounting.id, '1001');
  // Mia: what the parent typed stays
  assert.equal(db._docs.get('players/as-mia-r/private/contact').guardian, 'Maria A. Rivera');
  assert.equal(db._docs.get('players/as-mia-r/private/contact').source, 'enroll');
  // Noah: e-mail from the second column, second phone kept
  const noah = db._docs.get('players/u10-noah-k/private/contact');
  assert.deepEqual([noah.email, noah.phone, noah.phone2], ['grace.kim@example.com', '5615550103', '5615550113']);
  // Zoe: one past player for two board rows; Eli: a new active player with no group yet; Ava: finished and opted out
  const ids = [...db._docs.keys()].filter((k) => /^players\/[^/]+$/.test(k));
  assert.ok(ids.includes('players/past-zoe-c') && ids.filter((k) => /zoe/.test(k)).length === 1, ids.join(','));
  assert.equal(db._docs.get('players/past-zoe-c').status, 'finished');
  assert.equal(db._docs.get('players/past-zoe-c').accounting.id, '1005', 'the later duplicate row refreshed the record');
  assert.deepEqual([db._docs.get('players/new-eli-b').status, db._docs.get('players/new-eli-b').group, db._docs.get('players/new-eli-b').source], ['active', 'as', 'monday']);
  assert.deepEqual([db._docs.get('players/new-nina-w').status, db._docs.get('players/new-nina-w').group], ['active', 'u10']);
  assert.equal(db._docs.get('players/new-eli-b').accounting.playerGroup, 'BOYS');
  assert.equal(db._docs.get('players/past-ava-n/private/contact').optOut, true);
  assert.ok(!ids.some((k) => /old-timer|ben-shaw|lucas-perez/.test(k)), 'nothing to reach, unknown group and ambiguous names are not added');
  assert.ok([...db._docs.keys()].some((k) => /^imports\/monday-/.test(k)), 'a summary is filed');
  // the roster feed now carries every family, with the opt-out words the concierge reads
  const feed = await FEED.roster(db, { fresh: true });
  const row = (name) => feed.rows.find((r) => r.name === name);
  assert.deepEqual([row('Liam Rivera').columns.Phone, row('Liam Rivera').columns.Email, row('Liam Rivera').group], ['5615550102', 'maria.rivera@example.com', 'Active']);
  assert.equal(row('Ava Nolan').group, 'Finished · Requested to OPT OUT');
  assert.equal(row('Noah Kim').columns['Phone 2'], '5615550113');
  assert.equal(feed.counts.withPhone, 7);
  // a second run changes nothing but the marks
  const before = db._writes.length;
  const again = await MONDAY.importAll(db, 'owner@example.com');
  assert.deepEqual(again.created, { active: 0, away: 0, finished: 0 });
  assert.equal(again.matched, 8);
  assert.equal([...db._docs.keys()].filter((k) => /^players\/[^/]+$/.test(k)).length, ids.length, 'no duplicates on a re-run');
  assert.ok(db._writes.length > before);
});

test('no token, a bad token, and a missing board each say so plainly', async () => {
  NOTIFY.forget(); let db = fakeDb({ 'settings/notify': { textsOn: false } });
  await assert.rejects(MONDAY.preview(db), (e) => e.status === 503 && e.code === 'monday_off');
  NOTIFY.forget(); db = seed(); wireMonday(ROWS, { status: 401, message: 'Not Authenticated' });
  await assert.rejects(MONDAY.preview(db), (e) => e.status === 401 && /Monday: Not Authenticated/.test(e.message));
  NOTIFY.forget(); db = seed();
  MONDAY._useFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: { boards: [] } }) }));
  await assert.rejects(MONDAY.preview(db), (e) => e.status === 404);
  MONDAY._useFetch(null);
});

test('a big board comes in pages', async () => {
  NOTIFY.forget(); const db = seed();
  const many = []; for (let i = 0; i < 1203; i++) many.push(item(5000 + i, 'Player ' + i + ' Test', i % 3 ? 'Finished' : 'Away', { guardian: 'Parent ' + i, phone: '561555' + String(1000 + i).slice(-4), email: 'p' + i + '@example.com' }));
  const calls = wireMonday(many);
  const p = await MONDAY.preview(db);
  assert.equal(p.board.rows, 1203);
  assert.equal(calls.length, 1 + 3, 'the columns, then three pages of 500');
  assert.equal(p.create.finished + p.create.away, 1203);
});
