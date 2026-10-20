/* A stand-in for the Firestore admin client — just the calls lib/roster.js and lib/notify.js make: doc get/set(merge)/update,
   collection get / where == / add / doc(), batch set/commit. Documents are plain objects keyed by path. */
'use strict';
let seq = 1;
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed || {}).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const writes = [];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const deepMerge = (a, b) => { const out = Object.assign({}, a); for (const k of Object.keys(b)) { out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deepMerge(a[k], b[k]) : b[k]; } return out; };
  const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const snapOf = (path) => { const id = path.split('/').pop(); const data = docs.get(path); return { id, exists: !!data, data: () => (data ? clone(data) : undefined), ref: docRef(path) }; };
  const apply = (path, data, opts) => {
    writes.push({ path, data: clone(data), merge: !!(opts && opts.merge) });
    if (opts && opts.merge && docs.has(path)) docs.set(path, deepMerge(docs.get(path), clone(data)));
    else docs.set(path, clone(data));
  };
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => snapOf(path),
      set: async (data, opts) => { apply(path, data, opts); },
      update: async (data) => { if (!docs.has(path)) throw new Error('No document to update: ' + path); apply(path, data, { merge: true }); },
      collection: (sub) => colRef(path + '/' + sub)
    };
  }
  function colRef(path, filters) {
    filters = filters || [];
    const rows = () => [...docs.keys()].filter((k) => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0).filter((k) => filters.every((f) => getPath(docs.get(k), f.field) === f.value)).map(snapOf);
    return {
      doc: (id) => docRef(path + '/' + (id || ('auto' + String(seq++).padStart(4, '0')))),
      where: (field, op, value) => { if (op !== '==') throw new Error('fake db: only == is supported'); return colRef(path, filters.concat([{ field, value }])); },
      get: async () => { const d = rows(); return { docs: d, size: d.length, empty: !d.length, forEach: (fn) => d.forEach(fn) }; },
      add: async (data) => { const r = docRef(path + '/auto' + String(seq++).padStart(4, '0')); await r.set(data); return r; }
    };
  }
  const db = {
    _docs: docs, _writes: writes,
    doc: (path) => docRef(path),
    collection: (path) => colRef(path),
    batch: () => { const ops = []; return { set: (ref, data, opts) => { ops.push(() => apply(ref.path, data, opts)); }, update: (ref, data) => { ops.push(() => apply(ref.path, data, { merge: true })); }, commit: async () => { ops.forEach((f) => f()); } }; }
  };
  return db;
}
module.exports = { fakeDb };
