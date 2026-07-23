"use strict";

const crypto = require("node:crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getFirestore } = require("firebase-admin/firestore");
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
const PRODUCT_CATALOG = require("./product-catalog");

initializeApp({
  databaseURL: "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app",
});
setGlobalOptions({ region: "us-central1", maxInstances: 20 });

const firestore = getFirestore();
const realtime = getDatabase();
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
  return {
    ...CALLABLE_BASE_OPTIONS,
    enforceAppCheck: APP_CHECK_ENFORCEMENT[functionName],
  };
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
  return {
    schemaVersion: 1,
    daily: normalizeDaily(value?.daily, dateKey),
    periodRewards: normalizePeriodRecords(value?.periodRewards),
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

async function initializeEconomy(uid) {
  const [balance, progress] = await Promise.all([
    ensureWallet(uid),
    ensureEconomyProgress(uid),
  ]);
  await Promise.all([
    mirrorWallet(uid, balance),
    mirrorEconomyProgress(uid, progress),
  ]);
  return { outcome: "ready", balance, daily: progress.daily, periodRewards: progress.periodRewards };
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

  await Promise.all(participants.map((participantUid) => ensureEconomyProgress(participantUid)));
  const progressRefs = participants.map((participantUid) => economyProgressRef(participantUid));
  const claimRefs = participants.map((participantUid) => (
    firestore.collection("verifiedMatchClaims").doc(eventId(`${participantUid}:${mode}:${roomId}`))
  ));
  let transactionOutcome = "recorded";
  const progressResults = {};
  await firestore.runTransaction(async (transaction) => {
    const snapshots = await Promise.all([
      ...progressRefs.map((ref) => transaction.get(ref)),
      ...claimRefs.map((ref) => transaction.get(ref)),
    ]);
    const progressSnapshots = snapshots.slice(0, participants.length);
    const claimSnapshots = snapshots.slice(participants.length);
    transactionOutcome = claimSnapshots[participants.indexOf(uid)].exists ? "duplicate" : "recorded";
    participants.forEach((participantUid, index) => {
      if (claimSnapshots[index].exists) {
        progressResults[participantUid] = normalizeEconomyProgress(progressSnapshots[index].data());
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
      progressResults[participantUid] = progress;
      transaction.set(progressRefs[index], progress);
      transaction.create(claimRefs[index], {
        uid: participantUid,
        mode,
        roomId,
        outcome: participantOutcome,
        participants,
        activity: participantActivity,
        finalizedBy: uid,
        createdAt: now,
      });
    });
  });
  await bestEffort("recordVerifiedMatch", participants.map((participantUid) => (
    mirrorEconomyProgress(participantUid, progressResults[participantUid])
  )));
  const progressResult = progressResults[uid];
  return {
    outcome: transactionOutcome,
    daily: progressResult.daily,
    periodRewards: progressResult.periodRewards,
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
    if (action === "record_match") return await recordVerifiedMatch(uid, request.data);
    throw new HttpsError("invalid-argument", "未対応のポイント操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("economyAction failed", { uid, action, error });
    throw new HttpsError("internal", "ポイント処理を完了できませんでした。");
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

function normalizeQueueEntry(uid, data, balance, appCheckVerified) {
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
  const [balance, previousQueueSnapshot] = await Promise.all([
    ensureWallet(uid),
    marketQueueRef(uid).get(),
  ]);
  const ownEntry = normalizeQueueEntry(uid, data, balance, appCheckVerified);
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
      listing: seller.listing,
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
    bestSale: 0,
    laborFees: 0,
    purchases: 0,
    spent: 0,
    highestPurchase: 0,
    extensionIncome: 0,
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
  await Promise.all([ensureWallet(initialRoom.sellerUid), ensureWallet(initialRoom.buyerUid)]);

  const roomRef = marketRoomRef(roomId);
  const sellerWalletRef = walletRef(initialRoom.sellerUid);
  const buyerWalletRef = walletRef(initialRoom.buyerUid);
  const sellerStatsRef = marketStatsRef(initialRoom.sellerUid);
  const buyerStatsRef = marketStatsRef(initialRoom.buyerUid);
  const pairKey = eventId(`${[initialRoom.sellerUid, initialRoom.buyerUid].sort().join(":")}:${jstDateKey()}`);
  const pairRef = firestore.collection("valueMarketRankedPairs").doc(pairKey);
  const ledgerRef = firestore.collection("valueMarketLedger").doc(eventId(`${roomId}:${uid}:${actionId}`));
  let result = null;

  await firestore.runTransaction(async (transaction) => {
    const [roomSnapshot, sellerWalletSnapshot, buyerWalletSnapshot, sellerStatsSnapshot, buyerStatsSnapshot, pairSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(sellerWalletRef),
      transaction.get(buyerWalletRef),
      transaction.get(sellerStatsRef),
      transaction.get(buyerStatsRef),
      transaction.get(pairRef),
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
      };
      return;
    }
    const sellerStats = sellerStatsSnapshot.exists ? { ...defaultStats(room.sellerUid, room.sellerName), ...sellerStatsSnapshot.data() } : defaultStats(room.sellerUid, room.sellerName);
    const buyerStats = buyerStatsSnapshot.exists ? { ...defaultStats(room.buyerUid, room.buyerName), ...buyerStatsSnapshot.data() } : defaultStats(room.buyerUid, room.buyerName);
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
      const amount = transferPoints(buyerWallet, sellerWallet, price);
      room.status = "sold";
      room.salePrice = amount;
      room.soldAt = Date.now();
      room.rankingCounted = !pairSnapshot.exists;
      transfer = { fromUid: room.buyerUid, toUid: room.sellerUid, amount, kind: "sale" };
      if (!pairSnapshot.exists) {
        sellerStats.salesCount = Number(sellerStats.salesCount || 0) + 1;
        sellerStats.grossSales = Number(sellerStats.grossSales || 0) + amount;
        sellerStats.bestSale = Math.max(Number(sellerStats.bestSale || 0), amount);
        buyerStats.purchases = Number(buyerStats.purchases || 0) + 1;
        buyerStats.spent = Number(buyerStats.spent || 0) + amount;
        buyerStats.highestPurchase = Math.max(Number(buyerStats.highestPurchase || 0), amount);
        transaction.create(pairRef, {
          sellerUid: room.sellerUid,
          buyerUid: room.buyerUid,
          dateKey: jstDateKey(),
          roomId,
          createdAt: Date.now(),
        });
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
    if (isTerminalMarketState(room.status)) {
      transaction.delete(marketActiveRef(room.sellerUid));
      transaction.delete(marketActiveRef(room.buyerUid));
    }
    result = { status: room.status, room, sellerBalance: sellerWallet.balance, buyerBalance: buyerWallet.balance, role };
    transaction.create(ledgerRef, {
      roomId,
      actorUid: uid,
      action,
      actionId,
      status: result.status,
      sellerBalance: result.sellerBalance,
      buyerBalance: result.buyerBalance,
      rankingCounted: room.rankingCounted ?? null,
      transfer,
      turn: Number(room.turn || 1),
      createdAt: Date.now(),
    });
  });

  await bestEffort("performMarketAction", [
    mirrorWallet(initialRoom.sellerUid, result.sellerBalance),
    mirrorWallet(initialRoom.buyerUid, result.buyerBalance),
  ]);
  await retryRealtimeWrite(() => mirrorMarketRoom(result.room, {
    seenRoles: isTerminalMarketState(result.status) ? [] : [result.role],
  }));
  return {
    status: result.status,
    roomId,
    balance: uid === initialRoom.sellerUid ? result.sellerBalance : result.buyerBalance,
    rankingCounted: result.room.rankingCounted ?? null,
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

exports.valueMarketRankings = onCall(callableOptions("valueMarketRankings"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 32, "list") || "list";
  if (action === "save_public_profile") return saveMarketPublicProfile(uid, request.data);
  if (action !== "list") throw new HttpsError("invalid-argument", "未対応のランキング操作です。");

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
