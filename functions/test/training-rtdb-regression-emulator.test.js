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

  const suiteId = crypto.randomUUID().replaceAll("-", "");
  const staleUid = `training-stale-${suiteId}`;
  const roomId = `training-room-${suiteId}`;
  const queuePath = `online/trainingQueue/${staleUid}`;
  const roomPath = `online/trainingRooms/${roomId}`;
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
}
