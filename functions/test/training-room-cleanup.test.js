"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  TRAINING_ACTIVE_PRESENCE_GRACE_MS,
  TRAINING_FORMING_RESERVATION_MAX_AGE_MS,
  TRAINING_QUEUE_CLEANUP_BATCH_SIZE,
  TRAINING_QUEUE_STALE_MS,
  TRAINING_ROOM_ACTIVE_STALE_MS,
  TRAINING_ROOM_CLEANUP_BATCH_SIZE,
  TRAINING_ROOM_FINALIZED_RETENTION_MS,
  TRAINING_ROOM_FORMING_STALE_MS,
  TRAINING_ROOM_PRESENCE_FRESH_MS,
  TRAINING_ROOM_TERMINAL_RETENTION_MS,
  createTrainingQueueCleanup,
  createTrainingRoomCleanup,
  trainingActiveRoomIsLive,
  trainingRoomCleanupDisposition,
} = require("../training-room-cleanup");

const functionsRoot = path.resolve(__dirname, "..");

function activeRoom(createdAt, overrides = {}) {
  return {
    protocolVersion: 1,
    variant: "kitaeai_60",
    hostUid: "alice",
    guestUid: "bob",
    createdAt,
    status: "active",
    firstTrainerUid: "alice",
    members: { alice: true, bob: true },
    players: {
      alice: { uid: "alice", name: "ALICE" },
      bob: { uid: "bob", name: "BOB" },
    },
    accepted: { alice: true, bob: true },
    turns: {},
    ...overrides,
  };
}

function surrenderedRoom(now, suffix = "") {
  const hostUid = `alice${suffix}`;
  const guestUid = `bob${suffix}`;
  const createdAt = now - 60 * 60 * 1000;
  const startedAt = createdAt + 1_000;
  return {
    protocolVersion: 1,
    variant: "kitaeai_60",
    hostUid,
    guestUid,
    createdAt,
    status: "active",
    firstTrainerUid: hostUid,
    members: { [hostUid]: true, [guestUid]: true },
    players: {
      [hostUid]: { uid: hostUid, name: "HOST" },
      [guestUid]: { uid: guestUid, name: "GUEST" },
    },
    accepted: { [hostUid]: true, [guestUid]: true },
    turns: {
      1: {
        trainerUid: hostUid,
        traineeUid: guestUid,
        instruction: {
          exercise: "スクワット",
          completion: "60秒",
          command: "続けろ",
          bpm: 80,
          beatsPerRep: 2,
        },
        createdAt: startedAt - 100,
        startedAt,
        surrenderedAt: startedAt + 10_000,
      },
    },
  };
}

function hpRoom(now, overrides = {}) {
  const commandDeck = {
    1: {
      exercise: "スクワット",
      completion: "最後まで続ける",
      command: "拍に合わせて続けろ",
      beatsPerRep: 2,
    },
    2: {
      exercise: "腕立て伏せ",
      completion: "最後まで続ける",
      command: "自分のペースで続けろ",
      beatsPerRep: 4,
    },
    3: {
      exercise: "腹筋",
      completion: "最後まで続ける",
      command: "呼吸を止めずに続けろ",
      beatsPerRep: 8,
    },
  };
  const imageBpms = { 1: 0, 2: 80, 3: 100, 4: 120, 5: 140 };
  return {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    hostUid: "alice",
    guestUid: "bob",
    createdAt: now - 60_000,
    status: "active",
    members: { alice: true, bob: true },
    players: {
      alice: { uid: "alice", name: "ALICE", commandDeck, imageBpms },
      bob: { uid: "bob", name: "BOB", commandDeck, imageBpms },
    },
    accepted: { alice: true, bob: true },
    rounds: {},
    ...overrides,
  };
}

function fakeSnapshot(value, key = "") {
  return {
    key,
    exists: () => value != null,
    val: () => value,
  };
}

// Mirror Admin RTDB: a cold local cache is offered first, then the server
// rejects the null-hash write and reruns the callback with its current value.
function runColdCacheTransaction(update, serverValue) {
  let next = update(null);
  if (next === undefined) {
    return { committed: false, value: structuredClone(serverValue) };
  }
  if (serverValue != null) {
    next = update(structuredClone(serverValue));
    if (next === undefined) {
      return { committed: false, value: structuredClone(serverValue) };
    }
  }
  return { committed: true, value: structuredClone(next) };
}

function createFakeRealtime({
  rooms,
  active = {},
  invites = {},
  matchLock = null,
  cursor = null,
  failPaths = [],
}) {
  const state = {
    rooms: structuredClone(rooms),
    active: structuredClone(active),
    invites: structuredClone(invites),
    matchLock: structuredClone(matchLock),
    cursor: structuredClone(cursor),
    removedInvites: [],
    queryCalls: [],
  };
  const failed = new Set(failPaths);
  state.failedPaths = failed;
  const maybeFail = (targetPath) => {
    if (failed.has(targetPath)) throw new Error(`Injected failure: ${targetPath}`);
  };
  const roomsQuery = () => {
    const queryState = {
      cutoff: Number.MAX_SAFE_INTEGER,
      limit: Number.MAX_SAFE_INTEGER,
      after: null,
    };
    return {
      orderByChild(child) {
        state.queryCalls.push(["orderByChild", child]);
        return this;
      },
      startAfter(value, key) {
        queryState.after = [Number(value), String(key)];
        state.queryCalls.push(["startAfter", value, key]);
        return this;
      },
      endAt(value) {
        queryState.cutoff = value;
        state.queryCalls.push(["endAt", value]);
        return this;
      },
      limitToFirst(value) {
        queryState.limit = value;
        state.queryCalls.push(["limitToFirst", value]);
        return this;
      },
      async get() {
        const entries = Object.entries(state.rooms)
          .filter(([, room]) => Number(room?.createdAt || 0) <= queryState.cutoff)
          .sort((first, second) => (
            Number(first[1]?.createdAt || 0) - Number(second[1]?.createdAt || 0)
            || first[0].localeCompare(second[0])
          ))
          .filter(([roomId, room]) => {
            if (!queryState.after) return true;
            const pair = [Number(room?.createdAt || 0), roomId];
            return pair[0] > queryState.after[0]
              || (pair[0] === queryState.after[0] && pair[1] > queryState.after[1]);
          })
          .slice(0, queryState.limit);
        return {
          forEach(callback) {
            for (const [roomId, room] of entries) {
              callback(fakeSnapshot(structuredClone(room), roomId));
            }
          },
        };
      },
    };
  };

  const realtime = {
    ref(targetPath) {
      if (targetPath === "online/trainingRoomCleanupCursor") {
        return {
          async get() {
            return fakeSnapshot(structuredClone(state.cursor));
          },
          async set(value) {
            state.cursor = structuredClone(value);
          },
          async remove() {
            state.cursor = null;
          },
        };
      }
      if (targetPath === "online/trainingRooms") return roomsQuery();
      if (targetPath.startsWith("online/trainingRooms/")) {
        const roomId = targetPath.split("/").pop();
        return {
          async transaction(update) {
            maybeFail(targetPath);
            const current = state.rooms[roomId] == null
              ? null
              : structuredClone(state.rooms[roomId]);
            const transaction = runColdCacheTransaction(update, current);
            const next = transaction.value;
            if (!transaction.committed) {
              return {
                committed: false,
                snapshot: fakeSnapshot(next, roomId),
              };
            }
            if (next === null) delete state.rooms[roomId];
            else state.rooms[roomId] = structuredClone(next);
            return {
              committed: true,
              snapshot: fakeSnapshot(next, roomId),
            };
          },
        };
      }
      if (targetPath.startsWith("online/trainingActive/")) {
        const parts = targetPath.split("/");
        const uid = parts[2];
        const roomId = parts[4] || "";
        return {
          async transaction(update) {
            maybeFail(targetPath);
            const current = roomId
              ? state.active[uid]?.rooms?.[roomId] ?? null
              : state.active[uid] ?? null;
            const transaction = runColdCacheTransaction(update, current);
            const next = transaction.value;
            if (!transaction.committed) {
              return {
                committed: false,
                snapshot: fakeSnapshot(next, uid),
              };
            }
            if (roomId) {
              if (next === null && state.active[uid]?.rooms) {
                delete state.active[uid].rooms[roomId];
                if (Object.keys(state.active[uid].rooms).length === 0) {
                  delete state.active[uid].rooms;
                }
              } else if (next !== null) {
                state.active[uid] ||= {};
                state.active[uid].rooms ||= {};
                state.active[uid].rooms[roomId] = next;
              }
            } else if (next === null) delete state.active[uid];
            else state.active[uid] = structuredClone(next);
            return {
              committed: true,
              snapshot: fakeSnapshot(next, uid),
            };
          },
        };
      }
      if (targetPath.startsWith("online/trainingInvites/")) {
        const parts = targetPath.split("/");
        const uid = parts[2];
        const roomId = parts[3];
        return {
          async transaction(update) {
            maybeFail(targetPath);
            const current = state.invites[uid]?.[roomId] ?? null;
            const transaction = runColdCacheTransaction(update, current);
            const next = transaction.value;
            if (!transaction.committed) {
              return {
                committed: false,
                snapshot: fakeSnapshot(next, roomId),
              };
            }
            if (next === null) {
              if (state.invites[uid]) {
                delete state.invites[uid][roomId];
                if (Object.keys(state.invites[uid]).length === 0) {
                  delete state.invites[uid];
                }
              }
              if (current != null) state.removedInvites.push(targetPath);
            } else {
              state.invites[uid] ||= {};
              state.invites[uid][roomId] = structuredClone(next);
            }
            return {
              committed: true,
              snapshot: fakeSnapshot(next, roomId),
            };
          },
        };
      }
      if (targetPath === "online/trainingMatchLock") {
        return {
          async transaction(update) {
            maybeFail(targetPath);
            const transaction = runColdCacheTransaction(update, state.matchLock);
            const next = transaction.value;
            if (!transaction.committed) {
              return {
                committed: false,
                snapshot: fakeSnapshot(next),
              };
            }
            state.matchLock = next;
            return {
              committed: true,
              snapshot: fakeSnapshot(next),
            };
          },
        };
      }
      throw new Error(`Unexpected realtime path: ${targetPath}`);
    },
  };
  return { realtime, state };
}

function createFakeQueueRealtime(queue, beforeTransaction = () => {}) {
  const state = {
    queue: structuredClone(queue),
    queryCalls: [],
  };
  return {
    state,
    realtime: {
      ref(targetPath) {
        if (targetPath === "online/trainingQueue") {
          const queryState = {
            cutoff: Number.MAX_SAFE_INTEGER,
            limit: Number.MAX_SAFE_INTEGER,
          };
          return {
            orderByChild(child) {
              state.queryCalls.push(["orderByChild", child]);
              return this;
            },
            endAt(value) {
              queryState.cutoff = value;
              state.queryCalls.push(["endAt", value]);
              return this;
            },
            limitToFirst(value) {
              queryState.limit = value;
              state.queryCalls.push(["limitToFirst", value]);
              return this;
            },
            async get() {
              const entries = Object.entries(state.queue)
                .filter(([, value]) => (
                  Number(value?.lastSeen || 0) <= queryState.cutoff
                ))
                .sort((first, second) => (
                  Number(first[1]?.lastSeen || 0) - Number(second[1]?.lastSeen || 0)
                  || first[0].localeCompare(second[0])
                ))
                .slice(0, queryState.limit);
              return {
                forEach(callback) {
                  for (const [uid, value] of entries) {
                    callback(fakeSnapshot(structuredClone(value), uid));
                  }
                },
              };
            },
          };
        }
        if (targetPath.startsWith("online/trainingQueue/")) {
          const uid = targetPath.split("/").pop();
          return {
            async transaction(update) {
              beforeTransaction(state, uid);
              const current = state.queue[uid] == null
                ? null
                : structuredClone(state.queue[uid]);
              const transaction = runColdCacheTransaction(update, current);
              const next = transaction.value;
              if (!transaction.committed) {
                return {
                  committed: false,
                  snapshot: fakeSnapshot(next, uid),
                };
              }
              if (next === null) delete state.queue[uid];
              else state.queue[uid] = structuredClone(next);
              return {
                committed: true,
                snapshot: fakeSnapshot(next, uid),
              };
            },
          };
        }
        throw new Error(`Unexpected realtime path: ${targetPath}`);
      },
    },
  };
}

test("training cleanup retention boundaries protect fresh and live rooms", () => {
  assert.equal(TRAINING_ROOM_FINALIZED_RETENTION_MS, 24 * 60 * 60 * 1000);
  assert.equal(TRAINING_ROOM_TERMINAL_RETENTION_MS, 60 * 60 * 1000);
  const now = 10 * 24 * 60 * 60 * 1000;
  const finalized = {
    createdAt: now - 2 * 60 * 60 * 1000,
    serverFinalized: {
      finalizedAt: now - TRAINING_ROOM_FINALIZED_RETENTION_MS,
    },
  };
  assert.equal(
    trainingRoomCleanupDisposition(finalized, now).action,
    "delete",
  );
  finalized.serverFinalized.finalizedAt += 1;
  assert.equal(
    trainingRoomCleanupDisposition(finalized, now).action,
    "keep",
  );

  const destroyed = {
    createdAt: now - TRAINING_ROOM_TERMINAL_RETENTION_MS,
    status: "active",
    destroyed: {
      at: now - TRAINING_ROOM_TERMINAL_RETENTION_MS,
    },
  };
  assert.equal(
    trainingRoomCleanupDisposition(destroyed, now).reason,
    "destroyed",
  );
  destroyed.destroyed.at += 1;
  assert.equal(
    trainingRoomCleanupDisposition(destroyed, now).reason,
    "destroyed_grace",
  );

  const forming = {
    createdAt: now - TRAINING_ROOM_FORMING_STALE_MS,
    status: "forming",
  };
  assert.equal(
    trainingRoomCleanupDisposition(forming, now).reason,
    "stale_forming",
  );
  forming.createdAt += 1;
  assert.equal(
    trainingRoomCleanupDisposition(forming, now).reason,
    "forming",
  );

  const oldLive = activeRoom(now - TRAINING_ROOM_ACTIVE_STALE_MS, {
    presence: {
      alice: {
        online: true,
        updatedAt: now - TRAINING_ROOM_PRESENCE_FRESH_MS,
      },
    },
  });
  assert.equal(
    trainingRoomCleanupDisposition(oldLive, now).reason,
    "active",
  );
  oldLive.presence.alice.updatedAt -= 1;
  assert.equal(
    trainingRoomCleanupDisposition(oldLive, now).reason,
    "stale_active",
  );
});

test("cleanup recognizes legacy v1, three-set v2, and HP v3 terminal results", () => {
  const now = 12 * 24 * 60 * 60 * 1000;
  assert.equal(
    trainingRoomCleanupDisposition(surrenderedRoom(now), now).action,
    "finalize",
  );
  const startedAt = now - 30_000;
  const v2 = activeRoom(now - 60_000, {
    protocolVersion: 2,
    variant: "kitaeai_60_v2",
    carrotChoices: { alice: "mine", bob: "boost8" },
    turns: {
      1: {
        trainerUid: "alice",
        traineeUid: "bob",
        carrotChoice: "boost8",
        targetDurationMs: 70_000,
        imageOwnerUid: "alice",
        instruction: {
          exercise: "スクワット",
          completion: "60秒",
          command: "続けろ",
          bpm: 80,
          beatsPerRep: 2,
        },
        createdAt: startedAt - 100,
        startedAt,
        surrenderedAt: startedAt + 10_000,
      },
    },
  });
  assert.equal(trainingRoomCleanupDisposition(v2, now).action, "finalize");
  const v3Surrender = hpRoom(now, {
    surrendered: { uid: "alice", at: now - 1_000 },
  });
  assert.equal(
    trainingRoomCleanupDisposition(v3Surrender, now).action,
    "finalize",
  );
  const v3HealthStop = hpRoom(now, {
    destroyed: {
      by: "bob",
      at: now - 1_000,
      reason: "health_stop",
    },
  });
  assert.equal(
    trainingRoomCleanupDisposition(v3HealthStop, now).action,
    "finalize",
  );
});

test("old forming reservations without presence stop blocking account actions", () => {
  const now = 5_000_000;
  const room = {
    createdAt: now - TRAINING_FORMING_RESERVATION_MAX_AGE_MS,
    status: "forming",
    members: { alice: true, bob: true },
  };
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), true);
  room.createdAt -= 1;
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), false);

  room.status = "active";
  room.createdAt = now - TRAINING_ACTIVE_PRESENCE_GRACE_MS;
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), true);
  room.createdAt -= 1;
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), false);
  room.presence = { alice: { online: false, updatedAt: now } };
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), false);
  room.presence.alice.online = true;
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), true);
  room.serverFinalized = { finalizedAt: now };
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), false);
});

test("cleanup finalizes natural results before deleting and cleans only matching pointers", async () => {
  const now = 20 * 24 * 60 * 60 * 1000;
  const finalizedRoomId = "finalized-old";
  const naturalRoomId = "natural-final";
  const failureRoomId = "finalization-failure";
  const freshRoomId = "fresh-finalized";
  const rooms = {
    [finalizedRoomId]: {
      hostUid: "alice",
      guestUid: "bob",
      members: { alice: true, bob: true },
      createdAt: now - 25 * 60 * 60 * 1000,
      signals: { bob: { signal: { payload: "private" } } },
      serverFinalized: {
        finalizedAt: now - TRAINING_ROOM_FINALIZED_RETENTION_MS,
      },
    },
    [naturalRoomId]: surrenderedRoom(now),
    [failureRoomId]: surrenderedRoom(now, "-failure"),
    [freshRoomId]: {
      hostUid: "fresh-host",
      guestUid: "fresh-guest",
      members: { "fresh-host": true, "fresh-guest": true },
      createdAt: now - 60 * 60 * 1000,
      serverFinalized: {
        finalizedAt: now - TRAINING_ROOM_FINALIZED_RETENTION_MS + 1,
      },
    },
  };
  const { realtime, state } = createFakeRealtime({
    rooms,
    active: {
      alice: {
        roomId: finalizedRoomId,
        rooms: { [finalizedRoomId]: true },
      },
      bob: {
        roomId: "newer-room",
        rooms: { "newer-room": true },
      },
    },
    invites: {
      alice: {
        [finalizedRoomId]: { roomId: finalizedRoomId },
      },
      bob: {
        [finalizedRoomId]: { roomId: finalizedRoomId },
      },
    },
    matchLock: {
      uid: "alice",
      roomId: finalizedRoomId,
    },
  });
  const finalizeCalls = [];
  const cleanup = createTrainingRoomCleanup({
    realtime,
    finalizeRoom: async (request) => {
      finalizeCalls.push(request);
      if (request.roomId === failureRoomId) throw new Error("temporary");
      return { result: { status: "final" } };
    },
  });

  const result = await cleanup(now);

  assert.deepEqual(state.queryCalls, [
    ["orderByChild", "createdAt"],
    ["endAt", now],
    ["limitToFirst", TRAINING_ROOM_CLEANUP_BATCH_SIZE],
  ]);
  assert.equal(Object.hasOwn(state.rooms, finalizedRoomId), false);
  assert.equal(Object.hasOwn(state.rooms, naturalRoomId), true);
  assert.equal(Object.hasOwn(state.rooms, failureRoomId), true);
  assert.equal(Object.hasOwn(state.rooms, freshRoomId), true);
  assert.equal(Object.hasOwn(state.active, "alice"), false);
  assert.deepEqual(state.active.bob, {
    roomId: "newer-room",
    rooms: { "newer-room": true },
  });
  assert.equal(state.matchLock, null);
  assert.deepEqual(state.removedInvites.toSorted(), [
    `online/trainingInvites/alice/${finalizedRoomId}`,
    `online/trainingInvites/bob/${finalizedRoomId}`,
  ]);
  assert.deepEqual(
    finalizeCalls.map((entry) => entry.roomId).toSorted(),
    [failureRoomId, naturalRoomId].toSorted(),
  );
  assert.deepEqual(result, {
    examined: 4,
    finalized: 1,
    finalizationPending: 0,
    finalizationFailed: 1,
    tombstoned: 0,
    removed: 1,
    pointerFailures: 0,
    hasMore: false,
  });
});

test("stale rooms tombstone first, release matching pointers, and retry safely", async () => {
  const now = 30 * 24 * 60 * 60 * 1000;
  const roomId = "stale-active-room";
  const activePath = `online/trainingActive/alice/rooms/${roomId}`;
  const { realtime, state } = createFakeRealtime({
    rooms: {
      [roomId]: activeRoom(now - TRAINING_ROOM_ACTIVE_STALE_MS - 1),
    },
    active: {
      alice: { roomId, rooms: { [roomId]: true } },
      bob: { roomId, rooms: { [roomId]: true } },
    },
    invites: {
      alice: { [roomId]: { roomId } },
      bob: { [roomId]: { roomId } },
    },
    matchLock: { uid: "alice", roomId },
    failPaths: [activePath],
  });
  const cleanup = createTrainingRoomCleanup({
    realtime,
    finalizeRoom: async () => ({ result: { status: "pending" } }),
  });

  const first = await cleanup(now);
  assert.equal(first.tombstoned, 1);
  assert.equal(first.pointerFailures, 1);
  assert.equal(state.rooms[roomId].status, "expired");
  assert.deepEqual(state.rooms[roomId].destroyed, {
    by: "server-cleanup",
    at: now,
    reason: "stale_active",
  });
  assert.equal(Object.hasOwn(state.active, "alice"), true);
  assert.equal(Object.hasOwn(state.active, "bob"), false);
  assert.equal(state.matchLock, null);
  assert.deepEqual(state.removedInvites.toSorted(), [
    `online/trainingInvites/alice/${roomId}`,
    `online/trainingInvites/bob/${roomId}`,
  ]);

  state.failedPaths.delete(activePath);
  const retry = await cleanup(now + 5 * 60 * 1000);
  assert.equal(retry.removed, 0);
  assert.equal(retry.pointerFailures, 0);
  assert.equal(Object.hasOwn(state.active, "alice"), false);
  assert.equal(Object.hasOwn(state.rooms, roomId), true);

  const expired = await cleanup(now + TRAINING_ROOM_TERMINAL_RETENTION_MS);
  assert.equal(expired.removed, 1);
  assert.equal(Object.hasOwn(state.rooms, roomId), false);
});

test("cleanup cursor rotates beyond an unchanged oldest batch", async () => {
  const now = 40 * 24 * 60 * 60 * 1000;
  const rooms = {
    "room-a": activeRoom(now - 10, {
      presence: { alice: { online: true, updatedAt: now } },
    }),
    "room-b": activeRoom(now - 9, {
      presence: { alice: { online: true, updatedAt: now } },
    }),
    "room-c": activeRoom(now - 8, {
      presence: { alice: { online: true, updatedAt: now } },
    }),
  };
  const { realtime, state } = createFakeRealtime({ rooms });
  const cleanup = createTrainingRoomCleanup({
    realtime,
    batchSize: 2,
    finalizeRoom: async () => ({ result: { status: "pending" } }),
  });

  const first = await cleanup(now);
  assert.equal(first.examined, 2);
  assert.deepEqual(state.cursor, {
    createdAt: now - 9,
    roomId: "room-b",
    updatedAt: now,
  });
  const second = await cleanup(now);
  assert.equal(second.examined, 1);
  assert.equal(state.cursor, null);
  assert.deepEqual(
    state.queryCalls.filter((entry) => entry[0] === "startAfter"),
    [["startAfter", now - 9, "room-b"]],
  );
});

test("cold-cache queue cleanup removes stale rows and preserves a heartbeat race", async () => {
  assert.equal(TRAINING_QUEUE_CLEANUP_BATCH_SIZE, 100);
  assert.equal(TRAINING_QUEUE_STALE_MS, 10 * 60 * 1000);
  const now = 50 * 24 * 60 * 60 * 1000;
  const cutoff = now - TRAINING_QUEUE_STALE_MS;
  const queue = Object.fromEntries(Array.from({ length: 101 }, (_, index) => {
    const uid = `queue-${String(index).padStart(3, "0")}`;
    return [uid, {
      uid,
      sessionId: `session-${index}`,
      name: `PRIVATE-${index}`,
      intensity: "standard",
      lastSeen: cutoff - 1_000 + index,
    }];
  }));
  const { realtime, state } = createFakeQueueRealtime(
    queue,
    (currentState, uid) => {
      if (uid === "queue-000") currentState.queue[uid].lastSeen = now;
    },
  );
  const cleanup = createTrainingQueueCleanup({
    realtime,
    batchSize: 1_000,
  });
  const result = await cleanup(now);

  assert.deepEqual(result, {
    examined: 100,
    removed: 99,
    failures: 0,
    hasMore: true,
  });
  assert.equal(state.queue["queue-000"].name, "PRIVATE-0");
  assert.equal(Object.hasOwn(state.queue, "queue-001"), false);
  assert.equal(Object.hasOwn(state.queue, "queue-100"), true);
  assert.deepEqual(state.queryCalls.at(-1), ["limitToFirst", 100]);
});

test("scheduled cleanup and training-only active-session check are wired", () => {
  const source = fs.readFileSync(
    path.join(functionsRoot, "index.js"),
    "utf8",
  );
  assert.match(source, /createTrainingRoomCleanup/);
  assert.match(source, /createTrainingQueueCleanup/);
  assert.match(source, /finalizeTraining\(participantUid, roomId, \{/);
  assert.match(source, /maxRoomAgeMs: Number\.MAX_SAFE_INTEGER/);
  assert.match(
    source,
    /exports\.cleanupTrainingRooms = onSchedule\(\{[\s\S]*schedule: "every 5 minutes"[\s\S]*timeZone: "Asia\/Tokyo"/,
  );
  assert.match(source, /entry\.path === "trainingActive"/);
  assert.match(source, /trainingActiveSessionIsLive/);
  assert.match(source, /trainingActiveRoomIsLive/);
});
