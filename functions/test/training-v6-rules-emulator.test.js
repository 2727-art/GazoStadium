"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

const RUN_FLAG = "RUN_TRAINING_V6_RULES_EMULATOR_TESTS";
const PROJECT_ID_ENV = "TRAINING_V6_RULES_TEST_PROJECT_ID";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";

function parseLoopbackTarget(rawHost) {
  if (!rawHost
      || rawHost.includes("://")
      || rawHost.includes("/")
      || rawHost.includes("@")) {
    throw new Error(
      `${RUN_FLAG}=1 requires a bare loopback FIREBASE_DATABASE_EMULATOR_HOST.`,
    );
  }
  const parsed = new URL(`http://${rawHost}`);
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(parsed.port);
  if (!["localhost", "127.0.0.1", "::1"].includes(host)
      || !Number.isInteger(port)
      || port < 1
      || port > 65535) {
    throw new Error(
      "Refusing to run the Training 60 V6 Rules test outside a loopback emulator.",
    );
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
  test("Training 60 V6 Database Rules tests are opt-in and never use production", {
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
  } = require("firebase/database");

  const roomId = "training-v6-room-rules";
  const firstUid = "training-v6-first";
  const secondUid = "training-v6-second";
  const outsiderUid = "training-v6-outsider";
  const firstConnectionId = "first-connection-000000000001";
  const secondConnectionId = "second-connection-0000000001";
  const oldFirstConnectionId = "first-connection-old-0000001";
  const oldSecondConnectionId = "second-connection-old-000001";
  const roomPath = `online/trainingV6/state/rooms/${roomId}`;
  const ticketsPath = "online/trainingV6/state/tickets";

  let environment;
  let now;

  function profile(displayName) {
    return {
      displayName,
      maxBpm: 120,
      allowedExercises: ["squat", "push_up"],
      conditionText: "",
    };
  }

  function roomFixture() {
    return {
      protocolVersion: 6,
      variant: "companion_v6",
      roomId,
      phase: "media_exchange",
      revision: 1,
      transportRevision: 2,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + (24 * 60 * 60_000),
      members: {
        [firstUid]: true,
        [secondUid]: true,
      },
      memberOrder: {
        0: firstUid,
        1: secondUid,
      },
      participantUids: [firstUid, secondUid],
      players: {
        [firstUid]: {
          uid: firstUid,
          joinedAt: now,
          profile: profile("FIRST"),
        },
        [secondUid]: {
          uid: secondUid,
          joinedAt: now,
          profile: profile("SECOND"),
        },
      },
      roundNumber: 1,
      rounds: {
        1: {
          roundNumber: 1,
          images: {},
          scores: {},
        },
      },
      workoutQueue: [],
      activeWorkoutIndex: -1,
      connections: {
        [firstUid]: {
          connectionId: firstConnectionId,
          generation: 1,
          claimedAt: now,
        },
        [secondUid]: {
          connectionId: secondConnectionId,
          generation: 1,
          claimedAt: now,
        },
      },
      finishedBy: {},
    };
  }

  function ticketFixture(ticketId) {
    return {
      protocolVersion: 6,
      ticketId,
      state: "matched",
      roomId,
      updatedAt: now,
    };
  }

  function presencePayload(connectionId) {
    return {
      protocolVersion: 6,
      connectionId,
      online: true,
      updatedAt: Date.now(),
    };
  }

  function signalPayload({
    fromUid,
    toUid,
    type = "offer",
    fromConnectionId,
    toConnectionId,
    overrides = {},
  }) {
    return {
      protocolVersion: 6,
      fromConnectionId,
      toConnectionId,
      fromUid,
      toUid,
      type,
      ...(type === "candidate"
        ? {
          candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        }
        : { sdp: "v=0\r\ns=training-v6-rules-test" }),
      createdAt: Date.now(),
      ...overrides,
    };
  }

  function firstToSecondSignal(type = "offer", overrides = {}) {
    return signalPayload({
      fromUid: firstUid,
      toUid: secondUid,
      type,
      fromConnectionId: firstConnectionId,
      toConnectionId: secondConnectionId,
      overrides,
    });
  }

  async function seedFixture() {
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.database();
      await set(ref(database, roomPath), roomFixture());
      await set(
        ref(database, `${ticketsPath}/${firstUid}`),
        ticketFixture("first-ticket-000000000001"),
      );
      await set(
        ref(database, `${ticketsPath}/${secondUid}`),
        ticketFixture("second-ticket-00000000001"),
      );
    });
  }

  async function adminRemove(targetPath) {
    await environment.withSecurityRulesDisabled(async (context) => {
      await remove(ref(context.database(), targetPath));
    });
  }

  async function adminSet(targetPath, value) {
    await environment.withSecurityRulesDisabled(async (context) => {
      await set(ref(context.database(), targetPath), value);
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
    await seedFixture();
  });

  after(async () => {
    await environment?.cleanup();
  });

  test("fixed members retain room access after tickets are deleted", async () => {
    const firstDatabase = environment.authenticatedContext(firstUid).database();
    const secondDatabase = environment.authenticatedContext(secondUid).database();
    const outsiderDatabase = environment.authenticatedContext(
      outsiderUid,
    ).database();

    assert.equal(
      (await assertSucceeds(get(ref(firstDatabase, roomPath)))).val()?.roomId,
      roomId,
    );
    await assertSucceeds(get(ref(secondDatabase, roomPath)));
    await assertFails(get(ref(outsiderDatabase, roomPath)));

    await adminRemove(`${ticketsPath}/${firstUid}`);
    await adminRemove(`${ticketsPath}/${secondUid}`);

    await assertSucceeds(get(ref(firstDatabase, roomPath)));
    await assertSucceeds(get(ref(secondDatabase, roomPath)));
    await assertFails(get(ref(outsiderDatabase, roomPath)));
  });

  test("members cannot mutate canonical room state or private scores", async () => {
    const firstDatabase = environment.authenticatedContext(firstUid).database();
    const secondDatabase = environment.authenticatedContext(secondUid).database();

    await assertFails(set(ref(firstDatabase, roomPath), roomFixture()));
    await assertFails(set(ref(firstDatabase, `${roomPath}/phase`), "scoring"));
    await assertFails(set(ref(
      secondDatabase,
      `${roomPath}/revision`,
    ), 2));
    await assertFails(set(ref(
      firstDatabase,
      `online/trainingV6/state/privateScores/${roomId}/1/${firstUid}`,
    ), {
      value: 8,
      submittedAt: Date.now(),
    }));
    await assertFails(get(ref(
      firstDatabase,
      `online/trainingV6/state/privateScores/${roomId}/1/${firstUid}`,
    )));
    await assertFails(set(ref(
      firstDatabase,
      `online/trainingV6/state/finalizationOutbox/${roomId}`,
    ), {
      protocolVersion: 6,
      roomId,
      participantUid: firstUid,
      terminalAt: Date.now(),
    }));
    await assertFails(get(ref(
      firstDatabase,
      `online/trainingV6/state/finalizationOutbox/${roomId}`,
    )));
  });

  test("only a member's own presence branch is writable", async () => {
    const firstDatabase = environment.authenticatedContext(firstUid).database();
    const secondDatabase = environment.authenticatedContext(secondUid).database();
    const outsiderDatabase = environment.authenticatedContext(
      outsiderUid,
    ).database();
    const firstPresencePath =
      `online/trainingV6/presence/${roomId}/${firstUid}`;
    const secondPresencePath =
      `online/trainingV6/presence/${roomId}/${secondUid}`;
    const outsiderPresencePath =
      `online/trainingV6/presence/${roomId}/${outsiderUid}`;

    await assertSucceeds(set(
      ref(firstDatabase, firstPresencePath),
      presencePayload(firstConnectionId),
    ));
    await assertSucceeds(get(ref(secondDatabase, firstPresencePath)));
    await assertFails(set(
      ref(firstDatabase, secondPresencePath),
      presencePayload(firstConnectionId),
    ));
    await assertFails(set(
      ref(secondDatabase, firstPresencePath),
      presencePayload(secondConnectionId),
    ));
    await assertFails(set(
      ref(outsiderDatabase, outsiderPresencePath),
      presencePayload("outsider-connection-00000001"),
    ));
    await assertSucceeds(remove(ref(firstDatabase, firstPresencePath)));
  });

  test("signals require both current connection IDs and a member sender", async () => {
    const firstDatabase = environment.authenticatedContext(firstUid).database();
    const secondDatabase = environment.authenticatedContext(secondUid).database();
    const outsiderDatabase = environment.authenticatedContext(
      outsiderUid,
    ).database();
    const validCases = [
      {
        id: "valid-offer-0001",
        senderDatabase: firstDatabase,
        recipientDatabase: secondDatabase,
        senderUid: firstUid,
        recipientUid: secondUid,
        payload: firstToSecondSignal("offer"),
      },
      {
        id: "valid-answer-0001",
        senderDatabase: secondDatabase,
        recipientDatabase: firstDatabase,
        senderUid: secondUid,
        recipientUid: firstUid,
        payload: signalPayload({
          fromUid: secondUid,
          toUid: firstUid,
          type: "answer",
          fromConnectionId: secondConnectionId,
          toConnectionId: firstConnectionId,
        }),
      },
      {
        id: "valid-candidate-0001",
        senderDatabase: firstDatabase,
        recipientDatabase: secondDatabase,
        senderUid: firstUid,
        recipientUid: secondUid,
        payload: firstToSecondSignal("candidate"),
      },
    ];

    for (const entry of validCases) {
      const signalPath =
        `online/trainingV6/signals/${roomId}/${entry.recipientUid}/${
          entry.senderUid
        }/${entry.id}`;
      await assertSucceeds(set(
        ref(entry.senderDatabase, signalPath),
        entry.payload,
      ));
      assert.equal(
        (await assertSucceeds(get(
          ref(entry.recipientDatabase, signalPath),
        ))).val()?.type,
        entry.payload.type,
      );
      await assertFails(get(ref(entry.senderDatabase, signalPath)));
      await assertFails(get(ref(outsiderDatabase, signalPath)));
      await assertFails(remove(ref(entry.senderDatabase, signalPath)));
      await assertSucceeds(remove(ref(entry.recipientDatabase, signalPath)));
    }

    const signalBase =
      `online/trainingV6/signals/${roomId}/${secondUid}/${firstUid}`;
    await assertFails(set(
      ref(firstDatabase, `${signalBase}/old-from-connection`),
      firstToSecondSignal("offer", {
        fromConnectionId: oldFirstConnectionId,
      }),
    ));
    await assertFails(set(
      ref(firstDatabase, `${signalBase}/old-to-connection`),
      firstToSecondSignal("offer", {
        toConnectionId: oldSecondConnectionId,
      }),
    ));
    await assertFails(set(
      ref(firstDatabase, `${signalBase}/legacy-connection-id`),
      firstToSecondSignal("offer", {
        connectionId: firstConnectionId,
      }),
    ));
    await assertFails(set(
      ref(firstDatabase, `${signalBase}/body-field-message`),
      firstToSecondSignal("offer", {
        message: "本文はP2Pデータチャネルだけで送ります",
      }),
    ));
    await assertFails(set(
      ref(
        outsiderDatabase,
        `online/trainingV6/signals/${roomId}/${secondUid}/${outsiderUid}/outsider-signal`,
      ),
      signalPayload({
        fromUid: outsiderUid,
        toUid: secondUid,
        fromConnectionId: "outsider-connection-00000001",
        toConnectionId: secondConnectionId,
      }),
    ));
    await assertFails(set(
      ref(outsiderDatabase, `${signalBase}/forged-member-sender`),
      firstToSecondSignal(),
    ));
  });

  test("terminal or expired rooms reject transport writes but allow cleanup deletes", async () => {
    const firstDatabase = environment.authenticatedContext(firstUid).database();
    const secondDatabase = environment.authenticatedContext(secondUid).database();
    const presencePath =
      `online/trainingV6/presence/${roomId}/${firstUid}`;
    const terminalSignalPath =
      `online/trainingV6/signals/${roomId}/${secondUid}/${firstUid}/terminal-gate-0001`;

    await assertSucceeds(set(
      ref(firstDatabase, presencePath),
      presencePayload(firstConnectionId),
    ));
    await assertSucceeds(set(
      ref(firstDatabase, terminalSignalPath),
      firstToSecondSignal(),
    ));
    await adminSet(`${roomPath}/phase`, "complete");

    await assertFails(set(
      ref(firstDatabase, presencePath),
      presencePayload(firstConnectionId),
    ));
    await assertFails(set(
      ref(
        firstDatabase,
        `online/trainingV6/signals/${roomId}/${secondUid}/${firstUid}/terminal-gate-0002`,
      ),
      firstToSecondSignal(),
    ));
    await assertSucceeds(remove(ref(firstDatabase, presencePath)));
    await assertSucceeds(remove(ref(secondDatabase, terminalSignalPath)));

    await adminSet(`${roomPath}/phase`, "media_exchange");
    await adminSet(`${roomPath}/expiresAt`, Date.now() + 60_000);
    const expiredSignalPath =
      `online/trainingV6/signals/${roomId}/${secondUid}/${firstUid}/expired-gate-0001`;
    await assertSucceeds(set(
      ref(firstDatabase, presencePath),
      presencePayload(firstConnectionId),
    ));
    await assertSucceeds(set(
      ref(firstDatabase, expiredSignalPath),
      firstToSecondSignal(),
    ));
    await adminSet(`${roomPath}/expiresAt`, Date.now() - 1);

    await assertFails(set(
      ref(firstDatabase, presencePath),
      presencePayload(firstConnectionId),
    ));
    await assertFails(set(
      ref(
        firstDatabase,
        `online/trainingV6/signals/${roomId}/${secondUid}/${firstUid}/expired-gate-0002`,
      ),
      firstToSecondSignal(),
    ));
    await assertSucceeds(remove(ref(firstDatabase, presencePath)));
    await assertSucceeds(remove(ref(secondDatabase, expiredSignalPath)));
  });
}
