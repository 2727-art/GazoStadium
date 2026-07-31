"use strict";

const {
  AI_TEXT_TRAINING_MODES,
  AI_TEXT_TRAINING_PLAY_STYLES,
  AI_TEXT_TRAINING_PRICE_OPTIONS,
  AI_TEXT_TRAINING_PRODUCT_TYPES,
  AI_TEXT_TRAINING_PUBLISH_FEE,
  AI_TEXT_TRAINING_SCHEMA_VERSION,
  AI_TEXT_TRAINING_STYLE_PRODUCT_IDS,
  AI_TEXT_TRAINING_SUCCESS_FEE_BASIS_POINTS,
  aiTextTrainingActionDocumentId,
  aiTextTrainingJstDateKey,
  aiTextTrainingJstMonthKey,
  aiTextTrainingMonthlyBuyerPairId,
  aiTextTrainingPayloadHash,
  aiTextTrainingPresetId,
  aiTextTrainingPresetRevisionBuyerId,
  aiTextTrainingPublicSellerId,
  aiTextTrainingRankingPairId,
  aiTextTrainingReportId,
  aiTextTrainingSaleSettlement,
  aiTextTrainingSellerBuyerPairId,
  aiTextTrainingUseId,
  isAiTextTrainingReportReason,
  normalizeAiTextTrainingActionId,
  normalizeAiTextTrainingCosmetics,
  normalizeAiTextTrainingDocumentId,
  normalizeAiTextTrainingMode,
  normalizeAiTextTrainingPlayStyle,
  normalizeAiTextTrainingPresetInput,
  normalizeAiTextTrainingProductType,
  normalizeAiTextTrainingXHandle,
} = require("./ai-text-training");
const {
  eligibleAchievementIds,
  normalizeAiTextTrainingStats,
  unlockAchievements,
} = require("./achievements");

const AI_TEXT_TRAINING_ACTIONS = Object.freeze([
  "state",
  "browse",
  "publish",
  "unpublish",
  "start_paid_use",
  "resume_use",
  "finish_use",
  "begin_achievement_session",
  "finish_achievement_session",
  "save_profile",
  "save_cosmetics",
  "rankings",
  "report",
]);
const REQUIRED_DEPENDENCIES = Object.freeze([
  "firestore",
  "HttpsError",
  "ensureWallet",
  "walletRef",
  "anjuPayLedgerConfigRef",
  "walletData",
  "walletCreditCapacity",
  "debitPoints",
  "creditPoints",
  "stageAnjuPayOpening",
  "appendAnjuPayEntry",
  "anjuPayWalletMetadataPatch",
  "anjuPayEntryId",
  "mirrorWallet",
  "bestEffort",
  "syncAchievementPublicSurfaces",
  "ownedProductIds",
]);
const PRIVATE_RESPONSE_FIELDS = Object.freeze(new Set([
  "uid",
  "sellerUid",
  "buyerUid",
  "reporterUid",
  "actionId",
  "payloadHash",
]));
const ACTIVE_PRESET_LIMIT = 100;
// Legacy standard products have no productType field, so their compatibility
// lookup may need to page past newer ZONE products. Keep that fallback bounded
// to at most 500 documents per request until legacy rows are backfilled.
const LEGACY_STANDARD_BROWSE_MAX_PAGES = 5;
const RANKING_LIMIT = 20;
const ACTIVE_USE_STATUSES = Object.freeze(new Set(["active"]));
const AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT = 5;
const AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_SECONDS = Object.freeze([
  15,
  20,
  30,
  45,
  60,
]);
const AI_TEXT_TRAINING_ACHIEVEMENT_ACTIVE_SECONDS_TOLERANCE = 1;
const AI_TEXT_TRAINING_ACHIEVEMENT_BEGIN_COOLDOWN_MS = 30 * 1_000;
const AI_TEXT_TRAINING_ACHIEVEMENT_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const FINISH_OUTCOMES = Object.freeze(new Set([
  "completed",
  "safety_stopped",
  "exited",
]));
const HIGH_RISK_REPORT_REASONS = Object.freeze(new Set([
  "dangerous",
  "sexual",
  "privacy",
]));
const VERIFIED_BUYER_QUARANTINE_THRESHOLD = 3;

function createAiTextTrainingService(deps) {
  if (!deps || typeof deps !== "object") {
    throw new TypeError("AI text training service dependencies are required.");
  }
  for (const name of REQUIRED_DEPENDENCIES) {
    if (deps[name] == null) {
      throw new TypeError(`Missing AI text training service dependency: ${name}`);
    }
  }

  const {
    firestore,
    HttpsError,
    ensureWallet,
    walletRef,
    anjuPayLedgerConfigRef,
    walletData,
    debitPoints,
    creditPoints,
    stageAnjuPayOpening,
    appendAnjuPayEntry,
    anjuPayWalletMetadataPatch,
    anjuPayEntryId,
    mirrorWallet,
    bestEffort,
    syncAchievementPublicSurfaces,
    ownedProductIds,
  } = deps;
  const currentTime = typeof deps.now === "function" ? deps.now : Date.now;

  if (typeof firestore.collection !== "function"
      || typeof firestore.runTransaction !== "function") {
    throw new TypeError("AI text training service storage dependencies are invalid.");
  }

  const presetsCollection = () => firestore.collection("aiTextTrainingPresets");
  const presetRef = (presetId) => presetsCollection().doc(presetId);
  const presetRevisionRef = (presetId, revision) => presetRef(presetId)
    .collection("revisions")
    .doc(String(revision).padStart(8, "0"));
  const profileRef = (uid) => firestore.collection("aiTextTrainingSellerProfiles").doc(uid);
  const preferencesRef = (uid) => firestore.collection("aiTextTrainingPreferences").doc(uid);
  const useRef = (useId) => firestore.collection("aiTextTrainingUses").doc(useId);
  const activeUseRef = (uid) => firestore.collection("aiTextTrainingActiveUses").doc(uid);
  const achievementSessionRef = (sessionId) => firestore
    .collection("aiTextTrainingAchievementSessions")
    .doc(sessionId);
  const activeAchievementSessionRef = (uid) => firestore
    .collection("aiTextTrainingActiveAchievementSessions")
    .doc(uid);
  const playerStatsRef = (uid) => firestore.collection("aiTextTrainingPlayerStats").doc(uid);
  const achievementProfileRef = (uid) => firestore.collection("achievementProfiles").doc(uid);
  const publishActionRef = (uid, actionId) => firestore
    .collection("aiTextTrainingPublishActions")
    .doc(aiTextTrainingActionDocumentId(uid, actionId, "publish"));
  const sellerStatsRef = (uid) => firestore.collection("aiTextTrainingSellerStats").doc(uid);
  const monthlyEntryRef = (periodKey, uid) => firestore
    .collection("aiTextTrainingMonthlyPeriods")
    .doc(periodKey)
    .collection("entries")
    .doc(uid);
  const rankingPairRef = (dateKey, sellerUid, buyerUid) => firestore
    .collection("aiTextTrainingRankingPairs")
    .doc(aiTextTrainingRankingPairId(dateKey, sellerUid, buyerUid));
  const sellerBuyerPairRef = (sellerUid, buyerUid) => firestore
    .collection("aiTextTrainingSellerBuyerPairs")
    .doc(aiTextTrainingSellerBuyerPairId(sellerUid, buyerUid));
  const presetRevisionBuyerRef = (presetId, revision, buyerUid) => firestore
    .collection("aiTextTrainingPresetRevisionBuyers")
    .doc(aiTextTrainingPresetRevisionBuyerId(presetId, revision, buyerUid));
  const monthlyBuyerPairRef = (periodKey, sellerUid, buyerUid) => firestore
    .collection("aiTextTrainingMonthlyBuyerPairs")
    .doc(aiTextTrainingMonthlyBuyerPairId(periodKey, sellerUid, buyerUid));
  const reportRef = (presetId, revision, reporterUid) => firestore
    .collection("aiTextTrainingReports")
    .doc(aiTextTrainingReportId(presetId, revision, reporterUid));

  function httpsError(code, message) {
    return new HttpsError(code, message);
  }

  function mapHelperError(error) {
    if (error instanceof HttpsError) return error;
    if (error instanceof RangeError) {
      return httpsError("invalid-argument", error.message || "入力内容を確認してください。");
    }
    return error;
  }

  function requireUid(uid) {
    if (typeof uid !== "string"
        || !uid
        || uid.length > 128
        || /[\u0000-\u001f\u007f-\u009f]/u.test(uid)) {
      throw httpsError("unauthenticated", "匿名ログインが必要です。");
    }
    return uid;
  }

  function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback = minimum) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
  }

  function safeOneLine(value, maximumLength, fallback = "") {
    if (typeof value !== "string") return fallback;
    const normalized = value.normalize("NFKC").trim();
    if (!normalized
        || normalized.length > maximumLength
        || /[\r\n\u2028\u2029\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
      return fallback;
    }
    return normalized;
  }

  function normalizeStoredLines(value) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
    return Object.fromEntries(Object.entries(source).map(([slotId, lines]) => [
      safeOneLine(slotId, 40),
      Array.isArray(lines)
        ? lines.map((line) => safeOneLine(line, 42)).filter(Boolean).slice(0, 4)
        : [],
    ]));
  }

  function storedProductType(value) {
    return AI_TEXT_TRAINING_PRODUCT_TYPES.includes(value) ? value : "standard";
  }

  function storedPlayStyle(value) {
    return AI_TEXT_TRAINING_PLAY_STYLES.includes(value) ? value : "standard";
  }

  function publicPreset(value, viewerUid = "") {
    const source = value && typeof value === "object" ? value : {};
    const productType = storedProductType(source.productType);
    return {
      id: safeOneLine(source.id, 40),
      schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
      publicSellerId: safeOneLine(source.publicSellerId, 40),
      sellerName: safeOneLine(source.sellerName, 16, "匿名作者"),
      modeId: AI_TEXT_TRAINING_MODES.includes(source.modeId) ? source.modeId : "mama",
      productType,
      title: safeOneLine(source.title, 30, "応援台本"),
      description: String(source.description || "").slice(0, 120),
      price: AI_TEXT_TRAINING_PRICE_OPTIONS.includes(source.price) ? source.price : 5,
      revision: safeInteger(source.revision, 1, 1_000_000, 1),
      lines: normalizeStoredLines(source.lines),
      zoneLines: productType === "defeat_zone"
        ? normalizeStoredLines(source.zoneLines)
        : {},
      status: ["active", "hidden"].includes(source.status) ? source.status : "hidden",
      actualUseCount: safeInteger(source.actualUseCount),
      rankingUseCount: safeInteger(source.rankingUseCount),
      createdAt: safeInteger(source.createdAt),
      updatedAt: safeInteger(source.updatedAt),
      isOwn: Boolean(viewerUid && source.sellerUid === viewerUid),
    };
  }

  function publicProfile(value) {
    const source = value && typeof value === "object" ? value : {};
    const xPublic = source.xPublic === true;
    const xHandle = safeOneLine(source.xHandle, 15);
    return {
      xPublic: xPublic && /^[A-Za-z0-9_]{1,15}$/.test(xHandle),
      xHandle: xPublic && /^[A-Za-z0-9_]{1,15}$/.test(xHandle) ? xHandle : "",
      updatedAt: safeInteger(source.updatedAt),
    };
  }

  function publicCosmetics(value, ownedProductIdsValue = []) {
    const source = value && typeof value === "object" ? value : {};
    const owned = ownedProductIdsValue instanceof Set
      ? ownedProductIdsValue
      : new Set(Array.isArray(ownedProductIdsValue) ? ownedProductIdsValue : []);
    const ownedStyleIds = AI_TEXT_TRAINING_STYLE_PRODUCT_IDS.filter((id) => owned.has(id));
    const allowed = new Set(ownedStyleIds);
    const panelThemeId = allowed.has(source.panelThemeId) ? source.panelThemeId : "";
    const messageDecorationId = allowed.has(source.messageDecorationId)
      ? source.messageDecorationId
      : "";
    return {
      panelThemeId,
      messageDecorationId,
      ownedStyleIds,
    };
  }

  function publicUse(value) {
    const source = value && typeof value === "object" ? value : {};
    const snapshot = source.presetSnapshot && typeof source.presetSnapshot === "object"
      ? source.presetSnapshot
      : {};
    return {
      id: safeOneLine(source.id, 40),
      status: ["active", "completed", "safety_stopped", "exited"].includes(source.status)
        ? source.status
        : "active",
      outcome: FINISH_OUTCOMES.has(source.outcome) ? source.outcome : "",
      price: safeInteger(source.price),
      fee: safeInteger(source.fee),
      sellerProceeds: safeInteger(source.sellerProceeds),
      buyerBalanceAfter: safeInteger(source.buyerBalanceAfter),
      rankingCounted: source.rankingCounted === true,
      playStyle: storedPlayStyle(source.playStyle),
      startedAt: safeInteger(source.startedAt),
      endedAt: safeInteger(source.endedAt),
      preset: {
        id: safeOneLine(snapshot.id, 40),
        publicSellerId: safeOneLine(snapshot.publicSellerId, 40),
        authorName: safeOneLine(snapshot.sellerName, 16, "匿名作者"),
        title: safeOneLine(snapshot.title, 30, "応援台本"),
        description: String(snapshot.description || "").slice(0, 120),
        modeId: AI_TEXT_TRAINING_MODES.includes(snapshot.modeId)
          ? snapshot.modeId
          : "mama",
        productType: storedProductType(snapshot.productType),
        revision: safeInteger(snapshot.revision, 1, 1_000_000, 1),
        price: safeInteger(snapshot.price),
        lines: normalizeStoredLines(snapshot.lines),
        zoneLines: storedProductType(snapshot.productType) === "defeat_zone"
          ? normalizeStoredLines(snapshot.zoneLines)
          : {},
      },
    };
  }

  function presetModerationPayload(value) {
    const source = value && typeof value === "object" ? value : {};
    const productType = storedProductType(source.productType);
    return {
      modeId: AI_TEXT_TRAINING_MODES.includes(source.modeId) ? source.modeId : "mama",
      productType,
      lines: normalizeStoredLines(source.lines),
      zoneLines: productType === "defeat_zone"
        ? normalizeStoredLines(source.zoneLines)
        : {},
    };
  }

  function publicAchievementSession(value) {
    const source = value && typeof value === "object" ? value : {};
    const roundSeconds = AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_SECONDS.includes(
      source.roundSeconds,
    )
      ? source.roundSeconds
      : 20;
    const roundCount = source.roundCount === AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT
      ? source.roundCount
      : AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT;
    const expectedActiveSeconds = roundSeconds * roundCount;
    return {
      id: safeOneLine(source.id, 40),
      modeId: AI_TEXT_TRAINING_MODES.includes(source.modeId) ? source.modeId : "mama",
      roundSeconds,
      roundCount,
      expectedActiveSeconds,
      status: ["active", "completed", "safety_stopped", "exited"].includes(source.status)
        ? source.status
        : "active",
      outcome: FINISH_OUTCOMES.has(source.outcome) ? source.outcome : "",
      completedRounds: safeInteger(
        source.completedRounds,
        0,
        AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT,
      ),
      activeSeconds: Math.max(
        0,
        Math.min(
          expectedActiveSeconds,
          Number.isFinite(Number(source.activeSeconds))
            ? Number(source.activeSeconds)
            : 0,
        ),
      ),
      startedAt: safeInteger(source.startedAt),
      endedAt: safeInteger(source.endedAt),
    };
  }

  function publicPlayerStats(value) {
    const source = value && typeof value === "object" ? value : {};
    const normalized = normalizeAiTextTrainingStats(value);
    return {
      completedSessions: safeInteger(normalized.completedSessions),
      completionDays: safeInteger(normalized.completionDays),
      lastCompletionDateKey: /^\d{4}-\d{2}-\d{2}$/u.test(
        String(source.lastCompletionDateKey || ""),
      )
        ? String(source.lastCompletionDateKey)
        : "",
    };
  }

  function achievementSessionDeleteAt(startedAt, fallbackNow) {
    const fallback = safeInteger(fallbackNow);
    const started = safeInteger(
      startedAt,
      0,
      Number.MAX_SAFE_INTEGER - AI_TEXT_TRAINING_ACHIEVEMENT_SESSION_TTL_MS,
      fallback,
    );
    return new Date(started + AI_TEXT_TRAINING_ACHIEVEMENT_SESSION_TTL_MS);
  }

  function publicPolicy() {
    return {
      prices: [...AI_TEXT_TRAINING_PRICE_OPTIONS],
      productTypes: [...AI_TEXT_TRAINING_PRODUCT_TYPES],
      playStyles: [...AI_TEXT_TRAINING_PLAY_STYLES],
      publishFee: AI_TEXT_TRAINING_PUBLISH_FEE,
      successFeeBasisPoints: AI_TEXT_TRAINING_SUCCESS_FEE_BASIS_POINTS,
      minimumSuccessFee: 1,
      rankingPairDailyLimit: 1,
      oneActivePaidUseAtATime: true,
      verifiedBuyerQuarantineThreshold: VERIFIED_BUYER_QUARANTINE_THRESHOLD,
    };
  }

  function assertNoPrivateFields(value, path = "response") {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_RESPONSE_FIELDS.has(key)) {
        throw new Error(`Private AI text training field leaked at ${path}.${key}`);
      }
      assertNoPrivateFields(child, `${path}.${key}`);
    }
  }

  function defaultStats(uid, preset) {
    return {
      schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
      sellerUid: uid,
      publicSellerId: aiTextTrainingPublicSellerId(uid),
      sellerName: safeOneLine(preset?.sellerName, 16, "匿名作者"),
      rankingGross: 0,
      actualGross: 0,
      netSales: 0,
      feesPaid: 0,
      useCount: 0,
      rankingUseCount: 0,
      uniqueBuyers: 0,
      updatedAt: 0,
    };
  }

  function normalizedStats(value, uid, preset) {
    const fallback = defaultStats(uid, preset);
    const source = value && typeof value === "object" ? value : {};
    return {
      ...fallback,
      sellerName: safeOneLine(
        preset?.sellerName || source.sellerName,
        16,
        fallback.sellerName,
      ),
      rankingGross: safeInteger(source.rankingGross),
      actualGross: safeInteger(source.actualGross),
      netSales: safeInteger(source.netSales),
      feesPaid: safeInteger(source.feesPaid),
      useCount: safeInteger(source.useCount),
      rankingUseCount: safeInteger(source.rankingUseCount),
      uniqueBuyers: safeInteger(source.uniqueBuyers),
      updatedAt: safeInteger(source.updatedAt),
    };
  }

  function addSaleToStats(current, {
    settlement,
    rankingCounted,
    uniqueBuyer,
    now,
  }) {
    return {
      ...current,
      rankingGross: current.rankingGross + (rankingCounted ? settlement.price : 0),
      actualGross: current.actualGross + settlement.price,
      netSales: current.netSales + settlement.sellerProceeds,
      feesPaid: current.feesPaid + settlement.fee,
      useCount: current.useCount + 1,
      rankingUseCount: current.rankingUseCount + (rankingCounted ? 1 : 0),
      uniqueBuyers: current.uniqueBuyers + (uniqueBuyer ? 1 : 0),
      updatedAt: now,
    };
  }

  async function mirrorBalances(values) {
    const operations = Object.entries(values)
      .filter(([, balance]) => Number.isSafeInteger(balance))
      .map(([uid, balance]) => mirrorWallet(uid, balance));
    if (operations.length) await bestEffort("ai-text-training-wallet-mirror", operations);
  }

  async function bestEffortAchievementSync(label, uid, profile) {
    if (!profile) return;
    await bestEffort(label, [
      Promise.resolve().then(() => syncAchievementPublicSurfaces(uid, profile)),
    ]);
  }

  async function readActiveUse(uid) {
    const activeSnapshot = await activeUseRef(uid).get();
    if (!activeSnapshot.exists) return null;
    const activeUseId = safeOneLine(activeSnapshot.get("useId"), 40);
    if (!/^[a-f0-9]{40}$/.test(activeUseId)) return null;
    const snapshot = await useRef(activeUseId).get();
    if (!snapshot.exists || snapshot.get("buyerUid") !== uid) return null;
    const value = snapshot.data();
    return ACTIVE_USE_STATUSES.has(value?.status) ? publicUse(value) : null;
  }

  async function getBrowsePresets(uid, modeId = "", productType = "") {
    const requestedMode = modeId ? normalizeAiTextTrainingMode(modeId) : "";
    const requestedProductType = productType
      ? normalizeAiTextTrainingProductType(productType)
      : "";
    let query = presetsCollection().where("status", "==", "active");
    if (requestedMode) {
      query = query.where("modeId", "==", requestedMode);
    }
    if (requestedProductType === "defeat_zone") {
      query = query.where("productType", "==", requestedProductType);
    }
    if (requestedMode || requestedProductType) {
      query = query.orderBy("actualUseCount", "desc");
    }
    let documents = [];
    if (requestedProductType === "standard") {
      // Legacy standard products have no productType field. Walk the already
      // ordered result until we have the true top standard rows instead of
      // letting popular ZONE products crowd them out of the first page. The
      // compatibility walk is deliberately bounded by the constant above.
      let cursor = null;
      let pageCount = 0;
      while (documents.length < ACTIVE_PRESET_LIMIT
          && pageCount < LEGACY_STANDARD_BROWSE_MAX_PAGES) {
        let pageQuery = query.limit(ACTIVE_PRESET_LIMIT);
        if (cursor) pageQuery = pageQuery.startAfter(cursor);
        const page = await pageQuery.get();
        pageCount += 1;
        for (const document of page.docs) {
          if (storedProductType(document.get("productType")) === "standard") {
            documents.push(document);
            if (documents.length >= ACTIVE_PRESET_LIMIT) break;
          }
        }
        if (page.docs.length < ACTIVE_PRESET_LIMIT) break;
        cursor = page.docs.at(-1);
      }
    } else {
      const snapshot = await query.limit(ACTIVE_PRESET_LIMIT).get();
      documents = snapshot.docs;
    }
    return documents
      .map((document) => publicPreset({ id: document.id, ...document.data() }, uid))
      .filter((preset) => !requestedMode || preset.modeId === requestedMode)
      .filter((preset) => (
        !requestedProductType || preset.productType === requestedProductType
      ))
      .sort((left, right) => (
        right.actualUseCount - left.actualUseCount
        || right.updatedAt - left.updatedAt
        || left.id.localeCompare(right.id)
      ));
  }

  async function getState(uid, data = {}) {
    requireUid(uid);
    await ensureWallet(uid);
    const [
      walletSnapshot,
      ownSnapshot,
      profileSnapshot,
      preferencesSnapshot,
      ownedProductIdsValue,
      presets,
      activeUse,
    ] = await Promise.all([
      walletRef(uid).get(),
      presetsCollection().where("sellerUid", "==", uid).limit(6).get(),
      profileRef(uid).get(),
      preferencesRef(uid).get(),
      ownedProductIds(uid),
      getBrowsePresets(uid, data.modeId || "", data.productType || ""),
      readActiveUse(uid),
    ]);
    return {
      policy: publicPolicy(),
      balance: safeInteger(walletSnapshot.get("balance")),
      presets,
      ownPresets: ownSnapshot.docs
        .map((document) => publicPreset({ id: document.id, ...document.data() }, uid))
        .sort((left, right) => (
          left.modeId.localeCompare(right.modeId)
          || left.productType.localeCompare(right.productType)
        )),
      profile: publicProfile(profileSnapshot.data()),
      cosmetics: publicCosmetics(preferencesSnapshot.data(), ownedProductIdsValue),
      activeUse,
      serverNow: currentTime(),
    };
  }

  async function browse(uid, data = {}) {
    requireUid(uid);
    return {
      presets: await getBrowsePresets(uid, data.modeId || "", data.productType || ""),
      serverNow: currentTime(),
    };
  }

  async function saveCosmetics(uid, data) {
    requireUid(uid);
    const allowedKeys = new Set(["action", "panelThemeId", "messageDecorationId"]);
    if (!data || typeof data !== "object" || Array.isArray(data)
        || Reflect.ownKeys(data).some((key) => !allowedKeys.has(key))) {
      throw httpsError("invalid-argument", "トレーニング演出を選び直してください。");
    }
    let selected;
    try {
      selected = normalizeAiTextTrainingCosmetics(data);
    } catch (error) {
      throw mapHelperError(error);
    }
    const ownedProductIdsValue = await ownedProductIds(uid);
    const owned = ownedProductIdsValue instanceof Set
      ? ownedProductIdsValue
      : new Set(Array.isArray(ownedProductIdsValue) ? ownedProductIdsValue : []);
    for (const productId of [selected.panelThemeId, selected.messageDecorationId]) {
      if (productId && !owned.has(productId)) {
        throw httpsError(
          "failed-precondition",
          "未購入の演出は試着できますが、装着はできません。",
        );
      }
    }
    const stored = {
      schemaVersion: 1,
      panelThemeId: selected.panelThemeId,
      messageDecorationId: selected.messageDecorationId,
      updatedAt: currentTime(),
    };
    await preferencesRef(uid).set(stored);
    return {
      saved: true,
      cosmetics: publicCosmetics(stored, owned),
    };
  }

  async function beginAchievementSession(uid, data) {
    requireUid(uid);
    const allowedKeys = new Set(["action", "actionId", "modeId", "roundSeconds"]);
    if (!data || typeof data !== "object" || Array.isArray(data)
        || Reflect.ownKeys(data).some((key) => !allowedKeys.has(key))) {
      throw httpsError("invalid-argument", "実績記録を開始する条件を確認してください。");
    }
    let actionId;
    let modeId;
    try {
      actionId = normalizeAiTextTrainingActionId(data.actionId);
      modeId = normalizeAiTextTrainingMode(data.modeId);
    } catch (error) {
      throw mapHelperError(error);
    }
    const roundSeconds = Number(data.roundSeconds);
    if (!Number.isSafeInteger(roundSeconds)
        || !AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_SECONDS.includes(roundSeconds)) {
      throw httpsError("invalid-argument", "1ラウンドの秒数を選び直してください。");
    }
    const roundCount = AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT;
    const payloadHash = aiTextTrainingPayloadHash({
      modeId,
      roundSeconds,
      roundCount,
    });
    const sessionId = aiTextTrainingActionDocumentId(
      uid,
      actionId,
      "achievement-session",
    );
    const reference = achievementSessionRef(sessionId);
    const activeReference = activeAchievementSessionRef(uid);
    const statsReference = playerStatsRef(uid);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const [snapshot, activeSnapshot, statsSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(activeReference),
        transaction.get(statsReference),
      ]);
      const now = currentTime();
      if (snapshot.exists) {
        const saved = snapshot.data();
        if (saved.uid !== uid || saved.payloadHash !== payloadHash) {
          throw httpsError(
            "already-exists",
            "同じ操作IDが別のトレーニング条件で使われています。画面を読み直してください。",
          );
        }
        if (!saved.deleteAt) {
          transaction.set(reference, {
            deleteAt: achievementSessionDeleteAt(saved.startedAt, now),
          }, { merge: true });
        }
        const savedStartedAt = safeInteger(saved.startedAt);
        if (savedStartedAt > safeInteger(
          statsSnapshot.get("lastAchievementSessionStartedAt"),
        )) {
          transaction.set(statsReference, {
            schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
            uid,
            lastAchievementSessionStartedAt: savedStartedAt,
            updatedAt: now,
          }, { merge: true });
        }
        result = {
          session: publicAchievementSession(saved),
          idempotent: true,
        };
        return;
      }
      const lastStartedAt = Math.max(
        safeInteger(statsSnapshot.get("lastAchievementSessionStartedAt")),
        safeInteger(activeSnapshot.get("startedAt")),
      );
      if (lastStartedAt
          && now - lastStartedAt < AI_TEXT_TRAINING_ACHIEVEMENT_BEGIN_COOLDOWN_MS) {
        throw httpsError(
          "resource-exhausted",
          "直前のトレーニング開始を確認中です。少し待ってからもう一度お試しください。",
        );
      }
      const previousSessionId = safeOneLine(activeSnapshot.get("sessionId"), 40);
      if (previousSessionId
          && previousSessionId !== sessionId
          && /^[a-f0-9]{40}$/u.test(previousSessionId)) {
        const previousReference = achievementSessionRef(previousSessionId);
        const previousSnapshot = await transaction.get(previousReference);
        if (previousSnapshot.exists
            && previousSnapshot.get("uid") === uid
            && previousSnapshot.get("status") === "active") {
          transaction.update(previousReference, {
            status: "exited",
            outcome: "exited",
            endedAt: now,
            supersededAt: now,
          });
        }
      }
      const stored = {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        id: sessionId,
        uid,
        actionId,
        payloadHash,
        modeId,
        roundSeconds,
        roundCount,
        expectedActiveSeconds: roundSeconds * roundCount,
        status: "active",
        outcome: "",
        completedRounds: 0,
        activeSeconds: 0,
        startedAt: now,
        endedAt: 0,
        deleteAt: achievementSessionDeleteAt(now, now),
      };
      transaction.set(statsReference, {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        uid,
        lastAchievementSessionStartedAt: now,
        updatedAt: now,
      }, { merge: true });
      transaction.create(reference, stored);
      transaction.set(activeReference, {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        uid,
        sessionId,
        startedAt: now,
        expiresAt: now + AI_TEXT_TRAINING_ACHIEVEMENT_SESSION_TTL_MS,
      });
      result = {
        session: publicAchievementSession(stored),
        idempotent: false,
      };
    });
    return result;
  }

  async function finishAchievementSession(uid, data) {
    requireUid(uid);
    const allowedKeys = new Set([
      "action",
      "sessionId",
      "outcome",
      "completedRounds",
      "activeSeconds",
    ]);
    if (!data || typeof data !== "object" || Array.isArray(data)
        || Reflect.ownKeys(data).some((key) => !allowedKeys.has(key))) {
      throw httpsError("invalid-argument", "実績記録の終了条件を確認してください。");
    }
    let sessionId;
    try {
      sessionId = normalizeAiTextTrainingDocumentId(data.sessionId, "実績記録");
    } catch (error) {
      throw mapHelperError(error);
    }
    const outcome = String(data.outcome || "");
    if (!FINISH_OUTCOMES.has(outcome)) {
      throw httpsError("invalid-argument", "終了理由を確認してください。");
    }
    const completedRounds = data.completedRounds == null
      ? 0
      : Number(data.completedRounds);
    const activeSeconds = data.activeSeconds == null
      ? 0
      : Number(data.activeSeconds);
    if (!Number.isSafeInteger(completedRounds)
        || completedRounds < 0
        || completedRounds > AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT
        || !Number.isFinite(activeSeconds)
        || activeSeconds < 0
        || activeSeconds > (
          Math.max(...AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_SECONDS)
          * AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT
          + AI_TEXT_TRAINING_ACHIEVEMENT_ACTIVE_SECONDS_TOLERANCE
        )) {
      throw httpsError("invalid-argument", "完了したラウンドと運動時間を確認してください。");
    }

    const reference = achievementSessionRef(sessionId);
    const statsReference = playerStatsRef(uid);
    const profileReference = achievementProfileRef(uid);
    const activeReference = activeAchievementSessionRef(uid);
    let result;
    let achievementProfileToSync = null;
    await firestore.runTransaction(async (transaction) => {
      achievementProfileToSync = null;
      const [snapshot, statsSnapshot, profileSnapshot, activeSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(statsReference),
        transaction.get(profileReference),
        transaction.get(activeReference),
      ]);
      if (!snapshot.exists || snapshot.get("uid") !== uid) {
        throw httpsError("not-found", "実績記録を確認できませんでした。");
      }
      const stored = snapshot.data();
      if (stored.status !== "active") {
        if (activeSnapshot.exists && activeSnapshot.get("sessionId") === sessionId) {
          transaction.delete(activeReference);
        }
        if (!stored.deleteAt) {
          transaction.set(reference, {
            deleteAt: achievementSessionDeleteAt(stored.startedAt, currentTime()),
          }, { merge: true });
        }
        if (stored.status === "completed" && profileSnapshot.exists) {
          achievementProfileToSync = profileSnapshot.data();
        }
        result = {
          session: publicAchievementSession(stored),
          stats: publicPlayerStats(statsSnapshot.data()),
          newlyUnlocked: [],
          idempotent: true,
        };
        return;
      }
      const roundSeconds = AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_SECONDS.includes(
        stored.roundSeconds,
      )
        ? stored.roundSeconds
        : 0;
      if (!roundSeconds
          || stored.roundCount !== AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT) {
        throw httpsError("failed-precondition", "実績記録の開始条件を確認できませんでした。");
      }
      const expectedActiveSeconds = roundSeconds * stored.roundCount;
      if (activeSeconds > (
        expectedActiveSeconds + AI_TEXT_TRAINING_ACHIEVEMENT_ACTIVE_SECONDS_TOLERANCE
      )) {
        throw httpsError("invalid-argument", "運動時間が開始条件と一致しません。");
      }
      const now = currentTime();
      if (outcome === "completed") {
        if (completedRounds !== AI_TEXT_TRAINING_ACHIEVEMENT_ROUND_COUNT
            || Math.abs(activeSeconds - expectedActiveSeconds)
              > AI_TEXT_TRAINING_ACHIEVEMENT_ACTIVE_SECONDS_TOLERANCE) {
          throw httpsError(
            "failed-precondition",
            "5ラウンドの完走時間を確認できませんでした。",
          );
        }
        if (now - safeInteger(stored.startedAt) < expectedActiveSeconds * 1_000) {
          throw httpsError(
            "failed-precondition",
            "完走に必要な運動時間がまだ経過していません。",
          );
        }
      }
      const terminal = {
        ...stored,
        status: outcome,
        outcome,
        completedRounds,
        activeSeconds,
        endedAt: now,
      };
      const terminalUpdate = {
        status: outcome,
        outcome,
        completedRounds,
        activeSeconds,
        endedAt: now,
      };
      if (!stored.deleteAt) {
        terminalUpdate.deleteAt = achievementSessionDeleteAt(stored.startedAt, now);
      }
      transaction.update(reference, terminalUpdate);
      if (activeSnapshot.exists && activeSnapshot.get("sessionId") === sessionId) {
        transaction.delete(activeReference);
      }

      let nextStats = statsSnapshot.data();
      let newlyUnlocked = [];
      if (outcome === "completed") {
        const currentStats = normalizeAiTextTrainingStats(statsSnapshot.data());
        const dateKey = aiTextTrainingJstDateKey(now);
        const previousDateKey = /^\d{4}-\d{2}-\d{2}$/u.test(
          String(statsSnapshot.get("lastCompletionDateKey") || ""),
        )
          ? String(statsSnapshot.get("lastCompletionDateKey"))
          : "";
        nextStats = {
          schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
          uid,
          ...currentStats,
          completedSessions: safeInteger(currentStats.completedSessions) + 1,
          completionDays: safeInteger(currentStats.completionDays)
            + (previousDateKey === dateKey ? 0 : 1),
          lastCompletionDateKey: dateKey,
          updatedAt: now,
        };
        const eligibleIds = eligibleAchievementIds({
          aiTextTrainingStats: nextStats,
          scope: "ai_training",
        });
        const unlockResult = unlockAchievements(
          profileSnapshot.data(),
          eligibleIds,
          now,
        );
        newlyUnlocked = unlockResult.newlyUnlocked;
        transaction.set(statsReference, nextStats);
        transaction.set(profileReference, unlockResult.profile);
        if (newlyUnlocked.length) achievementProfileToSync = unlockResult.profile;
      }
      result = {
        session: publicAchievementSession(terminal),
        stats: publicPlayerStats(nextStats),
        newlyUnlocked,
        idempotent: false,
      };
    });
    await bestEffortAchievementSync(
      "ai-text-training-achievement-showcase",
      uid,
      achievementProfileToSync,
    );
    return result;
  }

  async function publish(uid, data) {
    requireUid(uid);
    let actionId;
    let input;
    const expectedBalance = Number(data?.expectedBalance);
    if (!Number.isSafeInteger(expectedBalance) || expectedBalance < 0) {
      throw httpsError("invalid-argument", "公開確認時のAnjuPay残高を読み直してください。");
    }
    try {
      actionId = normalizeAiTextTrainingActionId(data?.actionId);
      input = normalizeAiTextTrainingPresetInput(data);
    } catch (error) {
      throw mapHelperError(error);
    }
    const presetId = aiTextTrainingPresetId(uid, input.modeId, input.productType);
    const payloadHash = aiTextTrainingPayloadHash(input);
    const legacyPayloadHash = input.productType === "standard"
      ? aiTextTrainingPayloadHash(Object.fromEntries(
        Object.entries(input).filter(([key]) => !["productType", "zoneLines"].includes(key)),
      ))
      : "";
    const moderationPayloadHash = aiTextTrainingPayloadHash(
      presetModerationPayload(input),
    );
    const actionReference = publishActionRef(uid, actionId);
    const presetReference = presetRef(presetId);
    const walletReference = walletRef(uid);
    await ensureWallet(uid);

    let result;
    await firestore.runTransaction(async (transaction) => {
      const [
        actionSnapshot,
        presetSnapshot,
        walletSnapshot,
        ledgerConfigSnapshot,
      ] = await Promise.all([
        transaction.get(actionReference),
        transaction.get(presetReference),
        transaction.get(walletReference),
        transaction.get(anjuPayLedgerConfigRef()),
      ]);

      if (actionSnapshot.exists) {
        const saved = actionSnapshot.data();
        const legacyStandardRetry = input.productType === "standard"
          && saved.payloadHash === legacyPayloadHash
          && storedProductType(saved.preset?.productType) === "standard";
        if (saved.sellerUid !== uid
            || (saved.payloadHash !== payloadHash && !legacyStandardRetry)) {
          throw httpsError(
            "already-exists",
            "同じ操作IDが別の公開内容で使われています。画面を読み直してください。",
          );
        }
        result = {
          preset: publicPreset({ ...saved.preset, sellerUid: uid }, uid),
          balance: walletData(walletSnapshot).balance,
          publishFee: AI_TEXT_TRAINING_PUBLISH_FEE,
          idempotent: true,
        };
        return;
      }

      const currentRevision = presetSnapshot.exists
        ? safeInteger(presetSnapshot.get("revision"))
        : 0;
      if (input.baseRevision !== currentRevision) {
        throw httpsError(
          "failed-precondition",
          "台本が別の画面で更新されています。最新内容を読み直してください。",
        );
      }
      if (presetSnapshot.exists
          && presetSnapshot.get("moderationStatus") === "quarantined"
          && aiTextTrainingPayloadHash(
            presetModerationPayload(presetSnapshot.data()),
          ) === moderationPayloadHash) {
        throw httpsError(
          "failed-precondition",
          "安全上の通報で非公開になった台本は、応援台詞を見直してから再公開してください。",
        );
      }
      const wallet = walletData(walletSnapshot);
      if (wallet.balance !== expectedBalance) {
        throw httpsError(
          "failed-precondition",
          "AnjuPay残高が公開確認画面から変わりました。公開後残高をもう一度確認してください。",
        );
      }
      const activated = stageAnjuPayOpening(
        transaction,
        walletReference,
        wallet,
        ledgerConfigSnapshot,
        currentTime(),
      );
      debitPoints(wallet, AI_TEXT_TRAINING_PUBLISH_FEE);
      const now = currentTime();
      const nextRevision = currentRevision + 1;
      const storedPreset = {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        sellerUid: uid,
        publicSellerId: aiTextTrainingPublicSellerId(uid),
        sellerName: input.sellerName,
        modeId: input.modeId,
        productType: input.productType,
        title: input.title,
        description: input.description,
        price: input.price,
        revision: nextRevision,
        lines: input.lines,
        zoneLines: input.zoneLines,
        moderationPayloadHash,
        status: "active",
        actualUseCount: safeInteger(presetSnapshot.get("actualUseCount")),
        rankingUseCount: safeInteger(presetSnapshot.get("rankingUseCount")),
        reportCount: safeInteger(presetSnapshot.get("reportCount")),
        revisionReportCount: 0,
        revisionHighRiskBuyerReportCount: 0,
        moderationStatus: "clear",
        createdAt: presetSnapshot.exists
          ? safeInteger(presetSnapshot.get("createdAt"), 1, Number.MAX_SAFE_INTEGER, now)
          : now,
        updatedAt: now,
      };
      const groupId = anjuPayEntryId(`ai-text-training-publish:${actionReference.id}`);
      appendAnjuPayEntry(transaction, walletReference, wallet, ledgerConfigSnapshot, {
        entryId: groupId,
        groupId,
        kind: "ai_text_training_publish",
        category: "market",
        labelKey: "anju_pay_ai_text_training_publish",
        status: "posted",
        delta: -AI_TEXT_TRAINING_PUBLISH_FEE,
        nominalAmount: AI_TEXT_TRAINING_PUBLISH_FEE,
        balanceBefore: wallet.balance + AI_TEXT_TRAINING_PUBLISH_FEE,
        balanceAfter: wallet.balance,
        components: [{
          kind: "publish_fee",
          labelKey: "anju_pay_ai_text_training_publish_fee",
          delta: -AI_TEXT_TRAINING_PUBLISH_FEE,
          nominalAmount: AI_TEXT_TRAINING_PUBLISH_FEE,
          status: "posted",
        }],
        details: {
          productId: presetId,
          mode: input.modeId,
          productType: input.productType,
          listingTitle: input.title,
        },
        occurredAt: now,
      });
      transaction.update(walletReference, {
        balance: wallet.balance,
        ...anjuPayWalletMetadataPatch(wallet),
        updatedAt: now,
      });
      if (presetSnapshot.exists) {
        transaction.set(presetReference, storedPreset);
      } else {
        transaction.create(presetReference, storedPreset);
      }
      transaction.create(presetRevisionRef(presetId, nextRevision), storedPreset);
      const savedPublicPreset = publicPreset({ id: presetId, ...storedPreset }, uid);
      transaction.create(actionReference, {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        sellerUid: uid,
        payloadHash,
        preset: savedPublicPreset,
        balanceAfter: wallet.balance,
        createdAt: now,
      });
      result = {
        preset: savedPublicPreset,
        balance: wallet.balance,
        publishFee: AI_TEXT_TRAINING_PUBLISH_FEE,
        idempotent: false,
      };
      if (activated) {
        // Metadata is already persisted by the wallet update above.
      }
    });
    await mirrorBalances({ [uid]: result.balance });
    return result;
  }

  async function unpublish(uid, data) {
    requireUid(uid);
    let presetId;
    try {
      presetId = normalizeAiTextTrainingDocumentId(data?.presetId);
    } catch (error) {
      throw mapHelperError(error);
    }
    const reference = presetRef(presetId);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.get("sellerUid") !== uid) {
        throw httpsError("not-found", "自分の応援台本を確認できませんでした。");
      }
      const current = snapshot.data();
      if (current.status === "hidden") {
        result = { preset: publicPreset({ id: presetId, ...current }, uid) };
        return;
      }
      const now = currentTime();
      const next = { ...current, status: "hidden", updatedAt: now };
      transaction.update(reference, { status: "hidden", updatedAt: now });
      result = { preset: publicPreset({ id: presetId, ...next }, uid) };
    });
    return result;
  }

  async function startPaidUse(uid, data) {
    requireUid(uid);
    let actionId;
    let presetId;
    let playStyle;
    try {
      actionId = normalizeAiTextTrainingActionId(data?.actionId);
      presetId = normalizeAiTextTrainingDocumentId(data?.presetId);
      playStyle = normalizeAiTextTrainingPlayStyle(data?.playStyle);
    } catch (error) {
      throw mapHelperError(error);
    }
    const expectedPrice = safeInteger(data?.expectedPrice, 0, 1_000_000, 0);
    const expectedRevision = safeInteger(data?.expectedRevision, 0, 1_000_000, 0);
    const expectedBalance = Number(data?.expectedBalance);
    if (!AI_TEXT_TRAINING_PRICE_OPTIONS.includes(expectedPrice)
        || expectedRevision < 1
        || !Number.isSafeInteger(expectedBalance)
        || expectedBalance < 0) {
      throw httpsError("invalid-argument", "価格・改訂番号・確認残高を読み直してください。");
    }
    const payloadHash = aiTextTrainingPayloadHash({
      presetId,
      expectedPrice,
      expectedRevision,
      playStyle,
    });
    const legacyPayloadHash = aiTextTrainingPayloadHash({
      presetId,
      expectedPrice,
      expectedRevision,
    });
    const useId = aiTextTrainingUseId(uid, actionId);
    const presetReference = presetRef(presetId);
    const preliminaryPresetSnapshot = await presetReference.get();
    if (!preliminaryPresetSnapshot.exists) {
      throw httpsError("not-found", "応援台本を確認できませんでした。");
    }
    const preliminaryProductType = storedProductType(
      preliminaryPresetSnapshot.get("productType"),
    );
    if (preliminaryProductType === "defeat_zone" && playStyle !== "defeat_zone") {
      throw httpsError(
        "failed-precondition",
        "敗北ZONE専用台本は敗北ZONEを選択したトレーニングでのみ利用できます。",
      );
    }
    const preliminarySellerUid = preliminaryPresetSnapshot.get("sellerUid");
    if (preliminarySellerUid === uid) {
      throw httpsError(
        "failed-precondition",
        "自分の台本は作者プレビューで無料試遊できます。",
      );
    }
    requireUid(preliminarySellerUid);
    await Promise.all([ensureWallet(uid), ensureWallet(preliminarySellerUid)]);

    const now = currentTime();
    const dateKey = aiTextTrainingJstDateKey(now);
    const periodKey = aiTextTrainingJstMonthKey(now);
    const useReference = useRef(useId);
    const buyerWalletReference = walletRef(uid);
    const sellerWalletReference = walletRef(preliminarySellerUid);
    const activeReference = activeUseRef(uid);
    const statsReference = sellerStatsRef(preliminarySellerUid);
    const sellerPlayerStatsReference = playerStatsRef(preliminarySellerUid);
    const sellerAchievementReference = achievementProfileRef(preliminarySellerUid);
    const monthlyReference = monthlyEntryRef(periodKey, preliminarySellerUid);
    const dailyPairReference = rankingPairRef(dateKey, preliminarySellerUid, uid);
    const lifetimeBuyerPairReference = sellerBuyerPairRef(preliminarySellerUid, uid);
    const monthBuyerPairReference = monthlyBuyerPairRef(periodKey, preliminarySellerUid, uid);
    const revisionBuyerReference = presetRevisionBuyerRef(
      presetId,
      expectedRevision,
      uid,
    );

    let result;
    let sellerAchievementProfileToSync = null;
    await firestore.runTransaction(async (transaction) => {
      sellerAchievementProfileToSync = null;
      const [
        useSnapshot,
        presetSnapshot,
        activeSnapshot,
        buyerWalletSnapshot,
        sellerWalletSnapshot,
        ledgerConfigSnapshot,
        statsSnapshot,
        sellerPlayerStatsSnapshot,
        sellerAchievementSnapshot,
        monthlySnapshot,
        dailyPairSnapshot,
        lifetimeBuyerPairSnapshot,
        monthBuyerPairSnapshot,
        revisionBuyerSnapshot,
      ] = await Promise.all([
        transaction.get(useReference),
        transaction.get(presetReference),
        transaction.get(activeReference),
        transaction.get(buyerWalletReference),
        transaction.get(sellerWalletReference),
        transaction.get(anjuPayLedgerConfigRef()),
        transaction.get(statsReference),
        transaction.get(sellerPlayerStatsReference),
        transaction.get(sellerAchievementReference),
        transaction.get(monthlyReference),
        transaction.get(dailyPairReference),
        transaction.get(lifetimeBuyerPairReference),
        transaction.get(monthBuyerPairReference),
        transaction.get(revisionBuyerReference),
      ]);

      if (useSnapshot.exists) {
        const saved = useSnapshot.data();
        const legacyStandardRetry = saved.playStyle == null
          && playStyle === "standard"
          && saved.payloadHash === legacyPayloadHash;
        if (saved.buyerUid !== uid
            || (saved.payloadHash !== payloadHash && !legacyStandardRetry)) {
          throw httpsError(
            "already-exists",
            "同じ操作IDが別の利用内容で使われています。画面を読み直してください。",
          );
        }
        if (saved.sellerAchievementSyncRequired === true
            && sellerAchievementSnapshot.exists) {
          sellerAchievementProfileToSync = sellerAchievementSnapshot.data();
        }
        const stillActive = ACTIVE_USE_STATUSES.has(saved.status)
          && activeSnapshot.exists
          && activeSnapshot.get("useId") === useId;
        if (!stillActive) {
          result = { terminalAction: true, idempotent: true };
          return;
        }
        result = { use: publicUse(saved), idempotent: true };
        return;
      }
      if (activeSnapshot.exists
          && safeOneLine(activeSnapshot.get("useId"), 40) !== useId) {
        throw httpsError(
          "failed-precondition",
          "開始済みの有料応援があります。先にそのセッションを再開してください。",
        );
      }
      if (!presetSnapshot.exists || presetSnapshot.get("status") !== "active") {
        throw httpsError("not-found", "この応援台本は現在利用できません。");
      }
      const preset = presetSnapshot.data();
      const productType = storedProductType(preset.productType);
      const sellerUid = preset.sellerUid;
      if (sellerUid !== preliminarySellerUid || sellerUid === uid) {
        throw httpsError("failed-precondition", "作者情報が更新されました。台本を読み直してください。");
      }
      if (safeInteger(preset.price) !== expectedPrice
          || safeInteger(preset.revision) !== expectedRevision) {
        throw httpsError(
          "failed-precondition",
          "価格または台本が更新されています。決済前にもう一度確認してください。",
        );
      }
      if (productType === "defeat_zone" && playStyle !== "defeat_zone") {
        throw httpsError(
          "failed-precondition",
          "敗北ZONE専用台本は敗北ZONEを選択したトレーニングでのみ利用できます。",
        );
      }

      const settlement = aiTextTrainingSaleSettlement(expectedPrice);
      const buyerWallet = walletData(buyerWalletSnapshot);
      const sellerWallet = walletData(sellerWalletSnapshot);
      const buyerBefore = buyerWallet.balance;
      const sellerBefore = sellerWallet.balance;
      if (buyerBefore !== expectedBalance) {
        throw httpsError(
          "failed-precondition",
          "AnjuPay残高が確認画面から変わりました。支払後残高をもう一度確認してください。",
        );
      }
      stageAnjuPayOpening(
        transaction,
        buyerWalletReference,
        buyerWallet,
        ledgerConfigSnapshot,
        now,
      );
      stageAnjuPayOpening(
        transaction,
        sellerWalletReference,
        sellerWallet,
        ledgerConfigSnapshot,
        now,
      );
      debitPoints(buyerWallet, settlement.price);
      creditPoints(sellerWallet, settlement.sellerProceeds);

      const rankingCounted = !dailyPairSnapshot.exists;
      const uniqueLifetimeBuyer = !lifetimeBuyerPairSnapshot.exists;
      const uniqueMonthlyBuyer = !monthBuyerPairSnapshot.exists;
      const currentStats = normalizedStats(statsSnapshot.data(), sellerUid, preset);
      const currentMonthly = normalizedStats(monthlySnapshot.data(), sellerUid, preset);
      const nextStats = addSaleToStats(currentStats, {
        settlement,
        rankingCounted,
        uniqueBuyer: uniqueLifetimeBuyer,
        now,
      });
      const sellerAchievementStats = normalizeAiTextTrainingStats({
        ...sellerPlayerStatsSnapshot.data(),
        rankingUseCount: nextStats.rankingUseCount,
        uniqueBuyers: nextStats.uniqueBuyers,
      });
      const sellerUnlockResult = unlockAchievements(
        sellerAchievementSnapshot.data(),
        eligibleAchievementIds({
          aiTextTrainingStats: sellerAchievementStats,
          scope: "ai_training",
        }),
        now,
      );
      const nextMonthly = addSaleToStats(currentMonthly, {
        settlement,
        rankingCounted,
        uniqueBuyer: uniqueMonthlyBuyer,
        now,
      });
      const snapshot = {
        id: presetId,
        publicSellerId: preset.publicSellerId,
        sellerName: preset.sellerName,
        modeId: preset.modeId,
        productType,
        title: preset.title,
        description: preset.description,
        price: preset.price,
        revision: preset.revision,
        lines: preset.lines,
        zoneLines: productType === "defeat_zone" ? preset.zoneLines : {},
      };
      const storedUse = {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        id: useId,
        buyerUid: uid,
        sellerUid,
        actionId,
        payloadHash,
        playStyle,
        status: "active",
        outcome: "",
        presetId,
        presetSnapshot: snapshot,
        price: settlement.price,
        fee: settlement.fee,
        sellerProceeds: settlement.sellerProceeds,
        buyerBalanceAfter: buyerWallet.balance,
        rankingCounted,
        sellerAchievementSyncRequired: sellerUnlockResult.newlyUnlocked.length > 0,
        dateKey,
        periodKey,
        startedAt: now,
        endedAt: 0,
      };
      const groupId = anjuPayEntryId(`ai-text-training-use:${useId}`);
      appendAnjuPayEntry(
        transaction,
        buyerWalletReference,
        buyerWallet,
        ledgerConfigSnapshot,
        {
          entryId: groupId,
          groupId,
          kind: "ai_text_training_use",
          category: "market",
          labelKey: "anju_pay_ai_text_training_use",
          status: "posted",
          delta: -settlement.price,
          nominalAmount: settlement.price,
          balanceBefore: buyerBefore,
          balanceAfter: buyerWallet.balance,
          components: [{
            kind: "support_preset_use",
            labelKey: "anju_pay_ai_text_training_use",
            delta: -settlement.price,
            nominalAmount: settlement.price,
            status: "posted",
          }],
          details: {
            productId: presetId,
            mode: preset.modeId,
            productType,
            playStyle,
            counterpartyName: preset.sellerName,
            publicSellerId: preset.publicSellerId,
            listingTitle: preset.title,
          },
          occurredAt: now,
        },
      );
      appendAnjuPayEntry(
        transaction,
        sellerWalletReference,
        sellerWallet,
        ledgerConfigSnapshot,
        {
          entryId: groupId,
          groupId,
          kind: "ai_text_training_sale",
          category: "market",
          labelKey: "anju_pay_ai_text_training_sale",
          status: "posted",
          delta: settlement.sellerProceeds,
          nominalAmount: settlement.price,
          balanceBefore: sellerBefore,
          balanceAfter: sellerWallet.balance,
          components: [{
            kind: "support_preset_sale",
            labelKey: "anju_pay_ai_text_training_sale",
            delta: settlement.sellerProceeds,
            nominalAmount: settlement.price,
            status: "posted",
          }],
          details: {
            productId: presetId,
            mode: preset.modeId,
            productType,
            playStyle,
            listingTitle: preset.title,
          },
          occurredAt: now,
        },
      );
      transaction.update(buyerWalletReference, {
        balance: buyerWallet.balance,
        ...anjuPayWalletMetadataPatch(buyerWallet),
        updatedAt: now,
      });
      transaction.update(sellerWalletReference, {
        balance: sellerWallet.balance,
        ...anjuPayWalletMetadataPatch(sellerWallet),
        updatedAt: now,
      });
      transaction.create(useReference, storedUse);
      transaction.set(activeReference, {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        buyerUid: uid,
        useId,
        startedAt: now,
      });
      transaction.set(statsReference, nextStats);
      if (sellerUnlockResult.newlyUnlocked.length) {
        transaction.set(sellerAchievementReference, sellerUnlockResult.profile);
        sellerAchievementProfileToSync = sellerUnlockResult.profile;
      }
      transaction.set(monthlyReference, {
        ...nextMonthly,
        periodKey,
      });
      if (!dailyPairSnapshot.exists) {
        transaction.create(dailyPairReference, {
          sellerUid,
          buyerUid: uid,
          dateKey,
          periodKey,
          useId,
          rankingGross: settlement.price,
          createdAt: now,
        });
      }
      if (!lifetimeBuyerPairSnapshot.exists) {
        transaction.create(lifetimeBuyerPairReference, {
          sellerUid,
          buyerUid: uid,
          firstUseId: useId,
          createdAt: now,
        });
      }
      if (!monthBuyerPairSnapshot.exists) {
        transaction.create(monthBuyerPairReference, {
          sellerUid,
          buyerUid: uid,
          periodKey,
          firstUseId: useId,
          createdAt: now,
        });
      }
      if (!revisionBuyerSnapshot.exists) {
        transaction.create(revisionBuyerReference, {
          sellerUid,
          buyerUid: uid,
          presetId,
          presetRevision: expectedRevision,
          productType,
          playStyle,
          firstUseId: useId,
          createdAt: now,
        });
      }
      transaction.update(presetReference, {
        actualUseCount: safeInteger(preset.actualUseCount) + 1,
        rankingUseCount: safeInteger(preset.rankingUseCount) + (rankingCounted ? 1 : 0),
        lastUsedAt: now,
      });
      result = {
        use: publicUse(storedUse),
        idempotent: false,
        _balances: {
          [uid]: buyerWallet.balance,
          [sellerUid]: sellerWallet.balance,
        },
      };
    });
    await mirrorBalances(result._balances || {});
    delete result._balances;
    await bestEffortAchievementSync(
      "ai-text-training-seller-achievement-showcase",
      preliminarySellerUid,
      sellerAchievementProfileToSync,
    );
    return result;
  }

  async function resumeUse(uid, data) {
    requireUid(uid);
    let useId;
    try {
      useId = normalizeAiTextTrainingDocumentId(data?.useId, "利用記録");
    } catch (error) {
      throw mapHelperError(error);
    }
    const [snapshot, activeSnapshot] = await Promise.all([
      useRef(useId).get(),
      activeUseRef(uid).get(),
    ]);
    if (!snapshot.exists || snapshot.get("buyerUid") !== uid) {
      throw httpsError("not-found", "再開できる有料応援を確認できませんでした。");
    }
    if (!ACTIVE_USE_STATUSES.has(snapshot.get("status"))
        || !activeSnapshot.exists
        || activeSnapshot.get("useId") !== useId) {
      throw httpsError(
        "failed-precondition",
        "この1回分の有料応援は終了済みです。もう一度使う場合は新しい利用確認が必要です。",
      );
    }
    return { use: publicUse(snapshot.data()) };
  }

  async function finishUse(uid, data) {
    requireUid(uid);
    let useId;
    try {
      useId = normalizeAiTextTrainingDocumentId(data?.useId, "利用記録");
    } catch (error) {
      throw mapHelperError(error);
    }
    const outcome = String(data?.outcome || "");
    if (!FINISH_OUTCOMES.has(outcome)) {
      throw httpsError("invalid-argument", "終了理由を確認してください。");
    }
    const reference = useRef(useId);
    const activeReference = activeUseRef(uid);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const [snapshot, activeSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(activeReference),
      ]);
      if (!snapshot.exists || snapshot.get("buyerUid") !== uid) {
        throw httpsError("not-found", "利用記録を確認できませんでした。");
      }
      const stored = snapshot.data();
      if (!ACTIVE_USE_STATUSES.has(stored.status)) {
        if (activeSnapshot.exists && activeSnapshot.get("useId") === useId) {
          transaction.delete(activeReference);
        }
        result = { use: publicUse(stored), idempotent: true };
        return;
      }
      const now = currentTime();
      const next = {
        ...stored,
        status: outcome,
        outcome,
        endedAt: now,
      };
      transaction.update(reference, {
        status: outcome,
        outcome,
        endedAt: now,
      });
      if (activeSnapshot.exists && activeSnapshot.get("useId") === useId) {
        transaction.delete(activeReference);
      }
      result = { use: publicUse(next), idempotent: false };
    });
    return result;
  }

  async function saveProfile(uid, data) {
    requireUid(uid);
    const xPublic = data?.xPublic === true;
    let xHandle = "";
    if (xPublic) {
      try {
        xHandle = normalizeAiTextTrainingXHandle(data?.xHandle);
      } catch (error) {
        throw mapHelperError(error);
      }
    }
    if (xPublic && !xHandle) {
      throw httpsError("invalid-argument", "公開するXユーザー名を入力してください。");
    }
    const now = currentTime();
    const stored = {
      schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
      sellerUid: uid,
      publicSellerId: aiTextTrainingPublicSellerId(uid),
      xPublic,
      xHandle: xPublic ? xHandle : "",
      updatedAt: now,
    };
    const ownPresetReferences = AI_TEXT_TRAINING_MODES.flatMap((modeId) => (
      AI_TEXT_TRAINING_PRODUCT_TYPES.map((productType) => (
        presetRef(aiTextTrainingPresetId(uid, modeId, productType))
      ))
    ));
    const profileReference = profileRef(uid);
    await firestore.runTransaction(async (transaction) => {
      const ownPresetSnapshots = await Promise.all(
        ownPresetReferences.map((reference) => transaction.get(reference)),
      );
      if (xPublic && ownPresetSnapshots.some((snapshot) => (
        snapshot.exists && snapshot.get("moderationStatus") === "quarantined"
      ))) {
        throw httpsError(
          "failed-precondition",
          "安全確認中の台本があります。改訂して再公開するまでXリンクは公開できません。",
        );
      }
      transaction.set(profileReference, stored);
    });
    return { profile: publicProfile(stored) };
  }

  function publicRankingRow(stats, profile, rank) {
    const normalized = normalizedStats(stats, stats?.sellerUid || "", stats);
    const x = publicProfile(profile);
    return {
      rank,
      publicSellerId: safeOneLine(stats?.publicSellerId, 40),
      sellerName: safeOneLine(stats?.sellerName, 16, "匿名作者"),
      rankingGross: normalized.rankingGross,
      actualGross: normalized.actualGross,
      netSales: normalized.netSales,
      useCount: normalized.useCount,
      rankingUseCount: normalized.rankingUseCount,
      uniqueBuyers: normalized.uniqueBuyers,
      xPublic: x.xPublic,
      xHandle: x.xHandle,
      updatedAt: normalized.updatedAt,
    };
  }

  async function rankings(uid, data) {
    requireUid(uid);
    const period = String(data?.period || "monthly");
    if (!["monthly", "lifetime"].includes(period)) {
      throw httpsError("invalid-argument", "ランキング期間を選び直してください。");
    }
    const now = currentTime();
    const periodKey = period === "monthly" ? aiTextTrainingJstMonthKey(now) : "lifetime";
    const collection = period === "monthly"
      ? firestore.collection("aiTextTrainingMonthlyPeriods").doc(periodKey).collection("entries")
      : firestore.collection("aiTextTrainingSellerStats");
    const snapshot = await collection.orderBy("rankingGross", "desc").limit(RANKING_LIMIT).get();
    const rows = snapshot.docs
      .map((document) => document.data())
      .filter((value) => safeInteger(value?.rankingGross) > 0);
    const profileSnapshots = await Promise.all(rows.map((row) => profileRef(row.sellerUid).get()));
    return {
      period,
      periodKey,
      rows: rows.map((row, index) => publicRankingRow(
        row,
        profileSnapshots[index].data(),
        index + 1,
      )),
      rankingPairDailyLimit: 1,
      updatedAt: now,
    };
  }

  async function report(uid, data) {
    requireUid(uid);
    let presetId;
    try {
      presetId = normalizeAiTextTrainingDocumentId(data?.presetId);
    } catch (error) {
      throw mapHelperError(error);
    }
    const reason = String(data?.reason || "");
    const expectedRevision = Number(data?.expectedRevision);
    if (!isAiTextTrainingReportReason(reason)) {
      throw httpsError("invalid-argument", "通報理由を選び直してください。");
    }
    if (!Number.isSafeInteger(expectedRevision)
        || expectedRevision < 1
        || expectedRevision > 1_000_000) {
      throw httpsError("invalid-argument", "通報対象の改訂番号を読み直してください。");
    }
    const presetReference = presetRef(presetId);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const presetSnapshot = await transaction.get(presetReference);
      if (!presetSnapshot.exists) {
        throw httpsError("not-found", "応援台本を確認できませんでした。");
      }
      if (presetSnapshot.get("sellerUid") === uid) {
        throw httpsError("failed-precondition", "自分の台本は通報できません。");
      }
      const presetRevision = safeInteger(
        presetSnapshot.get("revision"),
        1,
        1_000_000,
        0,
      );
      if (presetRevision < 1) {
        throw httpsError("failed-precondition", "通報対象の改訂を確認できませんでした。");
      }
      if (presetRevision !== expectedRevision) {
        throw httpsError(
          "failed-precondition",
          "台本が通報画面を開いた後に改訂されました。全文を読み直してください。",
        );
      }
      const reportReference = reportRef(presetId, presetRevision, uid);
      const verifiedBuyerReference = presetRevisionBuyerRef(
        presetId,
        presetRevision,
        uid,
      );
      const [reportSnapshot, verifiedBuyerSnapshot] = await Promise.all([
        transaction.get(reportReference),
        transaction.get(verifiedBuyerReference),
      ]);
      if (reportSnapshot.exists) {
        result = {
          reported: true,
          quarantined: presetSnapshot.get("moderationStatus") === "quarantined",
          idempotent: true,
        };
        return;
      }
      const now = currentTime();
      const reportedPreset = publicPreset({
        id: presetId,
        ...presetSnapshot.data(),
      });
      const verifiedBuyer = verifiedBuyerSnapshot.exists;
      const highRiskBuyerReport = verifiedBuyer && HIGH_RISK_REPORT_REASONS.has(reason);
      const nextRevisionReportCount = safeInteger(
        presetSnapshot.get("revisionReportCount"),
      ) + 1;
      const nextHighRiskBuyerReportCount = safeInteger(
        presetSnapshot.get("revisionHighRiskBuyerReportCount"),
      ) + (highRiskBuyerReport ? 1 : 0);
      const quarantined = nextHighRiskBuyerReportCount
        >= VERIFIED_BUYER_QUARANTINE_THRESHOLD;
      transaction.create(reportReference, {
        schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
        presetId,
        presetRevision,
        presetSnapshot: reportedPreset,
        sellerUid: presetSnapshot.get("sellerUid"),
        reporterUid: uid,
        reason,
        verifiedBuyer,
        highRiskBuyerReport,
        createdAt: now,
      });
      transaction.update(presetReference, {
        reportCount: safeInteger(presetSnapshot.get("reportCount")) + 1,
        revisionReportCount: nextRevisionReportCount,
        revisionHighRiskBuyerReportCount: nextHighRiskBuyerReportCount,
        ...(quarantined ? {
          status: "hidden",
          moderationStatus: "quarantined",
          quarantinedAt: now,
        } : {}),
        lastReportedAt: now,
      });
      if (quarantined) {
        transaction.set(profileRef(presetSnapshot.get("sellerUid")), {
          xPublic: false,
          xHandle: "",
          updatedAt: now,
          quarantinedAt: now,
        }, { merge: true });
      }
      result = { reported: true, quarantined, idempotent: false };
    });
    return result;
  }

  async function performAction(uid, data = {}) {
    requireUid(uid);
    const action = String(data?.action || "state");
    if (!AI_TEXT_TRAINING_ACTIONS.includes(action)) {
      throw httpsError("invalid-argument", "未対応の文字コラトレーニング操作です。");
    }
    let result;
    if (action === "state") result = await getState(uid, data);
    if (action === "browse") result = await browse(uid, data);
    if (action === "publish") result = await publish(uid, data);
    if (action === "unpublish") result = await unpublish(uid, data);
    if (action === "start_paid_use") result = await startPaidUse(uid, data);
    if (action === "resume_use") result = await resumeUse(uid, data);
    if (action === "finish_use") result = await finishUse(uid, data);
    if (action === "begin_achievement_session") result = await beginAchievementSession(uid, data);
    if (action === "finish_achievement_session") result = await finishAchievementSession(uid, data);
    if (action === "save_profile") result = await saveProfile(uid, data);
    if (action === "save_cosmetics") result = await saveCosmetics(uid, data);
    if (action === "rankings") result = await rankings(uid, data);
    if (action === "report") result = await report(uid, data);
    assertNoPrivateFields(result);
    return result;
  }

  return Object.freeze({
    beginAchievementSession,
    browse,
    finishAchievementSession,
    finishUse,
    getState,
    performAction,
    publish,
    rankings,
    report,
    resumeUse,
    saveCosmetics,
    saveProfile,
    startPaidUse,
    unpublish,
  });
}

module.exports = Object.freeze({
  AI_TEXT_TRAINING_ACTIONS,
  createAiTextTrainingService,
});
