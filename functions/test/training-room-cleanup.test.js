"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  TRAINING_ACTIVE_CLEANUP_BATCH_SIZE,
  TRAINING_ACTIVE_CLEANUP_COMMIT_MARGIN_MS,
  TRAINING_ACTIVE_CLEANUP_CURSOR_PATH,
  TRAINING_ACTIVE_CLEANUP_GUARD_MS,
  TRAINING_ACTIVE_CLEANUP_GUARDS_PATH,
  TRAINING_ACTIVE_PRESENCE_GRACE_MS,
  TRAINING_FORMING_RESERVATION_MAX_AGE_MS,
  TRAINING_ORPHAN_ACTIVE_GRACE_MS,
  TRAINING_QUEUE_CLEANUP_BATCH_SIZE,
  TRAINING_QUEUE_STALE_MS,
  TRAINING_ROOM_ACTIVE_STALE_MS,
  TRAINING_ROOM_CLEANUP_BATCH_SIZE,
  TRAINING_ROOM_FINALIZED_RETENTION_MS,
  TRAINING_ROOM_FORMING_STALE_MS,
  TRAINING_ROOM_PRESENCE_FRESH_MS,
  TRAINING_ROOM_TERMINAL_RETENTION_MS,
  createTrainingActiveCleanup,
  createTrainingQueueCleanup,
  createTrainingRoomCleanup,
  firebasePushIdTimestamp,
  trainingActiveRoomIsLive,
  trainingRoomHasFreshPresence,
  trainingRoomCleanupDisposition,
} = require("../training-room-cleanup");

test("session V2 presence protects the exact active training room", () => {
  const now = 1_720_000_000_000;
  const room = activeRoom(now - 30_000, {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    sessionProtocolVersion: 2,
    sessions: {
      alice: { sessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", generation: "a".repeat(22) },
      bob: { sessionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", generation: "b".repeat(22) },
    },
    presence: {},
    presenceV2: {
      alice: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
          online: true,
          updatedAt: now - 1_000,
        },
      },
    },
  });
  assert.equal(trainingRoomHasFreshPresence(room, now), true);
  assert.equal(trainingActiveRoomIsLive(room, "alice", now), true);
  assert.equal(trainingActiveRoomIsLive(room, "bob", now), true);
});

test("session V5 presence protects a long-running active training room", () => {
  const now = 1_720_000_000_000;
  const room = activeRoom(now - TRAINING_ROOM_ACTIVE_STALE_MS - 1, {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    sessionProtocolVersion: 5,
    signalingVersion: 5,
    presence: {},
    presenceV5: {
      alice: {
        "run-alice-12345678": {
          protocolVersion: 5,
          runId: "run-alice-12345678",
          online: true,
          updatedAt: now - 1_000,
        },
      },
    },
  });
  assert.equal(trainingRoomHasFreshPresence(room, now), true);
  assert.deepEqual(trainingRoomCleanupDisposition(room, now), {
    action: "keep",
    reason: "active",
    participantUid: "alice",
  });
});

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
  attemptsV5 = {},
  matchLock = null,
  cursor = null,
  failPaths = [],
}) {
  const state = {
    rooms: structuredClone(rooms),
    active: structuredClone(active),
    invites: structuredClone(invites),
    attemptsV5: structuredClone(attemptsV5),
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
          async get() {
            maybeFail(targetPath);
            return fakeSnapshot(
              state.rooms[roomId] == null
                ? null
                : structuredClone(state.rooms[roomId]),
              roomId,
            );
          },
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
      if (targetPath.startsWith("online/trainingAttemptsV5/")) {
        const uid = targetPath.split("/").pop();
        return {
          async transaction(update) {
            maybeFail(targetPath);
            const current = state.attemptsV5[uid] == null
              ? null
              : structuredClone(state.attemptsV5[uid]);
            const transaction = runColdCacheTransaction(update, current);
            const next = transaction.value;
            if (!transaction.committed) {
              return {
                committed: false,
                snapshot: fakeSnapshot(next, uid),
              };
            }
            if (next === null) delete state.attemptsV5[uid];
            else state.attemptsV5[uid] = structuredClone(next);
            return {
              committed: true,
              snapshot: fakeSnapshot(next, uid),
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

function createFakeActiveCleanupRealtime({
  active = {},
  rooms = {},
  matchLock = null,
  cursor = null,
  guards = {},
  beforeGet = async () => {},
  beforeTransaction = async () => {},
} = {}) {
  const state = {
    active: structuredClone(active),
    rooms: structuredClone(rooms),
    matchLock: structuredClone(matchLock),
    cursor: structuredClone(cursor),
    guards: structuredClone(guards),
    queryCalls: [],
    getCounts: {},
    transactionCounts: {},
  };

  const invokeGetHook = async (targetPath) => {
    state.getCounts[targetPath] = (state.getCounts[targetPath] || 0) + 1;
    await beforeGet(state, targetPath, state.getCounts[targetPath]);
  };
  const invokeTransactionHook = async (targetPath) => {
    state.transactionCounts[targetPath] =
      (state.transactionCounts[targetPath] || 0) + 1;
    await beforeTransaction(
      state,
      targetPath,
      state.transactionCounts[targetPath],
    );
  };

  const activeQuery = () => {
    const queryState = {
      afterUid: "",
      limit: Number.MAX_SAFE_INTEGER,
    };
    return {
      orderByKey() {
        state.queryCalls.push(["orderByKey"]);
        return this;
      },
      startAfter(uid) {
        queryState.afterUid = String(uid);
        state.queryCalls.push(["startAfter", uid]);
        return this;
      },
      limitToFirst(value) {
        queryState.limit = Number(value);
        state.queryCalls.push(["limitToFirst", value]);
        return this;
      },
      async get() {
        const targetPath = "online/trainingActive";
        await invokeGetHook(targetPath);
        const entries = Object.entries(state.active)
          .sort((first, second) => first[0].localeCompare(second[0]))
          .filter(([uid]) => !queryState.afterUid || uid > queryState.afterUid)
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
  };

  const realtime = {
    ref(targetPath) {
      if (targetPath === TRAINING_ACTIVE_CLEANUP_CURSOR_PATH) {
        return {
          async get() {
            await invokeGetHook(targetPath);
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
      if (targetPath === "online/trainingActive") return activeQuery();
      if (targetPath.startsWith("online/trainingActive/")) {
        const uid = targetPath.split("/").pop();
        return {
          async transaction(update) {
            await invokeTransactionHook(targetPath);
            const current = state.active[uid] == null
              ? null
              : structuredClone(state.active[uid]);
            const transaction = runColdCacheTransaction(update, current);
            const next = transaction.value;
            if (!transaction.committed) {
              return {
                committed: false,
                snapshot: fakeSnapshot(next, uid),
              };
            }
            if (next === null) delete state.active[uid];
            else state.active[uid] = structuredClone(next);
            return {
              committed: true,
              snapshot: fakeSnapshot(next, uid),
            };
          },
        };
      }
      if (targetPath.startsWith(`${TRAINING_ACTIVE_CLEANUP_GUARDS_PATH}/`)) {
        const roomId = targetPath.split("/").pop();
        return {
          async get() {
            await invokeGetHook(targetPath);
            const guard = state.guards[roomId] == null
              ? null
              : structuredClone(state.guards[roomId]);
            return fakeSnapshot(guard, roomId);
          },
          async transaction(update) {
            await invokeTransactionHook(targetPath);
            const current = state.guards[roomId] == null
              ? null
              : structuredClone(state.guards[roomId]);
            const transaction = runColdCacheTransaction(update, current);
            const next = transaction.value;
            if (!transaction.committed) {
              return {
                committed: false,
                snapshot: fakeSnapshot(next, roomId),
              };
            }
            if (next === null) delete state.guards[roomId];
            else state.guards[roomId] = structuredClone(next);
            return {
              committed: true,
              snapshot: fakeSnapshot(next, roomId),
            };
          },
        };
      }
      if (targetPath.startsWith("online/trainingRooms/")) {
        const roomId = targetPath.split("/").pop();
        return {
          async get() {
            await invokeGetHook(targetPath);
            const room = state.rooms[roomId] == null
              ? null
              : structuredClone(state.rooms[roomId]);
            return fakeSnapshot(room, roomId);
          },
        };
      }
      if (targetPath === "online/trainingMatchLock") {
        return {
          async get() {
            await invokeGetHook(targetPath);
            return fakeSnapshot(structuredClone(state.matchLock));
          },
        };
      }
      throw new Error(`Unexpected realtime path: ${targetPath}`);
    },
  };
  return { realtime, state };
}

const FIREBASE_PUSH_ID_ALPHABET =
  "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

function firebasePushIdAt(timestamp, suffix = "aaaaaaaaaaaa") {
  let remaining = Number(timestamp);
  const prefix = Array(8);
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    prefix[index] = FIREBASE_PUSH_ID_ALPHABET[remaining % 64];
    remaining = Math.floor(remaining / 64);
  }
  assert.equal(remaining, 0);
  assert.match(suffix, /^[A-Za-z0-9_-]{12}$/);
  return `${prefix.join("")}${suffix}`;
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
      state.rooms[request.roomId].serverFinalized = {
        finalizedAt: request.now,
      };
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

test("natural V5 finalization reloads the finalized room before terminating attempts", async () => {
  const now = 25 * 24 * 60 * 60 * 1000;
  const roomId = "natural-v5-final";
  const roomAttemptId = "room-attempt-12345678";
  const transportEpoch = "transport-12345678";
  const identities = {
    alice: {
      runId: "run-alice-12345678",
      endpointId: "endpoint-alice-12345678",
      ownerEpoch: "owner-alice-12345678",
    },
    bob: {
      runId: "run-bob-12345678",
      endpointId: "endpoint-bob-12345678",
      ownerEpoch: "owner-bob-12345678",
    },
  };
  const room = surrenderedRoom(now);
  Object.assign(room, {
    sessionProtocolVersion: 5,
    signalingVersion: 5,
    roomAttemptId,
    transportEpoch,
    sessions: structuredClone(identities),
  });
  const attemptsV5 = Object.fromEntries(
    Object.entries(identities).map(([uid, identity], index) => ([
      uid,
      {
        protocolVersion: 5,
        uid,
        ...identity,
        revision: index + 4,
        state: "active",
        roomId,
        roomAttemptId,
        transportEpoch,
        role: uid === "alice" ? "host" : "guest",
        opponentUid: uid === "alice" ? "bob" : "alice",
        reservedAt: now - 30_000,
        updatedAt: now - 1_000,
        lastSeen: now - 1_000,
      },
    ])),
  );
  const { realtime, state } = createFakeRealtime({
    rooms: { [roomId]: room },
    attemptsV5,
  });
  const cleanup = createTrainingRoomCleanup({
    realtime,
    finalizeRoom: async (request) => {
      assert.equal(request.roomId, roomId);
      state.rooms[roomId].serverFinalized = {
        finalizedAt: request.now,
      };
      return { result: { status: "final" } };
    },
  });

  const result = await cleanup(now);

  assert.equal(result.finalized, 1);
  assert.equal(result.pointerFailures, 0);
  for (const [uid, original] of Object.entries(attemptsV5)) {
    const terminal = state.attemptsV5[uid];
    assert.equal(terminal.state, "terminal");
    assert.equal(terminal.terminalReason, "server_finalized");
    assert.equal(terminal.revision, original.revision + 1);
    assert.equal(terminal.updatedAt, now);
    assert.equal(terminal.lastSeen, now);
    assert.equal(terminal.queueExpiresAt, 0);
    assert.equal(Object.hasOwn(terminal, "roomId"), false);
    assert.equal(Object.hasOwn(terminal, "roomAttemptId"), false);
    assert.equal(Object.hasOwn(terminal, "transportEpoch"), false);
  }
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

test("active cleanup removes an exact old orphan only after the five-minute grace", async () => {
  assert.equal(TRAINING_ACTIVE_CLEANUP_BATCH_SIZE, 10);
  assert.equal(TRAINING_ORPHAN_ACTIVE_GRACE_MS, 5 * 60 * 1000);
  const now = Date.UTC(2026, 6, 28, 10, 0, 0);
  const cutoff = now - TRAINING_ORPHAN_ACTIVE_GRACE_MS;
  const oldRoomId = "old-orphan-room";
  const recentRoomId = "recent-orphan-room";
  const { realtime, state } = createFakeActiveCleanupRealtime({
    active: {
      "old-user": {
        roomId: oldRoomId,
        rooms: { [oldRoomId]: true },
        reservedAt: cutoff,
      },
      "recent-user": {
        roomId: recentRoomId,
        rooms: { [recentRoomId]: true },
        reservedAt: cutoff + 1,
      },
    },
  });
  const cleanup = createTrainingActiveCleanup({ realtime, clock: () => now });

  const result = await cleanup(now);

  assert.equal(result.examined, 2);
  assert.equal(result.claimsExamined, 2);
  assert.equal(result.removed, 1);
  assert.equal(result.protectedRecent, 1);
  assert.equal(result.failures, 0);
  assert.equal(Object.hasOwn(state.active, "old-user"), false);
  assert.deepEqual(state.active["recent-user"], {
    roomId: recentRoomId,
    rooms: { [recentRoomId]: true },
    reservedAt: cutoff + 1,
  });
  assert.deepEqual(state.guards, {});
  assert.equal(state.cursor, null);
  assert.deepEqual(state.queryCalls, [
    ["orderByKey"],
    ["limitToFirst", TRAINING_ACTIVE_CLEANUP_BATCH_SIZE],
  ]);
});

test("active cleanup preserves reservations with a room or a live matching lock", async () => {
  const now = Date.UTC(2026, 6, 28, 10, 5, 0);
  const reservedAt = now - TRAINING_ORPHAN_ACTIVE_GRACE_MS - 1;
  const existingRoomId = "existing-training-room";
  const lockedRoomId = "locked-training-room";
  const active = {
    "room-user": {
      roomId: existingRoomId,
      rooms: { [existingRoomId]: true },
      reservedAt,
    },
    "lock-user": {
      roomId: lockedRoomId,
      rooms: { [lockedRoomId]: true },
      reservedAt,
    },
  };
  const { realtime, state } = createFakeActiveCleanupRealtime({
    active,
    rooms: {
      [existingRoomId]: {
        createdAt: now - 1_000,
        status: "forming",
      },
    },
    matchLock: {
      uid: "lock-user",
      roomId: lockedRoomId,
      expiresAt: now + 1,
    },
  });
  const cleanup = createTrainingActiveCleanup({ realtime, clock: () => now });

  const result = await cleanup(now);

  assert.equal(result.removed, 0);
  assert.equal(result.protectedRoom, 1);
  assert.equal(result.protectedLock, 1);
  assert.equal(result.protectedRace, 0);
  assert.deepEqual(state.active, active);
  assert.deepEqual(state.guards, {});
});

test("active cleanup migrates legacy push-ID timestamps and fails closed without one", async () => {
  const now = Date.UTC(2026, 6, 28, 10, 10, 0);
  const oldTimestamp = now - TRAINING_ORPHAN_ACTIVE_GRACE_MS;
  const recentTimestamp = oldTimestamp + 1;
  const oldRoomId = firebasePushIdAt(oldTimestamp, "aaaaaaaaaaaa");
  const recentRoomId = firebasePushIdAt(recentTimestamp, "bbbbbbbbbbbb");
  const unknownTimestampRoomId = "legacy-without-time";
  assert.equal(firebasePushIdTimestamp(oldRoomId), oldTimestamp);
  assert.equal(firebasePushIdTimestamp(recentRoomId), recentTimestamp);
  assert.equal(firebasePushIdTimestamp(unknownTimestampRoomId), 0);
  const { realtime, state } = createFakeActiveCleanupRealtime({
    active: {
      "old-legacy-user": {
        roomId: oldRoomId,
        rooms: { [oldRoomId]: true },
      },
      "recent-legacy-user": {
        roomId: recentRoomId,
        rooms: { [recentRoomId]: true },
      },
      "unknown-legacy-user": {
        roomId: unknownTimestampRoomId,
        rooms: { [unknownTimestampRoomId]: true },
      },
    },
  });
  const cleanup = createTrainingActiveCleanup({ realtime, clock: () => now });

  const result = await cleanup(now);

  assert.equal(result.examined, 3);
  assert.equal(result.claimsExamined, 3);
  assert.equal(result.removed, 1);
  assert.equal(result.protectedRecent, 2);
  assert.equal(Object.hasOwn(state.active, "old-legacy-user"), false);
  assert.equal(Object.hasOwn(state.active, "recent-legacy-user"), true);
  assert.equal(Object.hasOwn(state.active, "unknown-legacy-user"), true);
});

test("active cleanup guard protects a room-created race", async () => {
  const now = Date.UTC(2026, 6, 28, 10, 15, 0);
  const roomId = "guarded-room-race";
  const reservation = {
    roomId,
    rooms: { [roomId]: true },
    reservedAt: now - TRAINING_ORPHAN_ACTIVE_GRACE_MS - 1,
  };
  const roomPath = `online/trainingRooms/${roomId}`;
  const { realtime, state } = createFakeActiveCleanupRealtime({
    active: { alice: reservation },
    beforeGet(currentState, targetPath, count) {
      if (targetPath === roomPath && count === 2) {
        currentState.rooms[roomId] = {
          createdAt: now,
          status: "forming",
        };
      }
    },
  });
  const cleanup = createTrainingActiveCleanup({ realtime, clock: () => now });

  const result = await cleanup(now);

  assert.equal(result.removed, 0);
  assert.equal(result.protectedRoom, 1);
  assert.equal(result.protectedRace, 0);
  assert.deepEqual(state.active.alice, reservation);
  assert.equal(Object.hasOwn(state.rooms, roomId), true);
  assert.deepEqual(state.guards, {});
  assert.equal(
    state.transactionCounts[
      `${TRAINING_ACTIVE_CLEANUP_GUARDS_PATH}/${roomId}`
    ],
    2,
  );
});

test("active cleanup fails closed when its guard loses the commit margin", async () => {
  const now = Date.UTC(2026, 6, 28, 10, 17, 0);
  const roomId = "expiring-guard-room";
  const reservation = {
    roomId,
    rooms: { [roomId]: true },
    reservedAt: now - TRAINING_ORPHAN_ACTIVE_GRACE_MS - 1,
  };
  let clockNow = now;
  const guardPath = `${TRAINING_ACTIVE_CLEANUP_GUARDS_PATH}/${roomId}`;
  const { realtime, state } = createFakeActiveCleanupRealtime({
    active: { alice: reservation },
    beforeGet(_state, targetPath) {
      if (targetPath === guardPath) {
        clockNow = now
          + TRAINING_ACTIVE_CLEANUP_GUARD_MS
          - TRAINING_ACTIVE_CLEANUP_COMMIT_MARGIN_MS
          + 1;
      }
    },
  });
  const cleanup = createTrainingActiveCleanup({
    realtime,
    clock: () => clockNow,
  });

  const result = await cleanup(now);

  assert.equal(result.removed, 0);
  assert.equal(result.protectedRace, 1);
  assert.deepEqual(state.active.alice, reservation);
  assert.deepEqual(state.guards, {});
});

test("active cleanup exact CAS preserves a replacement reservation", async () => {
  const now = Date.UTC(2026, 6, 28, 10, 20, 0);
  const oldRoomId = "old-raced-room";
  const newRoomId = "replacement-room";
  const replacement = {
    roomId: newRoomId,
    rooms: { [newRoomId]: true },
    reservedAt: now,
  };
  const activePath = "online/trainingActive/alice";
  const { realtime, state } = createFakeActiveCleanupRealtime({
    active: {
      alice: {
        roomId: oldRoomId,
        rooms: { [oldRoomId]: true },
        reservedAt: now - TRAINING_ORPHAN_ACTIVE_GRACE_MS - 1,
      },
    },
    beforeTransaction(currentState, targetPath, count) {
      if (targetPath === activePath && count === 1) {
        currentState.active.alice = structuredClone(replacement);
      }
    },
  });
  const cleanup = createTrainingActiveCleanup({ realtime, clock: () => now });

  const result = await cleanup(now);

  assert.equal(result.removed, 0);
  assert.equal(result.protectedRace, 1);
  assert.deepEqual(state.active.alice, replacement);
  assert.deepEqual(state.guards, {});
});

test("active cleanup cursor rotates beyond an unchanged protected batch", async () => {
  const now = Date.UTC(2026, 6, 28, 10, 25, 0);
  const reservedAt = now - TRAINING_ORPHAN_ACTIVE_GRACE_MS - 1;
  const entries = [
    ["active-a", "room-a"],
    ["active-b", "room-b"],
    ["active-c", "room-c"],
  ];
  const active = Object.fromEntries(entries.map(([uid, roomId]) => [
    uid,
    {
      roomId,
      rooms: { [roomId]: true },
      reservedAt,
    },
  ]));
  const rooms = Object.fromEntries(entries.map(([, roomId]) => [
    roomId,
    { createdAt: now, status: "forming" },
  ]));
  const { realtime, state } = createFakeActiveCleanupRealtime({
    active,
    rooms,
  });
  const cleanup = createTrainingActiveCleanup({
    realtime,
    batchSize: 2,
    clock: () => now,
  });

  const first = await cleanup(now);
  assert.equal(first.examined, 2);
  assert.equal(first.protectedRoom, 2);
  assert.equal(first.hasMore, true);
  assert.deepEqual(state.cursor, {
    uid: "active-b",
    updatedAt: now,
  });

  const second = await cleanup(now);
  assert.equal(second.examined, 1);
  assert.equal(second.protectedRoom, 1);
  assert.equal(second.hasMore, false);
  assert.equal(state.cursor, null);
  assert.deepEqual(
    state.queryCalls.filter((entry) => entry[0] === "startAfter"),
    [["startAfter", "active-b"]],
  );
  assert.deepEqual(state.active, active);
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
  const cleanupSource = fs.readFileSync(
    path.join(functionsRoot, "training-room-cleanup.js"),
    "utf8",
  );
  assert.match(source, /createTrainingRoomCleanup/);
  assert.match(source, /createTrainingSessionV5Cleanup/);
  assert.match(source, /createTrainingSessionResourceCleanup/);
  assert.match(
    source,
    /const cleanupTrainingSessionV5 = createTrainingSessionV5Cleanup\(\{\s*realtime,\s*\}\)/,
  );
  assert.match(source, /finalizeTraining\(participantUid, roomId, \{/);
  assert.match(source, /maxRoomAgeMs: Number\.MAX_SAFE_INTEGER/);
  assert.match(
    source,
    /exports\.cleanupTrainingRooms = onSchedule\(\{[\s\S]*schedule: "every 5 minutes"[\s\S]*timeZone: "Asia\/Tokyo"/,
  );
  assert.match(
    source,
    /await reconcilePendingTrainingV6Finalizations\(now\)/,
  );
  assert.match(
    source,
    /const \[rooms, attempts, retiredResources, trainingV6Cleanup\] = await Promise\.all\(\[[\s\S]*cleanupTrainingSessionV5\(now\),[\s\S]*cleanupTrainingSessionResources\(now\),[\s\S]*trainingSessionV6Service\.cleanup\(now\)/,
  );
  assert.match(
    source,
    /trainingV6:\s*\{\s*finalizations:\s*trainingV6Finalizations,\s*cleanup:\s*trainingV6Cleanup/,
  );
  assert.match(source, /online\/trainingAttemptsV5/);
  assert.match(source, /entry\.path === "trainingActive"/);
  assert.match(source, /trainingActiveSessionIsLive/);
  assert.match(source, /trainingActiveRoomIsLive/);
  assert.match(
    cleanupSource,
    /"transportEpoch",\s*"reservedAt",\s*"role",\s*"opponentUid"/,
  );
});
