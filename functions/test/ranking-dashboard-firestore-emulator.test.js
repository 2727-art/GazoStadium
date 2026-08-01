"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  && /^demo-/.test(process.env.RANKING_DASHBOARD_TEST_PROJECT_ID || "");

if (!enabled) {
  test("ranking dashboard Firestore queries are opt-in and never use production", { skip: true }, () => {});
} else {
  const { deleteApp, initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");

  test("aggregate rank and bounded neighbors follow Firestore key order", async (t) => {
    const projectId = process.env.RANKING_DASHBOARD_TEST_PROJECT_ID;
    assert.match(projectId, /^demo-/);
    const app = initializeApp({ projectId }, `ranking-dashboard-${Date.now()}`);
    const firestore = getFirestore(app);
    t.after(async () => deleteApp(app));
    const profiles = firestore.collection("serverRankingProfiles");
    const entries = [
      ["rank-1", { enabled: true, rating: 1400, entryId: "zzzzzzzzzzzzzzzz" }],
      ["rank-2", { enabled: true, rating: 1300, entryId: "zzzzzzzzzzzzzzzy" }],
      ["rank-3", { enabled: true, rating: 1200, entryId: "----------------" }],
      ["rank-4", { enabled: true, rating: 1200, entryId: "AAAAAAAAAAAAAAAA" }],
      ["own", { enabled: true, rating: 1200, entryId: "________________" }],
      ["rank-6", { enabled: true, rating: 1200, entryId: "aaaaaaaaaaaaaaaa" }],
      ["rank-7", { enabled: true, rating: 1100, entryId: "zzzzzzzzzzzzzzzx" }],
      ["missing-key", { enabled: true, name: "not-ranked" }],
      ["disabled", { enabled: false, rating: 3000, entryId: "0000000000000000" }],
    ];
    const batch = firestore.batch();
    entries.forEach(([id, value]) => batch.set(profiles.doc(id), value));
    await batch.commit();

    const rankedQuery = profiles
      .where("enabled", "==", true)
      .orderBy("rating", "desc")
      .orderBy("entryId", "asc");
    const beforeQuery = rankedQuery.endBefore(1200, "________________");
    const afterQuery = rankedQuery.startAfter(1200, "________________");
    const [participants, better, before, after] = await Promise.all([
      rankedQuery.count().get(),
      beforeQuery.count().get(),
      beforeQuery.limitToLast(3).get(),
      afterQuery.limit(3).get(),
    ]);

    assert.equal(participants.data().count, 7);
    assert.equal(better.data().count + 1, 5);
    assert.deepEqual(before.docs.map((snapshot) => snapshot.id), ["rank-2", "rank-3", "rank-4"]);
    assert.deepEqual(after.docs.map((snapshot) => snapshot.id), ["rank-6", "rank-7"]);
  });
}
