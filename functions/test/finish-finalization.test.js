"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const online = fs.readFileSync(path.join(root, "online.js"), "utf8");

function sliceBetween(startMarker, endMarker, label) {
  const start = online.indexOf(startMarker);
  const end = online.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${label} could not be sliced`);
  return online.slice(start, end);
}

test("final result claim is atomic and recovers ambiguous or legacy acknowledgements", async () => {
  let roomValue = {};
  let updateCalls = 0;
  let preserveStoredRoom = false;
  const targetState = {
    playerIndex: 0,
    players: [{ hp: 12 }, { hp: 0 }],
    resultClaimCommitted: false,
  };
  const roundContext = {
    expectedRound: 3,
    roomContext: {
      roomId: "-FinalRetryRoom00001",
      ownUid: "local-user",
    },
  };
  const sandbox = {
    database: {},
    ref: (_database, valuePath) => valuePath,
    serverNow: () => 123_456,
    isCurrentRoundContext: () => true,
    update: async (_roomPath, patch) => {
      updateCalls += 1;
      if (!preserveStoredRoom) {
        roomValue = {
          resultClaims: {
            "local-user": patch["resultClaims/local-user"],
          },
          finished: {
            "local-user": patch["finished/local-user"],
          },
        };
      }
      throw new Error("response lost after server commit");
    },
    get: async () => ({ val: () => roomValue }),
  };
  const source = sliceBetween(
    "async function ensureOnlineResultClaim",
    "async function finishOnlineMatch",
    "atomic claim helper",
  );
  vm.runInNewContext(`${source}\nthis.ensureClaim = ensureOnlineResultClaim;`, sandbox);

  assert.equal(
    await sandbox.ensureClaim(targetState, { winnerIndex: 0 }, roundContext),
    true,
  );
  assert.equal(targetState.resultClaimCommitted, true);
  assert.equal(updateCalls, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(roomValue.resultClaims["local-user"])),
    { outcome: "win", round: 3, createdAt: 123_456 },
  );
  assert.equal(roomValue.finished["local-user"], true);

  assert.equal(
    await sandbox.ensureClaim(targetState, { winnerIndex: 0 }, roundContext),
    true,
  );
  assert.equal(updateCalls, 1, "confirmed write-once pair must not be rewritten");

  preserveStoredRoom = true;
  roomValue = {
    resultClaims: {
      "local-user": { outcome: "win", createdAt: 120_000 },
    },
    finished: {
      "local-user": true,
    },
  };
  const reloadedState = {
    ...targetState,
    resultClaimCommitted: false,
  };
  assert.equal(
    await sandbox.ensureClaim(reloadedState, { winnerIndex: 0 }, roundContext),
    true,
  );
  assert.equal(reloadedState.resultClaimCommitted, true);
  assert.equal(updateCalls, 2);
});

test("normal profile uses a verified result token to recover an ambiguous transaction", async () => {
  let storedProfile = null;
  let transactionCalls = 0;
  let overallCalls = 0;
  const targetState = {
    uid: "local-user",
    roomId: "-ProfileRetryRoom001",
    name: "PLAYER",
    pursuitLine: "まだ終わらない",
    playerIndex: 0,
    profile: {
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      rating: 1_000,
    },
    players: [
      { streak: 0, rating: 1_000 },
      { streak: 0, rating: 1_000 },
    ],
    statsCommitted: false,
    statsCommitInFlight: false,
  };
  const sandbox = {
    state: targetState,
    database: {},
    INITIAL_RATING: 1_000,
    ref: (_database, valuePath) => valuePath,
    normalizePursuitLine: (value) => value,
    calculateRating: (rating) => rating + 10,
    isCurrentRoundContext: () => true,
    showToast: () => {},
    recordOverallResult: async () => {
      overallCalls += 1;
      return { resultToken: "a".repeat(40) };
    },
    runTransaction: async (_valuePath, updater) => {
      transactionCalls += 1;
      const next = updater(storedProfile);
      if (next !== undefined) storedProfile = next;
      if (transactionCalls === 1) {
        throw new Error("response lost after profile commit");
      }
      return {
        committed: next !== undefined,
        snapshot: { val: () => storedProfile },
      };
    },
  };
  const source = sliceBetween(
    "async function commitOnlineStats",
    "async function sendChat",
    "normal stats commit",
  );
  vm.runInNewContext(`${source}\nthis.commit = commitOnlineStats;`, sandbox);

  await assert.rejects(
    sandbox.commit(targetState, { winnerIndex: 0 }, {}),
    /response lost/,
  );
  assert.equal(targetState.statsCommitted, false);
  assert.equal(targetState.statsCommitInFlight, false);
  assert.equal(storedProfile.wins, 1);
  assert.equal(storedProfile.rating, 1_010);
  assert.equal(storedProfile.appliedResults["a".repeat(40)], "win");

  assert.equal(await sandbox.commit(targetState, { winnerIndex: 0 }, {}), true);
  assert.equal(targetState.statsCommitted, true);
  assert.equal(targetState.statsCommitInFlight, false);
  assert.equal(storedProfile.wins, 1, "retry must not add the same room twice");
  assert.equal(storedProfile.rating, 1_010);
  assert.equal(targetState.players[0].streak, 1);
  assert.equal(overallCalls, 2);

  assert.equal(await sandbox.commit(targetState, { winnerIndex: 0 }, {}), true);
  assert.equal(transactionCalls, 2);
  assert.equal(targetState.players[0].streak, 1);
  assert.equal(overallCalls, 2);
});

test("server-projected normal results never fall back to a client profile transaction", async () => {
  const makeState = () => ({
    uid: "local-user",
    roomId: "-ServerProfileRoom001",
    name: "PLAYER",
    pursuitLine: "まだ終わらない",
    playerIndex: 0,
    profile: {
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      rating: 1_000,
    },
    players: [
      { streak: 0, rating: 1_000 },
      { streak: 0, rating: 1_000 },
    ],
    statsCommitted: false,
    statsCommitInFlight: false,
  });
  const responses = [
    {
      resultToken: "d".repeat(40),
      profileProjectionMode: "server-v2",
      profileProjectionPending: false,
      soloProfile: {
        name: "PLAYER",
        pursuitLine: "まだ終わらない",
        wins: 1,
        losses: 0,
        draws: 0,
        streak: 1,
        bestStreak: 1,
        rating: 1_016,
        updatedAt: 123,
      },
    },
    {
      resultToken: "e".repeat(40),
      profileProjectionMode: "server-v2",
      profileProjectionPending: true,
      soloProfile: null,
    },
  ];
  let transactionCalls = 0;
  let toastCalls = 0;
  const sandbox = {
    state: null,
    INITIAL_RATING: 1_000,
    isCurrentRoundContext: () => true,
    recordOverallResult: async () => responses.shift(),
    runTransaction: async () => {
      transactionCalls += 1;
      throw new Error("client transaction must not run");
    },
    applyServerSoloProjectionProfiles: (targetState, payload) => {
      if (payload.soloProfile) targetState.profile = { ...payload.soloProfile };
    },
    showToast: () => { toastCalls += 1; },
  };
  const source = sliceBetween(
    "async function commitOnlineStats",
    "async function sendChat",
    "server-projected normal stats commit",
  );
  vm.runInNewContext(`${source}\nthis.commit = commitOnlineStats;`, sandbox);

  const projected = makeState();
  sandbox.state = projected;
  assert.equal(await sandbox.commit(projected, { winnerIndex: 0 }, {}), true);
  assert.equal(projected.profile.wins, 1);
  assert.equal(projected.profile.rating, 1_016);
  assert.equal(projected.statsCommitted, true);

  const pending = makeState();
  sandbox.state = pending;
  assert.equal(await sandbox.commit(pending, { winnerIndex: 0 }, {}), true);
  assert.equal(pending.profile.wins, 0);
  assert.equal(pending.statsCommitted, true);
  assert.equal(toastCalls, 1);
  assert.equal(transactionCalls, 0);
});

test("overall profile also uses a verified result token across a retry", async () => {
  let storedProfile = null;
  let transactionCalls = 0;
  let leaderboardEnabled = false;
  let publicSyncCalls = 0;
  let publicSyncWarnings = 0;
  let queuedPublicRetries = 0;
  const emptyModes = () => Object.fromEntries(
    ["solo", "strategy", "team", "royale"].map((mode) => [
      mode,
      { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
    ]),
  );
  const normalizeProfile = (current, name) => {
    const source = current || {
      name,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      rating: 1_000,
      modes: emptyModes(),
      updatedAt: 0,
    };
    return {
      ...source,
      modes: Object.fromEntries(Object.entries(source.modes).map(([mode, value]) => [
        mode,
        { ...value },
      ])),
    };
  };
  const sandbox = {
    state: { uid: "local-user", profile: {}, serverTimeOffset: 0 },
    auth: { currentUser: { uid: "local-user" } },
    browserLocalPersistence: {},
    setPersistence: async () => {},
    signInAnonymously: async () => ({ user: { uid: "local-user" } }),
    economyActionCallable: async () => ({}),
    localStorage: { getItem: () => "" },
    PROFILE_NAME_KEY: "name",
    publicServerTimeOffset: 0,
    ACTIVE_BATTLE_MODES: ["solo", "strategy", "team"],
    LEADERBOARD_MODES: ["solo", "strategy", "team", "royale"],
    INITIAL_RATING: 1_000,
    recordPeriodRewardResult: async (_uid, _mode, _outcome, roomId) => ({
      economyBalance: null,
      resultToken: roomId === "-OverallRetryRoom001"
        ? "b".repeat(40)
        : "c".repeat(40),
    }),
    ensureOverallProfileSeeded: async () => normalizeProfile(storedProfile, "PLAYER"),
    normalizeOverallProfile: normalizeProfile,
    calculateRating: (rating) => rating + 10,
    database: {},
    ref: (_database, valuePath) => valuePath,
    leaderboardPublicSettings: () => ({ enabled: leaderboardEnabled }),
    publishOverallLeaderboard: async () => {
      publicSyncCalls += 1;
      throw new Error("public projection unavailable");
    },
    queuePendingSoloPublicResult: () => { queuedPublicRetries += 1; },
    clearPendingSoloPublicResult: () => {},
    console: { error: () => {} },
    showToast: () => { publicSyncWarnings += 1; },
    runTransaction: async (_valuePath, updater) => {
      transactionCalls += 1;
      const next = updater(storedProfile);
      if (next !== undefined) storedProfile = next;
      if (transactionCalls === 1) {
        throw new Error("response lost after overall profile commit");
      }
      return {
        committed: next !== undefined,
        snapshot: { val: () => storedProfile },
      };
    },
  };
  const source = sliceBetween(
    "async function recordOverallResult",
    "function persistOverallRankingPreference",
    "overall result commit",
  );
  vm.runInNewContext(`${source}\nthis.record = recordOverallResult;`, sandbox);
  const request = {
    mode: "solo",
    outcome: "win",
    name: "PLAYER",
    roomId: "-OverallRetryRoom001",
    sourceState: sandbox.state,
  };

  await assert.rejects(sandbox.record(request), /response lost/);
  assert.equal(storedProfile.wins, 1);
  assert.equal(storedProfile.modes.solo.wins, 1);
  assert.equal(storedProfile.rating, 1_010);
  assert.equal(storedProfile.appliedResults["b".repeat(40)], "win");

  const result = await sandbox.record(request);
  assert.equal(result.wins, 1);
  assert.equal(result.modes.solo.wins, 1);
  assert.equal(result.rating, 1_010);
  assert.equal(result.resultToken, "b".repeat(40));
  assert.equal(transactionCalls, 2);

  const secondRoomResult = await sandbox.record({
    ...request,
    roomId: "-OverallRetryRoom002",
  });
  assert.equal(secondRoomResult.wins, 2);
  assert.equal(secondRoomResult.rating, 1_020);
  assert.equal(storedProfile.appliedResults["c".repeat(40)], "win");

  const replayedFirstRoom = await sandbox.record(request);
  assert.equal(replayedFirstRoom.wins, 2, "A -> B -> A must not add A twice");
  assert.equal(replayedFirstRoom.rating, 1_020);
  assert.equal(transactionCalls, 4);

  leaderboardEnabled = true;
  const deferredPublicResult = await sandbox.record({
    ...request,
    deferPublicSync: true,
  });
  await Promise.resolve();
  assert.equal(deferredPublicResult.wins, 2);
  assert.equal(publicSyncCalls, 1);
  assert.equal(publicSyncWarnings, 1);
  assert.equal(queuedPublicRetries, 1);
});

test("public legacy period entries preserve an immutable verified-result receipt", () => {
  const periodFlow = sliceBetween(
    "async function recordLeaderboardPeriodResult",
    "async function syncServerRankingParticipation",
    "period leaderboard result",
  );
  assert.match(periodFlow, /current\?\.appliedResults\?\.\[resultToken\] === outcome/);
  assert.match(periodFlow, /\[resultToken\]: outcome/);
  assert.match(periodFlow, /storedPeriod\?\.appliedResults\?\.\[resultToken\] !== outcome/);
  assert.match(online, /const publicResultEvent = \{[\s\S]*?mode,[\s\S]*?resultToken/);
  assert.match(online, /settings\.enabled && projectionPending[\s\S]*?queuePendingSoloPublicResult/);
  assert.match(
    online,
    /reconcileSoloProfileBeforeMatchmaking[\s\S]*?flushPendingSoloPublicResults\(targetState\)/,
  );
});

test("pending solo public results are UID-scoped, deduplicated, and replayed with their token", async () => {
  const storage = new Map();
  const published = [];
  const sandbox = {
    PENDING_SOLO_PUBLIC_RESULTS_KEY: "pending-results",
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    state: {},
    leaderboardPublicSettings: () => ({ enabled: true }),
    publishOverallLeaderboard: async (...args) => { published.push(args); },
  };
  const source = sliceBetween(
    "function pendingSoloPublicResultsStorageKey",
    "async function syncLeaderboardEntry",
    "pending public result helpers",
  );
  vm.runInNewContext(
    `${source}
this.queueResult = queuePendingSoloPublicResult;
this.pendingResults = pendingSoloPublicResults;
this.flushResults = flushPendingSoloPublicResults;`,
    sandbox,
  );
  const event = {
    mode: "solo",
    outcome: "win",
    roomId: "-PendingPublicRoom01",
    resultToken: "f".repeat(40),
    name: "PLAYER",
  };
  sandbox.queueResult("local-user", event);
  sandbox.queueResult("local-user", { ...event, name: "PLAYER NEW" });
  sandbox.queueResult("other-user", {
    ...event,
    resultToken: "e".repeat(40),
  });
  assert.equal(sandbox.pendingResults("local-user").length, 1);
  assert.equal(sandbox.pendingResults("local-user")[0].name, "PLAYER NEW");
  assert.equal(sandbox.pendingResults("other-user").length, 1);

  const completed = await sandbox.flushResults({
    uid: "local-user",
    name: "PLAYER",
    overallProfile: { wins: 1 },
  });
  assert.equal(completed, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0][0], "local-user");
  assert.equal(published[0][4].resultToken, "f".repeat(40));
  assert.equal(sandbox.pendingResults("local-user").length, 0);
  assert.equal(sandbox.pendingResults("other-user").length, 1);
});

test("destroy controls refuse a match that resolves before either opening or confirming", async () => {
  const targetState = {
    round: 2,
    destroyInFlight: false,
    roomTerminationToken: null,
  };
  const context = {
    expectedState: targetState,
    roomId: "-DestroyGuardRoom001",
    ownUid: "local-user",
    opponentUid: "remote-user",
  };
  let resolvedBeforeOpen = true;
  let resolvedBeforeConfirm = false;
  let dialogCalls = 0;
  let transactionCalls = 0;
  let cleanupCalls = 0;
  let settlementCalls = 0;
  const sandbox = {
    state: targetState,
    active: true,
    database: {},
    destroyDialog: { showModal: () => { dialogCalls += 1; } },
    window: {
      requestAnimationFrame: (callback) => callback(),
      HariaiApp: { returnHome: () => {} },
    },
    document: { querySelector: () => ({ focus: () => {} }) },
    console,
    showToast: () => {},
    captureOnlineRoomContext: () => context,
    isCurrentRoomSetupContext: () => true,
    getResolvedMatchResultForRound: () => (resolvedBeforeOpen ? {} : null),
    queueResolvedMatchSettlement: () => { settlementCalls += 1; },
    preserveResolvedMatchBeforeP2pCleanup: async () => resolvedBeforeConfirm,
    runTransaction: async () => {
      transactionCalls += 1;
      return { snapshot: { val: () => ({ by: context.ownUid }) } };
    },
    ref: (_database, valuePath) => valuePath,
    dispatchP2pRecoveryEvent: () => {},
    beginOnlineStateTransition: () => ({}),
    cleanupOnlineResources: async () => { cleanupCalls += 1; },
    isSameRoomIdentity: () => true,
    isOnlineStateTransitionCurrent: () => true,
    releaseAllImages: () => {},
    handleOpponentDestroyed: async () => {},
    isPostMatchTipBusy: () => false,
    leaveToLanding: () => {},
  };
  const source = sliceBetween(
    "function notifyResolvedMatchDestroyBlocked",
    "async function handleOpponentDestroyed",
    "destroy guard",
  );
  vm.runInNewContext(
    `var pendingDestroyContext = null;\n${source}\nthis.openDestroy = openDestroyDialog;\nthis.destroy = destroyRoom;`,
    sandbox,
  );

  sandbox.openDestroy();
  assert.equal(dialogCalls, 0);
  assert.equal(settlementCalls, 1);

  resolvedBeforeOpen = false;
  sandbox.openDestroy();
  assert.equal(dialogCalls, 1);
  resolvedBeforeConfirm = true;
  await sandbox.destroy();
  assert.equal(transactionCalls, 0);
  assert.equal(cleanupCalls, 0);
  assert.equal(targetState.destroyInFlight, false);
});
