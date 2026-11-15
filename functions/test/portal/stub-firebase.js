/* A stand-in for the Firebase compat SDK, for the headless checks of the Coach Portal (chats.harness.js): one signed-in director, a small roster,
   live snapshots that fire once from window.__seed. Nothing leaves the page. */
(function () {
  const seed = window.__seed || { docs: {} };
  const docs = seed.docs;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const snapOf = (path) => ({ id: path.split('/').pop(), get ref() { return docRef(path); }, exists: !!docs[path], data: () => (docs[path] ? clone(docs[path]) : undefined), metadata: { fromCache: false } });
  const getPath = (o, k) => k.split('.').reduce((a, b) => (a == null ? undefined : a[b]), o);
  const OPS = { '==': (a, b) => a === b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '!=': (a, b) => a !== b, 'in': (a, b) => Array.isArray(b) && b.includes(a), 'array-contains': (a, b) => Array.isArray(a) && a.includes(b) };
  /* the team chat (Nov 15, 2026) writes with arrayUnion / arrayRemove and dotted paths: both are resolved here */
  const FV = { arrayUnion: (...v) => ({ __fv: 'union', v }), arrayRemove: (...v) => ({ __fv: 'remove', v }), serverTimestamp: () => ({ __fv: 'now' }), delete: () => ({ __fv: 'del' }) };
  const fvApply = (cur, val) => { if (!val || typeof val !== 'object' || !val.__fv) return { v: val }; if (val.__fv === 'union') return { v: (Array.isArray(cur) ? cur : []).concat(val.v.filter((x) => !(Array.isArray(cur) ? cur : []).includes(x))) }; if (val.__fv === 'remove') return { v: (Array.isArray(cur) ? cur : []).filter((x) => !val.v.includes(x)) }; if (val.__fv === 'now') return { v: Date.now() }; return { del: true }; };
  const setPath = (obj, dotted, val) => { const ks = dotted.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) { if (!o[ks[i]] || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; } const r = fvApply(o[ks[ks.length - 1]], val); if (r.del) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = r.v; };
  const listeners = [];
  /* two pages of one test can share the stand-in database (seed.share: the calls between two people, Nov 15): every write is passed on */
  const bc = seed.share && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pw-stub-fs') : null; const lastJson = {};
  if (bc) { Object.keys(docs).forEach((k) => { lastJson[k] = JSON.stringify(docs[k]); }); bc.onmessage = (e) => { const m = e.data || {}; if (!m.path) return; if (m.json == null) { delete docs[m.path]; delete lastJson[m.path]; } else { docs[m.path] = JSON.parse(m.json); lastJson[m.path] = m.json; } notify(true); }; }
  const notify = (remote) => { if (bc && !remote) { const keys = new Set(Object.keys(docs).concat(Object.keys(lastJson))); keys.forEach((k) => { const j = docs[k] === undefined ? null : JSON.stringify(docs[k]); if (j !== (lastJson[k] === undefined ? null : lastJson[k])) { if (j == null) delete lastJson[k]; else lastJson[k] = j; bc.postMessage({ path: k, json: j }); } }); }
    listeners.slice().forEach((f) => { try { f(); } catch (e) { /* noop */ } }); };
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => snapOf(path),
      set: async (d, o) => { const deep = (x, y) => { const out = Object.assign({}, x); Object.keys(y).forEach((k) => { out[k] = y[k] && typeof y[k] === 'object' && !Array.isArray(y[k]) && x[k] && typeof x[k] === 'object' && !Array.isArray(x[k]) ? deep(x[k], y[k]) : y[k]; }); return out; };   /* merge is deep on maps, as in Firestore */ docs[path] = o && o.merge && docs[path] ? deep(docs[path], clone(d)) : clone(d); notify(); },
      update: async (d) => { const next = clone(docs[path] || {}); Object.keys(d).forEach((k) => setPath(next, k, d[k] && d[k].__fv ? d[k] : clone(d[k]))); docs[path] = next; notify(); },
      delete: async () => { delete docs[path]; notify(); },
      onSnapshot: (next) => { const fire = () => next(snapOf(path)); fire(); listeners.push(fire); return () => { const i = listeners.indexOf(fire); if (i >= 0) listeners.splice(i, 1); }; },
      collection: (sub) => colRef(path + '/' + sub)
    };
  }
  function colRef(path, filters, order) {
    filters = filters || [];
    const rows = () => Object.keys(docs).filter((k) => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0).filter((k) => filters.every((f) => { const v = getPath(docs[k], f.field); return v !== undefined && OPS[f.op](v, f.value); })).map(snapOf);
    const qs = () => { const d = rows(); if (order) d.sort((a, b) => { const x = getPath(a.data() || {}, order), y = getPath(b.data() || {}, order); return x < y ? -1 : x > y ? 1 : 0; }); return { docs: d, size: d.length, empty: !d.length, metadata: { fromCache: false } }; };
    return {
      path,
      where: (f, op, v) => colRef(path, filters.concat([{ field: f, op, value: v }]), order),
      orderBy: (f) => colRef(path, filters, typeof f === 'string' ? f : order), limit: () => colRef(path, filters, order), limitToLast: () => colRef(path, filters, order),
      get: async () => qs(),
      onSnapshot: (next) => { const fire = () => next(qs()); fire(); listeners.push(fire); return () => { const i = listeners.indexOf(fire); if (i >= 0) listeners.splice(i, 1); }; },
      add: async (d) => { const r = docRef(path + '/auto' + Math.random().toString(36).slice(2, 10)); await r.set(d); return r; },
      doc: (id) => docRef(path + '/' + (id || ('auto' + Math.random().toString(36).slice(2, 8))))
    };
  }
  const user = seed.user === null ? null : Object.assign({ uid: 'u-dee', email: 'dee@example.test', emailVerified: true, displayName: 'Dee Director' }, seed.user || {}, { getIdToken: async () => 'tok' });   // user: null = nobody signed in (the sign-in screens)
  const auth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 0); return () => {}; }, getRedirectResult: async () => null, signOut: async () => { auth.currentUser = null; }, isSignInWithEmailLink: () => false, signInWithEmailAndPassword: async () => { throw { code: 'auth/wrong-password' }; }, sendPasswordResetEmail: async () => {} };
  const fs = { settings: () => {}, enablePersistence: async () => { throw new Error('no'); }, doc: docRef, collection: (p) => colRef(p), waitForPendingWrites: async () => {}, terminate: async () => {}, clearPersistence: async () => {} };
  const fsFn = () => fs; fsFn.FieldValue = FV;
  window.firebase = { initializeApp: () => ({}), auth: () => auth, firestore: fsFn, apps: [] };
  window.__fsDocs = docs;
})();
