"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  AI_TEXT_TRAINING_SCRIPT_SLOT_IDS,
} = require("../ai-text-training");
const {
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
  constructor(firestore, path, filters = [], orders = [], maximum = Infinity) {
    this.firestore = firestore;
    this.path = path;
    this.filters = filters;
    this.orders = orders;
    this.maximum = maximum;
  }

  where(field, operator, value) {
    return new FakeQuery(
      this.firestore,
      this.path,
      [...this.filters, { field, operator, value }],
      this.orders,
      this.maximum,
    );
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      [...this.orders, { field, direction }],
      this.maximum,
    );
  }

  limit(maximum) {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      this.orders,
      maximum,
    );
  }

  async get() {
    const prefix = `${this.path}/`;
    let rows = [...this.firestore.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => ({
        reference: new FakeDocumentReference(this.firestore, path),
        value: clone(value),
      }));
    for (const filter of this.filters) {
      if (filter.operator !== "==") throw new Error(`Unsupported operator ${filter.operator}`);
      rows = rows.filter((row) => row.value?.[filter.field] === filter.value);
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
  const activeFirst = harness.firestore.read(
    "aiTextTrainingActiveAchievementSessions/player",
  );
  assert.equal(activeFirst.sessionId, first.session.id);
  assert.equal(activeFirst.expiresAt, now + sessionTtlMs);
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
  assert.equal(
    harness.firestore.read("aiTextTrainingActiveAchievementSessions/player"),
    undefined,
  );

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
  assert.equal(harness.achievementSyncs.length, 2);
  assert.equal(harness.achievementSyncs[1].uid, "player");
  assert.deepEqual(
    harness.achievementSyncs[1].profile,
    harness.firestore.read("achievementProfiles/player"),
  );
});

test("safety stop is terminal, clears the active pointer, and never counts as completion", async () => {
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
