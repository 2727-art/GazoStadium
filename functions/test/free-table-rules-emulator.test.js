"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { get, ref, remove, set, update } = require("firebase/database");
const { pairIdFor } = require("../player-safety");

const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.FREE_TABLE_RULES_TEST_PROJECT_ID || "demo-free-table-retired";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);
const options = { skip: safeEmulator ? false : "run with a loopback Database Emulator and a demo-* project" };
const HOST = "retired-table-host";
const VISITOR = "retired-table-visitor";
const SESSION = "S".repeat(24);
const ROOM = "R".repeat(24);
const REQUEST = "Q".repeat(24);
const CHAT = `${"C".repeat(20)}0000`;
const SIGNAL = `${"S".repeat(22)}00`;
const PAIR = pairIdFor(HOST, VISITOR);

async function environmentFor(context) {
  const [host, port] = emulatorHost.split(":");
  const environment = await initializeTestEnvironment({ projectId,
    database: { host, port: Number(port),
      rules: fs.readFileSync(path.resolve(__dirname, "../..", "database.rules.json"), "utf8") },
  });
  context.after(() => environment.cleanup());
  await environment.clearDatabase();
  return environment;
}

function contact(mode, roomId, now) {
  return { firstUid: HOST, secondUid: VISITOR, mode, roomId, active: true,
    createdAt: now, startedAt: now, expiresAt: now + 120_000 };
}

test("retired free-table reads and valid legacy writes are denied at every surface", options, async (t) => {
  const environment = await environmentFor(t);
  const now = Date.now();
  const expiresAt = now + 3_600_000;
  const session = { sessionId: SESSION, roomId: ROOM, hostUid: HOST, visitorUid: VISITOR,
    participants: { [HOST]: true, [VISITOR]: true }, status: "active", expiresAt,
    safetyPairId: PAIR, safetyGrantId: "grant-free-table", safetyVersion: 1 };
  const chat = { authorUid: HOST, authorRole: "host", type: "text", text: "still open in an old tab",
    createdAt: now, expiresAt: now + 60_000 };
  const signal = { fromUid: HOST, toUid: VISITOR, type: "offer", payload: "legacy-offer",
    createdAt: now, expiresAt: now + 60_000 };
  const presence = { online: true, lastSeen: now, expiresAt: now + 30_000 };
  await environment.withSecurityRulesDisabled(async (admin) => {
    await update(ref(admin.database()), {
      "online/config/playerSafetyEnabled": true,
      [`online/contactGates/${PAIR}`]: { initialized: true, blocked: false, version: 1,
        participants: { [HOST]: true, [VISITOR]: true },
        grants: { "grant-free-table": contact("free_table", SESSION, now) } },
      freeTables: {
        publicRooms: { [ROOM]: { publicRoomId: ROOM, state: "open", expiresAt } },
        roomStates: { [ROOM]: { hostUid: HOST, state: "active", session } },
        roomOwners: { [ROOM]: { uid: HOST, expiresAt } },
        openGenerations: { [HOST]: 1 }, engagements: { [HOST]: { sessionId: SESSION, expiresAt } },
        hostActive: { [HOST]: { roomId: ROOM, sessionId: SESSION, expiresAt } },
        visitorPending: { [VISITOR]: { roomId: ROOM, requestId: REQUEST, expiresAt } },
        requests: { [ROOM]: { [REQUEST]: { visitorUid: VISITOR, expiresAt } } },
        active: { [HOST]: { sessionId: SESSION, expiresAt }, [VISITOR]: { sessionId: SESSION, expiresAt } },
        sessions: { [SESSION]: session }, presence: { [SESSION]: { [HOST]: presence } },
        chat: { [SESSION]: { [CHAT]: chat } }, signals: { [SESSION]: { [VISITOR]: { [SIGNAL]: signal } } },
        invites: { ["I".repeat(32)]: { roomId: ROOM, expiresAt } },
        hostInvites: { [HOST]: { inviteId: "I".repeat(32), expiresAt } },
      },
    });
  });
  const paths = ["freeTables", `freeTables/publicRooms/${ROOM}`, `freeTables/roomStates/${ROOM}`,
    `freeTables/roomOwners/${ROOM}`, `freeTables/openGenerations/${HOST}`, `freeTables/engagements/${HOST}`,
    `freeTables/hostActive/${HOST}`, `freeTables/visitorPending/${VISITOR}`, `freeTables/requests/${ROOM}`,
    `freeTables/requests/${ROOM}/${REQUEST}`, `freeTables/active/${HOST}`, `freeTables/active/${VISITOR}`,
    `freeTables/sessions/${SESSION}`, `freeTables/sessions/${SESSION}/status`,
    `freeTables/presence/${SESSION}`, `freeTables/presence/${SESSION}/${HOST}`,
    `freeTables/chat/${SESSION}`, `freeTables/chat/${SESSION}/${CHAT}`,
    `freeTables/signals/${SESSION}/${VISITOR}`, `freeTables/signals/${SESSION}/${VISITOR}/${SIGNAL}`,
    `freeTables/invites/${"I".repeat(32)}`, `freeTables/hostInvites/${HOST}`];
  const databases = [environment.unauthenticatedContext().database(),
    ...[HOST, VISITOR, "retired-table-outsider"].map((uid) => environment.authenticatedContext(uid).database())];
  for (const database of databases) {
    for (const location of paths) {
      await assertFails(get(ref(database, location)), `read ${location}`);
      await assertFails(remove(ref(database, location)), `delete ${location}`);
    }
    // These shapes met the old writer rules; rejection cannot be attributed to malformed payloads.
    await assertFails(set(ref(database, `freeTables/presence/${SESSION}/${HOST}`), presence));
    await assertFails(set(ref(database, `freeTables/chat/${SESSION}/${"C".repeat(20)}0001`), chat));
    await assertFails(set(ref(database, `freeTables/signals/${SESSION}/${VISITOR}/${"S".repeat(22)}01`), signal));
    await assertFails(update(ref(database, "freeTables"), { [`sessions/${SESSION}/status`]: "active" }));
  }
  await environment.withSecurityRulesDisabled(async (admin) => {
    assert.deepEqual((await get(ref(admin.database(), `freeTables/sessions/${SESSION}`))).val(), session);
  });
});

test("free-table retirement preserves normal and strategy contacts, chat, and signaling", options, async (t) => {
  const environment = await environmentFor(t);
  const now = Date.now();
  const database = environment.authenticatedContext(HOST).database();
  const outsider = environment.authenticatedContext("retired-table-outsider").database();
  for (const mode of ["solo", "strategy"]) {
    const roomId = `${mode}-still-active`;
    const roomPath = `online/${mode === "solo" ? "rooms" : "strategyRooms"}/${roomId}`;
    const grantId = `grant-${mode}`;
    await environment.withSecurityRulesDisabled(async (admin) => {
      await update(ref(admin.database()), {
        "online/config/playerSafetyEnabled": true,
        [roomPath]: { hostUid: HOST, guestUid: VISITOR, status: "active", turn: 1,
          members: { [HOST]: true, [VISITOR]: true }, createdAt: now,
          safetyPairId: PAIR, safetyGrantId: grantId, safetyVersion: 1 },
        [`online/contactGates/${PAIR}`]: { initialized: true, blocked: false, version: 1,
          participants: { [HOST]: true, [VISITOR]: true }, grants: { [grantId]: contact(mode, roomId, now) } },
      });
    });
    await assertSucceeds(get(ref(database, roomPath)));
    await assertFails(get(ref(outsider, roomPath)));
    const chatPath = mode === "solo" ? `${roomPath}/chat/message-one` : `online/strategyChats/${roomId}/message-one`;
    const chat = mode === "solo"
      ? { authorUid: HOST, name: "Host", text: "hello", round: 1, createdAt: now }
      : { authorUid: HOST, text: "hello", phase: "scout", round: 1, createdAt: now };
    await assertSucceeds(set(ref(database, chatPath), chat));
    await assertSucceeds(set(ref(database, `${roomPath}/signals/${VISITOR}/signal-one`),
      { fromUid: HOST, type: "offer", payload: "offer", createdAt: now }));
    await assertFails(update(ref(database), {
      [`${chatPath}-two`]: chat, [`freeTables/sessions/${SESSION}/status`]: "active",
    }));
    await environment.withSecurityRulesDisabled(async (admin) => {
      assert.equal((await get(ref(admin.database(), `${chatPath}-two`))).exists(), false,
        "a denied multi-location write must not partially modify the live mode");
      await set(ref(admin.database(), `online/contactGates/${PAIR}/blocked`), true);
    });
    await assertFails(get(ref(database, roomPath)));
    await assertFails(set(ref(database, `${chatPath}-blocked`), chat));
  }
});
