/* PROWORLD — the page chrome of the redesign (shared/design.js), used with shared/design.css.
   Draws what every redesigned page shares: the six brand lights under the page, the gradient sky at the top (the page's
   skin), the top bar (wordmark · the pages this person has · a visible "Jump to…" field · the person), the compact bar that
   slides in once the greeting has scrolled away, the ⌘K jump palette, the ticker of today's signals, and the small motions
   (tiles tilt toward the cursor with a soft flashlight, a lime ripple on press, the sky's bright spot drifting toward the
   cursor, sections rising into place, numbers counting up). Everything respects prefers-reduced-motion.
   Include after shared/pages.js and shared/pwauth.js:  <script src="/shared/design.js"></script>
   Use:  PWDesign.mount({ skin: "home"|"coach"|"desk"|"studio"|"family", active: "<page id>" | "/", strip: true, jump: true, title: "" });
         PWDesign.active("tryouts") re-marks the strip when a page changes view;  PWDesign.signals([{ cls: "ok"|"due"|"new"|"info", html, href }]);
         PWDesign.palette([{ name, kind, href }]);  PWDesign.countUp(root);  PWDesign.toast(msg, err);  PWDesign.esc(s);  PWDesign.greet(name)
         A public page (no sign-in) mounts with { strip: false, jump: false }: the wordmark alone, no palette.                            */
(function () {
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

  // ── the top bar ──
  let stripResize = false;
  function stripFit() { const st = $("#pwd-top .pwd-strip"); if (st) st.classList.toggle("fade", st.scrollLeft + st.clientWidth < st.scrollWidth - 2); }
  function drawTop() {
    const top = $("#pwd-top"); if (!top) return;
    const home = opts.active ? opts.active === "/" : here === "/";
    const items = [{ name: "Dashboard", href: "/", on: home }].concat(mine().filter((p) => p.menu).map((p) => ({ name: p.short || p.name, href: pageHref(p), ext: external(p), on: opts.active ? opts.active === p.id : isHere(p) })));
    const strip = opts.strip === false ? '<span class="pwd-sp"></span>' : '<nav class="pwd-strip" aria-label="PROWORLD pages">' + (ctx ? items.map((i) => '<a class="' + (i.on ? "on" : "") + '" href="' + esc(i.href) + '"' + (i.ext ? ' target="_blank" rel="noopener"' : "") + (i.on ? ' aria-current="page"' : "") + ">" + esc(i.name) + "</a>").join("") + (home ? "" : '<a class="more" href="/">All pages →</a>') : "") + "</nav>";
    const initials = (n) => (String(n || "").trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
    const who = ctx ? '<div class="pwd-me"><button type="button" class="pwd-av" data-me aria-label="Your account">' + esc(initials(ctx.name || ctx.email)) + '</button><span class="who"><b>' + esc(ctx.name || ctx.email) + '</b><span class="role">' + (ctx.owner ? " · Owner" : ctx.admin ? " · Admin" : "") + '</span><button class="out" type="button" data-out>Sign out</button></span></div>' : "";
    const jump = opts.jump === false ? "" : '<button class="pwd-jump" type="button" data-pal aria-label="Jump to a page">' + SEARCH + "<span>Jump to a page, a report, a plan…</span><kbd>" + KBD + "</kbd></button>";
    top.innerHTML = '<a class="pwd-mark" href="/" aria-label="PROWORLD Dashboard"></a>' + strip + jump + who;
    const out = top.querySelector("[data-out]"); if (out) out.addEventListener("click", () => window.PWAuth && window.PWAuth.signOut());
    const me = top.querySelector("[data-me]"); if (me) me.addEventListener("click", (e) => { e.stopPropagation(); me.parentNode.classList.toggle("open"); });
    // the strip fades on the right only while more pages hide there, and the page you are on is always in view
    const st = top.querySelector(".pwd-strip");
    if (st) {
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
    const all = [{ name: "Dashboard", kind: "home", href: "/" }].concat(extra, base);
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
  function go(p) { if (!p) return; if (p.ext) window.open(p.href, "_blank", "noopener"); else location.href = p.href; pclose(); }
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
  window.addEventListener("pw:auth", (e) => { ctx = e.detail; if (mounted) drawTop(); });
  window.addEventListener("pw:auth-change", (e) => { ctx = e.detail; if (mounted) drawTop(); });
  // a page with several views (the Coach Portal's assessments / try-outs / board) re-marks the strip as the view changes
  function active(id) { opts.active = id; if (mounted) drawTop(); }
  window.PWDesign = { mount, active, signals, palette: (list) => { extra = Array.isArray(list) ? list : []; }, countUp, greet, toast, esc, get ctx() { return ctx; } };
})();
