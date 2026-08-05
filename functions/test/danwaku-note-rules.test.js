"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const firestoreRules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8",
);

test("Danwaku private, public-projection, and match-badge documents are explicitly Admin-only", () => {
  assert.match(
    firestoreRules,
    /match \/danwakuProfiles\/\{uid\} \{\s*allow read, write: if false;\s*match \/notes\/\{noteId\} \{\s*allow read, write: if false;\s*match \/events\/\{eventId\} \{\s*allow read, write: if false;/,
  );
  assert.match(
    firestoreRules,
    /match \/danwakuPublicEntries\/\{entryId\} \{\s*allow read, write: if false;/,
  );
  assert.match(
    firestoreRules,
    /match \/operations\/\{operationId\} \{\s*allow read, write: if false;/,
  );
  assert.match(
    firestoreRules,
    /match \/danwakuMatchBadges\/\{uid\} \{\s*allow read, write: if false;/,
  );
  assert.match(
    firestoreRules,
    /match \/strategyMatchAchievementFreezes\/\{roomId\} \{\s*allow read, write: if false;/,
  );
});
