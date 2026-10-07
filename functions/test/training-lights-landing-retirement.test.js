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
  const start = new RegExp("^( *)(?:async )?function " + name + "\\(", "m").exec(source);
  assert.ok(start, "missing function " + name);
  const body = source.slice(start.index);
  const end = new RegExp("\\n" + start[1] + "\\}\\r?\\n").exec(body);
  assert.ok(end, "missing function end " + name);
  return body.slice(0, end.index + start[1].length + 2);
}

async function flush() { for (let n = 0; n < 40; n += 1) await Promise.resolve(); }

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function lobbyHarness() {
  let now = 1000000;
  let timerId = 0;
  let resultVisible = false;
  const timers = new Map();
  const listeners = new Map();
  const calls = [];
  const events = [];
  const fail = new Set();
  const hold = new Map();
  const countNodes = new Map([
    "heroSoloWaitingCount", "heroSoloPlayingCount",
    "boardSoloWaitingCount", "boardSoloPlayingCount",
    "boardStrategyWaitingCount", "boardStrategyPlayingCount",
    "boardFreeTableWelcomingCount", "boardFreeTableSeatedCount",
  ].map((id) => ["#" + id, { textContent: "--" }]));
  const title = { textContent: "貼り合い自由卓" };
  const sub = { textContent: "勝ち負けを置いて、ひと休み" };
  const button = {
    dataset: {}, attributes: {}, lit: false,
    querySelector(selector) {
      if (selector === ".vl-post-sub") return sub;
      if (selector === ".vl-post-title") return title;
      throw new Error("untargeted entrance child: " + selector);
    },
    classList: { toggle(_class, lit) { button.lit = lit; } },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const fixtures = {
    presence: {
      one: { mode: "solo", state: "waiting", lastSeen: now },
      two: { mode: "strategy", state: "playing", lastSeen: now },
    },
    free: { welcomingRooms: 4, seatedRooms: 2 },
  };
  const context = vm.createContext({
    Date: { now: () => now }, database: {}, currentScreen: "landing",
    document: {
      visibilityState: "visible",
      querySelector(selector) {
        if (selector === "#freeTableButton") return button;
        if (selector === "[data-free-table-lamp-refresh]") return resultVisible ? {} : null;
        return countNodes.get(selector) || null;
      },
    },
    window: {
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      },
      dispatchEvent(event) {
        events.push(event);
        for (const callback of listeners.get(event.type) || []) callback(event);
      },
    },
    CustomEvent: class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } },
    useOfflineMarketPreview: false,
    LOBBY_MODES: ["solo", "strategy"], PUBLIC_PRESENCE_FRESH_MS: 45000,
    LOBBY_PUBLIC_STATS_REQUEST_TIMEOUT_MS: 20000,
    FREE_TABLE_PUBLIC_STATS_FUTURE_TOLERANCE_MS: 30000, FREE_TABLE_PUBLIC_STATS_STALE_MS: 180000,
    lobbyPresenceEntries: null, lobbyInitialStatsRequest: null,
    freeTablePublicStats: { welcomingRooms: null, seatedRooms: null, updatedAt: null },
    freeTablePublicStatsRequest: null,
    freeTablePublicStatsLastSuccessAt: 0, lastFreeTablePublicStatsEventSignature: "",
    publicServerTimeOffset: 0, publicServerTimeOffsetReady: false,
    ref: (_db, reference) => reference,
    async get(reference) {
      calls.push("get:" + reference);
      if (hold.has(reference)) await hold.get(reference).promise;
      if (fail.has(reference)) throw new Error("network failure");
      if (reference === ".info/serverTimeOffset") return { val: () => 0 };
      if (reference === "online/publicPresence") return { val: () => fixtures.presence };
      throw new Error("unexpected get " + reference);
    },
    async freeTablePublicStatsCallable() {
      calls.push("call:freeTablePublicStats");
      if (hold.has("freeTable")) await hold.get("freeTable").promise;
      if (fail.has("freeTable")) throw new Error("network failure");
      return { data: { ...fixtures.free, updatedAt: now } };
    },
    async aiTextTrainingPublicStatsCallable() { calls.push("call:aiTextTrainingPublicStats"); throw new Error("retired callable"); },
  });
  const createStart = online.indexOf("const createLobbyStats = (");
  const createEnd = online.indexOf("const createBattlePresenceCheckState", createStart);
  assert.ok(createStart >= 0 && createEnd > createStart);
  vm.runInContext(online.slice(createStart, createEnd) + [
    "getLobbyStats", "normalizeFreeTablePublicStats", "loadFreeTablePublicStatsSnapshot",
    "refreshLobbyStats", "renderLobbyStats", "withLobbyPublicStatsTimeout",
    "loadInitialLobbyStats", "watchLobbyStats", "canRefreshFreeTablePublicStats",
    "freeTablePublicStatsAreExpired", "expireFreeTablePublicStats",
    "refreshFreeTablePublicStats", "refreshFreeTablePublicStatsImmediately", "getFreeTableLampState",
  ].map((name) => fn(online, name)).join("\n"), context);
  context.window.HariaiOnline = { getLobbyStats: context.getLobbyStats };
  vm.runInContext(["freeTableLampPresentation", "updateLandingFreeTableEntrance"].map((name) => fn(app, name)).join("\n"), context);
  const listener = app.split("\n").find((line) => line.includes('"hariai-lobby-stats-updated", updateLandingFreeTableEntrance'));
  assert.ok(listener, "landing observes only its initial snapshot channel");
  vm.runInContext(listener, context);
  return {
    context, calls, events, listeners, fixtures, fail, hold, countNodes, button, title, sub, timers,
    advance(ms) { now += ms; },
    setResultVisible(value) { resultVisible = value; },
    dispatch(type) { context.window.dispatchEvent({ type }); },
    fireTimers(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
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
  assert.equal(h.events.filter((event) => event.type === "hariai-lobby-stats-updated").length, 1);
  assert.ok(h.events.some((event) => event.type === "hariai-free-table-public-stats-updated"));
  assert.equal(h.events.some((event) => event.type.includes("ai-text-training")), false);
  assert.equal(h.countNodes.get("#boardFreeTableWelcomingCount").textContent, "4");
  assert.equal(h.button.dataset.freeTableIntent, "lamp");
  assert.match(h.button.attributes["aria-label"], /ページ表示時点では4卓がお迎え中でした/);
  assert.match(h.sub.textContent, /ページ表示時、4卓がお迎え中でした/);
});

test("pending calls coalesce and the same settled promise prevents all subsequent initial batches", async () => {
  const h = lobbyHarness();
  const offset = deferred();
  h.hold.set(".info/serverTimeOffset", offset);
  const first = h.context.loadInitialLobbyStats();
  const second = h.context.loadInitialLobbyStats();
  assert.strictEqual(first, second);
  await flush();
  assert.deepEqual(h.calls, expectedBatch.slice(0, 1));
  offset.resolve();
  await Promise.all([first, second]);
  const snapshot = JSON.stringify(h.context.getLobbyStats());
  h.advance(86400000);
  h.fixtures.free.welcomingRooms = 99;
  assert.strictEqual(h.context.loadInitialLobbyStats(), first);
  await h.context.loadInitialLobbyStats();
  assert.deepEqual(h.calls, expectedBatch);
  assert.equal(JSON.stringify(h.context.getLobbyStats()), snapshot, "stored counts do not age into false zeroes");
});

test("landing redraw and tab visibility do not fetch; a fresh page context fetches once again", async () => {
  const h = lobbyHarness();
  h.context.watchLobbyStats();
  await flush();
  h.advance(60000);
  for (let n = 0; n < 5; n += 1) h.dispatch("hariai-landing-rendered");
  h.dispatch("visibilitychange");
  await flush();
  assert.deepEqual(h.calls, expectedBatch);
  assert.equal(h.listeners.has("visibilitychange"), false);
  const nextPage = lobbyHarness();
  await nextPage.context.loadInitialLobbyStats();
  assert.deepEqual(nextPage.calls, expectedBatch);
});

test("failed battle presence remains unknown while successful free-table counts are displayed", async () => {
  const h = lobbyHarness();
  h.fail.add("online/publicPresence");
  await h.context.loadInitialLobbyStats();
  const stats = h.context.getLobbyStats();
  assert.equal(stats.solo.waiting, null);
  assert.equal(stats.strategy.playing, null);
  assert.equal(stats.freeTable.welcomingRooms, 4);
  assert.equal(h.countNodes.get("#boardSoloWaitingCount").textContent, "--");
  assert.equal(h.countNodes.get("#heroSoloPlayingCount").textContent, "--");
  assert.equal(h.countNodes.get("#boardFreeTableWelcomingCount").textContent, "4");
  h.fail.clear();
  h.advance(30001);
  await h.context.loadInitialLobbyStats();
  assert.deepEqual(h.calls, expectedBatch, "failure must not enable a retry");
});

test("failed free-table counts remain unknown while battle counts still display", async () => {
  const h = lobbyHarness();
  h.fail.add("freeTable");
  await h.context.loadInitialLobbyStats();
  const stats = h.context.getLobbyStats();
  assert.equal(stats.solo.waiting, 1);
  assert.equal(stats.strategy.playing, 1);
  assert.equal(stats.freeTable.welcomingRooms, null);
  assert.equal(stats.freeTable.seatedRooms, null);
  assert.equal(h.countNodes.get("#boardFreeTableWelcomingCount").textContent, "--");
  assert.equal(h.countNodes.get("#boardFreeTableSeatedCount").textContent, "--");
  assert.equal(h.button.dataset.freeTableIntent, "hall");
});

test("failure of both active sources is retained without retries or false zero counts", async () => {
  const h = lobbyHarness();
  h.fail.add("online/publicPresence");
  h.fail.add("freeTable");
  const first = h.context.loadInitialLobbyStats();
  await first;
  const snapshot = JSON.stringify(h.context.getLobbyStats());
  h.fail.clear();
  h.advance(60001);
  assert.strictEqual(h.context.loadInitialLobbyStats(), first);
  await h.context.loadInitialLobbyStats();
  assert.equal(JSON.stringify(h.context.getLobbyStats()), snapshot);
  for (const node of h.countNodes.values()) assert.equal(node.textContent, "--");
  assert.deepEqual(h.calls, expectedBatch);
});

test("offline preview performs no initial fetch and returns unknown lobby counts", async () => {
  const h = lobbyHarness();
  h.context.useOfflineMarketPreview = true;
  h.context.watchLobbyStats();
  await flush();
  await h.context.loadInitialLobbyStats();
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.getLobbyStats().solo.waiting, null);
  assert.equal(h.context.getLobbyStats().freeTable.welcomingRooms, null);
});

test("offset timeout is bounded and does not prevent the one active-source batch", async () => {
  const h = lobbyHarness();
  const offset = deferred();
  h.hold.set(".info/serverTimeOffset", offset);
  const request = h.context.loadInitialLobbyStats();
  await flush();
  assert.deepEqual(h.calls, expectedBatch.slice(0, 1));
  h.fireTimers(3000);
  await request;
  assert.deepEqual(h.calls, expectedBatch);
  assert.equal(h.context.getLobbyStats().solo.waiting, 1);
  assert.equal(h.context.publicServerTimeOffsetReady, false);
  offset.resolve();
  await flush();
  assert.equal(h.context.publicServerTimeOffsetReady, false, "late offset cannot mutate the saved snapshot");
  await h.context.loadInitialLobbyStats();
  assert.deepEqual(h.calls, expectedBatch);
});

test("source timeout keeps unknown counts and late replies cannot repaint or restart the initial snapshot", async () => {
  const h = lobbyHarness();
  const presence = deferred();
  const free = deferred();
  h.hold.set("online/publicPresence", presence);
  h.hold.set("freeTable", free);
  const request = h.context.loadInitialLobbyStats();
  await flush();
  h.fireTimers(20000);
  await request;
  const snapshot = JSON.stringify(h.context.getLobbyStats());
  for (const node of h.countNodes.values()) assert.equal(node.textContent, "--");
  presence.resolve();
  free.resolve();
  await flush();
  assert.equal(JSON.stringify(h.context.getLobbyStats()), snapshot);
  assert.strictEqual(h.context.loadInitialLobbyStats(), request);
  assert.deepEqual(h.calls, expectedBatch);
});

test("result-screen refresh and expiry leave homepage snapshot counts and entrance aria unchanged", async () => {
  const h = lobbyHarness();
  await h.context.loadInitialLobbyStats();
  const snapshot = JSON.stringify(h.context.getLobbyStats());
  const initialAria = h.button.attributes["aria-label"];
  const initialSub = h.sub.textContent;
  h.advance(1000);
  h.fixtures.free = { welcomingRooms: 9, seatedRooms: 5 };
  h.setResultVisible(true);
  await h.context.refreshFreeTablePublicStatsImmediately();
  assert.equal(h.context.getFreeTableLampState().welcomingRooms, 9, "result screen uses its fresh independent counts");
  assert.equal(JSON.stringify(h.context.getLobbyStats()), snapshot);
  assert.equal(h.countNodes.get("#boardFreeTableWelcomingCount").textContent, "4");
  assert.equal(h.button.attributes["aria-label"], initialAria);
  assert.equal(h.sub.textContent, initialSub);
  h.advance(180001);
  h.context.expireFreeTablePublicStats();
  assert.equal(h.context.getFreeTableLampState().available, false);
  assert.equal(JSON.stringify(h.context.getLobbyStats()), snapshot);
  assert.equal(h.button.attributes["aria-label"], initialAria);
  assert.equal(h.events.filter((event) => event.type === "hariai-lobby-stats-updated").length, 1);
  assert.deepEqual(h.calls, [...expectedBatch, "call:freeTablePublicStats"]);
});

test("a slow initial presence response cannot overwrite newer result-screen room counts", async () => {
  const h = lobbyHarness();
  const presence = deferred();
  h.hold.set("online/publicPresence", presence);
  const initial = h.context.loadInitialLobbyStats();
  await flush();
  assert.deepEqual(h.calls, expectedBatch);
  h.advance(1000);
  h.fixtures.free = { welcomingRooms: 7, seatedRooms: 6 };
  h.setResultVisible(true);
  await h.context.refreshFreeTablePublicStatsImmediately();
  assert.equal(h.context.getFreeTableLampState().welcomingRooms, 7);
  presence.resolve();
  await initial;
  assert.equal(h.context.getLobbyStats().freeTable.welcomingRooms, 4, "homepage keeps the initial room snapshot");
  assert.equal(h.context.getFreeTableLampState().welcomingRooms, 7, "newer result cache is not rolled back");
  assert.equal(h.countNodes.get("#boardFreeTableWelcomingCount").textContent, "4");
  assert.match(h.button.attributes["aria-label"], /ページ表示時点では4卓/);
});

test("getLobbyStats returns defensive copies of all homepage snapshot values", async () => {
  const h = lobbyHarness();
  await h.context.loadInitialLobbyStats();
  const returned = h.context.getLobbyStats();
  returned.solo.waiting = 100;
  returned.strategy.playing = 100;
  returned.freeTable.welcomingRooms = 100;
  const stats = h.context.getLobbyStats();
  assert.equal(stats.solo.waiting, 1);
  assert.equal(stats.strategy.playing, 1);
  assert.equal(stats.freeTable.welcomingRooms, 4);
});

test("rendered landing retains entry counts and history without any duplicate panel or retired stats", () => {
  const stats = {
    solo: { waiting: 2, playing: 4 }, strategy: { waiting: 1, playing: 2 },
    freeTable: { welcomingRooms: 3, seatedRooms: 1 },
  };
  Object.defineProperty(stats, "aiTextTraining", { get() { throw new Error("retired stats accessed"); } });
  Object.defineProperty(stats, "market", { get() { throw new Error("retired market stats accessed"); } });
  const context = vm.createContext({
    window: { HariaiOnline: { getLobbyStats: () => stats } },
    escapeHtml: String,
    renderLandingTopMessagePanel: () => '<aside id="topMessagePanel"></aside>',
  });
  vm.runInContext(["freeTableLampPresentation", "renderLanding"].map((name) => fn(app, name)).join("\n"), context);
  const html = context.renderLanding();
  assert.doesNotMatch(html, /aiTextTrainingLights|training-lights|文字コラジムの灯り|TRAINING LIGHTS/);
  assert.doesNotMatch(html, /lobbyMarket|lobby-mode-card|market-counts|売り手待機|買い手待機|商談中/);
  assert.doesNotMatch(html, /vl-live-board|いまの参加状況|lobbyStatsRefresh|freeTableStatusButton|最新の状況を読み込む/);
  assert.match(html, /id="valueMarketRankingButton"[^>]*>[\s\S]*?旧推し値市場の記録<\/button>/);
  assert.match(html, /id="aiTextTrainingButton"[^>]*><small>AIと対戦しよう<\/small><span>文字コラトレーニング<\/span>/);
  assert.match(html, /id="heroSoloWaitingCount">2<\/b>/);
  assert.match(html, /id="boardSoloWaitingCount">2<\/b>/);
  assert.match(html, /id="boardStrategyPlayingCount">2<\/b>/);
  assert.match(html, /id="boardFreeTableWelcomingCount">3<\/b>/);
  assert.match(html, /人数・卓数はページ表示時点の参考値/);
  assert.match(app, /querySelector\("#aiTextTrainingButton"\)\?\.addEventListener\("click", startAiTextTraining\)/);
  context.window.HariaiOnline.getLobbyStats = () => ({});
  const unknown = context.renderLanding();
  for (const id of ["heroSoloWaitingCount", "boardSoloPlayingCount", "boardStrategyPlayingCount", "boardFreeTableWelcomingCount", "boardFreeTableSeatedCount"]) {
    assert.ok(unknown.includes('id="' + id + '">--</b>'), id);
  }
});

test("retired market lobby status has no read, import, private state, DOM wiring or stylesheet selector", () => {
  assert.doesNotMatch(online, /publicMarketPresence|market-presence\.mjs|summarizeMarketPresence|marketPresenceEntries|refreshMarket|lobbyStats\.market|lobbyMarket/);
  assert.doesNotMatch(app, /lobbyStats\.market|lobbyMarket|class="lobby-mode-card market"|market-counts/);
  for (const file of ["styles.css", "velvet.css"]) assert.doesNotMatch(read(file), /\.lobby-mode-card\.market|\.lobby-mode-counts\.market-counts/, file);
  for (const file of ["app.js", "online.js", "styles.css"]) {
    const line = read("index.html").split("\n").find((value) => value.includes(file + "?v="));
    assert.match(line, /retire-market-lobby-v1/, file);
  }
});

test("retired top-page lights have no callable, private state, event channel or stylesheet selector", () => {
  assert.doesNotMatch(online, /aiTextTrainingPublicStats|AiTextTrainingPublicStats|aiTrainingStats|hariai-ai-text-training-public-stats-updated/);
  assert.doesNotMatch(app, /[Aa]iTextTrainingLight|training-lights|文字コラジムの灯り|hariai-ai-text-training-public-stats-updated/);
  for (const file of ["styles.css", "velvet.css"]) assert.doesNotMatch(read(file), /training-light/, file);
  for (const file of ["app.js", "online.js", "styles.css", "velvet.css"]) {
    const line = read("index.html").split("\n").find((value) => value.includes(file + "?v="));
    assert.match(line, /retire-training-lights-v1/, file);
  }
});
