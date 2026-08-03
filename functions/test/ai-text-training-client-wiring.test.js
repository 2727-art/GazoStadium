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
const zoneVideoModule = import(pathToFileURL(path.join(root, "ai-text-training-zone-video.mjs")).href);

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

test("all three personalities, exact BPM boundary, and one immediate stop are visible", () => {
  const standardPlay = sourceBlock(client, "function renderPlay()", "function resultTitle");
  const immediateStop = sourceBlock(
    client,
    "function stopSessionImmediately",
    "function resetForAnotherSession",
  );
  assert.match(client, /AI_TEXT_TRAINING_MODES/);
  assert.match(client, /normalizeAiTextTrainingBpm/);
  assert.match(client, /0または40〜160/);
  assert.match(client, /お姉ちゃんモードでは「きつい」で次のBPMが速くなります/);
  assert.match(client, /無理・痛い・めまい／即停止/);
  assert.match(client, /data-ai-text-training-reaction/);
  assert.equal(standardPlay.match(/data-ai-text-training-action="stop-session"/gu)?.length, 1);
  assert.doesNotMatch(standardPlay, /data-ai-text-training-action="(?:pause|toggle-mute|exit-session)"/);
  assert.match(immediateStop, /completeSession\("exited"\)/);
  assert.doesNotMatch(immediateStop, /window\.confirm|safety_stopped/);
  assert.match(client, /"stop-session": stopSessionImmediately/);
  assert.match(client, /\["completed", "safety_stopped", "exited"\]/);
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

test("exercise choice is removed from presentation while legacy recovery stays compatible", () => {
  const setup = sourceBlock(client, "function renderSetup", "function drawReviewCard");
  const play = sourceBlock(client, "function renderPlay()", "function resultTitle");
  const recovery = sourceBlock(
    client,
    "function recoverPaidSession",
    "function recoverPendingDefeatPresentation",
  );

  assert.match(setup, /<span>STEP 3<\/span><h2>1ラウンドの長さ<\/h2>/);
  assert.doesNotMatch(setup, /aiTextTrainingExercise|AI_TEXT_TRAINING_EXERCISES|>運動</);
  assert.doesNotMatch(play, /aiTextTrainingExercise|ai-text-training-exercise/);
  assert.match(client, /exerciseId: "free"/);
  assert.match(recovery, /state\.exerciseId = saved\.exerciseId/);
  assert.match(
    trainingStyles,
    /\.ai-text-training-config-grid\.is-duration-only > fieldset\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/,
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
  const completeEnd = client.indexOf("function stopSessionImmediately", completeStart);
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
  assert.match(client, /未購入の装飾もここで試着できますが、装着は保存されません/);
  assert.match(client, /aiTextTrainingCosmeticsAreOwned/);
  assert.match(client, /action: "save_cosmetics"/);
  assert.match(client, /state\.sessionCosmetics = equippedCosmetics\(\)/);
  assert.match(client, /cosmetics: state\.sessionCosmetics/);
  assert.match(client, /data-att-panel-theme=/);
  assert.match(client, /data-att-message-decoration=/);
  assert.match(client, /ai-text-training-message-surface/);
  assert.match(client, /name="aiTextTrainingCheerPresentation"/);
  assert.match(client, /class="ai-text-training-cosmetic-preview-hud"/);
  assert.match(client, /デコ台詞 · 作品モード/);
  assert.match(client, /文字数によるクラシック枠への自動切替は行いません/);
  assert.match(client, /ai-text-training-cosmetics-v3/);
  assert.match(online, /ai-text-training-cosmetics-v3/);
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
  assert.match(trainingStyles, /\.ai-text-training-doodle-cheer[\s\S]*?pointer-events:\s*none/);
  assert.match(trainingStyles, /ai_training_style_crimson_azure[\s\S]*?--att-doodle-accent-a:\s*#ff2b3d[\s\S]*?--att-doodle-accent-b:\s*#1688ff/);
  assert.match(trainingStyles, /\.is-doodle\.is-collage\s*\{[\s\S]*?inset:\s*0;[\s\S]*?background:\s*transparent !important;/);
  assert.match(trainingStyles, /\.ai-text-training-opponent\s*\{[\s\S]*?isolation:\s*isolate;/);
  assert.match(trainingStyles, /\.is-doodle\.is-collage\s*\{[\s\S]*?z-index:\s*4;/);
  assert.match(trainingStyles, /\.is-doodle\.is-collage::before,[\s\S]*?\.is-doodle\.is-collage::after\s*\{[\s\S]*?content:\s*none !important;/);
  assert.match(trainingStyles, /\.ai-text-training-cosmetic-preview-window\s*\{[\s\S]*?aspect-ratio:\s*9 \/ 14;/);
  assert.match(trainingStyles, /\.ai-text-training-cosmetic-preview-hud\s*\{[\s\S]*?z-index:\s*5;/);
  assert.doesNotMatch(trainingStyles, /\.ai-text-training-cosmetic-preview-window > div > span/);
  assert.match(trainingStyles, /\.att-doodle-copy::before,[\s\S]*?content:\s*attr\(data-text\)/);
  assert.match(trainingStyles, /data-att-doodle-layout="center-vertical"/);
  assert.match(trainingStyles, /data-att-doodle-layout="diagonal-banner"/);
  assert.match(trainingStyles, /data-att-doodle-layout="twin-arch"/);
  assert.match(trainingStyles, /data-att-doodle-layout="edge-frame"/);
  assert.match(trainingStyles, /data-att-doodle-layout="cross-diagonal"/);
  assert.match(
    trainingStyles,
    /@media \(forced-colors: active\)[\s\S]*?\.is-doodle\.is-collage\s*\{[\s\S]*?background:\s*transparent !important;[\s\S]*?\.is-collage \.att-doodle-copy\s*\{[\s\S]*?background:\s*Canvas;/,
  );
  assert.match(
    trainingStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ai-text-training-doodle-cheer\.is-collage \.att-doodle-copy\s*\{[\s\S]*?animation:\s*none !important;/,
  );
  assert.match(online, /shop-ai-training-style-message is-doodle is-collage/);
  for (const styleId of [
    "ai_training_style_soft_glow",
    "ai_training_style_neon_beat",
    "ai_training_style_crimson_azure",
    "ai_training_style_stardust_stage",
  ]) {
    assert.match(
      trainingStyles,
      new RegExp(`data-att-message-decoration="${styleId}"\\]\\s*\\.ai-text-training-result-doodle\\.is-classic`, "u"),
    );
  }
  assert.match(
    trainingStyles,
    /\.ai-text-training-cosmetic-actions \.button\s*\{\s*flex:\s*0 0 auto;\s*min-height:\s*48px;/,
  );
  assert.doesNotMatch(
    trainingStyles,
    /\[data-att-(?:panel-theme|message-decoration)[^\{]*\{[^}]*\.ai-text-training-(?:emergency|safety-controls)/,
  );
});

test("doodle cheer composes every line as a stable full-image collage and records only completed works", () => {
  const doodleContext = vm.createContext({
    AI_TEXT_TRAINING_ROUND_COUNT: 5,
    CHEER_PRESENTATION_PREFERENCE_KEY: "cheer-mode",
    CHEER_PRESENTATIONS: new Set(["doodle", "classic"]),
    DEFAULT_CHEER_PRESENTATION: "doodle",
    DOODLE_MAX_GRAPHEMES: 84,
    DOODLE_ANCHORS: Object.freeze([
      "upper-left",
      "upper-right",
      "middle-left",
      "middle-right",
      "lower-left",
      "lower-right",
    ]),
    DOODLE_LAYOUTS: Object.freeze([
      "center-vertical",
      "diagonal-banner",
      "twin-arch",
      "edge-frame",
      "cross-diagonal",
    ]),
    state: {
      roundIndex: 0,
      sessionStartedAt: 1_754_108_400_000,
      sessionCheerPresentation: "doodle",
    },
    readLocalValue(_key, fallback) {
      return fallback;
    },
    normalizeAiTextTrainingBpm(value) {
      const bpm = Number(value);
      return Number.isInteger(bpm) && (bpm === 0 || (bpm >= 40 && bpm <= 200))
        ? bpm
        : null;
    },
  });
  vm.runInContext(`
    ${sourceBlock(client, "function normalizeCheerPresentation", "function storedSession")}
    globalThis.__doodleApi = {
      normalizeCheerPresentation,
      cheerDisplayMode,
      doodleAnchorForRound,
      doodleLayoutForRound,
      doodleGraphemes,
      normalizeDoodleMessage,
      doodleMessageParts,
      normalizeRoundArtwork,
      normalizeRoundArtworks,
    };
  `, doodleContext);
  const api = doodleContext.__doodleApi;

  assert.equal(api.cheerDisplayMode("あ".repeat(84), "doodle"), "doodle");
  assert.equal(api.cheerDisplayMode("短い台詞", "classic"), "classic");
  assert.equal(api.cheerDisplayMode("短い台詞", undefined), "doodle");
  assert.equal(api.normalizeCheerPresentation(undefined, "classic"), "classic");
  const layouts = Array.from({ length: 5 }, (_, index) => api.doodleLayoutForRound(index));
  assert.equal(new Set(layouts).size, 5);
  assert.deepEqual(
    layouts,
    Array.from({ length: 5 }, (_, index) => api.doodleLayoutForRound(index)),
  );

  const familyEmoji = "👩‍👩‍👧‍👦";
  const combiningKana = "か\u3099";
  assert.equal(api.doodleGraphemes(`${familyEmoji}${combiningKana}`).length, 2);
  const normalizedLongMessage = api.normalizeDoodleMessage(`${familyEmoji.repeat(84)}Z`);
  assert.equal(api.doodleGraphemes(normalizedLongMessage).length, 84);
  assert.equal(normalizedLongMessage.endsWith("Z"), false);
  const splitMessage = `${familyEmoji}準備できた？今日は一緒に最後まで駆け抜けよう！`;
  const splitParts = Array.from(api.doodleMessageParts(splitMessage));
  assert.ok(splitParts.length >= 2 && splitParts.length <= 3);
  assert.equal(splitParts.join(""), splitMessage);

  const collageArtwork = api.normalizeRoundArtwork({
    version: 2,
    message: "準備できた？今日は一緒にやろう",
    parts: ["準備できた？", "今日は一緒にやろう"],
    layout: "cross-diagonal",
    presentation: "doodle",
    bpm: 100,
  }, 0);
  assert.equal(collageArtwork.version, 2);
  assert.equal(collageArtwork.layout, "cross-diagonal");
  assert.deepEqual(Array.from(collageArtwork.parts), ["準備できた？", "今日は一緒にやろう"]);
  assert.equal(collageArtwork.presentation, "doodle");

  const repairedCollage = api.normalizeRoundArtwork({
    version: 2,
    message: "不正な分割も安全に再構成する",
    parts: ["一致しない"],
    layout: "unsafe-center",
    presentation: "doodle",
    bpm: 80,
  }, 1);
  assert.ok(doodleContext.DOODLE_LAYOUTS.includes(repairedCollage.layout));
  assert.equal(Array.from(repairedCollage.parts).join(""), repairedCollage.message);

  const repairedGraphemeBoundary = api.normalizeRoundArtwork({
    version: 2,
    message: familyEmoji,
    parts: [familyEmoji.slice(0, 2), familyEmoji.slice(2)],
    layout: "center-vertical",
    presentation: "doodle",
    bpm: 80,
  }, 0);
  assert.deepEqual(Array.from(repairedGraphemeBoundary.parts), [familyEmoji]);

  const roundTrippedCollage = api.normalizeRoundArtwork(
    JSON.parse(JSON.stringify(collageArtwork)),
    0,
  );
  assert.equal(roundTrippedCollage.layout, collageArtwork.layout);
  assert.deepEqual(Array.from(roundTrippedCollage.parts), Array.from(collageArtwork.parts));

  const legacyArtwork = api.normalizeRoundArtwork({
    message: "😀".repeat(90),
    anchor: "unsafe-center",
    presentation: "unknown",
    bpm: 100,
  }, 0);
  assert.equal(legacyArtwork.version, 1);
  assert.equal(Array.from(legacyArtwork.message).length, 84);
  assert.ok(doodleContext.DOODLE_ANCHORS.includes(legacyArtwork.anchor));
  assert.equal(legacyArtwork.presentation, "classic");

  const recovered = api.normalizeRoundArtworks([
    { message: "完成1", anchor: "upper-left", presentation: "doodle", bpm: 80 },
    { message: "完成2", anchor: "upper-right", presentation: "doodle", bpm: 90 },
    { message: "未完了", anchor: "lower-left", presentation: "doodle", bpm: 100 },
  ], { completedRounds: 2 });
  assert.equal(recovered.length, 5);
  assert.equal(recovered[0].message, "完成1");
  assert.equal(recovered[1].message, "完成2");
  assert.deepEqual(Array.from(recovered.slice(2)), [null, null, null]);
  assert.deepEqual(
    Array.from(api.normalizeRoundArtworks(undefined, { completedRounds: 5 })),
    [null, null, null, null, null],
  );

  const persist = sourceBlock(client, "function persistSession", "function clearPersistedSession");
  assert.match(persist, /cheerPresentation: state\.sessionCheerPresentation/);
  assert.match(persist, /roundArtworks: normalizeRoundArtworks\(state\.roundArtworks,[\s\S]*?completedRounds: state\.completedRounds/);
  const recovery = sourceBlock(client, "function recoverPaidSession", "function recoverPendingDefeatPresentation");
  assert.match(recovery, /normalizeCheerPresentation\([\s\S]*?saved\.cheerPresentation,[\s\S]*?"classic"/);
  assert.match(recovery, /normalizeRoundArtworks\(saved\.roundArtworks/);
  const newPlan = sourceBlock(client, "function newSessionPlan", "function continuePreparedSession");
  assert.match(newPlan, /state\.sessionCheerPresentation = normalizeCheerPresentation\(state\.cheerPresentation\)/);
  assert.match(newPlan, /state\.roundArtworks = Array\(AI_TEXT_TRAINING_ROUND_COUNT\)\.fill\(null\)/);
  const preview = sourceBlock(client, "function installPreview", "async function initializeAuthenticatedState");
  assert.match(preview, /version: 2/);
  assert.match(preview, /parts: doodleMessageParts\(sampleArtworkMessages\[index\]\)/);
  assert.match(preview, /layout: doodleLayoutForRound\(index\)/);
  assert.match(preview, /presentation: cheerDisplayMode\([\s\S]*?state\.sessionCheerPresentation/);
  const finishRound = sourceBlock(client, "function finishRound", "function chooseReaction");
  assert.ok(finishRound.indexOf("captureRoundArtwork()") < finishRound.indexOf("state.completedRounds"));
  assert.ok(finishRound.indexOf("captureRoundArtwork()") < finishRound.indexOf("commitTrainingCompletion()"));
  const support = sourceBlock(client, "function supportMessage", "function updatePlayingDom");
  assert.equal(support.match(/pickAiTextTrainingLine\(/gu)?.length, 1);
  assert.doesNotMatch(support, /document\.querySelector\("#aiTextTrainingCheer > span"\)/);
  assert.match(support, /updateCheerPresentationDom\(state\.currentMessage\)/);
  const doodleUpdate = sourceBlock(client, "function updateDoodleSurfaceDom", "function updateCheerPresentationDom");
  assert.match(doodleUpdate, /textNode\.textContent = text/);
  assert.match(doodleUpdate, /textNode\.dataset\.text = text/);
  assert.match(doodleUpdate, /doodleSurface\.dataset\.attDoodleLayout = layout/);
  assert.doesNotMatch(doodleUpdate, /innerHTML|outerHTML/);
  const presentationUpdate = sourceBlock(client, "function updateCheerPresentationDom", "function captureRoundArtwork");
  assert.match(presentationUpdate, /updateDoodleSurfaceDom\(doodleSurface, message\)/);
  assert.doesNotMatch(presentationUpdate, /innerHTML|outerHTML/);
  const resultOverlay = sourceBlock(client, "function renderResultArtworkOverlay", "function renderResultLineup");
  assert.match(resultOverlay, /Number\(artwork\.version\) >= 2/);
  assert.match(resultOverlay, /data-att-doodle-layout="\$\{escapeHtml\(artwork\.layout\)\}"/);
  assert.match(resultOverlay, /parts: artwork\.parts/);
  assert.match(resultOverlay, /is-legacy-doodle/);
  assert.match(resultOverlay, /role="img" aria-label=/);
  const liveDoodle = sourceBlock(client, "function renderDoodleCheer", "function renderClassicCheer");
  assert.match(liveDoodle, /role="img" aria-label=/);
  const cosmeticsPanel = sourceBlock(client, "function renderCosmeticsPanel", "function renderSetup");
  assert.match(cosmeticsPanel, /is-doodle is-collage[\s\S]*?role="img" aria-label=/);
  assert.match(online, /shop-ai-training-style-message is-doodle is-collage[\s\S]*?role="img" aria-label=/);
  const resultLineup = sourceBlock(client, "function renderResultLineup", "function renderAiTextTrainingLightResult");
  assert.match(resultLineup, /今回の5作品/);
  assert.match(resultLineup, /const completedSession = state\.completedRounds >= AI_TEXT_TRAINING_ROUND_COUNT/);
  assert.match(resultLineup, /completedSession[\s\S]*?Array\.from\(\{ length: AI_TEXT_TRAINING_ROUND_COUNT \}/);
  assert.match(resultLineup, /artworkIndexes\.length === AI_TEXT_TRAINING_ROUND_COUNT/);
  assert.match(resultLineup, /renderResultArtworkOverlay\(artwork, index\)/);
  assert.match(resultLineup, /artwork\?\.bpm \?\? state\.bpms\[index\]/);
  assert.match(resultLineup, /画像と台詞はサーバーへ送信しません/);
  assert.doesNotMatch(
    sourceBlock(client, "function scheduleDefeatZoneMessage", "function queueAchievementFinish"),
    /roundArtworks|captureRoundArtwork/,
  );
  const replayReset = sourceBlock(client, "function resetForAnotherSession", "function requestHome");
  assert.match(replayReset, /state\.roundArtworks = Array\(AI_TEXT_TRAINING_ROUND_COUNT\)\.fill\(null\)/);
});

test("doodle collage separates central copy and defeat ZONE rush keeps the frozen presentation", () => {
  assert.match(
    trainingStyles,
    /data-att-doodle-layout="center-vertical"[\s\S]*?\.att-doodle-copy\.is-part-1\s*\{[\s\S]*?max-height:\s*40%;[\s\S]*?data-att-doodle-layout="center-vertical"[\s\S]*?\.att-doodle-copy\.is-part-2\s*\{[\s\S]*?bottom:\s*10%;[\s\S]*?data-att-doodle-layout="center-vertical"[\s\S]*?\.att-doodle-copy\.is-part-3\s*\{[\s\S]*?left:\s*3%;[\s\S]*?width:\s*22%;/,
  );
  assert.match(
    trainingStyles,
    /data-att-doodle-layout="diagonal-banner"[\s\S]*?\.att-doodle-copy\.is-part-1\s*\{[\s\S]*?top:\s*23%;[\s\S]*?\.att-doodle-copy\.is-part-2\s*\{[\s\S]*?top:\s*52%;/,
  );
  assert.match(
    trainingStyles,
    /data-att-doodle-part-count="2"\]\[data-att-doodle-layout="diagonal-banner"\][\s\S]*?\.att-doodle-copy\.is-part-2\s*\{[\s\S]*?top:\s*auto;[\s\S]*?bottom:\s*21%;/,
  );
  assert.match(
    trainingStyles,
    /data-att-doodle-layout="cross-diagonal"[\s\S]*?\.att-doodle-copy\.is-part-1\s*\{[\s\S]*?top:\s*24%;[\s\S]*?\.att-doodle-copy\.is-part-2\s*\{[\s\S]*?top:\s*54%;/,
  );
  assert.match(
    trainingStyles,
    /data-att-doodle-part-count="2"\]\[data-att-doodle-layout="cross-diagonal"\][\s\S]*?\.att-doodle-copy\.is-part-2\s*\{[\s\S]*?top:\s*auto;[\s\S]*?bottom:\s*20%;/,
  );

  const presentation = sourceBlock(
    client,
    "function defeatZoneRushCheerPresentation",
    "function renderDefeatZoneRushDoodle",
  );
  assert.match(
    presentation,
    /normalizeCheerPresentation\(state\.sessionCheerPresentation, "classic"\)/,
  );
  const zoneDoodle = sourceBlock(
    client,
    "function renderDefeatZoneRushDoodle",
    "function renderDefeatZoneRushClassic",
  );
  assert.match(zoneDoodle, /ai-text-training-zone-doodle is-doodle is-collage is-writing/);
  assert.match(zoneDoodle, /data-ai-text-training-zone-cheer="doodle"/);
  assert.match(zoneDoodle, /data-att-doodle-context="zone-rush"/);
  assert.match(zoneDoodle, /role="img" aria-label=/);
  assert.match(zoneDoodle, /metaLabel: "FINAL · 200 BPM"/);

  const zoneRenderer = sourceBlock(
    client,
    "function renderDefeatZonePlay",
    "function renderDoodleCompositionContents",
  );
  assert.match(zoneRenderer, /rushCheerPresentation === "doodle" \? renderDefeatZoneRushDoodle\(rushMessage\) : ""/);
  assert.match(zoneRenderer, /rushCheerPresentation === "classic" \? renderDefeatZoneRushClassic\(rushMessage\) : ""/);
  assert.equal(zoneRenderer.match(/renderDefeatZoneRushClassic\(rushMessage\)/gu)?.length, 1);
  assert.match(zoneRenderer, /zone_cooldown[\s\S]*?id="aiTextTrainingZoneMessage"/);

  const scheduler = sourceBlock(
    client,
    "function scheduleDefeatZoneMessage",
    "function queueAchievementFinish",
  );
  assert.equal(scheduler.match(/state\.currentMessage = defeatZoneMessage\(slotId\)/gu)?.length, 1);
  assert.match(scheduler, /data-ai-text-training-zone-cheer="doodle"/);
  assert.match(scheduler, /updateDoodleSurfaceDom\(doodleSurface, state\.currentMessage/);
  assert.match(scheduler, /AI_TEXT_TRAINING_ROUND_COUNT - 1/);
  assert.doesNotMatch(scheduler, /innerHTML|outerHTML|roundArtworks|captureRoundArtwork/);

  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-overlay\.is-rush > \.ai-text-training-zone-doodle\.is-collage\s*\{[\s\S]*?z-index:\s*1;[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-doodle\.is-collage \.att-doodle-copy\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?writing-mode:\s*horizontal-tb;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-overlay\.is-rush > \.ai-text-training-edge-hud\s*\{[\s\S]*?z-index:\s*4;/,
  );
  assert.match(
    trainingStyles,
    /@media \(orientation: landscape\) and \(max-height: 650px\)[\s\S]*?\.ai-text-training-zone-overlay \.ai-text-training-zone-doodle\.is-collage[\s\S]*?\.att-doodle-copy\.is-part-1\s*\{[\s\S]*?left:\s*7% !important;[\s\S]*?\.att-doodle-copy\.is-part-2\s*\{[\s\S]*?right:\s*7% !important;[\s\S]*?\.att-doodle-copy\.is-part-3\s*\{[\s\S]*?left:\s*36% !important;/,
  );
  assert.match(
    readme,
    /敗北ZONEは開始時に固定した表示方式を引き継ぎ[\s\S]*?第1ラウンドから最終攻勢まで動画舞台へ台詞を重ねる/,
  );
  assert.match(
    design,
    /5ラウンドと最終攻勢はセッション開始時に固定した`doodle` \/ `classic`を引き継ぐ/,
  );
  assert.equal(html.match(/ai-training-doodle-spacing-zone-rush-v1/gu)?.length, 2);
});

test("defeat ZONE video deco is an optional device-only setup and is never persisted or uploaded", () => {
  assert.match(
    client,
    /ai-text-training-zone-video\.mjs\?v=ai-training-session-video-deco-v2/,
  );
  assert.match(
    client,
    /strategy-video-transfer\.mjs\?v=strategy-video-review-v1/,
  );

  const panel = sourceBlock(
    client,
    "function renderZoneVideoPanel",
    "function renderCosmeticsPanel",
  );
  assert.match(
    panel,
    /state\.playStyle !== "defeat_zone"[\s\S]*?normalizeCheerPresentation\(state\.cheerPresentation\) !== "doodle"[\s\S]*?return ""/,
  );
  assert.match(panel, /第1ラウンドから最終攻勢まで動画デコにする <em>任意<\/em>/);
  assert.match(panel, /動画がなくても従来どおり画像で遊べます/);
  assert.match(
    panel,
    /type="file" accept="video\/mp4,video\/webm" multiple data-ai-text-training-zone-video/,
  );
  assert.match(panel, /1本20MiB/);
  assert.match(panel, /縦向き9:16または4:5/);
  assert.match(panel, /5本ならラウンド1〜5に1本ずつ対応します/);
  assert.match(panel, /1〜4本なら順番に繰り返し/);
  assert.match(panel, /休憩・一時停止では静止プレビュー/);
  assert.match(panel, /再生する動画は常に1本だけ/);
  assert.match(panel, /最終攻勢では選んだ本数を20秒へ均等に割り当て/);
  assert.match(panel, /name="aiTextTrainingZoneAudioSource" value="metronome"/);
  assert.match(panel, /name="aiTextTrainingZoneAudioSource" value="video"/);
  assert.match(panel, /どちらか一方だけを開始時に固定します/);
  assert.match(panel, /端末が音声再生を拒否した時は、動画を無音にしてメトロノームへ安全に戻します/);
  assert.match(
    panel,
    /動画・静止プレビュー・ファイル名・音の選択はFirebase、IndexedDB、localStorageへ保存せず/,
  );

  const selection = sourceBlock(
    client,
    "function canvasToZoneVideoPoster",
    "async function removeRosterImage",
  );
  assert.match(selection, /file\.slice\(0, 32\)\.arrayBuffer\(\)/);
  assert.match(selection, /verifiedStrategyVideoMime\(prefix, file\.type\)/);
  assert.match(selection, /for \(const file of selectedFiles\)/);
  assert.doesNotMatch(selection, /Promise\.all\(selectedFiles/);
  assert.match(selection, /URL\.createObjectURL\(file\)/);
  assert.match(selection, /URL\.createObjectURL\(poster\)/);
  assert.match(
    selection,
    /catch \(error\) \{[\s\S]*?releaseZoneVideoClip\(\{ url, posterUrl \}\)[\s\S]*?operation\.urls\.delete\(url\)[\s\S]*?throw error/,
  );
  assert.match(
    selection,
    /controller: new AbortController\(\)[\s\S]*?zoneVideoPreparation = operation/,
  );
  assert.match(
    selection,
    /targetState\.playStyle !== "defeat_zone"[\s\S]*?normalizeCheerPresentation\(targetState\.cheerPresentation\) !== "doodle"[\s\S]*?releaseZoneVideoClip\(clip\)/,
  );
  assert.doesNotMatch(
    selection,
    /writeLocalValue|persistSession|persistRosterIfConsented|indexedDB|localStorage|sessionStorage|CacheStorage|caches\.|aiTextTrainingAction|economyActionCallable|httpsCallable|uploadBytes|uploadString|getStorage/,
  );

  const persist = sourceBlock(client, "function persistSession", "function clearPersistedSession");
  const storedDeck = sourceBlock(client, "async function writeStoredDeck", "async function readStoredDeck");
  const paidRecovery = sourceBlock(
    client,
    "function recoverPaidSession",
    "function recoverPendingDefeatPresentation",
  );
  assert.doesNotMatch(persist, /zoneVideo|zoneAudioSource|sessionZoneAudioSource|posterUrl|videoClips|fileName/);
  assert.doesNotMatch(storedDeck, /zoneVideo|zoneAudioSource|sessionZoneAudioSource|posterUrl|videoClips|fileName/);
  assert.doesNotMatch(paidRecovery, /saved\.(?:zoneVideo|zoneAudioSource|sessionZoneAudioSource|videoClips)|posterUrl|fileName/);
  assert.doesNotMatch(client, /firebase-storage|getStorage\(|uploadBytes\(|uploadString\(/);

  const setup = sourceBlock(client, "function renderSetup", "function drawReviewCard");
  assert.match(setup, /const startReady = imagesReady[\s\S]*?&& !state\.zoneVideoBusy/);
  const bindings = sourceBlock(
    client,
    "function bindEvents",
    'document.addEventListener("visibilitychange"',
  );
  assert.match(bindings, /\[data-ai-text-training-zone-video\][\s\S]*?handleZoneVideoSelection\(input\)/);
  assert.match(bindings, /\[data-ai-text-training-remove-zone-video\][\s\S]*?removeZoneVideoClip/);
  assert.match(
    bindings,
    /input\[name="aiTextTrainingZoneAudioSource"\][\s\S]*?normalizeAiTextTrainingZoneAudioSource/,
  );
  assert.match(readme, /端末動画デコ[\s\S]*?Firebaseにも端末ストレージにも保存せず/);
  assert.match(design, /端末動画デコは第3のプレイスタイルではなく/);
});

test("session video deco maps round posters and reuses one player through ZONE ready and rush", () => {
  const roundMedia = sourceBlock(
    client,
    "function renderPlayingImage",
    "function transitionMessage",
  );
  assert.match(roundMedia, /zoneVideoEligibleForSession\(\)/);
  assert.match(
    roundMedia,
    /state\.roundIndex % state\.zoneVideoClips\.length[\s\S]*?clip\.posterUrl[\s\S]*?data-ai-text-training-zone-video-mount/,
  );
  assert.match(roundMedia, /ai-text-training-round-video-figure/);
  assert.match(roundMedia, /image\.url/);
  assert.doesNotMatch(roundMedia, /<video\b/);

  const lineup = sourceBlock(
    client,
    "function renderDefeatZoneLineup",
    "function currentZoneVideoPlaybackFrame",
  );
  assert.match(
    lineup,
    /const useZoneVideos = !winner[\s\S]*?state\.phase === "zone_ready"[\s\S]*?state\.phase === "zone_rush"[\s\S]*?state\.phase === "zone_paused"[\s\S]*?state\.defeatResumePhase === "zone_rush"[\s\S]*?zoneVideoEligibleForSession\(\)/,
  );
  assert.match(lineup, /const clip = useZoneVideos \? state\.zoneVideoClips\[index\] : null/);
  assert.match(lineup, /clip\.posterUrl[\s\S]*?data-ai-text-training-zone-video-mount/);
  assert.match(lineup, /return `<figure>[\s\S]*?image\.url/);
  assert.doesNotMatch(lineup, /<video\b/);

  const playback = sourceBlock(
    client,
    "function currentZoneVideoPlaybackFrame",
    "function defeatZoneFallbackLines",
  );
  assert.match(
    playback,
    /if \(!zoneVideoEligibleForSession\(\)\) return null/,
  );
  assert.match(
    playback,
    /\["countdown", "playing"\]\.includes\(state\.phase\)[\s\S]*?aiTextTrainingRoundVideoPlaybackFrame\([\s\S]*?roundIndex: state\.roundIndex[\s\S]*?totalMs: state\.roundSeconds \* 1_000/,
  );
  assert.match(
    playback,
    /state\.phase === "zone_ready"[\s\S]*?aiTextTrainingZoneVideoPlaybackFrame\([\s\S]*?remainingMs: AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_MS/,
  );
  assert.match(
    playback,
    /state\.phase === "zone_rush"[\s\S]*?aiTextTrainingZoneVideoPlaybackFrame\([\s\S]*?remainingMs: state\.remainingMs/,
  );
  assert.doesNotMatch(playback, /state\.phase === "zone_deceleration"|state\.phase === "zone_cooldown"/);
  assert.equal(playback.match(/document\.createElement\("video"\)/gu)?.length, 1);
  assert.match(playback, /if \(zoneVideoElement\) return zoneVideoElement/);
  assert.match(playback, /zoneVideoElement\.preload = "metadata"/);
  assert.match(playback, /zoneVideoElement\.loop = true/);
  assert.match(playback, /zoneVideoElement\.muted = true/);
  assert.match(playback, /zoneVideoElement\.defaultMuted = true/);
  assert.match(playback, /zoneVideoElement\.playsInline = true/);
  assert.match(playback, /zoneVideoElement\.controls = false/);
  assert.match(playback, /mount\.append\(video\)/);

  const audioState = sourceBlock(
    playback,
    "function applyZoneVideoAudioState",
    "function fallbackZoneVideoAudioToMetronome",
  );
  assert.match(
    audioState,
    /const useVideoAudio = sessionUsesZoneVideoAudio\(\)[\s\S]*?video\.muted = !useVideoAudio[\s\S]*?video\.defaultMuted = !useVideoAudio/,
  );
  assert.match(
    audioState,
    /if \(useVideoAudio\) video\.removeAttribute\("muted"\)[\s\S]*?else video\.setAttribute\("muted", ""\)/,
  );

  const sameClip = sourceBlock(
    playback,
    "if (zoneVideoElementClipId === clip.id)",
    "resetZoneVideoPlayer();",
  );
  assert.match(sameClip, /applyZoneVideoAudioState\(video\)/);
  assert.match(sameClip, /video\.parentElement !== mount[\s\S]*?mount\.append\(video\)/);
  assert.match(
    sameClip,
    /state\.phase === "zone_rush" && video\.paused[\s\S]*?requestZoneVideoPlayback\(video, clip, zoneVideoPlaybackRequest\)/,
  );
  assert.match(sameClip, /return;/);
  assert.doesNotMatch(sameClip, /video\.load\(|video\.play\(|video\.src\s*=|resetZoneVideoPlayer/);

  const alignPlayback = sourceBlock(
    playback,
    "const alignPlayback =",
    "video.onplaying =",
  );
  assert.match(
    alignPlayback,
    /requestId !== zoneVideoPlaybackRequest[\s\S]*?zoneVideoElementClipId !== clip\.id/,
  );
  assert.match(alignPlayback, /currentZoneVideoPlaybackFrame\(\)/);
  const playbackRequest = sourceBlock(
    playback,
    "function requestZoneVideoPlayback",
    "function syncZoneVideoPlaybackDom",
  );
  assert.match(playbackRequest, /zoneVideoPlayPendingClipId === clip\?\.id/);
  assert.match(playbackRequest, /const playRequest = video\.play\(\)/);
  assert.match(
    playbackRequest,
    /playRequest\.then\(clearPending, \(\) => \{[\s\S]*?handleZoneVideoPlayRejection\(video, clip, requestId\)/,
  );
  assert.match(
    playback,
    /video\.onloadedmetadata = alignPlayback[\s\S]*?video\.load\(\)[\s\S]*?requestZoneVideoPlayback\(video, clip, requestId\)/,
  );
  assert.match(
    playback,
    /fallbackZoneVideoAudioToMetronome\(\)[\s\S]*?video\.muted = true[\s\S]*?retry\.catch\(\(\) => markZoneVideoPlaybackFailed/,
  );

  const rejection = sourceBlock(
    playback,
    "function handleZoneVideoPlayRejection",
    "function markZoneVideoPlaybackFailed",
  );
  const mutedRejection = sourceBlock(
    rejection,
    "if (!sessionUsesZoneVideoAudio())",
    "if (!fallbackZoneVideoAudioToMetronome())",
  );
  assert.match(mutedRejection, /zoneVideoAutoplayBlockedClipIds\.add\(clip\.id\)/);
  assert.match(mutedRejection, /resetZoneVideoPlayer\(\)/);
  assert.doesNotMatch(mutedRejection, /zoneVideoFailedClipIds\.add|markZoneVideoPlaybackFailed/);
  assert.match(
    playback,
    /state\.zoneVideoFailedClipIds\.add\(clip\.id\)[\s\S]*?resetZoneVideoPlayer\(\)[\s\S]*?静止プレビューのままトレーニングを続けます/,
  );
  assert.match(
    playback,
    /const hardFailed = Boolean\(clip && state\.zoneVideoFailedClipIds\.has\(clip\.id\)\)[\s\S]*?hardFailed && sessionUsesZoneVideoAudio\(\)[\s\S]*?fallbackZoneVideoAudioToMetronome\(\)[\s\S]*?resetZoneVideoPlayer\(\)/,
  );
  assert.match(playback, /video\.onerror = \(\) => markZoneVideoPlaybackFailed\(clip, requestId\)/);

  const renderSource = sourceBlock(client, "function render()", "function updateEditorDraftFromForm");
  assert.ok(renderSource.indexOf("appRoot.innerHTML") < renderSource.indexOf("syncZoneVideoPlaybackDom()"));
  const zoneTicker = sourceBlock(client, "function updateDefeatZoneDom", "function pauseDefeatZone");
  assert.match(zoneTicker, /if \(state\.phase === "zone_rush"\) \{[\s\S]*?syncZoneVideoPlaybackDom\(\)/);
  const beginRush = sourceBlock(
    client,
    "function beginDefeatZoneRush",
    "function confirmPlayerDefeat",
  );
  assert.match(
    beginRush,
    /if \(sessionUsesZoneVideoAudio\(\)\) \{[\s\S]*?ambienceController\.disable\(\)[\s\S]*?\} else \{[\s\S]*?ambienceController\.enable\(\)/,
  );
  const ready = sourceBlock(
    client,
    "function startDefeatZoneReady",
    "function beginDefeatZoneRush",
  );
  assert.match(
    ready,
    /zoneVideoAutoplayBlockedClipIds\.clear\(\)[\s\S]*?sessionPrefersZoneVideoAudio\(\)[\s\S]*?state\.countdownValue = 0[\s\S]*?render\(\)[\s\S]*?動画音声で最終攻勢を開始してください/,
  );
  assert.match(beginRush, /zoneVideoAutoplayBlockedClipIds\.clear\(\)/);
  const defeatRenderer = sourceBlock(
    client,
    "function renderDefeatZonePlay",
    "function renderPlay",
  );
  assert.match(
    defeatRenderer,
    /data-ai-text-training-action="start-zone-video-audio">動画音声で最終攻勢を開始/,
  );
  const actions = sourceBlock(
    client,
    "const actionHandlers =",
    'document.querySelectorAll("[data-ai-text-training-action]")',
  );
  assert.match(actions, /"start-zone-video-audio": \(\) => beginDefeatZoneRush\(\)/);

  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-video-figure\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-video-media > img\.is-foreground\s*\{[\s\S]*?object-fit:\s*contain;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-video-player\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?object-fit:\s*contain;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-video-figure\.is-playing \.ai-text-training-zone-video-player\s*\{[\s\S]*?opacity:\s*1;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-overlay\.is-rush > \.ai-text-training-zone-doodle\.is-collage\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
});

test("session video runtime reuses one element and a muted rejection stays retryable for ZONE audio", async () => {
  const {
    aiTextTrainingRoundVideoPlaybackFrame,
    aiTextTrainingZoneVideoPlaybackFrame,
  } = await zoneVideoModule;
  const playback = sourceBlock(
    client,
    "function currentZoneVideoPlaybackFrame",
    "function defeatZoneFallbackLines",
  );
  const calls = {
    ambienceEnable: 0,
    create: 0,
    load: 0,
    pause: 0,
    play: 0,
    sources: [],
    toasts: [],
  };
  const clips = [
    { id: "clip-1", url: "blob:clip-1", posterUrl: "blob:poster-1", duration: 2 },
    { id: "clip-2", url: "blob:clip-2", posterUrl: "blob:poster-2", duration: 3 },
  ];
  const state = {
    ambienceController: {
      enable() {
        calls.ambienceEnable += 1;
        return Promise.resolve();
      },
      setVolume() {},
    },
    metronomeVolume: 0.36,
    phase: "countdown",
    remainingMs: 20_000,
    roundIndex: 0,
    roundSeconds: 20,
    sessionZoneAudioSource: "video",
    zoneVideoAudioFallbackShown: false,
    zoneVideoClips: clips,
    zoneVideoFailedClipIds: new Set(),
    zoneVideoPlaybackErrorShown: false,
  };
  function createFigure() {
    const classes = new Set();
    return {
      classes,
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
        toggle(value, enabled) {
          if (enabled) classes.add(value);
          else classes.delete(value);
        },
      },
    };
  }
  function createMount(index) {
    const figure = createFigure();
    return {
      figure,
      index,
      append(video) {
        video.parentElement = this;
        video.isConnected = true;
      },
      closest() {
        return figure;
      },
    };
  }
  const mounts = new Map([
    [0, createMount(0)],
    [1, createMount(1)],
  ]);
  let createdVideo = null;
  const document = {
    createElement(tagName) {
      assert.equal(tagName, "video");
      calls.create += 1;
      const attributes = new Set();
      const video = {
        controls: true,
        currentTime: 0,
        defaultMuted: false,
        isConnected: false,
        muted: false,
        parentElement: null,
        paused: true,
        readyState: 0,
        remove() {
          this.parentElement = null;
          this.isConnected = false;
        },
        removeAttribute(name) {
          attributes.delete(name);
        },
        setAttribute(name) {
          attributes.add(name);
        },
        load() {
          calls.load += 1;
        },
        pause() {
          calls.pause += 1;
          this.paused = true;
        },
        play() {
          calls.play += 1;
          this.paused = false;
          return Promise.resolve();
        },
        closest() {
          return this.parentElement?.figure || null;
        },
      };
      Object.defineProperty(video, "src", {
        configurable: true,
        get() { return this.__src || ""; },
        set(value) {
          this.__src = value;
          calls.sources.push(value);
        },
      });
      createdVideo = video;
      return video;
    },
    querySelector(selector) {
      const match = selector.match(/data-ai-text-training-zone-video-mount="(\d+)"/u);
      return match ? mounts.get(Number(match[1])) || null : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const context = vm.createContext({
    AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_MS: 20_000,
    HTMLMediaElement: { HAVE_METADATA: 1 },
    aiTextTrainingRoundVideoPlaybackFrame,
    aiTextTrainingZoneVideoPlaybackFrame,
    configureRoundAmbience() {},
    document,
    showToast(message) { calls.toasts.push(message); },
    state,
    zoneVideoEligibleForSession: () => true,
  });
  vm.runInContext(`
    let zoneVideoElement = null;
    let zoneVideoElementClipId = "";
    let zoneVideoPlayPendingClipId = "";
    let zoneVideoPlaybackRequest = 0;
    const zoneVideoAutoplayBlockedClipIds = new Set();
    function resetZoneVideoPlayer() {
      zoneVideoPlaybackRequest += 1;
      zoneVideoPlayPendingClipId = "";
      if (zoneVideoElement) {
        try { zoneVideoElement.pause(); } catch {}
        zoneVideoElement.onloadedmetadata = null;
        zoneVideoElement.onplaying = null;
        zoneVideoElement.onerror = null;
        try { zoneVideoElement.remove(); } catch {}
      }
      zoneVideoElementClipId = "";
    }
    ${playback}
    globalThis.__videoRuntime = {
      blocked: zoneVideoAutoplayBlockedClipIds,
      currentFrame: currentZoneVideoPlaybackFrame,
      handleRejection: handleZoneVideoPlayRejection,
      sync: syncZoneVideoPlaybackDom,
      get clipId() { return zoneVideoElementClipId; },
      get requestId() { return zoneVideoPlaybackRequest; },
      get video() { return zoneVideoElement; },
    };
  `, context);
  const runtime = context.__videoRuntime;

  runtime.sync();
  assert.equal(calls.create, 1);
  assert.equal(calls.load, 1);
  assert.equal(calls.play, 1);
  assert.equal(runtime.clipId, "clip-1");
  assert.equal(createdVideo.muted, true);

  const replacementMount = createMount(0);
  mounts.set(0, replacementMount);
  runtime.sync();
  assert.equal(calls.create, 1);
  assert.equal(calls.load, 1);
  assert.equal(calls.play, 1);
  assert.equal(createdVideo.parentElement, replacementMount);
  createdVideo.onplaying();
  assert.equal(replacementMount.figure.classes.has("is-playing"), true);

  const mutedRequestId = runtime.requestId;
  runtime.handleRejection(createdVideo, clips[0], mutedRequestId);
  assert.equal(runtime.blocked.has("clip-1"), true);
  assert.equal(state.zoneVideoFailedClipIds.has("clip-1"), false);

  runtime.blocked.clear();
  state.phase = "zone_ready";
  mounts.set(0, createMount(0));
  runtime.sync();
  assert.equal(runtime.currentFrame()?.index, 0);
  assert.equal(calls.create, 1);
  assert.equal(calls.load, 2);
  assert.equal(calls.play, 2);
  assert.equal(createdVideo.muted, true);

  await Promise.resolve();
  createdVideo.paused = true;
  state.phase = "zone_rush";
  state.remainingMs = 20_000;
  mounts.set(0, createMount(0));
  runtime.sync();
  assert.equal(calls.create, 1);
  assert.equal(calls.load, 2);
  assert.equal(calls.play, 3);
  assert.equal(createdVideo.muted, false);

  runtime.handleRejection(createdVideo, clips[0], runtime.requestId);
  await Promise.resolve();
  assert.equal(state.sessionZoneAudioSource, "metronome");
  assert.equal(createdVideo.muted, true);
  assert.equal(state.zoneVideoFailedClipIds.has("clip-1"), false);
  assert.equal(calls.ambienceEnable, 1);
  assert.equal(calls.play, 4);

  for (const phase of [
    "reaction",
    "next_preview",
    "paused",
    "zone_paused",
    "zone_deceleration",
    "zone_cooldown",
  ]) {
    state.phase = phase;
    assert.equal(runtime.currentFrame(), null, `${phase} keeps only its poster or legacy images`);
  }
  runtime.sync();
  state.phase = "countdown";
  state.roundIndex = 1;
  state.remainingMs = 20_000;
  runtime.sync();
  assert.equal(calls.create, 1);
  assert.equal(runtime.clipId, "clip-2");
  assert.deepEqual(
    calls.sources,
    ["blob:clip-1", "blob:clip-1", "blob:clip-2"],
  );
});

test("defeat ZONE video deco releases both object URLs on every terminal path and versions both hosting assets", () => {
  const release = sourceBlock(
    client,
    "function revokeZoneVideoUrl",
    "function zoneVideoEligibleForSession",
  );
  assert.match(
    release,
    /function resetZoneVideoElement\(video\)[\s\S]*?video\.pause\(\)[\s\S]*?removeAttribute\("src"\)[\s\S]*?removeAttribute\("poster"\)[\s\S]*?video\.load\(\)[\s\S]*?video\.remove\(\)/,
  );
  assert.match(release, /try \{[\s\S]*?URL\.revokeObjectURL\(url\)[\s\S]*?\} catch \{/);
  assert.match(release, /revokeZoneVideoUrl\(clip\?\.url\)[\s\S]*?revokeZoneVideoUrl\(clip\?\.posterUrl\)/);
  assert.match(
    release,
    /function cancelZoneVideoPreparation\(\)[\s\S]*?operation\.controller\.abort\(\)[\s\S]*?operation\.urls\.forEach\(revokeZoneVideoUrl\)/,
  );
  assert.match(release, /clips\.forEach\(releaseZoneVideoClip\)/);
  assert.match(release, /resetZoneVideoPlayer\(\);[\s\S]*?zoneVideoElement = null/);
  assert.match(release, /targetState\.zoneVideoClips = \[\]/);
  assert.match(release, /targetState\.zoneVideoFailedClipIds\?\.clear\?\.\(\)/);

  const finishDefeat = sourceBlock(
    client,
    "function finishDefeatPresentation",
    "function queueAchievementFinish",
  );
  const complete = sourceBlock(client, "function completeSession", "function stopSessionImmediately");
  const replayReset = sourceBlock(client, "function resetForAnotherSession", "function requestHome");
  const cleanup = sourceBlock(client, "function cleanup", "function bindXConfirmations");
  const pagehide = sourceBlock(
    client,
    'window.addEventListener("pagehide"',
    'window.addEventListener("pageshow"',
  );
  assert.match(finishDefeat, /state\.phase = "result";[\s\S]*?releaseZoneVideoClips\(\)/);
  assert.match(complete, /state\.phase = "result";[\s\S]*?releaseZoneVideoClips\(\)/);
  assert.match(replayReset, /stopRuntimeTimers\(\);[\s\S]*?releaseZoneVideoClips\(\)/);
  assert.match(cleanup, /releaseZoneVideoClips\(\)[\s\S]*?active = false/);
  assert.match(
    pagehide,
    /cancelZoneVideoPreparation\(\);[\s\S]*?resetZoneVideoPlayer\(\);[\s\S]*?if \(event\.persisted\) return;[\s\S]*?releaseZoneVideoClips\(\)/,
  );

  assert.equal(html.match(/ai-training-session-video-deco-v2/gu)?.length, 2);
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-video-panel\s*\{[\s\S]*?display:\s*grid;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-video-preview > img\.is-backdrop\s*\{[\s\S]*?filter:\s*blur\(/,
  );
});

test("paid one-use review shows balance, price, post-payment balance, and voluntariness", () => {
  const reviewStart = client.indexOf("function renderPurchaseReview");
  const reviewEnd = client.indexOf("function xLink", reviewStart);
  const review = client.slice(reviewStart, reviewEnd);
  assert.match(review, /現在残高/);
  assert.match(review, /今回の価格/);
  assert.match(review, /支払後残高/);
  assert.match(review, /商品種別/);
  assert.match(review, /利用範囲/);
  assert.match(review, /5ラウンド・最終攻勢・敗北・クールダウン・敗北証明/);
  assert.match(review, /赤い「無理／痛い／めまい」即停止で終了した場合も使い切り/);
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
  assert.match(client, /if \(recovered && state\.screen === "result"\)/);
  assert.match(
    client,
    /presentationPending[\s\S]*?\["reaction", "zone_paused"\]\.includes\(state\.phase\)/,
  );
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

test("the shared market separates standard and defeat ZONE products after play-style choice", () => {
  const productHelpers = sourceBlock(
    client,
    "function presetProductType",
    "function selectedPresetForMode",
  );
  const market = sourceBlock(client, "function marketPresetCard", "function scriptSlotPreview");
  const detail = sourceBlock(client, "function renderPresetDetail", "function defaultDefeatZoneLines");
  const initialize = sourceBlock(
    client,
    "async function initializeAuthenticatedState",
    "function normalizeRecoveredPlan",
  );
  const refresh = sourceBlock(client, "async function refreshMarketState", "async function loadRankings");

  assert.match(
    productHelpers,
    /normalizedPlayStyle === "standard"\) return productType === "standard"/,
  );
  assert.match(
    productHelpers,
    /\? \["defeat_zone", "standard"\][\s\S]*?: \["standard"\]/,
  );
  assert.match(
    productHelpers,
    /action: "browse"[\s\S]*?modeId,[\s\S]*?productType/,
  );
  assert.match(initialize, /action: "state"[\s\S]*?productType: "standard"/);
  assert.match(initialize, /browseMarketPresets\(\{[\s\S]*?playStyle: targetState\.playStyle/);
  assert.match(refresh, /productType: "standard"/);
  assert.match(refresh, /browseMarketPresets\(\{[\s\S]*?playStyle: state\.playStyle/);
  assert.match(market, /敗北ZONE専用台本[\s\S]*?通常台本＋システム標準ZONE/);
  assert.match(market, /敗北ZONE専用商品を先に表示しています/);
  assert.match(market, /presetProductType\(preset\) === "defeat_zone"/);
  assert.match(market, /商品種別|ai-text-training-product-badge/);
  assert.match(detail, /5ラウンドの台詞 · 14場面/);
  assert.match(detail, /敗北ZONE専用台詞 · 5場面/);
  assert.match(detail, /通常トレーニングでは選べません/);
});

test("authors sell six separate personality-product combinations and can clone only the 14 normal slots", () => {
  const ownLookup = sourceBlock(client, "function ownPresetFor", "function productUseScope");
  const editorDraft = sourceBlock(client, "function createEditorDraft", "function editorSlotField");
  const editor = sourceBlock(client, "function renderEditor()", "function renderEditorReview");
  const editorUpdate = sourceBlock(
    client,
    "function updateEditorDraftFromForm",
    "async function handleImageSelection",
  );
  const events = sourceBlock(client, "function bindEvents", 'document.addEventListener("visibilitychange"');

  assert.match(
    ownLookup,
    /preset\.modeId === modeId[\s\S]*?presetProductType\(preset\) === normalizedProductType/,
  );
  assert.match(editorDraft, /ownPresetFor\(modeId, normalizedProductType\)/);
  assert.match(
    editorDraft,
    /existing\?\.sellerName[\s\S]*?existing\?\.authorName[\s\S]*?standardExisting\?\.sellerName/,
  );
  assert.match(editorDraft, /productType: normalizedProductType/);
  assert.match(
    editorDraft,
    /zoneLines: normalizedProductType === "defeat_zone"[\s\S]*?Object\.fromEntries\(AI_TEXT_TRAINING_ZONE_SCRIPT_SLOTS[\s\S]*?: \{\}/,
  );
  assert.match(editor, /name="productType"/);
  assert.match(editor, /性格ごとに通常版と敗北ZONE版を別々に販売できます/);
  assert.match(editor, /data-ai-text-training-action="copy-standard-to-zone"/);
  assert.match(editor, /敗北ZONE専用台詞 · 5場面/);
  assert.match(editor, /ギブアップ・即停止・自動一時停止・安全文言・BPM・時間はシステム固定/);
  assert.match(editor, /停止を妨げる台詞は禁止/);
  assert.match(editorUpdate, /const productType = normalizeAiTextTrainingProductType/);
  assert.match(editorUpdate, /for \(const slot of AI_TEXT_TRAINING_ZONE_SCRIPT_SLOTS\)/);
  assert.match(editorUpdate, /if \(draft\.productType === "defeat_zone"\)/);
  assert.match(
    editorUpdate,
    /const zoneLines = \{\};[\s\S]*?if \(productType === "defeat_zone"\)[\s\S]*?zoneLines,/,
  );
  assert.match(events, /"copy-standard-to-zone"[\s\S]*?AI_TEXT_TRAINING_SCRIPT_SLOTS\.map/);
  assert.match(events, /ZONE専用5枠は変更していません/);
  assert.match(
    events,
    /select:not\(\[name="modeId"\]\):not\(\[name="productType"\]\)/,
  );
  assert.match(
    events,
    /select\[name="productType"\][\s\S]*?createEditorDraft\(\{[\s\S]*?productType: state\.editorProductType/,
  );
  assert.match(
    sourceBlock(client, "async function publishEditorDraft", "async function unpublishCurrentPreset"),
    /\.\.\.state\.editorDraft/,
  );
});

test("defeat ZONE products play their five random phases while safety controls remain system-owned", () => {
  const zoneRuntime = sourceBlock(
    client,
    "function defeatZoneFallbackLines",
    "function renderDefeatZoneSafetyControls",
  );
  const zoneLifecycle = sourceBlock(
    client,
    "function scheduleDefeatZoneMessage",
    "function finishDefeatPresentation",
  );
  const renderer = sourceBlock(client, "function renderDefeatZonePlay", "function renderPlay");
  const safetyControls = sourceBlock(
    client,
    "function renderDefeatZoneSafetyControls",
    "function renderDefeatZonePlay",
  );

  assert.match(
    zoneRuntime,
    /presetProductType\(state\.selectedPreset\) === "defeat_zone"[\s\S]*?state\.selectedPreset\.zoneLines\?\.\[slotId\]/,
  );
  assert.match(zoneRuntime, /pickAiTextTrainingLine\(candidates, state\.lastMessage\)/);
  const bpmSource = sourceBlock(
    client,
    "function defeatZoneScriptBpm",
    "function defeatZoneMessage",
  );
  const bpmContext = vm.createContext({
    AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_BPM: 200,
    AI_TEXT_TRAINING_DEFEAT_ZONE_COOLDOWN_BPM: 30,
    currentBpm: () => 120,
  });
  vm.runInContext(`
    ${bpmSource}
    globalThis.__sceneBpm = defeatZoneScriptBpm;
  `, bpmContext);
  assert.equal(bpmContext.__sceneBpm("zone_rush"), 200);
  assert.equal(bpmContext.__sceneBpm("zone_surrendered"), 120);
  assert.equal(bpmContext.__sceneBpm("zone_overpowered"), 120);
  assert.equal(bpmContext.__sceneBpm("zone_cooldown"), 30);
  assert.equal(bpmContext.__sceneBpm("zone_certificate"), 30);
  assert.match(
    sourceBlock(client, "function editorSimulatorMessage", "function renderEditor"),
    /defeatZoneScriptBpm\(state\.editorPreview\.phase, 120\)/,
  );
  for (const slotId of [
    "zone_rush",
    "zone_surrendered",
    "zone_overpowered",
    "zone_cooldown",
  ]) {
    assert.match(zoneLifecycle, new RegExp(`"${slotId}"`));
  }
  assert.match(renderer, /data-ai-text-training-action="surrender-defeat-zone"/);
  assert.match(safetyControls, /data-ai-text-training-action="stop-session"/);
  assert.doesNotMatch(safetyControls, /pause-defeat-zone|toggle-mute/);
  assert.match(renderer, /200 BPMは音と画面の演出です/);
  assert.doesNotMatch(
    sourceBlock(client, "function defaultDefeatZoneLines", "function createEditorDraft"),
    /zone_ready|zone_deceleration/,
  );
});

test("paid defeat ZONE snapshots and certificate text survive five-round completion and recovery", () => {
  const persist = sourceBlock(client, "function persistSession", "function clearPersistedSession");
  const paidRecovery = sourceBlock(
    client,
    "function recoverPaidSession",
    "function recoverPendingDefeatPresentation",
  );
  const freeRecovery = sourceBlock(
    client,
    "function recoverPendingDefeatPresentation",
    "function start()",
  );
  const finish = sourceBlock(client, "async function finishPaidUse", "async function retryFinishPaidUse");
  const certificate = sourceBlock(
    client,
    "function finishDefeatPresentation",
    "function queueAchievementFinish",
  );
  const result = sourceBlock(client, "function renderResult()", "function render()");
  const purchase = sourceBlock(
    client,
    "async function confirmPaidUse",
    "async function previewBeatCharacter",
  );

  assert.match(persist, /selectedPreset: state\.selectedPreset/);
  assert.match(persist, /ownerUid: currentSessionOwnerUid\(\)/);
  assert.match(persist, /defeatCertificateMessage: state\.defeatCertificateMessage/);
  assert.match(
    paidRecovery,
    /saved\.playStyle !== lockedPlayStyle[\s\S]*?state\.selectedPreset = presetSnapshot\(state\.activeUse\.preset\)/,
  );
  assert.match(paidRecovery, /saved\.defeatCertificateMessage/);
  assert.match(freeRecovery, /saved\.selectedPreset[\s\S]*?saved\.defeatCertificateMessage/);
  assert.match(
    finish,
    /keepDefeatPresentation[\s\S]*?persistSession\(\)/,
  );
  assert.doesNotMatch(finish, /selectedPreset\s*=/);
  assert.match(certificate, /defeatZoneMessage\("zone_certificate"\)[\s\S]*?persistSession\(\)/);
  assert.match(certificate, /finishPaidUse\("completed"\)/);
  assert.match(
    result,
    /state\.defeatCertificateMessage \|\| defeatZoneFallbackLines\("zone_certificate"\)\[0\]/,
  );
  assert.match(purchase, /playStyle: requestedPlayStyle/);
  assert.match(
    purchase,
    /lockedPlayStyle !== requestedPlayStyle[\s\S]*?!presetSupportsPlayStyle\(use\.preset, lockedPlayStyle\)/,
  );
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
    "market.js",
    "flea-market.js",
    "free-table.js",
  ]) {
    const source = read(relativePath);
    assert.match(source, /HariaiAiTextTraining\?\.isActive\?\.\(\)/);
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
  assert.doesNotMatch(sanitize, /roundArtworks|currentMessage|artwork/iu);
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
  const completeEnd = client.indexOf("function stopSessionImmediately", completeStart);
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
  assert.match(client, /途中終了で今までの進捗は減りません/);
  assert.match(client, /途中終了で解除済み実績や既存の進捗も減りません/);
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
    SESSION_SCHEMA_VERSION: 4,
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
  storedValue = JSON.stringify({ schemaVersion: 3, plan: { schemaVersion: 1 } });
  assert.equal(sessionContext.__storedSession()?.schemaVersion, 3);
  storedValue = JSON.stringify({ schemaVersion: 4, plan: { schemaVersion: 1 } });
  assert.equal(sessionContext.__storedSession()?.schemaVersion, 4);
  storedValue = JSON.stringify({ schemaVersion: 5, plan: { schemaVersion: 1 } });
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
    /savedSchemaVersion >= 2[\s\S]*?\? isAiTextTrainingRosterCount\(saved\.rosterCount\)[\s\S]*?: null[\s\S]*?: AI_TEXT_TRAINING_ROUND_COUNT/,
  );
  assert.match(
    recovery,
    /saved\.modeId !== activeModeId[\s\S]*?!\["", "completed", "safety_stopped", "exited"\]\.includes\(savedResultOutcome\)/,
  );
  assert.match(
    recovery,
    /savedSchemaVersion >= 2[\s\S]*?savedRosterCount === null \|\| savedDrawIndices === null[\s\S]*?throw new Error\("保存されたDRAWを確認できません。"\)/,
  );
  assert.match(
    recovery,
    /savedSchemaVersion >= 2[\s\S]*?savedDrawIndices && entries\.length === savedRosterCount/,
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

test("defeat ZONE completes the workout at five rounds but consumes its paid use only at a terminal presentation", async () => {
  const setup = sourceBlock(client, "function playStyleCard", "function beatCharacterCard");
  const finishRound = sourceBlock(client, "function finishRound", "function chooseReaction");
  const chooseReaction = sourceBlock(client, "function chooseReaction", "function advanceRound");
  const commit = sourceBlock(
    client,
    "function commitTrainingCompletion",
    "function scheduleDefeatZoneMessage",
  );
  const paidFinish = sourceBlock(client, "async function finishPaidUse", "async function retryFinishPaidUse");
  const finishPresentation = sourceBlock(
    client,
    "function finishDefeatPresentation",
    "function queueAchievementFinish",
  );
  const requestHome = sourceBlock(client, "function requestHome", "function cleanup");

  assert.match(setup, /name="aiTextTrainingPlayStyle"/);
  assert.match(setup, /playStyle\.id === "defeat_zone"/);
  assert.match(finishRound, /state\.completedRounds = Math\.max/);
  assert.match(
    finishRound,
    /state\.roundIndex >= AI_TEXT_TRAINING_ROUND_COUNT - 1[\s\S]*?state\.sessionPlayStyle === "defeat_zone"[\s\S]*?commitTrainingCompletion\(\)/,
  );
  assert.match(
    chooseReaction,
    /state\.sessionPlayStyle === "defeat_zone"[\s\S]*?startDefeatZoneReady\(\)[\s\S]*?completeSession\("completed"\)/,
  );
  assert.match(commit, /if \(state\.workoutFinalized\) return false/);
  assert.match(commit, /state\.resultOutcome = "completed"/);
  assert.match(commit, /queueAchievementFinish\("completed"\)/);
  assert.match(
    commit,
    /state\.sessionPlayStyle !== "defeat_zone"[\s\S]*?finishPaidUse\("completed"\)/,
  );
  assert.match(
    finishPresentation,
    /state\.screen = "result"[\s\S]*?persistSession\(\)[\s\S]*?finishPaidUse\("completed"\)/,
  );
  assert.ok(
    requestHome.indexOf('completeSession("exited")')
      < requestHome.indexOf("if (!state.finishPending"),
    "the terminal finish marks a paid use pending before home can clear its recovery record",
  );
  assert.match(
    paidFinish,
    /keepDefeatPresentation[\s\S]*?targetState\.sessionPlayStyle === "defeat_zone"[\s\S]*?persistSession\(\)/,
  );
  assert.doesNotMatch(commit, /DEFEAT_ZONE_(?:RUSH|COOLDOWN)_MS/);

  const outcomes = [];
  const runtimeState = {
    sessionPlayStyle: "defeat_zone",
    workoutFinalized: false,
    resultOutcome: "",
    ambienceController: {
      disable() {},
      setVolume() {},
    },
    metronomeVolume: 0.36,
    defeatSettled: false,
    defeatResolution: "surrendered",
    defeatCertificateMessage: "",
    screen: "play",
    phase: "reaction",
    defeatResumePhase: "",
  };
  const runtime = vm.createContext({
    active: true,
    state: runtimeState,
    writeLocalValue() {},
    jstDateKey: () => "2026-07-31",
    DAILY_COMPLETE_PREFIX: "daily:",
    queueAchievementFinish() {},
    persistSession() {},
    flushAchievementRetryQueue: () => Promise.resolve(true),
    finishPaidUse(outcome) {
      outcomes.push(outcome);
      return Promise.resolve(true);
    },
    render() {},
    stopRuntimeTimers() {},
    releaseZoneVideoClips() {},
    releaseWakeLock() {},
    defeatZoneMessage: () => "購入時の敗北証明",
    announce() {},
  });
  vm.runInContext(`
    ${commit}
    ${finishPresentation}
    globalThis.__commit = commitTrainingCompletion;
    globalThis.__finishPresentation = finishDefeatPresentation;
  `, runtime);

  assert.equal(runtime.__commit(), true);
  assert.equal(runtimeState.workoutFinalized, true);
  assert.deepEqual(outcomes, []);
  runtime.__finishPresentation({ settled: true });
  await Promise.resolve();
  assert.deepEqual(outcomes, ["completed"]);
  assert.equal(runtimeState.screen, "result");
  assert.equal(runtimeState.defeatCertificateMessage, "購入時の敗北証明");
});

test("defeat ZONE has one clear rush, defeat, cooldown, and certificate path", () => {
  const ready = sourceBlock(
    client,
    "function startDefeatZoneReady",
    "function beginDefeatZoneRush",
  );
  const rush = sourceBlock(
    client,
    "function beginDefeatZoneRush",
    "function confirmPlayerDefeat",
  );
  const defeat = sourceBlock(
    client,
    "function confirmPlayerDefeat",
    "function beginDefeatZoneCooldown",
  );
  const cooldown = sourceBlock(
    client,
    "function beginDefeatZoneCooldown",
    "function updateDefeatZoneDom",
  );
  const update = sourceBlock(
    client,
    "function updateDefeatZoneDom",
    "function pauseDefeatZone",
  );
  const result = sourceBlock(client, "function renderResult()", "function render()");

  assert.match(ready, /AI_TEXT_TRAINING_DEFEAT_ZONE_READY_SECONDS/);
  assert.match(ready, /state\.phase = "zone_ready"/);
  assert.match(rush, /state\.phase = "zone_rush"/);
  assert.match(rush, /AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_MS/);
  assert.match(defeat, /state\.defeatResolution = reason === "overpowered" \? "overpowered" : "surrendered"/);
  assert.match(defeat, /state\.phase = "zone_deceleration"/);
  assert.match(defeat, /AI_TEXT_TRAINING_DEFEAT_ZONE_DECEL_MS/);
  assert.match(cooldown, /state\.phase = "zone_cooldown"/);
  assert.match(cooldown, /AI_TEXT_TRAINING_DEFEAT_ZONE_COOLDOWN_MS/);
  assert.match(update, /state\.phase === "zone_rush"[\s\S]*?confirmPlayerDefeat\("overpowered"\)/);
  assert.match(update, /state\.phase === "zone_deceleration"[\s\S]*?beginDefeatZoneCooldown\(\)/);
  assert.match(update, /state\.phase === "zone_cooldown"[\s\S]*?finishDefeatPresentation\(\)/);
  assert.match(result, /AI WIN · DEFEAT CERTIFICATE/);
  assert.match(result, /<strong>DEFEAT<\/strong>/);
  assert.match(result, /<strong>COMPLETE<\/strong>/);
  assert.match(result, /5ラウンド達成/);
  assert.match(result, /敗北ZONEの継続時間や「ととのった」の選択による報酬差はありません/);
  assert.equal(html.match(/defeat-zone-v1/gu)?.length, 2);
  assert.match(
    readme,
    /敗北ZONE[\s\S]*?200 BPM演出・最大20秒[\s\S]*?30 BPM演出・最大60秒[\s\S]*?DEFEAT \/ AI WIN/,
  );
  assert.match(
    design,
    /5ラウンド完走を確定[\s\S]*?5枚の最終攻勢（200 BPM演出、最大20秒）[\s\S]*?敗北証明/,
  );
});

test("defeat ZONE recovery validates every official defeat boundary", () => {
  const validation = sourceBlock(
    client,
    "function validateRecoveredDefeatPresentation",
    "function recoverPaidSession",
  );
  const context = vm.createContext({ AI_TEXT_TRAINING_ROUND_COUNT: 5 });
  vm.runInContext(`
    ${validation}
    globalThis.__validate = validateRecoveredDefeatPresentation;
  `, context);
  const base = {
    resultOutcome: "completed",
    workoutFinalized: true,
    completedRounds: 5,
    roundIndex: 4,
    resumePhase: "zone_rush",
    finalReaction: "just_right",
    defeatResolution: "",
    postWorkoutSafetyStopped: false,
    postWorkoutExited: false,
  };

  assert.equal(context.__validate({
    ...base,
    phase: "reaction",
    finalReaction: null,
  }), true);
  assert.equal(context.__validate({
    ...base,
    phase: "zone_paused",
  }), true);
  assert.equal(context.__validate({
    ...base,
    phase: "zone_paused",
    resumePhase: "zone_deceleration",
    defeatResolution: "surrendered",
  }), true);
  assert.equal(context.__validate({
    ...base,
    phase: "result",
    defeatResolution: "overpowered",
  }), true);
  assert.equal(context.__validate({
    ...base,
    phase: "result",
    finalReaction: null,
    postWorkoutSafetyStopped: true,
  }), true);
  assert.equal(context.__validate({
    ...base,
    phase: "result",
    finalReaction: null,
    postWorkoutExited: true,
  }), true);

  for (const invalid of [
    { ...base, phase: "reaction" },
    { ...base, phase: "zone_paused", defeatResolution: "surrendered" },
    { ...base, phase: "zone_paused", resumePhase: "zone_cooldown" },
    { ...base, phase: "result" },
    { ...base, phase: "result", roundIndex: 3, defeatResolution: "surrendered" },
  ]) {
    assert.throws(() => context.__validate(invalid), /保存された敗北ZONE/);
  }

  assert.match(client, /!\[1, 2, 3, SESSION_SCHEMA_VERSION\]\.includes\(Number\(parsed\.schemaVersion\)\)/);
  assert.match(
    client,
    /Number\.isFinite\(savedRemainingMs\) \? savedRemainingMs : remainingLimit/,
  );
  assert.match(
    sourceBlock(client, "function recoverPaidSession", "function recoverPendingDefeatPresentation"),
    /recordedWorkoutFinalized !== completedOutcome[\s\S]*?Number\(saved\.completedRounds\) !== AI_TEXT_TRAINING_ROUND_COUNT[\s\S]*?savedRoundSeconds \* AI_TEXT_TRAINING_ROUND_COUNT/,
  );
  assert.match(
    sourceBlock(client, "function recoverPaidSession", "function recoverPendingDefeatPresentation"),
    /savedSchemaVersion >= 4[\s\S]*?!savedSessionOwnerMatches\(saved\)[\s\S]*?presentationPending[\s\S]*?state\.finishPending = !presentationPending[\s\S]*?if \(!presentationPending\)[\s\S]*?finishPaidUse\(savedResultOutcome\)/,
  );
  assert.match(
    sourceBlock(client, "function recoverPendingDefeatPresentation", "function start()"),
    /savedSchemaVersion < 4[\s\S]*?!savedSessionOwnerMatches\(saved\)[\s\S]*?return false/,
  );
  assert.doesNotMatch(
    sourceBlock(
      client,
      "function recoverPendingDefeatPresentation",
      "function start()",
    ),
    /savedRemainingMs\s*\|\|/,
  );
});

test("local session recovery binds schema 4 to one Firebase UID and trusts legacy paid state only with the active use id", () => {
  const ownership = sourceBlock(
    client,
    "function normalizeAchievementOwnerUid",
    "function currentAchievementOwner",
  );
  const ownerState = { uid: "firebase-owner-a" };
  const auth = { currentUser: { uid: "firebase-owner-a" } };
  const context = vm.createContext({ state: ownerState, auth });
  vm.runInContext(`
    ${ownership}
    globalThis.__currentOwner = currentSessionOwnerUid;
    globalThis.__matches = savedSessionOwnerMatches;
  `, context);

  assert.equal(context.__currentOwner(), "firebase-owner-a");
  assert.equal(context.__matches({ ownerUid: "firebase-owner-a" }), true);
  assert.equal(context.__matches({ ownerUid: "firebase-owner-b" }), false);
  ownerState.uid = "";
  auth.currentUser.uid = "firebase-owner-b";
  assert.equal(context.__currentOwner(), "firebase-owner-b");
  assert.equal(context.__matches({ ownerUid: "firebase-owner-b" }), true);
  auth.currentUser = null;
  assert.equal(context.__matches({ ownerUid: "firebase-owner-b" }), false);

  const paidRecovery = sourceBlock(
    client,
    "function recoverPaidSession",
    "function recoverPendingDefeatPresentation",
  );
  const ownerRecovery = sourceBlock(
    client,
    "function recoverPendingDefeatPresentation",
    "function start()",
  );
  assert.match(
    paidRecovery,
    /saved\.paidUseId !== state\.activeUse\.id[\s\S]*?savedSchemaVersion >= 4[\s\S]*?!savedSessionOwnerMatches\(saved\)/,
  );
  assert.match(
    ownerRecovery,
    /savedSchemaVersion < 4[\s\S]*?!savedSessionOwnerMatches\(saved\)/,
  );
  assert.match(
    design,
    /保存schema 4[\s\S]*?現在のUIDと一致[\s\S]*?schema 1 \/ 2 \/ 3の有料セッション[\s\S]*?開始済み`useId`と一致/,
  );
});

test("defeat ZONE never re-asks for surrender after defeat and never auto-resumes after hiding", () => {
  const renderer = sourceBlock(
    client,
    "function renderDefeatZonePlay",
    "function renderPlay",
  );
  const confirm = sourceBlock(
    client,
    "function confirmPlayerDefeat",
    "function beginDefeatZoneCooldown",
  );
  const visibility = sourceBlock(
    client,
    'document.addEventListener("visibilitychange"',
    "window.HariaiAiTextTraining",
  );
  const immediateStop = sourceBlock(
    client,
    "function stopSessionImmediately",
    "function resetForAnotherSession",
  );

  assert.match(renderer, /continueAfterDefeat = state\.defeatResumePhase === "zone_deceleration"/);
  assert.match(renderer, /敗北後の減速を停止中/);
  assert.match(renderer, /クールダウンへ進む/);
  assert.match(
    renderer,
    /\$\{resumeCooldown \|\| continueAfterDefeat \? "" : '<button[\s\S]*?再開せずギブアップする/,
  );
  assert.match(
    confirm,
    /state\.phase === "zone_paused"[\s\S]*?state\.defeatResumePhase === "zone_rush"[\s\S]*?!state\.defeatResolution/,
  );
  assert.match(visibility, /pauseDefeatZone\(\{ fromVisibility: true \}\)/);
  assert.match(visibility, /if \(event\.persisted\) return/);
  assert.match(visibility, /window\.addEventListener\("pageshow"/);
  assert.match(visibility, /音とタイマーは停止中です。自分で再開してください/);
  assert.match(
    immediateStop,
    /if \(state\.workoutFinalized\)[\s\S]*?state\.postWorkoutExited = true[\s\S]*?finishDefeatPresentation\(\)/,
  );
  assert.match(
    sourceBlock(client, "function renderResult()", "function render()"),
    /const replayAllowed = state\.resultOutcome === "completed"[\s\S]*?&& !state\.postWorkoutSafetyStopped/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-safety-controls\.ai-text-training-zone-safety-controls\s*\{[\s\S]*?position:\s*relative;[\s\S]*?grid-row:\s*2;[\s\S]*?bottom:\s*auto;/,
  );
  assert.match(
    trainingStyles,
    /@media \(orientation: landscape\) and \(max-height: 650px\)[\s\S]*?\.ai-text-training-zone-arena\s*\{[\s\S]*?grid-template-rows:\s*minmax\(250px,\s*calc\(100svh - 96px\)\) auto auto;/,
  );
  assert.match(client, /<fieldset class="ai-text-training-play-style-fieldset">[\s\S]*?<legend>プレイスタイル<\/legend>/);
  assert.match(client, /class="ai-text-training-zone-lineup" role="group"/);
  assert.match(
    client,
    /data-ai-text-training-play-style="\$\{escapeHtml\(state\.sessionPlayStyle \|\| state\.playStyle \|\| "standard"\)\}"/,
  );
  assert.equal(
    renderer.match(/class="ai-text-training-zone-phase-meta"/gu)?.length,
    3,
  );
  assert.equal(
    renderer.match(/class="ai-text-training-zone-support-layer"/gu)?.length,
    3,
  );
  assert.match(
    renderer,
    /data-ai-text-training-action="settle-defeat-zone"><strong>ととのった<\/strong><small>敗北証明を見る<\/small>/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-arena\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*min\(94vw,\s*900px\)\);/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-lineup\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,[\s\S]*?grid-template-rows:\s*repeat\(2,/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-overlay:is\(\.is-rush,\s*\.is-defeated,\s*\.is-cooldown\)\s*\{[\s\S]*?backdrop-filter:\s*none;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-zone-phase-meta h2\s*\{[\s\S]*?font-size:\s*clamp\(0\.82rem,\s*2\.3vw,\s*1\.08rem\);/,
  );
  assert.match(
    trainingStyles,
    /@media \(min-width: 651px\) and \(min-height: 651px\)[\s\S]*?\.ai-text-training-zone-lineup\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,/,
  );
  assert.equal(html.match(/defeat-zone-image-stage-v3/gu)?.length, 2);
  assert.match(
    trainingStyles,
    /@media \(forced-colors: active\)[\s\S]*?\.ai-text-training-play-style-card\.is-selected > span,[\s\S]*?outline:\s*2px solid Highlight;/,
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
    /currentPendingDrawIndices\(\)[\s\S]*?const script = selectedPresetForMode\(\);[\s\S]*?state\.pendingPaidPreset = script;[\s\S]*?state\.purchaseActionId = "";[\s\S]*?state\.screen = "purchase_review"/,
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

test("an interrupted session offers no replay CTA while preserving a home exit", () => {
  const result = sourceBlock(client, "function renderResult()", "function render()");
  assert.match(
    result,
    /const replayAllowed = state\.resultOutcome === "completed"/,
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
  assert.match(result, /state\.resultOutcome === "exited"[\s\S]*?今日はここまで。止める判断にペナルティはありません/);
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

test("the AI metronome starts louder, stays locally adjustable, and preserves explicit playback", () => {
  assert.match(client, /const DEFAULT_METRONOME_VOLUME = 0\.36;/);
  assert.match(
    client,
    /const METRONOME_VOLUME_PREFERENCE_KEY = "hariai-ai-text-training-metronome-volume-v1";/,
  );

  const storedVolumeSource = sourceBlock(
    client,
    "function storedMetronomeVolume",
    "function storedSession",
  );
  const readStoredVolume = (storedValue) => {
    const context = vm.createContext({
      DEFAULT_METRONOME_VOLUME: 0.36,
      METRONOME_VOLUME_PREFERENCE_KEY: "volume-key",
      readLocalValue(_key, fallback) {
        return storedValue === undefined ? fallback : storedValue;
      },
    });
    vm.runInContext(`
      ${storedVolumeSource}
      globalThis.__storedMetronomeVolume = storedMetronomeVolume;
    `, context);
    return context.__storedMetronomeVolume();
  };
  assert.equal(readStoredVolume(undefined), 0.36);
  assert.equal(readStoredVolume("0.72"), 0.72);
  assert.equal(readStoredVolume("2"), 1);
  assert.equal(readStoredVolume("-0.2"), 0);
  assert.equal(readStoredVolume("loud"), 0.36);

  const createStateSource = sourceBlock(client, "function createState()", "function modeIsActiveElsewhere");
  assert.match(
    createStateSource,
    /const metronomeVolume = storedMetronomeVolume\(\);[\s\S]*?createFreeTableAmbienceController\(\{[\s\S]*?initialVolume: metronomeVolume/,
  );
  assert.match(createStateSource, /\bmetronomeVolume,\s*[\r\n]+\s*muted: false/);

  const volumeMarkup = sourceBlock(
    client,
    "function metronomeVolumeControlHtml",
    "function renderBeatCharacterPanel",
  );
  assert.match(volumeMarkup, /type="range" min="0" max="100" step="1"/);
  assert.match(volumeMarkup, /data-ai-text-training-metronome-volume-output/);
  assert.match(volumeMarkup, /ヘッダーのSE設定とは別です/);

  const volumeUpdateSource = sourceBlock(
    client,
    "function updateMetronomeVolume",
    "function configureRoundAmbience",
  );
  const saved = [];
  const setVolumeCalls = [];
  const toasts = [];
  let saveSucceeds = true;
  const output = { value: "", textContent: "" };
  const input = {
    value: "72",
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const context = vm.createContext({
    METRONOME_VOLUME_PREFERENCE_KEY: "volume-key",
    state: {
      metronomeVolume: 0.36,
      ambienceController: {
        setVolume(value) {
          setVolumeCalls.push(value);
          return Math.min(1, Math.max(0, value));
        },
      },
    },
    writeLocalValue(key, value) {
      saved.push([key, value]);
      return saveSucceeds;
    },
    showToast(message) {
      toasts.push(message);
    },
    document: {
      querySelectorAll() {
        return [output];
      },
    },
  });
  vm.runInContext(`
    ${volumeUpdateSource}
    globalThis.__updateMetronomeVolume = updateMetronomeVolume;
  `, context);
  context.__updateMetronomeVolume(input);
  assert.deepEqual(setVolumeCalls, [0.72]);
  assert.equal(context.state.metronomeVolume, 0.72);
  assert.deepEqual(saved, [["volume-key", "0.72"]]);
  assert.equal(input.attributes["aria-valuetext"], "72%");
  assert.equal(output.value, "72%");
  assert.equal(output.textContent, "72%");

  saveSucceeds = false;
  input.value = "150";
  context.__updateMetronomeVolume(input);
  assert.deepEqual(setVolumeCalls, [0.72, 1]);
  assert.equal(context.state.metronomeVolume, 1);
  assert.equal(input.value, "100");
  assert.equal(output.textContent, "100%");
  assert.match(toasts[0], /端末へ保存できませんでした/);

  saveSucceeds = true;
  input.value = "-20";
  context.__updateMetronomeVolume(input);
  assert.deepEqual(setVolumeCalls, [0.72, 1, 0]);
  assert.equal(context.state.metronomeVolume, 0);
  assert.equal(input.value, "0");
  assert.equal(output.textContent, "0%");
  assert.doesNotMatch(volumeUpdateSource, /\.enable\(/);

  const eventBinding = sourceBlock(
    client,
    "function bindEvents",
    'document.addEventListener("visibilitychange"',
  );
  assert.match(
    eventBinding,
    /\[data-ai-text-training-metronome-volume\][\s\S]*?addEventListener\("input", \(\) => updateMetronomeVolume\(input\)\)/,
  );
  const playControls = sourceBlock(client, "function renderPlay()", "function resultTitle");
  assert.doesNotMatch(playControls, /data-ai-text-training-action="toggle-mute"/);
  assert.match(readme, /準備画面の0〜100%スライダー[\s\S]*?0%を無音設定/);
  assert.equal(html.match(/metronome-volume-v2/gu)?.length, 2);
  assert.match(
    trainingStyles,
    /\.ai-text-training-metronome-volume input \{[\s\S]*?accent-color: var\(--att-cyan\)/,
  );
  assert.match(readme, /文字コラ専用の初期音量は36%/);
  assert.match(design, /初期音量は36%。準備画面の0〜100%スライダー/);
});

test("the in-round timer and beat gauge use opposite edges with a ten-second finale", () => {
  assert.match(
    client,
    /aiTextTrainingBeatGaugeState[\s\S]*?ai-text-training-core-v1-beat-edge-hud-v3/,
  );
  assert.match(
    client,
    /ai-text-training-core-v1-beat-edge-hud-v3-defeat-zone-v1-defeat-zone-scripts-v1/,
  );
  const gaugeStateSource = sourceBlock(
    client,
    "function currentBeatGaugeState",
    "function trainingMood",
  );
  assert.match(gaugeStateSource, /bpm: currentBpm\(\)/);
  assert.match(gaugeStateSource, /effectiveAt: state\.roundBeatEffectiveAt/);
  assert.match(gaugeStateSource, /remainingMs: state\.remainingMs/);
  assert.doesNotMatch(gaugeStateSource, /state\.muted/);

  const edgeHudSource = sourceBlock(
    client,
    "function renderTrainingEdgeHud",
    "function renderPlayingImage",
  );
  assert.match(
    edgeHudSource,
    /class="ai-text-training-timer" role="timer" aria-live="off" aria-label="\$\{escapeHtml\(label\)\} \$\{remainingSeconds\}秒"/,
  );
  assert.match(
    edgeHudSource,
    /id="aiTextTrainingRemaining"[\s\S]*?class="ai-text-training-beat-gauge"[\s\S]*?aria-hidden="true"/,
  );
  assert.match(edgeHudSource, /--att-beat-duration:\$\{beatDurationMs\.toFixed\(3\)\}ms/);
  assert.match(edgeHudSource, /--att-beat-delay:\$\{beatDelayMs\.toFixed\(3\)\}ms/);
  assert.match(edgeHudSource, /--att-gauge-urgency:\$\{visualState\.urgency\.toFixed\(3\)\}/);

  const playSource = sourceBlock(client, "function renderPlay", "function resultTitle");
  assert.match(
    playSource,
    /state\.phase === "countdown" \? `<strong class="ai-text-training-countdown"/,
  );
  assert.match(
    playSource,
    /state\.phase === "playing" \? renderTrainingEdgeHud\(remainingSeconds\) : ""/,
  );
  assert.equal(client.match(/id="aiTextTrainingRemaining"/gu)?.length, 1);

  const configureSource = sourceBlock(
    client,
    "function configureRoundAmbience",
    "function announce",
  );
  assert.match(configureSource, /state\.roundBeatEffectiveAt = Number\(effectiveAt\) \|\| 0/);
  assert.match(configureSource, /setAmbience\(\{[\s\S]*?effectiveAt,/);

  const updateSource = sourceBlock(
    client,
    "function updatePlayingDom",
    "function beginRound",
  );
  assert.match(updateSource, /const visualState = currentBeatGaugeState\(\)/);
  assert.match(updateSource, /timerContainer\.setAttribute\("aria-label", `残り時間 \$\{remainingSeconds\}秒`\)/);
  assert.match(updateSource, /edgeHud\.classList\.toggle\("is-final-ten", visualState\.finalTen\)/);
  assert.match(updateSource, /--att-gauge-urgency/);
  assert.match(updateSource, /remainingSeconds === 10[\s\S]*?残り10秒です/);
  assert.match(updateSource, /remainingSeconds === 5[\s\S]*?残り5秒です/);
  assert.doesNotMatch(updateSource, /remainingSeconds <= 5 \? "final"/);

  assert.match(
    trainingStyles,
    /\.ai-text-training-timer\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?left:\s*clamp\(/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-timer\s*\{[\s\S]*?top:\s*31%;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-beat-gauge\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?right:\s*clamp\([\s\S]*?height:\s*clamp\(132px,\s*27%,\s*180px\)/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-edge-hud\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-edge-hud\.is-active \.ai-text-training-beat-runner\s*\{[\s\S]*?var\(--att-beat-duration\)[\s\S]*?infinite alternate;[\s\S]*?animation-delay:\s*var\(--att-beat-delay\)/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-edge-hud\.is-free \.ai-text-training-beat-runner\s*\{[\s\S]*?top:\s*50%;[\s\S]*?animation:\s*none;/,
  );
  assert.match(
    trainingStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ai-text-training-edge-hud \.ai-text-training-beat-runner\s*\{[\s\S]*?animation:\s*none !important;/,
  );
  assert.match(
    trainingStyles,
    /@media \(forced-colors: active\)[\s\S]*?\.ai-text-training-timer,[\s\S]*?\.ai-text-training-beat-gauge,[\s\S]*?\.ai-text-training-beat-runner/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-safety-controls\s*\{[\s\S]*?z-index:\s*7;/,
  );
  assert.match(
    trainingStyles,
    /\.ai-text-training-safety-controls \.ai-text-training-emergency\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?min-height:\s*56px;/,
  );
  assert.match(
    client,
    /<div class="ai-text-training-round-top"><span><b>ROUND \$\{state\.roundIndex \+ 1\} \/ 5<\/b><i aria-hidden="true">·<\/i><strong>/,
  );
  assert.match(
    trainingStyles,
    /@media \(max-width: 480px\)[\s\S]*?\.ai-text-training-round-top\s*\{[\s\S]*?flex-direction:\s*row;[\s\S]*?flex-wrap:\s*nowrap;/,
  );
  assert.match(
    trainingStyles,
    /@media \(max-width: 480px\)[\s\S]*?\.ai-text-training-cheer\.is-classic > span\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/,
  );
  assert.doesNotMatch(
    sourceBlock(client, "function supportMessage", "function updatePlayingDom"),
    /document\.querySelector\("#aiTextTrainingCheer > span"\)/,
  );
  assert.match(
    trainingStyles,
    /@media \(max-width: 480px\)[\s\S]*?\.ai-text-training-companion > span\s*\{[\s\S]*?display:\s*none;[\s\S]*?\.ai-text-training-companion > p\s*\{[\s\S]*?white-space:\s*nowrap;/,
  );
  const standardPlay = sourceBlock(client, "function renderPlay()", "function resultTitle");
  assert.match(standardPlay, /renderFrame\([\s\S]*?\{ showHeader: false \}\);/);
  assert.doesNotMatch(standardPlay, /title: "SOLO TRAINING"|backAction: "exit-session"/);
  assert.match(
    sourceBlock(client, "function renderFrame", "function authStatusHtml"),
    /aria-label="\$\{escapeHtml\(title\)\}"/,
  );
  assert.match(
    trainingStyles,
    /@media \(orientation: landscape\) and \(max-height: 650px\)[\s\S]*?\.ai-text-training-round-top > span\s*\{[\s\S]*?margin-left:\s*58px;[\s\S]*?\.ai-text-training-round-overlay \.ai-text-training-progress\s*\{[\s\S]*?width:\s*calc\(100% - 58px\);/,
  );
  assert.match(
    trainingStyles,
    /@media \(orientation: portrait\) and \(max-height: 720px\)[\s\S]*?data-ai-text-training-play-style="standard"[\s\S]*?grid-template-columns:\s*minmax\(0, min\(430px, calc\(64\.2857svh - 128\.571px\)\)\);/,
  );
  assert.match(
    trainingStyles,
    /@media \(orientation: landscape\) and \(max-height: 650px\) and \(min-width: 540px\) and \(min-aspect-ratio: 5 \/ 3\)[\s\S]*?data-ai-text-training-play-style="standard"[\s\S]*?\.ai-text-training-safety-controls\s*\{[\s\S]*?grid-column:\s*2;/,
  );
  assert.match(
    trainingStyles,
    /@media \(orientation: landscape\) and \(max-height: 650px\)[\s\S]*?\.ai-text-training-doodle-cheer\.is-collage \.att-doodle-copy\s*\{[\s\S]*?writing-mode:\s*horizontal-tb !important;[\s\S]*?\.att-doodle-copy\.is-part-1\s*\{[\s\S]*?left:\s*28% !important;/,
  );

  assert.equal(html.match(/beat-edge-hud-v3/gu)?.length, 2);
  assert.equal(html.match(/ai-training-focus-hud-v2/gu)?.length, 2);
  assert.equal(html.match(/ai-training-doodle-cheer-v1/gu)?.length, 3);
  assert.equal(html.match(/ai-training-purikura-collage-v1/gu)?.length, 3);
  assert.match(readme, /残り秒数を画像左端[\s\S]*?ビートゲージを右端[\s\S]*?残り10秒/);
  assert.match(design, /残り時間が厳密に10秒以下[\s\S]*?全面フラッシュを使わない/);
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
  assert.match(
    client,
    /aria-label="\$\{winner \? "本日あなたを倒した5枚" : "今回DRAWされた5枚"\}"/,
  );
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
    /const startReady = imagesReady[\s\S]*?&& !state\.cosmeticDraft[\s\S]*?&& !authChecking[\s\S]*?&& !paidRecoveryBlocked/,
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
  async function runAuthentication({
    failure = null,
    savedSession = null,
    browseFailure = false,
    activeUse = null,
  } = {}) {
    const calls = { browse: 0, recover: 0, render: 0 };
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
      playStyle: "standard",
      sessionPlayStyle: "standard",
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
          activeUse,
        },
      }),
      normalizeServerCosmetics: (value) => value,
      presetSnapshot: (value) => value,
      activeUsePlayStyle: (value) => value?.playStyle || "standard",
      normalizeMarketPresetList: (value) => value,
      browseMarketPresets: async ({ seededPresets }) => {
        calls.browse += 1;
        if (browseFailure) throw new Error("browse unavailable");
        return seededPresets;
      },
      storedSession: () => savedSession,
      clearPersistedSession() {},
      doc: () => ({}),
      onSnapshot: () => () => {},
      document: { querySelectorAll: () => [] },
      restoreStoredDeck: async () => true,
      recoverPaidSession() {
        calls.recover += 1;
        return false;
      },
      recoverPendingDefeatPresentation() {
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
  assert.equal(success.calls.browse, 1);
  assert.equal(success.calls.recover, 1);
  assert.equal(success.calls.render, 1);

  const activeZoneUse = {
    id: "paid-zone-use",
    playStyle: "defeat_zone",
    preset: {
      id: "zone-preset",
      modeId: "mama",
      productType: "defeat_zone",
    },
  };
  const browseFailure = await runAuthentication({
    browseFailure: true,
    activeUse: activeZoneUse,
    savedSession: { paidUseId: "paid-zone-use" },
  });
  assert.equal(browseFailure.targetState.authReady, true);
  assert.equal(browseFailure.targetState.authSettled, true);
  assert.equal(browseFailure.targetState.authError, "");
  assert.equal(browseFailure.targetState.activeUse, activeZoneUse);
  assert.equal(browseFailure.targetState.paidUseId, "paid-zone-use");
  assert.equal(browseFailure.targetState.playStyle, "defeat_zone");
  assert.equal(browseFailure.calls.browse, 1);
  assert.equal(browseFailure.calls.recover, 1);
  assert.equal(browseFailure.calls.render, 1);

  const failure = await runAuthentication({ failure: "persistence" });
  assert.equal(failure.targetState.authReady, false);
  assert.equal(failure.targetState.authSettled, true);
  assert.equal(failure.targetState.authError, "auth failed");
  assert.equal(failure.calls.recover, 1);
  assert.equal(failure.calls.render, 1);

  const paidFailure = await runAuthentication({
    failure: "persistence",
    savedSession: { paidUseId: "paid-use-under-recovery" },
  });
  assert.equal(paidFailure.targetState.authReady, false);
  assert.equal(paidFailure.targetState.authSettled, true);
  assert.equal(paidFailure.calls.recover, 0);
  assert.equal(paidFailure.calls.render, 1);

  assert.match(
    initializeSource,
    /const saved = storedSession\(\);[\s\S]*?if \(!saved\?\.paidUseId\) recoverPendingDefeatPresentation\(\)/,
  );
  assert.match(
    sourceBlock(client, "function continuePreparedSession", "function prepareStartSession"),
    /if \(hasUnverifiedPaidRecovery\(\)\)[\s\S]*?接続が戻ってから同じ利用を再開してください/,
  );

  const requestHomeSource = sourceBlock(client, "function requestHome", "function cleanup");
  function runRequestHome({ preservePaidRecovery }) {
    const calls = { clear: 0, cleanup: 0, home: 0 };
    const context = vm.createContext({
      active: true,
      state: {
        finishInFlight: false,
        finishPending: false,
        screen: "setup",
        phase: "idle",
        paidUseId: "",
      },
      window: {
        HariaiApp: {
          returnHome() {
            calls.home += 1;
          },
        },
        confirm: () => true,
      },
      hasUnverifiedPaidRecovery: () => preservePaidRecovery,
      clearPersistedSession() {
        calls.clear += 1;
      },
      cleanup() {
        calls.cleanup += 1;
      },
      completeSession() {},
      showToast() {},
    });
    vm.runInContext(`
      ${requestHomeSource}
      globalThis.__requestHome = requestHome;
    `, context);
    context.__requestHome();
    return calls;
  }

  assert.deepEqual(
    runRequestHome({ preservePaidRecovery: true }),
    { clear: 0, cleanup: 1, home: 1 },
  );
  assert.deepEqual(
    runRequestHome({ preservePaidRecovery: false }),
    { clear: 1, cleanup: 1, home: 1 },
  );
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
