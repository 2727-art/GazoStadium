const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const trainingJs = fs.readFileSync(path.join(projectRoot, "training.js"), "utf8");
const trainingCss = fs.readFileSync(path.join(projectRoot, "training.css"), "utf8");
const trainingCore = fs.readFileSync(path.join(projectRoot, "training-core.mjs"), "utf8");
const freeTableJs = fs.readFileSync(path.join(projectRoot, "free-table.js"), "utf8");

test("loads the new training client and no longer loads the retired team client", () => {
  assert.match(indexHtml, /href="training\.css\?v=[^"]+"/);
  assert.match(indexHtml, /src="training\.js\?v=[^"]+"/);
  assert.doesNotMatch(indexHtml, /src="team\.js(?:\?|")/);
});

test("reuses verified P2P image transfer and the free-table metronome", () => {
  assert.match(trainingJs, /from "\.\/online-image-transfer\.mjs\?v=[^"]+"/);
  assert.match(trainingJs, /verifiedOnlineImageMime/);
  assert.match(trainingJs, /completeIncomingOnlineImageTransfer/);
  assert.match(trainingJs, /from "\.\/free-table-ambience\.mjs\?v=[^"]+"/);
  assert.match(trainingJs, /createFreeTableAmbienceController/);
  assert.match(trainingJs, /\.enable\(\)/);
  assert.match(trainingJs, /effectiveAt/);
  assert.match(
    trainingJs,
    /if \(!\["ready", "active", "expired"\]\.includes\(view\.phase\)\) state\.ambienceController\.disable\(\)/,
  );
  assert.match(trainingJs, /primeTurnAmbience\(view\.turnIndex\);\s*await state\.ambienceController\.enable\(\)/s);
  assert.match(trainingJs, /if \(view\.phase === "ready" && view\.turn\) \{\s*primeTurnAmbience\(view\.turnIndex\)/s);
  assert.match(
    trainingJs,
    /setTurnAmbience\(view\.turnIndex, view\.turn\.instruction, startedAt\);\s*if \(enableAudio\) state\.ambienceController\.enable\(\)/s,
  );
  assert.match(trainingJs, /function toggleMute\(\)[\s\S]*?state\.ambienceController\.enable\(\)/s);
});

test("recovers the opted-in metronome after mobile visibility suspension", () => {
  assert.match(trainingJs, /document\.addEventListener\("visibilitychange"/);
  assert.match(trainingJs, /queueMicrotask\(\(\) => \{\s*resumeTrainingAmbienceAfterVisibility\(\)/s);
  assert.match(trainingJs, /async function resumeTrainingAmbienceAfterVisibility/);
  assert.match(trainingJs, /!state\.ambienceUnlocked/);
  assert.match(
    trainingJs,
    /configureAmbienceForView\(view, \{ enableAudio: false \}\);\s*const enabled = await state\.ambienceController\.enable\(\)/s,
  );
  assert.match(trainingJs, /id="trainingResumeAmbience"/);
  assert.match(trainingJs, /resumeTrainingAmbienceFromGesture\(\)/);
  assert.match(trainingCss, /\.training-audio-controls \{\s*display: flex;\s*flex-wrap: wrap/s);
});

test("shares one Firebase services module identity with the existing clients", () => {
  const servicesPattern = /from "(\.\/firebase-services\.js\?v=[^"]+)"/;
  assert.equal(trainingJs.match(servicesPattern)?.[1], freeTableJs.match(servicesPattern)?.[1]);
});

test("renders a separate 60-second countdown overlay and beat lane", () => {
  assert.match(trainingJs, /training-countdown-progress/);
  assert.match(trainingJs, /trainingCountdownFill/);
  assert.match(trainingJs, /training-beat-lane/);
  assert.match(trainingCss, /\.training-countdown-progress/);
  assert.match(trainingCss, /\.training-beat-lane/);
  assert.match(trainingCore, /TRAINING_TURN_DURATION_MS = 60_000/);
});

test("wires complete, surrender, timeout, six turns, and pair continuation", () => {
  assert.match(trainingJs, /\/completedAt/);
  assert.match(trainingJs, /\/surrenderedAt/);
  assert.match(trainingJs, /\/timedOutAt/);
  assert.match(trainingJs, /continueVotes\/\$\{view\.pair\}\/\$\{state\.uid\}/);
  assert.match(trainingCore, /TRAINING_MAX_TURNS = 6/);
  assert.match(trainingCore, /continueVotePairForTurn/);
  assert.match(trainingCore, /mutual_complete/);
  assert.match(trainingJs, /if \(remaining <= 0\) markTimeout\(\)/);
});

test("keeps training outside overall RATE and offers the free-table recovery path", () => {
  assert.doesNotMatch(trainingJs, /recordOverallResult|recordVerifiedResult|rating\s*:/);
  assert.match(trainingJs, /RATE・ランキングは変動しません/);
  assert.match(trainingJs, /window\.HariaiFreeTable\?\.start/);
  assert.match(trainingJs, /自由卓で一息つく/);
});

test("does not install a room-root value listener", () => {
  assert.doesNotMatch(
    trainingJs,
    /onValue\(\s*ref\(database,\s*`online\/trainingRooms\/\$\{[^}]+\}`\s*\)/,
  );
  assert.doesNotMatch(
    trainingJs,
    /get\(\s*ref\(database,\s*`online\/trainingRooms\/\$\{[^}]+\}`\s*\)\s*\)/,
  );
  assert.match(trainingJs, /"status", "imageReceived", "turns", "continueVotes", "destroyed", "serverFinalized"/);
  assert.match(trainingJs, /signals\/\$\{state\.uid\}/);
});

test("publishes training lobby presence without reading the private active root", () => {
  assert.match(trainingJs, /mode: "training"/);
  assert.match(trainingJs, /state\.publicPresenceState = "waiting"/);
  assert.match(trainingJs, /updatePublicPresence\("playing"\)/);
  assert.match(trainingJs, /lastSeen: firebaseNow\(\)/);
  assert.doesNotMatch(
    trainingJs,
    /onValue\(\s*ref\(database,\s*"online\/trainingActive"\)/,
  );
});

test("keeps health conditions out of the public queue until the guest accepts", () => {
  const queueWrite = trainingJs.match(/const queueEntry = \{([\s\S]*?)\n  \};/)?.[1] || "";
  assert.ok(queueWrite);
  assert.doesNotMatch(queueWrite, /conditions/);
  assert.doesNotMatch(trainingCore.match(/function validTrainingQueueEntries[\s\S]*?\n\}/)?.[0] || "", /conditions/);
  assert.match(trainingJs, /\[host\.uid\]: playerFromQueue\(host, state\.conditions\)/);
  assert.match(trainingJs, /\[guest\.uid\]: playerFromQueue\(guest, ""\)/);
  assert.match(
    trainingJs,
    /createTrainingAcceptanceUpdates\(state\.uid, state\.conditions\)[\s\S]*?await update\(ref\(database, `online\/trainingRooms\/\$\{roomId\}`\), acceptanceUpdates\)/,
  );
});

test("arms disconnect cleanup as soon as a forming room is claimed", () => {
  assert.match(trainingJs, /online\/trainingActive\/\$\{state\.uid\}\/rooms\/\$\{roomId\}/);
  assert.match(trainingJs, /statusDisconnect\.set\("expired"\)/);
  assert.match(trainingJs, /reason: isHost \? "forming_host_disconnected" : "forming_guest_disconnected"/);
  assert.match(trainingJs, /onDisconnect\(ownerRef\)/);
  assert.match(trainingJs, /await ownerDisconnect\.remove\(\)/);
});

test("keeps an active-room terminal fallback armed until terminal evidence is confirmed", () => {
  assert.match(trainingJs, /async function armActiveRoomDestroyedDisconnect/);
  assert.match(trainingJs, /reason: "active_member_disconnected"/);
  const enterBlock = trainingJs.match(/async function enterRoom[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(enterBlock.indexOf("armActiveRoomDestroyedDisconnect(roomId)") >= 0);
  assert.ok(
    enterBlock.indexOf("armActiveRoomDestroyedDisconnect(roomId)")
      < enterBlock.indexOf("cleanupMatchmaking(true)"),
  );
  assert.match(trainingJs, /transitionToTrainingResult[\s\S]*?cancelActiveRoomDestroyedDisconnect\(state\.roomId\)/);
  assert.match(trainingJs, /transitionToDestroyedRoom[\s\S]*?cancelActiveRoomDestroyedDisconnect\(state\.roomId\)/);
  assert.match(
    trainingJs,
    /async function deactivate[\s\S]*?await markRoomDestroyed\("player_exit"\)[\s\S]*?if \(!\["marked", "destroyed", "result"\]\.includes\(resolution\)\)[\s\S]*?await cancelActiveRoomDestroyedDisconnect\(state\.roomId\);\s*active = false/s,
  );
});

test("fences same-uid tabs before queueing and never yields an established tab lease", () => {
  assert.match(trainingJs, /new BroadcastChannel\("hariai-stadium-training-tab-v1"\)/);
  assert.match(trainingJs, /let trainingSharedStateOwned = false/);
  assert.match(
    trainingJs,
    /if \(message\.type === "claim" && trainingTabLeaseHeld\) \{\s*if \(trainingTabClaiming &&/,
  );
  assert.match(trainingJs, /type: "claim-denied"/);
  assert.match(trainingJs, /message\.targetTabId === trainingTabId\s*&& trainingTabClaiming/);
  assert.match(trainingJs, /await claimTrainingTabOwnership\(\);\s*await clearStaleTrainingActiveBeforeMatchmaking\(\)/s);
  assert.match(trainingJs, /trainingSharedStateOwned = true;\s*\}/);
  assert.match(
    trainingJs,
    /if \(!state\.uid \|\| state\.preview \|\| !trainingSharedStateOwned \|\| !queueSessionId\) return;\s*const invitesCleared = await cleanupTrainingInvitesForSession\(queueSessionId\);\s*if \(!invitesCleared\) return;\s*const queueCleared = await removeOwnedTrainingQueue\(queueSessionId\)/s,
  );
  assert.match(trainingJs, /function releaseTrainingTabOwnership\(\) \{[\s\S]*?trainingSharedStateOwned = false/);
  assert.match(trainingJs, /if \(state\.startingMatchmaking[\s\S]*?state\.startingMatchmaking = true;[\s\S]*?finally \{\s*state\.startingMatchmaking = false/s);
  assert.match(trainingJs, /async function cancelMatchmaking[\s\S]*?releaseTrainingTabOwnership\(\)/);
  assert.match(trainingJs, /async function cancelPendingRoom[\s\S]*?releaseTrainingTabOwnership\(\)/);
  assert.match(trainingJs, /async function deactivate[\s\S]*?releaseTrainingTabOwnership\(\)/);
  assert.match(trainingJs, /window\.addEventListener\("pagehide", \(\) => \{\s*releaseTrainingTabOwnership\(\)/s);
});

test("fences queue and invitations to one opaque matchmaking session", () => {
  assert.match(trainingCore, /export function normalizeTrainingSessionId/);
  assert.match(trainingCore, /normalizeTrainingSessionId\(entry\.sessionId\)/);
  assert.match(trainingJs, /async function claimTrainingQueueSession/);
  assert.match(trainingJs, /normalizeTrainingSessionId\(current\.sessionId\) !== sessionId/);
  assert.match(trainingJs, /lastSeen >= now - TRAINING_QUEUE_RECLAIM_MS/);
  assert.match(trainingJs, /async function updateOwnedTrainingQueue/);
  assert.match(trainingJs, /async function removeOwnedTrainingQueue/);
  assert.match(trainingJs, /queueEntryBelongsToSession\(current, sessionId\) \? null : undefined/);
  assert.doesNotMatch(trainingJs, /onDisconnect\(queueRef\)/);
  assert.doesNotMatch(trainingJs, /onDisconnect\([^)]*trainingMatchLock/);
  assert.doesNotMatch(
    trainingJs,
    /remove\(ref\(database, `online\/trainingQueue\/\$\{state\.uid\}`\)\)/,
  );
  assert.doesNotMatch(
    trainingJs,
    /remove\(ref\(database, `online\/trainingInvites\/\$\{state\.uid\}`\)\)/,
  );
  assert.match(trainingJs, /if \(!queueEntryBelongsToSession\(state\.latestQueue\?\.\[state\.uid\]\)\) return/);
  assert.match(trainingJs, /targetSessionId: guest\.sessionId/);
  assert.match(trainingJs, /invite\.targetSessionId === state\.queueSessionId/);
  assert.match(trainingJs, /current\?\.targetSessionId === targetSessionId \? null : undefined/);
  const acceptBlock = trainingJs.match(/async function acceptInvite[\s\S]*?\n\}/)?.[0] || "";
  assert.match(acceptBlock, /updateOwnedTrainingQueue\(\{ state: "forming" \}, invite\.targetSessionId\)/);
  assert.match(acceptBlock, /removeTrainingInviteForSession\(state\.uid, roomId, acceptedSessionId\)/);
  assert.doesNotMatch(acceptBlock, /removeOwnedTrainingQueue/);
  const cleanupBlock = trainingJs.match(/async function cleanupMatchmaking[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(
    cleanupBlock.indexOf("cleanupTrainingInvitesForSession(queueSessionId)")
      < cleanupBlock.indexOf("removeOwnedTrainingQueue(queueSessionId)"),
  );
  assert.match(cleanupBlock, /if \(!invitesCleared\) return/);
});

test("prioritizes a current-session invite over hosting and retries after host contention", () => {
  assert.match(trainingJs, /function hasCurrentTrainingInvite/);
  const attemptBlock = trainingJs.match(/async function attemptToHost[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(
    attemptBlock.indexOf("if (hasCurrentTrainingInvite())")
      < attemptBlock.indexOf("selectTrainingPair(freshQueueEntries())"),
  );
  assert.match(
    trainingJs,
    /async function processInvites\(\) \{\s*if \(state\.matchingBusy\) \{\s*scheduleInviteProcessing\(\);\s*return;/s,
  );
  assert.match(
    trainingJs,
    /if \(!await reserveTrainingActiveRoom\(roomId\)\) \{\s*scheduleInviteProcessing\(1_500\);\s*return false;/s,
  );
  const createBlock = trainingJs.match(/async function createTrainingRoom[\s\S]*?\n\}/)?.[0] || "";
  assert.match(
    createBlock,
    /state\.matchingBusy = false;\s*if \(hasCurrentTrainingInvite\(\)\) \{\s*scheduleInviteProcessing\(0\);/s,
  );
  assert.match(trainingJs, /window\.clearTimeout\(state\.inviteRetryTimer\)/);
});

test("uses sentinel-fenced room children so old disconnects cannot delete new sessions", () => {
  assert.doesNotMatch(trainingJs, /remove\(ref\(database, `online\/trainingActive\/\$\{state\.uid\}`\)\)/);
  assert.doesNotMatch(trainingJs, /onDisconnect\(ref\(database, `online\/trainingActive\/\$\{state\.uid\}`\)\)/);
  assert.match(trainingJs, /online\/trainingActive\/\$\{state\.uid\}\/rooms\/\$\{roomId\}/);
  assert.match(trainingJs, /\(current\) => current === true \? null : undefined/);
  assert.match(trainingJs, /return \{ roomId, rooms: \{ \[roomId\]: true \} \}/);
  assert.match(trainingJs, /current\?\.roomId === roomId \? null : undefined/);
  assert.match(trainingJs, /const keys = \["createdAt", "status", "members", "presence", "destroyed", "serverFinalized"\]/);
  assert.match(trainingJs, /trainingActiveRoomAppearsLive\(room, state\.uid, firebaseNow\(\)\)/);
});

test("rolls back partial host and guest claims without deleting a newer active room", () => {
  assert.match(trainingJs, /removeTrainingActiveChild\(roomId\)/);
  assert.match(trainingJs, /confirmPendingRoomTerminal\(roomId, "forming_setup_failed", true\)/);
  assert.match(trainingJs, /state: "waiting",\s*lastSeen: firebaseNow\(\)/s);
  assert.match(trainingJs, /if \(activeReserved\) await releaseTrainingActiveReservation\(roomId\)/);
  assert.match(trainingJs, /processInvites\(\)\.catch\(handleRecoverableError\)/);
  const createBlock = trainingJs.match(/async function createTrainingRoom[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(
    createBlock.indexOf('confirmPendingRoomTerminal(roomId, "forming_setup_failed", true)')
      < createBlock.indexOf("cancelDisconnectHandles(roomDisconnects)"),
  );
  assert.match(
    createBlock,
    /catch \(terminalError\) \{[\s\S]*?state\.pendingRoomId = roomId;[\s\S]*?state\.screen = "forming";[\s\S]*?throw terminalError;/,
  );
});

test("refreshes terminal room children before any no-contest write", () => {
  assert.match(trainingJs, /const keys = \["status", "turns", "continueVotes", "destroyed", "serverFinalized"\]/);
  const destroyBlock = trainingJs.match(/async function markRoomDestroyed[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(destroyBlock.indexOf("refreshRoomBeforeDestroy(roomId)") >= 0);
  assert.ok(
    destroyBlock.indexOf("refreshRoomBeforeDestroy(roomId)")
      < destroyBlock.indexOf("/destroyed`"),
  );
  assert.match(trainingJs, /if \(outcomeView\.phase === "result"\) \{\s*transitionToTrainingResult\(outcomeView\)/s);
  assert.match(trainingJs, /viewFromServerFinalized\(lifecycle\.serverFinalized, outcomeView\)/);
  assert.match(trainingJs, /viewFromServerFinalized\(state\.room\.serverFinalized, view\)/);
  assert.match(trainingJs, /if \(resolution === "result"\) \{\s*destroyDialog\?\.close\?\.\(\);\s*return;/s);
});

test("turns room setup failures into an explicit terminal screen", () => {
  assert.match(trainingJs, /markRoomDestroyed\("room_setup_failed"\)/);
  assert.match(trainingJs, /state\.screen = "error"/);
  assert.match(trainingJs, /state\.channel\?\.close\(\)/);
  assert.match(trainingJs, /state\.peer\?\.close\(\)/);
});

test("keeps forming cleanup armed while retrying a transient active-room entry failure", () => {
  const enterBlock = trainingJs.match(/async function enterRoom[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(
    enterBlock.indexOf("await armActiveRoomDestroyedDisconnect(roomId)")
      < enterBlock.indexOf("window.clearTimeout(state.matchTimer)"),
  );
  assert.match(trainingJs, /function scheduleEnterRoomRetry/);
  assert.match(trainingJs, /state\.pendingRoomId !== roomId \|\| state\.room\.status !== "active"/);
  assert.match(trainingJs, /state\.enterRoomRetryAttempts > 6/);
  assert.match(trainingJs, /enterRoom\(roomId\)\.catch\(handleRecoverableError\)/);
});

test("bounds P2P image exchange and routes every transfer failure to NO CONTEST", () => {
  assert.match(trainingJs, /IMAGE_EXCHANGE_TIMEOUT_MS = 45_000/);
  assert.match(trainingJs, /startImageExchangeWatchdog\(\)/);
  assert.match(trainingJs, /"image_exchange_timeout"/);
  assert.match(trainingJs, /"image_channel_error"/);
  assert.match(trainingJs, /"image_receive_failed"/);
  assert.match(trainingJs, /clearImageExchangeWatchdog\(\)/);
  assert.match(trainingJs, /id="trainingCancelledRetry"/);
  assert.match(trainingJs, /function transitionToLocalNoContestPending/);
  const localPendingBlock = trainingJs.match(/function transitionToLocalNoContestPending[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(localPendingBlock, /cancelActiveRoomDestroyedDisconnect|state\.room\.destroyed/);
  assert.doesNotMatch(trainingJs, /reason: `local:\$\{reason\}`/);
});

test("shows condition-aware timeout copy and a persistent stop-safety reminder", () => {
  assert.match(trainingJs, /result\.type === "win"[\s\S]*?result\.reason === "timeout"/);
  assert.match(trainingJs, /serverResult\?\.turnCount \?\? view\.turnIndex \?\? 0/);
  assert.match(trainingJs, /痛み・めまい・体調の変化を感じたら、勝敗より中止を優先/);
  assert.match(trainingCss, /\.training-give-up-dock p/);
});

test("shows private continuity records before play and labels the daily flag as a mission", () => {
  assert.match(trainingJs, /function renderSetupTrainingRecord/);
  assert.match(trainingJs, /累計完了セット/);
  assert.match(trainingJs, /続けた日数/);
  assert.match(trainingJs, /現在の連続/);
  assert.match(trainingJs, /最長連続/);
  assert.match(trainingJs, /今日の専用ミッション/);
  assert.match(trainingJs, /達成 1\/1/);
  assert.doesNotMatch(trainingJs, /今日のセット/);
  assert.match(trainingCss, /\.training-setup-record/);
});

test("tombstones a forming room before cancelling disconnect handlers", () => {
  assert.match(trainingJs, /if \(state\.pendingTeardown\) return state\.pendingTeardown/);
  assert.match(trainingJs, /teardownPendingRoom\("player_cancelled"\)/);
  assert.match(trainingJs, /teardownPendingRoom\("player_exit"\)[\s\S]*?active = false/);
  assert.match(trainingJs, /teardownPendingRoom\("fatal_error"\)[\s\S]*?cleanupMatchmaking\(false\)/);
  assert.match(trainingJs, /destroyPendingRoom\(roomId, reason\)/);
  assert.match(trainingJs, /if \(!statusTerminal && !destroyedTerminal\) \{\s*throw new Error/s);
  assert.match(trainingJs, /removeTrainingInviteForSession\(inviteTargetUid, roomId, targetSessionId\)/);
  assert.match(trainingJs, /releaseMatchLock\(roomId\)/);
  assert.match(
    trainingJs,
    /async function deactivate[\s\S]*?await teardownPendingRoom\("player_exit"\);\s*\} catch \(error\) \{\s*handleRecoverableError\(error\);\s*return false;\s*\}[\s\S]*?active = false/s,
  );
  assert.match(
    trainingJs,
    /async function handleFatalError[\s\S]*?await teardownPendingRoom\("fatal_error"\);\s*\} catch \(teardownError\) \{\s*handleRecoverableError\(teardownError\);\s*return;\s*\}[\s\S]*?cleanupMatchmaking\(false\)/s,
  );
});

test("creates protocol-fenced invitations that match the Rules schema", () => {
  assert.match(
    trainingJs,
    /trainingInvites\/\$\{guest\.uid\}\/\$\{roomId\}`\), \{\s*roomId,\s*hostUid: host\.uid,\s*targetSessionId: guest\.sessionId,\s*protocolVersion: TRAINING_PROTOCOL_VERSION,\s*variant: TRAINING_VARIANT,\s*createdAt:/s,
  );
  assert.match(trainingJs, /invite\.protocolVersion === TRAINING_PROTOCOL_VERSION/);
  assert.match(trainingJs, /invite\.variant === TRAINING_VARIANT/);
  const createBlock = trainingJs.match(/async function createTrainingRoom[\s\S]*?\n\}/)?.[0] || "";
  const inviteWrite = createBlock.indexOf("await set(ref(database, `online/trainingInvites/${guest.uid}/${roomId}`)");
  const earlyRelease = createBlock.indexOf("if (await releaseMatchLock(roomId)) ownsLock = false");
  const pendingAssignment = createBlock.indexOf("state.pendingRoomId = roomId");
  assert.ok(inviteWrite >= 0 && inviteWrite < earlyRelease);
  assert.ok(earlyRelease < pendingAssignment);
  assert.match(createBlock, /finally \{\s*if \(ownsLock\) \{\s*await releaseMatchLock\(roomId\);/s);
});

test("turns exhausted finalize polling into an explicit retry state", () => {
  assert.match(trainingJs, /if \(force\) state\.finalizeAttempts = 0/);
  assert.match(trainingJs, /完了記録の確認が長引いています/);
  assert.match(trainingJs, /id="trainingRetryFinalize"/);
});

test("publishes the complete HariaiTraining lifecycle API", () => {
  assert.match(
    trainingJs,
    /window\.HariaiTraining\s*=\s*\{\s*start,\s*isActive,\s*requestHome,\s*destroyRoom,\s*\}/s,
  );
  assert.match(trainingJs, /hariai-training-ready/);
});

test("offline previews never write turn progress when controls or the timer fire", () => {
  for (const functionName of [
    "submitInstruction",
    "startTurn",
    "completeTurn",
    "handleGiveUp",
    "markTimeout",
    "submitContinueVote",
  ]) {
    assert.match(
      trainingJs,
      new RegExp(`async function ${functionName}\\([^)]*\\) \\{\\s*if \\(state\\.preview\\) return;`),
    );
  }
});
