"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const realtimeRules = JSON.parse(
  fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
).rules.online;
const firestoreRules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8",
);

const RETIRED_TRAINING_PATHS = Object.freeze([
  "trainingSessionClaims",
  "trainingAttemptsV5",
  "trainingV6",
  "trainingSessionActionRates",
  "trainingSessionCleanupCursors",
  "trainingMatchPermitsV4",
  "trainingMatchLocksV4",
  "trainingQueueV4",
  "trainingActiveV4",
  "trainingOffersV4",
  "trainingQueue",
  "trainingActive",
  "trainingRoomCleanupCursor",
  "trainingActiveCleanupCursor",
  "trainingActiveCleanupGuards",
  "trainingMatchLock",
  "trainingInvites",
  "trainingRooms",
]);

test("Training 60 V1-V6 realtime namespaces remain explicit closed tombstones", () => {
  for (const retiredPath of RETIRED_TRAINING_PATHS) {
    assert.deepEqual(
      realtimeRules[retiredPath],
      { ".read": false, ".write": false },
      retiredPath,
    );
  }
});

test("public presence no longer accepts the retired training mode", () => {
  const presence = realtimeRules.publicPresence.$sessionId;

  assert.doesNotMatch(presence[".validate"], /training/);
  assert.doesNotMatch(presence.mode[".validate"], /training/);
  assert.match(presence.mode[".validate"], /'solo'/);
  assert.match(presence.mode[".validate"], /'strategy'/);
});

test("retired Firestore history stays represented behind explicit client denies", () => {
  for (const collection of [
    "trainingProfiles",
    "trainingClaims",
    "trainingV6Claims",
  ]) {
    const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      firestoreRules,
      new RegExp(
        `match \\/${escaped}\\/\\{[^}]+\\}(?: \\/\\{[^}]+\\})? \\{\\s*allow read, write: if false;`,
      ),
      collection,
    );
  }
});
