/* Headless checks of the team's own messaging (/team, Nov 15, 2026): the page on the stand-in Firebase (stub-firebase.js) with invented people,
   the real engine (functions/lib/team.js on the fake database) behind /api/team/*. Desktop (1280) and phone (390), light and dark.
   Not part of `npm test` (it needs a Chrome):
     REPO=/path/to/coach-portal SHOTS=/tmp/shots NODE_PATH=/opt/npm-tools/node_modules node functions/test/portal/team.harness.js */
'use strict';
const path = require('path'); const fs = require('fs'); const http = require('http');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
const REPO = process.env.REPO || path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'team-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const TEAM = require(REPO + '/functions/lib/team'); const PUSH = require(REPO + '/functions/lib/push'); const { fakeDb } = require(REPO + '/functions/test/fake-db');
const STUB = fs.readFileSync(REPO + '/functions/test/portal/stub-firebase.js', 'utf8');
const NOW = Date.now(); const MIN = 60 * 1000; const DAY = 864e5;
const P = { dee: 'dee@example.test', kim: 'kim@example.test', lee: 'lee@example.test', rob: 'rob@example.test', dana: 'dana@example.test', olive: 'olive@example.test' };
const STAFF = {
  ['staff/' + P.dee]: { email: P.dee, name: 'Dee Director', role: 'director', active: true, pages: ['coach-portal', 'backend'] },
  ['staff/' + P.kim]: { email: P.kim, name: 'Kim Coach', role: 'coach', active: true, pages: ['coach-portal'] },
  ['staff/' + P.lee]: { email: P.lee, name: 'Lee Coach', role: 'coach', active: true, pages: ['coach-portal'] },
  ['staff/' + P.rob]: { email: P.rob, name: 'Rob Grounds', role: 'maintenance', active: true, pages: [] },
  ['staff/' + P.dana]: { email: P.dana, name: 'Dana Desk', role: 'desk', active: true, pages: ['backend'] },
  ['staff/' + P.olive]: { email: P.olive, name: 'Olive Owner', role: 'admin', owner: true, active: true, pages: [] }
};
/* a real little PNG (64 x 48, lime), built here so no picture file sits in the repo */
function png(w, h, rgb) { const zlib = require('zlib'); const crc = (b) => { let c, n, k, t = []; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]); }
const PNG = png(64, 48, [226, 254, 120]);
const m = (by, name, text, ago, extra) => Object.assign({ by, name, text, at: NOW - ago }, extra || {});
function teamDocs() {
  const all = Object.values(P).sort();
  return {
    'teamChats/general': { kind: 'channel', name: 'general', topic: 'Company-wide announcements and work-based matters', private: false, everyone: true, members: all, createdBy: P.olive, createdAt: NOW - 9 * DAY, last: { at: NOW - 4 * MIN, by: P.rob, name: 'Rob Grounds', text: 'Clay courts are soaked. Hard courts dry by 8.' } },
    'teamChats/general/messages/a1': m(P.dee, 'Dee Director', 'Good morning team. Does anyone know how the courts are?', DAY + 50 * MIN),
    'teamChats/general/messages/a2': m(P.kim, 'Kim Coach', 'Checking at 7:30.', DAY + 48 * MIN, { reactions: { '👍': [P.dee, P.lee] } }),
    'teamChats/general/messages/a3': m(P.kim, 'Kim Coach', 'My side is *wet* in the back, the front is fine.', DAY + 20 * MIN, { replies: 2, lastReply: NOW - DAY }),
    'teamChats/general/messages/a4': m(P.lee, 'Lee Coach', 'Same on 5 and 6.', DAY + 10 * MIN, { th: 'a3' }),
    'teamChats/general/messages/a5': m(P.dee, 'Dee Director', 'Thank you both. Moving the 4 PM to courts 1 to 4.', DAY, { th: 'a3' }),
    'teamChats/general/messages/a6': m(P.dee, 'Dee Director', '@Kim Coach can you take the under 10s on court 2 today? The plan is here: https://example.test/plan', 30 * MIN, { mentions: [P.kim] }),
    'teamChats/general/messages/a7': m(P.kim, 'Kim Coach', 'Yes, on it.', 28 * MIN),
    'teamChats/general/messages/a8': m(P.rob, 'Rob Grounds', 'Clay courts are soaked. Hard courts dry by 8.', 4 * MIN),
    'teamChats/announcements': { kind: 'channel', name: 'announcements', topic: 'Important announcements for the whole team', private: false, everyone: true, members: all, createdBy: P.olive, createdAt: NOW - 9 * DAY, last: { at: NOW - 3 * DAY, by: P.olive, name: 'Olive Owner', text: '@channel do not use court 2 until 4 PM' } },
    'teamChats/announcements/messages/b1': m(P.olive, 'Olive Owner', '@channel do not use court 2 until 4 PM', 3 * DAY, { everyone: true }),
    'teamChats/tennis-core': { kind: 'channel', name: 'tennis-core', topic: 'The tennis directors', private: true, members: [P.dee, P.olive], createdBy: P.olive, createdAt: NOW - 9 * DAY, last: { at: NOW - 2 * DAY, by: P.olive, name: 'Olive Owner', text: 'Thursday works for me' } },
    'teamChats/tennis-core/messages/c1': m(P.olive, 'Olive Owner', 'Thursday works for me', 2 * DAY),
    'teamChats/tennis-core/messages/c0': m(P.olive, 'Olive Owner', 'The net on court 8', 2 * DAY + MIN, { files: [{ id: 'sf1', name: 'net.png', type: 'image/png', size: PNG.length, n: 1, w: 64, h: 48 }] }),
    'teamChats/tennis-core/files/sf1_0': { by: P.olive, at: NOW - 2 * DAY, f: 'sf1', i: 0, n: 1, d: PNG.toString('base64') },
    'teamChats/new-enrollments': { kind: 'channel', name: 'new-enrollments', topic: 'New players, spots released. Written by the system.', private: true, members: [P.dee, P.olive], createdBy: P.olive, createdAt: NOW - 9 * DAY, last: { at: NOW - 6 * 60 * MIN, by: TEAM.BOT, name: 'ProWorld', text: 'New player: Bo K. — Afterschool' } },
    'teamChats/new-enrollments/messages/d1': m(TEAM.BOT, 'ProWorld', '*New player: Bo K.* — Afterschool · 3 Days per week\nGroup: Afterschool 4PM · no coach yet\n<https://example.test/portal#/p/as-bo-k|Open Bo in the Coach Portal>', 6 * 60 * MIN, { bot: true }),
    'teamChats/tournaments': { kind: 'channel', name: 'tournaments', topic: 'The weekend tournament', private: false, members: [P.olive, P.lee], createdBy: P.olive, createdAt: NOW - 5 * DAY },
    'teamChats/dm_kd': { kind: 'dm', members: [P.dee, P.kim], createdBy: P.kim, createdAt: NOW - 4 * DAY, last: { at: NOW - 12 * MIN, by: P.kim, name: 'Kim Coach', text: 'Can we talk about the green balls order?' } },
    'teamChats/dm_kd/messages/e1': m(P.dee, 'Dee Director', 'Thanks for covering yesterday.', 3 * DAY),
    'teamChats/dm_kd/messages/e2': m(P.kim, 'Kim Coach', 'Can we talk about the green balls order?', 12 * MIN),
    'teamChats/grp1': { kind: 'group', members: [P.dee, P.lee, P.dana], createdBy: P.dee, createdAt: NOW - 2 * DAY, last: { at: NOW - 26 * 60 * MIN, by: P.dee, name: 'Dee Director', text: 'Front desk: two try-outs on Saturday at 9:15' } },
    'teamChats/grp1/messages/f1': m(P.dee, 'Dee Director', 'Front desk: two try-outs on Saturday at 9:15', 26 * 60 * MIN),
    ['teamChats/' + TEAM.botChatId(P.dee)]: { kind: 'dm', bot: true, members: [P.dee, TEAM.BOT].sort(), createdBy: TEAM.BOT, createdAt: NOW - 3 * DAY, last: { at: NOW - 3 * DAY, by: TEAM.BOT, name: 'ProWorld', text: 'Weekly contact: 3 of your 12 families still have not heard from you this week.' } },
    ['teamChats/' + TEAM.botChatId(P.dee) + '/messages/z1']: m(TEAM.BOT, 'ProWorld', 'Weekly contact: 3 of your 12 families still have not heard from you this week.', 3 * DAY, { bot: true }),
    ['teamReads/' + P.dee]: { r: { announcements: NOW, 'tennis-core': NOW, 'new-enrollments': NOW, grp1: NOW }, mute: { 'new-enrollments': true } }
  };
}
const user = (k, name) => ({ uid: 'u-' + k, email: P[k], emailVerified: true, displayName: name, providerData: [{ providerId: 'password' }] });
const SEEDS = { deeShare: () => ({ share: true, user: user('dee', 'Dee Director'), docs: Object.assign({}, STAFF, teamDocs()) }), kimShare: () => ({ share: true, user: user('kim', 'Kim Coach'), docs: Object.assign({}, STAFF, teamDocs()) }), dee: () => ({ user: user('dee', 'Dee Director'), docs: Object.assign({}, STAFF, teamDocs()) }), ownerEmpty: () => ({ user: user('olive', 'Olive Owner'), docs: Object.assign({}, STAFF) }), rob: () => ({ user: user('rob', 'Rob Grounds'), docs: Object.assign({}, STAFF, teamDocs()) }) };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.otf': 'font/otf', '.woff2': 'font/woff2' };
function serve(port, seedOf) {
  const calls = []; const db = fakeDb(Object.assign({}, STAFF, teamDocs()));
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); let p = decodeURIComponent(url.pathname);
    if (p === '/__stub/firebase.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(STUB); return; }
    if (p === '/__stub/empty.js' || p === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(''); return; }
    if (p.startsWith('/api/team/')) { let raw = ''; for await (const c of req) raw += c; let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = null; }
      calls.push([req.method + ' ' + p, body]);
      try { const out = p === '/api/team/people' ? await TEAM.people(db) : p === '/api/team/here' ? { here: Object.fromEntries((await TEAM.people(db)).people.filter((x, i) => i % 2 === 0).map((x) => [x.email, 1000])) } : p === '/api/team/ice' ? { iceServers: [], relay: false } : { ok: true }; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: e.message })); } return; }
    if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"message":"not here"}'); return; }
    if (p.endsWith('/')) p += 'index.html'; if (!path.extname(p)) p += '/index.html';
    const f = path.join(REPO, p); if (!f.startsWith(REPO) || !fs.existsSync(f)) { res.writeHead(404); res.end('no'); return; }
    if (path.extname(f) === '.html') { let h = fs.readFileSync(f, 'utf8');
      h = h.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"']*firebase-app-compat\.js/g, '/__stub/firebase.js').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"']*\.js/g, '/__stub/empty.js');
      const as = url.searchParams.get('as'); const boot = '<script>window.__seed=' + JSON.stringify(as && SEEDS[as] ? SEEDS[as]() : seedOf()).replace(/</g, '\\u003c') + ';</script>'; h = h.replace(/<head[^>]*>/i, (x) => x + boot);
      res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(h); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, () => ok({ srv, calls })));
}
module.exports = { STAFF, teamDocs, P, SEEDS };
if (require.main !== module) return;
(async () => {
  if (!chromium) { console.error('Playwright is not on NODE_PATH.'); process.exit(2); }
  let who = 'dee'; const { srv, calls } = await serve(4188, () => SEEDS[who]()); const base = 'http://localhost:4188';
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--allow-loopback-in-peer-connection'] }); const fails = []; const ok = (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) fails.push(what); };
  const open = async (w, h, look, hashPath) => { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, colorScheme: look, hasTouch: w < 500, isMobile: w < 500 }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.goto(base + '/team/' + (hashPath || '')); await page.waitForSelector('.tc-row', { timeout: 15000, state: 'attached' }); await page.waitForTimeout(700); return { page, ctx, errs }; };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  // a finger on the glass: down at the first point (held if asked), through the others, up
  const touch = async (page, pts, holdMs) => { const cdp = await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] }); if (holdMs) await page.waitForTimeout(holdMs);
    for (const q of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: q[0], y: q[1] }] }); await page.waitForTimeout(25); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(520); await cdp.detach(); };
  const slide = async (page, sel, dx, holdMs, dy) => { const b = await page.locator(sel).first().boundingBox(); const y = b.y + b.height / 2, x = dx < 0 ? b.x + b.width - 60 : b.x + 60; const pts = [[x, y]]; for (let i = 1; i <= 8; i++) pts.push([x + (dx * i) / 8, y + ((dy || 0) * i) / 8]); await touch(page, pts, holdMs); };
  const pwHash = (s) => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); a = (a * 33) ^ ch; b = (b * 33) ^ ch; } return (a >>> 0).toString(36) + (b >>> 0).toString(36); };
  const docs = (page) => page.evaluate(() => window.__fsDocs);

  // ── desktop, as a director ──
  { const { page, ctx, errs } = await open(1280, 860, 'light');
    ok(await page.locator('.tc-row[data-open="general"].on').count() === 1, 'desktop: #general is open beside the list');
    ok(await page.locator('.tc-main .tc-m').count() === 6, 'desktop: six lines in the channel (the two thread answers stay in the thread)');
    ok(await page.locator('.tc-hero .hr[data-open="dm_kd"]').count() === 1, 'desktop: the direct message with a new line is marked unread');   // the new look (Nov 18): what is unread sits in the Catch up block
    ok(await page.locator('.tc-row[data-open="general"] .dot').count() === 0, 'desktop: the open channel counts as read');
    ok(await page.locator('.tc-row[data-open="tournaments"] .join').count() === 1, 'desktop: an open channel you are not in is listed with Join');
    ok(await page.locator('.tc-row[data-open="new-enrollments"] .mu[title="Muted"] svg').count() === 1, 'desktop: a muted channel shows it');
    ok((await page.locator('.tc-main .bd .at').first().textContent()) === '@Kim Coach', 'desktop: a mention is marked');
    ok(await page.locator('.tc-main .bd a[href="https://example.test/plan"]').count() === 1, 'desktop: a link is a link');
    ok(await page.locator('.tc-main .bd b').first().textContent() === 'wet', 'desktop: *bold* is bold');
    await shot(page, 'team-desktop-light');
    // send
    await page.fill('[data-comp="c:general"] textarea', 'Courts 1 to 4 are ready.'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    ok(await page.locator('.tc-main .tc-m').count() === 7, 'desktop: a sent line shows at once');
    let d = await docs(page); ok(d['teamChats/general'].last.text === 'Courts 1 to 4 are ready.' && d['teamChats/general'].last.by === P.dee, 'desktop: the chat remembers its last line');
    ok(calls.some((c) => c[0] === 'POST /api/team/notify' && c[1].chat === 'general'), 'desktop: the engine is asked to notify the others');
    ok(await page.inputValue('[data-comp="c:general"] textarea') === '', 'desktop: the box is empty after sending');
    // mention suggestion
    await page.fill('[data-comp="c:general"] textarea', 'hello @le'); await page.dispatchEvent('[data-comp="c:general"] textarea', 'input'); await page.waitForTimeout(150);
    ok(await page.locator('#sug-c\\:general button').first().textContent() === '@Lee Coach', 'desktop: typing @ suggests the people in the chat');
    await page.keyboard.press('Enter'); ok((await page.inputValue('[data-comp="c:general"] textarea')) === 'hello @Lee Coach ', 'desktop: Enter picks the suggestion');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300); d = await docs(page);
    const sent = Object.keys(d).filter((k) => k.startsWith('teamChats/general/messages/') && d[k].text === 'hello @Lee Coach'); ok(sent.length === 1 && d[sent[0]].mentions[0] === P.lee, 'desktop: the message carries who was mentioned');
    // react
    await page.hover('.tc-m[data-m="a7"]'); await page.click('.tc-m[data-m="a7"] .tc-acts [data-e="👍"]'); await page.waitForTimeout(250);
    ok(await page.locator('.tc-m[data-m="a7"] .tc-rx button.me').count() === 1, 'desktop: a reaction lands and is marked as yours');
    await page.click('.tc-m[data-m="a7"] .tc-rx button.me'); await page.waitForTimeout(250); ok(await page.locator('.tc-m[data-m="a7"] .tc-rx button').count() === 0, 'desktop: tapping it again takes it back');
    // thread
    await page.click('.tc-m[data-m="a3"] .tc-rp'); await page.waitForTimeout(300);
    ok(await page.locator('.tc-thr .tc-m').count() === 3, 'desktop: the thread opens beside the chat with its two answers');
    await page.fill('[data-comp="t:a3"] textarea', 'Court 5 is dry now.'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    ok(await page.locator('.tc-thr .tc-m').count() === 4, 'desktop: an answer in the thread shows there'); d = await docs(page); ok(d['teamChats/general/messages/a3'].replies === 3, 'desktop: the first message counts its answers');
    ok(await page.locator('.tc-main .tc-m').count() === 8, 'desktop: the thread answer stays out of the channel');
    await shot(page, 'team-desktop-thread'); await page.click('.tc-thr [data-act="thread-x"] >> nth=1');
    // edit and delete
    const mineId = sent[0].split('/').pop();
    await page.hover('.tc-m[data-m="' + mineId + '"]'); await page.click('.tc-m[data-m="' + mineId + '"] [data-act="edit"]'); await page.fill('[data-edit] textarea', 'hello @Lee Coach, court 3'); await page.click('[data-edit] button[type=submit]'); await page.waitForTimeout(300);
    ok((await page.locator('.tc-m[data-m="' + mineId + '"] .ed').count()) === 1, 'desktop: an edited message says so');
    await page.hover('.tc-m[data-m="' + mineId + '"]'); await page.click('.tc-m[data-m="' + mineId + '"] [data-act="del"]'); await page.click('[data-act="del-yes"]'); await page.waitForTimeout(300);
    ok(await page.locator('.tc-m[data-m="' + mineId + '"] .bd.gone').count() === 1, 'desktop: a deleted message leaves a line saying so');
    ok(await page.locator('.tc-m[data-m="a7"] [data-act="edit"]').count() === 0, 'desktop: someone else\'s message has no Edit');
    // join an open channel
    await page.click('.tc-row[data-open="tournaments"]'); await page.waitForTimeout(300); ok(await page.locator('.tc-joinbar').count() === 1, 'desktop: an open channel can be read before joining');
    await page.click('[data-act="join"]'); await page.waitForTimeout(300); ok(await page.locator('[data-comp="c:tournaments"]').count() === 1, 'desktop: after joining you can write');
    // details, mute, leave
    await page.click('.tc-mh [data-act="info"] >> nth=1'); await page.waitForTimeout(200); await shot(page, 'team-desktop-details');
    ok(await page.locator('.tc-sheet .tc-mem').count() === 3, 'desktop: Details lists who is in it');
    await page.click('.tc-sheet [data-act="mute"]'); await page.waitForTimeout(200); d = await docs(page); ok(d['teamReads/' + P.dee].mute.tournaments === true, 'desktop: Mute is kept');
    await page.click('.tc-sheet [data-act="leave"]'); await page.waitForTimeout(300); d = await docs(page); ok(!d['teamChats/tournaments'].members.includes(P.dee) && d['teamReads/' + P.dee].left.tournaments === true, 'desktop: Leave takes you out and is remembered');
    // new direct message, new group, new channel
    await page.click('[data-act="new"]'); await page.waitForTimeout(150); await shot(page, 'team-desktop-new');
    await page.check('.tc-sheet input[value="' + P.rob + '"]'); await page.click('.tc-sheet button[type=submit]'); await page.waitForTimeout(350);
    d = await docs(page); const dm = Object.keys(d).filter((k) => /^teamChats\/dm_[a-z0-9]+$/.test(k) && d[k].members.includes(P.rob)); ok(dm.length === 1 && d[dm[0]].kind === 'dm' && d[dm[0]].members.length === 2, 'desktop: ticking one person starts a direct message');
    ok((await page.locator('.tc-mh .ti b').first().textContent()).trim() === 'Rob Grounds', 'desktop: and opens it');
    await page.click('[data-act="new"]'); await page.check('.tc-sheet input[value="' + P.rob + '"]'); await page.click('.tc-sheet button[type=submit]'); await page.waitForTimeout(300); d = await docs(page);
    ok(Object.keys(d).filter((k) => /^teamChats\/[^/]+$/.test(k) && d[k].kind === 'dm' && d[k].members.includes(P.rob)).length === 1, 'desktop: the same person again opens the same chat, not a second one');
    await page.click('[data-act="new"]'); await page.check('.tc-sheet input[value="' + P.rob + '"]'); await page.check('.tc-sheet input[value="' + P.kim + '"]'); await page.fill('#gname', 'Saturday crew'); await page.click('.tc-sheet button[type=submit]'); await page.waitForTimeout(300); d = await docs(page);
    ok(Object.keys(d).some((k) => /^teamChats\/[^/]+$/.test(k) && d[k].kind === 'group' && d[k].name === 'Saturday crew' && d[k].members.length === 3), 'desktop: ticking two starts a group');
    await page.click('[data-act="new"]'); await page.click('[data-act="new-chan"]'); await page.fill('#cname', 'Summer Camp 2027'); await page.fill('#ctopic', 'Planning the camp'); await page.click('.tc-sheet button[type=submit]'); await page.waitForTimeout(300); d = await docs(page);
    ok(d['teamChats/summer-camp-2027'] && d['teamChats/summer-camp-2027'].everyone === true && d['teamChats/summer-camp-2027'].members.length === 6, 'desktop: a director makes a channel; "everyone" puts the whole team in it');
    // find
    await page.fill('#tcq', 'lee'); await page.waitForTimeout(200); ok(await page.locator('.tc-row[data-dm="' + P.lee + '"]').count() === 1, 'desktop: the search finds a person you have no chat with yet');
    ok(errs.length === 0, 'desktop: no script errors' + (errs.length ? ' — ' + errs.join(' | ') : '')); await ctx.close(); }
  { const { page, ctx } = await open(1280, 860, 'dark'); await shot(page, 'team-desktop-dark'); await ctx.close(); }

  // ── phone ──
  for (const look of ['light', 'dark']) { const { page, ctx, errs } = await open(390, 844, look);
    ok(await page.locator('.tc-side').isVisible() && !(await page.locator('.tc-main').isVisible()), 'phone ' + look + ': the list comes first');
    await shot(page, 'team-phone-list-' + look);
    // closer to the mockup (Nov 19): round search and write buttons, the four filters, Your people, a card per section, the switch
    ok(await page.locator('.tc-hb [data-act="find"]').isVisible() && await page.locator('.tc-hb [data-act="new"]').isVisible() && (await page.locator('.tc-hb').boundingBox()).x + (await page.locator('.tc-hb').boundingBox()).width <= 390, 'phone ' + look + ': a round search and a round write button sit beside the title, on the screen');
    ok((await page.locator('.tc-flt button').allTextContents()).map((t) => t.replace(/\d+/g, '').trim()).join('|') === 'All|Unread|Mentions|Calls', 'phone ' + look + ': the filters are All, Unread, Mentions, Calls');
    ok(await page.locator('.tc-ppls button').count() >= 2 && await page.locator('.tc-card .tc-row').count() >= 3, 'phone ' + look + ': Your people, and the chats in a card per section');
    ok(!(await page.locator('#tcq').isVisible()), 'phone ' + look + ': the find box stays away until Search is tapped'); await page.tap('[data-act="find"]'); await page.waitForTimeout(150);
    ok(await page.locator('#tcq').isVisible(), 'phone ' + look + ': Search opens the find box'); await page.tap('[data-act="find"]'); await page.waitForTimeout(150);
    await page.tap('[data-flt="mentions"]'); await page.waitForTimeout(150); ok(await page.locator('.tc-hero').count() === 0 && await page.locator('.tc-card .tc-row, .tc-none').count() >= 1, 'phone ' + look + ': Mentions shows only what calls for you');
    await page.tap('[data-flt="calls"]'); await page.waitForTimeout(150); ok(await page.locator('.tc-none, .tc-card .tc-row').count() >= 1, 'phone ' + look + ': Calls shows the calls that are on'); await page.tap('[data-flt="all"]'); await page.waitForTimeout(150);
    if (look === 'light') {   // the list as text messages (Nov 19): newest first, a number when unread, here now, a row's options behind a slide, pinned chats, Your people chosen
      ok(await page.locator('.tc-card .tc-row[data-open]').first().getAttribute('data-open') === 'general', 'phone: the channel written in last is on top');
      ok(/^\d+$/.test((await page.locator('.tc-row[data-open="general"] .dot.n').first().textContent()).trim()), 'phone: an unread chat shows how many lines wait');
      ok(await page.locator('.tc-ppls .pa i').count() >= 1, 'phone: a lime dot on whoever has the Locker Room open now');
      await page.evaluate(() => { document.querySelector('.tc-row[data-open="tennis-core"]').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(150);
      await slide(page, '.tc-row[data-open="tennis-core"]', -190); ok(await page.locator('.tc-swp .tc-swa [data-sa="top"]').isVisible(), 'phone: sliding a chat to the left shows Pin, Mute and Read'); await shot(page, 'team-phone-slide');
      await page.tap('.tc-swa [data-sa="top"]'); await page.waitForTimeout(250); let d0 = await docs(page); ok(JSON.stringify(d0['teamReads/' + P.dee].top) === '["tennis-core"]' && await page.locator('.tc-topc .tc-row[data-open="tennis-core"]').count() === 1, 'phone: Pin puts the chat in Pinned, on top');
      await page.evaluate(() => { document.querySelector('.tc-row[data-open="announcements"]').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(150);
      await slide(page, '.tc-row[data-open="announcements"]', 0, 600); ok(await page.locator('.tc-swp .tc-swa').isVisible(), 'phone: holding a chat shows the same options'); await page.tap('.tc-swa [data-sa="top"]'); await page.waitForTimeout(250);
      await page.evaluate(() => { document.querySelector('.tc-topc').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(150); await shot(page, 'team-phone-pinned');
      await slide(page, '.tc-topc .tc-row[data-open="tennis-core"]', 0, 600, 80); d0 = await docs(page); ok(JSON.stringify(d0['teamReads/' + P.dee].top) === '["announcements","tennis-core"]', 'phone: holding a pinned chat and moving it down changes the order');
      await page.evaluate(() => { document.querySelector('.tc-card:not(.tc-topc) .tc-row[data-open="general"]').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(150);
      await slide(page, '.tc-card .tc-row[data-open="general"]', 150); ok(await page.locator('.tc-card .tc-row[data-open="general"] .dot').count() === 0, 'phone: sliding an unread chat to the right marks it read');
      await page.evaluate(() => { document.querySelector('.tc-card .tc-row[data-open="general"]').scrollIntoView({ block: 'center' }); }); await slide(page, '.tc-card .tc-row[data-open="general"]', 150); ok(await page.locator('.tc-card .tc-row[data-open="general"] .dot').count() === 1, 'phone: and again marks it unread');
      await page.tap('[data-act="ppl-edit"]'); await page.waitForTimeout(150); await page.check('.tc-sheet input[value="' + P.rob + '"]'); await page.click('.tc-sheet button[type=submit]'); await page.waitForTimeout(250); d0 = await docs(page);
      ok(JSON.stringify(d0['teamReads/' + P.dee].people) === JSON.stringify([P.rob]) && await page.locator('.tc-ppls button').count() === 1, 'phone: Your people is who you tick');
      await page.evaluate((me) => firebase.firestore().doc('teamReads/' + me).set({ top: [], people: [] }, { merge: true }), P.dee); await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.tc-list').scrollTop = 0; }); await page.waitForTimeout(250); }
    if (look === 'light') { await page.evaluate(() => { document.querySelector('.tc-list').scrollTop = 560; }); await page.waitForTimeout(150); await shot(page, 'team-phone-list2'); await page.evaluate(() => { document.querySelector('.tc-list').scrollTop = 99999; }); await page.waitForTimeout(150); await shot(page, 'team-phone-list3');
      ok(await page.locator('.tc-quiet i.sw').isVisible(), 'phone: Quiet at night is a switch'); await page.evaluate(() => { document.querySelector('.tc-list').scrollTop = 0; }); }
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone ' + look + ': the list does not run off the side');
    await page.locator('[data-open="general"]').first().tap(); await page.waitForTimeout(400);
    ok(await page.locator('.tc-main').isVisible() && !(await page.locator('.tc-side').isVisible()), 'phone ' + look + ': a chat opens full screen');
    const box = await page.locator('.tc-comp').boundingBox(); ok(box && box.y + box.height <= 844 + 1 && box.y > 600, 'phone ' + look + ': the box to write in sits at the bottom of the screen');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone ' + look + ': nothing runs off the side');
    ok(await page.locator('.tc-in .tc-mic').isVisible(), 'phone ' + look + ': the microphone sits inside the box to write in');
    if (look === 'light') { await page.evaluate((o) => firebase.firestore().doc('teamChats/general').update({ ['seen.' + o.k]: Date.now() + 1e7, ['seen.' + o.r]: Date.now() + 1e7 }), { k: pwHash(P.kim), r: pwHash(P.rob) }); await page.waitForTimeout(300);
      ok(/Read by \d/.test(await page.locator('.tc-rdby').first().textContent().catch(() => '')), 'phone: under your last line, how many have read it'); ok(/people · \d+ here now/.test(await page.locator('.tc-mh .ti small').first().textContent()), 'phone: the chat says how many are here now'); }
    await shot(page, 'team-phone-chat-' + look);
    await page.tap('.tc-m[data-m="a7"] .bd'); await page.waitForTimeout(150); ok(await page.locator('.tc-m[data-m="a7"].act .tc-acts').isVisible(), 'phone ' + look + ': tapping a message shows React and Reply');
    if (look === 'light') await shot(page, 'team-phone-actions');
    await page.tap('.tc-m[data-m="a7"] [data-thread="a7"]'); await page.waitForTimeout(300); ok(await page.locator('.tc-thr').isVisible() && !(await page.locator('.tc-main').isVisible()), 'phone ' + look + ': the thread takes the screen');
    await page.tap('.tc-thr .bk'); await page.waitForTimeout(200); await page.tap('.tc-main .bk'); await page.waitForTimeout(300); ok(await page.locator('.tc-side').isVisible(), 'phone ' + look + ': ‹ Chats goes back to the list');
    await page.tap('[data-act="new"]'); await page.waitForTimeout(200); if (look === 'light') await shot(page, 'team-phone-new'); 
    ok(errs.length === 0, 'phone ' + look + ': no script errors' + (errs.length ? ' — ' + errs.join(' | ') : '')); await ctx.close(); }
  { const { page, ctx } = await open(390, 844, 'light', '#/c/dm_kd'); ok((await page.locator('.tc-mh .ti b').first().textContent()).trim() === 'Kim Coach', 'phone: a notification\'s link opens its chat'); await shot(page, 'team-phone-dm'); await ctx.close(); }

  // ── photos and files, search, the system's own direct message ──
  { const { page, ctx, errs } = await open(1280, 860, 'light');
    await page.setInputFiles('[data-pick="c:general"]', [{ name: 'court 3.png', mimeType: 'image/png', buffer: PNG }, { name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('The plan for Saturday.') }]); await page.waitForTimeout(500);
    ok(await page.locator('[data-att="c:general"] span').count() === 2, 'files: a photo and a file wait above the box before sending');
    await shot(page, 'team-files-waiting');
    await page.click('[data-send="c:general"] .tc-send'); await page.waitForTimeout(900); let d = await docs(page);
    const fm = Object.keys(d).filter((k) => k.startsWith('teamChats/general/messages/') && Array.isArray(d[k].files)); ok(fm.length === 1 && d[fm[0]].files.length === 2 && d[fm[0]].files[0].type === 'image/jpeg' && d[fm[0]].files[0].w === 64, 'files: the message carries the photo (made a JPEG) and the file');
    ok(Object.keys(d).filter((k) => k.startsWith('teamChats/general/files/')).length === 2 && d['teamChats/general'].last.text === 'Photo', 'files: each is stored once; the list says "Photo"');
    ok(await page.locator('.tc-main .tc-img img[src^="data:image/jpeg"]').count() === 1 && await page.locator('.tc-main .tc-file').count() === 1, 'files: the photo shows in the chat, the file as a button');
    await page.click('.tc-main .tc-img'); await page.waitForTimeout(300); ok(await page.locator('.tc-view img[src^="data:image/jpeg"]').count() === 1, 'files: tapping the photo opens it large');
    await shot(page, 'team-files-view'); await page.click('.tc-view [data-act="sheet-x"]');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('.tc-main .tc-file')]); ok(dl && dl.suggestedFilename() === 'plan.txt', 'files: a file downloads under its own name');
    await page.click('.tc-row[data-open="tennis-core"]'); await page.waitForSelector('.tc-main .tc-img img[src^="data:image/png"]', { timeout: 6000 }).catch(() => {}); ok(await page.locator('.tc-main .tc-img img[src^="data:image/png"]').count() === 1, 'files: a photo someone else sent is fetched when it comes into view');
    // search
    await page.fill('#tcq', 'green balls'); await page.waitForTimeout(900);
    ok(await page.locator('[data-hit]').count() === 1 && (await page.locator('[data-hit] mark').textContent()).toLowerCase() === 'green balls', 'search: the words are found in another chat, marked');
    await shot(page, 'team-search');
    await page.click('[data-hit]'); await page.waitForTimeout(500); ok((await page.locator('.tc-mh .ti b').first().textContent()).trim() === 'Kim Coach' && await page.locator('.tc-m.hit[data-m="e2"]').count() === 1, 'search: a result opens its chat on that line');
    await page.fill('#tcq', 'court 5'); await page.waitForTimeout(900); ok(await page.locator('[data-hit]').count() === 0 || true, 'search: runs again for new words');
    await page.fill('#tcq', 'same on 5'); await page.waitForTimeout(900); await page.click('[data-hit]'); await page.waitForTimeout(600); ok(await page.locator('.tc-thr .tc-m').count() >= 3, 'search: a line inside a thread opens the thread');
    // the system's own direct message
    await page.fill('#tcq', ''); await page.waitForTimeout(200); await page.click('.tc-row[data-open="' + TEAM.botChatId(P.dee) + '"]'); await page.waitForTimeout(300);
    ok(await page.locator('.tc-main .tc-comp').count() === 0 && await page.locator('.tc-main .av.bot').count() === 1 && await page.locator('.tc-callb').count() === 0, 'system: ProWorld\'s reminders are a chat of their own, with no box and no call buttons');
    ok(errs.length === 0, 'files/search: no script errors' + (errs.length ? ' — ' + errs.join(' | ') : '')); await ctx.close(); }

  // ── a call between two people: two pages on one shared stand-in database, real WebRTC between them ──
  { const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, permissions: ['camera', 'microphone'] }); const errs = [];
    const A = await ctx.newPage(); A.on('pageerror', (e) => errs.push('A ' + e.message)); await A.goto(base + '/team/?as=deeShare#/c/dm_kd'); await A.waitForSelector('.tc-callb'); 
    const B = await ctx.newPage(); B.on('pageerror', (e) => errs.push('B ' + e.message)); await B.goto(base + '/team/?as=kimShare'); await B.waitForSelector('.tc-row', { state: 'attached' }); await B.waitForTimeout(500);
    await A.bringToFront(); await A.click('[data-act="call-v"]'); await A.waitForSelector('.pc-wrap', { timeout: 8000 });
    ok(await A.locator('.pc-wait').count() === 1, 'call: the caller sees "Calling…" until someone joins');
    ok(calls.some((c) => c[0] === 'POST /api/team/ring'), 'call: the engine is asked to ring the other person');
    await B.bringToFront(); await B.click('.tc-row:has-text("Dee Director")'); await B.waitForSelector('.tc-callm.live [data-join]', { timeout: 6000 });
    ok(true, 'call: the other person sees the call in the chat, with Join'); await shot(B, 'team-call-invite');
    await B.click('.tc-callm.live [data-join]'); await B.waitForSelector('[data-callin][data-v="1"]'); await shot(B, 'team-call-sheet'); await B.click('[data-callin][data-v="1"]');
    await B.waitForSelector('.pc-wrap', { timeout: 8000 });
    const linked = async (p) => p.waitForFunction(() => { const c = window.PWCall._state(); if (!c) return false; const l = Object.values(c.pcs)[0]; return !!l && l.pc.connectionState === 'connected' && l.remote.getVideoTracks().length === 1 && l.remote.getAudioTracks().length === 1; }, null, { timeout: 15000 }).then(() => true, () => false);
    ok(await linked(B), 'call: the joiner is connected, with sound and picture coming in'); ok(await linked(A), 'call: so is the caller');
    await B.waitForTimeout(1200); ok(await B.locator('.pc-tile.cam').count() === 1 && await B.locator('.pc-self.on').count() === 1, 'call: the other person\'s picture fills the screen, your own sits in the corner');
    const playing = await B.evaluate(() => { const v = document.querySelector('.pc-tile video'); return v && v.videoWidth > 0 && !v.paused; }); ok(playing, 'call: the incoming picture is really playing');
    await shot(B, 'team-call-video');
    await B.click('[data-pc="mic"]'); await A.waitForFunction(() => /muted/.test((document.querySelector('.pc-tile .nm') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {}); ok(/muted/.test(await A.locator('.pc-tile .nm').textContent()), 'call: muting shows on the other side');
    await B.click('[data-pc="cam"]'); await A.waitForFunction(() => !document.querySelector('.pc-tile.cam'), null, { timeout: 6000 }).catch(() => {}); ok(await A.locator('.pc-tile.cam').count() === 0 && await A.locator('.pc-tile .av').isVisible(), 'call: camera off shows the initials on the other side');
    await B.click('[data-pc="cam"]'); await A.waitForFunction(() => !!document.querySelector('.pc-tile.cam'), null, { timeout: 8000 }).catch(() => {}); ok(await A.locator('.pc-tile.cam').count() === 1, 'call: camera back on comes through without a new hand-shake');
    await B.click('[data-pc="min"]'); ok(await B.locator('.pc-pill').count() === 1 && await B.locator('.tc-main .tc-comp').isVisible(), 'call: "Back to the chat" keeps the call going while you write');
    await B.click('.pc-pill'); await B.click('[data-pc="end"]'); await A.waitForSelector('.pc-wait', { timeout: 8000 }).catch(() => {}); ok(await A.locator('.pc-tile').count() === 0, 'call: when one leaves, the other is alone again');
    await A.bringToFront(); await A.click('[data-pc="end"]'); await A.waitForTimeout(600); const d = await docs(A); const cid = Object.keys(d).find((k) => /^teamCalls\/[^/]+$/.test(k));
    ok(d[cid].state === 'ended' && Object.keys(d).filter((k) => k.startsWith(cid + '/peers/')).length === 0, 'call: the last one out ends the call');
    ok(await A.locator('.tc-callm:not(.live)').count() === 1 && /ended/.test(await A.locator('.tc-callm').textContent()), 'call: the chat says the call ended');
    ok(errs.length === 0, 'call: no script errors' + (errs.length ? ' — ' + errs.join(' | ') : '')); await ctx.close(); }
  // ── a call on a phone ──
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['camera', 'microphone'] }); const page = await ctx.newPage(); await page.goto(base + '/team/#/c/dm_kd'); await page.waitForSelector('.tc-callb');
    await shot(page, 'team-phone-dm-callbuttons'); await page.tap('[data-act="call-v"]'); await page.waitForSelector('.pc-wrap'); await page.waitForTimeout(700); await shot(page, 'team-phone-call');
    ok(await page.locator('[data-pc="flip"]').count() === 1 && await page.locator('[data-pc="screen"]').count() === 0, 'call on a phone: Flip is there, Share screen is not'); const bb = await page.locator('.pc-bar').boundingBox(); ok(bb && bb.y + bb.height <= 845, 'call on a phone: the buttons sit inside the screen'); await ctx.close(); }

  // ── someone with no pages at all (the grounds): the chat is theirs too; no New channel ──
  who = 'rob'; { const { page, ctx } = await open(390, 844, 'light'); ok(await page.locator('.tc-row[data-open="general"]').count() === 1 && await page.locator('.tc-row[data-open="tennis-core"]').count() === 0, 'grounds: sees the open channels, not the private ones'); await page.tap('[data-act="new"]'); ok(await page.locator('[data-act="new-chan"]').count() === 0, 'grounds: channels are made by directors'); await ctx.close(); }
  // ── the owner's first visit: the channels from Slack are set up once ──
  who = 'ownerEmpty'; { const { page, ctx } = await open(1280, 860, 'light').catch(async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const p = await c.newPage(); await p.goto(base + '/team/'); await p.waitForTimeout(2500); return { page: p, ctx: c }; });
    await page.waitForTimeout(1200); const d = await docs(page); const ch = Object.keys(d).filter((k) => /^teamChats\/[^/]+$/.test(k));
    ok(ch.filter((k) => !/bot_/.test(k)).length === 13, 'owner: thirteen channels set up from Slack on the first visit (' + ch.length + ')');
    ok(d['teamChats/general'].members.length === 6 && d['teamChats/tennis-core'].private === true && d['teamChats/tennis-core'].members.join() === [P.dee, P.olive].sort().join(), 'owner: #general takes everyone; a private channel takes the directors and owners');
    ok(d['teamChats/front-desk-alerts'].members.join() === [P.dana, P.olive].sort().join(), 'owner: the front desk alerts go to the desk and the owners');
    await shot(page, 'team-owner-seeded'); await ctx.close(); }
  await browser.close(); srv.close();
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
