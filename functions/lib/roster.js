/* One player record drives everything. The moment Stripe confirms a payment, this file puts the player where the team looks:
     players/<id>                    the roster the Coach Portal, the Coach Board and the backend (attendance, players, courts) read
     players/<id>/private/contact    the parent's name, email and phone (behind a button, never in lists)
     outbox/<auto>                   "new player" for the morning Monday sync → LEADS · New Requests, so the front desk places them
     enrollments/<checkout session>  the ledger: every paid checkout once, with what was bought and whom we told
     tryouts/<auto>                  a free soccer session requested online, for the front desk to confirm
   and tells the people who need to know: the coaches (Slack), the front desk (Slack) and the family (a text, when switched on).
   Every function here is idempotent — the thank-you page, the nightly sweep and a staff retry may all call it for the same payment. */
'use strict';
const CAL = require('./calendar');
const CAT = require('./catalog');
const S = require('./stripe');
const NOTIFY = require('./notify');

const SITE = 'https://proworld-coach-portal.web.app';
const GROUP_OF = { fulltime: 'ft', afterschool: 'as', u10adv: 'u10', u10path: 'u10', tots: 'u10', soccer: '', fitness: '' };
const GROUP_LABEL = { ft: 'Full Time', as: 'Afterschool 4PM', u10: '10 & Under', tour: 'Tour Team', camp: 'Campers' };
const SPORT_OF = { soccer: 'soccer', fitness: 'fitness' };
const KEEP_PURCHASES = 30;
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function slug(s) { return fold(s).replace(/ /g, '-').slice(0, 40) || 'player'; }
function money(c) { return '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }); }
function niceDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return s || ''; const p = CAL.parts(s); return `${DOWS[CAL.dow(s)]} ${CAL.MONTHS[p.m]} ${p.d}`; }
function splitName(full) { const t = String(full || '').trim().split(/\s+/).filter(Boolean); return { first: t[0] || '', last: t.slice(1).join(' ') }; }
function shortName(full) { const { first, last } = splitName(full); return (first + (last ? ' ' + last.charAt(0).toUpperCase() + '.' : '')).trim(); }
function groupWord(g) { return GROUP_LABEL[g] || 'not in a group yet'; }
function playerLink(pid) { return `${SITE}/portal#/p/${encodeURIComponent(pid)}`; }
function stripeLink(mode, kind, id) { return `https://dashboard.stripe.com/${mode === 'live' ? '' : 'test/'}${kind}/${id}`; }

/* ── the family on a checkout session ── */
async function familyOf(stripe, session) {
  const m = session.metadata || {};
  const c = session.customer && typeof session.customer === 'object' ? session.customer : null;
  let email = (session.customer_details && session.customer_details.email) || (c && c.email) || '';
  let phone = m.parent_phone || (session.customer_details && session.customer_details.phone) || (c && c.phone) || '';
  let name = m.parent || (c && c.name) || (session.customer_details && session.customer_details.name) || '';
  const customer = S.customerId(session.customer);
  if ((!email || !phone || !name) && customer && stripe && stripe.customers && stripe.customers.retrieve) {
    try { const full = await stripe.customers.retrieve(customer); email = email || full.email || ''; phone = phone || full.phone || ''; name = name || full.name || ''; } catch (e) { /* the metadata is enough */ }
  }
  return { customer, name: String(name).trim(), email: String(email).trim().toLowerCase(), phone: String(phone).trim(), dob: m.player_dob || '' };
}

/* ── what was bought, from the session's metadata ── */
function purchasesOf(session) {
  const m = session.metadata || {}; const lines = CAT.oneTimeLines(); const out = [];
  for (const raw of String(m.items || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    // "lookup" or "lookupx3" — and a lookup key may itself end in x<digits> (flex10), so the whole string is tried first
    let lookup = raw, qty = 1;
    if (!lines[raw]) { const mm = raw.match(/^(.+)x(\d+)$/); if (mm && lines[mm[1]]) { lookup = mm[1]; qty = parseInt(mm[2], 10) || 1; } }
    const l = lines[lookup]; if (!l) continue;
    out.push({ lookup, qty, kind: l.kind, label: l.label, cents: Math.round(l.price * 100) * qty, program: l.program || '', camp: l.camp || '', sessions: (l.sessions || 0) * qty, hours: (l.hours || 0) * qty });
  }
  return out;
}
function rosterRole(purchases) {
  // what kind of record a purchase earns: a camp → Campers; a pack, a week, a drop-in or a lesson → a player; a court alone → nobody
  const kinds = new Set(purchases.map((p) => p.kind));
  if (kinds.has('pack') || kinds.has('weekly') || kinds.has('dropin')) { const p = purchases.find((x) => ['pack', 'weekly', 'dropin'].includes(x.kind)); return { kind: p.kind, program: p.program, group: GROUP_OF[p.program] || '' }; }
  if (kinds.has('camp')) return { kind: 'camp', program: '', group: 'camp' };
  if (kinds.has('lesson') || kinds.has('lesson_package')) return { kind: 'lesson', program: '', group: '' };
  return null;
}

/* ── find the player this payment belongs to: the same name on the roster wins, whatever its source ── */
async function findPlayer(db, name) {
  const key = fold(name); if (!key) return null;
  const snap = await db.collection('players').get();
  const same = [];
  snap.docs.forEach((d) => { const x = d.data() || {}; if (fold(x.name) === key || (x.shortName && fold(x.shortName) === key)) same.push({ id: d.id, data: x }); });
  if (!same.length) return null;
  const rank = (p) => (p.data.status === 'active' ? 0 : p.data.status === 'away' ? 1 : 2) * 10 + (p.data.mondayId ? 0 : 1);
  return same.sort((a, b) => rank(a) - rank(b))[0];
}
async function newPlayerId(db, name, group, salt) {
  const { first, last } = splitName(name);
  const base = `${group || 'new'}-${slug(first)}${last ? '-' + slug(last).charAt(0) : ''}`;
  if (!(await db.doc('players/' + base).get()).exists) return base;
  return `${base}-${String(salt || Date.now()).replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase()}`;
}

/* ── the ledger + the roster for one paid checkout session (idempotent) ── */
async function record(db, stripe, session, sub, opts) {
  opts = opts || {}; const log = opts.log || (() => {});
  if (!db || !session || session.status !== 'complete') return null;
  const paid = session.payment_status === 'paid' || (session.mode === 'subscription' && !!session.subscription);
  if (!paid) return null;
  const ledger = db.doc('enrollments/' + session.id);
  const have = await ledger.get();
  if (have.exists && have.data().done) return Object.assign({ fresh: false }, have.data());

  const m = session.metadata || {}; const now = Date.now(); const today = CAL.todayET();
  const playerName = String(m.player || '').replace(/\s+/g, ' ').trim();
  if (!playerName) return null;
  const family = await familyOf(stripe, session);
  const { first, last } = splitName(playerName);
  const isProgram = m.kind === 'program';
  const purchases = isProgram ? [] : purchasesOf(session);
  const role = isProgram ? { kind: 'monthly', program: m.program, group: GROUP_OF[m.program] || '' } : rosterRole(purchases);
  const prog = isProgram ? CAT.program(m.program) : (role && role.program ? CAT.program(role.program) : null);
  const plan = isProgram ? CAT.plan(m.program, m.plan) : null;
  const days = isProgram ? String(m.days || '').split(',').filter(Boolean) : [];
  const subId = sub ? sub.id : (typeof session.subscription === 'string' ? session.subscription : session.subscription && session.subscription.id) || null;
  const end = sub ? S.periodEnd(sub) : null; const nextDate = end ? CAL.dateOfUnixET(end) : null;
  const next = plan && nextDate ? { date: nextDate, cents: (() => { const p = CAL.parts(nextDate); return CAL.monthChargeCents(plan.monthly * 100, p.y, p.m, 1); })() } : null;
  const what = isProgram
    ? `${prog ? prog.short : m.program} · ${plan ? plan.label : m.plan_label || ''}${days.length && plan && prog && plan.days < prog.days.length ? ' · ' + days.join('/') : ''}`
    : purchases.map((p) => p.label + (p.qty > 1 ? ' × ' + p.qty : '')).join(' + ');
  const paidCents = session.amount_total || purchases.reduce((n, p) => n + p.cents, 0) || 0;

  // the player record: the same name already on the roster (from Monday, a coach or an earlier payment) is reused, never duplicated
  let pid = null, existing = null, created = false, back = false;
  if (role) {
    existing = await findPlayer(db, playerName);
    const batch = db.batch();
    const enroll = isProgram ? {
      kind: 'monthly', program: m.program, programName: prog ? prog.name : m.program_name || '', programShort: prog ? prog.short : '', plan: m.plan, planLabel: plan ? plan.label : m.plan_label || '',
      days, start: m.start || today, monthly: plan ? plan.monthly : 0, subscription: subId, customer: family.customer, session: session.id,
      status: sub ? sub.status : 'active', hold: false, endsOn: null, next: next || null, at: now
    } : null;
    const purchase = purchases.length ? purchases.map((p) => ({ at: now, session: session.id, kind: p.kind, label: p.label, cents: p.cents, lookup: p.lookup, qty: p.qty, sessions: p.sessions, hours: p.hours, program: p.program, camp: p.camp })) : [];
    if (existing) {
      pid = existing.id; const x = existing.data;
      const patch = { updatedAt: now };
      if (x.status !== 'active') { patch.status = 'active'; back = true; }
      if (enroll) patch.enroll = enroll;
      else if (!x.enroll) patch.enroll = { kind: role.kind, program: role.program || '', programShort: prog ? prog.short : '', customer: family.customer, session: session.id, at: now, label: what };
      if (!x.group && role.group) patch.group = role.group;
      if (purchase.length) patch.purchases = (Array.isArray(x.purchases) ? x.purchases : []).concat(purchase).slice(-KEEP_PURCHASES);
      if (!x.sport && prog && SPORT_OF[prog.id]) patch.sport = SPORT_OF[prog.id];
      batch.set(db.doc('players/' + pid), patch, { merge: true });
    } else {
      pid = await newPlayerId(db, playerName, role.group, session.id); created = true;
      const doc = { name: playerName, shortName: shortName(playerName), group: role.group || '', tier: '', coach: '', coach2: '', fitness: '', status: 'active', source: 'enroll',
        createdAt: now, updatedAt: now, createdBy: 'Online enrollment',
        enroll: enroll || { kind: role.kind, program: role.program || '', programShort: prog ? prog.short : '', customer: family.customer, session: session.id, at: now, label: what } };
      if (prog && SPORT_OF[prog.id]) doc.sport = SPORT_OF[prog.id];
      if (purchase.length) doc.purchases = purchase;
      batch.set(db.doc('players/' + pid), doc);
      // for the front desk on Monday (LEADS · New Requests) with the morning sync — the same note a coach's "add player" leaves
      const note = `Enrolled online on ${niceDate(today)}: ${what}${isProgram && m.start ? ', starts ' + niceDate(m.start) : ''}, paid ${money(paidCents)}. Parent: ${family.name}${family.phone ? ', ' + family.phone : ''}${family.email ? ', ' + family.email : ''}.`.slice(0, 400);
      batch.set(db.collection('outbox').doc(), { type: 'add', pid, name: playerName, first, last, group: role.group || '', coach: '', note, by: 'engine@proworldacademy.com', byName: 'Online enrollment', at: now, state: 'queued' });
    }
    const contact = { guardian: family.name, email: family.email, phone: family.phone, source: 'enroll', updatedAt: now };
    if (family.dob) contact.dob = family.dob;
    batch.set(db.doc(`players/${pid}/private/contact`), contact, { merge: true });
    batch.set(ledger, { session: session.id, kind: isProgram ? 'program' : 'items', mode: opts.mode || 'test', player: pid, playerName, created, what,
      program: role.program || '', programShort: prog ? prog.short : '', plan: m.plan || '', planLabel: plan ? plan.label : '', days, start: m.start || '', monthly: plan ? plan.monthly : 0,
      subscription: subId, customer: family.customer, parentName: family.name, paidCents, items: purchases.map((p) => p.lookup + (p.qty > 1 ? 'x' + p.qty : '')), at: now, by: m.by || 'enroll', done: true }, { merge: true });
    await batch.commit();
    log(`roster: ${created ? 'new player' : back ? 'back on the roster' : 'existing player'} ${pid} ← ${what} (${session.id})`);
  } else {
    await ledger.set({ session: session.id, kind: 'items', mode: opts.mode || 'test', player: null, playerName, created: false, what, items: purchases.map((p) => p.lookup + (p.qty > 1 ? 'x' + p.qty : '')), customer: family.customer, parentName: family.name, paidCents, at: now, by: m.by || 'enroll', done: true }, { merge: true });
    log(`ledger: ${what || 'purchase'} by ${playerName} (${session.id}) — no roster change`);
  }

  // tell the team and the family
  const told = { coaches: false, desk: false, family: false };
  const link = pid ? playerLink(pid) : null; const coachWord = existing && existing.data.coach ? 'Coach ' + existing.data.coach : 'no coach yet';
  const groupNow = pid ? (existing && existing.data.group) || (role && role.group) || '' : '';
  if (isProgram) {
    const head = `*New player: ${playerName}* — ${what}${m.start ? ' · starts ' + niceDate(m.start) : ''}`;
    told.coaches = await NOTIFY.slack(db, 'coaches', `New player: ${playerName} — ${what}`, [head,
      `Group: ${groupWord(groupNow)} · ${coachWord}${created ? ' → assign one and run the first assessment' : back ? ' · back on the roster' : ''}`,
      link ? `<${link}|Open ${first} in the Coach Portal>` : '', 'Enrolled online and paid through Stripe. The front desk has the family’s details.']);
    told.desk = await NOTIFY.slack(db, 'desk', `Enrolled online: ${playerName} — ${what}`, [`*Enrolled online: ${playerName}* — ${what}${m.start ? ' · starts ' + niceDate(m.start) : ''}`,
      `Paid today ${money(paidCents)}${next ? ' · next ' + (next.cents ? money(next.cents) : 'no charge') + ' on ' + niceDate(next.date) : ''}${plan ? ' · ' + money(plan.monthly * 100) + ' a month' : ''}`,
      `Parent: ${family.name || '—'}${family.phone ? ' · ' + family.phone : ''}${family.email ? ' · ' + family.email : ''}`,
      `Roster: ${created ? 'new record' : 'existing record'} (${groupWord(groupNow)}) · Monday: ${created ? 'goes to LEADS → New Requests with the morning sync' : 'already on the roster'}`,
      [subId ? `<${stripeLink(opts.mode, 'subscriptions', subId)}|Stripe>` : '', link ? `<${link}|Coach Portal>` : ''].filter(Boolean).join(' · ')]);
    const t0 = prog && prog.time ? prog.time.split('–')[0].trim() : '';
    const when = /^\d/.test(t0) ? ' at ' + t0 + (/[AP]M/i.test(t0) ? '' : ' PM') : '';
    told.family = await NOTIFY.text(db, family.phone, `ProWorld Academy: ${first} is enrolled in ${prog ? prog.short : m.program}${plan ? ', ' + plan.label.toLowerCase() : ''}${days.length && plan && prog && plan.days < prog.days.length ? ' (' + days.join(', ') + ')' : ''}, starting ${niceDate(m.start || today)}${when}. ${paidCents ? 'Paid today: ' + money(paidCents) + '. ' : ''}${next ? 'Next: ' + (next.cents ? money(next.cents) : 'no charge') + ' on ' + niceDate(next.date) + ', then ' + money(plan.monthly * 100) + ' on the 1st of each month. ' : ''}Receipts and your card: see the email from Stripe.`);
  } else if (purchases.length) {
    const forCoaches = role && role.kind !== 'lesson';
    if (forCoaches) told.coaches = await NOTIFY.slack(db, 'coaches', `${role.kind === 'camp' ? 'Camp sign-up' : 'New'}: ${playerName} — ${what}`, [`*${role.kind === 'camp' ? 'Camp sign-up' : role.kind === 'pack' ? 'Pack bought' : role.kind === 'weekly' ? 'Week booked' : 'Drop-in'}: ${playerName}* — ${what}`,
      `${groupWord(groupNow)} · ${coachWord}${created ? ' · new on the roster' : ''}`, link ? `<${link}|Open ${first} in the Coach Portal>` : '']);
    told.desk = await NOTIFY.slack(db, 'desk', `Bought online: ${playerName} — ${what}`, [`*Bought online: ${playerName}* — ${what} · ${money(paidCents)}`,
      `Parent: ${family.name || '—'}${family.phone ? ' · ' + family.phone : ''}${family.email ? ' · ' + family.email : ''}`,
      pid ? `Roster: ${created ? 'new record' : 'existing record'} (${groupWord(groupNow)})` : 'No roster change (a court or a lesson only).',
      [`<${stripeLink(opts.mode, 'payments', session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent.id : session.payment_intent || '')}|Stripe>`, link ? `<${link}|Coach Portal>` : ''].filter(Boolean).join(' · ')]);
    told.family = await NOTIFY.text(db, family.phone, `ProWorld Academy: thank you — ${what} for ${first} is confirmed (${money(paidCents)}). ${role && role.kind === 'camp' ? 'See you at camp.' : role && (role.kind === 'pack' || role.kind === 'weekly') ? 'The front desk books the sessions with you; call ' + NOTIFY.FRONT_DESK + ' any time.' : 'The front desk will confirm the day and time.'}`);
  }
  await ledger.set({ told, toldAt: Date.now() }, { merge: true });
  return Object.assign({ fresh: true }, (await ledger.get()).data());
}

/* A free soccer session requested online: a try-out for the front desk to confirm (no payment, no Stripe session). */
async function recordTrial(db, trial, opts) {
  opts = opts || {}; const log = opts.log || (() => {});
  if (!db || !trial || !trial.playerName) return null;
  const now = Date.now(); const today = CAL.todayET();
  const prog = CAT.program(trial.program) || CAT.program('soccer');
  const ref = db.collection('tryouts').doc();
  const parent = trial.parent || {};
  await ref.set({ name: trial.playerName, born: trial.player && trial.player.dob || '', group: '', coach: '', date: '', time: '', parent: parent.name || '', phone: parent.phone || '', email: parent.email || '',
    level: '', source: 'Online — free ' + (prog ? prog.short.toLowerCase() : 'soccer') + ' session', notes: `Requested online on ${niceDate(today)}. ${prog && prog.id === 'soccer' ? 'Soccer trains Tue/Thu 5:00–6:30 PM and Sat 9:00–10:30 AM — confirm the day with the family.' : 'Confirm the day and time with the family.'}`,
    status: 'planned', outcome: '', checks: {}, createdAt: now, updatedAt: now, by: 'Online enrollment' });
  log(`tryout ${ref.id}: free session for ${trial.playerName}`);
  const told = { coaches: false, desk: false, family: false };
  told.desk = await NOTIFY.slack(db, 'desk', `Free session requested: ${trial.playerName}`, [`*Free ${prog ? prog.short.toLowerCase() : 'soccer'} session requested online: ${trial.playerName}*${trial.player && trial.player.dob ? ' · born ' + trial.player.dob : ''}`,
    `Parent: ${parent.name || '—'}${parent.phone ? ' · ' + parent.phone : ''}${parent.email ? ' · ' + parent.email : ''}`, 'Confirm the day and time with the family — it is on the Try-outs list in the Coach Portal.', `<${SITE}/portal#/tryouts|Open Try-outs>`]);
  told.coaches = await NOTIFY.slack(db, 'coaches', `Try-out requested: ${trial.playerName} (free ${prog ? prog.short.toLowerCase() : 'soccer'} session)`, [`*Try-out requested online: ${trial.playerName}* — free ${prog ? prog.short.toLowerCase() : 'soccer'} session`, 'The front desk confirms the day; it is on the Try-outs list.']);
  told.family = await NOTIFY.text(db, parent.phone, `ProWorld Academy: ${splitName(trial.playerName).first}'s free ${prog ? prog.short.toLowerCase() : 'soccer'} session is reserved. The front desk will text you to confirm the day${prog && prog.id === 'soccer' ? ' (Tue/Thu 5:00 PM or Sat 9:00 AM)' : ''}. Nothing was charged.`);
  await db.doc('enrollments/trial_' + ref.id).set({ session: null, kind: 'trial', player: null, tryout: ref.id, playerName: trial.playerName, what: (prog ? prog.short : 'Soccer') + ' · free session', parentName: parent.name || '', paidCents: 0, at: now, by: trial.by || 'enroll', told, done: true });
  return { tryout: ref.id, told };
}

/* ── the plan's state on the player record: hold, cancel, ends, back ── */
async function findBySubscription(db, subId) {
  if (!db || !subId) return null;
  const snap = await db.collection('players').where('enroll.subscription', '==', subId).get();
  if (!snap.docs.length) return null;
  const d = snap.docs[0]; return { id: d.id, data: d.data() || {} };
}
async function setPlan(db, subId, patch, opts) {
  opts = opts || {}; const log = opts.log || (() => {});
  const p = await findBySubscription(db, subId); if (!p) return null;
  const en = Object.assign({}, p.data.enroll || {}, patch, { updatedAt: Date.now() });
  const upd = { enroll: en, updatedAt: Date.now() };
  if (patch.status === 'canceled' && p.data.source === 'enroll' && p.data.status === 'active') upd.status = 'finished';
  if (patch.status === 'active' && p.data.status === 'finished' && p.data.source === 'enroll') upd.status = 'active';
  await db.doc('players/' + p.id).set(upd, { merge: true });
  log(`plan ${subId} → ${p.id}: ${JSON.stringify(patch)}`);
  return Object.assign({}, p, { data: Object.assign({}, p.data, upd) });
}

/* Tell the coaches and the family when a plan is paused, released or back — the words for each step of the late policy. */
async function tell(db, step, p, extra) {
  extra = extra || {}; const name = p && p.data ? p.data.name : (extra.player || 'a player'); const first = splitName(name).first;
  const prog = p && p.data && p.data.enroll ? p.data.enroll.programShort || '' : (extra.program || '');
  const link = p ? playerLink(p.id) : null; const url = extra.url ? ` Pay or update the card here: ${extra.url}` : '';
  const month = extra.month || '';
  const out = { coaches: false, desk: false, family: false };
  if (step === 'failed') {
    out.desk = await NOTIFY.slack(db, 'desk', `Payment failed: ${name} — ${month} tuition`, [`*Payment failed: ${name}* — ${month} tuition${prog ? ' · ' + prog : ''} ${money(extra.cents || 0)}`, 'Stripe retries the card on its own; the $50 late fee applies on the 6th, hold on the 10th.', extra.url ? `<${extra.url}|Invoice>` : '']);
    out.family = await NOTIFY.text(db, extra.phone, `ProWorld Academy: the ${month} payment for ${first}'s ${prog || 'program'} (${money(extra.cents || 0)}) didn't go through.${url} Please sort it out by the 5th to avoid the $50 late fee.`);
  } else if (step === 'late_fee') {
    out.desk = await NOTIFY.slack(db, 'desk', `Late fee: ${name} — ${month} tuition`, [`*Late fee added: ${name}* — ${month} tuition${prog ? ' · ' + prog : ''} still unpaid after the 5th · $50`, 'Training pauses on the 10th if it stays unpaid.', extra.url ? `<${extra.url}|Invoice>` : '']);
    out.family = await NOTIFY.text(db, extra.phone, `ProWorld Academy: ${first}'s ${month} tuition (${money(extra.cents || 0)}) was not received by the 5th, so a $50 late fee was added.${url} Training pauses on the 10th if it is still unpaid.`);
  } else if (step === 'hold') {
    const why = extra.reason === 'staff' ? `by the front desk${extra.by ? ' (' + extra.by + ')' : ''}` : `${month} tuition unpaid`;
    out.coaches = await NOTIFY.slack(db, 'coaches', `Training paused: ${name}`, [`*Training paused: ${name}*${prog ? ' — ' + prog : ''} — ${why}.`, 'Not on the attendance list until it is released.', link ? `<${link}|Open in the Coach Portal>` : '']);
    out.desk = await NOTIFY.slack(db, 'desk', `On hold: ${name}`, [`*On hold: ${name}*${prog ? ' — ' + prog : ''} — ${why}.`, extra.url ? `<${extra.url}|Invoice>` : '', 'Training resumes the moment it is paid (the nightly run releases the hold), or release it from the backend.']);
    if (extra.reason !== 'staff') out.family = await NOTIFY.text(db, extra.phone, `ProWorld Academy: ${first}'s ${month} tuition is still unpaid, so training is paused from today.${url} Training resumes as soon as it is paid.`);
  } else if (step === 'released') {
    out.coaches = await NOTIFY.slack(db, 'coaches', `Back on the list: ${name}`, [`*Back on the list: ${name}*${prog ? ' — ' + prog : ''} — ${extra.reason === 'staff' ? 'hold released by the front desk' : month + ' tuition paid'}.`]);
    out.desk = await NOTIFY.slack(db, 'desk', `Hold released: ${name}`, [`*Hold released: ${name}*${prog ? ' — ' + prog : ''} — ${extra.reason === 'staff' ? 'by the front desk' : month + ' tuition paid'}.`]);
    if (extra.reason !== 'staff') out.family = await NOTIFY.text(db, extra.phone, `ProWorld Academy: thank you, ${first}'s ${month} tuition is paid and training is back on.`);
  } else if (step === 'cancelled') {
    const why = extra.reason === 'unpaid' ? `${month} tuition unpaid after the 15th` : extra.reason === 'family' ? 'cancelled by the family' : `cancelled by the front desk${extra.by ? ' (' + extra.by + ')' : ''}`;
    out.coaches = await NOTIFY.slack(db, 'coaches', `Spot released: ${name}`, [`*Spot released: ${name}*${prog ? ' — ' + prog : ''} — ${why}.${extra.endsOn ? ' Trains through ' + niceDate(extra.endsOn) + '.' : ''}`]);
    out.desk = await NOTIFY.slack(db, 'desk', `Cancelled: ${name}`, [`*Cancelled: ${name}*${prog ? ' — ' + prog : ''} — ${why}.${extra.endsOn ? ' Last day ' + niceDate(extra.endsOn) + '.' : ''}`, extra.url ? `<${extra.url}|Invoice>` : '']);
    if (extra.reason === 'unpaid') out.family = await NOTIFY.text(db, extra.phone, `ProWorld Academy: ${first}'s spot in ${prog || 'the program'} was released today because ${month} tuition is still unpaid.${url} To come back, call ${NOTIFY.FRONT_DESK}.`);
    else if (extra.reason === 'staff') out.family = await NOTIFY.text(db, extra.phone, `ProWorld Academy: ${first}'s ${prog || 'program'} plan is cancelled${extra.endsOn ? ' — training continues through ' + niceDate(extra.endsOn) + ' and there are no further charges' : ' with no further charges'}. Questions: ${NOTIFY.FRONT_DESK}.`);
  } else if (step === 'break') {
    out.family = await NOTIFY.text(db, extra.phone, `ProWorld Academy, about ${first}'s plan: ${extra.notice}`);
  } else if (step === 'keep') {
    out.coaches = await NOTIFY.slack(db, 'coaches', `Staying: ${name}`, [`*Staying: ${name}*${prog ? ' — ' + prog : ''} — the cancellation was undone; the plan continues.`]);
    out.desk = await NOTIFY.slack(db, 'desk', `Cancellation undone: ${name}`, [`*Cancellation undone: ${name}*${prog ? ' — ' + prog : ''}${extra.by ? ' — by ' + extra.by : ''}.`]);
  }
  return out;
}

/* The nightly reconciliation: every plan on Stripe against its player record (status, hold, cancel-at-month-end). */
async function syncSubscriptions(db, subs, opts) {
  opts = opts || {}; const log = opts.log || (() => {});
  const report = { checked: 0, updated: [], finished: [] };
  if (!db) return report;
  const snap = await db.collection('players').get();
  const byId = new Map(subs.map((s) => [s.id, s]));
  for (const d of snap.docs) {
    const x = d.data() || {}; const en = x.enroll; if (!en || !en.subscription) continue;
    const s = byId.get(en.subscription); if (!s) continue;
    report.checked++;
    const want = { status: s.status, hold: !!s.hold, endsOn: s.cancelAtPeriodEnd && s.next ? s.next.date : null, next: s.next ? { date: s.next.date, cents: s.next.cents } : null };
    const diff = want.status !== en.status || want.hold !== !!en.hold || (want.endsOn || null) !== (en.endsOn || null) || JSON.stringify(want.next) !== JSON.stringify(en.next || null);
    if (!diff) continue;
    const upd = { enroll: Object.assign({}, en, want, { updatedAt: Date.now() }), updatedAt: Date.now() };
    if (s.status === 'canceled' && x.source === 'enroll' && x.status === 'active') { upd.status = 'finished'; report.finished.push(d.id); }
    await db.doc('players/' + d.id).set(upd, { merge: true });
    report.updated.push(d.id);
    log(`roster sync ${d.id}: ${en.status}${en.hold ? '/hold' : ''} → ${want.status}${want.hold ? '/hold' : ''}${want.endsOn ? ' ends ' + want.endsOn : ''}`);
  }
  return report;
}

module.exports = { record, recordTrial, findPlayer, findBySubscription, setPlan, tell, syncSubscriptions, purchasesOf, rosterRole, fold, slug, shortName, splitName, niceDate, money, playerLink, GROUP_OF, GROUP_LABEL, SITE };
