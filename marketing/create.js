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
    const rep = x.kind === "idea" && !ex ? '<button class="btn ghost xs" title="Another coach or a completely different idea for this slot" onclick="fnReplaceVideo(' + ref + ')">↔</button>' : "";
    return '<div class="fn-row' + (it.approved ? " ok" : "") + (ex ? " extra" : "") + '"><div class="chk' + (it.approved ? " done" : "") + '" role="checkbox" aria-checked="' + !!it.approved + '" tabindex="0" title="' + (it.approved ? "Approved" : "Approve") + '" onclick="toggleApprove(' + ref + ')">' + (it.approved ? "✓" : "") + "</div>" +
      '<div class="fn-day">' + (ex ? '<span class="tag orchid" style="margin:0">In hand</span>' : esc(it.day)) + '<div class="small muted">wk ' + (wi + 1) + "</div></div>" +
      '<div class="fn-body"><div class="item-title">' + esc(it.title) + '</div><div class="small muted">' + esc(x.who) + (x.role ? " · " + esc(x.role) : "") + " · " + esc(it.format) + " " + PW.stateChip(x.ws, it) + "</div>" + (it.hook ? '<div class="item-hook">' + esc(it.hook) + "</div>" : "") + (it.desc ? '<div class="small muted fn-desc" style="margin-top:4px">' + esc(String(it.desc).slice(0, 220)) + (String(it.desc).length > 220 ? "…" : "") + "</div>" : "") + "</div>" +
      '<div class="item-actions" style="margin:0">' + (ex ? '<button class="btn ghost xs orchid" onclick="useExtra(' + ref + ')">↑ Use instead of…</button>' : '<button class="btn ghost xs" onclick="fnSwap(' + ref + ')">↻ Swap</button>') + '<button class="btn ghost xs" onclick="fnEdit(' + ref + ')" title="Edit · who films it · mark posted · remove">✎</button>' + rep + "</div></div>";
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
    const coachRows = by((it, x) => x.kind === "idea" && !PW.isExtra(it) && !isStory(it)).map(([title, rows], wi) => [title, rows.concat(S.weeks[pair[wi]] ? ['<div class="fn-add"><button class="btn ghost xs" onclick="fnAddVideo(\'' + pair[wi] + '\')">＋ Add a video</button></div>'] : [])]);
    const postRows = by((it, x) => x.kind === "prod" && !isAd(it) && !isStory(it) && !PW.isExtra(it));
    const adRows = by((it, x) => x.kind === "prod" && isAd(it) && !PW.isExtra(it));
    const handRows = by((it) => PW.isExtra(it) || isStory(it));
    const whenEl = $("when-screate"); if (whenEl) whenEl.textContent = PW.fnLabel(fn) + " · Mon to Sun · the next two weeks";
    host.innerHTML =
      '<div class="' + (document.body.classList.contains("app-skin") ? "hero" : "card gen-plain") + '" id="gen-card"><div><div class="hh">' + esc(PW.fnLabel(fn)).replace(/–/, '<em>–</em>') + '</div><p>' + (built ? c.planned + " to make over the two weeks · " + c.extras + " in hand. Approve each one, swap what is not right, then set both weeks." : "One button builds the two weeks from everything the brain has learned: the banks, the pillars, what worked, the season, the competitors. Every coach once. The campus three times.") + '</p><div class="btn-row" style="margin-top:12px;gap:6px"><button class="btn sm ghost" onclick="shiftFortnight(-1)">‹ Previous</button><button class="btn sm ghost" onclick="goThisFortnight()">Now</button><button class="btn sm ghost" onclick="shiftFortnight(1)">Next ›</button>' + (built ? '<button class="btn sm ghost" onclick="pushFortnight(7)" title="Everything not posted moves one week later (a lost week: a storm, a break)">Push a week →</button>' : "") + '</div></div>' +
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
  // ＋ Add a video / ↔ Replace (Antonio, Nov 9: "if we need to switch completely to a person or a completely different idea") —
  // one window: who films it · one of their bank ideas or my own · the day. Replace takes the old post out (back to its bank).
  const FORMATS = ["Talking Head", "Reel", "Story"];
  window.fnAddVideo = function (ws, rep) {
    const w = S.weeks[ws]; if (!w) { PW.toast("Generate the two weeks first", true); return; }
    const old = rep ? PW.fnGet(ws, "idea", rep.ci, rep.ii) : null, oldCoach = rep ? w.coaches[rep.ci].name : "";
    const names = Array.from(new Set((PW.COACHES || []).map((c) => c.name).concat((w.coaches || []).map((c) => c.name)))).filter(Boolean);
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Spare"];
    const sel = (id, label, opts, val) => '<label class="f"><span>' + label + '</span><select id="' + id + '">' + opts.map((o) => '<option value="' + esc(o.v) + '"' + (o.v === val ? " selected" : "") + ">" + esc(o.t) + "</option>").join("") + "</select></label>";
    const ideasOf = (who) => (PW.availableIdeas(who, ws) || []).filter((i) => !(w.coaches || []).some((c) => c.ideas.some((x) => x.id === i.id)));
    const ideaOpts = (who) => ideasOf(who).map((i) => ({ v: i.id, t: i.title })).concat([{ v: "__own", t: "✎ Write my own idea…" }]);
    const root = PW.openModal("<h3>" + (rep ? "Replace this video" : "Add a video") + "</h3>" + (rep ? '<p class="small muted">' + esc(oldCoach) + " · “" + esc(old.title) + "” goes back to the bank.</p>" : "") +
      sel("av-who", "Who films it", names.map((n) => ({ v: n, t: n })), rep ? oldCoach : names[0]) +
      '<div id="av-ideas">' + sel("av-idea", "The idea", ideaOpts(rep ? oldCoach : names[0]), "") + "</div>" +
      '<div id="av-own" hidden><label class="f"><span>Title</span><input id="av-title" placeholder="What the coach says, in one line"></label><label class="f"><span>Hook</span><input id="av-hook" placeholder="The first line, in quotes"></label>' + sel("av-format", "Format", FORMATS.map((f) => ({ v: f, t: f })), "Talking Head") + "</div>" +
      sel("av-day", "Post day", DAYS.map((d) => ({ v: d, t: d })), rep ? old.day : "Spare") +
      '<div class="btn-row"><button class="btn ghost muted" id="av-cancel">Cancel</button><button class="btn" id="av-ok">' + (rep ? "Replace" : "Add") + "</button></div>");
    const who = root.querySelector("#av-who"), idea = () => root.querySelector("#av-idea"), own = root.querySelector("#av-own");
    const onIdea = () => { own.hidden = idea().value !== "__own"; };
    who.addEventListener("change", () => { root.querySelector("#av-ideas").innerHTML = sel("av-idea", "The idea", ideaOpts(who.value), ""); idea().addEventListener("change", onIdea); onIdea(); });
    idea().addEventListener("change", onIdea); onIdea();
    root.querySelector("#av-cancel").onclick = PW.closeModal;
    root.querySelector("#av-ok").onclick = () => {
      const name = who.value, day = root.querySelector("#av-day").value; let it;
      if (idea().value === "__own") { const t = root.querySelector("#av-title").value.trim(); if (!t) { root.querySelector("#av-title").focus(); return; } it = { id: "c_" + Date.now().toString(36), title: t, hook: root.querySelector("#av-hook").value.trim(), format: root.querySelector("#av-format").value, day, desc: "Written on the plan", delivered: false, approved: false, custom: true }; }
      else { const src = ideasOf(name).find((i) => i.id === idea().value); if (!src) return; it = PW.pick(src); it.day = day; }
      if (rep) { w.coaches[rep.ci].ideas.splice(rep.ii, 1); if (!w.coaches[rep.ci].ideas.length && !w.locked) w.coaches.splice(rep.ci, 1); }
      let c = (w.coaches || []).find((k) => k.name === name); if (!c) { const def = (PW.COACHES || []).find((k) => k.name === name); c = { name, role: def ? def.role : "", ideas: [] }; w.coaches.push(c); }
      c.ideas.push(it); PW.closeModal(); PW.fnSync(ws); PW.toast(rep ? "Replaced — approve it when it is right" : "Added — approve it when it is right");
    };
  };
  window.fnReplaceVideo = function (ws, kind, ci, ii) { if (kind !== "idea") return; window.fnAddVideo(ws, { ci, ii }); };

  render();
  new MutationObserver(render).observe(fort, { childList: true });
  PW.hooks.push(render);
})();
