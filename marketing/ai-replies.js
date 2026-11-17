/* AI replies (Antonio, Oct 30, 2026): "one tab that says AI replies, where we start analyzing how the AI is answering… on all
   platforms… every week we review how it answers, where it can improve, questions we are not as good at". The concierge answers
   families on the website chat, Messenger, Instagram (ManyChat), WhatsApp and texts (JustCall) and reports in Slack #concierge every
   morning (the check) and every Sunday (its read-through). The Monday "AI replies" run reads those, grades the week against our
   facts and writes state/aiReplies (newest-first) + a report. This tab shows the newest entry. Never a parent's name or number. */
(function () {
  const PW = window.PW; if (!PW) return;
  const { S, $, esc } = PW;
  const PLATFORMS = [["website", "Website chat"], ["instagram", "Instagram"], ["messenger", "Messenger"], ["whatsapp", "WhatsApp"], ["text", "Text (SMS)"]];
  const KIND = { wrong: ["miss", "Wrong"], unsure: ["wait", "Unsure"], hanging: ["wait", "Left hanging"], self: ["plan", "Talked about itself"], loop: ["", "Repeated itself"], tone: ["plan", "Tone"], ok: ["ok", "Fine"], new: ["plan", "New question"], fix: ["miss", "Needs a better answer"] };
  const day = (d) => { if (!d) return ""; const x = new Date(String(d).length === 10 ? d + "T12:00:00" : d); return isNaN(x) ? String(d) : x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const chip = (k) => { const c = KIND[k] || ["", k]; return '<span class="st ' + c[0] + '">' + esc(c[1]) + "</span>"; };

  /* The owners' checklist (Nov 17, 2026 — Antonio: "a checklist: these are good, these are questionable, these are wrong and we need to
     fix"). Each line of the week gets three marks; whoever reads taps one. A mark keeps the line's own words, who marked it and when, in
     apps/marketing/aiMarks/<the week's date> (one small document a week, the same { json, at, by } shape as the rest of the record).
     Everything marked wrong, from any week, collects at the top as "To fix" until someone ticks it fixed; "Copy the list" hands it to
     whoever maintains the concierge. Never a parent's name or number: the lines are the run's own, already written without them. */
  const MARKS = { good: "Good", q: "Questionable", wrong: "Wrong, fix it" };
  const M = { byWeek: {}, loaded: false, busy: false };
  const fsdb = () => { try { return window.PWAuth && window.PWAuth.fs && window.PWAuth.fs(); } catch (e) { return null; } };
  const meCtx = () => { try { return (window.PWAuth && window.PWAuth.ctx) || {}; } catch (e) { return {}; } };
  const keyOf = (t) => { let h = 5381; const x = String(t || ""); for (let i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) >>> 0; return "k" + h.toString(36); };
  const weekId = (e) => String((e && e.date) || "week").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40) || "week";
  async function loadMarks() {
    const fs = fsdb(); if (!fs || M.busy) return; M.busy = true;
    try { const snap = await fs.collection("apps/marketing/aiMarks").get(); const out = {}; (snap.docs || []).forEach((d) => { try { const j = JSON.parse((d.data() || {}).json || "{}"); out[d.id] = (j.v && j.v.marks) || {}; } catch (e) { out[d.id] = {}; } }); M.byWeek = out; M.loaded = true; }
    catch (e) { M.loaded = true; }
    M.busy = false; render();
  }
  async function saveWeek(id) {
    const fs = fsdb(); if (!fs) return; const at = Date.now();
    await fs.doc("apps/marketing/aiMarks/" + id).set({ json: JSON.stringify({ v: { marks: M.byWeek[id] || {} }, at }), at, by: String(meCtx().email || "") });
  }
  async function setMark(id, key, mark, item) {
    const wk = M.byWeek[id] || (M.byWeek[id] = {}); const c = meCtx(); const cur = wk[key];
    if (cur && cur.m === mark) delete wk[key]; else wk[key] = Object.assign({ m: mark, by: String(c.name || c.email || "").split(/\s+/)[0], at: Date.now() }, item);
    render(); try { await saveWeek(id); } catch (e) { if (window.PWDesign) window.PWDesign.toast("That mark did not save. Try again.", true); await loadMarks(); }
  }
  async function setFixed(id, key) {
    const m = (M.byWeek[id] || {})[key]; if (!m) return; const c = meCtx();
    if (m.fixed) { delete m.fixed; delete m.fixedBy; } else { m.fixed = Date.now(); m.fixedBy = String(c.name || c.email || "").split(/\s+/)[0]; }
    render(); try { await saveWeek(id); } catch (e) { if (window.PWDesign) window.PWDesign.toast("That did not save. Try again.", true); await loadMarks(); }
  }
  const toFix = () => { const out = []; Object.keys(M.byWeek).forEach((id) => { const wk = M.byWeek[id] || {}; Object.keys(wk).forEach((k) => { if (wk[k].m === "wrong") out.push(Object.assign({ id, key: k }, wk[k])); }); }); return out.sort((a, b) => (a.fixed ? 1 : 0) - (b.fixed ? 1 : 0) || (b.at || 0) - (a.at || 0)); };
  const markRow = (id, key, item) => { const cur = (M.byWeek[id] || {})[key]; return '<div class="aim" data-aim="' + esc(id) + '" data-key="' + esc(key) + '" data-item="' + esc(JSON.stringify(item)) + '">' + Object.keys(MARKS).map((m) => '<button type="button" class="aimb ' + m + (cur && cur.m === m ? " on" : "") + '" data-m="' + m + '" aria-pressed="' + (cur && cur.m === m ? "true" : "false") + '">' + MARKS[m] + "</button>").join("") + (cur ? '<span class="small muted">' + esc(cur.by || "") + " · " + esc(day(new Date(cur.at).toISOString())) + "</span>" : "") + "</div>"; };
  const CSS = ".aim{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}.aimb{white-space:nowrap;flex:none;border:1px solid rgba(0,0,0,.18);background:none;color:inherit;border-radius:999px;font:700 12px/1 inherit;padding:8px 12px;min-height:34px;cursor:pointer}.aimb.on.good{background:#94FCB1;border-color:#0A0A0A;color:#0A0A0A}.aimb.on.q{background:#E2FE78;border-color:#0A0A0A;color:#0A0A0A}.aimb.on.wrong{background:#0A0A0A;border-color:#0A0A0A;color:#E2FE78}html.dark .aimb{border-color:rgba(255,255,255,.25)}html.dark .aimb.on.wrong{background:#E286E4;color:#0A0A0A;border-color:#E286E4}.aifix{border:1px solid rgba(0,0,0,.14);border-radius:16px;padding:12px 14px;margin-bottom:14px}html.dark .aifix{border-color:rgba(255,255,255,.18)}.aifix .recur.done{opacity:.55;text-decoration:line-through}.aifix .row2{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}";
  const css = () => { if (document.getElementById("aim-css")) return; const st = document.createElement("style"); st.id = "aim-css"; st.textContent = CSS; document.head.appendChild(st); };
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest(".aim .aimb"); if (b) { const row = b.closest(".aim"); let item = {}; try { item = JSON.parse(row.dataset.item || "{}"); } catch (e) { item = {}; } setMark(row.dataset.aim, row.dataset.key, b.dataset.m, item); return; }
    const f = ev.target.closest && ev.target.closest("[data-aifixed]"); if (f) { setFixed(f.dataset.aifixed, f.dataset.key); return; }
    const c = ev.target.closest && ev.target.closest("[data-aicopy]"); if (c) { const open = toFix().filter((x) => !x.fixed); const txt = "Concierge answers to fix (" + open.length + ")\n\n" + open.map((x, i) => (i + 1) + ". " + (x.platform ? "[" + x.platform + "] " : "") + (x.t || "") + (x.said ? "\n   It said: " + x.said : "") + (x.better ? "\n   Better: " + x.better : "")).join("\n\n"); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => window.PWDesign && window.PWDesign.toast("Copied. Paste it to whoever fixes the concierge.")).catch(() => window.PWDesign && window.PWDesign.toast("Could not copy on this device.", true)); }
  });

  // ── the tab and its button (classic view) or a card in ① Report (three steps) ──
  function mount() {
    if ($("ai-replies")) return;
    const card = document.createElement("div"); card.className = "card"; card.id = "ai-replies";
    const sReport = $("tab-sreport");
    if (sReport) { card.innerHTML = '<div class="card-label">AI replies <span class="small muted">· how the concierge answered families this week</span></div><div id="ai-body"></div>'; sReport.appendChild(card); }
    else {
      const nav = $("nav"), after = nav && nav.querySelector('.tab-btn[data-tab="reports"]');
      if (!after) return;
      const b = document.createElement("button"); b.className = "tab-btn"; b.dataset.tab = "aireplies"; b.textContent = "AI replies";
      after.insertAdjacentElement("afterend", b);
      const sec = document.createElement("section"); sec.className = "tab"; sec.id = "tab-aireplies";
      sec.innerHTML = '<div class="page-title">AI <em>replies</em></div><p class="page-sub">How the concierge answered families this week, on every platform it answers on: what was clear, what was unsure or wrong, the questions we need a better answer for. Read every Monday by the AI replies run.</p>';
      card.innerHTML = '<div id="ai-body"></div>'; sec.appendChild(card);
      const home = $("tab-home"); home.parentNode.insertBefore(sec, home.nextSibling);
      b.addEventListener("click", () => { document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active")); document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active")); sec.classList.add("active"); b.classList.add("active"); window.scrollTo(0, 0); });
      if (location.hash === "#aireplies") b.click();
    }
    render();
  }

  function render() {
    const el = $("ai-body"); if (!el) return;
    const list = Array.isArray(S.aiReplies) ? S.aiReplies : [];
    const e = list[0];
    if (!e) { el.innerHTML = '<div class="empty">Nothing read yet. The AI replies run reads the concierge every Monday at 7:35 AM (the daily checks, its Sunday read-through and every hand-over in Slack #concierge) and writes the week here: volume per platform, what it got wrong, the questions we need a better answer for.</div>'; return; }
    css(); if (!M.loaded && !M.busy) loadMarks();
    const wid = weekId(e); const fx = toFix(); const openN = fx.filter((x) => !x.fixed).length;
    const fixBox = fx.length ? '<div class="aifix"><div class="row2"><div class="fhead" style="margin:0"><b>To fix</b> <span class="small muted">· ' + openN + " open" + (fx.length - openN ? " · " + (fx.length - openN) + " fixed" : "") + '</span></div>' + (openN ? '<button type="button" class="aimb" data-aicopy>Copy the list</button>' : "") + "</div>" + fx.map((x) => '<div class="recur' + (x.fixed ? " done" : "") + '"><div class="row2"><div><span class="small muted">' + esc(x.platform || "") + "</span> " + esc(x.t || "") + (x.better ? '<div class="small"><b>Better:</b> ' + esc(x.better) + "</div>" : "") + '<div class="small muted">marked by ' + esc(x.by || "") + (x.fixed ? " · fixed by " + esc(x.fixedBy || "") : "") + '</div></div><button type="button" class="aimb' + (x.fixed ? " on good" : "") + '" data-aifixed="' + esc(x.id) + '" data-key="' + esc(x.key) + '">' + (x.fixed ? "Fixed ✓" : "Mark fixed") + "</button></div></div>").join("") + "</div>" : "";
    const p = e.platforms || {};
    const tiles = PLATFORMS.map(([k, name]) => { const x = p[k] || {}; const n = x.replies7 == null ? "—" : x.replies7; return '<div class="stat"><div class="stat-label">' + esc(name) + '</div><div class="stat-num">' + esc(String(n)) + '</div><div class="small muted">' + esc(x.note || (x.last ? "last " + x.last : "")) + "</div></div>"; }).join("");
    const sc = e.score || {};
    const score = [["Conversations", sc.conversations], ["Clear", sc.clear], ["Unsure", sc.unsure], ["Wrong", sc.wrong], ["Handed to a person", sc.handed]].filter((x) => x[1] != null).map(([l, n]) => '<div class="stat"><div class="stat-label">' + l + '</div><div class="stat-num">' + esc(String(n)) + "</div></div>").join("");
    const wrong = (e.wrong || []).map((w) => '<div class="recur"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px">' + chip(w.kind || "wrong") + '<span class="small muted">' + esc(w.platform || "") + "</span></div>" + (w.quote ? '<div class="item-hook">' + esc(w.quote) + "</div>" : "") + '<div class="small">' + esc(w.why || "") + "</div>" + (w.fix ? '<div class="small" style="margin-top:4px"><b>Better:</b> ' + esc(w.fix) + "</div>" : "") + markRow(wid, keyOf("w|" + (w.quote || "") + "|" + (w.why || "")), { t: String(w.quote || w.why || "").slice(0, 400), said: "", better: String(w.fix || "").slice(0, 400), platform: String(w.platform || "").slice(0, 40) }) + "</div>").join("");
    const qs = (e.questions || []).map((q) => '<div class="recur"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px">' + chip(q.status || "new") + "<b>" + esc(q.question || "") + '</b><span class="small muted">' + esc([q.platform, q.count ? q.count + "×" : ""].filter(Boolean).join(" · ")) + "</span></div>" + (q.howItAnswered ? '<div class="small muted">It said: ' + esc(q.howItAnswered) + "</div>" : "") + (q.betterAnswer ? '<div class="small"><b>Better:</b> ' + esc(q.betterAnswer) + "</div>" : "") + markRow(wid, keyOf("q|" + (q.question || "")), { t: String(q.question || "").slice(0, 400), said: String(q.howItAnswered || "").slice(0, 400), better: String(q.betterAnswer || "").slice(0, 400), platform: String(q.platform || "").slice(0, 40) }) + "</div>").join("");
    const handed = (e.handed || []).map((h) => '<div class="recur">· <span class="small muted">' + esc(h.platform || "") + "</span> " + esc(h.what || "") + "</div>").join("");
    const fixes = (e.fixes || []).map((f) => '<div class="recur">· ' + esc(typeof f === "string" ? f : f.text || "") + "</div>").join("");
    const hist = list.slice(1, 7).map((h) => '<div class="recur small">· ' + esc(day(h.date)) + " — " + esc(h.headline || "") + "</div>").join("");
    el.innerHTML =
      '<div class="small muted" style="margin-bottom:10px">Week ' + esc(e.week && e.week.from ? day(e.week.from) + " – " + day(e.week.to) : day(e.date)) + " · read " + esc(day(e.date)) + (e.headline ? " · " + esc(e.headline) : "") + "</div>" + fixBox +
      '<div class="grid-4" style="margin-bottom:14px">' + tiles + "</div>" +
      (score ? '<div class="fhead"><b>The week</b></div><div class="grid-4" style="margin-bottom:14px">' + score + "</div>" : "") +
      (e.notice ? '<div class="notice" style="margin-bottom:14px">' + esc(e.notice) + "</div>" : "") +
      '<div class="fhead"><b>What it got wrong or left hanging</b> <span class="small muted">· mark each one as you read</span></div>' + (wrong || '<div class="recur small muted">Nothing this week.</div>') +
      '<div class="fhead" style="margin-top:14px"><b>Questions we need a better answer for</b> <span class="small muted">· new ones, unsure ones, wrong ones</span></div>' + (qs || '<div class="recur small muted">None flagged.</div>') +
      '<div class="fhead" style="margin-top:14px"><b>Handed to a person</b></div>' + (handed || '<div class="recur small muted">None.</div>') +
      (fixes ? '<div class="fhead" style="margin-top:14px"><b>Fixes for the concierge</b> <span class="small muted">· what to add to its facts or rules</span></div>' + fixes : "") +
      (hist ? '<div class="fhead" style="margin-top:14px"><b>Earlier weeks</b></div>' + hist : "");
  }
  mount();
  PW.hooks.push(() => { mount(); render(); });
})();
