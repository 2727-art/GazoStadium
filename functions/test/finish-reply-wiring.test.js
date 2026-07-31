const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const online = read("online.js");
const styles = read("styles.css");
const index = read("index.html");
const rules = read("database.rules.json");
const soloSessionV2 = read("functions/solo-session-v2.js");

function extract(pattern, label) {
  const match = online.match(pattern);
  assert.ok(match, `${label} could not be extracted`);
  return match[0];
}

function sliceBetween(startMarker, endMarker, label) {
  const start = online.indexOf(startMarker);
  const end = online.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${label} could not be sliced`);
  return online.slice(start, end);
}

const FINISH_REPLY_ID_A = "a".repeat(32);
const FINISH_REPLY_ID_B = "b".repeat(32);

function createFinishReplyResult({
  round = 1,
  winnerIndex = 0,
  loserIndex = 1,
} = {}) {
  return {
    round,
    lethal: true,
    winnerIndex,
    loserIndex,
    finish: {
      round,
      loserName: loserIndex === 0 ? "LOCAL" : "REMOTE",
      replyAcknowledged: false,
      replyLine: "",
    },
  };
}

function createFinishReplyHarness({
  playerIndex = 1,
  withResult = true,
  channelReadyState = "open",
  channelSendThrows = false,
  replyId = FINISH_REPLY_ID_A,
} = {}) {
  const sent = [];
  const timers = new Map();
  let nextTimerId = 1;
  let toast = "";
  let syncCalls = 0;
  const channel = {
    readyState: channelReadyState,
    send(value) {
      if (channelSendThrows) throw new Error("send failed");
      sent.push(JSON.parse(value));
    },
  };
  const result = createFinishReplyResult();
  const targetState = {
    round: 1,
    playerIndex,
    history: withResult ? [result] : [],
    pendingFinishReplies: new Map(),
    pendingFinishReplyAcks: new Map(),
    showOpponentCustomFinish: true,
    players: [{ name: "LOCAL" }, { name: "REMOTE" }],
    finishReplyLine: "参りました",
    roleplayVoiceFallbackId: "knight",
    roomId: "room-ack-test",
    uid: "local-uid",
    opponentUid: "remote-uid",
    channel,
    screen: "result",
  };
  const fakeWindow = {
    crypto: {},
    setTimeout(callback, delay) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
  };
  const sandbox = {
    state: targetState,
    MAX_ROUNDS: 5,
    FINISH_REPLY_ACK_TIMEOUT_MS: 5_000,
    FINISH_REPLY_SETTLE_DURATION_MS: 1_600,
    FINISH_REPLY_PROTOCOL_VERSION: 2,
    FINISH_REPLY_ID_PATTERN: /^[a-f0-9]{32}$/,
    createOnlineSessionToken: () => replyId,
    getLethalResultForRound: (round, state = targetState) => {
      const latest = state.history.at(-1);
      return latest?.lethal && latest.round === round ? latest : null;
    },
    normalizeReceivedFinishReplyLine: (value) => String(value || ""),
    normalizeRoleplayVoiceSetId: (value) => String(value || ""),
    resolveVisibleFinishReplyLine: (value) => ({
      line: String(value || ""),
      custom: true,
      replaced: false,
    }),
    syncFinishReplySlot: () => { syncCalls += 1; },
    showToast: (value) => { toast = value; },
    finishCutInGeneration: 0,
    finishCutInContent: null,
    finishCutInDialog: null,
    document: { activeElement: null },
    window: fakeWindow,
  };
  const runtime = sliceBetween(
    "function applyFinishReplyToResult",
    "function triggerFinishCutIn",
    "finish reply ACK runtime",
  );
  vm.runInNewContext(
    `${runtime}
this.finishReplyApi = {
  acknowledgeLocalFinishReply,
  clearPendingFinishReplyAcks,
  handleRemoteFinishReply,
  handleRemoteFinishReplyAck,
  markPendingFinishReplyAcksUnconfirmed,
};`,
    sandbox,
  );
  return {
    api: sandbox.finishReplyApi,
    channel,
    result,
    sent,
    state: targetState,
    timers,
    get syncCalls() {
      return syncCalls;
    },
    get toast() {
      return toast;
    },
    fireTimer(timerId) {
      const timer = timers.get(timerId);
      if (!timer) return false;
      timers.delete(timerId);
      timer.callback();
      return true;
    },
  };
}

function incomingReply(overrides = {}) {
  return {
    type: "finish-reply",
    finishReplyVersion: 2,
    replyId: FINISH_REPLY_ID_A,
    roomId: "room-ack-test",
    round: 1,
    fromUid: "remote-uid",
    toUid: "local-uid",
    replyLine: "この借りは次で返す！",
    skipped: false,
    voiceSetId: "rival",
    ...overrides,
  };
}

function incomingAck(overrides = {}) {
  return {
    type: "finish-reply-ack",
    finishReplyVersion: 2,
    replyId: FINISH_REPLY_ID_A,
    roomId: "room-ack-test",
    round: 1,
    fromUid: "remote-uid",
    toUid: "local-uid",
    ...overrides,
  };
}

test("setup offers beginner voice sets plus independent custom reply editing", () => {
  assert.match(online, /ROLEPLAY_VOICE_SETS\.map\(\(voiceSet\) =>/);
  assert.match(online, /id="onlineRoleplayVoiceSet"/);
  assert.match(online, /王道主人公|ROLEPLAY VOICE/);
  assert.match(online, /id="onlineFinishReplyChoice"/);
  assert.match(online, /id="onlineCustomFinishReplyLine"[\s\S]*?maxlength="\$\{MAX_FINISH_REPLY_INPUT_UNITS\}"/);
  assert.match(online, /最大\$\{MAX_FINISH_REPLY_LENGTH\}文字・改行1回まで/);
  assert.match(online, /countFinishReplyCharacters\(state\.customFinishReplyLine\)/);
  assert.match(online, /normalizeFinishReplyLine\(input\.value, ""\)/);
  assert.match(online, /空欄のままなら、セリフを送らず静かに結果へ進みます/);
  assert.match(online, /function applyRoleplayVoiceSetSetting\(value\) \{[\s\S]*?state\.pursuitLine = voiceSet\.pursuitLine;[\s\S]*?state\.finishLine = voiceSet\.finishLine;[\s\S]*?state\.finishReplyLine = voiceSet\.replyLine;/);
  assert.match(online, /function bindOnlineFinishReplyFields\(\)/);
  assert.match(online, /sanitizeFinishReplyDraft\(input\.value\)/);
  assert.match(online, /applyRoleplayVoiceSetSetting\(value\);[\s\S]*?render\(\);[\s\S]*?#onlineRoleplayVoiceSet"\)\?\.focus/);
  assert.match(styles, /\.roleplay-voice-settings/);
  assert.match(styles, /\.finish-reply-input/);
});

test("roleplay selections persist locally and survive a same-mode rematch", () => {
  assert.match(online, /const FINISH_REPLY_LINE_KEY = "hariai-stadium-online-finish-reply-line-v1";/);
  assert.match(online, /const ROLEPLAY_VOICE_SET_KEY = "hariai-stadium-online-roleplay-voice-v1";/);
  assert.match(online, /localStorage\.setItem\(FINISH_REPLY_LINE_KEY, targetState\.finishReplyLine \|\| FINISH_REPLY_DISABLED_VALUE\);/);
  assert.match(online, /finishReplyLine: expectedState\.finishReplyLine,/);
  assert.match(online, /finishReplyChoice: expectedState\.finishReplyChoice,/);
  assert.match(online, /customFinishReplyLine: expectedState\.customFinishReplyLine,/);
  assert.match(online, /roleplayVoiceSetId: expectedState\.roleplayVoiceSetId,/);
  assert.match(online, /roleplayVoiceFallbackId: expectedState\.roleplayVoiceFallbackId,/);
});

test("the defeated player authors the optional P2P reply without blocking the final result", () => {
  assert.match(online, /const FINISH_CUT_IN_DURATION_MS = 12_000;/);
  assert.match(online, /const FINISH_REPLY_SETTLE_DURATION_MS = 1_600;/);
  assert.match(online, /const FINISH_REPLY_ACK_TIMEOUT_MS = 5_000;/);
  assert.match(online, /const FINISH_REPLY_PROTOCOL_VERSION = 2;/);
  assert.match(online, /const FINISH_REPLY_ID_PATTERN = \/\^\[a-f0-9\]\{32\}\$\//);
  assert.match(online, /const localIsLoser = payload\.loserIndex === state\.playerIndex;/);
  assert.match(online, /replyAction\.textContent = state\.finishReplyLine[\s\S]*?"この言葉で決着に応える"/);
  assert.match(online, /replyAction\.addEventListener\("click", \(\) => acknowledgeLocalFinishReply\(payload\)/);
  assert.match(online, /function sendLocalFinishReply\(targetState, result, payload, \{ replyLine, skipped \}\) \{[\s\S]*?channel\?\.readyState !== "open"[\s\S]*?type: "finish-reply",[\s\S]*?finishReplyVersion: FINISH_REPLY_PROTOCOL_VERSION,[\s\S]*?replyId,[\s\S]*?roomId: tracker\.roomId,[\s\S]*?round: tracker\.round,[\s\S]*?fromUid: tracker\.fromUid,[\s\S]*?toUid: tracker\.toUid/);
  assert.match(online, /const deliveryStatus = sendLocalFinishReply\([\s\S]*?applyFinishReplyToResult\(result,[\s\S]*?deliveryStatus,[\s\S]*?replyId: result\.finish\.replyId/);
  assert.match(online, /message\.type === "finish-reply"[\s\S]*?handleRemoteFinishReply\(message, expectedState, expectedChannel\)/);
  assert.match(online, /message\.type === "finish-reply-ack"[\s\S]*?handleRemoteFinishReplyAck\(message, expectedState, expectedChannel\)/);
  assert.match(online, /result\.winnerIndex !== targetState\.playerIndex/);
  assert.match(online, /pendingFinishReplies: new Map\(\)/);
  assert.match(online, /pendingFinishReplyAcks: new Map\(\)/);
  assert.match(online, /const replyLine = normalizeReceivedFinishReplyLine\(message\.replyLine\);/);
  assert.match(online, /if \(!result\) \{[\s\S]*?round === targetState\.round[\s\S]*?targetState\.pendingFinishReplies\.set\(round,/);
  assert.match(online, /const pendingFinishReply = state\.pendingFinishReplies\.get\(state\.round\) \|\| null;[\s\S]*?triggerFinishCutIn\(finish\);[\s\S]*?pendingFinishReply\.message \|\| pendingFinishReply,[\s\S]*?pendingFinishReply\.channel \|\| state\.channel/);
  assert.match(online, /resolveVisibleFinishReplyLine\(replyLine,[\s\S]*?showCustom: targetState\.showOpponentCustomFinish/);
  assert.match(online, /function handleRemoteFinishReplyAck\([\s\S]*?return settlePendingFinishReplyAck\(targetState, tracker, "delivered"\);/);
  assert.match(online, /function dismissFinishCutIn\(payload\) \{[\s\S]*?acknowledgeLocalFinishReply\(payload, \{ skipped: true, present: false \}\)/);
  assert.match(online, /message\.skipped === true/);
  assert.match(online, /renderFinishReplySlot\(state\.history\.at\(-1\), \{ terminal: true \}\)/);
  assert.match(online, /function syncFinishReplySlot\(result\)/);
  assert.match(online, /finish\.replyLineReplaced/);
  assert.match(online, /finish\.replyDeliveryFailed/);
  const remoteHandler = sliceBetween(
    "function handleRemoteFinishReply(",
    "function triggerFinishCutIn",
    "remote finish reply handler",
  );
  assert.match(remoteHandler, /syncFinishReplySlot\(result\)/);
  assert.doesNotMatch(remoteHandler, /\brender\(\)/);
  assert.match(
    extract(/function renderWaitingContinue\(\) \{[\s\S]*?\n\}/, "continue wait renderer"),
    /renderFinishReplySlot\(state\.history\.at\(-1\), \{ terminal: true \}\)/,
  );
  assert.match(
    extract(/function renderGameOver\(\) \{[\s\S]*?\n\}/, "gameover renderer"),
    /renderFinishReplySlot\(state\.history\.at\(-1\), \{ terminal: true \}\)/,
  );
  assert.doesNotMatch(
    extract(/function triggerFinishCutIn\(payload\) \{[\s\S]*?\n\}/, "finish cut-in"),
    /cutIn\.addEventListener\("click"/,
  );
  assert.match(styles, /\.finish-reply-panel\.is-acknowledged/);
  assert.match(styles, /\.finish-reply-seal/);
});

test("local reply remains pending until an exact application ACK arrives", () => {
  const harness = createFinishReplyHarness();

  assert.equal(
    harness.api.acknowledgeLocalFinishReply(harness.result.finish, { present: false }),
    true,
  );
  assert.equal(harness.result.finish.replyAcknowledged, true);
  assert.equal(harness.result.finish.replyDeliveryStatus, "pending");
  assert.equal(harness.result.finish.replyDeliveryPending, true);
  assert.equal(harness.result.finish.replyDeliveryFailed, false);
  assert.equal(harness.state.pendingFinishReplyAcks.size, 1);
  assert.equal(harness.timers.size, 1);
  assert.deepEqual(harness.sent[0], {
    type: "finish-reply",
    finishReplyVersion: 2,
    replyId: FINISH_REPLY_ID_A,
    roomId: "room-ack-test",
    round: 1,
    fromUid: "local-uid",
    toUid: "remote-uid",
    replyLine: "参りました",
    skipped: false,
    voiceSetId: "knight",
  });

  assert.equal(
    harness.api.handleRemoteFinishReplyAck(incomingAck(), harness.state, harness.channel),
    true,
  );
  assert.equal(harness.result.finish.replyDeliveryStatus, "delivered");
  assert.equal(harness.result.finish.replyDeliveryPending, false);
  assert.equal(harness.state.pendingFinishReplyAcks.size, 0);
  assert.equal(harness.timers.size, 0);
});

test("mismatched or cross-channel ACKs cannot confirm a pending reply", () => {
  const harness = createFinishReplyHarness();
  harness.api.acknowledgeLocalFinishReply(harness.result.finish, { present: false });
  const wrongChannel = { readyState: "open", send() {} };
  const mismatches = [
    [incomingAck({ replyId: FINISH_REPLY_ID_B }), harness.channel],
    [incomingAck({ roomId: "other-room" }), harness.channel],
    [incomingAck({ round: 2 }), harness.channel],
    [incomingAck({ fromUid: "intruder-uid" }), harness.channel],
    [incomingAck({ toUid: "other-uid" }), harness.channel],
    [incomingAck(), wrongChannel],
    [{ ...incomingAck(), finishReplyVersion: 1 }, harness.channel],
  ];

  mismatches.forEach(([message, channel]) => {
    assert.equal(
      harness.api.handleRemoteFinishReplyAck(message, harness.state, channel),
      false,
    );
    assert.equal(harness.result.finish.replyDeliveryStatus, "pending");
    assert.equal(harness.state.pendingFinishReplyAcks.size, 1);
  });
});

test("an ACK timeout is unconfirmed and a late exact ACK can still confirm delivery", () => {
  const harness = createFinishReplyHarness();
  harness.api.acknowledgeLocalFinishReply(harness.result.finish, { present: false });
  const tracker = harness.state.pendingFinishReplyAcks.get(FINISH_REPLY_ID_A);

  assert.ok(tracker);
  assert.equal(harness.fireTimer(tracker.timeoutId), true);
  assert.equal(harness.result.finish.replyDeliveryStatus, "unconfirmed");
  assert.equal(harness.result.finish.replyDeliveryFailed, false);
  assert.equal(harness.state.pendingFinishReplyAcks.size, 1);
  assert.equal(harness.timers.size, 0);

  assert.equal(
    harness.api.handleRemoteFinishReplyAck(incomingAck(), harness.state, harness.channel),
    true,
  );
  assert.equal(harness.result.finish.replyDeliveryStatus, "delivered");
  assert.equal(harness.state.pendingFinishReplyAcks.size, 0);
});

test("a v2 reply received before lethal resolution is ACKed only after it is applied", () => {
  const harness = createFinishReplyHarness({ playerIndex: 0, withResult: false });
  const message = incomingReply();

  harness.api.handleRemoteFinishReply(message, harness.state, harness.channel);
  assert.equal(harness.sent.length, 0);
  assert.equal(
    harness.state.pendingFinishReplies.get(1).message.replyLine,
    "この借りは次で返す！",
  );

  harness.state.history.push(harness.result);
  harness.state.screen = "waitingContinue";
  harness.api.handleRemoteFinishReply(
    harness.state.pendingFinishReplies.get(1).message,
    harness.state,
    harness.state.pendingFinishReplies.get(1).channel,
  );

  assert.equal(harness.result.finish.replyAcknowledged, true);
  assert.equal(harness.result.finish.replyLine, "この借りは次で返す！");
  assert.equal(harness.result.finish.replyName, "REMOTE");
  assert.equal(harness.result.finish.replyDeliveryStatus, "delivered");
  assert.equal(harness.syncCalls, 1);
  assert.deepEqual(harness.sent, [{
    type: "finish-reply-ack",
    finishReplyVersion: 2,
    replyId: FINISH_REPLY_ID_A,
    roomId: "room-ack-test",
    round: 1,
    fromUid: "local-uid",
    toUid: "remote-uid",
  }]);
});

test("a pre-resolution v2 reply from a replaced channel is neither applied nor ACKed", () => {
  const harness = createFinishReplyHarness({ playerIndex: 0, withResult: false });
  const originalChannel = harness.channel;
  const replacementSent = [];
  const replacementChannel = {
    readyState: "open",
    send(value) {
      replacementSent.push(JSON.parse(value));
    },
  };

  harness.api.handleRemoteFinishReply(incomingReply(), harness.state, originalChannel);
  const pending = harness.state.pendingFinishReplies.get(1);
  assert.equal(pending.channel, originalChannel);
  assert.equal(harness.sent.length, 0);

  harness.state.channel = replacementChannel;
  harness.state.history.push(harness.result);
  harness.state.screen = "waitingContinue";
  harness.state.pendingFinishReplies.delete(1);
  harness.api.handleRemoteFinishReply(
    pending.message,
    harness.state,
    pending.channel,
  );

  assert.equal(harness.result.finish.replyAcknowledged, false);
  assert.equal(harness.result.finish.replyLine, "");
  assert.equal(harness.result.finish.replyId, undefined);
  assert.equal(harness.syncCalls, 0);
  assert.equal(harness.sent.length, 0);
  assert.equal(replacementSent.length, 0);
});

test("same-id duplicates are re-ACKed without reapplying, while a second id is ignored", () => {
  const harness = createFinishReplyHarness({ playerIndex: 0 });
  harness.api.handleRemoteFinishReply(incomingReply(), harness.state, harness.channel);
  assert.equal(harness.result.finish.replyLine, "この借りは次で返す！");
  assert.equal(harness.sent.length, 1);

  harness.api.handleRemoteFinishReply(
    incomingReply({ replyLine: "上書きしてはいけない" }),
    harness.state,
    harness.channel,
  );
  assert.equal(harness.result.finish.replyLine, "この借りは次で返す！");
  assert.equal(harness.sent.length, 2);
  assert.equal(harness.sent[1].replyId, FINISH_REPLY_ID_A);

  harness.api.handleRemoteFinishReply(
    incomingReply({ replyId: FINISH_REPLY_ID_B, replyLine: "別IDも無視する" }),
    harness.state,
    harness.channel,
  );
  assert.equal(harness.result.finish.replyLine, "この借りは次で返す！");
  assert.equal(harness.sent.length, 2);
  assert.equal(harness.syncCalls, 1);
});

test("legacy replies remain compatible and never receive a v2 ACK", () => {
  const harness = createFinishReplyHarness({ playerIndex: 0 });
  harness.api.handleRemoteFinishReply({
    type: "finish-reply",
    round: 1,
    replyLine: "旧クライアントからの返礼",
    skipped: false,
    voiceSetId: "rival",
  }, harness.state, harness.channel);

  assert.equal(harness.result.finish.replyAcknowledged, true);
  assert.equal(harness.result.finish.replyLine, "旧クライアントからの返礼");
  assert.equal(harness.result.finish.replyDeliveryStatus, "delivered");
  assert.equal(harness.result.finish.replyId, "");
  assert.equal(harness.sent.length, 0);
});

test("a closed P2P channel records a local reply as not sent, never delivered", () => {
  const harness = createFinishReplyHarness({ channelReadyState: "closed" });

  assert.equal(
    harness.api.acknowledgeLocalFinishReply(harness.result.finish, { present: false }),
    false,
  );
  assert.equal(harness.result.finish.replyAcknowledged, true);
  assert.equal(harness.result.finish.replyDeliveryStatus, "not-sent");
  assert.equal(harness.result.finish.replyDeliveryFailed, true);
  assert.equal(harness.state.pendingFinishReplyAcks.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.sent.length, 0);
  assert.match(harness.toast, /届きませんでした/);
});

test("finish-reply ACK cleanup cancels timers and channel close becomes unconfirmed", () => {
  const cleanupHarness = createFinishReplyHarness();
  cleanupHarness.api.acknowledgeLocalFinishReply(
    cleanupHarness.result.finish,
    { present: false },
  );
  assert.equal(cleanupHarness.timers.size, 1);
  cleanupHarness.api.clearPendingFinishReplyAcks(cleanupHarness.state);
  assert.equal(cleanupHarness.state.pendingFinishReplyAcks.size, 0);
  assert.equal(cleanupHarness.timers.size, 0);

  const closeHarness = createFinishReplyHarness();
  closeHarness.api.acknowledgeLocalFinishReply(
    closeHarness.result.finish,
    { present: false },
  );
  closeHarness.api.markPendingFinishReplyAcksUnconfirmed(
    closeHarness.state,
    closeHarness.channel,
  );
  assert.equal(closeHarness.result.finish.replyDeliveryStatus, "unconfirmed");
  assert.equal(closeHarness.result.finish.replyDeliveryFailed, false);
  assert.equal(closeHarness.state.pendingFinishReplyAcks.size, 1);
  assert.equal(closeHarness.timers.size, 0);
  assert.match(online, /async function cleanupOnlineResources\([\s\S]*?clearPendingFinishReplyAcks\(targetState\)/);
});

test("no P2P failure path can erase an already resolved final result", () => {
  const preservation = sliceBetween(
    "function preserveResolvedFinishFromP2pRecovery",
    "function roundScoresAreComplete",
    "resolved finish P2P preservation",
  );
  assert.match(preservation, /getResolvedMatchResultForRound\(targetState\.round, targetState\)/);
  assert.match(preservation, /clearP2pRecoveryTimer\(targetState\)/);
  assert.match(preservation, /targetState\.p2pRecovery = null/);
  assert.match(preservation, /finishConnectionLossNotified/);
  assert.match(preservation, /確定済みの決着結果は保持しています/);
  assert.match(preservation, /queueResolvedMatchSettlement\(targetState\)/);
  assert.match(
    extract(
      /function dispatchP2pRecoveryEvent\(type, targetState = state, detail = \{\}\) \{[\s\S]*?\n\}/,
      "P2P event dispatcher",
    ),
    /preserveResolvedFinishFromP2pRecovery\(targetState\)/,
  );
  assert.match(
    sliceBetween(
      "async function completeP2pFailureCleanup",
      "async function resetAfterP2pFailure",
      "P2P failure cleanup",
    ),
    /preserveResolvedMatchBeforeP2pCleanup\(targetState\)[\s\S]*?runTransaction[\s\S]*?preserveResolvedMatchBeforeP2pCleanup\(targetState\)/,
  );
  assert.match(online, /peerDisconnected \|\| peerFailed\)[\s\S]*?preserveResolvedFinishFromP2pRecovery\(state, \{ notify: true \}\)/);
  assert.match(online, /channel\.onclose = \(\) => \{[\s\S]*?preserveResolvedFinishFromP2pRecovery\([\s\S]*?\{ notify: true \}/);
  assert.match(online, /if \(isMatchOver\(\)\) preserveResolvedFinishFromP2pRecovery\(state\)/);
  assert.match(
    sliceBetween(
      "async function preserveResolvedMatchBeforeP2pCleanup",
      "function restoreFinishCutInFocus",
      "resolved match cleanup guard",
    ),
    /preserveResolvedFinishFromP2pRecovery\(targetState\)[\s\S]*?resolveRound\(scores\)[\s\S]*?preserveResolvedFinishFromP2pRecovery\(targetState\)/,
  );
});

test("final result settlement and result viewing never wait for the opponent's continue", () => {
  const reaction = sliceBetween(
    "async function reactToRoundData",
    "async function sendSelectedImage",
    "round data reaction",
  );
  assert.match(reaction, /resolveRound\(scores\);[\s\S]*?getResolvedMatchResultForRound\(state\.round\)[\s\S]*?settleOnlineMatch\(roundContext\)/);
  const continueFlow = extract(
    /async function continueRound\(\) \{[\s\S]*?\n\}/,
    "continue flow",
  );
  assert.match(continueFlow, /if \(isMatchOver\(\)\) \{[\s\S]*?finishOnlineMatch\(roundContext\)/);
  assert.match(online, /async function settleOnlineMatch\(roundContext\)/);
  assert.match(online, /matchFinalizationPromise/);
  assert.match(online, /\$\{isMatchOver\(\) \? "" : '<button class="button button-danger" data-online-destroy>/);
  assert.match(online, /renderFinishReplySlot\(state\.history\.at\(-1\), \{ terminal: true \}\),\s*!isMatchOver\(\)/);
});

test("finish replies remain absent from Firebase queue, room resources, rules, and other modes", () => {
  const queueWrite = extract(/await set\(queueEntryRef, \{[\s\S]*?\n    \}\);/, "normal queue write");
  const roomResourceStart = soloSessionV2.indexOf("function buildSoloSessionV2Resources");
  const roomResourceEnd = soloSessionV2.indexOf(
    "function roomMatchesSessionV2",
    roomResourceStart,
  );
  assert.ok(roomResourceStart >= 0 && roomResourceEnd > roomResourceStart);
  const roomResources = soloSessionV2.slice(roomResourceStart, roomResourceEnd);

  assert.doesNotMatch(queueWrite, /finishReply|roleplayVoice/);
  assert.doesNotMatch(roomResources, /finishReply|roleplayVoice/);
  assert.doesNotMatch(rules, /finishReply|roleplayVoice/);
  for (const file of ["strategy.js"]) {
    assert.doesNotMatch(read(file), /finishReply|finish-reply|roleplayVoice/i);
  }
});

test("the custom-text visibility control and cache token cover both finish lines and replies", () => {
  assert.match(online, /相手が自由記述した決着セリフ・返礼を表示する/);
  assert.match(online, /自由記述は表示設定により、送信者の口調セットに対応する定型文へ置き換えています/);
  assert.match(index, /styles\.css\?v=[^"]*finish-reply-v2/);
  assert.match(index, /online\.js\?v=[^"]*finish-reply-v3/);
  assert.match(online, /finish-roleplay\.mjs\?v=finish-reply-v2/);
});
