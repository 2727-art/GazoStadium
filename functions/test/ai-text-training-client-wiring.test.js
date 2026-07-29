"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const client = read("ai-text-training.js");
const html = read("index.html");
const app = read("app.js");
const styles = read("styles.css");
const trainingStyles = read("ai-text-training.css");
const cosmetics = read("ai-text-training-cosmetics.js");

test("landing loads a separate solo mode and never routes it through Training 60", () => {
  assert.match(html, /ai-text-training\.css\?v=ai-text-training-v1/);
  assert.match(html, /ai-text-training\.js\?v=[^"]*app-check-v3/);
  assert.match(app, /id="aiTextTrainingButton"/);
  assert.match(app, /function startAiTextTraining\(\)/);
  assert.match(app, /window\.HariaiAiTextTraining\.start\(\)/);
  assert.match(client, /window\.HariaiAiTextTraining = Object\.freeze/);
  assert.match(client, /hariai-ai-text-training-ready/);
  assert.doesNotMatch(client, /HariaiTraining\.start/);
});

test("the desktop solo banner spans the complete hero grid", () => {
  assert.match(
    styles,
    /\.hero-ai-text-training-button\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1\s*;/,
  );
  assert.doesNotMatch(
    styles,
    /\.hero-ai-text-training-button\s*\{[\s\S]*?grid-column:\s*span\s+9\s*;/,
  );
  assert.match(
    html,
    /styles\.css\?v=[^"]*ai-text-training-banner-fullwidth-v1/,
  );
});

test("the client is Firebase-callable solo play with no P2P or RTDB transport", () => {
  assert.match(client, /firebase-services\.js\?v=app-check-v3/);
  assert.match(client, /httpsCallable\(functions, "aiTextTrainingAction"\)/);
  assert.doesNotMatch(client, /RTCPeerConnection|RTCDataChannel|getDatabase|firebase-database|database\b.*ref\(/);
  assert.match(client, /shared\(\)\?\.processImageFile/);
  assert.match(client, /Array\(AI_TEXT_TRAINING_ROUND_COUNT\)\.fill\(null\)/);
  assert.match(client, /indexedDB\.open\(DECK_DATABASE_NAME, 1\)/);
  assert.match(client, /URL\.revokeObjectURL/);
});

test("all three personalities, exact BPM boundary, and separate emergency stop are visible", () => {
  assert.match(client, /AI_TEXT_TRAINING_MODES/);
  assert.match(client, /normalizeAiTextTrainingBpm/);
  assert.match(client, /0または40〜160/);
  assert.match(client, /お姉ちゃんモードでは「きつい」で次のBPMが速くなります/);
  assert.match(client, /無理・痛い・めまい／即停止/);
  assert.match(client, /data-ai-text-training-reaction/);
  assert.match(client, /data-ai-text-training-action="emergency-stop"/);
  assert.match(client, /completeSession\("safety_stopped"\)/);
});

test("round duration extends safely to 60 seconds while keeping the 20-second default", () => {
  assert.match(
    client,
    /const ROUND_SECONDS_OPTIONS = Object\.freeze\(\[15, 20, 30, 45, 60\]\)/,
  );
  assert.match(client, /roundSeconds: 20/);
  assert.match(client, /1ラウンドは最大60秒[\s\S]*5ラウンドの運動時間は最大5分/);
  assert.match(
    client,
    /id="aiTextTrainingEditorPreviewRemaining" type="number" min="1" max="60"/,
  );
  assert.match(client, /Math\.min\(60, Number\(event\.currentTarget\.value\)/);
  assert.match(client, /if \(!ROUND_SECONDS_OPTIONS\.includes\(seconds\)\) return/);
  assert.match(
    client,
    /state\.roundSeconds >= 45[\s\S]*?remainingSeconds === 30[\s\S]*?残り30秒です/,
  );
  assert.match(
    client,
    /function formatActiveDuration[\s\S]*?padStart\(2, "0"\)[\s\S]*?formatActiveDuration\(state\.completedActiveSeconds\)/,
  );
});

test("partial elapsed time is counted once when a playing, paused, or countdown session ends", () => {
  const elapsedStart = client.indexOf("function currentRoundElapsedSeconds");
  const elapsedEnd = client.indexOf("function chooseReaction", elapsedStart);
  const elapsed = client.slice(elapsedStart, elapsedEnd);
  assert.match(elapsed, /Math\.max\(0, Math\.min\(roundMs, rawRemainingMs\)\)/);
  assert.match(elapsed, /if \(state\.completedRounds > state\.roundIndex\) return/);
  assert.match(elapsed, /state\.completedActiveSeconds \+= currentRoundElapsedSeconds\(\)/);
  assert.match(elapsed, /function finishRound\(\)[\s\S]*?recordCurrentRoundElapsed\(\)/);

  const completeStart = client.indexOf("function completeSession");
  const completeEnd = client.indexOf("function emergencyStop", completeStart);
  const complete = client.slice(completeStart, completeEnd);
  assert.match(
    complete,
    /state\.remainingMs = Math\.max\(0, state\.roundEndsAt - performance\.now\(\)\)/,
  );
  assert.match(
    complete,
    /\["playing", "paused", "countdown"\]\.includes\(state\.phase\)[\s\S]*?recordCurrentRoundElapsed\(\)/,
  );

  const beginStart = client.indexOf("function beginRound");
  const beginEnd = client.indexOf("function startRoundCountdown", beginStart);
  assert.doesNotMatch(client.slice(beginStart, beginEnd), /lastAnnouncedSecond = null/);
  assert.match(client, /function advanceRound\(\)[\s\S]*?lastAnnouncedSecond = null/);
});

test("training cosmetics are trial-only until server-verified equip and freeze per session", () => {
  assert.match(cosmetics, /ai_training_style_soft_glow/);
  assert.match(cosmetics, /ai_training_style_neon_beat/);
  assert.match(cosmetics, /ai_training_style_stardust_stage/);
  assert.match(cosmetics, /panelThemeId/);
  assert.match(cosmetics, /messageDecorationId/);
  assert.match(client, /name="aiTextTrainingCosmetic_\$\{slot\}"/);
  assert.match(client, /未購入品もここで試着できますが、保存はされません/);
  assert.match(client, /aiTextTrainingCosmeticsAreOwned/);
  assert.match(client, /action: "save_cosmetics"/);
  assert.match(client, /state\.sessionCosmetics = equippedCosmetics\(\)/);
  assert.match(client, /cosmetics: state\.sessionCosmetics/);
  assert.match(client, /data-att-panel-theme=/);
  assert.match(client, /data-att-message-decoration=/);
  assert.match(client, /ai-text-training-message-surface/);
  assert.match(trainingStyles, /forced-colors:\s*active/);
  assert.match(
    trainingStyles,
    /\.ai-text-training-cosmetic-actions \.button\s*\{\s*flex:\s*0 0 auto;\s*min-height:\s*48px;/,
  );
  assert.doesNotMatch(
    trainingStyles,
    /\[data-att-(?:panel-theme|message-decoration)[^\{]*\{[^}]*\.ai-text-training-(?:emergency|safety-controls)/,
  );
});

test("paid one-use review shows balance, price, post-payment balance, and voluntariness", () => {
  const reviewStart = client.indexOf("function renderPurchaseReview");
  const reviewEnd = client.indexOf("function xLink", reviewStart);
  const review = client.slice(reviewStart, reviewEnd);
  assert.match(review, /現在残高/);
  assert.match(review, /今回の価格/);
  assert.match(review, /支払後残高/);
  assert.match(review, /5ラウンド1セッション/);
  assert.match(review, /自主終了・「無理／痛い／めまい」即停止でも使い切り/);
  assert.match(review, /追加支払いなしで再開/);
  assert.match(review, /購入は完全に任意/);
  assert.match(review, /aiTextTrainingPurchaseConsent/);
  assert.match(review, /id="aiTextTrainingConfirmPurchase"[\s\S]*?disabled/);
  assert.match(client, /confirmButton\.disabled = !event\.currentTarget\.checked/);
  assert.match(client, /action: "start_paid_use"/);
  assert.match(client, /expectedBalance: state\.balance/);
  assert.match(client, /response\.data\?\.terminalAction === true/);
  assert.match(client, /if \(use\.status !== "active"\)/);
  assert.match(client, /if \(!state\.purchaseActionId\) state\.purchaseActionId = generatedActionId\("use"\)/);
});

test("one paid use cannot replay while or after its terminal acknowledgement", () => {
  assert.match(
    client,
    /data-ai-text-training-action="setup-after-result" \$\{state\.finishPending \|\| state\.activeUse \? "disabled" : ""\}/,
  );
  assert.match(client, /data-ai-text-training-action="retry-finish"/);
  assert.match(client, /if \(state\.paidUseId \|\| state\.activeUse\)/);
  assert.match(client, /if \(recovered && state\.resultOutcome\)/);
  assert.match(client, /state\.screen = "result";[\s\S]*?state\.phase = "result";/);
  assert.match(client, /state\.finishInFlight/);
});

test("purchase and publish reviews reset when their displayed balance changes", () => {
  assert.match(
    client,
    /balanceChanged[\s\S]*?\["purchase_review", "editor_review"\]\.includes\(targetState\.screen\)[\s\S]*?render\(\)/,
  );
  const publishStart = client.indexOf("async function publishEditorDraft");
  const publishEnd = client.indexOf("async function unpublishCurrentPreset", publishStart);
  assert.match(client.slice(publishStart, publishEnd), /expectedBalance: state\.balance/);
});

test("sold script phases and paid personality are the phases actually played", () => {
  assert.match(client, /aiTextTrainingScriptSlot\(\{ phase: "rest" \}\)/);
  assert.match(client, /aiTextTrainingScriptSlot\(\{ phase: "clear" \}\)/);
  assert.match(client, /escapeHtml\(restMessage\(\)\)/);
  assert.match(client, /escapeHtml\(clearMessage\(\)\)/);
  assert.match(client, /state\.modeId = state\.activeUse\.preset\.modeId/);
  assert.match(client, /name="aiTextTrainingMode"[\s\S]*?\$\{locked \? "disabled" : ""\}/);
});

test("local image deletion failure keeps consent truthful and reports the failure", () => {
  assert.match(client, /await deleteStoredDeck\(\);[\s\S]*?state\.persistDeck = false/);
  assert.match(
    client,
    /catch \{[\s\S]*?state\.persistDeck = true;[\s\S]*?保存設定はONのままです/,
  );
});

test("UGC stays text-only and the X link uses the current self-reported handle boundary", () => {
  assert.match(client, /escapeHtml\(line\)/);
  assert.match(client, /element\.textContent = state\.currentMessage/);
  assert.doesNotMatch(client, /\.innerHTML = state\.currentMessage/);
  assert.match(client, /`https:\/\/x\.com\/\$\{encodeURIComponent\(row\.xHandle\)\}`/);
  assert.match(client, /rel="noopener noreferrer nofollow ugc"/);
  assert.match(client, /referrerpolicy="no-referrer"/);
  assert.match(client, /作者の自己申告・本人未確認/);
  assert.match(client, /X_EXTERNAL_CONFIRM_MESSAGE/);
  assert.doesNotMatch(client, /oEmbed|twitter\.com|fetch\s*\(/i);
  assert.match(client, /通報時の改訂全文を証跡として保存します/);
  assert.match(client, /expectedRevision: viewedPreset\.revision/);
  assert.match(client, /response\.data\?\.quarantined/);
  assert.match(client, /台本とXリンクを確認のため非公開/);
});

test("pause, visibility, Wake Lock, metronome, and screen-reader cadence are guarded", () => {
  assert.match(client, /createFreeTableAmbienceController/);
  assert.match(client, /navigator\.wakeLock\?\.request/);
  assert.match(client, /document\.addEventListener\("visibilitychange"/);
  assert.match(client, /function readLocalValue[\s\S]*?catch \{[\s\S]*?return fallback/);
  assert.match(client, /function writeLocalValue[\s\S]*?catch \{[\s\S]*?return false/);
  assert.match(client, /pauseSession\(\{ fromVisibility: true \}\)/);
  assert.match(client, /自動では再開しません/);
  assert.match(client, /role="status" aria-live="polite"/);
  assert.match(client, /残り5秒です/);
  assert.match(client, /state\.ambienceController\.disable\(\)/);
});

test("other modes reciprocally exclude the new solo lifecycle", () => {
  for (const relativePath of [
    "account.js",
    "online.js",
    "strategy.js",
    "training.js",
    "market.js",
    "flea-market.js",
    "free-table.js",
  ]) {
    assert.match(read(relativePath), /HariaiAiTextTraining\?\.isActive\?\.\(\)/);
  }
  assert.match(app, /HariaiAiTextTraining\?\.isActive\?\.\(\)/);
  assert.match(app, /HariaiAiTextTraining\.requestHome\(\)/);
});
