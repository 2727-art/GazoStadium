"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("app.js");
const online = read("online.js");

function fn(source, name) {
  const start = new RegExp(`^( *)(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(start, `missing function ${name}`);
  const body = source.slice(start.index);
  const end = new RegExp(`\\n${start[1]}\\}\\r?\\n`).exec(body);
  assert.ok(end, `missing function end ${name}`);
  return body.slice(0, end.index + start[1].length + 2);
}

async function flush() { for (let n = 0; n < 30; n += 1) await Promise.resolve(); }

function lobbyHarness() {
  let now = 1000000;
  let timerId = 0;
  const timers = new Map();
  const listeners = new Map();
  const calls = [];
  const events = [];
  const fail = new Set();
  const fixtures = {
    presence: {
      one: { mode: "solo", state: "waiting", lastSeen: now },
      two: { mode: "strategy", state: "playing", lastSeen: now },
    },
    free: { welcomingRooms: 4, seatedRooms: 2 },
  };
  const context = vm.createContext({
    Date: { now: () => now }, database: {}, document: { querySelector: () => null },
    window: {
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, callback) { listeners.set(name, callback); },
      dispatchEvent(event) { events.push(event); },
    },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    useOfflineMarketPreview: false,
    LOBBY_MODES: ["solo", "strategy"], PUBLIC_PRESENCE_FRESH_MS: 45000,
    LOBBY_PUBLIC_STATS_REFRESH_COOLDOWN_MS: 30000, LOBBY_PUBLIC_STATS_REQUEST_TIMEOUT_MS: 20000,
    FREE_TABLE_PUBLIC_STATS_FUTURE_TOLERANCE_MS: 30000, FREE_TABLE_PUBLIC_STATS_STALE_MS: 180000,
    lobbyPresenceEntries: null, lobbyPublicStatsRefreshRequest: null,
    lobbyPublicStatsLastAttemptAt: 0, lobbyPublicStatsLastSuccessAt: 0,
    lobbyPublicStatsRefreshError: "", lobbyPublicStatsInitialRefreshStarted: false,
    lobbyPublicStatsUiTimer: null, lobbyPublicStatsRefreshGeneration: 0,
    freeTablePublicStats: { welcomingRooms: null, seatedRooms: null, updatedAt: null },
    freeTablePublicStatsLastSuccessAt: 0, lastFreeTablePublicStatsEventSignature: "",
    publicServerTimeOffset: 0, publicServerTimeOffsetReady: false,
    ref: (_db, reference) => reference,
    async get(reference) {
      calls.push(`get:${reference}`);
      if (fail.has(reference)) throw new Error("network failure");
      if (reference === ".info/serverTimeOffset") return { val: () => 0 };
      if (reference === "online/publicPresence") return { val: () => fixtures.presence };
      throw new Error(`unexpected get ${reference}`);
    },
    async freeTablePublicStatsCallable() {
      calls.push("call:freeTablePublicStats");
      if (fail.has("freeTable")) throw new Error("network failure");
      return { data: { ...fixtures.free, updatedAt: now } };
    },
    async aiTextTrainingPublicStatsCallable() { calls.push("call:aiTextTrainingPublicStats"); throw new Error("retired callable"); },
  });
  const createStart = online.indexOf("const createLobbyStats = (");
  const createEnd = online.indexOf("const createBattlePresenceCheckState", createStart);
  assert.ok(createStart >= 0 && createEnd > createStart);
  vm.runInContext(online.slice(createStart, createEnd) + [
    "getLobbyStats", "getLobbyStatsRefreshStatus", "normalizeFreeTablePublicStats", "loadFreeTablePublicStatsSnapshot",
    "refreshLobbyStats", "renderLobbyStats", "renderLobbyStatsRefreshStatus", "withLobbyPublicStatsTimeout",
    "refreshLobbyPublicStats", "watchLobbyStats",
  ].map((name) => fn(online, name)).join("\n"), context);
  return { context, calls, events, listeners, fixtures, fail, advance(ms) { now += ms; } };
}

const expectedBatch = [
  "get:.info/serverTimeOffset",
  "get:online/publicPresence",
  "call:freeTablePublicStats",
];

test("the initial lobby batch fetches the two active sources once and no retired market or training lights", async () => {
  const h = lobbyHarness();
  h.context.watchLobbyStats();
  await flush();
  assert.deepEqual(h.calls, expectedBatch);
  const stats = h.context.getLobbyStats();
  assert.equal(stats.solo.waiting, 1);
  assert.equal(stats.strategy.playing, 1);
  assert.equal(stats.freeTable.welcomingRooms, 4);
  assert.equal(Object.hasOwn(stats, "aiTextTraining"), false);
  assert.equal(Object.hasOwn(stats, "market"), false);
  assert.equal(h.context.getLobbyStatsRefreshStatus().error, "");
  assert.ok(h.events.some((event) => event.type === "hariai-free-table-public-stats-updated"));
  assert.equal(h.events.some((event) => event.type.includes("ai-text-training")), false);
  await h.context.refreshLobbyPublicStats({ initial: true });
  assert.deepEqual(h.calls, expectedBatch, "the initial batch is not repeated");
});

test("manual refresh preserves the 30-second cooldown and refreshes only the two active sources", async () => {
  const h = lobbyHarness();
  await h.context.refreshLobbyPublicStats({ initial: true });
  await h.context.refreshLobbyPublicStats();
  assert.deepEqual(h.calls, expectedBatch);
  assert.equal(h.context.getLobbyStatsRefreshStatus().cooldownRemainingMs, 30000);
  h.advance(30001);
  const first = h.context.refreshLobbyPublicStats();
  const second = h.context.refreshLobbyPublicStats();
  await Promise.all([first, second]);
  assert.deepEqual(h.calls, [...expectedBatch, ...expectedBatch], "overlapping manual refreshes stay coalesced");
});

test("landing redraw and visibility changes do not fetch any lobby source again", async () => {
  const h = lobbyHarness();
  h.context.watchLobbyStats();
  await flush();
  h.advance(60000);
  for (let n = 0; n < 5; n += 1) h.listeners.get("hariai-landing-rendered")();
  h.listeners.get("visibilitychange")?.();
  await flush();
  assert.deepEqual(h.calls, expectedBatch);
  assert.equal(h.listeners.has("visibilitychange"), false);
});

test("battle refresh failure preserves old battle counts and still refreshes free-table values", async () => {
  const h = lobbyHarness();
  await h.context.refreshLobbyPublicStats({ initial: true });
  h.advance(30001);
  h.fail.add("online/publicPresence");
  h.fixtures.free = { welcomingRooms: 6, seatedRooms: 1 };
  await h.context.refreshLobbyPublicStats();
  const stats = h.context.getLobbyStats();
  assert.equal(stats.solo.waiting, 1);
  assert.equal(stats.strategy.playing, 1);
  assert.equal(stats.freeTable.welcomingRooms, 6);
  assert.equal(Object.hasOwn(stats, "market"), false);
  assert.equal(h.context.getLobbyStatsRefreshStatus().error, "一部の状況を更新できませんでした。");
  assert.deepEqual(h.calls, [...expectedBatch, ...expectedBatch]);
});

test("free-table refresh failure preserves previous room counts while battle counts still update", async () => {
  const h = lobbyHarness();
  await h.context.refreshLobbyPublicStats({ initial: true });
  h.advance(30001);
  h.fail.add("freeTable");
  h.fixtures.presence = {
    three: { mode: "solo", state: "playing", lastSeen: h.context.Date.now() },
    four: { mode: "strategy", state: "waiting", lastSeen: h.context.Date.now() },
  };
  await h.context.refreshLobbyPublicStats();
  const stats = h.context.getLobbyStats();
  assert.equal(stats.solo.waiting, 0);
  assert.equal(stats.solo.playing, 1);
  assert.equal(stats.strategy.waiting, 1);
  assert.equal(stats.strategy.playing, 0);
  assert.equal(stats.freeTable.welcomingRooms, 4);
  assert.equal(stats.freeTable.seatedRooms, 2);
  assert.equal(Object.hasOwn(stats, "market"), false);
  assert.equal(h.context.getLobbyStatsRefreshStatus().error, "一部の状況を更新できませんでした。");
  assert.deepEqual(h.calls, [...expectedBatch, ...expectedBatch]);
});

test("failure of both active sources preserves the complete previous snapshot and last success time", async () => {
  const h = lobbyHarness();
  await h.context.refreshLobbyPublicStats({ initial: true });
  const previous = JSON.stringify(h.context.getLobbyStats());
  const lastUpdatedAt = h.context.getLobbyStatsRefreshStatus().lastUpdatedAt;
  h.advance(60001);
  h.fail.add("online/publicPresence");
  h.fail.add("freeTable");
  await h.context.refreshLobbyPublicStats();
  assert.equal(JSON.stringify(h.context.getLobbyStats()), previous, "old battle presence must not age into zero on failure");
  assert.equal(h.context.getLobbyStatsRefreshStatus().lastUpdatedAt, lastUpdatedAt);
  assert.equal(h.context.getLobbyStatsRefreshStatus().loading, false);
  assert.equal(h.context.getLobbyStatsRefreshStatus().error, "最新の状況を読み込めませんでした。通信を確認して、もう一度お試しください。");
  assert.deepEqual(h.calls, [...expectedBatch, ...expectedBatch]);
});

test("offline preview never performs the initial or manual lobby fetch", async () => {
  const h = lobbyHarness();
  h.context.useOfflineMarketPreview = true;
  await h.context.refreshLobbyPublicStats({ initial: true });
  await h.context.refreshLobbyPublicStats();
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.getLobbyStatsRefreshStatus().available, false);
});

test("rendered landing has no retired lights or market stats but retains active mode counts and market records", () => {
  const stats = {
    solo: { waiting: 2, playing: 4 }, strategy: { waiting: 1, playing: 2 },
    freeTable: { welcomingRooms: 3, seatedRooms: 1 },
  };
  Object.defineProperty(stats, "aiTextTraining", { get() { throw new Error("retired stats accessed"); } });
  Object.defineProperty(stats, "market", { get() { throw new Error("retired market stats accessed"); } });
  const context = vm.createContext({
    window: { HariaiOnline: { getLobbyStats: () => stats, getLobbyStatsRefreshStatus: () => ({ available: true }) } },
    escapeHtml: String,
    renderLandingTopMessagePanel: () => '<aside id="topMessagePanel"></aside>',
    renderLandingFleaPanel: () => '<aside class="landing-flea"></aside>',
  });
  vm.runInContext(["freeTableLampPresentation", "lobbyStatsRefreshPresentation", "renderLanding"].map((name) => fn(app, name)).join("\n"), context);
  const html = context.renderLanding();
  assert.doesNotMatch(html, /aiTextTrainingLights|training-lights|文字コラジムの灯り|TRAINING LIGHTS/);
  assert.doesNotMatch(html, /lobbyMarket|class="lobby-mode-card market"|market-counts|売り手待機|買い手待機|商談中/);
  assert.match(html, /id="valueMarketRankingButton"[^>]*>[\s\S]*?旧推し値市場の記録<\/button>/);
  assert.match(html, /id="aiTextTrainingButton"[^>]*><small>AIと対戦しよう<\/small><span>文字コラトレーニング<\/span>/);
  assert.match(html, /id="heroSoloWaitingCount">2<\/b>/);
  assert.match(html, /id="lobbyStrategyPlayingCount">2<\/span>/);
  assert.match(html, /id="lobbyFreeTableWelcomingCount">3<\/span>/);
  assert.match(html, /id="lobbyStatsRefreshButton"/);
  assert.match(html, /id="freeTableStatusButton"/);
  assert.match(app, /querySelector\("#aiTextTrainingButton"\)\?\.addEventListener\("click", startAiTextTraining\)/);
});

test("retired market lobby status has no read, import, private state, DOM wiring or stylesheet selector", () => {
  assert.doesNotMatch(online, /publicMarketPresence|market-presence\.mjs|summarizeMarketPresence|marketPresenceEntries|refreshMarket|lobbyStats\.market|lobbyMarket/);
  assert.doesNotMatch(app, /lobbyStats\.market|lobbyMarket|class="lobby-mode-card market"|market-counts/);
  for (const file of ["styles.css", "velvet.css"]) {
    assert.doesNotMatch(read(file), /\.lobby-mode-card\.market|\.lobby-mode-counts\.market-counts/, file);
  }
  const html = read("index.html");
  for (const file of ["app.js", "online.js", "styles.css"]) {
    assert.match(html, new RegExp(`${file.replaceAll(".", "\\.")}\\?v=[^\"]*retire-market-lobby-v1`), file);
  }
});

test("retired top-page lights have no callable, private state, event channel or stylesheet selector", () => {
  assert.doesNotMatch(online, /aiTextTrainingPublicStats|AiTextTrainingPublicStats|aiTrainingStats|hariai-ai-text-training-public-stats-updated/);
  assert.doesNotMatch(app, /[Aa]iTextTrainingLight|training-lights|文字コラジムの灯り|hariai-ai-text-training-public-stats-updated/);
  for (const file of ["styles.css", "velvet.css"]) assert.doesNotMatch(read(file), /training-light/, file);
  const html = read("index.html");
  for (const file of ["app.js", "online.js", "styles.css", "velvet.css"]) {
    assert.match(html, new RegExp(`${file.replaceAll(".", "\\.")}\\?v=[^\"]*retire-training-lights-v1`), file);
  }
});
