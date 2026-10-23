/* The Stripe catalog the engine expects, and a check that a Stripe account (the sandbox or the live account) really carries it:
   every product the catalog sells with its family-facing description (Checkout and invoices show it), the six start-month products
   the monthly flow charges against, and every price by lookup key with the amount the catalog publishes.
   `syncCatalog` fixes what the engine may fix on its own — creates the start-month products, rewrites descriptions, makes sure the
   family portal is configured. It never creates or changes a price: a price change is made in the Dashboard first, then in catalog.js,
   and until the two agree the line is simply not sold (stripe.js refuses it). */
'use strict';
const CAT = require('./catalog');
const S = require('./stripe');

/* What families read under each product name (Checkout, invoices, receipts) — no internal notes. */
const DESCRIPTIONS = {
  prod_VSwdkFe4BriwDa: 'Full day program · Aug 10 – Dec 18, 2026.',
  prod_VSweKxrlHVGGqf: 'Afterschool program · Aug 10 – Dec 18, 2026.',
  prod_VSwfSjJ9qNDzc9: '10 & under · Aug 10 – Dec 19, 2026.',
  prod_VSwfrBU79qetLs: '10 & under · Aug 10 – Dec 19, 2026.',
  prod_VSwgYEOleDHEs3: 'ProWorld TOTS, ages 2–4 · Aug 12 – Dec 19, 2026.',
  prod_VSwgIlb17cIxza: 'Fitness · Aug 10 – Dec 18, 2026.',
  prod_VSwhdbxWJc3MMh: 'Soccer · Aug 11 – Dec 19, 2026.',
  prod_VSwh6EJ8SieFMo: 'Thanksgiving week camp, ages 13+ · Nov 23–27, 2026 (no camp Thu Nov 26). Half day 9–12, full day 9–3.',
  prod_VSwi9IRjxaAEH7: 'Thanksgiving week camp, ages 10–12 · Nov 23–27, 2026 (no camp Thu Nov 26). Half day 9–12, full day 9–3.',
  prod_VSwjnorEwHU1r8: 'Thanksgiving week camp, 10 & under · Nov 23–27, 2026. Half day, full day and Saturday drop-in.',
  prod_VUkyUXYiRwnVcY: 'Winter camp, ages 13–25 · Dec 21–31, 2026, Mon–Thu (closed Dec 25 and Jan 1; half days only Dec 24 and Dec 31). Half day: tennis + fitness in the morning; full day adds 2–4 PM tennis (Mon–Wed).',
  prod_VUkyFDuTo7pXai: 'Winter camp, ages 10–12 · Dec 21–31, 2026, Mon–Thu (closed Dec 25 and Jan 1; half days only Dec 24 and Dec 31). Half day 9–12, full day 9–3 (Mon–Wed).',
  prod_VUkzheU15PadgU: 'Winter camp, 10 & under · Dec 21–31, 2026, Mon–Thu (closed Dec 25 and Jan 1; half days only Dec 24 and Dec 31). Half day 9–12, full day 9–3 (Mon–Wed).',
  prod_VSwkMIzPBMfrak: 'Private lesson with a Tier 150 pro. Prices are per player; 2-player prices are each.',
  prod_VSwluZnF98aXyH: 'Private lesson with a Tier 120 pro. Prices are per player; 2-player prices are each.',
  prod_VSwlz6M3y1arWQ: 'Private lesson with a Tier 100 pro. Prices are per player; 2-player prices are each.',
  prod_VSwnPDTKvEIqSU: 'Private lesson with a Tier 80 pro.',
  prod_VSwnrF7HlXie9a: 'One-on-one or small-group fitness session with a fitness coach. Prices are per player.',
  prod_VSwqeDA8h0tdWb: 'Private soccer session. Prices are per player.',
  prod_VSwrEVcItQBJ4t: 'Sparring session — 1 hour.',
  prod_VSwr73HB9EzSHx: 'Pre-paid private-lesson packages — tennis, fitness and soccer.',
  prod_VSwtDH5VO3FYSZ: 'Court reservation — non-member rate per booking slot (included for members).',
  prod_VSwuLdnecvHOo2: 'Monthly court-rental membership (1 member, minimum one billing period).',
  // the staff test (a real card, $3 every 3 days, a $1 private) — created by hand in the live account on Oct 22, 2026
  pw_tester_program: 'Not a real program: the academy\'s own test of enrollment, renewals, receipts and texts. Charges a real card $3 every 3 days until cancelled.',
  pw_tester_lesson: 'Not a real lesson: the academy\'s own $1 test of a private booked and charged to the card on file.'
};
const FIRST_MONTH_DESCRIPTION = 'Charged once at enrollment for the training days left in your start month. Tuition then bills on the 1st of each month.';
const STATEMENT = { fulltime: 'PROWORLD FULL TIME', afterschool: 'PROWORLD AFTERSCHOOL', u10adv: 'PROWORLD 10U ADV', u10path: 'PROWORLD 10U PATHWAY', tots: 'PROWORLD 4 AND UNDER', soccer: 'PROWORLD SOCCER' };

/* Every product the engine expects to find. `create` marks the ones the engine may create itself (no prices on them). */
function expectedProducts() {
  const out = [];
  const names = {};
  for (const p of CAT.PROGRAMS) names[p.product] = p.name;
  for (const c of CAT.CAMPS) names[c.product] = c.name;
  for (const [tier, t] of Object.entries(CAT.LESSON_TIERS)) names[t.product] = tier === 'Sparring' ? 'Sparring — 1 hour' : (tier.startsWith('FITNESS') ? 'Fitness Session — ' : tier.startsWith('SOCCER') ? 'Soccer Private — ' : 'Private Lesson — ') + tier;
  names.pw_tester_program = 'Tester Program — staff test (renews every 3 days)';
  names.prod_VSwr73HB9EzSHx = 'Lesson Packages'; names.prod_VSwtDH5VO3FYSZ = 'Court Reservation'; names.prod_VSwuLdnecvHOo2 = 'Monthly Court Rentals (membership)';
  for (const [id, description] of Object.entries(DESCRIPTIONS)) out.push({ id, name: names[id] || id, description, create: false });
  for (const p of CAT.PROGRAMS) if (p.firstMonth) out.push({ id: p.firstMonth, name: `${p.name} — start month (prorated by training days)`, description: FIRST_MONTH_DESCRIPTION, create: true, statement: STATEMENT[p.id] || 'PROWORLD', metadata: { kind: 'first_month', program: p.id, source: 'proworld-backend' } });
  return out;
}

/* Every price the engine sells, by lookup key, with what Stripe must say about it. */
function expectedPrices() {
  const out = [];
  for (const p of CAT.PROGRAMS) for (const pl of p.plans) out.push({ lookup: pl.lookup, label: p.short + ' · ' + pl.label, cents: pl.monthly * 100, recurring: true, cycle: CAT.cycleOf(pl), product: p.product });
  for (const m of CAT.MEMBERSHIP) out.push({ lookup: m.lookup, label: m.label, cents: m.price * 100, recurring: true, cycle: CAT.cycleOf(null), product: 'prod_VSwuLdnecvHOo2' });
  for (const l of Object.values(CAT.oneTimeLines())) out.push({ lookup: l.lookup, label: l.label, cents: Math.round(l.price * 100), recurring: false, product: l.product, byProduct: !!l.byProduct });
  return out;
}

const text = (s) => String(s == null ? '' : s).trim();
const productId = (p) => typeof p === 'string' ? p : p && p.id;

/* Reads the account once (all products, every expected lookup key) and reports what differs from the catalog. */
async function checkCatalog(stripe) {
  const have = {};
  for await (const p of stripe.products.list({ limit: 100 })) have[p.id] = p;
  const products = { expected: 0, ok: 0, missing: [], stale: [], archived: [] };
  for (const e of expectedProducts()) {
    products.expected++;
    const p = have[e.id];
    if (!p) { products.missing.push({ id: e.id, name: e.name, create: e.create }); continue; }
    if (p.active === false) { products.archived.push({ id: e.id, name: e.name }); continue; }
    if (text(p.description) !== e.description) products.stale.push({ id: e.id, name: e.name, from: text(p.description), to: e.description });
    else products.ok++;
  }
  const prices = { expected: 0, ok: 0, missing: [], mismatched: [] };
  const want = expectedPrices();
  const byLookup = {};                                // every active price with a lookup key, two pages at most (Stripe takes 10 lookup keys per query, so listing is cheaper)
  for await (const p of stripe.prices.list({ active: true, limit: 100 })) if (p.lookup_key) byLookup[p.lookup_key] = p;
  for (const w of want) {
    prices.expected++;
    let p = byLookup[w.lookup];
    if (w.byProduct) { const prod = have[w.product]; p = prod && prod.default_price && typeof prod.default_price === 'object' ? prod.default_price : null; if (!p && prod && typeof prod.default_price === 'string') { try { p = await stripe.prices.retrieve(prod.default_price); } catch (e) { p = null; } } }
    if (!p) { prices.missing.push({ lookup: w.lookup, label: w.label, cents: w.cents }); continue; }
    const problems = [];
    if (p.unit_amount !== w.cents) problems.push(`$${(p.unit_amount || 0) / 100} in Stripe, catalog says $${w.cents / 100}`);
    const cy = w.cycle || CAT.cycleOf(null);
    const rec = p.type === 'recurring' && p.recurring && p.recurring.interval === cy.interval && (p.recurring.interval_count || 1) === cy.count;
    if (w.recurring && !rec) problems.push(cy.monthly ? 'not a monthly price in Stripe' : `not an every-${cy.count}-${cy.interval} price in Stripe`);
    if (!w.recurring && p.type !== 'one_time') problems.push('not a one-time price in Stripe');
    if (w.product && !w.byProduct && productId(p.product) !== w.product) problems.push('belongs to another product in Stripe');
    if (problems.length) prices.mismatched.push({ lookup: w.lookup, label: w.label, cents: w.cents, stripe: p.unit_amount, problem: problems.join('; ') });
    else prices.ok++;
  }
  const fixable = products.missing.filter((m) => m.create).length + products.stale.length;
  const blocking = products.missing.filter((m) => !m.create).length + products.archived.length + prices.missing.length + prices.mismatched.length;
  return { products, prices, fixable, blocking, ready: fixable === 0 && blocking === 0 };
}

/* Fixes what the engine may fix (start-month products, descriptions, the family portal) and reports the state after. */
async function syncCatalog(stripe, log) {
  log = log || (() => {});
  const before = await checkCatalog(stripe);
  const done = { created: [], updated: [], portal: null };
  const expected = expectedProducts();
  for (const m of before.products.missing) {
    const e = expected.find((x) => x.id === m.id);
    if (!e || !e.create) continue;
    await stripe.products.create({ id: e.id, name: e.name, description: e.description, statement_descriptor: e.statement, type: 'service', metadata: e.metadata });
    done.created.push(e.id); log(`created ${e.id} (${e.name})`);
  }
  for (const s of before.products.stale) {
    await stripe.products.update(s.id, { description: s.to });
    done.updated.push(s.id); log(`description: ${s.name}`);
  }
  done.portal = await S.portalConfiguration(stripe);
  const after = await checkCatalog(stripe);
  return { before, done, after };
}

module.exports = { DESCRIPTIONS, FIRST_MONTH_DESCRIPTION, expectedProducts, expectedPrices, checkCatalog, syncCatalog };
