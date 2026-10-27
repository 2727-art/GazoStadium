"use strict";

// 財布の打つ手と管理人の言葉（設計書14節・第1〜3段）を、本物の Firestore（エミュレータ）で通しで動かす。
// 単体テストの偽物では出ない、トランザクションと merge の動き（null での削除・地図の差し替え）を確かめる。
// 本番の資格情報や名前空間は受け付けない。
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createTributeService } = require("../tribute-service");
const { TRIBUTE_AGE_VERSION } = require("../tribute-rules");

const requested = process.env.RUN_TRIBUTE_MOVES_EMULATOR_TESTS === "1";
const START = Date.parse("2026-10-27T12:00:00+09:00");
const DAY = 24 * 60 * 60 * 1000;
const stableId = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

test("wallet moves and manager words run end to end on real Firestore transactions", {
  skip: requested ? false : "set RUN_TRIBUTE_MOVES_EMULATOR_TESTS=1 with a loopback Firestore emulator",
  timeout: 180_000,
}, async (t) => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/,
    "FIRESTORE_EMULATOR_HOST must be an explicit loopback endpoint");
  const projectId = "demo-tribute-moves";
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = initializeApp({ projectId }, `tribute-moves-${Date.now()}`);
  const database = getFirestore(app);
  t.after(async () => { await database.terminate(); await deleteApp(app); });

  const suffix = crypto.randomBytes(6).toString("hex");
  const manager = `manager-${suffix}`;
  const payer = `payer-${suffix}`;
  const walletRef = (uid) => database.doc(`tributeMovesTestWallets/${uid}`);
  let clock = START;
  let requestCounter = 0;
  const nextRequestId = () => `req_${suffix}_${String(++requestCounter).padStart(4, "0")}`;
  await Promise.all([
    walletRef(manager).set({ balance: 0, maxBalance: 1_000_000 }),
    walletRef(payer).set({ balance: 5_000, maxBalance: 1_000_000 }),
    database.doc("tributeMovesTestSettings/ledger").set({ enabled: true }),
  ]);
  const service = createTributeService({
    firestore: database,
    HttpsError,
    now: () => clock,
    ensureWallet: async (uid) => {
      const snapshot = await walletRef(uid).get();
      if (!snapshot.exists) await walletRef(uid).set({ balance: 0, maxBalance: 1_000_000 });
      return (await walletRef(uid).get()).get("balance");
    },
    walletRef,
    anjuPayLedgerConfigRef: () => database.doc("tributeMovesTestSettings/ledger"),
    walletData(snapshot) {
      assert.equal(snapshot.exists, true);
      return structuredClone(snapshot.data());
    },
    walletCreditCapacity: (wallet) => wallet.maxBalance - wallet.balance,
    debitPoints(wallet, amount) {
      if (wallet.balance < amount) throw new HttpsError("failed-precondition", "AnjuPay残高が不足しています。");
      wallet.balance -= amount;
    },
    creditPoints(wallet, amount) {
      if (wallet.balance + amount > wallet.maxBalance) throw new HttpsError("failed-precondition", "上限です。");
      wallet.balance += amount;
    },
    stageAnjuPayOpening() {},
    appendAnjuPayEntry(transaction, reference, _wallet, _config, entry) {
      assert.equal(entry.balanceAfter - entry.balanceBefore, entry.delta);
      transaction.create(reference.collection("ledger").doc(entry.entryId), entry);
    },
    anjuPayWalletMetadataPatch: () => ({}),
    anjuPayEntryId: stableId,
    mirrorWallet: async () => {},
    bestEffort: async (_label, operations) => { await Promise.allSettled(operations); },
    syncAchievementPublicSurfaces: async () => {},
    economyProgressRef: (uid) => database.doc(`tributeMovesTestProgress/${uid}`),
    totalVerifiedMatches: () => 0,
  });
  const act = (uid, action, data = {}) => { clock += 2_100; return service.performAction(uid, { action, ...data }); };
  const rejects = (promise, pattern) => assert.rejects(promise, (error) => { assert.match(String(error.message), pattern); return true; });
  const balance = async (uid) => (await walletRef(uid).get()).get("balance");

  // 管理人: カードの受取印に自分の言葉を混ぜ、自分の言葉を登録する。
  for (const uid of [manager, payer]) await act(uid, "age_confirm", { version: TRIBUTE_AGE_VERSION, adult: true, premise: true });
  const saved = await act(manager, "save_profile", {
    card: { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", styles: ["insight"], entryFee: 10, sigil: 2, seals: ["yoku", "word:よく貢いだ"] },
    accepting: true,
  });
  await act(manager, "set_own_words", { ownWords: {
    lines: [{ text: "跪いて差し出しな。", tone: "harsh" }],
    rewards: [{ text: "上出来", tone: "normal" }, { text: "イっていいよ", tone: "harsh" }],
  } });
  const profile = (await database.doc(`tributeProfiles/${manager}`).get()).data();
  assert.deepEqual(profile.card.seals, ["yoku", "word:よく貢いだ"]);
  assert.deepEqual(profile.ownWords.rewards.map((entry) => entry.text), ["上出来", "イっていいよ"]);

  // 第1段: 言われたい言葉・強さの上限・14日。
  const applied = await act(payer, "apply", {
    publicManagerId: saved.profile.publicManagerId,
    expectedEntryFee: 10,
    application: {
      caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 14, tone: "harsh", ngWords: ["ブス"],
      allowReportRequests: true, rankOptIn: true, walletName: "ポチ財布", acceptNoDecline: true,
      wantWords: ["えらいね"], allowHolds: true, allowSexualPurposes: true,
    },
  });
  const contractId = applied.contract.contractId;
  const contractRef = database.doc(`tributeContracts/${contractId}`);
  const contract = async () => (await contractRef.get()).data();
  const events = async () => (await contractRef.collection("events").get()).docs.map((doc) => doc.data()).sort((left, right) => left.seq - right.seq);
  const on = (uid, action, data = {}) => act(uid, action, { contractId, ...data });
  await on(manager, "accept");
  assert.equal((await contract()).durationDays, 14);
  await on(payer, "set_want_words", { wantWords: ["えらいね", "よくできました"] });
  assert.deepEqual((await contract()).wantWords, ["えらいね", "よくできました"]);

  // 第2段: お預け → 願い出 → 許された献上 → 解く。
  await on(manager, "hold", { note: "許すまで待て" });
  await rejects(on(payer, "tribute", { kind: "silent", amount: 30, clientRequestId: nextRequestId() }), /お預け中です/);
  await on(payer, "plea", { amount: 30, purpose: "management" });
  await on(manager, "plea_grant", { note: "いいよ" });
  const granted = await on(payer, "tribute", { kind: "granted", amount: 30, clientRequestId: nextRequestId() });
  assert.equal((await contract()).plea, null, "a used grant is deleted with null");
  await on(manager, "unhold");
  const afterHold = await contract();
  assert.deepEqual([afterHold.hold, afterHold.plea, afterHold.pleaGrantedCount], [null, null, 1]);

  // 抵抗のすえの献上。払った請求は pendingRequests から本当に消える。
  const request = await on(manager, "request", { amount: 40, note: "今日の分。" });
  await on(payer, "resist", { requestId: request.requestId, text: "もう少しだけ待ってください" });
  await on(payer, "resist", { requestId: request.requestId, text: "許してください" });
  assert.equal((await contract()).pendingRequests[request.requestId].resists, 2);
  await on(payer, "tribute", { kind: "request", requestId: request.requestId, amount: 40, clientRequestId: nextRequestId() });
  assert.equal(Object.keys((await contract()).pendingRequests || {}).length, 0, "the paid request is gone");
  const receipts = (await act(payer, "receipts")).receipts;
  assert.equal(receipts.find((row) => row.receiptId === granted.receipt.receiptId).granted, true);
  assert.equal(receipts.find((row) => row.amount === 40).resisted, 2);

  // 第3段: 言葉の献上（Pay 0）を、受取印の言葉と自分のご褒美で受け取る。
  const before = await balance(payer);
  await on(payer, "offer_words", { text: "今日も負けました。\n言葉だけ置いていきます。" });
  assert.equal(await balance(payer), before, "no Pay moves");
  const offering = (await events()).at(-1);
  await on(manager, "receive", { tributeSeq: offering.seq, seal: "word:よく貢いだ", reward: "word", rewardText: "上出来" });
  const marked = (await events()).find((event) => event.seq === offering.seq);
  assert.deepEqual([marked.seal, marked.rewardText, marked.receivedAt > 0], ["word:よく貢いだ", "上出来", true]);

  // 性的な言葉の復唱は、財布が性的な名目の許可を外すと取り下げられる（null で消える）。
  await on(manager, "recite_order", { text: "イかせてください", target: 1 });
  await on(payer, "set_purposes", { allowSexualPurposes: false });
  assert.equal((await contract()).reciteOrder, null);
  assert.deepEqual([(await events()).at(-1).type, (await events()).at(-1).reason], ["recite_withdrawn", "purpose"]);
  await rejects(on(manager, "recite_confirm", { reward: "word", rewardText: "イっていいよ" }), /確認できる復唱はありません/);

  // 復唱 → 確認。性的な自分のご褒美は、許可を外した契約では通らない。
  await on(manager, "recite_order", { text: "私は　財布です。", target: 3 });
  await rejects(on(payer, "recite", { text: "私は財布でした。" }), /一字一句同じに/);
  for (const text of ["  私は 財布です。 ", "私は 財布です。", "私は　財布です。"]) await on(payer, "recite", { text });
  assert.equal((await contract()).recitesDone, 1);
  await rejects(on(manager, "recite_confirm", { reward: "word", rewardText: "イっていいよ" }), /ご褒美の候補にありません/);
  await on(manager, "recite_confirm", { seal: "yoku", reward: "word", rewardText: "上出来" });
  assert.equal((await contract()).reciteOrder, null);

  // 延長: いまの期限から延び、申し込みは null で消える。
  const end = (await contract()).expiresAt;
  await rejects(on(manager, "extend_request", { days: 7 }), /この操作はできません/);
  await on(payer, "extend_request", { days: 7 });
  await on(manager, "extend_accept");
  const extended = await contract();
  assert.deepEqual([extended.expiresAt, extended.extension, extended.extendedDays], [end + 7 * DAY, null, 7]);

  // 画面に返す形（両方の側）。
  const payerView = (await act(payer, "state")).contracts.find((row) => row.contractId === contractId);
  const managerView = (await act(manager, "state")).contracts.find((row) => row.contractId === contractId);
  assert.deepEqual([payerView.wantWords, payerView.wordOfferings, payerView.recitesDone], [["えらいね", "よくできました"], 1, 1]);
  assert.deepEqual([managerView.hold, managerView.reciteOrder, managerView.extension, managerView.resistedTributes], [null, null, null, 1]);
});
