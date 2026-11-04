'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const COACHTEXT = require('../lib/coachtext');
const SMS = require('../lib/sms');
const NOTIFY = require('../lib/notify');
const CONTACTS = require('../lib/contacts');
const { fakeDb } = require('./fake-db');

/* Invented families and staff only. "Now" is Thu Nov 5, 2026, 3 PM Delray Beach (the week of Mon Nov 2). */
const NOW = Date.UTC(2026, 10, 5, 20, 0, 0);
const KIM = { uid: 'u-kim', email: 'kim@example.test', name: 'Kim Example', firstName: 'Kim', coachAs: 'Kim', keys: ['kim'], role: 'coach', owner: false, admin: false, director: false };
const LEE = { uid: 'u-lee', email: 'lee@example.test', name: 'Lee Example', firstName: 'Lee', coachAs: '', keys: ['lee'], role: 'coach', owner: false, admin: false, director: false };
const DIR = { uid: 'u-dir', email: 'dir@example.test', name: 'Dee Director', firstName: 'Dee', coachAs: '', keys: ['dee'], role: 'director', owner: false, admin: false, director: true };
const SEED = {
  'settings/notify': { justcallKey: 'k', justcallSecret: 's', justcallNumber: '+15614030008', textsOn: true, slackBotToken: 'xoxb-test' },
  'staff/kim@example.test': { email: 'kim@example.test', name: 'Kim Example', coachAs: 'Kim', role: 'coach', active: true, slackId: 'U_KIM' },
  'staff/lee@example.test': { email: 'lee@example.test', name: 'Lee Example', role: 'coach', active: true, slackId: 'U_LEE' },
  'players/ft-bo-k': { name: 'Bo Kessler', group: 'ft', coach: 'Kim', status: 'active' },
  'players/ft-cy-l': { name: 'Cy Lane', group: 'ft', coach: 'Kim', coach2: 'Lee', status: 'active' },
  'players/as-di-m': { name: 'Di Moreau', group: 'as', coach: 'Lee', status: 'active' },
  'players/as-ed-m': { name: 'Ed Moreau', group: 'as', coach: 'Lee', status: 'active' },        // Di's brother: the same mother
  'players/as-no-n': { name: 'No Number', group: 'as', coach: 'Lee', status: 'active' },
  'players/as-st-o': { name: 'Stopped Out', group: 'as', coach: 'Lee', status: 'active' },
  'players/past-gus': { name: 'Gus Vale', group: 'as', coach: 'Lee', status: 'finished' },
  'players/ft-bo-k/private/contact': { guardian: 'Pat Example', phone: '(561) 555-0100', phone2: '(561) 555-0109', email: 'pat@example.test' },
  'players/ft-cy-l/private/contact': { guardian: 'Sam Example', phone: '(561) 555-0101' },
  'players/as-di-m/private/contact': { guardian: 'Mo Example', phone: '(561) 555-0103' },
  'players/as-ed-m/private/contact': { guardian: 'Mo Example', phone: '(561) 555-0103' },
  'players/as-st-o/private/contact': { guardian: 'Stu Example', phone: '(561) 555-0105' },
  'players/as-st-o/private/sms': { optIn: false, source: 'stop', phone: '+15615550105' },
  'contactCheck/ft-bo-k': { playerId: 'ft-bo-k', playerName: 'Bo Kessler', slots: { mother: { state: 'ok', phone: '+15615550100', name: 'Pat Example', from: 'file' }, father: { state: 'ok', phone: '+15615550109', name: 'Lou Example', from: 'coach' }, guardian: { state: 'na' }, player: { state: 'na' } }, onFile: [{ phone: '+15615550100', name: 'Pat Example', source: 'contact' }, { phone: '+15615550109', name: '', source: 'contact' }] },
  // the front desk texted Bo's family on Tuesday; the family answered on Wednesday
  'smsBatches/b1': { at: NOW - 2 * 864e5, by: 'desk@example.test', byName: 'Dana Desk', text: 'Rain today', template: 'rain', state: 'done', counts: { total: 1, sent: 1, failed: 0, skipped: 0, queued: 0 } },
  'smsLog/l1': { batch: 'b1', at: NOW - 2 * 864e5, by: 'desk@example.test', byName: 'Dana Desk', player: 'ft-bo-k', playerName: 'Bo Kessler', group: 'ft', coach: 'Kim', phone: '+15615550100', body: 'Rain today\n- ProWorld Academy. Reply here with any question.', status: 'sent', justcallId: 'jc-desk-1', delivery: 'delivered' },
  'smsLog/r1': { kind: 'reply', at: NOW - 864e5, phone: '+15615550100', body: 'Thanks, see you Thursday', players: ['ft-bo-k'], by: 'family', status: 'reply', justcallId: 'jc-in-1' }
};
function fakeNet(captured, opts) {
  opts = opts || {};
  return async (url, o) => {
    captured.push({ url, opts: o, body: o && o.body ? JSON.parse(o.body) : null });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (/\/v2\.1\/texts\/new/.test(url)) { if (opts.refuse) return { ok: false, status: 400, json: async () => ({ message: opts.refuse }) }; return ok({ status: 'success', data: [{ id: 'jc-' + captured.length }] }); }
    if (/slack\.com\/api\/chat\.postMessage/.test(url)) return ok({ ok: true });
    return { ok: false, status: 404, json: async () => ({ error: 'no route ' + url }) };
  };
}
function wire(db, opts) { const captured = []; const f = fakeNet(captured, opts); SMS._useFetch(f); NOTIFY._useFetch(f); CONTACTS._useFetch(f); NOTIFY.forget(); return captured; }

test('a coach texts the family from the portal: the academy number, the signature, the record, the week ticked, the inbox row', async () => {
  const db = fakeDb(SEED); const net = wire(db);
  const out = await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'father', body: 'Great session today — see you Saturday' });
  assert.equal(out.ok, true); assert.equal(out.to.slot, 'father'); assert.equal(out.to.tail, '0109');
  const call = net.find((c) => /texts\/new/.test(c.url)); assert.ok(call, 'JustCall was called');
  assert.equal(call.body.justcall_number, '+15614030008'); assert.equal(call.body.contact_number, '+15615550109');
  assert.equal(call.body.body, 'Great session today - see you Saturday\n- Coach Kim, ProWorld Academy');   // the dash made plain (GSM-7), signed, no automated footer
  assert.ok(!/Reply here with any question|Sent automatically/.test(call.body.body), 'not the automated footer: the AI on the line steps back for a person');
  const line = [...db._docs.entries()].find(([k, v]) => k.startsWith('smsLog/') && v.from === 'portal'); assert.ok(line, 'a smsLog line');
  assert.equal(line[1].status, 'sent'); assert.equal(line[1].player, 'ft-bo-k'); assert.equal(line[1].to, 'father'); assert.equal(line[1].byName, 'Kim Example'); assert.ok(line[1].justcallId);
  const batch = db._docs.get('smsBatches/' + line[1].batch); assert.equal(batch.template, 'coach'); assert.equal(batch.thread, 'f:ft-bo-k'); assert.equal(batch.counts.sent, 1);
  const tick = db._docs.get('contacts/ft-bo-k_2026-11-02'); assert.ok(tick, 'the week is ticked');
  assert.equal(tick.done, true); assert.equal(tick.source, 'portal'); assert.equal(tick.how, 'text'); assert.equal(tick.who, 'parents'); assert.equal(tick.by, 'Kim');
  assert.deepEqual(out.tick, { week: '2026-11-02', ticked: true });
  const th = db._docs.get('coachThreads/ft-bo-k'); assert.equal(th.last.dir, 'out'); assert.equal(th.last.by, 'Kim'); assert.ok(th.lastOutAt); assert.ok(!th.lastReplyAt);
  // the same week again: already green, left alone
  const again = await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', to: '+15615550100', body: 'And bring the second racket' });
  assert.deepEqual(again.tick, { week: '2026-11-02', ticked: false, already: true }); assert.equal(again.to.slot, 'mother');
});

test('only the player\'s own coach or a director; only a number on the page; a family that said STOP is not texted', async () => {
  const db = fakeDb(SEED); wire(db);
  await assert.rejects(COACHTEXT.text(db, LEE, { player: 'ft-bo-k', slot: 'mother', body: 'hi' }), (e) => e.status === 403 && e.code === 'own');
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', to: '+15615550199', body: 'hi' }), (e) => e.status === 400 && e.code === 'to');
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: '   ' }), (e) => e.status === 400 && e.code === 'body');
  await assert.rejects(COACHTEXT.text(db, LEE, { player: 'as-no-n', slot: 'mother', body: 'hi' }), (e) => e.status === 409 && e.code === 'numbers');
  await assert.rejects(COACHTEXT.text(db, LEE, { player: 'as-st-o', to: '+15615550105', body: 'hi' }), (e) => e.status === 403 && e.code === 'optout' && /STOP/.test(e.message));
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'nobody', slot: 'mother', body: 'hi' }), (e) => e.status === 404);
  const d = await COACHTEXT.text(db, DIR, { player: 'as-di-m', to: '+15615550103', body: 'From the director' }); assert.equal(d.ok, true);   // a director reaches every player
  const c2 = await COACHTEXT.text(db, LEE, { player: 'ft-cy-l', to: '+15615550101', body: 'Second coach here' }); assert.equal(c2.ok, true);   // coach2 counts too
  assert.equal(db._docs.get('contacts/as-di-m_2026-11-02').by, 'Dee');
});

test('JustCall refuses: the line says failed, nothing ticks, the error reaches the page; an opted-out answer switches the family off', async () => {
  const db = fakeDb(SEED); wire(db, { refuse: 'Contact has opted out of SMS' });
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: 'hi' }), (e) => e.status === 502 && /did not take it/.test(e.message));
  const line = [...db._docs.values()].find((v) => v.from === 'portal'); assert.equal(line.status, 'failed'); assert.match(line.error, /opted out/);
  assert.ok(!db._docs.get('contacts/ft-bo-k_2026-11-02'), 'no tick');
  assert.equal(db._docs.get('players/ft-bo-k/private/sms').optIn, false);
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: 'hi again' }), (e) => e.code === 'optout');
});

test('the thread: what the family got and what they answered, in order, marked read; the inbox: new replies first', async () => {
  const db = fakeDb(SEED); wire(db);
  await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: 'See you Saturday' });
  const t = await COACHTEXT.thread(db, KIM, 'ft-bo-k');
  assert.equal(t.player.name, 'Bo Kessler'); assert.equal(t.signature, '- Coach Kim, ProWorld Academy'); assert.equal(t.line.from, '0008');
  assert.deepEqual(t.numbers.map((n) => n.slot + ':' + n.tail + ':' + n.word), ['mother:0100:Mother', 'father:0109:Father']);
  assert.deepEqual(t.lines.map((l) => l.dir), ['out', 'in', 'out']);
  assert.equal(t.lines[0].by, 'Dana Desk'); assert.equal(t.lines[0].portal, false); assert.equal(t.lines[1].body, 'Thanks, see you Thursday'); assert.equal(t.lines[2].portal, true); assert.equal(t.lines[2].to, 'mother');
  assert.ok(!t.lines.some((l) => /\+1561/.test(JSON.stringify(l))), 'full numbers are not in the lines');
  assert.ok(db._docs.get('coachInbox/kim@example.test').read['ft-bo-k'] > 0, 'marked read');
  await assert.rejects(COACHTEXT.thread(db, LEE, 'ft-bo-k'), (e) => e.status === 403);
  // the family writes again after the coach read the thread → unread in the inbox, first in the list
  await new Promise((r) => setTimeout(r, 15)); await COACHTEXT.onReply(db, { players: ['ft-bo-k'], text: 'Can Bo come at 9 instead?', dry: true });
  const ib = await COACHTEXT.inbox(db, KIM);
  assert.equal(ib.unread, 1); assert.deepEqual(ib.rows.map((r) => r.id), ['ft-bo-k', 'ft-cy-l']);   // Kim's two active players; Lee's and the finished one are not hers
  assert.equal(ib.rows[0].unread, true); assert.equal(ib.rows[0].last.dir, 'in'); assert.equal(ib.rows[0].last.body, 'Can Bo come at 9 instead?'); assert.equal(ib.rows[1].last, null);
  await new Promise((r) => setTimeout(r, 15)); await COACHTEXT.thread(db, KIM, 'ft-bo-k');
  assert.equal((await COACHTEXT.inbox(db, KIM)).unread, 0, 'opening the thread clears it');
  const dir = await COACHTEXT.inbox(db, DIR); assert.equal(dir.rows.length, 6, 'a director sees every active player');
});

test('a reply tells the coach on Slack once, even when two siblings share the number; the inbox row carries it', async () => {
  const db = fakeDb(SEED); const net = wire(db);
  const out = await COACHTEXT.onReply(db, { players: ['as-di-m', 'as-ed-m'], text: 'We are running late' });
  assert.equal(out.threads, 2); assert.equal(out.dms, 1); assert.deepEqual(out.coaches, ['Lee']);
  const dm = net.find((c) => /chat\.postMessage/.test(c.url)); assert.equal(dm.body.channel, 'U_LEE');
  assert.match(dm.body.text, /^Di M\.'s family wrote back: "We are running late" Answer from the portal: https:\/\/proworld-coach-portal\.web\.app\/portal#\/p\/as-di-m$/);
  assert.equal(db._docs.get('coachThreads/as-ed-m').last.dir, 'in'); assert.ok(db._docs.get('coachThreads/as-ed-m').lastReplyAt);
  assert.deepEqual(await COACHTEXT.onReply(db, { players: [], text: 'x' }), { threads: 0, dms: 0, coaches: [] });
});

test('the JustCall webhook keeps a reply from the father\'s number too (the phone book), so it reaches the coach', async () => {
  const db = fakeDb(SEED); wire(db);
  const ts = String(Math.floor(Date.now() / 1000)); const url = 'https://proworld-coach-portal.web.app/api/sms/webhook';
  const body = { webhook_url: url, type: 'sms.received', data: { id: 'jc-in-9', contact_number: '+15615550109', direction: 'Incoming', sms_info: { body: 'This is Lou, Bo is sick today' } } };
  const sig = crypto.createHmac('sha256', 's').update(`s|${encodeURIComponent(url)}|sms.received|${ts}`).digest('hex');
  const out = await SMS.webhook(db, { 'x-justcall-signature': sig, 'x-justcall-request-timestamp': ts }, body);
  assert.match(out.did, /^reply kept for 1 player/); assert.deepEqual(out.players, ['ft-bo-k']);
  const kept = [...db._docs.values()].find((v) => v.kind === 'reply' && v.justcallId === 'jc-in-9'); assert.ok(kept); assert.deepEqual(kept.players, ['ft-bo-k']);
  const t = await COACHTEXT.thread(db, KIM, 'ft-bo-k'); assert.equal(t.lines[t.lines.length - 1].body, 'This is Lou, Bo is sick today'); assert.equal(t.lines[t.lines.length - 1].tail, '0109');
});
