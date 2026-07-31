"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  PATHS,
  createTrainingSessionV6Service,
} = require("../training-session-v6-service");
const {
  TRAINING_V6_ROOM_RETENTION_MS,
} = require("../training-session-v6");

const START = 1_900_000_000_000;
const HOST_UID = "training-v6-service-host";
const GUEST_UID = "training-v6-service-guest";
const CONNECTION_ID = "connection-shared-v6-0001";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function segments(value) {
  return String(value || "").split("/").filter(Boolean);
}

function getAt(root, value) {
  let current = root;
  for (const key of segments(value)) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function setAt(root, value, nextValue) {
  const keys = segments(value);
  let current = root;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  }
  if (nextValue == null) delete current[keys.at(-1)];
  else current[keys.at(-1)] = clone(nextValue);
}

class FakeSnapshot {
  constructor(value) {
    this.value = clone(value);
  }

  val() {
    return clone(this.value);
  }
}

class FakeReference {
  constructor(database, value) {
    this.database = database;
    this.path = segments(value).join("/");
  }

  async get() {
    return new FakeSnapshot(getAt(this.database.data, this.path));
  }

  async transaction(update, _onComplete, applyLocally = true) {
    this.database.transactionApplyLocally.push({
      path: this.path,
      applyLocally,
    });
    const current = clone(getAt(this.database.data, this.path));
    const next = update(current);
    if (next === undefined) {
      return {
        committed: false,
        snapshot: new FakeSnapshot(current),
      };
    }
    setAt(this.database.data, this.path, next);
    if (this.database.failAfterCommit.delete(this.path)) {
      throw new Error(`forced response loss: ${this.path}`);
    }
    return {
      committed: true,
      snapshot: new FakeSnapshot(getAt(this.database.data, this.path)),
    };
  }

  async update(values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new TypeError("update values must be an object");
    }
    const updates = Object.entries(values).map(([key, value]) => ({
      path: [...segments(this.path), ...segments(key)].join("/"),
      value,
    }));
    const paths = updates.map(({ path }) => path).sort();
    for (let index = 1; index < paths.length; index += 1) {
      if (paths[index].startsWith(`${paths[index - 1]}/`)) {
        throw new Error(
          `update contains ancestor path ${paths[index - 1]} and ${paths[index]}`,
        );
      }
    }
    for (const entry of updates) {
      setAt(this.database.data, entry.path, entry.value);
    }
  }
}

class FakeRealtime {
  constructor() {
    this.data = {};
    this.transactionApplyLocally = [];
    this.failAfterCommit = new Set();
  }

  ref(value) {
    return new FakeReference(this, value);
  }

  read(value) {
    return clone(getAt(this.data, value));
  }

  failNextResponseAfterCommit(value) {
    this.failAfterCommit.add(segments(value).join("/"));
  }
}

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function profile(displayName, {
  maxBpm = 140,
  allowedExercises = ["push_up", "squat", "sit_up"],
  conditionText = "",
} = {}) {
  return {
    displayName,
    maxBpm,
    allowedExercises,
    conditionText,
  };
}

function envelope(action, actionId, {
  roomId = null,
  expectedRevision = 0,
  payload,
} = {}) {
  return {
    protocolVersion: 6,
    variant: "companion_v6",
    clientVersion: "training-v6-service-test",
    action,
    actionId,
    expectedRevision,
    roomId,
    payload: payload ?? (action === "handshake"
      ? {
        supportedProtocolVersions: [6],
        requestedVariant: "companion_v6",
      }
      : {}),
  };
}

function environment() {
  const realtime = new FakeRealtime();
  let timestamp = START;
  const service = createTrainingSessionV6Service({
    realtime,
    HttpsError: FakeHttpsError,
    crypto,
    now: () => {
      timestamp += 1;
      return timestamp;
    },
  });
  return {
    realtime,
    service,
    advance: (milliseconds) => {
      timestamp += milliseconds;
    },
  };
}

async function matched(environmentValue) {
  const { service } = environmentValue;
  const first = await service.dispatch(HOST_UID, envelope(
    "join",
    "join-host-0001",
    {
      payload: {
        profile: profile("HOST", {
          maxBpm: 120,
          allowedExercises: ["squat", "custom"],
          conditionText: "膝に配慮",
        }),
      },
    },
  ));
  assert.equal(first.outcome, "waiting");
  const second = await service.dispatch(GUEST_UID, envelope(
    "join",
    "join-guest-0001",
    {
      payload: {
        profile: profile("GUEST", {
          maxBpm: 150,
          allowedExercises: ["push_up", "sit_up"],
        }),
      },
    },
  ));
  assert.equal(second.outcome, "media_exchange");
  await service.dispatch(HOST_UID, envelope(
    "claim_transport",
    "claim-host-matched-0001",
    {
      roomId: second.roomId,
      payload: { connectionId: CONNECTION_ID },
    },
  ));
  const guest = await service.dispatch(GUEST_UID, envelope(
    "claim_transport",
    "claim-guest-matched-0001",
    {
      roomId: second.roomId,
      payload: { connectionId: CONNECTION_ID },
    },
  ));
  return {
    roomId: second.roomId,
    host: await service.dispatch(HOST_UID, envelope(
      "inspect",
      "inspect-host-0001",
    )),
    guest,
  };
}

function roomAction(snapshot, action, actionId, extra = {}) {
  return envelope(action, actionId, {
    roomId: snapshot.roomId,
    expectedRevision: snapshot.revision,
    payload: action === "finish"
      ? {}
      : { ...extra, connectionId: CONNECTION_ID },
  });
}

test("handshake rejects no state and advertises the versioned V6 contract", async () => {
  const { service } = environment();
  const response = await service.dispatch(HOST_UID, envelope(
    "handshake",
    "handshake-service-0001",
  ));
  assert.equal(response.outcome, "ready");
  assert.equal(response.protocolVersion, 6);
  assert.equal(response.variant, "companion_v6");
  assert.equal(response.capabilities.workoutSeconds, 60);
  assert.equal(response.capabilities.actions.includes("no_contest"), true);
  assert.deepEqual(response.capabilities.beatsPerRep, [2, 4, 8]);
  await assert.rejects(
    service.dispatch(HOST_UID, {
      ...envelope("handshake", "handshake-service-old-0001"),
      protocolVersion: 5,
    }),
    (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(error.details.reason, "protocol-mismatch");
      assert.equal(error.details.protocolVersion, 6);
      return true;
    },
  );
});

test("browser V6 handshake and snapshot contracts accept server responses", async () => {
  const {
    createTrainingV6HandshakeRequest,
    interpretTrainingV6Handshake,
  } = await import("../../training-v6-session.mjs");
  const {
    normalizeTrainingV6ServerSnapshot,
  } = await import("../../training-v6-machine.mjs");
  const env = environment();
  const request = createTrainingV6HandshakeRequest({
    actionId: "browser-handshake-0001",
  });
  const response = await env.service.dispatch(HOST_UID, request);
  assert.equal(interpretTrainingV6Handshake(response).compatible, true);

  const { guest } = await matched(env);
  const normalized = normalizeTrainingV6ServerSnapshot(guest.snapshot);
  assert.ok(normalized);
  assert.equal(normalized.activeWorkoutIndex, null);
  assert.deepEqual(normalized.workoutQueue, []);
  assert.equal(normalized.instruction, null);
  assert.equal(normalized.workout, null);
  assert.equal(normalized.result, null);
});

test("join is idempotent, matches two players, and fixes memberOrder", async () => {
  const { realtime, service } = environment();
  const join = envelope("join", "join-host-replay-0001", {
    payload: { profile: profile("HOST") },
  });
  const first = await service.dispatch(HOST_UID, join);
  assert.equal(first.outcome, "waiting");
  assert.equal(first.idempotent, false);
  const waitingTicket = realtime.read(`${PATHS.tickets}/${HOST_UID}`);
  assert.equal(waitingTicket.protocolVersion, 6);
  assert.equal(waitingTicket.state, "waiting");
  assert.equal(typeof waitingTicket.ticketId, "string");
  const replay = await service.dispatch(HOST_UID, join);
  assert.equal(replay.outcome, "waiting");
  assert.equal(replay.idempotent, true);

  const guest = await service.dispatch(GUEST_UID, envelope(
    "join",
    "join-guest-match-0001",
    { payload: { profile: profile("GUEST") } },
  ));
  assert.equal(guest.outcome, "media_exchange");
  assert.equal(realtime.read(`${PATHS.tickets}/${HOST_UID}`).state, "matched");
  assert.equal(realtime.read(`${PATHS.tickets}/${GUEST_UID}`).state, "matched");
  assert.equal(
    realtime.read(`${PATHS.tickets}/${HOST_UID}`).roomId,
    guest.roomId,
  );
  assert.deepEqual(guest.room.participantUids, [HOST_UID, GUEST_UID]);
  assert.deepEqual(guest.room.memberOrder, {
    0: HOST_UID,
    1: GUEST_UID,
  });
  assert.deepEqual(guest.room.members, {
    [HOST_UID]: true,
    [GUEST_UID]: true,
  });
  assert.equal(
    guest.room.players[HOST_UID].profile.displayName,
    "HOST",
  );
  assert.equal(
    realtime.transactionApplyLocally.every(({ applyLocally }) => applyLocally === false),
    true,
  );
});

test("inspect terminalizes an expired owner ticket without matching it", async () => {
  const env = environment();
  const { advance, realtime, service } = env;
  await service.dispatch(HOST_UID, envelope("join", "join-expiring-0001", {
    payload: { profile: profile("HOST") },
  }));
  advance(3 * 60_000 + 1);
  const inspected = await service.dispatch(HOST_UID, envelope(
    "inspect",
    "inspect-expired-0001",
  ));
  assert.equal(inspected.outcome, "idle");
  assert.equal(inspected.ticket.state, "terminal");
  assert.equal(realtime.read(`${PATHS.queue}/${HOST_UID}`), undefined);
  assert.equal(realtime.read(`${PATHS.tickets}/${HOST_UID}`).state, "terminal");
});

test("game actions use expectedRevision CAS and redact a pending opponent score", async () => {
  const env = environment();
  const { realtime, service } = env;
  let { host } = await matched(env);
  host = await service.dispatch(HOST_UID, roomAction(
    host,
    "image_ready",
    "host-image-service-0001",
    { roundNumber: 1, imageNumber: 1 },
  ));
  let guest = await service.dispatch(GUEST_UID, roomAction(
    host,
    "image_ready",
    "guest-image-service-0001",
    { roundNumber: 1, imageNumber: 1 },
  ));
  assert.equal(guest.phase, "scoring");

  const hostScore = await service.dispatch(HOST_UID, roomAction(
    guest,
    "score",
    "host-score-service-0001",
    { roundNumber: 1, score: 8 },
  ));
  assert.equal(hostScore.ownScore, 8);
  assert.deepEqual(hostScore.room.rounds[1].scores, {});
  assert.deepEqual(
    realtime.read(`${PATHS.rooms}/${hostScore.roomId}/rounds/1/scores`),
    {},
  );
  assert.equal(
    realtime.read(
      `${PATHS.privateScores}/${hostScore.roomId}/1/${HOST_UID}/value`,
    ),
    8,
  );
  const hostInspect = await service.dispatch(HOST_UID, envelope(
    "inspect",
    "inspect-own-secret-score-0001",
  ));
  assert.equal(hostInspect.ownScore, 8);
  assert.deepEqual(hostInspect.room.rounds[1].scores, {});
  const guestInspect = await service.dispatch(GUEST_UID, envelope(
    "inspect",
    "inspect-secret-score-0001",
    {
    roomId: hostScore.roomId,
    },
  ));
  assert.equal(Object.hasOwn(guestInspect, "ownScore"), false);
  assert.deepEqual(guestInspect.room.rounds[1].scores, {});

  await assert.rejects(
    service.dispatch(GUEST_UID, {
      ...roomAction(
        hostScore,
        "score",
        "guest-stale-score-0001",
        { roundNumber: 1, score: 7 },
      ),
      expectedRevision: hostScore.revision - 1,
    }),
    (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(error.details.reason, "revision-conflict");
      assert.equal(error.details.currentRevision, hostScore.revision);
      return true;
    },
  );

  guest = await service.dispatch(GUEST_UID, roomAction(
    hostScore,
    "score",
    "guest-score-service-0001",
    { roundNumber: 1, score: 7 },
  ));
  assert.equal(guest.phase, "instruction");
  assert.equal(guest.room.workoutQueue.length, 1);
  assert.equal(guest.room.workoutQueue[0].victimUid, HOST_UID);
  assert.equal(guest.room.rounds[1].scores[HOST_UID], 8);
  assert.equal(guest.room.rounds[1].scores[GUEST_UID], 7);
});

test("instruction is server-fenced by the victim safety profile", async () => {
  const env = environment();
  const { service } = env;
  let { host } = await matched(env);
  host = await service.dispatch(HOST_UID, roomAction(
    host,
    "image_ready",
    "host-image-safety-0001",
    { roundNumber: 1, imageNumber: 1 },
  ));
  let snapshot = await service.dispatch(GUEST_UID, roomAction(
    host,
    "image_ready",
    "guest-image-safety-0001",
    { roundNumber: 1, imageNumber: 1 },
  ));
  snapshot = await service.dispatch(HOST_UID, roomAction(
    snapshot,
    "score",
    "host-score-safety-0001",
    { roundNumber: 1, score: 8 },
  ));
  snapshot = await service.dispatch(GUEST_UID, roomAction(
    snapshot,
    "score",
    "guest-score-safety-0001",
    { roundNumber: 1, score: 7 },
  ));

  await assert.rejects(
    service.dispatch(GUEST_UID, roomAction(
      snapshot,
      "instruction",
      "unsafe-instruction-0001",
      {
        workoutIndex: 0,
        exerciseId: "push_up",
        exercise: "腕立て伏せ",
        completion: "60秒",
        command: "続ける",
        bpm: 100,
        beatsPerRep: 4,
      },
    )),
    (error) => {
      assert.equal(error.code, "invalid-argument");
      assert.equal(error.details.reason, "unsafe-instruction");
      return true;
    },
  );

  const accepted = await service.dispatch(GUEST_UID, roomAction(
    snapshot,
    "instruction",
    "safe-instruction-0001",
    {
      workoutIndex: 0,
      exerciseId: "squat",
      exercise: "スクワット",
      completion: "60秒",
      command: "無理のない範囲で続ける",
      bpm: 120,
      beatsPerRep: 4,
    },
  ));
  assert.equal(accepted.phase, "ready");
  assert.equal(
    Object.hasOwn(accepted.room.instruction, "initialCheer"),
    false,
  );
  assert.equal(accepted.room.instruction.bpm, 120);
});

test("claim_transport fences P2P generations without changing phase revision", async () => {
  const env = environment();
  const { service } = env;
  const { host } = await matched(env);
  const baselineTransportRevision = host.transportRevision;
  const baselineGeneration = host.room.connections[HOST_UID].generation;
  const claim = envelope("claim_transport", "claim-transport-service-0001", {
    roomId: host.roomId,
    payload: { connectionId: "connection-service-0001" },
  });
  const first = await service.dispatch(HOST_UID, claim);
  assert.equal(first.phase, "media_exchange");
  assert.equal(first.revision, host.revision);
  assert.equal(first.transportRevision, baselineTransportRevision + 1);
  assert.equal(first.generation, baselineGeneration + 1);
  assert.equal(first.connection.connectionId, "connection-service-0001");

  const replay = await service.dispatch(HOST_UID, claim);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.revision, host.revision);
  assert.equal(replay.transportRevision, baselineTransportRevision + 1);
  assert.equal(replay.generation, baselineGeneration + 1);

  const rotated = await service.dispatch(HOST_UID, {
    ...claim,
    actionId: "claim-transport-service-0002",
    payload: { connectionId: "connection-service-0002" },
  });
  assert.equal(rotated.revision, host.revision);
  assert.equal(rotated.transportRevision, baselineTransportRevision + 2);
  assert.equal(rotated.generation, baselineGeneration + 2);
});

test("explicit leave ends NO CONTEST but retains immutable room members", async () => {
  const env = environment();
  const { realtime, service } = env;
  const { host } = await matched(env);
  const left = await service.dispatch(HOST_UID, envelope(
    "leave",
    "leave-room-service-0001",
    {
    roomId: host.roomId,
    expectedRevision: host.revision,
    payload: { connectionId: CONNECTION_ID },
    },
  ));
  assert.equal(left.phase, "no_contest");
  assert.equal(left.room.result.reason, "member_left");
  assert.deepEqual(left.room.participantUids, [HOST_UID, GUEST_UID]);
  assert.deepEqual(left.room.members, {
    [HOST_UID]: true,
    [GUEST_UID]: true,
  });

  const stored = realtime.read(`${PATHS.rooms}/${host.roomId}`);
  assert.equal(stored.phase, "no_contest");
  assert.deepEqual(stored.memberOrder, {
    0: HOST_UID,
    1: GUEST_UID,
  });
  const inspect = await service.dispatch(GUEST_UID, envelope(
    "inspect",
    "inspect-left-room-0001",
    {
    roomId: host.roomId,
    },
  ));
  assert.equal(inspect.phase, "no_contest");
});

test("no_contest terminates tickets and finish only ACKs and cleans membership", async () => {
  const env = environment();
  const { realtime, service } = env;
  const { host } = await matched(env);
  const terminal = await service.dispatch(HOST_UID, roomAction(
    host,
    "no_contest",
    "no-contest-service-0001",
    { reason: "health", note: "体調変化" },
  ));
  assert.equal(terminal.phase, "no_contest");
  assert.equal(realtime.read(`${PATHS.tickets}/${HOST_UID}`).state, "terminal");
  assert.equal(realtime.read(`${PATHS.tickets}/${GUEST_UID}`).state, "terminal");
  assert.equal(
    realtime.read(`${PATHS.memberships}/${HOST_UID}`).state,
    "finished",
  );

  const acknowledged = await service.dispatch(HOST_UID, roomAction(
    terminal,
    "finish",
    "finish-ack-service-0001",
  ));
  assert.equal(acknowledged.phase, "no_contest");
  assert.equal(
    realtime.read(`${PATHS.memberships}/${HOST_UID}`),
    undefined,
  );
  assert.equal(
    realtime.read(`${PATHS.memberships}/${GUEST_UID}`).state,
    "finished",
  );
  assert.equal(
    Number.isSafeInteger(acknowledged.room.finishedBy[HOST_UID]),
    true,
  );
});

test("committed action survives response loss and retry returns its receipt", async () => {
  const env = environment();
  const { realtime, service } = env;
  const { host } = await matched(env);
  const imageAction = roomAction(
    host,
    "image_ready",
    "response-loss-image-0001",
    { roundNumber: 1, imageNumber: 1 },
  );
  realtime.failNextResponseAfterCommit(PATHS.root);
  await assert.rejects(
    service.dispatch(HOST_UID, imageAction),
    /forced response loss/,
  );
  const retried = await service.dispatch(HOST_UID, imageAction);
  assert.equal(retried.idempotent, true);
  assert.equal(retried.revision, host.revision + 1);
  assert.equal(
    retried.room.rounds[1].images[HOST_UID].imageNumber,
    1,
  );
});

test("one actionId cannot be reused for a different semantic payload", async () => {
  const env = environment();
  const { service } = env;
  const { host } = await matched(env);
  const first = await service.dispatch(HOST_UID, roomAction(
    host,
    "image_ready",
    "reuse-payload-image-0001",
    { roundNumber: 1, imageNumber: 1 },
  ));
  await assert.rejects(
    service.dispatch(HOST_UID, roomAction(
      first,
      "image_ready",
      "reuse-payload-image-0001",
      { roundNumber: 1, imageNumber: 2 },
    )),
    (error) => {
      assert.equal(error.code, "invalid-argument");
      assert.equal(error.details.reason, "action-id-reused");
      return true;
    },
  );
});

test("rotating transport ownership rejects an old tab action", async () => {
  const env = environment();
  const { service } = env;
  const { host } = await matched(env);
  await service.dispatch(HOST_UID, envelope(
    "claim_transport",
    "claim-current-owner-0001",
    {
      roomId: host.roomId,
      payload: { connectionId: "connection-current-v6-0001" },
    },
  ));
  await assert.rejects(
    service.dispatch(HOST_UID, roomAction(
      host,
      "image_ready",
      "old-owner-image-0001",
      { roundNumber: 1, imageNumber: 1 },
    )),
    (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(error.details.reason, "owner-replaced");
      return true;
    },
  );
});

test("cleanup terminalizes expired rooms and prunes transport and old metadata", async () => {
  const env = environment();
  const {
    advance,
    realtime,
    service,
  } = env;
  const { roomId } = await matched(env);
  setAt(
    realtime.data,
    `${PATHS.signals}/${roomId}/${GUEST_UID}/${HOST_UID}/stale-signal-0001`,
    { createdAt: START },
  );
  setAt(
    realtime.data,
    `${PATHS.presence}/${roomId}/${HOST_UID}`,
    { updatedAt: START },
  );
  setAt(
    realtime.data,
    `${PATHS.tickets}/orphan-terminal-user`,
    {
      protocolVersion: 6,
      ticketId: "orphan-terminal-ticket-0001",
      state: "terminal",
      updatedAt: START,
    },
  );
  setAt(
    realtime.data,
    `${PATHS.operations}/orphan-terminal-user/old-operation-0001`,
    {
      action: "join",
      digest: "a".repeat(64),
      result: { outcome: "idle" },
      at: START,
    },
  );

  advance(TRAINING_V6_ROOM_RETENTION_MS + 1);
  const summary = await service.cleanup();
  const room = realtime.read(`${PATHS.rooms}/${roomId}`);
  assert.equal(summary.expiredRooms, 1);
  assert.equal(summary.deletedRooms, 0);
  assert.ok(summary.prunedOperations >= 1);
  assert.equal(summary.prunedTickets, 1);
  assert.equal(summary.staleSignals, 1);
  assert.equal(summary.stalePresence, 1);
  assert.equal(room.phase, "no_contest");
  assert.equal(room.result.reason, "session_expired");
  assert.equal(room.result.requestedBy, "system");
  assert.equal(realtime.read(`${PATHS.signals}/${roomId}`), undefined);
  assert.equal(realtime.read(`${PATHS.presence}/${roomId}`), undefined);
  assert.equal(
    realtime.read(`${PATHS.operations}/orphan-terminal-user`),
    undefined,
  );
  assert.equal(
    realtime.read(`${PATHS.tickets}/orphan-terminal-user`),
    undefined,
  );

  const pending = await service.pendingFinalizations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].entry.roomId, roomId);
  assert.equal(pending[0].entry.terminalAt, room.result.completedAt);
  assert.equal(pending[0].room.phase, "no_contest");

  const acknowledged = await service.acknowledgeFinalization(
    roomId,
    room.result.completedAt,
  );
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(
    realtime.read(`${PATHS.finalizationOutbox}/${roomId}`),
    undefined,
  );

  advance(TRAINING_V6_ROOM_RETENTION_MS + 1);
  const deleted = await service.cleanup();
  assert.equal(deleted.deletedRooms, 1);
  assert.equal(realtime.read(`${PATHS.rooms}/${roomId}`), undefined);
  assert.equal(realtime.read(`${PATHS.memberships}/${HOST_UID}`), undefined);
  assert.equal(realtime.read(`${PATHS.memberships}/${GUEST_UID}`), undefined);
  assert.equal(realtime.read(`${PATHS.tickets}/${HOST_UID}`), undefined);
  assert.equal(realtime.read(`${PATHS.tickets}/${GUEST_UID}`), undefined);
});
