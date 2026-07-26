"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const databaseRules = JSON.parse(
  fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
).rules.freeTables;
const firestoreRules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const rollout = require("../app-check-rollout");

function containsAll(value, parts) {
  for (const part of parts) assert.ok(value.includes(part), `missing ${part}`);
}

test("freeTableAction is App Check enforced and has a separate cleanup job", () => {
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.freeTableAction, true);
  assert.match(
    functionsSource,
    /exports\.freeTableAction = onCall\(callableOptions\("freeTableAction"\)/,
  );
  assert.match(functionsSource, /exports\.cleanupExpiredFreeTables = onSchedule\(/);
  assert.match(functionsSource, /every 5 minutes/);
  const serviceSource = fs.readFileSync(
    path.join(root, "functions", "free-table.js"),
    "utf8",
  );
  assert.match(serviceSource, /cleanupExpiredFirestoreCollection\("freeTableReports", now\)/);
  assert.match(serviceSource, /cleanupExpiredFirestoreCollection\("freeTableVisitLedger", now\)/);
  assert.match(serviceSource, /\.where\("expireAt", "<=", Timestamp\.fromMillis\(now\)\)/);
});

test("public shelf and coordination state are callable-only", () => {
  for (const pathName of ["publicRooms", "roomStates", "roomOwners", "engagements"]) {
    assert.equal(databaseRules[pathName][".read"], false);
    assert.equal(databaseRules[pathName][".write"], false);
  }
  assert.equal(databaseRules.hostActive.$uid[".write"], false);
  assert.equal(databaseRules.visitorPending.$uid[".write"], false);
  assert.equal(databaseRules.active.$uid[".write"], false);
  assert.match(databaseRules.hostActive.$uid[".read"], /auth\.uid === \$uid/);
  assert.match(databaseRules.visitorPending.$uid[".read"], /auth\.uid === \$uid/);
});

test("request and session reads are restricted to their host or participants", () => {
  containsAll(databaseRules.requests.$roomId[".read"], [
    "roomOwners/",
    "auth.uid",
    "expiresAt",
    ".val() > now",
  ]);
  assert.equal(databaseRules.requests.$roomId.$requestId[".read"], false);
  containsAll(databaseRules.sessions.$sessionId[".read"], [
    "participants",
    "auth.uid",
    "=== true",
  ]);
  assert.equal(databaseRules.sessions.$sessionId[".write"], false);
});

test("presence, chat, and signaling require the caller's live active session", () => {
  for (const expression of [
    databaseRules.presence.$sessionId[".read"],
    databaseRules.presence.$sessionId.$uid[".write"],
    databaseRules.chat.$sessionId[".read"],
    databaseRules.chat.$sessionId.$messageId[".write"],
    databaseRules.signals.$sessionId.$targetUid[".read"],
    databaseRules.signals.$sessionId.$targetUid.$messageId[".write"],
  ]) {
    containsAll(expression, [
      "freeTables/active/",
      "sessionId",
      "expiresAt",
      ".val() > now",
      "freeTables/sessions/",
      "participants",
      "status",
      "connecting",
    ]);
  }
});

test("ephemeral client records have exact fields, bounded payloads, and short TTLs", () => {
  const presence = databaseRules.presence.$sessionId.$uid;
  const chat = databaseRules.chat.$sessionId.$messageId;
  const signal = databaseRules.signals.$sessionId.$targetUid.$messageId;
  assert.equal(presence.$other[".validate"], false);
  assert.equal(chat.$other[".validate"], false);
  assert.equal(signal.$other[".validate"], false);
  assert.match(presence.expiresAt[".validate"], /now \+ 60000/);
  assert.match(chat.text[".validate"], /length <= 500/);
  assert.match(chat.expiresAt[".validate"], /\+ 1800000/);
  assert.match(signal.payload[".validate"], /length <= 30000/);
  assert.match(signal.expiresAt[".validate"], /\+ 120000/);
  containsAll(chat.authorRole[".validate"], ["hostUid", "visitorUid"]);
  containsAll(signal.type[".validate"], ["offer", "answer", "candidate"]);
  for (const expression of [
    presence[".write"],
    chat[".write"],
    signal[".write"],
  ]) {
    containsAll(expression, [
      "freeTables/sessions/",
      "expiresAt",
      "status",
      "connecting",
      "active",
    ]);
  }
  assert.match(chat[".write"], /\$messageId\.matches/);
  assert.match(signal[".write"], /\$messageId\.matches/);
  assert.match(signal[".write"], /\$targetUid !== auth\.uid/);
  assert.match(presence[".write"], /_disconnect\/state/);
  assert.match(presence[".write"], /!== 'locked'/);
  assert.match(presence[".write"], /\$uid !== '_disconnect'/);
  assert.equal(databaseRules.presence.$sessionId._disconnect[".write"], false);
  assert.equal(databaseRules.presence.$sessionId[".validate"], undefined);
  assert.equal(databaseRules.chat.$sessionId[".validate"], undefined);
  assert.equal(
    databaseRules.signals.$sessionId.$targetUid[".validate"],
    undefined,
  );
  assert.match(chat[".write"], /\^C\{20\}0\[0-4\]\[0-9\]\{2\}\$/);
  assert.match(chat[".write"], /\^C\{20\}1\[0-4\]\[0-9\]\{2\}\$/);
  assert.match(chat[".write"], /data\.child\('authorUid'\)\.val\(\) === auth\.uid/);
  assert.match(chat[".write"], /data\.child\('expiresAt'\)\.val\(\) <= now/);
  assert.match(
    chat[".write"],
    /newData\.child\('createdAt'\)\.val\(\) > data\.child\('createdAt'\)\.val\(\)/,
  );
  assert.match(signal[".write"], /\^S\{22\}\[0-7\]\[0-9\]\$/);
  assert.match(signal[".write"], /data\.child\('fromUid'\)\.val\(\) === auth\.uid/);
  assert.match(
    signal[".write"],
    /newData\.child\('createdAt'\)\.val\(\) > data\.child\('createdAt'\)\.val\(\)/,
  );
  assert.match(databaseRules.sessions.$sessionId[".read"], /expiresAt/);
});

test("all persistent free table collections are server-only", () => {
  for (const collection of [
    "freeTableProfiles",
    "freeTablePublicMembers",
    "freeTableSpaces",
    "freeTablePublicSpaces",
    "freeTableVisitLedger",
    "freeTablePairActivity",
    "freeTableBookmarks",
    "freeTableRelationships",
    "freeTableBlocks",
    "freeTableBlockPairs",
    "freeTableReports",
  ]) {
    assert.match(
      firestoreRules,
      new RegExp(`match /${collection}/`),
      `${collection} rules missing`,
    );
  }
  const freeTableSection = firestoreRules.slice(
    firestoreRules.indexOf("match /freeTableProfiles/"),
    firestoreRules.indexOf("match /{document=**}"),
  );
  assert.doesNotMatch(freeTableSection, /allow read: if isOwner/);
  assert.equal(
    (freeTableSection.match(/allow read, write: if false;/g) || []).length >= 10,
    true,
  );
});
