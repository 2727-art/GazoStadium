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
    "syncAchievementPublicSurfaces",
    "ownedProductIds",
  ]) {
    assert.match(service, new RegExp(`"${dependency}"`));
  }
  assert.match(index, /createAiTextTrainingService/);
  const injectionStart = index.indexOf(
    "const aiTextTrainingService = createAiTextTrainingService({",
  );
  const injectionEnd = index.indexOf(
    "exports.aiTextTrainingAction = onCall(",
    injectionStart,
  );
  assert.notEqual(injectionStart, -1);
  assert.notEqual(injectionEnd, -1);
  assert.match(
    index.slice(injectionStart, injectionEnd),
    /syncAchievementPublicSurfaces/,
  );
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
    "aiTextTrainingAchievementSessions",
    "aiTextTrainingActiveAchievementSessions",
    "aiTextTrainingPlayerStats",
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

test("achievement sessions are server-timed, idempotent, private, and unlock in their finish transaction", () => {
  const begin = between(
    "async function beginAchievementSession",
    "async function finishAchievementSession",
  );
  assert.match(service, /"begin_achievement_session"/);
  assert.match(service, /"finish_achievement_session"/);
  assert.match(begin, /normalizeAiTextTrainingActionId/);
  assert.match(begin, /normalizeAiTextTrainingMode/);
  assert.match(begin, /AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_SECONDS/);
  assert.match(begin, /AI_TEXT_TRAINING_ACHIEVEMENT_BEGIN_COOLDOWN_MS/);
  assert.match(begin, /aiTextTrainingActionDocumentId\(\s*uid,\s*actionId,\s*"achievement-session"/);
  assert.match(begin, /payloadHash/);
  assert.match(begin, /transaction\.get\(statsReference\)/);
  assert.match(begin, /lastAchievementSessionStartedAt/);
  assert.match(begin, /"resource-exhausted"/);
  assert.match(begin, /deleteAt: achievementSessionDeleteAt\(now, now\)/);
  assert.match(begin, /transaction\.create\(reference, stored\)/);
  assert.match(begin, /transaction\.set\(activeReference/);
  assert.match(begin, /supersededAt/);
  assert.doesNotMatch(begin, /\b(?:images|script|lines)\s*:/);

  const finish = between(
    "async function finishAchievementSession",
    "async function publish",
  );
  assert.match(finish, /now - safeInteger\(stored\.startedAt\) < expectedActiveSeconds \* 1_000/);
  assert.match(finish, /Math\.abs\(activeSeconds - expectedActiveSeconds\)/);
  assert.match(finish, /completedRounds !== AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT/);
  assert.match(finish, /normalizeAiTextTrainingStats\(statsSnapshot\.data\(\)\)/);
  assert.match(finish, /scope: "ai_training"/);
  assert.match(finish, /unlockAchievements/);
  assert.match(finish, /transaction\.set\(statsReference, nextStats\)/);
  assert.match(finish, /transaction\.set\(profileReference, unlockResult\.profile\)/);
  assert.match(finish, /transaction\.delete\(activeReference\)/);
  assert.match(finish, /idempotent: true/);
  assert.match(
    finish,
    /stored\.status === "completed" && profileSnapshot\.exists/,
  );
  assert.match(
    finish,
    /bestEffortAchievementSync\(\s*"ai-text-training-achievement-showcase",\s*uid,\s*achievementProfileToSync/,
  );
  assert.doesNotMatch(
    finish,
    /result\.(?:sellerUid|achievementProfileToSync)\s*=/,
  );
});

test("paid use validates displayed revision, price, and balance before atomic wallet writes", () => {
  const start = between("async function startPaidUse", "async function resumeUse");
  assert.match(start, /normalizeAiTextTrainingPlayStyle/);
  assert.match(start, /productType === "defeat_zone" && playStyle !== "defeat_zone"/);
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
  assert.match(start, /presetSnapshot: snapshot/);
  assert.match(start, /productType/);
  assert.match(start, /zoneLines/);
  assert.match(start, /playStyle/);

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
  assert.match(publish, /aiTextTrainingPresetId\(uid, input\.modeId, input\.productType\)/);
  assert.match(publish, /presetModerationPayload\(input\)/);
  assert.match(publish, /presetModerationPayload\(presetSnapshot\.data\(\)\)/);
  assert.match(publish, /zoneLines: input\.zoneLines/);
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
  assert.match(start, /rankingUseCount: nextStats\.rankingUseCount/);
  assert.match(start, /uniqueBuyers: nextStats\.uniqueBuyers/);
  assert.match(start, /scope: "ai_training"/);
  assert.match(start, /transaction\.set\(sellerAchievementReference, sellerUnlockResult\.profile\)/);
  assert.match(
    start,
    /sellerAchievementProfileToSync = sellerUnlockResult\.profile/,
  );
  assert.match(
    start,
    /bestEffortAchievementSync\(\s*"ai-text-training-seller-achievement-showcase",\s*preliminarySellerUid,\s*sellerAchievementProfileToSync/,
  );
  assert.doesNotMatch(
    start,
    /result\.(?:sellerUid|sellerAchievementProfileToSync)\s*=/,
  );
});

test("browse index and large-script index exemptions are declared", () => {
  const indexes = JSON.parse(read("firestore.indexes.json"));
  assert.ok(indexes.indexes.some((indexDefinition) => (
    indexDefinition.collectionGroup === "aiTextTrainingPresets"
    && ["status", "modeId", "actualUseCount"].every((fieldPath) => (
      indexDefinition.fields.some((field) => field.fieldPath === fieldPath)
    ))
  )));
  assert.ok(indexes.indexes.some((indexDefinition) => (
    indexDefinition.collectionGroup === "aiTextTrainingPresets"
    && ["status", "modeId", "productType", "actualUseCount"].every((fieldPath) => (
      indexDefinition.fields.some((field) => field.fieldPath === fieldPath)
    ))
  )));
  assert.ok(indexes.fieldOverrides.some((override) => (
    override.collectionGroup === "aiTextTrainingPresets"
    && override.fieldPath === "lines"
    && Array.isArray(override.indexes)
    && override.indexes.length === 0
  )));
  for (const [collectionGroup, fieldPath] of [
    ["aiTextTrainingPresets", "zoneLines"],
    ["aiTextTrainingUses", "presetSnapshot.zoneLines"],
    ["aiTextTrainingReports", "presetSnapshot.zoneLines"],
    ["aiTextTrainingPublishActions", "preset.zoneLines"],
    ["revisions", "lines"],
    ["revisions", "zoneLines"],
  ]) {
    assert.ok(indexes.fieldOverrides.some((override) => (
      override.collectionGroup === collectionGroup
      && override.fieldPath === fieldPath
      && Array.isArray(override.indexes)
      && override.indexes.length === 0
    )), `missing index exemption ${collectionGroup}.${fieldPath}`);
  }
  assert.ok(indexes.fieldOverrides.some((override) => (
    override.collectionGroup === "aiTextTrainingUses"
    && override.fieldPath === "presetSnapshot.lines"
  )));
  assert.ok(indexes.fieldOverrides.some((override) => (
    override.collectionGroup === "aiTextTrainingReports"
    && override.fieldPath === "presetSnapshot.lines"
  )));
  assert.ok(indexes.fieldOverrides.some((override) => (
    override.collectionGroup === "aiTextTrainingAchievementSessions"
    && override.fieldPath === "deleteAt"
    && override.ttl === true
    && Array.isArray(override.indexes)
    && override.indexes.length === 0
  )));
});

test("standard browse pages past ZONE rows and seller safety checks cover all six products", () => {
  const browse = between("async function getBrowsePresets", "async function getState");
  assert.match(browse, /requestedProductType === "standard"/);
  assert.match(browse, /pageQuery\.startAfter\(cursor\)/);
  assert.match(browse, /storedProductType\(document\.get\("productType"\)\) === "standard"/);
  const state = between("async function getState", "async function browse");
  assert.match(state, /\.limit\(6\)\.get\(\)/);
  const profile = between("async function saveProfile", "function publicRankingRow");
  assert.match(profile, /AI_TEXT_TRAINING_MODES\.flatMap/);
  assert.match(profile, /AI_TEXT_TRAINING_PRODUCT_TYPES\.map/);
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
