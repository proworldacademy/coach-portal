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

test('every catalog line has a lookup key and the lines are unique', () => {
  const lines = CAT.oneTimeLines();
  assert.equal(Object.keys(lines).length, 94);
  for (const p of CAT.PROGRAMS) for (const pl of p.plans) assert.match(pl.lookup, /_monthly$/);
  assert.ok(lines['tg26_u10_saturday_dropin'] && lines['tg26_u10_saturday_dropin'].price === 60);
  assert.ok(lines['sparring_1p_60m'].byProduct);
});

/* ── checkout ── */
const PRICES = [];
for (const p of CAT.PROGRAMS) for (const pl of p.plans) PRICES.push({ id: 'price_' + pl.lookup, object: 'price', active: true, lookup_key: pl.lookup, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, unit_amount: pl.monthly * 100, product: p.product });
for (const [k, l] of Object.entries(CAT.oneTimeLines())) if (!l.byProduct) PRICES.push({ id: 'price_' + k, object: 'price', active: true, lookup_key: k, type: 'one_time', unit_amount: Math.round(l.price * 100), product: l.product });
const PRODUCTS = { prod_VSwrEVcItQBJ4t: { id: 'prod_VSwrEVcItQBJ4t', default_price: { id: 'price_sparring', type: 'one_time', unit_amount: 5000 } } };
const family = { player: { first: 'Ava', last: 'Torres', dob: '2014-05-02' }, parent: { name: 'Jane Torres', email: 'Jane.Torres@example.com', phone: '(561) 555-0101' }, agree: true, authorize: true };

const NOW_OCT13 = Date.UTC(2026, 9, 13, 14, 0, 0) / 1000;                                   // Oct 13, 2026 10:00 Delray Beach

test('monthly enrollment: the prorated month as a one-time line now, the plan starts billing on the next 1st (trial to the 1st, no Stripe proration)', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  const out = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '3', days: ['Mon', 'Wed', 'Fri'], start: '2026-10-13', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'abc' }, family));
  assert.match(out.url, /^https:\/\/checkout\.stripe\.com\//);
  const call = stripe._calls.find((c) => c.name === 'checkout.sessions.create');
  const p = call.args.params;
  assert.equal(p.mode, 'subscription');
  assert.equal(p.line_items.length, 2);
  assert.equal(p.line_items[0].price, 'price_afterschool_fall26_3d_monthly');
  assert.deepEqual(p.line_items[1].price_data, { currency: 'usd', product: 'prod_VSweKxrlHVGGqf', unit_amount: 62400 });
  assert.equal(out.quote.mode, 'trial');
  assert.equal(p.subscription_data.proration_behavior, undefined);                           // Stripe refuses 'none' next to a one-time line
  assert.equal(p.subscription_data.billing_cycle_anchor, undefined);
  assert.equal(new Date(p.subscription_data.trial_end * 1000).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.ok(p.custom_text.submit.message.startsWith('Due today: October tuition (prorated: 14 of 22 training days, from Oct 13). Then $747 on Nov 1'));
  assert.equal(p.subscription_data.metadata.days, 'Mon,Wed,Fri');
  assert.equal(p.subscription_data.metadata.player, 'Ava Torres');
  assert.equal(p.customer, stripe._db.customers[0].id);
  assert.equal(stripe._db.customers[0].email, 'jane.torres@example.com');
  assert.ok(p.custom_text.submit.message.includes('$50 late fee'));
  assert.ok(p.custom_text.submit.message.length <= 1200);
  assert.equal(call.args.opts.idempotencyKey, 'enroll_abc');
  assert.equal(out.quote.dueCents, 62400);
  assert.match(out.quote.then, /^Then \$747 on Nov 1 \(16 of 21 training days · thanksgiving break off\), and \$980 on the 1st of every month after/);
});

test('monthly enrollment edge cases: a start on the 1st and a start within two days of the 1st anchor the plan with nothing due today', async () => {
  const stripe = fakeStripe({ prices: PRICES, products: PRODUCTS });
  // Asking for Nov 1 (a Sunday): the start rolls to Mon Nov 2, so November (16 of 21 training days of the $1,500 plan) is the one-time line and the plan starts billing Dec 1
  const nov = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-11-01', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'nov' }, family));
  assert.equal(nov.quote.mode, 'trial'); assert.equal(nov.quote.dueCents, 114300); assert.equal(nov.quote.anchor, '2026-12-01');
  // Starting on Dec 1 (a Tuesday, a training day): December is billed on Dec 1 like any month; nothing today; the plan is anchored to Dec 1
  const dec = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-12-01', _today: '2026-10-13', _now: NOW_OCT13, idempotency: 'dec' }, family));
  const pd = stripe._calls.filter((c) => c.name === 'checkout.sessions.create')[1].args.params;
  assert.equal(dec.quote.mode, 'anchor'); assert.equal(dec.quote.dueCents, 0);
  assert.equal(pd.line_items.length, 1);
  assert.equal(pd.subscription_data.proration_behavior, 'none');
  assert.equal(pd.subscription_data.trial_end, undefined);
  assert.equal(new Date(pd.subscription_data.billing_cycle_anchor * 1000).toISOString(), '2026-12-01T11:00:00.000Z');
  assert.match(dec.quote.then, /^First charge: \$/);
  assert.ok(pd.custom_text.submit.message.startsWith('Nothing due today — December tuition is charged on Dec 1. First charge: $'));
  // Enrolling on Oct 30 at 10:00 for Oct 30: the 1st is under 48 hours away → Oct 30–31 on the house, plan anchored to Nov 1
  const late = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-10-30', _today: '2026-10-30', _now: Date.UTC(2026, 9, 30, 14, 0, 0) / 1000, idempotency: 'late' }, family));
  const pl = stripe._calls.filter((c) => c.name === 'checkout.sessions.create')[2].args.params;
  assert.equal(late.quote.mode, 'anchor'); assert.equal(late.quote.dueCents, 0);
  assert.equal(pl.line_items.length, 1);
  assert.equal(new Date(pl.subscription_data.billing_cycle_anchor * 1000).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(late.quote.lines[0].label, 'Oct 30–31: on us — nothing due today');
  // Enrolling on Oct 29 at 10:00: the 1st is 68 hours away → the regular path (Oct 29–30 charged now, trial to Nov 1)
  const ok = await CHECKOUT.createMonthlySession(stripe, Object.assign({ kind: 'monthly', program: 'afterschool', plan: '5', start: '2026-10-29', _today: '2026-10-29', _now: Date.UTC(2026, 9, 29, 14, 0, 0) / 1000, idempotency: 'ok' }, family));
  assert.equal(ok.quote.mode, 'trial'); assert.ok(ok.quote.dueCents > 0);
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
  assert.match(st.portalUrl, /^https:\/\/billing\.stripe\.com\//);
  assert.equal(stripe._db.portalConfigs.length, 1);
  assert.equal(stripe._db.portalConfigs[0].features.subscription_cancel.mode, 'at_period_end');
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
