'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const D = require('../lib/dictate'); const { fakeDb } = require('./fake-db');
/* Dictation (Nov 22, 2026). The transcription service is a stand-in. */
const who = { email: 'kim@example.test' }; const audio = Buffer.alloc(4000, 7).toString('base64');
test('dictation: off without a key; a key is saved and never read back; a wrong one is refused', async () => {
  D._useService(null); const db = fakeDb({}); assert.equal(await D.ready(db), false);
  await assert.rejects(() => D.transcribe(db, who, { audio, mime: 'audio/mp4' }), /not switched on/);
  await assert.rejects(() => D.saveKey(db, { email: 'owner@example.test' }, { key: 'hello' }), /does not look like/);
  const out = await D.saveKey(db, { email: 'owner@example.test' }, { key: 'sk-proj-' + 'a'.repeat(40) }); assert.deepEqual(out, { ready: true }); assert.equal(await D.ready(db), true);
});
test('dictation: the words come back; a model the account does not have is skipped; nothing is kept', async () => {
  const db = fakeDb({ 'settings/dictate': { openaiKey: 'sk-proj-' + 'a'.repeat(40) } }); const asked = [];
  D._useService(async (q) => { asked.push(q); return q.model === D.MODELS[0] ? { skip: true } : { text: '  Liam cannot come   on Monday. ' }; });
  try {
    const out = await D.transcribe(db, who, { audio, mime: 'audio/mp4;codecs=mp4a' }); assert.deepEqual(out, { text: 'Liam cannot come on Monday.' });
    assert.deepEqual(asked.map((a) => a.model), [D.MODELS[0], D.MODELS[1]]); assert.equal(asked[1].mime, 'audio/mp4'); assert.equal(asked[1].bytes, 4000);
    assert.ok(![...db._docs.entries()].some(([k, v]) => !k.startsWith('dictateUse/') && !k.startsWith('settings/') || /Liam/.test(JSON.stringify(v))), 'neither the recording nor the words are stored');
    D._useService(async () => ({ skip: true })); await assert.rejects(() => D.transcribe(db, who, { audio, mime: 'audio/mp4' }), /not available on this key/);
    D._useService(async () => ({ text: 'ProWorld Academy, Locker Room' })); assert.equal((await D.transcribe(db, who, { audio, mime: 'audio/webm' })).text, '', 'silence that comes back as the hint is no words');
  } finally { D._useService(null); }
});
test('dictation: too short, too long, an unknown kind of file and too many a day are refused', async () => {
  const db = fakeDb({ 'settings/dictate': { openaiKey: 'sk-proj-' + 'a'.repeat(40) } }); D._useService(async () => ({ text: 'ok' }));
  try {
    await assert.rejects(() => D.transcribe(db, who, { audio: '', mime: 'audio/mp4' }), /Nothing was recorded/);
    await assert.rejects(() => D.transcribe(db, who, { audio: Buffer.alloc(100).toString('base64'), mime: 'audio/mp4' }), /too short/);
    await assert.rejects(() => D.transcribe(db, who, { audio: Buffer.alloc(D.MAX_BYTES + 10).toString('base64'), mime: 'audio/mp4' }), /too long/);
    await assert.rejects(() => D.transcribe(db, who, { audio, mime: 'video/mp4' }), /cannot be read/);
    for (let i = 0; i < D.DAILY; i++) await D.transcribe(db, who, { audio, mime: 'audio/mp4' }); await assert.rejects(() => D.transcribe(db, who, { audio, mime: 'audio/mp4' }), /a lot of dictation/);
    assert.equal((await D.transcribe(db, { email: 'lee@example.test' }, { audio, mime: 'audio/mp4' })).text, 'ok', 'the count is per person');
  } finally { D._useService(null); }
});
