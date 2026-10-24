'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const CAL = require('../lib/calendar');
const CAT = require('../lib/catalog');
const S = require('../lib/stripe');
const CHECKOUT = require('../lib/checkout');
const JOBS = require('../lib/jobs');
const { fakeStripe } = require('./fake-stripe');

/* The published examples in backend/BILLING-RULES.md (Afterschool · 3 days · $980) */
test('training-day calendar matches the published 2026–27 table', () => {
  const t = (y, m) => CAL.monthFactor(y, m);
  assert.deepEqual([t(2026, 9).trainingDays, t(2026, 9).weekdays], [22, 22]);
  assert.deepEqual([t(2026, 10).trainingDays, t(2026, 10).weekdays], [16, 21]);
  assert.deepEqual([t(2026, 11).trainingDays, t(2026, 11).weekdays], [14, 23]);
  assert.deepEqual([t(2027, 0).trainingDays, t(2027, 0).weekdays], [19, 21]);
  assert.deepEqual([t(2027, 1).trainingDays, t(2027, 1).weekdays], [20, 20]);
  assert.deepEqual([t(2027, 2).trainingDays, t(2027, 2).weekdays], [18, 23]);
  assert.deepEqual([t(2027, 3).trainingDays, t(2027, 3).weekdays], [22, 22]);
  assert.deepEqual([t(2027, 4).trainingDays, t(2027, 4).weekdays], [19, 21]);
  assert.equal(t(2027, 5).trainingDays, 0); assert.equal(t(2027, 6).trainingDays, 0);
  const P = 98000;
  assert.equal(CAL.monthChargeCents(P, 2026, 10, 1), 74700);   // Nov $747
  assert.equal(CAL.monthChargeCents(P, 2026, 11, 1), 59700);   // Dec $597
  assert.equal(CAL.monthChargeCents(P, 2027, 0, 1), 88700);    // Jan $887
  assert.equal(CAL.monthChargeCents(P, 2027, 2, 1), 76700);    // Mar $767
  assert.equal(CAL.monthChargeCents(P, 2027, 4, 1), 88700);    // May $887
  assert.equal(CAL.monthCreditCents(P, 2026, 10), 23300);
});

test('a mid-month start pays the remaining training days of the month, then the 1st', () => {
  const q = CAL.firstMonthQuote(98000, '2026-10-13');
  assert.equal(q.cents, 62400);                                   // Oct 13 start → $624 (14 of 22)
  assert.equal(q.anchor, '2026-11-01');
  assert.equal(new Date(q.anchorUnix * 1000).toISOString(), '2026-11-01T11:00:00.000Z');   // 06:00 Delray Beach = 11:00 UTC (EDT ends Nov 1 at 2 AM → EST)
  assert.equal(q.next.cents, 74700);
  const w = CAL.firstMonthQuote(98000, '2026-12-19');             // a start in a break rolls to the first training day
  assert.equal(w.start, '2027-01-05'); assert.equal(w.cents, 88700); assert.equal(w.anchor, '2027-02-01');
  const s = CAL.firstMonthQuote(98000, '2026-11-01');             // the 1st itself: the whole month, break-adjusted, as the one-time line
  assert.equal(s.cents, 74700); assert.equal(s.anchor, '2026-12-01');
});

test('time zone helpers are DST-safe', () => {
  assert.equal(new Date(CAL.unixET('2027-03-01', 6, 0) * 1000).toISOString(), '2027-03-01T11:00:00.000Z');   // EST
  assert.equal(new Date(CAL.unixET('2027-07-01', 6, 0) * 1000).toISOString(), '2027-07-01T10:00:00.000Z');   // EDT
  assert.equal(CAL.dateOfUnixET(CAL.unixET('2026-11-01', 6, 0)), '2026-11-01');
  assert.equal(CAL.dateOfUnixET(CAL.unixET('2026-11-01', 0, 30)), '2026-11-01');
});

test('functions/billing-rules.json is the same file as backend/billing-rules.json', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'billing-rules.json'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'billing-rules.json'), 'utf8');
  assert.equal(a, b, 'copy backend/billing-rules.json into functions/ (the deploy only ships the functions folder)');
});

test('functions/index.js parses (it is never required by the tests, so a stray comment or brace would only show at deploy)', () => {
  require('child_process').execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'index.js')], { stdio: 'pipe' });
});

test('every catalog line has a lookup key and the lines are unique', () => {
  const lines = CAT.oneTimeLines();
  assert.equal(Object.keys(lines).length, 113);                                              // 94 Play by Point lines + the $1 test private + 18 winter camp lines
  for (const p of CAT.PROGRAMS) for (const pl of p.plans) if (!pl.every) assert.match(pl.lookup, /_monthly$/);
  assert.equal(lines['lesson_tester_1p_60m'].price, 1); assert.equal(lines['lesson_tester_1p_60m'].qbo, 'Test');
  assert.ok(lines['tg26_u10_saturday_dropin'] && lines['tg26_u10_saturday_dropin'].price === 60);
  assert.ok(lines['sparring_1p_60m'].byProduct);
});

/* ── checkout ── */
const PRICES = [];
for (const p of CAT.PROGRAMS) for (const pl of p.plans) { const c = CAT.cycleOf(pl); PRICES.push({ id: 'price_' + pl.lookup, object: 'price', active: true, lookup_key: pl.lookup, type: 'recurring', recurring: { interval: c.interval, interval_count: c.count }, unit_amount: pl.monthly * 100, product: p.product }); }
for (const [k, l] of Object.entries(CAT.oneTimeLines())) if (!l.byProduct) PRICES.push({ id: 'price_' + k, object: 'price', active: true, lookup_key: k, type: 'one_time', unit_amount: Math.round(l.price * 100), product: l.product });
const PRODUCTS = { prod_VSwrEVcItQBJ4t: { id: 'prod_VSwrEVcItQBJ4t', default_price: { id: 'price_sparring', type: 'one_time', unit_amount: 5000 } } };
const family = { player: { first: 'Ava', last: 'Torres', dob: '2014-05-02' }, parent: { name: 'Jane Torres', email: 'Jane.Torres@example.com', phone: '(561) 555-0101' }, agree: true, authorize: true };

const NOW_OCT13 = Date.UTC(2026, 9, 13, 14, 0, 0) / 1000;                                   // Oct 13, 2026 10:00 Delray Beach

test('monthly enrollment: the start month is a plain payment that saves the card; the plan is created on the next 1st with no proration', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const out = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '3', days: ['Mon', 'Wed', 'Fri'], start: '2026-10-13', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'abc' }, family));
  assert.match(out.url, /^https:\/\/checkout\.stripe\.com\//);
  const call = stripe._calls.find((c) => c.name === 'checkout.sessions.create');
  const p = call.args.params;
  assert.equal(p.mode, 'payment');                                                          // no subscription at checkout → no "trial" anywhere
  assert.equal(p.line_items.length, 1);
  assert.deepEqual(p.line_items[0].price_data, { currency: 'usd', product: 'pw_firstmonth_afterschool', unit_amount: 62400 });
  assert.equal(p.payment_intent_data.setup_future_usage, 'off_session');
  assert.equal(p.invoice_creation.enabled, true);
  assert.equal(p.metadata.kind, 'program'); assert.equal(p.metadata.days, 'Mon,Wed,Fri'); assert.equal(p.metadata.player, 'Ava Torres');
  assert.equal(new Date(parseInt(p.metadata.anchor, 10) * 1000).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(p.metadata.price, 'price_afterschool_fall26_3d_monthly');
  assert.equal(p.customer, stripe._db.customers[0].id);
  assert.equal(stripe._db.customers[0].email, 'jane.torres@example.com');
  assert.ok(p.custom_text.submit.message.startsWith('Due today: October tuition (prorated: 14 of 22 training days, from Oct 13). Then $747 on Nov 1'));
  assert.ok(p.custom_text.submit.message.includes('$50 late fee'));
  assert.ok(p.custom_text.submit.message.length <= 1200);
  assert.equal(call.args.opts.idempotencyKey, 'enroll_abc');
  assert.equal(out.quote.mode, 'charge'); assert.equal(out.quote.dueCents, 62400);
  assert.match(out.quote.then, /^Then \$747 on Nov 1 \(16 of 21 training days · thanksgiving break off\), and \$980 on the 1st of every month after/);

  // Stripe confirms the payment (the family lands on the thank-you page): the plan is created on the saved card.
  const session = stripe._db.sessions[0];
  Object.assign(session, { status: 'complete', payment_status: 'paid', customer: stripe._db.customers[0], payment_intent: { id: 'pi_1', payment_method: 'pm_card_1' }, line_items: { data: [{ description: 'Afterschool | Fall 2026 — start month (prorated by training days)', amount_total: 62400 }] }, customer_details: { email: 'jane.torres@example.com' } });
  const st = await CHECKOUT.sessionStatus(stripe, session.id);
  assert.equal(st.status, 'complete'); assert.equal(st.paid, 62400);
  const created = stripe._calls.filter((c) => c.name === 'subscriptions.create');
  assert.equal(created.length, 1);
  const sp = created[0].args.params;
  assert.equal(sp.customer, stripe._db.customers[0].id);
  assert.equal(sp.items[0].price, 'price_afterschool_fall26_3d_monthly');
  assert.equal(sp.default_payment_method, 'pm_card_1');
  assert.equal(sp.proration_behavior, 'none');
  assert.equal(new Date(sp.billing_cycle_anchor * 1000).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(sp.metadata.session, session.id); assert.equal(sp.metadata.player, 'Ava Torres'); assert.equal(sp.metadata.price, undefined);
  assert.equal(created[0].args.opts.idempotencyKey, 'plan_' + session.id);
  assert.equal(stripe._db.customers[0].invoice_settings.default_payment_method, 'pm_card_1');   // the same card pays one-off charges on file
  assert.equal(st.enrollment.subscription, stripe._db.subscriptions[0].id);
  assert.deepEqual(st.enrollment.next, { date: '2026-11-01', cents: 74700 });
  assert.deepEqual(st.enrollment.days, ['Mon', 'Wed', 'Fri']);
  assert.equal(st.portalUrl, undefined); assert.equal(st.email, undefined);   // Oct 24 audit: nothing private on the thank-you answer
  // Opening the thank-you page again (or the sweep running later) never creates a second plan.
  await CHECKOUT.sessionStatus(stripe, session.id);
  const sweep = await JOBS.convertPaidEnrollments(stripe, '2026-10-14');
  assert.equal(stripe._calls.filter((c) => c.name === 'subscriptions.create').length, 1);
  assert.equal(sweep.checked, 1); assert.equal(sweep.already, 1); assert.equal(sweep.created.length, 0);
});

test('a paid start month whose thank-you page was never opened gets its plan from the nightly sweep', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'u10path', plan: '2', days: ['Tue', 'Thu'], start: '2026-10-13', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'swp' }, family));
  const session = stripe._db.sessions[0];
  Object.assign(session, { status: 'complete', payment_status: 'paid', customer: stripe._db.customers[0].id, payment_intent: { id: 'pi_2', payment_method: 'pm_card_2' } });
  const report = await JOBS.convertPaidEnrollments(stripe, '2026-10-14');
  assert.equal(report.created.length, 1); assert.equal(report.errors.length, 0);
  const sub = stripe._db.subscriptions[0];
  assert.equal(sub.metadata.session, session.id); assert.equal(sub.default_payment_method, 'pm_card_2');
  assert.equal(sub.items.data[0].price.lookup_key, 'u10path_fall26_2d_monthly');
  // An unpaid (abandoned) session is never converted.
  await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'u10path', plan: '2', days: ['Tue', 'Thu'], start: '2026-10-13', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'abandoned' }, family));
  const again = await JOBS.convertPaidEnrollments(stripe, '2026-10-14');
  assert.equal(again.created.length, 0); assert.equal(again.already, 1);
  assert.equal(stripe._db.subscriptions.length, 1);
});

test('monthly enrollment edge cases: a start on the 1st and a start within two days of the 1st let Checkout anchor the plan with nothing due today', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  // Asking for Nov 1 (a Sunday) on Oct 13: the start rolls to Mon Nov 2, November's own first training day — nothing today; November
  // (16 of 21 training days of the $1,500 plan = $1,143) is billed on Nov 1 like every month, the Thanksgiving credit applied by the job
  const nov = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-11-01', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'nov' }, family));
  const pn = stripe._calls.filter((c) => c.name === 'checkout.sessions.create')[0].args.params;
  assert.equal(nov.quote.mode, 'anchor'); assert.equal(nov.quote.dueCents, 0); assert.equal(nov.quote.anchor, '2026-11-01');
  assert.deepEqual(nov.quote.lines, [{ label: 'Nothing due today — November tuition (prorated: 16 of 21 training days, thanksgiving break off) is charged on Nov 1', cents: 0 }]);
  assert.ok(nov.quote.then.startsWith('First charge: $1,143 on Nov 1, and $1,500 on the 1st of every month after'), nov.quote.then);
  assert.equal(pn.mode, 'subscription'); assert.equal(pn.subscription_data.proration_behavior, 'none');
  assert.equal(new Date(pn.subscription_data.billing_cycle_anchor * 1000).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(pn.subscription_data.metadata.start, '2026-11-02');
  // A start in the middle of a month still ahead (Nov 10): nothing today either; Nov 1 bills the training days from Nov 10 (the job credits the rest)
  const mid = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '3', days: ['Mon', 'Wed', 'Fri'], start: '2026-11-10', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'mid' }, family));
  assert.equal(mid.quote.mode, 'anchor'); assert.equal(mid.quote.anchor, '2026-11-01');
  assert.equal(mid.quote.lines[0].label, 'Nothing due today — November tuition (prorated: 10 of 21 training days, from Nov 10, thanksgiving break off) is charged on Nov 1');
  assert.equal(CAL.firstChargeCents(98000, '2026-11-01', '2026-11-10'), 46700); assert.ok(mid.quote.then.startsWith('First charge: $467 on Nov 1,'));
  // Starting on Dec 1 (a Tuesday, a training day): December is billed on Dec 1 like any month; nothing today; the plan is anchored to Dec 1
  const dec = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-12-01', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'dec' }, family));
  const pd = stripe._calls.filter((c) => c.name === 'checkout.sessions.create')[2].args.params;
  assert.equal(dec.quote.mode, 'anchor'); assert.equal(dec.quote.dueCents, 0);
  assert.equal(pd.line_items.length, 1);
  assert.equal(pd.subscription_data.proration_behavior, 'none');
  assert.equal(pd.mode, 'subscription');
  assert.equal(new Date(pd.subscription_data.billing_cycle_anchor * 1000).toISOString(), '2026-12-01T11:00:00.000Z');
  assert.match(dec.quote.then, /^First charge: \$/);
  assert.ok(pd.custom_text.submit.message.startsWith('Nothing due today — December tuition (prorated: 14 of 23 training days, winter break off) is charged on Dec 1. First charge: $'));
  // Enrolling on Oct 30 at 10:00 for Oct 30: the 1st is under 48 hours away → Oct 30–31 on the house, plan anchored to Nov 1
  const late = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-10-30', _today: '2026-10-30', _now: Date.UTC(2026, 9, 30, 14, 0, 0) / 1000, idempotency: 'late' }, family));
  const pl = stripe._calls.filter((c) => c.name === 'checkout.sessions.create')[3].args.params;
  assert.equal(late.quote.mode, 'anchor'); assert.equal(late.quote.dueCents, 0);
  assert.equal(pl.line_items.length, 1);
  assert.equal(new Date(pl.subscription_data.billing_cycle_anchor * 1000).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(late.quote.lines[0].label, 'Oct 30–31: on us — nothing due today');
  // Enrolling on Oct 29 at 10:00: the 1st is 68 hours away → the regular path (Oct 29–30 paid now, plan created for Nov 1)
  const ok = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-10-29', _today: '2026-10-29', _now: Date.UTC(2026, 9, 29, 14, 0, 0) / 1000, idempotency: 'ok' }, family));
  assert.equal(ok.quote.mode, 'charge'); assert.ok(ok.quote.dueCents > 0);
});

test('monthly enrollment refuses the wrong day count, a bad email, a missing authorization, and a price that disagrees with Stripe', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  await assert.rejects(CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '3', days: ['Mon'] }, family)), /Pick 3 training days/);
  await assert.rejects(CHECKOUT.createMonthlySession(stripe, Object.assign({}, family, { kind: 'monthly', program: 'afterschool', plan: '5', parent: { name: 'J', email: 'nope', phone: '5615550101' } })), /valid email/);
  await assert.rejects(CHECKOUT.createMonthlySession(stripe, Object.assign({}, family, { kind: 'monthly', program: 'afterschool', plan: '5', authorize: false })), /authorized/);
  const wrong = fakeStripe({ prices: PRICES.map((p) => p.lookup_key === 'afterschool_fall26_5d_monthly' ? Object.assign({}, p, { unit_amount: 160000 }) : p), products: PRODUCTS });
  await assert.rejects(CHECKOUT.createMonthlySession(wrong, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5' }, family)), /catalog says \$1500, Stripe says \$1600/);
});

test('a family that already exists is reused, never duplicated', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS, customers: [{ id: 'cus_existing', email: 'jane.torres@example.com', name: '', phone: null }] });
  await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'u10path', plan: '2', days: ['Tue', 'Thu'] }, family));
  assert.equal(stripe._db.customers.length, 1);
  assert.equal(stripe._db.customers[0].name, 'Jane Torres');
  assert.equal(stripe._calls.find((c) => c.name === 'checkout.sessions.create').args.params.customer, 'cus_existing');
});

test('one-time purchase: camps and packs in payment mode, card saved for the file, invoice kept for the books', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const out = await CHECKOUT.createOneTimeSession(stripe, Object.assign({ kind: 'items', items: [{ lookup: 'tg26_u10_full3' }, { lookup: 'fulltime_fall26_core_weekly', qty: 2 }, { lookup: 'sparring_1p_60m' }] }, family));
  const p = stripe._calls.find((c) => c.name === 'checkout.sessions.create').args.params;
  assert.equal(p.mode, 'payment');
  assert.deepEqual(p.line_items.map((l) => [l.price, l.quantity]), [['price_tg26_u10_full3', 1], ['price_fulltime_fall26_core_weekly', 2], ['price_sparring', 1]]);
  assert.equal(p.payment_intent_data.setup_future_usage, 'off_session');
  assert.equal(p.invoice_creation.enabled, true);
  assert.equal(out.quote.dueCents, 45000 + 145000 + 5000);
  await assert.rejects(CHECKOUT.createOneTimeSession(stripe, Object.assign({ items: [{ lookup: 'pickleball_anything' }] }, family)), /Unknown item/);
});

test('thank-you page status for a completed enrollment', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const sub = { id: 'sub_1', status: 'active', metadata: { program: 'afterschool', plan: '3', days: 'Mon,Wed,Fri', start: '2026-10-13', player: 'Ava Torres' }, items: { data: [{ current_period_end: CAL.unixET('2026-11-01', 6, 0) }] } };
  stripe._db.sessions.push({ id: 'cs_done', status: 'complete', payment_status: 'paid', mode: 'subscription', amount_total: 62400, metadata: { player: 'Ava Torres' }, customer: { id: 'cus_1' }, customer_details: { email: 'jane.torres@example.com' }, subscription: sub, line_items: { data: [{ description: 'Afterschool | Fall 2026', amount_total: 0 }, { description: 'October tuition', amount_total: 62400 }] } });
  const st = await CHECKOUT.sessionStatus(stripe, 'cs_done');
  assert.equal(st.paid, 62400);
  assert.deepEqual(st.enrollment.next, { date: '2026-11-01', cents: 74700 });
  assert.equal(st.enrollment.plan, '3 Days per week');
  assert.equal(st.portalUrl, undefined);
  const portal = await S.portalUrl(stripe, 'cus_1', 'https://proworld-coach-portal.web.app/family');   // the signed-in family gets the card portal from /api/family/portal
  assert.match(portal, /^https:\/\/billing\.stripe\.com\//);
  assert.equal(stripe._db.portalConfigs.length, 1);
  assert.equal(stripe._db.portalConfigs[0].features.subscription_cancel.mode, 'at_period_end');
});

test('a subscription Checkout (a 1st-of-month start, the staff test) puts the plan\'s card on the family\'s file, once — so a private or a camp can be charged to it', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS, customers: [{ id: 'cus_sub', object: 'customer', email: 'jane.torres@example.com', invoice_settings: { default_payment_method: null } }] });
  const sub = { id: 'sub_c', status: 'active', default_payment_method: 'pm_on_plan', metadata: { program: 'tester', plan: '3d', days: 'Mon,Tue,Wed,Thu,Fri', start: '2026-10-22', player: 'Roger Tester' }, items: { data: [{ current_period_end: CAL.unixET('2026-10-25', 16, 0) }] } };
  stripe._db.sessions.push({ id: 'cs_sub', status: 'complete', payment_status: 'paid', mode: 'subscription', amount_total: 300, metadata: { player: 'Roger Tester' }, customer: stripe._db.customers[0], customer_details: { email: 'jane.torres@example.com' }, subscription: sub, line_items: { data: [] } });
  const st = await CHECKOUT.sessionStatus(stripe, 'cs_sub');
  assert.equal(st.enrollment.cycle, 'every 3 days');
  assert.equal(stripe._db.customers[0].invoice_settings.default_payment_method, 'pm_on_plan');
  // opening the page again changes nothing; a family that already has a card on file keeps it
  const n = stripe._calls.filter((c) => c.name === 'customers.update').length;
  await CHECKOUT.sessionStatus(stripe, 'cs_sub');
  assert.equal(stripe._calls.filter((c) => c.name === 'customers.update').length, n);
  stripe._db.customers[0].invoice_settings.default_payment_method = 'pm_older';
  await CHECKOUT.ensureCardOnFile(stripe, stripe._db.sessions[stripe._db.sessions.length - 1], sub);
  assert.equal(stripe._db.customers[0].invoice_settings.default_payment_method, 'pm_older');
  // the nightly sweep does the same when the family never reached the thank-you page (the customer comes as an id there)
  const stripe2 = fakeStripe({ prices: PRICES, products: PRODUCTS, customers: [{ id: 'cus_sub2', object: 'customer', email: 'x@example.com', invoice_settings: {} }], subscriptions: [Object.assign({}, sub, { id: 'sub_d', customer: 'cus_sub2' })] });
  stripe2._db.sessions.push({ id: 'cs_sub2', status: 'complete', payment_status: 'paid', mode: 'subscription', created: Math.floor(Date.now() / 1000) - 3600, amount_total: 300, metadata: { player: 'Roger Tester' }, customer: 'cus_sub2', subscription: Object.assign({}, sub, { id: 'sub_d', customer: 'cus_sub2' }) });
  await JOBS.convertPaidEnrollments(stripe2, '2026-10-23');
  assert.equal(stripe2._db.customers[0].invoice_settings.default_payment_method, 'pm_on_plan');
});

/* ── the timed rules ── */
function sub(id, lookup, periodEnd, extra) { const price = PRICES.find((p) => p.lookup_key === lookup); return Object.assign({ id, object: 'subscription', status: 'active', customer: 'cus_' + id, metadata: { player: 'P ' + id }, items: { data: [{ id: 'si_' + id, price, current_period_end: periodEnd }] } }, extra || {}); }

test('break credits: the week before Nov 1, every monthly plan gets the Thanksgiving credit once; June pauses collection', async () => {
  const nov1 = CAL.unixET('2026-11-01', 6, 0);
  const stripe = fakeStripe({ subscriptions: [sub('a', 'afterschool_fall26_3d_monthly', nov1), sub('b', 'fulltime_fall26_core_monthly', nov1), sub('c', 'afterschool_fall26_3d_monthly', nov1, { metadata: { credit_2026_11: 'ii_done' } }), sub('d', 'afterschool_fall26_2d_monthly', CAL.unixET('2026-12-01', 6, 0)), sub('m', 'membership_court_600_monthly', nov1)] });
  stripe._db.prices.push({ id: 'price_m', lookup_key: 'membership_court_600_monthly', unit_amount: 60000, type: 'recurring' });
  stripe._db.subscriptions[4].items.data[0].price = stripe._db.prices[stripe._db.prices.length - 1];
  const r1 = await JOBS.applyBreakCredits(stripe, '2026-10-20');
  assert.equal(r1.credited.length, 0, 'too early on the 20th');
  const r2 = await JOBS.applyBreakCredits(stripe, '2026-10-25');
  assert.deepEqual(r2.credited.map((c) => [c.subscription, c.credit]), [['a', 23300], ['b', 70200]]);   // $980 → $233 credit; $2,950 → charge $2,248 → $702 credit
  const items = stripe._db.invoiceItems;
  assert.equal(items[0].amount, -23300); assert.equal(items[0].subscription, 'a'); assert.equal(items[0].customer, 'cus_a');
  assert.equal(items[0].description, 'Thanksgiving break credit — November: 16 of 21 training days');
  assert.equal(stripe._db.subscriptions[0].metadata.credit_2026_11, items[0].id);
  const r3 = await JOBS.applyBreakCredits(stripe, '2026-10-26');
  assert.equal(r3.credited.length, 0, 'runs again safely: every subscription is already flagged');
  // A plan enrolled ahead for a mid-month start (Nov 10) is credited the days before its start on the same run, break included
  const mid = fakeStripe({ subscriptions: [sub('s', 'afterschool_fall26_3d_monthly', nov1, { metadata: { start: '2026-11-10', player: 'Ava Torres' } }), sub('f', 'afterschool_fall26_3d_monthly', nov1, { metadata: { start: '2026-11-02' } })] });
  const r5 = await JOBS.applyBreakCredits(mid, '2026-11-01');                                   // the 1st itself at 05:05, an hour before the invoices
  assert.deepEqual(r5.credited.map((c) => [c.subscription, c.credit]), [['s', 51300], ['f', 23300]]);   // $980 − $467 (10 of 21 days from Nov 10); Nov 2 is November's first training day → the plain break credit
  assert.equal(mid._db.invoiceItems[0].description, 'Start credit — November: 10 of 21 training days from Nov 10 (thanksgiving break off)');
  assert.equal(mid._db.invoiceItems[1].description, 'Thanksgiving break credit — November: 16 of 21 training days');
  // June: no training days → collection paused for that month (resumes an hour before the next 1st; July is judged on its own)
  const jun = fakeStripe({ subscriptions: [sub('j', 'afterschool_fall26_3d_monthly', CAL.unixET('2027-06-01', 6, 0))] });
  const r4 = await JOBS.applyBreakCredits(jun, '2027-05-26');
  assert.equal(r4.paused.length, 1);
  assert.equal(jun._db.subscriptions[0].pause_collection.behavior, 'void');
  assert.equal(CAL.dateOfUnixET(jun._db.subscriptions[0].pause_collection.resumes_at), '2027-07-01');
});

test('late policy: $50 fee on the 6th, hold on the 10th, cancelled on the 15th — each once', async () => {
  const mk = (id, created, extra) => Object.assign({ id, object: 'invoice', status: 'open', customer: 'cus_x', amount_due: 98000, billing_reason: 'subscription_cycle', created: CAL.unixET(created, 6, 0), parent: { subscription_details: { subscription: 'sub_x' } }, metadata: { player: 'Ava Torres' }, lines: { data: [] } }, extra || {});
  const stripe = fakeStripe({ invoices: [mk('in_nov', '2026-11-01')], subscriptions: [{ id: 'sub_x', status: 'past_due', customer: 'cus_x', metadata: {}, items: { data: [] } }] });
  const r5 = await JOBS.applyLatePolicy(stripe, '2026-11-05');
  assert.equal(r5.lateFees.length, 0, 'the 5th is still inside the grace period');
  const r6 = await JOBS.applyLatePolicy(stripe, '2026-11-06');
  assert.equal(r6.lateFees.length, 1);
  const fee = stripe._db.invoices.find((i) => i.metadata && i.metadata.kind === 'late_fee');
  assert.equal(fee.status, 'paid'); assert.equal(fee.amount_due, 5000);
  assert.equal(stripe._db.invoiceItems[0].invoice, fee.id, 'the fee line is attached to its own invoice, never to the next tuition invoice');
  assert.equal(stripe._db.invoices[0].metadata.late_fee, fee.id);
  const r6b = await JOBS.applyLatePolicy(stripe, '2026-11-07');
  assert.equal(r6b.lateFees.length, 0, 'no second fee');
  const r10 = await JOBS.applyLatePolicy(stripe, '2026-11-10');
  assert.equal(r10.holds.length, 1); assert.equal(stripe._db.subscriptions[0].metadata.hold, 'true');
  const r15 = await JOBS.applyLatePolicy(stripe, '2026-11-15');
  assert.equal(r15.cancelled.length, 1); assert.equal(stripe._db.subscriptions[0].status, 'canceled');
  const again = await JOBS.applyLatePolicy(stripe, '2026-11-16');
  assert.deepEqual([again.lateFees.length, again.holds.length, again.cancelled.length], [0, 0, 0]);
  // a declined card on the fee leaves it open and still marks the tuition invoice
  const dec = fakeStripe({ cardFails: true, invoices: [mk('in_dec', '2026-12-01')], subscriptions: [{ id: 'sub_x', status: 'past_due', customer: 'cus_x', metadata: {}, items: { data: [] } }] });
  const rd = await JOBS.applyLatePolicy(dec, '2026-12-06');
  assert.equal(rd.lateFees.length, 1); assert.equal(dec._db.invoices[1].status, 'open'); assert.equal(dec._db.invoices[0].metadata.late_fee, dec._db.invoices[1].id);
  // one-off invoices (a drop-in, a late fee) are never escalated
  const oneoff = fakeStripe({ invoices: [Object.assign(mk('in_drop', '2026-11-01'), { parent: null, billing_reason: 'manual' })] });
  const ro = await JOBS.applyLatePolicy(oneoff, '2026-11-20');
  assert.deepEqual([ro.lateFees.length, ro.holds.length, ro.cancelled.length], [0, 0, 0]);
});

test('the family notice for a break month reads right', () => {
  assert.equal(JOBS.breakMonthNotice('Afterschool', 98000, 2026, 10), 'Heads-up for November: Thanksgiving break (11/23–11/27) is not part of the Afterschool program, so the Nov 1 charge is prorated: 16 of 21 training days = $747 instead of $980. The credit shows on the invoice. Want to train that week? Thanksgiving camps (sold separately) are booked separately.');
  assert.equal(JOBS.breakMonthNotice('Afterschool', 98000, 2026, 9), null);
  assert.match(JOBS.breakMonthNotice('Afterschool', 98000, 2027, 5), /no tuition charge on Jun 1/);
});

/* ── the Stripe catalog check and sync (what "Sync catalog" in the backend does) ── */
const SYNC = require('../lib/catalog-sync');
for (const m of CAT.MEMBERSHIP) PRICES.push({ id: 'price_' + m.lookup, object: 'price', active: true, lookup_key: m.lookup, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, unit_amount: m.price * 100, product: 'prod_VSwuLdnecvHOo2' });
function liveLikeProducts() {
  // A Stripe account as the live one stood before the first sync: the 20 Play by Point products with their internal descriptions, no start-month products.
  const out = {};
  for (const e of SYNC.expectedProducts()) if (!e.create) out[e.id] = { id: e.id, object: 'product', active: true, name: e.name, description: e.description + ' Mirrors the Play by Point program line for line.', default_price: e.id === 'prod_VSwrEVcItQBJ4t' ? PRODUCTS.prod_VSwrEVcItQBJ4t.default_price : null };
  return out;
}
test('catalog check: 31 products and 132 prices are expected (26 + 112 Play by Point, the staff test, the three winter camps); the sync creates the start-month products and rewrites descriptions, never prices', async () => {
  assert.equal(SYNC.expectedProducts().length, 31);
  assert.equal(SYNC.expectedPrices().length, 132);
  const wi = SYNC.expectedPrices().filter((x) => /^wi26_/.test(x.lookup));
  assert.equal(wi.length, 18); assert.ok(wi.every((x) => !x.recurring && /^prod_VUk/.test(x.product)));
  assert.equal(wi.find((x) => x.lookup === 'wi26_u10_week').cents, 51500);
  const stripe = fakeStripe({ prices: PRICES, products: liveLikeProducts() });
  const before = await SYNC.checkCatalog(stripe);
  assert.equal(before.products.missing.length, 6); assert.ok(before.products.missing.every((m) => m.create && /^pw_firstmonth_/.test(m.id)));
  assert.equal(before.products.stale.length, 25); assert.equal(before.products.ok, 0);
  assert.deepEqual([before.prices.expected, before.prices.ok, before.prices.missing.length, before.prices.mismatched.length], [132, 132, 0, 0]);
  assert.equal(before.fixable, 31); assert.equal(before.blocking, 0); assert.equal(before.ready, false);
  const lines = [];
  const out = await SYNC.syncCatalog(stripe, (l) => lines.push(l));
  assert.equal(out.done.created.length, 6); assert.equal(out.done.updated.length, 25); assert.ok(out.done.portal);
  const made = stripe._db.products.pw_firstmonth_afterschool;
  assert.equal(made.name, 'Afterschool | Fall 2026 — start month (prorated by training days)');
  assert.equal(made.statement_descriptor, 'PROWORLD AFTERSCHOOL'); assert.equal(made.metadata.kind, 'first_month');
  assert.equal(stripe._db.products.prod_VSweKxrlHVGGqf.description, 'Afterschool program · Aug 10 – Dec 18, 2026.');
  assert.ok(!stripe._calls.some((c) => /^prices\.(create|update)/.test(c.name)), 'prices are never written');
  assert.equal(out.after.ready, true); assert.equal(out.after.products.ok, 31); assert.equal(out.after.prices.ok, 132);
  // a second sync changes nothing
  const again = await SYNC.syncCatalog(stripe);
  assert.deepEqual([again.done.created.length, again.done.updated.length], [0, 0]);
  // a price that drifted from the catalog, a missing lookup key and an archived product all block go-live and are named
  const drift = PRICES.map((p) => p.lookup_key === 'afterschool_fall26_3d_monthly' ? Object.assign({}, p, { unit_amount: 99000 }) : p).filter((p) => p.lookup_key !== 'tg26_u10_saturday_dropin');
  const prods = liveLikeProducts(); prods.prod_VSwtDH5VO3FYSZ.active = false;
  const bad = await SYNC.checkCatalog(fakeStripe({ prices: drift, products: prods }));
  assert.equal(bad.prices.mismatched.length, 1); assert.match(bad.prices.mismatched[0].problem, /\$990 in Stripe, catalog says \$980/);
  assert.deepEqual(bad.prices.missing.map((m) => m.lookup), ['tg26_u10_saturday_dropin']);
  assert.deepEqual(bad.products.archived.map((a) => a.id), ['prod_VSwtDH5VO3FYSZ']);
  assert.equal(bad.blocking, 3); assert.equal(bad.ready, false);
  // the staff test's price must carry its own cycle in Stripe (every 3 days), not a month
  const wrongCycle = PRICES.map((p) => p.lookup_key === 'tester_3day' ? Object.assign({}, p, { recurring: { interval: 'month', interval_count: 1 } }) : p);
  const wc = await SYNC.checkCatalog(fakeStripe({ prices: wrongCycle, products: liveLikeProducts() }));
  assert.deepEqual(wc.prices.mismatched.map((m) => m.lookup + ': ' + m.problem), ['tester_3day: not an every-3-day price in Stripe']);
});

/* ── the staff test: a plan on its own cycle (every 3 days), a real card, no 1st, no proration, no break credits ── */
test('the tester plan: charged today through a subscription Checkout with no anchor, renews every 3 days, hidden from the public list, no break credit', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const pub = CAT.publicCatalog();
  const t = pub.programs.find((p) => p.id === 'tester');
  assert.equal(t.hidden, true); assert.deepEqual(t.plans[0].every, { interval: 'day', count: 3 });
  assert.ok(pub.programs.filter((p) => p.hidden).length === 1, 'only the tester is hidden');
  assert.equal(CAT.cycleWord(CAT.plan('tester', '3d')), 'every 3 days'); assert.equal(CAT.cycleWord(CAT.plan('afterschool', '3')), 'a month');
  const q = CHECKOUT.monthlyQuote('tester', '3d', '2026-10-22', '2026-10-22', Date.UTC(2026, 9, 22, 14, 0, 0) / 1000);
  assert.equal(q.mode, 'cycle'); assert.equal(q.dueCents, 300); assert.equal(q.start, '2026-10-22');
  assert.deepEqual(q.lines, [{ label: 'First 3 days — charged today', cents: 300 }]);
  assert.deepEqual(q.next, { date: '2026-10-25', cents: 300, note: '', label: 'Oct 25' });
  assert.match(q.then, /^Then \$3 every 3 days on the same card/);
  const out = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'tester', plan: '3d', days: [], start: '2026-10-22', _today: '2026-10-22', idempotency: 'tst' }, family, { player: { first: 'Roger', last: 'Tester', dob: '2015-01-01' } }));
  const p = stripe._calls.find((c) => c.name === 'checkout.sessions.create').args.params;
  assert.equal(p.mode, 'subscription');
  assert.equal(p.line_items[0].price, 'price_tester_3day');
  assert.equal(p.subscription_data.billing_cycle_anchor, undefined); assert.equal(p.subscription_data.proration_behavior, undefined);
  assert.equal(p.metadata.anchor, ''); assert.equal(p.metadata.days, 'Mon,Tue,Wed,Thu,Fri'); assert.equal(p.metadata.qbo_class, 'Test');
  assert.ok(p.custom_text.submit.message.startsWith('Due today: First 3 days — charged today. Then $3 every 3 days'));
  assert.ok(!p.custom_text.submit.message.includes('late fee'), 'the late-fee timeline is a monthly rule');
  assert.equal(out.quote.mode, 'cycle'); assert.equal(out.quote.dueCents, 300);
  // the wrong cycle in Stripe refuses the sale
  const monthlyInStripe = PRICES.map((x) => x.lookup_key === 'tester_3day' ? Object.assign({}, x, { recurring: { interval: 'month', interval_count: 1 } }) : x);
  await assert.rejects(S.monthlyPlanPrice(fakeStripe({ prices: monthlyInStripe }), 'tester', '3d'), /not an every-3-day price in Stripe/);
  // the credit job leaves it alone even in the week before a break month
  const sub = { id: 'sub_t', object: 'subscription', status: 'active', customer: 'cus_t', items: { data: [{ price: PRICES.find((x) => x.lookup_key === 'tester_3day'), current_period_end: CAL.unixET('2026-11-01', 6, 0) }] }, metadata: { player: 'Roger Tester', start: '2026-10-29' } };
  const credits = await JOBS.applyBreakCredits(fakeStripe({ prices: PRICES, subscriptions: [sub] }), '2026-10-29');
  assert.equal(credits.credited.length, 0); assert.equal(credits.paused.length, 0); assert.equal(credits.skipped, 1);
  // what the thank-you page and the Admin say about the next charge: the same $3, not a prorated month
  const en = CHECKOUT.enrollmentOf(sub, { program: 'tester', plan: '3d', days: 'Mon,Tue,Wed,Thu,Fri', start: '2026-10-29' });
  assert.deepEqual(en.next, { date: '2026-11-01', cents: 300 }); assert.equal(en.cycle, 'every 3 days');
});

/* ── moving the families over (the pure parts; the roster itself lives in Firestore) ── */
const SWITCH = require('../lib/switch');
test('switch links: program and plan when set, the family details, billing from the next 1st, the date locked', () => {
  assert.equal(SWITCH.groupOf('Full Time'), 'ft'); assert.equal(SWITCH.groupOf('Afterschool 4Pm'), 'as'); assert.equal(SWITCH.groupOf('10 & Under'), 'u10');
  assert.deepEqual(SWITCH.splitName('Bradley I'), { first: 'Bradley', last: '' });
  assert.deepEqual(SWITCH.splitName('Ava Torres'), { first: 'Ava', last: 'Torres' });
  assert.equal(SWITCH.slug('Toño Fernández'), 'tono-fernandez');
  const link = SWITCH.linkFor({ program: 'afterschool', plan: '3', first: 'Bradley', guardian: 'Jane Doe', email: 'jane@example.com', phone: '5615550101' }, '2026-11-01');
  const u = new URL(link);
  assert.equal(u.origin + u.pathname, 'https://proworld-coach-portal.web.app/enroll');
  assert.deepEqual(Object.fromEntries(u.searchParams), { switch: '1', p: 'afterschool', plan: '3', start: '2026-11-01', first: 'Bradley', parent: 'Jane Doe', email: 'jane@example.com', phone: '5615550101', by: 'switch' });
  const bare = new URL(SWITCH.linkFor({ program: '', plan: 'x', first: 'Ava', last: 'Torres' }, '2026-11-01'));
  assert.equal(bare.searchParams.get('p'), null); assert.equal(bare.searchParams.get('last'), 'Torres');
});
