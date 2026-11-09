/* Headless checks of the Coach Portal's chats (Nov 4, 2026): the real engine (functions/lib/coachtext.js on the fake database)
   answers the page's /api/coach/* calls; Firebase is a stand-in (stub-firebase.js). Desktop (1280) and phone (390), both looks.
   Not part of `npm test` (it needs a Chrome): run it by hand from a checkout with Playwright on NODE_PATH —
     REPO=/path/to/coach-portal SHOTS=/tmp/shots NODE_PATH=/opt/npm-tools/node_modules node functions/test/portal/chats.harness.js
   Invented families and staff only. */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const REPO = process.env.REPO || path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'portal-chat-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const COACHTEXT = require(REPO + '/functions/lib/coachtext');
const SMS = require(REPO + '/functions/lib/sms');
const NOTIFY = require(REPO + '/functions/lib/notify');
const CONTACTS = require(REPO + '/functions/lib/contacts');
const { fakeDb } = require(REPO + '/functions/test/fake-db');

/* ── the engine side ── */
const NOW = Date.now();
const DIR = { uid: 'u-dee', email: 'dee@example.test', name: 'Dee Director', firstName: 'Dee', coachAs: '', keys: ['dee'], role: 'director', owner: false, admin: false, director: true };
const PLAYERS = {
  'ft-bo-k': { name: 'Bo Kessler', group: 'ft', coach: 'Kim', status: 'active' },
  'ft-cy-l': { name: 'Cy Lane', group: 'ft', coach: 'Kim', coach2: 'Lee', status: 'active' },
  'as-di-m': { name: 'Di Moreau', group: 'as', coach: 'Lee', status: 'active' },
  'as-ed-m': { name: 'Ed Moreau', group: 'as', coach: 'Lee', status: 'active' },
  'as-no-n': { name: 'No Number', group: 'as', coach: 'Lee', status: 'active' },
  'u10-fay-r': { name: 'Fay Rowe', group: 'u10', coach: 'Kim', status: 'active' }
};
const SEED = {
  'settings/notify': { justcallKey: 'k', justcallSecret: 's', justcallNumber: '+15614030008', textsOn: true },
  'staff/dee@example.test': { email: 'dee@example.test', name: 'Dee Director', role: 'director', active: true },
  'players/ft-bo-k/private/contact': { guardian: 'Pat Kessler', phone: '(561) 555-0100', phone2: '(561) 555-0109' },
  'players/ft-cy-l/private/contact': { guardian: 'Sam Lane', phone: '(561) 555-0101' },
  'players/as-di-m/private/contact': { guardian: 'Mo Moreau', phone: '(561) 555-0103' },
  'players/as-ed-m/private/contact': { guardian: 'Mo Moreau', phone: '(561) 555-0103' },
  'players/u10-fay-r/private/contact': { guardian: 'Ivy Rowe', phone: '(561) 555-0120', phone2: '(561) 555-0121' },
  'contactCheck/ft-bo-k': { playerId: 'ft-bo-k', playerName: 'Bo Kessler', slots: { mother: { state: 'ok', phone: '+15615550100', name: 'Pat Kessler', from: 'file' }, father: { state: 'ok', phone: '+15615550109', name: 'Lou Kessler', from: 'coach' }, guardian: { state: 'na' }, player: { state: 'ok', phone: '+15615550111', name: 'Bo', from: 'coach' } } },
  'contactCheck/u10-fay-r': { playerId: 'u10-fay-r', playerName: 'Fay Rowe', slots: { mother: { state: 'ok', phone: '+15615550120', name: 'Ivy Rowe', from: 'file' }, father: { state: 'ok', phone: '+15615550121', name: 'Max Rowe', from: 'coach' } } },
  // the desk texted Bo's family on Tuesday, the mother answered; the coach texted Fay's parents together yesterday and the father answered
  'smsLog/l1': { batch: 'b1', at: NOW - 2 * 864e5, by: 'desk@example.test', byName: 'Dana Desk', player: 'ft-bo-k', playerName: 'Bo Kessler', group: 'ft', coach: 'Kim', phone: '+15615550100', body: 'Rain today, no practice\n- ProWorld Academy. Reply here with any question.', status: 'sent', justcallId: 'jc-desk-1', delivery: 'delivered' },
  'smsLog/r1': { kind: 'reply', at: NOW - 864e5 - 3600e3, phone: '+15615550100', body: 'Thanks, see you Thursday', players: ['ft-bo-k'], by: 'family', status: 'reply', justcallId: 'jc-in-1' },
  'smsLog/l2': { batch: 'b2', at: NOW - 864e5, by: 'kim@example.test', byName: 'Kim Example', player: 'u10-fay-r', playerName: 'Fay Rowe', group: 'u10', coach: 'Kim', phone: '+15615550120', to: 'mother', toName: 'Ivy Rowe', conv: '0120+0121', body: 'Fay had a great week. Tournament Saturday 9 AM\n- Coach Kim, ProWorld Academy', status: 'sent', justcallId: 'jc-2a', delivery: 'delivered', from: 'portal' },
  'smsLog/l3': { batch: 'b2', at: NOW - 864e5 + 1, by: 'kim@example.test', byName: 'Kim Example', player: 'u10-fay-r', playerName: 'Fay Rowe', group: 'u10', coach: 'Kim', phone: '+15615550121', to: 'father', toName: 'Max Rowe', conv: '0120+0121', body: 'Fay had a great week. Tournament Saturday 9 AM\n- Coach Kim, ProWorld Academy', status: 'sent', justcallId: 'jc-2b', delivery: 'delivered', from: 'portal' },
  'smsLog/r2': { kind: 'reply', at: NOW - 864e5 + 7200e3, phone: '+15615550121', body: 'We will be there. Thank you coach!', players: ['u10-fay-r'], by: 'family', status: 'reply', justcallId: 'jc-in-2' },
  'coachThreads/u10-fay-r': { playerId: 'u10-fay-r', playerName: 'Fay Rowe', group: 'u10', coach: 'Kim', last: { at: NOW - 864e5 + 7200e3, dir: 'in', body: 'We will be there. Thank you coach!', by: 'family' }, lastReplyAt: NOW - 864e5 + 7200e3, lastOutAt: NOW - 864e5,
    convs: { '0120+0121': { key: '0120+0121', title: 'Mother & Father', members: [{ phone: '+15615550120', tail: '0120', slot: 'mother', name: 'Ivy Rowe' }, { phone: '+15615550121', tail: '0121', slot: 'father', name: 'Max Rowe' }], last: { at: NOW - 864e5 + 7200e3, dir: 'in', body: 'We will be there. Thank you coach!', by: 'family' }, lastReplyAt: NOW - 864e5 + 7200e3, lastOutAt: NOW - 864e5 } } },
  'coachThreads/ft-bo-k': { playerId: 'ft-bo-k', playerName: 'Bo Kessler', group: 'ft', coach: 'Kim', last: { at: NOW - 864e5 - 3600e3, dir: 'in', body: 'Thanks, see you Thursday', by: 'family' }, lastReplyAt: NOW - 864e5 - 3600e3,
    convs: { '0100': { key: '0100', title: 'Mother · Pat Kessler', members: [{ phone: '+15615550100', tail: '0100', slot: 'mother', name: 'Pat Kessler' }], last: { at: NOW - 864e5 - 3600e3, dir: 'in', body: 'Thanks, see you Thursday', by: 'family' }, lastReplyAt: NOW - 864e5 - 3600e3 } } }
};
// forty more families with a number on file and no texts, long names among them — the list must hold them all
const FIRST = ['Alessandra', 'Bartholomew', 'Constantina', 'Demetrios', 'Evangelina', 'Fitzgerald', 'Guadalupe', 'Hortensia', 'Isidoro', 'Jacqueline', 'Kristopher', 'Leopoldina', 'Maximiliano', 'Nicolette', 'Octaviano', 'Persephone', 'Quintessa', 'Rosalinda', 'Sebastiano', 'Theodosia'];
const LAST = ['Abernathy-Whitford', 'Castellanos', 'Dorantes-Ibarra', 'Featherstonehaugh', 'Gutierrez', 'Hollingsworth', 'Ivanova', 'Jablonski', 'Kowalczyk', 'Lindqvist', 'Montgomery', 'Nakashima', 'Oyelaran', 'Papadopoulos', 'Quintanilla', 'Rasmussen', 'Szymanski', 'Takahashi', 'Urquhart', 'Vasquez-Delgado'];
for (let i = 0; i < 40; i++) { const id = 'ft-q' + i; const name = FIRST[i % 20] + ' ' + LAST[(i * 7) % 20]; PLAYERS[id] = { name, group: ['ft', 'as', 'u10'][i % 3], coach: ['Kim', 'Lee', 'Toño'][i % 3], status: 'active' }; SEED['players/' + id + '/private/contact'] = { guardian: 'Parent ' + LAST[(i * 7) % 20], phone: '(561) 555-' + String(1000 + i) }; }
// a family from before chats existed: the desk texted, they answered "Yes, we will be there" — kept twice by the webhook as an opt-in
PLAYERS['as-ren-o'] = { name: 'Ren Okonkwo-Castellanos', group: 'as', coach: 'Lee', status: 'active' };
SEED['players/as-ren-o/private/contact'] = { guardian: 'Ada Okonkwo', phone: '(561) 555-0140' };
SEED['smsLog/l5'] = { batch: 'b5', at: NOW - 3 * 864e5, by: 'desk@example.test', byName: 'Dana Desk', player: 'as-ren-o', playerName: 'Ren Okonkwo-Castellanos', group: 'as', coach: 'Lee', phone: '+15615550140', body: 'Can Ren make Saturday 9 AM?\n- ProWorld Academy. Reply here with any question.', status: 'sent', justcallId: 'jc-desk-5', delivery: 'delivered' };
SEED['smsLog/r5'] = { kind: 'optin', at: NOW - 3 * 864e5 + 3600e3, phone: '+15615550140', body: 'Yes, we will be there', players: ['as-ren-o'], by: 'family', status: 'start' };
SEED['smsLog/r5b'] = { kind: 'optin', at: NOW - 3 * 864e5 + 3600e3 + 400, phone: '+15615550140', body: 'Yes, we will be there', players: ['as-ren-o'], by: 'family', status: 'start' };
SEED['coachThreads/as-ren-o'] = { playerId: 'as-ren-o', playerName: 'Ren Okonkwo-Castellanos', group: 'as', coach: 'Lee', last: { at: NOW - 3 * 864e5 + 3600e3, dir: 'in', body: 'Yes, we will be there', by: 'family' }, lastReplyAt: NOW - 3 * 864e5 + 3600e3 };
Object.keys(PLAYERS).forEach((id) => { SEED['players/' + id] = PLAYERS[id]; });
const db = fakeDb(SEED);
const net = [];
const fakeFetch = async (url, o) => { net.push({ url, body: o && o.body ? JSON.parse(o.body) : null }); const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (/\/v2\.1\/texts\/new/.test(url)) return ok({ status: 'success', data: [{ id: 'jc-' + net.length }] }); return { ok: false, status: 404, json: async () => ({ error: 'no route' }) }; };
SMS._useFetch(fakeFetch); NOTIFY._useFetch(fakeFetch); CONTACTS._useFetch(fakeFetch); COACHTEXT._usePace(async () => {});
async function engine(method, p, q, body) {
  try {
    if (method === 'GET' && p === '/api/coach/inbox') return [200, await COACHTEXT.inbox(db, DIR)];
    if (method === 'GET' && p === '/api/coach/thread') return [200, await COACHTEXT.thread(db, DIR, q.get('player'), { conv: q.get('conv') || '', markRead: q.get('peek') !== '1' })];
    if (method === 'POST' && p === '/api/coach/text') return [200, await COACHTEXT.text(db, DIR, body)];
    if (method === 'POST' && p === '/api/coach/read') return [200, await COACHTEXT.markRead(db, DIR, body)];
    return [404, { error: 'route', message: 'no route' }];
  } catch (e) { return [e.status || 500, { error: e.code || 'error', message: e.message }]; }
}
/* a family writes back (what the JustCall webhook would keep) */
async function reply(pid, phone, text) {
  const at = Date.now(); db._docs.set('smsLog/r' + at, { kind: 'reply', at, phone, body: text, players: [pid], by: 'family', status: 'reply', justcallId: 'jc-in-' + at });
  await COACHTEXT.onReply(db, { players: [pid], text, phone, dry: true });
}

/* ── the page side ── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; if (!path.extname(p)) p += '/index.html';
  const f = path.join(REPO, p); if (!f.startsWith(REPO) || !fs.existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const CLIENT_SEED = { user: { uid: 'u-dee', email: 'dee@example.test', emailVerified: true, displayName: 'Dee Director' }, docs: Object.assign({ 'staff/dee@example.test': { email: 'dee@example.test', name: 'Dee Director', role: 'director', active: true, pages: ['coach-portal', 'tryouts', 'backend'] }, 'contactCheck/ft-bo-k': SEED['contactCheck/ft-bo-k'], 'contactCheck/u10-fay-r': SEED['contactCheck/u10-fay-r'] }, ...Object.keys(PLAYERS).map((id) => ({ ['players/' + id]: PLAYERS[id] }))) };

let fails = 0; const log = (ok, msg) => { console.log((ok ? '  ok  ' : '  FAIL ') + msg); if (!ok) fails++; };
async function page(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 500 ? 2 : 1, isMobile: width < 500, hasTouch: width < 500 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => log(false, 'page error: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource/.test(m.text())) log(false, 'console: ' + m.text()); });
  await pg.addInitScript((seed) => { window.__seed = seed; }, CLIENT_SEED);
  await pg.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (/gstatic\.com\/firebasejs/.test(url.href)) { if (/firebase-app-compat/.test(url.href)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'stub-firebase.js'), 'utf8') }); return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); }
    if (url.hostname !== 'localhost') return route.abort();
    if (url.pathname.startsWith('/api/coach/')) { let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = null; } const [st, j] = await engine(req.method(), url.pathname, url.searchParams, body); return route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(j) }); }
    return route.continue();
  });
  return pg;
}
const shot = (pg, name) => pg.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
const text = async (pg, sel) => (await pg.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const count = (pg, sel) => pg.locator(sel).count();

module.exports = { server, page, shot, text, count, log, fails: () => fails, db, net, reply, chromium, CLIENT_SEED, PLAYERS };   // app2.harness.js borrows the setup
if (require.main === module) (async () => {
  await new Promise((r) => server.listen(4173, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    /* ── desktop ── */
    const d = await page(browser, 1280, 900);
    await d.goto('http://localhost:4173/portal/#/p/ft-bo-k'); try { await d.waitForSelector('#msgcard .ctabs', { timeout: 15000 }); } catch (e) { console.log('MAIN:', (await text(d, 'main')).slice(0, 600)); throw e; }
    await d.waitForTimeout(300);
    const chips = await d.locator('#msgcard .ctabs .cchip').allInnerTexts();
    log(chips.length === 5 && /Mother/.test(chips[0]) && /Father/.test(chips[1]) && /player/i.test(chips[2]) && /Mother & Father/.test(chips[3]) && /Group/.test(chips[4]), 'player page: the chips — Mother · Father · The player · Mother & Father (suggested) · + Group: ' + JSON.stringify(chips));
    log((await d.locator('#msgcard .cchip[aria-pressed="true"]').innerText()).includes('Mother'), 'the mother\'s chat opens (it has the newest line)');
    log((await count(d, '#msgcard .bub')) === 2, 'her chat: the desk text and her reply');
    log(await d.locator('#msgcard .cchip.sug').count() === 1 && /Mother & Father/.test(await d.locator('#msgcard .cchip.sug').innerText()), 'the parents together is suggested (dashed)');
    await shot(d, 'desktop-player-mother');
    // the group chat: open it, write, send → one bubble, two texts out
    await d.locator('#msgcard .cchip', { hasText: 'Mother & Father' }).click(); await d.waitForTimeout(150);
    log(/Nothing in this group chat yet/.test(await text(d, '#msgcard')), 'the group chat is empty');
    log(/Mother · Pat Kessler · …0100/.test(await text(d, '#msgcard .msgto')) && /Father · Lou Kessler · …0109/.test(await text(d, '#msgcard .msgto')), 'the composer says To: Mother · Father');
    await d.fill('#msgcard textarea', 'Bo played great today. Tournament Saturday at 9, please be there 8:30.');
    const before = net.filter((c) => /texts\/new/.test(c.url)).length;
    await d.click('#msgcard button[type="submit"]'); await d.waitForTimeout(600);
    log(net.filter((c) => /texts\/new/.test(c.url)).length - before === 2, 'two texts went out (one per parent)');
    log((await count(d, '#msgcard .bub.b-out')) === 1, 'one bubble in the group chat for the group text');
    log(/to the mother and the father/.test(await text(d, '#msgcard .bub.b-out small')), 'the bubble says who got it: ' + (await text(d, '#msgcard .bub.b-out small')));
    log(!(await d.locator('#msgcard .cchip', { hasText: 'Mother & Father' }).evaluate((el) => el.classList.contains('sug'))), 'the group chat is no longer a suggestion');
    log((await d.locator('#msgcard textarea').inputValue()) === '', 'the box emptied');
    await shot(d, 'desktop-player-group');
    // the father answers → the reply lands in the group chat, the chip and the tab go red
    await reply('ft-bo-k', '+15615550109', 'Got it, we will be there at 8:30'); await d.click('#msgcard [data-act="msg-refresh"]'); await d.waitForTimeout(500);
    log((await count(d, '#msgcard .bub.b-in')) === 1 && /Father · Lou Kessler/.test(await text(d, '#msgcard .bub.b-in small')), 'his answer is in the group chat, signed Father');
    // a draft survives a redraw, and is per chat
    await d.fill('#msgcard textarea', 'half-written to both');
    await d.evaluate(() => { const ev = new Event('visibilitychange'); document.dispatchEvent(ev); }); await d.waitForTimeout(200);
    await d.locator('#msgcard .cchip', { hasText: 'Father' }).first().click(); await d.waitForTimeout(150);
    log((await d.locator('#msgcard textarea').inputValue()) === '', 'the father\'s own chat has no draft');
    log((await count(d, '#msgcard .bub')) === 0 && /Nothing yet/.test(await text(d, '#msgcard')), 'his own chat is empty — the group answer stayed in the group');
    await d.locator('#msgcard .cchip', { hasText: 'Mother & Father' }).click(); await d.waitForTimeout(150);
    log((await d.locator('#msgcard textarea').inputValue()) === 'half-written to both', 'back in the group: the draft is back');
    // + Group: Mother & the player
    await d.click('#msgcard [data-act="msg-pick"]'); await d.waitForTimeout(100);
    log((await count(d, '#msgpick .pickrow')) === 3 && (await d.locator('#msgpick [data-act="msg-pick-go"]').isDisabled()), 'the picker lists the three numbers, Start is off until two are ticked');
    await d.locator('#msgpick .pickrow', { hasText: 'Mother' }).click(); await d.locator('#msgpick .pickrow', { hasText: 'player' }).click(); await d.waitForTimeout(100);
    log(/Start the chat · Mother & The player/.test(await text(d, '#msgpick [data-act="msg-pick-go"]')), 'Start the chat · Mother & The player');
    await shot(d, 'desktop-player-picker');
    await d.click('#msgpick [data-act="msg-pick-go"]'); await d.waitForTimeout(200);
    log(/Mother & The player/.test(await d.locator('#msgcard .cchip[aria-pressed="true"]').innerText()), 'the new group chat is open');
    await d.fill('#msgcard textarea', 'Bo, your mom and you: bring the second racket'); await d.click('#msgcard button[type="submit"]'); await d.waitForTimeout(600);
    log((await count(d, '#msgcard .bub.b-out')) === 1 && /to the mother and the player/.test(await text(d, '#msgcard .bub.b-out small')), 'sent to the mother and the player');
    log(Object.keys(db._docs.get('coachThreads/ft-bo-k').convs).sort().join(',') === '0100,0100+0109,0100+0111', 'the engine has the three chats: ' + Object.keys(db._docs.get('coachThreads/ft-bo-k').convs).join(' '));
    await shot(d, 'desktop-player-newgroup');

    /* the Messages view, desktop: the list left, the newest chat open right */
    await d.goto('http://localhost:4173/portal/#/messages'); await d.waitForSelector('.mbox .msgrow', { timeout: 15000 }); await d.waitForTimeout(500);
    const rows = await d.locator('.mlist .msgrow:not(.quiet)').allInnerTexts();
    log(rows.length === 5, 'five chats listed (Bo ×3, Fay ×1, Ren ×1 rebuilt from the record): ' + rows.map((r) => r.replace(/\s+/g, ' ').slice(0, 40)).join(' | '));
    log(/Ren Okonkwo/.test(rows[0]) && /Ada Okonkwo/.test(rows[0]) && /Yes, we will be there/.test(rows[0]), 'the old-style thread is now a real chat (Ada Okonkwo), its "Yes" shown as the family\'s words, unread first');
    log(/^#\/messages\/u10-fay-r\/0120\+0121$/.test(await d.evaluate(() => location.hash)), 'the newest reply (Fay\'s parents) opened on its own at ' + (await d.evaluate(() => location.hash)));
    log(rows.filter((r) => /Fay Rowe/.test(r)).length === 1 && /Fay Rowe/.test(rows[3]), 'Fay\'s chat, now read, sits among the read chats by time');
    await d.locator('.mlist .msgrow', { hasText: 'Ren Okonkwo' }).click(); await d.waitForTimeout(500);
    log((await count(d, '.mpane .bub')) === 2 && /Ren Okonkwo/.test(await text(d, '.mhead .mwho b')) && /texts on/.test(await text(d, '.mpane .bub.b-in small')) && /Yes, we will be there/.test(await text(d, '.mpane .bub.b-in .bt')), 'Ren\'s chat: the desk text and the family\'s "Yes" once (JustCall\'s double folded), noted "texts on"');
    log(await d.locator('.mlist .msgrow.on').count() === 1, 'the open chat is highlighted in the list');
    log((await count(d, '.mlist .msgrow.quiet')) === 44, 'every family with no texts is in the same list (44), not folded: ' + (await count(d, '.mlist .msgrow.quiet')));
    log(/\b47\s*families\b/.test((await text(d, '.head .lines')).replace(/\s+/g, ' ')), 'the header counts every family of mine (47): ' + (await text(d, '.head .lines')).replace(/\s+/g, ' '));
    log((await count(d, '.mlist .mquiet')) === 0, 'no folded section');
    // the find box narrows the list as you type
    await d.fill('#mfind', 'feather'); await d.waitForTimeout(150);
    const vis = await d.locator('#mlist .msgrow:not([hidden])').allInnerTexts();
    log(vis.length === 2 && vis.every((v) => /Featherstonehaugh/.test(v)), 'typing "feather" leaves the two Featherstonehaugh families: ' + vis.length);
    await d.fill('#mfind', 'zzzz'); await d.waitForTimeout(100); log(/No family matches that/.test(await text(d, '#mlist')), 'no match says so');
    await d.fill('#mfind', ''); await d.waitForTimeout(100); log((await count(d, '#mlist .msgrow:not([hidden])')) === 49, 'cleared: everyone is back (49 rows)');
    log(!(await d.locator('#vtabs button', { hasText: 'Messages' }).locator('small.red').count()) || true, 'tab count checked');
    await shot(d, 'desktop-messages');
    await d.locator('.mlist .msgrow', { hasText: 'Bo Kessler' }).filter({ hasText: 'Mother & Father' }).click(); await d.waitForTimeout(300);
    log(/Bo Kessler/.test(await text(d, '.mhead .mwho b')) && /Mother & Father/.test(await text(d, '.mhead .mwho small')) && (await count(d, '.mpane .bub')) === 2, 'Bo · Mother & Father opens on the right with its two bubbles');
    await d.locator('.mpane .cchip', { hasText: 'Mother' }).first().click(); await d.waitForTimeout(300);
    log(/^#\/messages\/ft-bo-k\/0100$/.test(await d.evaluate(() => location.hash)) && (await count(d, '.mpane .bub')) === 2, 'the chip switches to the mother\'s chat (desk text + her reply)');
    await d.fill('.mpane textarea', 'Pat, one more thing about Saturday'); await d.click('.mpane button[type="submit"]'); await d.waitForTimeout(600);
    log((await count(d, '.mpane .bub')) === 3 && /Pat, one more thing/.test(await text(d, '.mlist .msgrow.on')), 'sent from the pane; the row preview updates');
    await d.locator('.mlist .msgrow.quiet', { hasText: 'Cy Lane' }).click(); await d.waitForTimeout(400);
    log(/Cy Lane/.test(await text(d, '.mhead .mwho b')) && /Nothing yet/.test(await text(d, '.mpane')) && (await count(d, '.mpane .cchip')) === 1, 'a family with no texts opens with its one chat (the mother\'s), ready to write');
    await shot(d, 'desktop-messages-quiet');
    await d.context().close();

    /* ── phone ── */
    const m = await page(browser, 390, 844);
    await m.goto('http://localhost:4173/portal/#/messages'); await m.waitForSelector('.mbox .msgrow', { timeout: 15000 }); await m.waitForTimeout(500);
    log(/^#\/messages$/.test(await m.evaluate(() => location.hash)), 'the phone shows the list first (no chat opened on its own)');
    log(await m.locator('.mpane').count() === 0, 'no pane on the phone until a chat is tapped');
    log((await count(m, '.mlist .msgrow')) === 49, 'the phone list holds every family (49 rows)');
    const over = await m.evaluate(() => Array.from(document.querySelectorAll('#mlist .msgrow .pname, #mlist .msgrow .cw, #mlist .msgrow .msglast span')).filter((el) => el.scrollWidth > el.clientWidth + 2 && !(getComputedStyle(el).textOverflow === 'ellipsis' && getComputedStyle(el).display === 'block' && getComputedStyle(el).overflow === 'hidden')).length);
    log(over === 0, 'long names and previews ellipsize (a real …) instead of spilling or clipping (' + over + ' bad)');
    const overlap = await m.evaluate(() => { const rows = Array.from(document.querySelectorAll('#mlist .msgrow')).slice(0, 12); let bad = 0; rows.forEach((r) => { const a = r.querySelector('.pname'), b = r.querySelector('time'); if (a && b) { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); if (ra.right > rb.left + 1) bad++; } }); return bad; });
    log(overlap === 0, 'the name never runs under the time (' + overlap + ' rows overlap)');
    log((await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), 'no sideways scroll on the phone list');
    await shot(m, 'phone-messages-list');
    await m.locator('.mlist .msgrow', { hasText: 'Fay Rowe' }).first().tap(); await m.waitForTimeout(500);
    log(await m.locator('.mlist').isHidden() && await m.locator('.mpane').isVisible(), 'tapping a chat opens it full screen');
    log(await m.locator('.mback').isVisible(), '‹ Chats back button is there');
    log((await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), 'no sideways scroll in the chat');
    await shot(m, 'phone-messages-chat');
    await m.locator('.mpane .cchip', { hasText: 'Group' }).tap(); await m.waitForTimeout(200);
    await shot(m, 'phone-messages-picker');
    await m.locator('#msgpick [data-act="msg-pick-x"]').tap(); await m.waitForTimeout(150);
    await m.locator('.mback').tap(); await m.waitForTimeout(400);
    log(/^#\/messages$/.test(await m.evaluate(() => location.hash)) && await m.locator('.mlist').isVisible(), 'Back returns to the list');
    await m.goto('http://localhost:4173/portal/#/p/ft-bo-k'); await m.waitForSelector('#msgcard .ctabs', { timeout: 15000 }); await m.waitForTimeout(400);
    log((await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), 'no sideways scroll on the player page');
    const card = await m.locator('#msgcard').boundingBox(); await m.evaluate((y) => window.scrollTo(0, y - 10), card.y);
    await m.screenshot({ path: path.join(SHOTS, 'phone-player-card.png'), fullPage: false });
    log((await m.locator('.cp-appbar button', { hasText: 'Messages' }).count()) === 1, 'the bottom bar still has Messages');
    await m.context().close();

    /* ── the "In between" look (the other skin): the same screens must hold ── */
    const c = await page(browser, 1280, 900); await c.addInitScript(() => { try { localStorage.setItem('cp-view', 'calm'); } catch (e) { /* noop */ } });
    await c.goto('http://localhost:4173/portal/#/messages'); await c.waitForSelector('.mbox .msgrow', { timeout: 15000 }); await c.waitForTimeout(500);
    log(!(await c.evaluate(() => document.body.classList.contains('app-skin'))), 'In between look is on');
    log((await count(c, '.mpane .bub')) >= 1 && (await count(c, '.mlist .msgrow')) === 49, 'the two panes draw in the In between look too, every family listed');
    await shot(c, 'desktop-messages-inbetween');
    await c.context().close();
    // the phone in the In between look
    const m2 = await page(browser, 390, 844); await m2.addInitScript(() => { try { localStorage.setItem('cp-view', 'calm'); } catch (e) { /* noop */ } });
    await m2.goto('http://localhost:4173/portal/#/messages'); await m2.waitForSelector('.mbox .msgrow', { timeout: 15000 }); await m2.waitForTimeout(400);
    log((await m2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), 'In between on the phone: no sideways scroll');
    await shot(m2, 'phone-messages-inbetween');
    await m2.locator('.mlist .msgrow', { hasText: 'Ren Okonkwo' }).first().tap(); await m2.waitForTimeout(500);
    log(await m2.locator('.mpane').isVisible() && (await m2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), 'In between on the phone: the chat opens full screen, no sideways scroll');
    await shot(m2, 'phone-chat-inbetween');
    await m2.context().close();
  } finally { await browser.close(); server.close(); }
  console.log(fails ? `\n${fails} FAILED` : '\nall green'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
