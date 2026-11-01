"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { server } = require("./helpers/tribute-edge-harness.cjs");
const { TRIBUTE_AGE_VERSION, LIMITS } = require("../tribute-rules");
const monthKey = "2026-10";

function fixture({ ineligible = 0, hidden = 0, eligible = 12, tied = false } = {}) {
  const h = server.createHarness();
  h.advance(Date.parse("2026-11-01T00:11:00+09:00") - h.now());
  const ids = [];
  for (let i = 0; i < ineligible + hidden + eligible; i++) {
    const uid = `manager-${String(999 - i).padStart(4, "0")}`;
    const value = tied ? 1000 : 2000 - i;
    const payers = i < ineligible ? 2 : 3;
    const profile = { ageConfirmedVersion: TRIBUTE_AGE_VERSION, publicManagerId: i.toString(16).padStart(24, "0"),
      card: { personaName: uid }, severeReportMonthKey: monthKey,
      severeReportCount: i >= ineligible && i < ineligible + hidden ? LIMITS.severeReportHide : 0 };
    h.firestore.write(`tributeProfiles/${uid}`, profile);
    h.firestore.write(`tributeManagerMonths/${monthKey}__${uid}`, { monthKey, managerUid: uid, payers, rankScore: value, receivedGross: value });
    if (i >= ineligible + hidden) ids.push(uid);
  }
  h.firestore.write("tributeProfiles/viewer", { ageConfirmedVersion: TRIBUTE_AGE_VERSION });
  return { h, ids };
}

test("monthly crowns continue beyond 40/60 ineligible managers and preserve the existing month's record", async () => {
  const { h, ids } = fixture({ ineligible: 65 });
  await h.act("viewer", "rankings", { kind: "hall" });
  const hall = h.firestore.read(`tributeHallOfFame/${monthKey}`);
  for (const kind of ["score", "gross"]) {
    assert.deepEqual(hall[kind].map(row => row.managerUid), ids.slice(0, 10));
    assert.deepEqual(hall[kind].map(row => row.rank), [1,2,3,4,5,6,7,8,9,10]);
  }
  assert.deepEqual(h.firestore.read(`tributeProfiles/${ids[0]}`).monthRanks[monthKey], { score: 1, gross: 1 });
  h.firestore.delete(`tributeManagerMonths/${monthKey}__${ids[0]}`);
  await h.act("viewer", "rankings", { kind: "hall" });
  assert.deepEqual(h.firestore.read(`tributeHallOfFame/${monthKey}`), hall, "a closed month is never rewritten by an ordinary read");
});

test("tied scores across pages and many hidden managers neither skip nor duplicate a crown", async () => {
  const { h, ids } = fixture({ hidden: 66, tied: true });
  await h.act("viewer", "rankings", { kind: "hall" });
  const hall = h.firestore.read(`tributeHallOfFame/${monthKey}`);
  for (const kind of ["score", "gross"]) assert.deepEqual(hall[kind].map(row => row.managerUid), ids.slice(0,10));
});

test("an exhausted month with no eligible manager closes with empty crowns", async () => {
  const { h } = fixture({ ineligible: 120, eligible: 0 });
  await h.act("viewer", "rankings", { kind: "hall" });
  const hall = h.firestore.read(`tributeHallOfFame/${monthKey}`);
  assert.deepEqual(hall.score, []);
  assert.deepEqual(hall.gross, []);
});

test("real Firestore cursor ordering preserves tied monthly crowns across pages", {
  skip: process.env.RUN_TRIBUTE_COST_EMULATOR_TESTS !== "1", timeout: 60_000,
}, async t => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { createTributeService } = require("../tribute-service");
  const app = initializeApp({ projectId: "demo-tribute-cost" }, `rank-${Date.now()}`);
  const db = getFirestore(app);
  t.after(async () => { await db.terminate(); await deleteApp(app); });
  const prefix = `ranking_test_${require("node:crypto").randomBytes(6).toString("hex")}_`;
  const firestore = { collection: name => db.collection(prefix + name), runTransaction: fn => db.runTransaction(fn) };
  const { h, ids } = fixture({ hidden: 66, tied: true });
  const batch = db.batch();
  for (const [documentPath, data] of h.firestore.documents) {
    if (!documentPath.startsWith("tribute")) continue;
    const [collection, id] = documentPath.split("/");
    batch.set(firestore.collection(collection).doc(id), data);
  }
  await batch.commit();
  const deps = { firestore, HttpsError: server.FakeHttpsError, now: h.now };
  for (const name of ["ensureWallet", "walletRef", "anjuPayLedgerConfigRef", "walletData", "walletCreditCapacity", "debitPoints", "creditPoints", "stageAnjuPayOpening", "appendAnjuPayEntry", "anjuPayWalletMetadataPatch", "anjuPayEntryId", "mirrorWallet", "bestEffort"]) {
    deps[name] = () => { throw Error(`Unexpected money operation: ${name}`); };
  }
  await createTributeService(deps).performAction("viewer", { action: "rankings", kind: "hall" });
  const hall = (await firestore.collection("tributeHallOfFame").doc(monthKey).get()).data();
  for (const kind of ["score", "gross"]) assert.deepEqual(hall[kind].map(row => row.managerUid), ids.slice(0, 10));
});
