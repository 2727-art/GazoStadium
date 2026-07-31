"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const machineUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "training-v6-machine.mjs"),
).href;
const domainUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "training-v6-domain.mjs"),
).href;
let machine;
let domain;

test.before(async () => {
  [machine, domain] = await Promise.all([
    import(machineUrl),
    import(domainUrl),
  ]);
});

function snapshot({
  phase = "media_exchange",
  revision = 1,
  roundNumber = 1,
  workoutQueue = [],
  activeWorkoutIndex = -1,
  instruction = null,
  workout = null,
  result = null,
} = {}) {
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
    roundNumber,
    rounds: {},
    workoutQueue,
    activeWorkoutIndex,
    instruction,
    workout,
    result,
  };
}

function apply(state, serverSnapshot) {
  const decision = machine.transitionTrainingV6ClientState(state, {
    type: "SERVER_SNAPSHOT",
    snapshot: serverSnapshot,
  });
  assert.equal(decision.accepted, true, decision.reason);
  return decision.state;
}

test("only a newer server snapshot changes canonical phase and revision", () => {
  let state = machine.createTrainingV6ClientState();
  state = apply(state, snapshot({ phase: "scoring", revision: 3 }));

  const unsupported = machine.transitionTrainingV6ClientState(state, {
    type: "LOCAL_SCORE_READY",
  });
  assert.equal(unsupported.accepted, false);
  assert.equal(machine.trainingV6CanonicalPhase(unsupported.state), "scoring");
  assert.equal(machine.trainingV6CanonicalRevision(unsupported.state), 3);

  state = apply(state, snapshot({ phase: "instruction", revision: 4 }));
  assert.equal(machine.trainingV6CanonicalPhase(state), "instruction");
  assert.equal(machine.trainingV6CanonicalRevision(state), 4);
});

test("transport recovery is an overlay and leaves canonical progress untouched", () => {
  let state = machine.createTrainingV6ClientState();
  state = apply(state, snapshot({
    phase: "workout",
    revision: 12,
    workoutQueue: [{ workoutId: "workout-1-1" }],
    activeWorkoutIndex: 0,
    workout: { startedAt: 1_000, endsAt: 61_000 },
  }));
  const canonical = state.snapshot;

  let decision = machine.transitionTrainingV6ClientState(state, {
    type: "TRANSPORT_INTERRUPTED",
    reason: "peer-reconnecting",
  });
  assert.equal(decision.accepted, true);
  state = decision.state;
  assert.equal(state.snapshot, canonical);
  assert.equal(machine.trainingV6CanonicalPhase(state), "workout");
  assert.equal(machine.trainingV6CanonicalRevision(state), 12);
  assert.deepEqual(machine.trainingV6RecoveryOverlay(state), {
    kind: "recovering",
    reason: "peer-reconnecting",
    phase: "workout",
    revision: 12,
  });

  decision = machine.transitionTrainingV6ClientState(state, {
    type: "TRANSPORT_RESTORED",
  });
  assert.equal(decision.accepted, true);
  assert.equal(decision.state.snapshot, canonical);
  assert.equal(machine.trainingV6RecoveryOverlay(decision.state), null);
});

test("P2P encouragement produces a display effect but no state transition", () => {
  let state = machine.createTrainingV6ClientState();
  state = apply(state, snapshot({ phase: "workout", revision: 8 }));
  const event = domain.createTrainingV6P2PEvent({
    kind: "reaction",
    eventId: "event-12345678",
    roomId: state.snapshot.roomId,
    roundNumber: 1,
    workoutId: "workout-1-1",
    fromUid: "player-alpha",
    toUid: "player-bravo",
    text: "まだいけます！",
    createdAt: 5_000,
  });
  const decision = machine.transitionTrainingV6ClientState(state, {
    type: "P2P_EVENT",
    message: event,
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.reason, "p2p-event-ephemeral");
  assert.equal(decision.state, state);
  assert.equal(decision.effect.type, "display-p2p-event");
  assert.equal(machine.trainingV6CanonicalPhase(decision.state), "workout");

  const outsider = machine.transitionTrainingV6ClientState(state, {
    type: "P2P_EVENT",
    message: {
      ...event,
      fromUid: "player-outsider",
    },
  });
  assert.equal(outsider.accepted, false);
  assert.equal(outsider.reason, "p2p-member-mismatch");
});

test("stale and conflicting snapshots cannot overwrite canonical state", () => {
  let state = machine.createTrainingV6ClientState();
  state = apply(state, snapshot({ phase: "ready", revision: 6 }));

  const stale = machine.transitionTrainingV6ClientState(state, {
    type: "SERVER_SNAPSHOT",
    snapshot: snapshot({ phase: "instruction", revision: 5 }),
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "snapshot-stale");

  const conflict = machine.transitionTrainingV6ClientState(state, {
    type: "SERVER_SNAPSHOT",
    snapshot: snapshot({ phase: "workout", revision: 6 }),
  });
  assert.equal(conflict.accepted, false);
  assert.equal(conflict.reason, "snapshot-revision-conflict");

  const duplicate = machine.transitionTrainingV6ClientState(state, {
    type: "SERVER_SNAPSHOT",
    snapshot: snapshot({ phase: "ready", revision: 6 }),
  });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "snapshot-duplicate");
});

test("NO CONTEST is terminal only after the server publishes it", () => {
  let state = machine.createTrainingV6ClientState();
  state = apply(state, snapshot({ phase: "workout", revision: 9 }));

  const localStop = machine.transitionTrainingV6ClientState(state, {
    type: "NO_CONTEST",
  });
  assert.equal(localStop.accepted, false);
  assert.equal(machine.trainingV6CanonicalPhase(localStop.state), "workout");

  state = apply(state, snapshot({
    phase: "no_contest",
    revision: 10,
    result: { reason: "health_stop" },
  }));
  assert.equal(machine.trainingV6CanonicalPhase(state), "no_contest");
  const cleared = machine.transitionTrainingV6ClientState(state, {
    type: "CLEAR",
  });
  assert.equal(cleared.accepted, true);
  assert.equal(cleared.state.snapshot, null);
});

test("member order is the single source for sequential participant order", () => {
  const participantUids = machine.trainingV6SnapshotParticipantUids(snapshot());
  assert.deepEqual(participantUids, ["player-alpha", "player-bravo"]);
});

test("server-only helper fields are projected away and optional views become null", () => {
  const fullRoom = snapshot({ phase: "media_exchange", revision: 2 });
  delete fullRoom.instruction;
  delete fullRoom.workout;
  delete fullRoom.result;
  Object.assign(fullRoom, {
    players: {
      "player-alpha": { displayName: "A" },
      "player-bravo": { displayName: "B" },
    },
    connections: {},
    transportRevision: 3,
    actionReceipts: { hidden: true },
  });

  const normalized = machine.normalizeTrainingV6ServerSnapshot(fullRoom);
  assert.ok(normalized);
  assert.equal(normalized.instruction, null);
  assert.equal(normalized.workout, null);
  assert.equal(normalized.result, null);
  assert.equal(Object.hasOwn(normalized, "players"), false);
  assert.equal(Object.hasOwn(normalized, "connections"), false);
  assert.equal(Object.hasOwn(normalized, "actionReceipts"), false);
});
