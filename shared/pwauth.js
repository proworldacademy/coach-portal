/* PROWORLD — one sign-in for the whole site (shared/pwauth.js)
   Everyone signs in with their own Google account. Who may open what is the staff list in the database
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
    ".pwa-bg{position:fixed;inset:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;z-index:2000;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));font-family:'Aeonik Pro','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow:auto}",
    ".pwa{width:100%;max-width:440px;background:#0e0e0e;border:1px solid #272727;border-top:4px solid #E2FE78;border-radius:8px;padding:30px}",
    ".pwa .brand{font-family:'Review Condensed','Barlow Condensed','Arial Narrow',Impact,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:22px;letter-spacing:.5px;color:#E2FE78;margin-bottom:18px}",
    ".pwa h1{font-family:'Review Condensed','Barlow Condensed','Arial Narrow',Impact,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:36px;line-height:.95;margin:0 0 10px}",
    ".pwa h1 em{font-style:inherit;color:#E2FE78}",
    ".pwa p{color:#a3a69c;font-size:13.5px;margin:0 0 14px;line-height:1.55}",
    ".pwa p b{color:#fff}",
    ".pwa .go{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;background:#fff;color:#000;border:0;border-radius:6px;padding:13px 16px;font:700 15px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;cursor:pointer}",
    ".pwa .go:hover{background:#E2FE78}.pwa .go:disabled{opacity:.6;cursor:default}",
    ".pwa .alt{display:inline-block;margin-top:14px;background:none;border:1px solid #333;color:#c9cbc2;border-radius:6px;padding:9px 14px;font:600 12.5px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;cursor:pointer;text-decoration:none}",
    ".pwa .alt:hover{border-color:#E2FE78;color:#E2FE78}",
    ".pwa .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}",
    ".pwa .err{color:#E286E4;font-size:12.5px;margin-top:12px;min-height:16px;line-height:1.45}",
    ".pwa .fine{color:#5b5d56;font-size:11px;margin-top:18px;letter-spacing:.3px}",
    ".pwa a{color:#E2FE78}",
    ".pwa .spin{width:18px;height:18px;border:2px solid #333;border-top-color:#E2FE78;border-radius:50%;animation:pwaspin .8s linear infinite;display:inline-block;vertical-align:middle}",
    "@keyframes pwaspin{to{transform:rotate(360deg)}}",
    "@media(prefers-reduced-motion:reduce){.pwa .spin{animation:none}}"
  ].join("");
  function ensureCss() { if (document.getElementById("pwa-css")) return; const s = document.createElement("style"); s.id = "pwa-css"; s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }
  const G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
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
    else if (stage === "out") inner = '<h1>Sign <em>in</em></h1><p>For the PROWORLD team. Sign in with your Google account — your ProWorld email, or the Google email you were added with. No new password.</p><button class="go" data-a="google"' + (busy ? " disabled" : "") + ">" + G + (busy ? " Opening Google…" : " Sign in with Google") + '</button><div class="err">' + esc(note) + "</div>";
    else if (stage === "pending") inner = '<h1>Almost <em>there</em></h1><p>You\'re signed in as <b>' + esc(who) + '</b>, but this email isn\'t on the PROWORLD team list yet. We\'ve let the administrators know — once you\'re added, this page opens by itself.</p><div class="row"><button class="alt" data-a="out">Use another account</button></div>';
    else if (stage === "noaccess") inner = '<h1>Not <em>yours</em> yet</h1><p>You\'re signed in as <b>' + esc(who) + '</b>. Your access doesn\'t include <b>' + esc(pageName(need)) + '</b>. An administrator can tick it for you on the Dashboard.</p><div class="row"><a class="alt" href="/">Go to the Dashboard</a><button class="alt" data-a="out">Use another account</button></div>';
    else if (stage === "unverified") inner = '<h1>Use <em>Google</em></h1><p>This page only accepts a confirmed Google sign-in. Sign out and use “Sign in with Google”.</p><button class="alt" data-a="out">Sign out</button>';
    el.innerHTML = '<div class="pwa"><div class="brand">PROWORLD</div>' + inner + '<div class="fine">Individually built. Fully connected.</div></div>';
    el.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => act(b.getAttribute("data-a"))));
  }
  const touch = () => (window.matchMedia && matchMedia("(pointer:coarse)").matches) || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  async function act(a) {
    if (a === "reload") { location.reload(); return; }
    if (a === "out") { await signOut(); return; }
    if (a === "google") {
      if (!init()) return; note = ""; busy = true; paint();
      const prov = new firebase.auth.GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" });
      try { if (touch()) { await auth.signInWithRedirect(prov); return; } await auth.signInWithPopup(prov); }
      catch (e) {
        const c = e && e.code;
        if (c === "auth/popup-blocked" || c === "auth/operation-not-supported-in-this-environment") { try { await auth.signInWithRedirect(prov); return; } catch (e2) { note = explain(e2); } }
        else if (c !== "auth/popup-closed-by-user" && c !== "auth/cancelled-popup-request") note = explain(e);
      }
      busy = false; paint();
    }
  }
  function explain(e) {
    const c = e && e.code;
    if (c === "auth/unauthorized-domain") return "This web address isn't on the project's list of authorized sign-in domains yet.";
    if (c === "auth/network-request-failed") return "No connection to Google. Check the internet and try again.";
    if (c === "auth/account-exists-with-different-credential") return "That email already signs in another way. Ask an administrator.";
    return "Sign-in didn't finish (" + (c || (e && e.message) || "unknown") + "). Try again.";
  }

  // ── who are you, and what may you open ──
  function onUser(u) {
    if (unsubStaff) { unsubStaff(); unsubStaff = null; }
    if (!u) { const was = stage; ctx = null; stage = "out"; busy = false; paint(); if (was === "in") location.reload(); return; }
    const email = String(u.email || "").trim().toLowerCase();
    const prov = (u.providerData || []).map((p) => p.providerId);
    if (!email || !u.emailVerified || !prov.includes("google.com")) { stage = "unverified"; ctx = { email }; paint(); return; }
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
      const pages = owner ? P.ALL.slice() : active ? (Array.isArray(rec.pages) ? rec.pages.slice() : P.LEGACY.slice()) : [];
      const was = stage;
      const withOf = (id) => { const pg = (P.PAGES || []).find((x) => x.id === id); return pg && pg.with ? pg.with : null; };   // a page that comes with another one
      ctx = { user: u, email, name: (rec && rec.name) || u.displayName || email, rec: rec || null, owner, admin, active: active || owner, pages, has: (id) => owner || (withOf(id) ? pages.includes(withOf(id)) : pages.includes(id)) };
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
      auth.getRedirectResult().catch((e) => { note = explain(e); if (stage === "out") paint(); });
      auth.onAuthStateChanged(onUser);
    });
  }
  window.PWAuth = { start, signOut, fs: () => (init() ? fs : null), auth: () => (init() ? auth : null), get ctx() { return ctx; }, paintUser, CFG };
})();
