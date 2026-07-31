"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const sessionUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "training-v6-session.mjs"),
).href;
let session;

test.before(async () => {
  session = await import(sessionUrl);
});

function snapshot({ phase = "scoring", revision = 4 } = {}) {
  return {
    protocolVersion: 6,
    variant: "companion_v6",
    roomId: "room-12345678",
    members: {
      "player-alpha": true,
      "player-bravo": true,
    },
    memberOrder: {
      0: "player-alpha",
      1: "player-bravo",
    },
    phase,
    revision,
    roundNumber: 1,
    rounds: {},
    workoutQueue: [],
    activeWorkoutIndex: null,
    instruction: null,
    workout: null,
    result: null,
  };
}

test("handshake carries protocol, action identity, and an initial revision fence", () => {
  const request = session.createTrainingV6HandshakeRequest({
    actionId: "action-12345678",
  });

  assert.equal(request.protocolVersion, 6);
  assert.equal(request.variant, "companion_v6");
  assert.equal(request.clientVersion, "training-v6-mvp-1");
  assert.equal(request.action, "handshake");
  assert.equal(request.actionId, "action-12345678");
  assert.equal(request.expectedRevision, 0);
  assert.equal(request.roomId, null);
  assert.deepEqual(request.payload, {
    supportedProtocolVersions: [6],
    requestedVariant: "companion_v6",
  });
  assert.equal(session.validateTrainingV6ApiRequest(request), true);
});

test("room actions are fenced by the exact server snapshot revision", () => {
  const request = session.createTrainingV6SnapshotActionRequest({
    action: "submit_score",
    actionId: "action-23456789",
    snapshot: snapshot({ revision: 17 }),
    payload: { score: 9 },
  });

  assert.equal(request.expectedRevision, 17);
  assert.equal(request.roomId, "room-12345678");
  assert.deepEqual(request.payload, { score: 9 });
  assert.equal(session.validateTrainingV6ApiRequest(request), true);
});

test("adapter injects a fresh actionId and accepts a returned canonical snapshot", async () => {
  const requests = [];
  let counter = 0;
  const adapter = session.createTrainingV6SessionAdapter({
    createActionId: () => `action-${String(++counter).padStart(8, "0")}`,
    transport: async (request) => {
      requests.push(request);
      if (request.action === "handshake") {
        return {
          data: {
            protocolVersion: 6,
            variant: "companion_v6",
          },
        };
      }
      return {
        data: {
          snapshot: snapshot({ phase: "instruction", revision: 5 }),
        },
      };
    },
  });

  const handshake = await adapter.handshake();
  assert.equal(handshake.handshake.compatible, true);
  assert.equal(handshake.request.actionId, "action-00000001");

  const action = await adapter.action({
    action: "submit_score",
    snapshot: snapshot(),
    payload: { score: 8 },
  });
  assert.equal(action.request.actionId, "action-00000002");
  assert.equal(action.request.expectedRevision, 4);
  assert.equal(action.snapshot.phase, "instruction");
  assert.equal(action.snapshot.revision, 5);
  assert.equal(requests.length, 2);
});

test("generic request supports handshake-independent join and inspect operations", async () => {
  const requests = [];
  let counter = 20;
  const adapter = session.createTrainingV6SessionAdapter({
    createActionId: () => `action-${String(++counter).padStart(8, "0")}`,
    transport: async (request) => {
      requests.push(request);
      return request.action === "join"
        ? { data: { outcome: "waiting" } }
        : {
            data: {
              room: {
                ...snapshot({ revision: 9 }),
                players: {},
                connections: {},
                transportRevision: 2,
              },
            },
          };
    },
  });

  const joined = await adapter.request("join", {
    payload: {
      profile: {
        displayName: "PLAYER",
        maxBpm: 120,
        allowedExercises: ["squat"],
        conditionText: "",
      },
    },
  });
  assert.equal(joined.request.actionId, "action-00000021");
  assert.equal(joined.request.roomId, null);
  assert.equal(joined.request.expectedRevision, 0);
  assert.equal(joined.snapshot, null);

  const inspected = await adapter.request("inspect", {
    roomId: "room-12345678",
    expectedRevision: 8,
  });
  assert.equal(inspected.request.actionId, "action-00000022");
  assert.equal(inspected.request.expectedRevision, 8);
  assert.equal(inspected.snapshot.revision, 9);
  assert.equal(Object.hasOwn(inspected.snapshot, "players"), false);
  assert.equal(requests.length, 2);
});

test("protocol disagreement becomes an explicit update-required result", () => {
  assert.deepEqual(session.interpretTrainingV6Handshake({
    data: {
      protocolVersion: 5,
      variant: "kitaeai_hp_v3",
    },
  }), {
    compatible: false,
    reason: "update-required",
    protocolVersion: 5,
    variant: "kitaeai_hp_v3",
  });
});

test("adapter rejects missing revision fences and non-JSON payloads", () => {
  assert.throws(
    () => session.createTrainingV6ApiRequest({
      action: "submit_score",
      actionId: "action-34567890",
      expectedRevision: null,
      roomId: "room-12345678",
      payload: { score: 8 },
    }),
    /request is invalid/,
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => session.createTrainingV6ApiRequest({
      action: "submit_score",
      actionId: "action-45678901",
      expectedRevision: 1,
      roomId: "room-12345678",
      payload: cyclic,
    }),
    /payload must be acyclic JSON/,
  );
});
