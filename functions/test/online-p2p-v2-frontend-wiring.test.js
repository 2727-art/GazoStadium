"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "online.js"), "utf8");

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("top-page bootstrap creates online state after per-tab session tokens", () => {
  const stateDeclarationIndex = source.indexOf("let state;");
  const sessionIdIndex = source.indexOf(
    "const clientSoloSessionId = loadOrCreateSoloSessionId();",
  );
  const leaseTokenIndex = source.indexOf(
    "const clientSoloLeaseToken = createOnlineSessionToken(window.crypto);",
  );
  const stateInitializationIndex = source.indexOf("state = createOnlineState();");

  assert.notEqual(stateDeclarationIndex, -1);
  assert.ok(sessionIdIndex > stateDeclarationIndex);
  assert.ok(leaseTokenIndex > sessionIdIndex);
  assert.ok(stateInitializationIndex > leaseTokenIndex);
  assert.doesNotMatch(source, /let state = createOnlineState\(\);/);
});

test("normal 1on1 obtains short-lived TURN configuration with a cached relay fallback", () => {
  const loader = sourceBetween(
    "function validCloudflareIceUrl",
    "async function selectedP2pCandidateSummary",
  );
  const peerSetup = sourceBetween(
    "async function setupPeerConnection",
    "async function handleSignal",
  );
  assert.match(loader, /getP2pIceServersCallable\(\{\}\)/);
  assert.match(loader, /validateClientIceServers/);
  assert.match(loader, /cachedP2pIceServers/);
  assert.match(loader, /p2pTurnCacheWindow/);
  assert.match(loader, /p2pTurnCacheBeforeDeadline\(cachedP2pIceServers, "expires"\)/);
  assert.match(loader, /expiresDeadlineMonotonic/);
  assert.match(loader, /expiresDeadlineWall/);
  assert.match(loader, /wallDeadline > Date\.now\(\)/);
  assert.doesNotMatch(loader, /expiresAt\) > Date\.now\(\)/);
  assert.match(loader, /FALLBACK_ICE_SERVERS/);
  assert.match(peerSetup, /iceServers: iceConfiguration\.iceServers/);
  assert.match(peerSetup, /iceTransportPolicy: "all"/);
  assert.match(peerSetup, /turn_unavailable/);
});

test("TURN refresh failure keeps unexpired credentials and drops them only after expiry", async () => {
  const loaderSource = sourceBetween(
    "function validCloudflareIceUrl",
    "async function selectedP2pCandidateSummary",
  );
  let monotonicNow = 1_000;
  let deviceNow = 9_000_000_000_000;
  let rejectRefresh = false;
  const issuedAt = 1_000_000;
  const refreshAfterMs = 55 * 60 * 1000;
  const expiresAfterMs = 60 * 60 * 1000;
  const iceServers = [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
      username: "temporary-user",
      credential: "temporary-credential",
    },
  ];
  const sandbox = {
    Date: { now: () => deviceNow },
    performance: { now: () => monotonicNow },
    getP2pIceServersCallable: async () => {
      if (rejectRefresh) throw new Error("temporary refresh failure");
      return {
        data: {
          iceServers,
          issuedAt,
          refreshAt: issuedAt + refreshAfterMs,
          expiresAt: issuedAt + expiresAfterMs,
        },
      };
    },
  };
  vm.runInNewContext(`
    const FALLBACK_ICE_SERVERS = Object.freeze([
      Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
    ]);
    let cachedP2pIceServers = null;
    ${loaderSource}
    this.loadP2pIceServers = loadP2pIceServers;
  `, sandbox);

  const initial = await sandbox.loadP2pIceServers();
  assert.equal(initial.turnAvailable, true);
  assert.equal(initial.iceServers[1].credential, "temporary-credential");

  monotonicNow += refreshAfterMs + 100;
  deviceNow = 1;
  rejectRefresh = true;
  const cached = await sandbox.loadP2pIceServers();
  assert.equal(cached.turnAvailable, true);
  assert.equal(cached.iceServers[1].credential, "temporary-credential");

  monotonicNow += 1;
  deviceNow = 9_000_000_000_000 + expiresAfterMs - 30_000 + 1;
  const expired = await sandbox.loadP2pIceServers();
  assert.equal(expired.turnAvailable, false);
  assert.equal(expired.iceServers.length, 1);
  assert.equal(expired.iceServers[0].urls, "stun:stun.l.google.com:19302");
});

test("older Safari uses one getRandomValues token path for session, lease, probe, and reply ids", () => {
  assert.doesNotMatch(source, /crypto\.randomUUID|\.randomUUID\(|replaceAll\("-"/);
  assert.equal(
    (source.match(/createOnlineSessionToken\(window\.crypto\)/g) || []).length,
    4,
  );
  assert.match(source, /const generatedSessionId = createOnlineSessionToken\(window\.crypto\)/);
  assert.match(source, /const clientSoloLeaseToken = createOnlineSessionToken\(window\.crypto\)/);
  assert.match(source, /const probeId = createOnlineSessionToken\(window\.crypto\)/);
  assert.match(source, /const replyId = createOnlineSessionToken\(window\.crypto\)/);
});

test("stored UUID sessions remain valid when normalizing an opponent and entering a room", () => {
  assert.match(source, /isValidOnlineSessionId,/);
  assert.match(source, /!isValidOnlineSessionId\(sessionId\)/);
  assert.match(
    source,
    /!isValidOnlineSessionId\(String\(room\.sessions\?\.\[opponentUid\]\?\.sessionId \|\| ""\)\)/,
  );
  assert.doesNotMatch(source, /\/\^\[0-9a-f\]\{32\}\$\//);
});

test("normal 1on1 copies and freezes the room achievement showcase snapshot", () => {
  const helperSource = sourceBetween(
    "function normalizeCreatorCardAchievementIds",
    "function creatorCardDailyOrder",
  );
  const knownIds = new Set(["first", "second", "third", "fourth"]);
  const renderCalls = [];
  const sandbox = {
    state: null,
    escapeHtml: (value) => String(value),
    window: {
      HariaiAchievements: {
        normalizeIds(value, maximum) {
          const candidates = typeof value === "string" ? value.split(",") : [];
          return [...new Set(candidates)].filter((id) => knownIds.has(id)).slice(0, maximum);
        },
        renderBadges(ids, options) {
          renderCalls.push({ ids: [...ids], options: { ...options } });
          return ids.length ? `<badges>${ids.join("|")}</badges>` : "";
        },
      },
    },
  };
  vm.runInNewContext(`
    ${helperSource}
    this.normalizeRoomAchievementShowcases = normalizeRoomAchievementShowcases;
    this.renderOnlineMatchAchievementShowcase = renderOnlineMatchAchievementShowcase;
  `, sandbox);

  const roomValue = {
    version: 1,
    capturedAt: 1234.9,
    players: {
      host: { ids: "first,second,first,third,fourth" },
      guest: { ids: "fourth" },
      outsider: { ids: "second" },
    },
  };
  const snapshot = sandbox.normalizeRoomAchievementShowcases(roomValue, ["host", "guest"]);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    version: 1,
    capturedAt: 1234,
    players: {
      host: { ids: "first,second,third" },
      guest: { ids: "fourth" },
    },
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.players), true);
  assert.equal(Object.isFrozen(snapshot.players.host), true);

  roomValue.players.host.ids = "fourth";
  roomValue.players.guest.ids = "";
  assert.equal(snapshot.players.host.ids, "first,second,third");
  assert.equal(snapshot.players.guest.ids, "fourth");

  const targetState = { achievementShowcases: snapshot };
  const rendered = sandbox.renderOnlineMatchAchievementShowcase("host", {
    className: "is-hud is-opponent",
    targetState,
  });
  assert.match(rendered, /match-achievement-showcase is-hud is-opponent/);
  assert.match(rendered, /<badges>first\|second\|third<\/badges>/);
  assert.deepEqual(renderCalls, [{
    ids: ["first", "second", "third"],
    options: { compact: true },
  }]);
  assert.equal(
    sandbox.renderOnlineMatchAchievementShowcase("missing", { targetState }),
    "",
  );
  assert.equal(renderCalls.length, 1, "empty showcases never call the badge renderer");
});

test("normal 1on1 renders only the entry-time achievement snapshot in match phases", () => {
  const stateFactory = sourceBetween(
    "function createOnlineState",
    "function normalizeImagePreference",
  );
  const helpers = sourceBetween(
    "function normalizeCreatorCardAchievementIds",
    "function creatorCardDailyOrder",
  );
  const connecting = sourceBetween("function renderConnecting", "function renderStatusCard");
  const hud = sourceBetween("function renderOnlineHud", "function renderRoundSelect");
  const result = sourceBetween("function renderGameOver", "function syncOnlineFreeTableResultLamp");
  const roomEntry = sourceBetween("async function enterRoom", "function isCurrentRoomSetupContext");

  assert.match(stateFactory, /achievementShowcases: emptyOnlineAchievementShowcases\(\)/);
  assert.match(helpers, /if \(!ids\.length\) return "";/);
  assert.match(helpers, /window\.HariaiAchievements\?\.renderBadges\?\.\(ids, \{ compact \}\)/);
  assert.match(roomEntry, /state\.achievementShowcases = normalizeRoomAchievementShowcases\([\s\S]*?room\.achievementShowcases,[\s\S]*?\[room\.hostUid, room\.guestUid\]/);
  assert.equal(
    (source.match(/normalizeRoomAchievementShowcases\(\s*room\.achievementShowcases/g) || []).length,
    1,
    "later room updates must not replace the entry-time showcase snapshot",
  );
  assert.match(connecting, /className: "is-match-found is-opponent"/);
  assert.match(connecting, /label: `\$\{opponent\?\.name \|\| "対戦相手"\}の展示実績`/);
  assert.match(hud, /localPlayer \? "" : renderOnlineMatchAchievementShowcase\(player\.uid/);
  assert.match(hud, /className: "is-hud is-opponent"/);
  assert.match(result, /renderOnlineMatchAchievementShowcase\(player\.uid/);
  assert.match(result, /className: `is-result \$\{index === state\.playerIndex \? "is-local" : "is-opponent"\}`/);
});

test("a delayed claim cannot start heartbeat after its matchmaking generation ended", () => {
  const claim = sourceBetween(
    "async function releaseSoloSessionClaimExact",
    "function clearSoloSessionHeartbeat",
  );
  const heartbeat = sourceBetween(
    "function scheduleSoloSessionLeaseHeartbeat",
    "async function handleSoloSessionLeaseLost",
  );
  assert.match(claim, /expectedMatchmakingGeneration = expectedState\.matchmakingGeneration/);
  assert.match(claim, /isCurrentMatchmakingGeneration\(expectedMatchmakingGeneration\)/);
  assert.match(claim, /const abandonStaleResponse = async/);
  assert.match(claim, /await releaseSoloSessionClaimExact/);
  assert.match(claim, /generation: staleGeneration/);
  assert.match(claim, /!state\.cleanupPromise/);
  assert.match(claim, /!state\.p2pAutoRequeueCancelling/);
  assert.match(source, /claimSoloSessionLease\(expectedState, generation\)/);
  assert.match(heartbeat, /if \(!active/);
  assert.match(heartbeat, /action: "heartbeat"/);
  assert.match(heartbeat, /generation: expectedState\.soloSessionGeneration/);
});

test("automatic requeue is cancelled if visibility or connectivity changes mid-search", () => {
  const matching = sourceBetween(
    "function isCurrentMatchmakingGeneration",
    "async function cancelSoloSessionRoomOnce",
  );
  const begin = sourceBetween(
    "async function beginMatchmaking",
    "async function startPublicPresence",
  );
  const listeners = sourceBetween(
    "function cancelUnavailableAutomaticMatchmaking",
    "sampleHandicapDialog?.addEventListener",
  );
  assert.match(matching, /state\.p2pAutoRequeueStartedAt <= 0/);
  assert.match(matching, /document\.visibilityState === "visible" && navigator\.onLine/);
  assert.match(begin, /async function beginMatchmaking\(\{ automatic = false \} = \{\}\)/);
  assert.match(begin, /expectedState\.p2pAutoRequeueCount = 0/);
  assert.match(begin, /expectedState\.p2pOpponentCooldown = null/);
  assert.match(source, /beginMatchmaking\(\{ automatic: true \}\)/);
  assert.match(listeners, /expectedState\.p2pAutoRequeueStartedAt <= 0/);
  assert.match(listeners, /\["matching", "connecting"\]\.includes\(expectedState\.screen\)/);
  assert.match(listeners, /cancelMatching\(\)\.catch\(handleRecoverableError\)/);
  assert.ok(
    (listeners.match(/cancelUnavailableAutomaticMatchmaking\(\)/g) || []).length >= 3,
  );
});

test("matchmaking initialization failures release the lease and return to setup", () => {
  const continuation = sourceBetween(
    "async function continueRequestedMatchmaking",
    "function requestMatchmaking",
  );
  const request = sourceBetween(
    "function requestMatchmaking",
    "function bindOnlinePursuitFields",
  );
  const begin = sourceBetween(
    "async function beginMatchmaking",
    "async function startPublicPresence",
  );
  const dialog = sourceBetween(
    'sampleHandicapDialog?.addEventListener("close"',
    'finishCutInDialog?.addEventListener("cancel"',
  );
  assert.match(request, /continueRequestedMatchmaking\(context\)/);
  assert.match(dialog, /continueRequestedMatchmaking\(context\)/);
  assert.match(continuation, /await beginMatchmaking\(\)/);
  assert.match(begin, /try \{/);
  assert.match(begin, /catch \(error\)/);
  assert.match(begin, /"matchmaking-initialization-failed"/);
  assert.match(begin, /await cleanupOnlineResources\(false, expectedState\)/);
  assert.match(begin, /isOnlineStateTransitionCurrent\(expectedState, transitionToken, state\)/);
  assert.match(begin, /expectedState\.screen = "setup"/);
});

test("V2 signaling is session-scoped, serialized, and consumed only after safe handling", () => {
  const peerSetup = sourceBetween(
    "async function setupPeerConnection",
    "async function handleSignal",
  );
  assert.match(source, /return `online\/rooms\/\$\{roomId\}\/signalsV2\/\$\{targetUid\}\/\$\{targetSessionId\}`/);
  assert.match(peerSetup, /soloRoomSignalPath/);
  assert.match(peerSetup, /fromSessionId: context\.expectedState\.clientSessionId/);
  assert.match(peerSetup, /toSessionId: context\.expectedState\.opponentSessionId/);
  assert.match(peerSetup, /connectionGeneration: context\.expectedState\.roomConnectionGeneration/);
  assert.match(peerSetup, /attemptId: context\.expectedState\.signalingAttemptId/);
  assert.match(peerSetup, /let signalHandlingChain = Promise\.resolve\(\)/);
  assert.match(peerSetup, /signalHandlingChain = signalHandlingChain/);
  assert.match(peerSetup, /shouldConsumeOnlineSignal/);
  assert.match(peerSetup, /handledSuccessfully/);
  assert.match(peerSetup, /contextStillCurrent: peerContextIsCurrent\(\)/);
});

test("host performs one explicit ICE restart and recovery cleanup precedes auto requeue", () => {
  const peerSetup = sourceBetween(
    "async function setupPeerConnection",
    "async function handleSignal",
  );
  const recoveryEffects = sourceBetween(
    "async function completeP2pFailureCleanup",
    "async function setupPeerConnection",
  );
  assert.match(peerSetup, /peer\.restartIce\?\.\(\)/);
  assert.match(peerSetup, /peer\.createOffer\(\{ iceRestart: true \}\)/);
  assert.match(peerSetup, /iceRestart: true/);
  assert.match(peerSetup, /const restartIsCurrent = \(\) =>/);
  assert.match(peerSetup, /state\.p2pRecovery\?\.phase === ONLINE_P2P_RECOVERY_PHASES\.RESTARTING/);
  assert.match(peerSetup, /state\.p2pRecovery\?\.channelWasOpened !== true/);
  assert.match(recoveryEffects, /await cleanupOnlineResources\(false, targetState, \{ preserveP2pRecovery: true \}\)/);
  assert.match(recoveryEffects, /dispatchP2pRecoveryEvent\("CLEANUP_COMPLETED"/);
  assert.match(recoveryEffects, /effect\.type === "auto-requeue"/);
  assert.match(recoveryEffects, /currentRecovery\?\.generationToken !== effect\.generationToken/);
  assert.match(recoveryEffects, /currentRecovery\.phase !== ONLINE_P2P_RECOVERY_PHASES\.RESTARTING/);
  assert.match(recoveryEffects, /currentRecovery\.channelWasOpened/);
  assert.match(recoveryEffects, /currentRecovery\.manuallyCancelled/);
  assert.match(recoveryEffects, /const resetSucceeded = await resetOnlineState\("setup"\)/);
  assert.match(recoveryEffects, /document\.visibilityState !== "visible"/);
  assert.match(recoveryEffects, /!navigator\.onLine/);
  assert.match(recoveryEffects, /const replacementState = state/);
});

test("late channel open cannot revive a room once cleanup has started", () => {
  const cleanup = sourceBetween(
    "async function completeP2pFailureCleanup",
    "async function resetAfterP2pFailure",
  );
  const effects = sourceBetween(
    "async function handleP2pRecoveryEffect",
    "async function setupPeerConnection",
  );
  const channel = sourceBetween(
    "function configureDataChannel",
    "async function handleChannelMessage",
  );
  assert.match(cleanup, /const currentRecovery = targetState\.p2pRecovery/);
  assert.match(cleanup, /currentRecovery\?\.generationToken !== effect\.generationToken/);
  assert.match(cleanup, /currentRecovery\.phase !== ONLINE_P2P_RECOVERY_PHASES\.CLEANING_UP/);
  assert.doesNotMatch(cleanup, /targetState\.p2pRecovery !== recovery/);
  assert.match(effects, /currentRecovery\?\.generationToken !== effect\.generationToken/);
  assert.match(effects, /currentRecovery\.phase !== ONLINE_P2P_RECOVERY_PHASES\.CLEANING_UP/);
  assert.match(channel, /dispatchP2pRecoveryEvent\("CHANNEL_OPENED", expectedState\)/);
  assert.match(channel, /ONLINE_P2P_RECOVERY_PHASES\.CLEANING_UP/);
  assert.match(channel, /ONLINE_P2P_RECOVERY_PHASES\.TERMINAL/);
});

test("an early recovery timer callback is re-armed instead of being lost", () => {
  const dispatcher = sourceBetween(
    "function dispatchP2pRecoveryEvent",
    "async function completeP2pFailureCleanup",
  );
  assert.match(dispatcher, /if \(result\.ignored\)/);
  assert.match(dispatcher, /type === "TIMER_EXPIRED"/);
  assert.match(dispatcher, /detail\.timerToken === recovery\.timerToken/);
  assert.match(dispatcher, /Date\.now\(\) < recovery\.deadlineAt/);
  assert.match(dispatcher, /scheduleP2pRecoveryTimer\(targetState\)/);
});

test("lease heartbeat retries transient failures until expiry without duplicate timers", () => {
  const scheduler = sourceBetween(
    "function clearSoloSessionHeartbeat",
    "async function refreshSoloSessionLease",
  );
  const refresh = sourceBetween(
    "async function refreshSoloSessionLease",
    "async function releaseSoloSessionLease",
  );
  assert.match(scheduler, /window\.clearTimeout\(expectedState\.soloSessionHeartbeat\)/);
  assert.match(scheduler, /window\.setTimeout/);
  assert.match(scheduler, /expectedState\.soloSessionHeartbeat !== timer/);
  assert.match(scheduler, /Math\.min\(requestedDelay, remainingMs\)/);
  assert.doesNotMatch(scheduler, /setInterval/);
  assert.match(refresh, /soloSessionHeartbeatInFlight/);
  assert.match(refresh, /responseData = null/);
  assert.match(refresh, /decideOnlineSessionHeartbeatResult/);
  assert.match(refresh, /decision\.action === "retry"/);
  assert.match(refresh, /scheduleSoloSessionLeaseHeartbeat\(expectedState, decision\.retryDelayMs\)/);
  assert.match(refresh, /decision\.action === "lost"/);
  assert.match(refresh, /soloRoomPresencePath/);
  assert.match(refresh, /online: true/);
  assert.match(refresh, /handleSoloSessionLeaseLost/);
  assert.match(refresh, /roomTerminationToken/);
  assert.match(refresh, /online\/rooms\/\$\{roomId\}\/destroyed/);
  assert.match(refresh, /cleanupOnlineResources\(false, expectedState\)/);
});

test("frontend matchmaking leaves queue and active deletion to the backend", () => {
  const matching = sourceBetween(
    "async function beginMatchmaking",
    "async function startPublicPresence",
  );
  const serverMatch = sourceBetween(
    "async function attemptSoloServerMatch",
    "async function restoreHostedOfferToWaiting",
  );
  const cleanup = sourceBetween(
    "async function cleanupMatchmaking",
    "function releaseRemoteImage",
  );
  assert.match(source, /return `online\/queueV2\/\$\{uid\}\/\$\{sessionId\}`/);
  assert.match(source, /const base = `online\/offersV2\/\$\{targetUid\}\/\$\{targetSessionId\}`/);
  assert.match(matching, /soloQueueEntryPath/);
  assert.match(matching, /soloOfferPath/);
  assert.match(matching, /profileProjectionVersion: SOLO_STATS_PROJECTION_VERSION/);
  const claimLease = sourceBetween(
    "async function claimSoloSessionLease",
    "function clearSoloSessionHeartbeat",
  );
  assert.match(
    claimLease,
    /action: "claim",[\s\S]*?profileProjectionVersion: SOLO_STATS_PROJECTION_VERSION/,
  );
  assert.match(claimLease, /client-upgrade-required/);
  assert.ok(
    matching.indexOf("reconcileSoloProfileBeforeMatchmaking")
      < matching.indexOf("await set(queueEntryRef"),
    "verified profile projection must settle before queueV2 snapshots the rating",
  );
  assert.match(serverMatch, /action: "try_match"/);
  assert.doesNotMatch(source, /soloSessionPresence/);
  assert.doesNotMatch(matching, /onDisconnect\(queueEntryRef\)|removeQueueEntryIfCurrent/);
  assert.doesNotMatch(cleanup, /\b(?:remove|runTransaction)\(ref\(database, soloQueueEntryPath/);
  assert.doesNotMatch(cleanup, /online\/activeV2/);
  assert.doesNotMatch(matching, /online\/queue\/\$\{state\.uid\}/);
  assert.doesNotMatch(matching, /online\/active\/\$\{state\.uid\}/);
  assert.doesNotMatch(matching, /online\/offers\/\$\{state\.uid\}/);
  assert.doesNotMatch(serverMatch, /set\(ref\(database, `online\/rooms/);
});

test("failed-room and manual cleanup await destroyed, one cancel, then release", () => {
  const cancel = sourceBetween(
    "async function cancelSoloSessionRoomOnce",
    "async function releaseActiveReservation",
  );
  const cleanup = sourceBetween(
    "async function cleanupOnlineResources",
    "function releaseRemoteImage",
  );
  const failure = sourceBetween(
    "async function completeP2pFailureCleanup",
    "async function resetAfterP2pFailure",
  );
  const destroy = sourceBetween(
    "async function destroyRoom",
    "async function handleOpponentDestroyed",
  );
  assert.match(cancel, /soloSessionCancelRoomId === normalizedRoomId/);
  assert.match(cancel, /soloSessionCancelPromise/);
  assert.match(cancel, /action: "cancel"/);
  const cleanupCancel = cleanup.indexOf(
    "await cancelSoloSessionRoomOnce(cancelRoomId, targetState)",
  );
  const cleanupRelease = cleanup.indexOf(
    "await releaseSoloSessionLease(targetState)",
    cleanupCancel,
  );
  assert.ok(cleanupCancel >= 0 && cleanupRelease > cleanupCancel);
  assert.ok(
    failure.indexOf("await runTransaction(")
      < failure.indexOf("await cleanupOnlineResources("),
  );
  assert.ok(
    destroy.indexOf("await runTransaction(")
      < destroy.indexOf("await cleanupOnlineResources("),
  );
  assert.doesNotMatch(destroy, /Promise\.all\(\[destroyWrite, cleanupPromise\]\)/);
});
