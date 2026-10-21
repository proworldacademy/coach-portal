/* PROWORLD Marketing — Home and Ads (live.js)
   Home is the status report, live: what needs you, the Instagram numbers, this week's posts, the ads, what went out
   against the plan week by week, the ad plan, the top posts, and whether the runs ran — it prints as the report to send.
   The numbers come from numbers/<date> documents the daily numbers run writes every morning
   (Instagram and Meta ads through Metricool); until the first one exists, Home falls back to the latest Monday
   review snapshot. Also runs the Library row of the tab bar. */
(function () {
  "use strict";
  const PW = window.PW; if (!PW) return;
  const S = PW.S, esc = PW.esc, $ = (id) => document.getElementById(id);
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const num = (x) => (x === null || x === undefined || x === "" || isNaN(Number(x)) ? null : Number(x));
  const fmt = (x, d) => { const n = num(x); if (n === null) return "—"; return n.toLocaleString("en-US", { maximumFractionDigits: d === undefined ? 0 : d }); };
  const money = (x, d) => { const n = num(x); if (n === null) return "—"; return "$" + n.toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 0 : d, maximumFractionDigits: d === undefined ? 0 : d }); };
  const pct = (x) => { const n = num(x); return n === null ? "—" : n.toFixed(2) + "%"; };
  function change(now, prev, label) {
    const a = num(now), b = num(prev); if (a === null || b === null || b === 0) return label ? '<span class="chg flat">' + esc(label) + "</span>" : "";
    const p = Math.round(((a - b) / b) * 100); const cls = p > 0 ? "" : p < 0 ? " down" : " flat";
    return '<span class="chg' + cls + '">' + (p > 0 ? "+" : "") + p + "% vs the 7 days before</span>";
  }
  const dayLabel = (iso) => { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); return isNaN(d) ? String(iso || "") : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
  function latestNumbers() {
    const ids = Object.keys(S.numbers || {}).sort(); if (!ids.length) return null;
    const v = S.numbers[ids[ids.length - 1]]; return v && typeof v === "object" ? Object.assign({ id: ids[ids.length - 1] }, v) : null;
  }
  function latestKpi() { return Array.isArray(S.kpi) && S.kpi.length ? S.kpi[0] : null; }
  function latestReport(pred) { const list = Object.keys(S.reports || {}).map((k) => S.reports[k]).filter((r) => r && (!pred || pred(r))).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.at || "").localeCompare(String(a.at || ""))); return list[0] || null; }
  const sundayIso = (d) => { const s = new Date(d); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - s.getDay()); return s.getFullYear() + "-" + String(s.getMonth() + 1).padStart(2, "0") + "-" + String(s.getDate()).padStart(2, "0"); };
  function weekItems(w) {
    if (!w) return [];
    const out = [];
    (w.coaches || []).forEach((c) => (c.ideas || []).forEach((i) => out.push({ who: c.name, it: i })));
    (w.production || []).forEach((p) => out.push({ who: "Production", it: p }));
    const rank = (d) => { const k = DAYS.indexOf(d); return k < 0 ? 99 : k; };
    return out.sort((a, b) => rank(a.it.day) - rank(b.it.day));
  }

  // ── Home ──
  function renderHome() {
    if (!$("tab-home")) return;
    const N = latestNumbers(), K = latestKpi();
    const today = new Date(), todayName = DAYS[(today.getDay() + 6) % 7];
    const thisWS = sundayIso(today), next = new Date(today); next.setDate(next.getDate() + 7); const nextWS = sundayIso(next);
    const W = S.weeks || {}, wThis = W[thisWS], wNext = W[nextWS];

    // Needs you
    const attn = [];
    [[thisWS, wThis, "this week"], [nextWS, wNext, "next week"]].forEach(([ws, w, label]) => {
      if (!w) { attn.push(["info", "No plan for " + label + " (week of " + dayLabel(ws) + ") yet. The Sunday run builds the next two weeks; you can also build it on the Plan tab."]); return; }
      const items = weekItems(w), waiting = items.filter((x) => !x.it.approved && !w.locked).length;
      if (waiting) attn.push(["", waiting + " post" + (waiting > 1 ? "s" : "") + " for " + label + " waiting for approval — Plan tab."]);
    });
    // the organism: what is missing (the morning run matches every post and every live campaign to the plan)
    const lastWS = sundayIso(new Date(today.getTime() - 7 * 864e5)), wLast = W[lastWS];
    [[wThis, "this week"], [wLast, "last week"]].forEach(([w, label]) => {
      if (!w) return; const t = PW.weekTally(w);
      if (t.missing) attn.push(["bad", t.missing + " post" + (t.missing > 1 ? "s" : "") + " missing " + label + ": " + t.missingItems.slice(0, 4).map((it) => (it.day || "") + " · " + it.title).join(" — ") + (t.missingItems.length > 4 ? " …" : "") + ". Post them this week or swap them on the Plan tab."]);
    });
    const todays = weekItems(wThis).filter((x) => x.it.day === todayName);
    todays.forEach((x) => { if (!PW.isDone(thisWS, x.it)) attn.push(["lime", "Today: " + x.it.title + " (" + x.who + " · " + (x.it.format || "") + ")"]); });
    adGaps().forEach((g) => attn.push([g.cls, g.text]));
    const D = S.delivery || {}; if (D.checkedAt) { const age = (Date.now() - new Date(D.checkedAt).getTime()) / 864e5; if (age > 2.5) attn.push(["", "The posts haven't been checked against Instagram since " + dayLabel(String(D.checkedAt).slice(0, 10)) + " — the morning run should do it every day."]); }
    if (N && N.ads && N.ads.connected === false) attn.push(["info", "Meta ads aren't reaching this page yet: connect the ad account inside Metricool (Connections → Meta Ads)."]);
    if (N) { const age = (Date.now() - new Date(String(N.date || N.id) + "T12:00:00").getTime()) / 864e5; if (age > 2.5) attn.push(["", "The morning numbers haven't refreshed since " + dayLabel(N.date || N.id) + "."]); }
    const rep = latestReport((r) => (r.sections || []).some((s) => /NEEDS A HUMAN|FOR MANAGEMENT/i.test(s.h || "")));
    if (rep) { const sec = rep.sections.find((s) => /NEEDS A HUMAN|FOR MANAGEMENT/i.test(s.h || "")); (sec.lines || []).slice(0, 3).forEach((l) => attn.push(["info", String(l).replace(/^\s*[-•*]\s+/, "") + "  · from " + (rep.by === "engine" ? "the Sunday run" : rep.by === "instagram-review" ? "the Monday review" : "a report") + " (" + dayLabel(rep.date) + ")"])); }
    const order = { bad: 0, lime: 1, "": 2, info: 3 };
    attn.sort((a, b) => (order[a[0]] === undefined ? 2 : order[a[0]]) - (order[b[0]] === undefined ? 2 : order[b[0]]));
    $("home-attn").innerHTML = attn.length ? attn.slice(0, 9).map((a) => '<div class="attn"><b class="' + a[0] + '">' + (a[0] === "lime" ? "Today" : a[0] === "info" ? "Note" : a[0] === "bad" ? "Missing" : "To do") + "</b><span>" + esc(a[1]) + "</span></div>").join("") : '<div class="attn"><b class="ok">Clear</b><span>Nothing waiting on you right now.</span></div>';

    // Instagram
    let ig = null, when = "";
    if (N && N.ig) { ig = N.ig; when = "· updated " + dayLabel(N.date || N.id) + (N.range ? " · last 7 days " + dayLabel(N.range.from) + " – " + dayLabel(N.range.to) : ""); }
    else if (K && K.data) { const g = K.data; ig = { followers: g["ig-foll-now"], followersPrev: g["ig-foll-prev"], reach7: g["ig-reach-now"], reach7prev: g["ig-reach-prev"], interactions7: null, views7: null, profileVisits7: g["ig-pv-now"] }; when = "· from the Monday review of " + dayLabel(K.date) + " (the daily numbers start with the first morning run)"; }
    $("home-ig-when").textContent = when;
    if (!ig) { $("home-ig").innerHTML = '<div class="pending" style="grid-column:1/-1">No numbers yet. The daily numbers run fills this every morning at 7 from Metricool.</div>'; $("home-ig-trend").innerHTML = ""; }
    else {
      const fc = num(ig.followersChange7) !== null ? ig.followersChange7 : (num(ig.followers) !== null && num(ig.followersPrev) !== null ? num(ig.followers) - num(ig.followersPrev) : null);
      const tile = (cls, label, big, sub) => '<div class="stat' + cls + '"><div class="stat-label">' + esc(label) + '</div><div class="big-num" style="margin-top:8px">' + big + "</div>" + (sub || "") + "</div>";
      $("home-ig").innerHTML =
        tile("", "Followers", fmt(ig.followers), fc === null ? "" : '<span class="chg' + (fc < 0 ? " down" : fc === 0 ? " flat" : "") + '">' + (fc > 0 ? "+" : "") + fmt(fc) + " in 7 days</span>") +
        tile(" mint", "Views · 7 days", fmt(ig.views7), change(ig.views7, ig.views7prev)) +
        tile(" cyan", "Reach · 7 days", fmt(ig.reach7), change(ig.reach7, ig.reach7prev)) +
        tile(" orchid", "Interactions · 7 days", fmt(ig.interactions7), change(ig.interactions7, ig.interactions7prev));
      const small = [["Profile visits", ig.profileVisits7], ["Link taps", ig.linkTaps7], ["Saves", ig.saves7], ["Shares", ig.shares7], ["Posts", ig.posts7 === undefined ? null : fmt(ig.posts7) + " of 7"], ["Stories", ig.stories7]].filter((x) => x[1] !== undefined);
      const daily = (N && Array.isArray(N.igDaily)) ? N.igDaily.filter((d) => num(d.followers) !== null) : [];
      $("home-ig-trend").innerHTML = '<div class="small" style="display:flex;flex-wrap:wrap;gap:6px 18px">' + small.map((x) => "<span>" + esc(x[0]) + ": <strong>" + (typeof x[1] === "string" ? esc(x[1]) : fmt(x[1])) + "</strong></span>").join("") + "</div>" + (daily.length > 2 ? spark(daily) : "");
    }

    // Today & this week
    const items = weekItems(wThis);
    $("home-week").innerHTML = !wThis ? '<div class="pending">No plan for this week yet.</div>' : '<div class="small muted" style="margin-bottom:6px">Week of ' + esc(wThis.weekDates || dayLabel(thisWS)) + (wThis.locked ? " · approved" : " · draft") + "</div>" + items.map((x) => {
      const os = PW.itemState(thisWS, x.it).st;
      const st = os === "posted" || os === "late" || os === "missing" || os === "today" ? PW.stateChip(thisWS, x.it) : x.it.approved || wThis.locked ? '<span class="st ok">Approved</span>' : '<span class="st wait">Approve</span>';
      return '<div class="wk' + (x.it.day === todayName ? " today" : "") + '"><span class="d">' + esc(x.it.day || "") + '</span><span class="t">' + esc(x.it.title || "") + "<small>" + esc(x.who) + " · " + esc(x.it.format || "") + "</small></span>" + st + "</div>";
    }).join("") + '<div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" onclick="document.querySelector(\'.tab-btn[data-tab=fortnight]\').click()">Open the Plan →</button></div>';

    // Ads
    $("home-ads").innerHTML = adsSummary(N);

    // Top posts
    const top = N && Array.isArray(N.topPosts) ? N.topPosts : null;
    if (top && top.length) {
      $("home-top").innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Post</th><th class="n">Views</th><th class="n">Shares</th><th class="n">Saves</th><th class="n">Follows</th></tr></thead><tbody>' + top.slice(0, 8).map((p) => "<tr><td>" + esc(p.title || "") + '<div class="small muted">' + esc(dayLabel(p.date)) + " · " + esc(p.format || "") + (p.coach && p.coach !== "—" ? " · " + esc(p.coach) : "") + '</div></td><td class="n">' + fmt(p.views) + '</td><td class="n">' + fmt(p.shares) + '</td><td class="n">' + fmt(p.saves) + '</td><td class="n">' + fmt(p.follows) + "</td></tr>").join("") + "</tbody></table></div>";
    } else {
      const rv = latestReport((r) => r.by === "instagram-review"); const sec = rv && (rv.sections || []).find((s) => /WHAT WE POSTED/i.test(s.h || ""));
      $("home-top").innerHTML = sec ? '<div class="small muted" style="margin-bottom:6px">From the Monday review of ' + esc(dayLabel(rv.date)) + "</div>" + tableFromLines(sec.lines || []) : '<div class="pending">The top posts appear here after the first morning numbers run.</div>';
    }
  }
  // ── The status report on Home: what went out vs the plan, week by week since the start; the ad plan at a glance;
  // whether the runs ran. Everything here is computed from the record the runs keep — nothing is typed in by hand.
  function scoreWeek(ws, w) {
    const t = { planned: 0, posted: 0, late: 0, missing: 0, today: 0, pending: 0, spare: 0, miss: [] };
    weekItems(w).forEach((x) => { const s = PW.itemState(ws, x.it).st; if (s === "spare") { t.spare++; return; } t.planned++; if (s === "posted") t.posted++; else if (s === "late") { t.posted++; t.late++; } else if (s === "missing") { t.missing++; t.miss.push(x); } else if (s === "today") t.today++; else t.pending++; });
    return t;
  }
  function behind(t) {
    if (!t.miss.length) return '<span class="muted">—</span>';
    if (t.miss.length <= 3) return t.miss.map((x) => esc(x.who) + " · " + esc(x.it.day || "") + " · " + esc(x.it.title || "")).join("<br>");
    const by = {}; t.miss.forEach((x) => { by[x.who] = (by[x.who] || 0) + 1; });
    return Object.keys(by).sort((a, b) => by[b] - by[a]).map((k) => esc(k) + " " + by[k]).join(" · ");
  }
  function renderScore() {
    const el = $("home-score"); if (!el) return;
    const W = S.weeks || {}, thisWS = sundayIso(new Date());
    const rows = Object.keys(W).filter((ws) => ws <= thisWS && W[ws] && W[ws].weekStart).sort().map((ws) => ({ ws, w: W[ws], t: scoreWeek(ws, W[ws]) }));
    const D = S.delivery || {}, extras = Array.isArray(D.extras) ? D.extras : [];
    const when = $("home-score-when"); if (when) when.textContent = D.checkedAt ? "· checked against Instagram " + dayLabel(String(D.checkedAt).slice(0, 10)) : "";
    if (!rows.length) { el.innerHTML = '<div class="pending">No week planned yet — the score starts with the first plan (Plan tab, or the Sunday run).</div>'; return; }
    const tot = rows.reduce((a, r) => { a.planned += r.t.planned; a.posted += r.t.posted; a.missing += r.t.missing; return a; }, { planned: 0, posted: 0, missing: 0 });
    let h = '<p class="sum">Since ' + esc(PW.fmtDay(rows[0].ws)) + ": <strong>" + tot.posted + " of " + tot.planned + "</strong> planned posts went out, " + (tot.missing ? '<strong style="color:var(--bad,#F06A5E)">' + tot.missing + " missing</strong>" : "<strong>none missing</strong>") + (extras.length ? ", and " + extras.length + " post" + (extras.length > 1 ? "s" : "") + " went out that " + (extras.length > 1 ? "were" : "was") + " not in the plan" : "") + ".</p>";
    h += '<div class="tbl-wrap"><table class="tbl score"><thead><tr><th>Week</th><th class="n">Planned</th><th class="n">Went out</th><th class="n">Missing</th><th>Who is behind</th></tr></thead><tbody>';
    rows.forEach((r) => { const t = r.t, now = r.ws === thisWS; h += '<tr class="' + (now ? "now" : "") + '"><td><span class="wk-n">' + esc(r.w.weekDates || dayLabel(r.ws)) + "</span>" + (now ? '<div class="small muted">this week · ' + t.pending + " to come" + (t.today ? " · " + t.today + " today" : "") + "</div>" : "") + '</td><td class="n">' + t.planned + '</td><td class="n good">' + t.posted + (t.late ? ' <span class="small muted">(' + t.late + " late)</span>" : "") + '</td><td class="n' + (t.missing ? " bad" : "") + '">' + t.missing + '</td><td class="small">' + behind(t) + "</td></tr>"; });
    h += "</tbody></table></div>";
    if (extras.length) h += '<div class="small muted" style="margin-top:8px">Not in the plan: ' + extras.slice(0, 6).map((x) => esc(dayLabel(x.date)) + " · " + esc(x.title || "")).join(" — ") + (extras.length > 6 ? " …" : "") + "</div>";
    h += '<div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" onclick="document.querySelector(\'.tab-btn[data-tab=assignments]\').click()">Open the weeks →</button></div>';
    el.innerHTML = h;
  }
  function renderHomeAdPlan() {
    const el = $("home-adplan"); if (!el) return;
    const o = { missing: 0, live: 1, planned: 2, paused: 3, ended: 4 };
    const list = camps().filter((c) => campState(c).st !== "ended").sort((a, b) => (o[campState(a).st] - o[campState(b).st]) || String((a.window || {}).start || "").localeCompare(String((b.window || {}).start || "")));
    if (!list.length) { el.innerHTML = '<div class="pending">No campaigns planned yet — the Sunday run builds the plan from the season calendar; add one on the Ads tab.</div>'; return; }
    const isReady = (x) => /ready|live|posted|done/i.test(x.status || "");
    let h = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Campaign</th><th>Status</th><th>Runs</th><th>Phase now</th><th>Creatives</th></tr></thead><tbody>';
    list.forEach((c) => {
      const r = campState(c), e = r.e, ph = phaseNow(c), w = c.window || {}, cr = c.creatives || [], ready = cr.filter(isReady).length, todo = cr.filter((x) => !isReady(x));
      h += "<tr><td><strong>" + esc(c.name || "") + "</strong>" + (c.program ? '<div class="small muted">' + esc(c.program) + (c.type ? " · " + esc(c.type) : "") + "</div>" : "") + "</td><td>" + stChip(r.st) + (e && e.spend7 != null ? '<div class="small muted">' + money(e.spend7) + " · " + fmt(e.leads7) + " leads" + (e.cpl7 != null ? " · " + money(e.cpl7, 2) + " each" : "") + "</div>" : "") + "</td><td>" + (w.start ? esc(dayLabel(w.start)) + " → " + esc(w.end ? dayLabel(w.end) : "open") : "—") + "</td><td>" + (ph ? esc(ph.name || ph.type || "") + (ph.end ? '<div class="small muted">to ' + esc(dayLabel(ph.end)) + "</div>" : "") : "—") + "</td><td>" + (cr.length ? ready + " of " + cr.length + " ready" + (todo.length ? '<div class="small muted">to make: ' + todo.slice(0, 2).map((x) => esc(x.title || "")).join(", ") + (todo.length > 2 ? " …" : "") + "</div>" : "") : '<span class="small muted">none yet</span>') + "</td></tr>";
    });
    h += "</tbody></table></div>";
    const ended = camps().length - list.length;
    h += '<div class="btn-row" style="margin-top:10px;align-items:center"><button class="btn ghost sm" onclick="document.querySelector(\'.tab-btn[data-tab=ads]\').click()">The ad plan in full →</button>' + (ended ? '<span class="small muted">' + ended + " ended</span>" : "") + "</div>";
    el.innerHTML = h;
  }
  // the three runs: when each last ran, from what it leaves in the record (the ledger's checkedAt and the numbers for the
  // morning check, the reports for the Monday review and the Sunday engine)
  const RUNS = [
    { name: "The morning check", when: "every day, 6:54 AM", days: 1, last: () => { const D = S.delivery || {}, N = latestNumbers(); const a = D.checkedAt ? String(D.checkedAt).slice(0, 10) : "", b = N ? String(N.date || N.id).slice(0, 10) : ""; return a > b ? a : b; }, does: "Reads yesterday's Instagram and ad numbers, matches every post of the last 7 days to the plan, marks posted / missing, checks which campaigns are live, keeps the archive complete." },
    { name: "The Monday review", when: "Mondays, 8:52 AM", days: 7, last: () => { const r = latestReport((x) => x.by === "instagram-review"); return r ? String(r.date).slice(0, 10) : ""; }, does: "The week's scoreboard, the watchlist and the competitors' ads, what parents are asking, three moves for the week — on the Reports tab." },
    { name: "The Sunday engine", when: "Sundays, 5:52 PM", days: 7, last: () => { const r = latestReport((x) => x.by === "engine"); return r ? String(r.date).slice(0, 10) : ""; }, does: "Reads what worked, refills the idea banks, builds the next two weeks (what was missed first), keeps the season calendar and the ad plan — on the Reports tab." }
  ];
  function renderRuns() {
    const el = $("home-runs"); if (!el) return;
    el.innerHTML = RUNS.map((r) => {
      const last = r.last(), age = last ? Math.round((new Date(todayIso() + "T12:00:00") - new Date(last + "T12:00:00")) / 864e5) : null;
      const cls = age === null ? "off" : age <= r.days ? "" : age <= r.days * 2 ? "warn" : "bad";
      const txt = age === null ? "hasn't run yet" : age <= 0 ? "ran today" : age === 1 ? "ran yesterday" : "last ran " + dayLabel(last) + (cls === "bad" ? " — overdue, tell Antonio" : "");
      return '<div class="run"><i class="' + cls + '"></i><div><b>' + esc(r.name) + ' <span class="small muted" style="font-weight:400">· ' + esc(r.when) + "</span></b>" + esc(txt) + "<small>" + esc(r.does) + "</small></div></div>";
    }).join("") + '<div class="small muted" style="margin-top:8px">The runs work in the cloud on their own — no computer or app needs to be open.</div>';
    const ph = $("home-print-head"); if (ph) ph.textContent = "PROWORLD Marketing · status report · " + new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function tableFromLines(lines) {
    const rows = lines.filter((l) => /^\|/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim())).filter((c) => !c.every((x) => /^:?-+:?$/.test(x)));
    const rest = lines.filter((l) => !/^\|/.test(l));
    if (!rows.length) return rest.map((l) => '<div class="small">' + esc(l) + "</div>").join("");
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + rows[0].map((c) => "<th>" + esc(c) + "</th>").join("") + "</tr></thead><tbody>" + rows.slice(1).map((r) => "<tr>" + r.map((c) => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>" + rest.map((l) => '<div class="small" style="margin-top:6px">' + esc(String(l).replace(/^\s*[-•*]\s+/, "")) + "</div>").join("");
  }
  function spark(daily) {
    const pts = daily.slice(-30), vals = pts.map((d) => num(d.followers)); const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = max - min || 1;
    const W = 600, H = 64, pad = 4; const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, pts.length - 1), y = (v) => H - pad - ((v - min) / span) * (H - pad * 2 - 12);
    const d = vals.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const last = vals.length - 1;
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Followers over the last ' + pts.length + ' days, from ' + fmt(vals[0]) + " to " + fmt(vals[last]) + '"><path d="' + d + " L" + x(last).toFixed(1) + " " + H + " L" + x(0).toFixed(1) + " " + H + ' Z" fill="#E2FE78" fill-opacity=".35"/><path d="' + d + '" fill="none" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="' + x(last).toFixed(1) + '" cy="' + y(vals[last]).toFixed(1) + '" r="3.5" fill="#000"/></svg><div class="small muted">Followers, last ' + pts.length + " days: " + fmt(vals[0]) + " → " + fmt(vals[last]) + "</div>";
  }
  function adsSummary(N) {
    const A = N && N.ads;
    if (!A) return '<div class="pending">The ads appear here after the first morning numbers run (every day at 7).</div>';
    if (A.connected === false) return '<div class="pending">' + esc(A.note || "Meta ads aren't connected to Metricool yet.") + '</div><div class="small" style="margin-top:8px">Fix: in Metricool, open Connections and connect <strong>Meta Ads</strong> (the ad account, not just the Facebook page). The next morning run reads it.</div>';
    const tile = (label, v, cls) => '<div class="stat' + (cls || "") + '"><div class="stat-label">' + esc(label) + '</div><div class="big-num" style="font-size:30px;margin-top:6px">' + v + "</div></div>";
    return '<div class="grid-2" style="gap:10px">' + tile("Spent", money(A.spend7)) + tile("Leads", fmt(A.leads7), " mint") + tile("Cost per lead", money(A.cpl7, 2), " cyan") + tile("Active campaigns", fmt(A.activeCampaigns), " orchid") + "</div>" + (A.bestAd ? '<div class="small" style="margin-top:10px">Best ad: <strong>' + esc(A.bestAd.name || "") + "</strong>" + (A.bestAd.leads7 !== undefined ? " · " + fmt(A.bestAd.leads7) + " leads" : "") + (A.bestAd.cpl7 !== undefined && A.bestAd.cpl7 !== null ? " at " + money(A.bestAd.cpl7, 2) : "") + "</div>" : "") + '<div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" onclick="document.querySelector(\'.tab-btn[data-tab=ads]\').click()">All campaigns →</button></div>';
  }

  // ── The ad plan: the ads mirror the posts ──
  // One campaign per program or event (Thanksgiving Camp, Winter Camp, Afterschool, Soccer…), with its window, its phases
  // (early bird → launch → last spots) and its creatives. The Sunday engine builds and refreshes it from the calendar, from
  // what the competitors run (adWatch) and from our own cost per lead; the morning run checks which campaigns are live.
  const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const AD_TYPES = ["commercial", "early bird", "discount", "last spots", "trial", "always-on", "vibes"];
  const camps = () => (S.adPlan && Array.isArray(S.adPlan.campaigns) ? S.adPlan.campaigns : []);
  const events = () => (S.calendar && Array.isArray(S.calendar.events) ? S.calendar.events.slice().sort((a, b) => String(a.start).localeCompare(String(b.start))) : []);
  const adDelivery = (c) => (S.delivery && S.delivery.ads && S.delivery.ads[c.id]) || null;
  const daysTo = (iso) => Math.round((new Date(String(iso) + "T12:00:00") - new Date(todayIso() + "T12:00:00")) / 864e5);
  // the campaign's state today: live | missing | planned | ended | paused — what the morning run wrote, else from the window
  function campState(c) {
    const e = adDelivery(c), t = todayIso(), w = c.window || {};
    if (c.status === "ended" || (w.end && w.end < t)) return { st: "ended", e };
    if (e && e.status === "live") return { st: "live", e };
    if (c.status === "paused") return { st: "paused", e };
    if (w.start && w.start <= t) return { st: e && e.status === "missing" ? "missing" : c.status === "live" && !e ? "live" : "missing", e };
    return { st: "planned", e };
  }
  function phaseNow(c) { const t = todayIso(); return (c.phases || []).find((p) => p.start && p.start <= t && (p.end || p.start) >= t) || null; }
  const stChip = (st) => st === "live" ? '<span class="st on">Live</span>' : st === "missing" ? '<span class="st miss">✕ Not live</span>' : st === "ended" ? '<span class="st end">Ended</span>' : st === "paused" ? '<span class="st wait">Paused</span>' : '<span class="st plan">Planned</span>';
  // what the Home page says about the ads
  function adGaps() {
    const out = [];
    camps().forEach((c) => {
      const r = campState(c), w = c.window || {};
      if (r.st === "missing") out.push({ cls: "bad", text: "Ad not live: " + c.name + " should be running since " + dayLabel(w.start) + " — nothing matched in the ad account. Launch it in Ads Manager or move its start on the Ads tab." });
      else if (r.st === "planned" && w.start && daysTo(w.start) <= 7) { const cr = c.creatives || [], ready = cr.filter((x) => /ready|live|posted|done/i.test(x.status || "")).length; out.push({ cls: cr.length && ready < cr.length ? "" : "info", text: "Ad starts " + dayLabel(w.start) + ": " + c.name + (cr.length ? " — " + ready + " of " + cr.length + " creatives ready" : " — no creatives listed yet") + "." }); }
    });
    events().forEach((ev) => { if (ev.adsFrom && daysTo(ev.adsFrom) >= 0 && daysTo(ev.adsFrom) <= 14 && !camps().some((c) => (c.event || "") === ev.id || new RegExp(ev.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(c.name || ""))) out.push({ cls: "", text: "No campaign planned for " + ev.name + " yet — its ads should start " + dayLabel(ev.adsFrom) + ". The Sunday run builds it; you can add it on the Ads tab." }); });
    return out;
  }
  function renderAdPlan() {
    const el = $("ad-plan"); if (!el) return;
    const list = camps().slice().sort((a, b) => { const ra = campState(a).st, rb = campState(b).st; const o = { missing: 0, live: 1, planned: 2, paused: 3, ended: 4 }; return (o[ra] - o[rb]) || String((a.window || {}).start || "").localeCompare(String((b.window || {}).start || "")); });
    const P = S.adPlan || {};
    let h = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="card-label" style="margin:0">The ad plan · ' + list.filter((c) => campState(c).st !== "ended").length + ' campaign' + (list.filter((c) => campState(c).st !== "ended").length === 1 ? "" : "s") + '</div><div class="btn-row"><button class="btn ghost sm" onclick="addCampaign()">+ Add a campaign</button></div></div>';
    h += '<div class="small muted" style="margin-top:6px">Built from the season calendar and from when the competitors start their ads: for every program or camp, a campaign with its window, its phases (early bird → launch → last spots) and its creatives — the ad video the photographer shoots that week plus statics and carousels. Checked every morning against the ad account: live, not live, ended.' + (P.updatedAt ? " Last built " + esc(dayLabel(String(P.updatedAt).slice(0, 10))) + (P.by ? " by " + esc(P.by) : "") + "." : "") + "</div>";
    if (!list.length) h += '<div class="pending" style="margin-top:12px">No campaigns planned yet. The Sunday run builds the plan from the calendar (Thanksgiving Camp, Winter Camp, the programs) and from what the competitors are running; add one here any time.</div>';
    list.forEach((c) => {
      const r = campState(c), e = r.e, ph = phaseNow(c), w = c.window || {}, cr = c.creatives || [];
      h += '<div class="camp ' + (r.st === "live" ? "on" : r.st === "missing" ? "miss" : "") + '"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div style="min-width:0"><div class="item-title" style="font-size:15px">' + esc(c.name || "") + " " + stChip(r.st) + (c.type ? ' <span class="st">' + esc(c.type) + "</span>" : "") + '</div><div class="small muted">' + esc(c.program || "") + (w.start ? " · " + esc(dayLabel(w.start)) + " → " + esc(w.end ? dayLabel(w.end) : "open") : " · no dates yet") + (c.audience ? " · " + esc(c.audience) : "") + (c.budgetHint ? " · " + esc(c.budgetHint) : "") + "</div></div>" +
        '<div class="btn-row" style="gap:4px"><button class="btn ghost xs" onclick="editCampaign(\'' + esc(c.id) + '\')">✎ Edit</button><button class="btn ghost xs" onclick="addCreative(\'' + esc(c.id) + '\')">+ Creative</button>' + (r.st !== "ended" ? '<button class="btn ghost xs muted" onclick="endCampaign(\'' + esc(c.id) + '\')">End</button>' : "") + "</div></div>";
      if (c.offer) h += '<div class="small" style="margin-top:6px"><strong>Offer:</strong> ' + esc(c.offer) + "</div>";
      if ((c.phases || []).length) h += '<div class="ph">' + c.phases.map((p) => '<span class="' + (ph && ph === p ? "now" : "") + '" title="' + esc((p.offer || "") + (p.type ? " · " + p.type : "")) + '">' + esc(p.name || p.type || "phase") + " · " + esc(dayLabel(p.start)) + (p.end ? " – " + esc(dayLabel(p.end)) : "") + "</span>").join("") + "</div>";
      if (e && (e.campaign || e.spend7 != null)) h += '<div class="small" style="margin-top:8px">' + (e.campaign ? "In the ad account as <strong>" + esc(e.campaign) + "</strong>" : "") + (e.spend7 != null ? " · spent " + money(e.spend7) + " in 7 days" : "") + (e.leads7 != null ? " · " + fmt(e.leads7) + " leads" : "") + (e.cpl7 != null ? " · " + money(e.cpl7, 2) + " per lead" : "") + (e.firstSeen ? " · first seen " + esc(dayLabel(e.firstSeen)) : "") + "</div>";
      if (r.st === "missing" && e && e.note) h += '<div class="small" style="margin-top:6px;color:var(--bad,#F06A5E)">' + esc(e.note) + "</div>";
      if (cr.length) h += '<div style="margin-top:10px">' + cr.map((x, i) => '<div class="cr"><span style="min-width:0"><strong>' + esc(x.title || "") + "</strong>" + (x.format ? ' <span class="small muted">· ' + esc(x.format) + "</span>" : "") + (x.hook ? '<div class="small muted">' + esc(x.hook) + "</div>" : "") + (x.headline ? '<div class="small">' + esc(x.headline) + (x.cta ? " · " + esc(x.cta) : "") + "</div>" : "") + '</span><span class="btn-row" style="gap:4px;flex-shrink:0"><span class="st ' + (/live|posted/i.test(x.status || "") ? "on" : /ready|done/i.test(x.status || "") ? "ok" : "") + '">' + esc(x.status || "to make") + '</span><button class="btn ghost xs" onclick="editCreative(\'' + esc(c.id) + "'," + i + ')">✎</button></span></div>').join("") + "</div>";
      if (c.note) h += '<div class="small muted" style="margin-top:8px">' + esc(c.note) + "</div>";
      h += "</div>";
    });
    el.innerHTML = h + "</div>";
  }
  function renderAdWatch() {
    const el = $("ad-watch"); if (!el) return;
    const log = Array.isArray(S.adWatch) ? S.adWatch : [], last = log[0];
    let h = '<div class="card"><div class="card-label orchid">What the competitors are running</div><div class="small muted" style="margin-top:4px">Read every Monday with AdWhispr: who is advertising, how many ads, when the newest started, what kind of offer (early bird, discount, last spots, commercial, vibes), for which program — and how many weeks before the event. The Sunday run times our campaigns from it.</div>';
    if (!last) h += '<div class="pending" style="margin-top:12px">Nothing read yet — the first read is the Monday review of Oct 26.</div>';
    else {
      const rows = Array.isArray(last.rows) ? last.rows : [];
      h += '<div class="small muted" style="margin-top:8px">As of ' + esc(dayLabel(last.date)) + (last.by ? " · " + esc(last.by) : "") + "</div>";
      h += rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Brand</th><th class="n">Active ads</th><th>Newest started</th><th>Type</th><th>Offer</th><th>Program</th><th>Format</th><th>Note</th></tr></thead><tbody>' + rows.map((r) => "<tr><td><strong>" + esc(r.brand || r.handle || "") + "</strong>" + (r.handle && r.brand ? '<div class="small muted">@' + esc(r.handle) + "</div>" : "") + '</td><td class="n">' + (r.active == null ? "—" : fmt(r.active)) + "</td><td>" + (r.newestStart ? esc(dayLabel(r.newestStart)) + (r.weeksBefore != null ? '<div class="small muted">' + esc(r.weeksBefore) + " wks before</div>" : "") : "—") + "</td><td>" + esc(r.type || "—") + "</td><td>" + esc(r.offer || "—") + "</td><td>" + esc(r.program || "—") + "</td><td>" + esc(r.format || "—") + "</td><td class=\"small\">" + esc(r.note || "") + "</td></tr>").join("") + "</tbody></table></div>" : '<div class="pending">The last read found no competitor ads.</div>';
      if (last.headline) h += '<div class="small" style="margin-top:8px"><strong>' + esc(last.headline) + "</strong></div>";
      if (log.length > 1) h += '<div class="small muted" style="margin-top:6px">' + (log.length - 1) + " earlier read" + (log.length > 2 ? "s" : "") + " kept in memory</div>";
    }
    el.innerHTML = h + "</div>";
  }
  function renderAdCal() {
    const el = $("ad-cal"); if (!el) return;
    const list = events().filter((ev) => !ev.end || ev.end >= todayIso());
    let h = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="card-label cyan" style="margin:0">The season — when the posts and the ads start</div><div class="btn-row"><button class="btn ghost sm" onclick="addEvent()">+ Add an event</button></div></div><div class="small muted" style="margin-top:4px">Camps, breaks, tournaments and enrollment windows. For each: when its posts start and when its ads start — the engine builds the week and the campaign from these dates. ' + (S.calendar && S.calendar.updatedAt ? "Updated " + esc(dayLabel(String(S.calendar.updatedAt).slice(0, 10))) + (S.calendar.by ? " by " + esc(S.calendar.by) : "") + "." : "") + "</div>";
    if (!list.length) h += '<div class="pending" style="margin-top:12px">No events yet. The Sunday run fills the season from the website and the school calendar; add one here any time.</div>';
    else h += '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Event</th><th>When</th><th>Posts from</th><th>Ads from</th><th class="n">Days to go</th><th></th></tr></thead><tbody>' + list.map((ev) => { const d = daysTo(ev.start); return "<tr><td><strong>" + esc(ev.name) + "</strong>" + (ev.kind ? ' <span class="st">' + esc(ev.kind) + "</span>" : "") + (ev.note ? '<div class="small muted">' + esc(ev.note) + "</div>" : "") + "</td><td>" + esc(dayLabel(ev.start)) + (ev.end && ev.end !== ev.start ? " – " + esc(dayLabel(ev.end)) : "") + "</td><td>" + (ev.postsFrom ? esc(dayLabel(ev.postsFrom)) + (daysTo(ev.postsFrom) <= 0 ? ' <span class="st ok">on</span>' : "") : "—") + "</td><td>" + (ev.adsFrom ? esc(dayLabel(ev.adsFrom)) + (daysTo(ev.adsFrom) <= 0 ? ' <span class="st ok">on</span>' : "") : "—") + '</td><td class="n">' + (d < 0 ? "now" : d) + '</td><td class="n"><span class="btn-row" style="gap:4px;justify-content:flex-end"><button class="btn ghost xs" onclick="editEvent(\'' + esc(ev.id) + '\')">✎</button><button class="btn ghost xs muted" onclick="removeEvent(\'' + esc(ev.id) + '\')">×</button></span></td></tr>'; }).join("") + "</tbody></table></div>";
    el.innerHTML = h + "</div>";
  }
  // ── editing the plan and the season by hand (the runs do the same through the database)
  const stamp = (key, by) => { S[key] = Object.assign({}, S[key] || {}, { updatedAt: new Date().toISOString(), by: by || "team" }); };
  const campFields = (c) => [{ key: "name", label: "Campaign name (as it will be named in Ads Manager)", value: c.name || "" }, { key: "program", label: "Program or event it sells", value: c.program || "" }, { key: "type", label: "Type", type: "select", options: AD_TYPES.includes(c.type) ? AD_TYPES : [c.type || "commercial"].concat(AD_TYPES), value: c.type || "commercial" }, { key: "start", label: "Starts (YYYY-MM-DD)", value: (c.window || {}).start || "" }, { key: "end", label: "Ends (YYYY-MM-DD, blank = always on)", value: (c.window || {}).end || "" }, { key: "offer", label: "The offer in one line", value: c.offer || "" }, { key: "audience", label: "Audience", value: c.audience || "" }, { key: "budgetHint", label: "Budget hint", value: c.budgetHint || "" }, { key: "phases", label: "Phases — one per line: name · start · end · type · offer", type: "textarea", rows: 3, value: (c.phases || []).map((p) => [p.name, p.start, p.end, p.type, p.offer].map((x) => x || "").join(" · ")).join("\n") }, { key: "note", label: "Notes", type: "textarea", rows: 2, value: c.note || "" }];
  const parsePhases = (txt) => String(txt || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const p = l.split("·").map((x) => x.trim()); return { name: p[0] || "", start: p[1] || "", end: p[2] || "", type: p[3] || "", offer: p[4] || "" }; });
  const fromForm = (c, r) => Object.assign(c, { name: r.name, program: r.program, type: r.type, window: { start: r.start, end: r.end }, offer: r.offer, audience: r.audience, budgetHint: r.budgetHint, phases: parsePhases(r.phases), note: r.note });
  window.addCampaign = async function () { const r = await PW.askForm("New campaign", campFields({}), "Add campaign", "The morning run checks it against the ad account from its start date; the Sunday run fills its creatives and copy."); if (!r || !r.name) return; S.adPlan = S.adPlan || { campaigns: [] }; S.adPlan.campaigns = S.adPlan.campaigns || []; S.adPlan.campaigns.push(fromForm({ id: "cmp_" + Date.now(), status: "planned", creatives: [], by: "team", at: new Date().toISOString() }, r)); stamp("adPlan"); PW.save("adPlan"); render(); PW.toast("Campaign added to the plan"); };
  window.editCampaign = async function (id) { const c = camps().find((x) => x.id === id); if (!c) return; const r = await PW.askForm("Edit — " + c.name, campFields(c), "Save"); if (!r || !r.name) return; fromForm(c, r); stamp("adPlan"); PW.save("adPlan"); render(); };
  window.endCampaign = async function (id) { const c = camps().find((x) => x.id === id); if (!c) return; if (!(await PW.askConfirm("End " + c.name, "Mark this campaign as ended? It stays in the plan as history.", "End it"))) return; c.status = "ended"; c.window = Object.assign({}, c.window || {}, { end: (c.window || {}).end && (c.window || {}).end < todayIso() ? (c.window || {}).end : todayIso() }); stamp("adPlan"); PW.save("adPlan"); render(); };
  const crFields = (x) => [{ key: "title", label: "Creative", value: x.title || "" }, { key: "format", label: "Format", type: "select", options: ["Ad Video", "Static Post", "Carousel", "Reel", "Story"], value: x.format || "Ad Video" }, { key: "hook", label: "Hook (first 2 seconds / first line)", value: x.hook || "" }, { key: "headline", label: "Headline", value: x.headline || "" }, { key: "primary", label: "Primary text", type: "textarea", rows: 3, value: x.primary || "" }, { key: "cta", label: "Call to action", value: x.cta || "Come Try It Out" }, { key: "status", label: "Status", type: "select", options: ["to make", "filming", "ready", "live", "retired"], value: x.status || "to make" }];
  window.addCreative = async function (id) { const c = camps().find((x) => x.id === id); if (!c) return; const r = await PW.askForm("New creative — " + c.name, crFields({}), "Add"); if (!r || !r.title) return; (c.creatives = c.creatives || []).push(Object.assign({ id: "cr_" + Date.now() }, r)); stamp("adPlan"); PW.save("adPlan"); render(); };
  window.editCreative = async function (id, i) { const c = camps().find((x) => x.id === id); if (!c || !c.creatives || !c.creatives[i]) return; const r = await PW.askForm("Creative — " + c.name, crFields(c.creatives[i]), "Save"); if (!r || !r.title) return; Object.assign(c.creatives[i], r); stamp("adPlan"); PW.save("adPlan"); render(); };
  const evFields = (ev) => [{ key: "name", label: "Event", value: ev.name || "" }, { key: "kind", label: "Kind", type: "select", options: ["camp", "break", "tournament", "enrollment", "holiday", "other"], value: ev.kind || "camp" }, { key: "start", label: "Starts (YYYY-MM-DD)", value: ev.start || "" }, { key: "end", label: "Ends (YYYY-MM-DD)", value: ev.end || "" }, { key: "postsFrom", label: "Posts start (YYYY-MM-DD)", value: ev.postsFrom || "" }, { key: "adsFrom", label: "Ads start (YYYY-MM-DD)", value: ev.adsFrom || "" }, { key: "note", label: "Note (ages, price, link)", value: ev.note || "" }];
  window.addEvent = async function () { const r = await PW.askForm("New event", evFields({}), "Add"); if (!r || !r.name || !r.start) return; S.calendar = S.calendar || { events: [] }; S.calendar.events = S.calendar.events || []; S.calendar.events.push(Object.assign({ id: "ev_" + Date.now(), by: "team" }, r)); stamp("calendar"); PW.save("calendar"); render(); if (window.renderAll) window.renderAll(); };
  window.editEvent = async function (id) { const ev = events().find((x) => x.id === id); if (!ev) return; const r = await PW.askForm("Edit — " + ev.name, evFields(ev), "Save"); if (!r || !r.name) return; Object.assign(ev, r); stamp("calendar"); PW.save("calendar"); render(); if (window.renderAll) window.renderAll(); };
  window.removeEvent = async function (id) { const ev = events().find((x) => x.id === id); if (!ev) return; if (!(await PW.askConfirm("Remove " + ev.name, "Take this event off the season calendar?", "Remove", true))) return; S.calendar.events = S.calendar.events.filter((x) => x.id !== id); stamp("calendar"); PW.save("calendar"); render(); if (window.renderAll) window.renderAll(); };

  // ── Ads tab ──
  function renderAdsLive() {
    const el = $("ads-live"); if (!el) return;
    const N = latestNumbers(), A = N && N.ads;
    if (!A) { el.innerHTML = '<div class="card"><div class="pending">The first morning numbers run hasn\'t happened yet. From then on, every campaign shows here with yesterday\'s numbers.</div></div>'; return; }
    if (A.connected === false) { el.innerHTML = '<div class="card"><div class="card-label orchid">Not connected yet</div><div class="pending">' + esc(A.note || "") + '</div><div class="small" style="margin-top:8px">In Metricool: Connections → <strong>Meta Ads</strong> → choose the ProWorld ad account. The next morning run picks it up.</div></div>'; return; }
    const tile = (label, v, sub, cls) => '<div class="stat' + (cls || "") + '"><div class="stat-label">' + esc(label) + '</div><div class="big-num" style="margin-top:8px">' + v + '</div><div class="stat-sub">' + esc(sub || "") + "</div></div>";
    const camps = Array.isArray(A.campaigns) ? A.campaigns.slice().sort((a, b) => (num(b.spend7) || 0) - (num(a.spend7) || 0)) : [];
    el.innerHTML = '<div class="grid-4" style="margin-bottom:16px">' + tile("Spent · 7 days", money(A.spend7), "30 days: " + money(A.spend30)) + tile("Leads · 7 days", fmt(A.leads7), "30 days: " + fmt(A.leads30), " mint") + tile("Cost per lead", money(A.cpl7, 2), "30 days: " + money(A.cpl30, 2), " cyan") + tile("Active campaigns", fmt(A.activeCampaigns), "updated " + dayLabel(N.date || N.id), " orchid") + "</div>"
      + '<div class="card"><div class="card-label">Campaigns</div>' + (camps.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Campaign</th><th>Status</th><th class="n">Spent 7d</th><th class="n">Results 7d</th><th class="n">Leads 7d</th><th class="n">Cost / lead</th><th class="n">CTR</th><th class="n">Spent 30d</th><th class="n">Leads 30d</th></tr></thead><tbody>' + camps.map((c) => "<tr><td><strong>" + esc(c.name || "") + '</strong><div class="small muted">' + esc(c.objective || "") + (c.resultLabel ? " · results = " + esc(c.resultLabel) : "") + "</div></td><td>" + esc(c.status || "") + '</td><td class="n">' + money(c.spend7) + '</td><td class="n">' + fmt(c.results7) + '</td><td class="n">' + fmt(c.leads7) + '</td><td class="n">' + money(c.cpl7, 2) + '</td><td class="n">' + pct(c.ctr7) + '</td><td class="n">' + money(c.spend30) + '</td><td class="n">' + fmt(c.leads30) + "</td></tr>").join("") + "</tbody></table></div>" : '<div class="pending">No campaigns ran in the last 30 days.</div>') + "</div>"
      + (A.bestAd ? '<div class="card"><div class="card-label mint">Best ad this week</div><div><strong>' + esc(A.bestAd.name || "") + '</strong> <span class="small muted">' + esc(A.bestAd.campaign || "") + '</span></div><div class="small" style="margin-top:6px">Spent ' + money(A.bestAd.spend7) + " · " + fmt(A.bestAd.leads7) + " leads · " + money(A.bestAd.cpl7, 2) + " per lead · CTR " + pct(A.bestAd.ctr7) + "</div></div>" : "")
      + '<div class="btn-row" style="margin-bottom:16px"><a class="btn ghost sm" href="https://adsmanager.facebook.com/" target="_blank" rel="noopener">Open Ads Manager ↗</a><a class="btn ghost sm" href="https://app.pipedrive.com" target="_blank" rel="noopener">Leads in Pipedrive ↗</a></div>';
  }

  // ── Library row: the less-used tabs, one click away ──
  function bindLibrary() {
    const btn = $("lib-btn"), row = $("lib-row"); if (!btn || !row) return;
    const open = (on) => { row.hidden = !on; btn.setAttribute("aria-expanded", on ? "true" : "false"); };
    btn.addEventListener("click", () => open(row.hidden));
    document.querySelectorAll("#nav .tab-btn").forEach((b) => b.addEventListener("click", () => { open(false); btn.classList.remove("on"); }));
    row.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => { btn.classList.add("on"); }));
  }
  function render() { try { renderHome(); } catch (e) { console.error("home", e); } try { renderScore(); } catch (e) { console.error("score", e); } try { renderHomeAdPlan(); } catch (e) { console.error("home ad plan", e); } try { renderRuns(); } catch (e) { console.error("runs", e); } try { renderAdPlan(); } catch (e) { console.error("ad plan", e); } try { renderAdsLive(); } catch (e) { console.error("ads", e); } try { renderAdWatch(); } catch (e) { console.error("ad watch", e); } try { renderAdCal(); } catch (e) { console.error("ad calendar", e); } }
  PW.hooks.push(render);
  bindLibrary(); render();
})();
