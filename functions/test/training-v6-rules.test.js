"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");
const rules = JSON.parse(
  readFileSync(join(repositoryRoot, "database.rules.json"), "utf8"),
).rules;
const serverSource = readFileSync(
  join(repositoryRoot, "functions", "training-session-v6.js"),
  "utf8",
);
const clientSource = readFileSync(
  join(repositoryRoot, "training-v6-app.js"),
  "utf8",
);
const trainingV6 = rules.online.trainingV6;
const trainingV6State = trainingV6.state;
const room = trainingV6State.rooms.$roomId;
const signal = trainingV6.signals.$roomId.$recipientUid.$senderUid.$signalId;
const presence = trainingV6.presence.$roomId.$uid;

function includesAll(value, fragments) {
  assert.equal(typeof value, "string");
  for (const fragment of fragments) {
    assert.ok(
      value.includes(fragment),
      `expected rule to include ${JSON.stringify(fragment)}`,
    );
  }
}

function excludesAll(value, fragments) {
  assert.equal(typeof value, "string");
  for (const fragment of fragments) {
    assert.ok(
      !value.includes(fragment),
      `expected rule not to include ${JSON.stringify(fragment)}`,
    );
  }
}

function assertNoClientWriteGrant(value, path = "") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}/${key}` : key;
    if (key === ".write") {
      assert.equal(child, false, `${childPath} must remain server-only`);
    } else {
      assertNoClientWriteGrant(child, childPath);
    }
  }
}

test("trainingV6 is closed by default and tickets are server-owned owner mailboxes", () => {
  assert.equal(trainingV6[".read"], false);
  assert.equal(trainingV6[".write"], false);
  assert.equal(trainingV6.$other[".read"], false);
  assert.equal(trainingV6.$other[".write"], false);

  assert.equal(trainingV6State[".read"], false);
  assert.equal(trainingV6State[".write"], false);
  const tickets = trainingV6State.tickets;
  assert.equal(tickets[".read"], false);
  assert.equal(tickets[".write"], false);
  assert.deepEqual(tickets[".indexOn"], ["state", "updatedAt"]);
  assert.equal(
    tickets.$uid[".read"],
    "auth != null && auth.uid === $uid",
  );
  assert.equal(tickets.$uid[".write"], false);
  includesAll(tickets.$uid[".validate"], [
    "'protocolVersion', 'ticketId', 'state', 'updatedAt'",
    "newData.child('protocolVersion').val() === 6",
    "newData.child('state').val() === 'waiting'",
    "newData.child('state').val() === 'matched'",
    "newData.child('state').val() === 'terminal'",
    "newData.child('state').val() !== 'matched'",
    "newData.child('roomId').isString()",
  ]);
  assert.equal(tickets.$uid.$other[".validate"], false);
});

test("server-internal V6 coordination and secret-score branches are closed", () => {
  for (const path of [
    "queue",
    "memberships",
    "operations",
    "receipts",
    "transportReceipts",
    "privateScores",
    "finalizationOutbox",
  ]) {
    assert.ok(trainingV6State[path], `missing explicit internal branch ${path}`);
    assert.equal(trainingV6State[path][".read"], false);
    assert.equal(trainingV6State[path][".write"], false);
  }
});

test("canonical V6 rooms are server-only and fixed members retain read access without a ticket", () => {
  assert.equal(trainingV6State.rooms[".read"], false);
  assert.equal(trainingV6State.rooms[".write"], false);
  assert.equal(room[".write"], false);
  includesAll(room[".read"], [
    "auth != null",
    "data.child('members/' + auth.uid).val() === true",
  ]);
  excludesAll(room[".read"], [
    "tickets",
    "ticketId",
    "lease",
    "expiresAt",
  ]);

  includesAll(room[".validate"], [
    "'protocolVersion', 'variant', 'roomId', 'phase', 'revision', 'transportRevision', 'createdAt', 'updatedAt', 'expiresAt', 'members', 'memberOrder', 'participantUids', 'players', 'roundNumber', 'rounds', 'activeWorkoutIndex'",
    "newData.child('protocolVersion').val() === 6",
    "newData.child('variant').val() === 'companion_v6'",
    "newData.child('roomId').val() === $roomId",
    "newData.child('memberOrder/0').isString()",
    "newData.child('memberOrder/1').isString()",
    "newData.child('memberOrder/0').val() !== newData.child('memberOrder/1').val()",
    "newData.child('participantUids/0').val() === newData.child('memberOrder/0').val()",
    "newData.child('participantUids/1').val() === newData.child('memberOrder/1').val()",
    "newData.child('members/' + newData.child('memberOrder/0').val()).val() === true",
    "newData.child('members/' + newData.child('memberOrder/1').val()).val() === true",
    "newData.child('players/' + newData.child('memberOrder/0').val() + '/uid')",
    "newData.child('players/' + newData.child('memberOrder/1').val() + '/uid')",
    "newData.child('transportRevision').val() >= 0",
    "newData.child('expiresAt').val() > newData.child('createdAt').val()",
  ]);
  assert.equal(room.protocolVersion[".validate"], "newData.val() === 6");
  assert.equal(room.variant[".validate"], "newData.val() === 'companion_v6'");
  assert.equal(room.members[".write"], false);
  includesAll(room.members.$uid[".validate"], [
    "memberOrder/0",
    "memberOrder/1",
    "newData.val() === true",
  ]);
  assert.equal(room.memberOrder[".write"], false);
  assert.equal(room.memberOrder.$other[".validate"], false);
  assert.equal(room.participantUids[".write"], false);
  assert.equal(room.participantUids.$other[".validate"], false);
  assert.equal(room.players[".write"], false);
  assert.equal(room.players.$uid.$other[".validate"], false);
  assert.equal(room.players.$uid.profile.$other[".validate"], false);
  assert.equal(room.$other[".validate"], false);
});

test("phase revision and all canonical workout state are client-write denied", () => {
  const serverCanonicalFields = [
    "protocolVersion",
    "variant",
    "roomId",
    "members",
    "memberOrder",
    "participantUids",
    "players",
    "phase",
    "revision",
    "transportRevision",
    "createdAt",
    "updatedAt",
    "expiresAt",
    "transportUpdatedAt",
    "roundNumber",
    "rounds",
    "workoutQueue",
    "activeWorkoutIndex",
    "instruction",
    "workout",
    "result",
    "connections",
    "finishedBy",
  ];
  for (const field of serverCanonicalFields) {
    assert.equal(
      room[field][".write"],
      false,
      `rooms/$roomId/${field} must be server-only`,
    );
  }

  for (const phase of [
    "media_exchange",
    "scoring",
    "instruction",
    "ready",
    "workout",
    "complete",
    "no_contest",
  ]) {
    assert.ok(
      room.phase[".validate"].includes(`newData.val() === '${phase}'`),
      `phase ${phase} must be part of the V6 contract`,
    );
  }
  includesAll(room.revision[".validate"], [
    "newData.isNumber()",
    "newData.val() % 1 === 0",
    "newData.val() >= 1",
  ]);
  assertNoClientWriteGrant(room, "rooms/$roomId");
});

test("room Rules allow exactly the current public server room fields", () => {
  const ruleKeys = new Set([".read", ".write", ".validate", "$other"]);
  const fields = Object.keys(room)
    .filter((key) => !ruleKeys.has(key))
    .sort();
  assert.deepEqual(fields, [
    "activeWorkoutIndex",
    "connections",
    "createdAt",
    "expiresAt",
    "finishedBy",
    "instruction",
    "memberOrder",
    "members",
    "participantUids",
    "phase",
    "players",
    "protocolVersion",
    "result",
    "revision",
    "roomId",
    "roundNumber",
    "rounds",
    "transportRevision",
    "transportUpdatedAt",
    "updatedAt",
    "variant",
    "workout",
    "workoutQueue",
  ]);
  for (const field of [
    "roomId",
    "transportRevision",
    "createdAt",
    "updatedAt",
    "expiresAt",
    "participantUids",
    "players",
    "roundNumber",
    "rounds",
    "workoutQueue",
    "activeWorkoutIndex",
    "connections",
    "finishedBy",
  ]) {
    assert.ok(
      serverSource.includes(`${field}:`)
        || serverSource.includes(`next.${field}`),
      `server room contract no longer exposes ${field}`,
    );
  }
  assert.equal(Object.hasOwn(room, "state"), false);
  assert.equal(Object.hasOwn(room, "actions"), false);
  assert.equal(Object.hasOwn(room, "results"), false);
  assert.equal(room.rounds.$round.$other[".validate"], false);
  assert.equal(room.workoutQueue.$index.$other[".validate"], false);
  assert.equal(room.instruction.$other[".validate"], false);
  assert.equal(room.workout.$other[".validate"], false);
  assert.equal(room.result.$other[".validate"], false);
  assert.equal(room.connections.$uid.$other[".validate"], false);
});

test("server expiry has an explicit terminal result contract", () => {
  includesAll(room.result[".validate"], [
    "newData.child('reason').val() === 'session_expired'",
    "newData.child('requestedBy').val() === 'system'",
  ]);
  includesAll(room.result.reason[".validate"], [
    "newData.val() === 'session_expired'",
  ]);
  includesAll(room.result.requestedBy[".validate"], [
    "newData.parent().child('reason').val() === 'session_expired'",
    "newData.val() === 'system'",
  ]);
});

test("V6 signaling uses recipient-only mailboxes and sender-owned create branches", () => {
  const signals = trainingV6.signals;
  const roomSignals = signals.$roomId;
  const recipientMailbox = roomSignals.$recipientUid;
  const senderBranch = recipientMailbox.$senderUid;

  assert.equal(signals[".read"], false);
  assert.equal(signals[".write"], false);
  assert.equal(roomSignals[".read"], false);
  assert.equal(roomSignals[".write"], false);
  assert.equal(recipientMailbox[".write"], false);
  includesAll(recipientMailbox[".read"], [
    "auth.uid === $recipientUid",
    "online/trainingV6/state/rooms/",
    "/members/' + auth.uid",
  ]);
  excludesAll(recipientMailbox[".read"], ["tickets", "lease"]);
  assert.equal(senderBranch[".read"], false);
  assert.equal(senderBranch[".write"], false);

  includesAll(signal[".write"], [
    "$signalId.matches(",
    "/members/' + $senderUid",
    "/members/' + $recipientUid",
    "auth.uid === $senderUid",
    "$senderUid !== $recipientUid",
    "!data.exists()",
    "newData.exists()",
    "/phase').val() !== 'complete'",
    "/phase').val() !== 'no_contest'",
    "/expiresAt').val() > now",
    "auth.uid === $recipientUid",
    "data.exists()",
    "!newData.exists()",
  ]);
  excludesAll(signal[".write"], ["tickets", "lease"]);
});

test("V6 signaling accepts only strict WebRTC SDP and ICE envelopes", () => {
  includesAll(signal[".validate"], [
    "'protocolVersion', 'fromConnectionId', 'toConnectionId', 'fromUid', 'toUid', 'type', 'createdAt'",
    "newData.child('protocolVersion').val() === 6",
    "newData.child('fromConnectionId').isString()",
    "newData.child('toConnectionId').isString()",
    "/connections/' + $senderUid + '/connectionId",
    "/connections/' + $recipientUid + '/connectionId",
    "newData.child('fromUid').val() === $senderUid",
    "newData.child('toUid').val() === $recipientUid",
    "newData.child('type').val() === 'offer'",
    "newData.child('type').val() === 'answer'",
    "newData.child('type').val() === 'candidate'",
    "newData.hasChildren(['sdp'])",
    "!newData.child('candidate').exists()",
    "newData.hasChildren(['candidate', 'sdpMid', 'sdpMLineIndex'])",
    "!newData.child('sdp').exists()",
    "newData.child('createdAt').val() >= now - 60000",
    "newData.child('createdAt').val() <= now + 15000",
  ]);
  assert.equal(signal.protocolVersion[".validate"], "newData.val() === 6");
  assert.match(signal.fromConnectionId[".validate"], /\{16,128\}/);
  assert.match(signal.toConnectionId[".validate"], /\{16,128\}/);
  assert.equal(Object.hasOwn(signal, "connectionId"), false);
  includesAll(clientSource, [
    "fromConnectionId: signal.fromConnectionId",
    "toConnectionId: signal.toConnectionId",
  ]);
  includesAll(signal.sdp[".validate"], [
    "type').val() === 'offer'",
    "type').val() === 'answer'",
    "newData.val().length <= 120000",
  ]);
  includesAll(signal.candidate[".validate"], [
    "type').val() === 'candidate'",
    "newData.val().length <= 4096",
    "!newData.val().contains('\\r')",
    "!newData.val().contains('\\n')",
  ]);
  includesAll(signal.sdpMLineIndex[".validate"], [
    "newData.val() % 1 === 0",
    "newData.val() >= 0",
    "newData.val() <= 255",
  ]);
  assert.equal(signal.$other[".validate"], false);

  for (const forbiddenField of [
    "payload",
    "text",
    "message",
    "image",
    "imageData",
    "blob",
    "base64",
  ]) {
    assert.equal(
      Object.hasOwn(signal, forbiddenField),
      false,
      `${forbiddenField} must not be stored in RTDB signaling`,
    );
  }
});

test("presence is member-readable and self-writable without ticket state", () => {
  const roomPresence = trainingV6.presence.$roomId;

  assert.equal(trainingV6.presence[".read"], false);
  assert.equal(trainingV6.presence[".write"], false);
  assert.equal(roomPresence[".write"], false);
  includesAll(roomPresence[".read"], [
    "auth != null",
    "online/trainingV6/state/rooms/",
    "/members/' + auth.uid",
  ]);
  excludesAll(roomPresence[".read"], ["tickets", "lease", "expiresAt"]);

  includesAll(presence[".write"], [
    "auth != null",
    "auth.uid === $uid",
    "!newData.exists()",
    "online/trainingV6/state/rooms/",
    "/members/' + auth.uid",
    "/phase').val() !== 'complete'",
    "/phase').val() !== 'no_contest'",
    "/expiresAt').val() > now",
  ]);
  excludesAll(presence[".write"], ["tickets", "lease"]);
  includesAll(presence[".validate"], [
    "'protocolVersion', 'connectionId', 'online', 'updatedAt'",
    "newData.child('protocolVersion').val() === 6",
    "newData.child('online').isBoolean()",
    "newData.child('updatedAt').val() >= now - 60000",
    "newData.child('updatedAt').val() <= now + 15000",
  ]);
  assert.equal(presence.protocolVersion[".validate"], "newData.val() === 6");
  assert.match(presence.connectionId[".validate"], /\{16,128\}/);
  assert.equal(presence.online[".validate"], "newData.isBoolean()");
  assert.equal(presence.$other[".validate"], false);
});
