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
  const remove = (path) => { writes.push({ path, delete: true }); docs.delete(path); };   // like Firestore: the document only, never what is nested under it
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => snapOf(path),
      set: async (data, opts) => { apply(path, data, opts); },
      update: async (data) => { if (!docs.has(path)) throw new Error('No document to update: ' + path); apply(path, data, { merge: true }); },
      delete: async () => { remove(path); },
      collection: (sub) => colRef(path + '/' + sub)
    };
  }
  const OPS = { '==': (a, b) => a === b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '!=': (a, b) => a !== b, 'in': (a, b) => Array.isArray(b) && b.includes(a) };
  const matches = (k, filters) => filters.every((f) => { const v = getPath(docs.get(k), f.field); return v !== undefined && OPS[f.op](v, f.value); });
  function colRef(path, filters, group) {
    filters = filters || [];
    // a collection: the documents one level under `path`; a collection group: every document whose parent collection is called `path`
    const rows = () => [...docs.keys()].filter((k) => group ? k.split('/').slice(-2, -1)[0] === path : (k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0)).filter((k) => matches(k, filters)).map(snapOf);
    return {
      doc: (id) => docRef(path + '/' + (id || ('auto' + String(seq++).padStart(4, '0')))),
      where: (field, op, value) => { if (!OPS[op]) throw new Error('fake db: operator not supported: ' + op); return colRef(path, filters.concat([{ field, op, value }]), group); },
      orderBy: () => colRef(path, filters, group), limit: () => colRef(path, filters, group),
      get: async () => { const d = rows(); return { docs: d, size: d.length, empty: !d.length, forEach: (fn) => d.forEach(fn) }; },
      add: async (data) => { const r = docRef(path + '/auto' + String(seq++).padStart(4, '0')); await r.set(data); return r; }
    };
  }
  const db = {
    _docs: docs, _writes: writes,
    doc: (path) => docRef(path),
    collection: (path) => colRef(path),
    collectionGroup: (name) => colRef(name, [], true),
    batch: () => { const ops = []; return { set: (ref, data, opts) => { ops.push(() => apply(ref.path, data, opts)); }, update: (ref, data) => { ops.push(() => apply(ref.path, data, { merge: true })); }, delete: (ref) => { ops.push(() => remove(ref.path)); }, commit: async () => { ops.forEach((f) => f()); } }; }
  };
  return db;
}
module.exports = { fakeDb };
