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
  // the 3-month report (Nov 2026): the goals lead, then how to get there per pillar, then the coach's note
  seed['assessments/a4'] = { playerId: 'ft-liam-r', type: 'report3m', status: 'final', sentToParents: true, period: 'Q4 2026', evalDate: '2026-10-12', coach: 'Eric Samuelsson' };
  seed['assessments/a4/body/values'] = { v: { r_goals: 'Serve a full game without a double fault.', r_tennis: 'Toss higher, same rhythm every time.', r_fitness: 'Two mobility sessions a week.', r_mental: 'Reset between points.', r_comp: 'Two L5 tournaments before Christmas.', s_parents: 'A great start to the quarter.' } };
  const db = fakeDb(seed);
  const maria = await FAMILY.me(db, fakeStripe({ prices: PRICES }), { email: 'maria.rivera@example.com', name: 'Maria' }, { today: '2026-10-13' });
  const liam = maria.players.find((p) => p.name === 'Liam Rivera'); const mia = maria.players.find((p) => p.name === 'Mia Rivera');
  assert.equal(liam.attendance.month, 'Oct 2026');
  assert.equal(liam.attendance.present, 1);
  assert.equal(liam.attendance.missed, 0);
  assert.equal(mia.attendance.missed, 1);
  assert.equal(liam.reports.length, 2);
  const r3 = liam.reports.find((x) => x.type === 'report3m');
  assert.equal(r3.title, '3-Month Report');
  assert.deepEqual(r3.notes.map((n) => n.id), ['goals', 'tennis', 'fitness', 'mental', 'competition', 'parents']);
  assert.equal(r3.notes[0].label, 'The goals for the next 3 months'); assert.equal(r3.notes[0].text, 'Serve a full game without a double fault.');
  const r = liam.reports.find((x) => x.type === 'quarterly_hp');
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

/* ── the schedule and the messages of the client account (Nov 17, 2026) ── */
function seedClient() {
  const db = fakeDb(Object.assign(seedRoster(), {
    'staff/kam@example.com': { name: 'Kamryn Taub', role: 'coach', active: true, justcallNumber: '+15615550900' },
    'staff/lee@example.com': { name: 'Lee Coach', role: 'coach', active: true },
    'staff/dir@example.com': { name: 'Nico Director', role: 'director', coachAs: 'Nico', active: true },
    'staff/other@example.com': { name: 'Tonio Director', role: 'director', coachAs: 'Tonio', active: true }
  }));
  return db;
}
test('two weeks away go on the schedule as one day per training day; a make-up day needs a day missed; both can be undone', async () => {
  const sent = wire(); const db = seedClient();
  await db.doc('players/as-mia-r').set({ enroll: { program: 'afterschool', days: ['Tue', 'Thu'], subscription: 'sub_1' } }, { merge: true });
  const who = { email: 'maria.rivera@example.com', name: 'Maria Rivera' }; const today = '2026-11-17';
  const { players } = await FAMILY.findPlayers(db, null, who.email);
  await assert.rejects(() => FAMILY.days(db, who, { player: 'as-mia-r', action: 'makeup', date: '2026-11-18' }, players, { today }), /goes with a day missed/);
  const out = await FAMILY.days(db, who, { player: 'as-mia-r', action: 'away', from: '2026-11-17', to: '2026-11-30' }, players, { today });
  assert.ok(out.dates.length >= 2 && out.dates.every((d) => ['Tue', 'Thu'].includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T12:00:00Z').getUTCDay()])));
  assert.equal(out.dates[0], '2026-11-17');
  assert.ok(sent.some((x) => /desk/.test(x.url) && /Away/.test(JSON.stringify(x.body)) && /Mia Rivera/.test(JSON.stringify(x.body))));
  // the directors of the group hear it in the Locker Room: Afterschool is Nico and Kamryn, not Tonio
  const dm = (await db.collection('teamChats').get()).docs.map((d) => d.data()).filter((c) => c.bot && c.members.includes('dir@example.com'));
  assert.equal(dm.length, 1); assert.match(dm[0].last.text, /Mia Rivera.*cannot make it/);
  assert.equal((await db.collection('teamChats').get()).docs.some((d) => (d.data().members || []).includes('other@example.com')), false);
  assert.equal((await db.collection('teamChats').get()).docs.some((d) => (d.data().members || []).includes('kam@example.com')), true);
  let me = await FAMILY.me(db, null, who, { today }); let mia = me.players.find((p) => p.id === 'as-mia-r');
  assert.equal(mia.days.filter((d) => d.kind === 'away').length, out.dates.length);
  assert.equal(mia.makeupsLeft, out.dates.length);
  await assert.rejects(() => FAMILY.days(db, who, { player: 'as-mia-r', action: 'makeup', date: '2026-12-03' }, players, { today }), /already trains/);
  await assert.rejects(() => FAMILY.days(db, who, { player: 'as-mia-r', action: 'makeup', date: '2026-12-05' }, players, { today }), /no session/);   // a Saturday
  await FAMILY.days(db, who, { player: 'as-mia-r', action: 'makeup', date: '2026-12-02' }, players, { today });
  me = await FAMILY.me(db, null, who, { today }); mia = me.players.find((p) => p.id === 'as-mia-r');
  assert.equal(mia.days.filter((d) => d.kind === 'makeup').length, 1); assert.equal(mia.makeupsLeft, out.dates.length - 1);
  await FAMILY.days(db, who, { player: 'as-mia-r', action: 'back', date: '2026-11-17' }, players, { today });
  await FAMILY.days(db, who, { player: 'as-mia-r', action: 'nomakeup', date: '2026-12-02' }, players, { today });
  me = await FAMILY.me(db, null, who, { today }); mia = me.players.find((p) => p.id === 'as-mia-r');
  assert.equal(mia.days.some((d) => d.date === '2026-11-17'), false); assert.equal(mia.days.some((d) => d.kind === 'makeup'), false);
  await assert.rejects(() => FAMILY.days(db, who, { player: 'as-mia-r', action: 'away', date: '2026-11-10' }, players, { today }), /passed/);
  await assert.rejects(() => FAMILY.days(db, who, { player: 'u10-noah-k', action: 'away', date: '2026-11-19' }, players, { today }), /Which player/);   // another family's player
});
test('a message to a coach lands in that coach\'s chat and nobody else\'s; the answer shows to the parent; Admin is a request with no staff name', async () => {
  const sent = wire(); const db = seedClient(); const COACHTEXT = require('../lib/coachtext'); COACHTEXT._seats({});
  const who = { email: 'maria.rivera@example.com', name: 'Maria Rivera' };
  const { players } = await FAMILY.findPlayers(db, null, who.email);
  const me = await FAMILY.me(db, null, who, { today: '2026-11-17' });
  assert.deepEqual(me.players.find((p) => p.id === 'as-mia-r').coaches, [{ key: 'kamryn', name: 'Kamryn' }]);
  const out = await FAMILY.message(db, who, { player: 'as-mia-r', to: 'kamryn', text: 'Mia has a school trip on Thursday.' }, players);
  assert.equal(out.reached, 1);
  const kam = { email: 'kam@example.com', name: 'Kamryn Taub', keys: ['kamryn'], justcallNumber: '+15615550900' };
  const lee = { email: 'lee@example.com', name: 'Lee Coach', keys: ['lee'], director: true };
  const t = await COACHTEXT.thread(db, kam, 'as-mia-r', { markRead: false });
  assert.ok(t.lines.some((l) => l.dir === 'in' && /school trip/.test(l.body) && l.note === 'from the app'));
  const t2 = await COACHTEXT.thread(db, lee, 'as-mia-r', { markRead: false });
  assert.equal(t2.lines.some((l) => /school trip/.test(l.body)), false);
  // the coach answers by text from the portal: the parent reads it in the same chat
  await db.collection('smsLog').doc().set({ at: Date.now() + 5, by: 'kam@example.com', byName: 'Kamryn Taub', player: 'as-mia-r', phone: '+15615550102', body: 'Thank you, see her Tuesday.\n- Coach Kamryn, ProWorld Academy', status: 'sent', from: 'portal', line: '+15615550900' });
  const c = await FAMILY.chat(db, who, { player: 'as-mia-r', to: 'kamryn' }, players);
  assert.deepEqual(c.lines.map((l) => [l.dir, l.body]), [['me', 'Mia has a school trip on Thursday.'], ['them', 'Thank you, see her Tuesday.']]);
  assert.equal(c.lines[1].by, 'Coach Kamryn');
  // a coach with no sign-in: the front desk passes it on, and the parent still sees what she wrote
  const o2 = await FAMILY.message(db, who, { player: 'ft-liam-r', to: 'eric', text: 'Can Liam bring his own racket?' }, players);
  assert.equal(o2.passed, 1);
  assert.ok(sent.some((x) => /Message for Coach Eric/.test(JSON.stringify(x.body))));
  assert.equal((await FAMILY.chat(db, who, { player: 'ft-liam-r', to: 'eric' }, players)).lines[0].body, 'Can Liam bring his own racket?');
  await assert.rejects(() => FAMILY.message(db, who, { player: 'as-mia-r', to: 'eric', text: 'x' }, players), /Who is this for/);   // not her coach
  // Admin
  await FAMILY.message(db, who, { to: 'admin', text: 'Can we move the payment date?' }, players);
  const a = await FAMILY.chat(db, who, { to: 'admin' }, players);
  assert.equal(a.title, 'Admin'); assert.equal(a.lines[0].body, 'Can we move the payment date?');
  assert.ok(sent.some((x) => /Registration and billing/.test(JSON.stringify(x.body))));
});

test('a player brought over from Play by Point shows the calendar and a Renew card; a plan we do not sell online goes to Admin', async () => {
  wire(); const db = seedClient(); const who = { email: 'maria.rivera@example.com', name: 'Maria Rivera' };
  await db.doc('players/as-mia-r').set({ enroll: { programName: 'Afterschool | Fall 2026', programShort: 'Afterschool', days: ['Tue', 'Thu'], pbp: { plan: '2 Days per week | Monthly', bySession: false } } }, { merge: true });
  await db.doc('players/ft-liam-r').set({ enroll: { programName: 'Afterschool | Fall 2026', programShort: 'Afterschool', days: ['Wed'], pbp: { plan: '1 Day / week', bySession: false } } }, { merge: true });
  const me = await FAMILY.me(db, null, who, { today: '2026-11-18' });
  const mia = me.players.find((p) => p.id === 'as-mia-r'); const liam = me.players.find((p) => p.id === 'ft-liam-r');
  assert.deepEqual(mia.enroll.days, ['Tue', 'Thu']);
  assert.deepEqual([mia.renew.online, mia.renew.program, mia.renew.plan, mia.renew.start, mia.renew.month, mia.renew.days.join(',')], [true, 'afterschool', '2', '2026-12-01', 'December', 'Tue,Thu']);
  assert.equal(liam.renew.online, false);
  await db.doc('players/as-mia-r').set({ enroll: { subscription: 'sub_1' } }, { merge: true });
  assert.equal((await FAMILY.me(db, null, who, { today: '2026-11-18' })).players.find((p) => p.id === 'as-mia-r').renew, null);
});

test('a by-the-session player books sessions of a day; a monthly player cannot; a parent adds a number the coaches then see', async () => {
  const sent = wire(); const db = seedClient(); const who = { email: 'maria.rivera@example.com', name: 'Maria Rivera' }; const today = '2026-11-18';
  await db.doc('players/ft-liam-r').set({ enroll: { programName: 'Full Time Program | Fall 2026', pbp: { plan: '10 FLEX Sessions | Tennis Only', bySession: true } } }, { merge: true });
  await db.doc('players/as-mia-r').set({ enroll: { program: 'afterschool', days: ['Tue', 'Thu'], subscription: 'sub_1' } }, { merge: true });
  const { players } = await FAMILY.findPlayers(db, null, who.email);
  let me = await FAMILY.me(db, null, who, { today }); let liam = me.players.find((p) => p.id === 'ft-liam-r');
  assert.equal(liam.flex, true); assert.deepEqual(liam.sessions.map((x) => x.id), ['ft1', 'ft2', 'pm2', 'as']);
  assert.equal(me.players.find((p) => p.id === 'as-mia-r').flex, false);
  await FAMILY.days(db, who, { player: 'ft-liam-r', action: 'book', date: '2026-11-19', sessions: ['ft1', 'as', 'nope'] }, players, { today });
  liam = (await FAMILY.me(db, null, who, { today })).players.find((p) => p.id === 'ft-liam-r');
  assert.deepEqual(liam.days, [{ date: '2026-11-19', kind: 'book', sessions: ['ft1', 'as'] }]);
  assert.ok(sent.some((x) => /Session booked/.test(JSON.stringify(x.body)) && /7:45 AM/.test(JSON.stringify(x.body))));
  await FAMILY.days(db, who, { player: 'ft-liam-r', action: 'book', date: '2026-11-19', sessions: [] }, players, { today });
  assert.deepEqual((await FAMILY.me(db, null, who, { today })).players.find((p) => p.id === 'ft-liam-r').days, []);
  await assert.rejects(() => FAMILY.days(db, who, { player: 'as-mia-r', action: 'book', date: '2026-11-19', sessions: ['as'] }, players, { today }), /fixed training days/);
  await assert.rejects(() => FAMILY.days(db, who, { player: 'ft-liam-r', action: 'book', date: '2026-11-21', sessions: ['ft1'] }, players, { today }), /no session/);   // a Saturday
  // another number on the player's messages
  await assert.rejects(() => FAMILY.people(db, who, { player: 'as-mia-r', name: 'Dad', phone: '555' }, players), /mobile number/);
  const out = await FAMILY.people(db, who, { player: 'as-mia-r', name: 'Dad', phone: '(561) 555-0177' }, players);
  assert.deepEqual(out.people, [{ name: 'Dad', tail: '0177' }]);
  const nums = await require('../lib/coachtext').numbersOf(db, 'as-mia-r');
  assert.ok(nums.numbers.some((n) => n.phone === '+15615550177' && n.name === 'Dad'));
  assert.deepEqual((await FAMILY.me(db, null, who, { today })).players.find((p) => p.id === 'as-mia-r').people, [{ name: 'Dad', tail: '0177' }]);
  assert.deepEqual((await FAMILY.people(db, who, { player: 'as-mia-r', remove: '0177', name: 'Dad' }, players)).people, []);
});

test('each coach and Admin can be reached from the family\'s own phone: the coach\'s academy number and e-mail, the academy line for Admin', async () => {
  wire(); const db = seedClient(); require('../lib/coachtext')._seats({});
  const me = await FAMILY.me(db, null, { email: 'maria.rivera@example.com', name: 'Maria Rivera' }, { today: '2026-11-18' });
  assert.deepEqual(me.ways.admin, { sms: '+15614030008', email: 'info@proworldacademy.com', whatsapp: '' });
  assert.deepEqual(me.ways.coaches.kamryn, { sms: '+15615550900', own: true, email: 'kam@example.com', whatsapp: '' });
  assert.equal(me.ways.coaches.eric.sms, '+15614030008'); assert.equal(me.ways.coaches.eric.own, false);   // no sign-in yet: the academy line
});
