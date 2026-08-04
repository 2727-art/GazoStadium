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
  limitToFirst,
  orderByChild,
  query,
  ref,
  remove,
  set,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.RATE_FLOOR_DATABASE_TEST_PROJECT_ID || "demo-rate-floor";
const runsAgainstSafeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

test("RATE FLOOR RTDB rules expose ordered rows but reject every client write", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* RATE_FLOOR_DATABASE_TEST_PROJECT_ID",
}, async (context) => {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  const activeIds = Array.from(
    { length: 11 },
    (_, index) => `FloorActiveEntryId${String(index).padStart(6, "0")}`,
  );
  const activeId = activeIds[0];
  const hiddenId = "FloorHiddenEntryId000001";
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    const database = adminContext.database();
    await Promise.all(activeIds.map((entryId, index) => set(
      ref(database, `online/serverRateFloorLeaderboard/${entryId}`),
      {
        serverVerified: true,
        rulesetVersion: 2,
        name: index === 0 ? "PLAYER" : `PLAYER ${index + 1}`,
        rating: 620 + index,
        serverMatches: 12 + index,
        syncRevision: 3,
      },
    )));
    await set(ref(database, `online/serverRateFloorLeaderboard/${hiddenId}`), {
      serverVerified: true,
      rulesetVersion: 2,
      rateFloorHidden: true,
      rating: 3001,
      serverMatches: 0,
      syncRevision: 4,
    });
  });

  const publicDatabase = environment.unauthenticatedContext().database();
  const hiddenSnapshot = await assertSucceeds(get(ref(
    publicDatabase,
    `online/serverRateFloorLeaderboard/${hiddenId}`,
  )));
  assert.equal(hiddenSnapshot.exists(), true);
  assert.equal(hiddenSnapshot.child("rateFloorHidden").val(), true);
  assert.equal(hiddenSnapshot.child("name").exists(), false);
  const allRowsSnapshot = await assertSucceeds(get(ref(
    publicDatabase,
    "online/serverRateFloorLeaderboard",
  )));
  assert.equal(allRowsSnapshot.size, 12);
  const publicSnapshot = await assertSucceeds(get(query(
    ref(publicDatabase, "online/serverRateFloorLeaderboard"),
    orderByChild("rating"),
    limitToFirst(10),
  )));
  const orderedIds = [];
  publicSnapshot.forEach((child) => {
    orderedIds.push(child.key);
  });
  assert.deepEqual(orderedIds, activeIds.slice(0, 10));
  assert.equal(publicSnapshot.child(activeId).child("name").val(), "PLAYER");
  assert.equal(publicSnapshot.child(hiddenId).child("name").exists(), false);

  await assertFails(set(
    ref(publicDatabase, `online/serverRateFloorLeaderboard/${activeId}/rating`),
    100,
  ));
  const signedInDatabase = environment.authenticatedContext("rate-floor-user").database();
  await assertFails(remove(ref(
    signedInDatabase,
    `online/serverRateFloorLeaderboard/${activeId}`,
  )));
});
