"use strict";

const { createHash } = require("node:crypto");

// Bound costly initialization across tabs and function instances. One small
// rolling record per UID; expired windows are replaced on the next request.
const INITIALIZE_WINDOW_MS = 60_000;
const INITIALIZE_LIMIT = 12;

function createEconomyInitializeRateLimiter({ realtime, HttpsError, now = Date.now }) {
  return async function consumeEconomyInitializeRate(uid) {
    const at = now();
    const owner = createHash("sha256").update("economy-initialize:v1:").update(uid).digest("hex");
    const result = await realtime.ref(`online/economyActionRates/${owner}`).transaction((current) => {
      const start = Number(current?.windowStartedAt || 0);
      const inWindow = start > at - INITIALIZE_WINDOW_MS && start <= at;
      const count = inWindow ? Number(current?.count || 0) : 0;
      if (!Number.isSafeInteger(count) || count < 0 || count >= INITIALIZE_LIMIT) return;
      return { windowStartedAt: inWindow ? start : at, count: count + 1 };
    });
    if (!result.committed) {
      throw new HttpsError("resource-exhausted", "読み込みが短時間に集中しています。1分ほど待ってからお試しください。");
    }
  };
}

module.exports = { createEconomyInitializeRateLimiter, INITIALIZE_LIMIT, INITIALIZE_WINDOW_MS };
