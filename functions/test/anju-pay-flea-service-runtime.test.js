"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { createAnjuPayFleaService } = require("../anju-pay-flea-service");
const { fleaPublicSellerId } = require("../anju-pay-flea");

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
    return this.firestore._snapshot(this, this.firestore._documents);
  }
}

class FakeQuery {
  constructor(firestore, path, filters = [], orders = [], maximum = Infinity, cursor = null) {
    this.firestore = firestore;
    this.path = path;
    this.filters = filters;
    this.orders = orders;
    this.maximum = maximum;
    this.cursor = cursor;
  }

  where(field, operator, value) {
    return new FakeQuery(
      this.firestore,
      this.path,
      [...this.filters, { field, operator, value }],
      this.orders,
      this.maximum,
      this.cursor,
    );
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      [...this.orders, { field, direction }],
      this.maximum,
      this.cursor,
    );
  }

  limit(maximum) {
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      this.orders,
      maximum,
      this.cursor,
    );
  }

  startAfter(snapshot) {
    if (!(snapshot instanceof FakeDocumentSnapshot) || !snapshot.exists) {
      throw new Error("Fake Firestore requires an existing snapshot cursor.");
    }
    return new FakeQuery(
      this.firestore,
      this.path,
      this.filters,
      this.orders,
      this.maximum,
      snapshot,
    );
  }

  async get() {
    const prefix = `${this.path}/`;
    let values = [...this.firestore._documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => ({
        reference: new FakeDocumentReference(this.firestore, path),
        value: clone(value),
      }));
    for (const { field, operator, value } of this.filters) {
      values = values.filter((entry) => {
        const actual = entry.value?.[field];
        if (operator === "==") return actual === value;
        if (operator === "<=") return actual <= value;
        throw new Error(`Unsupported fake Firestore operator: ${operator}`);
      });
    }
    const compareEntries = (left, right) => {
      for (const { field, direction } of this.orders) {
        const leftValue = left.value?.[field];
        const rightValue = right.value?.[field];
        if (leftValue === rightValue) continue;
        const comparison = leftValue < rightValue ? -1 : 1;
        return direction === "desc" ? -comparison : comparison;
      }
      return left.reference.id.localeCompare(right.reference.id);
    };
    values.sort(compareEntries);
    if (this.cursor) {
      const cursorEntry = {
        reference: this.cursor.ref,
        value: this.cursor.data(),
      };
      values = values.filter((entry) => compareEntries(entry, cursorEntry) > 0);
    }
    return {
      docs: values.slice(0, this.maximum).map(({ reference, value }) => (
        new FakeDocumentSnapshot(reference, value)
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
    return this.firestore._snapshot(reference, this.documents);
  }

  create(reference, value) {
    if (this.documents.has(reference.path)) {
      throw new Error(`Document already exists: ${reference.path}`);
    }
    this.documents.set(reference.path, clone(value));
  }

  set(reference, value, options = {}) {
    const current = this.documents.get(reference.path);
    const next = options.merge && current !== undefined
      ? { ...clone(current), ...clone(value) }
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
    this._documents = new Map();
    this._transactionHooks = [];
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  beforeNextTransaction(hook) {
    this._transactionHooks.push(hook);
  }

  async runTransaction(callback) {
    const hook = this._transactionHooks.shift();
    if (hook) await hook();
    const working = new Map(
      [...this._documents.entries()].map(([path, value]) => [path, clone(value)]),
    );
    const result = await callback(new FakeTransaction(this, working));
    this._documents = working;
    return result;
  }

  _snapshot(reference, documents) {
    return new FakeDocumentSnapshot(reference, documents.get(reference.path));
  }

  read(path) {
    return clone(this._documents.get(path));
  }

  write(path, value) {
    this._documents.set(path, clone(value));
  }

  count(prefix) {
    return [...this._documents.keys()].filter((path) => path.startsWith(prefix)).length;
  }
}

class FakeRealtime {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values).map(([path, value]) => [path, clone(value)]));
  }

  ref(path) {
    return {
      get: async () => ({
        val: () => clone(this.values.get(path)),
      }),
    };
  }
}

function stableId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function createHarness({
  balances = {},
  creatorCards = {},
  initialNow = Date.parse("2026-07-25T03:00:00.000Z"),
} = {}) {
  const firestore = new FakeFirestore();
  const realtimeValues = {};
  const mirrors = [];
  let clock = initialNow;
  const queuedClockReadings = [];

  for (const [uid, balance] of Object.entries(balances)) {
    firestore.write(`wallets/${uid}`, {
      balance,
      maxBalance: 100_000,
    });
  }
  firestore.write("settings/ledger", { schemaVersion: 1 });

  for (const [uid, card] of Object.entries(creatorCards)) {
    const entryId = `creator_card_${stableId(uid).slice(0, 16)}`;
    realtimeValues[`online/topMessageEntriesByUser/${uid}`] = entryId;
    realtimeValues[`online/topMessageOwners/${entryId}`] = uid;
    realtimeValues[`online/topMessages/${entryId}`] = {
      schemaVersion: 2,
      name: card.name,
      titleId: "",
      text: card.text || "",
      creatorType: "",
      cardTheme: "",
      growthLevel: 1,
      achievementShowcase: "",
      xHandle: card.xHandle,
    };
  }

  const realtime = new FakeRealtime(realtimeValues);
  const walletReference = (uid) => firestore.collection("wallets").doc(uid);
  const ensureWallet = async (uid) => {
    const path = `wallets/${uid}`;
    let wallet = firestore.read(path);
    if (!wallet) {
      wallet = { balance: balances[uid] ?? 0, maxBalance: 100_000 };
      firestore.write(path, wallet);
    }
    return wallet.balance;
  };
  const walletData = (snapshot) => {
    const source = snapshot.data() || {};
    return {
      ...source,
      balance: Number.isSafeInteger(source.balance) ? source.balance : 0,
      maxBalance: Number.isSafeInteger(source.maxBalance) ? source.maxBalance : 100_000,
    };
  };
  const service = createAnjuPayFleaService({
    firestore,
    realtime,
    HttpsError: FakeHttpsError,
    ensureWallet,
    walletRef: walletReference,
    anjuPayLedgerConfigRef: () => firestore.collection("settings").doc("ledger"),
    walletData,
    walletCreditCapacity: (wallet) => wallet.maxBalance - wallet.balance,
    debitPoints(wallet, amount) {
      if (wallet.balance < amount) {
        throw new FakeHttpsError("failed-precondition", "AnjuPayが不足しています。");
      }
      wallet.balance -= amount;
    },
    creditPoints(wallet, amount) {
      if (wallet.balance + amount > wallet.maxBalance) {
        throw new FakeHttpsError("failed-precondition", "AnjuPay残高の上限を超えます。");
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
    bestEffort: async (_label, promises) => {
      await Promise.allSettled(promises);
    },
    now: () => queuedClockReadings.shift() ?? clock,
  });

  return {
    firestore,
    mirrors,
    service,
    setNow(value) {
      clock = value;
    },
    queueNow(...values) {
      queuedClockReadings.push(...values);
    },
    crossAtNextTransaction(value) {
      firestore.beforeNextTransaction(() => {
        clock = value;
      });
    },
    wallet(uid) {
      return firestore.read(`wallets/${uid}`);
    },
    walletLedger(uid) {
      const prefix = `wallets/${uid}/ledger/`;
      return [...firestore._documents.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([, value]) => clone(value));
    },
  };
}

function listingInput(overrides = {}) {
  return {
    action: "create_listing",
    name: "SELLER",
    category: "illustration",
    title: "今日の色を描いた一枚",
    description: "やわらかな色合いで、今日の穏やかな気分を表したイラストです。",
    price: 25,
    xPostUrl: "",
    xConsent: false,
    ...overrides,
  };
}

function hasCode(code) {
  return (error) => error instanceof FakeHttpsError && error.code === code;
}

function containsPrivateIdentity(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => (
    ["sellerUid", "buyerUid", "reporterUid", "xHandle"].includes(key)
    || containsPrivateIdentity(nested)
  ));
}

test("create charges one Pay once, replays identical payload, and rejects a changed payload", async () => {
  const harness = createHarness({ balances: { seller: 100 } });

  const first = await harness.service.performAction("seller", listingInput());
  const listingId = first.createdListing.id;
  assert.equal(first.balance, 99);
  assert.equal(harness.wallet("seller").balance, 99);
  assert.equal(harness.walletLedger("seller").length, 1);
  assert.equal(harness.walletLedger("seller")[0].kind, "flea_listing_fee");
  assert.equal(harness.firestore.count("anjuPayFleaListings/"), 1);

  const replay = await harness.service.performAction("seller", listingInput());
  assert.equal(replay.createdListing.id, listingId);
  assert.equal(replay.balance, 99);
  assert.equal(harness.wallet("seller").balance, 99);
  assert.equal(harness.walletLedger("seller").length, 1);

  await assert.rejects(
    harness.service.performAction("seller", listingInput({ title: "別の一枚" })),
    hasCode("already-exists"),
  );
  assert.equal(harness.wallet("seller").balance, 99);
  assert.equal(harness.walletLedger("seller").length, 1);
  assert.equal(harness.firestore.count("anjuPayFleaListings/"), 1);
});

test("25 Pay sale is atomic, credits 23 Pay, sinks 2 Pay, and is purchase-idempotent", async () => {
  const harness = createHarness({
    balances: { seller: 100, buyer: 100, otherBuyer: 100 },
  });
  const created = await harness.service.performAction("seller", listingInput());
  const listingId = created.createdListing.id;

  const bought = await harness.service.performAction("buyer", {
    action: "buy",
    listingId,
    buyerName: "BUYER",
  });
  assert.equal(bought.purchase.price, 25);
  assert.equal(bought.purchase.feeAmount, 2);
  assert.equal(bought.purchase.sellerProceeds, 23);
  assert.equal(harness.wallet("buyer").balance, 75);
  assert.equal(harness.wallet("seller").balance, 122);
  assert.equal(25 - bought.purchase.sellerProceeds, bought.purchase.feeAmount);
  assert.equal(harness.firestore.count("anjuPayFleaSales/"), 1);
  assert.equal(harness.firestore.count("anjuPayFleaReceipts/"), 2);
  assert.equal(harness.walletLedger("buyer").length, 1);
  assert.equal(harness.walletLedger("seller").length, 2);

  const replay = await harness.service.performAction("buyer", {
    action: "buy",
    listingId,
    buyerName: "BUYER",
  });
  assert.equal(replay.purchase.id, listingId);
  assert.equal(harness.wallet("buyer").balance, 75);
  assert.equal(harness.wallet("seller").balance, 122);
  assert.equal(harness.firestore.count("anjuPayFleaSales/"), 1);
  assert.equal(harness.firestore.count("anjuPayFleaReceipts/"), 2);
  assert.equal(harness.walletLedger("buyer").length, 1);
  assert.equal(harness.walletLedger("seller").length, 2);

  await assert.rejects(
    harness.service.performAction("otherBuyer", {
      action: "buy",
      listingId,
      buyerName: "OTHER",
    }),
    hasCode("failed-precondition"),
  );
  assert.equal(harness.wallet("otherBuyer").balance, 100);
  assert.equal(harness.wallet("seller").balance, 122);
});

test("insufficient buyer balance rolls back every sale-side write", async () => {
  const harness = createHarness({ balances: { seller: 100, buyer: 20 } });
  const created = await harness.service.performAction("seller", listingInput());
  const listingId = created.createdListing.id;

  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "buy",
      listingId,
      buyerName: "BUYER",
    }),
    hasCode("failed-precondition"),
  );

  assert.equal(harness.wallet("buyer").balance, 20);
  assert.equal(harness.wallet("seller").balance, 99);
  assert.equal(harness.walletLedger("buyer").length, 0);
  assert.equal(harness.walletLedger("seller").length, 1);
  assert.equal(harness.firestore.count("anjuPayFleaSales/"), 0);
  assert.equal(harness.firestore.count("anjuPayFleaReceipts/"), 0);
  assert.equal(
    harness.firestore.read(`anjuPayFleaListings/${listingId}`).status,
    "active",
  );
});

test("a transaction attempt crossing JST midnight rejects both creation and purchase", async () => {
  const beforeMidnight = Date.parse("2026-07-25T14:59:59.900Z");
  const atMidnight = Date.parse("2026-07-25T15:00:00.000Z");

  const createHarnessAtBoundary = createHarness({
    balances: { seller: 100 },
    initialNow: beforeMidnight,
  });
  createHarnessAtBoundary.crossAtNextTransaction(atMidnight);
  await assert.rejects(
    createHarnessAtBoundary.service.performAction("seller", listingInput()),
    hasCode("aborted"),
  );
  assert.equal(createHarnessAtBoundary.wallet("seller").balance, 100);
  assert.equal(createHarnessAtBoundary.walletLedger("seller").length, 0);
  assert.equal(createHarnessAtBoundary.firestore.count("anjuPayFleaListings/"), 0);

  const purchaseHarnessAtBoundary = createHarness({
    balances: { seller: 100, buyer: 100 },
    initialNow: beforeMidnight - 60_000,
  });
  const created = await purchaseHarnessAtBoundary.service.performAction(
    "seller",
    listingInput(),
  );
  const listingId = created.createdListing.id;
  purchaseHarnessAtBoundary.setNow(beforeMidnight);
  purchaseHarnessAtBoundary.crossAtNextTransaction(atMidnight);
  await assert.rejects(
    purchaseHarnessAtBoundary.service.performAction("buyer", {
      action: "buy",
      listingId,
      buyerName: "BUYER",
    }),
    hasCode("failed-precondition"),
  );
  assert.equal(purchaseHarnessAtBoundary.wallet("buyer").balance, 100);
  assert.equal(purchaseHarnessAtBoundary.wallet("seller").balance, 99);
  assert.equal(purchaseHarnessAtBoundary.firestore.count("anjuPayFleaSales/"), 0);
  assert.equal(purchaseHarnessAtBoundary.firestore.count("anjuPayFleaReceipts/"), 0);
});

test("self purchase, self favorite, and self report are all rejected without side effects", async () => {
  const harness = createHarness({ balances: { seller: 100 } });
  const created = await harness.service.performAction("seller", listingInput());
  const listingId = created.createdListing.id;

  await assert.rejects(
    harness.service.performAction("seller", {
      action: "buy",
      listingId,
      buyerName: "SELLER",
    }),
    hasCode("failed-precondition"),
  );
  await assert.rejects(
    harness.service.performAction("seller", {
      action: "set_favorite",
      listingId,
      favorite: true,
    }),
    hasCode("failed-precondition"),
  );
  await assert.rejects(
    harness.service.performAction("seller", {
      action: "report",
      listingId,
      reason: "other",
    }),
    hasCode("failed-precondition"),
  );

  assert.equal(harness.wallet("seller").balance, 99);
  assert.equal(harness.firestore.count("anjuPayFleaSales/"), 0);
  assert.equal(harness.firestore.count("anjuPayFleaFavorites/"), 0);
  assert.equal(harness.firestore.count("anjuPayFleaReports/"), 0);
});

test("unsafe seller identity text is rejected before any fee or listing write", async () => {
  const unsafeNameHarness = createHarness({ balances: { seller: 100 } });
  await assert.rejects(
    unsafeNameHarness.service.performAction("seller", listingInput({
      name: "@another_account",
    })),
    hasCode("invalid-argument"),
  );
  assert.equal(unsafeNameHarness.wallet("seller").balance, 100);
  assert.equal(unsafeNameHarness.walletLedger("seller").length, 0);
  assert.equal(unsafeNameHarness.firestore.count("anjuPayFleaListings/"), 0);

  const unsafeCardHarness = createHarness({
    balances: { seller: 100 },
    creatorCards: {
      seller: {
        name: "SELLER",
        text: "Xでanother_userを検索してね",
        xHandle: "",
      },
    },
  });
  await assert.rejects(
    unsafeCardHarness.service.performAction("seller", listingInput()),
    hasCode("invalid-argument"),
  );
  assert.equal(unsafeCardHarness.wallet("seller").balance, 100);
  assert.equal(unsafeCardHarness.walletLedger("seller").length, 0);
  assert.equal(unsafeCardHarness.firestore.count("anjuPayFleaListings/"), 0);
});

test("high-risk report keeps the sale while quarantining X across every public record", async () => {
  const originalXPostUrl = "https://x.com/seller_x/status/123456789";
  const harness = createHarness({
    balances: { seller: 100, buyer: 100, reporter: 100 },
    creatorCards: {
      seller: {
        name: "SELLER",
        text: "色と言葉で今日の気分を届けます",
        xHandle: "seller_x",
      },
    },
  });
  const created = await harness.service.performAction("seller", listingInput({
    xPostUrl: originalXPostUrl,
    xConsent: true,
  }));
  const listingId = created.createdListing.id;
  await harness.service.performAction("buyer", {
    action: "buy",
    listingId,
    buyerName: "BUYER",
  });

  const reported = await harness.service.performAction("reporter", {
    action: "report",
    listingId,
    reason: "privacy",
  });
  assert.equal(reported.reported.reason, "privacy");
  assert.equal(reported.reported.xQuarantined, true);

  const listingPath = `anjuPayFleaListings/${listingId}`;
  const salePath = `anjuPayFleaSales/${listingId}`;
  const buyerReceiptPath = `anjuPayFleaReceipts/buyer/items/${listingId}`;
  const sellerReceiptPath = `anjuPayFleaReceipts/seller/items/${listingId}`;
  const reportPath = `anjuPayFleaReports/${stableId(`flea-report:${listingId}:reporter`)}`;
  for (const path of [
    listingPath,
    salePath,
    buyerReceiptPath,
    sellerReceiptPath,
  ]) {
    const stored = harness.firestore.read(path);
    assert.equal(stored.xPostUrl, "", path);
    assert.equal(stored.sellerCard?.xHandle, undefined, path);
  }
  assert.equal(harness.firestore.read(listingPath).status, "sold");
  assert.equal(harness.firestore.read(reportPath).xPostUrl, originalXPostUrl);
  assert.equal(harness.firestore.read(reportPath).xHandle, "seller_x");

  const sellerState = await harness.service.performAction("seller", { action: "state" });
  const buyerState = await harness.service.performAction("buyer", { action: "state" });
  assert.equal(sellerState.ownListing.status, "sold");
  assert.equal(sellerState.ownListing.xPostUrl, undefined);
  assert.equal(sellerState.ownListing.seller.creatorCard.xHandle, undefined);
  assert.equal(
    sellerState.receipts.find((receipt) => receipt.id === listingId).listing.xPostUrl,
    undefined,
  );
  assert.equal(
    buyerState.receipts.find((receipt) => receipt.id === listingId).listing.xPostUrl,
    undefined,
  );

  for (const path of [
    listingPath,
    salePath,
    buyerReceiptPath,
    sellerReceiptPath,
  ]) {
    const stored = harness.firestore.read(path);
    harness.firestore.write(path, {
      ...stored,
      xPostUrl: originalXPostUrl,
      sellerCard: {
        ...(stored.sellerCard || {}),
        schemaVersion: 2,
        name: "SELLER",
        text: "色と言葉で今日の気分を届けます",
        xHandle: "seller_x",
      },
    });
  }
  const replayed = await harness.service.performAction("reporter", {
    action: "report",
    listingId,
    reason: "other",
  });
  assert.equal(replayed.reported.reason, "privacy");
  assert.equal(replayed.reported.xQuarantined, true);
  for (const path of [
    listingPath,
    salePath,
    buyerReceiptPath,
    sellerReceiptPath,
  ]) {
    const stored = harness.firestore.read(path);
    assert.equal(stored.xPostUrl, "", path);
    assert.equal(stored.sellerCard?.xHandle, undefined, path);
  }
});

test("the same reporter can escalate other to privacy and quarantine X without hiding the listing", async () => {
  const originalXPostUrl = "https://x.com/seller_x/status/123456789";
  const harness = createHarness({
    balances: { seller: 100, reporter: 100 },
    creatorCards: {
      seller: {
        name: "SELLER",
        text: "色と言葉で今日の気分を届けます",
        xHandle: "seller_x",
      },
    },
  });
  const created = await harness.service.performAction("seller", listingInput({
    xPostUrl: originalXPostUrl,
    xConsent: true,
  }));
  const listingId = created.createdListing.id;
  const listingPath = `anjuPayFleaListings/${listingId}`;
  const reportPath = `anjuPayFleaReports/${stableId(`flea-report:${listingId}:reporter`)}`;

  const first = await harness.service.performAction("reporter", {
    action: "report",
    listingId,
    reason: "other",
  });
  assert.equal(first.reported.reason, "other");
  assert.equal(first.reported.xQuarantined, false);
  assert.equal(harness.firestore.read(listingPath).status, "active");
  assert.equal(harness.firestore.read(listingPath).xPostUrl, originalXPostUrl);
  assert.equal(harness.firestore.read(listingPath).sellerCard.xHandle, "seller_x");

  harness.setNow(Date.parse("2026-07-25T03:01:00.000Z"));
  const escalated = await harness.service.performAction("reporter", {
    action: "report",
    listingId,
    reason: "privacy",
  });
  assert.equal(escalated.reported.reason, "privacy");
  assert.equal(escalated.reported.xQuarantined, true);

  const listing = harness.firestore.read(listingPath);
  assert.equal(listing.status, "active");
  assert.equal(listing.xPostUrl, "");
  assert.equal(listing.sellerCard?.xHandle, undefined);
  const report = harness.firestore.read(reportPath);
  assert.equal(report.reason, "privacy");
  assert.equal(report.escalatedAt, Date.parse("2026-07-25T03:01:00.000Z"));
  assert.equal(report.xPostUrl, originalXPostUrl);
  assert.equal(report.xHandle, "seller_x");

  const replayed = await harness.service.performAction("reporter", {
    action: "report",
    listingId,
    reason: "other",
  });
  assert.equal(replayed.reported.reason, "privacy");
  assert.equal(replayed.reported.xQuarantined, true);
  assert.equal(harness.firestore.read(reportPath).reason, "privacy");
});

test("favorite snapshots omit UID and X handle, support removal, and enforce the 100-seller cap", async () => {
  const harness = createHarness({
    balances: { seller: 100, buyer: 100, cappedBuyer: 100 },
    creatorCards: {
      seller: { name: "SELLER", xHandle: "seller_x" },
    },
  });
  const created = await harness.service.performAction("seller", listingInput({
    xPostUrl: "https://x.com/seller_x/status/123456789",
    xConsent: true,
  }));
  const listingId = created.createdListing.id;
  const publicSellerId = fleaPublicSellerId("seller");

  const added = await harness.service.performAction("buyer", {
    action: "set_favorite",
    listingId,
    favorite: true,
  });
  const storedFavorite = harness.firestore.read(
    `anjuPayFleaFavorites/buyer/sellers/${publicSellerId}`,
  );
  assert.equal(storedFavorite.publicSellerId, publicSellerId);
  assert.equal(storedFavorite.creatorCard.name, "SELLER");
  assert.equal(storedFavorite.creatorCard.xHandle, undefined);
  assert.equal(containsPrivateIdentity(storedFavorite), false);
  assert.equal(containsPrivateIdentity(added.favorite), false);
  assert.equal(harness.firestore.read("anjuPayFleaFavorites/buyer").count, 1);

  harness.setNow(Date.parse("2026-07-25T15:00:00.000Z"));
  const removed = await harness.service.performAction("buyer", {
    action: "set_favorite",
    publicSellerId,
    favorite: false,
  });
  assert.equal(removed.favorite.favorite, false);
  assert.equal(
    harness.firestore.read(`anjuPayFleaFavorites/buyer/sellers/${publicSellerId}`),
    undefined,
  );
  assert.equal(harness.firestore.read("anjuPayFleaFavorites/buyer").count, 0);

  harness.setNow(Date.parse("2026-07-25T03:00:00.000Z"));
  harness.firestore.write("anjuPayFleaFavorites/cappedBuyer", {
    count: 100,
    updatedAt: Date.parse("2026-07-25T03:00:00.000Z"),
  });
  await assert.rejects(
    harness.service.performAction("cappedBuyer", {
      action: "set_favorite",
      listingId,
      favorite: true,
    }),
    hasCode("resource-exhausted"),
  );
  assert.equal(
    harness.firestore.read(`anjuPayFleaFavorites/cappedBuyer/sellers/${publicSellerId}`),
    undefined,
  );
  assert.equal(harness.firestore.read("anjuPayFleaFavorites/cappedBuyer").count, 100);
});

test("state and browse_more return every paid listing across collision-safe bounded pages", async () => {
  const initialNow = Date.parse("2026-07-25T03:00:00.000Z");
  const expiresAt = Date.parse("2026-07-25T15:00:00.000Z");
  const harness = createHarness({
    balances: { viewer: 100 },
    initialNow,
  });
  const expected = [];
  for (let index = 0; index < 105; index += 1) {
    const id = index.toString(16).padStart(40, "0");
    const browseOrder = Math.floor(index / 3).toString(16).padStart(40, "0");
    harness.firestore.write(`anjuPayFleaListings/${id}`, {
      schemaVersion: 1,
      sellerUid: `seller-${index}`,
      publicSellerId: stableId(`seller-${index}`),
      sellerName: `SELLER${index}`.slice(0, 16),
      sellerCard: null,
      dateKey: "2026-07-25",
      status: "active",
      category: "illustration",
      title: `TITLE${index}`,
      description: `DESCRIPTION${index}`,
      price: 25,
      browseOrder,
      createdAt: initialNow,
      expiresAt,
      updatedAt: initialNow,
    });
    expected.push({ id, browseOrder });
  }
  expected.sort((left, right) => (
    left.browseOrder.localeCompare(right.browseOrder) || left.id.localeCompare(right.id)
  ));

  const first = await harness.service.performAction("viewer", { action: "state" });
  assert.equal(first.listings.length, 50);
  assert.deepEqual(first.listings.map(({ id }) => id), expected.slice(0, 50).map(({ id }) => id));
  assert.equal(first.hasMore, true);
  assert.equal(first.nextBrowseCursor, expected[49].id);
  assert.equal(first.appendListings, undefined);

  const second = await harness.service.performAction("viewer", {
    action: "browse_more",
    cursor: first.nextBrowseCursor.toUpperCase(),
  });
  assert.equal(second.appendListings, true);
  assert.equal(second.listings.length, 50);
  assert.deepEqual(second.listings.map(({ id }) => id), expected.slice(50, 100).map(({ id }) => id));
  assert.equal(second.hasMore, true);
  assert.equal(second.nextBrowseCursor, expected[99].id);

  const third = await harness.service.performAction("viewer", {
    action: "browse_more",
    cursor: second.nextBrowseCursor,
  });
  assert.equal(third.appendListings, true);
  assert.equal(third.listings.length, 5);
  assert.deepEqual(third.listings.map(({ id }) => id), expected.slice(100).map(({ id }) => id));
  assert.equal(third.hasMore, false);
  assert.equal(third.nextBrowseCursor, null);

  const allListings = [...first.listings, ...second.listings, ...third.listings];
  assert.equal(new Set(allListings.map(({ id }) => id)).size, 105);
  assert.equal(containsPrivateIdentity(allListings), false);
  await assert.rejects(
    harness.service.performAction("viewer", {
      action: "browse_more",
      cursor: "not-a-cursor",
    }),
    hasCode("invalid-argument"),
  );

  const beforeMidnight = Date.parse("2026-07-25T14:59:59.900Z");
  const atMidnight = Date.parse("2026-07-25T15:00:00.000Z");
  harness.setNow(beforeMidnight);
  harness.queueNow(beforeMidnight, atMidnight);
  await assert.rejects(
    harness.service.performAction("viewer", {
      action: "browse_more",
      cursor: first.nextBrowseCursor,
    }),
    hasCode("aborted"),
  );
});

test("favorite addition rejects sold, hidden, and transaction-expired listings", async () => {
  const beforeMidnight = Date.parse("2026-07-25T14:59:59.900Z");
  const atMidnight = Date.parse("2026-07-25T15:00:00.000Z");
  const harness = createHarness({
    balances: { seller: 100, buyer: 100 },
    initialNow: beforeMidnight - 60_000,
  });
  const created = await harness.service.performAction("seller", listingInput());
  const listingId = created.createdListing.id;
  const listingPath = `anjuPayFleaListings/${listingId}`;
  const activeListing = harness.firestore.read(listingPath);

  for (const status of ["sold", "hidden"]) {
    harness.firestore.write(listingPath, {
      ...activeListing,
      status,
    });
    await assert.rejects(
      harness.service.performAction("buyer", {
        action: "set_favorite",
        listingId,
        favorite: true,
      }),
      hasCode("failed-precondition"),
    );
  }

  harness.firestore.write(listingPath, activeListing);
  harness.setNow(beforeMidnight);
  harness.crossAtNextTransaction(atMidnight);
  await assert.rejects(
    harness.service.performAction("buyer", {
      action: "set_favorite",
      listingId,
      favorite: true,
    }),
    hasCode("failed-precondition"),
  );
  assert.equal(harness.firestore.count("anjuPayFleaFavorites/buyer/sellers/"), 0);
});
