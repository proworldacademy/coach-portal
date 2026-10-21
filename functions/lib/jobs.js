/* The timed rules, run every morning at 05:05 Delray Beach time (an hour before the 1st-of-month invoices are created at 06:00):
   0. Paid checkouts without their follow-through: the plan for a paid start month, and the roster record + the messages for
      every paid checkout (program, pack, camp, week, drop-in) — in case the family closed the tab before the thank-you page.
   1. First-invoice credits: in the week before a 1st, each monthly subscription whose coming month is short — a school break, or a plan
      that starts later than the month's first training day — gets a credit line (full price minus the training-day charge) so the invoice
      shows the full tuition and the credit; the family is told. A month with no training days (June, July) pauses collection for that
      month instead — invoices created while paused are voided. Each subscription is flagged per month, so a day's run can be repeated safely.
   2. The late-fee timeline: a tuition invoice still open on the 2nd gets the family a "didn't go through" text; still open after the
      5th, a $50 late-fee invoice on the 6th; on the 10th the subscription is marked on hold (the attendance list drops the player);
      on the 15th the subscription is cancelled and the spot released. Flags on the invoice and the subscription make every step run once.
   3. Holds that were paid: a hold put on for an unpaid invoice is released the morning after the invoice is paid.
   `ctx` carries the database handle and the Stripe mode; without it (the tests, a dry run) the roster and the messages are skipped. */
'use strict';
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');
const CHECKOUT = require('./checkout');
const ROSTER = require('./roster');
const SMS = require('./sms');

const RULES = CAL.RULES;
const LATE = RULES.late_policy;
const monthlyLookups = () => new Set(CAT.PROGRAMS.flatMap((p) => p.plans.map((x) => x.lookup)));

async function phoneOf(stripe, customerId) {
  try { const c = await stripe.customers.retrieve(customerId); return { phone: c.phone || '', name: c.name || '', email: c.email || '' }; } catch (e) { return { phone: '', name: '', email: '' }; }
}

/* 0. Paid checkouts of the last two weeks: the plan behind a paid start month, then the roster + the messages (all idempotent). */
async function convertPaidEnrollments(stripe, today, log, ctx) {
  log = log || (() => {}); ctx = ctx || {};
  const report = { checked: 0, created: [], already: 0, recorded: [], errors: [] };
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  for await (const session of stripe.checkout.sessions.list({ status: 'complete', created: { gte: since }, limit: 100, expand: ['data.payment_intent', 'data.subscription'] })) {
    const m = session.metadata || {};
    let sub = null;
    if (CHECKOUT.isProgramPayment(session)) {
      report.checked++;
      try {
        sub = await CHECKOUT.findEnrollment(stripe, S.customerId(session.customer), session.id);
        if (sub) report.already++;
        else { sub = await CHECKOUT.ensureEnrollment(stripe, session, log); if (sub) report.created.push({ session: session.id, subscription: sub.id, player: m.player }); }
      } catch (e) { report.errors.push({ session: session.id, player: m.player, error: e.message }); log(`error ${session.id}: ${e.message}`); continue; }
    } else if (session.mode === 'subscription' && session.subscription) {
      sub = typeof session.subscription === 'object' ? session.subscription : null;
      if (!sub) { try { sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ['items.data.price'] }); } catch (e) { sub = { id: session.subscription }; } }
    } else if (!(session.mode === 'payment' && session.payment_status === 'paid')) continue;
    if (!ctx.db) continue;
    try {
      const rec = await ROSTER.record(ctx.db, stripe, session, sub, { log, mode: ctx.mode });
      await SMS.consentFromSession(ctx.db, session, rec);
      if (rec && rec.fresh) report.recorded.push({ session: session.id, player: rec.player, what: rec.what });
    } catch (e) { report.errors.push({ session: session.id, player: m.player, error: 'roster: ' + e.message }); log(`roster error ${session.id}: ${e.message}`); }
  }
  return report;
}

function daysBetween(a, b) { const pa = CAL.parts(a), pb = CAL.parts(b); return Math.round((Date.UTC(pb.y, pb.m, pb.d) - Date.UTC(pa.y, pa.m, pa.d)) / 86400000); }

async function applyBreakCredits(stripe, today, log, ctx) {
  today = today || CAL.todayET(); log = log || (() => {}); ctx = ctx || {};
  const plans = monthlyLookups();
  const report = { checked: 0, credited: [], paused: [], skipped: 0, told: 0, errors: [] };
  for (const status of ['active', 'trialing', 'past_due']) {                               // 'trialing' = enrolled, first 1st still ahead
    for await (const sub of stripe.subscriptions.list({ status, limit: 100, expand: ['data.items.data.price'] })) {
      report.checked++;
      try {
        const item = sub.items && sub.items.data && sub.items.data[0];
        const price = item && item.price;
        if (!price || !plans.has(price.lookup_key)) { report.skipped++; continue; }
        const end = S.periodEnd(sub);
        if (!end) { report.skipped++; continue; }
        const nextDate = CAL.dateOfUnixET(end);
        const lead = daysBetween(today, nextDate);
        if (lead < 0 || lead > 8) { report.skipped++; continue; }                            // only the week before the next 1st
        const { y, m } = CAL.parts(nextDate);
        const flag = 'credit_' + nextDate.slice(0, 7).replace('-', '_');
        if (sub.metadata && sub.metadata[flag]) { report.skipped++; continue; }
        const f = CAL.monthFactor(y, m);
        const start = sub.metadata && /^\d{4}-\d{2}-\d{2}$/.test(sub.metadata.start || '') ? sub.metadata.start : null;   // a start inside this month: only the days from it
        const charge = CAL.firstChargeCents(price.unit_amount, nextDate, start);
        if (f.factor >= 1 && charge >= price.unit_amount) { report.skipped++; continue; }
        const programShort = (() => { for (const p of CAT.PROGRAMS) if (p.plans.some((x) => x.lookup === price.lookup_key)) return p.short; return 'program'; })();
        let notice = null;
        if (f.factor === 0) {
          // Pause through this one month only (resume an hour before the next 1st's invoices); the next month is judged on its own the following week.
          const resumesAt = CAL.unixET(CAL.nextFirst(nextDate), 5, 0);
          await stripe.subscriptions.update(sub.id, { pause_collection: { behavior: 'void', resumes_at: resumesAt }, metadata: { [flag]: 'paused' } }, { idempotencyKey: `pause_${sub.id}_${nextDate.slice(0, 7)}` });
          report.paused.push({ subscription: sub.id, month: nextDate.slice(0, 7), resumes: CAL.dateOfUnixET(resumesAt) });
          log(`paused ${sub.id} for ${nextDate.slice(0, 7)}, resumes ${CAL.dateOfUnixET(resumesAt)}`);
          notice = breakMonthNotice(programShort, price.unit_amount, y, m);
        } else {
          const credit = price.unit_amount - charge;
          if (credit <= 0) { report.skipped++; continue; }
          const breaks = CAL.breaksIn(y, m).map((b) => b.label).join(' + ');
          const from = start && CAL.parts(start).y === y && CAL.parts(start).m === m ? CAL.parts(start).d : 1;
          const lateStart = from > 1 && CAL.ymd(y, m, from) > CAL.firstTrainingDay(CAL.ymd(y, m, 1));
          const days = `${CAL.trainingDaysIn(y, m, from)} of ${f.weekdays} training days`;
          const description = lateStart
            ? `Start credit — ${CAL.MONTHS_LONG[m]}: ${days} from ${CAL.MONTHS[m]} ${from}${breaks ? ' (' + breaks.toLowerCase() + ' off)' : ''}`
            : `${breaks} credit — ${CAL.MONTHS_LONG[m]}: ${days}`;
          const ii = await stripe.invoiceItems.create({ customer: S.customerId(sub.customer), subscription: sub.id, amount: -credit, currency: 'usd', description, metadata: { kind: 'break_credit', month: nextDate.slice(0, 7), subscription: sub.id, player: (sub.metadata && sub.metadata.player) || '' } }, { idempotencyKey: `credit_${sub.id}_${nextDate.slice(0, 7)}` });
          await stripe.subscriptions.update(sub.id, { metadata: { [flag]: ii.id } });
          report.credited.push({ subscription: sub.id, month: nextDate.slice(0, 7), credit, item: ii.id });
          log(`credit ${sub.id} ${nextDate.slice(0, 7)} -$${credit / 100} (${description})`);
          notice = lateStart
            ? `${CAL.MONTHS_LONG[m]} tuition for the ${programShort} program is prorated from your start (${CAL.MONTHS[m]} ${from}): ${days} = $${charge / 100} instead of $${price.unit_amount / 100}, charged on ${CAL.MONTHS[m]} 1. The credit shows on the invoice.`
            : breakMonthNotice(programShort, price.unit_amount, y, m);
        }
        if (ctx.db && notice) {
          const fam = await phoneOf(stripe, S.customerId(sub.customer));
          const p = await ROSTER.findBySubscription(ctx.db, sub.id);
          const told = await ROSTER.tell(ctx.db, 'break', p, { phone: fam.phone, notice, player: sub.metadata && sub.metadata.player });
          if (told.family) report.told++;
        }
      } catch (e) { report.errors.push({ subscription: sub.id, error: e.message }); log(`error ${sub.id}: ${e.message}`); }
    }
  }
  return report;
}

async function applyLatePolicy(stripe, today, log, ctx) {
  today = today || CAL.todayET(); log = log || (() => {}); ctx = ctx || {};
  const report = { checked: 0, failed: [], lateFees: [], holds: [], cancelled: [], errors: [] };
  for await (const inv of stripe.invoices.list({ status: 'open', limit: 100 })) {
    report.checked++;
    try {
      const subId = S.invoiceSubscription(inv);
      if (!subId) continue;                                                                   // one-off invoices (late fees, drop-ins) have their own retries
      if (inv.metadata && inv.metadata.kind === 'late_fee') continue;
      if (!['subscription_cycle', 'subscription_create', 'subscription_update'].includes(inv.billing_reason)) continue;
      if ((inv.amount_due || 0) <= 0) continue;
      const created = CAL.dateOfUnixET(inv.created);
      const age = daysBetween(created, today);                                                // 0 on the 1st, 5 on the 6th, 9 on the 10th, 14 on the 15th
      const monthName = CAL.MONTHS_LONG[CAL.parts(created).m];
      const customer = S.customerId(inv.customer);
      const meta = inv.metadata || {};
      const family = ctx.db ? await phoneOf(stripe, customer) : null;
      const player = ctx.db ? await ROSTER.findBySubscription(ctx.db, subId) : null;
      const words = { phone: family ? family.phone : '', month: monthName, cents: inv.amount_due, url: inv.hosted_invoice_url || '', player: meta.player || '' };
      if (age >= 1 && !meta.failed_notice) {
        // the 2nd: the 1st's charge did not go through (Stripe keeps retrying the card on its own)
        if (ctx.db) await ROSTER.tell(ctx.db, 'failed', player, words);
        await stripe.invoices.update(inv.id, { metadata: { failed_notice: today } });
        report.failed.push({ invoice: inv.id, customer });
        log(`payment failed notice ${inv.id} (${monthName})`);
      }
      if (age >= LATE.late_fee_day - 1 && !meta.late_fee) {
        const fee = await stripe.invoices.create({ customer, collection_method: 'charge_automatically', auto_advance: true, pending_invoice_items_behavior: 'exclude', description: `Late fee — ${monthName} tuition`, metadata: { kind: 'late_fee', for_invoice: inv.id, player: meta.player || '' } }, { idempotencyKey: `latefee_inv_${inv.id}` });
        await stripe.invoiceItems.create({ customer, invoice: fee.id, amount: LATE.late_fee_usd * 100, currency: 'usd', description: `Late fee — ${monthName} tuition unpaid after the ${LATE.grace_until_day}th`, metadata: { kind: 'late_fee', for_invoice: inv.id } }, { idempotencyKey: `latefee_item_${inv.id}` });
        await stripe.invoices.finalizeInvoice(fee.id);
        try { await stripe.invoices.pay(fee.id); } catch (e) { log(`late fee ${fee.id} not collected yet: ${e.message}`); }
        await stripe.invoices.update(inv.id, { metadata: { late_fee: fee.id, late_fee_on: today } });
        report.lateFees.push({ invoice: inv.id, fee: fee.id, customer });
        log(`late fee ${fee.id} for ${inv.id} (${monthName})`);
        if (ctx.db) await ROSTER.tell(ctx.db, 'late_fee', player, words);
      }
      if (age >= LATE.suspend_day - 1 && !meta.hold) {
        await stripe.subscriptions.update(subId, { metadata: { hold: 'true', hold_since: today, hold_invoice: inv.id } });
        await stripe.invoices.update(inv.id, { metadata: { hold: today } });
        report.holds.push({ invoice: inv.id, subscription: subId });
        log(`hold ${subId} (${inv.id} unpaid since ${created})`);
        if (ctx.db) { const p = await ROSTER.setPlan(ctx.db, subId, { hold: true, holdReason: 'unpaid', holdSince: today, holdInvoice: inv.id, invoiceUrl: inv.hosted_invoice_url || '' }, { log }); await ROSTER.tell(ctx.db, 'hold', p || player, Object.assign({ reason: 'unpaid' }, words)); }
      }
      if (age >= LATE.remove_day - 1 && !meta.cancelled) {
        await stripe.subscriptions.cancel(subId, { cancellation_details: { comment: `Unpaid ${monthName} tuition after the ${LATE.remove_day}th — spot released.` } });
        await stripe.invoices.update(inv.id, { metadata: { cancelled: today } });
        report.cancelled.push({ invoice: inv.id, subscription: subId });
        log(`cancelled ${subId} (${inv.id} unpaid since ${created})`);
        if (ctx.db) { const p = await ROSTER.setPlan(ctx.db, subId, { status: 'canceled', hold: false, endsOn: today, cancelledReason: 'unpaid' }, { log }); await ROSTER.tell(ctx.db, 'cancelled', p || player, Object.assign({ reason: 'unpaid' }, words)); }
      }
    } catch (e) { report.errors.push({ invoice: inv.id, error: e.message }); log(`error ${inv.id}: ${e.message}`); }
  }
  return report;
}

/* 3. A hold put on for an unpaid invoice comes off the morning after the invoice is paid (a staff hold has no invoice and stays until released by hand). */
async function releaseHolds(stripe, today, log, ctx) {
  today = today || CAL.todayET(); log = log || (() => {}); ctx = ctx || {};
  const report = { checked: 0, released: [], errors: [] };
  for (const status of ['active', 'past_due', 'trialing']) {
    for await (const sub of stripe.subscriptions.list({ status, limit: 100 })) {
      const m = sub.metadata || {};
      if (m.hold !== 'true' || !m.hold_invoice) continue;
      report.checked++;
      try {
        const inv = await stripe.invoices.retrieve(m.hold_invoice);
        if (!inv || inv.status === 'open' || inv.status === 'draft') continue;
        await stripe.subscriptions.update(sub.id, { metadata: { hold: '', hold_since: '', hold_invoice: '', hold_released: today } });
        report.released.push({ subscription: sub.id, invoice: inv.id });
        log(`hold released ${sub.id} (${inv.id} ${inv.status})`);
        if (ctx.db) {
          const p = await ROSTER.setPlan(ctx.db, sub.id, { hold: false, holdReason: '', holdSince: '', holdInvoice: '', invoiceUrl: '' }, { log });
          const fam = await phoneOf(stripe, S.customerId(sub.customer));
          await ROSTER.tell(ctx.db, 'released', p, { phone: fam.phone, month: CAL.MONTHS_LONG[CAL.parts(CAL.dateOfUnixET(inv.created)).m], player: m.player || '' });
        }
      } catch (e) { report.errors.push({ subscription: sub.id, error: e.message }); log(`error ${sub.id}: ${e.message}`); }
    }
  }
  return report;
}

/* The family notices for an upcoming break month — the words the engine texts (and staff can copy) ahead of the 1st. */
function breakMonthNotice(programShort, priceCents, y, m) {
  const f = CAL.monthFactor(y, m); if (f.factor >= 1) return null;
  const breaks = CAL.breaksIn(y, m);
  const charge = CAL.monthChargeCents(priceCents, y, m, 1);
  const camps = breaks.map((b) => b.camps || b.camp).filter(Boolean).join(', ');
  if (f.factor === 0) return `${CAL.MONTHS_LONG[m]} has no regular training (${breaks.map((b) => b.label).join(', ')}) — there is no tuition charge on ${CAL.MONTHS[m]} 1. ${camps ? camps.charAt(0).toUpperCase() + camps.slice(1) + ' are booked separately.' : ''}`.trim();
  return `Heads-up for ${CAL.MONTHS_LONG[m]}: ${breaks.map((b) => b.label + ' (' + b.from.slice(5).replace('-', '/') + '–' + b.to.slice(5).replace('-', '/') + ')').join(' and ')} ${breaks.length > 1 ? 'are' : 'is'} not part of the ${programShort} program, so the ${CAL.MONTHS[m]} 1 charge is prorated: ${f.trainingDays} of ${f.weekdays} training days = $${charge / 100} instead of $${priceCents / 100}. The credit shows on the invoice. ${camps ? 'Want to train that week? ' + camps.charAt(0).toUpperCase() + camps.slice(1) + ' are booked separately.' : ''}`.trim();
}

module.exports = { convertPaidEnrollments, applyBreakCredits, applyLatePolicy, releaseHolds, breakMonthNotice, daysBetween };
