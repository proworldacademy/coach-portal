/* Marketing in three steps (Antonio, Oct 26 → the app look, Nov 3, 2026): the same page re-sorted into the order the work happens —
   ① Report (what is happening) · ② Create (the next two weeks, by category — create.js) · ③ Execute (is it happening) · More (everything
   else). Nothing underneath changes: the existing cards are MOVED into the step sections, so every renderer, id and run stays as it is;
   what the three screens show is rebuilt here from the record as tiles, rows and chips (app.css). "Classic" (the old tabs) is one tap
   away until Manu signs off. Loaded after app.js / live.js / engine.js. */
(function () {
  const $ = (id) => document.getElementById(id);
  let mode = "app";
  try { mode = localStorage.getItem("mk-view") || "app"; if (mode === "steps" && !localStorage.getItem("mk-v3")) { mode = "app"; localStorage.setItem("mk-view", "app"); } localStorage.setItem("mk-v3", "1"); } catch (e) { /* no storage */ }   // Nov 3: everyone lands on App once; their own choice after that
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cardOf = (id) => { const el = $(id); return el ? el.closest(".card") || el : null; };
  const nav = $("nav"); if (!nav) return;

  // ── the switch (both modes) ──
  const sw = document.createElement("div"); sw.className = "view-switch"; sw.id = "view-switch";
  sw.innerHTML = '<span class="small muted">View</span>' + [["app", "App"], ["steps", "Three steps"], ["classic", "Classic"]].map(([v, n]) => '<button type="button" class="vs' + (mode === v ? " on" : "") + '" data-view="' + v + '">' + n + "</button>").join("");
  nav.parentNode.insertBefore(sw, nav);
  sw.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("mk-view", b.dataset.view); } catch (e) { /* noop */ } location.hash = ""; location.reload(); }));
  if (mode !== "app") return;
  document.body.classList.add("app-skin");

  // ── the tab bar: a segmented pill on desktop, the bottom bar on the phone ──
  const STEPS = [["sreport", "1", "Report"], ["screate", "2", "Create"], ["sexecute", "3", "Execute"], ["smore", "···", "More"]];
  const seg = document.createElement("nav"); seg.className = "seg"; seg.id = "steps"; seg.setAttribute("aria-label", "Marketing");
  seg.innerHTML = STEPS.map(([id, n, name]) => '<button type="button" data-step="' + id + '" role="tab"><i>' + n + "</i>" + name + "</button>").join("");
  nav.parentNode.insertBefore(seg, nav);
  const bar = document.createElement("nav"); bar.className = "appbar"; bar.setAttribute("aria-label", "Marketing");
  bar.innerHTML = STEPS.map(([id, n, name]) => '<button type="button" data-step="' + id + '"><i>' + n + "</i>" + name + "</button>").join("");
  document.body.appendChild(bar);
  nav.hidden = true; const lib = $("lib-row"); if (lib) lib.hidden = true;

  // ── the step sections ──
  const host = $("tab-home").parentNode;
  const mk = (id, title, when) => { const s = document.createElement("section"); s.className = "tab"; s.id = "tab-" + id; s.innerHTML = '<h1 class="h-display page-title">' + title + '</h1><p class="page-when" id="when-' + id + '">' + (when || "") + "</p>"; host.insertBefore(s, $("tab-home")); return s; };
  const sReport = mk("sreport", "Report.", "");
  const sCreate = mk("screate", "Create.", "");
  const sExec = mk("sexecute", "Execute.", "");
  const sMore = mk("smore", "More.", "The banks, the archive, the history, the season, the runs, the classic screens.");
  const move = (sec, el) => { if (el && el.parentNode !== sec) sec.appendChild(el); };
  const labelled = (title, el) => { if (!el) return null; const c = document.createElement("div"); c.className = "card"; c.innerHTML = '<div class="card-label">' + title + "</div>"; c.appendChild(el); return c; };

  // ① Report — built below (renderReport); the Needs-you card is the one live.js keeps
  const rep = document.createElement("div"); rep.id = "report-clean"; sReport.appendChild(rep);
  const attn = $("home-attn-card");

  // ② Create — create.js draws it around #fortnight
  move(sCreate, $("fortnight"));
  move(sCreate, cardOf("brief-buttons"));
  move(sCreate, labelled("The ads in these weeks <span class=\"small muted\">· the ad plan</span>", $("ad-plan")));

  // ③ Execute — built below (renderExec)
  const ex = document.createElement("div"); ex.id = "exec-clean"; sExec.appendChild(ex);

  // More: everything else, one door
  if (lib) { lib.hidden = false; sMore.appendChild(lib); }
  const moreRow = document.createElement("div"); moreRow.className = "pills"; moreRow.style.margin = "8px 0 16px";
  ["assignments:Coach assignments", "workflow:Workflow", "ads:Ads", "reports:All reports", "home:Home (classic)"].forEach((s) => { const [id, name] = s.split(":"); const b = document.createElement("button"); b.className = "pill"; b.dataset.tab = id; b.textContent = name; b.addEventListener("click", () => openTab(id)); moreRow.appendChild(b); });
  sMore.appendChild(moreRow);
  move(sMore, cardOf("home-ig")); move(sMore, cardOf("home-ads")); move(sMore, cardOf("home-top")); move(sMore, cardOf("home-runs")); move(sMore, $("import-card"));
  move(sMore, cardOf("home-week")); move(sMore, cardOf("home-score-when")); move(sMore, cardOf("home-adplan"));
  move(sMore, labelled("What the competitors are running <span class=\"small muted\">· the Monday read, full table</span>", $("ad-watch")));
  move(sMore, labelled("The ads in the account <span class=\"small muted\">· live now</span>", $("ads-live")));
  const asg = $("tab-assignments"); if (asg) Array.from(asg.querySelectorAll(":scope > .card, :scope > .grid-2, :scope > div")).forEach((el) => move(sMore, el));
  move(sMore, labelled("The season <span class=\"small muted\">· posts from · ads from</span>", $("ad-cal")));
  move(sMore, labelled("Every report <span class=\"small muted\">· newest first</span>", $("reports-list")));
  move(sMore, labelled("How the engine runs", $("pipeline")));

  // ── switching ──
  function openTab(id) {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
    const t = $("tab-" + id); if (t) t.classList.add("active");
    const b = document.querySelector('.tab-btn[data-tab="' + id + '"]'); if (b) b.classList.add("active");
    const step = STEPS.find((s) => s[0] === id) ? id : "smore";
    document.querySelectorAll(".seg [data-step], .appbar [data-step]").forEach((x) => { const on = x.dataset.step === step; x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".seg [data-step], .appbar [data-step]").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.step)));
  if (lib) lib.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));
  const MAP = { home: "sreport", reports: "smore", aireplies: "sreport", fortnight: "screate", assignments: "smore", workflow: "smore", ads: "smore", report: "sreport", create: "screate", execute: "sexecute", more: "smore" };
  const fromHash = () => { const h = String(location.hash || "").replace(/^#/, ""); if (!h) return openTab("sreport"); if (MAP[h]) return openTab(MAP[h]); if ($("tab-" + h)) return openTab(h); openTab("sreport"); };
  window.addEventListener("hashchange", fromHash);
  setTimeout(fromHash, 0);
  window.openWeek = function (ws) { openTab("screate"); if (window.PW && PW.showWeek) PW.showWeek(ws); };

  // ── the month (Antonio, Nov 9: "just do monthly work — November, December — adjust to the 30 or 31 days") ──
  // a month = the weeks whose Monday falls in it (4 or 5 week documents); the data stays weekly, the runs keep building fortnights.
  const PWM = window.PWM = (() => {
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    let cur = (() => { const d = new Date(Date.now() + 4 * 864e5); return d.getFullYear() + "-" + pad(d.getMonth() + 1); })();
    const weeks = (ym) => { ym = ym || cur; const [y, m] = ym.split("-").map(Number); const out = []; const d = new Date(y, m - 1, 1); while (d.getMonth() === m - 1) { if (d.getDay() === 1) { const sun = new Date(d); sun.setDate(d.getDate() - 1); out.push(iso(sun)); } d.setDate(d.getDate() + 1); } return out; };
    const label = (ym) => { ym = ym || cur; const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
    const shift = (n) => { const [y, m] = cur.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); cur = d.getFullYear() + "-" + pad(d.getMonth() + 1); fire(); };
    const now = () => { const d = new Date(Date.now() + 4 * 864e5); cur = d.getFullYear() + "-" + pad(d.getMonth() + 1); fire(); };
    const subs = []; const fire = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    return { get cur() { return cur; }, weeks, label, shift, now, on: (f) => subs.push(f) };
  })();

  // ── helpers ──
  const fmt = (n) => (n == null || n === "" || isNaN(Number(n)) ? "—" : Number(n) >= 100000 ? (Number(n) / 1000).toFixed(1).replace(/\.0$/, "") + "<small>K</small>" : Number(n).toLocaleString("en-US"));
  const money = (n) => (n == null || isNaN(Number(n)) ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US"));
  const dayL = (d) => { if (!d) return ""; const x = new Date(String(d).length === 10 ? d + "T12:00:00" : d); return isNaN(x) ? String(d) : x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const monLabel = (ws) => { const d = new Date(ws + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const tile = (lab, n, dl, cls) => '<div class="tile"><div class="lab">' + esc(lab) + '</div><div class="n">' + n + "</div>" + (dl ? '<span class="dl ' + (cls || "") + '">' + dl + "</span>" : "") + "</div>";
  const rw = (ic, icCls, title, sub, right) => '<div class="rw"><div class="ic ' + (icCls || "") + '">' + ic + '</div><div class="t"><b>' + esc(title) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>" + (right || "") + "</div>";
  const chip = (cls, t) => '<span class="chip ' + cls + '">' + esc(t) + "</span>";
  const items = (w) => { const out = []; (w.coaches || []).forEach((c, ci) => (c.ideas || []).forEach((i, ii) => out.push({ who: c.name, it: i, ref: "'" + w.weekStart + "','idea'," + ci + "," + ii }))); (w.production || []).forEach((p, pi) => out.push({ who: /^ad/i.test(p.format || "") ? "Ad video" : "Production", it: p, ref: "'" + w.weekStart + "','prod'," + pi })); return out; };
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Spare"];

  // ── ① Report: four numbers, needs you, what worked, the competitors, the reports ──
  function renderReport() {
    const PW = window.PW; if (!PW || !PW.S) return; const S = PW.S;
    const N = PW.latestNumbers ? PW.latestNumbers() : null, ig = N && N.ig, A = N && N.ads;
    const thisWS = PW.wsOf(new Date()), w = S.weeks[thisWS], t = w ? PW.weekTally(w) : null;
    $("when-sreport").textContent = (N ? "Read " + dayL(N.date || N.id) + " in the morning" : "No numbers read yet") + (N && N.range ? " · the 7 days " + dayL(N.range.from) + " – " + dayL(N.range.to) : "");
    const fc = ig && ig.followersChange7 != null ? Number(ig.followersChange7) : null;
    const vd = ig && ig.views7 != null && ig.views7prev ? Math.round((ig.views7 - ig.views7prev) / ig.views7prev * 100) : null;
    const tiles = '<div class="tiles">' +
      tile("Followers", ig ? fmt(ig.followers) : "—", fc == null ? "" : (fc >= 0 ? "↗ +" : "↘ ") + fmt(fc) + " this week", fc < 0 ? "down" : "") +
      tile("Views · 7 days", ig ? fmt(ig.views7) : "—", vd == null ? "" : (vd >= 0 ? "↗ +" : "↘ ") + vd + "% vs last week", vd < 0 ? "down" : "") +
      tile("Posted vs plan", t ? t.posted + " <small>of " + (t.total - t.spare) + "</small>" : "—", t ? (t.missing ? t.missing + " missing" : "on track") : "no plan this week", t && t.missing ? "down" : "") +
      tile("Ad leads · 7 days", A && A.connected !== false ? fmt(A.leads7) : "—", A && A.leads7 ? money(A.cpl7) + " per lead · " + money(A.spend7) : A ? money(A.spend7) + " spent" : "", "") + "</div>";
    // what worked / what did not — the newest Monday read
    const mk = Array.isArray(S.market) && S.market.length ? S.market.find((m) => m && m.by === "instagram-review") || S.market[0] : null;
    const f = mk ? (mk.findings || []) : [];
    const pick = (re, n) => f.filter((l) => re.test(l)).slice(0, n);
    const worked = pick(/^WORKING/i, 2).map((l) => rw("↑", "lime", l.replace(/^WORKING\s*[—-]\s*/i, "").split(/[.:;]/)[0].slice(0, 90), l.replace(/^WORKING\s*[—-]\s*/i, "").slice(0, 160), chip("imp", "Double down")))
      .concat(pick(/^NOT WORKING/i, 1).map((l) => rw("↓", "bad", l.replace(/^NOT WORKING\s*[—-]\s*/i, "").split(/[.:;]/)[0].slice(0, 90), l.replace(/^NOT WORKING\s*[—-]\s*/i, "").slice(0, 160), chip("miss", "Change"))));
    // competitors: ads running + news, three lines
    const aw = Array.isArray(S.adWatch) && S.adWatch[0] ? S.adWatch[0] : null;
    const comp = (aw ? (aw.rows || []).filter((r) => r && r.active).slice(0, 2).map((r) => rw(String(r.brand || "").split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase(), "", r.brand + " · " + r.active + " ad" + (r.active > 1 ? "s" : "") + " running", [r.type, r.program].filter(Boolean).join(" · "), chip("", "Ads"))) : [])
      .concat(pick(/^NEWS/i, 2).map((l) => { const s = l.replace(/^NEWS\s*[—-]\s*/i, ""); return rw("N", "", s.split(/[.:;(]/)[0].slice(0, 80), s.slice(0, 160), chip("", "News")); })).slice(0, 3);
    const reps = Object.values(S.reports || {}).filter((r) => r && r.date).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    const label = (r) => r.by === "instagram-review" ? "Monday review" : r.by === "engine" ? "Sunday engine" : r.by === "ai-replies" ? "AI replies" : (r.by || "Report");
    rep.innerHTML = tiles +
      '<div class="g2" style="margin-top:16px"><div id="slot-attn"></div><div class="card"><div class="card-label">What worked, what did not <span class="small muted">' + (mk ? "· " + dayL(mk.date) : "") + "</span></div>" + (worked.join("") || '<div class="empty">The Monday review writes this.</div>') + "</div></div>" +
      '<div class="g31" style="margin-top:16px"><div class="card"><div class="card-label">Competitors this week <span class="small muted">' + (aw ? "· " + (aw.rows || []).length + " watched" : "") + "</span></div>" + (comp.join("") || '<div class="empty">The Monday review reads them.</div>') + '</div><div class="card"><div class="card-label">Reports</div><div class="pills">' + reps.map((r) => '<button class="pill" data-rep="' + esc(r.id || "") + '">' + esc(label(r)) + " · " + esc(dayL(r.date)) + "</button>").join("") + '<button class="pill" data-more="reports">All →</button></div></div></div>';
    if (attn) { const slot = $("slot-attn"); if (slot) { slot.replaceWith(attn); attn.querySelector(".card-label").innerHTML = "Needs you"; } tidyAttn(); }
    rep.querySelectorAll("[data-rep],[data-more]").forEach((b) => b.addEventListener("click", () => { openTab("smore"); const el = $("reports-list"); if (el) setTimeout(() => el.scrollIntoView({ block: "start", behavior: "smooth" }), 50); }));
    const ai = $("ai-replies"); if (ai) sReport.appendChild(ai);
  }

  // Needs you as rows: one fact per line, the number first (the old lines were sentences)
  function tidyAttn() {
    const box = $("home-attn"); if (!box) return;
    const lines = Array.from(box.querySelectorAll(".attn")); if (!lines.length) return;
    box.innerHTML = lines.map((l) => {
      const b = l.querySelector("b"), cls = b ? b.className : "", word = b ? b.textContent : "";
      let text = (l.querySelector("span") || l).textContent.replace(/\s+/g, " ").trim();
      text = text.replace(/\s*·\s*from the (Sunday run|Monday review)\s*\([^)]*\)\s*$/, "").replace(/\.\s*(Post them|Swap them|Plan tab)[^.]*\.?$/, "");
      let title = text, sub = "";
      const m = text.match(/^(.{8,80}?)(:\s+|\s+—\s+)(.+)$/); if (m) { title = m[1]; sub = m[3]; }
      if (title.length > 90) { sub = (title.slice(90) + " " + sub).trim(); title = title.slice(0, 90) + "…"; }
      const ic = cls === "bad" ? '<div class="ic bad">✕</div>' : cls === "lime" ? '<div class="ic lime">!</div>' : cls === "info" ? '<div class="ic">i</div>' : '<div class="ic warn">·</div>';
      return '<div class="rw">' + ic + '<div class="t"><b>' + esc(title) + "</b>" + (sub ? "<span>" + esc(sub.slice(0, 140)) + "</span>" : "") + "</div>" + chip(cls === "bad" ? "miss" : cls === "lime" ? "today" : "", word) + "</div>";
    }).join("");
  }

  // ── ③ Execute: four numbers, one list per week, the ads, add a post ──
  function renderExec() {
    const PW = window.PW; if (!PW || !PW.S) return; const S = PW.S;
    const pair = PWM.weeks();   // the month on screen (Previous / Now / Next, shared with Create)
    const when = S.delivery && S.delivery.checkedAt ? new Date(S.delivery.checkedAt) : null;
    $("when-sexecute").textContent = PWM.label() + (when ? " · checked against Instagram and the ad account " + when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " " + when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : " · not checked yet");
    let created = 0, posted = 0, improvised = 0, missing = 0; const weeks = [];
    pair.forEach((ws, wi) => {
      const w = S.weeks && S.weeks[ws];
      if (!w) { weeks.push('<div class="card"><div class="card-label">Week of ' + esc(monLabel(ws)) + ' <span class="small muted">· ' + esc(PW.weekLabel(ws)) + '</span></div><div class="empty">Not built yet — Generate the month on Create.</div></div>'); return; }
      let wp = 0, wn = 0; const rows = []; const usedExtra = new Set();
      items(w).sort((a, b) => DAYS.indexOf(a.it.day || "Spare") - DAYS.indexOf(b.it.day || "Spare")).forEach(({ who, it, ref }) => {
        const r = PW.itemState(ws, it), st = r.st, e = r.e || {};
        if (st === "spare" && !(it.delivered || st === "posted")) return;   // spares are on Create, not here
        created++; wn++;
        let c = "";
        if (st === "posted" || st === "late") { posted++; wp++; if (e.matchedBy === "improvised") { improvised++; usedExtra.add(e.postedAt + "|" + e.title); c = chip("imp", "Improvised"); } else if (e.matchedBy === "campaign") c = chip("ok", "Live"); else c = chip("ok", st === "late" ? "Posted late" : "Posted"); }
        else if (st === "missing") { missing++; c = chip("miss", "Missing"); }
        else if (st === "today") c = chip("today", "Today"); else c = chip("", DAYS.includes(it.day) ? "Planned" : "In hand");
        const sub = [who, it.format].concat(e.postedAt ? ["posted " + dayL(e.postedAt) + (e.matchedBy === "improvised" && e.title ? " as “" + String(e.title).slice(0, 40) + "”" : "")] : [], e.views ? [Number(e.views).toLocaleString() + " views"] : []).filter(Boolean).join(" · ");
        rows.push(rw(esc(it.day || "—"), st === "missing" ? "bad" : st === "posted" || st === "late" ? "lime" : "", it.title || "", sub, c + '<div class="acts"><button title="Edit · mark posted · remove" onclick="fnEdit(' + ref + ')">✎</button></div>'));
      });
      // what else went out that week (Antonio, Nov 9): improvised posts the plan had no slot for — one tap puts them in the plan,
      // and they are already in the archive, so the brain never offers that topic again
      const end = PW.shiftWS ? PW.shiftWS(ws, 1) : ws; const extras = (S.delivery && Array.isArray(S.delivery.extras) ? S.delivery.extras : []).map((x, i) => [x, i]).filter(([x]) => x && x.date >= ws && x.date < end && !usedExtra.has(x.date + "|" + x.title));
      const also = extras.map(([x, i]) => rw(esc(dayL(x.date).split(" ")[1] ? new Date(x.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }) : "—"), "lime", x.title || "", [x.coach && x.coach !== "—" ? x.coach : "Production", x.format, "went out " + dayL(x.date)].filter(Boolean).join(" · "), chip("imp", "Not planned") + '<div class="acts"><button title="Put it in the plan as posted" data-extra="' + i + '" data-ws="' + ws + '">＋</button></div>'));
      weeks.push('<div class="card"><div class="card-label">Week of ' + esc(monLabel(ws)) + ' <span class="small muted">· ' + esc(w.weekDates || ws) + " · " + wp + " of " + wn + (w.locked ? "" : " · draft") + "</span></div>" + (rows.join("") || '<div class="empty">Nothing planned.</div>') + (also.length ? '<div class="lab" style="margin:12px 0 2px">Also went out · not in the plan</div>' + also.join("") : "") + "</div>");
    });
    // the ads: every campaign in the plan that is not ended
    const camps = (S.adPlan && Array.isArray(S.adPlan.campaigns) ? S.adPlan.campaigns : []).filter((c) => c && c.status !== "ended");
    let live = 0; const ads = camps.map((c) => { const r = PW.campState ? PW.campState(c) : { st: c.status }, e = r.e || {}; const on = r.st === "live"; if (on) live++;
      return rw("$", on ? "lime" : "", String(c.name || "").replace(/^PROWORLD\s*[—-]\s*/, "").replace(/\s*\(Leads\)$/, ""), on ? [money(e.spend7), e.leads7 != null ? e.leads7 + " leads" : "", e.cpl7 != null ? "$" + Number(e.cpl7).toFixed(0) + " each" : ""].filter(Boolean).join(" · ") : "planned " + dayL((c.window || {}).start), chip(on ? "ok" : r.st === "missing" ? "wait" : "", on ? "Live" : r.st === "missing" ? "Not live" : "Planned")); });
    ex.innerHTML = '<div class="btn-row" style="margin-bottom:12px;gap:6px"><button class="btn sm ghost" onclick="PWM.shift(-1)">‹ ' + esc(PWM.label(prevYM())) + '</button><button class="btn sm ghost" onclick="PWM.now()">This month</button><button class="btn sm ghost" onclick="PWM.shift(1)">' + esc(PWM.label(nextYM())) + ' ›</button></div>' +
      '<div class="tiles">' + tile("Created", created, PWM.label().split(" ")[0], "flat") + tile("Posted", posted, improvised ? improvised + " improvised" : "", "") + tile("Missing", missing, missing ? "carried forward" : "none", missing ? "down" : "") + tile("Ads live", live + " <small>of " + camps.length + "</small>", camps.length - live ? (camps.length - live) + " not launched" : "", camps.length - live ? "warn" : "") + "</div>" +
      '<div class="g31" style="margin-top:16px"><div style="display:grid;gap:16px">' + weeks.join("") + '</div><div style="display:grid;gap:14px;align-content:start"><div class="card"><div class="card-label">Ads</div>' + (ads.join("") || '<div class="empty">No campaigns planned.</div>') + '</div><button class="btn pri" id="exec-add" style="justify-content:center">+ Add a post that went out</button><p class="small muted" style="margin:0;text-align:center">Posts are read from Instagram every morning and matched to the plan, improvised ones too. This is for the rare one it cannot place.</p></div></div>';
    const add = $("exec-add"); if (add) add.onclick = addPost;
    ex.querySelectorAll("[data-extra]").forEach((b) => b.addEventListener("click", () => adoptExtra(b.dataset.ws, Number(b.dataset.extra))));
  }
  // an improvised post becomes a plan item, already posted (it stays in the archive and in the ledger's extras — the record is the run's)
  function adoptExtra(ws, i) {
    const PW = window.PW, S = PW.S, w = S.weeks[ws], x = (S.delivery.extras || [])[i]; if (!w || !x) return;
    const day = new Date(x.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    const fmt = /carousel/i.test(x.format || "") ? "Carousel" : /reel|video/i.test(x.format || "") ? "Reel" : /story/i.test(x.format || "") ? "Story" : "Static Post";
    const it = { id: "x_" + Date.now().toString(36), title: x.title || "Post", format: fmt, day: DAYS.includes(day) ? day : "Mon", desc: "Improvised · went out " + x.date + (x.note ? " · " + String(x.note).slice(0, 140) : ""), hook: "", delivered: true, approved: true, custom: true };
    if (x.coach && x.coach !== "—") { let c = (w.coaches || []).find((k) => k.name === x.coach); if (!c) { const def = (PW.COACHES || []).find((k) => k.name === x.coach); c = { name: x.coach, role: def ? def.role : "", ideas: [] }; w.coaches.push(c); } c.ideas.push(it); }
    else { it.pillar = "culture"; w.production.push(it); }
    PW.fnSync(ws); PW.toast("In the plan as posted");
  }
  async function addPost() {
    const PW = window.PW, S = PW.S; const pair = PWM.weeks();
    const weeks = pair.filter((ws) => S.weeks[ws]); if (!weeks.length) { PW.toast("Generate the month first", true); return; }
    const coaches = (PW.COACHES || []).map((c) => c.name);
    const r = await PW.askForm("A post that went out", [
      { key: "title", label: "What was posted", placeholder: "e.g. Soccer Saturdays — this week's session" },
      { key: "who", label: "Who", type: "select", options: ["Production"].concat(coaches), value: "Production" },
      { key: "format", label: "Format", type: "select", options: ["Reel", "Talking Head", "Carousel", "Static Post", "Story"], value: "Reel" },
      { key: "ws", label: "Week", type: "select", options: weeks.map((ws) => S.weeks[ws].weekDates || ws), value: S.weeks[weeks[0]].weekDates || weeks[0] },
      { key: "day", label: "Day", type: "select", options: DAYS.slice(0, 7), value: "Mon" }
    ], "Add as posted");
    if (!r || !r.title) return;
    const ws = weeks[Math.max(0, weeks.map((x) => S.weeks[x].weekDates || x).indexOf(r.ws))], w = S.weeks[ws];
    const it = { id: "x_" + Date.now().toString(36), title: r.title, format: r.format, day: r.day, desc: "Added by hand on Execute", hook: "", delivered: true, approved: true, custom: true };
    if (r.who === "Production") { it.pillar = "culture"; w.production.push(it); }
    else { let c = (w.coaches || []).find((x) => x.name === r.who); if (!c) { c = { name: r.who, role: "", ideas: [] }; w.coaches.push(c); } c.ideas.push(it); }
    PW.fnSync(ws); PW.toast("Added as posted");
  }

  function renderAll() { try { renderReport(); } catch (e) { console.error(e); } try { renderExec(); } catch (e) { console.error(e); } }
  if (window.PW && PW.hooks) PW.hooks.push(renderAll);
  const prevYM = () => { const [y, m] = PWM.cur.split("-").map(Number); const d = new Date(y, m - 2, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  const nextYM = () => { const [y, m] = PWM.cur.split("-").map(Number); const d = new Date(y, m, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  PWM.on(renderExec);
  renderAll();
  // live.js redraws Needs-you on its own hooks; when it does, it is already in its slot
})();
