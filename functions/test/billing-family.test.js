'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const B = require('../lib/billing');
const { fakeDb } = require('./fake-db');

/* Billing a family reads by itself (Nov 22, 2026). Invented family; Stripe is a stand-in. */
const U = (iso) => Math.floor(Date.parse(iso + 'T15:00:00Z') / 1000);
const list = (rows) => ({ async *[Symbol.asyncIterator]() { for (const r of rows) yield r; } });
function stripeStub(seed) {
  const calls = []; const cus = seed.customer;
  return { calls,
    charges: { list: () => list(seed.charges || []) },
    invoices: { list: (p) => list((seed.invoices || []).filter((i) => i.status === p.status)),
      update: async (id, p) => { calls.push(['inv.update', id, p]); const i = seed.invoices.find((x) => x.id === id); i.metadata = Object.assign({}, i.metadata, p.metadata); return i; },
      pay: async (id, p) => { calls.push(['inv.pay', id, p]); if (seed.backupFails) throw new Error('Your card was declined.'); const i = seed.invoices.find((x) => x.id === id); i.status = 'paid'; return i; } },
    checkout: { sessions: { list: () => list(seed.sessions || []), create: async (p) => { calls.push(['cs.create', p]); return { id: 'cs_new', url: 'https://checkout.stripe.test/setup' }; },
      retrieve: async (id) => { const s = (seed.sessions || []).find((x) => x.id === id); if (!s) throw new Error('No such session'); return s; } } },
    customers: { retrieve: async () => cus, update: async (id, p) => { calls.push(['cus.update', p]); if (p.invoice_settings) cus.invoice_settings = Object.assign({}, cus.invoice_settings, p.invoice_settings); if (p.metadata) cus.metadata = Object.assign({}, cus.metadata, p.metadata); return cus; } },
    paymentMethods: { retrieve: async (id) => ({ id, card: { brand: 'mastercard', last4: '5454', exp_month: 3, exp_year: 2029 } }), detach: async (id) => { calls.push(['pm.detach', id]); } },
    subscriptions: { list: () => list(seed.subs || []), update: async (id, p) => { calls.push(['sub.update', id, p]); } } };
}
const seed = () => ({
  customer: { id: 'cus_1', invoice_settings: { default_payment_method: { id: 'pm_main', card: { brand: 'visa', last4: '4242', exp_month: 11, exp_year: 2028 } } }, metadata: {} },
  charges: [{ payment_intent: 'pi_court', status: 'succeeded', amount_refunded: 3000, receipt_url: 'https://pay.stripe.test/r/court' }, { payment_intent: 'pi_camp', status: 'succeeded', amount_refunded: 0, receipt_url: '' }],
  invoices: [
    { id: 'in_tu', status: 'paid', created: U('2026-11-01'), amount_paid: 189000, invoice_pdf: 'https://pay.stripe.test/in_tu.pdf', parent: { subscription_details: { subscription: 'sub_1', metadata: { player: 'Liam Rivera', program_name: 'Full Time' } } } },
    { id: 'in_camp', status: 'paid', created: U('2026-11-12'), amount_paid: 47500, description: 'Thanksgiving Camp, full days · Mia Rivera', metadata: { kind: 'camp', player: 'Mia Rivera' }, payments: { data: [{ payment: { payment_intent: 'pi_camp' } }] } },
    { id: 'in_pv', status: 'paid', created: U('2026-11-20'), amount_paid: 11000, description: 'Private lesson, 1 hour', metadata: { kind: 'private', player: 'u10-mia' } },
    { id: 'in_zero', status: 'paid', created: U('2026-11-21'), amount_paid: 0 },
    { id: 'in_open', status: 'open', created: U('2026-11-01'), amount_due: 195000, attempted: true, customer: 'cus_1', collection_method: 'charge_automatically' }],
  sessions: [
    { id: 'cs_court', mode: 'payment', payment_status: 'paid', created: U('2026-11-18'), amount_total: 3000, payment_intent: 'pi_court', metadata: { kind: 'court-rental' }, line_items: { data: [{ description: 'Court rental, 1 hour' }] } },
    { id: 'cs_inv', mode: 'payment', payment_status: 'paid', created: U('2026-11-12'), amount_total: 47500, invoice: 'in_camp', metadata: {} },
    { id: 'cs_setup', mode: 'setup', customer: 'cus_1', metadata: { kind: 'backup_card' }, setup_intent: { status: 'succeeded', payment_method: 'pm_back' } },
    { id: 'cs_other', mode: 'setup', customer: 'cus_other', metadata: { kind: 'backup_card' }, setup_intent: { status: 'succeeded', payment_method: 'pm_x' } }]
});
const CUS = [{ id: 'cus_1', name: 'Maria Rivera' }];

test('billing: every payment line by line, with what came back, and the picks for an invoice', async () => {
  const st = stripeStub(seed());
  const a = await B.activity(st, CUS, { today: '2026-11-22', names: { 'u10-mia': 'Mia Rivera' } });
  assert.deepEqual(a.items.map((x) => [x.date, x.label, x.player, x.cat, x.cents, x.refunded]), [
    ['2026-11-20', 'Private lesson, 1 hour', 'Mia Rivera', 'private', 11000, 0],
    ['2026-11-18', 'Court rental, 1 hour', '', 'extra', 3000, 3000],
    ['2026-11-12', 'Thanksgiving Camp, full days', 'Mia Rivera', 'extra', 47500, 0],
    ['2026-11-01', 'Full Time, November tuition', 'Liam Rivera', 'tuition', 189000, 0]]);
  assert.equal(a.items[3].receipt, 'https://pay.stripe.test/in_tu.pdf'); assert.equal(a.items[1].receipt, 'https://pay.stripe.test/r/court');
  assert.deepEqual(B.totals(a.items), { count: 4, paid: 247500 });
  assert.equal(B.pick(a.items, { what: 'tuition' }).length, 1); assert.equal(B.pick(a.items, { player: 'mia rivera' }).length, 2);
  assert.equal(B.pick(a.items, { from: '2026-11-10', to: '2026-11-19' }).length, 2); assert.equal(B.pick(a.items, { what: 'nonsense' }).length, 4);
  const buf = await B.pdf({ name: 'Maria Rivera', email: 'maria.rivera@example.test', from: '2026-11-01', to: '2026-11-22', what: 'all', player: '', items: a.items, today: '2026-11-22' });
  assert.equal(buf.slice(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 3000);
});

test('billing: the invoice link holds the picks for fifteen minutes and does not go back further than the list', async () => {
  const db = fakeDb({});
  const o = await B.link(db, { email: 'Maria.Rivera@example.test', name: 'Maria Rivera' }, { from: '2026-10-01', to: '2026-10-31', what: 'private', player: 'Mia Rivera' }, '2026-11-22');
  assert.match(o.url, /^\/api\/family\/invoice\/[a-f0-9]{48}\.pdf$/);
  const x = (await db.doc('familyInvoiceLinks/' + o.url.split('/').pop().replace('.pdf', '')).get()).data();
  assert.equal(x.email, 'maria.rivera@example.test'); assert.equal(x.what, 'private'); assert.ok(x.exp > Date.now() && x.exp < Date.now() + 16 * 60000);
  await assert.rejects(() => B.link(db, { email: 'a@example.test' }, { from: '2024-01-01', to: '2024-02-01' }, '2026-11-22'), /about a year/);
});

test('billing: a backup card is added on Stripe\'s page, shown, swapped and removed; another family\'s session is refused', async () => {
  const s = seed(); const st = stripeStub(s);
  assert.deepEqual(await B.cards(st, CUS), [{ customer: 'cus_1', main: { id: 'pm_main', brand: 'Visa', last4: '4242', exp: '11/28' }, backup: null }]);
  const go = await B.backupStart(st, CUS, {}, 'https://site.test'); assert.match(go.url, /checkout/); assert.equal(st.calls[0][1].mode, 'setup');
  await assert.rejects(() => B.backupConfirm(st, CUS, { session: 'cs_other' }), /payment account|not saved/);
  assert.deepEqual(await B.backupConfirm(st, CUS, { session: 'cs_setup' }), { ok: true, as: 'backup' }); assert.equal(s.customer.metadata.backup_pm, 'pm_back');
  assert.equal((await B.cards(st, CUS))[0].backup.last4, '5454');
  s.subs = [{ id: 'sub_1', status: 'active' }]; s.customer.invoice_settings.default_payment_method = 'pm_main';
  await B.backupSwap(st, CUS, {}); assert.equal(s.customer.invoice_settings.default_payment_method, 'pm_back'); assert.equal(s.customer.metadata.backup_pm, 'pm_main');
  assert.ok(st.calls.some((c) => c[0] === 'sub.update' && c[2].default_payment_method === 'pm_back'));
  await B.backupRemove(st, CUS, {}); assert.equal(s.customer.metadata.backup_pm, ''); assert.ok(st.calls.some((c) => c[0] === 'pm.detach' && c[1] === 'pm_main'));
  await assert.rejects(() => B.backupSwap(st, CUS, {}), /no backup/);
});

test('billing: the daily run tries the backup card once on an invoice the main card failed', async () => {
  const s = seed(); s.customer.metadata.backup_pm = 'pm_back'; s.customer.invoice_settings.default_payment_method = 'pm_main'; const st = stripeStub(s);
  assert.deepEqual(await B.backupSweep(st), { checked: 1, tried: 1, paid: 1, failed: 0 });
  assert.deepEqual(st.calls.find((c) => c[0] === 'inv.pay').slice(1), ['in_open', { payment_method: 'pm_back' }]);
  const s2 = seed(); s2.customer.metadata.backup_pm = 'pm_back'; s2.backupFails = true; const st2 = stripeStub(s2);
  assert.equal((await B.backupSweep(st2)).failed, 1); assert.deepEqual(await B.backupSweep(st2), { checked: 0, tried: 0, paid: 0, failed: 0 }, 'once');
  const s3 = seed(); const st3 = stripeStub(s3); assert.equal((await B.backupSweep(st3)).tried, 0, 'no backup card, nothing tried');
});
