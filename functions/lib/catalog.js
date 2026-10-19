/* ProWorld catalog as the billing engine sells it — the same lines as Play by Point and the Stripe catalog
   (live account acct_1Q8S5FAtFF62lExQ, sandbox acct_1URzipARHrKgYyZL: same product ids, prices matched by lookup key).
   Prices here are the published dollars and are checked against Stripe at runtime (a mismatch refuses the sale rather than mis-charging). */
'use strict';

const PROGRAMS = [
  { id: 'fulltime', name: 'Full Time Program | Fall 2026', short: 'Full Time', product: 'prod_VSwdkFe4BriwDa', firstMonth: 'pw_firstmonth_fulltime', qbo: 'Full Time', sport: 'Tennis + Fitness + Mental performance', ages: 'Ages 10–18', time: '7:45 AM–7:00 PM',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], blurb: 'The complete four-pillar system, every day: technical training, athletic fitness, mental performance and individual player assessments.',
    plans: [
      { id: 'core', label: 'CORE Program (Half Day – 5 Days/week)', sub: 'Monthly · half day, 5 days a week', days: 5, monthly: 2950, lookup: 'fulltime_fall26_core_monthly' },
      { id: 'intensive', label: 'INTENSIVE Program 9 (Full Day)', sub: 'Monthly · full day, 5 days a week', days: 5, monthly: 3950, lookup: 'fulltime_fall26_intensive_monthly' }],
    weekly: [
      { id: 'core_w', label: 'CORE Program | Weekly', price: 725, lookup: 'fulltime_fall26_core_weekly' },
      { id: 'intensive_w', label: 'INTENSIVE Program | Weekly', price: 1100, lookup: 'fulltime_fall26_intensive_weekly' }],
    packs: [{ id: 'flex10', sessions: 10, label: '10 FLEX Sessions | Tennis Only', price: 995, lookup: 'fulltime_fall26_flex10' }],
    dropin: { label: 'Drop in (Tennis Only)', price: 115, lookup: 'fulltime_fall26_dropin' } },
  { id: 'afterschool', name: 'Afterschool | Fall 2026', short: 'Afterschool', product: 'prod_VSweKxrlHVGGqf', firstMonth: 'pw_firstmonth_afterschool', qbo: 'Afterschool', sport: 'Tennis + Fitness', ages: 'Ages 10–18', time: '4:00–7:00 PM',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], blurb: 'Three hours a day: technical training, athletic fitness and match play.',
    plans: [
      { id: '2', label: '2 Days per week', days: 2, monthly: 695, lookup: 'afterschool_fall26_2d_monthly' },
      { id: '3', label: '3 Days per week', days: 3, monthly: 980, lookup: 'afterschool_fall26_3d_monthly' },
      { id: '5', label: '5 Days per week', days: 5, monthly: 1500, lookup: 'afterschool_fall26_5d_monthly' }],
    weekly: null,
    packs: [{ id: 'flex10', sessions: 10, label: '10 FLEX Sessions | Tennis Only', price: 995, lookup: 'afterschool_fall26_flex10' }],
    dropin: { label: 'Drop in (Tennis Only)', price: 115, lookup: 'afterschool_fall26_dropin' } },
  { id: 'u10adv', name: '10 & Under Advanced | Fall 2026', short: '10U Advanced', product: 'prod_VSwfSjJ9qNDzc9', firstMonth: 'pw_firstmonth_u10adv', qbo: 'U10', sport: 'Tennis', ages: '10 & under', time: '4:30–6:00 PM',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], blurb: 'The competitive 10 & under group: orange and green ball, match play every week.',
    plans: [
      { id: '2', label: '2 Days per Week', days: 2, monthly: 525, lookup: 'u10adv_fall26_2d_monthly' },
      { id: '3', label: '3 Days per Week', days: 3, monthly: 745, lookup: 'u10adv_fall26_3d_monthly' },
      { id: '5', label: '5 Days per Week', days: 5, monthly: 1125, lookup: 'u10adv_fall26_5d_monthly' }],
    weekly: null, packs: null, dropin: { label: '1 Session', price: 75, lookup: 'u10adv_fall26_dropin' } },
  { id: 'u10path', name: '10 & Under Pathway | Fall 2026', short: '10U Pathway', product: 'prod_VSwfrBU79qetLs', firstMonth: 'pw_firstmonth_u10path', qbo: 'U10', sport: 'Tennis', ages: '10 & under', time: '4:30–6:00 PM',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], blurb: 'Red, orange and green ball. The ProWorld way into the game.',
    plans: [
      { id: '2', label: '2 Days per Week', days: 2, monthly: 375, lookup: 'u10path_fall26_2d_monthly' },
      { id: '3', label: '3 Days per Week', days: 3, monthly: 510, lookup: 'u10path_fall26_3d_monthly' },
      { id: '5', label: '5 Days per Week', days: 5, monthly: 750, lookup: 'u10path_fall26_5d_monthly' }],
    weekly: null, packs: null, dropin: { label: '1 Session', price: 60, lookup: 'u10path_fall26_dropin' } },
  { id: 'tots', name: '4 & Under | Fall 2026', short: '4 & Under', product: 'prod_VSwgYEOleDHEs3', firstMonth: 'pw_firstmonth_tots', qbo: 'U10', sport: 'Tennis', ages: 'Ages 2–4', time: '4:30–5:15 PM',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], blurb: 'ProWorld TOTS: first racquet, first rallies.',
    plans: [
      { id: '2', label: '2 Days per Week', days: 2, monthly: 250, lookup: 'tots_fall26_2d_monthly' },
      { id: '3', label: '3 Days per Week', days: 3, monthly: 330, lookup: 'tots_fall26_3d_monthly' }],
    weekly: null, packs: null, dropin: { label: '1 Session', price: 40, lookup: 'tots_fall26_dropin' } },
  { id: 'fitness', name: 'Fitness | Fall 2026', short: 'Fitness', product: 'prod_VSwgIlb17cIxza', qbo: 'Fitness', sport: 'Fitness', ages: 'All ages', time: 'By session',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], blurb: 'Athletic fitness with the strength coaches. Sold by the session.',
    plans: [], weekly: null,
    packs: [
      { id: 'fit1', sessions: 1, label: '1 Session', price: 50, lookup: 'fitness_fall26_1' },
      { id: 'fit5', sessions: 5, label: '5 Sessions', price: 240, lookup: 'fitness_fall26_5' },
      { id: 'fit10', sessions: 10, label: '10 Sessions', price: 425, lookup: 'fitness_fall26_10' }],
    dropin: { label: '1 Session', price: 50, lookup: 'fitness_fall26_1' } },
  { id: 'soccer', name: 'Soccer | Fall 2026 (5 - 12yrs)', short: 'Soccer', product: 'prod_VSwhdbxWJc3MMh', firstMonth: 'pw_firstmonth_soccer', qbo: 'Soccer', sport: 'Soccer', ages: 'Ages 5–12', time: '4:00–6:00 PM',
    days: ['Mon', 'Wed', 'Fri'], blurb: 'Small-sided training on the field. Technique, speed, decisions.',
    plans: [
      { id: '4', label: '4 Sessions / month', sub: 'Monthly · 1 session a week', days: 1, monthly: 175, lookup: 'soccer_fall26_4_monthly' },
      { id: '8', label: '8 Sessions / month', sub: 'Monthly · 2 sessions a week', days: 2, monthly: 320, lookup: 'soccer_fall26_8_monthly' },
      { id: '12', label: '12 Sessions / month', sub: 'Monthly · 3 sessions a week', days: 3, monthly: 420, lookup: 'soccer_fall26_12_monthly' }],
    weekly: null, packs: null, dropin: { label: 'DROP IN', price: 50, lookup: 'soccer_fall26_dropin' }, trial: { label: 'FREE Trial Session', price: 0, lookup: 'soccer_fall26_trial' } }
];

const CAMPS = [
  { id: 'tg13', name: '13+ | Thanksgiving Camp 2026', product: 'prod_VSwh6EJ8SieFMo', dates: 'Nov 23–27 · no camp Thu Nov 26', ages: 'Ages 13+', blurb: 'Half day 9–12, full day 9–3: athletic development, tennis, match analysis.',
    options: [
      { id: 'half', label: 'HALF DAY – DROP IN', price: 175, lookup: 'tg26_13plus_half_dropin' }, { id: 'full', label: 'FULL DAY', price: 275, lookup: 'tg26_13plus_full_dropin' },
      { id: 'half3', label: '3 HALF DAYS', price: 450, lookup: 'tg26_13plus_half3' }, { id: 'half4', label: '4 HALF DAYS', price: 550, lookup: 'tg26_13plus_half4' },
      { id: 'full3', label: '3 FULL DAYS', price: 715, lookup: 'tg26_13plus_full3' }, { id: 'full4', label: '4 FULL DAYS', price: 895, lookup: 'tg26_13plus_full4' }] },
  { id: 'tgu13', name: 'U-13 | Thanksgiving Camp 2026', product: 'prod_VSwi9IRjxaAEH7', dates: 'Nov 23–27 · no camp Thu Nov 26', ages: 'Ages 10–12', blurb: 'Half day 9–12, full day 9–3.',
    options: [
      { id: 'half', label: 'HALF DAY – DROP IN', price: 150, lookup: 'tg26_u13_half_dropin' }, { id: 'full', label: 'FULL DAY', price: 250, lookup: 'tg26_u13_full_dropin' },
      { id: 'half3', label: '3 HALF DAYS', price: 350, lookup: 'tg26_u13_half3' }, { id: 'half4', label: '4 HALF DAYS', price: 400, lookup: 'tg26_u13_half4' },
      { id: 'full3', label: '3 FULL DAYS', price: 650, lookup: 'tg26_u13_full3' }, { id: 'full4', label: '4 FULL DAYS', price: 795, lookup: 'tg26_u13_full4' }] },
  { id: 'tgu10', name: 'U-10 | Thanksgiving Camp 2026', product: 'prod_VSwjnorEwHU1r8', dates: 'Nov 23–27', ages: '10 & under', blurb: 'Half days, full days and a Saturday drop-in.',
    options: [
      { id: 'half', label: 'HALF DAY – DROP IN', price: 125, lookup: 'tg26_u10_half_dropin' }, { id: 'half3', label: '3 HALF DAYS', price: 255, lookup: 'tg26_u10_half3' }, { id: 'half4', label: '4 HALF DAYS', price: 340, lookup: 'tg26_u10_half4' },
      { id: 'full', label: 'FULL DAY – DROP IN', price: 175, lookup: 'tg26_u10_full_dropin' }, { id: 'full3', label: '3 FULL DAYS', price: 450, lookup: 'tg26_u10_full3' }, { id: 'full4', label: '4 FULL DAYS', price: 575, lookup: 'tg26_u10_full4' },
      { id: 'sat', label: 'SATURDAY DROP IN', price: 60, lookup: 'tg26_u10_saturday_dropin' }] }
];

/* Pre-paid lesson packages (hours = lessons on the pack) */
const LESSON_PACKAGES = [
  { id: '1hr_i', label: '1 HR | I', hours: 1, price: 200, lookup: 'pack_1hr_i' }, { id: '1hr_ii', label: '1 HR | II', hours: 1, price: 150, lookup: 'pack_1hr_ii' }, { id: '1hr_iii', label: '1 HR | III', hours: 1, price: 120, lookup: 'pack_1hr_iii' }, { id: '1hr_iv', label: '1 HR | IV', hours: 1, price: 100, lookup: 'pack_1hr_iv' }, { id: '1hr_fi', label: '1 HR | FI', hours: 1, price: 130, lookup: 'pack_1hr_fi' },
  { id: '5hrs_i', label: '5 HRS | I', hours: 5, price: 1000, lookup: 'pack_5hrs_i' }, { id: '5hrs_ii', label: '5 HRS | II', hours: 5, price: 750, lookup: 'pack_5hrs_ii' }, { id: '5hrs_iii', label: '5 HRS | III', hours: 5, price: 600, lookup: 'pack_5hrs_iii' }, { id: '5hrs_iv', label: '5 HRS | IV', hours: 5, price: 500, lookup: 'pack_5hrs_iv' },
  { id: '8hrs_i', label: '8 HRS | I', hours: 8, price: 1600, lookup: 'pack_8hrs_i' }, { id: '8hrs_ii', label: '8 HRS | II', hours: 8, price: 1200, lookup: 'pack_8hrs_ii' }, { id: '8hrs_iii', label: '8 HRS | III', hours: 8, price: 960, lookup: 'pack_8hrs_iii' }, { id: '8hrs_iv', label: '8 HRS | IV', hours: 8, price: 800, lookup: 'pack_8hrs_iv' }, { id: '8hrs_fi', label: '8 HRS | FI', hours: 8, price: 1040, lookup: 'pack_8hrs_fi' },
  { id: 'soc_10', label: 'Soccer: Package of 10', hours: 10, price: 960, lookup: 'pack_soccer_10' }, { id: 'soc_10_2', label: 'Soccer: Package of 10 (2 players)', hours: 10, price: 1200, lookup: 'pack_soccer_10_2p' }, { id: 'soc_10_3', label: 'Soccer: Package of 10 (3 players)', hours: 10, price: 1450, lookup: 'pack_soccer_10_3p' },
  { id: 'soc_5', label: 'Soccer: Package of 5', hours: 5, price: 540, lookup: 'pack_soccer_5' }, { id: 'soc_5_2', label: 'Soccer: Package of 5 (2 players)', hours: 5, price: 675, lookup: 'pack_soccer_5_2p' }, { id: 'soc_5_3', label: 'Soccer: Package of 5 (3 players)', hours: 5, price: 810, lookup: 'pack_soccer_5_3p' }
];

/* Private lessons by pro tier — price per player; with 2+ players the price is each. lookup: lesson_<tier>_<n>p_<min>m */
const LESSON_TIERS = {
  'TIER 150': { key: 't150', product: 'prod_VSwkMIzPBMfrak', 1: { 30: 75, 60: 150, 90: 225, 120: 300 }, 2: { 30: 56.25, 60: 112.5, 90: 168.75, 120: 225 } },
  'TIER 120': { key: 't120', product: 'prod_VSwluZnF98aXyH', 1: { 30: 60, 60: 120, 90: 180, 120: 240 }, 2: { 30: 45, 60: 90, 90: 135, 120: 180 } },
  'TIER 100': { key: 't100', product: 'prod_VSwlz6M3y1arWQ', 1: { 30: 50, 60: 100, 90: 150, 120: 200 }, 2: { 30: 25, 60: 50, 90: 75, 120: 100 } },
  'TIER 80': { key: 't80', product: 'prod_VSwnPDTKvEIqSU', 1: { 30: 40, 60: 80 } },
  'FITNESS 110': { key: 'fit110', product: 'prod_VSwnrF7HlXie9a', 1: { 30: 60, 60: 110 }, 2: { 60: 55 }, 3: { 60: 43.34 }, 4: { 30: 17.5, 60: 35 } },
  'SOCCER 120': { key: 'soc120', product: 'prod_VSwqeDA8h0tdWb', 1: { 45: 100, 60: 120 }, 2: { 60: 75, 90: 100 }, 3: { 60: 60, 90: 76.67 } },
  'Sparring': { key: 'sparring', product: 'prod_VSwrEVcItQBJ4t', 1: { 60: 50 } }
};
const PROS = [
  { name: 'Toño Fernandez', tier: 'TIER 150' }, { name: 'Etienne Dumas', tier: 'TIER 150' }, { name: 'Florian Riglet', tier: 'TIER 150' }, { name: 'Quinnton Vega', tier: 'TIER 150' }, { name: 'Lorenzo Cava', tier: 'TIER 150' }, { name: 'Adam Altschuler', tier: 'TIER 150' }, { name: 'Lan Bale', tier: 'TIER 150' },
  { name: 'Nico Fernandez', tier: 'TIER 120' }, { name: 'Mauricio Paiva', tier: 'TIER 120' }, { name: 'Eric Samuelsson', tier: 'TIER 120' },
  { name: 'Kamryn Taub', tier: 'TIER 100' }, { name: 'Kate Agnew', tier: 'TIER 100' }, { name: 'Robby Talle', tier: 'TIER 80' },
  { name: 'Tara Malik', tier: 'FITNESS 110' }, { name: 'Jesse Adarme', tier: 'FITNESS 110' }, { name: 'Lukas Hombach', tier: 'SOCCER 120' }, { name: 'Daniel Rila', tier: 'Sparring' }
];
const COURTS = { clay: { label: 'Clay court · Non Member', price: 20, lookup: 'court_clay_nonmember' }, hard: { label: 'Hard court · Non Member', price: 20, lookup: 'court_hard_nonmember' } };
const MEMBERSHIP = [{ id: 'm600', label: 'Monthly Court Rentals · $600', price: 600, lookup: 'membership_court_600_monthly' }, { id: 'm900', label: 'Monthly Court Rentals · $900', price: 900, lookup: 'membership_court_900_monthly' }];

/* Every one-time line the engine may sell, by lookup key, with the dollars we expect Stripe to carry. */
function oneTimeLines() {
  const out = {};
  const add = (lookup, price, label, kind, extra) => { out[lookup] = Object.assign({ lookup, price, label, kind }, extra || {}); };
  for (const p of PROGRAMS) {
    for (const w of p.weekly || []) add(w.lookup, w.price, p.short + ' · ' + w.label, 'weekly', { program: p.id, product: p.product, qbo: p.qbo });
    for (const k of p.packs || []) add(k.lookup, k.price, p.short + ' · ' + k.label, 'pack', { program: p.id, product: p.product, qbo: p.qbo, sessions: k.sessions });
    if (p.dropin) add(p.dropin.lookup, p.dropin.price, p.short + ' · ' + p.dropin.label, 'dropin', { program: p.id, product: p.product, qbo: p.qbo });
    if (p.trial) add(p.trial.lookup, p.trial.price, p.short + ' · ' + p.trial.label, 'trial', { program: p.id, product: p.product, qbo: p.qbo });
  }
  for (const c of CAMPS) for (const o of c.options) add(o.lookup, o.price, c.name + ' · ' + o.label, 'camp', { camp: c.id, product: c.product, qbo: 'Camps' });
  for (const l of LESSON_PACKAGES) add(l.lookup, l.price, 'Lesson package · ' + l.label, 'lesson_package', { hours: l.hours, product: 'prod_VSwr73HB9EzSHx', qbo: l.id.startsWith('soc') ? 'Soccer' : l.id.endsWith('_fi') ? 'Fitness' : 'Private lessons' });
  for (const [tier, t] of Object.entries(LESSON_TIERS)) for (const n of [1, 2, 3, 4]) for (const [min, price] of Object.entries(t[n] || {})) {
    if (tier === 'Sparring') add('sparring_1p_60m', 50, 'Sparring · 1 hour', 'lesson', { tier, players: 1, minutes: 60, product: t.product, qbo: 'Private lessons', byProduct: true });
    else add(`lesson_${t.key}_${n}p_${min}m`, price, `Private lesson · ${tier} · ${n} player${n > 1 ? 's' : ''} · ${min} min${n > 1 ? ' (each)' : ''}`, 'lesson', { tier, players: n, minutes: +min, product: t.product, qbo: tier.startsWith('FITNESS') ? 'Fitness' : tier.startsWith('SOCCER') ? 'Soccer' : 'Private lessons' });
  }
  for (const [k, c] of Object.entries(COURTS)) add(c.lookup, c.price, 'Court reservation · ' + c.label, 'court', { court: k, product: 'prod_VSwtDH5VO3FYSZ', qbo: 'Court rentals' });
  return out;
}

function program(id) { return PROGRAMS.find((p) => p.id === id) || null; }
function plan(programId, planId) { const p = program(programId); return p ? p.plans.find((x) => x.id === String(planId)) || null : null; }
/* What the public page and the backend need, without Stripe ids. */
function publicCatalog() {
  return { programs: PROGRAMS.map((p) => ({ id: p.id, name: p.name, short: p.short, sport: p.sport, ages: p.ages, time: p.time, days: p.days, blurb: p.blurb,
    plans: p.plans.map(({ id, label, sub, days, monthly }) => ({ id, label, sub, days, monthly })), weekly: (p.weekly || []).map(({ id, label, price, lookup }) => ({ id, label, price, lookup })),
    packs: (p.packs || []).map(({ id, sessions, label, price, lookup }) => ({ id, sessions, label, price, lookup })), dropin: p.dropin ? { label: p.dropin.label, price: p.dropin.price, lookup: p.dropin.lookup } : null, trial: p.trial ? { label: p.trial.label, price: p.trial.price, lookup: p.trial.lookup } : null })),
    camps: CAMPS.map((c) => ({ id: c.id, name: c.name, dates: c.dates, ages: c.ages, blurb: c.blurb, options: c.options.map(({ id, label, price, lookup }) => ({ id, label, price, lookup })) })),
    lessonPackages: LESSON_PACKAGES.map(({ id, label, hours, price }) => ({ id, label, hours, price })), pros: PROS, tiers: Object.fromEntries(Object.entries(LESSON_TIERS).map(([k, v]) => [k, { 1: v[1], 2: v[2], 3: v[3], 4: v[4] }])) };
}

module.exports = { PROGRAMS, CAMPS, LESSON_PACKAGES, LESSON_TIERS, PROS, COURTS, MEMBERSHIP, oneTimeLines, program, plan, publicCatalog };
