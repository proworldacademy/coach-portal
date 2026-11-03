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
      '<div class="fn-body"><div class="item-title">' + esc(it.title) + '</div><div class="small muted">' + esc(x.who) + (x.role ? " · " + esc(x.role) : "") + " · " + esc(it.format) + " " + PW.stateChip(x.ws, it) + "</div>" + (it.hook ? '<div class="item-hook">' + esc(it.hook) + "</div>" : "") + (it.desc ? '<div class="small muted fn-desc" style="margin-top:4px">' + esc(String(it.desc).slice(0, 220)) + (String(it.desc).length > 220 ? "…" : "") + "</div>" : "") + "</div>" +
      '<div class="item-actions" style="margin:0">' + (ex ? '<button class="btn ghost xs orchid" onclick="useExtra(' + ref + ')">↑ Use instead of…</button>' : '<button class="btn ghost xs" onclick="fnSwap(' + ref + ')">↻ Swap</button>') + '<button class="btn ghost xs" onclick="fnEdit(' + ref + ')" title="Edit · mark posted · remove">✎</button></div></div>';
  };
  const section = (label, sub, groups, empty) => {
    const body = groups.map(([title, rows]) => rows.length ? '<div class="fhead" style="margin:10px 0 4px"><b>' + esc(title) + "</b></div>" + rows.join("") : "").join("");
    return '<div class="card"><div class="card-label">' + label + (sub ? ' <span class="small muted">· ' + sub + "</span>" : "") + "</div>" + (body || '<div class="empty">' + empty + "</div>") + "</div>";
  };

  const stash = document.createElement("div"); stash.hidden = true; document.body.appendChild(stash);
  const bcard = () => { const b = $("brief-buttons"); return b ? (b.closest(".card") || b) : null; };
  const acard = () => { const a = $("ad-plan"); return a ? a.closest(".card") : null; };
  function render() {
    [bcard(), acard()].forEach((el) => { if (el) stash.appendChild(el); });   // the two cards survive the redraw
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
    const whenEl = $("when-screate"); if (whenEl) whenEl.textContent = PW.fnLabel(fn) + " · Mon to Sun · the next two weeks";
    host.innerHTML =
      '<div class="' + (document.body.classList.contains("app-skin") ? "hero" : "card gen-plain") + '" id="gen-card"><div><div class="hh">' + esc(PW.fnLabel(fn)).replace(/–/, '<em>–</em>') + '</div><p>' + (built ? c.planned + " to make over the two weeks · " + c.extras + " in hand. Approve each one, swap what is not right, then set both weeks." : "One button builds the two weeks from everything the brain has learned: the banks, the pillars, what worked, the season, the competitors. Every coach once. The campus three times.") + '</p><div class="btn-row" style="margin-top:12px;gap:6px"><button class="btn sm ghost" onclick="shiftFortnight(-1)">‹ Previous</button><button class="btn sm ghost" onclick="goThisFortnight()">Now</button><button class="btn sm ghost" onclick="shiftFortnight(1)">Next ›</button></div></div>' +
      '<div style="text-align:right;flex:none"><button class="btn pri" onclick="genFortnight()">⚡ ' + (built ? "Rebuild the 2 weeks" : "Generate the next 2 weeks") + '</button><div class="gen-sub" style="margin-top:10px;font-size:12px">' + (built ? c.approved + " of " + c.planned + " approved" : "not built yet") + '</div><div class="bar"><i style="width:' + (c.planned ? Math.round(c.approved / c.planned * 100) : 0) + '%"></i></div><div class="btn-row" style="margin-top:10px;justify-content:flex-end;gap:6px"><button class="btn sm ghost" onclick="approveAllFortnight()"' + (c.planned && c.approved < c.planned ? "" : " disabled") + '>✓ Approve all</button><button class="btn sm" onclick="setFortnight()"' + (built === 2 && !allLocked ? "" : " disabled") + '>' + (allLocked ? "✓ Both weeks set" : "Set the two weeks") + '</button></div></div></div>' +
      section("Coach videos", "what each coach records · the photographer list", coachRows, "Generate the two weeks to see who films what.") +
      '<div id="create-briefs"></div>' +
      section("Carousels &amp; posts", "designed by the editor", postRows, "No carousels or posts yet.") +
      section("Ads", "the ad videos these weeks · the campaigns they serve below", adRows, "No ad video yet.") + '<div id="create-adplan"></div>' +
      section("In hand", "spares, stories, anything else · use one instead of a weak post", handRows, "Nothing in hand.");
    const bc = bcard(); const slot = $("create-briefs");
    if (bc && slot) { slot.appendChild(bc); const lab = bc.querySelector(".card-label"); if (lab) lab.innerHTML = 'Send it <span class="small muted">· coach brief · photographer shot list · editor · posting plan</span>'; }
    const apc = acard(); const aslot = $("create-adplan"); if (apc && aslot) aslot.appendChild(apc);
    host.querySelectorAll(".chk").forEach((k) => k.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); k.click(); } }));
  }
  render();
  new MutationObserver(render).observe(fort, { childList: true });
  PW.hooks.push(render);
})();
