"use strict";

const {
  normalizeFleaStats,
} = require("./achievements");

const FLEA_ACHIEVEMENT_STATS_SCHEMA_VERSION = 1;

function aggregateCount(snapshot) {
  const aggregateValue = snapshot && typeof snapshot.data === "function"
    ? snapshot.data()?.count
    : undefined;
  const raw = aggregateValue ?? snapshot?.size ?? snapshot?.docs?.length ?? 0;
  const number = Math.floor(Number(raw));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

async function countQuery(query) {
  if (typeof query?.count === "function") {
    return aggregateCount(await query.count().get());
  }
  return aggregateCount(await query.get());
}

function createAnjuPayFleaAchievementStatsStore({ firestore, now = Date.now } = {}) {
  if (!firestore || typeof firestore.collection !== "function"
      || typeof firestore.runTransaction !== "function") {
    throw new TypeError("AnjuPay flea achievement stats require Firestore.");
  }
  if (typeof now !== "function") {
    throw new TypeError("AnjuPay flea achievement stats require a clock function.");
  }

  const statsRef = (uid) => firestore
    .collection("anjuPayFleaAchievementStats")
    .doc(uid);
  const listingsBySeller = (uid) => firestore
    .collection("anjuPayFleaListings")
    .where("sellerUid", "==", uid);
  const salesBySeller = (uid) => firestore
    .collection("anjuPayFleaSales")
    .where("sellerUid", "==", uid);
  const purchasesByBuyer = (uid) => firestore
    .collection("anjuPayFleaSales")
    .where("buyerUid", "==", uid);

  async function ensure(uid) {
    const reference = statsRef(uid);
    const existingSnapshot = await reference.get();
    if (
      existingSnapshot.exists
      && Number(existingSnapshot.get("schemaVersion") || 0)
        >= FLEA_ACHIEVEMENT_STATS_SCHEMA_VERSION
      && existingSnapshot.get("historyBackfilled") === true
    ) {
      return normalizeFleaStats(existingSnapshot.data());
    }

    const [historicalListings, historicalSales, historicalPurchases] = await Promise.all([
      countQuery(listingsBySeller(uid)),
      countQuery(salesBySeller(uid)),
      countQuery(purchasesByBuyer(uid)),
    ]);
    let result = null;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = normalizeFleaStats(snapshot.data());
      const timestamp = now();
      result = normalizeFleaStats({
        listings: Math.max(current.listings, historicalListings),
        sales: Math.max(current.sales, historicalSales),
        purchases: Math.max(current.purchases, historicalPurchases),
      });
      transaction.set(reference, {
        schemaVersion: FLEA_ACHIEVEMENT_STATS_SCHEMA_VERSION,
        ...result,
        historyBackfilled: true,
        historyBackfilledAt: Number(snapshot.get("historyBackfilledAt") || timestamp),
        updatedAt: timestamp,
      }, { merge: true });
    });
    return result;
  }

  return Object.freeze({
    ensure,
    statsRef,
  });
}

module.exports = Object.freeze({
  FLEA_ACHIEVEMENT_STATS_SCHEMA_VERSION,
  aggregateCount,
  createAnjuPayFleaAchievementStatsStore,
});
