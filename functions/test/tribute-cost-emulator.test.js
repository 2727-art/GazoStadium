"use strict";

// Opt-in, isolated real Firestore transactions. No production credentials or
// namespace are accepted; the service's money, age and lifecycle paths remain
// exercised rather than replaced by a receipt-only mock.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createTributeService } = require("../tribute-service");
const { TRIBUTE_AGE_VERSION, jstDateKey, pairId } = require("../tribute-rules");

const requested = process.env.RUN_TRIBUTE_COST_EMULATOR_TESTS === "1";
const START = Date.parse("2026-10-07T12:00:00+09:00");
const DAY = 24 * 60 * 60 * 1000;
const clone = (value) => structuredClone(value);
const stableId = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

test("tribute cost guards preserve real Firestore transaction and lifecycle contracts", {
  skip: requested ? false : "set RUN_TRIBUTE_COST_EMULATOR_TESTS=1 with a loopback Firestore emulator",
  timeout: 120_000,
}, async (t) => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/,
    "FIRESTORE_EMULATOR_HOST must be an explicit loopback endpoint");
  const projectId = "demo-tribute-cost";
  assert.match(projectId, /^demo-/);
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = initializeApp({ projectId }, `tribute-cost-${Date.now()}`);
  const database = getFirestore(app);
  t.after(async () => { await database.terminate(); await deleteApp(app); });
  const prefix = crypto.randomBytes(6).toString("hex");
  let serial = 0;

  async function fixture({ contractPatch = {}, beforeTransaction = null } = {}) {
    const suffix = `${prefix}-${++serial}`;
    const managerUid = `manager-${suffix}`;
    const payerUid = `payer-${suffix}`;
    const strangerUid = `stranger-${suffix}`;
    const contractId = stableId(suffix);
    const contractRef = database.doc(`tributeContracts/${contractId}`);
    const policyRef = database.doc(`tributeCostTestPolicies/${contractId}`);
    const ledgerConfigRef = database.doc(`tributeCostTestLedgerConfig/${contractId}`);
    const profileRef = (uid) => database.doc(`tributeProfiles/${uid}`);
    const walletRef = (uid) => database.doc(`tributeCostTestWallets/${uid}`);
    const trace = { reads: [], writes: [], mirrors: [], walletLoads: 0 };
    const firestore = {
      collection: (name) => database.collection(name),
      async runTransaction(callback) {
        if (beforeTransaction) await beforeTransaction();
        return database.runTransaction(async (transaction) => {
          const traced = {
            get(reference) { trace.reads.push(reference.path); return transaction.get(reference); },
            set(reference, ...args) { trace.writes.push(reference.path); transaction.set(reference, ...args); return traced; },
            create(reference, ...args) { trace.writes.push(reference.path); transaction.create(reference, ...args); return traced; },
            update(reference, ...args) { trace.writes.push(reference.path); transaction.update(reference, ...args); return traced; },
            delete(reference) { trace.writes.push(reference.path); transaction.delete(reference); return traced; },
          };
          return callback(traced);
        }, { maxAttempts: 10 });
      },
    };
    const deps = {
      firestore,
      HttpsError,
      now: () => START,
      // One canonical policy read matches the production policy-present path.
      // Legacy-policy fallback reads are deliberately not represented here.
      playerSafety: {
        async isBlocked(_first, _second, transaction) {
          return (await transaction.get(policyRef)).get("blocked") === true;
        },
      },
      ensureWallet: async (uid) => (await walletRef(uid).get()).get("balance"),
      walletRef,
      anjuPayLedgerConfigRef: () => ledgerConfigRef,
      walletData(snapshot) {
        trace.walletLoads += 1;
        assert.equal(snapshot.exists, true);
        return clone(snapshot.data());
      },
      walletCreditCapacity: (wallet) => wallet.maxBalance - wallet.balance,
      debitPoints(wallet, amount) {
        if (wallet.balance < amount) throw new HttpsError("failed-precondition", "insufficient balance");
        wallet.balance -= amount;
      },
      creditPoints(wallet, amount) {
        if (wallet.balance + amount > wallet.maxBalance) throw new HttpsError("failed-precondition", "wallet cap");
        wallet.balance += amount;
      },
      stageAnjuPayOpening() {},
      appendAnjuPayEntry(transaction, reference, _wallet, _config, entry) {
        assert.equal(entry.balanceAfter - entry.balanceBefore, entry.delta);
        transaction.create(reference.collection("ledger").doc(entry.entryId), entry);
      },
      anjuPayWalletMetadataPatch: () => ({}),
      anjuPayEntryId: stableId,
      mirrorWallet: async (uid, balance) => { trace.mirrors.push({ uid, balance }); },
      bestEffort: async (_label, work) => { await Promise.allSettled(work); },
    };
    const service = createTributeService(deps);
    const profile = (uid) => ({
      uid, schemaVersion: 1, ageConfirmedVersion: TRIBUTE_AGE_VERSION,
      walletName: "test", card: null, accepting: false,
      counts: { payerOpen: uid === payerUid ? 1 : 0, managerActive: uid === managerUid ? 1 : 0, managerPending: 0 },
      lastActiveAt: START - 1000, updatedAt: START - 1000,
    });
    const contract = {
      contractId, managerUid, payerUid, participants: [managerUid, payerUid],
      status: "active", managerCard: { personaName: "test", disclosure: "as_is", style: "normal", sigil: 0 },
      payerWalletName: "test", caps: { perTribute: 100, perDay: 300, total: 1000 },
      durationDays: 3, expiresAt: START + 3 * DAY, createdAt: START - DAY,
      acceptedAt: START - DAY, updatedAt: START - 1000, lastEventAt: START - 1000,
      eventSeq: 5, readSeq: { manager: 2, payer: 1 }, escrowBalance: 0,
      pendingRequests: {}, totalTributed: 0, tributeCount: 0,
      ...contractPatch,
    };
    await Promise.all([
      contractRef.set(contract), profileRef(managerUid).set(profile(managerUid)), profileRef(payerUid).set(profile(payerUid)),
      walletRef(managerUid).set({ balance: 0, maxBalance: 1_000_000 }),
      walletRef(payerUid).set({ balance: 63, maxBalance: 1_000_000 }),
      ledgerConfigRef.set({ enabled: true }), policyRef.set({ blocked: false }),
      database.doc(`tributePairs/${pairId(managerUid, payerUid)}`).set({
        managerUid, payerUid, openContractId: contractId, count: 0, total: 0, firstAt: 0, lastAt: 0,
      }),
    ]);
    return {
      service, deps, firestore, trace, managerUid, payerUid, strangerUid, contractId, contractRef,
      profileRef, walletRef, policyRef,
      act: (uid, action, payload = {}) => service.performAction(uid, { action, contractId, ...payload }),
      read: async () => (await contractRef.get()).data(),
      resetTrace() { trace.reads.length = 0; trace.writes.length = 0; trace.mirrors.length = 0; trace.walletLoads = 0; },
    };
  }

  await t.test("ordinary read receipt costs three transactional reads and changes only the actor's receipt", async () => {
    const f = await fixture();
    const before = await f.read();
    const result = await f.act(f.payerUid, "mark_read", { seq: 4 });
    const after = await f.read();
    assert.deepEqual(after, { ...before, readSeq: { ...before.readSeq, payer: 4 } });
    assert.equal(result.readSeq, 4);
    assert.equal(result.eventSeq, 5);
    assert.equal(result.contractId, f.contractId);
    assert.equal(f.trace.reads.length, 3, "contract + own age profile + canonical block policy; five fewer than the old eight-read path");
    assert.deepEqual(new Set(f.trace.reads), new Set([
      f.contractRef.path, f.profileRef(f.payerUid).path, f.policyRef.path,
    ]));
    assert.deepEqual(f.trace.writes, [f.contractRef.path]);
    assert.equal(f.trace.walletLoads, 0);
    assert.deepEqual(f.trace.mirrors, []);
  });

  await t.test("lower, repeated and malformed receipts do not write, while overshoot clamps to the current event", async () => {
    const f = await fixture();
    await f.act(f.payerUid, "mark_read", { seq: Number.MAX_SAFE_INTEGER });
    const before = await f.contractRef.get();
    for (const seq of [5, 4, 0, -1, "invalid"]) {
      f.resetTrace();
      const result = await f.act(f.payerUid, "mark_read", { seq });
      const after = await f.contractRef.get();
      assert.equal(result.readSeq, 5, String(seq));
      assert.equal(after.updateTime.isEqual(before.updateTime), true, String(seq));
      assert.deepEqual(f.trace.writes, [], String(seq));
    }
  });

  await t.test("nonparticipants and participants without age confirmation cannot update receipts", async () => {
    const f = await fixture();
    const before = await f.read();
    await assert.rejects(f.act(f.strangerUid, "mark_read", { seq: 5 }), { code: "permission-denied" });
    await f.profileRef(f.payerUid).update({ ageConfirmedVersion: "old-version" });
    await assert.rejects(f.act(f.payerUid, "mark_read", { seq: 5 }), { code: "failed-precondition" });
    assert.deepEqual(await f.read(), before);
    assert.deepEqual(f.trace.writes, []);
  });

  await t.test("concurrent receipts and a new event preserve both roles, the new event, and event timestamps", async () => {
    const f = await fixture();
    await Promise.all([
      f.act(f.payerUid, "mark_read", { seq: 4 }),
      f.act(f.managerUid, "mark_read", { seq: 3 }),
      database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(f.contractRef);
        const seq = snapshot.get("eventSeq") + 1;
        transaction.update(f.contractRef, { eventSeq: seq, updatedAt: START + 1, lastEventAt: START + 1 });
        transaction.create(f.contractRef.collection("events").doc(String(seq).padStart(10, "0")), {
          seq, actor: "manager", type: "message", text: "new", createdAt: START + 1,
        });
      }, { maxAttempts: 10 }),
    ]);
    const after = await f.read();
    assert.deepEqual(after.readSeq, { manager: 3, payer: 4 });
    assert.equal(after.eventSeq, 6);
    assert.equal(after.updatedAt, START + 1);
    assert.equal(after.lastEventAt, START + 1);
    assert.equal((await f.contractRef.collection("events").get()).size, 1);
  });

  for (const reason of ["expired", "blocked"]) {
    await t.test(`${reason} receipt fallback still ends the contract and returns escrow once`, async () => {
      const f = await fixture({ contractPatch: { escrowBalance: 37, ...(reason === "expired" ? { expiresAt: START - 1 } : {}) } });
      if (reason === "blocked") await f.policyRef.set({ blocked: true });
      const result = await f.act(f.payerUid, "mark_read", { seq: 5 });
      const after = await f.read();
      assert.equal(after.status, "ended");
      assert.equal(after.endReason, reason);
      assert.equal(after.escrowBalance, 0);
      assert.equal(after.eventSeq, 6);
      assert.equal(result.readSeq, 5);
      assert.equal((await f.walletRef(f.payerUid).get()).get("balance"), 100);
      assert.equal((await f.walletRef(f.payerUid).collection("ledger").get()).size, 1);
      assert.deepEqual(f.trace.mirrors, [{ uid: f.payerUid, balance: 100 }]);
      await f.act(f.payerUid, "mark_read", { seq: 6 });
      assert.equal((await f.walletRef(f.payerUid).get()).get("balance"), 100);
      assert.equal((await f.walletRef(f.payerUid).collection("ledger").get()).size, 1);
      assert.equal((await f.contractRef.collection("events").get()).size, 1);
    });
  }

  await t.test("effective pending caps still settle as a lifecycle event, not as a quiet receipt", async () => {
    const caps = { perTribute: 300, perDay: 1000, total: 3000 };
    const f = await fixture({ contractPatch: { pendingCaps: caps, pendingCapsEffectiveDateKey: jstDateKey(START) } });
    await f.act(f.payerUid, "mark_read", { seq: 5 });
    const after = await f.read();
    assert.deepEqual(after.caps, caps);
    assert.equal(after.pendingCaps, null);
    assert.equal(after.eventSeq, 6);
    assert.equal(after.updatedAt, START);
    const events = await f.contractRef.collection("events").get();
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].get("type"), "caps_raised");
    assert.equal((await f.walletRef(f.payerUid).get()).get("balance"), 63);
  });

  await t.test("first state visit backfills proven history, and subsequent state visits use one stats read", async () => {
    const f = await fixture();
    await database.doc(`tributePairs/history-${f.contractId}`).set({
      managerUid: `old-${f.managerUid}`, payerUid: f.payerUid, count: 5, total: 50,
      firstAt: START - 4 * DAY, lastAt: START - DAY,
    });
    const first = await f.act(f.payerUid, "state");
    assert.deepEqual(first.achievements.stats, { managerPairDays: 0, walletPairDays: 2 });
    assert.equal((await database.doc(`tributeAchievementStats/${f.payerUid}`).get()).get("historyBackfilled"), true);
    f.resetTrace();
    const again = await f.act(f.payerUid, "state");
    assert.deepEqual(again.achievements.stats, first.achievements.stats);
    assert.equal(f.trace.reads.filter((path) => path === `tributeAchievementStats/${f.payerUid}`).length, 1);
    assert.deepEqual(f.trace.writes, [], "already-unlocked state does not rewrite stats or achievements");
  });

  await t.test("a stale backfill attempt cannot overwrite a concurrently completed backfill and increment", async () => {
    let enter;
    let release;
    const entered = new Promise((resolve) => { enter = resolve; });
    const released = new Promise((resolve) => { release = resolve; });
    const delayed = await fixture({ beforeTransaction: async () => { enter(); await released; } });
    await database.doc(`tributePairs/history-${delayed.contractId}`).set({
      managerUid: `old-${delayed.managerUid}`, payerUid: delayed.payerUid, count: 5, total: 50,
      firstAt: START - 4 * DAY, lastAt: START - DAY,
    });
    const staleAttempt = delayed.service.ensureAchievementStats(delayed.payerUid);
    await entered; // Its preflight and historical queries saw no backfilled doc.
    try {
      const normal = createTributeService({ ...delayed.deps, firestore: database });
      assert.equal((await normal.ensureAchievementStats(delayed.payerUid)).walletPairDays, 2);
      const reference = database.doc(`tributeAchievementStats/${delayed.payerUid}`);
      await database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        transaction.update(reference, { walletPairDays: snapshot.get("walletPairDays") + 1 });
      });
    } finally {
      release();
    }
    assert.equal((await staleAttempt).walletPairDays, 3);
    assert.equal((await database.doc(`tributeAchievementStats/${delayed.payerUid}`).get()).get("walletPairDays"), 3);
  });
});
