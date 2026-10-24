/* The staff side: who may call the admin API (the same rule as the site — owners by account id, or an active staff record that
   holds the backend page), what may change money (owners, administrators and whoever holds the Billing page), and what it
   answers (every family's plan, status and open balance, straight from Stripe). */
'use strict';
const admin = require('firebase-admin');
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');

const OWNERS = ['PDKJkouns6g6zA1jrABJijEr3oq2', 'OLWbZu29WVUWUbN8W9HdPpOZgmj2'];   // the same owner ids as firestore.rules
if (!require('firebase-admin/app').getApps().length) admin.initializeApp();

async function requireStaff(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw S.err(401, 'signin', 'Sign in to the backend first.');
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token, true); } catch (e) { throw S.err(401, 'token', 'Your sign-in has expired — reload the page.'); }
  const email = String(decoded.email || '').toLowerCase();
  const verified = decoded.email_verified === true && decoded.firebase && decoded.firebase.sign_in_provider === 'google.com';
  if (!verified) throw S.err(403, 'provider', 'Only a confirmed Google sign-in can use the backend.');
  if (OWNERS.includes(decoded.uid)) return { uid: decoded.uid, email, name: decoded.name || email, firstName: String(decoded.name || '').split(' ')[0], role: 'owner', owner: true, admin: true, billing: true, texting: true };
  const doc = await admin.firestore().doc('staff/' + email).get();
  const rec = doc.exists ? doc.data() : null;
  const active = !!(rec && rec.active === true);
  const pages = rec && Array.isArray(rec.pages) ? rec.pages : ['coach-portal', 'tryouts'];
  const hasBackend = pages.includes('backend') || pages.some((p) => /^be-/.test(p));
  if (!active || !(rec.owner === true || hasBackend)) throw S.err(403, 'access', 'Your access does not include the backend.');
  const isAdmin = rec.owner === true || rec.role === 'admin';
  const role = String(rec.role || '').toLowerCase();
  const name = rec.name || decoded.name || email;
  // money moves only for owners, administrators and people with the Billing page ticked on the Dashboard;
  // texts to families go out from the same people plus the front desk (role 'desk') — coaches only read the history of their groups
  return { uid: decoded.uid, email, name, firstName: String(name).split(' ')[0], role, owner: rec.owner === true, admin: isAdmin, billing: isAdmin || pages.includes('billing'), texting: isAdmin || role === 'desk' || pages.includes('billing') };
}
function requireBilling(who) { if (!who || !who.billing) throw S.err(403, 'billing', 'Live billing actions (hold, cancel, charge, account links) need the Billing page — ask an owner to tick it for you.'); }

function planOf(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0]; const price = item && item.price;
  const lookup = price && price.lookup_key;
  for (const p of CAT.PROGRAMS) for (const pl of p.plans) if (pl.lookup === lookup) return { program: p, plan: pl, price };
  for (const m of CAT.MEMBERSHIP) if (m.lookup === lookup) return { program: { id: 'membership', short: 'Court membership', name: m.label, qbo: 'Court rentals' }, plan: { id: m.id, label: m.label, monthly: m.price, days: 0 }, price };
  return { program: null, plan: null, price };
}

/* Every subscription (any status) with its family, next charge and the latest invoice. */
async function overview(stripe) {
  const subs = [];
  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer', 'data.latest_invoice', 'data.items.data.price'] })) {
    if (sub.status === 'canceled' && sub.canceled_at && Date.now() / 1000 - sub.canceled_at > 120 * 86400) continue;
    const { program, plan, price } = planOf(sub); const m = sub.metadata || {}; const c = typeof sub.customer === 'object' ? sub.customer : { id: sub.customer };
    const end = S.periodEnd(sub); const nextDate = end ? CAL.dateOfUnixET(end) : null;
    let nextCents = null; if (plan && nextDate && sub.status !== 'canceled' && !sub.cancel_at_period_end) nextCents = plan.every ? plan.monthly * 100 : CAL.firstChargeCents(plan.monthly * 100, nextDate, m.start);
    const li = sub.latest_invoice && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
    subs.push({ id: sub.id, session: m.session || null, needsReview: m.needs_review || null, status: sub.status, hold: m.hold === 'true', holdSince: m.hold_since || null, holdBy: m.hold_by || null, holdInvoice: m.hold_invoice || null, cancelAtPeriodEnd: !!sub.cancel_at_period_end, paused: !!sub.pause_collection,
      player: m.player || '', playerDob: m.player_dob || '', parent: m.parent || '', parentPhone: m.parent_phone || '', program: program ? program.short : (m.program || '—'), programId: program ? program.id : m.program || '', plan: plan ? plan.label : (m.plan_label || (price ? '$' + price.unit_amount / 100 : '—')), days: (m.days || '').split(',').filter(Boolean), monthly: plan ? plan.monthly : price ? price.unit_amount / 100 : null, cycle: plan ? CAT.cycleWord(plan) : 'a month', test: !!(program && program.hidden), qbo: program ? program.qbo : '',
      start: m.start || CAL.dateOfUnixET(sub.created), created: CAL.dateOfUnixET(sub.created), next: nextDate ? { date: nextDate, cents: nextCents } : null,
      customer: { id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '' },
      latestInvoice: li ? { id: li.id, status: li.status, amountDue: li.amount_due, amountPaid: li.amount_paid, total: li.total, created: CAL.dateOfUnixET(li.created), url: li.hosted_invoice_url || null, lateFee: (li.metadata || {}).late_fee || null } : null });
  }
  const open = [];
  for await (const inv of stripe.invoices.list({ status: 'open', limit: 100, expand: ['data.customer'] })) {
    const c = typeof inv.customer === 'object' ? inv.customer : { id: inv.customer };
    open.push({ id: inv.id, created: CAL.dateOfUnixET(inv.created), amountDue: inv.amount_due, description: inv.description || (inv.lines && inv.lines.data[0] && inv.lines.data[0].description) || '', kind: (inv.metadata || {}).kind || (S.invoiceSubscription(inv) ? 'tuition' : 'one-off'), subscription: S.invoiceSubscription(inv), url: inv.hosted_invoice_url || null, customer: { id: c.id, name: c.name || '', email: c.email || '' }, player: (inv.metadata || {}).player || '' });
  }
  // Paid start months (last 30 days) whose plan does not exist yet — the family never reached the thank-you page and the sweep has not run.
  const pending = [];
  const bySession = new Set(subs.map((s) => s.session).filter(Boolean));
  for await (const cs of stripe.checkout.sessions.list({ status: 'complete', created: { gte: Math.floor(Date.now() / 1000) - 30 * 86400 }, limit: 100 })) {
    if (cs.mode !== 'payment' || !cs.metadata || cs.metadata.kind !== 'program' || cs.payment_status !== 'paid' || bySession.has(cs.id)) continue;
    const m = cs.metadata; const prog = CAT.program(m.program);
    pending.push({ session: cs.id, player: m.player || '', program: prog ? prog.short : m.program, plan: m.plan_label || m.plan, start: m.start, paid: cs.amount_total || 0, created: CAL.dateOfUnixET(cs.created), customer: S.customerId(cs.customer) });
  }
  subs.sort((a, b) => (a.player || '').localeCompare(b.player || ''));
  const active = subs.filter((s) => ['active', 'past_due', 'trialing'].includes(s.status));
  return { at: new Date().toISOString(), today: CAL.todayET(), pending, counts: { subscriptions: active.length, onHold: active.filter((s) => s.hold).length, pastDue: subs.filter((s) => s.status === 'past_due').length, openInvoices: open.length, openAmount: open.reduce((n, i) => n + (i.amountDue || 0), 0), monthlyRun: active.reduce((n, s) => n + (s.next && s.next.cents ? s.next.cents : 0), 0) }, subscriptions: subs, openInvoices: open };
}

/* Charge the card on file for a one-time line (an unscheduled session flagged by attendance, a court booking, a pack, a camp). */
async function chargeOnFile(stripe, body, who) {
  const customer = S.clean(body.customer, 60); if (!/^cus_/.test(customer)) throw S.err(400, 'customer', 'A customer id is required.');
  const { line, price } = await S.oneTimeLine(stripe, S.clean(body.lookup, 80));
  const qty = Math.max(1, Math.min(20, parseInt(body.qty, 10) || 1));
  const description = S.clean(body.description, 200) || line.label;
  const inv = await stripe.invoices.create({ customer, collection_method: 'charge_automatically', auto_advance: true, pending_invoice_items_behavior: 'exclude', description, metadata: { kind: line.kind, lookup: line.lookup, player: S.clean(body.player, 80), by: who.email, qbo_class: line.qbo || '' } });
  await stripe.invoiceItems.create({ customer, invoice: inv.id, price: price.id, quantity: qty, description, metadata: { kind: line.kind, lookup: line.lookup } });
  const fin = await stripe.invoices.finalizeInvoice(inv.id);
  let paid = false, error = null;
  try { const p = await stripe.invoices.pay(fin.id); paid = p.status === 'paid'; } catch (e) { error = e.message; }
  return { invoice: fin.id, paid, error, url: fin.hosted_invoice_url, amount: fin.amount_due, label: line.label, kind: line.kind, lookup: line.lookup, qty, sessions: (line.sessions || 0) * qty, hours: (line.hours || 0) * qty };
}

module.exports = { requireStaff, requireBilling, overview, chargeOnFile, planOf };
