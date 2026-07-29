"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const client = read("ai-text-training.js");
const ambienceSource = read("free-table-ambience.mjs");
const html = read("index.html");
const app = read("app.js");
const styles = read("styles.css");
const trainingStyles = read("ai-text-training.css");
const cosmetics = read("ai-text-training-cosmetics.js");
const online = read("online.js");
const readme = read("README.md");
const design = read("AI_TEXT_TRAINING_DESIGN.md");
const coreModule = import(pathToFileURL(path.join(root, "ai-text-training-core.mjs")).href);
const rosterModule = import(pathToFileURL(path.join(root, "ai-text-training-roster.mjs")).href);
const ambienceModule = import(pathToFileURL(path.join(root, "free-table-ambience.mjs")).href);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `source marker is available: ${startMarker}`);
  assert.ok(end > start, `source marker follows ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function achievementQueueHarness({
  storage = new Map(),
  uid = "",
  actionHandler = null,
} = {}) {
  const calls = [];
  const events = [];
  const state = {
    preview: false,
    screen: "setup",
    achievementActionId: "",
    achievementSessionId: "",
    achievementRetryInFlight: false,
    achievementRetryError: "",
    notifiedAchievementIds: new Set(),
  };
  const auth = { currentUser: uid ? { uid } : null };
  let handler = actionHandler;
  const context = vm.createContext({
    ACHIEVEMENT_RETRY_QUEUE_KEY: "hariai-ai-text-training-achievement-retry-v1",
    AI_TEXT_TRAINING_MODES: [{ id: "mama" }, { id: "imouto" }, { id: "oneechan" }],
    AI_TEXT_TRAINING_ROUND_COUNT: 5,
    ROUND_SECONDS_OPTIONS: [15, 20, 30, 45, 60],
    active: false,
    auth,
    state,
    readLocalValue(key, fallback = "") {
      return storage.has(key) ? storage.get(key) : fallback;
    },
    writeLocalValue(key, value) {
      storage.set(key, value);
      return true;
    },
    removeLocalValue(key) {
      storage.delete(key);
      return true;
    },
    async aiTextTrainingAction(payload) {
      calls.push({ ...payload, uid: auth.currentUser?.uid || "" });
      if (handler) return await handler(payload, auth);
      const sessionId = payload.sessionId || "a".repeat(40);
      return { data: { session: { id: sessionId }, newlyUnlocked: [] } };
    },
    async economyActionCallable() {
      return { data: {} };
    },
    persistSession() {},
    render() {},
    window: {
      HariaiAchievements: {
        normalizeIds(value) {
          return Array.isArray(value) ? value : [];
        },
      },
      dispatchEvent(event) {
        events.push(event);
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  });
  const start = client.indexOf("function normalizeAchievementOwnerUid");
  const end = client.indexOf("function createState", start);
  assert.ok(start >= 0 && end > start, "achievement queue runtime block is available");
  vm.runInContext(`
    let achievementRetryFlushPromise = null;
    ${client.slice(start, end)}
    globalThis.__achievementQueueApi = {
      achievementRetryOwnerMatches,
      bindPendingAchievementRetryRecords,
      currentAchievementOwner,
      flushAchievementRetryQueue,
      readAchievementRetryQueue,
      sanitizeAchievementRetryRecord,
      upsertAchievementRetryRecord,
      writeAchievementRetryQueue,
    };
  `, context);
  return {
    api: context.__achievementQueueApi,
    auth,
    calls,
    events,
    state,
    storage,
    setActionHandler(nextHandler) {
      handler = nextHandler;
    },
  };
}

function plainQueue(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  assert.match(cosmetics, /ai_training_style_crimson_azure/);
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
  assert.match(client, /ai-text-training-cosmetics-v2/);
  assert.match(online, /ai-text-training-cosmetics-v2/);
  assert.match(html, /ai-text-training-customization-v2/);
  assert.match(
    trainingStyles,
    /\[data-att-panel-theme="ai_training_style_crimson_azure"\][\s\S]*?#ff2b3d[\s\S]*?#1688ff/,
  );
  assert.match(
    trainingStyles,
    /\[data-att-message-decoration="ai_training_style_crimson_azure"\][\s\S]*?rgba\(5, 8, 16, 0\.96\)/,
  );
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

test("achievement tracking begins once at the first countdown and survives paid recovery", () => {
  assert.match(client, /httpsCallable\(functions, "economyAction"\)/);
  assert.match(client, /state\.achievementActionId = generatedActionId\("achievement_session"\)/);
  assert.match(client, /achievementActionId: state\.achievementActionId/);
  assert.match(client, /achievementSessionId: state\.achievementSessionId/);
  assert.match(client, /achievementBeginRequested: state\.achievementBeginRequested/);

  const beginStart = client.indexOf("function beginAchievementTracking");
  const beginEnd = client.indexOf("function startRoundCountdown", beginStart);
  const begin = client.slice(beginStart, beginEnd);
  assert.match(begin, /state\.preview/);
  assert.match(begin, /state\.roundIndex !== 0/);
  assert.match(begin, /state\.achievementBeginRequested/);
  assert.match(begin, /state\.achievementBeginRequested = true/);
  assert.match(begin, /flushAchievementRetryQueue\(\)/);
  assert.match(
    client,
    /function startRoundCountdown\(\)[\s\S]*?beginAchievementTracking\(\)/,
  );

  const flushStart = client.indexOf("function flushAchievementRetryQueue");
  const flushEnd = client.indexOf("function createState", flushStart);
  const flush = client.slice(flushStart, flushEnd);
  assert.match(flush, /action: "begin_achievement_session"/);
  assert.match(flush, /actionId: record\.actionId/);
  assert.match(flush, /modeId: record\.modeId/);
  assert.match(flush, /roundSeconds: record\.roundSeconds/);
  assert.match(flush, /response\.data\?\.session\?\.id/);

  const recoveryStart = client.indexOf("function recoverPaidSession");
  const recoveryEnd = client.indexOf("function start()", recoveryStart);
  const recovery = client.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /saved\.achievementActionId/);
  assert.match(recovery, /saved\.achievementSessionId/);
  assert.match(recovery, /saved\.achievementBeginRequested === true/);
  assert.match(recovery, /upsertAchievementRetryRecord/);
});

test("achievement retry storage is an allowlisted metadata-only queue", () => {
  assert.match(
    client,
    /const ACHIEVEMENT_RETRY_QUEUE_KEY = "hariai-ai-text-training-achievement-retry-v1"/,
  );
  const sanitizeStart = client.indexOf("function sanitizeAchievementRetryRecord");
  const sanitizeEnd = client.indexOf("function readAchievementRetryQueue", sanitizeStart);
  const sanitize = client.slice(sanitizeStart, sanitizeEnd);
  for (const field of [
    "ownerState",
    "ownerUid",
    "actionId",
    "modeId",
    "roundSeconds",
    "sessionId",
    "outcome",
    "completedRounds",
    "activeSeconds",
  ]) {
    assert.match(sanitize, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.doesNotMatch(
    sanitize,
    /\b(?:images?|bpms?|preset|script|lines?|dialogue|message|cosmetics?)\b/iu,
  );
  assert.match(client, /writeLocalValue\(ACHIEVEMENT_RETRY_QUEUE_KEY, JSON\.stringify\(sanitized\)\)/);
  assert.match(client, /\.slice\(-12\)/);
});

test("achievement retry records bind pending ownership once and never cross Firebase UIDs", async () => {
  const storage = new Map();
  const actionId = "achievement_session_runtime_owner_001";
  const pendingHarness = achievementQueueHarness({ storage });
  pendingHarness.api.upsertAchievementRetryRecord({
    ownerState: "pending",
    ownerUid: "",
    actionId,
    modeId: "mama",
    roundSeconds: 20,
    sessionId: "",
    outcome: "exited",
    completedRounds: 2,
    activeSeconds: 31.25,
    images: ["never-store"],
    bpms: [160],
    script: { lines: ["never-store"] },
    dialogue: "never-store",
  });
  assert.deepEqual(plainQueue(pendingHarness.api.readAchievementRetryQueue()), [{
    ownerState: "pending",
    ownerUid: "",
    actionId,
    modeId: "mama",
    roundSeconds: 20,
    sessionId: "",
    outcome: "exited",
    completedRounds: 2,
    activeSeconds: 31.25,
  }]);
  const serializedPending = storage.get("hariai-ai-text-training-achievement-retry-v1");
  assert.doesNotMatch(serializedPending, /images|bpms|script|lines|dialogue|never-store/u);

  const ownerAHarness = achievementQueueHarness({
    storage,
    uid: "firebase-uid-A",
    actionHandler: async () => {
      throw new Error("first network failure");
    },
  });
  assert.equal(await ownerAHarness.api.flushAchievementRetryQueue(), false);
  assert.equal(ownerAHarness.calls.length, 1);
  assert.deepEqual(
    plainQueue(ownerAHarness.api.readAchievementRetryQueue())
      .map(({ ownerState, ownerUid }) => ({ ownerState, ownerUid })),
    [{ ownerState: "bound", ownerUid: "firebase-uid-A" }],
  );

  const ownerBHarness = achievementQueueHarness({
    storage,
    uid: "firebase-uid-B",
  });
  assert.equal(await ownerBHarness.api.flushAchievementRetryQueue(), true);
  assert.equal(ownerBHarness.calls.length, 0);
  const boundToA = ownerBHarness.api.readAchievementRetryQueue()[0];
  ownerBHarness.api.upsertAchievementRetryRecord({
    ...boundToA,
    ownerState: "bound",
    ownerUid: "firebase-uid-B",
  });
  assert.equal(
    ownerBHarness.api.readAchievementRetryQueue()[0].ownerUid,
    "firebase-uid-A",
  );

  const reloadedOwnerAHarness = achievementQueueHarness({
    storage,
    uid: "firebase-uid-A",
  });
  assert.equal(await reloadedOwnerAHarness.api.flushAchievementRetryQueue(), true);
  assert.deepEqual(
    reloadedOwnerAHarness.calls.map(({ action, uid: callUid }) => [action, callUid]),
    [
      ["begin_achievement_session", "firebase-uid-A"],
      ["finish_achievement_session", "firebase-uid-A"],
    ],
  );
  assert.deepEqual(plainQueue(reloadedOwnerAHarness.api.readAchievementRetryQueue()), []);
});

test("starting a new session only supersedes unfinished records for the same owner", () => {
  const harness = achievementQueueHarness({ uid: "firebase-uid-A" });
  const boundA = { ownerState: "bound", ownerUid: "firebase-uid-A" };
  const boundB = { ownerState: "bound", ownerUid: "firebase-uid-B" };
  const pending = { ownerState: "pending", ownerUid: "" };
  assert.equal(harness.api.achievementRetryOwnerMatches(boundA, boundA), true);
  assert.equal(harness.api.achievementRetryOwnerMatches(boundB, boundA), false);
  assert.equal(harness.api.achievementRetryOwnerMatches(pending, boundA), false);
  assert.equal(harness.api.achievementRetryOwnerMatches(pending, pending), true);

  const beginStart = client.indexOf("function beginAchievementTracking");
  const beginEnd = client.indexOf("function startRoundCountdown", beginStart);
  const begin = client.slice(beginStart, beginEnd);
  assert.match(begin, /achievementRetryOwnerMatches\(record, currentOwner\)/);
});

test("achievement retry continues past mismatched owners and a failed earlier record", async () => {
  const storage = new Map();
  const ownerAHarness = achievementQueueHarness({ storage, uid: "firebase-uid-A" });
  const records = [
    {
      ownerState: "bound",
      ownerUid: "firebase-uid-A",
      actionId: "achievement_session_runtime_order_A1",
      modeId: "mama",
      roundSeconds: 20,
      sessionId: "1".repeat(40),
      outcome: "exited",
      completedRounds: 1,
      activeSeconds: 10,
    },
    {
      ownerState: "bound",
      ownerUid: "firebase-uid-B",
      actionId: "achievement_session_runtime_order_B1",
      modeId: "imouto",
      roundSeconds: 30,
      sessionId: "b".repeat(40),
      outcome: "safety_stopped",
      completedRounds: 2,
      activeSeconds: 44,
    },
    {
      ownerState: "bound",
      ownerUid: "firebase-uid-A",
      actionId: "achievement_session_runtime_order_A2",
      modeId: "oneechan",
      roundSeconds: 15,
      sessionId: "2".repeat(40),
      outcome: "exited",
      completedRounds: 3,
      activeSeconds: 42,
    },
  ];
  ownerAHarness.api.writeAchievementRetryQueue(records);
  ownerAHarness.setActionHandler(async (payload) => {
    if (payload.sessionId === "1".repeat(40)) throw new Error("record A1 failed");
    return { data: { session: { id: payload.sessionId }, newlyUnlocked: [] } };
  });
  assert.equal(await ownerAHarness.api.flushAchievementRetryQueue(), false);
  assert.deepEqual(
    ownerAHarness.calls.map(({ sessionId, uid: callUid }) => [sessionId, callUid]),
    [
      ["1".repeat(40), "firebase-uid-A"],
      ["2".repeat(40), "firebase-uid-A"],
    ],
  );
  assert.deepEqual(
    plainQueue(ownerAHarness.api.readAchievementRetryQueue())
      .map(({ actionId }) => actionId),
    [
      "achievement_session_runtime_order_A1",
      "achievement_session_runtime_order_B1",
    ],
  );

  const ownerBHarness = achievementQueueHarness({
    storage,
    uid: "firebase-uid-B",
  });
  assert.equal(await ownerBHarness.api.flushAchievementRetryQueue(), true);
  assert.deepEqual(
    ownerBHarness.calls.map(({ sessionId, uid: callUid }) => [sessionId, callUid]),
    [["b".repeat(40), "firebase-uid-B"]],
  );
  assert.deepEqual(
    plainQueue(ownerBHarness.api.readAchievementRetryQueue())
      .map(({ actionId }) => actionId),
    ["achievement_session_runtime_order_A1"],
  );

  const retryOwnerAHarness = achievementQueueHarness({
    storage,
    uid: "firebase-uid-A",
  });
  assert.equal(await retryOwnerAHarness.api.flushAchievementRetryQueue(), true);
  assert.deepEqual(plainQueue(retryOwnerAHarness.api.readAchievementRetryQueue()), []);
});

test("every started outcome queues an independent achievement finish without blocking exercise", () => {
  const finishQueueStart = client.indexOf("function queueAchievementFinish");
  const finishQueueEnd = client.indexOf("async function finishPaidUse", finishQueueStart);
  const finishQueue = client.slice(finishQueueStart, finishQueueEnd);
  assert.match(finishQueue, /\["completed", "safety_stopped", "exited"\]/);
  assert.match(finishQueue, /completedRounds/);
  assert.match(finishQueue, /activeSeconds/);
  assert.match(finishQueue, /upsertAchievementRetryRecord/);

  const flushStart = client.indexOf("function flushAchievementRetryQueue");
  const flushEnd = client.indexOf("function createState", flushStart);
  const flush = client.slice(flushStart, flushEnd);
  assert.match(flush, /action: "finish_achievement_session"/);
  assert.match(flush, /sessionId: record\.sessionId/);
  assert.match(flush, /outcome: record\.outcome/);
  assert.match(flush, /completedRounds: record\.completedRounds/);
  assert.match(flush, /activeSeconds: record\.activeSeconds/);

  const completeStart = client.indexOf("function completeSession");
  const completeEnd = client.indexOf("function emergencyStop", completeStart);
  const complete = client.slice(completeStart, completeEnd);
  assert.match(complete, /queueAchievementFinish\(outcome\)/);
  assert.match(complete, /flushAchievementRetryQueue\(\)\.catch/);
  assert.match(complete, /finishPaidUse\(outcome\)\.finally/);
  assert.ok(
    complete.indexOf("queueAchievementFinish(outcome)") < complete.indexOf("finishPaidUse(outcome)"),
  );
  assert.match(
    client,
    /function requestHome\(\)[\s\S]*?completeSession\("exited"\)/,
  );
});

test("achievement unlocks use the shared event and best-effort acknowledgement", () => {
  const notifyStart = client.indexOf("function notifyAchievementUnlocks");
  const notifyEnd = client.indexOf("function flushAchievementRetryQueue", notifyStart);
  const notify = client.slice(notifyStart, notifyEnd);
  assert.match(notify, /hariai-achievements-unlocked/);
  assert.match(notify, /action: "ack_achievements"/);
  assert.match(notify, /achievementIds: ids/);
  assert.match(notify, /\.catch\(\(\) =>/);
  assert.match(client, /notifyAchievementUnlocks\(response\.data\?\.newlyUnlocked\)/);
});

test("setup and result explain verified completion, safe non-progress, and manual retry", () => {
  assert.match(client, /カメラや動作判定は使いません/);
  assert.match(client, /5ラウンド完走だけが実績へ加算/);
  assert.match(client, /安全停止・途中終了で今までの進捗は減りません/);
  assert.match(client, /解除済み実績や既存の進捗も減りません/);
  assert.match(client, /画像・BPM・台詞を含まない最小限の記録/);
  assert.match(client, /data-ai-text-training-action="retry-achievement-finish"/);
  assert.match(client, /"retry-achievement-finish": retryAchievementFinish/);
  assert.match(client, /次回接続時にも再送します/);
  assert.match(client, /if \(state\.preview[\s\S]*?return;/);
});

test("achievement documentation fixes collection boundaries and migration policy", () => {
  assert.match(design, /aiTextTrainingAchievementSessions\/\{sessionId\}/);
  assert.match(design, /aiTextTrainingActiveAchievementSessions\/\{uid\}/);
  assert.match(design, /aiTextTrainingPlayerStats\/\{uid\}/);
  assert.match(design, /begin_achievement_session \{ actionId, modeId, roundSeconds \}/);
  assert.match(
    design,
    /finish_achievement_session \{ sessionId, outcome, completedRounds, activeSeconds \}/,
  );
  assert.match(design, /導入前の無料トレーニング[\s\S]*?遡及加算しない/);
  assert.match(design, /aiTextTrainingSellerStats[\s\S]*?再評価/);
  assert.match(design, /ownerState \/ ownerUid/);
  assert.match(design, /最初に確定したUIDへ一度だけ束縛/);
  assert.match(design, /現在の認証UIDと一致する記録だけを送る/);
  assert.match(readme, /旧版の無料プレイ履歴は安全に再構成できないため遡及せず/);
  assert.match(readme, /台本販売は既存の`aiTextTrainingSellerStats`を再評価/);
  assert.match(html, /achievements\.js\?v=[^"]*ai-text-training-v1/);
  assert.match(html, /ai-text-training\.js\?v=[^"]*achievements-v1/);
});

test("the client accepts 5-10 roster images, reviews every larger DRAW, and uses the exact remaining five for a 10-card second leg", async () => {
  const roster = await rosterModule;
  for (let count = 5; count <= 10; count += 1) {
    assert.equal(roster.isAiTextTrainingRosterCount(count), true);
  }
  assert.equal(roster.isAiTextTrainingRosterCount(4), false);
  assert.equal(roster.isAiTextTrainingRosterCount(11), false);

  const firstLeg = [9, 2, 7, 0, 4];
  const secondLeg = roster.drawAiTextTrainingRosterIndices({
    rosterCount: 10,
    previousIndices: firstLeg,
    rng: () => 0.375,
  });
  assert.deepEqual(
    [...secondLeg].sort((left, right) => left - right),
    [1, 3, 5, 6, 8],
  );
  assert.equal(new Set([...firstLeg, ...secondLeg]).size, 10);
  assert.equal(
    roster.normalizeAiTextTrainingDrawIndices([0, 1, 2, 3, 3], 10),
    null,
  );

  const prepare = sourceBlock(
    client,
    "function prepareStartSession",
    "async function saveCosmetics",
  );
  assert.match(
    prepare,
    /entries\.length > AI_TEXT_TRAINING_ROUND_COUNT[\s\S]*?state\.screen = "draw_review"[\s\S]*?return;/,
  );
  assert.match(
    prepare,
    /entries\.length > AI_TEXT_TRAINING_ROUND_COUNT[\s\S]*?drawAiTextTrainingRosterIndices/,
  );
  assert.match(
    prepare,
    /state\.pendingDrawIndices = Array\.from\([\s\S]*?continuePreparedSession\(\)/,
  );

  const drawReview = sourceBlock(client, "function renderDrawReview", "function marketPresetCard");
  assert.match(drawReview, /normalizeAiTextTrainingDrawIndices/);
  assert.match(drawReview, /data-ai-text-training-action="confirm-draw"/);
  assert.match(drawReview, /支払い確認で同意し、実際に利用開始が成立した時だけ消費/);

  const replay = sourceBlock(client, "function resetForAnotherSession", "function requestHome");
  assert.match(
    replay,
    /rosterCount: entries\.length,[\s\S]*?previousIndices: previousDrawIndices/,
  );
  assert.match(
    replay,
    /entries\.length === AI_TEXT_TRAINING_ROSTER_MAX_COUNT \? 2 : 1/,
  );
});

test("active paid uses can only resume their confirmed DRAW and never expose or execute redraw", () => {
  const drawReview = sourceBlock(client, "function renderDrawReview", "function marketPresetCard");
  assert.match(
    drawReview,
    /state\.activeUse \|\| \(state\.drawLeg === 2 && entries\.length === AI_TEXT_TRAINING_ROSTER_MAX_COUNT\) \? "" : [\s\S]*?data-ai-text-training-action="redraw"/,
  );

  const prepare = sourceBlock(
    client,
    "function prepareStartSession",
    "async function saveCosmetics",
  );
  assert.match(
    prepare,
    /if \(state\.activeUse\)[\s\S]*?recoverPaidSession\(\)[\s\S]*?state\.screen = "play"[\s\S]*?return;/,
  );
  assert.match(
    prepare,
    /DRAW結果と追加請求は変わりません/,
  );

  const actionHandlers = sourceBlock(
    client,
    "const actionHandlers = {",
    'document.querySelectorAll("[data-ai-text-training-action]")',
  );
  assert.match(
    actionHandlers,
    /redraw: \(\) => \{[\s\S]*?if \(state\.activeUse\)[\s\S]*?確定したDRAWを変更できません/,
  );
  assert.match(actionHandlers, /"confirm-draw": continuePreparedSession/);
});

test("stored deck and recovery normalizers execute v1/v2 compatibility and reject corrupt state", async () => {
  const [core, roster] = await Promise.all([coreModule, rosterModule]);

  const deckContext = vm.createContext({
    DECK_SCHEMA_VERSION: 2,
    AI_TEXT_TRAINING_ROUND_COUNT: core.AI_TEXT_TRAINING_ROUND_COUNT,
    isAiTextTrainingRosterCount: roster.isAiTextTrainingRosterCount,
    normalizeAiTextTrainingBpm: core.normalizeAiTextTrainingBpm,
  });
  vm.runInContext(`
    ${sourceBlock(
      client,
      "function normalizeStoredRosterRecord",
      "async function restoreStoredDeck",
    )}
    globalThis.__normalizeStoredRosterRecord = normalizeStoredRosterRecord;
  `, deckContext);
  const normalizeDeck = deckContext.__normalizeStoredRosterRecord;
  const deck = (schemaVersion, count) => ({
    schemaVersion,
    items: Array.from({ length: count }, (_, index) => ({
      blob: { index },
      bpm: index === 0 ? 0 : 80 + index,
    })),
    updatedAt: 123,
  });
  const legacyFive = normalizeDeck(deck(1, 5));
  const currentTen = normalizeDeck(deck(2, 10));
  assert.equal(legacyFive?.schemaVersion, 1);
  assert.equal(legacyFive?.items.length, 5);
  assert.equal(currentTen?.schemaVersion, 2);
  assert.equal(currentTen?.items.length, 10);
  assert.equal(normalizeDeck(deck(1, 10)), null);
  assert.equal(normalizeDeck(deck(2, 4)), null);
  assert.equal(normalizeDeck(deck(2, 11)), null);
  const badBpmDeck = deck(2, 5);
  badBpmDeck.items[2].bpm = 161;
  assert.equal(normalizeDeck(badBpmDeck), null);

  let storedValue = "null";
  const sessionContext = vm.createContext({
    SESSION_SCHEMA_VERSION: 2,
    SESSION_STORAGE_KEY: "session",
    readLocalValue: () => storedValue,
  });
  vm.runInContext(`
    ${sourceBlock(client, "function storedSession", "function normalizeAchievementOwnerUid")}
    globalThis.__storedSession = storedSession;
  `, sessionContext);
  storedValue = JSON.stringify({ schemaVersion: 1, plan: { schemaVersion: 1 } });
  assert.equal(sessionContext.__storedSession()?.schemaVersion, 1);
  storedValue = JSON.stringify({ schemaVersion: 2, plan: { schemaVersion: 1 } });
  assert.equal(sessionContext.__storedSession()?.schemaVersion, 2);
  storedValue = JSON.stringify({ schemaVersion: 3 });
  assert.equal(sessionContext.__storedSession(), null);
  storedValue = "{broken-json";
  assert.equal(sessionContext.__storedSession(), null);

  const planContext = vm.createContext({
    AI_TEXT_TRAINING_MODES: core.AI_TEXT_TRAINING_MODES,
    AI_TEXT_TRAINING_REACTIONS: core.AI_TEXT_TRAINING_REACTIONS,
    AI_TEXT_TRAINING_ROUND_COUNT: core.AI_TEXT_TRAINING_ROUND_COUNT,
    applyAiTextTrainingReaction: core.applyAiTextTrainingReaction,
    normalizeAiTextTrainingBpm: core.normalizeAiTextTrainingBpm,
  });
  vm.runInContext(`
    ${sourceBlock(client, "function normalizeRecoveredPlan", "function recoverPaidSession")}
    globalThis.__normalizeRecoveredPlan = normalizeRecoveredPlan;
  `, planContext);
  const normalizePlan = planContext.__normalizeRecoveredPlan;
  const bpms = [80, 90, 100, 110, 120];
  const validPlan = core.createAiTextTrainingPlan({
    modeId: "mama",
    bpms,
    randomValues: [0.1, 0.3, 0.5, 0.7],
  });
  core.applyAiTextTrainingReaction(validPlan, 0, "just_right");
  core.applyAiTextTrainingReaction(validPlan, 1, "just_right");
  const normalizedPlan = normalizePlan(validPlan, {
    modeId: "mama",
    bpms,
    roundIndex: 2,
  });
  assert.equal(normalizedPlan.modeId, "mama");
  assert.deepEqual(Array.from(normalizedPlan.baseBpms), bpms);
  assert.throws(
    () => normalizePlan({ ...validPlan, baseBpms: [80, 90, 100, 110] }, {
      modeId: "mama",
      bpms,
      roundIndex: 2,
    }),
    /保存されたトレーニング計画/,
  );
  assert.throws(
    () => normalizePlan({
      ...validPlan,
      effectiveBpms: [80, 90, null, 110, 120],
    }, {
      modeId: "mama",
      bpms,
      roundIndex: 2,
    }),
    /保存された実効BPM/,
  );
  assert.throws(
    () => normalizePlan({
      ...validPlan,
      reactions: ["not-a-reaction", null, null, null, null],
    }, {
      modeId: "mama",
      bpms,
      roundIndex: 2,
    }),
    /保存された体感回答/,
  );

  const recovery = sourceBlock(client, "function recoverPaidSession", "function start()");
  assert.match(
    recovery,
    /savedSchemaVersion === SESSION_SCHEMA_VERSION[\s\S]*?\? isAiTextTrainingRosterCount\(saved\.rosterCount\)[\s\S]*?: null[\s\S]*?: AI_TEXT_TRAINING_ROUND_COUNT/,
  );
  assert.match(
    recovery,
    /saved\.modeId !== activeModeId[\s\S]*?!\["", "completed", "safety_stopped", "exited"\]\.includes\(savedResultOutcome\)/,
  );
  assert.match(
    recovery,
    /savedSchemaVersion === SESSION_SCHEMA_VERSION[\s\S]*?savedRosterCount === null \|\| savedDrawIndices === null[\s\S]*?throw new Error\("保存されたDRAWを確認できません。"\)/,
  );
  assert.match(
    recovery,
    /savedSchemaVersion === SESSION_SCHEMA_VERSION[\s\S]*?savedDrawIndices && entries\.length === savedRosterCount/,
  );
  assert.match(
    recovery,
    /: entries\.length >= AI_TEXT_TRAINING_ROUND_COUNT[\s\S]*?Array\.from/,
  );
  assert.match(
    recovery,
    /catch \{[\s\S]*?state\.plan = null;[\s\S]*?state\.sessionDrawIndices = \[\];[\s\S]*?state\.recoveryError = "端末に残った開始済み利用の計画またはDRAWを確認できません。";[\s\S]*?return false;/,
  );
  assert.match(
    client,
    /if \(!recovered && state\.recoveryError\) \{[\s\S]*?確定済み利用の内容を変更せず停止しています。/,
  );
});

test("paid consumption starts only after DRAW confirmation and a replay requires a fresh review", () => {
  const prepare = sourceBlock(
    client,
    "function prepareStartSession",
    "async function saveCosmetics",
  );
  const continueSession = sourceBlock(
    client,
    "function continuePreparedSession",
    "function prepareStartSession",
  );
  const confirmPurchase = sourceBlock(
    client,
    "async function confirmPaidUse",
    "async function previewBeatCharacter",
  );
  const replay = sourceBlock(client, "function resetForAnotherSession", "function requestHome");
  const actionHandlers = sourceBlock(
    client,
    "const actionHandlers = {",
    'document.querySelectorAll("[data-ai-text-training-action]")',
  );

  assert.doesNotMatch(prepare, /start_paid_use/);
  assert.doesNotMatch(continueSession, /start_paid_use/);
  assert.match(actionHandlers, /"confirm-draw": continuePreparedSession/);
  assert.match(
    continueSession,
    /currentPendingDrawIndices\(\)[\s\S]*?state\.pendingPaidPreset = state\.selectedPreset;[\s\S]*?state\.purchaseActionId = "";[\s\S]*?state\.screen = "purchase_review"/,
  );
  assert.match(confirmPurchase, /if \(!consent\?\.checked\)[\s\S]*?return;/);
  assert.ok(
    confirmPurchase.indexOf("if (!state.purchaseActionId)")
      < confirmPurchase.indexOf('action: "start_paid_use"'),
  );
  assert.match(
    replay,
    /repeatPaidPreset[\s\S]*?state\.selectedPreset = previousPreset;[\s\S]*?state\.selectedPresetSource = "market"/,
  );
});

test("a safety stop offers no replay CTA while preserving a home exit", () => {
  const result = sourceBlock(client, "function renderResult()", "function render()");
  assert.match(
    result,
    /const replayAllowed = state\.resultOutcome !== "safety_stopped"/,
  );
  assert.match(
    result,
    /\$\{replayAllowed \? `<button[\s\S]*?data-ai-text-training-action="setup-after-result"[\s\S]*?` : ""\}/,
  );
  assert.match(
    result,
    /const alternateDrawAllowed = state\.resultOutcome === "completed"/,
  );
  assert.match(
    result,
    /\$\{alternateDrawAllowed \? `<button[\s\S]*?data-ai-text-training-action="alternate-draw-after-result"[\s\S]*?` : ""\}/,
  );
  assert.match(result, /data-ai-text-training-action="home"/);
});

test("five explicit beat auditions freeze into the session and every round requests a fresh phase", async () => {
  const ambience = await ambienceModule;
  const definitions = sourceBlock(
    client,
    "const AI_TEXT_TRAINING_BEAT_CHARACTERS",
    "const DEFAULT_BEAT_CHARACTER_ID",
  );
  const clientIds = Array.from(
    definitions.matchAll(/\bid:\s*"([a-z_]+)"/gu),
    (match) => match[1],
  );
  assert.deepEqual(clientIds, [...ambience.FREE_TABLE_AMBIENCE_TONE_PROFILE_IDS]);
  assert.equal(clientIds.length, 5);
  assert.equal(
    ambience.normalizeFreeTableAmbienceToneProfileId("unknown-tone"),
    ambience.FREE_TABLE_AMBIENCE_DEFAULT_TONE_PROFILE_ID,
  );

  const beatCard = sourceBlock(client, "function beatCharacterCard", "function renderBeatCharacterPanel");
  assert.match(beatCard, /aria-hidden="true"/);
  assert.match(beatCard, /data-ai-text-training-preview-beat/);
  assert.match(beatCard, /aria-label="\$\{escapeHtml\(character\.label\)\}を試聴"/);
  assert.match(beatCard, />音を試す</);

  const preview = sourceBlock(
    client,
    "async function previewBeatCharacter",
    "function configureRoundAmbience",
  );
  assert.match(preview, /if \(state\.screen !== "setup"\) return/);
  assert.match(preview, /state\.ambienceController\.enable\(\)/);
  assert.match(preview, /rephase: true/);

  const newSession = sourceBlock(
    client,
    "function newSessionPlan",
    "function continuePreparedSession",
  );
  assert.match(
    newSession,
    /state\.sessionBeatCharacterId = normalizeBeatCharacterId\(state\.beatCharacterId\)/,
  );
  const roundAmbience = sourceBlock(
    client,
    "function configureRoundAmbience",
    "function announce(",
  );
  assert.match(roundAmbience, /state\.sessionBeatCharacterId/);
  assert.match(roundAmbience, /rephase: true/);

  const eventBinding = sourceBlock(
    client,
    "function bindEvents",
    'document.addEventListener("visibilitychange"',
  );
  const beatChoiceStart = eventBinding.indexOf('input[name="aiTextTrainingBeatCharacter"]');
  const beatPreviewStart = eventBinding.indexOf("[data-ai-text-training-preview-beat]");
  assert.ok(beatChoiceStart >= 0 && beatPreviewStart > beatChoiceStart);
  const beatChoiceBinding = eventBinding.slice(beatChoiceStart, beatPreviewStart);
  assert.match(beatChoiceBinding, /state\.beatCharacterId = normalizeBeatCharacterId/);
  assert.doesNotMatch(beatChoiceBinding, /previewBeatCharacter|ambienceController\.enable/);
  assert.match(
    eventBinding.slice(beatPreviewStart),
    /previewBeatCharacter\(button\.dataset\.aiTextTrainingPreviewBeat\)/,
  );

  assert.match(
    ambienceSource,
    /const shouldRephase = rephase === true;[\s\S]*?nextMetronomeBpm === previousMetronomeBpm[\s\S]*?!shouldRephase/,
  );
  assert.match(
    ambienceSource,
    /shouldRephase[\s\S]*?installRephasedAmbience\(nextAmbience\)/,
  );
});

test("DRAW, playback, and motion fallbacks expose the necessary accessibility contract", () => {
  assert.match(
    client,
    /id="aiTextTrainingAnnouncer" role="status" aria-live="polite" aria-atomic="true"/,
  );
  assert.match(
    client,
    /aria-label="対戦候補\$\{index \+ 1\}の画像を\$\{item \? "差し替える" : "選ぶ"\}"/,
  );
  assert.match(client, /aria-label="対戦候補\$\{index \+ 1\}を外す"/);
  assert.match(client, /alt="DRAWされたラウンド\$\{roundIndex \+ 1\}の画像"/);
  assert.match(client, /aria-label="今回DRAWされた5枚"/);
  assert.match(client, /class="ai-text-training-progress" aria-hidden="true"/);
  assert.match(client, /class="ai-text-training-vignette" aria-hidden="true"/);
  assert.match(
    client,
    /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\?\.matches[\s\S]*?behavior: reducedMotion \? "auto" : "smooth"/,
  );
  assert.match(
    trainingStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important;[\s\S]*?transition-duration: 0\.01ms !important;/,
  );
  assert.match(
    trainingStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ai-text-training-countdown\s*\{[\s\S]*?animation: none;/,
  );
});

test("authentication must settle before start, and both authentication outcomes release the gate", async () => {
  const setup = sourceBlock(client, "function renderSetup", "function drawReviewCard");
  assert.match(setup, /const authChecking = !state\.preview && !state\.authSettled/);
  assert.match(
    setup,
    /const startReady = imagesReady && !state\.cosmeticDraft && !authChecking/,
  );
  assert.match(
    setup,
    /data-ai-text-training-action="start-session" \$\{startReady \? "" : "disabled"\}/,
  );

  let validateRosterCalls = 0;
  const prepareContext = vm.createContext({
    state: {
      preview: "",
      authSettled: false,
      beatPreviewTimer: null,
      ambienceController: { disable() {} },
    },
    window: { clearTimeout() {} },
    validateRoster() {
      validateRosterCalls += 1;
      return [];
    },
  });
  vm.runInContext(`
    ${sourceBlock(client, "function prepareStartSession", "async function saveCosmetics")}
    globalThis.__prepareStartSession = prepareStartSession;
  `, prepareContext);
  assert.throws(
    () => prepareContext.__prepareStartSession(),
    /開始済みの有料応援と残高の確認が終わるまで/,
  );
  assert.equal(validateRosterCalls, 0);

  const initializeSource = sourceBlock(
    client,
    "async function initializeAuthenticatedState",
    "function normalizeRecoveredPlan",
  );
  async function runAuthentication({ failure = null } = {}) {
    const calls = { recover: 0, render: 0 };
    const targetState = {
      modeId: "mama",
      marketModeFilter: "mama",
      authReady: false,
      authSettled: false,
      authError: "",
      balance: 0,
      policy: {},
      marketPresets: [],
      ownPresets: [],
      profile: {},
      cosmetics: {},
      activeUse: null,
      paidUseId: "",
      unsubscribeWallet: null,
    };
    const context = vm.createContext({
      active: true,
      state: targetState,
      auth: { currentUser: null },
      browserLocalPersistence: {},
      firestore: {},
      setPersistence: async () => {
        if (failure === "persistence") throw new Error("auth failed");
      },
      signInAnonymously: async () => ({ user: { uid: "runtime-user" } }),
      aiTextTrainingAction: async () => ({
        data: {
          balance: 25,
          policy: { prices: [0, 5] },
          presets: [],
          ownPresets: [],
          profile: { xPublic: false, xHandle: "" },
          cosmetics: { ownedStyleIds: [] },
          activeUse: null,
        },
      }),
      normalizeServerCosmetics: (value) => value,
      presetSnapshot: (value) => value,
      storedSession: () => null,
      clearPersistedSession() {},
      doc: () => ({}),
      onSnapshot: () => () => {},
      document: { querySelectorAll: () => [] },
      restoreStoredDeck: async () => true,
      recoverPaidSession() {
        calls.recover += 1;
        return false;
      },
      render() {
        calls.render += 1;
      },
      flushAchievementRetryQueue: () => Promise.resolve(true),
    });
    vm.runInContext(`
      ${initializeSource}
      globalThis.__initializeAuthenticatedState = initializeAuthenticatedState;
    `, context);
    await context.__initializeAuthenticatedState(targetState);
    return { calls, targetState };
  }

  const success = await runAuthentication();
  assert.equal(success.targetState.authReady, true);
  assert.equal(success.targetState.authSettled, true);
  assert.equal(success.targetState.authError, "");
  assert.equal(success.calls.recover, 1);
  assert.equal(success.calls.render, 1);

  const failure = await runAuthentication({ failure: "persistence" });
  assert.equal(failure.targetState.authReady, false);
  assert.equal(failure.targetState.authSettled, true);
  assert.equal(failure.targetState.authError, "auth failed");
  assert.equal(failure.calls.recover, 0);
  assert.equal(failure.calls.render, 1);
});

test("an awaited stored-deck restore revalidates every setup identity guard before mutating UI state", async () => {
  const restoreSource = sourceBlock(
    client,
    "async function restoreStoredDeck",
    "async function persistRosterIfConsented",
  );

  async function runRestoreRace(mutate) {
    const originalImages = Array.from({ length: 10 }, (_, index) => ({
      id: `original-${index}`,
    }));
    const targetState = {
      generation: 7,
      screen: "setup",
      plan: null,
      rosterImages: [...originalImages],
      rosterBpms: [80, 90, 100, 110, 120, 80, 90, 100, 110, 120],
      persistDeck: true,
      storedDeckAvailable: false,
      rosterExpanded: false,
    };
    let resolveRead;
    const readPromise = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const calls = {
      release: 0,
      invalidate: 0,
      render: 0,
      toast: 0,
    };
    const context = vm.createContext({
      active: true,
      state: targetState,
      AI_TEXT_TRAINING_ROSTER_MAX_COUNT: 10,
      AI_TEXT_TRAINING_ROUND_COUNT: 5,
      DEFAULT_ROSTER_BPMS: [80, 90, 100, 110, 120, 80, 90, 100, 110, 120],
      readStoredDeck: () => readPromise,
      normalizeStoredRosterRecord: (value) => value,
      normalizeAiTextTrainingBpm: (value) => Number(value),
      URL: { createObjectURL: () => "blob:stored" },
      releaseRosterImages() {
        calls.release += 1;
      },
      invalidatePendingDraw() {
        calls.invalidate += 1;
      },
      render() {
        calls.render += 1;
      },
      showToast() {
        calls.toast += 1;
      },
    });
    vm.runInContext(`
      ${restoreSource}
      globalThis.__restoreStoredDeck = restoreStoredDeck;
    `, context);

    const pending = context.__restoreStoredDeck({ quiet: true });
    mutate({ context, targetState });
    const currentState = context.state;
    const expectedImages = [...currentState.rosterImages];
    const expectedBpms = [...currentState.rosterBpms];
    const expectedScreen = currentState.screen;
    const expectedPlan = currentState.plan;
    resolveRead({
      schemaVersion: 2,
      items: Array.from({ length: 5 }, (_, index) => ({
        blob: { stored: index },
        bpm: 120 + index,
      })),
    });
    const result = await pending;
    assert.equal(result, false);
    assert.equal(context.state, currentState);
    assert.deepEqual([...currentState.rosterImages], expectedImages);
    assert.deepEqual([...currentState.rosterBpms], expectedBpms);
    assert.equal(currentState.screen, expectedScreen);
    assert.equal(currentState.plan, expectedPlan);
    assert.equal(currentState.storedDeckAvailable, false);
    assert.deepEqual(calls, {
      release: 0,
      invalidate: 0,
      render: 0,
      toast: 0,
    });
  }

  const replacementPlayState = {
    generation: 8,
    screen: "play",
    plan: { schemaVersion: 1 },
    rosterImages: Array.from({ length: 10 }, (_, index) => ({ id: `play-${index}` })),
    rosterBpms: [120, 120, 120, 120, 120, 80, 90, 100, 110, 120],
    persistDeck: true,
    storedDeckAvailable: false,
  };
  const races = [
    ({ context }) => {
      context.active = false;
    },
    ({ context }) => {
      context.state = replacementPlayState;
    },
    ({ targetState }) => {
      targetState.generation += 1;
    },
    ({ targetState }) => {
      targetState.screen = "play";
    },
    ({ targetState }) => {
      targetState.plan = { schemaVersion: 1 };
    },
    ({ targetState }) => {
      targetState.rosterImages[0] = { id: "new-user-image" };
    },
    ({ targetState }) => {
      targetState.rosterBpms[0] = 159;
    },
  ];
  for (const mutate of races) {
    await runRestoreRace(mutate);
  }
});

test("corrupt paid-use abandonment needs confirmation and returns successful exits to builtin support", async () => {
  const abandonSource = sourceBlock(
    client,
    "async function abandonCorruptPaidUse",
    "async function retryAchievementFinish",
  );
  const banner = sourceBlock(client, "function activeUseBanner", "function cosmeticOptionHtml");
  assert.match(
    banner,
    /state\.recoveryError[\s\S]*?data-ai-text-training-action="abandon-corrupt-paid-use"/,
  );
  const actionHandlers = sourceBlock(
    client,
    "const actionHandlers = {",
    'document.querySelectorAll("[data-ai-text-training-action]")',
  );
  assert.match(
    actionHandlers,
    /"abandon-corrupt-paid-use": abandonCorruptPaidUse/,
  );

  async function runAbandon({ confirmed, finishSucceeded = true }) {
    const calls = {
      confirms: [],
      outcomes: [],
      renders: 0,
      toasts: [],
    };
    const state = {
      activeUse: {
        id: "paid-use-runtime",
        preset: { title: "有料応援", modeId: "mama" },
      },
      recoveryError: "復旧できません。",
      finishInFlight: false,
      finishPending: false,
      paidUseId: "",
      pendingPaidPreset: { id: "paid-preset" },
      purchaseActionId: "previous-action",
      selectedPreset: { title: "有料応援", price: 10 },
      selectedPresetSource: "active_use",
      resultOutcome: "",
      modeId: "mama",
      screen: "setup",
    };
    const builtin = { title: "標準応援", price: 0, modeId: "mama" };
    const context = vm.createContext({
      active: true,
      state,
      window: {
        confirm(message) {
          calls.confirms.push(message);
          return confirmed;
        },
      },
      async finishPaidUse(outcome) {
        calls.outcomes.push(outcome);
        if (!finishSucceeded) return false;
        state.activeUse = null;
        state.paidUseId = "";
        return true;
      },
      render() {
        calls.renders += 1;
      },
      showToast(message) {
        calls.toasts.push(message);
      },
      normalizeAiTextTrainingScriptSnapshot: (value) => ({ ...value }),
      AI_TEXT_TRAINING_BUILTIN_SCRIPTS: { mama: builtin },
    });
    vm.runInContext(`
      ${abandonSource}
      globalThis.__abandonCorruptPaidUse = abandonCorruptPaidUse;
    `, context);
    await context.__abandonCorruptPaidUse();
    return { builtin, calls, state };
  }

  const declined = await runAbandon({ confirmed: false });
  assert.equal(declined.calls.confirms.length, 1);
  assert.match(declined.calls.confirms[0], /使い切りとなり返金されません/);
  assert.match(declined.calls.confirms[0], /新しい支払いは発生しません/);
  assert.deepEqual(declined.calls.outcomes, []);
  assert.equal(declined.state.selectedPresetSource, "active_use");

  const failed = await runAbandon({ confirmed: true, finishSucceeded: false });
  assert.deepEqual(failed.calls.outcomes, ["exited"]);
  assert.equal(failed.state.recoveryError, "復旧できません。");
  assert.equal(failed.state.selectedPresetSource, "active_use");
  assert.match(failed.calls.toasts[0], /通信を確認して再送/);

  const finished = await runAbandon({ confirmed: true });
  assert.deepEqual(finished.calls.outcomes, ["exited"]);
  assert.equal(finished.state.activeUse, null);
  assert.equal(finished.state.recoveryError, "");
  assert.equal(finished.state.selectedPresetSource, "builtin");
  assert.equal(finished.state.selectedPreset.title, finished.builtin.title);
  assert.equal(finished.state.pendingPaidPreset, null);
  assert.equal(finished.state.purchaseActionId, "");
  assert.equal(finished.state.screen, "setup");
});
