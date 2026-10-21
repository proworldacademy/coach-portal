/* Messages — texts from the front desk to families, through the academy's JustCall line (the same keys the engine's own
   texts use: settings/notify, written by an owner, read here with the admin SDK — nothing about them reaches the page).

   What lives where
   - settings/sms                 the sender name, the footer switch, the JustCall inbox link, the templates (edited from the page by whoever may text)
   - players/<id>/private/sms     the family's consent: { optIn, at, source (enroll · portal · staff · stop · start · justcall), by, phone (E.164) }
   - smsBatches/<id>              one per send: who, when, the text, the counts, the state
   - smsLog/<id>                  one per recipient: player, phone, the exact text, status (queued · sent · failed · skipped), reason, JustCall id, delivery
   Consent is the carriers' rule, not ours: nobody is texted without opt-in, STOP from the family switches them off by itself (the
   JustCall webhook below), and every line written here says what happened to whom. Phones are kept in E.164 (+15615551234). */
'use strict';
const crypto = require('crypto');
const S = require('./stripe');
const CAT = require('./catalog');
const NOTIFY = require('./notify');

const JUSTCALL_API = 'https://api.justcall.io/v2.1';
const MAX_BODY = 1200;                                   // JustCall takes 1600; long texts cost segments, and nobody reads them
const MAX_RECIPIENTS = 500;
const CONCURRENCY = 3;
const ATTEMPTS = 3;
const DEFAULT_SENDER = 'ProWorld Academy';
const DEFAULT_INBOX = 'https://app.justcall.io/app/inbox';
const FOOTER = (name) => `- ${name}. Reply here with any question.`;   // the concierge recognises "Reply here with any question" as ours (a plain hyphen: an em dash would make every text UCS-2 and cost double)
const STOP_WORDS = /^\s*(stop|stopall|stop all|unsubscribe|cancel|end|quit)\b/i;
const START_WORDS = /^\s*(start|unstop|yes|subscribe)\b/i;
const PLACEHOLDERS = ['first_name', 'program', 'time', 'court'];
const DEFAULT_TEMPLATES = [
  { id: 'rain', name: 'Rain update', text: "Hi {first_name}, it's raining at Proworld. {program} at {time} is cancelled/moved - we'll update you by 30 min before. Reply if you have questions." },
  { id: 'court', name: 'Court change', text: 'Hi {first_name}, {program} today is on court {court}.' },
  { id: 'reminder', name: 'Reminder', text: 'Reminder: {program} tomorrow at {time}. See you at Proworld!' }
];
const GROUP_PROGRAM = { ft: 'Full Time', as: 'Afterschool', u10: '10 & Under', tour: 'Full Time', camp: 'Camp' };

/* ---- helpers ---- */
const fetcher = () => (typeof fetch === 'function' ? fetch : null);
let override = null;                                     // the tests swap the network out
function _useFetch(fn) { override = fn; }
function net() { return override || fetcher(); }
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
function cleanText(s, max) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, max || MAX_BODY); }
function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function slug(s) { return fold(s).replace(/ /g, '-').slice(0, 60); }
function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }

/* E.164, strictly: +1 and ten digits with a real area code and exchange for North America; + and 8–15 digits elsewhere. */
function e164(value) { return NOTIFY.e164(value); }
function validPhone(p) { return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(p) || /^\+(?!1)[1-9]\d{7,14}$/.test(p); }

/* Segments the way the carriers count them: GSM-7 (160 in one, 153 each after) unless a character outside the GSM set
   makes the whole text UCS-2 (70 in one, 67 each after). Curly quotes and emoji are the usual culprits. */
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€\f';
function segments(text) {
  const t = String(text || '');
  let units = 0;
  for (const ch of t) { if (GSM.includes(ch)) units += 1; else if (GSM_EXT.includes(ch)) units += 2; else { units = -1; break; } }
  if (units < 0) { const u = t.length; return { encoding: 'UCS-2', units: u, segments: u === 0 ? 0 : u <= 70 ? 1 : Math.ceil(u / 67), per: 67, single: 70 }; }
  return { encoding: 'GSM-7', units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153), per: 153, single: 160 };
}

/* {first_name}, {program}, {time}, {court} — a placeholder with no value is left as it is, so it shows in the preview. */
function render(text, vars) {
  vars = vars || {};
  return String(text || '').replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] != null && String(vars[k]).trim() !== '' ? String(vars[k]).trim() : m));
}
/* Curly quotes, em dashes and ellipses from a phone keyboard turn a whole text into UCS-2 (70 characters a segment); this makes them plain. */
function gsmSafe(text) { return String(text || '').replace(/[\u2018\u2019\u201a\u2032]/g, "'").replace(/[\u201c\u201d\u201e\u2033]/g, '"').replace(/[\u2013\u2014\u2015]/g, '-').replace(/\u2026/g, '...').replace(/\u00a0/g, ' '); }
function placeholdersIn(text) { const out = new Set(); String(text || '').replace(/\{([a-z_]+)\}/g, (m, k) => { out.add(k); return m; }); return [...out]; }

/* ---- settings (settings/sms) ---- */
async function settings(db) {
  let d = {};
  try { const snap = await db.doc('settings/sms').get(); d = snap.exists ? (snap.data() || {}) : {}; } catch (e) { d = {}; }
  const templates = Array.isArray(d.templates) && d.templates.length ? d.templates : DEFAULT_TEMPLATES;
  return { senderName: cleanText(d.senderName, 60) || DEFAULT_SENDER, footer: d.footer !== false, inboxUrl: /^https:\/\/[^\s"']+$/.test(d.inboxUrl || '') ? d.inboxUrl : DEFAULT_INBOX, templates: templates.map((t) => ({ id: slug(t.id || t.name) || 'template', name: cleanText(t.name, 40) || 'Template', text: cleanText(t.text, MAX_BODY) })), updatedAt: d.updatedAt || null, by: d.by || '' };
}
async function saveSettings(db, patch, who) {
  const cur = await settings(db);
  const set = { updatedAt: Date.now(), by: who };
  if (patch.senderName !== undefined) set.senderName = cleanText(patch.senderName, 60) || DEFAULT_SENDER;
  if (patch.footer !== undefined) set.footer = patch.footer !== false;
  if (patch.inboxUrl !== undefined) { const u = cleanText(patch.inboxUrl, 200); if (u && !/^https:\/\/[^\s"']+$/.test(u)) throw S.err(400, 'inbox', 'The inbox link must start with https://'); set.inboxUrl = u || DEFAULT_INBOX; }
  if (patch.templates !== undefined) {
    if (!Array.isArray(patch.templates)) throw S.err(400, 'templates', 'Templates must be a list.');
    const seen = new Set(); const list = [];
    for (const t of patch.templates.slice(0, 40)) {
      const name = cleanText(t && t.name, 40), text = cleanText(t && t.text, MAX_BODY);
      if (!name || !text) continue;
      let id = slug(t.id || name) || 'template'; while (seen.has(id)) id += '-2'; seen.add(id);
      list.push({ id, name, text });
    }
    set.templates = list;
  }
  await db.doc('settings/sms').set(set, { merge: true });
  return Object.assign(cur, await settings(db));
}

/* What the page needs to know about the line: connected or not, the number, whether texts are on. Never the keys. */
async function line(db) {
  const s = await NOTIFY.settings(db, true);
  return { connected: !!(s.justcallKey && s.justcallSecret), from: e164(s.justcallNumber || '') || '', textsOn: s.textsOn === true };
}

/* ---- who may text ---- */
function requireTexting(who) { if (!who || !who.texting) throw S.err(403, 'texting', 'Sending texts needs the front desk, an administrator or an owner.'); }

/* ---- recipients: every player with the phone we would text and the consent on file ---- */
function programOf(d) {
  const en = d.enroll || {};
  if (en.program && CAT.program(en.program)) return { id: en.program, label: CAT.program(en.program).short };
  if (d.sport === 'soccer') return { id: 'soccer', label: 'Soccer' };
  if (d.sport === 'fitness') return { id: 'fitness', label: 'Fitness' };
  return { id: '', label: GROUP_PROGRAM[d.group] || '' };
}
/* The Play by Point roster names players as "Abby G" where the roster says "Abby Gordon": a row matches on the full name, or on
   first name + last initial when that is unambiguous, or on a lone first name when that is unambiguous. */
async function switchRows(db) { try { return (await db.collection('switchRoster').get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})); } catch (e) { return []; } }
function switchIndex(rows) {
  const ix = { full: {}, short: {}, lone: {}, first: {} };
  const put = (m, k, r) => { if (!k) return; m[k] = m[k] === undefined ? r : null; };            // a second row on the same key makes it ambiguous
  for (const r of rows) {
    const t = fold(r.player).split(' ').filter(Boolean); if (!t.length) continue;
    put(ix.full, t.join(' '), r);
    if (t.length > 1) put(ix.short, t[0] + ' ' + t[t.length - 1][0], r); else put(ix.lone, t[0], r);   // "Abby G" → abby g · "Alisa" → alisa
    put(ix.first, t[0], r);
  }
  return ix;
}
function switchMatch(ix, name) {
  const t = fold(name).split(' ').filter(Boolean); if (!t.length) return null;
  const full = t.join(' '); if (ix.full[full]) return ix.full[full];
  if (t.length > 1) { const sh = t[0] + ' ' + t[t.length - 1][0]; if (ix.short[sh]) return ix.short[sh]; return ix.lone[t[0]] || null; }   // the roster has the surname, the switch roster only a first name
  return ix.first[t[0]] || null;                                                                                                            // the roster has only a first name: any one row with it
}
async function recipients(db) {
  const players = (await db.collection('players').get()).docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((p) => p.status !== 'finished');
  const priv = {};                                                  // player id → { contact, sms }
  for (const d of (await db.collectionGroup('private').get()).docs) {
    const parts = d.ref.path.split('/'); const pid = parts[parts.length - 3]; const which = parts[parts.length - 1];
    if (!priv[pid]) priv[pid] = {};
    if (which === 'contact' || which === 'sms') priv[pid][which] = d.data() || {};
  }
  const sw = switchIndex(await switchRows(db));                     // the Play by Point roster, by player name — the phones most families gave us
  const out = players.map((p) => {
    const pv = priv[p.id] || {}; const sms = pv.sms || {}; const contact = pv.contact || {};
    const s = switchMatch(sw, p.name);
    let phone = '', source = '';
    for (const [v, src] of [[sms.phone, 'consent'], [contact.phone, 'contact'], [s && s.phone, 'switch'], [s && s.phone2, 'switch']]) { const n = e164(v); if (n) { phone = n; source = src; break; } }
    const prog = programOf(p);
    return { id: p.id, name: p.name || p.id, first: firstName(p.name), group: p.group || '', program: prog.id, programLabel: prog.label, coach: p.coach || '', coach2: p.coach2 || '', days: p.enroll && Array.isArray(p.enroll.days) ? p.enroll.days : [], status: p.status || 'active', hold: !!(p.enroll && p.enroll.hold),
      parent: contact.guardian || (s && s.guardian) || '', phone, phoneSource: source, valid: !!phone && validPhone(phone), optIn: sms.optIn === true, optInAt: sms.at || null, optInSource: sms.source || '', optInBy: sms.by || '' };
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
async function recipient(db, pid) { return (await recipients(db)).find((r) => r.id === pid) || null; }

/* ---- consent ---- */
async function setOptIn(db, pid, on, opts) {
  opts = opts || {};
  pid = String(pid || '').trim(); if (!/^[a-z0-9-]{1,60}$/.test(pid)) throw S.err(400, 'player', 'A player id is required.');
  const snap = await db.doc('players/' + pid).get(); if (!snap.exists) throw S.err(404, 'player', 'No such player.');
  const set = { optIn: on === true, at: Date.now(), source: cleanText(opts.source, 20) || 'staff', by: cleanText(opts.by, 120) };
  const phone = e164(opts.phone || ''); if (phone) set.phone = phone;
  if (on !== true) set.stoppedAt = Date.now();
  await db.doc(`players/${pid}/private/sms`).set(set, { merge: true });
  return set;
}
/* Owners only: the families who came over from Play by Point gave the academy their mobile for exactly these updates. This marks
   every player with a number and no consent record yet as opted in, source 'playbypoint', with the owner's name and the time. */
async function optInRoster(db, who) {
  const rows = (await recipients(db)).filter((r) => r.phone && r.valid && !r.optInAt);
  let n = 0; for (const r of rows) { await setOptIn(db, r.id, true, { source: 'playbypoint', by: who.email, phone: r.phone }); n++; }
  return { optedIn: n, players: rows.map((r) => r.id) };
}
/* The tick on the enrollment form arrives in the checkout session's metadata; the roster record names the player it filed. */
async function consentFromSession(db, session, rec) {
  try {
    const m = (session && session.metadata) || {}; const pid = rec && rec.player;
    if (!db || !pid || !rec.fresh || !/^(yes|no)$/.test(m.sms_opt_in || '')) return null;
    return await setOptIn(db, pid, m.sms_opt_in === 'yes', { source: 'enroll', by: m.by || 'enroll', phone: m.parent_phone });
  } catch (e) { return null; }
}

/* ---- sending ---- */
async function justcallSend(keys, from, to, body) {
  const f = net(); if (!f) throw new Error('No network');
  const res = await f(JUSTCALL_API + '/texts/new', {
    method: 'POST', headers: { Authorization: keys.key + ':' + keys.secret, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ justcall_number: from, contact_number: to, body })
  });
  let j = null; try { j = await res.json(); } catch (e) { j = null; }
  if (!res.ok) { const msg = j && (j.message || j.error || (j.errors && JSON.stringify(j.errors))) || ('JustCall ' + res.status); const e = new Error(String(msg).slice(0, 200)); e.status = res.status; throw e; }
  const d = j && (j.data || j);
  return { id: String((d && (d.id || d.sms_id || d.message_id)) || ''), raw: d };
}
const optedOutError = (msg) => /opt(ed)?[ -]?out|unsubscrib|blacklist|blocked|\bdnd\b|do not (disturb|message)/i.test(String(msg || ''));

/* A send: the batch and one log line per recipient are written first (so nothing is lost if the function stops), then the
   queue is worked through — a few at a time, a short pause between, three attempts each — within the request's time budget;
   whatever is left is picked up by `continueBatch` (the page keeps calling it until the batch is done). */
async function send(db, who, body, opts) {
  opts = opts || {};
  requireTexting(who);
  const text = cleanText(body.body, MAX_BODY); if (!text) throw S.err(400, 'body', 'Write the message first.');
  const wanted = Array.isArray(body.recipients) ? body.recipients.slice(0, MAX_RECIPIENTS) : [];
  if (!wanted.length) throw S.err(400, 'recipients', 'Pick at least one player.');
  const ln = await line(db); if (!ln.connected) throw S.err(409, 'keys', 'JustCall is not connected — an owner pastes the API key and secret under Players & billing → Notifications.');
  if (!ln.from) throw S.err(409, 'from', 'Set the JustCall number to text from (Players & billing → Notifications).');
  const cfg = await settings(db);
  const footer = cfg.footer ? '\n' + FOOTER(cfg.senderName) : '';
  const byId = {}; for (const r of await recipients(db)) byId[r.id] = r;
  const now = Date.now(); const batchRef = db.collection('smsBatches').doc(); const rows = []; const seen = new Set();
  for (const w of wanted) {
    const pid = String(w && w.player || '').trim(); const p = byId[pid]; if (!p || seen.has(pid)) continue; seen.add(pid);
    const vars = Object.assign({ first_name: p.first, program: p.programLabel }, w.vars && typeof w.vars === 'object' ? Object.fromEntries(Object.entries(w.vars).filter(([k]) => PLACEHOLDERS.includes(k)).map(([k, v]) => [k, cleanText(v, 60)])) : {});
    const msg = (render(text, vars) + footer).slice(0, 1600);
    let status = 'queued', reason = '';
    if (!p.phone) { status = 'skipped'; reason = 'no number'; } else if (!p.valid) { status = 'skipped'; reason = 'bad number'; } else if (!p.optIn) { status = 'skipped'; reason = 'not opted in'; }
    rows.push({ batch: batchRef.id, at: now, by: who.email, byName: who.name || who.email, player: p.id, playerName: p.name, group: p.group, program: p.program, coach: p.coach, phone: p.phone, body: msg, status, reason, attempts: 0, justcallId: '', delivery: '', error: '' });
  }
  if (!rows.length) throw S.err(400, 'recipients', 'None of those players are on the roster.');
  const counts = { total: rows.length, sent: 0, failed: 0, skipped: rows.filter((r) => r.status === 'skipped').length, queued: rows.filter((r) => r.status === 'queued').length };
  const seg = segments(render(text, { first_name: 'Alexander', program: 'Afterschool', time: '4:00 PM', court: '12' }) + footer);
  let batch = db.batch(); let n = 0;
  batch.set(batchRef, { at: now, by: who.email, byName: who.name || who.email, text, footer: cfg.footer ? FOOTER(cfg.senderName) : '', template: cleanText(body.template, 40), segments: seg.segments, encoding: seg.encoding, state: counts.queued ? 'sending' : 'done', counts, doneAt: counts.queued ? null : now }); n++;
  for (const r of rows) { batch.set(db.collection('smsLog').doc(), r); n++; if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; } }
  if (n) await batch.commit();
  const out = await continueBatch(db, batchRef.id, opts);
  return out;
}

async function continueBatch(db, batchId, opts) {
  opts = opts || {};
  batchId = String(batchId || '').trim(); if (!batchId) throw S.err(400, 'batch', 'batch id required');
  const ref = db.doc('smsBatches/' + batchId); const snap = await ref.get(); if (!snap.exists) throw S.err(404, 'batch', 'No such batch.');
  const b = snap.data();
  const logs = (await db.collection('smsLog').where('batch', '==', batchId).get()).docs.map((d) => ({ ref: d.ref, id: d.id, data: d.data() }));
  const queue = logs.filter((l) => l.data.status === 'queued');
  const budget = opts.budgetMs != null ? opts.budgetMs : 40000; const delay = opts.delayMs != null ? opts.delayMs : 120; const started = Date.now();
  const s = await NOTIFY.settings(db, true); const keys = { key: s.justcallKey, secret: s.justcallSecret }; const from = e164(s.justcallNumber || '');
  const flip = {};                                                   // players JustCall says have opted out: switch them off once
  let i = 0; let ran = 0;
  async function worker() {
    while (i < queue.length && Date.now() - started < budget) {
      const l = queue[i++]; ran++;
      let attempts = l.data.attempts || 0; let done = false;
      while (!done && attempts < ATTEMPTS) {
        attempts++;
        try {
          const r = await justcallSend(keys, from, l.data.phone, l.data.body);
          await l.ref.set({ status: 'sent', sentAt: Date.now(), attempts, justcallId: r.id, error: '' }, { merge: true }); l.data.status = 'sent'; done = true;
        } catch (e) {
          const retry = !e.status || e.status === 429 || e.status >= 500;
          if (!retry || attempts >= ATTEMPTS) {
            await l.ref.set({ status: 'failed', attempts, error: String(e.message || e).slice(0, 200), failedAt: Date.now() }, { merge: true }); l.data.status = 'failed'; done = true;
            if (optedOutError(e.message)) flip[l.data.player] = true;
          } else await sleep(opts.backoffMs != null ? opts.backoffMs : 1000 * attempts * attempts);
        }
      }
      await sleep(delay);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  for (const pid of Object.keys(flip)) { try { await setOptIn(db, pid, false, { source: 'justcall', by: 'justcall' }); } catch (e) { /* the log line already says failed */ } }
  const counts = { total: logs.length, sent: logs.filter((l) => l.data.status === 'sent').length, failed: logs.filter((l) => l.data.status === 'failed').length, skipped: logs.filter((l) => l.data.status === 'skipped').length, queued: logs.filter((l) => l.data.status === 'queued').length };
  const state = counts.queued ? 'sending' : 'done';
  await ref.set({ counts, state, doneAt: state === 'done' ? Date.now() : null, lastRunAt: Date.now() }, { merge: true });
  return Object.assign({ batch: batchId, state, text: b.text, ran }, counts);
}

/* Failed lines go back in the queue for another go (a JustCall hiccup, a number fixed since). */
async function retryBatch(db, batchId, opts) {
  const logs = (await db.collection('smsLog').where('batch', '==', String(batchId || '')).get()).docs;
  let n = 0; for (const d of logs) if (d.data().status === 'failed') { await d.ref.set({ status: 'queued', error: '', attempts: 0 }, { merge: true }); n++; }
  const out = await continueBatch(db, batchId, opts); out.retried = n; return out;
}

/* ---- history: the batches and the lines; a coach sees only the players they coach ---- */
async function history(db, who, q) {
  q = q || {};
  const pid = cleanText(q.player, 60); const limit = Math.min(2000, parseInt(q.limit, 10) || 600);
  const col = db.collection('smsLog');
  let all = (await (pid ? col.where('player', '==', pid) : col.orderBy('at', 'desc').limit(limit)).get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  let logs = all.filter((l) => l.batch);
  const events = pid ? [] : all.filter((l) => !l.batch && l.kind).map((l) => ({ id: l.id, kind: l.kind, at: l.at, phone: l.phone, body: l.body, players: l.players || [] })).sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!who.texting) { const me = fold(who.firstName || firstName(who.name)); logs = me ? logs.filter((l) => fold(l.coach) === me) : []; }
  logs.sort((a, b) => (b.at || 0) - (a.at || 0));
  logs = logs.slice(0, limit);
  const ids = [...new Set(logs.map((l) => l.batch))].slice(0, 100);
  const batches = [];
  for (const id of ids) { const d = await db.doc('smsBatches/' + id).get(); if (d.exists) batches.push(Object.assign({ id }, d.data())); }
  batches.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { batches, events: events.slice(0, 50), logs: logs.map((l) => ({ id: l.id, batch: l.batch, at: l.at, sentAt: l.sentAt || null, by: l.byName || l.by, player: l.player, playerName: l.playerName, group: l.group, coach: l.coach, phone: l.phone, body: l.body, status: l.status, reason: l.reason || '', error: l.error || '', delivery: l.delivery || '', attempts: l.attempts || 0 })) };
}

/* ---- the JustCall webhook: STOP / START from a family, delivery updates for what we sent ---- */
function signatureOk(secret, headers, body) {
  if (!secret) return false;
  const h = (k) => String(headers[k] || headers[k.toLowerCase()] || '');
  const given = h('x-justcall-signature'); const ts = h('x-justcall-request-timestamp');
  if (!given || !ts || !body || !body.webhook_url || !body.type) return false;
  const payload = `${secret}|${encodeURIComponent(body.webhook_url)}|${body.type}|${ts}`;
  const want = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
async function webhook(db, headers, body, opts) {
  opts = opts || {};
  const s = await NOTIFY.settings(db, true);
  if (!signatureOk(s.justcallSecret, headers || {}, body || {})) throw S.err(401, 'signature', 'Not from JustCall.');
  const type = String(body.type || ''); const d = body.data || {}; const out = { type, did: 'nothing' };
  if (type === 'sms.received' || (type === 'sms.sent_received' && /incoming/i.test(d.direction || ''))) {
    const from = e164(d.contact_number || ''); const text = String((d.sms_info && d.sms_info.body) || d.body || '').trim();
    if (!from) return out;
    const stop = STOP_WORDS.test(text), start = !stop && START_WORDS.test(text);
    if (!stop && !start) return Object.assign(out, { did: 'kept (a reply, read in the JustCall inbox)' });
    const hits = (await recipients(db)).filter((r) => r.phone === from);
    for (const r of hits) await setOptIn(db, r.id, start, { source: stop ? 'stop' : 'start', by: 'family', phone: from });
    await db.collection('smsLog').doc().set({ kind: stop ? 'optout' : 'optin', at: Date.now(), phone: from, body: text.slice(0, 200), players: hits.map((r) => r.id), by: 'family', status: stop ? 'stop' : 'start' });
    return Object.assign(out, { did: (stop ? 'opted out' : 'opted in') + ' ' + hits.length + ' player(s)', players: hits.map((r) => r.id) });
  }
  if (type === 'sms.status_updated' || type === 'sms.sent') {
    const id = String(d.id || ''); const delivery = String(d.delivery_status || d.status || '');
    if (!id || !delivery) return out;
    const hits = (await db.collection('smsLog').where('justcallId', '==', id).get()).docs;
    for (const h of hits) await h.ref.set({ delivery, deliveryAt: Date.now() }, { merge: true });
    return Object.assign(out, { did: 'delivery ' + delivery + ' on ' + hits.length + ' line(s)' });
  }
  return out;
}

module.exports = { settings, saveSettings, line, requireTexting, recipients, recipient, setOptIn, optInRoster, consentFromSession, switchMatch, switchIndex, send, continueBatch, retryBatch, history, webhook, signatureOk, segments, render, gsmSafe, placeholdersIn, validPhone, e164, DEFAULT_TEMPLATES, FOOTER, PLACEHOLDERS, _useFetch };
