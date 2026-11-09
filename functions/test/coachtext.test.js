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
// the week a text sent now ticks: computed the way the engine does, so the tests do not break when the calendar turns (the rule: never a hard-coded today)
const WK = require('../lib/contacts').weekOf(require('../lib/calendar').todayET(Date.now()));
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
    if (/\/v2\.1\/texts\/new/.test(url)) {
      const body = JSON.parse(o.body); const refuse = typeof opts.refuse === 'function' ? opts.refuse(body) : opts.refuse;
      if (refuse) return { ok: false, status: 400, json: async () => ({ message: refuse }) };
      return ok({ status: 'success', data: [{ id: 'jc-' + captured.length }] });
    }
    if (/slack\.com\/api\/chat\.postMessage/.test(url)) return ok({ ok: true });
    return { ok: false, status: 404, json: async () => ({ error: 'no route ' + url }) };
  };
}
function wire(db, opts) { const captured = []; const f = fakeNet(captured, opts); SMS._useFetch(f); NOTIFY._useFetch(f); CONTACTS._useFetch(f); NOTIFY.forget(); COACHTEXT._usePace(async () => {}); return captured; }
const texts = (net) => net.filter((c) => /texts\/new/.test(c.url)).map((c) => c.body);

test('a coach texts the family from the portal: the academy number, the signature, the record, the week ticked, the inbox row', async () => {
  const db = fakeDb(SEED); const net = wire(db);
  const out = await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'father', body: 'Great session today — see you Saturday' });
  assert.equal(out.ok, true); assert.equal(out.to.slot, 'father'); assert.equal(out.to.tail, '0109'); assert.equal(out.conv, '0109'); assert.equal(out.title, 'Father · Lou Example');
  const call = net.find((c) => /texts\/new/.test(c.url)); assert.ok(call, 'JustCall was called');
  assert.equal(call.body.justcall_number, '+15614030008'); assert.equal(call.body.contact_number, '+15615550109');
  assert.equal(call.body.body, 'Great session today - see you Saturday\n- Coach Kim, ProWorld Academy');   // the dash made plain (GSM-7), signed, no automated footer
  assert.ok(!/Reply here with any question|Sent automatically/.test(call.body.body), 'not the automated footer: the AI on the line steps back for a person');
  const line = [...db._docs.entries()].find(([k, v]) => k.startsWith('smsLog/') && v.from === 'portal'); assert.ok(line, 'a smsLog line');
  assert.equal(line[1].status, 'sent'); assert.equal(line[1].player, 'ft-bo-k'); assert.equal(line[1].to, 'father'); assert.equal(line[1].conv, '0109'); assert.equal(line[1].byName, 'Kim Example'); assert.ok(line[1].justcallId);
  const batch = db._docs.get('smsBatches/' + line[1].batch); assert.equal(batch.template, 'coach'); assert.equal(batch.thread, 'f:ft-bo-k'); assert.equal(batch.counts.sent, 1);
  const tick = db._docs.get('contacts/ft-bo-k_' + WK + ''); assert.ok(tick, 'the week is ticked');
  assert.equal(tick.done, true); assert.equal(tick.source, 'portal'); assert.equal(tick.how, 'text'); assert.equal(tick.who, 'parents'); assert.equal(tick.by, 'Kim');
  assert.deepEqual(out.tick, { week: WK, ticked: true });
  const th = db._docs.get('coachThreads/ft-bo-k'); assert.equal(th.last.dir, 'out'); assert.equal(th.last.by, 'Kim'); assert.ok(th.lastOutAt); assert.ok(!th.lastReplyAt);
  assert.deepEqual(Object.keys(th.convs), ['0109']); assert.equal(th.convs['0109'].title, 'Father · Lou Example'); assert.equal(th.convs['0109'].members[0].slot, 'father');
  // the same week again: already green, left alone
  const again = await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', to: '+15615550100', body: 'And bring the second racket' });
  assert.deepEqual(again.tick, { week: WK, ticked: false, already: true }); assert.equal(again.to.slot, 'mother'); assert.equal(again.conv, '0100');
});

test('a group text: one text per number from the academy line, one chat in the record, the week ticked once', async () => {
  const db = fakeDb(SEED); const net = wire(db);
  const out = await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', conv: '0100+0109', body: 'Bo played great today' });
  assert.equal(out.ok, true); assert.equal(out.conv, '0100+0109'); assert.equal(out.title, 'Mother & Father'); assert.equal(out.sent, 2); assert.equal(out.failed, 0);
  assert.deepEqual(out.to.map((t) => t.slot), ['mother', 'father']); assert.equal(out.lines.length, 2); assert.equal(out.line.conv, '0100+0109');
  assert.deepEqual(texts(net).map((b) => b.contact_number), ['+15615550100', '+15615550109'], 'each parent gets the text as their own');
  assert.ok(texts(net).every((b) => b.body === 'Bo played great today\n- Coach Kim, ProWorld Academy'));
  const lines = [...db._docs.values()].filter((v) => v.from === 'portal'); assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.conv === '0100+0109' && l.batch === lines[0].batch), 'both lines in one chat, one batch');
  assert.deepEqual(lines.map((l) => l.to), ['mother', 'father']);
  const batch = db._docs.get('smsBatches/' + lines[0].batch); assert.equal(batch.counts.total, 2); assert.equal(batch.counts.sent, 2); assert.equal(batch.conv, '0100+0109');
  assert.equal(db._docs.get('contacts/ft-bo-k_' + WK + '').who, 'parents');
  const th = db._docs.get('coachThreads/ft-bo-k'); assert.deepEqual(Object.keys(th.convs), ['0100+0109']); assert.deepEqual(th.convs['0100+0109'].members.map((m) => m.tail), ['0100', '0109']);
  // the same chat by its numbers, and in any order: the same key
  const same = await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', to: ['+15615550109', '+15615550100'], body: 'Practice moves to 4' });
  assert.equal(same.conv, '0100+0109');
  // a number not on the page cannot ride in a group (the whole text is refused, nothing dropped quietly); a chat key the family does not have is refused
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', to: ['+15615550100', '+15615550199'], body: 'hi' }), (e) => e.status === 400 && e.code === 'to');
  assert.equal(texts(net).length, 4, 'nothing went out for the refused one');
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', conv: '0100+0199', body: 'hi' }), (e) => e.status === 400 && e.code === 'to');
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', conv: 'abc', body: 'hi' }), (e) => e.status === 400 && e.code === 'conv');
});

test('a group text where one number fails: the other still goes, the line says which, the week ticks', async () => {
  const db = fakeDb(SEED); const net = wire(db, { refuse: (b) => (b.contact_number === '+15615550109' ? 'Contact has opted out of SMS' : '') });
  const out = await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', conv: '0100+0109', body: 'See you Saturday' });
  assert.equal(out.sent, 1); assert.equal(out.failed, 1); assert.deepEqual(out.lines.map((l) => l.status), ['sent', 'failed']); assert.match(out.lines[1].error, /opted out/);
  assert.equal(texts(net).length, 2); assert.ok(db._docs.get('contacts/ft-bo-k_' + WK + ''), 'ticked: one parent got it');
  assert.equal(db._docs.get('players/ft-bo-k/private/sms').optIn, false, 'the opted-out answer switches the family off, like a one-to-one text');
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
  assert.equal(db._docs.get('contacts/as-di-m_' + WK + '').by, 'Dee');
});

test('JustCall refuses: the line says failed, nothing ticks, the error reaches the page; an opted-out answer switches the family off', async () => {
  const db = fakeDb(SEED); wire(db, { refuse: 'Contact has opted out of SMS' });
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: 'hi' }), (e) => e.status === 502 && /did not take it/.test(e.message));
  const line = [...db._docs.values()].find((v) => v.from === 'portal'); assert.equal(line.status, 'failed'); assert.match(line.error, /opted out/);
  assert.ok(!db._docs.get('contacts/ft-bo-k_' + WK + ''), 'no tick');
  assert.equal(db._docs.get('players/ft-bo-k/private/sms').optIn, false);
  await assert.rejects(COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: 'hi again' }), (e) => e.code === 'optout');
});

test('the thread, chat by chat: a chat per number, the parents together suggested, every line filed; opening a chat marks it read', async () => {
  const db = fakeDb(SEED); wire(db);
  await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: 'See you Saturday' });
  const t = await COACHTEXT.thread(db, KIM, 'ft-bo-k', { conv: '0100' });
  assert.equal(t.player.name, 'Bo Kessler'); assert.equal(t.signature, '- Coach Kim, ProWorld Academy'); assert.equal(t.line.from, '0008');
  assert.deepEqual(t.numbers.map((n) => n.slot + ':' + n.tail + ':' + n.word), ['mother:0100:Mother', 'father:0109:Father']);
  assert.deepEqual(t.convs.map((c) => c.key), ['0100', '0109', '0100+0109'], 'the mother, the father, and the parents together (suggested, empty)');
  assert.deepEqual(t.convs.map((c) => c.title), ['Mother · Pat Example', 'Father · Lou Example', 'Mother & Father']);
  assert.deepEqual(t.convs.map((c) => c.count), [1, 0, 0]); assert.equal(t.convs[2].suggested, true); assert.equal(t.convs[0].last.body, 'See you Saturday');
  assert.deepEqual(t.lines.map((l) => l.dir + ':' + l.conv), ['out:0100'], 'a coach sees only their own conversation: not the desk\'s text, not the answer to it (Nov 6)');
  assert.equal(t.lines[0].portal, true); assert.equal(t.lines[0].to, 'mother');
  const d = await COACHTEXT.thread(db, DIR, 'ft-bo-k', { markRead: false });
  assert.deepEqual(d.lines.map((l) => l.dir + ':' + l.conv), ['out:0100', 'in:0100', 'out:0100'], 'a director sees the whole record: the desk text, the reply, the coach text');
  assert.equal(d.lines[0].by, 'Dana Desk'); assert.equal(d.lines[0].portal, false); assert.equal(d.lines[1].body, 'Thanks, see you Thursday');
  assert.ok(!JSON.stringify(t.lines).includes('+1561') && !JSON.stringify(t.convs).includes('+1561'), 'full numbers are not in the lines or the chats');
  assert.ok(db._docs.get('coachInbox/kim@example.test').read['ft-bo-k|0100'] > 0, 'the mother\'s chat is marked read');
  await assert.rejects(COACHTEXT.thread(db, LEE, 'ft-bo-k'), (e) => e.status === 403);
  const peek = await COACHTEXT.thread(db, KIM, 'ft-bo-k', { conv: '0109', markRead: false }); assert.ok(!db._docs.get('coachInbox/kim@example.test').read['ft-bo-k|0109'], 'a peek marks nothing');
  assert.equal(peek.convs[0].unread, false);
  await assert.rejects(COACHTEXT.markRead(db, KIM, { player: 'ft-bo-k', conv: 'x' }), (e) => e.code === 'conv');
  await COACHTEXT.markRead(db, KIM, { player: 'ft-bo-k', conv: '0109' }); assert.ok(db._docs.get('coachInbox/kim@example.test').read['ft-bo-k|0109'] > 0);
});

test('a reply lands in the chat the family last heard from: the group after a group text, the mother\'s own chat after a direct one', async () => {
  const db = fakeDb(SEED); wire(db);
  await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', conv: '0100+0109', body: 'Both: Bo is ready for the tournament' });
  await new Promise((r) => setTimeout(r, 10));
  db._docs.set('smsLog/r2', { kind: 'reply', at: Date.now(), phone: '+15615550109', body: 'Great news, thanks coach', players: ['ft-bo-k'], by: 'family', status: 'reply', justcallId: 'jc-in-2' });
  const a = await COACHTEXT.onReply(db, { players: ['ft-bo-k'], text: 'Great news, thanks coach', phone: '+15615550109', dry: true });
  assert.equal(a.threads, 1);
  let th = db._docs.get('coachThreads/ft-bo-k'); assert.equal(th.convs['0100+0109'].last.dir, 'in'); assert.ok(th.convs['0100+0109'].lastReplyAt); assert.ok(!th.convs['0109'], 'the father\'s own chat was not touched');
  let t = await COACHTEXT.thread(db, KIM, 'ft-bo-k', { markRead: false });
  const grp = t.convs.find((c) => c.key === '0100+0109'); assert.equal(grp.unread, true); assert.equal(grp.last.body, 'Great news, thanks coach');
  assert.deepEqual(t.lines.filter((l) => l.conv === '0100+0109').map((l) => l.dir), ['out', 'out', 'in'], 'two texts out (one per parent), the father\'s answer, all in the group');
  // then the coach writes to the father alone; his next answer goes to his own chat
  await new Promise((r) => setTimeout(r, 10)); await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', conv: '0109', body: 'Lou, a word about Saturday' });
  await new Promise((r) => setTimeout(r, 10)); db._docs.set('smsLog/r3', { kind: 'reply', at: Date.now(), phone: '+15615550109', body: 'Sure, call me', players: ['ft-bo-k'], by: 'family', status: 'reply', justcallId: 'jc-in-3' });
  await COACHTEXT.onReply(db, { players: ['ft-bo-k'], text: 'Sure, call me', phone: '+15615550109', dry: true });
  th = db._docs.get('coachThreads/ft-bo-k'); assert.equal(th.convs['0109'].last.body, 'Sure, call me'); assert.equal(th.convs['0100+0109'].last.body, 'Great news, thanks coach');
  t = await COACHTEXT.thread(db, KIM, 'ft-bo-k', { markRead: false });
  assert.deepEqual(t.lines.filter((l) => l.conv === '0109').map((l) => l.dir + ':' + l.body.slice(0, 4)), ['out:Lou,', 'in:Sure']);
  // the mother's reply before any text of hers: her own chat
  db._docs.set('smsLog/r4', { kind: 'reply', at: Date.now() + 5, phone: '+15615550101', body: 'Hi, Cy here', players: ['ft-cy-l'], by: 'family', status: 'reply', justcallId: 'jc-in-4' });
  await COACHTEXT.onReply(db, { players: ['ft-cy-l'], text: 'Hi, Cy here', phone: '+15615550101', dry: true });
  assert.deepEqual(Object.keys(db._docs.get('coachThreads/ft-cy-l').convs), ['0101']);
  const ib = await COACHTEXT.inbox(db, KIM);
  assert.deepEqual(ib.rows.map((r) => r.id + '/' + r.conv + '/' + r.unread), ['ft-bo-k/0109/true', 'ft-bo-k/0100+0109/true'], 'one row per chat of Kim\'s own, newest first — not the desk\'s chat with the mother, not Cy\'s mother who wrote before Kim ever texted her');
  assert.equal(ib.unread, 2); assert.equal(ib.unreadFamilies, 1); assert.deepEqual(ib.quiet.map((q) => q.id), ['ft-cy-l']); assert.equal(ib.families, 2);
  assert.equal(ib.rows[1].title, 'Mother & Father'); assert.deepEqual(ib.rows[1].members.map((m) => m.word), ['Mother', 'Father']);
  const dib = await COACHTEXT.inbox(db, DIR); assert.ok(dib.rows.some((r) => r.id === 'ft-cy-l' && r.conv === '0101' && r.unread), 'a director sees Cy\'s mother');
  assert.ok(!JSON.stringify(ib).includes('+1561'), 'no full numbers in the inbox');
});

test('the inbox: a family with no chat yet is listed apart; opening the chat clears its row; a director sees everyone', async () => {
  const db = fakeDb(SEED); wire(db);
  await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'mother', body: 'See you Saturday' });
  await COACHTEXT.thread(db, KIM, 'ft-bo-k', { conv: '0100' });
  await new Promise((r) => setTimeout(r, 15));
  db._docs.set('smsLog/r5', { kind: 'reply', at: Date.now(), phone: '+15615550100', body: 'Can Bo come at 9 instead?', players: ['ft-bo-k'], by: 'family', status: 'reply', justcallId: 'jc-in-5' });   // what the webhook keeps
  await COACHTEXT.onReply(db, { players: ['ft-bo-k'], text: 'Can Bo come at 9 instead?', phone: '+15615550100', dry: true });
  let ib = await COACHTEXT.inbox(db, KIM);
  assert.equal(ib.unread, 1); assert.deepEqual(ib.rows.map((r) => r.id + '/' + r.conv), ['ft-bo-k/0100']); assert.deepEqual(ib.quiet.map((q) => q.id), ['ft-cy-l']);   // Kim's two active players; Lee's and the finished one are not hers
  assert.equal(ib.rows[0].unread, true); assert.equal(ib.rows[0].last.dir, 'in'); assert.equal(ib.rows[0].last.body, 'Can Bo come at 9 instead?'); assert.equal(ib.rows[0].title, 'Mother · Pat Example');
  await new Promise((r) => setTimeout(r, 15)); await COACHTEXT.thread(db, KIM, 'ft-bo-k', { conv: '0100' });
  ib = await COACHTEXT.inbox(db, KIM); assert.equal(ib.unread, 0, 'opening the chat clears it');
  const dir = await COACHTEXT.inbox(db, DIR); assert.equal(dir.rows.length + dir.quiet.length, 6, 'a director sees every active player');
  assert.deepEqual(ib.quiet.map((q) => q.id + '/' + q.quiet + '/' + q.conv), ['ft-cy-l/true/'], 'a family with no texts is a row of its own, ready for a first text'); assert.equal(ib.families, 2);
  // a thread from before chats existed (no convs) is rebuilt from the record: the family's "Yes" is a real chat with their words
  db._docs.set('smsLog/r9', { kind: 'optin', at: Date.now(), phone: '+15615550101', body: 'Yes, we will be there Saturday', players: ['ft-cy-l'], by: 'family', status: 'start' });
  db._docs.set('smsLog/r9b', { kind: 'optin', at: Date.now() + 1, phone: '+15615550101', body: 'Yes, we will be there Saturday', players: ['ft-cy-l'], by: 'family', status: 'start' });   // JustCall's double
  db._docs.set('coachThreads/ft-cy-l', { playerId: 'ft-cy-l', playerName: 'Cy Lane', last: { at: Date.now(), dir: 'in', body: 'Yes, we will be there Saturday', by: 'family' }, lastReplyAt: Date.now() });
  ib = await COACHTEXT.inbox(db, KIM); assert.deepEqual(ib.quiet.map((q) => q.id), ['ft-cy-l'], 'Kim never texted Cy\'s family: their answer to the desk is not hers');
  ib = await COACHTEXT.inbox(db, DIR); const cy = ib.rows.find((r) => r.id === 'ft-cy-l'); assert.ok(cy); assert.equal(cy.conv, '0101'); assert.equal(cy.title, 'Sam Example'); assert.equal(cy.unread, true); assert.equal(cy.last.body, 'Yes, we will be there Saturday');
  assert.ok(db._docs.get('coachThreads/ft-cy-l').convs['0101'], 'the chat is written onto the thread row');
  const t2 = await COACHTEXT.thread(db, DIR, 'ft-cy-l', { conv: '0101' });
  assert.deepEqual(t2.lines.map((l) => l.dir + ':' + l.body + ':' + (l.note || '')), ['in:Yes, we will be there Saturday:texts on'], 'their words once, as an answer, with the texts-on note');
  assert.equal((await COACHTEXT.inbox(db, DIR)).rows.find((r) => r.id === 'ft-cy-l').unread, false, 'opening the rebuilt chat clears it');
});

test('a reply tells the coach on Slack once, even when two siblings share the number; the inbox row carries it', async () => {
  const db = fakeDb(SEED); const net = wire(db);
  const out = await COACHTEXT.onReply(db, { players: ['as-di-m', 'as-ed-m'], text: 'We are running late', phone: '+15615550103' });
  assert.equal(out.threads, 2); assert.equal(out.dms, 1); assert.deepEqual(out.coaches, ['Lee']);
  const dm = net.find((c) => /chat\.postMessage/.test(c.url)); assert.equal(dm.body.channel, 'U_LEE');
  assert.match(dm.body.text, /^Di M\.'s family wrote back: "We are running late" Answer from the portal: https:\/\/proworld-coach-portal\.web\.app\/portal#\/messages\/as-di-m\/0103$/);
  assert.equal(db._docs.get('coachThreads/as-ed-m').last.dir, 'in'); assert.ok(db._docs.get('coachThreads/as-ed-m').lastReplyAt); assert.equal(db._docs.get('coachThreads/as-ed-m').convs['0103'].last.body, 'We are running late');
  assert.deepEqual(await COACHTEXT.onReply(db, { players: [], text: 'x' }), { threads: 0, dms: 0, coaches: [] });
  // in a group chat the DM says which parent wrote
  await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', conv: '0100+0109', body: 'Both: a note' });
  const r = await COACHTEXT.onReply(db, { players: ['ft-bo-k'], text: 'From Lou', phone: '+15615550109' });
  const dm2 = net.filter((c) => /chat\.postMessage/.test(c.url)).pop(); assert.equal(r.dms, 1); assert.match(dm2.body.text, /^Bo K\.'s family wrote back \(father\): "From Lou" Answer from the portal: .*#\/messages\/ft-bo-k\/0100\+0109$/);
});

test('the JustCall webhook keeps a reply from the father\'s number too (the phone book), so it reaches the coach', async () => {
  const db = fakeDb(SEED); wire(db);
  const ts = String(Math.floor(Date.now() / 1000)); const url = 'https://proworld-coach-portal.web.app/api/sms/webhook';
  const body = { webhook_url: url, type: 'sms.received', data: { id: 'jc-in-9', contact_number: '+15615550109', direction: 'Incoming', sms_info: { body: 'This is Lou, Bo is sick today' } } };
  const sig = crypto.createHmac('sha256', 's').update(`s|${encodeURIComponent(url)}|sms.received|${ts}`).digest('hex');
  const out = await SMS.webhook(db, { 'x-justcall-signature': sig, 'x-justcall-request-timestamp': ts }, body);
  assert.match(out.did, /^reply kept for 1 player/); assert.deepEqual(out.players, ['ft-bo-k']);
  const kept = [...db._docs.values()].find((v) => v.kind === 'reply' && v.justcallId === 'jc-in-9'); assert.ok(kept); assert.deepEqual(kept.players, ['ft-bo-k']);
  const t = await COACHTEXT.thread(db, DIR, 'ft-bo-k'); const last = t.lines[t.lines.length - 1]; assert.equal(last.body, 'This is Lou, Bo is sick today'); assert.equal(last.tail, '0109'); assert.equal(last.conv, '0109', 'never texted: his own chat');
});

test('every coach on their own JustCall number: texts go out from it, the chats show only what is on it, a reply to it lands there (Nov 6)', async () => {
  const db = fakeDb(Object.assign({}, SEED, { 'staff/kim@example.test': Object.assign({}, SEED['staff/kim@example.test'], { justcallNumber: '+15615557777' }) }));
  const net = wire(db); const KIMN = Object.assign({}, KIM, { justcallNumber: '+15615557777' });
  // a text Lee once sent from the academy line, and a reply to it: not Kim's
  db._docs.set('smsLog/x1', { at: Date.now() - 5000, by: 'lee@example.test', byName: 'Lee Example', player: 'ft-cy-l', phone: '+15615550101', body: 'Lee here', status: 'sent', from: 'portal', line: '+15614030008', conv: '0101' });
  const out = await COACHTEXT.text(db, KIMN, { player: 'ft-bo-k', slot: 'mother', body: 'Kim here, from my number' });
  assert.equal(texts(net)[0].justcall_number, '+15615557777', 'from the coach\'s own number, not the academy line');
  assert.equal([...db._docs.values()].find((v) => v.body && String(v.body).startsWith('Kim here')).line, '+15615557777');
  await new Promise((r) => setTimeout(r, 5));
  db._docs.set('smsLog/rk', { kind: 'reply', at: Date.now(), phone: '+15615550100', body: 'Got it Kim', players: ['ft-bo-k'], by: 'family', status: 'reply', justcallId: 'jc-k', line: '+15615557777' });
  db._docs.set('smsLog/rd', { kind: 'reply', at: Date.now() + 1, phone: '+15615550100', body: 'To the desk', players: ['ft-bo-k'], by: 'family', status: 'reply', justcallId: 'jc-d', line: '+15614030008' });
  const t = await COACHTEXT.thread(db, KIMN, 'ft-bo-k', { markRead: false });
  assert.deepEqual(t.lines.map((l) => l.dir + ':' + l.body.split('\n')[0]), ['out:Kim here, from my number', 'in:Got it Kim'], 'only the lines on Kim\'s number');
  assert.equal(t.line.from, '7777'); assert.equal(t.line.own, true);
  const ib = await COACHTEXT.inbox(db, KIMN);
  assert.deepEqual(ib.rows.map((r) => r.id + '/' + r.conv + '/' + r.last.body), ['ft-bo-k/0100/Got it Kim']); assert.deepEqual(ib.quiet.map((q) => q.id), ['ft-cy-l'], 'Lee\'s text to Cy is not on Kim\'s number'); assert.equal(ib.line, '7777');
  // a director still sees the whole record
  const d = await COACHTEXT.thread(db, DIR, 'ft-bo-k', { markRead: false }); assert.ok(d.lines.some((l) => l.body === 'To the desk'));
});

test('the coach\'s number from their JustCall seat when the staff record has none; the webhook keeps the number a family wrote to', async () => {
  const db = fakeDb(SEED); const net = wire(db); COACHTEXT._seats({ 'kim@example.test': '+15615558888' });
  await COACHTEXT.text(db, KIM, { player: 'ft-bo-k', slot: 'father', body: 'From the seat' });
  assert.equal(texts(net)[0].justcall_number, '+15615558888');
  COACHTEXT._seats({});
  const ts = String(Math.floor(Date.now() / 1000)); const url = 'https://proworld-coach-portal.web.app/api/sms/webhook';
  const body = { webhook_url: url, type: 'sms.received', data: { id: 'jc-in-77', contact_number: '+15615550109', justcall_number: '+15615558888', direction: 'Incoming', sms_info: { body: 'Thanks Kim' } } };
  const sig = crypto.createHmac('sha256', 's').update(`s|${encodeURIComponent(url)}|sms.received|${ts}`).digest('hex');
  await SMS.webhook(db, { 'x-justcall-signature': sig, 'x-justcall-request-timestamp': ts }, body);
  const kept = [...db._docs.values()].find((v) => v.kind === 'reply' && v.justcallId === 'jc-in-77'); assert.equal(kept.line, '+15615558888');
  assert.deepEqual(COACHTEXT.scopeLines(KIM, '+15615558888', [{ line: '+15615558888' }, { line: '+15614030008' }], [kept]).outs.length, 1);
});

test('a reply to a coach\'s own number tells only that coach, not the other coach on the record', async () => {
  const db = fakeDb(Object.assign({}, SEED, { 'staff/lee@example.test': Object.assign({}, SEED['staff/lee@example.test'], { justcallNumber: '+15615556666' }) }));
  const net = wire(db); COACHTEXT._seats({});
  const r = await COACHTEXT.onReply(db, { players: ['ft-cy-l'], text: 'For Lee', phone: '+15615550101', line: '+15615556666' });   // Cy: coach Kim, second coach Lee
  assert.deepEqual(r.coaches, ['Lee']); assert.equal(net.filter((c) => /chat\.postMessage/.test(c.url)).length, 1);
});
