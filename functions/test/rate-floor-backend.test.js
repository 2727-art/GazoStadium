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
  assert.equal(automatic.rateFloorRevision, 5);

  harness.state.achievements.customShowcase = [secret];
  const selected = await harness.sync("player");
  assert.equal(selected.achievementShowcase, secret);
  assert.equal(selected.rateFloorRevision, 6);
  const selectedRow = serverRateFloorMirrorDecision(null, {
    publicEntry: publicProfile(selected), revision: selected.rateFloorRevision,
  }).value;

  harness.state.achievements.customShowcase = [];
  const removed = await harness.sync("player");
  const publicRemoved = serverRateFloorMirrorDecision(selectedRow, {
    publicEntry: publicProfile(removed), revision: removed.rateFloorRevision,
  }).value;
  assert.equal(publicRemoved.achievementShowcase, "battle_total_1");
  assert.equal(removed.rateFloorRevision, 7);
  const delayed = serverRateFloorMirrorDecision(publicRemoved, {
    publicEntry: publicProfile(selected), revision: selected.rateFloorRevision,
  });
  assert.equal(delayed.committed, false);
  assert.equal(delayed.value.achievementShowcase, "battle_total_1");
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
  assert.equal(synced.rateFloorRevision, 6);
  assert.equal(synced.achievementShowcase, "battle_total_10");
  assert.equal(harness.state.ranking.achievementShowcase, "battle_total_10");
  assert.deepEqual(Object.keys(harness.state.commits[0].patch).sort(), [
    "achievementShowcase", "rateFloorRevision", "updatedAt",
  ]);
});

test("showcase changes preserve concurrent opt-out and clear unavailable badges", async () => {
  const harness = transactionHarness(eligibleProfile(), { unlocked: {}, customShowcase: [] }, (state) => {
    state.ranking = { ...state.ranking, enabled: false, rateFloorEnabled: false, rateFloorRevision: 5 };
  });
  const synced = await harness.sync("player");
  assert.equal(synced.enabled, false);
  assert.equal(synced.rateFloorEnabled, false);
  assert.equal(synced.rateFloorRevision, 6);
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

test("customization validates earned options and serializes signature removal with floor revisions", async () => {
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
  const old = publicProfile(harness.state.ranking);
  await customize("player", { crownTheme: "rose", crownSignatureId: "" });
  assert.equal(mirrored.rateFloorRevision, 5);
  assert.equal(Object.hasOwn(mirrored, "crownSignatureId"), false);
  assert.equal(Object.hasOwn(harness.state.ranking, "crownSignatureId"), false);
  const removed = serverRateFloorMirrorDecision(null, {
    publicEntry: publicProfile(mirrored), revision: mirrored.rateFloorRevision,
  }).value;
  assert.equal(removed.crownTheme, "rose");
  assert.equal(serverRateFloorMirrorDecision(removed, { publicEntry: old, revision: 4 }).committed, false);
});

test("achievement updates use the fresh profile through the floor CAS without rewriting overall RATE", () => {
  const sync = sourceBetween("async function syncAchievementPublicSurfaces", "async function syncCurrentServerRankingMetadata");
  assert.match(sync, /syncCurrentServerRankingShowcase\(uid\)/);
  assert.match(sync, /mirrorServerRateFloorProfiles\(\{ \[uid\]: serverProfile \}\)/);
  assert.doesNotMatch(sync, /mirrorServerOverallProfiles|batch\.set\(serverRankingProfileRef/);
});

test("participation re-read cannot restore a concurrently removed signature or showcase", async () => {
  let current = eligibleProfile();
  const mirrored = [];
  const profileRef = {
    get: async () => ({ data: () => structuredClone(current) }),
  };
  const participate = backendFunction(
    "async function setServerRateFloorParticipation",
    "async function getServerRankingAwards",
    "setServerRateFloorParticipation",
    {
      isPlainCallableObject: (value) => value && typeof value === "object",
      SERVER_RATE_FLOOR_MINIMUM_MATCHES,
      createServerRateFloorEntryId,
      serverRankingProfileRef: () => profileRef,
      publicServerRateFloorProfile: publicProfile,
      firestore: {
        runTransaction: async (callback) => callback({
          get: async () => ({ exists: true, data: () => structuredClone(current) }),
          set: (_ref, patch) => { current = { ...current, ...patch }; },
        }),
      },
      mirrorServerRateFloorProfiles: async (profiles) => {
        mirrored.push(profiles.player);
        if (mirrored.length === 1) {
          current.rateFloorRevision += 1;
          delete current.crownSignatureId;
          delete current.achievementShowcase;
        }
      },
    },
  );
  const result = await participate("player", { action: "set_rate_floor_participation", enabled: true });
  assert.equal(result.rateFloorEligible, true);
  assert.equal(mirrored.length, 2);
  assert.equal(mirrored[0].crownSignatureId, "daily_champion");
  assert.equal(mirrored[1].rateFloorRevision, 6);
  assert.equal(Object.hasOwn(mirrored[1], "crownSignatureId"), false);
  assert.equal(Object.hasOwn(mirrored[1], "achievementShowcase"), false);
  const overallParticipation = sourceBetween(
    "async function setServerRankingParticipation", "async function setServerRateFloorParticipation",
  );
  assert.doesNotMatch(overallParticipation, /normalizeServerRankingProfile\(\(await profileRef\.get\(\)\)\.data\(\), savedProfile\)/);
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

test("overall profile mirroring delegates RATE FLOOR publication to its monotonic CAS", () => {
  const floorMirror = sourceBetween(
    "async function mirrorServerRateFloorProfiles",
    "async function mirrorServerOverallProfiles",
  );
  assert.match(
    floorMirror,
    /online\/serverRateFloorLeaderboard\/\$\{profile\.rateFloorEntryId\}/,
  );
  assert.doesNotMatch(floorMirror, /profile\.entryId/);
  assert.match(floorMirror, /publicRef\.transaction\(\(current\) =>/);
  assert.match(floorMirror, /serverRateFloorMirrorDecision\(current/);

  const overallMirror = sourceBetween(
    "async function mirrorServerOverallProfiles",
    "async function mirrorCrownCircuitEntries",
  );
  assert.match(overallMirror, /await mirrorServerRateFloorProfiles\(profilesByUid\)/);

  const verifiedMatch = sourceBetween(
    "async function recordVerifiedMatch",
    "function validatePostMatchTipRequest",
  );
  assert.match(
    verifiedMatch,
    /Object\.keys\(serverRankingProfileResults\)\.length[\s\S]*mirrorServerOverallProfiles\(serverRankingProfileResults\)/,
  );
  assert.match(
    verifiedMatch,
    /rateFloorRevision: nextServerRateFloorRevision\(serverProfile\.rateFloorRevision\)/,
  );

  const removal = sourceBetween(
    "async function removeServerRankingPublicEntries",
    "async function setServerRankingParticipation",
  );
  assert.doesNotMatch(removal, /serverRateFloorLeaderboard/);

  const participation = sourceBetween(
    "async function setServerRankingParticipation",
    "async function setServerRateFloorParticipation",
  );
  assert.match(participation, /enabled: false,[\s\S]*rateFloorEnabled: false/);
  assert.match(participation, /rateFloorRevision: FieldValue\.increment\(1\)/);
  assert.match(
    participation,
    /removeServerRankingPublicEntries\(uid, now\)/,
  );
  assert.match(
    participation,
    /mirrorServerRateFloorProfiles\(\{ \[uid\]: disabledProfile \}\)/,
  );
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

test("RATE FLOOR participation action validates input and returns server eligibility", () => {
  const action = sourceBetween(
    "async function setServerRateFloorParticipation",
    "async function getServerRankingAwards",
  );
  assert.match(action, /key !== "action" && key !== "enabled"/);
  assert.match(action, /typeof data\.enabled !== "boolean"/);
  assert.match(action, /enabled && \(!profile\.enabled \|\| !profile\.entryId\)/);
  assert.match(action, /rateFloorEnabled: enabled/);
  assert.match(action, /const initialRateFloorEntryId = createServerRateFloorEntryId\(\)/);
  assert.match(
    action,
    /rateFloorEntryId: profile\.rateFloorEntryId \|\| initialRateFloorEntryId/,
  );
  assert.match(action, /rateFloorRevision: nextServerRateFloorRevision\(profile\.rateFloorRevision\)/);
  assert.match(action, /await mirrorServerRateFloorProfiles\(\{ \[uid\]: savedProfile \}\)/);
  assert.doesNotMatch(action, /mirrorServerOverallProfiles/);
  assert.match(action, /rateFloorEligible: Boolean\(publicServerRateFloorProfile\(profile\)\)/);
  assert.match(action, /minimumMatches: SERVER_RATE_FLOOR_MINIMUM_MATCHES/);

  assert.match(functionsSource, /"set_rate_floor_participation"/);
  assert.match(
    functionsSource,
    /action === "set_rate_floor_participation"\) return await setServerRateFloorParticipation/,
  );
  assert.match(
    functionsSource,
    /profile:\s*\{[\s\S]{0,240}rateFloorEnabled: profile\.rateFloorEnabled,[\s\S]{0,120}rateFloorEligible:/,
  );
});

test("RATE FLOOR RTDB mirror is public read, Admin-only write, and RATE-indexed", () => {
  const rules = databaseRules.rules.online.serverRateFloorLeaderboard;
  assert.equal(rules[".read"], true);
  assert.equal(rules[".write"], false);
  assert.deepEqual(rules[".indexOn"], ["rating"]);
});

test("RATE FLOOR adds no history, reward, achievement, Crown, or spotlight surface", () => {
  assert.doesNotMatch(functionsSource, /serverRateFloor(?:History|HallOfFame|Awards?)/i);
  assert.doesNotMatch(functionsSource, /rateFloor(?:Reward|Achievement|Crown|Spotlight)/i);
});
