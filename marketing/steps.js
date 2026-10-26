/* Marketing in three steps (Antonio, Oct 26, 2026): the same page re-sorted into the order the work happens —
   ① Report (what worked, the ads, the competitors) · ② Create (the two weeks, the briefs, the ads in them) · ③ Execute (created · posted ·
   missing, ticked by the morning run) · More (the reference tabs). Nothing is re-rendered here: the existing cards are MOVED into the
   step sections, so every renderer, id and run stays exactly as it is. "Classic" (the old tabs) is one tap away; the choice is remembered
   on this device. Loaded after app.js / live.js / engine.js. */
(function () {
  const $ = (id) => document.getElementById(id);
  let mode = "steps";
  try { mode = localStorage.getItem("mk-view") || "steps"; } catch (e) { /* no storage */ }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cardOf = (id) => { const el = $(id); return el ? el.closest(".card") || el : null; };
  const nav = $("nav"); if (!nav) return;

  // ── the switch (both modes) ──
  const sw = document.createElement("div"); sw.className = "view-switch"; sw.id = "view-switch";
  sw.innerHTML = '<span class="small muted">View</span><button type="button" class="vs' + (mode === "steps" ? " on" : "") + '" data-view="steps">Three steps</button><button type="button" class="vs' + (mode === "classic" ? " on" : "") + '" data-view="classic">Classic</button>';
  nav.parentNode.insertBefore(sw, nav);
  sw.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("mk-view", b.dataset.view); } catch (e) { /* noop */ } location.hash = ""; location.reload(); }));
  if (mode !== "steps") return;

  // ── the step nav ──
  const STEPS = [
    ["sreport", "1", "Report", "what worked, the ads, the competitors"],
    ["screate", "2", "Create", "the two weeks, the briefs, the ads in them"],
    ["sexecute", "3", "Execute", "created · posted · missing"],
    ["smore", "", "More", "banks, archive, history, the runs"]
  ];
  const steps = document.createElement("nav"); steps.className = "steps"; steps.id = "steps"; steps.setAttribute("aria-label", "Marketing in three steps");
  steps.innerHTML = STEPS.map(([id, n, name, sub]) => '<button type="button" class="step' + (n ? "" : " more") + '" data-step="' + id + '" role="tab">' + (n ? "<i>" + n + "</i>" : "") + "<span><b>" + name + (n ? "" : " ▾") + "</b><small>" + esc(sub) + "</small></span></button>").join("");
  nav.parentNode.insertBefore(steps, nav);
  nav.hidden = true; const lib = $("lib-row"); if (lib) lib.hidden = true;

  // ── the step sections, in the same container as the tabs ──
  const host = $("tab-home").parentNode;
  const mk = (id, title, sub) => { const s = document.createElement("section"); s.className = "tab"; s.id = "tab-" + id; s.innerHTML = '<h1 class="h-display page-title">' + title + '</h1><p class="page-sub">' + sub + "</p>"; host.insertBefore(s, $("tab-home")); return s; };
  const sReport = mk("sreport", "The <em>report</em>", "Read, nothing to click. Every morning the brain reads our Instagram and the ad account, every Monday the competitors, every Sunday it writes what worked.");
  const sCreate = mk("screate", "<em>Create</em> the two weeks", "One button builds the two weeks from the banks the brain keeps refilling. Every coach once, the campus three times. Tick, swap, approve, send the briefs from here.");
  const sExec = mk("sexecute", "<em>Execute</em>", "One table: created · posted · missing, ticked by the morning run from Instagram. Missing goes first into the next two weeks.");
  const sMore = mk("smore", "<em>More</em>", "The reference screens: the banks, the archive, the history, the season, the runs. Same as before, one door.");
  const move = (sec, el) => { if (el && el.parentNode !== sec) sec.appendChild(el); };
  const labelled = (title, el) => { if (!el) return null; const c = document.createElement("div"); c.className = "card"; c.innerHTML = '<div class="card-label">' + title + "</div>"; c.appendChild(el); return c; };

  // ① Report
  move(sReport, $("import-card"));
  move(sReport, $("home-attn-card"));
  move(sReport, cardOf("home-ig"));
  move(sReport, cardOf("home-ads"));
  move(sReport, labelled("What worked, what did not <span class=\"small muted\">· the readings, newest first</span>", $("reports-list")));
  move(sReport, labelled("What the competitors are running <span class=\"small muted\">· the Monday read</span>", $("ad-watch")));
  move(sReport, cardOf("home-top"));
  move(sReport, cardOf("home-runs"));

  // ② Create
  move(sCreate, $("fortnight"));
  const asg = $("tab-assignments"); if (asg) Array.from(asg.querySelectorAll(":scope > .card, :scope > .grid-2, :scope > div")).forEach((el) => move(sCreate, el));
  move(sCreate, cardOf("brief-buttons"));
  move(sCreate, labelled("The ads in these weeks <span class=\"small muted\">· the ad plan</span>", $("ad-plan")));
  move(sCreate, labelled("The season <span class=\"small muted\">· posts from · ads from</span>", $("ad-cal")));

  // ③ Execute
  const execCard = document.createElement("div"); execCard.className = "card"; execCard.id = "exec-card"; execCard.innerHTML = '<div class="card-label">What went out <span class="small muted" id="exec-when"></span></div><div id="exec-tiles" class="grid-4" style="margin-bottom:14px"></div><div class="tbl-wrap"><table class="tbl" id="exec-table"></table></div>';
  sExec.appendChild(execCard);
  move(sExec, cardOf("home-week"));
  move(sExec, cardOf("home-score-when"));
  move(sExec, cardOf("home-adplan"));
  move(sExec, labelled("The ads in the account <span class=\"small muted\">· live now</span>", $("ads-live")));

  // More: the old library row, visible, plus the workflow pieces nobody opens daily
  if (lib) { lib.hidden = false; sMore.appendChild(lib); }
  const moreRow = document.createElement("div"); moreRow.className = "nav"; moreRow.style.marginTop = "8px";
  ["assignments:Coach assignments (classic)", "workflow:Workflow", "ads:Ads (classic)", "reports:Reports (classic)", "home:Home (classic)"].forEach((s) => { const [id, name] = s.split(":"); const b = document.createElement("button"); b.className = "tab-btn"; b.dataset.tab = id; b.textContent = name; b.addEventListener("click", () => openTab(id)); moreRow.appendChild(b); });
  sMore.appendChild(moreRow);
  move(sMore, labelled("How the engine runs", $("pipeline")));

  // ── switching ──
  function openTab(id) {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
    const t = $("tab-" + id); if (t) t.classList.add("active");
    const b = document.querySelector('.tab-btn[data-tab="' + id + '"]'); if (b) b.classList.add("active");
    const step = STEPS.find((s) => s[0] === id) ? id : "smore";
    steps.querySelectorAll(".step").forEach((x) => { const on = x.dataset.step === step; x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
    window.scrollTo(0, 0);
  }
  steps.querySelectorAll(".step").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.step)));
  // the library buttons keep working; they mark More
  if (lib) lib.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => { steps.querySelectorAll(".step").forEach((x) => x.classList.toggle("on", x.dataset.step === "smore")); }));
  // old links keep landing in the right step
  const MAP = { home: "sreport", reports: "sreport", fortnight: "screate", assignments: "screate", workflow: "screate", ads: "screate", report: "sreport", create: "screate", execute: "sexecute", more: "smore" };
  const fromHash = () => { const h = String(location.hash || "").replace(/^#/, ""); if (!h) return openTab("sreport"); if (MAP[h]) return openTab(MAP[h]); if ($("tab-" + h)) return openTab(h); openTab("sreport"); };
  window.addEventListener("hashchange", fromHash);
  // app.js's own hash handler may have opened a classic tab already; ours runs last
  setTimeout(fromHash, 0);
  window.openWeek = function (ws) { openTab("screate"); if (window.PW && PW.showWeek) PW.showWeek(ws); };

  // ── ③ the table: every item of the current fortnight, with the run's tick ──
  function items(w) { const out = []; (w.coaches || []).forEach((c) => (c.ideas || []).forEach((i) => out.push({ who: c.name, it: i }))); (w.production || []).forEach((p) => out.push({ who: "Production", it: p })); return out; }
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Spare"];
  function renderExec() {
    const PW = window.PW; if (!PW || !PW.S || !$("exec-table")) return;
    const S = PW.S, fn = PW.fnOf(PW.wsOf(new Date())), pair = PW.fnPair(fn);
    const when = S.delivery && S.delivery.checkedAt ? new Date(S.delivery.checkedAt) : null;
    $("exec-when").textContent = "· " + PW.fnLabel(fn) + (when ? " · checked against Instagram " + when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " " + when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : " · not checked yet");
    let created = 0, posted = 0, missing = 0, first = 0; const rows = [];
    pair.forEach((ws, wi) => {
      const w = S.weeks && S.weeks[ws]; if (!w) { rows.push('<tr><td colspan="7" class="muted">Week ' + (wi + 1) + " · " + esc(PW.weekLabel ? PW.weekLabel(ws) : ws) + ' · not built yet. Press "Build the 2 weeks" on Create.</td></tr>'); return; }
      rows.push('<tr><td colspan="7"><div class="wk">Week ' + (wi + 1) + " · " + esc(w.weekDates || ws) + (w.locked ? "" : ' <span class="st">draft</span>') + "</div></td></tr>");
      items(w).sort((a, b) => DAYS.indexOf(a.it.day || "Spare") - DAYS.indexOf(b.it.day || "Spare")).forEach(({ who, it }) => {
        const r = PW.itemState(ws, it), st = r.st, e = r.e || {};
        if (st !== "spare") created++;
        if (st === "posted" || st === "late") posted++; else if (st === "missing") missing++;
        if (it.carried) first++;
        const d = PW.dayDate(ws, it.day); const dl = d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : (it.day || "Spare");
        const ig = st === "posted" || st === "late" ? esc((e.postedAt ? String(e.postedAt).slice(0, 10) + " · " : "") + (e.views ? e.views.toLocaleString() + " views" : "") + (e.matchedBy && e.matchedBy !== "title" ? " · matched by " + e.matchedBy : "") + (st === "late" ? " · late" : "")) : st === "missing" ? '<span class="miss">not on Instagram</span>' : st === "today" ? "today" : it.carried ? '<span class="st wait">carried · post first</span>' : "";
        rows.push("<tr" + (st === "missing" ? ' class="is-miss"' : "") + "><td>" + esc(dl) + "</td><td><b>" + esc(it.title || "") + "</b><div class=\"small muted\">" + esc([it.format, it.pillar].filter(Boolean).join(" · ")) + "</div></td><td>" + esc(who) + '</td><td class="c">' + (st === "spare" ? "" : "✓") + '</td><td class="c">' + (st === "posted" || st === "late" ? "✓" : '<span class="muted">·</span>') + '</td><td class="c">' + (st === "missing" ? "✕" : '<span class="muted">·</span>') + "</td><td>" + ig + "</td></tr>");
      });
    });
    $("exec-tiles").innerHTML = [["Created", created], ["Posted", posted], ["Missing", missing], ["Post first", first]].map(([l, n]) => '<div class="stat"><div class="stat-label">' + l + '</div><div class="stat-num">' + n + "</div></div>").join("");
    $("exec-table").innerHTML = '<thead><tr><th>Day</th><th>Item</th><th>Who</th><th class="c">Created</th><th class="c">Posted</th><th class="c">Missing</th><th>On Instagram</th></tr></thead><tbody>' + rows.join("") + "</tbody>";
  }
  if (window.PW && PW.hooks) PW.hooks.push(renderExec);
  renderExec();
})();
