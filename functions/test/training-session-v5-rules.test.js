"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");
const rules = JSON.parse(
  readFileSync(join(repositoryRoot, "database.rules.json"), "utf8"),
).rules;
const trainingSource = readFileSync(
  join(repositoryRoot, "training.js"),
  "utf8",
);
const online = rules.online;
const room = online.trainingRooms.$roomId;

function includesAll(value, fragments) {
  assert.equal(typeof value, "string");
  for (const fragment of fragments) {
    assert.ok(
      value.includes(fragment),
      `expected rule to include ${JSON.stringify(fragment)}`,
    );
  }
}

function assertNoClientGrant(value, path = "") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}/${key}` : key;
    if (key === ".read" || key === ".write") {
      assert.equal(child, false, `${childPath} must not grant client access`);
    } else {
      assertNoClientGrant(child, childPath);
    }
  }
}

test("trainingAttemptsV5 is server-owned and readable only by its owner", () => {
  const attempts = online.trainingAttemptsV5;

  assert.equal(attempts[".read"], false);
  assert.equal(attempts[".write"], false);
  assert.deepEqual(attempts[".indexOn"], ["queueExpiresAt", "updatedAt"]);
  assert.equal(
    attempts.$uid[".read"],
    "auth != null && auth.uid === $uid",
  );
  assert.equal(attempts.$uid[".write"], false);
});

test("every retired training matchmaking namespace has no client grant", () => {
  for (const path of [
    "trainingSessionClaims",
    "trainingMatchPermitsV4",
    "trainingMatchLocksV4",
    "trainingQueueV4",
    "trainingActiveV4",
    "trainingOffersV4",
    "trainingQueue",
    "trainingActive",
    "trainingMatchLock",
    "trainingInvites",
  ]) {
    assertNoClientGrant(online[path], path);
  }
});

test("training rooms are backend-created V3 games on session and signaling V5", () => {
  assert.equal(room[".read"], false);
  assert.equal(room[".write"], false);
  includesAll(room[".validate"], [
    "'protocolVersion'",
    "'sessionProtocolVersion'",
    "'signalingVersion'",
    "'roomAttemptId'",
    "'transportEpoch'",
    "'sessions'",
    "'chatFrames'",
    "'rounds'",
    "newData.child('protocolVersion').val() === 3",
    "newData.child('variant').val() === 'kitaeai_hp_v3'",
    "newData.child('sessionProtocolVersion').val() === 5",
    "newData.child('signalingVersion').val() === 5",
    "newData.child('status').val() === 'active'",
    "newData.child('accepted/' + newData.child('hostUid').val()).val() === true",
    "newData.child('accepted/' + newData.child('guestUid').val()).val() === true",
    "newData.child('rounds/1/createdAt').isNumber()",
    "!newData.child('attemptId').exists()",
    "!newData.child('connectionGeneration').exists()",
    "!newData.child('presence').exists()",
    "!newData.child('presenceV2').exists()",
    "!newData.child('signals').exists()",
    "!newData.child('signalsV2').exists()",
  ]);

  assert.equal(room.protocolVersion[".validate"], "newData.val() === 3");
  assert.equal(
    room.variant[".validate"],
    "newData.parent().child('protocolVersion').val() === 3 && newData.val() === 'kitaeai_hp_v3'",
  );
  assert.equal(
    room.sessionProtocolVersion[".validate"],
    "newData.parent().child('protocolVersion').val() === 3 && newData.val() === 5",
  );
  assert.equal(
    room.signalingVersion[".validate"],
    "newData.parent().child('sessionProtocolVersion').val() === 5 && newData.val() === 5",
  );
  assert.equal(room.status[".write"], false);
  assert.equal(room.status[".validate"], "newData.val() === 'active'");
});

test("all room writes are fenced by the exact active or reserved attempt identity", () => {
  includesAll(room[".validate"], [
    "online/trainingAttemptsV5/",
    "/protocolVersion').val() === 5",
    "/signalingVersion').val() === 5",
    "/state').val() === 'reserved'",
    "/state').val() === 'active'",
    "/roomId').val() === $roomId",
    "/roomAttemptId').val() === newData.child('roomAttemptId').val()",
    "/transportEpoch').val() === newData.child('transportEpoch').val()",
    "/runId').val() === newData.child('sessions/' + auth.uid + '/runId').val()",
    "/endpointId').val() === newData.child('sessions/' + auth.uid + '/endpointId').val()",
    "/ownerEpoch').val() === newData.child('sessions/' + auth.uid + '/ownerEpoch').val()",
  ]);

  for (const field of [
    "protocolVersion",
    "sessionProtocolVersion",
    "signalingVersion",
    "roomAttemptId",
    "transportEpoch",
    "sessions",
    "hostUid",
    "guestUid",
    "status",
    "members",
    "players",
    "chatFrames",
    "accepted",
  ]) {
    includesAll(room[field][".read"], [
      "online/trainingAttemptsV5/",
      "/state').val() === 'reserved'",
      "/state').val() === 'active'",
      "/roomId').val() === $roomId",
      "/roomAttemptId",
      "/transportEpoch",
      "/runId",
      "/endpointId",
      "/ownerEpoch",
    ]);
  }
});

test("the V5 room skeleton reads only fields granted by the exact attempt fence", () => {
  const start = trainingSource.indexOf("async function readRoomSkeleton");
  const end = trainingSource.indexOf("async function readRoundScoresBounded", start);
  assert.ok(start >= 0 && end > start);
  const source = trainingSource.slice(start, end);
  const keysSource = source.match(/const keys = \[([\s\S]*?)\];/)?.[1] || "";
  const fields = [...keysSource.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(fields, [
    "protocolVersion",
    "variant",
    "sessionProtocolVersion",
    "signalingVersion",
    "roomAttemptId",
    "transportEpoch",
    "sessions",
    "hostUid",
    "guestUid",
    "createdAt",
    "status",
    "members",
    "players",
    "chatFrames",
    "accepted",
  ]);
  for (const field of fields) {
    assert.ok(room[field], `missing Rules entry for V5 room skeleton field ${field}`);
    includesAll(room[field][".read"], [
      "online/trainingAttemptsV5/",
      "/state').val() === 'reserved'",
      "/state').val() === 'active'",
      "/roomId').val() === $roomId",
      "/roomAttemptId",
      "/transportEpoch",
      "/runId",
      "/endpointId",
      "/ownerEpoch",
    ]);
  }
});

test("room sessions contain only the exact run owner identity", () => {
  const session = room.sessions.$uid;

  includesAll(room.sessions[".validate"], [
    "sessionProtocolVersion",
    ".val() === 5",
    "hostUid",
    "guestUid",
  ]);
  includesAll(session[".validate"], [
    "'runId', 'endpointId', 'ownerEpoch'",
    "hostUid",
    "guestUid",
  ]);
  for (const field of ["runId", "endpointId", "ownerEpoch"]) {
    assert.match(session[field][".validate"], /\{8,128\}/);
  }
  assert.equal(session.$other[".validate"], false);
  assert.equal(Object.hasOwn(session, "sessionId"), false);
  assert.equal(Object.hasOwn(session, "generation"), false);
});

test("legacy training presence and signaling paths are denied", () => {
  for (const path of ["presence", "presenceV2", "signals", "signalsV2"]) {
    assert.equal(room[path][".read"], false);
    assert.equal(room[path][".write"], false);
  }
  assert.equal(room.presence.$uid[".write"], false);
  assert.equal(room.presenceV2.$uid.$sessionId[".write"], false);
  assert.equal(room.signals.$targetUid[".read"], false);
  assert.equal(room.signals.$targetUid.$signalId[".write"], false);
  assert.equal(
    room.signalsV2.$targetUid.$targetSessionId[".read"],
    false,
  );
  assert.equal(
    room.signalsV2.$targetUid.$targetSessionId.$signalId[".write"],
    false,
  );
});

test("presenceV5 is member-readable and exact-run owner-writable", () => {
  const presence = room.presenceV5.$uid.$runId;

  includesAll(room.presenceV5[".read"], [
    "/protocolVersion').val() === 3",
    "/sessionProtocolVersion').val() === 5",
    "/signalingVersion').val() === 5",
    "/members/' + auth.uid",
    "online/trainingAttemptsV5/",
    "/roomAttemptId",
    "/transportEpoch",
    "/runId",
    "/endpointId",
    "/ownerEpoch",
  ]);
  includesAll(presence[".write"], [
    "auth.uid === $uid",
    "/members/' + $uid",
    "online/trainingAttemptsV5/",
    "/state').val() === 'reserved'",
    "/state').val() === 'active'",
    "/roomId').val() === $roomId",
    "/roomAttemptId",
    "/transportEpoch",
    "/runId').val() === $runId",
    "/sessions/' + $uid + '/runId').val() === $runId",
    "/endpointId",
    "/ownerEpoch",
  ]);
  includesAll(presence[".validate"], [
    "'protocolVersion', 'runId', 'endpointId', 'ownerEpoch', 'roomAttemptId', 'transportEpoch', 'online', 'updatedAt'",
    "newData.child('protocolVersion').val() === 5",
    "newData.child('runId').val() === $runId",
    "newData.child('roomAttemptId').val()",
    "newData.child('transportEpoch').val()",
    "newData.child('online').isBoolean()",
    "newData.child('updatedAt').val() >= now - 60000",
    "newData.child('updatedAt').val() <= now + 15000",
  ]);
  assert.equal(presence.protocolVersion[".validate"], "newData.val() === 5");
  assert.match(presence.runId[".validate"], /\{8,128\}/);
  assert.match(presence.endpointId[".validate"], /\{8,128\}/);
  assert.match(presence.ownerEpoch[".validate"], /\{8,128\}/);
  assert.match(presence.roomAttemptId[".validate"], /\{8,128\}/);
  assert.match(presence.transportEpoch[".validate"], /\{8,128\}/);
  assert.equal(presence.$other[".validate"], false);
});

test("signalsV5 are exact target-run mailboxes with exact transport envelopes", () => {
  const mailbox = room.signalsV5.$targetUid.$targetRunId;
  const signal = mailbox.$signalId;

  assert.equal(room.signalsV5[".read"], false);
  assert.equal(room.signalsV5[".write"], false);
  includesAll(mailbox[".read"], [
    "auth.uid === $targetUid",
    "/members/' + $targetUid",
    "online/trainingAttemptsV5/",
    "/state').val() === 'reserved'",
    "/state').val() === 'active'",
    "/roomId').val() === $roomId",
    "/roomAttemptId",
    "/transportEpoch",
    "/runId').val() === $targetRunId",
    "/sessions/' + $targetUid + '/runId').val() === $targetRunId",
    "/endpointId",
    "/ownerEpoch",
  ]);
  includesAll(signal[".write"], [
    "auth.uid === $targetUid",
    "data.exists()",
    "!newData.exists()",
    "auth.uid !== $targetUid",
    "!data.exists()",
    "newData.exists()",
    "newData.child('fromUid').val() === auth.uid",
    "newData.child('toUid').val() === $targetUid",
    "newData.child('toRunId').val() === $targetRunId",
    "online/trainingAttemptsV5/",
    "/state').val() === 'reserved'",
    "/state').val() === 'active'",
    "/roomAttemptId",
    "/transportEpoch",
    "/runId",
    "/endpointId",
    "/ownerEpoch",
  ]);
  assert.doesNotMatch(
    signal[".write"],
    /data\.child\('(roomAttemptId|transportEpoch)'\)/,
  );
  includesAll(signal[".validate"], [
    "'protocolVersion'",
    "'roomAttemptId'",
    "'transportEpoch'",
    "'fromUid'",
    "'toUid'",
    "'fromRunId'",
    "'toRunId'",
    "'fromEndpointId'",
    "'toEndpointId'",
    "'type'",
    "'payload'",
    "'createdAt'",
    "newData.child('protocolVersion').val() === 5",
    "newData.child('roomAttemptId').val()",
    "newData.child('transportEpoch').val()",
    "newData.child('type').val() === 'offer'",
    "newData.child('type').val() === 'answer'",
    "newData.child('type').val() === 'candidate'",
    "newData.child('payload').val().length <= 30000",
    "newData.child('createdAt').val() >= now - 60000",
    "newData.child('createdAt').val() <= now + 15000",
  ]);
  assert.equal(signal.protocolVersion[".validate"], "newData.val() === 5");
  assert.equal(signal.$other[".validate"], false);
});

test("the V3 HP gameplay and secret-score rules remain in place", () => {
  const round = room.rounds.$round;
  const receipt = round.imageReceived.$recipientUid;
  const score = round.scores.$scorerUid;

  includesAll(round[".write"], [
    "auth.uid === root.child('online/trainingRooms/' + $roomId + '/hostUid').val()",
    "root.child('online/trainingRooms/' + $roomId + '/protocolVersion').val() === 3",
    "$round === '1'",
    "$round === '5'",
  ]);
  includesAll(round.draws.$uid[".write"], [
    "auth.uid === $uid",
    "/status').val() === 'active'",
  ]);
  includesAll(receipt[".write"], [
    "auth.uid === $recipientUid",
    "(!data.exists() || data.val() === true)",
    "newData.val() === true",
    "/draws/",
  ]);
  includesAll(round.scores[".read"], [
    "/hostUid",
    "/guestUid",
    ".isNumber()",
  ]);
  includesAll(score[".read"], [
    "auth.uid === $scorerUid",
    "/hostUid",
    "/guestUid",
    ".isNumber()",
  ]);
  includesAll(score[".write"], [
    "auth.uid === $scorerUid",
    "/imageReceived/",
  ]);
  assert.equal(room.serverFinalized[".write"], false);
  assert.equal(room.$other[".validate"], false);
});
