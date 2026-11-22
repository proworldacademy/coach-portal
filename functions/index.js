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
const LESSONS = require('./lib/lessons');
const IDEAS = require('./lib/ideas');
const PLAN = require('./lib/plan');
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
const VOICE = require('./lib/voice');
const SMS = require('./lib/sms');
const MONDAY = require('./lib/mondayimport');
const CONTACTS = require('./lib/contacts');
const COACHTEXT = require('./lib/coachtext');
const PUSH = require('./lib/push');
const SIGNIN = require('./lib/signin');
const MAIL = require('./lib/mail');
const USERS = require('./lib/users');
const TEAM = require('./lib/team');
const COACHCAL = require('./lib/coachcal');
const COURTS = require('./lib/courts');
const SCHED = require('./lib/schedule');
const PAYROLL = require('./lib/payroll');
const CLIENT = require('./lib/client');
const ASSISTANT = require('./lib/assistant');
const BRAIN = require('./lib/brain');
/* Who is told what, for the schedule (Nov 20, 2026). Owners: the staff records marked owner and the owner sign-ins. */
async function ownerEmails(db) { const out = new Set(); try { (await db.collection('staff').where('owner', '==', true).get()).docs.forEach((d) => out.add(String(d.id).toLowerCase())); } catch (e) { /* the sign-ins below */ }
  try { const auth = require('firebase-admin/auth').getAuth(); for (const uid of ADMIN.OWNERS || []) { try { const u = await auth.getUser(uid); if (u.email) out.add(u.email.toLowerCase()); } catch (e) { /* next */ } } } catch (e) { /* none */ } return Array.from(out); }
async function directorEmails(db) { const out = new Set(); try { (await db.collection('groups').get()).docs.forEach((d) => ((d.data() || {}).directors || []).forEach((e) => out.add(String(e).toLowerCase()))); } catch (e) { /* none */ } return Array.from(out); }
function schedDeps(db) { const many = async (emails, title, text, url) => { for (const e of emails) { try { await TEAM.direct(db, e, text); } catch (err) { /* next */ } } try { if (emails.length) await PUSH.send(db, emails, { title, body: text.slice(0, 180), url, tag: 'schedule' }); } catch (err) { /* no phone on */ } };
  return { tellCoach: (name, text) => LESSONS.tellCoach(db, name, text), tellDesk: (text) => NOTIFY.slack(db, 'desk', '*Schedule*', [text]),
    tellFamily: async (email, m) => { try { await PUSH.send(db, [email], m.push); } catch (e) { /* no phone on */ } await MAIL.send(db, { to: email, subject: m.subject, text: m.text }); },
    tellOwners: async (text) => many(await ownerEmails(db), 'Time off request', text, '/portal#/calendar'),
    tellStaff: async (text) => { try { await NOTIFY.slack(db, 'desk', '*Rain*', [text]); } catch (e) { /* next */ } await many(Array.from(new Set((await ownerEmails(db)).concat(await directorEmails(db)))), 'Rain', text, '/backend'); } }; }
const NEWS = require('./lib/news');

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

// minInstances 1: one engine stays warm, so the first tap on Messages / Courts / Privates after a quiet spell answers in ~100 ms instead of a 3–6 s cold start (Antonio, Oct 25)
exports.api = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY], minInstances: 1, maxInstances: 10, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
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
    // A parent signs in with six digits sent to their e-mail (lib/signin.js) — the sign-in that works inside the App Store app.
    /* Open sign-up (Nov 21, 2026): a profile without a child. The page then asks for the six-digit code like any sign-in. */
    if (route === 'POST /family/signup') {
      const db = ctx.db; const out = await CLIENT.signup(db, req.body || {}, { isTeam: async (e) => (await db.collection('staff').doc(e).get()).exists,
        onFile: async (e) => { const f = await FAMILY.findPlayers(db, S.stripeFor(key), e); return !!(f && ((f.players && f.players.length) || (f.customers && f.customers.length))); },
        tellDesk: (text) => NOTIFY.slack(db, 'desk', '*New profile*', [text]) });
      log('signup: profile asked'); return send(res, 200, out);
    }
    if (route === 'POST /family/code' || route === 'POST /family/code/verify') {
      const b = req.body || {}; const db = ctx.db;
      if (route === 'POST /family/code') {
        const out = await SIGNIN.start(db, {
          isTeam: async (e) => (await db.collection('staff').doc(e).get()).exists,
          onFile: async (e) => { if (await CLIENT.get(db, e)) return true; const f = await FAMILY.findPlayers(db, S.stripeFor(key), e); return !!(f && ((f.players && f.players.length) || (f.customers && f.customers.length) || (Array.isArray(f) && f.length))); },
          mail: (m) => MAIL.send(db, m)
        }, b.email);
        log('signin: code asked'); return send(res, 200, out);
      }
      const out = await SIGNIN.finish(db, { login: SIGNIN.firebaseLogin }, b.email, b.code);
      log('signin: code accepted'); return send(res, 200, out);
    }
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
      if (/^reply kept/.test(String(out.did || '')) && Array.isArray(out.players) && out.players.length) {
        // a family wrote back: the coach's inbox row and their Slack (Nov 4); the body is trusted because the signature was
        const d = (req.body && req.body.data) || {}; const text = String((d.sms_info && d.sms_info.body) || d.body || '');
        try { const r = await COACHTEXT.onReply(ctx.db, { players: out.players, text, phone: SMS.e164(d.contact_number || ''), line: SMS.e164(d.justcall_number || '') }); logger.info('coach reply', r); } catch (e) { logger.warn('coach reply not told', { message: e.message }); }
      }
      return send(res, 200, { ok: true, did: out.did });
    }

    /* the one brain, for the website's assistant: the same text Ask ProWorld reads, with the roster key (Nov 21, 2026) */
    if (route === 'GET /brain') { await FEED.requireKey(ctx.db, req); const today = require('./lib/calendar').todayET(); const b = await BRAIN.get(ctx.db); return send(res, 200, { text: BRAIN.text(b, today), at: b.at, today }); }
    if (route === 'POST /brain/log') { await FEED.requireKey(ctx.db, req); const lb = req.body || {}; return send(res, 200, await BRAIN.note(ctx.db, { q: ASSISTANT.scrub(lb.q, []), channel: lb.channel, handed: lb.handed === true })); }
    if (route === 'POST /brain/open') { await FEED.requireKey(ctx.db, req); return send(res, 200, await BRAIN.wonder(ctx.db, ASSISTANT.scrub((req.body || {}).q, []), 'web')); }
    if (route === 'GET /roster') {
      // the roster feed for the concierge and the morning digest — read-only, one key, set by an owner on the backend
      await FEED.requireKey(ctx.db, req);
      return send(res, 200, await FEED.roster(ctx.db));
    }

    if (path.startsWith('/api/family/')) {
      // the family portal: a signed-in parent sees their own players, attendance, reports and bills — nothing else
      const stripe = S.stripeFor(key); const b = req.body || {};
      /* An owner in a client's account (Nov 22, 2026 — "coming in as an owner, taking that view… it has to be identical": what the
         client sees, does and receives). The page sends the player's id in X-View-Family with the owner's own sign-in; the engine
         looks the family's e-mail up itself, and from there every route runs as that family: book, mark a day, pay with the card
         on file, write to Admin, ask the assistant. It is real: the family's card is charged and the family gets the confirmations.
         Each thing done is logged with the owner's e-mail. One thing stays the owner's own: this phone is not registered for the
         family's notifications. (Nov 16: the view was read-only.) */
      const viewPid = S.clean(req.headers['x-view-family'], 80); let acting = null;
      if (viewPid) {
        const o = await ADMIN.requireStaff(req).catch(() => null);
        if (o && o.owner) {
          const snap = viewPid.includes('/') ? null : await ctx.db.doc('players/' + viewPid + '/private/contact').get();
          const c = snap && snap.exists ? snap.data() || {} : {}; const em = String(c.email || '').trim().toLowerCase();
          if (!em) throw S.err(404, 'noemail', 'This player has no parent e-mail on file, so the family has no account to open yet.');
          if (route.indexOf(' /family/push/') > 0 && req.method === 'POST') throw S.err(403, 'viewing', 'Notifications stay on the family\'s own phones. Your phone is not added to this account.');
          acting = { email: em, name: String(c.guardian || ''), by: o.email };
          logger.info(req.method === 'GET' ? 'view as client' : 'acting as client', { by: o.email, player: viewPid, route });
        }
      }
      const who = acting ? { email: acting.email, name: acting.name } : await FAMILY.requireFamily(req);
      if (route === 'GET /family/me') { const out = await FAMILY.me(ctx.db, stripe, who); const cl = await CLIENT.get(ctx.db, who.email);
        /* a profile without a child is known too; `member` says an academy family (courts are free for them), `people` are the adults on the account */
        return send(res, 200, Object.assign({ mode: mode(key) }, acting ? { viewing: true } : {}, out, { member: (out.players || []).some((p) => p.status !== 'finished'), known: out.known || !!cl, people: CLIENT.people(cl), profile: cl ? { name: cl.name || '', phone: cl.phone || '', photo: cl.photo || '', quiet: cl.quiet === true } : null, name: out.name || (cl && cl.name) || '', courtCents: SCHED.RENT.hourCents, ask: await ASSISTANT.ready(ctx.db) })); }
      if (route === 'POST /family/portal') return send(res, 200, await FAMILY.portal(stripe, who, ctx.db));
      /* Ask ProWorld (Nov 21, 2026): a question about the one player selected; the answer may carry a card the parent confirms (lib/assistant.js) */
      if (route === 'POST /family/ask/forget') { const found = await FAMILY.findPlayers(ctx.db, stripe, who.email); return send(res, 200, await ASSISTANT.forget(ctx.db, who, (found.players || []).concat(CLIENT.people(await CLIENT.get(ctx.db, who.email))))); }
      if (route === 'POST /family/ask') { const found = await FAMILY.findPlayers(ctx.db, stripe, who.email); const players = (found.players || []).concat(CLIENT.people(await CLIENT.get(ctx.db, who.email)));
        const out = await ASSISTANT.ask(ctx.db, who, b, players); logger.info('family ask', { card: out.card ? out.card.type : '' }); return send(res, 200, out); }
      if (route === 'POST /family/request') {
        const { players } = await FAMILY.findPlayers(ctx.db, stripe, who.email);
        const out = await FAMILY.request(ctx.db, who, b, players);
        logger.info('family request', { by: who.email, kind: out.kind, id: out.id });
        return send(res, 200, out);
      }
      /* the schedule and the messages of the client account (Nov 17, 2026): days away and make-up days; a chat with the player's
         coaches or with Admin */
      if (route === 'POST /family/account') { const { players } = await FAMILY.findPlayers(ctx.db, stripe, who.email); const out = await FAMILY.account(ctx.db, who, b, players); logger.info('family account', { by: who.email, action: S.clean(b.action, 20) }); return send(res, 200, out); }
      if (route === 'POST /family/people') { const { players } = await FAMILY.findPlayers(ctx.db, stripe, who.email); const out = await FAMILY.people(ctx.db, who, b, players); logger.info('family people', { by: who.email, player: S.clean(b.player, 60), n: out.people.length }); return send(res, 200, out); }
      if (route === 'POST /family/days' || route === 'POST /family/chat' || route === 'POST /family/message') {
        const { players } = await FAMILY.findPlayers(ctx.db, stripe, who.email);
        const out = route === 'POST /family/days' ? await FAMILY.days(ctx.db, who, b, players) : route === 'POST /family/chat' ? await FAMILY.chat(ctx.db, who, b, players) : await FAMILY.message(ctx.db, who, b, players);
        if (route !== 'POST /family/chat') logger.info('family ' + route.slice(13), { by: who.email, player: S.clean(b.player, 60), action: out.action || out.to || '' });
        return send(res, 200, out);
      }
      /* a court reserved from the client's calendar (Nov 20, 2026): the free times, the free courts, reserve, cancel, my courts */
      /* the profile and its people (Nov 21, 2026) */
      if (route === 'POST /family/profile') return send(res, 200, await CLIENT.save(ctx.db, who, b));
      if (route === 'POST /family/person') { const out = await CLIENT.addPerson(ctx.db, who, b); logger.info('family person added', { by: who.email }); return send(res, 200, out); }
      if (route === 'POST /family/person/remove') return send(res, 200, await CLIENT.removePerson(ctx.db, who, b));
      if (route === 'POST /family/court/slots' || route === 'POST /family/court/book' || route === 'POST /family/court/cancel' || route === 'POST /family/court/list' || route === 'POST /family/court/confirm') {
        const fn = route.split('/').pop(); const cl = await CLIENT.get(ctx.db, who.email); const fam = { email: who.email, name: who.name || (cl && cl.name) || '' };
        if (fn === 'book') { const f = await FAMILY.findPlayers(ctx.db, stripe, who.email); fam.member = (f.players || []).some((p) => String(p.status || 'active') !== 'finished'); }
        const payDeps = Object.assign(schedDeps(ctx.db), {
          checkout: async (o) => { const customer = await S.findOrCreateCustomer(stripe, { email: o.email, name: o.name }); const meta = { kind: 'court-rental', rental: o.id, source: 'proworld-backend' };
            const ses = await stripe.checkout.sessions.create({ mode: 'payment', customer: customer.id, payment_method_types: ['card'], line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: o.cents, product_data: { name: o.label.slice(0, 240) } } }],
              payment_intent_data: { description: o.label.slice(0, 900), metadata: meta, setup_future_usage: 'off_session' }, metadata: meta, expires_at: Math.floor(Date.now() / 1000) + Math.max(30, o.minutes) * 60,
              success_url: `${ROSTER.SITE}/family?court=${encodeURIComponent(o.id)}`, cancel_url: `${ROSTER.SITE}/family?courtx=${encodeURIComponent(o.id)}` }, { idempotencyKey: 'court_' + o.id + '_' + o.cents });
            return { url: ses.url, id: ses.id }; },
          refund: async (o) => stripe.refunds.create({ payment_intent: o.intent, amount: o.cents, reason: 'requested_by_customer', metadata: { kind: 'court-rental', rental: o.id } }, { idempotencyKey: 'court_refund_' + o.id }),
          paid: async (sid) => { const ses = await stripe.checkout.sessions.retrieve(sid); return { paid: ses.payment_status === 'paid', intent: S.customerId(ses.payment_intent) || '' }; } });
        if (fn === 'confirm') { const out = await SCHED.rentConfirm(ctx.db, fam, b, payDeps); logger.info('family court confirm', { by: who.email, id: S.clean(b.id, 80), status: out.status }); return send(res, 200, out); }
        if (fn === 'book') { const out = await SCHED.rentBook(ctx.db, fam, b, payDeps); logger.info('family court book', { by: who.email, id: out.id, paid: !!out.pay }); return send(res, 200, out); }
        const out = fn === 'slots' ? await SCHED.rentSlots(ctx.db, fam, b) : fn === 'list' ? await SCHED.rentList(ctx.db, fam) : fn === 'book' ? await SCHED.rentBook(ctx.db, fam, b, schedDeps(ctx.db)) : await SCHED.rentCancel(ctx.db, fam, b, payDeps);
        if (fn === 'book' || fn === 'cancel') logger.info('family court ' + fn, { by: who.email, id: out.id || S.clean(b.id, 80) });
        return send(res, 200, out);
      }
      /* privates from the client's calendar (Nov 19, 2026): the coaches of a kind, a coach's open times on a day, book one, cancel one */
      if (route === 'POST /family/private/slots' || route === 'POST /family/private/courts' || route === 'POST /family/private/book' || route === 'POST /family/private/cancel') {
        const found = await FAMILY.findPlayers(ctx.db, stripe, who.email); const players = (found.players || []).concat(CLIENT.people(await CLIENT.get(ctx.db, who.email)));   // the adults on the profile book privates too
        const deps = { tellCoach: (name, text) => LESSONS.tellCoach(ctx.db, name, text), tellDesk: (text) => NOTIFY.slack(ctx.db, 'desk', '*Private* — booked in the app', [text]),
          tellFamily: async (email, m) => { try { await PUSH.send(ctx.db, [email], m.push); } catch (e) { /* no phone on */ } await MAIL.send(ctx.db, { to: email, subject: m.subject, text: m.text }); } };
        if (route.endsWith('/courts')) return send(res, 200, await COACHCAL.familyCourts(ctx.db, who, b, players));
        const out = route.endsWith('/slots') ? await COACHCAL.familySlots(ctx.db, who, b, players) : route.endsWith('/book') ? await COACHCAL.familyBook(ctx.db, who, b, players, deps) : await COACHCAL.familyCancel(ctx.db, who, b, players, deps);
        if (!route.endsWith('/slots')) logger.info('family private ' + route.slice(21), { by: who.email, id: out.id || S.clean(b.id, 80) });
        return send(res, 200, out);
      }
      // notifications on a parent's phone (Nov 19, 2026): the same subscriptions the team has, kept under the parent's e-mail
      if (route === 'GET /family/push/key') return send(res, 200, { key: (await PUSH.keys(ctx.db)).publicKey });
      if (route === 'POST /family/push/subscribe') { const out = await PUSH.subscribe(ctx.db, who, b); logger.info('family push on', { by: who.email }); return send(res, 200, out); }
      if (route === 'POST /family/push/apns') { const out = await PUSH.registerApns(ctx.db, who, b); logger.info('family push on (app)', { by: who.email }); return send(res, 200, out); }
      throw S.err(404, 'route', 'No such family route.');
    }

    if (path.startsWith('/api/marketing/')) {
      // the idea engine, live (Oct 28): owners, administrators and the Marketing people
      const who = await ADMIN.requireMarketing(req);
      const b = req.body || {};
      if (route === 'POST /marketing/ideas') { const out = await IDEAS.ideas(ctx.db, who, b); logger.info('ideas', { by: who.email, coach: b.coach || '', n: out.ideas.length, took: out.took }); return send(res, 200, out); }
      if (route === 'POST /marketing/plan') { const out = await PLAN.assist(ctx.db, who, b); return send(res, 200, out); }
      if (route === 'GET /marketing/ideas/status') { const st = await IDEAS.settings(ctx.db, true); return send(res, 200, { ready: /^sk-ant-/.test(String(st.anthropicKey || '')), by: st.by || '', at: st.at || 0 }); }
      throw S.err(404, 'route', 'No such marketing route.');
    }

    if (path.startsWith('/api/coach/')) {
      // the Coach Portal's own routes (Nov 4): a text to a family through the academy's JustCall line, the conversation, the inbox.
      // Anyone active on the staff list with the portal; a coach reaches only the players whose record carries their name.
      let who = await ADMIN.requireCoach(req); const b = req.body || {};
      const readCoach = S.clean(req.headers['x-read-coach'], 120);
      if (readCoach && !who.viewing && req.method === 'GET') who = await ADMIN.readAs(who, readCoach);   // a director reading one coach's chats: that coach's view, reading only
      if (who.viewing) {
        // an owner looking at the portal as this person ("View as"): reading only, and nothing is marked as read for them
        if (route === 'GET /coach/thread') return send(res, 200, await COACHTEXT.thread(ctx.db, who, S.clean(req.query.player, 60), { conv: S.clean(req.query.conv, 40), markRead: false }));
        if (route === 'GET /coach/inbox') return send(res, 200, await COACHTEXT.inbox(ctx.db, who));
        if (route === 'GET /coach/groups') return send(res, 200, await COACHTEXT.groups(ctx.db, who));
        if (route === 'GET /coach/push/key') return send(res, 200, { key: (await PUSH.keys(ctx.db)).publicKey });
        if (route === 'POST /coach/calendar') return send(res, 200, await SCHED.week(ctx.db, who, b));
        if (route === 'POST /coach/read') return send(res, 200, { ok: true, viewing: true });
        throw S.err(403, 'viewing', `You are looking at the portal as ${who.firstName || 'this person'}. Go back to your own view to send or change anything.`);
      }
      if (route === 'POST /coach/text') { const out = await COACHTEXT.text(ctx.db, who, b); logger.info('coach text', { by: who.email, player: S.clean(b.player, 60), conv: out.conv, sent: out.sent, failed: out.failed, tick: out.tick }); return send(res, 200, out); }
      if (route === 'GET /coach/thread') return send(res, 200, await COACHTEXT.thread(ctx.db, who, S.clean(req.query.player, 60), { conv: S.clean(req.query.conv, 40), markRead: String(req.query.peek || '') !== '1' }));
      if (route === 'POST /coach/group') { const out = await COACHTEXT.group(ctx.db, who, b); logger.info('coach group text', { by: who.email, gid: out.gid, sent: out.sent, skipped: out.skipped, total: out.total }); return send(res, 200, out); }
      if (route === 'GET /coach/groups') return send(res, 200, await COACHTEXT.groups(ctx.db, who));
      // notifications on the phone (Nov 13): the public key, this phone's subscription, a test to yourself
      if (route === 'GET /coach/push/key') return send(res, 200, { key: (await PUSH.keys(ctx.db)).publicKey });
      if (route === 'POST /coach/push/subscribe') { const out = await PUSH.subscribe(ctx.db, who, b); logger.info('push on', { by: who.email }); return send(res, 200, out); }
      if (route === 'POST /coach/push/unsubscribe') return send(res, 200, await PUSH.unsubscribe(ctx.db, who, b));
      if (route === 'POST /coach/push/apns') { const out = await PUSH.registerApns(ctx.db, who, b); logger.info('push on (app)', { by: who.email }); return send(res, 200, out); }
      if (route === 'POST /coach/push/apns/off') return send(res, 200, await PUSH.unregisterApns(ctx.db, who, b));
      if (route === 'POST /coach/push/test') return send(res, 200, await PUSH.send(ctx.db, [who.email], { title: 'PROWORLD', body: 'Notifications are on for this phone.', url: '/portal', tag: 'test' }));
      // the coach's calendar (Nov 19, 2026): a week of academy hours, privates and open times; time off
      if (route === 'POST /coach/calendar') return send(res, 200, await SCHED.week(ctx.db, who, b));
      if (route === 'POST /coach/private/ack') { const out = await COACHCAL.ack(ctx.db, who, b); logger.info('private received', { by: who.email, id: out.id }); return send(res, 200, out); }
      /* the rest of the one schedule (Nov 20, 2026): hours, days off through an owner, privates added by staff, the court plan, rain */
      if (route === 'POST /coach/calendar/hours') { const out = await SCHED.setHours(ctx.db, who, b); logger.info('coach hours', { by: who.email, coach: S.clean(b.coach, 40) }); return send(res, 200, out); }
      if (route === 'POST /coach/timeoff/ask') { const out = await SCHED.askOff(ctx.db, who, b, schedDeps(ctx.db)); logger.info('time off asked', { by: who.email, id: out.id, status: out.status }); return send(res, 200, out); }
      if (route === 'POST /coach/timeoff/decide') { const out = await SCHED.decideOff(ctx.db, who, b, schedDeps(ctx.db)); logger.info('time off decided', { by: who.email, id: S.clean(b.id, 80), status: out.status }); return send(res, 200, out); }
      if (route === 'POST /coach/timeoff/withdraw') return send(res, 200, await SCHED.withdrawOff(ctx.db, who, b));
      if (route === 'POST /coach/private/players') return send(res, 200, await SCHED.coachPlayers(ctx.db, who, b));
      if (route === 'POST /coach/private/slots') return send(res, 200, await SCHED.coachSlots(ctx.db, who, b));
      if (route === 'POST /coach/private/book') { const out = await SCHED.coachBook(ctx.db, who, b, schedDeps(ctx.db)); logger.info('private added by staff', { by: who.email, id: out.id }); return send(res, 200, out); }
      if (route === 'POST /coach/private/cancel') { const out = await SCHED.coachCancel(ctx.db, who, b, schedDeps(ctx.db)); logger.info('private canceled by staff', { by: who.email, id: S.clean(b.id, 80) }); return send(res, 200, out); }
      if (route === 'POST /coach/courts/plan') return send(res, 200, Object.assign(await SCHED.plan(ctx.db, S.clean(b.date, 12)), await SCHED.planState(ctx.db)));
      if (route === 'POST /coach/courts/plan/apply') { const out = await SCHED.applyPlan(ctx.db, who, b); logger.info('court plan applied', { by: who.email, days: out.days }); return send(res, 200, out); }
      if (route === 'POST /coach/courts/plan/clear') { const out = await SCHED.clearPlan(ctx.db, who, b); logger.info('court plan cleared', { by: who.email, date: S.clean(b.date, 12) }); return send(res, 200, out); }
      if (route === 'POST /coach/courts/plan/auto') return send(res, 200, await SCHED.planAuto(ctx.db, who, b));
      // payroll from the schedule (Nov 20, 2026): owners read the period and set the rates; a coach asks for an extra
      if (route === 'POST /coach/payroll') return send(res, 200, await PAYROLL.report(ctx.db, who, b));
      if (route === 'POST /coach/payroll/rates') { const out = await PAYROLL.setRate(ctx.db, who, b); logger.info('payroll rates', { by: who.email, coach: S.clean(b.coach, 40) }); return send(res, 200, out); }
      if (route === 'POST /coach/payroll/extra') { const out = await PAYROLL.addExtra(ctx.db, who, b, schedDeps(ctx.db)); logger.info('payroll extra', { by: who.email, id: out.id, status: out.status }); return send(res, 200, out); }
      if (route === 'POST /coach/payroll/extra/decide') { const out = await PAYROLL.decideExtra(ctx.db, who, b); logger.info('payroll extra decided', { by: who.email, id: S.clean(b.id, 80) }); return send(res, 200, out); }
      if (route === 'POST /coach/payroll/mine') return send(res, 200, await PAYROLL.myExtras(ctx.db, who));
      if (route === 'POST /coach/rain') { const out = await SCHED.rain(ctx.db, who, b, schedDeps(ctx.db)); if (b.send) logger.info('rain notice', { by: who.email, send: b.send, sent: out.sent, total: out.total }); return send(res, 200, out); }
      if (route === 'POST /coach/calendar/off') { const out = await SCHED.setOff(ctx.db, who, b); logger.info('coach calendar off', { by: who.email, date: S.clean(b.date, 12), remove: !!b.remove }); return send(res, 200, out); }
      if (route === 'GET /coach/inbox') return send(res, 200, await COACHTEXT.inbox(ctx.db, who));
      if (route === 'POST /coach/read') return send(res, 200, await COACHTEXT.markRead(ctx.db, who, b));   // "I read this chat" (Nov 4 evening: one chat per number, group chats)
      throw S.err(404, 'route', 'No such coach route.');
    }

    if (route.startsWith('POST /voice/twiml/')) {
      // Twilio asks what to do with a call (Nov 17): the secret is in the address, as with the team hook; the answer is TwiML, not JSON
      const out = await VOICE.twiml(ctx.db, route.slice('POST /voice/twiml/'.length), req.body || {});
      logger.info('voice call', { from: String((req.body || {}).From || '').startsWith('client:') ? 'app' : 'outside' });
      res.status(200).set('Cache-Control', 'no-store').set('Content-Type', 'text/xml; charset=utf-8').send(out); return;
    }
    if (route === 'GET /voice/token') { const who = await ADMIN.requireTeam(req); return send(res, 200, await VOICE.token(ctx.db, who)); }
    if (route.startsWith('POST /team/hook/')) {
      // the same door with the secret in the address, the way Slack's own "incoming webhook" works: a system that can only be given a
      // webhook address (the concierge's SLACK_WEBHOOK) is pointed here and its lines land in Team. settings/teamHook { key }, made by an owner.
      const given = route.slice('POST /team/hook/'.length); const snap = await ctx.db.doc('settings/teamHook').get(); const key = snap.exists ? String((snap.data() || {}).key || '') : '';
      if (key.length < 32 || !FEED.sameKey(given, key)) throw S.err(401, 'key', 'That address is not right.');
      const out = await TEAM.hook(ctx.db, Object.assign({}, req.body || {}, { channel: String(req.query && req.query.channel || (req.body || {}).channel || '') })); logger.info('team hook (address)', { ok: out.ok }); return send(res, 200, out);
    }
    if (route === 'POST /team/hook') {
      // another system of ours speaking to the team (the concierge): the roster feed key it already holds, in the X-Roster-Key header
      await FEED.requireKey(ctx.db, req); const out = await TEAM.hook(ctx.db, req.body || {}); logger.info('team hook', { channel: S.clean((req.body || {}).channel, 40), ok: out.ok }); return send(res, 200, out);
    }
    if (path.startsWith('/api/team/')) {
      // the team's own messaging (Nov 15): the names of the team, the notification after a message, and this phone's notifications for people
      // who hold no Coach Portal (the same engine as /api/coach/push/*). Anyone active on the staff list.
      const who = await ADMIN.requireTeam(req); const b = req.body || {};
      if (route === 'GET /team/people') return send(res, 200, await TEAM.people(ctx.db));
      if (route === 'POST /team/here') return send(res, 200, await TEAM.here(ctx.db, who, b));
      if (route === 'POST /team/profile') return send(res, 200, await TEAM.setProfile(ctx.db, who, b));
      if (route === 'GET /team/ice') return send(res, 200, await TEAM.ice(ctx.db));
      if (route === 'POST /team/ring') { const out = await TEAM.ring(ctx.db, who, b); logger.info('team call', { by: who.email, to: out.to || 0, sent: out.sent || 0 }); return send(res, 200, out); }
      if (route === 'POST /team/ring/end') return send(res, 200, await TEAM.ringEnd(ctx.db, who, b));
      if (route === 'POST /team/push/state') return send(res, 200, await PUSH.setState(ctx.db, who, b));
      if (route === 'POST /team/notify') { const out = await TEAM.notify(ctx.db, who, b); logger.info('team message', { by: who.email, chat: S.clean(b.chat, 80), to: out.to || 0, sent: out.sent || 0 }); return send(res, 200, out); }
      if (route === 'GET /team/push/key') return send(res, 200, { key: (await PUSH.keys(ctx.db)).publicKey });
      if (route === 'POST /team/push/subscribe') return send(res, 200, await PUSH.subscribe(ctx.db, who, b));
      if (route === 'POST /team/push/unsubscribe') return send(res, 200, await PUSH.unsubscribe(ctx.db, who, b));
      if (route === 'POST /team/push/apns') return send(res, 200, await PUSH.registerApns(ctx.db, who, b));
      if (route === 'POST /team/push/apns/off') return send(res, 200, await PUSH.unregisterApns(ctx.db, who, b));
      throw S.err(404, 'route', 'No such team route.');
    }

    if (path.startsWith('/api/admin/')) {
      const who = await ADMIN.requireStaff(req);
      const stripe = S.stripeFor(key); const b = req.body || {};
      // Every family's plan, balance and contact is for the owners, administrators, the front desk and whoever holds Billing (Nov 13). A coach or a
      // director holds the backend page for Attendance and Privates: they get an empty answer here, and a refusal on the lists below.
      const seesBilling = !!(who.owner || who.admin || who.billing || who.role === 'desk');
      // the mailbox the sign-in codes go out from: is it set, and a test to the owner's own address (settings/mail is typed on the Dashboard)
      if (route === 'GET /admin/voice') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await VOICE.status(ctx.db)); }
      /* The move from Play by Point (Nov 17, 2026): owners only. preview writes nothing; apply writes players and their contact
         cards, never Stripe. */
      if (route === 'POST /admin/pbp/preview' || route === 'POST /admin/pbp/apply') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.');
        const PBP = require('./lib/pbpimport'); const rows = Array.isArray(b.rows) ? b.rows : [];
        if (!rows.length) throw S.err(400, 'rows', 'There is nothing to read.');
        if (route.endsWith('preview')) return send(res, 200, await PBP.preview(ctx.db, rows));
        const out = await PBP.apply(ctx.db, rows, who); logger.info('play by point import', Object.assign({ by: who.email }, out)); return send(res, 200, out); }
      if (route === 'POST /admin/voice/setup') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const out = await VOICE.setup(ctx.db); logger.info('voice connected', { by: who.email }); return send(res, 200, out); }
      if (route === 'POST /admin/voice/assign') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const out = await VOICE.assign(ctx.db, b); logger.info('voice number', { by: who.email }); return send(res, 200, out); }
      if (route === 'GET /admin/turn') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await TEAM.turnReady(ctx.db)); }
      if (route === 'GET /admin/brain/review') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await BRAIN.review(ctx.db)); }
      if (route === 'GET /admin/brain' || route === 'POST /admin/brain') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, route === 'GET /admin/brain' ? await BRAIN.view(ctx.db) : await BRAIN.admin(ctx.db, who, b)); }
      if (route === 'GET /admin/push/who') { if (!who.owner && !who.admin) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await PUSH.who(ctx.db, (await TEAM.people(ctx.db)).people)); }
      if (route === 'GET /admin/apns') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, { ready: await PUSH.apnsReady(ctx.db) }); }
      if (route === 'GET /admin/mail') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, { ready: await MAIL.ready(ctx.db) }); }
      if (route === 'POST /admin/mail/test') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); await MAIL.send(ctx.db, Object.assign({ to: who.email }, SIGNIN.letter('123456'), { subject: 'ProWorld: the sign-in e-mail works' })); return send(res, 200, { sent: true, to: who.email }); }
      if (route === 'GET /admin/overview') { if (!seesBilling) return send(res, 200, { mode: mode(key), who: who.email, billing: false, owner: false, at: new Date().toISOString(), today: CAL.todayET(), pending: [], counts: {}, subscriptions: [], openInvoices: [] }); return send(res, 200, Object.assign({ mode: mode(key), who: who.email, billing: who.billing, owner: who.owner }, await ADMIN.overview(stripe))); }
      if (!seesBilling && ['GET /admin/notices', 'GET /admin/switch', 'POST /admin/switch/update', 'GET /admin/catalog'].includes(route)) throw S.err(403, 'desk', 'That list is for the front desk and the owners.');
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
        const isAttendance = which === 'coaches' && /^\*?(Attendance|[A-Z]{3} \d{1,2} \|)/.test(String(b.text || ''));   // the attendance of a session goes to #full-time-attendance in Team (Nov 15)
        return send(res, 200, { ok: await NOTIFY.slack(ctx.db, which, S.clean(b.text, 600) + ' — ' + (who.name || who.email), lines, isAttendance ? { team: 'attendance' } : null) });
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
      // sign-in accounts for the team (Nov 4, e-mail + password): owners set them up from People & access
      if (route === 'POST /admin/users/status') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, { users: await USERS.status(Array.isArray(b.emails) ? b.emails : []) }); }
      if (route === 'POST /admin/users/ensure') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const out = await USERS.ensure(b.email, b.name); logger.info('sign-in account', { by: who.email, email: out.user.email, created: out.created }); return send(res, 200, out); }
      if (route === 'POST /admin/users/reset') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const out = await USERS.resetLink(b.email, b.name); logger.info('sign-in reset link', { by: who.email, email: out.user.email, created: out.created }); return send(res, 200, out); }
      if (route === 'POST /admin/users/password') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const out = await USERS.setPassword(b.email, b.password, b.name); logger.info('sign-in password set', { by: who.email, email: out.user.email, created: out.created }); return send(res, 200, out); }
      if (route === 'GET /admin/coachalerts') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const st = await NOTIFY.settings(ctx.db, true); const staff = (await ctx.db.collection('staff').where('active', '==', true).get()).docs.map((d) => ({ email: d.id, name: d.data().name || d.id, slack: d.data().slackName || '', linked: !!d.data().slackId, phone: !!d.data().phone })); return send(res, 200, { hasToken: !!st.slackBotToken, staff }); }
      if (route === 'POST /admin/coachalerts') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const tok = S.clean(b.slackBotToken, 200); if (!/^xox[bp]-[A-Za-z0-9-]{20,}$/.test(tok)) throw S.err(400, 'token', 'That does not look like a Slack bot token (it starts with xoxb-).'); await ctx.db.doc('settings/notify').set({ slackBotToken: tok, slackBotBy: who.email, slackBotAt: Date.now() }, { merge: true }); NOTIFY.forget(); return send(res, 200, await LESSONS.linkSlack(ctx.db)); }
      if (route === 'GET /admin/ai') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const st = await IDEAS.settings(ctx.db, true); return send(res, 200, { ready: /^sk-ant-/.test(String(st.anthropicKey || '')), by: st.by || '', at: st.at || 0 }); }
      if (route === 'POST /admin/ai') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); const k = S.clean(b.anthropicKey, 250); if (!/^sk-ant-[A-Za-z0-9_-]{30,}$/.test(k)) throw S.err(400, 'key', 'That does not look like an Anthropic API key (it starts with sk-ant-).'); await ctx.db.doc('settings/ai').set({ anthropicKey: k, by: who.email, at: Date.now() }, { merge: true }); IDEAS.forget(); return send(res, 200, { ready: true }); }
      if (route === 'POST /admin/coachalerts/link') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await LESSONS.linkSlack(ctx.db)); }
      // the weekly contact tracker (Nov 2): JustCall → ticks, the Friday reminder, who has a JustCall seat — directors and owners
      if (route === 'POST /admin/contacts/sync') { if (!who.director) throw S.err(403, 'director', 'Directors and owners only.'); const out = await CONTACTS.sync(ctx.db, { log }); logger.info('contacts sync', Object.assign({ by: who.email }, out)); return send(res, 200, out); }
      if (route === 'POST /admin/contacts/nudge') { if (!who.owner) throw S.err(403, 'owner', 'Owners only.'); return send(res, 200, await CONTACTS.nudge(ctx.db, { dry: b.dry === true })); }
      if (route === 'GET /admin/contacts/justcall') { if (!who.director) throw S.err(403, 'director', 'Directors and owners only.'); return send(res, 200, await CONTACTS.justcallUsers(ctx.db)); }
      // what families booked from their calendar and is not on a court yet; parent news (Nov 19, 2026)
      if (route === 'GET /admin/family-privates') return send(res, 200, await COACHCAL.deskList(ctx.db));
      if (route === 'POST /admin/court-holds') return send(res, 200, await COURTS.dayHolds(ctx.db, S.clean(b.date, 12)));
      if (route === 'POST /admin/family-privates/mark') return send(res, 200, await COACHCAL.deskMark(ctx.db, who, b));
      if (route === 'GET /admin/news') return send(res, 200, await NEWS.list(ctx.db));
      if (route === 'POST /admin/news' || route === 'POST /admin/news/remove') {
        if (!(who.owner || who.admin || who.director || who.role === 'desk')) throw S.err(403, 'news', 'Parent news is posted by the owners, the directors and the front desk.');
        const out = route === 'POST /admin/news' ? await NEWS.add(ctx.db, who, b) : await NEWS.remove(ctx.db, who, b);
        logger.info('parent news ' + (route.endsWith('/remove') ? 'removed' : 'added'), { by: who.email, id: out.id || S.clean(b.id, 60), told: out.told || null });
        return send(res, 200, out);
      }
      if (route === 'POST /admin/lesson/booked') return send(res, 200, await LESSONS.booked(ctx.db, who, b));        // a private was booked: the coach hears it
      if (route === 'POST /admin/lesson/cancelled') return send(res, 200, await LESSONS.cancelled(ctx.db, who, b));
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
      if (route === 'POST /admin/sms/hide') return send(res, 200, await SMS.hideBatch(ctx.db, who, S.clean(b.batch, 60)));
      if (route === 'POST /admin/sms/thread') return send(res, 200, await SMS.threadAction(ctx.db, who, S.clean(b.thread, 80), S.clean(b.action, 20)));
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

/* Private-lesson reminders: the evening before and one hour before, to the family (opted in) and the coach (lib/lessons.js). */
// the weekly contact tracker: JustCall's texts and calls become the week's ticks (every two hours, 7 AM to 9 PM Delray Beach time)
exports.contactSync = onSchedule({ schedule: '17 7-21/2 * * *', timeZone: CAL.TZ, region: REGION, retryCount: 1, timeoutSeconds: 300, memory: '256MiB' }, async () => {
  try { const out = await CONTACTS.sync(DB.get(), { log: (l) => logger.info(l) }); logger.info('contactSync', out); }
  catch (e) { logger.error('contactSync failed', { message: e.message }); }
});
// Friday late morning: each coach hears on Slack which families still have not heard from them this week; the coaches' channel gets the roll-up
exports.contactNudge = onSchedule({ schedule: '31 11 * * 5', timeZone: CAL.TZ, region: REGION, retryCount: 1, timeoutSeconds: 120, memory: '256MiB' }, async () => {
  try { const out = await CONTACTS.nudge(DB.get()); logger.info('contactNudge', out); }
  catch (e) { logger.error('contactNudge failed', { message: e.message }); }
});
exports.lessonReminders = onSchedule({ schedule: '*/15 * * * *', timeZone: CAL.TZ, region: REGION, retryCount: 1, timeoutSeconds: 120, memory: '256MiB' }, async () => {
  try { const out = await LESSONS.remind(DB.get(), Date.now(), (l) => logger.info('reminder: ' + l)); if (out.sent || out.errors.length) logger.info('lessonReminders', out); }
  catch (e) { logger.error('lessonReminders failed', { message: e.message }); }
  // privates booked by a family and not yet marked Received by the coach (Nov 19, 2026): the coach again, then the coach's director
  try { const n = await SCHED.rentSweep(DB.get()); if (n) logger.info('courts freed, never paid: ' + n); } catch (e) { logger.error('rentSweep failed', { message: e.message }); }
  try { const db = DB.get(); const out = await COACHCAL.chase(db, Date.now(), { tellCoach: (name, text) => LESSONS.tellCoach(db, name, text),
      tellDirectors: async (emails, text) => { if (!emails.length) { await NOTIFY.slack(db, 'desk', '*Private* — not marked received', [text]); return; } for (const e of emails) { try { await TEAM.direct(db, e, text); } catch (err) { /* next */ } } try { await PUSH.send(db, emails, { title: 'Private not marked received', body: text, url: '/portal#/calendar', tag: 'private-chase' }); } catch (err) { /* no phone on */ } } }, (l) => logger.info('private chase: ' + l));
    if (out.coach || out.director) logger.info('privateChase', out); }
  catch (e) { logger.error('privateChase failed', { message: e.message }); }
});
/* Every night at 2:10 (Nov 20, 2026): the academy's courts for the next seven days, when an owner has switched the nightly plan on. */
exports.courtPlanNightly = onSchedule({ schedule: '10 2 * * *', timeZone: CAL.TZ, region: REGION, retryCount: 1, timeoutSeconds: 300, memory: '256MiB' }, async () => {
  try { const out = await SCHED.nightly(DB.get(), (l) => logger.info(l)); if (out.ran) logger.info('courtPlanNightly', out); }
  catch (e) { logger.error('courtPlanNightly failed', { message: e.message }); }
});
/* Monday 8:10 (Nov 22, 2026): one line to the owners about what families asked the assistants last week. The review itself is on the Dashboard. */
exports.aiWeeklyReview = onSchedule({ schedule: '10 8 * * 1', timeZone: CAL.TZ, region: REGION, retryCount: 1, timeoutSeconds: 120, memory: '256MiB' }, async () => {
  try { const db = DB.get(); const r = await BRAIN.review(db); if (!r.total && !r.unansweredAll) return; const text = BRAIN.headline(r); const emails = await ownerEmails(db);
    for (const e of emails) { try { await TEAM.direct(db, e, text); } catch (err) { /* next */ } }
    try { if (emails.length) await PUSH.send(db, emails, { title: 'AI weekly review', body: text.slice(0, 180), url: '/#ai-review', tag: 'ai-review' }); } catch (err) { /* no phone on */ }
    logger.info('aiWeeklyReview', { total: r.total, toAdmin: r.toAdmin, open: r.unansweredAll, told: emails.length }); }
  catch (e) { logger.error('aiWeeklyReview failed', { message: e.message }); }
});
