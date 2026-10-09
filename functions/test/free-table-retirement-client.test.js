"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function fn(source, name) {
  const start = new RegExp("^( *)(?:async )?function " + name + "\\(", "m").exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = new RegExp("\\n" + start[1] + "\\}\\r?\\n").exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + start[1].length + 2);
}

function retiredModuleHarness(search = "") {
  const calls = [];
  const listeners = new Map();
  const bindings = new Map();
  const microtasks = [];
  const storage = new Map([
    ["hariaiFreeTableVisitorCardV1", "saved-visitor-card"],
    ["hariaiFreeTableAmbienceVolumeV1", "0.4"],
    ["globalPlayerBlocks", "saved-safety-block"],
  ]);
  const forbidden = (name) => () => { calls.push(name); throw new Error("unexpected " + name); };
  const location = new URL("https://example.invalid/" + search);
  const app = { innerHTML: "", classList: { remove() {} }, focus() {} };
  const addEventListener = (name, listener) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(listener);
  };
  const storageApi = { getItem: (key) => storage.get(key) ?? null, setItem: forbidden("storage-write"), removeItem: forbidden("storage-delete") };
  const window = {
    addEventListener, dispatchEvent() {}, location,
    localStorage: storageApi, sessionStorage: storageApi,
    setTimeout: forbidden("timer"), setInterval: forbidden("interval"),
    clearTimeout() {}, clearInterval() {},
    HariaiApp: { returnHome() { app.innerHTML = "home"; } },
  };
  const history = {
    state: null,
    replaceState(_state, _title, url) { location.href = new URL(url, location).href; },
  };
  const context = vm.createContext({
    window, history, location, URL, URLSearchParams, Event: class {}, console,
    queueMicrotask(callback) { microtasks.push(callback); },
    document: { visibilityState: "visible", addEventListener, querySelector(selector) {
      if (selector === "#app") return app;
      if (selector === "#retiredFreeTableHome") return { addEventListener: (event, handler) => bindings.set(event, handler) };
      return null;
    } },
    httpsCallable: (_functions, name) => forbidden("callable:" + name),
    functions: {}, auth: {}, database: {},
    setPersistence: forbidden("auth-persistence"), signInAnonymously: forbidden("anonymous-auth"),
    get: forbidden("get"), onValue: forbidden("listener"), set: forbidden("set"), remove: forbidden("remove"),
    RTCPeerConnection: forbidden("peer"),
    FREE_TABLE_MEDIA_CHANNEL_LABEL: "test-media",
  });
  const source = read("free-table.js").replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";\s*/gm, "");
  vm.runInContext(source + "\nglobalThis.retiredInternals = { callFreeTableAction, callFreeTableInviteAction, ensureAuthenticated, initializeAuthenticatedFreeTable, refreshInvitePreview, reportFreeTableP2pDiagnostic };", context);
  return { context, api: window.HariaiFreeTable, app, calls, listeners, bindings, microtasks, location, storage };
}

for (const invite of ["", "expired-token", "A".repeat(32)]) {
  test("stale HTML invite " + (invite || "empty") + " displays retirement without auth, API, RTDB, timers or local data changes", async () => {
    const h = retiredModuleHarness("?freeTableInvite=" + invite);
    const before = [...h.storage];
    for (const callback of h.microtasks) callback();
    await Promise.resolve();
    assert.match(h.app.innerHTML, /貼り合い自由卓は終了しました/);
    assert.match(h.app.innerHTML, /ホームへ戻る/);
    assert.equal(h.api.isActive(), false);
    for (const name of ["visibilitychange", "beforeunload", "click"]) {
      for (const listener of h.listeners.get(name) || []) await listener({ target: { closest: () => ({ dataset: { action: "authenticate-invite" } }) } });
    }
    assert.deepEqual(h.calls, []);
    assert.deepEqual([...h.storage], before);
    await h.bindings.get("click")();
    assert.equal(h.app.innerHTML, "home");
    assert.equal(h.location.searchParams.has("freeTableInvite"), false);
    assert.deepEqual(h.calls, []);
  });
}

test("all legacy exported entry points are inert and direct action or auth calls fail before any activity", async () => {
  const h = retiredModuleHarness();
  await h.api.start({ intent: "lamp" });
  assert.match(h.app.innerHTML, /貼り合い自由卓は終了しました/);
  await h.api.openInvite("B".repeat(32));
  h.api.render();
  assert.equal(h.api.isActive(), false);
  assert.equal((await h.api.refresh()).retired, true);
  assert.equal(h.api.attachPeerConnection({ createDataChannel() { throw new Error("peer must not attach"); } }), null);
  assert.equal(h.api.setDataChannel({ send() { throw new Error("channel must not attach"); } }), null);
  for (const name of ["callFreeTableAction", "callFreeTableInviteAction", "ensureAuthenticated", "initializeAuthenticatedFreeTable"]) {
    await assert.rejects(h.context.retiredInternals[name]("open"), (error) => error.code === "failed-precondition" && /終了しました/.test(error.message));
  }
  await h.context.retiredInternals.refreshInvitePreview(1, "C".repeat(32));
  await h.context.retiredInternals.reportFreeTableP2pDiagnostic("failed");
  await h.api.leave();
  await h.api.requestHome();
  assert.deepEqual(h.calls, []);
});

test("the current app resolves retired invite links locally and preserves unrelated query parameters on home", () => {
  const source = read("app.js");
  const location = new URL("https://example.invalid/?freeTableInvite=old&keep=1#help");
  const bindings = new Map();
  const app = { innerHTML: "", focus() {} };
  let homeCount = 0;
  const context = vm.createContext({
    URL, URLSearchParams, app, currentScreen: "landing", FREE_TABLE_INVITE_QUERY_KEY: "freeTableInvite",
    window: { location, history: { state: null, replaceState(_state, _title, url) { location.href = new URL(url, location).href; } } },
    document: { querySelector: () => ({ addEventListener(event, callback) { bindings.set(event, callback); } }) },
    setLandingChrome() {}, renderLandingScreen() { context.clearRetiredFreeTableInvite(); homeCount++; },
  });
  vm.runInContext(["clearRetiredFreeTableInvite", "showRetiredFreeTable", "openInitialFreeTableInvite"].map((name) => fn(source, name)).join("\n"), context);
  assert.equal(context.openInitialFreeTableInvite(), true);
  assert.match(app.innerHTML, /貼り合い自由卓は終了しました/);
  assert.equal(homeCount, 0);
  bindings.get("click")();
  assert.equal(homeCount, 1);
  assert.equal(location.search, "?keep=1");
  assert.equal(location.hash, "#help");
  assert.equal(context.openInitialFreeTableInvite(), false);
});
