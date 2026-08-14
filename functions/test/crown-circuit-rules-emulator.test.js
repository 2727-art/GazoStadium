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
  limitToLast,
  orderByChild,
  orderByKey,
  query,
  ref,
  remove,
  set,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.CROWN_CIRCUIT_DATABASE_TEST_PROJECT_ID
  || "demo-crown-circuit";
const runsAgainstSafeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

test("Crown Circuit RTDB rules expose bounded public progress and seat history queries", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* CROWN_CIRCUIT_DATABASE_TEST_PROJECT_ID",
}, async (context) => {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  const monthlyPath = "online/crownCircuitPeriods/monthly/2026-08";
  const monthlyRows = [
    { entryId: "CrownMonthlyEntry000001", qualifyingCount: 0 },
    { entryId: "CrownMonthlyEntry000002", qualifyingCount: 1 },
    { entryId: "CrownMonthlyEntry000003", qualifyingCount: 2 },
  ];
  const weeklyHistoryPath = "online/crownCircuitSeatHistory/weekly/2026-08-03";

  await environment.withSecurityRulesDisabled(async (adminContext) => {
    const database = adminContext.database();
    await Promise.all(monthlyRows.map(({ entryId, qualifyingCount }) => set(
      ref(database, `${monthlyPath}/${entryId}`),
      {
        serverVerified: true,
        rulesetVersion: 2,
        name: `MONTHLY ${qualifyingCount}`,
        qualifyingCount,
        circuitScore: qualifyingCount * 50,
        rankScore: qualifyingCount >= 2 ? qualifyingCount * 50 : 0,
      },
    )));
    await Promise.all(Array.from({ length: 12 }, (_, index) => {
      const rank = index + 1;
      return set(ref(database, `${weeklyHistoryPath}/${rank}`), {
        serverVerified: true,
        rulesetVersion: 2,
        entryId: `CrownWeeklyEntry${String(rank).padStart(6, "0")}`,
        name: `WEEKLY ${rank}`,
        rank,
        participantCount: 12,
        qualifyingCount: 2,
        circuitScore: 100 - rank,
        rankScore: 100 - rank,
        awardTier: rank === 1 ? "weekly_champion" : "weekly_seat",
      });
    }));
  });

  const publicDatabase = environment.unauthenticatedContext().database();
  const progressSnapshot = await assertSucceeds(get(query(
    ref(publicDatabase, monthlyPath),
    orderByChild("qualifyingCount"),
    limitToLast(1),
  )));
  assert.equal(progressSnapshot.size, 1);
  const progressRows = [];
  progressSnapshot.forEach((child) => {
    progressRows.push({ key: child.key, qualifyingCount: child.child("qualifyingCount").val() });
  });
  assert.deepEqual(progressRows, [{
    key: monthlyRows[2].entryId,
    qualifyingCount: 2,
  }]);

  const seatHistorySnapshot = await assertSucceeds(get(query(
    ref(publicDatabase, weeklyHistoryPath),
    orderByKey(),
    limitToFirst(10),
  )));
  assert.equal(seatHistorySnapshot.size, 10);
  const seatRanks = [];
  seatHistorySnapshot.forEach((child) => {
    seatRanks.push({ key: child.key, rank: child.child("rank").val() });
  });
  assert.deepEqual(seatRanks, Array.from({ length: 10 }, (_, index) => ({
    key: String(index + 1),
    rank: index + 1,
  })));

  await assertFails(set(
    ref(publicDatabase, `${monthlyPath}/${monthlyRows[0].entryId}/qualifyingCount`),
    3,
  ));
  await assertFails(set(
    ref(publicDatabase, `${weeklyHistoryPath}/1/rank`),
    2,
  ));

  const signedInDatabase = environment.authenticatedContext("crown-circuit-user").database();
  await assertFails(remove(ref(
    signedInDatabase,
    `${monthlyPath}/${monthlyRows[0].entryId}`,
  )));
  await assertFails(remove(ref(
    signedInDatabase,
    `${weeklyHistoryPath}/1`,
  )));
});
