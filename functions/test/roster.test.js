'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CAL = require('../lib/calendar');
const CAT = require('../lib/catalog');
const CHECKOUT = require('../lib/checkout');
const JOBS = require('../lib/jobs');
const ROSTER = require('../lib/roster');
const NOTIFY = require('../lib/notify');
const { fakeStripe } = require('./fake-stripe');
const { fakeDb } = require('./fake-db');

const PRICES = [];
for (const p of CAT.PROGRAMS) for (const pl of p.plans) PRICES.push({ id: 'price_' + pl.lookup, object: 'price', active: true, lookup_key: pl.lookup, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, unit_amount: pl.monthly * 100, product: p.product });
for (const [k, l] of Object.entries(CAT.oneTimeLines())) if (!l.byProduct) PRICES.push({ id: 'price_' + k, object: 'price', active: true, lookup_key: k, type: 'one_time', unit_amount: Math.round(l.price * 100), product: l.product });
const PRODUCTS = { prod_VSwrEVcItQBJ4t: { id: 'prod_VSwrEVcItQBJ4t', default_price: { id: 'price_sparring', type: 'one_time', unit_amount: 5000 } } };
const family = { player: { first: 'Ava', last: 'Torres', dob: '2014-05-02' }, parent: { name: 'Jane Torres', email: 'Jane.Torres@example.com', phone: '(561) 555-0101' }, agree: true, authorize: true };
const NOW_OCT13 = Date.UTC(2026, 9, 13, 14, 0, 0) / 1000;
const SETTINGS = { 'settings/notify': { slackCoaches: 'https://hooks.slack.com/services/T/coaches', slackDesk: 'https://hooks.slack.com/services/T/desk', justcallKey: 'k', justcallSecret: 's', justcallNumber: '+15614030008', textsOn: true } };

/* a network stand-in: every Slack post and every JustCall text is recorded */
function wire() {
  const sent = [];
  NOTIFY._useFetch(async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => '' }; });
  NOTIFY.forget();
  return sent;
}
const slackTexts = (sent, which) => sent.filter((s) => s.url.endsWith('/' + which)).map((s) => s.body.text);
const texts = (sent) => sent.filter((s) => s.url.includes('justcall')).map((s) => s.body);

async function paidProgramSession(stripe, extra) {
  await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '3', days: ['Mon', 'Wed', 'Fri'], start: '2026-10-13', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'r1' }, family, extra || {}));
  const session = stripe._db.sessions[stripe._db.sessions.length - 1];
  Object.assign(session, { status: 'complete', payment_status: 'paid', customer: stripe._db.customers[0], payment_intent: { id: 'pi_1', payment_method: 'pm_card_1' }, customer_details: { email: 'jane.torres@example.com' }, line_items: { data: [{ description: 'Afterschool start month', amount_total: 62400 }] } });
  return session;
}

test('a paid enrollment creates the player, the parent details, the note for Monday, the ledger — and tells the coaches, the desk and the family', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const db = fakeDb(SETTINGS);
  const sent = wire();
  const session = await paidProgramSession(stripe);
  const st = await CHECKOUT.sessionStatus(stripe, session.id, null, { db, mode: 'test' });
  assert.equal(st.roster.player, 'as-ava-t'); assert.equal(st.roster.created, true);
  const p = db._docs.get('players/as-ava-t');
  assert.equal(p.name, 'Ava Torres'); assert.equal(p.shortName, 'Ava T.'); assert.equal(p.group, 'as'); assert.equal(p.status, 'active'); assert.equal(p.source, 'enroll'); assert.equal(p.coach, '');
  assert.equal(p.enroll.kind, 'monthly'); assert.equal(p.enroll.program, 'afterschool'); assert.deepEqual(p.enroll.days, ['Mon', 'Wed', 'Fri']); assert.equal(p.enroll.monthly, 980); assert.equal(p.enroll.start, '2026-10-13');
  assert.equal(p.enroll.subscription, stripe._db.subscriptions[0].id); assert.deepEqual(p.enroll.next, { date: '2026-11-01', cents: 74700 }); assert.equal(p.enroll.hold, false);
  const c = db._docs.get('players/as-ava-t/private/contact');
  assert.deepEqual([c.guardian, c.email, c.phone, c.dob], ['Jane Torres', 'jane.torres@example.com', '(561) 555-0101', '2014-05-02']);
  const ob = [...db._docs.entries()].filter(([k]) => k.startsWith('outbox/')).map(([, v]) => v);
  assert.equal(ob.length, 1); assert.equal(ob[0].type, 'add'); assert.equal(ob[0].pid, 'as-ava-t'); assert.equal(ob[0].state, 'queued'); assert.equal(ob[0].first, 'Ava'); assert.equal(ob[0].last, 'Torres'); assert.equal(ob[0].group, 'as');
  assert.match(ob[0].note, /^Enrolled online on .*Afterschool · 3 Days per week · Mon\/Wed\/Fri, starts Tue Oct 13, paid \$624\. Parent: Jane Torres, \(561\) 555-0101, jane\.torres@example\.com\.$/);
  assert.ok(ob[0].note.length <= 400);
  const led = db._docs.get('enrollments/' + session.id);
  assert.equal(led.player, 'as-ava-t'); assert.equal(led.kind, 'program'); assert.equal(led.paidCents, 62400); assert.equal(led.done, true); assert.deepEqual(led.told, { coaches: true, desk: true, family: true });
  // the messages
  assert.deepEqual(slackTexts(sent, 'coaches'), ['New player: Ava Torres — Afterschool · 3 Days per week · Mon/Wed/Fri']);
  const coachBlock = sent.find((s) => s.url.endsWith('/coaches')).body.blocks[0].text.text;
  assert.match(coachBlock, /Group: Afterschool 4PM · no coach yet → assign one and run the first assessment/);
  assert.match(coachBlock, /portal#\/p\/as-ava-t\|Open Ava in the Coach Portal/);
  const deskBlock = sent.find((s) => s.url.endsWith('/desk')).body.blocks[0].text.text;
  assert.match(deskBlock, /Paid today \$624 · next \$747 on Sun Nov 1 · \$980 a month/);
  assert.match(deskBlock, /Parent: Jane Torres · \(561\) 555-0101 · jane\.torres@example\.com/);
  assert.match(deskBlock, /goes to LEADS → New Requests/);
  const t = texts(sent);
  assert.equal(t.length, 1); assert.equal(t[0].contact_number, '+15615550101'); assert.equal(t[0].justcall_number, '+15614030008');
  assert.equal(t[0].body, 'ProWorld Academy: Ava is enrolled in Afterschool, 3 days per week (Mon, Wed, Fri), starting Tue Oct 13 at 4:00 PM. Paid today: $624. Next: $747 on Sun Nov 1, then $980 on the 1st of each month. Receipts and your card: see the email from Stripe. ' + NOTIFY.SIGN);
  // the thank-you page opened again and the nightly sweep: nothing is written or sent twice
  const before = db._writes.length; sent.length = 0;
  await CHECKOUT.sessionStatus(stripe, session.id, null, { db, mode: 'test' });
  const sweep = await JOBS.convertPaidEnrollments(stripe, '2026-10-14', null, { db, mode: 'test' });
  assert.equal(db._writes.length, before); assert.equal(sent.length, 0); assert.equal(sweep.recorded.length, 0);
});

test('the same name already on the roster (from Monday) is reused — back to active, no duplicate, no second note for Monday', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const db = fakeDb(Object.assign({ 'players/as-ava-t': { name: 'Ava Torres', shortName: 'Ava T.', group: 'as', coach: 'Eric', status: 'finished', source: 'monday', mondayId: '123' } }, SETTINGS));
  const sent = wire();
  const session = await paidProgramSession(stripe);
  const rec = await ROSTER.record(db, stripe, session, await CHECKOUT.ensureEnrollment(stripe, session), { mode: 'test' });
  assert.equal(rec.player, 'as-ava-t'); assert.equal(rec.created, false);
  const p = db._docs.get('players/as-ava-t');
  assert.equal(p.status, 'active'); assert.equal(p.coach, 'Eric'); assert.equal(p.mondayId, '123'); assert.equal(p.source, 'monday'); assert.equal(p.enroll.kind, 'monthly');
  assert.equal([...db._docs.keys()].filter((k) => k.startsWith('outbox/')).length, 0);
  assert.equal([...db._docs.keys()].filter((k) => k.startsWith('players/') && !k.includes('/private/')).length, 1);
  assert.match(sent.find((s) => s.url.endsWith('/coaches')).body.blocks[0].text.text, /Coach Eric · back on the roster/);
  assert.match(sent.find((s) => s.url.endsWith('/desk')).body.blocks[0].text.text, /existing record \(Afterschool 4PM\) · Monday: already on the roster/);
});

test('one-time purchases: a camp makes a Camper, a pack a player in the program, a court alone nobody — and the ledger keeps all three', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const db = fakeDb(SETTINGS); const sent = wire();
  const buy = async (items, who, idem) => {
    await CHECKOUT.createOneTimeSession(stripe, Object.assign({}, family, { player: who, items, idempotency: idem }));
    const s = stripe._db.sessions[stripe._db.sessions.length - 1];
    Object.assign(s, { status: 'complete', payment_status: 'paid', customer: stripe._db.customers[0], payment_intent: { id: 'pi_' + idem, payment_method: 'pm_1' }, customer_details: { email: 'jane.torres@example.com' } });
    return ROSTER.record(db, stripe, s, null, { mode: 'test' });
  };
  const camp = await buy([{ lookup: 'tg26_u10_full3' }], { first: 'Leo', last: 'Torres', dob: '2018-01-01' }, 'c1');
  assert.equal(camp.player, 'camp-leo-t'); assert.equal(db._docs.get('players/camp-leo-t').group, 'camp'); assert.equal(db._docs.get('players/camp-leo-t').enroll.kind, 'camp');
  assert.equal(db._docs.get('players/camp-leo-t').purchases[0].label, 'U-10 | Thanksgiving Camp 2026 · 3 FULL DAYS');
  const pack = await buy([{ lookup: 'afterschool_fall26_flex10' }], { first: 'Mia', last: 'Torres', dob: '2013-01-01' }, 'p1');
  assert.equal(pack.player, 'as-mia-t'); assert.equal(db._docs.get('players/as-mia-t').enroll.kind, 'pack'); assert.equal(db._docs.get('players/as-mia-t').purchases[0].sessions, 10);
  const court = await buy([{ lookup: 'court_clay_nonmember', qty: 2 }], { first: 'Dad', last: 'Torres', dob: '' }, 'k1');
  assert.equal(court.player, null); assert.equal(court.what, 'Court reservation · Clay court · Non Member × 2');
  assert.equal(Object.keys(Object.fromEntries([...db._docs].filter(([k]) => k.startsWith('players/') && !k.includes('/private/')))).length, 2);
  assert.equal([...db._docs.keys()].filter((k) => k.startsWith('enrollments/')).length, 3);
  assert.deepEqual(slackTexts(sent, 'coaches'), ['Camp sign-up: Leo Torres — U-10 | Thanksgiving Camp 2026 · 3 FULL DAYS', 'New: Mia Torres — Afterschool · 10 FLEX Sessions | Tennis Only']);
  assert.equal(slackTexts(sent, 'desk').length, 3);
  assert.match(texts(sent)[0].body, /^ProWorld Academy: thank you — U-10 \| Thanksgiving Camp 2026 · 3 FULL DAYS for Leo is confirmed \(\$450\)\. See you at camp\./);
});

test('a free soccer session becomes a try-out for the front desk, with the family told', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const db = fakeDb(SETTINGS); const sent = wire();
  const out = await CHECKOUT.createOneTimeSession(stripe, Object.assign({}, family, { player: { first: 'Noa', last: 'Torres', dob: '2019-03-03' }, items: [{ lookup: 'soccer_fall26_trial' }] }));
  assert.equal(out.id, null); assert.equal(out.trial.program, 'soccer');
  const rec = await ROSTER.recordTrial(db, out.trial, { mode: 'test' });
  const t = db._docs.get('tryouts/' + rec.tryout);
  assert.equal(t.name, 'Noa Torres'); assert.equal(t.parent, 'Jane Torres'); assert.equal(t.phone, '(561) 555-0101'); assert.equal(t.status, 'planned'); assert.match(t.source, /free soccer session/); assert.match(t.notes, /Tue\/Thu 5:00–6:30 PM and Sat 9:00–10:30 AM/);
  assert.ok(db._docs.get('enrollments/trial_' + rec.tryout));
  assert.deepEqual(slackTexts(sent, 'desk'), ['Free session requested: Noa Torres']);
  assert.match(texts(sent)[0].body, /Noa's free soccer session is reserved/);
});

test('the late policy and the staff hold reach the player record and the people: hold → off the list, paid → back on', async () => {
  const mk = (id, created, extra) => Object.assign({ id, object: 'invoice', status: 'open', customer: 'cus_x', amount_due: 98000, billing_reason: 'subscription_cycle', created: CAL.unixET(created, 6, 0), hosted_invoice_url: 'https://invoice.stripe.com/i/x', parent: { subscription_details: { subscription: 'sub_x' } }, metadata: { player: 'Ava Torres' }, lines: { data: [] } }, extra || {});
  const stripe = fakeStripe({ invoices: [mk('in_nov', '2026-11-01')], subscriptions: [{ id: 'sub_x', status: 'past_due', customer: 'cus_x', metadata: { player: 'Ava Torres' }, items: { data: [] } }], customers: [{ id: 'cus_x', email: 'jane.torres@example.com', name: 'Jane Torres', phone: '+15615550101' }] });
  const db = fakeDb(Object.assign({ 'players/as-ava-t': { name: 'Ava Torres', group: 'as', status: 'active', source: 'enroll', enroll: { kind: 'monthly', programShort: 'Afterschool', subscription: 'sub_x', status: 'active', hold: false } } }, SETTINGS));
  const sent = wire(); const ctx = { db, mode: 'test' };
  await JOBS.applyLatePolicy(stripe, '2026-11-02', null, ctx);
  assert.match(texts(sent)[0].body, /the November payment for Ava's Afterschool \(\$980\) didn't go through\. Pay or update the card here: https:\/\/invoice\.stripe\.com\/i\/x/);
  assert.equal(stripe._db.invoices[0].metadata.failed_notice, '2026-11-02');
  await JOBS.applyLatePolicy(stripe, '2026-11-03', null, ctx);
  assert.equal(texts(sent).length, 1, 'the failed-payment text goes once');
  await JOBS.applyLatePolicy(stripe, '2026-11-06', null, ctx);
  assert.match(texts(sent)[1].body, /a \$50 late fee was added/);
  await JOBS.applyLatePolicy(stripe, '2026-11-10', null, ctx);
  const p = db._docs.get('players/as-ava-t');
  assert.equal(p.enroll.hold, true); assert.equal(p.enroll.holdReason, 'unpaid'); assert.equal(p.enroll.holdInvoice, 'in_nov'); assert.equal(p.status, 'active');
  assert.deepEqual(slackTexts(sent, 'coaches'), ['Training paused: Ava Torres']);
  assert.match(texts(sent)[2].body, /training is paused from today/);
  // the family pays: the next morning the hold comes off
  stripe._db.invoices[0].status = 'paid';
  const r = await JOBS.releaseHolds(stripe, '2026-11-11', null, ctx);
  assert.equal(r.released.length, 1); assert.equal(stripe._db.subscriptions[0].metadata.hold, '');
  assert.equal(db._docs.get('players/as-ava-t').enroll.hold, false);
  assert.deepEqual(slackTexts(sent, 'coaches'), ['Training paused: Ava Torres', 'Back on the list: Ava Torres']);
  assert.match(texts(sent)[3].body, /training is back on/);
  // a cancellation on the 15th finishes an online-enrolled player
  stripe._db.invoices[0].status = 'open';
  await JOBS.applyLatePolicy(stripe, '2026-11-15', null, ctx);
  const q = db._docs.get('players/as-ava-t');
  assert.equal(q.enroll.status, 'canceled'); assert.equal(q.status, 'finished');
  assert.ok(slackTexts(sent, 'coaches').includes('Spot released: Ava Torres'));
  assert.match(texts(sent)[4].body, /spot in Afterschool was released today because November tuition is still unpaid/);
  // a staff hold says who, and does not text the family
  const r2 = await ROSTER.setPlan(db, 'sub_x', { hold: true, holdReason: 'staff', holdBy: 'desk@proworldacademy.com' });
  assert.equal(r2.data.enroll.hold, true);
  await ROSTER.tell(db, 'hold', r2, { reason: 'staff', by: 'Front desk', phone: '+15615550101' });
  assert.match(sent[sent.length - 1].body.blocks[0].text.text, /by the front desk \(Front desk\)/);
  assert.equal(texts(sent).length, 5, 'a staff hold does not text the family');
});

test('the nightly roster sync follows Stripe: cancelled plans finish the player, holds and month-end cancellations show on the record', async () => {
  const db = fakeDb({
    'players/as-ava-t': { name: 'Ava Torres', status: 'active', source: 'enroll', enroll: { subscription: 'sub_a', status: 'active', hold: false, endsOn: null, next: { date: '2026-11-01', cents: 74700 } } },
    'players/ft-bo-k': { name: 'Bo K', status: 'active', source: 'monday', enroll: { subscription: 'sub_b', status: 'active', hold: false, endsOn: null, next: null } },
    'players/u10-cy-l': { name: 'Cy L', status: 'active', source: 'enroll', enroll: { subscription: 'sub_c', status: 'active', hold: false, endsOn: null, next: null } }
  });
  const r = await ROSTER.syncSubscriptions(db, [
    { id: 'sub_a', status: 'active', hold: true, cancelAtPeriodEnd: false, next: { date: '2026-11-01', cents: 74700 } },
    { id: 'sub_b', status: 'canceled', hold: false, cancelAtPeriodEnd: false, next: null },
    { id: 'sub_c', status: 'active', hold: false, cancelAtPeriodEnd: true, next: { date: '2026-12-01', cents: 0 } }
  ]);
  assert.equal(r.checked, 3); assert.deepEqual(r.updated.sort(), ['as-ava-t', 'ft-bo-k', 'u10-cy-l']); assert.deepEqual(r.finished, []);
  assert.equal(db._docs.get('players/as-ava-t').enroll.hold, true);
  assert.equal(db._docs.get('players/ft-bo-k').status, 'active', 'a Monday player is never finished by the engine');
  assert.equal(db._docs.get('players/ft-bo-k').enroll.status, 'canceled');
  assert.equal(db._docs.get('players/u10-cy-l').enroll.endsOn, '2026-12-01');
  const again = await ROSTER.syncSubscriptions(db, [{ id: 'sub_c', status: 'canceled', hold: false, cancelAtPeriodEnd: false, next: null }]);
  assert.deepEqual(again.finished, ['u10-cy-l']); assert.equal(db._docs.get('players/u10-cy-l').status, 'finished');
});

test('messages: nothing goes out without settings, texts stay off until switched on, and every text carries the automatic signature', async () => {
  const sent = wire();
  const bare = fakeDb({});
  assert.equal(await NOTIFY.slack(bare, 'coaches', 'x'), false);
  assert.equal(await NOTIFY.text(bare, '5615550101', 'x'), false);
  NOTIFY.forget();
  const off = fakeDb({ 'settings/notify': { slackDesk: 'https://hooks.slack.com/services/T/desk', justcallKey: 'k', justcallSecret: 's', textsOn: false } });
  assert.equal(await NOTIFY.slack(off, 'coaches', 'to the desk when there is no coaches hook'), true);
  assert.equal(sent[0].url, 'https://hooks.slack.com/services/T/desk');
  assert.equal(await NOTIFY.text(off, '5615550101', 'x'), false, 'texts are off');
  assert.equal(await NOTIFY.slack(off, 'coaches', 'x', ['a']), true);
  NOTIFY.forget();
  const on = fakeDb(SETTINGS);
  assert.equal(await NOTIFY.text(on, '561-555-0101', 'Hello'), true);
  const t = texts(sent)[0];
  assert.equal(t.contact_number, '+15615550101'); assert.equal(t.body, 'Hello ' + NOTIFY.SIGN);
  assert.equal(NOTIFY.e164('+1 (561) 403-0008'), '+15614030008'); assert.equal(NOTIFY.e164('15614030008'), '+15614030008'); assert.equal(NOTIFY.e164(''), '');
  const bad = fakeDb({ 'settings/notify': { slackCoaches: 'https://evil.example/hook' } });
  NOTIFY.forget();
  assert.equal(await NOTIFY.slack(bad, 'coaches', 'x'), false, 'only Slack webhooks are posted to');
});

test('the soccer catalog matches the live schedule: Tuesday, Thursday and Saturday', () => {
  const s = CAT.program('soccer');
  assert.deepEqual(s.days, ['Tue', 'Thu', 'Sat']);
  assert.equal(s.plans.find((p) => p.id === '12').days, 3);
  assert.match(s.time, /Tue\/Thu 5:00–6:30 PM · Sat 9:00–10:30 AM/);
});
