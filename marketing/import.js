/* PROWORLD — move the marketing record from the old GitHub site into the team database (one time, owner only).
   The old site kept every document encrypted with the team passcode in the public repository
   proworldacademy/proworld-marketing-dashboard (data/). This reads them, decrypts them in this browser with the
   passcode the owner types (it is never stored or sent anywhere), and writes each one into apps/marketing/… */
(function () {
  "use strict";
  const RAW = "https://raw.githubusercontent.com/proworldacademy/proworld-marketing-dashboard/main/data/";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveKey(pass, saltB64, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function decrypt(key, obj) { return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(obj.iv) }, key, unb64(obj.ct))); }
  async function run(pass, progress) {
    const r = await fetch(RAW + "index.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("Couldn't read the old site (" + r.status + ")");
    const idx = await r.json();
    const key = await deriveKey(pass, idx.kdf.salt, idx.kdf.iter);
    let ok = false; try { ok = (await decrypt(key, idx.check)) === "PROWORLD"; } catch (e) { ok = false; }
    if (!ok) throw new Error("That passcode isn't right.");
    const keys = Object.keys(idx.docs || {}).filter((k) => !k.startsWith("dash/"));
    const fs = window.PWGit.raw(), who = (window.PWAuth.ctx && window.PWAuth.ctx.email) || "";
    let n = 0;
    for (const k of keys) {
      const [col, id] = k.split("/");
      const f = await fetch(RAW + col + "/" + id + ".json?t=" + Date.now(), { cache: "no-store" });
      if (!f.ok) continue;
      const text = await decrypt(key, await f.json());
      let at = new Date().toISOString(); try { at = String(JSON.parse(text).at || at); } catch (e) { /* keep now */ }
      await fs.doc(window.PWGit.BASE + "/" + col + "/" + id).set({ json: text, at, by: "import · " + who });
      n++; if (progress) progress(n, keys.length);
    }
    return n;
  }
  // The card: shown on Home to an owner while the team database has no marketing record yet.
  function offer() {
    const ctx = window.PWAuth && window.PWAuth.ctx; const el = document.getElementById("import-card"); if (!el) return;
    if (!ctx || !ctx.owner) { el.hidden = false; el.innerHTML = '<div class="card-label">Moving in</div><p class="small">The marketing record is being moved to the new site. The owner finishes it in a minute — check back shortly.</p>'; return; }
    el.hidden = false;
    el.innerHTML = '<div class="card-label">One step left: bring the data over</div>'
      + '<p class="small" style="margin-bottom:10px">The plan, the idea banks, the archive, the KPIs and the reports are still on the old site. Type the old team passcode once (it is in your Drive file “PROWORLD site passcode”); this page reads the old record, unlocks it here and saves it into the team database. The passcode is not kept.</p>'
      + '<div class="grid-2"><div class="field"><label for="imp-pass">Old team passcode</label><input type="password" id="imp-pass" autocomplete="off"></div>'
      + '<div class="field"><label>&nbsp;</label><button class="btn" id="imp-go" style="width:100%">Bring the data over</button></div></div><div class="small" id="imp-msg" style="margin-top:8px"></div>';
    const go = async () => {
      const pass = document.getElementById("imp-pass").value; if (!pass) return;
      const msg = document.getElementById("imp-msg"), btn = document.getElementById("imp-go"); btn.disabled = true; msg.textContent = "Reading the old site…";
      try { const n = await run(pass, (i, t) => { msg.textContent = "Saving " + i + " of " + t + "…"; }); msg.textContent = n + " records moved. Reloading…"; setTimeout(() => location.reload(), 900); }
      catch (e) { msg.textContent = e.message || String(e); btn.disabled = false; }
    };
    document.getElementById("imp-go").onclick = go;
    document.getElementById("imp-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }
  window.PWImport = { run, offer };
})();
