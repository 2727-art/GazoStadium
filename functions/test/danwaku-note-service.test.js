"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createDanwakuNoteService } = require("../danwaku-note-service");
const { deterministicDanwakuId } = require("../danwaku-note");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeDocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this._value = value;
  }

  data() {
    return clone(this._value);
  }
}

class FakeDocumentReference {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeQuery(this.store, `${this.path}/${name}`);
  }

  async get() {
    return new FakeDocumentSnapshot(this, this.store.documents.get(this.path));
  }

  async delete() {
    if (this.store.failDocumentDeletes) throw new Error("injected document delete failure");
    this.store.documents.delete(this.path);
  }
}

class FakeQuery {
  constructor(store, path, filters = [], orders = [], maximum = Infinity, skipped = 0) {
    this.store = store;
    this.path = path;
    this.filters = filters;
    this.orders = orders;
    this.maximum = maximum;
    this.skipped = skipped;
  }

  doc(id) {
    return new FakeDocumentReference(this.store, `${this.path}/${id}`);
  }

  where(field, operator, value) {
    return new FakeQuery(
      this.store,
      this.path,
      [...this.filters, { field, operator, value }],
      this.orders,
      this.maximum,
      this.skipped,
    );
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(
      this.store,
      this.path,
      this.filters,
      [...this.orders, { field, direction }],
      this.maximum,
      this.skipped,
    );
  }

  limit(maximum) {
    return new FakeQuery(
      this.store,
      this.path,
      this.filters,
      this.orders,
      maximum,
      this.skipped,
    );
  }

  offset(skipped) {
    return new FakeQuery(
      this.store,
      this.path,
      this.filters,
      this.orders,
      this.maximum,
      skipped,
    );
  }

  async get() {
    return this.store.query(this);
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
    this.writes = [];
  }

  async get(refOrQuery) {
    if (refOrQuery instanceof FakeDocumentReference) return refOrQuery.get();
    return refOrQuery.get();
  }

  set(ref, value) {
    this.writes.push({ type: "set", ref, value: clone(value) });
  }

  create(ref, value) {
    this.writes.push({ type: "create", ref, value: clone(value) });
  }

  delete(ref) {
    this.writes.push({ type: "delete", ref });
  }

  commit() {
    for (const write of this.writes) {
      if (write.type === "create" && this.store.documents.has(write.ref.path)) {
        throw new Error(`already exists: ${write.ref.path}`);
      }
    }
    for (const write of this.writes) {
      if (write.type === "delete") this.store.documents.delete(write.ref.path);
      else this.store.documents.set(write.ref.path, clone(write.value));
    }
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this._transactionChain = Promise.resolve();
    this.recursiveDeletes = [];
    this.failDocumentDeletes = false;
  }

  collection(name) {
    return new FakeQuery(this, name);
  }

  query(query) {
    const prefix = `${query.path}/`;
    const documentDepth = query.path.split("/").length + 1;
    let rows = Array.from(this.documents.entries())
      .filter(([path]) => path.startsWith(prefix) && path.split("/").length === documentDepth)
      .map(([path, value]) => ({
        ref: new FakeDocumentReference(this, path),
        value: clone(value),
      }));
    for (const filter of query.filters) {
      rows = rows.filter(({ value }) => {
        if (filter.operator === "==") return value?.[filter.field] === filter.value;
        if (filter.operator === ">") return value?.[filter.field] > filter.value;
        throw new Error(`unsupported fake operator: ${filter.operator}`);
      });
    }
    rows.sort((left, right) => {
      for (const order of query.orders) {
        const direction = order.direction === "desc" ? -1 : 1;
        if (left.value?.[order.field] < right.value?.[order.field]) return -1 * direction;
        if (left.value?.[order.field] > right.value?.[order.field]) return direction;
      }
      return left.ref.path.localeCompare(right.ref.path);
    });
    return {
      docs: rows.slice(query.skipped, query.skipped + query.maximum).map(({ ref, value }) => (
        new FakeDocumentSnapshot(ref, value)
      )),
    };
  }

  runTransaction(callback) {
    const run = this._transactionChain.then(async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    });
    this._transactionChain = run.catch(() => undefined);
    return run;
  }

  async recursiveDelete(ref) {
    this.recursiveDeletes.push(ref.path);
    for (const path of Array.from(this.documents.keys())) {
      if (path === ref.path || path.startsWith(`${ref.path}/`)) this.documents.delete(path);
    }
  }

  put(path, value) {
    this.documents.set(path, clone(value));
  }

  get(path) {
    return clone(this.documents.get(path));
  }
}

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function createFixture(
  initialNow = Date.parse("2026-08-05T12:00:00+09:00"),
  options = {},
) {
  const firestore = new FakeFirestore();
  let timestamp = initialNow;
  const service = createDanwakuNoteService({
    firestore,
    HttpsError: FakeHttpsError,
    now: () => timestamp,
    randomBytes: options.randomBytes || ((size) => Buffer.alloc(size, 11)),
    resolveDisplayName: options.resolveDisplayName || (async () => "公式PLAYER"),
    achievementProfileRef: (uid) => firestore.collection("achievementProfiles").doc(uid),
    normalizeAchievementProfile: (value) => ({
      unlocked: { ...(value?.unlocked || {}) },
    }),
    eligibleAchievementIds: ({ danwakuStats, scope }) => (
      scope === "danwaku" && danwakuStats.highestEverDays >= 1 ? ["danwaku_first"] : []
    ),
    unlockAchievements: (profile, ids, unlockedAt) => {
      const next = { unlocked: { ...profile.unlocked } };
      const newlyUnlocked = [];
      for (const id of ids) {
        if (!next.unlocked[id]) {
          next.unlocked[id] = unlockedAt;
          newlyUnlocked.push(id);
        }
      }
      return { profile: next, newlyUnlocked };
    },
    logger: options.logger || { warn() {} },
  });
  return {
    firestore,
    service,
    setNow(value) {
      timestamp = value;
    },
  };
}

const uid = "test-user-001";

function operationPath(operationId) {
  return `danwakuProfiles/${uid}/operations/${deterministicDanwakuId(
    "operation",
    uid,
    operationId,
  )}`;
}

test("service lifecycle is idempotent, projects public data, and physically deletes private history", async () => {
  const fixture = createFixture();
  const { service, firestore } = fixture;
  const empty = await service.dispatch(uid, { action: "state" });
  assert.equal(empty.notes.length, 0);
  assert.equal(empty.dayKey, "2026-08-05");
  assert.equal(empty.nextBoundaryAt, Date.parse("2026-08-06T04:00:00+09:00"));

  const createRequest = {
    action: "create",
    operationId: "operation-create-0001",
    title: "夜のお菓子",
    commitment: "午後9時以降は食べない",
  };
  const created = await service.dispatch(uid, createRequest);
  const repeatedCreate = await service.dispatch(uid, createRequest);
  assert.equal(created.outcome, "created");
  assert.equal(repeatedCreate.outcome, "created");
  assert.equal(created.noteId, repeatedCreate.noteId);
  assert.equal(repeatedCreate.state.notes.length, 1);

  const continueRequest = {
    action: "continue",
    operationId: "operation-continue-0001",
    noteId: created.noteId,
  };
  const continuations = await Promise.all(
    Array.from({ length: 20 }, (_, index) => service.dispatch(uid, {
      ...continueRequest,
      operationId: `operation-continue-${String(index + 1).padStart(4, "0")}`,
    })),
  );
  assert.equal(continuations.filter((result) => result.outcome === "recorded").length, 1);
  assert.equal(continuations.filter((result) => result.outcome === "already-recorded").length, 19);
  const afterContinue = await service.dispatch(uid, { action: "state" });
  assert.equal(afterContinue.notes[0].currentDays, 1);
  assert.equal(afterContinue.notes[0].canContinueToday, false);
  assert.equal(afterContinue.notes[0].canResetToday, true);
  assert.deepEqual(firestore.get(`achievementProfiles/${uid}`).unlocked, {
    danwaku_first: Date.parse("2026-08-05T12:00:00+09:00"),
  });

  const publicResult = await service.dispatch(uid, {
    action: "set_public",
    operationId: "operation-public-0001",
    noteId: created.noteId,
    rankingVisible: true,
    matchVisible: true,
    shareTitle: true,
  });
  assert.equal(publicResult.state.profile.displayName, "公式PLAYER");
  const publicDocs = Array.from(firestore.documents.entries())
    .filter(([path]) => /^danwakuPublicEntries\/[^/]+$/.test(path));
  assert.equal(publicDocs.length, 1);
  assert.deepEqual(Object.keys(publicDocs[0][1]).sort(), [
    "days",
    "displayName",
    "expiresAt",
    "lastContinuedDayKey",
    "title",
  ]);
  assert.equal(Object.hasOwn(publicDocs[0][1], "uid"), false);
  assert.deepEqual(firestore.get(`danwakuMatchBadges/${uid}`), { days: 1 });

  const ranking = await service.dispatch(uid, { action: "ranking" });
  assert.equal(ranking.ranking.participantCount, 1);
  assert.equal(ranking.ranking.todayCount, 1);
  assert.equal(ranking.ranking.viewerRank, 1);
  assert.equal(ranking.ranking.top[0].isViewer, true);
  assert.equal(Object.hasOwn(ranking.ranking.top[0], "uid"), false);

  const reset = await service.dispatch(uid, {
    action: "reset",
    operationId: "operation-reset-0001",
    noteId: created.noteId,
  });
  assert.equal(reset.outcome, "reset");
  assert.equal(reset.state.notes[0].currentDays, 0);
  assert.equal(firestore.get(`danwakuMatchBadges/${uid}`), undefined);
  assert.equal(firestore.documents.has(publicDocs[0][0]), false);
  const blocked = await service.dispatch(uid, {
    action: "continue",
    operationId: "operation-after-reset-0001",
    noteId: created.noteId,
  });
  assert.equal(blocked.outcome, "reset-today");

  fixture.setNow(Date.parse("2026-08-06T04:00:00+09:00"));
  const nextDay = await service.dispatch(uid, {
    action: "continue",
    operationId: "operation-next-day-0001",
    noteId: created.noteId,
  });
  assert.equal(nextDay.outcome, "recorded");
  assert.equal(nextDay.state.notes[0].currentDays, 1);
  assert.equal(nextDay.state.profile.highestEverDays, 1);

  const history = await service.dispatch(uid, {
    action: "history",
    noteId: created.noteId,
    limit: 100,
  });
  assert.ok(history.events.some((event) => event.type === "continue"));
  assert.ok(history.events.some((event) => event.type === "reset"));

  await service.dispatch(uid, {
    action: "update",
    operationId: "operation-update-0001",
    noteId: created.noteId,
    title: "更新後の自由文",
    commitment: "削除時に消える約束",
  });
  const deletionRequest = {
    action: "delete",
    operationId: "operation-delete-0001",
    noteId: created.noteId,
  };
  const deleted = await service.dispatch(uid, deletionRequest);
  const repeatedDelete = await service.dispatch(uid, deletionRequest);
  assert.equal(deleted.outcome, "deleted");
  assert.equal(repeatedDelete.outcome, "deleted");
  assert.equal(deleted.state.notes.length, 0);
  const notePrefix = `danwakuProfiles/${uid}/notes/${created.noteId}`;
  assert.equal(
    Array.from(firestore.documents.keys()).some((path) => path === notePrefix || path.startsWith(`${notePrefix}/`)),
    false,
  );
  assert.ok(firestore.recursiveDeletes.filter((path) => path === notePrefix).length >= 2);
  assert.equal(firestore.get(`achievementProfiles/${uid}`).unlocked.danwaku_first > 0, true);
  const createAfterDelete = await service.dispatch(uid, createRequest);
  assert.equal(createAfterDelete.outcome, "created");
  assert.equal(createAfterDelete.state.notes.length, 0);
});

test("permanent receipts bind an operation id to one payload and preserve every original no-op outcome", async () => {
  const fixture = createFixture();
  const { service, firestore } = fixture;
  const createRequest = {
    action: "create",
    operationId: "receipt-create-0001",
    title: "夜食",
    commitment: "夜は水だけ",
  };
  const created = await service.dispatch(uid, createRequest);
  const createReceipt = firestore.get(operationPath(createRequest.operationId));
  assert.deepEqual(Object.keys(createReceipt).sort(), [
    "action",
    "createdAt",
    "noteId",
    "outcome",
    "requestHash",
  ]);
  assert.equal(createReceipt.action, "create");
  assert.equal(createReceipt.noteId, created.noteId);
  assert.equal(createReceipt.outcome, "created");
  assert.match(createReceipt.requestHash, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(createReceipt).includes("夜食"), false);
  await assert.rejects(
    service.dispatch(uid, { ...createRequest, title: "別の内容" }),
    (error) => error instanceof FakeHttpsError && error.code === "already-exists",
  );
  await assert.rejects(
    service.dispatch(uid, {
      action: "update",
      operationId: createRequest.operationId,
      noteId: created.noteId,
      title: "夜食",
      commitment: "夜は水だけ",
    }),
    (error) => error instanceof FakeHttpsError && error.code === "already-exists",
  );

  const zeroResetRequest = {
    action: "reset",
    operationId: "receipt-reset-zero-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, zeroResetRequest)).outcome, "already-zero");
  const successfulContinue = {
    action: "continue",
    operationId: "receipt-continue-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, successfulContinue)).outcome, "recorded");
  assert.equal((await service.dispatch(uid, successfulContinue)).outcome, "recorded");
  const replayedZeroReset = await service.dispatch(uid, zeroResetRequest);
  assert.equal(replayedZeroReset.outcome, "already-zero");
  assert.equal(replayedZeroReset.state.notes[0].currentDays, 1);

  const unchangedUpdate = {
    action: "update",
    operationId: "receipt-update-noop-0001",
    noteId: created.noteId,
    title: "夜食",
    commitment: "夜は水だけ",
  };
  assert.equal((await service.dispatch(uid, unchangedUpdate)).outcome, "unchanged");
  const successfulUpdate = {
    ...unchangedUpdate,
    operationId: "receipt-update-real-0001",
    title: "更新した夜食",
  };
  assert.equal((await service.dispatch(uid, successfulUpdate)).outcome, "updated");
  assert.equal((await service.dispatch(uid, successfulUpdate)).outcome, "updated");
  const replayedUpdate = await service.dispatch(uid, unchangedUpdate);
  assert.equal(replayedUpdate.outcome, "unchanged");
  assert.equal(replayedUpdate.state.notes[0].title, "更新した夜食");

  const alreadyRecorded = {
    action: "continue",
    operationId: "receipt-continue-noop-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, alreadyRecorded)).outcome, "already-recorded");
  fixture.setNow(Date.parse("2026-08-06T04:00:00+09:00"));
  const replayedContinue = await service.dispatch(uid, alreadyRecorded);
  assert.equal(replayedContinue.outcome, "already-recorded");
  assert.equal(replayedContinue.state.notes[0].currentDays, 1);
  const nextDayContinue = {
    action: "continue",
    operationId: "receipt-continue-next-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, nextDayContinue)).outcome, "recorded");
  const successfulReset = {
    action: "reset",
    operationId: "receipt-reset-real-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, successfulReset)).outcome, "reset");
  assert.equal((await service.dispatch(uid, successfulReset)).outcome, "reset");
  const resetTodayContinue = {
    action: "continue",
    operationId: "receipt-continue-reset-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, resetTodayContinue)).outcome, "reset-today");
  fixture.setNow(Date.parse("2026-08-07T04:00:00+09:00"));
  const replayedResetToday = await service.dispatch(uid, resetTodayContinue);
  assert.equal(replayedResetToday.outcome, "reset-today");
  assert.equal(replayedResetToday.state.notes[0].currentDays, 0);

  const publicNoop = {
    action: "set_public",
    operationId: "receipt-public-noop-0001",
    noteId: "",
    rankingVisible: false,
    matchVisible: false,
    shareTitle: false,
  };
  assert.equal((await service.dispatch(uid, publicNoop)).outcome, "unchanged");
  const successfulPublic = {
    action: "set_public",
    operationId: "receipt-public-real-0001",
    noteId: created.noteId,
    rankingVisible: true,
    matchVisible: true,
    shareTitle: false,
  };
  assert.equal((await service.dispatch(uid, successfulPublic)).outcome, "saved");
  assert.equal((await service.dispatch(uid, successfulPublic)).outcome, "saved");
  const replayedPublicNoop = await service.dispatch(uid, publicNoop);
  assert.equal(replayedPublicNoop.outcome, "unchanged");
  assert.equal(replayedPublicNoop.state.profile.rankingVisible, true);
  assert.equal(replayedPublicNoop.state.profile.matchVisible, true);

  const successfulArchive = {
    action: "archive",
    operationId: "receipt-archive-real-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, successfulArchive)).outcome, "archive");
  assert.equal((await service.dispatch(uid, successfulArchive)).outcome, "archive");
  const archivedNoop = {
    action: "archive",
    operationId: "receipt-archive-noop-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, archivedNoop)).outcome, "already-archived");
  const successfulRestore = {
    action: "restore",
    operationId: "receipt-restore-real-0001",
    noteId: created.noteId,
  };
  assert.equal((await service.dispatch(uid, successfulRestore)).outcome, "restore");
  assert.equal((await service.dispatch(uid, successfulRestore)).outcome, "restore");
  const replayedArchiveNoop = await service.dispatch(uid, archivedNoop);
  assert.equal(replayedArchiveNoop.outcome, "already-archived");
  assert.equal(replayedArchiveNoop.state.notes[0].status, "active");

  for (const operationId of [
    zeroResetRequest.operationId,
    unchangedUpdate.operationId,
    alreadyRecorded.operationId,
    publicNoop.operationId,
    archivedNoop.operationId,
  ]) {
    assert.ok(firestore.get(operationPath(operationId)), `${operationId} receipt must persist`);
  }
});

test("event history keeps the newest 100 records and pruning failures never roll back a mutation", async () => {
  const { service, firestore } = createFixture();
  const created = await service.dispatch(uid, {
    action: "create",
    operationId: "prune-create-note-0001",
    title: "history pruning",
    commitment: "",
  });
  const eventsPrefix = `danwakuProfiles/${uid}/notes/${created.noteId}/events/`;
  const base = Date.parse("2026-08-01T04:00:00+09:00");
  for (let index = 0; index < 101; index += 1) {
    firestore.put(`${eventsPrefix}${deterministicDanwakuId("legacy-event", index)}`, {
      type: "update",
      noteId: created.noteId,
      dayKey: "2026-08-01",
      beforeDays: 0,
      afterDays: 0,
      createdAt: base + index,
    });
  }

  firestore.failDocumentDeletes = true;
  const firstUpdate = await service.dispatch(uid, {
    action: "update",
    operationId: "prune-update-failure-0001",
    noteId: created.noteId,
    title: "prune still succeeds",
    commitment: "",
  });
  assert.equal(firstUpdate.outcome, "updated");
  const afterFailureCount = Array.from(firestore.documents.keys())
    .filter((path) => path.startsWith(eventsPrefix)).length;
  assert.ok(afterFailureCount > 100);

  firestore.failDocumentDeletes = false;
  const secondUpdate = await service.dispatch(uid, {
    action: "update",
    operationId: "prune-update-success-0001",
    noteId: created.noteId,
    title: "only newest one hundred",
    commitment: "",
  });
  assert.equal(secondUpdate.outcome, "updated");
  const retainedEvents = Array.from(firestore.documents.entries())
    .filter(([path]) => path.startsWith(eventsPrefix));
  assert.equal(retainedEvents.length, 100);
  assert.equal(
    retainedEvents.some(([, event]) => event.createdAt === base),
    false,
  );
  const history = await service.dispatch(uid, {
    action: "history",
    noteId: created.noteId,
    limit: 100,
  });
  assert.equal(history.events.length, 100);
  assert.equal(
    Array.from(firestore.documents.keys())
      .filter((path) => path.startsWith(`danwakuProfiles/${uid}/operations/`)).length,
    3,
  );
});

test("set_public receipt replay completes before display-name and random-entry dependencies", async () => {
  let randomCalls = 0;
  let resolverCalls = 0;
  let dependenciesUnavailable = false;
  const { service } = createFixture(
    Date.parse("2026-08-05T12:00:00+09:00"),
    {
      randomBytes(size) {
        randomCalls += 1;
        if (dependenciesUnavailable) throw new Error("random source unavailable");
        return Buffer.alloc(size, 12);
      },
      async resolveDisplayName() {
        resolverCalls += 1;
        if (dependenciesUnavailable) throw new Error("profile source unavailable");
        return "公式PLAYER";
      },
    },
  );
  const created = await service.dispatch(uid, {
    action: "create",
    operationId: "preflight-create-note-0001",
    title: "public receipt",
    commitment: "",
  });
  const publicRequest = {
    action: "set_public",
    operationId: "preflight-public-save-0001",
    noteId: created.noteId,
    rankingVisible: true,
    matchVisible: true,
    shareTitle: false,
  };
  assert.equal((await service.dispatch(uid, publicRequest)).outcome, "saved");
  assert.equal(randomCalls, 1);
  assert.equal(resolverCalls, 1);
  dependenciesUnavailable = true;
  assert.equal((await service.dispatch(uid, publicRequest)).outcome, "saved");
  assert.equal(randomCalls, 1);
  assert.equal(resolverCalls, 1);
  await assert.rejects(
    service.dispatch(uid, { ...publicRequest, shareTitle: true }),
    (error) => error instanceof FakeHttpsError && error.code === "already-exists",
  );
  assert.equal(randomCalls, 1);
  assert.equal(resolverCalls, 1);
});

test("state returns at most ten active and one hundred latest archived notes", async () => {
  const { service, firestore } = createFixture();
  const base = Date.parse("2026-08-05T12:00:00+09:00");
  for (let index = 0; index < 12; index += 1) {
    const noteId = deterministicDanwakuId("active", index);
    firestore.put(`danwakuProfiles/${uid}/notes/${noteId}`, {
      noteId,
      title: `active ${index}`,
      commitment: "",
      status: "active",
      currentDays: 0,
      createdAt: base + index,
      updatedAt: base + index,
      revision: 1,
    });
  }
  for (let index = 0; index < 130; index += 1) {
    const noteId = deterministicDanwakuId("archived", index);
    firestore.put(`danwakuProfiles/${uid}/notes/${noteId}`, {
      noteId,
      title: `archived ${index}`,
      commitment: "",
      status: "archived",
      currentDays: 0,
      createdAt: base + index,
      updatedAt: base + index,
      revision: 1,
    });
  }
  const state = await service.dispatch(uid, { action: "state" });
  assert.equal(state.notes.filter((note) => note.status === "active").length, 10);
  assert.equal(state.notes.filter((note) => note.status === "archived").length, 100);
  assert.equal(state.notes.length, 110);
});

test("archivedCount backfills legacy profiles and atomically enforces the 100-note archive ceiling", async () => {
  const { service, firestore } = createFixture();
  const base = Date.parse("2026-08-05T12:00:00+09:00");
  const activeId = deterministicDanwakuId("legacy-active", 1);
  firestore.put(`danwakuProfiles/${uid}`, {
    schemaVersion: 1,
    activeNoteCount: 1,
    noteCount: 100,
    highestEverDays: 0,
    revision: 1,
    createdAt: base,
    updatedAt: base,
  });
  firestore.put(`danwakuProfiles/${uid}/notes/${activeId}`, {
    noteId: activeId,
    title: "legacy active",
    commitment: "",
    status: "active",
    currentDays: 0,
    createdAt: base,
    updatedAt: base,
    revision: 1,
  });
  const archivedIds = [];
  for (let index = 0; index < 99; index += 1) {
    const noteId = deterministicDanwakuId("legacy-archived", index);
    archivedIds.push(noteId);
    firestore.put(`danwakuProfiles/${uid}/notes/${noteId}`, {
      noteId,
      title: `legacy archived ${index}`,
      commitment: "",
      status: "archived",
      currentDays: 0,
      createdAt: base - index - 1,
      updatedAt: base - index - 1,
      archivedAt: base - index - 1,
      revision: 1,
    });
  }

  const archived = await service.dispatch(uid, {
    action: "archive",
    operationId: "count-archive-legacy-0001",
    noteId: activeId,
  });
  assert.equal(archived.state.profile.archivedCount, 100);
  assert.equal(firestore.get(`danwakuProfiles/${uid}`).archivedCount, 100);

  const created = await service.dispatch(uid, {
    action: "create",
    operationId: "count-create-active-0001",
    title: "archive candidate",
    commitment: "",
  });
  assert.equal(created.state.profile.archivedCount, 100);
  const blockedArchiveRequest = {
    action: "archive",
    operationId: "count-archive-blocked-0001",
    noteId: created.noteId,
  };
  await assert.rejects(
    service.dispatch(uid, blockedArchiveRequest),
    (error) => error instanceof FakeHttpsError && error.code === "resource-exhausted",
  );
  assert.equal(firestore.get(operationPath(blockedArchiveRequest.operationId)), undefined);

  const deletedArchived = await service.dispatch(uid, {
    action: "delete",
    operationId: "count-delete-archived-0001",
    noteId: archivedIds[0],
  });
  assert.equal(deletedArchived.state.profile.archivedCount, 99);
  const archivedAfterSpace = await service.dispatch(uid, blockedArchiveRequest);
  assert.equal(archivedAfterSpace.outcome, "archive");
  assert.equal(archivedAfterSpace.state.profile.archivedCount, 100);

  const restored = await service.dispatch(uid, {
    action: "restore",
    operationId: "count-restore-archived-0001",
    noteId: archivedIds[1],
  });
  assert.equal(restored.state.profile.archivedCount, 99);
  const activeCreated = await service.dispatch(uid, {
    action: "create",
    operationId: "count-create-active-0002",
    title: "active deletion",
    commitment: "",
  });
  assert.equal(activeCreated.state.profile.archivedCount, 99);
  const activeDeleted = await service.dispatch(uid, {
    action: "delete",
    operationId: "count-delete-active-0001",
    noteId: activeCreated.noteId,
  });
  assert.equal(activeDeleted.state.profile.archivedCount, 99);

  await service.dispatch(uid, {
    action: "archive",
    operationId: "count-archive-for-update-0001",
    noteId: archivedIds[1],
  });
  const archivedUpdateRequest = {
    action: "update",
    operationId: "count-update-archived-0001",
    noteId: archivedIds[1],
    title: "must wait for restore",
    commitment: "",
  };
  await assert.rejects(
    service.dispatch(uid, archivedUpdateRequest),
    (error) => error instanceof FakeHttpsError && error.code === "failed-precondition",
  );
  await service.dispatch(uid, {
    action: "restore",
    operationId: "count-restore-for-update-0001",
    noteId: archivedIds[1],
  });
  const updated = await service.dispatch(uid, archivedUpdateRequest);
  assert.equal(updated.outcome, "updated");
  assert.equal(updated.state.notes.find((note) => note.noteId === archivedIds[1]).title, "must wait for restore");
  assert.equal(updated.state.profile.archivedCount, 99);
});

test("legacy archive overflow remains blocked instead of treating the 101-document sentinel as an exact count", async () => {
  const { service, firestore } = createFixture();
  const base = Date.parse("2026-08-05T12:00:00+09:00");
  const activeId = deterministicDanwakuId("overflow-active", 1);
  firestore.put(`danwakuProfiles/${uid}`, {
    activeNoteCount: 1,
    noteCount: 131,
    highestEverDays: 0,
    revision: 1,
    createdAt: base,
    updatedAt: base,
  });
  firestore.put(`danwakuProfiles/${uid}/notes/${activeId}`, {
    noteId: activeId,
    title: "overflow active",
    commitment: "",
    status: "active",
    currentDays: 0,
    createdAt: base,
    updatedAt: base,
    revision: 1,
  });
  const archivedIds = [];
  for (let index = 0; index < 130; index += 1) {
    const noteId = deterministicDanwakuId("overflow-archived", index);
    archivedIds.push(noteId);
    firestore.put(`danwakuProfiles/${uid}/notes/${noteId}`, {
      noteId,
      title: `overflow ${index}`,
      commitment: "",
      status: "archived",
      currentDays: 0,
      createdAt: base - index - 1,
      updatedAt: base - index - 1,
      revision: 1,
    });
  }
  for (let index = 0; index < 2; index += 1) {
    await service.dispatch(uid, {
      action: "delete",
      operationId: `overflow-delete-${String(index + 1).padStart(4, "0")}`,
      noteId: archivedIds[index],
    });
  }
  assert.equal(firestore.get(`danwakuProfiles/${uid}`).archivedCount, 101);
  assert.equal(
    Array.from(firestore.documents.values())
      .filter((value) => value?.status === "archived").length,
    128,
  );
  await assert.rejects(
    service.dispatch(uid, {
      action: "archive",
      operationId: "overflow-archive-blocked-0001",
      noteId: activeId,
    }),
    (error) => error instanceof FakeHttpsError && error.code === "resource-exhausted",
  );
});

test("two parallel archives at 99 leave exactly one winner and a final count of 100", async () => {
  const { service, firestore } = createFixture();
  const base = Date.parse("2026-08-05T12:00:00+09:00");
  firestore.put(`danwakuProfiles/${uid}`, {
    activeNoteCount: 2,
    noteCount: 101,
    highestEverDays: 0,
    archivedCount: 99,
    revision: 1,
    createdAt: base,
    updatedAt: base,
  });
  const activeIds = [0, 1].map((index) => deterministicDanwakuId("parallel-active", index));
  for (const noteId of activeIds) {
    firestore.put(`danwakuProfiles/${uid}/notes/${noteId}`, {
      noteId,
      title: "parallel active",
      commitment: "",
      status: "active",
      currentDays: 0,
      createdAt: base,
      updatedAt: base,
      revision: 1,
    });
  }
  for (let index = 0; index < 99; index += 1) {
    const noteId = deterministicDanwakuId("parallel-archived", index);
    firestore.put(`danwakuProfiles/${uid}/notes/${noteId}`, {
      noteId,
      title: "parallel archived",
      commitment: "",
      status: "archived",
      currentDays: 0,
      createdAt: base - index - 1,
      updatedAt: base - index - 1,
      revision: 1,
    });
  }
  const results = await Promise.allSettled(activeIds.map((noteId, index) => service.dispatch(uid, {
    action: "archive",
    operationId: `parallel-archive-${String(index + 1).padStart(4, "0")}`,
    noteId,
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "resource-exhausted");
  assert.equal(firestore.get(`danwakuProfiles/${uid}`).archivedCount, 100);
  assert.equal(
    Array.from(firestore.documents.values())
      .filter((value) => value?.status === "archived").length,
    100,
  );
});

test("ranking refuses to return partial participant counts beyond its 2000-entry read bound", async () => {
  const { service, firestore } = createFixture();
  const timestamp = Date.parse("2026-08-05T12:00:00+09:00");
  for (let index = 0; index < 2001; index += 1) {
    const entryId = deterministicDanwakuId("public-entry", index);
    firestore.put(`danwakuPublicEntries/${entryId}`, {
      days: 1,
      displayName: "PLAYER",
      expiresAt: timestamp + 1000,
      lastContinuedDayKey: "2026-08-05",
    });
  }
  await assert.rejects(
    service.dispatch(uid, { action: "ranking" }),
    (error) => error instanceof FakeHttpsError && error.code === "resource-exhausted",
  );
});
