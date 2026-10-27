"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createUgcPlayerSafetyStub } = require("./helpers/ugc-player-safety-stub");
const { createTributeService } = require("../tribute-service");
const { TRIBUTE_AGE_VERSION, jstDateKey } = require("../tribute-rules");
const { applyFirestoreSet } = require("./helpers/firestore-merge.cjs");

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

  async set(value, options = {}) {
    this.firestore.write(this.path, applyFirestoreSet(clone(this.firestore.read(this.path)), clone(value), options));
  }
}

class FakeQuery {
  constructor(firestore, path, filters = [], orderings = [], maximum = Infinity, cursor = null) {
    this.firestore = firestore;
    this.path = path;
    this.filters = filters;
    this.orderings = orderings;
    this.maximum = maximum;
    this.cursor = cursor;
  }

  where(field, operator, value) {
    assert.ok(["==", ">=", "<=", "<", "array-contains", "in"].includes(operator), operator);
    return new FakeQuery(this.firestore, this.path, [...this.filters, { field, operator, value }], this.orderings, this.maximum, this.cursor);
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(this.firestore, this.path, this.filters, [...this.orderings, { field, direction }], this.maximum, this.cursor);
  }

  limit(maximum) {
    return new FakeQuery(this.firestore, this.path, this.filters, this.orderings, maximum, this.cursor);
  }

  startAfter(...cursor) {
    return new FakeQuery(this.firestore, this.path, this.filters, this.orderings, this.maximum, cursor);
  }

  snapshot(documents = this.firestore.documents) {
    const prefix = `${this.path}/`;
    let rows = [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => ({ reference: new FakeDocumentReference(this.firestore, path), value }));
    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const candidate = row.value?.[filter.field];
        if (filter.operator === ">=") return candidate >= filter.value;
        if (filter.operator === "<=") return candidate <= filter.value;
        if (filter.operator === "<") return candidate < filter.value;
        if (filter.operator === "array-contains") return Array.isArray(candidate) && candidate.includes(filter.value);
        if (filter.operator === "in") return filter.value.includes(candidate);
        return candidate === filter.value;
      });
    }
    for (const ordering of [...this.orderings].reverse()) {
      rows.sort((left, right) => {
        const leftValue = ordering.field === "__name__" ? left.reference.id : left.value?.[ordering.field];
        const rightValue = ordering.field === "__name__" ? right.reference.id : right.value?.[ordering.field];
        const compared = leftValue === rightValue ? 0 : (leftValue < rightValue ? -1 : 1);
        return ordering.direction === "desc" ? -compared : compared;
      });
    }
    if (this.cursor) rows = rows.filter((row) => {
      for (let i = 0; i < this.orderings.length; i++) {
        const { field, direction } = this.orderings[i];
        const value = field === "__name__" ? row.reference.id : row.value[field];
        if (value !== this.cursor[i]) return direction === "desc" ? value < this.cursor[i] : value > this.cursor[i];
      }
      return false;
    });
    const docs = rows.slice(0, this.maximum).map((row) => new FakeDocumentSnapshot(row.reference, row.value));
    return { empty: docs.length === 0, size: docs.length, docs };
  }

  async get() {
    return this.snapshot();
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
    this.wrote = false;
  }

  async get(reference) {
    assert.equal(this.wrote, false, "all transaction reads must happen before writes");
    if (reference instanceof FakeQuery) return reference.snapshot(this.documents);
    return new FakeDocumentSnapshot(reference, this.documents.get(reference.path));
  }

  create(reference, value) {
    this.wrote = true;
    if (this.documents.has(reference.path)) throw new Error(`Document already exists: ${reference.path}`);
    this.documents.set(reference.path, clone(value));
  }

  set(reference, value, options = {}) {
    this.wrote = true;
    this.documents.set(reference.path, applyFirestoreSet(clone(this.documents.get(reference.path)), clone(value), options));
  }

  update(reference, value) {
    this.wrote = true;
    if (!this.documents.has(reference.path)) throw new Error(`Document does not exist: ${reference.path}`);
    this.documents.set(reference.path, { ...clone(this.documents.get(reference.path)), ...clone(value) });
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
    const working = new Map([...this.documents.entries()].map(([path, value]) => [path, clone(value)]));
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

  delete(path) {
    this.documents.delete(path);
  }

  keys(prefix) {
    return [...this.documents.keys()].filter((path) => path.startsWith(prefix));
  }
}

function stableId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

const START = Date.parse("2026-10-05T03:00:00+09:00");
const DAY = 24 * 60 * 60 * 1_000;

function createHarness({ balances = {}, playerSafety } = {}) {
  const firestore = new FakeFirestore();
  playerSafety?.attach(firestore);
  const mirrors = [];
  const achievementSyncs = [];
  let clock = START;
  for (const [uid, balance] of Object.entries(balances)) {
    firestore.write(`wallets/${uid}`, { balance, maxBalance: 1_000_000 });
  }
  firestore.write("settings/ledger", { enabled: true });
  const service = createTributeService({
    firestore,
    playerSafety,
    HttpsError: FakeHttpsError,
    async ensureWallet(uid) {
      if (!firestore.read(`wallets/${uid}`)) firestore.write(`wallets/${uid}`, { balance: 0, maxBalance: 1_000_000 });
      return firestore.read(`wallets/${uid}`).balance;
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
      const components = entry.components || [];
      if (components.length) {
        assert.equal(components.reduce((sum, component) => sum + component.delta, 0), entry.delta, "components sum to delta");
      }
      assert.equal(entry.balanceAfter - entry.balanceBefore, entry.delta, "delta matches balances");
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
      achievementSyncs.push({ uid, unlocked: Object.keys(profile?.unlocked || {}) });
    },
    economyProgressRef: (uid) => firestore.collection("economyProgress").doc(uid),
    totalVerifiedMatches: (progress) => Number(progress?.achievementStats?.totalMatches || 0),
    now: () => clock,
  });
  const act = (uid, action, data = {}, context = {}) => service.performAction(uid, { action, ...data }, context);
  return {
    firestore,
    mirrors,
    achievementSyncs,
    service,
    act,
    advance(ms) {
      clock += ms;
    },
    now: () => clock,
    balance: (uid) => firestore.read(`wallets/${uid}`).balance,
    // 検証済みの正式完走数（economyProgress の achievementStats.totalMatches）。
    setMatches(uid, totalMatches) {
      firestore.write(`economyProgress/${uid}`, { achievementStats: { totalMatches } });
    },
    contract: (contractId) => firestore.read(`tributeContracts/${contractId}`),
    events(contractId) {
      return firestore.keys(`tributeContracts/${contractId}/events/`).sort().map((path) => firestore.read(path));
    },
    ledger(uid) {
      return firestore.keys(`wallets/${uid}/ledger/`).map((path) => firestore.read(path));
    },
  };
}

let requestCounter = 0;
const nextRequestId = () => `req_${String(++requestCounter).padStart(8, "0")}`;

async function confirmAge(harness, uid) {
  return harness.act(uid, "age_confirm", { version: TRIBUTE_AGE_VERSION, adult: true, premise: true });
}

async function openManager(harness, uid, card = {}) {
  await confirmAge(harness, uid);
  const saved = await harness.act(uid, "save_profile", {
    card: { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 10, sigil: 2, ...card },
    accepting: true,
  });
  harness.advance(2_100);
  return saved.profile.publicManagerId;
}

const BASE_APPLICATION = Object.freeze({
  caps: { perTribute: 100, perDay: 300, total: 1_000 },
  durationDays: 3,
  tone: "harsh",
  ngWords: ["ブス"],
  allowReportRequests: true,
  rankOptIn: true,
  walletName: "ポチ財布",
  acceptNoDecline: true,
});

async function startContract(harness, managerUid, payerUid, publicManagerId, application = {}, entryFee = 10) {
  await confirmAge(harness, payerUid);
  const applied = await harness.act(payerUid, "apply", {
    publicManagerId,
    expectedEntryFee: entryFee,
    application: { ...BASE_APPLICATION, ...application },
  });
  const contractId = applied.contract.contractId;
  await harness.act(managerUid, "accept", { contractId });
  return contractId;
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

test("every action except state and age confirmation requires the 18+ premise check", async () => {
  const harness = createHarness({ balances: { payer: 1_000 } });
  const state = await harness.act("payer", "state");
  assert.equal(state.ageConfirmed, false);
  assert.equal(state.contracts, undefined);
  await rejects(harness.act("payer", "board"), /18歳以上/);
  await rejects(harness.act("payer", "save_profile", { walletName: "x" }), /18歳以上/);
  await rejects(harness.act("payer", "age_confirm", { version: TRIBUTE_AGE_VERSION, adult: true }), /両方/);
  await rejects(harness.act("payer", "age_confirm", { version: "old", adult: true, premise: true }), /両方/);
  await confirmAge(harness, "payer");
  assert.equal((await harness.act("payer", "state")).ageConfirmed, true);
});

test("manager card rejects contact, payment, meeting and exposure wording, and the board filter is nekama-only", async () => {
  const harness = createHarness();
  await confirmAge(harness, "manager");
  await rejects(harness.act("manager", "save_profile", {
    card: { personaName: "ミオ", intro: "LINE交換しよ", disclosure: "nekama", style: "harsh", entryFee: 0 },
    accepting: true,
  }), /外部の連絡先/);
  harness.advance(2_100);
  await rejects(harness.act("manager", "save_profile", {
    card: { personaName: "ミオ", intro: "PayPayで送って", disclosure: "nekama", style: "harsh", entryFee: 0 },
    accepting: true,
  }), /外部の決済/);
  harness.advance(2_100);
  const nekamaId = await openManager(harness, "manager");
  const asIsId = await openManager(harness, "other", { personaName: "レイ", disclosure: "as_is" });
  await confirmAge(harness, "viewer");
  const all = await harness.act("viewer", "board");
  assert.deepEqual(all.managers.map((card) => card.publicManagerId).sort(), [nekamaId, asIsId].sort());
  for (const card of all.managers) {
    assert.equal(card.uid, undefined);
    assert.equal(card.managerUid, undefined);
  }
  const nekama = await harness.act("viewer", "board", { nekamaOnly: true });
  assert.deepEqual(nekama.managers.map((card) => card.publicManagerId), [nekamaId]);
  assert.equal(nekama.managers[0].disclosure, "nekama");
});

test("apply and accept charge the entry fee as a capped tribute with a burned 5% fee and a private receipt", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  await confirmAge(harness, "payer");
  await rejects(harness.act("payer", "apply", {
    publicManagerId,
    expectedEntryFee: 10,
    application: { ...BASE_APPLICATION, caps: { perTribute: 300, perDay: 100, total: 1_000 } },
  }), /1回 ≦ 1日 ≦ 合計/);
  await rejects(harness.act("payer", "apply", {
    publicManagerId,
    expectedEntryFee: 5,
    application: BASE_APPLICATION,
  }), /入場料が変わりました/);
  const applied = await harness.act("payer", "apply", { publicManagerId, expectedEntryFee: 10, application: BASE_APPLICATION });
  const contractId = applied.contract.contractId;
  assert.equal(applied.contract.status, "pending");
  assert.equal(harness.balance("payer"), 1_000, "entry fee is charged only on acceptance");
  await rejects(harness.act("payer", "apply", { publicManagerId, expectedEntryFee: 10, application: BASE_APPLICATION }), /申込中か進行中/);
  await rejects(harness.act("payer", "accept", { contractId }), /この操作はできません/);

  const accepted = await harness.act("manager", "accept", { contractId });
  assert.equal(accepted.contract.status, "active");
  assert.equal(accepted.entryFeeCharged, 10);
  assert.equal(harness.balance("payer"), 990);
  assert.equal(harness.balance("manager"), 9, "receiver pays the 5% fee (min 1)");
  const contract = harness.contract(contractId);
  assert.equal(contract.totalTributed, 10);
  assert.equal(contract.todayTributed, 10);
  assert.deepEqual(contract.participants, ["manager", "payer"]);
  const receipts = await harness.act("payer", "receipts");
  assert.equal(receipts.receipts.length, 1);
  assert.equal(receipts.receipts[0].kind, "entry");
  assert.equal(receipts.receipts[0].receiptNo, 1);
  assert.equal(receipts.receipts[0].personaName, "ミオ様");
  assert.equal((await harness.act("manager", "receipts")).receipts.length, 0, "receipts are visible only to the payer");
  const kinds = harness.ledger("payer").map((entry) => entry.kind);
  assert.deepEqual(kinds, ["tribute_sent"]);
  const received = harness.ledger("manager")[0];
  assert.equal(received.kind, "tribute_received");
  assert.deepEqual(received.components.map((component) => [component.kind, component.delta]), [["tribute_gross", 10], ["tribute_fee", -1]]);
});

test("after a contract only real money and the payer's NG words are refused, and messages are rate limited", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  await rejects(harness.act("manager", "message", { contractId, text: "お前ほんとブスな財布だな" }), /言われたくない言葉/);
  await rejects(harness.act("manager", "message", { contractId, text: "1000円振り込んで" }), /外部の決済|現実のお金/);
  await rejects(harness.act("payer", "message", { contractId, text: "PayPayで送ります" }), /外部の決済/);
  await rejects(harness.act("manager", "request", { contractId, amount: 100, note: "アマギフで払え", clientRequestId: nextRequestId() }), /外部の決済/);
  // ロールプレイの幅を広げるため、連絡先・会う約束・個人情報・晒しの言葉は、契約後の会話では止めない（ユーザー決定）。
  for (const [index, text] of ["ディスコードでやろ", "明日会おうよ", "住所教えろ", "晒すぞ", "管理口座に入れなさい"].entries()) {
    harness.advance(2_000);
    const sent = await harness.act(index % 2 ? "payer" : "manager", "message", { contractId, text });
    assert.ok(sent.seq > 0, text);
  }
  harness.advance(2_000);
  const request = await harness.act("manager", "request", { contractId, amount: 100, note: "会いたいなら払え", clientRequestId: nextRequestId() });
  assert.ok(request.ok);
  harness.advance(2_000);
  const sent = await harness.act("manager", "message", { contractId, text: "遅い。財布のくせに待たせるな。" });
  assert.ok(sent.seq > 0);
  await rejects(harness.act("manager", "message", { contractId, text: "まだ？" }), /2秒/);
  harness.advance(2_000);
  await harness.act("manager", "message", { contractId, text: "まだ？" });
  await harness.act("payer", "message", { contractId, text: "ブスって言わないで" });
  const texts = harness.events(contractId).filter((event) => event.type === "message").map((event) => [event.actor, event.text]);
  assert.deepEqual(texts, [
    ["manager", "ディスコードでやろ"],
    ["payer", "明日会おうよ"],
    ["manager", "住所教えろ"],
    ["payer", "晒すぞ"],
    ["manager", "管理口座に入れなさい"],
    ["manager", "遅い。財布のくせに待たせるな。"],
    ["manager", "まだ？"],
    ["payer", "ブスって言わないで"],
  ]);
});

test("managers request up to 10,000 regardless of the payer's hidden limits; paying still respects them and requests cannot be declined", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  // 限度額は契約の記録にも「申し込み」の出来事にもなく、財布だけが読める場所にある。
  assert.equal(harness.contract(contractId).caps, undefined);
  assert.deepEqual(harness.firestore.read(`tributeContracts/${contractId}/private/limits`).caps, { perTribute: 100, perDay: 300, total: 1_000 });
  assert.equal(harness.events(contractId)[0].type, "applied");
  assert.equal(harness.events(contractId)[0].caps, undefined);
  const managerView = (await harness.act("manager", "state")).contracts.find((entry) => entry.contractId === contractId);
  assert.deepEqual({ caps: managerView.caps, pendingCaps: managerView.pendingCaps, allowance: managerView.allowance, escrowRoom: managerView.escrowRoom }, { caps: null, pendingCaps: null, allowance: 0, escrowRoom: 0 });

  await rejects(harness.act("manager", "request", { contractId, amount: 10_001 }), /1回 10,000 Pay まで/);
  const big = await harness.act("manager", "request", { contractId, amount: 10_000, note: "払えないなら黙ってな。" });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "request", requestId: big.requestId, amount: 10_000, clientRequestId: nextRequestId() }), /1回の限度額（100 Pay）/);
  await rejects(harness.act("payer", "decline_request", { contractId, requestId: big.requestId }), /請求は断れません/);
  assert.equal(harness.contract(contractId).pendingRequests[big.requestId].amount, 10_000, "an unpayable request stays unpaid");
  assert.ok(harness.firestore.read("tributeProfiles/manager").highRequestAt > 0, "a request of 3,000 or more marks the manager as a high requester");
  harness.advance(2_100);
  const requested = await harness.act("manager", "request", { contractId, amount: 100, note: "今日の分。早く。" });
  const paid = await harness.act("payer", "tribute", {
    contractId,
    kind: "request",
    requestId: requested.requestId,
    amount: 100,
    clientRequestId: nextRequestId(),
  });
  assert.equal(paid.receipt.amount, 100);
  assert.equal(paid.receipt.pairCount, 2);
  assert.equal(harness.balance("payer"), 4_890);
  assert.equal(harness.balance("manager"), 9 + 95);
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 150, clientRequestId: nextRequestId() }), /1回の限度額/);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() }), /今日の限度額/);
  const state = await harness.act("payer", "state");
  const view = state.contracts.find((entry) => entry.contractId === contractId);
  assert.equal(view.todayTributed, 210);
  assert.equal(view.allowance, 90);

  // 翌日以降も、契約合計の上限を超える献上は通らない。
  for (let day = 1; day <= 2; day += 1) {
    harness.advance(DAY);
    for (let index = 0; index < 3; index += 1) {
      harness.advance(10);
      await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() });
    }
  }
  assert.equal(harness.contract(contractId).totalTributed, 810);
  harness.advance(DAY - 60_000);
  assert.equal(harness.contract(contractId).status, "active");
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() }), /契約合計の限度額/);
});

test("a repeated tribute request id replays without charging twice", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  const clientRequestId = nextRequestId();
  const first = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId });
  const second = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId });
  assert.equal(second.replayed, true);
  assert.equal(second.receipt.receiptId, first.receipt.receiptId);
  assert.equal(harness.balance("payer"), 950);
  assert.equal(harness.contract(contractId).tributeCount, 1);
});

test("only the payer can change the hidden limits: lowering keeps unpaid requests, raising waits for the next JST day, and the manager never learns of it", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  const limits = () => harness.firestore.read(`tributeContracts/${contractId}/private/limits`);
  await harness.act("manager", "request", { contractId, amount: 100 });
  harness.advance(2_000);
  await harness.act("manager", "request", { contractId, amount: 30 });
  await rejects(harness.act("manager", "set_caps", { contractId, caps: { perTribute: 1_000, perDay: 5_000, total: 30_000 } }), /この操作はできません/);
  await rejects(harness.act("manager", "terminate", { contractId }), /この操作はできません/);
  const eventsBefore = harness.events(contractId).length;

  const lowered = await harness.act("payer", "set_caps", { contractId, caps: { perTribute: 50, perDay: 300, total: 1_000 } });
  assert.deepEqual(lowered.contract.caps, { perTribute: 50, perDay: 300, total: 1_000 });
  assert.deepEqual(lowered.contract.pendingRequests.map((entry) => entry.amount), [100, 30], "a request above the lowered limit stays unpaid");
  assert.deepEqual(limits().caps, { perTribute: 50, perDay: 300, total: 1_000 });

  const raised = await harness.act("payer", "set_caps", { contractId, caps: { perTribute: 300, perDay: 300, total: 1_000 } });
  assert.deepEqual(raised.contract.caps, { perTribute: 50, perDay: 300, total: 1_000 }, "raise does not apply today");
  assert.deepEqual(raised.contract.pendingCaps, { perTribute: 300, perDay: 300, total: 1_000 });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 300, clientRequestId: nextRequestId() }), /1回の限度額（50 Pay）/);
  const midnight = Date.parse(`${raised.contract.pendingCapsEffectiveDateKey}T00:00:00+09:00`);
  harness.advance(midnight - harness.now() + 1);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 300, clientRequestId: nextRequestId() });
  assert.deepEqual(limits().caps, { perTribute: 300, perDay: 300, total: 1_000 });
  assert.equal(harness.contract(contractId).caps, undefined, "limits never return to the shared contract record");

  // 1回の限度額を3,000以上にするのは、Google で保護した財布だけ。
  await rejects(harness.act("payer", "set_caps", { contractId, caps: { perTribute: 3_000, perDay: 3_000, total: 3_000 } }), /Google で保護/);
  await harness.act("payer", "set_caps", { contractId, caps: { perTribute: 3_000, perDay: 3_000, total: 3_000 } }, { googleProtected: true });
  const cancelled = await harness.act("payer", "cancel_raise", { contractId });
  assert.equal(cancelled.contract.pendingCaps, null);

  // 限度額の変更は、管理人も読む出来事に残らない。管理人の画面にも出ない。
  const shared = harness.events(contractId).slice(eventsBefore);
  assert.ok(shared.every((event) => !String(event.type).startsWith("caps_") && event.caps === undefined && event.reason !== "caps"), JSON.stringify(shared.map((event) => event.type)));
  const managerView = (await harness.act("manager", "state")).contracts.find((entry) => entry.contractId === contractId);
  assert.equal(managerView.caps, null);
  assert.equal(managerView.pendingCaps, null);
});

test("an old contract with limits on the shared record moves them to the payer's private limits on its next action", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  const path = `tributeContracts/${contractId}`;
  // このリリースより前の契約: 限度額が契約の記録にあり、private/limits はない。
  harness.firestore.write(path, { ...harness.contract(contractId), caps: { perTribute: 50, perDay: 100, total: 300 }, pendingCaps: null, pendingCapsEffectiveDateKey: "" });
  harness.firestore.delete(`${path}/private/limits`);
  const updatedAt = harness.contract(contractId).updatedAt;
  harness.advance(1_000);
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 60, clientRequestId: nextRequestId() }), /1回の限度額（50 Pay）/);
  await harness.act("manager", "message", { contractId, text: "まだ？" });
  assert.equal(harness.contract(contractId).caps, null, "the shared record no longer holds the limits");
  assert.deepEqual(harness.firestore.read(`${path}/private/limits`).caps, { perTribute: 50, perDay: 100, total: 300 });
  assert.ok(harness.contract(contractId).updatedAt > updatedAt);
});

test("既読無視 starts when the manager reads an unanswered payer message, and ends with a reply", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("manager", "request", { contractId, amount: 5_000 });
  harness.advance(2_100);
  await harness.act("payer", "message", { contractId, text: "ごめんなさい、今月は厳しくて…" });
  const seq = harness.contract(contractId).eventSeq;
  assert.equal(harness.contract(contractId).ignoredSince || 0, 0, "not read yet");
  harness.advance(60_000);
  const readAt = harness.now();
  await harness.act("manager", "mark_read", { contractId, seq });
  assert.equal(harness.contract(contractId).ignoredSince, readAt);
  harness.advance(60_000);
  await harness.act("manager", "mark_read", { contractId, seq });
  assert.equal(harness.contract(contractId).ignoredSince, readAt, "reading again keeps the start");
  const payerView = (await harness.act("payer", "state")).contracts.find((entry) => entry.contractId === contractId);
  assert.equal(payerView.ignoredSince, readAt);
  assert.equal(payerView.peerReadSeq, seq);
  harness.advance(2_100);
  await harness.act("manager", "message", { contractId, text: "払ってから話しかけな。" });
  assert.equal(harness.contract(contractId).ignoredSince, 0, "a reply ends it");
});

test("the manager's declaration reaches the board, the card and the manager's open contracts", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000, viewer: 0 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0, ignoreUnpaid: true });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  assert.equal(harness.contract(contractId).managerIgnoreUnpaid, true, "copied when applying");
  await confirmAge(harness, "viewer");
  const board = await harness.act("viewer", "board");
  assert.equal(board.managers.find((card) => card.publicManagerId === publicManagerId).ignoreUnpaid, true);
  const off = await harness.act("manager", "set_declaration", { ignoreUnpaid: false });
  assert.equal(off.profile.card.ignoreUnpaid, false);
  assert.equal(harness.contract(contractId).managerIgnoreUnpaid, false, "open contracts follow the switch");
  const view = (await harness.act("payer", "state")).contracts.find((entry) => entry.contractId === contractId);
  assert.equal(view.managerIgnoreUnpaid, false);
  await rejects(harness.act("viewer", "set_declaration", { ignoreUnpaid: true }), /管理人カードを作ってから/);
});

test("escrow stays the payer's: deposits are capped, takes count as tributes, withdrawals need approval, and terminate returns everything", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 2_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await rejects(harness.act("payer", "escrow_deposit", { contractId, amount: 1_001, clientRequestId: nextRequestId() }), /あと 1000 Pay/);
  const depositId = nextRequestId();
  await harness.act("payer", "escrow_deposit", { contractId, amount: 400, clientRequestId: depositId });
  await harness.act("payer", "escrow_deposit", { contractId, amount: 400, clientRequestId: depositId });
  assert.equal(harness.balance("payer"), 1_600, "a repeated deposit id is not charged twice");
  assert.equal(harness.contract(contractId).escrowBalance, 400);

  await assert.rejects(harness.act("manager", "escrow_take", { contractId, amount: 150, clientRequestId: nextRequestId() }), (error) => {
    assert.match(error.message, /財布の限度額を超えるため/);
    assert.doesNotMatch(error.message, /\d/, "the manager never sees the payer's limit");
    return true;
  });
  await harness.act("manager", "escrow_take", { contractId, amount: 100, clientRequestId: nextRequestId() });
  assert.equal(harness.balance("payer"), 1_600, "escrow take does not touch the payer wallet again");
  assert.equal(harness.balance("manager"), 95);
  assert.equal(harness.contract(contractId).escrowBalance, 300);
  assert.equal(harness.contract(contractId).totalTributed, 100);
  const take = harness.ledger("payer").find((entry) => entry.labelKey === "anju_pay_tribute_escrow_take");
  assert.equal(take.delta, 0);
  assert.equal(take.nominalAmount, 100);
  assert.equal((await harness.act("payer", "receipts")).receipts[0].kind, "escrow_take");

  await harness.act("payer", "escrow_withdraw_request", { contractId, amount: 100 });
  await rejects(harness.act("payer", "escrow_withdraw_request", { contractId, amount: 50 }), /1件ずつ/);
  await harness.act("manager", "escrow_decision", { contractId, approve: false });
  assert.equal(harness.balance("payer"), 1_600);
  await harness.act("payer", "escrow_withdraw_request", { contractId, amount: 100 });
  await harness.act("manager", "escrow_decision", { contractId, approve: true });
  assert.equal(harness.balance("payer"), 1_700);
  assert.equal(harness.contract(contractId).escrowBalance, 200);

  const ended = await harness.act("payer", "terminate", { contractId });
  assert.equal(ended.contract.status, "ended");
  assert.equal(ended.contract.endReason, "terminated");
  assert.equal(harness.balance("payer"), 1_900, "terminate returns all remaining escrow immediately");
  assert.equal(harness.contract(contractId).escrowBalance, 0);
  const endEvent = harness.events(contractId).at(-1);
  assert.equal(endEvent.type, "ended");
  assert.equal(endEvent.escrowReturned, 200);
  const profile = harness.firestore.read("tributeProfiles/payer");
  assert.equal(profile.counts.payerOpen, 0);
  assert.equal(harness.firestore.read("tributeProfiles/manager").counts.managerActive, 0);
  await rejects(harness.act("manager", "message", { contractId, text: "戻れ" }), /終了しています/);
});

test("lowering the total cap returns escrow above the new room", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 2_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("payer", "escrow_deposit", { contractId, amount: 900, clientRequestId: nextRequestId() });
  await harness.act("payer", "set_caps", { contractId, caps: { perTribute: 100, perDay: 300, total: 300 } });
  assert.equal(harness.contract(contractId).escrowBalance, 300);
  assert.equal(harness.balance("payer"), 1_700);
});

test("blocking ends open contracts between the pair and returns escrow; blocked pairs cannot apply", async () => {
  const playerSafety = createUgcPlayerSafetyStub();
  const harness = createHarness({ balances: { manager: 0, payer: 2_000 }, playerSafety });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("payer", "escrow_deposit", { contractId, amount: 500, clientRequestId: nextRequestId() });
  playerSafety.setBlocked("payer", "manager");
  const result = await harness.service.endContractsBetween("payer", "manager");
  assert.equal(result.ended, 1);
  assert.equal(harness.contract(contractId).endReason, "blocked");
  assert.equal(harness.balance("payer"), 2_000);
  await rejects(harness.act("payer", "apply", { publicManagerId, expectedEntryFee: 0, application: BASE_APPLICATION }), /利用できません/);
  const board = await harness.act("payer", "board");
  assert.equal(board.managers.length, 0, "blocked managers disappear from the board");
});

test("a contract touched after a block ends on that touch instead of moving Pay", async () => {
  const playerSafety = createUgcPlayerSafetyStub();
  const harness = createHarness({ balances: { manager: 0, payer: 2_000 }, playerSafety });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  playerSafety.setBlocked("manager", "payer");
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: nextRequestId() }), /契約は終了しました/);
  assert.equal(harness.balance("payer"), 2_000);
  assert.equal(harness.contract(contractId).status, "ended");
});

test("expiry ends applications after 48 hours and contracts after their duration, returning escrow", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 2_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  await confirmAge(harness, "payer");
  const applied = await harness.act("payer", "apply", { publicManagerId, expectedEntryFee: 0, application: { ...BASE_APPLICATION, durationDays: 1 } });
  harness.advance(48 * 60 * 60 * 1_000 + 1);
  await rejects(harness.act("manager", "accept", { contractId: applied.contract.contractId }), /48時間で失効/);
  assert.equal(harness.contract(applied.contract.contractId).endReason, "application_expired");
  assert.equal(harness.firestore.read("tributeProfiles/manager").counts.managerPending, 0);

  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { durationDays: 1 }, 0);
  await harness.act("payer", "escrow_deposit", { contractId, amount: 300, clientRequestId: nextRequestId() });
  harness.advance(DAY + 1);
  const result = await harness.service.expireContracts();
  assert.equal(result.ended, 1);
  assert.equal(harness.contract(contractId).endReason, "expired");
  assert.equal(harness.balance("payer"), 2_000);
});

test("a payer holds at most five open contracts, and must accept that requests cannot be declined", async () => {
  const harness = createHarness({ balances: { payer: 1_000 } });
  const ids = [];
  for (const uid of ["m1", "m2", "m3", "m4", "m5", "m6"]) ids.push(await openManager(harness, uid, { entryFee: 0 }));
  await confirmAge(harness, "payer");
  await rejects(harness.act("payer", "apply", { publicManagerId: ids[0], expectedEntryFee: 0, application: { ...BASE_APPLICATION, acceptNoDecline: false } }), /請求は断れず/);
  await rejects(harness.act("payer", "apply", { publicManagerId: ids[0], expectedEntryFee: 0, application: { ...BASE_APPLICATION, caps: { perTribute: 3_000, perDay: 3_000, total: 3_000 } } }), /Google で保護/);
  await harness.act("payer", "apply", { publicManagerId: ids[0], expectedEntryFee: 0, application: BASE_APPLICATION });
  await rejects(harness.act("payer", "apply", { publicManagerId: ids[1], expectedEntryFee: 0, application: BASE_APPLICATION }), /30秒に1回/);
  for (const id of ids.slice(1, 5)) {
    harness.advance(30_000);
    await harness.act("payer", "apply", { publicManagerId: id, expectedEntryFee: 0, application: BASE_APPLICATION });
  }
  harness.advance(30_000);
  await rejects(harness.act("payer", "apply", { publicManagerId: ids[5], expectedEntryFee: 0, application: BASE_APPLICATION }), /5件まで/);
});

test("the manager's daily receive cap applies across contracts", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 2_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  harness.firestore.write("tributeProfiles/manager", {
    ...harness.firestore.read("tributeProfiles/manager"),
    receiveDayKey: jstDateKey(harness.now()),
    receiveDayTotal: 99_950,
  });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() }), /100,000 Pay/);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId: nextRequestId() });
});

test("only managers paid by 3 wallets with 1,000 Pay can open a vault; Pay moves in and out freely and only the tier is shown", async () => {
  const harness = createHarness({ balances: { manager: 20_000, p1: 3_000, p2: 3_000, p3: 3_000 } });
  await confirmAge(harness, "viewer");
  const card = { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 0, sigil: 2 };
  const publicManagerId = await openManager(harness, "manager", card);
  const move = (uid, action, amount, clientRequestId = nextRequestId()) => harness.act(uid, action, { amount, clientRequestId });
  const open = { caps: { perTribute: 1_000, perDay: 1_000, total: 10_000 } };

  // 管理人カードのない人と、実績の足りない管理人は、金庫を作れない（推し値市場の実績は数えない）。
  await confirmAge(harness, "p1");
  await rejects(move("p1", "vault_deposit", 10), /管理人カードのある管理人だけ/);
  const contracts = {};
  for (const payer of ["p1", "p2", "p3"]) contracts[payer] = await startContract(harness, "manager", payer, publicManagerId, open, 0);
  let view = await harness.act("manager", "vault");
  assert.equal(view.vault.qualified, false);
  assert.deepEqual(view.vault.progress, { payers: 0, received: 0, needPayers: 3, needReceived: 1_000 });
  await harness.act("p1", "tribute", { contractId: contracts.p1, kind: "silent", amount: 500, clientRequestId: nextRequestId() });
  await harness.act("p2", "tribute", { contractId: contracts.p2, kind: "silent", amount: 300, clientRequestId: nextRequestId() });
  await rejects(move("manager", "vault_deposit", 100), /累計3人以上の財布から、合わせて1,000 Pay以上/);
  await rejects(move("manager", "vault_withdraw", 100), /まだ金庫がありません/);
  await harness.act("p3", "tribute", { contractId: contracts.p3, kind: "silent", amount: 200, clientRequestId: nextRequestId() });
  view = await harness.act("manager", "vault");
  assert.equal(view.vault.qualified, true, "the vault opens on the first deposit");
  const wallet = harness.balance("manager");

  // 入れる: 木箱（1,000）→ 蔵（10,000）。同じ依頼は二重に動かさない。
  const firstId = nextRequestId();
  const first = await move("manager", "vault_deposit", 1_000, firstId);
  assert.deepEqual(first.vault, { qualified: true, amount: 1_000, tier: 1, bestTier: 1 });
  assert.equal(first.reachedTier, 1);
  const replay = await move("manager", "vault_deposit", 1_000, firstId);
  assert.equal(replay.replayed, true);
  assert.equal(harness.balance("manager"), wallet - 1_000);
  harness.advance(1_000);
  const third = await move("manager", "vault_deposit", 9_000);
  assert.deepEqual(third.vault, { qualified: true, amount: 10_000, tier: 3, bestTier: 3 });
  await rejects(move("manager", "vault_deposit", wallet), /AnjuPay残高が足りません/);

  // 出す: 段階は下がるが、届いた段階（飾り）は残る。
  harness.advance(1_000);
  const out = await move("manager", "vault_withdraw", 6_000);
  assert.deepEqual(out.vault, { qualified: true, amount: 4_000, tier: 1, bestTier: 3 });
  assert.equal(out.reachedTier, undefined);
  assert.equal(harness.balance("manager"), wallet - 4_000);
  await rejects(move("manager", "vault_withdraw", 4_001), /金庫の残りが足りません/);
  const kinds = harness.ledger("manager").map((entry) => `${entry.kind}:${entry.status}`);
  assert.ok(kinds.includes("tribute_vault_deposit:held") && kinds.includes("tribute_vault_withdraw:settled"), kinds.join(","));

  // 外に見せるのは段階だけ。額は本人の state だけに出る。
  const detail = await harness.act("p1", "manager", { publicManagerId });
  assert.deepEqual(detail.card.vault, { level: 1, id: "box", label: "木箱" });
  assert.doesNotMatch(JSON.stringify(detail), /4000|vaultAmount/);
  assert.deepEqual((await harness.act("viewer", "board")).managers[0].vault, { level: 1, id: "box", label: "木箱" });
  assert.deepEqual((await harness.act("manager", "state")).profile.vault, { qualified: true, amount: 4_000, tier: 1, bestTier: 3 });

  // 金庫番付: 段階の高い順、同じ段階は先に届いた順。額は出さない。
  const otherId = await openManager(harness, "other", { personaName: "サキ", disclosure: "undisclosed", entryFee: 0 });
  harness.firestore.write("tributeProfiles/other", { ...harness.firestore.read("tributeProfiles/other"), vaultQualifiedAt: 1, vaultAmount: 30_000, vaultTier: 4, vaultTierAt: harness.now(), vaultBestTier: 4 });
  const ranking = (await harness.act("viewer", "vault")).ranking;
  assert.deepEqual(ranking.map((row) => [row.publicManagerId, row.vault.label]), [[otherId, "宝物庫"], [publicManagerId, "木箱"]]);
  assert.doesNotMatch(JSON.stringify(ranking), /30000|4000|amount/);

  // 金庫の飾りは、届いた段階まで使える（ストアでは買えない）。
  harness.advance(2_100);
  await harness.act("manager", "save_profile", { card: { ...card, frame: "kura", frameColor: "pink", sealShape: "senryo", sealInk: "kogane" }, accepting: true });
  harness.advance(2_100);
  await rejects(harness.act("manager", "save_profile", { card: { ...card, frame: "houmotsu" }, accepting: true }), /金庫が「宝物庫」に届くと使えます/);
  assert.equal((await harness.act("manager", "decorations")).vaultBestTier, 3);
  assert.equal((await harness.act("viewer", "manager", { publicManagerId })).card.frame, "kura");

  // 終わった牧場基金の操作は、読み込み直すよう伝える。
  for (const action of ["fund", "offer", "vote", "recommend", "unrecommend"]) {
    await rejects(harness.act("manager", action, {}), /牧場基金は終わり、管理人の金庫に変わりました/);
  }
  assert.equal((await harness.act("viewer", "board")).recommended, undefined, "the board has no recommended shelf");
});

test("the ended fund's honors become limited achievements once, with the lower honors too", async () => {
  const harness = createHarness();
  const card = { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 0, sigil: 2 };
  await openManager(harness, "manager", card);
  harness.firestore.write("tributeHonors/2026-10__manager", { uid: "manager", monthKey: "2026-10", offered: 1_600, tierId: "grand_offerer" });
  const state = await harness.act("manager", "state");
  const honors = (ids) => ids.filter((id) => id.startsWith("tribute_honor_")).sort();
  assert.deepEqual(honors(state.achievements.unlocked), ["tribute_honor_grand_offerer", "tribute_honor_offerer"]);
  assert.deepEqual(honors(state.achievements.newlyUnlocked), ["tribute_honor_grand_offerer", "tribute_honor_offerer"]);
  assert.equal(harness.firestore.read("tributeProfiles/manager").honorRecordsChecked, true);

  // 確かめるのは一度だけ（基金は終わっているので、あとから称号は増えない）。
  harness.firestore.write("tributeHonors/2026-09__manager", { uid: "manager", monthKey: "2026-09", offered: 6_000, tierId: "master" });
  assert.deepEqual(honors((await harness.act("manager", "state")).achievements.unlocked), ["tribute_honor_grand_offerer", "tribute_honor_offerer"]);

  // 限定称号は、牧場のカードに出せる。
  harness.advance(2_100);
  const saved = await harness.act("manager", "save_profile", { card: { ...card, achievements: ["tribute_honor_grand_offerer"] }, accepting: true });
  assert.deepEqual(saved.profile.card.achievements, ["tribute_honor_grand_offerer"]);
  // 称号のない人には何も付かない。
  await openManager(harness, "plain", { ...card, personaName: "サキ" });
  assert.deepEqual(honors((await harness.act("plain", "state")).achievements.unlocked), []);
});

test("the manager ranking puts the ranking points (500 per wallet per day) first and the number of wallets second", async () => {
  const harness = createHarness({ balances: { whale: 5_000, p1: 1_000, p2: 1_000, p3: 1_000, p4: 1_000 } });
  await confirmAge(harness, "viewer");
  const daily = { caps: { perTribute: 1_000, perDay: 1_000, total: 10_000 } };
  const many = await openManager(harness, "many", { personaName: "サキ", entryFee: 0 });
  const steady = await openManager(harness, "steady", { personaName: "ミオ様", entryFee: 0 });
  const tribute = (payer, contractId, amount) => harness.act(payer, "tribute", { contractId, kind: "silent", amount, clientRequestId: nextRequestId() });

  // サキ: 3人の財布が少しずつ。ミオ様: 1人の財布が毎日満額。
  for (const payer of ["p1", "p2", "p3"]) {
    const contractId = await startContract(harness, "many", payer, many, daily, 0);
    await tribute(payer, contractId, 30);
  }
  const whaleContract = await startContract(harness, "steady", "whale", steady, daily, 0);
  await tribute("whale", whaleContract, 800);
  const order = async () => (await harness.act("viewer", "rankings")).managers.map((row) => [row.personaName, row.payers, row.rankScore]);
  assert.deepEqual(await order(), [["ミオ様", 1, 500], ["サキ", 3, 90]], "800 Pay in one day counts as 500");

  harness.advance(DAY);
  await tribute("whale", whaleContract, 500);
  assert.deepEqual(await order(), [["ミオ様", 1, 1_000], ["サキ", 3, 90]], "every day at the full 500 keeps the manager on top");

  // 番付加算が同じなら、財布の人数が多い方が上。
  const p4Contract = await startContract(harness, "many", "p4", many, daily, 0);
  await tribute("p4", p4Contract, 500);
  harness.advance(DAY);
  await tribute("p4", p4Contract, 410);
  assert.deepEqual(await order(), [["サキ", 4, 1_000], ["ミオ様", 1, 1_000]]);
});

test("rankings show only opted-in wallet names and cap ranking points per pair per day", async () => {
  const harness = createHarness({ balances: { manager: 0, p1: 5_000, p2: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const big = { caps: { perTribute: 1_000, perDay: 3_000, total: 10_000 } };
  const c1 = await startContract(harness, "manager", "p1", publicManagerId, { ...big, walletName: "見せる財布" }, 0);
  const c2 = await startContract(harness, "manager", "p2", publicManagerId, { ...big, rankOptIn: false, walletName: "隠れ財布" }, 0);
  await harness.act("p1", "tribute", { contractId: c1, kind: "silent", amount: 1_000, clientRequestId: nextRequestId() });
  await harness.act("p2", "tribute", { contractId: c2, kind: "silent", amount: 300, clientRequestId: nextRequestId() });
  const rankings = await harness.act("p1", "rankings", { publicManagerId });
  assert.deepEqual(rankings.managerBoard.month.map((row) => [row.walletName, row.amount, row.mine]), [["見せる財布", 1_000, true]]);
  assert.equal(rankings.managers.length, 1);
  assert.equal(rankings.managers[0].payers, 2);
  assert.equal(rankings.managers[0].rankScore, 500 + 300, "ranking points are capped at 500 per pair per day");
  assert.equal(rankings.managers[0].uid, undefined);
  const ledger = await harness.act("p1", "ledger");
  assert.equal(ledger.asPayer[0].counterpartName, "ミオ様");
  assert.equal(ledger.asPayer[0].total, 1_000);
  const managerLedger = await harness.act("manager", "ledger");
  assert.deepEqual(managerLedger.asManager.map((row) => row.counterpartName).sort(), ["見せる財布", "隠れ財布"].sort());
});

test("three distinct severe reports in a month hide a manager card from the board", async () => {
  const harness = createHarness({ balances: { manager: 0, p1: 100, p2: 100, p3: 100 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  for (const payer of ["p1", "p2", "p3"]) {
    const contractId = await startContract(harness, "manager", payer, publicManagerId, {}, 0);
    await harness.act(payer, "report_user", { contractId, reason: "external_trade" });
    const duplicate = await harness.act(payer, "report_user", { contractId, reason: "threat" });
    assert.equal(duplicate.duplicate, true);
  }
  await confirmAge(harness, "viewer");
  assert.equal((await harness.act("viewer", "board")).managers.length, 0);
  await rejects(harness.act("viewer", "manager", { publicManagerId }), /見つかりません/);
});

test("report balance is server-filled and report requests need the payer's permission", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 777 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { allowReportRequests: false }, 0);
  await rejects(harness.act("manager", "request_report", { contractId }), /求められません/);
  await harness.act("payer", "report_balance", { contractId, walletBalance: 999_999 });
  const report = harness.events(contractId).find((event) => event.type === "report");
  assert.equal(report.walletBalance, 777);
  assert.equal(report.escrowBalance, 0);
});

test("unread counts follow events and reading does not reorder the contract list", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("manager", "message", { contractId, text: "返事は？" });
  const before = harness.contract(contractId);
  const state = await harness.act("payer", "state");
  const view = state.contracts.find((entry) => entry.contractId === contractId);
  assert.ok(view.unread >= 2);
  harness.advance(5_000);
  await harness.act("payer", "mark_read", { contractId, seq: view.eventSeq });
  const after = harness.contract(contractId);
  assert.equal(after.updatedAt, before.updatedAt);
  const reread = (await harness.act("payer", "state")).contracts.find((entry) => entry.contractId === contractId);
  assert.equal(reread.unread, 0);
});

function achievementProfile(harness, uid) {
  return harness.firestore.read(`achievementProfiles/${uid}`) || { unlocked: {}, pendingUnlocks: {} };
}

function tributeStats(harness, uid) {
  return harness.firestore.read(`tributeAchievementStats/${uid}`) || {};
}

test("ranch achievements count each pair once per JST day on both sides and unlock inside the tribute", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  await confirmAge(harness, "payer");
  const applied = await harness.act("payer", "apply", { publicManagerId, expectedEntryFee: 10, application: BASE_APPLICATION });
  const contractId = applied.contract.contractId;
  const accepted = await harness.act("manager", "accept", { contractId });
  assert.deepEqual(accepted.newlyUnlocked, ["tribute_manager_1"], "the entry fee is the manager's first counted tribute");
  assert.equal(tributeStats(harness, "manager").managerPairDays, 1);
  assert.equal(tributeStats(harness, "payer").walletPairDays, 1);
  assert.ok(achievementProfile(harness, "payer").unlocked.tribute_wallet_1, "the payer unlocks in the same transaction");

  const sameDay = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId: nextRequestId() });
  assert.equal(sameDay.newlyUnlocked, undefined);
  assert.equal(tributeStats(harness, "payer").walletPairDays, 1, "a second tribute to the same manager on the same day is not counted");
  assert.equal(tributeStats(harness, "manager").managerPairDays, 1);

  harness.advance(DAY);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  harness.advance(DAY - 60_000);
  const third = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  assert.deepEqual(third.newlyUnlocked, ["tribute_wallet_3"]);
  assert.equal(tributeStats(harness, "payer").walletPairDays, 3);
  const managerProfile = achievementProfile(harness, "manager");
  assert.ok(managerProfile.unlocked.tribute_manager_3);
  assert.ok(managerProfile.pendingUnlocks.tribute_manager_3, "the manager sees the unlock on the next visit");
  assert.deepEqual(
    harness.achievementSyncs.map((entry) => entry.uid),
    ["manager", "payer", "manager", "payer"],
    "public showcases are refreshed for each side that unlocked (accept, then the third day)",
  );
  assert.ok(harness.achievementSyncs.some((entry) => entry.uid === "manager" && entry.unlocked.includes("tribute_manager_3")));

  const managerState = await harness.act("manager", "state");
  assert.deepEqual(managerState.achievements.stats, { managerPairDays: 3, walletPairDays: 0 });
  assert.deepEqual(managerState.achievements.newlyUnlocked.sort(), ["tribute_manager_1", "tribute_manager_3"].sort());
  assert.deepEqual(managerState.achievements.unlocked.sort(), ["tribute_manager_1", "tribute_manager_3"].sort());
});

test("an escrow take counts for both sides as that day's tribute and reports the unlock to the manager", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("payer", "escrow_deposit", { contractId, amount: 300, clientRequestId: nextRequestId() });
  assert.equal(tributeStats(harness, "payer").walletPairDays || 0, 0, "deposits are not tributes");
  const taken = await harness.act("manager", "escrow_take", { contractId, amount: 30, clientRequestId: nextRequestId() });
  assert.deepEqual(taken.newlyUnlocked, ["tribute_manager_1"]);
  assert.equal(tributeStats(harness, "payer").walletPairDays, 1);
  assert.ok(achievementProfile(harness, "payer").pendingUnlocks.tribute_wallet_1);
});

test("first use backfills only what the ledger proves, without double counting later tributes", async () => {
  const harness = createHarness({ balances: { manager: 0, veteran: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  await confirmAge(harness, "veteran");
  harness.firestore.write("tributePairs/old1__veteran", {
    managerUid: "old1", payerUid: "veteran", count: 5, total: 50, firstAt: START - 3 * DAY, lastAt: START - DAY, rankDayKey: jstDateKey(START - DAY),
  });
  harness.firestore.write("tributePairs/old2__veteran", {
    managerUid: "old2", payerUid: "veteran", count: 4, total: 40, firstAt: START - 2 * DAY, lastAt: START - 2 * DAY + 1_000, rankDayKey: jstDateKey(START - 2 * DAY),
  });
  harness.firestore.write("tributePairs/veteran__stranger", {
    managerUid: "veteran", payerUid: "stranger", count: 0, total: 0, firstAt: 0, lastAt: 0,
  });
  const first = await harness.act("veteran", "state");
  assert.deepEqual(first.achievements.stats, { managerPairDays: 0, walletPairDays: 3 }, "2 proven days for old1, 1 for old2, none for an unpaid pair");
  assert.deepEqual(first.achievements.newlyUnlocked.sort(), ["tribute_wallet_1", "tribute_wallet_3"].sort());
  assert.equal(tributeStats(harness, "veteran").historyBackfilled, true);

  const contractId = await startContract(harness, "manager", "veteran", publicManagerId, {}, 0);
  await harness.act("veteran", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  const again = await harness.act("veteran", "state");
  assert.equal(again.achievements.stats.walletPairDays, 4, "the new pair counts once and the backfill does not run again");
});

test("level ten is reachable on both sides at the exact final thresholds", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  harness.firestore.write("tributeAchievementStats/manager", { schemaVersion: 1, managerPairDays: 9_999, walletPairDays: 0, historyBackfilled: true });
  harness.firestore.write("tributeAchievementStats/payer", { schemaVersion: 1, managerPairDays: 0, walletPairDays: 999, historyBackfilled: true });
  const result = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  assert.ok(result.newlyUnlocked.includes("tribute_wallet_1000"));
  assert.ok(result.newlyUnlocked.includes("tribute_wallet_365"));
  assert.ok(achievementProfile(harness, "manager").unlocked.tribute_manager_10000);
  assert.equal(tributeStats(harness, "payer").walletPairDays, 1_000);
  assert.equal(tributeStats(harness, "manager").managerPairDays, 10_000);
});

test("a manager can add, show and remove an optional X profile; payers see it on the board and the card", async () => {
  const harness = createHarness();
  await confirmAge(harness, "manager");
  const saved = await harness.act("manager", "save_profile", {
    card: { personaName: "ミオ様", intro: "", disclosure: "nekama", style: "harsh", entryFee: 0, xProfile: "https://x.com/mio_sama" },
    accepting: true,
  });
  assert.equal(saved.profile.card.xHandle, "mio_sama");
  assert.equal(harness.firestore.read("tributeProfiles/manager").card.xHandle, "mio_sama", "only the username is stored");
  await confirmAge(harness, "viewer");
  const board = await harness.act("viewer", "board");
  assert.equal(board.managers[0].xHandle, "mio_sama");
  const detail = await harness.act("viewer", "manager", { publicManagerId: saved.profile.publicManagerId });
  assert.equal(detail.card.xHandle, "mio_sama");

  harness.advance(2_100);
  await rejects(harness.act("manager", "save_profile", {
    card: { personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0, xProfile: "https://x.com/mio_sama/status/1" },
    accepting: true,
  }), /https:\/\/x\.com\/ユーザー名/);
  harness.advance(2_100);
  const cleared = await harness.act("manager", "save_profile", {
    card: { personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0, xProfile: "" },
    accepting: true,
  });
  assert.equal(cleared.profile.card.xHandle, "");

  harness.firestore.write("tributeProfiles/manager", {
    ...harness.firestore.read("tributeProfiles/manager"),
    card: { ...harness.firestore.read("tributeProfiles/manager").card, xHandle: "bad handle/../" },
  });
  assert.equal((await harness.act("viewer", "board")).managers[0].xHandle, "", "a malformed stored value is never returned");
});

for (const avatar of [7, 24, 29, 30, 35]) test(`manager icon ${avatar} reaches the board, the card, contracts, receipts and the ranking`, async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { avatar });
  assert.equal(harness.firestore.read("tributeProfiles/manager").card.avatar, avatar);
  await confirmAge(harness, "payer");
  assert.equal((await harness.act("payer", "board")).managers[0].avatar, avatar);
  assert.equal((await harness.act("payer", "manager", { publicManagerId })).card.avatar, avatar);
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  assert.equal(harness.contract(contractId).managerCard.avatar, avatar, "the contract keeps the icon it was signed with");
  const receipts = await harness.act("payer", "receipts");
  assert.equal(receipts.receipts[0].avatar, avatar);
  const rankings = await harness.act("payer", "rankings");
  assert.equal(rankings.managers[0].avatar, avatar);
  const state = await harness.act("payer", "state");
  assert.equal(state.contracts.find((contract) => contract.contractId === contractId).manager.avatar, avatar);

  harness.advance(2_100);
  const changed = await harness.act("manager", "save_profile", {
    card: { personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 10, avatar: 99 },
    accepting: true,
  });
  assert.equal(changed.profile.card.avatar, 0, "an unknown icon falls back to the letter sigil");
  harness.firestore.write("tributeProfiles/manager", {
    ...harness.firestore.read("tributeProfiles/manager"),
    card: { ...harness.firestore.read("tributeProfiles/manager").card, avatar: "../../evil" },
  });
  assert.equal((await harness.act("payer", "board")).managers[0].avatar, 0, "a malformed stored value is never returned");
});

test("named fees need the payer's consent for sexual names, are counted per contract, and void when consent is withdrawn", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  assert.equal(harness.contract(contractId).allowSexualPurposes, false, "consent is off by default");
  await rejects(harness.act("manager", "request", { contractId, amount: 50, purpose: "edging" }), /性的な名目を許していません/);
  await rejects(harness.act("manager", "request", { contractId, amount: 50, purpose: "bogus" }), /名目を選び直して/);
  const managed = await harness.act("manager", "request", { contractId, amount: 50, purpose: "management" });
  await harness.act("payer", "tribute", { contractId, kind: "request", requestId: managed.requestId, amount: 50, clientRequestId: nextRequestId() });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, purpose: "release", clientRequestId: nextRequestId() }), /性的な名目を許していません/);
  await rejects(harness.act("manager", "set_purposes", { contractId, allowSexualPurposes: true }), /この操作はできません/, "the manager cannot grant it");

  await harness.act("payer", "set_purposes", { contractId, allowSexualPurposes: true });
  harness.advance(2_100);
  const edging = await harness.act("manager", "request", { contractId, amount: 30, purpose: "edging", note: "まだダメ" });
  const paid = await harness.act("payer", "tribute", { contractId, kind: "request", requestId: edging.requestId, amount: 30, clientRequestId: nextRequestId() });
  assert.equal(paid.receipt.purpose, "edging", "the request's name travels to the receipt");
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, purpose: "edging", clientRequestId: nextRequestId() });
  assert.deepEqual(harness.contract(contractId).purposeCounts, { management: 1, edging: 2 });
  assert.deepEqual(paid.contract.purposeCounts, { management: 1, edging: 1 });
  harness.advance(2_100);
  const release = await harness.act("manager", "request", { contractId, amount: 30, purpose: "release" });
  assert.equal((await harness.act("payer", "state")).contracts[0].pendingRequests[0].purpose, "release");

  const withdrawn = await harness.act("payer", "set_purposes", { contractId, allowSexualPurposes: false });
  assert.equal(withdrawn.contract.allowSexualPurposes, false);
  assert.deepEqual(withdrawn.contract.pendingRequests, [], "pending sexual-name requests are voided at once");
  assert.deepEqual(withdrawn.contract.purposeCounts, { management: 1 }, "sexual counts are no longer shown");
  const tail = harness.events(contractId).slice(-2);
  assert.deepEqual(tail.map((event) => [event.type, event.reason ?? event.allowSexualPurposes]), [["purposes_changed", false], ["request_cancelled", "purpose"]]);
  assert.equal(tail[1].requestId, release.requestId);
  await rejects(harness.act("payer", "tribute", { contractId, kind: "request", requestId: release.requestId, amount: 30, clientRequestId: nextRequestId() }), /残っていません/);
  const unchanged = await harness.act("payer", "set_purposes", { contractId, allowSexualPurposes: false });
  assert.equal(unchanged.unchanged, true);
  const applied = harness.events(contractId)[0];
  assert.equal(applied.allowSexualPurposes, false, "the manager sees the consent in the application");
});

test("the manager receives each payer tribute once, may add a reward, and the payer's receipt records it", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000, p2: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  const entryEvent = harness.events(contractId).find((event) => event.type === "tribute" && event.kind === "entry");
  assert.ok(entryEvent.receivedAt > 0, "the entry fee counts as received when the manager accepts");
  await rejects(harness.act("manager", "receive", { contractId, tributeSeq: entryEvent.seq }), /受け取れる献上が見つかりません/);

  const given = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId: nextRequestId() });
  assert.equal(given.contract.awaitingReceipt, 1, "both sides can see that the tribute waits to be received");
  const managerView = (await harness.act("manager", "state")).contracts.find((contract) => contract.contractId === contractId);
  assert.equal(managerView.awaitingReceipt, 1);
  const tribute = harness.events(contractId).at(-1);
  assert.equal(tribute.type, "tribute");
  assert.equal(tribute.receiptId, given.receipt.receiptId);
  assert.equal(tribute.receivedAt, undefined);

  await rejects(harness.act("payer", "receive", { contractId, tributeSeq: tribute.seq, reward: "gohoubi" }), /この操作はできません/);
  // 契約の強さは財布が決めた上限。辛口までの契約では甘めのご褒美も選べるが、一覧にないご褒美は選べない（2026-10-27）。
  await rejects(harness.act("manager", "receive", { contractId, tributeSeq: tribute.seq, reward: "bogus" }), /選べません/, "an unknown reward is refused");
  await rejects(harness.act("manager", "receive", { contractId, tributeSeq: 999 }), /受け取れる献上が見つかりません/);
  const balanceBefore = harness.balance("manager");
  harness.advance(60_000);
  const received = await harness.act("manager", "receive", { contractId, tributeSeq: tribute.seq, reward: "gohoubi" });
  assert.equal(harness.balance("manager"), balanceBefore, "receiving moves no Pay");
  assert.equal(received.contract.rewardCount, 1);
  assert.equal(received.contract.awaitingReceipt, 0);
  const marked = harness.events(contractId).find((event) => event.seq === tribute.seq);
  assert.equal(marked.reward, "gohoubi");
  assert.ok(marked.receivedAt > tribute.createdAt);
  const last = harness.events(contractId).at(-1);
  assert.deepEqual([last.type, last.actor, last.tributeSeq, last.reward, last.amount], ["received", "manager", tribute.seq, "gohoubi", 50]);
  const receipt = (await harness.act("payer", "receipts")).receipts.find((row) => row.receiptId === given.receipt.receiptId);
  assert.equal(receipt.reward, "gohoubi");
  assert.equal(receipt.receivedAt, marked.receivedAt);
  await rejects(harness.act("manager", "receive", { contractId, tributeSeq: tribute.seq }), /もう受け取っています/);
  const payerState = (await harness.act("payer", "state")).contracts.find((contract) => contract.contractId === contractId);
  assert.equal(payerState.unread > 0, true, "the payer sees the reward as unread");

  const plain = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  const plainEvent = harness.events(contractId).at(-1);
  await harness.act("manager", "receive", { contractId, tributeSeq: plainEvent.seq });
  assert.equal(harness.events(contractId).at(-1).reward, undefined);
  assert.equal(harness.contract(contractId).rewardCount, 1, "receiving without a reward is not counted as one");
  assert.ok(plain.receipt.receiptId);

  const ngContract = await startContract(harness, "manager", "p2", publicManagerId, { ngWords: ["ざこ"] });
  await harness.act("p2", "tribute", { contractId: ngContract, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  const ngTribute = harness.events(ngContract).at(-1);
  await rejects(harness.act("manager", "receive", { contractId: ngContract, tributeSeq: ngTribute.seq, reward: "zako" }), /選べません/, "a reward that contains the payer's NG word is refused");
  await harness.act("p2", "terminate", { contractId: ngContract });
  await rejects(harness.act("manager", "receive", { contractId: ngContract, tributeSeq: ngTribute.seq }), /終了しています/, "nothing is sent after the payer leaves");
});

test("collar numbers are given per pair on acceptance, kept on renewal, never reused, and backfilled on the next tribute", async () => {
  const harness = createHarness({ balances: { manager: 0, p1: 1_000, p2: 1_000, p3: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const first = await startContract(harness, "manager", "p1", publicManagerId, {}, 0);
  const second = await startContract(harness, "manager", "p2", publicManagerId, {}, 0);
  assert.equal(harness.contract(first).collarNo, 1);
  assert.equal(harness.contract(second).collarNo, 2);
  assert.equal(harness.events(first).find((event) => event.type === "accepted").collarNo, 1);
  assert.equal((await harness.act("p2", "state")).contracts[0].collarNo, 2);
  await harness.act("p1", "terminate", { contractId: first });
  harness.advance(31_000);
  const renewed = await startContract(harness, "manager", "p1", publicManagerId, {}, 0);
  assert.equal(harness.contract(renewed).collarNo, 1, "a returning wallet keeps its number");
  const third = await startContract(harness, "manager", "p3", publicManagerId, {}, 0);
  assert.equal(harness.contract(third).collarNo, 3, "numbers are never reused");
  const given = await harness.act("p3", "tribute", { contractId: third, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  assert.equal(given.receipt.collarNo, 3);
  assert.equal((await harness.act("p3", "receipts")).receipts[0].collarNo, 3);

  // このリリースより前の契約（番号なし）は、次の献上で番号が付く。
  const legacy = harness.contract(second);
  delete legacy.collarNo;
  harness.firestore.write(`tributeContracts/${second}`, legacy);
  const pair = harness.firestore.read("tributePairs/manager__p2");
  delete pair.collarNo;
  harness.firestore.write("tributePairs/manager__p2", pair);
  await harness.act("p2", "tribute", { contractId: second, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  assert.equal(harness.contract(second).collarNo, 4);
  assert.equal(harness.firestore.read("tributePairs/manager__p2").collarNo, 4);
});

test("the manager presses one of their registered seals, which is stamped on the event and the payer's receipt", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000, p2: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0, seals: ["zako", "yoku"] });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  const given = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 30, clientRequestId: nextRequestId() });
  const tribute = harness.events(contractId).at(-1);
  await harness.act("manager", "receive", { contractId, tributeSeq: tribute.seq, seal: "zako", reward: "zako" });
  assert.equal(harness.events(contractId).find((event) => event.seq === tribute.seq).seal, "zako");
  assert.equal(harness.events(contractId).at(-1).seal, "zako");
  const receipt = (await harness.act("payer", "receipts")).receipts.find((row) => row.receiptId === given.receipt.receiptId);
  assert.equal(receipt.seal, "zako");

  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 30, clientRequestId: nextRequestId() });
  const unregistered = harness.events(contractId).at(-1);
  await harness.act("manager", "receive", { contractId, tributeSeq: unregistered.seq, seal: "gokaku" });
  assert.equal(harness.events(contractId).find((event) => event.seq === unregistered.seq).seal, "zako", "an unregistered seal becomes the first registered one");

  const ngContract = await startContract(harness, "manager", "p2", publicManagerId, { ngWords: ["雑魚"] }, 0);
  await harness.act("p2", "tribute", { contractId: ngContract, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  const ngTribute = harness.events(ngContract).at(-1);
  await harness.act("manager", "receive", { contractId: ngContract, tributeSeq: ngTribute.seq, seal: "zako" });
  assert.equal(harness.events(ngContract).find((event) => event.seq === ngTribute.seq).seal, "juryo", "a seal with the payer's NG word becomes 受領");

  const profile = (await harness.act("manager", "state")).profile;
  assert.deepEqual(profile.card.seals, ["zako", "yoku"]);
});

test("share_info gives only the payer the manager's current consent, card and their own receipt, without writing", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000, other: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0, avatar: 7 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  const otherContract = await startContract(harness, "manager", "other", publicManagerId, {}, 0);
  const given = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId: nextRequestId() });
  const otherGiven = await harness.act("other", "tribute", { contractId: otherContract, kind: "silent", amount: 20, clientRequestId: nextRequestId() });
  const before = harness.contract(contractId);

  const hidden = await harness.act("payer", "share_info", { contractId, receiptId: given.receipt.receiptId });
  assert.equal(hidden.consent, false, "a card saved without the setting does not consent");
  assert.equal(hidden.manager.personaName, "");
  assert.equal(hidden.manager.avatar, 0);
  assert.equal(hidden.manager.disclosure, "nekama", "the disclosure tag stays even when the name is hidden");
  assert.equal(hidden.collarNo, 1);
  assert.equal(hidden.walletName, "ポチ財布");
  assert.equal(hidden.receipt.receiptNo, given.receipt.receiptNo);
  assert.equal(hidden.receipt.amount, 50);

  harness.advance(2_100);
  await harness.act("manager", "save_profile", {
    card: { personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0, avatar: 7, reportConsent: true },
    accepting: true,
  });
  const shown = await harness.act("payer", "share_info", { contractId });
  assert.equal(shown.consent, true);
  assert.equal(shown.manager.personaName, "ミオ様");
  assert.equal(shown.manager.avatar, 7);
  assert.equal(shown.receipt, null);
  const foreign = await harness.act("payer", "share_info", { contractId, receiptId: otherGiven.receipt.receiptId });
  assert.equal(foreign.receipt, null, "another wallet's receipt is never returned");
  await rejects(harness.act("manager", "share_info", { contractId }), /預ける側だけ/);
  await rejects(harness.act("other", "share_info", { contractId }), /預ける側だけ/);
  await rejects(harness.act("stranger", "share_info", { contractId }), /18歳以上/);
  assert.deepEqual(harness.contract(contractId), before, "share_info writes nothing");
});

test("each side sees how far the other has read, so a payer can see a tribute that was read but not yet received", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: nextRequestId() });
  const tribute = harness.events(contractId).at(-1);
  const payerView = () => harness.act("payer", "state").then((state) => state.contracts.find((contract) => contract.contractId === contractId));
  assert.ok((await payerView()).peerReadSeq < tribute.seq);
  await harness.act("manager", "mark_read", { contractId, seq: tribute.seq });
  assert.equal((await payerView()).peerReadSeq, tribute.seq);
});

test("today's word shows on the board for 24 hours, lifts the card in the board order, and is limited to 3 a day", async () => {
  const harness = createHarness();
  await confirmAge(harness, "viewer");
  await rejects(harness.act("viewer", "set_word", { text: "こんばんは" }), /管理人カードを作ってから/);
  await rejects(harness.act("stranger", "set_word", { text: "こんばんは" }), /18歳以上/);
  const first = await openManager(harness, "m1", { personaName: "ミオ様", entryFee: 0 });
  harness.advance(60_000);
  await openManager(harness, "m2", { personaName: "サキ", entryFee: 0 });
  const order = async () => (await harness.act("viewer", "board")).managers.map((card) => card.personaName);
  assert.deepEqual(await order(), ["サキ", "ミオ様"]);

  await rejects(harness.act("m1", "set_word", { text: "今夜は寸止めデー" }), /性的な言葉は今日のひとことに書けません/);
  await rejects(harness.act("m1", "set_word", { text: "LINE交換しよ" }), /外部の連絡先/);
  harness.advance(60_000);
  const posted = await harness.act("m1", "set_word", { text: "今夜は機嫌がいい。財布は並びな。" });
  assert.equal(posted.profile.card.word.text, "今夜は機嫌がいい。財布は並びな。");
  assert.equal(posted.profile.wordsToday, 1);
  assert.deepEqual(await order(), ["ミオ様", "サキ"], "posting a word lifts the card");
  const board = await harness.act("viewer", "board");
  assert.equal(board.managers[0].word.text, "今夜は機嫌がいい。財布は並びな。");
  assert.equal(board.managers[1].word, null);
  assert.equal((await harness.act("viewer", "manager", { publicManagerId: first })).card.word.text, "今夜は機嫌がいい。財布は並びな。");
  assert.equal((await harness.act("m1", "state")).profile.wordsToday, 1);

  await harness.act("m1", "set_word", { text: "二回目" });
  await harness.act("m1", "set_word", { text: "三回目" });
  await rejects(harness.act("m1", "set_word", { text: "四回目" }), /1日3回まで/);
  const cleared = await harness.act("m1", "set_word", { clear: true });
  assert.equal(cleared.profile.card.word, null);
  assert.equal(cleared.profile.wordsToday, 3, "clearing does not give a post back");
  await rejects(harness.act("m1", "set_word", { text: "四回目" }), /1日3回まで/);

  harness.advance(24 * 60 * 60 * 1_000);
  const nextDay = await harness.act("m1", "set_word", { text: "新しい日" });
  assert.equal(nextDay.profile.wordsToday, 1, "the count resets on the next JST day");
  harness.advance(24 * 60 * 60 * 1_000);
  assert.equal((await harness.act("viewer", "board")).managers.find((card) => card.personaName === "ミオ様").word, null, "a word disappears after 24 hours");
});

test("the board lists only managers active in the last 7 days; a word, a card save or contract work brings a card back", async () => {
  const harness = createHarness({ balances: { payer: 1_000 } });
  await confirmAge(harness, "viewer");
  const week = 7 * DAY;
  const card = { personaName: "ミオ様", entryFee: 0 };
  const publicManagerId = await openManager(harness, "m1", card);
  await openManager(harness, "m2", { personaName: "サキ", entryFee: 0 });
  const names = async () => (await harness.act("viewer", "board")).managers.map((entry) => entry.personaName);
  const standing = async (uid) => (await harness.act(uid, "state")).profile;

  const opened = await standing("m1");
  assert.equal(opened.boardUntil, opened.card.lastActiveAt + week, "the manager learns until when the card stays on the board");
  assert.deepEqual(await names(), ["サキ", "ミオ様"]);

  // 7日ちょうど手前まではまだ並ぶ。ひとことを出したサキだけが延びる。
  harness.advance(week - 60_000);
  await harness.act("m2", "set_word", { text: "今夜は機嫌がいい。" });
  assert.deepEqual(await names(), ["サキ", "ミオ様"]);
  harness.advance(120_000);
  assert.deepEqual(await names(), ["サキ"], "a card without any activity for 7 days leaves the board");
  assert.ok((await standing("m1")).boardUntil < harness.now());
  assert.equal((await harness.act("viewer", "manager", { publicManagerId })).card.personaName, "ミオ様", "the invite link still opens the card");

  // カードを保存すると、掲示板の一番上に戻る。
  await harness.act("m1", "save_profile", { card: { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 0, sigil: 2 }, accepting: true });
  assert.deepEqual(await names(), ["ミオ様", "サキ"]);
  assert.equal((await standing("m1")).boardUntil, harness.now() + week);

  // どちらも7日動かなければ、掲示板は空になる。契約の中で動くと戻る。
  harness.advance(week + 60_000);
  assert.deepEqual(await names(), []);
  await startContract(harness, "m1", "payer", publicManagerId, {}, 0);
  assert.deepEqual(await names(), ["ミオ様"], "accepting an application counts as activity");

  // 受付を止めると掲示板の期限もなくなり、受付を始め直すと戻る。
  harness.advance(2_100);
  await harness.act("m2", "save_profile", { accepting: false });
  assert.equal((await standing("m2")).boardUntil, 0);
  harness.advance(2_100);
  await harness.act("m2", "save_profile", { accepting: true });
  assert.deepEqual(await names(), ["サキ", "ミオ様"]);
});

test("ranch decorations and card achievements need a purchase or an unlock, reach the board, and seal looks stay as pressed", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000, viewer: 0 } });
  const card = { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 0, sigil: 2 };
  const publicManagerId = await openManager(harness, "manager", card);
  const save = async (extra) => {
    harness.advance(2_100);
    return harness.act("manager", "save_profile", { card: { ...card, ...extra }, accepting: true });
  };
  await rejects(save({ frame: "gyokuza" }), /持っていない飾りは保存できません/);
  await rejects(save({ sealShape: "heart", sealInk: "shu" }), /持っていない飾りは保存できません/);
  assert.deepEqual((await harness.act("manager", "decorations")).owned, []);

  // 一度目の受け取りは、飾りを買う前の標準の印（日付印・朱）で残る。
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 30, clientRequestId: nextRequestId() });
  const first = harness.events(contractId).at(-1);
  await harness.act("manager", "receive", { contractId, tributeSeq: first.seq });

  for (const productId of ["ranch_frame_gyokuza", "ranch_seal_heart", "ranch_ink_sakura", "chat_frame_lace"]) {
    harness.firestore.write(`economyPurchases/manager/items/${productId}`, { productId, price: 1, createdAt: harness.now() });
  }
  harness.firestore.write("achievementProfiles/manager", { unlocked: { battle_total_10: START, tribute_manager_1: START }, pendingUnlocks: {} });
  const decorations = await harness.act("manager", "decorations");
  assert.deepEqual(decorations.owned, ["ranch_frame_gyokuza", "ranch_ink_sakura", "ranch_seal_heart"], "only ranch items are listed");
  assert.deepEqual([...decorations.achievements].sort(), ["battle_total_10", "tribute_manager_1"]);
  assert.deepEqual((await harness.act("payer", "decorations")).owned, [], "each person sees only their own items");

  await rejects(save({ frame: "gyokuza", achievements: ["battle_total_10", "tribute_wallet_3"] }), /まだ解除していない実績/);
  await rejects(save({ frame: "kusari" }), /持っていない飾りは保存できません/);
  const saved = await save({ frame: "gyokuza", frameColor: "pink", sealShape: "heart", sealInk: "sakura", achievements: ["battle_total_10", "battle_total_10", "tribute_manager_1"] });
  assert.equal(saved.profile.card.frame, "gyokuza");
  assert.equal(saved.profile.card.frameColor, "pink", "a color of an owned frame is free");
  assert.deepEqual(saved.profile.card.achievements, ["battle_total_10", "tribute_manager_1"]);

  await confirmAge(harness, "viewer");
  const boardCard = (await harness.act("viewer", "board")).managers.find((entry) => entry.publicManagerId === publicManagerId);
  assert.deepEqual(
    { frame: boardCard.frame, frameColor: boardCard.frameColor, sealShape: boardCard.sealShape, sealInk: boardCard.sealInk, achievements: boardCard.achievements, disclosure: boardCard.disclosure, entryFee: boardCard.entryFee },
    { frame: "gyokuza", frameColor: "pink", sealShape: "heart", sealInk: "sakura", achievements: ["battle_total_10", "tribute_manager_1"], disclosure: "nekama", entryFee: 0 },
  );
  assert.equal((await harness.act("viewer", "manager", { publicManagerId })).card.frame, "gyokuza");

  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 30, clientRequestId: nextRequestId() });
  const second = harness.events(contractId).at(-1);
  await harness.act("manager", "receive", { contractId, tributeSeq: second.seq });
  const events = harness.events(contractId);
  const look = (event) => ({ sealShape: event.sealShape, sealInk: event.sealInk });
  assert.deepEqual(look(events.find((event) => event.seq === first.seq)), { sealShape: "date", sealInk: "shu" }, "an earlier receipt keeps the seal it was pressed with");
  assert.deepEqual(look(events.find((event) => event.seq === second.seq)), { sealShape: "heart", sealInk: "sakura" });
  const receipts = (await harness.act("payer", "receipts")).receipts;
  assert.deepEqual(receipts.map(look), [{ sealShape: "heart", sealInk: "sakura" }, { sealShape: "date", sealInk: "shu" }]);
  const share = await harness.act("payer", "share_info", { contractId, receiptId: second.receiptId });
  assert.deepEqual(look(share.receipt), { sealShape: "heart", sealInk: "sakura" });

  // 知らない値は標準に戻り、保存しても持ち物の確認に引っかからない。
  const recolored = await save({ frame: "gyokuza", frameColor: "kusari-only" });
  assert.equal(recolored.profile.card.frameColor, "crimson", "an unknown color becomes the frame's first color");
  const reset = await save({ frame: "<script>", frameColor: "pink", sealShape: "star", sealInk: "#000" });
  assert.deepEqual({ frame: reset.profile.card.frame, frameColor: reset.profile.card.frameColor, sealShape: reset.profile.card.sealShape, sealInk: reset.profile.card.sealInk }, { frame: "", frameColor: "", sealShape: "date", sealInk: "shu" });
});

test("screenshot consent is the payer's contract setting, shown to the manager without asking, and managers can declare posting", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000, keen: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { postsScreenshots: true });
  await confirmAge(harness, "payer");
  // 管理人の宣言「スクショを載せる」は、詳細と掲示板のカードに出る。
  assert.equal((await harness.act("payer", "manager", { publicManagerId })).card.postsScreenshots, true);
  assert.equal((await harness.act("payer", "board")).managers.find((card) => card.publicManagerId === publicManagerId).postsScreenshots, true);

  // 申し込みで選ばなければ、許していない（既定）。
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  const managerRow = () => harness.act("manager", "state").then((state) => state.contracts.find((row) => row.contractId === contractId));
  assert.equal((await managerRow()).allowScreenshots, false);
  assert.equal(harness.events(contractId)[0].allowScreenshots, false);

  // 決めるのは財布だけ。管理人は変えられない。
  await rejects(harness.act("manager", "set_screenshots", { contractId, allowScreenshots: true }), /この操作はできません/);
  const allowed = await harness.act("payer", "set_screenshots", { contractId, allowScreenshots: true });
  assert.equal(allowed.contract.allowScreenshots, true);
  assert.equal((await managerRow()).allowScreenshots, true, "the manager sees the consent as a tag, not by asking");
  assert.equal((await harness.act("payer", "set_screenshots", { contractId, allowScreenshots: true })).unchanged, true);
  await harness.act("payer", "set_screenshots", { contractId, allowScreenshots: false });
  assert.equal(harness.contract(contractId).allowScreenshots, false);
  assert.deepEqual(harness.events(contractId).filter((event) => event.type === "screenshots_changed").map((event) => [event.actor, event.allowScreenshots]), [["payer", true], ["payer", false]]);

  // 申し込みで許すと、最初から「可」。
  const keenContract = await startContract(harness, "manager", "keen", publicManagerId, { allowScreenshots: true, walletName: "撮られ財布" });
  assert.equal(harness.contract(keenContract).allowScreenshots, true);
  assert.equal(harness.events(keenContract)[0].allowScreenshots, true);

  // 宣言は外せる。
  harness.advance(2_100);
  const saved = await harness.act("manager", "save_profile", { card: { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 10, sigil: 2, postsScreenshots: false }, accepting: true });
  assert.equal(saved.profile.card.postsScreenshots, false);
});

test("managers give each wallet a private nickname that only they see, kept for the next contract, without reordering the list", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { walletName: "" });
  const managerRow = async (id = contractId) => (await harness.act("manager", "state")).contracts.find((row) => row.contractId === id);
  assert.equal((await managerRow()).payer.walletName, "名無しの財布");
  assert.equal((await managerRow()).nickname, "");
  const updatedAt = harness.contract(contractId).updatedAt;

  // 付けられるのは管理人だけ。
  await rejects(harness.act("payer", "set_nickname", { contractId, nickname: "ご主人様" }), /この操作はできません/);
  harness.advance(1_000);
  const saved = await harness.act("manager", "set_nickname", { contractId, nickname: "  ポチ  " });
  assert.equal(saved.nickname, "ポチ");
  assert.equal((await managerRow()).nickname, "ポチ");
  assert.equal(harness.contract(contractId).updatedAt, updatedAt, "the contract (and the list order) is untouched");
  assert.equal(harness.contract(contractId).nickname, undefined, "nothing is written where the payer can read");
  assert.deepEqual(harness.firestore.read("tributeProfiles/manager").payerNicknames, { payer: "ポチ" });
  assert.equal((await harness.act("manager", "set_nickname", { contractId, nickname: "ポチ" })).unchanged, true);
  assert.equal((await harness.act("manager", "set_nickname", { contractId, nickname: "x".repeat(20) })).nickname.length, 12);

  // 財布の state には呼び名が出ない。
  const payerRow = (await harness.act("payer", "state")).contracts.find((row) => row.contractId === contractId);
  assert.equal(payerRow.nickname, undefined);
  assert.doesNotMatch(JSON.stringify(await harness.act("payer", "state")), /xxxxxxxxxxxx|ポチ/);

  // 同じ財布との次の契約にも引き継ぐ。空にすると外れる。
  await harness.act("payer", "terminate", { contractId });
  harness.advance(31_000);
  const nextId = await startContract(harness, "manager", "payer", publicManagerId);
  assert.equal((await managerRow(nextId)).nickname, "x".repeat(12));
  await harness.act("manager", "set_nickname", { contractId: nextId, nickname: "" });
  assert.equal((await managerRow(nextId)).nickname, "");
  assert.equal((await managerRow(contractId)).nickname, "", "an ended contract with the same wallet follows too");
});

test("a paid or cancelled request leaves pendingRequests for good, so it cannot be paid twice (real Firestore merge)", async () => {
  // テストの偽物は本物の Firestore と同じく、merge: true で入れ子の地図を深く混ぜる（helpers/firestore-merge.cjs）。
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  const requestIds = async () => Object.keys(harness.contract(contractId).pendingRequests || {}).sort();
  harness.advance(2_100);
  await harness.act("manager", "request", { contractId, amount: 20, note: "払え" });
  harness.advance(2_100);
  await harness.act("manager", "request", { contractId, amount: 10, note: "これも" });
  const [first, second] = (await harness.act("payer", "state")).contracts.find((row) => row.contractId === contractId).pendingRequests.map((request) => request.requestId);
  assert.equal((await requestIds()).length, 2);

  const before = harness.balance("payer");
  await harness.act("payer", "tribute", { contractId, kind: "request", requestId: first, amount: 20, clientRequestId: nextRequestId() });
  assert.deepEqual(await requestIds(), [second], "the paid request is gone from the stored contract");
  await rejects(harness.act("payer", "tribute", { contractId, kind: "request", requestId: first, amount: 20, clientRequestId: nextRequestId() }), /その請求は残っていません/);
  assert.equal(harness.balance("payer"), before - 20, "paid once");

  await harness.act("manager", "cancel_request", { contractId, requestId: second });
  assert.deepEqual(await requestIds(), [], "a cancelled request is gone too");
  // 3件の上限は、残っている請求だけで数える。
  for (let index = 0; index < 3; index += 1) {
    harness.advance(2_100);
    await harness.act("manager", "request", { contractId, amount: 5 });
  }
  assert.equal((await requestIds()).length, 3);
});

test("an operator refund for the double-payment bug is claimed into the wallet with its own ledger label, as far as the wallet has room", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  await startContract(harness, "manager", "payer", publicManagerId);
  // 運営のスクリプト（grant-tribute-double-payment-refunds.cjs）が積んだ形。
  harness.firestore.write("tributeProfiles/payer", {
    ...harness.firestore.read("tributeProfiles/payer"),
    operatorRefundPending: 90,
    operatorRefundGrants: { "double-payment-x": { amount: 90, reason: "double_payment", contractId: "x", grantedAt: 1 } },
  });
  assert.equal((await harness.act("payer", "state")).profile.operatorRefundPending, 90);
  // 財布の残高上限まで、あと40しか入らない時は40だけ受け取り、残りは待つ。
  const wallet = harness.firestore.read("wallets/payer");
  harness.firestore.write("wallets/payer", { ...wallet, maxBalance: wallet.balance + 40 });
  const first = await harness.act("payer", "claim_refund", {});
  assert.deepEqual({ amount: first.amount, operator: first.operatorAmount, escrow: first.escrowAmount, pending: first.profile.operatorRefundPending }, { amount: 40, operator: 40, escrow: 0, pending: 50 });
  harness.firestore.write("wallets/payer", { ...harness.firestore.read("wallets/payer"), maxBalance: 1_000_000 });
  const second = await harness.act("payer", "claim_refund", {});
  assert.deepEqual({ amount: second.amount, pending: second.profile.operatorRefundPending }, { amount: 50, pending: 0 });
  const refunds = harness.ledger("payer").filter((entry) => entry.kind === "tribute_operator_refund");
  assert.deepEqual(refunds.map((entry) => [entry.delta, entry.labelKey, entry.details.reason]), [[40, "anju_pay_tribute_operator_refund", "double_payment"], [50, "anju_pay_tribute_operator_refund", "double_payment"]]);
  assert.equal(new Set(refunds.map((entry) => entry.entryId)).size, 2, "each claim is its own ledger entry");
  const third = await harness.act("payer", "claim_refund", {});
  assert.equal(third.amount, 0);
  // 管理人の残高には触れない。
  assert.equal(harness.ledger("manager").some((entry) => entry.kind === "tribute_operator_refund"), false);
});

test("a manager's last activity reaches others only when the manager chose to show it, and the board keeps its activity order", async () => {
  const harness = createHarness({ balances: { payer: 1_000 } });
  const quiet = await openManager(harness, "quiet", { personaName: "シズ", entryFee: 0 });
  const open = await openManager(harness, "open", { personaName: "ミオ様", entryFee: 0, showsActivity: true });
  await confirmAge(harness, "payer");
  const boardCard = async (id) => (await harness.act("payer", "board")).managers.find((card) => card.publicManagerId === id);

  // 初期は出さない。出さないカードは、掲示板にも詳細にも時刻が届かない。
  for (const card of [await boardCard(quiet), (await harness.act("payer", "manager", { publicManagerId: quiet })).card]) {
    assert.equal(card.showsActivity, false);
    assert.equal(card.lastActiveAt, 0);
  }
  const shown = await boardCard(open);
  assert.equal(shown.showsActivity, true);
  assert.equal(shown.lastActiveAt, harness.firestore.read("tributeProfiles/open").lastActiveAt);
  assert.equal((await harness.act("payer", "manager", { publicManagerId: open })).card.lastActiveAt, shown.lastActiveAt);

  // 自分のカードには、出さない設定でも自分の時刻が入る（掲示板に出ていられる期限と同じもと）。
  const own = (await harness.act("quiet", "state")).profile;
  assert.equal(own.card.showsActivity, false);
  assert.equal(own.card.lastActiveAt, harness.firestore.read("tributeProfiles/quiet").lastActiveAt);
  assert.ok(own.card.lastActiveAt > 0);

  // 出さない管理人も、掲示板は動いた順に並ぶ。カードを保存した「シズ」が一番上に戻る。
  assert.deepEqual((await harness.act("payer", "board")).managers.map((card) => card.personaName), ["ミオ様", "シズ"]);
  harness.advance(2_100);
  const saved = await harness.act("quiet", "save_profile", { card: { personaName: "シズ", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 0, sigil: 2 }, accepting: true });
  assert.equal(saved.profile.card.showsActivity, false);
  assert.deepEqual((await harness.act("payer", "board")).managers.map((card) => card.personaName), ["シズ", "ミオ様"]);
});

test("the monthly gross ranking counts only managers tributed by 3+ wallets, carries X and the ranking word, and badges the top 5 on the board", async () => {
  const { jstMonthKey } = require("../tribute-rules");
  const harness = createHarness();
  const monthKey = jstMonthKey(harness.now());
  const ids = {};
  const managers = [
    ["m1", { personaName: "ミオ様", xProfile: "@mio_sama", rankingWord: "今月も財布を募集中" }, 6, 9_000],
    ["m2", { personaName: "サキ" }, 3, 7_000],
    ["m3", { personaName: "カイ" }, 2, 20_000],
    ["m4", { personaName: "ユナ" }, 4, 3_000],
  ];
  for (const [uid, card, payers, receivedGross] of managers) {
    ids[uid] = await openManager(harness, uid, card);
    harness.firestore.write(`tributeManagerMonths/${monthKey}__${uid}`, { monthKey, managerUid: uid, payers, receivedGross, rankScore: 0 });
  }
  await confirmAge(harness, "viewer");

  // 財布2人のカイは、総額が一番でも載らない（別アカウントでの水増しを避ける）。
  const gross = await harness.act("viewer", "rankings", { kind: "gross" });
  assert.equal(gross.kind, "gross");
  assert.deepEqual(gross.managers.map((row) => [row.rank, row.personaName, row.receivedGross, row.payers]), [[1, "ミオ様", 9_000, 6], [2, "サキ", 7_000, 3], [3, "ユナ", 3_000, 4]]);
  assert.equal(gross.managers[0].xHandle, "mio_sama");
  assert.equal(gross.managers[0].rankingWord, "今月も財布を募集中");
  assert.equal(gross.managers[1].xHandle, "");
  assert.equal("managerUid" in gross.managers[0] || "uid" in gross.managers[0], false, "no UIDs");
  assert.equal((await harness.act("viewer", "rankings", {})).kind, "score", "the old ranking stays the default");

  // 掲示板と詳細には1〜5位の札。番付のひとことは掲示板のカードには載せない。
  const board = (await harness.act("viewer", "board")).managers;
  const rankOf = (name) => board.find((card) => card.personaName === name).grossRank;
  assert.deepEqual(["ミオ様", "サキ", "ユナ", "カイ"].map(rankOf), [1, 2, 3, 0]);
  assert.equal(board.find((card) => card.personaName === "ミオ様").rankingWord, undefined);
  assert.equal((await harness.act("viewer", "manager", { publicManagerId: ids.m2 })).card.grossRank, 2);
  // 自分のカードには番付のひとことが返る（カードの編集で直せる）。
  assert.equal((await harness.act("m1", "state")).profile.card.rankingWord, "今月も財布を募集中");

  // 札は10分まで前の順位を使い、過ぎると数え直す。
  harness.firestore.write(`tributeManagerMonths/${monthKey}__m4`, { monthKey, managerUid: "m4", payers: 4, receivedGross: 50_000, rankScore: 0 });
  assert.equal((await harness.act("viewer", "board")).managers.find((card) => card.personaName === "ユナ").grossRank, 3, "cached");
  harness.advance(10 * 60_000 + 1);
  assert.equal((await harness.act("viewer", "board")).managers.find((card) => card.personaName === "ユナ").grossRank, 1, "recounted");

  // 番付のひとことも、掲示板と同じく連絡先・性的な言葉は通さない。
  harness.advance(2_100);
  await rejects(harness.act("m2", "save_profile", { card: { personaName: "サキ", intro: "", disclosure: "nekama", style: "harsh", entryFee: 10, rankingWord: "エロい財布募集" }, accepting: true }), /性的な言葉/);
});

test("only wallets that tributed this month write in a manager's cheer column; managers mark them seen or hide them", async () => {
  const { jstMonthKey } = require("../tribute-rules");
  const harness = createHarness({ balances: { manager: 0, big: 2_000, small: 1_000, stranger: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const bigContract = await startContract(harness, "manager", "big", publicManagerId, { walletName: "太い財布" });
  await startContract(harness, "manager", "small", publicManagerId, { walletName: "細い財布" });
  await harness.act("big", "tribute", { contractId: bigContract, kind: "silent", amount: 100, clientRequestId: nextRequestId() });
  await confirmAge(harness, "stranger");
  const detail = (uid) => harness.act(uid, "manager", { publicManagerId });
  const unseen = async () => (await harness.act("manager", "state")).profile.cheersUnseen;

  // 貢いでいない財布は書けない。貢いだ財布（入場料も献上）は書ける。
  assert.equal((await detail("stranger")).myCheer.canWrite, false);
  await rejects(harness.act("stranger", "set_cheer", { publicManagerId, text: "応援してます" }), /今月この管理人に貢いだ財布だけ/);
  await rejects(harness.act("manager", "set_cheer", { publicManagerId, text: "自分で" }), /自分の応援欄/);
  assert.equal((await detail("small")).myCheer.canWrite, true);
  await rejects(harness.act("small", "set_cheer", { publicManagerId, text: "LINE教えて 090-1234-5678" }), /./);
  await harness.act("small", "set_cheer", { publicManagerId, text: "毎日見てます" });
  await harness.act("big", "set_cheer", { publicManagerId, text: "今月も一番に貢ぎます" });

  // 今月の献上額の多い順。額と UID は返さない。
  const cheers = (await detail("stranger")).cheers;
  assert.deepEqual(cheers.map((cheer) => [cheer.walletName, cheer.text, cheer.seen]), [["太い財布", "今月も一番に貢ぎます", false], ["細い財布", "毎日見てます", false]]);
  assert.equal(cheers.some((cheer) => "payerUid" in cheer || "amount" in cheer), false);
  assert.equal(await unseen(), 2);

  // 見たよ: 誰にでも印が見え、やることの数が減る。書き直すと、また見たよ待ち。
  const bigCheer = cheers[0].cheerId;
  assert.equal((await harness.act("manager", "cheer_seen", { cheerId: bigCheer })).cheersUnseen, 1);
  assert.equal((await detail("stranger")).cheers[0].seen, true);
  await rejects(harness.act("small", "cheer_seen", { cheerId: bigCheer }), /見つかりません/);
  await harness.act("big", "set_cheer", { publicManagerId, text: "書き直しました" });
  assert.equal((await detail("stranger")).cheers[0].seen, false);
  assert.equal(await unseen(), 2);

  // 隠す: 管理人と書いた財布にだけ見える。戻すと、また誰にでも見える。
  const smallCheer = (await detail("manager")).cheers.find((cheer) => cheer.walletName === "細い財布").cheerId;
  assert.equal((await harness.act("manager", "cheer_hide", { cheerId: smallCheer })).cheersUnseen, 1);
  assert.deepEqual((await detail("stranger")).cheers.map((cheer) => cheer.walletName), ["太い財布"]);
  assert.equal((await detail("small")).cheers.find((cheer) => cheer.mine).hidden, true);
  assert.equal((await detail("manager")).cheers.find((cheer) => cheer.cheerId === smallCheer).hidden, true);
  // 隠した応援は、書き直しても隠れたまま（その月のあいだ）。
  await harness.act("small", "set_cheer", { publicManagerId, text: "もう一度" });
  assert.deepEqual((await detail("stranger")).cheers.map((cheer) => cheer.walletName), ["太い財布"]);
  assert.equal(await unseen(), 1);
  await harness.act("manager", "cheer_show", { cheerId: smallCheer });
  assert.equal((await detail("stranger")).cheers.length, 2);
  assert.equal(await unseen(), 2);

  // 1日3回まで（日本時間の0時に戻る）。消すのは数えない。
  await harness.act("small", "set_cheer", { publicManagerId, text: "3回目" });
  assert.equal((await detail("small")).myCheer.leftToday, 0);
  await rejects(harness.act("small", "set_cheer", { publicManagerId, text: "4回目" }), /1日3回まで/);
  await harness.act("small", "set_cheer", { publicManagerId, text: "" });
  assert.equal((await detail("stranger")).cheers.length, 1);
  assert.equal(await unseen(), 1);

  // 月が変わると応援欄は空になり、その月に貢ぐまで書けない。やることの数も0に戻る。
  const before = jstMonthKey(harness.now());
  harness.advance(32 * 24 * 60 * 60 * 1_000);
  assert.notEqual(jstMonthKey(harness.now()), before);
  assert.deepEqual((await detail("stranger")).cheers, []);
  assert.equal((await detail("big")).myCheer.canWrite, false);
  assert.equal(await unseen(), 0);
});

// 財布の打つ手と管理人の言葉・第1段（ranch-wallet-words-v1、2026-10-27 ユーザー決定）:
// 言われたい言葉、言葉の強さは財布が決める上限、期間14日・30日、同じ条件で申し込むための管理人の公開ID。
test("wished-for words travel with the contract, the payer alone edits them and the manager can give one as a reward", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  await rejects(startContract(harness, "manager", "payer", publicManagerId, { ngWords: "ブス", wantWords: ["ブス財布"] }), /言われたくない言葉/);
  await rejects(startContract(harness, "manager", "payer", publicManagerId, { wantWords: ["ペイペイで払え"] }), /外部の決済/);
  harness.advance(31_000);
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { wantWords: ["ざこ", "3号", "ざこ", "イかせて"], durationDays: 30 });
  const stored = harness.contract(contractId);
  assert.deepEqual(stored.wantWords, ["ざこ", "3号", "イかせて"], "deduplicated; sexual words are the payer's own choice");
  assert.equal(stored.managerPublicId, publicManagerId);
  assert.equal(stored.expiresAt - stored.acceptedAt, 30 * 24 * 60 * 60 * 1_000, "30 days are offered");
  const managerView = (await harness.act("manager", "state")).contracts.find((contract) => contract.contractId === contractId);
  assert.deepEqual(managerView.wantWords, ["ざこ", "3号", "イかせて"], "the manager sees the words");
  assert.equal(managerView.durationDays, 30);
  assert.equal(managerView.managerPublicId, publicManagerId);

  // 決めるのは財布だけ。言われたくない言葉を含む語と、外部決済の言葉は登録できない。
  await rejects(harness.act("manager", "set_want_words", { contractId, wantWords: ["雑魚"] }), /この操作はできません/);
  await rejects(harness.act("payer", "set_want_words", { contractId, wantWords: ["銀行振込"] }), /外部の決済/);
  const unchanged = await harness.act("payer", "set_want_words", { contractId, wantWords: ["ざこ", "3号", "イかせて"] });
  assert.equal(unchanged.unchanged, true);
  const changed = await harness.act("payer", "set_want_words", { contractId, wantWords: ["養分", "いい子"] });
  assert.deepEqual(changed.contract.wantWords, ["養分", "いい子"]);
  const event = harness.events(contractId).at(-1);
  assert.deepEqual([event.type, event.actor, event.count], ["want_words_changed", "payer", 2]);
  assert.equal(JSON.stringify(event).includes("養分"), false, "the event does not repeat the words");

  // ご褒美: いまの言われたい言葉だけ。言葉そのものを献上・出来事・レシートに残す。
  const given = await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId: nextRequestId() });
  const tribute = harness.events(contractId).at(-1);
  await rejects(harness.act("manager", "receive", { contractId, tributeSeq: tribute.seq, reward: "word", rewardText: "ざこ" }), /いまのご褒美の候補にありません/, "a removed word is refused");
  await harness.act("manager", "receive", { contractId, tributeSeq: tribute.seq, reward: "word", rewardText: "養分" });
  const marked = harness.events(contractId).find((entry) => entry.seq === tribute.seq);
  assert.deepEqual([marked.reward, marked.rewardText], ["word", "養分"]);
  const received = harness.events(contractId).at(-1);
  assert.deepEqual([received.type, received.reward, received.rewardText], ["received", "word", "養分"]);
  assert.equal(harness.contract(contractId).rewardCount, 1);
  const receipt = (await harness.act("payer", "receipts")).receipts.find((row) => row.receiptId === given.receipt.receiptId);
  assert.deepEqual([receipt.reward, receipt.rewardText], ["word", "養分"]);
  const share = await harness.act("payer", "share_info", { contractId, receiptId: given.receipt.receiptId });
  assert.deepEqual([share.receipt.reward, share.receipt.rewardText], ["word", "養分"]);
});

test("the tone is a ceiling: a harsh contract also offers soft rewards, a sweet one never offers harsh ones", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000, sweet: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const harsh = await startContract(harness, "manager", "payer", publicManagerId, { tone: "harsh" });
  await harness.act("payer", "tribute", { contractId: harsh, kind: "silent", amount: 30, clientRequestId: nextRequestId() });
  const harshSeq = harness.events(harsh).at(-1).seq;
  await harness.act("manager", "receive", { contractId: harsh, tributeSeq: harshSeq, reward: "suki" });
  assert.equal(harness.events(harsh).at(-1).reward, "suki", "a sweet reward under a harsh ceiling");

  const sweet = await startContract(harness, "manager", "sweet", publicManagerId, { tone: "sweet" });
  await harness.act("sweet", "tribute", { contractId: sweet, kind: "silent", amount: 30, clientRequestId: nextRequestId() });
  const sweetSeq = harness.events(sweet).at(-1).seq;
  await rejects(harness.act("manager", "receive", { contractId: sweet, tributeSeq: sweetSeq, reward: "zako" }), /選べません/);
  await harness.act("manager", "receive", { contractId: sweet, tributeSeq: sweetSeq, reward: "mata" });
  assert.equal(harness.events(sweet).at(-1).reward, "mata");
});

// 財布の打つ手・第2段（ranch-hold-v1、2026-10-27 ユーザー決定）: お預けと願い出、抵抗する。
test("a hold stops silent tributes until the manager grants a plea; requests and the escrow still work", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000, other: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const old = await startContract(harness, "manager", "other", publicManagerId);
  await rejects(harness.act("manager", "hold", { contractId: old }), /お預けにできません/, "contracts without the setting never get holds");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { allowHolds: true, allowSexualPurposes: true });
  assert.equal(harness.contract(contractId).allowHolds, true);
  const act = (uid, action, data = {}) => { harness.advance(2_100); return harness.act(uid, action, { contractId, ...data }); };

  await rejects(act("payer", "plea", { amount: 30 }), /お預け中ではない/);
  await rejects(act("payer", "hold"), /この操作はできません/);
  const held = await act("manager", "hold", { note: "許すまで待て" });
  assert.deepEqual([held.contract.hold.note, harness.events(contractId).at(-1).type], ["許すまで待て", "hold"]);
  await rejects(act("manager", "hold"), /もうお預けにしています/);
  await rejects(act("payer", "tribute", { kind: "silent", amount: 30, clientRequestId: nextRequestId() }), /お預け中です/);
  // 請求に応えるのと、管理口座の出し入れは止めない。
  await act("manager", "request", { amount: 20 });
  const requestId = Object.keys(harness.contract(contractId).pendingRequests)[0];
  await act("payer", "tribute", { kind: "request", requestId, amount: 20, clientRequestId: nextRequestId() });
  await act("payer", "escrow_deposit", { amount: 50, clientRequestId: nextRequestId() });

  // 願い出: 1回の限度額まで、1件ずつ。財布の発言に数える。
  await rejects(act("payer", "plea", { amount: 300 }), /1回の限度額（100 Pay）/);
  await rejects(act("payer", "tribute", { kind: "granted", amount: 30, clientRequestId: nextRequestId() }), /許された願い出はありません/);
  await act("payer", "plea", { amount: 30, note: "貢がせてください" });
  await rejects(act("payer", "plea", { amount: 40 }), /1件ずつ/);
  await act("manager", "mark_read", { seq: harness.contract(contractId).eventSeq });
  assert.ok(harness.contract(contractId).ignoredSince > 0, "a plea read without an answer is 既読無視");
  await rejects(act("payer", "plea_grant"), /この操作はできません/);
  const denied = await act("manager", "plea_deny", { note: "まだ早い" });
  assert.equal(denied.contract.plea, null);
  assert.equal(harness.contract(contractId).ignoredSince, 0, "an answer ends 既読無視");
  assert.deepEqual([harness.events(contractId).at(-1).type, harness.events(contractId).at(-1).note], ["plea_denied", "まだ早い"]);

  // 許すと、その金額を1回だけ差し出せる（名目も願い出のまま）。
  await act("payer", "plea", { amount: 60, purpose: "management" });
  const granted = await act("manager", "plea_grant", { note: "いいよ" });
  assert.deepEqual([granted.contract.plea.granted, granted.contract.plea.amount], [true, 60]);
  await rejects(act("payer", "tribute", { kind: "granted", amount: 50, clientRequestId: nextRequestId() }), /許された金額が変わりました/);
  const given = await act("payer", "tribute", { kind: "granted", amount: 60, clientRequestId: nextRequestId() });
  const tribute = harness.events(contractId).at(-1);
  assert.deepEqual([tribute.type, tribute.kind, tribute.granted, tribute.purpose, tribute.amount], ["tribute", "silent", true, "management", 60]);
  assert.equal(given.contract.plea, null, "a grant is used once");
  assert.deepEqual([given.contract.pleaCount, given.contract.pleaGrantedCount], [2, 1]);
  const receipt = (await harness.act("payer", "receipts")).receipts.find((row) => row.receiptId === given.receipt.receiptId);
  assert.equal(receipt.granted, true);
  await rejects(act("payer", "tribute", { kind: "silent", amount: 30, clientRequestId: nextRequestId() }), /お預け中です/, "the hold stays after the grant is used");

  // 解くと、願い出（許したものも）は消え、また自分から差し出せる。
  await act("payer", "plea", { amount: 30 });
  await act("manager", "plea_grant");
  const released = await act("manager", "unhold");
  assert.deepEqual([released.contract.hold, released.contract.plea], [null, null]);
  await act("payer", "tribute", { kind: "silent", amount: 10, clientRequestId: nextRequestId() });

  // 性的な名目の許可を外すと、その名目の願い出は消える。財布がお預けを受けるのをやめると、お預けもその場で解ける。
  await act("manager", "hold");
  await act("payer", "plea", { amount: 30, purpose: "edging" });
  await act("payer", "set_purposes", { allowSexualPurposes: false });
  assert.equal(harness.contract(contractId).plea, null);
  assert.equal(harness.events(contractId).at(-1).reason, "purpose");
  const off = await act("payer", "set_holds", { allowHolds: false });
  assert.deepEqual([off.contract.allowHolds, off.contract.hold], [false, null]);
  assert.deepEqual([harness.events(contractId).at(-1).type, harness.events(contractId).at(-1).reason], ["unhold", "setting"]);
  await rejects(act("manager", "hold"), /お預けにできません/);
});

test("a payer resists an unpaid request up to three times; it stays unpaid and the count reaches the receipt", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  const act = (uid, action, data = {}) => { harness.advance(2_100); return harness.act(uid, action, { contractId, ...data }); };
  await act("manager", "request", { amount: 40, note: "払え" });
  const requestId = Object.keys(harness.contract(contractId).pendingRequests)[0];
  await rejects(act("manager", "resist", { requestId, text: "嫌" }), /この操作はできません/);
  await rejects(act("payer", "resist", { requestId, text: "" }), /渋る一言/);
  await rejects(act("payer", "resist", { requestId, text: "ペイペイなら払う" }), /外部の決済/);
  for (const text of ["……払いたくないです。", "それだけは許して", "今日は勘弁して"]) await act("payer", "resist", { requestId, text });
  await rejects(act("payer", "resist", { requestId, text: "まだ" }), /3回まで/);
  const event = harness.events(contractId).at(-1);
  assert.deepEqual([event.type, event.actor, event.count, event.text], ["resist", "payer", 3, "今日は勘弁して"]);
  const managerView = (await harness.act("manager", "state")).contracts.find((contract) => contract.contractId === contractId);
  assert.equal(managerView.pendingRequests[0].resists, 3, "the manager sees the count");
  await act("manager", "mark_read", { seq: harness.contract(contractId).eventSeq });
  assert.ok(harness.contract(contractId).ignoredSince > 0, "a resist is a payer message");
  const paid = await act("payer", "tribute", { kind: "request", requestId, amount: 40, clientRequestId: nextRequestId() });
  assert.equal(harness.events(contractId).at(-1).resisted, 3);
  assert.equal(paid.contract.resistedTributes, 1);
  const receipt = (await harness.act("payer", "receipts")).receipts.find((row) => row.receiptId === paid.receipt.receiptId);
  assert.equal(receipt.resisted, 3);
});

// 財布の打つ手と管理人の言葉・第3段（ranch-recite-v1、2026-10-27 ユーザー決定）:
// 言葉の献上と復唱、管理人の自分の言葉（定型文・ご褒美・受取印の言葉）、延長。
test("a word offering moves no Pay, is limited to three a day and is received with a seal and the manager's own reward", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { seals: ["yoku", "word:よく貢いだ", "word:LINE交換"] });
  await rejects(harness.act("manager", "set_own_words", { ownWords: { rewards: [{ text: "ペイペイで", tone: "harsh" }] } }), /外部の決済/);
  const own = await harness.act("manager", "set_own_words", { ownWords: { lines: [{ text: "跪いて差し出しな。", tone: "harsh" }], rewards: [{ text: "上出来", tone: "normal" }, { text: "イっていいよ", tone: "harsh" }, { text: "甘いね", tone: "sweet" }] } });
  assert.deepEqual(own.profile.ownWords.rewards.map((entry) => entry.text), ["上出来", "イっていいよ", "甘いね"]);
  assert.deepEqual(harness.firestore.read("tributeProfiles/manager").card.seals, ["yoku", "word:よく貢いだ"], "a seal word with contact words is dropped");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { tone: "normal" });
  const board = await harness.act("payer", "board");
  assert.equal(JSON.stringify(board).includes("上出来"), false, "own words never reach the board");
  const act = (uid, action, data = {}) => { harness.advance(2_100); return harness.act(uid, action, { contractId, ...data }); };
  const balance = harness.balance("payer");
  await rejects(act("payer", "offer_words", { text: "" }), /差し出す言葉/);
  await rejects(act("payer", "offer_words", { text: "現金で払います" }), /外部の決済/);
  const offered = await act("payer", "offer_words", { text: "今日も負けました。\n言葉だけ置いていきます。" });
  assert.equal(harness.balance("payer"), balance, "no Pay moves");
  assert.deepEqual([offered.contract.wordOfferings, offered.contract.awaitingReceipt, offered.contract.wordOffersToday], [1, 1, 1]);
  const offering = harness.events(contractId).at(-1);
  assert.deepEqual([offering.type, offering.text], ["word_offering", "今日も負けました。\n言葉だけ置いていきます。"]);
  await act("payer", "offer_words", { text: "二つ目" });
  await act("payer", "offer_words", { text: "三つ目" });
  await rejects(act("payer", "offer_words", { text: "四つ目" }), /1日3回まで/);
  // 自分のご褒美: 強さの札が上限以下で、性的な言葉は性的な名目を許した契約でだけ。
  await rejects(act("manager", "receive", { tributeSeq: offering.seq, reward: "word", rewardText: "イっていいよ" }), /ご褒美の候補にありません/, "harsh own reward under a normal ceiling");
  const received = await act("manager", "receive", { tributeSeq: offering.seq, seal: "word:よく貢いだ", reward: "word", rewardText: "上出来" });
  const marked = harness.events(contractId).find((event) => event.seq === offering.seq);
  assert.deepEqual([marked.seal, marked.reward, marked.rewardText, marked.receivedAt > 0], ["word:よく貢いだ", "word", "上出来", true]);
  const last = harness.events(contractId).at(-1);
  assert.deepEqual([last.type, last.words, last.amount], ["received", true, 0]);
  assert.equal(received.contract.awaitingReceipt, 2);
  assert.equal(harness.contract(contractId).totalTributed, 10, "only the entry fee counts as tribute");
  await act("manager", "receive", { tributeSeq: offering.seq + 1, reward: "word", rewardText: "甘いね" });
  // 受取印の言葉は、Pay の献上のレシートにも言葉のまま残る。
  const given = await act("payer", "tribute", { kind: "silent", amount: 30, clientRequestId: nextRequestId() });
  await act("manager", "receive", { tributeSeq: harness.events(contractId).at(-1).seq, seal: "word:よく貢いだ" });
  const receipt = (await harness.act("payer", "receipts")).receipts.find((row) => row.receiptId === given.receipt.receiptId);
  assert.equal(receipt.seal, "word:よく貢いだ");
});

test("recitation: the manager sets a line and a count, the payer types it exactly, and the manager confirms it once", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  const act = (uid, action, data = {}) => { harness.advance(2_100); return harness.act(uid, action, { contractId, ...data }); };
  await rejects(act("payer", "recite_order", { text: "私は財布です。", target: 1 }), /この操作はできません/);
  await rejects(act("manager", "recite_order", { text: "イかせてください", target: 1 }), /性的な言葉を復唱させられません/);
  await rejects(act("manager", "recite_order", { text: "ブスな財布です", target: 1 }), /言われたくない言葉/);
  await rejects(act("manager", "recite_order", { text: "私は財布です。", target: 2 }), /回数/);
  await act("manager", "recite_order", { text: "私は　財布です。", target: 3 });
  await rejects(act("manager", "recite_order", { text: "もう一つ", target: 1 }), /1件ずつ/);
  await act("payer", "message", { text: "はい" });
  await act("manager", "mark_read", { seq: harness.contract(contractId).eventSeq });
  const ignoredSince = harness.contract(contractId).ignoredSince;
  await rejects(act("payer", "recite", { text: "私は財布でした。" }), /一字一句同じに/);
  const first = await act("payer", "recite", { text: "  私は 財布です。 " });
  assert.deepEqual([first.count, first.done], [1, false]);
  assert.equal(harness.contract(contractId).lastPayerMessageSeq < harness.contract(contractId).eventSeq, true, "a recitation is not a payer message");
  assert.equal(harness.contract(contractId).ignoredSince, ignoredSince);
  await rejects(act("payer", "recite", { text: "私は財布です。" }), /一字一句同じに/, "spaces collapse but are not removed");
  await act("payer", "recite", { text: "私は　財布です。" });
  await rejects(act("manager", "recite_confirm"), /確認できる復唱はありません/);
  const done = await act("payer", "recite", { text: "私は 財布です。" });
  assert.deepEqual([done.done, done.contract.recitesDone, done.contract.reciteOrder.done], [true, 1, true]);
  await rejects(act("payer", "recite", { text: "私は 財布です。" }), /復唱する一言はありません/);
  await act("manager", "recite_confirm", { seal: "yoku", reward: "zako" });
  const confirm = harness.events(contractId).at(-1);
  assert.deepEqual([confirm.type, confirm.seal, confirm.reward, harness.contract(contractId).reciteOrder], ["recite_confirm", "yoku", "zako", null]);
  assert.equal(harness.contract(contractId).ignoredSince, 0, "a reward ends 既読無視");
  await act("manager", "recite_order", { text: "もう一度", target: 1 });
  await act("manager", "recite_withdraw");
  assert.equal(harness.events(contractId).at(-1).type, "recite_withdrawn");
});

test("extension: the payer asks for days, the manager accepts from the current end or declines; managers cannot ask", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { durationDays: 3 });
  const act = (uid, action, data = {}) => { harness.advance(2_100); return harness.act(uid, action, { contractId, ...data }); };
  const end = harness.contract(contractId).expiresAt;
  await rejects(act("manager", "extend_request", { days: 7 }), /この操作はできません/);
  await rejects(act("payer", "extend_request", { days: 2 }), /日数/);
  await rejects(act("manager", "extend_accept"), /受けられる延長の申し込みはありません/);
  await act("payer", "extend_request", { days: 7 });
  await rejects(act("payer", "extend_request", { days: 14 }), /1件ずつ/);
  const managerView = (await harness.act("manager", "state")).contracts.find((contract) => contract.contractId === contractId);
  assert.equal(managerView.extension.days, 7);
  const accepted = await act("manager", "extend_accept");
  assert.equal(accepted.contract.expiresAt, end + 7 * 24 * 60 * 60 * 1_000, "extended from the current end");
  assert.equal(accepted.contract.extension, null);
  assert.equal(harness.events(contractId).at(-1).type, "extend_accepted");
  await act("payer", "extend_request", { days: 1 });
  await act("manager", "extend_decline");
  assert.equal(harness.contract(contractId).expiresAt, end + 7 * 24 * 60 * 60 * 1_000);
  await act("payer", "extend_request", { days: 30 });
  await act("payer", "extend_withdraw");
  assert.equal(harness.contract(contractId).extension, null);
});

test("withdrawing the sexual purposes permission withdraws a sexual recitation, and keeps a plain one", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, { allowSexualPurposes: true });
  const act = (uid, action, data = {}) => { harness.advance(2_100); return harness.act(uid, action, { contractId, ...data }); };
  await act("manager", "recite_order", { text: "イかせてください", target: 3 });
  await act("payer", "recite", { text: "イかせてください" });
  await act("payer", "set_purposes", { allowSexualPurposes: false });
  const withdrawn = harness.events(contractId).at(-1);
  assert.deepEqual([withdrawn.type, withdrawn.actor, withdrawn.reason], ["recite_withdrawn", "system", "purpose"]);
  assert.equal(harness.contract(contractId).reciteOrder, null);
  await rejects(act("payer", "recite", { text: "イかせてください" }), /復唱する一言はありません/);
  await rejects(act("manager", "recite_order", { text: "イかせてください", target: 1 }), /性的な言葉を復唱させられません/);
  await act("payer", "set_purposes", { allowSexualPurposes: true });
  await act("manager", "recite_order", { text: "私は財布です。", target: 1 });
  await act("payer", "set_purposes", { allowSexualPurposes: false });
  assert.equal(harness.contract(contractId).reciteOrder.text, "私は財布です。", "a plain line stays");
  assert.equal(harness.events(contractId).at(-1).type, "purposes_changed");
});
