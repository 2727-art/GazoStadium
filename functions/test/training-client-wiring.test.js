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
  assert.match(indexHtml, /src="training\.js\?v=kitaeai-hp-v3[^"]*"/);
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
  assert.ok(drawBlock.indexOf("/draws/${state.uid}`)") < drawBlock.indexOf("sendLocalRoundImage(roundIndex, draw)"));
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
    < receiveBlock.indexOf("/imageReceived/${state.uid}`)"));
  assert.doesNotMatch(trainingJs, /(?:set|update|runTransaction)\([^)]*Firebase[^)]*(?:blob|imageUrl|imageData)/i);
});

test("keeps score secret until the local score is committed", () => {
  const listenerBlock = functionBlock("setupRoomListeners");
  const pollBlock = functionBlock("pollOpponentScore");
  const boundedScoreBlock = functionBlock("readRoundScoresBounded");
  const submitBlock = functionBlock("submitScore");
  assert.match(listenerBlock, /scores\/\$\{state\.uid\}/);
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
  assert.match(setupBlock, /mergeTrainingRounds\(refreshedRounds\)/);
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
  assert.match(trainingJs, /state\.publicPresenceState = "waiting"/);
  assert.match(trainingJs, /updatePublicPresence\("playing"\)/);
  assert.match(trainingJs, /lastSeen: firebaseNow\(\)/);
  assert.doesNotMatch(trainingJs, /onValue\(\s*ref\(database,\s*"online\/trainingActive"\)/);
});

test("arms an active-room terminal fallback until terminal evidence is confirmed", () => {
  const enterBlock = functionBlock("enterRoom");
  const deactivateBlock = functionBlock("deactivate");
  assert.match(trainingJs, /async function armActiveRoomDestroyedDisconnect/);
  assert.match(trainingJs, /reason: "active_member_disconnected"/);
  assert.ok(enterBlock.indexOf("armActiveRoomDestroyedDisconnect(roomId)")
    < enterBlock.indexOf("cleanupMatchmaking(true)"));
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
  assert.match(trainingJs, /removeTrainingInviteForSession\(state\.uid, roomId, acceptedSessionId\)/);
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
  assert.match(trainingJs, /IMAGE_EXCHANGE_TIMEOUT_MS = 45_000/);
  assert.match(trainingJs, /startImageExchangeWatchdog/);
  assert.match(trainingJs, /"image_exchange_timeout"/);
  assert.match(trainingJs, /"image_channel_error"/);
  assert.match(trainingJs, /"image_receive_failed"/);
  assert.match(trainingJs, /transitionToLocalNoContestPending/);
  assert.match(trainingJs, /45秒以内に画像交換を完了できなかったため、NO CONTEST/);
  assert.match(trainingJs, /!allRoundImagesReceived\(view\.round\)/);
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
