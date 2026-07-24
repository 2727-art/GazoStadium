const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("stale familiar handles cannot mutate a newer relationship generation", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function removeOrBlockSoloFamiliar");
  const end = source.indexOf("async function unblockSoloFamiliar", start);
  const mutation = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(mutation, /familiarId !== currentOwnEntryId/);
});

test("account transfer rechecks familiar state inside its final transaction", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function redeemAccountTransferCode");
  const end = source.indexOf("async function cancelAccountTransferCode", start);
  const redemption = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(redemption, /transaction\.get\(soloFamiliarBookRef\(targetUid\)\)/);
  assert.match(redemption, /transaction\.get\(soloFamiliarBlockRef\(targetUid\)\)/);
  assert.match(redemption, /targetFamiliarBookSnapshot\.exists/);
  assert.match(redemption, /targetFamiliarBlockSnapshot\.exists/);
});

test("match cleanup keeps its durable permit until non-destructive cleanup succeeds", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function cleanupSoloMatchContext");
  const end = source.indexOf("async function cancelPendingSoloMatchPermit", start);
  const cleanup = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(cleanup, /roomRef\.get\(\)\.catch/);
  assert.doesNotMatch(cleanup, /Promise\.allSettled/);
  assert.match(cleanup, /room\?\.presence\?\.\[participantUid\]\?\.online === true/);
  assert.ok(
    cleanup.indexOf("await Promise.all(cleanupTasks)")
      < cleanup.lastIndexOf("await permitRef.transaction"),
  );
  assert.ok(
    cleanup.indexOf("releaseSoloMatchPermitLocks")
      < cleanup.lastIndexOf("await permitRef.transaction"),
  );
});

test("active reunion cooldown is confirmed during durable permit cleanup", () => {
  const source = read("functions/index.js");
  const cleanupStart = source.indexOf("async function cleanupSoloMatchContext");
  const cleanupEnd = source.indexOf("async function cancelPendingSoloMatchPermit", cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /roomIsActive && permit\?\.reunion === true/);
  assert.match(
    cleanup,
    /const reunionConfirmed = await confirmSoloFamiliarReunionFromRoom\(roomId/,
  );
  assert.match(cleanup, /if \(!reunionConfirmed\)/);
  assert.ok(
    cleanup.indexOf("confirmSoloFamiliarReunionFromRoom")
      < cleanup.indexOf("releaseSoloMatchPermitLocks"),
  );
  assert.ok(
    cleanup.indexOf("if (!reunionConfirmed)")
      < cleanup.lastIndexOf("await permitRef.transaction"),
  );

  const confirmationStart = source.indexOf("async function confirmSoloFamiliarReunionFromRoom");
  const confirmationEnd = source.indexOf("async function confirmSoloFamiliarReunion(", confirmationStart);
  const confirmation = source.slice(confirmationStart, confirmationEnd);
  assert.ok(confirmationStart >= 0 && confirmationEnd > confirmationStart);
  assert.match(confirmation, /sameIds\(\(pairSnapshot\.get\("participants"\)/);
  assert.doesNotMatch(confirmation, /pairSnapshot\.get\("active"\) !== true/);
  assert.doesNotMatch(confirmation, /let confirmed/);
  assert.match(confirmation, /const confirmed = await firestore\.runTransaction/);
  assert.match(confirmation, /return confirmed === true/);
  assert.match(confirmation, /lastReunionPriorityAt/);
  assert.match(source, /const existing = await loadExistingSoloHostedMatch\(uid, Date\.now\(\)\)/);
  assert.match(source, /if \(existing\) return existing/);
});

test("block reads and selection use one bounded, validated queue", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function trySoloServerMatch");
  const end = source.indexOf("async function confirmSoloFamiliarReunionFromRoom", start);
  const matching = source.slice(start, end);
  assert.match(source, /function boundedSoloServerQueue/);
  assert.match(source, /isValidSoloServerQueueEntry\(candidateUid, entry, now\)/);
  assert.match(matching, /blockedSoloPairIdsForQueue\(uid, boundedQueue, selectionNow\)/);
  assert.match(matching, /queue: boundedQueue/);
  assert.match(matching, /excludedUids: Object\.keys\(locks\)/);

  const lockStart = matching.indexOf(
    'const lockResult = await realtime.ref("online/soloMatchPermitLocks").transaction',
  );
  const lockEnd = matching.indexOf("if (!lockResult.committed)", lockStart);
  const locking = matching.slice(lockStart, lockEnd);
  assert.ok(lockStart >= 0 && lockEnd > lockStart);
  assert.match(locking, /current\[participantUid\]/);
  assert.doesNotMatch(locking, /expiredLockContexts|delete next|expiredByRoom/);

  const rules = JSON.parse(read("database.rules.json")).rules.online.queue.$uid[".validate"];
  for (const requiredField of [
    "pursuitLine",
    "rating",
    "ratingPreference",
    "allowPreferenceMismatch",
  ]) {
    assert.match(rules, new RegExp(`'${requiredField}'`));
  }
  assert.doesNotMatch(rules, /'reunionPreference'/);
});
