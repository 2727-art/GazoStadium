"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const online = fs.readFileSync(path.join(root, "online.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(name) {
  const start = online.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  let depth = 0;
  // 引数の分割代入 `{ ... }` ではなく、本体の `) {` から数える。
  for (let cursor = online.indexOf(") {", start) + 2; cursor < online.length; cursor += 1) {
    if (online[cursor] === "{") depth += 1;
    if (online[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return online.slice(start, cursor + 1);
    }
  }
  throw new Error(`${name} incomplete`);
}

test("normal 1on1 offers only the girl persona lines and migrates retired templates", () => {
  assert.match(online, /const PURSUIT_LINES = Object\.freeze\(ROLEPLAY_VOICE_SETS\.map\(\(\{ pursuitLine \}\) => pursuitLine\)\);/);
  assert.match(online, /const FINISH_LINES = Object\.freeze\(ROLEPLAY_VOICE_SETS\.map\(\(\{ finishLine \}\) => finishLine\)\);/);
  assert.doesNotMatch(online, /LEGACY_PURSUIT_LINES|LEGACY_FINISH_LINES|王道主人公/);
  assert.match(extractFunction("getSavedPursuitSettings"), /RETIRED_PURSUIT_LINES\.includes/);
  assert.match(extractFunction("getSavedFinishSettings"), /RETIRED_FINISH_LINES\.includes/);
  assert.match(extractFunction("getSavedFinishReplySettings"), /RETIRED_FINISH_REPLY_LINES\.includes/);
  assert.match(extractFunction("createFinishCutInPayload"), /FINISH_TEMPLATE_LINES\.includes\(receivedLine\)/);
});

test("card captions travel with the image over P2P and never reach Firebase writes", () => {
  const send = extractFunction("sendSelectedImage");
  assert.match(send, /const caption = normalizeCardCaption\(roundCaptionFor\(item\)\);/);
  assert.match(send, /state\.sentCaptions\.set\(round, caption\);/);
  assert.match(send, /type: "image-start"[\s\S]*?caption,\s*voiceSetId,/);
  // 選ぶ時のひとことは、登録したひとこと・自分の口調の定型・言葉なしから選ぶだけ。
  const options = extractFunction("roundCaptionOptions");
  assert.match(options, /normalizeCardCaption\(item\?\.caption\)/);
  assert.match(options, /getRoleplayVoiceSet\(localRoleplayVoiceSetId\(targetState\)\)\?\.cardLine/);
  assert.match(options, /options\.push\(\{ id: "none", text: "" \}\);/);
  assert.match(extractFunction("advanceAfterRound"), /state\.roundCaptionChoice = "";/);
  assert.match(online, /caption: typeof message\.caption === "string" \? normalizeCardCaption\(message\.caption\) : "",/);
  assert.match(extractFunction("finishIncomingImage"), /caption: transfer\.caption \|\| "",/);
  const caption = extractFunction("renderCardCaption");
  assert.match(caption, /resolveVisibleCardCaption\(item\.caption, \{ showCustom: state\.showOpponentCustomFinish, voiceSetId: item\.voiceSetId \}\)/);
  assert.match(caption, /escapeHtml\(visible\.caption\)/);
  assert.match(online, /data-online-card-caption=/);
  assert.doesNotMatch(online, /set\(ref\(database,[^;]*caption/);
});

test("score reactions are chosen with the score but sent only after both scores are known", () => {
  const lock = extractFunction("lockScore");
  assert.match(lock, /state\.localScoreReactions\.set\(state\.round/);
  assert.doesNotMatch(lock, /score-reaction|channel\.send/);
  const resolve = extractFunction("resolveRound");
  const renderAt = resolve.indexOf("render();");
  const sendAt = resolve.indexOf("sendLocalScoreReaction(state.round);");
  assert.ok(renderAt >= 0 && sendAt > renderAt, "reaction is sent after the round resolves");
  const receive = extractFunction("handleRemoteScoreReaction");
  assert.match(receive, /round < 1 \|\| round > MAX_ROUNDS/);
  assert.match(receive, /SCORE_REACTION_BANDS\.includes\(message\?\.band\)/);
  assert.match(extractFunction("scoreReactionText"), /resolveScoreReaction\(\{ \.\.\.entry, score: scores\[columnIndex\] \}\)/);
  assert.match(online, /message\.type === "score-reaction"/);
});

test("the DM thread keeps every round's own post as a sent mark and the opponent's images until the match ends", () => {
  assert.match(extractFunction("resolveRound"), /localCardId: selectedItem\?\.id \|\| "",/);
  const local = extractFunction("renderThreadLocalPost");
  assert.match(local, /画像を1枚貼った/);
  assert.doesNotMatch(local, /<img/, "the local image is never drawn in the thread");
  assert.match(local, /data-zoom-src=/, "only the local player can peek at their own image");
  const advance = extractFunction("advanceAfterRound");
  assert.doesNotMatch(advance, /releaseRemoteImage/, "opponent images stay for the thread and the result");
  assert.match(extractFunction("releaseMatchMedia"), /state\.remoteImages\.forEach\(\(item\) => item\.url && URL\.revokeObjectURL\(item\.url\)\);/);
  assert.match(extractFunction("finishIncomingImage"), /releaseRemoteImage\(round\);/);
  assert.doesNotMatch(online, /function renderScoreLog\(/);
});

test("changed normal 1on1 assets carry a new cache token", () => {
  for (const asset of ["online\\.js", "velvet-battle\\.css", "styles\\.css"]) {
    assert.match(index, new RegExp(`${asset}\\?v=[^"]*girl-voice-casual-v1`));
  }
  for (const asset of ["online\\.js", "velvet-battle\\.css"]) {
    assert.match(index, new RegExp(`${asset}\\?v=[^"]*normal-dm-thread-v1`));
  }
  assert.match(online, /finish-roleplay\.mjs\?v=finish-reply-v2-girl-voice-v1/);
  assert.match(online, /from "\.\/normal-dm-thread\.mjs\?v=normal-dm-thread-v1";/);
});
