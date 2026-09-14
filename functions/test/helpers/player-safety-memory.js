"use strict";

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function createPlayerSafetyMemory() {
  const documents = new Map();
  const versions = new Map();
  const realtimeTree = {};
  let realtimeVersion = 0;
  const hooks = { beforeFirestoreCommit: null, beforeRealtimeCommit: null, failRealtime: 0, failDocumentSet: null };
  const fsWrite = (path, value, merge = false) => {
    if (value === undefined) documents.delete(path);
    else documents.set(path, clone(merge ? { ...documents.get(path), ...value } : value));
    versions.set(path, (versions.get(path) || 0) + 1);
  };
  const snapshot = (ref, values = documents) => {
    const value = clone(values.get(ref.path));
    return { id: ref.id, ref, exists: value !== undefined,
      data: () => clone(value), get: (field) => clone(value?.[field]) };
  };
  const doc = (path) => ({ path, id: path.split("/").at(-1),
    collection: (name) => query(`${path}/${name}`),
    get: async () => snapshot(doc(path)),
    set: async (value, options = {}) => {
      if (hooks.failDocumentSet?.(path, value)) throw new Error("injected durable write failure");
      fsWrite(path, value, options.merge);
    },
  });
  const query = (path, filters = [], orderings = [], limit = Infinity, cursor = null) => ({
    path, doc: (id) => doc(`${path}/${id}`),
    where: (field, operator, value) => query(path, [...filters, { field, operator, value }], orderings, limit, cursor),
    orderBy: (field, direction = "asc") => query(path, filters, [...orderings, { field, direction }], limit, cursor),
    limit: (count) => query(path, filters, orderings, count, cursor),
    startAfter: (value) => query(path, filters, orderings, limit, value),
    get: async () => {
      let docs = [...documents.keys()].filter((key) => key.startsWith(`${path}/`)
        && key.split("/").length === path.split("/").length + 1).map((key) => snapshot(doc(key)));
      for (const { field, operator, value } of filters) docs = docs.filter((row) => {
        if (operator === "==") return row.get(field) === value;
        if (operator === "<=") return row.get(field) <= value;
        throw new Error(`Unsupported query operator ${operator}`);
      });
      docs.sort((left, right) => {
        for (const { field, direction } of orderings) {
          if (left.get(field) !== right.get(field)) return (left.get(field) < right.get(field) ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
        return left.id.localeCompare(right.id);
      });
      if (cursor) docs = docs.slice(docs.findIndex((row) => row.id === cursor.id) + 1);
      docs = docs.slice(0, limit);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const firestore = {
    collection: query,
    getAll: async (...refs) => refs.map((ref) => snapshot(ref)),
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const values = new Map([...documents].map(([key, value]) => [key, clone(value)]));
        const initialVersions = new Map(versions);
        const reads = new Set(); const writes = [];
        const transaction = {
          async get(ref) {
            if (writes.length) throw new Error("Firestore read after write");
            reads.add(ref.path); return snapshot(ref, values);
          },
          set(ref, value, options = {}) { writes.push({ ref, value, merge: options.merge }); },
          create(ref, value) { writes.push({ ref, value, create: true }); },
          delete(ref) { writes.push({ ref, value: undefined }); },
        };
        const result = await callback(transaction);
        if (hooks.beforeFirestoreCommit) await hooks.beforeFirestoreCommit({ attempt, reads, writes });
        if ([...reads].some((key) => (versions.get(key) || 0) !== (initialVersions.get(key) || 0))) continue;
        if (writes.some(({ ref, create }) => create && documents.has(ref.path))) throw new Error("already exists");
        for (const { ref, value, merge } of writes) fsWrite(ref.path, value, merge);
        return result;
      }
      throw new Error("Firestore transaction contention");
    },
  };
  const rtRead = (path) => clone(path.split("/").filter(Boolean)
    .reduce((value, key) => value?.[key], realtimeTree) ?? null);
  const rtWrite = (path, value) => {
    const parts = path.split("/").filter(Boolean);
    let parent = realtimeTree;
    for (const key of parts.slice(0, -1)) parent = parent[key] ||= {};
    if (value === null) delete parent[parts.at(-1)];
    else parent[parts.at(-1)] = clone(value);
    realtimeVersion += 1;
  };
  const realtime = { ref: (path) => ({
    get: async () => ({ val: () => rtRead(path) }),
    set: async (value) => rtWrite(path, value),
    async transaction(callback) {
      if (hooks.failRealtime > 0) { hooks.failRealtime -= 1; throw new Error("injected RTDB failure"); }
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const initialVersion = realtimeVersion;
        const value = callback(rtRead(path));
        if (value === undefined) return { committed: false, snapshot: { val: () => rtRead(path) } };
        if (hooks.beforeRealtimeCommit) await hooks.beforeRealtimeCommit({ path, attempt, value });
        if (realtimeVersion !== initialVersion) continue;
        rtWrite(path, value);
        return { committed: true, snapshot: { val: () => rtRead(path) } };
      }
      throw new Error("RTDB transaction contention");
    },
  }) };
  return { firestore, realtime, documents, hooks, fsWrite, rtWrite, rtRead };
}

module.exports = { createPlayerSafetyMemory };
