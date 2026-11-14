/* Who sees what (Nov 13, 2026): signs in as a coach, a coach without Admin, a director, the front desk, marketing and an owner, opens every
   page of the site on a phone (390) and writes down what the page shows — the doors in the menu, the Dashboard's cards, a refusal.
   Stand-in Firebase, invented people. Run by hand (needs a Chrome):
     REPO=/path/to/coach-portal SHOTS=/tmp/shots NODE_PATH=/opt/npm-tools/node_modules node functions/test/portal/access.harness.js */
'use strict';
const H = require('./chats.harness');
const { server, page, shot, log, chromium, CLIENT_SEED } = H;
const WHO = {
  coach: { name: 'Cory Coach', role: 'coach', pages: ['start', 'coach-portal', 'tryouts', 'backend'] },
  coachNoAdmin: { name: 'Nia Coach', role: 'coach', pages: ['start', 'coach-portal', 'tryouts'] },
  director: { name: 'Dee Director', role: 'director', pages: ['start', 'coach-portal', 'tryouts', 'backend', 'attendance'] },
  desk: { name: 'Dana Desk', role: 'desk', pages: ['start', 'tryouts', 'desk-live', 'ai-check', 'backend', 'billing', 'attendance', 'leads', 'inbox-brief'] },
  marketing: { name: 'Mia Marketing', role: 'marketing', pages: ['start', 'mkt'] },
  owner: { name: 'Olive Owner', role: 'admin', owner: true, pages: [] }
};
const PAGES = ['/', '/portal/', '/backend/', '/clients/', '/marketing/', '/checks/', '/start/', '/p/?id=alo'];
const base = JSON.parse(JSON.stringify(CLIENT_SEED.docs));
const only = process.env.WHO ? process.env.WHO.split(',') : Object.keys(WHO);
const width = Number(process.env.W || 390);
if (require.main === module) (async () => {
  await new Promise((r) => server.listen(4173, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const out = {};
  try {
    for (const k of only) {
      const w = WHO[k]; const email = k.toLowerCase() + '@example.test';
      Object.keys(CLIENT_SEED.docs).forEach((d) => delete CLIENT_SEED.docs[d]); Object.assign(CLIENT_SEED.docs, JSON.parse(JSON.stringify(base)));
      delete CLIENT_SEED.docs['staff/dee@example.test'];
      CLIENT_SEED.docs['staff/' + email] = Object.assign({ email, active: true }, w);
      CLIENT_SEED.user = { uid: 'u-' + k, email, emailVerified: true, displayName: w.name, providerData: [{ providerId: 'password' }] };
      out[k] = {};
      for (const p of PAGES) {
        const m = await page(browser, width, width < 500 ? 844 : 900); m.removeAllListeners('console'); m.removeAllListeners('pageerror');
        const errs = []; m.on('pageerror', (e) => errs.push(e.message));
        await m.goto('http://localhost:4173' + p); await m.waitForTimeout(1800);
        const r = await m.evaluate(() => {
          const t = (s) => Array.from(document.querySelectorAll(s)).filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
          const gate = document.querySelector('.pw-gate, #pw-gate, .pwgate'); const body = document.body.innerText.replace(/\s+/g, ' ');
          const w = document.documentElement.clientWidth;
          const wide = Array.from(document.querySelectorAll('body *')).filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width && r.right > w + 2 && cs.position !== 'fixed' && !el.closest('[style*="overflow"],.scroll,.ctabs,.tabs,table,.pwd-drawer,.pwd-menu,nav'); }).map((el) => (el.tagName + '.' + String(el.className).slice(0, 30) + ':' + Math.round(el.getBoundingClientRect().right))).slice(0, 4);
          return { refused: /NOT YOURS YET/i.test(body) ? 'refused' : '', title: document.title, doors: t('.pwd-doors a, .pwd-doors button, .pwd-nav a, .pwd-drawer a').slice(0, 40), tiles: t('.tile h3, .tile .t, .lib h3, .need .t, .sec > h2, .sec > header h2').slice(0, 60), tabs: t('#modes button, #modes a, .cp-appbar button, .ctabs a, .ctabs button').slice(0, 30), sx: document.documentElement.scrollWidth - w, wide, body: body.slice(0, 220) };
        });
        r.errs = errs.slice(0, 3); out[k][p] = r;
        await shot(m, 'acc-' + width + '-' + k + '-' + (p.replace(/[^a-z]/g, '') || 'home'));
        await m.context().close();
      }
    }
    for (const k of Object.keys(out)) { console.log('== ' + k); for (const p of Object.keys(out[k])) { const r = out[k][p]; console.log('  ' + p.padEnd(12) + (r.refused ? 'REFUSED' : 'opens  ') + ' · ' + r.title.slice(0, 34).padEnd(34) + (r.sx > 2 ? ' · SIDEWAYS ' + r.sx + ' ' + r.wide.join(' ') : '') + (r.errs.length ? ' · ERR ' + r.errs.join(' | ') : '')); if (process.env.V) console.log('      doors: ' + r.doors.join(' · ') + '\n      tabs: ' + r.tabs.join(' · ') + '\n      tiles: ' + r.tiles.join(' · ')); } }
  } finally { await browser.close(); server.close(); }
})();
