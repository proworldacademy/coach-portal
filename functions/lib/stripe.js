/* Stripe access for the billing engine: one client per secret, prices resolved by lookup key and checked against the
   published catalog before anything is sold, customers found by email (one Stripe customer = one family). */
'use strict';
const Stripe = require('stripe');
const CAT = require('./catalog');

const API_VERSION = '2025-04-30.basil';
let client = null, clientKey = null;
function stripeFor(secret) {
  if (!secret) throw new Error('STRIPE_SECRET_KEY is not set');
  if (!client || clientKey !== secret) { client = new Stripe(secret, { apiVersion: API_VERSION, maxNetworkRetries: 2, appInfo: { name: 'ProWorld backend', url: 'https://proworld-coach-portal.web.app/backend' } }); clientKey = secret; }
  return client;
}

/* ── prices by lookup key, verified against the catalog ── */
const caches = new WeakMap();                       // one cache per Stripe client (a sandbox key and a live key never share prices)
const TTL = 10 * 60 * 1000;
async function resolvePrices(stripe, lookups) {
  if (!caches.has(stripe)) caches.set(stripe, { at: 0, byLookup: {} });
  const cache = caches.get(stripe);
  const need = [...new Set(lookups)].filter(Boolean);
  const fresh = Date.now() - cache.at < TTL;
  const missing = need.filter((k) => !(fresh && cache.byLookup[k]));
  if (!fresh) cache.byLookup = {};
  for (let i = 0; i < missing.length; i += 10) {   // Stripe takes at most 10 lookup keys per query
    const chunk = missing.slice(i, i + 10);
    const res = await stripe.prices.list({ lookup_keys: chunk, active: true, limit: 100 });
    for (const p of res.data) cache.byLookup[p.lookup_key] = p;
  }
  cache.at = Date.now();
  const out = {};
  for (const k of need) { if (!cache.byLookup[k]) throw err(409, 'price_missing', `No active Stripe price with lookup key ${k}.`); out[k] = cache.byLookup[k]; }
  return out;
}
/* A one-time line from the catalog, with its live Stripe price, refused if the amounts disagree. */
async function oneTimeLine(stripe, lookup) {
  const lines = CAT.oneTimeLines();
  const line = lines[lookup];
  if (!line) throw err(400, 'unknown_item', `Unknown item ${lookup}.`);
  let price;
  if (line.byProduct) { const prod = await stripe.products.retrieve(line.product, { expand: ['default_price'] }); price = prod.default_price; }
  else price = (await resolvePrices(stripe, [lookup]))[lookup];
  if (!price || price.type !== 'one_time') throw err(409, 'price_type', `${lookup} is not a one-time price in Stripe.`);
  if (price.unit_amount !== Math.round(line.price * 100)) throw err(409, 'price_mismatch', `${lookup}: catalog says $${line.price}, Stripe says $${price.unit_amount / 100}. Not sold until they agree.`);
  return { line, price };
}
async function monthlyPlanPrice(stripe, programId, planId) {
  const prog = CAT.program(programId); const plan = CAT.plan(programId, planId);
  if (!prog || !plan) throw err(400, 'unknown_plan', 'Unknown program or plan.');
  const price = (await resolvePrices(stripe, [plan.lookup]))[plan.lookup];
  if (price.type !== 'recurring' || !price.recurring || price.recurring.interval !== 'month') throw err(409, 'price_type', `${plan.lookup} is not a monthly price in Stripe.`);
  if (price.unit_amount !== plan.monthly * 100) throw err(409, 'price_mismatch', `${plan.lookup}: catalog says $${plan.monthly}, Stripe says $${price.unit_amount / 100}. Not sold until they agree.`);
  if (typeof price.product === 'string' ? price.product !== prog.product : price.product.id !== prog.product) throw err(409, 'price_product', `${plan.lookup} belongs to another product in Stripe.`);
  return { prog, plan, price };
}

/* ── one customer per family, keyed by the parent's email ── */
async function findOrCreateCustomer(stripe, parent) {
  const email = String(parent.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(400, 'email', 'A valid parent email is required.');
  const found = await stripe.customers.list({ email, limit: 1 });
  const fields = { name: clean(parent.name, 100), phone: clean(parent.phone, 30) || undefined };
  if (found.data.length) {
    const c = found.data[0];
    const patch = {};
    if (!c.name && fields.name) patch.name = fields.name;
    if (!c.phone && fields.phone) patch.phone = fields.phone;
    return Object.keys(patch).length ? stripe.customers.update(c.id, patch) : c;
  }
  return stripe.customers.create({ email, name: fields.name, phone: fields.phone, metadata: { source: 'proworld-backend', created_by: parent.by || 'enroll' } });
}

/* ── the family's self-service portal (card, invoices, cancel at month end) ── */
const portalIds = new WeakMap();                    // per Stripe client, like the price cache
async function portalConfiguration(stripe) {
  if (portalIds.has(stripe)) return portalIds.get(stripe);
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 10 });
  const ours = list.data.find((c) => c.metadata && c.metadata.proworld === 'family') || list.data.find((c) => c.is_default) || list.data[0];
  if (ours) { portalIds.set(stripe, ours.id); return ours.id; }
  const made = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'ProWorld Academy — your account', privacy_policy_url: 'https://proworldacademy.com/privacy-policy', terms_of_service_url: 'https://proworld-coach-portal.web.app/enroll/agreement' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'phone', 'address', 'name'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'customer_service', 'too_complex', 'low_quality', 'other'] } },
      subscription_update: { enabled: false }
    },
    metadata: { proworld: 'family' }
  });
  portalIds.set(stripe, made.id); return made.id;
}
async function portalUrl(stripe, customerId, returnUrl) {
  const configuration = await portalConfiguration(stripe);
  const s = await stripe.billingPortal.sessions.create({ customer: customerId, configuration, return_url: returnUrl });
  return s.url;
}

/* ── helpers ── */
function clean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200); }
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
/* Subscription fields that moved between API versions (period end lives on the item since 2025). */
function periodEnd(sub) { const it = sub.items && sub.items.data && sub.items.data[0]; return (it && it.current_period_end) || sub.current_period_end || null; }
function invoiceSubscription(inv) { if (typeof inv.subscription === 'string') return inv.subscription; if (inv.subscription && inv.subscription.id) return inv.subscription.id; const p = inv.parent && inv.parent.subscription_details; return p ? (typeof p.subscription === 'string' ? p.subscription : p.subscription && p.subscription.id) : null; }
function customerId(x) { return typeof x === 'string' ? x : x && x.id ? x.id : null; }

module.exports = { stripeFor, resolvePrices, oneTimeLine, monthlyPlanPrice, findOrCreateCustomer, portalUrl, portalConfiguration, clean, err, periodEnd, invoiceSubscription, customerId, API_VERSION };
