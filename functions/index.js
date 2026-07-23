"use strict";

const crypto = require("node:crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const {
  APP_CHECK_ENFORCEMENT,
  MARKET_APP_CHECK_MIGRATION,
} = require("./app-check-rollout");
const {
  isIncomingMarketRoomStateOlder,
  nextPublicMarketRoomHeartbeat,
  nextPublicMarketRoomState,
} = require("./market-presence-state");
const {
  createMarketRankingRow,
  hasRankedMarketStats,
  isMarketPublicProfilePrivacyReduction,
  isValidMarketTagline,
  isValidMarketXHandle,
  marketPublicProfileUpdateDecision,
  normalizeMarketTagline,
  normalizeMarketXHandle,
  sanitizeStoredMarketPublicProfile,
} = require("./market-public-profile");
const {
  addBattleMatch,
  addMarketTransaction,
  deriveBattleStatsFromPeriods,
  effectiveShowcase,
  eligibleAchievementIds,
  normalizeAchievementProfile,
  normalizeBattleStats,
  normalizeMarketStats,
  publicAchievementProfile,
  sanitizeAchievementIds,
  unlockAchievements,
} = require("./achievements");
const {
  PATRON_TIERS,
  normalizePatronage,
  patronUpgrade,
  publicPatronage,
} = require("./patronage");
const {
  TRANSFER_CODE_TTL_MS,
  TRANSFER_CREATE_COOLDOWN_MS,
  createTransferCode,
  formatTransferCode,
  hashTransferCode,
  nextAttemptState,
  normalizeAttemptState,
  normalizeTransferCode,
  transferCodeDecision,
} = require("./account-transfer");
const {
  MARKET_SUCCESS_FEE_BASIS_POINTS,
  POST_MATCH_TIP_AMOUNTS,
  marketSaleSettlement,
  postMatchTipAmount,
} = require("./market-economy");
const {
  SERVER_RANKING_AWARD_MINIMUM_MATCHES,
  SERVER_RANKING_MODES,
  SERVER_RANKING_PERIODS,
  SERVER_RANKING_VERSION,
  addServerRankingResult,
  compareServerRankingEntries,
  emptyServerRankingEntry,
  isServerRankingPeriod,
  normalizeServerRankingEntry,
  resolveServerRankingAward,
  serverRankingEntryDocumentId,
  serverRankingMatches,
} = require("./server-ranking");
const PRODUCT_CATALOG = require("./product-catalog");

initializeApp({
  databaseURL: "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app",
});
setGlobalOptions({ region: "us-central1", maxInstances: 20 });

const firestore = getFirestore();
const realtime = getDatabase();
const adminAuth = getAuth();
const MAX_POINTS = 999_999;
const MARKET_ENTRY_FEE = 5;
const MARKET_MAX_TURNS = 3;
const MARKET_MIN_PRICE = 10;
const MARKET_MAX_PRICE = 500;
const MARKET_EXTENSION_FEES = new Set([5, 10, 20]);
const QUEUE_FRESH_MS = 60_000;
const MARKET_PROFILE_UPDATE_COOLDOWN_MS = 10_000;
const MARKET_PUBLIC_PRESENCE_PATH = "online/publicMarketPresence";
const CALLABLE_BASE_OPTIONS = Object.freeze({
  timeoutSeconds: 30,
  memory: "256MiB",
});

function callableOptions(functionName) {
  if (!Object.hasOwn(APP_CHECK_ENFORCEMENT, functionName)) {
    throw new Error(`Missing App Check policy for callable: ${functionName}`);
  }
  const options = {
    ...CALLABLE_BASE_OPTIONS,
    enforceAppCheck: APP_CHECK_ENFORCEMENT[functionName],
  };
  if (functionName === "accountTransfer") options.consumeAppCheckToken = true;
  return options;
}
const DAILY_MISSIONS = Object.freeze({
  complete_match: { progressKey: "matches", target: 1, reward: 100, endsAfter: "2026-07-23" },
  score_three: { progressKey: "scores", target: 3, reward: 60 },
  give_critical: { progressKey: "criticals", target: 1, reward: 90 },
  play_solo: { progressKey: "soloMatches", target: 1, reward: 40 },
  play_strategy: { progressKey: "strategyMatches", target: 1, reward: 50 },
  play_team: { progressKey: "teamMatches", target: 1, reward: 70 },
  play_royale: { progressKey: "royaleMatches", target: 1, reward: 90 },
});

function requireUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "匿名ログインが必要です。");
  return uid;
}

function cleanText(value, maxLength, fallback = "") {
  return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanName(value) {
  return cleanText(value, 16, "PLAYER") || "PLAYER";
}

function integer(value, min, max, fallback = min) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeBalance(value) {
  return integer(value, 0, MAX_POINTS, 0);
}

function jstDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function periodKey(period, timestamp = Date.now()) {
  const shifted = new Date(timestamp + (9 * 60 * 60 * 1000));
  if (period === "monthly") return shifted.toISOString().slice(0, 7);
  if (period === "weekly") {
    const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
    shifted.setUTCDate(shifted.getUTCDate() - daysSinceMonday);
  }
  return shifted.toISOString().slice(0, 10);
}

function periodEndsAt(period, key) {
  const startKey = period === "monthly" ? `${key}-01` : key;
  const startAt = Date.parse(`${startKey}T00:00:00+09:00`);
  if (!Number.isFinite(startAt)) return 0;
  if (period === "daily") return startAt + (24 * 60 * 60 * 1000);
  if (period === "weekly") return startAt + (7 * 24 * 60 * 60 * 1000);
  const shiftedStart = new Date(startAt + (9 * 60 * 60 * 1000));
  return Date.UTC(shiftedStart.getUTCFullYear(), shiftedStart.getUTCMonth() + 1, 1) - (9 * 60 * 60 * 1000);
}

function eventId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function walletRef(uid) {
  return firestore.collection("wallets").doc(uid);
}

function economyProgressRef(uid) {
  return firestore.collection("economyProgress").doc(uid);
}

function achievementProfileRef(uid) {
  return firestore.collection("achievementProfiles").doc(uid);
}

function serverRankingProfileRef(uid) {
  return firestore.collection("serverRankingProfiles").doc(uid);
}

function serverRankingEntryRef(uid, period, key) {
  return serverRankingProfileRef(uid).collection("entries").doc(serverRankingEntryDocumentId(period, key));
}

function serverRankingAwardRef(uid, period, key) {
  return serverRankingProfileRef(uid).collection("awards").doc(serverRankingEntryDocumentId(period, key));
}

function serverRankingPeriodEntryRef(uid, period, key) {
  return firestore
    .collection("serverRankingPeriods")
    .doc(serverRankingEntryDocumentId(period, key))
    .collection("entries")
    .doc(uid);
}

function patronageRef(uid) {
  return firestore.collection("valueMarketPatrons").doc(uid);
}

function patronageLedgerRef(uid, actionId) {
  return firestore.collection("valueMarketPatronLedger").doc(eventId(`${uid}:${actionId}`));
}

function verifiedMatchClaimRef(uid, mode, roomId) {
  return firestore.collection("verifiedMatchClaims").doc(eventId(`${uid}:${mode}:${roomId}`));
}

function postMatchTipRef(uid, mode, roomId) {
  return firestore.collection("postMatchTips").doc(eventId(`${uid}:${mode}:${roomId}`));
}

function marketCertificateRef(uid, roomId) {
  return firestore.collection("valueMarketCertificates")
    .doc(uid)
    .collection("items")
    .doc(eventId(`${uid}:${roomId}`));
}

function transferCodeRef(codeHash) {
  return firestore.collection("accountTransferCodes").doc(codeHash);
}

function transferSourceRef(uid) {
  return firestore.collection("accountTransferSources").doc(uid);
}

function transferAttemptRef(uid) {
  return firestore.collection("accountTransferAttempts").doc(uid);
}

function normalizeServerRankingProfile(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackRating = integer(fallback.rating, 100, 3000, 1000);
  const xHandle = cleanText(source.xHandle || fallback.xHandle, 15);
  const achievementShowcase = cleanText(source.achievementShowcase || fallback.achievementShowcase, 160);
  const rankingAwardTier = cleanText(source.rankingAwardTier || fallback.rankingAwardTier, 40);
  const rankingAwardUntil = Number(source.rankingAwardUntil || fallback.rankingAwardUntil || 0);
  return {
    version: SERVER_RANKING_VERSION,
    enabled: source.enabled === true,
    entryId: cleanText(source.entryId || fallback.entryId, 40),
    name: cleanName(source.name || fallback.name),
    rating: integer(source.rating, 100, 3000, fallbackRating),
    legacyRating: integer(source.legacyRating, 100, 3000, fallbackRating),
    serverMatches: integer(source.serverMatches, 0, 100_000, 0),
    commentsEnabled: source.commentsEnabled !== false,
    enabledAt: Number(source.enabledAt || fallback.enabledAt || 0),
    updatedAt: Number(source.updatedAt || fallback.updatedAt || Date.now()),
    ...(xHandle && /^[A-Za-z0-9_]{1,15}$/.test(xHandle) ? { xHandle } : {}),
    ...(achievementShowcase ? { achievementShowcase } : {}),
    ...(rankingAwardTier && rankingAwardUntil > Date.now() ? {
      rankingAwardTier,
      rankingAwardLabel: cleanText(source.rankingAwardLabel || fallback.rankingAwardLabel, 40),
      rankingAwardUntil,
    } : {}),
  };
}

function activeServerRankingPeriodInfos(timestamp = Date.now()) {
  return SERVER_RANKING_PERIODS.map((period) => {
    const key = periodKey(period, timestamp);
    return {
      period,
      key,
      endsAt: periodEndsAt(period, key),
    };
  }).filter(({ period, key }) => isServerRankingPeriod(period, key));
}

function calculateServerRankingRating(currentRating, opponentRating, outcome) {
  const current = integer(currentRating, 100, 3000, 1000);
  const opponent = integer(opponentRating, 100, 3000, 1000);
  const expected = 1 / (1 + (10 ** ((opponent - current) / 400)));
  const actual = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
  return integer(Math.round(current + (32 * (actual - expected))), 100, 3000, current);
}

function serverRankingOpponentRating(mode, room, participantUid, participants, profiles) {
  if (mode === "royale") return 1000;
  const playerTeam = room?.players?.[participantUid]?.team;
  const opponentRatings = participants.filter((candidateUid) => {
    if (candidateUid === participantUid) return false;
    if (mode !== "team") return true;
    return room?.players?.[candidateUid]?.team !== playerTeam;
  }).map((candidateUid) => (
    profiles[candidateUid]?.rating
    || room?.players?.[candidateUid]?.rating
    || 1000
  ));
  if (!opponentRatings.length) return 1000;
  return opponentRatings.reduce((sum, rating) => sum + integer(rating, 100, 3000, 1000), 0) / opponentRatings.length;
}

function publicServerRankingEntry(value) {
  const entry = normalizeServerRankingEntry(value, value);
  if (!entry) return null;
  return {
    serverVerified: true,
    version: SERVER_RANKING_VERSION,
    name: cleanName(entry.name),
    points: entry.points,
    wins: entry.wins,
    losses: entry.losses,
    draws: entry.draws,
    rating: entry.rating,
    modePoints: entry.modePoints,
    modeMatches: entry.modeMatches,
    commentsEnabled: entry.commentsEnabled !== false,
    endsAt: entry.endsAt,
    updatedAt: entry.updatedAt,
    ...(entry.xHandle ? { xHandle: entry.xHandle } : {}),
    ...(entry.achievementShowcase ? { achievementShowcase: entry.achievementShowcase } : {}),
    ...(entry.rankingAwardTier && Number(entry.rankingAwardUntil || 0) > Date.now() ? {
      rankingAwardTier: entry.rankingAwardTier,
      rankingAwardLabel: entry.rankingAwardLabel,
      rankingAwardUntil: entry.rankingAwardUntil,
    } : {}),
  };
}

async function mirrorServerRankingEntries(entriesByUid) {
  const updates = {};
  Object.entries(entriesByUid || {}).forEach(([uid, entries]) => {
    Object.values(entries || {}).forEach((entry) => {
      const publicEntry = publicServerRankingEntry(entry);
      if (!publicEntry || !entry.entryId) return;
      updates[`online/serverLeaderboardPeriods/${entry.period}/${entry.key}/${entry.entryId}`] = publicEntry;
      updates[`online/serverLeaderboardPeriodEntriesByUser/${uid}/${entry.period}/${entry.key}`] = entry.entryId;
    });
  });
  if (Object.keys(updates).length) await realtime.ref().update(updates);
}

async function legacyServerRankingSeed(uid) {
  const entryIndexSnapshot = await realtime.ref(`online/leaderboardEntriesByUser/${uid}`).get();
  const entryId = cleanText(entryIndexSnapshot.val(), 40);
  if (!/^[-0-9A-Z_a-z]{16,40}$/.test(entryId)) return null;
  const [ownerSnapshot, publicSnapshot] = await Promise.all([
    realtime.ref(`online/leaderboardOwners/${entryId}`).get(),
    realtime.ref(`online/leaderboard/${entryId}`).get(),
  ]);
  if (String(ownerSnapshot.val() || "") !== uid || !publicSnapshot.exists()) return null;
  const publicValue = objectValue(publicSnapshot.val());
  const xHandle = cleanText(publicValue.xHandle, 15);
  const now = Date.now();
  return {
    enabled: true,
    entryId,
    name: cleanName(publicValue.name),
    rating: integer(publicValue.rating, 100, 3000, 1000),
    legacyRating: integer(publicValue.rating, 100, 3000, 1000),
    serverMatches: 0,
    commentsEnabled: publicValue.commentsEnabled !== false,
    enabledAt: now,
    updatedAt: now,
    ...(xHandle && /^[A-Za-z0-9_]{1,15}$/.test(xHandle) ? { xHandle } : {}),
  };
}

function emptyDaily(dateKey = jstDateKey()) {
  return {
    dateKey,
    matches: 0,
    scores: 0,
    criticals: 0,
    soloMatches: 0,
    strategyMatches: 0,
    teamMatches: 0,
    royaleMatches: 0,
    claimed: {},
  };
}

function normalizeDaily(value, dateKey = jstDateKey()) {
  if (!value || typeof value !== "object" || value.dateKey !== dateKey) return emptyDaily(dateKey);
  const daily = emptyDaily(dateKey);
  for (const [key, limit] of Object.entries({
    matches: 1,
    scores: 3,
    criticals: 1,
    soloMatches: 1,
    strategyMatches: 1,
    teamMatches: 1,
    royaleMatches: 1,
  })) {
    daily[key] = integer(value[key], 0, limit, 0);
  }
  for (const missionId of Object.keys(DAILY_MISSIONS)) {
    if (value.claimed?.[missionId] === true) daily.claimed[missionId] = true;
  }
  return daily;
}

function normalizePeriodRecords(value) {
  const periods = { daily: {}, weekly: {}, monthly: {} };
  for (const period of Object.keys(periods)) {
    const records = objectValue(value?.[period]);
    for (const [key, source] of Object.entries(records)) {
      if ((period === "monthly" && !/^[0-9]{4}-[0-9]{2}$/.test(key))
        || (period !== "monthly" && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key))) continue;
      const matches = integer(source?.matches, 0, 100_000, 0);
      const wins = integer(source?.wins, 0, matches, 0);
      const losses = integer(source?.losses, 0, matches, 0);
      const draws = integer(source?.draws, 0, matches, 0);
      if (!matches || wins + losses + draws !== matches) continue;
      periods[period][key] = {
        matches,
        verifiedMatches: integer(source?.verifiedMatches, 0, matches, 0),
        wins,
        losses,
        draws,
        points: (wins * 3) + draws,
        modeMatches: {
          solo: integer(source?.modeMatches?.solo, 0, matches, 0),
          strategy: integer(source?.modeMatches?.strategy, 0, matches, 0),
          team: integer(source?.modeMatches?.team, 0, matches, 0),
          royale: integer(source?.modeMatches?.royale, 0, matches, 0),
        },
        endsAt: Number(source?.endsAt || periodEndsAt(period, key)),
        claimed: source?.claimed === true,
        reward: integer(source?.reward, 0, 500, 0),
        ...(Number.isFinite(Number(source?.claimedAt)) ? { claimedAt: Number(source.claimedAt) } : {}),
        updatedAt: Number(source?.updatedAt || Date.now()),
      };
    }
  }
  return periods;
}

function normalizeEconomyProgress(value, dateKey = jstDateKey()) {
  const periodRewards = normalizePeriodRecords(value?.periodRewards);
  const achievementStats = value?.achievementStats
    ? normalizeBattleStats(value.achievementStats)
    : deriveBattleStatsFromPeriods(periodRewards);
  return {
    schemaVersion: 2,
    daily: normalizeDaily(value?.daily, dateKey),
    periodRewards,
    achievementStats,
    initializedAt: Number(value?.initializedAt || Date.now()),
    updatedAt: Number(value?.updatedAt || Date.now()),
  };
}

async function readLegacyEconomy(uid) {
  const snapshot = await realtime.ref(`online/economy/${uid}`).get();
  const value = snapshot.val();
  return value && typeof value === "object" ? value : {};
}

async function ensureWallet(uid, legacyEconomy = null) {
  const ref = walletRef(uid);
  const existing = await ref.get();
  if (existing.exists) return safeBalance(existing.get("balance"));
  const legacy = legacyEconomy || await readLegacyEconomy(uid);
  let balance = 0;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      balance = safeBalance(snapshot.get("balance"));
      return;
    }
    balance = safeBalance(legacy.points);
    transaction.create(ref, {
      balance,
      reservedIncoming: 0,
      initializedAt: Date.now(),
      migratedFromRealtimeDatabase: true,
      updatedAt: Date.now(),
    });
  });
  await mirrorWallet(uid, balance);
  return balance;
}

async function mirrorWallet(uid, balance) {
  await realtime.ref(`online/economy/${uid}`).update({
    points: safeBalance(balance),
    updatedAt: Date.now(),
  });
}

async function ensureEconomyProgress(uid) {
  const ref = economyProgressRef(uid);
  let progress = null;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      progress = normalizeEconomyProgress(snapshot.data());
      return;
    }
    progress = normalizeEconomyProgress(null);
    transaction.create(ref, progress);
  });
  return progress;
}

async function ensureAchievementState(uid) {
  const progressRef = economyProgressRef(uid);
  const profileRef = achievementProfileRef(uid);
  const statsRef = marketStatsRef(uid);
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const [progressSnapshot, profileSnapshot, marketSnapshot] = await Promise.all([
      transaction.get(progressRef),
      transaction.get(profileRef),
      transaction.get(statsRef),
    ]);
    const progressData = progressSnapshot.exists ? progressSnapshot.data() : {};
    const progress = normalizeEconomyProgress(progressData);
    const marketStats = normalizeMarketStats(marketSnapshot.data());
    const eligibleIds = eligibleAchievementIds({
      battleStats: progress.achievementStats,
      marketStats,
    });
    const unlockResult = unlockAchievements(profileSnapshot.data(), eligibleIds);
    if (!progressSnapshot.exists
      || Number(progressData.schemaVersion || 0) < 2
      || !progressData.achievementStats) {
      transaction.set(progressRef, progress);
    }
    if (!profileSnapshot.exists || unlockResult.newlyUnlocked.length) {
      transaction.set(profileRef, unlockResult.profile);
    }
    result = {
      progress,
      marketStats,
      profile: unlockResult.profile,
      newlyUnlocked: unlockResult.newlyUnlocked,
    };
  });
  return result;
}

async function mirrorEconomyProgress(uid, progress) {
  const normalized = normalizeEconomyProgress(progress);
  await realtime.ref(`online/economy/${uid}`).update({
    daily: normalized.daily,
    periodRewards: normalized.periodRewards,
    updatedAt: Date.now(),
  });
}

async function bestEffort(label, operations) {
  const settled = await Promise.allSettled(operations);
  settled.forEach((entry, index) => {
    if (entry.status === "rejected") console.error(`${label} mirror ${index} failed`, entry.reason);
  });
}

async function retryRealtimeWrite(operation, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function syncAchievementPublicSurfaces(uid, profileValue) {
  const profile = normalizeAchievementProfile(profileValue);
  const showcase = effectiveShowcase(profile);
  const marketSnapshot = await marketStatsRef(uid).get();
  const updates = [];
  if (marketSnapshot.exists) {
    updates.push(marketStatsRef(uid).set({
      publicAchievements: effectiveShowcase(profile),
      updatedAt: Date.now(),
    }, { merge: true }));
  }

  const [entrySnapshot, periodIndexSnapshot, serverPeriodIndexSnapshot, serverProfileSnapshot] = await Promise.all([
    realtime.ref(`online/leaderboardEntriesByUser/${uid}`).get(),
    realtime.ref(`online/leaderboardPeriodEntriesByUser/${uid}`).get(),
    realtime.ref(`online/serverLeaderboardPeriodEntriesByUser/${uid}`).get(),
    serverRankingProfileRef(uid).get(),
  ]);
  const entryId = entrySnapshot.exists() ? cleanText(entrySnapshot.val(), 40) : "";
  if (entryId) {
    const periodIndex = objectValue(periodIndexSnapshot.val());
    const serverPeriodIndex = objectValue(serverPeriodIndexSnapshot.val());
    const realtimeUpdates = {};
    for (const period of ["daily", "weekly", "monthly"]) {
      const key = periodKey(period);
      if (String(periodIndex?.[period]?.[key] || "") === entryId) {
        realtimeUpdates[`online/leaderboardPeriods/${period}/${key}/${entryId}/achievementShowcase`] = showcase.length
          ? showcase.join(",")
          : null;
      }
      if (String(serverPeriodIndex?.[period]?.[key] || "") === entryId) {
        realtimeUpdates[`online/serverLeaderboardPeriods/${period}/${key}/${entryId}/achievementShowcase`] = showcase.length
          ? showcase.join(",")
          : null;
      }
    }
    if (Object.keys(realtimeUpdates).length) updates.push(realtime.ref().update(realtimeUpdates));
  }
  if (serverProfileSnapshot.exists) {
    const achievementShowcase = showcase.length ? showcase.join(",") : null;
    const activeRefs = activeServerRankingPeriodInfos().map(({ period, key }) => (
      serverRankingEntryRef(uid, period, key)
    ));
    const activeSnapshots = activeRefs.length ? await firestore.getAll(...activeRefs) : [];
    const batch = firestore.batch();
    batch.set(serverRankingProfileRef(uid), {
      achievementShowcase,
      updatedAt: Date.now(),
    }, { merge: true });
    activeSnapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;
      batch.set(snapshot.ref, {
        achievementShowcase,
        updatedAt: Date.now(),
      }, { merge: true });
    });
    updates.push(batch.commit());
  }
  await Promise.all(updates);
  return effectiveShowcase(profile);
}

async function syncCurrentServerRankingMetadata(uid, profileValue) {
  const profile = normalizeServerRankingProfile(profileValue);
  if (!profile.enabled || !profile.entryId) return {};
  const infos = activeServerRankingPeriodInfos();
  const refs = infos.map(({ period, key }) => serverRankingEntryRef(uid, period, key));
  const snapshots = refs.length ? await firestore.getAll(...refs) : [];
  const entries = {};
  const batch = firestore.batch();
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const info = infos[index];
    const current = normalizeServerRankingEntry(snapshot.data(), {
      ...info,
      entryId: profile.entryId,
      rating: profile.rating,
    });
    if (!current) return;
    const entry = {
      ...current,
      name: profile.name,
      rating: profile.rating,
      commentsEnabled: profile.commentsEnabled !== false,
      updatedAt: Date.now(),
      ...(profile.xHandle ? { xHandle: profile.xHandle } : {}),
      ...(profile.achievementShowcase ? { achievementShowcase: profile.achievementShowcase } : {}),
      ...(profile.rankingAwardTier ? {
        rankingAwardTier: profile.rankingAwardTier,
        rankingAwardLabel: profile.rankingAwardLabel,
        rankingAwardUntil: profile.rankingAwardUntil,
      } : {}),
    };
    if (!profile.xHandle) delete entry.xHandle;
    if (!profile.achievementShowcase) delete entry.achievementShowcase;
    if (!profile.rankingAwardTier) {
      delete entry.rankingAwardTier;
      delete entry.rankingAwardLabel;
      delete entry.rankingAwardUntil;
    }
    batch.set(snapshot.ref, entry);
    batch.set(serverRankingPeriodEntryRef(uid, info.period, info.key), entry);
    entries[`${info.period}:${info.key}`] = entry;
  });
  if (Object.keys(entries).length) {
    await batch.commit();
    await mirrorServerRankingEntries({ [uid]: entries });
  }
  return entries;
}

async function finalizeServerRankingAwards(uid, timestamp = Date.now()) {
  const profileSnapshot = await serverRankingProfileRef(uid).get();
  if (!profileSnapshot.exists) return [];
  const entriesSnapshot = await serverRankingProfileRef(uid)
    .collection("entries")
    .orderBy("endsAt", "desc")
    .limit(300)
    .get();
  const pending = entriesSnapshot.docs.filter((snapshot) => (
    Number(snapshot.get("endsAt") || 0) > 0
    && Number(snapshot.get("endsAt")) <= timestamp
    && !Number(snapshot.get("awardProcessedAt") || 0)
  ));

  for (const snapshot of pending) {
    const ownEntry = normalizeServerRankingEntry(snapshot.data(), snapshot.data());
    if (!ownEntry || !ownEntry.entryId) continue;
    const periodEntriesSnapshot = await firestore
      .collection("serverRankingPeriods")
      .doc(serverRankingEntryDocumentId(ownEntry.period, ownEntry.key))
      .collection("entries")
      .get();
    const minimumMatches = SERVER_RANKING_AWARD_MINIMUM_MATCHES[ownEntry.period] || 1;
    const rankedEntries = periodEntriesSnapshot.docs
      .filter((entrySnapshot) => {
        const withdrawnAt = Number(entrySnapshot.get("withdrawnAt") || 0);
        const endsAt = Number(entrySnapshot.get("endsAt") || ownEntry.endsAt || 0);
        return !withdrawnAt || withdrawnAt >= endsAt;
      })
      .map((entrySnapshot) => normalizeServerRankingEntry(
        entrySnapshot.data(),
        ownEntry,
      ))
      .filter((entry) => entry && serverRankingMatches(entry) >= minimumMatches)
      .sort(compareServerRankingEntries);
    const withdrawnAt = Number(snapshot.get("withdrawnAt") || 0);
    const withdrewBeforeEnd = withdrawnAt > 0 && withdrawnAt < ownEntry.endsAt;
    const resolution = withdrewBeforeEnd
      ? { processed: true, rank: 0, award: null }
      : resolveServerRankingAward(
        ownEntry.period,
        ownEntry,
        rankedEntries,
        {
          key: ownEntry.key,
          endsAt: ownEntry.endsAt,
          now: timestamp,
        },
      );
    if (!resolution.processed) {
      await serverRankingPeriodEntryRef(uid, ownEntry.period, ownEntry.key).set(snapshot.data());
      await mirrorServerRankingEntries({
        [uid]: { [`${ownEntry.period}:${ownEntry.key}`]: ownEntry },
      });
      continue;
    }
    const award = resolution.award;
    const awardRef = serverRankingAwardRef(uid, ownEntry.period, ownEntry.key);
    await firestore.runTransaction(async (transaction) => {
      const [entryState, awardState] = await Promise.all([
        transaction.get(snapshot.ref),
        transaction.get(awardRef),
      ]);
      if (!entryState.exists || Number(entryState.get("awardProcessedAt") || 0)) return;
      if (award && !awardState.exists) {
        const nextKey = periodKey(ownEntry.period, ownEntry.endsAt + 1000);
        transaction.create(awardRef, {
          ...award,
          activeUntil: periodEndsAt(ownEntry.period, nextKey),
        });
      }
      transaction.update(snapshot.ref, {
        awardProcessedAt: timestamp,
        awardTier: award?.tier || (withdrewBeforeEnd ? "withdrawn" : "ineligible"),
      });
    });

    if (ownEntry.period === "monthly" && rankedEntries.length) {
      const champion = rankedEntries[0];
      await realtime.ref(`online/serverRankingHallOfFame/monthly/${ownEntry.key}`).transaction((current) => (
        current || {
          entryId: champion.entryId,
          name: champion.name,
          points: champion.points,
          wins: champion.wins,
          losses: champion.losses,
          draws: champion.draws,
          rating: champion.rating,
          participants: rankedEntries.length,
          finalizedAt: timestamp,
        }
      ));
    }
  }

  const awardsSnapshot = await serverRankingProfileRef(uid)
    .collection("awards")
    .orderBy("awardedAt", "desc")
    .limit(24)
    .get();
  const awards = awardsSnapshot.docs.map((snapshot) => {
    const value = snapshot.data();
    return {
      period: cleanText(value.period, 16),
      key: cleanText(value.key, 16),
      rank: integer(value.rank, 1, 100_000, 100_000),
      matches: integer(value.matches, 0, 100_000, 0),
      tier: cleanText(value.tier, 40),
      label: cleanText(value.label, 40),
      endsAt: Number(value.endsAt || 0),
      activeUntil: Number(value.activeUntil || 0),
      awardedAt: Number(value.awardedAt || 0),
    };
  });
  const tierPriority = (tier) => (
    tier === "monthly_champion" ? 90
      : tier === "monthly_top3" ? 80
        : tier === "monthly_top10" ? 70
          : tier === "weekly_champion" ? 60
            : tier === "weekly_top3" ? 50
              : tier === "weekly_top10" ? 40
                : tier === "daily_champion" ? 30
                  : tier === "daily_top3" ? 20
                    : 10
  );
  const activeAward = awards
    .filter((award) => award.activeUntil > timestamp)
    .sort((first, second) => tierPriority(second.tier) - tierPriority(first.tier) || second.awardedAt - first.awardedAt)[0];
  await serverRankingProfileRef(uid).set({
    rankingAwardTier: activeAward?.tier || null,
    rankingAwardLabel: activeAward?.label || null,
    rankingAwardUntil: activeAward?.activeUntil || 0,
    updatedAt: timestamp,
  }, { merge: true });
  return awards;
}

async function removeServerRankingPublicEntries(uid, timestamp = Date.now()) {
  const activeInfos = activeServerRankingPeriodInfos(timestamp);
  const activeRefs = activeInfos
    .map(({ period, key }) => serverRankingEntryRef(uid, period, key));
  const activeSnapshots = activeRefs.length ? await firestore.getAll(...activeRefs) : [];
  const batch = firestore.batch();
  let withdrawalCount = 0;
  activeSnapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const withdrawal = {
      withdrawnAt: timestamp,
      updatedAt: timestamp,
    };
    batch.set(snapshot.ref, withdrawal, { merge: true });
    batch.set(
      serverRankingPeriodEntryRef(uid, activeInfos[index].period, activeInfos[index].key),
      withdrawal,
      { merge: true },
    );
    withdrawalCount += 1;
  });
  if (withdrawalCount) await batch.commit();

  const indexSnapshot = await realtime.ref(`online/serverLeaderboardPeriodEntriesByUser/${uid}`).get();
  const index = objectValue(indexSnapshot.val());
  const updates = {};
  for (const [period, keys] of Object.entries(index)) {
    if (!SERVER_RANKING_PERIODS.includes(period)) continue;
    for (const [key, entryId] of Object.entries(objectValue(keys))) {
      if (!isServerRankingPeriod(period, key)) continue;
      const cleanEntryId = cleanText(entryId, 40);
      if (!cleanEntryId) continue;
      const entryEndsAt = Number(periodEndsAt(period, key) || 0);
      if (entryEndsAt <= timestamp) continue;
      updates[`online/serverLeaderboardPeriods/${period}/${key}/${cleanEntryId}`] = null;
      updates[`online/serverLeaderboardPeriodEntriesByUser/${uid}/${period}/${key}`] = null;
    }
  }
  if (Object.keys(updates).length) await realtime.ref().update(updates);
}

async function setServerRankingParticipation(uid, data) {
  const enabled = data?.enabled === true;
  const now = Date.now();
  const profileRef = serverRankingProfileRef(uid);
  if (!enabled) {
    const awards = await finalizeServerRankingAwards(uid, now);
    await profileRef.set({
      enabled: false,
      disabledAt: now,
      updatedAt: now,
    }, { merge: true });
    await removeServerRankingPublicEntries(uid, now);
    return { enabled: false, awards };
  }

  const entryId = cleanText(data?.entryId, 40);
  if (!/^[-0-9A-Z_a-z]{16,40}$/.test(entryId)) {
    throw new HttpsError("invalid-argument", "ランキングIDを確認できませんでした。");
  }
  const [entryIndexSnapshot, ownerSnapshot, publicSnapshot, achievementSnapshot] = await Promise.all([
    realtime.ref(`online/leaderboardEntriesByUser/${uid}`).get(),
    realtime.ref(`online/leaderboardOwners/${entryId}`).get(),
    realtime.ref(`online/leaderboard/${entryId}`).get(),
    achievementProfileRef(uid).get(),
  ]);
  if (String(entryIndexSnapshot.val() || "") !== entryId
    || String(ownerSnapshot.val() || "") !== uid
    || !publicSnapshot.exists()) {
    throw new HttpsError("failed-precondition", "公開ランキング情報を確認できませんでした。");
  }
  const publicValue = objectValue(publicSnapshot.val());
  const showcase = effectiveShowcase(normalizeAchievementProfile(achievementSnapshot.data()));
  let savedProfile = null;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(profileRef);
    const previous = normalizeServerRankingProfile(snapshot.data(), {
      entryId,
      name: publicValue.name,
      rating: publicValue.rating,
      enabledAt: now,
    });
    savedProfile = {
      ...previous,
      enabled: true,
      entryId,
      name: cleanName(publicValue.name),
      commentsEnabled: publicValue.commentsEnabled !== false,
      enabledAt: previous.enabled ? previous.enabledAt : now,
      updatedAt: now,
      ...(showcase.length ? { achievementShowcase: showcase.join(",") } : {}),
    };
    if (!snapshot.exists) {
      savedProfile.rating = integer(publicValue.rating, 100, 3000, 1000);
      savedProfile.legacyRating = savedProfile.rating;
      savedProfile.serverMatches = 0;
    }
    const xHandle = cleanText(publicValue.xHandle, 15);
    if (xHandle && /^[A-Za-z0-9_]{1,15}$/.test(xHandle)) savedProfile.xHandle = xHandle;
    else delete savedProfile.xHandle;
    transaction.set(profileRef, savedProfile);
  });
  const awards = await finalizeServerRankingAwards(uid, now);
  const finalizedProfile = normalizeServerRankingProfile((await profileRef.get()).data(), savedProfile);
  await syncCurrentServerRankingMetadata(uid, finalizedProfile);
  return {
    enabled: true,
    rating: finalizedProfile.rating,
    serverMatches: finalizedProfile.serverMatches,
    awards,
  };
}

async function getServerRankingAwards(uid) {
  const awards = await finalizeServerRankingAwards(uid);
  const profileSnapshot = await serverRankingProfileRef(uid).get();
  if (profileSnapshot.exists) {
    await syncCurrentServerRankingMetadata(uid, profileSnapshot.data());
  }
  return {
    awards,
  };
}

async function getAchievements(uid, { syncPublic = false } = {}) {
  const state = await ensureAchievementState(uid);
  if (syncPublic) await syncAchievementPublicSurfaces(uid, state.profile);
  return publicAchievementProfile(state.profile, state.progress.achievementStats, state.marketStats);
}

async function acknowledgeAchievements(uid, idsValue) {
  const ids = sanitizeAchievementIds(idsValue, { maximum: 100 });
  if (!ids.length) return { acknowledged: [] };
  const profileRef = achievementProfileRef(uid);
  const acknowledged = [];
  await firestore.runTransaction(async (transaction) => {
    acknowledged.length = 0;
    const snapshot = await transaction.get(profileRef);
    if (!snapshot.exists) return;
    const profile = normalizeAchievementProfile(snapshot.data());
    ids.forEach((id) => {
      if (!profile.pendingUnlocks[id]) return;
      delete profile.pendingUnlocks[id];
      acknowledged.push(id);
    });
    if (acknowledged.length) {
      profile.updatedAt = Date.now();
      transaction.set(profileRef, profile);
    }
  });
  return { acknowledged };
}

async function setAchievementShowcase(uid, idsValue) {
  if (!Array.isArray(idsValue) || idsValue.length > 3) {
    throw new HttpsError("invalid-argument", "ショーケースには解除済みの実績を3件まで指定してください。");
  }
  const rawIds = idsValue.map((id) => String(id || ""));
  const requestedIds = sanitizeAchievementIds(rawIds);
  if (requestedIds.length !== rawIds.length) {
    throw new HttpsError("invalid-argument", "ショーケースの実績IDが正しくありません。");
  }
  const profileRef = achievementProfileRef(uid);
  const progressRef = economyProgressRef(uid);
  const statsRef = marketStatsRef(uid);
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const [profileSnapshot, progressSnapshot, marketSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(progressRef),
      transaction.get(statsRef),
    ]);
    const progress = normalizeEconomyProgress(progressSnapshot.data());
    const marketStats = normalizeMarketStats(marketSnapshot.data());
    const profile = normalizeAchievementProfile(profileSnapshot.data());
    const customShowcase = sanitizeAchievementIds(requestedIds, { unlocked: profile.unlocked });
    if (customShowcase.length !== requestedIds.length) {
      throw new HttpsError("failed-precondition", "未解除の実績はショーケースへ設定できません。");
    }
    profile.customShowcase = customShowcase;
    profile.updatedAt = Date.now();
    transaction.set(profileRef, profile);
    result = { profile, progress, marketStats };
  });
  await syncAchievementPublicSurfaces(uid, result.profile);
  return {
    saved: true,
    achievements: publicAchievementProfile(result.profile, result.progress.achievementStats, result.marketStats),
  };
}

function periodReward(period, record) {
  const points = Math.max(0, Number(record?.points || 0));
  const matches = Math.max(0, Number(record?.matches || 0));
  if (period === "daily") return points >= 6 ? 30 : points >= 3 ? 20 : 10;
  if (period === "weekly") return matches < 3 ? 0 : points >= 12 ? 180 : points >= 6 ? 100 : 50;
  if (period === "monthly") return matches < 5 ? 0 : points >= 30 ? 500 : points >= 12 ? 300 : 150;
  return 0;
}

async function autoEquipProduct(uid, product) {
  const equippedRef = realtime.ref(`online/economy/${uid}/equipped`);
  await equippedRef.transaction((current) => {
    const equipped = objectValue(current);
    if (product.type === "reaction") {
      const reactions = objectValue(equipped.reactions);
      if (Object.keys(reactions).filter((id) => reactions[id] === true).length < 8) {
        equipped.reactions = { ...reactions, [product.id]: true };
      }
    } else if (product.type === "stamp") {
      const stamps = objectValue(equipped.stamps);
      if (Object.keys(stamps).filter((id) => stamps[id] === true).length < 6) {
        equipped.stamps = { ...stamps, [product.id]: true };
      }
    } else if (product.type === "title") {
      equipped.title = product.id;
    } else if (product.type === "chatFrame") {
      equipped.chatFrame = product.id;
    } else if (product.type === "chatBackground") {
      equipped.chatBackground = product.id;
    }
    return equipped;
  });
}

async function readPatronage(uid, seasonKey = periodKey("monthly")) {
  const snapshot = await patronageRef(uid).get();
  return normalizePatronage(snapshot.data(), seasonKey);
}

async function mirrorPatronage(uid, patronageValue) {
  const seasonKey = periodKey("monthly");
  const patronage = normalizePatronage(patronageValue, seasonKey);
  await realtime.ref(`online/economy/${uid}/patron`).set({
    ...publicPatronage(patronage, seasonKey),
    lifetimeSpent: patronage.lifetimeSpent,
    updatedAt: Number(patronage.updatedAt || Date.now()),
  });
}

function hasGoogleIdentity(request) {
  const identities = request.auth?.token?.firebase?.identities;
  return Array.isArray(identities?.["google.com"]) && identities["google.com"].length > 0;
}

async function hasLiveGoogleIdentity(uid) {
  const userRecord = await adminAuth.getUser(uid);
  return !userRecord.disabled
    && userRecord.providerData.some((provider) => provider.providerId === "google.com");
}

async function upgradePatronage(uid, request, data) {
  if (!hasGoogleIdentity(request) || !await hasLiveGoogleIdentity(uid)) {
    throw new HttpsError(
      "failed-precondition",
      "高額ポイントを使う前に、Googleでゲームデータを保護してください。",
    );
  }
  const targetTier = Number(data?.targetTier);
  const actionId = cleanText(data?.actionId, 80);
  if (!Number.isSafeInteger(targetTier)
      || targetTier < 1
      || targetTier > PATRON_TIERS.at(-1).level
      || !/^[A-Za-z0-9_-]{16,80}$/.test(actionId)) {
    throw new HttpsError("invalid-argument", "パトロン昇格操作が正しくありません。");
  }
  if (await accountHasActiveSession(uid)) {
    throw new HttpsError("failed-precondition", "対戦・待機・市場取引を終了してからパトロンへ昇格してください。");
  }

  await ensureWallet(uid);
  const now = Date.now();
  const seasonKey = periodKey("monthly", now);
  const wallet = walletRef(uid);
  const patronRef = patronageRef(uid);
  const ledgerRef = patronageLedgerRef(uid, actionId);
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const [walletSnapshot, patronSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(wallet),
      transaction.get(patronRef),
      transaction.get(ledgerRef),
    ]);
    const current = normalizePatronage(patronSnapshot.data(), seasonKey);
    const before = safeBalance(walletSnapshot.get("balance"));
    if (ledgerSnapshot.exists) {
      const saved = ledgerSnapshot.data();
      if (saved.uid !== uid
          || saved.actionId !== actionId
          || saved.seasonKey !== seasonKey
          || Number(saved.targetTier) !== targetTier) {
        throw new HttpsError("permission-denied", "パトロン操作IDの内容が一致しません。");
      }
      result = {
        outcome: "upgraded",
        balance: before,
        debited: integer(saved.debited, 0, MAX_POINTS, 0),
        patron: current,
        repeated: true,
      };
      return;
    }

    const upgrade = patronUpgrade(current, targetTier, seasonKey);
    if (upgrade.outcome === "owned") {
      result = { outcome: "owned", balance: before, debited: 0, patron: current };
      return;
    }
    if (upgrade.outcome !== "upgrade" || upgrade.cost <= 0) {
      throw new HttpsError("invalid-argument", "パトロンランクを確認できませんでした。");
    }
    if (before < upgrade.cost) {
      result = {
        outcome: "short",
        balance: before,
        required: upgrade.cost,
        debited: 0,
        patron: current,
      };
      return;
    }

    const after = before - upgrade.cost;
    const patron = normalizePatronage({
      seasonKey,
      seasonSpent: upgrade.target.threshold,
      lifetimeSpent: current.lifetimeSpent + upgrade.cost,
      updatedAt: now,
    }, seasonKey);
    transaction.update(wallet, { balance: after, updatedAt: now });
    transaction.set(patronRef, patron);
    transaction.create(ledgerRef, {
      uid,
      actionId,
      seasonKey,
      targetTier: upgrade.target.level,
      debited: upgrade.cost,
      balance: after,
      patron,
      createdAt: now,
    });
    result = {
      outcome: "upgraded",
      balance: after,
      debited: upgrade.cost,
      patron,
      repeated: false,
    };
  });

  await bestEffort("upgradePatronage", [
    mirrorWallet(uid, result.balance),
    mirrorPatronage(uid, result.patron),
  ]);
  return result;
}

async function initializeEconomy(uid) {
  const [balance, achievementState, patron] = await Promise.all([
    ensureWallet(uid),
    ensureAchievementState(uid),
    readPatronage(uid),
  ]);
  const { progress, profile, marketStats } = achievementState;
  await Promise.all([
    mirrorWallet(uid, balance),
    mirrorEconomyProgress(uid, progress),
    mirrorPatronage(uid, patron),
  ]);
  return {
    outcome: "ready",
    balance,
    daily: progress.daily,
    periodRewards: progress.periodRewards,
    achievements: publicAchievementProfile(profile, progress.achievementStats, marketStats),
    patron: {
      ...publicPatronage(patron, periodKey("monthly")),
      lifetimeSpent: patron.lifetimeSpent,
    },
    marketPolicy: {
      successFeeBasisPoints: MARKET_SUCCESS_FEE_BASIS_POINTS,
      minimumSuccessFee: 1,
      postMatchTipAmounts: [...POST_MATCH_TIP_AMOUNTS],
    },
  };
}

async function claimDaily(uid, missionId) {
  const mission = DAILY_MISSIONS[missionId];
  if (!mission) throw new HttpsError("invalid-argument", "存在しないミッションです。");
  const dateKey = jstDateKey();
  if (mission.endsAfter && dateKey >= mission.endsAfter) {
    throw new HttpsError("failed-precondition", "このミッションの実施期間は終了しました。");
  }
  await Promise.all([ensureWallet(uid), ensureEconomyProgress(uid)]);
  const wallet = walletRef(uid);
  const progressRef = economyProgressRef(uid);
  const claim = firestore.collection("economyClaims").doc(uid).collection("daily").doc(eventId(`${dateKey}:${missionId}`));
  let result = null;
  let progressResult = null;
  await firestore.runTransaction(async (transaction) => {
    if (jstDateKey() !== dateKey) {
      throw new HttpsError("aborted", "日付が切り替わりました。もう一度お試しください。");
    }
    const [walletSnapshot, progressSnapshot, claimSnapshot] = await Promise.all([
      transaction.get(wallet),
      transaction.get(progressRef),
      transaction.get(claim),
    ]);
    const before = safeBalance(walletSnapshot.get("balance"));
    const progress = normalizeEconomyProgress(progressSnapshot.data(), dateKey);
    const daily = progress.daily;
    if (claimSnapshot.exists) {
      result = { outcome: "claimed", balance: before, credited: 0 };
      daily.claimed[missionId] = true;
      progress.updatedAt = Date.now();
      transaction.set(progressRef, progress);
      progressResult = progress;
      return;
    }
    if (Number(daily[mission.progressKey] || 0) < mission.target) {
      result = { outcome: "incomplete", balance: before, credited: 0 };
      progress.updatedAt = Date.now();
      transaction.set(progressRef, progress);
      progressResult = progress;
      return;
    }
    const reservedIncoming = integer(walletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0);
    const credited = Math.min(mission.reward, Math.max(0, MAX_POINTS - reservedIncoming - before));
    const after = before + credited;
    transaction.update(wallet, { balance: after, updatedAt: Date.now() });
    transaction.create(claim, { dateKey, missionId, reward: mission.reward, credited, createdAt: Date.now() });
    daily.claimed[missionId] = true;
    progress.updatedAt = Date.now();
    transaction.set(progressRef, progress);
    progressResult = progress;
    result = { outcome: "claimed-now", balance: after, credited };
  });
  await bestEffort("claimDaily", [
    mirrorWallet(uid, result.balance),
    mirrorEconomyProgress(uid, progressResult),
  ]);
  return { ...result, daily: progressResult.daily };
}

async function purchaseProduct(uid, productId) {
  const product = PRODUCT_CATALOG[productId];
  if (!product) throw new HttpsError("invalid-argument", "存在しない商品です。");
  const economy = await readLegacyEconomy(uid);
  const alreadyOwned = economy.inventory?.[productId] === true;
  await ensureWallet(uid, economy);
  const wallet = walletRef(uid);
  const purchase = firestore.collection("economyPurchases").doc(uid).collection("items").doc(productId);
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const [walletSnapshot, purchaseSnapshot] = await Promise.all([
      transaction.get(wallet),
      transaction.get(purchase),
    ]);
    const before = safeBalance(walletSnapshot.get("balance"));
    if (purchaseSnapshot.exists || alreadyOwned) {
      if (!purchaseSnapshot.exists) {
        transaction.create(purchase, { productId, price: 0, migrated: true, createdAt: Date.now() });
      }
      result = { outcome: "owned", balance: before, price: 0 };
      return;
    }
    if (before < product.price) {
      result = { outcome: "short", balance: before, price: product.price };
      return;
    }
    const after = before - product.price;
    transaction.update(wallet, { balance: after, updatedAt: Date.now() });
    transaction.create(purchase, { productId, price: product.price, createdAt: Date.now() });
    result = { outcome: "purchased", balance: after, price: product.price };
  });
  if (result.outcome === "purchased" || result.outcome === "owned") {
    const updates = {
      points: result.balance,
      [`inventory/${productId}`]: true,
      updatedAt: Date.now(),
    };
    await realtime.ref(`online/economy/${uid}`).update(updates);
    await autoEquipProduct(uid, product);
  } else {
    await mirrorWallet(uid, result.balance);
  }
  return result;
}

async function claimPeriods(uid) {
  const now = Date.now();
  const balance = await ensureWallet(uid);
  const canonical = await ensureEconomyProgress(uid);
  const pending = [];
  for (const period of ["daily", "weekly", "monthly"]) {
    for (const [key, record] of Object.entries(canonical.periodRewards?.[period] || {})) {
      const reward = periodReward(period, record);
      if (record?.claimed !== true && Number(record?.matches || 0) > 0
        && Number(record?.verifiedMatches || 0) === Number(record?.matches || 0)
        && Number(record?.endsAt || 0) <= now && reward > 0) {
        pending.push({ period, key, record, reward });
      }
    }
  }
  pending.sort((a, b) => Number(a.record.endsAt || 0) - Number(b.record.endsAt || 0));
  const batch = pending.slice(0, 50);
  if (!batch.length) {
    await bestEffort("claimPeriods", [mirrorEconomyProgress(uid, canonical)]);
    return { outcome: "empty", balance, credited: 0, claimedCount: 0, remaining: 0 };
  }
  const wallet = walletRef(uid);
  const progressRef = economyProgressRef(uid);
  const refs = batch.map((entry) => firestore.collection("economyClaims").doc(uid).collection("periods").doc(eventId(`${entry.period}:${entry.key}`)));
  let result = null;
  let progressResult = null;
  await firestore.runTransaction(async (transaction) => {
    const [walletSnapshot, progressSnapshot] = await Promise.all([
      transaction.get(wallet),
      transaction.get(progressRef),
    ]);
    const claimSnapshots = [];
    for (const ref of refs) claimSnapshots.push(await transaction.get(ref));
    const progress = normalizeEconomyProgress(progressSnapshot.data());
    const available = batch.filter((entry, index) => {
      const current = progress.periodRewards?.[entry.period]?.[entry.key];
      return !claimSnapshots[index].exists && current?.claimed !== true
        && Number(current?.endsAt || 0) <= now
        && Number(current?.verifiedMatches || 0) === Number(current?.matches || 0)
        && periodReward(entry.period, current) === entry.reward;
    });
    const nominal = available.reduce((sum, entry) => sum + entry.reward, 0);
    const before = safeBalance(walletSnapshot.get("balance"));
    const reservedIncoming = integer(walletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0);
    const credited = Math.min(nominal, Math.max(0, MAX_POINTS - reservedIncoming - before));
    const after = before + credited;
    if (available.length) transaction.update(wallet, { balance: after, updatedAt: now });
    available.forEach((entry) => {
      const index = batch.indexOf(entry);
      transaction.create(refs[index], { period: entry.period, key: entry.key, reward: entry.reward, createdAt: now });
      const record = progress.periodRewards[entry.period][entry.key];
      record.claimed = true;
      record.reward = entry.reward;
      record.claimedAt = now;
      record.updatedAt = now;
    });
    progress.updatedAt = now;
    transaction.set(progressRef, progress);
    progressResult = progress;
    result = {
      outcome: available.length ? "claimed" : "empty",
      balance: after,
      credited,
      claimedCount: available.length,
      nominal,
      remaining: Math.max(0, pending.length - batch.length),
    };
  });
  await bestEffort("claimPeriods", [
    mirrorWallet(uid, result.balance),
    mirrorEconomyProgress(uid, progressResult),
  ]);
  return result;
}

const VERIFIED_MATCH_MODES = Object.freeze({
  solo: { roomRoot: "rooms", members: 2 },
  strategy: { roomRoot: "strategyRooms", members: 2 },
  team: { roomRoot: "teamRooms", members: 4, requireAccepted: true },
  royale: { roomRoot: "royaleRooms", members: 4, requireAccepted: true },
});

function objectValue(value) {
  return value && typeof value === "object" ? value : {};
}

function verifiedMemberIds(value) {
  return Object.entries(objectValue(value))
    .filter(([, entry]) => entry === true)
    .map(([uid]) => uid)
    .sort();
}

function sameIds(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function matchParticipants(mode, room, config) {
  const members = verifiedMemberIds(room.members);
  if (members.length !== config.members) throw new HttpsError("failed-precondition", "参加人数が正しい対戦ではありません。");
  if (mode === "solo" || mode === "strategy") {
    const expected = [cleanText(room.hostUid, 128), cleanText(room.guestUid, 128)].filter(Boolean).sort();
    if (new Set(expected).size !== 2 || !sameIds(members, expected)) {
      throw new HttpsError("failed-precondition", "対戦相手の参加確認が一致しません。");
    }
  }
  const players = Object.keys(objectValue(room.players)).sort();
  if (!sameIds(members, players) || members.some((memberUid) => room.players?.[memberUid]?.uid !== memberUid)) {
    throw new HttpsError("failed-precondition", "参加者プロフィールが一致しません。");
  }
  if (config.requireAccepted && !sameIds(members, verifiedMemberIds(room.accepted))) {
    throw new HttpsError("failed-precondition", "全参加者の成立確認がない対戦です。");
  }
  return members;
}

function validatedOutcomes(mode, room, participants) {
  const claims = objectValue(room.resultClaims);
  const missing = participants.filter((participantUid) => claims[participantUid]?.outcome === undefined
    || room.finished?.[participantUid] !== true);
  if (missing.length) return { pending: true, missing: missing.length, outcomes: {} };
  const outcomes = {};
  for (const participantUid of participants) {
    const outcome = cleanText(claims[participantUid]?.outcome, 16);
    if (!["win", "loss", "draw"].includes(outcome)) {
      throw new HttpsError("failed-precondition", "参加者の試合結果が不正です。");
    }
    outcomes[participantUid] = outcome;
  }
  if (mode === "solo" || mode === "strategy") {
    const values = participants.map((participantUid) => outcomes[participantUid]).sort();
    if (values.join(",") !== "draw,draw" && values.join(",") !== "loss,win") {
      throw new HttpsError("failed-precondition", "両者の試合結果が一致しません。");
    }
  } else if (mode === "team") {
    const teams = { A: [], B: [] };
    participants.forEach((participantUid) => {
      const team = room.players?.[participantUid]?.team;
      if (!teams[team]) throw new HttpsError("failed-precondition", "チーム構成が不正です。");
      teams[team].push(participantUid);
    });
    if (teams.A.length !== 2 || teams.B.length !== 2) throw new HttpsError("failed-precondition", "チーム人数が不正です。");
    const teamOutcomes = {};
    for (const team of ["A", "B"]) {
      const values = new Set(teams[team].map((participantUid) => outcomes[participantUid]));
      if (values.size !== 1) throw new HttpsError("failed-precondition", "同じチームの試合結果が一致しません。");
      teamOutcomes[team] = [...values][0];
    }
    const pair = [teamOutcomes.A, teamOutcomes.B].sort().join(",");
    if (pair !== "draw,draw" && pair !== "loss,win") throw new HttpsError("failed-precondition", "対戦チームの試合結果が一致しません。");
  } else {
    const placements = participants.map((participantUid) => Number(claims[participantUid]?.placement));
    if (new Set(placements).size !== 4 || placements.slice().sort((a, b) => a - b).join(",") !== "1,2,3,4") {
      throw new HttpsError("failed-precondition", "順位申告が一致しません。");
    }
    participants.forEach((participantUid) => {
      const placement = Number(claims[participantUid]?.placement);
      const expected = placement === 1 ? "win" : placement === 2 ? "draw" : "loss";
      if (outcomes[participantUid] !== expected) throw new HttpsError("failed-precondition", "順位と試合結果が一致しません。");
    });
  }
  return { pending: false, missing: 0, outcomes };
}

function dailyActivityForRoom(mode, room, uid) {
  let scores = 0;
  let criticals = 0;
  for (const round of Object.values(objectValue(room.rounds))) {
    let values = [];
    if (mode === "solo") {
      values = [round?.scores?.[uid]];
    } else if (mode === "strategy") {
      values = [round?.ratings?.[uid]?.score, round?.actionRatings?.[uid]?.score];
    } else {
      values = Object.values(objectValue(round?.scores?.[uid]?.values));
    }
    values.filter((value) => Number.isInteger(Number(value))
      && Number(value) >= 1 && Number(value) <= (mode === "royale" ? 4 : 10))
      .forEach((value) => {
        scores += 1;
        if (mode !== "royale" && Number(value) >= 8) criticals += 1;
      });
  }
  return { scores: Math.min(3, scores), criticals: Math.min(1, criticals) };
}

function addVerifiedMatch(progressValue, mode, outcome, activity, now) {
  const progress = normalizeEconomyProgress(progressValue, jstDateKey(now));
  progress.daily.matches = 1;
  progress.daily[`${mode}Matches`] = 1;
  progress.daily.scores = Math.min(3, progress.daily.scores + activity.scores);
  progress.daily.criticals = Math.min(1, progress.daily.criticals + activity.criticals);
  for (const period of ["daily", "weekly", "monthly"]) {
    const key = periodKey(period, now);
    const existing = progress.periodRewards[period][key];
    if (existing?.claimed === true) continue;
    const record = existing || {
      matches: 0,
      verifiedMatches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      modeMatches: { solo: 0, strategy: 0, team: 0, royale: 0 },
      endsAt: periodEndsAt(period, key),
      claimed: false,
      reward: 0,
    };
    record.matches += 1;
    record.verifiedMatches += 1;
    record.wins += outcome === "win" ? 1 : 0;
    record.losses += outcome === "loss" ? 1 : 0;
    record.draws += outcome === "draw" ? 1 : 0;
    record.modeMatches[mode] += 1;
    record.points = (record.wins * 3) + record.draws;
    record.updatedAt = now;
    progress.periodRewards[period][key] = record;
  }
  progress.achievementStats = addBattleMatch(
    progress.achievementStats,
    mode,
    outcome,
    jstDateKey(now),
  );
  progress.updatedAt = now;
  return progress;
}

async function recordVerifiedMatch(uid, data) {
  const mode = cleanText(data?.mode, 16);
  const requestedOutcome = cleanText(data?.outcome, 16);
  const roomId = cleanText(data?.roomId, 80);
  const config = VERIFIED_MATCH_MODES[mode];
  if (!config || !["win", "loss", "draw"].includes(requestedOutcome) || !/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
    throw new HttpsError("invalid-argument", "対戦報酬の検証情報が不足しています。");
  }

  const now = Date.now();
  const roomSnapshot = await realtime.ref(`online/${config.roomRoot}/${roomId}`).get();
  const room = roomSnapshot.val();
  const createdAt = Number(room?.createdAt || 0);
  if (!roomSnapshot.exists() || room?.status !== "active" || room?.members?.[uid] !== true
    || !Number.isFinite(createdAt) || createdAt > now - 30_000 || createdAt < now - (12 * 60 * 60 * 1000)) {
    throw new HttpsError("failed-precondition", "完走済みの対戦ルームを確認できませんでした。");
  }
  const participants = matchParticipants(mode, room, config);
  const verification = validatedOutcomes(mode, room, participants);
  if (verification.pending) {
    return { outcome: "pending", missing: verification.missing };
  }
  const outcome = verification.outcomes[uid];
  if (outcome !== requestedOutcome) throw new HttpsError("failed-precondition", "申告した試合結果がルーム結果と一致しません。");
  const activities = Object.fromEntries(participants.map((participantUid) => [
    participantUid,
    dailyActivityForRoom(mode, room, participantUid),
  ]));
  if (participants.some((participantUid) => activities[participantUid].scores < 1)) {
    throw new HttpsError("failed-precondition", "全参加者が採点を完了した対戦であることを確認できませんでした。");
  }

  await Promise.all(participants.map((participantUid) => ensureAchievementState(participantUid)));
  const progressRefs = participants.map((participantUid) => economyProgressRef(participantUid));
  const profileRefs = participants.map((participantUid) => achievementProfileRef(participantUid));
  const claimRefs = participants.map((participantUid) => (
    verifiedMatchClaimRef(participantUid, mode, roomId)
  ));
  const serverPeriodInfos = activeServerRankingPeriodInfos(now);
  const serverProfileRefs = participants.map((participantUid) => serverRankingProfileRef(participantUid));
  const serverEntryRefs = participants.flatMap((participantUid) => (
    serverPeriodInfos.map(({ period, key }) => serverRankingEntryRef(participantUid, period, key))
  ));
  const serverPeriodEntryRefs = participants.flatMap((participantUid) => (
    serverPeriodInfos.map(({ period, key }) => serverRankingPeriodEntryRef(participantUid, period, key))
  ));
  const legacyServerRankingSeeds = serverPeriodInfos.length
    ? Object.fromEntries(await Promise.all(participants.map(async (participantUid) => [
      participantUid,
      await legacyServerRankingSeed(participantUid),
    ])))
    : {};
  let transactionOutcome = "recorded";
  const progressResults = {};
  const profileResults = {};
  const newlyUnlockedResults = {};
  const serverRankingProfileResults = {};
  const serverRankingEntryResults = {};
  await firestore.runTransaction(async (transaction) => {
    transactionOutcome = "recorded";
    Object.keys(progressResults).forEach((key) => delete progressResults[key]);
    Object.keys(profileResults).forEach((key) => delete profileResults[key]);
    Object.keys(newlyUnlockedResults).forEach((key) => delete newlyUnlockedResults[key]);
    Object.keys(serverRankingProfileResults).forEach((key) => delete serverRankingProfileResults[key]);
    Object.keys(serverRankingEntryResults).forEach((key) => delete serverRankingEntryResults[key]);
    const snapshots = await Promise.all([
      ...progressRefs.map((ref) => transaction.get(ref)),
      ...profileRefs.map((ref) => transaction.get(ref)),
      ...claimRefs.map((ref) => transaction.get(ref)),
      ...serverProfileRefs.map((ref) => transaction.get(ref)),
      ...serverEntryRefs.map((ref) => transaction.get(ref)),
    ]);
    const participantCount = participants.length;
    const progressSnapshots = snapshots.slice(0, participantCount);
    const profileSnapshots = snapshots.slice(participantCount, participantCount * 2);
    const claimSnapshots = snapshots.slice(participantCount * 2, participantCount * 3);
    const serverProfileSnapshots = snapshots.slice(participantCount * 3, participantCount * 4);
    const serverEntrySnapshots = snapshots.slice(participantCount * 4);
    const serverProfiles = Object.fromEntries(participants.map((participantUid, index) => [
      participantUid,
      normalizeServerRankingProfile(
        serverProfileSnapshots[index].exists
          ? serverProfileSnapshots[index].data()
          : legacyServerRankingSeeds[participantUid],
        {
          rating: room?.players?.[participantUid]?.rating,
        },
      ),
    ]));
    transactionOutcome = claimSnapshots[participants.indexOf(uid)].exists ? "duplicate" : "recorded";
    participants.forEach((participantUid, index) => {
      if (claimSnapshots[index].exists) {
        progressResults[participantUid] = normalizeEconomyProgress(progressSnapshots[index].data());
        profileResults[participantUid] = normalizeAchievementProfile(profileSnapshots[index].data());
        newlyUnlockedResults[participantUid] = sanitizeAchievementIds(
          claimSnapshots[index].get("achievementIds"),
          { maximum: 100 },
        );
        return;
      }
      const participantOutcome = verification.outcomes[participantUid];
      const participantActivity = activities[participantUid];
      const progress = addVerifiedMatch(
        progressSnapshots[index].data(),
        mode,
        participantOutcome,
        participantActivity,
        now,
      );
      const unlockResult = unlockAchievements(
        profileSnapshots[index].data(),
        eligibleAchievementIds({
          battleStats: progress.achievementStats,
          scope: "battle",
        }),
        now,
      );
      progressResults[participantUid] = progress;
      profileResults[participantUid] = unlockResult.profile;
      newlyUnlockedResults[participantUid] = unlockResult.newlyUnlocked;
      transaction.set(progressRefs[index], progress);
      transaction.set(profileRefs[index], unlockResult.profile);
      transaction.create(claimRefs[index], {
        uid: participantUid,
        mode,
        roomId,
        outcome: participantOutcome,
        participants,
        activity: participantActivity,
        achievementIds: unlockResult.newlyUnlocked,
        finalizedBy: uid,
        createdAt: now,
      });

      const serverProfile = serverProfiles[participantUid];
      if (serverProfile.enabled && serverProfile.entryId && serverPeriodInfos.length) {
        const opponentRating = serverRankingOpponentRating(
          mode,
          room,
          participantUid,
          participants,
          serverProfiles,
        );
        const updatedServerProfile = {
          ...serverProfile,
          rating: calculateServerRankingRating(serverProfile.rating, opponentRating, participantOutcome),
          serverMatches: serverProfile.serverMatches + 1,
          updatedAt: now,
        };
        serverRankingProfileResults[participantUid] = updatedServerProfile;
        serverRankingEntryResults[participantUid] = {};
        transaction.set(serverProfileRefs[index], updatedServerProfile);
        serverPeriodInfos.forEach((info, periodIndex) => {
          const flatIndex = (index * serverPeriodInfos.length) + periodIndex;
          const currentSnapshot = serverEntrySnapshots[flatIndex];
          const base = currentSnapshot.exists
            ? currentSnapshot.data()
            : emptyServerRankingEntry({
              ...info,
              entryId: updatedServerProfile.entryId,
              profile: updatedServerProfile,
              now,
            });
          const entry = addServerRankingResult(base, {
            mode,
            outcome: participantOutcome,
            profile: updatedServerProfile,
            now,
          });
          serverRankingEntryResults[participantUid][`${info.period}:${info.key}`] = entry;
          transaction.set(serverEntryRefs[flatIndex], entry);
          transaction.set(serverPeriodEntryRefs[flatIndex], entry);
        });
      }
    });
  });
  const postMatchOperations = participants.flatMap((participantUid) => [
    mirrorEconomyProgress(participantUid, progressResults[participantUid]),
    ...(newlyUnlockedResults[participantUid]?.length
      ? [syncAchievementPublicSurfaces(participantUid, profileResults[participantUid])]
      : []),
  ]);
  if (Object.keys(serverRankingEntryResults).length) {
    postMatchOperations.push(mirrorServerRankingEntries(serverRankingEntryResults));
  }
  await bestEffort("recordVerifiedMatch", postMatchOperations);
  const progressResult = progressResults[uid];
  const marketSnapshot = await marketStatsRef(uid).get();
  return {
    outcome: transactionOutcome,
    daily: progressResult.daily,
    periodRewards: progressResult.periodRewards,
    serverRanking: serverRankingProfileResults[uid]
      ? {
        rating: serverRankingProfileResults[uid].rating,
        serverMatches: serverRankingProfileResults[uid].serverMatches,
      }
      : null,
    newlyUnlocked: newlyUnlockedResults[uid] || [],
    achievements: publicAchievementProfile(
      profileResults[uid],
      progressResult.achievementStats,
      marketSnapshot.data(),
    ),
  };
}

function validatePostMatchTipRequest(uid, data) {
  const mode = cleanText(data?.mode, 16);
  const roomId = cleanText(data?.roomId, 80);
  const targetUid = cleanText(data?.targetUid, 128);
  const amount = postMatchTipAmount(data?.amount);
  if (!VERIFIED_MATCH_MODES[mode] || !/^[-0-9A-Z_a-z]{20}$/.test(roomId)
      || !targetUid || targetUid === uid || !amount) {
    throw new HttpsError("invalid-argument", "差し入れの対戦・相手・ポイントを確認してください。");
  }
  return {
    mode,
    roomId,
    targetUid,
    amount,
    actionId: cleanText(data?.actionId, 80),
  };
}

async function loadVerifiedTipMatch(uid, requestData) {
  const request = validatePostMatchTipRequest(uid, requestData);
  const config = VERIFIED_MATCH_MODES[request.mode];
  const now = Date.now();
  const roomSnapshot = await realtime.ref(`online/${config.roomRoot}/${request.roomId}`).get();
  const room = roomSnapshot.val();
  const createdAt = Number(room?.createdAt || 0);
  if (!roomSnapshot.exists() || room?.status !== "active" || room?.members?.[uid] !== true
      || !Number.isFinite(createdAt) || createdAt > now - 30_000 || createdAt < now - (12 * 60 * 60 * 1000)) {
    throw new HttpsError("failed-precondition", "差し入れ可能な完走済み対戦を確認できませんでした。");
  }
  const participants = matchParticipants(request.mode, room, config);
  if (!participants.includes(request.targetUid)) {
    throw new HttpsError("permission-denied", "この対戦の参加者以外には差し入れできません。");
  }
  const verification = validatedOutcomes(request.mode, room, participants);
  if (verification.pending) {
    throw new HttpsError("failed-precondition", "参加者全員の対戦結果が確定していません。");
  }
  return { ...request, room, participants };
}

async function getPostMatchTip(uid, data) {
  const mode = cleanText(data?.mode, 16);
  const roomId = cleanText(data?.roomId, 80);
  if (!VERIFIED_MATCH_MODES[mode] || !/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
    throw new HttpsError("invalid-argument", "差し入れ履歴の対戦情報を確認してください。");
  }
  const [snapshot, claimSnapshot] = await Promise.all([
    postMatchTipRef(uid, mode, roomId).get(),
    verifiedMatchClaimRef(uid, mode, roomId).get(),
  ]);
  const eligible = claimSnapshot.exists
    && claimSnapshot.get("uid") === uid
    && claimSnapshot.get("mode") === mode
    && claimSnapshot.get("roomId") === roomId
    && Array.isArray(claimSnapshot.get("participants"))
    && claimSnapshot.get("participants").includes(uid)
    && claimSnapshot.get("participants").length >= 2;
  if (!snapshot.exists || snapshot.get("senderUid") !== uid) return { sent: false, eligible };
  return {
    sent: true,
    eligible,
    amount: postMatchTipAmount(snapshot.get("amount")),
    recipientName: cleanName(snapshot.get("recipientName")),
    createdAt: Number(snapshot.get("createdAt") || 0),
  };
}

async function sendPostMatchTip(uid, data) {
  const verified = await loadVerifiedTipMatch(uid, data);
  await Promise.all([
    ensureWallet(uid),
    ensureWallet(verified.targetUid),
  ]);
  const senderWalletRef = walletRef(uid);
  const recipientWalletRef = walletRef(verified.targetUid);
  const senderClaimRef = verifiedMatchClaimRef(uid, verified.mode, verified.roomId);
  const recipientClaimRef = verifiedMatchClaimRef(verified.targetUid, verified.mode, verified.roomId);
  const tipRef = postMatchTipRef(uid, verified.mode, verified.roomId);
  const senderName = cleanName(verified.room.players?.[uid]?.name);
  const recipientName = cleanName(verified.room.players?.[verified.targetUid]?.name);
  let result = null;

  await firestore.runTransaction(async (transaction) => {
    result = null;
    const [
      senderWalletSnapshot,
      recipientWalletSnapshot,
      senderClaimSnapshot,
      recipientClaimSnapshot,
      tipSnapshot,
    ] = await Promise.all([
      transaction.get(senderWalletRef),
      transaction.get(recipientWalletRef),
      transaction.get(senderClaimRef),
      transaction.get(recipientClaimRef),
      transaction.get(tipRef),
    ]);
    const senderWallet = walletData(senderWalletSnapshot);
    const recipientWallet = walletData(recipientWalletSnapshot);
    if (!senderClaimSnapshot.exists || !recipientClaimSnapshot.exists
        || senderClaimSnapshot.get("uid") !== uid
        || recipientClaimSnapshot.get("uid") !== verified.targetUid
        || senderClaimSnapshot.get("mode") !== verified.mode
        || recipientClaimSnapshot.get("mode") !== verified.mode
        || senderClaimSnapshot.get("roomId") !== verified.roomId
        || recipientClaimSnapshot.get("roomId") !== verified.roomId) {
      throw new HttpsError("failed-precondition", "検証済みの対戦記録が確定していません。");
    }
    if (tipSnapshot.exists) {
      if (tipSnapshot.get("senderUid") !== uid) {
        throw new HttpsError("permission-denied", "差し入れ履歴の所有者が一致しません。");
      }
      result = {
        outcome: "duplicate",
        balance: senderWallet.balance,
        recipientBalance: recipientWallet.balance,
        amount: postMatchTipAmount(tipSnapshot.get("amount")),
        recipientName: cleanName(tipSnapshot.get("recipientName")),
      };
      return;
    }

    const amount = transferPoints(senderWallet, recipientWallet, verified.amount);
    const now = Date.now();
    transaction.set(senderWalletRef, { ...senderWallet, updatedAt: now }, { merge: true });
    transaction.set(recipientWalletRef, { ...recipientWallet, updatedAt: now }, { merge: true });
    transaction.create(tipRef, {
      schemaVersion: 1,
      senderUid: uid,
      recipientUid: verified.targetUid,
      senderName,
      recipientName,
      mode: verified.mode,
      roomId: verified.roomId,
      amount,
      actionId: verified.actionId,
      createdAt: now,
    });
    result = {
      outcome: "sent",
      balance: senderWallet.balance,
      recipientBalance: recipientWallet.balance,
      amount,
      recipientName,
    };
  });

  await bestEffort("sendPostMatchTip", [
    mirrorWallet(uid, result.balance),
    mirrorWallet(verified.targetUid, result.recipientBalance),
  ]);
  return {
    outcome: result.outcome,
    balance: result.balance,
    amount: result.amount,
    recipientName: result.recipientName,
  };
}

exports.economyAction = onCall(callableOptions("economyAction"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 32);
  try {
    if (action === "initialize") return await initializeEconomy(uid);
    if (action === "claim_daily") return await claimDaily(uid, cleanText(request.data?.missionId, 40));
    if (action === "purchase") return await purchaseProduct(uid, cleanText(request.data?.productId, 80));
    if (action === "claim_periods") return await claimPeriods(uid);
    if (action === "patron_upgrade") return await upgradePatronage(uid, request, request.data);
    if (action === "record_match") return await recordVerifiedMatch(uid, request.data);
    if (action === "set_server_ranking_participation") return await setServerRankingParticipation(uid, request.data);
    if (action === "get_server_ranking_awards") return await getServerRankingAwards(uid);
    if (action === "get_match_tip") return await getPostMatchTip(uid, request.data);
    if (action === "send_match_tip") return await sendPostMatchTip(uid, request.data);
    if (action === "get_achievements") return await getAchievements(uid, { syncPublic: request.data?.syncPublic === true });
    if (action === "ack_achievements") return await acknowledgeAchievements(uid, request.data?.achievementIds);
    if (action === "set_achievement_showcase") return await setAchievementShowcase(uid, request.data?.achievementIds);
    if (action === "sync_achievement_showcase") {
      return { synced: true, achievements: await getAchievements(uid, { syncPublic: true }) };
    }
    throw new HttpsError("invalid-argument", "未対応のポイント操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("economyAction failed", { uid, action, error });
    throw new HttpsError("internal", "ポイント処理を完了できませんでした。");
  }
});

async function marketSessionIsFresh(uid, activeSnapshot, now = Date.now()) {
  if (!activeSnapshot.exists) return false;
  const roomId = cleanText(activeSnapshot.get("roomId"), 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(roomId)) return false;
  const roomSnapshot = await marketRoomRef(roomId).get();
  if (!roomSnapshot.exists) return false;
  const room = roomSnapshot.data();
  if (room?.participants?.[uid] !== true || isTerminalMarketState(room.status)) return false;
  if (Number(activeSnapshot.get("updatedAt") || 0) >= now - QUEUE_FRESH_MS) return true;
  const role = uid === room.sellerUid ? "seller" : uid === room.buyerUid ? "buyer" : "";
  if (!role || !marketPublicPresenceId(room.publicPresenceId)) return false;
  const publicSnapshot = await marketPublicRoomRef(room).get();
  const presence = publicSnapshot.val();
  return presence?.closed !== true
    && Number(presence?.[`${role}SeenAt`] || 0) >= now - QUEUE_FRESH_MS;
}

async function realtimeActiveSessionIsLive(uid, roomPath, activeSnapshot) {
  if (!activeSnapshot.exists()) return false;
  const activeValue = activeSnapshot.val();
  const roomId = cleanText(typeof activeValue === "string" ? activeValue : activeValue?.roomId, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(roomId)) return false;
  const roomSnapshot = await realtime.ref(`online/${roomPath}/${roomId}`).get();
  if (!roomSnapshot.exists()) return false;
  const presenceSnapshot = roomSnapshot.child(`presence/${uid}`);
  if (!presenceSnapshot.exists()) return true;
  return presenceSnapshot.child("online").val() === true;
}

async function accountHasActiveSession(uid) {
  const realtimePaths = [
    { path: "active", roomPath: "rooms" },
    { path: "queue", queue: true },
    { path: "strategyActive", roomPath: "strategyRooms" },
    { path: "strategyQueue", queue: true },
    { path: "teamActive", roomPath: "teamRooms" },
    { path: "teamQueue", queue: true },
    { path: "royaleActive", roomPath: "royaleRooms" },
    { path: "royaleQueue", queue: true },
  ];
  const now = Date.now();
  const snapshots = await Promise.all([
    ...realtimePaths.map(({ path }) => realtime.ref(`online/${path}/${uid}`).get()),
    marketActiveRef(uid).get(),
    marketQueueRef(uid).get(),
  ]);
  const realtimeSnapshots = snapshots.slice(0, realtimePaths.length);
  if (realtimeSnapshots.some((snapshot, index) => {
    if (!snapshot.exists() || !realtimePaths[index].queue) return false;
    return Number(snapshot.val()?.lastSeen || 0) >= now - QUEUE_FRESH_MS;
  })) return true;
  const activeChecks = await Promise.all(realtimePaths.map((entry, index) => (
    entry.roomPath
      ? realtimeActiveSessionIsLive(uid, entry.roomPath, realtimeSnapshots[index])
      : false
  )));
  if (activeChecks.some(Boolean)) return true;
  const marketActiveSnapshot = snapshots[realtimePaths.length];
  const marketQueueSnapshot = snapshots[realtimePaths.length + 1];
  const marketQueue = marketQueueSnapshot.data();
  if (marketQueueSnapshot.exists
      && marketQueue?.status === "waiting"
      && Number(marketQueue.lastSeen || 0) >= now - QUEUE_FRESH_MS) return true;
  return marketSessionIsFresh(uid, marketActiveSnapshot, now);
}

function economyProgressHasActivity(value) {
  const progress = normalizeEconomyProgress(value);
  const dailyKeys = ["matches", "scores", "criticals", "soloMatches", "strategyMatches", "teamMatches", "royaleMatches"];
  if (dailyKeys.some((key) => Number(progress.daily?.[key] || 0) > 0)) return true;
  for (const period of ["daily", "weekly", "monthly"]) {
    if (Object.values(progress.periodRewards?.[period] || {}).some((record) => Number(record?.matches || 0) > 0)) return true;
  }
  return Number(progress.achievementStats?.matches || 0) > 0
    || Number(progress.achievementStats?.totalMatches || 0) > 0;
}

function hasMeaningfulEquippedValue(value) {
  if (value === true) return true;
  if (typeof value === "string") return value.length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasMeaningfulEquippedValue);
}

function realtimeEconomyHasActivity(value) {
  const economy = objectValue(value);
  if (safeBalance(economy.points) > 0) return true;
  if (economyProgressHasActivity({
    daily: economy.daily,
    periodRewards: economy.periodRewards,
  })) return true;
  if (Object.values(objectValue(economy.inventory)).some((owned) => owned === true)) return true;
  if (hasMeaningfulEquippedValue(economy.equipped)) return true;
  return Number(economy.patron?.seasonSpent || 0) > 0
    || Number(economy.patron?.lifetimeSpent || 0) > 0;
}

async function transferTargetIsPristine(uid, request) {
  if (request.auth?.token?.firebase?.sign_in_provider !== "anonymous") return false;
  const [
    userRecord,
    walletSnapshot,
    progressSnapshot,
    marketSnapshot,
    patronSnapshot,
    purchaseSnapshot,
    dailyClaimSnapshot,
    periodClaimSnapshot,
    soloProfileSnapshot,
    strategyProfileSnapshot,
    teamProfileSnapshot,
    royaleProfileSnapshot,
    economySnapshot,
    leaderboardSnapshot,
    periodLeaderboardSnapshot,
    topMessageSnapshot,
  ] = await Promise.all([
    adminAuth.getUser(uid),
    walletRef(uid).get(),
    economyProgressRef(uid).get(),
    marketStatsRef(uid).get(),
    patronageRef(uid).get(),
    firestore.collection("economyPurchases").doc(uid).collection("items").limit(1).get(),
    firestore.collection("economyClaims").doc(uid).collection("daily").limit(1).get(),
    firestore.collection("economyClaims").doc(uid).collection("periods").limit(1).get(),
    realtime.ref(`online/profiles/${uid}`).get(),
    realtime.ref(`online/strategyProfiles/${uid}`).get(),
    realtime.ref(`online/teamProfiles/${uid}`).get(),
    realtime.ref(`online/royaleProfiles/${uid}`).get(),
    realtime.ref(`online/economy/${uid}`).get(),
    realtime.ref(`online/leaderboardEntriesByUser/${uid}`).get(),
    realtime.ref(`online/leaderboardPeriodEntriesByUser/${uid}`).get(),
    realtime.ref(`online/topMessageEntriesByUser/${uid}`).get(),
  ]);
  if (userRecord.disabled || userRecord.providerData.length > 0) return false;
  if (safeBalance(walletSnapshot.get("balance")) > 0
      || integer(walletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0) > 0) return false;
  if (progressSnapshot.exists && economyProgressHasActivity(progressSnapshot.data())) return false;
  if (marketSnapshot.exists || patronSnapshot.exists
      || !purchaseSnapshot.empty || !dailyClaimSnapshot.empty || !periodClaimSnapshot.empty) return false;
  if (realtimeEconomyHasActivity(economySnapshot.val())) return false;
  return !soloProfileSnapshot.exists()
    && !strategyProfileSnapshot.exists()
    && !teamProfileSnapshot.exists()
    && !royaleProfileSnapshot.exists()
    && !leaderboardSnapshot.exists()
    && !periodLeaderboardSnapshot.exists()
    && !topMessageSnapshot.exists();
}

async function registerTransferFailure(uid) {
  const now = Date.now();
  const attemptRef = transferAttemptRef(uid);
  let state = null;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    const current = normalizeAttemptState(snapshot.data(), now);
    if (current.blockedUntil > now) {
      state = current;
      return;
    }
    state = nextAttemptState(current, { now });
    transaction.set(attemptRef, state);
  });
  return state;
}

async function createAccountTransferCode(uid) {
  const userRecord = await adminAuth.getUser(uid);
  if (userRecord.disabled) throw new HttpsError("permission-denied", "このアカウントは引き継ぎできません。");
  if (userRecord.providerData.length > 0) {
    throw new HttpsError("failed-precondition", "Google保護済みのデータはGoogleから復元してください。");
  }
  if (await accountHasActiveSession(uid)) {
    throw new HttpsError("failed-precondition", "対戦・待機・市場取引を終了してからコードを発行してください。");
  }
  const now = Date.now();
  const code = createTransferCode();
  const codeHash = hashTransferCode(code);
  const sourceRef = transferSourceRef(uid);
  const nextCodeRef = transferCodeRef(codeHash);
  const expiresAt = now + TRANSFER_CODE_TTL_MS;

  await firestore.runTransaction(async (transaction) => {
    const [sourceSnapshot, nextCodeSnapshot] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(nextCodeRef),
    ]);
    const source = sourceSnapshot.data();
    if (Number(source?.lastCreatedAt || 0) > now - TRANSFER_CREATE_COOLDOWN_MS) {
      throw new HttpsError("resource-exhausted", "引き継ぎコードの再発行は少し待ってください。");
    }
    if (nextCodeSnapshot.exists) {
      throw new HttpsError("aborted", "コードを発行できませんでした。もう一度お試しください。");
    }
    const previousCodeHash = String(source?.activeCodeHash || "");
    let previousCodeSnapshot = null;
    if (previousCodeHash && previousCodeHash !== codeHash) {
      previousCodeSnapshot = await transaction.get(transferCodeRef(previousCodeHash));
    }
    if (previousCodeSnapshot?.exists) transaction.delete(previousCodeSnapshot.ref);
    transaction.create(nextCodeRef, {
      sourceUid: uid,
      createdAt: now,
      expiresAt,
      usedAt: 0,
      deleteAt: Timestamp.fromMillis(expiresAt + (24 * 60 * 60 * 1000)),
    });
    transaction.set(sourceRef, {
      activeCodeHash: codeHash,
      lastCreatedAt: now,
      expiresAt,
      updatedAt: now,
    }, { merge: true });
  });

  return {
    outcome: "created",
    code: formatTransferCode(code),
    expiresAt,
  };
}

async function redeemAccountTransferCode(request, rawCode) {
  const targetUid = requireUid(request);
  const compactCode = normalizeTransferCode(rawCode);
  if (!compactCode) {
    const attempt = await registerTransferFailure(targetUid);
    if (attempt.blockedUntil > Date.now()) {
      throw new HttpsError("resource-exhausted", "入力回数が多すぎます。時間をおいてください。");
    }
    throw new HttpsError("invalid-argument", "引き継ぎコードを確認してください。");
  }

  const now = Date.now();
  const currentAttempt = normalizeAttemptState((await transferAttemptRef(targetUid).get()).data(), now);
  if (currentAttempt.blockedUntil > now) {
    throw new HttpsError("resource-exhausted", "入力回数が多すぎます。時間をおいてください。");
  }
  const codeHash = hashTransferCode(compactCode);
  const codeRef = transferCodeRef(codeHash);
  const preliminarySnapshot = await codeRef.get();
  const preliminaryDecision = transferCodeDecision(preliminarySnapshot.data(), targetUid, now);
  if (!["redeem", "retry"].includes(preliminaryDecision.outcome)) {
    const attempt = await registerTransferFailure(targetUid);
    if (attempt.blockedUntil > Date.now()) {
      throw new HttpsError("resource-exhausted", "入力回数が多すぎます。時間をおいてください。");
    }
    throw new HttpsError("not-found", "コードが無効、使用済み、または期限切れです。");
  }
  const sourceUser = await adminAuth.getUser(preliminaryDecision.sourceUid);
  if (sourceUser.disabled) throw new HttpsError("permission-denied", "発行元アカウントを利用できません。");
  if (sourceUser.providerData.length > 0) {
    await cancelAccountTransferCode(preliminaryDecision.sourceUid);
    throw new HttpsError("failed-precondition", "発行元データはGoogleから復元してください。");
  }
  if (!await transferTargetIsPristine(targetUid, request)) {
    throw new HttpsError(
      "failed-precondition",
      "復元先は対戦・購入履歴のない新しいゲストデータで開いてください。",
    );
  }
  if (await accountHasActiveSession(targetUid)) {
    throw new HttpsError("failed-precondition", "対戦・待機・市場取引を終了してから復元してください。");
  }
  if (await accountHasActiveSession(preliminaryDecision.sourceUid)) {
    throw new HttpsError("failed-precondition", "発行元端末の対戦・待機・市場取引を終了してください。");
  }
  const attemptRef = transferAttemptRef(targetUid);
  const redemptionId = eventId(`${targetUid}:${now}:${crypto.randomUUID()}`);
  let sourceUid = "";
  let failure = "";
  await firestore.runTransaction(async (transaction) => {
    const [
      attemptSnapshot,
      codeSnapshot,
      targetWalletSnapshot,
      targetProgressSnapshot,
      targetMarketSnapshot,
      targetPatronSnapshot,
    ] = await Promise.all([
      transaction.get(attemptRef),
      transaction.get(codeRef),
      transaction.get(walletRef(targetUid)),
      transaction.get(economyProgressRef(targetUid)),
      transaction.get(marketStatsRef(targetUid)),
      transaction.get(patronageRef(targetUid)),
    ]);
    const attempt = normalizeAttemptState(attemptSnapshot.data(), now);
    if (attempt.blockedUntil > now) {
      failure = "blocked";
      return;
    }
    const decision = transferCodeDecision(codeSnapshot.data(), targetUid, now);
    if (decision.outcome === "same-account") {
      failure = "same-account";
      return;
    }
    if (!["redeem", "retry"].includes(decision.outcome)) {
      failure = decision.outcome;
      transaction.set(attemptRef, nextAttemptState(attempt, { now }));
      return;
    }
    if (safeBalance(targetWalletSnapshot.get("balance")) > 0
        || integer(targetWalletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0) > 0) {
      failure = "target-not-empty";
      return;
    }
    if ((targetProgressSnapshot.exists && economyProgressHasActivity(targetProgressSnapshot.data()))
        || targetMarketSnapshot.exists
        || targetPatronSnapshot.exists) {
      failure = "target-not-empty";
      return;
    }

    sourceUid = decision.sourceUid;
    const sourceRef = transferSourceRef(sourceUid);
    const sourceSnapshot = await transaction.get(sourceRef);
    if (decision.outcome === "redeem") {
      transaction.update(codeRef, {
        usedAt: now,
        usedByUid: targetUid,
        retryUntil: Number(codeSnapshot.get("expiresAt") || now),
        redemptionId,
      });
    }
    transaction.set(attemptRef, nextAttemptState(attempt, { now, success: true }));
    if (sourceSnapshot.get("activeCodeHash") === codeHash) {
      transaction.set(sourceRef, {
        activeCodeHash: "",
        redeemedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
  });

  if (failure === "blocked") {
    throw new HttpsError("resource-exhausted", "入力回数が多すぎます。時間をおいてください。");
  }
  if (failure === "same-account") {
    throw new HttpsError("failed-precondition", "この端末はすでに同じゲームデータを使用しています。");
  }
  if (failure) {
    throw new HttpsError("not-found", "コードが無効、使用済み、または期限切れです。");
  }
  if (!sourceUid) throw new HttpsError("internal", "引き継ぎ先を確認できませんでした。");

  const latestSourceUser = await adminAuth.getUser(sourceUid);
  if (latestSourceUser.disabled || latestSourceUser.providerData.length > 0) {
    throw new HttpsError("failed-precondition", "発行元データはGoogleから復元してください。");
  }
  try {
    const token = await adminAuth.createCustomToken(sourceUid, {
      hariaiTransfer: true,
      hariaiTransferId: redemptionId.slice(0, 20),
    });
    return { outcome: "redeemed", token };
  } catch (error) {
    throw error;
  }
}

async function cancelAccountTransferCode(uid) {
  const sourceRef = transferSourceRef(uid);
  let canceled = false;
  await firestore.runTransaction(async (transaction) => {
    const sourceSnapshot = await transaction.get(sourceRef);
    const codeHash = String(sourceSnapshot.get("activeCodeHash") || "");
    if (!codeHash) return;
    const codeSnapshot = await transaction.get(transferCodeRef(codeHash));
    if (codeSnapshot.exists && codeSnapshot.get("sourceUid") === uid) {
      transaction.delete(codeSnapshot.ref);
    }
    transaction.set(sourceRef, {
      activeCodeHash: "",
      canceledAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
    canceled = true;
  });
  return { outcome: canceled ? "canceled" : "empty" };
}

exports.accountTransfer = onCall(callableOptions("accountTransfer"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 32);
  try {
    if (action === "create") return await createAccountTransferCode(uid);
    if (action === "redeem") return await redeemAccountTransferCode(request, request.data?.code);
    if (action === "cancel") return await cancelAccountTransferCode(uid);
    throw new HttpsError("invalid-argument", "未対応の引き継ぎ操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("accountTransfer failed", { uid, action, error });
    throw new HttpsError("internal", "アカウントの引き継ぎ処理を完了できませんでした。");
  }
});

function marketQueueRef(uid) {
  return firestore.collection("valueMarketQueues").doc(uid);
}

function marketActiveRef(uid) {
  return firestore.collection("valueMarketActive").doc(uid);
}

function marketRoomRef(roomId) {
  return firestore.collection("valueMarketRooms").doc(roomId);
}

function marketStatsRef(uid) {
  return firestore.collection("valueMarketStats").doc(uid);
}

function createMarketPublicPresenceId() {
  return crypto.randomBytes(20).toString("hex");
}

function marketPublicPresenceId(value) {
  const presenceId = String(value || "");
  return /^[a-f0-9]{40}$/.test(presenceId) ? presenceId : "";
}

function marketPublicQueueRef(presenceId) {
  const normalizedId = marketPublicPresenceId(presenceId);
  if (!normalizedId) throw new Error("Invalid market queue presence id.");
  return realtime.ref(`${MARKET_PUBLIC_PRESENCE_PATH}/queues/${normalizedId}`);
}

function marketPublicRoomRef(room) {
  const normalizedId = marketPublicPresenceId(room?.publicPresenceId);
  if (!normalizedId) throw new Error("Invalid market room presence id.");
  return realtime.ref(`${MARKET_PUBLIC_PRESENCE_PATH}/rooms/${normalizedId}`);
}

async function removeMarketQueuePublicPresence(presenceId) {
  const normalizedId = marketPublicPresenceId(presenceId);
  if (!normalizedId) return;
  await marketPublicQueueRef(normalizedId).remove();
}

async function syncMarketQueuePublicPresence(uid) {
  const [queueSnapshot, activeSnapshot] = await Promise.all([
    marketQueueRef(uid).get(),
    marketActiveRef(uid).get(),
  ]);
  const entry = queueSnapshot.data();
  const presenceId = marketPublicPresenceId(entry?.publicPresenceId);
  if (activeSnapshot.exists || !queueSnapshot.exists || entry?.status !== "waiting"
      || !["seller", "buyer"].includes(entry?.role)
      || Number(entry?.lastSeen || 0) < Date.now() - QUEUE_FRESH_MS
      || !presenceId) {
    await removeMarketQueuePublicPresence(presenceId);
    return;
  }
  await marketPublicQueueRef(presenceId).set({
    role: entry.role,
    lastSeen: Number(entry.lastSeen),
  });
}

async function cleanupStaleMarketPublicPresence(now = Date.now()) {
  const freshAfter = now - QUEUE_FRESH_MS;
  const [queuesSnapshot, roomsSnapshot] = await Promise.all([
    realtime.ref(`${MARKET_PUBLIC_PRESENCE_PATH}/queues`)
      .orderByChild("lastSeen")
      .endAt(freshAfter - 1)
      .limitToFirst(25)
      .get(),
    realtime.ref(`${MARKET_PUBLIC_PRESENCE_PATH}/rooms`)
      .orderByChild("updatedAt")
      .endAt(freshAfter - 1)
      .limitToFirst(25)
      .get(),
  ]);
  const removals = [];
  queuesSnapshot.forEach((entry) => {
    removals.push(realtime.ref(`${MARKET_PUBLIC_PRESENCE_PATH}/queues/${entry.key}`).transaction((current) => (
      Number(current?.lastSeen || 0) < freshAfter ? null : undefined
    )));
  });
  roomsSnapshot.forEach((entry) => {
    removals.push(realtime.ref(`${MARKET_PUBLIC_PRESENCE_PATH}/rooms/${entry.key}`).transaction((current) => (
      Number(current?.updatedAt || 0) < freshAfter ? null : undefined
    )));
  });
  await Promise.all(removals);
}

async function loadMarketRoomWithPublicPresenceId(roomId) {
  const roomRef = marketRoomRef(roomId);
  const snapshot = await roomRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "市場ルームが見つかりません。");
  const room = snapshot.data();
  if (marketPublicPresenceId(room?.publicPresenceId) && Number(room?.stateVersion || 0) > 0) return room;
  const generatedId = createMarketPublicPresenceId();
  return firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(roomRef);
    if (!currentSnapshot.exists) throw new HttpsError("not-found", "市場ルームが見つかりません。");
    const currentRoom = currentSnapshot.data();
    const publicPresenceId = marketPublicPresenceId(currentRoom?.publicPresenceId) || generatedId;
    const stateVersion = Math.max(1, Math.floor(Number(currentRoom?.stateVersion || 0)));
    if (!marketPublicPresenceId(currentRoom?.publicPresenceId) || Number(currentRoom?.stateVersion || 0) < 1) {
      transaction.update(roomRef, { publicPresenceId, stateVersion });
    }
    return { ...currentRoom, publicPresenceId, stateVersion };
  });
}

function normalizeQueueEntry(uid, data, balance, appCheckVerified, patronageValue = null) {
  const role = data?.role === "seller" ? "seller" : data?.role === "buyer" ? "buyer" : "";
  if (!role) throw new HttpsError("invalid-argument", "売り手または買い手を選択してください。");
  const base = {
    uid,
    role,
    name: cleanName(data?.name),
    status: "waiting",
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    publicPresenceId: createMarketPublicPresenceId(),
    appCheckVerified: appCheckVerified === true,
    patron: publicPatronage(patronageValue, periodKey("monthly")),
  };
  if (role === "seller") {
    return {
      ...base,
      listing: {
        title: cleanText(data?.listing?.title, 30, "無題の推し"),
        askingPrice: integer(data?.listing?.askingPrice, MARKET_MIN_PRICE, MARKET_MAX_PRICE, 50),
        pitchStyle: ["chat", "audio", "either"].includes(data?.listing?.pitchStyle) ? data.listing.pitchStyle : "either",
      },
    };
  }
  const affordable = Math.max(MARKET_MIN_PRICE, Math.min(MARKET_MAX_PRICE, balance - MARKET_ENTRY_FEE));
  if (balance < MARKET_ENTRY_FEE + MARKET_MIN_PRICE) {
    throw new HttpsError("failed-precondition", `買い手は着手料${MARKET_ENTRY_FEE}PTと購入用${MARKET_MIN_PRICE}PTが必要です。`);
  }
  return { ...base, maxBudget: integer(data?.maxBudget, MARKET_MIN_PRICE, affordable, affordable) };
}

function queuesCompatible(first, second) {
  if (!first || !second || first.uid === second.uid || first.role === second.role) return false;
  const seller = first.role === "seller" ? first : second;
  const buyer = first.role === "buyer" ? first : second;
  return Number(seller.listing?.askingPrice || 0) <= Number(buyer.maxBudget || 0);
}

async function touchMarketRoomPublicPresence(room, role) {
  if (!["seller", "buyer"].includes(role) || isTerminalMarketState(room.status)) return;
  const presenceId = marketPublicPresenceId(room.publicPresenceId);
  if (!presenceId) return;
  const now = Date.now();
  await marketPublicRoomRef(room).transaction((current) => {
    return nextPublicMarketRoomHeartbeat(current, room, role, now);
  });
}

async function mirrorMarketRoom(room, { seenRoles = [] } = {}) {
  const now = Date.now();
  const incomingVersion = Number(room.stateVersion || 0);
  const incomingUpdatedAt = Number(room.updatedAt || now);
  const privateRef = realtime.ref(`online/valueMarketRooms/${room.roomId}`);
  const publicRef = marketPublicPresenceId(room.publicPresenceId) ? marketPublicRoomRef(room) : null;
  await Promise.all([
    privateRef.transaction((current) => {
      if (isIncomingMarketRoomStateOlder(current, room)) return undefined;
      return {
        ...(current || {}),
        members: { [room.sellerUid]: true, [room.buyerUid]: true },
        roles: { [room.sellerUid]: "seller", [room.buyerUid]: "buyer" },
        names: { [room.sellerUid]: cleanName(room.sellerName), [room.buyerUid]: cleanName(room.buyerName) },
        status: room.status,
        turn: Number(room.turn || 1),
        stateVersion: incomingVersion,
        createdAt: Number(room.createdAt || now),
        updatedAt: incomingUpdatedAt,
      };
    }),
    publicRef?.transaction((current) => nextPublicMarketRoomState(current, room, {
      now,
      terminal: isTerminalMarketState(room.status),
    })),
  ].filter(Boolean));
  if (!isTerminalMarketState(room.status)) {
    await Promise.all(seenRoles
      .filter((role) => role === "seller" || role === "buyer")
      .map((role) => touchMarketRoomPublicPresence(room, role)));
  }
}

async function joinMarketQueue(uid, data, appCheckVerified) {
  if (MARKET_APP_CHECK_MIGRATION && appCheckVerified !== true) {
    throw new HttpsError("failed-precondition", "通信保護を確認できませんでした。ページを再読み込みしてください。");
  }
  const [balance, previousQueueSnapshot, patronage] = await Promise.all([
    ensureWallet(uid),
    marketQueueRef(uid).get(),
    readPatronage(uid),
  ]);
  const ownEntry = normalizeQueueEntry(uid, data, balance, appCheckVerified, patronage);
  const previousQueue = previousQueueSnapshot.data();
  if (previousQueueSnapshot.exists && previousQueue?.status === "waiting"
      && Number(previousQueue.lastSeen || 0) >= Date.now() - QUEUE_FRESH_MS
      && marketPublicPresenceId(previousQueue.publicPresenceId)) {
    ownEntry.publicPresenceId = previousQueue.publicPresenceId;
  }
  const oppositeRole = ownEntry.role === "seller" ? "buyer" : "seller";
  const staleQueues = await firestore.collection("valueMarketQueues")
    .where("lastSeen", "<", Date.now() - QUEUE_FRESH_MS)
    .limit(50)
    .get()
    .catch(() => null);
  if (staleQueues?.size) {
    const removedPresenceIds = await Promise.all(staleQueues.docs.map((staleSnapshot) => (
      firestore.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(staleSnapshot.ref);
        const current = currentSnapshot.data();
        if (!currentSnapshot.exists || Number(current?.lastSeen || 0) >= Date.now() - QUEUE_FRESH_MS) return "";
        transaction.delete(staleSnapshot.ref);
        return marketPublicPresenceId(current?.publicPresenceId);
      }).catch((error) => {
        console.error("stale market queue cleanup failed", { uid: staleSnapshot.id, error });
        return "";
      })
    )));
    await bestEffort("staleMarketQueues", removedPresenceIds.map(removeMarketQueuePublicPresence));
  }
  await bestEffort("staleMarketPublicPresence", [cleanupStaleMarketPublicPresence()]);
  const candidatesSnapshot = await firestore.collection("valueMarketQueues")
    .where("role", "==", oppositeRole)
    .where("lastSeen", ">=", Date.now() - QUEUE_FRESH_MS)
    .orderBy("lastSeen", "asc")
    .limit(30)
    .get();
  const candidates = candidatesSnapshot.docs
    .map((snapshot) => snapshot.data())
    .filter((entry) => entry.status === "waiting"
      && Number(entry.lastSeen || 0) >= Date.now() - QUEUE_FRESH_MS
      && (!MARKET_APP_CHECK_MIGRATION || entry.appCheckVerified === true)
      && queuesCompatible(ownEntry, entry))
    .sort((first, second) => Number(first.joinedAt || 0) - Number(second.joinedAt || 0));
  const candidate = candidates[0] || null;
  const roomRef = marketRoomRef(firestore.collection("valueMarketRooms").doc().id);
  let outcome = { status: "waiting", balance, roomId: "" };

  await firestore.runTransaction(async (transaction) => {
    const ownQueue = marketQueueRef(uid);
    const ownActive = marketActiveRef(uid);
    const ownActiveSnapshot = await transaction.get(ownActive);
    if (ownActiveSnapshot.exists) {
      outcome = { status: "matched", balance, roomId: cleanText(ownActiveSnapshot.get("roomId"), 80) };
      return;
    }
    if (!candidate) {
      transaction.set(ownQueue, ownEntry);
      outcome = { status: "waiting", balance, roomId: "" };
      return;
    }
    const candidateQueue = marketQueueRef(candidate.uid);
    const candidateActive = marketActiveRef(candidate.uid);
    const [candidateQueueSnapshot, candidateActiveSnapshot] = await Promise.all([
      transaction.get(candidateQueue),
      transaction.get(candidateActive),
    ]);
    const currentCandidate = candidateQueueSnapshot.data();
    if (candidateActiveSnapshot.exists || !currentCandidate || currentCandidate.status !== "waiting"
      || Number(currentCandidate.lastSeen || 0) < Date.now() - QUEUE_FRESH_MS
      || (MARKET_APP_CHECK_MIGRATION && currentCandidate.appCheckVerified !== true)
      || !queuesCompatible(ownEntry, currentCandidate)) {
      transaction.set(ownQueue, ownEntry);
      outcome = { status: "waiting", balance, roomId: "" };
      return;
    }
    const seller = ownEntry.role === "seller" ? ownEntry : currentCandidate;
    const buyer = ownEntry.role === "buyer" ? ownEntry : currentCandidate;
    const roomId = roomRef.id;
    const room = {
      roomId,
      participants: { [seller.uid]: true, [buyer.uid]: true },
      sellerUid: seller.uid,
      buyerUid: buyer.uid,
      sellerName: seller.name,
      buyerName: buyer.name,
      sellerPatron: publicPatronage(seller.patron, periodKey("monthly")),
      buyerPatron: publicPatronage(buyer.patron, periodKey("monthly")),
      listing: seller.listing,
      settlementQuote: marketSaleSettlement(seller.listing.askingPrice),
      buyerMaxBudget: buyer.maxBudget,
      status: "preview",
      turn: 1,
      stateVersion: 1,
      maxTurns: MARKET_MAX_TURNS,
      entryFee: MARKET_ENTRY_FEE,
      entryFeePaid: false,
      extensionFeesPaid: 0,
      appCheckVerified: seller.appCheckVerified === true && buyer.appCheckVerified === true,
      publicPresenceId: createMarketPublicPresenceId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    transaction.create(roomRef, room);
    transaction.set(ownActive, {
      roomId,
      role: ownEntry.role,
      appCheckVerified: room.appCheckVerified,
      updatedAt: Date.now(),
    });
    transaction.set(candidateActive, {
      roomId,
      role: currentCandidate.role,
      appCheckVerified: room.appCheckVerified,
      updatedAt: Date.now(),
    });
    transaction.delete(ownQueue);
    transaction.delete(candidateQueue);
    outcome = {
      status: "matched",
      balance,
      roomId,
      room,
      queuePresenceIds: [seller.publicPresenceId, buyer.publicPresenceId],
    };
  });
  if (outcome.room) {
    await bestEffort("joinMarketQueue", [
      mirrorMarketRoom(outcome.room),
      ...outcome.queuePresenceIds.map(removeMarketQueuePublicPresence),
    ]);
  } else {
    await bestEffort("joinMarketQueue", [syncMarketQueuePublicPresence(uid)]);
  }
  return { status: outcome.status, balance: outcome.balance, roomId: outcome.roomId };
}

async function cancelMarketQueue(uid) {
  const [active, queue] = await Promise.all([
    marketActiveRef(uid).get(),
    marketQueueRef(uid).get(),
  ]);
  const presenceId = marketPublicPresenceId(queue.data()?.publicPresenceId);
  if (active.exists) {
    await bestEffort("cancelMarketQueue", [removeMarketQueuePublicPresence(presenceId)]);
    return { status: "matched", roomId: cleanText(active.get("roomId"), 80) };
  }
  await marketQueueRef(uid).delete();
  await bestEffort("cancelMarketQueue", [removeMarketQueuePublicPresence(presenceId)]);
  return { status: "canceled", roomId: "" };
}

async function heartbeatMarketQueue(uid) {
  const ref = marketQueueRef(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    const active = await marketActiveRef(uid).get();
    return { status: active.exists ? "matched" : "missing", roomId: active.exists ? cleanText(active.get("roomId"), 80) : "" };
  }
  const publicPresenceId = marketPublicPresenceId(snapshot.get("publicPresenceId")) || createMarketPublicPresenceId();
  await ref.update({ lastSeen: Date.now(), publicPresenceId });
  await bestEffort("heartbeatMarketQueue", [syncMarketQueuePublicPresence(uid)]);
  return { status: "waiting", roomId: "" };
}

async function syncMarketRoom(uid, roomId, { recoverPrivate = false } = {}) {
  const room = await loadMarketRoomWithPublicPresenceId(roomId);
  if (room?.participants?.[uid] !== true) throw new HttpsError("permission-denied", "この市場ルームには参加していません。");
  const role = uid === room.sellerUid ? "seller" : uid === room.buyerUid ? "buyer" : "";
  if (recoverPrivate || isTerminalMarketState(room.status)) {
    await mirrorMarketRoom(room, { seenRoles: isTerminalMarketState(room.status) ? [] : [role] });
  } else {
    await touchMarketRoomPublicPresence(room, role);
  }
  return { status: room.status, roomId };
}

exports.valueMarketQueue = onCall(callableOptions("valueMarketQueue"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 24);
  try {
    if (MARKET_APP_CHECK_MIGRATION && ["join", "heartbeat", "heartbeat_room"].includes(action) && !request.app) {
      throw new HttpsError("failed-precondition", "通信保護を確認できませんでした。ページを再読み込みしてください。");
    }
    if (action === "join") return await joinMarketQueue(uid, request.data, Boolean(request.app));
    if (action === "cancel") return await cancelMarketQueue(uid);
    if (action === "heartbeat") return await heartbeatMarketQueue(uid);
    if (action === "sync_room") return await syncMarketRoom(uid, cleanText(request.data?.roomId, 80), { recoverPrivate: true });
    if (action === "heartbeat_room") return await syncMarketRoom(uid, cleanText(request.data?.roomId, 80));
    throw new HttpsError("invalid-argument", "未対応の市場待機操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("valueMarketQueue failed", { uid, action, error });
    throw new HttpsError("internal", "市場の待機処理を完了できませんでした。");
  }
});

function defaultStats(uid, name) {
  return {
    uid,
    name: cleanName(name),
    salesCount: 0,
    grossSales: 0,
    marketFeesPaid: 0,
    netSales: 0,
    bestSale: 0,
    laborFees: 0,
    purchases: 0,
    spent: 0,
    highestPurchase: 0,
    extensionIncome: 0,
    marketDays: 0,
    lastMarketDateKey: "",
    uniqueCounterparties: 0,
    lastRankedRole: "",
    marketRoleDay: { dateKey: "", seller: false, buyer: false },
    publicAchievements: [],
    updatedAt: Date.now(),
  };
}

function walletData(snapshot) {
  if (!snapshot.exists) throw new HttpsError("failed-precondition", "ポイント残高が初期化されていません。");
  return {
    ...snapshot.data(),
    balance: safeBalance(snapshot.get("balance")),
    reservedIncoming: integer(snapshot.get("reservedIncoming"), 0, MAX_POINTS, 0),
  };
}

function walletCreditCapacity(wallet) {
  return Math.max(0, MAX_POINTS - safeBalance(wallet.balance) - integer(wallet.reservedIncoming, 0, MAX_POINTS, 0));
}

function reserveIncoming(wallet, amount) {
  const value = integer(amount, 1, MARKET_MAX_PRICE, 1);
  if (walletCreditCapacity(wallet) < value) throw new HttpsError("failed-precondition", "受取予定分を確保できる残高上限がありません。");
  wallet.reservedIncoming += value;
  return value;
}

function releaseIncoming(wallet, amount) {
  const value = integer(amount, 1, MARKET_MAX_PRICE, 1);
  wallet.reservedIncoming = Math.max(0, integer(wallet.reservedIncoming, 0, MAX_POINTS, 0) - value);
  return value;
}

function transferPoints(from, to, amount) {
  const value = integer(amount, 1, MARKET_MAX_PRICE, 1);
  if (from.balance < value) throw new HttpsError("failed-precondition", "ポイントが不足しています。");
  if (walletCreditCapacity(to) < value) throw new HttpsError("failed-precondition", "受取側がポイント上限に達しています。");
  from.balance -= value;
  to.balance += value;
  return value;
}

function debitPoints(wallet, amount) {
  const value = integer(amount, 1, MARKET_MAX_PRICE, 1);
  if (wallet.balance < value) throw new HttpsError("failed-precondition", "ポイントが不足しています。");
  wallet.balance -= value;
  return value;
}

function creditPoints(wallet, amount) {
  const value = integer(amount, 1, MARKET_MAX_PRICE, 1);
  if (walletCreditCapacity(wallet) < value) throw new HttpsError("failed-precondition", "受取側がポイント上限に達しています。");
  wallet.balance += value;
  return value;
}

function distributeEscrow(preferredWallet, fallbackWallet, amount) {
  let remaining = Math.max(0, Math.floor(Number(amount || 0)));
  const preferredAmount = Math.min(remaining, walletCreditCapacity(preferredWallet));
  preferredWallet.balance += preferredAmount;
  remaining -= preferredAmount;
  const fallbackAmount = Math.min(remaining, walletCreditCapacity(fallbackWallet));
  fallbackWallet.balance += fallbackAmount;
  remaining -= fallbackAmount;
  return { preferredAmount, fallbackAmount, overflow: remaining };
}

function requireRoomActor(room, uid, expectedRole = "") {
  if (room?.participants?.[uid] !== true) throw new HttpsError("permission-denied", "この市場ルームには参加していません。");
  const role = uid === room.sellerUid ? "seller" : uid === room.buyerUid ? "buyer" : "";
  if (expectedRole && role !== expectedRole) throw new HttpsError("permission-denied", "この操作は担当ロールだけが実行できます。");
  return role;
}

function requireMarketState(room, ...states) {
  if (!states.includes(room.status)) throw new HttpsError("failed-precondition", "市場ルームの状態が変わりました。");
}

function isTerminalMarketState(status) {
  return ["sold", "ended", "canceled"].includes(status);
}

async function performMarketAction(uid, data, appCheckVerified) {
  const roomId = cleanText(data?.roomId, 80);
  const action = cleanText(data?.action, 32);
  const actionId = cleanText(data?.actionId, 80) || `${action}:${integer(data?.turn, 1, MARKET_MAX_TURNS, 1)}`;
  const initialRoom = await loadMarketRoomWithPublicPresenceId(roomId);
  requireRoomActor(initialRoom, uid);
  if (MARKET_APP_CHECK_MIGRATION && initialRoom.appCheckVerified === true && appCheckVerified !== true) {
    throw new HttpsError("failed-precondition", "通信保護を確認できませんでした。ページを再読み込みしてください。");
  }
  await Promise.all([
    ensureWallet(initialRoom.sellerUid),
    ensureWallet(initialRoom.buyerUid),
    ensureAchievementState(initialRoom.sellerUid),
    ensureAchievementState(initialRoom.buyerUid),
  ]);

  const roomRef = marketRoomRef(roomId);
  const sellerWalletRef = walletRef(initialRoom.sellerUid);
  const buyerWalletRef = walletRef(initialRoom.buyerUid);
  const sellerStatsRef = marketStatsRef(initialRoom.sellerUid);
  const buyerStatsRef = marketStatsRef(initialRoom.buyerUid);
  const sellerAchievementRef = achievementProfileRef(initialRoom.sellerUid);
  const buyerAchievementRef = achievementProfileRef(initialRoom.buyerUid);
  const transactionDateKey = jstDateKey();
  const pairKey = eventId(`${[initialRoom.sellerUid, initialRoom.buyerUid].sort().join(":")}:${transactionDateKey}`);
  const pairRef = firestore.collection("valueMarketRankedPairs").doc(pairKey);
  const relationshipKey = eventId([initialRoom.sellerUid, initialRoom.buyerUid].sort().join(":"));
  const relationshipRef = firestore.collection("valueMarketAchievementPairs").doc(relationshipKey);
  const certificateRef = marketCertificateRef(initialRoom.buyerUid, roomId);
  const ledgerRef = firestore.collection("valueMarketLedger").doc(eventId(`${roomId}:${uid}:${actionId}`));
  let result = null;
  const achievementResults = {};
  const newlyUnlockedResults = {};

  await firestore.runTransaction(async (transaction) => {
    result = null;
    Object.keys(achievementResults).forEach((key) => delete achievementResults[key]);
    Object.keys(newlyUnlockedResults).forEach((key) => delete newlyUnlockedResults[key]);
    const [
      roomSnapshot,
      sellerWalletSnapshot,
      buyerWalletSnapshot,
      sellerStatsSnapshot,
      buyerStatsSnapshot,
      sellerAchievementSnapshot,
      buyerAchievementSnapshot,
      pairSnapshot,
      relationshipSnapshot,
      certificateSnapshot,
      ledgerSnapshot,
    ] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(sellerWalletRef),
      transaction.get(buyerWalletRef),
      transaction.get(sellerStatsRef),
      transaction.get(buyerStatsRef),
      transaction.get(sellerAchievementRef),
      transaction.get(buyerAchievementRef),
      transaction.get(pairRef),
      transaction.get(relationshipRef),
      transaction.get(certificateRef),
      transaction.get(ledgerRef),
    ]);
    if (!roomSnapshot.exists) throw new HttpsError("not-found", "市場ルームが見つかりません。");
    const room = { ...roomSnapshot.data() };
    const role = requireRoomActor(room, uid);
    const sellerWallet = walletData(sellerWalletSnapshot);
    const buyerWallet = walletData(buyerWalletSnapshot);
    if (ledgerSnapshot.exists) {
      const ledger = ledgerSnapshot.data();
      if (ledger.actorUid !== uid || ledger.action !== action) throw new HttpsError("permission-denied", "市場操作IDが一致しません。");
      result = {
        status: room.status,
        room: { ...room, rankingCounted: room.rankingCounted ?? ledger.rankingCounted ?? null },
        sellerBalance: sellerWallet.balance,
        buyerBalance: buyerWallet.balance,
        role,
        newlyUnlocked: sanitizeAchievementIds(ledger.achievementIds, { maximum: 100 }),
      };
      return;
    }
    const sellerStats = sellerStatsSnapshot.exists ? { ...defaultStats(room.sellerUid, room.sellerName), ...sellerStatsSnapshot.data() } : defaultStats(room.sellerUid, room.sellerName);
    const buyerStats = buyerStatsSnapshot.exists ? { ...defaultStats(room.buyerUid, room.buyerName), ...buyerStatsSnapshot.data() } : defaultStats(room.buyerUid, room.buyerName);
    const sellerAchievement = normalizeAchievementProfile(sellerAchievementSnapshot.data());
    const buyerAchievement = normalizeAchievementProfile(buyerAchievementSnapshot.data());
    let transfer = null;

    if (action === "accept_pitch") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "preview");
      const amount = debitPoints(buyerWallet, room.entryFee || MARKET_ENTRY_FEE);
      reserveIncoming(sellerWallet, amount);
      reserveIncoming(buyerWallet, amount);
      room.status = "pitch";
      room.entryFeePaid = true;
      room.entryFeePaidAt = Date.now();
      room.entryFeeHeld = amount;
      room.entryFeeReserved = true;
      transfer = { fromUid: room.buyerUid, toUid: "market_escrow", amount, kind: "entry_fee_hold" };
    } else if (action === "decline_preview") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "preview");
      room.status = "ended";
      room.endReason = "preview_declined";
    } else if (action === "pitch_complete") {
      requireRoomActor(room, uid, "seller");
      requireMarketState(room, "pitch");
      const heldFee = Math.max(0, Number(room.entryFeeHeld || 0));
      if (heldFee > 0) {
        const wasReserved = room.entryFeeReserved === true;
        if (wasReserved) {
          releaseIncoming(sellerWallet, heldFee);
          releaseIncoming(buyerWallet, heldFee);
        }
        const settlement = wasReserved
          ? { preferredAmount: creditPoints(sellerWallet, heldFee), fallbackAmount: 0, overflow: 0 }
          : distributeEscrow(sellerWallet, buyerWallet, heldFee);
        sellerStats.laborFees = Number(sellerStats.laborFees || 0) + settlement.preferredAmount;
        room.entryFeeHeld = 0;
        room.entryFeeReserved = false;
        room.entryFeeSettledAt = Date.now();
        room.entryFeeRefunded = Number(room.entryFeeRefunded || 0) + settlement.fallbackAmount;
        room.escrowOverflowBurned = Number(room.escrowOverflowBurned || 0) + settlement.overflow;
        transfer = {
          fromUid: "market_escrow",
          toUid: room.sellerUid,
          amount: settlement.preferredAmount,
          refunded: settlement.fallbackAmount,
          overflow: settlement.overflow,
          kind: "entry_fee_settlement",
        };
      }
      room.status = "decision";
      room.pitchCompletedAt = Date.now();
    } else if (action === "buy") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "decision");
      const price = integer(room.listing?.askingPrice, MARKET_MIN_PRICE, MARKET_MAX_PRICE, MARKET_MIN_PRICE);
      const settlement = marketSaleSettlement(price);
      const amount = debitPoints(buyerWallet, settlement.grossAmount);
      creditPoints(sellerWallet, settlement.sellerProceeds);
      const issuedAt = Date.now();
      const certificateNumber = `OSHI-${certificateRef.id.slice(0, 16).toUpperCase()}`;
      room.status = "sold";
      room.salePrice = amount;
      room.marketFee = settlement.feeAmount;
      room.sellerProceeds = settlement.sellerProceeds;
      room.certificateNumber = certificateNumber;
      room.soldAt = issuedAt;
      room.rankingCounted = !pairSnapshot.exists;
      transfer = {
        fromUid: room.buyerUid,
        toUid: room.sellerUid,
        amount,
        feeAmount: settlement.feeAmount,
        netAmount: settlement.sellerProceeds,
        feeToUid: "market_fee_sink",
        kind: "sale",
      };
      if (certificateSnapshot.exists) {
        throw new HttpsError("already-exists", "この成約の推し値証書は発行済みです。");
      }
      transaction.create(certificateRef, {
        schemaVersion: 1,
        certificateNumber,
        buyerUid: room.buyerUid,
        sellerName: cleanName(room.sellerName),
        listingTitle: cleanText(room.listing?.title, 30, "無題の推し"),
        purchasePrice: amount,
        marketFee: settlement.feeAmount,
        sellerProceeds: settlement.sellerProceeds,
        turn: integer(room.turn, 1, MARKET_MAX_TURNS, 1),
        extended: Number(room.turn || 1) > 1 || Number(room.extensionFeesPaid || 0) > 0,
        rankingCounted: room.rankingCounted,
        nonTransferable: true,
        issuedAt,
      });
      sellerStats.marketFeesPaid = Number(sellerStats.marketFeesPaid || 0) + settlement.feeAmount;
      sellerStats.netSales = Number(sellerStats.netSales || 0) + settlement.sellerProceeds;
      if (!pairSnapshot.exists) {
        sellerStats.salesCount = Number(sellerStats.salesCount || 0) + 1;
        sellerStats.grossSales = Number(sellerStats.grossSales || 0) + amount;
        sellerStats.bestSale = Math.max(Number(sellerStats.bestSale || 0), amount);
        buyerStats.purchases = Number(buyerStats.purchases || 0) + 1;
        buyerStats.spent = Number(buyerStats.spent || 0) + amount;
        buyerStats.highestPurchase = Math.max(Number(buyerStats.highestPurchase || 0), amount);
        const dateKey = transactionDateKey;
        const sellerPreviousRole = normalizeMarketStats(sellerStats).lastRankedRole;
        const buyerPreviousRole = normalizeMarketStats(buyerStats).lastRankedRole;
        Object.assign(sellerStats, addMarketTransaction(sellerStats, "seller", dateKey, {
          newCounterparty: !relationshipSnapshot.exists,
        }));
        Object.assign(buyerStats, addMarketTransaction(buyerStats, "buyer", dateKey, {
          newCounterparty: !relationshipSnapshot.exists,
        }));
        const dealSignals = {
          firstTurn: Number(room.turn || 1) === 1,
          extended: Number(room.turn || 1) > 1 || Number(room.extensionFeesPaid || 0) > 0,
          thirdTurn: Number(room.turn || 1) >= MARKET_MAX_TURNS,
        };
        const sellerSignals = {
          ...dealSignals,
          bothRolesDay: sellerStats.marketRoleDay?.seller === true && sellerStats.marketRoleDay?.buyer === true,
          roleSwitch: Boolean(sellerPreviousRole && sellerPreviousRole !== "seller"),
        };
        const buyerSignals = {
          ...dealSignals,
          bothRolesDay: buyerStats.marketRoleDay?.seller === true && buyerStats.marketRoleDay?.buyer === true,
          roleSwitch: Boolean(buyerPreviousRole && buyerPreviousRole !== "buyer"),
        };
        const sellerUnlock = unlockAchievements(
          sellerAchievement,
          eligibleAchievementIds({ marketStats: sellerStats, signals: sellerSignals, scope: "market" }),
        );
        const buyerUnlock = unlockAchievements(
          buyerAchievement,
          eligibleAchievementIds({ marketStats: buyerStats, signals: buyerSignals, scope: "market" }),
        );
        achievementResults[room.sellerUid] = sellerUnlock.profile;
        achievementResults[room.buyerUid] = buyerUnlock.profile;
        newlyUnlockedResults[room.sellerUid] = sellerUnlock.newlyUnlocked;
        newlyUnlockedResults[room.buyerUid] = buyerUnlock.newlyUnlocked;
        sellerStats.publicAchievements = effectiveShowcase(sellerUnlock.profile);
        buyerStats.publicAchievements = effectiveShowcase(buyerUnlock.profile);
        transaction.create(pairRef, {
          sellerUid: room.sellerUid,
          buyerUid: room.buyerUid,
          dateKey,
          roomId,
          createdAt: Date.now(),
        });
        if (!relationshipSnapshot.exists) {
          transaction.create(relationshipRef, {
            participants: [room.sellerUid, room.buyerUid].sort(),
            createdAt: Date.now(),
          });
        }
      }
    } else if (action === "leave") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "decision");
      room.status = "ended";
      room.endReason = "buyer_left";
    } else if (action === "request_extension") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "decision");
      if (Number(room.turn || 1) >= MARKET_MAX_TURNS) throw new HttpsError("failed-precondition", "営業ターンは上限です。");
      room.status = "extension_request";
      room.extensionRequestedAt = Date.now();
    } else if (action === "offer_extension") {
      requireRoomActor(room, uid, "seller");
      requireMarketState(room, "extension_request");
      const incentive = integer(data?.incentive, 5, 20, 5);
      if (!MARKET_EXTENSION_FEES.has(incentive)) throw new HttpsError("invalid-argument", "延長内金は5・10・20PTから選択してください。");
      const amount = debitPoints(sellerWallet, incentive);
      reserveIncoming(sellerWallet, amount);
      reserveIncoming(buyerWallet, amount);
      room.status = "extension_offer";
      room.extensionIncentive = amount;
      room.extensionHeld = amount;
      room.extensionReserved = true;
      room.extensionOfferedAt = Date.now();
      transfer = { fromUid: room.sellerUid, toUid: "market_escrow", amount, kind: "extension_hold" };
    } else if (action === "accept_extension") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "extension_offer");
      const held = Math.max(0, Number(room.extensionHeld || room.extensionIncentive || 0));
      if (held < 1) throw new HttpsError("failed-precondition", "延長内金を確認できません。");
      if (room.extensionReserved === true) {
        releaseIncoming(sellerWallet, held);
        releaseIncoming(buyerWallet, held);
      }
      const amount = room.extensionReserved === true
        ? creditPoints(buyerWallet, held)
        : transferPoints(sellerWallet, buyerWallet, held);
      room.status = "pitch";
      room.turn = Number(room.turn || 1) + 1;
      room.extensionFeesPaid = Number(room.extensionFeesPaid || 0) + amount;
      room.extensionIncentive = 0;
      room.extensionHeld = 0;
      room.extensionReserved = false;
      buyerStats.extensionIncome = Number(buyerStats.extensionIncome || 0) + amount;
      transfer = { fromUid: "market_escrow", toUid: room.buyerUid, amount, kind: "extension_incentive" };
    } else if (action === "decline_extension") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "extension_offer");
      const held = Math.max(0, Number(room.extensionHeld || 0));
      if (held > 0) {
        if (room.extensionReserved === true) {
          releaseIncoming(sellerWallet, held);
          releaseIncoming(buyerWallet, held);
        }
        creditPoints(sellerWallet, held);
        room.extensionHeld = 0;
        room.extensionReserved = false;
        transfer = { fromUid: "market_escrow", toUid: room.sellerUid, amount: held, kind: "extension_refund" };
      }
      room.status = "ended";
      room.endReason = "extension_declined";
    } else if (action === "cancel") {
      if (isTerminalMarketState(room.status)) {
        result = { status: room.status, room, sellerBalance: sellerWallet.balance, buyerBalance: buyerWallet.balance, role };
        return;
      }
      const heldFee = Math.max(0, Number(room.entryFeeHeld || 0));
      if (heldFee > 0) {
        const wasReserved = room.entryFeeReserved === true;
        if (wasReserved) {
          releaseIncoming(sellerWallet, heldFee);
          releaseIncoming(buyerWallet, heldFee);
        }
        if (role === "seller") {
          const settlement = wasReserved
            ? { preferredAmount: creditPoints(buyerWallet, heldFee), fallbackAmount: 0, overflow: 0 }
            : distributeEscrow(buyerWallet, sellerWallet, heldFee);
          sellerStats.laborFees = Number(sellerStats.laborFees || 0) + settlement.fallbackAmount;
          transfer = {
            fromUid: "market_escrow",
            toUid: room.buyerUid,
            amount: settlement.preferredAmount,
            compensated: settlement.fallbackAmount,
            overflow: settlement.overflow,
            kind: "entry_fee_refund",
          };
          room.escrowOverflowBurned = Number(room.escrowOverflowBurned || 0) + settlement.overflow;
        } else {
          const settlement = wasReserved
            ? { preferredAmount: creditPoints(sellerWallet, heldFee), fallbackAmount: 0, overflow: 0 }
            : distributeEscrow(sellerWallet, buyerWallet, heldFee);
          sellerStats.laborFees = Number(sellerStats.laborFees || 0) + settlement.preferredAmount;
          transfer = {
            fromUid: "market_escrow",
            toUid: room.sellerUid,
            amount: settlement.preferredAmount,
            refunded: settlement.fallbackAmount,
            overflow: settlement.overflow,
            kind: "entry_fee_compensation",
          };
          room.escrowOverflowBurned = Number(room.escrowOverflowBurned || 0) + settlement.overflow;
        }
        room.entryFeeHeld = 0;
        room.entryFeeReserved = false;
        room.entryFeeSettledAt = Date.now();
      }
      const extensionHeld = Math.max(0, Number(room.extensionHeld || 0));
      if (extensionHeld > 0) {
        if (room.extensionReserved === true) {
          releaseIncoming(sellerWallet, extensionHeld);
          releaseIncoming(buyerWallet, extensionHeld);
        }
        creditPoints(sellerWallet, extensionHeld);
        room.extensionHeld = 0;
        room.extensionReserved = false;
        transfer = transfer || { fromUid: "market_escrow", toUid: room.sellerUid, amount: extensionHeld, kind: "extension_refund" };
      }
      room.status = "canceled";
      room.endReason = role === "seller" ? "seller_canceled" : "buyer_canceled";
    } else {
      throw new HttpsError("invalid-argument", "未対応の市場操作です。");
    }

    room.stateVersion = Math.max(0, Math.floor(Number(room.stateVersion || 0))) + 1;
    room.updatedAt = Date.now();
    sellerStats.name = cleanName(room.sellerName);
    sellerStats.updatedAt = Date.now();
    buyerStats.name = cleanName(room.buyerName);
    buyerStats.updatedAt = Date.now();
    transaction.set(roomRef, room);
    transaction.set(sellerWalletRef, { ...sellerWallet, updatedAt: Date.now() }, { merge: true });
    transaction.set(buyerWalletRef, { ...buyerWallet, updatedAt: Date.now() }, { merge: true });
    transaction.set(sellerStatsRef, sellerStats);
    transaction.set(buyerStatsRef, buyerStats);
    if (achievementResults[room.sellerUid]) transaction.set(sellerAchievementRef, achievementResults[room.sellerUid]);
    if (achievementResults[room.buyerUid]) transaction.set(buyerAchievementRef, achievementResults[room.buyerUid]);
    if (isTerminalMarketState(room.status)) {
      transaction.delete(marketActiveRef(room.sellerUid));
      transaction.delete(marketActiveRef(room.buyerUid));
    }
    result = {
      status: room.status,
      room,
      sellerBalance: sellerWallet.balance,
      buyerBalance: buyerWallet.balance,
      role,
      newlyUnlocked: newlyUnlockedResults[uid] || [],
    };
    transaction.create(ledgerRef, {
      roomId,
      actorUid: uid,
      action,
      actionId,
      status: result.status,
      sellerBalance: result.sellerBalance,
      buyerBalance: result.buyerBalance,
      rankingCounted: room.rankingCounted ?? null,
      marketFee: Number(room.marketFee || 0),
      sellerProceeds: Number(room.sellerProceeds || 0),
      certificateNumber: cleanText(room.certificateNumber, 24),
      achievementIds: result.newlyUnlocked,
      transfer,
      turn: Number(room.turn || 1),
      createdAt: Date.now(),
    });
  });

  await bestEffort("performMarketAction", [
    mirrorWallet(initialRoom.sellerUid, result.sellerBalance),
    mirrorWallet(initialRoom.buyerUid, result.buyerBalance),
    ...Object.entries(achievementResults).map(([participantUid, profile]) => (
      syncAchievementPublicSurfaces(participantUid, profile)
    )),
  ]);
  await retryRealtimeWrite(() => mirrorMarketRoom(result.room, {
    seenRoles: isTerminalMarketState(result.status) ? [] : [result.role],
  }));
  return {
    status: result.status,
    roomId,
    balance: uid === initialRoom.sellerUid ? result.sellerBalance : result.buyerBalance,
    rankingCounted: result.room.rankingCounted ?? null,
    marketFee: Number(result.room.marketFee || 0),
    sellerProceeds: Number(result.room.sellerProceeds || 0),
    certificateNumber: cleanText(result.room.certificateNumber, 24),
    newlyUnlocked: result.newlyUnlocked || [],
  };
}

exports.valueMarketAction = onCall(callableOptions("valueMarketAction"), async (request) => {
  const uid = requireUid(request);
  try {
    return await performMarketAction(uid, request.data, Boolean(request.app));
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("valueMarketAction failed", { uid, roomId: request.data?.roomId, action: request.data?.action, error });
    throw new HttpsError("internal", "市場取引を完了できませんでした。");
  }
});

async function saveMarketPublicProfile(uid, data) {
  const xPublic = data?.xPublic === true;
  const taglinePublic = data?.taglinePublic === true;
  const xHandle = normalizeMarketXHandle(data?.xHandle);
  const tagline = normalizeMarketTagline(data?.tagline);
  if (xPublic && !isValidMarketXHandle(xHandle)) {
    throw new HttpsError("invalid-argument", "Xユーザー名は半角英数字と_で15文字以内にしてください。");
  }
  if (taglinePublic && !isValidMarketTagline(tagline)) {
    throw new HttpsError("invalid-argument", "市場プロフィールの一言は改行なしの40文字以内にしてください。");
  }

  const statsRef = marketStatsRef(uid);
  const now = Date.now();
  const publicProfile = {
    xHandle: xPublic ? xHandle : "",
    tagline: taglinePublic ? tagline : "",
    updatedAt: now,
  };
  let savedProfile = sanitizeStoredMarketPublicProfile(publicProfile);
  let savedAt = now;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(statsRef);
    const currentProfile = snapshot.exists ? snapshot.get("publicProfile") : undefined;
    const decision = marketPublicProfileUpdateDecision(
      currentProfile,
      publicProfile,
      now,
      MARKET_PROFILE_UPDATE_COOLDOWN_MS,
    );
    if (
      (!snapshot.exists || !hasRankedMarketStats(snapshot.data()))
      && decision.action !== "noop"
      && !isMarketPublicProfilePrivacyReduction(currentProfile, publicProfile)
    ) {
      throw new HttpsError("failed-precondition", "売上または購入実績がランキングへ反映された後に設定できます。");
    }
    if (decision.action === "noop") {
      savedProfile = decision.profile;
      savedAt = decision.updatedAt;
      return;
    }
    if (decision.action === "rate_limited") {
      throw new HttpsError("resource-exhausted", "公開プロフィールは少し待ってから更新してください。");
    }
    transaction.set(statsRef, { publicProfile }, { merge: true });
  });
  return {
    saved: true,
    profile: savedProfile,
    updatedAt: savedAt,
  };
}

function rankingRow(snapshot, role, viewerUid) {
  return createMarketRankingRow(snapshot.data(), role, snapshot.id === viewerUid);
}

function publicMarketCertificate(snapshot) {
  const value = snapshot.data();
  return {
    certificateNumber: cleanText(value?.certificateNumber, 24),
    listingTitle: cleanText(value?.listingTitle, 30, "無題の推し"),
    sellerName: cleanName(value?.sellerName),
    purchasePrice: integer(value?.purchasePrice, MARKET_MIN_PRICE, MARKET_MAX_PRICE, MARKET_MIN_PRICE),
    marketFee: integer(value?.marketFee, 1, MARKET_MAX_PRICE, 1),
    sellerProceeds: integer(value?.sellerProceeds, 0, MARKET_MAX_PRICE, 0),
    turn: integer(value?.turn, 1, MARKET_MAX_TURNS, 1),
    extended: value?.extended === true,
    rankingCounted: value?.rankingCounted === true,
    nonTransferable: true,
    issuedAt: Number(value?.issuedAt || 0),
  };
}

async function listMarketCertificates(uid) {
  const snapshot = await firestore.collection("valueMarketCertificates")
    .doc(uid)
    .collection("items")
    .orderBy("issuedAt", "desc")
    .limit(100)
    .get();
  return {
    certificates: snapshot.docs.map(publicMarketCertificate),
    maximum: 100,
    hasMore: snapshot.size === 100,
    updatedAt: Date.now(),
  };
}

exports.valueMarketRankings = onCall(callableOptions("valueMarketRankings"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 32, "list") || "list";
  if (action === "save_public_profile") return saveMarketPublicProfile(uid, request.data);
  if (action === "collection") return listMarketCertificates(uid);
  if (action !== "list") throw new HttpsError("invalid-argument", "未対応のランキング操作です。");
  const achievementState = await ensureAchievementState(uid);
  await syncAchievementPublicSurfaces(uid, achievementState.profile);

  const [sellerSnapshot, buyerSnapshot, viewerSnapshot] = await Promise.all([
    firestore.collection("valueMarketStats").orderBy("grossSales", "desc").limit(20).get(),
    firestore.collection("valueMarketStats").orderBy("spent", "desc").limit(20).get(),
    marketStatsRef(uid).get(),
  ]);
  const viewerStats = viewerSnapshot.exists ? viewerSnapshot.data() : null;
  return {
    sellers: sellerSnapshot.docs.map((snapshot) => rankingRow(snapshot, "seller", uid)).filter((entry) => entry.primary > 0),
    buyers: buyerSnapshot.docs.map((snapshot) => rankingRow(snapshot, "buyer", uid)).filter((entry) => entry.primary > 0),
    viewerProfile: sanitizeStoredMarketPublicProfile(viewerStats?.publicProfile),
    viewerEligible: hasRankedMarketStats(viewerStats),
    viewerName: viewerStats ? cleanName(viewerStats.name) : "",
    updatedAt: Date.now(),
  };
});
