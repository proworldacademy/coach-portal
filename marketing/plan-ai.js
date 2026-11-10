/* The plan assistant on Create (Antonio, Nov 9, 2026): a small window under Generate where the marketing manager talks to the brain
   about the month's CONTENT — "move the ITF post to the day of the qualifier", "the last-spots ad goes three days before the camp",
   "add a drone video of the campus" — and it makes the changes on the calendar, with Undo. Engine side: POST /api/marketing/plan
   (functions/lib/plan.js). Nothing here touches how the app works. Loaded after create.js. */
(function () {
  const PW = window.PW, PWM = window.PWM; if (!PW || !PWM || !document.getElementById("tab-screate")) return;
  const { S, $, esc } = PW;
  let HIST = []; let SNAP = null;
  // the conversation lives for one day (Antonio, Nov 9: "make sure the conversation is clear every day"); kept in this browser only
  const DAY = () => new Date().toISOString().slice(0, 10);
  const KEY = "pa-chat";
  function load() { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.day === DAY() && Array.isArray(s.hist)) HIST = s.hist.slice(-20); else localStorage.removeItem(KEY); } catch (e) {} }
  function store() { try { localStorage.setItem(KEY, JSON.stringify({ day: DAY(), hist: HIST.slice(-20) })); } catch (e) {} }

  async function token() { const u = window.firebase && firebase.auth && firebase.auth().currentUser; return u ? u.getIdToken() : ""; }
  async function api(body) {
    const t = await token(); if (!t) throw new Error("Sign in first.");
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 75000);
    let r; try { r = await fetch("/api/marketing/plan", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t }, body: JSON.stringify(body), signal: ac.signal }); }
    catch (e) { throw new Error(e && e.name === "AbortError" ? "No answer after 75 seconds — send it again." : "No connection — check the network and send it again."); }
    finally { clearTimeout(tm); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j && j.message ? j.message : "The assistant did not answer (" + r.status + ")."); return j;
  }
  const DAYN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dateOf = (ws, day) => { const k = DAYN.indexOf(day); if (k < 0) return ""; const d = new Date(ws + "T12:00:00"); d.setDate(d.getDate() + 1 + k); return d.toISOString().slice(0, 10); };
  function compact() {
    return PWM.weeks().filter((ws) => S.weeks[ws]).map((ws) => { const w = S.weeks[ws]; return { ws, dates: w.weekDates || PW.weekLabel(ws), locked: !!w.locked, items: PW.fnItems(ws).map((x) => ({ id: x.it.id, day: x.it.day, date: dateOf(ws, x.it.day), who: x.who, kind: x.kind, format: x.it.format, title: x.it.title, hook: x.it.hook, desc: x.it.desc, posted: PW.isDone(ws, x.it) })) }; });
  }
  // ── applying the operations ──
  function find(id) { for (const ws of Object.keys(S.weeks)) { const w = S.weeks[ws]; for (let ci = 0; ci < (w.coaches || []).length; ci++) { const ii = w.coaches[ci].ideas.findIndex((i) => i.id === id); if (ii >= 0) return { ws, w, kind: "idea", ci, ii, it: w.coaches[ci].ideas[ii], coach: w.coaches[ci] }; } const pi = (w.production || []).findIndex((p) => p.id === id); if (pi >= 0) return { ws, w, kind: "prod", pi, it: w.production[pi] }; } return null; }
  function detach(f) { if (f.kind === "idea") { f.coach.ideas.splice(f.ii, 1); if (!f.coach.ideas.length && !f.w.locked) f.w.coaches.splice(f.ci, 1); return { it: f.it, coach: f.coach.name, role: f.coach.role }; } f.w.production.splice(f.pi, 1); return { it: f.it }; }
  function attach(ws, rec, day) { const w = S.weeks[ws]; if (!w) return false; rec.it.day = day; if (rec.coach) { let c = (w.coaches || []).find((k) => k.name === rec.coach); if (!c) { const def = (PW.COACHES || []).find((k) => k.name === rec.coach); c = { name: rec.coach, role: def ? def.role : rec.role || "", ideas: [] }; w.coaches.push(c); } c.ideas.push(rec.it); } else w.production.push(rec.it); return true; }
  function apply(ops) {
    const done = []; const touched = new Set();
    ops.forEach((o) => {
      try {
        if (o.op === "move") { const f = find(o.id); if (!f || PW.isDone(f.ws, f.it)) return; const ws = o.ws && S.weeks[o.ws] ? o.ws : f.ws; const day = DAYN.includes(o.day) ? o.day : "Spare";
          const other = PW.fnItems(ws).find((x) => x.it.day === day && x.it.id !== o.id && DAYN.includes(day)); const fromDay = f.it.day, fromWs = f.ws;
          if (ws === f.ws) { f.it.day = day; if (other) other.it.day = fromDay; } else { const rec = detach(f); attach(ws, rec, day); if (other) { const of = find(other.it.id); const orec = detach(of); attach(fromWs, orec, fromDay); } }
          touched.add(ws); touched.add(fromWs); done.push("moved “" + f.it.title + "” to " + day + (other ? " (swapped with “" + other.it.title + "”)" : "")); }
        else if (o.op === "remove") { const f = find(o.id); if (!f || PW.isDone(f.ws, f.it)) return; detach(f); touched.add(f.ws); done.push("removed “" + f.it.title + "”"); }
        else if (o.op === "edit") { const f = find(o.id); if (!f) return; ["title", "hook", "desc", "format"].forEach((k) => { if (typeof o[k] === "string" && o[k].trim()) f.it[k] = o[k].trim(); }); f.it.custom = true;
          if (o.who && f.kind === "idea" && o.who !== f.coach.name) { const rec = detach(f); rec.coach = o.who; const def = (PW.COACHES || []).find((k) => k.name === o.who); rec.role = def ? def.role : ""; attach(f.ws, rec, f.it.day); }
          touched.add(f.ws); done.push("edited “" + f.it.title + "”"); }
        else if (o.op === "add") { const ws = o.ws && S.weeks[o.ws] ? o.ws : PWM.weeks().find((x) => S.weeks[x]); if (!ws) return; const day = DAYN.includes(o.day) ? o.day : "Spare";
          const it = { id: "ai_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e4), title: String(o.title || "New post").slice(0, 120), hook: String(o.hook || "").slice(0, 200), desc: String(o.desc || "").slice(0, 600), format: o.format || "Talking Head", day, delivered: false, approved: false, custom: true, by: "assistant" };
          const who = o.who && o.who !== "Production" ? o.who : ""; if (!who) it.pillar = /^ad/i.test(it.format) ? "promo" : "culture";
          attach(ws, { it, coach: who }, day); touched.add(ws); done.push("added “" + it.title + "” on " + day + (who ? " for " + who : "")); }
      } catch (e) { console.error(e); }
    });
    if (touched.size) PW.fnSync(Array.from(touched)[0]);
    return done;
  }
  // ── the window ──
  let box = null;   // kept across the calendar's redraws (create.js rebuilds its container), so the conversation stays
  function mount() {
    const gen = $("gen-card"); if (!gen) return;
    if (box) { if (box.previousElementSibling !== gen) gen.insertAdjacentElement("afterend", box); return; }
    box = document.createElement("div"); box.className = "card"; box.id = "plan-ai";
    box.innerHTML = '<div class="card-label">Ask about the plan <span class="small muted">· it moves, swaps, edits, adds or removes posts on this month\'s calendar · nothing else · <a href="#" id="pa-clear">clear</a></span></div>' +
      '<div id="pa-log" class="pa-log"></div>' +
      '<div class="pa-row"><textarea id="pa-in" rows="2" placeholder="e.g. The Delray ITF post is 13 days late — put it on the day of the qualifier. · Move the last-spots ad to the 3 days before camp. · Add a drone video of the campus for Nico."></textarea>' +
      '<button class="btn ghost" id="pa-mic" type="button" title="Dictate" aria-label="Dictate">🎙</button><button class="btn pri" id="pa-go">Send</button></div>' +
      '<div class="small muted" id="pa-note"></div>';
    gen.insertAdjacentElement("afterend", box);
    $("pa-go").addEventListener("click", send);
    $("pa-in").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); });
    $("pa-clear").addEventListener("click", (e) => { e.preventDefault(); HIST = []; SNAP = null; store(); $("pa-log").innerHTML = ""; });
    load(); HIST.forEach((h) => line(h.role === "assistant" ? "ai" : "me", esc(h.text).replace(/\n/g, "<br>")));
    dictation();
  }
  // ── dictation (the browser's own speech recognition; Chrome, Safari, the iPhone) ──
  let REC = null, listening = false;
  function dictation() {
    const mic = $("pa-mic"), inp = $("pa-in"), note = $("pa-note");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { mic.style.display = "none"; return; }
    let base = "";
    const stop = () => { listening = false; mic.classList.remove("on"); mic.textContent = "🎙"; note.textContent = ""; try { REC && REC.stop(); } catch (e) {} };
    mic.addEventListener("click", () => {
      if (listening) return stop();
      REC = new SR(); REC.lang = "en-US"; REC.interimResults = true; REC.continuous = true;
      base = inp.value.trim(); listening = true; mic.classList.add("on"); mic.textContent = "■"; note.textContent = "Listening… tap ■ when you are done, then Send.";
      REC.onresult = (e) => { let fin = "", tmp = ""; for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript + " "; else tmp += r[0].transcript; } inp.value = (base ? base + " " : "") + (fin + tmp).replace(/\s+/g, " ").trim(); };
      REC.onerror = (e) => { note.textContent = e.error === "not-allowed" ? "The browser blocked the microphone — allow it in the address bar and try again." : "Dictation stopped (" + e.error + ")."; listening = false; mic.classList.remove("on"); mic.textContent = "🎙"; };
      REC.onend = () => { if (listening) { try { REC.start(); } catch (e) { stop(); } } };
      try { REC.start(); } catch (e) { stop(); note.textContent = "Dictation is not available here."; }
    });
  }
  function line(role, html) { const log = $("pa-log"); const d = document.createElement("div"); d.className = "pa-msg " + role; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  async function send() {
    const inp = $("pa-in"), go = $("pa-go"), msg = inp.value.trim(); if (!msg) return;
    line("me", esc(msg)); const hist = HIST.slice(-8); HIST.push({ role: "user", text: msg }); store(); inp.value = ""; go.disabled = true; go.textContent = "Thinking…";
    const wait = line("ai", '<span class="pa-wait">Reading the month…</span>');
    try {
      const out = await api({ month: PWM.cur, weeks: compact(), message: msg, history: hist });
      SNAP = JSON.parse(JSON.stringify(S.weeks));
      const done = apply(out.ops || []);
      let reply = String(out.reply || "").trim();
      if (!reply) reply = done.length ? "Done — " + done.length + " change" + (done.length > 1 ? "s" : "") + " on the calendar:" : "I read it but had nothing to change and no answer came back. Say it another way and I will try again.";
      else if (done.length && !/\b(moved|added|removed|edited|changed|swapped|done)\b/i.test(reply)) reply += "\n\nDone — " + done.length + " change" + (done.length > 1 ? "s" : "") + ":";
      else if (!done.length && (out.ops || []).length) reply += "\n\nNothing changed: the posts named are already posted or not on this month.";
      HIST.push({ role: "assistant", text: reply }); store();
      wait.innerHTML = esc(reply).replace(/\n/g, "<br>") + (done.length ? '<ul class="pa-done">' + done.map((d) => "<li>" + esc(d) + "</li>").join("") + "</ul><button class=\"btn ghost xs\" id=\"pa-undo\">↶ Undo these changes</button>" : "");
      const u = $("pa-undo"); if (u) u.onclick = () => { if (!SNAP) return; Object.keys(S.weeks).forEach((k) => delete S.weeks[k]); Object.assign(S.weeks, SNAP); SNAP = null; PW.fnSync(PWM.weeks()[0]); u.textContent = "Undone"; u.disabled = true; };
    } catch (e) { wait.innerHTML = '<span style="color:#5B1A5C">' + esc(e.message) + "</span>"; HIST.pop(); store(); }
    finally { go.disabled = false; go.textContent = "Send"; const log = $("pa-log"); if (log) log.scrollTop = log.scrollHeight; }
  }
  mount();
  new MutationObserver(mount).observe($("create-plan") || document.body, { childList: true });
})();
