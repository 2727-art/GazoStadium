"use strict";

// マイスタジアムのサーバー処理を、メモリ上の Firestore で通しで確かめる。
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createStadiumService } = require("../stadium-service");
const { HOUR_MS } = require("../stadium-rules");

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FakeSnapshot {
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

class FakeReference {
  constructor(path) {
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return { doc: (id) => new FakeReference(`${this.path}/${name}/${id}`) };
  }
}

class FakeTransaction {
  constructor(documents) {
    this.documents = documents;
    this.wrote = false;
    this.writes = [];
  }

  async get(reference) {
    assert.equal(this.wrote, false, "all transaction reads must happen before writes");
    return new FakeSnapshot(reference, this.documents.get(reference.path));
  }

  create(reference, value) {
    this.wrote = true;
    if (this.documents.has(reference.path)) throw new Error(`Document already exists: ${reference.path}`);
    this.documents.set(reference.path, clone(value));
    this.writes.push(reference.path);
  }

  set(reference, value) {
    this.wrote = true;
    this.documents.set(reference.path, clone(value));
    this.writes.push(reference.path);
  }

  update(reference, value) {
    this.wrote = true;
    if (!this.documents.has(reference.path)) throw new Error(`Document does not exist: ${reference.path}`);
    this.documents.set(reference.path, { ...clone(this.documents.get(reference.path)), ...clone(value) });
    this.writes.push(reference.path);
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.writeLog = [];
  }

  collection(name) {
    return { doc: (id) => new FakeReference(`${name}/${id}`) };
  }

  async runTransaction(callback) {
    const working = new Map([...this.documents.entries()].map(([path, value]) => [path, clone(value)]));
    const transaction = new FakeTransaction(working);
    const result = await callback(transaction);
    this.documents = working;
    this.writeLog.push(...transaction.writes);
    return result;
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

const START = Date.parse("2026-10-20T08:00:00+09:00");

function createHarness({ balance = 0, matches = 0, maxBalance = 999_999_999 } = {}) {
  const firestore = new FakeFirestore();
  const mirrors = [];
  const logs = [];
  let clock = START;
  if (balance !== null) firestore.write("wallets/me", { balance, maxBalance });
  firestore.write("settings/ledger", { enabled: true });
  firestore.write("economyProgress/me", { achievementStats: { totalMatches: matches } });
  const service = createStadiumService({
    firestore,
    HttpsError: FakeHttpsError,
    async ensureWallet(uid) {
      if (!firestore.read(`wallets/${uid}`)) firestore.write(`wallets/${uid}`, { balance: 0, maxBalance });
    },
    walletRef: (uid) => firestore.collection("wallets").doc(uid),
    anjuPayLedgerConfigRef: () => firestore.collection("settings").doc("ledger"),
    walletData(snapshot) {
      if (!snapshot.exists) throw new FakeHttpsError("failed-precondition", "wallet missing");
      return { ...snapshot.data() };
    },
    walletCreditCapacity: (wallet) => wallet.maxBalance - wallet.balance,
    debitPoints(wallet, amount) {
      if (wallet.balance < amount) throw new FakeHttpsError("failed-precondition", "AnjuPay残高が不足しています。");
      wallet.balance -= amount;
    },
    creditPoints(wallet, amount) {
      if (wallet.balance + amount > wallet.maxBalance) throw new FakeHttpsError("failed-precondition", "上限です。");
      wallet.balance += amount;
    },
    stageAnjuPayOpening() {},
    appendAnjuPayEntry(transaction, reference, _wallet, _config, entry) {
      assert.equal(entry.components.reduce((sum, component) => sum + component.delta, 0), entry.delta);
      assert.equal(entry.balanceAfter - entry.balanceBefore, entry.delta);
      transaction.create(reference.collection("ledger").doc(entry.entryId), entry);
    },
    anjuPayWalletMetadataPatch: () => ({}),
    anjuPayEntryId: (seed) => crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 40),
    mirrorWallet: async (uid, value) => {
      mirrors.push({ uid, balance: value });
    },
    bestEffort: async (_label, operations) => {
      await Promise.allSettled(operations);
    },
    economyProgressRef: (uid) => firestore.collection("economyProgress").doc(uid),
    totalVerifiedMatches: (progress) => Number(progress?.achievementStats?.totalMatches || 0),
    now: () => clock,
    log: { info: (...args) => logs.push(args) },
  });
  return {
    firestore,
    mirrors,
    logs,
    act: (action, data = {}) => service.performAction("me", { action, ...data }),
    advance(ms) {
      clock += ms;
    },
    complete(count) {
      const progress = firestore.read("economyProgress/me");
      progress.achievementStats.totalMatches += count;
      firestore.write("economyProgress/me", progress);
    },
    balance: () => firestore.read("wallets/me").balance,
    stadium: () => firestore.read("stadiums/me"),
    ledger: () => firestore.keys("wallets/me/ledger/").map((path) => firestore.read(path)),
  };
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

test("before opening, get answers unopened and writes nothing", async () => {
  const harness = createHarness({ balance: 500, matches: 40 });
  const view = await harness.act("get");
  assert.equal(view.opened, false);
  assert.equal(view.fansPerMatch, 30);
  assert.equal(view.walletBalance, 500);
  assert.equal(harness.stadium(), undefined);
  assert.deepEqual(harness.firestore.writeLog, []);
  await rejects(harness.act("collect"), /開業していません/);
  await rejects(harness.act("build", { facility: "stand", level: 2 }), /開業していません/);
});

test("opening records the current completions so earlier play never becomes fans, and opening twice changes nothing", async () => {
  const harness = createHarness({ matches: 40 });
  const opened = await harness.act("open");
  assert.equal(opened.opened, true);
  assert.equal(opened.justOpened, true);
  assert.equal(opened.fans, 0);
  assert.equal(harness.stadium().baselineMatches, 40);

  harness.complete(3);
  harness.advance(60_000);
  const again = await harness.act("open");
  assert.equal(again.replayed, true);
  assert.equal(harness.stadium().baselineMatches, 40, "開業した時の完走数は変わらない");
  assert.equal(again.fans, 90);
});

test("completions after opening arrive as fans once, and the arrival is shown only on the next get", async () => {
  const harness = createHarness({ matches: 5 });
  await harness.act("open");
  harness.complete(4);
  const first = await harness.act("get");
  assert.equal(first.fans, 120);
  assert.equal(first.newFans, 120);
  assert.equal(harness.stadium().lastSeenFans, 120);
  const writesAfterFirst = harness.firestore.writeLog.length;
  const second = await harness.act("get");
  assert.equal(second.newFans, 0);
  assert.equal(harness.firestore.writeLog.length, writesAfterFirst, "観客が変わらなければ書かない");
});

test("collecting credits the wallet with one ledger entry and keeps the fraction in the vault", async () => {
  const harness = createHarness({ balance: 100, matches: 0 });
  await harness.act("open");
  harness.complete(20);
  await harness.act("get");
  harness.advance(3 * HOUR_MS + 30 * 60_000);
  const result = await harness.act("collect");
  assert.equal(result.collected, 2, "600人 × 1.0 Pay/1,000人 × 3.5時間 = 2.1 Pay → 2 Pay");
  assert.equal(result.walletBalance, 102);
  assert.equal(harness.balance(), 102);
  assert.equal(harness.stadium().vaultMilli, 100);
  assert.deepEqual(harness.mirrors, [{ uid: "me", balance: 102 }]);
  const ledger = harness.ledger();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, "stadium_revenue");
  assert.equal(ledger[0].category, "earn");
  assert.equal(ledger[0].labelKey, "anju_pay_stadium_revenue");
  assert.equal(ledger[0].status, "posted");
  assert.equal(ledger[0].delta, 2);
  assert.deepEqual(ledger[0].details, { mode: "stadium", dateKey: "2026-10-20" });
  assert.equal(harness.logs.length, 1);

  const empty = await harness.act("collect");
  assert.equal(empty.collected, 0);
  assert.equal(empty.reason, "empty");
  assert.equal(harness.ledger().length, 1, "0 Pay の回収は台帳に書かない");
});

test("the daily collect limit leaves the rest in the vault until the next JST day", async () => {
  const harness = createHarness({ balance: 0, matches: 0 });
  await harness.act("open");
  const record = harness.stadium();
  harness.firestore.write("stadiums/me", { ...record, vaultMilli: 260_000 });
  const first = await harness.act("collect");
  assert.equal(first.collected, 200);
  const blocked = await harness.act("collect");
  assert.equal(blocked.collected, 0);
  assert.equal(blocked.reason, "daily_limit");
  harness.advance(24 * HOUR_MS);
  const nextDay = await harness.act("collect");
  assert.equal(nextDay.collected, 60);
  assert.equal(harness.balance(), 260);
  assert.equal(harness.ledger().length, 2);
});

test("building charges once per level, records the facility, and refuses without enough Pay", async () => {
  const harness = createHarness({ balance: 1_200, matches: 0 });
  await harness.act("open");
  harness.complete(50);
  const built = await harness.act("build", { facility: "stand", level: 2 });
  assert.deepEqual(built.built, { facility: "stand", level: 2, cost: 500 });
  assert.equal(harness.balance(), 700);
  assert.equal(harness.stadium().facilities.stand, 2);
  const entry = harness.ledger().find((row) => row.kind === "stadium_build");
  assert.equal(entry.category, "spend");
  assert.equal(entry.delta, -500);
  assert.deepEqual(entry.details, { mode: "stadium", facility: "stand", facilityLevel: 2 });

  const replay = await harness.act("build", { facility: "stand", level: 2 });
  assert.equal(replay.replayed, true);
  assert.equal(harness.balance(), 700, "同じ段を2回送っても代金は1回");

  await rejects(harness.act("build", { facility: "stand", level: 3 }), /あと 300 Pay/);
  await rejects(harness.act("build", { facility: "shop", level: 3 }), /1段ずつ/);
  await rejects(harness.act("build", { facility: "gate", level: 2 }), /施設/);
  await rejects(harness.act("build", { facility: "shop", level: 2.5 }), /段/);
  assert.equal(harness.balance(), 700);
});

test("unknown actions are refused", async () => {
  const harness = createHarness();
  await rejects(harness.act("give_me_pay"), /操作/);
});
