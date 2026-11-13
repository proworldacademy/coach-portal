/* The app skin on the Coach Portal (Antonio, Nov 3, 2026): the switch (App 2 / App / In between), and on the phone the bottom bar built from
   the view tabs — Reminders · Players · Contact · Privates. Look only. Loaded last. */
(function () {
  let mode = "app";
  try { mode = localStorage.getItem("cp-view") || "app"; } catch (e) { /* no storage */ }
  if (mode === "app2") { mode = "app"; try { localStorage.setItem("cp-view", "app"); } catch (e) { /* noop */ } }   // App is the final look (Nov 13): App 2 is retired, its pieces moved onto the App screens
  document.body.classList.add("a2k");   // the shared pieces from App 2 (three buttons, family card, rows): portal/app2.css
  const vt = document.getElementById("vtabs"); if (!vt) return;
  // the switch sits above the tab row
  const sw = document.createElement("div"); sw.className = "cp-switch";
  sw.innerHTML = '<span>Look</span>' + [["app", "App"], ["calm", "In between"]].map(([v, n]) => '<button type="button" class="' + (mode === v ? "on" : "") + '" data-view="' + v + '">' + n + "</button>").join("");
  vt.parentNode.insertBefore(sw, vt);
  sw.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("cp-view", b.dataset.view); } catch (e) { /* noop */ } location.reload(); }));
  if (mode !== "app" && mode !== "app2") return;
  document.body.classList.add("app-skin");
  if (mode === "app2") document.body.classList.add("app2");
  if (mode === "app2") { const g = document.createElement("div"); g.className = "a2glow"; g.setAttribute("aria-hidden", "true"); document.body.appendChild(g); }   // the pink glow behind the bar (portal/app2.css)   // the phone-first look (Antonio, Nov 5): portal/app2.css, the screens drawn by the page itself

  // the bottom bar is the tab row: Reminders · Players · Contact · Privates (Antonio and Lorenzo, Nov 13). No "More": the ☰ at the top opens the Dashboard menu.
  const bar = document.createElement("nav"); bar.className = "cp-appbar"; bar.setAttribute("aria-label", "Coach Portal"); document.body.appendChild(bar);
  const ICON = { "Reminders": "●", "Players": "◉", "Contact": "✉", "Privates": "◔", "Try-outs": "★" };
  const nameOf = (el) => el.textContent.replace(/\d+$/, "").trim();
  function paint() {
    const items = Array.from(vt.querySelectorAll("button, a")).slice(0, 4); if (!items.length) { bar.innerHTML = ""; return; }
    bar.innerHTML = items.map((el, i) => { const name = nameOf(el); const red = el.querySelector("small.red"); return '<button type="button" class="' + (el.classList.contains("on") ? "on" : "") + '" data-i="' + i + '"><i>' + (ICON[name] || "•") + (red ? '<em class="n">' + red.textContent.trim() + "</em>" : "") + "</i>" + name + "</button>"; }).join("");
    bar.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => { const el = vt.querySelectorAll("button, a")[Number(b.dataset.i)]; if (el) el.click(); }));
  }
  paint();
  new MutationObserver(paint).observe(vt, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
})();
