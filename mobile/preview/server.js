/* The test copy of the site for the iPhone simulator (Nov 14, 2026): serves the repository's pages with the stand-in Firebase and invented
   people (the harness's seed), so the real app shell can open every page without a sign-in and without touching real families.
   GET /__set?u=<path>&who=<persona>&y=<scroll>   sets what the app opens next;  GET /__shot  redirects the app there.
   Used by .github/workflows/ios-preview.yml. Not published with the site. */
'use strict';
const path = require('path'); const fs = require('fs'); const http = require('http');
const REPO = process.env.REPO || path.resolve(__dirname, '../..'); process.env.REPO = REPO;
const H = require(REPO + '/functions/test/portal/chats.harness.js');
const STUB = fs.readFileSync(REPO + '/functions/test/portal/stub-firebase.js', 'utf8');
/* the member side: an invented parent with two players, the real engine (functions/lib/family.js, catalog, checkout) on a fake database and a fake Stripe */
const CAT = require(REPO + '/functions/lib/catalog'); const CHECKOUT = require(REPO + '/functions/lib/checkout'); const FAMILY = require(REPO + '/functions/lib/family'); const CAL = require(REPO + '/functions/lib/calendar');
const { fakeStripe } = require(REPO + '/functions/test/fake-stripe'); const { fakeDb } = require(REPO + '/functions/test/fake-db');
const PRICES = []; for (const p of CAT.PROGRAMS) for (const pl of p.plans) PRICES.push({ id: 'price_' + pl.lookup, object: 'price', active: true, lookup_key: pl.lookup, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, unit_amount: pl.monthly * 100, product: p.product });
const PARENT = { email: 'maria.rivera@example.com', name: 'Maria Rivera' };
const RENTER = { email: 'pat.guest@example.com', name: 'Pat Guest' };
const ME = () => (next.who === 'renter' ? RENTER : PARENT);
/* the Courts page's own starting blocks, so the engine and the page read one schedule in the test copy */
const PAGE_BLOCKS = (() => { try { const m = /const SEED_BLOCKS=(\[[\s\S]*?\n\]);/.exec(fs.readFileSync(path.join(REPO, 'backend/index.html'), 'utf8')); return new Function('return ' + m[1])(); } catch (e) { return []; } })();
/* invented players with training hours, so the court plan has sessions to place in the test copy */
const PLAN_KIDS = (() => { const o = {}; const mk = (pre, n, coach, time, prog) => { for (let i = 1; i <= n; i++) o['players/' + pre + i] = { name: 'Player ' + pre.toUpperCase() + i, coach, status: 'active', source: 'demo', createdAt: 5, enroll: { programName: prog, programShort: prog, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], pbp: { time } } }; };
  mk('hb', 12, 'Kim Coach', '07:45 AM-09:45 AM', 'High Performance'); mk('hg', 8, 'Kim Coach', '09:45 AM-11:45 AM', 'High Performance'); mk('af', 7, 'Lee Coach', '04:00 PM-06:00 PM', 'Afterschool'); mk('tu', 10, 'Lee Coach', '04:30 PM-06:00 PM', '10 & Under'); return o; })();
const FAMDB = fakeDb({
  // an invented private, so the client's calendar shows its mark (Nov 19, 2026)
  ...PLAN_KIDS,
  'clients/pat.guest@example.com': { name: 'Pat Guest', phone: '5615550144', people: [], at: 5 },
  'groups/g-demo': { coaches: ['Lee', 'Kim'], directors: ['director@example.test'] },
  'backend/state': { blocks: PAGE_BLOCKS, bookings: [], privates: [{ id: 'pv-demo', pid: 'as-mia-r', date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), start: 15.5, dur: 1, court: 4, coach: 'Lee' }] },
  'players/ft-liam-r': { name: 'Liam Rivera', shortName: 'Liam R.', group: 'ft', coach: 'Kim Coach', status: 'active', source: 'monday', createdAt: 1, enroll: { programName: 'Full Time Program | Fall 2026', programShort: 'Full Time', pbp: { plan: '10 FLEX Sessions | Tennis Only', bySession: true } } },   // by the session: books his own sessions
  'players/ft-liam-r/private/contact': { guardian: 'Maria Rivera', email: PARENT.email, phone: '5615550102', source: 'monday' },
  'players/as-mia-r': { name: 'Mia Rivera', shortName: 'Mia R.', group: 'as', coach: 'Lee Coach', coach2: 'Kim Coach', status: 'active', source: 'coach', createdAt: 2, enroll: { programName: 'Afterschool | Fall 2026', programShort: 'Afterschool', days: ['Tue', 'Thu'], pbp: { plan: '2 Days per week | Monthly', bySession: false } } },   // training days, so the client home has a next session to show
  'players/as-mia-r/private/contact': { guardian: 'Maria Rivera', email: PARENT.email, phone: '5615550102' },
  'staff/lee@example.test': { name: 'Lee Coach', role: 'coach', coachAs: 'Lee', active: true },   // Coach Lee has a sign-in, Coach Kim does not: both ways a client's message can go
  'smsLog/seed-1': { kind: 'reply', at: Date.now() - 26 * 3600e3, phone: '+15615550102', body: 'Hi Coach, Mia loved the serve work this week.', players: ['as-mia-r'], by: 'family', status: 'reply', via: 'app', forCoach: 'lee@example.test', fromEmail: PARENT.email, appConv: 'lee', line: '' },
  'smsLog/seed-2': { at: Date.now() - 25 * 3600e3, by: 'lee@example.test', byName: 'Lee Coach', player: 'as-mia-r', phone: '+15615550102', body: 'Great to hear. We keep building on it Thursday.\n- Coach Lee, ProWorld Academy', status: 'sent', from: 'portal', line: '' }
});
const WHO = {
  parent: { parent: true },
  coach: { name: 'Lee Coach', role: 'coach', coachAs: 'Lee', pages: ['start', 'coach-portal', 'backend'] },
  director: { name: 'Dee Director', role: 'director', pages: ['start', 'coach-portal', 'tryouts', 'backend', 'attendance'] },
  desk: { name: 'Dana Desk', role: 'desk', pages: ['start', 'tryouts', 'backend', 'billing', 'attendance'] },
  marketing: { name: 'Mia Marketing', role: 'marketing', pages: ['start', 'mkt'] },
  owner: { name: 'Olive Owner', role: 'admin', owner: true, pages: [] }
};
const BASE = JSON.parse(JSON.stringify(H.CLIENT_SEED.docs));
// two invented try-outs, so Reminders shows the try-out block and its before/after list (Nov 18, 2026)
Object.assign(BASE, {
  'tryouts/seed-a': { name: 'Mila Testerson', born: 2016, group: 'u10', coach: 'Kim', date: new Date().toISOString().slice(0, 10), time: '16:30', parent: 'Pat Testerson', status: 'planned', outcome: '', checks: { confirmed: true }, createdAt: Date.now() - 3 * 864e5 },
  'tryouts/seed-b': { name: 'Rafa Sampleton', born: 2012, group: 'ft', coach: 'Lee', date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), time: '09:30', parent: 'Sam Sampleton', status: 'planned', outcome: '', checks: {}, createdAt: Date.now() - 864e5 },
});
/* the team's own messaging (/team, Nov 15): the invented team and chats of functions/test/portal/team.harness.js; whoever is signed in stands where its director stands */
const TH = require(REPO + '/functions/test/portal/team.harness.js');
const teamFor = (email) => JSON.parse(JSON.stringify(TH.teamDocs()).split(TH.P.dee).join(email));
let next = { u: '/portal/', who: 'coach', y: 0 };
function seedFor(k) {
  if (k === 'guest') return { user: null, docs: {} };          // nobody signed in: the sign-in screens
  if (k === 'renter') return { user: { uid: 'u-renter', email: RENTER.email, emailVerified: true, displayName: RENTER.name, providerData: [{ providerId: 'password' }] }, docs: {} };   // a profile without a child
  if (k === 'parent') return { user: { uid: 'u-parent', email: PARENT.email, emailVerified: true, displayName: PARENT.name, providerData: [{ providerId: 'google.com' }] }, docs: {} };
  const w = WHO[k] || WHO.coach; const email = k + '@example.test'; const docs = JSON.parse(JSON.stringify(BASE));
  Object.keys(docs).filter((d) => d.startsWith('staff/')).forEach((d) => delete docs[d]);
  docs['staff/' + email] = Object.assign({ email, active: true }, w);
  // an owner has a team to look at the site as ("View as", Nov 16): the other invented people, and the invented family's two players
  if (k === 'owner') { ['coach', 'director', 'desk', 'marketing'].forEach((o) => { docs['staff/' + o + '@example.test'] = Object.assign({ email: o + '@example.test', active: true }, WHO[o]); }); docs['players/ft-liam-r'] = { name: 'Liam Rivera', group: 'ft', coach: 'Kim', status: 'active' }; docs['players/as-mia-r'] = { name: 'Mia Rivera', group: 'as', coach: 'Lee', status: 'active' }; }
  Object.assign(docs, teamFor(email));
  return { user: { uid: 'u-' + k, email, emailVerified: true, displayName: w.name, providerData: [{ providerId: 'password' }] }, docs };
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4173'); let p = decodeURIComponent(url.pathname);
  if (p === '/__set') { next = { u: url.searchParams.get('u') || '/', who: url.searchParams.get('who') || 'coach', y: Number(url.searchParams.get('y') || 0), look: url.searchParams.get('look') || '' }; res.writeHead(200); res.end('ok'); return; }
  if (p === '/__shot') { res.writeHead(302, { location: next.u, 'cache-control': 'no-store' }); res.end(); return; }
  if (p === '/__stub/firebase.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(STUB); return; }
  if (p === '/__stub/empty.js' || p === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(''); return; }
  if (p === '/api/team/people') { const me = (next.who || 'coach') + '@example.test'; const w = WHO[next.who] || WHO.coach; const people = Object.keys(TH.STAFF).map((k) => TH.STAFF[k]).filter((r) => r.email !== TH.P.dee).map((r) => ({ email: r.email, name: r.name, role: r.owner ? 'owner' : r.role })).concat([{ email: me, name: w.name || 'You', role: w.role || 'team' }]); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ people })); return; }
  if (p === '/api/team/here' || p === '/api/team/profile') { let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; } const TM = require(REPO + '/functions/lib/team'); const me = { email: (next.who || 'coach') + '@example.test' };
    try { const out = p.endsWith('profile') ? await TM.setProfile(FAMDB, me, b) : await TM.here(FAMDB, me, b); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: e.message })); } return; }
  if (p.startsWith('/api/team/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  /* the one schedule (Nov 20, 2026): the calendar, hours, days off, staff privates, the court plan and rain run on the real engine */
  if (/^\/api\/coach\/(calendar|calendar\/off|calendar\/hours|timeoff\/(ask|decide|withdraw)|private\/(ack|players|slots|book|cancel)|courts\/plan(\/apply|\/clear|\/auto)?|rain|payroll(\/rates|\/extra|\/extra\/decide|\/mine)?)$/.test(p) && req.method === 'POST') {
    let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
    const SC = require(REPO + '/functions/lib/schedule'); const CC = require(REPO + '/functions/lib/coachcal'); const k = next.who || 'coach'; const w = WHO[k] || WHO.coach;
    const who = { email: k + '@example.test', name: w.name, keys: [w.coachAs, String(w.name).split(' ')[0]].filter(Boolean).map((x) => String(x).toLowerCase()), role: w.role, owner: !!w.owner, admin: !!w.owner || w.role === 'admin', director: !!w.owner || w.role === 'admin' || w.role === 'director' };
    const said = []; const deps = { tellCoach: async (n, t) => said.push(t), tellDesk: async (t) => said.push(t), tellFamily: async (e, m) => said.push(m.subject), tellOwners: async (t) => said.push(t), tellStaff: async (t) => said.push(t) };
    const r = p.slice(11);
    try { const out = r === 'calendar' ? await SC.week(FAMDB, who, b) : r === 'calendar/off' ? await SC.setOff(FAMDB, who, b) : r === 'calendar/hours' ? await SC.setHours(FAMDB, who, b) : r === 'timeoff/ask' ? await SC.askOff(FAMDB, who, b, deps) : r === 'timeoff/decide' ? await SC.decideOff(FAMDB, who, b, deps) : r === 'timeoff/withdraw' ? await SC.withdrawOff(FAMDB, who, b)
        : r === 'private/ack' ? await CC.ack(FAMDB, who, b) : r === 'private/players' ? await SC.coachPlayers(FAMDB, who, b) : r === 'private/slots' ? await SC.coachSlots(FAMDB, who, b) : r === 'private/book' ? await SC.coachBook(FAMDB, who, b, deps) : r === 'private/cancel' ? await SC.coachCancel(FAMDB, who, b, deps)
        : r === 'courts/plan' ? Object.assign(await SC.plan(FAMDB, String(b.date || '')), await SC.planState(FAMDB)) : r === 'courts/plan/apply' ? await SC.applyPlan(FAMDB, who, b) : r === 'courts/plan/clear' ? await SC.clearPlan(FAMDB, who, b) : r === 'courts/plan/auto' ? await SC.planAuto(FAMDB, who, b) : r.startsWith('payroll') ? await (() => { const P = require(REPO + '/functions/lib/payroll'); return r === 'payroll' ? P.report(FAMDB, who, b) : r === 'payroll/rates' ? P.setRate(FAMDB, who, b) : r === 'payroll/extra' ? P.addExtra(FAMDB, who, b, deps) : r === 'payroll/mine' ? P.myExtras(FAMDB, who) : P.decideExtra(FAMDB, who, b); })() : await SC.rain(FAMDB, who, b, deps);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  if (/^\/api\/family\/court\/(slots|book|cancel|list|confirm)$/.test(p) && req.method === 'POST') { let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
    const SC = require(REPO + '/functions/lib/schedule'); const fn = p.split('/').pop(); const fam = { email: ME().email, name: ME().name, member: next.who !== 'renter' };
    const pd = { checkout: async (o) => ({ url: '/family?court=' + encodeURIComponent(o.id), id: 'cs_demo' }), paid: async () => ({ paid: true, intent: 'pi_demo' }), refund: async () => ({ id: 're_demo' }), tellDesk: async () => {}, tellFamily: async () => {} };   // the test copy's card page pays at once
    try { const out = fn === 'slots' ? await SC.rentSlots(FAMDB, fam, b) : fn === 'list' ? await SC.rentList(FAMDB, fam) : fn === 'book' ? await SC.rentBook(FAMDB, fam, b, pd) : fn === 'confirm' ? await SC.rentConfirm(FAMDB, fam, b, pd) : await SC.rentCancel(FAMDB, fam, b, pd);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  if (p.startsWith('/api/coach/')) {
    let raw = ''; for await (const c of req) raw += c; let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = null; }
    const [st, j] = await H.engine(req.method, p, url.searchParams, body); res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); return;
  }
  if (p === '/api/catalog') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Object.assign({ mode: 'test', rules: { version: CAL.RULES.version, bill_day: CAL.RULES.bill_day, late: CAL.RULES.late_policy, terms: CAL.RULES.terms, breaks: CAL.RULES.breaks } }, CAT.publicCatalog()))); return; }
  if (p === '/api/quote') { let raw = ''; for await (const c of req) raw += c; try { const b = JSON.parse(raw || '{}'); const q = CHECKOUT.monthlyQuote(String(b.program || ''), String(b.plan || ''), String(b.start || '')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ lines: q.lines, dueCents: q.dueCents, then: q.then, startLabel: q.startLabel, start: q.start, anchor: q.anchor, next: q.next, program: q.program.name, plan: q.plan.label })); } catch (e) { res.writeHead(e.status || 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'quote', message: e.message })); } return; }
  if (p === '/api/family/code') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }          // the test copy sends no e-mail
  /* the client account's writes run the real engine on the test copy's database: a request, days away and make-up days, a chat */
  if (/^\/api\/family\/(request|days|chat|message|people|account)$/.test(p) && req.method === 'POST') { let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
    try { const { players } = await FAMILY.findPlayers(FAMDB, null, PARENT.email); const fn = p.split('/').pop();
      const out = fn === 'request' ? await FAMILY.request(FAMDB, PARENT, b, players) : fn === 'days' ? await FAMILY.days(FAMDB, PARENT, b, players) : fn === 'people' ? await FAMILY.people(FAMDB, PARENT, b, players) : fn === 'account' ? await FAMILY.account(FAMDB, PARENT, b, players) : fn === 'chat' ? await FAMILY.chat(FAMDB, PARENT, b, players) : await FAMILY.message(FAMDB, PARENT, b, players);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  /* privates from the client's calendar, and the courts they hold: the real engine on the test copy's database */
  if (/^\/api\/family\/private\/(slots|courts|book|cancel)$/.test(p) && req.method === 'POST') { let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
    const CC = require(REPO + '/functions/lib/coachcal'); const fn = p.split('/').pop(); const deps = { tellCoach: async () => {}, tellDesk: async () => {}, tellFamily: async () => {} };
    try { const CLp = require(REPO + '/functions/lib/client'); const players = (await FAMILY.findPlayers(FAMDB, null, ME().email)).players.concat(CLp.people(await CLp.get(FAMDB, ME().email)));
      const out = fn === 'slots' ? await CC.familySlots(FAMDB, ME(), b, players) : fn === 'courts' ? await CC.familyCourts(FAMDB, ME(), b, players) : fn === 'book' ? await CC.familyBook(FAMDB, ME(), b, players, deps) : await CC.familyCancel(FAMDB, ME(), b, players, deps);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  /* Ask ProWorld on the test copy: the real engine, with a stand-in for Claude that answers from a few key words (no key, no cost) */
  if (p === '/api/family/ask' && req.method === 'POST') { let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
    const AS = require(REPO + '/functions/lib/assistant'); const CALp = require(REPO + '/functions/lib/calendar'); const t = CALp.todayET(); const q = String(b.message || '').toLowerCase();
    const nextDow = (n) => { for (let i = 1; i < 9; i++) { const d = CALp.addDays(t, i); if (new Date(d + 'T12:00:00Z').getUTCDay() === n) return d; } return CALp.addDays(t, 2); };
    AS._useModel(async () => JSON.stringify(/private/.test(q) ? { reply: 'Here are the open times with the coach. Pick a time and a court.', action: { type: 'private', kind: /fitness/.test(q) ? 'fitness' : 'tennis', date: /today/.test(q) ? t : nextDow(4), coach: '', part: /afternoon/.test(q) ? 'afternoon' : 'any' } }
      : /not coming|can't come|cannot come/.test(q) ? { reply: 'I can mark that day for you.', action: { type: 'away', date: nextDow(/monday/.test(q) ? 1 : 2) } }
      : /camp/.test(q) ? { reply: 'Thanksgiving Camp runs next week, half days or full days.', action: { type: 'camp', id: 'tgu10' } }
      : /invoice/.test(q) ? { reply: 'I can send that request to Admin for you. They answer by e-mail.', action: { type: 'admin', subject: 'Invoice for November', text: 'Could I get an invoice for November, please?' } }
      : /make-?up/.test(q) ? { reply: 'A missed session can be made up on another day in the same month. It does not carry into the next month.', action: null }
      : { reply: 'Saturday is 9:00 to 10:30 AM. Weekdays are 4:30 to 6:30 PM.', action: null }));
    try { const CLp = require(REPO + '/functions/lib/client'); const players = (await FAMILY.findPlayers(FAMDB, null, ME().email)).players.concat(CLp.people(await CLp.get(FAMDB, ME().email)));
      const out = await AS.ask(FAMDB, ME(), b, players); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  /* billing a family reads by itself (Nov 22, 2026): the real engine with an invented family's payments */
  if (/^\/api\/family\/(billing(\/invoice)?|card\/backup(\/(confirm|remove|swap))?|invoice\/[a-f0-9]{48}\.pdf)$/.test(p)) { let raw = ''; if (req.method === 'POST') for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
    const BL = require(REPO + '/functions/lib/billing'); const U = (iso) => Math.floor(Date.parse(iso + 'T15:00:00Z') / 1000); const L = (rows) => ({ async *[Symbol.asyncIterator]() { for (const r of rows) yield r; } });
    const G = global.__bl || (global.__bl = { backup: '' }); const t = new Date(); const ym = t.toISOString().slice(0, 7); const prev = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); const day = (m, d) => m + '-' + String(Math.min(d, m === ym ? t.getUTCDate() : 28)).padStart(2, '0');
    const inv = (id, date, cents, o) => Object.assign({ id, status: 'paid', created: U(date), amount_paid: cents, invoice_pdf: '' }, o);
    const st = { charges: { list: () => L([{ payment_intent: 'pi_court', status: 'succeeded', amount_refunded: 3000, receipt_url: '' }]) },
      invoices: { list: () => L([inv('in1', day(ym, 1), 189000, { parent: { subscription_details: { subscription: 'sub_1', metadata: { player: 'Liam Rivera', program_name: 'Full Time' } } } }), inv('in2', day(ym, 9), 11000, { description: 'Private lesson, 1 hour', metadata: { kind: 'private', player: 'Liam Rivera' } }), inv('in3', day(ym, 12), 47500, { description: 'Thanksgiving Camp, full days', metadata: { kind: 'camp', player: 'Mia Rivera' } }), inv('in4', day(ym, 20), 11000, { description: 'Private lesson, 1 hour', metadata: { kind: 'private', player: 'Mia Rivera' } }),
        inv('in5', day(prev, 1), 195000, { parent: { subscription_details: { subscription: 'sub_1', metadata: { player: 'Liam Rivera', program_name: 'Full Time' } } } }), inv('in6', day(prev, 14), 11000, { description: 'Private lesson, 1 hour', metadata: { kind: 'private', player: 'Liam Rivera' } })]) },
      checkout: { sessions: { list: () => L([{ id: 'cs_court', mode: 'payment', payment_status: 'paid', created: U(day(ym, 18)), amount_total: 3000, payment_intent: 'pi_court', metadata: { kind: 'court-rental' }, line_items: { data: [{ description: 'Court rental, 1 hour' }] } }]), create: async () => ({ url: '/family?backupcard=cs_setup#billing' }), retrieve: async () => ({ id: 'cs_setup', mode: 'setup', customer: 'cus_1', metadata: { kind: 'backup_card' }, setup_intent: { status: 'succeeded', payment_method: 'pm_back' } }) } },
      customers: { retrieve: async () => ({ id: 'cus_1', invoice_settings: { default_payment_method: G.swapped ? { id: 'pm_back', card: { brand: 'mastercard', last4: '5454', exp_month: 3, exp_year: 2029 } } : { id: 'pm_main', card: { brand: 'visa', last4: '4242', exp_month: 11, exp_year: 2028 } } }, metadata: { backup_pm: G.backup } }), update: async (id, o) => { if (o.metadata && 'backup_pm' in o.metadata) G.backup = o.metadata.backup_pm; if (o.invoice_settings) G.swapped = o.invoice_settings.default_payment_method === 'pm_back'; } },
      paymentMethods: { retrieve: async (id) => id === 'pm_main' ? { id, card: { brand: 'visa', last4: '4242', exp_month: 11, exp_year: 2028 } } : { id, card: { brand: 'mastercard', last4: '5454', exp_month: 3, exp_year: 2029 } }, detach: async () => {} }, subscriptions: { list: () => L([]) } };
    const CUS = [{ id: 'cus_1', name: ME().name }];
    try { const m = /invoice\/([a-f0-9]{48})\.pdf$/.exec(p);
      if (m) { const x = (await FAMDB.doc('familyInvoiceLinks/' + m[1]).get()).data(); const act = await BL.activity(st, CUS, { from: x.from, to: x.to }); const buf = await BL.pdf({ name: x.name, email: x.email, from: x.from, to: x.to, what: x.what, player: x.player, items: BL.pick(act.items, x), today: t.toISOString().slice(0, 10) }); res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(buf); return; }
      const fn = p.split('/').pop();
      const out = p === '/api/family/billing' ? Object.assign(await BL.activity(st, CUS, {}), { cards: await BL.cards(st, CUS), cats: BL.CATS }) : fn === 'invoice' ? await BL.link(FAMDB, { email: ME().email, name: ME().name }, b, t.toISOString().slice(0, 10))
        : fn === 'backup' ? await BL.backupStart(st, CUS, b, '') : fn === 'confirm' ? await BL.backupConfirm(st, CUS, b) : fn === 'remove' ? await BL.backupRemove(st, CUS, b) : await BL.backupSwap(st, CUS, b);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  /* notifications for the parents (Nov 22, 2026): the real engine on the test copy's database, with three already sent so the bell has something */
  if (/^\/api\/(family|admin)\/notices(\/(read|prefs|count|cancel|settings))?$/.test(p)) { let raw = ''; if (req.method === 'POST') for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
    const NT = require(REPO + '/functions/lib/notices'); const own = { email: 'owner@example.test', name: 'Owner', owner: true, texting: true };
    if (!global.__ntSeed) { global.__ntSeed = 1; const now = Date.now(); const to = [PARENT.email];
      FAMDB.doc('familyNotices/s1').set({ title: 'New court lights are in', body: 'Evening privates are open until 8 PM from this week.', kind: 'news', group: '', state: 'sent', sentAt: now - 3 * 864e5, at: now - 3 * 864e5, to, byName: 'Owner', stats: { families: 3, app: 2, phones: 2, text: 0 } });
      FAMDB.doc('familyNotices/s2').set({ title: 'Winter Camp 2026 starts in 10 days', body: 'Dec 21\u201331. Sign up in one minute.', kind: 'camp', group: 'nocamp', camp: 'wi13', url: '/enroll?camp=wi13', state: 'sent', auto: true, sentAt: now - 2 * 36e5, at: now - 2 * 36e5, to, stats: { families: 3, app: 2, phones: 2, text: 0 } });
      FAMDB.doc('familyNotices/s3').set({ title: 'Rain delay', body: 'We are watching the weather. We will tell you 30 minutes before your session if it is on.', kind: 'weather', group: '', state: 'sent', sentAt: now - 4 * 6e4, at: now - 4 * 6e4, to, byName: 'Owner', stats: { families: 3, app: 2, phones: 2, text: 1 } }); }
    try { const fn = p.split('/').pop(); const fam = p.startsWith('/api/family/');
      const out = fam ? (fn === 'read' ? await NT.markRead(FAMDB, ME().email) : fn === 'prefs' ? await NT.setPrefs(FAMDB, ME().email, b) : await NT.forFamily(FAMDB, ME().email))
        : req.method === 'GET' ? await NT.list(FAMDB, own) : fn === 'count' ? await NT.count(FAMDB, b) : fn === 'cancel' ? await NT.cancel(FAMDB, own, b) : fn === 'settings' ? await NT.saveSettings(FAMDB, own, b) : await NT.create(FAMDB, own, b, { textBudgetMs: 0 });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  if (p === '/api/admin/court-holds') { let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; } const out = await require(REPO + '/functions/lib/courts').dayHolds(FAMDB, String(b.date || '')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); return; }
  if (/^\/api\/family\/(profile|person|person\/remove|signup)$/.test(p) && req.method === 'POST') { let raw = ''; for await (const c of req) raw += c; let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; } const CLp = require(REPO + '/functions/lib/client');
    try { const out = p.endsWith('signup') ? await CLp.signup(FAMDB, b, {}) : p.endsWith('profile') ? await CLp.save(FAMDB, ME(), b) : p.endsWith('remove') ? await CLp.removePerson(FAMDB, ME(), b) : await CLp.addPerson(FAMDB, ME(), b); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || 'x', message: e.message })); } return; }
  if (p === '/api/family/me') { try { const vp = String(req.headers['x-view-family'] || ''); const asOwner = vp && next.who === 'owner'; if (asOwner && !FAMDB._docs.get('players/' + vp + '/private/contact')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'noemail', message: 'This player has no parent e-mail on file, so the family has no account to open yet.' })); return; }
    const j = Object.assign(asOwner ? { viewing: true } : {}, await FAMILY.me(FAMDB, fakeStripe({ prices: PRICES }), asOwner || next.who !== 'owner' ? ME() : { email: 'owner@example.test', name: '' }));
    { const CLp = require(REPO + '/functions/lib/client'); const cl = await CLp.get(FAMDB, ME().email); Object.assign(j, { member: (j.players || []).some((x) => x.status !== 'finished'), known: j.known || !!cl, people: CLp.people(cl), profile: cl ? { name: cl.name, phone: cl.phone, photo: cl.photo || '', quiet: cl.quiet === true } : null, name: j.name || (cl && cl.name) || '', courtCents: 2000, ask: true }); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Object.assign({ mode: 'test' }, j))); } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'me', message: e.message })); } return; }
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"route","message":"not in the test copy"}'); return; }
  if (p.endsWith('/')) p += 'index.html'; if (!path.extname(p)) p += '/index.html';
  const f = path.join(REPO, p); if (!f.startsWith(REPO) || !fs.existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  if (path.extname(f) === '.html') {
    let h = fs.readFileSync(f, 'utf8');
    h = h.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"']*firebase-app-compat\.js/g, '/__stub/firebase.js').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"']*\.js/g, '/__stub/empty.js');
    const boot = '<script>window.__seed=' + JSON.stringify(seedFor(next.who)).replace(/</g, '\\u003c') + ';window.__previewY=' + next.y + ';try{localStorage.' + (/dark/.test(next.look) ? 'setItem("pw-theme","dark")' : /light/.test(next.look) ? 'setItem("pw-theme","light")' : 'removeItem("pw-theme")') + '}catch(e){}' +
      'addEventListener("load",function(){setTimeout(function(){if(window.__previewY){window.scrollTo(0,window.__previewY);}},2500);});</script>';
    h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + boot) : boot + h;
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }); res.end(h); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
}).listen(4173, () => console.log('test copy on http://localhost:4173'));
