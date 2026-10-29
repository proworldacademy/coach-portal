/* The idea engine, live on the page (Antonio, Oct 28, 2026): Swap never runs dry, and a direction box asks Claude for new ideas on
   the spot ("more about the campus for Nico"). The engine side is /api/marketing/ideas (functions/lib/ideas.js); it reads the record
   (strategy, priorities, pillars, the archive, the banks) and never repeats what went out. Everything it returns lands in the banks
   too, so the Sunday run and the page share one memory. Loaded after app.js; wraps swapIdea / swapProd / fnSwap. */
(function () {
  const PW = window.PW; if (!PW) return;
  const { S, $, esc, toast, pick, save } = PW;
  const recent = {};   // slot key → ids shown lately, so Swap walks the bank instead of ping-ponging between two

  async function token() { const u = window.firebase && firebase.auth && firebase.auth().currentUser; return u ? u.getIdToken() : ""; }
  async function api(path, body) {
    const t = await token(); if (!t) throw new Error("Sign in first.");
    const r = await fetch("/api" + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", authorization: "Bearer " + t }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j && j.message ? j.message : "The engine did not answer (" + r.status + ").");
    return j;
  }
  const direction = () => { const el = $("eng-dir"); return el ? el.value.trim() : ""; };
  const bankItem = (i) => ({ id: i.id, title: i.title, format: i.format, day: i.day || "Wed", desc: i.desc, hook: i.hook || "", pillar: i.pillar || "", by: "engine-live", at: i.at });

  /* ask the engine; the ideas go into the bank of that coach (or the production bank) and come back */
  async function ask(coach, n, format, dir) {
    const out = await api("/marketing/ideas", { coach: coach === "Production" ? "" : coach, n: n || 5, format: format || "", direction: dir == null ? direction() : dir });
    const list = (out.ideas || []).map(bankItem);
    if (!list.length) return list;
    if (coach && coach !== "Production") { S.ideaBank[coach] = (S.ideaBank[coach] || []).concat(list); save("ideaBank"); }
    else { S.prodBank = (S.prodBank || []).concat(list); save("prodBank"); }
    return list;
  }
  PW.askEngine = ask;

  /* pick the next idea for a slot: not the one in it, not in this week, not shown lately; make more when the bank is thin */
  async function nextIdea(coach, ws, exclude, slotKey) {
    let avail = PW.availableIdeas(coach, ws).filter((i) => !exclude.has(i.id));
    const seen = recent[slotKey] || [];
    let fresh = avail.filter((i) => !seen.includes(i.id));
    if (fresh.length < 3) {
      toast("Thinking of new ideas for " + coach + "…");
      try { await ask(coach, 5); } catch (e) { if (!avail.length) { toast(e.message, true); return null; } }
      avail = PW.availableIdeas(coach, ws).filter((i) => !exclude.has(i.id)); fresh = avail.filter((i) => !seen.includes(i.id));
    }
    const pool = fresh.length ? fresh : avail; if (!pool.length) return null;
    const it = pool[Math.floor(Math.random() * pool.length)];
    recent[slotKey] = seen.concat(it.id).slice(-8);
    return it;
  }
  async function nextProd(ws, exclude, isAd, slotKey) {
    const fits = (x) => (isAd ? /^ad/i.test(x.format || "") : PW.isPostItem(x));
    let avail = PW.availableProd(ws).filter((x) => !exclude.has(x.id) && fits(x));
    const seen = recent[slotKey] || [];
    let fresh = avail.filter((i) => !seen.includes(i.id));
    if (fresh.length < 3) {
      toast("Thinking of new " + (isAd ? "ad videos" : "carousels and statics") + "…");
      try { await ask("Production", 5, isAd ? "Ad Video" : "Carousel"); } catch (e) { if (!avail.length) { toast(e.message, true); return null; } }
      avail = PW.availableProd(ws).filter((x) => !exclude.has(x.id) && fits(x)); fresh = avail.filter((i) => !seen.includes(i.id));
    }
    const pool = fresh.length ? fresh : avail; if (!pool.length) return null;
    const it = pool[Math.floor(Math.random() * pool.length)];
    recent[slotKey] = seen.concat(it.id).slice(-8);
    return it;
  }

  // ── Swap on the 2-Week Plan ──
  window.fnSwap = async function (ws, kind, a, b) {
    const w = S.weeks[ws]; if (!w) return; const it = PW.fnGet(ws, kind, a, b); if (!it) return;
    if (kind === "idea") {
      const c = w.coaches[a]; const ex = new Set([it.id].concat(c.ideas.map((x) => x.id)));
      const np = await nextIdea(c.name, ws, ex, ws + "|" + c.name + "|" + b); if (!np) { toast("Nothing new for " + c.name + " right now — try a direction in the box above", true); return; }
      const p = pick(np); p.day = it.day; c.ideas[b] = p;
    } else {
      const ex = new Set([it.id].concat(w.production.map((x) => x.id)));
      const np = await nextProd(ws, ex, /^ad/i.test(it.format || ""), ws + "|prod|" + a); if (!np) { toast("Nothing new of that kind right now — try a direction in the box above", true); return; }
      const p = pick(np, { pillar: np.pillar }); p.day = it.day; w.production[a] = p;
    }
    PW.fnSync(ws); toast("Swapped — swap again for another, approve when it is right");
  };
  // ── Swap on Coach assignments ──
  window.swapIdea = async function (ci, ii) {
    const d = PW.cur(); if (!d) return; const c = d.coaches[ci], it = c.ideas[ii];
    const ex = new Set([it.id].concat(c.ideas.map((x) => x.id)));
    const np = await nextIdea(c.name, d.weekStart, ex, (d.weekStart || "") + "|" + c.name + "|" + ii); if (!np) { toast("Nothing new for " + c.name + " right now", true); return; }
    c.ideas[ii] = pick(np); PW.syncWeek(); PW.renderAssignments();
  };
  window.swapProd = async function (i) {
    const d = PW.cur(); if (!d) return; const it = d.production[i];
    const ex = new Set([it.id].concat(d.production.map((x) => x.id)));
    const np = await nextProd(d.weekStart, ex, /^ad/i.test(it.format || ""), (d.weekStart || "") + "|prod|" + i); if (!np) { toast("Nothing new of that kind right now", true); return; }
    d.production[i] = pick(np, { pillar: np.pillar }); PW.syncWeek(); PW.renderProduction();
  };

  // ── the direction box: talk to the engine ──
  function mount() {
    const host = $("fortnight"); if (!host || $("ask-engine")) return;
    const coaches = (PW.COACHES || []).map((c) => c.name);
    const box = document.createElement("div"); box.className = "card"; box.id = "ask-engine";
    box.innerHTML = '<div class="card-label">Ask the engine <span class="small muted" id="eng-status">· new ideas on the spot, in the coach\'s voice, never a repeat</span></div>' +
      '<div class="eng-row"><textarea id="eng-dir" rows="2" placeholder="What are you looking for? e.g. more about the campus · tournament season · lighter on assessments · three carousels for Winter Camp parents"></textarea></div>' +
      '<div class="eng-row"><select id="eng-coach"><option value="Production">Production (carousels, statics, ads)</option>' + coaches.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("") + '</select><select id="eng-n"><option value="5">5 ideas</option><option value="3">3</option><option value="8">8</option></select><button class="btn" id="eng-go">⚡ Ask the engine</button><span class="small muted">Swap also uses this box: when a bank runs thin it thinks of five more in the direction you typed.</span></div>' +
      '<div id="eng-out"></div>';
    host.parentNode.insertBefore(box, host);
    try { const d = localStorage.getItem("eng-dir"); if (d) $("eng-dir").value = d; } catch (e) { /* noop */ }
    $("eng-dir").addEventListener("input", () => { try { localStorage.setItem("eng-dir", $("eng-dir").value); } catch (e) { /* noop */ } });
    $("eng-go").addEventListener("click", run);
    api("/marketing/ideas/status").then((s) => { if (!s.ready) $("eng-status").innerHTML = '· <b style="color:#5B1A5C">no key yet</b> — an owner pastes the Anthropic API key on the backend (Messages → Settings → Idea engine)'; }).catch(() => {});
  }
  async function run() {
    const btn = $("eng-go"), out = $("eng-out"), coach = $("eng-coach").value, n = Number($("eng-n").value) || 5;
    btn.disabled = true; btn.textContent = "Thinking…"; out.innerHTML = '<div class="small muted" style="padding:10px 0">Reading the record and writing ' + n + " new ideas for " + esc(coach) + "…</div>";
    try {
      const list = await ask(coach, n);
      if (!list.length) { out.innerHTML = '<div class="notice">Nothing new came back — change the direction and try again.</div>'; return; }
      const [w1, w2] = PW.fnPair(PW.fnOf(PW.wsOf(new Date())));
      out.innerHTML = list.map((i) => '<div class="eng-idea"><div><b>' + esc(i.title) + '</b> <span class="st">' + esc(i.format) + "</span>" + (i.pillar ? ' <span class="small muted">' + esc(i.pillar) + "</span>" : "") + '<div class="small" style="margin-top:4px">' + esc(i.desc) + "</div>" + (i.hook ? '<div class="item-hook">' + esc(i.hook) + "</div>" : "") + '</div><div class="eng-use"><button class="btn ghost xs" data-use="' + esc(i.id) + '" data-ws="' + w1 + '">Put in week 1</button><button class="btn ghost xs" data-use="' + esc(i.id) + '" data-ws="' + w2 + '">Put in week 2</button></div></div>').join("") +
        '<div class="small muted" style="margin-top:8px">All ' + list.length + " are saved in " + (coach === "Production" ? "the production bank" : coach + "'s bank") + " too, so Swap will offer them.</div>";
      out.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => use(coach, b.dataset.use, b.dataset.ws, b)));
    } catch (e) { out.innerHTML = '<div class="notice warn">' + esc(e.message) + "</div>"; }
    finally { btn.disabled = false; btn.textContent = "⚡ Ask the engine"; }
  }
  function use(coach, id, ws, btn) {
    const w = S.weeks[ws]; if (!w) { toast("That week is not built yet — press Build the 2 weeks first", true); return; }
    if (coach === "Production") {
      const src = (S.prodBank || []).find((x) => x.id === id); if (!src) return;
      const slot = w.production.findIndex((p) => (/^ad/i.test(src.format || "") ? /^ad/i.test(p.format || "") : PW.isPostItem(p)) && !p.delivered);
      const p = pick(src, { pillar: src.pillar }); if (slot >= 0) { p.day = w.production[slot].day; w.production[slot] = p; } else { p.day = p.day || "Spare"; w.production.push(p); }
    } else {
      const src = (S.ideaBank[coach] || []).find((x) => x.id === id); if (!src) return;
      const c = w.coaches.find((x) => x.name === coach);
      if (!c) { toast(coach + " is not in that week — the idea is in the bank, Swap offers it next time", true); return; }
      const slot = c.ideas.findIndex((i) => !i.delivered); const p = pick(src);
      if (slot >= 0) { p.day = c.ideas[slot].day; c.ideas[slot] = p; } else { c.ideas.push(p); }
    }
    PW.fnSync(ws); btn.textContent = "✓ In the plan"; btn.disabled = true; toast("In the plan — approve it when it is right");
  }
  mount();
  PW.hooks.push(mount);
})();
