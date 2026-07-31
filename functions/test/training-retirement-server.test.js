"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const retiredServerFiles = [
  "functions/training.js",
  "functions/training-room-cleanup.js",
  "functions/training-session-service.js",
  "functions/training-session-v2.js",
  "functions/training-session-v5.js",
  "functions/training-session-v5-service.js",
  "functions/training-session-v5-cleanup.js",
  "functions/training-session-v6.js",
  "functions/training-session-v6-service.js",
  "functions/training-v6-settlement.js",
];

test("all Training 60 server generations and deployed entry points are retired", () => {
  for (const relativePath of retiredServerFiles) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }

  const source = read("functions/index.js");
  for (const exportName of [
    "trainingAction",
    "trainingSessionAction",
    "trainingV6Action",
    "cleanupTrainingRooms",
  ]) {
    assert.doesNotMatch(source, new RegExp(`exports\\.${exportName}\\b`));
  }
  assert.doesNotMatch(
    source,
    /createTrainingSession|executeTrainingV6Settlement|finalizeTraining|online\/trainingV6|online\/trainingRooms/,
  );

  const rollout = require("../app-check-rollout");
  assert.equal(Object.hasOwn(rollout.APP_CHECK_ENFORCEMENT, "trainingAction"), false);
  assert.equal(Object.hasOwn(rollout.APP_CHECK_ENFORCEMENT, "trainingSessionAction"), false);
  assert.equal(Object.hasOwn(rollout.APP_CHECK_ENFORCEMENT, "trainingV6Action"), false);
});

test("retirement keeps only private history and the closed mission definition", () => {
  const source = read("functions/index.js");
  assert.match(source, /firestore\.collection\("trainingProfiles"\)/);
  assert.match(source, /firestore\.collection\("trainingClaims"\)/);
  assert.match(source, /firestore\.collection\("trainingV6Claims"\)/);
  assert.match(source, /normalizeRetiredTrainingHistory/);
  assert.match(source, /retiredTrainingHistoryHasActivity/);
  assert.match(
    source,
    /play_training:\s*\{[\s\S]*?startsOn:\s*"2026-07-28"[\s\S]*?endsAfter:\s*"2026-08-01"/,
  );
});
