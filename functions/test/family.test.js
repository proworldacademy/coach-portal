'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CAT = require('../lib/catalog');
const CHECKOUT = require('../lib/checkout');
const ROSTER = require('../lib/roster');
const NOTIFY = require('../lib/notify');
const FEED = require('../lib/feed');
const FAMILY = require('../lib/family');
const { fakeStripe } = require('./fake-stripe');
const { fakeDb } = require('./fake-db');

const PRICES = [];
for (const p of CAT.PROGRAMS) for (const pl of p.plans) PRICES.push({ id: 'price_' + pl.lookup, object: 'price', active: true, lookup_key: pl.lookup, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, unit_amount: pl.monthly * 100, product: p.product });
for (const [k, l] of Object.entries(CAT.oneTimeLines())) if (!l.byProduct) PRICES.push({ id: 'price_' + k, object: 'price', active: true, lookup_key: k, type: 'one_time', unit_amount: Math.round(l.price * 100), product: l.product });
const NOW_OCT13 = Date.UTC(2026, 9, 13, 14, 0, 0) / 1000;
const KEY = 'feed-key-that-is-long-enough-0123456789';
const SETTINGS = { 'settings/notify': { slackCoaches: 'https://hooks.slack.com/services/T/coaches', slackDesk: 'https://hooks.slack.com/services/T/desk', textsOn: false, rosterKey: KEY } };
const family = { player: { first: 'Ava', last: 'Torres', dob: '2014-05-02' }, parent: { name: 'Jane Torres', email: 'Jane.Torres@example.com', phone: '(561) 555-0101' }, agree: true, authorize: true };

function wire() { const sent = []; NOTIFY._useFetch(async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => '' }; }); NOTIFY.forget(); FEED.forget(); return sent; }

/* a roster as the Monday sync and the front desk leave it: players with a parent under private/contact */
function seedRoster() {
  return Object.assign({
    'players/ft-liam-r': { name: 'Liam Rivera', shortName: 'Liam R.', group: 'ft', coach: 'Eric Samuelsson', status: 'active', source: 'monday', createdAt: 1 },
    'players/ft-liam-r/private/contact': { guardian: 'Maria Rivera', email: 'maria.rivera@example.com', phone: '5615550102', source: 'monday' },
    'players/as-mia-r': { name: 'Mia Rivera', shortName: 'Mia R.', group: 'as', coach: 'Kamryn Taub', status: 'active', source: 'coach', createdAt: 2 },
    'players/as-mia-r/private/contact': { guardian: 'Maria Rivera', email: 'maria.rivera@example.com', phone: '5615550102' },
    'players/u10-noah-k': { name: 'Noah Kim', group: 'u10', coach: '', status: 'away', source: 'monday' },
    'players/u10-noah-k/private/contact': { guardian: 'Dan Kim', email: 'dan.kim@example.com', phone: '' },
    'players/ft-old-p': { name: 'Old Player', group: 'ft', status: 'finished', source: 'monday' },
    'tryouts/t1': { name: 'Try Out', status: 'planned' }
  }, SETTINGS);
}

async function paidEnrollment(stripe, db) {
  await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '3', days: ['Mon', 'Wed', 'Fri'], start: '2026-10-13', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'f1' }, family));
  const session = stripe._db.sessions[stripe._db.sessions.length - 1];
  Object.assign(session, { status: 'complete', payment_status: 'paid', customer: stripe._db.customers[0], payment_intent: { id: 'pi_1', payment_method: 'pm_card_1' }, customer_details: { email: 'jane.torres@example.com' }, line_items: { data: [{ description: 'Afterschool start month', amount_total: 62400 }] } });
  const sub = await CHECKOUT.ensureEnrollment(stripe, session, () => {});
  const rec = await ROSTER.record(db, stripe, session, sub, { log: () => {}, mode: 'test' });
  return { session, sub, rec };
}

test('the roster feed: every player once with the parent attached, Monday-style status words, and rows the concierge can read', async () => {
  wire();
  const db = fakeDb(seedRoster());
  const stripe = fakeStripe({ prices: PRICES });
  await paidEnrollment(stripe, db);                      // Ava Torres, enrolled online, starting Oct 13
  const feed = await FEED.roster(db, { fresh: true });
  assert.equal(feed.source, 'proworld-backend');
  assert.equal(feed.counts.players, 5);                  // four seeded players + Ava; the try-out is not a family
  const byName = Object.fromEntries(feed.players.map((p) => [p.name, p]));
  assert.equal(byName['Liam Rivera'].parent.email, 'maria.rivera@example.com');
  assert.equal(byName['Liam Rivera'].statusWord, 'Active');
  assert.equal(byName['Noah Kim'].statusWord, 'Away');
  assert.equal(byName['Old Player'].statusWord, 'Finished');
  assert.equal(byName['Ava Torres'].parent.name, 'Jane Torres');
  assert.equal(byName['Ava Torres'].enroll.programName, 'Afterschool | Fall 2026');
  assert.deepEqual(byName['Ava Torres'].enroll.days, ['Mon', 'Wed', 'Fri']);
  const row = feed.rows.find((r) => r.name === 'Ava Torres');
  assert.equal(row.group, 'Active');
  assert.equal(row.columns.Phone, '(561) 555-0101');
  assert.equal(row.columns.Email, 'jane.torres@example.com');
  assert.equal(feed.counts.withEmail, 4);                 // Old Player has no contact on file
});

test('the roster feed refuses a missing or wrong key, and is off until an owner sets one', async () => {
  wire();
  const db = fakeDb(seedRoster());
  await assert.rejects(FEED.requireKey(db, { headers: {}, query: {} }), (e) => e.status === 401);
  await assert.rejects(FEED.requireKey(db, { headers: { 'x-roster-key': 'short' }, query: {} }), (e) => e.status === 401);
  await FEED.requireKey(db, { headers: {}, query: { key: KEY } });
  await FEED.requireKey(db, { headers: { 'x-roster-key': KEY }, query: {} });
  const off = fakeDb({ 'settings/notify': {} });
  await assert.rejects(FEED.requireKey(off, { headers: {}, query: { key: KEY } }), (e) => e.status === 503);
  assert.ok(FEED.newKey().length >= FEED.MIN_KEY);
});

test('a parent signs in and sees exactly her players — by the e-mail on the roster and by her Stripe account', async () => {
  wire();
  const db = fakeDb(seedRoster());
  const stripe = fakeStripe({ prices: PRICES });
  await paidEnrollment(stripe, db);
  // Maria: two players on the roster from Monday and a coach, no Stripe yet
  const maria = await FAMILY.me(db, stripe, { email: 'maria.rivera@example.com', name: 'Maria Rivera' }, { today: '2026-10-13' });
  assert.deepEqual(maria.players.map((p) => p.name), ['Liam Rivera', 'Mia Rivera']);
  assert.equal(maria.players[0].coach, 'Eric');                       // first names only
  assert.equal(maria.players[0].groupLabel, 'Full Time');
  assert.equal(maria.players[0].enroll, null);                        // nothing through the engine yet
  assert.equal(maria.billing.customers.length, 0);
  assert.equal(maria.known, true);
  // Jane: enrolled online — found through the roster contact and through the Stripe customer
  const jane = await FAMILY.me(db, stripe, { email: 'jane.torres@example.com', name: '' }, { today: '2026-10-13' });
  assert.deepEqual(jane.players.map((p) => p.name), ['Ava Torres']);
  assert.equal(jane.players[0].enroll.programShort, 'Afterschool');
  assert.deepEqual(jane.players[0].enroll.days, ['Mon', 'Wed', 'Fri']);
  assert.equal(jane.billing.customers.length, 1);
  assert.equal(jane.billing.subscriptions.length, 1);
  assert.equal(jane.billing.subscriptions[0].plan, '3 Days per week');
  assert.equal(jane.name, 'Jane Torres');                             // from the Stripe customer when the sign-in has no name
  // a stranger sees nothing
  const nobody = await FAMILY.me(db, stripe, { email: 'nobody@example.com', name: 'No One' }, { today: '2026-10-13' });
  assert.equal(nobody.players.length, 0);
  assert.equal(nobody.known, false);
});

test('attendance comes from the posted lists only; reports only when final and marked sent', async () => {
  wire();
  const seed = seedRoster();
  seed['sheets/2026-10-05_s1'] = { date: '2026-10-05', sid: 's1', posted: '4:10 PM', courts: { 1: [{ pid: 'ft-liam-r', present: true }, { pid: 'as-mia-r', present: false }] }, recon: { noshow: ['as-mia-r'] } };
  seed['sheets/2026-10-07_s1'] = { date: '2026-10-07', sid: 's1', posted: null, courts: { 1: [{ pid: 'ft-liam-r', present: true }] } };     // not posted: nothing counts
  seed['sheets/2026-09-30_s1'] = { date: '2026-09-30', sid: 's1', posted: '4:00 PM', courts: { 1: [{ pid: 'ft-liam-r', present: true }] } }; // last month
  seed['assessments/a1'] = { playerId: 'ft-liam-r', type: 'quarterly_hp', status: 'final', sentToParents: true, period: 'Q4 2026', evalDate: '2026-10-10', coach: 'Eric Samuelsson' };
  seed['assessments/a1/body/values'] = { v: { sc_tennis: 7, sc_fitness: 6, sc_overall: 7, p_strengths: 'Great footwork.', tk_f1: 'Serve toss', tk_f2: 'Backhand depth', s_parents: 'Proud of Liam this quarter.', ft_10m: '1.9' } };
  seed['assessments/a2'] = { playerId: 'ft-liam-r', type: 'monthly', status: 'final', sentToParents: false, period: 'Oct 2026', evalDate: '2026-10-12' };
  seed['assessments/a3'] = { playerId: 'ft-liam-r', type: 'monthly', status: 'draft', sentToParents: true, period: 'Nov 2026', evalDate: '2026-11-01' };
  const db = fakeDb(seed);
  const maria = await FAMILY.me(db, fakeStripe({ prices: PRICES }), { email: 'maria.rivera@example.com', name: 'Maria' }, { today: '2026-10-13' });
  const liam = maria.players.find((p) => p.name === 'Liam Rivera'); const mia = maria.players.find((p) => p.name === 'Mia Rivera');
  assert.equal(liam.attendance.month, 'Oct 2026');
  assert.equal(liam.attendance.present, 1);
  assert.equal(liam.attendance.missed, 0);
  assert.equal(mia.attendance.missed, 1);
  assert.equal(liam.reports.length, 1);
  const r = liam.reports[0];
  assert.equal(r.title, 'Quarterly Player Assessment');
  assert.equal(r.coach, 'Eric');
  assert.deepEqual(r.scores, { tennis: 7, fitness: 6, overall: 7 });
  assert.deepEqual(r.focus, ['Serve toss', 'Backhand depth']);
  assert.equal(r.notes.find((n) => n.id === 'parents').text, 'Proud of Liam this quarter.');
  assert.ok(!JSON.stringify(r).includes('1.9'));                      // raw test metrics stay with the coaches
});

test('a request to the front desk is filed under the family and posted to the desk channel; the family then sees it', async () => {
  const sent = wire();
  const db = fakeDb(seedRoster());
  const who = { email: 'maria.rivera@example.com', name: 'Maria Rivera' };
  const { players } = await FAMILY.findPlayers(db, null, who.email);
  const out = await FAMILY.request(db, who, { kind: 'court', player: 'ft-liam-r', text: 'Court for an hour on Saturday morning', when: 'Sat 9 AM', phone: '561-555-0102' }, players);
  assert.equal(out.kind, 'court');
  const desk = sent.filter((s) => s.url.endsWith('/desk'));
  assert.equal(desk.length, 1);
  assert.match(desk[0].body.text, /Family request — Court reservation\* — Liam Rivera/);
  await assert.rejects(FAMILY.request(db, who, { kind: 'message', text: '' }, players), (e) => e.code === 'text');
  const me = await FAMILY.me(db, null, who, { today: '2026-10-13' });
  assert.equal(me.requests.length, 1);
  assert.equal(me.requests[0].kindLabel, 'Court reservation');
  assert.equal(me.requests[0].state, 'open');
});

test('only a confirmed e-mail sign-in gets in', async () => {
  const verify = (claims) => async () => claims;
  const req = (t) => ({ headers: { authorization: 'Bearer ' + t } });
  const who = await FAMILY.requireFamily(req('ok'), { verify: verify({ uid: 'u1', email: 'Jane@Example.com', email_verified: true, name: 'Jane', firebase: { sign_in_provider: 'google.com' } }) });
  assert.equal(who.email, 'jane@example.com');
  await assert.rejects(FAMILY.requireFamily(req('x'), { verify: verify({ uid: 'u2', email: 'a@b.co', email_verified: false }) }), (e) => e.code === 'verified');
  await assert.rejects(FAMILY.requireFamily({ headers: {} }, { verify: verify({}) }), (e) => e.code === 'signin');
  await assert.rejects(FAMILY.requireFamily(req('bad'), { verify: async () => { throw new Error('expired'); } }), (e) => e.code === 'token');
});
