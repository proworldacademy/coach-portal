/* The weekly contact tracker, engine side (Antonio, Nov 2, 2026).
   Every family hears from their coach every week through JustCall, and the tick must be automatic: JustCall keeps every text
   and call, so the engine reads the last eight days of both every two hours, matches each one to a family on the roster by
   phone and to the coach by the JustCall agent's e-mail (the staff list), and writes contacts/{playerId}_{Monday} with
   source 'justcall'. A tick a coach made by hand is never undone; a coach's "not yet" (done false, source coach) is respected.
   What counts: a one-to-one text the coach sent (not a bulk text from Messages, not an automation), and an answered call either
   way. Replies the family sends on their own do not count — the coach has to reach out.
   Also here: the Friday reminder on Slack (each coach gets their own list, the coaches' channel gets the roll-up) and the
   contact check — contactCheck/{playerId}: the numbers on file for the family, and which of mother · father · guardian · player
   the coach confirmed, typed in or marked N/A. JustCall can only work when the numbers are there, so the portal flags a player
   until every slot is confirmed or N/A. The numbers a coach types here are used for matching too. */
'use strict';
const NOTIFY = require('./notify');
const S = require('./stripe');
const CAL = require('./calendar');

const JUSTCALL_API = 'https://api.justcall.io/v2.1';
const SITE = 'https://proworld-coach-portal.web.app';
const DAY = 864e5;
const SLOTS = ['mother', 'father', 'guardian', 'player'];

let override = null;                                   // the tests swap the network out
function _useFetch(fn) { override = fn; }
const net = () => override || (typeof fetch === 'function' ? fetch : null);
const e164 = (v) => NOTIFY.e164(v);
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';

/* ---- weeks (Monday to Sunday, keyed by the Monday, Delray Beach time) ---- */
function isoOf(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function weekOf(iso) { const [y, m, d] = String(iso).split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d)); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return isoOf(x); }
function shiftDays(iso, n) { const [y, m, d] = String(iso).split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return isoOf(x); }
function todayET(now) { return CAL.todayET ? CAL.todayET(now) : isoOf(new Date((now || Date.now()) - 5 * 3600e3)); }
/* the moment `now` as JustCall wants a datetime: yyyy-mm-dd hh:mm:ss in the account's (Delray Beach) time — JustCall refuses a to_datetime in the future */
function stampET(now) {
  const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: CAL.TZ || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(now || Date.now())).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}
/* a UTC date + time from JustCall → the Delray Beach date it happened on */
function etDate(dateUtc, timeUtc) {
  const d = new Date(`${String(dateUtc || '').slice(0, 10)}T${String(timeUtc || '00:00:00').slice(0, 8)}Z`); if (isNaN(d)) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: CAL.TZ || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.replace(/\//g, '-');
}
function whenOf(row, kind) {   // the ET date and a millisecond stamp for a text or a call
  const ud = row[kind + '_user_date'], ut = row[kind + '_user_time'];
  const dateET = ud ? String(ud).slice(0, 10) : etDate(row[kind + '_date'], row[kind + '_time']);
  const ms = Date.parse(`${String(row[kind + '_date'] || ud || '').slice(0, 10)}T${String(row[kind + '_time'] || ut || '00:00:00').slice(0, 8)}Z`);
  return { dateET, ms: isNaN(ms) ? Date.now() : ms };
}

/* ---- the roster's phones: E.164 → the players behind it ---- */
async function phoneBook(db) {
  const players = (await db.collection('players').get()).docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((p) => !p.status || p.status === 'active');
  const book = new Map(); const add = (phone, p, source) => { const n = e164(phone); if (!n || n.length < 11) return; if (!book.has(n)) book.set(n, []); if (!book.get(n).some((x) => x.id === p.id)) book.get(n).push({ id: p.id, name: p.name || p.id, group: p.group || '', coach: p.coach || '', coach2: p.coach2 || '', source }); };
  const onFile = {};
  for (let i = 0; i < players.length; i += 50) {
    const slice = players.slice(i, i + 50);
    const snaps = await Promise.all(slice.map((p) => Promise.all([db.doc(`players/${p.id}/private/contact`).get(), db.doc(`players/${p.id}/private/sms`).get(), db.doc(`contactCheck/${p.id}`).get()])));
    slice.forEach((p, k) => {
      const contact = snaps[k][0].exists ? (snaps[k][0].data() || {}) : {}; const sms = snaps[k][1].exists ? (snaps[k][1].data() || {}) : {}; const check = snaps[k][2].exists ? (snaps[k][2].data() || {}) : null;
      add(contact.phone, p, 'contact'); add(contact.phone2, p, 'contact'); add(sms.phone, p, 'consent');
      const slots = (check && check.slots) || {}; SLOTS.forEach((s) => { if (slots[s] && slots[s].phone) add(slots[s].phone, p, 'check'); });
      onFile[p.id] = { contact, sms, check };
    });
  }
  return { players, book, onFile };
}

/* ---- the staff list: a JustCall agent's e-mail → the coach ---- */
async function staffIndex(db) {
  const snap = await db.collection('staff').where('active', '==', true).get(); const byEmail = new Map(); const list = [];
  for (const d of snap.docs) { const r = d.data() || {}; const rec = { email: String(d.id).toLowerCase(), name: r.name || d.id, short: r.coachAs || first(r.name) || first(d.id), role: r.role || 'coach', slackId: r.slackId || '', phone: r.phone || '', keys: [r.coachAs, first(r.name)].map(fold).filter(Boolean) }; byEmail.set(rec.email, rec); list.push(rec); }
  return { byEmail, list };
}
const staffFor = (idx, coachName) => { const want = fold(first(coachName)); return want ? idx.list.find((s) => s.keys.includes(want)) || null : null; };

/* ---- JustCall ---- */
async function pull(keys, kind, from, to, log) {
  const f = net(); if (!f) return [];
  const out = []; let page = 0;
  for (; page < 40; page++) {
    const url = `${JUSTCALL_API}/${kind}?from_datetime=${encodeURIComponent(from)}&to_datetime=${encodeURIComponent(to)}&per_page=100&page=${page}&sort=datetime&order=asc`;
    const res = await f(url, { headers: { Authorization: keys.key + ':' + keys.secret, Accept: 'application/json' } });
    let j = null; try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok) { const msg = (j && (j.message || j.error)) || ('JustCall ' + res.status); throw S.err(502, 'justcall', `JustCall ${kind}: ${String(msg).slice(0, 160)}`); }
    const rows = Array.isArray(j && j.data) ? j.data : Array.isArray(j) ? j : [];
    out.push(...rows);
    if (rows.length < 100) break;
    if (log) log(`${kind}: page ${page} full, reading on`);
  }
  return out;
}
const BULK = /bulk|api|automation|campaign|workflow|zapier|sequence|drip|hubspot|pipedrive/i;
function textCounts(row) {   // a one-to-one text the coach sent, to a number, by an agent
  if (!row || row.is_deleted === true) return null;
  if (!/out/i.test(String(row.direction || ''))) return null;
  if (BULK.test(String(row.medium || ''))) return null;
  return { how: 'text', phone: e164(row.contact_number), email: String(row.agent_email || '').toLowerCase(), agent: row.agent_name || '', when: whenOf(row, 'sms') };
}
function callCounts(row) {   // an answered call either way
  if (!row) return null; const info = row.call_info || {}; const type = String(info.type || '').toUpperCase();
  const dur = row.call_duration || {}; const talked = Number(dur.conversation_time || 0) > 0 || /ANSWERED/.test(type);
  if (!talked || /MISSED|VOICEMAIL|UNANSWERED|BUSY|FAILED|ABANDONED|CANCELLED/.test(type)) return null;
  return { how: 'call', phone: e164(row.contact_number), email: String(row.agent_email || '').toLowerCase(), agent: row.agent_name || '', when: whenOf(row, 'call') };
}

/* The sync: the last eight days of JustCall → contacts/{pid}_{week}. Idempotent — run it as often as you like. */
async function sync(db, opts) {
  opts = opts || {}; const log = opts.log || (() => {}); const now = opts.now || Date.now();
  const s = await NOTIFY.settings(db, true); const keys = { key: s.justcallKey, secret: s.justcallSecret };
  if (!keys.key || !keys.secret) return { ok: false, why: 'no JustCall keys on settings/notify', texts: 0, calls: 0, matched: 0, written: 0 };
  const today = todayET(now); const from = shiftDays(today, -(opts.days || 8)) + ' 00:00:00', to = stampET(now - 60e3);   // eight days back, up to a minute ago
  const [texts, calls] = await Promise.all([pull(keys, 'texts', from, to, log), pull(keys, 'calls', from, to, log)]);
  const { players, book, onFile } = await phoneBook(db); const staff = await staffIndex(db);
  const agg = new Map();   // `${pid}_${week}` → { pid, week, texts, calls, last, by: Set, byEmail, how }
  let matched = 0, offStaff = 0, noFamily = 0, notCoach = 0;
  // the week is the PLAYER'S COACH's contact with the family (Antonio, Nov 2): a text or a call counts for the players whose
  // record carries that person's name (coach or second coach). The front desk, the office or another coach texting the same
  // family — payments, schedules, a tournament entry — does not tick it, whatever their role.
  const own = (who, p) => [p.coach, p.coach2].some((c) => c && who.keys.includes(fold(first(c))));
  const take = (ev) => {
    if (!ev || !ev.phone) return; const who = staff.byEmail.get(ev.email); if (!who) { offStaff++; return; }
    const all = book.get(ev.phone); if (!all || !all.length) { noFamily++; return; }
    const fams = all.filter((p) => own(who, p)); if (!fams.length) { notCoach++; return; }
    const week = weekOf(ev.when.dateET); matched++;
    for (const p of fams) {
      const k = `${p.id}_${week}`; const a = agg.get(k) || { p, week, texts: 0, calls: 0, last: 0, by: new Set(), byEmail: '', how: '' };
      a[ev.how === 'call' ? 'calls' : 'texts']++; if (ev.when.ms >= a.last) { a.last = ev.when.ms; a.how = ev.how; a.byEmail = who.email; } a.by.add(who.short || who.name);
      agg.set(k, a);
    }
  };
  texts.forEach((r) => take(textCounts(r))); calls.forEach((r) => take(callCounts(r)));
  let written = 0;
  for (const [k, a] of agg) {
    const ref = db.doc('contacts/' + k); const cur = await ref.get(); const old = cur.exists ? (cur.data() || {}) : null;
    const jc = { texts: a.texts, calls: a.calls, last: a.last, by: Array.from(a.by) };
    if (old && old.source === 'coach' && old.done === false) { if (JSON.stringify(old.jc || null) !== JSON.stringify(jc)) { await ref.set({ jc }, { merge: true }); written++; } continue; }   // the coach said "not yet": respected, the counts kept for the record
    if (old && old.done === true && old.source !== 'justcall') { if (JSON.stringify(old.jc || null) !== JSON.stringify(jc)) { await ref.set({ jc }, { merge: true }); written++; } continue; }   // ticked by hand: stays theirs
    const doc = { playerId: a.p.id, playerName: a.p.name, group: a.p.group, coach: a.p.coach, week: a.week, done: true, by: Array.from(a.by).join(', ').slice(0, 80), byEmail: a.byEmail, at: a.last, how: a.how, who: '', source: 'justcall', jc };
    if (!old || JSON.stringify(Object.assign({}, old, doc)) !== JSON.stringify(old)) { await ref.set(doc, { merge: true }); written++; }
  }
  // the engine's own ticks are only as good as the last read: a week it ticked earlier but no longer sees (a text deleted in
  // JustCall, a rule tightened, a seat that was the front desk's) goes back to red — only weeks the window covers in full,
  // and only records the engine itself wrote (a coach's tick or "not yet" is never touched)
  let unticked = 0;
  const firstWeek = weekOf(shiftDays(from.slice(0, 10), 7));   // the first Monday fully inside the window
  const recent = await db.collection('contacts').where('week', '>=', firstWeek).get();   // one field: no composite index needed; a few hundred rows at most
  for (const d of recent.docs) {
    const c = d.data() || {}; if (c.source !== 'justcall' || c.done !== true || agg.has(d.id)) continue;
    await d.ref.set({ done: false, at: now, how: '', jc: { texts: 0, calls: 0, last: 0, by: [] } }, { merge: true }); unticked++;
  }
  // the contact check: every active player gets its numbers-on-file card once, refreshed when the file changes
  let seeded = 0;
  for (const p of players) {
    const o = onFile[p.id] || {}; const contact = o.contact || {}, sms = o.sms || {};
    const file = []; const put = (phone, name, source) => { const n = e164(phone); if (n && n.length >= 11 && !file.some((x) => x.phone === n)) file.push({ phone: n, name: String(name || '').slice(0, 80), source }); };
    put(contact.phone, contact.guardian, 'contact'); put(contact.phone2, '', 'contact'); put(sms.phone, contact.guardian, 'consent');
    const cur = o.check; const same = cur && JSON.stringify(cur.onFile || []) === JSON.stringify(file);
    if (cur && same) continue;
    await db.doc('contactCheck/' + p.id).set(Object.assign(cur ? {} : { playerId: p.id, playerName: p.name || p.id, slots: {}, by: 'engine', at: now }, { onFile: file, fileAt: now }), { merge: true }); seeded++;
  }
  try { await db.doc('settings/contactSync').set({ at: now, from, to, texts: texts.length, calls: calls.length, matched, written, unticked, offStaff, notCoach, noFamily, seeded }, { merge: true }); } catch (e) { /* the summary is a nicety */ }
  log(`contacts: ${texts.length} texts, ${calls.length} calls → ${matched} matched (${offStaff} not by staff, ${notCoach} not by the player's coach, ${noFamily} not a family), ${written} weeks written, ${seeded} checks seeded`);
  return { ok: true, from, to, texts: texts.length, calls: calls.length, matched, written, unticked, offStaff, notCoach, noFamily, seeded };
}

/* The Friday reminder: each coach hears on their own Slack which families still have not heard from them this week; the
   coaches' channel gets the roll-up. Plain words, no em dashes, no contractions. */
async function nudge(db, opts) {
  opts = opts || {}; const now = opts.now || Date.now(); const today = todayET(now); const week = weekOf(today);
  const players = (await db.collection('players').get()).docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((p) => (!p.status || p.status === 'active') && p.name);
  const ticks = (await db.collection('contacts').where('week', '==', week).get()).docs.map((d) => d.data() || {}).filter((c) => c.done === true).map((c) => c.playerId);
  const done = new Set(ticks); const left = players.filter((p) => !done.has(p.id));
  const byCoach = new Map(); left.forEach((p) => { const c = p.coach || ''; if (!byCoach.has(c)) byCoach.set(c, []); byCoach.get(c).push(p); });
  const staff = await staffIndex(db); const out = { week, total: players.length, reached: players.length - left.length, left: left.length, dms: 0, noSlack: [], coaches: {} };
  const label = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const short = (p) => { const w = String(p.name || '').trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0] || p.id; };
  for (const [coach, list] of byCoach) {
    if (!coach) continue; const s = staffFor(staff, coach); const names = list.map(short).sort((a, b) => a.localeCompare(b));
    out.coaches[coach] = names.length;
    const text = `Weekly contact, week of ${label(week)}: ${names.length} of your ${names.length + players.filter((p) => p.coach === coach && done.has(p.id)).length} families still have not heard from you this week: ${names.join(', ')}. One text or one call through JustCall and it ticks itself; the list is on the portal: ${SITE}/portal#/contact`;
    if (s && s.slackId && !opts.dry) { if (await NOTIFY.slackDm(db, s.slackId, text)) out.dms++; else out.noSlack.push(coach); }
    else out.noSlack.push(coach);
  }
  const roll = Array.from(byCoach.entries()).filter(([c]) => c).sort((a, b) => b[1].length - a[1].length).map(([c, l]) => `${c} ${l.length}`).join(' · ');
  const noCoach = byCoach.get('') ? byCoach.get('').length : 0;
  const summary = `Weekly contact, week of ${label(week)}: ${out.reached} of ${out.total} families have heard from their coach. Still to reach: ${roll || 'nobody'}${noCoach ? ` · ${noCoach} with no coach` : ''}. ${SITE}/portal#/contact`;
  if (!opts.dry) await NOTIFY.slack(db, 'coaches', summary);
  out.summary = summary;
  return out;
}

/* Who on the staff list has a JustCall seat (by e-mail), for the owners' check. */
async function justcallUsers(db) {
  const s = await NOTIFY.settings(db, true); const keys = { key: s.justcallKey, secret: s.justcallSecret };
  if (!keys.key || !keys.secret) return { ok: false, why: 'no JustCall keys on settings/notify', users: [], staffWithout: [] };
  const f = net(); if (!f) return { ok: false, why: 'no network', users: [], staffWithout: [] };
  const res = await f(`${JUSTCALL_API}/users?per_page=100&page=0`, { headers: { Authorization: keys.key + ':' + keys.secret, Accept: 'application/json' } });
  let j = null; try { j = await res.json(); } catch (e) { j = null; }
  if (!res.ok) throw S.err(502, 'justcall', 'JustCall users: ' + String((j && (j.message || j.error)) || res.status).slice(0, 160));
  const rows = Array.isArray(j && j.data) ? j.data : Array.isArray(j) ? j : [];
  const staff = await staffIndex(db);
  const users = rows.map((u) => { const email = String(u.email || '').toLowerCase(); const st = staff.byEmail.get(email); return { id: u.id, name: u.name || '', email, role: u.role || '', onStaff: !!st, staffName: st ? st.name : '', numbers: [].concat(u.owned_numbers || [], u.shared_numbers || []).length }; });
  const have = new Set(users.map((u) => u.email));
  const staffWithout = staff.list.filter((s2) => !have.has(s2.email) && s2.role !== 'desk').map((s2) => ({ email: s2.email, name: s2.name, role: s2.role }));
  return { ok: true, users, staffWithout };
}

module.exports = { sync, nudge, justcallUsers, phoneBook, weekOf, etDate, stampET, textCounts, callCounts, SLOTS, _useFetch };
