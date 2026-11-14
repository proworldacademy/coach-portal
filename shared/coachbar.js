/* The coaches' bottom bar outside the Coach Portal (Nov 14, 2026): on a phone, a coach or a director who opens Privates or Attendance in Admin
   keeps the same four — Reminders · Players · Contact · Privates — so there is always a way back. Called by the page once it knows who is in:
   PWCoachBar(ctx, "privates"). Owners, the front desk and anyone without the Coach Portal get nothing. */
(function () {
  const I = {
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 21l2.2-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
  };
  const CSS = '@media(max-width:640px){.pw-coachbar{display:flex;position:fixed;left:14px;right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));height:66px;background:rgba(10,10,10,.92);border:1px solid rgba(255,255,255,.08);border-radius:999px;align-items:center;justify-content:space-around;padding:0 8px;z-index:60;box-shadow:0 10px 30px rgba(0,0,0,.25)}' +
    '.pw-coachbar a{color:#8E8E8A;font:700 11px "Aeonik Pro",system-ui,sans-serif;display:grid;place-items:center;gap:3px;text-decoration:none}.pw-coachbar i{width:38px;height:38px;border-radius:50%;display:grid;place-items:center}.pw-coachbar svg{width:19px;height:19px}' +
    '.pw-coachbar a.on{color:#fff}.pw-coachbar a.on i{background:#E2FE78;color:#0A0A0A}body.has-coachbar{padding-bottom:calc(104px + env(safe-area-inset-bottom,0px))!important}}@media(min-width:641px){.pw-coachbar{display:none}}';
  window.PWCoachBar = function (ctx, active) {
    try {
      const role = String((ctx && ctx.rec && ctx.rec.role) || '').toLowerCase();
      const old = document.querySelector('.pw-coachbar'); if (old) old.remove(); document.body.classList.remove('has-coachbar');
      if (!ctx || ctx.owner || !ctx.has || !ctx.has('coach-portal') || !(role === 'coach' || role === 'director')) return;
      if (!document.getElementById('pw-coachbar-css')) { const st = document.createElement('style'); st.id = 'pw-coachbar-css'; st.textContent = CSS; document.head.appendChild(st); }
      const items = [['Reminders', '/portal/#/', I.bell, 'home'], ['Players', '/portal/#/players', I.people, 'players'], ['Contact', '/portal/#/messages', I.chat, 'contact'], ['Privates', '/backend#privates', I.cal, 'privates']];
      const nav = document.createElement('nav'); nav.className = 'pw-coachbar'; nav.setAttribute('aria-label', 'Coach Portal');
      nav.innerHTML = items.map((x) => '<a href="' + x[1] + '"' + (x[3] === active ? ' class="on" aria-current="page"' : '') + '><i>' + x[2] + '</i>' + x[0] + '</a>').join('');
      document.body.appendChild(nav); document.body.classList.add('has-coachbar');
    } catch (e) { /* the page works without the bar */ }
  };
})();
