/* ProWorld Academy — the billing engine behind /backend and /enroll (Cloud Functions for Firebase, 2nd gen).
   One HTTPS function, `api`, answers /api/* through the Hosting rewrite in firebase.json; one scheduled function, `dailyBilling`,
   runs the break-month credits and the late-fee timeline every morning at 05:05 Delray Beach time.
   The Stripe key is a Secret Manager secret named STRIPE_SECRET_KEY (a sandbox key = test mode, a live restricted key = live). */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const CAL = require('./lib/calendar');
const CAT = require('./lib/catalog');
const S = require('./lib/stripe');
const CHECKOUT = require('./lib/checkout');
const JOBS = require('./lib/jobs');
const ADMIN = require('./lib/admin');

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const REGION = 'us-central1';
const SITE = CHECKOUT.SITE;

function mode(key) { return /^(sk|rk)_live_/.test(key || '') ? 'live' : 'test'; }
function send(res, status, body) { res.status(status).set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').json(body); }
function fail(res, e) {
  const status = e.status || (e.type === 'StripeInvalidRequestError' ? 400 : 500);
  if (status >= 500) logger.error('api error', { message: e.message, stack: e.stack });
  else logger.warn('api refused', { code: e.code, message: e.message });
  send(res, status, { error: e.code || (e.type ? 'stripe' : 'error'), message: status >= 500 && !e.status ? 'Something went wrong on our side. Nothing was charged. Please try again or call the front desk at (561) 403-0008.' : e.message });
}
function allowOrigin(req, res) {
  const o = String(req.headers.origin || '');
  if (o === SITE || /^https:\/\/proworld-coach-portal(--[a-z0-9-]+)?\.web\.app$/.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o)) {
    res.set('Access-Control-Allow-Origin', o).set('Vary', 'Origin').set('Access-Control-Allow-Headers', 'Content-Type, Authorization').set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

exports.api = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY], maxInstances: 10, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  allowOrigin(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const path = req.path.replace(/\/+$/, '') || '/';
  const route = (req.method + ' ' + path).replace(/^(\w+) \/api/, '$1 ');
  const key = STRIPE_SECRET_KEY.value();
  try {
    if (route === 'GET /health') return send(res, 200, { ok: true, mode: mode(key), today: CAL.todayET(), rules: CAL.RULES.version });
    if (route === 'GET /catalog') return send(res, 200, Object.assign({ mode: mode(key), rules: { version: CAL.RULES.version, bill_day: CAL.RULES.bill_day, late: CAL.RULES.late_policy, terms: CAL.RULES.terms, breaks: CAL.RULES.breaks } }, CAT.publicCatalog()));
    if (route === 'POST /quote') { const b = req.body || {}; const q = CHECKOUT.monthlyQuote(S.clean(b.program, 40), S.clean(b.plan, 40), S.clean(b.start, 10)); return send(res, 200, { lines: q.lines, dueCents: q.dueCents, then: q.then, startLabel: q.startLabel, start: q.start, anchor: q.anchor, next: q.next, program: q.program.name, plan: q.plan.label }); }
    if (route === 'POST /checkout') {
      const stripe = S.stripeFor(key); const b = req.body || {};
      const out = b.kind === 'monthly' ? await CHECKOUT.createMonthlySession(stripe, b) : await CHECKOUT.createOneTimeSession(stripe, b);
      logger.info('checkout session', { id: out.id, kind: b.kind, program: b.program, by: b.by || 'enroll' });
      return send(res, 200, out);
    }
    if (route === 'GET /checkout/status') { const stripe = S.stripeFor(key); return send(res, 200, await CHECKOUT.sessionStatus(stripe, String(req.query.s || ''))); }

    if (path.startsWith('/api/admin/')) {
      const who = await ADMIN.requireStaff(req);
      const stripe = S.stripeFor(key); const b = req.body || {};
      if (route === 'GET /admin/overview') return send(res, 200, Object.assign({ mode: mode(key), who: who.email }, await ADMIN.overview(stripe)));
      if (route === 'POST /admin/portal') { const c = S.clean(b.customer, 60); if (!/^cus_/.test(c)) throw S.err(400, 'customer', 'customer id required'); return send(res, 200, { url: await S.portalUrl(stripe, c, SITE + '/backend') }); }
      if (route === 'POST /admin/hold') { const id = S.clean(b.subscription, 60); if (!/^sub_/.test(id)) throw S.err(400, 'subscription', 'subscription id required'); const on = b.hold === true; await stripe.subscriptions.update(id, { metadata: { hold: on ? 'true' : '', hold_since: on ? CAL.todayET() : '', hold_by: who.email } }); logger.info('hold', { id, on, by: who.email }); return send(res, 200, { ok: true }); }
      if (route === 'POST /admin/cancel') { const id = S.clean(b.subscription, 60); if (!/^sub_/.test(id)) throw S.err(400, 'subscription', 'subscription id required'); if (b.now === true) await stripe.subscriptions.cancel(id, { cancellation_details: { comment: 'Cancelled by ' + who.email } }); else await stripe.subscriptions.update(id, { cancel_at_period_end: true, metadata: { cancel_by: who.email } }); logger.info('cancel', { id, now: b.now === true, by: who.email }); return send(res, 200, { ok: true }); }
      if (route === 'POST /admin/resume') { const id = S.clean(b.subscription, 60); if (!/^sub_/.test(id)) throw S.err(400, 'subscription', 'subscription id required'); await stripe.subscriptions.update(id, { cancel_at_period_end: false, metadata: { cancel_by: '' } }); return send(res, 200, { ok: true }); }
      if (route === 'POST /admin/charge') { const out = await ADMIN.chargeOnFile(stripe, b, who); logger.info('charge on file', Object.assign({ by: who.email }, out)); return send(res, 200, out); }
      if (route === 'POST /admin/enroll-link') { const out = await CHECKOUT.createMonthlySession(stripe, Object.assign({}, b, { by: 'staff:' + who.email })); return send(res, 200, out); }
      if (route === 'POST /admin/run-jobs') {
        if (!who.owner) throw S.err(403, 'owner', 'Only an owner can run the jobs by hand.');
        const today = /^\d{4}-\d{2}-\d{2}$/.test(b.today || '') ? b.today : CAL.todayET();
        const lines = []; const log = (l) => lines.push(l);
        const credits = b.which === 'late' ? null : await JOBS.applyBreakCredits(stripe, today, log);
        const late = b.which === 'credits' ? null : await JOBS.applyLatePolicy(stripe, today, log);
        logger.info('jobs run by hand', { by: who.email, today, lines });
        return send(res, 200, { today, credits, late, log: lines });
      }
      if (route === 'GET /admin/notices') {
        const ov = await ADMIN.overview(stripe); const out = [];
        for (const s of ov.subscriptions) { if (!s.next || !s.next.date || !['active', 'past_due'].includes(s.status)) continue; const p = CAL.parts(s.next.date); const text = JOBS.breakMonthNotice(s.program, (s.monthly || 0) * 100, p.y, p.m); if (text) out.push({ subscription: s.id, player: s.player, customer: s.customer, month: s.next.date.slice(0, 7), text }); }
        return send(res, 200, { today: ov.today, notices: out });
      }
      throw S.err(404, 'route', 'No such admin route.');
    }
    throw S.err(404, 'route', 'No such route.');
  } catch (e) { fail(res, e); }
});

exports.dailyBilling = onSchedule({ schedule: '5 5 * * *', timeZone: CAL.TZ, region: REGION, secrets: [STRIPE_SECRET_KEY], retryCount: 2, timeoutSeconds: 540, memory: '256MiB' }, async () => {
  const stripe = S.stripeFor(STRIPE_SECRET_KEY.value());
  const today = CAL.todayET();
  const log = (l) => logger.info('billing: ' + l);
  const credits = await JOBS.applyBreakCredits(stripe, today, log);
  const late = await JOBS.applyLatePolicy(stripe, today, log);
  logger.info('dailyBilling done', { today, mode: mode(STRIPE_SECRET_KEY.value()), credits: { checked: credits.checked, credited: credits.credited.length, paused: credits.paused.length, errors: credits.errors.length }, late: { checked: late.checked, lateFees: late.lateFees.length, holds: late.holds.length, cancelled: late.cancelled.length, errors: late.errors.length } });
  if (credits.errors.length || late.errors.length) logger.error('dailyBilling errors', { credits: credits.errors, late: late.errors });
});
