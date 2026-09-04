"use strict";

const {
  ROULETTE_TRAINING_COUNT_UNITS,
  ROULETTE_TRAINING_PACK_ITEM_MAX,
  ROULETTE_TRAINING_PACK_ITEM_MIN,
  ROULETTE_TRAINING_SELLER_PACK_MAX,
  ROULETTE_TRAINING_PRICE_OPTIONS,
  ROULETTE_TRAINING_PUBLISH_FEE,
  ROULETTE_TRAINING_SCHEMA_VERSION,
  ROULETTE_TRAINING_SUCCESS_FEE_BASIS_POINTS,
  isRouletteTrainingReportReason,
  normalizeRouletteTrainingActionId,
  normalizeRouletteTrainingDocumentId,
  normalizeRouletteTrainingPackInput,
  normalizeRouletteTrainingXHandle,
  rouletteTrainingJstDateKey,
  rouletteTrainingJstMonthKey,
  rouletteTrainingMonthlyBuyerPairId,
  rouletteTrainingPackBuyerPairId,
  rouletteTrainingPackId,
  rouletteTrainingPackMonthlyBuyerPairId,
  rouletteTrainingPackRankingId,
  rouletteTrainingPackRankingPairId,
  rouletteTrainingPayloadHash,
  rouletteTrainingPublishActionId,
  rouletteTrainingPublicSellerId,
  rouletteTrainingRankingContentHash,
  rouletteTrainingRankingPairId,
  rouletteTrainingReportId,
  rouletteTrainingRevisionBuyerId,
  rouletteTrainingSaleSettlement,
  rouletteTrainingSellerBuyerPairId,
  rouletteTrainingUseId,
} = require("./roulette-training");
const {
  eligibleAchievementIds,
  normalizeRouletteTrainingStats,
  publicAchievementProfile,
  unlockAchievements,
} = require("./achievements");

const ROULETTE_TRAINING_ACTIONS = Object.freeze([
  "state",
  "browse",
  "publish",
  "unpublish",
  "start_paid_use",
  "resume_use",
  "finish_use",
  "pack_rankings",
  "creator_stats",
  "save_profile",
  "report",
]);
const REQUIRED_DEPENDENCIES = Object.freeze([
  "firestore",
  "HttpsError",
  "ensureWallet",
  "walletRef",
  "anjuPayLedgerConfigRef",
  "walletData",
  "debitPoints",
  "creditPoints",
  "stageAnjuPayOpening",
  "appendAnjuPayEntry",
  "anjuPayWalletMetadataPatch",
  "anjuPayEntryId",
  "mirrorWallet",
  "bestEffort",
  "ensureAchievementState",
  "syncAchievementPublicSurfaces",
]);
const PRIVATE_RESPONSE_FIELDS = Object.freeze(new Set([
  "uid",
  "sellerUid",
  "buyerUid",
  "reporterUid",
  "actionId",
  "payloadHash",
  "moderationPayloadHash",
]));
const ACTIVE_PACK_LIMIT = 100;
const PURCHASED_REVISION_LIMIT = 20;
const ACTIVE_USE_STATUS = "active";
const FINISHED_USE_STATUS = "finished";
const VERIFIED_BUYER_QUARANTINE_THRESHOLD = 3;
const PACK_RANKING_LIMIT = 20;
const PACK_RANKING_CANDIDATE_LIMIT = 60;
const PACK_RANKING_MINIMUM_UNIQUE_BUYERS = 3;
const HIGH_RISK_REPORT_REASONS = Object.freeze(new Set([
  "dangerous_exercise",
  "stop_obstruction",
  "harassment",
  "sexual",
  "privacy",
]));

function createRouletteTrainingService(deps) {
  if (!deps || typeof deps !== "object") {
    throw new TypeError("Roulette training service dependencies are required.");
  }
  for (const name of REQUIRED_DEPENDENCIES) {
    if (deps[name] == null) {
      throw new TypeError(`Missing roulette training service dependency: ${name}`);
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
    ensureAchievementState,
    syncAchievementPublicSurfaces,
  } = deps;
  const currentTime = typeof deps.now === "function" ? deps.now : Date.now;

  if (typeof firestore.collection !== "function"
      || typeof firestore.runTransaction !== "function") {
    throw new TypeError("Roulette training service storage dependencies are invalid.");
  }

  const packsCollection = () => firestore.collection("rouletteTrainingPacks");
  const packRef = (packId) => packsCollection().doc(packId);
  const revisionRef = (packId, revision) => packRef(packId)
    .collection("revisions")
    .doc(String(revision).padStart(8, "0"));
  const useRef = (useId) => firestore.collection("rouletteTrainingUses").doc(useId);
  const activeUseRef = (uid) => firestore.collection("rouletteTrainingActiveUses").doc(uid);
  const publishActionRef = (uid, actionId) => firestore
    .collection("rouletteTrainingPublishActions")
    .doc(rouletteTrainingPublishActionId(uid, actionId));
  const revisionBuyerRef = (packId, revision, buyerUid) => firestore
    .collection("rouletteTrainingPackRevisionBuyers")
    .doc(rouletteTrainingRevisionBuyerId(packId, revision, buyerUid));
  const reportRef = (packId, revision, reporterUid) => firestore
    .collection("rouletteTrainingReports")
    .doc(rouletteTrainingReportId(packId, revision, reporterUid));
  const sellerStatsRef = (sellerUid) => firestore
    .collection("rouletteTrainingSellerStats")
    .doc(sellerUid);
  const monthlyEntryRef = (periodKey, sellerUid) => firestore
    .collection("rouletteTrainingMonthlyPeriods")
    .doc(periodKey)
    .collection("entries")
    .doc(sellerUid);
  const rankingPairRef = (dateKey, sellerUid, buyerUid) => firestore
    .collection("rouletteTrainingRankingPairs")
    .doc(rouletteTrainingRankingPairId(dateKey, sellerUid, buyerUid));
  const sellerBuyerPairRef = (sellerUid, buyerUid) => firestore
    .collection("rouletteTrainingSellerBuyerPairs")
    .doc(rouletteTrainingSellerBuyerPairId(sellerUid, buyerUid));
  const monthlyBuyerPairRef = (periodKey, sellerUid, buyerUid) => firestore
    .collection("rouletteTrainingMonthlyBuyerPairs")
    .doc(rouletteTrainingMonthlyBuyerPairId(periodKey, sellerUid, buyerUid));
  const packStatsRef = (packRankingId) => firestore
    .collection("rouletteTrainingPackStats")
    .doc(packRankingId);
  const packMonthlyEntryRef = (periodKey, packRankingId) => firestore
    .collection("rouletteTrainingPackMonthlyPeriods")
    .doc(periodKey)
    .collection("entries")
    .doc(packRankingId);
  const packRankingPairRef = (dateKey, rankingId, buyerUid) => firestore
    .collection("rouletteTrainingPackRankingPairs")
    .doc(rouletteTrainingPackRankingPairId(dateKey, rankingId, buyerUid));
  const packBuyerPairRef = (rankingId, buyerUid) => firestore
    .collection("rouletteTrainingPackBuyerPairs")
    .doc(rouletteTrainingPackBuyerPairId(rankingId, buyerUid));
  const packMonthlyBuyerPairRef = (periodKey, rankingId, buyerUid) => firestore
    .collection("rouletteTrainingPackMonthlyBuyerPairs")
    .doc(rouletteTrainingPackMonthlyBuyerPairId(periodKey, rankingId, buyerUid));
  const profileRef = (sellerUid) => firestore
    .collection("rouletteTrainingSellerProfiles")
    .doc(sellerUid);
  const achievementProfileRef = (sellerUid) => firestore
    .collection("achievementProfiles")
    .doc(sellerUid);

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
        || Array.from(normalized).length > maximumLength
        || /[\r\n\u2028\u2029\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
      return fallback;
    }
    return normalized;
  }

  function safeMultiline(value, maximumLength, fallback = "") {
    if (typeof value !== "string") return fallback;
    const normalized = value.normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
    if (normalized.length > maximumLength
        || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u.test(normalized)) {
      return fallback;
    }
    return normalized;
  }

  function storedItems(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, ROULETTE_TRAINING_PACK_ITEM_MAX).map((item, index) => {
      const itemId = safeOneLine(
        item?.itemId || item?.id,
        40,
        `item-${String(index + 1).padStart(2, "0")}`,
      );
      return {
        itemId,
        // Browser gameplay before schema v1 used `id`; keep the public alias during migration.
        id: itemId,
        menuText: safeOneLine(item?.menuText, 80, "トレーニング"),
        detailText: safeMultiline(item?.detailText, 120),
        countUnit: ROULETTE_TRAINING_COUNT_UNITS.includes(item?.countUnit)
          ? item.countUnit
          : "reps",
        cheerLines: Array.isArray(item?.cheerLines)
          ? item.cheerLines
            .map((line) => safeOneLine(line, 60))
            .filter(Boolean)
            .slice(0, 4)
          : [],
      };
    });
  }

  function publicPack(value, viewerUid = "") {
    const source = value && typeof value === "object" ? value : {};
    return {
      id: safeOneLine(source.id, 40),
      schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
      publicSellerId: safeOneLine(source.publicSellerId, 40),
      sellerName: safeOneLine(source.sellerName, 16, "匿名作者"),
      title: safeOneLine(source.title, 30, "トレーニングパック"),
      description: safeMultiline(source.description, 120),
      price: ROULETTE_TRAINING_PRICE_OPTIONS.includes(source.price) ? source.price : 5,
      revision: safeInteger(source.revision, 1, 1_000_000, 1),
      itemCount: safeInteger(
        source.itemCount,
        ROULETTE_TRAINING_PACK_ITEM_MIN,
        ROULETTE_TRAINING_PACK_ITEM_MAX,
        storedItems(source.items).length || 1,
      ),
      items: storedItems(source.items),
      status: source.status === "active" ? "active" : "hidden",
      moderationStatus: source.moderationStatus === "clear"
        ? "clear"
        : (source.moderationStatus === "quarantined" ? "quarantined" : "pending"),
      paidUseCount: safeInteger(source.paidUseCount),
      createdAt: safeInteger(source.createdAt),
      updatedAt: safeInteger(source.updatedAt),
      isOwn: Boolean(viewerUid && source.sellerUid === viewerUid),
    };
  }

  function publicUse(value) {
    const source = value && typeof value === "object" ? value : {};
    const snapshot = source.packSnapshot && typeof source.packSnapshot === "object"
      ? source.packSnapshot
      : {};
    return {
      id: safeOneLine(source.id, 40),
      status: source.status === FINISHED_USE_STATUS
        ? FINISHED_USE_STATUS
        : ACTIVE_USE_STATUS,
      charged: source.charged === true,
      price: safeInteger(source.price),
      fee: safeInteger(source.fee),
      sellerProceeds: safeInteger(source.sellerProceeds),
      buyerBalanceAfter: safeInteger(source.buyerBalanceAfter),
      rankingCounted: source.rankingCounted === true,
      startedAt: safeInteger(source.startedAt),
      finishedAt: safeInteger(source.finishedAt),
      pack: publicPack(snapshot),
    };
  }

  function publicPurchasedRevision(value) {
    const source = value && typeof value === "object" ? value : {};
    return publicUse({
      id: source.lastUseId,
      status: FINISHED_USE_STATUS,
      charged: true,
      price: source.price,
      fee: source.fee,
      sellerProceeds: source.sellerProceeds,
      buyerBalanceAfter: source.buyerBalanceAfter,
      rankingCounted: source.rankingCounted,
      startedAt: source.lastStartedAt,
      finishedAt: source.lastUsedAt,
      packSnapshot: source.packSnapshot,
    });
  }

  function publicPolicy() {
    return {
      prices: [...ROULETTE_TRAINING_PRICE_OPTIONS],
      countUnits: [...ROULETTE_TRAINING_COUNT_UNITS],
      minimumItems: ROULETTE_TRAINING_PACK_ITEM_MIN,
      maximumItems: ROULETTE_TRAINING_PACK_ITEM_MAX,
      maximumPacksPerSeller: ROULETTE_TRAINING_SELLER_PACK_MAX,
      publishFee: ROULETTE_TRAINING_PUBLISH_FEE,
      successFeeBasisPoints: ROULETTE_TRAINING_SUCCESS_FEE_BASIS_POINTS,
      minimumSuccessFee: 1,
      oneActiveUseAtATime: true,
      selfPreviewFree: true,
      purchasePreviewIncludesFullText: true,
      purchasedRevisionHistoryLimit: PURCHASED_REVISION_LIMIT,
      sessionChargeUnit: "one_start_to_finish",
      rankingPairDailyLimit: 1,
      verifiedBuyerQuarantineThreshold: VERIFIED_BUYER_QUARANTINE_THRESHOLD,
      packRankingLimit: PACK_RANKING_LIMIT,
      packRankingMinimumUniqueBuyers: PACK_RANKING_MINIMUM_UNIQUE_BUYERS,
    };
  }

  function publicProfile(value) {
    const source = value && typeof value === "object" ? value : {};
    const xPublic = source.xPublic === true;
    const xHandle = safeOneLine(source.xHandle, 15);
    const validHandle = /^[A-Za-z0-9_]{1,15}$/u.test(xHandle);
    return {
      xPublic: xPublic && validHandle,
      xHandle: xPublic && validHandle ? xHandle : "",
      updatedAt: safeInteger(source.updatedAt),
    };
  }

  function normalizedPackStats(value, packId, pack, rankingContentHash, rankingId, periodKey = "") {
    const source = value && typeof value === "object" ? value : {};
    const sameContent = source.packId === packId
      && source.sellerUid === pack.sellerUid
      && source.rankingContentHash === rankingContentHash
      && source.packRankingId === rankingId;
    const normalized = {
      schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
      packId,
      sellerUid: pack.sellerUid,
      publicSellerId: rouletteTrainingPublicSellerId(pack.sellerUid),
      rankingContentHash,
      packRankingId: rankingId,
      isCurrentPublic: sameContent && source.isCurrentPublic === true,
      actualGross: sameContent ? safeInteger(source.actualGross) : 0,
      rankingGross: sameContent ? safeInteger(source.rankingGross) : 0,
      netSales: sameContent ? safeInteger(source.netSales) : 0,
      feesPaid: sameContent ? safeInteger(source.feesPaid) : 0,
      useCount: sameContent ? safeInteger(source.useCount) : 0,
      rankingUseCount: sameContent ? safeInteger(source.rankingUseCount) : 0,
      uniqueBuyers: sameContent ? safeInteger(source.uniqueBuyers) : 0,
      scoreReachedAt: sameContent ? safeInteger(source.scoreReachedAt) : 0,
      lastPaidUseAt: sameContent ? safeInteger(source.lastPaidUseAt) : 0,
      updatedAt: sameContent ? safeInteger(source.updatedAt) : 0,
    };
    if (periodKey) normalized.periodKey = periodKey;
    return normalized;
  }

  function addSaleToPackStats(current, settlement, rankingCounted, uniqueBuyer, now) {
    const scoreChanged = rankingCounted || uniqueBuyer;
    return {
      ...current,
      isCurrentPublic: true,
      actualGross: current.actualGross + settlement.price,
      rankingGross: current.rankingGross + (rankingCounted ? settlement.price : 0),
      netSales: current.netSales + settlement.sellerProceeds,
      feesPaid: current.feesPaid + settlement.fee,
      useCount: current.useCount + 1,
      rankingUseCount: current.rankingUseCount + (rankingCounted ? 1 : 0),
      uniqueBuyers: current.uniqueBuyers + (uniqueBuyer ? 1 : 0),
      scoreReachedAt: scoreChanged ? now : current.scoreReachedAt,
      lastPaidUseAt: now,
      updatedAt: now,
    };
  }

  function publicCreatorStats(value, { includePackCount = false } = {}) {
    const source = value && typeof value === "object" ? value : {};
    const result = {
      actualGross: safeInteger(source.actualGross),
      rankingGross: safeInteger(source.rankingGross),
      netSales: safeInteger(source.netSales),
      feesPaid: safeInteger(source.feesPaid),
      useCount: safeInteger(source.useCount),
      rankingUseCount: safeInteger(source.rankingUseCount),
      uniqueBuyers: safeInteger(source.uniqueBuyers),
      updatedAt: safeInteger(source.updatedAt),
    };
    if (includePackCount) result.packCount = safeInteger(source.packCount);
    return result;
  }

  function assertNoPrivateFields(value, path = "response") {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_RESPONSE_FIELDS.has(key)) {
        throw new Error(`Private roulette training field leaked at ${path}.${key}`);
      }
      assertNoPrivateFields(child, `${path}.${key}`);
    }
  }

  function assertAllowedKeys(data, keys, message) {
    const allowed = new Set(keys);
    if (!data || typeof data !== "object" || Array.isArray(data)
        || Reflect.ownKeys(data).some((key) => !allowed.has(key))) {
      throw httpsError("invalid-argument", message);
    }
  }

  function normalizedSellerStats(value, sellerUid, pack, periodKey = "") {
    const source = value && typeof value === "object" ? value : {};
    const normalized = {
      schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
      sellerUid,
      publicSellerId: rouletteTrainingPublicSellerId(sellerUid),
      sellerName: safeOneLine(pack?.sellerName || source.sellerName, 16, "匿名作者"),
      actualGross: safeInteger(source.actualGross),
      rankingGross: safeInteger(source.rankingGross),
      netSales: safeInteger(source.netSales),
      feesPaid: safeInteger(source.feesPaid),
      useCount: safeInteger(source.useCount),
      rankingUseCount: safeInteger(source.rankingUseCount),
      uniqueBuyers: safeInteger(source.uniqueBuyers),
      updatedAt: safeInteger(source.updatedAt),
    };
    if (periodKey) normalized.periodKey = periodKey;
    else normalized.packCount = safeInteger(source.packCount);
    return normalized;
  }

  function addSaleToStats(current, settlement, rankingCounted, uniqueBuyer, now) {
    return {
      ...current,
      actualGross: current.actualGross + settlement.price,
      rankingGross: current.rankingGross + (rankingCounted ? settlement.price : 0),
      netSales: current.netSales + settlement.sellerProceeds,
      feesPaid: current.feesPaid + settlement.fee,
      useCount: current.useCount + 1,
      rankingUseCount: current.rankingUseCount + (rankingCounted ? 1 : 0),
      uniqueBuyers: current.uniqueBuyers + (uniqueBuyer ? 1 : 0),
      updatedAt: now,
    };
  }

  function moderationPayload(pack) {
    return {
      title: pack.title,
      description: pack.description,
      items: storedItems(pack.items).map((item) => ({
        menuText: item.menuText,
        detailText: item.detailText,
        cheerLines: item.cheerLines,
      })),
    };
  }

  function packSnapshot(packId, pack) {
    const rankingContentHash = rouletteTrainingRankingContentHash(storedItems(pack.items));
    return {
      id: packId,
      schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
      publicSellerId: pack.publicSellerId,
      sellerName: pack.sellerName,
      title: pack.title,
      description: pack.description,
      price: pack.price,
      revision: pack.revision,
      itemCount: pack.itemCount,
      items: storedItems(pack.items),
      rankingContentHash,
      packRankingId: rouletteTrainingPackRankingId(packId, rankingContentHash),
      status: pack.status,
      moderationStatus: pack.moderationStatus,
      paidUseCount: safeInteger(pack.paidUseCount),
      createdAt: safeInteger(pack.createdAt),
      updatedAt: safeInteger(pack.updatedAt),
    };
  }

  async function mirrorBalances(values) {
    const operations = Object.entries(values)
      .filter(([, balance]) => Number.isSafeInteger(balance))
      .map(([uid, balance]) => mirrorWallet(uid, balance));
    if (operations.length) {
      await bestEffort("roulette-training-wallet-mirror", operations);
    }
  }

  async function readActiveUse(uid) {
    const activeSnapshot = await activeUseRef(uid).get();
    if (!activeSnapshot.exists) return null;
    const useId = safeOneLine(activeSnapshot.get("useId"), 40);
    if (!/^[a-f0-9]{40}$/u.test(useId)) return null;
    const snapshot = await useRef(useId).get();
    if (!snapshot.exists
        || snapshot.get("buyerUid") !== uid
        || snapshot.get("status") !== ACTIVE_USE_STATUS) {
      return null;
    }
    return publicUse(snapshot.data());
  }

  async function browsePacks(uid) {
    const snapshot = await packsCollection()
      .where("status", "==", "active")
      .where("moderationStatus", "==", "clear")
      .orderBy("paidUseCount", "desc")
      .orderBy("updatedAt", "desc")
      .limit(ACTIVE_PACK_LIMIT)
      .get();
    return snapshot.docs
      .map((document) => publicPack({ id: document.id, ...document.data() }, uid));
  }

  async function readPurchasedRevisions(uid) {
    const snapshot = await firestore.collection("rouletteTrainingPackRevisionBuyers")
      .where("buyerUid", "==", uid)
      .orderBy("lastUsedAt", "desc")
      .limit(PURCHASED_REVISION_LIMIT)
      .get();
    return snapshot.docs
      .map((document) => publicPurchasedRevision(document.data()))
      .filter((use) => use.charged
        && use.status === FINISHED_USE_STATUS
        && use.finishedAt > 0
        && use.pack.id
        && use.pack.revision > 0);
  }

  async function getState(uid, data) {
    requireUid(uid);
    assertAllowedKeys(data, ["action"], "状態取得にはトレーニング情報を送信しないでください。");
    await ensureWallet(uid);
    const [walletSnapshot, ownSnapshot, packs, activeUse, purchasedRevisions] = await Promise.all([
      walletRef(uid).get(),
      packsCollection()
        .where("sellerUid", "==", uid)
        .orderBy("updatedAt", "desc")
        .limit(ROULETTE_TRAINING_SELLER_PACK_MAX)
        .get(),
      browsePacks(uid),
      readActiveUse(uid),
      readPurchasedRevisions(uid),
    ]);
    return {
      policy: publicPolicy(),
      balance: safeInteger(walletSnapshot.get("balance")),
      packs,
      ownPacks: ownSnapshot.docs
        .map((document) => publicPack({ id: document.id, ...document.data() }, uid)),
      activeUse,
      purchasedRevisions,
      serverNow: currentTime(),
    };
  }

  async function browse(uid, data) {
    requireUid(uid);
    assertAllowedKeys(data, ["action"], "一覧取得にはトレーニング情報を送信しないでください。");
    return {
      packs: await browsePacks(uid),
      serverNow: currentTime(),
    };
  }

  async function saveProfile(uid, data) {
    requireUid(uid);
    assertAllowedKeys(
      data,
      ["action", "xPublic", "xHandle"],
      "Xプロフィールの公開設定を確認してください。",
    );
    const xPublic = data.xPublic === true;
    let xHandle = "";
    if (xPublic) {
      try {
        xHandle = normalizeRouletteTrainingXHandle(data.xHandle);
      } catch (error) {
        throw mapHelperError(error);
      }
      if (!xHandle) {
        throw httpsError("invalid-argument", "公開するXユーザー名を入力してください。");
      }
    }
    const now = currentTime();
    const reference = profileRef(uid);
    const quarantinedPacksQuery = packsCollection()
      .where("sellerUid", "==", uid)
      .where("moderationStatus", "==", "quarantined")
      .limit(1);
    const stored = {
      schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
      sellerUid: uid,
      publicSellerId: rouletteTrainingPublicSellerId(uid),
      xPublic,
      xHandle: xPublic ? xHandle : "",
      updatedAt: now,
    };
    await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, quarantinedSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(quarantinedPacksQuery),
      ]);
      if (xPublic && !quarantinedSnapshot.empty) {
        throw httpsError(
          "failed-precondition",
          "安全確認中のパックがあります。内容を改訂して再公開するまでXリンクは公開できません。",
        );
      }
      transaction.set(reference, {
        ...stored,
        createdAt: safeInteger(profileSnapshot.get("createdAt"), 1, Number.MAX_SAFE_INTEGER, now),
      });
    });
    return { profile: publicProfile(stored) };
  }

  function validPackRankingCandidate(stats, pack) {
    if (!stats || !pack) return false;
    if (stats.isCurrentPublic !== true) return false;
    if (pack.status !== "active" || pack.moderationStatus !== "clear") return false;
    if (safeInteger(stats.uniqueBuyers) < PACK_RANKING_MINIMUM_UNIQUE_BUYERS
        || safeInteger(stats.rankingUseCount) < 1) return false;
    let rankingContentHash;
    let rankingId;
    try {
      rankingContentHash = rouletteTrainingRankingContentHash(storedItems(pack.items));
      rankingId = rouletteTrainingPackRankingId(stats.packId, rankingContentHash);
    } catch {
      return false;
    }
    return stats.packId
      && stats.packId === pack.id
      && stats.sellerUid === pack.sellerUid
      && stats.rankingContentHash === rankingContentHash
      && stats.packRankingId === rankingId;
  }

  function comparePackRankingRows(left, right) {
    const reachedAt = (value) => (
      typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : Number.MAX_SAFE_INTEGER
    );
    return safeInteger(right.stats.uniqueBuyers) - safeInteger(left.stats.uniqueBuyers)
      || safeInteger(right.stats.rankingUseCount) - safeInteger(left.stats.rankingUseCount)
      || reachedAt(left.stats.scoreReachedAt) - reachedAt(right.stats.scoreReachedAt)
      || String(left.stats.packId).localeCompare(String(right.stats.packId));
  }

  function publicPackRankingRow(entry, profile, rank, viewerUid = "") {
    const pack = publicPack(entry.pack, viewerUid);
    return {
      rank,
      packId: pack.id,
      title: pack.title,
      sellerName: pack.sellerName,
      publicSellerId: pack.publicSellerId,
      price: pack.price,
      revision: pack.revision,
      uniqueBuyers: safeInteger(entry.stats.uniqueBuyers),
      rankingUseCount: safeInteger(entry.stats.rankingUseCount),
      xPublic: profile.xPublic,
      xHandle: profile.xHandle,
      updatedAt: safeInteger(entry.stats.updatedAt),
      // The ranking order differs from the marketplace browse order, so a ranked
      // pack must carry its own server-validated current public snapshot. The
      // paid-use transaction still revalidates revision, price and ownership.
      pack,
    };
  }

  async function packRankings(uid, data) {
    requireUid(uid);
    assertAllowedKeys(data, ["action", "period"], "ランキング期間を選び直してください。");
    const period = String(data.period || "monthly");
    if (!["monthly", "lifetime"].includes(period)) {
      throw httpsError("invalid-argument", "ランキング期間を選び直してください。");
    }
    const now = currentTime();
    const periodKey = period === "monthly" ? rouletteTrainingJstMonthKey(now) : "lifetime";
    const collection = period === "monthly"
      ? firestore.collection("rouletteTrainingPackMonthlyPeriods").doc(periodKey).collection("entries")
      : firestore.collection("rouletteTrainingPackStats");
    const snapshot = await collection
      .where("isCurrentPublic", "==", true)
      .where("uniqueBuyers", ">=", PACK_RANKING_MINIMUM_UNIQUE_BUYERS)
      .orderBy("uniqueBuyers", "desc")
      .orderBy("rankingUseCount", "desc")
      .orderBy("scoreReachedAt", "asc")
      .orderBy("packId", "asc")
      .limit(PACK_RANKING_CANDIDATE_LIMIT)
      .get();
    const candidates = snapshot.docs
      .map((document) => ({ ...document.data(), documentId: document.id }))
      .filter((stats) => safeInteger(stats?.uniqueBuyers) >= PACK_RANKING_MINIMUM_UNIQUE_BUYERS
        && safeInteger(stats?.rankingUseCount) >= 1
        && stats.documentId === stats.packRankingId
        && /^[a-f0-9]{40}$/u.test(String(stats?.packId || "")));
    const packSnapshots = await Promise.all(candidates.map((stats) => packRef(stats.packId).get()));
    const entries = candidates
      .map((stats, index) => ({
        stats,
        pack: packSnapshots[index].exists
          ? { id: packSnapshots[index].id, ...packSnapshots[index].data() }
          : null,
      }))
      .filter((entry) => validPackRankingCandidate(entry.stats, entry.pack))
      .sort(comparePackRankingRows)
      .slice(0, PACK_RANKING_LIMIT);
    const sellerUids = [...new Set(entries.map((entry) => entry.stats.sellerUid))];
    const profileSnapshots = await Promise.all(sellerUids.map((sellerUid) => profileRef(sellerUid).get()));
    const profiles = new Map(sellerUids.map((sellerUid, index) => [
      sellerUid,
      publicProfile(profileSnapshots[index].data()),
    ]));
    let rank = 0;
    let previousScore = "";
    return {
      period,
      periodKey,
      minimumUniqueBuyers: PACK_RANKING_MINIMUM_UNIQUE_BUYERS,
      rows: entries.map((entry, index) => {
        const score = `${safeInteger(entry.stats.uniqueBuyers)}:${safeInteger(entry.stats.rankingUseCount)}`;
        if (score !== previousScore) rank = index + 1;
        previousScore = score;
        return publicPackRankingRow(
          entry,
          profiles.get(entry.stats.sellerUid) || publicProfile(),
          rank,
          uid,
        );
      }),
      updatedAt: now,
    };
  }

  async function creatorStats(uid, data) {
    requireUid(uid);
    assertAllowedKeys(data, ["action"], "作者の販売実績取得にはトレーニング情報を送信しないでください。");
    const achievementState = await ensureAchievementState(uid);
    if (achievementState?.newlyUnlocked?.length) {
      await bestEffort("rouletteTraining creator achievement", [
        syncAchievementPublicSurfaces(uid, achievementState.profile),
      ]);
    }
    const now = currentTime();
    const periodKey = rouletteTrainingJstMonthKey(now);
    const [statsSnapshot, monthlySnapshot, packsSnapshot, profileSnapshot] = await Promise.all([
      sellerStatsRef(uid).get(),
      monthlyEntryRef(periodKey, uid).get(),
      packsCollection()
        .where("sellerUid", "==", uid)
        .orderBy("updatedAt", "desc")
        .limit(ROULETTE_TRAINING_SELLER_PACK_MAX)
        .get(),
      profileRef(uid).get(),
    ]);
    const packs = packsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const rankingDetails = packs.map((pack) => {
      try {
        const rankingContentHash = rouletteTrainingRankingContentHash(storedItems(pack.items));
        return {
          rankingContentHash,
          rankingId: rouletteTrainingPackRankingId(pack.id, rankingContentHash),
        };
      } catch {
        return { rankingContentHash: "", rankingId: "" };
      }
    });
    const rankingSnapshots = await Promise.all(rankingDetails.map(({ rankingId }) => (
      rankingId ? packStatsRef(rankingId).get() : Promise.resolve(null)
    )));
    return {
      profile: publicProfile(profileSnapshot.data()),
      achievements: publicAchievementProfile(
        achievementState?.profile,
        null,
        null,
        null,
        null,
        null,
        statsSnapshot.data(),
      ),
      periodKey,
      lifetime: publicCreatorStats(statsSnapshot.data(), { includePackCount: true }),
      monthly: publicCreatorStats(monthlySnapshot.data()),
      packs: packs.map((pack, index) => {
        const { rankingContentHash, rankingId } = rankingDetails[index];
        const normalized = normalizedPackStats(
          rankingSnapshots[index]?.data(),
          pack.id,
          pack,
          rankingContentHash,
          rankingId,
        );
        const uniqueBuyers = safeInteger(normalized.uniqueBuyers);
        const rankingUseCount = safeInteger(normalized.rankingUseCount);
        return {
          id: pack.id,
          title: safeOneLine(pack.title, 30, "トレーニングパック"),
          status: pack.status === "active" ? "active" : "hidden",
          moderationStatus: pack.moderationStatus === "clear"
            ? "clear"
            : (pack.moderationStatus === "quarantined" ? "quarantined" : "pending"),
          price: ROULETTE_TRAINING_PRICE_OPTIONS.includes(pack.price) ? pack.price : 5,
          revision: safeInteger(pack.revision, 1, 1_000_000, 1),
          uniqueBuyers,
          rankingUseCount,
          remainingUniqueBuyers: Math.max(
            0,
            PACK_RANKING_MINIMUM_UNIQUE_BUYERS - uniqueBuyers,
          ),
          eligible: pack.status === "active"
            && pack.moderationStatus === "clear"
            && Boolean(rankingContentHash)
            && normalized.isCurrentPublic === true
            && uniqueBuyers >= PACK_RANKING_MINIMUM_UNIQUE_BUYERS
            && rankingUseCount >= 1,
          updatedAt: safeInteger(normalized.updatedAt),
        };
      }),
      updatedAt: now,
    };
  }

  async function publish(uid, data) {
    requireUid(uid);
    const expectedBalance = Number(data?.expectedBalance);
    if (!Number.isSafeInteger(expectedBalance) || expectedBalance < 0) {
      throw httpsError("invalid-argument", "公開確認時のAnjuPay残高を読み直してください。");
    }
    let actionId;
    let input;
    try {
      actionId = normalizeRouletteTrainingActionId(data?.actionId);
      input = normalizeRouletteTrainingPackInput(data);
    } catch (error) {
      throw mapHelperError(error);
    }
    const id = input.packId || rouletteTrainingPackId(uid, actionId);
    const normalizedPayload = { ...input, packId: id };
    const payloadHash = rouletteTrainingPayloadHash(normalizedPayload);
    const moderationPayloadHash = rouletteTrainingPayloadHash(moderationPayload(input));
    const rankingContentHash = rouletteTrainingRankingContentHash(input.items);
    const packRankingId = rouletteTrainingPackRankingId(id, rankingContentHash);
    const publishedAt = currentTime();
    const periodKey = rouletteTrainingJstMonthKey(publishedAt);
    const actionReference = publishActionRef(uid, actionId);
    const reference = packRef(id);
    const walletReference = walletRef(uid);
    const statsReference = sellerStatsRef(uid);
    const packStatsReference = packStatsRef(packRankingId);
    const packMonthlyReference = packMonthlyEntryRef(periodKey, packRankingId);
    await ensureWallet(uid);

    let result;
    await firestore.runTransaction(async (transaction) => {
      const [
        actionSnapshot,
        currentSnapshot,
        walletSnapshot,
        ledgerConfigSnapshot,
        statsSnapshot,
        packStatsSnapshot,
        packMonthlySnapshot,
      ] =
        await Promise.all([
          transaction.get(actionReference),
          transaction.get(reference),
          transaction.get(walletReference),
          transaction.get(anjuPayLedgerConfigRef()),
          transaction.get(statsReference),
          transaction.get(packStatsReference),
          transaction.get(packMonthlyReference),
        ]);

      if (actionSnapshot.exists) {
        const saved = actionSnapshot.data();
        if (saved.sellerUid !== uid || saved.payloadHash !== payloadHash) {
          throw httpsError(
            "already-exists",
            "同じ操作IDが別の公開内容で使われています。画面を読み直してください。",
          );
        }
        result = {
          pack: publicPack({ ...saved.pack, sellerUid: uid }, uid),
          balance: walletData(walletSnapshot).balance,
          publishFee: ROULETTE_TRAINING_PUBLISH_FEE,
          idempotent: true,
        };
        return;
      }

      if (currentSnapshot.exists && currentSnapshot.get("sellerUid") !== uid) {
        throw httpsError("not-found", "自分のトレーニングパックを確認できませんでした。");
      }
      const currentRevision = currentSnapshot.exists
        ? safeInteger(currentSnapshot.get("revision"))
        : 0;
      if (input.baseRevision !== currentRevision) {
        throw httpsError(
          "failed-precondition",
          "パックが別の画面で更新されています。最新内容を読み直してください。",
        );
      }
      const currentPackCount = safeInteger(statsSnapshot.get("packCount"));
      if (!currentSnapshot.exists
          && currentPackCount >= ROULETTE_TRAINING_SELLER_PACK_MAX) {
        throw httpsError(
          "resource-exhausted",
          `販売パックは1作者${ROULETTE_TRAINING_SELLER_PACK_MAX}件までです。既存パックを改訂してください。`,
        );
      }
      if (currentSnapshot.exists
          && currentSnapshot.get("moderationStatus") === "quarantined"
          && currentSnapshot.get("moderationPayloadHash") === moderationPayloadHash) {
        throw httpsError(
          "failed-precondition",
          "安全上の通報で非公開になったパックは、本文または応援台詞を見直してから再公開してください。",
        );
      }

      let previousPackRankingId = "";
      let previousPackStatsSnapshot = null;
      let previousPackMonthlySnapshot = null;
      let previousPackStatsReference = null;
      let previousPackMonthlyReference = null;
      if (currentSnapshot.exists) {
        const previousRankingContentHash = rouletteTrainingRankingContentHash(
          storedItems(currentSnapshot.get("items")),
        );
        previousPackRankingId = rouletteTrainingPackRankingId(id, previousRankingContentHash);
        if (previousPackRankingId !== packRankingId) {
          previousPackStatsReference = packStatsRef(previousPackRankingId);
          previousPackMonthlyReference = packMonthlyEntryRef(periodKey, previousPackRankingId);
          [previousPackStatsSnapshot, previousPackMonthlySnapshot] = await Promise.all([
            transaction.get(previousPackStatsReference),
            transaction.get(previousPackMonthlyReference),
          ]);
        }
      }

      const wallet = walletData(walletSnapshot);
      if (wallet.balance !== expectedBalance) {
        throw httpsError(
          "failed-precondition",
          "AnjuPay残高が公開確認画面から変わりました。公開後残高をもう一度確認してください。",
        );
      }
      const now = publishedAt;
      stageAnjuPayOpening(
        transaction,
        walletReference,
        wallet,
        ledgerConfigSnapshot,
        now,
      );
      const balanceBefore = wallet.balance;
      debitPoints(wallet, ROULETTE_TRAINING_PUBLISH_FEE);
      const nextRevision = currentRevision + 1;
      const previousItems = currentSnapshot.exists
        ? storedItems(currentSnapshot.get("items"))
        : [];
      const observedNextItemSequence = previousItems.reduce((maximum, item) => {
        const match = /^item-(\d+)$/u.exec(item.itemId);
        return match ? Math.max(maximum, Number(match[1]) + 1) : maximum;
      }, 1);
      let nextItemSequence = currentSnapshot.exists
        ? safeInteger(
          currentSnapshot.get("nextItemSequence"),
          1,
          1_000_000,
          observedNextItemSequence,
        )
        : 1;
      nextItemSequence = Math.max(nextItemSequence, observedNextItemSequence);
      const usedItemIds = new Set();
      const items = input.items.map((item, index) => {
        let itemId = safeOneLine(previousItems[index]?.itemId, 40);
        if (!itemId || usedItemIds.has(itemId)) {
          do {
            itemId = `item-${String(nextItemSequence).padStart(2, "0")}`;
            nextItemSequence += 1;
          } while (usedItemIds.has(itemId));
        }
        usedItemIds.add(itemId);
        return { itemId, ...item };
      });
      const storedPack = {
        schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
        sellerUid: uid,
        publicSellerId: rouletteTrainingPublicSellerId(uid),
        sellerName: input.sellerName,
        title: input.title,
        description: input.description,
        price: input.price,
        revision: nextRevision,
        itemCount: items.length,
        items,
        rankingContentHash,
        packRankingId,
        nextItemSequence,
        moderationPayloadHash,
        status: "active",
        moderationStatus: "clear",
        paidUseCount: safeInteger(currentSnapshot.get("paidUseCount")),
        rankingUseCount: safeInteger(currentSnapshot.get("rankingUseCount")),
        lastPaidUseAt: safeInteger(currentSnapshot.get("lastPaidUseAt")),
        reportCount: safeInteger(currentSnapshot.get("reportCount")),
        revisionReportCount: 0,
        revisionHighRiskBuyerReportCount: 0,
        createdAt: currentSnapshot.exists
          ? safeInteger(currentSnapshot.get("createdAt"), 1, Number.MAX_SAFE_INTEGER, now)
          : now,
        updatedAt: now,
      };
      const groupId = anjuPayEntryId(`roulette-training-publish:${actionReference.id}`);
      appendAnjuPayEntry(transaction, walletReference, wallet, ledgerConfigSnapshot, {
        entryId: groupId,
        groupId,
        kind: "roulette_training_publish",
        category: "market",
        labelKey: "anju_pay_roulette_training_publish",
        status: "posted",
        delta: -ROULETTE_TRAINING_PUBLISH_FEE,
        nominalAmount: ROULETTE_TRAINING_PUBLISH_FEE,
        balanceBefore,
        balanceAfter: wallet.balance,
        components: [{
          kind: "publish_fee",
          labelKey: "anju_pay_roulette_training_publish_fee",
          delta: -ROULETTE_TRAINING_PUBLISH_FEE,
          nominalAmount: ROULETTE_TRAINING_PUBLISH_FEE,
          status: "posted",
        }],
        details: {
          productId: id,
          listingTitle: input.title,
          itemCount: items.length,
        },
        occurredAt: now,
      });
      transaction.update(walletReference, {
        balance: wallet.balance,
        ...anjuPayWalletMetadataPatch(wallet),
        updatedAt: now,
      });
      if (currentSnapshot.exists) transaction.set(reference, storedPack);
      else transaction.create(reference, storedPack);
      transaction.create(revisionRef(id, nextRevision), storedPack);
      if (previousPackStatsSnapshot?.exists && previousPackStatsReference) {
        transaction.set(previousPackStatsReference, {
          isCurrentPublic: false,
          updatedAt: now,
        }, { merge: true });
      }
      if (previousPackMonthlySnapshot?.exists && previousPackMonthlyReference) {
        transaction.set(previousPackMonthlyReference, {
          isCurrentPublic: false,
          updatedAt: now,
        }, { merge: true });
      }
      transaction.set(packStatsReference, {
        ...normalizedPackStats(
          packStatsSnapshot.data(),
          id,
          storedPack,
          rankingContentHash,
          packRankingId,
        ),
        isCurrentPublic: true,
        updatedAt: now,
      });
      transaction.set(packMonthlyReference, {
        ...normalizedPackStats(
          packMonthlySnapshot.data(),
          id,
          storedPack,
          rankingContentHash,
          packRankingId,
          periodKey,
        ),
        isCurrentPublic: true,
        updatedAt: now,
      });
      if (!currentSnapshot.exists) {
        transaction.set(statsReference, {
          ...normalizedSellerStats(statsSnapshot.data(), uid, storedPack),
          packCount: currentPackCount + 1,
          updatedAt: now,
        });
      }
      const savedPublicPack = publicPack({ id, ...storedPack, sellerUid: uid }, uid);
      transaction.create(actionReference, {
        schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
        sellerUid: uid,
        payloadHash,
        pack: savedPublicPack,
        balanceAfter: wallet.balance,
        createdAt: now,
      });
      result = {
        pack: savedPublicPack,
        balance: wallet.balance,
        publishFee: ROULETTE_TRAINING_PUBLISH_FEE,
        idempotent: false,
      };
    });
    await mirrorBalances({ [uid]: result.balance });
    return result;
  }

  async function unpublish(uid, data) {
    requireUid(uid);
    assertAllowedKeys(data, ["action", "packId"], "非公開にするパックを読み直してください。");
    let id;
    try {
      id = normalizeRouletteTrainingDocumentId(data.packId);
    } catch (error) {
      throw mapHelperError(error);
    }
    const reference = packRef(id);
    const unpublishedAt = currentTime();
    const periodKey = rouletteTrainingJstMonthKey(unpublishedAt);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.get("sellerUid") !== uid) {
        throw httpsError("not-found", "自分のトレーニングパックを確認できませんでした。");
      }
      const current = snapshot.data();
      let rankingId = "";
      try {
        const rankingContentHash = rouletteTrainingRankingContentHash(storedItems(current.items));
        rankingId = rouletteTrainingPackRankingId(id, rankingContentHash);
      } catch {
        // Invalid legacy content can still be hidden; it simply has no ranking document to disable.
      }
      const currentPackStatsReference = rankingId ? packStatsRef(rankingId) : null;
      const currentPackMonthlyReference = rankingId
        ? packMonthlyEntryRef(periodKey, rankingId)
        : null;
      const [packStatsSnapshot, packMonthlySnapshot] = rankingId
        ? await Promise.all([
          transaction.get(currentPackStatsReference),
          transaction.get(currentPackMonthlyReference),
        ])
        : [null, null];
      const now = unpublishedAt;
      const next = { ...current, status: "hidden", updatedAt: now };
      if (current.status !== "hidden") {
        transaction.update(reference, { status: "hidden", updatedAt: now });
      }
      if (packStatsSnapshot?.exists) {
        transaction.set(currentPackStatsReference, {
          isCurrentPublic: false,
          updatedAt: now,
        }, { merge: true });
      }
      if (packMonthlySnapshot?.exists) {
        transaction.set(currentPackMonthlyReference, {
          isCurrentPublic: false,
          updatedAt: now,
        }, { merge: true });
      }
      result = {
        pack: publicPack({ id, ...(current.status === "hidden" ? current : next) }, uid),
        idempotent: current.status === "hidden",
      };
    });
    return result;
  }

  async function startPaidUse(uid, data) {
    requireUid(uid);
    assertAllowedKeys(
      data,
      ["action", "actionId", "packId", "expectedRevision", "expectedPrice", "expectedBalance"],
      "購入開始には画像・BPM・抽選・回数・達成結果を送信しないでください。",
    );
    let actionId;
    let id;
    try {
      actionId = normalizeRouletteTrainingActionId(data.actionId);
      id = normalizeRouletteTrainingDocumentId(data.packId);
    } catch (error) {
      throw mapHelperError(error);
    }
    const expectedPrice = Number(data.expectedPrice);
    const expectedRevision = Number(data.expectedRevision);
    const expectedBalance = Number(data.expectedBalance);
    if (!ROULETTE_TRAINING_PRICE_OPTIONS.includes(expectedPrice)
        || !Number.isSafeInteger(expectedRevision)
        || expectedRevision < 1
        || !Number.isSafeInteger(expectedBalance)
        || expectedBalance < 0) {
      throw httpsError("invalid-argument", "価格・改訂番号・確認残高を読み直してください。");
    }
    const payloadHash = rouletteTrainingPayloadHash({
      packId: id,
      expectedRevision,
      expectedPrice,
    });
    const useId = rouletteTrainingUseId(uid, actionId);
    const reference = packRef(id);
    const preliminarySnapshot = await reference.get();
    if (!preliminarySnapshot.exists) {
      throw httpsError("not-found", "トレーニングパックを確認できませんでした。");
    }
    const preliminarySellerUid = preliminarySnapshot.get("sellerUid");
    requireUid(preliminarySellerUid);
    let preliminaryRankingContentHash;
    let preliminaryPackRankingId;
    try {
      preliminaryRankingContentHash = rouletteTrainingRankingContentHash(
        storedItems(preliminarySnapshot.get("items")),
      );
      preliminaryPackRankingId = rouletteTrainingPackRankingId(
        id,
        preliminaryRankingContentHash,
      );
    } catch (error) {
      throw mapHelperError(error);
    }
    const selfPreview = preliminarySellerUid === uid;
    await Promise.all(selfPreview
      ? [ensureWallet(uid)]
      : [ensureWallet(uid), ensureWallet(preliminarySellerUid)]);

    const useReference = useRef(useId);
    const activeReference = activeUseRef(uid);
    const buyerWalletReference = walletRef(uid);
    const sellerWalletReference = walletRef(preliminarySellerUid);
    const buyerProofReference = revisionBuyerRef(id, expectedRevision, uid);
    const startedAt = currentTime();
    const dateKey = rouletteTrainingJstDateKey(startedAt);
    const periodKey = rouletteTrainingJstMonthKey(startedAt);
    const statsReference = sellerStatsRef(preliminarySellerUid);
    const monthlyReference = monthlyEntryRef(periodKey, preliminarySellerUid);
    const dailyPairReference = rankingPairRef(dateKey, preliminarySellerUid, uid);
    const lifetimeBuyerPairReference = sellerBuyerPairRef(preliminarySellerUid, uid);
    const monthBuyerPairReference = monthlyBuyerPairRef(
      periodKey,
      preliminarySellerUid,
      uid,
    );
    const packStatsReference = packStatsRef(preliminaryPackRankingId);
    const packMonthlyReference = packMonthlyEntryRef(periodKey, preliminaryPackRankingId);
    const packDailyPairReference = packRankingPairRef(
      dateKey,
      preliminaryPackRankingId,
      uid,
    );
    const packLifetimeBuyerPairReference = packBuyerPairRef(
      preliminaryPackRankingId,
      uid,
    );
    const packMonthBuyerPairReference = packMonthlyBuyerPairRef(
      periodKey,
      preliminaryPackRankingId,
      uid,
    );
    const sellerAchievementReference = achievementProfileRef(preliminarySellerUid);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const reads = [
        transaction.get(useReference),
        transaction.get(reference),
        transaction.get(activeReference),
        transaction.get(buyerWalletReference),
        transaction.get(anjuPayLedgerConfigRef()),
        transaction.get(sellerWalletReference),
        transaction.get(buyerProofReference),
        transaction.get(statsReference),
        transaction.get(monthlyReference),
        transaction.get(dailyPairReference),
        transaction.get(lifetimeBuyerPairReference),
        transaction.get(monthBuyerPairReference),
        transaction.get(packStatsReference),
        transaction.get(packMonthlyReference),
        transaction.get(packDailyPairReference),
        transaction.get(packLifetimeBuyerPairReference),
        transaction.get(packMonthBuyerPairReference),
        transaction.get(sellerAchievementReference),
      ];
      const snapshots = await Promise.all(reads);
      const [
        useSnapshot,
        packDocument,
        activeSnapshot,
        buyerWalletSnapshot,
        ledgerConfigSnapshot,
      ] = snapshots;
      const sellerWalletSnapshot = snapshots[5];
      const buyerProofSnapshot = snapshots[6];
      const statsSnapshot = snapshots[7];
      const monthlySnapshot = snapshots[8];
      const dailyPairSnapshot = snapshots[9];
      const lifetimeBuyerPairSnapshot = snapshots[10];
      const monthBuyerPairSnapshot = snapshots[11];
      const packStatsSnapshot = snapshots[12];
      const packMonthlySnapshot = snapshots[13];
      const packDailyPairSnapshot = snapshots[14];
      const packLifetimeBuyerPairSnapshot = snapshots[15];
      const packMonthBuyerPairSnapshot = snapshots[16];
      const sellerAchievementSnapshot = snapshots[17];

      if (useSnapshot.exists) {
        const saved = useSnapshot.data();
        if (saved.buyerUid !== uid || saved.payloadHash !== payloadHash) {
          throw httpsError(
            "already-exists",
            "同じ操作IDが別の利用内容で使われています。画面を読み直してください。",
          );
        }
        const stillActive = saved.status === ACTIVE_USE_STATUS
          && activeSnapshot.exists
          && activeSnapshot.get("useId") === useId;
        result = stillActive
          ? { use: publicUse(saved), charged: saved.charged === true, idempotent: true }
          : { terminalAction: true, charged: saved.charged === true, idempotent: true };
        return;
      }
      if (activeSnapshot.exists && activeSnapshot.get("useId") !== useId) {
        throw httpsError(
          "failed-precondition",
          "開始済みのルーレットトレーニングがあります。先にそのセッションを再開してください。",
        );
      }
      if (!packDocument.exists
          || packDocument.get("status") !== "active"
          || packDocument.get("moderationStatus") !== "clear") {
        throw httpsError("not-found", "このトレーニングパックは現在利用できません。");
      }
      const pack = packDocument.data();
      if (pack.sellerUid !== preliminarySellerUid) {
        throw httpsError("failed-precondition", "作者情報が更新されています。パックを読み直してください。");
      }
      if (safeInteger(pack.price) !== expectedPrice
          || safeInteger(pack.revision) !== expectedRevision) {
        throw httpsError(
          "failed-precondition",
          "価格またはパックが更新されています。決済前に全文をもう一度確認してください。",
        );
      }
      let rankingContentHash;
      let packRankingId;
      try {
        rankingContentHash = rouletteTrainingRankingContentHash(storedItems(pack.items));
        packRankingId = rouletteTrainingPackRankingId(id, rankingContentHash);
      } catch (error) {
        throw mapHelperError(error);
      }
      if (rankingContentHash !== preliminaryRankingContentHash
          || packRankingId !== preliminaryPackRankingId) {
        throw httpsError(
          "failed-precondition",
          "パック内容が更新されています。決済前に全文をもう一度確認してください。",
        );
      }
      const buyerWallet = walletData(buyerWalletSnapshot);
      if (buyerWallet.balance !== expectedBalance) {
        throw httpsError(
          "failed-precondition",
          "AnjuPay残高が確認画面から変わりました。支払後残高をもう一度確認してください。",
        );
      }

      const now = startedAt;
      const snapshot = packSnapshot(id, pack);
      let settlement = { price: 0, fee: 0, sellerProceeds: 0 };
      let sellerWallet = null;
      let buyerBefore = buyerWallet.balance;
      let sellerBefore = 0;
      let sellerAchievementResult = null;
      const rankingCounted = !selfPreview && !dailyPairSnapshot.exists;
      const uniqueLifetimeBuyer = !selfPreview && !lifetimeBuyerPairSnapshot.exists;
      const uniqueMonthlyBuyer = !selfPreview && !monthBuyerPairSnapshot.exists;
      const packRankingCounted = !selfPreview && !packDailyPairSnapshot.exists;
      const uniquePackBuyer = !selfPreview && !packLifetimeBuyerPairSnapshot.exists;
      const uniqueMonthlyPackBuyer = !selfPreview && !packMonthBuyerPairSnapshot.exists;
      if (!selfPreview) {
        settlement = rouletteTrainingSaleSettlement(expectedPrice);
        sellerWallet = walletData(sellerWalletSnapshot);
        sellerBefore = sellerWallet.balance;
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
      }
      const storedUse = {
        schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
        id: useId,
        buyerUid: uid,
        sellerUid: preliminarySellerUid,
        actionId,
        payloadHash,
        packId: id,
        packRevision: expectedRevision,
        packSnapshot: snapshot,
        status: ACTIVE_USE_STATUS,
        charged: !selfPreview,
        price: settlement.price,
        fee: settlement.fee,
        sellerProceeds: settlement.sellerProceeds,
        buyerBalanceAfter: buyerWallet.balance,
        rankingCounted,
        packRankingCounted,
        uniquePackBuyer,
        uniqueMonthlyPackBuyer,
        rankingContentHash,
        packRankingId,
        dateKey,
        periodKey,
        startedAt: now,
        finishedAt: 0,
      };

      if (!selfPreview) {
        const groupId = anjuPayEntryId(`roulette-training-use:${useId}`);
        appendAnjuPayEntry(
          transaction,
          buyerWalletReference,
          buyerWallet,
          ledgerConfigSnapshot,
          {
            entryId: groupId,
            groupId,
            kind: "roulette_training_use",
            category: "market",
            labelKey: "anju_pay_roulette_training_use",
            status: "posted",
            delta: -settlement.price,
            nominalAmount: settlement.price,
            balanceBefore: buyerBefore,
            balanceAfter: buyerWallet.balance,
            components: [{
              kind: "training_pack_use",
              labelKey: "anju_pay_roulette_training_use",
              delta: -settlement.price,
              nominalAmount: settlement.price,
              status: "posted",
            }],
            details: {
              productId: id,
              listingTitle: pack.title,
              publicSellerId: pack.publicSellerId,
              counterpartyName: pack.sellerName,
              revision: expectedRevision,
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
            kind: "roulette_training_sale",
            category: "market",
            labelKey: "anju_pay_roulette_training_sale",
            status: "posted",
            delta: settlement.sellerProceeds,
            nominalAmount: settlement.price,
            balanceBefore: sellerBefore,
            balanceAfter: sellerWallet.balance,
            components: [{
              kind: "training_pack_sale",
              labelKey: "anju_pay_roulette_training_sale",
              delta: settlement.sellerProceeds,
              nominalAmount: settlement.price,
              status: "posted",
            }],
            details: {
              productId: id,
              listingTitle: pack.title,
              revision: expectedRevision,
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
        if (!buyerProofSnapshot.exists) {
          transaction.create(buyerProofReference, {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: preliminarySellerUid,
            buyerUid: uid,
            packId: id,
            packRevision: expectedRevision,
            packSnapshot: snapshot,
            firstUseId: useId,
            createdAt: now,
          });
        }
        const nextStats = addSaleToStats(
          normalizedSellerStats(statsSnapshot.data(), preliminarySellerUid, pack),
          settlement,
          rankingCounted,
          uniqueLifetimeBuyer,
          now,
        );
        const nextMonthly = addSaleToStats(
          normalizedSellerStats(
            monthlySnapshot.data(),
            preliminarySellerUid,
            pack,
            periodKey,
          ),
          settlement,
          rankingCounted,
          uniqueMonthlyBuyer,
          now,
        );
        sellerAchievementResult = unlockAchievements(
          sellerAchievementSnapshot.data(),
          eligibleAchievementIds({
            rouletteTrainingStats: normalizeRouletteTrainingStats(nextStats),
            scope: "roulette_training",
          }),
          now,
        );
        const nextPackStats = addSaleToPackStats(
          normalizedPackStats(
            packStatsSnapshot.data(),
            id,
            pack,
            rankingContentHash,
            packRankingId,
          ),
          settlement,
          packRankingCounted,
          uniquePackBuyer,
          now,
        );
        const nextPackMonthly = addSaleToPackStats(
          normalizedPackStats(
            packMonthlySnapshot.data(),
            id,
            pack,
            rankingContentHash,
            packRankingId,
            periodKey,
          ),
          settlement,
          packRankingCounted,
          uniqueMonthlyPackBuyer,
          now,
        );
        transaction.set(statsReference, nextStats);
        transaction.set(monthlyReference, nextMonthly);
        if (!sellerAchievementSnapshot.exists
            || sellerAchievementResult.newlyUnlocked.length) {
          transaction.set(sellerAchievementReference, sellerAchievementResult.profile);
        }
        transaction.set(packStatsReference, nextPackStats);
        transaction.set(packMonthlyReference, nextPackMonthly);
        if (!dailyPairSnapshot.exists) {
          transaction.create(dailyPairReference, {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: preliminarySellerUid,
            buyerUid: uid,
            dateKey,
            periodKey,
            firstUseId: useId,
            rankingGross: settlement.price,
            createdAt: now,
          });
        }
        if (!lifetimeBuyerPairSnapshot.exists) {
          transaction.create(lifetimeBuyerPairReference, {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: preliminarySellerUid,
            buyerUid: uid,
            firstUseId: useId,
            createdAt: now,
          });
        }
        if (!monthBuyerPairSnapshot.exists) {
          transaction.create(monthBuyerPairReference, {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: preliminarySellerUid,
            buyerUid: uid,
            periodKey,
            firstUseId: useId,
            createdAt: now,
          });
        }
        if (!packDailyPairSnapshot.exists) {
          transaction.create(packDailyPairReference, {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: preliminarySellerUid,
            buyerUid: uid,
            packId: id,
            rankingContentHash,
            packRankingId,
            dateKey,
            periodKey,
            firstUseId: useId,
            rankingGross: settlement.price,
            createdAt: now,
          });
        }
        if (!packLifetimeBuyerPairSnapshot.exists) {
          transaction.create(packLifetimeBuyerPairReference, {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: preliminarySellerUid,
            buyerUid: uid,
            packId: id,
            rankingContentHash,
            packRankingId,
            firstUseId: useId,
            createdAt: now,
          });
        }
        if (!packMonthBuyerPairSnapshot.exists) {
          transaction.create(packMonthBuyerPairReference, {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: preliminarySellerUid,
            buyerUid: uid,
            packId: id,
            rankingContentHash,
            packRankingId,
            periodKey,
            firstUseId: useId,
            createdAt: now,
          });
        }
        transaction.update(reference, {
          paidUseCount: safeInteger(pack.paidUseCount) + 1,
          rankingUseCount: safeInteger(pack.rankingUseCount) + (rankingCounted ? 1 : 0),
          rankingContentHash,
          packRankingId,
          lastPaidUseAt: now,
        });
      }
      transaction.create(useReference, storedUse);
      transaction.set(activeReference, {
        schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
        buyerUid: uid,
        useId,
        startedAt: now,
      });
      result = {
        use: publicUse(storedUse),
        charged: !selfPreview,
        idempotent: false,
        _balances: selfPreview ? {} : {
          [uid]: buyerWallet.balance,
          [preliminarySellerUid]: sellerWallet.balance,
        },
        _achievementProfile: !selfPreview
            && sellerAchievementResult?.newlyUnlocked?.length
          ? sellerAchievementResult.profile
          : null,
      };
    });
    await mirrorBalances(result._balances || {});
    if (result._achievementProfile) {
      await bestEffort("rouletteTraining seller achievement", [
        syncAchievementPublicSurfaces(preliminarySellerUid, result._achievementProfile),
      ]);
    }
    delete result._balances;
    delete result._achievementProfile;
    return result;
  }

  async function resumeUse(uid, data) {
    requireUid(uid);
    assertAllowedKeys(data, ["action", "useId"], "再開する利用記録を読み直してください。");
    let useId;
    try {
      useId = normalizeRouletteTrainingDocumentId(data.useId, "利用記録");
    } catch (error) {
      throw mapHelperError(error);
    }
    const [snapshot, activeSnapshot] = await Promise.all([
      useRef(useId).get(),
      activeUseRef(uid).get(),
    ]);
    if (!snapshot.exists || snapshot.get("buyerUid") !== uid) {
      throw httpsError("not-found", "再開できるルーレットトレーニングを確認できませんでした。");
    }
    if (snapshot.get("status") !== ACTIVE_USE_STATUS
        || !activeSnapshot.exists
        || activeSnapshot.get("useId") !== useId) {
      throw httpsError(
        "failed-precondition",
        "このセッションは終了済みです。もう一度使う場合は新しい利用確認が必要です。",
      );
    }
    return { use: publicUse(snapshot.data()) };
  }

  async function finishUse(uid, data) {
    requireUid(uid);
    assertAllowedKeys(
      data,
      ["action", "useId"],
      "終了時には画像・BPM・抽選・回数・クリア・ギブアップ・達成結果を送信しないでください。",
    );
    let useId;
    try {
      useId = normalizeRouletteTrainingDocumentId(data.useId, "利用記録");
    } catch (error) {
      throw mapHelperError(error);
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
      if (stored.status !== ACTIVE_USE_STATUS) {
        if (activeSnapshot.exists && activeSnapshot.get("useId") === useId) {
          transaction.delete(activeReference);
        }
        result = { use: publicUse(stored), idempotent: true };
        return;
      }
      const now = currentTime();
      const next = {
        ...stored,
        status: FINISHED_USE_STATUS,
        finishedAt: now,
      };
      transaction.update(reference, {
        status: FINISHED_USE_STATUS,
        finishedAt: now,
      });
      if (stored.charged === true) {
        transaction.set(
          revisionBuyerRef(stored.packId, stored.packRevision, uid),
          {
            schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
            sellerUid: stored.sellerUid,
            buyerUid: uid,
            packId: stored.packId,
            packRevision: stored.packRevision,
            packSnapshot: stored.packSnapshot,
            lastUseId: useId,
            lastStartedAt: safeInteger(stored.startedAt),
            lastUsedAt: now,
            price: safeInteger(stored.price),
            fee: safeInteger(stored.fee),
            sellerProceeds: safeInteger(stored.sellerProceeds),
            buyerBalanceAfter: safeInteger(stored.buyerBalanceAfter),
            rankingCounted: stored.rankingCounted === true,
          },
          { merge: true },
        );
      }
      if (activeSnapshot.exists && activeSnapshot.get("useId") === useId) {
        transaction.delete(activeReference);
      }
      result = { use: publicUse(next), idempotent: false };
    });
    return result;
  }

  async function report(uid, data) {
    requireUid(uid);
    assertAllowedKeys(
      data,
      ["action", "packId", "expectedRevision", "reason"],
      "通報にはパック・改訂番号・理由だけを送信してください。",
    );
    let id;
    try {
      id = normalizeRouletteTrainingDocumentId(data.packId);
    } catch (error) {
      throw mapHelperError(error);
    }
    const expectedRevision = Number(data.expectedRevision);
    const reason = String(data.reason || "");
    if (!Number.isSafeInteger(expectedRevision)
        || expectedRevision < 1
        || !isRouletteTrainingReportReason(reason)) {
      throw httpsError("invalid-argument", "通報対象と理由を確認してください。");
    }
    const reference = packRef(id);
    const historicalReference = revisionRef(id, expectedRevision);
    const proofReference = revisionBuyerRef(id, expectedRevision, uid);
    const reportReference = reportRef(id, expectedRevision, uid);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const [
        existingReport,
        historicalSnapshot,
        proofSnapshot,
        currentSnapshot,
      ] = await Promise.all([
        transaction.get(reportReference),
        transaction.get(historicalReference),
        transaction.get(proofReference),
        transaction.get(reference),
      ]);
      if (existingReport.exists) {
        result = {
          accepted: true,
          quarantined: existingReport.get("quarantined") === true,
          idempotent: true,
        };
        return;
      }
      if (!historicalSnapshot.exists) {
        throw httpsError("not-found", "通報対象の改訂を確認できませんでした。");
      }
      const historical = historicalSnapshot.data();
      if (historical.sellerUid === uid || !proofSnapshot.exists) {
        throw httpsError("permission-denied", "この改訂を有料利用した記録を確認できませんでした。");
      }
      const now = currentTime();
      const highRisk = HIGH_RISK_REPORT_REASONS.has(reason);
      const currentIsReportedRevision = currentSnapshot.exists
        && safeInteger(currentSnapshot.get("revision")) === expectedRevision;
      const nextHighRiskCount = currentIsReportedRevision
        ? safeInteger(currentSnapshot.get("revisionHighRiskBuyerReportCount")) + (highRisk ? 1 : 0)
        : 0;
      const quarantined = currentIsReportedRevision
        && highRisk
        && nextHighRiskCount >= VERIFIED_BUYER_QUARANTINE_THRESHOLD;
      const sellerProfileReference = quarantined ? profileRef(historical.sellerUid) : null;
      let quarantinedPackStatsReference = null;
      let quarantinedPackMonthlyReference = null;
      if (quarantined) {
        const currentRankingContentHash = rouletteTrainingRankingContentHash(
          storedItems(currentSnapshot.get("items")),
        );
        const currentPackRankingId = rouletteTrainingPackRankingId(
          id,
          currentRankingContentHash,
        );
        quarantinedPackStatsReference = packStatsRef(currentPackRankingId);
        quarantinedPackMonthlyReference = packMonthlyEntryRef(
          rouletteTrainingJstMonthKey(now),
          currentPackRankingId,
        );
      }
      const [sellerProfileSnapshot, quarantinedPackStatsSnapshot, quarantinedPackMonthlySnapshot] =
        quarantined
          ? await Promise.all([
            transaction.get(sellerProfileReference),
            transaction.get(quarantinedPackStatsReference),
            transaction.get(quarantinedPackMonthlyReference),
          ])
          : [null, null, null];
      transaction.create(reportReference, {
        schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
        reporterUid: uid,
        sellerUid: historical.sellerUid,
        packId: id,
        packRevision: expectedRevision,
        reason,
        verifiedBuyer: true,
        highRisk,
        packSnapshot: packSnapshot(id, historical),
        quarantined,
        createdAt: now,
      });
      if (currentIsReportedRevision) {
        const patch = {
          reportCount: safeInteger(currentSnapshot.get("reportCount")) + 1,
          revisionReportCount: safeInteger(currentSnapshot.get("revisionReportCount")) + 1,
          revisionHighRiskBuyerReportCount: nextHighRiskCount,
          updatedAt: now,
        };
        if (quarantined) {
          patch.status = "hidden";
          patch.moderationStatus = "quarantined";
          patch.quarantinedAt = now;
        }
        transaction.update(reference, patch);
      }
      if (sellerProfileReference) {
        transaction.set(sellerProfileReference, {
          schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
          sellerUid: historical.sellerUid,
          publicSellerId: rouletteTrainingPublicSellerId(historical.sellerUid),
          xPublic: false,
          xHandle: "",
          createdAt: safeInteger(
            sellerProfileSnapshot.get("createdAt"),
            1,
            Number.MAX_SAFE_INTEGER,
            now,
          ),
          updatedAt: now,
          quarantinedAt: now,
        }, { merge: true });
      }
      if (quarantinedPackStatsSnapshot?.exists) {
        transaction.set(quarantinedPackStatsReference, {
          isCurrentPublic: false,
          updatedAt: now,
        }, { merge: true });
      }
      if (quarantinedPackMonthlySnapshot?.exists) {
        transaction.set(quarantinedPackMonthlyReference, {
          isCurrentPublic: false,
          updatedAt: now,
        }, { merge: true });
      }
      result = { accepted: true, quarantined, idempotent: false };
    });
    return result;
  }

  async function performAction(uid, data = {}) {
    requireUid(uid);
    const action = String(data?.action || "");
    if (!ROULETTE_TRAINING_ACTIONS.includes(action)) {
      throw httpsError("invalid-argument", "ルーレットトレーニングの操作を確認してください。");
    }
    try {
      let result;
      if (action === "state") result = await getState(uid, data);
      else if (action === "browse") result = await browse(uid, data);
      else if (action === "publish") result = await publish(uid, data);
      else if (action === "unpublish") result = await unpublish(uid, data);
      else if (action === "start_paid_use") result = await startPaidUse(uid, data);
      else if (action === "resume_use") result = await resumeUse(uid, data);
      else if (action === "finish_use") result = await finishUse(uid, data);
      else if (action === "pack_rankings") result = await packRankings(uid, data);
      else if (action === "creator_stats") result = await creatorStats(uid, data);
      else if (action === "save_profile") result = await saveProfile(uid, data);
      else result = await report(uid, data);
      assertNoPrivateFields(result);
      return result;
    } catch (error) {
      throw mapHelperError(error);
    }
  }

  return Object.freeze({
    browse,
    creatorStats,
    finishUse,
    getState,
    packRankings,
    performAction,
    publish,
    report,
    resumeUse,
    saveProfile,
    startPaidUse,
    unpublish,
  });
}

module.exports = Object.freeze({
  ROULETTE_TRAINING_ACTIONS,
  createRouletteTrainingService,
});
