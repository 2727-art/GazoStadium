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
  serverRateFloorMirrorDecision,
} = require("../rate-floor");

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

test("RATE FLOOR is a server-owned opt-in with a ten-match publication gate", () => {
  assert.equal(SERVER_RATE_FLOOR_MINIMUM_MATCHES, 10);
  assert.match(functionsSource, /rateFloorEnabled: source\.rateFloorEnabled === true/);
  assert.match(functionsSource, /rateFloorRevision: normalizeServerRateFloorRevision/);

  const publicProfile = sourceBetween(
    "function publicServerRateFloorProfile",
    "function publicCrownCircuitEntry",
  );
  assert.match(publicProfile, /!profile\.enabled/);
  assert.match(publicProfile, /!profile\.rateFloorEnabled/);
  assert.match(publicProfile, /!profile\.entryId/);
  assert.match(publicProfile, /!profile\.rateFloorEntryId/);
  assert.match(
    publicProfile,
    /profile\.serverMatches < SERVER_RATE_FLOOR_MINIMUM_MATCHES/,
  );
  assert.match(publicProfile, /serverVerified: true/);
  assert.match(publicProfile, /name: cleanName\(profile\.name\)/);
  assert.match(publicProfile, /rating: profile\.rating/);
  assert.match(publicProfile, /serverMatches: profile\.serverMatches/);
  assert.doesNotMatch(
    publicProfile,
    /xHandle|commentsEnabled|achievementShowcase|crownTheme|crownSignatureId|rankingAward/,
  );
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
