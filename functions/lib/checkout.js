/* Enrollment and purchases through Stripe Checkout.
   Monthly plan: the plan always bills on the 1st (06:00 Delray Beach time) and Stripe never prorates it. The remaining training days of
   the start month are charged at checkout as a one-time payment computed by the academy's own rule — a plain payment-mode Checkout
   that also saves the card. The moment that payment is confirmed (the thank-you page, or the nightly sweep if the page was never
   opened), the engine creates the monthly subscription on the saved card, anchored to the next 1st with no proration. No Stripe
   "trial" is involved, so families never see trial wording. Two cases skip the one-time payment and let Checkout create the
   subscription directly, anchored to a 1st: a start in a month that has not begun yet (the 1st itself, or any later day — that month is
   billed on its 1st, prorated by the credit job if the start is later than the month's first training day), and a start within two days
   of the next 1st (those one or two days are on the house). Everything else is a one-time payment. */
'use strict';
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');
const ROSTER = require('./roster');
const SMS = require('./sms');

function sameSite(u) { try { const x = new URL(String(u || '')); return x.origin === new URL(SITE).origin ? x.href : ''; } catch (e) { return ''; } }   // a "Back" link only to our own site (Oct 24 audit)
const SITE = 'https://proworld-coach-portal.web.app';
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MIN_CHARGE_LEAD = 49 * 3600;                   // closer than ~2 days to the 1st, the start month is on the house (no separate payment)
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
   'charge' — the start month's training days are paid now (one-time payment, card saved); the plan is created right after, anchored to the next 1st
   'anchor' — nothing is due today; Checkout creates the plan anchored to the 1st given as `anchor` (a start on the 1st, or within two days of it). */
function monthlyQuote(programId, planId, start, today, now) {
  const prog = CAT.program(programId), plan = CAT.plan(programId, planId);
  if (!prog || !plan) throw S.err(400, 'unknown_plan', 'Unknown program or plan.');
  today = today || CAL.todayET();                                                   // a start date is never earlier than today: nobody is billed for days already gone
  now = now || Math.floor(Date.now() / 1000);
  if (plan.every) return cycleQuote(prog, plan, today);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(start || '') && start >= today ? start : today;
  const q = CAL.firstMonthQuote(plan.monthly * 100, startDate);
  if (!q.ok) throw S.err(400, 'no_training_days', q.reason);
  const sp = CAL.parts(q.start);
  let mode, lines, dueCents, anchor, anchorUnix, next;
  if (q.monthFirstUnix > now + 3600) {
    // The start month has not begun (a start on the 1st, or any day of a month still ahead): nothing today — that month is billed on its own 1st
    // like every other month, and the credit job prorates that invoice (a later start day, a school break) before it is created.
    mode = 'anchor'; anchor = q.monthFirst; anchorUnix = q.monthFirstUnix; dueCents = 0;
    next = { date: q.monthFirst, cents: q.cents, note: q.note, label: CAL.MONTHS[sp.m] + ' 1' };
    lines = [{ label: `Nothing due today — ${q.label} is charged on ${next.label}`, cents: 0 }];
  } else if (q.anchorUnix - now >= MIN_CHARGE_LEAD) {
    mode = 'charge'; anchor = q.anchor; anchorUnix = q.anchorUnix; dueCents = q.cents; next = q.next;
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
    : `${first} ${money(next.cents)} on ${next.label}${next.note && mode !== 'anchor' ? ' (' + next.note + ')' : ''},`)
    + ` and ${money(plan.monthly * 100)} on the 1st of every month after — months with a school break are prorated automatically. Cancel from your account any time before the 1st.`;
  return { program: prog, plan, start: q.start, startLabel: 'Starts ' + CAL.MONTHS[sp.m] + ' ' + sp.d, lines, dueCents, then, mode, anchor, anchorUnix, next };
}
/* A plan with its own cycle (the staff test, every 3 days): the first cycle is charged today and the plan renews from now — no 1st, no
   proration, no start-month payment. `mode` 'cycle': Checkout creates the subscription itself with no anchor. */
const DAYS_PER = { day: 1, week: 7, month: 30, year: 365 };
function cycleQuote(prog, plan, today) {
  const cents = plan.monthly * 100; const c = CAT.cycleOf(plan);
  const nextDate = CAL.addDays(today, (DAYS_PER[c.interval] || 1) * c.count);
  const sp = CAL.parts(today), np = CAL.parts(nextDate);
  const first = `First ${c.count > 1 ? c.count + ' ' : ''}${c.interval}${c.count > 1 ? 's' : ''} — charged today`;
  return { program: prog, plan, start: today, startLabel: 'Starts ' + CAL.MONTHS[sp.m] + ' ' + sp.d, lines: [{ label: first, cents }], dueCents: cents,
    then: `Then ${money(cents)} ${CAT.cycleWord(plan)} on the same card, automatically, until you cancel from your account.`,
    mode: 'cycle', anchor: null, anchorUnix: null, next: { date: nextDate, cents, note: '', label: CAL.MONTHS[np.m] + ' ' + np.d } };
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
  const meta = { kind: 'program', program: prog.id, program_name: prog.name, plan: plan.id, plan_label: plan.label, days: sched.join(','), player: playerName, player_dob: player.dob, parent: parent.name, parent_phone: parent.phone, sms_opt_in: body.smsOptIn === true ? 'yes' : 'no', start: q.start, anchor: q.anchorUnix ? String(q.anchorUnix) : '', qbo_class: prog.qbo, source: 'proworld-backend', by: parent.by };
  const description = `${prog.short} · ${plan.label}${sched.length && plan.days < prog.days.length ? ' · ' + sched.join('/') : ''} · ${playerName}`;
  const rules = CAL.RULES.late_policy;
  const late = q.mode === 'cycle' ? '' : ` If a payment is not received by the ${rules.grace_until_day}th, a $${rules.late_fee_usd} late fee applies; training pauses on the ${rules.suspend_day}th and the spot is released on the ${rules.remove_day}th if still unpaid.`;
  const submit = `${q.dueCents > 0 ? 'Due today: ' + q.lines[0].label : q.lines[0].label}. ${q.then}${late}`.slice(0, 1190);
  const common = {
    customer: customer.id,
    customer_update: { name: 'auto', address: 'auto' },
    payment_method_types: ['card'],
    billing_address_collection: 'auto',
    custom_text: { submit: { message: submit } },
    success_url: `${SITE}/enroll/done?s={CHECKOUT_SESSION_ID}`,
    cancel_url: sameSite(body.cancel_url) || `${SITE}/enroll?p=${prog.id}`
  };
  let session;
  if (q.mode === 'charge') {
    if (!prog.firstMonth) throw S.err(409, 'first_month_product', `${prog.name} has no start-month product in Stripe.`);
    // The start month is paid now; the card is saved; the plan is created the moment Stripe confirms the payment (ensureEnrollment).
    session = await stripe.checkout.sessions.create(Object.assign({
      mode: 'payment',
      line_items: [{ price_data: { currency: 'usd', product: prog.firstMonth, unit_amount: q.dueCents }, quantity: 1 }],
      payment_intent_data: { setup_future_usage: 'off_session', description: `${prog.short} · ${q.lines[0].label} · ${playerName}`.slice(0, 1000), metadata: meta },
      invoice_creation: { enabled: true, invoice_data: { description: `${description} — ${q.lines[0].label}`.slice(0, 1500), metadata: meta } },
      metadata: Object.assign({ price: price.id, description }, meta)
    }, common), { idempotencyKey: body.idempotency ? 'enroll_' + S.clean(body.idempotency, 60) : undefined });
  } else if (q.mode === 'cycle') {
    // The plan's own cycle (the staff test): Checkout creates the subscription now — the first cycle is charged today, the next one follows on its own.
    session = await stripe.checkout.sessions.create(Object.assign({
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { description, metadata: meta },
      metadata: Object.assign({ price: price.id, description }, meta)
    }, common), { idempotencyKey: body.idempotency ? 'enroll_' + S.clean(body.idempotency, 60) : undefined });
  } else {
    // Nothing today: Checkout creates the plan itself, anchored to the 1st, no proration (no one-time line, so Stripe allows it).
    session = await stripe.checkout.sessions.create(Object.assign({
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { billing_cycle_anchor: q.anchorUnix, proration_behavior: 'none', description, metadata: meta },
      metadata: Object.assign({ price: price.id, description }, meta)
    }, common), { idempotencyKey: body.idempotency ? 'enroll_' + S.clean(body.idempotency, 60) : undefined });
  }
  return { url: session.url, id: session.id, quote: { lines: q.lines, dueCents: q.dueCents, then: q.then, startLabel: q.startLabel, anchor: q.anchor, mode: q.mode } };
}

/* ── the plan behind a paid start-month payment ──
   Finds the subscription already created for a session (by its metadata), or creates it: the family's plan on the saved card, anchored
   to the 1st recorded on the session, no proration. Safe to call any number of times (the thank-you page, the nightly sweep, a staff retry). */
function paymentMethodOf(session) {
  const pi = session.payment_intent;
  if (!pi || typeof pi === 'string') return null;
  return typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method && pi.payment_method.id || null;
}
function isProgramPayment(session) {
  return !!(session && session.mode === 'payment' && session.metadata && session.metadata.kind === 'program' && session.payment_status === 'paid');
}
async function findEnrollment(stripe, customerId, sessionId) {
  for await (const sub of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100, expand: ['data.items.data.price'] })) {
    if (sub.metadata && sub.metadata.session === sessionId) return sub;
  }
  return null;
}
async function ensureEnrollment(stripe, session, log) {
  log = log || (() => {});
  if (!isProgramPayment(session)) return null;
  const customer = S.customerId(session.customer);
  const existing = await findEnrollment(stripe, customer, session.id);
  if (existing) return existing;
  const m = session.metadata;
  const full = session.payment_intent && typeof session.payment_intent === 'object' ? session : await stripe.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] });
  const pm = paymentMethodOf(full);
  if (!pm) throw S.err(409, 'no_card', 'The payment is in, but Stripe has not reported the saved card yet.');
  const { prog, plan, price } = await S.monthlyPlanPrice(stripe, m.program, m.plan);
  const now = Math.floor(Date.now() / 1000);
  let anchor = parseInt(m.anchor, 10) || 0;
  const meta = Object.assign({}, m, { session: session.id });
  delete meta.price; delete meta.description;
  if (anchor <= now + 60) {
    // The 1st already passed before the plan was created (the page was never opened and the sweep ran late): start on the next 1st and flag it.
    anchor = CAL.unixET(CAL.nextFirst(CAL.todayET()), 6, 0);
    meta.needs_review = 'plan created after its first 1st — check the missed month';
    log(`enrollment ${session.id}: anchor passed, moved to ${CAL.dateOfUnixET(anchor)} (flagged)`);
  }
  await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm } });   // one-off charges on file use the same card
  const sub = await stripe.subscriptions.create({
    customer, items: [{ price: price.id, quantity: 1 }], default_payment_method: pm,
    billing_cycle_anchor: anchor, proration_behavior: 'none',
    description: m.description || `${prog.short} · ${plan.label} · ${m.player || ''}`,
    metadata: meta,
    payment_settings: { payment_method_types: ['card'], save_default_payment_method: 'on_subscription' }
  }, { idempotencyKey: 'plan_' + session.id });
  log(`enrollment ${session.id}: plan ${sub.id} for ${m.player}, first invoice ${CAL.dateOfUnixET(anchor)}`);
  return sub;
}
/* Any paid Checkout that saved a card makes that card the family's card on file, once — a one-time payment (camps, packs, lessons)
   through its payment intent, or a subscription Checkout created (a start on a 1st, the staff test) through the plan's own card.
   Without this, the card sits on the plan only and a private, a camp or a drop-in charged to the file would fail. */
async function ensureCardOnFile(stripe, session, sub) {
  if (!session || !session.customer) return null;
  let pm = null;
  if (session.mode === 'payment' && session.payment_status === 'paid') pm = paymentMethodOf(session);
  else if (session.mode === 'subscription') {
    const s = sub || (session.subscription && typeof session.subscription === 'object' ? session.subscription : null);
    const d = s && s.default_payment_method;
    pm = typeof d === 'string' ? d : d && d.id || null;
  }
  if (!pm) return null;
  const c = typeof session.customer === 'object' ? session.customer : await stripe.customers.retrieve(session.customer);
  if (!c || (c.invoice_settings && c.invoice_settings.default_payment_method)) return null;
  await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: pm } });
  return pm;
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
    const trialLine = items.map((i) => CAT.oneTimeLines()[S.clean(i.lookup, 80)]).find((l) => l && l.kind === 'trial');
    return { url: `${SITE}/enroll/done?trial=1&p=${encodeURIComponent(playerName)}`, id: null, quote: { lines: [{ label: 'FREE Trial Session', cents: 0 }], dueCents: 0 },
      trial: { player, parent, playerName, program: trialLine ? trialLine.program : 'soccer', customer: customer.id, by: parent.by } };
  }
  const description = labels.join(' + ') + ' · ' + playerName + (note ? ' · ' + note : '');
  const meta = { kind: [...kinds].join(','), player: playerName, player_dob: player.dob, parent: parent.name, parent_phone: parent.phone, sms_opt_in: body.smsOptIn === true ? 'yes' : 'no', items: items.map((i) => i.lookup + (i.qty > 1 ? 'x' + i.qty : '')).join(','), note, source: 'proworld-backend', by: parent.by };
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
    cancel_url: sameSite(body.cancel_url) || `${SITE}/enroll`
  }, { idempotencyKey: body.idempotency ? 'buy_' + S.clean(body.idempotency, 60) : undefined });
  return { url: session.url, id: session.id, quote: { lines: quoteLines, dueCents: total } };
}

/* What the thank-you page shows once Stripe sends the family back. For a paid start month this is also where the plan gets created. */
function enrollmentOf(sub, m) {
  const end = S.periodEnd(sub);
  const nextDate = end ? CAL.dateOfUnixET(end) : null;
  const prog = CAT.program(m.program); const plan = CAT.plan(m.program, m.plan);
  let nextCents = null; if (plan && nextDate) nextCents = plan.every ? plan.monthly * 100 : CAL.firstChargeCents(plan.monthly * 100, nextDate, m.start);
  return { program: prog ? prog.name : m.program_name, plan: plan ? plan.label : m.plan_label, days: (m.days || '').split(',').filter(Boolean), start: m.start, subscription: sub.id, status: sub.status, next: nextDate ? { date: nextDate, cents: nextCents } : null, cycle: plan ? CAT.cycleWord(plan) : 'a month' };
}
async function sessionStatus(stripe, id, log, ctx) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id || '')) throw S.err(400, 'session', 'Bad session id.');
  ctx = ctx || {};
  const s = await stripe.checkout.sessions.retrieve(id, { expand: ['subscription', 'customer', 'invoice', 'line_items', 'payment_intent'] });
  const out = { status: s.status, paymentStatus: s.payment_status, mode: s.mode, paid: s.amount_total || 0, player: s.metadata && s.metadata.player, email: s.customer_details && s.customer_details.email, lines: (s.line_items ? s.line_items.data : []).map((l) => ({ label: l.description, cents: l.amount_total })) };
  let sub = null;
  if (s.mode === 'subscription' && s.subscription) {
    sub = s.subscription;
    out.enrollment = enrollmentOf(sub, sub.metadata || {});
    try { await ensureCardOnFile(stripe, s, sub); } catch (e) { /* the plan still charges its own card; the next sweep tries again */ }
  } else if (isProgramPayment(s)) {
    try { sub = await ensureEnrollment(stripe, s, log); if (sub) out.enrollment = enrollmentOf(sub, Object.assign({}, s.metadata, sub.metadata || {})); }
    catch (e) { out.enrollment = { pending: true, program: s.metadata.program_name, plan: s.metadata.plan_label, days: (s.metadata.days || '').split(',').filter(Boolean), start: s.metadata.start, error: e.message }; }
  } else if (s.mode === 'payment') {
    try { await ensureCardOnFile(stripe, s); } catch (e) { /* the card is still attached; the next charge-on-file reports it */ }
  }
  // the roster and the messages — the same minute the family lands here (the nightly sweep repeats it harmlessly)
  if (ctx.db && s.status === 'complete') {
    try { const rec = await ROSTER.record(ctx.db, stripe, s, sub, { log, mode: ctx.mode }); if (rec) out.roster = { player: rec.player || null, created: !!rec.created, tryout: rec.tryout || null }; await SMS.consentFromSession(ctx.db, s, rec); }
    catch (e) { out.rosterError = e.message; if (log) log('roster error ' + s.id + ': ' + e.message); }
  }
  // Oct 24 audit: the thank-you page is reached with the session id in the address bar, so the answer carries no card-portal link and no e-mail;
  // a signed-in family gets the portal link from /api/family/portal.
  delete out.email;
  return out;
}

module.exports = { monthlyQuote, createMonthlySession, createOneTimeSession, sessionStatus, ensureEnrollment, ensureCardOnFile, findEnrollment, isProgramPayment, enrollmentOf, SITE, money };
