"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");

const PROJECT_ID_ENV = "TRAINING_RTDB_REGRESSION_TEST_PROJECT_ID";
const emulatorHost = String(
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || "",
).trim();
const projectId = String(process.env[PROJECT_ID_ENV] || "").trim();
const runsAgainstSafeEmulator = /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)
  && /^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(projectId);

if (!runsAgainstSafeEmulator) {
  test("training RTDB regressions are opt-in and never use production", {
    skip: `set FIREBASE_DATABASE_EMULATOR_HOST and ${PROJECT_ID_ENV}=demo-*`,
  }, () => {});
} else {
  const {
    deleteApp,
    initializeApp,
  } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const {
    TRAINING_QUEUE_STALE_MS,
    createTrainingQueueCleanup,
  } = require("../training-room-cleanup");
  const {
    TRAINING_PROTOCOL_VERSION,
    TRAINING_VARIANT,
    deriveTrainingRoomResult,
  } = require("../training");
  const trainingSession = require("../training-session-v2");
  const {
    createTrainingSessionService,
  } = require("../training-session-service");

  const suiteId = crypto.randomUUID().replaceAll("-", "");
  const staleUid = `training-stale-${suiteId}`;
  const roomId = `training-room-${suiteId}`;
  const queuePath = `online/trainingQueue/${staleUid}`;
  const roomPath = `online/trainingRooms/${roomId}`;
  const v4HostUid = `v4-host-${suiteId}`;
  const v4GuestUid = `v4-guest-${suiteId}`;
  const v4Uids = [v4HostUid, v4GuestUid];
  const v4RoomIds = new Set();
  const now = 1_900_000_000_000;
  let writerApp;
  let cleanerApp;
  let writerDatabase;
  let cleanerDatabase;

  before(() => {
    const options = {
      projectId,
      databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    };
    writerApp = initializeApp(options, `training-rtdb-writer-${suiteId}`);
    cleanerApp = initializeApp(options, `training-rtdb-cleaner-${suiteId}`);
    writerDatabase = getDatabase(writerApp);
    cleanerDatabase = getDatabase(cleanerApp);
  });

  after(async () => {
    if (writerDatabase) {
      await Promise.allSettled([
        writerDatabase.ref(queuePath).remove(),
        writerDatabase.ref(roomPath).remove(),
        ...v4Uids.flatMap((uid) => [
          writerDatabase.ref(`online/trainingSessionClaims/${uid}`).remove(),
          writerDatabase.ref(`online/trainingQueueV4/${uid}`).remove(),
          writerDatabase.ref(`online/trainingActiveV4/${uid}`).remove(),
          writerDatabase.ref(`online/trainingOffersV4/${uid}`).remove(),
          writerDatabase.ref(`online/trainingMatchLocksV4/${uid}`).remove(),
          writerDatabase.ref(
            `online/trainingSessionActionRates/${
              crypto.createHash("sha256")
                .update("training-session-action-rate:v4:")
                .update(uid)
                .digest("hex")
            }`,
          ).remove(),
        ]),
        ...[...v4RoomIds].flatMap((candidateRoomId) => [
          writerDatabase.ref(`online/trainingRooms/${candidateRoomId}`).remove(),
          writerDatabase.ref(
            `online/trainingMatchPermitsV4/${candidateRoomId}`,
          ).remove(),
        ]),
      ]);
    }
    await Promise.allSettled(
      [cleanerApp, writerApp].filter(Boolean).map((app) => deleteApp(app)),
    );
  });

  test("queue cleanup commits through an Admin RTDB cold-cache null", async () => {
    const staleLastSeen = now - TRAINING_QUEUE_STALE_MS - 1;
    await writerDatabase.ref(queuePath).set({
      uid: staleUid,
      sessionId: `session-${suiteId}`,
      name: "STALE",
      intensity: "standard",
      lastSeen: staleLastSeen,
    });

    const transactionValues = [];
    const observedRealtime = {
      ref(path) {
        const reference = cleanerDatabase.ref(path);
        if (path !== queuePath) return reference;
        return {
          transaction(update) {
            return reference.transaction((current) => {
              transactionValues.push(current);
              return update(current);
            });
          },
        };
      },
    };
    const cleanup = createTrainingQueueCleanup({
      realtime: observedRealtime,
    });

    const result = await cleanup(now);

    assert.deepEqual(result, {
      examined: 1,
      removed: 1,
      failures: 0,
      hasMore: false,
    });
    assert.equal(
      transactionValues[0],
      null,
      "a fresh Admin app must expose the cold-cache transaction callback",
    );
    assert.equal(
      transactionValues.some((value) => value?.lastSeen === staleLastSeen),
      true,
      "the transaction must retry with the server value after its initial null",
    );
    assert.equal((await writerDatabase.ref(queuePath).get()).exists(), false);
  });

  test("Functions derives a V3 room after RTDB materializes indexed objects as sparse arrays", async () => {
    const hostUid = `host-${suiteId}`;
    const guestUid = `guest-${suiteId}`;
    const createdAt = now - 60_000;
    const roundCreatedAt = createdAt + 1_000;
    const drawnAt = roundCreatedAt + 1_000;
    const completedAt = drawnAt + 1_000;
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
        command: "無理のないフォームで続けろ",
        beatsPerRep: 4,
      },
      3: {
        exercise: "腹筋",
        completion: "最後まで続ける",
        command: "呼吸を止めずに続けろ",
        beatsPerRep: 8,
      },
    };
    const imageBpms = {
      1: 60,
      2: 80,
      3: 100,
      4: 120,
      5: 140,
    };
    const room = {
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      createdAt,
      status: "active",
      hostUid,
      guestUid,
      members: {
        [hostUid]: true,
        [guestUid]: true,
      },
      players: {
        [hostUid]: {
          uid: hostUid,
          name: "HOST",
          commandDeck,
          imageBpms,
        },
        [guestUid]: {
          uid: guestUid,
          name: "GUEST",
          commandDeck,
          imageBpms,
        },
      },
      accepted: {
        [hostUid]: true,
        [guestUid]: true,
      },
      rounds: {
        1: {
          createdAt: roundCreatedAt,
          draws: {
            [hostUid]: {
              imageIndex: 1,
              bpm: imageBpms[1],
              drawnAt,
            },
            [guestUid]: {
              imageIndex: 1,
              bpm: imageBpms[1],
              drawnAt,
            },
          },
          imageReceived: {
            [hostUid]: true,
            [guestUid]: true,
          },
          scores: {
            [hostUid]: 1,
            [guestUid]: 1,
          },
          completedAt,
        },
      },
    };

    await writerDatabase.ref(roomPath).set(room);
    const restored = (await cleanerDatabase.ref(roomPath).get()).val();

    for (const uid of [hostUid, guestUid]) {
      assert.equal(Array.isArray(restored.players[uid].commandDeck), true);
      assert.equal(Array.isArray(restored.players[uid].imageBpms), true);
      assert.equal(Object.hasOwn(restored.players[uid].commandDeck, "0"), false);
      assert.equal(Object.hasOwn(restored.players[uid].imageBpms, "0"), false);
    }
    assert.equal(Array.isArray(restored.rounds), true);
    assert.equal(Object.hasOwn(restored.rounds, "0"), false);

    const result = deriveTrainingRoomResult(restored, now);
    assert.equal(result.status, "pending");
    assert.equal(result.reason, "pending");
    assert.equal(result.roundCount, 1);
  });

  test("V4 queue flattening keeps two players after RTDB restores indexed maps as sparse arrays", async () => {
    const commandDeck = {
      1: {
        exercise: "スクワット",
        completion: "20回",
        command: "拍に合わせて続けろ",
        beatsPerRep: 2,
      },
      2: {
        exercise: "腕立て伏せ",
        completion: "15回",
        command: "無理のないフォームで続けろ",
        beatsPerRep: 4,
      },
      3: {
        exercise: "腹筋",
        completion: "10回",
        command: "呼吸を止めずに続けろ",
        beatsPerRep: 8,
      },
    };
    const imageBpms = { 1: 0, 2: 80, 3: 100, 4: 120, 5: 140 };
    const claims = {};
    const queue = {};
    for (const [index, uid] of v4Uids.entries()) {
      const sessionId = `session-${index}-${suiteId}`;
      const claim = {
        protocolVersion: trainingSession.TRAINING_SESSION_PROTOCOL_VERSION,
        sessionId,
        leaseToken: `lease-${index}-${suiteId}`,
        generation: `generation-${index}-${suiteId}`,
        claimedAt: now - 2_000,
        heartbeatAt: now - 1_000,
        expiresAt: now + trainingSession.TRAINING_SESSION_LEASE_TTL_MS,
      };
      const entry = {
        protocolVersion: trainingSession.TRAINING_SESSION_PROTOCOL_VERSION,
        trainingProtocolVersion: trainingSession.TRAINING_GAME_PROTOCOL_VERSION,
        variant: trainingSession.TRAINING_GAME_VARIANT,
        uid,
        sessionId,
        leaseToken: claim.leaseToken,
        generation: claim.generation,
        connectionGeneration: `connection-${index}-${suiteId}`,
        name: index === 0 ? "HOST" : "GUEST",
        intensity: "standard",
        commandDeck,
        imageBpms,
        joinedAt: now - 1_000,
        lastSeen: now,
        expiresAt: claim.expiresAt,
        state: "waiting",
      };
      await writerDatabase.ref(`online/trainingSessionClaims/${uid}`).set(claim);
      await writerDatabase.ref(`online/trainingQueueV4/${uid}/${sessionId}`).set(entry);
    }

    for (const uid of v4Uids) {
      claims[uid] = (await cleanerDatabase.ref(
        `online/trainingSessionClaims/${uid}`,
      ).get()).val();
      queue[uid] = (await cleanerDatabase.ref(
        `online/trainingQueueV4/${uid}`,
      ).get()).val();
      const restored = queue[uid][claims[uid].sessionId];
      assert.equal(Array.isArray(restored.commandDeck), true);
      assert.equal(Array.isArray(restored.imageBpms), true);
      assert.equal(Object.hasOwn(restored.commandDeck, "0"), false);
      assert.equal(Object.hasOwn(restored.imageBpms, "0"), false);
    }

    const fresh = trainingSession.flattenFreshTrainingQueueV4(
      queue,
      claims,
      now,
    );
    assert.deepEqual(Object.keys(fresh).sort(), [...v4Uids].sort());
    for (const uid of v4Uids) {
      assert.equal(Array.isArray(fresh[uid].commandDeck), false);
      assert.equal(Array.isArray(fresh[uid].imageBpms), false);
    }
    assert.equal(trainingSession.selectTrainingSessionMatch({
      requesterUid: v4HostUid,
      queue: fresh,
    })?.candidate.uid, v4GuestUid);

    class TestHttpsError extends Error {
      constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
      }
    }
    const service = createTrainingSessionService({
      realtime: cleanerDatabase,
      HttpsError: TestHttpsError,
      crypto,
      now: () => now,
    });
    const offered = await service.tryMatch(v4HostUid, {
      sessionId: claims[v4HostUid].sessionId,
      leaseToken: claims[v4HostUid].leaseToken,
      conditions: "",
    });
    assert.equal(offered.outcome, "offered");
    assert.equal(offered.role, "host");
    assert.equal(typeof offered.roomId, "string");
    v4RoomIds.add(offered.roomId);

    const accepted = await service.accept(v4GuestUid, {
      sessionId: claims[v4GuestUid].sessionId,
      leaseToken: claims[v4GuestUid].leaseToken,
      roomId: offered.roomId,
      conditions: "",
    });
    const failedAcceptState = accepted.accepted === true ? null : {
      accepted,
      room: (await cleanerDatabase.ref(
        `online/trainingRooms/${offered.roomId}`,
      ).get()).val(),
      hostActive: (await cleanerDatabase.ref(
        `online/trainingActiveV4/${v4HostUid}/${claims[v4HostUid].sessionId}`,
      ).get()).val(),
      guestActive: (await cleanerDatabase.ref(
        `online/trainingActiveV4/${v4GuestUid}/${claims[v4GuestUid].sessionId}`,
      ).get()).val(),
      hostQueue: (await cleanerDatabase.ref(
        `online/trainingQueueV4/${v4HostUid}/${claims[v4HostUid].sessionId}`,
      ).get()).val(),
      guestQueue: (await cleanerDatabase.ref(
        `online/trainingQueueV4/${v4GuestUid}/${claims[v4GuestUid].sessionId}`,
      ).get()).val(),
    };
    assert.equal(accepted.accepted, true, JSON.stringify(failedAcceptState));
    assert.equal(accepted.role, "guest");
    const activeRoom = (await cleanerDatabase.ref(
      `online/trainingRooms/${offered.roomId}`,
    ).get()).val();
    assert.equal(activeRoom.status, "active");
    assert.equal(
      trainingSession.trainingSessionRoomMatches(activeRoom, {
        uid: v4HostUid,
        sessionId: claims[v4HostUid].sessionId,
        generation: claims[v4HostUid].generation,
        roomId: offered.roomId,
      }),
      true,
    );
  });
}
