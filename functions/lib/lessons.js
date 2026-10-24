/* Private lessons: who hears what, and when (Antonio, Oct 24).
   - The moment a private is booked on the backend: the coach gets a text, the coaches' Slack gets a line, the family gets its
     confirmation (the page already sends that one).
   - One reminder, an hour before, to the family (only if they opted in to texts) and to the coach (their mobile on the staff
     record, Staff & access → Mobile). Antonio's call, Oct 24: confirmation at booking + one hour before, nothing the evening before.
   - A cancellation texts both.
   The lessons live in backend/state.privates (the page's shared state); what has been sent is kept in lessonReminders/<lesson id>
   so the page can rewrite its state freely. Runs every 15 minutes (index.js: lessonReminders). */
'use strict';
const NOTIFY = require('./notify');
const SMS = require('./sms');

const TZ = 'America/New_York';
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/* The epoch of "YYYY-MM-DD at H.5 hours" in Delray Beach time, DST included. */
function etEpoch(dateStr, hours) {
  const [y, m, d] = String(dateStr).split('-').map(Number); const h = Math.floor(hours), min = Math.round((hours - h) * 60);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return guess - (seen - guess);   // shift by the offset ET showed for that instant
}
function fmtT(h) { const H = Math.floor(h), M = Math.round((h - H) * 60); const ap = H >= 12 ? 'PM' : 'AM'; const hh = ((H + 11) % 12) + 1; return hh + (M ? ':' + String(M).padStart(2, '0') : '') + ' ' + ap; }
function fmtDay(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
function first(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

async function staffFor(db, coachName) {
  const want = fold(first(coachName)); if (!want) return null;
  const snap = await db.collection('staff').where('active', '==', true).get();
  for (const d of snap.docs) { const r = d.data() || {}; const names = [r.coachAs, first(r.name)].map(fold).filter(Boolean); if (names.includes(want)) return { phone: r.phone ? NOTIFY.e164(r.phone) : '', slackId: r.slackId || '', name: r.name || d.id, email: d.id }; }
  return null;
}
/* The coach hears it on their personal Slack (Antonio, Oct 24); a text only when there is no Slack link yet but a mobile is on file. */
async function tellCoach(db, coachName, text) {
  const c = await staffFor(db, coachName); if (!c) return { how: 'none' };
  if (c.slackId && await NOTIFY.slackDm(db, c.slackId, text)) return { how: 'slack' };
  if (c.phone && await NOTIFY.text(db, c.phone, text)) return { how: 'text' };
  return { how: 'none' };
}
const staffPhoneFor = staffFor;
function courtName(courtId) { const n = String(courtId || ''); return /^\d+$/.test(n) ? 'Court ' + n : (n === 'f1' || n === 'f2' ? 'Field ' + n.slice(1) : n); }

/* Booked: a text to the coach and a line in the coaches' Slack. The page texts the family. */
async function booked(db, who, body) {
  const coach = String(body.coach || '').slice(0, 60), player = String(body.player || '').slice(0, 80), date = String(body.date || '').slice(0, 10);
  const start = Number(body.start), dur = Number(body.dur) || 1, court = courtName(body.court);
  if (!coach || !player || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start)) return { ok: false, reason: 'incomplete' };
  const line = `${player} · ${fmtDay(date)} ${fmtT(start)}–${fmtT(start + dur)} · ${court}`;
  const out = { ok: true, slack: false };
  out.coach = (await tellCoach(db, coach, `Private booked: ${line}. Booked by ${first(who.name) || who.email}.`)).how;
  out.slack = await NOTIFY.slack(db, 'coaches', `Private booked · ${coach} · ${line} — ${who.name || who.email}`);
  return out;
}

/* Cancelled: both sides hear it. */
async function cancelled(db, who, body) {
  const coach = String(body.coach || '').slice(0, 60), player = String(body.player || '').slice(0, 80), date = String(body.date || '').slice(0, 10);
  const start = Number(body.start), dur = Number(body.dur) || 1;
  const line = `${player} · ${fmtDay(date)} ${fmtT(start)}–${fmtT(start + dur)}`;
  const out = { ok: true };
  out.coach = (await tellCoach(db, coach, `Private cancelled: ${line}.`)).how;
  await NOTIFY.slack(db, 'coaches', `Private cancelled · ${coach} · ${line} — ${who.name || who.email}`);
  return out;
}

/* The reminders. now = epoch ms. Windows: the evening before, 6:00–6:59 PM ET; one hour before, 60→30 minutes out. */
async function remind(db, now, log) {
  now = now || Date.now();
  const st = (await db.doc('backend/state').get()).data() || {}; const privates = Array.isArray(st.privates) ? st.privates : [];
  const recips = await SMS.recipients(db); const byPid = {}; for (const r of recips) byPid[r.id] = r;
  const out = { checked: 0, sent: 0, skipped: 0, errors: [] };
  for (const pv of privates) {
    if (!pv || !pv.date || !pv.id) continue; const startAt = etEpoch(pv.date, Number(pv.start)); if (!Number.isFinite(startAt) || startAt < now - 3600e3 || startAt > now + 48 * 3600e3) continue;
    out.checked++;
    const ref = db.doc('lessonReminders/' + pv.id); const done = (await ref.get()).data() || {};
    const fam = byPid[pv.pid]; const famName = fam ? first(fam.name) : 'your player';
    const when = `${fmtDay(pv.date)} ${fmtT(Number(pv.start))}–${fmtT(Number(pv.start) + (Number(pv.dur) || 1))} · ${courtName(pv.court)}`;
    const eveBefore = etEpoch(pv.date, 18) - 24 * 3600e3;   // 6 PM the day before
    // Antonio, Oct 24: a confirmation the moment it is booked (the page and /lesson/booked do that) and one reminder an hour before. No evening-before text.
    void eveBefore;
    const steps = [
      { key: 'hourBefore', due: startAt - now <= 3600e3 && startAt - now > 1800e3, fam: `${famName}'s private with ${first(pv.coach)} starts in an hour · ${courtName(pv.court)}.`, coach: `In an hour: ${fam ? fam.name : pv.pid} · ${courtName(pv.court)}.` }
    ];
    for (const s of steps) {
      if (!s.due || done[s.key]) continue;
      const mark = { [s.key]: Date.now() };
      try {
        if (fam && fam.phone && fam.valid && fam.optIn) { if (await NOTIFY.text(db, fam.phone, s.fam)) out.sent++; else out.skipped++; } else out.skipped++;
        const how = (await tellCoach(db, pv.coach, s.coach)).how; if (how !== 'none') out.sent++; else out.skipped++;
        await ref.set(mark, { merge: true });
        if (log) log(`${s.key} · ${pv.id} · ${when}`);
      } catch (e) { out.errors.push(pv.id + ': ' + e.message); }
    }
  }
  return out;
}

/* Link every active staff member's personal Slack by their sign-in e-mail (owners, from Messages → Settings → Coach alerts). */
async function linkSlack(db) {
  const snap = await db.collection('staff').where('active', '==', true).get(); const out = { linked: [], missing: [] };
  for (const d of snap.docs) { const r = d.data() || {}; const u = await NOTIFY.slackUserByEmail(db, d.id); if (u) { await d.ref.set({ slackId: u.id, slackName: u.name }, { merge: true }); out.linked.push({ email: d.id, name: r.name || d.id, slack: u.name }); } else out.missing.push({ email: d.id, name: r.name || d.id }); }
  return out;
}
module.exports = { booked, cancelled, remind, etEpoch, linkSlack };
