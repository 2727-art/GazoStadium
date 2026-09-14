const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function harness(handler = async () => ({})) {
  const calls = [];
  const storage = new Map();
  const buttons = new Map();
  let authListener;
  let eventListener;
  const panel = {
    open: false, innerHTML: "", setAttribute() {}, addEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    querySelector(selector) { return { addEventListener(type, callback) { buttons.set(`${selector}:${type}`, callback); } }; },
  };
  const sandbox = {
    console, Set, Map, Date, Promise, JSON, Number, String, Boolean, Object, Array,
    encodeURIComponent, decodeURIComponent,
    crypto: { randomUUID: () => "01234567-0123-4123-8123-012345678901" },
    auth: { currentUser: { uid: "alice" } }, database: {}, functions: {}, useOfflineMarketPreview: false,
    httpsCallable: () => async (payload) => { calls.push(payload); return { data: await handler(payload) }; },
    onAuthStateChanged: (auth, callback) => { authListener = callback; },
    signInAnonymously: async () => { throw new Error("unexpected sign in"); },
    ref: (_, value) => value,
    onValue: (_, callback) => { eventListener = callback; return () => {}; },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    document: { activeElement: null, addEventListener() {}, createElement: () => panel, body: { appendChild() {} } },
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value?.detail; } },
    window: { clearTimeout() {}, setTimeout: () => 1, addEventListener() {}, dispatchEvent() {}, confirm: () => true },
  };
  const source = fs.readFileSync(path.resolve(__dirname, "../../player-safety.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/export (async )?function /g, "$1function ");
  vm.runInNewContext(`${source}\n globalThis.testing = { openBlock, sendPending, filterPublicEntries, renderBlockButton, setActiveContact, clearActiveContact, requestSafety, checkContacts, pendingText, pending: () => pending };`, sandbox);
  authListener(sandbox.auth.currentUser);
  return {
    api: sandbox.testing, calls, panel, storage,
    confirm: () => buttons.get("[data-player-safety-confirm]:click")?.(),
    switchUser(uid) { sandbox.auth.currentUser = { uid }; authListener(sandbox.auth.currentUser); },
    signal(version) { eventListener({ val: () => ({ version }) }); },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("confirm immediately closes only the selected contact before the network block completes", async () => {
  let resolveBlock;
  const order = [];
  const env = harness(async (payload) => {
    if (payload.action === "get_context") return { contextId: "context", name: "相手", version: 3 };
    if (payload.action === "block") {
      order.push("network");
      return new Promise((resolve) => { resolveBlock = resolve; });
    }
    return {};
  });
  await env.api.openBlock({ mode: "solo", roomId: "room" }, { stopContact: () => order.push("stopped") });
  env.confirm();
  await settle();
  assert.deepEqual(order, ["stopped", "network"]);
  assert.match(env.panel.innerHTML, /保存しています/);
  assert.equal(env.api.pending().payload.expectedVersion, 3);
  resolveBlock({ status: "pending", blocked: true, version: 4 });
  await settle();
  assert.match(env.panel.innerHTML, /反映しています/);
  assert.doesNotMatch(env.panel.innerHTML, /ブロックしました。/);
});

test("uncertain block response is inspected and retried with the same operation identity", async () => {
  let blocks = 0;
  const env = harness(async (payload) => {
    if (payload.action === "get_context") return { contextId: "context", version: 0 };
    if (payload.action === "get_operation") throw Object.assign(new Error("missing"), { code: "functions/not-found" });
    if (payload.action === "block" && ++blocks === 1) throw new Error("network");
    return { status: "complete", blocked: true, version: 1 };
  });
  await env.api.openBlock({ mode: "solo", roomId: "room" });
  env.confirm();
  await settle();
  const first = env.calls.find((call) => call.action === "block");
  assert.ok(env.api.pending());
  await env.api.sendPending({ inspectFirst: true });
  const repeated = env.calls.filter((call) => call.action === "block");
  assert.equal(repeated.length, 2);
  assert.equal(repeated[1].requestId, first.requestId);
  assert.equal(repeated[1].contextId, first.contextId);
  assert.equal(env.api.pending(), null);
});

test("responses and pending operations from the previous account cannot affect a new account", async () => {
  let resolveRequest;
  const env = harness(() => new Promise((resolve) => { resolveRequest = resolve; }));
  const request = env.api.requestSafety("list");
  await settle();
  env.switchUser("bob");
  resolveRequest({ entries: [{ name: "alice private block" }] });
  await assert.rejects(request, /アカウントが切り替わりました/);
  assert.equal(env.api.pending(), null);
});

test("a safety event checks each session and keeps unrelated contacts connected", async () => {
  const closed = [];
  const env = harness(async (payload) => ({ available: payload.roomId !== "blocked-room" }));
  env.api.setActiveContact("solo", { roomId: "blocked-room", stopContact: () => closed.push("solo") });
  env.api.setActiveContact("market", { roomId: "unrelated-room", stopContact: () => closed.push("market") });
  await env.api.checkContacts();
  assert.deepEqual(closed, ["solo"]);
  assert.equal(env.calls.filter((call) => call.action === "contact_status").length, 2);
});

test("ranking masks preserve rank and score while hiding text and links; shelves omit hidden rows", async () => {
  const env = harness(async () => ({ hiddenIds: ["hidden"] }));
  const entries = [{ entryId: "visible", name: "見える人", rank: 1 }, { entryId: "hidden", name: "秘密の名前", rank: 2, rating: 1500, text: "秘密の本文", xHandle: "private", commentsEnabled: true }];
  const masked = await env.api.filterPublicEntries("ranking", entries, "entryId", { mask: true });
  assert.equal(masked[1].name, "非表示のプレイヤー");
  assert.equal(masked[1].rank, 2);
  assert.equal(masked[1].rating, 1500);
  assert.equal(masked[1].xHandle, "");
  assert.equal(masked[1].commentsEnabled, false);
  const shelf = await env.api.filterPublicEntries("card", entries);
  assert.equal(shelf.length, 1);
  assert.equal(shelf[0].entryId, "visible");
});

test("the ranking comment UI no longer writes or reads the public comments path", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../online.js"), "utf8");
  const comments = source.slice(source.indexOf("async function getLeaderboardComments"), source.indexOf("function normalizePublicLobbyCount"));
  assert.match(comments, /requestSafety\("comments_list"/);
  assert.match(comments, /requestSafety\("comments_save"/);
  assert.match(comments, /requestSafety\("comments_delete"/);
  assert.doesNotMatch(comments, /online\/leaderboardComments/);
});

function functionSection(file, start, end) {
  const source = fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

test("strategy cuts live channels synchronously while the departure request is unresolved", () => {
  const order = [];
  const source = functionSection("strategy.js", "async function cleanupOnlineResources", "function releaseMatchMedia");
  const state = {
    roomId: "room", uid: "alice", roomUnsubscribers: [() => order.push("listeners")], disconnectHandles: [],
    peer: { close: () => order.push("peer") }, channel: { close: () => order.push("image") },
    videoChannel: { close: () => order.push("video") }, reviewAssetChannel: { close: () => order.push("review") },
  };
  const sandbox = { state,
    clearActiveContact: () => order.push("registry"), stopReviewClock() {}, stopStrategyVideoRecording() {},
    cleanupMatchmaking: () => { order.push("network"); return new Promise(() => {}); }, cleanupPublicPresence: async () => {},
  };
  vm.runInNewContext(`${source}\n globalThis.cleanup = cleanupOnlineResources;`, sandbox);
  sandbox.cleanup(false);
  assert.deepEqual(order, ["registry", "listeners", "peer", "image", "video", "review", "network"]);
  assert.equal(state.peer, null);
  assert.equal(state.channel, null);
});

test("strategy retries restore the original room-bound weakness secret", async () => {
  const source = functionSection("strategy.js", "async function safetyPlayerRoomRecord", "async function createOffer");
  const state = {};
  let records = 0;
  const sandbox = { state, Map, async playerRoomRecord(roomId) {
    records += 1; state.weaknessSalt = `salt-${roomId}`;
    return { weaknessCommit: `commit-${roomId}` };
  } };
  vm.runInNewContext(`${source}\n globalThis.record = safetyPlayerRoomRecord;`, sandbox);
  await sandbox.record("first"); await sandbox.record("second"); await sandbox.record("first");
  assert.equal(records, 2);
  assert.equal(state.weaknessSalt, "salt-first");
  assert.equal(state.weaknessCommit, "commit-first");
});

test("hidden roulette ranking slots preserve rank statistics and have no contact or purchase action", () => {
  const source = functionSection("roulette-training.js", "function rankingPayloadFromServer", "function creatorStatsFromServer");
  const renderer = functionSection("roulette-training.js", "function rankingRow", "function renderRankingPanel");
  const sandbox = {
    state: { rankingPeriod: "monthly" }, RANKING_PERIODS: ["monthly", "lifetime"],
    nonnegativeInteger: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    publicXProfile: () => ({ xPublic: false, xHandle: "" }), escapeHtml: String,
    xProfileLink: () => "", renderBlockButton: () => { throw new Error("hidden rows must not create a block control"); },
  };
  vm.runInNewContext(`${source}\n${renderer}\n globalThis.parse = rankingPayloadFromServer; globalThis.render = rankingRow;`, sandbox);
  const result = sandbox.parse({ rows: [{ hidden: true, rank: 1, packId: "", sellerName: "非表示のプレイヤー", uniqueBuyers: 5, rankingUseCount: 8 }] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].rank, 1);
  assert.equal(result.rows[0].rankingUseCount, 8);
  const html = sandbox.render(result.rows[0], 0);
  assert.match(html, /非表示のプレイヤー/);
  assert.doesNotMatch(html, /<button|data-roulette-ranked-pack|data-player-safety/);
});
