/* PROWORLD Marketing — Home and Ads (live.js)
   Home is what a marketing person needs first: what needs you, the Instagram numbers, this week's posts, the ads,
   the top posts. The numbers come from numbers/<date> documents the daily numbers run writes every morning
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
    const todays = weekItems(wThis).filter((x) => x.it.day === todayName);
    todays.forEach((x) => { if (!x.it.delivered) attn.push(["lime", "Today: " + x.it.title + " (" + x.who + " · " + (x.it.format || "") + ")"]); });
    if (N && N.ads && N.ads.connected === false) attn.push(["info", "Meta ads aren't reaching this page yet: connect the ad account inside Metricool (Connections → Meta Ads)."]);
    if (N) { const age = (Date.now() - new Date(String(N.date || N.id) + "T12:00:00").getTime()) / 864e5; if (age > 2.5) attn.push(["", "The morning numbers haven't refreshed since " + dayLabel(N.date || N.id) + "."]); }
    const rep = latestReport((r) => (r.sections || []).some((s) => /NEEDS A HUMAN|FOR MANAGEMENT/i.test(s.h || "")));
    if (rep) { const sec = rep.sections.find((s) => /NEEDS A HUMAN|FOR MANAGEMENT/i.test(s.h || "")); (sec.lines || []).slice(0, 3).forEach((l) => attn.push(["info", String(l).replace(/^\s*[-•*]\s+/, "") + "  · from " + (rep.by === "engine" ? "the Sunday run" : rep.by === "instagram-review" ? "the Monday review" : "a report") + " (" + dayLabel(rep.date) + ")"])); }
    $("home-attn").innerHTML = attn.length ? attn.slice(0, 8).map((a) => '<div class="attn"><b class="' + a[0] + '">' + (a[0] === "lime" ? "Today" : a[0] === "info" ? "Note" : "To do") + "</b><span>" + esc(a[1]) + "</span></div>").join("") : '<div class="attn"><b class="ok">Clear</b><span>Nothing waiting on you right now.</span></div>';

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
      const st = x.it.delivered ? '<span class="st done">Done</span>' : x.it.approved || wThis.locked ? '<span class="st ok">Approved</span>' : '<span class="st wait">Approve</span>';
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
  function render() { try { renderHome(); } catch (e) { console.error("home", e); } try { renderAdsLive(); } catch (e) { console.error("ads", e); } }
  PW.hooks.push(render);
  bindLibrary(); render();
})();
