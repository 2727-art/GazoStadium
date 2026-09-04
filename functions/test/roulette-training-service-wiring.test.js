"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const service = fs.readFileSync(path.join(root, "functions", "roulette-training-service.js"), "utf8");
const core = fs.readFileSync(path.join(root, "functions", "roulette-training.js"), "utf8");
const index = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const indexes = JSON.parse(fs.readFileSync(path.join(root, "firestore.indexes.json"), "utf8"));

function between(start, end) {
  const startIndex = service.indexOf(start);
  const endIndex = service.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return service.slice(startIndex, endIndex);
}

test("roulette training callable is App Check protected and uses the dedicated service", () => {
  assert.match(index, /createRouletteTrainingService/);
  assert.match(
    index,
    /exports\.rouletteTrainingAction = onCall\(\s*callableOptions\("rouletteTrainingAction"\)/,
  );
  assert.match(index, /rouletteTrainingService\.performAction\(uid, request\.data\)/);
  assert.match(
    fs.readFileSync(path.join(root, "functions", "app-check-rollout.js"), "utf8"),
    /rouletteTrainingAction: true/,
  );
});

test("all roulette marketplace documents are callable-only", () => {
  for (const collection of [
    "rouletteTrainingPacks",
    "rouletteTrainingUses",
    "rouletteTrainingActiveUses",
    "rouletteTrainingPublishActions",
    "rouletteTrainingPackRevisionBuyers",
    "rouletteTrainingReports",
    "rouletteTrainingSellerStats",
    "rouletteTrainingMonthlyPeriods",
    "rouletteTrainingRankingPairs",
    "rouletteTrainingSellerBuyerPairs",
    "rouletteTrainingMonthlyBuyerPairs",
    "rouletteTrainingPackStats",
    "rouletteTrainingPackMonthlyPeriods",
    "rouletteTrainingPackRankingPairs",
    "rouletteTrainingPackBuyerPairs",
    "rouletteTrainingPackMonthlyBuyerPairs",
    "rouletteTrainingSellerProfiles",
  ]) {
    assert.match(service, new RegExp(`collection\\("${collection}"\\)`));
    assert.match(rules, new RegExp(`match /${collection}/`));
  }
  assert.match(rules, /match \/rouletteTrainingPacks\/\{packId\}[\s\S]*?allow read, write: if false;[\s\S]*?match \/revisions\/\{revisionId\}/);
});

test("large UGC snapshots are excluded from Firestore indexes", () => {
  const overrides = indexes.fieldOverrides.map((entry) => (
    `${entry.collectionGroup}:${entry.fieldPath}`
  ));
  for (const key of [
    "rouletteTrainingPacks:items",
    "rouletteTrainingUses:packSnapshot.items",
    "rouletteTrainingPackRevisionBuyers:packSnapshot.items",
    "rouletteTrainingReports:packSnapshot.items",
    "rouletteTrainingPublishActions:pack.items",
    "revisions:items",
  ]) {
    assert.ok(overrides.includes(key), `missing index override ${key}`);
  }
});

test("state returns bounded buyer-owned finished revision snapshots without private IDs", () => {
  const history = between("async function readPurchasedRevisions", "async function getState");
  assert.match(history, /collection\("rouletteTrainingPackRevisionBuyers"\)/);
  assert.match(history, /where\("buyerUid", "==", uid\)/);
  assert.match(history, /orderBy\("lastUsedAt", "desc"\)/);
  assert.match(history, /PURCHASED_REVISION_LIMIT/);
  const state = between("async function getState", "async function browse");
  assert.match(state, /readPurchasedRevisions\(uid\)/);
  assert.match(state, /purchasedRevisions/);
  const historyIndex = indexes.indexes.find((entry) => (
    entry.collectionGroup === "rouletteTrainingPackRevisionBuyers"
    && entry.fields.some((field) => field.fieldPath === "buyerUid")
    && entry.fields.some((field) => field.fieldPath === "lastUsedAt" && field.order === "DESCENDING")
  ));
  assert.ok(historyIndex, "revision-buyer history composite index is declared");
});

test("market lists are server ordered and seller ownership is capped transactionally", () => {
  const browse = between("async function browsePacks", "async function readPurchasedRevisions");
  assert.match(browse, /where\("status", "==", "active"\)/);
  assert.match(browse, /where\("moderationStatus", "==", "clear"\)/);
  assert.match(browse, /orderBy\("paidUseCount", "desc"\)/);
  assert.match(browse, /orderBy\("updatedAt", "desc"\)/);
  const state = between("async function getState", "async function browse");
  assert.match(state, /where\("sellerUid", "==", uid\)[\s\S]*?orderBy\("updatedAt", "desc"\)/);
  const publish = between("async function publish", "async function unpublish");
  assert.match(publish, /transaction\.get\(statsReference\)/);
  assert.match(publish, /currentPackCount >= ROULETTE_TRAINING_SELLER_PACK_MAX/);
  assert.match(publish, /packCount: currentPackCount \+ 1/);
  const browseIndex = indexes.indexes.find((entry) => (
    entry.collectionGroup === "rouletteTrainingPacks"
    && entry.fields.some((field) => field.fieldPath === "status")
    && entry.fields.some((field) => field.fieldPath === "moderationStatus")
    && entry.fields.some((field) => field.fieldPath === "paidUseCount" && field.order === "DESCENDING")
    && entry.fields.some((field) => field.fieldPath === "updatedAt" && field.order === "DESCENDING")
  ));
  assert.ok(browseIndex, "market browse composite index is declared");
  const ownIndex = indexes.indexes.find((entry) => (
    entry.collectionGroup === "rouletteTrainingPacks"
    && entry.fields.some((field) => field.fieldPath === "sellerUid")
    && entry.fields.some((field) => field.fieldPath === "updatedAt" && field.order === "DESCENDING")
  ));
  assert.ok(ownIndex, "seller pack-management composite index is declared");
});

test("current-content pack rankings use callable-only aggregates and exact composite indexes", () => {
  assert.match(core, /function rouletteTrainingRankingContentHash/);
  assert.match(core, /menuText:[\s\S]*?detailText:[\s\S]*?countUnit:[\s\S]*?cheerLines:/);
  assert.match(service, /async function packRankings/);
  assert.match(service, /where\("isCurrentPublic", "==", true\)/);
  assert.match(
    service,
    /where\("uniqueBuyers", ">=", PACK_RANKING_MINIMUM_UNIQUE_BUYERS\)/,
  );
  assert.match(service, /PACK_RANKING_MINIMUM_UNIQUE_BUYERS = 3/);
  assert.match(service, /PACK_RANKING_LIMIT = 20/);
  assert.match(service, /PACK_RANKING_CANDIDATE_LIMIT = 60/);
  const requiredRankingFields = [
    ["isCurrentPublic", "ASCENDING"],
    ["uniqueBuyers", "DESCENDING"],
    ["rankingUseCount", "DESCENDING"],
    ["scoreReachedAt", "ASCENDING"],
    ["packId", "ASCENDING"],
  ];
  for (const collectionGroup of ["rouletteTrainingPackStats", "entries"]) {
    const rankingIndex = indexes.indexes.find((entry) => entry.collectionGroup === collectionGroup
      && entry.queryScope === "COLLECTION"
      && entry.fields.length === requiredRankingFields.length
      && entry.fields.every((field, index) => (
        field.fieldPath === requiredRankingFields[index][0]
        && field.order === requiredRankingFields[index][1]
      )));
    assert.ok(rankingIndex, `${collectionGroup} current-content ranking index is declared`);
  }
  const quarantineProfileIndex = indexes.indexes.find((entry) => (
    entry.collectionGroup === "rouletteTrainingPacks"
    && entry.fields.some((field) => field.fieldPath === "sellerUid")
    && entry.fields.some((field) => field.fieldPath === "moderationStatus")
  ));
  assert.ok(quarantineProfileIndex, "seller quarantine profile query index is declared");
});

test("paid start validates the viewed price and revision and commits economy atomically", () => {
  const start = between("async function startPaidUse", "async function resumeUse");
  for (const token of [
    "expectedPrice",
    "expectedRevision",
    "expectedBalance",
    "rouletteTrainingSaleSettlement",
    "debitPoints",
    "creditPoints",
    "appendAnjuPayEntry",
    "transaction.create(useReference",
    "transaction.set(activeReference",
    "transaction.set(statsReference",
    "transaction.set(monthlyReference",
    "transaction.create(dailyPairReference",
    "transaction.create(lifetimeBuyerPairReference",
    "transaction.create(monthBuyerPairReference",
  ]) {
    assert.match(start, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(start, /rankingCounted = !selfPreview && !dailyPairSnapshot\.exists/);
  assert.match(start, /charged: !selfPreview/);
  assert.match(start, /settlement = \{ price: 0, fee: 0, sellerProceeds: 0 \}/);
  const firstWrite = start.search(/transaction\.(?:create|set|update|delete)\(/);
  const lastRead = start.lastIndexOf("transaction.get(");
  assert.ok(lastRead < firstWrite, "all transaction reads must finish before the first write");
});

test("resume prevents reload charging and finish accepts no workout outcome", () => {
  const resume = between("async function resumeUse", "async function finishUse");
  assert.match(resume, /snapshot\.get\("buyerUid"\) !== uid/);
  assert.match(resume, /snapshot\.get\("status"\) !== ACTIVE_USE_STATUS/);
  const finish = between("async function finishUse", "async function report");
  assert.match(finish, /assertAllowedKeys\([\s\S]*?\["action", "useId"\]/);
  assert.match(finish, /status: FINISHED_USE_STATUS/);
  assert.match(finish, /finishedAt: now/);
  assert.doesNotMatch(finish, /\b(?:outcome|completed|clear|giveUp|bpm|images|rouletteResult|countResult)\b\s*:/);
});

test("publication accepts only text/countUnit schema and responses reject private IDs", () => {
  assert.match(core, /new Set\(\["menuText", "detailText", "countUnit", "cheerLines"\]\)/);
  assert.match(core, /"reps"[\s\S]*?"seconds"[\s\S]*?"round_trips"[\s\S]*?"sets"/);
  assert.match(core, /unexpected_roulette_training_pack_field/);
  assert.match(service, /PRIVATE_RESPONSE_FIELDS[\s\S]*?"sellerUid"[\s\S]*?"buyerUid"[\s\S]*?"reporterUid"/);
  assert.match(service, /assertNoPrivateFields\(result\)/);
});

test("verified harassment reports are included in the three-buyer quarantine boundary", () => {
  assert.match(service, /HIGH_RISK_REPORT_REASONS[\s\S]*?"harassment"/);
});

test("account transfer refuses active or historical roulette marketplace state", () => {
  assert.match(index, /accountHasActiveSession[\s\S]*?collection\("rouletteTrainingActiveUses"\)\.doc\(uid\)\.get\(\)/);
  assert.match(index, /transferTargetIsPristine[\s\S]*?collection\("rouletteTrainingPacks"\)\.where\("sellerUid", "==", uid\)/);
  assert.match(index, /transferTargetIsPristine[\s\S]*?collection\("rouletteTrainingUses"\)\.where\("buyerUid", "==", uid\)/);
  assert.match(index, /transferTargetIsPristine[\s\S]*?collection\("rouletteTrainingSellerProfiles"\)\.doc\(uid\)\.get\(\)/);
  assert.match(index, /targetRouletteTrainingSellerStatsSnapshot\.exists/);
  assert.match(index, /targetRouletteTrainingSellerProfileSnapshot\.exists/);
});
