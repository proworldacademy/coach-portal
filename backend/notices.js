/* Parent notifications, the team's side (Nov 22, 2026): pick a start, say who and when, send. Mounted at the top of Admin → Parent news.
   Engine: functions/lib/notices.js. window.PWNotices.mount(el, { api, toast, owner }). */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `.nt{display:grid;gap:14px;max-width:720px}.nt-l{font-size:12px;font-weight:700;letter-spacing:.04em;display:grid;gap:6px}
.nt input[type=text],.nt input[type=date],.nt input[type=datetime-local],.nt select,.nt textarea{font:inherit;font-size:15px;font-weight:400;letter-spacing:0;border:1px solid rgba(10,10,10,.2);border-radius:12px;padding:10px 12px;background:#fff;width:100%;color:inherit}
.nt-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:700px){.nt-row{grid-template-columns:1fr}}
.nt-c{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.35}.nt-c input{margin-top:3px;flex:none}.nt-c small{display:block;opacity:.6;font-size:12.5px}
.nt-n{font-size:13.5px;opacity:.75;min-height:1.3em}.nt-go{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.nt-s{font-size:12.5px;opacity:.65;white-space:nowrap}.nt [hidden]{display:none!important}
@media(max-width:700px){#nt-host .todo li{flex-wrap:wrap}#nt-host .todo li>span:nth-child(2){flex:1;min-width:0}#nt-host .todo li .acts{width:100%;padding-left:21px}.nt-s{white-space:normal}}`;
  let D = null, host = null, O = null, cnt = null, cntT = 0;
  const F = { tpl: 'rain', kind: 'weather', title: '', body: '', group: '', camp: '', date: '', when: 'now', at: '', remind: false, text: true, post: false };
  const time = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const day = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fam = (n) => n + (n === 1 ? ' family' : ' families');
  function pick(id) { const t = D.templates.find((x) => x.id === id) || D.templates[0]; Object.assign(F, { tpl: t.id, kind: t.kind, title: t.title, body: t.body, group: t.group || '', remind: !!t.remind, text: !!t.text, post: !!t.post });
    if (F.group === 'nocamp') { const c = D.camps[0]; F.camp = c ? c.id : ''; if (c) F.title = c.title + ' is coming'; } }
  const body = () => { const at = F.when === 'later' && F.at ? new Date(F.at).getTime() : 0; return { kind: F.kind, title: F.title, body: F.body, group: F.group, camp: F.camp, date: F.date, sendAt: at, remind: F.remind && !!F.date, text: F.text && textKind() && D.texting, post: F.post && F.kind !== 'weather' }; };
  const textKind = () => F.kind === 'weather' || F.kind === 'news';
  function recount() { clearTimeout(cntT); cntT = setTimeout(async () => { try { cnt = await O.api('/api/admin/notices/count', body()); } catch (e) { cnt = null; } paintCount(); }, 250); }
  function paintCount() { const el = host.querySelector('#nt-n'), go = host.querySelector('#nt-go'); if (!el) return; const later = F.when === 'later' && F.at;
    el.textContent = cnt ? fam(cnt.families) + ' · ' + cnt.app + ' with notifications on' + (cnt.text ? ' · ' + cnt.text + ' by text' : '') + '. Everyone sees it behind the bell in their account.' : '';
    go.dataset.sure = ''; go.textContent = (later ? 'Schedule for ' : 'Send to ') + (cnt ? fam(cnt.families) : 'the families'); }
  function draw() {
    if (!D) { host.innerHTML = '<section class="section"><h2>Send a notification</h2><p class="muted">Loading…</p></section>'; return; }
    const seg = (name, rows, cur) => `<div class="seg" data-seg="${name}">${rows.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div>`;
    const groups = Object.keys(D.groups).filter((g) => g !== 'camp' && (g !== 'nocamp' || D.camps.length)).map((g) => [g, g === 'nocamp' ? 'Not signed up for a camp' : D.groups[g]]);
    const row = (x, act) => `<li><span class="k ${x.kind === 'weather' ? 'info' : x.kind === 'camp' ? 'warn' : x.kind === 'event' ? 'lime' : 'ok'}"></span><span><b>${esc(x.title)}</b> <span class="muted">· ${esc(x.kindLabel)} · ${esc(x.groupLabel)}${x.auto ? ' · by itself' : ''}</span><br><span class="muted">${esc(x.body)}</span></span><span class="acts">${act}</span></li>`;
    host.innerHTML = `<style>${CSS}</style><section class="section"><h2>Send a notification</h2>
      <p class="muted" style="max-width:720px">It goes to the parents' phones, and it stays 30 days behind the bell in their account. Parents choose what they hear about in Your account.</p>
      <div class="nt">
        <div class="nt-l">Start from${seg('tpl', D.templates.map((t) => [t.id, t.name]), F.tpl)}</div>
        <label class="nt-l">Title<input type="text" id="nt-title" maxlength="90" value="${esc(F.title)}" placeholder="e.g. Mental session on Wednesday"></label>
        <label class="nt-l">One or two lines<textarea id="nt-body" maxlength="300" rows="2" placeholder="What, when, where.">${esc(F.body)}</textarea></label>
        <div class="nt-l">Who${seg('group', groups, F.group)}</div>
        <label class="nt-l" ${F.group === 'nocamp' ? '' : 'hidden'}>Which camp<select id="nt-camp">${D.camps.map((c) => `<option value="${esc(c.id)}" ${c.id === F.camp ? 'selected' : ''}>${esc(c.title)} · ${esc(c.dates)}</option>`).join('')}</select></label>
        <div class="nt-row"><div class="nt-l">When${seg('when', [['now', 'Now'], ['later', 'At a time']], F.when)}</div>
          <label class="nt-l" ${F.when === 'later' ? '' : 'hidden'}>Day and time<input type="datetime-local" id="nt-at" value="${esc(F.at)}"></label></div>
        <label class="nt-l" ${F.kind === 'weather' ? 'hidden' : ''}>The day it is about (if it has one)<input type="date" id="nt-date" min="${esc(D.today)}" value="${esc(F.date)}" style="max-width:220px"></label>
        <label class="nt-c" ${F.kind !== 'weather' && F.date ? '' : 'hidden'}><input type="checkbox" id="nt-remind" ${F.remind ? 'checked' : ''}><span>Remind them the evening before<small>At 6 PM the day before, to the same families.</small></span></label>
        <label class="nt-c" ${F.kind === 'weather' ? 'hidden' : ''}><input type="checkbox" id="nt-post" ${F.post ? 'checked' : ''}><span>Also show it in Coming up<small>The window at the top of every client's home.</small></span></label>
        <label class="nt-c" ${textKind() ? '' : 'hidden'}><input type="checkbox" id="nt-text" ${F.text && D.texting ? 'checked' : ''} ${D.texting ? '' : 'disabled'}><span>Text the families whose notifications are off<small>${D.texting ? 'Only families who agreed to texts. Weather and news only.' : 'Texts are sent by the front desk, the administrators and the owners.'}</small></span></label>
        <p class="nt-n" id="nt-n"></p>
        <div class="nt-go"><button class="btn" type="button" id="nt-go">Send</button></div>
      </div></section>
      ${D.scheduled.length ? `<section class="section"><h2>Waiting</h2><ul class="todo">${D.scheduled.map((x) => row(x, `<span class="nt-s">${esc(time(x.sendAt))}</span> <button class="btn xs" data-nt-x="${esc(x.id)}">Cancel</button>`)).join('')}</ul></section>` : ''}
      <section class="section"><h2>Sent by themselves</h2><ul class="todo">
        <li><span class="k warn"></span><span><b>A camp is coming</b><br><span class="muted">${D.campDays.join(' days and ')} days before it starts, at 10 AM, to the families not signed up.${D.camps.length ? ' Next: ' + D.camps.filter((c) => c.auto.length).map((c) => esc(c.title) + ' on ' + c.auto.map(day).join(' and ')).join('; ') + '.' : ''}</span></span><span class="acts">${O.owner ? `<button class="btn xs" id="nt-auto">${D.settings.campAuto ? 'On · switch off' : 'Off · switch on'}</button>` : `<span class="nt-s">${D.settings.campAuto ? 'On' : 'Off'}</span>`}</span></li>
        <li><span class="k lime"></span><span><b>An event is tomorrow</b><br><span class="muted">The evening before, when "Remind them" was ticked.${D.waitingReminders.length ? ' Waiting: ' + D.waitingReminders.map((r) => esc(r.title) + ' (' + day(r.date) + ')').join('; ') + '.' : ''}</span></span><span class="acts"></span></li>
        <li><span class="k ok"></span><span><b>A private is tomorrow</b><br><span class="muted">Already running, with the lesson reminders.</span></span><span class="acts"></span></li></ul></section>
      <section class="section"><h2>Sent</h2>${D.sent.length ? `<ul class="todo">${D.sent.map((x) => row(x, `<span class="nt-s">${esc(time(x.sentAt))}${x.stats ? ' · ' + fam(x.stats.families) + ' · ' + x.stats.phones + ' phone' + (x.stats.phones === 1 ? '' : 's') + (x.stats.text ? ' · ' + x.stats.text + ' text' + (x.stats.text === 1 ? '' : 's') : '') : ''}</span>`)).join('')}</ul>` : '<p class="muted">Nothing sent yet.</p>'}</section>`;
    const q = (s) => host.querySelector(s);
    host.querySelectorAll('[data-seg] button').forEach((b) => b.onclick = () => { const k = b.parentNode.dataset.seg, v = b.dataset.v;
      if (k === 'tpl') pick(v); else { F[k] = v; if (k === 'group' && v === 'nocamp' && !F.camp && D.camps[0]) F.camp = D.camps[0].id; } draw(); });
    q('#nt-title').oninput = (e) => { F.title = e.target.value; }; q('#nt-body').oninput = (e) => { F.body = e.target.value; };
    q('#nt-camp').onchange = (e) => { F.camp = e.target.value; recount(); };
    q('#nt-at').onchange = (e) => { F.at = e.target.value; paintCount(); };
    q('#nt-date').onchange = (e) => { F.date = e.target.value; draw(); };
    q('#nt-remind').onchange = (e) => { F.remind = e.target.checked; }; q('#nt-post').onchange = (e) => { F.post = e.target.checked; };
    q('#nt-text').onchange = (e) => { F.text = e.target.checked; recount(); };
    q('#nt-go').onclick = async (e) => { const b = e.currentTarget; const later = F.when === 'later';
      if (!F.title.trim() || !F.body.trim()) return O.toast('Write the title and one line first.');
      if (later && !(F.at && new Date(F.at).getTime() > Date.now() + 60000)) return O.toast('Pick a day and time that is still ahead.');
      if (!later && b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to send to ' + (cnt ? fam(cnt.families) : 'the families'); setTimeout(() => { if (b.isConnected && b.dataset.sure === '1') paintCount(); }, 5000); return; }
      b.disabled = true; b.textContent = later ? 'Scheduling…' : 'Sending…';
      try { const o = await O.api('/api/admin/notices', body());
        O.toast(o.scheduled ? 'Scheduled for ' + time(o.scheduled) + '.' : 'Sent to ' + fam(o.stats.families) + ': ' + o.stats.phones + ' phone' + (o.stats.phones === 1 ? '' : 's') + (o.stats.text ? ', ' + o.stats.text + ' text' + (o.stats.text === 1 ? '' : 's') : '') + '.' + (o.textError ? ' Texts did not go: ' + o.textError : ''));
        pick('blank'); F.when = 'now'; F.at = ''; F.date = ''; await load(); if (O.after) O.after(); }
      catch (x) { O.toast(x.message || 'Not sent.'); b.disabled = false; paintCount(); } };
    host.querySelectorAll('[data-nt-x]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await O.api('/api/admin/notices/cancel', { id: b.dataset.ntX }); await load(); } catch (x) { O.toast(x.message || 'Not cancelled.'); b.disabled = false; } });
    const au = q('#nt-auto'); if (au) au.onclick = async () => { au.disabled = true; try { D.settings = await O.api('/api/admin/notices/settings', { campAuto: !D.settings.campAuto }); draw(); } catch (x) { O.toast(x.message || 'Not saved.'); au.disabled = false; } };
    paintCount(); recount();
  }
  async function load() { D = await O.api('/api/admin/notices'); if (!D.templates.some((t) => t.id === F.tpl) || (!F.title && F.tpl === 'rain')) pick(F.tpl); if (host && host.isConnected) draw(); }
  window.PWNotices = { mount(el, opts) { host = el; O = opts; draw(); load().catch((e) => { host.innerHTML = ''; O.toast(e.message || 'Could not load the notifications.'); }); } };
})();
