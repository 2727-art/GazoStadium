"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "online.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("normal 1on1 retry delay is jittered exponential backoff capped at 20 seconds", () => {
  const delaySource = sourceBetween(
    "function soloMatchRecoveryDelayMs",
    "function notifySoloMatchRecovery",
  );
  const context = {
    SOLO_MATCH_RECOVERY_BASE_MS: 3_000,
    SOLO_MATCH_RECOVERY_MAX_MS: 20_000,
  };
  vm.createContext(context);
  vm.runInContext(
    `${delaySource}\nthis.soloMatchRecoveryDelayMs = soloMatchRecoveryDelayMs;`,
    context,
  );

  const delay = context.soloMatchRecoveryDelayMs;
  assert.equal(delay(0, 0), 2_550);
  assert.equal(delay(0, 1), 3_450);
  assert.equal(delay(1, 0), 5_100);
  assert.equal(delay(2, 1), 13_800);
  assert.equal(delay(8, 0), 17_000);
  assert.equal(delay(8, 1), 20_000);
});

test("the normal 1on1 traffic change has a Hosting cache marker", () => {
  assert.match(html, /online\.js\?v=[^"]*match-traffic-v1/);
});

test("normal 1on1 starts with listeners and one immediate server match attempt", () => {
  const matching = sourceBetween(
    "async function beginMatchmaking",
    "async function startPublicPresence",
  );
  const queueHeartbeat = sourceBetween(
    "expectedState.queueHeartbeat = window.setInterval",
    "subscribeToOwnOffers(ownOffersRef",
  );

  const subscribeIndex = matching.indexOf(
    "subscribeToOwnOffers(ownOffersRef, expectedState, generation)",
  );
  const connectivityIndex = matching.indexOf(
    "watchSoloMatchConnectivity(ownOffersRef, expectedState, generation)",
  );
  const immediateIndex = matching.indexOf(
    "attemptCurrentSoloMatchmaking(generation)",
  );
  assert.ok(subscribeIndex >= 0);
  assert.ok(connectivityIndex > subscribeIndex);
  assert.ok(immediateIndex > connectivityIndex);
  assert.doesNotMatch(matching, /get\(ownOffersRef\)/);
  assert.doesNotMatch(queueHeartbeat, /attempt(?:Current)?SoloServerMatch|attemptCurrentSoloMatchmaking/);
  assert.doesNotMatch(source, /SOLO_SERVER_MATCH_POLL_MS|startSoloServerMatchPolling|offerPollTimer/);
});

test("own-offer reads are listener-first and get only during bounded recovery", () => {
  const offerRecovery = sourceBetween(
    "function scheduleOwnOfferRecovery",
    "function subscribeToOwnOffers",
  );
  const subscription = sourceBetween(
    "function subscribeToOwnOffers",
    "function watchSoloMatchConnectivity",
  );

  assert.equal((source.match(/get\(ownOffersRef\)/g) || []).length, 1);
  assert.match(offerRecovery, /window\.setTimeout/);
  assert.match(offerRecovery, /expectedState\.offerRecoveryTimer !== timer/);
  assert.match(offerRecovery, /state !== expectedState \|\| !isCurrentMatchmakingGeneration\(generation\)/);
  assert.match(
    offerRecovery,
    /scheduleOwnOfferRecovery\(ownOffersRef, expectedState, generation, \{ preserveBackoff \}\)/,
  );
  assert.match(
    offerRecovery,
    /if \(expectedState\.ownOfferUnsubscribe\)[\s\S]*?offerRecoveryAttempt = 0[\s\S]*?else \{[\s\S]*?subscribeToOwnOffers/,
  );
  assert.match(subscription, /onValue\(ownOffersRef/);
  assert.match(subscription, /clearOwnOfferRecovery\(expectedState\)/);
  assert.match(subscription, /expectedState\.ownOfferUnsubscribe = null/);
  assert.match(subscription, /unsubscribe\?\.\(\)/);
  assert.match(subscription, /scheduleOwnOfferRecovery\(ownOffersRef, expectedState, generation\)/);
  assert.doesNotMatch(subscription, /setInterval|get\(ownOffersRef\)/);
});

test("only transient accept reasons retry the unchanged own offer", () => {
  const reasonSource = sourceBetween(
    "function soloOfferAcceptReasonIsRecoverable",
    "function clearOwnOfferRecovery",
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${reasonSource}\nthis.soloOfferAcceptReasonIsRecoverable = soloOfferAcceptReasonIsRecoverable;`,
    context,
  );

  const isRecoverable = context.soloOfferAcceptReasonIsRecoverable;
  assert.equal(isRecoverable("transition-busy"), true);
  for (const terminalReason of [
    "room-changed",
    "lease-lost",
    "client-upgrade-required",
    "room-invalid",
    "offer-stale",
    "occupied",
    "room-destroyed",
    "not-offered",
    "",
    "unknown-future-reason",
  ]) {
    assert.equal(isRecoverable(terminalReason), false, terminalReason);
  }
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function acceptOfferHarness(callable) {
  const expectedState = {
    screen: "matching",
    roomId: "",
    acceptingOffer: false,
    uid: "guest-a",
    clientSessionId: "session-guest-a",
    clientLeaseToken: "lease-guest-a",
    soloSessionGeneration: "generation-guest-a",
    matchmakingGeneration: 7,
  };
  const ownRecoveryCalls = [];
  const serverRetryCalls = [];
  const callableCalls = [];
  const context = {
    active: true,
    state: expectedState,
    ONLINE_SESSION_PROTOCOL_VERSION: 2,
    database: {},
    enterRoom: async (roomId) => {
      expectedState.roomId = roomId;
    },
    isCurrentMatchmakingGeneration: (generation) => (
      context.active
      && context.state === expectedState
      && expectedState.screen === "matching"
      && !expectedState.roomId
      && expectedState.matchmakingGeneration === generation
    ),
    ref: (_database, targetPath) => ({ targetPath }),
    releaseActiveReservation: async () => true,
    scheduleOwnOfferRecovery: (...args) => {
      ownRecoveryCalls.push(args);
      return true;
    },
    scheduleSoloServerMatchRetry: (...args) => {
      serverRetryCalls.push(args);
      return true;
    },
    soloOfferAcceptReasonIsRecoverable: (reason) => (
      reason === "transition-busy"
    ),
    soloOfferPath: (uid, sessionId) => `online/offersV2/${uid}/${sessionId}`,
    soloSessionActionCallable: async (payload) => {
      callableCalls.push(payload);
      return callable(payload);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${sourceBetween("async function acceptOffer", "async function drainIncomingOffers")}
this.acceptOffer = acceptOffer;`,
    context,
  );
  const offer = {
    protocolVersion: 2,
    toUid: expectedState.uid,
    toSessionId: expectedState.clientSessionId,
    sessions: {
      [expectedState.uid]: { generation: expectedState.soloSessionGeneration },
    },
  };
  return {
    acceptOffer: context.acceptOffer,
    callableCalls,
    context,
    expectedState,
    offer,
    ownRecoveryCalls,
    serverRetryCalls,
  };
}

test("recoverable accept response re-arms the same offer with preserved backoff", async () => {
  const harness = acceptOfferHarness(async () => ({
    data: { accepted: false, reason: "transition-busy" },
  }));

  assert.equal(await harness.acceptOffer("room-a", harness.offer), false);
  assert.equal(harness.callableCalls.length, 1);
  assert.equal(harness.expectedState.acceptingOffer, false);
  assert.equal(harness.expectedState.acceptingOfferRoomId, "");
  assert.equal(harness.ownRecoveryCalls.length, 1);
  assert.equal(
    harness.ownRecoveryCalls[0][0].targetPath,
    `online/offersV2/${harness.expectedState.uid}/${harness.expectedState.clientSessionId}`,
  );
  assert.equal(harness.ownRecoveryCalls[0][1], harness.expectedState);
  assert.equal(harness.ownRecoveryCalls[0][2], 7);
  assert.equal(harness.ownRecoveryCalls[0][3]?.preserveBackoff, true);
});

test("terminal accept response does not retry an unchanged offer", async () => {
  for (const reason of ["room-changed", "offer-stale", "lease-lost", "occupied", "room-invalid"]) {
    const harness = acceptOfferHarness(async () => ({
      data: { accepted: false, reason },
    }));
    assert.equal(await harness.acceptOffer("room-a", harness.offer), false);
    assert.equal(harness.ownRecoveryCalls.length, 0, reason);
  }
});

test("a thrown accept transport error re-arms the unchanged offer", async () => {
  const harness = acceptOfferHarness(async () => {
    throw new Error("network unavailable");
  });
  await assert.rejects(
    harness.acceptOffer("room-a", harness.offer),
    /network unavailable/,
  );
  assert.equal(harness.expectedState.acceptingOffer, false);
  assert.equal(harness.ownRecoveryCalls.length, 1);
  assert.equal(harness.ownRecoveryCalls[0][3]?.preserveBackoff, true);
});

test("accept recovery is single-flight and cannot cross cleanup generation", async () => {
  const firstResponse = deferred();
  const harness = acceptOfferHarness(() => firstResponse.promise);
  const firstAccept = harness.acceptOffer("room-a", harness.offer);
  assert.equal(harness.expectedState.acceptingOffer, true);
  assert.equal(await harness.acceptOffer("room-a", harness.offer), false);
  assert.equal(harness.callableCalls.length, 1);

  harness.expectedState.matchmakingGeneration += 1;
  harness.expectedState.screen = "setup";
  harness.expectedState.acceptingOffer = false;
  harness.expectedState.acceptingOfferRoomId = "";
  firstResponse.resolve({ data: { accepted: false, reason: "transition-busy" } });
  assert.equal(await firstAccept, false);
  assert.equal(harness.ownRecoveryCalls.length, 0);
  assert.equal(harness.serverRetryCalls.length, 0);
});

test("a repeated listener snapshot cannot queue the offer already being accepted", () => {
  let drainCalls = 0;
  const context = {
    state: {
      acceptingOffer: true,
      acceptingOfferRoomId: "room-a",
      pendingIncomingOffer: { roomId: "older-room", offer: {} },
    },
    drainIncomingOffers: () => {
      drainCalls += 1;
      return Promise.resolve();
    },
    handleRecoverableError: () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    `${sourceBetween("function processIncomingOffers", "async function expandMatchmakingScope")}
this.processIncomingOffers = processIncomingOffers;`,
    context,
  );

  context.processIncomingOffers({
    val: () => ({ "room-a": { createdAt: 2 } }),
  });
  assert.equal(context.state.pendingIncomingOffer, null);
  assert.equal(drainCalls, 0);

  context.processIncomingOffers({
    val: () => ({ "room-b": { createdAt: 3 } }),
  });
  assert.equal(context.state.pendingIncomingOffer.roomId, "room-b");
  assert.equal(drainCalls, 1);
});

test("accept finally drains a different pending room without parallel callable accepts", async () => {
  const firstResponse = deferred();
  const secondResponse = deferred();
  const secondStarted = deferred();
  const expectedState = {
    screen: "matching",
    roomId: "",
    acceptingOffer: false,
    acceptingOfferRoomId: "",
    pendingIncomingOffer: null,
    uid: "guest-a",
    clientSessionId: "session-guest-a",
    clientLeaseToken: "lease-guest-a",
    soloSessionGeneration: "generation-guest-a",
    matchmakingGeneration: 11,
  };
  let activeCallableCount = 0;
  let maxActiveCallableCount = 0;
  const callableCalls = [];
  const context = {
    active: true,
    state: expectedState,
    ONLINE_SESSION_PROTOCOL_VERSION: 2,
    database: {},
    enterRoom: async () => {},
    handleRecoverableError: () => {},
    isCurrentMatchmakingGeneration: (generation) => (
      context.active
      && context.state === expectedState
      && expectedState.screen === "matching"
      && !expectedState.roomId
      && expectedState.matchmakingGeneration === generation
    ),
    ref: (_database, targetPath) => ({ targetPath }),
    releaseActiveReservation: async () => true,
    scheduleOwnOfferRecovery: () => true,
    scheduleSoloServerMatchRetry: () => true,
    soloOfferAcceptReasonIsRecoverable: (reason) => reason === "transition-busy",
    soloOfferPath: (uid, sessionId) => `online/offersV2/${uid}/${sessionId}`,
    soloSessionActionCallable: async (payload) => {
      const callIndex = callableCalls.length;
      callableCalls.push(payload);
      activeCallableCount += 1;
      maxActiveCallableCount = Math.max(maxActiveCallableCount, activeCallableCount);
      if (callIndex === 1) secondStarted.resolve();
      try {
        return await (callIndex === 0 ? firstResponse.promise : secondResponse.promise);
      } finally {
        activeCallableCount -= 1;
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${sourceBetween("async function acceptOffer", "async function enterRoom")}
this.drainIncomingOffers = drainIncomingOffers;`,
    context,
  );
  const offerFor = () => ({
    protocolVersion: 2,
    toUid: expectedState.uid,
    toSessionId: expectedState.clientSessionId,
    sessions: {
      [expectedState.uid]: { generation: expectedState.soloSessionGeneration },
    },
  });

  expectedState.pendingIncomingOffer = { roomId: "room-a", offer: offerFor() };
  const outerDrain = context.drainIncomingOffers();
  assert.equal(callableCalls.length, 1);
  expectedState.pendingIncomingOffer = { roomId: "room-b", offer: offerFor() };
  firstResponse.resolve({ data: { accepted: false, reason: "room-changed" } });
  await secondStarted.promise;
  assert.equal(callableCalls.length, 2);
  assert.equal(callableCalls[0].roomId, "room-a");
  assert.equal(callableCalls[1].roomId, "room-b");
  assert.equal(maxActiveCallableCount, 1);

  secondResponse.resolve({ data: { accepted: false, reason: "room-changed" } });
  await outerDrain;
  await Promise.resolve();
  assert.equal(activeCallableCount, 0);
  assert.equal(expectedState.acceptingOffer, false);
  assert.equal(expectedState.pendingIncomingOffer, null);
});

test("Firebase reconnect keeps the offer listener and performs one immediate match attempt", () => {
  const connectivity = sourceBetween(
    "function watchSoloMatchConnectivity",
    "async function cancelSoloSessionRoomOnce",
  );

  assert.match(connectivity, /ref\(database, "\.info\/connected"\)/);
  assert.match(connectivity, /previousConnected === false && connected/);
  assert.match(connectivity, /clearSoloServerMatchRetry\(expectedState\)/);
  assert.match(connectivity, /attemptSoloServerMatch\(generation\)/);
  assert.match(connectivity, /matchUnsubscribers\.push\(unsubscribe\)/);
  assert.doesNotMatch(connectivity, /ownOfferUnsubscribe\?\.\(\)/);
});

test("one retry timer owns both compatibility fallback and transient-error recovery", () => {
  const scheduler = sourceBetween(
    "function scheduleSoloServerMatchRetry",
    "function scheduleOwnOfferRecovery",
  );
  const attempt = sourceBetween(
    "async function attemptSoloServerMatch",
    "async function restoreHostedOfferToWaiting",
  );

  assert.match(scheduler, /window\.setTimeout/);
  assert.doesNotMatch(scheduler, /setInterval/);
  assert.match(scheduler, /expectedState\.soloServerMatchRetryTimer !== timer/);
  assert.match(attempt, /clearSoloServerMatchRetry\(expectedState\)/);
  assert.match(
    attempt,
    /result\.outcome !== "hosted"[\s\S]*?clearSoloServerMatchRetry\(expectedState, \{ resetAttempt: false \}\)[\s\S]*?scheduleSoloServerMatchRetry\(expectedState, generation\)/,
  );
  assert.match(
    attempt,
    /catch \(error\)[\s\S]*?scheduleSoloServerMatchRetry\(expectedState, generation\)/,
  );
});

test("meaningful matchmaking boundaries reset the compatibility backoff", () => {
  const currentAttempt = sourceBetween(
    "function attemptCurrentSoloMatchmaking",
    "async function attemptSoloServerMatch",
  );
  const scopeExpansion = sourceBetween(
    "async function expandMatchmakingScope",
    "function normalizeSoloPermitCandidate",
  );
  const hostedTerminal = sourceBetween(
    "async function finishHostedOfferAsTerminal",
    "function registerHostedOfferMonitor",
  );
  const attempt = sourceBetween(
    "async function attemptSoloServerMatch",
    "async function restoreHostedOfferToWaiting",
  );

  assert.match(currentAttempt, /if \(resetBackoff\) clearSoloServerMatchRetry\(state\)/);
  assert.match(scopeExpansion, /attemptCurrentSoloMatchmaking\(state\.matchmakingGeneration, \{ resetBackoff: true \}\)/);
  assert.match(hostedTerminal, /attemptCurrentSoloMatchmaking\(generation, \{ resetBackoff: true \}\)/);
  assert.match(attempt, /result\.outcome === "join"[\s\S]*?clearSoloServerMatchRetry\(expectedState\)/);
  assert.match(attempt, /result\.outcome !== "hosted"[\s\S]*?return;[\s\S]*?clearSoloServerMatchRetry\(expectedState\)/);
});

test("a delayed or rejected incoming offer re-arms match recovery", () => {
  const accept = sourceBetween(
    "async function acceptOffer",
    "async function drainIncomingOffers",
  );

  assert.match(
    accept,
    /finally[\s\S]*?state\.acceptingOffer = false;[\s\S]*?if \(contextIsCurrent\(\)\)[\s\S]*?scheduleSoloServerMatchRetry\(expectedState, generation, \{ resetBackoff: true \}\)/,
  );
});

test("matchmaking cleanup fences generations, clears timeouts, and unsubscribes every listener", () => {
  const cleanup = sourceBetween(
    "async function cleanupMatchmaking",
    "async function cleanupOnlineResources",
  );

  assert.match(cleanup, /targetState\.matchmakingGeneration = \+\+matchmakingGenerationCounter/);
  assert.match(cleanup, /window\.clearTimeout\(targetState\.offerRecoveryTimer\)/);
  assert.match(cleanup, /window\.clearTimeout\(targetState\.soloServerMatchRetryTimer\)/);
  assert.match(cleanup, /targetState\.offerRecoveryAttempt = 0/);
  assert.match(cleanup, /targetState\.soloServerMatchRetryAttempt = 0/);
  assert.match(cleanup, /targetState\.acceptingOfferRoomId = ""/);
  assert.match(cleanup, /targetState\.ownOfferUnsubscribe\?\.\(\)/);
  assert.match(cleanup, /targetState\.ownOfferUnsubscribe = null/);
  assert.match(cleanup, /targetState\.matchUnsubscribers\.splice\(0\)/);
});
