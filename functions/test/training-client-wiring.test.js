const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");
const trainingJs = fs.readFileSync(path.join(projectRoot, "training.js"), "utf8");
const trainingCss = fs.readFileSync(path.join(projectRoot, "training.css"), "utf8");
const trainingCore = fs.readFileSync(path.join(projectRoot, "training-core.mjs"), "utf8");
const trainingDesign = fs.readFileSync(path.join(projectRoot, "TRAINING_60_DESIGN.md"), "utf8");
const freeTableJs = fs.readFileSync(path.join(projectRoot, "free-table.js"), "utf8");

function functionBlock(name) {
  return trainingJs.match(new RegExp(`(?:async )?function ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

test("loads the HP V3 client and retires the team client", () => {
  assert.match(indexHtml, /href="training\.css\?v=kitaeai-hp-v3"/);
  assert.match(
    indexHtml,
    /src="training\.js\?v=kitaeai-hp-v3-matchmaking-v2-app-check-v3-remove-royale-v1-retire-team-v1-round-start-v1-session-v2-achievements-v1-rtdb-array-v1-session-owner-v1"/,
  );
  assert.match(
    trainingJs,
    /from "\.\/training-session-v2\.mjs\?v=training-session-v2-rtdb-array-v1"/,
  );
  assert.match(trainingJs, /training-core\.mjs\?v=kitaeai-hp-v3-matchmaking-v1/);
  assert.match(indexHtml, /src="app\.js\?v=[^"]*kitaeai-hp-v3[^"]*"/);
  assert.match(indexHtml, /src="online\.js\?v=[^"]*kitaeai-hp-v3[^"]*"/);
  assert.doesNotMatch(indexHtml, /src="team\.js(?:\?|")/);
  assert.match(appJs, /厳選した5枚をDRAW/);
  assert.match(appJs, /HP制の「鍛え合い60」/);
});

test("pins protocol 3, HP30, five DRAWs, and three COMMAND cards", () => {
  assert.match(trainingCore, /TRAINING_PROTOCOL_VERSION = 3/);
  assert.match(trainingCore, /TRAINING_VARIANT = "kitaeai_hp_v3"/);
  assert.match(trainingJs, /TRAINING_IMAGE_COUNT = 5/);
  assert.match(trainingJs, /TRAINING_COMMAND_COUNT = 3/);
  assert.match(trainingJs, /TRAINING_MAX_ROUNDS = 5/);
  assert.match(trainingJs, /TRAINING_START_HP = 30/);
  assert.doesNotMatch(trainingJs, /TRAINING_MAX_TURNS|firstTrainerUid|carrotChoices/);
});

test("builds a five-image deck with an independently validated BPM per image", () => {
  assert.match(trainingJs, /state\.localImages\.length === TRAINING_IMAGE_COUNT/);
  assert.match(trainingJs, /data-training-image-bpm="\$\{index\}"/);
  assert.match(trainingJs, /BPMは0、または40～160/);
  assert.match(trainingJs, /normalizeImageBpm/);
  assert.match(trainingJs, /createSampleItems\(3, TRAINING_IMAGE_COUNT, 0\)/);
  assert.match(trainingCss, /\.training-image-deck/);
  assert.match(trainingDesign, /画像番号とBPMはRTDBへ確定してP2Pメタデータと照合/);
});

test("builds three reusable-preparation COMMAND cards with 2, 4, or 8 beats", () => {
  assert.match(trainingJs, /exercise: "腕立て伏せ"/);
  assert.match(trainingJs, /exercise: "スクワット"/);
  assert.match(trainingJs, /exercise: "腹筋"/);
  assert.match(trainingJs, /\[2, 4, 8\]\.includes/);
  assert.match(trainingJs, /data-training-command-choice/);
  assert.match(trainingJs, /各カードは1試合1回/);
  assert.match(trainingCss, /\.training-command-deck-list/);
});

test("publishes COMMAND and BPM preparation in the queue but keeps conditions private", () => {
  const queueBlock = trainingJs.match(/const queueEntry = \{([\s\S]*?)\n  \};/)?.[1] || "";
  assert.ok(queueBlock);
  assert.match(queueBlock, /commandDeck: commandDeckPayload\(\)/);
  assert.match(queueBlock, /imageBpms: imageBpmsPayload\(\)/);
  assert.match(queueBlock, /protocolVersion: TRAINING_PROTOCOL_VERSION/);
  assert.match(queueBlock, /variant: TRAINING_VARIANT/);
  assert.doesNotMatch(queueBlock, /conditions/);
  assert.match(trainingJs, /\[host\.uid\]: playerFromQueue\(host, state\.conditions\)/);
  assert.match(trainingJs, /\[guest\.uid\]: playerFromQueue\(guest, ""\)/);
  assert.match(trainingJs, /createTrainingAcceptanceUpdates\(state\.uid, state\.conditions\)/);
});

test("copies prepared decks into both room player records", () => {
  const playerBlock = functionBlock("playerFromQueue");
  assert.match(playerBlock, /commandDeck: Object\.fromEntries/);
  assert.match(playerBlock, /TRAINING_COMMAND_COUNT/);
  assert.match(playerBlock, /imageBpms: Object\.fromEntries/);
  assert.match(playerBlock, /TRAINING_IMAGE_COUNT/);
  assert.match(playerBlock, /normalizeCommandCard/);
  assert.match(playerBlock, /normalizeImageBpm/);
});

test("reuses verified P2P image transfer and the free-table metronome", () => {
  assert.match(trainingJs, /from "\.\/online-image-transfer\.mjs\?v=[^"]+"/);
  assert.match(trainingJs, /verifiedOnlineImageMime/);
  assert.match(trainingJs, /completeIncomingOnlineImageTransfer/);
  assert.match(trainingJs, /from "\.\/free-table-ambience\.mjs\?v=[^"]+"/);
  assert.match(trainingJs, /createFreeTableAmbienceController/);
  assert.match(trainingJs, /\.info\/serverTimeOffset/);
  assert.match(trainingJs, /const firebaseNow = \(\) => Date\.now\(\) \+ Number\(state\.serverTimeOffset/);
  const servicesPattern = /from "(\.\/firebase-services\.js\?v=[^"]+)"/;
  assert.equal(trainingJs.match(servicesPattern)?.[1], freeTableJs.match(servicesPattern)?.[1]);
});

test("selects an unused local image randomly and commits DRAW metadata before sending bytes", () => {
  const drawBlock = functionBlock("ensureLocalRoundDraw");
  assert.match(drawBlock, /const used = new Set/);
  assert.match(drawBlock, /\.filter\(\(imageIndex\) => !used\.has\(imageIndex\)\)/);
  assert.match(drawBlock, /secureRandomChoice\(available\)/);
  assert.match(drawBlock, /candidate = \{ imageIndex, bpm, drawnAt: firebaseNow\(\) \}/);
  assert.ok(drawBlock.indexOf("/draws/${ownUid}`)")
    < drawBlock.indexOf("sendLocalRoundImage(roundIndex, draw, contextIsCurrent)"));
});

test("sends only image bytes over P2P and verifies RTDB DRAW metadata before acknowledging", () => {
  const sendBlock = functionBlock("sendLocalRoundImage");
  const receiveBlock = functionBlock("finishIncomingImage");
  assert.match(sendBlock, /type: "training-image-start"/);
  assert.match(sendBlock, /round: roundIndex/);
  assert.match(sendBlock, /imageIndex/);
  assert.match(sendBlock, /bpm: Number\(draw\.bpm\)/);
  assert.match(receiveBlock, /rounds\/\$\{roundIndex\}\/draws\/\$\{opponentUid\}/);
  assert.match(receiveBlock, /P2P画像とFirebaseのDRAW情報が一致しません/);
  assert.ok(receiveBlock.indexOf("P2P画像とFirebaseのDRAW情報が一致しません")
    < receiveBlock.indexOf("/imageReceived/${ownUid}`)"));
  assert.doesNotMatch(trainingJs, /(?:set|update|runTransaction)\([^)]*Firebase[^)]*(?:blob|imageUrl|imageData)/i);
});

test("keeps score secret until the local score is committed", () => {
  const listenerBlock = functionBlock("setupRoomListeners");
  const pollBlock = functionBlock("pollOpponentScore");
  const boundedScoreBlock = functionBlock("readRoundScoresBounded");
  const submitBlock = functionBlock("submitScore");
  assert.match(listenerBlock, /scores\/\$\{context\.uid\}/);
  assert.doesNotMatch(listenerBlock, /onValue\([\s\S]*?scores\/\$\{opponentUid\}/);
  assert.match(submitBlock, /current === null \? score : undefined/);
  assert.match(submitBlock, /scheduleScorePoll\(0\)/);
  assert.match(pollBlock, /oldestPendingOpponentScoreRoundIndex\(\)/);
  assert.match(pollBlock, /readRoundScoresBounded\(roomId, roundIndex\)/);
  assert.ok(boundedScoreBlock.indexOf("`${base}/${state.uid}`")
    < boundedScoreBlock.indexOf("get(ref(database, base))"));
  assert.match(boundedScoreBlock, /if \(!ownScore\) return scores/);
  assert.match(boundedScoreBlock, /get\(ref\(database, `\$\{base\}\/\$\{opponentUid\}`\)\)\.catch/);
});

test("queues the oldest missing opponent score and performs one bounded reconnect refresh", () => {
  const queueBlock = functionBlock("oldestPendingOpponentScoreRoundIndex");
  const setupBlock = functionBlock("setupRoomListeners");
  assert.match(queueBlock, /for \(let roundIndex = 1; roundIndex <= TRAINING_MAX_ROUNDS; roundIndex \+= 1\)/);
  assert.match(queueBlock, /roundScore\(round, state\.uid\) && !roundScore\(round, opponentUid\)/);
  assert.match(setupBlock, /readTrainingRoundsBounded\(roomId\)/);
  assert.match(setupBlock, /mergeTrainingRounds\(refreshedRounds\.value\)/);
});

test("maps 8, 9, and 10 to damage 10/15/20 and workouts 60/75/90 seconds", () => {
  assert.match(trainingJs, /8: Object\.freeze\(\{ label: "HIT 8", damage: 10, durationMs: 60_000 \}\)/);
  assert.match(trainingJs, /9: Object\.freeze\(\{ label: "CRITICAL 9", damage: 15, durationMs: 75_000 \}\)/);
  assert.match(trainingJs, /10: Object\.freeze\(\{ label: "PERFECT 10", damage: 20, durationMs: 90_000 \}\)/);
  assert.match(trainingJs, /Math\.max\(0, TRAINING_START_HP - damageTakenBy\(uid\)\)/);
  assert.match(trainingCss, /\.training-hp-track/);
});

test("allows independent DOUBLE HIT command and workout paths without alternating turns", () => {
  const viewBlock = functionBlock("trainingClientView");
  assert.match(viewBlock, /opponentScore >= 8 && !round\.commandChoices\?\.\[opponentUid\]/);
  assert.match(viewBlock, /ownScore >= 8 && !round\.commandChoices\?\.\[state\.uid\]/);
  assert.match(trainingJs, /requiredRoundWorkoutsComplete/);
  assert.doesNotMatch(trainingJs, /firstTrainerUid|trainerOrder|turnIndex|交互ターン/);
});

test("uses each trainer COMMAND at most once and writes the choice under the trainee", () => {
  const choiceBlock = functionBlock("submitCommandChoice");
  assert.match(choiceBlock, /usedCommandIndexes\(state\.uid\)\.has\(cardIndex\)/);
  assert.match(choiceBlock, /trainerUid: state\.uid/);
  assert.match(choiceBlock, /selectedAt: firebaseNow\(\)/);
  assert.match(choiceBlock, /commandChoices\/\$\{victimUid\}/);
  assert.match(choiceBlock, /current === null \? choice : undefined/);
});

test("derives workout timing from the score, image BPM, and COMMAND beat count", () => {
  const completeBlock = functionBlock("completeWorkout");
  const ambienceBlock = functionBlock("setWorkoutAmbience");
  assert.match(completeBlock, /completedAt = startedAt \+ context\.scoreInfo\.durationMs/);
  assert.match(completeBlock, /firebaseNow\(\) < completedAt/);
  assert.match(ambienceBlock, /metronomeBpm: context\.bpm/);
  assert.match(trainingJs, /beatsPerRep: context\.card\.beatsPerRep/);
  assert.match(trainingJs, /trainingCountdownFill/);
  assert.match(trainingCss, /\.training-countdown-progress/);
  assert.match(trainingCss, /\.training-beat-lane/);
});

test("completes a workout through the Rules-authorized child path exactly once", () => {
  const completeBlock = functionBlock("completeWorkout");
  assert.match(trainingJs, /workoutCompletion: null/);
  assert.match(
    completeBlock,
    /rounds\/\$\{roundIndex\}\/workouts\/\$\{uid\}\/completedAt/,
  );
  assert.doesNotMatch(
    completeBlock,
    /runTransaction\(\s*ref\(database,\s*`[^`]*\/workouts\/\$\{(?:state|targetState)\.uid\}`/,
  );
  assert.match(completeBlock, /pending\.key === completionKey \? pending\.promise : false/);
  assert.match(completeBlock, /current == null \? completedAt : undefined/);
  assert.match(completeBlock, /\{ applyLocally: false \}/);
  assert.match(completeBlock, /storedCompletedAt !== completedAt/);
  assert.match(
    completeBlock,
    /targetState\.workoutCompletion\?\.promise === operation[\s\S]*targetState\.workoutCompletion = null/,
  );
});

test("keeps the 90-second workout alive across mobile screen lifecycle events", () => {
  const startBlock = functionBlock("startWorkout");
  const completeBlock = functionBlock("completeWorkout");
  const visibilityBlock = trainingJs.match(
    /document\.addEventListener\("visibilitychange",[\s\S]*?\n\}\);/,
  )?.[0] || "";

  assert.match(trainingJs, /workoutWakeLock: null/);
  assert.match(trainingJs, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(trainingJs, /function trainingWorkoutNeedsWakeLock/);
  assert.match(startBlock, /syncTrainingWorkoutWakeLock\(state\)/);
  assert.match(completeBlock, /releaseTrainingWorkoutWakeLock\(targetState\)/);
  assert.match(visibilityBlock, /refreshTrainingSessionLease\(targetState\)/);
  assert.match(visibilityBlock, /syncTrainingWorkoutWakeLock\(targetState\)/);
  assert.match(trainingDesign, /鍛え合い専用180秒lease/);
  assert.match(trainingDesign, /Screen Wake Lock/);
});

test("settles each completed DRAW once and stops after HP zero or five DRAWs", () => {
  const settleBlock = functionBlock("ensureRoundProgress");
  const terminalBlock = functionBlock("roundCreatesNaturalResult");
  assert.match(settleBlock, /state\.room\.hostUid !== state\.uid/);
  assert.match(settleBlock, /updates = \{ \[`rounds\/\$\{roundIndex\}\/completedAt`\]: completedAt \}/);
  assert.match(settleBlock, /updates\[`rounds\/\$\{roundIndex \+ 1\}\/createdAt`\] = completedAt/);
  assert.match(terminalBlock, /uids\.some\(\(uid\) => hpFor\(uid\) <= 0\)/);
  assert.match(terminalBlock, /roundIndex >= TRAINING_MAX_ROUNDS/);
});

test("shows canonical HP tie-break evidence in the result", () => {
  assert.match(trainingJs, /view\?\.scoreTotalByUid\?\.\[uid\]/);
  assert.match(trainingJs, /view\?\.score10CountByUid\?\.\[uid\]/);
  assert.match(trainingJs, /view\?\.score9CountByUid\?\.\[uid\]/);
  assert.match(trainingJs, /YOUR IMAGE SCORE/);
  assert.match(trainingJs, /RIVAL IMAGE SCORE/);
  assert.match(trainingJs, /HP → 画像の合計点 → 10点の数 → 9点の数の順で判定/);
  assert.match(trainingJs, /view\.workoutSecondsByUid\?\.\[state\.uid\]/);
  assert.match(trainingJs, /state\.room\.serverFinalized\?\.version === TRAINING_PROTOCOL_VERSION \? view\.roundIndex/);
  assert.match(trainingCss, /\.training-tiebreak/);
});

test("separates GIVE UP loss from health-stop NO CONTEST", () => {
  const giveUpBlock = functionBlock("handleGiveUp");
  const healthBlock = functionBlock("handleHealthStop");
  assert.match(giveUpBlock, /\/surrendered`/);
  assert.match(giveUpBlock, /\{ uid: state\.uid, at: firebaseNow\(\) \}/);
  assert.match(healthBlock, /markRoomDestroyed\("health_stop"\)/);
  assert.match(trainingJs, /result\.reason === "health_stop"/);
  assert.match(trainingJs, /体調変化を最優先/);
  assert.match(trainingJs, /GIVE UPが確定/);
});

test("keeps OVERKILL finisher optional, P2P-only, and bounded by a Firebase-adjusted 15-second offer", () => {
  const offerBlock = functionBlock("offerFinisher");
  const receiveBlock = functionBlock("receiveFinisherMessage");
  assert.match(offerBlock, /expiresAt = firebaseNow\(\) \+ 15_000/);
  assert.match(receiveBlock, /const now = firebaseNow\(\)/);
  assert.match(receiveBlock, /expiresAt < now \+ 1_000/);
  assert.match(receiveBlock, /expiresAt > now \+ 20_000/);
  assert.match(receiveBlock, /firebaseNow\(\) < Number\(state\.finisher\.expiresAt/);
  assert.match(trainingJs, /type: "training-finisher-offer"/);
  assert.match(trainingJs, /勝敗・RATE・記録には影響しません/);
  assert.doesNotMatch(trainingJs, /trainingRooms\/[^`]*(?:finisher|overkill)/i);
});

test("cleans both finisher intervals at every client teardown boundary", () => {
  const deactivateBlock = functionBlock("deactivate");
  assert.match(deactivateBlock, /clearInterval\(state\.finisherTicker\)/);
  assert.match(deactivateBlock, /clearInterval\(state\.finisherOfferTimer\)/);
  assert.match(deactivateBlock, /state\.finisherOfferTimer = null/);
  assert.match(trainingJs, /window\.addEventListener\("pagehide"[\s\S]*?clearInterval\(state\.finisherTicker\)[\s\S]*?clearInterval\(state\.finisherOfferTimer\)/);
});

test("keeps coaching encouragement ephemeral on the P2P channel", () => {
  assert.match(trainingJs, /type: "training-cheer"/);
  assert.match(trainingJs, /type: "training-free-cheer"/);
  assert.match(trainingJs, /state\.freeCheerSentRound = view\.roundIndex/);
  assert.doesNotMatch(trainingJs, /ref\(database,\s*`online\/trainingRooms\/[^`]*(?:cheer|message)/i);
  assert.match(trainingCss, /\.training-free-cheer/);
});

test("keeps training outside RATE and offers free-table recovery", () => {
  assert.doesNotMatch(trainingJs, /recordOverallResult|recordVerifiedResult|rating\s*:/);
  assert.match(trainingJs, /RATE・ランキングは変動しません/);
  assert.match(trainingJs, /window\.HariaiFreeTable\?\.start/);
  assert.match(trainingJs, /自由卓で一息つく/);
});

test("does not install a room-root value listener and subscribes only to bounded V3 children", () => {
  assert.doesNotMatch(trainingJs, /onValue\(\s*ref\(database,\s*`online\/trainingRooms\/\$\{[^}]+\}`\s*\)/);
  assert.doesNotMatch(trainingJs, /get\(\s*ref\(database,\s*`online\/trainingRooms\/\$\{[^}]+\}`\s*\)\s*\)/);
  assert.match(trainingJs, /const childKeys = \["status", "surrendered", "destroyed", "serverFinalized"\]/);
  assert.match(trainingJs, /\["createdAt", "draws", "imageReceived", "commandChoices", "workouts", "completedAt"\]/);
  assert.match(trainingJs, /for \(let roundIndex = 1; roundIndex <= TRAINING_MAX_ROUNDS; roundIndex \+= 1\)/);
});

test("publishes privacy-safe lobby presence without reading the private active root", () => {
  assert.match(trainingJs, /mode: "training"/);
  assert.match(trainingJs, /targetState\.publicPresenceState = "waiting"/);
  assert.match(trainingJs, /updatePublicPresence\("playing"\)/);
  assert.match(
    trainingJs,
    /lastSeen: Date\.now\(\) \+ Number\(targetState\.serverTimeOffset \|\| 0\)/,
  );
  assert.doesNotMatch(trainingJs, /onValue\(\s*ref\(database,\s*"online\/trainingActive"\)/);
});

test("keeps destroyed-onDisconnect only for legacy rooms", () => {
  const enterBlock = functionBlock("enterRoom");
  const listenersBlock = functionBlock("setupRoomListeners");
  const deactivateBlock = functionBlock("deactivate");
  assert.match(trainingJs, /async function armActiveRoomDestroyedDisconnect/);
  assert.match(trainingJs, /reason: "active_member_disconnected"/);
  assert.match(
    enterBlock,
    /if \(sessionV2\) \{\s*await cancelActiveRoomDestroyedDisconnect\(\);\s*\} else \{\s*await armActiveRoomDestroyedDisconnect\(roomId\)/,
  );
  assert.match(
    listenersBlock,
    /if \(!context\.sessionV2[\s\S]*armTrainingActiveDisconnect\(roomId\)/,
  );
  assert.match(
    listenersBlock,
    /if \(!context\.sessionV2[\s\S]*presence\?\.online === false[\s\S]*markRoomDestroyed/,
  );
  assert.match(trainingJs, /transitionToTrainingResult[\s\S]*?cancelActiveRoomDestroyedDisconnect\(state\.roomId\)/);
  assert.match(trainingJs, /transitionToDestroyedRoom[\s\S]*?cancelActiveRoomDestroyedDisconnect\(state\.roomId\)/);
  assert.match(deactivateBlock, /await markRoomDestroyed\("player_exit"\)/);
  assert.match(deactivateBlock, /await cancelActiveRoomDestroyedDisconnect\(state\.roomId\)/);
});

test("fences same-uid tabs and queue ownership by opaque session", () => {
  assert.match(trainingJs, /new BroadcastChannel\("hariai-stadium-training-tab-v1"\)/);
  assert.match(trainingJs, /type: "claim-denied"/);
  assert.match(trainingJs, /await claimTrainingTabOwnership\(\)/);
  assert.match(trainingJs, /normalizeTrainingSessionId\(current\.sessionId\) !== sessionId/);
  assert.match(trainingJs, /queueEntryBelongsToSession\(current, sessionId\) \? null : undefined/);
  assert.doesNotMatch(trainingJs, /onDisconnect\(queueRef\)/);
  assert.match(trainingJs, /releaseTrainingTabOwnership\(\)/);
});

test("fences invitations by protocol, variant, and queue session", () => {
  assert.match(trainingJs, /targetSessionId: guest\.sessionId/);
  assert.match(trainingJs, /protocolVersion: TRAINING_PROTOCOL_VERSION/);
  assert.match(trainingJs, /variant: TRAINING_VARIANT/);
  assert.match(trainingJs, /invite\.targetSessionId === state\.queueSessionId/);
  assert.match(trainingJs, /invite\.protocolVersion === TRAINING_PROTOCOL_VERSION/);
  assert.match(trainingJs, /invite\.variant === TRAINING_VARIANT/);
  assert.match(trainingJs, /removeTrainingInviteReliably\(state\.uid, roomId, acceptedSessionId\)/);
});

test("refreshes terminal round data before writing a destroy reason", () => {
  const refreshBlock = functionBlock("refreshRoomBeforeDestroy");
  const destroyBlock = functionBlock("markRoomDestroyed");
  const lifecycleBlock = functionBlock("readRoomLifecycle");
  const boundedRoundBlock = functionBlock("readTrainingRoundBounded");
  assert.match(lifecycleBlock, /const keys = \["status", "surrendered", "destroyed", "serverFinalized"\]/);
  assert.match(lifecycleBlock, /readTrainingRoundsBounded\(roomId\)/);
  assert.doesNotMatch(lifecycleBlock, /`\$\{base\}\/rounds`/);
  assert.match(boundedRoundBlock, /\["createdAt", "draws", "imageReceived", "commandChoices", "workouts", "completedAt"\]/);
  assert.match(boundedRoundBlock, /readRoundScoresBounded\(roomId, roundIndex\)/);
  assert.ok(destroyBlock.indexOf("refreshRoomBeforeDestroy(roomId)") >= 0);
  assert.ok(destroyBlock.indexOf("refreshRoomBeforeDestroy(roomId)") < destroyBlock.indexOf("/destroyed`"));
  assert.match(refreshBlock, /if \(outcomeView\.phase === "result"\)/);
  assert.match(refreshBlock, /viewFromServerFinalized\(lifecycle\.serverFinalized, outcomeView\)/);
});

test("prioritizes server finalization and blocks natural results until completed scores hydrate", () => {
  const reactBlock = functionBlock("reactToRoomData");
  const renderBlock = functionBlock("renderRoom");
  const hydrationBlock = functionBlock("requestCompletedRoundScoreHydration");
  const finalizationStatusBlock = functionBlock("renderFinalizationStatus");
  assert.ok(reactBlock.indexOf("viewFromServerFinalized(state.room.serverFinalized")
    < reactBlock.indexOf("completedRoundIndexesMissingScores().length"));
  assert.ok(reactBlock.indexOf("completedRoundIndexesMissingScores().length")
    < reactBlock.indexOf('if (canonicalView.phase === "result")'));
  assert.match(reactBlock, /if \(state\.screen === "result"\) \{[\s\S]*?state\.outcome = finalizedView;[\s\S]*?render\(\)/);
  assert.ok(renderBlock.indexOf("finalizedView")
    < renderBlock.indexOf("completedRoundIndexesMissingScores().length"));
  assert.match(renderBlock, /if \(finalizedView\) \{[\s\S]*?clearImageExchangeWatchdog\(\);[\s\S]*?clearScorePoll\(\);[\s\S]*?state\.currentView = finalizedView/);
  assert.match(renderBlock, /if \(canonicalView\.phase === "result" \|\| view\.phase === "result"\) \{[\s\S]*?clearImageExchangeWatchdog\(\);[\s\S]*?clearScorePoll\(\);[\s\S]*?state\.currentView = resultView/);
  assert.match(hydrationBlock, /readRoundScoresBounded\(roomId, roundIndex\)/);
  assert.match(hydrationBlock, /requestCompletedRoundScoreHydration\(\)/);
  assert.ok(finalizationStatusBlock.indexOf("trainingServerFinalizedResult(state.room.serverFinalized")
    < finalizationStatusBlock.indexOf("state.finalization?.error"));
  assert.match(trainingJs, /確認が終わるまで、次のDRAWや結果確定は開始しません/);
});

test("bounds every P2P image exchange and routes failure away from scoring", () => {
  const drawBlock = functionBlock("ensureLocalRoundDraw");
  assert.match(trainingJs, /IMAGE_EXCHANGE_TIMEOUT_MS = 45_000/);
  assert.match(trainingJs, /startImageExchangeWatchdog/);
  assert.match(trainingJs, /"image_exchange_timeout"/);
  assert.match(trainingJs, /"image_channel_error"/);
  assert.match(trainingJs, /"image_receive_failed"/);
  assert.match(trainingJs, /transitionToLocalNoContestPending/);
  assert.match(trainingJs, /45秒以内に画像交換を完了できなかったため、NO CONTEST/);
  assert.match(trainingJs, /!allRoundImagesReceived\(view\.round\)/);
  assert.match(
    drawBlock,
    /rounds\/\$\{roundIndex\}\/createdAt/,
  );
  assert.match(drawBlock, /current == null \? firebaseNow\(\) : undefined/);
  assert.match(drawBlock, /\{ applyLocally: false \}/);
  assert.match(drawBlock, /ensureRoundLocal\(roundIndex\)\.createdAt = createdAt/);
  assert.doesNotMatch(drawBlock, /current === null \? \{ createdAt:/);
});

test("shows V3-only private HP activity records while preserving old records outside new writes", () => {
  assert.match(trainingJs, /profile\.hpSessions/);
  assert.match(trainingJs, /profile\.hpWins/);
  assert.match(trainingJs, /profile\.hpCompletedWorkouts/);
  assert.match(trainingJs, /profile\.hpHitsTaken/);
  assert.match(trainingJs, /profile\.hpCompletedSeconds/);
  assert.match(trainingJs, /daily\?\.trainingMatches/);
  assert.doesNotMatch(functionBlock("renderSetupTrainingRecord"), /currentStreak|threeSet|trainingSets/);
});

test("keeps a live legacy room behind a read-only compatibility boundary", () => {
  const staleBlock = functionBlock("clearStaleTrainingActiveBeforeMatchmaking");
  assert.match(staleBlock, /room\.protocolVersion !== TRAINING_PROTOCOL_VERSION/);
  assert.match(staleBlock, /room\.variant !== TRAINING_VARIANT/);
  assert.match(staleBlock, /旧バージョンの鍛え合いが進行中です/);
  assert.ok(staleBlock.indexOf("room.protocolVersion !== TRAINING_PROTOCOL_VERSION")
    < staleBlock.indexOf("removeTrainingActiveChild(observedRoomId)"));
  assert.match(staleBlock, /if \(!await removeTrainingActiveChild\(observedRoomId\)\)/);
  assert.match(staleBlock, /if \(!await removeTrainingActiveParentIfOwned\(activeValue\.roomId\)\)/);
  assert.match(staleBlock, /const remainingSnapshot = await get\(activeRef\)/);
  assert.match(staleBlock, /if \(remainingSnapshot\.exists\(\)\)/);
});

test("refreshes queue leases and completes cold-cache cleanup before retrying", () => {
  const updateQueueBlock = functionBlock("updateOwnedTrainingQueue");
  const removeQueueBlock = functionBlock("removeOwnedTrainingQueue");
  const removeInviteBlock = functionBlock("removeTrainingInviteForSession");
  const scheduleInviteBlock = functionBlock("scheduleInviteProcessing");
  const releaseLockBlock = functionBlock("releaseMatchLock");
  const removeActiveChildBlock = functionBlock("removeTrainingActiveChild");
  const removeActiveParentBlock = functionBlock("removeTrainingActiveParentIfOwned");
  const reserveActiveBlock = functionBlock("reserveTrainingActiveRoom");
  const releaseActiveBlock = functionBlock("releaseTrainingActiveReservation");
  const statusBlock = functionBlock("transitionTrainingRoomStatus");
  const createRoomBlock = functionBlock("createTrainingRoom");
  const acceptInviteBlock = functionBlock("acceptInvite");
  const beginBlock = functionBlock("beginMatchmaking");
  const teardownBlock = functionBlock("teardownPendingRoom");
  const returnBlock = functionBlock("returnToWaitingQueue");
  const enterBlock = functionBlock("enterRoom");
  const cleanupBlock = functionBlock("cleanupMatchmaking");
  const retryBlock = functionBlock("retryTrainingCleanup");
  const deactivateBlock = functionBlock("deactivate");
  const fatalBlock = functionBlock("handleFatalError");
  const enterRetryBlock = functionBlock("scheduleEnterRoomRetry");

  assert.match(updateQueueBlock, /const lastSeen = firebaseNow\(\)/);
  assert.match(updateQueueBlock, /if \(current == null\) return null/);
  assert.ok(updateQueueBlock.lastIndexOf("lastSeen")
    > updateQueueBlock.indexOf("...patch"));
  assert.match(removeQueueBlock, /if \(current == null\) return null/);
  assert.match(removeQueueBlock, /transaction\?\.committed/);
  assert.doesNotMatch(removeQueueBlock, /transaction\.committed\s*\|\|/);
  assert.match(removeInviteBlock, /targetUid !== state\.uid/);
  assert.match(removeInviteBlock, /await remove\(inviteRef\)/);
  assert.match(removeInviteBlock, /if \(current == null\) return null/);
  assert.match(scheduleInviteBlock, /processInvites\(\)\.catch\(\(error\) =>/);
  assert.match(scheduleInviteBlock, /scheduleInviteProcessing\(2_000\)/);
  assert.match(
    trainingJs,
    /state\.latestInvites = snapshot\.val\(\) \|\| \{\};\s*scheduleInviteProcessing\(0\)/,
  );
  assert.match(
    trainingJs,
    /state\.latestQueue = snapshot\.val\(\) \|\| \{\};\s*scheduleInviteProcessing\(0\)/,
  );
  assert.equal((trainingJs.match(/processInvites\(\)\.catch/g) || []).length, 1);
  assert.match(releaseLockBlock, /if \(current == null\) return null/);
  assert.match(removeActiveChildBlock, /current == null \|\| current === true/);
  assert.match(removeActiveChildBlock, /transaction\?\.committed/);
  assert.match(removeActiveParentBlock, /if \(current == null\) return null/);
  assert.match(reserveActiveBlock, /const reservedAt = firebaseNow\(\)/);
  assert.match(reserveActiveBlock, /return \{ roomId, reservedAt, rooms:/);
  assert.ok(releaseActiveBlock.indexOf("childReleased")
    < releaseActiveBlock.indexOf("parentReleased"));
  assert.match(releaseActiveBlock, /remaining\.val\(\)\?\.rooms\?\.\[roomId\] !== true/);
  assert.match(statusBlock, /current == null \|\| current === expected/);
  assert.match(statusBlock, /applyLocally: false/);
  assert.match(
    beginBlock,
    /claimTrainingSessionLease\([\s\S]*expectedState\.matchmakingGeneration,[\s\S]*expectedState/,
  );
  assert.match(
    beginBlock,
    /enqueueTrainingSessionQueue\([\s\S]*expectedState\.matchmakingGeneration,[\s\S]*expectedState/,
  );
  assert.match(beginBlock, /startPublicPresence\(expectedState\)\.catch/);
  assert.match(
    beginBlock,
    /watchTrainingSessionOffers\([\s\S]*expectedState\.matchmakingGeneration,[\s\S]*expectedState/,
  );
  assert.ok(
    beginBlock.indexOf("scheduleTrainingSessionTryMatch(0)")
      < beginBlock.indexOf("startPublicPresence(expectedState).catch"),
  );
  assert.match(
    beginBlock,
    /if \(released\) \{[\s\S]*expectedState\.sessionLeaseHeld = false/,
  );
  assert.doesNotMatch(beginBlock, /online\/trainingQueue|online\/trainingInvites|trainingMatchLock/);
  assert.match(createRoomBlock, /const inviteCleared = !roomCreated/);
  assert.match(createRoomBlock, /const activeReleased = !activeReserved/);
  assert.match(createRoomBlock, /const queueReturnedToWaiting = !retryMatching/);
  assert.match(
    createRoomBlock,
    /if \(!inviteCleared \|\| !activeReleased \|\| !queueReturnedToWaiting\)/,
  );
  assert.match(createRoomBlock, /if \(roomCreated\) \{[\s\S]*state\.pendingRoomId = roomId/);
  assert.match(createRoomBlock, /await handleFatalError/);
  assert.match(acceptInviteBlock, /removeTrainingInviteReliably/);
  assert.match(acceptInviteBlock, /scheduleInviteProcessing\(2_000\)/);
  assert.match(acceptInviteBlock, /const activeReleased = !activeReserved/);
  assert.match(acceptInviteBlock, /const queueReturnedToWaiting = !guestQueueForming/);
  assert.match(acceptInviteBlock, /if \(!activeReleased \|\| !queueReturnedToWaiting\)/);
  assert.match(acceptInviteBlock, /await handleFatalError/);
  assert.match(teardownBlock, /removeTrainingInviteReliably/);
  assert.match(teardownBlock, /releaseMatchLockReliably/);
  assert.match(teardownBlock, /if \(!inviteCleared \|\| !lockReleased\)/);
  assert.match(returnBlock, /removeTrainingInviteReliably/);
  assert.match(returnBlock, /const matchmakingCleared = await cleanupMatchmakingReliably/);
  assert.match(returnBlock, /if \(!matchmakingCleared\)/);
  assert.match(returnBlock, /releaseMatchLockReliably/);
  assert.ok(enterBlock.indexOf("removeTrainingInviteReliably")
    < enterBlock.indexOf("state.roomId = roomId"));
  assert.ok(enterBlock.indexOf("releaseMatchLockReliably")
    < enterBlock.indexOf("state.roomId = roomId"));
  assert.ok(enterBlock.indexOf("cleanupMatchmakingReliably(true)")
    < enterBlock.indexOf("state.roomId = roomId"));
  assert.match(cleanupBlock, /return queueCleared/);
  assert.match(retryBlock, /MATCHMAKING_CLEANUP_RETRY_DELAYS_MS/);
  assert.match(retryBlock, /if \(await operation\(\)\) return true/);
  assert.match(deactivateBlock, /if \(!await cleanupMatchmakingReliably\(false\)\)/);
  assert.match(fatalBlock, /const matchmakingCleared = await cleanupMatchmakingReliably/);
  assert.match(fatalBlock, /if \(matchmakingCleared\) releaseTrainingTabOwnership/);
  assert.match(enterRetryBlock, /if \(state\.enterRoomRetryAttempts > 6\)/);
  assert.match(enterRetryBlock, /handleFatalError/);
});

test("skips unavailable candidates without exposing their private active or invite state", () => {
  const hostBlock = functionBlock("attemptToHost");
  const refreshBlock = functionBlock("refreshTrainingPair");
  const lockBlock = functionBlock("acquireMatchLock");
  const selectionBlock = functionBlock("selectCurrentTrainingPair");
  const takeoverBlock = functionBlock("scheduleTrainingHostTakeover");
  const staleInviteBlock = functionBlock("cleanupStaleTrainingInvites");
  const staleInviteRemoveBlock = functionBlock("removeStaleTrainingInvite");
  const activeSkipBlock = functionBlock("activeTrainingCandidateSkipKeys");
  const markSkipBlock = functionBlock("markTrainingCandidateUnavailable");
  const activeParentBlock = functionBlock("removeTrainingActiveParentIfOwned");
  const createRoomBlock = functionBlock("createTrainingRoom");
  const expireBlock = functionBlock("expirePendingRoom");
  const cleanupBlock = functionBlock("cleanupMatchmaking");

  assert.match(hostBlock, /selectCurrentTrainingPair\(entries\)/);
  assert.match(hostBlock, /selectCurrentTrainingPair\(entries, true\)/);
  assert.match(hostBlock, /scheduleTrainingHostTakeover/);
  assert.match(refreshBlock, /selectCurrentTrainingPair\(entries\)/);
  assert.match(selectionBlock, /requesterUid: state\.uid/);
  assert.match(selectionBlock, /excludedEntryKeys: activeTrainingCandidateSkipKeys\(entries\)/);
  assert.match(selectionBlock, /allowHostTakeover/);
  assert.match(takeoverBlock, /attemptToHost\(\)/);
  assert.match(lockBlock, /!transaction\.committed/);
  assert.match(lockBlock, /lock\.uid !== state\.uid/);
  assert.match(lockBlock, /lockExpiresAt > firebaseNow\(\)/);
  assert.match(lockBlock, /scheduleTrainingHostTakeover\(lockExpiresAt \+ MATCH_LOCK_RETRY_GRACE_MS\)/);
  assert.match(cleanupBlock, /clearTrainingHostTakeoverTimer\(\)/);
  assert.match(activeSkipBlock, /delete state\.unavailableQueueEntries\[key\]/);
  assert.match(markSkipBlock, /TRAINING_CANDIDATE_SKIP_MS/);
  assert.match(activeParentBlock, /Object\.values\(rooms\)\.some\(\(claimed\) => claimed === true\)/);
  assert.match(activeParentBlock, /current\?\.roomId === roomId && !hasClaimedRoom/);
  assert.match(createRoomBlock, /isTrainingPermissionError\(error\)/);
  assert.match(createRoomBlock, /candidatePermissionPhase = "room_bootstrap"/);
  assert.match(createRoomBlock, /candidatePermissionPhase = "invite_create"/);
  assert.match(createRoomBlock, /\["room_bootstrap", "invite_create"\]\.includes\(failedCandidatePermissionPhase\)/);
  const roomPermissionPhase = createRoomBlock.indexOf('candidatePermissionPhase = "room_bootstrap"');
  const roomBootstrapWrite = createRoomBlock.indexOf("await set(ref(database, `online/trainingRooms/");
  const roomPermissionReset = createRoomBlock.indexOf('candidatePermissionPhase = "";', roomPermissionPhase);
  const hostDisconnectArm = createRoomBlock.indexOf("await armFormingRoomDisconnects");
  assert.ok(roomPermissionPhase < roomBootstrapWrite);
  assert.ok(roomBootstrapWrite < roomPermissionReset);
  assert.ok(roomPermissionReset < hostDisconnectArm);
  const hostQueueWrite = createRoomBlock.indexOf("await updateOwnedTrainingQueue");
  const invitePermissionPhase = createRoomBlock.indexOf('candidatePermissionPhase = "invite_create"');
  const inviteWrite = createRoomBlock.indexOf("await set(ref(database, `online/trainingInvites/");
  const invitePermissionReset = createRoomBlock.indexOf(
    'candidatePermissionPhase = "";',
    invitePermissionPhase,
  );
  assert.ok(hostQueueWrite < invitePermissionPhase);
  assert.ok(invitePermissionPhase < inviteWrite);
  assert.ok(inviteWrite < invitePermissionReset);
  assert.match(createRoomBlock, /refreshCurrentTrainingInviteStatus\(\)/);
  assert.match(createRoomBlock, /markTrainingCandidateUnavailable\(guestEntry\)/);
  assert.match(createRoomBlock, /candidatePermissionFailure && currentInviteStatus === true/);
  assert.match(expireBlock, /accepted\/\$\{guestUid\}/);
  assert.match(expireBlock, /\.catch\(\(\) => null\)/);
  assert.match(expireBlock, /acceptedSnapshot && acceptedSnapshot\.val\(\) !== true/);
  assert.match(expireBlock, /markTrainingCandidateUnavailable/);
  assert.match(staleInviteBlock, /invite\?\.targetSessionId !== currentSessionId/);
  assert.match(staleInviteBlock, /removeStaleTrainingInvite/);
  assert.match(staleInviteRemoveBlock, /remaining\?\.targetSessionId === currentSessionId/);
  assert.doesNotMatch(selectionBlock, /trainingActive|trainingInvites/);
  assert.doesNotMatch(refreshBlock, /trainingActive|trainingInvites/);
});

test("session V2 retries use server-owned queue identity and keep disconnect presence fresh", () => {
  const restartBlock = functionBlock("restartTrainingSessionSearch");
  const enqueueBlock = functionBlock("enqueueTrainingSessionQueue");
  const preparationBlock = functionBlock("trainingSessionPreparationPayload");
  const tryMatchBlock = functionBlock("tryTrainingSessionMatch");
  const prepareRoomBlock = functionBlock("prepareTrainingSessionRoom");
  const watchRoomBlock = functionBlock("watchTrainingSessionRoom");
  const listenersBlock = functionBlock("setupRoomListeners");
  const enterRoomBlock = functionBlock("enterRoom");
  const roomContextBlock = functionBlock("trainingRoomRuntimeContextIsCurrent");
  const channelBlock = functionBlock("configureDataChannel");
  const channelContextBlock = functionBlock("trainingDataChannelContextIsCurrent");
  const heartbeatBlock = functionBlock("refreshTrainingSessionLease");
  const cleanupBlock = functionBlock("cleanupMatchmaking");
  const sessionCleanupBlock = functionBlock("cleanupTrainingSessionMatchmaking");
  const p2pCleanupBlock = functionBlock("cleanupFailedTrainingSessionRoom");

  assert.match(restartBlock, /expectedState\.sessionRestartPromise/);
  assert.match(restartBlock, /state === expectedState/);
  assert.match(restartBlock, /enqueueTrainingSessionQueue/);
  assert.doesNotMatch(restartBlock, /trainingQueueV4|get\(ref\(database/);
  assert.match(enqueueBlock, /trainingSessionPreparationPayload\(expectedState\)/);
  assert.match(
    enqueueBlock,
    /expectedState\.matchmakingGeneration = String\(result\.connectionGeneration\)/,
  );
  assert.match(enqueueBlock, /result\.reason === "active"[\s\S]*return true/);
  assert.match(preparationBlock, /action: "enqueue"/);
  assert.match(
    preparationBlock,
    /commandDeck: commandDeckPayload\(targetState\.commandDeck\)/,
  );
  assert.match(
    preparationBlock,
    /imageBpms: imageBpmsPayload\(targetState\.localImages\)/,
  );
  assert.doesNotMatch(preparationBlock, /conditions/);
  assert.match(watchRoomBlock, /status === "" && lastKnownStatus === "offered"/);
  assert.match(tryMatchBlock, /\["offered", "join"\]\.includes\(payload\.outcome\)/);
  assert.match(tryMatchBlock, /const expectedState = state/);
  assert.match(tryMatchBlock, /expectedState\.sessionTryMatchBusy = false/);
  assert.match(
    functionBlock("acceptTrainingSessionOffer"),
    /expectedState\.sessionOfferHandling = false/,
  );
  assert.match(enterRoomBlock, /expectedState\.enteringRoom = false/);
  assert.doesNotMatch(
    tryMatchBlock,
    /state\.matchmakingGeneration = connectionGeneration/,
  );
  assert.match(
    prepareRoomBlock,
    /state\.matchmakingGeneration = String\(room\.connectionGeneration\)/,
  );
  assert.match(
    prepareRoomBlock,
    /state\.matchmakingGeneration !== expectedMatchmakingGeneration/,
  );
  assert.match(enterRoomBlock, /const roomSetupContext = createTrainingRoomRuntimeContext\(roomId\)/);
  assert.match(
    enterRoomBlock,
    /!roomReady \|\| !trainingRoomRuntimeContextIsCurrent\(roomSetupContext\)/,
  );
  assert.match(listenersBlock, /const abandonPresence = async/);
  assert.match(listenersBlock, /presenceDisconnect\?\.cancel\?\.\(\)/);
  assert.match(listenersBlock, /set\(ownPresenceRef, ownPresence\(false\)\)/);
  assert.match(
    listenersBlock,
    /createTrainingSessionPresencePayload\(\{[\s\S]*updatedAt: firebaseNow\(\)/,
  );
  assert.match(listenersBlock, /ownPresence\(false, true\)/);
  assert.match(
    listenersBlock,
    /useServerTimestamp \? serverTimestamp\(\) : firebaseNow\(\)/,
  );
  assert.match(listenersBlock, /if \(!contextIsCurrent\(\)\) return/);
  assert.match(listenersBlock, /awaitCurrent\(readTrainingRoundsBounded\(roomId\)\)/);
  assert.match(roomContextBlock, /state !== context\.expectedState/);
  assert.match(roomContextBlock, /state\.signalingAttemptId === context\.attemptId/);
  assert.match(
    roomContextBlock,
    /state\.roomConnectionGeneration === context\.connectionGeneration/,
  );
  assert.match(channelContextBlock, /state\.channel === channel/);
  assert.match(channelBlock, /if \(!contextIsCurrent\(\)\) return/);
  assert.match(channelBlock, /handleChannelMessage\(payload, contextIsCurrent\)/);
  assert.match(heartbeatBlock, /state !== expectedState/);
  assert.match(heartbeatBlock, /expectedState\.sessionGeneration/);
  assert.match(cleanupBlock, /if \(state\.sessionLease\)/);
  assert.match(p2pCleanupBlock, /preserveResolvedTrainingMatchBeforeP2pCleanup/);
  assert.match(p2pCleanupBlock, /\["finalized", "resolved"\]/);
  assert.match(
    sessionCleanupBlock,
    /\["finalized", "resolved", "terminal", "not-owner"\]/,
  );
});

test("session V2 confirms the exact same-session owner is gone before takeover", () => {
  const channelBlock = trainingJs.match(
    /trainingTabChannel\?\.addEventListener\("message",[\s\S]*?\n\}\);/,
  )?.[0] || "";
  const confirmBlock = functionBlock("confirmSameTrainingSessionOwnerGone");
  const claimBlock = functionBlock("claimTrainingSessionLease");

  assert.match(trainingJs, /new BroadcastChannel\("hariai-stadium-training-tab-v1"\)/);
  assert.match(channelBlock, /message\.sessionOwnerProbeVersion === TRAINING_SESSION_OWNER_PROBE_VERSION/);
  assert.match(channelBlock, /message\.sessionId === state\.clientSessionId/);
  assert.match(channelBlock, /message\.leaseToken !== state\.clientLeaseToken/);
  assert.match(channelBlock, /state\.sessionLeaseHeld/);
  assert.match(confirmBlock, /if \(!trainingTabChannel\) return false/);
  assert.match(confirmBlock, /message\.sessionId === expectedState\.clientSessionId/);
  assert.match(confirmBlock, /message\.leaseToken !== expectedState\.clientLeaseToken/);
  assert.match(confirmBlock, /else responseWasUnverifiable = true/);
  assert.match(confirmBlock, /return !ownerResponded && !responseWasUnverifiable/);

  const thrownConflict = claimBlock.indexOf('"same-session-owned-by-another-page"');
  const thrownProbe = claimBlock.indexOf(
    "confirmSameTrainingSessionOwnerGone(expectedState)",
    thrownConflict,
  );
  const thrownTakeover = claimBlock.indexOf(
    "requestWithLegacyDrain(true)",
    thrownProbe,
  );
  assert.ok(thrownConflict >= 0 && thrownConflict < thrownProbe);
  assert.ok(thrownProbe < thrownTakeover);

  const returnedConflict = claimBlock.indexOf('"same-session-owned"', thrownTakeover);
  const returnedProbe = claimBlock.indexOf(
    "confirmSameTrainingSessionOwnerGone(expectedState)",
    returnedConflict,
  );
  const returnedTakeover = claimBlock.indexOf(
    "requestWithLegacyDrain(true)",
    returnedProbe,
  );
  assert.ok(returnedConflict >= 0 && returnedConflict < returnedProbe);
  assert.ok(returnedProbe < returnedTakeover);
});

test("session V2 releases stale claims without deleting a newer adopted attempt", () => {
  const claimBlock = functionBlock("claimTrainingSessionLease");

  assert.match(claimBlock, /const abandonStaleResponse = async \(candidateResponse\)/);
  assert.match(claimBlock, /if \(contextIsCurrent\(\)\) return false/);
  assert.match(claimBlock, /candidateResponse\?\.data\?\.sessionGeneration/);
  assert.match(claimBlock, /const newerAttemptMayAdopt = active/);
  assert.match(claimBlock, /state\.clientSessionId === sessionId/);
  assert.match(claimBlock, /state\.clientLeaseToken === leaseToken/);
  assert.match(
    claimBlock,
    /candidateResponse\?\.data\?\.claimed === true && !newerAttemptMayAdopt/,
  );
  assert.match(claimBlock, /await releaseTrainingSessionClaimExact/);
  assert.ok((claimBlock.match(/await abandonStaleResponse\(response\)/g) || []).length >= 2);
});

test("session V2 asks the server before declaring lease loss when clock offset is unknown", () => {
  const createStateBlock = functionBlock("createState");
  const scheduleBlock = functionBlock("scheduleTrainingSessionHeartbeat");
  const refreshBlock = functionBlock("refreshTrainingSessionLease");
  const beginBlock = functionBlock("beginMatchmaking");
  const watchBlock = functionBlock("watchTrainingSessionOffers");
  const roomListenersBlock = functionBlock("setupRoomListeners");
  const offsetBlock = functionBlock("applyTrainingServerTimeOffset");

  assert.match(createStateBlock, /serverTimeOffsetKnown: false/);
  assert.match(offsetBlock, /typeof offset !== "number" \|\| !Number\.isFinite\(offset\)/);
  assert.match(offsetBlock, /targetState\.serverTimeOffsetKnown = true/);
  const applyOffset = Function(
    `"use strict"; ${offsetBlock}; return applyTrainingServerTimeOffset;`,
  )();
  const unknownClock = { serverTimeOffset: 0, serverTimeOffsetKnown: false };
  assert.equal(applyOffset(unknownClock, { val: () => null }), false);
  assert.deepEqual(unknownClock, {
    serverTimeOffset: 0,
    serverTimeOffsetKnown: false,
  });
  assert.equal(applyOffset(unknownClock, { val: () => Number.POSITIVE_INFINITY }), false);
  assert.equal(applyOffset(unknownClock, { val: () => -4321 }), true);
  assert.deepEqual(unknownClock, {
    serverTimeOffset: -4321,
    serverTimeOffsetKnown: true,
  });
  assert.match(scheduleBlock, /const serverTimeKnown = expectedState\.serverTimeOffsetKnown === true/);
  assert.match(scheduleBlock, /if \(serverTimeKnown && remainingMs <= 0\)/);
  assert.match(scheduleBlock, /const boundedDelay = serverTimeKnown/);
  assert.match(refreshBlock, /const currentExpiresAt = Number\(expectedState\.sessionLease\?\.expiresAt/);
  assert.match(
    refreshBlock,
    /expectedState\.serverTimeOffsetKnown === true[\s\S]*Math\.min\(observedNow, Math\.max\(0, currentExpiresAt - 1\)\)/,
  );
  assert.match(
    refreshBlock,
    /expectedState\.serverTimeOffsetKnown === true[\s\S]*decision\.retryDelayMs[\s\S]*ONLINE_SESSION_LEASE_DEFAULTS\.retryIntervalMs/,
  );
  assert.match(beginBlock, /applyTrainingServerTimeOffset\(expectedState, offset\)/);
  assert.match(watchBlock, /ref\(database, "\.info\/serverTimeOffset"\)/);
  assert.match(watchBlock, /applyTrainingServerTimeOffset\(expectedState, snapshot\)/);
  assert.match(roomListenersBlock, /applyTrainingServerTimeOffset\(state, snapshot\)/);
});

test("session V2 restarts an established transport and replaces a closed image channel", () => {
  const peerBlock = functionBlock("setupTrainingSessionPeerConnection");
  const restartStart = peerBlock.indexOf("state.p2pRestartIce = async");
  const restartEnd = peerBlock.indexOf("scheduleTrainingP2pRecoveryTimer", restartStart);
  const restartBlock = peerBlock.slice(restartStart, restartEnd);

  assert.ok(restartStart >= 0);
  assert.doesNotMatch(restartBlock, /recovery\.channelWasOpened/);
  assert.match(
    restartBlock,
    /\["closing", "closed"\]\.includes\(state\.channel\.readyState\)/,
  );
  assert.match(
    restartBlock,
    /peer\.createDataChannel\([\s\S]*IMAGE_CHANNEL_LABEL[\s\S]*configureDataChannel\(replacementChannel, channelContext\)/,
  );
  assert.ok(
    restartBlock.indexOf("configureDataChannel(replacementChannel, channelContext)")
      < restartBlock.indexOf("peer.restartIce?.()"),
  );
  assert.match(restartBlock, /peer\.createOffer\(\{ iceRestart: true \}\)/);
  assert.match(trainingJs, /function rearmTrainingImageTransferForReplacement/);
  assert.match(trainingJs, /trainingImageRoundsNeedingResend/);
  assert.match(trainingJs, /targetState\.incomingImage = null/);
  assert.match(trainingJs, /targetState\.incomingMessageChain = Promise\.resolve\(\)/);
  assert.match(
    trainingJs,
    /if \(replacement\) \{\s*startImageExchangeWatchdog\(currentRoundIndex\(\)\)/,
  );
  assert.match(trainingJs, /function trainingImageTransferRecoveryPending/);
  assert.match(trainingJs, /handleTrainingImageTransferFailure/);
  assert.match(trainingJs, /outgoingImageChannel/);
});

test("provides six local-only V3 preview screens without Firebase writes", () => {
  assert.match(trainingJs, /\["setup", "draw", "score", "command", "workout", "result"\]/);
  assert.match(trainingJs, /preview === "draw"/);
  assert.match(trainingJs, /preview === "command"/);
  assert.match(trainingJs, /preview === "workout"/);
  assert.match(trainingJs, /preview === "result"/);
  for (const name of [
    "ensureLocalRoundDraw",
    "submitScore",
    "submitCommandChoice",
    "startWorkout",
    "completeWorkout",
    "handleGiveUp",
    "ensureRoundProgress",
  ]) {
    assert.match(functionBlock(name), /if \(state\.preview/);
  }
});

test("publishes the complete HariaiTraining lifecycle API", () => {
  assert.match(trainingJs, /window\.HariaiTraining\s*=\s*\{\s*start,\s*isActive,\s*requestHome,\s*destroyRoom,\s*\}/s);
  assert.match(trainingJs, /hariai-training-ready/);
});
