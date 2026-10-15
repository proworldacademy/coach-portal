/* PROWORLD — the Marketing Command Center's memory in the team database (shared/fsstore.js)
   Every piece of the marketing record is one document under apps/marketing/<collection>/<id> in Firestore:
   state/<key>, ideaBank/<coach>, weeks/<sunday>, archive/<year>, reports/<date>_<by>, numbers/<date>.
   A document holds the page's body as JSON text ({ json, at, by }), so any shape the page uses stores as is.
   Who may read and write is decided by the database rules (Marketing ticked for you on the Dashboard),
   never by this page. The scheduled runs read and write the same documents with tools/pwfs.py.
   The page talks to this through PWGit.open(): an adapter with the same shape as before —
   collection(c).get() / onSnapshot(cb), doc(path).set(body) / delete() / get(). */
(function () {
  "use strict";
  const BASE = "apps/marketing";
  let fs = null, ctx = null;
  const parse = (data) => { try { return data && typeof data.json === "string" ? JSON.parse(data.json) : null; } catch (e) { return null; } };
  function mapErr(e) {
    const c = e && e.code;
    if (c === "permission-denied") return Object.assign(new Error("Your access doesn't allow saving here"), { code: "not_granted" });
    if (c === "resource-exhausted") return Object.assign(new Error(e.message || "quota"), { code: "quota_exceeded" });
    return e;
  }
  function db() {
    return {
      collection: (col) => ({
        get: async () => {
          const s = await fs.collection(BASE + "/" + col).get();
          return { docs: s.docs.map((d) => ({ id: d.id, exists: true, data: () => parse(d.data()) })) };
        },
        onSnapshot: (cb, err) => fs.collection(BASE + "/" + col).onSnapshot((s) => cb({
          docChanges: () => s.docChanges().map((ch) => ({ type: ch.type, doc: { id: ch.doc.id, exists: ch.type !== "removed", data: () => parse(ch.doc.data()) } }))
        }), (e) => { if (err) err(mapErr(e)); })
      }),
      doc: (path) => ({
        set: async (body) => {
          const json = JSON.stringify(body);
          if (json.length > 900000) throw Object.assign(new Error("record too big"), { code: "too_big" });
          try { await fs.doc(BASE + "/" + path).set({ json, at: String((body && body.at) || new Date().toISOString()), by: ctx ? ctx.email : "" }); }
          catch (e) { throw mapErr(e); }
        },
        delete: async () => { try { await fs.doc(BASE + "/" + path).delete(); } catch (e) { throw mapErr(e); } },
        get: async () => { const d = await fs.doc(BASE + "/" + path).get(); return { exists: d.exists, id: d.id, data: () => (d.exists ? parse(d.data()) : undefined) }; },
        acquire: async () => ({ acquired: true })
      })
    };
  }
  async function open() {
    ctx = await window.PWAuth.start({ need: "mkt" });
    fs = window.PWAuth.fs();
    return { db: db(), canWrite: true, login: ctx.email, ctx };
  }
  window.PWGit = {
    open, db: () => db(), BASE,
    raw: () => fs,
    authDialog: () => {}, isSignedIn: () => !!ctx, login: () => (ctx ? ctx.email : null),
    lock: () => window.PWAuth.signOut(), signOut: () => window.PWAuth.signOut()
  };
})();
