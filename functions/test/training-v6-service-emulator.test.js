"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");

const RUN_FLAG = "RUN_TRAINING_V6_SERVICE_EMULATOR_TESTS";
const PROJECT_ID_ENV = "TRAINING_V6_SERVICE_TEST_PROJECT_ID";
const runRequested = process.env[RUN_FLAG] === "1";

function safeLoopback(value) {
  return /^(?:127\.0\.0\.1|localhost):\d+$/.test(String(value || ""));
}

function safeProjectId(value) {
  return /^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(String(value || ""));
}

if (!runRequested) {
  test("Training 60 V6 service emulator test is opt-in and never uses production", {
    skip: `set ${RUN_FLAG}=1, FIREBASE_DATABASE_EMULATOR_HOST, and ${PROJECT_ID_ENV}=demo-*`,
  }, () => {});
} else {
  const projectId = String(process.env[PROJECT_ID_ENV] || "");
  if (!safeLoopback(process.env.FIREBASE_DATABASE_EMULATOR_HOST)
      || !safeProjectId(projectId)) {
    throw new Error("Training 60 V6 service tests require an explicit demo RTDB emulator.");
  }

  const {
    deleteApp,
    initializeApp,
  } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { HttpsError } = require("firebase-functions/v2/https");
  const {
    createTrainingSessionV6Service,
  } = require("../training-session-v6-service");

  const suffix = crypto.randomUUID().replaceAll("-", "");
  const hostUid = `training-v6-host-${suffix}`;
  const guestUid = `training-v6-guest-${suffix}`;
  const connectionId = `connection-v6-${suffix}`;
  let timestamp = 1_900_000_000_000;
  let app;
  let realtime;
  let service;

  function envelope(action, actionId, {
    roomId = null,
    expectedRevision = 0,
    payload = {},
  } = {}) {
    return {
      protocolVersion: 6,
      variant: "companion_v6",
      clientVersion: "training-v6-emulator-test",
      action,
      actionId,
      expectedRevision,
      roomId,
      payload,
    };
  }

  function profile(displayName) {
    return {
      displayName,
      maxBpm: 120,
      allowedExercises: ["squat"],
      conditionText: "",
    };
  }

  function roomAction(snapshot, action, actionId, payload) {
    return envelope(action, actionId, {
      roomId: snapshot.roomId,
      expectedRevision: snapshot.revision,
      payload: {
        ...payload,
        connectionId,
      },
    });
  }

  before(async () => {
    app = initializeApp({
      projectId,
      databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    }, `training-v6-service-${suffix}`);
    realtime = getDatabase(app);
    await realtime.ref("online/trainingV6").remove();
    service = createTrainingSessionV6Service({
      realtime,
      HttpsError,
      crypto,
      now: () => {
        timestamp += 1;
        return timestamp;
      },
    });
  });

  after(async () => {
    if (realtime) await realtime.ref("online/trainingV6").remove();
    if (app) await deleteApp(app);
  });

  test("real RTDB array materialization completes join through secret scoring", async () => {
    const waiting = await service.dispatch(hostUid, envelope(
      "join",
      `join-host-${suffix}`,
      { payload: { profile: profile("HOST") } },
    ));
    assert.equal(waiting.outcome, "waiting");
    const matched = await service.dispatch(guestUid, envelope(
      "join",
      `join-guest-${suffix}`,
      { payload: { profile: profile("GUEST") } },
    ));
    assert.equal(matched.phase, "media_exchange");

    const roomId = matched.roomId;
    await service.dispatch(hostUid, envelope(
      "claim_transport",
      `claim-host-${suffix}`,
      { roomId, payload: { connectionId } },
    ));
    let guest = await service.dispatch(guestUid, envelope(
      "claim_transport",
      `claim-guest-${suffix}`,
      { roomId, payload: { connectionId } },
    ));
    let host = await service.dispatch(hostUid, envelope(
      "inspect",
      `inspect-host-${suffix}`,
      { roomId },
    ));

    host = await service.dispatch(hostUid, roomAction(
      host,
      "image_ready",
      `image-host-${suffix}`,
      { roundNumber: 1, imageNumber: 1 },
    ));
    guest = await service.dispatch(guestUid, roomAction(
      host,
      "image_ready",
      `image-guest-${suffix}`,
      { roundNumber: 1, imageNumber: 1 },
    ));
    assert.equal(guest.phase, "scoring");

    host = await service.dispatch(hostUid, roomAction(
      guest,
      "score",
      `score-host-${suffix}`,
      { roundNumber: 1, score: 8 },
    ));
    assert.equal(host.ownScore, 8);
    guest = await service.dispatch(guestUid, roomAction(
      host,
      "score",
      `score-guest-${suffix}`,
      { roundNumber: 1, score: 7 },
    ));
    assert.equal(guest.phase, "instruction");
    assert.equal(guest.room.workoutQueue.length, 1);

    const stored = (
      await realtime.ref(`online/trainingV6/state/rooms/${roomId}`).get()
    ).val();
    assert.equal(Array.isArray(stored.memberOrder), true);
    assert.equal(Array.isArray(stored.rounds), true);
    assert.equal(stored.rounds[1].scores[hostUid], 8);
    assert.equal(stored.rounds[1].scores[guestUid], 7);
  });
}
