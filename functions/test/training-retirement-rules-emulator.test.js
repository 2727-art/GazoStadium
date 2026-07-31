"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  get,
  ref,
  set,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.TRAINING_RETIREMENT_RULES_TEST_PROJECT_ID
  || "demo-training-retirement";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

const RETIRED_PATHS = Object.freeze([
  "online/trainingSessionClaims/client-a",
  "online/trainingAttemptsV5/client-a",
  "online/trainingV6/state/tickets/client-a",
  "online/trainingV6/state/rooms/room-retired",
  "online/trainingV6/signals/room-retired/client-a/client-b/signal-0001",
  "online/trainingV6/presence/room-retired/client-a",
  "online/trainingSessionActionRates/hash/client-a",
  "online/trainingSessionCleanupCursors/cursor",
  "online/trainingMatchPermitsV4/client-a",
  "online/trainingMatchLocksV4/lock",
  "online/trainingQueueV4/client-a/session-a",
  "online/trainingActiveV4/client-a/session-a",
  "online/trainingOffersV4/client-a/session-a",
  "online/trainingQueue/client-a",
  "online/trainingActive/client-a",
  "online/trainingRoomCleanupCursor/cursor",
  "online/trainingActiveCleanupCursor/cursor",
  "online/trainingActiveCleanupGuards/guard",
  "online/trainingMatchLock/lock",
  "online/trainingInvites/client-a/room-retired",
  "online/trainingRooms/room-retired",
]);

test("retired Training 60 data cannot be read or written by clients", {
  skip: safeEmulator
    ? false
    : "run inside a loopback Database Emulator with a demo-* project",
}, async (context) => {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  await environment.withSecurityRulesDisabled(async (adminContext) => {
    for (const retiredPath of RETIRED_PATHS) {
      await set(ref(adminContext.database(), retiredPath), { retained: true });
    }
  });

  const authenticated = environment.authenticatedContext("client-a").database();
  const anonymous = environment.unauthenticatedContext().database();
  for (const retiredPath of RETIRED_PATHS) {
    await assertFails(get(ref(authenticated, retiredPath)));
    await assertFails(set(ref(authenticated, retiredPath), { rewritten: true }));
    await assertFails(get(ref(anonymous, retiredPath)));
    await assertFails(set(ref(anonymous, retiredPath), { rewritten: true }));
  }
});

test("public presence rejects mode=training while current modes remain writable", {
  skip: safeEmulator
    ? false
    : "run inside a loopback Database Emulator with a demo-* project",
}, async (context) => {
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  const uid = "presence-owner";
  const database = environment.authenticatedContext(uid).database();
  const now = Date.now();

  for (const sessionId of ["training-presence", "solo-presence", "strategy-presence"]) {
    await set(
      ref(database, `online/publicPresenceOwners/${sessionId}`),
      uid,
    );
  }
  await assertFails(set(ref(database, "online/publicPresence/training-presence"), {
    mode: "training",
    state: "waiting",
    lastSeen: now,
  }));
  await set(ref(database, "online/publicPresence/solo-presence"), {
    mode: "solo",
    state: "waiting",
    lastSeen: now,
  });
  await set(ref(database, "online/publicPresence/strategy-presence"), {
    mode: "strategy",
    state: "playing",
    lastSeen: now,
  });
});
