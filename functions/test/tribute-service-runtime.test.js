"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createUgcPlayerSafetyStub } = require("./helpers/ugc-player-safety-stub");
const { createTributeService } = require("../tribute-service");
const { TRIBUTE_AGE_VERSION, jstDateKey } = require("../tribute-rules");

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
    assert.ok(["==", ">=", "<=", "<", "array-contains"].includes(operator), operator);
    return new FakeQuery(this.firestore, this.path, [...this.filters, { field, operator, value }], this.orderings, this.maximum);
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(this.firestore, this.path, this.filters, [...this.orderings, { field, direction }], this.maximum);
  }

  limit(maximum) {
    return new FakeQuery(this.firestore, this.path, this.filters, this.orderings, maximum);
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
        return candidate === filter.value;
      });
    }
    for (const ordering of [...this.orderings].reverse()) {
      rows.sort((left, right) => {
        const leftValue = left.value?.[ordering.field];
        const rightValue = right.value?.[ordering.field];
        const compared = leftValue === rightValue ? 0 : (leftValue < rightValue ? -1 : 1);
        return ordering.direction === "desc" ? -compared : compared;
      });
    }
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
    const next = options?.merge && this.documents.has(reference.path)
      ? { ...clone(this.documents.get(reference.path)), ...clone(value) }
      : clone(value);
    this.documents.set(reference.path, next);
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

test("manager wording is filtered for contact routes and the payer's NG words, and messages are rate limited", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  await rejects(harness.act("manager", "message", { contractId, text: "お前ほんとブスな財布だな" }), /言われたくない言葉/);
  await rejects(harness.act("manager", "message", { contractId, text: "ディスコードでやろ" }), /外部の連絡先/);
  await rejects(harness.act("manager", "message", { contractId, text: "明日会おうよ" }), /会う約束/);
  await rejects(harness.act("manager", "message", { contractId, text: "1000円振り込んで" }), /外部の決済|現実のお金/);
  await rejects(harness.act("manager", "message", { contractId, text: "住所教えろ" }), /個人情報/);
  await rejects(harness.act("manager", "message", { contractId, text: "晒すぞ" }), /晒し/);
  const sent = await harness.act("manager", "message", { contractId, text: "遅い。財布のくせに待たせるな。" });
  assert.ok(sent.seq > 0);
  await rejects(harness.act("manager", "message", { contractId, text: "まだ？" }), /2秒/);
  harness.advance(2_000);
  await harness.act("manager", "message", { contractId, text: "まだ？" });
  await harness.act("payer", "message", { contractId, text: "ブスって言わないで" });
  const texts = harness.events(contractId).filter((event) => event.type === "message").map((event) => [event.actor, event.text]);
  assert.deepEqual(texts, [
    ["manager", "遅い。財布のくせに待たせるな。"],
    ["manager", "まだ？"],
    ["payer", "ブスって言わないで"],
  ]);
});

test("requests and silent tributes respect per-tribute, per-day and total caps held by the payer", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager");
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  await rejects(harness.act("manager", "request", { contractId, amount: 101 }), /1回の上限/);
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
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 150, clientRequestId: nextRequestId() }), /1回の上限/);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() }), /今日の上限/);
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
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() }), /合計上限/);
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

test("only the payer can change caps: lowering is immediate and voids larger requests, raising waits for the next JST day", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 5_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  await harness.act("manager", "request", { contractId, amount: 100 });
  harness.advance(2_000);
  await harness.act("manager", "request", { contractId, amount: 30 });
  await rejects(harness.act("manager", "set_caps", { contractId, caps: { perTribute: 1_000, perDay: 5_000, total: 30_000 } }), /この操作はできません/);
  await rejects(harness.act("manager", "terminate", { contractId }), /この操作はできません/);

  const lowered = await harness.act("payer", "set_caps", { contractId, caps: { perTribute: 50, perDay: 300, total: 1_000 } });
  assert.deepEqual(lowered.contract.caps, { perTribute: 50, perDay: 300, total: 1_000 });
  assert.deepEqual(lowered.contract.pendingRequests.map((entry) => entry.amount), [30]);
  assert.ok(harness.events(contractId).some((event) => event.type === "request_cancelled" && event.reason === "caps"));

  const raised = await harness.act("payer", "set_caps", { contractId, caps: { perTribute: 300, perDay: 300, total: 1_000 } });
  assert.deepEqual(raised.contract.caps, { perTribute: 50, perDay: 300, total: 1_000 }, "raise does not apply today");
  assert.deepEqual(raised.contract.pendingCaps, { perTribute: 300, perDay: 300, total: 1_000 });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 300, clientRequestId: nextRequestId() }), /1回の上限（50 Pay）/);
  const midnight = Date.parse(`${raised.contract.pendingCapsEffectiveDateKey}T00:00:00+09:00`);
  harness.advance(midnight - harness.now() + 1);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 300, clientRequestId: nextRequestId() });
  assert.deepEqual(harness.contract(contractId).caps, { perTribute: 300, perDay: 300, total: 1_000 });
  assert.ok(harness.events(contractId).some((event) => event.type === "caps_raised"));

  await harness.act("payer", "set_caps", { contractId, caps: { perTribute: 300, perDay: 1_000, total: 3_000 } });
  const cancelled = await harness.act("payer", "cancel_raise", { contractId });
  assert.equal(cancelled.contract.pendingCaps, null);
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

  await rejects(harness.act("manager", "escrow_take", { contractId, amount: 150, clientRequestId: nextRequestId() }), /1回の上限/);
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

test("a payer holds at most three open contracts", async () => {
  const harness = createHarness({ balances: { payer: 1_000 } });
  const ids = [];
  for (const uid of ["m1", "m2", "m3", "m4"]) ids.push(await openManager(harness, uid, { entryFee: 0 }));
  await confirmAge(harness, "payer");
  await harness.act("payer", "apply", { publicManagerId: ids[0], expectedEntryFee: 0, application: BASE_APPLICATION });
  await rejects(harness.act("payer", "apply", { publicManagerId: ids[1], expectedEntryFee: 0, application: BASE_APPLICATION }), /30秒に1回/);
  for (const id of ids.slice(1, 3)) {
    harness.advance(30_000);
    await harness.act("payer", "apply", { publicManagerId: id, expectedEntryFee: 0, application: BASE_APPLICATION });
  }
  harness.advance(30_000);
  await rejects(harness.act("payer", "apply", { publicManagerId: ids[3], expectedEntryFee: 0, application: BASE_APPLICATION }), /3件まで/);
});

test("the manager's daily receive cap applies across contracts", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 2_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contractId = await startContract(harness, "manager", "payer", publicManagerId, {}, 0);
  harness.firestore.write("tributeProfiles/manager", {
    ...harness.firestore.read("tributeProfiles/manager"),
    receiveDayKey: jstDateKey(harness.now()),
    receiveDayTotal: 19_950,
  });
  await rejects(harness.act("payer", "tribute", { contractId, kind: "silent", amount: 100, clientRequestId: nextRequestId() }), /20,000 Pay/);
  await harness.act("payer", "tribute", { contractId, kind: "silent", amount: 50, clientRequestId: nextRequestId() });
});

test("offering needs Google protection and eligibility, splits 80/20, grants honors and funds first-tribute subsidies", async () => {
  const harness = createHarness({ balances: { manager: 0, p1: 2_000, p2: 2_000, p3: 2_000, p4: 2_000 } });
  const publicManagerId = await openManager(harness, "manager", { entryFee: 0 });
  const contracts = {};
  for (const payer of ["p1", "p2", "p3"]) {
    contracts[payer] = await startContract(harness, "manager", payer, publicManagerId, {}, 0);
  }
  await rejects(harness.act("manager", "offer", { amount: 300, clientRequestId: nextRequestId() }, { googleProtected: true }), /3人以上から5回以上/);
  for (const payer of ["p1", "p2", "p3", "p1", "p2"]) {
    harness.advance(10);
    await harness.act(payer, "tribute", { contractId: contracts[payer], kind: "silent", amount: 100, clientRequestId: nextRequestId() });
  }
  assert.equal(harness.balance("manager"), 475);
  await rejects(harness.act("manager", "offer", { amount: 300, clientRequestId: nextRequestId() }), /Google/);
  await rejects(harness.act("manager", "offer", { amount: 476, clientRequestId: nextRequestId() }, { googleProtected: true }), /あと 475 Pay/);
  const offered = await harness.act("manager", "offer", { amount: 300, clientRequestId: nextRequestId() }, { googleProtected: true });
  assert.deepEqual(offered.split, { burned: 240, fund: 60 });
  assert.equal(offered.honor.tier.label, "上納者");
  assert.equal(harness.balance("manager"), 175);
  const fund = await harness.act("manager", "fund", {}, { googleProtected: true });
  assert.equal(fund.fund.balance, 60);
  assert.equal(fund.me.offerable, 175);
  assert.equal(fund.me.eligible, true);
  const card = await harness.act("p1", "manager", { publicManagerId });
  assert.equal(card.card.honor.label, "上納者");

  await harness.act("manager", "vote", { policy: "first" });
  // p4 との最初の献上は手数料5のうち2が基金から戻る。
  const p4Contract = await startContract(harness, "manager", "p4", publicManagerId, {}, 0);
  await harness.act("p4", "tribute", { contractId: p4Contract, kind: "silent", amount: 100, clientRequestId: nextRequestId() });
  assert.equal(harness.balance("manager"), 175 + 97);
  assert.equal((await harness.act("manager", "fund", {}, { googleProtected: true })).fund.balance, 58);
  harness.advance(10);
  await harness.act("p4", "tribute", { contractId: p4Contract, kind: "silent", amount: 100, clientRequestId: nextRequestId() });
  assert.equal(harness.balance("manager"), 175 + 97 + 95, "the same pair is subsidized once a month");
  const ledger = harness.ledger("manager").find((entry) => entry.components?.some((component) => component.kind === "tribute_subsidy"));
  assert.ok(ledger);

  await rejects(harness.act("p1", "recommend", { publicManagerId }), /称号/);
  const otherId = await openManager(harness, "other", { entryFee: 0, personaName: "サキ", disclosure: "undisclosed" });
  const recommended = await harness.act("manager", "recommend", { publicManagerId: otherId });
  assert.deepEqual(recommended.recommendations, [otherId]);
  await rejects(harness.act("manager", "recommend", { publicManagerId: (await openManager(harness, "third", { entryFee: 0, personaName: "ユナ" })) }), /1件まで/);
  const board = await harness.act("p1", "board");
  assert.deepEqual(board.recommended.map((entry) => entry.publicManagerId), [otherId]);
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

test("a manager's chosen icon reaches the board, the card, contracts, receipts and the ranking", async () => {
  const harness = createHarness({ balances: { manager: 0, payer: 1_000 } });
  const publicManagerId = await openManager(harness, "manager", { avatar: 7 });
  assert.equal(harness.firestore.read("tributeProfiles/manager").card.avatar, 7);
  await confirmAge(harness, "payer");
  assert.equal((await harness.act("payer", "board")).managers[0].avatar, 7);
  assert.equal((await harness.act("payer", "manager", { publicManagerId })).card.avatar, 7);
  const contractId = await startContract(harness, "manager", "payer", publicManagerId);
  assert.equal(harness.contract(contractId).managerCard.avatar, 7, "the contract keeps the icon it was signed with");
  const receipts = await harness.act("payer", "receipts");
  assert.equal(receipts.receipts[0].avatar, 7);
  const rankings = await harness.act("payer", "rankings");
  assert.equal(rankings.managers[0].avatar, 7);
  const state = await harness.act("payer", "state");
  assert.equal(state.contracts.find((contract) => contract.contractId === contractId).manager.avatar, 7);

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
  await rejects(harness.act("manager", "receive", { contractId, tributeSeq: tribute.seq, reward: "arigato" }), /選べません/, "a sweet-only reward is not offered under harsh words");
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
