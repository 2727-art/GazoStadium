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
  runTransaction,
  set,
  update,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.TRAINING_RULES_TEST_PROJECT_ID || "demo-training-rules";
const runsAgainstSafeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

function queueEntry(uid, name, now, overrides = {}) {
  return {
    uid,
    sessionId: `${uid}-session`,
    name,
    intensity: "standard",
    protocolVersion: 2,
    variant: "kitaeai_60_v2",
    joinedAt: now,
    lastSeen: now,
    state: "waiting",
    ...overrides,
  };
}

function player(entry, conditions = "") {
  return {
    uid: entry.uid,
    name: entry.name,
    intensity: entry.intensity,
    conditions,
  };
}

function roomPayload(host, guest, now, {
  hostConditions = "ジャンプは控えめ",
  guestConditions = "",
} = {}) {
  return {
    protocolVersion: 2,
    variant: "kitaeai_60_v2",
    hostUid: host.uid,
    guestUid: guest.uid,
    createdAt: now,
    status: "forming",
    firstTrainerUid: host.uid,
    members: {
      [host.uid]: true,
      [guest.uid]: true,
    },
    players: {
      [host.uid]: player(host, hostConditions),
      [guest.uid]: player(guest, guestConditions),
    },
    accepted: {
      [host.uid]: true,
    },
  };
}

function v3CommandDeck() {
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

function v3QueueEntry(uid, name, now, overrides = {}) {
  return {
    uid,
    sessionId: `${uid}-session`,
    name,
    intensity: "standard",
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    commandDeck: v3CommandDeck(),
    imageBpms: {
      1: 0,
      2: 80,
      3: 100,
      4: 120,
      5: 160,
    },
    joinedAt: now,
    lastSeen: now,
    state: "waiting",
    ...overrides,
  };
}

function v3Player(entry, conditions = "") {
  return {
    uid: entry.uid,
    name: entry.name,
    intensity: entry.intensity,
    conditions,
    commandDeck: entry.commandDeck,
    imageBpms: entry.imageBpms,
  };
}

function v3RoomPayload(host, guest, now, {
  hostConditions = "ジャンプは控えめ",
  guestConditions = "",
} = {}) {
  return {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    hostUid: host.uid,
    guestUid: guest.uid,
    createdAt: now,
    status: "forming",
    members: {
      [host.uid]: true,
      [guest.uid]: true,
    },
    players: {
      [host.uid]: v3Player(host, hostConditions),
      [guest.uid]: v3Player(guest, guestConditions),
    },
    accepted: {
      [host.uid]: true,
    },
  };
}

function instruction(overrides = {}) {
  return {
    exercise: "スクワット",
    completion: "60秒続ける",
    command: "メトロノームに合わせて続けてください",
    bpm: 80,
    beatsPerRep: 2,
    ...overrides,
  };
}

function activeReservation(roomId) {
  return {
    roomId,
    rooms: {
      [roomId]: true,
    },
  };
}

function matchLockPayload(uid, roomId, createdAt = Date.now(), ttlMs = 59_000) {
  return {
    uid,
    roomId,
    createdAt,
    expiresAt: createdAt + ttlMs,
  };
}

async function reserveActive(database, uid, roomId) {
  await assertSucceeds(set(
    ref(database, `online/trainingActive/${uid}`),
    activeReservation(roomId),
  ));
}

async function releaseActive(database, uid, roomId) {
  await assertSucceeds(remove(ref(
    database,
    `online/trainingActive/${uid}/rooms/${roomId}`,
  )));
  await assertSucceeds(runTransaction(
    ref(database, `online/trainingActive/${uid}`),
    (current) => {
      const rooms = current?.rooms && typeof current.rooms === "object"
        ? current.rooms
        : {};
      return current?.roomId === roomId && Object.keys(rooms).length === 0
        ? null
        : undefined;
    },
  ));
}

async function createEnvironment(context) {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());
  return environment;
}

async function createFormingRoom(environment, now, roomId) {
  const host = queueEntry("training-host", "HOST", now);
  const guest = queueEntry("training-guest", "GUEST", now, {
    intensity: "light",
  });
  const hostDatabase = environment.authenticatedContext(host.uid).database();
  const guestDatabase = environment.authenticatedContext(guest.uid).database();

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    const adminDatabase = contextWithoutRules.database();
    await Promise.all([
      remove(ref(adminDatabase, `online/trainingActive/${host.uid}`)),
      remove(ref(adminDatabase, `online/trainingActive/${guest.uid}`)),
      remove(ref(adminDatabase, `online/trainingQueue/${host.uid}`)),
      remove(ref(adminDatabase, `online/trainingQueue/${guest.uid}`)),
      remove(ref(adminDatabase, `online/trainingInvites/${host.uid}`)),
      remove(ref(adminDatabase, `online/trainingInvites/${guest.uid}`)),
    ]);
  });
  await assertSucceeds(set(ref(hostDatabase, `online/trainingQueue/${host.uid}`), host));
  await assertSucceeds(set(ref(guestDatabase, `online/trainingQueue/${guest.uid}`), guest));
  await assertSucceeds(set(
    ref(hostDatabase, "online/trainingMatchLock"),
    matchLockPayload(host.uid, roomId),
  ));
  await reserveActive(hostDatabase, host.uid, roomId);
  await assertSucceeds(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}`),
    roomPayload(host, guest, now),
  ));
  await assertSucceeds(update(
    ref(hostDatabase, `online/trainingQueue/${host.uid}`),
    { state: "forming" },
  ));
  const invitePath = `online/trainingInvites/${guest.uid}/${roomId}`;
  await assertSucceeds(set(ref(hostDatabase, invitePath), {
    roomId,
    hostUid: host.uid,
    targetSessionId: guest.sessionId,
    protocolVersion: 2,
    variant: "kitaeai_60_v2",
    createdAt: Date.now(),
  }));
  await assertSucceeds(remove(ref(
    hostDatabase,
    "online/trainingMatchLock",
  )));

  return {
    host,
    guest,
    hostDatabase,
    guestDatabase,
    invitePath,
    guestConditions: "ジャンプなし",
  };
}

async function bootstrapRoom(environment, now, roomId) {
  const room = await createFormingRoom(environment, now, roomId);
  await reserveActive(room.guestDatabase, room.guest.uid, roomId);
  await assertSucceeds(update(
    ref(room.guestDatabase, `online/trainingRooms/${roomId}`),
    {
      [`players/${room.guest.uid}/conditions`]: room.guestConditions,
      [`accepted/${room.guest.uid}`]: true,
    },
  ));
  await assertSucceeds(remove(ref(room.guestDatabase, room.invitePath)));
  await assertSucceeds(set(
    ref(room.hostDatabase, `online/trainingRooms/${roomId}/status`),
    "active",
  ));

  return room;
}

async function createV3FormingRoom(environment, now, roomId, suffix) {
  const host = v3QueueEntry(`training-v3-host-${suffix}`, "HP HOST", now);
  const guest = v3QueueEntry(`training-v3-guest-${suffix}`, "HP GUEST", now, {
    intensity: "light",
  });
  const hostDatabase = environment.authenticatedContext(host.uid).database();
  const guestDatabase = environment.authenticatedContext(guest.uid).database();

  await assertSucceeds(set(ref(hostDatabase, `online/trainingQueue/${host.uid}`), host));
  await assertSucceeds(set(ref(guestDatabase, `online/trainingQueue/${guest.uid}`), guest));
  await assertSucceeds(set(
    ref(hostDatabase, "online/trainingMatchLock"),
    matchLockPayload(host.uid, roomId),
  ));
  await reserveActive(hostDatabase, host.uid, roomId);
  await assertSucceeds(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}`),
    v3RoomPayload(host, guest, now),
  ));
  await assertSucceeds(update(
    ref(hostDatabase, `online/trainingQueue/${host.uid}`),
    { state: "forming" },
  ));
  const invitePath = `online/trainingInvites/${guest.uid}/${roomId}`;
  await assertSucceeds(set(ref(hostDatabase, invitePath), {
    roomId,
    hostUid: host.uid,
    targetSessionId: guest.sessionId,
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    createdAt: Date.now(),
  }));
  await assertSucceeds(remove(ref(hostDatabase, "online/trainingMatchLock")));

  return {
    host,
    guest,
    hostDatabase,
    guestDatabase,
    invitePath,
    guestConditions: "ジャンプなし",
  };
}

async function bootstrapV3Room(environment, now, roomId, suffix) {
  const room = await createV3FormingRoom(environment, now, roomId, suffix);
  await reserveActive(room.guestDatabase, room.guest.uid, roomId);
  await assertSucceeds(update(
    ref(room.guestDatabase, `online/trainingRooms/${roomId}`),
    {
      [`players/${room.guest.uid}/conditions`]: room.guestConditions,
      [`accepted/${room.guest.uid}`]: true,
    },
  ));
  await assertSucceeds(remove(ref(room.guestDatabase, room.invitePath)));
  await assertSucceeds(set(
    ref(room.hostDatabase, `online/trainingRooms/${roomId}/status`),
    "active",
  ));
  return room;
}

async function markBothImagesReceived(room, roomId) {
  await assertSucceeds(set(
    ref(
      room.hostDatabase,
      `online/trainingRooms/${roomId}/imageReceived/${room.host.uid}`,
    ),
    true,
  ));
  await assertSucceeds(set(
    ref(
      room.guestDatabase,
      `online/trainingRooms/${roomId}/imageReceived/${room.guest.uid}`,
    ),
    true,
  ));
}

async function chooseCarrots(room, roomId, {
  hostChoice = "mine",
  guestChoice = "boost8",
} = {}) {
  await assertSucceeds(set(
    ref(
      room.hostDatabase,
      `online/trainingRooms/${roomId}/carrotChoices/${room.host.uid}`,
    ),
    hostChoice,
  ));
  await assertSucceeds(set(
    ref(
      room.guestDatabase,
      `online/trainingRooms/${roomId}/carrotChoices/${room.guest.uid}`,
    ),
    guestChoice,
  ));
}

function v2Turn(trainerUid, traineeUid, carrotChoice, createdAt = Date.now()) {
  const targetDurationMs = {
    mine: 60_000,
    boost8: 70_000,
    boost9: 80_000,
    boost10: 90_000,
  }[carrotChoice];
  return {
    trainerUid,
    traineeUid,
    carrotChoice,
    targetDurationMs,
    imageOwnerUid: carrotChoice === "mine" ? traineeUid : trainerUid,
    instruction: instruction(),
    createdAt,
  };
}

async function setLegacyRoomProtocol(environment, roomId) {
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await update(
      ref(
        contextWithoutRules.database(),
        `online/trainingRooms/${roomId}`,
      ),
      {
        protocolVersion: 1,
        variant: "kitaeai_60",
      },
    );
  });
}

test("training bootstrap, child reads, and target-only signaling are enforced", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingRulesRoom01";
  const outsiderUid = "training-outsider";
  const outsiderDatabase = environment.authenticatedContext(outsiderUid).database();
  const {
    host,
    guest,
    hostDatabase,
    guestDatabase,
  } = await bootstrapRoom(environment, now, roomId);

  await assertFails(get(ref(hostDatabase, `online/trainingRooms/${roomId}`)));
  await assertSucceeds(get(ref(hostDatabase, `online/trainingRooms/${roomId}/status`)));
  await assertSucceeds(get(ref(guestDatabase, `online/trainingRooms/${roomId}/players`)));
  await assertFails(get(ref(outsiderDatabase, `online/trainingRooms/${roomId}/status`)));

  const signalPath = `online/trainingRooms/${roomId}/signals/${guest.uid}/signal-1`;
  await assertSucceeds(set(ref(hostDatabase, signalPath), {
    fromUid: host.uid,
    type: "offer",
    payload: "offer-sdp",
    createdAt: Date.now(),
    connectionId: "connection-1",
  }));
  await assertFails(get(ref(hostDatabase, signalPath)));
  await assertSucceeds(get(ref(guestDatabase, signalPath)));
  await assertFails(remove(ref(hostDatabase, signalPath)));
  await assertSucceeds(remove(ref(guestDatabase, signalPath)));

  await assertFails(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}/imageReceived/${guest.uid}`),
    true,
  ));
  await assertSucceeds(set(
    ref(guestDatabase, `online/trainingRooms/${roomId}/imageReceived/${guest.uid}`),
    true,
  ));
  await assertFails(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}/continueVotes/1/${host.uid}`),
    "continue",
  ));
  await assertFails(set(
    ref(guestDatabase, `online/trainingRooms/${roomId}/continueVotes/pair1/${guest.uid}`),
    "continue",
  ));
  await assertFails(set(
    ref(outsiderDatabase, `online/trainingRooms/${roomId}/destroyed`),
    { by: outsiderUid, at: Date.now() },
  ));
});

test("health conditions stay out of queue and guest disclosure is private and one-shot", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingPrivateConditions01";
  const outsiderDatabase = environment
    .authenticatedContext("training-outsider")
    .database();
  const room = await createFormingRoom(environment, now, roomId);

  await assertFails(set(
    ref(room.hostDatabase, `online/trainingQueue/${room.host.uid}`),
    { ...room.host, conditions: "待機列には出さない" },
  ));
  await releaseActive(room.hostDatabase, room.host.uid, roomId);
  await reserveActive(
    room.hostDatabase,
    room.host.uid,
    "-trainingPrivacyLeak01",
  );
  await assertFails(set(
    ref(room.hostDatabase, "online/trainingRooms/-trainingPrivacyLeak01"),
    roomPayload(room.host, room.guest, Date.now(), {
      guestConditions: "ホストが代理入力",
    }),
  ));
  await releaseActive(
    room.hostDatabase,
    room.host.uid,
    "-trainingPrivacyLeak01",
  );
  await reserveActive(room.hostDatabase, room.host.uid, roomId);
  await assertFails(get(ref(
    outsiderDatabase,
    `online/trainingRooms/${roomId}/players`,
  )));

  const guestConditionsPath =
    `online/trainingRooms/${roomId}/players/${room.guest.uid}/conditions`;
  await assertFails(set(
    ref(room.hostDatabase, guestConditionsPath),
    room.guestConditions,
  ));
  await assertFails(set(
    ref(outsiderDatabase, guestConditionsPath),
    room.guestConditions,
  ));
  await reserveActive(room.guestDatabase, room.guest.uid, roomId);
  await assertSucceeds(set(
    ref(room.guestDatabase, guestConditionsPath),
    room.guestConditions,
  ));
  await assertFails(set(
    ref(room.guestDatabase, guestConditionsPath),
    "二度目の変更",
  ));

  await assertSucceeds(set(
    ref(
      room.guestDatabase,
      `online/trainingRooms/${roomId}/accepted/${room.guest.uid}`,
    ),
    true,
  ));
  await assertSucceeds(remove(ref(room.guestDatabase, room.invitePath)));
  await assertSucceeds(set(
    ref(room.hostDatabase, `online/trainingRooms/${roomId}/status`),
    "active",
  ));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), guestConditionsPath),
      "",
    );
  });
  await assertFails(set(
    ref(room.guestDatabase, guestConditionsPath),
    "active後の変更",
  ));
});

test("queue and invites are fenced to the current matchmaking session", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const queueUid = "training-session-owner";
  const queueDatabase = environment.authenticatedContext(queueUid).database();
  const first = queueEntry(queueUid, "FIRST", now, {
    sessionId: "queue-session-first",
  });
  const second = queueEntry(queueUid, "SECOND", now, {
    sessionId: "queue-session-second",
  });
  const queuePath = `online/trainingQueue/${queueUid}`;
  await assertSucceeds(set(ref(queueDatabase, queuePath), first));
  await assertFails(set(ref(queueDatabase, queuePath), second));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${queuePath}/lastSeen`),
      now - 60_001,
    );
  });
  await assertSucceeds(set(ref(queueDatabase, queuePath), second));

  const roomId = "-trainingSessionFence01";
  const room = await createFormingRoom(environment, Date.now(), roomId);
  const replacement = {
    ...room.guest,
    sessionId: "replacement-session",
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  };
  await assertFails(set(
    ref(room.guestDatabase, `online/trainingQueue/${room.guest.uid}`),
    replacement,
  ));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(
        contextWithoutRules.database(),
        `online/trainingQueue/${room.guest.uid}/lastSeen`,
      ),
      Date.now() - 60_001,
    );
  });
  await assertSucceeds(set(
    ref(room.guestDatabase, `online/trainingQueue/${room.guest.uid}`),
    replacement,
  ));
  await assertSucceeds(remove(ref(room.guestDatabase, room.invitePath)));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), room.invitePath),
      {
        roomId,
        hostUid: room.host.uid,
        targetSessionId: room.guest.sessionId,
        protocolVersion: 2,
        variant: "kitaeai_60_v2",
        createdAt: Date.now(),
      },
    );
  });
  await reserveActive(room.guestDatabase, room.guest.uid, roomId);
  await assertFails(update(
    ref(room.guestDatabase, `online/trainingRooms/${roomId}`),
    {
      [`players/${room.guest.uid}/conditions`]: room.guestConditions,
      [`accepted/${room.guest.uid}`]: true,
    },
  ));
  assert.equal(
    (await get(ref(room.guestDatabase, room.invitePath)))
      .child("targetSessionId").val(),
    room.guest.sessionId,
  );
  await assertFails(remove(ref(
    environment.authenticatedContext("training-invite-outsider").database(),
    room.invitePath,
  )));
  const malformedInvitePath =
    `online/trainingInvites/${room.guest.uid}/-trainingMalformedInvite01`;
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), malformedInvitePath),
      { hostUid: room.host.uid, createdAt: Date.now() },
    );
  });
  await assertSucceeds(remove(ref(room.guestDatabase, malformedInvitePath)));
});

test("invite ownership replaces the long global lock without blocking an independent pair", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const hostOne = queueEntry("training-pair1-host", "HOST1", now);
  const guestOne = queueEntry("training-pair1-guest", "GUEST1", now);
  const competingHost = queueEntry("training-race-host", "RACE", now);
  const guestAsHostTarget = queueEntry("training-race-target", "TARGET", now);
  const hostTwo = queueEntry("training-pair2-host", "HOST2", now);
  const guestTwo = queueEntry("training-pair2-guest", "GUEST2", now);
  const entries = [
    hostOne,
    guestOne,
    competingHost,
    guestAsHostTarget,
    hostTwo,
    guestTwo,
  ];
  const databases = Object.fromEntries(entries.map((entry) => [
    entry.uid,
    environment.authenticatedContext(entry.uid).database(),
  ]));
  await Promise.all(entries.map((entry) => assertSucceeds(set(
    ref(databases[entry.uid], `online/trainingQueue/${entry.uid}`),
    entry,
  ))));

  const lockPath = "online/trainingMatchLock";
  const lock = (uid, roomId) => {
    const createdAt = Date.now();
    return {
      uid,
      roomId,
      createdAt,
      expiresAt: createdAt + 59_000,
    };
  };
  const invite = (host, guest, roomId) => ({
    roomId,
    hostUid: host.uid,
    targetSessionId: guest.sessionId,
    protocolVersion: 2,
    variant: "kitaeai_60_v2",
    createdAt: Date.now(),
  });

  const roomOneId = "-trainingConcurrentPair01";
  await assertSucceeds(set(
    ref(databases[hostOne.uid], lockPath),
    lock(hostOne.uid, roomOneId),
  ));
  await reserveActive(databases[hostOne.uid], hostOne.uid, roomOneId);
  await assertSucceeds(set(
    ref(databases[hostOne.uid], `online/trainingRooms/${roomOneId}`),
    roomPayload(hostOne, guestOne, now),
  ));
  await assertSucceeds(update(
    ref(databases[hostOne.uid], `online/trainingQueue/${hostOne.uid}`),
    { state: "forming" },
  ));
  const inviteOnePath =
    `online/trainingInvites/${guestOne.uid}/${roomOneId}`;
  const inviteOne = invite(hostOne, guestOne, roomOneId);
  await assertSucceeds(remove(ref(databases[hostOne.uid], lockPath)));
  await assertFails(set(
    ref(databases[hostOne.uid], inviteOnePath),
    inviteOne,
  ));
  await assertSucceeds(set(
    ref(databases[hostOne.uid], lockPath),
    lock(hostOne.uid, "-differentInviteRoom"),
  ));
  await assertFails(set(
    ref(databases[hostOne.uid], inviteOnePath),
    inviteOne,
  ));
  await assertSucceeds(remove(ref(databases[hostOne.uid], lockPath)));
  const expiredInviteLockAt = Date.now() - 2_000;
  await assertSucceeds(set(
    ref(databases[hostOne.uid], lockPath),
    matchLockPayload(hostOne.uid, roomOneId, expiredInviteLockAt, 1_000),
  ));
  await assertFails(set(
    ref(databases[hostOne.uid], inviteOnePath),
    inviteOne,
  ));
  await assertSucceeds(remove(ref(databases[hostOne.uid], lockPath)));
  await assertSucceeds(set(
    ref(databases[hostOne.uid], lockPath),
    lock(hostOne.uid, roomOneId),
  ));
  await assertSucceeds(set(
    ref(databases[hostOne.uid], inviteOnePath),
    inviteOne,
  ));
  await assertSucceeds(remove(ref(databases[hostOne.uid], lockPath)));

  const competingRoomId = "-trainingConcurrentRace1";
  await assertSucceeds(set(
    ref(databases[competingHost.uid], lockPath),
    lock(competingHost.uid, competingRoomId),
  ));
  await reserveActive(
    databases[competingHost.uid],
    competingHost.uid,
    competingRoomId,
  );
  await assertFails(set(
    ref(
      databases[competingHost.uid],
      `online/trainingRooms/${competingRoomId}`,
    ),
    roomPayload(competingHost, guestOne, Date.now()),
  ));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(
        contextWithoutRules.database(),
        `online/trainingRooms/${competingRoomId}`,
      ),
      roomPayload(competingHost, guestOne, Date.now()),
    );
  });
  await assertSucceeds(update(
    ref(
      databases[competingHost.uid],
      `online/trainingQueue/${competingHost.uid}`,
    ),
    { state: "forming" },
  ));
  await assertFails(set(
    ref(
      databases[competingHost.uid],
      `online/trainingInvites/${guestOne.uid}/${competingRoomId}`,
    ),
    invite(competingHost, guestOne, competingRoomId),
  ));
  await assertSucceeds(remove(ref(databases[competingHost.uid], lockPath)));

  const guestHostedRoomId = "-trainingInvitedHostRace";
  await assertSucceeds(set(
    ref(databases[guestOne.uid], lockPath),
    lock(guestOne.uid, guestHostedRoomId),
  ));
  await reserveActive(
    databases[guestOne.uid],
    guestOne.uid,
    guestHostedRoomId,
  );
  await assertFails(set(
    ref(
      databases[guestOne.uid],
      `online/trainingRooms/${guestHostedRoomId}`,
    ),
    roomPayload(guestOne, guestAsHostTarget, Date.now()),
  ));
  await assertSucceeds(remove(ref(databases[guestOne.uid], lockPath)));

  const roomTwoId = "-trainingConcurrentPair02";
  await assertSucceeds(set(
    ref(databases[hostTwo.uid], lockPath),
    lock(hostTwo.uid, roomTwoId),
  ));
  await reserveActive(databases[hostTwo.uid], hostTwo.uid, roomTwoId);
  await assertSucceeds(set(
    ref(databases[hostTwo.uid], `online/trainingRooms/${roomTwoId}`),
    roomPayload(hostTwo, guestTwo, Date.now()),
  ));
  await assertSucceeds(update(
    ref(databases[hostTwo.uid], `online/trainingQueue/${hostTwo.uid}`),
    { state: "forming" },
  ));
  const inviteTwoPath =
    `online/trainingInvites/${guestTwo.uid}/${roomTwoId}`;
  await assertSucceeds(set(
    ref(databases[hostTwo.uid], inviteTwoPath),
    invite(hostTwo, guestTwo, roomTwoId),
  ));
  await assertSucceeds(remove(ref(databases[hostTwo.uid], lockPath)));

  await assertSucceeds(remove(ref(databases[guestTwo.uid], inviteTwoPath)));
  await assertSucceeds(set(
    ref(databases[hostTwo.uid], lockPath),
    lock(hostTwo.uid, roomTwoId),
  ));
  await assertSucceeds(set(
    ref(databases[hostTwo.uid], inviteTwoPath),
    invite(hostTwo, guestTwo, roomTwoId),
  ));
  await assertSucceeds(remove(ref(databases[hostTwo.uid], lockPath)));
  await assertSucceeds(remove(ref(
    databases[guestTwo.uid],
    `online/trainingQueue/${guestTwo.uid}`,
  )));
  await assertSucceeds(remove(ref(databases[guestTwo.uid], inviteTwoPath)));
});

test("room bootstrap is fenced by the host reservation and an unreserved guest", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingReservationFence01";
  const host = queueEntry("training-host", "HOST", now);
  const guest = queueEntry("training-guest", "GUEST", now);
  const hostDatabase = environment.authenticatedContext(host.uid).database();
  const guestDatabase = environment.authenticatedContext(guest.uid).database();
  const roomRef = ref(hostDatabase, `online/trainingRooms/${roomId}`);

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    const adminDatabase = contextWithoutRules.database();
    await Promise.all([
      remove(ref(adminDatabase, `online/trainingActive/${host.uid}`)),
      remove(ref(adminDatabase, `online/trainingActive/${guest.uid}`)),
      remove(ref(adminDatabase, `online/trainingQueue/${host.uid}`)),
      remove(ref(adminDatabase, `online/trainingQueue/${guest.uid}`)),
      remove(ref(adminDatabase, `online/trainingInvites/${host.uid}`)),
      remove(ref(adminDatabase, `online/trainingInvites/${guest.uid}`)),
    ]);
  });
  await assertSucceeds(set(ref(
    hostDatabase,
    `online/trainingQueue/${host.uid}`,
  ), host));
  await assertSucceeds(set(ref(
    guestDatabase,
    `online/trainingQueue/${guest.uid}`,
  ), guest));
  await assertFails(set(roomRef, roomPayload(host, guest, now)));

  await reserveActive(hostDatabase, host.uid, roomId);
  await assertFails(set(roomRef, roomPayload(host, guest, now)));
  await assertSucceeds(set(
    ref(hostDatabase, "online/trainingMatchLock"),
    matchLockPayload(host.uid, "-differentTrainingRoom"),
  ));
  await assertFails(set(roomRef, roomPayload(host, guest, now)));
  await assertSucceeds(remove(ref(
    hostDatabase,
    "online/trainingMatchLock",
  )));
  const expiredLockCreatedAt = Date.now() - 2_000;
  await assertSucceeds(set(
    ref(hostDatabase, "online/trainingMatchLock"),
    matchLockPayload(host.uid, roomId, expiredLockCreatedAt, 1_000),
  ));
  await assertFails(set(roomRef, roomPayload(host, guest, now)));
  await assertSucceeds(remove(ref(
    hostDatabase,
    "online/trainingMatchLock",
  )));
  await assertSucceeds(set(
    ref(hostDatabase, "online/trainingMatchLock"),
    matchLockPayload(host.uid, roomId),
  ));
  await reserveActive(
    guestDatabase,
    guest.uid,
    "-anotherTrainingRoom01",
  );
  await assertFails(set(roomRef, roomPayload(host, guest, now)));
  await releaseActive(
    guestDatabase,
    guest.uid,
    "-anotherTrainingRoom01",
  );
  await assertSucceeds(set(roomRef, roomPayload(host, guest, now)));
  await assertSucceeds(remove(ref(
    hostDatabase,
    "online/trainingMatchLock",
  )));

  await assertFails(set(
    ref(hostDatabase, `online/trainingActive/${host.uid}`),
    {
      roomId,
      rooms: {
        [roomId]: true,
        "-anotherTrainingRoom02": true,
      },
    },
  ));
  await assertFails(remove(ref(
    hostDatabase,
    `online/trainingActive/${host.uid}`,
  )));
  await releaseActive(hostDatabase, host.uid, roomId);
  const newerRoomId = "-newerTrainingRoom03";
  await reserveActive(hostDatabase, host.uid, newerRoomId);
  await assertSucceeds(remove(ref(
    hostDatabase,
    `online/trainingActive/${host.uid}/rooms/${roomId}`,
  )));
  assert.deepEqual(
    (await get(ref(
      hostDatabase,
      `online/trainingActive/${host.uid}`,
    ))).val(),
    activeReservation(newerRoomId),
  );
});

test("a guest with no health condition can accept with the client multi-path update", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const roomId = "-trainingEmptyConditions01";
  const room = await createFormingRoom(environment, Date.now(), roomId);

  await reserveActive(room.guestDatabase, room.guest.uid, roomId);
  await assertSucceeds(update(
    ref(room.guestDatabase, `online/trainingRooms/${roomId}`),
    {
      [`players/${room.guest.uid}/conditions`]: "",
      [`accepted/${room.guest.uid}`]: true,
    },
  ));
  await assertSucceeds(set(
    ref(room.hostDatabase, `online/trainingRooms/${roomId}/status`),
    "active",
  ));
});

test("only the host may expire a forming room", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingRulesExpired01";
  const room = await createFormingRoom(environment, now, roomId);
  const statusPath = `online/trainingRooms/${roomId}/status`;

  await assertFails(set(ref(room.hostDatabase, statusPath), "active"));
  await assertFails(set(ref(room.guestDatabase, statusPath), "expired"));
  await assertSucceeds(set(ref(room.hostDatabase, statusPath), "expired"));
  await assertFails(set(
    ref(
      room.guestDatabase,
      `online/trainingRooms/${roomId}/accepted/${room.guest.uid}`,
    ),
    true,
  ));
});

test("turns are contiguous, alternate roles, and require both continuation votes", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingRulesRoom02";
  const {
    host,
    guest,
    hostDatabase,
    guestDatabase,
  } = await bootstrapRoom(environment, now, roomId);
  await setLegacyRoomProtocol(environment, roomId);
  const turnOnePath = `online/trainingRooms/${roomId}/turns/1`;
  const turnTwoPath = `online/trainingRooms/${roomId}/turns/2`;
  const turnThreePath = `online/trainingRooms/${roomId}/turns/3`;

  await assertFails(set(ref(hostDatabase, turnOnePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertSucceeds(set(
    ref(
      guestDatabase,
      `online/trainingRooms/${roomId}/imageReceived/${guest.uid}`,
    ),
    true,
  ));
  await assertFails(set(ref(hostDatabase, turnOnePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertSucceeds(set(
    ref(
      hostDatabase,
      `online/trainingRooms/${roomId}/imageReceived/${host.uid}`,
    ),
    true,
  ));
  await assertFails(set(ref(guestDatabase, turnOnePath), {
    trainerUid: guest.uid,
    traineeUid: host.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertFails(set(ref(hostDatabase, turnOnePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction({ bpm: 161 }),
    createdAt: Date.now(),
  }));
  await assertSucceeds(set(ref(hostDatabase, turnOnePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));

  await assertFails(set(ref(guestDatabase, turnTwoPath), {
    trainerUid: guest.uid,
    traineeUid: host.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertFails(set(ref(hostDatabase, turnThreePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));

  const turnOneStartedAt = Date.now();
  await assertFails(set(
    ref(hostDatabase, `${turnOnePath}/startedAt`),
    turnOneStartedAt,
  ));
  await assertSucceeds(set(
    ref(guestDatabase, `${turnOnePath}/startedAt`),
    turnOneStartedAt,
  ));
  await assertFails(set(
    ref(hostDatabase, `${turnOnePath}/completedAt`),
    Date.now(),
  ));
  const turnOneCompletedAt = Date.now();
  await assertSucceeds(set(
    ref(guestDatabase, `${turnOnePath}/completedAt`),
    turnOneCompletedAt,
  ));
  await assertFails(set(
    ref(guestDatabase, `${turnOnePath}/surrenderedAt`),
    Date.now(),
  ));

  await assertFails(set(ref(guestDatabase, turnTwoPath), {
    trainerUid: guest.uid,
    traineeUid: host.uid,
    instruction: instruction(),
    createdAt: turnOneCompletedAt - 1,
  }));
  await assertFails(set(ref(hostDatabase, turnThreePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertSucceeds(set(ref(guestDatabase, turnTwoPath), {
    trainerUid: guest.uid,
    traineeUid: host.uid,
    instruction: instruction(),
    createdAt: Math.max(Date.now(), turnOneCompletedAt),
  }));
  await assertFails(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}/continueVotes/1/${host.uid}`),
    "continue",
  ));

  const turnTwoStartedAt = Date.now();
  await assertSucceeds(set(
    ref(hostDatabase, `${turnTwoPath}/startedAt`),
    turnTwoStartedAt,
  ));
  const turnTwoCompletedAt = Date.now();
  await assertSucceeds(set(
    ref(hostDatabase, `${turnTwoPath}/completedAt`),
    turnTwoCompletedAt,
  ));
  await assertSucceeds(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}/continueVotes/1/${host.uid}`),
    "continue",
  ));
  await assertFails(set(ref(hostDatabase, turnThreePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Math.max(Date.now(), turnTwoCompletedAt),
  }));
  await assertSucceeds(set(
    ref(guestDatabase, `online/trainingRooms/${roomId}/continueVotes/1/${guest.uid}`),
    "continue",
  ));
  await assertFails(set(ref(guestDatabase, turnThreePath), {
    trainerUid: guest.uid,
    traineeUid: host.uid,
    instruction: instruction(),
    createdAt: Math.max(Date.now(), turnTwoCompletedAt),
  }));
  await assertSucceeds(set(ref(hostDatabase, turnThreePath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Math.max(Date.now(), turnTwoCompletedAt),
  }));
});

test("completion and surrender are rejected after the strict sixty-second window", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const completionRoomId = "-trainingRulesRoom04";
  const completionRoom = await bootstrapRoom(environment, now, completionRoomId);
  await setLegacyRoomProtocol(environment, completionRoomId);
  const completionTurnPath =
    `online/trainingRooms/${completionRoomId}/turns/1`;
  await markBothImagesReceived(completionRoom, completionRoomId);

  await assertSucceeds(set(ref(completionRoom.hostDatabase, completionTurnPath), {
    trainerUid: completionRoom.host.uid,
    traineeUid: completionRoom.guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertSucceeds(set(
    ref(completionRoom.guestDatabase, `${completionTurnPath}/startedAt`),
    Date.now(),
  ));

  const completionAt = Date.now();
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${completionTurnPath}/startedAt`),
      completionAt - 60_001,
    );
  });
  await assertFails(set(
    ref(completionRoom.guestDatabase, `${completionTurnPath}/completedAt`),
    completionAt,
  ));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${completionTurnPath}/startedAt`),
      completionAt - 60_000,
    );
  });
  await assertSucceeds(set(
    ref(completionRoom.guestDatabase, `${completionTurnPath}/completedAt`),
    completionAt,
  ));
  await releaseActive(
    completionRoom.hostDatabase,
    completionRoom.host.uid,
    completionRoomId,
  );
  await releaseActive(
    completionRoom.guestDatabase,
    completionRoom.guest.uid,
    completionRoomId,
  );

  const surrenderRoomId = "-trainingRulesRoom05";
  const surrenderRoom = await bootstrapRoom(environment, Date.now(), surrenderRoomId);
  await setLegacyRoomProtocol(environment, surrenderRoomId);
  const surrenderTurnPath =
    `online/trainingRooms/${surrenderRoomId}/turns/1`;
  await markBothImagesReceived(surrenderRoom, surrenderRoomId);

  await assertSucceeds(set(ref(surrenderRoom.hostDatabase, surrenderTurnPath), {
    trainerUid: surrenderRoom.host.uid,
    traineeUid: surrenderRoom.guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertSucceeds(set(
    ref(surrenderRoom.guestDatabase, `${surrenderTurnPath}/startedAt`),
    Date.now(),
  ));

  const surrenderedAt = Date.now();
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${surrenderTurnPath}/startedAt`),
      surrenderedAt - 60_001,
    );
  });
  await assertFails(set(
    ref(surrenderRoom.guestDatabase, `${surrenderTurnPath}/surrenderedAt`),
    surrenderedAt,
  ));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${surrenderTurnPath}/startedAt`),
      surrenderedAt - 60_000,
    );
  });
  await assertSucceeds(set(
    ref(surrenderRoom.guestDatabase, `${surrenderTurnPath}/surrenderedAt`),
    surrenderedAt,
  ));
});

test("either participant may record timeout after a long suspended session", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingRulesRoom03";
  const {
    host,
    guest,
    hostDatabase,
    guestDatabase,
  } = await bootstrapRoom(environment, now, roomId);
  await setLegacyRoomProtocol(environment, roomId);
  const turnPath = `online/trainingRooms/${roomId}/turns/1`;
  await markBothImagesReceived({
    host,
    guest,
    hostDatabase,
    guestDatabase,
  }, roomId);

  await assertSucceeds(set(ref(hostDatabase, turnPath), {
    trainerUid: host.uid,
    traineeUid: guest.uid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  await assertSucceeds(set(
    ref(guestDatabase, `${turnPath}/startedAt`),
    Date.now(),
  ));
  await assertFails(set(
    ref(hostDatabase, `${turnPath}/timedOutAt`),
    Date.now(),
  ));

  const timedOutAt = Date.now();
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${turnPath}/startedAt`),
      timedOutAt - 10 * 60_000,
    );
  });
  await assertSucceeds(set(
    ref(hostDatabase, `${turnPath}/timedOutAt`),
    timedOutAt,
  ));
  await assertFails(set(
    ref(guestDatabase, `${turnPath}/completedAt`),
    Date.now(),
  ));
});

test("v2 carrot choices stay secret until both lock and turns advance without votes", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const roomId = "-trainingV2Choices01";
  const room = await bootstrapRoom(environment, Date.now(), roomId);
  const basePath = `online/trainingRooms/${roomId}`;
  const outsiderDatabase = environment
    .authenticatedContext("training-choice-outsider")
    .database();
  await markBothImagesReceived(room, roomId);

  await assertSucceeds(get(ref(
    room.hostDatabase,
    `${basePath}/carrotChoices/${room.host.uid}`,
  )));
  await assertFails(get(ref(
    room.hostDatabase,
    `${basePath}/carrotChoices/${room.guest.uid}`,
  )));
  await assertFails(get(ref(room.hostDatabase, `${basePath}/carrotChoices`)));

  await assertSucceeds(set(ref(
    room.hostDatabase,
    `${basePath}/carrotChoices/${room.host.uid}`,
  ), "mine"));
  await assertFails(get(ref(
    room.guestDatabase,
    `${basePath}/carrotChoices/${room.host.uid}`,
  )));
  await assertFails(set(ref(room.hostDatabase, `${basePath}/turns/1`), v2Turn(
    room.host.uid,
    room.guest.uid,
    "boost8",
  )));

  await assertSucceeds(set(ref(
    room.guestDatabase,
    `${basePath}/carrotChoices/${room.guest.uid}`,
  ), "boost8"));
  await assertSucceeds(get(ref(room.hostDatabase, `${basePath}/carrotChoices`)));
  await assertSucceeds(get(ref(
    room.guestDatabase,
    `${basePath}/carrotChoices/${room.host.uid}`,
  )));
  await assertFails(get(ref(outsiderDatabase, `${basePath}/carrotChoices`)));
  await assertFails(set(ref(
    room.guestDatabase,
    `${basePath}/carrotChoices/${room.guest.uid}`,
  ), "boost10"));

  const turnOnePath = `${basePath}/turns/1`;
  await assertSucceeds(set(ref(room.hostDatabase, turnOnePath), v2Turn(
    room.host.uid,
    room.guest.uid,
    "boost8",
  )));
  const turnTwoPath = `${basePath}/turns/2`;
  await assertFails(set(ref(room.guestDatabase, turnTwoPath), v2Turn(
    room.guest.uid,
    room.host.uid,
    "mine",
  )));
  const startedAt = Date.now();
  await assertSucceeds(set(
    ref(room.guestDatabase, `${turnOnePath}/startedAt`),
    startedAt,
  ));
  await assertFails(set(
    ref(room.guestDatabase, `${turnOnePath}/baseCompletedAt`),
    startedAt + 60_000,
  ));
  await assertFails(set(
    ref(room.hostDatabase, `${turnOnePath}/timedOutAt`),
    startedAt + 60_000,
  ));

  const delayedStartedAt = Date.now() - 10 * 60_000;
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${turnOnePath}/startedAt`),
      delayedStartedAt,
    );
  });
  await assertSucceeds(update(ref(room.guestDatabase, turnOnePath), {
    baseCompletedAt: delayedStartedAt + 60_000,
    completedAt: delayedStartedAt + 70_000,
    boostCompletedAt: delayedStartedAt + 70_000,
  }));
  await assertFails(set(
    ref(
      room.hostDatabase,
      `${basePath}/continueVotes/1/${room.host.uid}`,
    ),
    "continue",
  ));
  await assertSucceeds(set(ref(room.guestDatabase, turnTwoPath), v2Turn(
    room.guest.uid,
    room.host.uid,
    "mine",
  )));
});

test("v2 enforces the 59,999/60,000 boundary and canonical delayed completion", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const roomId = "-trainingV2Boundary01";
  const room = await bootstrapRoom(environment, Date.now(), roomId);
  await markBothImagesReceived(room, roomId);
  await chooseCarrots(room, roomId, {
    hostChoice: "mine",
    guestChoice: "boost10",
  });
  const turnPath = `online/trainingRooms/${roomId}/turns/1`;
  await assertSucceeds(set(ref(room.hostDatabase, turnPath), v2Turn(
    room.host.uid,
    room.guest.uid,
    "boost10",
  )));

  const startedAt = Date.now() - 10 * 60_000;
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `${turnPath}/startedAt`),
      startedAt,
    );
  });
  await assertFails(set(
    ref(room.guestDatabase, `${turnPath}/baseCompletedAt`),
    startedAt + 59_999,
  ));
  await assertSucceeds(set(
    ref(room.guestDatabase, `${turnPath}/baseCompletedAt`),
    startedAt + 60_000,
  ));
  await assertFails(set(
    ref(room.guestDatabase, `${turnPath}/completedAt`),
    startedAt + 90_000,
  ));
  await assertSucceeds(update(ref(room.guestDatabase, turnPath), {
    completedAt: startedAt + 90_000,
    boostCompletedAt: startedAt + 90_000,
  }));
});

test("existing protocol v1 rooms keep their old early-completion writes", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const roomId = "-trainingLegacyV1Room";
  const hostUid = "training-legacy-host";
  const guestUid = "training-legacy-guest";
  const hostDatabase = environment.authenticatedContext(hostUid).database();
  const guestDatabase = environment.authenticatedContext(guestUid).database();
  const createdAt = Date.now();
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(
      ref(contextWithoutRules.database(), `online/trainingRooms/${roomId}`),
      {
        protocolVersion: 1,
        variant: "kitaeai_60",
        hostUid,
        guestUid,
        createdAt,
        status: "active",
        firstTrainerUid: hostUid,
        members: { [hostUid]: true, [guestUid]: true },
        players: {
          [hostUid]: {
            uid: hostUid, name: "LEGACY-H", intensity: "standard", conditions: "",
          },
          [guestUid]: {
            uid: guestUid, name: "LEGACY-G", intensity: "standard", conditions: "",
          },
        },
        accepted: { [hostUid]: true, [guestUid]: true },
        imageReceived: { [hostUid]: true, [guestUid]: true },
      },
    );
  });
  const turnOnePath = `online/trainingRooms/${roomId}/turns/1`;
  await assertSucceeds(set(ref(hostDatabase, turnOnePath), {
    trainerUid: hostUid,
    traineeUid: guestUid,
    instruction: instruction(),
    createdAt: Date.now(),
  }));
  const startedAt = Date.now();
  await assertSucceeds(set(
    ref(guestDatabase, `${turnOnePath}/startedAt`),
    startedAt,
  ));
  await assertSucceeds(set(
    ref(guestDatabase, `${turnOnePath}/completedAt`),
    startedAt + 1,
  ));
  assert.equal(
    (await get(ref(guestDatabase, `${turnOnePath}/completedAt`))).val(),
    startedAt + 1,
  );
});

test("v3 draws are owner-scoped, scores stay secret, and early workouts are rejected", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingV3RoundPrivacy01";
  const invalidUid = "training-v3-invalid-deck";
  const invalidDatabase = environment.authenticatedContext(invalidUid).database();
  const invalidQueue = v3QueueEntry(invalidUid, "INVALID", now);
  delete invalidQueue.commandDeck[3];
  await assertFails(set(
    ref(invalidDatabase, `online/trainingQueue/${invalidUid}`),
    invalidQueue,
  ));

  const room = await bootstrapV3Room(environment, now, roomId, "privacy");
  const outsiderDatabase = environment
    .authenticatedContext("training-v3-outsider")
    .database();
  const roundPath = `online/trainingRooms/${roomId}/rounds/1`;
  await assertFails(set(
    ref(room.guestDatabase, roundPath),
    { createdAt: Date.now() },
  ));
  await assertFails(runTransaction(
    ref(room.guestDatabase, `${roundPath}/createdAt`),
    (current) => current == null ? Date.now() : undefined,
    { applyLocally: false },
  ));
  const legacyParentDatabase = environment.authenticatedContext(room.host.uid).database();
  await assertFails(runTransaction(
    ref(legacyParentDatabase, roundPath),
    (current) => current == null ? { createdAt: Date.now() } : undefined,
    { applyLocally: false },
  ));
  const coldHostDatabase = environment.authenticatedContext(room.host.uid).database();
  await assertFails(get(ref(coldHostDatabase, roundPath)));
  const observedRoundCreatedAt = [];
  const expectedRoundCreatedAt = Date.now();
  const roundCreatedAtTransaction = await assertSucceeds(runTransaction(
    ref(coldHostDatabase, `${roundPath}/createdAt`),
    (current) => {
      observedRoundCreatedAt.push(current);
      return current == null ? expectedRoundCreatedAt : undefined;
    },
    { applyLocally: false },
  ));
  assert.equal(observedRoundCreatedAt.includes(null), true);
  assert.equal(roundCreatedAtTransaction.committed, true);
  assert.equal(roundCreatedAtTransaction.snapshot.val(), expectedRoundCreatedAt);
  assert.equal(
    (await get(ref(room.hostDatabase, `${roundPath}/createdAt`))).val(),
    expectedRoundCreatedAt,
  );
  const reentryHostDatabase = environment.authenticatedContext(room.host.uid).database();
  const reentryObserved = [];
  const reentryTransaction = await assertSucceeds(runTransaction(
    ref(reentryHostDatabase, `${roundPath}/createdAt`),
    (current) => {
      reentryObserved.push(current);
      return current == null ? Date.now() : undefined;
    },
    { applyLocally: false },
  ));
  assert.equal(reentryObserved[0], null);
  assert.equal(reentryObserved.includes(expectedRoundCreatedAt), true);
  assert.equal(reentryTransaction.committed, false);
  assert.equal(reentryTransaction.snapshot.val(), expectedRoundCreatedAt);
  await assertFails(get(ref(reentryHostDatabase, roundPath)));
  await assertFails(set(
    ref(room.hostDatabase, `${roundPath}/unexpected`),
    true,
  ));

  const hostDraw = {
    imageIndex: 1,
    bpm: 0,
    drawnAt: Date.now(),
  };
  await assertFails(set(
    ref(room.guestDatabase, `${roundPath}/draws/${room.host.uid}`),
    hostDraw,
  ));
  const coldHostDrawDatabase = environment.authenticatedContext(room.host.uid).database();
  const hostDrawTransaction = await assertSucceeds(runTransaction(
    ref(coldHostDrawDatabase, `${roundPath}/draws/${room.host.uid}`),
    (current) => current == null ? hostDraw : undefined,
    { applyLocally: false },
  ));
  assert.equal(hostDrawTransaction.committed, true);
  assert.deepEqual(hostDrawTransaction.snapshot.val(), hostDraw);
  await assertFails(set(
    ref(room.hostDatabase, `${roundPath}/imageReceived/${room.host.uid}`),
    true,
  ));
  await assertSucceeds(set(
    ref(room.guestDatabase, `${roundPath}/imageReceived/${room.guest.uid}`),
    true,
  ));
  await assertFails(set(
    ref(room.guestDatabase, `${roundPath}/draws/${room.guest.uid}`),
    {
      imageIndex: 2,
      bpm: 100,
      drawnAt: Date.now(),
    },
  ));
  const guestDraw = {
    imageIndex: 2,
    bpm: 80,
    drawnAt: Date.now(),
  };
  const coldGuestDrawDatabase = environment.authenticatedContext(room.guest.uid).database();
  const guestDrawTransaction = await assertSucceeds(runTransaction(
    ref(coldGuestDrawDatabase, `${roundPath}/draws/${room.guest.uid}`),
    (current) => current == null ? guestDraw : undefined,
    { applyLocally: false },
  ));
  assert.equal(guestDrawTransaction.committed, true);
  assert.deepEqual(guestDrawTransaction.snapshot.val(), guestDraw);
  const committedDraws = (await get(
    ref(room.hostDatabase, `${roundPath}/draws`),
  )).val();
  assert.deepEqual(committedDraws, {
    [room.host.uid]: hostDraw,
    [room.guest.uid]: guestDraw,
  });
  await assertSucceeds(set(
    ref(room.hostDatabase, `${roundPath}/imageReceived/${room.host.uid}`),
    true,
  ));
  await assertFails(set(
    ref(room.guestDatabase, `${roundPath}/imageReceived/${room.guest.uid}`),
    true,
  ));

  const hostScorePath = `${roundPath}/scores/${room.host.uid}`;
  const guestScorePath = `${roundPath}/scores/${room.guest.uid}`;
  await assertSucceeds(set(ref(room.hostDatabase, hostScorePath), 9));
  await assertSucceeds(get(ref(room.hostDatabase, hostScorePath)));
  await assertFails(get(ref(room.guestDatabase, hostScorePath)));
  await assertFails(get(ref(outsiderDatabase, hostScorePath)));
  await assertSucceeds(set(ref(room.guestDatabase, guestScorePath), 8));
  assert.equal((await get(ref(room.guestDatabase, hostScorePath))).val(), 9);

  await assertFails(set(
    ref(room.hostDatabase, `${roundPath}/commandChoices/${room.host.uid}`),
    {
      trainerUid: room.host.uid,
      cardIndex: 1,
      selectedAt: Date.now(),
    },
  ));
  await assertSucceeds(set(
    ref(room.guestDatabase, `${roundPath}/commandChoices/${room.host.uid}`),
    {
      trainerUid: room.guest.uid,
      cardIndex: 1,
      selectedAt: Date.now(),
    },
  ));
  await assertSucceeds(set(
    ref(room.hostDatabase, `${roundPath}/commandChoices/${room.guest.uid}`),
    {
      trainerUid: room.host.uid,
      cardIndex: 1,
      selectedAt: Date.now(),
    },
  ));

  const hostStartedAt = Date.now();
  const guestStartedAt = Date.now();
  await assertFails(set(
    ref(room.guestDatabase, `${roundPath}/workouts/${room.host.uid}`),
    { startedAt: hostStartedAt },
  ));
  await assertSucceeds(set(
    ref(room.hostDatabase, `${roundPath}/workouts/${room.host.uid}`),
    { startedAt: hostStartedAt },
  ));
  await assertSucceeds(set(
    ref(room.guestDatabase, `${roundPath}/workouts/${room.guest.uid}`),
    { startedAt: guestStartedAt },
  ));
  await assertFails(set(
    ref(room.hostDatabase, `${roundPath}/workouts/${room.host.uid}/completedAt`),
    hostStartedAt + 75_000,
  ));
  await assertFails(set(
    ref(room.guestDatabase, `${roundPath}/workouts/${room.guest.uid}/completedAt`),
    guestStartedAt + 60_000,
  ));
  await assertFails(set(
    ref(room.hostDatabase, `${roundPath}/completedAt`),
    Date.now(),
  ));
});

test("v3 canonical completion advances atomically and rejects reused images or commands", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingV3Canonical01";
  const room = await bootstrapV3Room(environment, now, roomId, "canonical");
  const roomPath = `online/trainingRooms/${roomId}`;
  const startedAt = Date.now() - 61_000;
  const completedAt = startedAt + 60_000;

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await set(ref(contextWithoutRules.database(), `${roomPath}/rounds/1`), {
      createdAt: startedAt - 5_000,
      draws: {
        [room.host.uid]: {
          imageIndex: 1,
          bpm: 0,
          drawnAt: startedAt - 4_000,
        },
        [room.guest.uid]: {
          imageIndex: 1,
          bpm: 0,
          drawnAt: startedAt - 4_000,
        },
      },
      imageReceived: {
        [room.host.uid]: true,
        [room.guest.uid]: true,
      },
      scores: {
        [room.host.uid]: 8,
        [room.guest.uid]: 1,
      },
      commandChoices: {
        [room.host.uid]: {
          trainerUid: room.guest.uid,
          cardIndex: 1,
          selectedAt: startedAt - 1_000,
        },
      },
      workouts: {
        [room.host.uid]: {
          startedAt,
        },
      },
    });
  });

  await assertFails(set(
    ref(room.guestDatabase, `${roomPath}/rounds/1/workouts/${room.host.uid}/completedAt`),
    completedAt,
  ));
  await assertFails(set(
    ref(room.hostDatabase, `${roomPath}/rounds/1/workouts/${room.host.uid}/completedAt`),
    completedAt + 1,
  ));
  await assertSucceeds(set(
    ref(room.hostDatabase, `${roomPath}/rounds/1/workouts/${room.host.uid}/completedAt`),
    completedAt,
  ));
  await assertFails(set(
    ref(room.guestDatabase, `${roomPath}/rounds/1/completedAt`),
    Date.now(),
  ));

  const nextRoundAt = Date.now();
  await assertSucceeds(update(
    ref(room.hostDatabase, `${roomPath}/rounds`),
    {
      "1/completedAt": nextRoundAt,
      2: { createdAt: nextRoundAt },
    },
  ));
  await assertFails(set(
    ref(room.hostDatabase, `${roomPath}/rounds/2/draws/${room.host.uid}`),
    {
      imageIndex: 1,
      bpm: 0,
      drawnAt: Date.now(),
    },
  ));
  await assertSucceeds(set(
    ref(room.hostDatabase, `${roomPath}/rounds/2/draws/${room.host.uid}`),
    {
      imageIndex: 2,
      bpm: 80,
      drawnAt: Date.now(),
    },
  ));

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    const adminDatabase = contextWithoutRules.database();
    await update(ref(adminDatabase, `${roomPath}/rounds/2`), {
      [`draws/${room.guest.uid}`]: {
        imageIndex: 2,
        bpm: 80,
        drawnAt: Date.now(),
      },
      [`imageReceived/${room.host.uid}`]: true,
      [`imageReceived/${room.guest.uid}`]: true,
      [`scores/${room.host.uid}`]: 8,
      [`scores/${room.guest.uid}`]: 1,
    });
  });
  await assertFails(set(
    ref(room.guestDatabase, `${roomPath}/rounds/2/commandChoices/${room.host.uid}`),
    {
      trainerUid: room.guest.uid,
      cardIndex: 1,
      selectedAt: Date.now(),
    },
  ));
  await assertSucceeds(set(
    ref(room.guestDatabase, `${roomPath}/rounds/2/commandChoices/${room.host.uid}`),
    {
      trainerUid: room.guest.uid,
      cardIndex: 2,
      selectedAt: Date.now(),
    },
  ));

  await assertFails(set(
    ref(room.hostDatabase, `${roomPath}/surrendered`),
    {
      uid: room.host.uid,
      at: Date.now(),
      unexpected: true,
    },
  ));
  await assertSucceeds(set(
    ref(room.guestDatabase, `${roomPath}/surrendered`),
    {
      uid: room.guest.uid,
      at: Date.now(),
    },
  ));
  await assertFails(set(
    ref(room.hostDatabase, `${roomPath}/rounds/3`),
    { createdAt: Date.now() },
  ));
});

test("v3 recomputes HP from prior scores before allowing another round", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingV3HpFence01";
  const room = await bootstrapV3Room(environment, now, roomId, "hp-fence");
  const roomPath = `online/trainingRooms/${roomId}`;
  const completedAt = Date.now() - 1_000;

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    const adminDatabase = contextWithoutRules.database();
    await set(ref(adminDatabase, `${roomPath}/rounds`), {
      1: {
        createdAt: completedAt - 10_000,
        scores: {
          [room.host.uid]: 9,
          [room.guest.uid]: 1,
        },
        completedAt: completedAt - 5_000,
      },
      2: {
        createdAt: completedAt - 4_000,
        scores: {
          [room.host.uid]: 8,
          [room.guest.uid]: 1,
        },
        completedAt,
      },
    });
  });
  await assertSucceeds(set(
    ref(room.hostDatabase, `${roomPath}/rounds/3`),
    { createdAt: Date.now() },
  ));
  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    const adminDatabase = contextWithoutRules.database();
    await remove(ref(adminDatabase, `${roomPath}/rounds/3`));
    await set(
      ref(adminDatabase, `${roomPath}/rounds/2/scores/${room.host.uid}`),
      9,
    );
  });
  await assertFails(set(
    ref(room.hostDatabase, `${roomPath}/rounds/3`),
    { createdAt: Date.now() },
  ));
});

test("retired team data survives but no authenticated client can read or mutate it", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const uid = "legacy-team-player";
  const database = environment.authenticatedContext(uid).database();
  const legacyPaths = [
    "teamQueue",
    "teamActive",
    "teamMatchLock",
    "teamInvites",
    "teamProfiles",
    "teamChats",
    "teamDuoScores",
    "teamRooms",
  ];

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    const adminDatabase = contextWithoutRules.database();
    for (const legacyPath of legacyPaths) {
      await set(ref(adminDatabase, `online/${legacyPath}/legacy`), {
        preserved: true,
      });
    }
  });

  for (const legacyPath of legacyPaths) {
    const legacyRef = ref(database, `online/${legacyPath}/legacy`);
    await assertFails(get(legacyRef));
    await assertFails(set(legacyRef, { preserved: false }));
    await assertFails(remove(legacyRef));
  }
});

test("queue lastSeen uses a 60-second lease for state transitions", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const cases = [
    {
      uid: "training-lease-20s",
      lastSeenOffsetMs: -20_000,
      succeeds: true,
    },
    {
      uid: "training-lease-stale",
      lastSeenOffsetMs: -65_000,
      succeeds: false,
    },
    {
      uid: "training-lease-future",
      lastSeenOffsetMs: 20_000,
      succeeds: false,
    },
  ];

  for (const leaseCase of cases) {
    const seededAt = Date.now();
    const queuePath = `online/trainingQueue/${leaseCase.uid}`;
    const database = environment.authenticatedContext(leaseCase.uid).database();
    await assertSucceeds(set(
      ref(database, queuePath),
      queueEntry(leaseCase.uid, "LEASE", seededAt),
    ));
    const transition = update(ref(database, queuePath), {
      lastSeen: seededAt + leaseCase.lastSeenOffsetMs,
      state: "forming",
    });
    if (leaseCase.succeeds) {
      await assertSucceeds(transition);
      assert.equal((await get(ref(database, `${queuePath}/state`))).val(), "forming");
    } else {
      await assertFails(transition);
    }
  }
});

test("training active accepts optional in-range reservedAt and rejects invalid bounds", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const reservations = [
    {
      uid: "training-active-legacy",
      roomId: "-trainingActiveLegacy01",
      succeeds: true,
    },
    {
      uid: "training-active-current",
      roomId: "-trainingActiveCurrent01",
      reservedAt: Date.now(),
      succeeds: true,
    },
    {
      uid: "training-active-old",
      roomId: "-trainingActiveOld01",
      reservedAt: Date.now() - 65_000,
      succeeds: false,
    },
    {
      uid: "training-active-future",
      roomId: "-trainingActiveFuture01",
      reservedAt: Date.now() + 20_000,
      succeeds: false,
    },
  ];

  for (const reservation of reservations) {
    const database = environment.authenticatedContext(reservation.uid).database();
    const payload = activeReservation(reservation.roomId);
    if (reservation.reservedAt !== undefined) {
      payload.reservedAt = reservation.reservedAt;
    }
    const write = set(
      ref(database, `online/trainingActive/${reservation.uid}`),
      payload,
    );
    if (reservation.succeeds) {
      await assertSucceeds(write);
    } else {
      await assertFails(write);
    }
  }
});

test("cleanup cursor and guards are server-only and guard room creation until expiry", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const roomId = "-trainingCleanupGuard01";
  const host = queueEntry("training-guard-host", "HOST", now);
  const guest = queueEntry("training-guard-guest", "GUEST", now);
  const hostDatabase = environment.authenticatedContext(host.uid).database();
  const guestDatabase = environment.authenticatedContext(guest.uid).database();
  const cursorPath = "online/trainingActiveCleanupCursor";
  const guardPath = `online/trainingActiveCleanupGuards/${roomId}`;
  const guard = {
    cleanupId: "cleanup-guard-regression",
    uid: host.uid,
    roomId,
    createdAt: now,
    expiresAt: now + 60_000,
  };

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    const adminDatabase = contextWithoutRules.database();
    await Promise.all([
      set(ref(adminDatabase, cursorPath), {
        uid: host.uid,
        updatedAt: now,
      }),
      set(ref(adminDatabase, guardPath), guard),
    ]);
  });
  await assertFails(get(ref(hostDatabase, cursorPath)));
  await assertFails(get(ref(hostDatabase, guardPath)));
  await assertFails(set(ref(hostDatabase, cursorPath), {
    uid: guest.uid,
    updatedAt: Date.now(),
  }));
  await assertFails(set(ref(hostDatabase, guardPath), {
    ...guard,
    expiresAt: Date.now() + 120_000,
  }));

  await assertSucceeds(set(
    ref(hostDatabase, `online/trainingQueue/${host.uid}`),
    host,
  ));
  await assertSucceeds(set(
    ref(guestDatabase, `online/trainingQueue/${guest.uid}`),
    guest,
  ));
  await assertSucceeds(set(
    ref(hostDatabase, "online/trainingMatchLock"),
    matchLockPayload(host.uid, roomId),
  ));
  await reserveActive(hostDatabase, host.uid, roomId);
  await assertFails(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}`),
    roomPayload(host, guest, Date.now()),
  ));

  await environment.withSecurityRulesDisabled(async (contextWithoutRules) => {
    await update(
      ref(contextWithoutRules.database(), guardPath),
      { expiresAt: Date.now() - 1 },
    );
  });
  await assertSucceeds(set(
    ref(hostDatabase, `online/trainingRooms/${roomId}`),
    roomPayload(host, guest, Date.now()),
  ));
  await assertSucceeds(remove(ref(
    hostDatabase,
    "online/trainingMatchLock",
  )));
});

test("cold-cache status transaction activates a forming room with applyLocally false", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const roomId = "-trainingColdStatus01";
  const room = await createFormingRoom(environment, Date.now(), roomId);
  await reserveActive(room.guestDatabase, room.guest.uid, roomId);
  await assertSucceeds(update(
    ref(room.guestDatabase, `online/trainingRooms/${roomId}`),
    {
      [`players/${room.guest.uid}/conditions`]: room.guestConditions,
      [`accepted/${room.guest.uid}`]: true,
    },
  ));

  const coldHostDatabase = environment.authenticatedContext(room.host.uid).database();
  const observed = [];
  const transaction = await runTransaction(
    ref(coldHostDatabase, `online/trainingRooms/${roomId}/status`),
    (current) => {
      observed.push(current);
      return current == null || current === "forming" ? "active" : undefined;
    },
    { applyLocally: false },
  );

  assert.equal(observed[0], null);
  assert.equal(observed.includes("forming"), true);
  assert.equal(transaction.committed, true);
  assert.equal(transaction.snapshot.val(), "active");
  assert.equal(
    (await get(ref(
      coldHostDatabase,
      `online/trainingRooms/${roomId}/status`,
    ))).val(),
    "active",
  );
});

test("cold-cache active child and parent transactions release with applyLocally false", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const uid = "training-cold-release";
  const roomId = "-trainingColdRelease01";
  const warmDatabase = environment.authenticatedContext(uid).database();
  await assertSucceeds(set(
    ref(warmDatabase, `online/trainingActive/${uid}`),
    {
      ...activeReservation(roomId),
      reservedAt: Date.now(),
    },
  ));

  const coldChildDatabase = environment.authenticatedContext(uid).database();
  const childObserved = [];
  const childTransaction = await runTransaction(
    ref(coldChildDatabase, `online/trainingActive/${uid}/rooms/${roomId}`),
    (current) => {
      childObserved.push(current);
      return current == null || current === true ? null : undefined;
    },
    { applyLocally: false },
  );
  assert.equal(childObserved[0], null);
  assert.equal(childObserved.includes(true), true);
  assert.equal(childTransaction.committed, true);
  assert.equal(childTransaction.snapshot.val(), null);

  const coldParentDatabase = environment.authenticatedContext(uid).database();
  const parentObserved = [];
  const parentTransaction = await runTransaction(
    ref(coldParentDatabase, `online/trainingActive/${uid}`),
    (current) => {
      parentObserved.push(current);
      if (current == null) return null;
      const rooms = current?.rooms && typeof current.rooms === "object"
        ? current.rooms
        : {};
      const hasClaimedRoom = Object.values(rooms).some((claimed) => claimed === true);
      return current?.roomId === roomId && !hasClaimedRoom ? null : undefined;
    },
    { applyLocally: false },
  );
  assert.equal(parentObserved[0], null);
  assert.equal(parentObserved.some((current) => current?.roomId === roomId), true);
  assert.equal(parentTransaction.committed, true);
  assert.equal(parentTransaction.snapshot.val(), null);
  assert.equal(
    (await get(ref(coldParentDatabase, `online/trainingActive/${uid}`))).val(),
    null,
  );
});

test("cold-cache cleanup treats already-missing locks and invites as idempotent", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TRAINING_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const uid = "training-cold-missing";
  const database = environment.authenticatedContext(uid).database();
  const paths = [
    "online/trainingMatchLock",
    `online/trainingInvites/${uid}/-missingOwnInvite01`,
  ];

  for (const targetPath of paths) {
    const observed = [];
    const transaction = await assertSucceeds(runTransaction(
      ref(database, targetPath),
      (current) => {
        observed.push(current);
        return current == null ? null : undefined;
      },
      { applyLocally: false },
    ));
    assert.deepEqual(observed, [null]);
    assert.equal(transaction.committed, true);
    assert.equal(transaction.snapshot.val(), null);
  }
  await assertSucceeds(remove(ref(
    database,
    "online/trainingInvites/training-other/-missingHostInvite01",
  )));
});
