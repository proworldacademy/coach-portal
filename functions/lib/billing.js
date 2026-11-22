/* Billing a family can read and use by themselves (Nov 22, 2026). "Just have a section where they can mark how long they want the
   invoice for and what, and then they can just download a PDF themselves. Itemized billing list. Add a backup card as well."

   activity   every payment of the family's Stripe customers in a window: the paid invoices (tuition, camps, packs, late fees, what
              the team charged) and the purchases that have no invoice (a court, a private paid at the moment), each with what was
              refunded. Only what went through Stripe is here.
   pdf        the same lines for the period, the kind and the player the parent picked, on one clean page.
   backup     a second card kept on the customer (metadata.backup_pm). It is added on Stripe's own page (nothing is typed here), and
              the daily billing run tries it once on a tuition or one-off invoice the main card failed. */
'use strict';
const path = require('path');
const crypto = require('crypto');
const S = require('./stripe');
const CAL = require('./calendar');

const CATS = { all: 'Everything', tuition: 'Tuition', private: 'Privates', extra: 'Camps and extras' };
const BACK_DAYS = 400;
const unix = (iso, end) => Math.floor(Date.parse(iso + (end ? 'T23:59:59' : 'T00:00:00') + '-05:00') / 1000);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const first = (s) => String(s || '').split(' · ')[0].trim();
const money = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const catOf = (kind, label, sub) => sub ? 'tuition' : /private|lesson/i.test(String(kind) + ' ' + String(label)) ? 'private' : 'extra';
const monthOf = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

async function activity(stripe, customers, opts) {
  opts = opts || {}; const today = opts.today || CAL.todayET();
  const from = isDate(opts.from) ? opts.from : CAL.addDays(today, -BACK_DAYS); const to = isDate(opts.to) ? opts.to : today;
  const created = { gte: unix(from), lte: unix(to, true) }; const items = [];
  const names = opts.names || {}; const nameOf = (v) => { v = String(v || '').trim(); return S.clean(names[v] || (/^[a-z0-9_-]+$/.test(v) ? '' : v), 60); };   // an id becomes the player's name
  if (!stripe) return { from, to, items };
  for (const c of customers || []) {
    const byPi = {};                                            // payment intent → what was refunded and the receipt
    try { let n = 0; for await (const ch of stripe.charges.list({ customer: c.id, created, limit: 100 })) { if (n++ > 300) break; const pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : (ch.payment_intent && ch.payment_intent.id); if (pi && ch.status === 'succeeded') byPi[pi] = { refunded: ch.amount_refunded || 0, receipt: ch.receipt_url || '' }; } } catch (e) { /* no refunds known */ }
    try {
      let n = 0;
      for await (const inv of stripe.invoices.list({ customer: c.id, status: 'paid', created, limit: 100, expand: ['data.payments'] })) {
        if (n++ > 300) break; if (!(inv.amount_paid > 0)) continue;
        const sub = S.invoiceSubscription(inv); const sm = (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.metadata) || (inv.subscription_details && inv.subscription_details.metadata) || {}; const m = inv.metadata || {};
        const date = CAL.dateOfUnixET(inv.created); const line = inv.lines && inv.lines.data && inv.lines.data[0];
        const label = sub ? (sm.program_name || first(inv.description) || 'Tuition') + ', ' + monthOf(date) + ' tuition'
          : m.kind === 'late_fee' ? 'Late fee' : first(inv.description) || first(line && line.description) || 'Payment';
        let pi = ''; try { const p = inv.payments && inv.payments.data && inv.payments.data.find((x) => x.payment && x.payment.payment_intent); pi = p ? (typeof p.payment.payment_intent === 'string' ? p.payment.payment_intent : p.payment.payment_intent.id) : (typeof inv.payment_intent === 'string' ? inv.payment_intent : ''); } catch (e) { pi = ''; }
        const r = byPi[pi] || {};
        items.push({ id: inv.id, date, at: inv.created, label: S.clean(label, 120), player: nameOf(sm.player || m.player), cat: catOf(m.kind, label, sub), cents: inv.amount_paid, refunded: r.refunded || 0, receipt: inv.invoice_pdf || inv.hosted_invoice_url || r.receipt || '' });
      }
    } catch (e) { /* no invoices */ }
    try {
      let n = 0;
      for await (const s of stripe.checkout.sessions.list({ customer: c.id, limit: 100, expand: ['data.line_items'] })) {
        if (n++ > 300) break;
        if (s.mode !== 'payment' || s.payment_status !== 'paid' || s.invoice || !(s.amount_total > 0) || s.created < created.gte || s.created > created.lte) continue;
        const m = s.metadata || {}; const li = s.line_items && s.line_items.data && s.line_items.data[0];
        const label = first(li && li.description) || (m.kind === 'court-rental' ? 'Court rental' : 'Payment'); const pi = typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || '';
        const r = byPi[pi] || {};
        items.push({ id: s.id, date: CAL.dateOfUnixET(s.created), at: s.created, label: S.clean(label, 120), player: nameOf(m.player), cat: catOf(m.kind, label, false), cents: s.amount_total, refunded: r.refunded || 0, receipt: r.receipt || '' });
      }
    } catch (e) { /* no purchases */ }
  }
  items.sort((a, b) => b.at - a.at);
  return { from, to, items };
}
function pick(items, f) {
  f = f || {}; const cat = CATS[f.what] && f.what !== 'all' ? f.what : ''; const player = S.clean(f.player, 60).toLowerCase();
  return (items || []).filter((x) => (!cat || x.cat === cat) && (!player || String(x.player || '').toLowerCase() === player) && (!isDate(f.from) || x.date >= f.from) && (!isDate(f.to) || x.date <= f.to));
}
const totals = (items) => ({ count: items.length, paid: items.reduce((n, x) => n + x.cents - (x.refunded || 0), 0) });

/* ── the PDF ── */
function pdf(o) {
  const PDF = require('pdfkit'); const doc = new PDF({ size: 'LETTER', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: 'ProWorld Academy invoice', Author: 'ProWorld Academy' } });
  const chunks = []; doc.on('data', (c) => chunks.push(c)); const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const HEAD = path.join(__dirname, '..', 'assets', 'ReviewCondensed-HeavyItalic.woff'); const L = 56, R = 556, W = R - L; const GREY = '#6B6B68';
  const nice = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const cols = [L, L + 70, L + 330, R];                              // date · item · player · amount (right edge)
  const header = () => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREY); doc.text('DATE', cols[0], doc.y, { characterSpacing: 1, lineBreak: false }); const y = doc.y; doc.text('ITEM', cols[1], y, { characterSpacing: 1, lineBreak: false }); doc.text('PLAYER', cols[2], y, { characterSpacing: 1, lineBreak: false }); doc.text('AMOUNT', cols[3] - 80, y, { width: 80, align: 'right', characterSpacing: 1 }); doc.moveTo(L, y + 13).lineTo(R, y + 13).lineWidth(1.2).strokeColor('#0A0A0A').stroke(); doc.y = y + 20; };
  doc.font(HEAD).fontSize(20).fillColor('#0A0A0A').text('PROWORLD', L, 56);
  doc.font(HEAD).fontSize(34).text('INVOICE', L, 104);
  doc.font('Helvetica-Bold').fontSize(10.5).text(o.name || o.email || '', L, 150); doc.font('Helvetica').fontSize(10).fillColor('#3B3C38').text(o.email || '', L, 165);
  doc.font('Helvetica').fontSize(10).fillColor('#3B3C38').text(nice(o.from) + ' to ' + nice(o.to), L, 150, { width: W, align: 'right' }).text((CATS[o.what] || CATS.all) + ' · ' + (o.player || 'All players'), L, 165, { width: W, align: 'right' });
  doc.y = 200; header();
  const rows = []; (o.items || []).slice().sort((a, b) => a.at - b.at).forEach((x) => { rows.push([x.date, x.label, x.player, x.cents]); if (x.refunded) rows.push([x.date, 'Refund, ' + x.label.charAt(0).toLowerCase() + x.label.slice(1), x.player, -x.refunded]); });
  for (const r of rows) {
    if (doc.y > 690) { doc.addPage(); doc.y = 56; header(); }
    const y = doc.y; doc.font('Helvetica').fontSize(9.5).fillColor('#0A0A0A');
    doc.text(nice(r[0]).replace(/, \d{4}$/, ''), cols[0], y, { width: 64, lineBreak: false });
    doc.text(r[1], cols[1], y, { width: 250 }); const y2 = doc.y;
    doc.text(r[2] || '', cols[2], y, { width: 110, lineBreak: false }); doc.text(money(r[3]), cols[3] - 90, y, { width: 90, align: 'right' });
    doc.moveTo(L, y2 + 5).lineTo(R, y2 + 5).lineWidth(0.6).strokeColor('#E0E1DB').stroke(); doc.y = y2 + 11;
  }
  if (!rows.length) doc.font('Helvetica').fontSize(10).fillColor(GREY).text('No payments in this period.', L, doc.y + 4);
  const t = totals(o.items || []); const ty = doc.y + 10; doc.font('Helvetica-Bold').fontSize(12).fillColor('#0A0A0A').text('Total paid', L, ty, { width: W - 110, align: 'right' }); doc.text(money(t.paid), R - 100, ty, { width: 100, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('ProWorld Academy · 651 Egret Cir, Delray Beach, FL 33444\ninfo@proworldacademy.com · (561) 403-0008\nAll amounts in US dollars. Paid by card. Made on ' + nice(o.today) + '.', L, doc.y + 28, { lineGap: 3 });
  doc.end(); return done;
}
/* A link that works for fifteen minutes, so the phone can open the PDF like any file. */
async function link(db, who, f, today) {
  const from = isDate(f.from) ? f.from : CAL.addDays(today, -30); const to = isDate(f.to) && f.to >= from ? f.to : today;
  if (CAL.cmp(from, CAL.addDays(today, -BACK_DAYS)) < 0) throw S.err(400, 'from', 'The list goes back about a year. For anything older, write to Admin in Messages.');
  const token = crypto.randomBytes(24).toString('hex');
  await db.doc('familyInvoiceLinks/' + token).set({ email: String(who.email).toLowerCase(), name: who.name || '', from, to, what: CATS[f.what] ? f.what : 'all', player: S.clean(f.player, 60), exp: Date.now() + 15 * 60000, at: Date.now() });
  return { url: '/api/family/invoice/' + token + '.pdf' };
}

/* ── the cards ── */
const cardOf = (pm) => pm && pm.card ? { id: pm.id, brand: String(pm.card.brand || 'card').replace(/^./, (c) => c.toUpperCase()), last4: pm.card.last4 || '', exp: pm.card.exp_month ? String(pm.card.exp_month).padStart(2, '0') + '/' + String(pm.card.exp_year).slice(-2) : '' } : null;
async function cards(stripe, customers) {
  const out = [];
  for (const c of customers || []) {
    try {
      const cu = await stripe.customers.retrieve(c.id, { expand: ['invoice_settings.default_payment_method'] }); const d = cu.invoice_settings && cu.invoice_settings.default_payment_method;
      const main = cardOf(d && typeof d === 'object' ? d : null); let backup = null; const bid = (cu.metadata || {}).backup_pm;
      if (bid) { try { backup = cardOf(await stripe.paymentMethods.retrieve(bid)); } catch (e) { backup = null; } }
      out.push({ customer: c.id, main, backup: backup && (!main || backup.id !== main.id) ? backup : null });
    } catch (e) { /* that customer is gone */ }
  }
  return out;
}
const own = (customers, id) => { const c = (customers || []).find((x) => x.id === id) || (!id && (customers || [])[0]); if (!c) throw S.err(404, 'customer', 'There is no payment account under this e-mail yet.'); return c; };
async function backupStart(stripe, customers, body, site) {
  const c = own(customers, S.clean(body.customer, 40));
  const s = await stripe.checkout.sessions.create({ mode: 'setup', customer: c.id, payment_method_types: ['card'], metadata: { kind: 'backup_card', source: 'proworld-backend' }, success_url: site + '/family?backupcard={CHECKOUT_SESSION_ID}#billing', cancel_url: site + '/family#billing' });
  return { url: s.url };
}
async function backupConfirm(stripe, customers, body) {
  const s = await stripe.checkout.sessions.retrieve(S.clean(body.session, 120), { expand: ['setup_intent'] });
  const cid = S.customerId(s.customer); const c = own(customers, cid); if (!s || s.mode !== 'setup' || (s.metadata || {}).kind !== 'backup_card' || c.id !== cid) throw S.err(400, 'session', 'That card was not saved. Try again.');
  const si = s.setup_intent; const pm = si && typeof si === 'object' ? (typeof si.payment_method === 'string' ? si.payment_method : si.payment_method && si.payment_method.id) : '';
  if (!pm || si.status !== 'succeeded') throw S.err(400, 'card', 'That card was not saved. Try again.');
  const cu = await stripe.customers.retrieve(c.id); const d = cu.invoice_settings && cu.invoice_settings.default_payment_method; const main = typeof d === 'string' ? d : d && d.id;
  if (!main) { await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: pm } }); return { ok: true, as: 'main' }; }    // no card yet: it is the main one
  const old = (cu.metadata || {}).backup_pm; await stripe.customers.update(c.id, { metadata: { backup_pm: pm } });
  if (old && old !== pm && old !== main) { try { await stripe.paymentMethods.detach(old); } catch (e) { /* already gone */ } }
  return { ok: true, as: 'backup' };
}
async function backupRemove(stripe, customers, body) {
  const c = own(customers, S.clean(body.customer, 40)); const cu = await stripe.customers.retrieve(c.id); const old = (cu.metadata || {}).backup_pm; const d = cu.invoice_settings && cu.invoice_settings.default_payment_method; const main = typeof d === 'string' ? d : d && d.id;
  await stripe.customers.update(c.id, { metadata: { backup_pm: '' } });
  if (old && old !== main) { try { await stripe.paymentMethods.detach(old); } catch (e) { /* already gone */ } }
  return { ok: true };
}
async function backupSwap(stripe, customers, body) {
  const c = own(customers, S.clean(body.customer, 40)); const cu = await stripe.customers.retrieve(c.id); const b = (cu.metadata || {}).backup_pm; const d = cu.invoice_settings && cu.invoice_settings.default_payment_method; const main = typeof d === 'string' ? d : d && d.id;
  if (!b) throw S.err(404, 'backup', 'There is no backup card.');
  await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: b }, metadata: { backup_pm: main || '' } });
  try { for await (const sub of stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 })) { if (['active', 'past_due', 'trialing'].includes(sub.status)) await stripe.subscriptions.update(sub.id, { default_payment_method: b }); } } catch (e) { /* the customer default still applies */ }
  return { ok: true };
}
/* The daily run: an invoice the main card failed is tried once on the backup card. */
async function backupSweep(stripe, log) {
  log = log || (() => {}); const report = { checked: 0, tried: 0, paid: 0, failed: 0 }; const seen = {};
  for await (const inv of stripe.invoices.list({ status: 'open', limit: 100 })) {
    try {
      if (!(inv.amount_due > 0) || !inv.attempted || inv.collection_method === 'send_invoice' || (inv.metadata || {}).backup_tried) continue; report.checked++;
      const cid = S.customerId(inv.customer); if (!cid) continue;
      if (!(cid in seen)) { const cu = await stripe.customers.retrieve(cid); const d = cu.invoice_settings && cu.invoice_settings.default_payment_method; const b = (cu.metadata || {}).backup_pm || ''; seen[cid] = b && b !== (typeof d === 'string' ? d : d && d.id) ? b : ''; }
      if (!seen[cid]) continue;
      await stripe.invoices.update(inv.id, { metadata: { backup_tried: CAL.todayET() } }); report.tried++;
      try { const p = await stripe.invoices.pay(inv.id, { payment_method: seen[cid] }); if (p.status === 'paid') { report.paid++; log(`backup card paid ${inv.id}`); } else report.failed++; } catch (e) { report.failed++; log(`backup card did not pay ${inv.id}: ${e.message}`); }
    } catch (e) { log(`backup sweep ${inv.id}: ${e.message}`); }
  }
  return report;
}

module.exports = { CATS, activity, pick, totals, pdf, link, cards, backupStart, backupConfirm, backupRemove, backupSwap, backupSweep, money };
