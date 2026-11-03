/* The app skin on the Coach Portal (Antonio, Nov 3, 2026): the switch (App / In between), and on the phone the bottom bar built from
   the view tabs — Players · Board · Attendance · More (More opens the ☰ sheet of the shared bar). Look only. Loaded last. */
(function () {
  let mode = "app";
  try { mode = localStorage.getItem("cp-view") || "app"; } catch (e) { /* no storage */ }
  const vt = document.getElementById("vtabs"); if (!vt) return;
  // the switch sits above the tab row
  const sw = document.createElement("div"); sw.className = "cp-switch";
  sw.innerHTML = '<span>Look</span>' + [["app", "App"], ["calm", "In between"]].map(([v, n]) => '<button type="button" class="' + (mode === v ? "on" : "") + '" data-view="' + v + '">' + n + "</button>").join("");
  vt.parentNode.insertBefore(sw, vt);
  sw.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("cp-view", b.dataset.view); } catch (e) { /* noop */ } location.reload(); }));
  if (mode !== "app") return;
  document.body.classList.add("app-skin");

  // the bottom bar mirrors the tab row: the first three tabs + More
  const bar = document.createElement("nav"); bar.className = "cp-appbar"; bar.setAttribute("aria-label", "Coach Portal"); document.body.appendChild(bar);
  const ICON = { "Players Portal": "●", "Try-outs": "★", "Coach Board": "▦", "Weekly contact": "✆", "Attendance": "✓", "Messages": "✉", "Courts": "◫", "Privates": "◔", "Staff & access": "⚙" };
  const SHORT = { "Players Portal": "Players", "Coach Board": "Board", "Weekly contact": "Contact", "Staff & access": "Staff" };
  function paint() {
    const items = Array.from(vt.querySelectorAll("button, a")); if (!items.length) { bar.innerHTML = ""; return; }
    const main = items.slice(0, 3);
    bar.innerHTML = main.map((el, i) => { const name = el.textContent.replace(/\d+$/, "").trim(); return '<button type="button" class="' + (el.classList.contains("on") ? "on" : "") + '" data-i="' + i + '"><i>' + (ICON[name] || "•") + "</i>" + (SHORT[name] || name) + "</button>"; }).join("") +
      '<button type="button" data-more="1"' + (main.some((el) => el.classList.contains("on")) ? "" : ' class="on"') + "><i>···</i>More</button>";
    bar.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => { const el = vt.querySelectorAll("button, a")[Number(b.dataset.i)]; if (el) el.click(); }));
    const more = bar.querySelector("[data-more]"); more.addEventListener("click", () => { const burger = document.querySelector(".pwd-burger"); if (burger) { burger.click(); return; } const rest = items.slice(3); if (rest.length) rest[0].click(); });
  }
  paint();
  new MutationObserver(paint).observe(vt, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
})();
