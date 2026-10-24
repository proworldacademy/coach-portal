/* Moving the families over from Play by Point: one record per active player (imported from the Player Motherboard's PARENT CONTACTS
   tab), the plan the front desk sets for them, the "keep your spot" link, who was sent it, and — read live from Stripe — who has
   already enrolled. Kept in Firestore (collection `switchRoster`) through the admin SDK: the pages never read it directly and nothing
   about a family ever lands in the public repo. */
'use strict';
const admin = require('firebase-admin');
const CAT = require('./catalog');
const S = require('./stripe');
const CAL = require('./calendar');

const SITE = 'https://proworld-coach-portal.web.app';
const COLL = 'switchRoster';
const GROUPS = { ft: 'fulltime', as: 'afterschool', u10: null };                 // u10 splits into Advanced / Pathway — set per family
const EDITABLE = ['program', 'plan', 'days', 'guardian', 'email', 'phone', 'phone2', 'first', 'last', 'note', 'skip', 'skipReason'];

function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function groupOf(programText) {
  const t = String(programText || '').toLowerCase();
  if (/full/.test(t)) return 'ft';
  if (/after/.test(t)) return 'as';
  if (/10|under|tots|4 &/.test(t)) return 'u10';
  return '';
}
function digits(s) { return String(s || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); }
function splitName(player) { const parts = String(player || '').trim().split(/\s+/); return { first: parts[0] || '', last: parts.length > 1 && parts[parts.length - 1].length > 1 ? parts.slice(1).join(' ') : '' }; }

function db() { if (!require('firebase-admin/app').getApps().length) require('firebase-admin/app').initializeApp(); return require('firebase-admin/firestore').getFirestore(); }

/* Rows from the Motherboard (PLAYER, PROGRAM, PRIMARY COACH, PARENT / GUARDIAN, PHONE, EMAIL, PARENT 2 PHONE, MATCH NOTES). Re-importing
   refreshes the contact columns and never touches what the front desk set (plan, days, sent, skip). */
async function importRows(rows, who) {
  const col = db().collection(COLL);
  const now = new Date().toISOString();
  let created = 0, updated = 0;
  const batch = db().batch(); let n = 0;
  const existing = {};
  for (const d of (await col.get()).docs) existing[d.id] = d.data();
  for (const r of rows) {
    const player = S.clean(r.player, 80); if (!player) continue;
    const id = slug(player); if (!id) continue;
    const nm = splitName(player);
    const rec = { player, group: groupOf(r.program), programText: S.clean(r.program, 40), coach: S.clean(r.coach, 40), guardian: S.clean(r.guardian, 100), email: S.clean(r.email, 120).toLowerCase(), phone: digits(r.phone), phone2: digits(r.phone2), matchNote: S.clean(r.note, 200), importedAt: now, importedBy: who };
    if (existing[id]) { updated++; const keep = existing[id]; for (const k of ['first', 'last']) if (!keep[k]) rec[k] = nm[k]; }
    else { created++; Object.assign(rec, { first: nm.first, last: nm.last, program: GROUPS[rec.group] || '', plan: '', days: '', note: '', skip: false, createdAt: now }); }
    batch.set(col.doc(id), rec, { merge: true }); n++;
    if (n >= 400) break;
  }
  await batch.commit();
  return { created, updated, total: n };
}

async function update(id, patch, who) {
  id = slug(id); if (!id) throw S.err(400, 'id', 'id required');
  const ref = db().collection(COLL).doc(id);
  const snap = await ref.get(); if (!snap.exists) throw S.err(404, 'row', 'No such family.');
  const set = {};
  for (const k of EDITABLE) if (patch[k] !== undefined) set[k] = k === 'skip' ? patch[k] === true : S.clean(patch[k], k === 'note' || k === 'skipReason' ? 300 : 120);
  if (set.email !== undefined) set.email = set.email.toLowerCase();
  if (set.phone !== undefined) set.phone = digits(set.phone);
  if (set.program !== undefined && set.program && !CAT.program(set.program)) throw S.err(400, 'program', 'Unknown program.');
  if (set.plan !== undefined && set.plan) { const prog = CAT.program(set.program !== undefined ? set.program : snap.data().program); if (!prog || !CAT.plan(prog.id, set.plan)) throw S.err(400, 'plan', 'Unknown plan for that program.'); }
  if (patch.sent === true) { set.sentAt = new Date().toISOString(); set.sentBy = who; set.sentVia = S.clean(patch.via, 20) || 'email'; }
  if (patch.sent === false) { set.sentAt = require('firebase-admin/firestore').FieldValue.delete(); set.sentBy = require('firebase-admin/firestore').FieldValue.delete(); set.sentVia = require('firebase-admin/firestore').FieldValue.delete(); }
  set.updatedAt = new Date().toISOString(); set.updatedBy = who;
  await ref.set(set, { merge: true });
  return (await ref.get()).data();
}

/* The "keep your spot" link for a family: the program (and plan) the front desk set, the family's details, billing from the next 1st. */
function linkFor(r, start) {
  const q = new URLSearchParams();
  q.set('switch', '1');
  if (r.program && CAT.program(r.program)) { q.set('p', r.program); if (r.plan && CAT.plan(r.program, r.plan)) q.set('plan', r.plan); if (r.days) q.set('days', r.days); }
  if (start) q.set('start', start);
  for (const [k, v] of [['first', r.first], ['last', r.last], ['parent', r.guardian], ['email', r.email], ['phone', r.phone]]) if (v) q.set(k, v);
  q.set('by', 'switch');
  return `${SITE}/enroll?${q.toString()}`;
}

/* Everything the panel shows: the rows, each one's link, and whether a plan already exists in Stripe for that family (by email first,
   then by the player's name on the plan). `subs` is the overview's subscription list. */
async function list(subs, today) {
  const start = CAL.nextFirst(today || CAL.todayET());
  const rows = (await db().collection(COLL).orderBy('player').get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const live = (subs || []).filter((s) => ['active', 'trialing', 'past_due'].includes(s.status));
  const byEmail = {}; for (const s of live) { const e = (s.customer && s.customer.email || '').toLowerCase(); if (e) (byEmail[e] = byEmail[e] || []).push(s); }
  const out = rows.map((r) => {
    const nm = splitName(r.player); const first = (r.first || nm.first).toLowerCase();
    let match = (r.email && byEmail[r.email] || []).find((s) => (s.player || '').toLowerCase().startsWith(first)) || (r.email && byEmail[r.email] || [])[0] || null;
    if (!match) match = live.find((s) => { const p = (s.player || '').toLowerCase().split(/\s+/); return p[0] === first && nm.last && p.length > 1 && p[p.length - 1][0] === nm.last[0].toLowerCase() && (!r.email || (s.customer && s.customer.email || '').toLowerCase() === r.email); }) || null;
    return Object.assign({}, r, { link: linkFor(r, start), enrolled: match ? { subscription: match.id, player: match.player, program: match.program, plan: match.plan, next: match.next, status: match.status } : null });
  });
  const counts = { families: out.length, enrolled: out.filter((r) => r.enrolled).length, sent: out.filter((r) => r.sentAt && !r.enrolled).length, waiting: out.filter((r) => !r.sentAt && !r.enrolled && !r.skip).length, skipped: out.filter((r) => r.skip && !r.enrolled).length, noEmail: out.filter((r) => !r.email && !r.enrolled && !r.skip).length, noProgram: out.filter((r) => !r.program && !r.enrolled && !r.skip).length };
  return { start, rows: out, counts };
}

module.exports = { importRows, update, list, linkFor, slug, groupOf, splitName, SITE };
