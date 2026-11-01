/* ② Create, by category (Antonio, Nov 1, 2026): "one button generates the next 2 weeks in every category — coach videos for the
   photographer, carousels and posts, ads, anything else — very clear". Three-steps view only: the fortnight's items are shown grouped
   by what they are (not by day), with Generate at the top. Every row keeps the same Swap / ✎ (edit · mark posted · remove) as before.
   Reads the same two weeks app.js builds; re-renders whenever app.js redraws #fortnight. Loaded after steps.js. */
(function () {
  const PW = window.PW; if (!PW || !document.getElementById("tab-screate")) return;
  const { S, $, esc } = PW;
  const host = document.createElement("div"); host.id = "create-plan";
  const fort = $("fortnight"); if (!fort) return;
  fort.parentNode.insertBefore(host, fort); fort.style.display = "none";

  const isAd = (it) => /^ad/i.test(it.format || "");
  const isStory = (it) => /story/i.test(it.format || "");
  const row = (x, wi) => {
    const it = x.it, ref = "'" + x.ws + "','" + x.kind + "'," + (x.kind === "idea" ? x.ci + "," + x.ii : x.pi);
    const ex = PW.isExtra(it);
    return '<div class="fn-row' + (it.approved ? " ok" : "") + (ex ? " extra" : "") + '"><div class="chk' + (it.approved ? " done" : "") + '" role="checkbox" aria-checked="' + !!it.approved + '" tabindex="0" title="' + (it.approved ? "Approved" : "Approve") + '" onclick="toggleApprove(' + ref + ')">' + (it.approved ? "✓" : "") + "</div>" +
      '<div class="fn-day">' + (ex ? '<span class="tag orchid" style="margin:0">In hand</span>' : esc(it.day)) + '<div class="small muted">wk ' + (wi + 1) + "</div></div>" +
      '<div class="fn-body"><div class="item-title">' + esc(it.title) + '</div><div class="small muted">' + esc(x.who) + (x.role ? " · " + esc(x.role) : "") + " · " + esc(it.format) + " " + PW.stateChip(x.ws, it) + "</div>" + (it.hook ? '<div class="item-hook">' + esc(it.hook) + "</div>" : "") + (it.desc ? '<div class="small muted" style="margin-top:4px">' + esc(String(it.desc).slice(0, 220)) + (String(it.desc).length > 220 ? "…" : "") + "</div>" : "") + "</div>" +
      '<div class="item-actions" style="margin:0">' + (ex ? '<button class="btn ghost xs orchid" onclick="useExtra(' + ref + ')">↑ Use instead of…</button>' : '<button class="btn ghost xs" onclick="fnSwap(' + ref + ')">↻ Swap</button>') + '<button class="btn ghost xs" onclick="fnEdit(' + ref + ')" title="Edit · mark posted · remove">✎</button></div></div>';
  };
  const section = (label, sub, groups, empty) => {
    const body = groups.map(([title, rows]) => rows.length ? '<div class="fhead" style="margin:10px 0 4px"><b>' + esc(title) + "</b></div>" + rows.join("") : "").join("");
    return '<div class="card"><div class="card-label">' + label + (sub ? ' <span class="small muted">· ' + sub + "</span>" : "") + "</div>" + (body || '<div class="empty">' + empty + "</div>") + "</div>";
  };

  function render() {
    const fn = PW.curFN(), pair = PW.fnPair(fn), c = PW.fnCounts();
    const allLocked = pair.every((ws) => S.weeks[ws] && S.weeks[ws].locked);
    const built = pair.filter((ws) => S.weeks[ws]).length;
    const wk = (ws, wi) => "Week " + (wi + 1) + " · " + (S.weeks[ws] ? S.weeks[ws].weekDates || PW.weekLabel(ws) : PW.weekLabel(ws));
    const items = pair.map((ws) => PW.fnItems(ws));
    const by = (pred) => pair.map((ws, wi) => [wk(ws, wi), items[wi].filter((x) => pred(x.it, x)).map((x) => row(x, wi))]);
    const coachRows = by((it, x) => x.kind === "idea" && !PW.isExtra(it) && !isStory(it));
    const postRows = by((it, x) => x.kind === "prod" && !isAd(it) && !isStory(it) && !PW.isExtra(it));
    const adRows = by((it, x) => x.kind === "prod" && isAd(it) && !PW.isExtra(it));
    const handRows = by((it) => PW.isExtra(it) || isStory(it));
    host.innerHTML =
      '<div class="card" id="gen-card"><div class="btn-row" style="margin-bottom:10px"><button class="btn ghost sm" onclick="shiftFortnight(-1)">‹ Previous 2 weeks</button><button class="btn sm" onclick="goThisFortnight()">Now</button><button class="btn ghost sm" onclick="shiftFortnight(1)">Next 2 weeks ›</button><span class="small muted" style="margin-left:6px"><strong>' + esc(PW.fnLabel(fn)) + "</strong> · Mon to Sun</span></div>" +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><div class="card-label" style="margin-bottom:4px">' + (built ? c.approved + " of " + c.planned + " approved" : "Not built yet") + '</div><div class="small muted">' + (built ? c.planned + " to make over the two weeks · " + c.extras + " in hand · approve each one, swap what is not right, then set both weeks." : "One button builds the two weeks: every coach's video, the carousels and posts, the ads — from the banks, the pillars, what worked the last two weeks, the season and what the competitors are doing.") + "</div></div>" +
      '<div class="btn-row"><button class="btn" onclick="genFortnight()">⚡ ' + (built ? "Rebuild the 2 weeks" : "Generate the next 2 weeks") + '</button><button class="btn ghost sm" onclick="approveAllFortnight()"' + (c.planned && c.approved < c.planned ? "" : " disabled") + '>✓ Approve all</button><button class="btn mint" onclick="setFortnight()"' + (built === 2 && !allLocked ? "" : " disabled") + ">" + (allLocked ? "✓ Both weeks set" : "Set the two weeks") + "</button></div></div>" +
      (built ? '<div class="progress" style="margin-top:12px"><div class="bar"><i style="width:' + (c.planned ? Math.round(c.approved / c.planned * 100) : 0) + '%"></i></div><div class="pillar-pct">' + c.approved + "/" + c.planned + "</div></div>" : "") + "</div>" +
      section("Coach videos", "what each coach records · the photographer list", coachRows, "Generate the two weeks to see who films what.") +
      '<div id="create-briefs"></div>' +
      section("Carousels &amp; posts", "designed by the editor", postRows, "No carousels or posts yet.") +
      section("Ads", "the ad videos these weeks · the campaigns they serve below", adRows, "No ad video yet.") + '<div id="create-adplan"></div>' +
      section("In hand", "spares, stories, anything else · use one instead of a weak post", handRows, "Nothing in hand.");
    const bb = $("brief-buttons"); const bc = bb && (bb.closest(".card") || bb); const slot = $("create-briefs");
    if (bc && slot) { slot.appendChild(bc); const lab = bc.querySelector(".card-label"); if (lab) lab.innerHTML = 'Send it <span class="small muted">· coach brief · photographer shot list · editor · posting plan</span>'; }
    const ap = $("ad-plan"); const apc = ap && ap.closest(".card"); const aslot = $("create-adplan"); if (apc && aslot) aslot.appendChild(apc);
    host.querySelectorAll(".chk").forEach((k) => k.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); k.click(); } }));
  }
  render();
  new MutationObserver(render).observe(fort, { childList: true });
  PW.hooks.push(render);
})();
