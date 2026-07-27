"use strict";

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

const RUN_FLAG = "RUN_MARKET_DATABASE_RULES_TESTS";
const PROJECT_ID_ENV = "MARKET_DATABASE_TEST_PROJECT_ID";
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
    throw new Error("Refusing to run the VALUE MARKET Rules test outside a loopback emulator.");
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
  test("VALUE MARKET Database Rules tests are opt-in and never use production", {
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
    ref,
    remove,
    set,
  } = require("firebase/database");

  const roomId = "market-room-rules-test";
  const sellerUid = "market-seller";
  const buyerUid = "market-buyer";
  const outsiderUid = "market-outsider";
  const validConnectionId = "12345678-1234-4123-8123-123456789abc";

  let environment;
  let now;

  function signal(type, fromUid, overrides = {}) {
    return {
      fromUid,
      type,
      payload: JSON.stringify({ type, sdp: "redacted-in-test" }),
      connectionId: validConnectionId,
      createdAt: now,
      ...overrides,
    };
  }

  async function seedRoom() {
    await environment.withSecurityRulesDisabled(async (context) => {
      await set(ref(context.database(), `online/valueMarketRooms/${roomId}`), {
        members: {
          [sellerUid]: true,
          [buyerUid]: true,
        },
        roles: {
          [sellerUid]: "seller",
          [buyerUid]: "buyer",
        },
        names: {
          [sellerUid]: "SELLER",
          [buyerUid]: "BUYER",
        },
        status: "preview",
        turn: 1,
        stateVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
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
    await seedRoom();
  });

  after(async () => {
    await environment?.cleanup();
  });

  test("participants may exchange and consume fenced offer, answer, and candidate signals", async () => {
    const sellerDatabase = environment.authenticatedContext(sellerUid).database();
    const buyerDatabase = environment.authenticatedContext(buyerUid).database();
    const cases = [
      ["offer", sellerDatabase, buyerDatabase, sellerUid, buyerUid],
      ["answer", buyerDatabase, sellerDatabase, buyerUid, sellerUid],
      ["candidate", sellerDatabase, buyerDatabase, sellerUid, buyerUid],
    ];

    for (const [type, senderDatabase, receiverDatabase, senderUid, targetUid] of cases) {
      const signalReference = ref(
        senderDatabase,
        `online/valueMarketRooms/${roomId}/signals/${targetUid}/${type}-signal`,
      );
      await assertSucceeds(set(signalReference, signal(type, senderUid)));
      await assertFails(remove(signalReference));
      await assertSucceeds(remove(ref(
        receiverDatabase,
        `online/valueMarketRooms/${roomId}/signals/${targetUid}/${type}-signal`,
      )));
    }
  });

  test("legacy and mixed-version connection IDs remain compatible", async () => {
    const sellerDatabase = environment.authenticatedContext(sellerUid).database();
    const buyerDatabase = environment.authenticatedContext(buyerUid).database();
    const legacySignal = signal("offer", sellerUid);
    delete legacySignal.connectionId;

    await assertSucceeds(set(
      ref(
        sellerDatabase,
        `online/valueMarketRooms/${roomId}/signals/${buyerUid}/legacy-offer`,
      ),
      legacySignal,
    ));
    await assertSucceeds(set(
      ref(
        buyerDatabase,
        `online/valueMarketRooms/${roomId}/signals/${sellerUid}/mixed-version-answer`,
      ),
      signal("answer", buyerUid, { connectionId: "" }),
    ));
    await assertSucceeds(set(
      ref(
        sellerDatabase,
        `online/valueMarketRooms/${roomId}/signals/${buyerUid}/fallback-connection-id`,
      ),
      signal("candidate", sellerUid, { connectionId: "ms3266u8-" }),
    ));
  });

  test("malformed connection IDs and unknown fields are rejected", async () => {
    const sellerDatabase = environment.authenticatedContext(sellerUid).database();
    const target = `online/valueMarketRooms/${roomId}/signals/${buyerUid}`;

    await assertFails(set(
      ref(sellerDatabase, `${target}/non-string-connection-id`),
      signal("offer", sellerUid, { connectionId: 12345 }),
    ));
    await assertFails(set(
      ref(sellerDatabase, `${target}/object-connection-id`),
      signal("offer", sellerUid, { connectionId: { unsafe: true } }),
    ));
    await assertFails(set(
      ref(sellerDatabase, `${target}/invalid-connection-id`),
      signal("offer", sellerUid, { connectionId: "valid-length-but_not-safe" }),
    ));
    await assertFails(set(
      ref(sellerDatabase, `${target}/oversized-connection-id`),
      signal("offer", sellerUid, { connectionId: "a".repeat(65) }),
    ));
    await assertFails(set(
      ref(sellerDatabase, `${target}/unknown-field`),
      signal("offer", sellerUid, { unexpected: true }),
    ));
  });

  test("non-members and forged senders remain rejected", async () => {
    const sellerDatabase = environment.authenticatedContext(sellerUid).database();
    const outsiderDatabase = environment.authenticatedContext(outsiderUid).database();

    await assertFails(set(
      ref(
        sellerDatabase,
        `online/valueMarketRooms/${roomId}/signals/${buyerUid}/forged-sender`,
      ),
      signal("offer", buyerUid),
    ));
    await assertFails(set(
      ref(
        outsiderDatabase,
        `online/valueMarketRooms/${roomId}/signals/${buyerUid}/outsider`,
      ),
      signal("offer", outsiderUid),
    ));
  });
}
