const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const lifecycleModule = import(pathToFileURL(path.join(root, "online-room-lifecycle.mjs")).href);
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function createRoomState({
  generation = 7,
  roomId = "room-a",
  ownUid = "own-a",
  opponentUid = "opponent-a",
  round = 1,
} = {}) {
  return {
    matchmakingGeneration: generation,
    roomId,
    uid: ownUid,
    opponentUid,
    round,
    destroyedByOpponent: false,
    roomTerminationToken: null,
    screen: "reveal",
  };
}

test("room and round guards reject callbacks from an older room or round", async () => {
  const {
    captureOnlineRoomContext,
    captureOnlineRoundContext,
    isOnlineRoomContextCurrent,
    isOnlineRoundContextCurrent,
  } = await lifecycleModule;
  const roomA = createRoomState();
  const roomContext = captureOnlineRoomContext(roomA);
  const roundOneContext = captureOnlineRoundContext(roomContext, 1);

  assert.equal(isOnlineRoomContextCurrent(roomContext, {
    active: true,
    currentState: roomA,
  }), true);
  assert.equal(isOnlineRoundContextCurrent(roundOneContext, {
    active: true,
    currentState: roomA,
  }), true);

  roomA.round = 2;
  assert.equal(isOnlineRoundContextCurrent(roundOneContext, {
    active: true,
    currentState: roomA,
  }), false);

  roomA.round = 1;
  roomA.roomTerminationToken = { type: "local-destroy" };
  assert.equal(isOnlineRoomContextCurrent(roomContext, {
    active: true,
    currentState: roomA,
  }), false);

  const roomB = createRoomState({ roomId: "room-b", round: 1 });
  assert.equal(isOnlineRoomContextCurrent(roomContext, {
    active: true,
    currentState: roomB,
  }), false);
});

test("an old room destroyed marker cannot clean up or replace the current room", async () => {
  const {
    captureOnlineRoomContext,
    isOnlineRoomContextCurrent,
    isOnlineSameRoomIdentity,
    runOnlineOpponentDestroyedTransition,
  } = await lifecycleModule;
  const roomA = createRoomState();
  const roomB = createRoomState({ roomId: "room-b" });
  const context = captureOnlineRoomContext(roomA);
  let currentState = roomB;
  let cleanupCalls = 0;
  let finalizeCalls = 0;

  const applied = await runOnlineOpponentDestroyedTransition({
    context,
    marker: { by: "opponent-a" },
    isCurrent: () => isOnlineRoomContextCurrent(context, {
      active: true,
      currentState,
    }),
    cleanup: async () => { cleanupCalls += 1; },
    isStillSameRoom: () => isOnlineSameRoomIdentity(context, {
      active: true,
      currentState,
    }),
    finalize: () => {
      finalizeCalls += 1;
      currentState.screen = "noContest";
    },
  });

  assert.equal(applied, false);
  assert.equal(cleanupCalls, 0);
  assert.equal(finalizeCalls, 0);
  assert.equal(roomB.screen, "reveal");
});

test("state replacement while cleanup is awaiting cannot render NO CONTEST in the new room", async () => {
  const {
    captureOnlineRoomContext,
    isOnlineRoomContextCurrent,
    isOnlineSameRoomIdentity,
    runOnlineOpponentDestroyedTransition,
  } = await lifecycleModule;
  const roomA = createRoomState();
  const roomB = createRoomState({ roomId: "room-b" });
  const context = captureOnlineRoomContext(roomA);
  let currentState = roomA;
  let cleanupTarget = null;
  let finalizeCalls = 0;
  let releaseCleanup;
  const cleanupGate = new Promise((resolve) => { releaseCleanup = resolve; });

  const transition = runOnlineOpponentDestroyedTransition({
    context,
    marker: { by: "opponent-a" },
    isCurrent: () => isOnlineRoomContextCurrent(context, {
      active: true,
      currentState,
    }),
    cleanup: async (targetState) => {
      cleanupTarget = targetState;
      await cleanupGate;
    },
    isStillSameRoom: () => isOnlineSameRoomIdentity(context, {
      active: true,
      currentState,
    }),
    finalize: () => {
      finalizeCalls += 1;
      currentState.screen = "noContest";
    },
  });

  await Promise.resolve();
  currentState = roomB;
  releaseCleanup();

  assert.equal(await transition, false);
  assert.equal(cleanupTarget, roomA);
  assert.equal(finalizeCalls, 0);
  assert.equal(roomB.screen, "reveal");
});

test("only the exact opponent marker can claim the room termination once", async () => {
  const {
    captureOnlineRoomContext,
    isOnlineRoomContextCurrent,
    isOnlineSameRoomIdentity,
    runOnlineOpponentDestroyedTransition,
  } = await lifecycleModule;
  const room = createRoomState();
  const context = captureOnlineRoomContext(room);
  let cleanupCalls = 0;
  let finalizeCalls = 0;
  const options = (marker) => ({
    context,
    marker,
    isCurrent: () => isOnlineRoomContextCurrent(context, {
      active: true,
      currentState: room,
    }),
    cleanup: async () => {
      cleanupCalls += 1;
      room.matchmakingGeneration += 1;
    },
    isStillSameRoom: () => isOnlineSameRoomIdentity(context, {
      active: true,
      currentState: room,
    }),
    finalize: () => { finalizeCalls += 1; },
  });

  assert.equal(await runOnlineOpponentDestroyedTransition(options({ by: "own-a" })), false);
  assert.equal(await runOnlineOpponentDestroyedTransition(options({ by: "unknown" })), false);
  assert.equal(await runOnlineOpponentDestroyedTransition(options({ by: "opponent-a" })), true);
  assert.equal(await runOnlineOpponentDestroyedTransition(options({ by: "opponent-a" })), false);
  assert.equal(cleanupCalls, 1);
  assert.equal(finalizeCalls, 1);
});

test("only the latest state transition can complete after shared cleanup", async () => {
  const {
    beginOnlineStateTransition,
    isOnlineStateTransitionCurrent,
  } = await lifecycleModule;
  const room = createRoomState();
  const resetToken = beginOnlineStateTransition(room, "reset");
  const leaveToken = beginOnlineStateTransition(room, "leave");

  assert.equal(isOnlineStateTransitionCurrent(room, resetToken, room), false);
  assert.equal(isOnlineStateTransitionCurrent(room, leaveToken, room), true);
  assert.equal(isOnlineStateTransitionCurrent(room, leaveToken, createRoomState()), false);
});

test("normal 1on1 wires room and round contexts through cleanup and transition paths", () => {
  const source = read("online.js");
  assert.match(source, /from "\.\/online-room-lifecycle\.mjs\?v=online-room-lifecycle-v1"/);
  assert.match(source, /const roomSetupContext = captureOnlineRoomContext\(expectedState/);
  assert.match(source, /handleOpponentDestroyed\(context, snapshot\.val\(\)\)\.catch\(handleRecoverableError\)/);
  assert.match(source, /function listenToRound\(roomContext\)/);
  assert.match(source, /captureOnlineRoundContext\(roomContext, targetState\.round\)/);
  assert.match(source, /if \(!isCurrentRoundContext\(roundContext\)\) return;/);
  assert.match(source, /reactToRoundData\(roundContext, roundData\)/);
  assert.match(source, /function advanceAfterRound\(roundContext\)/);
  assert.match(source, /listenToRound\(roundContext\.roomContext\)/);
  assert.match(source, /finishOnlineMatch\(roundContext\)/);
  assert.match(source, /settleOnlineMatch\(roundContext\)/);
  assert.doesNotMatch(source, /function listenToRound\(contextIsCurrent = \(\) => true\)/);
  const reactionStart = source.indexOf("async function reactToRoundData");
  const reactionEnd = source.indexOf("async function sendSelectedImage", reactionStart);
  const reaction = source.slice(reactionStart, reactionEnd);
  const sendIndex = reaction.indexOf("await sendSelectedImage()");
  const recheckIndex = reaction.indexOf("if (!contextIsCurrent()) return", sendIndex);
  const scoresIndex = reaction.indexOf("const scores =", sendIndex);
  assert.ok(sendIndex >= 0 && recheckIndex > sendIndex && scoresIndex > recheckIndex);
  assert.match(source, /function configureDataChannel\(channel, expectedState = state\)/);
  assert.match(source, /handleChannelMessage\(data, expectedState, channel\)/);
  assert.match(source, /async function handleChannelMessage\(data, expectedState = state, expectedChannel = expectedState\.channel\)/);
  assert.ok(
    (source.match(/const chunk = data instanceof Blob \? await data\.arrayBuffer\(\) : data;\s*if \(!contextIsCurrent\(\)\) return;/g) || []).length >= 3,
    "every binary image namespace must recheck its room after Blob conversion",
  );

  assert.match(source, /\[data-online-destroy\][\s\S]*?addEventListener\("click", openDestroyDialog\)/);
  const requestStart = source.indexOf("function openDestroyDialog()");
  const requestEnd = source.indexOf("async function handleOpponentDestroyed", requestStart);
  const destroyFlow = source.slice(requestStart, requestEnd);
  assert.match(destroyFlow, /const context = captureOnlineRoomContext\(state\)/);
  assert.match(destroyFlow, /pendingDestroyContext = context/);
  assert.match(destroyFlow, /destroyDialog\.showModal\(\)/);
  assert.match(destroyFlow, /getResolvedMatchResultForRound\(state\.round, state\)/);
  assert.match(destroyFlow, /const context = pendingDestroyContext/);
  assert.match(destroyFlow, /if \(!isCurrentRoomSetupContext\(context\)\) return/);
  assert.ok(
    (destroyFlow.match(/await preserveResolvedMatchBeforeP2pCleanup\(expectedState\)/g) || []).length >= 2,
    "destroy confirmation must recheck final resolution before and after the write",
  );
  assert.match(destroyFlow, /online\/rooms\/\$\{context\.roomId\}\/destroyed/);
  assert.match(destroyFlow, /by: context\.ownUid/);
  const destroyWriteIndex = destroyFlow.indexOf("await runTransaction(");
  const destroyCleanupIndex = destroyFlow.indexOf(
    "await cleanupOnlineResources(false, expectedState)",
    destroyWriteIndex,
  );
  assert.ok(
    destroyWriteIndex >= 0
      && destroyCleanupIndex > destroyWriteIndex
  );
  assert.doesNotMatch(destroyFlow, /Promise\.all\(\[destroyWrite, cleanupPromise\]\)/);
  assert.match(source, /beginOnlineStateTransition\(expectedState, "cancel-matching"\)/);
  assert.match(source, /beginOnlineStateTransition\(expectedState, `reset:\$\{screen\}`\)/);
  assert.match(source, /beginOnlineStateTransition\(expectedState, "leave"\)/);
  const settlementStart = source.indexOf("async function settleOnlineMatch(roundContext)");
  const finishStart = source.indexOf("async function finishOnlineMatch(roundContext)", settlementStart);
  const finishEnd = source.indexOf("function calculateRating", finishStart);
  const settlementFlow = source.slice(settlementStart, finishStart);
  const finishFlow = source.slice(finishStart, finishEnd);
  const finishClaimIndex = settlementFlow.indexOf("await ensureOnlineResultClaim(expectedState, outcome, roundContext)");
  const finishClaimRecheck = settlementFlow.indexOf("!isCurrentRoundContext(roundContext)", finishClaimIndex);
  const finishStatsIndex = settlementFlow.indexOf("await commitOnlineStats(expectedState, outcome, roundContext)");
  const finishStatsRecheck = settlementFlow.indexOf("!isCurrentRoundContext(roundContext)", finishStatsIndex);
  const finishScreenIndex = finishFlow.indexOf('expectedState.screen = "gameover"');
  assert.ok(settlementStart >= 0 && finishStart > settlementStart && finishEnd > finishStart);
  assert.ok(
    finishClaimIndex >= 0
      && finishClaimRecheck > finishClaimIndex
      && finishStatsIndex > finishClaimRecheck
      && finishStatsRecheck > finishStatsIndex
      && finishScreenIndex >= 0,
  );
  assert.match(settlementFlow, /expectedState\.matchFinalizationPromise/);
  assert.match(finishFlow, /const settled = await settleOnlineMatch\(roundContext\)/);
  const statsStart = source.indexOf("async function commitOnlineStats(targetState, outcome, roundContext)");
  const statsEnd = source.indexOf("async function sendChat", statsStart);
  const statsFlow = source.slice(statsStart, statsEnd);
  assert.ok(statsStart >= 0 && statsEnd > statsStart);
  assert.match(statsFlow, /if \(!isCurrentRoundContext\(roundContext\)\) return false/);
  assert.match(statsFlow, /if \(targetState\.statsCommitted\) return true/);
  assert.match(statsFlow, /targetState\.statsCommitInFlight = true/);
  assert.match(statsFlow, /lastResultRoomId: targetState\.roomId/);
  assert.match(statsFlow, /lastResultOutcome: periodOutcome/);
  assert.match(statsFlow, /targetState\.statsCommitted = true/);
  assert.match(statsFlow, /finally \{[\s\S]*?targetState\.statsCommitInFlight = false/);
  assert.match(statsFlow, /sourceState: targetState/);
  assert.doesNotMatch(statsFlow, /\bstate\./);
  const cancelStart = source.indexOf("async function cancelMatching()");
  const cancelEnd = source.indexOf("async function resetOnlineSetup", cancelStart);
  const cancelFlow = source.slice(cancelStart, cancelEnd);
  assert.match(cancelFlow, /await cleanupOnlineResources\(false, expectedState\)/);
  assert.doesNotMatch(cancelFlow, /await cleanupMatchmaking\(/);

  const cleanupStart = source.indexOf("async function cleanupOnlineResources");
  const cleanupEnd = source.indexOf("function releaseRemoteImage", cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.match(cleanup, /targetState\.roomUnsubscribers\.splice\(0\)/);
  assert.match(cleanup, /targetState\.roundUnsubscribe\?\.\(\)/);
  assert.ok(
    cleanup.indexOf("targetState.roomUnsubscribers.splice(0)")
      < cleanup.indexOf("await cleanupMatchmaking"),
  );
  assert.match(cleanup, /cleanupMatchmaking\(keepActive, targetState\)/);
  assert.match(cleanup, /cleanupPublicPresence\(targetState\)/);
  assert.match(cleanup, /if \(targetState\.cleanupPromise\)/);

  const publicCleanupStart = source.indexOf("async function cleanupPublicPresence");
  const publicCleanupEnd = source.indexOf("function processIncomingOffers", publicCleanupStart);
  const publicCleanup = source.slice(publicCleanupStart, publicCleanupEnd);
  const presenceRemoval = publicCleanup.indexOf("online/publicPresence/${presenceId}");
  const ownerRemoval = publicCleanup.indexOf("online/publicPresenceOwners/${presenceId}");
  assert.ok(publicCleanupStart >= 0 && publicCleanupEnd > publicCleanupStart);
  assert.ok(presenceRemoval >= 0 && ownerRemoval > presenceRemoval);
});
