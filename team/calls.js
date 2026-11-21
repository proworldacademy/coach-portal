/* PROWORLD — Team calls (Nov 15, 2026): voice and video between the people of a chat, inside the app.
   The phones and computers talk to each other directly (WebRTC, one link between every two people: right for a direct call or a small
   group, up to about six). The database only carries the hand-shake:
     teamCalls/<id>                 { chat, kind: 'audio' | 'video', by, byName, title, members: [e-mail], at, state: 'live' | 'ended' }
     teamCalls/<id>/peers/<e-mail>  { at (kept fresh every 15 s), name, cam, mic }           who is in the call right now
     teamCalls/<id>/sig/<auto>      { from, to, type: 'offer' | 'answer' | 'ice', data, at }  read only by the one it is for, cleared once read
   Between two people, the one whose address sorts first makes the offer, so two phones never offer at the same moment. Everyone always
   has a sound line and a picture line open; turning the camera on, off or to the screen swaps what is sent without a new hand-shake.
   The engine gives the relay servers (/api/team/ice) and rings the others (/api/team/ring).
   The rest of the app while you talk (Nov 21, 2026 — "if I come out of the calling window, everything is gone"): a call lives in this
   page, so opening another section used to end it. While a call is on, a link to another section opens over this page instead (a
   frame), the call keeps going underneath, and a pill "On a call · 02:14 · tap to return" stays on the screen. When the call ends the
   section opens for real. A link back to the Locker Room closes the frame.
   window.PWCall.init({ fs, me, name, api, toast, chatOf, titleOf }) · start(chatId, 'audio' | 'video') · join(callId, wantVideo) · active() */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => (String(n || "").trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const FRESH = 45000; const BEAT = 15000; const MAX = 8;
  let X = null;            // what the page gave us
  let C = null;            // the call we are in
  const STYLE = '.pc-wrap{position:fixed;inset:0;z-index:90;background:#0A0A0A;color:#fff;display:flex;flex-direction:column;font-family:var(--body,system-ui)}' +
    '.pc-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(14px + env(safe-area-inset-top,0px)) 18px 10px}.pc-top b{font:700 16px var(--body,system-ui)}.pc-top small{display:block;color:rgba(255,255,255,.6);font-size:12.5px;margin-top:2px}' +
    '.pc-min{border:1px solid rgba(255,255,255,.25);background:none;color:#fff;border-radius:999px;font:700 12px var(--body,system-ui);padding:8px 12px;cursor:pointer}' +
    '.pc-grid{flex:1;min-height:0;display:grid;gap:10px;padding:6px 12px;grid-template-columns:repeat(var(--pc-cols,1),minmax(0,1fr));grid-auto-rows:minmax(0,1fr)}' +
    '.pc-tile{position:relative;border-radius:20px;overflow:hidden;background:#1a1a1a;display:grid;place-items:center;min-height:0}.pc-tile video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#1a1a1a}.pc-tile.screen video{object-fit:contain}' +
    '.pc-tile .av{width:92px;height:92px;border-radius:28px;background:#E2FE78;color:#0A0A0A;display:grid;place-items:center;font:700 30px var(--body,system-ui);z-index:1}.pc-tile.cam .av{display:none}' +
    '.pc-tile .nm{position:absolute;left:10px;bottom:10px;z-index:2;background:rgba(0,0,0,.55);border-radius:999px;padding:5px 10px;font:700 12px var(--body,system-ui)}.pc-tile .st{position:absolute;right:10px;top:10px;z-index:2;background:rgba(0,0,0,.55);border-radius:999px;padding:5px 9px;font:400 11.5px var(--body,system-ui)}' +
    '.pc-wait{margin:auto;text-align:center;color:rgba(255,255,255,.7);font:400 15px/1.5 var(--body,system-ui);padding:20px}.pc-wait b{display:block;font-family:var(--display,inherit);font-style:italic;font-weight:800;text-transform:uppercase;font-size:34px;color:#E2FE78;line-height:1;margin-bottom:8px}' +
    '.pc-self{position:absolute;right:16px;bottom:calc(118px + env(safe-area-inset-bottom,0px));width:104px;height:150px;border-radius:16px;overflow:hidden;background:#222;border:2px solid rgba(255,255,255,.2);z-index:3;display:none}.pc-self.on{display:block}.pc-self video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}.pc-self.back video,.pc-self.screen video{transform:none}' +
    '.pc-bar{display:flex;justify-content:center;gap:12px;padding:14px 12px calc(18px + env(safe-area-inset-bottom,0px));flex-wrap:wrap}' +
    '.pc-b{min-width:64px;height:64px;border-radius:22px;border:0;background:#262626;color:#fff;font:700 11.5px var(--body,system-ui);cursor:pointer;display:grid;place-items:center;padding:6px 10px;line-height:1.2}.pc-b i{display:block;font-style:normal;font-size:20px;margin-bottom:2px}.pc-b.off{background:#fff;color:#0A0A0A}.pc-b.end{background:#F06A5E;color:#0A0A0A}.pc-b.on{background:#E2FE78;color:#0A0A0A}' +
    '.pc-pill{position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px));z-index:89;background:#E2FE78;color:#0A0A0A;border:0;border-radius:999px;font:700 13px "Aeonik Pro",var(--body,system-ui);padding:10px 16px;cursor:pointer;box-shadow:0 10px 30px -10px rgba(0,0,0,.6);display:flex;align-items:center;gap:8px;white-space:nowrap;max-width:calc(100vw - 24px)}' +
    '.pc-pill i{width:8px;height:8px;border-radius:50%;background:#0A0A0A;flex:none;animation:pc-dot 1.4s ease-in-out infinite}.pc-pill span{font-variant-numeric:tabular-nums;font-weight:400}.pc-pill em{font-style:normal;font-weight:400;opacity:.7;overflow:hidden;text-overflow:ellipsis}@keyframes pc-dot{50%{opacity:.25}}@media(prefers-reduced-motion:reduce){.pc-pill i{animation:none}}' +
    '@media(max-width:640px){.pc-pill{top:calc(70px + env(safe-area-inset-top,0px))}}.pc-pill.low{top:auto;bottom:calc(96px + env(safe-area-inset-bottom,0px))}@media(min-width:641px){.pc-pill.low{bottom:24px}}' +
    '.pc-browse{position:fixed;inset:0;z-index:80;background:#F1F1ED;display:flex;box-sizing:border-box}.pc-browse.pad{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}.pc-browse iframe{flex:1;min-width:0;width:100%;height:100%;border:0;background:#F1F1ED}' +
    '@media(min-width:761px){.pc-self{width:170px;height:118px;bottom:118px}.pc-grid{padding:10px 24px}}';
  function css() { if (document.getElementById("pc-css")) return; const st = document.createElement("style"); st.id = "pc-css"; st.textContent = STYLE; document.head.appendChild(st); }
  const say = (m, bad) => { try { X.toast(m, bad); } catch (e) { /* no toast */ } };

  /* ── sound and picture from this device ── */
  async function media(wantVideo) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser cannot make calls.");
    let s = null;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: wantVideo ? { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } } : false }); }
    catch (e) { if (!wantVideo) throw e; s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); say("The camera is not available: joining with sound only."); }
    return s;
  }
  const micTrack = () => (C && C.stream ? C.stream.getAudioTracks()[0] : null) || null;
  const camTrack = () => (C ? C.video : null) || null;

  /* ── one link to one other person ── */
  function link(email, sid) {
    sid = sid || (C.peers[email] || {}).s || "";
    if (C.pcs[email] && sid && C.pcs[email].sid && C.pcs[email].sid !== sid) unlink(email);   // they left and came back: a new link
    if (C.pcs[email]) { if (sid && !C.pcs[email].sid) C.pcs[email].sid = sid; return C.pcs[email]; }
    if (C.me < email && !sid) return null;   // we offer once we know which visit of theirs we are talking to
    const pc = new RTCPeerConnection({ iceServers: C.ice });
    const L = { pc, email, sid, queue: [], remote: new MediaStream(), offerer: C.me < email, made: false };
    C.pcs[email] = L;
    pc.onicecandidate = (e) => { if (e.candidate) sig(email, "ice", JSON.stringify(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate)); };
    pc.ontrack = (e) => { if (!L.remote.getTracks().includes(e.track)) L.remote.addTrack(e.track); e.track.onunmute = () => paint(); e.track.onmute = () => paint(); paint(); };
    pc.onconnectionstatechange = () => { if (!C || C.pcs[email] !== L) return; if (pc.connectionState === "failed" && L.offerer) offer(L, true); if (pc.connectionState === "connected" && !C.since) C.since = Date.now(); paint(); };
    if (L.offerer) {
      const a = pc.addTransceiver("audio", { direction: "sendrecv" }); const v = pc.addTransceiver("video", { direction: "sendrecv" });
      if (micTrack()) a.sender.replaceTrack(micTrack()); if (camTrack()) v.sender.replaceTrack(camTrack());
      offer(L, false);
    }
    return L;
  }
  async function offer(L, restart) { try { const o = await L.pc.createOffer(restart ? { iceRestart: true } : undefined); await L.pc.setLocalDescription(o); L.made = true; sig(L.email, "offer", JSON.stringify(L.pc.localDescription)); } catch (e) { /* the next beat tries again */ } }
  async function onSig(m) {
    if (!C || !m || !m.from || m.from === C.me || m.ts !== C.sid) return;   // a line for an earlier visit of ours
    const L = link(m.from, m.fs); if (!L) return; const pc = L.pc; let data = null; try { data = JSON.parse(m.data); } catch (e) { return; }
    try {
      if (m.type === "offer") {
        await pc.setRemoteDescription(data);
        const trs = pc.getTransceivers(); const a = trs.find((t) => t.receiver.track && t.receiver.track.kind === "audio"); const v = trs.find((t) => t.receiver.track && t.receiver.track.kind === "video");
        if (a) { a.direction = "sendrecv"; if (micTrack()) await a.sender.replaceTrack(micTrack()); } if (v) { v.direction = "sendrecv"; if (camTrack()) await v.sender.replaceTrack(camTrack()); }
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); sig(m.from, "answer", JSON.stringify(pc.localDescription));
      } else if (m.type === "answer") { if (pc.signalingState === "have-local-offer") await pc.setRemoteDescription(data); }
      else if (m.type === "ice") { if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(data); else L.queue.push(data); return; }
      while (L.queue.length) { try { await pc.addIceCandidate(L.queue.shift()); } catch (e) { /* a late candidate */ } }
    } catch (e) { /* a hand-shake line that no longer fits: the next one will */ }
  }
  function sig(to, type, data) { if (!C) return; const L = C.pcs[to]; if (!L || !L.sid) return; X.fs.collection("teamCalls/" + C.id + "/sig").add({ from: C.me, to, type, data, at: Date.now(), fs: C.sid, ts: L.sid }).catch(() => {}); }
  function unlink(email) { const L = C && C.pcs[email]; if (!L) return; try { L.pc.close(); } catch (e) { /* closed */ } delete C.pcs[email]; }
  const senders = (kind) => Object.keys(C.pcs).map((e) => { const t = C.pcs[e].pc.getTransceivers().find((x) => (x.receiver.track && x.receiver.track.kind === kind)); return t ? t.sender : null; }).filter(Boolean);

  /* ── the rest of the app while you talk ── */
  let F = null;            // the section opened over this page: { wrap, frame }
  const TEAM_PATH = /^\/team(\/|$)/;
  const clockOf = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(t / 60), sec = t % 60; return (m >= 60 ? Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(sec).padStart(2, "0"); };
  function tick() { const p = document.getElementById("pc-pill"); if (!p || !C) return; const sp = p.querySelector("span"); if (sp) sp.textContent = C.since ? clockOf(Date.now() - C.since) : "Calling…"; }
  function inset(doc) { try { const pr = doc.createElement("div"); pr.style.cssText = "position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none"; doc.body.appendChild(pr); const h = pr.getBoundingClientRect().height; pr.remove(); return h; } catch (e) { return 0; } }
  function closeBrowse() { if (!F) return ""; let href = ""; try { href = F.frame.contentWindow.location.href; } catch (e) { href = ""; } F.wrap.remove(); F = null; if (C) paint(); return href; }
  function frameLoaded() {
    if (!F) return; let w = null, d = null, path = "";
    try { w = F.frame.contentWindow; d = w.document; path = w.location.pathname; } catch (e) { return; }   // another site's page (a card payment): left alone
    if (TEAM_PATH.test(path)) { const h = w.location.hash; closeBrowse(); if (h && h !== location.hash) location.hash = h; return; }
    try { d.addEventListener("click", (e) => { const a = e.target && e.target.closest ? e.target.closest("a[href]") : null; if (!a) return; let u; try { u = new URL(a.getAttribute("href"), w.location.href); } catch (x) { return; }
      if (u.origin === location.origin && TEAM_PATH.test(u.pathname)) { e.preventDefault(); e.stopPropagation(); closeBrowse(); if (u.hash && u.hash !== location.hash) location.hash = u.hash; } }, true); } catch (e) { /* the frame works without it */ }
    F.wrap.classList.toggle("pad", inset(document) > 0 && inset(d) < 1);   // a phone that gives the notch's room to this page only: the frame is kept inside it
  }
  function browse(href) {
    if (!C) return false; css();
    if (!F) { const wrap = document.createElement("div"); wrap.id = "pc-browse"; wrap.className = "pc-browse"; const frame = document.createElement("iframe"); frame.title = "ProWorld"; frame.setAttribute("allow", "clipboard-write; microphone; camera"); frame.addEventListener("load", frameLoaded); wrap.appendChild(frame); document.body.appendChild(wrap); F = { wrap, frame }; }
    F.frame.src = href; C.min = true; paint(); return true;
  }
  document.addEventListener("click", (e) => {
    if (!C || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null; if (!a || a.target === "_blank" || a.hasAttribute("download") || a.closest("#pc-wrap")) return;
    let u; try { u = new URL(a.getAttribute("href"), location.href); } catch (x) { return; }
    if (u.origin !== location.origin || TEAM_PATH.test(u.pathname)) return;
    e.preventDefault(); e.stopPropagation(); browse(u.href);
  }, true);
  /* a call you are in no longer needs its notification: the one that is ringing is taken off the phone's screen (the App Store app) */
  function clearNote(id) {
    try { const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications; if (!P || !P.getDeliveredNotifications) return;
      P.getDeliveredNotifications().then((r) => { const mine = ((r && r.notifications) || []).filter((n) => String((n.data && n.data.url) || "").indexOf("/call/" + id) >= 0); if (mine.length) P.removeDeliveredNotifications({ notifications: mine }).catch(() => {}); }, () => {}); } catch (e) { /* nothing to clear */ }
  }

  /* ── the screen of the call ── */
  function paint() {
    if (!C) return; css(); let w = document.getElementById("pc-wrap");
    if (C.min) { if (w) w.style.display = "none"; let p = document.getElementById("pc-pill"); if (!p) { p = document.createElement("button"); p.id = "pc-pill"; p.className = "pc-pill"; p.type = "button"; p.onclick = () => { C.min = false; paint(); }; p.innerHTML = "<i></i><b>On a call</b><span></span><em>Tap to return</em>"; document.body.appendChild(p); }
      p.classList.toggle("low", !!F); p.setAttribute("aria-label", "On a call, " + C.title + ". Tap to return to the call."); tick(); if (!C.clock) C.clock = setInterval(tick, 1000); return; }
    const pill = document.getElementById("pc-pill"); if (pill) pill.remove(); if (C.clock) { clearInterval(C.clock); C.clock = 0; }
    if (!w) { w = document.createElement("div"); w.id = "pc-wrap"; w.className = "pc-wrap"; w.setAttribute("role", "dialog"); w.setAttribute("aria-label", "Call");
      w.innerHTML = '<div class="pc-top"><div><b id="pc-title"></b><small id="pc-sub"></small></div><button type="button" class="pc-min" data-pc="min" id="pc-min">Back to the chat</button></div><div class="pc-grid" id="pc-grid"></div><div class="pc-self" id="pc-self"><video autoplay playsinline muted></video></div><div class="pc-bar" id="pc-bar"></div>';
      w.addEventListener("click", (e) => { const b = e.target.closest("[data-pc]"); if (!b) return; const a = b.dataset.pc; if (a === "min") { C.min = true; paint(); } else if (a === "mic") toggleMic(); else if (a === "cam") toggleCam(); else if (a === "flip") flip(); else if (a === "screen") toggleScreen(); else if (a === "end") leave(); });
      document.body.appendChild(w); }
    w.style.display = "flex"; document.getElementById("pc-min").textContent = F ? "Back" : "Back to the chat";
    const others = Object.keys(C.peers).filter((e) => e !== C.me).sort();
    document.getElementById("pc-title").textContent = (C.kind === "video" ? "Video call" : "Call") + " · " + C.title;
    document.getElementById("pc-sub").textContent = others.length ? (others.length + 1) + " in the call" : "Ringing the others…";
    const grid = document.getElementById("pc-grid"); grid.style.setProperty("--pc-cols", String(others.length <= 1 ? 1 : others.length <= 4 ? 2 : 3));
    const keep = {};
    others.forEach((e) => { const L = C.pcs[e]; const p = C.peers[e] || {}; let t = grid.querySelector('[data-peer="' + CSS.escape(e) + '"]');
      if (!t) { t = document.createElement("div"); t.className = "pc-tile"; t.dataset.peer = e; t.innerHTML = '<video autoplay playsinline></video><span class="av"></span><span class="nm"></span><span class="st" hidden></span>'; grid.appendChild(t); }
      keep[e] = 1; const v = t.querySelector("video"); if (L && v.srcObject !== L.remote) { v.srcObject = L.remote; const pl = v.play(); if (pl && pl.catch) pl.catch(() => {}); }
      const vt = L ? L.remote.getVideoTracks()[0] : null; const showing = !!(p.cam && vt && !vt.muted);
      t.classList.toggle("cam", showing); t.classList.toggle("screen", p.cam === "screen"); t.querySelector(".av").textContent = initials(p.name || e); t.querySelector(".nm").textContent = (p.name || e.split("@")[0]) + (p.mic === false ? " · muted" : "");
      const st = t.querySelector(".st"); const cs = L ? L.pc.connectionState : "new"; st.hidden = cs === "connected"; st.textContent = cs === "failed" ? "Cannot connect" : "Connecting…"; });
    Array.from(grid.querySelectorAll("[data-peer]")).forEach((t) => { if (!keep[t.dataset.peer]) t.remove(); });
    let wait = grid.querySelector(".pc-wait"); if (!others.length) { if (!wait) { wait = document.createElement("div"); wait.className = "pc-wait"; grid.appendChild(wait); } wait.innerHTML = "<b>Calling…</b>" + esc(C.title) + " has been told. The call starts when someone joins."; } else if (wait) wait.remove();
    const self = document.getElementById("pc-self"); const sv = self.querySelector("video"); const ct = camTrack(); self.classList.toggle("on", !!ct); self.classList.toggle("screen", C.camKind === "screen"); self.classList.toggle("back", C.facing === "environment");
    if (ct) { if (!C.selfStream || C.selfStream.getVideoTracks()[0] !== ct) { C.selfStream = new MediaStream([ct]); sv.srcObject = C.selfStream; } } else if (sv.srcObject) sv.srcObject = null;
    const mic = micTrack(); const micOn = !!(mic && mic.enabled); const phone = window.innerWidth <= 760; const canScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !phone;
    document.getElementById("pc-bar").innerHTML = '<button type="button" class="pc-b' + (micOn ? "" : " off") + '" data-pc="mic" aria-pressed="' + (!micOn) + '"><span><i>' + (micOn ? "🎙" : "🔇") + "</i>" + (micOn ? "Mute" : "Unmute") + '</span></button>' +
      '<button type="button" class="pc-b' + (ct && C.camKind !== "screen" ? " on" : "") + '" data-pc="cam"><span><i>📹</i>' + (ct && C.camKind !== "screen" ? "Camera off" : "Camera") + "</span></button>" +
      (phone && ct && C.camKind !== "screen" ? '<button type="button" class="pc-b" data-pc="flip"><span><i>🔄</i>Flip</span></button>' : "") +
      (canScreen ? '<button type="button" class="pc-b' + (C.camKind === "screen" ? " on" : "") + '" data-pc="screen"><span><i>🖥</i>' + (C.camKind === "screen" ? "Stop sharing" : "Share screen") + "</span></button>" : "") +
      '<button type="button" class="pc-b end" data-pc="end"><span><i>✕</i>Leave</span></button>';
  }
  function beat(extra) { if (!C) return; const d = Object.assign({ at: Date.now(), s: C.sid, name: X.name, cam: camTrack() ? (C.camKind === "screen" ? "screen" : true) : false, mic: !!(micTrack() && micTrack().enabled) }, extra || {}); X.fs.doc("teamCalls/" + C.id + "/peers/" + C.me).set(d).catch(() => {}); }
  function toggleMic() { const t = micTrack(); if (!t) return; t.enabled = !t.enabled; beat(); paint(); }
  async function setVideo(track, kind) {
    const old = C.video; C.video = track || null; C.camKind = track ? kind : ""; C.selfStream = null;
    await Promise.all(senders("video").map((s) => s.replaceTrack(track || null).catch(() => {})));
    if (old && old !== track) { try { old.stop(); } catch (e) { /* stopped */ } }
    beat(); paint();
  }
  /* The microphone, kept alive (Nov 21, 2026). On an iPhone, asking for the camera on its own can silence the microphone that was
     already open: the other side then sees you and does not hear you. So the camera is always asked for together with the
     microphone and both are swapped in, and a microphone that goes quiet or ends by itself is opened again. */
  async function swapMic(track) {
    const old = micTrack(); if (!C || !track || track === old) return; track.enabled = old ? old.enabled : true; C.stream = new MediaStream([track]);
    await Promise.all(senders("audio").map((s) => s.replaceTrack(track).catch(() => {}))); if (old) { try { old.stop(); } catch (e) { /* stopped */ } } guardMic(track); beat();
  }
  function guardMic(t) {
    if (!t || t._g) return; t._g = true;
    const fix = () => setTimeout(async () => { if (!C || micTrack() !== t || (t.readyState !== "ended" && !t.muted)) return;
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); await swapMic(s.getAudioTracks()[0]); } catch (e) { say("Your microphone stopped. Leave the call and join again.", true); } }, 1500);
    t.addEventListener("mute", fix); t.addEventListener("ended", fix);
  }
  async function camera(facing) {
    const v = { facingMode: facing, width: { ideal: 960 }, height: { ideal: 540 } }; let s;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: v }); } catch (e) { s = await navigator.mediaDevices.getUserMedia({ video: v }); }
    if (!C) { s.getTracks().forEach((t) => t.stop()); return; }
    const a = s.getAudioTracks()[0]; if (a) await swapMic(a); await setVideo(s.getVideoTracks()[0], "cam");
  }
  let camBusy = false;
  async function toggleCam() {
    if (camTrack() && C.camKind !== "screen") return setVideo(null, ""); if (camBusy) return; camBusy = true;
    try { await camera(C.facing || "user"); } catch (e) { say("The camera could not be turned on. Check that the app may use it.", true); } camBusy = false;
  }
  async function flip() { if (camBusy) return; camBusy = true; C.facing = C.facing === "environment" ? "user" : "environment"; try { await camera({ exact: C.facing }); } catch (e) { C.facing = C.facing === "environment" ? "user" : "environment"; say("This device has one camera."); } camBusy = false; }
  async function toggleScreen() {
    if (C.camKind === "screen") return setVideo(null, "");
    try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); const t = s.getVideoTracks()[0]; t.onended = () => { if (C && C.video === t) setVideo(null, ""); }; await setVideo(t, "screen"); } catch (e) { /* they closed the picker */ }
  }

  /* ── in and out ── */
  async function enter(id, call, stream) {
    const me = X.me; let ice = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }]; let relay = false;
    try { const r = await X.api("ice"); if (r && Array.isArray(r.iceServers) && r.iceServers.length) { ice = r.iceServers; relay = !!r.relay; } } catch (e) { /* the public finders */ }
    C = { id, me, kind: call.kind, title: call.title || "Call", chat: call.chat, by: call.by, stream, video: stream.getVideoTracks()[0] || null, camKind: stream.getVideoTracks()[0] ? "cam" : "", facing: "user", pcs: {}, peers: {}, ice, relay, min: false, since: 0, un: [], timers: [], sid: Math.random().toString(36).slice(2, 12) + Date.now().toString(36) };
    guardMic(micTrack()); C.ever = {}; C.ever[me] = 1; clearNote(id);
    C.peers[me] = { name: X.name }; beat(); paint();
    C.un.push(X.fs.collection("teamCalls/" + id + "/peers").onSnapshot((snap) => { if (!C || C.id !== id) return; const now = Date.now(); const seen = {};
      snap.docs.forEach((d) => { const p = d.data() || {}; if (d.id !== me && now - (p.at || 0) > FRESH) return; seen[d.id] = p; });
      Object.keys(C.pcs).forEach((e) => { if (!seen[e] || (C.pcs[e].sid && seen[e].s && C.pcs[e].sid !== seen[e].s)) unlink(e); }); C.peers = seen; if (!C.peers[me]) C.peers[me] = { name: X.name };
      const others = Object.keys(seen).filter((e) => e !== me); if (others.length) C.had = true; others.forEach((e) => { C.ever[e] = 1; }); others.slice(0, MAX).forEach((e) => link(e)); paint(); }, () => {}));
    C.un.push(X.fs.collection("teamCalls/" + id + "/sig").where("to", "==", me).onSnapshot((snap) => { if (!C || C.id !== id) return; const list = snap.docs.map((d) => Object.assign({ _ref: d.ref, _id: d.id }, d.data())).filter((m) => !C.seen || !C.seen[m._id]).sort((a, b) => (a.at || 0) - (b.at || 0));
      C.seen = C.seen || {}; (async () => { for (const m of list) { C.seen[m._id] = 1; await onSig(m); try { m._ref.delete().catch(() => {}); } catch (e) { /* cleared later */ } } })(); }, () => {}));
    C.un.push(X.fs.doc("teamCalls/" + id).onSnapshot((d) => { if (!C || C.id !== id) return; const x = d.exists ? d.data() : null; if (x && x.state === "ended") { say("The call has ended."); leave(true); } }, () => {}));
    C.timers.push(setInterval(() => { if (!C) return; beat(); const now = Date.now(); Object.keys(C.peers).forEach((e) => { if (e !== me && now - ((C.peers[e] || {}).at || 0) > FRESH) { unlink(e); delete C.peers[e]; } }); paint();
      if (!C.had && now - C.t0 > 90000 && C.by === me) { say("Nobody joined."); leave(); } }, BEAT));
    C.t0 = Date.now();
    window.addEventListener("pagehide", bye);
    try { document.dispatchEvent(new CustomEvent("pw-call", { detail: { id, on: true } })); } catch (e) { /* fine */ }
  }
  function bye() { if (!C) return; try { X.fs.doc("teamCalls/" + C.id + "/peers/" + C.me).delete(); } catch (e) { /* gone */ } }
  async function leave(quiet) {
    if (!C) return; const c = C; C = null; window.removeEventListener("pagehide", bye);
    c.un.forEach((u) => { try { u(); } catch (e) { /* off */ } }); c.timers.forEach(clearInterval); if (c.clock) clearInterval(c.clock);
    const went = closeBrowse();   // the section that was open over the Locker Room during the call
    Object.keys(c.pcs).forEach((e) => { try { c.pcs[e].pc.close(); } catch (x) { /* closed */ } });
    try { c.stream.getTracks().forEach((t) => t.stop()); if (c.video) c.video.stop(); } catch (e) { /* stopped */ }
    const w = document.getElementById("pc-wrap"); if (w) w.remove(); const p = document.getElementById("pc-pill"); if (p) p.remove();
    try { await X.fs.doc("teamCalls/" + c.id + "/peers/" + c.me).delete(); } catch (e) { /* gone */ }
    const othersLeft = Object.keys(c.peers).filter((e) => e !== c.me && Date.now() - ((c.peers[e] || {}).at || 0) < FRESH).length;
    if (!quiet && !othersLeft) { try { await X.fs.doc("teamCalls/" + c.id).update({ state: "ended", endedAt: Date.now(), endedBy: c.me }); } catch (e) { /* someone else ended it */ }
      X.api("ring/end", { call: c.id, joined: Object.keys(c.ever || {}) }).catch(() => {}); }   // whoever it rang and never joined: "Missed call" in the place of the ringing notification
    try { document.dispatchEvent(new CustomEvent("pw-call", { detail: { id: c.id, on: false } })); } catch (e) { /* fine */ }
    if (went) { try { const u = new URL(went); if (u.origin === location.origin && !TEAM_PATH.test(u.pathname)) setTimeout(() => { location.href = went; }, quiet ? 1200 : 150); } catch (e) { /* stay in the Locker Room */ } }
  }
  async function start(chatId, kind) {
    if (C) { C.min = false; paint(); return; } const chat = X.chatOf(chatId); if (!chat) return;
    const members = (chat.members || []).filter((e) => e && e.indexOf("@bot") < 0); if (members.length < 2) { say("There is nobody else in this chat to call."); return; }
    let stream; try { stream = await media(kind === "video"); } catch (e) { say("The microphone could not be used. Check that the app may use it.", true); return; }
    const ref = X.fs.collection("teamCalls").doc(); const at = Date.now(); const title = (chat.kind === "channel" ? "#" : "") + X.titleOf(chat);
    const call = { chat: chatId, kind: kind === "video" ? "video" : "audio", by: X.me, byName: X.name, title: chat.kind === "dm" ? X.name : title, members, at, state: "live" };
    try { await ref.set(call); } catch (e) { stream.getTracks().forEach((t) => t.stop()); say("The call could not be started (" + (e.code || e.message) + ").", true); return; }
    const mref = X.fs.collection("teamChats/" + chatId + "/messages").doc(); const text = kind === "video" ? "Started a video call" : "Started a call";
    mref.set({ by: X.me, name: X.name, text, at, call: ref.id, callKind: call.kind }).then(() => X.fs.doc("teamChats/" + chatId).update({ last: { at, by: X.me, name: X.name, text: (kind === "video" ? "📹 " : "📞 ") + text } })).catch(() => {});
    X.api("ring", { call: ref.id }).catch(() => {});
    await enter(ref.id, Object.assign({}, call, { title }), stream);
  }
  async function join(id, wantVideo) {
    if (C) { if (C.id === id) { C.min = false; paint(); } else say("You are already in a call."); return; }
    let call = null; try { const d = await X.fs.doc("teamCalls/" + id).get(); call = d.exists ? d.data() : null; } catch (e) { call = null; }
    if (!call || call.state !== "live" || Date.now() - (call.at || 0) > 4 * 3600 * 1000) { say("That call has ended."); return; }
    let stream; try { stream = await media(wantVideo == null ? call.kind === "video" : !!wantVideo); } catch (e) { say("The microphone could not be used. Check that the app may use it.", true); return; }
    const chat = X.chatOf(call.chat); const title = chat ? (chat.kind === "channel" ? "#" : "") + X.titleOf(chat) : call.title || "Call";
    await enter(id, Object.assign({}, call, { title }), stream);
  }
  window.PWCall = { init: (x) => { X = x; }, start, join, leave, active: () => (C ? C.id : ""), browsing: () => !!F, _state: () => C };
})();
