/* Notifications for the parents (Nov 22, 2026). "We need to create a notification system for parents as well, which can come from
   the app: the camp is coming, do not forget to sign up; a mental session next week, and another notification the day before;
   weather, all that stuff."

   familyNotices/<id>   { title, body, kind: weather|event|camp|news, group ('' everyone · ft · as · u10 · tour · camp · nocamp),
                          camp (the camp a 'nocamp' notice is about), url, date (the day it is about), sendAt, state: scheduled|sent|
                          cancelled, remind (one more the evening before `date`), text (families without the app get a text),
                          to: [the parent e-mails it went to], stats, auto, by, at, sentAt }
   familyPrefs/<e-mail> { weather, events, camps, text (all on unless switched off), readAt }
   settings/notices     { campAuto }

   Who gets one: every parent e-mail of the families in the group (the main e-mail and the sign-ins the family added), minus the
   parents who switched that kind off. It reaches the phones that turned notifications on, it is always in the list behind the bell
   of the client portal, and (weather and news only, when the sender asks) a family with no phone on notifications gets a text,
   through the same door as every other text: consent on file or nothing. Engine only: no rule opens these collections. */
'use strict';
const S = require('./stripe');
const CAL = require('./calendar');
const CAT = require('./catalog');
const PUSH = require('./push');
const NEWS = require('./news');
const SMS = require('./sms');

const KINDS = { weather: 'Weather', event: 'Event', camp: 'Camp', news: 'News' };
const PREF_OF = { weather: 'weather', event: 'events', camp: 'camps' };      // news always arrives
const GROUPS = Object.assign({}, NEWS.GROUPS, { nocamp: 'Families not signed up for a camp' });
const TEXT_KINDS = { weather: true, news: true };                              // a text is for a change of plans, never for selling a camp
const CAMP_DAYS = [10, 3];
const KEEP_DAYS = 30;
const TEMPLATES = [
  { id: 'rain', name: 'Rain delay', kind: 'weather', title: 'Rain delay', body: 'We are watching the weather. We will tell you 30 minutes before your session if it is on.', text: true },
  { id: 'closed', name: 'Courts closed', kind: 'weather', title: 'Courts closed today', body: 'The courts are closed because of the weather. Sessions are off for today.', text: true },
  { id: 'back', name: 'Back on', kind: 'weather', title: 'We are back on', body: 'The courts are ready. Sessions are on as scheduled.', text: true },
  { id: 'event', name: 'Event', kind: 'event', title: '', body: '', remind: true, post: true },
  { id: 'camp', name: 'Camp reminder', kind: 'camp', group: 'nocamp', title: '', body: 'Sign up in one minute.' },
  { id: 'blank', name: 'Blank', kind: 'news', title: '', body: '' }
];
const low = (v) => String(v || '').trim().toLowerCase();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
let CLOCK = () => Date.now();
const hourET = (now) => Number(new Intl.DateTimeFormat('en-US', { timeZone: CAL.TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
const campOf = (id, today) => CAT.campsComing(today).find((c) => c.ids.includes(id)) || null;

/* ── the families: one per main parent e-mail, with every e-mail that signs in to it, its players and the camps it bought ── */
async function directory(db) {
  const players = (await db.collection('players').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((p) => p.status !== 'finished');
  const fam = new Map();
  for (let i = 0; i < players.length; i += 50) {
    const slice = players.slice(i, i + 50);
    const snaps = await Promise.all(slice.map((p) => db.doc(`players/${p.id}/private/contact`).get().catch(() => null)));
    slice.forEach((p, k) => {
      const c = snaps[k] && snaps[k].exists ? (snaps[k].data() || {}) : {}; const main = low(c.email); if (!main) return;
      const f = fam.get(main) || { key: main, emails: new Set([main]), players: [], groups: new Set(), camps: new Set() }; fam.set(main, f);
      (Array.isArray(c.logins) ? c.logins : []).forEach((l) => { const e = low(l.email); if (e) f.emails.add(e); });
      f.players.push(p.id); if (p.group) f.groups.add(p.group);
      (Array.isArray(p.purchases) ? p.purchases : []).forEach((x) => { if (x && x.kind === 'camp' && x.camp) f.camps.add(x.camp); });
    });
  }
  return Array.from(fam.values());
}
function audience(dir, n, today) {
  if (n.group === 'nocamp') { const c = campOf(n.camp, today); const ids = new Set(c ? c.ids : [n.camp]); return dir.filter((f) => !Array.from(f.camps).some((x) => ids.has(x))); }
  if (!n.group) return dir;
  return dir.filter((f) => f.groups.has(n.group));
}
async function allPrefs(db) { const out = {}; try { (await db.collection('familyPrefs').get()).docs.forEach((d) => { out[d.id] = d.data() || {}; }); } catch (e) { /* everybody on the defaults */ } return out; }
async function appEmails(db) { const out = new Set(); try { (await db.collection('pushSubs').get()).docs.forEach((d) => { const e = low((d.data() || {}).email); if (e) out.add(e); }); } catch (e) { /* nobody */ } return out; }

/* Who a notice would reach, before it is sent: the parents, the families with a phone on notifications, the families a text would go to. */
async function reach(db, n, today) {
  const [dir, prefs, apps] = await Promise.all([directory(db), allPrefs(db), appEmails(db)]);
  const pk = PREF_OF[n.kind]; const to = []; const push = []; const texts = []; let families = 0, withApp = 0;
  for (const f of audience(dir, n, today)) {
    const on = Array.from(f.emails).filter((e) => !pk || (prefs[e] || {})[pk] !== false); if (!on.length) continue;
    families++; on.forEach((e) => to.push(e));
    const app = on.filter((e) => apps.has(e)); app.forEach((e) => push.push(e));
    if (app.length) withApp++;
    else if (n.text && TEXT_KINDS[n.kind] && on.some((e) => (prefs[e] || {}).text !== false)) texts.push(f.players[0]);
  }
  return { to: Array.from(new Set(to)), push: Array.from(new Set(push)), texts, families, withApp };
}

function shape(id, x, full) {
  const o = { id, title: x.title || '', body: x.body || '', kind: KINDS[x.kind] ? x.kind : 'news', kindLabel: KINDS[x.kind] || 'News', group: x.group || '', groupLabel: GROUPS[x.group || ''] || 'Everyone', camp: x.camp || '', url: x.url || '', date: x.date || '',
    sendAt: x.sendAt || 0, state: x.state || 'sent', remind: x.remind === true, reminded: x.reminded === true, text: x.text === true, auto: x.auto === true, by: x.auto ? '' : (x.byName || ''), at: x.at || 0, sentAt: x.sentAt || 0, stats: x.stats || null };
  if (full) o.to = Array.isArray(x.to) ? x.to : [];
  return o;
}
async function all(db) { try { return (await db.collection('familyNotices').get()).docs.map((d) => shape(d.id, d.data() || {}, true)); } catch (e) { return []; } }

/* ── sending one ── */
async function deliver(db, id, opts) {
  opts = opts || {};
  const ref = db.doc('familyNotices/' + id); const snap = await ref.get(); if (!snap.exists) throw S.err(404, 'notice', 'That notification is gone.');
  const n = snap.data() || {}; if (n.state === 'sent' || n.state === 'cancelled') return { ok: true, already: true };
  const now = CLOCK(); const today = CAL.todayET(new Date(now));
  await ref.set({ state: 'sent', sentAt: now }, { merge: true });                 // first: a second run in the same minute finds it sent
  const r = await reach(db, n, today);
  const note = { title: n.title, body: n.body, url: n.url || '/family#notices', tag: 'notice-' + id };
  let phones = 0;
  for (let i = 0; i < r.push.length; i += 10) { try { const o = await PUSH.send(db, r.push.slice(i, i + 10), note); phones += (o && o.sent) || 0; } catch (e) { /* the list behind the bell still has it */ } }
  const patch = { to: r.to, stats: { families: r.families, app: r.withApp, phones, text: 0 } };
  if (r.texts.length && n.textOk === true) {
    try {
      const o = await SMS.send(db, { email: n.by || 'notices', name: n.byName || 'ProWorld', texting: true }, { body: n.title + '. ' + n.body, recipients: r.texts.map((p) => ({ player: p })), template: 'notice' }, { budgetMs: opts.textBudgetMs != null ? opts.textBudgetMs : 15000, delayMs: opts.textDelayMs });
      patch.smsBatch = o.batch; patch.smsState = o.state; patch.stats.text = (o.total || 0) - (o.skipped || 0);
    } catch (e) { patch.textError = String(e.message || e).slice(0, 200); }
  }
  await ref.set(patch, { merge: true });
  return { ok: true, id, stats: patch.stats, textError: patch.textError || '' };
}

function read(body, who, now, today) {
  const kind = KINDS[body.kind] ? body.kind : 'news';
  const title = S.clean(body.title, 90); if (!title) throw S.err(400, 'title', 'Give it a title.');
  const text = S.clean(body.body, 300); if (!text) throw S.err(400, 'body', 'Write one line for the parents.');
  let group = Object.prototype.hasOwnProperty.call(GROUPS, body.group || '') ? (body.group || '') : ''; let camp = '';
  if (group === 'nocamp') { const c = campOf(S.clean(body.camp, 20), today); if (!c) throw S.err(400, 'camp', 'Pick the camp it is about.'); camp = c.ids[0]; }
  const url = /^(https:\/\/|\/)[^\s]{1,300}$/.test(String(body.url || '')) ? String(body.url) : (camp ? '/enroll?camp=' + camp : '');
  const date = isDate(body.date) && body.date >= today ? body.date : '';
  const at = Number(body.sendAt) || 0; if (at && at > now + 60 * 864e5) throw S.err(400, 'when', 'Two months ahead is the most.');
  const later = at > now + 60000;
  const remind = body.remind === true && !!date && daysBetween(today, date) >= 1;
  return { title, body: text, kind, group, camp, url, date, sendAt: later ? at : now, state: 'scheduled', remind, reminded: false, text: body.text === true && !!TEXT_KINDS[kind], textOk: !!(who && who.texting), auto: false, by: who.email, byName: who.name || who.email, at: now, later };
}
async function create(db, who, body, opts) {
  const now = CLOCK(); const today = CAL.todayET(new Date(now));
  const rec = read(body || {}, who, now, today); const later = rec.later; delete rec.later;
  const ref = await db.collection('familyNotices').add(rec);
  if (body.post === true && rec.kind !== 'weather') { try { await NEWS.add(db, who, { title: rec.title, body: rec.body, kind: rec.kind, date: rec.date, group: rec.group === 'nocamp' ? '' : rec.group, link: rec.url, quiet: true }); } catch (e) { /* the notification still goes */ } }
  if (later) return { ok: true, id: ref.id, scheduled: rec.sendAt };
  return deliver(db, ref.id, opts);
}
async function count(db, body) {
  const now = CLOCK(); const today = CAL.todayET(new Date(now)); const kind = KINDS[body.kind] ? body.kind : 'news';
  const r = await reach(db, { kind, group: body.group || '', camp: S.clean(body.camp, 20), text: body.text === true }, today);
  return { families: r.families, app: r.withApp, text: r.texts.length };
}
async function cancel(db, who, body) {
  const id = S.clean(body.id, 60); if (!id) throw S.err(400, 'id', 'Which one?');
  const ref = db.doc('familyNotices/' + id); const snap = await ref.get(); if (!snap.exists) throw S.err(404, 'notice', 'That notification is gone.');
  if ((snap.data() || {}).state !== 'scheduled') throw S.err(409, 'sent', 'It already went out.');
  await ref.set({ state: 'cancelled', cancelledBy: who.email, cancelledAt: CLOCK() }, { merge: true }); return { ok: true };
}
async function settings(db) { let s = {}; try { const x = await db.doc('settings/notices').get(); s = x.exists ? (x.data() || {}) : {}; } catch (e) { s = {}; } return { campAuto: s.campAuto !== false }; }
async function saveSettings(db, who, body) { await db.doc('settings/notices').set({ campAuto: body.campAuto === true, by: who.email, at: CLOCK() }, { merge: true }); return settings(db); }

/* The Admin screen: what is waiting, what went out, what goes by itself. */
async function list(db, who) {
  const now = CLOCK(); const today = CAL.todayET(new Date(now)); const rows = (await all(db)).map((x) => { const o = Object.assign({}, x); delete o.to; return o; });
  const camps = CAT.campsComing(today).map((c) => ({ id: c.ids[0], title: c.title, dates: c.dates, from: c.from, auto: CAMP_DAYS.map((d) => CAL.addDays(c.from, -d)).filter((d) => d >= today) }));
  return { today, scheduled: rows.filter((x) => x.state === 'scheduled').sort((a, b) => a.sendAt - b.sendAt), sent: rows.filter((x) => x.state === 'sent').sort((a, b) => b.sentAt - a.sentAt).slice(0, 30),
    waitingReminders: rows.filter((x) => x.state === 'sent' && x.remind && !x.reminded && x.date > today).map((x) => ({ id: x.id, title: x.title, date: x.date })),
    settings: await settings(db), templates: TEMPLATES, kinds: KINDS, groups: GROUPS, camps, campDays: CAMP_DAYS, texting: !!(who && who.texting) };
}

/* ── the clock: every ten minutes ── */
async function tick(db, opts) {
  opts = opts || {}; const now = CLOCK(); const today = CAL.todayET(new Date(now)); const hr = hourET(now); const out = { sent: 0, reminders: 0, camps: 0, texts: 0 };
  const rows = await all(db);
  for (const n of rows) if (n.state === 'scheduled' && n.sendAt <= now) { try { await deliver(db, n.id, opts); out.sent++; } catch (e) { out.error = e.message; } }
  /* the evening before: 6 pm to 9 pm, once */
  if (hr >= 18 && hr < 21) for (const n of rows) {
    if (!(n.state === 'sent' && n.remind && !n.reminded && n.date && CAL.addDays(n.date, -1) === today)) continue;
    const rid = 'r-' + n.id; const ref = db.doc('familyNotices/' + rid);
    await db.doc('familyNotices/' + n.id).set({ reminded: true }, { merge: true });
    if (!(await ref.get()).exists) { await ref.set({ title: 'Tomorrow: ' + n.title, body: n.body, kind: n.kind, group: n.group, camp: n.camp, url: n.url, date: n.date, sendAt: now, state: 'scheduled', remind: false, text: false, auto: true, by: 'automatic', at: now }); await deliver(db, rid, opts); out.reminders++; }
  }
  /* a camp is coming: ten days and three days before, to the families not signed up, in the daytime */
  if (hr >= 10 && hr < 20 && (await settings(db)).campAuto) for (const c of CAT.campsComing(today)) {
    const d = daysBetween(today, c.from); if (!CAMP_DAYS.includes(d)) continue;
    const id = 'camp-' + c.ids[0] + '-' + d; const ref = db.doc('familyNotices/' + id); if ((await ref.get()).exists) continue;
    await ref.set({ title: c.title + ' starts in ' + d + ' days', body: c.dates + '. Sign up in one minute.', kind: 'camp', group: 'nocamp', camp: c.ids[0], url: '/enroll?camp=' + c.ids[0], date: '', sendAt: now, state: 'scheduled', remind: false, text: false, auto: true, by: 'automatic', at: now });
    await deliver(db, id, opts); out.camps++;
  }
  /* texts still in the queue (JustCall takes thirty a minute) */
  for (const n of rows) { let x = null; try { x = (await db.doc('familyNotices/' + n.id).get()).data() || {}; } catch (e) { x = null; }
    if (x && x.smsBatch && x.smsState === 'sending') { try { const o = await SMS.continueBatch(db, x.smsBatch, { budgetMs: opts.textBudgetMs != null ? opts.textBudgetMs : 20000, delayMs: opts.textDelayMs }); await db.doc('familyNotices/' + n.id).set({ smsState: o.state }, { merge: true }); out.texts++; } catch (e) { /* next round */ } } }
  return out;
}

/* ── the parent's side: the list behind the bell, and the switches ── */
function prefsOf(p) { p = p || {}; return { weather: p.weather !== false, events: p.events !== false, camps: p.camps !== false, text: p.text !== false }; }
async function forFamily(db, email) {
  email = low(email); const now = CLOCK(); let p = {}; try { const x = await db.doc('familyPrefs/' + email).get(); p = x.exists ? (x.data() || {}) : {}; } catch (e) { p = {}; }
  const items = (await all(db)).filter((x) => x.state === 'sent' && now - x.sentAt < KEEP_DAYS * 864e5 && x.to.includes(email)).sort((a, b) => b.sentAt - a.sentAt).slice(0, 40)
    .map((x) => ({ id: x.id, title: x.title, body: x.body, kind: x.kind, kindLabel: x.kindLabel, url: x.url, date: x.date, at: x.sentAt, unread: x.sentAt > (p.readAt || 0) }));
  return { items, unread: items.filter((x) => x.unread).length, prefs: prefsOf(p) };
}
async function markRead(db, email) { await db.doc('familyPrefs/' + low(email)).set({ readAt: CLOCK() }, { merge: true }); return { ok: true }; }
async function setPrefs(db, email, body) {
  const patch = {}; ['weather', 'events', 'camps', 'text'].forEach((k) => { if (typeof body[k] === 'boolean') patch[k] = body[k]; });
  if (Object.keys(patch).length) await db.doc('familyPrefs/' + low(email)).set(Object.assign(patch, { updatedAt: CLOCK() }), { merge: true });
  const x = await db.doc('familyPrefs/' + low(email)).get(); return { ok: true, prefs: prefsOf(x.exists ? x.data() : {}) };
}

module.exports = { KINDS, GROUPS, TEMPLATES, CAMP_DAYS, directory, reach, create, count, cancel, list, deliver, tick, settings, saveSettings, forFamily, markRead, setPrefs, _clock: (f) => { CLOCK = f || (() => Date.now()); } };
