"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const client = read("ai-text-training.js");
const html = read("index.html");
const app = read("app.js");
const styles = read("styles.css");
const trainingStyles = read("ai-text-training.css");
const cosmetics = read("ai-text-training-cosmetics.js");
const online = read("online.js");
const readme = read("README.md");
const design = read("AI_TEXT_TRAINING_DESIGN.md");

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
