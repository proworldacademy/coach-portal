/* Enrollment and purchases through Stripe Checkout.
   Monthly plan: the plan itself always bills on the 1st (06:00 Delray Beach time) and Stripe never prorates it. The remaining training
   days of the start month are charged at checkout as a one-time line computed by the academy's own rule. Stripe refuses "no proration"
   next to a one-time line, so the plan reaches its first 1st through a trial that ends exactly there (same card, same subscription, first
   recurring invoice on the 1st). Two edge cases skip the one-time line and simply anchor the plan to the 1st: a start on the 1st itself
   (the whole month is billed that morning, as every other month) and a start within two days of the 1st (Stripe needs a trial to be at
   least 48 hours out; those one or two days are on the house). Everything else is a one-time payment. */
'use strict';
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');

const SITE = 'https://proworld-coach-portal.web.app';
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MIN_TRIAL_SECONDS = 49 * 3600;                 // Stripe: a Checkout trial must end at least 48 hours in the future (an hour of margin)
const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

function validatePeople(body) {
  const pl = body.player || {}, pa = body.parent || {};
  const player = { first: S.clean(pl.first, 60), last: S.clean(pl.last, 60), dob: /^\d{4}-\d{2}-\d{2}$/.test(pl.dob || '') ? pl.dob : '' };
  const parent = { name: S.clean(pa.name, 100), email: S.clean(pa.email, 120).toLowerCase(), phone: S.clean(pa.phone, 30), by: S.clean(body.by || 'enroll', 40) };
  if (!player.first || !player.last) throw S.err(400, 'player', 'Player first and last name are required.');
  if (!parent.name) throw S.err(400, 'parent', 'The parent or guardian name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(parent.email)) throw S.err(400, 'email', 'A valid email is required.');
  if (parent.phone.replace(/\D/g, '').length < 10) throw S.err(400, 'phone', 'A mobile number is required.');
  if (body.agree !== true) throw S.err(400, 'agree', 'The enrollment agreement must be accepted.');
  return { player, parent, playerName: player.first + ' ' + player.last };
}

/* The quote the page shows before the card: what is due today and what follows. `mode` is how the subscription reaches its first 1st:
   'trial'  — the start month's training days are charged now as a one-time line; the plan starts billing on the next 1st (trial ends there)
   'anchor' — nothing is due today; the plan is anchored to the 1st given as `anchor` (a start on the 1st, or a start within two days of it). */
function monthlyQuote(programId, planId, start, today, now) {
  const prog = CAT.program(programId), plan = CAT.plan(programId, planId);
  if (!prog || !plan) throw S.err(400, 'unknown_plan', 'Unknown program or plan.');
  today = today || CAL.todayET();                                                   // a start date is never earlier than today: nobody is billed for days already gone
  now = now || Math.floor(Date.now() / 1000);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(start || '') && start >= today ? start : today;
  const q = CAL.firstMonthQuote(plan.monthly * 100, startDate);
  if (!q.ok) throw S.err(400, 'no_training_days', q.reason);
  const sp = CAL.parts(q.start);
  const startUnix = CAL.unixET(q.start, 6, 0);
  let mode, lines, dueCents, anchor, anchorUnix, next;
  if (sp.d === 1 && startUnix > now + 3600) {
    // Starting on a 1st: that month is billed that morning like any other month, break-adjusted by the credit job — nothing today.
    mode = 'anchor'; anchor = q.start; anchorUnix = startUnix; dueCents = 0;
    next = { date: q.start, cents: q.cents, note: CAL.monthNote(sp.y, sp.m), label: CAL.MONTHS[sp.m] + ' 1' };
    lines = [{ label: `Nothing due today — ${CAL.MONTHS_LONG[sp.m]} tuition is charged on ${next.label}`, cents: 0 }];
  } else if (q.anchorUnix - now >= MIN_TRIAL_SECONDS) {
    mode = 'trial'; anchor = q.anchor; anchorUnix = q.anchorUnix; dueCents = q.cents; next = q.next;
    lines = [{ label: q.label, cents: q.cents }];
  } else {
    // The 1st is less than two days away: the day or two of training before it is on the house; the plan simply starts on the 1st.
    mode = 'anchor'; anchor = q.anchor; anchorUnix = q.anchorUnix; dueCents = 0; next = q.next;
    lines = [{ label: `${CAL.MONTHS[sp.m]} ${sp.d}–${CAL.daysInMonth(sp.y, sp.m)}: on us — nothing due today`, cents: 0 }];
  }
  const an = CAL.parts(anchor);
  const first = dueCents > 0 ? 'Then' : 'First charge:';
  const then = (next.cents === 0
    ? `No charge on ${next.label} (${CAL.breaksIn(an.y, an.m).map((b) => b.label.toLowerCase()).join(', ')}).`
    : `${first} ${money(next.cents)} on ${next.label}${next.note ? ' (' + next.note + ')' : ''},`)
    + ` and ${money(plan.monthly * 100)} on the 1st of every month after — months with a school break are prorated automatically. Cancel from your account any time before the 1st.`;
  return { program: prog, plan, start: q.start, startLabel: 'Starts ' + CAL.MONTHS[sp.m] + ' ' + sp.d, lines, dueCents, then, mode, anchor, anchorUnix, next };
}

async function createMonthlySession(stripe, body) {
  const { player, parent, playerName } = validatePeople(body);
  if (body.authorize !== true) throw S.err(400, 'authorize', 'The monthly charge must be authorized.');
  const { prog, plan, price } = await S.monthlyPlanPrice(stripe, body.program, body.plan);
  const days = Array.isArray(body.days) ? body.days.filter((d) => prog.days.includes(d)) : [];
  if (prog.plans.length && plan.days < prog.days.length && days.length !== plan.days) throw S.err(400, 'days', `Pick ${plan.days} training day${plan.days > 1 ? 's' : ''}.`);
  const sched = plan.days >= prog.days.length ? prog.days : days.sort((a, b) => DOWS.indexOf(a) - DOWS.indexOf(b));
  const q = monthlyQuote(prog.id, plan.id, body.start, body._today, body._now);
  const customer = await S.findOrCreateCustomer(stripe, parent);
  const meta = { kind: 'program', program: prog.id, program_name: prog.name, plan: plan.id, plan_label: plan.label, days: sched.join(','), player: playerName, player_dob: player.dob, parent: parent.name, parent_phone: parent.phone, start: q.start, qbo_class: prog.qbo, source: 'proworld-backend', by: parent.by };
  const line_items = [{ price: price.id, quantity: 1 }];
  const subscription_data = { description: `${prog.short} · ${plan.label}${sched.length && plan.days < prog.days.length ? ' · ' + sched.join('/') : ''} · ${playerName}`, metadata: meta };
  if (q.mode === 'trial') {
    line_items.push({ price_data: { currency: 'usd', product: prog.product, unit_amount: q.dueCents }, quantity: 1 });
    subscription_data.trial_end = q.anchorUnix;                                   // the plan's first invoice is on the 1st; no Stripe proration
  } else {
    subscription_data.billing_cycle_anchor = q.anchorUnix;                        // nothing today; the 1st opens the first period
    subscription_data.proration_behavior = 'none';
  }
  const rules = CAL.RULES.late_policy;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    customer_update: { name: 'auto', address: 'auto' },
    line_items,
    subscription_data,
    payment_method_types: ['card'],
    billing_address_collection: 'auto',
    custom_text: {
      submit: { message: `${q.dueCents > 0 ? 'Due today: ' + q.lines[0].label : q.lines[0].label}. ${q.then} If a payment is not received by the ${rules.grace_until_day}th, a $${rules.late_fee_usd} late fee applies; training pauses on the ${rules.suspend_day}th and the spot is released on the ${rules.remove_day}th if still unpaid.`.slice(0, 1190) }
    },
    metadata: Object.assign({ player: playerName, program: prog.id, plan: plan.id, kind: 'program' }, {}),
    success_url: `${SITE}/enroll/done?s={CHECKOUT_SESSION_ID}`,
    cancel_url: body.cancel_url && String(body.cancel_url).startsWith(SITE) ? body.cancel_url : `${SITE}/enroll?p=${prog.id}`
  }, { idempotencyKey: body.idempotency ? 'enroll_' + S.clean(body.idempotency, 60) : undefined });
  return { url: session.url, id: session.id, quote: { lines: q.lines, dueCents: q.dueCents, then: q.then, startLabel: q.startLabel, anchor: q.anchor, mode: q.mode } };
}

/* One-time purchases: camps, flex packs, weekly, drop-ins, fitness packs, lesson packages, private lessons, court reservations. */
async function createOneTimeSession(stripe, body) {
  const { player, parent, playerName } = validatePeople(body);
  const items = Array.isArray(body.items) ? body.items.slice(0, 10) : [];
  if (!items.length) throw S.err(400, 'items', 'Nothing to buy.');
  const customer = await S.findOrCreateCustomer(stripe, parent);
  const line_items = []; const labels = []; const quoteLines = []; let total = 0; let kinds = new Set();
  for (const it of items) {
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    const { line, price } = await S.oneTimeLine(stripe, S.clean(it.lookup, 80));
    if (line.kind === 'trial') continue;                                        // free: nothing to charge (registered below)
    line_items.push({ price: price.id, quantity: qty }); labels.push(line.label + (qty > 1 ? ' × ' + qty : '')); quoteLines.push({ label: line.label + (qty > 1 ? ' × ' + qty : ''), cents: price.unit_amount * qty }); total += price.unit_amount * qty; kinds.add(line.kind);
  }
  const note = S.clean(body.note, 200);
  if (!line_items.length) {                                                       // free trial only: register the family, no payment
    await stripe.customers.update(customer.id, { metadata: { last_trial: CAL.todayET() + ' · ' + playerName } });
    return { url: `${SITE}/enroll/done?trial=1&p=${encodeURIComponent(playerName)}`, id: null, quote: { lines: [{ label: 'FREE Trial Session', cents: 0 }], dueCents: 0 } };
  }
  const description = labels.join(' + ') + ' · ' + playerName + (note ? ' · ' + note : '');
  const meta = { kind: [...kinds].join(','), player: playerName, player_dob: player.dob, parent: parent.name, parent_phone: parent.phone, items: items.map((i) => i.lookup + (i.qty > 1 ? 'x' + i.qty : '')).join(','), note, source: 'proworld-backend', by: parent.by };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customer.id,
    customer_update: { name: 'auto', address: 'auto' },
    line_items,
    payment_method_types: ['card'],
    payment_intent_data: { description: description.slice(0, 1000), metadata: meta, setup_future_usage: 'off_session' },
    invoice_creation: { enabled: true, invoice_data: { description: description.slice(0, 1500), metadata: meta } },
    metadata: meta,
    success_url: `${SITE}/enroll/done?s={CHECKOUT_SESSION_ID}`,
    cancel_url: body.cancel_url && String(body.cancel_url).startsWith(SITE) ? body.cancel_url : `${SITE}/enroll`
  }, { idempotencyKey: body.idempotency ? 'buy_' + S.clean(body.idempotency, 60) : undefined });
  return { url: session.url, id: session.id, quote: { lines: quoteLines, dueCents: total } };
}

/* What the thank-you page shows once Stripe sends the family back. */
async function sessionStatus(stripe, id) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id || '')) throw S.err(400, 'session', 'Bad session id.');
  const s = await stripe.checkout.sessions.retrieve(id, { expand: ['subscription', 'customer', 'invoice', 'line_items'] });
  const out = { status: s.status, paymentStatus: s.payment_status, mode: s.mode, paid: s.amount_total || 0, player: s.metadata && s.metadata.player, email: s.customer_details && s.customer_details.email, lines: (s.line_items ? s.line_items.data : []).map((l) => ({ label: l.description, cents: l.amount_total })) };
  if (s.mode === 'subscription' && s.subscription) {
    const sub = s.subscription; const m = sub.metadata || {};
    const end = S.periodEnd(sub);
    const nextDate = end ? CAL.dateOfUnixET(end) : null;
    const prog = CAT.program(m.program); const plan = CAT.plan(m.program, m.plan);
    let nextCents = null; if (plan && nextDate) { const p = CAL.parts(nextDate); nextCents = CAL.monthChargeCents(plan.monthly * 100, p.y, p.m, 1); }
    out.enrollment = { program: prog ? prog.name : m.program_name, plan: plan ? plan.label : m.plan_label, days: (m.days || '').split(',').filter(Boolean), start: m.start, subscription: sub.id, status: sub.status, next: nextDate ? { date: nextDate, cents: nextCents } : null };
  }
  if (s.status === 'complete' && s.customer) { try { out.portalUrl = await S.portalUrl(stripe, S.customerId(s.customer), `${SITE}/enroll/done?s=${id}`); } catch (e) { out.portalUrl = null; } }
  return out;
}

module.exports = { monthlyQuote, createMonthlySession, createOneTimeSession, sessionStatus, SITE, money };
