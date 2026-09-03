"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createRouletteTrainingService,
} = require("../roulette-training-service");

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
    this.value = clone(value);
  }

  data() {
    return clone(this.value);
  }

  get(field) {
    return clone(this.value?.[field]);
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
    return this.firestore.snapshot(this);
  }
}

class FakeQuery {
  constructor(firestore, path, filters = [], orderings = [], maximum = Infinity) {
    this.firestore = firestore;
    this.path = path;
    this.filters = filters;
    this.orderings = orderings;
    this.maximum = maximum;
  }

  where(field, operator, value) {
    assert.equal(operator, "==");
    return new FakeQuery(
      this.firestore,
      this.path,
      [...this.filters, { field, value }],
      this.orderings,
      this.maximum,
    );
  }

  orderBy(field, direction = "asc") {
    assert.ok(["asc", "desc"].includes(direction));
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      [...this.orderings, { field, direction }],
      this.maximum,
    );
  }

  limit(maximum) {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      this.orderings,
      maximum,
    );
  }

  async get() {
    const prefix = `${this.path}/`;
    let rows = [...this.firestore.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => ({
        reference: new FakeDocumentReference(this.firestore, path),
        value,
      }));
    for (const filter of this.filters) {
      rows = rows.filter((row) => row.value?.[filter.field] === filter.value);
    }
    for (const ordering of [...this.orderings].reverse()) {
      rows.sort((left, right) => {
        const leftValue = left.value?.[ordering.field];
        const rightValue = right.value?.[ordering.field];
        const compared = leftValue === rightValue ? 0 : (leftValue < rightValue ? -1 : 1);
        return ordering.direction === "desc" ? -compared : compared;
      });
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
    return new FakeDocumentSnapshot(reference, this.documents.get(reference.path));
  }

  create(reference, value) {
    if (this.documents.has(reference.path)) {
      throw new Error(`Document already exists: ${reference.path}`);
    }
    this.documents.set(reference.path, clone(value));
  }

  set(reference, value, options = {}) {
    const next = options?.merge && this.documents.has(reference.path)
      ? { ...clone(this.documents.get(reference.path)), ...clone(value) }
      : clone(value);
    this.documents.set(reference.path, next);
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

  snapshot(reference) {
    return new FakeDocumentSnapshot(reference, this.documents.get(reference.path));
  }

  read(path) {
    return clone(this.documents.get(path));
  }

  write(path, value) {
    this.documents.set(path, clone(value));
  }

  keys(prefix) {
    return [...this.documents.keys()].filter((path) => path.startsWith(prefix));
  }
}

function stableId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function publishInput(actionId, expectedBalance, overrides = {}) {
  return {
    action: "publish",
    actionId,
    expectedBalance,
    baseRevision: 0,
    sellerName: "作者A",
    title: "朝の元気トレーニング",
    description: "自分の体調に合わせて無理なく楽しむメニューです。",
    price: 10,
    items: [{
      menuText: "スクワット10回",
      detailText: "足を肩幅に開いて無理のない深さで動きます。",
      countUnit: "reps",
      cheerLines: ["いい調子、そのペースです。"],
    }],
    ...overrides,
  };
}

function createHarness({ balances = {}, now = 1_800_000_000_000 } = {}) {
  const firestore = new FakeFirestore();
  const mirrors = [];
  let clock = now;
  for (const [uid, balance] of Object.entries(balances)) {
    firestore.write(`wallets/${uid}`, { balance, maxBalance: 1_000 });
  }
  firestore.write("settings/ledger", { enabled: true });
  const walletReference = (uid) => firestore.collection("wallets").doc(uid);
  const service = createRouletteTrainingService({
    firestore,
    HttpsError: FakeHttpsError,
    async ensureWallet(uid) {
      if (!firestore.read(`wallets/${uid}`)) {
        firestore.write(`wallets/${uid}`, { balance: 0, maxBalance: 1_000 });
      }
      return firestore.read(`wallets/${uid}`).balance;
    },
    walletRef: walletReference,
    anjuPayLedgerConfigRef: () => firestore.collection("settings").doc("ledger"),
    walletData(snapshot) {
      const value = snapshot.data();
      if (!snapshot.exists) throw new FakeHttpsError("failed-precondition", "wallet missing");
      return { ...value };
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
    now: () => clock,
  });
  return {
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

async function publishPack(harness, overrides = {}) {
  const result = await harness.service.performAction("seller", publishInput(
    overrides.actionId || "publish_action_0001",
    harness.wallet("seller").balance,
    overrides,
  ));
  return result;
}

async function startUse(harness, uid, pack, suffix) {
  return harness.service.performAction(uid, {
    action: "start_paid_use",
    actionId: `start_paid_use_${suffix}`,
    packId: pack.id,
    expectedRevision: pack.revision,
    expectedPrice: pack.price,
    expectedBalance: harness.wallet(uid).balance,
  });
}

test("publish charges once, exposes full preview, and preserves positional item IDs on revision", async () => {
  const harness = createHarness({ balances: { seller: 30 } });
  const first = await publishPack(harness);
  assert.equal(first.balance, 29);
  assert.equal(first.pack.items[0].id, "item-01");
  assert.equal(first.pack.items[0].itemId, "item-01");
  assert.equal(first.pack.items[0].menuText, "スクワット10回");
  assert.match(first.pack.items[0].detailText, /足を肩幅/);

  const retry = await harness.service.performAction("seller", publishInput(
    "publish_action_0001",
    30,
  ));
  assert.equal(retry.idempotent, true);
  assert.equal(harness.wallet("seller").balance, 29);

  const second = await publishPack(harness, {
    actionId: "publish_action_0002",
    packId: first.pack.id,
    baseRevision: 1,
    items: [
      {
        menuText: "ワイドスクワット12回",
        detailText: "つま先と膝の向きをそろえます。",
        countUnit: "reps",
        cheerLines: ["落ち着いて進めています。"],
      },
      {
        menuText: "その場ウォーク",
        detailText: "安全な場所で行います。",
        countUnit: "seconds",
        cheerLines: ["リズムよくいきましょう。"],
      },
    ],
  });
  assert.equal(second.balance, 28);
  assert.equal(second.pack.revision, 2);
  assert.equal(second.pack.items[0].id, "item-01");
  assert.equal(second.pack.items[0].itemId, "item-01");
  assert.equal(second.pack.items[1].id, "item-02");
  const browse = await harness.service.performAction("buyer", { action: "browse" });
  assert.deepEqual(browse.packs[0].items, second.pack.items);
});

test("published emoji cheer lines keep the same Unicode length boundary in service responses", async () => {
  const harness = createHarness({ balances: { seller: 5 } });
  const emojiCheer = "😀".repeat(31);
  const { pack } = await publishPack(harness, {
    actionId: "publish_emoji_cheer_0001",
    items: [{
      ...publishInput("unused_action_0001", 5).items[0],
      cheerLines: [emojiCheer],
    }],
  });
  assert.equal(pack.items[0].cheerLines[0], emojiCheer);
  const browse = await harness.service.performAction("buyer", { action: "browse" });
  assert.equal(browse.packs[0].items[0].cheerLines[0], emojiCheer);
});

test("seller pack ownership is capped at fifty while existing packs remain revisable", async () => {
  const harness = createHarness({ balances: { seller: 30 } });
  harness.firestore.write("rouletteTrainingSellerStats/seller", { packCount: 49 });
  const fiftieth = await publishPack(harness, {
    actionId: "publish_pack_limit_0050",
  });
  assert.equal(
    harness.firestore.read("rouletteTrainingSellerStats/seller").packCount,
    50,
  );
  assert.equal(fiftieth.pack.revision, 1);
  const balanceAtLimit = harness.wallet("seller").balance;

  await assert.rejects(
    publishPack(harness, {
      actionId: "publish_pack_limit_0051",
      title: "上限を超える新規パック",
    }),
    (error) => error.code === "resource-exhausted" && /50件/u.test(error.message),
  );
  assert.equal(harness.wallet("seller").balance, balanceAtLimit);

  const revised = await publishPack(harness, {
    actionId: "publish_pack_limit_revision",
    packId: fiftieth.pack.id,
    baseRevision: fiftieth.pack.revision,
    title: "上限到達後の既存パック改訂",
  });
  assert.equal(revised.pack.revision, 2);
  assert.equal(
    harness.firestore.read("rouletteTrainingSellerStats/seller").packCount,
    50,
  );
  const state = await harness.service.performAction("seller", { action: "state" });
  assert.equal(state.policy.maximumPacksPerSeller, 50);
});

test("market and owner lists use the documented server order and moderation boundary", async () => {
  const harness = createHarness({ balances: { seller: 30 } });
  const low = await publishPack(harness, { actionId: "publish_order_low_0001" });
  const highOld = await publishPack(harness, {
    actionId: "publish_order_high_old",
    title: "利用数優先パック",
  });
  const highNew = await publishPack(harness, {
    actionId: "publish_order_high_new",
    title: "同数で更新が新しいパック",
  });
  const hiddenByModeration = await publishPack(harness, {
    actionId: "publish_order_pending_01",
    title: "モデレーション対象外パック",
  });
  const changes = [
    [low.pack.id, { paidUseCount: 1, updatedAt: 100 }],
    [highOld.pack.id, { paidUseCount: 5, updatedAt: 200 }],
    [highNew.pack.id, { paidUseCount: 5, updatedAt: 300 }],
    [hiddenByModeration.pack.id, {
      paidUseCount: 999,
      updatedAt: 400,
      moderationStatus: "quarantined",
    }],
  ];
  for (const [packId, patch] of changes) {
    const path = `rouletteTrainingPacks/${packId}`;
    harness.firestore.write(path, { ...harness.firestore.read(path), ...patch });
  }

  const browse = await harness.service.performAction("buyer", { action: "browse" });
  assert.deepEqual(
    browse.packs.map((pack) => pack.id),
    [highNew.pack.id, highOld.pack.id, low.pack.id],
  );
  const state = await harness.service.performAction("seller", { action: "state" });
  assert.deepEqual(
    state.ownPacks.map((pack) => pack.id),
    [hiddenByModeration.pack.id, highNew.pack.id, highOld.pack.id, low.pack.id],
  );
});

test("one paid session is atomic, reload-resumable, idempotent, and stores no workout result", async () => {
  const harness = createHarness({ balances: { seller: 5, buyer: 20 } });
  const { pack } = await publishPack(harness);
  const started = await startUse(harness, "buyer", pack, "buyer_0001");
  assert.equal(started.charged, true);
  assert.equal(started.use.price, 10);
  assert.equal(started.use.fee, 2);
  assert.equal(started.use.sellerProceeds, 8);
  assert.equal(harness.wallet("buyer").balance, 10);
  assert.equal(harness.wallet("seller").balance, 12);
  assert.deepEqual(started.use.pack.items, pack.items);

  const retry = await startUse(harness, "buyer", pack, "buyer_0001");
  assert.equal(retry.idempotent, true);
  assert.equal(harness.wallet("buyer").balance, 10);
  assert.equal(harness.wallet("seller").balance, 12);
  const state = await harness.service.performAction("buyer", { action: "state" });
  assert.equal(state.activeUse.id, started.use.id);
  assert.deepEqual(state.activeUse.pack.items, pack.items);

  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "finish_use",
      useId: started.use.id,
      outcome: "completed",
    }),
    (error) => error.code === "invalid-argument",
  );
  const finished = await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: started.use.id,
  });
  assert.equal(finished.use.status, "finished");
  const stored = harness.firestore.read(`rouletteTrainingUses/${started.use.id}`);
  for (const field of [
    "outcome",
    "completed",
    "clear",
    "giveUp",
    "images",
    "bpm",
    "rouletteResult",
    "countResult",
  ]) {
    assert.equal(Object.hasOwn(stored, field), false, `must not store ${field}`);
  }
  assert.equal(harness.firestore.read("rouletteTrainingActiveUses/buyer"), undefined);
  const finishedState = await harness.service.performAction("buyer", { action: "state" });
  assert.equal(finishedState.activeUse, null);
  assert.equal(finishedState.purchasedRevisions.length, 1);
  assert.equal(finishedState.purchasedRevisions[0].id, started.use.id);
  assert.equal(finishedState.purchasedRevisions[0].status, "finished");
  assert.equal(finishedState.purchasedRevisions[0].charged, true);
  assert.deepEqual(finishedState.purchasedRevisions[0].pack.items, pack.items);
  assert.doesNotMatch(
    JSON.stringify(finishedState.purchasedRevisions),
    /sellerUid|buyerUid|reporterUid|actionId|payloadHash/,
  );

  const secondSession = await startUse(harness, "buyer", pack, "buyer_0002");
  assert.equal(secondSession.use.rankingCounted, false);
  const stats = harness.firestore.read("rouletteTrainingSellerStats/seller");
  assert.equal(stats.useCount, 2);
  assert.equal(stats.actualGross, 20);
  assert.equal(stats.rankingUseCount, 1);
  assert.equal(stats.rankingGross, 10);
  assert.equal(stats.uniqueBuyers, 1);
  assert.equal(stats.netSales, 16);
  assert.equal(stats.feesPaid, 4);
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(1_800_000_000_000));
  const monthly = harness.firestore.read(
    `rouletteTrainingMonthlyPeriods/${month}/entries/seller`,
  );
  assert.equal(monthly.useCount, 2);
  assert.equal(monthly.rankingUseCount, 1);
  assert.equal(monthly.uniqueBuyers, 1);
  assert.equal(harness.firestore.keys("rouletteTrainingRankingPairs/").length, 1);
  assert.equal(harness.firestore.keys("rouletteTrainingSellerBuyerPairs/").length, 1);
  assert.equal(harness.firestore.keys("rouletteTrainingMonthlyBuyerPairs/").length, 1);
});

test("finished paid revision history stays reportable after author revision and unpublish", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 40 } });
  const first = await publishPack(harness);
  const firstUse = await startUse(harness, "buyer", first.pack, "history_v1_0001");
  harness.setNow(1_800_000_010_000);
  await harness.service.performAction("buyer", {
    action: "finish_use",
    useId: firstUse.use.id,
  });

  const second = await publishPack(harness, {
    actionId: "publish_history_v2_0001",
    packId: first.pack.id,
    baseRevision: first.pack.revision,
    title: "改訂後の夜トレーニング",
    items: [{
      menuText: "その場でゆっくり足踏み",
      detailText: "周囲の安全を確認して行います。",
      countUnit: "seconds",
      cheerLines: ["無理のない速さで進めましょう。"],
    }],
  });
  await harness.service.performAction("seller", {
    action: "unpublish",
    packId: second.pack.id,
  });

  const buyerState = await harness.service.performAction("buyer", { action: "state" });
  assert.equal(buyerState.packs.length, 0);
  assert.equal(buyerState.purchasedRevisions.length, 1);
  const historicalUse = buyerState.purchasedRevisions[0];
  assert.equal(historicalUse.pack.id, first.pack.id);
  assert.equal(historicalUse.pack.revision, first.pack.revision);
  assert.equal(historicalUse.pack.title, first.pack.title);
  assert.deepEqual(historicalUse.pack.items, first.pack.items);
  assert.notEqual(historicalUse.pack.title, second.pack.title);

  const reported = await harness.service.performAction("buyer", {
    action: "report",
    packId: historicalUse.pack.id,
    expectedRevision: historicalUse.pack.revision,
    reason: "other",
  });
  assert.equal(reported.accepted, true);
});

test("finished paid revision history deduplicates repeated uses and excludes self previews", async () => {
  const harness = createHarness({ balances: { seller: 20, buyer: 40 } });
  const { pack } = await publishPack(harness);
  const preview = await startUse(harness, "seller", pack, "history_self_0001");
  await harness.service.performAction("seller", {
    action: "finish_use",
    useId: preview.use.id,
  });
  const paidUses = [];
  for (const suffix of ["history_paid_0001", "history_paid_0002"]) {
    harness.setNow(1_800_000_020_000 + suffix.length);
    const started = await startUse(harness, "buyer", pack, suffix);
    paidUses.push(started.use);
    await harness.service.performAction("buyer", {
      action: "finish_use",
      useId: started.use.id,
    });
  }
  const sellerState = await harness.service.performAction("seller", { action: "state" });
  assert.deepEqual(sellerState.purchasedRevisions, []);
  const buyerState = await harness.service.performAction("buyer", { action: "state" });
  assert.equal(buyerState.purchasedRevisions.length, 1);
  assert.equal(buyerState.purchasedRevisions[0].pack.revision, pack.revision);
  assert.equal(buyerState.purchasedRevisions[0].id, paidUses.at(-1).id);
  const proofKeys = harness.firestore.keys("rouletteTrainingPackRevisionBuyers/");
  assert.equal(proofKeys.length, 1);
  const proof = harness.firestore.read(proofKeys[0]);
  assert.equal(proof.firstUseId, paidUses[0].id);
  assert.equal(proof.lastUseId, paidUses.at(-1).id);
  assert.deepEqual(proof.packSnapshot.items, pack.items);
});

test("author self preview creates a resumable session without payment or buyer proof", async () => {
  const harness = createHarness({ balances: { seller: 10 } });
  const { pack } = await publishPack(harness);
  assert.equal(harness.wallet("seller").balance, 9);
  const preview = await startUse(harness, "seller", pack, "seller_0001");
  assert.equal(preview.charged, false);
  assert.equal(preview.use.price, 0);
  assert.equal(harness.wallet("seller").balance, 9);
  assert.equal(
    harness.firestore.keys("rouletteTrainingPackRevisionBuyers/").length,
    0,
  );
  const resumed = await harness.service.performAction("seller", {
    action: "resume_use",
    useId: preview.use.id,
  });
  assert.equal(resumed.use.id, preview.use.id);
});

test("three distinct verified high-risk buyer reports quarantine the exact current revision", async () => {
  const harness = createHarness({
    balances: { seller: 10, buyer1: 20, buyer2: 20, buyer3: 20 },
  });
  const { pack } = await publishPack(harness);
  for (const uid of ["buyer1", "buyer2", "buyer3"]) {
    const started = await startUse(harness, uid, pack, `${uid}_0001`);
    await harness.service.performAction(uid, {
      action: "finish_use",
      useId: started.use.id,
    });
    const reported = await harness.service.performAction(uid, {
      action: "report",
      packId: pack.id,
      expectedRevision: pack.revision,
      reason: "dangerous_exercise",
    });
    assert.equal(reported.quarantined, uid === "buyer3");
  }
  const stored = harness.firestore.read(`rouletteTrainingPacks/${pack.id}`);
  assert.equal(stored.status, "hidden");
  assert.equal(stored.moderationStatus, "quarantined");
  const browse = await harness.service.performAction("buyer1", { action: "browse" });
  assert.equal(browse.packs.length, 0);
});

test("three distinct verified harassment reports also quarantine the exact current revision", async () => {
  const harness = createHarness({
    balances: { seller: 10, buyer1: 20, buyer2: 20, buyer3: 20 },
  });
  const { pack } = await publishPack(harness);
  for (const uid of ["buyer1", "buyer2", "buyer3"]) {
    const started = await startUse(harness, uid, pack, `${uid}_harassment`);
    await harness.service.performAction(uid, {
      action: "finish_use",
      useId: started.use.id,
    });
    const reported = await harness.service.performAction(uid, {
      action: "report",
      packId: pack.id,
      expectedRevision: pack.revision,
      reason: "harassment",
    });
    assert.equal(reported.quarantined, uid === "buyer3");
  }
  const stored = harness.firestore.read(`rouletteTrainingPacks/${pack.id}`);
  assert.equal(stored.status, "hidden");
  assert.equal(stored.moderationStatus, "quarantined");
});

test("quarantine cannot be cleared by changing only a non-text count unit", async () => {
  const harness = createHarness({
    balances: { seller: 20, buyer1: 20, buyer2: 20, buyer3: 20 },
  });
  const { pack } = await publishPack(harness);
  for (const uid of ["buyer1", "buyer2", "buyer3"]) {
    const started = await startUse(harness, uid, pack, `${uid}_quarantine`);
    await harness.service.performAction(uid, {
      action: "finish_use",
      useId: started.use.id,
    });
    await harness.service.performAction(uid, {
      action: "report",
      packId: pack.id,
      expectedRevision: pack.revision,
      reason: "dangerous_exercise",
    });
  }

  const unchangedTextItem = {
    menuText: pack.items[0].menuText,
    detailText: pack.items[0].detailText,
    countUnit: "seconds",
    cheerLines: [...pack.items[0].cheerLines],
  };
  const balanceBeforeRetry = harness.wallet("seller").balance;
  await assert.rejects(
    publishPack(harness, {
      actionId: "publish_quarantine_unit_01",
      packId: pack.id,
      baseRevision: pack.revision,
      items: [unchangedTextItem],
    }),
    (error) => error.code === "failed-precondition",
  );
  assert.equal(harness.wallet("seller").balance, balanceBeforeRetry);

  const revised = await publishPack(harness, {
    actionId: "publish_quarantine_text_01",
    packId: pack.id,
    baseRevision: pack.revision,
    items: [{
      ...unchangedTextItem,
      detailText: `${unchangedTextItem.detailText} 途中で休憩できます。`,
    }],
  });
  assert.equal(revised.pack.revision, pack.revision + 1);
  assert.equal(revised.pack.moderationStatus, "clear");
});

test("paid use strictly rejects device-local fields and a second active session", async () => {
  const harness = createHarness({ balances: { seller: 10, buyer: 30 } });
  const first = await publishPack(harness);
  const second = await publishPack(harness, {
    actionId: "publish_action_0002",
    title: "夜のやさしいトレーニング",
  });
  await startUse(harness, "buyer", first.pack, "buyer_0001");
  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "start_paid_use",
      actionId: "start_paid_use_bad_01",
      packId: second.pack.id,
      expectedRevision: second.pack.revision,
      expectedPrice: second.pack.price,
      expectedBalance: harness.wallet("buyer").balance,
      bpm: 180,
    }),
    (error) => error.code === "invalid-argument",
  );
  await assert.rejects(
    startUse(harness, "buyer", second.pack, "buyer_0002"),
    (error) => error.code === "failed-precondition",
  );
});
