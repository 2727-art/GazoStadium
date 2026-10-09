"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { cleanupRetiredFreeTableRuntime } = require("../free-table-retirement");
const { FREE_TABLE_ENDED_RETENTION_MS } = require("../free-table");

const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.FREE_TABLE_RETENTION_TEST_PROJECT_ID || "demo-free-table-retention";
const safeEmulator = /^(?:localhost|127\.0\.0\.1):\d+$/.test(emulatorHost)
  && /^demo-[a-z0-9-]+$/.test(projectId);

test("retention purges finalized runtime through a cold Admin SDK cache", {
  skip: safeEmulator ? false : "run with a loopback Database Emulator and a demo-* project",
}, async (t) => {
  const [host, port] = emulatorHost.split(":");
  const environment = await initializeTestEnvironment({ projectId, database: {
    host, port: Number(port),
    rules: fs.readFileSync(path.resolve(__dirname, "../..", "database.rules.json"), "utf8"),
  } });
  t.after(() => environment.cleanup());
  const config = { projectId, databaseURL: `http://${emulatorHost}?ns=${projectId}` };
  const seedApp = initializeApp(config, `free-table-retention-seed-${Date.now()}`);
  const readerApp = initializeApp(config, `free-table-retention-cold-${Date.now()}`);
  t.after(async () => { await Promise.all([deleteApp(seedApp), deleteApp(readerApp)]); });
  const seed = getDatabase(seedApp);
  const reader = getDatabase(readerApp);
  const now = Date.now();
  const sessionId = "E".repeat(24);
  const liveId = "L".repeat(24);
  const session = { sessionId, status: "ended", endedAt: now - FREE_TABLE_ENDED_RETENTION_MS - 60_000,
    expiresAt: now - 60_000, cleanupFinalizedAt: now - 50_000 };
  const live = { sessionId: liveId, status: "active", expiresAt: now + 60_000 };
  const unrelated = { status: "active", members: { host: true, guest: true } };
  await seed.ref().set({
    freeTables: { sessions: { [sessionId]: session, [liveId]: live },
      chat: { [sessionId]: { message: { text: "expired" } }, [liveId]: { retained: true } },
      presence: { [sessionId]: { host: { online: false } } },
      signals: { [sessionId]: { host: { signal: "expired" } } } },
    online: { rooms: { unrelated } },
  });
  // The seeding connection cannot warm the reader's cache. A one-shot query
  // also releases its cache before the following per-session transaction.
  const result = await cleanupRetiredFreeTableRuntime({ realtime: reader, now });
  assert.deepEqual(result, { examined: 1, removed: 1, changed: 0, skipped: 0 });
  for (const branch of ["sessions", "chat", "presence", "signals"]) {
    assert.equal((await seed.ref(`freeTables/${branch}/${sessionId}`).get()).exists(), false, branch);
  }
  assert.deepEqual((await seed.ref(`freeTables/sessions/${liveId}`).get()).val(), live);
  assert.deepEqual((await seed.ref(`freeTables/chat/${liveId}`).get()).val(), { retained: true });
  assert.deepEqual((await seed.ref("online/rooms/unrelated").get()).val(), unrelated);
  assert.deepEqual(await cleanupRetiredFreeTableRuntime({ realtime: reader, now }),
    { examined: 0, removed: 0, changed: 0, skipped: 0 });
});
