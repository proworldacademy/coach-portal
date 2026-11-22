'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const A = require('../lib/assistant');
const C = require('../lib/coachcal');
const { fakeDb } = require('./fake-db');

/* Ask ProWorld (Nov 21, 2026). Invented people; Claude is a stand-in that answers what the test hands it. */
const DAY = '2027-03-01';   // a Monday
const seed = () => ({
  'players/p1': { name: 'Ada Example', coach: 'Nico', status: 'active', enroll: { days: ['Mon'], pbp: { time: '04:00 PM-06:00 PM' } } },
  'backend/state': { blocks: [], exceptions: [], bookings: [], privates: [] },
  'settings/ai': { anthropicKey: 'sk-ant-test' }
});
const who = { email: 'parent@example.test', name: 'Pat Parent' }; const players = [{ id: 'p1', name: 'Ada Example', coach: 'Nico' }];
const says = (o) => A._useModel(async () => JSON.stringify(o));

test('assistant: the facts come from the catalog, and a private never gets a price', () => {
  const f = A.facts('2026-11-21'); assert.ok(f.progs.length >= 4 && f.progs.some((l) => /a month/.test(l)));
  assert.ok(f.camps.some((l) => /\[tg/.test(l) && /Thanksgiving/.test(l)) && f.camps.some((l) => /Winter Camp/.test(l)));
  assert.equal(A.facts('2027-06-01').camps.length, 0, 'a camp that is over is not offered');
  const p = A.prompt('2026-11-21', { h: 17.5 }, { name: 'Ada Example' }, { name: 'Ada', program: '10 & Under', makeups: 1, makeupsUntil: '2026-11-30' }, { tennis: ['Nico'], fitness: ['Tara'], mental: [] });
  assert.match(p, /never state a price for a private/); assert.match(p, /Saturday, 2026-11-21, 5:30 PM/); assert.match(p, /Make-up sessions to use: 1 \(they expire 2026-11-30\)/); assert.match(p, /never mention any other child or family/);
});

test('assistant: what Claude sends back is read even when it is wrapped, cut or not JSON', () => {
  assert.deepEqual(A.parse('{"reply":"Saturday is 9 to 10:30.","action":null}'), { reply: 'Saturday is 9 to 10:30.', action: null });
  assert.deepEqual(A.parse('Here you go:\n{"reply":"Ok {really}","action":{"type":"away","date":"2027-03-01"}} thanks'), { reply: 'Ok {really}', action: { type: 'away', date: '2027-03-01' } });
  assert.equal(A.parse('Just words.').reply, 'Just words.'); assert.equal(A.parse('{"reply":"Cut off in the mid').action, null);
});

test('assistant: names, e-mails and numbers are taken out of what is kept for the weekly review', () => {
  assert.equal(A.scrub('Ada cannot come, call Pat on (561) 555-0100 or pat@example.test', ['Pat', 'Parent', 'Ada', 'Example']), '[name] cannot come, call [name] on [number] or [e-mail]');
});

test('assistant: a private comes back as a card with the coach\'s real open times, 24 hours ahead, and nothing is booked', async () => {
  const db = fakeDb(seed()); C._clock(() => Date.parse('2027-02-20T15:00:00Z'));
  try {
    says({ reply: 'Coach Nico is open Monday morning. Pick a time and a court.', action: { type: 'private', kind: 'tennis', date: DAY, coach: '', part: 'morning' } });
    const o = await A.ask(db, who, { player: 'p1', message: 'Book a tennis private with her coach on Monday morning', context: { name: 'Ada' } }, players);
    assert.equal(o.card.type, 'private'); assert.equal(o.card.coach, 'nico'); assert.equal(o.card.coachName, 'Nico'); assert.equal(o.card.date, DAY);
    assert.ok(o.card.slots.length > 0 && o.card.slots.length <= 8 && o.card.slots.every((s) => s.start < 12), 'only the morning she asked for');
    assert.ok(![...db._docs.keys()].some((k) => k.startsWith('familyPrivates/') || k.startsWith('courtHolds/')), 'the card books nothing');
    // a day inside the 24 hours: the next open days instead, and the words say why
    C._clock(() => Date.parse('2027-02-28T22:00:00Z'));
    says({ reply: 'Here are the times.', action: { type: 'private', kind: 'tennis', date: '2027-02-28', coach: 'Nico', part: 'any' } });
    const t = await A.ask(db, who, { player: 'p1', message: 'a private today' }, players);
    assert.equal(t.card.slots.length, 0); assert.ok(t.card.next.length >= 1 && t.card.next[0].date === DAY); assert.match(t.reply, /24 hours ahead/);
    // kept for the review, without names
    const log = [...db._docs.entries()].filter(([k]) => k.startsWith('assistantLog/')).map(([, v]) => v); assert.equal(log.length, 2); assert.equal(log[0].action, 'private'); assert.ok(!/Ada|Pat/.test(JSON.stringify(log)));
  } finally { C._clock(null); A._useModel(null); }
});

test('assistant: only actions that hold up become cards; a past day, an unknown camp or an empty request do not', async () => {
  const db = fakeDb(seed()); C._clock(() => Date.parse('2026-11-21T15:00:00Z'));
  try {
    const ask = async (action) => { says({ reply: 'x', action }); return (await A.ask(db, who, { player: 'p1', message: 'q' }, players)).card; };
    assert.deepEqual(await ask({ type: 'away', date: '2026-11-23' }), { type: 'away', player: 'p1', date: '2026-11-23' });
    assert.equal(await ask({ type: 'away', date: '2026-11-01' }), null, 'a day that has passed');
    assert.equal(await ask({ type: 'makeup', date: 'next week' }), null);
    assert.deepEqual(await ask({ type: 'camp', id: 'tgu10' }), { type: 'camp', id: 'tgu10', title: 'Thanksgiving Camp 2026', dates: 'Nov 23–27' });
    assert.equal((await ask({ type: 'camp', id: 'nope' })).id, 'tg13', 'an unknown camp opens the next one');
    assert.deepEqual(await ask({ type: 'admin', subject: 'Invoice for November', text: 'Could I get an invoice for November?' }), { type: 'admin', player: 'p1', kind: 'invoice', subject: 'Invoice for November', text: 'Could I get an invoice for November?' });
    assert.equal(await ask({ type: 'admin', subject: 'x', text: '' }), null); assert.equal(await ask({ type: 'open', where: 'the vault' }), null); assert.deepEqual(await ask({ type: 'open', where: 'billing' }), { type: 'open', where: 'billing' });
    assert.equal(await ask({ type: 'refund', amount: 100 }), null, 'something it was never offered');
    await assert.rejects(() => A.ask(db, who, { player: 'someone-else', message: 'q' }, players), /Which player/);
    await assert.rejects(() => A.ask(db, who, { player: 'p1', message: '  ' }, players), /Type your question/);
  } finally { C._clock(null); A._useModel(null); }
});

test('assistant: one family asks at most forty questions a day, and without a key it says it is not on', async () => {
  const db = fakeDb(seed()); says({ reply: 'ok', action: null });
  try { for (let i = 0; i < A.DAILY; i++) await A.ask(db, who, { player: 'p1', message: 'q' }, players); await assert.rejects(() => A.ask(db, who, { player: 'p1', message: 'q' }, players), /a lot of questions/); } finally { A._useModel(null); }
  const IDEAS = require('../lib/ideas'); assert.equal(await A.ready(fakeDb(seed())), true);
  const off = fakeDb({ 'settings/ai': {} }); await IDEAS.settings(off, true); assert.equal(await A.ready(off), false);
  await assert.rejects(() => A.ask(off, who, { player: 'p1', message: 'q' }, players), /not switched on/); await IDEAS.settings(fakeDb(seed()), true);
});

test('assistant: it remembers what this parent asked about this player for 90 days, and never for another player', async () => {
  const BRAIN = require('../lib/brain'); BRAIN._reset(); const db = fakeDb(seed()); const two = players.concat([{ id: 'p2', name: 'Bo Example', coach: 'Nico' }]); const seen = [];
  A._useModel(async ({ system }) => { seen.push(system); return JSON.stringify({ reply: 'Saturday is 9 to 10:30.', action: null }); });
  try {
    let t = Date.parse('2026-11-21T15:00:00Z'); A._clock(() => t);
    await A.ask(db, who, { player: 'p1', message: 'What time is Saturday training?' }, two); assert.ok(!/ASKED ABOUT THIS PLAYER BEFORE/.test(seen[0]), 'nothing to remember the first time');
    t += 3 * 864e5; await A.ask(db, who, { player: 'p1', message: 'And Sunday?' }, two);
    assert.match(seen[1], /ASKED ABOUT THIS PLAYER BEFORE \(the last 90 days/); assert.match(seen[1], /\d{4}-\d{2}-\d{2}: asked "What time is Saturday training\?"; you said "Saturday is 9 to 10:30\."/);
    await A.ask(db, who, { player: 'p2', message: 'Any camps?' }, two); assert.ok(!/Saturday training/.test(seen[2]), 'a brother or sister starts with no memory of the other');
    await A.ask(db, { email: 'other@example.test', name: 'Someone Else' }, { player: 'p1', message: 'Hello there' }, two); assert.ok(!/Saturday training/.test(seen[3]), 'another parent has their own');
    t += 91 * 864e5; await A.ask(db, who, { player: 'p1', message: 'Still there?' }, two); assert.ok(!/Saturday training|And Sunday/.test(seen[4]), 'after 90 days it is gone');
    assert.equal((await A.recall(db, who.email, 'p1', t)).length, 1); await A.forget(db, who, two); assert.equal((await A.recall(db, who.email, 'p1', t)).length, 0, 'the parent can clear it');
  } finally { A._clock(null); A._useModel(null); }
});

test('one brain: notes and taught answers reach every assistant; what it could not answer waits for an owner, once', async () => {
  const BRAIN = require('../lib/brain'); BRAIN._reset(); const db = fakeDb(seed()); const owner = { email: 'owner@example.test', owner: true }; const seen = [];
  try {
    A._useModel(async ({ system }) => { seen.push(system); return JSON.stringify({ reply: 'I am not sure. Admin can tell you.', action: null, unknown: true }); });
    await A.ask(db, who, { player: 'p1', message: 'Does Ada need her own balls, says Pat?', context: { name: 'Ada' } }, players);
    await A.ask(db, who, { player: 'p1', message: 'does ada need her own balls, says pat' }, players);
    let v = await BRAIN.view(db); assert.equal(v.open.length, 1, 'the same question is kept once'); assert.equal(v.open[0].n, 2); assert.equal(v.open[0].q, 'Does [name] need her own balls, says [name]?'); assert.equal(v.open[0].src, 'app');
    v = await BRAIN.admin(db, owner, { action: 'teach', id: v.open[0].id, q: 'Do players bring their own balls?', a: 'No. The academy provides the balls.' }); assert.equal(v.open.length, 0); assert.equal(v.learned.length, 1);
    await BRAIN.admin(db, owner, { action: 'save', notes: 'The pro shop opens at 8 AM on weekdays.' });
    const text = BRAIN.text(await BRAIN.get(db, true), '2026-11-21');
    assert.match(text, /PROGRAMS AND PRICES/); assert.match(text, /Thanksgiving/); assert.match(text, /NOTES FROM MANAGEMENT[^]*pro shop opens at 8 AM/); assert.match(text, /Q: Do players bring their own balls\?\n  A: No\. The academy provides the balls\./);
    A._useModel(async ({ system }) => { seen.push(system); return JSON.stringify({ reply: 'No. The academy provides the balls.', action: null }); });
    await A.ask(db, who, { player: 'p1', message: 'Does she need balls?' }, players); assert.match(seen[2], /The academy provides the balls/); assert.match(seen[2], /pro shop opens at 8 AM/);
    await BRAIN.wonder(db, 'Is there parking for visitors?', 'web'); v = await BRAIN.view(db); assert.equal(v.open[0].src, 'web');
    v = await BRAIN.admin(db, owner, { action: 'forget', id: v.learned[0].id }); assert.equal(v.learned.length, 0);
    await assert.rejects(() => BRAIN.admin(db, owner, { action: 'save', notes: 'x'.repeat(6001) }), /too long/); await assert.rejects(() => BRAIN.admin(db, owner, { action: 'teach', q: 'q', a: '' }), /question and the answer/);
  } finally { A._useModel(null); BRAIN._reset(); }
});
