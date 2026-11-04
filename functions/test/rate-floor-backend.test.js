"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  SERVER_RATE_FLOOR_HIDDEN_RATING,
  SERVER_RATE_FLOOR_MINIMUM_MATCHES,
  createServerRateFloorEntryId,
  isServerRateFloorEntryId,
  nextServerRateFloorRevision,
  normalizeServerRateFloorRevision,
  serverRateFloorMirrorDecision,
  serverRateFloorPublicEntry,
} = require("../rate-floor");
const { CROWN_THEMES, CROWN_SIGNATURE_IDS, CROWN_CIRCUIT_RULESET_VERSION } = require("../crown-circuit");
const { SERVER_RANKING_VERSION } = require("../server-ranking");
const { effectiveShowcase, normalizeAchievementProfile } = require("../achievements");

const root = path.resolve(__dirname, "..", "..");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const databaseRules = JSON.parse(fs.readFileSync(
  path.join(root, "database.rules.json"),
  "utf8",
));

function sourceBetween(start, end) {
  const startIndex = functionsSource.indexOf(start);
  const endIndex = functionsSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} must exist`);
  assert.notEqual(endIndex, -1, `${end} must follow ${start}`);
  return functionsSource.slice(startIndex, endIndex);
}

function backendFunction(start, end, name, dependencies = {}) {
  const values = {
    CROWN_THEMES,
    CROWN_SIGNATURE_IDS,
    CROWN_CIRCUIT_RULESET_VERSION,
    SERVER_RANKING_VERSION,
    isServerRateFloorEntryId,
    normalizeServerRateFloorRevision,
    nextServerRateFloorRevision,
    serverRateFloorPublicEntry,
    effectiveShowcase,
    normalizeAchievementProfile,
    ...dependencies,
  };
  return new Function(...Object.keys(values), `${
    sourceBetween("function cleanText", "function safeBalance")
  }\n${
    sourceBetween("function normalizeServerRankingProfile", "function activeServerRankingPeriodInfos")
  }\n${sourceBetween(start, end)}\nreturn ${name};`)(...Object.values(values));
}

const publicProfile = backendFunction(
  "function publicServerRateFloorProfile",
  "function publicCrownCircuitEntry",
  "publicServerRateFloorProfile",
);

function eligibleProfile(overrides = {}) {
  return {
    enabled: true,
    rateFloorEnabled: true,
    entryId: "overall-entry-123456789",
    rateFloorEntryId: "floorEntry123456789012345",
    name: "PLAYER",
    rating: 750,
    serverMatches: 20,
    crownTheme: "gold",
    crownSignatureId: "daily_champion",
    achievementShowcase: "battle_total_1",
    rateFloorRevision: 4,
    ...overrides,
  };
}

function transactionHarness(ranking, achievements, onFirstAttempt = null) {
  const deletion = Symbol("delete");
  const state = { ranking, achievements, commits: [], attempts: 0 };
  const firestore = {
    async runTransaction(callback) {
      for (;;) {
        state.attempts += 1;
        const writes = [];
        const result = await callback({
          async get(ref) {
            const value = state[ref];
            return { exists: value != null, data: () => structuredClone(value) };
          },
          set(ref, patch, options) {
            assert.deepEqual(options, { merge: true });
            writes.push({ ref, patch });
          },
        });
        if (onFirstAttempt) {
          const beforeCommit = onFirstAttempt;
          onFirstAttempt = null;
          beforeCommit(state);
          continue;
        }
        writes.forEach(({ ref, patch }) => {
          state[ref] = { ...state[ref] };
          Object.entries(patch).forEach(([key, value]) => {
            if (value === deletion) delete state[ref][key];
            else state[ref][key] = value;
          });
          state.commits.push({ ref, patch });
        });
        return result;
      }
    },
    batch: () => ({ commit: async () => {}, set: () => {} }),
  };
  const dependencies = {
    firestore,
    FieldValue: { delete: () => deletion },
    serverRankingProfileRef: () => "ranking",
    achievementProfileRef: () => "achievements",
  };
  return {
    state,
    dependencies,
    sync: backendFunction(
      "async function syncCurrentServerRankingShowcase",
      "async function syncAchievementPublicSurfaces",
      "syncCurrentServerRankingShowcase",
      dependencies,
    ),
  };
}

test("RATE FLOOR is a server-owned opt-in with a ten-match publication gate", () => {
  assert.equal(SERVER_RATE_FLOOR_MINIMUM_MATCHES, 10);
  assert.match(functionsSource, /rateFloorEnabled: source\.rateFloorEnabled === true/);
  assert.match(functionsSource, /rateFloorRevision: normalizeServerRateFloorRevision/);

  const source = sourceBetween(
    "function publicServerRateFloorProfile",
    "function publicCrownCircuitEntry",
  );
  assert.match(source, /normalizeServerRankingProfile\(value, value\)/);
  assert.match(source, /serverRateFloorPublicEntry\(profile/);
  assert.equal(publicProfile(null), null);
  for (const excluded of [
    { enabled: false }, { rateFloorEnabled: false }, { entryId: "" },
    { rateFloorEntryId: "" }, { serverMatches: 9 },
  ]) {
    assert.equal(publicProfile(eligibleProfile(excluded)), null);
  }
  const entry = publicProfile(eligibleProfile({ serverMatches: 10 }));
  assert.equal(entry.serverMatches, 10);
  assert.equal(entry.serverVerified, true);
  assert.equal(entry.name, "PLAYER");
  assert.equal(entry.rating, 750);
});

test("RATE FLOOR publishes only the existing selected cosmetics with no owner or reward links", () => {
  assert.deepEqual(publicProfile(eligibleProfile({
    xHandle: "publichandle",
    commentsEnabled: true,
    uid: "private-user",
    rankingAwardTier: "daily_champion",
    rankingAwardUntil: Date.now() + 60_000,
  })), {
    serverVerified: true,
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    name: "PLAYER",
    rating: 750,
    serverMatches: 20,
    crownTheme: "gold",
    crownSignatureId: "daily_champion",
    achievementShowcase: "battle_total_1",
  });
  const empty = publicProfile(eligibleProfile({
    crownTheme: "unknown", crownSignatureId: "unknown", achievementShowcase: "",
  }));
  assert.equal(empty.crownTheme, "rose");
  assert.equal(Object.hasOwn(empty, "crownSignatureId"), false);
  assert.equal(Object.hasOwn(empty, "achievementShowcase"), false);
});

test("live showcase sync keeps secret achievements manual and removes a prior manual selection", async () => {
  const secret = "battle_loss_streak_secret_100";
  const harness = transactionHarness(eligibleProfile({ achievementShowcase: "" }), {
    unlocked: { battle_total_1: 100, [secret]: 200 },
    customShowcase: [],
  });
  const automatic = await harness.sync("player");
  assert.equal(automatic.achievementShowcase, "battle_total_1");
  assert.equal(automatic.rateFloorRevision, 4);

  harness.state.achievements.customShowcase = [secret];
  const selected = await harness.sync("player");
  assert.equal(selected.achievementShowcase, secret);
  assert.equal(selected.rateFloorRevision, 4);
  harness.state.achievements.customShowcase = [];
  const removed = await harness.sync("player");
  assert.equal(removed.achievementShowcase, "battle_total_1");
  assert.equal(removed.rateFloorRevision, 4);
});

test("showcase transaction retries after a concurrent selection and rated match", async () => {
  const secret = "battle_loss_streak_secret_100";
  const harness = transactionHarness(eligibleProfile(), {
    unlocked: { battle_total_1: 100, battle_total_10: 150, [secret]: 200 },
    customShowcase: [secret],
  }, (state) => {
    state.achievements.customShowcase = ["battle_total_10"];
    state.ranking = { ...state.ranking, rating: 735, serverMatches: 21, rateFloorRevision: 5 };
  });
  const synced = await harness.sync("player");
  assert.equal(harness.state.attempts, 2);
  assert.equal(harness.state.commits.length, 1);
  assert.equal(synced.rating, 735);
  assert.equal(synced.serverMatches, 21);
  assert.equal(synced.rateFloorRevision, 5);
  assert.equal(synced.achievementShowcase, "battle_total_10");
  assert.equal(harness.state.ranking.achievementShowcase, "battle_total_10");
  assert.deepEqual(Object.keys(harness.state.commits[0].patch).sort(), [
    "achievementShowcase", "updatedAt",
  ]);
});

test("showcase changes preserve concurrent opt-out and clear unavailable badges", async () => {
  const harness = transactionHarness(eligibleProfile(), { unlocked: {}, customShowcase: [] }, (state) => {
    state.ranking = { ...state.ranking, enabled: false, rateFloorEnabled: false, rateFloorRevision: 5 };
  });
  const synced = await harness.sync("player");
  assert.equal(synced.enabled, false);
  assert.equal(synced.rateFloorEnabled, false);
  assert.equal(synced.rateFloorRevision, 5);
  assert.equal(Object.hasOwn(synced, "achievementShowcase"), false);
  assert.equal(Object.hasOwn(harness.state.ranking, "achievementShowcase"), false);
  assert.equal(publicProfile(synced), null);
});

test("unchanged showcases avoid profile writes and missing profiles remain absent", async () => {
  const harness = transactionHarness(eligibleProfile(), {
    unlocked: { battle_total_1: 100 }, customShowcase: ["battle_total_1"],
  });
  const synced = await harness.sync("player");
  assert.equal(synced.rateFloorRevision, 4);
  assert.equal(harness.state.commits.length, 0);
  const missing = transactionHarness(null, { unlocked: { battle_total_1: 100 } });
  assert.equal(await missing.sync("player"), null);
  assert.equal(missing.state.commits.length, 0);
});

test("customization preserves earned options and removes signatures without retired mirror writes", async () => {
  const harness = transactionHarness(eligibleProfile(), {});
  let mirrored = null;
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const customize = backendFunction(
    "async function setCrownCustomization",
    "async function getAchievements",
    "setCrownCustomization",
    {
      ...harness.dependencies,
      HttpsError,
      loadCrownCustomizationOptions: async () => ({
        availableThemes: ["rose", "gold"], availableSignatureIds: ["daily_champion"],
      }),
      SERVER_RANKING_PERIODS: [],
      periodKey: () => "2026-09-17",
      isCrownCircuitPeriod: () => false,
      mirrorServerOverallProfiles: async (profiles) => { mirrored = profiles.player; },
      mirrorCrownCircuitEntries: async () => {},
      syncRankingSpotlightConsent: async () => {},
    },
  );
  await assert.rejects(customize("player", { crownTheme: "aqua", crownSignatureId: "" }),
    { code: "failed-precondition" });
  await assert.rejects(customize("player", { crownTheme: "gold", crownSignatureId: "upset" }),
    { code: "failed-precondition" });
  assert.equal(harness.state.commits.length, 0);
  await customize("player", { crownTheme: "rose", crownSignatureId: "" });
  assert.equal(mirrored, null);
  assert.equal(harness.state.ranking.crownTheme, "rose");
  assert.equal(Object.hasOwn(harness.state.ranking, "crownSignatureId"), false);
  assert.equal(harness.state.ranking.rateFloorRevision, 4);
});

test("achievement updates preserve period showcases without retired mirrors", () => {
  const sync = sourceBetween("async function syncAchievementPublicSurfaces", "async function syncCurrentServerRankingMetadata");
  assert.match(sync, /syncCurrentServerRankingShowcase\(uid\)/);
  assert.doesNotMatch(sync, /mirrorServerRateFloorProfiles/);
  assert.doesNotMatch(sync, /mirrorServerOverallProfiles|batch\.set\(serverRankingProfileRef/);
});

test("retired floor participation rejects old clients before reading or writing", async () => {
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const participate = backendFunction("async function setServerRateFloorParticipation", "async function getServerRankingAwards", "setServerRateFloorParticipation", { HttpsError });
  for (const data of [{ enabled: true }, { enabled: false }, {}, null]) {
    await assert.rejects(participate("player", data), { code: "failed-precondition" });
  }
});

test("RATE FLOOR uses an uncorrelated private random public-row id", () => {
  const ids = Array.from({ length: 64 }, () => createServerRateFloorEntryId());
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((entryId) => {
    assert.equal(entryId.length, 24);
    assert.equal(isServerRateFloorEntryId(entryId), true);
    assert.match(entryId, /^[A-Za-z0-9_-]{24}$/);
  });
  assert.equal(isServerRateFloorEntryId("overall-entry-id-must-not-work"), false);
  assert.match(functionsSource, /rateFloorEntryId: isServerRateFloorEntryId/);
});

test("rated results retain internal RATE but never update retired public mirrors", () => {
  const recorded = sourceBetween("async function recordVerifiedMatch", "function validatePostMatchTipRequest");
  assert.match(recorded, /calculateServerRankingRating/);
  assert.match(recorded, /transaction\.set\(serverProfileRefs\[index\], updatedServerProfile\)/);
  assert.match(recorded, /mirrorCrownCircuitEntries/);
  assert.doesNotMatch(functionsSource, /mirrorServerOverallProfiles|mirrorServerRateFloorProfiles|rateFloorRevision: next/);
});

test("ten-match activation wins and a delayed nine-match tombstone cannot hide it", () => {
  const optedInAtNine = {
    serverVerified: true,
    name: "PLAYER",
    rating: 820,
    serverMatches: 9,
  };
  const revisionAtNine = nextServerRateFloorRevision(0);
  const hiddenAtNine = serverRateFloorMirrorDecision(null, {
    publicEntry: null,
    revision: revisionAtNine,
    rulesetVersion: 2,
  });
  assert.equal(hiddenAtNine.committed, true);
  assert.equal(hiddenAtNine.value.rateFloorHidden, true);
  assert.equal(hiddenAtNine.value.rating, SERVER_RATE_FLOOR_HIDDEN_RATING);
  assert.equal(Object.hasOwn(hiddenAtNine.value, "name"), false);

  const revisionAtTen = nextServerRateFloorRevision(revisionAtNine);
  const activeAtTen = serverRateFloorMirrorDecision(hiddenAtNine.value, {
    publicEntry: { ...optedInAtNine, serverMatches: 10 },
    revision: revisionAtTen,
    rulesetVersion: 2,
  });
  assert.equal(activeAtTen.committed, true);
  assert.equal(activeAtTen.value.rateFloorHidden, undefined);
  assert.equal(activeAtTen.value.serverMatches, 10);

  const delayedNineMatchWrite = serverRateFloorMirrorDecision(activeAtTen.value, {
    publicEntry: null,
    revision: revisionAtNine,
    rulesetVersion: 2,
  });
  assert.equal(delayedNineMatchWrite.committed, false);
  assert.deepEqual(delayedNineMatchWrite.value, activeAtTen.value);
});

test("ranking opt-out tombstone rejects a delayed active publication", () => {
  const active = serverRateFloorMirrorDecision(null, {
    publicEntry: {
      serverVerified: true,
      name: "PLAYER",
      rating: 750,
      serverMatches: 20,
    },
    revision: 4,
    rulesetVersion: 2,
  }).value;
  const optedOut = serverRateFloorMirrorDecision(active, {
    publicEntry: null,
    revision: 5,
    rulesetVersion: 2,
  });
  assert.equal(optedOut.committed, true);
  assert.equal(optedOut.value.rateFloorHidden, true);
  assert.equal(Object.hasOwn(optedOut.value, "name"), false);

  const stalePublish = serverRateFloorMirrorDecision(optedOut.value, {
    publicEntry: active,
    revision: 4,
    rulesetVersion: 2,
  });
  assert.equal(stalePublish.committed, false);
  assert.deepEqual(stalePublish.value, optedOut.value);
});


test("retired overall and floor mirrors deny reads and writes including legacy indexes", () => {
  for (const name of ["serverOverallLeaderboard", "serverRateFloorLeaderboard", "serverOverallLeaderboardEntriesByUser"]) {
    assert.deepEqual(databaseRules.rules.online[name], { ".read": false, ".write": false });
  }
});

test("RATE FLOOR adds no history, reward, achievement, Crown, or spotlight surface", () => {
  assert.doesNotMatch(functionsSource, /serverRateFloor(?:History|HallOfFame|Awards?)/i);
  assert.doesNotMatch(functionsSource, /rateFloor(?:Reward|Achievement|Crown|Spotlight)/i);
});
