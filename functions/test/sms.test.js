'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const SMS = require('../lib/sms');
const NOTIFY = require('../lib/notify');
const { fakeDb } = require('./fake-db');

const SETTINGS = { 'settings/notify': { justcallKey: 'k', justcallSecret: 'secret-1', justcallNumber: '+15614030008', textsOn: true } };
const ROSTER = {
  'players/as-ava-t': { name: 'Ava Torres', group: 'as', coach: 'Eric', status: 'active', enroll: { program: 'afterschool', days: ['Mon', 'Wed', 'Fri'] } },
  'players/as-ava-t/private/contact': { guardian: 'Jane Torres', phone: '(561) 555-0101', email: 'jane@example.com' },
  'players/as-ava-t/private/sms': { optIn: true, at: 1, source: 'enroll', phone: '+15615550101' },
  'players/ft-ben-k': { name: 'Ben Kim', group: 'ft', coach: 'Nico', status: 'active' },
  'players/ft-ben-k/private/contact': { guardian: 'Mia Kim', phone: '5615550102' },
  'players/u10-cy-l': { name: 'Cy Lee', group: 'u10', coach: 'Kamryn', status: 'active' },
  'switchRoster/cy-lee': { player: 'Cy Lee', guardian: 'Dee Lee', phone: '5615550103' },
  'players/u10-cy-l/private/sms': { optIn: true, at: 2, source: 'staff', by: 'desk@proworldacademy.com' },
  'players/as-dee-m': { name: 'Dee Moss', group: 'as', coach: 'Eric', status: 'active' },
  'players/as-dee-m/private/contact': { guardian: 'Ed Moss', phone: '123' },
  'players/as-dee-m/private/sms': { optIn: true, at: 3, source: 'staff' },
  'players/as-old-p': { name: 'Old Player', group: 'as', status: 'finished' },
  'players/soc-eli-r': { name: 'Eli Ruiz', sport: 'soccer', coach: 'Lukas', status: 'active' },
  'players/soc-eli-r/private/sms': { optIn: true, at: 4, source: 'enroll', phone: '+15615550105' }
};
const DESK = { email: 'desk@proworldacademy.com', name: 'Front Desk', firstName: 'Front', texting: true };
const COACH = { email: 'eric@proworldacademy.com', name: 'Eric Lane', firstName: 'Eric', texting: false };

/* a JustCall stand-in: every request recorded; `fail` makes the first N calls to a number fail with a status */
function wire(plan) {
  plan = plan || {}; const calls = []; const left = Object.assign({}, plan.fail || {});
  SMS._useFetch(async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push({ url, auth: opts.headers.Authorization, body });
    const f = left[body.contact_number];
    if (f && f.n > 0) { f.n--; return { ok: false, status: f.status, json: async () => ({ message: f.message || 'nope' }) }; }
    return { ok: true, status: 200, json: async () => ({ data: { id: 'jc_' + calls.length } }) };
  });
  NOTIFY.forget();
  return calls;
}
const fast = { budgetMs: 10000, delayMs: 0, backoffMs: 0 };

test('segments count the way carriers do: GSM-7 at 160/153, UCS-2 at 70/67 the moment a curly quote or an emoji shows up', () => {
  assert.deepEqual(SMS.segments(''), { encoding: 'GSM-7', units: 0, segments: 0, per: 153, single: 160 });
  assert.equal(SMS.segments('a'.repeat(160)).segments, 1); assert.equal(SMS.segments('a'.repeat(161)).segments, 2); assert.equal(SMS.segments('a'.repeat(306)).segments, 2); assert.equal(SMS.segments('a'.repeat(307)).segments, 3);
  const braces = 'Hi {first_name}, {program} today is on court {court}.'; assert.equal(SMS.segments(braces).units, braces.length + 6, 'braces count double in GSM-7');
  const curly = SMS.segments('It’s raining'); assert.equal(curly.encoding, 'UCS-2'); assert.equal(curly.segments, 1);
  assert.equal(SMS.segments('x'.repeat(71) + '😀').segments, 2);
  assert.equal(SMS.segments("It's raining").encoding, 'GSM-7');
  assert.equal(SMS.gsmSafe('It’s “raining” — again…'), 'It\'s "raining" - again...'); assert.equal(SMS.segments(SMS.FOOTER('ProWorld Academy')).encoding, 'GSM-7'); for (const t of SMS.DEFAULT_TEMPLATES) assert.equal(SMS.segments(t.text).encoding, 'GSM-7', t.id);
});

test('placeholders fill from the recipient; an unknown or empty one stays visible', () => {
  assert.equal(SMS.render('Hi {first_name}, {program} at {time} on court {court}.', { first_name: 'Ava', program: 'Afterschool', time: '4:00 PM', court: '' }), 'Hi Ava, Afterschool at 4:00 PM on court {court}.');
  assert.deepEqual(SMS.placeholdersIn('{first_name} {time} {time} {nope}'), ['first_name', 'time', 'nope']);
  assert.equal(SMS.validPhone('+15615550101'), true); assert.equal(SMS.validPhone('+15615550101x'), false); assert.equal(SMS.validPhone('+10615550101'), false); assert.equal(SMS.validPhone('+447700900123'), true); assert.equal(SMS.validPhone('+123'), false);
});

test('recipients: the phone we would text (consent → contact card → the Play by Point roster), E.164, validity, consent — finished players left out', async () => {
  const db = fakeDb(Object.assign({}, ROSTER, SETTINGS));
  const rows = await SMS.recipients(db);
  assert.deepEqual(rows.map((r) => r.id), ['as-ava-t', 'ft-ben-k', 'u10-cy-l', 'as-dee-m', 'soc-eli-r']);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by['as-ava-t'].phone, '+15615550101'); assert.equal(by['as-ava-t'].phoneSource, 'consent'); assert.equal(by['as-ava-t'].optIn, true); assert.equal(by['as-ava-t'].programLabel, 'Afterschool'); assert.equal(by['as-ava-t'].first, 'Ava'); assert.deepEqual(by['as-ava-t'].days, ['Mon', 'Wed', 'Fri']);
  assert.equal(by['ft-ben-k'].phone, '+15615550102'); assert.equal(by['ft-ben-k'].phoneSource, 'contact'); assert.equal(by['ft-ben-k'].optIn, false); assert.equal(by['ft-ben-k'].programLabel, 'Full Time');
  assert.equal(by['u10-cy-l'].phone, '+15615550103'); assert.equal(by['u10-cy-l'].phoneSource, 'switch'); assert.equal(by['u10-cy-l'].parent, 'Dee Lee'); assert.equal(by['u10-cy-l'].optIn, true);
  assert.equal(by['as-dee-m'].phone, '+123'); assert.equal(by['as-dee-m'].valid, false);
  assert.equal(by['soc-eli-r'].programLabel, 'Soccer');
  // "Requested to OPT OUT" on Monday wins over everything, and the roster opt-in never touches them
  db._docs.set('players/as-ava-t/private/contact', { guardian: 'Jane Torres', phone: '(561) 555-0101', optOut: true, source: 'monday' });
  const ava = await SMS.recipient(db, 'as-ava-t'); assert.equal(ava.optIn, false); assert.equal(ava.optOut, true); assert.equal(ava.optInSource, 'optout');
  db._docs.delete('players/as-ava-t/private/sms');
  assert.equal((await SMS.optInRoster(db, { email: 'o@x' })).players.includes('as-ava-t'), false);
});

test('the Play by Point roster matches on the full name, on first name + last initial, or on a lone first name — only when unambiguous', async () => {
  const ix = SMS.switchIndex([{ player: 'Abby G', phone: '1' }, { player: 'Alexander D', phone: '2' }, { player: 'Alexander Davis', phone: '3' }, { player: 'Alisa', phone: '4' }, { player: 'Ben Kim', phone: '5' }, { player: 'Mia', phone: '6' }, { player: 'Mia', phone: '7' }, { player: 'Zoe Chen', phone: '8' }, { player: 'Lu', phone: '9' }]);
  const m = (n) => { const r = SMS.switchMatch(ix, n); return r ? r.phone : null; };
  assert.equal(m('Abby Gordon'), '1'); assert.equal(m('Abby G'), '1'); assert.equal(m('Abbey Gordon'), null);
  assert.equal(m('Alexander Davis'), '3', 'the full name wins'); assert.equal(m('Alexander Dudziak'), null, 'two rows could be "Alexander D"');
  assert.equal(m('Alisa'), '4'); assert.equal(m('Alisa Petrova'), '4', 'a lone first name on the switch roster');
  assert.equal(m('Ben K'), '5'); assert.equal(m('Mia Lee'), null, 'two Mias'); assert.equal(m('Mia'), null);
  assert.equal(m('Zoe Lee'), null, 'a different surname never matches on the first name alone'); assert.equal(m('Zoe'), '8', 'a lone first name on the roster takes the one row with it'); assert.equal(m('Lu Wang'), '9');
  const db = fakeDb(Object.assign({}, ROSTER, SETTINGS)); wire();
  db._docs.set('switchRoster/ben-k', { player: 'Ben K', phone: '5615550109' });
  const rows = await SMS.recipients(db); const ben = rows.find((r) => r.id === 'ft-ben-k'); assert.equal(ben.phoneSource, 'contact', 'the contact card still comes first');
  db._docs.delete('players/ft-ben-k/private/contact');
  assert.equal((await SMS.recipient(db, 'ft-ben-k')).phone, '+15615550109');
  const out = await SMS.optInRoster(db, { email: 'owner@proworldacademy.com' });
  assert.deepEqual(out.players.sort(), ['ft-ben-k'], 'only players with a number and no consent record yet');
  assert.equal(db._docs.get('players/ft-ben-k/private/sms').source, 'playbypoint'); assert.equal(db._docs.get('players/as-ava-t/private/sms').source, 'enroll', 'an existing record is left alone');
});

test('a send: consent and numbers decide who gets it, every recipient gets a log line, placeholders and the footer are in the text, JustCall is called once per number', async () => {
  const db = fakeDb(Object.assign({}, ROSTER, SETTINGS)); const calls = wire();
  const out = await SMS.send(db, DESK, { body: 'Hi {first_name}, {program} at {time} is cancelled.', template: 'rain', recipients: [{ player: 'as-ava-t', vars: { time: '4:00 PM' } }, { player: 'ft-ben-k', vars: { time: '7:45 AM' } }, { player: 'u10-cy-l', vars: { time: '4:30 PM' } }, { player: 'as-dee-m' }, { player: 'nobody' }, { player: 'as-ava-t' }] }, fast);
  assert.equal(out.state, 'done'); assert.equal(out.total, 4); assert.equal(out.sent, 2); assert.equal(out.skipped, 2); assert.equal(out.failed, 0); assert.equal(out.queued, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.justcall.io/v2.1/texts/new'); assert.equal(calls[0].auth, 'k:secret-1');
  assert.equal(calls[0].body.justcall_number, '+15614030008'); assert.equal(calls[0].body.contact_number, '+15615550101');
  assert.equal(calls[0].body.body, 'Hi Ava, Afterschool at 4:00 PM is cancelled.\n- ProWorld Academy. Reply here with any question.');
  const logs = [...db._docs.entries()].filter(([k]) => k.startsWith('smsLog/')).map(([, v]) => v);
  const by = Object.fromEntries(logs.map((l) => [l.player, l]));
  assert.equal(by['as-ava-t'].status, 'sent'); assert.match(by['as-ava-t'].justcallId, /^jc_[12]$/); assert.equal(by['as-ava-t'].attempts, 1); assert.equal(by['as-ava-t'].by, 'desk@proworldacademy.com');
  assert.equal(by['ft-ben-k'].status, 'skipped'); assert.equal(by['ft-ben-k'].reason, 'not opted in');
  assert.equal(by['as-dee-m'].status, 'skipped'); assert.equal(by['as-dee-m'].reason, 'bad number');
  assert.equal(by['u10-cy-l'].status, 'sent'); assert.equal(by['u10-cy-l'].body, 'Hi Cy, 10 & Under at 4:30 PM is cancelled.\n- ProWorld Academy. Reply here with any question.');
  const batch = db._docs.get('smsBatches/' + out.batch);
  assert.equal(batch.state, 'done'); assert.deepEqual(batch.counts, { total: 4, sent: 2, failed: 0, skipped: 2, queued: 0 }); assert.equal(batch.template, 'rain'); assert.equal(batch.segments, 1);
  // the history: the front desk sees everything, a coach only the players they coach
  const h = await SMS.history(db, DESK, {}); assert.equal(h.batches.length, 1); assert.equal(h.logs.length, 4);
  const hc = await SMS.history(db, COACH, {}); assert.deepEqual(hc.logs.map((l) => l.player).sort(), ['as-ava-t', 'as-dee-m']);
  const hp = await SMS.history(db, DESK, { player: 'u10-cy-l' }); assert.equal(hp.logs.length, 1); assert.equal(hp.logs[0].status, 'sent');
});

test('a send retries a JustCall hiccup, gives up after three tries, keeps going for everyone else, and a retry later clears the failure', async () => {
  const db = fakeDb(Object.assign({}, ROSTER, SETTINGS));
  const calls = wire({ fail: { '+15615550101': { n: 2, status: 503 }, '+15615550103': { n: 5, status: 500 } } });
  const out = await SMS.send(db, DESK, { body: 'Court 12 today.', recipients: [{ player: 'as-ava-t' }, { player: 'u10-cy-l' }, { player: 'soc-eli-r' }] }, fast);
  assert.equal(out.sent, 2); assert.equal(out.failed, 1); assert.equal(out.state, 'done');
  const logs = Object.fromEntries([...db._docs.entries()].filter(([k]) => k.startsWith('smsLog/')).map(([, v]) => [v.player, v]));
  assert.equal(logs['as-ava-t'].status, 'sent'); assert.equal(logs['as-ava-t'].attempts, 3);
  assert.equal(logs['u10-cy-l'].status, 'failed'); assert.equal(logs['u10-cy-l'].attempts, 3); assert.equal(logs['u10-cy-l'].error, 'nope');
  assert.equal(logs['soc-eli-r'].status, 'sent');
  assert.equal(calls.length, 3 + 3 + 1);
  const again = await SMS.retryBatch(db, out.batch, fast);
  assert.equal(again.retried, 1); assert.equal(again.sent, 3); assert.equal(again.failed, 0);
  // a 4xx is final at once, and JustCall saying the number opted out switches the family off
  const db2 = fakeDb(Object.assign({}, ROSTER, SETTINGS)); wire({ fail: { '+15615550101': { n: 9, status: 403, message: 'Contact has opted out of SMS' } } });
  const o2 = await SMS.send(db2, DESK, { body: 'x', recipients: [{ player: 'as-ava-t' }] }, fast);
  assert.equal(o2.failed, 1);
  assert.equal(db2._docs.get('players/as-ava-t/private/sms').optIn, false); assert.equal(db2._docs.get('players/as-ava-t/private/sms').source, 'justcall');
});

test('a big send is worked through in slices: the time budget stops the request, the page continues the batch until it is done', async () => {
  const seed = Object.assign({}, SETTINGS); const wanted = [];
  for (let i = 0; i < 40; i++) { const id = 'as-p' + i; seed['players/' + id] = { name: 'Player ' + i, group: 'as', status: 'active' }; seed[`players/${id}/private/sms`] = { optIn: true, phone: '+1561555' + String(1000 + i) }; wanted.push({ player: id }); }
  const db = fakeDb(seed); const calls = wire();
  const first = await SMS.send(db, DESK, { body: 'Hello', recipients: wanted }, { budgetMs: 0, delayMs: 0 });
  assert.equal(first.state, 'sending'); assert.ok(first.queued > 0 && first.sent < 40, 'the budget ran out');
  let last = first; let rounds = 0;
  while (last.state !== 'done' && rounds < 50) { last = await SMS.continueBatch(db, first.batch, fast); rounds++; }
  assert.equal(last.state, 'done'); assert.equal(last.sent, 40); assert.equal(calls.length, 40);
  assert.equal(db._docs.get('smsBatches/' + first.batch).counts.sent, 40);
});

test('consent: staff toggles record who and when, the enrollment tick lands on the roster record, nothing goes out without it', async () => {
  const db = fakeDb(Object.assign({}, ROSTER, SETTINGS)); wire();
  const set = await SMS.setOptIn(db, 'ft-ben-k', true, { source: 'staff', by: 'desk@proworldacademy.com', phone: '(561) 555-0102' });
  assert.equal(set.optIn, true); assert.equal(set.phone, '+15615550102'); assert.equal(set.by, 'desk@proworldacademy.com');
  const r = await SMS.recipient(db, 'ft-ben-k'); assert.equal(r.optIn, true); assert.equal(r.phoneSource, 'consent');
  await SMS.setOptIn(db, 'ft-ben-k', false, { source: 'staff', by: 'desk@proworldacademy.com' });
  assert.equal((await SMS.recipient(db, 'ft-ben-k')).optIn, false); assert.ok(db._docs.get('players/ft-ben-k/private/sms').stoppedAt);
  await assert.rejects(SMS.setOptIn(db, 'nobody', true, {}), (e) => e.status === 404);
  // the enrollment form's tick, carried in the checkout session's metadata
  db._docs.set('players/as-new-k', { name: 'New Kid', group: 'as', status: 'active', source: 'enroll' });
  const c = await SMS.consentFromSession(db, { metadata: { sms_opt_in: 'yes', parent_phone: '561-555-0199', by: 'enroll' } }, { player: 'as-new-k', fresh: true });
  assert.equal(c.optIn, true); assert.equal(c.source, 'enroll'); assert.equal(c.phone, '+15615550199');
  assert.equal(await SMS.consentFromSession(db, { metadata: { sms_opt_in: 'yes' } }, { player: 'as-new-k', fresh: false }), null, 'a repeat record never rewrites consent');
  assert.equal(await SMS.consentFromSession(db, { metadata: {} }, { player: 'as-new-k', fresh: true }), null, 'no tick, nothing written');
  const noOne = await SMS.send(db, DESK, { body: 'x', recipients: [{ player: 'ft-ben-k' }] }, fast);
  assert.equal(noOne.sent, 0); assert.equal(noOne.skipped, 1);
  await assert.rejects(SMS.send(db, COACH, { body: 'x', recipients: [{ player: 'as-ava-t' }] }, fast), (e) => e.status === 403);
  await assert.rejects(SMS.send(db, DESK, { body: '', recipients: [{ player: 'as-ava-t' }] }, fast), (e) => e.code === 'body');
  await assert.rejects(SMS.send(fakeDb(ROSTER), DESK, { body: 'x', recipients: [{ player: 'as-ava-t' }] }, fast), (e) => e.code === 'keys');
});

test('the JustCall webhook: only a signed request counts; STOP switches the family off, START back on, delivery updates land on the line', async () => {
  const db = fakeDb(Object.assign({}, ROSTER, SETTINGS)); wire();
  const url = 'https://proworld-coach-portal.web.app/api/sms/webhook'; const ts = '2026-10-21 09:00:00';
  const sign = (type) => crypto.createHmac('sha256', 'secret-1').update(`secret-1|${encodeURIComponent(url)}|${type}|${ts}`).digest('hex');
  const headers = (type) => ({ 'x-justcall-signature': sign(type), 'x-justcall-signature-version': 'v1', 'x-justcall-request-timestamp': ts });
  const stop = { webhook_url: url, type: 'sms.received', data: { contact_number: '+15615550101', direction: 'Incoming', sms_info: { body: 'STOP' } } };
  await assert.rejects(SMS.webhook(db, { 'x-justcall-signature': 'bad', 'x-justcall-request-timestamp': ts }, stop), (e) => e.status === 401);
  const out = await SMS.webhook(db, headers('sms.received'), stop);
  assert.deepEqual(out.players, ['as-ava-t']);
  assert.equal(db._docs.get('players/as-ava-t/private/sms').optIn, false); assert.equal(db._docs.get('players/as-ava-t/private/sms').source, 'stop');
  const ev = [...db._docs.values()].find((v) => v.kind === 'optout'); assert.equal(ev.phone, '+15615550101'); assert.deepEqual(ev.players, ['as-ava-t']);
  const start = { webhook_url: url, type: 'sms.received', data: { contact_number: '(561) 555-0101', direction: 'Incoming', sms_info: { body: 'start' } } };
  await SMS.webhook(db, headers('sms.received'), start);
  assert.equal(db._docs.get('players/as-ava-t/private/sms').optIn, true); assert.equal(db._docs.get('players/as-ava-t/private/sms').source, 'start');
  const reply = { webhook_url: url, type: 'sms.received', data: { contact_number: '+15615550101', direction: 'Incoming', sms_info: { body: 'Thanks, see you at 4' } } };
  assert.match((await SMS.webhook(db, headers('sms.received'), reply)).did, /kept/);
  assert.equal(db._docs.get('players/as-ava-t/private/sms').optIn, true);
  // delivery
  const sent = await SMS.send(db, DESK, { body: 'x', recipients: [{ player: 'as-ava-t' }] }, fast); assert.equal(sent.sent, 1);
  const line = [...db._docs.entries()].find(([k, v]) => k.startsWith('smsLog/') && v.player === 'as-ava-t' && v.status === 'sent');
  const upd = { webhook_url: url, type: 'sms.status_updated', data: { id: line[1].justcallId, delivery_status: 'delivered' } };
  assert.match((await SMS.webhook(db, headers('sms.status_updated'), upd)).did, /delivered on 1/);
  assert.equal(db._docs.get(line[0]).delivery, 'delivered');
  const h = await SMS.history(db, DESK, {}); assert.deepEqual(h.events.map((e) => e.kind).sort(), ['optin', 'optout']);
});

test('settings: templates are edited as a list with ids, the sender name and the inbox link are kept sane', async () => {
  const db = fakeDb(SETTINGS);
  const d = await SMS.settings(db); assert.equal(d.senderName, 'ProWorld Academy'); assert.equal(d.templates.length, 3); assert.equal(d.templates[0].id, 'rain'); assert.equal(d.footer, true);
  const s = await SMS.saveSettings(db, { senderName: ' ProWorld ', inboxUrl: 'https://app.justcall.io/app/inbox', templates: [{ name: 'Rain update', text: 'Rain!' }, { name: 'Rain update', text: 'Rain again' }, { name: '', text: 'no name' }] }, 'desk@proworldacademy.com');
  assert.equal(s.senderName, 'ProWorld'); assert.deepEqual(s.templates.map((t) => t.id), ['rain-update', 'rain-update-2']);
  await assert.rejects(SMS.saveSettings(db, { inboxUrl: 'javascript:alert(1)' }, 'x'), (e) => e.code === 'inbox');
  await assert.rejects(SMS.saveSettings(db, { templates: 'x' }, 'x'), (e) => e.code === 'templates');
  const ln = await SMS.line(db); assert.deepEqual(ln, { connected: true, from: '+15614030008', textsOn: true });
});
