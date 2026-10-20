/* Removing a record the engine filed — a test enrollment, or one made by mistake. Owners only, from the player's sheet on the
   backend. It takes out everything lib/roster.js wrote for that player: the player, the parent's details under it, the engine's
   ledger entries and whatever is still queued for Monday. Only a record the engine itself created (source 'enroll') can go this
   way; players from Monday or the Coach Portal are removed there. A plan that is still live in the current Stripe mode means a
   real family, so the plan has to be cancelled first. Nothing in Stripe is touched. */
'use strict';
const S = require('./stripe');

async function removeRecord(db, stripe, pid, opts) {
  opts = opts || {}; const log = opts.log || (() => {});
  pid = String(pid || '').trim();
  if (!/^[a-z0-9-]{1,60}$/.test(pid)) throw S.err(400, 'player', 'A player id is required.');
  const ref = db.doc('players/' + pid);
  const snap = await ref.get();
  if (!snap.exists) throw S.err(404, 'player', 'No such player.');
  const p = snap.data();
  if (p.source !== 'enroll') throw S.err(409, 'source', `${p.name || pid} was not filed by the engine (${p.source ? 'from ' + p.source : 'no source'}) — remove it in the Coach Portal.`);
  const subId = p.enroll && p.enroll.subscription;
  if (subId && stripe) {
    let sub = null;
    try { sub = await stripe.subscriptions.retrieve(subId); } catch (e) { sub = null; }          // a sandbox plan while live (or the reverse): nothing to check
    if (sub && !['canceled', 'incomplete_expired'].includes(sub.status)) throw S.err(409, 'plan', `${p.name || pid} still has a plan in Stripe (${sub.status}) — cancel it first.`);
  }
  const removed = { player: pid, name: p.name || '', private: 0, enrollments: 0, outbox: 0 };
  const batch = db.batch();
  for (const d of (await ref.collection('private').get()).docs) { batch.delete(d.ref); removed.private++; }
  for (const d of (await db.collection('enrollments').where('player', '==', pid).get()).docs) { batch.delete(d.ref); removed.enrollments++; }
  for (const d of (await db.collection('outbox').where('pid', '==', pid).get()).docs) { if (d.data().state === 'queued') { batch.delete(d.ref); removed.outbox++; } }
  batch.delete(ref);
  await batch.commit();
  log(`roster: removed ${pid} (${removed.private} contact, ${removed.enrollments} ledger, ${removed.outbox} queued for Monday)`);
  return removed;
}

module.exports = { removeRecord };
