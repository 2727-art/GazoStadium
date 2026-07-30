"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const training = require("../training-session-v2");
const rules = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "database.rules.json"), "utf8"),
).rules.online;

const NOW = 1_800_000_000_000;
const ROOM_ID = "-0123456789ABCDEFGH_";
const HOST_UID = "training-frame-host";
const GUEST_UID = "training-frame-guest";

function commandDeck(prefix) {
  return {
    1: {
      exercise: `${prefix} スクワット`,
      completion: "20回",
      command: "一定のテンポで続ける",
      beatsPerRep: 2,
    },
    2: {
      exercise: `${prefix} 腹筋`,
      completion: "15回",
      command: "呼吸を止めずに続ける",
      beatsPerRep: 4,
    },
    3: {
      exercise: `${prefix} 腕立て伏せ`,
      completion: "10回",
      command: "無理のないフォームで続ける",
      beatsPerRep: 8,
    },
  };
}

function imageBpms(offset = 0) {
  return {
    1: 0,
    2: 80 + offset,
    3: 100 + offset,
    4: 120 + offset,
    5: 140 + offset,
  };
}

function preparation(overrides = {}) {
  return {
    name: "PLAYER",
    intensity: "standard",
    commandDeck: commandDeck("PLAYER"),
    imageBpms: imageBpms(),
    ...overrides,
  };
}

function queueEntry(uid, offset = 0) {
  return {
    protocolVersion: training.TRAINING_SESSION_PROTOCOL_VERSION,
    uid,
    sessionId: `${uid}-session-token-123456`,
    leaseToken: `${uid}-lease-token-12345678`,
    generation: `${uid}-generation-token-1234`,
    connectionGeneration: `${uid}-connection-token-1234`,
    name: uid === HOST_UID ? "HOST" : "GUEST",
    intensity: "standard",
    commandDeck: commandDeck(uid),
    imageBpms: imageBpms(offset),
  };
}

test("training accepts only catalog chat-frame IDs and keeps the field optional", () => {
  assert.equal(Array.isArray(training.TRAINING_CHAT_FRAME_IDS), true);
  assert.equal(Object.isFrozen(training.TRAINING_CHAT_FRAME_IDS), true);
  assert.equal(training.TRAINING_CHAT_FRAME_IDS.length, 24);
  assert.equal(
    new Set(training.TRAINING_CHAT_FRAME_IDS).size,
    training.TRAINING_CHAT_FRAME_IDS.length,
  );
  for (const id of training.TRAINING_CHAT_FRAME_IDS) {
    assert.match(id, /^chat_frame_[a-z0-9_]+$/);
    assert.equal(training.normalizeTrainingChatFrameId(id), id);
  }
  assert.equal(training.normalizeTrainingChatFrameId(""), "");
  for (const invalid of [
    "chat_frame_not_purchased_product",
    "CHAT_FRAME_NEON",
    " chat_frame_neon ",
    null,
    1,
    {},
  ]) {
    assert.equal(training.normalizeTrainingChatFrameId(invalid), null);
  }

  const legacy = training.normalizeTrainingSessionPreparation(preparation());
  assert.ok(legacy);
  assert.equal(Object.hasOwn(legacy, "chatFrameId"), false);

  const selected = training.normalizeTrainingSessionPreparation(
    preparation({ chatFrameId: "chat_frame_neon" }),
  );
  assert.equal(selected.chatFrameId, "chat_frame_neon");
  assert.equal(
    training.normalizeTrainingSessionPreparation(
      preparation({ chatFrameId: "chat_frame_not_purchased_product" }),
    ),
    null,
  );
});

test("room chat-frame snapshots require exactly the two participants", () => {
  assert.deepEqual(
    training.normalizeTrainingChatFrames(
      {
        [HOST_UID]: "chat_frame_neon",
        [GUEST_UID]: "",
      },
      HOST_UID,
      GUEST_UID,
    ),
    {
      [HOST_UID]: "chat_frame_neon",
      [GUEST_UID]: "",
    },
  );
  for (const invalid of [
    { [HOST_UID]: "chat_frame_neon" },
    {
      [HOST_UID]: "chat_frame_neon",
      [GUEST_UID]: "",
      attacker: "",
    },
    {
      [HOST_UID]: "chat_frame_not_purchased_product",
      [GUEST_UID]: "",
    },
  ]) {
    assert.equal(
      training.normalizeTrainingChatFrames(invalid, HOST_UID, GUEST_UID),
      null,
    );
  }
});

test("chat-frame snapshots live only on the room root, not permits or players", () => {
  const host = queueEntry(HOST_UID);
  const guest = queueEntry(GUEST_UID, 1);
  const resources = training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: "training-frame-attempt-token",
    connectionGeneration: "training-frame-connection-token",
    host,
    guest,
    chatFrames: {
      [HOST_UID]: "chat_frame_neon",
      [GUEST_UID]: "",
    },
    now: NOW,
  });

  assert.deepEqual(resources.room.chatFrames, {
    [HOST_UID]: "chat_frame_neon",
    [GUEST_UID]: "",
  });
  assert.equal(Object.hasOwn(resources.permit, "chatFrames"), false);
  assert.equal(Object.hasOwn(resources.room.players[HOST_UID], "chatFrameId"), false);
  assert.equal(Object.hasOwn(resources.room.players[GUEST_UID], "chatFrameId"), false);
});

test("RTDB Rules make the V5 room chat-frame snapshot member-readable and server-only", () => {
  const room = rules.trainingRooms.$roomId;
  const chatFrames = room.chatFrames;
  assert.ok(chatFrames);
  assert.equal(room[".write"], false);
  assert.equal(chatFrames[".write"], false);
  assert.match(chatFrames[".read"], /members/);
  assert.match(chatFrames[".read"], /trainingAttemptsV5/);
  assert.match(chatFrames[".validate"], /sessionProtocolVersion/);
  assert.match(chatFrames[".validate"], /=== 5/);
  assert.match(chatFrames[".validate"], /hostUid/);
  assert.match(chatFrames[".validate"], /guestUid/);
  assert.match(chatFrames[".validate"], /hasChildren/);

  const frame = chatFrames.$uid;
  assert.match(frame[".validate"], /\$uid/);
  assert.match(frame[".validate"], /hostUid/);
  assert.match(frame[".validate"], /guestUid/);
  assert.match(frame[".validate"], /newData\.val\(\) === ''/);
  assert.match(frame[".validate"], /chat_frame_/);

  assert.equal(
    Object.hasOwn(room.players.$uid, "chatFrameId"),
    false,
  );
});
