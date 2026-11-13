/* A stand-in for the Firebase compat SDK, for the headless checks of the Coach Portal (chats.harness.js): one signed-in director, a small roster,
   live snapshots that fire once from window.__seed. Nothing leaves the page. */
(function () {
  const seed = window.__seed || { docs: {} };
  const docs = seed.docs;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const snapOf = (path) => ({ id: path.split('/').pop(), exists: !!docs[path], data: () => (docs[path] ? clone(docs[path]) : undefined), metadata: { fromCache: false } });
  const getPath = (o, k) => k.split('.').reduce((a, b) => (a == null ? undefined : a[b]), o);
  const OPS = { '==': (a, b) => a === b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '!=': (a, b) => a !== b, 'in': (a, b) => Array.isArray(b) && b.includes(a) };
  const listeners = [];
  const notify = () => listeners.forEach((f) => { try { f(); } catch (e) { /* noop */ } });
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => snapOf(path),
      set: async (d, o) => { const deep = (x, y) => { const out = Object.assign({}, x); Object.keys(y).forEach((k) => { out[k] = y[k] && typeof y[k] === 'object' && !Array.isArray(y[k]) && x[k] && typeof x[k] === 'object' && !Array.isArray(x[k]) ? deep(x[k], y[k]) : y[k]; }); return out; };   /* merge is deep on maps, as in Firestore */ docs[path] = o && o.merge && docs[path] ? deep(docs[path], clone(d)) : clone(d); notify(); },
      update: async (d) => { docs[path] = Object.assign({}, docs[path] || {}, clone(d)); notify(); },
      delete: async () => { delete docs[path]; notify(); },
      onSnapshot: (next) => { const fire = () => next(snapOf(path)); fire(); listeners.push(fire); return () => { const i = listeners.indexOf(fire); if (i >= 0) listeners.splice(i, 1); }; },
      collection: (sub) => colRef(path + '/' + sub)
    };
  }
  function colRef(path, filters) {
    filters = filters || [];
    const rows = () => Object.keys(docs).filter((k) => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0).filter((k) => filters.every((f) => { const v = getPath(docs[k], f.field); return v !== undefined && OPS[f.op](v, f.value); })).map(snapOf);
    const qs = () => { const d = rows(); return { docs: d, size: d.length, empty: !d.length, metadata: { fromCache: false } }; };
    return {
      path,
      where: (f, op, v) => colRef(path, filters.concat([{ field: f, op, value: v }])),
      orderBy: () => colRef(path, filters), limit: () => colRef(path, filters),
      get: async () => qs(),
      onSnapshot: (next) => { const fire = () => next(qs()); fire(); listeners.push(fire); return () => { const i = listeners.indexOf(fire); if (i >= 0) listeners.splice(i, 1); }; },
      doc: (id) => docRef(path + '/' + (id || ('auto' + Math.random().toString(36).slice(2, 8))))
    };
  }
  const user = Object.assign({ uid: 'u-dee', email: 'dee@example.test', emailVerified: true, displayName: 'Dee Director' }, seed.user || {}, { getIdToken: async () => 'tok' });
  const auth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 0); return () => {}; }, getRedirectResult: async () => null, signOut: async () => { auth.currentUser = null; }, isSignInWithEmailLink: () => false, signInWithEmailAndPassword: async () => { throw { code: 'auth/wrong-password' }; }, sendPasswordResetEmail: async () => {} };
  const fs = { settings: () => {}, enablePersistence: async () => { throw new Error('no'); }, doc: docRef, collection: (p) => colRef(p), waitForPendingWrites: async () => {}, terminate: async () => {}, clearPersistence: async () => {} };
  window.firebase = { initializeApp: () => ({}), auth: () => auth, firestore: () => fs, apps: [] };
  window.__fsDocs = docs;
})();
