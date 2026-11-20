'use strict';
/* Payroll from the schedule (Antonio, Nov 20, 2026): "every month, boom, we get how many hours they worked in academy, how many
   privates, and we pay them." Nothing is paid from here; this is the sheet the owners pay from.
     settings/payroll   { coaches: { <key>: { hourly, privPrice, privPct } } }   what each coach earns: an hour of academy, and
                        the share of a private hour (the price of the private and the coach's part of it)
     payExtras/<id>     { key, coach, date, label, hours, amount, status, by, at }   anything outside the schedule: a tournament,
                        an event, a correction. A coach asks for one; an owner approves it. An owner's own entry is approved.
   The hours come from what is already on the calendar: academy hours follow the players on the coach's name (less approved days
   off and blocked time), privates are the ones booked and not canceled. Owners only, apart from a coach asking for an extra. */
const S = require('./stripe');
const CAL = require('./calendar');
const CC = require('./coachcal');
const SCH = require('./schedule');
const { fold, isDate, DOW3 } = CC;

let CLOCK = () => Date.now();
const r2 = (n) => Math.round(n * 100) / 100;
const DEF = { hourly: 0, privPrice: 150, privPct: 70 };
async function rates(db) { try { const s = await db.doc('settings/payroll').get(); return (s.exists && (s.data() || {}).coaches) || {}; } catch (e) { return {}; } }
const rateOf = (all, key) => Object.assign({}, DEF, all[key] || {}, { set: !!all[key] });
const owner = (who) => { if (!who.owner) throw S.err(403, 'owner', 'Payroll is for the owners.'); };
function range(body) { const from = String(body.from || ''), to = String(body.to || ''); if (!isDate(from) || !isDate(to) || to < from) throw S.err(400, 'dates', 'Pick the first and the last day.'); const days = []; for (let d = from; d <= to && days.length < 100; d = CAL.addDays(d, 1)) days.push(d); if (days[days.length - 1] !== to) throw S.err(400, 'dates', 'That is more than 100 days. Pick a shorter period.'); return { from, to, days }; }

/* The academy hours a coach worked on one day: the hours of their groups, less what was blocked off. */
function academyOn(hours, cal, date) {
  const rs = hours[DOW3[CAL.dow(date)]] || []; const off = ((cal && cal.off) || []).filter((o) => o && o.date === date); let h = 0;
  rs.forEach(([a, b]) => { let cut = 0; CC.merge(off.map((o) => [Math.max(a, Number(o.start)), Math.min(b, Number(o.end))]).filter((x) => x[1] > x[0])).forEach((x) => { cut += x[1] - x[0]; }); h += (b - a) - cut; });
  return h;
}
async function report(db, who, body) {
  owner(who); const { from, to, days } = range(body); const today = CAL.todayET();
  const sc = await SCH.scope(db, { owner: true, keys: [] }); const all = await rates(db); const players = await CC.roster(db);
  const extras = []; try { (await db.collection('payExtras').where('date', '>=', from).get()).docs.forEach((d) => { const x = d.data() || {}; if (x.date <= to) extras.push(Object.assign({ id: d.id }, x)); }); } catch (e) { /* none */ }
  const rows = [];
  for (const c of sc.all) {
    const rate = rateOf(all, c.key); const cal = await CC.calDoc(db, c.key); const hours = CC.academyHours(players, c.key);
    let academy = 0, ahead = 0; days.forEach((d) => { const h = academyOn(hours, cal, d); academy += h; if (d > today) ahead += h; });
    const pv = (await CC.privatesOf(db, c.key, from, to)); const privH = pv.reduce((n, x) => n + Number(x.dur || 0), 0);
    const mine = extras.filter((x) => x.key === c.key); const ok = mine.filter((x) => x.status === 'approved');
    const exAmt = ok.reduce((n, x) => n + (Number(x.amount) || 0) + (Number(x.hours) || 0) * (x.amount ? 0 : rate.hourly), 0); const exH = ok.reduce((n, x) => n + (Number(x.hours) || 0), 0);
    const privPay = rate.set ? rate.privPrice * rate.privPct / 100 : 0;                 // no money is shown for a coach until an owner has saved their rates
    if (!academy && !privH && !mine.length && !rate.set) continue;
    rows.push({ key: c.key, name: c.name, kind: c.kind, rate: { hourly: rate.hourly, privPrice: rate.privPrice, privPct: rate.privPct, set: rate.set }, academyHours: r2(academy), aheadHours: r2(ahead), privateHours: r2(privH), privates: pv.length, privatePerHour: r2(privPay),
      extraHours: r2(exH), extras: mine.sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ id: x.id, date: x.date, label: x.label, hours: Number(x.hours) || 0, amount: Number(x.amount) || 0, status: x.status })),
      pay: { academy: r2(academy * rate.hourly), privates: r2(privH * privPay), extras: r2(exAmt), total: r2(academy * rate.hourly + privH * privPay + exAmt) } });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const sum = (f) => r2(rows.reduce((n, r) => n + f(r), 0));
  return { from, to, today, rows, pending: extras.filter((x) => x.status === 'pending').length, totals: { academyHours: sum((r) => r.academyHours), privateHours: sum((r) => r.privateHours), pay: sum((r) => r.pay.total) }, noRate: rows.filter((r) => !r.rate.set).length };
}
async function setRate(db, who, body) {
  owner(who); const key = fold(body.coach); if (!key) throw S.err(400, 'coach', 'Which coach?');
  const n = (v, max) => { const x = Number(v); if (!Number.isFinite(x) || x < 0 || x > max) throw S.err(400, 'rate', 'Check the numbers.'); return r2(x); };
  const rec = { hourly: n(body.hourly, 1000), privPrice: n(body.privPrice, 2000), privPct: n(body.privPct, 100), by: who.email, at: CLOCK() };
  await db.doc('settings/payroll').set({ coaches: { [key]: rec } }, { merge: true }); return { ok: true, rate: rec };
}
/* An extra: an owner's is approved at once; a coach's waits for an owner. */
async function addExtra(db, who, body, deps) {
  const date = String(body.date || ''); if (!isDate(date)) throw S.err(400, 'date', 'Pick the day.');
  const label = S.clean(body.label, 120); if (!label) throw S.err(400, 'label', 'Say what it was: a tournament, an event, extra hours.');
  const hours = Number(body.hours) || 0; if (hours < 0 || hours > 24) throw S.err(400, 'hours', 'Check the hours.');
  const sc = await SCH.scope(db, who); let key, amount = 0, status = 'pending';
  if (who.owner) { key = fold(body.coach); if (!sc.all.some((c) => c.key === key)) throw S.err(400, 'coach', 'Which coach?'); amount = Number(body.amount) || 0; if (Math.abs(amount) > 100000) throw S.err(400, 'amount', 'Check the amount.'); status = 'approved'; }
  else { key = sc.own; if (!key) throw S.err(404, 'coach', 'No calendar is on your name yet.'); if (date > CAL.todayET()) throw S.err(400, 'date', 'Add it once it has happened.'); if (!hours) throw S.err(400, 'hours', 'How many hours?'); }
  if (!hours && !amount) throw S.err(400, 'hours', 'Add the hours or an amount.');
  const coach = (sc.all.find((c) => c.key === key) || {}).name || key; const ref = db.collection('payExtras').doc();
  await ref.set({ key, coach, date, label, hours: r2(hours), amount: r2(amount), status, by: who.email, at: CLOCK() });
  if (status === 'pending') { try { if (deps && deps.tellOwners) await deps.tellOwners(`Extra hours to approve: ${coach}, ${date}, ${label}, ${r2(hours)} h. Open Payroll in Admin.`); } catch (e) { /* it shows on the Payroll page */ } }
  return { ok: true, id: ref.id, status };
}
async function decideExtra(db, who, body) {
  owner(who); const ref = db.doc('payExtras/' + S.clean(body.id, 80)); const s = await ref.get(); if (!s.exists) throw S.err(404, 'extra', 'Not found.');
  if (body.remove === true) { await ref.delete(); return { ok: true, removed: true }; }
  await ref.set({ status: body.ok === true ? 'approved' : 'declined', decidedBy: who.email, decidedAt: CLOCK() }, { merge: true }); return { ok: true };
}
/* What a coach sees of their own extras: the last 60 days. */
async function myExtras(db, who) {
  const sc = await SCH.scope(db, who); const from = CAL.addDays(CAL.todayET(), -60); const out = [];
  try { (await db.collection('payExtras').where('date', '>=', from).get()).docs.forEach((d) => { const x = d.data() || {}; if (x.key === sc.own) out.push({ id: d.id, date: x.date, label: x.label, hours: x.hours, status: x.status }); }); } catch (e) { /* none */ }
  return { list: out.sort((a, b) => b.date.localeCompare(a.date)) };
}
module.exports = { report, setRate, addExtra, decideExtra, myExtras, academyOn, DEF, _clock: (f) => { CLOCK = f || (() => Date.now()); } };
