"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const statsModule = () => import(pathToFileURL(path.join(root, "battle-presence-stats.mjs")).href);
const now = 100000;
const row = (pref, extra = {}) => ({ mode: "solo", state: "waiting", lastSeen: now, ...(pref ? { pref } : {}), ...extra });

test("preference totals are disjoint, expire at the existing boundary and exclude only the own row", async () => {
  const { summarizeBattlePresence } = await statsModule();
  const entries = {
    own: row("i"), anime: row("i", { lastSeen: now - 45000 }), photo: row("l"), both: row("b"),
    old: row(), malformed: row("__proto__"), expired: row("l", { lastSeen: now - 45001 }),
    strategy: row("i", { mode: "strategy" }), playing: row("b", { state: "playing" }),
  };
  const result = summarizeBattlePresence(entries, { mode: "solo", now, freshMs: 45000, ownPresenceId: "own" });
  assert.deepEqual(result, { waiting: 6, otherWaiting: 5, playing: 1,
    waitingByPreference: { illustration: 2, live_action: 1, both: 1, unknown: 2 },
    otherWaitingByPreference: { illustration: 1, live_action: 1, both: 1, unknown: 2 } });
  for (const ownPresenceId of ["missing", "playing"]) {
    const absent = summarizeBattlePresence(entries, { mode: "solo", now, freshMs: 45000, ownPresenceId });
    assert.deepEqual(absent.waitingByPreference, absent.otherWaitingByPreference);
  }
  const legacyOwn = summarizeBattlePresence(entries, { mode: "solo", now, freshMs: 45000, ownPresenceId: "old" });
  assert.equal(legacyOwn.otherWaitingByPreference.unknown, 1);
  const strategy = summarizeBattlePresence(entries, { mode: "strategy", now, freshMs: 45000 });
  assert.deepEqual(strategy, { waiting: 1, otherWaiting: 1, playing: 0,
    waitingByPreference: { illustration: 1, live_action: 0, both: 0, unknown: 0 },
    otherWaitingByPreference: { illustration: 1, live_action: 0, both: 0, unknown: 0 } });
});

test("presence writes carry an 11-byte category only while waiting without extra database operations", async () => {
  const { encodePresencePreference } = await statsModule();
  const source = read("online.js");
  const writer = source.slice(source.indexOf("async function writePublicPresence("), source.indexOf("async function cleanupPublicPresence("));
  const writes = [];
  const context = vm.createContext({ state: { imagePreference: "illustration" }, encodePresencePreference,
    serverNow: () => now, set: async (ref, value) => writes.push({ ref, value }) });
  vm.runInContext(writer, context);
  for (const [preference, code] of [["illustration", "i"], ["live_action", "l"], ["both", "b"]]) {
    context.state.imagePreference = preference;
    await context.writePublicPresence("presence", "solo", "waiting");
    const payload = writes.at(-1).value;
    assert.equal(payload.pref, code);
    assert.equal(Buffer.byteLength(JSON.stringify(payload)) - Buffer.byteLength(JSON.stringify(row())), 11);
  }
  await context.writePublicPresence("presence", "solo", "playing");
  assert.equal(Object.hasOwn(writes.at(-1).value, "pref"), false);
  context.state.imagePreference = "invalid";
  await context.writePublicPresence("presence", "solo", "waiting");
  assert.equal(Object.hasOwn(writes.at(-1).value, "pref"), false);
  assert.equal(writes.length, 5);
});

test("unloaded, zero and legacy counts render distinctly, and synchronization preserves the labels", async () => {
  const { createWaitingPreferenceCounts, renderWaitingPreferenceBreakdown, syncWaitingPreferenceBreakdowns } = await statsModule();
  assert.equal((renderWaitingPreferenceBreakdown(null).match(/<b>--<\/b>/g) || []).length, 4);
  const counts = { illustration: 2, live_action: 1, both: 3, unknown: 1 };
  const elements = Object.keys(counts).map(key => ({ dataset: { soloWaitingPref: key }, hidden: false,
    value: {}, querySelector() { return this.value; } }));
  const dom = { querySelectorAll: () => elements };
  syncWaitingPreferenceBreakdowns(dom, counts);
  assert.deepEqual(elements.map(e => e.value.textContent), ["2", "1", "3", "1"]);
  assert.equal(elements[3].hidden, false);
  syncWaitingPreferenceBreakdowns(dom, createWaitingPreferenceCounts());
  assert.deepEqual(elements.map(e => e.value.textContent), ["0", "0", "0", "0"]);
  assert.equal(elements[3].hidden, true);

  const app = read("app.js");
  const render = app.slice(app.indexOf("  function renderLanding()"), app.indexOf("  function renderLandingScreen()"));
  const html = vm.runInNewContext(render + "; renderLanding()", {
    window: { HariaiLobby: { getStats: () => ({ solo: { waiting: 7, playing: 0, waitingByPreference: counts } }) }, localStorage: { getItem: () => null } },
  });
  const fragment = renderWaitingPreferenceBreakdown(counts);
  assert.equal(html.split(fragment).length - 1, 2, "hero and board must share the same breakdown as the match panel");
});

test("landing gets categories from the same one-shot snapshot and keeps them when returning home", async () => {
  const helpers = await statsModule();
  const calls = [];
  const listeners = new Map();
  const nodes = ["solo", "strategy"].flatMap(mode => Object.keys(helpers.createWaitingPreferenceCounts()).map(key => ({ mode, dataset: { soloWaitingPref: key },
    hidden: false, value: {}, querySelector() { return this.value; } })));
  const context = vm.createContext({ ...helpers, URLSearchParams, Date: { now: () => now }, setTimeout, clearTimeout,
    database: {}, location: { hostname: "hariaistadium.com", search: "" },
    document: { getElementById: () => null, querySelectorAll: selector => nodes.filter(n => selector.includes(`data-waiting-mode="${n.mode}"`)) },
    window: { addEventListener: (key, fn) => listeners.set(key, fn), dispatchEvent() {} },
    CustomEvent: class {}, ref: (_db, p) => p, get: async p => { calls.push(p); return { val: () => p.startsWith(".info") ? 0 : { a: row("i"), b: row("b"), c: row(), s: row("l", { mode: "strategy" }), t: row("l", { mode: "strategy" }) } }; },
  });
  vm.runInContext(read("landing-presence.mjs").replace(/^import .*;\r?\n/gm, "").replace(/export /g, ""), context);
  await context.window.HariaiLobby.load();
  await context.window.HariaiLobby.load();
  listeners.get("hariai-landing-rendered")();
  assert.deepEqual(calls, [".info/serverTimeOffset", "online/publicPresence"]);
  assert.deepEqual(nodes.map(n => n.value.textContent), ["1", "0", "1", "1", "0", "2", "0", "0"]);
  const snapshot = context.window.HariaiLobby.getStats();
  snapshot.solo.waitingByPreference.illustration = 999;
  assert.equal(context.window.HariaiLobby.getStats().solo.waitingByPreference.illustration, 1);
  snapshot.strategy.waitingByPreference.live_action = 999;
  assert.equal(context.window.HariaiLobby.getStats().strategy.waitingByPreference.live_action, 2);
});

test("strategy categories exclude its own waiting row without mixing normal players or expired rows", async () => {
  const { summarizeBattlePresence } = await statsModule();
  const strategy = (pref, extra = {}) => row(pref, { mode: "strategy", ...extra });
  const entries = { own: strategy("l"), anime: strategy("i"), photo: strategy("l"), both: strategy("b"),
    old: strategy(), expired: strategy("i", { lastSeen: now - 45001 }),
    playing: strategy(null, { state: "playing" }), solo: row("i") };
  const options = { mode: "strategy", now, freshMs: 45000, ownPresenceId: "own" };
  assert.deepEqual(summarizeBattlePresence(entries, options), { waiting: 5, otherWaiting: 4, playing: 1,
    waitingByPreference: { illustration: 1, live_action: 2, both: 1, unknown: 1 },
    otherWaitingByPreference: { illustration: 1, live_action: 1, both: 1, unknown: 1 } });
  for (const ownPresenceId of ["missing", "playing", "solo"]) {
    const result = summarizeBattlePresence(entries, { ...options, ownPresenceId });
    assert.deepEqual(result.waitingByPreference, result.otherWaitingByPreference);
  }
});

test("strategy writes one 11-byte code with the existing heartbeat and removes it on entering a room", async () => {
  const { encodePresencePreference } = await statsModule();
  const source = read("strategy.js");
  const writer = source.slice(source.indexOf("async function writePublicPresence("), source.indexOf("async function updatePublicPresence("));
  const writes = [];
  const context = vm.createContext({ state: { imagePreference: "illustration" }, encodePresencePreference,
    Date: { now: () => now }, set: async (ref, value) => writes.push(value) });
  vm.runInContext(writer, context);
  for (const [preference, code] of [["illustration", "i"], ["live_action", "l"], ["both", "b"]]) {
    context.state.imagePreference = preference;
    await context.writePublicPresence("presence", "waiting");
    assert.equal(writes.at(-1).pref, code);
    assert.equal(Buffer.byteLength(JSON.stringify(writes.at(-1))) - Buffer.byteLength(JSON.stringify(row(null, { mode: "strategy" }))), 11);
  }
  await context.writePublicPresence("presence", "playing");
  assert.equal(Object.hasOwn(writes.at(-1), "pref"), false);
  assert.equal(writes.length, 4);
});
