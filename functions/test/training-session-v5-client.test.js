"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "training-session-v5.mjs"),
).href;
let session;

test.before(async () => {
  session = await import(moduleUrl);
});

function identity(overrides = {}) {
  return {
    runId: "run-12345678",
    endpointId: "endpoint-12345678",
    ownerEpoch: "owner-12345678",
    roomAttemptId: "attempt-12345678",
    transportEpoch: "transport-12345678",
    ...overrides,
  };
}

test("V5 paths isolate attempts, presence, and one target run signal", () => {
  assert.equal(
    session.trainingSessionV5AttemptPath("player-a"),
    "online/trainingAttemptsV5/player-a",
  );
  assert.equal(
    session.trainingSessionV5PresencePath(
      "room-12345678",
      "player-a",
      "run-12345678",
    ),
    "online/trainingRooms/room-12345678/presenceV5/player-a/run-12345678",
  );
  assert.equal(
    session.trainingSessionV5SignalPath(
      "room-12345678",
      "player-b",
      "run-87654321",
      "signal-12345678",
    ),
    "online/trainingRooms/room-12345678/signalsV5/player-b/run-87654321/signal-12345678",
  );
});

test("presence requires the complete canonical string identity", () => {
  const payload = session.createTrainingSessionV5PresencePayload({
    ...identity(),
    online: true,
    updatedAt: 1000,
  });
  assert.equal(session.validateTrainingSessionV5PresencePayload(payload), true);
  assert.equal(
    session.validateTrainingSessionV5PresencePayload({
      ...payload,
      ownerEpoch: 1,
    }),
    false,
  );
});

test("signals from an old transport or target run are rejected", () => {
  const envelope = session.createTrainingSessionV5SignalEnvelope({
    roomAttemptId: "attempt-12345678",
    transportEpoch: "transport-12345678",
    fromUid: "player-a",
    toUid: "player-b",
    fromRunId: "run-12345678",
    toRunId: "run-87654321",
    fromEndpointId: "endpoint-12345678",
    toEndpointId: "endpoint-87654321",
    type: "offer",
    payload: JSON.stringify({ type: "offer", sdp: "test" }),
    createdAt: 10_000,
  });
  const accepted = session.decideTrainingSessionV5Signal({
    envelope,
    ownUid: "player-b",
    ownRunId: "run-87654321",
    ownEndpointId: "endpoint-87654321",
    remoteUid: "player-a",
    remoteRunId: "run-12345678",
    remoteEndpointId: "endpoint-12345678",
    roomAttemptId: "attempt-12345678",
    transportEpoch: "transport-12345678",
    now: 10_000,
  });
  assert.equal(accepted.accepted, true);
  const stale = session.decideTrainingSessionV5Signal({
    envelope,
    ownUid: "player-b",
    ownRunId: "run-87654321",
    ownEndpointId: "endpoint-87654321",
    remoteUid: "player-a",
    remoteRunId: "run-12345678",
    remoteEndpointId: "endpoint-12345678",
    roomAttemptId: "attempt-12345678",
    transportEpoch: "transport-87654321",
    now: 10_000,
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "signal-fence-mismatch");
});

test("accepted signals are consumed only after successful handling", () => {
  assert.equal(session.shouldConsumeTrainingSessionV5Signal(
    { accepted: true, consume: "after-success" },
    { handledSuccessfully: false, contextStillCurrent: true },
  ), false);
  assert.equal(session.shouldConsumeTrainingSessionV5Signal(
    { accepted: true, consume: "after-success" },
    { handledSuccessfully: true, contextStillCurrent: true },
  ), true);
});
