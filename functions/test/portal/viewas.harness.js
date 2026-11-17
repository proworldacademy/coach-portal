/* "View as" (Nov 16, 2026): an owner looks at the site as marketing, as a coach, as a client; a coach who plants the same key stays a coach.
   Runs against the test copy (mobile/preview/server.js on :4173), phone and desktop. By hand (needs a Chrome):
     REPO=$PWD node mobile/preview/server.js &   NODE_PATH=/opt/npm-tools/node_modules SHOTS=/tmp/va node functions/test/portal/viewas.harness.js */
const { chromium } = require('playwright');
const B = 'http://localhost:4173'; const OUT = process.env.SHOTS || '/tmp/viewas'; require('fs').mkdirSync(OUT, { recursive: true });
const set = async (who) => { await (await fetch(B + '/__set?u=/&who=' + who)).text(); };
let fails = 0; const log = (ok, m) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + m); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const W of [390, 1280]) {
    const cx = await browser.newContext({ viewport: { width: W, height: W < 500 ? 844 : 900 }, deviceScaleFactor: 2, hasTouch: W < 500, isMobile: W < 500 });
    const pg = await cx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    const shot = (n) => pg.screenshot({ path: `${OUT}/${W}-${n}.png` });
    const body = async () => (await pg.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    // a coach has no button
    await set('coach'); await pg.goto(B + '/'); await pg.waitForTimeout(1500);
    log(await pg.locator('[data-view-as]').count() === 0, W + ' a coach has no View as button');
    await pg.evaluate(() => localStorage.setItem('pw-view-as', JSON.stringify({ kind: 'staff', email: 'owner@example.test', name: 'X', until: Date.now() + 9e6 })));
    await pg.goto(B + '/'); await pg.waitForTimeout(1500);
    const c1 = await pg.evaluate(() => ({ owner: window.PWAuth.ctx && window.PWAuth.ctx.owner, real: !!(window.PWAuth.ctx && window.PWAuth.ctx.real), name: window.PWAuth.ctx && window.PWAuth.ctx.name }));
    log(!c1.owner && !c1.real && /Lee/.test(c1.name), W + ' a coach who plants the key stays a coach: ' + JSON.stringify(c1));
    await pg.evaluate(() => localStorage.removeItem('pw-view-as'));
    // the owner
    await set('owner'); await pg.goto(B + '/'); if (W===390) await pg.evaluate(() => localStorage.setItem('pw-theme','dark')); await pg.goto(B + '/'); await pg.waitForTimeout(1800);
    if (W < 500) { await pg.locator('.pwd-burger').click(); await pg.waitForTimeout(300); await shot('menu'); await pg.locator('.pwd-menu [data-view-as]').click(); }
    else await pg.locator('#pwd-top [data-view-as]').click();
    await pg.waitForTimeout(700); await shot('picker');
    const rows = await pg.locator('#pw-view .r').allInnerTexts(); log(rows.length === 4 && rows.some((r) => /Mia Marketing/.test(r)), W + ' the picker lists the team: ' + rows.join(' | ').replace(/\n/g, ' '));
    // as marketing
    await pg.locator('#pw-view .r', { hasText: 'Mia Marketing' }).click(); await pg.waitForTimeout(2200); await shot('as-marketing');
    let c = await pg.evaluate(() => ({ owner: window.PWAuth.ctx.owner, real: window.PWAuth.ctx.real && window.PWAuth.ctx.real.email, name: window.PWAuth.ctx.name, mkt: window.PWAuth.ctx.has('mkt'), portal: window.PWAuth.ctx.has('coach-portal'), email: window.PWAuth.ctx.email, path: location.pathname }));
    log(!c.owner && c.real === 'owner@example.test' && c.name === 'Mia Marketing' && c.mkt && !c.portal && c.email === 'owner@example.test', W + ' as marketing: ' + JSON.stringify(c));
    log(/Viewing as Mia Marketing/.test(await pg.locator('#pw-viewing').innerText()), W + ' the pill says whose view it is');
    await pg.goto(B + '/backend'); await pg.waitForTimeout(1500); log(/NOT YOURS YET/i.test(await body()), W + ' as marketing, Admin is refused'); await shot('as-marketing-admin');
    log(await pg.locator('#pw-viewing').isVisible(), W + ' the pill stays on the refusal');
    await pg.goto(B + '/marketing'); await pg.waitForTimeout(1800); await shot('as-marketing-mkt');
    // change to the coach
    await pg.locator('#pw-viewing [data-view-as]').click(); await pg.waitForTimeout(600); await pg.locator('#pw-view .r', { hasText: 'Lee Coach' }).click(); await pg.waitForTimeout(2500);
    await pg.goto(B + '/portal/'); await pg.waitForTimeout(2500); await shot('as-coach-portal');
    const w = await pg.evaluate(() => ({ t: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400), real: !!(window.PWAuth.ctx && window.PWAuth.ctx.real), owner: window.PWAuth.ctx && window.PWAuth.ctx.owner }));
    log(w.real && !w.owner && /Lee/i.test(w.t), W + ' as the coach, the Coach Portal greets the coach: ' + w.t.slice(0, 120));
    await pg.goto(B + '/portal/#/players'); await pg.waitForTimeout(1500); await shot('as-coach-players');
    log(/Your players/i.test(await body()), W + ' as the coach, Players is "Your players"');
    await pg.goto(B + '/team'); await pg.waitForTimeout(1800); const me = await pg.evaluate(() => window.PWAuth.ctx.email); log(me === 'owner@example.test', W + ' the Locker Room stays the owner\'s own'); await shot('as-coach-team');
    // a client
    await pg.locator('#pw-viewing [data-view-as]').click(); await pg.waitForTimeout(600); await pg.locator('#pw-view [data-q]').fill('riv'); await pg.waitForTimeout(700); await shot('picker-client');
    await pg.locator('#pw-view .r', { hasText: 'Liam Rivera' }).click(); await pg.waitForTimeout(3000); await shot('as-client');
    const f = await body(); log(/family/.test(pg.url()) && /Liam/.test(f) && /Mia/.test(f), W + ' as a client: the family account with both players · ' + pg.url());
    log((await pg.locator('#signout').count()) === 0, W + ' no Sign out in the client view');
    await pg.goto(B + '/'); await pg.waitForTimeout(1500); log(/family/.test(pg.url()), W + ' a client\'s view stays on the client account');
    // back
    await pg.locator('#pw-viewing [data-view-back]').click(); await pg.waitForTimeout(2200);
    c = await pg.evaluate(() => ({ owner: window.PWAuth.ctx.owner, key: localStorage.getItem('pw-view-as'), path: location.pathname, pill: !!document.getElementById('pw-viewing') }));
    log(c.owner && !c.key && c.path === '/' && !c.pill, W + ' back to me: ' + JSON.stringify(c)); await shot('back');
    if (errs.length) console.log('     (page errors of the stand-in: ' + errs.slice(0, 2).join(' | ') + ')');
    await cx.close();
  }
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'all good'); process.exit(fails ? 1 : 0);
})();
