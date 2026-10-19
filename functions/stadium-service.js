"use strict";

// マイスタジアムのサーバー処理。観客は検証済みの正式完走数から読み直し、金額はすべてここで計算する。
// 端末から受け取るのは操作の種類と、建設なら施設と目標の段だけ。対戦の確定処理には手を入れない。

const {
  FACILITIES,
  FANS_PER_MATCH,
  buildStadium,
  collectStadium,
  createStadiumRecord,
  fansFor,
  isFacilityId,
  normalizeStadiumRecord,
  settleStadium,
  stadiumView,
} = require("./stadium-rules");

const STADIUM_ACTIONS = Object.freeze(["get", "open", "collect", "build"]);

function createStadiumService({
  firestore,
  HttpsError,
  ensureWallet,
  walletRef,
  anjuPayLedgerConfigRef,
  walletData,
  walletCreditCapacity,
  debitPoints,
  creditPoints,
  stageAnjuPayOpening,
  appendAnjuPayEntry,
  anjuPayWalletMetadataPatch,
  anjuPayEntryId,
  mirrorWallet,
  bestEffort,
  economyProgressRef,
  totalVerifiedMatches,
  now: currentTime = () => Date.now(),
  log = console,
}) {
  function fail(code, message) {
    throw new HttpsError(code, message);
  }

  function stadiumRef(uid) {
    return firestore.collection("stadiums").doc(uid);
  }

  function walletBalanceOf(snapshot) {
    if (!snapshot.exists) return 0;
    const balance = Number(snapshot.get("balance"));
    return Number.isSafeInteger(balance) && balance > 0 ? balance : 0;
  }

  function matchesFrom(progressSnapshot) {
    return totalVerifiedMatches(progressSnapshot.exists ? progressSnapshot.data() : {});
  }

  function unopenedView(walletBalance) {
    return { opened: false, fansPerMatch: FANS_PER_MATCH, walletBalance };
  }

  async function mirror(uid, balance) {
    if (balance === null) return;
    await bestEffort("stadium wallet", [mirrorWallet(uid, balance)]);
  }

  async function getAction(uid) {
    return firestore.runTransaction(async (transaction) => {
      const timestamp = currentTime();
      const [stadiumSnapshot, progressSnapshot, walletSnapshot] = await Promise.all([
        transaction.get(stadiumRef(uid)),
        transaction.get(economyProgressRef(uid)),
        transaction.get(walletRef(uid)),
      ]);
      const walletBalance = walletBalanceOf(walletSnapshot);
      if (!stadiumSnapshot.exists) return unopenedView(walletBalance);
      const stored = normalizeStadiumRecord(stadiumSnapshot.data());
      const fans = fansFor(matchesFrom(progressSnapshot), stored.baselineMatches);
      const { record } = settleStadium(stored, { now: timestamp, fans });
      // 観客が増えた時だけ精算を書き残す。それ以外は書かずに計算結果だけ返す。
      if (fans !== stored.fansAtSettle || fans !== stored.lastSeenFans) {
        transaction.set(stadiumRef(uid), { ...record, lastSeenFans: fans, updatedAt: timestamp });
      }
      return stadiumView(record, {
        now: timestamp,
        fans,
        previousSeenFans: stored.lastSeenFans,
        walletBalance,
      });
    });
  }

  async function openAction(uid) {
    return firestore.runTransaction(async (transaction) => {
      const timestamp = currentTime();
      const [stadiumSnapshot, progressSnapshot, walletSnapshot] = await Promise.all([
        transaction.get(stadiumRef(uid)),
        transaction.get(economyProgressRef(uid)),
        transaction.get(walletRef(uid)),
      ]);
      const walletBalance = walletBalanceOf(walletSnapshot);
      const matches = matchesFrom(progressSnapshot);
      if (stadiumSnapshot.exists) {
        // 開業は一度だけ。2回目は開業した時の完走数を変えずに今の状態を返す。
        const stored = normalizeStadiumRecord(stadiumSnapshot.data());
        const fans = fansFor(matches, stored.baselineMatches);
        const { record } = settleStadium(stored, { now: timestamp, fans });
        return { ...stadiumView(record, { now: timestamp, fans, previousSeenFans: stored.lastSeenFans, walletBalance }), replayed: true };
      }
      const record = createStadiumRecord({ now: timestamp, baselineMatches: matches });
      transaction.create(stadiumRef(uid), record);
      return { ...stadiumView(record, { now: timestamp, fans: 0, walletBalance }), opened: true, justOpened: true };
    });
  }

  async function collectAction(uid) {
    await ensureWallet(uid);
    let mirrorBalance = null;
    let logged = null;
    const result = await firestore.runTransaction(async (transaction) => {
      mirrorBalance = null;
      logged = null;
      const timestamp = currentTime();
      const [stadiumSnapshot, progressSnapshot, walletSnapshot, ledgerConfigSnapshot] = await Promise.all([
        transaction.get(stadiumRef(uid)),
        transaction.get(economyProgressRef(uid)),
        transaction.get(walletRef(uid)),
        transaction.get(anjuPayLedgerConfigRef()),
      ]);
      if (!stadiumSnapshot.exists) fail("failed-precondition", "マイスタジアムはまだ開業していません。");
      const stored = normalizeStadiumRecord(stadiumSnapshot.data());
      const fans = fansFor(matchesFrom(progressSnapshot), stored.baselineMatches);
      const wallet = walletData(walletSnapshot);
      const collected = collectStadium(stored, {
        now: timestamp,
        fans,
        walletCapacity: walletCreditCapacity(wallet),
      });
      if (collected.amount > 0) {
        stageAnjuPayOpening(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, timestamp);
        const before = wallet.balance;
        creditPoints(wallet, collected.amount);
        const groupId = anjuPayEntryId(`stadium:collect:${collected.record.collectSeq}`);
        appendAnjuPayEntry(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, {
          entryId: groupId,
          groupId,
          kind: "stadium_revenue",
          category: "earn",
          labelKey: "anju_pay_stadium_revenue",
          status: "posted",
          delta: collected.amount,
          nominalAmount: collected.amount,
          balanceBefore: before,
          balanceAfter: wallet.balance,
          components: [{
            kind: "stadium_revenue",
            labelKey: "anju_pay_stadium_revenue",
            delta: collected.amount,
            nominalAmount: collected.amount,
            status: "posted",
          }],
          details: { mode: "stadium", dateKey: collected.dateKey },
          occurredAt: timestamp,
        });
        transaction.update(walletRef(uid), {
          balance: wallet.balance,
          ...anjuPayWalletMetadataPatch(wallet),
          updatedAt: timestamp,
        });
        mirrorBalance = wallet.balance;
        logged = { amount: collected.amount, collectedToday: collected.record.daily.collected, dateKey: collected.dateKey };
      }
      transaction.set(stadiumRef(uid), { ...collected.record, updatedAt: timestamp });
      return {
        ...stadiumView(collected.record, { now: timestamp, fans, walletBalance: wallet.balance }),
        collected: collected.amount,
        reason: collected.reason,
      };
    });
    if (logged) log.info?.("stadium revenue collected", { uid, ...logged });
    await mirror(uid, mirrorBalance);
    return result;
  }

  function buildFailure(outcome, facility) {
    if (outcome.error === "facility") fail("invalid-argument", "建てる施設を選んでください。");
    if (outcome.error === "level") fail("invalid-argument", "建てる段を確かめてください。");
    if (outcome.error === "order") {
      fail("failed-precondition", `${FACILITIES[facility].label}は1段ずつ順に建てます。画面を読み直してください。`);
    }
    if (outcome.error === "balance") {
      fail("failed-precondition", `AnjuPay残高が足りません（あと ${outcome.shortfall.toLocaleString("ja-JP")} Pay）。`);
    }
  }

  async function buildAction(uid, data) {
    const facility = String(data?.facility || "");
    const level = Number(data?.level);
    if (!isFacilityId(facility)) fail("invalid-argument", "建てる施設を選んでください。");
    if (!Number.isSafeInteger(level)) fail("invalid-argument", "建てる段を確かめてください。");
    await ensureWallet(uid);
    let mirrorBalance = null;
    const result = await firestore.runTransaction(async (transaction) => {
      mirrorBalance = null;
      const timestamp = currentTime();
      const [stadiumSnapshot, progressSnapshot, walletSnapshot, ledgerConfigSnapshot] = await Promise.all([
        transaction.get(stadiumRef(uid)),
        transaction.get(economyProgressRef(uid)),
        transaction.get(walletRef(uid)),
        transaction.get(anjuPayLedgerConfigRef()),
      ]);
      if (!stadiumSnapshot.exists) fail("failed-precondition", "マイスタジアムはまだ開業していません。");
      const stored = normalizeStadiumRecord(stadiumSnapshot.data());
      const fans = fansFor(matchesFrom(progressSnapshot), stored.baselineMatches);
      const wallet = walletData(walletSnapshot);
      const outcome = buildStadium(stored, { now: timestamp, fans, facility, level, balance: wallet.balance });
      if (outcome.error) buildFailure(outcome, facility);
      if (outcome.replayed) {
        return { ...stadiumView(outcome.record, { now: timestamp, fans, walletBalance: wallet.balance }), built: null, replayed: true };
      }
      stageAnjuPayOpening(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, timestamp);
      const before = wallet.balance;
      debitPoints(wallet, outcome.cost);
      const groupId = anjuPayEntryId(`stadium:build:${facility}:${level}`);
      appendAnjuPayEntry(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, {
        entryId: groupId,
        groupId,
        kind: "stadium_build",
        category: "spend",
        labelKey: "anju_pay_stadium_build",
        status: "posted",
        delta: -outcome.cost,
        nominalAmount: outcome.cost,
        balanceBefore: before,
        balanceAfter: wallet.balance,
        components: [{
          kind: "stadium_build",
          labelKey: "anju_pay_stadium_build",
          delta: -outcome.cost,
          nominalAmount: outcome.cost,
          status: "posted",
        }],
        details: { mode: "stadium", facility, facilityLevel: level },
        occurredAt: timestamp,
      });
      transaction.update(walletRef(uid), {
        balance: wallet.balance,
        ...anjuPayWalletMetadataPatch(wallet),
        updatedAt: timestamp,
      });
      transaction.set(stadiumRef(uid), { ...outcome.record, updatedAt: timestamp });
      mirrorBalance = wallet.balance;
      return {
        ...stadiumView(outcome.record, { now: timestamp, fans, walletBalance: wallet.balance }),
        built: { facility, level, cost: outcome.cost },
      };
    });
    await mirror(uid, mirrorBalance);
    return result;
  }

  async function performAction(uid, data) {
    const action = String(data?.action || "");
    if (!STADIUM_ACTIONS.includes(action)) fail("invalid-argument", "マイスタジアムの操作が正しくありません。");
    if (action === "get") return getAction(uid);
    if (action === "open") return openAction(uid);
    if (action === "collect") return collectAction(uid);
    return buildAction(uid, data);
  }

  return Object.freeze({
    STADIUM_ACTIONS,
    performAction,
    stadiumRef,
  });
}

module.exports = Object.freeze({
  STADIUM_ACTIONS,
  createStadiumService,
});
