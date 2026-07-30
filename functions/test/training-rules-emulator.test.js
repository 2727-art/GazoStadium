"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  get,
  ref,
  remove,
  set,
  update,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = String(
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || "",
).trim();
const projectId = String(
  process.env.TRAINING_RULES_TEST_PROJECT_ID || "demo-training-rules",
).trim();
const runsAgainstSafeEmulator = /^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/
  .test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);
const optInMessage =
  "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID";

function token(label) {
  return `${label.replace(/[^A-Za-z0-9_-]/g, "_")}_000000000000000000000000`
    .slice(0, 32);
}

function commandDeck() {
  return {
    1: {
      exercise: "スクワット",
      completion: "60秒続ける",
      command: "リズムに合わせてスクワット",
      beatsPerRep: 2,
    },
    2: {
      exercise: "腕立て伏せ",
      completion: "姿勢を保って続ける",
      command: "無理のないフォームで腕立て伏せ",
      beatsPerRep: 4,
    },
    3: {
      exercise: "腹筋",
      completion: "呼吸を止めずに続ける",
      command: "8拍ごとに丁寧な腹筋",
      beatsPerRep: 8,
    },
  };
}

function imageBpms() {
  return {
    1: 80,
    2: 90,
    3: 100,
    4: 120,
    5: 160,
  };
}

function preparation(name) {
  return {
    name,
    intensity: "standard",
    conditions: "",
    commandDeck: commandDeck(),
    imageBpms: imageBpms(),
    chatFrameId: "",
  };
}

function player(uid, name) {
  const prepared = preparation(name);
  return {
    uid,
    name: prepared.name,
    intensity: prepared.intensity,
    conditions: prepared.conditions,
    commandDeck: prepared.commandDeck,
    imageBpms: prepared.imageBpms,
  };
}

function activeAttempt({
  uid,
  runId,
  endpointId,
  ownerEpoch,
  opponentUid,
  role,
  roomId,
  roomAttemptId,
  transportEpoch,
  name,
  now,
}) {
  return {
    protocolVersion: 5,
    signalingVersion: 5,
    uid,
    runId,
    endpointId,
    ownerEpoch,
    revision: 2,
    state: "active",
    preparation: preparation(name),
    createdAt: now,
    updatedAt: now,
    lastSeen: now,
    queueExpiresAt: now + 180_000,
    roomId,
    roomAttemptId,
    transportEpoch,
    role,
    opponentUid,
  };
}

function trainingSessionV5Fixture(now = Date.now()) {
  const hostUid = "training-v5-host";
  const guestUid = "training-v5-guest";
  const roomId = "-V5RulesRoom00000001";
  const roomAttemptId = token("room-attempt");
  const transportEpoch = token("transport-epoch");
  const hostRunId = token("host-run");
  const guestRunId = token("guest-run");
  const hostEndpointId = token("host-endpoint");
  const guestEndpointId = token("guest-endpoint");
  const hostOwnerEpoch = token("host-owner");
  const guestOwnerEpoch = token("guest-owner");
  assert.equal(roomId.length, 20);
  const identities = {
    [hostUid]: {
      runId: hostRunId,
      endpointId: hostEndpointId,
      ownerEpoch: hostOwnerEpoch,
    },
    [guestUid]: {
      runId: guestRunId,
      endpointId: guestEndpointId,
      ownerEpoch: guestOwnerEpoch,
    },
  };
  const attempts = {
    [hostUid]: activeAttempt({
      uid: hostUid,
      ...identities[hostUid],
      opponentUid: guestUid,
      role: "host",
      roomId,
      roomAttemptId,
      transportEpoch,
      name: "V5 HOST",
      now,
    }),
    [guestUid]: activeAttempt({
      uid: guestUid,
      ...identities[guestUid],
      opponentUid: hostUid,
      role: "guest",
      roomId,
      roomAttemptId,
      transportEpoch,
      name: "V5 GUEST",
      now,
    }),
  };
  const room = {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    sessionProtocolVersion: 5,
    signalingVersion: 5,
    roomAttemptId,
    transportEpoch,
    hostUid,
    guestUid,
    createdAt: now,
    activatedAt: now,
    status: "active",
    sessions: identities,
    members: {
      [hostUid]: true,
      [guestUid]: true,
    },
    players: {
      [hostUid]: player(hostUid, "V5 HOST"),
      [guestUid]: player(guestUid, "V5 GUEST"),
    },
    chatFrames: {
      [hostUid]: "",
      [guestUid]: "",
    },
    accepted: {
      [hostUid]: true,
      [guestUid]: true,
    },
    rounds: {
      1: { createdAt: now },
    },
  };
  return {
    hostUid,
    guestUid,
    roomId,
    roomAttemptId,
    transportEpoch,
    hostRunId,
    guestRunId,
    hostEndpointId,
    guestEndpointId,
    hostOwnerEpoch,
    guestOwnerEpoch,
    attempts,
    room,
  };
}

function presencePayload(fixture, overrides = {}) {
  return {
    protocolVersion: 5,
    runId: fixture.hostRunId,
    endpointId: fixture.hostEndpointId,
    ownerEpoch: fixture.hostOwnerEpoch,
    roomAttemptId: fixture.roomAttemptId,
    transportEpoch: fixture.transportEpoch,
    online: true,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function signalPayload(fixture, overrides = {}) {
  return {
    protocolVersion: 5,
    roomAttemptId: fixture.roomAttemptId,
    transportEpoch: fixture.transportEpoch,
    fromUid: fixture.hostUid,
    toUid: fixture.guestUid,
    fromRunId: fixture.hostRunId,
    toRunId: fixture.guestRunId,
    fromEndpointId: fixture.hostEndpointId,
    toEndpointId: fixture.guestEndpointId,
    type: "offer",
    payload: JSON.stringify({ type: "offer", sdp: "v=0" }),
    createdAt: Date.now(),
    ...overrides,
  };
}

async function createEnvironment(context) {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  await environment.clearDatabase();
  context.after(async () => {
    await environment.clearDatabase();
    await environment.cleanup();
  });
  return environment;
}

async function seedFixture(environment, fixture) {
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await update(ref(adminContext.database(), "online"), {
      trainingAttemptsV5: fixture.attempts,
      [`trainingRooms/${fixture.roomId}`]: fixture.room,
    });
  });
}

async function adminSet(environment, targetPath, value) {
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await set(ref(adminContext.database(), targetPath), value);
  });
}

test("training V5 Rules enforce canonical attempts, room fences, and retired paths", {
  skip: runsAgainstSafeEmulator ? false : optInMessage,
}, async (context) => {
  const environment = await createEnvironment(context);
  const fixture = trainingSessionV5Fixture();
  await seedFixture(environment, fixture);

  const hostDatabase = environment.authenticatedContext(
    fixture.hostUid,
  ).database();
  const guestDatabase = environment.authenticatedContext(
    fixture.guestUid,
  ).database();
  const outsiderDatabase = environment.authenticatedContext(
    "training-v5-outsider",
  ).database();

  const ownAttemptPath = `online/trainingAttemptsV5/${fixture.hostUid}`;
  await assertSucceeds(get(ref(hostDatabase, ownAttemptPath)));
  await assertFails(get(ref(guestDatabase, ownAttemptPath)));
  await assertFails(set(ref(hostDatabase, ownAttemptPath), fixture.attempts[
    fixture.hostUid
  ]));

  const hostPresencePath =
    `online/trainingRooms/${fixture.roomId}/presenceV5/${
      fixture.hostUid
    }/${fixture.hostRunId}`;
  await assertSucceeds(set(
    ref(hostDatabase, hostPresencePath),
    presencePayload(fixture),
  ));
  await assertSucceeds(get(ref(guestDatabase,
    `online/trainingRooms/${fixture.roomId}/presenceV5`)));
  await assertFails(get(ref(outsiderDatabase,
    `online/trainingRooms/${fixture.roomId}/presenceV5`)));

  const invalidPresenceCases = [
    ["ownerEpoch", token("wrong-owner")],
    ["endpointId", token("wrong-endpoint")],
    ["roomAttemptId", token("wrong-room-attempt")],
    ["transportEpoch", token("wrong-transport")],
  ];
  for (const [field, value] of invalidPresenceCases) {
    await assertFails(set(
      ref(hostDatabase, hostPresencePath),
      presencePayload(fixture, { [field]: value }),
    ));
  }
  const wrongRunId = token("wrong-run");
  await assertFails(set(
    ref(
      hostDatabase,
      `online/trainingRooms/${fixture.roomId}/presenceV5/${
        fixture.hostUid
      }/${wrongRunId}`,
    ),
    presencePayload(fixture, { runId: wrongRunId }),
  ));
  await assertFails(set(
    ref(guestDatabase, hostPresencePath),
    presencePayload(fixture),
  ));

  const signalBase =
    `online/trainingRooms/${fixture.roomId}/signalsV5/${
      fixture.guestUid
    }/${fixture.guestRunId}`;
  const validSignalPath = `${signalBase}/${token("signal-current")}`;
  const validSignal = signalPayload(fixture);
  await assertSucceeds(set(ref(hostDatabase, validSignalPath), validSignal));
  assert.equal(
    (await assertSucceeds(get(ref(guestDatabase, validSignalPath))))
      .val()?.roomAttemptId,
    fixture.roomAttemptId,
  );
  await assertFails(get(ref(hostDatabase, validSignalPath)));
  await assertFails(get(ref(outsiderDatabase, validSignalPath)));
  await assertFails(remove(ref(hostDatabase, validSignalPath)));

  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.guestUid}/ownerEpoch`,
    token("wrong-guest-owner"),
  );
  await assertFails(remove(ref(guestDatabase, validSignalPath)));
  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.guestUid}/ownerEpoch`,
    fixture.guestOwnerEpoch,
  );
  await assertSucceeds(remove(ref(guestDatabase, validSignalPath)));

  const staleSignalPath = `${signalBase}/${token("signal-old-epoch")}`;
  await assertSucceeds(set(
    ref(hostDatabase, staleSignalPath),
    signalPayload(fixture),
  ));
  const nextTransportEpoch = token("transport-next");
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await update(ref(adminContext.database(), "online"), {
      [`trainingAttemptsV5/${fixture.hostUid}/transportEpoch`]:
        nextTransportEpoch,
      [`trainingAttemptsV5/${fixture.guestUid}/transportEpoch`]:
        nextTransportEpoch,
      [`trainingRooms/${fixture.roomId}/transportEpoch`]:
        nextTransportEpoch,
    });
  });
  await assertSucceeds(remove(ref(guestDatabase, staleSignalPath)));
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await update(ref(adminContext.database(), "online"), {
      [`trainingAttemptsV5/${fixture.hostUid}/transportEpoch`]:
        fixture.transportEpoch,
      [`trainingAttemptsV5/${fixture.guestUid}/transportEpoch`]:
        fixture.transportEpoch,
      [`trainingRooms/${fixture.roomId}/transportEpoch`]:
        fixture.transportEpoch,
    });
  });

  const invalidSignalCases = [
    ["roomAttemptId", token("wrong-signal-room")],
    ["transportEpoch", token("wrong-signal-transport")],
    ["fromRunId", token("wrong-signal-from-run")],
    ["toRunId", token("wrong-signal-to-run")],
    ["fromEndpointId", token("wrong-signal-from-endpoint")],
    ["toEndpointId", token("wrong-signal-to-endpoint")],
  ];
  let invalidSignalIndex = 0;
  for (const [field, value] of invalidSignalCases) {
    invalidSignalIndex += 1;
    await assertFails(set(
      ref(
        hostDatabase,
        `${signalBase}/${token(`signal-invalid-${invalidSignalIndex}`)}`,
      ),
      signalPayload(fixture, { [field]: value }),
    ));
  }

  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.hostUid}/ownerEpoch`,
    token("wrong-host-owner"),
  );
  await assertFails(set(
    ref(hostDatabase, `${signalBase}/${token("signal-wrong-owner")}`),
    signalPayload(fixture),
  ));
  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.hostUid}/ownerEpoch`,
    fixture.hostOwnerEpoch,
  );

  const hostDrawPath =
    `online/trainingRooms/${fixture.roomId}/rounds/1/draws/${
      fixture.hostUid
    }`;
  await assertSucceeds(set(ref(hostDatabase, hostDrawPath), {
    imageIndex: 1,
    bpm: 80,
    drawnAt: Date.now(),
  }));

  const guestDrawPath =
    `online/trainingRooms/${fixture.roomId}/rounds/1/draws/${
      fixture.guestUid
    }`;
  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.guestUid}/transportEpoch`,
    token("wrong-gameplay-transport"),
  );
  await assertFails(set(ref(guestDatabase, guestDrawPath), {
    imageIndex: 1,
    bpm: 80,
    drawnAt: Date.now(),
  }));
  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.guestUid}/transportEpoch`,
    fixture.transportEpoch,
  );
  await assertSucceeds(set(ref(guestDatabase, guestDrawPath), {
    imageIndex: 1,
    bpm: 80,
    drawnAt: Date.now(),
  }));

  const hostReceiptPath =
    `online/trainingRooms/${fixture.roomId}/rounds/1/imageReceived/${
      fixture.hostUid
    }`;
  await assertSucceeds(set(ref(hostDatabase, hostReceiptPath), true));
  await assertSucceeds(set(ref(hostDatabase, hostReceiptPath), true));
  await assertFails(set(ref(guestDatabase, hostReceiptPath), true));
  await assertFails(set(ref(hostDatabase, hostReceiptPath), false));
  await assertFails(remove(ref(hostDatabase, hostReceiptPath)));
  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.hostUid}/transportEpoch`,
    token("wrong-receipt-transport"),
  );
  await assertFails(set(ref(hostDatabase, hostReceiptPath), true));
  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.hostUid}/transportEpoch`,
    fixture.transportEpoch,
  );

  const retiredWrites = [
    [
      hostDatabase,
      `online/trainingQueue/${fixture.hostUid}`,
      { uid: fixture.hostUid, state: "waiting", lastSeen: Date.now() },
    ],
    [
      hostDatabase,
      `online/trainingQueueV4/${fixture.hostUid}/${fixture.hostRunId}`,
      { uid: fixture.hostUid, state: "waiting", lastSeen: Date.now() },
    ],
    [
      hostDatabase,
      `online/trainingActiveV4/${fixture.hostUid}/${fixture.hostRunId}`,
      { uid: fixture.hostUid, roomId: fixture.roomId },
    ],
    [
      hostDatabase,
      `online/trainingRooms/${fixture.roomId}/presence/${fixture.hostUid}`,
      { online: true, updatedAt: Date.now() },
    ],
    [
      hostDatabase,
      `online/trainingRooms/${fixture.roomId}/presenceV2/${
        fixture.hostUid
      }/${fixture.hostRunId}`,
      {
        protocolVersion: 2,
        sessionId: fixture.hostRunId,
        leaseToken: token("legacy-lease"),
        generation: token("legacy-generation"),
        online: true,
        updatedAt: Date.now(),
      },
    ],
    [
      hostDatabase,
      `online/trainingRooms/${fixture.roomId}/signals/${
        fixture.guestUid
      }/${token("legacy-signal")}`,
      {
        fromUid: fixture.hostUid,
        type: "offer",
        payload: "legacy-offer",
        createdAt: Date.now(),
      },
    ],
    [
      hostDatabase,
      `online/trainingRooms/${fixture.roomId}/signalsV2/${
        fixture.guestUid
      }/${fixture.guestRunId}/${token("legacy-v2-signal")}`,
      {
        protocolVersion: 2,
        signalingVersion: 2,
        fromUid: fixture.hostUid,
        fromSessionId: fixture.hostRunId,
        toUid: fixture.guestUid,
        toSessionId: fixture.guestRunId,
        connectionGeneration: token("legacy-connection"),
        attemptId: token("legacy-attempt"),
        type: "offer",
        payload: "legacy-v2-offer",
        createdAt: Date.now(),
      },
    ],
  ];
  for (const [database, targetPath, value] of retiredWrites) {
    await assertFails(set(ref(database, targetPath), value));
  }
});

test("training V5 terminal members retain only the canonical finalized result read", {
  skip: runsAgainstSafeEmulator ? false : optInMessage,
}, async (context) => {
  const environment = await createEnvironment(context);
  const fixture = trainingSessionV5Fixture();
  await seedFixture(environment, fixture);

  const hostDatabase = environment.authenticatedContext(
    fixture.hostUid,
  ).database();
  const chatFramesPath =
    `online/trainingRooms/${fixture.roomId}/chatFrames`;
  const finalizedPath =
    `online/trainingRooms/${fixture.roomId}/serverFinalized`;

  await assertSucceeds(get(ref(hostDatabase, chatFramesPath)));
  await adminSet(environment, finalizedPath, {
    version: 1,
    at: Date.now(),
    reason: "hp_zero",
  });
  await adminSet(
    environment,
    `online/trainingAttemptsV5/${fixture.hostUid}/state`,
    "terminal",
  );

  await assertFails(get(ref(hostDatabase, chatFramesPath)));
  const finalized = await assertSucceeds(
    get(ref(hostDatabase, finalizedPath)),
  );
  assert.equal(finalized.val()?.reason, "hp_zero");
});
