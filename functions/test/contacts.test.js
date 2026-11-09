'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CONTACTS = require('../lib/contacts');
const NOTIFY = require('../lib/notify');
const { fakeDb } = require('./fake-db');

/* Invented families and staff only. The week in this story: Mon Nov 2 – Sun Nov 8, 2026; "now" is Thu Nov 5, 3 PM Delray Beach. */
const NOW = Date.UTC(2026, 10, 5, 20, 0, 0);
const SEED = {
  'settings/notify': { justcallKey: 'k', justcallSecret: 's', slackBotToken: 'xoxb-test', slackCoaches: 'https://hooks.slack.com/services/T/B/x' },
  'staff/kim@example.test': { email: 'kim@example.test', name: 'Kim Example', coachAs: 'Kim', role: 'coach', active: true, slackId: 'U_KIM' },
  'staff/lee@example.test': { email: 'lee@example.test', name: 'Lee Example', role: 'coach', active: true },
  'staff/desk@example.test': { email: 'desk@example.test', name: 'Dana Desk', role: 'desk', active: true },
  'players/ft-bo-k': { name: 'Bo Kessler', group: 'ft', coach: 'Kim', status: 'active' },
  'players/ft-cy-l': { name: 'Cy Lane', group: 'ft', coach: 'Kim', status: 'active' },
  'players/as-di-m': { name: 'Di Moreau', group: 'as', coach: 'Lee', status: 'active' },
  'players/as-ed-m': { name: 'Ed Moreau', group: 'as', coach: 'Lee', status: 'active' },        // Di's brother: the same mother
  'players/past-gus': { name: 'Gus Vale', group: 'as', coach: 'Lee', status: 'finished' },
  'players/ft-bo-k/private/contact': { guardian: 'Pat Example', phone: '(561) 555-0100', email: 'pat@example.test' },
  'players/ft-cy-l/private/contact': { guardian: 'Sam Example', phone: '(561) 555-0101', phone2: '(561) 555-0102' },
  'players/as-di-m/private/contact': { guardian: 'Mo Example', phone: '(561) 555-0103' },
  'players/as-ed-m/private/contact': { guardian: 'Mo Example', phone: '(561) 555-0103' },
  'players/as-di-m/private/sms': { optIn: true, phone: '+15615550103' },
  // Cy's mother's number was typed by the coach on the contact check
  'contactCheck/ft-cy-l': { playerId: 'ft-cy-l', playerName: 'Cy Lane', slots: { mother: { state: 'ok', phone: '+15615550199', name: 'Ana Example' } }, onFile: [{ phone: '+15615550101', name: 'Sam Example', source: 'contact' }, { phone: '+15615550102', name: '', source: 'contact' }], by: 'kim@example.test', at: NOW - 864e5 },
  // Bo's coach ticked by hand already; Lee said "not yet" for Ed
  'contacts/ft-bo-k_2026-11-02': { playerId: 'ft-bo-k', playerName: 'Bo Kessler', group: 'ft', coach: 'Kim', week: '2026-11-02', done: true, by: 'Kim', byEmail: 'kim@example.test', at: NOW - 2 * 864e5, how: 'person', who: 'parents', source: 'coach' },
  'contacts/as-ed-m_2026-11-02': { playerId: 'as-ed-m', playerName: 'Ed Moreau', group: 'as', coach: 'Lee', week: '2026-11-02', done: false, by: 'Lee', byEmail: 'lee@example.test', at: NOW - 864e5, how: '', who: '', source: 'coach' },
  // the engine ticked Gus's week last time from a front-desk text (before the rule); this run no longer sees anything for him
  'contacts/past-gus_2026-11-02': { playerId: 'past-gus', playerName: 'Gus Vale', group: 'as', coach: 'Lee', week: '2026-11-02', done: true, by: 'Dana', byEmail: 'desk@example.test', at: NOW - 2 * 864e5, how: 'text', who: '', source: 'justcall', jc: { texts: 1, calls: 0, last: NOW - 2 * 864e5, by: ['Dana'] } }
};
const TEXTS = [
  { id: 1, sms_date: '2026-11-03', sms_time: '19:05:00', agent_email: 'kim@example.test', agent_name: 'Kim Example', contact_number: '+15615550199', direction: 'Outbound', delivery_status: 'Delivered', medium: 'One-To-One via App', sms_info: { body: 'Great session today' } },   // Kim → Cy's mother (typed number)
  { id: 2, sms_date: '2026-11-04', sms_time: '14:00:00', agent_email: 'kim@example.test', agent_name: 'Kim Example', contact_number: '+15615550100', direction: 'Outbound', delivery_status: 'Delivered', medium: 'Bulk SMS', sms_info: { body: 'Rain: courts closed' } },               // a bulk text: does not count
  { id: 3, sms_date: '2026-11-04', sms_time: '15:00:00', agent_email: 'kim@example.test', agent_name: 'Kim Example', contact_number: '+15615550103', direction: 'Inbound', delivery_status: '', medium: 'One-To-One via App', sms_info: { body: 'Thanks coach' } },                      // the family wrote in: does not count
  { id: 4, sms_date: '2026-11-04', sms_time: '16:00:00', agent_email: 'robot@example.test', agent_name: 'API', contact_number: '+15615550103', direction: 'Outbound', delivery_status: 'Delivered', medium: 'One-To-One via App', sms_info: { body: 'hi' } },                           // not on the staff list: does not count
  { id: 5, sms_date: '2026-10-28', sms_time: '16:00:00', agent_email: 'lee@example.test', agent_name: 'Lee Example', contact_number: '+15615550103', direction: 'Outbound', delivery_status: 'Delivered', medium: 'One-To-One via App', sms_info: { body: 'last week' } },                // last week: its own week
  { id: 6, sms_date: '2026-11-04', sms_time: '17:00:00', agent_email: 'desk@example.test', agent_name: 'Dana Desk', contact_number: '+15615550101', direction: 'Outbound', delivery_status: 'Delivered', medium: 'One-To-One via App', sms_info: { body: 'Your invoice is ready' } },   // the front desk texted Cy's family: not the coach, does not count
  { id: 7, sms_date: '2026-11-04', sms_time: '17:30:00', agent_email: 'lee@example.test', agent_name: 'Lee Example', contact_number: '+15615550100', direction: 'Outbound', delivery_status: 'Delivered', medium: 'One-To-One via App', sms_info: { body: 'See you Saturday' } }           // Lee texted Bo's family, but Bo is Kim's player: does not count for Bo
];
const CALLS = [
  { id: 11, call_date: '2026-11-05', call_time: '01:30:00', agent_email: 'lee@example.test', agent_name: 'Lee Example', contact_number: '+15615550103', call_info: { direction: 'Incoming', type: 'INCOMING_ANSWERED' }, call_duration: { conversation_time: 180 } },   // Wed 8:30 PM ET: the mother called Lee, answered → Di and Ed
  { id: 12, call_date: '2026-11-05', call_time: '15:00:00', agent_email: 'lee@example.test', agent_name: 'Lee Example', contact_number: '+15615550100', call_info: { direction: 'Outgoing', type: 'OUTGOING_UNANSWERED' }, call_duration: { conversation_time: 0 } }  // rang out: does not count
];
function fakeNet(captured) {
  return async (url, opts) => {
    captured.push({ url, opts });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (/\/v2\.1\/texts\?/.test(url)) return ok({ status: 'success', data: TEXTS, count: TEXTS.length, current_page: 0, per_page: 100 });
    if (/\/v2\.1\/calls\?/.test(url)) return ok({ status: 'success', data: CALLS, count: CALLS.length, current_page: 0 });
    if (/\/v2\.1\/users/.test(url)) return ok({ status: 'success', data: [{ id: 1, name: 'Kim Example', email: 'kim@example.test', role: 'Member', owned_numbers: ['+15610000001'] }, { id: 2, name: 'Dana Desk', email: 'desk@example.test', role: 'Admin', owned_numbers: [] }] });
    if (/slack\.com\/api\/chat\.postMessage/.test(url)) return ok({ ok: true });
    if (/hooks\.slack\.com/.test(url)) return ok({});
    return { ok: false, status: 404, json: async () => ({ error: 'no route ' + url }) };
  };
}

test('JustCall → the week’s ticks: a one-to-one text or an answered call by someone on staff marks the family, bulk and inbound do not, hand ticks and "not yet" stay', async () => {
  const db = fakeDb(SEED); const captured = []; CONTACTS._useFetch(fakeNet(captured)); NOTIFY._useFetch(fakeNet(captured)); NOTIFY.forget();
  const out = await CONTACTS.sync(db, { now: NOW });
  // the coach's own JustCall texts are kept as lines of the family's record, so the portal's chats show them (Nov 6)
  const jc1 = db._docs.get('smsLog/jc_1'); assert.ok(jc1, 'Kim\'s one-to-one text is kept'); assert.equal(jc1.from, 'justcall'); assert.equal(jc1.by, 'kim@example.test'); assert.match(jc1.body, /^Great/);
  assert.ok(!db._docs.get('smsLog/jc_2'), 'a bulk text is not'); assert.ok(!db._docs.get('smsLog/jc_3'), 'an inbound one is not (the webhook keeps those)');
  assert.equal(out.mirrored >= 1, true);
  assert.equal(out.ok, true); assert.equal(out.texts, 7); assert.equal(out.calls, 2);
  assert.equal(out.matched, 3);                 // Kim's text to Cy's mother, Lee's text last week, the answered call
  assert.equal(out.offStaff, 1); assert.equal(out.notCoach, 2, 'the front desk text and another coach\'s text are counted apart and tick nothing'); assert.equal(out.noFamily, 0);
  assert.equal(out.unticked, 1); const gus = db._docs.get('contacts/past-gus_2026-11-02'); assert.equal(gus.done, false); assert.equal(gus.jc.texts, 0); assert.equal(gus.source, 'justcall');   // the engine's own stale tick went back to red
  const q = captured.filter((c) => /v2\.1\/(texts|calls)/.test(c.url));
  assert.equal(q.length, 2); assert.ok(q.every((c) => c.opts.headers.Authorization === 'k:s' && /from_datetime=2026-10-28%2000%3A00%3A00&to_datetime=2026-11-05%2014%3A59%3A00/.test(c.url)), 'eight days back, up to a minute ago (ET), the key as JustCall wants it: ' + q.map((c) => c.url).join(' '));
  // Cy: ticked by JustCall from the number the coach typed on the contact check
  const cy = db._docs.get('contacts/ft-cy-l_2026-11-02');
  assert.ok(cy); assert.equal(cy.done, true); assert.equal(cy.source, 'justcall'); assert.equal(cy.how, 'text'); assert.equal(cy.by, 'Kim'); assert.equal(cy.byEmail, 'kim@example.test'); assert.deepEqual(cy.jc, { texts: 1, calls: 0, last: Date.UTC(2026, 10, 3, 19, 5, 0), by: ['Kim'] });
  // Di: the mother's answered call on Wednesday evening (8:30 PM ET on Nov 4, not Nov 5 UTC) counts; the family's own text does not add a text
  const di = db._docs.get('contacts/as-di-m_2026-11-02');
  assert.ok(di); assert.equal(di.done, true); assert.equal(di.how, 'call'); assert.equal(di.by, 'Lee'); assert.deepEqual(di.jc, { texts: 0, calls: 1, last: Date.UTC(2026, 10, 5, 1, 30, 0), by: ['Lee'] });
  // Ed shares the number: Lee said "not yet" by hand — respected, the counts kept for the record
  const ed = db._docs.get('contacts/as-ed-m_2026-11-02');
  assert.equal(ed.done, false); assert.equal(ed.source, 'coach'); assert.deepEqual(ed.jc, { texts: 0, calls: 1, last: Date.UTC(2026, 10, 5, 1, 30, 0), by: ['Lee'] });
  // Bo: the bulk text and the unanswered call did not count, and the hand tick is untouched
  const bo = db._docs.get('contacts/ft-bo-k_2026-11-02');
  assert.equal(bo.source, 'coach'); assert.equal(bo.how, 'person'); assert.equal(bo.jc, undefined);
  // last week's text lands on last week
  const diLast = db._docs.get('contacts/as-di-m_2026-10-26'); assert.ok(diLast); assert.equal(diLast.source, 'justcall'); assert.equal(diLast.week, '2026-10-26');
  // the contact check is seeded with the numbers on file for every active player, and the typed slot survives
  const bk = db._docs.get('contactCheck/ft-bo-k'); assert.ok(bk); assert.deepEqual(bk.onFile, [{ phone: '+15615550100', name: 'Pat Example', source: 'contact' }]); assert.deepEqual(bk.slots, {}); assert.equal(bk.by, 'engine');
  const ck = db._docs.get('contactCheck/ft-cy-l'); assert.equal(ck.slots.mother.phone, '+15615550199'); assert.equal(ck.onFile.length, 2);
  assert.ok(!db._docs.get('contactCheck/past-gus'), 'finished players get no card');
  assert.equal(db._docs.get('settings/contactSync').matched, 3);
  // a second run changes nothing
  const before = db._writes.length; const again = await CONTACTS.sync(db, { now: NOW }); assert.equal(again.written, 0); assert.equal(again.seeded, 0); assert.equal(db._writes.length - before, 1);   // only the summary
});

test('the Friday reminder: each coach hears who still has not heard from them, the channel gets the roll-up', async () => {
  const db = fakeDb(SEED); const captured = []; CONTACTS._useFetch(fakeNet(captured)); NOTIFY._useFetch(fakeNet(captured)); NOTIFY.forget();
  await CONTACTS.sync(db, { now: NOW });
  const out = await CONTACTS.nudge(db, { now: NOW });
  assert.equal(out.week, '2026-11-02'); assert.equal(out.total, 4); assert.equal(out.reached, 3); assert.equal(out.left, 1);   // Ed is the one still to reach ("not yet")
  assert.deepEqual(out.coaches, { Lee: 1 });
  assert.deepEqual(out.noSlack, ['Lee']);                       // Lee has no Slack link yet
  assert.equal(out.dms, 0);
  assert.match(out.summary, /3 of 4 families have heard from their coach/); assert.match(out.summary, /Still to reach: Lee 1/); assert.ok(!/—|’t\b/.test(out.summary), 'plain words: ' + out.summary);
  const posted = captured.filter((c) => /hooks\.slack\.com/.test(c.url)); assert.equal(posted.length, 1);
  // with Kim's family still open, Kim gets a DM on her own Slack
  db._docs.delete('contacts/ft-bo-k_2026-11-02');
  const out2 = await CONTACTS.nudge(db, { now: NOW });
  assert.equal(out2.dms, 1); const dm = captured.filter((c) => /chat\.postMessage/.test(c.url)).pop(); const body = JSON.parse(dm.opts.body);
  assert.equal(body.channel, 'U_KIM'); assert.match(body.text, /1 of your 2 families still have not heard from you this week: Bo K\./); assert.match(body.text, /portal#\/contact/);
});

test('the JustCall seats against the staff list', async () => {
  const db = fakeDb(SEED); const captured = []; CONTACTS._useFetch(fakeNet(captured)); NOTIFY.forget();
  const out = await CONTACTS.justcallUsers(db);
  assert.equal(out.ok, true); assert.equal(out.users.length, 2); assert.equal(out.users[0].onStaff, true); assert.equal(out.users[0].staffName, 'Kim Example');
  assert.deepEqual(out.staffWithout.map((s) => s.email), ['lee@example.test']);   // the front desk is not expected to text as a coach
});

test('what counts: outbound one-to-one texts and answered calls; the Delray Beach date decides the week', () => {
  assert.equal(CONTACTS.textCounts(TEXTS[0]).how, 'text'); assert.equal(CONTACTS.textCounts(TEXTS[1]), null); assert.equal(CONTACTS.textCounts(TEXTS[2]), null);
  assert.equal(CONTACTS.callCounts(CALLS[0]).how, 'call'); assert.equal(CONTACTS.callCounts(CALLS[1]), null);
  assert.equal(CONTACTS.etDate('2026-11-05', '01:30:00'), '2026-11-04');   // 8:30 PM the evening before in Delray Beach
  assert.equal(CONTACTS.weekOf('2026-11-08'), '2026-11-02'); assert.equal(CONTACTS.weekOf('2026-11-09'), '2026-11-09');
});
