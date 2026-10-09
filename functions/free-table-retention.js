"use strict";

const { cleanupRetiredFreeTableRuntime } = require("./free-table-retirement");

// Keep the existing expiry policy, not the retired mode's five-minute scans.
const RETENTION_COLLECTIONS = Object.freeze([
  "freeTableReports",
  "freeTablePublicCardReports",
  "freeTablePublicCardReportLimits",
  "freeTableVisitLedger",
]);

async function cleanupRetiredFreeTableHistory({ firestore, realtime, Timestamp, now = Date.now() }) {
  const removed = {};
  for (const name of RETENTION_COLLECTIONS) {
    removed[name] = 0;
    for (let page = 0; page < 5; page += 1) {
      const snapshot = await firestore.collection(name)
        .where("expireAt", "<=", Timestamp.fromMillis(now)).limit(100).get();
      if (snapshot.empty) break;
      const batch = firestore.batch();
      for (const document of snapshot.docs) batch.delete(document.ref);
      await batch.commit();
      removed[name] += snapshot.size;
      if (snapshot.size < 100) break;
    }
  }
  const runtime = await cleanupRetiredFreeTableRuntime({ realtime, now });
  return { retired: true, removed, runtime };
}

module.exports = { RETENTION_COLLECTIONS, cleanupRetiredFreeTableHistory };
