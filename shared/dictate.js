/* Dictation on every text box of the app (Nov 22, 2026 — "anything you can create by dictation… kind of like Wispr Flow").

   Loaded by shared/design.js on every page. When a signed-in person puts the cursor in a text box they would write a sentence in
   (a message, a question, a report, a note), a round microphone appears just above that box. Tap, talk, tap again: the words are
   put where the cursor is. The recording goes to POST /api/dictate and is not kept (functions/lib/dictate.js).

   It shows only when the engine says dictation is on (GET /api/dictate/ready, remembered for ten minutes) and the device can
   record. Not in a box for an e-mail, a number, a code, a name or a search; a box can say no with data-nodictate, or yes with
   data-dictate. Never while a Locker Room call has the microphone. */
(function () {
  'use strict';
  if (window.PWDictate || window.parent !== window) return;
  const can = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  let READY = null, field = null, btn = null, note = null, rec = null, stream = null, chunks = [], state = 'idle', t0 = 0, tick = 0, noteT = 0;
  let span = null, liveBusy = false, liveSeq = 0, liveSize = 0, liveOff = false, liveAt = 0;   // span: where the dictated words sit in the box while they are still changing
  const MAX_MS = 120000;

  const user = () => { try { const a = (window.PWAuth && window.PWAuth.auth && window.PWAuth.auth()) || (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null); return a && a.currentUser; } catch (e) { return null; } };
  async function api(path, body) {
    const u = user(); if (!u) throw new Error('Sign in first.'); const tok = await u.getIdToken(); const h = { authorization: 'Bearer ' + tok };
    try { const v = JSON.parse(localStorage.getItem('pw-view-as') || 'null'); if (v && v.kind === 'client' && v.pid && v.until > Date.now() && /^\/family(\/|$)/.test(location.pathname)) h['x-view-family'] = v.pid; } catch (e) { /* as myself */ }
    const r = await fetch('/api/' + path, body ? { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, h), body: JSON.stringify(body) } : { headers: h });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'That did not work. Try again.'); return j;
  }
  async function isReady() {
    if (READY !== null) return READY; if (!can || !user()) return false;
    try { const c = JSON.parse(sessionStorage.getItem('pw-dictate') || 'null'); if (c && Date.now() - c.at < 600000) { READY = !!c.ready; return READY; } } catch (e) { /* ask */ }
    try { const j = await api('dictate/ready'); READY = !!j.ready; try { sessionStorage.setItem('pw-dictate', JSON.stringify({ ready: READY, at: Date.now() })); } catch (e) { /* asked again next page */ } } catch (e) { return false; }
    return READY;
  }

  /* a box a person writes sentences in */
  function wants(el) {
    if (!el || el.disabled || el.readOnly) return false; if (el.closest && el.closest('[data-nodictate]')) return false;
    if (el.hasAttribute && el.hasAttribute('data-dictate')) return true;
    const tag = el.tagName; if (tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (tag !== 'INPUT') return false; const type = (el.getAttribute('type') || 'text').toLowerCase(); if (type !== 'text') return false;
    const hint = [el.name, el.id, el.autocomplete, el.inputMode, el.getAttribute('placeholder')].join(' ').toLowerCase();
    if (/mail|phone|tel\b|code|pass|search|find|zip|card|numeric|decimal|url|date|amount|price/.test(hint)) return false;
    if (/ask|message|question|note|write|answer|tell/.test(hint)) return true;
    if (/name/.test(hint)) return false;
    return (Number(el.getAttribute('maxlength')) || 0) >= 100;   // a short box (a name, a title) is typed
  }
  const inCall = () => { try { return !!(window.PWCall && window.PWCall.active()); } catch (e) { return false; } };

  function css() {
    if (document.getElementById('pw-dictate-css')) return; const s = document.createElement('style'); s.id = 'pw-dictate-css';
    s.textContent = '#pw-mic{position:fixed;z-index:2400;width:46px;height:46px;border-radius:50%;border:0;background:#0A0A0A;color:#E2FE78;display:none;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 26px -10px rgba(0,0,0,.6);-webkit-tap-highlight-color:transparent;touch-action:manipulation;font:700 13px "Aeonik Pro",system-ui,sans-serif;gap:8px;padding:0}' +
      '#pw-mic svg{width:20px;height:20px;flex:none}#pw-mic.on{background:#E2FE78;color:#0A0A0A;width:auto;min-width:104px;border-radius:23px;padding:0 16px 0 12px}#pw-mic.on i{width:10px;height:10px;border-radius:3px;background:#0A0A0A;flex:none;animation:pw-mic-p 1.2s ease-in-out infinite}#pw-mic.busy{background:#0A0A0A;color:#fff;width:auto;border-radius:23px;padding:0 16px}' +
      '#pw-mic span{font-variant-numeric:tabular-nums;white-space:nowrap}@keyframes pw-mic-p{50%{opacity:.3}}@media(prefers-reduced-motion:reduce){#pw-mic.on i{animation:none}}#pw-mic:focus-visible{outline:2px solid #E2FE78;outline-offset:2px}' +
      '#pw-mic-n{position:fixed;z-index:2400;max-width:min(300px,calc(100vw - 28px));background:#0A0A0A;color:#fff;border-radius:14px;padding:9px 13px;font:400 13px/1.35 "Aeonik Pro",system-ui,sans-serif;display:none;box-shadow:0 10px 26px -10px rgba(0,0,0,.6)}';
    document.head.appendChild(s);
  }
  const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  function place() {
    if (!btn || !field || btn.style.display === 'none') return; const r = field.getBoundingClientRect(); const vv = window.visualViewport; const top0 = vv ? vv.offsetTop : 0; const h = vv ? vv.height : window.innerHeight; const w = btn.offsetWidth || 46;
    let top = r.top - 54; if (top < top0 + 8) top = Math.min(r.bottom + 8, top0 + h - 54); let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    btn.style.top = Math.round(top) + 'px'; btn.style.left = Math.round(left) + 'px';
    if (note && note.style.display !== 'none') { note.style.top = Math.round(Math.max(top0 + 8, top - note.offsetHeight - 8)) + 'px'; note.style.left = Math.round(Math.max(8, Math.min(left + w - note.offsetWidth, window.innerWidth - note.offsetWidth - 8))) + 'px'; }
  }
  function say(text) { css(); if (!note) { note = document.createElement('div'); note.id = 'pw-mic-n'; note.setAttribute('role', 'status'); document.body.appendChild(note); } note.textContent = text; note.style.display = 'block'; place(); clearTimeout(noteT); noteT = setTimeout(() => { if (note) note.style.display = 'none'; }, 4200); }
  function paint() {
    if (!btn) return; btn.className = state === 'rec' ? 'on' : state === 'busy' ? 'busy' : '';
    btn.innerHTML = state === 'rec' ? '<i></i><span>' + clock() + '</span>' : state === 'busy' ? '<span>Finishing…</span>' : MIC;
    btn.setAttribute('aria-label', state === 'rec' ? 'Stop and write what I said' : state === 'busy' ? 'Writing what you said' : 'Dictate'); btn.disabled = state === 'busy'; place();
  }
  const clock = () => { const s = Math.floor((Date.now() - t0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function show(el) {
    css(); field = el;
    if (!btn) { btn = document.createElement('button'); btn.type = 'button'; btn.id = 'pw-mic';
      btn.addEventListener('pointerdown', (e) => e.preventDefault());   // the box keeps the cursor, the keyboard stays
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (state === 'idle') start(); else if (state === 'rec') stop(); });
      document.body.appendChild(btn); }
    btn.style.display = 'flex'; paint();
  }
  function hide() { if (state !== 'idle') return; if (btn) btn.style.display = 'none'; if (note) note.style.display = 'none'; field = null; }

  /* The box the words go to. A page can redraw its box while you talk (the Locker Room does on a phone): then the same box is found again. */
  function target() {
    if (field && field.isConnected) return field; const a = document.activeElement; if (a && wants(a)) { field = a; return a; }
    if (field) { const same = Array.from(document.querySelectorAll(field.tagName)).find((x) => wants(x) && (x.id && x.id === field.id || x.name && x.name === field.name || (x.getAttribute('placeholder') || '') === (field.getAttribute('placeholder') || ''))); if (same) { field = same; span = null; return same; } }
    return null;
  }
  /* Write the words said so far in place of the ones written a moment ago; `last` leaves them there for good. */
  function put(text, last) {
    const el = target(); if (!el) return; text = String(text || '');
    if (el.isContentEditable) { if (last && text) { el.focus(); document.execCommand('insertText', false, ((el.textContent || '') && !/\s$/.test(el.textContent) ? ' ' : '') + text); } return; }   // a rich box gets the words once, at the end
    if (!span || span.el !== el || el.value.slice(span.at, span.at + span.len) !== span.text) { const a = el.selectionStart == null ? el.value.length : el.selectionStart, b = el.selectionEnd == null ? a : el.selectionEnd; span = { el, at: a, len: b - a, text: el.value.slice(a, b) }; }
    if (!text && !span.len) { if (last) span = null; return; }
    const before = el.value.slice(0, span.at); const ins = text ? (before && !/\s$/.test(before) ? ' ' : '') + text : '';
    const max = Number(el.getAttribute('maxlength')) || 0; const room = max ? Math.max(0, max - (el.value.length - span.len)) : Infinity; const piece = ins.slice(0, room);
    if (piece !== span.text) { try { el.setRangeText(piece, span.at, span.at + span.len, 'end'); } catch (e) { el.value = before + piece + el.value.slice(span.at + span.len); }
      span.len = piece.length; span.text = piece; el.dispatchEvent(new Event('input', { bubbles: true })); if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight; }
    if (last) { el.dispatchEvent(new Event('change', { bubbles: true })); if (piece.length < ins.length) say('This box is full. The rest was left out.'); span = null; }
  }
  /* While you talk: every couple of seconds the recording so far is read and the words in the box are brought up to date. */
  async function look() {
    if (state !== 'rec' || liveBusy || liveOff || !chunks.length) return; const size = chunks.reduce((n, c) => n + c.size, 0); if (size === liveSize || size < 1500) return;
    const gap = Date.now() - t0 > 45000 ? 5000 : 2200; if (Date.now() - liveAt < gap) return;
    liveBusy = true; liveSize = size; liveAt = Date.now(); const seq = ++liveSeq; const mime = (rec && rec.mimeType) || 'audio/mp4';
    try { const j = await api('dictate', { audio: await b64(new Blob(chunks, { type: mime })), mime, interim: true }); if (j.off) liveOff = true; if (state === 'rec' && seq === liveSeq && j.text) put(j.text, false); } catch (e) { /* the final read still writes it */ }
    liveBusy = false;
  }
  const b64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(new Error('Could not read the recording.')); fr.readAsDataURL(blob); });
  function release() { clearInterval(tick); tick = 0; try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* off */ } stream = null; rec = null; }
  async function start() {
    if (inCall()) { say('The microphone is on your call. Dictate after it.'); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { say('Allow the microphone for ProWorld to dictate.'); return; }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
    try { rec = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 32000 }, type ? { mimeType: type } : {})); } catch (e) { release(); say('This device cannot record here.'); return; }
    chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => { const mime = (rec && rec.mimeType) || type || 'audio/mp4'; release(); const blob = new Blob(chunks, { type: mime }); chunks = [];
      if (Date.now() - t0 < 700 || blob.size < 800) { state = 'idle'; paint(); say('That was too short. Tap, talk, then tap again.'); return; }
      state = 'busy'; paint();
      liveSeq++; try { const j = await api('dictate', { audio: await b64(blob), mime }); if (j.text) put(j.text, true); else if (span && span.len) put(span.text.trim(), true); else say('I did not catch any words. Try again.'); } catch (e) { if (span && span.len) put(span.text.trim(), true); else say(e.message || 'That did not work. Try again.'); }
      span = null;
      state = 'idle'; paint(); if (field && document.activeElement !== field && !field.isConnected) hide(); };
    t0 = Date.now(); state = 'rec'; span = null; liveBusy = false; liveSize = 0; liveAt = 0; liveOff = false; paint(); rec.start(1000); tick = setInterval(() => { if (state !== 'rec') return; paint(); look(); if (Date.now() - t0 > MAX_MS) stop(); }, 500);
  }
  function stop() { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { release(); state = 'idle'; paint(); } }

  document.addEventListener('focusin', async (e) => { const el = e.target; if (state !== 'idle' || !wants(el)) return; if (!(await isReady())) return; if (document.activeElement === el) show(el); });
  document.addEventListener('focusout', (e) => { if (e.target !== field) return; setTimeout(() => { if (document.activeElement !== field) hide(); }, 250); });
  ['scroll', 'resize'].forEach((n) => { window.addEventListener(n, place, { passive: true, capture: true }); if (window.visualViewport) window.visualViewport.addEventListener(n, place, { passive: true }); });
  document.addEventListener('input', (e) => { if (e.target === field) place(); }, true);
  window.addEventListener('pagehide', () => { try { if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } } catch (e) { /* gone */ } release(); });
  window.PWDictate = { wants, ready: isReady, _state: () => state };
})();
