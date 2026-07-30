"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const trainingJs = fs.readFileSync(
  path.join(projectRoot, "training.js"),
  "utf8",
);
const trainingCss = fs.readFileSync(
  path.join(projectRoot, "training.css"),
  "utf8",
);

function functionBlock(name) {
  const startPattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = startPattern.exec(trainingJs);
  assert.ok(match, `missing ${name}()`);
  const start = match.index;
  const remainder = trainingJs.slice(start + match[0].length);
  const next = remainder.search(/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/);
  return next < 0
    ? trainingJs.slice(start)
    : trainingJs.slice(start, start + match[0].length + next);
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = trainingCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
}

test("workout communication is bidirectional, bounded, and shared by both roles", () => {
  assert.match(
    trainingJs,
    /const TRAINING_WORKOUT_MESSAGE_HISTORY_LIMIT = 20;/,
  );
  assert.match(
    trainingJs,
    /const TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS = 800;/,
  );
  for (const stateKey of [
    "workoutMessages",
    "workoutMessageIds",
    "workoutMessageAcks",
  ]) {
    assert.match(trainingJs, new RegExp(`${stateKey}:`), stateKey);
  }

  const renderer = functionBlock("renderWorkoutCommunication");
  const roundMessages = functionBlock("workoutMessagesForRound");
  assert.match(renderer, /renderWorkoutMessageHistory\(/);
  assert.match(renderer, /aria-live="polite"/);
  assert.match(roundMessages, /state\.workoutMessages/);

  const traineeHud = functionBlock("renderTrainingHud");
  const waitingHud = functionBlock("renderWaitingInstruction");
  const coachHud = functionBlock("renderCoachRecovery");
  assert.match(traineeHud, /renderWorkoutCommunication\(/);
  assert.match(waitingHud, /renderCoachRecovery\(/);
  assert.match(coachHud, /renderWorkoutCommunication\(/);
});

test("free text has no per-DRAW quota while accidental floods stay throttled", () => {
  assert.doesNotMatch(trainingJs, /freeCheerSentRound/);
  assert.doesNotMatch(trainingJs, /各DRAW\s*1回|このDRAWは送信済み/);

  const sender = functionBlock("sendWorkoutMessage");
  const normalizer = functionBlock("normalizeWorkoutMessageText");
  assert.match(sender, /TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS/);
  assert.match(sender, /readyState\s*!==\s*"open"/);
  assert.match(sender, /normalizeWorkoutMessageText\(/);
  assert.match(normalizer, /\.slice\(0,\s*40\)/);
  assert.doesNotMatch(sender, /round\s*===|SentRound|sentRound/);
});

test("new workout messages use IDs, local echo, ACKs, dedupe, and a 20-item tail", () => {
  const sender = functionBlock("sendWorkoutMessage");
  const receiver = functionBlock("receiveWorkoutMessage");
  const addMessage = functionBlock("addWorkoutMessage");
  const ackSender = functionBlock("sendWorkoutMessageAck");
  const ackReceiver = functionBlock("receiveWorkoutMessageAck");
  const retry = functionBlock("scheduleWorkoutMessageRetry");

  assert.match(sender, /type:\s*"training-workout-message"/);
  assert.match(sender, /messageId/);
  assert.match(sender, /fromUid:\s*state\.uid/);
  assert.match(sender, /round:/);
  assert.match(sender, /workoutUid/);
  assert.match(sender, /addWorkoutMessage\(/);

  assert.match(receiver, /messageId/);
  assert.match(receiver, /addWorkoutMessage\(/);
  assert.match(receiver, /sendWorkoutMessageAck\(/);
  assert.match(addMessage, /workoutMessageIds\.has\(/);
  assert.match(addMessage, /TRAINING_WORKOUT_MESSAGE_HISTORY_LIMIT/);
  assert.match(addMessage, /new Set\(nextMessages\.map/);

  assert.match(ackSender, /type:\s*"training-workout-message-ack"/);
  assert.match(ackSender, /messageId/);
  assert.match(ackReceiver, /workoutMessageAcks/);
  assert.match(ackReceiver, /messageId/);
  assert.match(
    trainingJs,
    /TRAINING_WORKOUT_MESSAGE_RETRY_DELAYS_MS = Object\.freeze\(\[900, 1_600\]\)/,
  );
  assert.match(sender, /scheduleWorkoutMessageRetry\(payload\)/);
  assert.match(retry, /workoutMessageAcks\[messageId\] === "displayed"/);
  assert.match(retry, /workoutMessageIds\.has\(messageId\)/);
  assert.match(retry, /workoutIsActive\(context\.round, payload\.workoutUid\)/);
  assert.match(ackReceiver, /workoutMessageRetryTimers\.delete\(messageId\)/);
});

test("round changes clear GIVE UP confirmation and pending message retries", () => {
  const roundBoundary = functionBlock("ensureWorkoutMessageRound");
  const deactivate = functionBlock("deactivate");
  assert.match(roundBoundary, /state\.giveUpArmed = false/);
  assert.match(roundBoundary, /clearWorkoutMessageRetryTimers\(\)/);
  assert.match(deactivate, /clearWorkoutMessageRetryTimers\(state\)/);
});

test("new clients retain the two legacy encouragement receive formats", () => {
  const channelHandler = functionBlock("handleChannelMessage");
  assert.match(channelHandler, /training-workout-message/);
  assert.match(channelHandler, /training-workout-message-ack/);
  assert.match(channelHandler, /training-cheer/);
  assert.match(channelHandler, /training-free-cheer/);
  assert.match(channelHandler, /receiveWorkoutMessage\(/);
});

test("workout messages remain room-ephemeral P2P data", () => {
  assert.doesNotMatch(
    trainingJs,
    /ref\(\s*database,\s*`online\/trainingRooms\/[^`]*(?:chat|cheer|message)/i,
  );
  assert.doesNotMatch(
    trainingJs,
    /ref\(\s*database,\s*["']online\/trainingRooms\/[^"']*(?:chat|cheer|message)/i,
  );
  assert.match(trainingJs, /state\.channel\.send\(JSON\.stringify\(/);
});

test("server-snapshotted chat frames decorate messages without trusting P2P IDs", () => {
  assert.match(
    trainingJs,
    /CHAT_FRAME_PRODUCTS,[\s\S]*chatCosmeticClassNames,[\s\S]*getEquippedChatCosmetics,[\s\S]*from "\.\/chat-cosmetics\.js\?v=[^"]+"/,
  );
  assert.match(trainingJs, /state\.room\.chatFrames/);

  const sender = functionBlock("sendWorkoutMessage");
  assert.doesNotMatch(sender, /chatFrameId\s*:/);
  const frameResolver = functionBlock("verifiedTrainingChatFrameId");
  const messageRenderer = functionBlock("renderWorkoutMessage");
  assert.match(frameResolver, /state\.room\.chatFrames/);
  assert.match(frameResolver, /chatCosmeticClassNames/);
  assert.match(messageRenderer, /verifiedTrainingChatFrameId\(/);
  assert.match(messageRenderer, /chatCosmeticClassNames/);
});

test("setup offers only standard or owned frames and snapshots the selected ID", () => {
  const loader = functionBlock("loadTrainingChatFrameLoadout");
  const owned = functionBlock("ownedTrainingChatFrames");
  const selector = functionBlock("renderTrainingChatFrameSelector");
  const saver = functionBlock("saveTrainingChatFrame");
  const payload = functionBlock("trainingSessionV5Preparation");
  const roomReader = functionBlock("readRoomSkeleton");

  assert.match(loader, /online\/economy\/\$\{targetState\.uid\}/);
  assert.match(loader, /getEquippedChatCosmetics\(/);
  assert.match(owned, /CHAT_FRAME_PRODUCTS\.filter/);
  assert.match(owned, /inventory\[product\.id\]\s*===\s*true/);
  assert.match(selector, /<option value=""[^>]*>標準<\/option>/);
  assert.match(selector, /ownedFrames\.map/);
  assert.doesNotMatch(selector, /CHAT_FRAME_PRODUCTS\.map/);

  assert.match(saver, /validOwnedTrainingChatFrameId\(/);
  assert.match(saver, /runTransaction\(/);
  assert.match(
    saver,
    /online\/economy\/\$\{targetState\.uid\}\/equipped\/chatFrame/,
  );
  assert.match(payload, /chatFrameId:/);
  assert.match(payload, /validOwnedTrainingChatFrameId\(/);
  assert.match(roomReader, /"chatFrames"/);
  assert.match(trainingJs, /chatFrames:\s*\{\}/);
});

test("the compact safety bar reserves its own HUD space and opens confirmation only on demand", () => {
  const safetyRenderer = functionBlock("renderTrainingSafetyBar");
  assert.match(trainingJs, /class="training-safety-bar/);
  assert.match(trainingJs, /class="training-give-up-confirm-backdrop/);
  assert.match(trainingJs, /class="training-give-up-confirm/);
  assert.doesNotMatch(trainingJs, /training-give-up-dock/);
  assert.match(safetyRenderer, /state\.giveUpArmed\s*\?/);

  assert.match(trainingCss, /--training-safety-bar-space\s*:/);
  const hud = cssRule(".training-hud");
  assert.match(
    hud,
    /padding-bottom:\s*calc\(var\(--training-safety-bar-space\)/,
  );
  const bar = cssRule(".training-safety-bar");
  assert.match(bar, /position:\s*fixed/);
  assert.match(bar, /bottom:/);
  assert.match(bar, /min-height:\s*var\(--training-safety-bar-space\)/);
  assert.doesNotMatch(trainingCss, /\.training-give-up-dock/);
});
