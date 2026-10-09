"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const databaseRules = JSON.parse(
  fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
).rules;
const firestoreRules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const rollout = require("../app-check-rollout");

test("retired free-table namespace has no descendant client grants", () => {
  // A deny at the parent does not override an allow at a child in RTDB.
  assert.deepEqual(databaseRules.freeTables, {
    ".read": false, ".write": false, sessions: { ".indexOn": ["expiresAt"] },
  });
  assert.equal(databaseRules[".read"], false);
  assert.equal(databaseRules[".write"], false);
});

test("legacy free-table endpoints retain App Check and shared block integration", () => {
  for (const name of ["freeTableAction", "freeTableInviteAction", "freeTableInvitePreview",
    "freeTablePublicStats", "reportFreeTableP2pConnectivity"]) {
    assert.equal(rollout.APP_CHECK_ENFORCEMENT[name], true, name);
    assert.match(functionsSource,
      new RegExp(`exports\\.${name} = onCall\\(\\s*callableOptions\\("${name}"`), name);
  }
  assert.match(functionsSource, /freeTableService\.closeBlockedPair\(context\)/);
  assert.match(functionsSource, /firestore\.collection\("freeTableBlockPairs"\)/);
});

test("free-table scheduler no longer runs live admission and presence cleanup", () => {
  const start = functionsSource.indexOf("exports.cleanupExpiredFreeTables = onSchedule(");
  const end = functionsSource.indexOf("async function commitCrownCircuitWrites(", start);
  assert.ok(start >= 0 && end > start, "retention scheduler must remain deployed");
  const scheduler = functionsSource.slice(start, end);
  assert.doesNotMatch(scheduler, /every 5 minutes|freeTableService\.cleanupExpired\(/);
  assert.match(scheduler, /schedule:/);
});

test("all persistent free-table history and legacy block collections remain server-only", () => {
  for (const collection of ["freeTableProfiles", "freeTablePublicMembers", "freeTableSpaces",
    "freeTablePublicSpaces", "freeTableVisitLedger", "freeTablePairActivity", "freeTableBookmarks",
    "freeTableRelationships", "freeTableBlocks", "freeTableBlockPairs", "freeTableReports"]) {
    assert.match(firestoreRules,
      new RegExp(`match /${collection}/\\{[^}]+\\} \\{\\s*allow read, write: if false;`),
      collection);
  }
});
