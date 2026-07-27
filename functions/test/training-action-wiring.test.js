"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const rollout = require("../app-check-rollout");

const functionsRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(functionsRoot, "index.js"), "utf8");

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} section must exist`);
  return source.slice(start, end);
}

test("trainingAction is an authenticated, App Check enforced callable", () => {
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.trainingAction, true);
  assert.match(
    source,
    /exports\.trainingAction = onCall\(callableOptions\("trainingAction"\)/,
  );
  const callable = between(
    "exports.trainingAction = onCall",
    "exports.economyAction = onCall",
  );
  assert.match(callable, /const uid = requireUid\(request\)/);
  assert.match(callable, /action === "initialize"/);
  assert.match(callable, /action === "finalize"/);
  assert.match(callable, /\^\[-0-9A-Z_a-z\]\{20\}\$/);
  assert.doesNotMatch(callable, /record_match|claim_daily|RATE|rating/);
});

test("training finalization processes both private profiles and claims exactly once", () => {
  const finalization = between(
    "async function finalizeTraining(uid, roomId, {",
    "const VERIFIED_MATCH_MODES",
  );
  assert.match(source, /firestore\.collection\("trainingProfiles"\)\.doc\(uid\)/);
  assert.match(
    source,
    /firestore\.collection\("trainingClaims"\)\.doc\(uid\)\.collection\("rooms"\)\.doc\(roomId\)/,
  );
  assert.match(finalization, /assertTrainingRoomFinalizable\([\s\S]*\{ maxAgeMs: maxRoomAgeMs \}/);
  assert.match(finalization, /firestore\.runTransaction/);
  assert.match(finalization, /claimSnapshot\.exists/);
  assert.match(finalization, /transaction\.create\(claimRefs\[index\]/);
  assert.match(finalization, /applyTrainingSession/);
  assert.match(finalization, /trainingDailySettlement/);
  assert.match(finalization, /dailySettlement\.creditTrainingSet/);
  assert.match(finalization, /progress\.daily\.trainingSets = 1/);
  assert.match(finalization, /child\("serverFinalized"\)/);
  assert.match(finalization, /status:\s*"pending"/);
  assert.match(finalization, /status:\s*"final"/);
  assert.match(finalization, /completedSets:/);
});

test("training never enters battle economy, RATE, period, ranking, crown, or tip pipelines", () => {
  const finalization = between(
    "async function finalizeTraining(uid, roomId, {",
    "const VERIFIED_MATCH_MODES",
  );
  for (const forbidden of [
    "addVerifiedMatch",
    "addBattleMatch",
    "periodRewards[",
    "dailyPlayClaims",
    "achievementStats",
    "serverRanking",
    "crown",
    "postMatchTip",
    "rating",
    "wallet",
  ]) {
    assert.equal(finalization.includes(forbidden), false, forbidden);
  }
  const modes = between("const VERIFIED_MATCH_MODES", "function objectValue");
  assert.doesNotMatch(modes, /training/);
});

test("training initialization returns today's normalized daily setup state", () => {
  const initialization = between(
    "async function initializeTraining(uid)",
    "function trainingServerFinalizationMatches",
  );
  assert.match(initialization, /transaction\.get\(economyProgressRef|transaction\.get\(progressRef\)/);
  assert.match(initialization, /normalizeEconomyProgress/);
  assert.match(initialization, /jstDateKey\(now\)/);
  assert.match(initialization, /daily,/);
});

test("account transfer treats completed private training history as non-pristine", () => {
  const pristine = between(
    "async function transferTargetIsPristine(uid, request)",
    "async function registerTransferFailure",
  );
  assert.match(pristine, /trainingProfileRef\(uid\)\.get\(\)/);
  assert.match(
    pristine,
    /firestore\.collection\("trainingClaims"\)\.doc\(uid\)\.collection\("rooms"\)\.limit\(1\)\.get\(\)/,
  );
  assert.match(pristine, /trainingProfile\.sessions > 0/);
  assert.match(pristine, /!trainingClaimSnapshot\.empty/);
  const redemption = between(
    "async function redeemAccountTransferCode",
    "async function cancelAccountTransferCode",
  );
  assert.match(redemption, /targetTrainingProfileSnapshot/);
  assert.match(redemption, /transaction\.get\(trainingProfileRef\(targetUid\)\)/);
  assert.match(redemption, /targetTrainingProfile\.sessions > 0/);
  assert.match(redemption, /targetTrainingProfile\.completedSets > 0/);
  assert.match(redemption, /targetTrainingProfile\.completeDays > 0/);
});
