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
    const p = e.platforms || {};
    const tiles = PLATFORMS.map(([k, name]) => { const x = p[k] || {}; const n = x.replies7 == null ? "—" : x.replies7; return '<div class="stat"><div class="stat-label">' + esc(name) + '</div><div class="stat-num">' + esc(String(n)) + '</div><div class="small muted">' + esc(x.note || (x.last ? "last " + x.last : "")) + "</div></div>"; }).join("");
    const sc = e.score || {};
    const score = [["Conversations", sc.conversations], ["Clear", sc.clear], ["Unsure", sc.unsure], ["Wrong", sc.wrong], ["Handed to a person", sc.handed]].filter((x) => x[1] != null).map(([l, n]) => '<div class="stat"><div class="stat-label">' + l + '</div><div class="stat-num">' + esc(String(n)) + "</div></div>").join("");
    const wrong = (e.wrong || []).map((w) => '<div class="recur"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px">' + chip(w.kind || "wrong") + '<span class="small muted">' + esc(w.platform || "") + "</span></div>" + (w.quote ? '<div class="item-hook">' + esc(w.quote) + "</div>" : "") + '<div class="small">' + esc(w.why || "") + "</div>" + (w.fix ? '<div class="small" style="margin-top:4px"><b>Better:</b> ' + esc(w.fix) + "</div>" : "") + "</div>").join("");
    const qs = (e.questions || []).map((q) => '<div class="recur"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px">' + chip(q.status || "new") + "<b>" + esc(q.question || "") + '</b><span class="small muted">' + esc([q.platform, q.count ? q.count + "×" : ""].filter(Boolean).join(" · ")) + "</span></div>" + (q.howItAnswered ? '<div class="small muted">It said: ' + esc(q.howItAnswered) + "</div>" : "") + (q.betterAnswer ? '<div class="small"><b>Better:</b> ' + esc(q.betterAnswer) + "</div>" : "") + "</div>").join("");
    const handed = (e.handed || []).map((h) => '<div class="recur">· <span class="small muted">' + esc(h.platform || "") + "</span> " + esc(h.what || "") + "</div>").join("");
    const fixes = (e.fixes || []).map((f) => '<div class="recur">· ' + esc(typeof f === "string" ? f : f.text || "") + "</div>").join("");
    const hist = list.slice(1, 7).map((h) => '<div class="recur small">· ' + esc(day(h.date)) + " — " + esc(h.headline || "") + "</div>").join("");
    el.innerHTML =
      '<div class="small muted" style="margin-bottom:10px">Week ' + esc(e.week && e.week.from ? day(e.week.from) + " – " + day(e.week.to) : day(e.date)) + " · read " + esc(day(e.date)) + (e.headline ? " · " + esc(e.headline) : "") + "</div>" +
      '<div class="grid-4" style="margin-bottom:14px">' + tiles + "</div>" +
      (score ? '<div class="fhead"><b>The week</b></div><div class="grid-4" style="margin-bottom:14px">' + score + "</div>" : "") +
      (e.notice ? '<div class="notice" style="margin-bottom:14px">' + esc(e.notice) + "</div>" : "") +
      '<div class="fhead"><b>What it got wrong or left hanging</b></div>' + (wrong || '<div class="recur small muted">Nothing this week.</div>') +
      '<div class="fhead" style="margin-top:14px"><b>Questions we need a better answer for</b> <span class="small muted">· new ones, unsure ones, wrong ones</span></div>' + (qs || '<div class="recur small muted">None flagged.</div>') +
      '<div class="fhead" style="margin-top:14px"><b>Handed to a person</b></div>' + (handed || '<div class="recur small muted">None.</div>') +
      (fixes ? '<div class="fhead" style="margin-top:14px"><b>Fixes for the concierge</b> <span class="small muted">· what to add to its facts or rules</span></div>' + fixes : "") +
      (hist ? '<div class="fhead" style="margin-top:14px"><b>Earlier weeks</b></div>' + hist : "");
  }
  mount();
  PW.hooks.push(() => { mount(); render(); });
})();
