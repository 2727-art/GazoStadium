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

test("trainingV6Action wires the V6 service behind mandatory App Check", () => {
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.trainingV6Action, true);
  assert.match(source, /createTrainingSessionV6Service/);
  assert.match(source, /executeTrainingV6Settlement/);
  assert.match(
    source,
    /exports\.trainingV6Action = onCall\(\s*callableOptions\("trainingV6Action"\)/,
  );
  const callable = between(
    "exports.trainingV6Action = onCall",
    "exports.trainingAction = onCall",
  );
  assert.match(callable, /const uid = requireUid\(request\)/);
  assert.match(callable, /dispatchTrainingV6Action\(uid, request\.data\)/);
  assert.doesNotMatch(callable, /RATE|rating|ranking|wallet/);
});

test("V6 settlement atomically applies private training state and dedicated claims", () => {
  assert.match(
    source,
    /firestore\.collection\("trainingV6Claims"\)\.doc\(uid\)\.collection\("rooms"\)\.doc\(roomId\)/,
  );
  const settlement = between(
    "async function settleTrainingV6Room(uid, room, now = Date.now())",
    "async function dispatchTrainingV6Action(uid, data)",
  );
  assert.match(settlement, /executeTrainingV6Settlement/);
  assert.match(settlement, /firestore\.runTransaction/);
  assert.match(settlement, /transaction\.get\(trainingV6ClaimRef/);
  assert.match(settlement, /transaction\.create\(\s*trainingV6ClaimRef/);
  assert.match(settlement, /trainingProfileRef/);
  assert.match(settlement, /economyProgressRef/);
  assert.match(settlement, /achievementProfileRef/);
  assert.match(settlement, /applyTrainingSession/);
  assert.match(settlement, /trainingDailySettlement/);
  assert.match(settlement, /scope:\s*"training"/);
  assert.match(settlement, /progress\.daily\.trainingMatches/);
  assert.match(settlement, /progress\.daily\.trainingSets/);
  assert.match(settlement, /progress\.daily\.trainingSeconds/);

  const applyParticipants = settlement.slice(
    settlement.indexOf("applyParticipants:"),
    settlement.indexOf("createClaim:", settlement.indexOf("applyParticipants:")),
  );
  assert.ok(
    applyParticipants.lastIndexOf("transaction.get")
      < applyParticipants.indexOf("transaction.set"),
    "all participant reads must precede the first participant write",
  );
});

test("V6 settlement mirrors only after commit and never enters competitive systems", () => {
  const settlement = between(
    "async function settleTrainingV6Room(uid, room, now = Date.now())",
    "async function dispatchTrainingV6Action(uid, data)",
  );
  const executeAt = settlement.indexOf("await executeTrainingV6Settlement");
  const bestEffortAt = settlement.indexOf("await bestEffort");
  assert.ok(executeAt >= 0 && bestEffortAt > executeAt);
  assert.match(settlement, /mirrorEconomyProgress/);
  assert.match(settlement, /syncAchievementPublicSurfaces/);
  assert.match(
    settlement,
    /settlement\.decision\.participants\.map/,
  );
  for (const forbidden of [
    "addVerifiedMatch",
    "addBattleMatch",
    "periodRewards[",
    "dailyPlayClaims",
    "serverRanking",
    "crown",
    "postMatchTip",
    "rating",
    "walletRef",
  ]) {
    assert.equal(settlement.includes(forbidden), false, forbidden);
  }
});

test("terminal V6 responses return the caller settlement and private projections", () => {
  const dispatch = between(
    "async function dispatchTrainingV6Action(uid, data)",
    "function trainingServerFinalizationMatches",
  );
  assert.match(dispatch, /\["complete", "no_contest"\]/);
  assert.match(dispatch, /settleTrainingV6Room\(uid, room\)/);
  assert.match(
    dispatch,
    /acknowledgeFinalization\(room\.roomId, terminalAt\)/,
  );
  assert.ok(
    dispatch.indexOf("settleTrainingV6Room(uid, room)")
      < dispatch.indexOf("acknowledgeFinalization(room.roomId, terminalAt)"),
    "the outbox ACK must happen only after canonical settlement succeeds",
  );
  assert.match(dispatch, /scheduled reconciler can retry only the ACK/);
  assert.match(dispatch, /\.\.\.actionResult/);
  assert.match(dispatch, /\.\.\.settlementResult/);

  const callerState = between(
    "async function readTrainingV6PrivateState(uid, now)",
    "function publicTrainingV6SettlementResult",
  );
  assert.match(callerState, /profile,/);
  assert.match(callerState, /daily:\s*state\.progress\.daily/);
  assert.match(callerState, /achievements:\s*publicAchievementProfile/);
});

test("scheduled cleanup reconciles and ACKs V6 finalizations before deleting V6 state", () => {
  const reconciler = between(
    "async function reconcilePendingTrainingV6Finalizations",
    "function trainingServerFinalizationMatches",
  );
  assert.match(
    reconciler,
    /trainingSessionV6Service\.pendingFinalizations\(limit\)/,
  );
  assert.match(
    reconciler,
    /settleTrainingV6Room\(participantUid, room, now\)/,
  );
  assert.match(
    reconciler,
    /acknowledgeFinalization\(roomId, terminalAt\)/,
  );
  assert.ok(
    reconciler.indexOf("settleTrainingV6Room(participantUid, room, now)")
      < reconciler.indexOf("acknowledgeFinalization(roomId, terminalAt)"),
  );

  const scheduled = between(
    "exports.cleanupTrainingRooms = onSchedule",
    "async function saveMarketPublicProfile",
  );
  assert.match(
    scheduled,
    /await reconcilePendingTrainingV6Finalizations\(now\)/,
  );
  assert.match(scheduled, /trainingSessionV6Service\.cleanup\(now\)/);
  assert.ok(
    scheduled.indexOf("await reconcilePendingTrainingV6Finalizations(now)")
      < scheduled.indexOf("trainingSessionV6Service.cleanup(now)"),
    "pending settlement must finish before V6 cleanup begins",
  );
  assert.match(scheduled, /trainingV6:\s*\{/);
  assert.match(scheduled, /finalizations:\s*trainingV6Finalizations/);
  assert.match(scheduled, /cleanup:\s*trainingV6Cleanup/);
});
