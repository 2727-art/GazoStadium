"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ACTIVE_SERVER_RANKING_MODES,
  SERVER_RANKING_MODES,
} = require("../server-ranking");
const {
  CROWN_CIRCUIT_CUTOVER_KEYS,
  CROWN_DAILY_MATCH_LIMIT,
  startCrownRun,
} = require("../crown-circuit");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("crown circuit keeps historical modes but ranks only verified symmetric 1on1 modes", () => {
  assert.deepEqual(ACTIVE_SERVER_RANKING_MODES, ["solo", "strategy"]);
  assert.deepEqual(SERVER_RANKING_MODES, ["solo", "strategy", "team", "royale"]);
  assert.equal(CROWN_DAILY_MATCH_LIMIT, 3);
  assert.deepEqual(CROWN_CIRCUIT_CUTOVER_KEYS, {
    daily: "2026-07-28",
    weekly: "2026-08-03",
    monthly: "2026-08",
  });
});

test("starting a proof run twice cannot reroll its starting RATE or declaration time", () => {
  const first = startCrownRun(null, {
    key: "2026-07-28",
    entryId: "entry-proof-run",
    profile: { name: "PLAYER", rating: 1000 },
    endsAt: 10_000,
    now: 100,
  });
  const repeated = startCrownRun(first.run, {
    key: "2026-07-28",
    entryId: "entry-proof-run",
    profile: { name: "PLAYER", rating: 1500 },
    endsAt: 10_000,
    now: 500,
  });
  assert.equal(first.started, true);
  assert.equal(repeated.started, false);
  assert.equal(repeated.run.ratingAtStart, 1000);
  assert.equal(repeated.run.startedAt, 100);
});

test("crown circuit Firestore state is Admin-only", () => {
  const firestoreRules = read("firestore.rules");
  assert.match(
    firestoreRules,
    /match \/serverRankingProfiles\/\{uid\}[\s\S]*match \/crownRuns\/\{runId\}\s*\{\s*allow read, write: if false;/,
  );
  assert.match(
    firestoreRules,
    /match \/crownCircuitPeriods\/\{periodKey\}\s*\{\s*allow read, write: if false;[\s\S]*match \/entries\/\{uid\}\s*\{\s*allow read, write: if false;/,
  );
  assert.match(
    firestoreRules,
    /match \/crownMonthlyAchievementStats\/\{uid\}\s*\{\s*allow read, write: if false;/,
  );
});

test("public crown mirrors are read-only while UID indexes are owner-only", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.online;

  assert.equal(rules.serverOverallLeaderboard[".read"], true);
  assert.equal(rules.serverOverallLeaderboard[".write"], false);
  assert.deepEqual(rules.serverOverallLeaderboard[".indexOn"], ["rating"]);
  assert.match(
    rules.serverOverallLeaderboardEntriesByUser.$uid[".read"],
    /auth != null && auth\.uid === \$uid/,
  );
  assert.equal(rules.serverOverallLeaderboardEntriesByUser.$uid[".write"], false);

  const crownPeriod = rules.crownCircuitPeriods.$period.$periodKey;
  assert.equal(crownPeriod[".write"], false);
  assert.deepEqual(crownPeriod[".indexOn"], ["rankScore", "qualifyingCount"]);
  assert.match(crownPeriod[".read"], /\$periodKey >= '2026-07-28'/);
  assert.match(crownPeriod[".read"], /\$periodKey >= '2026-08-03'/);
  assert.match(crownPeriod[".read"], /\$periodKey >= '2026-08'/);
  assert.match(
    rules.crownCircuitPeriodEntriesByUser.$uid[".read"],
    /auth != null && auth\.uid === \$uid/,
  );
  assert.equal(rules.crownCircuitPeriodEntriesByUser.$uid[".write"], false);

  for (const publicRoot of [
    "crownCircuitSeatHistory",
    "crownCircuitHallOfFame",
    "rankingSpotlights",
  ]) {
    assert.equal(rules[publicRoot][".read"], true);
    assert.equal(rules[publicRoot][".write"], false);
  }
});

test("verified match recording gates legacy ranking and proof-run writes by active mode", () => {
  const server = read("functions/index.js");
  const recording = sourceBetween(
    server,
    "async function recordVerifiedMatch",
    "function validatePostMatchTipRequest",
  );
  assert.match(
    recording,
    /const rankingEligibleMode = ACTIVE_SERVER_RANKING_MODES\.includes\(mode\)/,
  );
  assert.match(
    recording,
    /const serverPeriodInfos = rankingEligibleMode\s*\?[\s\S]*activeServerRankingPeriodInfos\(now\)/,
  );
  assert.match(recording, /addCrownRunResult/);
  assert.match(recording, /transaction\.set\(crownRunRefs\[index\], crownResult\.run\)/);
  assert.match(recording, /transaction\.set\(crownPeriodEntryRefs\[index\], crownResult\.run\)/);
  assert.match(recording, /mirrorServerOverallProfiles/);
  assert.match(recording, /mirrorCrownCircuitEntries/);
});

test("a missing profile starts competitive RATE at 1000, not at a client legacy RATE", () => {
  const server = read("functions/index.js");
  const legacySeed = sourceBetween(
    server,
    "async function legacyServerRankingSeed",
    "function emptyDaily",
  );
  assert.match(legacySeed, /\brating:\s*1000/);
  assert.match(legacySeed, /\bcompetitiveRating:\s*1000/);
  assert.match(
    legacySeed,
    /legacyRating:\s*integer\(publicValue\.rating,\s*100,\s*3000,\s*1000\)/,
  );

  const participation = sourceBetween(
    server,
    "async function setServerRankingParticipation",
    "async function getServerRankingAwards",
  );
  const missingProfile = sourceBetween(
    participation,
    "if (!snapshot.exists)",
    "const xHandle",
  );
  assert.match(missingProfile, /savedProfile\.rating\s*=\s*1000/);
  assert.match(missingProfile, /savedProfile\.competitiveRating\s*=\s*1000/);
  assert.match(
    missingProfile,
    /savedProfile\.legacyRating\s*=\s*integer\(publicValue\.rating,\s*100,\s*3000,\s*1000\)/,
  );
  assert.match(missingProfile, /savedProfile\.competitiveMatches\s*=\s*0/);
});

test("ranking dashboard actions and 00:05 JST finalizer are wired", () => {
  const server = read("functions/index.js");
  assert.match(server, /action === "get_ranking_dashboard"/);
  assert.match(server, /action === "start_crown_run"/);
  assert.match(server, /action === "set_crown_customization"/);
  assert.match(
    server,
    /onSchedule\(\{[\s\S]*schedule:\s*"every day 00:05"[\s\S]*timeZone:\s*"Asia\/Tokyo"[\s\S]*\}/,
  );
  assert.match(server, /crownCircuitPeriodRef/);
  assert.match(server, /crownAwardTier/);
  assert.match(server, /crownStarScore/);
});

test("period finalization keeps awards serializable and respects expiry boundaries", () => {
  const server = read("functions/index.js");
  const finalization = sourceBetween(
    server,
    "function finalizedCrownCircuitEntry",
    "exports.cleanupOnlinePublicPresence",
  );

  assert.match(finalization, /return \{\s*\.\.\.run,\s*awardTier:\s*tier\s*\}/);
  assert.match(finalization, /periodEndsAt\("weekly", sourceKey\)\s*-\s*1/);
  assert.match(finalization, /delete historicalEntry\.xHandle/);
  assert.match(finalization, /delete historicalSpotlight\.xHandle/);
  assert.match(
    finalization,
    /crownCircuitHallOfFame\/monthly\/\$\{key\}[\s\S]{0,120}\.\.\.historicalSpotlight/,
  );
  assert.match(
    finalization,
    /period === "monthly"\s*&&\s*participantCount >= 2/,
  );
  assert.match(
    finalization,
    /serverRankingProfileRef\(championRecord\.uid\)\.get\(\)[\s\S]{0,500}liveProfile\.enabled[\s\S]{0,160}liveProfile\.entryId === champion\.entryId[\s\S]{0,160}liveProfile\.xHandle/,
  );
  assert.match(
    finalization,
    /latestProfileSnapshot[\s\S]{0,180}syncRankingSpotlightConsent\(latestProfileSnapshot\.data\(\)\)/,
  );
  assert.match(
    server,
    /spotlightSnapshot\.child\("endsAt"\)\.val\(\)[\s\S]{0,80}>\s*now/,
  );

  const catchUp = sourceBetween(
    server,
    "async function finalizeClosedCrownCircuitPeriods",
    "exports.finalizeCrownCircuit",
  );
  assert.match(catchUp, /\{\s*length:\s*8\s*\}/);
  assert.match(catchUp, /\{\s*length:\s*4\s*\}/);
  assert.match(catchUp, /monthlyKey = previousMonthlyPeriodKey\(monthlyKey\)/);
  assert.match(catchUp, /dailyKeys[\s\S]*weeklyKeys[\s\S]*monthlyKeys/);
  assert.doesNotMatch(catchUp, /index\s*\*\s*32\s*\*\s*dayMs/);
});

test("monthly Crown achievements are recorded idempotently before finalization and backfilled by revision", () => {
  const server = read("functions/index.js");
  const aggregation = sourceBetween(
    server,
    "async function aggregateFinalizedCrownEntries",
    "async function finalizeCrownCircuitPeriod",
  );
  assert.match(aggregation, /targetPeriod === "monthly"[\s\S]*recordCrownMonthlyParticipations/);

  const participation = sourceBetween(
    server,
    "async function recordCrownMonthlyParticipations",
    "async function aggregateFinalizedCrownEntries",
  );
  assert.match(participation, /firestore\.runTransaction[\s\S]*addCrownMonthlyParticipation/);

  const reconciliation = sourceBetween(
    server,
    "async function reconcileCrownMonthlyAchievements",
    "async function recordCrownMonthlyParticipations",
  );
  assert.match(reconciliation, /firestore\.runTransaction[\s\S]*finalizeCrownMonthlyAchievement/);

  const finalization = sourceBetween(
    server,
    "async function finalizeCrownCircuitPeriod",
    "async function finalizeClosedCrownCircuitPeriods",
  );
  assert.match(
    finalization,
    /alreadyFinalized[\s\S]*achievementRevision[\s\S]*reconcileCrownMonthlyAchievements/,
  );
  assert.match(
    finalization,
    /await commitCrownCircuitWrites\(writes\);[\s\S]*period === "monthly"[\s\S]*reconcileCrownMonthlyAchievements[\s\S]*status: "finalized"/,
  );
  assert.match(finalization, /achievementRevision: CROWN_MONTHLY_ACHIEVEMENT_REVISION/);
  assert.match(server, /const crownMonthlyStats = normalizeCrownMonthlyStats\(crownMonthlyStatsSnapshot\.data\(\)\)/);
});

test("achievement showcase refreshes propagate to active Crown Circuit entries", () => {
  const server = read("functions/index.js");
  const sync = sourceBetween(
    server,
    "async function syncAchievementPublicSurfaces",
    "async function syncCurrentServerRankingMetadata",
  );
  assert.match(sync, /await Promise\.all\(updates\);[\s\S]*syncCurrentCrownCircuitAchievementShowcase/);
  assert.doesNotMatch(sync, /syncCurrentCrownCircuitMetadata/);
  const crownShowcaseSync = sourceBetween(
    server,
    "async function syncCurrentCrownCircuitAchievementShowcase",
    "async function syncRankingSpotlightConsent",
  );
  assert.match(crownShowcaseSync, /achievementShowcase: achievementShowcase \|\| FieldValue\.delete\(\)/);
  assert.match(crownShowcaseSync, /publicRef\.transaction/);
  assert.doesNotMatch(crownShowcaseSync, /name:|rating:|commentsEnabled:|crownTheme:|xHandle:|crownSignatureId:/);
  const initialize = sourceBetween(server, "async function initializeEconomy", "async function claimDaily");
  assert.match(initialize, /syncAchievementPublicSurfaces\(uid, profile\)/);
});

test("legacy ranking maintenance never reads or rewrites active Crown Circuit periods", () => {
  const server = read("functions/index.js");
  const activePeriods = sourceBetween(
    server,
    "function activeServerRankingPeriodInfos",
    "function calculateServerRankingRating",
  );
  assert.match(activePeriods, /isServerRankingPeriod\(period, key\)/);
  assert.match(activePeriods, /!isCrownCircuitPeriod\(period, key\)/);

  for (const [start, end] of [
    ["async function syncAchievementPublicSurfaces", "async function syncCurrentServerRankingMetadata"],
    ["async function syncCurrentServerRankingMetadata", "async function syncCurrentCrownCircuitMetadata"],
    ["async function removeServerRankingPublicEntries", "async function setServerRankingParticipation"],
    ["async function recordVerifiedMatch", "function validatePostMatchTipRequest"],
  ]) {
    assert.match(sourceBetween(server, start, end), /activeServerRankingPeriodInfos\(/);
  }
});

test("live Crown metadata and X consent stay synchronized without private history links", () => {
  const server = read("functions/index.js");
  const sync = sourceBetween(
    server,
    "async function syncCurrentCrownCircuitMetadata",
    "async function finalizeServerRankingAwards",
  );
  assert.match(sync, /xHandle:\s*profile\.xHandle\s*\|\|\s*FieldValue\.delete\(\)/);
  assert.match(sync, /achievementShowcase:\s*profile\.achievementShowcase\s*\|\|\s*FieldValue\.delete\(\)/);
  assert.match(sync, /crownSignatureId:\s*profile\.crownSignatureId\s*\|\|\s*FieldValue\.delete\(\)/);
  assert.match(sync, /mirrorCrownCircuitEntries/);
  assert.match(sync, /spotlightRef\.transaction\(\(current\) =>/);
  assert.match(sync, /if \(!profile\.enabled \|\| !profile\.xHandle\) return null/);

  const participation = sourceBetween(
    server,
    "async function setServerRankingParticipation",
    "async function getServerRankingAwards",
  );
  assert.match(participation, /syncCurrentCrownCircuitMetadata\(uid, finalizedProfile\)/);
  assert.match(participation, /syncRankingSpotlightConsent\(finalizedProfile\)/);
  assert.match(
    server,
    /setCrownCustomization[\s\S]*syncRankingSpotlightConsent\(profile\)/,
  );
});

test("server Crown ordering ignores metadata timestamps", () => {
  const circuit = read("functions/crown-circuit.js");
  const dailyComparator = sourceBetween(
    circuit,
    "function compareCrownRunEntries",
    "function crownStarScore",
  );
  const periodComparator = sourceBetween(
    circuit,
    "function compareCrownCircuitEntries",
    "function crownAwardTier",
  );
  assert.doesNotMatch(dailyComparator, /updatedAt/);
  assert.doesNotMatch(periodComparator, /updatedAt/);
  assert.match(dailyComparator, /entryId/);
  assert.match(periodComparator, /entryId/);
});

test("public crown entries never expose opponent identifiers or private run counters", () => {
  const server = read("functions/index.js");
  const publicProjection = sourceBetween(
    server,
    "function publicCrownCircuitEntry",
    "async function mirrorServerOverallProfiles",
  );
  assert.doesNotMatch(publicProjection, /opponentCounts/);
  assert.doesNotMatch(publicProjection, /\buid\b/);
});
