const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const strategySource = read("strategy.js");
const strategyStyles = read("strategy.css");
const indexHtml = read("index.html");
const onlineSource = read("online.js");
const databaseRulesSource = read("database.rules.json");
const databaseRules = JSON.parse(databaseRulesSource);
const strategyRoomRules = databaseRules.rules.online.strategyRooms.$roomId;
const strategyChatRules = databaseRules.rules.online.strategyChats.$roomId.$messageId;

function assertIncludesAll(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `${label} is missing: ${token}`);
  }
}

test("strategy review client writes the three lifecycle records and uses review chat metadata", () => {
  assert.match(strategySource, /const REVIEW_DURATION_MS = 10 \* 60 \* 1000;/);
  assert.match(
    strategySource,
    /strategyRooms\/\$\{state\.roomId\}\/reviewDecisions\/\$\{state\.uid\}`\), decision/,
  );
  assert.match(
    strategySource,
    /strategyRooms\/\$\{state\.roomId\}\/reviewStartedAt`\), serverTimestamp\(\)/,
  );
  assert.match(
    strategySource,
    /strategyRooms\/\$\{state\.roomId\}\/reviewEnded\/\$\{state\.uid\}`\), true/,
  );
  assert.match(
    strategySource,
    /phase: isStrategyChatAnonymous\(\) \? "scout" : state\.screen === "review" \? "review" : "battle"/,
  );
  assert.match(
    strategySource,
    /round: state\.screen === "review" \? 0 : Math\.max\(1, Math\.min\(MAX_ROUNDS,/,
  );
  assert.match(
    strategySource,
    /finished\[state\.uid\] !== true \|\| finished\[state\.opponentUid\] !== true/,
  );
});

test("review decisions are member-owned, write-once, and require both verified finishes", () => {
  const decisionRules = strategyRoomRules.reviewDecisions.$uid;
  const writeRule = decisionRules[".write"];

  assertIncludesAll(writeRule, [
    "auth.uid === $uid",
    "!data.exists()",
    "/members/' + auth.uid",
    "/status').val() === 'active'",
    "/destroyed').exists()",
    "/finished/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).val() === true",
    "/finished/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).val() === true",
    "/resultClaims/",
    "'win'",
    "'loss'",
    "'draw'",
  ], "reviewDecisions write rule");
  assert.equal(
    decisionRules[".validate"],
    "newData.isString() && (newData.val() === 'accept' || newData.val() === 'decline')",
  );
});

test("review start and end records enforce mutual consent, presence, and server time", () => {
  const startRules = strategyRoomRules.reviewStartedAt;
  const startWrite = startRules[".write"];

  assertIncludesAll(startWrite, [
    "!data.exists()",
    "/members/' + auth.uid",
    "/finished/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).val() === true",
    "/finished/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).val() === true",
    "/reviewDecisions/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).val() === 'accept'",
    "/reviewDecisions/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).val() === 'accept'",
    "/reviewEnded/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).exists()",
    "/reviewEnded/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).exists()",
    "/presence/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val() + '/online').val() === true",
    "/presence/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val() + '/online').val() === true",
    "/resultClaims/",
  ], "reviewStartedAt write rule");
  assert.equal(
    startRules[".validate"],
    "newData.isNumber() && newData.val() >= now - 15000 && newData.val() <= now + 15000",
  );

  const endRules = strategyRoomRules.reviewEnded.$uid;
  assertIncludesAll(endRules[".write"], [
    "auth.uid === $uid",
    "!data.exists()",
    "newData.val() === true",
    "/members/' + auth.uid",
    "/reviewStartedAt').isNumber()",
  ], "reviewEnded write rule");
  assert.equal(endRules[".validate"], "newData.val() === true");
});

test("review chat is round zero and writable only during the ten-minute mutual session", () => {
  const writeRule = strategyChatRules[".write"];
  const reviewMarker = "|| (newData.child('phase').val() === 'review'";
  const reviewIndex = writeRule.indexOf(reviewMarker);
  assert.ok(reviewIndex > 0, "review chat branch must be separate from scout/battle");

  const battleBranch = writeRule.slice(0, reviewIndex);
  assertIncludesAll(battleBranch, [
    "newData.child('phase').val() === 'scout'",
    "newData.child('phase').val() === 'battle'",
    "!root.child('online/strategyRooms/' + $roomId + '/finished/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).exists()",
    "!root.child('online/strategyRooms/' + $roomId + '/finished/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).exists()",
  ], "pre-finish scout/battle chat branch");

  const reviewBranch = writeRule.slice(reviewIndex);
  assertIncludesAll(reviewBranch, [
    "newData.child('phase').val() === 'review'",
    "newData.child('round').val() === 0",
    "/finished/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).val() === true",
    "/finished/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).val() === true",
    "/reviewDecisions/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).val() === 'accept'",
    "/reviewDecisions/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).val() === 'accept'",
    "/reviewStartedAt').isNumber()",
    "/reviewStartedAt').val() <= now",
    "now < root.child('online/strategyRooms/' + $roomId + '/reviewStartedAt').val() + 600000",
    "/reviewEnded/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).exists()",
    "/reviewEnded/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).exists()",
    "/presence/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val() + '/online').val() === true",
    "/presence/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val() + '/online').val() === true",
  ], "review chat branch");

  assertIncludesAll(strategyChatRules[".validate"], [
    "newData.child('phase').val() === 'review'",
    "newData.child('round').val() === 0",
    "newData.child('createdAt').val() >= now - 15000",
    "newData.child('createdAt').val() <= now + 15000",
  ], "review chat metadata validation");
  assert.match(strategyChatRules.phase[".validate"], /newData\.val\(\) === 'review'/);
  assert.match(
    strategyChatRules.round[".validate"],
    /newData\.parent\(\)\.child\('phase'\)\.val\(\) === 'review' && newData\.val\(\) === 0/,
  );
});

test("review chat keeps identified cosmetics while standard 1on1 stays untouched", () => {
  for (const key of ["stampId", "titleId", "chatFrameId", "chatBackgroundId"]) {
    const validation = strategyChatRules[key][".validate"];
    assert.match(validation, /phase'\)\.val\(\) === 'battle'/);
    assert.match(validation, /phase'\)\.val\(\) === 'review'/);
  }

  assert.doesNotMatch(onlineSource, /\breview(?:Decisions|StartedAt|Ended)\b/);
  assert.doesNotMatch(onlineSource, /POST-MATCH REVIEW|品評会/);
  assert.doesNotMatch(onlineSource, /phase:\s*[^,\n]*["']review["']/);
});

test("review image and audio attachments use a separate consent-gated P2P channel", () => {
  assert.match(strategySource, /strategy-review-asset-transfer\.mjs\?v=strategy-review-assets-v1/);
  assert.match(strategySource, /STRATEGY_REVIEW_ASSET_CHANNEL_LABEL = "hariai-strategy-review-assets-v1"/);
  assert.match(
    strategySource,
    /createDataChannel\(STRATEGY_REVIEW_ASSET_CHANNEL_LABEL, \{ ordered: true \}\)/,
  );
  assert.match(strategySource, /function handleStrategyReviewAssetChannelMessage\(data\)/);
  assert.match(
    strategySource,
    /if \(!strategyReviewIsActive\(\) \|\| !state\.reviewMediaReceiving\) throw new Error/,
  );
  assert.match(strategySource, /expectedOwnerUid: state\.opponentUid/);
  assert.match(strategySource, /STRATEGY_REVIEW_IMAGE_LIMIT = 3/);
  assert.match(strategySource, /STRATEGY_REVIEW_AUDIO_LIMIT = 1/);
  assert.match(strategySource, /state\.reviewAssetSentCounts\[asset\.kind\] \+= 1/);
  assert.match(strategySource, /state\.reviewAssetReceivedCounts\[asset\.kind\] \+= 1/);
  assert.match(strategySource, /processImageFile\(file, 0, options\)/);
  assert.match(strategySource, /processStrategyAudioFile\(file\)/);
  assert.match(strategySource, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(strategySource, /function collectStrategyReviewBattleMedia\(\)/);
  assert.match(
    strategySource,
    /function finishReviewLocally\(reason\)[\s\S]*?releaseStrategyVideoData\(\);[\s\S]*?releaseStrategyReviewAssetData\(\);/,
  );
  assert.match(
    strategySource,
    /function releaseMatchMedia\(\)[\s\S]*?releaseStrategyVideoData\(\);[\s\S]*?releaseStrategyReviewAssetData\(\);/,
  );
  assert.match(strategySource, /state\.reviewAssetChannel\?\.close\(\)/);
  assert.match(strategyStyles, /\.strategy-review-gallery-grid\b/);
  assert.match(strategyStyles, /\.strategy-review-asset-panel\b/);
  assert.match(indexHtml, /strategy\.css\?v=[^"]*review-assets-v1/);
  assert.match(indexHtml, /strategy\.js\?v=[^"]*review-assets-v1/);
});
