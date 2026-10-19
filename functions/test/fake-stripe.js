/* A stand-in Stripe client for the tests: lists are async-iterable like stripe-node's, every call is recorded. */
'use strict';
function listOf(rows) { const p = Promise.resolve({ object: 'list', data: rows, has_more: false }); p[Symbol.asyncIterator] = async function* () { for (const r of rows) yield r; }; p.autoPagingEach = async (fn) => { for (const r of rows) await fn(r); }; return p; }
let seq = 1;
const id = (prefix) => prefix + '_' + (seq++).toString(36).padStart(6, '0');

function fakeStripe(seed) {
  seed = seed || {};
  const db = { prices: seed.prices || [], products: seed.products || {}, customers: seed.customers || [], subscriptions: seed.subscriptions || [], invoices: seed.invoices || [], invoiceItems: [], sessions: [], portalConfigs: seed.portalConfigs || [], portalSessions: [] };
  const calls = [];
  const rec = (name, args) => calls.push({ name, args });
  const stripe = {
    _db: db, _calls: calls,
    prices: { list: (params) => { rec('prices.list', params); const keys = params.lookup_keys || []; return listOf(db.prices.filter((p) => keys.includes(p.lookup_key) && (params.active === undefined || p.active === params.active))); } },
    products: { retrieve: async (pid) => { rec('products.retrieve', pid); const p = db.products[pid]; if (!p) throw Object.assign(new Error('No such product'), { type: 'StripeInvalidRequestError' }); return p; } },
    customers: {
      list: (params) => { rec('customers.list', params); return listOf(db.customers.filter((c) => c.email === params.email)); },
      create: async (params) => { rec('customers.create', params); const c = Object.assign({ id: id('cus'), object: 'customer' }, params); db.customers.push(c); return c; },
      update: async (cid, params) => { rec('customers.update', { cid, params }); const c = db.customers.find((x) => x.id === cid); if (params.invoice_settings) { c.invoice_settings = Object.assign({}, c.invoice_settings, params.invoice_settings); delete params.invoice_settings; } Object.assign(c, params); return c; }
    },
    checkout: { sessions: {
      create: async (params, opts) => { rec('checkout.sessions.create', { params, opts }); const s = Object.assign({ id: id('cs'), object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/' + id('x'), status: 'open', payment_status: 'unpaid', created: Math.floor(Date.now() / 1000), amount_total: (params.line_items || []).reduce((n, l) => n + (l.price_data ? l.price_data.unit_amount * (l.quantity || 1) : 0), 0) }, params); db.sessions.push(s); return s; },
      retrieve: async (sid, params) => { rec('checkout.sessions.retrieve', { sid, params }); const s = db.sessions.find((x) => x.id === sid); if (!s) throw Object.assign(new Error('No such session'), { type: 'StripeInvalidRequestError' }); return s; },
      list: (params) => { rec('checkout.sessions.list', params); return listOf(db.sessions.filter((x) => (!params.status || x.status === params.status))); }
    } },
    paymentIntents: { retrieve: async (pid) => { rec('paymentIntents.retrieve', pid); const s = db.sessions.find((x) => x.payment_intent && (x.payment_intent === pid || x.payment_intent.id === pid)); return s && typeof s.payment_intent === 'object' ? s.payment_intent : { id: pid, payment_method: null }; } },
    subscriptions: {
      list: (params) => { rec('subscriptions.list', params); return listOf(db.subscriptions.filter((s) => (params.status === 'all' || s.status === params.status) && (!params.customer || s.customer === params.customer))); },
      create: async (params, opts) => { rec('subscriptions.create', { params, opts }); const price = db.prices.find((p) => p.id === params.items[0].price) || { id: params.items[0].price }; const sub = Object.assign({ id: id('sub'), object: 'subscription', status: 'active', created: Math.floor(Date.now() / 1000), cancel_at_period_end: false }, params, { items: { data: [{ id: id('si'), price, current_period_end: params.billing_cycle_anchor || null }] } }); db.subscriptions.push(sub); return sub; },
      update: async (sid, params, opts) => { rec('subscriptions.update', { sid, params, opts }); const s = db.subscriptions.find((x) => x.id === sid); if (params.metadata) s.metadata = Object.assign({}, s.metadata, params.metadata); if (params.pause_collection) s.pause_collection = params.pause_collection; if (params.cancel_at_period_end !== undefined) s.cancel_at_period_end = params.cancel_at_period_end; return s; },
      cancel: async (sid, params) => { rec('subscriptions.cancel', { sid, params }); const s = db.subscriptions.find((x) => x.id === sid); s.status = 'canceled'; s.canceled_at = Math.floor(Date.now() / 1000); return s; }
    },
    invoiceItems: { create: async (params, opts) => { rec('invoiceItems.create', { params, opts }); const ii = Object.assign({ id: id('ii'), object: 'invoiceitem' }, params); db.invoiceItems.push(ii); return ii; } },
    invoices: {
      list: (params) => { rec('invoices.list', params); return listOf(db.invoices.filter((i) => i.status === params.status)); },
      create: async (params, opts) => { rec('invoices.create', { params, opts }); const inv = Object.assign({ id: id('in'), object: 'invoice', status: 'draft', amount_due: 0, hosted_invoice_url: 'https://invoice.stripe.com/i/' + id('x') }, params); db.invoices.push(inv); return inv; },
      finalizeInvoice: async (iid) => { rec('invoices.finalizeInvoice', iid); const inv = db.invoices.find((x) => x.id === iid); inv.status = 'open'; inv.amount_due = db.invoiceItems.filter((ii) => ii.invoice === iid).reduce((n, ii) => n + (ii.amount || 0), 0); return inv; },
      pay: async (iid) => { rec('invoices.pay', iid); const inv = db.invoices.find((x) => x.id === iid); if (seed.cardFails) throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' }); inv.status = 'paid'; return inv; },
      update: async (iid, params) => { rec('invoices.update', { iid, params }); const inv = db.invoices.find((x) => x.id === iid); if (params.metadata) inv.metadata = Object.assign({}, inv.metadata, params.metadata); return inv; }
    },
    billingPortal: {
      configurations: { list: async (params) => { rec('billingPortal.configurations.list', params); return { data: db.portalConfigs }; }, create: async (params) => { rec('billingPortal.configurations.create', params); const c = Object.assign({ id: id('bpc'), active: true }, params); db.portalConfigs.push(c); return c; } },
      sessions: { create: async (params) => { rec('billingPortal.sessions.create', params); const s = Object.assign({ id: id('bps'), url: 'https://billing.stripe.com/p/session/' + id('x') }, params); db.portalSessions.push(s); return s; } }
    }
  };
  return stripe;
}
module.exports = { fakeStripe, listOf };
