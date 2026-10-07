"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const client = read("ai-text-training.js");
const runtime = client.slice(client.indexOf("function closeAiTextTrainingLightsPresence"), client.indexOf("async function releaseWakeLock"));

function harness({ handler, state: initial } = {}) {
  const calls = [];
  const intervals = [];
  const state = { preview: false, screen: "play", phase: "playing", achievementSessionId: "a".repeat(40), ...initial };
  const context = vm.createContext({ state, active: true,
    document: { visibilityState: "visible" },
    window: { setInterval: (...args) => intervals.push(args), clearInterval() {} },
    aiTextTrainingAction: async (payload) => { calls.push({ ...payload }); return handler ? handler(payload) : { data: {} }; },
  });
  vm.runInContext(`${runtime}\nthis.sync = syncAiTextTrainingLightsPresence; this.close = closeAiTextTrainingLightsPresence;`, context);
  return { calls, intervals, state, context, sync: context.sync, close: context.close };
}

test("training lights UI and public stats calls are retired from all current clients", () => {
  assert.doesNotMatch(read("app.js"), /renderAiTextTrainingLights|文字コラジムの灯り|aiTextTrainingLightsStartButton/);
  assert.doesNotMatch(read("online.js"), /httpsCallable\(functions, "aiTextTrainingPublicStats"\)|loadAiTextTrainingPublicStatsSnapshot/);
  assert.doesNotMatch(client, /heartbeat_achievement_session|AI_TEXT_TRAINING_LIGHT_HEARTBEAT_MS|trainingLightsHeartbeatTimer|sendAiTextTrainingLightsPresence/);
  assert.doesNotMatch(client, /ai-text-training-companion|ai-text-training-light-result|あなたの灯り|仲間の灯り/);
  assert.doesNotMatch(read("ai-text-training.css"), /\.ai-text-training-companion|\.ai-text-training-light-result|ai-text-training-light-breathe/);
  assert.match(client, /action: "begin_achievement_session"/);
  assert.match(client, /action: "finish_achievement_session"/);
  assert.match(client, /action: "close_achievement_presence"/);
});

test("live phases, visibility and repeated 20 second refresh hooks never heartbeat or allocate an interval", async () => {
  const h = harness();
  for (const phase of ["countdown", "playing", "reaction", "next_preview", "paused", "zone_ready", "zone_rush", "zone_deceleration", "zone_cooldown", "zone_paused"]) {
    h.state.phase = phase;
    await h.sync();
    h.context.document.visibilityState = "hidden";
    await h.sync({ forceInactive: true });
    h.context.document.visibilityState = "visible";
    await h.sync();
  }
  for (let elapsed = 20_000; elapsed <= 300_000; elapsed += 20_000) await h.sync();
  assert.equal(h.calls.length, 0);
  assert.equal(h.intervals.length, 0);
});

test("terminal cleanup coalesces pending calls and completed closes without ending resumable pause", async () => {
  let resolve;
  const h = harness({ handler: () => new Promise((done) => { resolve = done; }) });
  await h.sync({ forceInactive: true });
  assert.equal(h.calls.length, 0);
  const first = h.sync({ close: true });
  assert.equal(h.sync({ close: true }), first);
  assert.equal(h.calls.length, 1);
  resolve({ data: {} });
  assert.equal(await first, true);
  await h.sync();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { action: "close_achievement_presence", sessionId: "a".repeat(40) });
});

test("close requested before begin resolves stays pending and closes the late session exactly once", async () => {
  const h = harness({ state: { achievementSessionId: "" } });
  await h.sync({ close: true });
  assert.equal(h.calls.length, 0);
  h.state.achievementSessionId = "a".repeat(40);
  await h.sync();
  await h.sync();
  assert.equal(h.calls.length, 1);
});

test("a stale close response cannot overwrite the new session's close bookkeeping", async () => {
  const resolvers = new Map();
  const h = harness({ handler: (payload) => new Promise((done) => resolvers.set(payload.sessionId, done)) });
  const first = h.close(h.state);
  h.state.achievementSessionId = "b".repeat(40);
  const second = h.close(h.state);
  resolvers.get("b".repeat(40))({ data: {} });
  await second;
  resolvers.get("a".repeat(40))({ data: {} });
  await first;
  assert.equal(h.state.trainingLightsClosedSessionId, "b".repeat(40));
  await h.close(h.state);
  assert.equal(h.calls.length, 2);
});

test("failed cleanup is retryable and preview sessions never call the server", async () => {
  let fail = true;
  const h = harness({ handler: async () => { if (fail) throw new Error("offline"); return { data: {} }; } });
  assert.equal(await h.sync({ close: true }), false);
  fail = false;
  assert.equal(await h.sync(), true);
  assert.equal(h.calls.length, 2);
  const preview = harness({ state: { preview: true, screen: "result" } });
  await preview.sync({ close: true });
  assert.equal(preview.calls.length, 0);
});

test("finish, exit and home retain terminal close hooks while page hide only pauses", () => {
  for (const start of ["function completeSession", "function finishDefeatPresentation", "function cleanup"]) {
    const source = client.slice(client.indexOf(start), client.indexOf("\nfunction ", client.indexOf(start) + start.length));
    assert.match(source, /syncAiTextTrainingLightsPresence\(\{ forceInactive: true, close: true \}\)/);
  }
  const pagehide = client.slice(client.indexOf('window.addEventListener("pagehide"'), client.indexOf('window.addEventListener("pageshow"'));
  assert.doesNotMatch(pagehide, /close:\s*true|close_achievement_presence/);
  assert.match(pagehide, /persistSession\(\)/);
  assert.match(pagehide, /stopRuntimeTimers\(\)/);
});
