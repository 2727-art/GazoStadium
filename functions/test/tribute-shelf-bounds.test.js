"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { server } = require("./helpers/tribute-edge-harness.cjs");
const { TRIBUTE_AGE_VERSION } = require("../tribute-rules");
const proto = Object.getPrototypeOf(server.createHarness().firestore.collection("x"));
const queryProto = Object.getPrototypeOf(proto);
const originalGet = queryProto.get;
queryProto.get = async function () {
  const snapshot = await originalGet.call(this);
  if (this.firestore.shelfReads && this.path === "tributeManagerMonths" && this.filters.some(f => f.field === "managerUid")) {
    this.firestore.shelfReads.push({ limit: this.maximum, docs: snapshot.size });
  }
  return snapshot;
};
function fixture({ early = false, empty = [] } = {}) {
  const h = server.createHarness();
  h.advance(Date.parse(early ? "2026-11-01T00:05:00+09:00" : "2026-11-01T00:11:00+09:00") - h.now());
  h.firestore.write("tributeProfiles/owner", { ageConfirmedVersion: TRIBUTE_AGE_VERSION,
    card: { personaName: "Owner" }, monthRanks: { "2026-10": { gross: 2, score: 1 } } });
  h.firestore.write("tributeHallOfFame/2026-10", { monthKey: "2026-10", closedAt: h.now(), gross: [], score: [] });
  for (let i = 0; i < 36; i++) {
    const date = new Date(Date.UTC(2026, 10 - i, 1));
    const monthKey = date.toISOString().slice(0,7);
    h.firestore.write(`tributeManagerMonths/${monthKey}__owner`, { managerUid: "owner", monthKey, receivedGross: empty.includes(monthKey) ? 0 : 100 });
  }
  h.firestore.shelfReads = [];
  return h;
}
test("36 saved months return and read only the twelve most recent closed harvests", async () => {
  const h = fixture();
  const before = [...h.firestore.documents].filter(([key]) => key.startsWith("tributeManagerMonths/"));
  const result = await h.act("owner", "ranch_standing");
  assert.equal(result.shelf.length, 12);
  assert.deepEqual(result.shelf[0], { monthKey: "2026-10", gross: 2, score: 1 });
  assert.equal(result.shelf.at(-1).monthKey, "2025-11");
  assert.equal(result.lastMonth.received, true);
  assert.deepEqual(h.firestore.shelfReads, [{ limit: 12, docs: 12 }]);
  assert.deepEqual([...h.firestore.documents].filter(([key]) => key.startsWith("tributeManagerMonths/")), before);
});
test("empty months do not displace older harvests or falsely mark last month as received", async () => {
  const h = fixture({ empty: ["2026-10", "2026-09", "2026-06"] });
  const result = await h.act("owner", "ranch_standing");
  assert.equal(result.shelf.length, 12);
  assert.equal(result.shelf[0].monthKey, "2026-08");
  assert.equal(result.shelf.at(-1).monthKey, "2025-08");
  assert.equal(result.lastMonth.received, false);
  assert.deepEqual(h.firestore.shelfReads, [{ limit: 12, docs: 12 }, { limit: 3, docs: 3 }]);
});
test("the closing grace period excludes the previous month and current month", async () => {
  const h = fixture({ early: true });
  const result = await h.act("owner", "ranch_standing");
  assert.equal(result.lastMonth, null);
  assert.equal(result.shelf[0].monthKey, "2026-09");
  assert.equal(result.shelf.length, 12);
});
test("a manager with no harvested months terminates with an empty shelf", async () => {
  const h = fixture();
  for (const [key, month] of h.firestore.documents) if (key.startsWith("tributeManagerMonths/")) h.firestore.write(key, { ...month, receivedGross: 0 });
  const result = await h.act("owner", "ranch_standing");
  assert.deepEqual(result.shelf, []);
  assert.equal(result.lastMonth.received, false);
  assert.equal(h.firestore.shelfReads.reduce((sum, read) => sum + read.docs, 0), 35);
});
test("real Firestore shelf pagination preserves sparse harvests and stored history", {
  skip: process.env.RUN_TRIBUTE_COST_EMULATOR_TESTS !== "1", timeout: 60_000,
}, async t => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { createTributeService } = require("../tribute-service");
  const app = initializeApp({ projectId: "demo-tribute-cost" }, `shelf-${Date.now()}`);
  const db = getFirestore(app);
  t.after(async () => { await db.terminate(); await deleteApp(app); });
  const prefix = `shelf_test_${require("node:crypto").randomBytes(6).toString("hex")}_`;
  const firestore = { collection: name => db.collection(prefix + name), runTransaction: fn => db.runTransaction(fn) };
  const h = fixture({ empty: ["2026-10", "2026-09", "2026-06"] });
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
  const result = await createTributeService(deps).performAction("owner", { action: "ranch_standing" });
  assert.equal(result.shelf.length, 12);
  assert.equal(result.shelf[0].monthKey, "2026-08");
  assert.equal(result.shelf.at(-1).monthKey, "2025-08");
  assert.equal(result.lastMonth.received, false);
  assert.equal((await firestore.collection("tributeManagerMonths").get()).size, 36);
});
