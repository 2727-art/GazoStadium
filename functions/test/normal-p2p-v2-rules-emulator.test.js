"use strict";

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

const RUN_FLAG = "RUN_DATABASE_RULES_TESTS";
const PROJECT_ID_ENV = "P2P_DATABASE_TEST_PROJECT_ID";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";

function parseLoopbackTarget(rawHost) {
  if (!rawHost || rawHost.includes("://") || rawHost.includes("/") || rawHost.includes("@")) {
    throw new Error(`${RUN_FLAG}=1 requires a bare loopback FIREBASE_DATABASE_EMULATOR_HOST.`);
  }
  const parsed = new URL(`http://${rawHost}`);
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(parsed.port);
  if (!["localhost", "127.0.0.1", "::1"].includes(host)
      || !Number.isInteger(port)
      || port < 1
      || port > 65535) {
    throw new Error("Refusing to run the Database Rules test outside a loopback emulator.");
  }
  return { host, port };
}

function requireDemoProjectId(value) {
  if (!/^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(value || "")) {
    throw new Error(`${PROJECT_ID_ENV} must be an explicit demo-* project ID.`);
  }
  return value;
}

if (!RUN_REQUESTED) {
  test("normal P2P V2 Database Rules tests are opt-in and never use production", {
    skip: `set ${RUN_FLAG}=1, FIREBASE_DATABASE_EMULATOR_HOST, and ${PROJECT_ID_ENV}=demo-*`,
  }, () => {});
} else {
  const target = {
    ...parseLoopbackTarget(process.env.FIREBASE_DATABASE_EMULATOR_HOST),
    projectId: requireDemoProjectId(process.env[PROJECT_ID_ENV]),
  };
  const rulesPath = resolve(__dirname, "..", "..", "database.rules.json");
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

  const hostUid = "host-user";
  const guestUid = "guest-user";
  const otherUid = "other-user";
  const hostSessionId = "11111111-1111-4111-8111-111111111111";
  const guestSessionId = "22222222-2222-4222-8222-222222222222";
  const hostLeaseToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const guestLeaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const hostGeneration = "HostGenerationToken001";
  const guestGeneration = "GuestGenerationToken02";
  const roomId = "-V2RulesRoomExample01";
  const connectionGeneration = "connection-generation-01";
  const attemptId = "attempt-id-0000000001";

  let environment;
  let now;

  function claim(sessionId, leaseToken, generation) {
    return {
      protocolVersion: 2,
      sessionId,
      leaseToken,
      generation,
      claimedAt: now - 1_000,
      heartbeatAt: now,
      expiresAt: now + 60_000,
    };
  }

  function queueEntry(uid, sessionId, leaseToken, generation) {
    return {
      protocolVersion: 2,
      uid,
      sessionId,
      leaseToken,
      generation,
      connectionGeneration,
      name: uid === hostUid ? "ホスト" : "ゲスト",
      pursuitLine: "まだ終わらない",
      streak: 0,
      rating: 1_500,
      ratingPreference: "both",
      allowPreferenceMismatch: false,
      reunionPreference: false,
      joinedAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
      state: "waiting",
      sampleCount: 0,
      startingHp: 30,
    };
  }

  function v2Room() {
    return {
      protocolVersion: 2,
      signalingVersion: 2,
      connectionGeneration,
      attemptId,
      hostUid,
      guestUid,
      createdAt: now,
      status: "active",
      members: {
        [hostUid]: true,
        [guestUid]: true,
      },
      sessions: {
        [hostUid]: {
          sessionId: hostSessionId,
          generation: hostGeneration,
        },
        [guestUid]: {
          sessionId: guestSessionId,
          generation: guestGeneration,
        },
      },
    };
  }

  function activeEntry(uid, sessionId, leaseToken, generation, role) {
    return {
      protocolVersion: 2,
      uid,
      sessionId,
      leaseToken,
      generation,
      roomId,
      attemptId,
      connectionGeneration,
      role,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
  }

  function playerRecord(uid, name) {
    return {
      uid,
      name,
      pursuitLine: "まだ終わらない",
      streak: 0,
      rating: 1_500,
      sampleCount: 0,
      startingHp: 30,
    };
  }

  function signalEnvelope() {
    return {
      protocolVersion: 2,
      signalingVersion: 2,
      fromUid: hostUid,
      toUid: guestUid,
      fromSessionId: hostSessionId,
      toSessionId: guestSessionId,
      connectionGeneration,
      attemptId,
      type: "candidate",
      payload: "{\"candidate\":\"redacted-in-test\"}",
      createdAt: now,
    };
  }

  async function seed(values) {
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.database();
      await Promise.all(Object.entries(values).map(([path, value]) => (
        set(ref(database, path), value)
      )));
    });
  }

  before(async () => {
    environment = await initializeTestEnvironment({
      projectId: target.projectId,
      database: {
        host: target.host,
        port: target.port,
        rules: readFileSync(rulesPath, "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearDatabase();
    now = Date.now();
  });

  after(async () => {
    await environment?.cleanup();
  });

  test("claim ownership and private backend paths are enforced", async () => {
    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
      ),
      "online/p2pDiagnostics/2026-07-25/event": { event: "connection-failed" },
    });
    const ownerDb = environment.authenticatedContext(hostUid).database();
    const otherDb = environment.authenticatedContext(otherUid).database();

    await assertFails(get(ref(ownerDb, `online/soloSessionClaims/${hostUid}`)));
    await assertFails(get(ref(otherDb, `online/soloSessionClaims/${hostUid}`)));
    await assertFails(set(
      ref(ownerDb, `online/soloSessionClaims/${hostUid}`),
      claim(hostSessionId, hostLeaseToken, hostGeneration),
    ));
    await assertFails(set(
      ref(ownerDb, `online/soloSessionPresence/${hostUid}/${hostSessionId}`),
      {
        protocolVersion: 2,
        sessionId: hostSessionId,
        leaseToken: hostLeaseToken,
        generation: hostGeneration,
        online: true,
        updatedAt: now,
        expiresAt: now + 60_000,
      },
    ));
    await assertFails(set(
      ref(ownerDb, `online/soloSessionPresence/${hostUid}/${guestSessionId}`),
      {
        protocolVersion: 2,
        sessionId: guestSessionId,
        leaseToken: hostLeaseToken,
        generation: hostGeneration,
        online: true,
        updatedAt: now,
        expiresAt: now + 60_000,
      },
    ));
    await assertFails(remove(
      ref(ownerDb, `online/soloSessionPresence/${hostUid}/${hostSessionId}`),
    ));
    await assertFails(get(ref(ownerDb, "online/p2pDiagnostics/2026-07-25/event")));
    await assertFails(set(ref(ownerDb, "online/p2pRateLimits/turn/test"), { count: 0 }));
  });

  test("queueV2 accepts only a fresh matching claim and never lets a client edit reserved state", async () => {
    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
      ),
    });
    const hostDb = environment.authenticatedContext(hostUid).database();
    const ownQueue = ref(hostDb, `online/queueV2/${hostUid}/${hostSessionId}`);
    await assertSucceeds(set(
      ownQueue,
      queueEntry(hostUid, hostSessionId, hostLeaseToken, hostGeneration),
    ));
    await assertFails(get(ownQueue));
    const otherDb = environment.authenticatedContext(otherUid).database();
    await assertFails(get(ref(
      otherDb,
      `online/queueV2/${hostUid}/${hostSessionId}`,
    )));
    await assertFails(get(ref(hostDb, "online/queueV2")));

    const wrongFence = queueEntry(
      hostUid,
      hostSessionId,
      hostLeaseToken,
      "WrongGenerationToken01",
    );
    await assertFails(set(ownQueue, wrongFence));

    await seed({
      [`online/queueV2/${hostUid}/${hostSessionId}`]: {
        ...queueEntry(hostUid, hostSessionId, hostLeaseToken, hostGeneration),
        state: "reserved",
        attemptId,
        roomId,
      },
    });
    await assertFails(update(ownQueue, { lastSeen: Date.now() }));
    await assertFails(remove(ownQueue));
  });

  test("fresh V2 claim blocks legacy matchmaking writes", async () => {
    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
      ),
    });
    const hostDb = environment.authenticatedContext(hostUid).database();
    const legacyEntry = (uid, name) => ({
      uid,
      name,
      pursuitLine: "まだ終わらない",
      streak: 0,
      rating: 1_500,
      ratingPreference: "both",
      allowPreferenceMismatch: false,
      joinedAt: now,
      lastSeen: now,
      state: "waiting",
      sampleCount: 0,
      startingHp: 30,
    });
    await assertFails(set(
      ref(hostDb, `online/queue/${hostUid}`),
      legacyEntry(hostUid, "ホスト"),
    ));
    await assertFails(set(ref(hostDb, `online/active/${hostUid}`), roomId));

    const legacyDb = environment.authenticatedContext(otherUid).database();
    await assertSucceeds(set(
      ref(legacyDb, `online/queue/${otherUid}`),
      legacyEntry(otherUid, "従来利用者"),
    ));
    await assertSucceeds(set(ref(legacyDb, `online/active/${otherUid}`), roomId));
  });

  test("legacy room setup remains usable while V2 room identity stays backend-only", async () => {
    const legacyRoomId = "-LegacyRulesRoom0001";
    const fencedRoomId = "-V2IdentityFence0001";
    const hostlessFencedRoomId = "-V2HostFenceRoom001";
    await seed({
      [`online/rooms/${fencedRoomId}`]: {
        protocolVersion: 2,
        signalingVersion: 2,
        connectionGeneration,
        attemptId,
        hostUid,
        status: "offered",
        members: { [hostUid]: true },
        sessions: {
          [hostUid]: {
            sessionId: hostSessionId,
            generation: hostGeneration,
          },
          [guestUid]: {
            sessionId: guestSessionId,
            generation: guestGeneration,
          },
        },
      },
      [`online/rooms/${hostlessFencedRoomId}`]: {
        protocolVersion: 2,
        signalingVersion: 2,
        connectionGeneration,
        attemptId,
      },
    });
    const hostDb = environment.authenticatedContext(hostUid).database();

    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/hostUid`),
      hostUid,
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/guestUid`),
      guestUid,
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/createdAt`),
      now,
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/members/${hostUid}`),
      true,
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/members/${guestUid}`),
      true,
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/players/${hostUid}`),
      playerRecord(hostUid, "ホスト"),
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/players/${guestUid}`),
      playerRecord(guestUid, "ゲスト"),
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/status`),
      "offered",
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${legacyRoomId}/destroyed`),
      { by: hostUid, at: now },
    ));

    await assertFails(set(
      ref(hostDb, `online/rooms/${hostlessFencedRoomId}/hostUid`),
      hostUid,
    ));
    await assertFails(set(
      ref(hostDb, `online/rooms/${fencedRoomId}/guestUid`),
      guestUid,
    ));
    await assertFails(set(
      ref(hostDb, `online/rooms/${fencedRoomId}/createdAt`),
      now,
    ));
    await assertFails(set(
      ref(hostDb, `online/rooms/${fencedRoomId}/members/${guestUid}`),
      true,
    ));
    await assertFails(set(
      ref(hostDb, `online/rooms/${fencedRoomId}/players/${hostUid}`),
      playerRecord(hostUid, "ホスト"),
    ));
    await assertFails(set(
      ref(hostDb, `online/rooms/${fencedRoomId}/reunion`),
      true,
    ));
  });

  test("activeV2 is backend-created and client deletion is forbidden", async () => {
    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
      ),
      [`online/rooms/${roomId}`]: v2Room(),
      [`online/activeV2/${hostUid}/${hostSessionId}`]: activeEntry(
        hostUid,
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
        "host",
      ),
    });
    const hostDb = environment.authenticatedContext(hostUid).database();
    const otherDb = environment.authenticatedContext(otherUid).database();
    const activePath = `online/activeV2/${hostUid}/${hostSessionId}`;

    await assertFails(get(ref(hostDb, activePath)));
    await assertFails(set(
      ref(hostDb, activePath),
      activeEntry(hostUid, hostSessionId, hostLeaseToken, hostGeneration, "host"),
    ));
    await assertFails(remove(ref(otherDb, activePath)));
    await assertFails(remove(ref(hostDb, activePath)));
  });

  test("a replaced tab cannot delete fenced queue, private session metadata, or active records", async () => {
    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        "WrongGenerationToken01",
      ),
      [`online/queueV2/${hostUid}/${hostSessionId}`]: queueEntry(
        hostUid,
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
      ),
      [`online/soloSessionPresence/${hostUid}/${hostSessionId}`]: {
        protocolVersion: 2,
        sessionId: hostSessionId,
        leaseToken: hostLeaseToken,
        generation: hostGeneration,
        online: true,
        updatedAt: now,
        expiresAt: now + 60_000,
      },
      [`online/rooms/${roomId}`]: v2Room(),
      [`online/activeV2/${hostUid}/${hostSessionId}`]: activeEntry(
        hostUid,
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
        "host",
      ),
    });
    const oldTabDb = environment.authenticatedContext(hostUid).database();

    await assertFails(remove(ref(
      oldTabDb,
      `online/queueV2/${hostUid}/${hostSessionId}`,
    )));
    await assertFails(remove(ref(
      oldTabDb,
      `online/soloSessionPresence/${hostUid}/${hostSessionId}`,
    )));
    await assertFails(remove(ref(
      oldTabDb,
      `online/activeV2/${hostUid}/${hostSessionId}`,
    )));
  });

  test("offersV2 can be read only by the current target session and never written by clients", async () => {
    const offerPath = `online/offersV2/${guestUid}/${guestSessionId}/${roomId}`;
    await seed({
      [`online/soloSessionClaims/${guestUid}`]: claim(
        guestSessionId,
        guestLeaseToken,
        guestGeneration,
      ),
      [offerPath]: {
        protocolVersion: 2,
        signalingVersion: 2,
        roomId,
        attemptId,
        connectionGeneration,
        fromUid: hostUid,
        toUid: guestUid,
        fromSessionId: hostSessionId,
        toSessionId: guestSessionId,
        createdAt: now,
        expiresAt: now + 60_000,
      },
    });
    const guestDb = environment.authenticatedContext(guestUid).database();
    const hostDb = environment.authenticatedContext(hostUid).database();

    await assertSucceeds(get(ref(guestDb, offerPath)));
    await assertFails(get(ref(hostDb, offerPath)));
    await assertFails(remove(ref(guestDb, offerPath)));
  });

  test("signalsV2 accept the room sender fence and only the current target session consumes", async () => {
    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
      ),
      [`online/soloSessionClaims/${guestUid}`]: claim(
        guestSessionId,
        guestLeaseToken,
        guestGeneration,
      ),
      [`online/rooms/${roomId}`]: v2Room(),
    });
    const hostDb = environment.authenticatedContext(hostUid).database();
    const guestDb = environment.authenticatedContext(guestUid).database();
    const signalPath = `online/rooms/${roomId}/signalsV2/${guestUid}/${guestSessionId}/message-1`;
    const hostPresencePath = `online/rooms/${roomId}/presenceV2/${hostUid}/${hostSessionId}`;

    await assertSucceeds(set(ref(hostDb, hostPresencePath), {
      protocolVersion: 2,
      sessionId: hostSessionId,
      leaseToken: hostLeaseToken,
      generation: hostGeneration,
      online: true,
      updatedAt: now,
    }));
    await assertFails(set(ref(hostDb, hostPresencePath), {
      online: false,
      updatedAt: now,
    }));
    await assertSucceeds(set(ref(hostDb, signalPath), signalEnvelope()));
    await assertFails(remove(ref(hostDb, signalPath)));
    await assertSucceeds(remove(ref(guestDb, signalPath)));

    const staleTargetSignalPath = `online/rooms/${roomId}/signalsV2/${guestUid}/${guestSessionId}/message-2`;
    await assertSucceeds(set(ref(hostDb, staleTargetSignalPath), signalEnvelope()));
    await seed({
      [`online/soloSessionClaims/${guestUid}`]: claim(
        guestSessionId,
        guestLeaseToken,
        "WrongGenerationToken01",
      ),
    });
    await assertFails(remove(ref(guestDb, staleTargetSignalPath)));

    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        "WrongGenerationToken01",
      ),
    });
    await assertFails(set(
      ref(
        hostDb,
        `online/rooms/${roomId}/signalsV2/${guestUid}/${guestSessionId}/message-3`,
      ),
      signalEnvelope(),
    ));

    await assertFails(set(
      ref(hostDb, `online/rooms/${roomId}/signals/${guestUid}/legacy-message`),
      {
        fromUid: hostUid,
        type: "candidate",
        payload: "{}",
        createdAt: now,
      },
    ));
  });

  test("V2 gameplay writes stop when the room session loses its current claim", async () => {
    const destroyableRoomId = "-V2RulesRoomDestroy02";
    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        hostGeneration,
      ),
      [`online/soloSessionClaims/${guestUid}`]: claim(
        guestSessionId,
        guestLeaseToken,
        guestGeneration,
      ),
      [`online/rooms/${roomId}`]: v2Room(),
      [`online/rooms/${destroyableRoomId}`]: v2Room(),
    });
    const hostDb = environment.authenticatedContext(hostUid).database();
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${roomId}/rounds/1/selectionReady/${hostUid}`),
      true,
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${roomId}/chat/current-session-message`),
      {
        authorUid: hostUid,
        name: "ホスト",
        text: "現在のセッション",
        round: 1,
        createdAt: now,
      },
    ));
    await assertSucceeds(set(
      ref(hostDb, `online/rooms/${destroyableRoomId}/destroyed`),
      { by: hostUid, at: now },
    ));

    await seed({
      [`online/soloSessionClaims/${hostUid}`]: claim(
        hostSessionId,
        hostLeaseToken,
        "ReplacementGeneration1",
      ),
    });
    await assertFails(set(
      ref(hostDb, `online/rooms/${roomId}/rounds/1/picks/${hostUid}`),
      { ready: true, lockedAt: now },
    ));
    await assertFails(set(
      ref(hostDb, `online/rooms/${roomId}/chat/stale-session-message`),
      {
        authorUid: hostUid,
        name: "ホスト",
        text: "古いセッション",
        round: 1,
        createdAt: now,
      },
    ));
    await assertFails(set(
      ref(hostDb, `online/rooms/${roomId}/destroyed`),
      { by: hostUid, at: now },
    ));
  });
}
