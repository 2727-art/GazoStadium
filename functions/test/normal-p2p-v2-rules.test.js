"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");
const source = readFileSync(join(repositoryRoot, "database.rules.json"), "utf8");
const rules = JSON.parse(source).rules.online;

function includesAll(value, fragments) {
  for (const fragment of fragments) {
    assert.match(value, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

test("V2 server-owned matchmaking and diagnostic paths are private", () => {
  for (const path of [
    "soloMatchPermitsV2",
    "soloMatchLocksV2",
    "soloSessionActionRates",
    "soloLegacyActiveInspections",
    "p2pDiagnostics",
    "p2pDiagnosticDays",
    "p2pMaintenance",
    "p2pRateLimits",
  ]) {
    assert.equal(rules[path][".read"], false, `${path} must not be client-readable`);
    assert.equal(rules[path][".write"], false, `${path} must not be client-writable`);
  }
  assert.deepEqual(rules.soloMatchPermitsV2[".indexOn"], ["expiresAt"]);
  assert.deepEqual(rules.soloMatchLocksV2[".indexOn"], ["expiresAt"]);
});

test("session claims are entirely backend-owned", () => {
  const claim = rules.soloSessionClaims.$uid;
  assert.deepEqual(rules.soloSessionClaims[".indexOn"], ["expiresAt"]);
  assert.equal(claim[".read"], false);
  assert.equal(claim[".write"], false);
});

test("unused session presence metadata is entirely private", () => {
  assert.equal(rules.soloSessionPresence[".read"], false);
  assert.equal(rules.soloSessionPresence[".write"], false);
});

test("queueV2 permits only the current owner claim to write waiting records", () => {
  const queue = rules.queueV2.$uid.$sessionId;
  assert.equal(rules.queueV2[".read"], undefined);
  assert.equal(queue[".read"], false);
  includesAll(queue[".write"], [
    "auth.uid === $uid",
    "newData.exists()",
    "soloSessionClaims/",
    "/sessionId",
    "/leaseToken",
    "/generation",
    "/expiresAt",
    "newData.child('state').val() === 'waiting'",
    "data.child('state').val() === 'waiting'",
    "data.child('connectionGeneration').val() === newData.child('connectionGeneration').val()",
    "data.child('joinedAt').val() === newData.child('joinedAt').val()",
  ]);
  assert.doesNotMatch(queue[".write"], /!newData\.exists\(\)/);
  includesAll(queue[".validate"], [
    "newData.child('protocolVersion').val() === 2",
    "newData.child('uid').val() === $uid",
    "newData.child('sessionId').val() === $sessionId",
    "newData.child('generation').val() === root.child('online/soloSessionClaims/",
    "newData.child('expiresAt').val() === root.child('online/soloSessionClaims/",
  ]);
  assert.equal(queue.state[".validate"], "newData.val() === 'waiting'");
  assert.equal(queue.attemptId[".validate"], false);
  assert.equal(queue.roomId[".validate"], false);
  assert.equal(queue.$other[".validate"], false);
});

test("activeV2 and offersV2 cannot be changed by clients", () => {
  const active = rules.activeV2.$uid.$sessionId;
  assert.equal(rules.activeV2.$uid[".read"], false);
  assert.equal(active[".write"], false);
  assert.equal(active[".validate"], "!newData.exists()");

  assert.equal(rules.offersV2[".write"], false);
  includesAll(rules.offersV2.$targetUid.$targetSessionId[".read"], [
    "auth.uid === $targetUid",
    "/sessionId",
    "$targetSessionId",
    "/expiresAt",
    ".val() > now",
  ]);
});

test("fresh V2 claims fence legacy queue, active, and offers writes", () => {
  for (const expression of [
    rules.queue.$uid[".write"],
    rules.active.$uid[".write"],
    rules.offers.$targetUid.$roomId[".write"],
  ]) {
    includesAll(expression, [
      "soloSessionClaims/",
      "/protocolVersion",
      ".val() === 2",
      "/expiresAt",
      ".val() > now",
    ]);
  }
});

test("V2 room identity fields and sessions are backend-owned", () => {
  const room = rules.rooms.$roomId;
  for (const field of [
    "protocolVersion",
    "signalingVersion",
    "connectionGeneration",
    "attemptId",
    "sessions",
  ]) {
    assert.equal(room[field][".write"], false, `${field} must be backend-owned`);
  }
  assert.equal(room.protocolVersion[".validate"], "newData.val() === 2");
  assert.equal(room.signalingVersion[".validate"], "newData.val() === 2");
  assert.match(room.sessions.$uid.generation[".validate"], /\{22\}/);
  assert.equal(room.sessions.$uid.$other[".validate"], false);
  includesAll(room.status[".write"], [
    "/protocolVersion",
    ".val() !== 2",
  ]);
  for (const expression of [
    room.hostUid[".write"],
    room.guestUid[".write"],
    room.createdAt[".write"],
    room.members.$uid[".write"],
    room.players.$uid[".write"],
    room.reunion[".write"],
  ]) {
    includesAll(expression, [
      "/protocolVersion",
      ".val() !== 2",
    ]);
  }
});

test("presenceV2 binds the owner claim to the exact room session", () => {
  const presence = rules.rooms.$roomId.presenceV2.$uid.$sessionId;
  includesAll(presence[".write"], [
    "auth.uid === $uid",
    "/protocolVersion",
    "/signalingVersion",
    "/members/",
    "/sessions/",
    "soloSessionClaims/",
    "/leaseToken",
    "/generation",
  ]);
  assert.equal(presence.$other[".validate"], false);
});

test("V2 gameplay writes require the current room session claim", () => {
  const room = rules.rooms.$roomId;
  for (const expression of [
    room.rounds.$round[".validate"],
    room.chat.$messageId[".write"],
    room.resultClaims.$uid[".write"],
    room.finished.$uid[".write"],
  ]) {
    includesAll(expression, [
      "/protocolVersion",
      ".val() !== 2",
      "/destroyed",
      "soloSessionClaims/",
      "/sessionId",
      "/sessions/",
      "/generation",
      "/expiresAt",
      ".val() > now",
    ]);
  }
  includesAll(room.destroyed[".write"], [
    "/protocolVersion",
    ".val() !== 2",
    "soloSessionClaims/",
    "/sessionId",
    "/sessions/",
    "/generation",
    "/expiresAt",
    ".val() > now",
  ]);
});

test("signalsV2 are session-scoped, generation-scoped, and target-consumed", () => {
  const room = rules.rooms.$roomId;
  const signal = room.signalsV2.$targetUid.$targetSessionId.$messageId;
  includesAll(signal[".write"], [
    "auth.uid === $targetUid",
    "data.exists()",
    "!newData.exists()",
    "data.child('toSessionId').val() === $targetSessionId",
    "auth.uid !== $targetUid",
    "!data.exists()",
    "newData.child('fromUid').val() === auth.uid",
    "newData.child('toUid').val() === $targetUid",
    "/sessions/",
    "soloSessionClaims/",
    "/connectionGeneration",
    "/attemptId",
  ]);
  includesAll(signal[".validate"], [
    "newData.child('protocolVersion').val() === 2",
    "newData.child('signalingVersion').val() === 2",
    "newData.child('type').val() === 'offer'",
    "newData.child('type').val() === 'answer'",
    "newData.child('type').val() === 'candidate'",
    "newData.child('payload').val().length <= 30000",
    "newData.child('createdAt').val() >= now - 60000",
    "newData.child('createdAt').val() <= now + 15000",
  ]);
  assert.equal(signal.$other[".validate"], false);
  includesAll(room.signals.$targetUid.$messageId[".write"], [
    "/protocolVersion",
    ".val() !== 2",
    "/signalingVersion",
    ".val() !== 2",
  ]);
});
