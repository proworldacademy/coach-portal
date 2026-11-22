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

function shape(id, x) { return { id, title: x.title || '', body: x.body || '', kind: KINDS[x.kind] ? x.kind : 'news', kindLabel: KINDS[x.kind] || 'News', date: x.date || '', end: x.end || '', link: x.link || '', repeat: REPEATS[x.repeat] ? x.repeat : '', time: x.time || '', signup: x.signup === true, reminded: x.reminded || '', group: x.group || '', groupLabel: GROUPS[x.group || ''] || 'Everyone', at: x.at || 0, by: x.by || '' }; }
async function all(db) { try { const s = await db.collection('familyNews').get(); return s.docs.map((d) => shape(d.id, d.data() || {})); } catch (e) { return []; } }
/* An event that repeats (Nov 22, 2026: "every other Wednesday, the mental sessions") shows its next day; one parents sign up for keeps a list per day. */
const REPEATS = { weekly: 7, biweekly: 14 };
const REPEAT_WORD = { weekly: 'Every week', biweekly: 'Every other week' };
function nextOf(x, today) { if (!x.date) return ''; const step = REPEATS[x.repeat]; if (!step) return x.date; let d = x.date; for (let i = 0; i < 200 && d < today; i++) d = CAL.addDays(d, step); return x.end && d > x.end ? '' : d; }
const live = (x, today) => (x.date ? (REPEATS[x.repeat] ? !!nextOf(x, today) : (x.end || x.date) >= today) : (CLOCK() - (x.at || 0)) < 30 * 864e5);
const sid = (news, date, player) => `${news}_${date}_${String(player).replace(/\//g, '-')}`;
async function signups(db, news, date) { try { return (await db.collection('eventSignups').where('news', '==', news).get()).docs.map((d) => d.data() || {}).filter((g) => g.date === date); } catch (e) { return []; } }
const order = (a, b) => String(a.next || a.date || '9999').localeCompare(String(b.next || b.date || '9999')) || (b.at || 0) - (a.at || 0);

/* The client home: what is coming for this family's groups, soonest first. */
async function forFamily(db, groups, today, players) {
  const gs = new Set((groups || []).filter(Boolean)); const mine = new Set((players || []).map((p) => p.id));
  const rows = (await all(db)).filter((x) => live(x, today) && (!x.group || gs.has(x.group))).map((x) => Object.assign(x, { next: nextOf(x, today) })).sort(order).slice(0, 8);
  const out = [];
  for (const x of rows) { const o = { id: x.id, title: x.title, body: x.body, kind: x.kind, kindLabel: x.kindLabel, date: x.next || x.date, end: REPEATS[x.repeat] ? '' : x.end, link: x.link, repeat: x.repeat, repeatLabel: REPEAT_WORD[x.repeat] || '', time: x.time, signup: x.signup && !!x.next };
    if (o.signup) o.signed = (await signups(db, x.id, x.next)).filter((g) => mine.has(g.player)).map((g) => g.player);
    out.push(o); }
  return out;
}
/* A parent puts a player on the list for the next day of an event, or takes them off. */
async function signup(db, who, body, players) {
  const today = CAL.todayET(); const id = S.clean(body.id, 60); const snap = id ? await db.doc('familyNews/' + id).get() : null; if (!snap || !snap.exists) throw S.err(404, 'event', 'That event is gone.');
  const x = shape(id, snap.data() || {}); const date = nextOf(x, today); if (!x.signup || !date) throw S.err(409, 'closed', 'Sign-up is closed for this one.');
  const p = (players || []).find((q) => q.id === S.clean(body.player, 80)); if (!p) throw S.err(404, 'player', 'Which player?');
  const ref = db.doc('eventSignups/' + sid(id, date, p.id));
  if (body.on === false) await ref.delete(); else await ref.set({ news: id, date, player: p.id, playerName: p.name || '', email: String(who.email).toLowerCase(), at: CLOCK() });
  return { ok: true, date, on: body.on !== false, title: x.title };
}
async function list(db) { const today = CAL.todayET(); const rows = (await all(db)).map((x) => Object.assign(x, { next: nextOf(x, today), repeatLabel: REPEAT_WORD[x.repeat] || '' })).sort(order);
  for (const x of rows) if (x.signup && x.next) x.going = (await signups(db, x.id, x.next)).map((g) => g.playerName || g.player).sort();
  return { today, coming: rows.filter((x) => live(x, today)), past: rows.filter((x) => !live(x, today)).slice(-20).reverse(), kinds: KINDS, groups: GROUPS }; }
/* The evening before an event with a list: who is signed up, once per day of the event. The notices clock sends it. */
async function dueReminders(db, today) {
  const out = []; const tomorrow = CAL.addDays(today, 1);
  for (const x of await all(db)) { if (!x.signup || nextOf(x, tomorrow) !== tomorrow || x.reminded === tomorrow) continue;
    const emails = Array.from(new Set((await signups(db, x.id, tomorrow)).map((g) => g.email).filter(Boolean)));
    await db.doc('familyNews/' + x.id).set({ reminded: tomorrow }, { merge: true });
    if (emails.length) out.push({ id: x.id, date: tomorrow, title: x.title, time: x.time, body: x.body, emails }); }
  return out;
}

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
  const rec = { title, body: S.clean(body.body, 400), kind: KINDS[body.kind] ? body.kind : 'news', date, end, link, repeat: date && REPEATS[body.repeat] ? body.repeat : '', time: S.clean(body.time, 40), signup: body.signup === true && !!date, group: GROUPS[body.group] && body.group ? body.group : '', at: CLOCK(), by: who.email };
  const ref = await db.collection('familyNews').add(rec);
  const when = date ? ' · ' + new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const told = body.quiet ? { families: 0, sent: 0 } : await tellFamilies(db, { title: 'ProWorld · ' + title, body: (rec.body || KINDS[rec.kind]) + when + (rec.time ? ' · ' + rec.time : '') + (rec.signup ? '. Sign up in the app.' : ''), url: '/family', tag: 'news-' + ref.id });
  return { ok: true, id: ref.id, told };
}
async function remove(db, who, body) { const id = S.clean(body.id, 60); if (!id) throw S.err(400, 'id', 'Which one?'); await db.doc('familyNews/' + id).delete(); return { ok: true }; }

module.exports = { KINDS, GROUPS, REPEATS, forFamily, list, add, remove, tellFamilies, signup, dueReminders, nextOf, _clock: (f) => { CLOCK = f || (() => Date.now()); } };
