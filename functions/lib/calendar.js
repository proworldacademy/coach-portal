/* ProWorld billing calendar — training days, break weeks, proration.
   Pure functions over the rules in billing-rules.json (the same rules the backend page shows).
   Dates are 'YYYY-MM-DD' strings in the academy's own calendar (America/New_York); no Date-object time zones involved. */
'use strict';
const RULES = require('../billing-rules.json');

const TZ = 'America/New_York';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;                       // m is 0-based
function parts(s) { const [y, m, d] = String(s).split('-').map(Number); return { y, m: m - 1, d }; }
function dow(s) { const { y, m, d } = parts(s); return new Date(Date.UTC(y, m, d)).getUTCDay(); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
function addDays(s, n) { const { y, m, d } = parts(s); const t = new Date(Date.UTC(y, m, d + n)); return ymd(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); }
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/* Today's date in the academy's time zone, from a JS Date (defaults to now). */
function todayET(now) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now || new Date());   // en-CA gives YYYY-MM-DD
}
/* Unix seconds for a wall-clock time in the academy's time zone (DST-safe). */
function unixET(s, hour, minute) {
  const { y, m, d } = parts(s);
  let guess = Date.UTC(y, m, d, hour || 0, minute || 0);
  for (let i = 0; i < 2; i++) {                                                   // converge on the right offset (DST edges)
    const off = tzOffsetMinutes(guess);
    guess = Date.UTC(y, m, d, hour || 0, minute || 0) - off * 60000;
  }
  return Math.floor(guess / 1000);
}
function tzOffsetMinutes(utcMs) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {}; for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}
/* 'YYYY-MM-DD' in the academy's time zone for a unix timestamp. */
function dateOfUnixET(unix) { return todayET(new Date(unix * 1000)); }

/* ── the rules ── */
function inTerm(s) { return RULES.terms.some((t) => s >= t.from && s <= t.to); }
function inBreak(s) { return RULES.breaks.some((b) => s >= b.from && s <= b.to); }
function isTrainingDay(s) {
  const w = dow(s);
  if (w === 0 || w === 6) return false;
  if (!inTerm(s) || inBreak(s)) return false;
  return !(RULES.closed_days || []).includes(s);
}
function weekdaysIn(y, m) { let n = 0; for (let d = 1; d <= daysInMonth(y, m); d++) { const w = dow(ymd(y, m, d)); if (w && w < 6) n++; } return n; }
function trainingDaysIn(y, m, fromDay) { let n = 0; for (let d = fromDay || 1; d <= daysInMonth(y, m); d++) if (isTrainingDay(ymd(y, m, d))) n++; return n; }
/* Whole dollars: price × training days ÷ weekdays, rounded — the published rule. priceCents in, cents out (dollar-rounded). */
function monthChargeCents(priceCents, y, m, fromDay) {
  const td = trainingDaysIn(y, m, fromDay), wk = weekdaysIn(y, m);
  return Math.round((priceCents / 100) * td / wk) * 100;
}
function breaksIn(y, m) { const a = ymd(y, m, 1), z = ymd(y, m, daysInMonth(y, m)); return RULES.breaks.filter((b) => b.from <= z && b.to >= a); }
function firstTrainingDay(from) { let s = from; for (let i = 0; i < 400; i++) { if (isTrainingDay(s)) return s; s = addDays(s, 1); } return null; }
function nextFirst(s) { const { y, m } = parts(s); return ymd(m === 11 ? y + 1 : y, (m + 1) % 12, 1); }
function monthLabel(y, m) { return MONTHS_LONG[m] + ' ' + y; }
function monthNote(y, m) {
  const td = trainingDaysIn(y, m, 1), wk = weekdaysIn(y, m);
  if (td === wk) return '';
  if (td === 0) return breaksIn(y, m).map((b) => b.label).join(' + ') + ' — no tuition';
  return td + ' of ' + wk + ' training days · ' + breaksIn(y, m).map((b) => b.label.toLowerCase()).join(' + ') + ' off';
}
/* The factor and credit for a month: full price minus the training-day charge. */
function monthFactor(y, m) { const td = trainingDaysIn(y, m, 1), wk = weekdaysIn(y, m); return { trainingDays: td, weekdays: wk, factor: td / wk }; }
function monthCreditCents(priceCents, y, m) { return priceCents - monthChargeCents(priceCents, y, m, 1); }

/* The first-month quote for a monthly plan that starts on `start` (YYYY-MM-DD).
   Returns the one-time amount due now (remaining training days of the start month), the anchor (the next 1st) and the words for the receipt. */
function firstMonthQuote(priceCents, start) {
  const s = firstTrainingDay(start);
  if (!s) return { ok: false, reason: 'No training days scheduled from ' + start + '.' };
  const { y, m, d } = parts(s);
  const td = trainingDaysIn(y, m, d), wk = weekdaysIn(y, m), full = trainingDaysIn(y, m, 1);
  const cents = monthChargeCents(priceCents, y, m, d);
  const prorated = td < wk;
  const label = MONTHS_LONG[m] + ' tuition' + (prorated ? ' (prorated: ' + td + ' of ' + wk + ' training days' + (d > 1 ? ', from ' + MONTHS[m] + ' ' + d : '') + (breaksIn(y, m).length ? ', ' + breaksIn(y, m).map((b) => b.label.toLowerCase()).join(' + ') + ' off' : '') + ')' : '');
  const anchor = nextFirst(s);
  const an = parts(anchor);
  const nextCents = monthChargeCents(priceCents, an.y, an.m, 1);
  const nextNote = monthNote(an.y, an.m);
  return { ok: true, start: s, startMonth: { y, m }, trainingDays: td, weekdays: wk, fullTrainingDays: full, cents, label, anchor, anchorUnix: unixET(anchor, 6, 0),
    next: { date: anchor, cents: nextCents, note: nextNote, label: MONTHS[an.m] + ' 1' } };
}

module.exports = { RULES, TZ, MONTHS, MONTHS_LONG, ymd, parts, dow, daysInMonth, addDays, cmp, todayET, unixET, dateOfUnixET, tzOffsetMinutes,
  isTrainingDay, inTerm, inBreak, weekdaysIn, trainingDaysIn, monthChargeCents, monthCreditCents, monthFactor, breaksIn, firstTrainingDay, nextFirst, monthLabel, monthNote, firstMonthQuote };
