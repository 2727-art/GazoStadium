"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");
const source = readFileSync(
  join(repositoryRoot, "database.rules.json"),
  "utf8",
);
const online = JSON.parse(source).rules.online;

function includesAll(value, fragments) {
  assert.equal(typeof value, "string");
  for (const fragment of fragments) {
    assert.ok(
      value.includes(fragment),
      `expected rule to include ${JSON.stringify(fragment)}`,
    );
  }
}

test("training session matchmaking authority is private and expiry-indexed", () => {
  assert.deepEqual(online.trainingSessionClaims[".indexOn"], ["expiresAt"]);
  assert.equal(online.trainingSessionClaims.$uid[".read"], false);
  assert.equal(online.trainingSessionClaims.$uid[".write"], false);

  assert.equal(online.trainingSessionActionRates[".read"], false);
  assert.equal(online.trainingSessionActionRates[".write"], false);

  for (const path of [
    "trainingMatchPermitsV4",
    "trainingMatchLocksV4",
  ]) {
    assert.equal(online[path][".read"], false);
    assert.equal(online[path][".write"], false);
    assert.deepEqual(online[path][".indexOn"], ["expiresAt"]);
  }
});

test("trainingQueueV4 is private and entirely server-owned", () => {
  const queue = online.trainingQueueV4.$uid.$sessionId;

  assert.equal(online.trainingQueueV4[".read"], false);
  assert.equal(online.trainingQueueV4[".write"], false);
  assert.equal(queue[".read"], false);
  assert.equal(queue[".write"], false);

  includesAll(queue[".validate"], [
    "'protocolVersion'",
    "'trainingProtocolVersion'",
    "'commandDeck'",
    "'imageBpms'",
    "newData.child('protocolVersion').val() === 2",
    "newData.child('trainingProtocolVersion').val() === 3",
    "newData.child('variant').val() === 'kitaeai_hp_v3'",
    "newData.child('uid').val() === $uid",
    "newData.child('sessionId').val() === $sessionId",
    "newData.child('lastSeen').val() >= now - 60000",
    "newData.child('expiresAt').val() <= now + 210000",
  ]);
  assert.equal(queue.protocolVersion[".validate"], "newData.val() === 2");
  assert.equal(
    queue.trainingProtocolVersion[".validate"],
    "newData.val() === 3",
  );
  assert.equal(
    queue.variant[".validate"],
    "newData.val() === 'kitaeai_hp_v3'",
  );
  assert.match(queue.sessionId[".validate"], /\{16,128\}/);
  assert.match(queue.leaseToken[".validate"], /\{16,128\}/);
  assert.match(queue.generation[".validate"], /\{22\}/);
  assert.match(queue.connectionGeneration[".validate"], /\{8,128\}/);
  assert.equal(queue.state[".validate"], "newData.val() === 'waiting'");
  assert.equal(queue.$other[".validate"], false);

  assert.match(queue.commandDeck[".validate"], /'1', '2', '3'/);
  assert.match(queue.commandDeck.$card[".validate"], /\$card === '1'/);
  assert.match(queue.commandDeck.$card[".validate"], /\$card === '3'/);
  assert.match(queue.commandDeck.$card.beatsPerRep[".validate"], /=== 8/);
  assert.equal(queue.commandDeck.$card.$other[".validate"], false);
  assert.match(queue.imageBpms[".validate"], /'1', '2', '3', '4', '5'/);
  assert.match(queue.imageBpms.$image[".validate"], /newData\.val\(\) === 0/);
  assert.match(queue.imageBpms.$image[".validate"], /newData\.val\(\) >= 40/);
  assert.match(queue.imageBpms.$image[".validate"], /newData\.val\(\) <= 160/);

  assert.equal(Object.hasOwn(queue, "conditions"), false);
  assert.equal(Object.hasOwn(queue, "roomId"), false);
  assert.equal(Object.hasOwn(queue, "attemptId"), false);
  assert.doesNotMatch(JSON.stringify(queue), /conditions/);
});

test("trainingActiveV4 and trainingOffersV4 are server-owned", () => {
  const active = online.trainingActiveV4.$uid.$sessionId;
  assert.equal(online.trainingActiveV4.$uid[".read"], false);
  assert.equal(active[".write"], false);
  assert.equal(active[".validate"], "!newData.exists()");

  assert.equal(online.trainingOffersV4[".write"], false);
  includesAll(
    online.trainingOffersV4.$targetUid.$targetSessionId[".read"],
    [
      "auth.uid === $targetUid",
      "trainingSessionClaims/",
      "/protocolVersion').val() === 2",
      "/sessionId').val() === $targetSessionId",
      "/expiresAt').val() > now",
    ],
  );
});

test("fresh session claims fence every legacy matchmaking entry point", () => {
  for (const expression of [
    online.trainingQueue.$uid[".write"],
    online.trainingActive.$uid[".write"],
    online.trainingActive.$uid.roomId[".write"],
    online.trainingActive.$uid.rooms.$roomId[".write"],
    online.trainingMatchLock[".write"],
    online.trainingInvites.$targetUid.$roomId[".write"],
  ]) {
    includesAll(expression, [
      "trainingSessionClaims/",
      "/protocolVersion').val() === 2",
      "/expiresAt').isNumber()",
      "/expiresAt').val() > now",
    ]);
  }

  const room = online.trainingRooms.$roomId;
  for (const identity of [
    room.hostUid[".validate"],
    room.guestUid[".validate"],
  ]) {
    includesAll(identity, [
      "data.exists()",
      "trainingSessionClaims/",
      "/protocolVersion').val() === 2",
      "/expiresAt').val() > now",
    ]);
  }
});

test("session-enabled training rooms are backend-created and claim-fenced", () => {
  const room = online.trainingRooms.$roomId;

  assert.equal(room[".read"], false);
  includesAll(room[".write"], [
    "!data.exists()",
    "!newData.child('sessionProtocolVersion').exists()",
    "!newData.child('signalingVersion').exists()",
    "!newData.child('attemptId').exists()",
    "!newData.child('connectionGeneration').exists()",
    "!newData.child('sessions').exists()",
  ]);
  includesAll(room[".validate"], [
    "newData.child('protocolVersion').val() === 3",
    "newData.child('variant').val() === 'kitaeai_hp_v3'",
    "newData.child('sessionProtocolVersion').val() === 2",
    "newData.child('signalingVersion').val() === 2",
    "newData.child('attemptId').isString()",
    "newData.child('connectionGeneration')",
    "newData.child('expiresAt').isNumber()",
    "newData.child('expiresAt').val() > newData.child('createdAt').val()",
    "newData.child('status').val() === 'offered'",
    "newData.child('status').val() === 'active'",
    "newData.child('status').val() === 'cancelled'",
    "newData.child('sessions/' + newData.child('hostUid').val() + '/sessionId')",
    "newData.child('sessions/' + newData.child('guestUid').val() + '/sessionId')",
    "newData.child('members/' + auth.uid).val() === true",
    "trainingSessionClaims/",
    "/sessionId').val() === newData.child('sessions/' + auth.uid + '/sessionId').val()",
    "/generation').val() === newData.child('sessions/' + auth.uid + '/generation').val()",
    "/expiresAt').val() > now",
  ]);

  for (const field of [
    "sessionProtocolVersion",
    "signalingVersion",
    "attemptId",
    "connectionGeneration",
    "sessions",
  ]) {
    assert.equal(room[field][".write"], false, field);
    assert.match(room[field][".read"], /members/);
  }
  assert.equal(
    room.sessionProtocolVersion[".validate"],
    "newData.parent().child('protocolVersion').val() === 3 && newData.val() === 2",
  );
  assert.equal(
    room.signalingVersion[".validate"],
    "newData.parent().child('sessionProtocolVersion').val() === 2 && newData.val() === 2",
  );
  assert.match(room.sessions.$uid.sessionId[".validate"], /\{16,128\}/);
  assert.match(room.sessions.$uid.generation[".validate"], /\{22\}/);
  assert.equal(room.sessions.$uid.$other[".validate"], false);

  assert.equal(room.expiresAt[".write"], false);
  assert.match(room.expiresAt[".read"], /members/);
  includesAll(room.expiresAt[".validate"], [
    "sessionProtocolVersion",
    "newData.isNumber()",
    "createdAt",
  ]);
  assert.equal(room.activatedAt[".write"], false);
  assert.match(room.activatedAt[".read"], /members/);
  includesAll(room.activatedAt[".validate"], [
    "sessionProtocolVersion",
    "newData.isNumber()",
    "createdAt",
  ]);
  assert.equal(room.matchTransition[".read"], false);
  assert.equal(room.matchTransition[".write"], false);
  includesAll(room.matchTransition[".validate"], [
    "sessionProtocolVersion",
    "'action', 'token', 'startedAt'",
  ]);
  includesAll(room.matchTransition.action[".validate"], [
    "'accept'",
    "'cancel'",
    "'expire'",
  ]);
  assert.match(room.matchTransition.token[".validate"], /\{8,128\}/);
  assert.equal(room.matchTransition.$other[".validate"], false);
  includesAll(room.status[".validate"], [
    "'forming'",
    "'active'",
    "'expired'",
    "sessionProtocolVersion",
    "'offered'",
    "'cancelled'",
  ]);

  for (const expression of [
    room.status[".write"],
    room.accepted.$uid[".write"],
    room.players.$uid.conditions[".write"],
  ]) {
    includesAll(expression, [
      "/sessionProtocolVersion",
      ".exists()",
    ]);
    assert.match(expression, /!root\.child/);
  }
});

test("session room players stay valid without the deleted legacy queue", () => {
  const player = online.trainingRooms.$roomId.players.$uid;

  includesAll(player[".validate"], [
    "sessionProtocolVersion",
    ".val() === 2",
    "data.exists()",
    "newData.child('uid').val() === data.child('uid').val()",
    "newData.child('name').val() === data.child('name').val()",
    "newData.child('intensity').val() === data.child('intensity').val()",
    "newData.child('conditions').val() === data.child('conditions').val()",
    "newData.child('commandDeck').val() === data.child('commandDeck').val()",
    "newData.child('imageBpms').val() === data.child('imageBpms').val()",
    "sessionProtocolVersion').val() !== 2",
    "online/trainingQueue/",
  ]);
  includesAll(player.name[".validate"], [
    "newData.val().length <= 16",
    "sessionProtocolVersion",
    "data.exists() && newData.val() === data.val()",
  ]);
  includesAll(player.commandDeck[".validate"], [
    "'1', '2', '3'",
    "sessionProtocolVersion",
    "data.exists() && newData.val() === data.val()",
  ]);
  for (const field of ["exercise", "completion", "command", "beatsPerRep"]) {
    includesAll(player.commandDeck.$card[field][".validate"], [
      "sessionProtocolVersion",
      ".val() === 2",
      "data.exists() && newData.val() === data.val()",
      ".val() !== 2",
      "online/trainingQueue/",
    ]);
  }
  includesAll(player.imageBpms[".validate"], [
    "'1', '2', '3', '4', '5'",
    "sessionProtocolVersion",
    "data.exists() && newData.val() === data.val()",
  ]);
  includesAll(player.imageBpms.$image[".validate"], [
    "newData.val() >= 40",
    "newData.val() <= 160",
    "sessionProtocolVersion",
    ".val() === 2",
    "data.exists() && newData.val() === data.val()",
    ".val() !== 2",
    "online/trainingQueue/",
  ]);
});

test("legacy presence and signaling are unavailable in session rooms", () => {
  const room = online.trainingRooms.$roomId;
  includesAll(room.presence[".read"], [
    "/sessionProtocolVersion",
    ".exists()",
    "/members/",
  ]);
  includesAll(room.presence.$uid[".write"], [
    "/sessionProtocolVersion",
    ".exists()",
    "auth.uid === $uid",
  ]);
  includesAll(room.signals.$targetUid[".read"], [
    "/sessionProtocolVersion",
    ".exists()",
    "auth.uid === $targetUid",
  ]);
  includesAll(room.signals.$targetUid.$signalId[".write"], [
    "/sessionProtocolVersion",
    ".exists()",
    "auth.uid !== $targetUid",
    "auth.uid === $targetUid",
  ]);
});

test("presenceV2 binds lease, generation, and exact room session", () => {
  const room = online.trainingRooms.$roomId;
  const presence = room.presenceV2.$uid.$sessionId;

  includesAll(room.presenceV2[".read"], [
    "/protocolVersion').val() === 3",
    "/sessionProtocolVersion').val() === 2",
    "/signalingVersion').val() === 2",
    "/members/",
  ]);
  includesAll(presence[".write"], [
    "auth.uid === $uid",
    "/protocolVersion').val() === 3",
    "/sessionProtocolVersion').val() === 2",
    "/signalingVersion').val() === 2",
    "/sessions/' + $uid + '/sessionId').val() === $sessionId",
    "!newData.exists()",
    "data.child('sessionId').val() === $sessionId",
    "trainingSessionClaims/",
    "/leaseToken').val() === newData.child('leaseToken').val()",
    "/generation').val() === newData.child('generation').val()",
    "/generation').val() === root.child('online/trainingRooms/",
    "/expiresAt').val() > now",
  ]);
  includesAll(presence[".validate"], [
    "'protocolVersion'",
    "'sessionId'",
    "'leaseToken'",
    "'generation'",
    "'online'",
    "'updatedAt'",
    "newData.child('protocolVersion').val() === 2",
    "newData.child('sessionId').val() === $sessionId",
    "newData.child('updatedAt').val() >= now - 60000",
    "newData.child('updatedAt').val() <= now + 15000",
  ]);
  assert.match(presence.sessionId[".validate"], /\{16,128\}/);
  assert.match(presence.leaseToken[".validate"], /\{16,128\}/);
  assert.match(presence.generation[".validate"], /\{22\}/);
  assert.equal(presence.$other[".validate"], false);
});

test("signalsV2 are exact-session, attempt, and generation scoped", () => {
  const room = online.trainingRooms.$roomId;
  const target = room.signalsV2.$targetUid.$targetSessionId;
  const signal = target.$signalId;

  includesAll(target[".read"], [
    "auth.uid === $targetUid",
    "/protocolVersion').val() === 3",
    "/sessionProtocolVersion').val() === 2",
    "/signalingVersion').val() === 2",
    "/sessions/' + $targetUid + '/sessionId').val() === $targetSessionId",
    "trainingSessionClaims/",
    "/sessionId').val() === $targetSessionId",
    "/generation').val() === root.child('online/trainingRooms/",
    "/expiresAt').val() > now",
  ]);
  includesAll(signal[".write"], [
    "auth.uid === $targetUid",
    "data.exists()",
    "!newData.exists()",
    "data.child('toUid').val() === $targetUid",
    "data.child('toSessionId').val() === $targetSessionId",
    "data.child('connectionGeneration').val() === root.child('online/trainingRooms/",
    "data.child('attemptId').val() === root.child('online/trainingRooms/",
    "auth.uid !== $targetUid",
    "!data.exists()",
    "newData.exists()",
    "newData.child('fromUid').val() === auth.uid",
    "newData.child('toUid').val() === $targetUid",
    "newData.child('fromSessionId').val() === root.child('online/trainingRooms/",
    "newData.child('toSessionId').val() === $targetSessionId",
    "trainingSessionClaims/",
    "/connectionGeneration",
    "/attemptId",
    "/status').val() === 'forming'",
    "/status').val() === 'active'",
    "/destroyed",
  ]);
  includesAll(signal[".validate"], [
    "'protocolVersion'",
    "'signalingVersion'",
    "'fromUid'",
    "'fromSessionId'",
    "'toUid'",
    "'toSessionId'",
    "'connectionGeneration'",
    "'attemptId'",
    "'type'",
    "'payload'",
    "'createdAt'",
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
});

test("session commonization preserves V3 gameplay and secret scores", () => {
  const room = online.trainingRooms.$roomId;
  const round = room.rounds.$round;
  const score = round.scores.$scorerUid;

  assert.equal(room.protocolVersion[".validate"].includes("=== 3"), true);
  assert.equal(
    room.variant[".validate"].includes(
      "newData.parent().child('protocolVersion').val() === 3 && newData.val() === 'kitaeai_hp_v3'",
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify({
      queue: online.trainingQueueV4,
      roomSessionVersion: room.sessionProtocolVersion,
      roomSignalingVersion: room.signalingVersion,
    }),
    /kitaeai_hp_v4/,
  );
  assert.equal(
    online.trainingQueueV4.$uid.$sessionId.trainingProtocolVersion[
      ".validate"
    ],
    "newData.val() === 3",
  );

  assert.equal(round[".read"], undefined);
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
  assert.equal(room.serverFinalized[".write"], false);
  assert.equal(room.$other[".validate"], false);
});
