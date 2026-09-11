"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { creatorCardActivityCount, creatorCardGrowthLevel } = require("../creator-card");

const root = path.resolve(__dirname, "..", "..");
const client = fs.readFileSync(path.join(root, "online.js"), "utf8");
const server = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source boundary ${start}`);
  return source.slice(startIndex, endIndex);
}

function createClientHarness() {
  const calls = [];
  const auth = { currentUser: { uid: "first-user" } };
  let invoke = async (request) => ({ data: { balance: 50, request } });
  const context = {
    auth,
    economyActionCallable: async (request) => {
      calls.push({ uid: auth.currentUser?.uid, action: request.action });
      return invoke(request);
    },
  };
  vm.createContext(context);
  vm.runInContext(`
    let economyInitialization = null;
    ${between(client, "async function requestEconomyInitialization", "async function initializeEconomy")}
    this.initialize = requestEconomyInitialization;
  `, context);
  return { context, auth, calls, setInvoke: (callback) => { invoke = callback; } };
}

test("same-day results reuse initialization without replacing explicit refreshes", async () => {
  const { context, calls } = createClientHarness();
  await context.initialize("first-user", "2026-09-11");
  for (let index = 0; index < 3; index += 1) {
    await context.initialize("first-user", "2026-09-11", { reuseSuccessful: true });
  }
  assert.equal(calls.length, 1, "mode entry plus three results uses one initialize callable");
  await context.initialize("first-user", "2026-09-11");
  assert.equal(calls.length, 2, "an explicit refresh remains fresh");
});

test("first-use results initialize once and failed requests remain retryable", async () => {
  const harness = createClientHarness();
  let failures = 1;
  harness.setInvoke(async () => {
    if (failures-- > 0) throw new Error("temporary-unavailable");
    return { data: { balance: 123 } };
  });
  await assert.rejects(
    harness.context.initialize("first-user", "2026-09-11", { reuseSuccessful: true }),
    /temporary-unavailable/,
  );
  const restored = await harness.context.initialize("first-user", "2026-09-11", { reuseSuccessful: true });
  assert.equal(restored.data.balance, 123);
  await harness.context.initialize("first-user", "2026-09-11", { reuseSuccessful: true });
  assert.equal(harness.calls.length, 2, "failure is retried, success is reused");
});

test("simultaneous entry and result requests share only the in-flight initialize", async () => {
  const harness = createClientHarness();
  let resolve;
  harness.setInvoke(() => new Promise((done) => { resolve = done; }));
  const entry = harness.context.initialize("first-user", "2026-09-11");
  const result = harness.context.initialize("first-user", "2026-09-11", { reuseSuccessful: true });
  const refresh = harness.context.initialize("first-user", "2026-09-11");
  await Promise.resolve();
  assert.equal(harness.calls.length, 1);
  resolve({ data: { balance: 75 } });
  const responses = await Promise.all([entry, result, refresh]);
  assert.ok(responses.every((response) => response === responses[0]));
});

test("successful initialization never crosses UID or JST day boundaries", async () => {
  const harness = createClientHarness();
  await harness.context.initialize("first-user", "2026-09-30", { reuseSuccessful: true });
  await harness.context.initialize("first-user", "2026-10-01", { reuseSuccessful: true });
  harness.auth.currentUser = { uid: "second-user" };
  await harness.context.initialize("second-user", "2026-10-01", { reuseSuccessful: true });
  assert.equal(harness.calls.length, 3);
  await assert.rejects(
    harness.context.initialize("first-user", "2026-10-01", { reuseSuccessful: true }),
    /認証情報が変わりました/,
  );
  assert.equal(harness.calls.length, 3);
});

test("an in-flight auth change cannot mark the new account initialized", async () => {
  const harness = createClientHarness();
  let resolve;
  harness.setInvoke(() => new Promise((done) => { resolve = done; }));
  const previous = harness.context.initialize("first-user", "2026-09-11");
  await Promise.resolve();
  harness.auth.currentUser = { uid: "second-user" };
  resolve({ data: { balance: 900 } });
  await assert.rejects(previous, /認証情報が変わりました/);
  harness.setInvoke(async () => ({ data: { balance: 20 } }));
  const next = await harness.context.initialize("second-user", "2026-09-11", { reuseSuccessful: true });
  assert.equal(next.data.balance, 20);
  assert.equal(harness.calls.length, 2);
});

test("cross-midnight completion retains the request day and requires a new initialization", async () => {
  const harness = createClientHarness();
  let resolve;
  harness.setInvoke(() => new Promise((done) => { resolve = done; }));
  const yesterday = harness.context.initialize("first-user", "2026-09-30");
  await Promise.resolve();
  resolve({ data: { balance: 30 } });
  await yesterday;
  harness.setInvoke(async () => ({ data: { balance: 31 } }));
  await harness.context.initialize("first-user", "2026-10-01", { reuseSuccessful: true });
  assert.equal(harness.calls.length, 2);
});

test("result retries keep server reward requests and never reapply a cached initialization payload", async () => {
  const harness = createClientHarness();
  const { context } = harness;
  let resultCalls = 0;
  const currentProfile = { rating: 1050, wins: 1 };
  Object.assign(context, {
    ACTIVE_BATTLE_MODES: ["solo", "strategy"],
    INITIAL_RATING: 1000,
    state: { uid: "first-user", serverTimeOffset: 0, overallProfile: currentProfile },
    browserLocalPersistence: {},
    setPersistence: async () => {},
    localStorage: { getItem: () => null },
    PROFILE_NAME_KEY: "profile-name",
    publicServerTimeOffset: 0,
    jstDateKey: () => "2026-09-11",
    recordPeriodRewardResult: async () => {
      resultCalls += 1;
      if (resultCalls === 1) throw new Error("result-retry-needed");
      return {
        resultToken: "a".repeat(40),
        profileProjectionMode: "server-v2",
        profileProjectionPending: false,
        overallProfile: currentProfile,
        economyBalance: 143,
      };
    },
    applyServerSoloProjectionProfiles: () => {},
    normalizeOverallProfile: (value) => value,
    leaderboardPublicSettings: () => ({ enabled: false }),
  });
  vm.runInContext(`
    ${between(client, "async function recordOverallResult", "function persistOverallRankingPreference")}
    this.recordResult = recordOverallResult;
  `, context);
  const request = { mode: "solo", outcome: "win", roomId: "room" };
  await assert.rejects(context.recordResult(request), /result-retry-needed/);
  const result = await context.recordResult(request);
  assert.equal(harness.calls.length, 1, "initialize success is reusable after a record_match failure");
  assert.equal(resultCalls, 2, "the authoritative result/reward path is still retried");
  assert.equal(result.economyBalance, 143, "the result balance is not the cached initialize balance");
  assert.equal(context.state.overallProfile, currentProfile);
});

test("match card growth reuses one initialization per participant with committed battle stats", async () => {
  const recording = between(server, "async function recordVerifiedMatch", "function validatePostMatchTipRequest");
  const participants = ["host", "guest"];
  const initializations = [];
  const cards = {
    host: { schemaVersion: 2, growthLevel: 1 },
    guest: { schemaVersion: 2, growthLevel: 5 },
  };
  const context = {
    participants,
    progressResults: Object.fromEntries(participants.map((uid) => [uid, { achievementStats: { totalMatches: 1 } }])),
    profileResults: Object.fromEntries(participants.map((uid) => [uid, { unlocked: { battle_first: true } }])),
    newlyUnlockedResults: {},
    ensureAchievementState: async (uid) => {
      initializations.push(uid);
      return {
        progress: { achievementStats: { totalMatches: 0 } },
        marketStats: { salesCount: 9, purchases: 0 },
      };
    },
    mirrorEconomyProgress: async () => {},
    CREATOR_CARD_VERSION: 2,
    isCreatorCardEntryId: (value) => value.startsWith("card-"),
    creatorCardGrowthFromState: (value) => creatorCardGrowthLevel(creatorCardActivityCount(
      value.progress.achievementStats,
      value.marketStats,
    )),
    realtime: {
      ref: (reference) => ({
        get: async () => ({
          val: () => reference.includes("topMessageEntriesByUser")
            ? `card-${reference.split("/").at(-1)}`
            : reference.split("/").at(-1).slice(5),
        }),
        transaction: async (update) => {
          const uid = reference.split("/").at(-1).slice(5);
          const next = update(cards[uid]);
          if (next !== undefined) cards[uid] = next;
          return { committed: next !== undefined };
        },
      }),
    },
  };
  vm.createContext(context);
  vm.runInContext(`
    ${between(server, "async function syncCreatorCardGrowth", "async function acknowledgeAchievements")}
    this.runPostMatch = async () => {
      ${between(recording, "  const achievementStates", "  const progressRefs")}
      ${between(recording, "  const postMatchOperations", "  if (Object.keys(serverRankingEntryResults)")}
      await Promise.all(postMatchOperations);
    };
  `, context);
  await context.runPostMatch();
  assert.deepEqual(initializations, participants, "card owners do not trigger a second full achievement read");
  assert.equal(cards.host.growthLevel, 3, "9 market actions plus the committed match reach growth 3");
  assert.equal(cards.guest.growthLevel, 5, "a newer concurrently grown card never regresses");
});

test("card growth survives a cold-cache retry without creating cards or lowering growth", async (t) => {
  for (const [label, stored, expected] of [
    ["existing card", { schemaVersion: 2, growthLevel: 1 }, { schemaVersion: 2, growthLevel: 3 }],
    ["newer growth", { schemaVersion: 2, growthLevel: 5 }, { schemaVersion: 2, growthLevel: 5 }],
    ["missing card", null, null],
    ["legacy schema", { schemaVersion: 1, growthLevel: 1 }, { schemaVersion: 1, growthLevel: 1 }],
  ]) {
    await t.test(label, async () => {
      let card = stored;
      let retryCalls = 0;
      let firstDecision;
      const context = {
        CREATOR_CARD_VERSION: 2,
        isCreatorCardEntryId: () => true,
        creatorCardGrowthFromState: () => 3,
        ensureAchievementState: async () => { throw new Error("must use supplied state"); },
        realtime: {
          ref: (reference) => ({
            get: async () => ({ val: () => reference.includes("EntriesByUser") ? "valid-card-id" : "owner" }),
            transaction: async (update) => {
              firstDecision = update(null);
              if (firstDecision === undefined) return { committed: false };
              // Model the RTDB compare-and-retry after its empty-cache hash
              // disagrees with the existing server card.
              const next = card === null ? firstDecision : (() => {
                retryCalls += 1;
                return update(card);
              })();
              if (next !== undefined) card = next;
              return { committed: next !== undefined };
            },
          }),
        },
      };
      vm.createContext(context);
      vm.runInContext(`
        ${between(server, "async function syncCreatorCardGrowth", "async function acknowledgeAchievements")}
        this.syncGrowth = syncCreatorCardGrowth;
      `, context);
      const changed = await context.syncGrowth("owner", { progress: {}, marketStats: {} });
      assert.equal(firstDecision, null, "cold cache requests a server comparison instead of aborting");
      assert.equal(retryCalls, stored === null ? 0 : 1);
      assert.deepEqual(JSON.parse(JSON.stringify(card)), expected);
      assert.equal(changed, label === "existing card");
    });
  }
});
