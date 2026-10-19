/* Enrollment and purchases through Stripe Checkout.
   Monthly plan: the subscription is anchored to the next 1st (06:00 Delray Beach time) with no Stripe proration; the remaining training
   days of the start month are charged now as a one-time line computed by the academy's own rule. Everything else is a one-time payment. */
'use strict';
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');

const SITE = 'https://proworld-coach-portal.web.app';
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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

/* The quote the page shows before the card: what is due today and what follows. */
function monthlyQuote(programId, planId, start, today) {
  const prog = CAT.program(programId), plan = CAT.plan(programId, planId);
  if (!prog || !plan) throw S.err(400, 'unknown_plan', 'Unknown program or plan.');
  today = today || CAL.todayET();                                                   // a start date is never earlier than today: nobody is billed for days already gone
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(start || '') && start >= today ? start : today;
  const q = CAL.firstMonthQuote(plan.monthly * 100, startDate);
  if (!q.ok) throw S.err(400, 'no_training_days', q.reason);
  const an = CAL.parts(q.anchor);
  const lines = [{ label: q.label, cents: q.cents }];
  const then = (q.next.cents === 0
    ? `No charge on ${q.next.label} (${CAL.breaksIn(an.y, an.m).map((b) => b.label.toLowerCase()).join(', ')}).`
    : `Then ${money(q.next.cents)} on ${q.next.label}${q.next.note ? ' (' + q.next.note + ')' : ''},`)
    + ` and ${money(plan.monthly * 100)} on the 1st of every month after — months with a school break are prorated automatically. Cancel from your account any time before the 1st.`;
  return { program: prog, plan, start: q.start, startLabel: 'Starts ' + CAL.MONTHS[CAL.parts(q.start).m] + ' ' + CAL.parts(q.start).d, lines, dueCents: q.cents, then, anchor: q.anchor, anchorUnix: q.anchorUnix, next: q.next };
}

async function createMonthlySession(stripe, body) {
  const { player, parent, playerName } = validatePeople(body);
  if (body.authorize !== true) throw S.err(400, 'authorize', 'The monthly charge must be authorized.');
  const { prog, plan, price } = await S.monthlyPlanPrice(stripe, body.program, body.plan);
  const days = Array.isArray(body.days) ? body.days.filter((d) => prog.days.includes(d)) : [];
  if (prog.plans.length && plan.days < prog.days.length && days.length !== plan.days) throw S.err(400, 'days', `Pick ${plan.days} training day${plan.days > 1 ? 's' : ''}.`);
  const sched = plan.days >= prog.days.length ? prog.days : days.sort((a, b) => DOWS.indexOf(a) - DOWS.indexOf(b));
  const q = monthlyQuote(prog.id, plan.id, body.start, body._today);
  const customer = await S.findOrCreateCustomer(stripe, parent);
  const meta = { kind: 'program', program: prog.id, program_name: prog.name, plan: plan.id, plan_label: plan.label, days: sched.join(','), player: playerName, player_dob: player.dob, parent: parent.name, parent_phone: parent.phone, start: q.start, qbo_class: prog.qbo, source: 'proworld-backend', by: parent.by };
  const line_items = [{ price: price.id, quantity: 1 }];
  if (q.dueCents > 0) line_items.push({ price_data: { currency: 'usd', product: prog.product, unit_amount: q.dueCents }, quantity: 1 });
  const rules = CAL.RULES.late_policy;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    customer_update: { name: 'auto', address: 'auto' },
    line_items,
    subscription_data: {
      billing_cycle_anchor: q.anchorUnix,
      proration_behavior: 'none',
      description: `${prog.short} · ${plan.label}${sched.length && plan.days < prog.days.length ? ' · ' + sched.join('/') : ''} · ${playerName}`,
      metadata: meta
    },
    payment_method_types: ['card'],
    billing_address_collection: 'auto',
    custom_text: {
      submit: { message: `Due today: ${q.lines[0].label.toLowerCase()}. ${q.then.replace(/^Then /, 'Then ')} If a payment is not received by the ${rules.grace_until_day}th, a $${rules.late_fee_usd} late fee applies; training pauses on the ${rules.suspend_day}th and the spot is released on the ${rules.remove_day}th if still unpaid.`.slice(0, 1190) }
    },
    metadata: Object.assign({ player: playerName, program: prog.id, plan: plan.id, kind: 'program' }, {}),
    success_url: `${SITE}/enroll/done?s={CHECKOUT_SESSION_ID}`,
    cancel_url: body.cancel_url && String(body.cancel_url).startsWith(SITE) ? body.cancel_url : `${SITE}/enroll?p=${prog.id}`
  }, { idempotencyKey: body.idempotency ? 'enroll_' + S.clean(body.idempotency, 60) : undefined });
  return { url: session.url, id: session.id, quote: { lines: q.lines, dueCents: q.dueCents, then: q.then, startLabel: q.startLabel, anchor: q.anchor } };
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
