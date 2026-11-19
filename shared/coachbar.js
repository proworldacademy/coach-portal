/* The bottom bars on a phone, outside the pages that have their own (Nov 14, 2026). First the coaches' bar: on a phone, a coach or a director who opens Privates or Attendance in Admin
   keeps the same four — Reminders · Players · Contact · Privates — so there is always a way back. Called by the page once it knows who is in:
   PWCoachBar(ctx, "privates"). Owners, the front desk and anyone without the Coach Portal get nothing. */
(function () {
  const I = {
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 21l2.2-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a5 5 0 0 0-10 0c0 1 .3 2 .8 2.800L4 15l3.400-.700A5 5 0 0 0 14 9z"/><path d="M10.500 16.200A5 5 0 0 0 17 17.300l3 .700-.800-2.900A5 5 0 0 0 16.800 8.200"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
  };
  const CSS = '@media(max-width:640px){.pw-coachbar{display:flex;position:fixed;left:14px;right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));height:66px;background:rgba(10,10,10,.92);border:1px solid rgba(255,255,255,.08);border-radius:999px;align-items:center;justify-content:space-around;padding:0 8px;z-index:60;box-shadow:0 10px 30px rgba(0,0,0,.25)}' +
    '.pw-coachbar a{color:#8E8E8A;font:700 11px "Aeonik Pro",system-ui,sans-serif;display:grid;place-items:center;gap:3px;text-decoration:none}.pw-coachbar i{width:38px;height:38px;border-radius:50%;display:grid;place-items:center}.pw-coachbar svg{width:19px;height:19px}' +
    '.pw-coachbar a.on{color:#fff}.pw-coachbar a.on i{background:#E2FE78;color:#0A0A0A}body.has-coachbar{padding-bottom:calc(104px + env(safe-area-inset-bottom,0px))!important}}@media(min-width:641px){.pw-coachbar{display:none}}';
  const MORE = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    desk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
    court: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M12 5v14M3 12h18"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>'
  };
  function draw(items, active, label) {
    const old = document.querySelector('.pw-coachbar'); if (old) old.remove(); document.body.classList.remove('has-coachbar');
    if (!items) return;
    if (!document.getElementById('pw-coachbar-css')) { const st = document.createElement('style'); st.id = 'pw-coachbar-css'; st.textContent = CSS; document.head.appendChild(st); }
    const nav = document.createElement('nav'); nav.className = 'pw-coachbar'; nav.setAttribute('aria-label', label || 'ProWorld');
    nav.innerHTML = items.map((x) => (x[1] === '#more' ? '<a href="#" data-more' : '<a href="' + x[1] + '"') + (x[3] === active ? ' class="on" aria-current="page"' : '') + ' data-k="' + x[3] + '"' + (x[3] === 'team' ? ' data-team-dot' + (window.PWTeamUnread ? ' data-has="1"' : '') : '') + '><i>' + x[2] + '</i>' + x[0] + '</a>').join('');
    nav.addEventListener('click', (e) => { const t = e.target.closest('a[href="#top"]'); if (t) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; } const m = e.target.closest('[data-more]'); if (m) { e.preventDefault(); const b = document.querySelector('.pwd-burger'); if (b) b.click(); } });
    document.body.appendChild(nav); document.body.classList.add('has-coachbar');
  }
  const setOn = (k) => document.querySelectorAll('.pw-coachbar a').forEach((a) => { const on = a.dataset.k === k; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

  /* The Coach Portal's strip, on the pages outside it (Nov 19, 2026 — management: "I click one menu item and it opens a different bar,
     and that bar takes me to the old menu… it should always be consistent"). The same items, in the same order, with the same look as
     the strip in the Coach Portal: Reminders · Players · Contact · Locker Room · Privates, and for a director or an owner Attendance ·
     Text a group · Coach Board · Staff & access. A desktop row; a phone has the bottom bar. `tabs` names the items that are tabs of the
     page itself (the Admin page): they come out as buttons with data-view, the rest as links. */
  const UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const SCSS = 'nav.pw-cstrip{display:flex!important;background:rgba(233,233,228,.62)!important;border-radius:999px!important;padding:4px!important;gap:2px!important;width:max-content!important;max-width:100%;overflow-x:auto;scrollbar-width:none;margin:10px auto 22px!important;border:0!important;box-shadow:none!important;flex-wrap:nowrap!important}nav.pw-cstrip::-webkit-scrollbar{display:none}' +
    'nav.pw-cstrip a,nav.pw-cstrip button{display:inline-flex!important;align-items:center;position:relative;border:0!important;background:transparent!important;padding:9px 16px!important;border-radius:999px!important;font:700 13px "Aeonik Pro","Helvetica Neue",Arial,sans-serif!important;letter-spacing:0!important;text-transform:none!important;color:#6b6d66!important;white-space:nowrap;text-decoration:none!important;box-shadow:none!important;flex:0 0 auto;cursor:pointer;transform:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}' +
    'nav.pw-cstrip a:hover,nav.pw-cstrip button:hover{color:#0A0A0A!important}nav.pw-cstrip .on,nav.pw-cstrip [aria-current="page"]{background:#0A0A0A!important;color:#fff!important}nav.pw-cstrip i{display:inline-grid;width:15px;height:15px;margin-right:7px}nav.pw-cstrip i svg{width:15px;height:15px}' +
    'nav.pw-cstrip [data-team-dot][data-has="1"]::after{position:static!important;display:inline-block;margin-left:7px;width:8px;height:8px;box-shadow:none!important}' +
    '@media(max-width:1500px){nav.pw-cstrip a,nav.pw-cstrip button{padding-left:13px!important;padding-right:13px!important;font-size:13.5px!important}}@media(max-width:860px){nav.pw-cstrip{display:none!important}}' +
    'html.dark nav.pw-cstrip{background:rgba(30,30,30,.92)!important}html.dark nav.pw-cstrip a,html.dark nav.pw-cstrip button{color:#C9C9C4!important}html.dark nav.pw-cstrip .on,html.dark nav.pw-cstrip [aria-current="page"]{background:#E2FE78!important;color:#0A0A0A!important}';
  window.PWCoachStrip = function (el, opts) {
    try {
      opts = opts || {}; if (!el) return false;
      if (!document.getElementById('pw-cstrip-css')) { const st = document.createElement('style'); st.id = 'pw-cstrip-css'; st.textContent = SCSS; document.head.appendChild(st); }
      const items = [['home', 'Reminders', '/portal/#/', I.bell], ['players', 'Players', '/portal/#/players', I.people], ['contact', 'Contact', '/portal/#/messages', I.chat], ['team', 'Locker Room', '/team', I.team], ['privates', 'Privates', '/backend#privates', I.cal], ['calendar', 'Calendar', '/portal/#/calendar', I.cal]]
        .concat(opts.director ? [['attendance', 'Attendance', '/backend#attendance', MORE.check], ['board', 'Coach Board', '/portal/#/board', I.people], ['news', 'Parent news', '/backend#news', MORE.doc], ['staff', 'Staff & access', '/portal/#/staff', MORE.doc]] : []);
      const tabs = opts.tabs || [];
      el.classList.add('pw-cstrip'); el.setAttribute('aria-label', 'Coach Portal');
      el.innerHTML = items.map(([k, label, href, ic]) => tabs.includes(k)
        ? '<button type="button" data-view="' + k + '"' + (k === opts.active ? ' aria-current="page"' : ' aria-current="false"') + '><i>' + ic + '</i>' + label + '</button>'
        : '<a href="' + href + '"' + (k === opts.active ? ' class="on" aria-current="page"' : '') + (k === 'team' ? ' data-team-dot' + (window.PWTeamUnread ? ' data-has="1"' : '') : '') + '><i>' + ic + '</i>' + label + '</a>').join('');
      return true;
    } catch (e) { return false; }
  };
  /* The coaches' four, outside the Coach Portal */
  window.PWCoachBar = function (ctx, active) {
    try {
      const role = String((ctx && ctx.rec && ctx.rec.role) || '').toLowerCase();
      if (!ctx || ctx.owner || !ctx.has || !ctx.has('coach-portal') || !(role === 'coach' || role === 'director')) { draw(null); return false; }
      draw([['Reminders', '/portal/#/', I.bell, 'home'], ['Players', '/portal/#/players', I.people, 'players'], ['Contact', '/portal/#/messages', I.chat, 'contact'], ['Locker Room', '/team', I.team, 'team'], ['Privates', '/backend#privates', I.cal, 'privates']], active, 'Coach Portal'); return true;
    } catch (e) { return false; }
  };
  /* Every side has a bar on a phone (Nov 14, 2026 — "yes, bottom bar"). The page calls PWSideBar(ctx, where) once it knows who is in:
     an owner or administrator: Today · Coaches · Admin · Marketing · More (the menu);
     the front desk, in Admin: Attendance · Desk · Players · Messages · Courts (follows the tab);
     a coach or director outside the Coach Portal: the coaches' four. Pages with a bar of their own (Coach Portal, Marketing) do not call it. */
  window.PWSideBar = function (ctx, where) {
    try {
      if (!ctx) return;
      const role = String((ctx.rec && ctx.rec.role) || '').toLowerCase();
      if (ctx.owner || ctx.admin) { draw([['Today', '/', MORE.home, 'today'], ['Coaches', '/portal/', I.people, 'coaches'], ['Admin', '/backend', MORE.desk, 'admin'], ['Locker Room', '/team', I.team, 'team'], ['More', '#more', MORE.more, 'more']], where, 'ProWorld'); return; }
      if (role === 'desk' && where === 'admin') {
        const tab = () => (location.hash || '#attendance').slice(1).split('/')[0];
        draw([['Attendance', '/backend#attendance', MORE.check, 'attendance'], ['Desk', '/backend#desk', MORE.desk, 'desk'], ['Players', '/backend#players', I.people, 'players'], ['Messages', '/backend#messages', I.chat, 'messages'], ['Courts', '/backend#courts', MORE.court, 'courts']], tab(), 'Front desk');
        if (!window.__pwDeskBar) { window.__pwDeskBar = true; window.addEventListener('hashchange', () => setOn(tab())); }
        return;
      }
      window.PWCoachBar(ctx, where === 'admin' ? 'privates' : where === 'team' ? 'team' : '');
    } catch (e) { /* the page works without the bar */ }
  };
  /* The member side: Home · Schedule · Messages · Billing (sections of the family account; Nov 17, 2026: the schedule and the messages took the places of Reports and Front desk, which the home page links to) */
  window.PWMemberBar = function (active) {
    try { draw([['Home', '#top', MORE.home, 'top'], ['Schedule', '#schedule', I.cal, 'schedule'], ['Messages', '#messages', I.chat, 'messages'], ['Billing', '#billing', MORE.card, 'billing']], active || 'top', 'Your family');
      document.querySelectorAll('.pw-coachbar a').forEach((a) => a.addEventListener('click', () => setOn(a.dataset.k))); } catch (e) { /* fine */ }
  };
  /* called by shared/pwauth.js once the person is in, on every page of the team side */
  window.PWSideAuto = function (ctx) {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (/^\/(portal|marketing|family|enroll)(\/|$)/.test(p)) return;          // these have a bar of their own, or are the member side
    window.PWSideBar(ctx, p === '/' ? 'today' : /^\/backend/.test(p) ? 'admin' : /^\/team/.test(p) ? 'team' : '');
  };
  /* ── Team (Nov 15, 2026): the team's own messaging, /team. On every page of the team side: a red dot on "Team" (the bars, the top strip) while
     a chat you are in has a line you have not read; on a phone whose bar has no Team (the front desk's, Marketing's), a round button above
     the bar; and a tap on one of the app's notifications opens the page it is about. Two small live reads: your chats, what you have read. ── */
  const TCSS = '[data-team-dot]{position:relative}[data-team-dot][data-has="1"]::after{content:"";position:absolute;top:6px;right:calc(50% - 22px);width:10px;height:10px;border-radius:50%;background:#F06A5E;box-shadow:0 0 0 2px #0A0A0A}' +
    '.pwd-strip [data-team-dot][data-has="1"]::after{top:4px;right:2px;box-shadow:none}' +
    '.pw-teamfab{position:fixed;right:16px;bottom:calc(96px + env(safe-area-inset-bottom,0px));width:54px;height:54px;border-radius:50%;background:#0A0A0A;color:#E2FE78;display:none;place-items:center;z-index:58;box-shadow:0 12px 30px -10px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.12)}.pw-teamfab svg{width:24px;height:24px}.pw-teamfab[data-has="1"]::after{top:2px;right:2px;box-shadow:0 0 0 2px #0A0A0A}@media(max-width:640px){.pw-teamfab.show{display:grid}}';
  function teamPaint(n) {
    window.PWTeamUnread = n; document.querySelectorAll('[data-team-dot]').forEach((el) => { if (n) el.setAttribute('data-has', '1'); else el.removeAttribute('data-has'); });
  }
  function teamFab() {
    const p = location.pathname.replace(/\/+$/, '') || '/'; if (/^\/(team|family|enroll)(\/|$)/.test(p)) return;
    let fab = document.querySelector('.pw-teamfab'); if (!fab) { fab = document.createElement('a'); fab.className = 'pw-teamfab'; fab.href = '/team'; fab.setAttribute('aria-label', 'Locker Room'); fab.setAttribute('data-team-dot', ''); fab.innerHTML = I.team; document.body.appendChild(fab); }
    const inBar = !!document.querySelector('.pw-coachbar [data-k="team"], .cp-appbar [data-team-dot]'); fab.classList.toggle('show', !inBar); if (window.PWTeamUnread) fab.setAttribute('data-has', '1');
  }
  window.PWTeamWatch = function (ctx) {
    try {
      if (window.__pwTeam || !ctx || !ctx.email || ctx.active === false || !window.PWAuth) return; let fs = window.PWAuth.fs(); if (!fs && typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) fs = firebase.firestore();   /* the Coach Portal keeps its own sign-in */ if (!fs) return; window.__pwTeam = true;
      if (!document.getElementById('pw-team-css')) { const st = document.createElement('style'); st.id = 'pw-team-css'; st.textContent = TCSS; document.head.appendChild(st); }
      const me = String(ctx.email).toLowerCase(); let chats = {}, reads = { r: {}, mute: {} };
      const count = () => { let n = 0; Object.keys(chats).forEach((id) => { const c = chats[id]; if (c.last && c.last.at && c.last.by !== me && c.last.at > (reads.r[id] || 0) && !reads.mute[id]) n++; }); teamPaint(n); };
      fs.collection('teamChats').where('members', 'array-contains', me).onSnapshot((s) => { chats = {}; s.docs.forEach((d) => { chats[d.id] = d.data(); }); count(); }, () => {});
      fs.doc('teamReads/' + me).onSnapshot((d) => { const x = (d.exists && d.data()) || {}; reads = { r: x.r || {}, mute: x.mute || {} }; count(); }, () => {});
      [400, 1500, 4000].forEach((ms) => setTimeout(teamFab, ms));
      /* a call (Nov 15): while someone is calling a chat you are in, a bar across the top of whatever page you are on, with a ring, for 45 seconds */
      let ringT = 0, ringCtx = null; const quiet = {};
      const stopRing = () => { clearInterval(ringT); ringT = 0; const b = document.getElementById('pw-ring'); if (b) b.remove(); };
      const beep = () => { try { ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)(); const t = ringCtx.currentTime; [0, 0.28].forEach((d) => { const o = ringCtx.createOscillator(), g = ringCtx.createGain(); o.frequency.value = 660; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22); o.connect(g); g.connect(ringCtx.destination); o.start(t + d); o.stop(t + d + 0.24); }); } catch (e) { /* silent */ } };
      fs.collection('teamCalls').where('members', 'array-contains', me).where('state', '==', 'live').onSnapshot((s) => {
        const now = Date.now(); let pick = null; s.docs.forEach((d) => { const c = d.data() || {}; if (c.by !== me && now - (c.at || 0) < 45000 && !quiet[d.id]) pick = pick || Object.assign({ id: d.id }, c); });
        if (window.PWCall && window.PWCall.active()) pick = null;
        if (!pick) { stopRing(); return; } if (document.getElementById('pw-ring') && document.getElementById('pw-ring').dataset.id === pick.id) return; stopRing();
        const b = document.createElement('div'); b.id = 'pw-ring'; b.dataset.id = pick.id; b.setAttribute('role', 'alertdialog');
        b.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:95;background:#0A0A0A;color:#fff;border-radius:20px;padding:14px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 20px 50px -18px rgba(0,0,0,.7);font:400 14.5px system-ui;max-width:520px;margin:0 auto';
        const who = String(pick.byName || 'Someone').replace(/[<>&]/g, ''); const where = String(pick.title || '').replace(/[<>&]/g, '');
        b.innerHTML = '<span style="font-size:22px">' + (pick.kind === 'video' ? '📹' : '📞') + '</span><span style="flex:1;min-width:0"><b style="display:block;font-weight:700">' + who + ' is calling</b><small style="color:rgba(255,255,255,.65)">' + (where && where !== who ? where : 'Locker Room') + '</small></span><button type="button" data-x style="border:1px solid rgba(255,255,255,.3);background:none;color:#fff;border-radius:999px;padding:9px 12px;font:700 12.5px system-ui;cursor:pointer">Not now</button><a href="/team#/call/' + pick.id + '" style="background:#E2FE78;color:#0A0A0A;border-radius:999px;padding:10px 16px;font:700 13px system-ui;text-decoration:none">Join</a>';
        b.querySelector('[data-x]').onclick = () => { quiet[pick.id] = 1; stopRing(); }; b.querySelector('a').addEventListener('click', () => { quiet[pick.id] = 1; setTimeout(stopRing, 50); });
        document.body.appendChild(b); beep(); ringT = setInterval(() => { if (Date.now() - (pick.at || 0) > 45000) { stopRing(); return; } beep(); }, 2500);
      }, () => {});
      const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications; const here = location.pathname;
      if (P && !/^\/(portal|team)(\/|$)/.test(here)) P.addListener('pushNotificationActionPerformed', (a) => { try { const u = a && a.notification && a.notification.data && a.notification.data.url; if (u && /^\/[^/]/.test(u)) location.href = u; } catch (e) { /* stay */ } });
    } catch (e) { /* the pages work without it */ }
  };
  /* ── Staying alive (Nov 16, 2026: "the app stalls, we have to close it and open it again"). A page that sat behind another app, or came
     back with the Back gesture, can be left holding a dead line to the database: it looks fine and nothing moves. So:
       · back in front after more than 20 seconds away, or restored by Back, or the network returns: the line to the database is dropped
         and opened again at once (not after the minute it can take on its own); the pages are told (the event "pw-resume") and redraw;
       · after more than eight hours away: the page is loaded fresh;
       · a page that is still waiting for its first data after 10 seconds reconnects once, and after 25 says so with a Reload button;
       · a tap that leads to another page shows a line moving across the top at once, so a slow load does not look like a dead button. ── */
  (function () {
    const db = () => { try { const a = window.PWAuth && window.PWAuth.fs && window.PWAuth.fs(); if (a) return a; if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) return firebase.firestore(); } catch (e) { /* none */ } return null; };
    let busy = false, hiddenAt = 0, lastKick = 0;
    function reconnect(why) {
      const fs = db(); if (!fs || busy || Date.now() - lastKick < 4000 || typeof fs.disableNetwork !== 'function') return Promise.resolve(false); busy = true; lastKick = Date.now();
      return fs.disableNetwork().then(() => fs.enableNetwork()).then(() => { busy = false; try { document.dispatchEvent(new CustomEvent('pw-resume', { detail: { why } })); } catch (e) { /* fine */ } return true; }, () => { busy = false; return false; });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; } const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
      if (away > 8 * 3600 * 1000 && !(window.PWCall && window.PWCall.active && window.PWCall.active())) { location.reload(); return; }
      if (away > 20000) reconnect('back'); else { try { document.dispatchEvent(new CustomEvent('pw-resume', { detail: { why: 'front' } })); } catch (e) { /* fine */ } }
    });
    window.addEventListener('pageshow', (e) => { const g = document.getElementById('pw-going'); if (g) g.remove(); if (e.persisted) reconnect('restored'); });
    window.addEventListener('online', () => reconnect('online'));
    /* a page says what "loaded" means; if that is not true in time, reconnect once, then say so */
    function expect(isReady, what) {
      setTimeout(() => { try { if (!isReady()) reconnect('slow'); } catch (e) { /* fine */ } }, 10000);
      setTimeout(() => { try { if (isReady() || document.getElementById('pw-stuck')) return; } catch (e) { return; }
        const b = document.createElement('div'); b.id = 'pw-stuck'; b.setAttribute('role', 'alert'); b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(110px + env(safe-area-inset-bottom,0px));z-index:94;max-width:520px;margin:0 auto;background:#0A0A0A;color:#fff;border-radius:18px;padding:14px 16px;display:flex;align-items:center;gap:12px;font:400 14px system-ui;box-shadow:0 20px 50px -18px rgba(0,0,0,.7)';
        b.innerHTML = '<span style="flex:1"><b style="display:block;font-weight:700">Still loading ' + String(what || 'the page').replace(/[<>&]/g, '') + '</b><small style="color:rgba(255,255,255,.65)">The connection is slow or was lost.</small></span><button type="button" style="border:0;background:#E2FE78;color:#0A0A0A;border-radius:999px;padding:10px 16px;font:700 13px system-ui;cursor:pointer">Reload</button>';
        b.querySelector('button').onclick = () => location.reload(); document.body.appendChild(b);
        const t = setInterval(() => { try { if (isReady()) { clearInterval(t); b.remove(); } } catch (e) { clearInterval(t); } }, 1500);
      }, 25000);
    }
    /* the line across the top while another page is on its way */
    function going() { if (document.getElementById('pw-going') || !document.body) return; const g = document.createElement('div'); g.id = 'pw-going'; g.style.cssText = 'position:fixed;left:0;top:0;height:3px;width:100%;z-index:99;background:linear-gradient(90deg,#E2FE78,#E2FE78);transform-origin:0 50%;transform:scaleX(.08);transition:transform 6s cubic-bezier(.1,.7,.1,1);pointer-events:none'; document.body.appendChild(g); requestAnimationFrame(() => { g.style.transform = 'scaleX(.92)'; }); setTimeout(() => { if (g.parentNode) g.remove(); }, 15000); }
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; const a = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (!a || a.target || a.hasAttribute('download')) return;
      let u; try { u = new URL(a.href, location.href); } catch (x) { return; } if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) return;
setTimeout(() => { if (!e.defaultPrevented) going(); }, 0);
    }, false);
    window.PWAlive = { reconnect, expect, going };
  })();

  (function wait(n) { let c = null; try { c = window.PWAuth && window.PWAuth.ctx; } catch (e) { c = null; } if (c) { window.PWSideAuto(c); window.PWTeamWatch(c); } else if (n < 120) setTimeout(() => wait(n + 1), 150); })(0);   // this file can load before the sign-in is read
})();
