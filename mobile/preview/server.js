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
const FAMDB = fakeDb({
  'players/ft-liam-r': { name: 'Liam Rivera', shortName: 'Liam R.', group: 'ft', coach: 'Kim Coach', status: 'active', source: 'monday', createdAt: 1 },
  'players/ft-liam-r/private/contact': { guardian: 'Maria Rivera', email: PARENT.email, phone: '5615550102', source: 'monday' },
  'players/as-mia-r': { name: 'Mia Rivera', shortName: 'Mia R.', group: 'as', coach: 'Lee Coach', status: 'active', source: 'coach', createdAt: 2 },
  'players/as-mia-r/private/contact': { guardian: 'Maria Rivera', email: PARENT.email, phone: '5615550102' }
});
const WHO = {
  parent: { parent: true },
  coach: { name: 'Lee Coach', role: 'coach', coachAs: 'Lee', pages: ['start', 'coach-portal', 'backend'] },
  director: { name: 'Dee Director', role: 'director', pages: ['start', 'coach-portal', 'tryouts', 'backend', 'attendance'] },
  desk: { name: 'Dana Desk', role: 'desk', pages: ['start', 'tryouts', 'backend', 'billing', 'attendance'] },
  owner: { name: 'Olive Owner', role: 'admin', owner: true, pages: [] }
};
const BASE = JSON.parse(JSON.stringify(H.CLIENT_SEED.docs));
let next = { u: '/portal/', who: 'coach', y: 0 };
function seedFor(k) {
  if (k === 'parent') return { user: { uid: 'u-parent', email: PARENT.email, emailVerified: true, displayName: PARENT.name, providerData: [{ providerId: 'google.com' }] }, docs: {} };
  const w = WHO[k] || WHO.coach; const email = k + '@example.test'; const docs = JSON.parse(JSON.stringify(BASE));
  Object.keys(docs).filter((d) => d.startsWith('staff/')).forEach((d) => delete docs[d]);
  docs['staff/' + email] = Object.assign({ email, active: true }, w);
  return { user: { uid: 'u-' + k, email, emailVerified: true, displayName: w.name, providerData: [{ providerId: 'password' }] }, docs };
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4173'); let p = decodeURIComponent(url.pathname);
  if (p === '/__set') { next = { u: url.searchParams.get('u') || '/', who: url.searchParams.get('who') || 'coach', y: Number(url.searchParams.get('y') || 0) }; res.writeHead(200); res.end('ok'); return; }
  if (p === '/__shot') { res.writeHead(302, { location: next.u, 'cache-control': 'no-store' }); res.end(); return; }
  if (p === '/__stub/firebase.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(STUB); return; }
  if (p === '/__stub/empty.js' || p === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(''); return; }
  if (p.startsWith('/api/coach/')) {
    let raw = ''; for await (const c of req) raw += c; let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = null; }
    const [st, j] = await H.engine(req.method, p, url.searchParams, body); res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); return;
  }
  if (p === '/api/catalog') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Object.assign({ mode: 'test', rules: { version: CAL.RULES.version, bill_day: CAL.RULES.bill_day, late: CAL.RULES.late_policy, terms: CAL.RULES.terms, breaks: CAL.RULES.breaks } }, CAT.publicCatalog()))); return; }
  if (p === '/api/quote') { let raw = ''; for await (const c of req) raw += c; try { const b = JSON.parse(raw || '{}'); const q = CHECKOUT.monthlyQuote(String(b.program || ''), String(b.plan || ''), String(b.start || '')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ lines: q.lines, dueCents: q.dueCents, then: q.then, startLabel: q.startLabel, start: q.start, anchor: q.anchor, next: q.next, program: q.program.name, plan: q.plan.label })); } catch (e) { res.writeHead(e.status || 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'quote', message: e.message })); } return; }
  if (p === '/api/family/me') { try { const j = await FAMILY.me(FAMDB, fakeStripe({ prices: PRICES }), PARENT); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Object.assign({ mode: 'test' }, j))); } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'me', message: e.message })); } return; }
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"route","message":"not in the test copy"}'); return; }
  if (p.endsWith('/')) p += 'index.html'; if (!path.extname(p)) p += '/index.html';
  const f = path.join(REPO, p); if (!f.startsWith(REPO) || !fs.existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  if (path.extname(f) === '.html') {
    let h = fs.readFileSync(f, 'utf8');
    h = h.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"']*firebase-app-compat\.js/g, '/__stub/firebase.js').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"']*\.js/g, '/__stub/empty.js');
    const boot = '<script>window.__seed=' + JSON.stringify(seedFor(next.who)).replace(/</g, '\\u003c') + ';window.__previewY=' + next.y + ';' +
      'addEventListener("load",function(){setTimeout(function(){if(window.__previewY){window.scrollTo(0,window.__previewY);}},2500);});</script>';
    h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + boot) : boot + h;
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }); res.end(h); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
}).listen(4173, () => console.log('test copy on http://localhost:4173'));
