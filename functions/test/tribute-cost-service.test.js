"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createTributeService } = require("../tribute-service");
const { TRIBUTE_AGE_VERSION } = require("../tribute-rules");

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const NOW = Date.parse("2026-10-07T01:00:00Z");
const CONTRACT_ID = "a".repeat(40);

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function storage() {
  const documents = new Map();
  const reads = [];
  const writes = [];
  let nextTransactionRetry = null;
  function snapshot(reference) {
    const value = clone(documents.get(reference.path));
    return { id: reference.id, exists: value !== undefined, data: () => clone(value), get: (key) => clone(value?.[key]) };
  }
  function collection(name) {
    const query = { path: name, where: () => query, orderBy: () => query, limit: () => query,
      get: async () => { reads.push(`${name}/*`); return { docs: [], empty: true }; } };
    return { ...query, doc: (id) => reference(`${name}/${id}`) };
  }
  function reference(documentPath) {
    return { path: documentPath, id: documentPath.split("/").at(-1),
      collection: (name) => collection(`${documentPath}/${name}`),
      get: async () => { reads.push(documentPath); return snapshot(reference(documentPath)); } };
  }
  const firestore = {
    collection,
    async runTransaction(callback) {
      async function attempt(commit) {
        const pending = [];
        const result = await callback({
          get: async (ref) => {
            assert.equal(pending.length, 0, "transaction reads must precede writes");
            reads.push(ref.path);
            return snapshot(ref);
          },
          set(ref, value, options) { pending.push({ path: ref.path, value: clone(value), options }); },
          create(ref, value) { pending.push({ path: ref.path, value: clone(value) }); },
        });
        if (commit) for (const write of pending) {
          writes.push(write);
          documents.set(write.path, write.options?.merge ? { ...documents.get(write.path), ...write.value } : write.value);
        }
        return result;
      }
      if (nextTransactionRetry) {
        const mutate = nextTransactionRetry;
        nextTransactionRetry = null;
        await attempt(false);
        mutate();
      }
      return attempt(true);
    },
  };
  return { firestore, documents, reads, writes, reference, retryNext: (mutate) => { nextTransactionRetry = mutate; } };
}

function tributeHarness() {
  const store = storage();
  const { firestore, documents } = store;
  const noWallet = () => { throw new Error("ordinary reads must not access a wallet dependency"); };
  const service = createTributeService({
    firestore, HttpsError,
    ensureWallet: noWallet,
    walletRef: (uid) => firestore.collection("wallets").doc(uid),
    anjuPayLedgerConfigRef: () => firestore.collection("settings").doc("ledger"),
    walletData: noWallet, walletCreditCapacity: noWallet, debitPoints: noWallet, creditPoints: noWallet,
    stageAnjuPayOpening: noWallet, appendAnjuPayEntry: noWallet, anjuPayWalletMetadataPatch: noWallet,
    anjuPayEntryId: noWallet, mirrorWallet: noWallet,
    bestEffort: async (_label, tasks) => Promise.all(tasks),
    playerSafety: { isBlocked: async (_first, _second, transaction) =>
      (await transaction.get(firestore.collection("policies").doc("pair"))).get("blocked") === true },
    now: () => NOW,
  });
  documents.set("tributeProfiles/payer", { ageConfirmedVersion: TRIBUTE_AGE_VERSION });
  documents.set("tributeProfiles/manager", { ageConfirmedVersion: TRIBUTE_AGE_VERSION });
  documents.set("policies/pair", { blocked: false });
  documents.set(`tributeContracts/${CONTRACT_ID}`, {
    contractId: CONTRACT_ID, managerUid: "manager", payerUid: "payer", status: "active",
    expiresAt: NOW + 60_000, eventSeq: 12, readSeq: { manager: 5, payer: 2 },
    updatedAt: NOW - 1000, lastEventAt: NOW - 2000,
  });
  return { ...store, service, act: (uid, action, data = {}) => service.performAction(uid, { action, ...data }) };
}

test("ordinary mark_read uses contract, own age and policy only; writes only its receipt", async () => {
  const h = tributeHarness();
  const before = clone(h.documents.get(`tributeContracts/${CONTRACT_ID}`));
  assert.deepEqual(await h.act("payer", "mark_read", { contractId: CONTRACT_ID, seq: 999 }), {
    ok: true, contractId: CONTRACT_ID, readSeq: 12, eventSeq: 12,
  });
  assert.deepEqual(h.reads, [`tributeContracts/${CONTRACT_ID}`, "tributeProfiles/payer", "policies/pair"]);
  assert.deepEqual(h.writes.map((entry) => Object.keys(entry.value)), [["readSeq"]]);
  assert.deepEqual(h.documents.get(`tributeContracts/${CONTRACT_ID}`), { ...before, readSeq: { manager: 5, payer: 12 } });
});

test("same, older and invalid receipts are idempotent with no writes", async () => {
  const h = tributeHarness();
  for (const seq of [2, 1, -3, "invalid", null]) {
    const result = await h.act("payer", "mark_read", { contractId: CONTRACT_ID, seq });
    assert.equal(result.readSeq, 2);
  }
  assert.equal(h.writes.length, 0);
});

test("mark_read still rejects outsiders, unconfirmed actors and invalid contract states", async () => {
  const h = tributeHarness();
  await assert.rejects(h.act("outsider", "mark_read", { contractId: CONTRACT_ID, seq: 10 }), { code: "permission-denied" });
  h.documents.set("tributeProfiles/payer", {});
  await assert.rejects(h.act("payer", "mark_read", { contractId: CONTRACT_ID, seq: 10 }), { code: "failed-precondition" });
  h.documents.set("tributeProfiles/payer", { ageConfirmedVersion: TRIBUTE_AGE_VERSION });
  h.documents.get(`tributeContracts/${CONTRACT_ID}`).status = "unexpected";
  await assert.rejects(h.act("payer", "mark_read", { contractId: CONTRACT_ID, seq: 10 }), { code: "failed-precondition" });
  assert.equal(h.writes.length, 0);
});

test("retried mark_read preserves an intervening other-role receipt and newer event", async () => {
  const h = tributeHarness();
  h.retryNext(() => {
    const contract = h.documents.get(`tributeContracts/${CONTRACT_ID}`);
    contract.readSeq.manager = 12;
    contract.eventSeq = 13;
  });
  const result = await h.act("payer", "mark_read", { contractId: CONTRACT_ID, seq: 10 });
  assert.equal(result.eventSeq, 13);
  assert.deepEqual(h.documents.get(`tributeContracts/${CONTRACT_ID}`).readSeq, { manager: 12, payer: 10 });
  assert.equal(h.writes.length, 1);
});

test("initialized ranch achievement state reads stats once, within the unlock transaction", async () => {
  const h = tributeHarness();
  h.documents.set("tributeAchievementStats/payer", { historyBackfilled: true, walletPairDays: 3, managerPairDays: 0 });
  const result = await h.act("payer", "state");
  assert.equal(result.achievements.stats.walletPairDays, 3);
  assert.ok(result.achievements.unlocked.includes("tribute_wallet_3"));
  assert.equal(h.reads.filter((item) => item === "tributeAchievementStats/payer").length, 1);
  assert.equal(h.reads.filter((item) => item === "achievementProfiles/payer").length, 1);
  assert.equal(h.reads.some((item) => item === "tributePairs/*"), false);
});

test("ranch first-use backfill retries atomically and is not repeated on later state calls", async () => {
  const h = tributeHarness();
  h.documents.set("tributeAchievementStats/payer", { walletPairDays: 3, managerPairDays: 0 });
  const result = await h.act("payer", "state");
  assert.equal(result.achievements.stats.walletPairDays, 3, "existing contributions survive backfill");
  assert.equal(h.documents.get("tributeAchievementStats/payer").historyBackfilled, true);
  assert.equal(h.reads.filter((item) => item === "tributePairs/*").length, 2);
  h.reads.length = 0;
  await h.act("payer", "state");
  assert.equal(h.reads.filter((item) => item === "tributeAchievementStats/payer").length, 1);
  assert.equal(h.reads.some((item) => item === "tributePairs/*"), false);
});

const indexSource = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const ensureSource = indexSource.slice(indexSource.indexOf("async function ensureAchievementState("), indexSource.indexOf("async function mirrorEconomyProgress("));
const getSource = indexSource.slice(indexSource.indexOf("async function getAchievements("), indexSource.indexOf("async function redeemDollmasterAchievement("));

function commonHarness({ ready = true, initialize = true } = {}) {
  const h = storage();
  const calls = { backfill: 0, flea: 0, sync: 0 };
  const refNames = ["economyProgress", "achievementProfile", "crownMonthlyAchievementStats", "marketStats", "trainingProfile",
    "danwakuProfile", "aiTextTrainingPlayerStats", "aiTextTrainingSellerStats", "rouletteTrainingSellerStats"];
  for (const name of refNames) h.documents.set(`${name}/payer`, name === "economyProgress"
    ? { schemaVersion: 3, achievementStats: {}, dailyPlayClaims: {} } : {});
  h.documents.set("tributeStats/payer", { historyBackfilled: ready, walletPairDays: 3, managerPairDays: 0 });
  const context = { HttpsError, firestore: h.firestore, Promise,
    anjuPayFleaAchievementStatsStore: { ensure: async () => { calls.flea++; }, statsRef: (uid) => h.reference(`fleaStats/${uid}`) },
    tributeService: {
      achievementStatsRef: (uid) => h.reference(`tributeStats/${uid}`),
      async ensureAchievementStats(uid) {
        calls.backfill++;
        await h.reference(`tributeStats/${uid}`).get();
        if (initialize) h.documents.get(`tributeStats/${uid}`).historyBackfilled = true;
      },
    },
    eligibleAchievementIds: ({ tributeStats }) => [`wallet:${tributeStats.walletPairDays}`],
    unlockAchievements: (profile, ids) => ({ profile: { ...profile, eligible: ids }, newlyUnlocked: [] }),
    publicAchievementProfile: (profile) => profile,
    syncAchievementPublicSurfaces: async () => { calls.sync++; },
  };
  for (const name of refNames) context[`${name}Ref`] = (uid) => h.reference(`${name}/${uid}`);
  for (const name of ["normalizeEconomyProgress", "normalizeCrownMonthlyStats", "normalizeMarketStats", "normalizeFleaStats",
    "normalizeRetiredTrainingHistory", "normalizeDanwakuStats", "normalizeAiTextTrainingStats", "normalizeRouletteTrainingStats", "normalizeTributeStats"]) {
    context[name] = (value) => value || {};
  }
  vm.createContext(context);
  vm.runInContext(`${ensureSource}\n${getSource}\nthis.ensure = ensureAchievementState; this.get = getAchievements;`, context);
  return { ...h, calls, ensure: context.ensure, get: context.get };
}

test("economy getAchievements opts into a single transaction stats read; other callers keep eager behavior", async () => {
  const optimized = commonHarness();
  const profile = await optimized.get("payer", { syncPublic: true, deferTributeBackfill: true });
  assert.equal(profile.eligible[0], "wallet:3");
  assert.equal(optimized.calls.backfill, 0);
  assert.equal(optimized.calls.sync, 1);
  assert.equal(optimized.reads.filter((item) => item === "tributeStats/payer").length, 1);
  const unchanged = commonHarness();
  await unchanged.get("payer", { syncPublic: true });
  assert.equal(unchanged.calls.backfill, 1);
  assert.equal(unchanged.reads.filter((item) => item === "tributeStats/payer").length, 2);
  assert.equal(indexSource.match(/getAchievements\(uid, \{[^\n]*deferTributeBackfill: true/g)?.length, 2);
  assert.match(indexSource, /achievements: await getAchievements\(uid, \{ syncPublic: true \}\)/, "code redemption preserves eager behavior");
});

test("common deferred backfill writes no unlocks before initialization and retries once", async () => {
  const h = commonHarness({ ready: false });
  const result = await h.get("payer", { deferTributeBackfill: true });
  assert.equal(result.eligible[0], "wallet:3");
  assert.equal(h.calls.backfill, 1);
  assert.equal(h.calls.flea, 1);
  assert.equal(h.reads.filter((item) => item === "tributeStats/payer").length, 3);
  assert.equal(h.writes.length, 0);
  const failed = commonHarness({ ready: false, initialize: false });
  await assert.rejects(failed.get("payer", { deferTributeBackfill: true }), { code: "unavailable" });
  assert.equal(failed.calls.backfill, 1, "failed initialization cannot loop indefinitely");
  assert.equal(failed.writes.length, 0);
});

test("common transaction retry uses latest stats rather than a request-local stale snapshot", async () => {
  const h = commonHarness();
  h.retryNext(() => { h.documents.get("tributeStats/payer").walletPairDays = 4; });
  const result = await h.get("payer", { deferTributeBackfill: true });
  assert.equal(result.eligible[0], "wallet:4");
  assert.equal(h.calls.backfill, 0);
});
