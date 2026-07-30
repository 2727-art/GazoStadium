"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, test } = require("node:test");

const RUN_FLAG = "RUN_TRAINING_V5_ADMIN_EMULATOR_TESTS";
const PROJECT_ID_ENV = "TRAINING_V5_ADMIN_EMULATOR_PROJECT_ID";
const runRequested = process.env[RUN_FLAG] === "1";
const projectId = String(process.env[PROJECT_ID_ENV] || "").trim();
const emulatorHost = String(
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || "",
).trim();
const safeEnvironment = runRequested
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)
  && /^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(projectId);

if (!safeEnvironment) {
  test("training V5 Admin cache regression is opt-in and never uses production", {
    skip: `set ${RUN_FLAG}=1, FIREBASE_DATABASE_EMULATOR_HOST, and ${PROJECT_ID_ENV}=demo-*`,
  }, () => {});
} else {
  const {
    deleteApp,
    initializeApp,
  } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const {
    PATHS,
    createTrainingSessionV5Service,
  } = require("../training-session-v5-service");

  class FakeHttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  const suiteId = crypto.randomUUID().replaceAll("-", "");
  const hostUid = `training-v5-host-${suiteId}`;
  const guestUid = `training-v5-guest-${suiteId}`;
  const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
  const apps = new Set();
  let roomId = "";

  function createApp(label) {
    const app = initializeApp(
      { projectId, databaseURL },
      `training-v5-${label}-${suiteId}`,
    );
    apps.add(app);
    return app;
  }

  async function disposeApp(app) {
    if (!app || !apps.has(app)) return;
    apps.delete(app);
    await deleteApp(app);
  }

  function identity(uid) {
    return {
      runId: `${uid}-run-token`,
      endpointId: `${uid}-endpoint-token`,
    };
  }

  function preparation(name) {
    return {
      name,
      intensity: "standard",
      conditions: "",
      commandDeck: {
        1: {
          exercise: "スクワット",
          completion: "20回",
          command: "一定のテンポで続ける",
          beatsPerRep: 2,
        },
        2: {
          exercise: "腹筋",
          completion: "15回",
          command: "呼吸を止めずに続ける",
          beatsPerRep: 4,
        },
        3: {
          exercise: "腕立て伏せ",
          completion: "10回",
          command: "無理のないフォームで続ける",
          beatsPerRep: 8,
        },
      },
      imageBpms: { 1: 0, 2: 80, 3: 100, 4: 120, 5: 140 },
      chatFrameId: "",
    };
  }

  function serviceFor(realtime, now) {
    return createTrainingSessionV5Service({
      realtime,
      HttpsError: FakeHttpsError,
      crypto,
      now,
    });
  }

  after(async () => {
    const cleanupApp = createApp("cleanup");
    const realtime = getDatabase(cleanupApp);
    await Promise.allSettled([
      roomId ? realtime.ref(`${PATHS.rooms}/${roomId}`).remove() : null,
      realtime.ref(`${PATHS.attempts}/${hostUid}`).remove(),
      realtime.ref(`${PATHS.attempts}/${guestUid}`).remove(),
      realtime.ref(PATHS.rates).remove(),
    ].filter(Boolean));
    await Promise.allSettled([...apps].map((app) => disposeApp(app)));
  });

  test("cold shared-cache null cannot terminalize parallel reconnect inspect and heartbeat", async () => {
    let clock = 1_900_000_000_000;
    const seedApp = createApp("seed");
    const seedRealtime = getDatabase(seedApp);
    const seedService = serviceFor(seedRealtime, () => clock);
    const hostIdentity = identity(hostUid);
    const guestIdentity = identity(guestUid);
    const hostStarted = await seedService.start(hostUid, {
      ...hostIdentity,
      preparation: preparation("HOST"),
    });
    const guestStarted = await seedService.start(guestUid, {
      ...guestIdentity,
      preparation: preparation("GUEST"),
    });
    const hostOwner = {
      ...hostIdentity,
      ownerEpoch: hostStarted.ownerEpoch,
    };
    const guestOwner = {
      ...guestIdentity,
      ownerEpoch: guestStarted.ownerEpoch,
    };
    const matched = await seedService.match(hostUid, hostOwner);
    assert.equal(matched.outcome, "active");
    roomId = matched.roomId;
    const roomPath = `${PATHS.rooms}/${roomId}`;
    const roomBefore = (await seedRealtime.ref(roomPath).get()).val();
    roomBefore.rounds[1].scores = {
      [hostUid]: 9,
      [guestUid]: 8,
    };
    roomBefore.rounds[1].commandChoices = {
      [guestUid]: {
        trainerUid: hostUid,
        cardIndex: 2,
        selectedAt: clock,
      },
    };
    await seedRealtime.ref(roomPath).set(roomBefore);

    const nextTransportEpoch = crypto.randomBytes(24).toString("base64url");
    await seedRealtime.ref(PATHS.attempts).transaction((current) => {
      if (current == null) return null;
      const next = { ...current };
      for (const uid of [hostUid, guestUid]) {
        next[uid] = {
          ...next[uid],
          revision: next[uid].revision + 1,
          updatedAt: ++clock,
          transportEpoch: nextTransportEpoch,
        };
      }
      return next;
    }, undefined, false);
    await disposeApp(seedApp);

    const freshApp = createApp("fresh");
    const freshRealtime = getDatabase(freshApp);
    const freshService = serviceFor(freshRealtime, () => ++clock);
    const roomRef = freshRealtime.ref(roomPath);
    const callbackValues = [];
    const speculativeTransaction = roomRef.transaction((current) => {
      callbackValues.push(current == null ? "null" : current.status);
      return current == null ? null : current;
    });
    const duringGetPromise = roomRef.get();
    const reconnectPromise = freshService.reconnect(hostUid, {
      ...hostOwner,
      roomAttemptId: matched.roomAttemptId,
      transportEpoch: matched.transportEpoch,
    });
    const inspectPromise = freshService.inspect(guestUid, guestOwner);
    const heartbeatPromise = freshService.heartbeat(hostUid, hostOwner);

    const [
      speculativeResult,
      duringGet,
      reconnectResult,
      inspectResult,
      heartbeatResult,
    ] = await Promise.all([
      speculativeTransaction,
      duringGetPromise,
      reconnectPromise,
      inspectPromise,
      heartbeatPromise,
    ]);

    assert.equal(duringGet.val(), null);
    assert.deepEqual(callbackValues, ["null", "active"]);
    assert.equal(speculativeResult.committed, true);
    assert.equal(speculativeResult.snapshot.val().status, "active");
    assert.ok(["active", "waiting"].includes(reconnectResult.outcome));
    assert.ok(["active", "waiting"].includes(inspectResult.outcome));
    assert.ok(["active", "waiting"].includes(heartbeatResult.outcome));

    const attempts = (await freshRealtime.ref(PATHS.attempts).get()).val();
    const roomAfter = (await roomRef.get()).val();
    assert.equal(attempts[hostUid].state, "active");
    assert.equal(attempts[guestUid].state, "active");
    assert.equal(attempts[hostUid].terminalReason, undefined);
    assert.equal(attempts[guestUid].terminalReason, undefined);
    assert.equal(attempts[hostUid].transportEpoch, nextTransportEpoch);
    assert.equal(attempts[guestUid].transportEpoch, nextTransportEpoch);
    assert.equal(roomAfter.status, "active");
    assert.equal(roomAfter.destroyed, undefined);
    assert.equal(roomAfter.serverFinalized, undefined);
    assert.equal(roomAfter.transportEpoch, nextTransportEpoch);
    assert.deepEqual(roomAfter.rounds, roomBefore.rounds);
  });
}
