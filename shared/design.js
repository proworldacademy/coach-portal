/* PROWORLD HQ — the page chrome of the redesign (shared/design.js), used with shared/design.css.
   Draws what every redesigned page shares: the six brand lights under the page, the gradient sky at the top (the page's
   skin), the top bar (wordmark · the five doors — Dashboard · Admin · Coaches · Clients · Marketing — and the Library, each
   door with a menu of the views inside it, from shared/pages.js DOORS · a visible "Jump to…" field · the person), the compact bar that
   slides in once the greeting has scrolled away, the ⌘K jump palette, the ticker of today's signals, and the small motions
   (tiles tilt toward the cursor with a soft flashlight, a lime ripple on press, the sky's bright spot drifting toward the
   cursor, sections rising into place, numbers counting up). Everything respects prefers-reduced-motion.
   Include after shared/pages.js and shared/pwauth.js:  <script src="/shared/design.js"></script>
   Use:  PWDesign.mount({ skin: "home"|"coach"|"desk"|"studio"|"family", active: "<page id>" | "/", strip: true, jump: true, title: "" });
         PWDesign.active("tryouts") re-marks the strip when a page changes view;  PWDesign.signals([{ cls: "ok"|"due"|"new"|"info", html, href }]);
         PWDesign.palette([{ name, kind, href }]);  PWDesign.countUp(root);  PWDesign.toast(msg, err);  PWDesign.esc(s);  PWDesign.greet(name)
         A public page (no sign-in) mounts with { strip: false, jump: false }: the wordmark alone, no palette.                            */
(function () {
  // The app (Antonio, Nov 3, 2026): every page is installable — "Add to Home Screen" gives a PROWORLD icon, a full-screen window
  // and the bottom bar; the manifest, the icons and the service worker live in /app and /sw.js. The stores come later on the same code.
  try {
    const H = document.head, add = (tag, attrs) => { const el = document.createElement(tag); Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k])); H.appendChild(el); };
    if (!document.querySelector('link[rel="manifest"]')) add("link", { rel: "manifest", href: "/app/manifest.webmanifest" });
    if (!document.querySelector('meta[name="theme-color"]')) add("meta", { name: "theme-color", content: "#0A0A0A" });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" }); add("meta", { name: "mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" }); add("meta", { name: "apple-mobile-web-app-title", content: "PROWORLD" });
    add("link", { rel: "apple-touch-icon", href: "/app/apple-touch-icon.png" });
    /* The page fits the phone, every phone (Nov 19, 2026 — management's screenshots: the page wider than the screen, the chat header under
       the clock). The cause: an iPhone zooms in when a box with small text is tapped, and inside the app that zoom never goes back, so
       every page after it is cut off on the right. Three guards, on every page: (1) the page may not be scaled past 1, (2) on a touch
       screen every box you type in is 16px, the size at which the phone does not zoom, (3) nothing may push the page sideways. If a
       zoom still sticks (an older phone), it is snapped back when the keyboard closes. */
    try {
      const vp = document.querySelector('meta[name="viewport"]');
      const fit = () => { if (!vp) return; let c = vp.getAttribute("content") || ""; c = c.replace(/,?\s*maximum-scale=[^,]*/g, "").replace(/,?\s*user-scalable=[^,]*/g, ""); vp.setAttribute("content", c + ",maximum-scale=1"); };
      fit();
      const st = document.createElement("style"); st.setAttribute("data-fit", "1");
      st.textContent = "html{-webkit-text-size-adjust:100%;text-size-adjust:100%;max-width:100%;overflow-x:hidden;overflow-x:clip}body{max-width:100%;overflow-x:clip}@media(pointer:coarse){input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea{font-size:16px!important}}img,video{max-width:100%}";
      document.head.appendChild(st);
      const vv = window.visualViewport;
      const snap = () => { if (vv && vv.scale > 1.01 && vp) { const c = vp.getAttribute("content"); vp.setAttribute("content", "width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,viewport-fit=cover"); setTimeout(() => { vp.setAttribute("content", c); }, 60); } if (window.scrollX) window.scrollTo(0, window.scrollY); };
      document.addEventListener("focusout", () => setTimeout(snap, 120), true);
      window.addEventListener("pageshow", () => setTimeout(snap, 50)); window.addEventListener("orientationchange", () => setTimeout(snap, 300));
    } catch (e) { /* the page still shows */ }
    // the App look on every page (Nov 13): one layer, loaded last so it sits on top of each page's own styles
    /* Light and dark (Nov 14, 2026 — Antonio: "dark and light depending on the time of the day, like everything else"): Auto follows the phone or
       computer (which switches at sunset when set to Automatic); the person can pin Light or Dark from their account menu. html.dark carries it,
       shared/dark.css paints it. */
    const DARK_OFF = true;   // Nov 19, 2026 — Antonio: "remove dark mode for now, across everything". Light only until this is flipped back; the dark sheet is not loaded and the picker is not drawn.
    const TKEY = "pw-theme"; const tmq = !DARK_OFF && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const tGet = () => { try { const v = localStorage.getItem(TKEY); return v === "light" || v === "dark" ? v : "auto"; } catch (e) { return "auto"; } };
    const tApply = () => { const m = tGet(); const dark = !DARK_OFF && (m === "dark" || (m === "auto" && !!(tmq && tmq.matches))); document.documentElement.classList.toggle("dark", dark); let meta = document.querySelector('meta[name="theme-color"]'); if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); } meta.content = dark ? "#050505" : "#F1F1ED"; document.querySelectorAll("[data-theme-btn]").forEach((b) => { b.textContent = "Appearance: " + (m === "auto" ? "Auto" : m === "dark" ? "Dark" : "Light"); }); document.querySelectorAll("[data-theme]").forEach((b) => { b.setAttribute("aria-pressed", b.getAttribute("data-theme") === m ? "true" : "false"); }); };
    window.PWTheme = { apply: tApply, get: tGet, set: (m) => { try { if (m === "auto") localStorage.removeItem(TKEY); else localStorage.setItem(TKEY, m); } catch (e) { /* no storage */ } tApply(); }, next: () => { const m = tGet(); window.PWTheme.set(m === "auto" ? "light" : m === "light" ? "dark" : "auto"); } };
    tApply(); if (tmq) { if (tmq.addEventListener) tmq.addEventListener("change", tApply); else if (tmq.addListener) tmq.addListener(tApply); }
    /* The dark guard (Nov 16, 2026). The dark sheet (shared/dark.css) names what it knows. This catches what it does not: in dark, any
       words that end up light on a light fill (a brand colour, a pastel chip, a white box somebody hard-coded) are set black, and any words
       left black on a black surface are set light. It measures the way the dark scan did: the word's colour against the nearest fill behind
       it. It runs when the page settles and again, quietly, when the page changes. In light it does nothing and undoes what it set. */
    (function () {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1; let g2 = null; const memo = {};
      const rgb = (c) => { if (!c) return null; if (memo[c]) return memo[c]; const m = /^rgba?\(([^)]+)\)$/.exec(c); if (m) { const a = m[1].split(/[, /]+/).map(Number); return (memo[c] = [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]); } try { g2 = g2 || cv.getContext("2d", { willReadFrequently: true }); g2.clearRect(0, 0, 1, 1); g2.fillStyle = "#000"; g2.fillStyle = c; g2.fillRect(0, 0, 1, 1); const d = g2.getImageData(0, 0, 1, 1).data; return (memo[c] = [d[0], d[1], d[2], d[3] / 255]); } catch (e) { return null; } };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const over = (t, u) => [t[0] * t[3] + u[0] * (1 - t[3]), t[1] * t[3] + u[1] * (1 - t[3]), t[2] * t[3] + u[2] * (1 - t[3]), 1];
      let timer = 0, running = false, quietUntil = 0, token = 0;
      /* It works in short slices while the page is idle (a few milliseconds at a time), so it never holds up a tap or a scroll. */
      function run() {
        timer = 0; const my = ++token; running = true;
        const done = () => { if (my === token) { running = false; quietUntil = Date.now() + 150; } };
        try {
          document.querySelectorAll("[data-pw-ink]").forEach((el) => { el.style.removeProperty("color"); el.removeAttribute("data-pw-ink"); });
          if (!document.documentElement.classList.contains("dark") || !document.body) { done(); return; }
          const bgs = new Map();
          const bgOf = (el) => { const chain = []; let out = null; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { if (bgs.has(n)) { out = bgs.get(n); break; } chain.push(n); } if (!out) out = [5, 5, 5, 1];
            for (let i = chain.length - 1; i >= 0; i--) { const cs = getComputedStyle(chain[i]); let c = rgb(cs.backgroundColor); const img = cs.backgroundImage; if (img && img !== "none") { if (/url\(/.test(img)) out = null; else if (!(c && c[3] > 0.9)) { const gm = /(rgba?|color)\([^)]+\)/.exec(img); const gc = gm ? rgb(gm[0]) : null; if (gc && gc[3] > 0.05 && out) out = over(gc, out); } } if (c && c[3] > 0.02 && out) out = over(c, out); else if (c && c[3] > 0.9) out = [c[0], c[1], c[2], 1]; bgs.set(chain[i], out); }
            return out; };
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const seen = new Set(); let n = 0; const fix = [];
          const slice = (deadline) => {
            if (my !== token) return; const until = Date.now() + (deadline && deadline.timeRemaining ? Math.max(4, Math.min(12, deadline.timeRemaining())) : 8); let t;
            try {
              while (n < 3000 && (t = w.nextNode())) { if (t.nodeValue.trim().length < 1) continue; const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el); const tag = el.tagName; if (tag === "SCRIPT" || tag === "STYLE" || tag === "OPTION" || el.closest("svg,.pc-wrap,#pw-ring")) continue; n++;
                const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue; const fg = rgb(cs.color); if (!fg || fg[3] < 0.3) continue; const bg = bgOf(el); if (!bg) continue;
                const lf = lum(over(fg, bg)), lb = lum(bg); const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
                if (ratio < 2.6) { if (lb > 0.4) fix.push([el, "#0A0A0A"]); else if (lb < 0.08 && lf < 0.08) fix.push([el, "#F4F4F0"]); }
                if (Date.now() >= until) { if (window.requestIdleCallback) window.requestIdleCallback(slice, { timeout: 400 }); else setTimeout(slice, 30); return; } }
              quietUntil = Date.now() + 150; fix.forEach((x) => { if (x[0].isConnected) { x[0].style.setProperty("color", x[1], "important"); x[0].setAttribute("data-pw-ink", "1"); } });
            } catch (e) { /* the pages read as the sheet left them */ }
            done();
          };
          slice(null);
        } catch (e) { done(); }
      }
      const soon = (ms) => { if (timer) return; timer = setTimeout(() => { if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 800 }); else run(); }, ms); };
      window.PWInkGuard = { run, soon };
      const start = () => { soon(350); setTimeout(() => soon(10), 1800); try { new MutationObserver((ms) => { if (Date.now() < quietUntil) return; for (const m of ms) { if (m.type === "attributes" && m.attributeName === "style" && m.target.hasAttribute && m.target.hasAttribute("data-pw-ink")) continue; if (m.type === "attributes" && m.attributeName === "data-pw-ink") continue; soon(900); return; } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] }); new MutationObserver(() => soon(60)).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); } catch (e) { /* no observer */ } };
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    })();
    /* Appearance (Nov 16, 2026): three buttons side by side, Auto · Light · Dark, in the account corner and at the foot of the phone menu,
       in place of one button that changed each time it was pressed. Auto follows the phone or the computer; the choice is kept on this device. */
    document.addEventListener("click", (e) => { const t = e.target && e.target.closest ? e.target.closest(".pwd-theme button[data-theme]") : null; if (t) {   /* only the picker's own buttons (Nov 17): Admin's page carries data-theme on a wrapper, so every tap there matched and its links did nothing */ e.preventDefault(); e.stopPropagation(); window.PWTheme.set(t.getAttribute("data-theme")); return; } const b = e.target && e.target.closest ? e.target.closest("[data-theme-btn]") : null; if (b) { e.preventDefault(); e.stopPropagation(); window.PWTheme.next(); } });
    window.PWTheme.picker = (cls) => { if (DARK_OFF) return ""; const m = tGet(); return '<span class="pwd-theme' + (cls ? " " + cls : "") + '" role="group" aria-label="Appearance">' + [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map((x) => '<button type="button" data-theme="' + x[0] + '" aria-pressed="' + (m === x[0] ? "true" : "false") + '">' + x[1] + "</button>").join("") + "</span>"; };
    if (!document.querySelector('script[data-bars]')) { const sc = document.createElement('script'); sc.src = '/shared/coachbar.js'; sc.async = true; sc.setAttribute('data-bars', '1'); document.head.appendChild(sc); }   // the phone's bottom bars (shared/coachbar.js)
    /* The fresh look's moving parts (Nov 14, 2026; styles in shared/fresh.css): the page rises in once (body.fx-in for the first moments), whole
       numbers on tiles count up once, and on a phone a page's explanation is two lines until tapped. All of it stands still for people who
       ask their device for less motion. */
    const fxReduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const fxCount = () => { if (fxReduce) return; document.querySelectorAll(".tile .big, .stat b, #needN").forEach((el) => { if (el.dataset.fx || el.children.length) return; const t = el.textContent.trim(); if (!/^\d{1,4}$/.test(t)) return; el.dataset.fx = "1"; const to = Number(t); if (to < 2) return; const t0 = performance.now(); let last = "0"; el.textContent = last;
      const step = (now) => { if (el.textContent !== last) return;   /* the page wrote a newer number: leave it */ const k = Math.min(1, (now - t0) / 700); last = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); el.textContent = last; if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }); };
    const fxClamp = () => { if (!(window.matchMedia && window.matchMedia("(max-width: 640px)").matches)) return; document.querySelectorAll(".hero > p, .hero .sum, p.sum, p.lead").forEach((p) => { if (p.dataset.fxc || p.closest(".gate") || p.textContent.trim().length < 150) return; p.dataset.fxc = "1"; p.classList.add("fx-clamp"); p.addEventListener("click", () => p.classList.toggle("open")); }); };
    const fxStart = () => { if (!document.body) return; document.body.classList.add("fx-in"); setTimeout(() => document.body.classList.remove("fx-in"), 1700); [300, 900, 2000, 3500].forEach((ms) => setTimeout(() => { fxCount(); fxClamp(); }, ms)); window.addEventListener("hashchange", () => setTimeout(fxClamp, 200)); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fxStart); else fxStart();
    const look = () => { if (!document.querySelector('link[data-look]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/shared/app-look.css"; l.setAttribute("data-look", "1"); document.head.appendChild(l); } if (!document.querySelector('link[data-fresh]')) { const fr = document.createElement("link"); fr.rel = "stylesheet"; fr.href = "/shared/fresh.css"; fr.setAttribute("data-fresh", "1"); document.head.appendChild(fr); } if (!DARK_OFF && !document.querySelector('link[data-dark]')) { const d = document.createElement("link"); d.rel = "stylesheet"; d.href = "/shared/dark.css"; d.setAttribute("data-dark", "1"); document.head.appendChild(d); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", look); else look();
    if ("serviceWorker" in navigator && location.protocol === "https:") window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  } catch (e) { /* the page works without the app bits */ }
  "use strict";
  const P = window.PW_PAGES || { PAGES: [], SECTIONS: [] };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const reduce = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const fine = () => !!(window.matchMedia && matchMedia("(pointer:fine)").matches) && !reduce();
  const here = location.pathname.replace(/index\.html$/, "").replace(/\/$/, "") || "/";
  const SEARCH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || "") || /Mac OS/.test(navigator.userAgent || "");
  const KBD = mac ? "⌘K" : "Ctrl K";
  let opts = { skin: "home", active: here, strip: true, jump: true }, ctx = null, mounted = false, extra = [], sigs = [];

  // ── the pages this person may open (for the strip and the palette) ──
  const pageHref = (p) => p.url || "/";
  const external = (p) => p.opens && p.opens !== "site";
  function mine() { return ctx && ctx.has ? P.PAGES.filter((p) => ctx.has(p.id)) : []; }
  function isHere(p) { if (!p.url || external(p)) return false; const path = p.url.split("#")[0].replace(/\/$/, "") || "/"; return !p.url.includes("#") && path === here; }

  // ── the doors (PROWORLD HQ): the top bar shows Dashboard · Admin · Coaches · Marketing, and for the owners Books and the Library (Nov 17: the clean menu). A door opens its
  //    page; its menu (shown under it on desktop — phones use the Jump palette) lists the views inside it the person may open. ──
  const DOORS = P.DOORS || [];
  const hasAny = (pages) => !pages || !pages.length || !!(ctx && ctx.has && pages.some((id) => ctx.has(id)));
  const PATH_DOOR = { "/backend": "admin", "/portal": "coaches", "/clients": "admin", "/family": "admin", "/enroll": "admin", "/marketing": "marketing", "/p": "library" };
  function doorNow() {
    const id = opts.active && opts.active !== "/" ? opts.active : null;
    const pg = id ? P.PAGES.find((p) => p.id === id) : null;
    if (pg) return pg.door || (pg.section !== "tools" ? "library" : null);
    if (id && DOORS.some((d) => d.id === id)) return id;
    return PATH_DOOR[here] || null;
  }
  // Coaches and tennis directors live in the Coaches door only (Antonio, Oct 24): no Dashboard, no Admin, no Clients, no Library.
  // They hold the backend page only for what Coaches links to (attendance, messages, courts, privates). Start here is their guide.
  function coachSide() {
    if (!ctx || ctx.owner || ctx.admin) return false;
    const role = String((ctx.rec && ctx.rec.role) || "").toLowerCase();
    return (role === "coach" || role === "director" || role === "") && !ctx.has("billing") && !ctx.has("mkt") && ctx.has("coach-portal");
  }
  // Marketing-only people (Manu, Oct 28) live in the Marketing door the same way: no Dashboard, the logo goes to /marketing.
  function mktSide() {
    if (!ctx || ctx.owner || ctx.admin) return false;
    return ctx.has("mkt") && !ctx.has("coach-portal") && !ctx.has("backend") && !ctx.has("billing") && !ctx.has("tryouts");
  }
  // one-door people: the only door they hold is their whole site
  const oneDoor = () => coachSide() ? "/portal" : mktSide() ? "/marketing" : "";
  function doors() {
    if (!ctx) return [];
    const now = doorNow();
    if (mktSide()) return DOORS.filter((d) => d.id === "marketing").map((d) => ({ id: d.id, name: d.name, href: d.href, on: true, items: (d.items || []).filter((it) => hasAny(it.page ? [it.page] : d.page)) }));
    const role = String((ctx.rec && ctx.rec.role) || "").toLowerCase();
    const cs = coachSide();
    const director = !!(ctx.owner || ctx.admin || ctx.director || role === "director");
    const directorOnly = (it) => it.href === "/backend#messages" || it.href === "/backend#courts";
    // a coach's menu is the portal's own four (Nov 13): Reminders, Players, Contact, Privates. The Board, Try-outs, Attendance and Courts are for directors and owners.
    const coachItem = (it) => ["/portal", "/portal#/players", "/portal#/messages", "/backend#privates", "/portal#/calendar"].includes(it.href);   // Nov 19: Calendar is every coach's, as on the strip
    if (cs) return DOORS.filter((d) => d.id === "coaches").map((d) => ({ id: d.id, name: d.name, href: d.href, on: now === d.id || now === null, items: (d.items || []).filter((it) => hasAny(it.page ? [it.page] : d.page)).filter((it) => director || coachItem(it)).concat(director ? [{ name: "Staff & access", href: "/portal#/staff" }] : []) }));
    return DOORS.filter((d) => !d.owners || ctx.owner).filter((d) => d.id === "library" ? mine().some((p) => p.section !== "tools" || p.door === "library") : hasAny(d.page))   // owners: true = a door for the two owners (Books, the Library)
      .map((d) => ({ id: d.id, name: d.name, href: d.href, on: now === d.id, items: (d.items || []).filter((it) => hasAny(it.page ? [it.page] : d.page)).filter((it) => !(d.id === "coaches" && !director && (directorOnly(it) || !coachItem(it)))) }));
  }
  let ddEl = null, ddT = null;
  function ddHide() { if (ddEl) ddEl.classList.remove("on"); }
  function ddShow(el, d) {
    if (!d.items.length) { ddHide(); return; }
    if (!ddEl) {
      ddEl = document.createElement("div"); ddEl.className = "pwd-dd"; ddEl.id = "pwd-dd"; ddEl.setAttribute("role", "menu"); document.body.appendChild(ddEl);
      ddEl.addEventListener("mouseenter", () => clearTimeout(ddT)); ddEl.addEventListener("mouseleave", () => { ddT = setTimeout(ddHide, 180); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") ddHide(); });
      addEventListener("scroll", ddHide, { passive: true }); addEventListener("resize", ddHide, { passive: true });
      document.addEventListener("click", (e) => { if (!e.target.closest("#pwd-dd, .pwd-strip .door")) ddHide(); });
    }
    ddEl.innerHTML = "<b>" + esc(d.name) + "</b>" + d.items.map((it) => '<a role="menuitem" href="' + esc(it.href) + '">' + esc(it.name) + "</a>").join("");
    const r = el.getBoundingClientRect(); ddEl.style.left = Math.max(8, Math.min(r.left, innerWidth - 232)) + "px"; ddEl.style.top = (r.bottom + 6) + "px";
    ddEl.classList.add("on");
  }

  // ── the top bar ──
  let stripResize = false;
  function stripFit() { const st = $("#pwd-top .pwd-strip"); if (st) st.classList.toggle("fade", st.scrollLeft + st.clientWidth < st.scrollWidth - 2); }
  function drawTop() {
    const top = $("#pwd-top"); if (!top) return;
    const home = opts.active ? opts.active === "/" : here === "/";
    const ds = doors();
    const door = (d) => '<span class="door' + (d.on ? " on" : "") + '" data-door="' + esc(d.id) + '"><a class="' + (d.on ? "on" : "") + '" href="' + esc(d.href) + '"' + (d.on ? ' aria-current="page"' : "") + (d.items.length ? ' aria-haspopup="menu"' : "") + ">" + esc(d.name) + "</a></span>";
    const strip = opts.strip === false ? '<span class="pwd-sp"></span>' : '<nav class="pwd-strip" aria-label="PROWORLD HQ">' + (ctx ? (oneDoor() ? "" : '<a class="' + (home ? "on" : "") + '" href="/"' + (home ? ' aria-current="page"' : "") + '>Dashboard</a>') + ds.map(door).join("") + ((ctx.rec || ctx.owner) && ctx.active !== false ? '<a class="' + (/^\/team(\/|$)/.test(location.pathname) ? "on" : "") + '" href="/team" data-team-dot' + (window.PWTeamUnread ? ' data-has="1"' : "") + ">Locker Room</a>" : "") : "") + "</nav>";   // Team (Nov 15, 2026): the team's own messaging
    const initials = (n) => (String(n || "").trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
    const who = ctx ? '<div class="pwd-me"><button type="button" class="pwd-av" data-me aria-label="Your account">' + esc(initials(ctx.name || ctx.email)) + '</button><span class="who"><b>' + esc(ctx.name || ctx.email) + '</b><span class="role">' + (ctx.owner ? " · Owner" : ctx.admin ? " · Admin" : "") + '</span>' + window.PWTheme.picker() + (ctx.owner || ctx.real ? '<button class="out" type="button" data-view-as>View as</button>' : "") + '<button class="out" type="button" data-out>Sign out</button></span></div>' : "";
    const jump = opts.jump === false ? "" : '<button class="pwd-jump" type="button" data-pal aria-label="Jump to a page">' + SEARCH + "<span>Jump to a page, a report, a plan…</span><kbd>" + KBD + "</kbd></button>";
    // on a phone the strip is hidden; a menu button opens the same doors and their views as a sheet (Lorenzo, Oct 24)
    const burger = ctx && opts.strip !== false ? '<button class="pwd-burger" type="button" data-burger aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>' : "";
    top.innerHTML = '<a class="pwd-mark" href="' + (oneDoor() || "/") + '" aria-label="PROWORLD"></a>' + strip + jump + burger + who;
    const bb = top.querySelector("[data-burger]");
    if (bb) {
      let sheet = $("#pwd-menu");
      if (!sheet) { sheet = document.createElement("div"); sheet.className = "pwd-menu"; sheet.id = "pwd-menu"; sheet.setAttribute("role", "menu"); document.body.appendChild(sheet); }
      // the phone menu (Nov 15, 2026: "the menu is very big"): Dashboard and Team first, then one row per door. A door's views stay folded
      // until its arrow is tapped; the door you are in opens by itself. Solid, and it ends above the bottom bar.
      const staff = (ctx.rec || ctx.owner) && ctx.active !== false; const inTeam = /^\/team(\/|$)/.test(location.pathname);
      sheet.innerHTML = (oneDoor() ? "" : '<a class="d' + (home ? " on" : "") + '" href="/">Dashboard</a>') + (staff ? '<a class="d' + (inTeam ? " on" : "") + '" href="/team" data-team-dot' + (window.PWTeamUnread ? ' data-has="1"' : "") + ">Locker Room</a>" : "") +
        ds.map((d, i) => { const open = d.on && d.items.length; return '<div class="dr"><a class="d' + (d.on && !inTeam ? " on" : "") + '" href="' + esc(d.href) + '">' + esc(d.name) + "</a>" + (d.items.length ? '<button type="button" class="tg" data-tg="' + i + '" aria-expanded="' + (open ? "true" : "false") + '" aria-label="Show the pages of ' + esc(d.name) + '"><span>' + d.items.length + '</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' : "") + "</div>" + (d.items.length ? '<div class="sub" data-sub="' + i + '"' + (open ? "" : " hidden") + ">" + d.items.map((it) => '<a href="' + esc(it.href) + '">' + esc(it.name) + "</a>").join("") + "</div>" : ""); }).join("") + '<div class="apr"><span>Appearance</span>' + window.PWTheme.picker() + "</div>" + (ctx.owner || ctx.real ? '<div class="apr"><span>View as</span><button type="button" class="vas" data-view-as>Choose a person</button></div>' : "");
      /* Nov 17: the sheet outlives every redraw of the top bar (the Coach Portal redraws it often), so its listeners are attached once.
         A second set made each arrow open and shut in the same tap: "sometimes I click and it does not click". */
      const wired = sheet.dataset.wired === "1"; sheet.dataset.wired = "1";
      if (!wired) sheet.addEventListener("click", (e) => { const t = e.target.closest("[data-tg]"); if (!t) return; e.stopPropagation(); const sub = sheet.querySelector('[data-sub="' + t.dataset.tg + '"]'); if (!sub) return; const show = sub.hidden; sub.hidden = !show; t.setAttribute("aria-expanded", show ? "true" : "false"); });
      const setOpen = (on) => { const cur = document.querySelector("#pwd-top .pwd-burger"); sheet.classList.toggle("on", on); if (cur) { cur.classList.toggle("on", on); cur.setAttribute("aria-expanded", on ? "true" : "false"); } document.documentElement.classList.toggle("pwd-menu-open", on); };
      if (sheet.classList.contains("on")) setOpen(true);   // a redraw while the menu is open keeps the new button in step
      bb.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!sheet.classList.contains("on")); });
      if (!wired) {
        sheet.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
        document.addEventListener("click", (e) => { const cur = document.querySelector("#pwd-top .pwd-burger"); if (sheet.classList.contains("on") && !sheet.contains(e.target) && !(cur && cur.contains(e.target))) setOpen(false); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
      }
    }
    if (window.PWTheme) window.PWTheme.apply();
    const out = top.querySelector("[data-out]"); if (out) out.addEventListener("click", () => window.PWAuth && window.PWAuth.signOut());
    const me = top.querySelector("[data-me]"); if (me) me.addEventListener("click", (e) => { e.stopPropagation(); me.parentNode.classList.toggle("open"); });
    // the strip fades on the right only while more pages hide there, and the page you are on is always in view
    const st = top.querySelector(".pwd-strip");
    if (st) {
      st.querySelectorAll(".door").forEach((el) => {
        const d = ds.find((x) => x.id === el.getAttribute("data-door")); if (!d) return;
        el.addEventListener("mouseenter", () => { clearTimeout(ddT); ddShow(el, d); });
        el.addEventListener("mouseleave", () => { ddT = setTimeout(ddHide, 180); });
        el.querySelector("a").addEventListener("focus", () => ddShow(el, d));
      });
      // when the pages don't fit, the Jump field shrinks to its icon first
      top.classList.toggle("tight", st.scrollWidth > st.clientWidth + 2);
      const on = st.querySelector("a.on"); if (on) { const end = on.offsetLeft + on.offsetWidth; if (end > st.clientWidth) st.scrollLeft = end - st.clientWidth + 28; }
      stripFit(); st.addEventListener("scroll", stripFit, { passive: true });
      if (!stripResize) { stripResize = true; addEventListener("resize", stripFit, { passive: true }); }
    }
    document.addEventListener("click", (e) => { const o = top.querySelector(".pwd-me.open"); if (o && !o.contains(e.target)) o.classList.remove("open"); });
  }

  // ── the compact bar ──
  let barT = null, li = 0, barScroll = false;
  function drawBar() {
    let bar = $("#pwd-bar");
    if (!bar) { bar = document.createElement("div"); bar.className = "pwd-bar"; bar.id = "pwd-bar"; bar.setAttribute("aria-hidden", "true"); bar.innerHTML = '<div class="in"><a class="pwd-mark" href="/" aria-label="PROWORLD Dashboard"></a><span class="now" id="pwd-now"></span>' + (opts.jump === false ? "" : '<button class="pwd-jump" type="button" data-pal aria-label="Jump to a page">' + SEARCH + "<kbd>" + KBD + "</kbd></button>") + "</div>"; document.body.appendChild(bar); }
    const now = $("#pwd-now"); const lines = sigs.map((s) => s.html).filter(Boolean);
    now.innerHTML = lines[0] || (opts.title ? esc(opts.title) : "");
    clearInterval(barT);
    if (lines.length > 1) barT = setInterval(() => { if (!bar.classList.contains("on") || document.hidden) return; now.classList.add("swap"); setTimeout(() => { li = (li + 1) % lines.length; now.innerHTML = lines[li]; now.classList.remove("swap"); }, 350); }, 3200);
    const hero = $(".hero");
    const onScroll = () => { const past = hero ? hero.getBoundingClientRect().bottom < 60 : (window.scrollY || 0) > 140; bar.classList.toggle("on", past); bar.setAttribute("aria-hidden", past ? "false" : "true"); };
    if (!barScroll) { barScroll = true; addEventListener("scroll", () => { const h = $(".hero"); const past = h ? h.getBoundingClientRect().bottom < 60 : (window.scrollY || 0) > 140; bar.classList.toggle("on", past); bar.setAttribute("aria-hidden", past ? "false" : "true"); }, { passive: true }); }
    onScroll();
  }

  // ── the ticker ──
  function signals(list) {
    sigs = (list || []).filter((s) => s && s.html);
    const tick = $("#pwd-tick"); if (tick) {
      const one = sigs.map((s) => '<a class="sig" href="' + esc(s.href || "#") + '"' + (s.ext ? ' target="_blank" rel="noopener"' : "") + '><i class="' + esc(s.cls || "ok") + '"></i>' + s.html + "</a>").join("");
      tick.innerHTML = '<div class="run">' + one + one + "</div>"; tick.hidden = !sigs.length;
    }
    if (mounted) drawBar();
  }

  // ── the palette ──
  let pal = null, pq = null, prs = null, psel = 0, pshown = [];
  function items() {
    const kind = (p) => (p.section === "tools" ? "tool" : ({ plan: "plan", report: "report", page: "page", archive: "archive", proto: "prototype" }[p.status] || p.section || ""));
    const base = mine().map((p) => ({ name: p.name, kind: kind(p), href: pageHref(p), ext: external(p) }));
    const views = []; doors().forEach((d) => d.items.forEach((it) => views.push({ name: d.name + " › " + it.name, kind: "view", href: it.href })));
    const all = (oneDoor() ? [] : [{ name: "Dashboard", kind: "home", href: "/" }]).concat(extra, oneDoor() ? [] : base, views);
    const seen = new Set(); return all.filter((x) => x.href && !seen.has(x.href) && seen.add(x.href));
  }
  const hl = (name, q) => { const i = name.toLowerCase().indexOf(q); return i < 0 ? esc(name) : esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.length)) + "</mark>" + esc(name.slice(i + q.length)); };
  function pdraw() {
    const q = pq.value.trim().toLowerCase(); const all = items();
    pshown = q ? all.filter((p) => (p.name + " " + p.kind).toLowerCase().includes(q)) : all;
    psel = Math.min(psel, Math.max(0, pshown.length - 1));
    prs.innerHTML = pshown.length ? pshown.map((p, i) => '<a class="r' + (i === psel ? " on" : "") + '" href="' + esc(p.href) + '"' + (p.ext ? ' target="_blank" rel="noopener"' : "") + ' data-i="' + i + '"><span>' + hl(p.name, q) + "</span><small>" + esc(p.kind) + "</small></a>").join("") : '<div class="none">Nothing called “' + esc(pq.value) + '”.</div>';
    const on = prs.querySelector(".r.on"); if (on) on.scrollIntoView({ block: "nearest" });
  }
  function popen() { if (!pal) return; pal.classList.add("on"); pq.value = ""; psel = 0; pdraw(); setTimeout(() => pq.focus(), 60); }
  function pclose() { if (!pal) return; pal.classList.remove("on"); pq.blur(); }
  function go(p) { if (!p) return; if (p.ext) window.open(p.href, "_blank", "noopener"); else { if (window.PWAlive) window.PWAlive.going(); location.href = p.href; } pclose(); }
  function drawPal() {
    if (pal || opts.jump === false) return;
    pal = document.createElement("div"); pal.className = "pwd-pal"; pal.id = "pwd-pal"; pal.setAttribute("role", "dialog"); pal.setAttribute("aria-modal", "true"); pal.setAttribute("aria-label", "Jump to a page");
    pal.innerHTML = '<div class="p"><div class="q">' + SEARCH.replace('width="15" height="15"', 'width="18" height="18"') + '<input id="pwd-pq" type="search" autocomplete="off" placeholder="Jump to a page, a report, a plan…" aria-label="Jump to"></div><div class="rs" id="pwd-prs"></div><div class="ft"><span><b>↑ ↓</b> move</span><span><b>Enter</b> open</span><span><b>Esc</b> close</span></div></div>';
    document.body.appendChild(pal); pq = $("#pwd-pq"); prs = $("#pwd-prs");
    pq.addEventListener("input", () => { psel = 0; pdraw(); });
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-pal]")) { e.preventDefault(); popen(); return; }
      if (e.target === pal) { pclose(); return; }
      const r = e.target.closest("#pwd-prs .r"); if (r) { e.preventDefault(); go(pshown[+r.getAttribute("data-i")]); }
    });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") { e.preventDefault(); pal.classList.contains("on") ? pclose() : popen(); return; }
      const typing = /input|textarea|select/i.test((document.activeElement || {}).tagName || "") || (document.activeElement && document.activeElement.isContentEditable);
      if (e.key === "/" && !pal.classList.contains("on") && !typing) { e.preventDefault(); popen(); return; }
      if (!pal.classList.contains("on")) return;
      if (e.key === "Escape") pclose();
      else if (e.key === "ArrowDown") { e.preventDefault(); psel = Math.min(pshown.length - 1, psel + 1); pdraw(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); psel = Math.max(0, psel - 1); pdraw(); }
      else if (e.key === "Enter") { e.preventDefault(); go(pshown[psel]); }
    });
  }

  // ── the small motions ──
  function motions() {
    if (fine()) {
      document.addEventListener("pointermove", (e) => {
        const el = e.target.closest && e.target.closest(".g"); if (!el) return;
        const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--ry", ((x - .5) * 9).toFixed(2) + "deg"); el.style.setProperty("--rx", ((.5 - y) * 9).toFixed(2) + "deg");
        el.style.setProperty("--sx", (x * 100).toFixed(1) + "%"); el.style.setProperty("--sy", (y * 100).toFixed(1) + "%");
      }, { passive: true });
      document.addEventListener("pointerout", (e) => { const el = e.target.closest && e.target.closest(".g"); if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); } }, { passive: true });
      const sky = $(".pwd-sky");
      if (sky) { let tx = 78, ty = 18, cx = 78, cy = 18, on = true; document.addEventListener("pointermove", (e) => { tx = e.clientX / innerWidth * 100; ty = e.clientY / innerHeight * 100; }, { passive: true }); const drift = () => { if (!document.hidden) { cx += (tx - cx) * .035; cy += (ty - cy) * .035; sky.style.setProperty("--hx", cx.toFixed(2) + "%"); sky.style.setProperty("--hy", cy.toFixed(2) + "%"); } if (on) requestAnimationFrame(drift); }; drift(); }
    }
    document.addEventListener("pointerdown", (e) => { const g = e.target.closest && e.target.closest(".g"); if (!g || reduce()) return; const r = g.getBoundingClientRect(); const s = document.createElement("span"); s.className = "rip"; s.style.setProperty("--px", (e.clientX - r.left) + "px"); s.style.setProperty("--py", (e.clientY - r.top) + "px"); g.appendChild(s); setTimeout(() => s.remove(), 700); });
    if (!reduce() && "IntersectionObserver" in window) { const secs = Array.from(document.querySelectorAll(".sec")).slice(1); secs.forEach((s) => s.classList.add("pre")); const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.remove("pre"); io.unobserve(x.target); } }), { rootMargin: "0px 0px -8% 0px" }); secs.forEach((s) => io.observe(s)); }
  }
  // numbers count up once: <b data-n="1203">0</b>
  const counted = new WeakSet();
  function countUp(root) {
    (root || document).querySelectorAll("[data-n]").forEach((el, i) => {
      if (counted.has(el)) return; counted.add(el);
      const end = +el.getAttribute("data-n") || 0; const fmt = (v) => v.toLocaleString("en-US");
      if (reduce() || end < 2) { el.textContent = fmt(end); return; }
      const t0 = performance.now() + 150 + i * 60;
      const step = (t) => { const p = Math.min(1, Math.max(0, (t - t0) / 900)); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(Math.round(end * e)); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  // the greeting and the date line
  function greet(name) {
    const h = new Date().getHours(); const word = h < 5 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    const first = String(name || "").trim().split(/\s+/)[0] || "";
    return { word, first, date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) };
  }
  let tt = null;
  function toast(m, err) { let t = $("#pwd-toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.id = "pwd-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); } t.textContent = m; t.className = "toast show" + (err ? " err" : ""); clearTimeout(tt); tt = setTimeout(() => (t.className = "toast"), 2800); }

  function mount(o) {
    opts = Object.assign(opts, o || {});
    const run = () => {
      if (mounted) return; mounted = true;
      document.body.classList.add("pwd", "skin-" + (opts.skin || "home"));
      if (!$(".pwd-lights")) { const f = document.createElement("div"); f.className = "pwd-lights"; f.setAttribute("aria-hidden", "true"); f.innerHTML = '<i class="k1"></i><i class="k2"></i><i class="k3"></i><i class="k4"></i><i class="k5"></i><i class="k6"></i>'; document.body.insertBefore(f, document.body.firstChild); }
      if (!$(".pwd-sky")) { const s = document.createElement("div"); s.className = "pwd-sky"; s.setAttribute("aria-hidden", "true"); document.body.insertBefore(s, $(".pwd-lights").nextSibling); }
      ctx = window.PWAuth && window.PWAuth.ctx && window.PWAuth.ctx.has ? window.PWAuth.ctx : ctx;
      drawTop(); drawPal(); drawBar(); motions(); countUp(document);
    };
    if (document.body) run(); else document.addEventListener("DOMContentLoaded", run, { once: true });
  }
  // a coach or director who lands on the Dashboard goes to the Coaches door: that is their whole site
  function landing() { const d = oneDoor(); if (d && (here === "/" || here === "") && !location.hash) location.replace(d); }
  window.addEventListener("pw:auth", (e) => { ctx = e.detail; landing(); if (mounted) drawTop(); });
  window.addEventListener("pw:auth-change", (e) => { ctx = e.detail; if (mounted) drawTop(); });
  // a page with several views (the Coach Portal's assessments / try-outs / board) re-marks the strip as the view changes
  function active(id) { opts.active = id; if (mounted) drawTop(); }
  window.PWDesign = { mount, active, signals, palette: (list) => { extra = Array.isArray(list) ? list : []; }, countUp, greet, toast, esc, get ctx() { return ctx; } };
})();

/* ── View as (Nov 16, 2026 — Antonio: "something for only me and Lorenzo, where we would see it as that person: as marketing, as a
   coach, as a client"). An owner picks one person on the team, or one client; every page then draws what that person gets
   (shared/pwauth.js and the Coach Portal read the same choice, the client account asks the engine for that family). It changes the
   screen, never the database: the owner stays the one signed in. The choice is kept on this device for four hours (pw-view-as) and a
   pill at the foot of every page says whose view it is, with the way back. The button is drawn for owners only. */
(function () {
  "use strict";
  const KEY = "pw-view-as", HOURS = 4;
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const get = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (!v || !v.kind || !(v.until > Date.now())) { if (v) localStorage.removeItem(KEY); return null; } return v; } catch (e) { return null; } };
  const set = (v) => { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, v, { until: Date.now() + HOURS * 3600000 }))); localStorage.setItem("pw-side", "team"); } catch (e) { /* no storage */ } location.href = v.kind === "client" ? "/family" : "/"; };
  const clear = (stay) => { try { localStorage.removeItem(KEY); localStorage.setItem("pw-side", "team"); } catch (e) { /* no storage */ } if (!stay) location.href = "/"; };
  const fold = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const CSS = "#pw-viewing{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2100;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);background:#0A0A0A;color:#fff;border:1px solid #E2FE78;border-radius:999px;padding:6px 6px 6px 14px;font:500 13px/1.2 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;box-shadow:0 14px 40px -14px rgba(0,0,0,.6)}" +
    "@media(max-width:860px){#pw-viewing{left:14px;transform:none;max-width:calc(100vw - 96px);bottom:calc(100px + env(safe-area-inset-bottom,0px))}#pw-viewing .t small{display:none}}" +
    "#pw-viewing .t{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#pw-viewing .t b{color:#E2FE78;font-weight:700}#pw-viewing .t small{color:#B5B5B0;font-size:12px}" +
    "#pw-viewing button{flex:none;border:0;border-radius:999px;background:#E2FE78;color:#0A0A0A;font:700 12.5px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;padding:8px 13px;cursor:pointer;white-space:nowrap}#pw-viewing button.q{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.3)}" +
    "#pw-view{position:fixed;inset:0;z-index:2200;background:rgba(10,10,10,.45);display:flex;align-items:center;justify-content:center;padding:16px}" +
    "#pw-view .sh{width:100%;max-width:440px;max-height:min(640px,calc(100vh - 32px));max-height:min(640px,calc(100dvh - 32px));display:flex;flex-direction:column;background:#fff;color:#0A0A0A;border-radius:22px;overflow:hidden;font-family:'Aeonik Pro','Helvetica Neue',Arial,sans-serif;box-shadow:0 30px 80px -30px rgba(0,0,0,.6)}" +
    "#pw-view .hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 6px}#pw-view h2{margin:0;font:italic 800 30px/1 'Review Condensed','Barlow Condensed','Arial Narrow',Impact,sans-serif;text-transform:uppercase;color:#0A0A0A}" +
    "#pw-view .x{border:1px solid rgba(0,0,0,.15);background:none;color:#0A0A0A;border-radius:999px;width:34px;height:34px;font-size:18px;line-height:1;cursor:pointer}" +
    "#pw-view p.s{margin:0;padding:0 20px 10px;font-size:13px;line-height:1.45;color:#5b5e57}#pw-view .bd{overflow:auto;-webkit-overflow-scrolling:touch;padding:0 12px 14px}" +
    "#pw-view h3{margin:14px 8px 4px;font:700 11px/1 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#6b6e66}" +
    "#pw-view .r{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;border:0;background:none;color:#0A0A0A;font:500 15px/1.25 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;padding:11px 10px;border-radius:12px;cursor:pointer;min-height:44px}#pw-view .r:hover,#pw-view .r:focus-visible{background:#F1F3EE;outline:none}" +
    "#pw-view .r small{color:#6b6e66;font-size:12.5px;flex:none}#pw-view .r.on{background:#E2FE78}#pw-view .r.on small{color:#0A0A0A}#pw-view .r.me{font-weight:700}" +
    "#pw-view input{width:calc(100% - 16px);margin:4px 8px 4px;box-sizing:border-box;height:44px;border:1px solid rgba(0,0,0,.18);border-radius:12px;background:#fff;color:#0A0A0A;padding:0 14px;font:400 16px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif}#pw-view .n{margin:6px 10px;font-size:13px;color:#6b6e66}" +
    "html.dark #pw-view .sh{background:#161616;color:#F3F3EF}html.dark #pw-view h2,html.dark #pw-view .r,html.dark #pw-view .x{color:#F3F3EF}html.dark #pw-view .x{border-color:rgba(255,255,255,.2)}html.dark #pw-view p.s,html.dark #pw-view h3,html.dark #pw-view .r small,html.dark #pw-view .n{color:#B5B5B0}html.dark #pw-view .r:hover,html.dark #pw-view .r:focus-visible{background:#242424}html.dark #pw-view .r.on{background:#E2FE78;color:#0A0A0A}html.dark #pw-view .r.on small{color:#0A0A0A}html.dark #pw-view input{background:#0F0F0F;color:#F3F3EF;border-color:rgba(255,255,255,.2)}" +
    "#pw-view .sds{display:flex;gap:8px;padding:2px 8px 0}#pw-view .sd{flex:1;border:1px solid rgba(0,0,0,.18);background:none;color:#0A0A0A;border-radius:999px;font:700 14px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;min-height:44px;cursor:pointer}#pw-view .sd:hover{border-color:#0A0A0A}#pw-view .sd.on{background:#0A0A0A;color:#E2FE78;border-color:#0A0A0A}#pw-view .r.hl{background:#F1F3EE}html.dark #pw-view .sd{color:#F3F3EF;border-color:rgba(255,255,255,.25)}html.dark #pw-view .sd.on{background:#E2FE78;color:#0A0A0A}html.dark #pw-view .r.hl{background:#242424}" +
    ".pwd-menu .vas{border:1px solid rgba(0,0,0,.2);background:none;color:inherit;border-radius:999px;font:700 13px 'Aeonik Pro','Helvetica Neue',Arial,sans-serif;padding:9px 16px;min-height:38px;cursor:pointer}html.dark .pwd-menu .vas{border-color:rgba(255,255,255,.25)}";
  const css = () => { if (document.getElementById("pw-view-css")) return; const st = document.createElement("style"); st.id = "pw-view-css"; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); };
  const db = () => { try { const a = window.PWAuth && window.PWAuth.fs && window.PWAuth.fs(); if (a) return a; if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) return firebase.firestore(); } catch (e) { /* none */ } return null; };

  function pill() {
    const v = get(); let el = document.getElementById("pw-viewing");
    if (!v) { if (el) el.remove(); return; }
    if (!document.body) { document.addEventListener("DOMContentLoaded", pill, { once: true }); return; }
    // a client's view is the client account and the public pages; anywhere else the choice would show nothing of theirs
    if (v.kind === "client" && !/^\/(family|enroll)(\/|$)/.test(location.pathname)) { location.replace("/family"); return; }
    css();
    if (!el) { el = document.createElement("div"); el.id = "pw-viewing"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.innerHTML = '<span class="t">Viewing as <b>' + esc(v.name || v.email || "a client") + "</b>" + (v.label ? " <small>· " + esc(v.label) + "</small>" : "") + (v.kind === "client" ? " <small>· what you do here is real</small>" : "") + '</span><button type="button" class="q" data-view-as>Change</button><button type="button" data-view-back>Back to me</button>';
  }

  const labelOf = (r) => { const role = String(r.role || "").toLowerCase(); const pages = Array.isArray(r.pages) ? r.pages : ["coach-portal", "tryouts"];
    if (role === "admin") return ["admin", "Administrator"]; if (role === "director") return ["director", "Director"]; if (role === "desk") return ["desk", "Front desk"];
    if (pages.includes("mkt") && !pages.includes("coach-portal")) return ["mkt", "Marketing"]; if (pages.includes("coach-portal")) return ["coach", "Coach"]; return ["other", "Team"]; };
  const GROUPS = [["mkt", "Marketing"], ["coach", "Coaches"], ["director", "Directors"], ["desk", "Front desk"], ["admin", "Administrators"], ["other", "Others on the team"]];
  let players = null;

  async function open() {
    const fs = db(); if (!fs) return; css();
    const old = document.getElementById("pw-view"); if (old) old.remove();
    const cur = get(); const box = document.createElement("div"); box.id = "pw-view"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "View as");
    box.innerHTML = '<div class="sh"><div class="hd"><h2>View as</h2><button type="button" class="x" data-x aria-label="Close">×</button></div><p class="s">See the site the way one person sees it. Only the owners have this. You stay signed in as yourself.</p><div class="bd"><p class="n">Loading the team…</p></div></div>';
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener("click", (e) => {
      if (e.target === box || e.target.closest("[data-x]")) { close(); return; }
      const r = e.target.closest("[data-pick]"); if (!r) return;
      if (r.dataset.pick === "me") { clear(); return; }
      if (r.dataset.pick === "role") set({ kind: "role", role: r.dataset.role, name: r.dataset.name, label: "the whole side" });
      if (r.dataset.pick === "coaches") { const h = box.querySelector("[data-coaches]"); if (h) { h.scrollIntoView({ behavior: "smooth", block: "start" }); box.querySelectorAll("[data-g=coach]").forEach((x) => x.classList.add("hl")); } return; }
      if (r.dataset.pick === "staff") set({ kind: "staff", email: r.dataset.email, name: r.dataset.name, label: r.dataset.label });
      if (r.dataset.pick === "client") set({ kind: "client", pid: r.dataset.pid, name: r.dataset.name, label: "Client" });
    });
    document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc1); } });
    let staff = [];
    try { staff = (await fs.collection("staff").get()).docs.map((d) => Object.assign({ id: d.id }, d.data() || {})); }
    catch (e) { const bd0 = box.querySelector(".bd"); if (bd0) bd0.innerHTML = '<p class="n">The team list did not load. This is for the owners only.</p>'; return; }
    const list = staff.filter((r) => r.active === true && r.owner !== true).map((r) => { const l = labelOf(r); return { email: r.id, name: r.name || r.id, g: l[0], label: l[1] }; }).sort((a, b) => a.name.localeCompare(b.name));
    const row = (p) => '<button type="button" data-g="' + p.g + '" class="r' + (cur && cur.kind === "staff" && cur.email === p.email ? " on" : "") + '" data-pick="staff" data-email="' + esc(p.email) + '" data-name="' + esc(p.name) + '" data-label="' + esc(p.label) + '"><span>' + esc(p.name) + "</span><small>" + esc(p.label) + "</small></button>";
    const bd = box.querySelector(".bd"); if (!bd) return;
    const VR = (window.PW_PAGES || {}).VIEW_ROLES || {}; const side = (k, name) => VR[k] ? '<button type="button" class="sd' + (cur && cur.kind === "role" && cur.role === k ? " on" : "") + '" data-pick="role" data-role="' + k + '" data-name="' + esc(name) + '">' + esc(name) + "</button>" : "";
    bd.innerHTML = (cur ? '<button type="button" class="r me" data-pick="me"><span>Back to my own view</span><small>Owner</small></button>' : "") +
      '<h3>A whole side</h3><div class="sds">' + side("admin", "Admin") + '<button type="button" class="sd" data-pick="coaches">Coaches</button>' + side("marketing", "Marketing") + '</div><p class="n">Admin and Marketing open as that side sees them. Coaches asks which coach, because each coach has their own players. Books and the Library are yours only, so there is nothing to compare.</p>' +
      '<h3>A client</h3><input type="search" data-q placeholder="Type a player\'s name" autocomplete="off" aria-label="Find a client by the player\'s name"><div data-res>' + (cur && cur.kind === "client" ? '<button type="button" class="r on" data-pick="client" data-pid="' + esc(cur.pid) + '" data-name="' + esc(cur.name) + '"><span>' + esc(cur.name) + "</span><small>Client</small></button>" : '<p class="n">Their account, exactly as the family sees it.</p>') + "</div>" +
      GROUPS.map((g) => { const rows = list.filter((p) => p.g === g[0]); return rows.length ? "<h3" + (g[0] === "coach" ? " data-coaches" : "") + ">" + g[1] + "</h3>" + rows.map(row).join("") : ""; }).join("");
    const q = bd.querySelector("[data-q]"), res = bd.querySelector("[data-res]");
    const find = async () => {
      const t = fold(q.value.trim()); if (t.length < 2) { res.innerHTML = '<p class="n">Their account, exactly as the family sees it.</p>'; return; }
      if (!players) { res.innerHTML = '<p class="n">Loading the players…</p>'; try { players = (await fs.collection("players").where("status", "==", "active").get()).docs.map((d) => ({ id: d.id, name: String((d.data() || {}).name || d.id) })).sort((a, b) => a.name.localeCompare(b.name)); } catch (e) { players = null; res.innerHTML = '<p class="n">The players did not load.</p>'; return; } }
      const now = fold(q.value.trim()); const hit = players.filter((p) => fold(p.name).includes(now)).slice(0, 8);
      res.innerHTML = hit.length ? hit.map((p) => '<button type="button" class="r" data-pick="client" data-pid="' + esc(p.id) + '" data-name="' + esc(p.name) + '"><span>' + esc(p.name) + "</span><small>Client</small></button>").join("") : '<p class="n">No active player with that name.</p>';
    };
    q.addEventListener("input", find);
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("[data-view-as],[data-view-back]"); if (!t) return;
    e.preventDefault(); if (t.hasAttribute("data-view-back")) clear(); else open();
  });
  window.PWView = { get, set, clear, open, pill };
  css(); pill();
})();

/* Dictation on every text box (Nov 22, 2026): shared/dictate.js, once per page */
(function () { try { if (window.parent !== window || document.querySelector('script[data-dictate-js]')) return; const sc = document.createElement('script'); sc.src = '/shared/dictate.js'; sc.async = true; sc.setAttribute('data-dictate-js', '1'); document.head.appendChild(sc); } catch (e) { /* the page works without it */ } })();
