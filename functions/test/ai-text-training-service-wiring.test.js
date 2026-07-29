"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const service = read("functions/ai-text-training-service.js");
const index = read("functions/index.js");
const rules = read("firestore.rules");

function between(startMarker, endMarker) {
  const start = service.indexOf(startMarker);
  const end = service.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker ${startMarker}`);
  assert.notEqual(end, -1, `missing marker ${endMarker}`);
  return service.slice(start, end);
}

test("AI text training is an injected App Check callable service", () => {
  assert.match(service, /function createAiTextTrainingService\(deps\)/);
  for (const dependency of [
    "firestore",
    "HttpsError",
    "ensureWallet",
    "walletRef",
    "anjuPayLedgerConfigRef",
    "walletData",
    "debitPoints",
    "creditPoints",
    "stageAnjuPayOpening",
    "appendAnjuPayEntry",
    "anjuPayWalletMetadataPatch",
    "anjuPayEntryId",
    "mirrorWallet",
    "bestEffort",
    "ownedProductIds",
  ]) {
    assert.match(service, new RegExp(`"${dependency}"`));
  }
  assert.match(index, /createAiTextTrainingService/);
  assert.match(
    index,
    /exports\.aiTextTrainingAction = onCall\(\s*callableOptions\("aiTextTrainingAction"\)/,
  );
});

test("all dedicated persistence is callable-only and public responses reject UIDs", () => {
  for (const collection of [
    "aiTextTrainingPresets",
    "aiTextTrainingSellerProfiles",
    "aiTextTrainingPreferences",
    "aiTextTrainingUses",
    "aiTextTrainingActiveUses",
    "aiTextTrainingPublishActions",
    "aiTextTrainingSellerStats",
    "aiTextTrainingMonthlyPeriods",
    "aiTextTrainingRankingPairs",
    "aiTextTrainingSellerBuyerPairs",
    "aiTextTrainingMonthlyBuyerPairs",
    "aiTextTrainingPresetRevisionBuyers",
    "aiTextTrainingReports",
  ]) {
    assert.match(service, new RegExp(`collection\\("${collection}"\\)`));
    assert.match(
      rules,
      new RegExp(`match /${collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`),
    );
  }
  assert.match(
    service,
    /PRIVATE_RESPONSE_FIELDS[\s\S]*?"sellerUid"[\s\S]*?"buyerUid"[\s\S]*?"reporterUid"/,
  );
  assert.match(service, /function assertNoPrivateFields/);
  assert.match(service, /assertNoPrivateFields\(result\)/);
});

test("paid use validates displayed revision, price, and balance before atomic wallet writes", () => {
  const start = between("async function startPaidUse", "async function resumeUse");
  assert.match(start, /expectedPrice/);
  assert.match(start, /expectedRevision/);
  assert.match(start, /expectedBalance/);
  assert.match(start, /buyerBefore !== expectedBalance/);
  assert.match(start, /payloadHash/);
  assert.match(start, /aiTextTrainingUseId\(uid, actionId\)/);
  assert.match(start, /transaction\.get\(useReference\)/);
  assert.match(start, /transaction\.get\(buyerWalletReference\)/);
  assert.match(start, /transaction\.get\(sellerWalletReference\)/);
  assert.match(start, /transaction\.get\(anjuPayLedgerConfigRef\(\)\)/);
  assert.match(start, /debitPoints\(buyerWallet, settlement\.price\)/);
  assert.match(start, /creditPoints\(sellerWallet, settlement\.sellerProceeds\)/);
  assert.match(start, /appendAnjuPayEntry\([\s\S]*?buyerWalletReference/);
  assert.match(start, /appendAnjuPayEntry\([\s\S]*?sellerWalletReference/);
  assert.match(start, /transaction\.create\(useReference, storedUse\)/);
  assert.match(start, /transaction\.set\(activeReference/);

  const firstWrite = start.search(/transaction\.(?:create|set|update|delete)\(/);
  const lastRead = start.lastIndexOf("transaction.get(");
  assert.ok(lastRead < firstWrite, "transaction reads must finish before its first write");
});

test("terminal use, report revision, and idempotent wallet mirrors are guarded", () => {
  const resume = between("async function resumeUse", "async function finishUse");
  assert.match(resume, /ACTIVE_USE_STATUSES\.has\(snapshot\.get\("status"\)\)/);
  assert.match(resume, /activeSnapshot\.get\("useId"\) !== useId/);

  const report = between("async function report", "async function performAction");
  assert.match(report, /expectedRevision/);
  assert.match(report, /presetRevision !== expectedRevision/);
  assert.match(report, /presetRevision/);
  assert.match(report, /reportRef\(presetId, presetRevision, uid\)/);
  assert.match(report, /presetSnapshot: reportedPreset/);
  assert.match(report, /VERIFIED_BUYER_QUARANTINE_THRESHOLD/);
  assert.match(report, /status: "hidden"/);
  assert.match(report, /moderationStatus: "quarantined"/);
  assert.match(report, /transaction\.set\(profileRef\([\s\S]*?xPublic: false/);

  const profile = between("async function saveProfile", "function publicRankingRow");
  assert.match(profile, /firestore\.runTransaction/);
  assert.match(profile, /transaction\.get\(reference\)/);
  assert.match(profile, /moderationStatus"\) === "quarantined"/);
  assert.match(profile, /transaction\.set\(profileReference, stored\)/);

  const publish = between("async function publish", "async function unpublish");
  assert.match(publish, /wallet\.balance !== expectedBalance/);
  assert.match(
    publish,
    /if \(actionSnapshot\.exists\)[\s\S]*?balance: walletData\(walletSnapshot\)\.balance/,
  );
  const start = between("async function startPaidUse", "async function resumeUse");
  assert.match(start, /const stillActive = ACTIVE_USE_STATUSES\.has\(saved\.status\)/);
  assert.match(start, /terminalAction: true/);
});

test("daily ranking contribution and actual settlement are deliberately separate", () => {
  const start = between("async function startPaidUse", "async function resumeUse");
  assert.match(start, /const rankingCounted = !dailyPairSnapshot\.exists/);
  assert.match(service, /actualGross: current\.actualGross \+ settlement\.price/);
  assert.match(
    service,
    /rankingGross: current\.rankingGross \+ \(rankingCounted \? settlement\.price : 0\)/,
  );
  assert.match(start, /uniqueLifetimeBuyer/);
  assert.match(start, /uniqueMonthlyBuyer/);
  assert.match(start, /sellerProceeds: settlement\.sellerProceeds/);
});

test("browse index and large-script index exemptions are declared", () => {
  const indexes = JSON.parse(read("firestore.indexes.json"));
  assert.ok(indexes.indexes.some((indexDefinition) => (
    indexDefinition.collectionGroup === "aiTextTrainingPresets"
    && ["status", "modeId", "actualUseCount"].every((fieldPath) => (
      indexDefinition.fields.some((field) => field.fieldPath === fieldPath)
    ))
  )));
  assert.ok(indexes.fieldOverrides.some((override) => (
    override.collectionGroup === "aiTextTrainingPresets"
    && override.fieldPath === "lines"
    && Array.isArray(override.indexes)
    && override.indexes.length === 0
  )));
  assert.ok(indexes.fieldOverrides.some((override) => (
    override.collectionGroup === "aiTextTrainingUses"
    && override.fieldPath === "presetSnapshot.lines"
  )));
  assert.ok(indexes.fieldOverrides.some((override) => (
    override.collectionGroup === "aiTextTrainingReports"
    && override.fieldPath === "presetSnapshot.lines"
  )));
});

test("account transfer refuses a supposedly pristine target with solo-market history", () => {
  assert.match(
    index,
    /firestore\.collection\("aiTextTrainingPresets"\)\.where\("sellerUid", "==", uid\)\.limit\(1\)\.get\(\)/,
  );
  assert.match(
    index,
    /firestore\.collection\("aiTextTrainingUses"\)\.where\("buyerUid", "==", uid\)\.limit\(1\)\.get\(\)/,
  );
  assert.match(
    index,
    /firestore\.collection\("aiTextTrainingReports"\)\.where\("reporterUid", "==", uid\)\.limit\(1\)\.get\(\)/,
  );
  assert.match(index, /aiTextTrainingProfileSnapshot\.exists/);
  assert.match(index, /aiTextTrainingPreferencesSnapshot\.exists/);
  assert.match(
    index,
    /transaction\.get\(\s*firestore\.collection\("aiTextTrainingPresets"\)[\s\S]*?\.where\("sellerUid", "==", targetUid\)[\s\S]*?\.limit\(1\)/,
  );
  assert.match(
    index,
    /transaction\.get\(\s*firestore\.collection\("aiTextTrainingUses"\)[\s\S]*?\.where\("buyerUid", "==", targetUid\)[\s\S]*?\.limit\(1\)/,
  );
  assert.match(
    index,
    /transaction\.get\(\s*firestore\.collection\("aiTextTrainingReports"\)[\s\S]*?\.where\("reporterUid", "==", targetUid\)[\s\S]*?\.limit\(1\)/,
  );
  assert.match(index, /targetAiTextTrainingProfileSnapshot\.exists/);
  assert.match(index, /targetAiTextTrainingPreferencesSnapshot\.exists/);
});
