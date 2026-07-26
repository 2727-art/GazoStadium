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
  set,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.FREE_TABLE_RULES_TEST_PROJECT_ID || "demo-free-table";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);
const SESSION_ID = "S".repeat(24);
const HOST_UID = "free-table-host";
const VISITOR_UID = "free-table-visitor";
const OUTSIDER_UID = "free-table-outsider";
const chatSlotId = (role, index) => (
  `${"C".repeat(20)}${role === "host" ? "0" : "1"}${String(index).padStart(3, "0")}`
);
const signalSlotId = (index) => (
  `${"S".repeat(22)}${String(index).padStart(2, "0")}`
);

async function environmentFor(context) {
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

test("free table client records accept exact short-lived shapes and reject TTL bypasses", {
  skip: safeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* FREE_TABLE_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await environmentFor(context);
  const now = Date.now();
  const sessionExpiresAt = now + (2 * 60 * 60 * 1000);
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await set(ref(adminContext.database(), "freeTables"), {
      publicRooms: {
        ["R".repeat(24)]: {
          publicRoomId: "R".repeat(24),
          publicMemberId: "M".repeat(24),
          state: "open",
          expiresAt: now + 120_000,
        },
      },
      active: {
        [HOST_UID]: {
          sessionId: SESSION_ID,
          role: "host",
          expiresAt: sessionExpiresAt,
        },
        [VISITOR_UID]: {
          sessionId: SESSION_ID,
          role: "visitor",
          expiresAt: sessionExpiresAt,
        },
      },
      sessions: {
        [SESSION_ID]: {
          sessionId: SESSION_ID,
          hostUid: HOST_UID,
          visitorUid: VISITOR_UID,
          participants: {
            [HOST_UID]: true,
            [VISITOR_UID]: true,
          },
          status: "active",
          expiresAt: sessionExpiresAt,
        },
      },
    });
  });

  const hostDatabase = environment.authenticatedContext(HOST_UID).database();
  const visitorDatabase = environment.authenticatedContext(VISITOR_UID).database();
  const outsiderDatabase = environment.authenticatedContext(OUTSIDER_UID).database();

  await assertFails(get(ref(hostDatabase, "freeTables/publicRooms")));
  await assertSucceeds(get(ref(hostDatabase, `freeTables/sessions/${SESSION_ID}`)));
  await assertFails(get(ref(outsiderDatabase, `freeTables/sessions/${SESSION_ID}`)));

  await assertSucceeds(set(
    ref(hostDatabase, `freeTables/presence/${SESSION_ID}/${HOST_UID}`),
    {
      online: true,
      lastSeen: now,
      expiresAt: now + 45_000,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/presence/${SESSION_ID}/${HOST_UID}`),
    {
      online: true,
      lastSeen: now,
      expiresAt: sessionExpiresAt,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/presence/${SESSION_ID}/${HOST_UID}`),
    {
      online: true,
      lastSeen: now,
      expiresAt: now + 45_000,
      uid: HOST_UID,
    },
  ));
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await set(
      ref(adminContext.database(), `freeTables/presence/${SESSION_ID}/_disconnect`),
      {
        state: "locked",
        sessionId: SESSION_ID,
        cleanupToken: "L".repeat(24),
      },
    );
  });
  await assertFails(set(
    ref(hostDatabase, `freeTables/presence/${SESSION_ID}/_disconnect`),
    {
      state: "probe",
      sessionId: SESSION_ID,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/presence/${SESSION_ID}/${HOST_UID}`),
    {
      online: true,
      lastSeen: now,
      expiresAt: now + 45_000,
    },
  ));
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await set(
      ref(adminContext.database(), `freeTables/presence/${SESSION_ID}/_disconnect`),
      null,
    );
  });
  await assertSucceeds(set(
    ref(hostDatabase, `freeTables/presence/${SESSION_ID}/${HOST_UID}`),
    {
      online: true,
      lastSeen: now,
      expiresAt: now + 45_000,
    },
  ));

  const chatId = chatSlotId("host", 0);
  await assertSucceeds(set(
    ref(hostDatabase, `freeTables/chat/${SESSION_ID}/${chatId}`),
    {
      authorUid: HOST_UID,
      authorRole: "host",
      type: "text",
      text: "おかえり",
      createdAt: now,
      expiresAt: now + (10 * 60 * 1000),
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/chat/${SESSION_ID}/${chatId}`),
    {
      authorUid: HOST_UID,
      authorRole: "host",
      type: "text",
      text: "証拠を上書き",
      createdAt: now + 1,
      expiresAt: now + (10 * 60 * 1000),
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/chat/${SESSION_ID}/${chatId}`),
    null,
  ));
  await assertFails(set(
    ref(visitorDatabase, `freeTables/chat/${SESSION_ID}/${chatSlotId("visitor", 0)}`),
    {
      authorUid: VISITOR_UID,
      authorRole: "visitor",
      type: "text",
      text: "長すぎるTTL",
      createdAt: now,
      expiresAt: sessionExpiresAt,
    },
  ));
  await assertFails(set(
    ref(outsiderDatabase, `freeTables/chat/${SESSION_ID}/${chatSlotId("visitor", 1)}`),
    {
      authorUid: OUTSIDER_UID,
      authorRole: "visitor",
      type: "text",
      text: "部外者",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/chat/${SESSION_ID}/${chatSlotId("visitor", 2)}`),
    {
      authorUid: HOST_UID,
      authorRole: "host",
      type: "text",
      text: "相手のスロット",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/chat/${SESSION_ID}/${`${"C".repeat(20)}0500`}`),
    {
      authorUid: HOST_UID,
      authorRole: "host",
      type: "text",
      text: "範囲外",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));
  await assertSucceeds(set(
    ref(visitorDatabase, `freeTables/chat/${SESSION_ID}/${chatSlotId("visitor", 499)}`),
    {
      authorUid: VISITOR_UID,
      authorRole: "visitor",
      type: "text",
      text: "来訪者の末尾スロット",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));
  const expiredChatId = chatSlotId("host", 3);
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await set(
      ref(adminContext.database(), `freeTables/chat/${SESSION_ID}/${expiredChatId}`),
      {
        authorUid: HOST_UID,
        authorRole: "host",
        type: "text",
        text: "期限切れ",
        createdAt: now - 2_000,
        expiresAt: now - 1,
      },
    );
  });
  await assertSucceeds(set(
    ref(hostDatabase, `freeTables/chat/${SESSION_ID}/${expiredChatId}`),
    {
      authorUid: HOST_UID,
      authorRole: "host",
      type: "text",
      text: "期限後の再利用",
      createdAt: now + 1,
      expiresAt: now + 60_000,
    },
  ));
  await assertFails(set(
    ref(visitorDatabase, `freeTables/chat/${SESSION_ID}/short`),
    {
      authorUid: VISITOR_UID,
      authorRole: "visitor",
      type: "text",
      text: "短いキー",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));

  const signalId = signalSlotId(0);
  await assertSucceeds(set(
    ref(hostDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}/${signalId}`),
    {
      fromUid: HOST_UID,
      toUid: VISITOR_UID,
      type: "offer",
      payload: "{\"type\":\"offer\"}",
      createdAt: now,
      expiresAt: now + 90_000,
    },
  ));
  await assertSucceeds(get(
    ref(visitorDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}`),
  ));
  await assertFails(get(
    ref(outsiderDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}`),
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}/${signalSlotId(1)}`),
    {
      fromUid: HOST_UID,
      toUid: VISITOR_UID,
      type: "candidate",
      payload: "{}",
      createdAt: now,
      expiresAt: sessionExpiresAt,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/signals/${SESSION_ID}/${HOST_UID}/${signalSlotId(2)}`),
    {
      fromUid: HOST_UID,
      toUid: HOST_UID,
      type: "offer",
      payload: "{}",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}/${`${"S".repeat(22)}80`}`),
    {
      fromUid: HOST_UID,
      toUid: VISITOR_UID,
      type: "candidate",
      payload: "{}",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));
  await assertSucceeds(set(
    ref(hostDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}/${signalId}`),
    {
      fromUid: HOST_UID,
      toUid: VISITOR_UID,
      type: "candidate",
      payload: "{}",
      createdAt: now + 1,
      expiresAt: now + 60_000,
    },
  ));
  await assertFails(set(
    ref(visitorDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}/${signalId}`),
    {
      fromUid: VISITOR_UID,
      toUid: VISITOR_UID,
      type: "candidate",
      payload: "{}",
      createdAt: now + 2,
      expiresAt: now + 60_000,
    },
  ));
  await assertSucceeds(set(
    ref(visitorDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}/${signalId}`),
    null,
  ));

  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await set(ref(adminContext.database(), `freeTables/sessions/${SESSION_ID}/status`), "ended");
  });
  await assertFails(set(
    ref(visitorDatabase, `freeTables/chat/${SESSION_ID}/${chatSlotId("visitor", 4)}`),
    {
      authorUid: VISITOR_UID,
      authorRole: "visitor",
      type: "text",
      text: "終了後",
      createdAt: now,
      expiresAt: now + 60_000,
    },
  ));
  await assertFails(set(
    ref(hostDatabase, `freeTables/presence/${SESSION_ID}/${HOST_UID}`),
    {
      online: true,
      lastSeen: now,
      expiresAt: now + 45_000,
    },
  ));
  await assertFails(get(ref(hostDatabase, `freeTables/presence/${SESSION_ID}`)));
  await assertFails(get(ref(visitorDatabase, `freeTables/chat/${SESSION_ID}`)));
  await assertFails(get(
    ref(visitorDatabase, `freeTables/signals/${SESSION_ID}/${VISITOR_UID}`),
  ));

  await environment.withSecurityRulesDisabled(async (adminContext) => {
    await set(
      ref(adminContext.database(), `freeTables/sessions/${SESSION_ID}/expiresAt`),
      now - 1,
    );
  });
  await assertFails(get(ref(hostDatabase, `freeTables/sessions/${SESSION_ID}`)));
});
