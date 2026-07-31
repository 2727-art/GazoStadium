"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  AI_TEXT_TRAINING_SCRIPT_SLOT_IDS,
  AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS,
  aiTextTrainingPayloadHash,
} = require("../ai-text-training");
const {
  AI_TEXT_TRAINING_ACTIVE_PRESENCE_CLEANUP_LIMIT,
  AI_TEXT_TRAINING_PUBLIC_STATS_CACHE_TTL_MS,
  createAiTextTrainingPublicStatsLoader,
  createAiTextTrainingService,
} = require("../ai-text-training-service");
const {
  AI_TEXT_TRAINING_STYLE_PRODUCT_IDS,
} = require("../ai-text-training");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FakeDocumentSnapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.id = reference.id;
    this.exists = value !== undefined;
    this._value = clone(value);
  }

  data() {
    return clone(this._value);
  }

  get(field) {
    return clone(this._value?.[field]);
  }
}

class FakeDocumentReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollectionReference(this.firestore, `${this.path}/${name}`);
  }

  async get() {
    return this.firestore.snapshot(this, this.firestore.documents);
  }

  async set(value, options = {}) {
    const current = this.firestore.documents.get(this.path);
    this.firestore.documents.set(
      this.path,
      options.merge && current !== undefined
        ? { ...clone(current), ...clone(value) }
        : clone(value),
    );
  }
}

class FakeQuery {
  constructor(
    firestore,
    path,
    filters = [],
    orders = [],
    maximum = Infinity,
    cursorPath = "",
  ) {
    this.firestore = firestore;
    this.path = path;
    this.filters = filters;
    this.orders = orders;
    this.maximum = maximum;
    this.cursorPath = cursorPath;
  }

  where(field, operator, value) {
    return new FakeQuery(
      this.firestore,
      this.path,
      [...this.filters, { field, operator, value }],
      this.orders,
      this.maximum,
      this.cursorPath,
    );
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      [...this.orders, { field, direction }],
      this.maximum,
      this.cursorPath,
    );
  }

  limit(maximum) {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      this.orders,
      maximum,
      this.cursorPath,
    );
  }

  startAfter(snapshot) {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      this.orders,
      this.maximum,
      snapshot?.ref?.path || "",
    );
  }

  count() {
    const query = this;
    return {
      async get() {
        const snapshot = await query.get();
        return {
          data: () => ({ count: snapshot.docs.length }),
        };
      },
    };
  }

  async get() {
    this.firestore.queryReads += 1;
    const prefix = `${this.path}/`;
    let rows = [...this.firestore.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => ({
        reference: new FakeDocumentReference(this.firestore, path),
        value: clone(value),
      }));
    for (const filter of this.filters) {
      if (filter.operator === "==") {
        rows = rows.filter((row) => row.value?.[filter.field] === filter.value);
      } else if (filter.operator === ">=") {
        rows = rows.filter((row) => row.value?.[filter.field] >= filter.value);
      } else if (filter.operator === "<=") {
        rows = rows.filter((row) => row.value?.[filter.field] <= filter.value);
      } else {
        throw new Error(`Unsupported operator ${filter.operator}`);
      }
    }
    rows.sort((left, right) => {
      for (const order of this.orders) {
        const leftValue = left.value?.[order.field];
        const rightValue = right.value?.[order.field];
        if (leftValue === rightValue) continue;
        const comparison = leftValue < rightValue ? -1 : 1;
        return order.direction === "desc" ? -comparison : comparison;
      }
      return left.reference.id.localeCompare(right.reference.id);
    });
    if (this.cursorPath) {
      const cursorIndex = rows.findIndex((row) => row.reference.path === this.cursorPath);
      rows = cursorIndex >= 0 ? rows.slice(cursorIndex + 1) : rows;
    }
    return {
      empty: rows.length === 0,
      docs: rows.slice(0, this.maximum).map((row) => (
        new FakeDocumentSnapshot(row.reference, row.value)
      )),
    };
  }
}

class FakeCollectionReference extends FakeQuery {
  doc(id) {
    return new FakeDocumentReference(this.firestore, `${this.path}/${id}`);
  }
}

class FakeTransaction {
  constructor(firestore, documents) {
    this.firestore = firestore;
    this.documents = documents;
  }

  async get(reference) {
    return this.firestore.snapshot(reference, this.documents);
  }

  create(reference, value) {
    if (this.documents.has(reference.path)) {
      throw new Error(`Document already exists: ${reference.path}`);
    }
    this.documents.set(reference.path, clone(value));
  }

  set(reference, value, options = {}) {
    const current = this.documents.get(reference.path);
    this.documents.set(
      reference.path,
      options.merge && current !== undefined
        ? { ...clone(current), ...clone(value) }
        : clone(value),
    );
  }

  update(reference, value) {
    if (!this.documents.has(reference.path)) {
      throw new Error(`Document does not exist: ${reference.path}`);
    }
    this.documents.set(reference.path, {
      ...clone(this.documents.get(reference.path)),
      ...clone(value),
    });
  }

  delete(reference) {
    this.documents.delete(reference.path);
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.queryReads = 0;
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction(callback) {
    const working = new Map(
      [...this.documents.entries()].map(([path, value]) => [path, clone(value)]),
    );
    const result = await callback(new FakeTransaction(this, working));
    this.documents = working;
    return result;
  }

  snapshot(reference, documents) {
    return new FakeDocumentSnapshot(reference, documents.get(reference.path));
  }

  read(path) {
    return clone(this.documents.get(path));
  }

  write(path, value) {
    this.documents.set(path, clone(value));
  }

  count(prefix) {
    return [...this.documents.keys()].filter((path) => path.startsWith(prefix)).length;
  }
}

function stableId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function validLines() {
  return Object.fromEntries(AI_TEXT_TRAINING_SCRIPT_SLOT_IDS.map((slotId) => [
    slotId,
    [`${slotId} 応援その1`, `${slotId} 応援その2`],
  ]));
}

function validZoneLines() {
  return Object.fromEntries(AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS.map((slotId) => [
    slotId,
    [`${slotId} 演出その1`, `${slotId} 演出その2`],
  ]));
}

function publishInput(actionId, overrides = {}) {
  return {
    action: "publish",
    actionId,
    modeId: "mama",
    sellerName: "作者A",
    title: "やさしい見守り台本",
    description: "実際のテンポに合わせて、落ち着いた言葉で応援します。",
    price: 10,
    baseRevision: 0,
    expectedBalance: 20,
    lines: validLines(),
    ...overrides,
  };
}

function createHarness({
  balances = {},
  ownedProducts = {},
  maximumBalance = 1_000,
  now = Date.parse("2026-07-29T03:00:00.000Z"),
  achievementSyncError = null,
} = {}) {
  const firestore = new FakeFirestore();
  const mirrors = [];
  const achievementSyncs = [];
  let clock = now;
  for (const [uid, balance] of Object.entries(balances)) {
    firestore.write(`wallets/${uid}`, {
      balance,
      maxBalance: maximumBalance,
    });
  }
  firestore.write("settings/ledger", { enabled: true });
  const walletReference = (uid) => firestore.collection("wallets").doc(uid);
  const ensureWallet = async (uid) => {
    const path = `wallets/${uid}`;
    if (!firestore.read(path)) {
      firestore.write(path, { balance: 0, maxBalance: maximumBalance });
    }
    return firestore.read(path).balance;
  };
  const service = createAiTextTrainingService({
    firestore,
    HttpsError: FakeHttpsError,
    ensureWallet,
    walletRef: walletReference,
    anjuPayLedgerConfigRef: () => firestore.collection("settings").doc("ledger"),
    walletData(snapshot) {
      const source = snapshot.data() || {};
      return {
        ...source,
        balance: Number.isSafeInteger(source.balance) ? source.balance : 0,
        maxBalance: Number.isSafeInteger(source.maxBalance)
          ? source.maxBalance
          : maximumBalance,
      };
    },
    walletCreditCapacity(wallet) {
      return wallet.maxBalance - wallet.balance;
    },
    debitPoints(wallet, amount) {
      if (wallet.balance < amount) {
        throw new FakeHttpsError("failed-precondition", "AnjuPay残高が不足しています。");
      }
      wallet.balance -= amount;
    },
    creditPoints(wallet, amount) {
      if (wallet.balance + amount > wallet.maxBalance) {
        throw new FakeHttpsError("failed-precondition", "作者の残高が上限です。");
      }
      wallet.balance += amount;
    },
    stageAnjuPayOpening() {},
    appendAnjuPayEntry(transaction, reference, _wallet, _config, entry) {
      transaction.create(reference.collection("ledger").doc(entry.entryId), entry);
    },
    anjuPayWalletMetadataPatch: () => ({}),
    anjuPayEntryId: stableId,
    mirrorWallet: async (uid, balance) => {
      mirrors.push({ uid, balance });
    },
    bestEffort: async (_label, operations) => {
      await Promise.allSettled(operations);
    },
    syncAchievementPublicSurfaces: async (uid, profile) => {
      achievementSyncs.push({ uid, profile: clone(profile) });
      if (achievementSyncError) throw achievementSyncError;
    },
    ownedProductIds: async (uid) => new Set(ownedProducts[uid] || []),
    now: () => clock,
  });
  return {
    achievementSyncs,
    firestore,
    mirrors,
    service,
    setNow(value) {
      clock = value;
    },
    wallet(uid) {
      return firestore.read(`wallets/${uid}`);
    },
  };
}

async function publishPreset(harness, overrides = {}) {
  const result = await harness.service.performAction(
    "seller",
    publishInput("publish_action_0001", {
      expectedBalance: harness.wallet("seller")?.balance ?? 0,
      ...overrides,
    }),
  );
  return result.preset;
}

async function beginAchievementSession(
  harness,
  uid,
  suffix,
  overrides = {},
) {
  return harness.service.performAction(uid, {
    action: "begin_achievement_session",
    actionId: `achievement_session_${suffix}`,
    modeId: "mama",
    roundSeconds: 20,
    ...overrides,
  });
}

async function finishAchievementSession(
  harness,
  uid,
  sessionId,
  overrides = {},
) {
  return harness.service.performAction(uid, {
    action: "finish_achievement_session",
    sessionId,
    outcome: "completed",
    completedRounds: 5,
    activeSeconds: 100,
    ...overrides,
  });
}

async function heartbeatAchievementSession(harness, uid, sessionId, active) {
  return harness.service.performAction(uid, {
    action: "heartbeat_achievement_session",
    sessionId,
    active,
  });
}

async function closeAchievementPresence(harness, uid, sessionId) {
  return harness.service.performAction(uid, {
    action: "close_achievement_presence",
    sessionId,
  });
}

test("private cosmetics can mix owned styles and reject an unowned trial", async () => {
  const [softGlow, neonBeat, crimsonAzure, stardustStage] = AI_TEXT_TRAINING_STYLE_PRODUCT_IDS;
  const harness = createHarness({
    balances: { player: 0 },
    ownedProducts: { player: [softGlow, neonBeat, crimsonAzure] },
  });
  const saved = await harness.service.performAction("player", {
    action: "save_cosmetics",
    panelThemeId: crimsonAzure,
    messageDecorationId: neonBeat,
  });
  assert.deepEqual(saved.cosmetics, {
    panelThemeId: crimsonAzure,
    messageDecorationId: neonBeat,
    ownedStyleIds: [softGlow, neonBeat, crimsonAzure],
  });
  assert.deepEqual(
    harness.firestore.read("aiTextTrainingPreferences/player"),
    {
      schemaVersion: 1,
      panelThemeId: crimsonAzure,
      messageDecorationId: neonBeat,
      updatedAt: Date.parse("2026-07-29T03:00:00.000Z"),
    },
  );
  const state = await harness.service.performAction("player", { action: "state" });
  assert.deepEqual(state.cosmetics, saved.cosmetics);
  await assert.rejects(
    harness.service.performAction("player", {
      action: "save_cosmetics",
      panelThemeId: stardustStage,
      messageDecorationId: "",
    }),
    (error) => error.code === "failed-precondition" && /未購入/.test(error.message),
  );
});

test("achievement session begin rate-limits new actions, preserves retries, and expires storage", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const beginCooldownMs = 30_000;
  const sessionTtlMs = 24 * 60 * 60 * 1_000;
  const harness = createHarness({ balances: { player: 0 }, now });
  const first = await beginAchievementSession(harness, "player", "begin_00000001");
  const retry = await beginAchievementSession(harness, "player", "begin_00000001");
  assert.equal(retry.idempotent, true);
  assert.deepEqual(retry.session, first.session);
  assert.equal(first.session.roundCount, 5);
  assert.equal(first.session.expectedActiveSeconds, 100);
  assert.equal(Object.hasOwn(first.session, "uid"), false);
  assert.equal(Object.hasOwn(first.session, "actionId"), false);
  assert.equal(Object.hasOwn(first.session, "payloadHash"), false);

  const storedFirst = harness.firestore.read(
    `aiTextTrainingAchievementSessions/${first.session.id}`,
  );
  assert.equal(Object.hasOwn(storedFirst, "images"), false);
  assert.equal(Object.hasOwn(storedFirst, "script"), false);
  assert.ok(storedFirst.deleteAt instanceof Date);
  assert.equal(storedFirst.deleteAt.getTime(), now + sessionTtlMs);
  assert.equal(storedFirst.lastSeenAt, now);
  const activeFirst = harness.firestore.read(
    "aiTextTrainingActiveAchievementSessions/player",
  );
  assert.equal(activeFirst.sessionId, first.session.id);
  assert.equal(activeFirst.expiresAt, now + sessionTtlMs);
  assert.equal(activeFirst.lastSeenAt, 0);
  assert.equal(activeFirst.presenceClosedAt, 0);
  assert.ok(activeFirst.deleteAt instanceof Date);
  assert.equal(activeFirst.deleteAt.getTime(), now + sessionTtlMs);
  await assert.rejects(
    beginAchievementSession(harness, "player", "begin_00000001", {
      modeId: "imouto",
    }),
    (error) => error.code === "already-exists",
  );
  await assert.rejects(
    harness.service.performAction("player", {
      action: "begin_achievement_session",
      actionId: "achievement_bad_payload_0001",
      modeId: "mama",
      roundSeconds: 20,
      images: ["private"],
    }),
    (error) => error.code === "invalid-argument",
  );
  await assert.rejects(
    beginAchievementSession(harness, "player", "invalid_seconds_1", {
      roundSeconds: 10,
    }),
    (error) => error.code === "invalid-argument" && /秒数/.test(error.message),
  );
  await assert.rejects(
    beginAchievementSession(harness, "player", "invalid_mode_0001", {
      modeId: "hard",
    }),
    (error) => error.code === "invalid-argument" && /AIモード/.test(error.message),
  );

  harness.setNow(now + 1_000);
  await assert.rejects(
    beginAchievementSession(harness, "player", "begin_00000002"),
    (error) => error.code === "resource-exhausted" && /少し待って/.test(error.message),
  );
  assert.equal(
    harness.firestore.count("aiTextTrainingAchievementSessions/"),
    1,
  );
  assert.equal(
    harness.firestore.read(`aiTextTrainingAchievementSessions/${first.session.id}`).status,
    "active",
  );
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").sessionId,
    first.session.id,
  );

  harness.setNow(now + beginCooldownMs);
  const second = await beginAchievementSession(harness, "player", "begin_00000002");
  const superseded = harness.firestore.read(
    `aiTextTrainingAchievementSessions/${first.session.id}`,
  );
  assert.equal(superseded.status, "exited");
  assert.equal(superseded.outcome, "exited");
  assert.equal(superseded.supersededAt, now + beginCooldownMs);
  assert.equal(superseded.presenceClosedAt, now + beginCooldownMs);
  const storedSecond = harness.firestore.read(
    `aiTextTrainingAchievementSessions/${second.session.id}`,
  );
  assert.ok(storedSecond.deleteAt instanceof Date);
  assert.equal(
    storedSecond.deleteAt.getTime(),
    now + beginCooldownMs + sessionTtlMs,
  );
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").sessionId,
    second.session.id,
  );
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").lastSeenAt,
    0,
  );
  const oldRetry = await beginAchievementSession(harness, "player", "begin_00000001");
  assert.equal(oldRetry.idempotent, true);
  assert.equal(oldRetry.session.status, "exited");
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").sessionId,
    second.session.id,
  );
  assert.equal(
    harness.firestore.read("aiTextTrainingPlayerStats/player")
      .lastAchievementSessionStartedAt,
    now + beginCooldownMs,
  );
});

test("achievement heartbeat records active and paused presence without exposing session data", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ balances: { player: 0 }, now });
  const started = await beginAchievementSession(harness, "player", "presence_000001");
  const sessionPath = `aiTextTrainingAchievementSessions/${started.session.id}`;
  const activePath = "aiTextTrainingActiveAchievementSessions/player";

  harness.setNow(now + 10_000);
  const paused = await heartbeatAchievementSession(
    harness,
    "player",
    started.session.id,
    false,
  );
  assert.deepEqual(paused, { active: false, updatedAt: now + 10_000 });
  assert.equal(harness.firestore.read(sessionPath).lastSeenAt, now + 10_000);
  assert.equal(harness.firestore.read(activePath).lastSeenAt, 0);
  harness.setNow(now + 11_000);
  const pausedBeginRetry = await beginAchievementSession(
    harness,
    "player",
    "presence_000001",
  );
  assert.equal(pausedBeginRetry.idempotent, true);
  assert.equal(harness.firestore.read(activePath).lastSeenAt, 0);
  assert.equal(harness.firestore.read(sessionPath).lastSeenAt, now + 10_000);
  assert.deepEqual(await harness.service.getPublicStats({}), {
    activeCount: 0,
    hasRecentActivity: true,
    updatedAt: now + 11_000,
    freshnessMs: 45_000,
    recentWindowMs: 1_800_000,
  });

  harness.setNow(now + 20_000);
  const active = await heartbeatAchievementSession(
    harness,
    "player",
    started.session.id,
    true,
  );
  assert.deepEqual(active, { active: true, updatedAt: now + 20_000 });
  assert.equal(harness.firestore.read(sessionPath).lastSeenAt, now + 20_000);
  assert.equal(harness.firestore.read(activePath).lastSeenAt, now + 20_000);
  assert.ok(harness.firestore.read(activePath).deleteAt instanceof Date);
  assert.equal((await harness.service.getPublicStats({})).activeCount, 1);

  await assert.rejects(
    heartbeatAchievementSession(harness, "other-player", started.session.id, true),
    (error) => error.code === "not-found",
  );
  await assert.rejects(
    harness.service.performAction("player", {
      action: "heartbeat_achievement_session",
      sessionId: started.session.id,
      active: "yes",
    }),
    (error) => error.code === "invalid-argument",
  );

  harness.setNow(now + 25_000);
  await finishAchievementSession(harness, "player", started.session.id, {
    outcome: "exited",
    completedRounds: 1,
    activeSeconds: 10,
  });
  assert.equal(harness.firestore.read(sessionPath).lastSeenAt, now + 25_000);
  assert.equal(harness.firestore.read(sessionPath).presenceClosedAt, now + 25_000);
  assert.equal(harness.firestore.read(activePath), undefined);
  assert.deepEqual(await harness.service.getPublicStats({}), {
    activeCount: 0,
    hasRecentActivity: true,
    updatedAt: now + 25_000,
    freshnessMs: 45_000,
    recentWindowMs: 1_800_000,
  });
  await assert.rejects(
    heartbeatAchievementSession(harness, "player", started.session.id, true),
    (error) => error.code === "failed-precondition" && /終了/.test(error.message),
  );
  const closeRetry = await closeAchievementPresence(
    harness,
    "player",
    started.session.id,
  );
  assert.deepEqual(closeRetry, {
    closed: true,
    updatedAt: now + 25_000,
    idempotent: true,
  });

  harness.setNow(now + 25_000 + 1_800_001);
  const finishRetry = await finishAchievementSession(
    harness,
    "player",
    started.session.id,
  );
  assert.equal(finishRetry.idempotent, true);
  const beginRetry = await beginAchievementSession(
    harness,
    "player",
    "presence_000001",
  );
  assert.equal(beginRetry.idempotent, true);
  assert.equal(beginRetry.session.status, "exited");
  assert.equal(harness.firestore.read(sessionPath).lastSeenAt, now + 25_000);
  assert.equal(harness.firestore.read(activePath), undefined);
  assert.deepEqual(await harness.service.getPublicStats({}), {
    activeCount: 0,
    hasRecentActivity: false,
    updatedAt: now + 25_000 + 1_800_001,
    freshnessMs: 45_000,
    recentWindowMs: 1_800_000,
  });
});

test("achievement heartbeat cannot resurrect an expired active session", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ now });
  const sessionId = "a".repeat(40);
  harness.firestore.write(`aiTextTrainingAchievementSessions/${sessionId}`, {
    id: sessionId,
    uid: "player",
    status: "active",
    startedAt: now - 24 * 60 * 60 * 1_000,
    lastSeenAt: now - 24 * 60 * 60 * 1_000,
  });
  await assert.rejects(
    heartbeatAchievementSession(harness, "player", sessionId, true),
    (error) => error.code === "failed-precondition" && /有効期限/.test(error.message),
  );
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player"),
    undefined,
  );
  assert.equal(
    harness.firestore.read(`aiTextTrainingAchievementSessions/${sessionId}`).lastSeenAt,
    now - 24 * 60 * 60 * 1_000,
  );
});

test("a closed unfinished session is superseded and can never relight or complete later", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ balances: { player: 0 }, now });
  const first = await beginAchievementSession(harness, "player", "closed_old_0001");
  const firstPath = `aiTextTrainingAchievementSessions/${first.session.id}`;

  harness.setNow(now + 1_000);
  await closeAchievementPresence(harness, "player", first.session.id);
  assert.equal(harness.firestore.read(firstPath).status, "active");
  assert.equal(harness.firestore.read(firstPath).presenceClosedAt, now + 1_000);
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").sessionId,
    first.session.id,
  );
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").lastSeenAt,
    0,
  );

  harness.setNow(now + 30_000);
  const second = await beginAchievementSession(harness, "player", "closed_new_0001");
  const superseded = harness.firestore.read(firstPath);
  assert.equal(superseded.status, "exited");
  assert.equal(superseded.outcome, "exited");
  assert.equal(superseded.presenceClosedAt, now + 1_000);
  assert.equal(superseded.lastSeenAt, now + 1_000);
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").sessionId,
    second.session.id,
  );

  const delayedFinish = await finishAchievementSession(
    harness,
    "player",
    first.session.id,
  );
  assert.equal(delayedFinish.idempotent, true);
  assert.equal(delayedFinish.session.status, "exited");
  assert.equal(delayedFinish.stats.completedSessions, 0);

  harness.setNow(now + 31_000);
  await closeAchievementPresence(harness, "player", second.session.id);
  await assert.rejects(
    heartbeatAchievementSession(harness, "player", first.session.id, true),
    (error) => error.code === "failed-precondition",
  );
  const currentPointer = harness.firestore.read(
    "aiTextTrainingActiveAchievementSessions/player",
  );
  assert.equal(currentPointer.sessionId, second.session.id);
  assert.equal(currentPointer.lastSeenAt, 0);
  assert.equal(currentPointer.presenceClosedAt, now + 31_000);
});

test("public stats loader coalesces in-flight reads and expires after five seconds", async () => {
  const nowValue = Date.parse("2026-07-29T03:00:00.000Z");
  let now = nowValue;
  let loadCount = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const loader = createAiTextTrainingPublicStatsLoader({
    load: async (startedAt) => {
      loadCount += 1;
      await gate;
      return Object.freeze({ activeCount: loadCount, updatedAt: startedAt });
    },
    now: () => now,
  });

  const first = loader();
  const second = loader();
  await Promise.resolve();
  assert.equal(loadCount, 1);
  release();
  const [firstValue, secondValue] = await Promise.all([first, second]);
  assert.strictEqual(firstValue, secondValue);
  assert.strictEqual(await loader(), firstValue);
  assert.equal(loadCount, 1);

  now += AI_TEXT_TRAINING_PUBLIC_STATS_CACHE_TTL_MS - 1;
  assert.strictEqual(await loader(), firstValue);
  assert.equal(loadCount, 1);
  now += 1;
  const refreshed = await loader();
  assert.equal(refreshed.activeCount, 2);
  assert.equal(refreshed.updatedAt, nowValue + AI_TEXT_TRAINING_PUBLIC_STATS_CACHE_TTL_MS);
  assert.equal(loadCount, 2);
});

test("public stats count unique fresh users and expose only aggregate freshness metadata", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ now });
  harness.firestore.write("aiTextTrainingActiveAchievementSessions/fresh-a", {
    uid: "fresh-a",
    lastSeenAt: now - 45_000,
  });
  harness.firestore.write("aiTextTrainingActiveAchievementSessions/stale", {
    uid: "stale",
    lastSeenAt: now - 45_001,
  });
  harness.firestore.write("aiTextTrainingActiveAchievementSessions/fresh-b", {
    uid: "fresh-b",
    lastSeenAt: now,
  });
  harness.firestore.write("aiTextTrainingAchievementSessions/recent", {
    uid: "private-player",
    lastSeenAt: now - 1_800_000,
  });

  const stats = await harness.service.getPublicStats({});
  assert.deepEqual(stats, {
    activeCount: 2,
    hasRecentActivity: true,
    updatedAt: now,
    freshnessMs: 45_000,
    recentWindowMs: 1_800_000,
  });
  assert.deepEqual(Object.keys(stats).toSorted(), [
    "activeCount",
    "freshnessMs",
    "hasRecentActivity",
    "recentWindowMs",
    "updatedAt",
  ]);
  assert.equal(harness.firestore.queryReads, 2);
  assert.strictEqual(await harness.service.getPublicStats({}), stats);
  assert.equal(harness.firestore.queryReads, 2);

  harness.firestore.write("aiTextTrainingAchievementSessions/recent", {
    uid: "private-player",
    lastSeenAt: now - 1_800_001,
  });
  harness.setNow(now + AI_TEXT_TRAINING_PUBLIC_STATS_CACHE_TTL_MS);
  const refreshed = await harness.service.getPublicStats({});
  assert.equal(refreshed.hasRecentActivity, false);
  assert.equal(
    refreshed.updatedAt,
    now + AI_TEXT_TRAINING_PUBLIC_STATS_CACHE_TTL_MS,
  );
  assert.equal(harness.firestore.queryReads, 4);
  await assert.rejects(
    harness.service.getPublicStats({ uid: "private-player" }),
    (error) => error.code === "invalid-argument",
  );
});

test("active presence cleanup drains legacy expired pointers in bounded pages", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ now });
  for (let index = 0; index <= AI_TEXT_TRAINING_ACTIVE_PRESENCE_CLEANUP_LIMIT; index += 1) {
    harness.firestore.write(
      `aiTextTrainingActiveAchievementSessions/expired-${String(index).padStart(3, "0")}`,
      {
        uid: `expired-${index}`,
        sessionId: String(index).padStart(40, "0"),
        expiresAt: now - 1,
        lastSeenAt: 0,
      },
    );
  }
  harness.firestore.write("aiTextTrainingActiveAchievementSessions/fresh", {
    uid: "fresh",
    sessionId: "f".repeat(40),
    expiresAt: now + 1,
    lastSeenAt: now,
  });

  assert.deepEqual(await harness.service.cleanupActivePresence(now), {
    examined: 100,
    removed: 100,
    hasMore: true,
  });
  assert.equal(
    harness.firestore.count("aiTextTrainingActiveAchievementSessions/"),
    2,
  );
  assert.deepEqual(await harness.service.cleanupActivePresence(now), {
    examined: 1,
    removed: 1,
    hasMore: false,
  });
  assert.deepEqual(await harness.service.cleanupActivePresence(now), {
    examined: 0,
    removed: 0,
    hasMore: false,
  });
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/fresh").expiresAt,
    now + 1,
  );
});

test("completed achievement session validates rounds, active time, and server elapsed time once", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ balances: { player: 0 }, now });
  const started = await beginAchievementSession(harness, "player", "complete_000001");
  await assert.rejects(
    finishAchievementSession(harness, "player", started.session.id),
    (error) => error.code === "failed-precondition" && /まだ経過/.test(error.message),
  );

  harness.setNow(now + 100_000);
  await assert.rejects(
    finishAchievementSession(harness, "player", started.session.id, {
      completedRounds: 4,
    }),
    (error) => error.code === "failed-precondition" && /5ラウンド/.test(error.message),
  );
  await assert.rejects(
    finishAchievementSession(harness, "player", started.session.id, {
      activeSeconds: 98.9,
    }),
    (error) => error.code === "failed-precondition" && /5ラウンド/.test(error.message),
  );
  await heartbeatAchievementSession(harness, "player", started.session.id, true);

  const completed = await finishAchievementSession(
    harness,
    "player",
    started.session.id,
    { activeSeconds: 99 },
  );
  assert.equal(completed.idempotent, false);
  assert.equal(completed.session.status, "completed");
  assert.deepEqual(completed.stats, {
    completedSessions: 1,
    completionDays: 1,
    lastCompletionDateKey: "2026-07-29",
  });
  assert.ok(completed.newlyUnlocked.includes("ai_training_sessions_1"));
  assert.equal(
    harness.firestore.read("achievementProfiles/player")
      .unlocked.ai_training_sessions_1,
    now + 100_000,
  );
  assert.equal(harness.achievementSyncs.length, 1);
  assert.equal(harness.achievementSyncs[0].uid, "player");
  assert.ok(
    harness.achievementSyncs[0].profile.unlocked.ai_training_sessions_1,
  );
  const completedPointer = harness.firestore.read(
    "aiTextTrainingActiveAchievementSessions/player",
  );
  assert.equal(completedPointer.sessionId, started.session.id);
  assert.equal(completedPointer.lastSeenAt, now + 100_000);
  assert.equal(completedPointer.presenceClosedAt, 0);

  const retry = await finishAchievementSession(
    harness,
    "player",
    started.session.id,
  );
  assert.equal(retry.idempotent, true);
  assert.equal(retry.session.status, "completed");
  assert.equal(retry.stats.completedSessions, 1);
  assert.deepEqual(retry.newlyUnlocked, []);
  assert.equal(
    harness.firestore.read("aiTextTrainingPlayerStats/player").completedSessions,
    1,
  );
  assert.deepEqual(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player"),
    completedPointer,
  );
  assert.equal(harness.achievementSyncs.length, 2);
  assert.equal(harness.achievementSyncs[1].uid, "player");
  assert.deepEqual(
    harness.achievementSyncs[1].profile,
    harness.firestore.read("achievementProfiles/player"),
  );

  harness.setNow(now + 101_000);
  await heartbeatAchievementSession(harness, "player", started.session.id, false);
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").lastSeenAt,
    0,
  );
  harness.setNow(now + 102_000);
  await heartbeatAchievementSession(harness, "player", started.session.id, true);
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player").lastSeenAt,
    now + 102_000,
  );
  harness.setNow(now + 103_000);
  const closed = await closeAchievementPresence(harness, "player", started.session.id);
  assert.deepEqual(closed, {
    closed: true,
    updatedAt: now + 103_000,
    idempotent: false,
  });
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player"),
    undefined,
  );
  await assert.rejects(
    heartbeatAchievementSession(harness, "player", started.session.id, true),
    (error) => error.code === "failed-precondition" && /灯りは終了/.test(error.message),
  );

  harness.setNow(now + 103_000 + 1_800_001);
  const closeRetry = await closeAchievementPresence(harness, "player", started.session.id);
  assert.equal(closeRetry.idempotent, true);
  assert.equal(closeRetry.updatedAt, now + 103_000);
  assert.equal(
    harness.firestore.read(`aiTextTrainingAchievementSessions/${started.session.id}`)
      .lastSeenAt,
    now + 103_000,
  );
  assert.equal((await harness.service.getPublicStats({})).hasRecentActivity, false);
});

test("a close before completed finish preserves the close marker and releases the pointer", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ balances: { player: 0 }, now });
  const started = await beginAchievementSession(harness, "player", "close_race_00001");
  const sessionPath = `aiTextTrainingAchievementSessions/${started.session.id}`;
  const activePath = "aiTextTrainingActiveAchievementSessions/player";

  harness.setNow(now + 5_000);
  await heartbeatAchievementSession(harness, "player", started.session.id, true);
  harness.setNow(now + 10_000);
  await closeAchievementPresence(harness, "player", started.session.id);
  assert.equal(harness.firestore.read(sessionPath).status, "active");
  assert.equal(harness.firestore.read(sessionPath).presenceClosedAt, now + 10_000);
  assert.equal(harness.firestore.read(activePath).lastSeenAt, 0);

  harness.setNow(now + 100_000);
  const completed = await finishAchievementSession(
    harness,
    "player",
    started.session.id,
  );
  assert.equal(completed.session.status, "completed");
  assert.equal(completed.stats.completedSessions, 1);
  assert.equal(harness.firestore.read(sessionPath).presenceClosedAt, now + 10_000);
  assert.equal(harness.firestore.read(activePath), undefined);
  await assert.rejects(
    heartbeatAchievementSession(harness, "player", started.session.id, true),
    (error) => error.code === "failed-precondition",
  );
});

test("safety stop is terminal, closes the presence lease, and never counts as completion", async () => {
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const harness = createHarness({ balances: { player: 0 }, now });
  const started = await beginAchievementSession(harness, "player", "safety_0000001");
  const stopped = await finishAchievementSession(
    harness,
    "player",
    started.session.id,
    {
      outcome: "safety_stopped",
      completedRounds: 1,
      activeSeconds: 8,
    },
  );
  assert.equal(stopped.session.status, "safety_stopped");
  assert.equal(stopped.stats.completedSessions, 0);
  assert.deepEqual(stopped.newlyUnlocked, []);
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player"),
    undefined,
  );
  const rateLimitedStats = harness.firestore.read("aiTextTrainingPlayerStats/player");
  assert.equal(Number(rateLimitedStats.completedSessions || 0), 0);
  assert.equal(rateLimitedStats.lastAchievementSessionStartedAt, now);
  assert.equal(harness.firestore.read("achievementProfiles/player"), undefined);

  harness.setNow(now + 1_000);
  await assert.rejects(
    beginAchievementSession(harness, "player", "safety_restart_0001"),
    (error) => error.code === "resource-exhausted",
  );

  harness.setNow(now + 100_000);
  const terminalRetry = await finishAchievementSession(
    harness,
    "player",
    started.session.id,
  );
  assert.equal(terminalRetry.idempotent, true);
  assert.equal(terminalRetry.session.status, "safety_stopped");
  assert.equal(
    harness.firestore.read("aiTextTrainingPlayerStats/player")
      .lastAchievementSessionStartedAt,
    now,
  );
  assert.deepEqual(harness.achievementSyncs, []);
});

test("completionDays counts different JST dates while sessions always accumulate", async () => {
  const harness = createHarness({
    balances: { player: 0 },
    now: Date.parse("2026-07-29T03:00:00.000Z"),
  });
  const completeAt = async (suffix, startedAt) => {
    harness.setNow(startedAt);
    const started = await beginAchievementSession(harness, "player", suffix, {
      roundSeconds: 15,
    });
    harness.setNow(startedAt + 75_000);
    return finishAchievementSession(harness, "player", started.session.id, {
      activeSeconds: 75,
    });
  };
  await completeAt("days_same_000001", Date.parse("2026-07-29T03:00:00.000Z"));
  const sameDay = await completeAt(
    "days_same_000002",
    Date.parse("2026-07-29T05:00:00.000Z"),
  );
  assert.equal(sameDay.stats.completedSessions, 2);
  assert.equal(sameDay.stats.completionDays, 1);
  const nextDay = await completeAt(
    "days_next_000001",
    Date.parse("2026-07-30T03:00:00.000Z"),
  );
  assert.equal(nextDay.stats.completedSessions, 3);
  assert.equal(nextDay.stats.completionDays, 2);
  assert.equal(nextDay.stats.lastCompletionDateKey, "2026-07-30");
});

test("publishing charges one Pay once and fixes an immutable revision", async () => {
  const harness = createHarness({ balances: { seller: 20 } });
  const input = publishInput("publish_action_0001");
  const first = await harness.service.performAction("seller", input);
  const retry = await harness.service.performAction("seller", input);
  assert.equal(first.balance, 19);
  assert.equal(retry.balance, 19);
  assert.equal(retry.idempotent, true);
  assert.equal(harness.wallet("seller").balance, 19);
  assert.equal(first.preset.revision, 1);
  assert.ok(
    harness.firestore.read(
      `aiTextTrainingPresets/${first.preset.id}/revisions/00000001`,
    ),
  );
  assert.equal(harness.firestore.count("wallets/seller/ledger/"), 1);
});

test("standard and defeat-zone scripts are separate products for each personality", async () => {
  const harness = createHarness({ balances: { seller: 20 } });
  const standard = await harness.service.performAction(
    "seller",
    publishInput("publish_standard_0001"),
  );
  const zone = await harness.service.performAction("seller", publishInput(
    "publish_zone_0000001",
    {
      productType: "defeat_zone",
      zoneLines: validZoneLines(),
      title: "最後まで敗北ZONE台本",
      baseRevision: 0,
      expectedBalance: 19,
    },
  ));

  assert.notEqual(standard.preset.id, zone.preset.id);
  assert.equal(standard.preset.productType, "standard");
  assert.deepEqual(standard.preset.zoneLines, {});
  assert.equal(zone.preset.productType, "defeat_zone");
  assert.deepEqual(Object.keys(zone.preset.zoneLines), AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS);
  const state = await harness.service.performAction("seller", { action: "state" });
  assert.equal(state.ownPresets.length, 2);
  assert.deepEqual(
    state.ownPresets.map(({ productType }) => productType).sort(),
    ["defeat_zone", "standard"],
  );
  const zoneBrowse = await harness.service.performAction("seller", {
    action: "browse",
    modeId: "mama",
    productType: "defeat_zone",
  });
  assert.deepEqual(zoneBrowse.presets.map(({ id }) => id), [zone.preset.id]);
  const revision = harness.firestore.read(
    `aiTextTrainingPresets/${zone.preset.id}/revisions/00000001`,
  );
  assert.equal(revision.productType, "defeat_zone");
  assert.deepEqual(revision.zoneLines, validZoneLines());
});

test("legacy standard browse pages past a full page of defeat-zone products", async () => {
  const harness = createHarness();
  for (let index = 0; index < 100; index += 1) {
    const id = stableId(`zone-crowd-${index}`);
    harness.firestore.write(`aiTextTrainingPresets/${id}`, {
      schemaVersion: 2,
      sellerUid: `zone-seller-${index}`,
      publicSellerId: stableId(`zone-seller-${index}`),
      sellerName: "ZONE作者",
      modeId: "mama",
      productType: "defeat_zone",
      title: "敗北ZONE台本",
      description: "敗北ZONEの専用場面まで収録した応援台本です。",
      price: 10,
      revision: 1,
      lines: validLines(),
      zoneLines: validZoneLines(),
      status: "active",
      actualUseCount: 1_000 - index,
      rankingUseCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });
  }
  const legacyId = stableId("legacy-standard-after-zone-page");
  harness.firestore.write(`aiTextTrainingPresets/${legacyId}`, {
    schemaVersion: 1,
    sellerUid: "legacy-seller",
    publicSellerId: stableId("legacy-seller"),
    sellerName: "旧台本作者",
    modeId: "mama",
    title: "旧通常応援台本",
    description: "productType追加前から公開されている通常応援台本です。",
    price: 10,
    revision: 1,
    lines: validLines(),
    status: "active",
    actualUseCount: 1,
    rankingUseCount: 0,
    createdAt: 1,
    updatedAt: 1,
  });

  const result = await harness.service.performAction("viewer", {
    action: "browse",
    modeId: "mama",
    productType: "standard",
  });
  assert.deepEqual(result.presets.map(({ id }) => id), [legacyId]);
  assert.equal(result.presets[0].productType, "standard");
});

test("legacy standard compatibility browse stops after five pages of ZONE products", async () => {
  const harness = createHarness();
  for (let index = 0; index < 600; index += 1) {
    const id = stableId(`zone-only-crowd-${index}`);
    harness.firestore.write(`aiTextTrainingPresets/${id}`, {
      schemaVersion: 2,
      sellerUid: `zone-only-seller-${index}`,
      publicSellerId: stableId(`zone-only-seller-${index}`),
      sellerName: "ZONE作者",
      modeId: "mama",
      productType: "defeat_zone",
      title: "敗北ZONE台本",
      description: "敗北ZONEの専用場面まで収録した応援台本です。",
      price: 10,
      revision: 1,
      lines: validLines(),
      zoneLines: validZoneLines(),
      status: "active",
      actualUseCount: 10_000 - index,
      rankingUseCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });
  }

  const result = await harness.service.performAction("viewer", {
    action: "browse",
    modeId: "mama",
    productType: "standard",
  });
  assert.deepEqual(result.presets, []);
  assert.equal(harness.firestore.queryReads, 5);
});

test("an old publish retry mirrors the current wallet balance, never its saved balance", async () => {
  const harness = createHarness({ balances: { seller: 20 } });
  const input = publishInput("publish_action_0001");
  await harness.service.performAction("seller", input);
  harness.firestore.write("wallets/seller", {
    ...harness.wallet("seller"),
    balance: 12,
  });
  const retry = await harness.service.performAction("seller", input);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.balance, 12);
  assert.deepEqual(harness.mirrors.at(-1), { uid: "seller", balance: 12 });
  assert.equal(harness.firestore.count("wallets/seller/ledger/"), 1);
});

test("legacy standard publish payload hashes remain retry-compatible", async () => {
  const harness = createHarness({ balances: { seller: 20 } });
  const input = publishInput("publish_legacy_retry_1");
  const first = await harness.service.performAction("seller", input);
  const actionEntry = [...harness.firestore.documents.entries()]
    .find(([path]) => path.startsWith("aiTextTrainingPublishActions/"));
  assert.ok(actionEntry);
  const [actionPath, action] = actionEntry;
  action.payloadHash = aiTextTrainingPayloadHash({
    modeId: input.modeId,
    sellerName: input.sellerName,
    title: input.title,
    description: input.description,
    price: input.price,
    baseRevision: input.baseRevision,
    lines: input.lines,
  });
  delete action.preset.productType;
  delete action.preset.zoneLines;
  harness.firestore.write(actionPath, action);

  const retry = await harness.service.performAction("seller", input);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.preset.id, first.preset.id);
  assert.equal(retry.preset.productType, "standard");
  assert.equal(harness.firestore.count("wallets/seller/ledger/"), 1);
});

test("publishing rejects a balance changed since the author review", async () => {
  const harness = createHarness({ balances: { seller: 20 } });
  const input = publishInput("publish_action_balance_guard", {
    expectedBalance: 19,
  });
  await assert.rejects(
    harness.service.performAction("seller", input),
    (error) => error.code === "failed-precondition" && /公開確認画面から変わりました/.test(error.message),
  );
  assert.equal(harness.wallet("seller").balance, 20);
  assert.equal(harness.firestore.count("aiTextTrainingPresets/"), 0);
  const published = await harness.service.performAction("seller", {
    ...input,
    expectedBalance: 20,
  });
  assert.equal(published.balance, 19);
});

test("paid use is one transaction, snapshots the script, and is action-idempotent", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 50 } });
  const preset = await publishPreset(harness);
  const data = {
    action: "start_paid_use",
    actionId: "use_action_00000001",
    presetId: preset.id,
    expectedPrice: preset.price,
    expectedRevision: preset.revision,
    expectedBalance: 50,
  };
  const first = await harness.service.performAction("buyer", data);
  const retry = await harness.service.performAction("buyer", data);
  assert.equal(first.use.price, 10);
  assert.equal(first.use.fee, 2);
  assert.equal(first.use.sellerProceeds, 8);
  assert.equal(first.use.preset.title, preset.title);
  assert.equal(first.use.preset.revision, 1);
  assert.equal(harness.wallet("buyer").balance, 40);
  assert.equal(harness.wallet("seller").balance, 27);
  assert.equal(retry.use.id, first.use.id);
  assert.equal(retry.idempotent, true);
  assert.equal(harness.firestore.count("aiTextTrainingUses/"), 1);
  assert.equal(harness.achievementSyncs.length, 2);
  assert.deepEqual(
    harness.achievementSyncs.map(({ uid }) => uid),
    ["seller", "seller"],
  );
  assert.ok(
    harness.achievementSyncs[1].profile.unlocked.ai_training_script_uses_1,
  );
});

test("defeat-zone products bind play style and snapshot every dedicated line", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 50 } });
  const zonePreset = await publishPreset(harness, {
    productType: "defeat_zone",
    zoneLines: validZoneLines(),
    title: "敗北ZONE専用台本",
  });
  const purchase = {
    action: "start_paid_use",
    actionId: "zone_use_action_0001",
    presetId: zonePreset.id,
    expectedPrice: zonePreset.price,
    expectedRevision: zonePreset.revision,
    expectedBalance: 50,
  };
  await assert.rejects(
    harness.service.performAction("buyer", purchase),
    (error) => error.code === "failed-precondition" && /敗北ZONE専用/.test(error.message),
  );
  assert.equal(harness.wallet("buyer").balance, 50);

  const started = await harness.service.performAction("buyer", {
    ...purchase,
    playStyle: "defeat_zone",
  });
  assert.equal(started.use.playStyle, "defeat_zone");
  assert.equal(started.use.preset.productType, "defeat_zone");
  assert.deepEqual(started.use.preset.zoneLines, validZoneLines());
  const storedUse = harness.firestore.read(`aiTextTrainingUses/${started.use.id}`);
  assert.equal(storedUse.playStyle, "defeat_zone");
  assert.equal(storedUse.presetSnapshot.productType, "defeat_zone");
  assert.deepEqual(storedUse.presetSnapshot.zoneLines, validZoneLines());
  const revisionBuyer = [...harness.firestore.documents.entries()]
    .find(([path]) => path.startsWith("aiTextTrainingPresetRevisionBuyers/"))?.[1];
  assert.equal(revisionBuyer.productType, "defeat_zone");
  assert.equal(revisionBuyer.playStyle, "defeat_zone");
  assert.equal(Object.hasOwn(revisionBuyer, "zoneLines"), false);
  const buyerLedger = [...harness.firestore.documents.entries()]
    .find(([path]) => path.startsWith("wallets/buyer/ledger/"))?.[1];
  assert.equal(buyerLedger.details.productType, "defeat_zone");
  assert.equal(buyerLedger.details.playStyle, "defeat_zone");
});

test("standard scripts can support defeat-zone play and old active uses fall back to standard", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 50 } });
  const preset = await publishPreset(harness);
  const defeatUse = await harness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: "standard_in_zone_0001",
    presetId: preset.id,
    expectedPrice: preset.price,
    expectedRevision: preset.revision,
    expectedBalance: 50,
    playStyle: "defeat_zone",
  });
  assert.equal(defeatUse.use.playStyle, "defeat_zone");
  assert.equal(defeatUse.use.preset.productType, "standard");
  assert.deepEqual(defeatUse.use.preset.zoneLines, {});
  await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: defeatUse.use.id,
    outcome: "completed",
  });

  const legacyData = {
    action: "start_paid_use",
    actionId: "legacy_use_retry_0001",
    presetId: preset.id,
    expectedPrice: preset.price,
    expectedRevision: preset.revision,
    expectedBalance: 40,
  };
  const legacyUse = await harness.service.performAction("buyer", legacyData);
  const stored = harness.firestore.read(`aiTextTrainingUses/${legacyUse.use.id}`);
  delete stored.playStyle;
  stored.payloadHash = aiTextTrainingPayloadHash({
    presetId: preset.id,
    expectedPrice: preset.price,
    expectedRevision: preset.revision,
  });
  harness.firestore.write(`aiTextTrainingUses/${legacyUse.use.id}`, stored);
  const retry = await harness.service.performAction("buyer", legacyData);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.use.playStyle, "standard");
});

test("paid use rejects a balance changed since the buyer review", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 50 } });
  const preset = await publishPreset(harness);
  const data = {
    action: "start_paid_use",
    actionId: "use_action_balance_guard",
    presetId: preset.id,
    expectedPrice: preset.price,
    expectedRevision: preset.revision,
    expectedBalance: 49,
  };
  await assert.rejects(
    harness.service.performAction("buyer", data),
    (error) => error.code === "failed-precondition" && /確認画面から変わりました/.test(error.message),
  );
  assert.equal(harness.wallet("buyer").balance, 50);
  assert.equal(harness.wallet("seller").balance, 19);
  assert.equal(harness.firestore.count("aiTextTrainingUses/"), 0);
  const started = await harness.service.performAction("buyer", {
    ...data,
    expectedBalance: 50,
  });
  assert.equal(started.use.status, "active");
});

test("same buyer and seller pay every use but count only once per JST day in ranking", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 100 } });
  const preset = await publishPreset(harness);
  const start = async (suffix) => harness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: `use_action_${suffix}`,
    presetId: preset.id,
    expectedPrice: 10,
    expectedRevision: 1,
    expectedBalance: harness.wallet("buyer").balance,
  });
  const first = await start("000000000001");
  await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: first.use.id,
    outcome: "completed",
  });
  const second = await start("000000000002");
  assert.equal(first.use.rankingCounted, true);
  assert.equal(second.use.rankingCounted, false);
  assert.equal(harness.wallet("buyer").balance, 80);
  assert.equal(harness.wallet("seller").balance, 35);
  const stats = harness.firestore.read("aiTextTrainingSellerStats/seller");
  assert.equal(stats.actualGross, 20);
  assert.equal(stats.rankingGross, 10);
  assert.equal(stats.useCount, 2);
  assert.equal(stats.rankingUseCount, 1);
  assert.equal(stats.uniqueBuyers, 1);
});

test("daily ranking pair cap stays shared across standard and defeat-zone products", async () => {
  const harness = createHarness({ balances: { seller: 30, buyer: 100 } });
  const standard = await publishPreset(harness);
  const zone = await harness.service.performAction("seller", publishInput(
    "publish_zone_ranking_1",
    {
      productType: "defeat_zone",
      zoneLines: validZoneLines(),
      title: "敗北ZONEランキング台本",
      expectedBalance: harness.wallet("seller").balance,
    },
  ));
  const first = await harness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: "ranking_standard_0001",
    presetId: standard.id,
    expectedPrice: standard.price,
    expectedRevision: standard.revision,
    expectedBalance: 100,
    playStyle: "standard",
  });
  await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: first.use.id,
    outcome: "completed",
  });
  const second = await harness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: "ranking_zone_0000001",
    presetId: zone.preset.id,
    expectedPrice: zone.preset.price,
    expectedRevision: zone.preset.revision,
    expectedBalance: 90,
    playStyle: "defeat_zone",
  });
  assert.equal(first.use.rankingCounted, true);
  assert.equal(second.use.rankingCounted, false);
  const stats = harness.firestore.read("aiTextTrainingSellerStats/seller");
  assert.equal(stats.actualGross, 20);
  assert.equal(stats.rankingGross, 10);
});

test("paid uses unlock seller AI achievements from ranked uses and unique buyers without leaking to buyers", async () => {
  const harness = createHarness({
    balances: {
      seller: 100,
      buyer1: 100,
      buyer2: 100,
      buyer3: 100,
    },
  });
  const preset = await publishPreset(harness);
  const use = async (buyer, suffix) => {
    const response = await harness.service.performAction(buyer, {
      action: "start_paid_use",
      actionId: `seller_unlock_use_${suffix}`,
      presetId: preset.id,
      expectedPrice: 10,
      expectedRevision: 1,
      expectedBalance: harness.wallet(buyer).balance,
    });
    assert.equal(Object.hasOwn(response, "newlyUnlocked"), false);
    assert.equal(Object.hasOwn(response, "sellerUid"), false);
    assert.doesNotMatch(JSON.stringify(response), /"sellerUid"/);
    assert.doesNotMatch(
      JSON.stringify(response),
      /ai_training_(?:script_uses|unique_buyers)_/,
    );
    await harness.service.performAction(buyer, {
      action: "finish_use",
      useId: response.use.id,
      outcome: "safety_stopped",
    });
  };

  await use("buyer1", "buyer1_first_001");
  let profile = harness.firestore.read("achievementProfiles/seller");
  assert.ok(profile.unlocked.ai_training_script_uses_1);
  assert.equal(profile.unlocked.ai_training_script_uses_3, undefined);
  assert.equal(harness.achievementSyncs.length, 1);
  assert.equal(harness.achievementSyncs[0].uid, "seller");
  assert.ok(
    harness.achievementSyncs[0].profile.unlocked.ai_training_script_uses_1,
  );

  await use("buyer1", "buyer1_repeat_01");
  let stats = harness.firestore.read("aiTextTrainingSellerStats/seller");
  assert.equal(stats.useCount, 2);
  assert.equal(stats.rankingUseCount, 1);
  assert.equal(stats.uniqueBuyers, 1);
  profile = harness.firestore.read("achievementProfiles/seller");
  assert.equal(profile.unlocked.ai_training_script_uses_3, undefined);
  assert.equal(harness.achievementSyncs.length, 1);

  await use("buyer2", "buyer2_first_001");
  await use("buyer3", "buyer3_first_001");
  stats = harness.firestore.read("aiTextTrainingSellerStats/seller");
  assert.equal(stats.useCount, 4);
  assert.equal(stats.rankingUseCount, 3);
  assert.equal(stats.uniqueBuyers, 3);
  profile = harness.firestore.read("achievementProfiles/seller");
  assert.ok(profile.unlocked.ai_training_script_uses_3);
  assert.ok(profile.unlocked.ai_training_unique_buyers_3);
  assert.equal(harness.achievementSyncs.length, 2);
  assert.deepEqual(
    harness.achievementSyncs.map(({ uid }) => uid),
    ["seller", "seller"],
  );
  assert.ok(
    harness.achievementSyncs[1].profile.unlocked.ai_training_script_uses_3,
  );
  assert.ok(
    harness.achievementSyncs[1].profile.unlocked.ai_training_unique_buyers_3,
  );
});

test("public showcase sync failures never undo a completed workout or paid use", async () => {
  const syncError = new Error("public showcase unavailable");
  const now = Date.parse("2026-07-29T03:00:00.000Z");
  const workoutHarness = createHarness({
    balances: { player: 0 },
    now,
    achievementSyncError: syncError,
  });
  const started = await beginAchievementSession(
    workoutHarness,
    "player",
    "sync_failure_workout_01",
  );
  workoutHarness.setNow(now + 100_000);
  const completed = await finishAchievementSession(
    workoutHarness,
    "player",
    started.session.id,
  );
  assert.equal(completed.session.status, "completed");
  assert.equal(completed.stats.completedSessions, 1);
  assert.equal(workoutHarness.achievementSyncs.length, 1);
  assert.equal(
    workoutHarness.firestore.read("aiTextTrainingPlayerStats/player").completedSessions,
    1,
  );
  assert.ok(
    workoutHarness.firestore.read("achievementProfiles/player")
      .unlocked.ai_training_sessions_1,
  );

  const saleHarness = createHarness({
    balances: { seller: 20, buyer: 100 },
    achievementSyncError: syncError,
  });
  const preset = await publishPreset(saleHarness);
  const paidUse = await saleHarness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: "sync_failure_use_000001",
    presetId: preset.id,
    expectedPrice: 10,
    expectedRevision: 1,
    expectedBalance: saleHarness.wallet("buyer").balance,
  });
  assert.equal(paidUse.use.status, "active");
  assert.equal(Object.hasOwn(paidUse, "sellerUid"), false);
  assert.equal(Object.hasOwn(paidUse, "newlyUnlocked"), false);
  assert.equal(saleHarness.wallet("buyer").balance, 90);
  assert.equal(saleHarness.achievementSyncs.length, 1);
  assert.equal(saleHarness.achievementSyncs[0].uid, "seller");
  assert.ok(
    saleHarness.firestore.read("achievementProfiles/seller")
      .unlocked.ai_training_script_uses_1,
  );
  assert.equal(
    saleHarness.firestore.read(`aiTextTrainingUses/${paidUse.use.id}`).status,
    "active",
  );
});

test("active use blocks stockpiling and finish is idempotent", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 100 } });
  const preset = await publishPreset(harness);
  const first = await harness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: "use_action_00000001",
    presetId: preset.id,
    expectedPrice: 10,
    expectedRevision: 1,
    expectedBalance: 100,
  });
  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "start_paid_use",
      actionId: "use_action_00000002",
      presetId: preset.id,
      expectedPrice: 10,
      expectedRevision: 1,
      expectedBalance: 90,
    }),
    (error) => error.code === "failed-precondition" && /開始済み/.test(error.message),
  );
  const finished = await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: first.use.id,
    outcome: "safety_stopped",
  });
  const retry = await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: first.use.id,
    outcome: "completed",
  });
  assert.equal(finished.use.status, "safety_stopped");
  assert.equal(retry.use.status, "safety_stopped");
  assert.equal(retry.idempotent, true);
});

test("terminal uses cannot resume or start another session through an old action", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 100 } });
  const preset = await publishPreset(harness);
  const startData = {
    action: "start_paid_use",
    actionId: "use_action_terminal_guard",
    presetId: preset.id,
    expectedPrice: 10,
    expectedRevision: 1,
    expectedBalance: 100,
  };
  const started = await harness.service.performAction("buyer", startData);
  const resumed = await harness.service.performAction("buyer", {
    action: "resume_use",
    useId: started.use.id,
  });
  assert.equal(resumed.use.status, "active");
  await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: started.use.id,
    outcome: "completed",
  });
  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "resume_use",
      useId: started.use.id,
    }),
    (error) => error.code === "failed-precondition" && /終了済み/.test(error.message),
  );
  const oldActionRetry = await harness.service.performAction("buyer", startData);
  assert.equal(oldActionRetry.use, undefined);
  assert.equal(oldActionRetry.terminalAction, true);
  assert.equal(oldActionRetry.idempotent, true);
  assert.equal(harness.wallet("buyer").balance, 90);
  assert.equal(harness.firestore.count("aiTextTrainingUses/"), 1);
});

test("price/revision conflict, self use, and seller cap roll back before charging", async () => {
  const harness = createHarness({
    balances: { seller: 994, buyer: 100 },
    maximumBalance: 1_000,
  });
  const preset = await publishPreset(harness);
  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "start_paid_use",
      actionId: "use_action_00000001",
      presetId: preset.id,
      expectedPrice: 5,
      expectedRevision: 1,
      expectedBalance: 100,
    }),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(harness.wallet("buyer").balance, 100);
  await assert.rejects(
    harness.service.performAction("seller", {
      action: "start_paid_use",
      actionId: "use_action_00000002",
      presetId: preset.id,
      expectedPrice: 10,
      expectedRevision: 1,
      expectedBalance: 993,
    }),
    (error) => error.code === "failed-precondition" && /無料試遊/.test(error.message),
  );
  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "start_paid_use",
      actionId: "use_action_00000003",
      presetId: preset.id,
      expectedPrice: 10,
      expectedRevision: 1,
      expectedBalance: 100,
    }),
    (error) => error.code === "failed-precondition" && /上限/.test(error.message),
  );
  assert.equal(harness.wallet("buyer").balance, 100);
  assert.equal(harness.wallet("seller").balance, 993);
  assert.equal(harness.firestore.count("aiTextTrainingUses/"), 0);
});

test("ranking joins only the current separately-consented X handle", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 100 } });
  const preset = await publishPreset(harness);
  await harness.service.performAction("seller", {
    action: "save_profile",
    xPublic: true,
    xHandle: "@seller_x",
  });
  await harness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: "use_action_00000001",
    presetId: preset.id,
    expectedPrice: 10,
    expectedRevision: 1,
    expectedBalance: 100,
  });
  const visible = await harness.service.performAction("buyer", {
    action: "rankings",
    period: "monthly",
  });
  assert.equal(visible.rows[0].xHandle, "seller_x");
  await harness.service.performAction("seller", {
    action: "save_profile",
    xPublic: false,
    xHandle: "seller_x",
  });
  const hidden = await harness.service.performAction("buyer", {
    action: "rankings",
    period: "monthly",
  });
  assert.equal(hidden.rows[0].xPublic, false);
  assert.equal(hidden.rows[0].xHandle, "");
  assert.equal(hidden.rows[0].rankingGross, 10);
});

test("reports snapshot the exact revision and allow a later revision to be reported", async () => {
  const harness = createHarness({ balances: { seller: 30, buyer: 30 } });
  const firstPreset = await publishPreset(harness);
  const firstUse = await harness.service.performAction("buyer", {
    action: "start_paid_use",
    actionId: "use_action_report_revision_1",
    presetId: firstPreset.id,
    expectedPrice: firstPreset.price,
    expectedRevision: 1,
    expectedBalance: 30,
  });
  await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: firstUse.use.id,
    outcome: "completed",
  });
  const firstReport = await harness.service.performAction("buyer", {
    action: "report",
    presetId: firstPreset.id,
    expectedRevision: 1,
    reason: "dangerous",
  });
  const firstRetry = await harness.service.performAction("buyer", {
    action: "report",
    presetId: firstPreset.id,
    expectedRevision: 1,
    reason: "dangerous",
  });
  assert.equal(firstReport.idempotent, false);
  assert.equal(firstRetry.idempotent, true);

  const revisedLines = validLines();
  revisedLines.clear[0] = "改訂後の完走メッセージ";
  const revised = await harness.service.performAction(
    "seller",
    publishInput("publish_action_0002", {
      baseRevision: 1,
      expectedBalance: harness.wallet("seller").balance,
      lines: revisedLines,
    }),
  );
  assert.equal(revised.preset.revision, 2);
  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "report",
      presetId: firstPreset.id,
      expectedRevision: 1,
      reason: "harassment",
    }),
    (error) => error.code === "failed-precondition" && /改訂されました/.test(error.message),
  );
  const secondReport = await harness.service.performAction("buyer", {
    action: "report",
    presetId: firstPreset.id,
    expectedRevision: 2,
    reason: "dangerous",
  });
  assert.equal(secondReport.idempotent, false);

  const reports = [...harness.firestore.documents.entries()]
    .filter(([path]) => path.startsWith("aiTextTrainingReports/"))
    .map(([, value]) => value)
    .sort((left, right) => left.presetRevision - right.presetRevision);
  assert.equal(reports.length, 2);
  assert.deepEqual(reports.map((report) => report.presetRevision), [1, 2]);
  assert.equal(reports[0].presetSnapshot.revision, 1);
  assert.equal(reports[1].presetSnapshot.revision, 2);
  assert.equal(reports[0].verifiedBuyer, true);
  assert.equal(reports[0].highRiskBuyerReport, true);
  assert.equal(reports[1].verifiedBuyer, false);
  assert.equal(reports[1].highRiskBuyerReport, false);
  assert.equal(reports[1].presetSnapshot.lines.clear[0], "改訂後の完走メッセージ");
  assert.equal(
    harness.firestore.read(`aiTextTrainingPresets/${firstPreset.id}`).reportCount,
    2,
  );
});

test("reports and quarantine republish checks preserve the full defeat-zone payload", async () => {
  const harness = createHarness({ balances: { seller: 30, reporter: 30 } });
  const zoneLines = validZoneLines();
  const title = "敗北ZONE通報確認台本";
  const preset = await publishPreset(harness, {
    productType: "defeat_zone",
    zoneLines,
    title,
  });
  await harness.service.performAction("reporter", {
    action: "report",
    presetId: preset.id,
    expectedRevision: 1,
    reason: "other",
  });
  const report = [...harness.firestore.documents.entries()]
    .find(([path]) => path.startsWith("aiTextTrainingReports/"))?.[1];
  assert.equal(report.presetSnapshot.productType, "defeat_zone");
  assert.deepEqual(report.presetSnapshot.zoneLines, zoneLines);

  const presetPath = `aiTextTrainingPresets/${preset.id}`;
  const quarantinedPreset = harness.firestore.read(presetPath);
  // Pre-existing products do not have this derived hash. Quarantine
  // recovery must remain compatible by deriving it from the stored script.
  delete quarantinedPreset.moderationPayloadHash;
  harness.firestore.write(presetPath, {
    ...quarantinedPreset,
    status: "hidden",
    moderationStatus: "quarantined",
  });
  await assert.rejects(
    harness.service.performAction("seller", {
      action: "save_profile",
      xPublic: true,
      xHandle: "seller_zone",
    }),
    (error) => error.code === "failed-precondition" && /安全確認中/.test(error.message),
  );
  await assert.rejects(
    harness.service.performAction("seller", publishInput(
      "zone_quarantine_same_1",
      {
        productType: "defeat_zone",
        zoneLines,
        title,
        baseRevision: 1,
        expectedBalance: harness.wallet("seller").balance,
      },
    )),
    (error) => error.code === "failed-precondition" && /台詞を見直して/.test(error.message),
  );
  const balanceBeforeMetadataEdit = harness.wallet("seller").balance;
  await assert.rejects(
    harness.service.performAction("seller", publishInput(
      "zone_quarantine_metadata_1",
      {
        productType: "defeat_zone",
        zoneLines,
        sellerName: "作者B",
        title: "名前だけ変えた敗北ZONE台本",
        description: "紹介文と価格だけを変更した、台詞内容が同じ敗北ZONE台本です。",
        price: 5,
        baseRevision: 1,
        expectedBalance: balanceBeforeMetadataEdit,
      },
    )),
    (error) => error.code === "failed-precondition" && /台詞を見直して/.test(error.message),
  );
  assert.equal(harness.wallet("seller").balance, balanceBeforeMetadataEdit);

  const revisedZoneLines = validZoneLines();
  revisedZoneLines.zone_cooldown[0] = "呼吸を整えて、ゆっくり休もう";
  const republished = await harness.service.performAction("seller", publishInput(
    "zone_quarantine_edit_1",
    {
      productType: "defeat_zone",
      zoneLines: revisedZoneLines,
      title,
      baseRevision: 1,
      expectedBalance: harness.wallet("seller").balance,
    },
  ));
  assert.equal(republished.preset.revision, 2);
  assert.deepEqual(republished.preset.zoneLines, revisedZoneLines);
});

test("three verified-buyer high-risk reports quarantine the revision and its X link", async () => {
  const harness = createHarness({
    balances: {
      seller: 30,
      buyer1: 20,
      buyer2: 20,
      buyer3: 20,
    },
  });
  const preset = await publishPreset(harness);
  await harness.service.performAction("seller", {
    action: "save_profile",
    xPublic: true,
    xHandle: "seller_x",
  });
  const buyers = ["buyer1", "buyer2", "buyer3"];
  for (const [index, buyer] of buyers.entries()) {
    await harness.service.performAction(buyer, {
      action: "start_paid_use",
      actionId: `use_action_quarantine_${index + 1}`,
      presetId: preset.id,
      expectedPrice: 10,
      expectedRevision: 1,
      expectedBalance: 20,
    });
  }
  const reports = [];
  for (const buyer of buyers) {
    reports.push(await harness.service.performAction(buyer, {
      action: "report",
      presetId: preset.id,
      expectedRevision: 1,
      reason: "dangerous",
    }));
  }
  assert.deepEqual(reports.map((report) => report.quarantined), [false, false, true]);
  assert.equal(
    harness.firestore.read(`aiTextTrainingPresets/${preset.id}`).status,
    "hidden",
  );
  assert.equal(
    harness.firestore.read(`aiTextTrainingPresets/${preset.id}`).moderationStatus,
    "quarantined",
  );
  assert.equal(
    harness.firestore.read("aiTextTrainingSellerProfiles/seller").xPublic,
    false,
  );
  await assert.rejects(
    harness.service.performAction("seller", {
      action: "save_profile",
      xPublic: true,
      xHandle: "seller_x",
    }),
    (error) => error.code === "failed-precondition" && /安全確認中/.test(error.message),
  );
  const balanceBeforeRejectedRepublish = harness.wallet("seller").balance;
  await assert.rejects(
    harness.service.performAction(
      "seller",
      publishInput("publish_action_unchanged_quarantine", {
        baseRevision: 1,
        expectedBalance: balanceBeforeRejectedRepublish,
      }),
    ),
    (error) => error.code === "failed-precondition" && /台詞を見直して/.test(error.message),
  );
  assert.equal(harness.wallet("seller").balance, balanceBeforeRejectedRepublish);

  const revisedLines = validLines();
  revisedLines.rest[0] = "安全を確認して改訂した休憩メッセージ";
  const republished = await harness.service.performAction(
    "seller",
    publishInput("publish_action_after_quarantine", {
      baseRevision: 1,
      expectedBalance: harness.wallet("seller").balance,
      lines: revisedLines,
    }),
  );
  assert.equal(republished.preset.revision, 2);
  await harness.service.performAction("seller", {
    action: "save_profile",
    xPublic: true,
    xHandle: "seller_x",
  });
  assert.equal(
    harness.firestore.read("aiTextTrainingSellerProfiles/seller").xPublic,
    true,
  );
});
