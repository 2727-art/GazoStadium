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

test("setup offers beginner voice sets plus independent custom reply editing", () => {
  assert.match(online, /ROLEPLAY_VOICE_SETS\.map\(\(voiceSet\) =>/);
  assert.match(online, /id="onlineRoleplayVoiceSet"/);
  assert.match(online, /王道主人公|ROLEPLAY VOICE/);
  assert.match(online, /id="onlineFinishReplyChoice"/);
  assert.match(online, /id="onlineCustomFinishReplyLine"[\s\S]*?maxlength="\$\{MAX_FINISH_REPLY_LENGTH\}"/);
  assert.match(online, /最大\$\{MAX_FINISH_REPLY_LENGTH\}文字・改行1回まで/);
  assert.match(online, /function applyRoleplayVoiceSetSetting\(value\) \{[\s\S]*?state\.pursuitLine = voiceSet\.pursuitLine;[\s\S]*?state\.finishLine = voiceSet\.finishLine;[\s\S]*?state\.finishReplyLine = voiceSet\.replyLine;/);
  assert.match(online, /function bindOnlineFinishReplyFields\(\)/);
  assert.match(online, /sanitizeFinishReplyDraft\(input\.value\)/);
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
  assert.match(online, /const localIsLoser = payload\.loserIndex === state\.playerIndex;/);
  assert.match(online, /replyAction\.textContent = state\.finishReplyLine[\s\S]*?"この言葉で決着に応える"/);
  assert.match(online, /replyAction\.addEventListener\("click", \(\) => acknowledgeLocalFinishReply\(payload\)/);
  assert.match(online, /type: "finish-reply",[\s\S]*?round: payload\.round,[\s\S]*?replyLine,[\s\S]*?voiceSetId: normalizeRoleplayVoiceSetId\(state\.roleplayVoiceFallbackId\)/);
  assert.match(online, /message\.type === "finish-reply"[\s\S]*?handleRemoteFinishReply\(message, expectedState\)/);
  assert.match(online, /result\.winnerIndex !== targetState\.playerIndex/);
  assert.match(online, /pendingFinishReplies: new Map\(\)/);
  assert.match(online, /if \(!result\) \{[\s\S]*?round === targetState\.round[\s\S]*?targetState\.pendingFinishReplies\.set\(round,/);
  assert.match(online, /const pendingFinishReply = state\.pendingFinishReplies\.get\(state\.round\) \|\| null;[\s\S]*?triggerFinishCutIn\(finish\);[\s\S]*?handleRemoteFinishReply\(pendingFinishReply, state\);/);
  assert.match(online, /resolveVisibleFinishReplyLine\(message\.replyLine,[\s\S]*?showCustom: targetState\.showOpponentCustomFinish/);
  assert.match(online, /The battle result is already final; a failed optional reply must not block progression/);
  assert.doesNotMatch(
    extract(/function triggerFinishCutIn\(payload\) \{[\s\S]*?\n\}/, "finish cut-in"),
    /cutIn\.addEventListener\("click"/,
  );
  assert.match(styles, /\.finish-reply-panel\.is-acknowledged/);
  assert.match(styles, /\.finish-reply-seal/);
});

test("a reply arriving just before local score resolution is applied after the lethal result", () => {
  const start = online.indexOf("function getLethalResultForRound");
  const end = online.indexOf("function triggerFinishCutIn", start);
  assert.ok(start >= 0 && end > start);
  const targetState = {
    round: 1,
    playerIndex: 0,
    history: [],
    pendingFinishReplies: new Map(),
    showOpponentCustomFinish: true,
    players: [{ name: "WINNER" }, { name: "LOSER" }],
    screen: "waitingScore",
  };
  const sandbox = {
    state: targetState,
    MAX_ROUNDS: 5,
    normalizeReceivedFinishReplyLine: (value) => String(value || ""),
    normalizeRoleplayVoiceSetId: (value) => String(value || ""),
    resolveVisibleFinishReplyLine: (value) => ({ line: String(value || ""), custom: true }),
    render: () => {},
    completeFinishReplyPresentation: () => {},
    finishCutInGeneration: 0,
    finishCutInContent: null,
    finishCutInDialog: null,
    FINISH_REPLY_SETTLE_DURATION_MS: 1_600,
    window: {},
  };
  vm.runInNewContext(
    `${online.slice(start, end)}\nthis.handleReply = handleRemoteFinishReply;`,
    sandbox,
  );

  sandbox.handleReply({
    type: "finish-reply",
    round: 1,
    replyLine: "この借りは次で返す！",
    voiceSetId: "rival",
  }, targetState);
  assert.equal(targetState.pendingFinishReplies.get(1).replyLine, "この借りは次で返す！");

  const result = {
    round: 1,
    lethal: true,
    winnerIndex: 0,
    loserIndex: 1,
    finish: {
      round: 1,
      loserName: "LOSER",
      replyAcknowledged: false,
      replyLine: "",
    },
  };
  targetState.history.push(result);
  targetState.screen = "result";
  sandbox.handleReply(targetState.pendingFinishReplies.get(1), targetState);

  assert.equal(result.finish.replyAcknowledged, true);
  assert.equal(result.finish.replyLine, "この借りは次で返す！");
  assert.equal(result.finish.replyName, "LOSER");
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
  for (const file of ["strategy.js", "team.js", "royale.js"]) {
    assert.doesNotMatch(read(file), /finishReply|finish-reply|roleplayVoice/i);
  }
});

test("the custom-text visibility control and cache token cover both finish lines and replies", () => {
  assert.match(online, /相手が自由記述した決着セリフ・返礼を表示する/);
  assert.match(index, /styles\.css\?v=[^"]*finish-reply-v1/);
  assert.match(index, /online\.js\?v=[^"]*finish-reply-v1/);
  assert.match(online, /finish-roleplay\.mjs\?v=finish-reply-v1/);
});
