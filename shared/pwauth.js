/* PROWORLD — one sign-in for the whole site (shared/pwauth.js)
   Everyone signs in with their e-mail and a password (Antonio, Nov 4, 2026: not everyone has Google). An owner sets the
   account up from the Dashboard (People & access); "Forgot your password?" sends the reset e-mail. Who may open what is the staff list in the database
   (staff/<email>: name, active, role, pages[]) and the database rules enforce it — this page only shows the
   right screen. Owners are named in the rules, not here: an owner is recognised by asking the database a
   question only an owner or administrator may ask.
   Needs, loaded before it: the Firebase compat SDK (app, auth, firestore) and shared/pages.js.
   Use:  PWAuth.start({ need: "mkt" }).then((ctx) => …)   ctx = { email, name, owner, admin, pages, has(id) } */
(function () {
  "use strict";
  // Public identifiers of the PROWORLD Firebase project (the same project as the Coach Portal) — not secrets.
  const CFG = {
    apiKey: "AIzaSyBauu-JZZKCzex-PpTjBpD4QuTSWIkVEs4",
    authDomain: "proworld-coach-portal.web.app",
    projectId: "proworld-coach-portal",
    appId: "1:999676464496:web:fa726be60d8da0112393b5"
  };
  const P = window.PW_PAGES || { ALL: [], LEGACY: [], PAGES: [] };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let auth = null, fs = null, need = null, ctx = null, stage = "boot", note = "", busy = false, unsubStaff = null, seq = 0, asked = false;
  const waiters = [];

  function init() {
    if (fs) return true;
    if (typeof firebase === "undefined") { stage = "nosdk"; paint(); return false; }
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(CFG);
    auth = firebase.auth(); fs = firebase.firestore();
    return !!app;
  }
  const pageName = (id) => { const p = (P.PAGES || []).find((x) => x.id === id); return p ? (p.short || p.name) : id; };

  // ── the sign-in screen (one overlay, several states) ──
  const CSS = [
    // the gate in the redesign: light, the brand gradient feeling, one glass card — self-contained (no design.css needed)
    ".pwa-bg{position:fixed;inset:0;background:#ECEEEB;background-image:radial-gradient(62% 52% at 16% 0%,rgba(226,254,120,.9),rgba(226,254,120,0) 62%),radial-gradient(52% 46% at 86% 8%,rgba(148,252,177,.85),rgba(148,252,177,0) 60%),radial-gradient(46% 42% at 62% 96%,rgba(169,243,247,.8),rgba(169,243,247,0) 60%),radial-gradient(34% 34% at 6% 86%,rgba(226,134,228,.4),rgba(226,134,228,0) 60%),radial-gradient(30% 30% at 92% 70%,rgba(248,169,92,.35),rgba(248,169,92,0) 60%);color:#0A0A0A;display:flex;align-items:center;justify-content:center;z-index:2000;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));font-family:'Aeonik Pro','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow:auto}",
    ".pwa{width:100%;max-width:460px;background:rgba(255,255,255,.78);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(0,0,0,.08);border-radius:22px;padding:28px 28px 24px;box-shadow:0 30px 70px -40px rgba(0,0,0,.45)}",
    ".pwa .brand{font-family:'Review Condensed','Barlow Condensed','Arial Narrow',Impact,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:20px;letter-spacing:.5px;color:#0A0A0A;margin-bottom:22px}",
    ".pwa h1{font-family:'Review Condensed','Barlow Condensed','Arial Narrow',Impact,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:54px;line-height:.9;letter-spacing:-.005em;margin:0 0 12px;color:#0A0A0A}",
    ".pwa h1 em{font-style:inherit;color:#fff;-webkit-text-stroke:2px #0A0A0A;paint-order:stroke fill}",
    ".pwa p{color:#3b3d38;font-size:14px;margin:0 0 14px;line-height:1.55}",
    ".pwa p b{color:#0A0A0A}",
    ".pwa .go{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;background:#0A0A0A;color:#E2FE78;border:1px solid #0A0A0A;border-radius:999px;padding:13px 18px;font:italic 800 17px/1 'Review Condensed','Barlow Condensed','Arial Narrow',Impact,sans-serif;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;box-shadow:0 16px 40px -18px rgba(0,0,0,.45);transition:transform .25s cubic-bezier(.2,.8,.2,1)}",
    ".pwa .go svg{background:#fff;border-radius:50%;padding:3px;box-sizing:content-box}",
    ".pwa .go:hover{transform:translateY(-2px)}.pwa .go:disabled{opacity:.6;cursor:default;transform:none}",
    ".pwa .alt{display:inline-block;margin-top:14px;background:rgba(255,255,255,.7);border:1px solid rgba(0,0,0,.14);color:#3b3d38;border-radius:999px;padding:9px 14px;font:700 12.5px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;cursor:pointer;text-decoration:none;transition:.2s}",
    ".pwa .alt:hover{border-color:#0A0A0A;color:#0A0A0A}",
    ".pwa .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}",
    ".pwa form{display:grid;gap:10px;margin-top:6px}",
    ".pwa label{display:block;font:700 11px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#3b3d38;margin-bottom:5px}",
    ".pwa input{width:100%;box-sizing:border-box;height:46px;border:1px solid rgba(0,0,0,.18);border-radius:12px;background:#fff;padding:0 14px;font:400 15px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;color:#0A0A0A}",
    ".pwa input:focus{outline:2px solid #0A0A0A;outline-offset:1px}",
    ".pwa .forgot{background:none;border:0;padding:0;font:inherit;font-size:13px;color:#0A0A0A;text-decoration:underline;text-decoration-color:#E2FE78;text-decoration-thickness:2px;text-underline-offset:3px;cursor:pointer;justify-self:start}",
    ".pwa .small{font-size:12.5px;color:#6b6e66;margin-top:12px}.pwa a.go{text-decoration:none;box-sizing:border-box;margin-bottom:10px}",
    ".pwa .err{color:#9a2f8f;font-size:12.5px;margin-top:12px;min-height:16px;line-height:1.45}",
    ".pwa .fine{color:#656860;font-size:11px;margin-top:18px;letter-spacing:.3px}",
    ".pwa a{color:#0A0A0A;text-decoration:underline;text-decoration-color:#E2FE78;text-decoration-thickness:2px;text-underline-offset:3px}",
    ".pwa .spin{width:18px;height:18px;border:2px solid rgba(0,0,0,.15);border-top-color:#0A0A0A;border-radius:50%;animation:pwaspin .8s linear infinite;display:inline-block;vertical-align:middle}",
    "@keyframes pwaspin{to{transform:rotate(360deg)}}",
    "@media(prefers-reduced-motion:reduce){.pwa .spin{animation:none}.pwa .go,.pwa .alt{transition:none}}"
  ].join("");
  function ensureCss() { if (document.getElementById("pwa-css")) return; const s = document.createElement("style"); s.id = "pwa-css"; s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }
  function overlay() {
    let el = document.getElementById("pwa-gate");
    if (!el) { ensureCss(); el = document.createElement("div"); el.className = "pwa-bg"; el.id = "pwa-gate"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); (document.body || document.documentElement).appendChild(el); }
    return el;
  }
  function hideGate() { const el = document.getElementById("pwa-gate"); if (el) el.remove(); }
  function paint() {
    if (stage === "in") { hideGate(); return; }
    if (!document.body) { document.addEventListener("DOMContentLoaded", paint, { once: true }); return; }
    const el = overlay(); const who = ctx && ctx.email ? ctx.email : (auth && auth.currentUser ? auth.currentUser.email : "");
    let inner = "";
    if (stage === "boot" || stage === "checking") inner = '<h1>One <em>moment</em></h1><p><span class="spin"></span>&nbsp; Checking your access…</p>';
    else if (stage === "nosdk") inner = '<h1>Can\'t <em>connect</em></h1><p>The sign-in service didn\'t load. Check the internet connection and reload the page.</p><button class="alt" data-a="reload">Reload</button>';
    else if (stage === "out") inner = '<h1>Sign <em>in</em></h1><p>For the PROWORLD team: your e-mail and your password.</p><form data-f="signin"><div><label for="pwa-email">E-mail</label><input id="pwa-email" name="email" type="email" autocomplete="username" required value="' + esc(lastEmail()) + '"></div><div><label for="pwa-pass">Password</label><input id="pwa-pass" name="password" type="password" autocomplete="current-password" required></div><button class="go" type="submit"' + (busy ? " disabled" : "") + '>' + (busy ? "Signing in…" : "Sign in") + '</button><button class="forgot" type="button" data-a="forgot">Forgot your password? Send me a reset e-mail</button></form><div class="err">' + esc(note) + '</div><p class="small">No sign-in yet? An owner sets it up from the Dashboard and sends you the link that sets your password.</p>';
    else if (stage === "reset") inner = '<h1>Check your <em>e-mail</em></h1><p>A link to set a new password is on its way to <b>' + esc(who || lastEmail()) + '</b>. It can take a minute; look in spam if it does not show. Open it, choose a password, then sign in here.</p><div class="row"><button class="alt" data-a="back">Back to sign-in</button></div>';
    else if (stage === "pending") inner = '<h1>Almost <em>there</em></h1><p>You\'re signed in as <b>' + esc(who) + '</b>, but this email isn\'t on the PROWORLD team list yet. We\'ve let the administrators know — once you\'re added, this page opens by itself.</p><div class="row"><button class="alt" data-a="out">Use another account</button></div>';
    else if (stage === "noaccess") inner = '<h1>Not <em>yours</em> yet</h1><p>You\'re signed in as <b>' + esc(who) + '</b>. Your access doesn\'t include <b>' + esc(pageName(need)) + '</b>. An administrator can tick it for you on the Dashboard.</p><div class="row"><a class="alt" href="/">Go to the Dashboard</a><button class="alt" data-a="out">Use another account</button></div>';
    else if (stage === "unverified") inner = '<h1>Not <em>set up</em> yet</h1><p>This sign-in was not set up by the academy (<b>' + esc(who) + '</b>). Ask an owner to set it up from the Dashboard, People &amp; access, then sign in again.</p><button class="alt" data-a="out">Sign out</button>';
    el.innerHTML = '<div class="pwa"><div class="brand">PROWORLD</div>' + inner + '<div class="fine">Individually built. Fully connected.</div></div>';
    el.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => act(b.getAttribute("data-a"))));
    const f = el.querySelector('form[data-f="signin"]'); if (f) f.addEventListener("submit", (ev) => { ev.preventDefault(); signIn(f.email.value, f.password.value); });
  }
  const lastEmail = () => { try { return localStorage.getItem("pw_signin_email") || ""; } catch (e) { return ""; } };
  const remember = (email) => { try { localStorage.setItem("pw_signin_email", email); } catch (e) { /* no storage */ } };
  async function signIn(email, password) {
    if (!init()) return; email = String(email || "").trim().toLowerCase(); note = "";
    if (!email || !password) { note = "Your e-mail and your password, please."; paint(); return; }
    remember(email); busy = true; paint();   // remembered before the try, so a repaint after a wrong password keeps the address
    try { await auth.signInWithEmailAndPassword(email, password); }
    catch (e) { note = explain(e); }
    busy = false; if (stage === "out") paint();
  }
  async function forgot() {
    if (!init()) return; const el = document.getElementById("pwa-email"); const email = String((el && el.value) || lastEmail() || "").trim().toLowerCase();
    if (!email) { note = "Type your e-mail first, then tap Forgot."; paint(); return; }
    busy = true; paint();
    try { await auth.sendPasswordResetEmail(email, { url: location.origin + "/" }); remember(email); ctx = { email }; stage = "reset"; note = ""; }
    catch (e) { note = e && e.code === "auth/user-not-found" ? "No sign-in for that address yet. Ask an owner to set it up from the Dashboard." : explain(e); }
    busy = false; paint();
  }
  async function act(a) {
    if (a === "reload") { location.reload(); return; }
    if (a === "out") { await signOut(); return; }
    if (a === "copy") { try { await navigator.clipboard.writeText(location.href); note = "Link copied."; } catch (e) { note = location.href; } paint(); return; }
    if (a === "forgot") { await forgot(); return; }
    if (a === "back") { stage = "out"; note = ""; paint(); return; }
  }
  function explain(e) {
    const c = e && e.code;
    if (c === "auth/wrong-password" || c === "auth/invalid-credential" || c === "auth/invalid-login-credentials" || c === "auth/user-not-found" || c === "auth/invalid-email") return "That e-mail and password do not match. Check both, or use “Forgot your password?”.";
    if (c === "auth/too-many-requests") return "Too many tries for now. Wait a few minutes, or use “Forgot your password?”.";
    if (c === "auth/user-disabled") return "This sign-in is switched off. Ask an owner.";
    if (c === "auth/operation-not-allowed") return "E-mail sign-in is not switched on for this site yet (Firebase → Authentication → Sign-in method).";
    if (c === "auth/unauthorized-domain") return "This web address isn't on the project's list of authorized sign-in domains yet.";
    if (c === "auth/network-request-failed") return "No connection. Check the internet and try again.";
    return "Sign-in didn't finish (" + (c || (e && e.message) || "unknown") + "). Try again.";
  }

  // ── who are you, and what may you open ──
  function onUser(u) {
    if (unsubStaff) { unsubStaff(); unsubStaff = null; }
    if (!u) { const was = stage; ctx = null; stage = "out"; busy = false; paint(); if (was === "in") location.reload(); return; }
    const email = String(u.email || "").trim().toLowerCase();
    const prov = (u.providerData || []).map((p) => p.providerId);
    if (!email || !u.emailVerified || !(prov.includes("password") || prov.includes("google.com"))) { stage = "unverified"; ctx = { email }; paint(); return; }   // an account an owner set up is verified; one somebody made alone is not
    stage = "checking"; ctx = { email }; paint();
    const decide = async (rec) => {
      const my = ++seq;
      const active = !!(rec && rec.active === true);
      let owner = !!(active && rec.owner === true);
      if (!active) {
        // No staff record, or access switched off. Only an owner gets past this question without an active record,
        // because the rules let only owners and administrators list the requests — and administrators need an active record.
        try { await fs.collection("requests").limit(1).get({ source: "server" }); owner = true; } catch (e) { owner = false; }
        if (my !== seq) return;
        if (owner && !rec) fs.doc("staff/" + email).set({ email, name: String(u.displayName || ""), role: "admin", active: true, owner: true, addedAt: Date.now() }, { merge: true }).catch(() => {});
      }
      const admin = owner || (active && rec.role === "admin");
      const director = admin || (active && rec.role === "director");   // a tennis director (Oct 24): everything inside Coaches
      const pages = owner ? P.ALL.slice() : active ? (Array.isArray(rec.pages) ? rec.pages.slice() : P.LEGACY.slice()) : [];
      const was = stage;
      const withOf = (id) => { const pg = (P.PAGES || []).find((x) => x.id === id); return pg && pg.with ? pg.with : null; };   // a page that comes with another one
      const aliased = (id) => Object.keys(P.ALIAS || {}).some((old) => P.ALIAS[old] === id && pages.includes(old));   // an old id for the same page
      const deskSide = admin || (active && String(rec.role || "").toLowerCase() === "desk") || pages.includes("billing");   // the clients' side (who enrolled, what families asked, their accounts): never a coach, even one who holds Admin (Nov 13)
      const deskOnly = (id) => { const pg = (P.PAGES || []).find((x) => x.id === id); return !!(pg && pg.desk); };
      ctx = { user: u, email, name: (rec && rec.name) || u.displayName || email, rec: rec || null, owner, admin, director, desk: deskSide, active: active || owner, pages, has: (id) => owner || ((!deskOnly(id) || deskSide) && ((withOf(id) ? pages.includes(withOf(id)) : pages.includes(id)) || aliased(id))) };
      if (!ctx.active) { stage = "pending"; fileRequest(u, email); paint(); if (was === "in") location.reload(); return; }
      if (need && !ctx.has(need)) { stage = "noaccess"; paint(); if (was === "in") location.reload(); return; }
      stage = "in"; paint(); paintUser();
      if (was !== "in") { waiters.splice(0).forEach((w) => w(ctx)); try { window.dispatchEvent(new CustomEvent("pw:auth", { detail: ctx })); } catch (e) { /* old browser */ } }
      else { try { window.dispatchEvent(new CustomEvent("pw:auth-change", { detail: ctx })); } catch (e) { /* noop */ } }
    };
    // my own staff record, live: being added opens the page at once, and being removed closes it just as fast
    unsubStaff = fs.doc("staff/" + email).onSnapshot((d) => decide(d.exists ? d.data() : null), () => decide(null));
  }
  function fileRequest(u, email) {
    if (asked) return; asked = true;
    fs.doc("requests/" + u.uid).set({ email, name: String(u.displayName || "").slice(0, 100), at: Date.now() }).catch(() => {});
  }
  // the signed-in person, wherever a page leaves a spot for it: <span id="pw-user"></span>
  function paintUser() {
    const el = document.getElementById("pw-user"); if (!el || !ctx) return;
    el.innerHTML = '<span class="pw-user-name">' + esc(ctx.name || ctx.email) + (ctx.owner ? " · Owner" : ctx.admin ? " · Admin" : "") + '</span> <button type="button" class="pw-user-out">Sign out</button>';
    const b = el.querySelector(".pw-user-out"); if (b) b.onclick = () => signOut();
  }
  async function signOut() { try { if (auth) await auth.signOut(); } catch (e) { /* noop */ } location.reload(); }

  function start(opts) {
    need = (opts && opts.need) || null;
    return new Promise((resolve) => {
      if (ctx && stage === "in") { if (!need || ctx.has(need)) { resolve(ctx); return; } stage = "noaccess"; paint(); return; }
      waiters.push(resolve);
      if (stage !== "boot") return;
      if (!init()) return;
      paint();
      auth.onAuthStateChanged(onUser);
    });
  }
  window.PWAuth = { start, signOut, fs: () => (init() ? fs : null), auth: () => (init() ? auth : null), get ctx() { return ctx; }, paintUser, CFG };
})();
