/* What parents see coming (Antonio, Nov 19, 2026): "a section on the admin where it says Parent notifications or Events… everything
   that controls that little window. We can add events, news, camps coming up. Every time we add there, every single person gets a
   notification."
   familyNews/<id> { title, body, kind: 'event'|'news'|'camp', date, end, link, group, at, by }. The client home shows what is
   coming (dated items from today on, undated news for 30 days). Adding one sends a notification to every family phone that turned
   notifications on (pushSubs of people who are not on the team). Engine only: no rule opens the collection. */
'use strict';
const S = require('./stripe');
const CAL = require('./calendar');
const PUSH = require('./push');

const KINDS = { event: 'Event', news: 'News', camp: 'Camp' };
const GROUPS = { '': 'Everyone', ft: 'Full Time', as: 'Afterschool', u10: '10 & Under', tour: 'Tour Team', camp: 'Campers' };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
let CLOCK = () => Date.now();

function shape(id, x) { return { id, title: x.title || '', body: x.body || '', kind: KINDS[x.kind] ? x.kind : 'news', kindLabel: KINDS[x.kind] || 'News', date: x.date || '', end: x.end || '', link: x.link || '', group: x.group || '', groupLabel: GROUPS[x.group || ''] || 'Everyone', at: x.at || 0, by: x.by || '' }; }
async function all(db) { try { const s = await db.collection('familyNews').get(); return s.docs.map((d) => shape(d.id, d.data() || {})); } catch (e) { return []; } }
const live = (x, today) => (x.date ? (x.end || x.date) >= today : (CLOCK() - (x.at || 0)) < 30 * 864e5);
const order = (a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || (b.at || 0) - (a.at || 0);

/* The client home: what is coming for this family's groups, soonest first. */
async function forFamily(db, groups, today) {
  const gs = new Set((groups || []).filter(Boolean));
  return (await all(db)).filter((x) => live(x, today) && (!x.group || gs.has(x.group))).sort(order).slice(0, 8).map((x) => ({ id: x.id, title: x.title, body: x.body, kind: x.kind, kindLabel: x.kindLabel, date: x.date, end: x.end, link: x.link }));
}
async function list(db) { const today = CAL.todayET(); const rows = (await all(db)).sort(order); return { today, coming: rows.filter((x) => live(x, today)), past: rows.filter((x) => !live(x, today)).slice(-20).reverse(), kinds: KINDS, groups: GROUPS }; }

/* Every family phone with notifications on: the subscriptions of people who are not on the team (optionally one group's families). */
async function familyEmails(db) {
  const staff = new Set(); try { (await db.collection('staff').get()).docs.forEach((d) => staff.add(d.id.toLowerCase())); } catch (e) { /* then nobody is left out */ }
  const out = new Set(); try { (await db.collection('pushSubs').get()).docs.forEach((d) => { const e = String((d.data() || {}).email || '').toLowerCase(); if (e && !staff.has(e)) out.add(e); }); } catch (e) { /* none */ }
  return Array.from(out);
}
async function tellFamilies(db, note) { const emails = await familyEmails(db); let sent = 0; for (let i = 0; i < emails.length; i += 10) { const r = await PUSH.send(db, emails.slice(i, i + 10), note); sent += (r && r.sent) || 0; } return { families: emails.length, sent }; }

async function add(db, who, body) {
  const title = S.clean(body.title, 90); if (!title) throw S.err(400, 'title', 'Give it a title.');
  const date = isDate(body.date) ? body.date : ''; const end = isDate(body.end) && date && body.end >= date ? body.end : '';
  const link = /^(https:\/\/|\/)[^\s]{1,300}$/.test(String(body.link || '')) ? String(body.link) : '';
  const rec = { title, body: S.clean(body.body, 400), kind: KINDS[body.kind] ? body.kind : 'news', date, end, link, group: GROUPS[body.group] && body.group ? body.group : '', at: CLOCK(), by: who.email };
  const ref = await db.collection('familyNews').add(rec);
  const when = date ? ' · ' + new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const told = body.quiet ? { families: 0, sent: 0 } : await tellFamilies(db, { title: 'ProWorld · ' + title, body: (rec.body || KINDS[rec.kind]) + when, url: '/family', tag: 'news-' + ref.id });
  return { ok: true, id: ref.id, told };
}
async function remove(db, who, body) { const id = S.clean(body.id, 60); if (!id) throw S.err(400, 'id', 'Which one?'); await db.doc('familyNews/' + id).delete(); return { ok: true }; }

module.exports = { KINDS, GROUPS, forFamily, list, add, remove, tellFamilies, _clock: (f) => { CLOCK = f || (() => Date.now()); } };
