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
  assert.match(indexHtml, /href="training\.css\?v=kitaeai-workout-chat-v1"/);
  assert.match(
    indexHtml,
    /src="training\.js\?v=[^"]*workout-chat-v1[^"]*"/,
  );
  assert.match(
    trainingJs,
    /from "\.\/training-session-v5\.mjs\?v=training-session-v5-canonical-v1"/,
  );
  assert.match(
    trainingJs,
    /from "\.\/training-session-v5-machine\.mjs\?v=training-session-v5-canonical-v1"/,
  );
  assert.doesNotMatch(trainingJs, /training-session-v2|beginLegacyTrainingMatchmaking/);
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

test("sends COMMAND, BPM, and private conditions only through the V5 callable", () => {
  const preparationBlock = functionBlock("trainingSessionV5Preparation");
  const startBlock = functionBlock("startTrainingSessionV5");
  const publicPresenceBlock = functionBlock("writePublicPresence");
  assert.match(preparationBlock, /commandDeck: commandDeckPayload\(targetState\.commandDeck\)/);
  assert.match(preparationBlock, /imageBpms: imageBpmsPayload\(targetState\.localImages\)/);
  assert.match(preparationBlock, /conditions: targetState\.conditions/);
  assert.match(startBlock, /action: "start"/);
  assert.match(startBlock, /preparation: trainingSessionV5Preparation\(targetState\)/);
  assert.doesNotMatch(publicPresenceBlock, /conditions|commandDeck|imageBpms/);
  assert.doesNotMatch(trainingJs, /online\/trainingQueue|online\/trainingInvites/);
});

test("accepts only the server-snapshotted V5 room and member identities", () => {
  const prepareBlock = functionBlock("prepareTrainingSessionV5Room");
  assert.match(prepareBlock, /room\.sessionProtocolVersion === TRAINING_SESSION_V5_PROTOCOL_VERSION/);
  assert.match(prepareBlock, /room\.signalingVersion === TRAINING_SESSION_V5_SIGNALING_VERSION/);
  assert.match(prepareBlock, /room\.roomAttemptId === attempt\.roomAttemptId/);
  assert.match(prepareBlock, /room\.transportEpoch === attempt\.transportEpoch/);
  assert.match(prepareBlock, /ownSession\?\.runId === targetState\.trainingRunId/);
  assert.match(prepareBlock, /ownSession\?\.endpointId === targetState\.trainingEndpointId/);
  assert.match(prepareBlock, /ownSession\?\.ownerEpoch === targetState\.trainingOwnerEpoch/);
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
  const metadataBlock = functionBlock("ensureLocalRoundDrawMetadataOnce");
  assert.match(metadataBlock, /const used = new Set/);
  assert.match(metadataBlock, /\.filter\(\(imageIndex\) => !used\.has\(imageIndex\)\)/);
  assert.match(metadataBlock, /secureRandomChoice\(available\)/);
  assert.match(metadataBlock, /candidate = \{ imageIndex, bpm, drawnAt: firebaseNow\(\) \}/);
  assert.ok(drawBlock.indexOf("ensureLocalRoundDrawMetadata(")
    < drawBlock.indexOf("sendLocalRoundImage(roundIndex, draw, contextIsCurrent)"));
});

test("sends only image bytes over P2P and verifies RTDB DRAW metadata before acknowledging", () => {
  const sendBlock = functionBlock("sendLocalRoundImageOnce");
  const sendGuardBlock = functionBlock("trainingRoundImageSendIsCurrent");
  const receiveBlock = functionBlock("finishIncomingImage");
  assert.match(sendBlock, /type: "training-image-start"/);
  assert.match(sendBlock, /transferId/);
  assert.match(sendBlock, /chunkCount/);
  assert.match(sendBlock, /encodeTrainingImageChunkFrame/);
  assert.match(sendBlock, /round: roundIndex/);
  assert.match(sendBlock, /imageIndex/);
  assert.match(sendBlock, /bpm: Number\(draw\.bpm\)/);
  assert.match(sendBlock, /trainingRoundImageSendIsCurrent/);
  assert.match(sendGuardBlock, /currentRoundIndex\(\) === roundIndex/);
  assert.match(sendGuardBlock, /round\.imageReceived\?\.\[opponentUid\] !== true/);
  assert.match(sendGuardBlock, /!targetState\.outgoingImageRounds\.has\(roundIndex\)/);
  assert.match(receiveBlock, /rounds\/\$\{roundIndex\}\/draws\/\$\{opponentUid\}/);
  assert.match(receiveBlock, /P2P画像とFirebaseのDRAW情報が一致しません/);
  assert.ok(receiveBlock.indexOf("P2P画像とFirebaseのDRAW情報が一致しません")
    < receiveBlock.indexOf("acknowledgeTrainingRoundImageReceipt("));
  assert.doesNotMatch(trainingJs, /(?:set|update|runTransaction)\([^)]*Firebase[^)]*(?:blob|imageUrl|imageData)/i);
});

test("single-flights DRAW preparation and one round on the same DataChannel", async () => {
  const runtime = new Function(`
    ${functionBlock("runTrainingRoundChannelFlight")}
    ${functionBlock("runLocalRoundDrawFlight")}
    return { runTrainingRoundChannelFlight, runLocalRoundDrawFlight };
  `)();
  const channel = {};
  const channelFlights = new Map();
  let releaseChannelFlight;
  const channelGate = new Promise((resolve) => {
    releaseChannelFlight = resolve;
  });
  let channelCalls = 0;
  const first = runtime.runTrainingRoundChannelFlight(
    channelFlights,
    channel,
    2,
    async () => {
      channelCalls += 1;
      await channelGate;
      return "sent";
    },
  );
  const duplicate = runtime.runTrainingRoundChannelFlight(
    channelFlights,
    channel,
    2,
    async () => {
      channelCalls += 1;
      return "duplicate";
    },
  );
  assert.strictEqual(duplicate, first);
  assert.equal(channelCalls, 0);
  await Promise.resolve();
  assert.equal(channelCalls, 1);
  releaseChannelFlight();
  assert.equal(await first, "sent");

  const targetState = { localRoundDrawFlights: new Map() };
  let releaseDrawFlight;
  const drawGate = new Promise((resolve) => {
    releaseDrawFlight = resolve;
  });
  let drawTransactions = 0;
  const draw = runtime.runLocalRoundDrawFlight(
    targetState,
    "room-123",
    2,
    async () => {
      drawTransactions += 1;
      await drawGate;
      return { imageIndex: 2 };
    },
  );
  const duplicateDraw = runtime.runLocalRoundDrawFlight(
    targetState,
    "room-123",
    2,
    async () => {
      drawTransactions += 1;
      return { imageIndex: 4 };
    },
  );
  assert.strictEqual(duplicateDraw, draw);
  await Promise.resolve();
  assert.equal(drawTransactions, 1);
  releaseDrawFlight();
  assert.deepEqual(await draw, { imageIndex: 2 });
});

test("serializes different image rounds across one DataChannel", async () => {
  const { runTrainingImageSendFlight } = new Function(`
    ${functionBlock("runTrainingImageSendFlight")}
    return { runTrainingImageSendFlight };
  `)();
  const targetState = { outgoingImageSendQueues: new Map() };
  const channel = {};
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = runTrainingImageSendFlight(
    targetState,
    channel,
    1,
    async () => {
      events.push("round-1-start");
      await firstGate;
      events.push("round-1-end");
    },
  );
  const duplicateFirst = runTrainingImageSendFlight(
    targetState,
    channel,
    1,
    async () => events.push("round-1-duplicate"),
  );
  const second = runTrainingImageSendFlight(
    targetState,
    channel,
    2,
    async () => {
      events.push("round-2-start");
      events.push("round-2-end");
    },
  );
  assert.strictEqual(duplicateFirst, first);
  await Promise.resolve();
  assert.deepEqual(events, ["round-1-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "round-1-start",
    "round-1-end",
    "round-2-start",
    "round-2-end",
  ]);
});

test("frames P2P chunks below the SCTP boundary and drains another transfer", () => {
  const messageBlock = functionBlock("handleChannelMessage");
  const appendBlock = functionBlock("appendTrainingImageChunkFrame");
  const finishBlock = functionBlock("finishIncomingImage");
  assert.match(messageBlock, /Number\(message\.chunkCount\) !== declaredChunkCount/);
  assert.match(appendBlock, /transfer\.size - \(frame\.sequence \* IMAGE_CHUNK_BYTES\)/);
  assert.match(appendBlock, /frame\.payload\.byteLength !== expectedBytes/);
  assert.match(finishBlock, /Number\(message\.chunkCount\) !== transfer\.chunkCount/);
  assert.match(finishBlock, /transfer\.nextChunkSequence !== transfer\.chunkCount/);
  const runtime = new Function(`
    const IMAGE_CHUNK_BYTES = 60 * 1024;
    const MAX_IMAGE_TRANSFER_BYTES = 8 * 1024 * 1024;
    const MAX_IMAGE_CHANNEL_FRAME_BYTES = 65_535;
    const TRAINING_IMAGE_CHUNK_MAGIC = Object.freeze([0x48, 0x54, 0x49, 0x31]);
    const TRAINING_IMAGE_TRANSFER_ID_MIN_LENGTH = 20;
    const TRAINING_IMAGE_TRANSFER_ID_MAX_LENGTH = 80;
    function appendIncomingOnlineImageChunk(transfer, payload) {
      transfer.chunks.push(payload);
      transfer.received += payload.byteLength;
    }
    ${functionBlock("validTrainingImageTransferId")}
    ${functionBlock("encodeTrainingImageChunkFrame")}
    ${functionBlock("decodeTrainingImageChunkFrame")}
    ${functionBlock("appendTrainingImageChunkFrame")}
    ${functionBlock("trainingImageEndDisposition")}
    return {
      encodeTrainingImageChunkFrame,
      decodeTrainingImageChunkFrame,
      appendTrainingImageChunkFrame,
      trainingImageEndDisposition,
    };
  `)();
  const transferA = "a".repeat(80);
  const transferB = "b".repeat(80);
  const maximumPayload = new Uint8Array(60 * 1024);
  const encodedMaximum = runtime.encodeTrainingImageChunkFrame(
    transferA,
    0,
    maximumPayload,
  );
  assert.ok(encodedMaximum.byteLength <= 65_535);
  assert.equal(encodedMaximum.byteLength, (60 * 1024) + 89);
  const decodedMaximum = runtime.decodeTrainingImageChunkFrame(encodedMaximum);
  assert.equal(decodedMaximum.transferId, transferA);
  assert.equal(decodedMaximum.sequence, 0);
  assert.equal(decodedMaximum.payload.byteLength, maximumPayload.byteLength);

  const current = {
    transferId: transferA,
    size: 4,
    chunkCount: 1,
    nextChunkSequence: 0,
    chunks: [],
    received: 0,
  };
  const targetState = { incomingImage: current };
  const otherFrame = runtime.decodeTrainingImageChunkFrame(
    runtime.encodeTrainingImageChunkFrame(transferB, 0, new Uint8Array(4)),
  );
  assert.equal(
    runtime.appendTrainingImageChunkFrame(targetState, otherFrame),
    "drained",
  );
  assert.equal(current.received, 0);
  assert.equal(current.nextChunkSequence, 0);
  assert.equal(
    runtime.trainingImageEndDisposition(current, { transferId: transferB }),
    "drained",
  );

  const ownFrame = runtime.decodeTrainingImageChunkFrame(
    runtime.encodeTrainingImageChunkFrame(transferA, 0, new Uint8Array(4)),
  );
  assert.equal(
    runtime.appendTrainingImageChunkFrame(targetState, ownFrame),
    "accepted",
  );
  assert.equal(current.received, 4);
  assert.equal(current.nextChunkSequence, 1);
  assert.equal(
    runtime.appendTrainingImageChunkFrame(targetState, ownFrame),
    "duplicate",
  );
  assert.equal(current.received, 4);

  const wrongSizeState = {
    incomingImage: {
      transferId: transferA,
      size: 3,
      chunkCount: 1,
      nextChunkSequence: 0,
      chunks: [],
      received: 0,
    },
  };
  assert.throws(
    () => runtime.appendTrainingImageChunkFrame(wrongSizeState, ownFrame),
    /チャンクサイズが宣言値と一致しません/,
  );
  assert.equal(wrongSizeState.incomingImage, null);
  assert.throws(
    () => runtime.decodeTrainingImageChunkFrame(new ArrayBuffer(65_536)),
    /チャンク形式が不正です/,
  );
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
  assert.match(
    visibilityBlock,
    /inspectTrainingSessionV5\(targetState, \{ immediate: true \}\)/,
  );
  assert.match(visibilityBlock, /trainingAttemptHeartbeatBusy/);
  assert.match(visibilityBlock, /trainingAttemptInspectBusy/);
  assert.match(visibilityBlock, /syncTrainingWorkoutWakeLock\(targetState\)/);
  assert.match(trainingDesign, /同じ所有者が180秒を越えて復帰/);
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

test("keeps bidirectional workout communication ephemeral on the P2P channel", () => {
  assert.match(trainingJs, /type: "training-workout-message"/);
  assert.match(trainingJs, /type: "training-workout-message-ack"/);
  assert.match(
    trainingJs,
    /message\.type === "training-cheer"\s*\|\|\s*message\.type === "training-free-cheer"/,
  );
  assert.doesNotMatch(trainingJs, /freeCheerSentRound/);
  assert.match(trainingJs, /TRAINING_WORKOUT_MESSAGE_HISTORY_LIMIT = 20/);
  assert.match(trainingJs, /TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS = 800/);
  assert.doesNotMatch(trainingJs, /ref\(database,\s*`online\/trainingRooms\/[^`]*(?:cheer|message)/i);
  assert.match(trainingCss, /\.training-workout-free-message/);
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
  assert.match(
    trainingJs,
    /const childKeys = \["status", "chatFrames", "surrendered", "destroyed", "serverFinalized"\]/,
  );
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

test("treats disconnect as recoverable and destroys rooms only on explicit exit", () => {
  const listenersBlock = functionBlock("setupRoomListeners");
  const recoveryBlock = functionBlock("resetTrainingRoomForAutoRequeue");
  const deactivateBlock = functionBlock("deactivate");
  assert.match(listenersBlock, /createTrainingSessionV5PresencePayload/);
  assert.doesNotMatch(listenersBlock, /markRoomDestroyed/);
  assert.match(recoveryBlock, /requestTrainingSessionV5Reconnect\(targetState\)/);
  assert.match(deactivateBlock, /await markRoomDestroyed\("player_exit"\)/);
  assert.doesNotMatch(trainingJs, /active_member_disconnected/);
});

test("fences same-uid tabs and resumes a stored V5 run on the same endpoint", () => {
  const beginBlock = functionBlock("beginMatchmaking");
  assert.match(trainingJs, /new BroadcastChannel\("hariai-stadium-training-tab-v5"\)/);
  assert.match(trainingJs, /navigator\.locks\.request/);
  assert.match(trainingJs, /\{ mode: "exclusive", ifAvailable: true \}/);
  assert.match(trainingJs, /await claimTrainingTabOwnership\(\)/);
  assert.match(beginBlock, /const restoredRunId = resolveTrainingSessionV5RunId\(\)/);
  assert.match(
    beginBlock,
    /trainingRunId = restoredRunId\s*\|\|\s*createTrainingSessionV5Token\(\)/,
  );
  assert.match(beginBlock, /sessionStorage\.setItem/);
  assert.match(beginBlock, /action: "start"|startTrainingSessionV5/);
  assert.match(trainingJs, /releaseTrainingTabOwnership\(\)/);
});

test("fences V5 presence and signaling by run, endpoint, room attempt, and transport", () => {
  const contextBlock = functionBlock("trainingRoomRuntimeContextIsCurrent");
  const peerBlock = functionBlock("trainingSessionPeerContextIsCurrent");
  assert.match(contextBlock, /state\.trainingRunId === context\.runId/);
  assert.match(contextBlock, /state\.trainingEndpointId === context\.endpointId/);
  assert.match(contextBlock, /state\.roomAttemptId === context\.roomAttemptId/);
  assert.match(contextBlock, /state\.transportEpoch === context\.transportEpoch/);
  assert.match(peerBlock, /state\.opponentRunId === context\.opponentRunId/);
  assert.match(peerBlock, /state\.opponentEndpointId === context\.opponentEndpointId/);
  assert.match(trainingJs, /createTrainingSessionV5SignalEnvelope/);
  assert.match(trainingJs, /decideTrainingSessionV5Signal/);
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
  const drawBlock = functionBlock("ensureLocalRoundDrawMetadataOnce");
  const failureBlock = functionBlock("handleTrainingImageTransferFailure");
  const timeoutBlock = functionBlock("startImageExchangeWatchdog");
  assert.match(trainingJs, /IMAGE_EXCHANGE_TIMEOUT_MS = 45_000/);
  assert.match(trainingJs, /startImageExchangeWatchdog/);
  assert.match(trainingJs, /"image_exchange_timeout"/);
  assert.match(trainingJs, /"image_receive_failed"/);
  assert.match(timeoutBlock, /対戦ルームは終了していません/);
  assert.match(failureBlock, /enterTrainingSessionV5Recovery/);
  assert.match(failureBlock, /dispatchTrainingP2pRecoveryEvent\("ICE_FAILED"/);
  assert.doesNotMatch(failureBlock, /markRoomDestroyed|NO CONTEST/);
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

test("removes the legacy queue, invite, host, and Session V2 client paths", () => {
  assert.doesNotMatch(trainingJs, /training-session-v2|beginLegacyTrainingMatchmaking/);
  assert.doesNotMatch(trainingJs, /online\/trainingQueue|online\/trainingInvites/);
  assert.doesNotMatch(trainingJs, /online\/trainingMatchLock|online\/trainingActive/);
  assert.doesNotMatch(trainingJs, /claimTrainingSessionLease|tryTrainingSessionMatch/);
  assert.doesNotMatch(trainingJs, /acceptTrainingSessionOffer|playerFromQueue/);
  assert.doesNotMatch(trainingJs, /active_member_disconnected/);
});

test("uses one server-authoritative V5 attempt lifecycle", () => {
  const startBlock = functionBlock("startTrainingSessionV5");
  const heartbeatBlock = functionBlock("heartbeatTrainingSessionV5");
  const matchBlock = functionBlock("matchTrainingSessionV5");
  const inspectBlock = functionBlock("inspectTrainingSessionV5");
  const cleanupBlock = functionBlock("cleanupTrainingSessionMatchmaking");
  const watchBlock = functionBlock("watchTrainingSessionV5Attempt");
  assert.match(startBlock, /action: "start"/);
  assert.match(heartbeatBlock, /action: "heartbeat"/);
  assert.match(matchBlock, /action: "match"/);
  assert.match(inspectBlock, /action: "inspect"/);
  assert.match(cleanupBlock, /action: "cancel"/);
  assert.match(watchBlock, /trainingSessionV5AttemptPath\(targetState\.uid\)/);
  assert.match(trainingJs, /ownerEpoch/);
  assert.match(trainingJs, /roomAttemptId/);
  assert.match(trainingJs, /transportEpoch/);
  assert.doesNotMatch(trainingJs, /online\/trainingQueue|online\/trainingInvites/);
});

test("rejects stale or conflicting attempt revisions and clears returned reservations", () => {
  const applyBlock = functionBlock("applyTrainingSessionV5Attempt");
  const syncBlock = functionBlock("syncTrainingSessionV5Machine");
  assert.match(applyBlock, /Number\.isSafeInteger\(attempt\.revision\)/);
  assert.match(
    applyBlock,
    /attempt\.revision < targetState\.trainingAttemptRevision\) return false/,
  );
  assert.match(applyBlock, /trainingSessionV5AttemptRevisionMatches/);
  assert.match(applyBlock, /attempt-revision-conflict/);
  assert.match(applyBlock, /terminal-response-unfenced/);
  assert.match(
    applyBlock,
    /attempt\.outcome === "terminal"[\s\S]*?!trainingSessionV5TokenIsValid\(attempt\.ownerEpoch\)[\s\S]*?terminal-response-unfenced[\s\S]*?return false/,
  );
  assert.match(applyBlock, /active-state-regression/);
  assert.match(syncBlock, /\["reserved", "connecting"\]\.includes/);
  assert.match(syncBlock, /applyTrainingSessionV5Transition\(targetState, "WAIT"\)/);
  assert.doesNotMatch(syncBlock, /\["reserved", "connecting", "active"\]/);
  assert.match(applyBlock, /targetState\.roomAttemptId = ""/);
  assert.match(applyBlock, /targetState\.transportEpoch = ""/);
  assert.match(applyBlock, /targetState\.opponentRunId = ""/);
});

test("bumps the canonical transport epoch before replacing a failed peer", () => {
  const applyBlock = functionBlock("applyTrainingSessionV5Attempt");
  const requestBlock = functionBlock("requestTrainingSessionV5Reconnect");
  const refreshBlock = functionBlock("refreshTrainingSessionV5Transport");
  const resetBlock = functionBlock("resetTrainingRoomForAutoRequeue");
  assert.match(requestBlock, /action: "reconnect"/);
  assert.match(requestBlock, /roomAttemptId: requestFence\.roomAttemptId/);
  assert.match(requestBlock, /transportEpoch: requestFence\.transportEpoch/);
  assert.match(requestBlock, /inspectTrainingSessionV5\(targetState, \{ immediate: true \}\)/);
  assert.match(applyBlock, /targetState\.room\.roomAttemptId === attempt\.roomAttemptId/);
  assert.match(applyBlock, /targetState\.room\.transportEpoch === attempt\.transportEpoch/);
  assert.match(applyBlock, /previousTransportEpoch/);
  assert.match(refreshBlock, /trainingSessionV5ActiveRoomFenceIsCurrent/);
  assert.match(refreshBlock, /detachTrainingSessionV5RtdbTransport/);
  assert.match(refreshBlock, /trainingTransportRefreshIsLatest\(targetState, refreshTicket\)/);
  assert.match(refreshBlock, /previousPeer\?\.close\(\)/);
  assert.match(refreshBlock, /setupRoomListeners\(roomContext\)/);
  assert.match(refreshBlock, /setupPeerConnection\(\)/);
  assert.match(resetBlock, /requestTrainingSessionV5Reconnect\(targetState\)/);
  assert.doesNotMatch(resetBlock, /\.close\(\)|signalsV5|remove\(ref/);
});

test("converges room and attempt epochs locally before requesting another rotation", () => {
  const convergeBlock = functionBlock("readTrainingSessionV5ConvergedRoom");
  const prepareBlock = functionBlock("prepareTrainingSessionV5Room");
  const applyBlock = functionBlock("applyTrainingSessionV5Attempt");
  const readinessBlock = functionBlock("trainingSessionV5TransportIsReady");
  assert.match(trainingJs, /TRAINING_V5_ROOM_CONVERGENCE_DELAYS_MS = Object\.freeze/);
  assert.match(convergeBlock, /for \(const delayMs of TRAINING_V5_ROOM_CONVERGENCE_DELAYS_MS\)/);
  assert.match(convergeBlock, /room\.roomAttemptId === attempt\.roomAttemptId/);
  assert.match(convergeBlock, /room\.transportEpoch === attempt\.transportEpoch/);
  assert.match(prepareBlock, /readTrainingSessionV5ConvergedRoom/);
  assert.match(prepareBlock, /scheduleTrainingSessionV5Inspect\(targetState\)/);
  assert.doesNotMatch(prepareBlock, /scheduleTrainingSessionV5Reconnect/);
  assert.match(readinessBlock, /trainingTransportReadyEpoch === expected\.transportEpoch/);
  assert.match(readinessBlock, /trainingSignalUnsubscribe/);
  assert.match(readinessBlock, /disconnectHandles\.length > 0/);
  assert.match(applyBlock, /trainingSessionV5TransportIsReady/);
  assert.match(applyBlock, /refreshTrainingSessionV5Transport/);
  const enterBlock = functionBlock("enterRoom");
  assert.match(
    enterBlock,
    /trainingTransportReadyEpoch = expectedTransportEpoch/,
  );
});

test("marks the superseded epoch presence offline before rebuilding the latest transport", () => {
  const handleBlock = trainingJs.slice(
    trainingJs.indexOf("function createTrainingPresenceDisconnectHandle"),
    trainingJs.indexOf("async function releaseTrainingDisconnectHandles"),
  );
  const releaseBlock = functionBlock("releaseTrainingDisconnectHandles");
  const refreshBlock = functionBlock("refreshTrainingSessionV5Transport");
  const listenersBlock = functionBlock("setupRoomListeners");
  const deactivateBlock = handleBlock.slice(
    handleBlock.indexOf("async deactivate"),
  );
  assert.match(handleBlock, /disconnect\?\.cancel/);
  assert.match(handleBlock, /online: false/);
  assert.match(handleBlock, /updatedAt: firebaseNow\(\)/);
  assert.ok(
    deactivateBlock.indexOf("await set(presenceRef")
      < deactivateBlock.indexOf("await disconnect?.cancel?.()"),
  );
  assert.match(releaseBlock, /handle\?\.deactivate\?\.\(overrides\)/);
  assert.match(
    refreshBlock,
    /\{ transportEpoch: expected\.transportEpoch \}/,
  );
  assert.match(listenersBlock, /createTrainingPresenceDisconnectHandle/);
});

test("lets only the latest deferred transport rebuild commit its runtime", async () => {
  const runtime = new Function(`
    ${functionBlock("beginTrainingTransportRefresh")}
    ${functionBlock("trainingTransportRefreshIsLatest")}
    ${functionBlock("commitTrainingTransportRefresh")}
    ${functionBlock("invalidateTrainingTransportRefreshes")}
    ${functionBlock("runTrainingTransportRefreshSteps")}
    function trainingSessionV5ActiveRoomFenceIsCurrent() { return true; }
    ${functionBlock("trainingSessionV5TransportIsReady")}
    return {
      beginTrainingTransportRefresh,
      trainingTransportRefreshIsLatest,
      commitTrainingTransportRefresh,
      invalidateTrainingTransportRefreshes,
      runTrainingTransportRefreshSteps,
      trainingSessionV5TransportIsReady,
    };
  `)();
  const targetState = {
    trainingTransportRefreshSequence: 0,
    trainingTransportReadyEpoch: "E0",
    transportEpoch: "E0",
    peer: { epoch: "E0" },
    trainingSignalUnsubscribe: () => {},
    roomUnsubscribers: [{ epoch: "E0" }],
    disconnectHandles: [{ epoch: "E0" }],
  };
  const resources = {
    listeners: ["E0"],
    presence: ["E0"],
    signals: ["E0"],
    peers: ["E0"],
  };
  const committed = [];
  let previousRefresh = Promise.resolve(true);
  const deferred = () => {
    let resolve;
    const promise = new Promise((next) => {
      resolve = next;
    });
    return { promise, resolve };
  };
  const startRefresh = (
    epoch,
    roomGate = Promise.resolve(),
    roomStarted = null,
  ) => {
    targetState.transportEpoch = epoch;
    const ticket = runtime.beginTrainingTransportRefresh(
      targetState,
      epoch,
    );
    const isLatest = () => runtime.trainingTransportRefreshIsLatest(
      targetState,
      ticket,
    );
    const operation = Promise.resolve(previousRefresh).then(() => (
      runtime.runTrainingTransportRefreshSteps({
        isLatest,
        detach: async () => {
          resources.listeners = [];
          resources.presence = [];
          resources.signals = [];
        },
        resetPeer: async () => {
          resources.peers = [];
        },
        clearSignals: async () => {},
        setupRoom: async () => {
          roomStarted?.resolve();
          await roomGate;
          resources.listeners.push(epoch);
          resources.presence.push(epoch);
          resources.signals.push(epoch);
          return true;
        },
        setupPeer: async () => {
          resources.peers.push(epoch);
          return true;
        },
        commit: () => {
          if (!runtime.commitTrainingTransportRefresh(targetState, ticket)) {
            return false;
          }
          committed.push(epoch);
          targetState.peer = { epoch };
          targetState.trainingSignalUnsubscribe = () => {};
          targetState.roomUnsubscribers = [{ epoch }];
          targetState.disconnectHandles = [{ epoch }];
          return true;
        },
      })
    ));
    previousRefresh = operation;
    return operation;
  };

  const e1Gate = deferred();
  const e1Started = deferred();
  const e1 = startRefresh("E1", e1Gate.promise, e1Started);
  await e1Started.promise;
  const e2 = startRefresh("E2");
  e1Gate.resolve();
  assert.equal(await e1, false);
  assert.equal(await e2, true);
  assert.deepEqual(committed, ["E2"]);
  assert.deepEqual(resources, {
    listeners: ["E2"],
    presence: ["E2"],
    signals: ["E2"],
    peers: ["E2"],
  });
  assert.equal(targetState.trainingTransportReadyEpoch, "E2");

  const sameEpochSequence = targetState.trainingTransportRefreshSequence;
  const sameEpochReady = runtime.trainingSessionV5TransportIsReady(
    targetState,
    { transportEpoch: "E2" },
  );
  if (!sameEpochReady) await startRefresh("E2");
  assert.equal(targetState.trainingTransportRefreshSequence, sameEpochSequence);
  assert.deepEqual(committed, ["E2"]);

  const e3Gate = deferred();
  const e3 = startRefresh("E3", e3Gate.promise);
  runtime.invalidateTrainingTransportRefreshes(targetState);
  e3Gate.resolve();
  assert.equal(await e3, false);
  assert.equal(targetState.trainingTransportReadyEpoch, "");
  assert.deepEqual(committed, ["E2"]);
});

test("converges unknown responses by inspect and keeps owner replacement local-only", () => {
  const reconnectBlock = functionBlock("requestTrainingSessionV5Reconnect");
  const ownerBlock = functionBlock("handleTrainingSessionV5OwnerReplaced");
  const terminalBlock = functionBlock("finishTrainingSessionV5TerminalLocally");
  assert.match(reconnectBlock, /response = null/);
  assert.match(reconnectBlock, /inspectTrainingSessionV5/);
  assert.doesNotMatch(reconnectBlock, /action: "cancel"|markRoomDestroyed/);
  assert.match(ownerBlock, /stopTrainingSessionV5LocalTransport/);
  assert.match(ownerBlock, /cleanupPublicPresence/);
  assert.match(ownerBlock, /releaseTrainingTabOwnership/);
  assert.doesNotMatch(ownerBlock, /trainingSessionActionCallable|markRoomDestroyed/);
  assert.match(terminalBlock, /recoverTrainingResultAfterTerminal/);
  assert.doesNotMatch(terminalBlock, /refreshRoomBeforeDestroy|readRoomLifecycle/);
  assert.match(terminalBlock, /stopTrainingSessionV5LocalTransport/);
  assert.match(
    terminalBlock,
    /\["room-destroyed", "room_destroyed"\]\.includes\(attempt\.reason\)/,
  );
  assert.doesNotMatch(terminalBlock, /action: "cancel"|markRoomDestroyed/);
});

test("queues candidate signals that arrive before their V5 offer", () => {
  const peerBlock = functionBlock("setupTrainingSessionPeerConnection");
  assert.match(peerBlock, /const pendingIceByCycle = new Map\(\)/);
  assert.match(peerBlock, /queuePendingCandidate/);
  assert.match(peerBlock, /takePendingCandidates/);
  assert.doesNotMatch(peerBlock, /transportStartedAt - 1_000/);
  assert.match(trainingJs, /state\.pendingIce\.push\(\.\.\.takePendingCandidates\(receivedCycleId\)\)/);
  assert.match(trainingJs, /queuePendingCandidate\(/);
  assert.match(trainingJs, /if \(!decision\.accepted\)[\s\S]*remove\(snapshot\.ref\)/);
});

test("preserves BFCache transport and reuses a stored run only after setup is ready", () => {
  const createStateBlock = functionBlock("createState");
  const beginBlock = functionBlock("beginMatchmaking");
  const restoreBlock = functionBlock("restoreTrainingSessionV5ImageBpms");
  const pagehideBlock = trainingJs.match(/window\.addEventListener\("pagehide",[\s\S]*?\n\}\);/)?.[0] || "";
  const pageshowBlock = trainingJs.match(/window\.addEventListener\("pageshow",[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(createStateBlock, /trainingRunId: ""/);
  assert.match(beginBlock, /!setupIsReady\(\)/);
  assert.match(beginBlock, /const restoredRunId = resolveTrainingSessionV5RunId\(\)/);
  assert.match(beginBlock, /restoredRunId\s*\|\|\s*createTrainingSessionV5Token\(\)/);
  assert.match(beginBlock, /sessionStorage\.setItem/);
  assert.match(beginBlock, /trainingRunRestored = Boolean\(restoredRunId\)/);
  assert.match(restoreBlock, /room\.players\?\.\[targetState\.uid\]\?\.imageBpms/);
  assert.match(restoreBlock, /image\.bpm = bpms\[index\]/);
  assert.match(restoreBlock, /選び直した5枚で再開/);
  assert.match(pagehideBlock, /if \(event\.persisted\) return/);
  assert.match(pageshowBlock, /claimTrainingTabOwnership\(\)/);
  assert.match(
    pageshowBlock,
    /inspectTrainingSessionV5\(targetState, \{ immediate: true \}\)/,
  );
});

test("V5 restarts ICE in-place before escalating to a new transport epoch", () => {
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
  assert.match(trainingJs, /outgoingImageSendQueues/);
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

test("retries the RTDB receipt for a verified duplicate image without replacing bytes", () => {
  const messageBlock = functionBlock("handleChannelMessage");
  const duplicateAckBlock = functionBlock("acknowledgeExistingTrainingRoundImage");
  const receiptBlock = functionBlock("acknowledgeTrainingRoundImageReceipt");
  assert.match(messageBlock, /const existingImage = state\.remoteImages\[roundIndex\]/);
  assert.match(
    messageBlock,
    /await acknowledgeExistingTrainingRoundImage\(\s*message,\s*existingImage,\s*contextIsCurrent/,
  );
  assert.match(
    duplicateAckBlock,
    /targetState\.remoteImages\[roundIndex\] !== existingImage/,
  );
  assert.match(duplicateAckBlock, /draws\/\$\{opponentUid\}/);
  assert.match(
    duplicateAckBlock,
    /Number\(draw\?\.imageIndex\) !== Number\(existingImage\.imageIndex\)/,
  );
  assert.match(receiptBlock, /imageReceived\/\$\{ownUid\}/);
  assert.match(duplicateAckBlock, /acknowledgeTrainingRoundImageReceipt/);
  assert.match(receiptBlock, /await runTransaction\(/);
  assert.match(receiptBlock, /current == null \? true : undefined/);
  assert.match(receiptBlock, /result\.snapshot\.val\(\) !== true/);
  assert.doesNotMatch(receiptBlock, /await set\(/);
  assert.doesNotMatch(
    duplicateAckBlock,
    /targetState\.remoteImages\[roundIndex\]\s*=(?!=)/,
  );
});

test("fences cancellation before awaits and tears local transport down again after cancel", () => {
  const contextBlock = functionBlock("trainingSessionV5ContextIsCurrent");
  const requestFenceBlock = functionBlock("createTrainingSessionV5RequestFence");
  const requestCurrentBlock = functionBlock("trainingSessionV5RequestFenceIsCurrent");
  const beginCancelBlock = functionBlock("beginTrainingSessionV5Cancellation");
  const cleanupBlock = functionBlock("cleanupTrainingSessionMatchmaking");
  const resetBlock = functionBlock("resetTrainingSessionV5AfterCancellation");
  assert.match(contextBlock, /!targetState\.trainingSessionCancelling/);
  assert.match(requestFenceBlock, /generation: targetState\.generation/);
  assert.match(
    requestCurrentBlock,
    /targetState\.generation === requestFence\.generation/,
  );
  assert.match(beginCancelBlock, /targetState\.trainingSessionCancelling = true/);
  assert.match(
    beginCancelBlock,
    /targetState\.generation = \+\+trainingLifecycleGeneration/,
  );
  assert.ok(
    cleanupBlock.indexOf("beginTrainingSessionV5Cancellation(targetState)")
      < cleanupBlock.indexOf("await stopTrainingSessionV5LocalTransport(targetState)"),
  );
  assert.ok(
    (cleanupBlock.match(/stopTrainingSessionV5LocalTransport\(targetState\)/g) || [])
      .length >= 2,
  );
  assert.match(resetBlock, /targetState\.roomId = ""/);
  assert.match(resetBlock, /targetState\.pendingRoomId = ""/);
  assert.match(resetBlock, /targetState\.room = emptyRoom\(\)/);
  assert.match(resetBlock, /targetState\.startingMatchmaking = false/);
  assert.match(resetBlock, /targetState\.trainingRunId = ""/);
});

test("ignores stale authentication continuations after lifecycle replacement", () => {
  const startBlock = functionBlock("start");
  const authBlock = functionBlock("ensureAuthenticated");
  assert.match(startBlock, /const targetState = state/);
  assert.match(startBlock, /const generation = targetState\.generation/);
  assert.match(startBlock, /ensureAuthenticated\(targetState, generation\)/);
  assert.match(authBlock, /state === targetState/);
  assert.match(authBlock, /targetState\.generation === generation/);
  assert.match(authBlock, /!targetState\.trainingSessionCancelling/);
  assert.match(authBlock, /targetState\.uid = credential\.user\.uid/);
  assert.doesNotMatch(authBlock, /\bstate\.uid\s*=/);
});

test("ends V5 ownership monitoring after a preserved canonical result", () => {
  const applyBlock = functionBlock("applyTrainingSessionV5Attempt");
  const resultOwnershipBlock = functionBlock(
    "finishTrainingSessionV5ResultOwnership",
  );
  assert.match(
    applyBlock,
    /targetState\.outcome[\s\S]*finishTrainingSessionV5ResultOwnership/,
  );
  assert.match(resultOwnershipBlock, /"TERMINATE"/);
  assert.match(resultOwnershipBlock, /clearTrainingSessionV5Heartbeat/);
  assert.match(resultOwnershipBlock, /clearTrainingSessionV5MatchTimer/);
  assert.match(resultOwnershipBlock, /clearTrainingSessionV5InspectTimer/);
  assert.match(resultOwnershipBlock, /trainingAttemptUnsubscribe\?\.\(\)/);
  assert.match(resultOwnershipBlock, /releaseTrainingTabOwnership\(\)/);
  assert.match(
    resultOwnershipBlock,
    /sessionStorage\.removeItem\(TRAINING_V5_RUN_STORAGE_KEY\)/,
  );
  assert.doesNotMatch(
    resultOwnershipBlock,
    /stopTrainingSessionV5LocalTransport|peer\?\.close|channel\?\.close/,
  );
});

test("detaches protected RTDB listeners at result while preserving the finisher peer", () => {
  const transitionBlock = functionBlock("transitionToTrainingResult");
  const detachBlock = functionBlock("detachTrainingSessionV5RtdbTransport");
  const protectedReleaseBlock = functionBlock(
    "releaseTrainingProtectedRtdbTransport",
  );
  const terminalBlock = functionBlock("finishTrainingSessionV5TerminalLocally");
  const terminalRecoveryBlock = functionBlock(
    "recoverTrainingResultAfterTerminal",
  );
  const listenerErrorBlock = functionBlock("handleTrainingRtdbListenerError");
  const finalizeBlock = functionBlock("ensureFinalization");
  const deactivateBlock = functionBlock("deactivate");
  assert.ok(
    transitionBlock.indexOf("state.outcome = view")
      < transitionBlock.indexOf("releaseTrainingProtectedRtdbTransport"),
  );
  assert.ok(
    protectedReleaseBlock.indexOf("trainingProtectedRtdbReleased = true")
      < protectedReleaseBlock.indexOf("detachTrainingSessionV5RtdbTransport"),
  );
  assert.ok(
    terminalBlock.indexOf("releaseTrainingProtectedRtdbTransport")
      < terminalBlock.indexOf("recoverTrainingResultAfterTerminal"),
  );
  assert.match(detachBlock, /roomUnsubscribers\.splice\(0\)/);
  assert.match(detachBlock, /trainingSignalUnsubscribe\?\.\(\)/);
  assert.doesNotMatch(detachBlock, /peer\?\.close|channel\?\.close/);
  assert.match(
    terminalRecoveryBlock,
    /online\/trainingRooms\/\$\{roomId\}\/serverFinalized/,
  );
  assert.doesNotMatch(
    terminalRecoveryBlock,
    /readRoomLifecycle|readTrainingRoundsBounded|\/status/,
  );
  assert.match(listenerErrorBlock, /targetState\.outcome/);
  assert.match(listenerErrorBlock, /targetState\.trainingProtectedRtdbReleased/);
  assert.match(listenerErrorBlock, /trainingPermissionWasRevoked\(error\)/);
  assert.match(listenerErrorBlock, /room-permission-revoked/);
  assert.match(listenerErrorBlock, /invalidateTrainingTransportRefreshes\(targetState\)/);
  assert.match(
    listenerErrorBlock,
    /scheduleTrainingSessionV5Inspect\(targetState, true\)/,
  );
  assert.doesNotMatch(finalizeBlock, /await state\.trainingResultRtdbRelease/);
  assert.ok(
    deactivateBlock.indexOf("detachTrainingSessionV5RtdbTransport")
      < deactivateBlock.indexOf("cleanupMatchmakingReliably(false)"),
  );
});

test("silently inspects live protected-listener revocation and still reports operation errors", () => {
  const runtime = new Function("runtimeConsole", `
    let recoverableErrors = 0;
    let recoveryCalls = 0;
    let transportInvalidations = 0;
    let immediateInspections = 0;
    let sessionContextCurrent = true;
    const console = runtimeConsole;
    function handleRecoverableError() { recoverableErrors += 1; }
    function trainingSessionV5ContextIsCurrent() {
      return sessionContextCurrent;
    }
    function enterTrainingSessionV5Recovery(targetState, reason) {
      recoveryCalls += 1;
      targetState.sessionV5 = {
        ...targetState.sessionV5,
        phase: "recovering",
        recoveryReason: reason,
      };
    }
    function invalidateTrainingTransportRefreshes() {
      transportInvalidations += 1;
    }
    function scheduleTrainingSessionV5Inspect(targetState, immediate) {
      if (targetState && immediate) immediateInspections += 1;
    }
    ${functionBlock("trainingPermissionWasRevoked")}
    ${functionBlock("handleTrainingRtdbListenerError")}
    ${functionBlock("handleTrainingRtdbOperationError")}
    return {
      handleTrainingRtdbListenerError,
      handleTrainingRtdbOperationError,
      recoverableErrorCount: () => recoverableErrors,
      recoveryCallCount: () => recoveryCalls,
      transportInvalidationCount: () => transportInvalidations,
      immediateInspectionCount: () => immediateInspections,
      setSessionContextCurrent: (value) => {
        sessionContextCurrent = value;
      },
    };
  `)({ info() {} });
  const permissionError = {
    code: "database/permission-denied",
    message: "permission_denied",
  };
  const targetState = {
    outcome: null,
    trainingProtectedRtdbReleased: false,
    sessionV5: {
      phase: "active",
      recoveryReason: null,
    },
  };
  runtime.handleTrainingRtdbListenerError(
    permissionError,
    () => true,
    targetState,
  );
  assert.equal(runtime.recoverableErrorCount(), 0);
  assert.equal(runtime.recoveryCallCount(), 1);
  assert.equal(runtime.transportInvalidationCount(), 1);
  assert.equal(runtime.immediateInspectionCount(), 1);

  runtime.handleTrainingRtdbListenerError(
    permissionError,
    () => true,
    targetState,
  );
  assert.equal(runtime.recoveryCallCount(), 1);
  assert.equal(runtime.transportInvalidationCount(), 2);
  assert.equal(runtime.immediateInspectionCount(), 2);

  targetState.trainingProtectedRtdbReleased = true;
  runtime.handleTrainingRtdbListenerError(
    permissionError,
    () => true,
    targetState,
  );
  assert.equal(runtime.transportInvalidationCount(), 2);
  assert.equal(runtime.immediateInspectionCount(), 2);

  runtime.handleTrainingRtdbListenerError(
    new Error("different live error"),
    () => true,
    targetState,
  );
  assert.equal(runtime.recoverableErrorCount(), 1);

  runtime.handleTrainingRtdbOperationError(permissionError, () => true);
  assert.equal(runtime.recoverableErrorCount(), 2);

  runtime.setSessionContextCurrent(false);
  targetState.trainingProtectedRtdbReleased = false;
  runtime.handleTrainingRtdbListenerError(
    permissionError,
    () => true,
    targetState,
  );
  assert.equal(runtime.transportInvalidationCount(), 2);
});

test("routes protected subscription cancellation separately from signal operations", () => {
  const roomListenersBlock = functionBlock("setupRoomListeners");
  const peerBlock = trainingJs.slice(
    trainingJs.indexOf("async function setupTrainingSessionPeerConnection"),
    trainingJs.indexOf("function trainingDataChannelContextIsCurrent"),
  );
  assert.match(
    roomListenersBlock,
    /handleTrainingRtdbListenerError\(error, contextIsCurrent, state\)/,
  );
  assert.match(
    peerBlock,
    /sendRoomSignal\("candidate"[\s\S]*?\.catch\(\(error\) => handleTrainingRtdbOperationError/,
  );
  assert.match(
    peerBlock,
    /catch \(error\) \{\s*handleTrainingRtdbOperationError\(error, contextIsCurrent\)/,
  );
  assert.match(
    peerBlock,
    /\(error\) => handleTrainingRtdbListenerError\(\s*error,\s*contextIsCurrent,\s*state/,
  );
});

test("fails closed without Web Locks and repairs a dead BFCache transport", () => {
  const claimBlock = functionBlock("claimTrainingTabOwnership");
  const reconnectCheckBlock = functionBlock(
    "trainingSessionV5TransportNeedsReconnect",
  );
  const unsupportedLocksBlock = claimBlock.slice(
    claimBlock.indexOf("if (!navigator.locks?.request)"),
    claimBlock.indexOf("let resolveAcquired"),
  );
  const pageshowBlock = trainingJs.match(
    /window\.addEventListener\("pageshow",[\s\S]*?\n\}\);/,
  )?.[0] || "";
  assert.match(claimBlock, /if \(!navigator\.locks\?\.request\)/);
  assert.match(claimBlock, /Web Locks対応ブラウザ/);
  assert.doesNotMatch(unsupportedLocksBlock, /trainingSharedStateOwned = true/);
  assert.match(reconnectCheckBlock, /\["failed", "closed"\]/);
  assert.match(reconnectCheckBlock, /\["closing", "closed"\]/);
  assert.match(reconnectCheckBlock, /targetState\.channelWasOpened/);
  assert.match(pageshowBlock, /await inspectTrainingSessionV5/);
  assert.match(pageshowBlock, /trainingSessionV5TransportNeedsReconnect/);
  assert.match(pageshowBlock, /await requestTrainingSessionV5Reconnect/);
  assert.ok(
    pageshowBlock.indexOf("await inspectTrainingSessionV5")
      < pageshowBlock.indexOf("await requestTrainingSessionV5Reconnect"),
  );
});
