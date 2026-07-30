"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const machineUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "training-session-v5-machine.mjs"),
).href;
let machine;

test.before(async () => {
  machine = await import(machineUrl);
});

function advance(state, event) {
  const result = machine.transitionTrainingSessionV5(state, {
    runId: state.runId,
    revision: state.revision,
    ...event,
  });
  assert.equal(result.accepted, true, result.reason);
  return result.state;
}

test("network uncertainty recovers the same waiting run instead of superseding it", () => {
  let state = machine.createTrainingSessionV5State();
  state = machine.transitionTrainingSessionV5(state, {
    type: "BEGIN",
    runId: "run-12345678",
    revision: state.revision,
  }).state;
  state = advance(state, { type: "CLAIMED" });
  state = advance(state, { type: "RECOVER", reason: "network-unknown" });
  assert.equal(state.phase, "recovering");
  assert.equal(state.resumePhase, "waiting");
  assert.equal(machine.trainingSessionV5Screen(state), "matching");

  state = advance(state, {
    type: "OWNER_STATUS",
    status: "reclaimed",
  });
  assert.equal(state.phase, "waiting");
  assert.equal(state.runId, "run-12345678");
});

test("only server-confirmed owner replacement enters superseded", () => {
  let state = machine.createTrainingSessionV5State();
  state = machine.transitionTrainingSessionV5(state, {
    type: "BEGIN",
    runId: "run-12345678",
    revision: state.revision,
  }).state;
  state = advance(state, { type: "CLAIMED" });
  state = advance(state, { type: "RECOVER", reason: "heartbeat-unknown" });
  assert.notEqual(state.phase, "superseded");
  state = advance(state, {
    type: "OWNER_STATUS",
    status: "owner-replaced",
  });
  assert.equal(state.phase, "superseded");
  assert.equal(state.terminalKind, "owner-replaced");
});

test("room and transport fences remain distinct through active recovery", () => {
  let state = machine.createTrainingSessionV5State();
  state = machine.transitionTrainingSessionV5(state, {
    type: "BEGIN",
    runId: "run-12345678",
    revision: state.revision,
  }).state;
  state = advance(state, { type: "CLAIMED" });
  state = advance(state, {
    type: "RESERVE",
    roomId: "room-12345678",
    roomAttemptId: "attempt-12345678",
  });
  state = advance(state, {
    type: "CONNECT",
    transportEpoch: "transport-12345678",
  });
  state = advance(state, { type: "ACTIVATE" });
  state = advance(state, { type: "RECOVER", reason: "background-resume" });
  assert.equal(state.resumePhase, "active");
  assert.equal(state.roomAttemptId, "attempt-12345678");
  assert.equal(state.transportEpoch, "transport-12345678");
  state = advance(state, {
    type: "OWNER_STATUS",
    status: "reclaimed",
  });
  assert.equal(state.phase, "active");
});

test("stale revision events cannot mutate a newer run state", () => {
  let state = machine.createTrainingSessionV5State();
  state = machine.transitionTrainingSessionV5(state, {
    type: "BEGIN",
    runId: "run-12345678",
    revision: state.revision,
  }).state;
  const staleRevision = state.revision;
  state = advance(state, { type: "CLAIMED" });
  const result = machine.transitionTrainingSessionV5(state, {
    type: "RECOVER",
    runId: state.runId,
    revision: staleRevision,
    reason: "network-unknown",
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "revision-stale");
  assert.equal(result.state, state);
});
