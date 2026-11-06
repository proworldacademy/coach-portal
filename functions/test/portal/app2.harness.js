/* Headless checks of App 2, the phone-first look (Nov 5, 2026): the daily four — Players, a group, the player, Contact, Messages and
   the chat — on a phone (390) and on a computer (1280), on the same fake engine and stand-in Firebase as chats.harness.js.
   Run by hand (needs a Chrome):
     REPO=/path/to/coach-portal SHOTS=/tmp/shots NODE_PATH=/opt/npm-tools/node_modules node functions/test/portal/app2.harness.js
   Invented families and staff only. */
'use strict';
const H = require('./chats.harness');
const { server, page, shot, text, count, log, chromium, CLIENT_SEED, net, reply } = H;
const WK = (() => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
const DOW = new Date().getDay(); const ISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
// this week: Cy's family heard from the coach on Tuesday; the backend's shared record holds today's sessions and one private
CLIENT_SEED.docs['contacts/ft-cy-l_' + WK] = { playerId: 'ft-cy-l', playerName: 'Cy Lane', group: 'ft', coach: 'Kim', week: WK, done: true, by: 'Kim Example', at: Date.now() - 864e5, source: 'portal', how: 'text' };
CLIENT_SEED.docs['backend/state'] = { blocks: [{ id: 'b1', label: 'Full Time', courts: ['9', '10'], dows: [DOW], start: 8, end: 9.5 }, { id: 'b3', label: 'Afterschool', courts: ['1', '2', '3'], dows: [DOW], start: 16, end: 19 }, { id: 'b6', label: 'HotelPlanner Open', courts: ['1'], dows: [DOW], start: 8, end: 17, event: true }],
  privates: [{ id: 'PV-1', pid: 'ft-bo-k', coach: 'Kim', date: ISO, start: 1230, dur: 60, court: '7' }] };

const app2 = async (browser, w, h) => { const pg = await page(browser, w, h); await pg.addInitScript(() => { try { localStorage.setItem('cp-view', 'app2'); } catch (e) { /* noop */ } }); return pg; };
const overflow = (pg) => pg.evaluate(() => { const w = document.documentElement.clientWidth; return Array.from(document.querySelectorAll('main *')).filter((el) => !el.closest('.ctabs')).filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > w + 1; }).map((el) => el.className + ':' + Math.round(el.getBoundingClientRect().right)).slice(0, 5); });

if (require.main === module) (async () => {
  await new Promise((r) => server.listen(4173, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    /* ── the phone ── */
    const m = await app2(browser, 390, 844);
    await m.goto('http://localhost:4173/portal/#/'); try { await m.waitForSelector('.a2 .a2card', { timeout: 15000 }); } catch (e) { console.log('MAIN:', (await text(m, 'main')).slice(0, 600)); throw e; }
    await m.waitForTimeout(700);
    log(await count(m, 'body.app2.a2-screen') === 1, 'phone: App 2 is on');
    log(/Players\./i.test(await text(m, '.a2lt')), 'home: the title is Players.');
    const needs = await text(m, '.a2card');
    log(/Chats with new replies|Chat with a new reply/.test(needs) && /Families to reach this week/.test(needs), 'home: Needs you — the replies, the families to reach');
    log(/Today/i.test(await text(m, 'main')) && /Full Time/i.test(await text(m, 'main')) && /Private · Bo Kessler/.test(await text(m, 'main')) && !/HotelPlanner/.test(await text(m, 'main')), 'home: Today — the sessions of the groups and the private, not the event');
    log(await count(m, '.cp-appbar button') === 4 && await count(m, '.cp-appbar em.n') === 0 || await m.evaluate(() => Array.from(document.querySelectorAll('.cp-appbar em.n')).every((e) => getComputedStyle(e).display === 'none')), 'phone: the bar has four places and no count bubbles');
    log(await m.evaluate(() => { const g = document.querySelector('.a2glow'); return !!g && getComputedStyle(g).display !== 'none'; }), 'phone: the glow is there');
    log(!(await overflow(m)).length, 'home: nothing wider than the phone ' + JSON.stringify(await overflow(m)));
    await shot(m, 'app2-phone-home');
    // a group
    await m.locator('.a2row[data-go*="group"]', { hasText: 'Full Time' }).first().click(); await m.waitForTimeout(300);
    log(/Full Time\./i.test(await text(m, '.a2lt')), 'group: the title');
    log(await count(m, '.a2seg button') === 3, 'group: All · Report · To reach');
    log(await count(m, '.a2row .a2chip') >= 2, 'group: one status word per player');
    await m.locator('.a2seg button', { hasText: 'To reach' }).click(); await m.waitForTimeout(200);
    log(!(await m.locator('.a2row', { hasText: 'Cy Lane' }).count()), 'group: To reach leaves out the family already in touch');
    await shot(m, 'app2-phone-group');
    await m.locator('.a2seg button', { hasText: 'All' }).click(); await m.waitForTimeout(200);
    // the player
    await m.locator('.a2row', { hasText: 'Bo Kessler' }).first().click(); await m.waitForTimeout(400);
    log(/Bo Kessler/i.test(await text(m, '.a2lt.s')), 'player: the name');
    log(await count(m, '.a2qa > *') === 3 && /Text/.test(await text(m, '.a2qa')) && /Call/.test(await text(m, '.a2qa')) && /Report/.test(await text(m, '.a2qa')), 'player: Text · Call · Report');
    log(await m.locator('.a2qa a[href^="https://app.justcall.io/dialer?numbers=%2B1"]').count() === 1 && await count(m, 'a[href^="tel:"]') === 0, 'player: Call opens the JustCall dialer with the number, never tel:');
    log(/Not in touch yet this week/.test(await text(m, 'main')) && /Mother · Pat/.test(await text(m, 'main')) && /Father · Lou/.test(await text(m, 'main')), 'player: the week and the family');
    log(!(await overflow(m)).length, 'player: nothing wider than the phone ' + JSON.stringify(await overflow(m)));
    await shot(m, 'app2-phone-player');
    // tick the week from the player
    await m.locator('.a2tick').first().click(); await m.waitForTimeout(400);
    log(/In touch this week/.test(await text(m, 'main')), 'player: the tick works');
    await m.locator('.a2tick').first().click(); await m.waitForTimeout(400);
    // Contact
    await m.locator('.cp-appbar button', { hasText: 'Contact' }).click(); await m.waitForTimeout(400);
    log(/Contact\./i.test(await text(m, '.a2lt')) && /of \d+ in touch/.test(await text(m, '.a2big')), 'contact: the ring');
    const reach = await m.locator('.a2row.a2c').count();
    log(reach >= 40 && !(await m.locator('.a2row.a2c', { hasText: 'Cy Lane' }).count()), 'contact: every family to reach, Cy not among them');
    await shot(m, 'app2-phone-contact');
    await m.locator('.a2row.a2c', { hasText: 'Di Moreau' }).locator('.a2tick').click(); await m.waitForTimeout(400);
    log(!(await m.locator('.a2row.a2c', { hasText: 'Di Moreau' }).count()), 'contact: a tick moves the family to Done');
    await m.locator('.a2seg button', { hasText: 'Done' }).click(); await m.waitForTimeout(200);
    log((await m.locator('.a2row.a2c', { hasText: 'Di Moreau' }).count()) === 1 && (await m.locator('.a2row.a2c', { hasText: 'Cy Lane' }).count()) === 1, 'contact: Done holds Cy and Di');
    // Messages
    await m.locator('.cp-appbar button', { hasText: 'Messages' }).click(); await m.waitForTimeout(600);
    log(/Messages\./i.test(await text(m, '.a2lt')), 'messages: the title');
    log(await count(m, '.a2m') >= 45 && await count(m, '.a2m.new') >= 2, 'messages: every family, two with a new reply on top');
    log(await count(m, '.a2chat') === 0, 'messages: the list only, on the phone');
    await m.fill('#mfind', 'fay'); await m.waitForTimeout(250);
    log(await m.locator('.a2m:visible').count() === 1, 'messages: the find box');
    await shot(m, 'app2-phone-messages');
    await m.locator('.a2m').first().click(); await m.waitForTimeout(600);
    log(await count(m, 'body.a2-chat') === 1 && await m.evaluate(() => getComputedStyle(document.querySelector('.cp-appbar')).display === 'none'), 'chat: full screen, the bar steps aside');
    log(/Fay Rowe/.test(await text(m, '.a2who')) && await count(m, '.a2chat .cchip') >= 2, 'chat: the name and the chips');
    log(await count(m, '.a2chat .bub') >= 2, 'chat: the bubbles');
    log(!(await overflow(m)).length, 'chat: nothing wider than the phone ' + JSON.stringify(await overflow(m)));
    await shot(m, 'app2-phone-chat');
    const before = net.length;
    await m.fill('.a2chat textarea', 'See you Saturday at 9!'); await m.click('.a2chat button[type="submit"]'); await m.waitForTimeout(700);
    log(net.filter((c) => /texts\/new/.test(c.url)).length - before === 2, 'chat: a text to the parents together goes out as two texts');
    log(/See you Saturday at 9!/.test(await text(m, '.a2chat .bubs')), 'chat: the new bubble');
    await reply('u10-fay-r', '+15615550120', 'Perfect, thank you!'); await m.locator('[data-act="msg-refresh"]').first().click().catch(() => {}); await m.waitForTimeout(600);
    await m.locator('.a2bk').first().click(); await m.waitForTimeout(500);
    log(await count(m, 'body.a2-chat') === 0 && /Messages\./i.test(await text(m, '.a2lt')), 'chat: back to the list');
    // the other looks still open
    await m.context().close();
    const m0 = await page(browser, 390, 844); await m0.goto('http://localhost:4173/portal/#/'); await m0.waitForSelector('.groups .group', { timeout: 15000 });
    log(await count(m0, 'body.app2') === 0 && await count(m0, '.a2') === 0, 'the App look is untouched');
    await m0.context().close();

    /* ── the computer ── */
    const d = await app2(browser, 1280, 900);
    await d.goto('http://localhost:4173/portal/#/'); await d.waitForSelector('.a2 .a2card', { timeout: 15000 }); await d.waitForTimeout(600);
    log(await d.evaluate(() => getComputedStyle(document.querySelector('#vtabs')).display !== 'none' && getComputedStyle(document.querySelector('.cp-appbar')).display === 'none'), 'computer: the tab row, no bottom bar');
    log(await d.evaluate(() => Array.from(document.querySelectorAll('.cp-switch button')).map((b) => b.textContent).join('·')) === 'App 2·App·In between', 'computer: the switch says App 2 · App · In between');
    await shot(d, 'app2-desk-home');
    await d.goto('http://localhost:4173/portal/#/messages'); await d.waitForSelector('.a2chat', { timeout: 15000 }); await d.waitForTimeout(600);
    log(await count(d, '.a2mbox.open') === 1 && await count(d, '.a2list .a2m') >= 45 && await count(d, '.a2chat .bub') >= 1, 'computer: the list and the open chat side by side');
    await shot(d, 'app2-desk-messages');
    await d.goto('http://localhost:4173/portal/#/contact'); await d.waitForSelector('.a2big', { timeout: 15000 }); await d.waitForTimeout(300);
    await shot(d, 'app2-desk-contact');
    await d.goto('http://localhost:4173/portal/#/p/ft-bo-k'); await d.waitForSelector('.a2qa', { timeout: 15000 }); await d.waitForTimeout(300);
    await shot(d, 'app2-desk-player');
    await d.context().close();
  } finally { await browser.close(); server.close(); }
  const fails = H.fails();
  console.log(fails ? `\n${fails} FAILED` : '\nall green'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
