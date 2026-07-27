"use strict";

const crypto = require("node:crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineBoolean, defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const {
  FieldValue,
  getFirestore,
  Timestamp,
} = require("firebase-admin/firestore");
const {
  createOnlinePublicPresenceCleanup,
} = require("./online-public-presence-cleanup");
const {
  createTrainingQueueCleanup,
  createTrainingRoomCleanup,
  trainingActiveRoomIsLive,
} = require("./training-room-cleanup");
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
  TRAINING_ROOM_MAX_AGE_MS,
  applyTrainingSession,
  assertTrainingRoomFinalizable,
  normalizeTrainingProfile,
  trainingDailySettlement,
} = require("./training");
const {
  CREATOR_CARD_PREMIUM_PRODUCT_ID,
  CREATOR_CARD_TEXT_MAX_LENGTH,
  CREATOR_CARD_TYPES,
  CREATOR_CARD_VERSION,
  creatorCardActivityCount,
  creatorCardGrowthLevel,
  isCreatorCardTheme,
  isPremiumCreatorCardTheme,
  isValidCreatorCardText,
  normalizeCreatorCardXHandle,
} = require("./creator-card");
const {
  PATRON_TIERS,
  normalizePatronage,
  oshijoPatronEligibility,
  patronUpgrade,
  publicPatronage,
} = require("./patronage");
const {
  MARKET_POLICY_IDS,
  PATRON_FUND_MAX_SUBSIDY_PER_SALE,
  PATRON_FUND_MONTHLY_SELLER_CAP,
  normalizeMarketPolicyId,
  normalizePatronFund,
  normalizePolicyVote,
  patronFundSubsidyDecision,
  patronRecommendationLimit,
  publicPatronFundSummary,
  splitPatronPayment,
} = require("./patron-fund");
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
  createAnjuPayFleaService,
} = require("./anju-pay-flea-service");
const {
  createFreeTableService,
} = require("./free-table");
const {
  currentFreeTableP2pDiagnosticContext,
  freeTableP2pDiagnosticIdIsSafe,
} = require("./free-table-p2p-diagnostics");
const {
  MARKET_RANKING_CONTRIBUTION_CAP,
  applyMarketRankingHonor,
  applyMonthlyMarketSale,
  marketRankingContribution,
  normalizeMonthlyMarketStats,
  publicMarketRankingHonors,
} = require("./market-ranking");
const {
  MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
  MARKET_OSHIJO_MAX_CLOSING_TURNS,
  marketClosingAllowsExtension,
  marketClosingAuditMode,
  marketClosingDecision,
  marketClosingLeaveReason,
  marketOshijoActiveReservations,
  marketOshijoClaimDecision,
  marketOshijoDeliveries,
  marketOshijoDeliveryId,
  marketOshijoFinalizeDeliveryDecision,
  marketOshijoMediaCounts,
  marketOshijoReleaseDeliveryDecision,
  marketOshijoReserveDeliveryDecision,
  marketOshijoSettlementDecision,
  marketOshijoTurnDecision,
} = require("./market-closing");
const {
  DEFAULT_MARKET_SHOP,
  FREE_MARKET_SHOP_CHARM_IDS,
  MARKET_SHOP_CATALOG,
  applyMarketSaleToShop,
  isValidPublicSellerId,
  marketImpressionDecision,
  marketQueueCandidateSessionKey,
  marketQueuesCompatible,
  marketSaleRelationshipUpdate,
  marketShopReport,
  marketShopSalesModeRecord,
  marketShopSalesCount,
  normalizeStoredMarketShop,
  preserveLegacyMarketServiceStyles,
  publicSellerShop,
  restoreMarketShopSalesModeRecord,
  selectMarketQueueCandidates,
  shouldReplaceMarketQueue,
  validateMarketShopInput,
} = require("./market-shop");
const {
  ACTIVE_SERVER_RANKING_MODES,
  SERVER_RANKING_AWARD_MINIMUM_MATCHES,
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
const {
  CROWN_CIRCUIT_MODES,
  CROWN_CIRCUIT_RULESET_VERSION,
  CROWN_DAILY_MATCH_LIMIT,
  CROWN_MONTHLY_BEST_WEEKS,
  CROWN_MONTHLY_MIN_WEEKS,
  CROWN_PROMOTION_MIN_PARTICIPANTS,
  CROWN_SIGNATURE_IDS,
  CROWN_THEMES,
  CROWN_WEEKLY_BEST_DAYS,
  CROWN_WEEKLY_MIN_DAYS,
  addCrownRunResult,
  applyDailyStarToWeekly,
  applyWeeklyStarToMonthly,
  compareCrownCircuitEntries,
  compareCrownRunEntries,
  crownAwardTier,
  crownStarScore,
  isCrownCircuitPeriod,
  normalizeCrownRun,
  normalizeSignatureIds,
  startCrownRun,
} = require("./crown-circuit");
const PRODUCT_CATALOG = require("./product-catalog");
const RETIRED_TEAM_PRODUCT_IDS = new Set([
  "title_team_link_active",
  "title_trust_my_partner",
  "title_combo_romance",
  "title_last_image",
  "title_still_surviving",
]);
const {
  claimableDailyPlayRewards,
  dailyPlayRewardClaimKey,
  dailyPlayRewardSummary,
  normalizeDailyPlayClaims,
  settleDailyPlayRewardClaims,
} = require("./daily-play-rewards");
const {
  ANJU_PAY_MAX_BALANCE,
  ANJU_PAY_HISTORY_DEFAULT_LIMIT,
  ANJU_PAY_HISTORY_MAX_LIMIT,
  ANJU_PAY_LEDGER_SCHEMA_VERSION,
  ANJU_PAY_OPENING_ENTRY_ID,
  activateAnjuPayWallet,
  anjuPayEntryId,
  anjuPayLedgerModeDecision,
  isAnjuPayWalletActive,
  nextAnjuPayEntry,
  sanitizeAnjuPayEntry,
} = require("./anju-pay-ledger");
const {
  SOLO_FAMILIAR_BLOCK_LIST_LIMIT,
  SOLO_FAMILIAR_BOOK_LIMIT,
  SOLO_FAMILIAR_INTENT_TTL_MS,
  SOLO_FAMILIAR_REUNION_COOLDOWN_MS,
  SOLO_MATCH_PERMIT_TTL_MS,
  canReactivateSoloFamiliarPair,
  isValidSoloServerQueueEntry,
  publicSoloFamiliarBlockEntry,
  publicSoloFamiliarBookEntry,
  selectSoloServerMatch,
  soloFamiliarEntryId,
  soloFamiliarIntentId,
  soloFamiliarPairId,
  soloFamiliarRolloutFlags,
  soloQueuePreferenceTier,
} = require("./solo-familiar");
const {
  P2P_CONNECTIVITY_PUBLIC_ERROR,
  P2P_DIAGNOSTIC_CLEANUP_INTERVAL_MS,
  P2P_DIAGNOSTIC_CLEANUP_MAX_DAYS,
  P2P_DIAGNOSTIC_RATE_LIMIT_POLICY,
  P2P_DIAGNOSTIC_RETENTION_DAYS,
  P2P_DIAGNOSTIC_TIME_ZONE,
  TURN_CREDENTIAL_RATE_LIMIT_POLICY,
  TURN_CREDENTIAL_REQUEST_TIMEOUT_MS,
  cloudflareTurnCredentialRequestBody,
  cloudflareTurnCredentialsUrl,
  createP2PDiagnosticRecord,
  p2pDiagnosticRetentionCutoffDay,
  p2pDiagnosticCleanupMarkerRollbackValue,
  p2pConnectivityRateLimitDecision,
  safeP2PConnectivityError,
  selectExpiredP2PDiagnosticDayKeys,
  validateCloudflareTurnCredentialResponse,
} = require("./p2p-connectivity");
const {
  SOLO_SESSION_LEASE_TTL_MS,
  SOLO_SESSION_MATCH_TTL_MS,
  SOLO_SESSION_PROTOCOL_VERSION,
  SOLO_SIGNALING_VERSION,
  activeV2EntryIsFresh,
  activeV2UidSet,
  buildSoloSessionV2Resources,
  claimDecision,
  claimMatches,
  decideSoloRoomTransition,
  flattenFreshQueueV2,
  heartbeatDecision,
  isSafeToken,
  materializationFenceMatches,
  normalizeClaim,
  publicClaimLease,
  queueEntryMatchesClaim,
  replacedClaimResourceFence,
  resourceFenceMatches,
  roomAttemptMatches,
  roomMatchesSessionV2,
  roomTransitionOwned,
  selectSoloSessionV2Match,
} = require("./solo-session-v2");
const {
  deriveSoloMatchResult,
} = require("./solo-match-finalization");
const {
  SoloProfileProjectionConflictError,
  projectNormalSoloProfile,
  projectOverallSoloProfile,
  serverProjectionReceiptOutcome,
} = require("./solo-profile-projection");

const PRODUCTION_DATABASE_URL =
  "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app";

function runtimeDatabaseUrl(environment = process.env) {
  let configuredProjectId = "";
  try {
    configuredProjectId = String(
      JSON.parse(environment.FIREBASE_CONFIG || "{}").projectId || "",
    );
  } catch {
    configuredProjectId = "";
  }
  const projectId = String(
    environment.GCLOUD_PROJECT
    || environment.GCP_PROJECT
    || configuredProjectId,
  );
  const isIsolatedEmulator = Boolean(environment.FIREBASE_DATABASE_EMULATOR_HOST)
    && /^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(projectId);
  return isIsolatedEmulator
    ? `https://${projectId}-default-rtdb.firebaseio.com`
    : PRODUCTION_DATABASE_URL;
}

initializeApp({
  databaseURL: runtimeDatabaseUrl(),
});
setGlobalOptions({ region: "us-central1", maxInstances: 20 });

const firestore = getFirestore();
const realtime = getDatabase();
const cleanupOnlinePublicPresence = createOnlinePublicPresenceCleanup({
  realtime,
});
const cleanupTrainingQueue = createTrainingQueueCleanup({
  realtime,
});
const cleanupTrainingRooms = createTrainingRoomCleanup({
  realtime,
  finalizeRoom: ({ roomId, participantUid, now }) => (
    finalizeTraining(participantUid, roomId, {
      now,
      maxRoomAgeMs: Number.MAX_SAFE_INTEGER,
    })
  ),
});
const adminAuth = getAuth();
const MAX_POINTS = ANJU_PAY_MAX_BALANCE;
const MARKET_ENTRY_FEE = 5;
const MARKET_MAX_TURNS = 3;
const MARKET_MIN_PRICE = 10;
const MARKET_MAX_PRICE = 500;
const MARKET_MONTHLY_RANKING_START_KEY = "2026-08";
const MARKET_EXTENSION_FEES = new Set([5, 10, 20]);
const PATRON_RECOMMENDED_SHELF_MINIMUM = 3;
const PATRON_RECOMMENDED_SHELF_LIMIT = 12;
const MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS = 20_000;
const QUEUE_FRESH_MS = 60_000;
const MARKET_PROFILE_UPDATE_COOLDOWN_MS = 10_000;
const MARKET_PUBLIC_PRESENCE_PATH = "online/publicMarketPresence";
const SOLO_MATCH_ATTEMPT_MIN_INTERVAL_MS = 1_000;
const SOLO_MATCH_ATTEMPT_RETENTION_MS = 10 * 60 * 1000;
const SOLO_MATCH_CONTEXT_RECOVERY_GRACE_MS = 5_000;
const SOLO_LEGACY_PRESENCE_FRESH_MS = 30 * 60 * 1000;
const SOLO_MATCH_MIN_REMAINING_PERMIT_MS = 22_000;
const SOLO_MATCH_PERMIT_SWEEP_INTERVAL_MS = 60_000;
const SOLO_SESSION_CLAIM_GUARD_TTL_MS = 60_000;
const SOLO_PROFILE_PROJECTION_VERSION = 2;
const SOLO_PROFILE_PROJECTION_LEASE_MS = 60_000;
const SOLO_PROFILE_PROJECTION_BATCH_SIZE = 5;
const CALLABLE_BASE_OPTIONS = Object.freeze({
  timeoutSeconds: 30,
  memory: "256MiB",
});
const ANJU_PAY_LEDGER_REQUIRED = defineBoolean("ANJU_PAY_LEDGER_REQUIRED", {
  default: true,
  description: "Keep true after AnjuPay ledger activation. False is allowed only for the initial compatibility deployment.",
});
const CREATOR_CARD_PUBLISH_COOLDOWN_MS = 15_000;
const CLOUDFLARE_TURN_KEY_ID = defineSecret("CLOUDFLARE_TURN_KEY_ID");
const CLOUDFLARE_TURN_API_TOKEN = defineSecret("CLOUDFLARE_TURN_API_TOKEN");
const P2P_DIAGNOSTIC_HMAC_SECRET = defineSecret("P2P_DIAGNOSTIC_HMAC_SECRET");
const P2P_TURN_RESPONSE_MAX_BYTES = 64 * 1024;
const P2P_DIAGNOSTIC_RETENTION_MS = P2P_DIAGNOSTIC_RETENTION_DAYS * 24 * 60 * 60 * 1000;
let lastSoloMatchPermitSweepAt = 0;

function callableOptions(functionName, secrets = []) {
  if (!Object.hasOwn(APP_CHECK_ENFORCEMENT, functionName)) {
    throw new Error(`Missing App Check policy for callable: ${functionName}`);
  }
  const options = {
    ...CALLABLE_BASE_OPTIONS,
    enforceAppCheck: APP_CHECK_ENFORCEMENT[functionName],
  };
  if (functionName === "economyAction") options.timeoutSeconds = 60;
  if (secrets.length) options.secrets = secrets;
  if (functionName === "accountTransfer") options.consumeAppCheckToken = true;
  return options;
}
const DAILY_MISSIONS = Object.freeze({
  complete_match: { progressKey: "matches", target: 1, reward: 100, endsAfter: "2026-07-23" },
  score_three: { progressKey: "scores", target: 3, reward: 60 },
  give_critical: { progressKey: "criticals", target: 1, reward: 90 },
  play_solo: { progressKey: "soloMatches", target: 1, reward: 70 },
  play_strategy: { progressKey: "strategyMatches", target: 1, reward: 80 },
  play_team: {
    progressKey: "teamMatches", target: 1, reward: 100, endsAfter: "2026-07-28",
  },
  play_training: {
    progressKey: "trainingSets", target: 1, reward: 100, startsOn: "2026-07-28",
  },
});

function requireUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "匿名ログインが必要です。");
  return uid;
}

function isPlainCallableObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireEmptyP2pCallableData(value) {
  if (value == null) return;
  if (!isPlainCallableObject(value) || Reflect.ownKeys(value).length !== 0) {
    throw new HttpsError("invalid-argument", "接続情報リクエストの形式が正しくありません。");
  }
}

function requireP2pDiagnosticCallableData(value) {
  const allowedKeys = new Set(["sessionId", "roomId", "diagnostic"]);
  if (!isPlainCallableObject(value)
      || Reflect.ownKeys(value).some((key) => (
        typeof key !== "string" || !allowedKeys.has(key)
      ))
      || ![...allowedKeys].every((key) => Object.hasOwn(value, key))) {
    throw new HttpsError("invalid-argument", "接続診断の形式が正しくありません。");
  }
  return value;
}

function requireMarketP2pDiagnosticCallableData(value) {
  const allowedKeys = new Set(["roomId", "diagnostic"]);
  if (!isPlainCallableObject(value)
      || Reflect.ownKeys(value).some((key) => (
        typeof key !== "string" || !allowedKeys.has(key)
      ))
      || ![...allowedKeys].every((key) => Object.hasOwn(value, key))
      || !/^[-0-9A-Z_a-z]{20}$/.test(String(value.roomId || ""))) {
    throw new HttpsError("invalid-argument", "市場接続診断の形式が正しくありません。");
  }
  return value;
}

function requireFreeTableP2pDiagnosticCallableData(value) {
  const allowedKeys = new Set(["sessionId", "diagnostic"]);
  if (!isPlainCallableObject(value)
      || Reflect.ownKeys(value).some((key) => (
        typeof key !== "string" || !allowedKeys.has(key)
      ))
      || ![...allowedKeys].every((key) => Object.hasOwn(value, key))
      || !freeTableP2pDiagnosticIdIsSafe(value.sessionId)
      || !isPlainCallableObject(value.diagnostic)
      || value.diagnostic.phase !== "free_table") {
    throw new HttpsError("invalid-argument", "自由卓接続診断の形式が正しくありません。");
  }
  return value;
}

async function requireCurrentP2pDiagnosticContext(uid, data, now = Date.now()) {
  if (!isSafeToken(data.sessionId)
      || !/^[-0-9A-Z_a-z]{20}$/.test(String(data.roomId || ""))) {
    throw new HttpsError("invalid-argument", "接続診断の対象を確認してください。");
  }
  const [claimSnapshot, roomSnapshot] = await Promise.all([
    realtime.ref(`online/soloSessionClaims/${uid}`).get(),
    realtime.ref(`online/rooms/${data.roomId}`).get(),
  ]);
  const claim = normalizeClaim(claimSnapshot.val());
  const room = roomSnapshot.val();
  if (!claim
      || claim.sessionId !== data.sessionId
      || claim.expiresAt <= now
      || !roomMatchesSessionV2(room, {
        uid,
        sessionId: data.sessionId,
        generation: claim.generation,
        roomId: data.roomId,
      })) {
    throw new HttpsError(
      "failed-precondition",
      "現在の通常版1on1接続として確認できませんでした。",
    );
  }
}

async function requireCurrentFreeTableP2pDiagnosticContext(
  uid,
  data,
  now = Date.now(),
) {
  const [sessionSnapshot, activeSnapshot] = await Promise.all([
    realtime.ref(`freeTables/sessions/${data.sessionId}`).get(),
    realtime.ref(`freeTables/active/${uid}`).get(),
  ]);
  const context = currentFreeTableP2pDiagnosticContext({
    uid,
    sessionId: data.sessionId,
    sessionValue: sessionSnapshot.val(),
    activeValue: activeSnapshot.val(),
    now,
  });
  if (!context) {
    throw new HttpsError(
      "failed-precondition",
      "現在の貼り合い自由卓接続として確認できませんでした。",
    );
  }
  return context;
}

function readCloudflareTurnApiToken() {
  const value = CLOUDFLARE_TURN_API_TOKEN.value();
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 16
      || token.length > 2048
      || !/^[\x21-\x7e]+$/.test(token)) {
    throw new TypeError("Cloudflare TURN API token is not configured");
  }
  return token;
}

function readP2pDiagnosticHmacSecret() {
  const value = P2P_DIAGNOSTIC_HMAC_SECRET.value();
  const secret = typeof value === "string" ? value.trim() : "";
  const bytes = Buffer.byteLength(secret, "utf8");
  if (bytes < 32 || bytes > 4096) {
    throw new TypeError("P2P diagnostic HMAC secret is not configured");
  }
  return secret;
}

function p2pRateLimitPath(scope, uid) {
  if (scope !== "turn" && scope !== "diagnostic") {
    throw new TypeError("P2P rate limit scope is invalid");
  }
  const uidHash = crypto
    .createHash("sha256")
    .update(`p2p-connectivity-rate-limit:v1:${scope}:`)
    .update(uid)
    .digest("hex");
  return `online/p2pRateLimits/${scope}/${uidHash}`;
}

async function consumeP2pConnectivityRateLimit(uid, scope, policy) {
  const now = Date.now();
  let committedDecision = null;
  let result;
  try {
    result = await realtime.ref(p2pRateLimitPath(scope, uid)).transaction((currentValue) => {
      committedDecision = p2pConnectivityRateLimitDecision(currentValue, now, policy);
      return committedDecision.state;
    });
  } catch (error) {
    console.warn(
      "P2P connectivity rate limit unavailable",
      safeP2PConnectivityError(error, "rate_limit"),
    );
    throw new HttpsError(
      "unavailable",
      "接続保護情報を確認できませんでした。時間をおいてもう一度お試しください。",
    );
  }
  if (!result.committed || !committedDecision) {
    console.warn("P2P connectivity rate limit unavailable", {
      stage: "rate_limit",
      category: "not_committed",
      status: 0,
    });
    throw new HttpsError(
      "unavailable",
      "接続保護情報を確認できませんでした。時間をおいてもう一度お試しください。",
    );
  }
  if (!committedDecision.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      "接続処理が短時間に集中しています。少し待ってからもう一度お試しください。",
      { retryAfterMs: committedDecision.retryAfterMs },
    );
  }
}

async function requestCloudflareTurnIceServers() {
  const keyId = CLOUDFLARE_TURN_KEY_ID.value();
  const url = cloudflareTurnCredentialsUrl(keyId);
  const apiToken = readCloudflareTurnApiToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURN_CREDENTIAL_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cloudflareTurnCredentialRequestBody()),
      signal: controller.signal,
    });
    if (response.status !== 201) {
      const error = new Error("Cloudflare TURN request was rejected");
      error.status = response.status;
      throw error;
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength != null
        && (!/^\d+$/.test(declaredLength)
        || Number(declaredLength) > P2P_TURN_RESPONSE_MAX_BYTES)) {
      throw new TypeError("Cloudflare TURN response length is invalid");
    }
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > P2P_TURN_RESPONSE_MAX_BYTES) {
      throw new TypeError("Cloudflare TURN response is too large");
    }
    const payload = JSON.parse(responseText);
    return validateCloudflareTurnCredentialResponse({
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      payload,
      now: Date.now(),
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function maybeCleanupExpiredP2pDiagnostics(now = Date.now()) {
  const maintenanceRef = realtime.ref("online/p2pMaintenance/diagnosticCleanup");
  let previousMarkerValue = null;
  let markerClaimed = false;
  try {
    const claim = await maintenanceRef.transaction((currentValue) => {
      const current = isPlainCallableObject(currentValue) ? currentValue : {};
      const lastStartedAt = Number(current.lastStartedAt);
      if (Number.isFinite(lastStartedAt)
          && lastStartedAt > 0
          && lastStartedAt + P2P_DIAGNOSTIC_CLEANUP_INTERVAL_MS > now) {
        return undefined;
      }
      previousMarkerValue = currentValue == null ? null : currentValue;
      const lastCompletedAt = Number(current.lastCompletedAt);
      const removedDayCount = Number(current.removedDayCount);
      return {
        lastStartedAt: now,
        lastCompletedAt: Number.isFinite(lastCompletedAt)
          ? Math.max(0, Math.floor(lastCompletedAt))
          : 0,
        removedDayCount: Number.isInteger(removedDayCount)
          ? Math.max(0, removedDayCount)
          : 0,
      };
    });
    markerClaimed = claim.committed
      && Number(claim.snapshot.val()?.lastStartedAt) === now;
    if (!markerClaimed) return false;

    const cutoffDay = p2pDiagnosticRetentionCutoffDay(now);
    const dayIndexSnapshot = await realtime.ref("online/p2pDiagnosticDays")
      .orderByKey()
      .endBefore(cutoffDay)
      .limitToFirst(P2P_DIAGNOSTIC_CLEANUP_MAX_DAYS * 4)
      .get();
    const indexedDayKeys = [];
    dayIndexSnapshot.forEach((snapshot) => {
      indexedDayKeys.push(snapshot.key);
    });
    const expiredDayKeys = selectExpiredP2PDiagnosticDayKeys(indexedDayKeys, {
      now,
      maximum: P2P_DIAGNOSTIC_CLEANUP_MAX_DAYS,
    });
    if (expiredDayKeys.length) {
      const removals = {};
      for (const day of expiredDayKeys) {
        removals[`online/p2pDiagnostics/${day}`] = null;
        removals[`online/p2pDiagnosticDays/${day}`] = null;
      }
      await realtime.ref().update(removals);
    }
    const completedAt = Date.now();
    await maintenanceRef.transaction((currentValue) => {
      if (Number(currentValue?.lastStartedAt) !== now) return undefined;
      return {
        lastStartedAt: now,
        lastCompletedAt: completedAt,
        removedDayCount: expiredDayKeys.length,
      };
    });
    return true;
  } catch (error) {
    if (markerClaimed) {
      try {
        await maintenanceRef.transaction((currentValue) => (
          p2pDiagnosticCleanupMarkerRollbackValue(
            currentValue,
            now,
            previousMarkerValue,
          )
        ));
      } catch (rollbackError) {
        console.warn(
          "P2P diagnostic cleanup marker rollback unavailable",
          safeP2PConnectivityError(rollbackError, "retention_cleanup"),
        );
      }
    }
    throw error;
  }
}

exports.cleanupP2pDiagnostics = onSchedule({
  schedule: "every day 03:30",
  timeZone: P2P_DIAGNOSTIC_TIME_ZONE,
}, async () => {
  try {
    await maybeCleanupExpiredP2pDiagnostics(Date.now());
  } catch (error) {
    console.warn(
      "P2P diagnostic retention cleanup unavailable",
      safeP2PConnectivityError(error, "retention_cleanup"),
    );
    throw new Error("P2P diagnostic retention cleanup failed");
  }
});

exports.getP2pIceServers = onCall(
  callableOptions("getP2pIceServers", [
    CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_API_TOKEN,
  ]),
  async (request) => {
    const uid = requireUid(request);
    requireEmptyP2pCallableData(request.data);
    await consumeP2pConnectivityRateLimit(
      uid,
      "turn",
      TURN_CREDENTIAL_RATE_LIMIT_POLICY,
    );
    try {
      const credentials = await requestCloudflareTurnIceServers();
      return {
        iceServers: credentials.iceServers,
        issuedAt: credentials.issuedAt,
        refreshAt: credentials.refreshAt,
        expiresAt: credentials.expiresAt,
      };
    } catch (error) {
      console.warn(
        "getP2pIceServers unavailable",
        safeP2PConnectivityError(error, "turn_response"),
      );
      throw new HttpsError(
        P2P_CONNECTIVITY_PUBLIC_ERROR.code,
        P2P_CONNECTIVITY_PUBLIC_ERROR.message,
      );
    }
  },
);

exports.reportP2pConnectivity = onCall(
  callableOptions("reportP2pConnectivity", [P2P_DIAGNOSTIC_HMAC_SECRET]),
  async (request) => {
    const uid = requireUid(request);
    const data = requireP2pDiagnosticCallableData(request.data);
    await requireCurrentP2pDiagnosticContext(uid, data);
    let hmacSecret;
    try {
      hmacSecret = readP2pDiagnosticHmacSecret();
    } catch (error) {
      console.warn(
        "reportP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "接続診断を送信できませんでした。");
    }
    const now = Date.now();
    let record;
    try {
      record = createP2PDiagnosticRecord({
        uid,
        sessionId: data.sessionId,
        roomId: data.roomId,
        hmacSecret,
        payload: data.diagnostic,
        now,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new HttpsError("invalid-argument", "接続診断の形式が正しくありません。");
      }
      console.warn(
        "reportP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "接続診断を送信できませんでした。");
    }
    await consumeP2pConnectivityRateLimit(
      uid,
      "diagnostic",
      P2P_DIAGNOSTIC_RATE_LIMIT_POLICY,
    );
    try {
      const eventId = realtime.ref(`online/p2pDiagnostics/${record.day}`).push().key;
      if (!eventId) throw new Error("P2P diagnostic id was not generated");
      await realtime.ref().update({
        [`online/p2pDiagnostics/${record.day}/${eventId}`]: {
          ...record,
          retentionDays: P2P_DIAGNOSTIC_RETENTION_DAYS,
          deleteAt: now + P2P_DIAGNOSTIC_RETENTION_MS,
        },
        [`online/p2pDiagnosticDays/${record.day}`]: true,
      });
    } catch (error) {
      console.warn(
        "reportP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "接続診断を送信できませんでした。");
    }
    try {
      await maybeCleanupExpiredP2pDiagnostics(now);
    } catch (error) {
      console.warn(
        "P2P diagnostic retention cleanup unavailable",
        safeP2PConnectivityError(error, "retention_cleanup"),
      );
    }
    return { accepted: true };
  },
);

exports.reportMarketP2pConnectivity = onCall(
  callableOptions("reportMarketP2pConnectivity", [P2P_DIAGNOSTIC_HMAC_SECRET]),
  async (request) => {
    const uid = requireUid(request);
    const data = requireMarketP2pDiagnosticCallableData(request.data);
    const roomSnapshot = await marketRoomRef(data.roomId).get();
    const room = roomSnapshot.data();
    if (!roomSnapshot.exists || room?.participants?.[uid] !== true) {
      throw new HttpsError("failed-precondition", "現在の推し値市場接続として確認できませんでした。");
    }
    const now = Date.now();
    let record;
    try {
      record = createP2PDiagnosticRecord({
        uid,
        sessionId: `market-${data.roomId}`,
        roomId: data.roomId,
        hmacSecret: readP2pDiagnosticHmacSecret(),
        payload: data.diagnostic,
        now,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new HttpsError("invalid-argument", "市場接続診断の形式が正しくありません。");
      }
      console.warn(
        "reportMarketP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "市場接続診断を送信できませんでした。");
    }
    await consumeP2pConnectivityRateLimit(uid, "diagnostic", P2P_DIAGNOSTIC_RATE_LIMIT_POLICY);
    try {
      const eventId = realtime.ref(`online/p2pDiagnostics/${record.day}`).push().key;
      if (!eventId) throw new Error("Market P2P diagnostic id was not generated");
      await realtime.ref().update({
        [`online/p2pDiagnostics/${record.day}/${eventId}`]: {
          ...record,
          retentionDays: P2P_DIAGNOSTIC_RETENTION_DAYS,
          deleteAt: now + P2P_DIAGNOSTIC_RETENTION_MS,
        },
        [`online/p2pDiagnosticDays/${record.day}`]: true,
      });
    } catch (error) {
      console.warn(
        "reportMarketP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "市場接続診断を送信できませんでした。");
    }
    return { accepted: true };
  },
);

exports.reportFreeTableP2pConnectivity = onCall(
  callableOptions("reportFreeTableP2pConnectivity", [P2P_DIAGNOSTIC_HMAC_SECRET]),
  async (request) => {
    const uid = requireUid(request);
    const data = requireFreeTableP2pDiagnosticCallableData(request.data);
    const now = Date.now();
    const context = await requireCurrentFreeTableP2pDiagnosticContext(uid, data, now);
    let hmacSecret;
    try {
      hmacSecret = readP2pDiagnosticHmacSecret();
    } catch (error) {
      console.warn(
        "reportFreeTableP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "自由卓接続診断を送信できませんでした。");
    }
    let record;
    try {
      record = createP2PDiagnosticRecord({
        uid,
        sessionId: `free-table-session-${context.sessionId}`,
        roomId: `free-table-session-${context.sessionId}`,
        hmacSecret,
        payload: data.diagnostic,
        now,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new HttpsError(
          "invalid-argument",
          "自由卓接続診断の形式が正しくありません。",
        );
      }
      console.warn(
        "reportFreeTableP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "自由卓接続診断を送信できませんでした。");
    }
    await consumeP2pConnectivityRateLimit(
      uid,
      "diagnostic",
      P2P_DIAGNOSTIC_RATE_LIMIT_POLICY,
    );
    try {
      const eventId = realtime.ref(`online/p2pDiagnostics/${record.day}`).push().key;
      if (!eventId) throw new Error("Free table P2P diagnostic id was not generated");
      await realtime.ref().update({
        [`online/p2pDiagnostics/${record.day}/${eventId}`]: {
          ...record,
          retentionDays: P2P_DIAGNOSTIC_RETENTION_DAYS,
          deleteAt: now + P2P_DIAGNOSTIC_RETENTION_MS,
        },
        [`online/p2pDiagnosticDays/${record.day}`]: true,
      });
    } catch (error) {
      console.warn(
        "reportFreeTableP2pConnectivity unavailable",
        safeP2PConnectivityError(error, "diagnostic_write"),
      );
      throw new HttpsError("unavailable", "自由卓接続診断を送信できませんでした。");
    }
    try {
      await maybeCleanupExpiredP2pDiagnostics(now);
    } catch (error) {
      console.warn(
        "P2P diagnostic retention cleanup unavailable",
        safeP2PConnectivityError(error, "retention_cleanup"),
      );
    }
    return { accepted: true };
  },
);

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

function anjuPayLedgerConfigRef() {
  return firestore.collection("systemConfig").doc("anjuPayLedger");
}

function anjuPayEntryRef(wallet, entryId) {
  return wallet.collection("anjuPayEntries").doc(entryId);
}

function economyProgressRef(uid) {
  return firestore.collection("economyProgress").doc(uid);
}

function trainingProfileRef(uid) {
  return firestore.collection("trainingProfiles").doc(uid);
}

function trainingClaimRef(uid, roomId) {
  return firestore.collection("trainingClaims").doc(uid).collection("rooms").doc(roomId);
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

function crownCircuitPeriodDocumentId(period, key) {
  if (!isCrownCircuitPeriod(period, key)) throw new Error("Invalid crown circuit period");
  return `${period}_${key}`;
}

function crownCircuitRunRef(uid, key) {
  return serverRankingProfileRef(uid)
    .collection("crownRuns")
    .doc(crownCircuitPeriodDocumentId("daily", key));
}

function crownCircuitPeriodRef(period, key) {
  return firestore
    .collection("crownCircuitPeriods")
    .doc(crownCircuitPeriodDocumentId(period, key));
}

function crownCircuitPeriodEntryRef(uid, period, key) {
  return crownCircuitPeriodRef(period, key)
    .collection("entries")
    .doc(uid);
}

function patronageRef(uid) {
  return firestore.collection("valueMarketPatrons").doc(uid);
}

function patronageLedgerRef(uid, actionId) {
  return firestore.collection("valueMarketPatronLedger").doc(eventId(`${uid}:${actionId}`));
}

function patronFundRef(seasonKey) {
  return firestore.collection("valueMarketPatronFunds").doc(seasonKey);
}

function patronFundContributorRef(uid, seasonKey) {
  return firestore.collection("valueMarketPatronFundContributors")
    .doc(eventId(`${seasonKey}:${uid}`));
}

function patronFundPairRef(sellerUid, buyerUid, seasonKey) {
  const participants = [sellerUid, buyerUid].sort();
  return firestore.collection("valueMarketPatronFundPairs")
    .doc(eventId(`${seasonKey}:${participants.join(":")}`));
}

function patronFundSellerImpactRef(sellerUid, seasonKey) {
  return firestore.collection("valueMarketPatronSellerImpacts")
    .doc(eventId(`${seasonKey}:${sellerUid}`));
}

function patronPolicyRef(seasonKey) {
  return firestore.collection("valueMarketPatronPolicies").doc(seasonKey);
}

function patronPolicyVoteRef(uid, seasonKey) {
  return firestore.collection("valueMarketPatronPolicyVotes")
    .doc(eventId(`${seasonKey}:${uid}`));
}

function patronPolicyVoteActionRef(uid, seasonKey, actionId) {
  return patronPolicyVoteRef(uid, seasonKey)
    .collection("actions")
    .doc(eventId(actionId));
}

function patronRecommendationProfileRef(uid, seasonKey) {
  return firestore.collection("valueMarketPatronRecommendationProfiles")
    .doc(eventId(`${seasonKey}:${uid}`));
}

function patronRecommendationSeasonRef(seasonKey) {
  return firestore.collection("valueMarketPatronRecommendationSeasons").doc(seasonKey);
}

function patronRecommendedShopRef(seasonKey, publicSellerId) {
  return patronRecommendationSeasonRef(seasonKey).collection("shops").doc(publicSellerId);
}

function verifiedMatchClaimRef(uid, mode, roomId) {
  return firestore.collection("verifiedMatchClaims").doc(eventId(`${uid}:${mode}:${roomId}`));
}

function marketMonthlyStatsRef(uid, seasonKey) {
  return firestore.collection("valueMarketMonthlyPeriods")
    .doc(seasonKey)
    .collection("entries")
    .doc(uid);
}

function marketMonthlyPairRef(sellerUid, buyerUid, seasonKey) {
  return firestore.collection("valueMarketMonthlyPairs")
    .doc(eventId(`${seasonKey}:${sellerUid}:${buyerUid}`));
}

function marketMonthlyOshijoPairRef(sellerUid, buyerUid, seasonKey) {
  return firestore.collection("valueMarketMonthlyOshijoPairs")
    .doc(eventId(`${seasonKey}:${sellerUid}:${buyerUid}`));
}

function marketRankingHonorRef(uid) {
  return firestore.collection("valueMarketRankingHonors").doc(uid);
}

function marketRankingAwardRef(uid, seasonKey, role) {
  return marketRankingHonorRef(uid)
    .collection("awards")
    .doc(eventId(`${seasonKey}:${role}`));
}

function soloProfileProjectionQueueRef(uid) {
  return firestore.collection("soloProfileProjectionQueues").doc(uid);
}

function soloProfileProjectionEnrollmentRef(uid) {
  return realtime.ref(`online/soloProfileProjectionEnrollments/${uid}`);
}

function soloProfileProjectionJobRef(uid, resultToken) {
  return soloProfileProjectionQueueRef(uid).collection("jobs").doc(resultToken);
}

function postMatchTipRef(uid, mode, roomId) {
  return firestore.collection("postMatchTips").doc(eventId(`${uid}:${mode}:${roomId}`));
}

function soloFamiliarRolloutConfigRef() {
  return firestore.collection("systemConfig").doc("soloFamiliarRollout");
}

function soloFamiliarIntentRef(uid, roomId) {
  return firestore.collection("soloFamiliarIntents").doc(soloFamiliarIntentId(uid, roomId));
}

function soloFamiliarPairRef(firstUid, secondUid) {
  return firestore.collection("soloFamiliarPairs").doc(soloFamiliarPairId(firstUid, secondUid));
}

function soloFamiliarBookRef(uid) {
  return firestore.collection("soloFamiliarBooks").doc(uid);
}

function soloFamiliarBookEntryRef(ownerUid, entryId) {
  return soloFamiliarBookRef(ownerUid)
    .collection("familiarEntries")
    .doc(entryId);
}

function soloFamiliarBlockRef(uid) {
  return firestore.collection("soloFamiliarBlocks").doc(uid);
}

function soloFamiliarBlockEntryRef(ownerUid, entryId) {
  return soloFamiliarBlockRef(ownerUid)
    .collection("blockEntries")
    .doc(entryId);
}

function soloFamiliarBlockPairRef(firstUid, secondUid) {
  return firestore.collection("soloFamiliarBlockPairs").doc(soloFamiliarPairId(firstUid, secondUid));
}

function soloFamiliarReunionRef(roomId) {
  return firestore.collection("soloFamiliarReunions").doc(eventId(`solo-reunion:${roomId}`));
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
  const competitiveRating = integer(
    source.competitiveRating ?? source.rating,
    100,
    3000,
    fallbackRating,
  );
  const competitiveMatches = integer(
    source.competitiveMatches ?? source.serverMatches,
    0,
    100_000,
    0,
  );
  const xHandle = cleanText(source.xHandle || fallback.xHandle, 15);
  const achievementShowcase = cleanText(source.achievementShowcase || fallback.achievementShowcase, 160);
  const rankingAwardTier = cleanText(source.rankingAwardTier || fallback.rankingAwardTier, 40);
  const rankingAwardUntil = Number(source.rankingAwardUntil || fallback.rankingAwardUntil || 0);
  const crownTheme = CROWN_THEMES.includes(source.crownTheme)
    ? source.crownTheme
    : CROWN_THEMES.includes(fallback.crownTheme)
      ? fallback.crownTheme
      : "rose";
  const crownSignatureId = CROWN_SIGNATURE_IDS.includes(source.crownSignatureId)
    ? source.crownSignatureId
    : CROWN_SIGNATURE_IDS.includes(fallback.crownSignatureId)
      ? fallback.crownSignatureId
      : "";
  return {
    version: SERVER_RANKING_VERSION,
    enabled: source.enabled === true,
    entryId: cleanText(source.entryId || fallback.entryId, 40),
    name: cleanName(source.name || fallback.name),
    rating: competitiveRating,
    competitiveRating,
    legacyRating: integer(source.legacyRating, 100, 3000, fallbackRating),
    serverMatches: competitiveMatches,
    competitiveMatches,
    commentsEnabled: source.commentsEnabled !== false,
    crownTheme,
    enabledAt: Number(source.enabledAt || fallback.enabledAt || 0),
    firstRatedAt: Number(source.firstRatedAt || fallback.firstRatedAt || 0),
    bestOverallRank: integer(
      source.bestOverallRank ?? fallback.bestOverallRank,
      0,
      100_000,
      0,
    ),
    updatedAt: Number(source.updatedAt || fallback.updatedAt || Date.now()),
    ...(xHandle && /^[A-Za-z0-9_]{1,15}$/.test(xHandle) ? { xHandle } : {}),
    ...(achievementShowcase ? { achievementShowcase } : {}),
    ...(crownSignatureId ? { crownSignatureId } : {}),
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
  const opponentRatings = participants.filter((candidateUid) => (
    candidateUid !== participantUid
  )).map((candidateUid) => (
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

function publicServerOverallProfile(value) {
  const profile = normalizeServerRankingProfile(value, value);
  if (!profile.enabled || !profile.entryId) return null;
  return {
    serverVerified: true,
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    name: cleanName(profile.name),
    rating: profile.rating,
    serverMatches: profile.serverMatches,
    provisional: profile.serverMatches < 10,
    commentsEnabled: profile.commentsEnabled !== false,
    crownTheme: profile.crownTheme,
    updatedAt: profile.updatedAt,
    ...(profile.xHandle ? { xHandle: profile.xHandle } : {}),
    ...(profile.achievementShowcase
      ? { achievementShowcase: profile.achievementShowcase }
      : {}),
    ...(profile.crownSignatureId
      ? { crownSignatureId: profile.crownSignatureId }
      : {}),
    ...(profile.rankingAwardTier && Number(profile.rankingAwardUntil || 0) > Date.now()
      ? {
        rankingAwardTier: profile.rankingAwardTier,
        rankingAwardLabel: profile.rankingAwardLabel,
        rankingAwardUntil: profile.rankingAwardUntil,
      }
      : {}),
  };
}

function publicCrownCircuitEntry(value) {
  if (!value || typeof value !== "object") return null;
  const period = cleanText(value.period, 16);
  const key = cleanText(value.key, 16);
  const entryId = cleanText(value.entryId, 40);
  if (!entryId || !isCrownCircuitPeriod(period, key)) return null;
  if (period === "daily") {
    const run = normalizeCrownRun(value, value);
    return {
      serverVerified: true,
      rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
      name: cleanName(run.name),
      rating: run.rating,
      status: run.status,
      matchCount: run.matchCount,
      ratingAtStart: run.ratingAtStart,
      wins: run.wins,
      losses: run.losses,
      draws: run.draws,
      modeMatches: run.modeMatches,
      crownPower: run.crownPower,
      rankScore: run.rankScore,
      uniqueOpponents: run.uniqueOpponents,
      signatureIds: run.signatureIds,
      startedAt: run.startedAt,
      commentsEnabled: run.commentsEnabled !== false,
      endsAt: run.endsAt,
      updatedAt: run.updatedAt,
      ...(run.xHandle ? { xHandle: run.xHandle } : {}),
      ...(run.achievementShowcase
        ? { achievementShowcase: run.achievementShowcase }
        : {}),
      ...(run.crownTheme ? { crownTheme: run.crownTheme } : {}),
      ...(run.crownSignatureId
        ? { crownSignatureId: run.crownSignatureId }
        : {}),
      ...(run.rank
        ? {
          rank: run.rank,
          participantCount: run.participantCount,
          starScore: run.starScore,
          finalizedAt: run.finalizedAt,
        }
        : {}),
    };
  }
  return {
    serverVerified: true,
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    name: cleanName(value.name),
    rating: integer(value.rating, 100, 3000, 1000),
    circuitScore: integer(value.circuitScore, 0, 300, 0),
    rankScore: integer(value.rankScore, 0, 300, 0),
    bestCrownPower: integer(value.bestCrownPower, 100, 3000, 100),
    qualifyingCount: period === "weekly"
      ? integer(value.qualifyingDays, 0, 7, 0)
      : integer(value.qualifyingWeeks, 0, 6, 0),
    commentsEnabled: value.commentsEnabled !== false,
    endsAt: Number(value.endsAt || 0),
    updatedAt: Number(value.updatedAt || 0),
    ...(value.xHandle ? { xHandle: cleanText(value.xHandle, 15) } : {}),
    ...(value.achievementShowcase
      ? { achievementShowcase: cleanText(value.achievementShowcase, 160) }
      : {}),
    ...(CROWN_THEMES.includes(value.crownTheme)
      ? { crownTheme: value.crownTheme }
      : {}),
    ...(CROWN_SIGNATURE_IDS.includes(value.crownSignatureId)
      ? { crownSignatureId: value.crownSignatureId }
      : {}),
    ...(Number(value.rank || 0) > 0
      ? {
        rank: integer(value.rank, 1, 100_000, 100_000),
        participantCount: integer(value.participantCount, 1, 100_000, 1),
        starScore: integer(value.starScore, 0, 100, 0),
        finalizedAt: Number(value.finalizedAt || 0),
      }
      : {}),
  };
}

async function mirrorServerOverallProfiles(profilesByUid) {
  const updates = {};
  Object.entries(profilesByUid || {}).forEach(([uid, value]) => {
    const profile = normalizeServerRankingProfile(value, value);
    if (!profile.entryId) return;
    updates[`online/serverOverallLeaderboard/${profile.entryId}`] = profile.enabled
      ? publicServerOverallProfile(profile)
      : null;
    if (profile.enabled) {
      updates[`online/serverOverallLeaderboardEntriesByUser/${uid}`] = profile.entryId;
    } else {
      updates[`online/serverOverallLeaderboardEntriesByUser/${uid}`] = null;
    }
  });
  if (Object.keys(updates).length) await realtime.ref().update(updates);
}

async function mirrorCrownCircuitEntries(entriesByUid) {
  const updates = {};
  Object.entries(entriesByUid || {}).forEach(([uid, entries]) => {
    Object.values(entries || {}).forEach((entry) => {
      const publicSource = { ...entry };
      // Period history proves the result, but does not permanently retain an
      // external account. X promotion lives only in the expiring spotlight.
      if (entry.status === "finalized") delete publicSource.xHandle;
      const publicEntry = publicCrownCircuitEntry(publicSource);
      if (!publicEntry || !entry.entryId) return;
      const hidden = Number(entry.withdrawnAt || 0) > 0
        || (entry.status === "finalized" && !Number(entry.rank || 0));
      updates[`online/crownCircuitPeriods/${entry.period}/${entry.key}/${entry.entryId}`] = hidden
        ? null
        : publicEntry;
      updates[`online/crownCircuitPeriodEntriesByUser/${uid}/${entry.period}/${entry.key}`] = hidden
        ? null
        : entry.entryId;
    });
  });
  if (Object.keys(updates).length) await realtime.ref().update(updates);
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
    rating: 1000,
    competitiveRating: 1000,
    legacyRating: integer(publicValue.rating, 100, 3000, 1000),
    serverMatches: 0,
    competitiveMatches: 0,
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
    trainingSets: 0,
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
    trainingSets: 1,
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
        variantMatches: {
          teamDuo: integer(source?.variantMatches?.teamDuo, 0, matches, 0),
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
    schemaVersion: 3,
    daily: normalizeDaily(value?.daily, dateKey),
    periodRewards,
    dailyPlayClaims: normalizeDailyPlayClaims(value?.dailyPlayClaims, periodRewards),
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

function anjuPayLedgerEnabled(configSnapshot) {
  if (!configSnapshot.exists) return false;
  const activatedAt = configSnapshot.get("activatedAt");
  const activatedAtMillis = typeof activatedAt?.toMillis === "function"
    ? Number(activatedAt.toMillis())
    : Number(activatedAt || 0);
  return Number.isFinite(activatedAtMillis) && activatedAtMillis > 0;
}

function requireAnjuPayLedgerMode(configSnapshot, walletState) {
  const decision = anjuPayLedgerModeDecision({
    configExists: configSnapshot.exists,
    enabledFlag: configSnapshot.exists && configSnapshot.get("enabled") === true,
    markerActive: anjuPayLedgerEnabled(configSnapshot),
    ledgerRequired: ANJU_PAY_LEDGER_REQUIRED.value(),
    walletActive: isAnjuPayWalletActive(walletState),
  });
  if (decision.allowed) return decision.enabled;
  const messages = {
    "missing-config": "AnjuPay台帳設定を確認できないため、残高操作を一時停止しています。",
    "incomplete-marker": "AnjuPay台帳の有効化マーカーが不完全なため、残高操作を一時停止しています。",
    "ledger-required": "AnjuPay台帳が必須のため、残高操作を一時停止しています。",
    "wallet-mismatch": "AnjuPay台帳の有効化状態が一致しないため、残高操作を一時停止しています。",
  };
  throw new HttpsError("unavailable", messages[decision.reason] || messages["missing-config"]);
}

function anjuPayWalletMetadataPatch(wallet) {
  if (!isAnjuPayWalletActive(wallet)) return {};
  return {
    ledgerVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
    historyStartedAt: Number(wallet.historyStartedAt),
    ledgerSequence: Number(wallet.ledgerSequence),
  };
}

function stageAnjuPayOpening(transaction, wallet, walletState, configSnapshot, occurredAt) {
  if (!requireAnjuPayLedgerMode(configSnapshot, walletState)) return false;
  const activation = activateAnjuPayWallet(walletState, occurredAt);
  if (!activation.activated) return false;
  Object.assign(walletState, activation.walletPatch);
  transaction.create(
    anjuPayEntryRef(wallet, ANJU_PAY_OPENING_ENTRY_ID),
    activation.openingEntry,
  );
  return true;
}

function appendAnjuPayEntry(transaction, wallet, walletState, configSnapshot, value) {
  if (!requireAnjuPayLedgerMode(configSnapshot, walletState)) return null;
  const next = nextAnjuPayEntry(walletState, value);
  Object.assign(walletState, next.walletPatch);
  transaction.create(anjuPayEntryRef(wallet, next.entryId), next.entry);
  return next.entry;
}

function persistAnjuPayOpening(transaction, wallet, walletState, activated, occurredAt) {
  if (!activated) return;
  transaction.update(wallet, {
    ...anjuPayWalletMetadataPatch(walletState),
    updatedAt: occurredAt,
  });
}

function anjuPayRewardStatus(credited, nominal) {
  if (credited <= 0) return "capped";
  if (credited < nominal) return "partial";
  return "posted";
}

async function ensureWallet(uid, legacyEconomy = null) {
  const ref = walletRef(uid);
  const existing = await ref.get();
  const legacy = existing.exists ? {} : (legacyEconomy || await readLegacyEconomy(uid));
  let balance = 0;
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, ledgerConfigSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(anjuPayLedgerConfigRef()),
    ]);
    const now = Date.now();
    if (snapshot.exists) {
      balance = safeBalance(snapshot.get("balance"));
      const walletState = walletData(snapshot);
      const activated = stageAnjuPayOpening(
        transaction,
        ref,
        walletState,
        ledgerConfigSnapshot,
        now,
      );
      persistAnjuPayOpening(transaction, ref, walletState, activated, now);
      return;
    }
    balance = safeBalance(legacy.points);
    const walletState = {
      balance,
      reservedIncoming: 0,
      initializedAt: Date.now(),
      migratedFromRealtimeDatabase: true,
      updatedAt: now,
    };
    stageAnjuPayOpening(transaction, ref, walletState, ledgerConfigSnapshot, now);
    transaction.create(ref, {
      ...walletState,
      ...anjuPayWalletMetadataPatch(walletState),
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
      || Number(progressData.schemaVersion || 0) < 3
      || !progressData.achievementStats
      || !progressData.dailyPlayClaims) {
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

async function syncCurrentCrownCircuitMetadata(uid, profileValue) {
  const profile = normalizeServerRankingProfile(profileValue, profileValue);
  if (!profile.enabled || !profile.entryId) return {};
  const now = Date.now();
  const infos = SERVER_RANKING_PERIODS
    .map((period) => ({ period, key: periodKey(period, now) }))
    .filter(({ period, key }) => isCrownCircuitPeriod(period, key));
  const periodRefs = infos.map(({ period, key }) => (
    crownCircuitPeriodEntryRef(uid, period, key)
  ));
  const dailyInfo = infos.find(({ period }) => period === "daily");
  const refs = [
    ...periodRefs,
    ...(dailyInfo ? [crownCircuitRunRef(uid, dailyInfo.key)] : []),
  ];
  const snapshots = refs.length ? await firestore.getAll(...refs) : [];
  const entries = {};
  const batch = firestore.batch();
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const info = index < infos.length ? infos[index] : dailyInfo;
    if (!info) return;
    const metadata = {
      name: profile.name,
      rating: profile.rating,
      commentsEnabled: profile.commentsEnabled !== false,
      crownTheme: profile.crownTheme,
      xHandle: profile.xHandle || FieldValue.delete(),
      achievementShowcase: profile.achievementShowcase || FieldValue.delete(),
      crownSignatureId: profile.crownSignatureId || FieldValue.delete(),
      updatedAt: now,
    };
    batch.set(snapshot.ref, metadata, { merge: true });
    const entry = {
      ...snapshot.data(),
      name: profile.name,
      rating: profile.rating,
      commentsEnabled: profile.commentsEnabled !== false,
      crownTheme: profile.crownTheme,
      updatedAt: now,
    };
    if (profile.xHandle) entry.xHandle = profile.xHandle;
    else delete entry.xHandle;
    if (profile.achievementShowcase) entry.achievementShowcase = profile.achievementShowcase;
    else delete entry.achievementShowcase;
    if (profile.crownSignatureId) entry.crownSignatureId = profile.crownSignatureId;
    else delete entry.crownSignatureId;
    entries[`${info.period}:${info.key}`] = entry;
  });
  if (Object.keys(entries).length) {
    await batch.commit();
    await mirrorCrownCircuitEntries({ [uid]: entries });
  }
  return entries;
}

async function syncRankingSpotlightConsent(profileValue) {
  const profile = normalizeServerRankingProfile(profileValue, profileValue);
  if (!profile.entryId) return;
  const spotlightRef = realtime.ref("online/rankingSpotlights/current");
  await spotlightRef.transaction((current) => {
    if (!current
        || cleanText(current.entryId, 40) !== profile.entryId) {
      return undefined;
    }
    if (!profile.enabled || !profile.xHandle) return null;
    const next = {
      ...current,
      name: profile.name,
      xHandle: profile.xHandle,
      crownTheme: profile.crownTheme,
    };
    if (profile.crownSignatureId) next.crownSignatureId = profile.crownSignatureId;
    else delete next.crownSignatureId;
    if (profile.achievementShowcase) next.achievementShowcase = profile.achievementShowcase;
    else delete next.achievementShowcase;
    return next;
  });
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

  const [indexSnapshot, overallIndexSnapshot, crownIndexSnapshot, spotlightSnapshot] = await Promise.all([
    realtime.ref(`online/serverLeaderboardPeriodEntriesByUser/${uid}`).get(),
    realtime.ref(`online/serverOverallLeaderboardEntriesByUser/${uid}`).get(),
    realtime.ref(`online/crownCircuitPeriodEntriesByUser/${uid}`).get(),
    realtime.ref("online/rankingSpotlights/current").get(),
  ]);
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
  const overallEntryId = cleanText(overallIndexSnapshot.val(), 40);
  if (overallEntryId) {
    updates[`online/serverOverallLeaderboard/${overallEntryId}`] = null;
    updates[`online/serverOverallLeaderboardEntriesByUser/${uid}`] = null;
    if (cleanText(spotlightSnapshot.child("entryId").val(), 40) === overallEntryId) {
      updates["online/rankingSpotlights/current"] = null;
    }
  }
  const crownIndex = objectValue(crownIndexSnapshot.val());
  const crownWithdrawals = [];
  for (const [period, keys] of Object.entries(crownIndex)) {
    if (!SERVER_RANKING_PERIODS.includes(period)) continue;
    for (const [key, entryId] of Object.entries(objectValue(keys))) {
      if (!isCrownCircuitPeriod(period, key)) continue;
      const cleanEntryId = cleanText(entryId, 40);
      if (!cleanEntryId || periodEndsAt(period, key) <= timestamp) continue;
      updates[`online/crownCircuitPeriods/${period}/${key}/${cleanEntryId}`] = null;
      updates[`online/crownCircuitPeriodEntriesByUser/${uid}/${period}/${key}`] = null;
      crownWithdrawals.push(
        crownCircuitPeriodEntryRef(uid, period, key).set({
          withdrawnAt: timestamp,
          updatedAt: timestamp,
        }, { merge: true }),
      );
      if (period === "daily") {
        crownWithdrawals.push(crownCircuitRunRef(uid, key).set({
          withdrawnAt: timestamp,
          updatedAt: timestamp,
        }, { merge: true }));
      }
    }
  }
  if (crownWithdrawals.length) await Promise.all(crownWithdrawals);
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
    const disabledProfile = normalizeServerRankingProfile((await profileRef.get()).data(), {
      enabled: false,
    });
    await Promise.all([
      removeServerRankingPublicEntries(uid, now),
      syncRankingSpotlightConsent(disabledProfile),
    ]);
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
      savedProfile.rating = 1000;
      savedProfile.competitiveRating = 1000;
      savedProfile.legacyRating = integer(publicValue.rating, 100, 3000, 1000);
      savedProfile.serverMatches = 0;
      savedProfile.competitiveMatches = 0;
    }
    const xHandle = cleanText(publicValue.xHandle, 15);
    if (xHandle && /^[A-Za-z0-9_]{1,15}$/.test(xHandle)) savedProfile.xHandle = xHandle;
    else delete savedProfile.xHandle;
    transaction.set(profileRef, savedProfile);
  });
  const awards = await finalizeServerRankingAwards(uid, now);
  const finalizedProfile = normalizeServerRankingProfile((await profileRef.get()).data(), savedProfile);
  await Promise.all([
    syncCurrentServerRankingMetadata(uid, finalizedProfile),
    syncCurrentCrownCircuitMetadata(uid, finalizedProfile),
    mirrorServerOverallProfiles({ [uid]: finalizedProfile }),
    syncRankingSpotlightConsent(finalizedProfile),
  ]);
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
    const profile = normalizeServerRankingProfile(profileSnapshot.data(), profileSnapshot.data());
    await Promise.all([
      syncCurrentServerRankingMetadata(uid, profile),
      syncCurrentCrownCircuitMetadata(uid, profile),
      mirrorServerOverallProfiles({ [uid]: profile }),
      syncRankingSpotlightConsent(profile),
    ]);
  }
  return {
    awards,
  };
}

function crownSignatureIdsFromAward(value) {
  const tier = cleanText(value?.tier, 40);
  if (tier === "daily_champion") return ["daily_champion"];
  if (tier === "weekly_champion") return ["weekly_champion"];
  if (tier === "monthly_champion") return ["monthly_champion"];
  return [];
}

async function loadCrownCustomizationOptions(uid) {
  const [runsSnapshot, awardsSnapshot] = await Promise.all([
    serverRankingProfileRef(uid)
      .collection("crownRuns")
      .orderBy("updatedAt", "desc")
      .limit(90)
      .get(),
    serverRankingProfileRef(uid)
      .collection("awards")
      .orderBy("awardedAt", "desc")
      .limit(90)
      .get(),
  ]);
  const signatures = new Set();
  let completedRun = false;
  let topThreeAward = false;
  let championAward = false;
  runsSnapshot.docs.forEach((snapshot) => {
    if (Number(snapshot.get("matchCount") || 0) >= CROWN_DAILY_MATCH_LIMIT) {
      completedRun = true;
    }
    normalizeSignatureIds(snapshot.get("signatureIds")).forEach((id) => signatures.add(id));
  });
  awardsSnapshot.docs.forEach((snapshot) => {
    const award = snapshot.data();
    const rank = Number(award?.rank || 0);
    const participants = Number(award?.participantCount || 0);
    if (participants >= 2 && rank > 0 && rank <= 3) topThreeAward = true;
    if (crownSignatureIdsFromAward(award).length) championAward = true;
    crownSignatureIdsFromAward(award).forEach((id) => signatures.add(id));
  });
  const availableThemes = ["rose"];
  if (completedRun) availableThemes.push("aqua");
  if (topThreeAward) availableThemes.push("violet");
  if (championAward) availableThemes.push("gold");
  return {
    availableThemes,
    availableSignatureIds: [...signatures],
  };
}

function compareServerOverallProfiles(first, second) {
  return Number(second.rating || 0) - Number(first.rating || 0)
    || String(first.entryId || "").localeCompare(String(second.entryId || ""));
}

async function getRankingDashboard(uid) {
  const now = Date.now();
  const dailyKey = periodKey("daily", now);
  const runRef = isCrownCircuitPeriod("daily", dailyKey)
    ? crownCircuitRunRef(uid, dailyKey)
    : null;
  const [profileSnapshot, runSnapshot, publicProfilesSnapshot, customization, spotlightSnapshot] = await Promise.all([
    serverRankingProfileRef(uid).get(),
    runRef ? runRef.get() : Promise.resolve(null),
    firestore.collection("serverRankingProfiles")
      .where("enabled", "==", true)
      .limit(2_000)
      .get(),
    loadCrownCustomizationOptions(uid),
    realtime.ref("online/rankingSpotlights/current").get(),
  ]);
  const profile = normalizeServerRankingProfile(profileSnapshot.data(), {
    rating: 1000,
    updatedAt: now,
  });
  const rankedProfiles = publicProfilesSnapshot.docs
    .map((snapshot) => {
      const publicProfile = publicServerOverallProfile(snapshot.data());
      if (!publicProfile) return null;
      return {
        ...publicProfile,
        entryId: cleanText(snapshot.get("entryId"), 40),
        ownerUid: snapshot.id,
      };
    })
    .filter((entry) => entry?.entryId)
    .sort(compareServerOverallProfiles);
  const ownIndex = rankedProfiles.findIndex((entry) => entry.ownerUid === uid);
  const rank = ownIndex >= 0 ? ownIndex + 1 : 0;
  const participantCount = rankedProfiles.length;
  const bestRank = rank
    ? (profile.bestOverallRank ? Math.min(profile.bestOverallRank, rank) : rank)
    : profile.bestOverallRank;
  if (rank && bestRank !== profile.bestOverallRank) {
    await serverRankingProfileRef(uid).set({
      bestOverallRank: bestRank,
    }, { merge: true });
  }
  const ownRating = ownIndex >= 0 ? rankedProfiles[ownIndex].rating : profile.rating;
  const nextSeatGap = ownIndex > 0
    ? Math.max(1, rankedProfiles[ownIndex - 1].rating - ownRating + 1)
    : 0;
  const publicRow = (entry, index) => {
    if (!entry) return null;
    const { ownerUid, ...publicEntry } = entry;
    return { ...publicEntry, rank: index + 1 };
  };
  const neighborStart = ownIndex >= 0 ? Math.max(0, ownIndex - 3) : 0;
  const neighborEnd = ownIndex >= 0
    ? Math.min(participantCount, ownIndex + 4)
    : Math.min(participantCount, 7);
  const crownRun = runSnapshot?.exists
    ? publicCrownCircuitEntry(runSnapshot.data())
    : null;
  return {
    enabled: profile.enabled,
    entryId: profile.entryId,
    profile: {
      rating: profile.rating,
      serverMatches: profile.serverMatches,
      provisional: profile.serverMatches < 10,
    },
    overall: {
      rank,
      participantCount,
      percentile: rank && participantCount
        ? Math.round((100 * (participantCount - rank + 1)) / participantCount)
        : 0,
      topPercent: rank && participantCount
        ? Math.max(1, Math.ceil((100 * rank) / participantCount))
        : 0,
      bestRank,
      rating: ownRating,
      nextSeatGap,
      top: rankedProfiles.slice(0, 50).map(publicRow),
      neighbors: rankedProfiles.slice(neighborStart, neighborEnd)
        .map((entry, offset) => publicRow(entry, neighborStart + offset)),
    },
    crownRun,
    customization: {
      crownTheme: profile.crownTheme,
      crownSignatureId: profile.crownSignatureId || "",
      ...customization,
    },
    rules: {
      rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
      modes: [...CROWN_CIRCUIT_MODES],
      dailyMatchLimit: CROWN_DAILY_MATCH_LIMIT,
      weeklyBestDays: CROWN_WEEKLY_BEST_DAYS,
      weeklyMinimumDays: CROWN_WEEKLY_MIN_DAYS,
      monthlyBestWeeks: CROWN_MONTHLY_BEST_WEEKS,
      monthlyMinimumWeeks: CROWN_MONTHLY_MIN_WEEKS,
      promotionMinimumParticipants: CROWN_PROMOTION_MIN_PARTICIPANTS,
      dailyKey,
      dailyEndsAt: periodEndsAt("daily", dailyKey),
    },
    spotlight: spotlightSnapshot.exists
      && Number(spotlightSnapshot.child("endsAt").val() || 0) > now
      ? objectValue(spotlightSnapshot.val())
      : null,
  };
}

async function startRankingCrownRun(uid, data) {
  const now = Date.now();
  const key = periodKey("daily", now);
  if (!isCrownCircuitPeriod("daily", key)) {
    throw new HttpsError("failed-precondition", "今日の王座戦は開始日前です。");
  }
  const expectedKey = cleanText(data?.dateKey, 16);
  if (expectedKey && expectedKey !== key) {
    throw new HttpsError("failed-precondition", "日付が変わりました。ランキングを更新してください。");
  }
  const profileRef = serverRankingProfileRef(uid);
  const runRef = crownCircuitRunRef(uid, key);
  const periodEntryRef = crownCircuitPeriodEntryRef(uid, "daily", key);
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const [profileSnapshot, runSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(runRef),
    ]);
    const profile = normalizeServerRankingProfile(profileSnapshot.data(), {
      updatedAt: now,
    });
    if (!profile.enabled || !profile.entryId) {
      throw new HttpsError(
        "failed-precondition",
        "王座戦に挑む前に、オンラインランキングを公開してください。",
      );
    }
    result = startCrownRun(runSnapshot.data(), {
      key,
      entryId: profile.entryId,
      profile,
      endsAt: periodEndsAt("daily", key),
      now,
    });
    if (result.started) {
      transaction.create(runRef, result.run);
      transaction.set(periodEntryRef, result.run);
    }
  });
  await crownCircuitPeriodRef("daily", key).set({
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    period: "daily",
    key,
    status: "open",
    endsAt: periodEndsAt("daily", key),
    updatedAt: now,
  }, { merge: true });
  await mirrorCrownCircuitEntries({
    [uid]: { [`daily:${key}`]: result.run },
  });
  return {
    started: result.started,
    crownRun: publicCrownCircuitEntry(result.run),
  };
}

async function setCrownCustomization(uid, data) {
  const crownTheme = cleanText(data?.crownTheme, 16);
  const crownSignatureId = cleanText(data?.crownSignatureId, 40);
  if (!CROWN_THEMES.includes(crownTheme)) {
    throw new HttpsError("invalid-argument", "王冠テーマを確認できませんでした。");
  }
  const options = await loadCrownCustomizationOptions(uid);
  if (!options.availableThemes.includes(crownTheme)) {
    throw new HttpsError("failed-precondition", "まだ獲得していない王冠テーマです。");
  }
  if (crownSignatureId && !options.availableSignatureIds.includes(crownSignatureId)) {
    throw new HttpsError("failed-precondition", "まだ獲得していないSIGNATUREです。");
  }
  const now = Date.now();
  const profileRef = serverRankingProfileRef(uid);
  const profileSnapshot = await profileRef.get();
  if (!profileSnapshot.exists) {
    throw new HttpsError("failed-precondition", "ランキングプロフィールがありません。");
  }
  await profileRef.set({
    crownTheme,
    crownSignatureId: crownSignatureId || FieldValue.delete(),
    updatedAt: now,
  }, { merge: true });
  const profile = normalizeServerRankingProfile((await profileRef.get()).data(), {
    crownTheme,
    crownSignatureId,
  });
  const periodInfos = SERVER_RANKING_PERIODS
    .map((period) => ({ period, key: periodKey(period, now) }))
    .filter(({ period, key }) => isCrownCircuitPeriod(period, key));
  const entryRefs = periodInfos.map(({ period, key }) => (
    crownCircuitPeriodEntryRef(uid, period, key)
  ));
  const runRef = isCrownCircuitPeriod("daily", periodKey("daily", now))
    ? crownCircuitRunRef(uid, periodKey("daily", now))
    : null;
  const refs = [...entryRefs, ...(runRef ? [runRef] : [])];
  const snapshots = refs.length ? await firestore.getAll(...refs) : [];
  const batch = firestore.batch();
  const mirroredEntries = {};
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const source = {
      ...snapshot.data(),
      crownTheme,
      updatedAt: now,
    };
    if (crownSignatureId) source.crownSignatureId = crownSignatureId;
    else delete source.crownSignatureId;
    batch.set(snapshot.ref, {
      crownTheme,
      crownSignatureId: crownSignatureId || FieldValue.delete(),
      updatedAt: now,
    }, { merge: true });
    const info = index < periodInfos.length
      ? periodInfos[index]
      : { period: "daily", key: periodKey("daily", now) };
    mirroredEntries[`${info.period}:${info.key}`] = source;
  });
  if (Object.keys(mirroredEntries).length) await batch.commit();
  await Promise.all([
    mirrorServerOverallProfiles({ [uid]: profile }),
    mirrorCrownCircuitEntries({ [uid]: mirroredEntries }),
    syncRankingSpotlightConsent(profile),
  ]);
  return {
    customization: {
      crownTheme,
      crownSignatureId,
      ...options,
    },
  };
}

async function getAchievements(uid, { syncPublic = false } = {}) {
  const state = await ensureAchievementState(uid);
  if (syncPublic) await syncAchievementPublicSurfaces(uid, state.profile);
  return publicAchievementProfile(state.profile, state.progress.achievementStats, state.marketStats);
}

function isCreatorCardEntryId(value) {
  return /^[-0-9A-Z_a-z]{16,40}$/.test(String(value || ""));
}

function creatorCardGrowthFromState(achievementState) {
  return creatorCardGrowthLevel(creatorCardActivityCount(
    achievementState?.progress?.achievementStats,
    achievementState?.marketStats,
  ));
}

async function ensureCreatorCardEntryId(uid) {
  const indexRef = realtime.ref(`online/topMessageEntriesByUser/${uid}`);
  const proposedEntryId = realtime.ref("online/topMessages").push().key;
  if (!isCreatorCardEntryId(proposedEntryId)) {
    throw new HttpsError("internal", "推しカードの公開枠を準備できませんでした。");
  }
  const result = await indexRef.transaction((current) => (
    isCreatorCardEntryId(current) ? current : proposedEntryId
  ));
  const entryId = String(result.snapshot.val() || "");
  if (!result.committed || !isCreatorCardEntryId(entryId)) {
    throw new HttpsError("internal", "推しカードの公開枠を確認できませんでした。");
  }
  const ownerRef = realtime.ref(`online/topMessageOwners/${entryId}`);
  const ownerSnapshot = await ownerRef.get();
  if (ownerSnapshot.exists() && String(ownerSnapshot.val() || "") !== uid) {
    throw new HttpsError("failed-precondition", "推しカードの所有情報を確認できませんでした。");
  }
  if (!ownerSnapshot.exists()) await ownerRef.set(uid);
  return entryId;
}

function creatorCardInputName(value) {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "表示名は1行16文字以内で入力してください。");
  }
  const raw = value.trim();
  if (!raw || raw.length > 16 || /[\r\n]/.test(raw)) {
    throw new HttpsError("invalid-argument", "表示名は1行16文字以内で入力してください。");
  }
  return raw;
}

function creatorCardInputText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!isValidCreatorCardText(text)) {
    throw new HttpsError(
      "invalid-argument",
      `紹介文はURL・メールアドレスを含まない1行${CREATOR_CARD_TEXT_MAX_LENGTH}文字以内で入力してください。`,
    );
  }
  return text;
}

async function publishCreatorCard(uid, data) {
  const name = creatorCardInputName(data?.name);
  const text = creatorCardInputText(data?.text);
  const creatorType = data?.creatorType;
  if (typeof creatorType !== "string" || !CREATOR_CARD_TYPES.includes(creatorType)) {
    throw new HttpsError("invalid-argument", "活動札を選び直してください。");
  }
  const cardTheme = data?.cardTheme;
  if (!isCreatorCardTheme(cardTheme)) {
    throw new HttpsError("invalid-argument", "カードテーマを選び直してください。");
  }
  if (data?.xHandle != null && typeof data.xHandle !== "string") {
    throw new HttpsError("invalid-argument", "Xのユーザー名は英数字と_の15文字以内で入力してください。");
  }
  const rawXHandle = String(data?.xHandle || "").trim().replace(/^@+/, "");
  const xHandle = normalizeCreatorCardXHandle(rawXHandle);
  if (rawXHandle && !xHandle) {
    throw new HttpsError("invalid-argument", "Xのユーザー名は英数字と_の15文字以内で入力してください。");
  }
  if (!Array.isArray(data?.achievementIds) || data.achievementIds.length > 3) {
    throw new HttpsError("invalid-argument", "カードへ飾る実績は3件まで選んでください。");
  }
  if (!data.achievementIds.every((id) => typeof id === "string")) {
    throw new HttpsError("invalid-argument", "カードへ飾る実績を選び直してください。");
  }
  const rawAchievementIds = data.achievementIds;
  const [achievementState, economy] = await Promise.all([
    ensureAchievementState(uid),
    readLegacyEconomy(uid),
  ]);
  const premiumOwned = economy.inventory?.[CREATOR_CARD_PREMIUM_PRODUCT_ID] === true;
  if (isPremiumCreatorCardTheme(cardTheme) && !premiumOwned) {
    throw new HttpsError("failed-precondition", "プレミアム仕上げを先に解放してください。");
  }
  const selectedAchievementIds = sanitizeAchievementIds(rawAchievementIds, {
    unlocked: achievementState.profile.unlocked,
  });
  if (selectedAchievementIds.length !== rawAchievementIds.length) {
    throw new HttpsError("failed-precondition", "未解除の実績はカードへ飾れません。");
  }
  const equippedTitleId = String(economy.equipped?.title || "");
  const titleId = economy.inventory?.[equippedTitleId] === true
    && PRODUCT_CATALOG[equippedTitleId]?.type === "title"
    ? equippedTitleId
    : "";
  const now = Date.now();
  const record = {
    schemaVersion: CREATOR_CARD_VERSION,
    name,
    titleId,
    text,
    creatorType,
    cardTheme,
    growthLevel: creatorCardGrowthFromState(achievementState),
    achievementShowcase: selectedAchievementIds.join(","),
    updatedAt: now,
    ...(xHandle ? { xHandle } : {}),
  };
  const entryId = await ensureCreatorCardEntryId(uid);
  const cardRef = realtime.ref(`online/topMessages/${entryId}`);
  let rateLimited = false;
  const publishResult = await cardRef.transaction((current) => {
    const previousUpdatedAt = Number(current?.updatedAt || 0);
    if (
      previousUpdatedAt > 0
      && now - previousUpdatedAt < CREATOR_CARD_PUBLISH_COOLDOWN_MS
    ) {
      rateLimited = true;
      return undefined;
    }
    return Number(current?.schemaVersion || 0) === CREATOR_CARD_VERSION
      ? {
        ...record,
        growthLevel: Math.max(
          record.growthLevel,
          Number(current?.growthLevel || 1),
        ),
      }
      : record;
  });
  if (!publishResult.committed) {
    if (rateLimited) {
      throw new HttpsError(
        "resource-exhausted",
        "推しカードは15秒ほど待ってからもう一度更新してください。",
      );
    }
    throw new HttpsError("internal", "推しカードを公開できませんでした。");
  }
  return {
    saved: true,
    entryId,
    card: publishResult.snapshot.val() || record,
  };
}

async function deleteCreatorCard(uid) {
  const entryId = String((await realtime.ref(`online/topMessageEntriesByUser/${uid}`).get()).val() || "");
  if (!isCreatorCardEntryId(entryId)) return { deleted: false };
  const owner = String((await realtime.ref(`online/topMessageOwners/${entryId}`).get()).val() || "");
  if (owner !== uid) {
    throw new HttpsError("failed-precondition", "推しカードの所有情報を確認できませんでした。");
  }
  await realtime.ref(`online/topMessages/${entryId}`).remove();
  return { deleted: true, entryId };
}

async function syncCreatorCardGrowth(uid, achievementStateValue = null) {
  const entryId = String((await realtime.ref(`online/topMessageEntriesByUser/${uid}`).get()).val() || "");
  if (!isCreatorCardEntryId(entryId)) return false;
  const owner = String((await realtime.ref(`online/topMessageOwners/${entryId}`).get()).val() || "");
  if (owner !== uid) return false;
  const achievementState = achievementStateValue || await ensureAchievementState(uid);
  const growthLevel = creatorCardGrowthFromState(achievementState);
  let changed = false;
  const result = await realtime.ref(`online/topMessages/${entryId}`).transaction((current) => {
    changed = false;
    if (!current || Number(current.schemaVersion || 0) !== CREATOR_CARD_VERSION) {
      return undefined;
    }
    const nextGrowthLevel = Math.max(Number(current.growthLevel || 1), growthLevel);
    if (Number(current.growthLevel || 0) === nextGrowthLevel) return current;
    changed = true;
    return {
      ...current,
      growthLevel: nextGrowthLevel,
    };
  });
  return result.committed && changed;
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

function normalizePatronFundContributor(value, uid, seasonKey) {
  const sameOwner = value?.uid === uid && value?.seasonKey === seasonKey;
  return {
    uid,
    seasonKey,
    recognizedSpent: sameOwner
      ? integer(value?.recognizedSpent, 0, PATRON_TIERS.at(-1).threshold, 0)
      : 0,
    contributionAmount: sameOwner
      ? integer(value?.contributionAmount, 0, PATRON_TIERS.at(-1).threshold, 0)
      : 0,
    burnAmount: sameOwner
      ? integer(value?.burnAmount, 0, PATRON_TIERS.at(-1).threshold, 0)
      : 0,
    updatedAt: sameOwner ? Number(value?.updatedAt || 0) : 0,
  };
}

function normalizePatronPolicy(value, seasonKey) {
  const sameSeason = value?.seasonKey === seasonKey;
  const votes = Object.fromEntries(MARKET_POLICY_IDS.map((policyId) => [
    policyId,
    sameSeason ? integer(value?.votes?.[policyId], 0, 1_000_000, 0) : 0,
  ]));
  let activePolicy = "balanced";
  for (const policyId of MARKET_POLICY_IDS) {
    if (votes[policyId] > votes[activePolicy]) activePolicy = policyId;
  }
  return {
    seasonKey,
    activePolicy,
    votes,
    totalVotes: Object.values(votes).reduce((sum, count) => sum + count, 0),
    updatedAt: sameSeason ? Number(value?.updatedAt || 0) : 0,
  };
}

function normalizePatronRecommendationProfile(value, uid, seasonKey) {
  const sameOwner = value?.uid === uid && value?.seasonKey === seasonKey;
  const source = sameOwner && Array.isArray(value?.recommendations)
    ? value.recommendations
    : [];
  const recommendations = [];
  const seen = new Set();
  for (const entry of source) {
    const publicSellerId = cleanText(entry?.publicSellerId, 40);
    if (!isValidPublicSellerId(publicSellerId) || seen.has(publicSellerId)) continue;
    seen.add(publicSellerId);
    recommendations.push({
      publicSellerId,
      recommendedAt: Number(entry?.recommendedAt || 0),
    });
    if (recommendations.length >= PATRON_TIERS.at(-1).level) break;
  }
  return {
    uid,
    seasonKey,
    recommendations,
    updatedAt: sameOwner ? Number(value?.updatedAt || 0) : 0,
  };
}

function normalizePatronSellerImpact(value, sellerUid, seasonKey) {
  const sameSeller = value?.sellerUid === sellerUid && value?.seasonKey === seasonKey;
  return {
    sellerUid,
    seasonKey,
    totalSubsidized: sameSeller
      ? integer(value?.totalSubsidized, 0, PATRON_FUND_MONTHLY_SELLER_CAP, 0)
      : 0,
    supportedDeals: sameSeller
      ? integer(value?.supportedDeals, 0, 1_000_000, 0)
      : 0,
    createdAt: sameSeller ? Number(value?.createdAt || 0) : 0,
    updatedAt: sameSeller ? Number(value?.updatedAt || 0) : 0,
  };
}

function stagePatronFundRecognition({
  fundValue,
  contributorValue,
  uid,
  seasonKey,
  patronageValue,
  now = Date.now(),
}) {
  const patronage = normalizePatronage(patronageValue, seasonKey);
  const fund = normalizePatronFund(fundValue, seasonKey);
  const contributor = normalizePatronFundContributor(
    contributorValue,
    uid,
    seasonKey,
  );
  const recognizedSpent = Math.max(contributor.recognizedSpent, patronage.seasonSpent);
  const unrecognizedSpent = Math.max(0, recognizedSpent - contributor.recognizedSpent);
  if (!unrecognizedSpent) return { changed: false, fund, contributor };
  const split = splitPatronPayment(unrecognizedSpent);
  return {
    changed: true,
    fund: {
      ...fund,
      seasonKey,
      totalContributed: fund.totalContributed + split.contributionAmount,
      totalBurned: fund.totalBurned + split.burnAmount,
      fundRemaining: fund.fundRemaining + split.contributionAmount,
      updatedAt: now,
    },
    contributor: {
      uid,
      seasonKey,
      recognizedSpent,
      contributionAmount: contributor.contributionAmount + split.contributionAmount,
      burnAmount: contributor.burnAmount + split.burnAmount,
      updatedAt: now,
    },
  };
}

function patronProgramResponse({
  fundValue,
  contributorValue,
  policyValue,
  voteValue,
  recommendationValue,
  patronageValue,
  monthlyMarketValue,
  uid,
  seasonKey,
}) {
  const policy = normalizePatronPolicy(policyValue, seasonKey);
  const fund = normalizePatronFund({
    ...fundValue,
    activePolicy: policy.activePolicy,
  }, seasonKey);
  const summary = publicPatronFundSummary(fund, seasonKey);
  const contributor = normalizePatronFundContributor(
    contributorValue,
    uid,
    seasonKey,
  );
  const recommendations = normalizePatronRecommendationProfile(
    recommendationValue,
    uid,
    seasonKey,
  );
  const patronage = normalizePatronage(patronageValue, seasonKey);
  const oshijoPatron = oshijoPatronEligibility(
    monthlyMarketValue,
    patronage,
    seasonKey,
  );
  const viewerVote = voteValue?.uid === uid && voteValue?.seasonKey === seasonKey
    ? normalizePolicyVote(voteValue?.policyId)
    : null;
  return {
    patronFund: {
      seasonKey,
      contributed: summary.totalContributed,
      burned: summary.totalBurned,
      budget: summary.totalContributed,
      subsidyPaid: summary.totalSubsidized,
      remaining: summary.fundRemaining,
      supportedDeals: summary.supportedSaleCount,
      supportedSellerCount: summary.supportedSellerCount,
      activePolicy: policy.activePolicy,
      votes: policy.votes,
      viewerVote,
      contributionBasisPoints: summary.contributionBasisPoints,
      maxSubsidyPerSale: summary.maxSubsidyPerSale,
      monthlySellerCap: summary.monthlySellerCap,
    },
    patronImpact: {
      seasonKey,
      contributed: contributor.contributionAmount,
      burned: contributor.burnAmount,
      recommendedShopCount: recommendations.recommendations.length,
      recommendationLimit: patronRecommendationLimit(patronage.tier),
    },
    oshijoPatron,
  };
}

async function readPatronProgram(uid, patronageValue = null) {
  const seasonKey = periodKey("monthly");
  const [
    patronSnapshot,
    fundSnapshot,
    contributorSnapshot,
    policySnapshot,
    voteSnapshot,
    recommendationSnapshot,
    monthlyMarketSnapshot,
  ] = await Promise.all([
    patronageValue ? Promise.resolve(null) : patronageRef(uid).get(),
    patronFundRef(seasonKey).get(),
    patronFundContributorRef(uid, seasonKey).get(),
    patronPolicyRef(seasonKey).get(),
    patronPolicyVoteRef(uid, seasonKey).get(),
    patronRecommendationProfileRef(uid, seasonKey).get(),
    marketMonthlyStatsRef(uid, seasonKey).get(),
  ]);
  return patronProgramResponse({
    fundValue: fundSnapshot.data(),
    contributorValue: contributorSnapshot.data(),
    policyValue: policySnapshot.data(),
    voteValue: voteSnapshot.data(),
    recommendationValue: recommendationSnapshot.data(),
    patronageValue: patronageValue || patronSnapshot?.data(),
    monthlyMarketValue: monthlyMarketSnapshot.data(),
    uid,
    seasonKey,
  });
}

async function ensurePatronFundRecognition(uid, patronageValue) {
  const seasonKey = periodKey("monthly");
  const patronage = normalizePatronage(patronageValue, seasonKey);
  if (patronage.seasonSpent <= 0) return readPatronProgram(uid, patronage);
  const fundRef = patronFundRef(seasonKey);
  const contributorRef = patronFundContributorRef(uid, seasonKey);
  await firestore.runTransaction(async (transaction) => {
    const [fundSnapshot, contributorSnapshot] = await Promise.all([
      transaction.get(fundRef),
      transaction.get(contributorRef),
    ]);
    const staged = stagePatronFundRecognition({
      fundValue: fundSnapshot.data(),
      contributorValue: contributorSnapshot.data(),
      uid,
      seasonKey,
      patronageValue: patronage,
    });
    if (!staged.changed) return;
    transaction.set(fundRef, staged.fund);
    transaction.set(contributorRef, staged.contributor);
  });
  return readPatronProgram(uid, patronage);
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
      "高額のAnjuPayを使う前に、Googleでゲームデータを保護してください。",
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
  const fundRef = patronFundRef(seasonKey);
  const contributorRef = patronFundContributorRef(uid, seasonKey);
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const [
      walletSnapshot,
      patronSnapshot,
      ledgerSnapshot,
      ledgerConfigSnapshot,
      fundSnapshot,
      contributorSnapshot,
    ] = await Promise.all([
      transaction.get(wallet),
      transaction.get(patronRef),
      transaction.get(ledgerRef),
      transaction.get(anjuPayLedgerConfigRef()),
      transaction.get(fundRef),
      transaction.get(contributorRef),
    ]);
    const current = normalizePatronage(patronSnapshot.data(), seasonKey);
    const walletState = walletData(walletSnapshot);
    const before = walletState.balance;
    const activated = stageAnjuPayOpening(
      transaction,
      wallet,
      walletState,
      ledgerConfigSnapshot,
      now,
    );
    const recognizePatronFund = (patronageValue) => {
      const staged = stagePatronFundRecognition({
        fundValue: fundSnapshot.data(),
        contributorValue: contributorSnapshot.data(),
        uid,
        seasonKey,
        patronageValue,
        now,
      });
      if (staged.changed) {
        transaction.set(fundRef, staged.fund);
        transaction.set(contributorRef, staged.contributor);
      }
      return staged;
    };
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
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }

    const upgrade = patronUpgrade(current, targetTier, seasonKey);
    if (upgrade.outcome === "owned") {
      result = { outcome: "owned", balance: before, debited: 0, patron: current };
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }
    if (upgrade.outcome !== "upgrade" || upgrade.cost <= 0) {
      throw new HttpsError("invalid-argument", "パトロンランクを確認できませんでした。");
    }
    if (seasonKey >= MARKET_MONTHLY_RANKING_START_KEY) {
      throw new HttpsError(
        "failed-precondition",
        "新しいパトロンバッジは、人気推し嬢が今月の営業収益を還元したときに獲得できます。",
        {
          reason: "oshijo_patron_required",
          seasonKey,
          currentTier: current.tier,
          targetTier,
        },
      );
    }
    if (before < upgrade.cost) {
      result = {
        outcome: "short",
        balance: before,
        required: upgrade.cost,
        debited: 0,
        patron: current,
      };
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }

    const after = before - upgrade.cost;
    walletState.balance = after;
    const patron = normalizePatronage({
      seasonKey,
      seasonSpent: upgrade.target.threshold,
      lifetimeSpent: current.lifetimeSpent + upgrade.cost,
      oshijoSeasonSpent: current.oshijoSeasonSpent,
      oshijoLifetimeSpent: current.oshijoLifetimeSpent,
      updatedAt: now,
    }, seasonKey);
    const paymentSplit = splitPatronPayment(upgrade.cost);
    const groupId = anjuPayEntryId(`patron:${actionId}:${seasonKey}`);
    appendAnjuPayEntry(transaction, wallet, walletState, ledgerConfigSnapshot, {
      entryId: groupId,
      groupId,
      kind: "patron_upgrade",
      category: "spend",
      labelKey: "anju_pay_patron_upgrade",
      status: "posted",
      delta: -upgrade.cost,
      nominalAmount: upgrade.cost,
      balanceBefore: before,
      balanceAfter: after,
      components: [{
        kind: "patron_upgrade",
        labelKey: "anju_pay_patron_upgrade",
        delta: -upgrade.cost,
        nominalAmount: upgrade.cost,
        status: "posted",
      }],
      details: {
        targetTier: upgrade.target.level,
        patronFundContribution: paymentSplit.contributionAmount,
        patronBurnAmount: paymentSplit.burnAmount,
      },
      occurredAt: now,
    });
    transaction.update(wallet, { balance: after,
      ...anjuPayWalletMetadataPatch(walletState),
      updatedAt: now,
    });
    transaction.set(patronRef, patron);
    recognizePatronFund(patron);
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
  return {
    ...result,
    ...await readPatronProgram(uid, result.patron),
  };
}

async function initializeEconomy(uid) {
  const [balance, achievementState, patron] = await Promise.all([
    ensureWallet(uid),
    ensureAchievementState(uid),
    readPatronage(uid),
  ]);
  const { progress, profile, marketStats } = achievementState;
  const patronProgram = await ensurePatronFundRecognition(uid, patron);
  await Promise.all([
    mirrorWallet(uid, balance),
    mirrorEconomyProgress(uid, progress),
    mirrorPatronage(uid, patron),
  ]);
  await bestEffort("initializeEconomy creator card", [
    syncCreatorCardGrowth(uid, achievementState),
  ]);
  return {
    outcome: "ready",
    balance,
    daily: progress.daily,
    periodRewards: progress.periodRewards,
    dailyPlay: dailyPlayRewardSummary(progress.periodRewards, progress.dailyPlayClaims),
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
    ...patronProgram,
  };
}

async function claimDaily(uid, missionId) {
  const mission = DAILY_MISSIONS[missionId];
  if (!mission) throw new HttpsError("invalid-argument", "存在しないミッションです。");
  const dateKey = jstDateKey();
  if (mission.endsAfter && dateKey >= mission.endsAfter) {
    throw new HttpsError("failed-precondition", "このミッションの実施期間は終了しました。");
  }
  if (mission.startsOn && dateKey < mission.startsOn) {
    throw new HttpsError("failed-precondition", "このミッションはまだ始まっていません。");
  }
  await Promise.all([ensureWallet(uid), ensureEconomyProgress(uid)]);
  const wallet = walletRef(uid);
  const progressRef = economyProgressRef(uid);
  const claim = firestore.collection("economyClaims").doc(uid).collection("daily").doc(eventId(`${dateKey}:${missionId}`));
  let result = null;
  let progressResult = null;
  const claimTimestamp = Date.now();
  await firestore.runTransaction(async (transaction) => {
    if (jstDateKey() !== dateKey) {
      throw new HttpsError("aborted", "日付が切り替わりました。もう一度お試しください。");
    }
    const [
      walletSnapshot,
      progressSnapshot,
      claimSnapshot,
      ledgerConfigSnapshot,
    ] = await Promise.all([
      transaction.get(wallet),
      transaction.get(progressRef),
      transaction.get(claim),
      transaction.get(anjuPayLedgerConfigRef()),
    ]);
    const walletState = walletData(walletSnapshot);
    const before = walletState.balance;
    const activated = stageAnjuPayOpening(
      transaction,
      wallet,
      walletState,
      ledgerConfigSnapshot,
      claimTimestamp,
    );
    const progress = normalizeEconomyProgress(progressSnapshot.data(), dateKey);
    const daily = progress.daily;
    if (claimSnapshot.exists) {
      result = { outcome: "claimed", balance: before, credited: 0 };
      daily.claimed[missionId] = true;
      progress.updatedAt = claimTimestamp;
      transaction.set(progressRef, progress);
      persistAnjuPayOpening(
        transaction,
        wallet,
        walletState,
        activated,
        claimTimestamp,
      );
      progressResult = progress;
      return;
    }
    if (Number(daily[mission.progressKey] || 0) < mission.target) {
      result = { outcome: "incomplete", balance: before, credited: 0 };
      progress.updatedAt = claimTimestamp;
      transaction.set(progressRef, progress);
      persistAnjuPayOpening(
        transaction,
        wallet,
        walletState,
        activated,
        claimTimestamp,
      );
      progressResult = progress;
      return;
    }
    const reservedIncoming = integer(walletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0);
    const credited = Math.min(mission.reward, Math.max(0, MAX_POINTS - reservedIncoming - before));
    const after = before + credited;
    walletState.balance = after;
    const groupId = anjuPayEntryId(`daily:${dateKey}:${missionId}`);
    appendAnjuPayEntry(transaction, wallet, walletState, ledgerConfigSnapshot, {
      entryId: groupId,
      groupId,
      kind: "daily_mission_reward",
      category: "earn",
      labelKey: "anju_pay_daily_mission_reward",
      status: anjuPayRewardStatus(credited, mission.reward),
      delta: credited,
      nominalAmount: mission.reward,
      balanceBefore: before,
      balanceAfter: after,
      components: [{
        kind: "daily_mission_reward",
        labelKey: "anju_pay_daily_mission_reward",
        delta: credited,
        nominalAmount: mission.reward,
        status: anjuPayRewardStatus(credited, mission.reward),
      }],
      details: { missionId, dateKey },
      occurredAt: claimTimestamp,
    });
    transaction.update(wallet, {
      balance: after,
      ...anjuPayWalletMetadataPatch(walletState),
      updatedAt: claimTimestamp,
    });
    transaction.create(claim, {
      dateKey,
      missionId,
      reward: mission.reward,
      credited,
      createdAt: claimTimestamp,
    });
    daily.claimed[missionId] = true;
    progress.updatedAt = claimTimestamp;
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

async function claimDailyPlayRewards(uid) {
  const requestTimestamp = Date.now();
  await Promise.all([ensureWallet(uid), ensureEconomyProgress(uid)]);
  const wallet = walletRef(uid);
  const progressRef = economyProgressRef(uid);
  let result = null;
  let progressResult = null;
  await firestore.runTransaction(async (transaction) => {
    const [walletSnapshot, progressSnapshot, ledgerConfigSnapshot] = await Promise.all([
      transaction.get(wallet),
      transaction.get(progressRef),
      transaction.get(anjuPayLedgerConfigRef()),
    ]);
    const walletState = walletData(walletSnapshot);
    const before = walletState.balance;
    const progress = normalizeEconomyProgress(progressSnapshot.data(), jstDateKey(requestTimestamp));
    const claimable = claimableDailyPlayRewards(
      progress.periodRewards,
      progress.dailyPlayClaims,
      requestTimestamp,
    );
    const claimRefs = claimable.map(({ dateKey, tier }) => (
      firestore.collection("economyClaims").doc(uid).collection("daily")
        .doc(eventId(`${dateKey}:play:${tier.id}`))
    ));
    const claimSnapshots = await Promise.all(claimRefs.map((claimRef) => transaction.get(claimRef)));
    const activated = stageAnjuPayOpening(
      transaction,
      wallet,
      walletState,
      ledgerConfigSnapshot,
      requestTimestamp,
    );
    const reservedIncoming = integer(walletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0);
    const existingClaimKeys = new Set(claimable.flatMap((entry, index) => (
      claimSnapshots[index].exists
        ? [dailyPlayRewardClaimKey(entry.dateKey, entry.tier.id)]
        : []
    )));
    const settlement = settleDailyPlayRewardClaims(
      claimable,
      existingClaimKeys,
      Math.max(0, MAX_POINTS - reservedIncoming - before),
    );
    settlement.decisions.forEach((decision, index) => {
      const { dateKey, tier } = decision;
      const claimState = progress.dailyPlayClaims[dateKey] || {
        claimed: {},
        updatedAt: requestTimestamp,
      };
      progress.dailyPlayClaims[dateKey] = claimState;
      claimState.claimed[tier.id] = true;
      claimState.updatedAt = requestTimestamp;
      if (!decision.create) return;
      transaction.create(claimRefs[index], {
        type: "daily_play",
        dateKey,
        tierId: tier.id,
        target: tier.target,
        reward: tier.reward,
        credited: decision.credited,
        createdAt: requestTimestamp,
      });
    });
    const after = before + settlement.credited;
    walletState.balance = after;
    if (settlement.claimedCount > 0) {
      const createdDecisions = settlement.decisions.filter((decision) => decision.create);
      const groupId = anjuPayEntryId(`daily-play:${createdDecisions
        .map(({ dateKey, tier }) => `${dateKey}:${tier.id}`)
        .sort()
        .join("|")}`);
      appendAnjuPayEntry(transaction, wallet, walletState, ledgerConfigSnapshot, {
        entryId: groupId,
        groupId,
        kind: "daily_play_reward",
        category: "earn",
        labelKey: "anju_pay_daily_play_reward",
        status: anjuPayRewardStatus(settlement.credited, settlement.nominal),
        delta: settlement.credited,
        nominalAmount: settlement.nominal,
        balanceBefore: before,
        balanceAfter: after,
        components: createdDecisions.map(({ tier, credited }) => ({
          kind: "daily_play_reward",
          labelKey: "anju_pay_daily_play_reward",
          delta: credited,
          nominalAmount: tier.reward,
          status: anjuPayRewardStatus(credited, tier.reward),
        })),
        details: {
          dateKey: createdDecisions.at(-1)?.dateKey,
          tierIds: createdDecisions.map(({ tier }) => tier.id),
          dailyPlayClaims: createdDecisions.map(({ dateKey, tier, credited }) => ({
            dateKey,
            tierId: tier.id,
            credited,
            nominalAmount: tier.reward,
            status: anjuPayRewardStatus(credited, tier.reward),
          })),
        },
        occurredAt: requestTimestamp,
      });
      transaction.update(wallet, {
        balance: after,
        ...anjuPayWalletMetadataPatch(walletState),
        updatedAt: requestTimestamp,
      });
    } else {
      persistAnjuPayOpening(
        transaction,
        wallet,
        walletState,
        activated,
        requestTimestamp,
      );
    }
    if (settlement.claimedCount > 0
      || settlement.recoveredCount > 0
      || Number(progressSnapshot.get("schemaVersion") || 0) < 3) {
      progress.updatedAt = requestTimestamp;
      transaction.set(progressRef, progress);
    }
    progressResult = progress;
    result = {
      outcome: settlement.claimedCount > 0
        ? "claimed-now"
        : settlement.recoveredCount > 0
          ? "claimed"
          : "none",
      balance: after,
      credited: settlement.credited,
      nominal: settlement.nominal,
      claimedCount: settlement.claimedCount,
      recoveredCount: settlement.recoveredCount,
    };
  });
  await bestEffort("claimDailyPlayRewards", [
    mirrorWallet(uid, result.balance),
    mirrorEconomyProgress(uid, progressResult),
  ]);
  return {
    ...result,
    daily: progressResult.daily,
    periodRewards: progressResult.periodRewards,
    dailyPlay: dailyPlayRewardSummary(
      progressResult.periodRewards,
      progressResult.dailyPlayClaims,
      Date.now(),
    ),
  };
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
  const purchaseTimestamp = Date.now();
  await firestore.runTransaction(async (transaction) => {
    const [walletSnapshot, purchaseSnapshot, ledgerConfigSnapshot] = await Promise.all([
      transaction.get(wallet),
      transaction.get(purchase),
      transaction.get(anjuPayLedgerConfigRef()),
    ]);
    const walletState = walletData(walletSnapshot);
    const before = walletState.balance;
    const activated = stageAnjuPayOpening(
      transaction,
      wallet,
      walletState,
      ledgerConfigSnapshot,
      purchaseTimestamp,
    );
    if (purchaseSnapshot.exists || alreadyOwned) {
      if (!purchaseSnapshot.exists) {
        transaction.create(purchase, {
          productId,
          price: 0,
          migrated: true,
          createdAt: purchaseTimestamp,
        });
      }
      result = { outcome: "owned", balance: before, price: 0 };
      persistAnjuPayOpening(
        transaction,
        wallet,
        walletState,
        activated,
        purchaseTimestamp,
      );
      return;
    }
    if (RETIRED_TEAM_PRODUCT_IDS.has(productId)) {
      throw new HttpsError(
        "failed-precondition",
        "この称号は終了したモードの商品です。購入済みの場合は引き続き利用できます。",
      );
    }
    if (before < product.price) {
      result = { outcome: "short", balance: before, price: product.price };
      persistAnjuPayOpening(
        transaction,
        wallet,
        walletState,
        activated,
        purchaseTimestamp,
      );
      return;
    }
    const after = before - product.price;
    walletState.balance = after;
    const groupId = anjuPayEntryId(`purchase:${productId}`);
    appendAnjuPayEntry(transaction, wallet, walletState, ledgerConfigSnapshot, {
      entryId: groupId,
      groupId,
      kind: "store_purchase",
      category: "spend",
      labelKey: "anju_pay_store_purchase",
      status: "posted",
      delta: -product.price,
      nominalAmount: product.price,
      balanceBefore: before,
      balanceAfter: after,
      components: [{
        kind: "store_purchase",
        labelKey: "anju_pay_store_purchase",
        delta: -product.price,
        nominalAmount: product.price,
        status: "posted",
      }],
      details: { productId },
      occurredAt: purchaseTimestamp,
    });
    transaction.update(wallet, {
      balance: after,
      ...anjuPayWalletMetadataPatch(walletState),
      updatedAt: purchaseTimestamp,
    });
    transaction.create(purchase, {
      productId,
      price: product.price,
      createdAt: purchaseTimestamp,
    });
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
    const [walletSnapshot, progressSnapshot, ledgerConfigSnapshot] = await Promise.all([
      transaction.get(wallet),
      transaction.get(progressRef),
      transaction.get(anjuPayLedgerConfigRef()),
    ]);
    const claimSnapshots = [];
    for (const ref of refs) claimSnapshots.push(await transaction.get(ref));
    const walletState = walletData(walletSnapshot);
    const activated = stageAnjuPayOpening(
      transaction,
      wallet,
      walletState,
      ledgerConfigSnapshot,
      now,
    );
    const progress = normalizeEconomyProgress(progressSnapshot.data());
    const available = batch.filter((entry, index) => {
      const current = progress.periodRewards?.[entry.period]?.[entry.key];
      return !claimSnapshots[index].exists && current?.claimed !== true
        && Number(current?.endsAt || 0) <= now
        && Number(current?.verifiedMatches || 0) === Number(current?.matches || 0)
        && periodReward(entry.period, current) === entry.reward;
    });
    const nominal = available.reduce((sum, entry) => sum + entry.reward, 0);
    const before = walletState.balance;
    const reservedIncoming = integer(walletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0);
    const credited = Math.min(nominal, Math.max(0, MAX_POINTS - reservedIncoming - before));
    const after = before + credited;
    walletState.balance = after;
    if (available.length) {
      let remainingCredit = credited;
      const rewardComponents = available.map((entry) => {
        const componentCredit = Math.min(entry.reward, remainingCredit);
        remainingCredit -= componentCredit;
        return {
          kind: `${entry.period}_period_reward`,
          labelKey: `anju_pay_${entry.period}_period_reward`,
          delta: componentCredit,
          nominalAmount: entry.reward,
          status: anjuPayRewardStatus(componentCredit, entry.reward),
        };
      });
      const groupId = anjuPayEntryId(`periods:${available
        .map(({ period, key }) => `${period}:${key}`)
        .sort()
        .join("|")}`);
      appendAnjuPayEntry(transaction, wallet, walletState, ledgerConfigSnapshot, {
        entryId: groupId,
        groupId,
        kind: "period_reward",
        category: "earn",
        labelKey: "anju_pay_period_reward",
        status: anjuPayRewardStatus(credited, nominal),
        delta: credited,
        nominalAmount: nominal,
        balanceBefore: before,
        balanceAfter: after,
        components: rewardComponents,
        details: {
          periods: available.map((entry) => ({
            period: entry.period,
            key: entry.key,
            nominalAmount: entry.reward,
          })),
        },
        occurredAt: now,
      });
      transaction.update(wallet, {
        balance: after,
        ...anjuPayWalletMetadataPatch(walletState),
        updatedAt: now,
      });
    } else {
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
    }
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

async function initializeTraining(uid) {
  const profileRef = trainingProfileRef(uid);
  const progressRef = economyProgressRef(uid);
  const now = Date.now();
  let profile = null;
  let daily = null;
  await firestore.runTransaction(async (transaction) => {
    const [profileSnapshot, progressSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(progressRef),
    ]);
    profile = normalizeTrainingProfile(profileSnapshot.data());
    daily = normalizeEconomyProgress(
      progressSnapshot.data(),
      jstDateKey(now),
    ).daily;
    if (!profileSnapshot.exists) {
      profile.updatedAt = now;
      transaction.create(profileRef, profile);
    }
  });
  return {
    result: { status: "ready" },
    profile,
    daily,
  };
}

function trainingServerFinalizationMatches(value, result) {
  const finalized = objectValue(value);
  return Number(finalized.version) === 1
    && finalized.reason === result.reason
    && Number(finalized.turnCount) === result.turnCount
    && sameIds(
      Object.keys(objectValue(finalized.outcomes)).sort(),
      result.participants,
    )
    && sameIds(
      Object.keys(objectValue(finalized.completedSetsByUid)).sort(),
      result.participants,
    )
    && result.participants.every((participantUid) => (
      finalized.outcomes?.[participantUid] === result.outcomes[participantUid]
      && Number(finalized.completedSetsByUid?.[participantUid])
        === result.completedSetsByUid[participantUid]
    ));
}

async function finalizeTraining(uid, roomId, {
  now = Date.now(),
  maxRoomAgeMs = TRAINING_ROOM_MAX_AGE_MS,
} = {}) {
  const roomRef = realtime.ref(`online/trainingRooms/${roomId}`);
  const roomSnapshot = await roomRef.get();
  const room = roomSnapshot.val();
  let derived;
  try {
    derived = assertTrainingRoomFinalizable(
      room,
      uid,
      now,
      { maxAgeMs: maxRoomAgeMs },
    );
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "鍛え合い60の有効な完走ルームを確認できませんでした。",
    );
  }
  if (derived.status !== "final") {
    return {
      result: {
        status: "pending",
        retryAfterMs: derived.retryAfterMs,
      },
      profile: null,
      daily: null,
    };
  }
  if (room?.serverFinalized
      && !trainingServerFinalizationMatches(room.serverFinalized, derived)) {
    throw new HttpsError(
      "failed-precondition",
      "鍛え合い60の確定結果が一致しません。",
    );
  }

  const participants = derived.participants;
  const profileRefs = participants.map((participantUid) => trainingProfileRef(participantUid));
  const claimRefs = participants.map((participantUid) => (
    trainingClaimRef(participantUid, roomId)
  ));
  const progressRefs = participants.map((participantUid) => (
    economyProgressRef(participantUid)
  ));
  const profileResults = {};
  const progressResults = {};
  let callerDuplicate = false;
  await firestore.runTransaction(async (transaction) => {
    Object.keys(profileResults).forEach((key) => delete profileResults[key]);
    Object.keys(progressResults).forEach((key) => delete progressResults[key]);
    const snapshots = await Promise.all([
      ...profileRefs.map((ref) => transaction.get(ref)),
      ...claimRefs.map((ref) => transaction.get(ref)),
      ...progressRefs.map((ref) => transaction.get(ref)),
    ]);
    const count = participants.length;
    const profileSnapshots = snapshots.slice(0, count);
    const claimSnapshots = snapshots.slice(count, count * 2);
    const progressSnapshots = snapshots.slice(count * 2);
    callerDuplicate = claimSnapshots[participants.indexOf(uid)].exists;

    participants.forEach((participantUid, index) => {
      const completedSets = derived.completedSetsByUid[participantUid];
      const claimSnapshot = claimSnapshots[index];
      const completionTimestamps = derived.completedAtByUid[participantUid];
      const dailySettlement = trainingDailySettlement(
        progressSnapshots[index].data(),
        completionTimestamps,
        now,
      );
      const progress = normalizeEconomyProgress(
        progressSnapshots[index].data(),
        dailySettlement.dateKey,
      );
      if (claimSnapshot.exists) {
        if (claimSnapshot.get("uid") !== participantUid
            || claimSnapshot.get("roomId") !== roomId
            || claimSnapshot.get("outcome") !== derived.outcomes[participantUid]
            || Number(claimSnapshot.get("completedSets")) !== completedSets) {
          throw new HttpsError(
            "failed-precondition",
            "鍛え合い60の保存済み確定記録が一致しません。",
          );
        }
        profileResults[participantUid] = normalizeTrainingProfile(
          profileSnapshots[index].data(),
        );
        progressResults[participantUid] = progress;
        return;
      }

      const profile = applyTrainingSession(
        profileSnapshots[index].data(),
        completionTimestamps,
        now,
      );
      if (completedSets > 0 && dailySettlement.creditTrainingSet) {
        progress.daily.trainingSets = 1;
      }
      progress.updatedAt = now;
      profileResults[participantUid] = profile;
      progressResults[participantUid] = progress;
      transaction.set(profileRefs[index], profile);
      transaction.set(progressRefs[index], progress);
      transaction.create(claimRefs[index], {
        version: 1,
        uid: participantUid,
        roomId,
        participants,
        outcome: derived.outcomes[participantUid],
        reason: derived.reason,
        completedSets,
        turnCount: derived.turnCount,
        finalizedBy: uid,
        createdAt: now,
      });
    });
  });

  const serverFinalized = {
    version: 1,
    reason: derived.reason,
    turnCount: derived.turnCount,
    outcomes: derived.outcomes,
    completedSetsByUid: derived.completedSetsByUid,
    finalizedAt: Number(room?.serverFinalized?.finalizedAt) || now,
  };
  const serverFinalizedTransaction = await roomRef.child("serverFinalized")
    .transaction((current) => {
      if (current == null) return serverFinalized;
      if (!trainingServerFinalizationMatches(current, derived)) {
        throw new TypeError("Training server finalization conflict");
      }
      return current;
    });
  if (!trainingServerFinalizationMatches(serverFinalizedTransaction.snapshot.val(), derived)) {
    throw new HttpsError(
      "aborted",
      "鍛え合い60の確定結果を保存できませんでした。もう一度お試しください。",
    );
  }
  await bestEffort("finalizeTraining", participants.map((participantUid) => (
    mirrorEconomyProgress(participantUid, progressResults[participantUid])
  )));
  return {
    result: {
      status: "final",
      finalization: callerDuplicate ? "duplicate" : "recorded",
      outcome: derived.outcomes[uid],
      reason: derived.reason,
      completedSets: derived.completedSetsByUid[uid],
      turnCount: derived.turnCount,
    },
    profile: profileResults[uid],
    daily: progressResults[uid].daily,
  };
}

const VERIFIED_MATCH_MODES = Object.freeze({
  solo: { roomRoot: "rooms", members: 2 },
  strategy: { roomRoot: "strategyRooms", members: 2 },
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

async function finalizeSoloRoomResult(uid, roomId, requestedOutcome, now = Date.now()) {
  const roomRef = realtime.ref(`online/rooms/${roomId}`);
  const room = (await roomRef.get()).val();
  if (!room || room.status !== "active" || room.members?.[uid] !== true) {
    throw new HttpsError(
      "failed-precondition",
      "完走済みの通常型1on1ルームを確認できませんでした。",
    );
  }
  const createdAt = Number(room.createdAt || 0);
  if (!Number.isFinite(createdAt)
      || createdAt > now
      || createdAt < now - (12 * 60 * 60 * 1000)) {
    throw new HttpsError(
      "failed-precondition",
      "完走済みの通常型1on1ルームを確認できませんでした。",
    );
  }
  matchParticipants("solo", room, VERIFIED_MATCH_MODES.solo);

  let result;
  try {
    result = deriveSoloMatchResult(room);
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "通常型1on1の確定スコアを検証できませんでした。",
    );
  }
  if (result.status !== "final") return { room, pending: true };
  if (result.outcomes?.[uid] !== requestedOutcome) {
    throw new HttpsError(
      "failed-precondition",
      "申告した試合結果が確定スコアと一致しません。",
    );
  }

  const serverFinalized = {
    version: 1,
    round: result.round,
    finalizedAt: Number(room.serverFinalized?.finalizedAt) || now,
  };
  // Keep the client-owned acknowledgement slots untouched. Older clients write
  // their own resultClaims/finished pair with a create-only rule and would be
  // locked out if a faster opponent caused Functions to pre-fill those paths.
  await roomRef.child("serverFinalized").set(serverFinalized);
  return {
    room: {
      ...room,
      serverFinalized,
    },
    result,
  };
}

async function upgradeOshijoPatronage(uid, request, data) {
  if (!hasGoogleIdentity(request) || !await hasLiveGoogleIdentity(uid)) {
    throw new HttpsError(
      "failed-precondition",
      "高額のAnjuPayを使う前に、Googleでゲームデータを保護してください。",
    );
  }
  const targetTier = Number(data?.targetTier);
  const actionId = cleanText(data?.actionId, 80);
  if (!Number.isSafeInteger(targetTier)
      || targetTier < 1
      || targetTier > PATRON_TIERS.at(-1).level
      || !/^[A-Za-z0-9_-]{16,80}$/.test(actionId)) {
    throw new HttpsError("invalid-argument", "推し嬢パトロン還元操作が正しくありません。");
  }
  if (await accountHasActiveSession(uid)) {
    throw new HttpsError("failed-precondition", "対戦・待機・市場取引を終了してからパトロン還元を行ってください。");
  }

  await ensureWallet(uid);
  const now = Date.now();
  const seasonKey = periodKey("monthly", now);
  const wallet = walletRef(uid);
  const patronRef = patronageRef(uid);
  const ledgerRef = patronageLedgerRef(uid, actionId);
  const fundRef = patronFundRef(seasonKey);
  const contributorRef = patronFundContributorRef(uid, seasonKey);
  const monthlyStatsReference = marketMonthlyStatsRef(uid, seasonKey);
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const [
      walletSnapshot,
      patronSnapshot,
      ledgerSnapshot,
      ledgerConfigSnapshot,
      fundSnapshot,
      contributorSnapshot,
      monthlyStatsSnapshot,
    ] = await Promise.all([
      transaction.get(wallet),
      transaction.get(patronRef),
      transaction.get(ledgerRef),
      transaction.get(anjuPayLedgerConfigRef()),
      transaction.get(fundRef),
      transaction.get(contributorRef),
      transaction.get(monthlyStatsReference),
    ]);
    const current = normalizePatronage(patronSnapshot.data(), seasonKey);
    const monthlyStats = normalizeMonthlyMarketStats(
      monthlyStatsSnapshot.data(),
      uid,
      seasonKey,
      "",
    );
    const eligibility = oshijoPatronEligibility(monthlyStats, current, seasonKey);
    const walletState = walletData(walletSnapshot);
    const before = walletState.balance;
    const activated = stageAnjuPayOpening(
      transaction,
      wallet,
      walletState,
      ledgerConfigSnapshot,
      now,
    );
    const recognizePatronFund = (patronageValue) => {
      const staged = stagePatronFundRecognition({
        fundValue: fundSnapshot.data(),
        contributorValue: contributorSnapshot.data(),
        uid,
        seasonKey,
        patronageValue,
        now,
      });
      if (staged.changed) {
        transaction.set(fundRef, staged.fund);
        transaction.set(contributorRef, staged.contributor);
      }
      return staged;
    };

    if (ledgerSnapshot.exists) {
      const saved = ledgerSnapshot.data();
      if (saved.uid !== uid
          || saved.actionId !== actionId
          || saved.seasonKey !== seasonKey
          || saved.source !== "oshijo"
          || Number(saved.targetTier) !== targetTier) {
        throw new HttpsError("permission-denied", "推し嬢パトロン操作IDの内容が一致しません。");
      }
      result = {
        outcome: "upgraded",
        source: "oshijo",
        balance: before,
        debited: integer(saved.debited, 0, MAX_POINTS, 0),
        patron: current,
        eligibility,
        repeated: true,
      };
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }

    const upgrade = patronUpgrade(current, targetTier, seasonKey);
    if (upgrade.outcome === "owned") {
      result = {
        outcome: "owned",
        source: "oshijo",
        balance: before,
        debited: 0,
        patron: current,
        eligibility,
        repeated: false,
      };
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }
    if (upgrade.outcome !== "upgrade" || upgrade.cost <= 0) {
      throw new HttpsError("invalid-argument", "パトロンランクを確認できませんでした。");
    }
    if (!eligibility.popular) {
      result = {
        outcome: "ineligible",
        source: "oshijo",
        balance: before,
        required: upgrade.cost,
        debited: 0,
        patron: current,
        eligibility,
        repeated: false,
      };
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }
    if (eligibility.availableProceeds < upgrade.cost) {
      result = {
        outcome: "short-proceeds",
        source: "oshijo",
        balance: before,
        required: upgrade.cost,
        debited: 0,
        patron: current,
        eligibility,
        repeated: false,
      };
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }
    if (before < upgrade.cost) {
      result = {
        outcome: "short",
        source: "oshijo",
        balance: before,
        required: upgrade.cost,
        debited: 0,
        patron: current,
        eligibility,
        repeated: false,
      };
      persistAnjuPayOpening(transaction, wallet, walletState, activated, now);
      recognizePatronFund(current);
      return;
    }

    const after = before - upgrade.cost;
    walletState.balance = after;
    const patron = normalizePatronage({
      seasonKey,
      seasonSpent: upgrade.target.threshold,
      lifetimeSpent: current.lifetimeSpent + upgrade.cost,
      oshijoSeasonSpent: current.oshijoSeasonSpent + upgrade.cost,
      oshijoLifetimeSpent: current.oshijoLifetimeSpent + upgrade.cost,
      updatedAt: now,
    }, seasonKey);
    const paymentSplit = splitPatronPayment(upgrade.cost);
    const groupId = anjuPayEntryId(`oshijo-patron:${actionId}:${seasonKey}`);
    appendAnjuPayEntry(transaction, wallet, walletState, ledgerConfigSnapshot, {
      entryId: groupId,
      groupId,
      kind: "oshijo_patron_upgrade",
      category: "spend",
      labelKey: "anju_pay_oshijo_patron_upgrade",
      status: "posted",
      delta: -upgrade.cost,
      nominalAmount: upgrade.cost,
      balanceBefore: before,
      balanceAfter: after,
      components: [{
        kind: "oshijo_patron_upgrade",
        labelKey: "anju_pay_oshijo_patron_upgrade",
        delta: -upgrade.cost,
        nominalAmount: upgrade.cost,
        status: "posted",
      }],
      details: {
        targetTier: upgrade.target.level,
        source: "oshijo",
        seasonKey,
        qualifyingSales: eligibility.salesCount,
        uniqueBuyers: eligibility.uniqueBuyers,
        oshijoNetProceeds: eligibility.netProceeds,
        patronFundContribution: paymentSplit.contributionAmount,
        patronBurnAmount: paymentSplit.burnAmount,
      },
      occurredAt: now,
    });
    transaction.update(wallet, {
      balance: after,
      ...anjuPayWalletMetadataPatch(walletState),
      updatedAt: now,
    });
    transaction.set(patronRef, patron);
    recognizePatronFund(patron);
    transaction.create(ledgerRef, {
      uid,
      actionId,
      source: "oshijo",
      seasonKey,
      targetTier: upgrade.target.level,
      debited: upgrade.cost,
      balance: after,
      patron,
      popularity: {
        salesCount: eligibility.salesCount,
        uniqueBuyers: eligibility.uniqueBuyers,
      },
      proceeds: {
        earned: eligibility.netProceeds,
        usedBefore: eligibility.proceedsUsed,
        usedAfter: eligibility.proceedsUsed + upgrade.cost,
      },
      split: paymentSplit,
      createdAt: now,
    });
    result = {
      outcome: "upgraded",
      source: "oshijo",
      balance: after,
      debited: upgrade.cost,
      patron,
      eligibility: oshijoPatronEligibility(monthlyStats, patron, seasonKey),
      repeated: false,
    };
  });

  await bestEffort("upgradeOshijoPatronage", [
    mirrorWallet(uid, result.balance),
    mirrorPatronage(uid, result.patron),
  ]);
  return {
    ...result,
    ...await readPatronProgram(uid, result.patron),
  };
}

function validatedOutcomes(mode, room, participants, {
  requireServerFinalized = false,
} = {}) {
  if (mode === "solo" && requireServerFinalized) {
    const derived = deriveSoloMatchResult(room);
    if (derived.status !== "final"
        || Number(room.serverFinalized?.version) !== 1
        || Number(room.serverFinalized?.round) !== derived.round) {
      throw new HttpsError("failed-precondition", "通常型1on1の確定結果を検証できませんでした。");
    }
    return {
      pending: false,
      missing: 0,
      outcomes: derived.outcomes,
    };
  }

  const claims = objectValue(room.resultClaims);
  const claimedUids = Object.keys(claims);
  const finishedUids = verifiedMemberIds(room.finished);
  if (claimedUids.some((claimUid) => !participants.includes(claimUid))
      || finishedUids.some((finishedUid) => !participants.includes(finishedUid))) {
    throw new HttpsError("failed-precondition", "結果申告が対戦参加者と一致しません。");
  }
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
  } else {
    throw new HttpsError("failed-precondition", "未対応の対戦モードです。");
  }
  return { pending: false, missing: 0, outcomes };
}

function dailyActivityForRoom(mode, room, uid) {
  let scores = 0;
  let criticals = 0;
  const rounds = Object.values(objectValue(room.rounds));
  for (const round of rounds) {
    let values = [];
    if (mode === "solo") {
      values = [round?.scores?.[uid]];
    } else if (mode === "strategy") {
      values = [round?.ratings?.[uid]?.score, round?.actionRatings?.[uid]?.score];
    } else throw new HttpsError("failed-precondition", "未対応の対戦モードです。");
    values.filter((value) => Number.isInteger(Number(value))
      && Number(value) >= 1 && Number(value) <= 10)
      .forEach((value) => {
        scores += 1;
        if (Number(value) >= 8) criticals += 1;
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
      variantMatches: { teamDuo: 0 },
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
    record.variantMatches = {
      teamDuo: integer(record?.variantMatches?.teamDuo, 0, record.matches, 0),
    };
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

function soloProfileProjectionEligible(room, uid) {
  return room?.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && room?.players?.[uid]?.profileProjectionVersion === SOLO_PROFILE_PROJECTION_VERSION;
}

function soloProfileProjectionJob(uid, roomId, room, outcome, resultToken, now) {
  const participants = matchParticipants("solo", room, VERIFIED_MATCH_MODES.solo);
  const opponentUid = participants.find((participantUid) => participantUid !== uid);
  const player = room?.players?.[uid];
  const opponent = room?.players?.[opponentUid];
  return {
    profileProjectionVersion: SOLO_PROFILE_PROJECTION_VERSION,
    uid,
    roomId,
    resultToken,
    outcome,
    name: cleanName(player?.name),
    pursuitLine: cleanText(player?.pursuitLine, 40),
    opponentRating: integer(opponent?.rating, 100, 3000, 1000),
    createdAt: now,
  };
}

function normalizeSoloProjectionJob(jobId, value) {
  const job = objectValue(value);
  const uid = typeof job.uid === "string" ? job.uid : "";
  const roomId = cleanText(job.roomId, 80);
  const resultToken = cleanText(job.resultToken, 40);
  const outcome = cleanText(job.outcome, 16);
  const name = cleanName(job.name);
  const pursuitLine = cleanText(job.pursuitLine, 40);
  const opponentRating = job.opponentRating;
  const createdAt = job.createdAt;
  const projectionSequence = job.projectionSequence;
  if (job.profileProjectionVersion !== SOLO_PROFILE_PROJECTION_VERSION
      || !uid
      || uid.length > 128
      || !/^[-0-9A-Z_a-z]{20}$/.test(roomId)
      || roomId !== job.roomId
      || !/^[a-f0-9]{40}$/.test(resultToken)
      || resultToken !== job.resultToken
      || resultToken !== jobId
      || !["win", "loss", "draw"].includes(outcome)
      || outcome !== job.outcome
      || name !== job.name
      || pursuitLine !== job.pursuitLine
      || !Number.isSafeInteger(opponentRating)
      || opponentRating < 100
      || opponentRating > 3000
      || !Number.isSafeInteger(projectionSequence)
      || projectionSequence < 1
      || !Number.isSafeInteger(createdAt)
      || createdAt < 0) {
    throw new TypeError("invalid solo profile projection job");
  }
  return {
    profileProjectionVersion: SOLO_PROFILE_PROJECTION_VERSION,
    uid,
    roomId,
    resultToken,
    outcome,
    name,
    pursuitLine,
    opponentRating,
    projectionSequence,
    createdAt,
  };
}

function soloProjectionClaimMatchesJob(claim, job, {
  requirePending = false,
} = {}) {
  return claim.exists
    && claim.id === job.resultToken
    && claim.get("uid") === job.uid
    && claim.get("mode") === "solo"
    && claim.get("roomId") === job.roomId
    && claim.get("outcome") === job.outcome
    && claim.get("profileProjectionVersion") === SOLO_PROFILE_PROJECTION_VERSION
    && claim.get("projectionSequence") === job.projectionSequence
    && claim.get("opponentRating") === job.opponentRating
    && claim.get("name") === job.name
    && claim.get("pursuitLine") === job.pursuitLine
    && claim.get("createdAt") === job.createdAt
    && (!requirePending || claim.get("profileProjectionStatus") === "pending");
}

function sameSoloProjectionJob(left, right) {
  return left.profileProjectionVersion === right.profileProjectionVersion
    && left.uid === right.uid
    && left.roomId === right.roomId
    && left.resultToken === right.resultToken
    && left.outcome === right.outcome
    && left.name === right.name
    && left.pursuitLine === right.pursuitLine
    && left.opponentRating === right.opponentRating
    && left.projectionSequence === right.projectionSequence
    && left.createdAt === right.createdAt;
}

function soloProjectionLeaseIsCurrent(queueSnapshot, uid, lease, now) {
  return queueSnapshot.exists
    && queueSnapshot.id === uid
    && queueSnapshot.get("uid") === uid
    && queueSnapshot.get("pending") === true
    && queueSnapshot.get("leaseToken") === lease.token
    && Number(queueSnapshot.get("leaseUntil") || 0) > now;
}

function nextSoloProjectionSequence(queueSnapshot) {
  const current = queueSnapshot?.exists
    ? queueSnapshot.get("queueRevision")
    : 0;
  if (!Number.isSafeInteger(current)
      || current < 0
      || current >= Number.MAX_SAFE_INTEGER) {
    throw new TypeError("invalid solo profile projection queue revision");
  }
  return current + 1;
}

function soloProjectionQueueContainsSequence(queueSnapshot, projectionSequence) {
  const queueRevision = queueSnapshot.get("queueRevision");
  return Number.isSafeInteger(queueRevision)
    && queueRevision >= projectionSequence;
}

function soloProjectionIsAppliedOrFenced(profile, job) {
  const receiptOutcome = serverProjectionReceiptOutcome(profile, job.resultToken);
  if (receiptOutcome) return receiptOutcome === job.outcome;
  return Number.isSafeInteger(profile?.serverProjectionSequence)
    && profile.serverProjectionSequence >= job.projectionSequence;
}

function publicSoloProjectionProfile(value) {
  const profile = objectValue(value);
  if (!profile.name) return null;
  return {
    name: cleanName(profile.name),
    pursuitLine: cleanText(profile.pursuitLine, 40),
    wins: integer(profile.wins, 0, Number.MAX_SAFE_INTEGER, 0),
    losses: integer(profile.losses, 0, Number.MAX_SAFE_INTEGER, 0),
    draws: integer(profile.draws, 0, Number.MAX_SAFE_INTEGER, 0),
    streak: integer(profile.streak, 0, Number.MAX_SAFE_INTEGER, 0),
    bestStreak: integer(profile.bestStreak, 0, Number.MAX_SAFE_INTEGER, 0),
    rating: integer(profile.rating, 100, 3000, 1000),
    updatedAt: Number(profile.updatedAt || 0),
  };
}

function publicOverallProjectionProfile(value) {
  const profile = objectValue(value);
  if (!profile.name) return null;
  const modes = {};
  for (const mode of ["solo", "strategy", "team", "royale"]) {
    const source = objectValue(profile.modes?.[mode]);
    const wins = integer(source.wins, 0, Number.MAX_SAFE_INTEGER, 0);
    const losses = integer(source.losses, 0, Number.MAX_SAFE_INTEGER, 0);
    const draws = integer(source.draws, 0, Number.MAX_SAFE_INTEGER, 0);
    modes[mode] = {
      wins,
      losses,
      draws,
      matches: wins + losses + draws,
      points: (wins * 3) + draws,
    };
  }
  return {
    name: cleanName(profile.name),
    wins: Object.values(modes).reduce((sum, mode) => sum + mode.wins, 0),
    losses: Object.values(modes).reduce((sum, mode) => sum + mode.losses, 0),
    draws: Object.values(modes).reduce((sum, mode) => sum + mode.draws, 0),
    streak: integer(profile.streak, 0, Number.MAX_SAFE_INTEGER, 0),
    bestStreak: integer(profile.bestStreak, 0, Number.MAX_SAFE_INTEGER, 0),
    rating: integer(profile.rating, 100, 3000, 1000),
    modes,
    updatedAt: Number(profile.updatedAt || 0),
  };
}

async function readSoloProjectionProfiles(uid) {
  const [soloSnapshot, overallSnapshot] = await Promise.all([
    realtime.ref(`online/profiles/${uid}`).get(),
    realtime.ref(`online/overallProfiles/${uid}`).get(),
  ]);
  return {
    soloProfile: publicSoloProjectionProfile(soloSnapshot.val()),
    overallProfile: publicOverallProjectionProfile(overallSnapshot.val()),
  };
}

async function publishSoloProfileProjectionEnrollment(uid) {
  const result = await soloProfileProjectionEnrollmentRef(uid)
    .transaction((currentValue) => (
      currentValue === SOLO_PROFILE_PROJECTION_VERSION
        ? currentValue
        : SOLO_PROFILE_PROJECTION_VERSION
    ));
  if (result.snapshot.val() !== SOLO_PROFILE_PROJECTION_VERSION) {
    throw new Error("solo profile projection enrollment was not published");
  }
}

async function soloProfileProjectionHasIncompatibleLiveRoom(uid, now = Date.now()) {
  const [legacyRoom, v2Room] = await Promise.all([
    liveLegacySoloRoom(uid, now),
    liveSoloSessionV2Room(uid, now),
  ]);
  if (legacyRoom) return true;
  if (!v2Room) return false;
  const room = (await realtime.ref(`online/rooms/${v2Room.roomId}`).get()).val();
  return room?.players?.[uid]?.profileProjectionVersion
    !== SOLO_PROFILE_PROJECTION_VERSION;
}

async function acquireSoloProfileProjectionLease(uid, now = Date.now()) {
  const queueRef = soloProfileProjectionQueueRef(uid);
  const leaseToken = crypto.randomBytes(16).toString("hex");
  let lease = null;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(queueRef);
    if (!snapshot.exists || snapshot.get("pending") !== true) return;
    if (Number(snapshot.get("leaseUntil") || 0) > now) return;
    const queueRevision = snapshot.get("queueRevision");
    if (!Number.isSafeInteger(queueRevision) || queueRevision < 1) {
      throw new TypeError("invalid solo profile projection queue revision");
    }
    lease = {
      token: leaseToken,
      revision: queueRevision,
    };
    transaction.set(queueRef, {
      leaseToken,
      leaseUntil: now + SOLO_PROFILE_PROJECTION_LEASE_MS,
      lastStartedAt: now,
    }, { merge: true });
  });
  return lease;
}

async function releaseSoloProfileProjectionLease(
  uid,
  lease,
  {
    pending,
    failed = false,
    now = Date.now(),
  },
) {
  const queueRef = soloProfileProjectionQueueRef(uid);
  let finalPending = true;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(queueRef);
    if (!snapshot.exists || snapshot.get("leaseToken") !== lease.token) return;
    const revisionChanged = snapshot.get("queueRevision") !== lease.revision;
    finalPending = pending === true || revisionChanged;
    transaction.set(queueRef, {
      pending: finalPending,
      leaseToken: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      lastCompletedAt: failed ? snapshot.get("lastCompletedAt") || 0 : now,
      ...(failed
        ? {
          lastFailedAt: now,
          failureCount: integer(
            snapshot.get("failureCount"),
            0,
            Number.MAX_SAFE_INTEGER - 1,
            0,
          ) + 1,
        }
        : {
          lastFailedAt: FieldValue.delete(),
          failureCount: 0,
        }),
    }, { merge: true });
  });
  return finalPending;
}

async function prepareSoloProfileProjectionJob(jobSnapshot, lease) {
  const queueRef = jobSnapshot.ref.parent.parent;
  const queueUid = queueRef?.id || "";
  const claimRef = firestore.collection("verifiedMatchClaims").doc(jobSnapshot.id);
  let job = null;
  await firestore.runTransaction(async (transaction) => {
    const [queueSnapshot, freshJob, claim] = await Promise.all([
      transaction.get(queueRef),
      transaction.get(jobSnapshot.ref),
      transaction.get(claimRef),
    ]);
    if (!freshJob.exists) return;
    const checkedAt = Date.now();
    if (!soloProjectionLeaseIsCurrent(queueSnapshot, queueUid, lease, checkedAt)) {
      throw new Error("solo profile projection lease lost");
    }
    const candidate = normalizeSoloProjectionJob(freshJob.id, freshJob.data());
    if (queueUid !== candidate.uid
        || !soloProjectionQueueContainsSequence(
          queueSnapshot,
          candidate.projectionSequence,
        )
        || !soloProjectionClaimMatchesJob(claim, candidate, { requirePending: true })) {
      throw new TypeError("solo profile projection claim verification failed");
    }
    transaction.set(queueRef, {
      leaseUntil: checkedAt + SOLO_PROFILE_PROJECTION_LEASE_MS,
    }, { merge: true });
    job = candidate;
  });
  return job;
}

async function completeSoloProfileProjectionJob(jobSnapshot, job, lease) {
  const queueRef = jobSnapshot.ref.parent.parent;
  const claimRef = firestore.collection("verifiedMatchClaims").doc(job.resultToken);
  let completed = false;
  await firestore.runTransaction(async (transaction) => {
    const [queueSnapshot, freshJob, claim] = await Promise.all([
      transaction.get(queueRef),
      transaction.get(jobSnapshot.ref),
      transaction.get(claimRef),
    ]);
    if (!freshJob.exists) return;
    const checkedAt = Date.now();
    if (!soloProjectionLeaseIsCurrent(queueSnapshot, job.uid, lease, checkedAt)) {
      throw new Error("solo profile projection lease lost");
    }
    const currentJob = normalizeSoloProjectionJob(freshJob.id, freshJob.data());
    if (!sameSoloProjectionJob(currentJob, job)
        || !soloProjectionQueueContainsSequence(
          queueSnapshot,
          job.projectionSequence,
        )
        || !soloProjectionClaimMatchesJob(claim, job, { requirePending: true })) {
      throw new TypeError("solo profile projection claim verification failed");
    }
    transaction.set(claimRef, {
      profileProjectionStatus: "complete",
      profileProjectionCompletedAt: checkedAt,
    }, { merge: true });
    transaction.delete(jobSnapshot.ref);
    completed = true;
  });
  return completed;
}

async function applySoloProfileProjectionJob(jobSnapshot, lease) {
  const job = await prepareSoloProfileProjectionJob(jobSnapshot, lease);
  if (!job) return false;
  const event = {
    name: job.name,
    pursuitLine: job.pursuitLine,
    outcome: job.outcome,
    opponentRating: job.opponentRating,
    roomId: job.roomId,
    resultToken: job.resultToken,
    projectionSequence: job.projectionSequence,
    updatedAt: job.createdAt,
  };
  const soloRef = realtime.ref(`online/profiles/${job.uid}`);
  let soloProjectionError = null;
  const soloResult = await soloRef.transaction((currentValue) => {
    try {
      return projectNormalSoloProfile(currentValue, event).profile;
    } catch (error) {
      soloProjectionError = error;
      return undefined;
    }
  });
  if (soloProjectionError) throw soloProjectionError;
  const soloProfile = soloResult.snapshot.val();
  if (!soloProjectionIsAppliedOrFenced(soloProfile, job)) {
    throw new Error("solo profile projection verification failed");
  }

  const overallRef = realtime.ref(`online/overallProfiles/${job.uid}`);
  let overallProjectionError = null;
  const overallResult = await overallRef.transaction((currentValue) => {
    try {
      return projectOverallSoloProfile(currentValue, soloProfile, event).profile;
    } catch (error) {
      overallProjectionError = error;
      return undefined;
    }
  });
  if (overallProjectionError) throw overallProjectionError;
  const overallProfile = overallResult.snapshot.val();
  if (!soloProjectionIsAppliedOrFenced(overallProfile, job)) {
    throw new Error("overall profile projection verification failed");
  }

  return completeSoloProfileProjectionJob(jobSnapshot, job, lease);
}

async function quarantineSoloProfileProjectionJob(jobSnapshot, lease) {
  const queueRef = jobSnapshot.ref.parent.parent;
  const queueUid = queueRef?.id || "";
  const claimRef = firestore.collection("verifiedMatchClaims").doc(jobSnapshot.id);
  await firestore.runTransaction(async (transaction) => {
    const [queueSnapshot, freshJob, claim] = await Promise.all([
      transaction.get(queueRef),
      transaction.get(jobSnapshot.ref),
      transaction.get(claimRef),
    ]);
    if (!freshJob.exists) return;
    const checkedAt = Date.now();
    if (!soloProjectionLeaseIsCurrent(queueSnapshot, queueUid, lease, checkedAt)) {
      throw new Error("solo profile projection lease lost");
    }
    if (claim.exists
        && claim.get("uid") === queueUid
        && claim.get("mode") === "solo"
        && claim.get("profileProjectionVersion") === SOLO_PROFILE_PROJECTION_VERSION
        && claim.get("profileProjectionStatus") === "pending") {
      transaction.set(claimRef, {
        profileProjectionStatus: "failed",
        profileProjectionFailedAt: checkedAt,
      }, { merge: true });
    }
    transaction.delete(jobSnapshot.ref);
  });
}

async function reconcileSoloProfileProjection(uid, {
  maximumJobs = SOLO_PROFILE_PROJECTION_BATCH_SIZE,
} = {}) {
  const queueRef = soloProfileProjectionQueueRef(uid);
  const enrollmentQueueSnapshot = await queueRef.get();
  const projectionEnrolled = enrollmentQueueSnapshot.exists
    && enrollmentQueueSnapshot.get("profileProjectionEnrolled") === true
    && enrollmentQueueSnapshot.get("profileProjectionVersion")
      === SOLO_PROFILE_PROJECTION_VERSION;
  if (projectionEnrolled) {
    await publishSoloProfileProjectionEnrollment(uid);
  }
  const lease = await acquireSoloProfileProjectionLease(uid);
  if (!lease) {
    const [queueSnapshot, profiles] = await Promise.all([
      queueRef.get(),
      readSoloProjectionProfiles(uid),
    ]);
    return {
      ...profiles,
      pending: queueSnapshot.exists && queueSnapshot.get("pending") === true,
      processed: 0,
    };
  }

  let processed = 0;
  try {
    if (projectionEnrolled
        && await soloProfileProjectionHasIncompatibleLiveRoom(uid)) {
      const pending = await releaseSoloProfileProjectionLease(uid, lease, {
        pending: true,
      });
      return {
        ...await readSoloProjectionProfiles(uid),
        pending,
        processed,
      };
    }
    const jobs = await queueRef.collection("jobs")
      .orderBy("projectionSequence", "asc")
      .limit(integer(maximumJobs, 1, SOLO_PROFILE_PROJECTION_BATCH_SIZE, 1))
      .get();
    for (const jobSnapshot of jobs.docs) {
      try {
        if (await applySoloProfileProjectionJob(jobSnapshot, lease)) {
          processed += 1;
        }
      } catch (error) {
        const permanentFailure = error instanceof TypeError
          || error instanceof SoloProfileProjectionConflictError;
        if (!permanentFailure) throw error;
        await quarantineSoloProfileProjectionJob(jobSnapshot, lease);
        console.warn("solo profile projection job quarantined", {
          category: "validation",
        });
      }
    }
    const remaining = await queueRef.collection("jobs").limit(1).get();
    const pending = await releaseSoloProfileProjectionLease(uid, lease, {
      pending: !remaining.empty,
    });
    return {
      ...await readSoloProjectionProfiles(uid),
      pending,
      processed,
    };
  } catch (error) {
    await releaseSoloProfileProjectionLease(uid, lease, {
      pending: true,
      failed: true,
    }).catch(() => {});
    throw error;
  }
}

async function reconcilePendingSoloProfileProjections() {
  const queues = await firestore.collection("soloProfileProjectionQueues")
    .where("pending", "==", true)
    .orderBy("lastStartedAt", "asc")
    .limit(25)
    .get();
  let reconciled = 0;
  for (const queueSnapshot of queues.docs) {
    try {
      await reconcileSoloProfileProjection(queueSnapshot.id);
      reconciled += 1;
    } catch (error) {
      console.warn("solo profile projection queue deferred", {
        category: error instanceof TypeError ? "validation" : "internal",
      });
    }
  }
  return reconciled;
}

exports.reconcileSoloProfileProjections = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "Asia/Tokyo",
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 1,
}, async () => {
  try {
    await reconcilePendingSoloProfileProjections();
  } catch (error) {
    console.warn("solo profile projection reconciliation unavailable", {
      category: error instanceof TypeError ? "validation" : "internal",
    });
    throw new Error("solo profile projection reconciliation failed");
  }
});

function requestedSoloFinalizationVersion(data) {
  if (!Object.hasOwn(objectValue(data), "finalizationVersion")) return 1;
  if (data.finalizationVersion !== 2) {
    throw new HttpsError("invalid-argument", "通常型1on1の決着通信バージョンが不正です。");
  }
  return 2;
}

async function recordVerifiedMatch(uid, data) {
  const mode = cleanText(data?.mode, 16);
  const requestedOutcome = cleanText(data?.outcome, 16);
  const roomId = cleanText(data?.roomId, 80);
  const config = VERIFIED_MATCH_MODES[mode];
  if (!config || !["win", "loss", "draw"].includes(requestedOutcome) || !/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
    throw new HttpsError("invalid-argument", "対戦報酬の検証情報が不足しています。");
  }

  const finalizationVersion = mode === "solo" ? requestedSoloFinalizationVersion(data) : 1;
  let now = Date.now();
  let room;
  if (mode === "solo") {
    const finalization = await finalizeSoloRoomResult(uid, roomId, requestedOutcome, now);
    if (finalization.pending) {
      return { outcome: "pending", missing: 1 };
    }
    room = finalization.room;
  } else {
    room = (await realtime.ref(`online/${config.roomRoot}/${roomId}`).get()).val();
  }
  const createdAt = Number(room?.createdAt || 0);
  const minimumRoomAge = 30_000;
  if (!room || room?.status !== "active" || room?.members?.[uid] !== true
    || !Number.isFinite(createdAt) || createdAt > now || createdAt < now - (12 * 60 * 60 * 1000)) {
    throw new HttpsError("failed-precondition", "完走済みの対戦ルームを確認できませんでした。");
  }
  if (createdAt > now - minimumRoomAge) {
    const retryAfterMs = Math.max(250, (createdAt + minimumRoomAge) - now);
    if (mode === "solo" && finalizationVersion === 1) {
      // finish-reply-v2 predecessors poll for only about nine seconds. Keep
      // their one in-flight call alive through the anti-farm window.
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs + 50));
      now = Date.now();
    } else {
      return {
        outcome: "pending",
        missing: 0,
        retryAfterMs,
      };
    }
  }
  const participants = matchParticipants(mode, room, config);
  const verification = validatedOutcomes(mode, room, participants, {
    requireServerFinalized: mode === "solo",
  });
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
  const projectionEligibleUids = mode === "solo"
    ? participants.filter((participantUid) => soloProfileProjectionEligible(room, participantUid))
    : [];
  const projectionEligibleUidSet = new Set(projectionEligibleUids);
  const projectionQueueRefs = projectionEligibleUids
    .map((participantUid) => soloProfileProjectionQueueRef(participantUid));
  const projectionActivatedUidSet = new Set();
  const projectionJobs = Object.fromEntries(projectionEligibleUids.map((participantUid) => {
    const resultToken = verifiedMatchClaimRef(participantUid, mode, roomId).id;
    return [
      participantUid,
      soloProfileProjectionJob(
        participantUid,
        roomId,
        room,
        verification.outcomes[participantUid],
        resultToken,
        now,
      ),
    ];
  }));
  const rankingEligibleMode = ACTIVE_SERVER_RANKING_MODES.includes(mode);
  const serverPeriodInfos = rankingEligibleMode
    ? activeServerRankingPeriodInfos(now).filter(({ period, key }) => (
      !isCrownCircuitPeriod(period, key)
    ))
    : [];
  const crownDailyKey = periodKey("daily", now);
  const crownRunEligible = rankingEligibleMode
    && isCrownCircuitPeriod("daily", crownDailyKey);
  const serverProfileRefs = participants.map((participantUid) => serverRankingProfileRef(participantUid));
  const serverEntryRefs = participants.flatMap((participantUid) => (
    serverPeriodInfos.map(({ period, key }) => serverRankingEntryRef(participantUid, period, key))
  ));
  const serverPeriodEntryRefs = participants.flatMap((participantUid) => (
    serverPeriodInfos.map(({ period, key }) => serverRankingPeriodEntryRef(participantUid, period, key))
  ));
  const crownRunRefs = crownRunEligible
    ? participants.map((participantUid) => crownCircuitRunRef(participantUid, crownDailyKey))
    : [];
  const crownPeriodEntryRefs = crownRunEligible
    ? participants.map((participantUid) => (
      crownCircuitPeriodEntryRef(participantUid, "daily", crownDailyKey)
    ))
    : [];
  const legacyServerRankingSeeds = (serverPeriodInfos.length || rankingEligibleMode)
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
  const crownRunResults = {};
  await firestore.runTransaction(async (transaction) => {
    transactionOutcome = "recorded";
    Object.keys(progressResults).forEach((key) => delete progressResults[key]);
    Object.keys(profileResults).forEach((key) => delete profileResults[key]);
    Object.keys(newlyUnlockedResults).forEach((key) => delete newlyUnlockedResults[key]);
    Object.keys(serverRankingProfileResults).forEach((key) => delete serverRankingProfileResults[key]);
    Object.keys(serverRankingEntryResults).forEach((key) => delete serverRankingEntryResults[key]);
    Object.keys(crownRunResults).forEach((key) => delete crownRunResults[key]);
    projectionActivatedUidSet.clear();
    const snapshots = await Promise.all([
      ...progressRefs.map((ref) => transaction.get(ref)),
      ...profileRefs.map((ref) => transaction.get(ref)),
      ...claimRefs.map((ref) => transaction.get(ref)),
      ...serverProfileRefs.map((ref) => transaction.get(ref)),
      ...serverEntryRefs.map((ref) => transaction.get(ref)),
      ...crownRunRefs.map((ref) => transaction.get(ref)),
      ...projectionQueueRefs.map((ref) => transaction.get(ref)),
    ]);
    const participantCount = participants.length;
    const serverEntryCount = serverEntryRefs.length;
    const progressSnapshots = snapshots.slice(0, participantCount);
    const profileSnapshots = snapshots.slice(participantCount, participantCount * 2);
    const claimSnapshots = snapshots.slice(participantCount * 2, participantCount * 3);
    const serverProfileSnapshots = snapshots.slice(participantCount * 3, participantCount * 4);
    const serverEntrySnapshots = snapshots.slice(
      participantCount * 4,
      (participantCount * 4) + serverEntryCount,
    );
    const crownRunSnapshots = snapshots.slice(
      (participantCount * 4) + serverEntryCount,
      (participantCount * 4) + serverEntryCount + crownRunRefs.length,
    );
    const postCrownOffset = (participantCount * 4)
      + serverEntryCount
      + crownRunRefs.length;
    const projectionQueueSnapshots = snapshots.slice(postCrownOffset);
    const projectionQueueSnapshotByUid = Object.fromEntries(
      projectionEligibleUids.map((participantUid, index) => [
        participantUid,
        projectionQueueSnapshots[index],
      ]),
    );
    const serverProfiles = Object.fromEntries(participants.map((participantUid, index) => [
      participantUid,
      normalizeServerRankingProfile(
        serverProfileSnapshots[index].exists
          ? serverProfileSnapshots[index].data()
          : legacyServerRankingSeeds[participantUid],
        {
          rating: 1000,
        },
      ),
    ]));
    transactionOutcome = claimSnapshots[participants.indexOf(uid)].exists ? "duplicate" : "recorded";
    participants.forEach((participantUid, index) => {
      if (claimSnapshots[index].exists) {
        const projectionStatus = claimSnapshots[index].get("profileProjectionStatus");
        if (projectionEligibleUidSet.has(participantUid)
            && claimSnapshots[index].get("profileProjectionVersion")
              === SOLO_PROFILE_PROJECTION_VERSION
            && (projectionStatus === "pending" || projectionStatus === "complete")) {
          projectionActivatedUidSet.add(participantUid);
        }
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
      const projectionQueueSnapshot = projectionQueueSnapshotByUid[participantUid];
      const projectionSequence = projectionEligibleUidSet.has(participantUid)
        ? nextSoloProjectionSequence(projectionQueueSnapshot)
        : 0;
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
      const verifiedClaim = {
        uid: participantUid,
        mode,
        roomId,
        outcome: participantOutcome,
        participants,
        activity: participantActivity,
        achievementIds: unlockResult.newlyUnlocked,
        finalizedBy: uid,
        createdAt: now,
        ...(projectionEligibleUidSet.has(participantUid)
          ? {
            profileProjectionVersion: SOLO_PROFILE_PROJECTION_VERSION,
            profileProjectionStatus: "pending",
            projectionSequence,
            opponentRating: projectionJobs[participantUid].opponentRating,
            name: projectionJobs[participantUid].name,
            pursuitLine: projectionJobs[participantUid].pursuitLine,
          }
          : {}),
      };
      transaction.create(claimRefs[index], verifiedClaim);
      if (projectionEligibleUidSet.has(participantUid)) {
        projectionActivatedUidSet.add(participantUid);
        transaction.create(
          soloProfileProjectionJobRef(participantUid, claimRefs[index].id),
          {
            ...projectionJobs[participantUid],
            projectionSequence,
          },
        );
        transaction.set(soloProfileProjectionQueueRef(participantUid), {
          uid: participantUid,
          pending: true,
          profileProjectionEnrolled: true,
          profileProjectionVersion: SOLO_PROFILE_PROJECTION_VERSION,
          queueRevision: projectionSequence,
          ...(
            Number.isFinite(projectionQueueSnapshot?.get("lastStartedAt"))
              && projectionQueueSnapshot.get("lastStartedAt") >= 0
              ? {}
              : { lastStartedAt: 0 }
          ),
          updatedAt: now,
        }, { merge: true });
      }

      const serverProfile = serverProfiles[participantUid];
      const opponentRating = rankingEligibleMode
        ? serverRankingOpponentRating(
          mode,
          room,
          participantUid,
          participants,
          serverProfiles,
        )
        : serverProfile.rating;
      const updatedServerProfile = rankingEligibleMode
        ? {
          ...serverProfile,
          rating: calculateServerRankingRating(
            serverProfile.rating,
            opponentRating,
            participantOutcome,
          ),
          competitiveRating: calculateServerRankingRating(
            serverProfile.rating,
            opponentRating,
            participantOutcome,
          ),
          serverMatches: serverProfile.serverMatches + 1,
          competitiveMatches: serverProfile.serverMatches + 1,
          firstRatedAt: serverProfile.firstRatedAt || now,
          updatedAt: now,
        }
        : {
          ...serverProfile,
          updatedAt: now,
        };
      if (rankingEligibleMode) {
        serverRankingProfileResults[participantUid] = updatedServerProfile;
        transaction.set(serverProfileRefs[index], updatedServerProfile);
      }
      if (updatedServerProfile.enabled
          && updatedServerProfile.entryId
          && serverPeriodInfos.length) {
        serverRankingEntryResults[participantUid] = {};
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
      const crownRunSnapshot = crownRunSnapshots[index];
      if (crownRunEligible
          && updatedServerProfile.enabled
          && updatedServerProfile.entryId
          && crownRunSnapshot?.exists) {
        const opponentUid = participants.find((candidateUid) => candidateUid !== participantUid);
        const opponentKey = opponentUid
          ? eventId(`${crownDailyKey}:${[participantUid, opponentUid].sort().join(":")}`)
          : "";
        const crownResult = addCrownRunResult(crownRunSnapshot.data(), {
          mode,
          outcome: participantOutcome,
          playerRating: serverProfile.rating,
          opponentRating,
          opponentKey,
          profile: updatedServerProfile,
          now,
        });
        if (crownResult.accepted) {
          crownRunResults[participantUid] = {
            [`daily:${crownDailyKey}`]: crownResult.run,
          };
          transaction.set(crownRunRefs[index], crownResult.run);
          transaction.set(crownPeriodEntryRefs[index], crownResult.run);
        }
      }
    });
  });
  const postMatchOperations = participants.flatMap((participantUid) => [
    mirrorEconomyProgress(participantUid, progressResults[participantUid]),
    syncCreatorCardGrowth(participantUid),
    ...(newlyUnlockedResults[participantUid]?.length
      ? [syncAchievementPublicSurfaces(participantUid, profileResults[participantUid])]
      : []),
  ]);
  if (Object.keys(serverRankingEntryResults).length) {
    postMatchOperations.push(mirrorServerRankingEntries(serverRankingEntryResults));
  }
  if (Object.keys(serverRankingProfileResults).length) {
    postMatchOperations.push(mirrorServerOverallProfiles(serverRankingProfileResults));
  }
  if (Object.keys(crownRunResults).length) {
    postMatchOperations.push(mirrorCrownCircuitEntries(crownRunResults));
  }
  await bestEffort("recordVerifiedMatch", postMatchOperations);
  const projectionResults = {};
  if (mode === "solo") {
    for (const participantUid of participants.filter(
      (participantUid) => projectionActivatedUidSet.has(participantUid),
    )) {
      try {
        projectionResults[participantUid] = await reconcileSoloProfileProjection(
          participantUid,
          { maximumJobs: 5 },
        );
      } catch (error) {
        console.warn("recordVerifiedMatch profile projection deferred", {
          category: error instanceof TypeError ? "validation" : "internal",
        });
        projectionResults[participantUid] = {
          ...await readSoloProjectionProfiles(participantUid).catch(() => ({
            soloProfile: null,
            overallProfile: null,
          })),
          pending: true,
          processed: 0,
        };
      }
    }
  }
  let callerProjectionActivated = projectionActivatedUidSet.has(uid);
  if (mode === "solo" && callerProjectionActivated) {
    const callerClaim = await claimRefs[participants.indexOf(uid)].get();
    const projectionStatus = callerClaim.get("profileProjectionStatus");
    callerProjectionActivated = callerClaim.exists
      && callerClaim.get("uid") === uid
      && callerClaim.get("mode") === "solo"
      && callerClaim.get("roomId") === roomId
      && callerClaim.get("profileProjectionVersion") === SOLO_PROFILE_PROJECTION_VERSION
      && (projectionStatus === "pending" || projectionStatus === "complete");
  }
  const progressResult = progressResults[uid];
  const marketSnapshot = await marketStatsRef(uid).get();
  return {
    outcome: transactionOutcome,
    ...(mode === "solo" ? { acceptedFinalizationVersion: finalizationVersion } : {}),
    ...(callerProjectionActivated
      ? {
        profileProjectionMode: "server-v2",
        profileProjectionPending: projectionResults[uid]?.pending !== false,
        soloProfile: projectionResults[uid]?.soloProfile || null,
        overallProfile: projectionResults[uid]?.overallProfile || null,
      }
      : {}),
    resultToken: eventId(`${uid}:${mode}:${roomId}`),
    daily: progressResult.daily,
    periodRewards: progressResult.periodRewards,
    dailyPlay: dailyPlayRewardSummary(progressResult.periodRewards, progressResult.dailyPlayClaims, now),
    serverRanking: serverRankingProfileResults[uid]
      ? {
        rating: serverRankingProfileResults[uid].rating,
        serverMatches: serverRankingProfileResults[uid].serverMatches,
      }
      : null,
    crownRun: crownRunResults[uid]?.[`daily:${crownDailyKey}`]
      ? publicCrownCircuitEntry(crownRunResults[uid][`daily:${crownDailyKey}`])
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
    throw new HttpsError("invalid-argument", "差し入れの対戦・相手・AnjuPay額を確認してください。");
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
  const verification = validatedOutcomes(request.mode, room, participants, {
    requireServerFinalized: request.mode === "solo" && Number(room.serverFinalized?.version) === 1,
  });
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
      ledgerConfigSnapshot,
    ] = await Promise.all([
      transaction.get(senderWalletRef),
      transaction.get(recipientWalletRef),
      transaction.get(senderClaimRef),
      transaction.get(recipientClaimRef),
      transaction.get(tipRef),
      transaction.get(anjuPayLedgerConfigRef()),
    ]);
    const senderWallet = walletData(senderWalletSnapshot);
    const recipientWallet = walletData(recipientWalletSnapshot);
    const senderBalanceBefore = senderWallet.balance;
    const recipientBalanceBefore = recipientWallet.balance;
    const now = Date.now();
    const senderActivated = stageAnjuPayOpening(
      transaction,
      senderWalletRef,
      senderWallet,
      ledgerConfigSnapshot,
      now,
    );
    const recipientActivated = stageAnjuPayOpening(
      transaction,
      recipientWalletRef,
      recipientWallet,
      ledgerConfigSnapshot,
      now,
    );
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
      persistAnjuPayOpening(
        transaction,
        senderWalletRef,
        senderWallet,
        senderActivated,
        now,
      );
      persistAnjuPayOpening(
        transaction,
        recipientWalletRef,
        recipientWallet,
        recipientActivated,
        now,
      );
      return;
    }

    const amount = transferPoints(senderWallet, recipientWallet, verified.amount);
    const groupId = anjuPayEntryId(`post-match-tip:${tipRef.id}`);
    appendAnjuPayEntry(transaction, senderWalletRef, senderWallet, ledgerConfigSnapshot, {
      entryId: groupId,
      groupId,
      kind: "post_match_tip_sent",
      category: "tip",
      labelKey: "anju_pay_post_match_tip_sent",
      status: "posted",
      delta: -amount,
      nominalAmount: amount,
      balanceBefore: senderBalanceBefore,
      balanceAfter: senderWallet.balance,
      components: [{
        kind: "post_match_tip",
        labelKey: "anju_pay_post_match_tip_sent",
        delta: -amount,
        nominalAmount: amount,
        status: "posted",
      }],
      details: { mode: verified.mode, counterpartyName: recipientName },
      occurredAt: now,
    });
    appendAnjuPayEntry(transaction, recipientWalletRef, recipientWallet, ledgerConfigSnapshot, {
      entryId: groupId,
      groupId,
      kind: "post_match_tip_received",
      category: "tip",
      labelKey: "anju_pay_post_match_tip_received",
      status: "posted",
      delta: amount,
      nominalAmount: amount,
      balanceBefore: recipientBalanceBefore,
      balanceAfter: recipientWallet.balance,
      components: [{
        kind: "post_match_tip",
        labelKey: "anju_pay_post_match_tip_received",
        delta: amount,
        nominalAmount: amount,
        status: "posted",
      }],
      details: { mode: verified.mode, counterpartyName: senderName },
      occurredAt: now,
    });
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

function anjuPayHistoryRequest(data) {
  const rawLimit = data?.limit;
  const limit = rawLimit === undefined || rawLimit === null
    ? ANJU_PAY_HISTORY_DEFAULT_LIMIT
    : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ANJU_PAY_HISTORY_MAX_LIMIT) {
    throw new HttpsError(
      "invalid-argument",
      `AnjuPay履歴の件数は1〜${ANJU_PAY_HISTORY_MAX_LIMIT}の整数で指定してください。`,
    );
  }
  const rawCursor = data?.cursor;
  if (rawCursor === undefined || rawCursor === null || rawCursor === "") {
    return { limit, cursor: null };
  }
  const cursor = Number(rawCursor);
  if (!Number.isSafeInteger(cursor) || cursor < 1) {
    throw new HttpsError("invalid-argument", "AnjuPay履歴の続き位置が正しくありません。");
  }
  return { limit, cursor };
}

async function getAnjuPayWallet(uid, data) {
  const { limit, cursor } = anjuPayHistoryRequest(data);
  await ensureWallet(uid);
  const wallet = walletRef(uid);
  let [walletSnapshot, ledgerConfigSnapshot] = await Promise.all([
    wallet.get(),
    anjuPayLedgerConfigRef().get(),
  ]);
  const availableBalance = safeBalance(walletSnapshot.get("balance"));
  if (!anjuPayLedgerEnabled(ledgerConfigSnapshot)) {
    return {
      available: false,
      schemaVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
      availableBalance,
      balance: availableBalance,
      historyStartedAt: null,
      entries: [],
      nextCursor: null,
      hasMore: false,
    };
  }
  if (!isAnjuPayWalletActive(walletSnapshot.data())) {
    await ensureWallet(uid);
    [walletSnapshot, ledgerConfigSnapshot] = await Promise.all([
      wallet.get(),
      anjuPayLedgerConfigRef().get(),
    ]);
    if (!anjuPayLedgerEnabled(ledgerConfigSnapshot)) {
      const currentBalance = safeBalance(walletSnapshot.get("balance"));
      return {
        available: false,
        schemaVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
        availableBalance: currentBalance,
        balance: currentBalance,
        historyStartedAt: null,
        entries: [],
        nextCursor: null,
        hasMore: false,
      };
    }
  }
  if (!isAnjuPayWalletActive(walletSnapshot.data())) {
    throw new HttpsError("internal", "AnjuPay履歴を初期化できませんでした。");
  }

  const walletSequence = integer(
    walletSnapshot.get("ledgerSequence"),
    0,
    Number.MAX_SAFE_INTEGER,
    0,
  );
  const sequenceUpperBound = cursor === null
    ? walletSequence
    : Math.min(walletSequence, cursor - 1);
  const query = wallet.collection("anjuPayEntries")
    .where("sequence", "<=", sequenceUpperBound)
    .orderBy("sequence", "desc");
  const historySnapshot = await query.limit(limit + 1).get();
  const hasMore = historySnapshot.docs.length > limit;
  const docs = historySnapshot.docs.slice(0, limit);
  const entries = docs.map((document) => sanitizeAnjuPayEntry(document.id, document.data()));
  const currentBalance = safeBalance(walletSnapshot.get("balance"));
  return {
    available: true,
    schemaVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
    availableBalance: currentBalance,
    balance: currentBalance,
    historyStartedAt: Number(walletSnapshot.get("historyStartedAt")),
    entries,
    nextCursor: hasMore && entries.length ? entries.at(-1).sequence : null,
    hasMore,
  };
}

async function votePatronPolicy(uid, request, data) {
  if (!request.app) {
    throw new HttpsError(
      "failed-precondition",
      "市場政策への投票には通信保護が必要です。ページを再読み込みしてください。",
    );
  }
  if (!hasGoogleIdentity(request) || !await hasLiveGoogleIdentity(uid)) {
    throw new HttpsError(
      "failed-precondition",
      "市場政策へ投票するにはGoogleでゲームデータを保護してください。",
    );
  }
  const policyId = normalizePolicyVote(data?.policyId);
  const actionId = cleanText(data?.actionId, 80);
  if (!policyId || !/^[A-Za-z0-9_-]{16,80}$/.test(actionId)) {
    throw new HttpsError("invalid-argument", "市場政策への投票内容が正しくありません。");
  }
  const seasonKey = periodKey("monthly");
  const policyRef = patronPolicyRef(seasonKey);
  const voteRef = patronPolicyVoteRef(uid, seasonKey);
  const actionRef = patronPolicyVoteActionRef(uid, seasonKey, actionId);
  const patronRef = patronageRef(uid);
  let patron = null;
  let repeated = false;
  await firestore.runTransaction(async (transaction) => {
    const [patronSnapshot, policySnapshot, voteSnapshot, actionSnapshot] = await Promise.all([
      transaction.get(patronRef),
      transaction.get(policyRef),
      transaction.get(voteRef),
      transaction.get(actionRef),
    ]);
    patron = normalizePatronage(patronSnapshot.data(), seasonKey);
    if (patron.tier < 1) {
      throw new HttpsError("failed-precondition", "今月の市場パトロンだけが政策へ投票できます。");
    }
    if (actionSnapshot.exists) {
      if (
        actionSnapshot.get("uid") !== uid
        || actionSnapshot.get("seasonKey") !== seasonKey
        || actionSnapshot.get("actionId") !== actionId
        || normalizePolicyVote(actionSnapshot.get("policyId")) !== policyId
      ) {
        throw new HttpsError("already-exists", "同じ操作IDに異なる投票内容は指定できません。");
      }
      repeated = true;
      return;
    }
    const policy = normalizePatronPolicy(policySnapshot.data(), seasonKey);
    const previousVote = voteSnapshot.get("uid") === uid
      && voteSnapshot.get("seasonKey") === seasonKey
      ? normalizePolicyVote(voteSnapshot.get("policyId"))
      : null;
    const now = Date.now();
    if (previousVote === policyId) {
      repeated = true;
      transaction.create(actionRef, {
        schemaVersion: 1,
        uid,
        seasonKey,
        actionId,
        policyId,
        outcome: "unchanged",
        createdAt: now,
      });
      return;
    }
    if (previousVote) {
      policy.votes[previousVote] = Math.max(0, policy.votes[previousVote] - 1);
    }
    policy.votes[policyId] += 1;
    policy.totalVotes = Object.values(policy.votes).reduce((sum, count) => sum + count, 0);
    policy.activePolicy = "balanced";
    for (const candidate of MARKET_POLICY_IDS) {
      if (policy.votes[candidate] > policy.votes[policy.activePolicy]) {
        policy.activePolicy = candidate;
      }
    }
    policy.updatedAt = now;
    transaction.set(policyRef, policy);
    transaction.set(voteRef, {
      schemaVersion: 1,
      uid,
      seasonKey,
      policyId,
      actionId,
      createdAt: voteSnapshot.get("createdAt") || now,
      updatedAt: now,
    });
    transaction.create(actionRef, {
      schemaVersion: 1,
      uid,
      seasonKey,
      actionId,
      policyId,
      outcome: "voted",
      createdAt: now,
    });
  });
  return {
    outcome: repeated ? "unchanged" : "voted",
    policyId,
    ...await ensurePatronFundRecognition(uid, patron),
  };
}

async function loadSoloFamiliarRollout() {
  const [configSnapshot, serverAuthoritySnapshot] = await Promise.all([
    soloFamiliarRolloutConfigRef().get(),
    realtime.ref("online/config/soloServerMatchmaking").get(),
  ]);
  return soloFamiliarRolloutFlags(
    cleanText(configSnapshot.get("stage"), 32),
    serverAuthoritySnapshot.val() === true,
  );
}

async function loadSoloFamiliarBook(uid, rollout = null) {
  const flags = rollout || await loadSoloFamiliarRollout();
  if (!flags.familiarBookEnabled) {
    return {
      rollout: flags,
      familiars: [],
      blocked: [],
      blockedCursor: "",
    };
  }
  const [bookSnapshot, blockPage] = await Promise.all([
    soloFamiliarBookRef(uid).collection("familiarEntries")
      .where("active", "==", true)
      .limit(SOLO_FAMILIAR_BOOK_LIMIT)
      .get(),
    loadSoloFamiliarBlockPage(uid),
  ]);
  return {
    rollout: flags,
    familiars: bookSnapshot.docs
      .map((snapshot) => publicSoloFamiliarBookEntry(snapshot.id, snapshot.data(), uid))
      .filter(Boolean),
    ...blockPage,
  };
}

async function loadSoloFamiliarBlockPage(uid, afterIdValue = "") {
  const afterId = cleanText(afterIdValue, 40);
  let blockQuery = soloFamiliarBlockRef(uid).collection("blockEntries")
    .orderBy("createdAt", "desc");
  if (afterId) {
    if (!/^[a-f0-9]{40}$/.test(afterId)) {
      throw new HttpsError("invalid-argument", "非表示一覧の続きを確認してください。");
    }
    const cursorSnapshot = await soloFamiliarBlockRef(uid)
      .collection("blockEntries")
      .doc(afterId)
      .get();
    if (!cursorSnapshot.exists || cursorSnapshot.get("ownerUid") !== uid) {
      throw new HttpsError("failed-precondition", "非表示一覧を最初から読み直してください。");
    }
    blockQuery = blockQuery.startAfter(cursorSnapshot);
  }
  const snapshot = await blockQuery.limit(SOLO_FAMILIAR_BLOCK_LIST_LIMIT + 1).get();
  const pageDocs = snapshot.docs.slice(0, SOLO_FAMILIAR_BLOCK_LIST_LIMIT);
  return {
    blocked: pageDocs
      .map((document) => publicSoloFamiliarBlockEntry(document.id, document.data(), uid))
      .filter(Boolean),
    blockedCursor: snapshot.size > SOLO_FAMILIAR_BLOCK_LIST_LIMIT
      ? pageDocs.at(-1)?.id || ""
      : "",
  };
}

async function loadCompletedSoloFamiliarMatch(uid, roomIdValue) {
  const roomId = cleanText(roomIdValue, 80);
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
    throw new HttpsError("invalid-argument", "通常型1on1の対戦情報を確認してください。");
  }
  const now = Date.now();
  const roomSnapshot = await realtime.ref(`online/rooms/${roomId}`).get();
  const room = roomSnapshot.val();
  const createdAt = Number(room?.createdAt || 0);
  if (!roomSnapshot.exists() || room?.status !== "active" || room?.members?.[uid] !== true
      || !Number.isFinite(createdAt) || createdAt > now - 30_000 || createdAt < now - (12 * 60 * 60 * 1000)) {
    throw new HttpsError("failed-precondition", "完走済みの通常型1on1を確認できませんでした。");
  }
  const config = VERIFIED_MATCH_MODES.solo;
  const participants = matchParticipants("solo", room, config);
  const verification = validatedOutcomes("solo", room, participants, {
    requireServerFinalized: Number(room.serverFinalized?.version) === 1,
  });
  if (verification.pending) {
    throw new HttpsError("failed-precondition", "両者の対戦結果がまだ確定していません。");
  }
  const claimSnapshots = await Promise.all(participants.map((participantUid) => (
    verifiedMatchClaimRef(participantUid, "solo", roomId).get()
  )));
  const claimsVerified = claimSnapshots.every((snapshot, index) => {
    const participantUid = participants[index];
    const claimParticipants = snapshot.get("participants");
    return snapshot.exists
      && snapshot.get("uid") === participantUid
      && snapshot.get("mode") === "solo"
      && snapshot.get("roomId") === roomId
      && Array.isArray(claimParticipants)
      && sameIds(claimParticipants.slice().sort(), participants);
  });
  if (!claimsVerified) {
    throw new HttpsError("failed-precondition", "検証済みの通常型1on1記録を確認できませんでした。");
  }
  const counterpartUid = participants.find((participantUid) => participantUid !== uid);
  if (!counterpartUid) throw new HttpsError("failed-precondition", "対戦相手を確認できませんでした。");
  return {
    roomId,
    room,
    participants,
    counterpartUid,
    names: Object.fromEntries(participants.map((participantUid) => [
      participantUid,
      cleanName(room.players?.[participantUid]?.name),
    ])),
  };
}

async function acceptSoloFamiliar(uid, data) {
  const rollout = await loadSoloFamiliarRollout();
  if (!rollout.familiarBookEnabled) {
    throw new HttpsError("failed-precondition", "顔なじみ帳はまだ公開されていません。");
  }
  const match = await loadCompletedSoloFamiliarMatch(uid, data?.roomId);
  const now = Date.now();
  const counterpartUid = match.counterpartUid;
  const orderedParticipants = match.participants.slice().sort();
  const firstUid = orderedParticipants[0];
  const secondUid = orderedParticipants[1];
  const ownIntentRef = soloFamiliarIntentRef(uid, match.roomId);
  const counterpartIntentRef = soloFamiliarIntentRef(counterpartUid, match.roomId);
  const pairRef = soloFamiliarPairRef(firstUid, secondUid);
  const entryIds = {
    [firstUid]: soloFamiliarEntryId(),
    [secondUid]: soloFamiliarEntryId(),
  };
  const firstBookRef = soloFamiliarBookRef(firstUid);
  const secondBookRef = soloFamiliarBookRef(secondUid);
  const firstEntryRef = soloFamiliarBookEntryRef(firstUid, entryIds[firstUid]);
  const secondEntryRef = soloFamiliarBookEntryRef(secondUid, entryIds[secondUid]);
  const blockPairRef = soloFamiliarBlockPairRef(firstUid, secondUid);

  await firestore.runTransaction(async (transaction) => {
    const [
      ownIntentSnapshot,
      counterpartIntentSnapshot,
      pairSnapshot,
      firstBookSnapshot,
      secondBookSnapshot,
      firstEntrySnapshot,
      secondEntrySnapshot,
      blockPairSnapshot,
    ] = await Promise.all([
      transaction.get(ownIntentRef),
      transaction.get(counterpartIntentRef),
      transaction.get(pairRef),
      transaction.get(firstBookRef),
      transaction.get(secondBookRef),
      transaction.get(firstEntryRef),
      transaction.get(secondEntryRef),
      transaction.get(blockPairRef),
    ]);
    const ownExisting = ownIntentSnapshot.data();
    if (ownIntentSnapshot.exists && (
      ownExisting?.uid !== uid
      || ownExisting?.counterpartUid !== counterpartUid
      || ownExisting?.roomId !== match.roomId
    )) {
      throw new HttpsError("failed-precondition", "顔なじみ希望の記録が一致しません。");
    }
    const ownIntentIsFresh = ownIntentSnapshot.exists
      && Number(ownExisting?.expiresAt || 0) >= now;
    const ownAcceptedAt = ownIntentIsFresh
      ? Number(ownExisting?.acceptedAt || now)
      : now;
    transaction.set(ownIntentRef, {
      schemaVersion: 1,
      uid,
      counterpartUid,
      roomId: match.roomId,
      acceptedAt: ownAcceptedAt,
      expiresAt: ownAcceptedAt + SOLO_FAMILIAR_INTENT_TTL_MS,
      deleteAt: Timestamp.fromMillis(ownAcceptedAt + SOLO_FAMILIAR_INTENT_TTL_MS + (7 * 24 * 60 * 60 * 1000)),
    });

    const counterpartIntent = counterpartIntentSnapshot.data();
    const counterpartAcceptedAt = Number(counterpartIntent?.acceptedAt || 0);
    const counterpartAccepted = counterpartIntentSnapshot.exists
      && counterpartIntent?.uid === counterpartUid
      && counterpartIntent?.counterpartUid === uid
      && counterpartIntent?.roomId === match.roomId
      && Number(counterpartIntent?.expiresAt || 0) >= now;
    const pair = pairSnapshot.data() || {};
    if (pair.active === true) return;
    if (!counterpartAccepted || blockPairSnapshot.exists
        || !canReactivateSoloFamiliarPair(pair, ownAcceptedAt, counterpartAcceptedAt)) return;

    const firstCount = integer(firstBookSnapshot.get("count"), 0, SOLO_FAMILIAR_BOOK_LIMIT, 0);
    const secondCount = integer(secondBookSnapshot.get("count"), 0, SOLO_FAMILIAR_BOOK_LIMIT, 0);
    const firstIncrement = firstEntrySnapshot.exists ? 0 : 1;
    const secondIncrement = secondEntrySnapshot.exists ? 0 : 1;
    if (firstCount + firstIncrement > SOLO_FAMILIAR_BOOK_LIMIT
        || secondCount + secondIncrement > SOLO_FAMILIAR_BOOK_LIMIT) return;

    const pairId = pairRef.id;
    const createdAt = now;
    transaction.set(pairRef, {
      schemaVersion: 1,
      participants: orderedParticipants,
      entryIds,
      active: true,
      createdAt,
      currentStartedAt: createdAt,
      endedAt: 0,
      lastReunionPriorityAt: Number(pair.lastReunionPriorityAt || 0),
      deleteAt: null,
      updatedAt: createdAt,
    });
    transaction.set(firstBookRef, {
      ownerUid: firstUid,
      count: firstCount + firstIncrement,
      updatedAt: createdAt,
    }, { merge: true });
    transaction.set(secondBookRef, {
      ownerUid: secondUid,
      count: secondCount + secondIncrement,
      updatedAt: createdAt,
    }, { merge: true });
    transaction.set(firstEntryRef, {
      ownerUid: firstUid,
      counterpartUid: secondUid,
      pairId,
      displayName: match.names[secondUid],
      createdAt,
      active: true,
      deleteAt: null,
    });
    transaction.set(secondEntryRef, {
      ownerUid: secondUid,
      counterpartUid: firstUid,
      pairId,
      displayName: match.names[firstUid],
      createdAt,
      active: true,
      deleteAt: null,
    });
  });
  return { received: true };
}

async function removeOrBlockSoloFamiliar(uid, data, block) {
  const rollout = await loadSoloFamiliarRollout();
  if (!rollout.familiarBookEnabled) {
    throw new HttpsError("failed-precondition", "顔なじみ帳はまだ公開されていません。");
  }
  const familiarId = cleanText(data?.familiarId, 40);
  if (!/^[a-f0-9]{40}$/.test(familiarId)) {
    throw new HttpsError("invalid-argument", "顔なじみ帳の項目を確認してください。");
  }
  const ownEntryRef = soloFamiliarBookRef(uid).collection("familiarEntries").doc(familiarId);
  const generatedBlockId = block ? soloFamiliarEntryId() : "";
  let changed = false;
  let counterpartForPermitCleanup = "";
  await firestore.runTransaction(async (transaction) => {
    const ownEntrySnapshot = await transaction.get(ownEntryRef);
    if (!ownEntrySnapshot.exists || ownEntrySnapshot.get("ownerUid") !== uid) return;
    const counterpartUid = cleanText(ownEntrySnapshot.get("counterpartUid"), 128);
    counterpartForPermitCleanup = counterpartUid;
    const pairId = cleanText(ownEntrySnapshot.get("pairId"), 40);
    if (!counterpartUid || !/^[a-f0-9]{40}$/.test(pairId)
        || pairId !== soloFamiliarPairId(uid, counterpartUid)) {
      throw new HttpsError("failed-precondition", "顔なじみ帳の内部記録が一致しません。");
    }
    const pairRef = soloFamiliarPairRef(uid, counterpartUid);
    const blockPairRef = soloFamiliarBlockPairRef(uid, counterpartUid);
    const [pairSnapshot, blockPairSnapshot] = await Promise.all([
      transaction.get(pairRef),
      transaction.get(blockPairRef),
    ]);
    const pairParticipants = (pairSnapshot.get("participants") || []).slice().sort();
    const pairEntryIds = pairSnapshot.get("entryIds") || {};
    const currentOwnEntryId = cleanText(pairEntryIds[uid], 40);
    const counterpartEntryId = cleanText(pairEntryIds[counterpartUid], 40);
    if (!pairSnapshot.exists
        || !sameIds(pairParticipants, [uid, counterpartUid].sort())
        || familiarId !== currentOwnEntryId
        || !/^[a-f0-9]{40}$/.test(currentOwnEntryId)
        || !/^[a-f0-9]{40}$/.test(counterpartEntryId)) {
      throw new HttpsError("failed-precondition", "顔なじみ関係の内部記録が一致しません。");
    }
    const currentOwnEntryRef = soloFamiliarBookEntryRef(uid, currentOwnEntryId);
    const counterpartEntryRef = soloFamiliarBookEntryRef(counterpartUid, counterpartEntryId);
    const ownBookRef = soloFamiliarBookRef(uid);
    const counterpartBookRef = soloFamiliarBookRef(counterpartUid);
    const ownBlockBookRef = soloFamiliarBlockRef(uid);
    const currentBlockEntryIds = blockPairSnapshot.get("entryIds") || {};
    const savedBlockId = cleanText(currentBlockEntryIds[uid], 40);
    const ownBlockId = /^[a-f0-9]{40}$/.test(savedBlockId)
      ? savedBlockId
      : generatedBlockId;
    const ownBlockRef = block ? soloFamiliarBlockEntryRef(uid, ownBlockId) : null;
    const [
      currentOwnEntrySnapshot,
      counterpartEntrySnapshot,
      ownBookSnapshot,
      counterpartBookSnapshot,
      ownBlockSnapshot,
      ownBlockBookSnapshot,
    ] = await Promise.all([
      transaction.get(currentOwnEntryRef),
      transaction.get(counterpartEntryRef),
      transaction.get(ownBookRef),
      transaction.get(counterpartBookRef),
      ownBlockRef ? transaction.get(ownBlockRef) : Promise.resolve(null),
      transaction.get(ownBlockBookRef),
    ]);
    const now = Date.now();
    const addingBlock = block && !ownBlockSnapshot?.exists;
    const ownEntryWasActive = currentOwnEntrySnapshot.exists
      && currentOwnEntrySnapshot.get("active") === true;
    const counterpartEntryWasActive = counterpartEntrySnapshot.exists
      && counterpartEntrySnapshot.get("active") === true;
    const currentBlockCount = integer(
      ownBlockBookSnapshot.get("count"),
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    );
    if (!block && pairSnapshot.get("active") !== true
        && !ownEntryWasActive && !counterpartEntryWasActive) {
      return;
    }
    const entryDeleteAt = Timestamp.fromMillis(
      now + SOLO_FAMILIAR_INTENT_TTL_MS + (7 * 24 * 60 * 60 * 1000),
    );
    if (currentOwnEntrySnapshot.exists) {
      transaction.set(currentOwnEntryRef, {
        active: false,
        endedAt: now,
        deleteAt: entryDeleteAt,
      }, { merge: true });
    }
    if (counterpartEntrySnapshot.exists) {
      transaction.set(counterpartEntryRef, {
        active: false,
        endedAt: now,
        deleteAt: entryDeleteAt,
      }, { merge: true });
    }
    transaction.set(ownBookRef, {
      ownerUid: uid,
      count: Math.max(
        0,
        integer(ownBookSnapshot.get("count"), 0, SOLO_FAMILIAR_BOOK_LIMIT, 0)
          - (ownEntryWasActive ? 1 : 0),
      ),
      updatedAt: now,
    }, { merge: true });
    transaction.set(counterpartBookRef, {
      ownerUid: counterpartUid,
      count: Math.max(0, integer(counterpartBookSnapshot.get("count"), 0, SOLO_FAMILIAR_BOOK_LIMIT, 0)
        - (counterpartEntryWasActive ? 1 : 0)),
      updatedAt: now,
    }, { merge: true });
    transaction.set(pairRef, {
      active: false,
      endedAt: now,
      deleteAt: Timestamp.fromMillis(
        now + SOLO_FAMILIAR_INTENT_TTL_MS + (7 * 24 * 60 * 60 * 1000),
      ),
      updatedAt: now,
    }, { merge: true });
    if (block) {
      const counterpartName = cleanName(ownEntrySnapshot.get("displayName"));
      transaction.set(ownBlockRef, {
        ownerUid: uid,
        targetUid: counterpartUid,
        displayName: counterpartName,
        createdAt: ownBlockSnapshot?.get("createdAt") || now,
        updatedAt: now,
      });
      transaction.set(ownBlockBookRef, {
        ownerUid: uid,
        count: currentBlockCount + (addingBlock ? 1 : 0),
        updatedAt: now,
      }, { merge: true });
      transaction.set(blockPairRef, {
        participants: [uid, counterpartUid].sort(),
        blockedBy: {
          ...(blockPairSnapshot.get("blockedBy") || {}),
          [uid]: true,
        },
        entryIds: {
          ...currentBlockEntryIds,
          [uid]: ownBlockId,
        },
        updatedAt: now,
      }, { merge: true });
    }
    changed = block || pairSnapshot.get("active") === true
      || ownEntryWasActive
      || counterpartEntryWasActive;
  });
  if (counterpartForPermitCleanup) {
    await cancelPendingSoloMatchPermit(uid, counterpartForPermitCleanup, {
      includeNormal: block,
    });
  }
  return { removed: true, blocked: block && changed };
}

async function unblockSoloFamiliar(uid, data) {
  const rollout = await loadSoloFamiliarRollout();
  if (!rollout.familiarBookEnabled) {
    throw new HttpsError("failed-precondition", "顔なじみ帳はまだ公開されていません。");
  }
  const blockId = cleanText(data?.blockId, 40);
  if (!/^[a-f0-9]{40}$/.test(blockId)) {
    throw new HttpsError("invalid-argument", "非表示項目を確認してください。");
  }
  const ownBlockRef = soloFamiliarBlockRef(uid).collection("blockEntries").doc(blockId);
  await firestore.runTransaction(async (transaction) => {
    const ownBlockSnapshot = await transaction.get(ownBlockRef);
    if (!ownBlockSnapshot.exists || ownBlockSnapshot.get("ownerUid") !== uid) return;
    const counterpartUid = cleanText(ownBlockSnapshot.get("targetUid"), 128);
    if (!counterpartUid) throw new HttpsError("failed-precondition", "非表示項目の内部記録が一致しません。");
    const ownBlockBookRef = soloFamiliarBlockRef(uid);
    const blockPairRef = soloFamiliarBlockPairRef(uid, counterpartUid);
    const [
      ownBlockBookSnapshot,
      blockPairSnapshot,
    ] = await Promise.all([
      transaction.get(ownBlockBookRef),
      transaction.get(blockPairRef),
    ]);
    const blockParticipants = (blockPairSnapshot.get("participants") || []).slice().sort();
    const blockedBy = { ...(blockPairSnapshot.get("blockedBy") || {}) };
    const entryIds = { ...(blockPairSnapshot.get("entryIds") || {}) };
    if (!blockPairSnapshot.exists
        || !sameIds(blockParticipants, [uid, counterpartUid].sort())
        || blockedBy[uid] !== true
        || entryIds[uid] !== blockId) {
      throw new HttpsError("failed-precondition", "非表示関係の内部記録が一致しません。");
    }
    const now = Date.now();
    transaction.delete(ownBlockRef);
    transaction.set(ownBlockBookRef, {
      ownerUid: uid,
      count: Math.max(
        0,
        integer(ownBlockBookSnapshot.get("count"), 0, Number.MAX_SAFE_INTEGER, 0) - 1,
      ),
      updatedAt: now,
    }, { merge: true });
    delete blockedBy[uid];
    delete entryIds[uid];
    if (Object.keys(blockedBy).length) {
      transaction.set(blockPairRef, { blockedBy, entryIds, updatedAt: now }, { merge: true });
    } else if (blockPairSnapshot.exists) {
      transaction.delete(blockPairRef);
    }
  });
  return { unblocked: true };
}

async function querySoloPairDocuments(collectionName, participantUid, activeOnly = false) {
  const records = new Map();
  let cursor = null;
  while (true) {
    let pairQuery = firestore.collection(collectionName)
      .where("participants", "array-contains", participantUid);
    if (activeOnly) pairQuery = pairQuery.where("active", "==", true);
    if (cursor) pairQuery = pairQuery.startAfter(cursor);
    const snapshot = await pairQuery.limit(500).get();
    snapshot.docs.forEach((document) => records.set(document.id, {
      id: document.id,
      data: document.data(),
    }));
    if (snapshot.size < 500) break;
    cursor = snapshot.docs.at(-1);
  }
  return [...records.values()];
}

function boundedSoloServerQueue(uid, queue, now, limit = 500) {
  const entries = Object.entries(queue && typeof queue === "object" ? queue : {})
    .filter(([candidateUid, entry]) => (
      isValidSoloServerQueueEntry(candidateUid, entry, now)
    ));
  const requester = entries.find(([candidateUid]) => candidateUid === uid);
  if (!requester) return {};
  const candidates = entries
    .filter(([candidateUid]) => candidateUid !== uid)
    .sort((first, second) => (
      Number(first[1].joinedAt) - Number(second[1].joinedAt)
      || first[0].localeCompare(second[0])
    ))
    .slice(0, Math.max(0, limit - 1));
  return Object.fromEntries([requester, ...candidates]);
}

async function blockedSoloPairIdsForQueue(uid, queue, now) {
  const candidateUids = Object.entries(queue && typeof queue === "object" ? queue : {})
    .filter(([candidateUid, entry]) => (
      candidateUid !== uid
      && isValidSoloServerQueueEntry(candidateUid, entry, now)
    ))
    .sort((first, second) => (
      Number(first[1].joinedAt) - Number(second[1].joinedAt)
      || first[0].localeCompare(second[0])
    ))
    .map(([candidateUid]) => candidateUid);
  const blockedPairIds = [];
  for (let offset = 0; offset < candidateUids.length; offset += 100) {
    const refs = candidateUids.slice(offset, offset + 100)
      .map((candidateUid) => soloFamiliarBlockPairRef(uid, candidateUid));
    const snapshots = refs.length ? await firestore.getAll(...refs) : [];
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) blockedPairIds.push(snapshot.id);
    });
  }
  return blockedPairIds;
}

function sanitizeSoloQueueCandidate(value) {
  const sampleCount = integer(value?.sampleCount, 0, 5, 0);
  return {
    uid: cleanText(value?.uid, 128),
    name: cleanName(value?.name),
    pursuitLine: cleanText(value?.pursuitLine, 40),
    streak: integer(value?.streak, 0, Number.MAX_SAFE_INTEGER, 0),
    rating: integer(value?.rating, 100, 3000, 1000),
    ratingPreference: cleanText(value?.ratingPreference, 24),
    allowPreferenceMismatch: value?.allowPreferenceMismatch === true,
    sampleCount,
    startingHp: 30 - (sampleCount * 5),
    joinedAt: Number(value?.joinedAt || 0),
    lastSeen: Number(value?.lastSeen || 0),
    state: cleanText(value?.state, 16),
    reunionPreference: value?.reunionPreference === true,
    ...(value?.profileProjectionVersion === 2 ? { profileProjectionVersion: 2 } : {}),
  };
}

function soloPermitPlayer(entry) {
  return {
    uid: entry.uid,
    name: entry.name,
    pursuitLine: entry.pursuitLine,
    streak: entry.streak,
    rating: entry.rating,
    sampleCount: entry.sampleCount,
    startingHp: entry.startingHp,
    ...(entry.profileProjectionVersion === 2 ? { profileProjectionVersion: 2 } : {}),
  };
}

function normalizeSoloPermitPlayer(value, expectedUid) {
  const uid = cleanText(value?.uid, 128);
  const name = cleanText(value?.name, 16);
  const pursuitLine = cleanText(value?.pursuitLine, 40);
  const rawSampleCount = Number(value?.sampleCount);
  const sampleCount = Number.isInteger(rawSampleCount)
    && rawSampleCount >= 0
    && rawSampleCount <= 5
    ? rawSampleCount
    : -1;
  const startingHp = 30 - (sampleCount * 5);
  const rawStreak = Number(value?.streak);
  const rawRating = Number(value?.rating);
  if (!expectedUid || uid !== expectedUid || !name || !pursuitLine
      || sampleCount < 0 || Number(value?.startingHp) !== startingHp
      || !Number.isInteger(rawStreak) || rawStreak < 0
      || !Number.isInteger(rawRating) || rawRating < 100 || rawRating > 3000) return null;
  return {
    uid,
    name,
    pursuitLine,
    streak: rawStreak,
    rating: rawRating,
    sampleCount,
    startingHp,
    ...(value?.profileProjectionVersion === 2 ? { profileProjectionVersion: 2 } : {}),
  };
}

function normalizeSoloMatchPermit(roomIdValue, value) {
  const roomId = cleanText(roomIdValue, 80);
  const hostUid = cleanText(value?.hostUid, 128);
  const guestUid = cleanText(value?.guestUid, 128);
  const createdAt = Number(value?.createdAt || 0);
  const expiresAt = Number(value?.expiresAt || 0);
  const reunion = value?.reunion === true;
  const hostPlayer = normalizeSoloPermitPlayer(value?.players?.[hostUid], hostUid);
  const guestPlayer = normalizeSoloPermitPlayer(value?.players?.[guestUid], guestUid);
  const pairId = cleanText(value?.pairId, 40);
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)
      || !hostUid || !guestUid || hostUid === guestUid
      || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt)
      || createdAt <= 0 || expiresAt <= createdAt
      || !hostPlayer || !guestPlayer
      || (reunion && !/^[a-f0-9]{40}$/.test(pairId))) return null;
  return {
    roomId,
    hostUid,
    guestUid,
    createdAt,
    expiresAt,
    reunion,
    ...(reunion ? { pairId } : {}),
    players: {
      [hostUid]: hostPlayer,
      [guestUid]: guestPlayer,
    },
  };
}

function soloPermitLockMatches(lock, permit, roomId, now = Date.now()) {
  return lock?.roomId === roomId
    && lock?.hostUid === permit.hostUid
    && lock?.guestUid === permit.guestUid
    && lock?.reunion === permit.reunion
    && Number(lock?.expiresAt || 0) === permit.expiresAt
    && Number(lock?.expiresAt || 0) > now;
}

async function soloPermitLocksStillOwned(roomId, permit, now = Date.now()) {
  const [hostLockSnapshot, guestLockSnapshot] = await Promise.all([
    realtime.ref(`online/soloMatchPermitLocks/${permit.hostUid}`).get(),
    realtime.ref(`online/soloMatchPermitLocks/${permit.guestUid}`).get(),
  ]);
  return soloPermitLockMatches(hostLockSnapshot.val(), permit, roomId, now)
    && soloPermitLockMatches(guestLockSnapshot.val(), permit, roomId, now);
}

function soloRoomPlayerMatchesPermit(value, permitPlayer) {
  return value?.uid === permitPlayer.uid
    && value?.name === permitPlayer.name
    && value?.pursuitLine === permitPlayer.pursuitLine
    && Number(value?.streak) === permitPlayer.streak
    && Number(value?.rating) === permitPlayer.rating
    && Number(value?.sampleCount) === permitPlayer.sampleCount
    && Number(value?.startingHp) === permitPlayer.startingHp
    && (value?.profileProjectionVersion === 2)
      === (permitPlayer.profileProjectionVersion === 2);
}

function soloRoomMatchesPermit(room, permit) {
  return room
    && room.hostUid === permit.hostUid
    && room.guestUid === permit.guestUid
    && ["offered", "active", "expired"].includes(room.status)
    && Number(room.createdAt) >= permit.createdAt
    && Number(room.createdAt) <= permit.expiresAt
    && room.members?.[permit.hostUid] === true
    && room.members?.[permit.guestUid] === true
    && soloRoomPlayerMatchesPermit(room.players?.[permit.hostUid], permit.players[permit.hostUid])
    && soloRoomPlayerMatchesPermit(room.players?.[permit.guestUid], permit.players[permit.guestUid])
    && (room.reunion === true) === permit.reunion;
}

function soloHostedRoomPayload(permit) {
  return {
    hostUid: permit.hostUid,
    guestUid: permit.guestUid,
    createdAt: permit.createdAt,
    status: "offered",
    ...(permit.reunion ? { reunion: true } : {}),
    members: {
      [permit.hostUid]: true,
      [permit.guestUid]: true,
    },
    players: permit.players,
  };
}

function soloHostedOfferPayload(roomId, permit) {
  return {
    roomId,
    fromUid: permit.hostUid,
    toUid: permit.guestUid,
    fromName: permit.players[permit.hostUid].name,
    createdAt: permit.createdAt,
  };
}

function soloHostedMatchResponse(roomId, permit) {
  return {
    outcome: "hosted",
    roomId,
    reunion: permit.reunion,
    candidate: permit.players[permit.guestUid],
  };
}

async function releaseSoloMatchPermitLocks(roomId, participantUids) {
  const result = await realtime.ref("online/soloMatchPermitLocks").transaction((currentValue) => {
    const current = objectValue(currentValue);
    const next = { ...current };
    participantUids.forEach((participantUid) => {
      if (next[participantUid]?.roomId === roomId) delete next[participantUid];
    });
    return next;
  }).catch(() => null);
  return result?.committed === true;
}

async function cleanupSoloMatchContext(roomIdValue, context = {}) {
  const roomId = cleanText(roomIdValue, 80);
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) return false;
  const permitRef = realtime.ref(`online/soloMatchPermits/${roomId}`);
  const roomRef = realtime.ref(`online/rooms/${roomId}`);
  const [permitSnapshot, roomSnapshot] = await Promise.all([
    permitRef.get(),
    roomRef.get(),
  ]);
  const permit = normalizeSoloMatchPermit(roomId, context.permit || permitSnapshot.val());
  let room = roomSnapshot.val();
  const lockHostUid = cleanText(context.hostUid, 128);
  const lockGuestUid = cleanText(context.guestUid, 128);
  const hostUid = permit?.hostUid || lockHostUid || cleanText(room?.hostUid, 128);
  const guestUid = permit?.guestUid || lockGuestUid || cleanText(room?.guestUid, 128);
  const participantUids = [...new Set([
    ...(Array.isArray(context.participantUids) ? context.participantUids : []),
    hostUid,
    guestUid,
  ].map((value) => cleanText(value, 128)).filter(Boolean))];
  let roomIsActive = room?.status === "active"
    && (!hostUid || room.hostUid === hostUid)
    && (!guestUid || room.guestUid === guestUid);

  if (!roomIsActive) {
    const roomResult = await roomRef.transaction((currentValue) => {
      if (!currentValue) return;
      if (hostUid && currentValue.hostUid && currentValue.hostUid !== hostUid) return;
      if (guestUid && currentValue.guestUid && currentValue.guestUid !== guestUid) return;
      if (currentValue.status === "active") return;
      if (!currentValue.status) return null;
      if (currentValue.status === "offered") return { ...currentValue, status: "expired" };
      return;
    });
    room = roomResult.snapshot.val();
    roomIsActive = room?.status === "active"
      && (!hostUid || room.hostUid === hostUid)
      && (!guestUid || room.guestUid === guestUid);
  }

  const cleanupTasks = [];
  if (guestUid) {
    cleanupTasks.push(
      realtime.ref(`online/offers/${guestUid}/${roomId}`).transaction((currentValue) => {
        if (!currentValue || currentValue.roomId !== roomId) return;
        if (hostUid && currentValue.fromUid !== hostUid) return;
        return null;
      }),
    );
  }
  participantUids.forEach((participantUid) => {
    const presenceOnline = roomIsActive
      && room?.presence?.[participantUid]?.online === true;
    if (roomIsActive && presenceOnline) return;
    cleanupTasks.push(
      realtime.ref(`online/active/${participantUid}`).transaction((currentValue) => (
        currentValue === roomId ? null : undefined
      )),
    );
  });
  if (hostUid) {
    if (roomIsActive) {
      cleanupTasks.push(
        realtime.ref(`online/queue/${hostUid}`).transaction((currentValue) => (
          currentValue?.roomId === roomId ? null : undefined
        )),
      );
    } else {
      cleanupTasks.push(
        realtime.ref(`online/queue/${hostUid}`).transaction((currentValue) => {
          if (!currentValue || currentValue.roomId !== roomId) return;
          const next = {
            ...currentValue,
            state: "waiting",
            lastSeen: Date.now(),
          };
          delete next.roomId;
          return next;
        }),
      );
    }
  }
  await Promise.all(cleanupTasks);

  if (roomIsActive && permit?.reunion === true) {
    const reunionConfirmed = await confirmSoloFamiliarReunionFromRoom(roomId, {
      permitValue: permit,
      roomValue: room,
    });
    if (!reunionConfirmed) {
      throw new Error(`solo familiar reunion cooldown confirmation failed: ${roomId}`);
    }
  }

  if (participantUids.length
      && !await releaseSoloMatchPermitLocks(roomId, participantUids)) {
    throw new Error(`solo match lock cleanup failed: ${roomId}`);
  }
  await permitRef.transaction((currentValue) => {
    if (!currentValue) return;
    if (hostUid && currentValue.hostUid !== hostUid) return;
    if (guestUid && currentValue.guestUid !== guestUid) return;
    return null;
  });
  return true;
}

async function cancelPendingSoloMatchPermit(
  firstUid,
  secondUid,
  { includeNormal = false } = {},
) {
  const [firstLockSnapshot, secondLockSnapshot] = await Promise.all([
    realtime.ref(`online/soloMatchPermitLocks/${firstUid}`).get(),
    realtime.ref(`online/soloMatchPermitLocks/${secondUid}`).get(),
  ]);
  const firstLock = firstLockSnapshot.val();
  const secondLock = secondLockSnapshot.val();
  const roomId = cleanText(firstLock?.roomId, 80);
  if (!roomId || roomId !== cleanText(secondLock?.roomId, 80)
      || (!includeNormal
        && (firstLock?.reunion !== true || secondLock?.reunion !== true))) return;
  const participantUids = [firstUid, secondUid].sort();
  const hostUid = cleanText(firstLock?.hostUid || secondLock?.hostUid, 128);
  const guestUid = cleanText(firstLock?.guestUid || secondLock?.guestUid, 128);
  await cleanupSoloMatchContext(roomId, {
    hostUid,
    guestUid,
    participantUids,
  });
}

async function maybeSweepExpiredSoloMatchPermits(now) {
  if (now - lastSoloMatchPermitSweepAt < SOLO_MATCH_PERMIT_SWEEP_INTERVAL_MS) return;
  lastSoloMatchPermitSweepAt = now;
  try {
    const [permitSnapshot, attemptSnapshot] = await Promise.all([
      realtime.ref("online/soloMatchPermits")
        .orderByChild("expiresAt")
        .endAt(now)
        .limitToFirst(20)
        .get(),
      realtime.ref("online/soloMatchAttempts")
        .orderByChild("expiresAt")
        .endAt(now)
        .limitToFirst(50)
        .get(),
    ]);
    await Promise.allSettled(Object.entries(objectValue(permitSnapshot.val())).map(async ([roomId, value]) => {
      const permit = normalizeSoloMatchPermit(roomId, value);
      const participantUids = permit ? [permit.hostUid, permit.guestUid] : [];
      await cleanupSoloMatchContext(roomId, {
        permit,
        hostUid: permit?.hostUid,
        guestUid: permit?.guestUid,
        participantUids,
      });
    }));
    await Promise.allSettled(Object.entries(objectValue(attemptSnapshot.val())).map(
      ([participantUid, value]) => (
        realtime.ref(`online/soloMatchAttempts/${participantUid}`).transaction((currentValue) => (
          currentValue
            && Number(currentValue.expiresAt || 0) <= now
            && Number(currentValue.expiresAt || 0) === Number(value?.expiresAt || 0)
            ? null
            : undefined
        ))
      ),
    ));
  } catch (error) {
    console.error("solo match permit sweep failed", error);
  }
}

async function loadExistingSoloHostedMatch(uid, now) {
  const ownLockSnapshot = await realtime.ref(`online/soloMatchPermitLocks/${uid}`).get();
  const ownLock = ownLockSnapshot.val();
  const roomId = cleanText(ownLock?.roomId, 80);
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) return null;
  const lockHostUid = cleanText(ownLock?.hostUid, 128);
  const lockGuestUid = cleanText(ownLock?.guestUid, 128);
  const participantUids = [lockHostUid, lockGuestUid].filter(Boolean);
  if (Number(ownLock?.expiresAt || 0) <= now) {
    await cleanupSoloMatchContext(roomId, {
      hostUid: lockHostUid,
      guestUid: lockGuestUid,
      participantUids,
    });
    return null;
  }

  const permitSnapshot = await realtime.ref(`online/soloMatchPermits/${roomId}`).get();
  const permit = normalizeSoloMatchPermit(roomId, permitSnapshot.val());
  if (!permit || (uid !== permit.hostUid && uid !== permit.guestUid)) {
    if (Number(ownLock?.acquiredAt || 0) > now - SOLO_MATCH_CONTEXT_RECOVERY_GRACE_MS) {
      return { outcome: "waiting" };
    }
    await cleanupSoloMatchContext(roomId, {
      hostUid: lockHostUid,
      guestUid: lockGuestUid,
      participantUids,
    });
    return null;
  }
  if (!await soloPermitLocksStillOwned(roomId, permit, now)) {
    await cleanupSoloMatchContext(roomId, { permit });
    return null;
  }

  const roomRef = realtime.ref(`online/rooms/${roomId}`);
  const roomSnapshot = await roomRef.get();
  const room = roomSnapshot.val();
  if (!soloRoomMatchesPermit(room, permit)) {
    if (permit.createdAt > now - SOLO_MATCH_CONTEXT_RECOVERY_GRACE_MS) {
      return { outcome: "waiting" };
    }
    await cleanupSoloMatchContext(roomId, { permit });
    return null;
  }
  if (room.status === "expired") {
    await cleanupSoloMatchContext(roomId, { permit });
    return null;
  }
  if (room.status === "offered"
      && await soloProfileProjectionParticipantsUpgradeRequired(
        Object.values(permit.players),
      )) {
    await cleanupSoloMatchContext(roomId, { permit });
    return { outcome: "waiting" };
  }
  const reservationUids = room.status === "active"
    ? [permit.hostUid, permit.guestUid]
    : [permit.hostUid];
  const reservationResults = await Promise.all(reservationUids.map((participantUid) => (
    realtime.ref(`online/active/${participantUid}`).transaction((currentValue) => (
      currentValue === null || currentValue === roomId ? roomId : undefined
    ))
  )));
  if (reservationResults.some((result) => !result.committed)) {
    await cleanupSoloMatchContext(roomId, { permit });
    return null;
  }
  if (room.status === "offered") {
    const hostQueueResult = await realtime.ref(`online/queue/${permit.hostUid}`)
      .transaction((currentValue) => {
        if (!currentValue || currentValue.uid !== permit.hostUid) return;
        if (currentValue.state !== "waiting"
            && !(currentValue.state === "offering" && currentValue.roomId === roomId)) return;
        return {
          ...currentValue,
          state: "offering",
          roomId,
          lastSeen: Date.now(),
        };
      });
    if (!hostQueueResult.committed) {
      await cleanupSoloMatchContext(roomId, { permit });
      return null;
    }
  }
  if (room.status === "offered") {
    const offerRef = realtime.ref(`online/offers/${permit.guestUid}/${roomId}`);
    const offerSnapshot = await offerRef.get();
    const offer = offerSnapshot.val();
    const offerMatches = offer?.roomId === roomId
      && offer?.fromUid === permit.hostUid
      && offer?.toUid === permit.guestUid;
    if (!offerMatches) {
      if (!await soloPermitLocksStillOwned(roomId, permit)) {
        await cleanupSoloMatchContext(roomId, { permit });
        return null;
      }
      await offerRef.set(soloHostedOfferPayload(roomId, permit));
      if (!await soloPermitLocksStillOwned(roomId, permit)) {
        await cleanupSoloMatchContext(roomId, { permit });
        return null;
      }
    }
  }
  if (uid === permit.hostUid) return soloHostedMatchResponse(roomId, permit);
  if (room.status === "active") return { outcome: "join", roomId };
  return { outcome: "waiting" };
}

async function acquireSoloMatchAttempt(uid, now) {
  const result = await realtime.ref(`online/soloMatchAttempts/${uid}`).transaction((currentValue) => {
    const lastAttemptAt = Number(currentValue?.lastAttemptAt || 0);
    if (lastAttemptAt > now - SOLO_MATCH_ATTEMPT_MIN_INTERVAL_MS) return;
    return {
      lastAttemptAt: now,
      expiresAt: now + SOLO_MATCH_ATTEMPT_RETENTION_MS,
    };
  });
  return result.committed;
}

async function materializeSoloHostedMatch(roomId, permit) {
  if (await soloProfileProjectionParticipantsUpgradeRequired(
    Object.values(permit.players),
  )) {
    await cleanupSoloMatchContext(roomId, { permit });
    return false;
  }
  if (!await soloPermitLocksStillOwned(roomId, permit)) return false;
  const hostActiveRef = realtime.ref(`online/active/${permit.hostUid}`);
  const reservation = await hostActiveRef.transaction((currentValue) => (
    currentValue === null || currentValue === roomId ? roomId : undefined
  ));
  if (!reservation.committed) return false;

  const hostQueueRef = realtime.ref(`online/queue/${permit.hostUid}`);
  const queueResult = await hostQueueRef.transaction((currentValue) => {
    if (!currentValue || currentValue.uid !== permit.hostUid) return;
    if (currentValue.state !== "waiting"
        && !(currentValue.state === "offering" && currentValue.roomId === roomId)) return;
    return {
      ...currentValue,
      state: "offering",
      roomId,
      lastSeen: Date.now(),
    };
  });
  if (!queueResult.committed || !await soloPermitLocksStillOwned(roomId, permit)) {
    await cleanupSoloMatchContext(roomId, { permit });
    return false;
  }
  if (await soloProfileProjectionParticipantsUpgradeRequired(
    Object.values(permit.players),
  )) {
    await cleanupSoloMatchContext(roomId, { permit });
    return false;
  }

  const roomRef = realtime.ref(`online/rooms/${roomId}`);
  const roomResult = await roomRef.transaction((currentValue) => {
    if (currentValue === null) return soloHostedRoomPayload(permit);
    if (soloRoomMatchesPermit(currentValue, permit)
        && (currentValue.status === "offered" || currentValue.status === "active")) return currentValue;
    return;
  });
  if (!roomResult.committed) {
    await cleanupSoloMatchContext(roomId, { permit });
    return false;
  }
  if (roomResult.snapshot.val()?.status === "offered") {
    await realtime.ref(`online/offers/${permit.guestUid}/${roomId}`)
      .set(soloHostedOfferPayload(roomId, permit));
  }
  if (!await soloPermitLocksStillOwned(roomId, permit)) {
    await cleanupSoloMatchContext(roomId, { permit });
    return false;
  }
  if (await soloProfileProjectionParticipantsUpgradeRequired(
    Object.values(permit.players),
  )) {
    await cleanupSoloMatchContext(roomId, { permit });
    return false;
  }
  return true;
}

async function trySoloServerMatch(uid) {
  const rollout = await loadSoloFamiliarRollout();
  if (!rollout.reunionEnabled) return { outcome: "disabled" };
  const requestStartedAt = Date.now();
  const [ownV2ClaimSnapshot, ownV2Room] = await Promise.all([
    soloSessionClaimRef(uid).get(),
    liveSoloSessionV2Room(uid, requestStartedAt),
  ]);
  const ownV2Claim = normalizeClaim(ownV2ClaimSnapshot.val());
  if ((ownV2Claim && ownV2Claim.expiresAt > requestStartedAt) || ownV2Room) {
    return { outcome: "waiting" };
  }
  await maybeSweepExpiredSoloMatchPermits(requestStartedAt);
  const existing = await loadExistingSoloHostedMatch(uid, Date.now());
  if (existing) return existing;
  if (!await acquireSoloMatchAttempt(uid, Date.now())) return { outcome: "waiting" };
  const selectionNow = Date.now();
  const [queueSnapshot, activeSnapshot, lockSnapshot] = await Promise.all([
    realtime.ref("online/queue").get(),
    realtime.ref("online/active").get(),
    realtime.ref("online/soloMatchPermitLocks").get(),
  ]);
  const queue = objectValue(queueSnapshot.val());
  const active = objectValue(activeSnapshot.val());
  const locks = objectValue(lockSnapshot.val());
  const boundedQueue = boundedSoloServerQueue(uid, queue, selectionNow);
  const ownQueue = sanitizeSoloQueueCandidate(boundedQueue[uid]);
  if (ownQueue.uid !== uid || Object.keys(boundedQueue).length < 2) {
    return { outcome: "waiting" };
  }
  if (await soloProfileProjectionParticipantsUpgradeRequired([ownQueue])) {
    return { outcome: "waiting" };
  }
  const [familiarPairs, blockedPairIds] = await Promise.all([
    querySoloPairDocuments("soloFamiliarPairs", uid, true),
    blockedSoloPairIdsForQueue(uid, boundedQueue, selectionNow),
  ]);
  const selection = selectSoloServerMatch({
    requesterUid: uid,
    queue: boundedQueue,
    active,
    familiarPairs,
    blockedPairIds,
    excludedUids: Object.keys(locks),
    now: selectionNow,
  });
  if (!selection) return { outcome: "waiting" };
  if (await soloProfileProjectionParticipantsUpgradeRequired([
    selection.host,
    selection.candidate,
  ])) {
    return { outcome: "waiting" };
  }

  const roomId = realtime.ref("online/rooms").push().key;
  if (!roomId) throw new HttpsError("unavailable", "対戦ルームを準備できませんでした。");
  const participantUids = [selection.host.uid, selection.candidate.uid];
  const lockAcquiredAt = Date.now();
  const lockExpiresAt = lockAcquiredAt + SOLO_MATCH_PERMIT_TTL_MS;
  const lockResult = await realtime.ref("online/soloMatchPermitLocks").transaction((currentValue) => {
    const current = objectValue(currentValue);
    if (participantUids.some((participantUid) => current[participantUid])) return;
    const next = { ...current };
    const lock = {
      roomId,
      hostUid: selection.host.uid,
      guestUid: selection.candidate.uid,
      acquiredAt: lockAcquiredAt,
      expiresAt: lockExpiresAt,
      reunion: selection.reunion === true,
    };
    participantUids.forEach((participantUid) => { next[participantUid] = lock; });
    return next;
  });
  if (!lockResult.committed) return { outcome: "waiting" };

  const crossVersionCheckedAt = Date.now();
  const [
    hostQueueSnapshot,
    candidateQueueSnapshot,
    hostActiveSnapshot,
    candidateActiveSnapshot,
    blockPairSnapshot,
    familiarPairSnapshot,
    hostV2ClaimSnapshot,
    candidateV2ClaimSnapshot,
    hostV2LockSnapshot,
    candidateV2LockSnapshot,
    hostV2Room,
    candidateV2Room,
  ] = await Promise.all([
    realtime.ref(`online/queue/${selection.host.uid}`).get(),
    realtime.ref(`online/queue/${selection.candidate.uid}`).get(),
    realtime.ref(`online/active/${selection.host.uid}`).get(),
    realtime.ref(`online/active/${selection.candidate.uid}`).get(),
    soloFamiliarBlockPairRef(selection.host.uid, selection.candidate.uid).get(),
    soloFamiliarPairRef(selection.host.uid, selection.candidate.uid).get(),
    soloSessionClaimRef(selection.host.uid).get(),
    soloSessionClaimRef(selection.candidate.uid).get(),
    realtime.ref(`online/soloMatchLocksV2/${selection.host.uid}`).get(),
    realtime.ref(`online/soloMatchLocksV2/${selection.candidate.uid}`).get(),
    liveSoloSessionV2Room(selection.host.uid, crossVersionCheckedAt),
    liveSoloSessionV2Room(selection.candidate.uid, crossVersionCheckedAt),
  ]);
  const validationNow = Date.now();
  const hostQueueValue = hostQueueSnapshot.val();
  const candidateQueueValue = candidateQueueSnapshot.val();
  const freshAndWaiting = isValidSoloServerQueueEntry(
    selection.host.uid,
    hostQueueValue,
    validationNow,
  ) && isValidSoloServerQueueEntry(
    selection.candidate.uid,
    candidateQueueValue,
    validationNow,
  );
  const hostQueue = sanitizeSoloQueueCandidate(hostQueueValue);
  const candidateQueue = sanitizeSoloQueueCandidate(candidateQueueValue);
  const hostV2Claim = normalizeClaim(hostV2ClaimSnapshot.val());
  const candidateV2Claim = normalizeClaim(candidateV2ClaimSnapshot.val());
  const v2SessionConflict = Boolean(
    (hostV2Claim && hostV2Claim.expiresAt > validationNow)
      || (candidateV2Claim && candidateV2Claim.expiresAt > validationNow)
      || Number(hostV2LockSnapshot.val()?.expiresAt || 0) > validationNow
      || Number(candidateV2LockSnapshot.val()?.expiresAt || 0) > validationNow
      || hostV2Room
      || candidateV2Room,
  );
  const preferenceStillCompatible = Number.isFinite(
    soloQueuePreferenceTier(hostQueue, candidateQueue),
  );
  const reunionStillValid = !selection.reunion || (
    hostQueue.reunionPreference === true
    && candidateQueue.reunionPreference === true
    && familiarPairSnapshot.exists
    && familiarPairSnapshot.get("active") === true
    && Number(familiarPairSnapshot.get("lastReunionPriorityAt") || 0)
      <= validationNow - SOLO_FAMILIAR_REUNION_COOLDOWN_MS
  );
  if (!freshAndWaiting || v2SessionConflict || !preferenceStillCompatible
      || hostActiveSnapshot.exists() || candidateActiveSnapshot.exists()
      || blockPairSnapshot.exists || !reunionStillValid) {
    await releaseSoloMatchPermitLocks(roomId, participantUids);
    return { outcome: "waiting" };
  }
  const [hostLockSnapshot, candidateLockSnapshot] = await Promise.all([
    realtime.ref(`online/soloMatchPermitLocks/${selection.host.uid}`).get(),
    realtime.ref(`online/soloMatchPermitLocks/${selection.candidate.uid}`).get(),
  ]);
  const locksStillOwned = [hostLockSnapshot.val(), candidateLockSnapshot.val()].every((lock) => (
    lock?.roomId === roomId
    && lock?.hostUid === selection.host.uid
    && lock?.guestUid === selection.candidate.uid
    && Number(lock?.expiresAt || 0) === lockExpiresAt
    && Number(lock?.expiresAt || 0) > validationNow
    && lock?.reunion === (selection.reunion === true)
  ));
  const permitIssuedAt = Date.now();
  if (!locksStillOwned
      || lockExpiresAt - permitIssuedAt < SOLO_MATCH_MIN_REMAINING_PERMIT_MS) {
    await releaseSoloMatchPermitLocks(roomId, participantUids);
    return { outcome: "waiting" };
  }
  const permit = {
    hostUid: selection.host.uid,
    guestUid: selection.candidate.uid,
    createdAt: permitIssuedAt,
    expiresAt: lockExpiresAt,
    reunion: selection.reunion === true,
    players: {
      [hostQueue.uid]: soloPermitPlayer(hostQueue),
      [candidateQueue.uid]: soloPermitPlayer(candidateQueue),
    },
  };
  if (selection.reunion) permit.pairId = selection.pairId;
  await realtime.ref(`online/soloMatchPermits/${roomId}`).set(permit);
  const normalizedPermit = normalizeSoloMatchPermit(roomId, permit);
  if (!normalizedPermit || !await soloPermitLocksStillOwned(roomId, normalizedPermit)) {
    await cleanupSoloMatchContext(roomId, {
      permit: normalizedPermit || permit,
      hostUid: selection.host.uid,
      guestUid: selection.candidate.uid,
      participantUids,
    });
    return { outcome: "waiting" };
  }
  if (!await materializeSoloHostedMatch(roomId, normalizedPermit)) {
    return { outcome: "waiting" };
  }
  const [finalBlockSnapshot, finalLocksOwned] = await Promise.all([
    soloFamiliarBlockPairRef(selection.host.uid, selection.candidate.uid).get(),
    soloPermitLocksStillOwned(roomId, normalizedPermit),
  ]);
  if (finalBlockSnapshot.exists || !finalLocksOwned) {
    await cancelPendingSoloMatchPermit(selection.host.uid, selection.candidate.uid, {
      includeNormal: true,
    });
    return { outcome: "waiting" };
  }
  return soloHostedMatchResponse(roomId, normalizedPermit);
}

async function confirmSoloFamiliarReunionFromRoom(
  roomIdValue,
  { requiredMemberUid = "", permitValue = null, roomValue = null } = {},
) {
  const roomId = cleanText(roomIdValue, 80);
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) return false;
  let permit = normalizeSoloMatchPermit(roomId, permitValue);
  let room = roomValue;
  if (!permit || !room) {
    const [permitSnapshot, roomSnapshot] = await Promise.all([
      permit ? Promise.resolve(null) : realtime.ref(`online/soloMatchPermits/${roomId}`).get(),
      room ? Promise.resolve(null) : realtime.ref(`online/rooms/${roomId}`).get(),
    ]);
    if (!permit) permit = normalizeSoloMatchPermit(roomId, permitSnapshot?.val());
    if (!room) room = roomSnapshot?.val();
  }
  if (!permit || permit.reunion !== true || room?.status !== "active"
      || !soloRoomMatchesPermit(room, permit)
      || permit.pairId !== soloFamiliarPairId(permit.hostUid, permit.guestUid)
      || (requiredMemberUid && room.members?.[requiredMemberUid] !== true)) return false;
  const participants = [permit.hostUid, permit.guestUid].sort();
  const roomCreatedAt = Number(room.createdAt);
  const pairRef = firestore.collection("soloFamiliarPairs").doc(permit.pairId);
  const reunionRef = soloFamiliarReunionRef(roomId);
  const confirmed = await firestore.runTransaction(async (transaction) => {
    const [pairSnapshot, reunionSnapshot] = await Promise.all([
      transaction.get(pairRef),
      transaction.get(reunionRef),
    ]);
    if (reunionSnapshot.exists) return true;
    if (!pairSnapshot.exists
        || !sameIds((pairSnapshot.get("participants") || []).slice().sort(), participants)) return false;
    const now = Date.now();
    transaction.update(pairRef, {
      lastReunionPriorityAt: Math.max(
        Number(pairSnapshot.get("lastReunionPriorityAt") || 0),
        roomCreatedAt,
      ),
      updatedAt: now,
    });
    transaction.create(reunionRef, {
      pairId: permit.pairId,
      roomId,
      createdAt: roomCreatedAt,
      confirmedAt: now,
      deleteAt: Timestamp.fromMillis(
        roomCreatedAt + SOLO_FAMILIAR_REUNION_COOLDOWN_MS + (7 * 24 * 60 * 60 * 1000),
      ),
    });
    return true;
  });
  return confirmed === true;
}

async function confirmSoloFamiliarReunion(uid, data) {
  const rollout = await loadSoloFamiliarRollout();
  if (!rollout.reunionEnabled) return { confirmed: false };
  const roomId = cleanText(data?.roomId, 80);
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
    throw new HttpsError("invalid-argument", "再会ルームを確認してください。");
  }
  return {
    confirmed: await confirmSoloFamiliarReunionFromRoom(roomId, {
      requiredMemberUid: uid,
    }),
  };
}

const SOLO_SESSION_ACTION_RATE_POLICIES = Object.freeze({
  claim: Object.freeze({ windowMs: 60_000, limit: 12 }),
  heartbeat: Object.freeze({ windowMs: 60_000, limit: 12 }),
  release: Object.freeze({ windowMs: 60_000, limit: 30 }),
  try_match: Object.freeze({ windowMs: 60_000, limit: 90 }),
  accept: Object.freeze({ windowMs: 60_000, limit: 30 }),
  cancel: Object.freeze({ windowMs: 60_000, limit: 30 }),
  expire: Object.freeze({ windowMs: 60_000, limit: 30 }),
  reconcile_profile: Object.freeze({ windowMs: 60_000, limit: 20 }),
});

function soloSessionPathSegment(value, label) {
  if (!isSafeToken(value)) {
    throw new HttpsError("invalid-argument", `${label}を確認してください。`);
  }
  return value;
}

function soloSessionRoomId(value) {
  const roomId = cleanText(value, 80);
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
    throw new HttpsError("invalid-argument", "対戦ルームを確認してください。");
  }
  return roomId;
}

function requireSoloSessionActionData(value) {
  if (!isPlainCallableObject(value)) {
    throw new HttpsError("invalid-argument", "通常版1on1セッションの形式が正しくありません。");
  }
  const action = cleanText(value.action, 24);
  const keysByAction = {
    claim: new Set([
      "action",
      "sessionId",
      "leaseToken",
      "sameSessionOwnerConfirmedGone",
      "profileProjectionVersion",
    ]),
    heartbeat: new Set(["action", "sessionId", "leaseToken", "generation"]),
    release: new Set(["action", "sessionId", "leaseToken", "generation"]),
    try_match: new Set(["action", "sessionId", "leaseToken", "avoidUid"]),
    accept: new Set(["action", "sessionId", "leaseToken", "roomId"]),
    cancel: new Set(["action", "sessionId", "leaseToken", "roomId", "abort"]),
    expire: new Set(["action", "sessionId", "leaseToken", "roomId"]),
  };
  const allowedKeys = keysByAction[action];
  if (!allowedKeys
      || Reflect.ownKeys(value).some((key) => (
        typeof key !== "string" || !allowedKeys.has(key)
      ))) {
    throw new HttpsError("invalid-argument", "未対応の通常版1on1セッション操作です。");
  }
  const requiredKeys = ["action", "sessionId", "leaseToken"];
  if (!requiredKeys.every((key) => Object.hasOwn(value, key))) {
    throw new HttpsError("invalid-argument", "通常版1on1セッション情報が不足しています。");
  }
  const sessionId = soloSessionPathSegment(value.sessionId, "セッション");
  const leaseToken = soloSessionPathSegment(value.leaseToken, "セッション所有権");
  const result = { action, sessionId, leaseToken };
  if (action === "heartbeat" || action === "release") {
    result.generation = soloSessionPathSegment(
      value.generation,
      "セッション世代",
    );
  }
  if (action === "claim") {
    if (Object.hasOwn(value, "sameSessionOwnerConfirmedGone")
        && typeof value.sameSessionOwnerConfirmedGone !== "boolean") {
      throw new HttpsError("invalid-argument", "セッション引き継ぎ情報を確認してください。");
    }
    result.sameSessionOwnerConfirmedGone = value.sameSessionOwnerConfirmedGone === true;
    if (Object.hasOwn(value, "profileProjectionVersion")
        && value.profileProjectionVersion !== SOLO_PROFILE_PROJECTION_VERSION) {
      throw new HttpsError("invalid-argument", "通常型1on1の戦績同期バージョンを確認してください。");
    }
    if (value.profileProjectionVersion === SOLO_PROFILE_PROJECTION_VERSION) {
      result.profileProjectionVersion = SOLO_PROFILE_PROJECTION_VERSION;
    }
  }
  if (action === "try_match" && Object.hasOwn(value, "avoidUid")) {
    const avoidUid = cleanText(value.avoidUid, 128);
    if (avoidUid && avoidUid !== value.avoidUid) {
      throw new HttpsError("invalid-argument", "再マッチ対象を確認してください。");
    }
    result.avoidUid = avoidUid;
  }
  if (["accept", "cancel", "expire"].includes(action)) {
    result.roomId = soloSessionRoomId(value.roomId);
  }
  if (action === "cancel") {
    if (Object.hasOwn(value, "abort") && typeof value.abort !== "boolean") {
      throw new HttpsError("invalid-argument", "対戦中断情報を確認してください。");
    }
    result.abort = value.abort === true;
  }
  return result;
}

function soloSessionActionRatePath(uid, action) {
  const ownerHash = crypto
    .createHash("sha256")
    .update("solo-session-action-rate:v2:")
    .update(uid)
    .digest("hex");
  return `online/soloSessionActionRates/${ownerHash}/${action}`;
}

async function consumeSoloSessionActionRate(uid, action) {
  const policy = SOLO_SESSION_ACTION_RATE_POLICIES[action];
  if (!policy) throw new HttpsError("invalid-argument", "未対応の通常版1on1操作です。");
  const now = Date.now();
  let allowed = false;
  const result = await realtime.ref(soloSessionActionRatePath(uid, action))
    .transaction((currentValue) => {
      const windowStartedAt = Number(currentValue?.windowStartedAt || 0);
      const inWindow = windowStartedAt > now - policy.windowMs
        && windowStartedAt <= now + 15_000;
      const count = inWindow ? Number(currentValue?.count || 0) : 0;
      allowed = Number.isInteger(count) && count >= 0 && count < policy.limit;
      if (!allowed) return;
      return {
        windowStartedAt: inWindow ? windowStartedAt : now,
        count: count + 1,
        lastAt: now,
        expiresAt: now + (2 * policy.windowMs),
      };
    });
  if (!result.committed || !allowed) {
    throw new HttpsError(
      "resource-exhausted",
      "通常版1on1の操作が短時間に集中しています。少し待ってからお試しください。",
    );
  }
}

function soloSessionClaimRef(uid) {
  return realtime.ref(`online/soloSessionClaims/${uid}`);
}

function soloSessionQueueRef(uid, sessionId) {
  return realtime.ref(`online/queueV2/${uid}/${sessionId}`);
}

function soloSessionActiveRef(uid, sessionId) {
  return realtime.ref(`online/activeV2/${uid}/${sessionId}`);
}

function soloSessionOfferRef(uid, sessionId, roomId) {
  return realtime.ref(`online/offersV2/${uid}/${sessionId}/${roomId}`);
}

function soloSessionGeneration() {
  return crypto.randomBytes(16).toString("base64url");
}

function soloSessionClaimGuardMatches(value, operationId) {
  return value?.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value?.kind === "claim"
    && value?.operationId === operationId;
}

async function acquireSoloSessionClaimGuard(uid, data) {
  const operationId = soloSessionGeneration();
  const now = Date.now();
  const guard = {
    protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
    kind: "claim",
    operationId,
    sessionId: data.sessionId,
    leaseToken: data.leaseToken,
    acquiredAt: now,
    expiresAt: now + SOLO_SESSION_CLAIM_GUARD_TTL_MS,
  };
  const result = await realtime.ref(`online/soloMatchLocksV2/${uid}`)
    .transaction((currentValue) => {
      if (Number(currentValue?.expiresAt || 0) > now
          && !soloSessionClaimGuardMatches(currentValue, operationId)) return;
      return guard;
    });
  return result.committed
    && soloSessionClaimGuardMatches(result.snapshot.val(), operationId)
    ? guard
    : null;
}

async function renewSoloSessionClaimGuard(uid, guard) {
  if (!guard) return null;
  const now = Date.now();
  const result = await realtime.ref(`online/soloMatchLocksV2/${uid}`)
    .transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!soloSessionClaimGuardMatches(currentValue, guard.operationId)
          || Number(currentValue.expiresAt || 0) <= now) return;
      return {
        ...currentValue,
        expiresAt: now + SOLO_SESSION_CLAIM_GUARD_TTL_MS,
      };
    });
  const renewed = result.snapshot.val();
  return result.committed
    && soloSessionClaimGuardMatches(renewed, guard.operationId)
    && Number(renewed.expiresAt || 0) > now
    ? renewed
    : null;
}

async function releaseSoloSessionClaimGuard(uid, guard) {
  if (!guard) return true;
  let safe = false;
  const result = await realtime.ref(`online/soloMatchLocksV2/${uid}`)
    .transaction((currentValue) => {
      if (currentValue == null) {
        safe = true;
        return null;
      }
      if (!soloSessionClaimGuardMatches(currentValue, guard.operationId)) {
        safe = false;
        return;
      }
      safe = true;
      return null;
    });
  return safe && (result.committed || result.snapshot.val() == null);
}

function legacySoloActiveValueMatches(currentValue, expectedValue) {
  if (typeof expectedValue === "string") return currentValue === expectedValue;
  return isPlainCallableObject(expectedValue)
    && isPlainCallableObject(currentValue)
    && JSON.stringify(currentValue) === JSON.stringify(expectedValue);
}

function legacySoloActiveInspectionRef(uid) {
  const ownerHash = crypto
    .createHash("sha256")
    .update("solo-legacy-active-inspection:v2:")
    .update(uid)
    .digest("hex");
  return realtime.ref(`online/soloLegacyActiveInspections/${ownerHash}`);
}

async function legacySoloRoomPreparationIsLive(uid, roomId, now) {
  const [permitSnapshot, lockSnapshot] = await Promise.all([
    realtime.ref(`online/soloMatchPermits/${roomId}`).get(),
    realtime.ref(`online/soloMatchPermitLocks/${uid}`).get(),
  ]);
  const permit = permitSnapshot.val();
  const lock = lockSnapshot.val();
  return Number(permit?.expiresAt || 0) > now
    && (permit?.hostUid === uid || permit?.guestUid === uid)
    && lock?.roomId === roomId
    && Number(lock?.expiresAt || 0) > now;
}

async function removeStaleLegacySoloActive(uid, expectedValue) {
  const result = await realtime.ref(`online/active/${uid}`).transaction((currentValue) => (
    legacySoloActiveValueMatches(currentValue, expectedValue) ? null : undefined
  ));
  return result.committed;
}

async function liveLegacySoloRoom(uid, now = Date.now(), { cleanupStale = false } = {}) {
  const activeRef = realtime.ref(`online/active/${uid}`);
  const activeSnapshot = await activeRef.get();
  if (!activeSnapshot.exists()) return null;
  const activeValue = activeSnapshot.val();
  const roomId = cleanText(
    typeof activeValue === "string" ? activeValue : activeValue?.roomId,
    80,
  );
  const inspectionRef = cleanupStale ? legacySoloActiveInspectionRef(uid) : null;
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
    if (cleanupStale) {
      await removeStaleLegacySoloActive(uid, activeValue);
      await inspectionRef.remove().catch(() => {});
    }
    return null;
  }
  const roomSnapshot = await realtime.ref(`online/rooms/${roomId}`).get();
  const room = roomSnapshot.val();
  const legacyRoom = room
    && room.protocolVersion !== SOLO_SESSION_PROTOCOL_VERSION
    && !room.destroyed
    && room.members?.[uid] === true;
  if (legacyRoom && room.status === "active") {
    const presence = room.presence?.[uid];
    const presenceUpdatedAt = Number(presence?.updatedAt || 0);
    const activeRoomIsLive = (presence?.online === true
        && presenceUpdatedAt >= now - SOLO_LEGACY_PRESENCE_FRESH_MS
        && presenceUpdatedAt <= now + 15_000)
      || (!presence
        && Number(room.createdAt || 0) >= now - 60_000
        && Number(room.createdAt || 0) <= now + 15_000);
    if (activeRoomIsLive) {
      await inspectionRef?.remove().catch(() => {});
      return { roomId, status: "active" };
    }
  }
  if (legacyRoom
      && room.status === "offered"
      && Number(room.createdAt || 0) >= now - 60_000
      && Number(room.createdAt || 0) <= now + 15_000) {
    await inspectionRef?.remove().catch(() => {});
    return { roomId, status: "offered" };
  }
  if (room) {
    if (cleanupStale) {
      await removeStaleLegacySoloActive(uid, activeValue);
      await inspectionRef.remove().catch(() => {});
    }
    return null;
  }
  if (await legacySoloRoomPreparationIsLive(uid, roomId, now)) {
    await inspectionRef?.remove().catch(() => {});
    return { roomId, status: "preparing" };
  }
  if (!cleanupStale) return null;

  const roomFingerprint = crypto
    .createHash("sha256")
    .update("solo-legacy-active-room:v2:")
    .update(roomId)
    .digest("hex");
  let staleConfirmed = false;
  await inspectionRef.transaction((currentValue) => {
    const sameObservation = currentValue?.roomFingerprint === roomFingerprint;
    const firstSeenAt = sameObservation ? Number(currentValue?.firstSeenAt || 0) : now;
    staleConfirmed = sameObservation && firstSeenAt <= now - SOLO_MATCH_CONTEXT_RECOVERY_GRACE_MS;
    return {
      roomFingerprint,
      firstSeenAt,
      lastSeenAt: now,
      expiresAt: now + 60_000,
    };
  });
  if (!staleConfirmed) return { roomId, status: "preparing" };

  const [activeRecheck, roomRecheck, pendingRecheck] = await Promise.all([
    activeRef.get(),
    realtime.ref(`online/rooms/${roomId}`).get(),
    legacySoloRoomPreparationIsLive(uid, roomId, Date.now()),
  ]);
  if (!legacySoloActiveValueMatches(activeRecheck.val(), activeValue)) {
    await inspectionRef.remove().catch(() => {});
    return liveLegacySoloRoom(uid, Date.now());
  }
  if (roomRecheck.exists() || pendingRecheck) {
    await inspectionRef.remove().catch(() => {});
    return liveLegacySoloRoom(uid, Date.now());
  }
  await removeStaleLegacySoloActive(uid, activeValue);
  await inspectionRef.remove().catch(() => {});
  return null;
}

function exactSoloSessionV2ActiveIdentity(value, expected, uid, sessionId) {
  return value?.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value.uid === uid
    && value.sessionId === sessionId
    && value.sessionId === expected?.sessionId
    && value.leaseToken === expected?.leaseToken
    && value.generation === expected?.generation
    && value.roomId === expected?.roomId
    && value.attemptId === expected?.attemptId
    && value.connectionGeneration === expected?.connectionGeneration;
}

async function removeExpiredSoloSessionV2Active(uid, sessionId, expected, now, {
  allowFresh = false,
} = {}) {
  const result = await soloSessionActiveRef(uid, sessionId)
    .transaction((currentValue) => {
      if (!exactSoloSessionV2ActiveIdentity(currentValue, expected, uid, sessionId)
          || (!allowFresh && Number(currentValue.expiresAt || 0) > now)) return;
      return null;
    });
  return result.committed;
}

async function markAbandonedSoloSessionV2RoomDestroyed(uid, roomId, entry) {
  await realtime.ref(`online/rooms/${roomId}`).transaction((currentValue) => {
    if (!roomMatchesSessionV2(currentValue, {
      uid,
      sessionId: entry.sessionId,
      generation: entry.generation,
      roomId,
      attemptId: entry.attemptId,
    })
        || currentValue.status !== "active"
        || currentValue.destroyed) return;
    return {
      ...currentValue,
      destroyed: {
        by: uid,
        at: Date.now(),
      },
    };
  });
}

async function liveSoloSessionV2Room(uid, now = Date.now()) {
  const activeSnapshot = await realtime.ref(`online/activeV2/${uid}`).get();
  const entries = Object.entries(objectValue(activeSnapshot.val()))
    .sort((first, second) => (
      Number(second[1]?.expiresAt || 0) - Number(first[1]?.expiresAt || 0)
    ))
    .slice(0, 50);
  for (const [sessionId, entry] of entries) {
    const roomId = cleanText(entry?.roomId, 80);
    if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)
        || entry?.sessionId !== sessionId
        || !isSafeToken(entry?.sessionId)
        || !isSafeToken(entry?.generation)) continue;
    const roomSnapshot = await realtime.ref(`online/rooms/${roomId}`).get();
    const room = roomSnapshot.val();
    if (!roomMatchesSessionV2(room, {
      uid,
      sessionId: entry.sessionId,
      generation: entry.generation,
      roomId,
      attemptId: entry.attemptId,
    })) {
      await removeExpiredSoloSessionV2Active(uid, sessionId, entry, now);
      continue;
    }
    const reservationFresh = Number(entry.expiresAt || 0) > now;
    const roomPresence = room.presenceV2?.[uid]?.[entry.sessionId];
    const presenceFresh = roomPresence?.online === true
      && Number(roomPresence.updatedAt || 0)
        >= now - SOLO_SESSION_LEASE_TTL_MS - 15_000;
    const roomIsLive = !room.destroyed
      && ((room.status === "active"
          && (reservationFresh || presenceFresh))
        || (room.status === "offered"
          && reservationFresh
          && Number(room.createdAt || 0) >= now - SOLO_SESSION_MATCH_TTL_MS
          && Number(room.createdAt || 0) <= now + 15_000));
    if (roomIsLive) {
      return {
        roomId,
        status: room.status,
        sessionId: entry.sessionId,
        generation: entry.generation,
      };
    }
    const terminalRoom = Boolean(room.destroyed)
      || !["active", "offered"].includes(room.status);
    const removed = await removeExpiredSoloSessionV2Active(
      uid,
      sessionId,
      entry,
      now,
      { allowFresh: terminalRoom },
    );
    if (removed && room.status === "active" && !room.destroyed) {
      await markAbandonedSoloSessionV2RoomDestroyed(uid, roomId, entry);
    }
  }
  return null;
}

function soloSessionClaimResponse(claim, reason) {
  const lease = publicClaimLease(claim);
  if (!lease) throw new Error("solo session claim response is invalid");
  return {
    claimed: true,
    reason,
    lease,
    sessionGeneration: claim.generation,
  };
}

async function removeReplacedSoloSessionV2Resource(reference, fence) {
  const result = await reference.transaction((currentValue) => (
    resourceFenceMatches(currentValue, fence) ? null : undefined
  ));
  return !resourceFenceMatches(result.snapshot.val(), fence);
}

async function cleanupReplacedSoloSessionV2ClaimResources(
  uid,
  previousClaim,
  committedClaim,
) {
  const fence = replacedClaimResourceFence(previousClaim, committedClaim);
  if (!fence) return true;
  const cleaned = await Promise.all([
    removeReplacedSoloSessionV2Resource(
      soloSessionQueueRef(uid, fence.sessionId),
      fence,
    ),
    removeReplacedSoloSessionV2Resource(
      soloSessionActiveRef(uid, fence.sessionId),
      fence,
    ),
  ]);
  return cleaned.every(Boolean);
}

async function soloProfileProjectionClientUpgradeRequired(uid, requestedVersion) {
  if (requestedVersion === SOLO_PROFILE_PROJECTION_VERSION) return false;
  const [
    enrollmentSnapshot,
    queueSnapshot,
    soloSnapshot,
    overallSnapshot,
  ] = await Promise.all([
    soloProfileProjectionEnrollmentRef(uid).get(),
    soloProfileProjectionQueueRef(uid).get(),
    realtime.ref(`online/profiles/${uid}`).get(),
    realtime.ref(`online/overallProfiles/${uid}`).get(),
  ]);
  const durableEnrollment = enrollmentSnapshot.val()
    === SOLO_PROFILE_PROJECTION_VERSION;
  const enrolled = queueSnapshot.exists
    && queueSnapshot.get("profileProjectionEnrolled") === true
    && queueSnapshot.get("profileProjectionVersion")
      === SOLO_PROFILE_PROJECTION_VERSION;
  const hasProtectedSequence = [soloSnapshot.val(), overallSnapshot.val()]
    .some((profile) => (
      Number.isSafeInteger(profile?.serverProjectionSequence)
      && profile.serverProjectionSequence > 0
    ));
  const upgradeRequired = durableEnrollment || enrolled || hasProtectedSequence;
  if (upgradeRequired && !durableEnrollment) {
    await publishSoloProfileProjectionEnrollment(uid);
  }
  return upgradeRequired;
}

async function soloProfileProjectionParticipantsUpgradeRequired(participants) {
  const versionsByUid = new Map();
  for (const participant of Array.isArray(participants) ? participants : []) {
    const uid = typeof participant?.uid === "string" ? participant.uid : "";
    if (!uid || uid.length > 128) continue;
    const marked = participant.profileProjectionVersion
      === SOLO_PROFILE_PROJECTION_VERSION;
    versionsByUid.set(uid, (versionsByUid.get(uid) ?? true) && marked);
  }
  const markerlessUids = [...versionsByUid.entries()]
    .filter(([, marked]) => !marked)
    .map(([uid]) => uid);
  if (!markerlessUids.length) return false;
  const upgradeRequired = await Promise.all(markerlessUids.map((uid) => (
    soloProfileProjectionClientUpgradeRequired(uid)
  )));
  return upgradeRequired.some(Boolean);
}

async function claimSoloSessionV2(uid, data) {
  const now = Date.now();
  if (await soloProfileProjectionClientUpgradeRequired(
    uid,
    data.profileProjectionVersion,
  )) {
    return { claimed: false, reason: "client-upgrade-required" };
  }
  if (await liveLegacySoloRoom(uid, now, { cleanupStale: true })) {
    return { claimed: false, reason: "occupied" };
  }
  const claimRef = soloSessionClaimRef(uid);
  const [
    existingSnapshot,
    lockSnapshot,
    legacyLockSnapshot,
    legacyQueueSnapshot,
  ] = await Promise.all([
    claimRef.get(),
    realtime.ref(`online/soloMatchLocksV2/${uid}`).get(),
    realtime.ref(`online/soloMatchPermitLocks/${uid}`).get(),
    realtime.ref(`online/queue/${uid}`).get(),
  ]);
  const existing = normalizeClaim(existingSnapshot.val());
  const exactExistingOwner = existing?.sessionId === data.sessionId
    && existing?.leaseToken === data.leaseToken;
  const needsClaimGuard = !exactExistingOwner || Number(existing?.expiresAt || 0) <= now;
  const lock = lockSnapshot.val();
  const legacyLock = legacyLockSnapshot.val();
  const liveV2Room = needsClaimGuard ? await liveSoloSessionV2Room(uid, now) : null;
  const lockCheckNow = Date.now();
  if (needsClaimGuard
      && (Number(lock?.expiresAt || 0) > lockCheckNow
        || Number(legacyLock?.expiresAt || 0) > lockCheckNow
        || liveV2Room)) {
    return { claimed: false, reason: "occupied" };
  }
  if (needsClaimGuard
      && isValidSoloServerQueueEntry(uid, legacyQueueSnapshot.val(), lockCheckNow)) {
    return { claimed: false, reason: "legacy-waiting" };
  }

  const claimGuard = needsClaimGuard
    ? await acquireSoloSessionClaimGuard(uid, data)
    : null;
  if (needsClaimGuard && !claimGuard) {
    return { claimed: false, reason: "occupied" };
  }

  try {
    if (claimGuard) {
      const [
        legacyRoomUnderGuard,
        v2RoomUnderGuard,
        legacyLockUnderGuardSnapshot,
        legacyQueueUnderGuardSnapshot,
      ] =
        await Promise.all([
          liveLegacySoloRoom(uid, Date.now(), { cleanupStale: true }),
          liveSoloSessionV2Room(uid, Date.now()),
          realtime.ref(`online/soloMatchPermitLocks/${uid}`).get(),
          realtime.ref(`online/queue/${uid}`).get(),
        ]);
      const guardCheckNow = Date.now();
      if (legacyRoomUnderGuard
          || v2RoomUnderGuard
          || Number(legacyLockUnderGuardSnapshot.val()?.expiresAt || 0) > guardCheckNow) {
        return { claimed: false, reason: "occupied" };
      }
      if (isValidSoloServerQueueEntry(
        uid,
        legacyQueueUnderGuardSnapshot.val(),
        guardCheckNow,
      )) {
        return { claimed: false, reason: "legacy-waiting" };
      }
      const renewedClaimGuard = await renewSoloSessionClaimGuard(uid, claimGuard);
      if (!renewedClaimGuard) {
        return { claimed: false, reason: "occupied" };
      }
    }

    const replacementGeneration = soloSessionGeneration();
    let decision = null;
    let rollbackClaimValue = null;
    const result = await claimRef.transaction((currentValue) => {
      decision = claimDecision({
        currentClaim: currentValue,
        sessionId: data.sessionId,
        leaseToken: data.leaseToken,
        generation: replacementGeneration,
        now: Date.now(),
        ttlMs: SOLO_SESSION_LEASE_TTL_MS,
        sameSessionOwnerConfirmedGone: data.sameSessionOwnerConfirmedGone,
      });
      if (!decision.allowed) return;
      if (data.profileProjectionVersion === SOLO_PROFILE_PROJECTION_VERSION) {
        decision.claim = {
          ...decision.claim,
          profileProjectionVersion: SOLO_PROFILE_PROJECTION_VERSION,
        };
      }
      rollbackClaimValue = currentValue == null ? null : currentValue;
      return decision.claim;
    });
    if (!result.committed || !decision?.allowed) {
      return {
        claimed: false,
        reason: decision?.reason === "same-session-owned"
          ? "same-session-owned"
          : "occupied",
      };
    }
    const committedClaim = normalizeClaim(result.snapshot.val());
    if (!committedClaim) throw new Error("solo session claim was not committed");
    const [
      legacyRoomAfterClaim,
      v2RoomAfterClaim,
      legacyLockAfterClaimSnapshot,
      legacyQueueAfterClaimSnapshot,
      claimGuardAfterClaimSnapshot,
    ] = await Promise.all([
      liveLegacySoloRoom(uid, Date.now(), { cleanupStale: true }),
      liveSoloSessionV2Room(uid, Date.now()),
      realtime.ref(`online/soloMatchPermitLocks/${uid}`).get(),
      realtime.ref(`online/queue/${uid}`).get(),
      claimGuard
        ? realtime.ref(`online/soloMatchLocksV2/${uid}`).get()
        : Promise.resolve(null),
    ]);
    const postClaimCheckNow = Date.now();
    const v2RoomOwnedByClaim = v2RoomAfterClaim
      && v2RoomAfterClaim.sessionId === committedClaim.sessionId
      && v2RoomAfterClaim.generation === committedClaim.generation;
    const legacyQueueAfterClaimIsFresh = isValidSoloServerQueueEntry(
      uid,
      legacyQueueAfterClaimSnapshot.val(),
      postClaimCheckNow,
    );
    const claimGuardStillOwned = !claimGuard || (
      soloSessionClaimGuardMatches(
        claimGuardAfterClaimSnapshot?.val(),
        claimGuard.operationId,
      )
      && Number(claimGuardAfterClaimSnapshot.val()?.expiresAt || 0) > postClaimCheckNow
    );
    if (legacyRoomAfterClaim
        || Number(legacyLockAfterClaimSnapshot.val()?.expiresAt || 0) > postClaimCheckNow
        || legacyQueueAfterClaimIsFresh
        || !claimGuardStillOwned
        || (v2RoomAfterClaim && !v2RoomOwnedByClaim)) {
      await claimRef.transaction((currentValue) => (
        claimMatches(currentValue, {
          sessionId: committedClaim.sessionId,
          leaseToken: committedClaim.leaseToken,
          generation: committedClaim.generation,
          now: Date.now(),
          requireFresh: false,
        }) ? rollbackClaimValue : undefined
      ));
      return {
        claimed: false,
        reason: legacyQueueAfterClaimIsFresh ? "legacy-waiting" : "occupied",
      };
    }

    try {
      const replacementResourcesCleaned =
        await cleanupReplacedSoloSessionV2ClaimResources(
          uid,
          rollbackClaimValue,
          committedClaim,
        );
      if (!replacementResourcesCleaned) {
        throw new Error("solo session replacement cleanup was incomplete");
      }
    } catch {
      await claimRef.transaction((currentValue) => (
        claimMatches(currentValue, {
          sessionId: committedClaim.sessionId,
          leaseToken: committedClaim.leaseToken,
          generation: committedClaim.generation,
          now: Date.now(),
          requireFresh: false,
        }) ? rollbackClaimValue : undefined
      ));
      throw new Error("solo session replacement cleanup failed");
    }
    return soloSessionClaimResponse(committedClaim, decision.reason);
  } finally {
    if (claimGuard && !await releaseSoloSessionClaimGuard(uid, claimGuard)) {
      console.error("solo session claim guard cleanup failed", { category: "cleanup" });
    }
  }
}

async function heartbeatSoloSessionV2(uid, data) {
  const claimRef = soloSessionClaimRef(uid);
  let decision = null;
  const result = await claimRef.transaction((currentValue) => {
    if (currentValue == null) return null;
    decision = heartbeatDecision({
      currentClaim: currentValue,
      sessionId: data.sessionId,
      leaseToken: data.leaseToken,
      generation: data.generation,
      now: Date.now(),
      ttlMs: SOLO_SESSION_LEASE_TTL_MS,
    });
    return decision.allowed ? decision.claim : undefined;
  });
  if (!result.committed || !decision?.allowed) {
    return { claimed: false, reason: "lease-lost" };
  }
  const claim = normalizeClaim(result.snapshot.val());
  if (!claim) throw new Error("solo session heartbeat was not committed");
  const fence = {
    sessionId: claim.sessionId,
    leaseToken: claim.leaseToken,
    generation: claim.generation,
  };
  const refreshedAt = Date.now();
  await Promise.allSettled([
    soloSessionQueueRef(uid, data.sessionId).transaction((currentValue) => {
      if (currentValue == null) return null;
      return resourceFenceMatches(currentValue, fence)
        ? {
          ...currentValue,
          lastSeen: refreshedAt,
          expiresAt: claim.expiresAt,
        }
        : undefined;
    }),
    soloSessionActiveRef(uid, data.sessionId).transaction((currentValue) => {
      if (currentValue == null) return null;
      return resourceFenceMatches(currentValue, fence)
        ? {
          ...currentValue,
          lastSeen: refreshedAt,
          expiresAt: claim.expiresAt,
        }
        : undefined;
    }),
  ]);
  return soloSessionClaimResponse(claim, "refreshed");
}

async function removeSoloSessionResourceIfFenced(reference, fence) {
  let safe = false;
  const result = await reference.transaction((currentValue) => {
    if (currentValue == null) {
      safe = true;
      return null;
    }
    if (!resourceFenceMatches(currentValue, fence)) {
      safe = false;
      return;
    }
    safe = true;
    return null;
  });
  return safe && result.snapshot.val() == null;
}

async function releaseSoloSessionV2(uid, data) {
  const claimRef = soloSessionClaimRef(uid);
  const releaseGuard = await acquireSoloSessionClaimGuard(uid, data);
  if (!releaseGuard) return { released: false, reason: "occupied" };
  try {
    const claimSnapshot = await claimRef.get();
    const releasedClaim = normalizeClaim(claimSnapshot.val());
    if (!releasedClaim
        || releasedClaim.sessionId !== data.sessionId
        || releasedClaim.leaseToken !== data.leaseToken
        || releasedClaim.generation !== data.generation) {
      return { released: false, reason: "lease-lost" };
    }
    const fence = {
      sessionId: releasedClaim.sessionId,
      leaseToken: releasedClaim.leaseToken,
      generation: releasedClaim.generation,
    };
    const [queueRemoved, activeRemoved] = await Promise.all([
      removeSoloSessionResourceIfFenced(
        soloSessionQueueRef(uid, data.sessionId),
        fence,
      ),
      removeSoloSessionResourceIfFenced(
        soloSessionActiveRef(uid, data.sessionId),
        fence,
      ),
    ]);
    if (!queueRemoved || !activeRemoved) {
      return { released: false, reason: "resource-changed" };
    }
    let claimReleased = false;
    const result = await claimRef.transaction((currentValue) => {
      const current = normalizeClaim(currentValue);
      if (!current
          || current.sessionId !== data.sessionId
          || current.leaseToken !== data.leaseToken
          || current.generation !== data.generation) {
        claimReleased = false;
        return;
      }
      claimReleased = true;
      return null;
    });
    if (!result.committed || !claimReleased) {
      return { released: false, reason: "lease-lost" };
    }
    return {
      released: true,
      queueRemoved,
      activeRemoved,
      sessionGeneration: releasedClaim.generation,
    };
  } finally {
    if (!await releaseSoloSessionClaimGuard(uid, releaseGuard)) {
      console.error("solo session release guard cleanup failed", { category: "cleanup" });
    }
  }
}

function boundedSoloSessionV2Queue(uid, queue, limit = 500) {
  const requester = queue[uid];
  if (!requester) return {};
  const candidates = Object.entries(queue)
    .filter(([candidateUid]) => candidateUid !== uid)
    .sort((first, second) => (
      Number(first[1].joinedAt) - Number(second[1].joinedAt)
      || first[0].localeCompare(second[0])
    ))
    .slice(0, Math.max(0, limit - 1));
  return Object.fromEntries([[uid, requester], ...candidates]);
}

function liveSoloSessionV2LockUids(locks, now) {
  return Object.entries(objectValue(locks))
    .filter(([, lock]) => Number(lock?.expiresAt || 0) > now)
    .map(([uid]) => uid);
}

async function liveLegacySoloUidsForQueue(queue, legacyActive, now) {
  const candidateUids = Object.keys(queue)
    .filter((uid) => Object.hasOwn(legacyActive, uid));
  const liveUids = [];
  for (let offset = 0; offset < candidateUids.length; offset += 50) {
    const batch = candidateUids.slice(offset, offset + 50);
    const results = await Promise.all(batch.map((uid) => liveLegacySoloRoom(uid, now)));
    results.forEach((room, index) => {
      if (room) liveUids.push(batch[index]);
    });
  }
  return liveUids;
}

function soloSessionV2Candidate(player, session) {
  if (!player
      || !session
      || !isSafeToken(session.sessionId)
      || !isSafeToken(session.generation)) return null;
  return {
    ...player,
    sessionId: session.sessionId,
    sessionGeneration: session.generation,
  };
}

async function loadExistingSoloSessionV2Match(uid, claim, now) {
  const activeSnapshot = await soloSessionActiveRef(uid, claim.sessionId).get();
  const activeEntry = activeSnapshot.val();
  if (!activeV2EntryIsFresh(uid, activeEntry, claim, now)) return null;
  const roomId = cleanText(activeEntry.roomId, 80);
  const roomSnapshot = await realtime.ref(`online/rooms/${roomId}`).get();
  const room = roomSnapshot.val();
  if (!roomMatchesSessionV2(room, {
    uid,
    sessionId: claim.sessionId,
    generation: claim.generation,
    roomId,
    attemptId: activeEntry.attemptId,
  }) || room.destroyed || !["offered", "active"].includes(room.status)) return null;
  const opponentUid = uid === room.hostUid ? room.guestUid : room.hostUid;
  const candidate = soloSessionV2Candidate(
    room.players?.[opponentUid],
    room.sessions?.[opponentUid],
  );
  if (!candidate) return null;
  const common = {
    roomId,
    attemptId: room.attemptId,
    connectionGeneration: room.connectionGeneration,
    candidate,
  };
  if (uid === room.guestUid && room.status === "active") {
    return { outcome: "join", ...common };
  }
  if (uid === room.hostUid) {
    return {
      outcome: "hosted",
      ...common,
      reunion: room.reunion === true,
    };
  }
  return { outcome: "waiting" };
}

function soloSessionV2LockMatches(value, expected) {
  return value?.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value.roomId === expected?.roomId
    && value.attemptId === expected?.attemptId
    && value.role === expected?.role
    && value.sessionId === expected?.sessionId
    && value.generation === expected?.generation
    && value.hostUid === expected?.hostUid
    && value.guestUid === expected?.guestUid;
}

async function acquireSoloSessionV2Locks(resources) {
  const participantLocks = {
    [resources.hostLock.hostUid]: resources.hostLock,
    [resources.guestLock.guestUid]: resources.guestLock,
  };
  const now = Date.now();
  let acquired = false;
  const result = await realtime.ref("online/soloMatchLocksV2")
    .transaction((currentValue) => {
      acquired = false;
      const current = objectValue(currentValue);
      const next = { ...current };
      for (const [uid, lock] of Object.entries(participantLocks)) {
        if (Number(current[uid]?.expiresAt || 0) > now
            && !soloSessionV2LockMatches(current[uid], lock)) {
          return currentValue;
        }
        next[uid] = lock;
      }
      acquired = true;
      return next;
    });
  return acquired
    && result.committed
    && Object.entries(participantLocks).every(
      ([uid, expected]) => soloSessionV2LockMatches(result.snapshot.child(uid).val(), expected),
    );
}

async function releaseSoloSessionV2Locks(resources) {
  const expectedLocks = {
    [resources.hostLock.hostUid]: resources.hostLock,
    [resources.guestLock.guestUid]: resources.guestLock,
  };
  let safe = false;
  const result = await realtime.ref("online/soloMatchLocksV2")
    .transaction((currentValue) => {
      const current = objectValue(currentValue);
      const mismatched = Object.entries(expectedLocks).some(([uid, expected]) => {
        const lock = current[uid];
        return lock != null && !soloSessionV2LockMatches(lock, expected);
      });
      if (mismatched) {
        safe = false;
        return currentValue;
      }
      const next = { ...current };
      Object.keys(expectedLocks).forEach((uid) => delete next[uid]);
      safe = true;
      return next;
    });
  return safe && Object.keys(expectedLocks).every(
    (uid) => result.snapshot.child(uid).val() == null,
  );
}

async function reserveSoloSessionV2Queue(entry, resources, role) {
  const roomId = resources.hostLock.roomId;
  const result = await soloSessionQueueRef(entry.uid, entry.sessionId)
    .transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!resourceFenceMatches(currentValue, entry)
          || currentValue.state !== "waiting"
          || Number(currentValue.joinedAt) !== Number(entry.joinedAt)) return;
      return {
        ...currentValue,
        state: role === "host" ? "offering" : "reserved",
        roomId,
        attemptId: resources.hostLock.attemptId,
        lastSeen: Date.now(),
        expiresAt: resources.permit.expiresAt,
      };
    });
  return result.committed ? result.snapshot.val() : null;
}

async function restoreSoloSessionV2Queue(entry, resources) {
  const now = Date.now();
  const claimSnapshot = await soloSessionClaimRef(entry.uid).get();
  let safe = false;
  const result = await soloSessionQueueRef(entry.uid, entry.sessionId)
    .transaction((currentValue) => {
      if (currentValue == null) {
        safe = true;
        return null;
      }
      const exactFence = resourceFenceMatches(currentValue, entry);
      const alreadyWaiting = exactFence
        && currentValue.state === "waiting"
        && !currentValue.roomId
        && !currentValue.attemptId;
      if (alreadyWaiting) {
        safe = true;
        return currentValue;
      }
      if (currentValue?.protocolVersion !== SOLO_SESSION_PROTOCOL_VERSION
          || currentValue?.sessionId !== entry.sessionId
          || currentValue?.leaseToken !== entry.leaseToken
          || currentValue?.generation !== entry.generation
          || currentValue.roomId !== resources.hostLock.roomId
          || currentValue.attemptId !== resources.hostLock.attemptId
          || !["offering", "reserved"].includes(currentValue.state)) {
        safe = false;
        return;
      }
      safe = true;
      const claim = normalizeClaim(claimSnapshot.val());
      if (!claimMatches(claimSnapshot.val(), {
        sessionId: currentValue.sessionId,
        leaseToken: currentValue.leaseToken,
        generation: currentValue.generation,
        now,
      })) return null;
      const next = {
        ...currentValue,
        state: "waiting",
        lastSeen: now,
        expiresAt: claim.expiresAt,
      };
      delete next.roomId;
      delete next.attemptId;
      return next;
    });
  const finalValue = result.snapshot.val();
  return safe && (
    finalValue == null
    || (
      resourceFenceMatches(finalValue, entry)
      && finalValue.state === "waiting"
      && !finalValue.roomId
      && !finalValue.attemptId
    )
  );
}

function recordAttemptMatches(value, resources) {
  return value?.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value?.attemptId === resources.hostLock.attemptId
    && value?.connectionGeneration === resources.permit.connectionGeneration;
}

function recordSessionsMatch(value, resources) {
  const hostUid = resources.permit.hostUid;
  const guestUid = resources.permit.guestUid;
  return recordAttemptMatches(value, resources)
    && value?.sessions?.[hostUid]?.sessionId
      === resources.permit.sessions?.[hostUid]?.sessionId
    && value?.sessions?.[hostUid]?.generation
      === resources.permit.sessions?.[hostUid]?.generation
    && value?.sessions?.[guestUid]?.sessionId
      === resources.permit.sessions?.[guestUid]?.sessionId
    && value?.sessions?.[guestUid]?.generation
      === resources.permit.sessions?.[guestUid]?.generation;
}

async function removeSoloSessionV2Record(reference, matches) {
  let safe = false;
  const result = await reference.transaction((currentValue) => {
    if (currentValue == null) {
      safe = true;
      return null;
    }
    if (!matches(currentValue)) {
      safe = false;
      return;
    }
    safe = true;
    return null;
  });
  return safe && (result.committed || result.snapshot.val() == null);
}

function soloSessionV2TransitionExpected(resources) {
  return {
    attemptId: resources.hostLock.attemptId,
    connectionGeneration: resources.permit.connectionGeneration,
  };
}

async function acquireSoloSessionV2RoomTransition(
  roomId,
  expected,
  action,
  {
    allowActiveCancel = false,
    allowActiveAccept = false,
    reuseExistingAction = false,
  } = {},
) {
  let token = soloSessionGeneration();
  let decision = null;
  const result = await realtime.ref(`online/rooms/${roomId}`)
    .transaction((currentValue) => {
      if (currentValue == null) return null;
      if (action === "cancel"
          && allowActiveCancel
          && currentValue.status === "active"
          && currentValue.serverFinalized) {
        decision = {
          allowed: false,
          reason: "finalized",
          room: currentValue,
        };
        return;
      }
      if (reuseExistingAction
          && action === "accept"
          && allowActiveAccept
          && currentValue.status === "active"
          && !currentValue.destroyed
          && roomAttemptMatches(currentValue, expected)
          && currentValue.matchTransition?.action === action
          && isSafeToken(currentValue.matchTransition?.token)) {
        token = currentValue.matchTransition.token;
        decision = {
          allowed: true,
          reason: "reused-existing",
          room: currentValue,
        };
        return currentValue;
      }
      decision = decideSoloRoomTransition({
        room: currentValue,
        expected,
        action,
        token,
        now: Date.now(),
        allowActiveCancel,
        allowActiveAccept,
      });
      return decision.allowed ? decision.room : undefined;
    });
  const room = result.snapshot.val();
  return {
    acquired: result.committed && roomTransitionOwned(room, action, token),
    reason: decision?.reason || "room-changed",
    room,
    token,
  };
}

async function clearSoloSessionV2RoomTransition(
  roomId,
  expected,
  action,
  token,
  { requireUndestroyed = false } = {},
) {
  let safe = false;
  const result = await realtime.ref(`online/rooms/${roomId}`)
    .transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!roomAttemptMatches(currentValue, expected)
          || !roomTransitionOwned(currentValue, action, token)
          || (requireUndestroyed && currentValue.destroyed)) {
        safe = false;
        return;
      }
      const next = { ...currentValue };
      delete next.matchTransition;
      safe = true;
      return next;
    });
  return safe && result.committed;
}

async function cleanupSoloSessionV2Match(resources, {
  restoreQueue = true,
  transitionAction = "",
  transitionToken = "",
  destroyActive = false,
  destroyedByUid = "",
} = {}) {
  const roomId = resources.hostLock.roomId;
  const host = resources.permit.players[resources.permit.hostUid];
  const guest = resources.permit.players[resources.permit.guestUid];
  const hostSession = resources.permit.sessions[resources.permit.hostUid];
  const guestSession = resources.permit.sessions[resources.permit.guestUid];
  const expectedTransition = transitionAction && transitionToken;
  let roomSafe = false;
  const roomResult = await realtime.ref(`online/rooms/${roomId}`)
    .transaction((currentValue) => {
      if (currentValue == null) {
        roomSafe = true;
        return null;
      }
      if (!recordAttemptMatches(currentValue, resources)
          || !roomAttemptMatches(currentValue, soloSessionV2TransitionExpected(resources))) {
        roomSafe = false;
        return;
      }
      if (currentValue.status === "active" && currentValue.serverFinalized) {
        if (expectedTransition
            && roomTransitionOwned(currentValue, transitionAction, transitionToken)) {
          const next = { ...currentValue };
          delete next.matchTransition;
          roomSafe = false;
          return next;
        }
        roomSafe = false;
        return;
      }
      const priorAbort = currentValue.destroyed?.reason === "session-abort"
        && currentValue.destroyed?.attemptId === resources.hostLock.attemptId
        && currentValue.destroyed?.connectionGeneration
          === resources.permit.connectionGeneration;
      if (priorAbort && destroyActive) {
        roomSafe = true;
        return currentValue;
      }
      if (expectedTransition
          ? !roomTransitionOwned(currentValue, transitionAction, transitionToken)
          : Boolean(currentValue.matchTransition)) {
        roomSafe = false;
        return;
      }
      if (currentValue.status === "active") {
        if (!destroyActive || !expectedTransition) {
          roomSafe = false;
          return;
        }
        const next = {
          ...currentValue,
          destroyed: {
            ...objectValue(currentValue.destroyed),
            by: currentValue.destroyed?.by || destroyedByUid,
            at: Number(currentValue.destroyed?.at || Date.now()),
            reason: "session-abort",
            attemptId: resources.hostLock.attemptId,
            connectionGeneration: resources.permit.connectionGeneration,
          },
        };
        delete next.matchTransition;
        roomSafe = true;
        return next;
      }
      if (currentValue.status !== "offered") {
        roomSafe = false;
        return;
      }
      roomSafe = true;
      return null;
    });
  if (!roomSafe || (!roomResult.committed && roomResult.snapshot.val() != null)) return false;

  const cleanupChecks = [
    await removeSoloSessionV2Record(
      realtime.ref(`online/soloMatchPermitsV2/${roomId}`),
      (currentValue) => recordSessionsMatch(currentValue, resources),
    ),
    await removeSoloSessionV2Record(
      soloSessionOfferRef(resources.permit.guestUid, guestSession.sessionId, roomId),
      (currentValue) => recordSessionsMatch(currentValue, resources),
    ),
    await removeSoloSessionV2Record(
      soloSessionActiveRef(resources.permit.hostUid, hostSession.sessionId),
      (currentValue) => exactSoloSessionV2ActiveIdentity(
        currentValue,
        resources.hostActive,
        resources.permit.hostUid,
        hostSession.sessionId,
      ),
    ),
    await removeSoloSessionV2Record(
      soloSessionActiveRef(resources.permit.guestUid, guestSession.sessionId),
      (currentValue) => exactSoloSessionV2ActiveIdentity(
        currentValue,
        resources.guestActive,
        resources.permit.guestUid,
        guestSession.sessionId,
      ),
    ),
  ];
  if (!restoreQueue) {
    cleanupChecks.push(
      await removeSoloSessionV2Record(
        soloSessionQueueRef(resources.permit.hostUid, hostSession.sessionId),
        (currentValue) => (
          resourceFenceMatches(currentValue, resources.hostActive)
          && currentValue.roomId === roomId
          && currentValue.attemptId === resources.hostLock.attemptId
        ),
      ),
      await removeSoloSessionV2Record(
        soloSessionQueueRef(resources.permit.guestUid, guestSession.sessionId),
        (currentValue) => (
          resourceFenceMatches(currentValue, resources.guestActive)
          && currentValue.roomId === roomId
          && currentValue.attemptId === resources.guestLock.attemptId
        ),
      ),
    );
  }
  if (cleanupChecks.some((safe) => !safe)) return false;

  if (restoreQueue) {
    const restored = await Promise.all([
      restoreSoloSessionV2Queue({
        ...host,
        ...hostSession,
        leaseToken: resources.hostActive.leaseToken,
        protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
      }, resources),
      restoreSoloSessionV2Queue({
        ...guest,
        ...guestSession,
        leaseToken: resources.guestActive.leaseToken,
        protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
      }, resources),
    ]);
    if (restored.some((safe) => !safe)) return false;
  }
  return releaseSoloSessionV2Locks(resources);
}

async function readSoloSessionV2MaterializationFence(resources, hostEntry, guestEntry) {
  const [hostClaim, guestClaim, hostQueue, guestQueue, hostLock, guestLock] = await Promise.all([
    soloSessionClaimRef(hostEntry.uid).get(),
    soloSessionClaimRef(guestEntry.uid).get(),
    soloSessionQueueRef(hostEntry.uid, hostEntry.sessionId).get(),
    soloSessionQueueRef(guestEntry.uid, guestEntry.sessionId).get(),
    realtime.ref(`online/soloMatchLocksV2/${hostEntry.uid}`).get(),
    realtime.ref(`online/soloMatchLocksV2/${guestEntry.uid}`).get(),
  ]);
  if (!materializationFenceMatches({
    hostClaim: hostClaim.val(),
    guestClaim: guestClaim.val(),
    hostQueue: hostQueue.val(),
    guestQueue: guestQueue.val(),
    hostLock: hostLock.val(),
    guestLock: guestLock.val(),
    attemptId: resources.hostLock.attemptId,
    now: Date.now(),
  })) return false;
  return !await soloProfileProjectionParticipantsUpgradeRequired([
    hostEntry,
    guestEntry,
  ]);
}

async function trySoloSessionV2Match(uid, data) {
  const now = Date.now();
  const [claimSnapshot, rollout] = await Promise.all([
    soloSessionClaimRef(uid).get(),
    loadSoloFamiliarRollout(),
  ]);
  const claim = normalizeClaim(claimSnapshot.val());
  if (!claim
      || claim.sessionId !== data.sessionId
      || claim.leaseToken !== data.leaseToken
      || claim.expiresAt <= now) {
    return { outcome: "lease-lost" };
  }
  if (await liveLegacySoloRoom(uid, now)) return { outcome: "occupied" };
  const existing = await loadExistingSoloSessionV2Match(uid, claim, Date.now());
  if (existing) return existing;

  const selectionNow = Date.now();
  const [queueSnapshot, claimsSnapshot, activeSnapshot, locksSnapshot, legacyActiveSnapshot] =
    await Promise.all([
      realtime.ref("online/queueV2").get(),
      realtime.ref("online/soloSessionClaims")
        .orderByChild("expiresAt")
        .startAt(selectionNow + 1)
        .limitToFirst(2_000)
        .get(),
      realtime.ref("online/activeV2").get(),
      realtime.ref("online/soloMatchLocksV2").get(),
      realtime.ref("online/active").get(),
    ]);
  if (queueSnapshot.numChildren() > 2_000
      || activeSnapshot.numChildren() > 2_000) {
    throw new HttpsError("resource-exhausted", "対戦待機情報が混み合っています。");
  }
  const claims = {
    ...objectValue(claimsSnapshot.val()),
    [uid]: claim,
  };
  const freshQueue = flattenFreshQueueV2(
    objectValue(queueSnapshot.val()),
    claims,
    selectionNow,
  );
  const boundedQueue = boundedSoloSessionV2Queue(uid, freshQueue);
  if (!boundedQueue[uid] || Object.keys(boundedQueue).length < 2) {
    return { outcome: "waiting" };
  }
  const [familiarPairs, blockedPairIds] = await Promise.all([
    rollout.reunionEnabled
      ? querySoloPairDocuments("soloFamiliarPairs", uid, true)
      : Promise.resolve([]),
    blockedSoloPairIdsForQueue(uid, boundedQueue, selectionNow),
  ]);
  const legacyActiveUids = await liveLegacySoloUidsForQueue(
    boundedQueue,
    objectValue(legacyActiveSnapshot.val()),
    selectionNow,
  );
  const selection = selectSoloSessionV2Match({
    requesterUid: uid,
    queue: boundedQueue,
    activeUids: [
      ...activeV2UidSet(objectValue(activeSnapshot.val()), claims, selectionNow),
      ...legacyActiveUids,
    ],
    lockedUids: liveSoloSessionV2LockUids(locksSnapshot.val(), selectionNow),
    familiarPairs,
    blockedPairIds,
    avoidUid: data.avoidUid,
    now: selectionNow,
  });
  if (!selection) return { outcome: "waiting" };

  const roomId = realtime.ref("online/rooms").push().key;
  if (!roomId) throw new HttpsError("unavailable", "対戦ルームを準備できませんでした。");
  const materializedAt = Date.now();
  const resources = buildSoloSessionV2Resources({
    roomId,
    attemptId: soloSessionGeneration(),
    connectionGeneration: soloSessionGeneration(),
    host: selection.host,
    guest: selection.candidate,
    now: materializedAt,
    expiresAt: materializedAt + SOLO_SESSION_MATCH_TTL_MS,
    reunion: selection.reunion,
    pairId: selection.pairId,
  });
  if (!await acquireSoloSessionV2Locks(resources)) return { outcome: "waiting" };

  const [
    hostClaimSnapshot,
    guestClaimSnapshot,
    hostQueueSnapshot,
    guestQueueSnapshot,
    hostLegacyRoom,
    guestLegacyRoom,
    finalBlockSnapshot,
    finalFamiliarSnapshot,
  ] = await Promise.all([
    soloSessionClaimRef(selection.host.uid).get(),
    soloSessionClaimRef(selection.candidate.uid).get(),
    soloSessionQueueRef(selection.host.uid, selection.host.sessionId).get(),
    soloSessionQueueRef(selection.candidate.uid, selection.candidate.sessionId).get(),
    liveLegacySoloRoom(selection.host.uid),
    liveLegacySoloRoom(selection.candidate.uid),
    soloFamiliarBlockPairRef(selection.host.uid, selection.candidate.uid).get(),
    selection.reunion
      ? soloFamiliarPairRef(selection.host.uid, selection.candidate.uid).get()
      : Promise.resolve(null),
  ]);
  const validationNow = Date.now();
  const claimsAndQueuesStillFresh = queueEntryMatchesClaim(
    selection.host.uid,
    selection.host.sessionId,
    hostQueueSnapshot.val(),
    hostClaimSnapshot.val(),
    validationNow,
  ) && queueEntryMatchesClaim(
    selection.candidate.uid,
    selection.candidate.sessionId,
    guestQueueSnapshot.val(),
    guestClaimSnapshot.val(),
    validationNow,
  );
  if (!claimsAndQueuesStillFresh
      || hostLegacyRoom
      || guestLegacyRoom
      || finalBlockSnapshot.exists
      || (selection.reunion && (
        !finalFamiliarSnapshot?.exists
        || finalFamiliarSnapshot.get("active") !== true
        || Number(finalFamiliarSnapshot.get("lastReunionPriorityAt") || 0)
          > validationNow - SOLO_FAMILIAR_REUNION_COOLDOWN_MS
      ))) {
    await cleanupSoloSessionV2Match(resources);
    return { outcome: "waiting" };
  }

  const [reservedHost, reservedGuest] = await Promise.all([
    reserveSoloSessionV2Queue(selection.host, resources, "host"),
    reserveSoloSessionV2Queue(selection.candidate, resources, "guest"),
  ]);
  if (!reservedHost || !reservedGuest
      || !await readSoloSessionV2MaterializationFence(
        resources,
        selection.host,
        selection.candidate,
      )) {
    await cleanupSoloSessionV2Match(resources);
    return { outcome: "waiting" };
  }

  await realtime.ref("online").update({
    [`soloMatchPermitsV2/${roomId}`]: resources.permit,
    [`rooms/${roomId}`]: resources.room,
    [`activeV2/${selection.host.uid}/${selection.host.sessionId}`]: resources.hostActive,
    [`offersV2/${selection.candidate.uid}/${selection.candidate.sessionId}/${roomId}`]:
      resources.offer,
  });
  if (!await readSoloSessionV2MaterializationFence(
    resources,
    selection.host,
    selection.candidate,
  )) {
    await cleanupSoloSessionV2Match(resources);
    return { outcome: "waiting" };
  }
  return {
    outcome: "hosted",
    roomId,
    attemptId: resources.permit.attemptId,
    connectionGeneration: resources.permit.connectionGeneration,
    reunion: resources.permit.reunion,
    candidate: soloSessionV2Candidate(
      resources.permit.players[selection.candidate.uid],
      resources.permit.sessions[selection.candidate.uid],
    ),
  };
}

function soloSessionV2ActiveMatchesRoom(value, uid, session, roomId, room) {
  return value?.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value?.uid === uid
    && value?.sessionId === session?.sessionId
    && value?.generation === session?.generation
    && isSafeToken(value?.leaseToken)
    && value?.roomId === roomId
    && value?.attemptId === room?.attemptId
    && value?.connectionGeneration === room?.connectionGeneration;
}

function soloSessionV2QueueMatchesRoom(value, uid, session, roomId, room) {
  return value?.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value?.uid === uid
    && value?.sessionId === session?.sessionId
    && value?.generation === session?.generation
    && isSafeToken(value?.leaseToken)
    && value?.roomId === roomId
    && value?.attemptId === room?.attemptId
    && ["offering", "reserved"].includes(value?.state);
}

function soloSessionV2ResourcesFromStored(roomId, room, permit, {
  hostActive = null,
  guestActive = null,
  hostQueue = null,
  guestQueue = null,
  requireBothActive = false,
} = {}) {
  if (!roomAttemptMatches(room, room)
      || !["offered", "active"].includes(room?.status)) return null;
  const hostUid = room.hostUid;
  const guestUid = room.guestUid;
  const hostSession = room.sessions?.[hostUid];
  const guestSession = room.sessions?.[guestUid];
  if (!hostUid || !guestUid || hostUid === guestUid
      || !hostSession || !guestSession) return null;
  if (permit != null && (
    !recordSessionsMatch(permit, {
      permit: {
        ...permit,
        hostUid,
        guestUid,
        sessions: room.sessions,
        connectionGeneration: room.connectionGeneration,
      },
      hostLock: { attemptId: room.attemptId },
    })
    || permit.hostUid !== hostUid
    || permit.guestUid !== guestUid
  )) return null;

  const activeValues = {
    [hostUid]: soloSessionV2ActiveMatchesRoom(
      hostActive,
      hostUid,
      hostSession,
      roomId,
      room,
    ) ? hostActive : null,
    [guestUid]: soloSessionV2ActiveMatchesRoom(
      guestActive,
      guestUid,
      guestSession,
      roomId,
      room,
    ) ? guestActive : null,
  };
  const queueValues = {
    [hostUid]: soloSessionV2QueueMatchesRoom(
      hostQueue,
      hostUid,
      hostSession,
      roomId,
      room,
    ) ? hostQueue : null,
    [guestUid]: soloSessionV2QueueMatchesRoom(
      guestQueue,
      guestUid,
      guestSession,
      roomId,
      room,
    ) ? guestQueue : null,
  };
  if (requireBothActive && (!activeValues[hostUid] || !activeValues[guestUid])) return null;
  const hostFence = activeValues[hostUid] || queueValues[hostUid];
  const guestFence = activeValues[guestUid] || queueValues[guestUid];
  if (!hostFence || !guestFence) return null;
  const expiresAt = Math.max(
    Number(room.expiresAt || 0),
    Number(permit?.expiresAt || 0),
    Number(hostFence.expiresAt || 0),
    Number(guestFence.expiresAt || 0),
    Number(room.createdAt || 0) + 1,
  );
  const resources = buildSoloSessionV2Resources({
    roomId,
    attemptId: room.attemptId,
    connectionGeneration: room.connectionGeneration,
    host: {
      ...room.players?.[hostUid],
      uid: hostUid,
      ...hostSession,
      leaseToken: hostFence.leaseToken,
      protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
    },
    guest: {
      ...room.players?.[guestUid],
      uid: guestUid,
      ...guestSession,
      leaseToken: guestFence.leaseToken,
      protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
    },
    now: Number(room.createdAt),
    expiresAt,
    reunion: room.reunion === true,
    pairId: cleanText(room.pairId || permit?.pairId, 40),
  });
  resources.room = room;
  resources.permit = permit || {
    ...resources.permit,
    expiresAt,
  };
  if (activeValues[hostUid]) resources.hostActive = activeValues[hostUid];
  if (activeValues[guestUid]) resources.guestActive = activeValues[guestUid];
  resources.hostQueue = queueValues[hostUid];
  resources.guestQueue = queueValues[guestUid];
  return resources;
}

function soloSessionV2ReunionPermitMatchesRoom(roomId, room, permit) {
  if (room?.status !== "active"
      || room?.destroyed
      || room?.protocolVersion !== SOLO_SESSION_PROTOCOL_VERSION
      || room?.signalingVersion !== SOLO_SIGNALING_VERSION
      || permit?.protocolVersion !== SOLO_SESSION_PROTOCOL_VERSION
      || permit?.signalingVersion !== SOLO_SIGNALING_VERSION
      || room.reunion !== true
      || permit.reunion !== true
      || room.hostUid !== permit.hostUid
      || room.guestUid !== permit.guestUid
      || !recordAttemptMatches(room, {
        hostLock: { attemptId: permit.attemptId },
        permit: { connectionGeneration: permit.connectionGeneration },
      })
      || !recordAttemptMatches(permit, {
        hostLock: { attemptId: room.attemptId },
        permit: { connectionGeneration: room.connectionGeneration },
      })) return false;
  const pairId = soloFamiliarPairId(room.hostUid, room.guestUid);
  if (room.pairId !== pairId || permit.pairId !== pairId) return false;
  for (const participantUid of [room.hostUid, room.guestUid]) {
    if (room.members?.[participantUid] !== true
        || room.sessions?.[participantUid]?.sessionId
          !== permit.sessions?.[participantUid]?.sessionId
        || room.sessions?.[participantUid]?.generation
          !== permit.sessions?.[participantUid]?.generation) return false;
  }
  return normalizeSoloMatchPermit(roomId, permit) != null
    && soloRoomMatchesPermit(room, normalizeSoloMatchPermit(roomId, permit));
}

async function confirmSoloFamiliarReunionV2(roomId, resources, transitionToken) {
  const room = resources.room;
  if (room.reunion !== true) return true;
  if (Number.isFinite(Number(room.reunionConfirmedAt))
      && Number(room.reunionConfirmedAt) > 0) return true;
  if (resources.permitWasStored !== true) return false;
  const permit = resources.permit;
  if (!soloSessionV2ReunionPermitMatchesRoom(roomId, room, permit)) return false;
  const confirmed = await confirmSoloFamiliarReunionFromRoom(roomId, {
    permitValue: permit,
    roomValue: room,
  });
  if (!confirmed) return false;
  let marked = false;
  const result = await realtime.ref(`online/rooms/${roomId}`)
    .transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!soloSessionV2ReunionPermitMatchesRoom(roomId, currentValue, permit)
          || !roomTransitionOwned(currentValue, "accept", transitionToken)) {
        marked = false;
        return;
      }
      marked = true;
      return {
        ...currentValue,
        reunionConfirmedAt: Date.now(),
      };
    });
  if (marked && result.committed) {
    resources.room = result.snapshot.val();
    return true;
  }
  return false;
}

async function activateSoloSessionV2Room(roomId, resources, transitionToken) {
  let activated = false;
  const result = await realtime.ref(`online/rooms/${roomId}`)
    .transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!roomAttemptMatches(currentValue, soloSessionV2TransitionExpected(resources))
          || !roomTransitionOwned(currentValue, "accept", transitionToken)
          || currentValue.destroyed
          || !["offered", "active"].includes(currentValue.status)) {
        activated = false;
        return;
      }
      activated = true;
      return {
        ...currentValue,
        status: "active",
        activatedAt: Number(currentValue.activatedAt || Date.now()),
        matchTransition: {
          ...currentValue.matchTransition,
          startedAt: Date.now(),
        },
      };
    });
  if (activated && result.committed) {
    resources.room = result.snapshot.val();
    return true;
  }
  return false;
}

async function refreshSoloSessionV2ActivePair(resources) {
  const hostUid = resources.permit.hostUid;
  const guestUid = resources.permit.guestUid;
  const hostSession = resources.permit.sessions[hostUid];
  const guestSession = resources.permit.sessions[guestUid];
  const [hostClaimSnapshot, guestClaimSnapshot] = await Promise.all([
    soloSessionClaimRef(hostUid).get(),
    soloSessionClaimRef(guestUid).get(),
  ]);
  const now = Date.now();
  const hostClaim = normalizeClaim(hostClaimSnapshot.val());
  const guestClaim = normalizeClaim(guestClaimSnapshot.val());
  if (!claimMatches(hostClaimSnapshot.val(), {
    sessionId: hostSession.sessionId,
    leaseToken: resources.hostActive.leaseToken,
    generation: hostSession.generation,
    now,
  }) || !claimMatches(guestClaimSnapshot.val(), {
    sessionId: guestSession.sessionId,
    leaseToken: resources.guestActive.leaseToken,
    generation: guestSession.generation,
    now,
  })) return false;
  const refreshEntry = async (uid, sessionId, expected, claim) => {
    let safe = false;
    const result = await soloSessionActiveRef(uid, sessionId)
      .transaction((currentValue) => {
        safe = false;
        if (currentValue == null) return null;
        if (!exactSoloSessionV2ActiveIdentity(currentValue, expected, uid, sessionId)) {
          return currentValue;
        }
        safe = true;
        return {
          ...currentValue,
          lastSeen: Math.max(Number(currentValue.lastSeen || 0), now),
          expiresAt: Math.max(Number(currentValue.expiresAt || 0), Number(claim.expiresAt)),
        };
      });
    const value = result.snapshot.val();
    return safe
      && result.committed
      && exactSoloSessionV2ActiveIdentity(value, expected, uid, sessionId)
      ? value
      : null;
  };
  const [hostActive, guestActive] = await Promise.all([
    refreshEntry(
      hostUid,
      hostSession.sessionId,
      resources.hostActive,
      hostClaim,
    ),
    refreshEntry(
      guestUid,
      guestSession.sessionId,
      resources.guestActive,
      guestClaim,
    ),
  ]);
  if (!hostActive || !guestActive) return false;
  resources.hostActive = hostActive;
  resources.guestActive = guestActive;
  return true;
}

async function recoverSoloSessionV2PreActiveMatch(resources, transitionToken) {
  let recovered = false;
  try {
    recovered = await cleanupSoloSessionV2Match(resources, {
      restoreQueue: true,
      transitionAction: "accept",
      transitionToken,
    });
  } catch {
    recovered = false;
  }
  if (!recovered) {
    console.error("solo session V2 pre-active recovery incomplete", {
      stage: "refresh-active-pair",
    });
  }
  return recovered;
}

async function finalizeAcceptedSoloSessionV2Match(roomId, resources, transitionToken) {
  const hostUid = resources.permit.hostUid;
  const guestUid = resources.permit.guestUid;
  const hostSession = resources.permit.sessions[hostUid];
  const guestSession = resources.permit.sessions[guestUid];
  let stage = "remove-offer";
  try {
    if (!await removeSoloSessionV2Record(
      soloSessionOfferRef(guestUid, guestSession.sessionId, roomId),
      (currentValue) => recordSessionsMatch(currentValue, resources),
    )) return { completed: false, stage };
    stage = "remove-host-queue";
    if (!await removeSoloSessionV2Record(
      soloSessionQueueRef(hostUid, hostSession.sessionId),
      (currentValue) => (
        resourceFenceMatches(currentValue, resources.hostActive)
        && currentValue.roomId === roomId
        && currentValue.attemptId === resources.hostLock.attemptId
      ),
    )) return { completed: false, stage };
    stage = "remove-guest-queue";
    if (!await removeSoloSessionV2Record(
      soloSessionQueueRef(guestUid, guestSession.sessionId),
      (currentValue) => (
        resourceFenceMatches(currentValue, resources.guestActive)
        && currentValue.roomId === roomId
        && currentValue.attemptId === resources.guestLock.attemptId
      ),
    )) return { completed: false, stage };
    stage = "confirm-reunion";
    if (!await confirmSoloFamiliarReunionV2(roomId, resources, transitionToken)) {
      return { completed: false, stage };
    }
    stage = "remove-permit";
    if (!await removeSoloSessionV2Record(
      realtime.ref(`online/soloMatchPermitsV2/${roomId}`),
      (currentValue) => recordSessionsMatch(currentValue, resources),
    )) return { completed: false, stage };
    stage = "release-locks";
    if (!await releaseSoloSessionV2Locks(resources)) {
      return { completed: false, stage };
    }
    stage = "clear-transition";
    if (!await clearSoloSessionV2RoomTransition(
      roomId,
      soloSessionV2TransitionExpected(resources),
      "accept",
      transitionToken,
      { requireUndestroyed: true },
    )) return { completed: false, stage };
    return { completed: true, stage: "complete" };
  } catch {
    return { completed: false, stage };
  }
}

const SOLO_SESSION_V2_FINALIZATION_STAGES = new Set([
  "refresh-active-pair",
  "remove-offer",
  "remove-host-queue",
  "remove-guest-queue",
  "confirm-reunion",
  "remove-permit",
  "release-locks",
  "clear-transition",
  "complete",
]);

function safeSoloSessionV2FinalizationStage(stage) {
  return SOLO_SESSION_V2_FINALIZATION_STAGES.has(stage) ? stage : "unknown";
}

async function inspectSoloSessionV2AcceptanceCore(roomId, resources) {
  const hostUid = resources.permit.hostUid;
  const guestUid = resources.permit.guestUid;
  const hostSession = resources.permit.sessions[hostUid];
  const guestSession = resources.permit.sessions[guestUid];
  const [
    roomSnapshot,
    hostClaimSnapshot,
    guestClaimSnapshot,
    hostActiveSnapshot,
    guestActiveSnapshot,
  ] = await Promise.all([
    realtime.ref(`online/rooms/${roomId}`).get(),
    soloSessionClaimRef(hostUid).get(),
    soloSessionClaimRef(guestUid).get(),
    soloSessionActiveRef(hostUid, hostSession.sessionId).get(),
    soloSessionActiveRef(guestUid, guestSession.sessionId).get(),
  ]);
  const room = roomSnapshot.val();
  const hostActive = hostActiveSnapshot.val();
  const guestActive = guestActiveSnapshot.val();
  const now = Date.now();
  const safe = room?.status === "active"
    && !room.destroyed
    && roomAttemptMatches(room, soloSessionV2TransitionExpected(resources))
    && recordSessionsMatch(room, resources)
    && claimMatches(hostClaimSnapshot.val(), {
      sessionId: hostSession.sessionId,
      leaseToken: resources.hostActive.leaseToken,
      generation: hostSession.generation,
      now,
    })
    && claimMatches(guestClaimSnapshot.val(), {
      sessionId: guestSession.sessionId,
      leaseToken: resources.guestActive.leaseToken,
      generation: guestSession.generation,
      now,
    })
    && exactSoloSessionV2ActiveIdentity(
      hostActive,
      resources.hostActive,
      hostUid,
      hostSession.sessionId,
    )
    && Number(hostActive.expiresAt || 0) > now
    && exactSoloSessionV2ActiveIdentity(
      guestActive,
      resources.guestActive,
      guestUid,
      guestSession.sessionId,
    )
    && Number(guestActive.expiresAt || 0) > now;
  return { state: safe ? "safe" : "lost", room };
}

async function preserveOrAbortIncompleteSoloSessionV2Acceptance(
  roomId,
  resources,
  transitionToken,
  destroyedByUid,
  finalization,
) {
  let inspection = { state: "unknown", room: resources.room };
  try {
    inspection = await inspectSoloSessionV2AcceptanceCore(roomId, resources);
  } catch {
    // An unreadable backend state is not proof that an already-active match is unsafe.
  }
  console.error("solo session V2 acceptance finalization incomplete", {
    stage: safeSoloSessionV2FinalizationStage(finalization?.stage),
    coreState: inspection.state,
  });
  if (inspection.state === "lost") {
    await abortFailedSoloSessionV2Activation(
      resources,
      transitionToken,
      destroyedByUid,
    ).catch(() => {});
    throw new Error("solo session V2 acceptance core lost");
  }
  return acceptedSoloSessionV2Response(roomId, inspection.room || resources.room)
    || { accepted: false, reason: "room-invalid" };
}

async function completeAcceptedSoloSessionV2Match(
  roomId,
  resources,
  transitionToken,
  destroyedByUid,
) {
  const finalization = await finalizeAcceptedSoloSessionV2Match(
    roomId,
    resources,
    transitionToken,
  );
  if (!finalization.completed) {
    return preserveOrAbortIncompleteSoloSessionV2Acceptance(
      roomId,
      resources,
      transitionToken,
      destroyedByUid,
      finalization,
    );
  }
  const completedRoom = (await realtime.ref(`online/rooms/${roomId}`).get()).val();
  return acceptedSoloSessionV2Response(roomId, completedRoom)
    || { accepted: false, reason: "room-invalid" };
}

async function abortFailedSoloSessionV2Activation(
  resources,
  transitionToken,
  destroyedByUid,
) {
  return cleanupSoloSessionV2Match(resources, {
    restoreQueue: false,
    transitionAction: "accept",
    transitionToken,
    destroyActive: true,
    destroyedByUid,
  });
}

function acceptedSoloSessionV2Response(roomId, room) {
  const hostSession = room.sessions?.[room.hostUid];
  const candidate = soloSessionV2Candidate(room.players?.[room.hostUid], hostSession);
  if (!candidate) return null;
  return {
    accepted: true,
    outcome: "join",
    roomId,
    attemptId: room.attemptId,
    connectionGeneration: room.connectionGeneration,
    candidate,
  };
}

async function acceptSoloSessionV2Match(uid, data) {
  const now = Date.now();
  const claimSnapshot = await soloSessionClaimRef(uid).get();
  const claim = normalizeClaim(claimSnapshot.val());
  if (!claim
      || claim.sessionId !== data.sessionId
      || claim.leaseToken !== data.leaseToken
      || claim.expiresAt <= now) {
    return { accepted: false, reason: "lease-lost" };
  }
  const offerRef = soloSessionOfferRef(uid, data.sessionId, data.roomId);
  const [offerSnapshot, roomSnapshot, permitSnapshot] = await Promise.all([
    offerRef.get(),
    realtime.ref(`online/rooms/${data.roomId}`).get(),
    realtime.ref(`online/soloMatchPermitsV2/${data.roomId}`).get(),
  ]);
  const offer = offerSnapshot.val();
  const room = roomSnapshot.val();
  const permit = permitSnapshot.val();
  if (room?.status === "offered"
      && await soloProfileProjectionParticipantsUpgradeRequired([
        room.players?.[room.hostUid],
        room.players?.[room.guestUid],
      ])) {
    return { accepted: false, reason: "client-upgrade-required" };
  }
  if (room?.status === "active"
      && roomMatchesSessionV2(room, {
        uid,
        sessionId: data.sessionId,
        generation: claim.generation,
        roomId: data.roomId,
      })
      && !room.destroyed) {
    const hostUid = room.hostUid;
    const guestUid = room.guestUid;
    const hostSession = room.sessions?.[hostUid];
    const guestSession = room.sessions?.[guestUid];
    if (!hostUid || !guestUid || !hostSession || !guestSession) {
      return { accepted: false, reason: "room-invalid" };
    }
    const [hostActiveSnapshot, guestActiveSnapshot, hostQueueSnapshot, guestQueueSnapshot] =
      await Promise.all([
        soloSessionActiveRef(hostUid, hostSession?.sessionId).get(),
        soloSessionActiveRef(guestUid, guestSession?.sessionId).get(),
        soloSessionQueueRef(hostUid, hostSession?.sessionId).get(),
        soloSessionQueueRef(guestUid, guestSession?.sessionId).get(),
      ]);
    const ownActive = uid === hostUid
      ? hostActiveSnapshot.val()
      : guestActiveSnapshot.val();
    if (!activeV2EntryIsFresh(uid, ownActive, claim, Date.now())
        || ownActive?.roomId !== data.roomId
        || ownActive?.attemptId !== room.attemptId) {
      return { accepted: false, reason: "room-invalid" };
    }
    const reunionComplete = room.reunion !== true
      || Number(room.reunionConfirmedAt || 0) > 0;
    const finalizationAlreadyComplete = !room.matchTransition
      && !permitSnapshot.exists()
      && reunionComplete;
    if (finalizationAlreadyComplete) {
      return acceptedSoloSessionV2Response(data.roomId, room)
        || { accepted: false, reason: "room-invalid" };
    }
    if (room.matchTransition?.action && room.matchTransition.action !== "accept") {
      return { accepted: false, reason: "transition-busy" };
    }
    const transition = await acquireSoloSessionV2RoomTransition(
      data.roomId,
      room,
      "accept",
      {
        allowActiveAccept: true,
        reuseExistingAction: true,
      },
    );
    if (!transition.acquired) {
      return { accepted: false, reason: transition.reason };
    }
    const latestPermitSnapshot = await realtime.ref(
      `online/soloMatchPermitsV2/${data.roomId}`,
    ).get();
    const storedPermit = latestPermitSnapshot.val();
    const resources = soloSessionV2ResourcesFromStored(
      data.roomId,
      transition.room,
      storedPermit,
      {
        hostActive: hostActiveSnapshot.val(),
        guestActive: guestActiveSnapshot.val(),
        hostQueue: hostQueueSnapshot.val(),
        guestQueue: guestQueueSnapshot.val(),
        requireBothActive: true,
      },
    );
    if (!resources) {
      await clearSoloSessionV2RoomTransition(
        data.roomId,
        transition.room,
        "accept",
        transition.token,
      );
      return { accepted: false, reason: "room-invalid" };
    }
    resources.permitWasStored = latestPermitSnapshot.exists();
    let activePairRefreshed = false;
    try {
      activePairRefreshed = await refreshSoloSessionV2ActivePair(resources);
    } catch {
      activePairRefreshed = false;
    }
    if (!activePairRefreshed) {
      return preserveOrAbortIncompleteSoloSessionV2Acceptance(
        data.roomId,
        resources,
        transition.token,
        uid,
        { completed: false, stage: "refresh-active-pair" },
      );
    }
    return completeAcceptedSoloSessionV2Match(
      data.roomId,
      resources,
      transition.token,
      uid,
    );
  }
  if (!offer
      || offer.toUid !== uid
      || offer.toSessionId !== data.sessionId
      || Number(offer.expiresAt || 0) <= now
      || offer.sessions?.[uid]?.generation !== claim.generation
      || room?.status !== "offered"
      || !roomMatchesSessionV2(room, {
        uid,
        sessionId: data.sessionId,
        generation: claim.generation,
        roomId: data.roomId,
        attemptId: offer.attemptId,
      })
      || Number(permit?.expiresAt || 0) <= now
      || !recordAttemptMatches(permit, {
        hostLock: { attemptId: offer.attemptId },
        permit: { connectionGeneration: offer.connectionGeneration },
      })
      || permit.hostUid !== room.hostUid
      || permit.guestUid !== room.guestUid
      || permit.sessions?.[room.hostUid]?.sessionId
        !== room.sessions?.[room.hostUid]?.sessionId
      || permit.sessions?.[room.hostUid]?.generation
        !== room.sessions?.[room.hostUid]?.generation
      || permit.sessions?.[room.guestUid]?.sessionId
        !== room.sessions?.[room.guestUid]?.sessionId
      || permit.sessions?.[room.guestUid]?.generation
        !== room.sessions?.[room.guestUid]?.generation) {
    return { accepted: false, reason: "offer-stale" };
  }
  const hostUid = room.hostUid;
  const hostSession = room.sessions?.[hostUid];
  const guestSession = room.sessions?.[uid];
  if (!hostUid || !hostSession || !guestSession) {
    return { accepted: false, reason: "offer-stale" };
  }
  const [
    hostClaimSnapshot,
    hostActiveSnapshot,
    guestQueueSnapshot,
    hostLockSnapshot,
    guestLockSnapshot,
  ] = await Promise.all([
    soloSessionClaimRef(hostUid).get(),
    soloSessionActiveRef(hostUid, hostSession.sessionId).get(),
    soloSessionQueueRef(uid, data.sessionId).get(),
    realtime.ref(`online/soloMatchLocksV2/${hostUid}`).get(),
    realtime.ref(`online/soloMatchLocksV2/${uid}`).get(),
  ]);
  const guestQueue = guestQueueSnapshot.val();
  const hostActive = hostActiveSnapshot.val();
  if (!claimMatches(hostClaimSnapshot.val(), {
    sessionId: hostSession.sessionId,
    leaseToken: hostActive?.leaseToken,
    generation: hostSession.generation,
    now: Date.now(),
  })
      || !activeV2EntryIsFresh(hostUid, hostActive, hostClaimSnapshot.val(), Date.now())
      || hostActive.roomId !== data.roomId
      || hostActive.attemptId !== offer.attemptId
      || !queueEntryMatchesClaim(
        uid,
        data.sessionId,
        guestQueue,
        claim,
        Date.now(),
        { allowedStates: ["reserved"] },
      )
      || guestQueue.roomId !== data.roomId
      || guestQueue.attemptId !== offer.attemptId
      || hostLockSnapshot.val()?.attemptId !== offer.attemptId
      || hostLockSnapshot.val()?.sessionId !== hostSession.sessionId
      || hostLockSnapshot.val()?.generation !== hostSession.generation
      || Number(hostLockSnapshot.val()?.expiresAt || 0) <= Date.now()
      || guestLockSnapshot.val()?.attemptId !== offer.attemptId
      || guestLockSnapshot.val()?.sessionId !== guestSession.sessionId
      || guestLockSnapshot.val()?.generation !== guestSession.generation
      || Number(guestLockSnapshot.val()?.expiresAt || 0) <= Date.now()) {
    return { accepted: false, reason: "offer-stale" };
  }
  const resources = buildSoloSessionV2Resources({
    roomId: data.roomId,
    attemptId: room.attemptId,
    connectionGeneration: room.connectionGeneration,
    host: {
      ...room.players[hostUid],
      ...hostSession,
      leaseToken: hostActive.leaseToken,
      protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
    },
    guest: guestQueue,
    now: room.createdAt,
    expiresAt: Math.max(permit.expiresAt, Date.now() + SOLO_SESSION_MATCH_TTL_MS),
    reunion: room.reunion === true,
    pairId: permit.pairId || "",
  });
  resources.permitWasStored = true;
  const activeExpiresAt = Math.min(
    Number(hostClaimSnapshot.val().expiresAt),
    Number(claim.expiresAt),
  );
  resources.guestActive.lastSeen = Date.now();
  resources.guestActive.expiresAt = claim.expiresAt;
  resources.hostActive.lastSeen = Date.now();
  resources.hostActive.expiresAt = Number(hostClaimSnapshot.val().expiresAt);
  if (activeExpiresAt <= Date.now()) {
    return { accepted: false, reason: "offer-stale" };
  }
  const transition = await acquireSoloSessionV2RoomTransition(
    data.roomId,
    resources.room,
    "accept",
  );
  if (!transition.acquired) {
    return { accepted: false, reason: transition.reason };
  }
  resources.room = transition.room;
  const guestReservation = await soloSessionActiveRef(uid, data.sessionId)
    .transaction((currentValue) => {
      if (currentValue
          && Number(currentValue.expiresAt || 0) > Date.now()
          && !(recordAttemptMatches(currentValue, resources)
            && resourceFenceMatches(currentValue, guestQueue))) return;
      return resources.guestActive;
    });
  if (!guestReservation.committed) {
    await clearSoloSessionV2RoomTransition(
      data.roomId,
      soloSessionV2TransitionExpected(resources),
      "accept",
      transition.token,
    );
    return { accepted: false, reason: "occupied" };
  }
  resources.guestActive = guestReservation.snapshot.val();
  const [finalClaim, finalRoom, finalOffer, finalHostActive, fenceStillValid] =
    await Promise.all([
    soloSessionClaimRef(uid).get(),
    realtime.ref(`online/rooms/${data.roomId}`).get(),
    offerRef.get(),
    soloSessionActiveRef(hostUid, hostSession.sessionId).get(),
    readSoloSessionV2MaterializationFence(
      resources,
      {
        ...room.players[hostUid],
        uid: hostUid,
        ...hostSession,
        leaseToken: hostActive.leaseToken,
        protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
      },
      guestQueue,
    ),
  ]);
  if (!claimMatches(finalClaim.val(), {
    sessionId: data.sessionId,
    leaseToken: data.leaseToken,
    generation: guestSession.generation,
    now: Date.now(),
  })
      || finalRoom.val()?.status !== "offered"
      || !roomTransitionOwned(finalRoom.val(), "accept", transition.token)
      || !recordAttemptMatches(finalRoom.val(), resources)
      || !recordSessionsMatch(finalOffer.val(), resources)
      || !exactSoloSessionV2ActiveIdentity(
        finalHostActive.val(),
        resources.hostActive,
        hostUid,
        hostSession.sessionId,
      )
      || !fenceStillValid) {
    await removeSoloSessionV2Record(
      soloSessionActiveRef(uid, data.sessionId),
      (currentValue) => exactSoloSessionV2ActiveIdentity(
        currentValue,
        resources.guestActive,
        uid,
        data.sessionId,
      ),
    );
    await clearSoloSessionV2RoomTransition(
      data.roomId,
      soloSessionV2TransitionExpected(resources),
      "accept",
      transition.token,
    );
    return { accepted: false, reason: "offer-stale" };
  }
  let activePairRefreshed = false;
  try {
    activePairRefreshed = await refreshSoloSessionV2ActivePair(resources);
  } catch {
    activePairRefreshed = false;
  }
  if (!activePairRefreshed) {
    if (!await recoverSoloSessionV2PreActiveMatch(resources, transition.token)) {
      throw new Error("solo session V2 pre-active recovery failed");
    }
    return { accepted: false, reason: "offer-stale" };
  }
  if (!await activateSoloSessionV2Room(data.roomId, resources, transition.token)) {
    const currentRoom = (await realtime.ref(`online/rooms/${data.roomId}`).get()).val();
    if (currentRoom?.status !== "active") {
      await removeSoloSessionV2Record(
        soloSessionActiveRef(uid, data.sessionId),
        (currentValue) => exactSoloSessionV2ActiveIdentity(
          currentValue,
          resources.guestActive,
          uid,
          data.sessionId,
        ),
      );
      await clearSoloSessionV2RoomTransition(
        data.roomId,
        soloSessionV2TransitionExpected(resources),
        "accept",
        transition.token,
      );
    }
    return { accepted: false, reason: "offer-stale" };
  }
  return completeAcceptedSoloSessionV2Match(
    data.roomId,
    resources,
    transition.token,
    uid,
  );
}

async function cancelSoloSessionV2Match(uid, data, { expireOnly = false } = {}) {
  const [claimSnapshot, roomSnapshot] = await Promise.all([
    soloSessionClaimRef(uid).get(),
    realtime.ref(`online/rooms/${data.roomId}`).get(),
  ]);
  const claim = normalizeClaim(claimSnapshot.val());
  const room = roomSnapshot.val();
  if (!claim
      || claim.sessionId !== data.sessionId
      || claim.leaseToken !== data.leaseToken
      || claim.expiresAt <= Date.now()
      || !roomMatchesSessionV2(room, {
        uid,
        sessionId: data.sessionId,
        generation: claim.generation,
        roomId: data.roomId,
      })) return { cancelled: false, reason: "not-owner", status: "" };
  const activeAbortRequested = !expireOnly
    && room.status === "active"
    && (data.abort === true || Boolean(room.destroyed));
  if (room.status === "active") {
    if (room.serverFinalized) {
      return { cancelled: false, reason: "finalized", status: "active" };
    }
    if (!activeAbortRequested) {
      return { cancelled: false, reason: "active", status: "active" };
    }
  } else if (room.status !== "offered") {
    return { cancelled: false, reason: "terminal", status: String(room.status || "") };
  }
  const priorAbort = room.destroyed?.reason === "session-abort"
    && room.destroyed?.attemptId === room.attemptId
    && room.destroyed?.connectionGeneration === room.connectionGeneration;
  const action = expireOnly ? "expire" : "cancel";
  const transition = priorAbort
    ? {
      acquired: true,
      room,
      token: "",
    }
    : await acquireSoloSessionV2RoomTransition(
      data.roomId,
      room,
      action,
      { allowActiveCancel: activeAbortRequested },
    );
  if (!transition.acquired) {
    return {
      cancelled: false,
      reason: transition.reason,
      status: String(room.status || ""),
    };
  }
  const activeRoom = transition.room.status === "active";
  const hostUid = transition.room.hostUid;
  const guestUid = transition.room.guestUid;
  const hostSession = transition.room.sessions?.[hostUid];
  const guestSession = transition.room.sessions?.[guestUid];
  if (!hostUid || !guestUid || !hostSession || !guestSession) {
    if (!priorAbort) {
      await clearSoloSessionV2RoomTransition(
        data.roomId,
        transition.room,
        action,
        transition.token,
      );
    }
    return {
      cancelled: false,
      reason: "stale",
      status: String(transition.room.status || ""),
    };
  }
  const [
    permitSnapshot,
    hostActiveSnapshot,
    guestActiveSnapshot,
    hostQueueSnapshot,
    guestQueueSnapshot,
  ] = await Promise.all([
    realtime.ref(`online/soloMatchPermitsV2/${data.roomId}`).get(),
    soloSessionActiveRef(hostUid, hostSession?.sessionId).get(),
    soloSessionActiveRef(guestUid, guestSession?.sessionId).get(),
    soloSessionQueueRef(hostUid, hostSession?.sessionId).get(),
    soloSessionQueueRef(guestUid, guestSession?.sessionId).get(),
  ]);
  const resources = soloSessionV2ResourcesFromStored(
    data.roomId,
    transition.room,
    permitSnapshot.val(),
    {
      hostActive: hostActiveSnapshot.val(),
      guestActive: guestActiveSnapshot.val(),
      hostQueue: hostQueueSnapshot.val(),
      guestQueue: guestQueueSnapshot.val(),
      requireBothActive: activeRoom,
    },
  );
  if (!resources) {
    if (!priorAbort) {
      await clearSoloSessionV2RoomTransition(
        data.roomId,
        transition.room,
        action,
        transition.token,
      );
    }
    return {
      cancelled: false,
      reason: "stale",
      status: String(transition.room.status || ""),
    };
  }
  resources.permitWasStored = permitSnapshot.exists();
  const cleaned = await cleanupSoloSessionV2Match(resources, {
    restoreQueue: !activeRoom,
    transitionAction: priorAbort ? "" : action,
    transitionToken: transition.token,
    destroyActive: activeRoom,
    destroyedByUid: uid,
  });
  if (!cleaned) {
    const latestRoom = activeRoom
      ? (await realtime.ref(`online/rooms/${data.roomId}`).get()).val()
      : null;
    if (latestRoom?.status === "active" && latestRoom.serverFinalized) {
      return {
        cancelled: false,
        reason: "finalized",
        status: "active",
      };
    }
    return {
      cancelled: false,
      reason: "cleanup-incomplete",
      status: String(transition.room.status || ""),
    };
  }
  return {
    cancelled: true,
    status: activeRoom ? "destroyed" : "expired",
  };
}

async function dispatchSoloSessionAction(uid, data) {
  await consumeSoloSessionActionRate(uid, data.action);
  if (data.action === "claim") return claimSoloSessionV2(uid, data);
  if (data.action === "heartbeat") return heartbeatSoloSessionV2(uid, data);
  if (data.action === "release") return releaseSoloSessionV2(uid, data);
  if (data.action === "try_match") return trySoloSessionV2Match(uid, data);
  if (data.action === "accept") return acceptSoloSessionV2Match(uid, data);
  if (data.action === "cancel") return cancelSoloSessionV2Match(uid, data);
  if (data.action === "expire") {
    return cancelSoloSessionV2Match(uid, data, { expireOnly: true });
  }
  throw new HttpsError("invalid-argument", "未対応の通常版1on1セッション操作です。");
}

exports.soloSessionAction = onCall(callableOptions("soloSessionAction"), async (request) => {
  const uid = requireUid(request);
  const data = requireSoloSessionActionData(request.data);
  try {
    return await dispatchSoloSessionAction(uid, data);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("soloSessionAction failed", {
      action: data.action,
      category: error instanceof TypeError ? "validation" : "internal",
    });
    throw new HttpsError(
      "internal",
      "通常版1on1のセッション処理を完了できませんでした。",
    );
  }
});

exports.trainingAction = onCall(callableOptions("trainingAction"), async (request) => {
  const uid = requireUid(request);
  const data = request.data;
  const action = cleanText(data?.action, 16);
  try {
    if (!isPlainCallableObject(data)) {
      throw new HttpsError("invalid-argument", "鍛え合い60の操作形式が正しくありません。");
    }
    if (action === "initialize") {
      if (Reflect.ownKeys(data).some((key) => key !== "action")) {
        throw new HttpsError("invalid-argument", "鍛え合い60の初期化情報が正しくありません。");
      }
      return await initializeTraining(uid);
    }
    if (action === "finalize") {
      if (Reflect.ownKeys(data).some((key) => !["action", "roomId"].includes(key))
          || !/^[-0-9A-Z_a-z]{20}$/.test(String(data.roomId || ""))) {
        throw new HttpsError("invalid-argument", "鍛え合い60のルーム情報が正しくありません。");
      }
      return await finalizeTraining(uid, data.roomId);
    }
    throw new HttpsError("invalid-argument", "未対応の鍛え合い60操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("trainingAction failed", {
      action,
      category: error instanceof TypeError ? "validation" : "internal",
    });
    throw new HttpsError("internal", "鍛え合い60の記録を処理できませんでした。");
  }
});

exports.economyAction = onCall(callableOptions("economyAction"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 32);
  try {
    if (action === "initialize") return await initializeEconomy(uid);
    if (action === "get_anju_pay_wallet") return await getAnjuPayWallet(uid, request.data);
    if (action === "claim_daily") return await claimDaily(uid, cleanText(request.data?.missionId, 40));
    if (action === "claim_daily_play") return await claimDailyPlayRewards(uid);
    if (action === "reconcile_solo_profile") {
      if (!isPlainCallableObject(request.data)
          || Reflect.ownKeys(request.data).some((key) => key !== "action")) {
        throw new HttpsError("invalid-argument", "通常型1on1戦績の再同期情報が不正です。");
      }
      await consumeSoloSessionActionRate(uid, "reconcile_profile");
      const projection = await reconcileSoloProfileProjection(uid);
      return {
        profileProjectionMode: "server-v2",
        profileProjectionPending: projection.pending,
        soloProfile: projection.soloProfile,
        overallProfile: projection.overallProfile,
      };
    }
    if (action === "purchase") return await purchaseProduct(uid, cleanText(request.data?.productId, 80));
    if (action === "claim_periods") return await claimPeriods(uid);
    if (action === "patron_upgrade") return await upgradePatronage(uid, request, request.data);
    if (action === "oshijo_patron_upgrade") {
      return await upgradeOshijoPatronage(uid, request, request.data);
    }
    if (action === "patron_policy_vote") {
      return await votePatronPolicy(uid, request, request.data);
    }
    if (action === "record_match") return await recordVerifiedMatch(uid, request.data);
    if (action === "set_server_ranking_participation") return await setServerRankingParticipation(uid, request.data);
    if (action === "get_server_ranking_awards") return await getServerRankingAwards(uid);
    if (action === "get_ranking_dashboard") return await getRankingDashboard(uid);
    if (action === "start_crown_run") return await startRankingCrownRun(uid, request.data);
    if (action === "set_crown_customization") return await setCrownCustomization(uid, request.data);
    if (action === "get_match_tip") return await getPostMatchTip(uid, request.data);
    if (action === "send_match_tip") return await sendPostMatchTip(uid, request.data);
    if (action === "get_achievements") return await getAchievements(uid, { syncPublic: request.data?.syncPublic === true });
    if (action === "ack_achievements") return await acknowledgeAchievements(uid, request.data?.achievementIds);
    if (action === "set_achievement_showcase") return await setAchievementShowcase(uid, request.data?.achievementIds);
    if (action === "publish_creator_card") {
      if (!request.app) {
        throw new HttpsError(
          "failed-precondition",
          "推しカードの公開には通信保護が必要です。ページを再読み込みしてください。",
        );
      }
      return await publishCreatorCard(uid, request.data);
    }
    if (action === "delete_creator_card") return await deleteCreatorCard(uid);
    if (action === "sync_achievement_showcase") {
      return { synced: true, achievements: await getAchievements(uid, { syncPublic: true }) };
    }
    throw new HttpsError("invalid-argument", "未対応のAnjuPay操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("economyAction failed", { uid, action, error });
    throw new HttpsError("internal", "AnjuPay処理を完了できませんでした。");
  }
});

exports.soloFamiliarAction = onCall(callableOptions("soloFamiliarAction"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 32);
  try {
    if (action === "get") return await loadSoloFamiliarBook(uid);
    if (action === "get_blocks") {
      const rollout = await loadSoloFamiliarRollout();
      if (!rollout.familiarBookEnabled) {
        return { blocked: [], blockedCursor: "" };
      }
      return await loadSoloFamiliarBlockPage(uid, request.data?.afterId);
    }
    if (action === "accept_familiar") return await acceptSoloFamiliar(uid, request.data);
    if (action === "remove") return await removeOrBlockSoloFamiliar(uid, request.data, false);
    if (action === "block") return await removeOrBlockSoloFamiliar(uid, request.data, true);
    if (action === "unblock") return await unblockSoloFamiliar(uid, request.data);
    if (action === "try_match") return await trySoloServerMatch(uid);
    if (action === "confirm_reunion") return await confirmSoloFamiliarReunion(uid, request.data);
    throw new HttpsError("invalid-argument", "未対応の顔なじみ操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("soloFamiliarAction failed", { uid, action, error });
    throw new HttpsError("internal", "顔なじみ帳を処理できませんでした。");
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

async function trainingActiveSessionIsLive(uid, activeSnapshot, now) {
  if (!activeSnapshot.exists()) return false;
  const activeValue = objectValue(activeSnapshot.val());
  const roomId = cleanText(activeValue.roomId, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(roomId)) return false;
  const reservedRoomIds = Object.entries(objectValue(activeValue.rooms))
    .filter(([, reserved]) => reserved === true)
    .map(([reservedRoomId]) => reservedRoomId);
  if (reservedRoomIds.length !== 1 || reservedRoomIds[0] !== roomId) return false;
  const roomSnapshot = await realtime.ref(`online/trainingRooms/${roomId}`).get();
  return roomSnapshot.exists()
    && trainingActiveRoomIsLive(roomSnapshot.val(), uid, now);
}

async function accountHasActiveSession(uid) {
  const realtimePaths = [
    { path: "active", roomPath: "rooms" },
    { path: "queue", queue: true },
    { path: "strategyActive", roomPath: "strategyRooms" },
    { path: "strategyQueue", queue: true },
    { path: "trainingActive", roomPath: "trainingRooms" },
    { path: "trainingQueue", queue: true },
  ];
  const now = Date.now();
  const snapshots = await Promise.all([
    ...realtimePaths.map(({ path }) => realtime.ref(`online/${path}/${uid}`).get()),
    marketActiveRef(uid).get(),
    marketQueueRef(uid).get(),
    soloSessionClaimRef(uid).get(),
    liveSoloSessionV2Room(uid, now),
  ]);
  const realtimeSnapshots = snapshots.slice(0, realtimePaths.length);
  if (realtimeSnapshots.some((snapshot, index) => {
    if (!snapshot.exists() || !realtimePaths[index].queue) return false;
    return Number(snapshot.val()?.lastSeen || 0) >= now - QUEUE_FRESH_MS;
  })) return true;
  const activeChecks = await Promise.all(realtimePaths.map((entry, index) => (
    entry.roomPath
      ? entry.path === "trainingActive"
        ? trainingActiveSessionIsLive(uid, realtimeSnapshots[index], now)
        : realtimeActiveSessionIsLive(uid, entry.roomPath, realtimeSnapshots[index])
      : false
  )));
  if (activeChecks.some(Boolean)) return true;
  const marketActiveSnapshot = snapshots[realtimePaths.length];
  const marketQueueSnapshot = snapshots[realtimePaths.length + 1];
  const soloSessionClaimSnapshot = snapshots[realtimePaths.length + 2];
  const soloSessionRoom = snapshots[realtimePaths.length + 3];
  const soloSessionClaim = normalizeClaim(soloSessionClaimSnapshot.val());
  if ((soloSessionClaim && soloSessionClaim.expiresAt > now) || soloSessionRoom) return true;
  const marketQueue = marketQueueSnapshot.data();
  if (marketQueueSnapshot.exists
      && marketQueue?.status === "waiting"
      && Number(marketQueue.lastSeen || 0) >= now - QUEUE_FRESH_MS) return true;
  return marketSessionIsFresh(uid, marketActiveSnapshot, now);
}

function economyProgressHasActivity(value) {
  const progress = normalizeEconomyProgress(value);
  const dailyKeys = [
    "matches",
    "scores",
    "criticals",
    "soloMatches",
    "strategyMatches",
    "teamMatches",
    "trainingSets",
  ];
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
    fleaSellerCardSnapshot,
    patronSnapshot,
    trainingProfileSnapshot,
    trainingClaimSnapshot,
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
    familiarBookSnapshot,
    familiarBlockSnapshot,
  ] = await Promise.all([
    adminAuth.getUser(uid),
    walletRef(uid).get(),
    economyProgressRef(uid).get(),
    marketStatsRef(uid).get(),
    firestore.collection("anjuPayFleaSellerCards").doc(uid).get(),
    patronageRef(uid).get(),
    trainingProfileRef(uid).get(),
    firestore.collection("trainingClaims").doc(uid).collection("rooms").limit(1).get(),
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
    soloFamiliarBookRef(uid).get(),
    soloFamiliarBlockRef(uid).get(),
  ]);
  if (userRecord.disabled || userRecord.providerData.length > 0) return false;
  if (safeBalance(walletSnapshot.get("balance")) > 0
      || integer(walletSnapshot.get("reservedIncoming"), 0, MAX_POINTS, 0) > 0) return false;
  if (integer(walletSnapshot.get("ledgerSequence"), 0, Number.MAX_SAFE_INTEGER, 0) > 0) {
    return false;
  }
  if (progressSnapshot.exists && economyProgressHasActivity(progressSnapshot.data())) return false;
  const trainingProfile = normalizeTrainingProfile(trainingProfileSnapshot.data());
  if (trainingProfile.sessions > 0
      || trainingProfile.completedSets > 0
      || trainingProfile.completeDays > 0
      || !trainingClaimSnapshot.empty) return false;
  if (marketSnapshot.exists || fleaSellerCardSnapshot.exists || patronSnapshot.exists
      || !purchaseSnapshot.empty || !dailyClaimSnapshot.empty || !periodClaimSnapshot.empty) return false;
  if (realtimeEconomyHasActivity(economySnapshot.val())) return false;
  return !soloProfileSnapshot.exists()
    && !strategyProfileSnapshot.exists()
    && !teamProfileSnapshot.exists()
    && !royaleProfileSnapshot.exists()
    && !leaderboardSnapshot.exists()
    && !periodLeaderboardSnapshot.exists()
    && !topMessageSnapshot.exists()
    && !familiarBookSnapshot.exists
    && !familiarBlockSnapshot.exists;
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
      targetFleaSellerCardSnapshot,
      targetPatronSnapshot,
      targetTrainingProfileSnapshot,
      targetFamiliarBookSnapshot,
      targetFamiliarBlockSnapshot,
    ] = await Promise.all([
      transaction.get(attemptRef),
      transaction.get(codeRef),
      transaction.get(walletRef(targetUid)),
      transaction.get(economyProgressRef(targetUid)),
      transaction.get(marketStatsRef(targetUid)),
      transaction.get(firestore.collection("anjuPayFleaSellerCards").doc(targetUid)),
      transaction.get(patronageRef(targetUid)),
      transaction.get(trainingProfileRef(targetUid)),
      transaction.get(soloFamiliarBookRef(targetUid)),
      transaction.get(soloFamiliarBlockRef(targetUid)),
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
    if (integer(
      targetWalletSnapshot.get("ledgerSequence"),
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    ) > 0) {
      failure = "target-not-empty";
      return;
    }
    const targetTrainingProfile = normalizeTrainingProfile(
      targetTrainingProfileSnapshot.data(),
    );
    if ((targetProgressSnapshot.exists && economyProgressHasActivity(targetProgressSnapshot.data()))
        || targetMarketSnapshot.exists
        || targetFleaSellerCardSnapshot.exists
        || targetPatronSnapshot.exists
        || targetTrainingProfile.sessions > 0
        || targetTrainingProfile.completedSets > 0
        || targetTrainingProfile.completeDays > 0
        || targetFamiliarBookSnapshot.exists
        || targetFamiliarBlockSnapshot.exists) {
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

function marketQueueControlRef(uid) {
  return firestore.collection("valueMarketQueueControls").doc(uid);
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

function marketShopRef(uid) {
  return firestore.collection("valueMarketShops").doc(uid);
}

function marketShopSalesModeRef(uid) {
  return firestore.collection("valueMarketShopSalesModes").doc(uid);
}

function marketShopPublicRef(publicSellerId) {
  return firestore.collection("valueMarketShopPublic").doc(publicSellerId);
}

function marketShopFavoritesRef(buyerUid) {
  return firestore.collection("valueMarketShopFavorites").doc(buyerUid).collection("sellers");
}

function marketShopFavoriteRef(buyerUid, sellerUid) {
  return marketShopFavoritesRef(buyerUid).doc(sellerUid);
}

function marketShopBlocksRef(uid) {
  return firestore.collection("valueMarketShopBlocks").doc(uid).collection("users");
}

function marketShopBlockRef(uid, targetUid) {
  return marketShopBlocksRef(uid).doc(targetUid);
}

function marketShopRelationshipRef(sellerUid, buyerUid) {
  return firestore.collection("valueMarketShopRelationships")
    .doc(eventId(`${sellerUid}:${buyerUid}`));
}

function marketShopImpressionRef(roomId, buyerUid) {
  return firestore.collection("valueMarketShopImpressions")
    .doc(eventId(`${roomId}:${buyerUid}`));
}

function createPublicSellerId() {
  return crypto.randomBytes(15).toString("base64url");
}

function marketShopVerifiedReport(shopValue, statsValue) {
  const shop = normalizeStoredMarketShop(shopValue);
  const privateReport = marketShopReport(shop);
  const stats = statsValue && typeof statsValue === "object" ? statsValue : {};
  return {
    salesCount: marketShopSalesCount(shopValue, stats),
    bestSale: Object.prototype.hasOwnProperty.call(
      shopValue && typeof shopValue === "object" ? shopValue : {},
      "bestSale",
    )
      ? integer(shop.bestSale, 0, MARKET_MAX_PRICE, 0)
      : integer(stats.bestSale, 0, MARKET_MAX_PRICE, 0),
    marketDays: integer(stats.marketDays, 0, 100_000, 0),
    uniqueCounterparties: privateReport.uniqueBuyerCount,
    repeatBuyerCount: privateReport.repeatBuyerCount,
    impressions: { ...privateReport.impressionCounts },
    impressionBuyerCount: privateReport.impressionBuyerCount,
    favoriteCount: privateReport.favoriteCount,
  };
}

function marketShopPublicRecord(uid, shopValue, statsValue, timestamp = Date.now()) {
  const shop = normalizeStoredMarketShop(shopValue);
  return {
    schemaVersion: 1,
    publicSellerId: shop.publicSellerId,
    sellerUid: uid,
    sellerShop: publicSellerShop(shopValue, { marketStats: statsValue }),
    createdAt: shop.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

async function ensureMarketShop(uid, fallbackName = DEFAULT_MARKET_SHOP.shopName) {
  const shopRef = marketShopRef(uid);
  const salesModeRef = marketShopSalesModeRef(uid);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidatePublicSellerId = createPublicSellerId();
    try {
      return await firestore.runTransaction(async (transaction) => {
        const [shopSnapshot, salesModeSnapshot] = await Promise.all([
          transaction.get(shopRef),
          transaction.get(salesModeRef),
        ]);
        const storedShopValue = shopSnapshot.data();
        const restoredShopValue = restoreMarketShopSalesModeRecord(
          storedShopValue,
          salesModeSnapshot.data(),
        );
        const stored = normalizeStoredMarketShop(restoredShopValue, {
          fallbackName: cleanName(fallbackName),
          publicSellerId: candidatePublicSellerId,
        });
        const publicSellerId = isValidPublicSellerId(stored.publicSellerId)
          ? stored.publicSellerId
          : candidatePublicSellerId;
        const publicRef = marketShopPublicRef(publicSellerId);
        const [publicSnapshot, statsSnapshot] = await Promise.all([
          transaction.get(publicRef),
          transaction.get(marketStatsRef(uid)),
        ]);
        const mappedUid = cleanText(publicSnapshot.get("sellerUid"), 128);
        if (publicSnapshot.exists && mappedUid && mappedUid !== uid) {
          const collision = new Error("Public seller id collision.");
          collision.marketShopPublicIdCollision = true;
          throw collision;
        }
        const now = Date.now();
        const shop = {
          ...stored,
          publicSellerId,
          issueCount: marketShopSalesCount(storedShopValue, statsSnapshot.data()),
          bestSale: Object.prototype.hasOwnProperty.call(
            storedShopValue && typeof storedShopValue === "object" ? storedShopValue : {},
            "bestSale",
          )
            ? stored.bestSale
            : integer(statsSnapshot.get("bestSale"), 0, MARKET_MAX_PRICE, 0),
          createdAt: stored.createdAt || now,
          updatedAt: stored.updatedAt || now,
        };
        transaction.set(shopRef, shop);
        transaction.set(salesModeRef, marketShopSalesModeRecord(shop, now));
        transaction.set(publicRef, marketShopPublicRecord(uid, shop, statsSnapshot.data(), now));
        return shop;
      });
    } catch (error) {
      if (error?.marketShopPublicIdCollision === true) continue;
      throw error;
    }
  }
  throw new HttpsError("aborted", "店コードを発行できませんでした。もう一度お試しください。");
}

async function ownedMarketProductIds(uid) {
  const [legacyEconomy, purchasesSnapshot] = await Promise.all([
    readLegacyEconomy(uid),
    firestore.collection("economyPurchases").doc(uid).collection("items").get(),
  ]);
  const ownedIds = new Set(
    Object.entries(objectValue(legacyEconomy.inventory))
      .filter(([, owned]) => owned === true)
      .map(([productId]) => productId),
  );
  purchasesSnapshot.docs.forEach((snapshot) => {
    const productId = cleanText(snapshot.get("productId") || snapshot.id, 80);
    if (PRODUCT_CATALOG[productId]) ownedIds.add(productId);
  });
  return ownedIds;
}

async function ownedMarketCustomizationIds(uid) {
  const ownedIds = await ownedMarketProductIds(uid);
  const ownedTitleIds = [...ownedIds]
    .filter((productId) => PRODUCT_CATALOG[productId]?.type === "title")
    .sort();
  const ownedPaidStampIds = [...ownedIds]
    .filter((productId) => PRODUCT_CATALOG[productId]?.type === "stamp")
    .sort();
  return {
    ownedTitleIds,
    ownedShopCharmIds: [
      ...FREE_MARKET_SHOP_CHARM_IDS,
      ...ownedPaidStampIds.filter((productId) => !FREE_MARKET_SHOP_CHARM_IDS.includes(productId)),
    ],
  };
}

async function resolveSelectedFavoriteSeller(buyerUid, favoritePublicSellerIdValue) {
  const favoritePublicSellerId = typeof favoritePublicSellerIdValue === "string"
    ? favoritePublicSellerIdValue.trim()
    : "";
  if (!isValidPublicSellerId(favoritePublicSellerId)) {
    throw new HttpsError("invalid-argument", "待機する常連店を選んでください。");
  }
  const favoritesSnapshot = await marketShopFavoritesRef(buyerUid)
    .where("publicSellerId", "==", favoritePublicSellerId)
    .limit(2)
    .get();
  if (favoritesSnapshot.size !== 1) {
    throw new HttpsError("failed-precondition", "選択した商店は常連帳にありません。");
  }
  const favoriteSnapshot = favoritesSnapshot.docs[0];
  const sellerUid = String(favoriteSnapshot.id || "");
  if (
    !sellerUid
    || sellerUid === buyerUid
    || favoriteSnapshot.get("buyerUid") !== buyerUid
    || favoriteSnapshot.get("sellerUid") !== sellerUid
    || favoriteSnapshot.get("publicSellerId") !== favoritePublicSellerId
  ) {
    throw new HttpsError("failed-precondition", "常連帳の商店情報を確認できませんでした。");
  }
  const publicSnapshot = await marketShopPublicRef(favoritePublicSellerId).get();
  const sellerShop = publicSellerShop(publicSnapshot.get("sellerShop"));
  if (
    !publicSnapshot.exists
    || cleanText(publicSnapshot.get("sellerUid"), 128) !== sellerUid
    || sellerShop?.publicSellerId !== favoritePublicSellerId
    || sellerShop.repeatWelcome !== true
  ) {
    throw new HttpsError("failed-precondition", "選択した商店は現在、常連受付を休止しています。");
  }
  return { sellerUid, publicSellerId: favoritePublicSellerId };
}

async function resolvePreferredRecommendedSeller(buyerUid, publicSellerIdValue) {
  const publicSellerId = typeof publicSellerIdValue === "string"
    ? publicSellerIdValue.trim()
    : "";
  if (!isValidPublicSellerId(publicSellerId)) {
    throw new HttpsError("invalid-argument", "優先して探す推薦商店を確認できませんでした。");
  }
  const seasonKey = periodKey("monthly");
  const [publicSnapshot, recommendationSnapshot] = await Promise.all([
    marketShopPublicRef(publicSellerId).get(),
    patronRecommendedShopRef(seasonKey, publicSellerId).get(),
  ]);
  const sellerUid = cleanText(publicSnapshot.get("sellerUid"), 128);
  const sellerShop = publicSellerShop(publicSnapshot.get("sellerShop"));
  const recommendationCount = integer(
    recommendationSnapshot.get("recommendationCount"),
    0,
    1_000_000,
    0,
  );
  if (
    !publicSnapshot.exists
    || !recommendationSnapshot.exists
    || recommendationCount < PATRON_RECOMMENDED_SHELF_MINIMUM
    || !sellerUid
    || sellerUid === buyerUid
    || sellerShop?.publicSellerId !== publicSellerId
  ) {
    throw new HttpsError(
      "failed-precondition",
      "この商店は現在の推薦商店から外れています。推薦棚を更新して選び直してください。",
    );
  }
  return { sellerUid, publicSellerId };
}

async function marketQueueShopContext(uid, role, fallbackName, data = {}) {
  const selectedFavoritePromise = role === "buyer" && data?.matchMode === "favorites"
    ? resolveSelectedFavoriteSeller(uid, data?.favoritePublicSellerId)
    : Promise.resolve(null);
  const preferredRecommendedPromise = role === "buyer"
    && data?.matchMode !== "favorites"
    && data?.preferredPublicSellerId
    ? resolvePreferredRecommendedSeller(uid, data.preferredPublicSellerId)
    : Promise.resolve(null);
  const [
    blocksSnapshot,
    selectedFavoriteSeller,
    preferredRecommendedSeller,
  ] = await Promise.all([
    marketShopBlocksRef(uid).orderBy("updatedAt", "desc").limit(100).get(),
    selectedFavoritePromise,
    preferredRecommendedPromise,
  ]);
  const context = {
    blockedUids: blocksSnapshot.docs.map((snapshot) => snapshot.id),
    selectedFavoriteSellerUid: selectedFavoriteSeller?.sellerUid || "",
    selectedFavoritePublicSellerId: selectedFavoriteSeller?.publicSellerId || "",
    preferredSellerUid: preferredRecommendedSeller?.sellerUid || "",
    preferredPublicSellerId: preferredRecommendedSeller?.publicSellerId || "",
    sellerShop: null,
  };
  if (role === "seller") {
    const shop = await ensureMarketShop(uid, fallbackName);
    const statsSnapshot = await marketStatsRef(uid).get();
    context.sellerShop = publicSellerShop(shop, { marketStats: statsSnapshot.data() });
  }
  return context;
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

function normalizeQueueEntry(
  uid,
  data,
  balance,
  appCheckVerified,
  patronageValue = null,
  shopContext = {},
  queueRequest = {},
) {
  const role = data?.role === "seller" ? "seller" : data?.role === "buyer" ? "buyer" : "";
  if (!role) throw new HttpsError("invalid-argument", "売り手または買い手を選択してください。");
  const now = Date.now();
  const queueRequestedAt = integer(queueRequest.requestedAt, 1, Number.MAX_SAFE_INTEGER, now);
  const queueToken = /^[a-f0-9]{32}$/.test(String(queueRequest.token || ""))
    ? String(queueRequest.token)
    : crypto.randomBytes(16).toString("hex");
  const base = {
    uid,
    role,
    name: cleanName(data?.name),
    status: "waiting",
    queueToken,
    queueRequestedAt,
    joinedAt: queueRequestedAt,
    lastSeen: now,
    lastMatchAttemptAt: now,
    skippedCandidateSessions: [],
    skippedCandidatesResetAt: 0,
    publicPresenceId: createMarketPublicPresenceId(),
    appCheckVerified: appCheckVerified === true,
    patron: publicPatronage(patronageValue, periodKey("monthly")),
    blockedUids: Array.isArray(shopContext.blockedUids) ? shopContext.blockedUids : [],
  };
  if (role === "seller") {
    return {
      ...base,
      sellerShop: shopContext.sellerShop || null,
      listing: {
        title: cleanText(data?.listing?.title, 30, "無題の推し"),
        askingPrice: integer(data?.listing?.askingPrice, MARKET_MIN_PRICE, MARKET_MAX_PRICE, 50),
        pitchStyle: ["chat", "audio", "either"].includes(data?.listing?.pitchStyle) ? data.listing.pitchStyle : "either",
      },
    };
  }
  const affordable = Math.max(MARKET_MIN_PRICE, Math.min(MARKET_MAX_PRICE, balance - MARKET_ENTRY_FEE));
  if (balance < MARKET_ENTRY_FEE + MARKET_MIN_PRICE) {
    throw new HttpsError("failed-precondition", `買い手は着手料${MARKET_ENTRY_FEE} Payと購入用${MARKET_MIN_PRICE} Payが必要です。`);
  }
  const matchMode = data?.matchMode === "favorites" ? "favorites" : "discover";
  if (matchMode === "favorites" && !shopContext.selectedFavoriteSellerUid) {
    throw new HttpsError("failed-precondition", "待機する常連店を確認できませんでした。");
  }
  return {
    ...base,
    maxBudget: integer(data?.maxBudget, MARKET_MIN_PRICE, affordable, affordable),
    matchMode,
    selectedFavoriteSellerUid: matchMode === "favorites"
      ? shopContext.selectedFavoriteSellerUid
      : "",
    selectedFavoritePublicSellerId: matchMode === "favorites"
      ? shopContext.selectedFavoritePublicSellerId
      : "",
    preferredSellerUid: matchMode === "discover"
      ? cleanText(shopContext.preferredSellerUid, 128)
      : "",
    preferredPublicSellerId: matchMode === "discover"
      ? cleanText(shopContext.preferredPublicSellerId, 40)
      : "",
    preferredSellerExpandAt: matchMode === "discover" && shopContext.preferredSellerUid
      ? queueRequestedAt + MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS
      : 0,
  };
}

function queuesCompatible(first, second) {
  return marketQueuesCompatible(first, second);
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
        closingMode: room.closingMode === "oshijo" ? "oshijo" : "",
        claimAmount: integer(
          room.claimAmount,
          0,
          MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
          0,
        ),
        oshijoClosingTurnCount: integer(
          room.oshijoClosingTurnCount,
          0,
          MARKET_OSHIJO_MAX_CLOSING_TURNS,
          0,
        ),
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

function marketRecommendedPreferenceCompatible(first, second, now = Date.now()) {
  if (!first || !second || first.role === second.role) return false;
  const seller = first.role === "seller" ? first : second;
  const buyer = first.role === "buyer" ? first : second;
  const preferredSellerUid = cleanText(buyer.preferredSellerUid, 128);
  if (!preferredSellerUid || preferredSellerUid === seller.uid) return true;
  return Number(buyer.preferredSellerExpandAt || 0) <= now;
}

function prioritizeRecommendedMarketCandidates(ownEntry, candidateEntries, now = Date.now()) {
  const candidates = (Array.isArray(candidateEntries) ? candidateEntries : [])
    .filter((candidate) => marketRecommendedPreferenceCompatible(ownEntry, candidate, now));
  const targetUid = ownEntry.role === "buyer"
    ? cleanText(ownEntry.preferredSellerUid, 128)
    : cleanText(ownEntry.uid, 128);
  if (!targetUid) return candidates;
  return candidates.sort((first, second) => {
    const firstPreferred = ownEntry.role === "buyer"
      ? first.uid === targetUid
      : first.preferredSellerUid === targetUid;
    const secondPreferred = ownEntry.role === "buyer"
      ? second.uid === targetUid
      : second.preferredSellerUid === targetUid;
    return Number(secondPreferred) - Number(firstPreferred);
  });
}

async function loadMarketQueueCandidates(ownEntry, minimumLastSeen) {
  if (ownEntry.role === "buyer" && ownEntry.matchMode === "favorites") {
    const targetSnapshot = await marketQueueRef(ownEntry.selectedFavoriteSellerUid).get();
    return targetSnapshot.exists ? [targetSnapshot.data()] : [];
  }
  const oppositeRole = ownEntry.role === "seller" ? "buyer" : "seller";
  const standardCandidatesPromise = (async () => {
    const candidates = [];
    let cursor = null;
    for (let page = 0; page < 3; page += 1) {
      let query = firestore.collection("valueMarketQueues")
        .where("role", "==", oppositeRole)
        .where("status", "==", "waiting");
      if (ownEntry.role === "seller") {
        query = query
          .where("matchMode", "==", "discover")
          .where("maxBudget", ">=", Number(ownEntry.listing?.askingPrice || MARKET_MIN_PRICE))
          .where("lastSeen", ">=", minimumLastSeen)
          .orderBy("maxBudget", "asc")
          .orderBy("lastSeen", "asc");
      } else {
        query = query
          .where("listing.askingPrice", "<=", Number(ownEntry.maxBudget || MARKET_MIN_PRICE))
          .where("lastSeen", ">=", minimumLastSeen)
          .orderBy("listing.askingPrice", "asc")
          .orderBy("lastSeen", "asc");
      }
      query = query.limit(40);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      candidates.push(...snapshot.docs.map((candidateSnapshot) => candidateSnapshot.data()));
      if (
        snapshot.size < 40
        || selectMarketQueueCandidates(ownEntry, candidates, {
          minimumLastSeen,
          requireAppCheck: MARKET_APP_CHECK_MIGRATION,
        }).length >= 12
      ) {
        break;
      }
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    return candidates;
  })();
  const selectedBuyersPromise = ownEntry.role === "seller"
    ? firestore.collection("valueMarketQueues")
      .where("selectedFavoriteSellerUid", "==", ownEntry.uid)
      .where("status", "==", "waiting")
      .where("lastSeen", ">=", minimumLastSeen)
      .orderBy("lastSeen", "asc")
      .limit(40)
      .get()
    : Promise.resolve(null);
  const preferredBuyersPromise = ownEntry.role === "seller"
    ? firestore.collection("valueMarketQueues")
      .where("preferredSellerUid", "==", ownEntry.uid)
      .where("status", "==", "waiting")
      .where("lastSeen", ">=", minimumLastSeen)
      .orderBy("lastSeen", "asc")
      .limit(40)
      .get()
    : Promise.resolve(null);
  const preferredSellerPromise = ownEntry.role === "buyer"
    && ownEntry.matchMode === "discover"
    && cleanText(ownEntry.preferredSellerUid, 128)
    ? marketQueueRef(ownEntry.preferredSellerUid).get()
    : Promise.resolve(null);
  const [
    standardCandidates,
    selectedBuyersSnapshot,
    preferredBuyersSnapshot,
    preferredSellerSnapshot,
  ] = await Promise.all([
    standardCandidatesPromise,
    selectedBuyersPromise,
    preferredBuyersPromise,
    preferredSellerPromise,
  ]);
  return [
    ...(preferredSellerSnapshot?.exists ? [preferredSellerSnapshot.data()] : []),
    ...standardCandidates,
    ...(selectedBuyersSnapshot?.docs.map((snapshot) => snapshot.data()) || []),
    ...(preferredBuyersSnapshot?.docs.map((snapshot) => snapshot.data()) || []),
  ];
}

function sameMarketQueueSession(entry, queueToken) {
  return entry?.status === "waiting"
    && /^[a-f0-9]{32}$/.test(String(queueToken || ""))
    && entry.queueToken === queueToken;
}

function nextSkippedMarketQueueSessions(entry, candidateEntry) {
  const candidateSession = marketQueueCandidateSessionKey(candidateEntry);
  const existing = Array.isArray(entry?.skippedCandidateSessions)
    ? entry.skippedCandidateSessions.map(String).filter(Boolean)
    : [];
  if (!candidateSession) return existing.slice(-64);
  return [
    ...existing.filter((session) => session !== candidateSession),
    candidateSession,
  ].slice(-64);
}

async function claimMarketQueue(uid, ownEntry, expectedGeneration) {
  const queueRef = marketQueueRef(uid);
  const activeRef = marketActiveRef(uid);
  const controlRef = marketQueueControlRef(uid);
  let outcome = null;
  await firestore.runTransaction(async (transaction) => {
    const [queueSnapshot, activeSnapshot, controlSnapshot] = await Promise.all([
      transaction.get(queueRef),
      transaction.get(activeRef),
      transaction.get(controlRef),
    ]);
    const current = queueSnapshot.data();
    const control = controlSnapshot.data() || {};
    const generation = integer(controlSnapshot.get("generation"), 0, Number.MAX_SAFE_INTEGER, 0);
    if (activeSnapshot.exists) {
      outcome = {
        status: "matched",
        roomId: cleanText(activeSnapshot.get("roomId"), 80),
        presenceId: marketPublicPresenceId(current?.publicPresenceId),
      };
      if (queueSnapshot.exists) transaction.delete(queueRef);
      return;
    }
    if (generation !== expectedGeneration) {
      outcome = {
        status: "canceled",
        roomId: "",
        presenceId: "",
      };
      return;
    }
    const latestRequestedAt = integer(
      control.latestRequestedAt,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    );
    if (
      latestRequestedAt > 0
      && !shouldReplaceMarketQueue({
        status: "waiting",
        queueRequestedAt: latestRequestedAt,
        queueToken: String(control.latestToken || ""),
      }, ownEntry)
    ) {
      outcome = {
        status: "superseded",
        roomId: "",
        entry: current,
        presenceId: "",
      };
      return;
    }
    if (!shouldReplaceMarketQueue(current, ownEntry)) {
      outcome = {
        status: "superseded",
        roomId: "",
        entry: current,
        presenceId: "",
      };
      return;
    }
    const reusablePresenceId = current?.status === "waiting"
      && Number(current.lastSeen || 0) >= Date.now() - QUEUE_FRESH_MS
      ? marketPublicPresenceId(current.publicPresenceId)
      : "";
    const claimedEntry = {
      ...ownEntry,
      publicPresenceId: reusablePresenceId || ownEntry.publicPresenceId,
    };
    transaction.set(queueRef, claimedEntry);
    transaction.set(controlRef, {
      generation,
      latestRequestedAt: claimedEntry.queueRequestedAt,
      latestToken: claimedEntry.queueToken,
      updatedAt: Date.now(),
    }, { merge: true });
    outcome = {
      status: "waiting",
      roomId: "",
      entry: claimedEntry,
      presenceId: reusablePresenceId
        ? ""
        : marketPublicPresenceId(current?.publicPresenceId),
    };
  });
  return outcome;
}

async function validateTargetedMarketQueueSession(uid, ownEntry) {
  if (ownEntry.role !== "buyer" || ownEntry.matchMode !== "favorites") {
    return { status: "valid", roomId: "" };
  }
  const sellerUid = cleanText(ownEntry.selectedFavoriteSellerUid, 128);
  const publicSellerId = cleanText(ownEntry.selectedFavoritePublicSellerId, 96);
  if (!sellerUid || !isValidPublicSellerId(publicSellerId)) {
    return { status: "invalid-target", roomId: "" };
  }
  const queueRef = marketQueueRef(uid);
  const activeRef = marketActiveRef(uid);
  const publicRef = marketShopPublicRef(publicSellerId);
  const favoriteRef = marketShopFavoriteRef(uid, sellerUid);
  let outcome = { status: "valid", roomId: "", presenceId: "" };
  await firestore.runTransaction(async (transaction) => {
    const [queueSnapshot, activeSnapshot, publicSnapshot, favoriteSnapshot] = await Promise.all([
      transaction.get(queueRef),
      transaction.get(activeRef),
      transaction.get(publicRef),
      transaction.get(favoriteRef),
    ]);
    const current = queueSnapshot.data();
    if (activeSnapshot.exists) {
      outcome = {
        status: "matched",
        roomId: cleanText(activeSnapshot.get("roomId"), 80),
        presenceId: marketPublicPresenceId(current?.publicPresenceId),
      };
      if (queueSnapshot.exists) transaction.delete(queueRef);
      return;
    }
    if (!queueSnapshot.exists) {
      outcome = { status: "missing", roomId: "", presenceId: "" };
      return;
    }
    if (!sameMarketQueueSession(current, ownEntry.queueToken)) {
      outcome = { status: "superseded", roomId: "", presenceId: "" };
      return;
    }
    const liveSellerShop = publicSellerShop(publicSnapshot.get("sellerShop"));
    const valid = publicSnapshot.exists
      && cleanText(publicSnapshot.get("sellerUid"), 128) === sellerUid
      && liveSellerShop?.publicSellerId === publicSellerId
      && liveSellerShop.repeatWelcome === true
      && favoriteSnapshot.exists
      && favoriteSnapshot.get("buyerUid") === uid
      && favoriteSnapshot.get("sellerUid") === sellerUid
      && favoriteSnapshot.get("publicSellerId") === publicSellerId;
    if (!valid) {
      transaction.delete(queueRef);
      outcome = {
        status: "invalid-target",
        roomId: "",
        presenceId: marketPublicPresenceId(current.publicPresenceId),
      };
    }
  });
  if (outcome.presenceId) {
    await bestEffort("validateTargetedMarketQueueSession", [
      removeMarketQueuePublicPresence(outcome.presenceId),
    ]);
  }
  return outcome;
}

async function tryMatchMarketQueueSession(uid, ownEntry) {
  const targetValidation = await validateTargetedMarketQueueSession(uid, ownEntry);
  if (targetValidation.status !== "valid") return targetValidation;
  const minimumLastSeen = Date.now() - QUEUE_FRESH_MS;
  const candidateEntries = await loadMarketQueueCandidates(ownEntry, minimumLastSeen);
  const candidates = prioritizeRecommendedMarketCandidates(
    ownEntry,
    selectMarketQueueCandidates(ownEntry, candidateEntries, {
      minimumLastSeen,
      requireAppCheck: MARKET_APP_CHECK_MIGRATION,
    }),
  ).slice(0, 8);

  for (const candidate of candidates) {
    const sellerUid = ownEntry.role === "seller" ? uid : candidate.uid;
    const buyerUid = ownEntry.role === "buyer" ? uid : candidate.uid;
    const ownQueueRef = marketQueueRef(uid);
    const ownActiveRef = marketActiveRef(uid);
    const candidateQueueRef = marketQueueRef(candidate.uid);
    const candidateActiveRef = marketActiveRef(candidate.uid);
    const sellerShopRef = marketShopRef(sellerUid);
    const sellerSalesModeRef = marketShopSalesModeRef(sellerUid);
    const sellerStatsRef = marketStatsRef(sellerUid);
    const relationshipRef = marketShopRelationshipRef(sellerUid, buyerUid);
    const sellerBlockRef = marketShopBlockRef(sellerUid, buyerUid);
    const buyerBlockRef = marketShopBlockRef(buyerUid, sellerUid);
    const favoriteRef = marketShopFavoriteRef(buyerUid, sellerUid);
    const roomRef = marketRoomRef(firestore.collection("valueMarketRooms").doc().id);
    let attempt = { status: "retry", roomId: "" };

    await firestore.runTransaction(async (transaction) => {
      const [
        ownQueueSnapshot,
        ownActiveSnapshot,
        candidateQueueSnapshot,
        candidateActiveSnapshot,
        sellerShopSnapshot,
        sellerSalesModeSnapshot,
        sellerStatsSnapshot,
        shopRelationshipSnapshot,
        sellerBlockSnapshot,
        buyerBlockSnapshot,
        favoriteSnapshot,
      ] = await Promise.all([
        transaction.get(ownQueueRef),
        transaction.get(ownActiveRef),
        transaction.get(candidateQueueRef),
        transaction.get(candidateActiveRef),
        transaction.get(sellerShopRef),
        transaction.get(sellerSalesModeRef),
        transaction.get(sellerStatsRef),
        transaction.get(relationshipRef),
        transaction.get(sellerBlockRef),
        transaction.get(buyerBlockRef),
        transaction.get(favoriteRef),
      ]);
      const currentOwn = ownQueueSnapshot.data();
      const currentCandidate = candidateQueueSnapshot.data();
      const rejectCandidate = (candidateEntry = currentCandidate || candidate) => {
        transaction.set(ownQueueRef, {
          skippedCandidateSessions: nextSkippedMarketQueueSessions(currentOwn, candidateEntry),
          skippedCandidatesResetAt: Number(currentOwn?.skippedCandidatesResetAt || 0) > Date.now()
            ? Number(currentOwn.skippedCandidatesResetAt)
            : Date.now() + QUEUE_FRESH_MS,
        }, { merge: true });
        attempt = { status: "retry", roomId: "" };
      };
      if (ownActiveSnapshot.exists) {
        attempt = {
          status: "matched",
          roomId: cleanText(ownActiveSnapshot.get("roomId"), 80),
          presenceId: marketPublicPresenceId(currentOwn?.publicPresenceId),
        };
        if (ownQueueSnapshot.exists) transaction.delete(ownQueueRef);
        return;
      }
      if (!ownQueueSnapshot.exists) {
        attempt = { status: "missing", roomId: "" };
        return;
      }
      if (!sameMarketQueueSession(currentOwn, ownEntry.queueToken)) {
        attempt = { status: "superseded", roomId: "" };
        return;
      }
      if (Number(currentOwn.lastSeen || 0) < Date.now() - QUEUE_FRESH_MS) {
        transaction.delete(ownQueueRef);
        attempt = {
          status: "missing",
          roomId: "",
          presenceId: marketPublicPresenceId(currentOwn.publicPresenceId),
        };
        return;
      }
      if (
        candidateActiveSnapshot.exists
        || sellerBlockSnapshot.exists
        || buyerBlockSnapshot.exists
        || !currentCandidate
        || currentCandidate.status !== "waiting"
        || Number(currentCandidate.lastSeen || 0) < Date.now() - QUEUE_FRESH_MS
        || (MARKET_APP_CHECK_MIGRATION && currentCandidate.appCheckVerified !== true)
        || !queuesCompatible(currentOwn, currentCandidate)
        || !marketRecommendedPreferenceCompatible(currentOwn, currentCandidate)
      ) {
        rejectCandidate();
        return;
      }
      const seller = currentOwn.role === "seller" ? currentOwn : currentCandidate;
      const buyer = currentOwn.role === "buyer" ? currentOwn : currentCandidate;
      const restoredSellerShop = restoreMarketShopSalesModeRecord(
        sellerShopSnapshot.data(),
        sellerSalesModeSnapshot.data(),
      );
      const liveSellerShop = publicSellerShop(restoredSellerShop, {
        marketStats: sellerStatsSnapshot.data(),
      });
      const targetedBuyer = buyer.matchMode === "favorites";
      const validFavorite = favoriteSnapshot.exists
        && favoriteSnapshot.get("buyerUid") === buyer.uid
        && favoriteSnapshot.get("sellerUid") === seller.uid
        && favoriteSnapshot.get("publicSellerId") === liveSellerShop?.publicSellerId;
      if (
        !liveSellerShop
        || !queuesCompatible({ ...seller, sellerShop: liveSellerShop }, buyer)
        || (targetedBuyer && (!validFavorite || liveSellerShop.repeatWelcome !== true))
      ) {
        if (
          targetedBuyer
          && buyer.uid === uid
          && (!validFavorite || liveSellerShop?.repeatWelcome !== true)
        ) {
          transaction.delete(ownQueueRef);
          attempt = {
            status: "invalid-target",
            roomId: "",
            presenceId: marketPublicPresenceId(currentOwn.publicPresenceId),
          };
        } else if (targetedBuyer && !validFavorite && buyer.uid === candidate.uid) {
          transaction.delete(candidateQueueRef);
          rejectCandidate();
          attempt.presenceId = marketPublicPresenceId(currentCandidate.publicPresenceId);
        } else {
          rejectCandidate();
        }
        return;
      }
      const shopRelationship = shopRelationshipSnapshot.data() || {};
      const previousPurchases = integer(shopRelationship.saleCount, 0, 1_000_000, 0);
      const sellerShop = {
        ...liveSellerShop,
        relationship: {
          previousPurchases,
          metBefore: shopRelationshipSnapshot.exists,
          lastPurchasePrice: integer(shopRelationship.lastSalePrice, 0, MARKET_MAX_PRICE, 0),
        },
      };
      const roomId = roomRef.id;
      const now = Date.now();
      transaction.set(sellerShopRef, restoredSellerShop);
      transaction.set(
        sellerSalesModeRef,
        marketShopSalesModeRecord(restoredSellerShop, now),
      );
      const room = {
        roomId,
        participants: { [seller.uid]: true, [buyer.uid]: true },
        sellerUid: seller.uid,
        buyerUid: buyer.uid,
        sellerName: seller.name,
        buyerName: buyer.name,
        sellerShop,
        sellerPatron: publicPatronage(seller.patron, periodKey("monthly")),
        buyerPatron: publicPatronage(buyer.patron, periodKey("monthly")),
        listing: seller.listing,
        settlementQuote: marketSaleSettlement(seller.listing.askingPrice),
        status: "preview",
        turn: 1,
        stateVersion: 1,
        maxTurns: MARKET_MAX_TURNS,
        entryFee: MARKET_ENTRY_FEE,
        entryFeePaid: false,
        extensionFeesPaid: 0,
        appCheckVerified: seller.appCheckVerified === true && buyer.appCheckVerified === true,
        publicPresenceId: createMarketPublicPresenceId(),
        createdAt: now,
        updatedAt: now,
      };
      transaction.create(roomRef, room);
      transaction.set(ownActiveRef, {
        roomId,
        role: currentOwn.role,
        appCheckVerified: room.appCheckVerified,
        updatedAt: now,
      });
      transaction.set(candidateActiveRef, {
        roomId,
        role: currentCandidate.role,
        appCheckVerified: room.appCheckVerified,
        updatedAt: now,
      });
      transaction.delete(ownQueueRef);
      transaction.delete(candidateQueueRef);
      attempt = {
        status: "matched",
        roomId,
        room,
        queuePresenceIds: [seller.publicPresenceId, buyer.publicPresenceId],
      };
    });

    if (attempt.room) {
      await bestEffort("matchMarketQueue", [
        mirrorMarketRoom(attempt.room),
        ...attempt.queuePresenceIds.map(removeMarketQueuePublicPresence),
      ]);
      return attempt;
    }
    if (attempt.presenceId) {
      await bestEffort("matchMarketQueuePresence", [
        removeMarketQueuePublicPresence(attempt.presenceId),
      ]);
    }
    if (["matched", "missing", "superseded", "invalid-target"].includes(attempt.status)) {
      return attempt;
    }
  }
  return { status: "waiting", roomId: "" };
}

async function joinMarketQueue(uid, data, appCheckVerified) {
  const requestStartedAt = Date.now();
  if (MARKET_APP_CHECK_MIGRATION && appCheckVerified !== true) {
    throw new HttpsError("failed-precondition", "通信保護を確認できませんでした。ページを再読み込みしてください。");
  }
  const requestedRole = data?.role === "seller" ? "seller" : data?.role === "buyer" ? "buyer" : "";
  const [balance, patronage, shopContext, controlSnapshot] = await Promise.all([
    ensureWallet(uid),
    readPatronage(uid),
    marketQueueShopContext(uid, requestedRole, data?.name, data),
    marketQueueControlRef(uid).get(),
  ]);
  const expectedGeneration = integer(
    controlSnapshot.get("generation"),
    0,
    Number.MAX_SAFE_INTEGER,
    0,
  );
  const ownEntry = normalizeQueueEntry(
    uid,
    data,
    balance,
    appCheckVerified,
    patronage,
    shopContext,
    {
      requestedAt: requestStartedAt,
      token: crypto.randomBytes(16).toString("hex"),
    },
  );
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

  const claim = await claimMarketQueue(uid, ownEntry, expectedGeneration);
  if (claim.presenceId) {
    await bestEffort("claimMarketQueuePresence", [
      removeMarketQueuePublicPresence(claim.presenceId),
    ]);
  }
  if (claim.status === "matched") {
    return { status: "matched", balance, roomId: claim.roomId };
  }
  if (claim.status === "canceled") {
    return { status: "canceled", balance, roomId: "" };
  }
  if (claim.status === "superseded") {
    await bestEffort("joinMarketQueue", [syncMarketQueuePublicPresence(uid)]);
    return { status: "waiting", balance, roomId: "" };
  }

  const outcome = await tryMatchMarketQueueSession(uid, claim.entry);
  if (outcome.status === "waiting") {
    await bestEffort("joinMarketQueue", [syncMarketQueuePublicPresence(uid)]);
  }
  return {
    status: outcome.status === "invalid-target" ? "missing" : outcome.status,
    balance,
    roomId: outcome.roomId,
  };
}

async function cancelMarketQueue(uid) {
  const queueRef = marketQueueRef(uid);
  const activeRef = marketActiveRef(uid);
  const controlRef = marketQueueControlRef(uid);
  let outcome = { status: "canceled", roomId: "", presenceId: "" };
  await firestore.runTransaction(async (transaction) => {
    const [activeSnapshot, queueSnapshot, controlSnapshot] = await Promise.all([
      transaction.get(activeRef),
      transaction.get(queueRef),
      transaction.get(controlRef),
    ]);
    const generation = integer(controlSnapshot.get("generation"), 0, Number.MAX_SAFE_INTEGER, 0);
    outcome = {
      status: activeSnapshot.exists ? "matched" : "canceled",
      roomId: activeSnapshot.exists ? cleanText(activeSnapshot.get("roomId"), 80) : "",
      presenceId: marketPublicPresenceId(queueSnapshot.get("publicPresenceId")),
    };
    transaction.set(controlRef, {
      generation: Math.min(Number.MAX_SAFE_INTEGER, generation + 1),
      updatedAt: Date.now(),
    }, { merge: true });
    if (queueSnapshot.exists) transaction.delete(queueRef);
  });
  await bestEffort("cancelMarketQueue", [
    removeMarketQueuePublicPresence(outcome.presenceId),
  ]);
  return { status: outcome.status, roomId: outcome.roomId };
}

async function heartbeatMarketQueue(uid) {
  const queueRef = marketQueueRef(uid);
  const activeRef = marketActiveRef(uid);
  let outcome = {
    status: "missing",
    roomId: "",
    entry: null,
    presenceId: "",
    shouldMatch: false,
  };
  await firestore.runTransaction(async (transaction) => {
    const [queueSnapshot, activeSnapshot] = await Promise.all([
      transaction.get(queueRef),
      transaction.get(activeRef),
    ]);
    const current = queueSnapshot.data();
    if (activeSnapshot.exists) {
      outcome = {
        status: "matched",
        roomId: cleanText(activeSnapshot.get("roomId"), 80),
        entry: null,
        presenceId: marketPublicPresenceId(current?.publicPresenceId),
      };
      if (queueSnapshot.exists) transaction.delete(queueRef);
      return;
    }
    if (!queueSnapshot.exists || current?.status !== "waiting") return;
    const publicPresenceId = marketPublicPresenceId(current.publicPresenceId)
      || createMarketPublicPresenceId();
    const now = Date.now();
    const shouldMatch = Number(current.lastMatchAttemptAt || 0) <= now - 10_000;
    const shouldResetSkippedCandidates = Number(current.skippedCandidatesResetAt || 0) > 0
      && Number(current.skippedCandidatesResetAt) <= now;
    const entry = {
      ...current,
      lastSeen: now,
      lastMatchAttemptAt: shouldMatch ? now : Number(current.lastMatchAttemptAt || now),
      skippedCandidateSessions: shouldResetSkippedCandidates
        ? []
        : (Array.isArray(current.skippedCandidateSessions)
          ? current.skippedCandidateSessions
          : []),
      skippedCandidatesResetAt: shouldResetSkippedCandidates
        ? 0
        : Number(current.skippedCandidatesResetAt || 0),
      publicPresenceId,
    };
    transaction.set(queueRef, entry);
    outcome = {
      status: "waiting",
      roomId: "",
      entry,
      presenceId: "",
      shouldMatch,
    };
  });
  if (outcome.presenceId) {
    await bestEffort("heartbeatMarketQueuePresence", [
      removeMarketQueuePublicPresence(outcome.presenceId),
    ]);
  }
  if (outcome.status !== "waiting") {
    return { status: outcome.status, roomId: outcome.roomId };
  }
  if (!outcome.shouldMatch) {
    await bestEffort("heartbeatMarketQueue", [syncMarketQueuePublicPresence(uid)]);
    return { status: "waiting", roomId: "" };
  }
  const match = await tryMatchMarketQueueSession(uid, outcome.entry);
  if (match.status === "waiting") {
    await bestEffort("heartbeatMarketQueue", [syncMarketQueuePublicPresence(uid)]);
  }
  return {
    status: match.status === "invalid-target" ? "missing" : match.status,
    roomId: match.roomId,
  };
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

async function listPatronRecommendations(uid, seasonKey = periodKey("monthly")) {
  const profileSnapshot = await patronRecommendationProfileRef(uid, seasonKey).get();
  const profile = normalizePatronRecommendationProfile(profileSnapshot.data(), uid, seasonKey);
  const recommendations = await Promise.all(profile.recommendations.map(async (entry) => {
    const publicSnapshot = await marketShopPublicRef(entry.publicSellerId).get();
    if (!publicSnapshot.exists) {
      return {
        publicSellerId: entry.publicSellerId,
        shop: null,
        recommendedAt: entry.recommendedAt,
        unavailable: true,
      };
    }
    const shop = publicSellerShop(publicSnapshot.get("sellerShop"));
    if (!shop || shop.publicSellerId !== entry.publicSellerId) {
      return {
        publicSellerId: entry.publicSellerId,
        shop: null,
        recommendedAt: entry.recommendedAt,
        unavailable: true,
      };
    }
    return {
      publicSellerId: entry.publicSellerId,
      shop,
      recommendedAt: entry.recommendedAt,
      unavailable: false,
    };
  }));
  return recommendations;
}

async function listRecommendedShopShelf(seasonKey = periodKey("monthly")) {
  const aggregateSnapshot = await patronRecommendationSeasonRef(seasonKey)
    .collection("shops")
    .where("recommendationCount", ">=", PATRON_RECOMMENDED_SHELF_MINIMUM)
    .get();
  const rotationKey = jstDateKey();
  const candidates = aggregateSnapshot.docs
    .map((snapshot) => ({
      publicSellerId: cleanText(snapshot.get("publicSellerId"), 40),
      recommendationCount: integer(
        snapshot.get("recommendationCount"),
        PATRON_RECOMMENDED_SHELF_MINIMUM,
        1_000_000,
        PATRON_RECOMMENDED_SHELF_MINIMUM,
      ),
    }))
    .filter((entry) => isValidPublicSellerId(entry.publicSellerId))
    .sort((left, right) => (
      eventId(`${rotationKey}:${left.publicSellerId}`)
        .localeCompare(eventId(`${rotationKey}:${right.publicSellerId}`))
    ))
    .slice(0, PATRON_RECOMMENDED_SHELF_LIMIT);
  const shops = await Promise.all(candidates.map(async (candidate) => {
    const publicSnapshot = await marketShopPublicRef(candidate.publicSellerId).get();
    if (!publicSnapshot.exists) return null;
    const shop = publicSellerShop(publicSnapshot.get("sellerShop"));
    if (!shop || shop.publicSellerId !== candidate.publicSellerId) return null;
    return shop;
  }));
  return shops.filter(Boolean);
}

async function updatePatronRecommendation(uid, data, remove = false, appCheckVerified = false) {
  if (!appCheckVerified) {
    throw new HttpsError(
      "failed-precondition",
      "商店推薦には通信保護が必要です。ページを再読み込みしてください。",
    );
  }
  const publicSellerId = cleanText(data?.publicSellerId, 40);
  if (!isValidPublicSellerId(publicSellerId)) {
    throw new HttpsError("invalid-argument", "店コードが正しくありません。");
  }
  const publicRef = marketShopPublicRef(publicSellerId);
  const initialPublicSnapshot = await publicRef.get();
  if (!remove && !initialPublicSnapshot.exists) {
    throw new HttpsError("not-found", "推し値商店が見つかりません。");
  }
  const sellerUid = cleanText(initialPublicSnapshot.get("sellerUid"), 128);
  if (!remove && (!sellerUid || sellerUid === uid)) {
    throw new HttpsError("failed-precondition", "自分の商店は推薦できません。");
  }

  const seasonKey = periodKey("monthly");
  const patronRef = patronageRef(uid);
  const profileRef = patronRecommendationProfileRef(uid, seasonKey);
  const favoriteRef = remove ? null : marketShopFavoriteRef(uid, sellerUid);
  const relationshipRef = remove ? null : marketShopRelationshipRef(sellerUid, uid);
  const blockRef = remove ? null : marketShopBlockRef(uid, sellerUid);
  const aggregateRef = patronRecommendedShopRef(seasonKey, publicSellerId);
  let patron = null;
  let outcome = remove ? "unchanged" : "recommended";

  await firestore.runTransaction(async (transaction) => {
    const [patronSnapshot, profileSnapshot, aggregateSnapshot, addSnapshots] = await Promise.all([
      transaction.get(patronRef),
      transaction.get(profileRef),
      transaction.get(aggregateRef),
      remove
        ? Promise.resolve(null)
        : Promise.all([
          transaction.get(publicRef),
          transaction.get(favoriteRef),
          transaction.get(relationshipRef),
          transaction.get(blockRef),
        ]),
    ]);
    patron = normalizePatronage(patronSnapshot.data(), seasonKey);
    const profile = normalizePatronRecommendationProfile(
      profileSnapshot.data(),
      uid,
      seasonKey,
    );
    const recommendationIndex = profile.recommendations.findIndex(
      (entry) => entry.publicSellerId === publicSellerId,
    );
    const currentlyRecommended = recommendationIndex >= 0;

    if (remove) {
      if (!currentlyRecommended) {
        outcome = "unchanged";
        return;
      }
    } else {
      const [publicSnapshot, favoriteSnapshot, relationshipSnapshot, blockSnapshot] = addSnapshots;
      if (
        !publicSnapshot.exists
        || cleanText(publicSnapshot.get("sellerUid"), 128) !== sellerUid
        || publicSellerShop(publicSnapshot.get("sellerShop"))?.publicSellerId !== publicSellerId
      ) {
        throw new HttpsError("failed-precondition", "店コードの所有関係を確認できませんでした。");
      }
      if (patron.tier < 1) {
        throw new HttpsError("failed-precondition", "今月の市場パトロンだけが商店を推薦できます。");
      }
      if (blockSnapshot.exists) {
        throw new HttpsError("failed-precondition", "ブロック中の商店は推薦できません。");
      }
      const favoriteMatches = favoriteSnapshot.exists
        && cleanText(favoriteSnapshot.get("publicSellerId"), 40) === publicSellerId;
      const relationshipSaleCount = relationshipSnapshot.get("sellerUid") === sellerUid
        && relationshipSnapshot.get("buyerUid") === uid
        ? integer(relationshipSnapshot.get("saleCount"), 0, 1_000_000, 0)
        : 0;
      if (!favoriteMatches && relationshipSaleCount < 1) {
        throw new HttpsError(
          "failed-precondition",
          "取引した商店または常連帳の商店だけを推薦できます。",
        );
      }
      if (currentlyRecommended) {
        outcome = "unchanged";
        return;
      }
      if (profile.recommendations.length >= patronRecommendationLimit(patron.tier)) {
        throw new HttpsError(
          "resource-exhausted",
          `今月の推薦枠は${patronRecommendationLimit(patron.tier)}店です。`,
        );
      }
    }

    const now = Date.now();
    const aggregateCount = integer(
      aggregateSnapshot.get("recommendationCount"),
      0,
      1_000_000,
      0,
    );
    if (remove) {
      profile.recommendations.splice(recommendationIndex, 1);
      outcome = "removed";
    } else {
      profile.recommendations.unshift({ publicSellerId, recommendedAt: now });
      outcome = "recommended";
    }
    profile.updatedAt = now;
    transaction.set(profileRef, {
      schemaVersion: 1,
      ...profile,
      createdAt: Number(profileSnapshot.get("createdAt") || now),
    });
    transaction.set(aggregateRef, {
      schemaVersion: 1,
      seasonKey,
      publicSellerId,
      recommendationCount: remove
        ? Math.max(0, aggregateCount - 1)
        : aggregateCount + 1,
      createdAt: Number(aggregateSnapshot.get("createdAt") || now),
      updatedAt: now,
    });
  });

  const [patronProgram, recommendations, recommendedShelf] = await Promise.all([
    ensurePatronFundRecognition(uid, patron),
    listPatronRecommendations(uid, seasonKey),
    listRecommendedShopShelf(seasonKey),
  ]);
  return {
    outcome,
    publicSellerId,
    recommendations,
    recommendedShelf,
    ...patronProgram,
  };
}

async function getMarketShop(uid) {
  const statsSnapshot = await marketStatsRef(uid).get();
  const fallbackName = statsSnapshot.exists ? cleanName(statsSnapshot.get("name")) : DEFAULT_MARKET_SHOP.shopName;
  const shop = await ensureMarketShop(uid, fallbackName);
  const seasonKey = periodKey("monthly");
  const patron = await readPatronage(uid, seasonKey);
  const [
    favoritesSnapshot,
    customizationIds,
    patronProgram,
    recommendations,
    recommendedShelf,
  ] = await Promise.all([
    marketShopFavoritesRef(uid).orderBy("updatedAt", "desc").limit(100).get(),
    ownedMarketCustomizationIds(uid),
    ensurePatronFundRecognition(uid, patron),
    listPatronRecommendations(uid, seasonKey),
    listRecommendedShopShelf(seasonKey),
  ]);
  const favorites = (await Promise.all(favoritesSnapshot.docs.map(async (favoriteSnapshot) => {
    const sellerUid = favoriteSnapshot.id;
    const publicSellerId = cleanText(favoriteSnapshot.get("publicSellerId"), 96);
    if (!isValidPublicSellerId(publicSellerId)) return null;
    const publicSnapshot = await marketShopPublicRef(publicSellerId).get();
    if (
      !publicSnapshot.exists
      || cleanText(publicSnapshot.get("sellerUid"), 128) !== sellerUid
    ) {
      return null;
    }
    const sellerShop = publicSellerShop(publicSnapshot.get("sellerShop"));
    if (!sellerShop || sellerShop.publicSellerId !== publicSellerId) return null;
    const storedSaleCount = favoriteSnapshot.get("saleCount");
    const relationshipSnapshot = typeof storedSaleCount === "number"
      ? null
      : await marketShopRelationshipRef(sellerUid, uid).get();
    const relationship = relationshipSnapshot?.data() || {};
    const saleCount = integer(
      storedSaleCount ?? relationship.saleCount,
      0,
      1_000_000,
      0,
    );
    const lastPurchasePrice = integer(
      favoriteSnapshot.get("lastPurchasePrice") ?? relationship.lastSalePrice,
      0,
      MARKET_MAX_PRICE,
      0,
    );
    return {
      ...sellerShop,
      favoritedAt: Number(favoriteSnapshot.get("createdAt") || favoriteSnapshot.get("updatedAt") || 0),
      lastPurchasePrice,
      relationship: {
        isFavorite: true,
        metBefore: saleCount > 0,
        previousPurchases: saleCount,
        lastPurchasePrice,
      },
    };
  }))).filter(Boolean);
  return {
    shop: publicSellerShop(shop, { marketStats: statsSnapshot.data() }),
    favorites,
    catalog: MARKET_SHOP_CATALOG,
    report: marketShopVerifiedReport(shop, statsSnapshot.data()),
    ownedTitleIds: customizationIds.ownedTitleIds,
    ownedShopCharmIds: customizationIds.ownedShopCharmIds,
    recommendations,
    recommendedShelf,
    ...patronProgram,
  };
}

function marketShopValidationMessage(errors) {
  if (errors.includes("shopName")) return "店名はURLを含まない16文字以内の1行で入力してください。";
  if (errors.includes("tagline")) return "店主理念はURLを含まない40文字以内の1行で入力してください。";
  if (errors.includes("specialtyTags")) return "得意分野は一覧から重複なしで3個まで選んでください。";
  if (errors.includes("salesMode")) return "販売モードは通常営業または推し嬢モードから選んでください。";
  if (errors.includes("serviceStyles")) return "接客スタイルは一覧から重複なしで2個まで選んでください。推し嬢モードは別枠です。";
  if (errors.includes("themeId") || errors.includes("sealId")) return "看板テーマまたは商印が正しくありません。";
  if (errors.includes("titleId")) return "所有していない称号は店主称号に設定できません。";
  if (errors.includes("shopCharmId")) return "無料または所有しているスタンプだけを商店チャームに設定できます。";
  return "推し値商店の設定が正しくありません。";
}

async function saveMarketShop(uid, data) {
  const customizationIds = await ownedMarketCustomizationIds(uid);
  const validation = validateMarketShopInput(data, customizationIds);
  if (!validation.valid) {
    throw new HttpsError(
      "invalid-argument",
      marketShopValidationMessage(validation.errors),
      { fields: validation.errors },
    );
  }
  const ensuredShop = await ensureMarketShop(uid, validation.shop.shopName);
  const shopRef = marketShopRef(uid);
  const salesModeRef = marketShopSalesModeRef(uid);
  const publicRef = marketShopPublicRef(ensuredShop.publicSellerId);
  let savedShop = null;
  let statsValue = {};
  await firestore.runTransaction(async (transaction) => {
    const [
      shopSnapshot,
      salesModeSnapshot,
      publicSnapshot,
      statsSnapshot,
      queueSnapshot,
    ] = await Promise.all([
      transaction.get(shopRef),
      transaction.get(salesModeRef),
      transaction.get(publicRef),
      transaction.get(marketStatsRef(uid)),
      transaction.get(marketQueueRef(uid)),
    ]);
    const current = normalizeStoredMarketShop(
      restoreMarketShopSalesModeRecord(shopSnapshot.data(), salesModeSnapshot.data()),
      {
        fallbackName: validation.shop.shopName,
        publicSellerId: ensuredShop.publicSellerId,
      },
    );
    if (publicSnapshot.exists && cleanText(publicSnapshot.get("sellerUid"), 128) !== uid) {
      throw new HttpsError("failed-precondition", "店コードの所有関係を確認できませんでした。");
    }
    const now = Date.now();
    const compatibleShop = preserveLegacyMarketServiceStyles(
      current,
      validation.shop,
      validation.legacySalesModeContract,
    );
    savedShop = {
      ...current,
      ...compatibleShop,
      publicSellerId: ensuredShop.publicSellerId,
      createdAt: current.createdAt || now,
      updatedAt: now,
    };
    statsValue = statsSnapshot.data() || {};
    transaction.set(shopRef, savedShop);
    transaction.set(salesModeRef, marketShopSalesModeRecord(savedShop, now));
    transaction.set(publicRef, marketShopPublicRecord(uid, savedShop, statsValue, now));
    if (queueSnapshot.exists && queueSnapshot.get("role") === "seller"
      && queueSnapshot.get("status") === "waiting") {
      transaction.set(marketQueueRef(uid), {
        sellerShop: publicSellerShop(savedShop, { marketStats: statsValue }),
        lastSeen: now,
        skippedCandidateSessions: [],
        skippedCandidatesResetAt: 0,
      }, { merge: true });
    }
  });
  return {
    saved: true,
    shop: publicSellerShop(savedShop, { marketStats: statsValue }),
    report: marketShopVerifiedReport(savedShop, statsValue),
    ownedTitleIds: customizationIds.ownedTitleIds,
    ownedShopCharmIds: customizationIds.ownedShopCharmIds,
  };
}

function marketShopImpressionTag(value) {
  const tag = cleanText(value, 40);
  return MARKET_SHOP_CATALOG.impressionTags.some((entry) => entry.id === tag) ? tag : "";
}

async function updateMarketShopRelationship(uid, data) {
  const roomId = cleanText(data?.roomId, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(roomId)) {
    throw new HttpsError("invalid-argument", "市場ルームを確認できません。");
  }
  const impressionRequested = typeof data?.impressionTag === "string" && data.impressionTag.length > 0;
  const impressionTag = marketShopImpressionTag(data?.impressionTag);
  if (impressionRequested && !impressionTag) {
    throw new HttpsError("invalid-argument", "肯定タグが正しくありません。");
  }
  const favoriteRequested = typeof data?.favorite === "boolean";
  const blockValue = typeof data?.block === "boolean"
    ? data.block
    : typeof data?.blocked === "boolean"
      ? data.blocked
      : null;
  const blockRequested = typeof blockValue === "boolean";
  if (!impressionRequested && !favoriteRequested && !blockRequested) {
    throw new HttpsError("invalid-argument", "更新する関係設定を指定してください。");
  }
  if (blockValue === true && data?.favorite === true) {
    throw new HttpsError("invalid-argument", "ブロックとお気に入り追加は同時に行えません。");
  }

  const initialRoomSnapshot = await marketRoomRef(roomId).get();
  if (!initialRoomSnapshot.exists) throw new HttpsError("not-found", "市場ルームが見つかりません。");
  const initialRoom = initialRoomSnapshot.data();
  const actorRole = requireRoomActor(initialRoom, uid);
  const sellerUid = initialRoom.sellerUid;
  const buyerUid = initialRoom.buyerUid;
  if ((impressionRequested || favoriteRequested) && actorRole !== "buyer") {
    throw new HttpsError("permission-denied", "肯定タグと常連帳は買い手だけが更新できます。");
  }
  const targetUid = actorRole === "seller" ? buyerUid : sellerUid;
  const ensuredShop = await ensureMarketShop(sellerUid, initialRoom.sellerName);
  const shopRef = marketShopRef(sellerUid);
  const publicRef = marketShopPublicRef(ensuredShop.publicSellerId);
  const relationshipRef = marketShopRelationshipRef(sellerUid, buyerUid);
  const impressionRef = marketShopImpressionRef(roomId, buyerUid);
  const favoriteRef = marketShopFavoriteRef(buyerUid, sellerUid);
  const blockRef = marketShopBlockRef(uid, targetUid);
  const actorQueueRef = marketQueueRef(uid);
  let outcome = null;
  let removedQueuePresenceId = "";

  await firestore.runTransaction(async (transaction) => {
    const [
      roomSnapshot,
      shopSnapshot,
      publicSnapshot,
      statsSnapshot,
      relationshipSnapshot,
      impressionSnapshot,
      favoriteSnapshot,
      blockSnapshot,
      actorQueueSnapshot,
    ] = await Promise.all([
      transaction.get(marketRoomRef(roomId)),
      transaction.get(shopRef),
      transaction.get(publicRef),
      transaction.get(marketStatsRef(sellerUid)),
      transaction.get(relationshipRef),
      transaction.get(impressionRef),
      transaction.get(favoriteRef),
      transaction.get(blockRef),
      transaction.get(actorQueueRef),
    ]);
    if (!roomSnapshot.exists) throw new HttpsError("not-found", "市場ルームが見つかりません。");
    const room = roomSnapshot.data();
    const currentRole = requireRoomActor(room, uid);
    if (room.sellerUid !== sellerUid || room.buyerUid !== buyerUid || currentRole !== actorRole) {
      throw new HttpsError("failed-precondition", "市場ルームの参加者が変わりました。");
    }
    if (data?.favorite === true && blockSnapshot.exists && blockValue !== false) {
      throw new HttpsError(
        "failed-precondition",
        "ブロック中の相手は常連帳へ追加できません。先にブロックを解除してください。",
      );
    }
    const pitchCompleted = Number(room.pitchCompletedAt || 0) > 0;
    const restoringFavoriteFromBlock = blockValue === false
      && data?.favorite === true
      && actorRole === "buyer"
      && blockSnapshot.exists
      && blockSnapshot.get("removedFavorite") === true;
    if (
      (impressionRequested || data?.favorite === true)
      && !pitchCompleted
      && !restoringFavoriteFromBlock
    ) {
      throw new HttpsError("failed-precondition", "営業完了後に店主への反応を残せます。");
    }
    if (publicSnapshot.exists && cleanText(publicSnapshot.get("sellerUid"), 128) !== sellerUid) {
      throw new HttpsError("failed-precondition", "店コードの所有関係を確認できませんでした。");
    }
    if (data?.favorite === true && !favoriteSnapshot.exists) {
      const favoriteBookSnapshot = await transaction.get(
        marketShopFavoritesRef(buyerUid).limit(100),
      );
      if (favoriteBookSnapshot.size >= 100) {
        throw new HttpsError(
          "resource-exhausted",
          "常連帳は100店までです。登録済みの商店を解除してから追加してください。",
        );
      }
    }

    const now = Date.now();
    const relationship = relationshipSnapshot.exists ? { ...relationshipSnapshot.data() } : {};
    let shop = normalizeStoredMarketShop(shopSnapshot.data(), {
      fallbackName: room.sellerName,
      publicSellerId: ensuredShop.publicSellerId,
    });
    let shopChanged = false;
    let responseImpressionTag = "";
    let impressionRecorded = false;
    let alreadyRecorded = false;

    if (impressionRequested) {
      const decision = marketImpressionDecision({
        existingRoomImpression: impressionSnapshot.exists,
        lastImpressionAt: relationship.lastImpressionAt,
        now,
      });
      if (decision.action === "cooldown") {
        if (!favoriteRequested && !blockRequested) {
          throw new HttpsError(
            "failed-precondition",
            "同じ店主への肯定タグは30日ごとに1回送れます。",
            { retryAfterMs: decision.retryAfterMs },
          );
        }
        alreadyRecorded = true;
        responseImpressionTag = marketShopImpressionTag(relationship.lastImpressionTag);
      }
      impressionRecorded = decision.impressionRecorded;
      alreadyRecorded = alreadyRecorded || decision.alreadyRecorded;
      if (decision.action === "noop") {
        responseImpressionTag = marketShopImpressionTag(impressionSnapshot.get("impressionTag"));
      }
      if (decision.action === "write") {
        shop.impressionCounts[impressionTag] = Number(shop.impressionCounts[impressionTag] || 0) + 1;
        if (decision.addsDistinctBuyer) shop.impressionBuyerCount += 1;
        relationship.lastImpressionAt = now;
        relationship.lastImpressionTag = impressionTag;
        relationship.lastImpressionRoomId = roomId;
        transaction.create(impressionRef, {
          schemaVersion: 1,
          roomId,
          sellerUid,
          buyerUid,
          impressionTag,
          createdAt: now,
        });
        shopChanged = true;
        responseImpressionTag = impressionTag;
      }
    }

    let favorite = favoriteSnapshot.exists;
    const shouldRemoveFavoriteForBlock = blockValue === true && actorRole === "buyer";
    if (favoriteRequested || shouldRemoveFavoriteForBlock) {
      const nextFavorite = shouldRemoveFavoriteForBlock ? false : data.favorite === true;
      if (nextFavorite && !favoriteSnapshot.exists) {
        shop.favoriteCount += 1;
        favorite = true;
        shopChanged = true;
        transaction.set(favoriteRef, {
          schemaVersion: 1,
          publicSellerId: ensuredShop.publicSellerId,
          sellerUid,
          buyerUid,
          lastPurchasePrice: integer(room.salePrice, 0, MARKET_MAX_PRICE, 0),
          saleCount: integer(relationship.saleCount, 0, 1_000_000, 0),
          createdAt: now,
          updatedAt: now,
        });
      } else if (!nextFavorite && favoriteSnapshot.exists) {
        shop.favoriteCount = Math.max(0, shop.favoriteCount - 1);
        favorite = false;
        shopChanged = true;
        transaction.delete(favoriteRef);
      } else if (nextFavorite) {
        transaction.set(favoriteRef, {
          publicSellerId: ensuredShop.publicSellerId,
          lastPurchasePrice: integer(
            room.salePrice ?? favoriteSnapshot.get("lastPurchasePrice"),
            0,
            MARKET_MAX_PRICE,
            0,
          ),
          saleCount: integer(
            relationship.saleCount ?? favoriteSnapshot.get("saleCount"),
            0,
            1_000_000,
            0,
          ),
          updatedAt: now,
        }, { merge: true });
      }
    }

    let blocked = blockSnapshot.exists;
    if (blockRequested) {
      blocked = blockValue === true;
      if (blocked) {
        transaction.set(blockRef, {
          schemaVersion: 1,
          ownerUid: uid,
          blockedUid: targetUid,
          removedFavorite: actorRole === "buyer"
            && (favoriteSnapshot.exists || blockSnapshot.get("removedFavorite") === true),
          createdAt: blockSnapshot.get("createdAt") || now,
          updatedAt: now,
        });
      } else if (blockSnapshot.exists) {
        transaction.delete(blockRef);
      }
    }

    if (actorQueueSnapshot.exists && actorQueueSnapshot.get("status") === "waiting") {
      const queuedBlocks = Array.isArray(actorQueueSnapshot.get("blockedUids"))
        ? actorQueueSnapshot.get("blockedUids").map(String).filter(Boolean)
        : [];
      const shouldCancelTargetedQueue = actorRole === "buyer"
        && actorQueueSnapshot.get("role") === "buyer"
        && actorQueueSnapshot.get("matchMode") === "favorites"
        && actorQueueSnapshot.get("selectedFavoriteSellerUid") === sellerUid
        && (blockValue === true || (favoriteRequested && data.favorite !== true));
      if (shouldCancelTargetedQueue) {
        removedQueuePresenceId = marketPublicPresenceId(
          actorQueueSnapshot.get("publicPresenceId"),
        );
        transaction.delete(actorQueueRef);
      } else if (blockRequested) {
        const blockedUids = blockValue === true
          ? [...queuedBlocks.filter((blockedUid) => blockedUid !== targetUid), targetUid].slice(-100)
          : queuedBlocks.filter((blockedUid) => blockedUid !== targetUid);
        transaction.set(actorQueueRef, {
          blockedUids,
          skippedCandidateSessions: [],
          skippedCandidatesResetAt: 0,
        }, { merge: true });
      }
    }

    relationship.schemaVersion = 1;
    relationship.sellerUid = sellerUid;
    relationship.buyerUid = buyerUid;
    relationship.updatedAt = now;
    if (!relationship.createdAt) relationship.createdAt = now;
    transaction.set(relationshipRef, relationship);
    if (shopChanged) {
      shop.updatedAt = now;
      transaction.set(shopRef, shop);
      transaction.set(publicRef, marketShopPublicRecord(sellerUid, shop, statsSnapshot.data(), now));
    }
    const sellerShop = publicSellerShop(shop, { marketStats: statsSnapshot.data() });
    outcome = {
      saved: true,
      impressionTag: responseImpressionTag,
      impressionRecorded,
      alreadyRecorded,
      favorite: actorRole === "buyer" ? favorite : false,
      blocked,
      shop: sellerShop,
      sellerShop,
    };
  });
  if (removedQueuePresenceId) {
    await bestEffort("updateMarketShopRelationship", [
      removeMarketQueuePublicPresence(removedQueuePresenceId),
    ]);
  }
  return outcome;
}

async function removeMarketShopFavorite(uid, publicSellerIdValue) {
  const publicSellerId = typeof publicSellerIdValue === "string"
    ? publicSellerIdValue.trim()
    : "";
  if (!isValidPublicSellerId(publicSellerId)) {
    throw new HttpsError("invalid-argument", "店コードが正しくありません。");
  }
  const initialPublicSnapshot = await marketShopPublicRef(publicSellerId).get();
  if (!initialPublicSnapshot.exists) throw new HttpsError("not-found", "推し値商店が見つかりません。");
  const sellerUid = cleanText(initialPublicSnapshot.get("sellerUid"), 128);
  if (!sellerUid || sellerUid === uid) {
    throw new HttpsError("failed-precondition", "この店は常連帳から削除できません。");
  }
  const favoriteRef = marketShopFavoriteRef(uid, sellerUid);
  const shopRef = marketShopRef(sellerUid);
  const publicRef = marketShopPublicRef(publicSellerId);
  let removed = false;
  let removedQueuePresenceId = "";
  await firestore.runTransaction(async (transaction) => {
    const [
      favoriteSnapshot,
      shopSnapshot,
      publicSnapshot,
      statsSnapshot,
      queueSnapshot,
    ] = await Promise.all([
      transaction.get(favoriteRef),
      transaction.get(shopRef),
      transaction.get(publicRef),
      transaction.get(marketStatsRef(sellerUid)),
      transaction.get(marketQueueRef(uid)),
    ]);
    if (publicSnapshot.exists && cleanText(publicSnapshot.get("sellerUid"), 128) !== sellerUid) {
      throw new HttpsError("failed-precondition", "店コードの所有関係を確認できませんでした。");
    }
    if (!favoriteSnapshot.exists) return;
    const now = Date.now();
    const shop = normalizeStoredMarketShop(shopSnapshot.data(), { publicSellerId });
    shop.favoriteCount = Math.max(0, shop.favoriteCount - 1);
    shop.updatedAt = now;
    transaction.delete(favoriteRef);
    transaction.set(shopRef, shop);
    transaction.set(publicRef, marketShopPublicRecord(sellerUid, shop, statsSnapshot.data(), now));
    if (
      queueSnapshot.exists
      && queueSnapshot.get("role") === "buyer"
      && queueSnapshot.get("matchMode") === "favorites"
      && queueSnapshot.get("selectedFavoriteSellerUid") === sellerUid
    ) {
      removedQueuePresenceId = marketPublicPresenceId(queueSnapshot.get("publicPresenceId"));
      transaction.delete(marketQueueRef(uid));
    }
    removed = true;
  });
  if (removedQueuePresenceId) {
    await bestEffort("removeMarketShopFavorite", [
      removeMarketQueuePublicPresence(removedQueuePresenceId),
    ]);
  }
  return { removed, publicSellerId };
}

exports.valueMarketShop = onCall(callableOptions("valueMarketShop"), async (request) => {
  const uid = requireUid(request);
  const action = cleanText(request.data?.action, 32, "get") || "get";
  try {
    if (
      MARKET_APP_CHECK_MIGRATION
      && [
        "save",
        "relationship",
        "remove_favorite",
        "recommend_shop",
        "remove_recommendation",
      ].includes(action)
      && !request.app
    ) {
      throw new HttpsError("failed-precondition", "通信保護を確認できませんでした。ページを再読み込みしてください。");
    }
    if (action === "get") return await getMarketShop(uid);
    if (action === "save") return await saveMarketShop(uid, request.data);
    if (action === "relationship") return await updateMarketShopRelationship(uid, request.data);
    if (action === "remove_favorite") {
      return await removeMarketShopFavorite(uid, request.data?.publicSellerId);
    }
    if (action === "recommend_shop") {
      return await updatePatronRecommendation(uid, request.data, false, Boolean(request.app));
    }
    if (action === "remove_recommendation") {
      return await updatePatronRecommendation(uid, request.data, true, Boolean(request.app));
    }
    throw new HttpsError("invalid-argument", "未対応の推し値商店操作です。");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("valueMarketShop failed", { uid, action, error });
    throw new HttpsError("internal", "推し値商店の処理を完了できませんでした。");
  }
});

function defaultStats(uid, name) {
  return {
    uid,
    name: cleanName(name),
    salesCount: 0,
    grossSales: 0,
    actualGrossSales: 0,
    marketFeesPaid: 0,
    netSales: 0,
    bestSale: 0,
    laborFees: 0,
    purchases: 0,
    spent: 0,
    actualSpent: 0,
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
  if (!snapshot.exists) throw new HttpsError("failed-precondition", "AnjuPay残高が初期化されていません。");
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
  if (from.balance < value) throw new HttpsError("failed-precondition", "AnjuPay残高が不足しています。");
  if (walletCreditCapacity(to) < value) throw new HttpsError("failed-precondition", "受取側のAnjuPay残高が上限に達しています。");
  from.balance -= value;
  to.balance += value;
  return value;
}

function debitPoints(wallet, amount) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POINTS) {
    throw new HttpsError("invalid-argument", "AnjuPay支払額が正しくありません。");
  }
  if (wallet.balance < value) throw new HttpsError("failed-precondition", "AnjuPay残高が不足しています。");
  wallet.balance -= value;
  return value;
}

function creditPoints(wallet, amount) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POINTS) {
    throw new HttpsError("invalid-argument", "AnjuPay受取額が正しくありません。");
  }
  if (walletCreditCapacity(wallet) < value) throw new HttpsError("failed-precondition", "受取側のAnjuPay残高が上限に達しています。");
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

function requireReservedExtensionHold(room, held) {
  if (held > 0 && room?.extensionReserved !== true) {
    throw new HttpsError(
      "failed-precondition",
      "延長内金の保留状態を確認できないため、取引を停止しました。",
    );
  }
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

const MARKET_OSHIJO_DELIVERY_ACTIONS = Object.freeze([
  "oshijo_closing_turn_reserve",
  "oshijo_closing_turn_ack",
  "oshijo_closing_turn_release",
]);

function isMarketOshijoDeliveryAction(action) {
  return MARKET_OSHIJO_DELIVERY_ACTIONS.includes(action);
}

function canonicalMarketOshijoDeliveryActionId(action, deliveryId) {
  const id = marketOshijoDeliveryId(deliveryId);
  if (!id || !isMarketOshijoDeliveryAction(action)) return "";
  return `${id}-${action.replace("oshijo_closing_turn_", "")}`;
}

function marketOshijoRoomMediaCounts(room) {
  const counts = { ...marketOshijoMediaCounts(room?.oshijoClosingMediaCounts) };
  const currentTurnCount = integer(
    room?.oshijoClosingTurnCount,
    0,
    MARKET_OSHIJO_MAX_CLOSING_TURNS,
    0,
  );
  const lastMediaKind = cleanText(room?.oshijoLastMediaKind, 8).toLowerCase();
  if (currentTurnCount > 0
      && ["text", "image", "audio"].includes(lastMediaKind)
      && counts[lastMediaKind] === 0) {
    counts[lastMediaKind] = 1;
  }
  return counts;
}

function throwMarketOshijoDeliveryError(errorCode) {
  if (errorCode === "turn-limit") {
    throw new HttpsError("failed-precondition", "推し嬢クロージングは3手までです。");
  }
  if (errorCode === "media-limit") {
    throw new HttpsError("failed-precondition", "画像と音声はそれぞれ1件までです。");
  }
  if (errorCode === "reservation-missing") {
    throw new HttpsError("failed-precondition", "送信枠の有効期限が切れました。もう一度選択してください。");
  }
  if (errorCode === "delivery-mismatch") {
    throw new HttpsError("permission-denied", "送信IDの営業手段が一致しません。");
  }
  throw new HttpsError("invalid-argument", "送信IDまたは営業手段が正しくありません。");
}

function isTerminalMarketState(status) {
  return ["sold", "ended", "canceled"].includes(status);
}

async function performMarketAction(uid, data, appCheckVerified) {
  const roomId = cleanText(data?.roomId, 80);
  const action = cleanText(data?.action, 32);
  const requestedActionId = cleanText(data?.actionId, 80);
  if (isMarketOshijoDeliveryAction(action)) {
    const expectedActionId = canonicalMarketOshijoDeliveryActionId(
      action,
      data?.deliveryId,
    );
    if (!expectedActionId || requestedActionId !== expectedActionId) {
      throw new HttpsError("invalid-argument", "P2P送信操作IDが一致しません。");
    }
  }
  const actionId = requestedActionId || `${action}:${integer(data?.turn, 1, MARKET_MAX_TURNS, 1)}`;
  const initialRoom = await loadMarketRoomWithPublicPresenceId(roomId);
  requireRoomActor(initialRoom, uid);
  if (MARKET_APP_CHECK_MIGRATION && initialRoom.appCheckVerified === true && appCheckVerified !== true) {
    throw new HttpsError("failed-precondition", "通信保護を確認できませんでした。ページを再読み込みしてください。");
  }
  const [, , , , ensuredSellerShop] = await Promise.all([
    ensureWallet(initialRoom.sellerUid),
    ensureWallet(initialRoom.buyerUid),
    ensureAchievementState(initialRoom.sellerUid),
    ensureAchievementState(initialRoom.buyerUid),
    ensureMarketShop(initialRoom.sellerUid, initialRoom.sellerName),
  ]);

  const roomRef = marketRoomRef(roomId);
  const sellerWalletRef = walletRef(initialRoom.sellerUid);
  const buyerWalletRef = walletRef(initialRoom.buyerUid);
  const sellerStatsRef = marketStatsRef(initialRoom.sellerUid);
  const buyerStatsRef = marketStatsRef(initialRoom.buyerUid);
  const transactionDateKey = jstDateKey();
  const patronSeasonKey = transactionDateKey.slice(0, 7);
  const sellerMonthlyStatsRef = marketMonthlyStatsRef(initialRoom.sellerUid, patronSeasonKey);
  const buyerMonthlyStatsRef = marketMonthlyStatsRef(initialRoom.buyerUid, patronSeasonKey);
  const monthlyPairRef = marketMonthlyPairRef(
    initialRoom.sellerUid,
    initialRoom.buyerUid,
    patronSeasonKey,
  );
  const monthlyOshijoPairRef = marketMonthlyOshijoPairRef(
    initialRoom.sellerUid,
    initialRoom.buyerUid,
    patronSeasonKey,
  );
  const sellerAchievementRef = achievementProfileRef(initialRoom.sellerUid);
  const buyerAchievementRef = achievementProfileRef(initialRoom.buyerUid);
  const pairKey = eventId(`${[initialRoom.sellerUid, initialRoom.buyerUid].sort().join(":")}:${transactionDateKey}`);
  const pairRef = firestore.collection("valueMarketRankedPairs").doc(pairKey);
  const relationshipKey = eventId([initialRoom.sellerUid, initialRoom.buyerUid].sort().join(":"));
  const relationshipRef = firestore.collection("valueMarketAchievementPairs").doc(relationshipKey);
  const shopRef = marketShopRef(initialRoom.sellerUid);
  const shopPublicRef = marketShopPublicRef(ensuredSellerShop.publicSellerId);
  const shopRelationshipRef = marketShopRelationshipRef(initialRoom.sellerUid, initialRoom.buyerUid);
  const shopFavoriteRef = marketShopFavoriteRef(initialRoom.buyerUid, initialRoom.sellerUid);
  const certificateRef = marketCertificateRef(initialRoom.buyerUid, roomId);
  const ledgerRef = firestore.collection("valueMarketLedger").doc(eventId(`${roomId}:${uid}:${actionId}`));
  const marketPatronFundRef = patronFundRef(patronSeasonKey);
  const marketPatronPairRef = patronFundPairRef(
    initialRoom.sellerUid,
    initialRoom.buyerUid,
    patronSeasonKey,
  );
  const marketPatronSellerImpactRef = patronFundSellerImpactRef(
    initialRoom.sellerUid,
    patronSeasonKey,
  );
  const marketPatronPolicyRef = patronPolicyRef(patronSeasonKey);
  const marketActionTimestamp = Date.now();
  let result = null;
  let buyerDecisionResult = null;
  let oshijoDeliveryResult = null;
  const achievementResults = {};
  const newlyUnlockedResults = {};
  let sellerShopResult = null;

  await firestore.runTransaction(async (transaction) => {
    result = null;
    buyerDecisionResult = null;
    oshijoDeliveryResult = null;
    sellerShopResult = null;
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
      shopSnapshot,
      shopPublicSnapshot,
      shopRelationshipSnapshot,
      shopFavoriteSnapshot,
      certificateSnapshot,
      ledgerSnapshot,
      ledgerConfigSnapshot,
      patronSubsidySnapshots,
      monthlyMarketSnapshots,
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
      transaction.get(shopRef),
      transaction.get(shopPublicRef),
      transaction.get(shopRelationshipRef),
      transaction.get(shopFavoriteRef),
      transaction.get(certificateRef),
      transaction.get(ledgerRef),
      transaction.get(anjuPayLedgerConfigRef()),
      action === "buy"
        ? Promise.all([
          transaction.get(marketPatronFundRef),
          transaction.get(marketPatronPairRef),
          transaction.get(marketPatronSellerImpactRef),
          transaction.get(marketPatronPolicyRef),
        ])
        : Promise.resolve([null, null, null, null]),
      action === "buy"
        ? Promise.all([
          transaction.get(sellerMonthlyStatsRef),
          transaction.get(buyerMonthlyStatsRef),
          transaction.get(monthlyPairRef),
          transaction.get(monthlyOshijoPairRef),
        ])
        : Promise.resolve([null, null, null, null]),
    ]);
    const [
      marketPatronFundSnapshot,
      marketPatronPairSnapshot,
      marketPatronSellerImpactSnapshot,
      marketPatronPolicySnapshot,
    ] = patronSubsidySnapshots;
    const [
      sellerMonthlyStatsSnapshot,
      buyerMonthlyStatsSnapshot,
      monthlyPairSnapshot,
      monthlyOshijoPairSnapshot,
    ] = monthlyMarketSnapshots;
    if (!roomSnapshot.exists) throw new HttpsError("not-found", "市場ルームが見つかりません。");
    const room = { ...roomSnapshot.data() };
    const role = requireRoomActor(room, uid);
    const sellerWallet = walletData(sellerWalletSnapshot);
    const buyerWallet = walletData(buyerWalletSnapshot);
    const sellerBalanceBefore = sellerWallet.balance;
    const buyerBalanceBefore = buyerWallet.balance;
    const sellerActivated = stageAnjuPayOpening(
      transaction,
      sellerWalletRef,
      sellerWallet,
      ledgerConfigSnapshot,
      marketActionTimestamp,
    );
    const buyerActivated = stageAnjuPayOpening(
      transaction,
      buyerWalletRef,
      buyerWallet,
      ledgerConfigSnapshot,
      marketActionTimestamp,
    );
    if (ledgerSnapshot.exists) {
      const ledger = ledgerSnapshot.data();
      if (ledger.actorUid !== uid || ledger.action !== action) throw new HttpsError("permission-denied", "市場操作IDが一致しません。");
      if (action === "pitch_complete") {
        const replayClosingDecision = marketClosingDecision({
          closingMode: data?.closingMode,
          salesMode: room.sellerShop?.salesMode,
          serviceStyles: room.sellerShop?.serviceStyles,
        });
        if (!replayClosingDecision.allowed) {
          if (replayClosingDecision.errorCode === "failed-precondition") {
            throw new HttpsError(
              "failed-precondition",
              "推し嬢モードをONにして保存した売り手だけが発動できます。",
            );
          }
          throw new HttpsError("invalid-argument", "未対応の営業クロージングモードです。");
        }
        if (marketClosingAuditMode(ledger.closingMode) !== replayClosingDecision.closingMode) {
          throw new HttpsError("permission-denied", "市場操作IDの営業クロージングモードが一致しません。");
        }
        if (replayClosingDecision.closingMode === "oshijo") {
          const replayClaim = marketOshijoClaimDecision(data?.claimAmount);
          if (!replayClaim.allowed) {
            throw new HttpsError("invalid-argument", "推し嬢の請求額は1〜999999 Payの整数で指定してください。");
          }
          if (Number(ledger.claimAmount) !== replayClaim.claimAmount) {
            throw new HttpsError("permission-denied", "市場操作IDの推し嬢請求額が一致しません。");
          }
        }
      }
      if (action === "oshijo_closing_turn") {
        const savedTurn = integer(
          ledger.oshijoClosingTurnCount,
          1,
          MARKET_OSHIJO_MAX_CLOSING_TURNS,
          1,
        );
        const replayTurn = marketOshijoTurnDecision({
          mediaKind: data?.mediaKind,
          currentTurnCount: savedTurn - 1,
          requestedTurn: data?.closingTurn,
        });
        if (!replayTurn.allowed
            || replayTurn.mediaKind !== ledger.oshijoMediaKind
            || replayTurn.turnCount !== savedTurn) {
          throw new HttpsError("permission-denied", "市場操作IDの推し嬢クロージング手が一致しません。");
        }
      }
      if (isMarketOshijoDeliveryAction(action)) {
        const deliveryId = marketOshijoDeliveryId(data?.deliveryId);
        const mediaKind = cleanText(data?.mediaKind, 8).toLowerCase();
        let deliveryState = cleanText(ledger.oshijoDeliveryState, 16);
        if (!deliveryId
            || !["text", "image", "audio"].includes(mediaKind)
            || deliveryId !== ledger.oshijoDeliveryId
            || mediaKind !== ledger.oshijoMediaKind
            || !["reserved", "finalized", "released"].includes(deliveryState)) {
          throw new HttpsError("permission-denied", "市場操作IDの推し嬢送信枠が一致しません。");
        }
        let expiresAt = integer(
          ledger.oshijoReservationExpiresAt,
          0,
          Number.MAX_SAFE_INTEGER,
          0,
        );
        if (action === "oshijo_closing_turn_reserve") {
          const currentDeliveries = marketOshijoDeliveries(room.oshijoClosingDeliveries);
          const currentDelivery = currentDeliveries[deliveryId];
          const currentReservations = marketOshijoActiveReservations(
            room.oshijoClosingReservations,
            marketActionTimestamp,
          );
          const currentReservation = currentReservations[deliveryId];
          if (currentDelivery) {
            if (currentDelivery.mediaKind !== mediaKind) {
              throw new HttpsError(
                "permission-denied",
                "市場操作IDの推し嬢送信枠が一致しません。",
              );
            }
            deliveryState = "finalized";
            expiresAt = 0;
          } else if (currentReservation) {
            if (currentReservation.mediaKind !== mediaKind) {
              throw new HttpsError(
                "permission-denied",
                "市場操作IDの推し嬢送信枠が一致しません。",
              );
            }
            deliveryState = "reserved";
            expiresAt = currentReservation.expiresAt;
          } else {
            deliveryState = "released";
            expiresAt = 0;
          }
        }
        oshijoDeliveryResult = {
          deliveryId,
          mediaKind,
          state: deliveryState,
          expiresAt,
          turnCount: integer(
            room.oshijoClosingTurnCount,
            0,
            MARKET_OSHIJO_MAX_CLOSING_TURNS,
            integer(
              ledger.oshijoClosingTurnCount,
              0,
              MARKET_OSHIJO_MAX_CLOSING_TURNS,
              0,
            ),
          ),
        };
      }
      if (action === "buy" && marketClosingAuditMode(ledger.closingMode) === "oshijo") {
        if (Number(data?.confirmedBalance) !== Number(ledger.confirmedBalance)
            || Number(data?.confirmedPaidAmount) !== Number(ledger.paidAmount)
            || data?.allIn !== (ledger.allIn === true)) {
          throw new HttpsError("permission-denied", "市場操作IDの推し嬢購入確認が一致しません。");
        }
      }
      if (["enter_silent_decision", "buy"].includes(action)
          && marketClosingAuditMode(ledger.closingMode) === "oshijo") {
        buyerDecisionResult = {
          claimAmount: integer(
            ledger.claimAmount,
            1,
            MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
            1,
          ),
          confirmedBalance: integer(ledger.confirmedBalance, 0, MAX_POINTS, 0),
          paidAmount: integer(
            ledger.paidAmount,
            0,
            MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
            0,
          ),
          allIn: ledger.allIn === true,
        };
      }
      result = {
        status: room.status,
        room: { ...room, rankingCounted: room.rankingCounted ?? ledger.rankingCounted ?? null },
        sellerBalance: sellerWallet.balance,
        buyerBalance: buyerWallet.balance,
        role,
        buyerDecision: buyerDecisionResult,
        newlyUnlocked: sanitizeAchievementIds(ledger.achievementIds, { maximum: 100 }),
      };
      persistAnjuPayOpening(
        transaction,
        sellerWalletRef,
        sellerWallet,
        sellerActivated,
        marketActionTimestamp,
      );
      persistAnjuPayOpening(
        transaction,
        buyerWalletRef,
        buyerWallet,
        buyerActivated,
        marketActionTimestamp,
      );
      return;
    }
    const sellerStats = sellerStatsSnapshot.exists ? { ...defaultStats(room.sellerUid, room.sellerName), ...sellerStatsSnapshot.data() } : defaultStats(room.sellerUid, room.sellerName);
    const buyerStats = buyerStatsSnapshot.exists ? { ...defaultStats(room.buyerUid, room.buyerName), ...buyerStatsSnapshot.data() } : defaultStats(room.buyerUid, room.buyerName);
    const sellerAchievement = normalizeAchievementProfile(sellerAchievementSnapshot.data());
    const buyerAchievement = normalizeAchievementProfile(buyerAchievementSnapshot.data());
    let transfer = null;
    const marketComponents = { seller: [], buyer: [] };
    const addMarketComponent = (
      entryRole,
      kind,
      status,
      delta,
      nominalAmount = Math.abs(delta),
    ) => {
      marketComponents[entryRole].push({
        kind,
        labelKey: `anju_pay_market_${kind}`,
        delta,
        nominalAmount,
        status,
      });
    };
    const captureMarketBalanceChanges = (kind, status, operation) => {
      const sellerBefore = sellerWallet.balance;
      const buyerBefore = buyerWallet.balance;
      const output = operation();
      for (const [entryRole, before, after] of [
        ["seller", sellerBefore, sellerWallet.balance],
        ["buyer", buyerBefore, buyerWallet.balance],
      ]) {
        const delta = after - before;
        if (!delta) continue;
        addMarketComponent(entryRole, kind, status, delta);
      }
      return output;
    };

    if (action === "accept_pitch") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "preview");
      const amount = captureMarketBalanceChanges("entry_fee_hold", "held", () => (
        debitPoints(buyerWallet, room.entryFee || MARKET_ENTRY_FEE)
      ));
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
      const closingDecision = marketClosingDecision({
        closingMode: data?.closingMode,
        salesMode: room.sellerShop?.salesMode,
        serviceStyles: room.sellerShop?.serviceStyles,
      });
      if (!closingDecision.allowed) {
        if (closingDecision.errorCode === "failed-precondition") {
          throw new HttpsError(
            "failed-precondition",
            "推し嬢モードをONにして保存した売り手だけが発動できます。",
          );
        }
        throw new HttpsError("invalid-argument", "未対応の営業クロージングモードです。");
      }
      const claimDecision = closingDecision.closingMode === "oshijo"
        ? marketOshijoClaimDecision(data?.claimAmount)
        : { allowed: true, claimAmount: 0 };
      if (!claimDecision.allowed) {
        throw new HttpsError(
          "invalid-argument",
          `推し嬢の請求額は1〜${MARKET_OSHIJO_MAX_CLAIM_AMOUNT} Payの整数で指定してください。`,
        );
      }
      const pitchCompletedAt = Date.now();
      room.closingMode = closingDecision.closingMode;
      room.closingActivatedAt = closingDecision.closingMode ? pitchCompletedAt : 0;
      room.claimAmount = claimDecision.claimAmount;
      room.oshijoClosingTurnCount = 0;
      room.oshijoLastMediaKind = "";
      room.oshijoClosingMediaCounts = marketOshijoMediaCounts();
      room.oshijoClosingReservations = {};
      room.oshijoClosingDeliveries = {};
      const heldFee = Math.max(0, Number(room.entryFeeHeld || 0));
      if (heldFee > 0) {
        const wasReserved = room.entryFeeReserved === true;
        if (wasReserved) {
          releaseIncoming(sellerWallet, heldFee);
          releaseIncoming(buyerWallet, heldFee);
        }
        const settlement = captureMarketBalanceChanges(
          "entry_fee_settlement",
          "settled",
          () => (wasReserved
            ? { preferredAmount: creditPoints(sellerWallet, heldFee), fallbackAmount: 0, overflow: 0 }
            : distributeEscrow(sellerWallet, buyerWallet, heldFee)),
        );
        if (settlement.fallbackAmount > 0) {
          const buyerRefund = marketComponents.buyer.at(-1);
          if (buyerRefund?.kind === "entry_fee_settlement") {
            buyerRefund.kind = "entry_fee_refund";
            buyerRefund.labelKey = "anju_pay_market_entry_fee_refund";
            buyerRefund.status = "refunded";
          }
        }
        const settledFromBuyer = Math.max(0, heldFee - settlement.fallbackAmount);
        if (settledFromBuyer > 0) {
          addMarketComponent(
            "buyer",
            "entry_fee_settlement",
            "settled",
            0,
            settledFromBuyer,
          );
        }
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
      room.status = closingDecision.closingMode === "oshijo"
        ? "oshijo_warning"
        : "decision";
      room.pitchCompletedAt = pitchCompletedAt;
    } else if (action === "hear_oshijo_closing") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "oshijo_warning");
      if (marketClosingAuditMode(room.closingMode) !== "oshijo") {
        throw new HttpsError("failed-precondition", "推し嬢クロージングが発動していません。");
      }
      room.status = "oshijo_closing";
      room.oshijoHeardAt = Date.now();
    } else if (action === "oshijo_closing_turn") {
      requireRoomActor(room, uid, "seller");
      requireMarketState(room, "oshijo_closing");
      if (marketClosingAuditMode(room.closingMode) !== "oshijo") {
        throw new HttpsError("failed-precondition", "推し嬢クロージングが発動していません。");
      }
      const currentTurnCount = integer(
        room.oshijoClosingTurnCount,
        0,
        MARKET_OSHIJO_MAX_CLOSING_TURNS,
        0,
      );
      const activeReservations = marketOshijoActiveReservations(
        room.oshijoClosingReservations,
        marketActionTimestamp,
      );
      if (currentTurnCount + Object.keys(activeReservations).length
          >= MARKET_OSHIJO_MAX_CLOSING_TURNS) {
        throw new HttpsError("failed-precondition", "推し嬢クロージングは3手までです。");
      }
      const turnDecision = marketOshijoTurnDecision({
        mediaKind: data?.mediaKind,
        currentTurnCount,
        requestedTurn: data?.closingTurn,
      });
      if (!turnDecision.allowed) {
        if (turnDecision.errorCode === "turn-limit") {
          throw new HttpsError("failed-precondition", "推し嬢クロージングは3手までです。");
        }
        if (turnDecision.errorCode === "turn-mismatch") {
          throw new HttpsError("failed-precondition", "推し嬢クロージングの手順が変わりました。");
        }
        throw new HttpsError("invalid-argument", "営業手段は文字・画像・音声から選択してください。");
      }
      const mediaCounts = marketOshijoRoomMediaCounts(room);
      if (["image", "audio"].includes(turnDecision.mediaKind)
          && mediaCounts[turnDecision.mediaKind]
            + Object.values(activeReservations).filter(
              (reservation) => reservation.mediaKind === turnDecision.mediaKind,
            ).length >= 1) {
        throw new HttpsError("failed-precondition", "画像と音声はそれぞれ1件までです。");
      }
      room.oshijoClosingTurnCount = turnDecision.turnCount;
      room.oshijoClosingMediaCounts = {
        ...mediaCounts,
        [turnDecision.mediaKind]: mediaCounts[turnDecision.mediaKind] + 1,
      };
      room.oshijoClosingReservations = { ...activeReservations };
      room.oshijoClosingDeliveries = {
        ...marketOshijoDeliveries(room.oshijoClosingDeliveries),
      };
      room.oshijoLastMediaKind = turnDecision.mediaKind;
      room.oshijoLastTurnAt = Date.now();
    } else if (action === "oshijo_closing_turn_reserve") {
      requireRoomActor(room, uid, "seller");
      requireMarketState(room, "oshijo_closing");
      if (marketClosingAuditMode(room.closingMode) !== "oshijo") {
        throw new HttpsError("failed-precondition", "推し嬢クロージングが発動していません。");
      }
      const mediaKind = cleanText(data?.mediaKind, 8).toLowerCase();
      if (!["image", "audio"].includes(mediaKind)) {
        throw new HttpsError("invalid-argument", "P2P送信枠は画像または音声で指定してください。");
      }
      const reservationDecision = marketOshijoReserveDeliveryDecision({
        deliveryId: data?.deliveryId,
        mediaKind,
        currentTurnCount: integer(
          room.oshijoClosingTurnCount,
          0,
          MARKET_OSHIJO_MAX_CLOSING_TURNS,
          0,
        ),
        mediaCounts: marketOshijoRoomMediaCounts(room),
        reservations: room.oshijoClosingReservations,
        deliveries: room.oshijoClosingDeliveries,
        now: marketActionTimestamp,
      });
      if (!reservationDecision.allowed) {
        throwMarketOshijoDeliveryError(reservationDecision.errorCode);
      }
      room.oshijoClosingMediaCounts = marketOshijoRoomMediaCounts(room);
      room.oshijoClosingReservations = { ...reservationDecision.reservations };
      room.oshijoClosingDeliveries = {
        ...marketOshijoDeliveries(room.oshijoClosingDeliveries),
      };
      oshijoDeliveryResult = {
        deliveryId: reservationDecision.deliveryId,
        mediaKind: reservationDecision.mediaKind,
        state: reservationDecision.state,
        expiresAt: reservationDecision.expiresAt,
        turnCount: reservationDecision.turnCount,
      };
    } else if (action === "oshijo_closing_turn_ack") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "oshijo_closing");
      if (marketClosingAuditMode(room.closingMode) !== "oshijo") {
        throw new HttpsError("failed-precondition", "推し嬢クロージングが発動していません。");
      }
      const mediaKind = cleanText(data?.mediaKind, 8).toLowerCase();
      if (!["image", "audio"].includes(mediaKind)) {
        throw new HttpsError("invalid-argument", "P2P送信枠は画像または音声で指定してください。");
      }
      const finalizeDecision = marketOshijoFinalizeDeliveryDecision({
        deliveryId: data?.deliveryId,
        mediaKind,
        currentTurnCount: integer(
          room.oshijoClosingTurnCount,
          0,
          MARKET_OSHIJO_MAX_CLOSING_TURNS,
          0,
        ),
        mediaCounts: marketOshijoRoomMediaCounts(room),
        reservations: room.oshijoClosingReservations,
        deliveries: room.oshijoClosingDeliveries,
        now: marketActionTimestamp,
      });
      if (!finalizeDecision.allowed) {
        throwMarketOshijoDeliveryError(finalizeDecision.errorCode);
      }
      room.oshijoClosingTurnCount = finalizeDecision.turnCount;
      room.oshijoClosingMediaCounts = { ...finalizeDecision.mediaCounts };
      room.oshijoClosingReservations = { ...finalizeDecision.reservations };
      room.oshijoClosingDeliveries = { ...finalizeDecision.deliveries };
      if (!finalizeDecision.alreadyFinalized) {
        room.oshijoLastMediaKind = finalizeDecision.mediaKind;
        room.oshijoLastTurnAt = finalizeDecision.deliveredAt;
      }
      oshijoDeliveryResult = {
        deliveryId: finalizeDecision.deliveryId,
        mediaKind: finalizeDecision.mediaKind,
        state: finalizeDecision.state,
        expiresAt: 0,
        turnCount: finalizeDecision.turnCount,
      };
    } else if (action === "oshijo_closing_turn_release") {
      requireRoomActor(room, uid, "seller");
      if (marketClosingAuditMode(room.closingMode) !== "oshijo") {
        throw new HttpsError("failed-precondition", "推し嬢クロージングが発動していません。");
      }
      const mediaKind = cleanText(data?.mediaKind, 8).toLowerCase();
      if (!["image", "audio"].includes(mediaKind)) {
        throw new HttpsError("invalid-argument", "P2P送信枠は画像または音声で指定してください。");
      }
      const releaseDecision = marketOshijoReleaseDeliveryDecision({
        deliveryId: data?.deliveryId,
        mediaKind,
        currentTurnCount: integer(
          room.oshijoClosingTurnCount,
          0,
          MARKET_OSHIJO_MAX_CLOSING_TURNS,
          0,
        ),
        reservations: room.oshijoClosingReservations,
        deliveries: room.oshijoClosingDeliveries,
        now: marketActionTimestamp,
      });
      if (!releaseDecision.allowed) {
        throwMarketOshijoDeliveryError(releaseDecision.errorCode);
      }
      room.oshijoClosingMediaCounts = marketOshijoRoomMediaCounts(room);
      room.oshijoClosingReservations = { ...releaseDecision.reservations };
      room.oshijoClosingDeliveries = {
        ...marketOshijoDeliveries(room.oshijoClosingDeliveries),
      };
      oshijoDeliveryResult = {
        deliveryId: releaseDecision.deliveryId,
        mediaKind: releaseDecision.mediaKind,
        state: releaseDecision.state,
        expiresAt: releaseDecision.expiresAt,
        turnCount: releaseDecision.turnCount,
      };
    } else if (action === "enter_silent_decision") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "oshijo_closing", "decision");
      if (marketClosingAuditMode(room.closingMode) !== "oshijo") {
        throw new HttpsError("failed-precondition", "推し嬢クロージングが発動していません。");
      }
      const claimDecision = marketOshijoClaimDecision(
        room.claimAmount || room.listing?.askingPrice,
      );
      if (!claimDecision.allowed) {
        throw new HttpsError("failed-precondition", "推し嬢の請求額を確認できませんでした。");
      }
      room.claimAmount = claimDecision.claimAmount;
      room.oshijoClosingReservations = {};
      room.status = "decision";
      room.silentDecisionAt = Date.now();
      buyerDecisionResult = {
        claimAmount: claimDecision.claimAmount,
        confirmedBalance: buyerWallet.balance,
        paidAmount: Math.min(claimDecision.claimAmount, buyerWallet.balance),
        allIn: claimDecision.claimAmount > buyerWallet.balance
          && buyerWallet.balance > 0,
      };
    } else if (action === "buy") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "decision");
      const oshijoPurchase = marketClosingAuditMode(room.closingMode) === "oshijo";
      let oshijoSettlement = null;
      if (oshijoPurchase) {
        const claimDecision = marketOshijoClaimDecision(
          room.claimAmount || room.listing?.askingPrice,
        );
        if (!claimDecision.allowed) {
          throw new HttpsError("failed-precondition", "推し嬢の請求額を確認できませんでした。");
        }
        oshijoSettlement = marketOshijoSettlementDecision({
          claimAmount: claimDecision.claimAmount,
          availableBalance: buyerWallet.balance,
          confirmedBalance: data?.confirmedBalance,
          confirmedPaidAmount: data?.confirmedPaidAmount,
          allIn: data?.allIn,
        });
        if (!oshijoSettlement.allowed) {
          throw new HttpsError(
            "failed-precondition",
            "AnjuPay残高が変わりました。静かな最終判断画面で金額をもう一度確認してください。",
            {
              reason: oshijoSettlement.reason || "wallet-changed",
              claimAmount: claimDecision.claimAmount,
              previousBalance: Number.isSafeInteger(data?.confirmedBalance)
                ? data.confirmedBalance
                : 0,
              currentBalance: buyerWallet.balance,
              paidAmount: Math.min(claimDecision.claimAmount, buyerWallet.balance),
              allIn: claimDecision.claimAmount > buyerWallet.balance
                && buyerWallet.balance > 0,
              reconfirmAction: "enter_silent_decision",
            },
          );
        }
        buyerDecisionResult = {
          claimAmount: oshijoSettlement.claimAmount,
          confirmedBalance: buyerWallet.balance,
          paidAmount: oshijoSettlement.paidAmount,
          allIn: oshijoSettlement.allIn,
        };
      }
      const price = oshijoPurchase
        ? oshijoSettlement.paidAmount
        : integer(
          room.listing?.askingPrice,
          MARKET_MIN_PRICE,
          MARKET_MAX_PRICE,
          MARKET_MIN_PRICE,
        );
      const settlement = marketSaleSettlement(price);
      const patronFund = normalizePatronFund(
        marketPatronFundSnapshot?.data(),
        patronSeasonKey,
      );
      const patronPolicy = normalizePatronPolicy(
        marketPatronPolicySnapshot?.data(),
        patronSeasonKey,
      );
      const patronSellerImpact = normalizePatronSellerImpact(
        marketPatronSellerImpactSnapshot?.data(),
        room.sellerUid,
        patronSeasonKey,
      );
      const previousShopRelationship = shopRelationshipSnapshot.data() || {};
      const sellerSubsidyCapacity = Math.max(
        0,
        walletCreditCapacity(sellerWallet) - settlement.sellerProceeds,
      );
      const candidateSubsidy = patronFundSubsidyDecision({
        actualFee: settlement.feeAmount,
        fundRemaining: Math.min(patronFund.fundRemaining, sellerSubsidyCapacity),
        sellerSubsidized: patronSellerImpact.totalSubsidized,
        pairAlreadySubsidized: marketPatronPairSnapshot?.exists === true,
        policyId: patronPolicy.activePolicy,
        previousSaleCount: integer(previousShopRelationship.saleCount, 0, 1_000_000, 0),
        lastSaleDateKey: cleanText(previousShopRelationship.lastSaleDateKey, 10),
        currentDateKey: transactionDateKey,
      });
      const subsidyProtected = room.appCheckVerified === true
        && appCheckVerified === true
        && !pairSnapshot.exists;
      const patronSubsidy = subsidyProtected ? candidateSubsidy.subsidyAmount : 0;
      const actualSellerProceeds = settlement.sellerProceeds + patronSubsidy;
      const effectiveMarketFee = settlement.feeAmount - patronSubsidy;
      const amount = debitPoints(buyerWallet, settlement.grossAmount);
      if (actualSellerProceeds > 0) creditPoints(sellerWallet, actualSellerProceeds);
      addMarketComponent(
        "buyer",
        "sale_purchase",
        "settled",
        -settlement.grossAmount,
        settlement.grossAmount,
      );
      addMarketComponent(
        "seller",
        "sale_gross",
        "settled",
        settlement.grossAmount,
        settlement.grossAmount,
      );
      addMarketComponent(
        "seller",
        "success_fee",
        "settled",
        -settlement.feeAmount,
        settlement.feeAmount,
      );
      if (patronSubsidy > 0) {
        addMarketComponent(
          "seller",
          "patron_fund_subsidy",
          "settled",
          patronSubsidy,
          patronSubsidy,
        );
      }
      const issuedAt = Date.now();
      const certificateNumber = `OSHI-${certificateRef.id.slice(0, 16).toUpperCase()}`;
      if (
        shopPublicSnapshot.exists
        && cleanText(shopPublicSnapshot.get("sellerUid"), 128) !== room.sellerUid
      ) {
        throw new HttpsError("failed-precondition", "店コードの所有関係を確認できませんでした。");
      }
      const saleRelationship = marketSaleRelationshipUpdate(
        shopRelationshipSnapshot.data(),
        transactionDateKey,
        issuedAt,
      );
      sellerShopResult = applyMarketSaleToShop(
        {
          ...shopSnapshot.data(),
          publicSellerId: ensuredSellerShop.publicSellerId,
        },
        saleRelationship,
        issuedAt,
        amount,
      );
      const sellerIssueNumber = sellerShopResult.issueCount;
      room.status = "sold";
      room.salePrice = amount;
      room.claimAmount = oshijoPurchase ? oshijoSettlement.claimAmount : amount;
      room.paidAmount = amount;
      room.allIn = oshijoPurchase && oshijoSettlement.allIn;
      room.marketFee = settlement.feeAmount;
      room.effectiveMarketFee = effectiveMarketFee;
      room.patronFundSubsidy = patronSubsidy;
      room.patronFundPolicy = patronPolicy.activePolicy;
      room.patronFundKind = patronSubsidy > 0 ? candidateSubsidy.kind : "";
      room.sellerProceeds = actualSellerProceeds;
      room.settlementQuote = {
        ...settlement,
        effectiveMarketFee,
        patronFundSubsidy: patronSubsidy,
        patronFundPolicy: patronPolicy.activePolicy,
        patronFundKind: room.patronFundKind,
        sellerProceeds: actualSellerProceeds,
      };
      room.certificateNumber = certificateNumber;
      room.sellerIssueNumber = sellerIssueNumber;
      room.soldAt = issuedAt;
      room.rankingCounted = !pairSnapshot.exists;
      room.rankingContribution = room.rankingCounted
        ? marketRankingContribution(amount)
        : 0;
      transfer = {
        fromUid: room.buyerUid,
        toUid: room.sellerUid,
        amount,
        feeAmount: settlement.feeAmount,
        effectiveFeeAmount: effectiveMarketFee,
        patronFundSubsidy: patronSubsidy,
        patronFundPolicy: patronPolicy.activePolicy,
        patronFundKind: room.patronFundKind,
        netAmount: actualSellerProceeds,
        feeToUid: "market_fee_sink",
        kind: "sale",
      };
      if (certificateSnapshot.exists) {
        throw new HttpsError("already-exists", "この成約の推し値証書は発行済みです。");
      }
      const {
        addsUniqueBuyer,
        addsRepeatBuyer,
        ...storedSaleRelationship
      } = saleRelationship;
      transaction.set(shopRelationshipRef, {
        ...(shopRelationshipSnapshot.data() || {}),
        schemaVersion: 1,
        sellerUid: room.sellerUid,
        buyerUid: room.buyerUid,
        ...storedSaleRelationship,
        lastSalePrice: amount,
        lastSaleRoomId: roomId,
        createdAt: Number(shopRelationshipSnapshot.get("createdAt") || issuedAt),
        updatedAt: issuedAt,
      });
      if (shopFavoriteSnapshot.exists) {
        transaction.set(shopFavoriteRef, {
          publicSellerId: ensuredSellerShop.publicSellerId,
          lastPurchasePrice: amount,
          saleCount: saleRelationship.saleCount,
          updatedAt: issuedAt,
        }, { merge: true });
      }
      if (patronSubsidy > 0) {
        const firstSupportedDealForSeller = patronSellerImpact.supportedDeals === 0;
        transaction.set(marketPatronFundRef, {
          ...patronFund,
          activePolicy: patronPolicy.activePolicy,
          totalSubsidized: patronFund.totalSubsidized + patronSubsidy,
          fundRemaining: patronFund.fundRemaining - patronSubsidy,
          supportedSaleCount: patronFund.supportedSaleCount + 1,
          supportedSellerCount: patronFund.supportedSellerCount
            + (firstSupportedDealForSeller ? 1 : 0),
          updatedAt: issuedAt,
        });
        transaction.set(marketPatronSellerImpactRef, {
          schemaVersion: 1,
          sellerUid: room.sellerUid,
          seasonKey: patronSeasonKey,
          totalSubsidized: patronSellerImpact.totalSubsidized + patronSubsidy,
          supportedDeals: patronSellerImpact.supportedDeals + 1,
          createdAt: patronSellerImpact.createdAt || issuedAt,
          updatedAt: issuedAt,
        });
        transaction.create(marketPatronPairRef, {
          schemaVersion: 1,
          seasonKey: patronSeasonKey,
          sellerUid: room.sellerUid,
          buyerUid: room.buyerUid,
          roomId,
          dateKey: transactionDateKey,
          policyId: patronPolicy.activePolicy,
          subsidyKind: candidateSubsidy.kind,
          subsidyAmount: patronSubsidy,
          marketFee: settlement.feeAmount,
          effectiveMarketFee,
          createdAt: issuedAt,
        });
      }
      sellerStats.marketFeesPaid = Number(sellerStats.marketFeesPaid || 0) + effectiveMarketFee;
      sellerStats.netSales = Number(sellerStats.netSales || 0) + actualSellerProceeds;
      sellerStats.actualGrossSales = Number(sellerStats.actualGrossSales || 0) + amount;
      buyerStats.actualSpent = Number(buyerStats.actualSpent || 0) + amount;
      if (!pairSnapshot.exists) {
        sellerStats.salesCount = Number(sellerStats.salesCount || 0) + 1;
        sellerStats.grossSales = Number(sellerStats.grossSales || 0)
          + room.rankingContribution;
        sellerStats.bestSale = Math.max(
          Number(sellerStats.bestSale || 0),
          room.rankingContribution,
        );
        buyerStats.purchases = Number(buyerStats.purchases || 0) + 1;
        buyerStats.spent = Number(buyerStats.spent || 0)
          + room.rankingContribution;
        buyerStats.highestPurchase = Math.max(
          Number(buyerStats.highestPurchase || 0),
          room.rankingContribution,
        );
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
      if (patronSeasonKey >= MARKET_MONTHLY_RANKING_START_KEY) {
        const monthlyNewCounterparty = room.rankingCounted
          && monthlyPairSnapshot?.exists !== true;
        const monthlyNewOshijoCounterparty = room.rankingCounted
          && oshijoPurchase
          && monthlyOshijoPairSnapshot?.exists !== true;
        const monthlySellerStats = applyMonthlyMarketSale(
          sellerMonthlyStatsSnapshot?.data(),
          {
            uid: room.sellerUid,
            seasonKey: patronSeasonKey,
            name: room.sellerName,
            role: "seller",
            paidAmount: amount,
            sellerProceeds: actualSellerProceeds,
            oshijoProceeds: settlement.sellerProceeds,
            effectiveFee: effectiveMarketFee,
            rankingCounted: room.rankingCounted,
            newCounterparty: monthlyNewCounterparty,
            newOshijoCounterparty: monthlyNewOshijoCounterparty,
            oshijo: oshijoPurchase,
            publicProfile: sellerStats.publicProfile,
            publicAchievements: sellerStats.publicAchievements,
            now: issuedAt,
          },
        );
        const monthlyBuyerStats = applyMonthlyMarketSale(
          buyerMonthlyStatsSnapshot?.data(),
          {
            uid: room.buyerUid,
            seasonKey: patronSeasonKey,
            name: room.buyerName,
            role: "buyer",
            paidAmount: amount,
            rankingCounted: room.rankingCounted,
            newCounterparty: monthlyNewCounterparty,
            publicProfile: buyerStats.publicProfile,
            publicAchievements: buyerStats.publicAchievements,
            now: issuedAt,
          },
        );
        transaction.set(sellerMonthlyStatsRef, monthlySellerStats);
        transaction.set(buyerMonthlyStatsRef, monthlyBuyerStats);
        if (monthlyNewCounterparty) {
          transaction.create(monthlyPairRef, {
            schemaVersion: 1,
            seasonKey: patronSeasonKey,
            sellerUid: room.sellerUid,
            buyerUid: room.buyerUid,
            firstRoomId: roomId,
            createdAt: issuedAt,
          });
        }
        if (monthlyNewOshijoCounterparty) {
          transaction.create(monthlyOshijoPairRef, {
            schemaVersion: 1,
            seasonKey: patronSeasonKey,
            sellerUid: room.sellerUid,
            buyerUid: room.buyerUid,
            firstRoomId: roomId,
            createdAt: issuedAt,
          });
        }
      }
      const liveSellerShop = publicSellerShop(sellerShopResult, {
        marketStats: sellerStats,
      });
      const presentedSellerShop = publicSellerShop(room.sellerShop);
      const currentSellerShop = presentedSellerShop?.publicSellerId === liveSellerShop?.publicSellerId
        ? {
          ...liveSellerShop,
          shopName: presentedSellerShop.shopName,
          tagline: presentedSellerShop.tagline,
          specialtyTags: presentedSellerShop.specialtyTags,
          serviceStyles: presentedSellerShop.serviceStyles,
          regularServiceStyles: presentedSellerShop.regularServiceStyles,
          salesMode: presentedSellerShop.salesMode,
          themeId: presentedSellerShop.themeId,
          sealId: presentedSellerShop.sealId,
          titleId: presentedSellerShop.titleId,
          shopCharmId: presentedSellerShop.shopCharmId,
          repeatWelcome: presentedSellerShop.repeatWelcome,
          verified: liveSellerShop.verified,
        }
        : liveSellerShop;
      room.sellerShop = {
        ...currentSellerShop,
        ...(room.sellerShop?.publicSellerId === ensuredSellerShop.publicSellerId
          ? {
            relationship: {
              previousPurchases: Math.max(0, saleRelationship.saleCount - 1),
              metBefore: saleRelationship.saleCount > 1,
              lastPurchasePrice: amount,
            },
          }
          : {}),
      };
      transaction.create(certificateRef, {
        schemaVersion: 2,
        certificateNumber,
        buyerUid: room.buyerUid,
        sellerName: cleanName(room.sellerName),
        sellerShop: currentSellerShop,
        sellerIssueNumber,
        listingTitle: cleanText(room.listing?.title, 30, "無題の推し"),
        purchasePrice: amount,
        claimAmount: room.claimAmount,
        paidAmount: amount,
        allIn: room.allIn === true,
        rankingContribution: room.rankingContribution,
        marketFee: settlement.feeAmount,
        effectiveMarketFee,
        patronFundSubsidy: patronSubsidy,
        patronFundPolicy: patronPolicy.activePolicy,
        patronFundKind: room.patronFundKind,
        sellerProceeds: actualSellerProceeds,
        closingMode: marketClosingAuditMode(room.closingMode),
        turn: integer(room.turn, 1, MARKET_MAX_TURNS, 1),
        extended: Number(room.turn || 1) > 1 || Number(room.extensionFeesPaid || 0) > 0,
        rankingCounted: room.rankingCounted,
        nonTransferable: true,
        issuedAt,
      });
    } else if (action === "leave") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "oshijo_warning", "oshijo_closing", "decision");
      room.status = "ended";
      room.endReason = marketClosingLeaveReason(room.closingMode);
    } else if (action === "request_extension") {
      requireRoomActor(room, uid, "buyer");
      requireMarketState(room, "decision");
      if (!marketClosingAllowsExtension(room.closingMode)) {
        throw new HttpsError("failed-precondition", "推し嬢モード中は追加検討できません。");
      }
      if (Number(room.turn || 1) >= MARKET_MAX_TURNS) throw new HttpsError("failed-precondition", "営業ターンは上限です。");
      room.status = "extension_request";
      room.extensionRequestedAt = Date.now();
    } else if (action === "offer_extension") {
      requireRoomActor(room, uid, "seller");
      requireMarketState(room, "extension_request");
      const incentive = integer(data?.incentive, 5, 20, 5);
      if (!MARKET_EXTENSION_FEES.has(incentive)) throw new HttpsError("invalid-argument", "延長内金は5 Pay・10 Pay・20 Payから選択してください。");
      const amount = captureMarketBalanceChanges("extension_hold", "held", () => (
        debitPoints(sellerWallet, incentive)
      ));
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
      requireReservedExtensionHold(room, held);
      releaseIncoming(sellerWallet, held);
      releaseIncoming(buyerWallet, held);
      const amount = captureMarketBalanceChanges(
        "extension_incentive",
        "settled",
        () => creditPoints(buyerWallet, held),
      );
      if (sellerWallet.balance === sellerBalanceBefore) {
        addMarketComponent("seller", "extension_incentive", "settled", 0, held);
      }
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
        requireReservedExtensionHold(room, held);
        releaseIncoming(sellerWallet, held);
        releaseIncoming(buyerWallet, held);
        captureMarketBalanceChanges("extension_refund", "refunded", () => (
          creditPoints(sellerWallet, held)
        ));
        room.extensionHeld = 0;
        room.extensionReserved = false;
        transfer = { fromUid: "market_escrow", toUid: room.sellerUid, amount: held, kind: "extension_refund" };
      }
      room.status = "ended";
      room.endReason = "extension_declined";
    } else if (action === "cancel") {
      if (isTerminalMarketState(room.status)) {
        result = { status: room.status, room, sellerBalance: sellerWallet.balance, buyerBalance: buyerWallet.balance, role };
        persistAnjuPayOpening(
          transaction,
          sellerWalletRef,
          sellerWallet,
          sellerActivated,
          marketActionTimestamp,
        );
        persistAnjuPayOpening(
          transaction,
          buyerWalletRef,
          buyerWallet,
          buyerActivated,
          marketActionTimestamp,
        );
        return;
      }
      const extensionHeld = Math.max(0, Number(room.extensionHeld || 0));
      requireReservedExtensionHold(room, extensionHeld);
      const heldFee = Math.max(0, Number(room.entryFeeHeld || 0));
      if (heldFee > 0) {
        const wasReserved = room.entryFeeReserved === true;
        if (wasReserved) {
          releaseIncoming(sellerWallet, heldFee);
          releaseIncoming(buyerWallet, heldFee);
        }
        if (role === "seller") {
          const settlement = captureMarketBalanceChanges(
            "entry_fee_refund",
            "refunded",
            () => (wasReserved
              ? { preferredAmount: creditPoints(buyerWallet, heldFee), fallbackAmount: 0, overflow: 0 }
              : distributeEscrow(buyerWallet, sellerWallet, heldFee)),
          );
          if (settlement.fallbackAmount > 0) {
            const sellerCompensation = marketComponents.seller.at(-1);
            if (sellerCompensation?.kind === "entry_fee_refund") {
              sellerCompensation.kind = "entry_fee_compensation";
              sellerCompensation.labelKey = "anju_pay_market_entry_fee_compensation";
              sellerCompensation.status = "settled";
            }
          }
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
          const settlement = captureMarketBalanceChanges(
            "entry_fee_compensation",
            "settled",
            () => (wasReserved
              ? { preferredAmount: creditPoints(sellerWallet, heldFee), fallbackAmount: 0, overflow: 0 }
              : distributeEscrow(sellerWallet, buyerWallet, heldFee)),
          );
          if (settlement.fallbackAmount > 0) {
            const buyerRefund = marketComponents.buyer.at(-1);
            if (buyerRefund?.kind === "entry_fee_compensation") {
              buyerRefund.kind = "entry_fee_refund";
              buyerRefund.labelKey = "anju_pay_market_entry_fee_refund";
              buyerRefund.status = "refunded";
            }
          }
          const settledFromBuyer = Math.max(0, heldFee - settlement.fallbackAmount);
          if (settledFromBuyer > 0) {
            addMarketComponent(
              "buyer",
              "entry_fee_compensation",
              "settled",
              0,
              settledFromBuyer,
            );
          }
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
      if (extensionHeld > 0) {
        releaseIncoming(sellerWallet, extensionHeld);
        releaseIncoming(buyerWallet, extensionHeld);
        captureMarketBalanceChanges("extension_refund", "refunded", () => (
          creditPoints(sellerWallet, extensionHeld)
        ));
        room.extensionHeld = 0;
        room.extensionReserved = false;
        transfer = transfer || { fromUid: "market_escrow", toUid: room.sellerUid, amount: extensionHeld, kind: "extension_refund" };
      }
      room.status = "canceled";
      room.endReason = role === "seller" ? "seller_canceled" : "buyer_canceled";
    } else {
      throw new HttpsError("invalid-argument", "未対応の市場操作です。");
    }

    const marketGroupId = anjuPayEntryId(`market:${roomId}:${uid}:${actionId}`);
    const appendMarketEntry = (
      entryRole,
      walletReference,
      walletState,
      balanceBefore,
      counterpartyName,
    ) => {
      const delta = walletState.balance - balanceBefore;
      const components = marketComponents[entryRole];
      if (!delta && !components.length) return;
      const componentStatuses = new Set(components.map((component) => component.status));
      const status = componentStatuses.size === 1
        ? components[0].status
        : "posted";
      const saleGross = components.find((component) => component.kind === "sale_gross");
      const nominalAmount = saleGross
        ? saleGross.nominalAmount
        : components.reduce((sum, component) => sum + component.nominalAmount, 0);
      appendAnjuPayEntry(
        transaction,
        walletReference,
        walletState,
        ledgerConfigSnapshot,
        {
          entryId: marketGroupId,
          groupId: marketGroupId,
          kind: "market_transaction",
          category: "market",
          labelKey: components.length === 1
            ? components[0].labelKey
            : `anju_pay_market_${action}`,
          status,
          delta,
          nominalAmount,
          balanceBefore,
          balanceAfter: walletState.balance,
          components,
          details: {
            role: entryRole,
            counterpartyName,
            ...(entryRole === "buyer"
              ? { publicSellerId: ensuredSellerShop.publicSellerId }
              : {}),
            listingTitle: cleanText(room.listing?.title, 30, "無題の推し"),
            closingMode: room.closingMode === "oshijo" ? "oshijo" : "",
            claimAmount: Number(room.claimAmount || 0),
            paidAmount: Number(room.paidAmount || 0),
            allIn: room.allIn === true,
            rankingContribution: Number(room.rankingContribution || 0),
            marketFee: Number(room.marketFee || 0),
            effectiveMarketFee: Number(room.effectiveMarketFee || room.marketFee || 0),
            patronFundSubsidy: Number(room.patronFundSubsidy || 0),
            patronFundPolicy: cleanText(room.patronFundPolicy, 16),
            patronFundKind: cleanText(room.patronFundKind, 16),
          },
          occurredAt: marketActionTimestamp,
        },
      );
    };
    appendMarketEntry(
      "seller",
      sellerWalletRef,
      sellerWallet,
      sellerBalanceBefore,
      room.buyerName,
    );
    appendMarketEntry(
      "buyer",
      buyerWalletRef,
      buyerWallet,
      buyerBalanceBefore,
      room.sellerName,
    );
    room.stateVersion = Math.max(0, Math.floor(Number(room.stateVersion || 0))) + 1;
    room.updatedAt = marketActionTimestamp;
    sellerStats.name = cleanName(room.sellerName);
    sellerStats.updatedAt = marketActionTimestamp;
    buyerStats.name = cleanName(room.buyerName);
    buyerStats.updatedAt = marketActionTimestamp;
    transaction.set(roomRef, room);
    transaction.set(sellerWalletRef, { ...sellerWallet, updatedAt: marketActionTimestamp }, { merge: true });
    transaction.set(buyerWalletRef, { ...buyerWallet, updatedAt: marketActionTimestamp }, { merge: true });
    transaction.set(sellerStatsRef, sellerStats);
    transaction.set(buyerStatsRef, buyerStats);
    if (sellerShopResult) {
      transaction.set(shopRef, sellerShopResult);
      transaction.set(
        shopPublicRef,
        marketShopPublicRecord(room.sellerUid, sellerShopResult, sellerStats, room.updatedAt),
      );
    }
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
      buyerDecision: buyerDecisionResult,
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
      rankingContribution: Number(room.rankingContribution || 0),
      marketFee: Number(room.marketFee || 0),
      effectiveMarketFee: Number(room.effectiveMarketFee || room.marketFee || 0),
      patronFundSubsidy: Number(room.patronFundSubsidy || 0),
      patronFundPolicy: cleanText(room.patronFundPolicy, 16),
      patronFundKind: cleanText(room.patronFundKind, 16),
      sellerProceeds: Number(room.sellerProceeds || 0),
      closingMode: marketClosingAuditMode(room.closingMode),
      claimAmount: Number(room.claimAmount || 0),
      paidAmount: Number(room.paidAmount || buyerDecisionResult?.paidAmount || 0),
      confirmedBalance: Number(buyerDecisionResult?.confirmedBalance || 0),
      allIn: room.allIn === true || buyerDecisionResult?.allIn === true,
      oshijoClosingTurnCount: Number(room.oshijoClosingTurnCount || 0),
      oshijoMediaKind: action === "oshijo_closing_turn" || isMarketOshijoDeliveryAction(action)
        ? cleanText(oshijoDeliveryResult?.mediaKind || room.oshijoLastMediaKind, 8)
        : "",
      oshijoDeliveryId: isMarketOshijoDeliveryAction(action)
        ? marketOshijoDeliveryId(oshijoDeliveryResult?.deliveryId)
        : "",
      oshijoDeliveryState: isMarketOshijoDeliveryAction(action)
        ? cleanText(oshijoDeliveryResult?.state, 16)
        : "",
      oshijoReservationExpiresAt: isMarketOshijoDeliveryAction(action)
        ? integer(oshijoDeliveryResult?.expiresAt, 0, Number.MAX_SAFE_INTEGER, 0)
        : 0,
      certificateNumber: cleanText(room.certificateNumber, 24),
      sellerIssueNumber: integer(room.sellerIssueNumber, 0, 1_000_000, 0),
      achievementIds: result.newlyUnlocked,
      transfer,
      turn: Number(room.turn || 1),
      createdAt: marketActionTimestamp,
    });
  });

  await bestEffort("performMarketAction", [
    mirrorWallet(initialRoom.sellerUid, result.sellerBalance),
    mirrorWallet(initialRoom.buyerUid, result.buyerBalance),
    ...Object.entries(achievementResults).map(([participantUid, profile]) => (
      syncAchievementPublicSurfaces(participantUid, profile)
    )),
    ...Object.keys(achievementResults).map((participantUid) => (
      syncCreatorCardGrowth(participantUid)
    )),
  ]);
  await retryRealtimeWrite(() => mirrorMarketRoom(result.room, {
    seenRoles: isTerminalMarketState(result.status) ? [] : [result.role],
  }));
  let patronProgram = null;
  if (action === "buy") {
    try {
      patronProgram = await readPatronProgram(uid);
    } catch (error) {
      console.warn("performMarketAction patron program refresh failed", {
        uid,
        roomId,
        error: error?.message || error,
      });
    }
  }
  let reentryGuide = null;
  if (result.status === "sold" && uid === initialRoom.buyerUid) {
    reentryGuide = {
      buyerMinimumBalance: MARKET_ENTRY_FEE + MARKET_MIN_PRICE,
      remainingPay: Math.max(
        0,
        MARKET_ENTRY_FEE + MARKET_MIN_PRICE - result.buyerBalance,
      ),
      sellerPitchReward: MARKET_ENTRY_FEE,
      needsReentry: result.buyerBalance < MARKET_ENTRY_FEE + MARKET_MIN_PRICE,
    };
    if (reentryGuide.needsReentry) {
      try {
        const progressSnapshot = await economyProgressRef(uid).get();
        const progress = normalizeEconomyProgress(progressSnapshot.data());
        const dailyPlay = dailyPlayRewardSummary(
          progress.periodRewards,
          progress.dailyPlayClaims,
        );
        if (dailyPlay.pendingPoints > 0) {
          reentryGuide.rewardLabel = "受取可能なデイリープレイ報酬";
          reentryGuide.rewardAmount = dailyPlay.pendingPoints;
          reentryGuide.rewardAvailable = true;
          reentryGuide.matchesUntilReward = 0;
        } else if (dailyPlay.nextReward > 0) {
          reentryGuide.rewardLabel = "次のデイリープレイ報酬";
          reentryGuide.rewardAmount = dailyPlay.nextReward;
          reentryGuide.rewardAvailable = false;
          reentryGuide.matchesUntilReward = Math.max(
            0,
            dailyPlay.nextTarget - dailyPlay.matches,
          );
        }
      } catch (error) {
        console.warn("performMarketAction reentry guide refresh failed", {
          uid,
          roomId,
          error: error?.message || error,
        });
      }
    }
  }
  return {
    status: result.status,
    roomId,
    balance: uid === initialRoom.sellerUid ? result.sellerBalance : result.buyerBalance,
    rankingCounted: result.room.rankingCounted ?? null,
    rankingContribution: integer(
      result.room.rankingContribution,
      0,
      MARKET_RANKING_CONTRIBUTION_CAP,
      0,
    ),
    marketFee: Number(result.room.marketFee || 0),
    effectiveMarketFee: Number(result.room.effectiveMarketFee || result.room.marketFee || 0),
    patronFundSubsidy: Number(result.room.patronFundSubsidy || 0),
    patronFundPolicy: cleanText(result.room.patronFundPolicy, 16),
    patronFundKind: cleanText(result.room.patronFundKind, 16),
    sellerProceeds: Number(result.room.sellerProceeds || 0),
    closingMode: marketClosingAuditMode(result.room.closingMode),
    claimAmount: integer(
      result.room.claimAmount,
      0,
      MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
      0,
    ),
    paidAmount: integer(result.room.paidAmount, 0, MAX_POINTS, 0),
    allIn: result.room.allIn === true,
    oshijoClosingTurnCount: integer(
      result.room.oshijoClosingTurnCount,
      0,
      MARKET_OSHIJO_MAX_CLOSING_TURNS,
      0,
    ),
    closingMediaCounts: marketOshijoRoomMediaCounts(result.room),
    oshijoClosingMediaCounts: marketOshijoRoomMediaCounts(result.room),
    ...(oshijoDeliveryResult ? {
      oshijoDelivery: {
        deliveryId: marketOshijoDeliveryId(oshijoDeliveryResult.deliveryId),
        mediaKind: cleanText(oshijoDeliveryResult.mediaKind, 8),
        state: cleanText(oshijoDeliveryResult.state, 16),
        expiresAt: integer(
          oshijoDeliveryResult.expiresAt,
          0,
          Number.MAX_SAFE_INTEGER,
          0,
        ),
        turnCount: integer(
          oshijoDeliveryResult.turnCount,
          0,
          MARKET_OSHIJO_MAX_CLOSING_TURNS,
          0,
        ),
      },
    } : {}),
    certificateNumber: cleanText(result.room.certificateNumber, 24),
    sellerIssueNumber: integer(result.room.sellerIssueNumber, 0, 1_000_000, 0),
    sellerShop: result.room.sellerShop || null,
    newlyUnlocked: result.newlyUnlocked || [],
    ...(result.buyerDecision ? {
      decisionQuote: result.buyerDecision,
      confirmedBalance: result.buyerDecision.confirmedBalance,
      confirmedPaidAmount: result.buyerDecision.paidAmount,
    } : {}),
    ...(reentryGuide ? { reentryGuide } : {}),
    ...(patronProgram || {}),
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

const anjuPayFleaService = createAnjuPayFleaService({
  firestore,
  realtime,
  HttpsError,
  ensureWallet,
  walletRef,
  anjuPayLedgerConfigRef,
  walletData,
  walletCreditCapacity,
  debitPoints,
  creditPoints,
  stageAnjuPayOpening,
  appendAnjuPayEntry,
  anjuPayWalletMetadataPatch,
  anjuPayEntryId,
  mirrorWallet,
  bestEffort,
});

exports.anjuPayFleaAction = onCall(callableOptions("anjuPayFleaAction"), async (request) => {
  const uid = requireUid(request);
  try {
    return await anjuPayFleaService.performAction(uid, request.data);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("anjuPayFleaAction failed", {
      uid,
      action: request.data?.action,
      error,
    });
    throw new HttpsError("internal", "AnjuPayフリマの処理を完了できませんでした。");
  }
});

exports.expireAnjuPayFleaListings = onSchedule({
  schedule: "every day 00:00",
  timeZone: "Asia/Tokyo",
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 1,
}, async () => {
  try {
    return await anjuPayFleaService.expireListings(Date.now());
  } catch (error) {
    console.error("expireAnjuPayFleaListings failed", { error });
    throw error;
  }
});

const freeTableService = createFreeTableService({
  firestore,
  realtime,
  HttpsError,
  Timestamp,
});

exports.freeTableAction = onCall(callableOptions("freeTableAction"), async (request) => {
  const uid = requireUid(request);
  try {
    return await freeTableService.performAction(uid, request.data);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("freeTableAction failed", {
      uid,
      action: request.data?.action,
      error,
    });
    throw new HttpsError("internal", "貼り合い自由卓の処理を完了できませんでした。");
  }
});

exports.freeTableInviteAction = onCall(
  callableOptions("freeTableInviteAction"),
  async (request) => {
    const uid = requireUid(request);
    try {
      return await freeTableService.performInviteAction(uid, request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("freeTableInviteAction failed", {
        uid,
        action: request.data?.action,
        error,
      });
      throw new HttpsError("internal", "灯り札の処理を完了できませんでした。");
    }
  },
);

exports.freeTableInvitePreview = onCall(
  callableOptions("freeTableInvitePreview"),
  async (request) => {
    try {
      return await freeTableService.getInvitePreview(request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("freeTableInvitePreview failed", {
        code: typeof error?.code === "string" ? error.code : "unknown",
      });
      throw new HttpsError("internal", "灯り札を読み込めませんでした。");
    }
  },
);

exports.freeTablePublicStats = onCall(
  callableOptions("freeTablePublicStats"),
  async (request) => {
    try {
      return await freeTableService.getPublicStats(request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("freeTablePublicStats failed", {
        code: typeof error?.code === "string" ? error.code : "unknown",
      });
      throw new HttpsError(
        "internal",
        "貼り合い自由卓の公開状況を取得できませんでした。",
      );
    }
  },
);

exports.cleanupExpiredFreeTables = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "Asia/Tokyo",
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 1,
}, async () => {
  try {
    return await freeTableService.cleanupExpired(Date.now());
  } catch (error) {
    console.error("cleanupExpiredFreeTables failed", { error });
    throw error;
  }
});

async function commitCrownCircuitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 350) {
    const batch = firestore.batch();
    writes.slice(offset, offset + 350).forEach(({ ref, data, options }) => {
      if (options) batch.set(ref, data, options);
      else batch.set(ref, data);
    });
    await batch.commit();
  }
}

async function getCrownCircuitSnapshots(refs) {
  const snapshots = [];
  for (let offset = 0; offset < refs.length; offset += 300) {
    snapshots.push(...await firestore.getAll(...refs.slice(offset, offset + 300)));
  }
  return snapshots;
}

function crownCircuitEntryEligible(period, value) {
  if (!value || Number(value.withdrawnAt || 0) > 0 || Number(value.rankScore || 0) <= 0) {
    return false;
  }
  if (period === "daily") {
    const run = normalizeCrownRun(value, value);
    return run.matchCount >= CROWN_DAILY_MATCH_LIMIT;
  }
  if (period === "weekly") {
    return integer(value.qualifyingDays, 0, 7, 0) >= CROWN_WEEKLY_MIN_DAYS;
  }
  return integer(value.qualifyingWeeks, 0, 6, 0) >= CROWN_MONTHLY_MIN_WEEKS;
}

function crownCircuitAwardLabel(period, rank, participantCount) {
  const periodLabel = period === "daily" ? "日間"
    : period === "weekly" ? "週間"
      : "月間";
  if (participantCount < 2) return `${periodLabel} 開幕者`;
  if (rank === 1) return `${periodLabel} 王者`;
  if (rank <= 3) return `${periodLabel} 第${rank}席`;
  return `${periodLabel} 入賞 #${rank}`;
}

function crownCircuitAwardActiveUntil(period, endsAt) {
  if (period === "daily") return endsAt + (2 * 24 * 60 * 60 * 1000);
  if (period === "weekly") return endsAt + (7 * 24 * 60 * 60 * 1000);
  return endsAt + (31 * 24 * 60 * 60 * 1000);
}

function finalizedCrownCircuitEntry(period, source, {
  rank,
  participantCount,
  finalizedAt,
} = {}) {
  const starScore = rank ? crownStarScore(rank, participantCount) : 0;
  const tier = rank ? crownAwardTier(period, rank, participantCount) : "ineligible";
  if (period === "daily") {
    const signatureIds = new Set(normalizeSignatureIds(source.signatureIds));
    if (rank === 1 && participantCount >= 2) signatureIds.add("daily_champion");
    const run = normalizeCrownRun({
      ...source,
      status: "finalized",
      rank,
      participantCount,
      starScore,
      awardTier: tier,
      signatureIds: [...signatureIds],
      finalizedAt,
      updatedAt: finalizedAt,
    }, source);
    return { ...run, awardTier: tier };
  }
  return {
    ...source,
    status: "finalized",
    rank,
    participantCount,
    starScore,
    awardTier: tier,
    finalizedAt,
    updatedAt: finalizedAt,
  };
}

async function aggregateFinalizedCrownEntries(period, sourceKey, rankedEntries, now) {
  if (!rankedEntries.length || !["daily", "weekly"].includes(period)) return [];
  // A cross-month week belongs to the month in which that week closes.
  const sourceTimestamp = period === "daily"
    ? Date.parse(`${sourceKey}T12:00:00+09:00`)
    : periodEndsAt("weekly", sourceKey) - 1;
  const targetPeriod = period === "daily" ? "weekly" : "monthly";
  const targetKey = periodKey(targetPeriod, sourceTimestamp);
  if (!isCrownCircuitPeriod(targetPeriod, targetKey)) return [];
  const targetRefs = rankedEntries.map(({ uid }) => (
    crownCircuitPeriodEntryRef(uid, targetPeriod, targetKey)
  ));
  const currentSnapshots = await getCrownCircuitSnapshots(targetRefs);
  const aggregated = rankedEntries.map(({ uid, entry }, index) => {
    const current = currentSnapshots[index]?.data();
    const profile = {
      entryId: entry.entryId,
      name: entry.name,
      rating: entry.rating,
      commentsEnabled: entry.commentsEnabled !== false,
      crownTheme: entry.crownTheme,
      crownSignatureId: entry.crownSignatureId,
      xHandle: entry.xHandle,
      achievementShowcase: entry.achievementShowcase,
    };
    const aggregate = period === "daily"
      ? applyDailyStarToWeekly(current, {
        key: targetKey,
        dailyKey: sourceKey,
        starScore: entry.starScore,
        crownPower: entry.crownPower,
        profile,
        endsAt: periodEndsAt(targetPeriod, targetKey),
        now,
      })
      : applyWeeklyStarToMonthly(current, {
        key: targetKey,
        weeklyKey: sourceKey,
        starScore: entry.starScore,
        bestCrownPower: entry.bestCrownPower,
        profile,
        endsAt: periodEndsAt(targetPeriod, targetKey),
        now,
      });
    return { uid, entry: aggregate };
  });
  await commitCrownCircuitWrites([
    ...aggregated.map(({ uid, entry }) => ({
      ref: crownCircuitPeriodEntryRef(uid, targetPeriod, targetKey),
      data: entry,
    })),
    {
      ref: crownCircuitPeriodRef(targetPeriod, targetKey),
      data: {
        rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
        period: targetPeriod,
        key: targetKey,
        status: "open",
        endsAt: periodEndsAt(targetPeriod, targetKey),
        updatedAt: now,
      },
      options: { merge: true },
    },
  ]);
  await mirrorCrownCircuitEntries({
    ...Object.fromEntries(aggregated.map(({ uid, entry }) => [
      uid,
      { [`${targetPeriod}:${targetKey}`]: entry },
    ])),
  });
  return aggregated;
}

async function finalizeCrownCircuitPeriod(period, key, now = Date.now()) {
  if (!isCrownCircuitPeriod(period, key)) return { period, key, skipped: "cutover" };
  const endsAt = periodEndsAt(period, key);
  if (!endsAt || endsAt > now) return { period, key, skipped: "open" };
  const periodRef = crownCircuitPeriodRef(period, key);
  const periodSnapshot = await periodRef.get();
  if (periodSnapshot.exists && periodSnapshot.get("status") === "finalized") {
    return {
      period,
      key,
      skipped: "finalized",
      participantCount: Number(periodSnapshot.get("participantCount") || 0),
    };
  }
  const entriesSnapshot = await periodRef.collection("entries").get();
  const sources = entriesSnapshot.docs.map((snapshot) => ({
    uid: snapshot.id,
    ref: snapshot.ref,
    value: snapshot.data(),
  }));
  const ranked = sources
    .filter(({ value }) => crownCircuitEntryEligible(period, value))
    .sort((first, second) => (
      period === "daily"
        ? compareCrownRunEntries(first.value, second.value)
        : compareCrownCircuitEntries(first.value, second.value)
    ));
  const participantCount = ranked.length;
  const rankByUid = new Map(ranked.map(({ uid }, index) => [uid, index + 1]));
  const finalized = sources.map(({ uid, value }) => {
    const rank = rankByUid.get(uid) || 0;
    return {
      uid,
      entry: finalizedCrownCircuitEntry(period, value, {
        rank,
        participantCount,
        finalizedAt: now,
      }),
    };
  });
  const writes = [];
  finalized.forEach(({ uid, entry }) => {
    writes.push({
      ref: crownCircuitPeriodEntryRef(uid, period, key),
      data: entry,
    });
    if (period === "daily") {
      writes.push({
        ref: crownCircuitRunRef(uid, key),
        data: entry,
      });
    }
    if (!entry.rank) return;
    const tier = crownAwardTier(period, entry.rank, participantCount);
    writes.push({
      ref: serverRankingAwardRef(uid, period, key),
      data: {
        source: "crown-circuit",
        rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
        period,
        key,
        rank: entry.rank,
        matches: period === "daily"
          ? entry.matchCount
          : period === "weekly"
            ? entry.qualifyingDays
            : entry.qualifyingWeeks,
        participantCount,
        tier,
        label: crownCircuitAwardLabel(period, entry.rank, participantCount),
        starScore: entry.starScore,
        endsAt,
        activeUntil: crownCircuitAwardActiveUntil(period, endsAt),
        awardedAt: now,
      },
      options: { merge: true },
    });
  });
  writes.push({
    ref: periodRef,
    data: {
      rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
      period,
      key,
      status: "finalizing",
      participantCount,
      endsAt,
      updatedAt: now,
    },
    options: { merge: true },
  });
  await commitCrownCircuitWrites(writes);
  const rankedFinalized = ranked.map(({ uid }) => (
    finalized.find((candidate) => candidate.uid === uid)
  ));
  await aggregateFinalizedCrownEntries(period, key, rankedFinalized, now);
  await mirrorCrownCircuitEntries(Object.fromEntries(finalized.map(({ uid, entry }) => [
    uid,
    { [`${period}:${key}`]: entry },
  ])));

  const realtimeUpdates = {};
  rankedFinalized.forEach(({ entry }) => {
    const historicalEntry = { ...entry };
    delete historicalEntry.xHandle;
    realtimeUpdates[`online/crownCircuitSeatHistory/${period}/${key}/${entry.rank}`] = {
      ...publicCrownCircuitEntry(historicalEntry),
      entryId: entry.entryId,
      awardTier: entry.awardTier,
    };
  });
  const championRecord = rankedFinalized[0];
  const champion = championRecord?.entry;
  if (champion) {
    let spotlightSource = { ...champion };
    if (period === "daily") {
      const liveProfileSnapshot = await serverRankingProfileRef(championRecord.uid).get();
      const liveProfile = normalizeServerRankingProfile(
        liveProfileSnapshot.data(),
        liveProfileSnapshot.data(),
      );
      spotlightSource = {
        ...spotlightSource,
        name: liveProfile.name,
        crownTheme: liveProfile.crownTheme,
        commentsEnabled: liveProfile.commentsEnabled !== false,
      };
      if (liveProfile.enabled
          && liveProfile.entryId === champion.entryId
          && liveProfile.xHandle) {
        spotlightSource.xHandle = liveProfile.xHandle;
      } else {
        delete spotlightSource.xHandle;
      }
      if (liveProfile.crownSignatureId) {
        spotlightSource.crownSignatureId = liveProfile.crownSignatureId;
      } else {
        delete spotlightSource.crownSignatureId;
      }
      if (liveProfile.achievementShowcase) {
        spotlightSource.achievementShowcase = liveProfile.achievementShowcase;
      } else {
        delete spotlightSource.achievementShowcase;
      }
    }
    const spotlight = {
      ...publicCrownCircuitEntry(spotlightSource),
      entryId: champion.entryId,
      period,
      key,
      rank: 1,
      participantCount,
      startsAt: now,
      endsAt: now + (24 * 60 * 60 * 1000),
    };
    const historicalSpotlight = { ...spotlight };
    delete historicalSpotlight.xHandle;
    realtimeUpdates[`online/rankingSpotlights/history/${period}/${key}`] = historicalSpotlight;
    if (period === "daily") realtimeUpdates["online/rankingSpotlights/current"] = null;
    if (period === "daily"
        && participantCount >= CROWN_PROMOTION_MIN_PARTICIPANTS
        && Number(champion.uniqueOpponents || 0) >= 2
        && spotlightSource.xHandle) {
      realtimeUpdates["online/rankingSpotlights/current"] = spotlight;
    }
    if (period === "monthly" && participantCount >= 2) {
      realtimeUpdates[`online/crownCircuitHallOfFame/monthly/${key}`] = {
        ...historicalSpotlight,
        finalizedAt: now,
      };
    }
  }
  if (Object.keys(realtimeUpdates).length) await realtime.ref().update(realtimeUpdates);
  if (period === "daily" && championRecord) {
    const latestProfileSnapshot = await serverRankingProfileRef(championRecord.uid).get();
    await syncRankingSpotlightConsent(latestProfileSnapshot.data());
  }
  await periodRef.set({
    status: "finalized",
    participantCount,
    finalizedAt: now,
    updatedAt: now,
  }, { merge: true });
  return { period, key, finalized: true, participantCount };
}

async function finalizeClosedCrownCircuitPeriods(now = Date.now()) {
  const closedTimestamp = now - (10 * 60 * 1000);
  const dayMs = 24 * 60 * 60 * 1000;
  // Bounded catch-up protects awards after a short scheduler/deployment outage.
  // Oldest periods run first so their stars exist before week/month closure.
  const dailyKeys = [...new Set(Array.from(
    { length: 8 },
    (_, index) => periodKey("daily", closedTimestamp - (index * dayMs)),
  ))].sort();
  const weeklyKeys = [...new Set(Array.from(
    { length: 4 },
    (_, index) => periodKey("weekly", closedTimestamp - (index * 7 * dayMs)),
  ))].sort();
  const monthlyKeys = [];
  let monthlyKey = periodKey("monthly", closedTimestamp);
  while (monthlyKey && monthlyKeys.length < 4) {
    monthlyKeys.push(monthlyKey);
    monthlyKey = previousMonthlyPeriodKey(monthlyKey);
  }
  monthlyKeys.sort();
  const results = [];
  for (const key of dailyKeys) {
    results.push(await finalizeCrownCircuitPeriod("daily", key, now));
  }
  for (const key of weeklyKeys) {
    results.push(await finalizeCrownCircuitPeriod("weekly", key, now));
  }
  for (const key of monthlyKeys) {
    results.push(await finalizeCrownCircuitPeriod("monthly", key, now));
  }
  return results;
}

exports.finalizeCrownCircuit = onSchedule({
  schedule: "every day 00:05",
  timeZone: "Asia/Tokyo",
  timeoutSeconds: 540,
  memory: "512MiB",
  maxInstances: 1,
}, async () => {
  const now = Date.now();
  try {
    const results = await finalizeClosedCrownCircuitPeriods(now);
    console.info("finalizeCrownCircuit completed", { results });
    return results;
  } catch (error) {
    console.error("finalizeCrownCircuit failed", {
      code: typeof error?.code === "string" ? error.code : "unknown",
    });
    throw error;
  }
});

exports.cleanupOnlinePublicPresence = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "Asia/Tokyo",
  timeoutSeconds: 60,
  memory: "256MiB",
  maxInstances: 1,
}, async () => {
  try {
    const result = await cleanupOnlinePublicPresence(Date.now());
    console.info("cleanupOnlinePublicPresence completed", result);
    return result;
  } catch (error) {
    console.error("cleanupOnlinePublicPresence failed", {
      code: typeof error?.code === "string" ? error.code : "unknown",
    });
    throw error;
  }
});

exports.cleanupTrainingRooms = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "Asia/Tokyo",
  timeoutSeconds: 120,
  memory: "256MiB",
  maxInstances: 1,
}, async () => {
  try {
    const now = Date.now();
    const [rooms, queue] = await Promise.all([
      cleanupTrainingRooms(now),
      cleanupTrainingQueue(now),
    ]);
    const result = { rooms, queue };
    console.info("cleanupTrainingRooms completed", result);
    return result;
  } catch (error) {
    console.error("cleanupTrainingRooms failed", {
      code: typeof error?.code === "string" ? error.code : "unknown",
    });
    throw error;
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
  const seasonKey = periodKey("monthly", now);
  const monthlyStatsReference = marketMonthlyStatsRef(uid, seasonKey);
  const publicProfile = {
    xHandle: xPublic ? xHandle : "",
    tagline: taglinePublic ? tagline : "",
    updatedAt: now,
  };
  let savedProfile = sanitizeStoredMarketPublicProfile(publicProfile);
  let savedAt = now;
  await firestore.runTransaction(async (transaction) => {
    const [snapshot, monthlySnapshot] = await Promise.all([
      transaction.get(statsRef),
      transaction.get(monthlyStatsReference),
    ]);
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
    if (monthlySnapshot.exists) {
      transaction.set(monthlyStatsReference, { publicProfile }, { merge: true });
    }
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

function previousMonthlyPeriodKey(seasonKey) {
  if (!/^\d{4}-\d{2}$/.test(String(seasonKey || ""))) return "";
  const [year, month] = seasonKey.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return previous.toISOString().slice(0, 7);
}

async function finalizeMarketRankingAward({ uid, seasonKey, role, rank }) {
  const honorRef = marketRankingHonorRef(uid);
  const awardRef = marketRankingAwardRef(uid, seasonKey, role);
  await firestore.runTransaction(async (transaction) => {
    const [honorSnapshot, awardSnapshot] = await Promise.all([
      transaction.get(honorRef),
      transaction.get(awardRef),
    ]);
    if (awardSnapshot.exists) return;
    const applied = applyMarketRankingHonor(honorSnapshot.data(), {
      uid,
      role,
      seasonKey,
      rank,
      now: Date.now(),
    });
    transaction.set(honorRef, applied.honors);
    transaction.create(awardRef, {
      schemaVersion: 1,
      uid,
      seasonKey,
      role,
      rank: applied.award.rank,
      awardId: applied.award.id,
      awardLabel: applied.award.label,
      honorLevelAfter: applied.honors[role].level,
      awardedAt: Date.now(),
      payReward: 0,
    });
  });
}

function monthlyPeriodKeys(startSeasonKey, endSeasonKey) {
  if (!/^\d{4}-\d{2}$/.test(String(startSeasonKey || ""))
      || !/^\d{4}-\d{2}$/.test(String(endSeasonKey || ""))
      || startSeasonKey > endSeasonKey) {
    return [];
  }
  const keys = [];
  let [year, month] = startSeasonKey.split("-").map(Number);
  while (keys.length < 120) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    if (key > endSeasonKey) break;
    keys.push(key);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return keys;
}

async function finalizeMarketRankingMonth(seasonKey) {
  if (!seasonKey || seasonKey < MARKET_MONTHLY_RANKING_START_KEY) return false;
  const periodRef = firestore.collection("valueMarketMonthlyPeriods").doc(seasonKey);
  const periodSnapshot = await periodRef.get();
  if (periodSnapshot.get("honorsFinalized") === true) return false;
  const entries = periodRef.collection("entries");
  const [sellerSnapshot, buyerSnapshot] = await Promise.all([
    entries.orderBy("grossSales", "desc").limit(10).get(),
    entries.orderBy("spent", "desc").limit(10).get(),
  ]);
  const awards = [];
  for (const [role, snapshot, field] of [
    ["seller", sellerSnapshot, "grossSales"],
    ["buyer", buyerSnapshot, "spent"],
  ]) {
    snapshot.docs
      .filter((entry) => Number(entry.get(field) || 0) > 0)
      .forEach((entry, index) => {
        awards.push(finalizeMarketRankingAward({
          uid: entry.id,
          seasonKey,
          role,
          rank: index + 1,
        }));
      });
  }
  await Promise.all(awards);
  await periodRef.set({
    schemaVersion: 1,
    seasonKey,
    honorsFinalized: true,
    honorsFinalizedAt: Date.now(),
    honorAwardCount: awards.length,
  }, { merge: true });
  return true;
}

async function finalizeClosedMarketRankingMonths(currentSeasonKey) {
  const latestClosedSeasonKey = previousMonthlyPeriodKey(currentSeasonKey);
  const keys = monthlyPeriodKeys(
    MARKET_MONTHLY_RANKING_START_KEY,
    latestClosedSeasonKey,
  );
  const finalized = [];
  for (const seasonKey of keys) {
    if (await finalizeMarketRankingMonth(seasonKey)) finalized.push(seasonKey);
  }
  return {
    latestClosedSeasonKey,
    finalizedSeasonKeys: finalized,
  };
}

function publicMarketCertificate(snapshot) {
  const value = snapshot.data();
  const sellerShop = publicSellerShop(value?.sellerShop);
  const marketFee = integer(value?.marketFee, 1, MAX_POINTS, 1);
  const patronFundSubsidy = Math.min(
    Math.floor(marketFee / 2),
    PATRON_FUND_MAX_SUBSIDY_PER_SALE,
    marketFee - 1,
    integer(value?.patronFundSubsidy, 0, PATRON_FUND_MAX_SUBSIDY_PER_SALE, 0),
  );
  const patronFundKind = ["discovery", "trust"].includes(value?.patronFundKind)
    ? value.patronFundKind
    : "";
  return {
    certificateNumber: cleanText(value?.certificateNumber, 24),
    listingTitle: cleanText(value?.listingTitle, 30, "無題の推し"),
    sellerName: cleanName(value?.sellerName),
    ...(sellerShop ? { sellerShop } : {}),
    sellerIssueNumber: integer(value?.sellerIssueNumber, 0, 1_000_000, 0),
    purchasePrice: integer(value?.paidAmount ?? value?.purchasePrice, 1, MAX_POINTS, 1),
    claimAmount: integer(
      value?.claimAmount ?? value?.purchasePrice,
      1,
      MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
      1,
    ),
    paidAmount: integer(value?.paidAmount ?? value?.purchasePrice, 1, MAX_POINTS, 1),
    allIn: value?.allIn === true,
    rankingContribution: integer(
      value?.rankingContribution,
      0,
      MARKET_RANKING_CONTRIBUTION_CAP,
      value?.rankingCounted === true
        ? marketRankingContribution(value?.paidAmount ?? value?.purchasePrice)
        : 0,
    ),
    marketFee,
    effectiveMarketFee: marketFee - patronFundSubsidy,
    patronFundSubsidy,
    patronFundPolicy: normalizeMarketPolicyId(value?.patronFundPolicy),
    patronFundKind,
    sellerProceeds: integer(value?.sellerProceeds, 0, MAX_POINTS, 0),
    closingMode: marketClosingAuditMode(value?.closingMode),
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
  const rankingPeriod = cleanText(request.data?.period, 16, "monthly") || "monthly";
  if (!["monthly", "lifetime"].includes(rankingPeriod)) {
    throw new HttpsError("invalid-argument", "ランキング期間は月間または累計を選択してください。");
  }
  const achievementState = await ensureAchievementState(uid);
  await syncAchievementPublicSurfaces(uid, achievementState.profile);
  const currentSeasonKey = periodKey("monthly");
  const finalization = await finalizeClosedMarketRankingMonths(currentSeasonKey);
  const rankingCollection = rankingPeriod === "lifetime"
    ? firestore.collection("valueMarketStats")
    : currentSeasonKey >= MARKET_MONTHLY_RANKING_START_KEY
      ? firestore.collection("valueMarketMonthlyPeriods")
        .doc(currentSeasonKey)
        .collection("entries")
      : null;
  const emptySnapshot = Object.freeze({ docs: [] });
  const [sellerSnapshot, buyerSnapshot, viewerSnapshot, viewerHonorSnapshot] = await Promise.all([
    rankingCollection
      ? rankingCollection.orderBy("grossSales", "desc").limit(20).get()
      : Promise.resolve(emptySnapshot),
    rankingCollection
      ? rankingCollection.orderBy("spent", "desc").limit(20).get()
      : Promise.resolve(emptySnapshot),
    marketStatsRef(uid).get(),
    marketRankingHonorRef(uid).get(),
  ]);
  const viewerStats = viewerSnapshot.exists ? viewerSnapshot.data() : null;
  const viewerHonors = publicMarketRankingHonors(viewerHonorSnapshot.data(), uid);
  return {
    period: rankingPeriod,
    periodKey: rankingPeriod === "monthly" ? currentSeasonKey : "lifetime",
    availablePeriods: ["monthly", "lifetime"],
    monthlyStartKey: MARKET_MONTHLY_RANKING_START_KEY,
    finalizedSeasonKey: finalization.latestClosedSeasonKey,
    finalizedSeasonKeys: finalization.finalizedSeasonKeys,
    rankingContributionCap: MARKET_RANKING_CONTRIBUTION_CAP,
    sellers: sellerSnapshot.docs.map((snapshot) => rankingRow(snapshot, "seller", uid)).filter((entry) => entry.primary > 0),
    buyers: buyerSnapshot.docs.map((snapshot) => rankingRow(snapshot, "buyer", uid)).filter((entry) => entry.primary > 0),
    viewerProfile: sanitizeStoredMarketPublicProfile(viewerStats?.publicProfile),
    viewerEligible: hasRankedMarketStats(viewerStats),
    viewerName: viewerStats ? cleanName(viewerStats.name) : "",
    monthlyAchievements: viewerHonors,
    viewerHonors,
    updatedAt: Date.now(),
  };
});
