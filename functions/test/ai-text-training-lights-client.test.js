"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const app = read("app.js");
const html = read("index.html");
const online = read("online.js");
const client = read("ai-text-training.js");
const styles = read("styles.css");
const trainingStyles = read("ai-text-training.css");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function presenceHarness({ actionHandler } = {}) {
  const calls = [];
  const intervals = new Map();
  let nextIntervalId = 1;
  const state = {
    preview: false,
    screen: "play",
    phase: "playing",
    achievementSessionId: "a".repeat(40),
    trainingLightsDesiredActive: false,
    trainingLightsPresenceActive: false,
    trainingLightsPresenceRequest: null,
    trainingLightsSyncAgain: false,
    trainingLightsHeartbeatTimer: null,
    trainingLightsCloseRequested: false,
  };
  const document = {
    visibilityState: "visible",
    querySelector() {
      return null;
    },
  };
  const window = {
    clearInterval(id) {
      intervals.delete(id);
    },
    clearTimeout(id) {
      intervals.delete(id);
    },
    setInterval(callback, delay) {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, { callback, delay });
      return id;
    },
    setTimeout(callback, delay) {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, { callback, delay });
      return id;
    },
  };
  const context = vm.createContext({
    __state: state,
    document,
    window,
    async aiTextTrainingAction(payload) {
      calls.push({ ...payload });
      if (actionHandler) return await actionHandler(payload);
      return { data: { presenceUpdatedAt: 100, updatedAt: 100 } };
    },
  });
  const runtime = sourceBetween(
    client,
    "function aiTextTrainingLightsCanBeActive",
    "async function releaseWakeLock",
  );
  vm.runInContext(`
    let active = true;
    let state = globalThis.__state;
    const AI_TEXT_TRAINING_LIGHT_HEARTBEAT_MS = 20_000;
    const AI_TEXT_TRAINING_LIGHT_ENGAGED_PHASES = new Set([
      "countdown", "playing", "reaction", "next_preview",
      "zone_ready", "zone_rush", "zone_deceleration", "zone_cooldown",
    ]);
    ${runtime}
    globalThis.__api = {
      syncAiTextTrainingLightsPresence,
      aiTextTrainingLightsCanBeActive,
    };
  `, context);
  return { api: context.__api, calls, document, intervals, state };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

test("the landing presents training lights as anonymous companionship, outside matchmaking stats", () => {
  const heroActionsEnd = app.indexOf("</div>\n        ${renderAiTextTrainingLights(aiTextTrainingStats)}");
  const lobbyStatsStart = app.indexOf('<div class="mode-lobby-stats"');
  assert.ok(heroActionsEnd >= 0, "training lights follow the hero actions");
  assert.ok(lobbyStatsStart > heroActionsEnd, "training lights stay outside matchmaking cards");
  assert.match(app, /文字コラジムの灯り/);
  assert.match(app, /いま\$\{activeCount\}人が、それぞれの場所でトレーニング中/);
  assert.match(app, /あなたも、自分のペースでこの輪に加われます/);
  assert.doesNotMatch(app, /あなたが始めると、\$\{activeCount \+ 1\}人/);
  assert.match(app, /いまは静かな時間です。/);
  assert.match(app, /始めると、ここに最初の灯りがともります/);
  assert.match(app, /仲間の気配を確認しています…/);
  assert.match(app, /名前も画像も表示しない、匿名の仲間の気配です/);
  assert.match(app, /id="aiTextTrainingLightsStartButton"/);
  assert.match(
    app,
    /querySelector\("#aiTextTrainingLightsStartButton"\)\?\.addEventListener\("click", startAiTextTraining\)/,
  );
  assert.match(styles, /\.training-lights-card\s*\{/);
  assert.match(styles, /@keyframes training-light-breathe/);
  assert.match(styles, /prefers-reduced-motion:[\s\S]*?\.training-lights-dots i \{ animation: none; \}/);
  assert.match(html, /styles\.css\?v=[^"]*ai-training-lights-v1/);
  assert.match(html, /ai-text-training\.css\?v=[^"]*ai-training-lights-v1/);
  assert.match(html, /app\.js\?v=[^"]*ai-training-lights-v1/);
  assert.match(html, /online\.js\?v=[^"]*ai-training-lights-v1/);
  assert.match(html, /ai-text-training\.js\?v=[^"]*ai-training-lights-v1/);
});

test("public training stats are callable-polled, validated, expired by TTL, and exposed to the landing", () => {
  assert.match(online, /httpsCallable\(functions, "aiTextTrainingPublicStats"\)/);
  assert.match(online, /aiTextTraining:\s*\{ \.\.\.aiTextTrainingPublicStats \}/);
  assert.match(online, /aiTextTraining:\s*\{ \.\.\.lobbyStats\.aiTextTraining \}/);
  assert.match(online, /typeof hasRecentActivity !== "boolean"/);
  assert.match(online, /recentWindowMs < freshnessMs/);
  assert.match(online, /function aiTextTrainingPublicStatsExpiresAt/);
  assert.match(
    online,
    /return Math\.min\(refreshDelay, Math\.max\(0, expiresAt - Date\.now\(\)\)\)/,
  );
  assert.match(online, /hariai-ai-text-training-public-stats-updated/);
});

test("an engaged achievement session heartbeats every 20 seconds and confirms a neutral connection", async () => {
  const harness = presenceHarness();
  harness.api.syncAiTextTrainingLightsPresence();
  await flushPromises();
  await flushPromises();
  assert.deepEqual(harness.calls[0], {
    action: "heartbeat_achievement_session",
    sessionId: "a".repeat(40),
    active: true,
  });
  assert.equal(harness.intervals.size, 1);
  assert.equal([...harness.intervals.values()][0].delay, 20_000);
  assert.equal(harness.state.trainingLightsPresenceActive, true);
  assert.match(client, /あなたの灯りも、仲間の輪につながっています/);
  assert.doesNotMatch(client, /trainingLightsSessionCount|あなたを含め\$\{/);
  harness.state.phase = "paused";
  harness.api.syncAiTextTrainingLightsPresence({ forceInactive: true });
  assert.equal(harness.state.trainingLightsPresenceActive, false);
});

test("a session id arriving after pause cannot relight the user", async () => {
  let resolveActive;
  const harness = presenceHarness({
    actionHandler(payload) {
      if (!payload.active) return Promise.resolve({ data: {} });
      return new Promise((resolve) => {
        resolveActive = resolve;
      });
    },
  });
  harness.api.syncAiTextTrainingLightsPresence();
  await flushPromises();
  harness.state.phase = "paused";
  harness.api.syncAiTextTrainingLightsPresence({ forceInactive: true });
  resolveActive({ data: {} });
  await flushPromises();
  await flushPromises();
  assert.deepEqual(harness.calls.map((call) => call.active), [true, false]);
  assert.equal(harness.state.trainingLightsDesiredActive, false);
  assert.equal(harness.state.trainingLightsPresenceActive, false);
  assert.equal(harness.intervals.size, 0);
});

test("terminal cleanup permanently closes presence while pause and pagehide remain resumable", async () => {
  const harness = presenceHarness();
  harness.api.syncAiTextTrainingLightsPresence();
  await flushPromises();
  harness.api.syncAiTextTrainingLightsPresence({ forceInactive: true, close: true });
  await flushPromises();
  assert.deepEqual(harness.calls.slice(0, 2), [
    {
      action: "heartbeat_achievement_session",
      sessionId: "a".repeat(40),
      active: true,
    },
    {
      action: "close_achievement_presence",
      sessionId: "a".repeat(40),
    },
  ]);
  const pauseSource = sourceBetween(client, "function pauseSession", "function currentRoundElapsedSeconds");
  const pagehideSource = sourceBetween(
    client,
    'window.addEventListener("pagehide"',
    "window.HariaiAiTextTraining",
  );
  assert.doesNotMatch(pauseSource, /close:\s*true|close_achievement_presence/);
  assert.doesNotMatch(pagehideSource, /close:\s*true|close_achievement_presence/);
});

test("pause, background, result, and home paths explicitly turn the light off", () => {
  assert.match(client, /function pauseSession[\s\S]*?syncAiTextTrainingLightsPresence\(\{ forceInactive: true \}\)/);
  assert.match(client, /function pauseDefeatZone[\s\S]*?syncAiTextTrainingLightsPresence\(\{ forceInactive: true \}\)/);
  assert.match(client, /function completeSession[\s\S]*?state\.phase = "result";[\s\S]*?forceInactive: true/);
  assert.match(client, /function cleanup[\s\S]*?syncAiTextTrainingLightsPresence\(\{ forceInactive: true \}\)/);
  assert.match(client, /visibilitychange[\s\S]*?forceInactive: true/);
  assert.match(client, /pagehide[\s\S]*?forceInactive: true/);
  assert.match(client, /action: "close_achievement_presence"/);
  assert.match(client, /function completeSession[\s\S]*?forceInactive: true, close: true/);
  assert.match(client, /function finishDefeatPresentation[\s\S]*?forceInactive: true, close: true/);
  assert.match(client, /typeof syncAiTextTrainingLightsPresence === "function"[\s\S]*?syncAiTextTrainingLightsPresence\(\)/);
  assert.match(client, /あなたも、今日ここで頑張った一人です/);
  assert.match(trainingStyles, /\.ai-text-training-companion\s*\{/);
  assert.match(trainingStyles, /\.ai-text-training-light-result\s*\{/);
  assert.doesNotMatch(client, /RTCPeerConnection|RTCDataChannel|getDatabase|firebase-database/);
});

test("the result only claims a shared light after the first countdown requested begin", () => {
  const renderResultSource = sourceBetween(
    client,
    "function renderResult()",
    "function render()",
  );
  assert.match(renderResultSource, /\$\{renderAiTextTrainingLightResult\(\)\}/);
  const context = vm.createContext({
    __state: { achievementBeginRequested: false },
  });
  const resultLightRuntime = sourceBetween(
    client,
    "function renderAiTextTrainingLightResult",
    "function renderResult",
  );
  vm.runInContext(`
    let state = globalThis.__state;
    ${resultLightRuntime}
    globalThis.__renderLightResult = renderAiTextTrainingLightResult;
  `, context);
  assert.equal(context.__renderLightResult(), "");
  context.__state.achievementBeginRequested = true;
  const startedResult = context.__renderLightResult();
  assert.match(startedResult, /あなたも、今日ここで頑張った一人です/);
  assert.match(startedResult, /あなたの灯りが、次に始める誰かへ仲間の気配を残します/);
});

test("a persisted page restore resynchronizes presence for the recovered phase", () => {
  const pageshowSource = sourceBetween(
    client,
    'window.addEventListener("pageshow"',
    "window.HariaiAiTextTraining",
  );
  assert.match(
    pageshowSource,
    /if \(!active \|\| !event\.persisted\) return;[\s\S]*?render\(\);[\s\S]*?syncAiTextTrainingLightsPresence\(\)/,
  );
});

test("local play previews expose the companion without sending a heartbeat", () => {
  assert.match(client, /\["play", "reaction", "zone", "cooldown"\]\.includes\(requestedScreen\)[\s\S]*?state\.achievementBeginRequested = true/);
  assert.match(client, /const previewLightIsActive = requestedScreen !== "play";[\s\S]*?state\.trainingLightsDesiredActive = previewLightIsActive;[\s\S]*?state\.trainingLightsPresenceActive = previewLightIsActive/);
  assert.match(client, /if \(targetState\.preview \|\| !\/\^\[a-f0-9\]\{40\}\$\/u\.test\(sessionId\)\) \{[\s\S]*?return Promise\.resolve\(false\)/);
});
