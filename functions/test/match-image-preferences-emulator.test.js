"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  buildMatchImagePreferenceSnapshot,
  matchImagePreferenceSnapshotPath,
} = require("../match-image-preferences");

test("private match choices deny reads and writes to both participants, outsiders, and anonymous clients", {
  skip: process.env.RUN_DATABASE_RULES_TESTS !== "1" ? "set RUN_DATABASE_RULES_TESTS=1 with loopback RTDB emulator" : false,
  timeout: 60_000,
}, async (t) => {
  assert.match(process.env.FIREBASE_DATABASE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const [host, port] = process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(":");
  const { assertFails, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
  const { get, ref, set, remove } = require("firebase/database");
  const environment = await initializeTestEnvironment({
    projectId: "demo-match-image-preferences",
    database: { host, port: Number(port), rules: readFileSync(path.resolve(__dirname, "../../database.rules.json"), "utf8") },
  });
  t.after(() => environment.cleanup());
  const now = Date.now();
  for (const mode of ["solo", "strategy"]) {
    const roomId = "P".repeat(20);
    const snapshotPath = matchImagePreferenceSnapshotPath(mode, roomId);
    const snapshot = buildMatchImagePreferenceSnapshot({
      mode, roomId, room: { hostUid: "host", guestUid: "guest", createdAt: now },
      preferences: { host: "illustration", guest: "live_action" },
    }, now);
    await environment.withSecurityRulesDisabled(async (context) => set(ref(context.database(), snapshotPath), snapshot));
    for (const uid of ["host", "guest", "outsider", null]) {
      const db = uid ? environment.authenticatedContext(uid).database() : environment.unauthenticatedContext().database();
      await assertFails(get(ref(db, snapshotPath)));
      await assertFails(get(ref(db, `${snapshotPath}/preferences/${uid || "host"}`)));
      await assertFails(set(ref(db, snapshotPath), snapshot));
      await assertFails(set(ref(db, `${snapshotPath}/preferences/host`), "both"));
      await assertFails(remove(ref(db, snapshotPath)));
    }
  }
});
