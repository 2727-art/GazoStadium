"use strict";

const crypto = require("node:crypto");

const SOLO_FAMILIAR_ROLLOUT_STAGES = Object.freeze([
  "engawa_only",
  "familiar_book",
  "reunion",
]);
const SOLO_FAMILIAR_BOOK_LIMIT = 100;
const SOLO_FAMILIAR_BLOCK_LIST_LIMIT = 100;
const SOLO_FAMILIAR_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const SOLO_FAMILIAR_REUNION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SOLO_MATCH_PERMIT_TTL_MS = 30 * 1000;

function opaqueId(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part)).join(":"))
    .digest("hex")
    .slice(0, 40);
}

function soloFamiliarPairId(firstUid, secondUid) {
  const participants = [String(firstUid || ""), String(secondUid || "")].sort();
  return opaqueId("solo-familiar-pair", ...participants);
}

function soloFamiliarIntentId(uid, roomId) {
  return opaqueId("solo-familiar-intent", uid, roomId);
}

function soloFamiliarEntryId(randomBytes = crypto.randomBytes) {
  const value = randomBytes(20);
  if (!Buffer.isBuffer(value) || value.length !== 20) {
    throw new TypeError("solo familiar entry id requires 20 random bytes");
  }
  return value.toString("hex");
}

function normalizeSoloFamiliarRolloutStage(value, serverAuthority = false) {
  const requested = SOLO_FAMILIAR_ROLLOUT_STAGES.includes(value) ? value : "engawa_only";
  if (requested === "reunion" && serverAuthority !== true) return "familiar_book";
  return requested;
}

function soloFamiliarRolloutFlags(stageValue, serverAuthority = false) {
  const stage = normalizeSoloFamiliarRolloutStage(stageValue, serverAuthority);
  const stageIndex = SOLO_FAMILIAR_ROLLOUT_STAGES.indexOf(stage);
  return Object.freeze({
    stage,
    familiarBookEnabled: stageIndex >= SOLO_FAMILIAR_ROLLOUT_STAGES.indexOf("familiar_book"),
    reunionEnabled: stage === "reunion",
  });
}

async function loadSoloFamiliarReunionEnabled({
  loadServerAuthority,
  loadRolloutStage,
} = {}) {
  if (typeof loadServerAuthority !== "function" || typeof loadRolloutStage !== "function") {
    throw new TypeError("Solo familiar reunion rollout requires both loaders.");
  }
  if (await loadServerAuthority() !== true) return false;
  return soloFamiliarRolloutFlags(await loadRolloutStage(), true).reunionEnabled;
}

function normalizeImagePreference(value) {
  return ["illustration", "live_action", "both"].includes(value) ? value : "legacy";
}

function soloQueuePreferenceTier(firstEntry, secondEntry) {
  const firstPreference = normalizeImagePreference(firstEntry?.ratingPreference);
  const secondPreference = normalizeImagePreference(secondEntry?.ratingPreference);
  if (firstPreference !== "legacy" && firstPreference === secondPreference) {
    return firstPreference === "both" ? 1 : 0;
  }
  if (firstPreference === "both" || secondPreference === "both") return 1;
  if (firstPreference === "legacy" && secondPreference === "legacy") return 1;
  const firstAllowsMismatch = firstPreference === "legacy" || firstEntry?.allowPreferenceMismatch === true;
  const secondAllowsMismatch = secondPreference === "legacy" || secondEntry?.allowPreferenceMismatch === true;
  return firstAllowsMismatch && secondAllowsMismatch ? 2 : Number.POSITIVE_INFINITY;
}

function isValidSoloServerQueueEntry(uid, entry, now, freshMs = 45_000) {
  const participantUid = String(uid || "");
  const currentTime = Number(now);
  if (!participantUid || !entry || typeof entry !== "object"
      || !Number.isFinite(currentTime)
      || String(entry.uid || "") !== participantUid
      || entry.state !== "waiting") return false;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const pursuitLine = typeof entry.pursuitLine === "string" ? entry.pursuitLine.trim() : "";
  const joinedAt = Number(entry.joinedAt);
  const lastSeen = Number(entry.lastSeen);
  const ratingPreference = String(entry.ratingPreference || "");
  return Boolean(
    name
    && name.length <= 16
    && pursuitLine
    && pursuitLine.length <= 40
    && !/[\r\n]/.test(entry.pursuitLine)
    && Number.isInteger(entry.streak)
    && entry.streak >= 0
    && Number.isInteger(entry.rating)
    && entry.rating >= 100
    && entry.rating <= 3000
    && ["illustration", "live_action", "both"].includes(ratingPreference)
    && typeof entry.allowPreferenceMismatch === "boolean"
    && typeof entry.reunionPreference === "boolean"
    && Number.isInteger(entry.sampleCount)
    && entry.sampleCount >= 0
    && entry.sampleCount <= 5
    && Number.isInteger(entry.startingHp)
    && entry.startingHp === 30 - (entry.sampleCount * 5)
    && Number.isFinite(joinedAt)
    && joinedAt >= currentTime - (24 * 60 * 60 * 1000)
    && joinedAt <= currentTime + 15_000
    && Number.isFinite(lastSeen)
    && lastSeen >= currentTime - freshMs
    && lastSeen <= currentTime + 15_000
  );
}

function normalizedPairParticipants(value) {
  if (!Array.isArray(value) || value.length !== 2) return [];
  const participants = value.map((uid) => String(uid || "")).filter(Boolean).sort();
  return participants.length === 2 && participants[0] !== participants[1] ? participants : [];
}

function canReactivateSoloFamiliarPair(pair, firstAcceptedAt, secondAcceptedAt) {
  const endedAt = Number(pair?.endedAt || 0);
  return Number(firstAcceptedAt) > endedAt && Number(secondAcceptedAt) > endedAt;
}

function publicSoloFamiliarBookEntry(id, value, ownerUid) {
  if (!/^[a-f0-9]{40}$/.test(String(id || ""))
      || value?.ownerUid !== ownerUid
      || value?.active !== true) return null;
  const name = String(value?.displayName || "").trim().slice(0, 16);
  if (!name) return null;
  return Object.freeze({
    id: String(id),
    name,
    createdAt: Math.max(0, Number(value?.createdAt || 0)),
  });
}

function publicSoloFamiliarBlockEntry(id, value, ownerUid) {
  if (!/^[a-f0-9]{40}$/.test(String(id || "")) || value?.ownerUid !== ownerUid) return null;
  const name = String(value?.displayName || "").trim().slice(0, 16);
  if (!name) return null;
  return Object.freeze({
    id: String(id),
    name,
  });
}

function selectSoloServerMatch({
  requesterUid,
  queue,
  active,
  familiarPairs,
  blockedPairIds,
  excludedUids,
  now,
  freshMs = 45_000,
}) {
  const requestUid = String(requesterUid || "");
  if (!requestUid) return null;
  const currentTime = Number(now);
  const activeUsers = active && typeof active === "object" ? active : {};
  const blocked = new Set(Array.isArray(blockedPairIds) ? blockedPairIds.map(String) : []);
  const excluded = new Set(Array.isArray(excludedUids) ? excludedUids.map(String) : []);
  const waiting = Object.entries(queue && typeof queue === "object" ? queue : {})
    .filter(([uid, entry]) => isValidSoloServerQueueEntry(uid, entry, currentTime, freshMs))
    .map(([uid, entry]) => ({ ...entry, uid }))
    .filter((entry) => !activeUsers[entry.uid] && !excluded.has(entry.uid))
    .sort((first, second) => (
      Number(first.joinedAt || 0) - Number(second.joinedAt || 0)
      || first.uid.localeCompare(second.uid)
    ));
  if (waiting.length < 2) return null;
  const requester = waiting.find((entry) => entry.uid === requestUid);
  if (!requester) return null;

  const familiarByPairId = new Map();
  for (const record of Array.isArray(familiarPairs) ? familiarPairs : []) {
    const data = record?.data && typeof record.data === "object" ? record.data : record;
    const participants = normalizedPairParticipants(data?.participants);
    if (!participants.length || data?.active !== true) continue;
    const pairId = String(record?.id || soloFamiliarPairId(...participants));
    familiarByPairId.set(pairId, { ...data, participants });
  }

  const candidates = [];
  for (const candidate of waiting) {
    if (candidate.uid === requester.uid) continue;
    const preferenceTier = soloQueuePreferenceTier(requester, candidate);
    if (!Number.isFinite(preferenceTier)) continue;
    const pairId = soloFamiliarPairId(requester.uid, candidate.uid);
    if (blocked.has(pairId)) continue;
    const familiar = familiarByPairId.get(pairId);
    const reunion = Boolean(
      familiar
      && requester.reunionPreference === true
      && candidate.reunionPreference === true
      && Number(familiar.lastReunionPriorityAt || 0)
        <= currentTime - SOLO_FAMILIAR_REUNION_COOLDOWN_MS
    );
    candidates.push({
      host: requester,
      candidate,
      preferenceTier,
      reunion,
      pairId: reunion ? pairId : "",
    });
  }
  candidates.sort((first, second) => (
    Number(second.reunion) - Number(first.reunion)
    || first.preferenceTier - second.preferenceTier
    || Number(first.candidate.joinedAt || 0) - Number(second.candidate.joinedAt || 0)
    || first.candidate.uid.localeCompare(second.candidate.uid)
  ));
  return candidates[0] || null;
}

module.exports = Object.freeze({
  SOLO_FAMILIAR_BLOCK_LIST_LIMIT,
  SOLO_FAMILIAR_BOOK_LIMIT,
  SOLO_FAMILIAR_INTENT_TTL_MS,
  SOLO_FAMILIAR_REUNION_COOLDOWN_MS,
  SOLO_FAMILIAR_ROLLOUT_STAGES,
  SOLO_MATCH_PERMIT_TTL_MS,
  canReactivateSoloFamiliarPair,
  isValidSoloServerQueueEntry,
  loadSoloFamiliarReunionEnabled,
  normalizeSoloFamiliarRolloutStage,
  publicSoloFamiliarBlockEntry,
  publicSoloFamiliarBookEntry,
  selectSoloServerMatch,
  soloFamiliarEntryId,
  soloFamiliarIntentId,
  soloFamiliarPairId,
  soloFamiliarRolloutFlags,
  soloQueuePreferenceTier,
});
