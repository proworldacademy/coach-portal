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
    const kind = x.kind === "idea" ? (isStory(it) ? "k-story" : "k-video") : isAd(it) ? "k-ad" : isStory(it) ? "k-story" : /carousel/i.test(it.format || "") ? "k-post" : "k-static";
    const KN = { "k-video": "Video", "k-post": "Carousel", "k-static": "Static post", "k-ad": "Ad", "k-story": "Story" };
    const kchip = '<span class="kc ' + kind + '">' + KN[kind] + "</span>";
    const addr = ' data-ws="' + x.ws + '" data-kind="' + x.kind + '" data-a="' + (x.kind === "idea" ? x.ci : x.pi) + '" data-b="' + (x.kind === "idea" ? x.ii : 0) + '" data-day="' + esc(it.day) + '"' + (ex ? "" : ' draggable="true" title="Hold and drag to another day"');
    return '<div class="fn-row ' + kind + (it.approved ? " ok" : "") + (ex ? " extra" : "") + '"' + addr + '><div class="chk' + (it.approved ? " done" : "") + '" role="checkbox" aria-checked="' + !!it.approved + '" tabindex="0" title="' + (it.approved ? "Approved" : "Approve") + '" onclick="toggleApprove(' + ref + ')">' + (it.approved ? "✓" : "") + "</div>" +
      '<div class="fn-day">' + (ex ? '<span class="tag orchid" style="margin:0">In hand</span>' : esc(it.day)) + '<div class="small muted">' + esc(dayDate(x.ws, it.day)) + "</div></div>" +
      '<div class="fn-body"><div class="item-title">' + esc(it.title) + '</div><div class="fn-meta">' + kchip + ' <span class="fn-who">' + esc(x.who) + "</span>" + (x.role ? ' <span class="fn-role">' + esc(x.role) + "</span>" : "") + " " + PW.stateChip(x.ws, it) + "</div>" + (it.hook ? '<div class="item-hook">' + esc(it.hook) + "</div>" : "") + (it.desc ? '<div class="small muted fn-desc" style="margin-top:4px">' + esc(String(it.desc).slice(0, 220)) + (String(it.desc).length > 220 ? "…" : "") + "</div>" : "") + "</div>" +
      '<div class="item-actions" style="margin:0">' + (ex ? '<button class="btn ghost xs orchid" onclick="useExtra(' + ref + ')">↑ Use instead of…</button>' : '<button class="btn ghost xs" onclick="fnSwap(' + ref + ')">↻ Swap</button>') + '<button class="btn ghost xs" onclick="fnEdit(' + ref + ')" title="Edit · who films it · mark posted · remove">✎</button>' + rep + "</div></div>";
  };
  const section = (label, sub, groups, empty) => {
    const body = groups.map(([title, rows]) => rows.length ? '<div class="fhead" style="margin:10px 0 4px"><b>' + esc(title) + "</b></div>" + rows.join("") : "").join("");
    return '<div class="card"><div class="card-label">' + label + (sub ? ' <span class="small muted">· ' + sub + "</span>" : "") + "</div>" + (body || '<div class="empty">' + empty + "</div>") + "</div>";
  };

  const stash = document.createElement("div"); stash.hidden = true; document.body.appendChild(stash);
  const bcard = () => { const b = $("brief-buttons"); return b ? (b.closest(".card") || b) : null; };
  const acard = () => { const a = $("ad-plan"); return a ? a.closest(".card") : null; };
  const PWM = window.PWM;
  const DAYN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayDate = (ws, day) => { const k = DAYN.indexOf(day); if (k < 0) return ""; const d = new Date(ws + "T12:00:00"); d.setDate(d.getDate() + 1 + k); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const monLabel = (ws) => { const d = new Date(ws + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const ymOf = (n) => { const [y, m] = PWM.cur.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  const addBtn = (ws, fn, label) => '<div class="fn-add"><button class="btn ghost xs" onclick="' + fn + "('" + ws + "')\">＋ " + label + "</button></div>";
  function render() {
    [bcard(), acard()].forEach((el) => { if (el) stash.appendChild(el); });   // the two cards survive the redraw
    const pair = PWM.weeks();   // the month: 4 or 5 weeks
    const builtWs = pair.filter((ws) => S.weeks[ws]), built = builtWs.length, missing = pair.length - built;
    const allLocked = built > 0 && builtWs.every((ws) => S.weeks[ws].locked);
    let planned = 0, approved = 0, extras = 0;
    builtWs.forEach((ws) => PW.fnItems(ws).forEach((x) => { if (PW.isExtra(x.it)) extras++; else { planned++; if (x.it.approved) approved++; } }));
    const c = { planned, approved, extras };
    const wk = (ws) => "Week of " + monLabel(ws) + " · " + (S.weeks[ws] ? S.weeks[ws].weekDates || PW.weekLabel(ws) : PW.weekLabel(ws)) + (S.weeks[ws] && S.weeks[ws].locked ? " · set" : S.weeks[ws] ? "" : " · not built");
    const items = pair.map((ws) => PW.fnItems(ws));
    const by = (pred, add) => pair.map((ws, wi) => [wk(ws), items[wi].filter((x) => pred(x.it, x)).map((x) => row(x, wi)).concat(S.weeks[ws] && add ? [add(ws)] : [])]);
    // the calendar (Antonio, Nov 9): one list per week, day by day, every kind together — videos white, carousels and posts cyan,
    // ads lime, stories orchid; a day with nothing is a row of its own with ＋
    const calRows = pair.map((ws, wi) => {
      if (!S.weeks[ws]) return [wk(ws), ['<div class="small muted" style="padding:6px 0 10px">Not built yet — ⚡ above builds it.</div>']];
      const list = items[wi].filter((x) => !PW.isExtra(x.it)); const rows = [];
      DAYN.forEach((d) => { const here = list.filter((x) => x.it.day === d); if (here.length) here.forEach((x) => rows.push(row(x, wi))); else rows.push('<div class="fn-row k-empty" data-ws="' + ws + '" data-day="' + d + '"><div></div><div class="fn-day">' + d + '<div class="small muted">' + esc(dayDate(ws, d)) + '</div></div><div class="fn-body"><span class="st miss">Nothing planned</span></div><div class="item-actions" style="margin:0"><button class="btn ghost xs" onclick="fnAddVideo(\'' + ws + "','" + d + '\')">＋ Video</button><button class="btn ghost xs" onclick="fnAddPost(\'' + ws + "','" + d + '\')">＋ Post</button></div></div>'); });
      rows.push('<div class="fn-add">' + ['fnAddVideo:Add a video', 'fnAddPost:Add a carousel or post', 'fnAddAd:Add an ad'].map((p) => { const [f, l] = p.split(":"); return '<button class="btn ghost xs" onclick="' + f + "('" + ws + '\')">＋ ' + l + "</button>"; }).join(" ") + "</div>");
      return [wk(ws), rows];
    });
    const handRows = by((it) => PW.isExtra(it) || isStory(it));
    const whenEl = $("when-screate"); if (whenEl) whenEl.textContent = PWM.label() + " · " + pair.length + " weeks · Mon to Sun";
    const [y, m] = PWM.cur.split("-").map(Number); const lastDay = new Date(y, m, 0).getDate();
    host.innerHTML =
      '<div class="' + (document.body.classList.contains("app-skin") ? "hero" : "card gen-plain") + '" id="gen-card"><div><div class="hh">' + esc(PWM.label()).replace(/ (\d{4})$/, ' <em>$1</em>') + '</div><p>' + (built ? planned + " to make over " + pair.length + " weeks (" + lastDay + " days) · " + extras + " in hand" + (missing ? " · " + missing + " week" + (missing > 1 ? "s" : "") + " not built yet" : "") + ". Approve each one, swap what is not right, then set the month." : "One button builds the month, week by week, from everything the brain has learned: the banks, the pillars, what worked, the season, the competitors. Every coach once a fortnight. The campus three times.") + '</p><div class="btn-row" style="margin-top:12px;gap:6px"><button class="btn sm ghost" onclick="PWM.shift(-1)">‹ ' + esc(PWM.label(ymOf(-1))) + '</button><button class="btn sm ghost" onclick="PWM.now()">This month</button><button class="btn sm ghost" onclick="PWM.shift(1)">' + esc(PWM.label(ymOf(1))) + ' ›</button>' + (built ? '<button class="btn sm ghost" onclick="pushMonth()" title="Everything not posted moves one week later (a lost week: a storm, a break)">Push a week →</button>' : "") + '</div></div>' +
      '<div style="text-align:right;flex:none"><button class="btn pri" onclick="genMonth()">⚡ ' + (missing ? (built ? "Build the " + missing + " missing week" + (missing > 1 ? "s" : "") : "Generate " + PWM.label().split(" ")[0]) : "Rebuild the month") + '</button><div class="gen-sub" style="margin-top:10px;font-size:12px">' + (built ? approved + " of " + planned + " approved" : "not built yet") + '</div><div class="bar"><i style="width:' + (planned ? Math.round(approved / planned * 100) : 0) + '%"></i></div><div class="btn-row" style="margin-top:10px;justify-content:flex-end;gap:6px"><button class="btn sm ghost" onclick="approveMonth()"' + (planned && approved < planned ? "" : " disabled") + '>✓ Approve all</button><button class="btn sm" onclick="setMonth()"' + (built && !allLocked ? "" : " disabled") + '>' + (allLocked ? "✓ Month set" : "Set the month") + '</button></div></div></div>' +
      section("The month, day by day", '<span class="kc k-video">Video</span> <span class="kc k-post">Carousel</span> <span class="kc k-static">Static post</span> <span class="kc k-ad">Ad</span> <span class="kc k-story">Story</span>', calRows, "Generate the month to see the calendar.") +
      '<div id="create-briefs"></div>' +
      '<div id="create-adplan"></div>' +
      section("In hand", "spares, stories, anything else · use one instead of a weak post", handRows, "Nothing in hand.");
    const bc = bcard(); const slot = $("create-briefs");
    if (bc && slot) { slot.appendChild(bc); const lab = bc.querySelector(".card-label"); if (lab) lab.innerHTML = 'Send it <span class="small muted">· coach brief · photographer shot list · editor · posting plan</span>'; }
    const apc = acard(); const aslot = $("create-adplan"); if (apc && aslot) aslot.appendChild(apc);
    host.querySelectorAll(".chk").forEach((k) => k.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); k.click(); } }));
    bindDrag();
  }

  // ── hold a post and move it to another day (Antonio, Nov 9: "same as moving a player to a group") ──
  // drop on a day: the two posts swap days (or the post takes the empty day); across weeks the post moves into that week. One-step Undo.
  const MOVES = [];
  function getItem(ws, kind, a, b) { return PW.fnGet(ws, kind, a, b); }
  function detach(ws, kind, a, b) { const w = S.weeks[ws]; if (kind === "idea") { const c = w.coaches[a], it = c.ideas.splice(b, 1)[0]; if (!c.ideas.length && !w.locked) w.coaches.splice(a, 1); return { it, coach: c.name, role: c.role }; } return { it: w.production.splice(a, 1)[0] }; }
  function attach(ws, rec, day) { const w = S.weeks[ws]; rec.it.day = day; if (rec.coach) { let c = (w.coaches || []).find((k) => k.name === rec.coach); if (!c) { c = { name: rec.coach, role: rec.role || "", ideas: [] }; w.coaches.push(c); } c.ideas.push(rec.it); } else w.production.push(rec.it); }
  function moveTo(src, tgt) {
    const sw = S.weeks[src.ws], tw = S.weeks[tgt.ws]; if (!sw || !tw) return;
    const sIt = getItem(src.ws, src.kind, src.a, src.b); if (!sIt) return;
    const tIt = tgt.kind ? getItem(tgt.ws, tgt.kind, tgt.a, tgt.b) : null;
    const before = { src: { ws: src.ws, day: sIt.day, id: sIt.id }, tgt: tIt ? { ws: tgt.ws, day: tIt.day, id: tIt.id } : null };
    if (src.ws === tgt.ws) { const d = sIt.day; sIt.day = tgt.day; if (tIt) tIt.day = d; }
    else {   // across weeks: take both out first (indexes shift), then put each in the other week
      const sRec = detach(src.ws, src.kind, src.a, src.b);
      const tRec = tIt ? detach(tgt.ws, tgt.kind, tgt.kind === "idea" ? tw.coaches.findIndex((c) => c.ideas.includes(tIt)) : tw.production.indexOf(tIt), tgt.kind === "idea" ? tw.coaches.find((c) => c.ideas.includes(tIt)).ideas.indexOf(tIt) : 0) : null;
      attach(tgt.ws, sRec, tgt.day); if (tRec) attach(src.ws, tRec, before.src.day);
    }
    MOVES.unshift(before); if (MOVES.length > 5) MOVES.length = 5;
    PW.fnSync(src.ws); PW.toast((tIt ? "Swapped — " : "Moved — ") + "↶ Undo above");
  }
  window.undoMove = function () {
    const mv = MOVES.shift(); if (!mv) return;
    const find = (id) => { for (const ws of Object.keys(S.weeks)) { const w = S.weeks[ws]; for (let ci = 0; ci < (w.coaches || []).length; ci++) { const ii = w.coaches[ci].ideas.findIndex((i) => i.id === id); if (ii >= 0) return { ws, kind: "idea", a: ci, b: ii }; } const pi = (w.production || []).findIndex((p) => p.id === id); if (pi >= 0) return { ws, kind: "prod", a: pi, b: 0 }; } return null; };
    const put = (rec, where) => { if (!rec) return; const at = find(rec.id); if (!at) return; if (at.ws === where.ws) { getItem(at.ws, at.kind, at.a, at.b).day = where.day; } else { const r = detach(at.ws, at.kind, at.a, at.b); attach(where.ws, r, where.day); } };
    put(mv.src, mv.src); put(mv.tgt, mv.tgt);
    PW.fnSync(mv.src.ws); PW.toast("Undone");
  };
  function addrOf(el) { return { ws: el.dataset.ws, kind: el.dataset.kind || "", a: Number(el.dataset.a || 0), b: Number(el.dataset.b || 0), day: el.dataset.day }; }
  function bindDrag() {
    const rows = Array.from(host.querySelectorAll(".fn-row[data-ws]")); let drag = null;
    const clear = () => rows.forEach((r) => r.classList.remove("over", "dragging"));
    rows.forEach((r) => {
      if (r.getAttribute("draggable") === "true") {
        r.addEventListener("dragstart", (e) => { drag = addrOf(r); r.classList.add("dragging"); try { e.dataTransfer.setData("text/plain", "post"); e.dataTransfer.effectAllowed = "move"; } catch (x) { /* noop */ } });
        r.addEventListener("dragend", () => { drag = null; clear(); });
      }
      r.addEventListener("dragover", (e) => { if (!drag) return; e.preventDefault(); r.classList.add("over"); });
      r.addEventListener("dragleave", () => r.classList.remove("over"));
      r.addEventListener("drop", (e) => { if (!drag) return; e.preventDefault(); const tgt = addrOf(r); clear(); if (tgt.ws === drag.ws && tgt.kind === drag.kind && tgt.a === drag.a && tgt.b === drag.b) return; moveTo(drag, tgt); drag = null; });
      // touch: hold ~350 ms, then slide; drop on the row under the finger
      if (r.getAttribute("draggable") === "true") {
        let timer = null, active = false;
        r.addEventListener("touchstart", (e) => { timer = setTimeout(() => { active = true; drag = addrOf(r); r.classList.add("dragging"); if (navigator.vibrate) navigator.vibrate(20); }, 350); }, { passive: true });
        r.addEventListener("touchmove", (e) => { if (!active) { clearTimeout(timer); return; } e.preventDefault(); const t = e.touches[0]; const el = document.elementFromPoint(t.clientX, t.clientY); const tr = el && el.closest(".fn-row[data-ws]"); rows.forEach((x) => x.classList.toggle("over", x === tr)); }, { passive: false });
        r.addEventListener("touchend", (e) => { clearTimeout(timer); if (!active) return; active = false; const t = e.changedTouches[0]; const el = document.elementFromPoint(t.clientX, t.clientY); const tr = el && el.closest(".fn-row[data-ws]"); clear(); if (tr && tr !== r) moveTo(drag, addrOf(tr)); drag = null; });
        r.addEventListener("touchcancel", () => { clearTimeout(timer); active = false; drag = null; clear(); });
      }
    });
    const gen = $("gen-card"); if (gen && MOVES.length && !gen.querySelector("#undo-move")) { const b = document.createElement("button"); b.id = "undo-move"; b.className = "btn sm ghost"; b.textContent = "↶ Undo move"; b.onclick = window.undoMove; const row = gen.querySelector(".btn-row"); if (row) row.appendChild(b); }
  }
  // ＋ Add a video / ↔ Replace (Antonio, Nov 9: "if we need to switch completely to a person or a completely different idea") —
  // one window: who films it · one of their bank ideas or my own · the day. Replace takes the old post out (back to its bank).
  const FORMATS = ["Talking Head", "Reel", "Story"];
  window.fnAddVideo = function (ws, rep) {
    if (typeof rep === "string") { const day = rep; rep = null; window.__avDay = day; } else window.__avDay = null;
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
      sel("av-day", "Post day", DAYS.map((d) => ({ v: d, t: d })), rep ? old.day : (window.__avDay || "Spare")) +
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

  // ＋ Add an ad / ＋ Add a carousel or post (Antonio, Nov 9): one of the production bank's pieces, or my own; remove is in ✎
  function addProd(ws, isAdKind, day0) {
    const w = S.weeks[ws]; if (!w) { PW.toast("Generate the month first", true); return; }
    const fits = (x) => (isAdKind ? isAd(x) : PW.isPostItem(x));
    const avail = (PW.availableProd(ws) || []).filter((x) => fits(x) && !(w.production || []).some((p) => p.id === x.id));
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Spare"];
    const sel = (id, label, opts, val) => '<label class="f"><span>' + label + '</span><select id="' + id + '">' + opts.map((o) => '<option value="' + esc(o.v) + '"' + (o.v === val ? " selected" : "") + ">" + esc(o.t) + "</option>").join("") + "</select></label>";
    const fmts = isAdKind ? ["Ad Video"] : ["Carousel", "Static Post", "Reel"];
    const root = PW.openModal("<h3>" + (isAdKind ? "Add an ad" : "Add a carousel or post") + "</h3>" +
      sel("ap-idea", isAdKind ? "The ad" : "The piece", avail.map((i) => ({ v: i.id, t: i.title })).concat([{ v: "__own", t: "✎ Write my own…" }]), "") +
      '<div id="ap-own" hidden><label class="f"><span>Title</span><input id="ap-title"></label><label class="f"><span>What it shows</span><input id="ap-desc" placeholder="the shots, the slides, the headline"></label>' + sel("ap-format", "Format", fmts.map((f) => ({ v: f, t: f })), fmts[0]) + "</div>" +
      sel("ap-day", "Post day", DAYS.map((d) => ({ v: d, t: d })), day0 || (isAdKind ? "Thu" : "Wed")) +
      '<div class="btn-row"><button class="btn ghost muted" id="ap-cancel">Cancel</button><button class="btn" id="ap-ok">Add</button></div>');
    const idea = root.querySelector("#ap-idea"), own = root.querySelector("#ap-own"); const onIdea = () => { own.hidden = idea.value !== "__own"; }; idea.addEventListener("change", onIdea); onIdea();
    root.querySelector("#ap-cancel").onclick = PW.closeModal;
    root.querySelector("#ap-ok").onclick = () => {
      const day = root.querySelector("#ap-day").value; let it;
      if (idea.value === "__own") { const t = root.querySelector("#ap-title").value.trim(); if (!t) { root.querySelector("#ap-title").focus(); return; } it = { id: "c_" + Date.now().toString(36), title: t, desc: root.querySelector("#ap-desc").value.trim(), hook: "", format: root.querySelector("#ap-format").value, day, pillar: isAdKind ? "promo" : "culture", delivered: false, approved: false, custom: true }; }
      else { const src = avail.find((i) => i.id === idea.value); if (!src) return; it = PW.pick(src, { pillar: src.pillar }); it.day = day; }
      w.production.push(it); PW.closeModal(); PW.fnSync(ws); PW.toast("Added — approve it when it is right");
    };
  }
  window.fnAddAd = (ws, day) => addProd(ws, true, day);
  window.fnAddPost = (ws, day) => addProd(ws, false, day);

  // the month: generate the missing weeks, approve all, set (lock) the built ones, push by a week
  window.genMonth = async function () {
    const pair = PWM.weeks(); const missing = pair.filter((ws) => !S.weeks[ws]); const open = pair.filter((ws) => S.weeks[ws] && !S.weeks[ws].locked);
    let todo = missing;
    if (!missing.length) { if (!open.length) { PW.toast("Every week of " + PWM.label() + " is set. Unlock a week from More to rebuild it.", true); return; } if (!(await PW.askConfirm("Rebuild " + PWM.label(), open.length + " unset week" + (open.length > 1 ? "s" : "") + " get a fresh plan; your swaps and edits on them are lost. Set weeks stay.", "Rebuild", true))) return; todo = open; }
    else if (!(await PW.askConfirm("Build " + PWM.label(), "Build the " + missing.length + " missing week" + (missing.length > 1 ? "s" : "") + " (" + missing.map(monLabel).join(", ") + ") from the banks? The weeks already built stay.", "Build"))) return;
    todo.forEach((ws) => { const t = PW.detectWeekTheme(PW.wsDate(ws)); S.weeks[ws] = PW.buildWeek(ws, t.theme, t.pillar); PW.fnSync(ws); });
    PW.toast(todo.length + " week" + (todo.length > 1 ? "s" : "") + " built — approve, swap, then set the month");
  };
  window.approveMonth = function () { PWM.weeks().forEach((ws) => PW.fnItems(ws).forEach((x) => { if (!PW.isExtra(x.it)) x.it.approved = true; })); PW.fnSync(PWM.weeks()[0]); PW.toast("All planned posts approved — now set the month"); };
  window.setMonth = async function () {
    const weeks = PWM.weeks().filter((ws) => S.weeks[ws] && !S.weeks[ws].locked); if (!weeks.length) return;
    let planned = 0, approved = 0; weeks.forEach((ws) => PW.fnItems(ws).forEach((x) => { if (!PW.isExtra(x.it)) { planned++; if (x.it.approved) approved++; } }));
    const msg = approved < planned ? approved + " of " + planned + " posts are approved. Set the month anyway? Everything in it is locked out of future weeks." : "All " + planned + " posts approved. Lock the month? Its ideas never get assigned again.";
    if (!(await PW.askConfirm("Set " + PWM.label(), msg, "Set the month"))) return;
    weeks.forEach((ws) => { const w = S.weeks[ws]; w.locked = true; w.approvedAt = new Date().toISOString(); delete w.warnings; });
    PW.fnSync(weeks[0]); PW.toast("Month set — send the briefs");
  };
  window.pushMonth = async function () {
    const weeks = PWM.weeks().filter((ws) => S.weeks[ws]); if (!weeks.length) return;
    const open = weeks.reduce((k, ws) => k + PW.fnItems(ws).filter((x) => !PW.isDone(ws, x.it)).length, 0);
    if (!open) { PW.toast("Everything this month is already posted", true); return; }
    if (!(await PW.askConfirm("Push by a week", open + " posts that have not gone out move to the same day one week later. Posted ones stay.", "Push"))) return;
    weeks.slice().reverse().forEach((ws) => {
      const w = S.weeks[ws], to = PW.shiftWS(ws, 1);
      if (!S.weeks[to]) S.weeks[to] = { weekStart: to, weekDates: PW.weekLabel(to), theme: w.theme || "", themePillar: w.themePillar || "", locked: false, createdAt: Date.now(), coaches: [], production: [], warnings: [] };
      const t = S.weeks[to];
      (w.coaches || []).forEach((c) => { const keep = [], move = []; c.ideas.forEach((i) => (PW.isDone(ws, i) ? keep : move).push(i)); if (move.length) { let tc = t.coaches.find((x) => x.name === c.name); if (!tc) { tc = { name: c.name, role: c.role, ideas: [] }; t.coaches.push(tc); } move.forEach((i) => { i.approved = false; tc.ideas.push(i); }); } c.ideas = keep; });
      w.coaches = (w.coaches || []).filter((c) => c.ideas.length);
      const keepP = [], moveP = []; (w.production || []).forEach((p) => (PW.isDone(ws, p) ? keepP : moveP).push(p)); moveP.forEach((p) => { p.approved = false; t.production.push(p); }); w.production = keepP;
      t.locked = false;
    });
    PW.fnSync(weeks[0]); PW.toast("Pushed — approve the weeks again where they landed");
  };
  PWM.on(render);

  render();
  new MutationObserver(render).observe(fort, { childList: true });
  PW.hooks.push(render);
})();
