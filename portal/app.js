/* The App look on the Coach Portal — the only look (Antonio, Nov 13, 2026: "just keep the app look"; App 2 and In between are gone,
   the switch with them) — and on the phone the bottom bar built from the view tabs: Reminders · Players · Contact · Privates. Loaded last. */
(function () {
  try { localStorage.removeItem("cp-view"); } catch (e) { /* no storage */ }
  document.body.classList.add("app-skin", "a2k");   // a2k: the shared pieces (three buttons, family card, rows) in portal/app2.css
  const vt = document.getElementById("vtabs"); if (!vt) return;

  // the bottom bar is the tab row: Reminders · Players · Contact · Privates (Antonio and Lorenzo, Nov 13). No "More": the ☰ at the top opens the Dashboard menu.
  const bar = document.createElement("nav"); bar.className = "cp-appbar"; bar.setAttribute("aria-label", "Coach Portal"); document.body.appendChild(bar);
  const ICON = { "Reminders": "●", "Players": "◉", "Contact": "✉", "Privates": "◔", "Try-outs": "★" };
  const nameOf = (el) => el.textContent.replace(/\d+$/, "").trim();
  function paint() {
    const items = Array.from(vt.querySelectorAll("button, a")).slice(0, 4); if (!items.length) { bar.innerHTML = ""; return; }
    bar.innerHTML = items.map((el, i) => { const name = nameOf(el); const red = el.querySelector("small.red"); const svg = el.querySelector(".ti"); return '<button type="button" class="' + (el.classList.contains("on") ? "on" : "") + '" data-i="' + i + '"><i>' + (svg ? svg.innerHTML : (ICON[name] || "•")) + (red ? '<em class="n">' + red.textContent.trim() + "</em>" : "") + "</i>" + name + "</button>"; }).join("");
    bar.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => { const el = vt.querySelectorAll("button, a")[Number(b.dataset.i)]; if (el) el.click(); }));
  }
  paint();
  new MutationObserver(paint).observe(vt, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
})();
