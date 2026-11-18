'use strict';
/* The move from Play by Point (Nov 17, 2026 — management: "bring everything from every single player… do not charge anything,
   no cards… Play by Point is the final saying").

   An owner hands over what Play by Point's program lists say (one row per child per program: the parent's name, e-mail and phone,
   the child, the program, the weekdays the child is booked on, the plan). `preview` says what would change and writes nothing;
   `apply` writes it:
     players/<id>                   status active, group (only when missing), enroll.days / programName / programShort / pbp
     players/<id>/private/contact   guardian, email, phone — what lets the parent into the client account
   A child already in the roster is matched by name (the whole name, or first name + last initial when that is one player only).
   A child not found is added. Nothing here touches Stripe, a card or a charge, and nobody is ever removed: the players the app
   holds as active that Play by Point does not list come back as `notInPbp`, for a person to look at. */

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n || 120);
const digits = (v) => String(v || '').replace(/\D+/g, '');

/* The program's name in Play by Point → our group, the short word the family sees, and how strongly it decides a child's days
   when the child is in two programs. */
function programOf(name) {
  const n = fold(name);
  if (/full time|full day/.test(n)) return { group: 'ft', short: 'Full Time', rank: 1 };
  if (/afterschool|after school/.test(n)) return { group: 'as', short: 'Afterschool', rank: 2 };
  if (/10 under|10 and under|u 10|4 under/.test(n)) return { group: 'u10', short: /4 under/.test(n) ? '4 & Under' : '10 & Under', rank: 3 };
  if (/soccer/.test(n)) return { group: '', short: 'Soccer', rank: 4, sport: 'soccer' };
  if (/fitness/.test(n)) return { group: '', short: 'Fitness', rank: 5, extra: true };
  return { group: '', short: clean(name, 40), rank: 6, extra: true };
}
/* By the session (a drop-in, a pack of sessions): no fixed weekdays to put on a calendar. */
const bySession = (plan) => /drop ?in|flex|session|pack/i.test(String(plan || '')) && !/per week|days? per|monthly|weekly/i.test(String(plan || ''));

function tidy(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows.slice(0, 2000) : []) {
    const child = clean(r.child, 80); if (!fold(child)) continue;
    const prog = programOf(r.program); const key = fold(child) + '|' + fold(r.email || r.parent);
    const days = DOW.filter((d) => (Array.isArray(r.days) ? r.days : []).map((x) => String(x).slice(0, 3).toLowerCase()).includes(d.toLowerCase()));
    const row = { child, age: Number(r.age) > 0 && Number(r.age) < 80 ? Number(r.age) : null, parent: clean(r.parent, 80), email: clean(r.email, 120).toLowerCase(), phone: digits(r.phone).slice(-15),
      program: clean(r.program, 80), prog, days, plan: clean(r.plan, 80), time: clean(r.time, 40), also: [] };
    const had = out.get(key);
    if (!had) { out.set(key, row); continue; }
    const [main, other] = row.prog.rank < had.prog.rank ? [row, had] : [had, row];   // the school-day program decides the days; the other is noted
    main.also = [...new Set([...(had.also || []), ...(row.also || []), other.program])].filter((x) => x && x !== main.program);
    if (!main.email) main.email = other.email; if (!main.phone) main.phone = other.phone;
    out.set(key, main);
  }
  return [...out.values()];
}

async function plan(db, rows) {
  const want = tidy(rows);
  const snap = await db.collection('players').get();
  const players = snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
  const live = players.filter((p) => p.status !== 'finished');
  const byName = (list) => { const m = new Map(); list.forEach((p) => { const k = fold(p.name); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }); return m; };
  const liveBy = byName(live); const allBy = byName(players);
  const short = (n) => { const w = fold(n).split(' '); return w.length > 1 ? w[0] + ' ' + w[w.length - 1][0] : w[0]; };
  const shortBy = new Map(); live.forEach((p) => { const k = short(p.name); if (!shortBy.has(k)) shortBy.set(k, []); shortBy.get(k).push(p); });
  const used = new Set(); const items = [];
  for (const r of want) {
    let p = null; let how = '';
    const a = (liveBy.get(fold(r.child)) || []).filter((x) => !used.has(x.id));
    if (a.length === 1) { p = a[0]; how = 'name'; }
    else if (a.length > 1) { p = a.find((x) => x.group === r.prog.group) || null; how = p ? 'name + group' : ''; if (!p) { items.push({ kind: 'unsure', row: r, why: `${a.length} players are called ${r.child}` }); continue; } }
    if (!p) { const b = (shortBy.get(short(r.child)) || []).filter((x) => !used.has(x.id)); if (b.length === 1 && fold(r.child).split(' ').length > 1 && fold(b[0].name).split(' ').pop().length <= 2) { p = b[0]; how = 'first name + initial'; } }
    if (!p) { const c = (allBy.get(fold(r.child)) || []).filter((x) => !used.has(x.id) && x.status === 'finished'); if (c.length === 1) { p = c[0]; how = 'name (was finished)'; } }
    if (!p) { items.push({ kind: 'new', row: r }); continue; }
    used.add(p.id);
    const en = p.enroll || {}; const changes = [];
    const haveDays = Array.isArray(en.days) ? en.days.join(' ') : '';
    const fixed = !bySession(r.plan) && r.days.length > 0;
    if (fixed && haveDays !== r.days.join(' ')) changes.push(`days ${haveDays || 'none'} → ${r.days.join(' ')}`);
    if ((p.status || 'active') !== 'active') changes.push(`status ${p.status} → active`);
    if (!p.group && r.prog.group) changes.push(`group → ${r.prog.group}`);
    else if (['ft', 'as', 'u10'].includes(p.group) && r.prog.group && p.group !== r.prog.group && !r.prog.extra) changes.push(`group ${p.group} → ${r.prog.group}`);   // the Tour Team and the campers keep their own group
    if ((en.programName || '') !== r.program) changes.push('program name');
    items.push({ kind: 'update', id: p.id, name: p.name, how, row: r, fixed, changes });
  }
  const notInPbp = live.filter((p) => (p.status || 'active') === 'active' && !used.has(p.id) && ['ft', 'as', 'u10'].includes(p.group)).map((p) => ({ id: p.id, name: p.name, group: p.group }));
  return { items, notInPbp, rows: want.length };
}

function summary(pl) {
  const pick = (k) => pl.items.filter((i) => i.kind === k);
  const line = (i) => ({ child: i.row.child, program: i.row.prog.short, days: i.row.days.join(' '), plan: i.row.plan, parent: i.row.parent, hasEmail: !!i.row.email, hasPhone: !!i.row.phone, name: i.name || '', how: i.how || '', changes: i.changes || [], why: i.why || '', bySession: bySession(i.row.plan) || !i.row.days.length });
  return { rows: pl.rows, update: pick('update').map(line), create: pick('new').map(line), unsure: pick('unsure').map(line), notInPbp: pl.notInPbp };
}
async function preview(db, rows) { return summary(await plan(db, rows)); }

async function apply(db, rows, who) {
  const pl = await plan(db, rows); const now = Date.now(); const by = (who && who.email) || 'owner'; let n = 0; let made = 0; let contacts = 0;
  const shortName = (name) => { const w = String(name).trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]; };
  for (const i of pl.items) {
    if (i.kind === 'unsure') continue;
    const r = i.row; const fixed = !bySession(r.plan) && r.days.length > 0;
    const enroll = Object.assign({ programName: r.program, programShort: r.prog.short, pbp: { plan: r.plan, time: r.time, also: r.also, bySession: !fixed, at: now, by } }, fixed ? { days: r.days } : {});
    let id = i.id;
    if (i.kind === 'new') {
      const ref = db.collection('players').doc();
      id = ref.id;
      await ref.set(Object.assign({ name: r.child, shortName: shortName(r.child), group: r.prog.group || '', tier: '', coach: '', coach2: '', fitness: '', status: 'active', source: 'Play by Point', createdAt: now, updatedAt: now, createdBy: 'Play by Point import', enroll }, r.prog.sport ? { sport: r.prog.sport } : {}));
      made++;
    } else {
      const patch = { status: 'active', updatedAt: now, enroll };
      if (r.prog.group && !r.prog.extra && i.changes.some((c) => /^group/.test(c))) patch.group = r.prog.group;
      if (i.changes.some((c) => /^status/.test(c))) patch.statusAt = now;
      await db.doc('players/' + id).set(patch, { merge: true });
      n++;
    }
    if (r.email || r.phone || r.parent) { await db.doc(`players/${id}/private/contact`).set(Object.assign({ source: 'playbypoint', updatedAt: now }, r.parent ? { guardian: r.parent } : {}, r.email ? { email: r.email } : {}, r.phone ? { phone: r.phone } : {}), { merge: true }); contacts++; }
  }
  await db.collection('imports').doc('pbp-' + now).set({ at: now, by, rows: pl.rows, updated: n, created: made, contacts, unsure: pl.items.filter((x) => x.kind === 'unsure').length, notInPbp: pl.notInPbp.length });
  return { ok: true, updated: n, created: made, contacts, unsure: pl.items.filter((x) => x.kind === 'unsure').length, notInPbp: pl.notInPbp.length };
}

module.exports = { preview, apply, tidy, programOf, bySession };
