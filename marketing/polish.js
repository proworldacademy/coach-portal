/* The design pass on Marketing (Antonio, Nov 13, 2026: "apply the same principles" as the Coach Portal's pass — hierarchy by order of
   work, the unimportant folded into accordions, related things grouped). A layer on top of the App view: it reads the cards the
   page draws and folds them; it never changes the data, the plan or what a button does. Two new files (this one and polish.css),
   so the page's own scripts stay as they are.
   · Long, read-once cards fold under their title (closed by default): AI replies, the ads in these weeks, In hand, Ask the engine.
   · Execute and Create: a week that is over, or more than a week away, folds; this week and the next stay open.
   · Needs you: the same notice several times ("Ad not live" × 3) becomes one line that opens.
   What a person opens or closes is remembered on this device. */
(function () {
  "use strict";
  const KEY = "mk-fold";
  let mem = {}; try { mem = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { mem = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* no storage */ } };
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const CLOSED = [/^AI replies/i, /^The ads in these weeks/i, /^In hand/i, /^Ask the engine/i];
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  // "Week of Nov 2" → is that week over? (its Sunday is before today)
  const weekOver = (label) => { const m = /Week of ([A-Z][a-z]{2}) (\d{1,2})/.exec(label); if (!m) return false; const now = today(); let d = new Date(m[1] + " " + m[2] + ", " + now.getFullYear() + " 12:00:00"); if (isNaN(d)) return false; if (d - now > 200 * 864e5) d.setFullYear(d.getFullYear() - 1); const end = new Date(d); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59); return end < now; };
  // a week that starts more than a week from now: not yet the work in hand
  const weekFar = (label) => { const m = /Week of ([A-Z][a-z]{2}) (\d{1,2})/.exec(label); if (!m) return false; const now = today(); let d = new Date(m[1] + " " + m[2] + ", " + now.getFullYear() + " 12:00:00"); if (isNaN(d)) return false; if (now - d > 200 * 864e5) d.setFullYear(d.getFullYear() + 1); return d - now > 8 * 864e5; };
  const wsFar = (ws) => { const d = new Date(ws + "T12:00:00"); if (isNaN(d)) return false; return d - today() > 7 * 864e5; };
  const wsOver = (ws) => { const d = new Date(ws + "T12:00:00"); if (isNaN(d)) return false; d.setDate(d.getDate() + 7); d.setHours(23, 59, 59); return d < today(); };   // ws = the Sunday before the week's Monday

  function foldCards(root) {
    root.querySelectorAll(".card").forEach((card) => {
      const label = card.querySelector(":scope > .card-label"); if (!label || card.closest(".modal")) return;
      const t = txt(label); const k = "c:" + t.replace(/\s*·.*$/, "").slice(0, 60);
      const week = /^Week of /.test(t);
      const def = CLOSED.some((re) => re.test(t)) ? false : week ? !(weekOver(t) || weekFar(t)) : null;
      if (def === null) { if (card.classList.contains("pfold")) card.classList.remove("pfold", "open"); return; }
      const open = k in mem ? !!mem[k] : def;
      if (!card.classList.contains("pfold")) card.classList.add("pfold");
      if (card.classList.contains("open") !== open) card.classList.toggle("open", open);
      if (card.dataset.pk !== k) card.dataset.pk = k;
      if (label.getAttribute("aria-expanded") !== String(open)) { label.setAttribute("aria-expanded", String(open)); label.setAttribute("role", "button"); label.tabIndex = 0; }
    });
  }
  function foldMonth(root) {
    root.querySelectorAll(".card > .fhead").forEach((h) => {
      const first = h.nextElementSibling; if (!first || !first.classList.contains("fn-row") || !first.dataset.ws) return;
      const ws = first.dataset.ws; const k = "w:" + ws; const open = k in mem ? !!mem[k] : !(wsOver(ws) || wsFar(ws));
      if (!h.classList.contains("pwk")) { h.classList.add("pwk"); h.setAttribute("role", "button"); h.tabIndex = 0; }
      if (h.dataset.pk !== k) h.dataset.pk = k;
      if (h.classList.contains("open") !== open) h.classList.toggle("open", open);
      let n = 0; for (let el = h.nextElementSibling; el && !el.classList.contains("fhead"); el = el.nextElementSibling) { if (!el.classList.contains("fn-row")) continue; n++; if (el.classList.contains("pwk-hide") === open) el.classList.toggle("pwk-hide", !open); }
      if (h.dataset.n !== String(n)) h.dataset.n = String(n);
    });
  }
  function groupNeeds() {
    const box = document.getElementById("home-attn"); if (!box) return;
    const rows = Array.from(box.querySelectorAll(":scope > .rw")); const by = new Map();
    rows.forEach((r) => { const b = r.querySelector(".t b"); const t = txt(b); if (!t || /^\d/.test(t) || /^Today/i.test(t)) return; if (!by.has(t)) by.set(t, []); by.get(t).push(r); });
    by.forEach((list, t) => {
      if (list.length < 2) return; const k = "n:" + t; const open = !!mem[k]; const head = list[0];
      if (head.dataset.pk !== k) { head.dataset.pk = k; head.classList.add("pgrp"); head.setAttribute("role", "button"); head.tabIndex = 0; }
      if (head.dataset.n !== String(list.length)) head.dataset.n = String(list.length);
      if (head.classList.contains("open") !== open) head.classList.toggle("open", open);
      list.slice(1).forEach((r) => { if (!r.classList.contains("pgrp-kid")) r.classList.add("pgrp-kid"); if (r.classList.contains("pwk-hide") === open) r.classList.toggle("pwk-hide", !open); });
    });
  }
  let busy = false;
  function run() {
    if (busy || !document.body.classList.contains("app-skin")) return; busy = true;
    try { const root = document.querySelector("main") || document.body; foldCards(root); foldMonth(root); groupNeeds(); } catch (e) { /* the page works without the folds */ }
    busy = false;
  }
  let timer = 0; const later = () => { clearTimeout(timer); timer = setTimeout(run, 60); };
  const toggle = (el) => { const k = el.dataset.pk; if (!k) return; const open = !el.classList.contains("open"); mem[k] = open; save(); run(); };
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("button, a, input, select, textarea, [onclick]") && !ev.target.closest(".card.pfold > .card-label, .fhead.pwk, .rw.pgrp") ) return;
    const lab = ev.target.closest(".card.pfold > .card-label"); if (lab) { if (ev.target.closest("button, a, input, select")) return; toggle(lab.parentElement); return; }
    const wk = ev.target.closest(".fhead.pwk"); if (wk) { toggle(wk); return; }
    const g = ev.target.closest(".rw.pgrp"); if (g && !ev.target.closest("button, a")) { toggle(g); }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key !== "Enter" && ev.key !== " ") return; const el = ev.target.closest && ev.target.closest(".card.pfold > .card-label, .fhead.pwk, .rw.pgrp"); if (!el || ev.target !== el) return; ev.preventDefault(); toggle(el.classList.contains("card-label") ? el.parentElement : el); });
  const start = () => { run(); new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
