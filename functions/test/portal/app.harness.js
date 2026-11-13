/* Headless checks of the App look, the final one (Nov 13, 2026): what it took from App 2 — on a player's page the three buttons
   (Text · Call · Report), the family card (a line per number, the phone calls through JustCall, Add a number, Parent info) and the
   ··· to edit; Call in the chat header; no App 2 in the switch — on a phone (390) and on a computer (1280). Same fake engine and
   stand-in Firebase as chats.harness.js. Run by hand (needs a Chrome):
     REPO=/path/to/coach-portal SHOTS=/tmp/shots NODE_PATH=/opt/npm-tools/node_modules node functions/test/portal/app.harness.js
   Invented families and staff only. */
'use strict';
const H = require('./chats.harness');
const { server, page, shot, text, count, log, chromium } = H;
const overflow = (pg) => pg.evaluate(() => { const w = document.documentElement.clientWidth; return Array.from(document.querySelectorAll('main *')).filter((el) => !el.closest('.ctabs')).filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > w + 1; }).map((el) => el.className + ':' + Math.round(el.getBoundingClientRect().right)).slice(0, 5); });

if (require.main === module) (async () => {
  await new Promise((r) => server.listen(4173, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    for (const [w, h, n] of [[390, 844, 'phone'], [1280, 900, 'computer']]) {
      const m = await page(browser, w, h); await m.addInitScript(() => { try { if (!sessionStorage.getItem('t')) { localStorage.setItem('cp-view', 'app2'); sessionStorage.setItem('t', '1'); } } catch (e) { /* noop */ } });
      await m.goto('http://localhost:4173/portal/#/p/ft-bo-k'); await m.waitForSelector('.a2k-p .a2card', { timeout: 15000 }); await m.waitForTimeout(900);
      log(await count(m, 'body.app-skin.a2k') === 1 && await count(m, 'body.app2') === 0 && await m.evaluate(() => localStorage.getItem('cp-view')) === 'app', n + ': someone left on App 2 lands on App');
      log(await count(m, '.a2qa > *') === 3 && /Text/.test(await text(m, '.a2qa')) && /Call/.test(await text(m, '.a2qa')) && /Report/.test(await text(m, '.a2qa')), n + ' player: Text · Call · Report');
      log(await m.locator('.a2qa a[href^="https://app.justcall.io/dialer?numbers=%2B1"]').count() === 1 && await count(m, 'a[href^="tel:"]') === 0, n + ' player: Call opens the JustCall dialer, never tel:');
      const fam = await text(m, '.a2k-p .a2card');
      log(/Mother · Pat/.test(fam) && /Father · Lou/.test(fam) && /The player/.test(fam) && /0100/.test(fam) && !/555-0100/.test(fam), n + ' player: the family, a line per number, the middle hidden');
      log(await m.locator('.a2row.a2f a.a2ckr[href*="justcall.io/dialer"]').count() === 3, n + ' player: every number has its own Call');
      log(await count(m, '#ckcard') === 0, n + ' player: the contact check is folded away');
      await m.locator('[data-act="a2numbers"]').click(); await m.waitForTimeout(300);
      log(await count(m, '#ckcard .ckrow') === 4, n + ' player: Add or change a number opens the four slots');
      await m.locator('#ckcard [data-act="slot-open"][data-slot="guardian"]').click(); await m.waitForTimeout(200);
      await m.fill('#ckcard .ckform input[name="phone"]', '5615550177'); await m.fill('#ckcard .ckform input[name="name"]', 'Aunt Example'); await m.click('#ckcard .ckform button[type="submit"]'); await m.waitForTimeout(600);
      log(/Guardian · Aunt/.test(await text(m, '.a2k-p .a2card')) && await m.locator('.a2row.a2f').count() === 4, n + ' player: a new number shows as a family line right away');
      await m.locator('[data-act="a2numbers"]').click(); await m.waitForTimeout(200);
      await m.locator('.a2fam[data-tail="0109"]').click(); await m.waitForTimeout(700);
      log(await m.locator('#msgcard .cchip[aria-pressed="true"]', { hasText: 'Father' }).count() === 1, n + ' player: tapping the father opens his chat');
      await m.locator('.a2cb[data-act="toggle-edit"]').click(); await m.waitForTimeout(300);
      log(await count(m, 'form[data-form="edit-player"]') === 1, n + ' player: ··· opens Edit player');
      await m.locator('form[data-form="edit-player"] [data-act="toggle-edit"]').click(); await m.waitForTimeout(200);
      await m.locator('[data-act="parent-info"]').click(); await m.waitForTimeout(500);
      log(await count(m, '#parentbox') === 1, n + ' player: Parent info opens under the family');
      log(!(await overflow(m)).length, n + ' player: nothing wider than the screen ' + JSON.stringify(await overflow(m)));
      await shot(m, 'app-' + n + '-player');
      // the chat header
      await m.goto('http://localhost:4173/portal/#/messages/ft-bo-k'); await m.waitForSelector('#mpane .mhead .ppage', { timeout: 15000 }); await m.waitForTimeout(500);
      log(await m.locator('#mpane .mhead a.call[href*="justcall.io/dialer?numbers=%2B1561555"]').count() === 1, n + ' chat: Call in the header, through JustCall');
      log(!(await overflow(m)).length, n + ' chat: nothing wider than the screen ' + JSON.stringify(await overflow(m)));
      await shot(m, 'app-' + n + '-chat');
      await m.goto('http://localhost:4173/portal/#/'); await m.waitForSelector('.groups .group', { timeout: 15000 }); await m.waitForTimeout(500);
      if (n === 'computer') log(await m.evaluate(() => Array.from(document.querySelectorAll('.cp-switch button')).map((b) => b.textContent).join('·')) === 'App·In between', 'computer: the switch says App · In between');
      log(!(await overflow(m)).length, n + ' home: nothing wider than the screen ' + JSON.stringify(await overflow(m)));
      await shot(m, 'app-' + n + '-home');
      await m.context().close();
    }
  } finally { await browser.close(); server.close(); }
  const fails = H.fails();
  console.log(fails ? `\n${fails} FAILED` : '\nall green'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
