/* ProWorld Academy — the billing engine behind /backend and /enroll (Cloud Functions for Firebase, 2nd gen).
   One HTTPS function, `api`, answers /api/* through the Hosting rewrite in firebase.json; one scheduled function, `dailyBilling`,
   runs every morning at 05:05 Delray Beach time: paid checkouts without their follow-through, break-month credits, the late-fee
   timeline, holds that were paid, and the roster against Stripe.
   The Stripe key is a Secret Manager secret named STRIPE_SECRET_KEY (a sandbox key = test mode, a live restricted key = live).
   Everything a payment changes on the roster — the player record, the parent details, the note for Monday, the Slack messages
   and the family's text — lives in lib/roster.js and lib/notify.js (settings/notify in the database, written by an owner). */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const BACKUP = require('./lib/backup');
const CAL = require('./lib/calendar');
const CAT = require('./lib/catalog');
const S = require('./lib/stripe');
const CHECKOUT = require('./lib/checkout');
const JOBS = require('./lib/jobs');
const ADMIN = require('./lib/admin');
const ROSTER = require('./lib/roster');
const NOTIFY = require('./lib/notify');
const DB = require('./lib/db');
const SYNC = require('./lib/catalog-sync');
const SWITCH = require('./lib/switch');
const REMOVE = require('./lib/remove');
const FEED = require('./lib/feed');
const FAMILY = require('./lib/family');
const SMS = require('./lib/sms');
const MONDAY = require('./lib/mondayimport');

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
const subIdOf = (b) => { const id = S.clean(b.subscription, 60); if (!/^sub_/.test(id)) throw S.err(400, 'subscription', 'subscription id required'); return id; };
async function familyOfSub(stripe, sub) { try { const c = await stripe.customers.retrieve(S.customerId(sub.customer)); return { phone: c.phone || '', name: c.name || '' }; } catch (e) { return { phone: '', name: '' }; } }

exports.api = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY], maxInstances: 10, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  allowOrigin(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const path = req.path.replace(/\/+$/, '') || '/';
  const route = (req.method + ' ' + path).replace(/^(\w+) \/api/, '$1 ');
  const key = STRIPE_SECRET_KEY.value();
  const ctx = { db: DB.get(), mode: mode(key) };
  const log = (l) => logger.info('engine: ' + l);
  try {
    if (route === 'GET /health') return send(res, 200, { ok: true, mode: mode(key), today: CAL.todayET(), rules: CAL.RULES.version });
    if (route === 'GET /catalog') return send(res, 200, Object.assign({ mode: mode(key), rules: { version: CAL.RULES.version, bill_day: CAL.RULES.bill_day, late: CAL.RULES.late_policy, terms: CAL.RULES.terms, breaks: CAL.RULES.breaks } }, CAT.publicCatalog()));
    if (route === 'POST /quote') { const b = req.body || {}; const q = CHECKOUT.monthlyQuote(S.clean(b.program, 40), S.clean(b.plan, 40), S.clean(b.start, 10)); return send(res, 200, { lines: q.lines, dueCents: q.dueCents, then: q.then, startLabel: q.startLabel, start: q.start, anchor: q.anchor, next: q.next, program: q.program.name, plan: q.plan.label }); }
    if (route === 'POST /checkout') {
      const stripe = S.stripeFor(key); const b = req.body || {};
      const out = b.kind === 'monthly' ? await CHECKOUT.createMonthlySession(stripe, b) : await CHECKOUT.createOneTimeSession(stripe, b);
      logger.info('checkout session', { id: out.id, kind: b.kind, program: b.program, by: b.by || 'enroll' });
      if (out.trial) {                                                          // a free session: no Stripe session to come back for — the try-out is filed now
        try { out.tryout = (await ROSTER.recordTrial(ctx.db, out.trial, { log, mode: ctx.mode })).tryout; } catch (e) { logger.error('trial not filed', { message: e.message }); }
        delete out.trial;
      }
      return send(res, 200, out);
    }
    if (route === 'GET /checkout/status') { const stripe = S.stripeFor(key); return send(res, 200, await CHECKOUT.sessionStatus(stripe, String(req.query.s || ''), log, ctx)); }

    if (route === 'POST /sms/webhook') {
      // JustCall calls this for texts on the academy's line: STOP / START from a family flips their consent, delivery updates land on the log
      const out = await SMS.webhook(ctx.db, req.headers || {}, req.body || {});
      logger.info('sms webhook', out);
      return send(res, 200, { ok: true, did: out.did });
    }

    if (route === 'GET /roster') {
      // the roster feed for the concierge and the morning digest — read-only, one key, set by an owner on the backend
      await FEED.requireKey(ctx.db, req);
      return send(res, 200, await FEED.roster(ctx.db));
    }

    if (path.startsWith('/api/family/')) {
      // the family portal: a signed-in parent sees their own players, attendance, reports and bills — nothing else
      const who = await FAMILY.requireFamily(req);
      const stripe = S.stripeFor(key); const b = req.body || {};
      if (route === 'GET /family/me') return send(res, 200, Object.assign({ mode: mode(key) }, await FAMILY.me(ctx.db, stripe, who)));
      if (route === 'POST /family/portal') return send(res, 200, await FAMILY.portal(stripe, who, ctx.db));
      if (route === 'POST /family/request') {
        const { players } = await FAMILY.findPlayers(ctx.db, stripe, who.email);
        const out = await FAMILY.request(ctx.db, who, b, players);
        logger.info('family request', { by: who.email, kind: out.kind, id: out.id });
        return send(res, 200, out);
      }
      throw S.err(404, 'route', 'No such family route.');
    }

    if (path.startsWith('/api/admin/')) {
      const who = await ADMIN.requireStaff(req);
      const stripe = S.stripeFor(key); const b = req.body || {};
      if (route === 'GET /admin/overview') return send(res, 200, Object.assign({ mode: mode(key), who: who.email, billing: who.billing, owner: who.owner }, await ADMIN.overview(stripe)));
      if (route === 'GET /admin/notices') {
        const ov = await ADMIN.overview(stripe); const out = [];
        // a plan on its own cycle (the staff test) has no break months, so it is skipped here
        for (const s of ov.subscriptions) { if (!s.next || !s.next.date || !['active', 'trialing', 'past_due'].includes(s.status) || s.test) continue; const p = CAL.parts(s.next.date); const text = JOBS.breakMonthNotice(s.program, (s.monthly || 0) * 100, p.y, p.m); if (text) out.push({ subscription: s.id, player: s.player, customer: s.customer, month: s.next.date.slice(0, 7), text }); }
        return send(res, 200, { today: ov.today, notices: out });
      }
      if (route === 'POST /admin/announce') {
        // a line from the backend page to the team's Slack (attendance posted, a court released, a player added at the front desk)
        const which = b.which === 'coaches' ? 'coaches' : 'desk';
        const lines = Array.isArray(b.lines) ? b.lines.slice(0, 8).map((l) => String(l == null ? '' : l).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, 1500)).filter(Boolean) : null;   // newlines stay (the attendance list)
        return send(res, 200, { ok: await NOTIFY.slack(ctx.db, which, S.clean(b.text, 600) + ' — ' + (who.name || who.email), lines) });
      }
      if (route === 'POST /admin/text') {
        // a text to a family from the backend page (a private booked, a court reserved, a pack running low) — only when texts are switched on.
        // Oct 24 audit: needs the texting permission, the number must belong to a family that opted in, and every send is logged.
        SMS.requireTexting(who);
        const phone = SMS.e164(S.clean(b.phone, 30)); if (!phone) return send(res, 400, { error: 'phone', message: 'That is not a usable mobile number.' });
        const fam = (await SMS.recipients(ctx.db)).find((r) => r.phone === phone);
        if (!fam) return send(res, 403, { error: 'unknown', message: 'That number is not on a family record, so the engine will not text it.' });
        if (!fam.optIn) return send(res, 403, { error: 'optin', message: `${fam.name || 'This family'} has not opted in to texts.` });
        const ok = await NOTIFY.text(ctx.db, phone, S.clean(b.body, 600));
        try { await ctx.db.collection('smsLog').doc().set({ at: Date.now(), sentAt: ok ? Date.now() : null, by: who.email, byName: who.name || '', player: fam.id, playerName: fam.name || '', group: fam.group || '', coach: fam.coach || '', phone, body: S.clean(b.body, 600), status: ok ? 'sent' : 'failed', reason: ok ? '' : 'justcall', batch: 'direct' }); } catch (e) { /* the text went; the log line is best effort */ }
        return send(res, 200, { ok });
      }
      if (route === 'GET /admin/backup') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await BACKUP.status()); }                 // the nightly copies of the database
      if (route === 'POST /admin/backup') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await BACKUP.run(log)); }                  // one now
      if (route === 'GET /admin/catalog') return send(res, 200, Object.assign({ mode: mode(key) }, await SYNC.checkCatalog(stripe)));
      if (route === 'POST /admin/catalog/sync') {
        // Makes the Stripe account behind the key carry the catalog: start-month products, family-facing descriptions, the portal. Never prices.
        if (!who.owner) throw S.err(403, 'owner', 'Only an owner can change the Stripe catalog.');
        const lines = []; const out = await SYNC.syncCatalog(stripe, (l) => lines.push(l));
        logger.info('catalog sync', { by: who.email, mode: mode(key), created: out.done.created, updated: out.done.updated });
        return send(res, 200, Object.assign({ mode: mode(key), log: lines }, out));
      }
      // Moving the families over from Play by Point: the list with who has enrolled, the front desk's edits, the one-time import.
      if (route === 'GET /admin/switch') { const ov = await ADMIN.overview(stripe); return send(res, 200, Object.assign({ mode: mode(key) }, await SWITCH.list(ov.subscriptions, ov.today))); }
      if (route === 'POST /admin/switch/update') return send(res, 200, { ok: true, row: await SWITCH.update(b.id, b, who.email) });
      if (route === 'POST /admin/switch/import') { if (!who.owner) throw S.err(403, 'owner', 'Only an owner can import the roster.'); const out = await SWITCH.importRows(Array.isArray(b.rows) ? b.rows.slice(0, 400) : [], who.email); logger.info('switch import', Object.assign({ by: who.email }, out)); return send(res, 200, out); }
      // The parents' details from Monday's ACCOUNTING board: every family the academy has had, into the roster. Owners only; preview first.
      if (route === 'POST /admin/monday/preview') { if (!who.owner) throw S.err(403, 'owner', 'Only an owner can read the Monday board.'); return send(res, 200, await MONDAY.preview(ctx.db)); }
      if (route === 'POST /admin/monday/import') {
        if (!who.owner) throw S.err(403, 'owner', 'Only an owner can import from Monday.');
        const out = await MONDAY.importAll(ctx.db, who.email);
        FEED.forget();
        logger.info('monday import', { by: who.email, matched: out.matched, contacts: out.contactsWritten, created: out.created, skipped: out.skipped, writes: out.writes });
        return send(res, 200, out);
      }
      if (route === 'POST /admin/roster/remove') {
        // A record the engine filed (a test, a mistake) goes away with its parent details, ledger lines and anything queued for Monday. Owners only.
        if (!who.owner) throw S.err(403, 'owner', 'Only an owner can remove a record.');
        const out = await REMOVE.removeRecord(ctx.db, stripe, S.clean(b.player, 60), { log, by: who.email });
        logger.info('record removed', Object.assign({ by: who.email }, out));
        return send(res, 200, Object.assign({ ok: true }, out));
      }
      // Messages: texts to families from the front desk (owners, administrators, the front desk; coaches read the history of their groups)
      if (route === 'GET /admin/sms/recipients') { SMS.requireTexting(who); return send(res, 200, { who: { email: who.email, name: who.name, texting: who.texting }, line: await SMS.line(ctx.db), settings: await SMS.settings(ctx.db), players: await SMS.recipients(ctx.db) }); }
      if (route === 'GET /admin/sms/history') return send(res, 200, Object.assign({ texting: who.texting }, await SMS.history(ctx.db, who, req.query || {})));
      if (route === 'GET /admin/sms/player') { const pid = S.clean(req.query.id, 60); const r = await SMS.recipient(ctx.db, pid); const h = await SMS.history(ctx.db, who, { player: pid, limit: 20 }); return send(res, 200, { recipient: r, logs: h.logs, batches: h.batches }); }
      if (route === 'POST /admin/sms/settings') { SMS.requireTexting(who); return send(res, 200, await SMS.saveSettings(ctx.db, b, who.email)); }
      if (route === 'POST /admin/sms/optin') { SMS.requireTexting(who); const set = await SMS.setOptIn(ctx.db, S.clean(b.player, 60), b.optIn === true, { source: 'staff', by: who.email, phone: b.phone }); logger.info('sms consent', { by: who.email, player: b.player, optIn: set.optIn }); return send(res, 200, { ok: true, consent: set, recipient: await SMS.recipient(ctx.db, S.clean(b.player, 60)) }); }
      if (route === 'POST /admin/sms/optin-roster') { if (!who.owner) throw S.err(403, 'owner', 'Only an owner can opt the roster in.'); const out = await SMS.optInRoster(ctx.db, who); logger.info('sms consent roster', Object.assign({ by: who.email }, out)); return send(res, 200, Object.assign({ ok: true }, out)); }
      if (route === 'POST /admin/sms/test') { const out = await SMS.testSend(ctx.db, who, b.phone, b.body); logger.info('sms test', Object.assign({ by: who.email }, out)); return send(res, 200, out); }
      if (route === 'POST /admin/sms/send') { const out = await SMS.send(ctx.db, who, b); logger.info('sms batch', Object.assign({ by: who.email }, out)); return send(res, 200, out); }
      if (route === 'POST /admin/sms/continue') { SMS.requireTexting(who); return send(res, 200, await SMS.continueBatch(ctx.db, S.clean(b.batch, 60))); }
      if (route === 'POST /admin/sms/retry') { SMS.requireTexting(who); return send(res, 200, await SMS.retryBatch(ctx.db, S.clean(b.batch, 60))); }
      // ── everything below moves money or a family's plan: owners, administrators and the Billing page only ──
      ADMIN.requireBilling(who);
      if (route === 'POST /admin/portal') { const c = S.clean(b.customer, 60); if (!/^cus_/.test(c)) throw S.err(400, 'customer', 'customer id required'); return send(res, 200, { url: await S.portalUrl(stripe, c, SITE + '/backend') }); }
      if (route === 'POST /admin/hold') {
        const id = subIdOf(b); const on = b.hold === true; const today = CAL.todayET();
        const sub = await stripe.subscriptions.update(id, { metadata: { hold: on ? 'true' : '', hold_since: on ? today : '', hold_by: who.email, hold_invoice: '' } });
        logger.info('hold', { id, on, by: who.email });
        const p = await ROSTER.setPlan(ctx.db, id, on ? { hold: true, holdReason: 'staff', holdSince: today, holdBy: who.email, holdInvoice: '', invoiceUrl: '' } : { hold: false, holdReason: '', holdSince: '', holdBy: who.email, holdInvoice: '', invoiceUrl: '' }, { log });
        const fam = await familyOfSub(stripe, sub);
        await ROSTER.tell(ctx.db, on ? 'hold' : 'released', p, { reason: 'staff', by: who.name || who.email, phone: fam.phone, player: (sub.metadata || {}).player || '' });
        return send(res, 200, { ok: true, player: p ? p.id : null });
      }
      if (route === 'POST /admin/cancel') {
        const id = subIdOf(b); const today = CAL.todayET();
        let sub, endsOn = null;
        if (b.now === true) { sub = await stripe.subscriptions.cancel(id, { cancellation_details: { comment: 'Cancelled by ' + who.email } }); endsOn = today; }
        else { sub = await stripe.subscriptions.update(id, { cancel_at_period_end: true, metadata: { cancel_by: who.email } }); const end = S.periodEnd(sub); endsOn = end ? CAL.dateOfUnixET(end) : null; }
        logger.info('cancel', { id, now: b.now === true, by: who.email });
        const p = await ROSTER.setPlan(ctx.db, id, b.now === true ? { status: 'canceled', hold: false, endsOn, cancelledReason: 'staff', cancelledBy: who.email } : { endsOn, cancelledReason: 'staff', cancelledBy: who.email }, { log });
        const fam = await familyOfSub(stripe, sub);
        await ROSTER.tell(ctx.db, 'cancelled', p, { reason: 'staff', by: who.name || who.email, endsOn, phone: fam.phone, player: (sub.metadata || {}).player || '' });
        return send(res, 200, { ok: true, endsOn, player: p ? p.id : null });
      }
      if (route === 'POST /admin/resume') {
        const id = subIdOf(b);
        const sub = await stripe.subscriptions.update(id, { cancel_at_period_end: false, metadata: { cancel_by: '' } });
        const p = await ROSTER.setPlan(ctx.db, id, { endsOn: null, cancelledReason: '', cancelledBy: '' }, { log });
        await ROSTER.tell(ctx.db, 'keep', p, { by: who.name || who.email, player: (sub.metadata || {}).player || '' });
        return send(res, 200, { ok: true, player: p ? p.id : null });
      }
      if (route === 'POST /admin/plan') {
        // A paid start month whose plan is missing (the family never reached the thank-you page): create it now, and file the player.
        const sid = S.clean(b.session, 80); if (!/^cs_/.test(sid)) throw S.err(400, 'session', 'session id required');
        const session = await stripe.checkout.sessions.retrieve(sid, { expand: ['payment_intent', 'customer'] });
        const sub = await CHECKOUT.ensureEnrollment(stripe, session, log);
        if (!sub) throw S.err(409, 'not_paid', 'That session is not a paid start-month payment.');
        const rec = await ROSTER.record(ctx.db, stripe, session, sub, { log, mode: ctx.mode });
        await SMS.consentFromSession(ctx.db, session, rec);
        return send(res, 200, { ok: true, subscription: sub.id, player: rec ? rec.player : null });
      }
      if (route === 'POST /admin/record') {
        // File (again) the roster record and the messages for any paid checkout — a staff retry when something was missed.
        const sid = S.clean(b.session, 80); if (!/^cs_/.test(sid)) throw S.err(400, 'session', 'session id required');
        const session = await stripe.checkout.sessions.retrieve(sid, { expand: ['payment_intent', 'customer', 'subscription'] });
        let sub = session.mode === 'subscription' && session.subscription && typeof session.subscription === 'object' ? session.subscription : null;
        if (!sub && CHECKOUT.isProgramPayment(session)) sub = await CHECKOUT.findEnrollment(stripe, S.customerId(session.customer), session.id);
        const rec = await ROSTER.record(ctx.db, stripe, session, sub, { log, mode: ctx.mode });
        await SMS.consentFromSession(ctx.db, session, rec);
        return send(res, 200, { ok: !!rec, player: rec ? rec.player : null, what: rec ? rec.what : null });
      }
      if (route === 'POST /admin/charge') { const out = await ADMIN.chargeOnFile(stripe, b, who); logger.info('charge on file', Object.assign({ by: who.email }, out)); return send(res, 200, out); }
      if (route === 'POST /admin/enroll-link') { const out = await CHECKOUT.createMonthlySession(stripe, Object.assign({}, b, { by: 'staff:' + who.email })); return send(res, 200, out); }
      if (route === 'POST /admin/notify-test') {
        if (!who.owner) throw S.err(403, 'owner', 'Only an owner can send the test messages.');
        return send(res, 200, await NOTIFY.test(ctx.db, S.clean(b.phone, 30)));
      }
      if (route === 'POST /admin/run-jobs') {
        if (!who.owner) throw S.err(403, 'owner', 'Only an owner can run the jobs by hand.');
        const today = /^\d{4}-\d{2}-\d{2}$/.test(b.today || '') ? b.today : CAL.todayET();
        const lines = []; const l2 = (l) => lines.push(l);
        const plans = !b.which || b.which === 'plans' ? await JOBS.convertPaidEnrollments(stripe, today, l2, ctx) : null;
        const credits = !b.which || b.which === 'credits' ? await JOBS.applyBreakCredits(stripe, today, l2, ctx) : null;
        const late = !b.which || b.which === 'late' ? await JOBS.applyLatePolicy(stripe, today, l2, ctx) : null;
        const holds = !b.which || b.which === 'holds' ? await JOBS.releaseHolds(stripe, today, l2, ctx) : null;
        const roster = !b.which || b.which === 'roster' ? await ROSTER.syncSubscriptions(ctx.db, (await ADMIN.overview(stripe)).subscriptions, { log: l2 }) : null;
        logger.info('jobs run by hand', { by: who.email, today, lines });
        return send(res, 200, { today, plans, credits, late, holds, roster, log: lines });
      }
      throw S.err(404, 'route', 'No such admin route.');
    }
    throw S.err(404, 'route', 'No such route.');
  } catch (e) { fail(res, e); }
});

exports.dailyBilling = onSchedule({ schedule: '5 5 * * *', timeZone: CAL.TZ, region: REGION, secrets: [STRIPE_SECRET_KEY], retryCount: 2, timeoutSeconds: 540, memory: '256MiB' }, async () => {
  const key = STRIPE_SECRET_KEY.value();
  const stripe = S.stripeFor(key);
  const ctx = { db: DB.get(), mode: mode(key) };
  const today = CAL.todayET();
  const log = (l) => logger.info('billing: ' + l);
  const plans = await JOBS.convertPaidEnrollments(stripe, today, log, ctx);
  const credits = await JOBS.applyBreakCredits(stripe, today, log, ctx);
  const late = await JOBS.applyLatePolicy(stripe, today, log, ctx);
  const holds = await JOBS.releaseHolds(stripe, today, log, ctx);
  let roster = { checked: 0, updated: [], finished: [] };
  try { roster = await ROSTER.syncSubscriptions(ctx.db, (await ADMIN.overview(stripe)).subscriptions, { log }); } catch (e) { logger.error('roster sync failed', { message: e.message }); }
  if (plans.created.length || plans.recorded.length || plans.errors.length) logger.info('dailyBilling plans', plans);
  logger.info('dailyBilling done', { today, mode: ctx.mode, plans: { checked: plans.checked, created: plans.created.length, recorded: plans.recorded.length, errors: plans.errors.length }, credits: { checked: credits.checked, credited: credits.credited.length, paused: credits.paused.length, told: credits.told, errors: credits.errors.length }, late: { checked: late.checked, failed: late.failed.length, lateFees: late.lateFees.length, holds: late.holds.length, cancelled: late.cancelled.length, errors: late.errors.length }, holds: { checked: holds.checked, released: holds.released.length, errors: holds.errors.length }, roster: { checked: roster.checked, updated: roster.updated.length, finished: roster.finished.length } });
  if (plans.errors.length || credits.errors.length || late.errors.length || holds.errors.length) logger.error('dailyBilling errors', { plans: plans.errors, credits: credits.errors, late: late.errors, holds: holds.errors });
});

/* The nightly copy of the whole database to the backups bucket (lib/backup.js). 04:40 ET, after the billing run. */
exports.nightlyBackup = onSchedule({ schedule: '40 4 * * *', timeZone: CAL.TZ, region: REGION, retryCount: 2, timeoutSeconds: 300, memory: '256MiB' }, async () => {
  try { const out = await BACKUP.run((l) => logger.info('backup: ' + l)); logger.info('nightlyBackup started', out); }
  catch (e) { logger.error('nightlyBackup failed', { message: e.message }); throw e; }
});
