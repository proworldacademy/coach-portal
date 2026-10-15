// PROWORLD — the page strip: one menu across the site, showing only the pages the signed-in person may open.
// Include after shared/pages.js (and shared/pwauth.js): <script src="/shared/menu.js"></script>
(function () {
  "use strict";
  const P = window.PW_PAGES; if (!P) return;
  const css = [
    ".pw-strip{background:#000;color:#fff;border-bottom:1px solid #222;font-family:\"Aeonik Pro\",\"Helvetica Neue\",Arial,sans-serif;-webkit-font-smoothing:antialiased}",
    ".pw-strip .in{max-width:1380px;margin:0 auto;padding:0 max(16px,env(safe-area-inset-right,0px)) 0 max(16px,env(safe-area-inset-left,0px));display:flex;align-items:center;gap:4px;height:40px;overflow-x:auto;scrollbar-width:none}",
    "@media(min-width:641px){.pw-strip .in{padding-left:24px;padding-right:24px}}",
    ".pw-strip .in::-webkit-scrollbar{display:none}",
    ".pw-strip .mark{font-family:\"Review Condensed\",\"Barlow Condensed\",\"Arial Narrow\",Impact,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:17px;letter-spacing:.5px;color:#E2FE78;text-decoration:none;margin-right:14px;white-space:nowrap;line-height:1;padding-top:2px}",
    ".pw-strip a.it{color:#c9cbc2;text-decoration:none;font-size:10.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;padding:0 10px;height:40px;display:inline-flex;align-items:center;white-space:nowrap;border-bottom:3px solid transparent;margin-bottom:-1px}",
    ".pw-strip a.it:hover{color:#fff}",
    ".pw-strip a.it.on{color:#fff;border-bottom-color:#E2FE78}",
    ".pw-strip .sp{flex:1}",
    ".pw-strip a.all{color:#E2FE78;text-decoration:none;font-size:10.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;white-space:nowrap;padding-left:10px}",
    ".pw-strip a.all:hover{text-decoration:underline}"
  ].join("");
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const here = location.pathname.replace(/index\.html$/, "");
  const el = document.createElement("div"); el.className = "pw-strip"; el.setAttribute("role", "navigation"); el.setAttribute("aria-label", "PROWORLD pages");
  function draw(ctx) {
    const mine = P.PAGES.filter((p) => p.menu && (!ctx || ctx.has(p.id)));
    const items = [{ name: "Dashboard", href: "/", on: here === "/" }].concat(mine.map((p) => {
      const internal = p.opens === "site"; const path = internal ? p.url.split("#")[0] : "";
      return { name: p.short || p.name, href: p.url, ext: !internal, on: internal && !p.url.includes("#") && here.replace(/\/$/, "") === path.replace(/\/$/, "") };
    }));
    el.innerHTML = '<div class="in"><a class="mark" href="/">PROWORLD</a>' + (ctx ? items.map((i) => '<a class="it' + (i.on ? " on" : "") + '" href="' + esc(i.href) + '"' + (i.ext ? ' target="_blank" rel="noopener"' : "") + (i.on ? ' aria-current="page"' : "") + ">" + esc(i.name) + "</a>").join("") : "") + '<span class="sp"></span><a class="all" href="/">All pages →</a></div>';
  }
  draw(null);
  const mount = () => { if (!el.parentNode) document.body.insertBefore(el, document.body.firstChild); };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  window.addEventListener("pw:auth", (e) => draw(e.detail));
  window.addEventListener("pw:auth-change", (e) => draw(e.detail));
  if (window.PWAuth && window.PWAuth.ctx && window.PWAuth.ctx.has) draw(window.PWAuth.ctx);
})();
