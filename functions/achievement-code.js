"use strict";

const crypto = require("node:crypto");

const DOLLMASTER_ACHIEVEMENT_ID = "special_dollmaster";
const ACHIEVEMENT_CODE_FAILURE_LIMIT = 5;
const ACHIEVEMENT_CODE_LOCK_MS = 60_000;

function normalizeAchievementCode(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toUpperCase();
}

function isValidAchievementCodeFormat(value) {
  return /^[A-Z0-9]{4}$/.test(value);
}

function achievementCodeMatches(value, expectedValue) {
  const code = normalizeAchievementCode(value);
  const expectedCode = normalizeAchievementCode(expectedValue);
  if (!isValidAchievementCodeFormat(code) || !isValidAchievementCodeFormat(expectedCode)) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(code, "ascii"),
    Buffer.from(expectedCode, "ascii"),
  );
}

function count(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function normalizeAchievementCodeAttempt(value) {
  return {
    failedAttempts: count(value?.failedAttempts, ACHIEVEMENT_CODE_FAILURE_LIMIT),
    windowStartedAt: count(value?.windowStartedAt),
    lockedUntil: count(value?.lockedUntil),
    updatedAt: count(value?.updatedAt),
  };
}

function achievementCodeAttemptDecision(value, { matches = false, now = Date.now() } = {}) {
  const timestamp = count(now);
  const current = normalizeAchievementCodeAttempt(value);
  if (current.lockedUntil > timestamp) {
    return {
      status: "locked",
      retryAfterMs: current.lockedUntil - timestamp,
      state: current,
    };
  }
  if (matches) {
    return { status: "matched", retryAfterMs: 0, state: null };
  }

  const insideWindow = current.windowStartedAt > 0
    && current.windowStartedAt <= timestamp
    && timestamp - current.windowStartedAt < ACHIEVEMENT_CODE_LOCK_MS;
  const failedAttempts = (insideWindow ? current.failedAttempts : 0) + 1;
  const windowStartedAt = insideWindow ? current.windowStartedAt : timestamp;
  const locked = failedAttempts >= ACHIEVEMENT_CODE_FAILURE_LIMIT;
  const lockedUntil = locked ? timestamp + ACHIEVEMENT_CODE_LOCK_MS : 0;
  return {
    status: locked ? "locked" : "invalid",
    retryAfterMs: locked ? ACHIEVEMENT_CODE_LOCK_MS : 0,
    state: {
      failedAttempts,
      windowStartedAt,
      lockedUntil,
      updatedAt: timestamp,
    },
  };
}

async function applyDollmasterRedemptionTransaction({
  transaction,
  redemptionRef,
  receiptRef,
  profileRef,
  matches,
  now,
  normalizeProfile,
  unlock,
  achievementId = DOLLMASTER_ACHIEVEMENT_ID,
}) {
  const [redemptionSnapshot, receiptSnapshot, profileSnapshot] = await Promise.all([
    transaction.get(redemptionRef),
    transaction.get(receiptRef),
    transaction.get(profileRef),
  ]);
  const profile = normalizeProfile(profileSnapshot.data());
  const profileUnlockedAt = Number(profile.unlocked[achievementId] || 0);
  const receiptUnlockedAt = Number(receiptSnapshot.get("redeemedAt") || 0);

  if (receiptSnapshot.exists || profileUnlockedAt > 0) {
    const redeemedAt = Math.max(1, receiptUnlockedAt || profileUnlockedAt || now);
    const repaired = profileUnlockedAt > 0
      ? { profile, newlyUnlocked: [] }
      : unlock(profile, [achievementId], redeemedAt);
    if (!profileSnapshot.exists || repaired.newlyUnlocked.length) {
      transaction.set(profileRef, repaired.profile);
    }
    if (!receiptSnapshot.exists) {
      transaction.set(receiptRef, {
        schemaVersion: 1,
        codeId: "dollmaster",
        achievementId,
        redeemedAt,
      });
    }
    if (redemptionSnapshot.exists) transaction.delete(redemptionRef);
    return { status: "redeemed", alreadyUnlocked: true };
  }

  const decision = achievementCodeAttemptDecision(redemptionSnapshot.data(), { matches, now });
  if (decision.state) transaction.set(redemptionRef, { schemaVersion: 1, ...decision.state });
  else if (redemptionSnapshot.exists) transaction.delete(redemptionRef);
  if (decision.status !== "matched") {
    return {
      status: decision.status,
      retryAfterMs: decision.retryAfterMs,
    };
  }

  const unlockResult = unlock(profile, [achievementId], now);
  transaction.set(profileRef, unlockResult.profile);
  transaction.set(receiptRef, {
    schemaVersion: 1,
    codeId: "dollmaster",
    achievementId,
    redeemedAt: now,
  });
  return { status: "redeemed", alreadyUnlocked: false };
}

module.exports = Object.freeze({
  ACHIEVEMENT_CODE_FAILURE_LIMIT,
  ACHIEVEMENT_CODE_LOCK_MS,
  DOLLMASTER_ACHIEVEMENT_ID,
  applyDollmasterRedemptionTransaction,
  achievementCodeAttemptDecision,
  achievementCodeMatches,
  isValidAchievementCodeFormat,
  normalizeAchievementCode,
  normalizeAchievementCodeAttempt,
});
