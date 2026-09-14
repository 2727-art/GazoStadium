"use strict";

const assert = require("node:assert/strict");

// A policy stored alongside the fake wallet data makes the test distinguish a
// purchase-transaction policy read from a preliminary, non-atomic check.
function createUgcPlayerSafetyStub() {
  let firestore;
  const checks = [];
  const policyRef = (uid, otherUid) => firestore.collection("testPlayerContactPolicies")
    .doc([uid, otherUid].sort().join("__"));
  const service = {
    attach(storage) { firestore = storage; },
    checks,
    setBlocked(uid, otherUid, blocked = true) {
      firestore.documents.set(policyRef(uid, otherUid).path, { blocked });
    },
    async isBlocked(uid, otherUid, transaction) {
      if (uid === otherUid) return false;
      const reference = policyRef(uid, otherUid);
      const snapshot = transaction ? await transaction.get(reference) : await reference.get();
      return snapshot.data()?.blocked === true;
    },
    async assertAllowed(uid, otherUid, transaction) {
      assert.ok(transaction && typeof transaction.get === "function", "new payment checks must use its transaction");
      checks.push({ uid, otherUid, transaction });
      if (await service.isBlocked(uid, otherUid, transaction)) {
        const error = new Error("この操作は現在利用できません。");
        error.code = "failed-precondition";
        throw error;
      }
    },
    async filterVisible(uid, entries, ownerSelector) {
      const hidden = await Promise.all(entries.map((entry) => service.isBlocked(uid, ownerSelector(entry))));
      return entries.filter((_entry, index) => !hidden[index]);
    },
  };
  return service;
}

module.exports = { createUgcPlayerSafetyStub };
