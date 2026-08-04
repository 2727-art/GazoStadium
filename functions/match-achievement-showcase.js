"use strict";

const {
  MAX_SHOWCASE,
  effectiveShowcase,
  normalizeAchievementProfile,
  sanitizeAchievementIds,
} = require("./achievements");

const MATCH_ACHIEVEMENT_SHOWCASE_VERSION = 1;
const MATCH_ACHIEVEMENT_SHOWCASE_READ_TIMEOUT_MS = 250;
const SAFE_UID_PATTERN = /^[^\u0000-\u001f\u007f.#$\[\]\/]{1,128}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length
    && keys.every((key) => typeof key === "string" && expectedKeys.includes(key));
}

function normalizeParticipantUids(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const participantUids = value.map((uid) => String(uid || ""));
  if (participantUids.some((uid) => !SAFE_UID_PATTERN.test(uid))
      || participantUids[0] === participantUids[1]) return null;
  return participantUids;
}

function matchAchievementParticipantUids(room) {
  if (!isRecord(room)) return null;
  const participantUids = normalizeParticipantUids([room.hostUid, room.guestUid]);
  if (!participantUids) return null;
  for (const uid of participantUids) {
    if (room.members?.[uid] !== true || room.players?.[uid]?.uid !== uid) return null;
  }
  return participantUids;
}

function strategyAchievementShowcaseRevealReady(room, participantUidValues) {
  const participantUids = normalizeParticipantUids(participantUidValues);
  return Boolean(participantUids && participantUids.every(
    (uid) => room?.deckReady?.[uid]?.ready === true,
  ));
}

async function settleMatchAchievementShowcaseRead(
  readOperation,
  timeoutMs = MATCH_ACHIEVEMENT_SHOWCASE_READ_TIMEOUT_MS,
) {
  if (typeof readOperation !== "function"
      || !Number.isSafeInteger(timeoutMs)
      || timeoutMs <= 0
      || timeoutMs > 5_000) {
    throw new TypeError("Invalid match achievement showcase read boundary");
  }
  let timeoutHandle = null;
  const operation = Promise.resolve()
    .then(readOperation)
    .then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error }),
    );
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });
  const outcome = await Promise.race([operation, timeout]);
  clearTimeout(timeoutHandle);
  return outcome;
}

function buildMatchAchievementShowcases(participantUidValues, profileValues, capturedAt) {
  const participantUids = normalizeParticipantUids(participantUidValues);
  if (!participantUids
      || !Array.isArray(profileValues)
      || profileValues.length !== participantUids.length
      || !Number.isSafeInteger(capturedAt)
      || capturedAt <= 0) {
    throw new TypeError("Invalid match achievement showcase source");
  }
  const players = Object.fromEntries(participantUids.map((uid, index) => {
    const profile = normalizeAchievementProfile(profileValues[index]);
    const ids = effectiveShowcase(profile).slice(0, MAX_SHOWCASE);
    return [uid, { ids: ids.join(",") }];
  }));
  return {
    version: MATCH_ACHIEVEMENT_SHOWCASE_VERSION,
    capturedAt,
    players,
  };
}

function normalizeMatchAchievementShowcases(value, participantUidValues) {
  const participantUids = normalizeParticipantUids(participantUidValues);
  if (!participantUids
      || !hasOnlyKeys(value, ["version", "capturedAt", "players"])
      || value.version !== MATCH_ACHIEVEMENT_SHOWCASE_VERSION
      || !Number.isSafeInteger(value.capturedAt)
      || value.capturedAt <= 0
      || !hasOnlyKeys(value.players, participantUids)) return null;

  const playerEntries = [];
  for (const uid of participantUids) {
    const player = value.players[uid];
    if (!hasOnlyKeys(player, ["ids"]) || typeof player.ids !== "string") return null;
    const ids = player.ids ? player.ids.split(",") : [];
    const canonicalIds = sanitizeAchievementIds(ids, { maximum: MAX_SHOWCASE });
    if (canonicalIds.join(",") !== player.ids) return null;
    playerEntries.push([uid, { ids: player.ids }]);
  }
  return {
    version: MATCH_ACHIEVEMENT_SHOWCASE_VERSION,
    capturedAt: value.capturedAt,
    players: Object.fromEntries(playerEntries),
  };
}

module.exports = Object.freeze({
  MATCH_ACHIEVEMENT_SHOWCASE_READ_TIMEOUT_MS,
  MATCH_ACHIEVEMENT_SHOWCASE_VERSION,
  buildMatchAchievementShowcases,
  matchAchievementParticipantUids,
  normalizeMatchAchievementShowcases,
  normalizeParticipantUids,
  settleMatchAchievementShowcaseRead,
  strategyAchievementShowcaseRevealReady,
});
