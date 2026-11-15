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

  /* The coaches' four, outside the Coach Portal */
  window.PWCoachBar = function (ctx, active) {
    try {
      const role = String((ctx && ctx.rec && ctx.rec.role) || '').toLowerCase();
      if (!ctx || ctx.owner || !ctx.has || !ctx.has('coach-portal') || !(role === 'coach' || role === 'director')) { draw(null); return false; }
      draw([['Reminders', '/portal/#/', I.bell, 'home'], ['Players', '/portal/#/players', I.people, 'players'], ['Contact', '/portal/#/messages', I.chat, 'contact'], ['Team', '/team', I.team, 'team'], ['Privates', '/backend#privates', I.cal, 'privates']], active, 'Coach Portal'); return true;
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
      if (ctx.owner || ctx.admin) { draw([['Today', '/', MORE.home, 'today'], ['Coaches', '/portal/', I.people, 'coaches'], ['Admin', '/backend', MORE.desk, 'admin'], ['Team', '/team', I.team, 'team'], ['More', '#more', MORE.more, 'more']], where, 'ProWorld'); return; }
      if (role === 'desk' && where === 'admin') {
        const tab = () => (location.hash || '#attendance').slice(1).split('/')[0];
        draw([['Attendance', '/backend#attendance', MORE.check, 'attendance'], ['Desk', '/backend#desk', MORE.desk, 'desk'], ['Players', '/backend#players', I.people, 'players'], ['Messages', '/backend#messages', I.chat, 'messages'], ['Courts', '/backend#courts', MORE.court, 'courts']], tab(), 'Front desk');
        if (!window.__pwDeskBar) { window.__pwDeskBar = true; window.addEventListener('hashchange', () => setOn(tab())); }
        return;
      }
      window.PWCoachBar(ctx, where === 'admin' ? 'privates' : where === 'team' ? 'team' : '');
    } catch (e) { /* the page works without the bar */ }
  };
  /* The member side: Home · Reports · Billing · Front desk (sections of the family account) */
  window.PWMemberBar = function (active) {
    try { draw([['Home', '#top', MORE.home, 'top'], ['Reports', '#reports', MORE.doc, 'reports'], ['Billing', '#billing', MORE.card, 'billing'], ['Front desk', '#requests', I.chat, 'requests']], active || 'top', 'Your family');
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
    let fab = document.querySelector('.pw-teamfab'); if (!fab) { fab = document.createElement('a'); fab.className = 'pw-teamfab'; fab.href = '/team'; fab.setAttribute('aria-label', 'Team chat'); fab.setAttribute('data-team-dot', ''); fab.innerHTML = I.team; document.body.appendChild(fab); }
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
      const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications; const here = location.pathname;
      if (P && !/^\/(portal|team)(\/|$)/.test(here)) P.addListener('pushNotificationActionPerformed', (a) => { try { const u = a && a.notification && a.notification.data && a.notification.data.url; if (u && /^\/[^/]/.test(u)) location.href = u; } catch (e) { /* stay */ } });
    } catch (e) { /* the pages work without it */ }
  };
  (function wait(n) { let c = null; try { c = window.PWAuth && window.PWAuth.ctx; } catch (e) { c = null; } if (c) { window.PWSideAuto(c); window.PWTeamWatch(c); } else if (n < 120) setTimeout(() => wait(n + 1), 150); })(0);   // this file can load before the sign-in is read
})();
