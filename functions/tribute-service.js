"use strict";

// お貢ぎ牧場のサーバー処理。すべての移動はトランザクションで、預ける側の上限・残高・ブロックを確かめてから行う。
// 上限・期間・言葉の設定・解約は預ける側だけが触れる。管理する側の操作は、その範囲の中でだけ動く。

const crypto = require("node:crypto");
const {
  TRIBUTE_SCHEMA_VERSION,
  TRIBUTE_AGE_VERSION,
  REPORT_REASONS,
  SEVERE_REPORT_REASONS,
  POLICIES,
  LIMITS,
  HONOR_TIERS,
  FORBIDDEN_MESSAGES,
  cleanLine,
  forbiddenReason,
  containsNgWord,
  normalizeCaps,
  capsAreLowerOrEqual,
  normalizeManagerCard,
  normalizeTodayWord,
  normalizeSeals,
  sealFor,
  SEAL_IDS,
  X_HANDLE_PATTERN,
  normalizeAvatar,
  normalizeWalletName,
  normalizeApplication,
  normalizePurpose,
  visiblePurpose,
  normalizeReward,
  PURPOSE_IDS,
  SEXUAL_PURPOSE_IDS,
  RECEIVABLE_KINDS,
  normalizeMessage,
  tributeFee,
  subsidyFor,
  offerSplit,
  honorTierFor,
  jstDateKey,
  jstMonthKey,
  nextJstDateKey,
  effectiveCaps,
  todayUsed,
  tributeAllowance,
  capViolation,
  pairId,
} = require("./tribute-rules");
const {
  ACHIEVEMENT_BY_ID,
  eligibleAchievementIds,
  normalizeTributeStats,
  unlockAchievements,
} = require("./achievements");

const TRIBUTE_ACTIONS = Object.freeze([
  "state",
  "age_confirm",
  "save_profile",
  "board",
  "manager",
  "apply",
  "withdraw",
  "accept",
  "decline",
  "message",
  "request",
  "cancel_request",
  "decline_request",
  "tribute",
  "set_caps",
  "cancel_raise",
  "terminate",
  "release",
  "escrow_deposit",
  "escrow_withdraw_request",
  "escrow_withdraw_cancel",
  "escrow_decision",
  "escrow_take",
  "report_balance",
  "request_report",
  "set_purposes",
  "receive",
  "share_info",
  "set_word",
  "mark_read",
  "report_user",
  "receipts",
  "ledger",
  "rankings",
  "fund",
  "offer",
  "vote",
  "recommend",
  "unrecommend",
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
]);
const CONTRACT_ID_PATTERN = /^[a-f0-9]{40}$/;
const PUBLIC_MANAGER_ID_PATTERN = /^[a-f0-9]{24}$/;
const REQUEST_ID_PATTERN = /^[a-f0-9]{16}$/;
const RECEIPT_ID_PATTERN = /^[a-f0-9]{40}$/;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const OPEN_STATUSES = Object.freeze(["pending", "active"]);
const RECENT_OPS_LIMIT = 30;
const PROFILE_SAVE_INTERVAL_MS = 2_000;
const APPLY_INTERVAL_MS = 30_000;
const ACHIEVEMENT_STATS_SCHEMA_VERSION = 1;
const ACHIEVEMENT_BACKFILL_PAIR_LIMIT = 1_000;
const MINIMUM_OFFER = 10;
const AGE_REQUIRED_MESSAGE = "お貢ぎ牧場は、18歳以上であることと遊びの前提を確認してから使えます。";
const END_REASON_LABELS = Object.freeze({
  withdrawn: "申し込みを取り下げました",
  declined: "申し込みは受理されませんでした",
  application_expired: "申し込みが48時間で失効しました",
  terminated: "預ける側が解約しました",
  released: "管理する側が解放しました",
  expired: "契約期間が終わりました",
  blocked: "ブロックにより終了しました",
});

function integer(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashId(...values) {
  return crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 40);
}

function eventId(seq) {
  return `e${String(seq).padStart(7, "0")}`;
}

function readProfile(snapshot) {
  const data = snapshot?.exists ? object(snapshot.data()) : {};
  const counts = object(data.counts);
  const card = data.card && typeof data.card === "object" ? data.card : null;
  return {
    exists: snapshot?.exists === true,
    ageConfirmedVersion: String(data.ageConfirmedVersion || ""),
    ageConfirmedAt: integer(data.ageConfirmedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    walletName: normalizeWalletName(data.walletName),
    card,
    accepting: data.accepting === true && Boolean(card),
    publicManagerId: PUBLIC_MANAGER_ID_PATTERN.test(String(data.publicManagerId || "")) ? data.publicManagerId : "",
    lastActiveAt: integer(data.lastActiveAt, 0, Number.MAX_SAFE_INTEGER, 0),
    lastProfileSaveAt: integer(data.lastProfileSaveAt, 0, Number.MAX_SAFE_INTEGER, 0),
    lastApplyAt: integer(data.lastApplyAt, 0, Number.MAX_SAFE_INTEGER, 0),
    counts: {
      payerOpen: integer(counts.payerOpen, 0, 1_000, 0),
      managerActive: integer(counts.managerActive, 0, 1_000, 0),
      managerPending: integer(counts.managerPending, 0, 1_000, 0),
    },
    receiptCount: integer(data.receiptCount, 0, Number.MAX_SAFE_INTEGER, 0),
    collarCount: integer(data.collarCount, 0, Number.MAX_SAFE_INTEGER, 0),
    word: {
      text: cleanLine(object(data.word).text, LIMITS.todayWord),
      at: integer(object(data.word).at, 0, Number.MAX_SAFE_INTEGER, 0),
      dayKey: String(object(data.word).dayKey || ""),
      dayCount: integer(object(data.word).dayCount, 0, 1_000, 0),
    },
    receiveDayKey: String(data.receiveDayKey || ""),
    receiveDayTotal: integer(data.receiveDayTotal, 0, Number.MAX_SAFE_INTEGER, 0),
    recommendedMonthKey: String(data.recommendedMonthKey || ""),
    recommendedCount: integer(data.recommendedCount, 0, 1_000_000, 0),
    honorMonthKey: String(data.honorMonthKey || ""),
    honorTierId: String(data.honorTierId || ""),
    severeReportMonthKey: String(data.severeReportMonthKey || ""),
    severeReportCount: integer(data.severeReportCount, 0, 1_000_000, 0),
  };
}

function profileIsHidden(profile, monthKey) {
  return profile.severeReportMonthKey === monthKey && profile.severeReportCount >= LIMITS.severeReportHide;
}

function honorFor(profile, monthKey) {
  if (profile.honorMonthKey !== monthKey) return null;
  const tier = HONOR_TIERS.find((entry) => entry.id === profile.honorTierId);
  return tier ? { tierId: tier.id, label: tier.label } : null;
}

// 今日のひとことは24時間だけ出す。期限の切れた言葉は返さない。
function activeWord(profile, now) {
  const word = profile.word || {};
  return word.text && word.at > 0 && now - word.at < LIMITS.todayWordTtlMs ? { text: word.text, at: word.at } : null;
}

function publicCard(profile, monthKey, now) {
  const card = object(profile.card);
  return {
    publicManagerId: profile.publicManagerId,
    personaName: cleanLine(card.personaName, LIMITS.personaName),
    intro: cleanLine(card.intro, LIMITS.intro),
    disclosure: String(card.disclosure || "undisclosed"),
    style: String(card.style || "cold"),
    entryFee: integer(card.entryFee, 0, 1_000, 0),
    sigil: integer(card.sigil, 0, 5, 0),
    avatar: normalizeAvatar(card.avatar),
    seals: normalizeSeals(card.seals),
    reportConsent: card.reportConsent === true,
    word: activeWord(profile, now),
    xHandle: X_HANDLE_PATTERN.test(String(card.xHandle || "")) ? card.xHandle : "",
    accepting: profile.accepting,
    honor: honorFor(profile, monthKey),
    recommendedCount: profile.recommendedMonthKey === monthKey ? profile.recommendedCount : 0,
    activeContracts: profile.counts.managerActive,
    lastActiveAt: profile.lastActiveAt,
  };
}

// 自分のプロフィール（state・save_profile・set_word で同じ形を返す）。
function ownProfileView(profile, monthKey, now) {
  return {
    walletName: profile.walletName,
    card: profile.card ? publicCard(profile, monthKey, now) : null,
    accepting: profile.accepting,
    publicManagerId: profile.publicManagerId,
    hidden: profileIsHidden(profile, monthKey),
    honor: honorFor(profile, monthKey),
    counts: profile.counts,
    receiptCount: profile.receiptCount,
    wordsToday: profile.word?.dayKey === jstDateKey(now) ? profile.word.dayCount : 0,
  };
}

function cardSnapshot(card) {
  const source = object(card);
  return {
    personaName: cleanLine(source.personaName, LIMITS.personaName) || "管理人",
    disclosure: String(source.disclosure || "undisclosed"),
    style: String(source.style || "cold"),
    sigil: integer(source.sigil, 0, 5, 0),
    avatar: normalizeAvatar(source.avatar),
  };
}

function pendingRequestList(contract) {
  return Object.entries(object(contract.pendingRequests))
    .map(([requestId, entry]) => ({
      requestId,
      amount: integer(entry?.amount, 0, 1_000_000, 0),
      note: cleanLine(entry?.note, LIMITS.requestNote),
      purpose: visiblePurpose(entry?.purpose, { allowSexual: contract.allowSexualPurposes === true }),
      createdAt: integer(entry?.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    }))
    .filter((entry) => REQUEST_ID_PATTERN.test(entry.requestId) && entry.amount > 0)
    .sort((left, right) => left.createdAt - right.createdAt);
}

// 名目ごとの回数。許可が外れた契約では、性的な名目の回数を出さない。
function purposeCountsView(contract) {
  const counts = object(contract.purposeCounts);
  const allowSexual = contract.allowSexualPurposes === true;
  const view = {};
  for (const purpose of PURPOSE_IDS) {
    const count = integer(counts[purpose], 0, Number.MAX_SAFE_INTEGER, 0);
    if (count > 0 && visiblePurpose(purpose, { allowSexual })) view[purpose] = count;
  }
  return view;
}

function viewContract(contract, uid, now) {
  const role = contract.managerUid === uid ? "manager" : "payer";
  const status = String(contract.status || "ended");
  const { caps } = effectiveCaps(contract, now);
  const pending = normalizeCaps(contract.pendingCaps);
  const pendingKey = String(contract.pendingCapsEffectiveDateKey || "");
  const pendingStillScheduled = Boolean(pending && pendingKey && jstDateKey(now) < pendingKey);
  const readSeq = integer(object(contract.readSeq)[role], 0, Number.MAX_SAFE_INTEGER, 0);
  const peerReadSeq = integer(object(contract.readSeq)[role === "manager" ? "payer" : "manager"], 0, Number.MAX_SAFE_INTEGER, 0);
  const eventSeq = integer(contract.eventSeq, 0, Number.MAX_SAFE_INTEGER, 0);
  const withdrawRequest = contract.escrowWithdrawRequest && typeof contract.escrowWithdrawRequest === "object"
    ? {
      amount: integer(contract.escrowWithdrawRequest.amount, 0, 1_000_000, 0),
      requestedAt: integer(contract.escrowWithdrawRequest.requestedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    }
    : null;
  return {
    contractId: String(contract.contractId || ""),
    role,
    status,
    endReason: String(contract.endReason || ""),
    endReasonLabel: END_REASON_LABELS[contract.endReason] || "",
    accepted: Number(contract.acceptedAt || 0) > 0,
    manager: cardSnapshot(contract.managerCard),
    payer: { walletName: normalizeWalletName(contract.payerWalletName) },
    collarNo: integer(contract.collarNo, 0, Number.MAX_SAFE_INTEGER, 0),
    caps,
    pendingCaps: pendingStillScheduled ? pending : null,
    pendingCapsEffectiveDateKey: pendingStillScheduled ? pendingKey : "",
    durationDays: integer(contract.durationDays, 1, 7, 1),
    tone: String(contract.tone || "normal"),
    ngWords: Array.isArray(contract.ngWords) ? contract.ngWords.slice(0, LIMITS.ngWordCount) : [],
    allowReportRequests: contract.allowReportRequests === true,
    rankOptIn: contract.rankOptIn === true,
    allowSexualPurposes: contract.allowSexualPurposes === true,
    entryFee: integer(contract.entryFee, 0, 1_000, 0),
    renewal: contract.renewal === true,
    createdAt: integer(contract.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    acceptedAt: integer(contract.acceptedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    expiresAt: integer(contract.expiresAt, 0, Number.MAX_SAFE_INTEGER, 0),
    endedAt: integer(contract.endedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: integer(contract.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    totalTributed: integer(contract.totalTributed, 0, Number.MAX_SAFE_INTEGER, 0),
    tributeCount: integer(contract.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0),
    purposeCounts: purposeCountsView(contract),
    rewardCount: integer(contract.rewardCount, 0, Number.MAX_SAFE_INTEGER, 0),
    awaitingReceipt: status === "active" ? integer(contract.awaitingReceipt, 0, Number.MAX_SAFE_INTEGER, 0) : 0,
    todayTributed: todayUsed(contract, now),
    allowance: status === "active" ? tributeAllowance(contract, caps, now) : 0,
    escrowBalance: integer(contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0),
    escrowRoom: caps
      ? Math.max(0, caps.total - integer(contract.totalTributed, 0, Number.MAX_SAFE_INTEGER, 0)
        - integer(contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0))
      : 0,
    escrowWithdrawRequest: withdrawRequest && withdrawRequest.amount > 0 ? withdrawRequest : null,
    pendingRequests: pendingRequestList(contract),
    reportRequested: Number(contract.reportRequestedAt || 0) > 0,
    eventSeq,
    unread: Math.max(0, eventSeq - readSeq),
    peerReadSeq: Math.min(eventSeq, peerReadSeq),
  };
}

function fundPolicy(fund) {
  const votes = object(fund?.votes);
  let best = "both";
  let bestCount = integer(votes.both, 0, 1_000_000, 0);
  for (const policy of ["first", "renewal"]) {
    const count = integer(votes[policy], 0, 1_000_000, 0);
    if (count > bestCount) {
      best = policy;
      bestCount = count;
    }
  }
  return best;
}

function createTributeService(deps) {
  if (!deps || typeof deps !== "object") {
    throw new TypeError("Tribute service dependencies are required.");
  }
  for (const name of REQUIRED_DEPENDENCIES) {
    if (deps[name] == null) throw new TypeError(`Missing tribute service dependency: ${name}`);
  }
  const {
    firestore,
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
    playerSafety = null,
    syncAchievementPublicSurfaces = null,
  } = deps;
  const currentTime = typeof deps.now === "function" ? deps.now : Date.now;

  const fail = (code, message) => {
    throw new HttpsError(code, message);
  };

  const profileRef = (uid) => firestore.collection("tributeProfiles").doc(uid);
  const contractRef = (contractId) => firestore.collection("tributeContracts").doc(contractId);
  const eventRef = (contractId, seq) => contractRef(contractId).collection("events").doc(eventId(seq));
  const receiptRef = (uid, receiptId) => firestore.collection("tributeReceipts").doc(uid).collection("items").doc(receiptId);
  const pairRef = (managerUid, payerUid) => firestore.collection("tributePairs").doc(pairId(managerUid, payerUid));
  const managerMonthRef = (monthKey, managerUid) => firestore.collection("tributeManagerMonths").doc(`${monthKey}__${managerUid}`);
  const fundRef = (monthKey) => firestore.collection("tributeFund").doc(monthKey);
  const honorRef = (monthKey, uid) => firestore.collection("tributeHonors").doc(`${monthKey}__${uid}`);
  const reportRef = (reportId) => firestore.collection("tributeReports").doc(reportId);
  const achievementStatsRef = (uid) => firestore.collection("tributeAchievementStats").doc(uid);
  const achievementProfileRef = (uid) => firestore.collection("achievementProfiles").doc(uid);

  function requireContractId(value) {
    const contractId = String(value || "");
    if (!CONTRACT_ID_PATTERN.test(contractId)) fail("invalid-argument", "契約を確認できません。");
    return contractId;
  }

  function requirePublicManagerId(value) {
    const id = String(value || "");
    if (!PUBLIC_MANAGER_ID_PATTERN.test(id)) fail("invalid-argument", "管理人を確認できません。");
    return id;
  }

  function requireClientRequestId(value) {
    const id = String(value || "");
    if (!CLIENT_REQUEST_ID_PATTERN.test(id)) fail("invalid-argument", "操作番号を確認できません。画面を開き直してください。");
    return id;
  }

  function requireAmount(value, maximum = 1_000_000) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > maximum) {
      fail("invalid-argument", "金額は1 Pay以上の整数で指定してください。");
    }
    return amount;
  }

  function requireAge(profile) {
    if (profile.ageConfirmedVersion !== TRIBUTE_AGE_VERSION) fail("failed-precondition", AGE_REQUIRED_MESSAGE);
  }

  async function readOwnProfile(uid) {
    return readProfile(await profileRef(uid).get());
  }

  async function findManagerByPublicId(publicManagerId) {
    const snapshot = await firestore.collection("tributeProfiles")
      .where("publicManagerId", "==", publicManagerId)
      .limit(1)
      .get();
    const document = snapshot.docs[0];
    if (!document) fail("not-found", "この管理人は見つかりません。");
    return { uid: document.id, profile: readProfile(document) };
  }

  // ───────────── 契約トランザクションの共通部分 ─────────────

  async function loadContext(transaction, contractId, uid) {
    const contractReference = contractRef(contractId);
    const contractSnapshot = await transaction.get(contractReference);
    if (!contractSnapshot.exists) fail("not-found", "契約が見つかりません。");
    const contract = object(contractSnapshot.data());
    const managerUid = String(contract.managerUid || "");
    const payerUid = String(contract.payerUid || "");
    if (!managerUid || !payerUid) fail("failed-precondition", "契約の参加者を確認できません。");
    let role = "system";
    if (uid) {
      if (uid === managerUid) role = "manager";
      else if (uid === payerUid) role = "payer";
      else fail("permission-denied", "この契約の参加者ではありません。");
    }
    const now = currentTime();
    const [
      managerProfileSnapshot,
      payerProfileSnapshot,
      managerWalletSnapshot,
      payerWalletSnapshot,
      ledgerConfigSnapshot,
      pairSnapshot,
    ] = await Promise.all([
      transaction.get(profileRef(managerUid)),
      transaction.get(profileRef(payerUid)),
      transaction.get(walletRef(managerUid)),
      transaction.get(walletRef(payerUid)),
      transaction.get(anjuPayLedgerConfigRef()),
      transaction.get(pairRef(managerUid, payerUid)),
    ]);
    const blocked = playerSafety ? await playerSafety.isBlocked(managerUid, payerUid, transaction) === true : false;
    return {
      transaction,
      now,
      dateKey: jstDateKey(now),
      monthKey: jstMonthKey(now),
      contractId,
      contractRef: contractReference,
      contract,
      original: { ...contract },
      patch: {},
      events: [],
      seq: integer(contract.eventSeq, 0, Number.MAX_SAFE_INTEGER, 0),
      role,
      uid,
      managerUid,
      payerUid,
      blocked,
      caps: null,
      ledgerConfig: ledgerConfigSnapshot,
      profiles: {
        manager: { ref: profileRef(managerUid), value: readProfile(managerProfileSnapshot), patch: null },
        payer: { ref: profileRef(payerUid), value: readProfile(payerProfileSnapshot), patch: null },
      },
      wallets: {
        manager: { uid: managerUid, ref: walletRef(managerUid), snapshot: managerWalletSnapshot, state: null, opened: false, touched: false },
        payer: { uid: payerUid, ref: walletRef(payerUid), snapshot: payerWalletSnapshot, state: null, opened: false, touched: false },
      },
      pair: {
        ref: pairRef(managerUid, payerUid),
        exists: pairSnapshot.exists,
        value: object(pairSnapshot.data()),
        patch: null,
      },
      extraWrites: [],
      unlocks: { manager: [], payer: [] },
      unlockedProfiles: { manager: null, payer: null },
    };
  }

  function setContract(ctx, values) {
    Object.assign(ctx.contract, values);
    Object.assign(ctx.patch, values);
  }

  function patchProfile(ctx, who, values) {
    const slot = ctx.profiles[who];
    slot.patch = { ...(slot.patch || {}), ...values };
    Object.assign(slot.value, values);
  }

  function adjustCounts(ctx, who, delta) {
    const slot = ctx.profiles[who];
    const counts = { ...slot.value.counts };
    for (const [key, value] of Object.entries(delta)) {
      counts[key] = Math.max(0, integer(counts[key], 0, 1_000, 0) + value);
    }
    patchProfile(ctx, who, { counts });
  }

  function patchPair(ctx, values) {
    ctx.pair.patch = { ...(ctx.pair.patch || {}), ...values };
    Object.assign(ctx.pair.value, values);
  }

  function pushEvent(ctx, event) {
    ctx.seq += 1;
    ctx.events.push({ seq: ctx.seq, createdAt: ctx.now, ...event });
  }

  function walletFor(ctx, who) {
    const slot = ctx.wallets[who];
    if (!slot.state) {
      if (!slot.snapshot.exists) fail("failed-precondition", "AnjuPay残高が初期化されていません。AnjuPayを一度開いてから、もう一度お試しください。");
      slot.state = walletData(slot.snapshot);
    }
    if (!slot.opened) {
      stageAnjuPayOpening(ctx.transaction, slot.ref, slot.state, ctx.ledgerConfig, ctx.now);
      slot.opened = true;
    }
    slot.touched = true;
    return slot.state;
  }

  function peekBalance(ctx, who) {
    const slot = ctx.wallets[who];
    if (slot.state) return slot.state.balance;
    if (!slot.snapshot.exists) return 0;
    return walletData(slot.snapshot).balance;
  }

  function appendEntry(ctx, who, entry) {
    const slot = ctx.wallets[who];
    appendAnjuPayEntry(ctx.transaction, slot.ref, slot.state, ctx.ledgerConfig, {
      category: "tribute",
      status: "settled",
      occurredAt: ctx.now,
      ...entry,
    });
  }

  function managerName(ctx) {
    return cardSnapshot(ctx.contract.managerCard).personaName;
  }

  function payerName(ctx) {
    return normalizeWalletName(ctx.contract.payerWalletName);
  }

  function hasRecentOp(ctx, key) {
    return Array.isArray(ctx.contract.recentOps) && ctx.contract.recentOps.includes(key);
  }

  function rememberOp(ctx, key) {
    const list = Array.isArray(ctx.contract.recentOps) ? ctx.contract.recentOps.slice(-(RECENT_OPS_LIMIT - 1)) : [];
    setContract(ctx, { recentOps: [...list, key] });
  }

  function flush(ctx) {
    const { transaction } = ctx;
    for (const slot of Object.values(ctx.wallets)) {
      if (!slot.touched || !slot.state) continue;
      transaction.set(slot.ref, {
        ...slot.state,
        ...anjuPayWalletMetadataPatch(slot.state),
        updatedAt: ctx.now,
      }, { merge: true });
    }
    for (const slot of Object.values(ctx.profiles)) {
      if (!slot.patch) continue;
      transaction.set(slot.ref, { ...slot.patch, updatedAt: ctx.now }, { merge: true });
    }
    if (ctx.pair.patch) {
      transaction.set(ctx.pair.ref, {
        managerUid: ctx.managerUid,
        payerUid: ctx.payerUid,
        ...ctx.pair.patch,
        updatedAt: ctx.now,
      }, { merge: true });
    }
    for (const write of ctx.extraWrites) write(transaction);
    for (const event of ctx.events) {
      transaction.create(eventRef(ctx.contractId, event.seq), event);
    }
    if (ctx.events.length || Object.keys(ctx.patch).length) {
      transaction.set(ctx.contractRef, {
        ...ctx.patch,
        eventSeq: ctx.seq,
        ...(ctx.events.length ? { lastEventAt: ctx.now } : {}),
        ...(ctx.quiet && !ctx.events.length ? {} : { updatedAt: ctx.now }),
      }, { merge: true });
    }
  }

  function touchedWallets(ctx) {
    return Object.values(ctx.wallets)
      .filter((slot) => slot.touched && slot.state)
      .map((slot) => ({ uid: slot.uid, balance: slot.state.balance }));
  }

  async function mirrorTouched(wallets) {
    if (!wallets.length) return;
    await bestEffort("tribute", wallets.map((entry) => mirrorWallet(entry.uid, entry.balance)));
  }

  // 首輪番号。管理人ごとに、初めて受理した組へ順に振る。再契約しても組の番号を使い、番号は使い回さない。
  // 番号のない進行中の契約（このリリースより前の契約）は、次の献上の時に振る。
  function ensureCollar(ctx) {
    const existing = integer(ctx.contract.collarNo, 0, Number.MAX_SAFE_INTEGER, 0);
    if (existing > 0) return existing;
    let collarNo = integer(ctx.pair.value.collarNo, 0, Number.MAX_SAFE_INTEGER, 0);
    if (!collarNo) {
      collarNo = ctx.profiles.manager.value.collarCount + 1;
      patchProfile(ctx, "manager", { collarCount: collarNo });
      patchPair(ctx, { collarNo });
    }
    setContract(ctx, { collarNo });
    return collarNo;
  }

  function settleCaps(ctx) {
    const { caps, applied } = effectiveCaps(ctx.contract, ctx.now);
    if (applied) {
      setContract(ctx, { caps, pendingCaps: null, pendingCapsEffectiveDateKey: "" });
      pushEvent(ctx, { type: "caps_raised", actor: "system", caps });
    }
    ctx.caps = caps;
  }

  // 契約を終える。管理口座は全額すぐ預ける側へ戻し、未払いの請求は無効にする。
  function stageEnd(ctx, reason) {
    const wasActive = ctx.contract.status === "active";
    const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
    if (escrow > 0) {
      const wallet = walletFor(ctx, "payer");
      const before = wallet.balance;
      creditPoints(wallet, escrow);
      const groupId = anjuPayEntryId(`tribute-escrow-end:${ctx.contractId}`);
      appendEntry(ctx, "payer", {
        entryId: groupId,
        groupId,
        kind: "tribute_escrow_return",
        labelKey: "anju_pay_tribute_escrow_return",
        delta: escrow,
        nominalAmount: escrow,
        balanceBefore: before,
        balanceAfter: wallet.balance,
        components: [{ kind: "escrow_return", labelKey: "anju_pay_tribute_escrow_return", status: "settled", delta: escrow, nominalAmount: escrow }],
        details: { mode: "tribute", role: "payer", counterpartyName: managerName(ctx) },
      });
    }
    setContract(ctx, {
      status: "ended",
      endReason: reason,
      endedAt: ctx.now,
      escrowBalance: 0,
      escrowWithdrawRequest: null,
      pendingRequests: {},
      reportRequestedAt: 0,
      pendingCaps: null,
      pendingCapsEffectiveDateKey: "",
      awaitingReceipt: 0,
    });
    adjustCounts(ctx, "payer", { payerOpen: -1 });
    adjustCounts(ctx, "manager", wasActive ? { managerActive: -1 } : { managerPending: -1 });
    if (ctx.pair.value.openContractId === ctx.contractId) patchPair(ctx, { openContractId: "" });
    pushEvent(ctx, { type: "ended", actor: "system", reason, escrowReturned: escrow });
  }

  function lazyTransition(ctx) {
    const status = ctx.contract.status;
    if (!OPEN_STATUSES.includes(status)) return "";
    const expiresAt = integer(ctx.contract.expiresAt, 0, Number.MAX_SAFE_INTEGER, 0);
    if (ctx.blocked) {
      stageEnd(ctx, "blocked");
      return "この相手との操作は現在利用できません。契約は終了しました。";
    }
    if (expiresAt && expiresAt <= ctx.now) {
      if (status === "pending") {
        stageEnd(ctx, "application_expired");
        return "申し込みは48時間で失効しました。";
      }
      stageEnd(ctx, "expired");
      return "契約期間が終わりました。管理口座の残りは財布へ戻りました。";
    }
    return "";
  }

  const STATUS_MESSAGES = Object.freeze({
    pending: "この契約はまだ受理されていません。",
    active: "この契約は進行中です。",
    ended: "この契約は終了しています。",
  });

  // Reading a thread does not normally need either wallet or the pair ledger.
  // Keep the policy/age checks in this transaction, and let the full runner do
  // its existing accounting when this read also needs a lifecycle transition.
  async function tryMarkRead(transaction, contractId, uid, data) {
    const reference = contractRef(contractId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) fail("not-found", "契約が見つかりません。");
    const contract = object(snapshot.data());
    const managerUid = String(contract.managerUid || "");
    const payerUid = String(contract.payerUid || "");
    if (!managerUid || !payerUid) fail("failed-precondition", "契約の参加者を確認できません。");
    const role = uid === managerUid ? "manager" : uid === payerUid ? "payer" : "";
    if (!role) fail("permission-denied", "この契約の参加者ではありません。");
    requireAge(readProfile(await transaction.get(profileRef(uid))));
    if (!["pending", "active", "ended"].includes(contract.status)) {
      fail("failed-precondition", STATUS_MESSAGES[contract.status] || "この契約は操作できません。");
    }
    const now = currentTime();
    const blocked = playerSafety ? await playerSafety.isBlocked(managerUid, payerUid, transaction) === true : false;
    const expiresAt = integer(contract.expiresAt, 0, Number.MAX_SAFE_INTEGER, 0);
    if ((OPEN_STATUSES.includes(contract.status) && (blocked || (expiresAt && expiresAt <= now)))
      || (contract.status === "active" && effectiveCaps(contract, now).applied)) {
      return null;
    }
    const eventSeq = integer(contract.eventSeq, 0, Number.MAX_SAFE_INTEGER, 0);
    const readSeq = object(contract.readSeq);
    const previous = integer(readSeq[role], 0, Number.MAX_SAFE_INTEGER, 0);
    const next = Math.max(previous, Math.min(eventSeq, integer(data?.seq, 0, Number.MAX_SAFE_INTEGER, 0)));
    if (next > previous) transaction.set(reference, { readSeq: { ...readSeq, [role]: next } }, { merge: true });
    return { ok: true, contractId, readSeq: next, eventSeq };
  }

  async function runContract(uid, data, spec) {
    const contractId = requireContractId(data?.contractId);
    if (spec.ensureWallets?.length) {
      const snapshot = await contractRef(contractId).get();
      if (!snapshot.exists) fail("not-found", "契約が見つかりません。");
      const contract = object(snapshot.data());
      const uids = spec.ensureWallets
        .map((who) => (who === "manager" ? contract.managerUid : contract.payerUid))
        .filter((value) => typeof value === "string" && value);
      await Promise.all([...new Set(uids)].map((value) => ensureWallet(value)));
      if (spec.achievements) {
        await Promise.all([contract.managerUid, contract.payerUid]
          .filter((value) => typeof value === "string" && value)
          .map((value) => ensureAchievementStats(value)));
      }
    }
    let result = null;
    let deferredError = "";
    let wallets = [];
    let unlocks = [];
    await firestore.runTransaction(async (transaction) => {
      result = null;
      deferredError = "";
      wallets = [];
      unlocks = [];
      if (spec.lightweightMarkRead) {
        result = await tryMarkRead(transaction, contractId, uid, data);
        if (result) return;
      }
      const ctx = await loadContext(transaction, contractId, uid);
      if (uid) {
        if (!spec.roles.includes(ctx.role)) fail("permission-denied", "この操作はできません。");
        requireAge(ctx.profiles[ctx.role].value);
      }
      const extra = spec.read ? await spec.read(transaction, ctx) : null;
      const transitionError = lazyTransition(ctx);
      if (transitionError && !spec.statuses.includes("ended")) {
        deferredError = transitionError;
      } else {
        if (!spec.statuses.includes(ctx.contract.status)) {
          fail("failed-precondition", STATUS_MESSAGES[ctx.contract.status] || "この契約は操作できません。");
        }
        if (ctx.contract.status === "active") settleCaps(ctx);
        result = spec.write(ctx, extra);
      }
      flush(ctx);
      wallets = touchedWallets(ctx);
      unlocks = ["manager", "payer"]
        .filter((who) => ctx.unlocks[who].length)
        .map((who) => ({
          uid: who === "manager" ? ctx.managerUid : ctx.payerUid,
          ids: ctx.unlocks[who],
          profile: ctx.unlockedProfiles[who],
          mine: who === ctx.role,
        }));
    });
    await mirrorTouched(wallets);
    if (unlocks.length && typeof syncAchievementPublicSurfaces === "function") {
      await bestEffort("tribute achievements", unlocks.map((entry) => syncAchievementPublicSurfaces(entry.uid, entry.profile)));
    }
    if (deferredError) fail("failed-precondition", deferredError);
    const mine = unlocks.find((entry) => entry.mine);
    if (result && mine) return { ...result, newlyUnlocked: mine.ids };
    return result || { ok: true };
  }

  // ───────────── 献上 ─────────────

  async function readTributeExtras(transaction, ctx, receiptId) {
    const [
      monthSnapshot,
      fundSnapshot,
      receiptSnapshot,
      managerStatsSnapshot,
      payerStatsSnapshot,
      managerAchievementSnapshot,
      payerAchievementSnapshot,
    ] = await Promise.all([
      transaction.get(managerMonthRef(ctx.monthKey, ctx.managerUid)),
      transaction.get(fundRef(ctx.monthKey)),
      receiptId ? transaction.get(receiptRef(ctx.payerUid, receiptId)) : Promise.resolve(null),
      transaction.get(achievementStatsRef(ctx.managerUid)),
      transaction.get(achievementStatsRef(ctx.payerUid)),
      transaction.get(achievementProfileRef(ctx.managerUid)),
      transaction.get(achievementProfileRef(ctx.payerUid)),
    ]);
    return {
      month: { exists: monthSnapshot.exists, value: object(monthSnapshot.data()) },
      fund: { exists: fundSnapshot.exists, value: object(fundSnapshot.data()) },
      receipt: receiptSnapshot?.exists ? object(receiptSnapshot.data()) : null,
      receiptId,
      achievements: {
        manager: { stats: normalizeTributeStats(managerStatsSnapshot.data()), profile: managerAchievementSnapshot.data() },
        payer: { stats: normalizeTributeStats(payerStatsSnapshot.data()), profile: payerAchievementSnapshot.data() },
      },
    };
  }

  // 実績は金額ではなく、管理が続いた記録として数える。同じ組は日本時間の1日1回だけ。
  function stageTributeAchievements(ctx, extra, countsToday) {
    if (!extra?.achievements) return;
    const sides = [
      ["manager", ctx.managerUid, "managerPairDays"],
      ["payer", ctx.payerUid, "walletPairDays"],
    ];
    for (const [who, uid, key] of sides) {
      const slot = extra.achievements[who];
      const stats = { ...slot.stats };
      if (countsToday) {
        stats[key] += 1;
        ctx.extraWrites.push((transaction) => transaction.set(achievementStatsRef(uid), {
          schemaVersion: ACHIEVEMENT_STATS_SCHEMA_VERSION,
          ...stats,
          historyBackfilled: true,
          updatedAt: ctx.now,
        }, { merge: true }));
      }
      slot.stats = stats;
      const unlockResult = unlockAchievements(
        slot.profile,
        eligibleAchievementIds({ tributeStats: stats, scope: "tribute" }),
        ctx.now,
      );
      slot.profile = unlockResult.profile;
      if (unlockResult.newlyUnlocked.length) {
        ctx.extraWrites.push((transaction) => transaction.set(achievementProfileRef(uid), unlockResult.profile));
        ctx.unlocks[who].push(...unlockResult.newlyUnlocked);
        ctx.unlockedProfiles[who] = unlockResult.profile;
      }
    }
  }

  function subsidyForTribute(ctx, extra, fee) {
    if (fee <= LIMITS.minimumFee) return 0;
    const fund = extra.fund.value;
    const balance = integer(fund.balance, 0, Number.MAX_SAFE_INTEGER, 0);
    if (balance <= 0) return 0;
    if (ctx.pair.value.subsidyMonthKey === ctx.monthKey) return 0;
    const policy = fundPolicy(fund);
    const isFirstForPair = integer(ctx.pair.value.count, 0, Number.MAX_SAFE_INTEGER, 0) === 0;
    const isRenewalFirst = ctx.contract.renewal === true
      && integer(ctx.contract.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0) === 0;
    const eligible = policy === "first" ? isFirstForPair
      : policy === "renewal" ? isRenewalFirst
        : (isFirstForPair || isRenewalFirst);
    if (!eligible) return 0;
    const usedThisMonth = extra.month.value.monthKey === ctx.monthKey
      ? integer(extra.month.value.subsidyUsed, 0, Number.MAX_SAFE_INTEGER, 0)
      : 0;
    return Math.max(0, Math.min(subsidyFor(fee), balance, LIMITS.subsidyManagerMonthly - usedThisMonth));
  }

  function stageTribute(ctx, extra, { kind, amount, requestId = "", note = "", purpose = "", opKey }) {
    const contract = ctx.contract;
    const caps = ctx.caps || effectiveCaps(contract, ctx.now).caps;
    const violation = capViolation(amount, contract, caps, ctx.now);
    if (violation) fail("failed-precondition", violation);
    const managerProfile = ctx.profiles.manager.value;
    const receivedToday = managerProfile.receiveDayKey === ctx.dateKey ? managerProfile.receiveDayTotal : 0;
    if (receivedToday + amount > LIMITS.managerDailyReceive) {
      fail("failed-precondition", "相手が今日受け取れる上限（全契約で20,000 Pay）に達しています。");
    }
    const fromEscrow = kind === "escrow_take";
    const escrow = integer(contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
    if (fromEscrow && escrow < amount) fail("failed-precondition", "管理口座の残高が足りません。");
    if (!fromEscrow && peekBalance(ctx, "payer") < amount) {
      fail("failed-precondition", kind === "entry"
        ? "預ける側の残高が入場料に足りないため、受理できません。"
        : "AnjuPay残高が足りません。");
    }
    const fee = tributeFee(amount);
    const subsidy = subsidyForTribute(ctx, extra, fee);
    const net = amount - fee + subsidy;
    const managerWallet = walletFor(ctx, "manager");
    if (walletCreditCapacity(managerWallet) < net) fail("failed-precondition", "相手のAnjuPay残高が上限に近いため渡せません。");
    const payerWallet = walletFor(ctx, "payer");
    const payerBefore = payerWallet.balance;
    if (!fromEscrow) debitPoints(payerWallet, amount);
    const managerBefore = managerWallet.balance;
    creditPoints(managerWallet, net);

    const groupId = anjuPayEntryId(`tribute:${ctx.contractId}:${opKey}`);
    appendEntry(ctx, "payer", {
      entryId: groupId,
      groupId,
      kind: "tribute_sent",
      labelKey: fromEscrow ? "anju_pay_tribute_escrow_take" : "anju_pay_tribute_sent",
      delta: fromEscrow ? 0 : -amount,
      nominalAmount: amount,
      balanceBefore: payerBefore,
      balanceAfter: payerWallet.balance,
      components: [{
        kind: fromEscrow ? "escrow_take" : "tribute",
        labelKey: fromEscrow ? "anju_pay_tribute_escrow_take" : "anju_pay_tribute_sent",
        status: "settled",
        delta: fromEscrow ? 0 : -amount,
        nominalAmount: amount,
      }],
      details: { mode: "tribute", role: "payer", counterpartyName: managerName(ctx) },
    });
    const managerComponents = [
      { kind: "tribute_gross", labelKey: "anju_pay_tribute_gross", status: "settled", delta: amount, nominalAmount: amount },
      { kind: "tribute_fee", labelKey: "anju_pay_tribute_fee", status: "settled", delta: -fee, nominalAmount: fee },
    ];
    if (subsidy > 0) {
      managerComponents.push({ kind: "tribute_subsidy", labelKey: "anju_pay_tribute_subsidy", status: "settled", delta: subsidy, nominalAmount: subsidy });
    }
    appendEntry(ctx, "manager", {
      entryId: groupId,
      groupId,
      kind: "tribute_received",
      labelKey: "anju_pay_tribute_received",
      delta: net,
      nominalAmount: amount,
      balanceBefore: managerBefore,
      balanceAfter: managerWallet.balance,
      components: managerComponents,
      details: { mode: "tribute", role: "manager", counterpartyName: payerName(ctx) },
    });

    // 契約の数字
    const usedToday = todayUsed(contract, ctx.now);
    const nextEscrow = fromEscrow ? escrow - amount : escrow;
    const withdrawRequest = contract.escrowWithdrawRequest;
    // 財布から差し出した献上（請求・無言）は、管理人が「受け取る」まで受け取り待ちになる。
    // 入場料と管理口座からの徴収は管理人が自分で動かしたので、その場で受け取り済み。
    const receivable = RECEIVABLE_KINDS.includes(kind);
    const purposeCounts = object(contract.purposeCounts);
    setContract(ctx, {
      ...(purpose ? { purposeCounts: { ...purposeCounts, [purpose]: integer(purposeCounts[purpose], 0, Number.MAX_SAFE_INTEGER, 0) + 1 } } : {}),
      ...(receivable ? { awaitingReceipt: integer(contract.awaitingReceipt, 0, Number.MAX_SAFE_INTEGER, 0) + 1 } : {}),
      totalTributed: integer(contract.totalTributed, 0, Number.MAX_SAFE_INTEGER, 0) + amount,
      tributeCount: integer(contract.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
      todayKey: ctx.dateKey,
      todayTributed: usedToday + amount,
      lastTributeAt: ctx.now,
      escrowBalance: nextEscrow,
      ...(withdrawRequest && Number(withdrawRequest.amount) > nextEscrow
        ? { escrowWithdrawRequest: nextEscrow > 0 ? { ...withdrawRequest, amount: nextEscrow } : null }
        : {}),
    });
    // 管理する側の1日の受取
    patchProfile(ctx, "manager", { receiveDayKey: ctx.dateKey, receiveDayTotal: receivedToday + amount });
    // 預ける側のレシート
    const payerProfile = ctx.profiles.payer.value;
    const receiptNo = payerProfile.receiptCount + 1;
    patchProfile(ctx, "payer", { receiptCount: receiptNo });
    const pair = ctx.pair.value;
    const pairCountBefore = integer(pair.count, 0, Number.MAX_SAFE_INTEGER, 0);
    const pairMonthIsCurrent = pair.monthKey === ctx.monthKey;
    const rankAddedToday = pair.rankDayKey === ctx.dateKey ? integer(pair.rankDayAdded, 0, Number.MAX_SAFE_INTEGER, 0) : 0;
    const rankAdd = Math.max(0, Math.min(amount, LIMITS.rankDailyPairCap - rankAddedToday));
    const firstForPairToday = pair.rankDayKey !== ctx.dateKey;
    const card = cardSnapshot(contract.managerCard);
    const collarNo = ensureCollar(ctx);
    const receipt = {
      schemaVersion: TRIBUTE_SCHEMA_VERSION,
      receiptNo,
      contractId: ctx.contractId,
      kind,
      amount,
      ...(purpose ? { purpose } : {}),
      personaName: card.personaName,
      disclosure: card.disclosure,
      sigil: card.sigil,
      avatar: card.avatar,
      collarNo,
      pairCount: pairCountBefore + 1,
      ...(receivable ? {} : { receivedAt: ctx.now }),
      createdAt: ctx.now,
    };
    const receiptId = extra.receiptId || hashId("receipt", ctx.contractId, opKey);
    ctx.extraWrites.push((transaction) => transaction.create(receiptRef(ctx.payerUid, receiptId), receipt));
    // 貢ぎ帳と番付
    patchPair(ctx, {
      total: integer(pair.total, 0, Number.MAX_SAFE_INTEGER, 0) + amount,
      count: pairCountBefore + 1,
      firstAt: integer(pair.firstAt, 0, Number.MAX_SAFE_INTEGER, 0) || ctx.now,
      lastAt: ctx.now,
      monthKey: ctx.monthKey,
      monthTotal: (pairMonthIsCurrent ? integer(pair.monthTotal, 0, Number.MAX_SAFE_INTEGER, 0) : 0) + amount,
      monthCount: (pairMonthIsCurrent ? integer(pair.monthCount, 0, Number.MAX_SAFE_INTEGER, 0) : 0) + 1,
      rankDayKey: ctx.dateKey,
      rankDayAdded: rankAddedToday + rankAdd,
      rankOptIn: contract.rankOptIn === true,
      walletName: payerName(ctx),
      managerPersonaName: card.personaName,
      ...(subsidy > 0 ? { subsidyMonthKey: ctx.monthKey } : {}),
    });
    const month = extra.month.value;
    const managerProfileValue = ctx.profiles.manager.value;
    const monthPatch = {
      schemaVersion: TRIBUTE_SCHEMA_VERSION,
      monthKey: ctx.monthKey,
      managerUid: ctx.managerUid,
      publicManagerId: managerProfileValue.publicManagerId,
      personaName: cleanLine(managerProfileValue.card?.personaName, LIMITS.personaName) || card.personaName,
      disclosure: String(managerProfileValue.card?.disclosure || card.disclosure),
      sigil: integer(managerProfileValue.card?.sigil, 0, 5, card.sigil),
      avatar: managerProfileValue.card ? normalizeAvatar(managerProfileValue.card.avatar) : card.avatar,
      payers: integer(month.payers, 0, Number.MAX_SAFE_INTEGER, 0) + (pairMonthIsCurrent ? 0 : 1),
      rankScore: integer(month.rankScore, 0, Number.MAX_SAFE_INTEGER, 0) + rankAdd,
      receivedGross: integer(month.receivedGross, 0, Number.MAX_SAFE_INTEGER, 0) + amount,
      receivedNet: integer(month.receivedNet, 0, Number.MAX_SAFE_INTEGER, 0) + (amount - fee),
      tributeCount: integer(month.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
      subsidyUsed: integer(month.subsidyUsed, 0, Number.MAX_SAFE_INTEGER, 0) + subsidy,
      offered: integer(month.offered, 0, Number.MAX_SAFE_INTEGER, 0),
      updatedAt: ctx.now,
    };
    ctx.extraWrites.push((transaction) => transaction.set(managerMonthRef(ctx.monthKey, ctx.managerUid), monthPatch, { merge: true }));
    if (subsidy > 0) {
      const fund = extra.fund.value;
      ctx.extraWrites.push((transaction) => transaction.set(fundRef(ctx.monthKey), {
        monthKey: ctx.monthKey,
        balance: integer(fund.balance, 0, Number.MAX_SAFE_INTEGER, 0) - subsidy,
        subsidized: integer(fund.subsidized, 0, Number.MAX_SAFE_INTEGER, 0) + subsidy,
        subsidyCount: integer(fund.subsidyCount, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
        updatedAt: ctx.now,
      }, { merge: true }));
    }
    pushEvent(ctx, {
      type: "tribute",
      actor: fromEscrow ? "manager" : "payer",
      kind,
      amount,
      receiptId,
      ...(requestId ? { requestId } : {}),
      ...(note ? { note } : {}),
      ...(purpose ? { purpose } : {}),
      ...(receivable ? {} : { receivedAt: ctx.now }),
    });
    stageTributeAchievements(ctx, extra, firstForPairToday);
    return { receipt: { receiptId, ...receipt }, fee, subsidy, net };
  }

  // ───────────── 操作 ─────────────

  // 実績の記録を初めて使う時、これまでの貢ぎ帳から確実に言える分（組ごとに1日、最初と最後が別の日なら2日）だけを入れる。
  function historicalPairDays(pairValue) {
    const pair = object(pairValue);
    const count = integer(pair.count, 0, Number.MAX_SAFE_INTEGER, 0);
    if (count < 1) return 0;
    const firstAt = integer(pair.firstAt, 0, Number.MAX_SAFE_INTEGER, 0);
    const lastAt = integer(pair.lastAt, 0, Number.MAX_SAFE_INTEGER, 0);
    if (count >= 2 && firstAt && lastAt && jstDateKey(firstAt) !== jstDateKey(lastAt)) return 2;
    return 1;
  }

  async function ensureAchievementStats(uid) {
    const reference = achievementStatsRef(uid);
    const existing = await reference.get();
    if (existing.exists && existing.get("historyBackfilled") === true) return normalizeTributeStats(existing.data());
    const [asManager, asPayer] = await Promise.all([
      firestore.collection("tributePairs").where("managerUid", "==", uid).limit(ACHIEVEMENT_BACKFILL_PAIR_LIMIT).get(),
      firestore.collection("tributePairs").where("payerUid", "==", uid).limit(ACHIEVEMENT_BACKFILL_PAIR_LIMIT).get(),
    ]);
    const seed = {
      managerPairDays: asManager.docs.reduce((sum, document) => sum + historicalPairDays(document.data()), 0),
      walletPairDays: asPayer.docs.reduce((sum, document) => sum + historicalPairDays(document.data()), 0),
    };
    let stats = seed;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists && snapshot.get("historyBackfilled") === true) {
        stats = normalizeTributeStats(snapshot.data());
        return;
      }
      const current = normalizeTributeStats(snapshot.data());
      stats = {
        managerPairDays: Math.max(current.managerPairDays, seed.managerPairDays),
        walletPairDays: Math.max(current.walletPairDays, seed.walletPairDays),
      };
      const now = currentTime();
      transaction.set(reference, {
        schemaVersion: ACHIEVEMENT_STATS_SCHEMA_VERSION,
        ...stats,
        historyBackfilled: true,
        backfilledAt: now,
        updatedAt: now,
      }, { merge: true });
    });
    return stats;
  }

  async function ensureAchievementState(uid) {
    const readState = () => firestore.runTransaction(async (transaction) => {
      const [statsSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(achievementStatsRef(uid)),
        transaction.get(achievementProfileRef(uid)),
      ]);
      // Ready users need only the atomic stats/profile read. Never carry a
      // preflight stats value into the transaction that unlocks achievements.
      if (!statsSnapshot.exists || statsSnapshot.get("historyBackfilled") !== true) return null;
      const stats = normalizeTributeStats(statsSnapshot.data());
      const unlockResult = unlockAchievements(
        profileSnapshot.data(),
        eligibleAchievementIds({ tributeStats: stats, scope: "tribute" }),
        currentTime(),
      );
      if (unlockResult.newlyUnlocked.length) transaction.set(achievementProfileRef(uid), unlockResult.profile);
      return { stats, profile: unlockResult.profile, newlyUnlocked: unlockResult.newlyUnlocked };
    });
    let result = await readState();
    if (!result) {
      await ensureAchievementStats(uid);
      result = await readState();
      if (!result) fail("unavailable", "実績を確認できませんでした。もう一度お試しください。");
    }
    return result;
  }

  async function stateAction(uid) {
    const now = currentTime();
    const monthKey = jstMonthKey(now);
    const profile = await readOwnProfile(uid);
    const ageConfirmed = profile.ageConfirmedVersion === TRIBUTE_AGE_VERSION;
    const base = {
      ok: true,
      now,
      ageVersion: TRIBUTE_AGE_VERSION,
      ageConfirmed,
    };
    if (!ageConfirmed) return base;
    let snapshot = await firestore.collection("tributeContracts")
      .where("participants", "array-contains", uid)
      .orderBy("updatedAt", "desc")
      .limit(40)
      .get();
    const overdue = snapshot.docs
      .map((document) => object(document.data()))
      .filter((contract) => OPEN_STATUSES.includes(contract.status) && Number(contract.expiresAt || 0) <= now)
      .slice(0, 5);
    if (overdue.length) {
      for (const contract of overdue) {
        try {
          await endBySystem(contract.contractId);
        } catch (error) {
          console.error("tribute lazy expiry failed", error);
        }
      }
      snapshot = await firestore.collection("tributeContracts")
        .where("participants", "array-contains", uid)
        .orderBy("updatedAt", "desc")
        .limit(40)
        .get();
    }
    const contracts = snapshot.docs.map((document) => viewContract(object(document.data()), uid, now));
    let achievements = null;
    try {
      const achievementState = await ensureAchievementState(uid);
      achievements = {
        stats: achievementState.stats,
        unlocked: Object.keys(achievementState.profile.unlocked)
          .filter((id) => ACHIEVEMENT_BY_ID.get(id)?.scope === "tribute"),
        newlyUnlocked: Object.keys(achievementState.profile.pendingUnlocks)
          .filter((id) => ACHIEVEMENT_BY_ID.get(id)?.scope === "tribute"),
      };
    } catch (error) {
      console.error("tribute achievement state failed", error);
    }
    return {
      ...base,
      achievements,
      profile: ownProfileView(profile, monthKey, now),
      contracts,
    };
  }

  async function ageConfirmAction(uid, data) {
    if (data?.version !== TRIBUTE_AGE_VERSION || data?.adult !== true || data?.premise !== true) {
      fail("invalid-argument", "18歳以上であることと、遊びの前提の両方を確認してください。");
    }
    const now = currentTime();
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(profileRef(uid));
      const profile = readProfile(snapshot);
      transaction.set(profileRef(uid), {
        schemaVersion: TRIBUTE_SCHEMA_VERSION,
        uid,
        ageConfirmedVersion: TRIBUTE_AGE_VERSION,
        ageConfirmedAt: now,
        ...(profile.exists ? {} : {
          walletName: "名無しの財布",
          accepting: false,
          card: null,
          counts: { payerOpen: 0, managerActive: 0, managerPending: 0 },
          receiptCount: 0,
          lastActiveAt: 0,
          createdAt: now,
        }),
        updatedAt: now,
      }, { merge: true });
    });
    return { ok: true, ageConfirmed: true, ageVersion: TRIBUTE_AGE_VERSION };
  }

  async function saveProfileAction(uid, data) {
    const now = currentTime();
    let saved = null;
    await firestore.runTransaction(async (transaction) => {
      const profile = readProfile(await transaction.get(profileRef(uid)));
      requireAge(profile);
      if (now - profile.lastProfileSaveAt < PROFILE_SAVE_INTERVAL_MS) {
        fail("resource-exhausted", "少し待ってから保存してください。");
      }
      const patch = { lastProfileSaveAt: now, updatedAt: now };
      if (data?.walletName !== undefined) {
        const name = cleanLine(data.walletName, LIMITS.walletName);
        const reason = forbiddenReason(name);
        if (reason) fail("invalid-argument", FORBIDDEN_MESSAGES[reason]);
        patch.walletName = normalizeWalletName(name);
      }
      let card = profile.card;
      if (data?.card !== undefined && data.card !== null) {
        const result = normalizeManagerCard({ ...data.card, accepting: data.accepting === true });
        if (result.error) fail("invalid-argument", result.error);
        const { accepting: _accepting, ...cardValues } = result.card;
        card = cardValues;
        patch.card = cardValues;
        patch.cardUpdatedAt = now;
        if (!profile.publicManagerId) patch.publicManagerId = randomHex(12);
      }
      if (data?.accepting !== undefined) {
        const accepting = data.accepting === true;
        if (accepting && !card) fail("failed-precondition", "受付を始める前に、管理人カードを作ってください。");
        patch.accepting = accepting;
        if (accepting) patch.lastActiveAt = now;
      }
      transaction.set(profileRef(uid), patch, { merge: true });
      saved = { ...profile, ...patch, card };
    });
    const monthKey = jstMonthKey(now);
    const profile = readProfile({ exists: true, data: () => saved });
    return { ok: true, profile: ownProfileView(profile, monthKey, now) };
  }

  // 今日のひとこと。管理人カードのある人だけ、30文字まで・24時間・日本時間の1日3回まで。
  // 出すと掲示板の並び（最近の活動順）で上に来る。消しても、その日の回数は戻らない。
  async function setWordAction(uid, data) {
    let saved = null;
    let now = 0;
    await firestore.runTransaction(async (transaction) => {
      saved = null;
      now = currentTime();
      const snapshot = await transaction.get(profileRef(uid));
      const profile = readProfile(snapshot);
      requireAge(profile);
      if (!profile.card) fail("failed-precondition", "今日のひとことは、管理人カードを作ってから出せます。");
      const dateKey = jstDateKey(now);
      const usedToday = profile.word.dayKey === dateKey ? profile.word.dayCount : 0;
      let word;
      const patch = { updatedAt: now };
      if (data?.clear === true) {
        word = { ...profile.word, text: "", at: 0 };
      } else {
        const normalized = normalizeTodayWord(data?.text);
        if (normalized.error) fail("invalid-argument", normalized.error);
        if (usedToday >= LIMITS.todayWordsPerDay) {
          fail("resource-exhausted", `今日のひとことは1日${LIMITS.todayWordsPerDay}回までです。日本時間の0時に戻ります。`);
        }
        word = { text: normalized.text, at: now, dayKey: dateKey, dayCount: usedToday + 1 };
        patch.lastActiveAt = now;
      }
      patch.word = word;
      transaction.set(profileRef(uid), patch, { merge: true });
      saved = { ...object(snapshot.data()), ...patch };
    });
    const profile = readProfile({ exists: true, data: () => saved });
    return { ok: true, profile: ownProfileView(profile, jstMonthKey(now), now) };
  }

  async function visibleRows(uid, rows) {
    if (!playerSafety || typeof playerSafety.filterVisible !== "function") return rows;
    return playerSafety.filterVisible(uid, rows, (row) => row.uid);
  }

  async function boardAction(uid, data) {
    const own = await readOwnProfile(uid);
    requireAge(own);
    const now = currentTime();
    const monthKey = jstMonthKey(now);
    const [boardSnapshot, recommendedSnapshot] = await Promise.all([
      firestore.collection("tributeProfiles")
        .where("accepting", "==", true)
        .orderBy("lastActiveAt", "desc")
        .limit(LIMITS.boardLimit * 2)
        .get(),
      firestore.collection("tributeProfiles")
        .where("recommendedMonthKey", "==", monthKey)
        .orderBy("recommendedCount", "desc")
        .limit(LIMITS.recommendedLimit * 2)
        .get(),
    ]);
    const toRows = (snapshot) => snapshot.docs
      .map((document) => ({ uid: document.id, profile: readProfile(document) }))
      .filter((row) => row.profile.accepting
        && row.profile.publicManagerId
        && row.profile.ageConfirmedVersion === TRIBUTE_AGE_VERSION
        && !profileIsHidden(row.profile, monthKey));
    const nekamaOnly = data?.nekamaOnly === true;
    const board = (await visibleRows(uid, toRows(boardSnapshot)))
      .filter((row) => !nekamaOnly || row.profile.card?.disclosure === "nekama")
      .slice(0, LIMITS.boardLimit)
      .map((row) => ({ ...publicCard(row.profile, monthKey, now), mine: row.uid === uid }));
    const recommended = (await visibleRows(uid, toRows(recommendedSnapshot)))
      .filter((row) => row.profile.recommendedCount > 0)
      .slice(0, LIMITS.recommendedLimit)
      .map((row) => ({ ...publicCard(row.profile, monthKey, now), mine: row.uid === uid }));
    return { ok: true, nekamaOnly, managers: board, recommended };
  }

  async function managerRanking(managerUid, monthKey, uid) {
    const [monthSnapshot, lifetimeSnapshot] = await Promise.all([
      firestore.collection("tributePairs")
        .where("managerUid", "==", managerUid)
        .where("rankOptIn", "==", true)
        .where("monthKey", "==", monthKey)
        .orderBy("monthTotal", "desc")
        .limit(LIMITS.rankingLimit)
        .get(),
      firestore.collection("tributePairs")
        .where("managerUid", "==", managerUid)
        .where("rankOptIn", "==", true)
        .orderBy("total", "desc")
        .limit(LIMITS.rankingLimit)
        .get(),
    ]);
    const rows = (snapshot, field) => snapshot.docs
      .map((document) => object(document.data()))
      .filter((pair) => integer(pair[field], 0, Number.MAX_SAFE_INTEGER, 0) > 0)
      .map((pair, index) => ({
        rank: index + 1,
        walletName: normalizeWalletName(pair.walletName),
        amount: integer(pair[field], 0, Number.MAX_SAFE_INTEGER, 0),
        mine: pair.payerUid === uid,
      }));
    return { month: rows(monthSnapshot, "monthTotal"), lifetime: rows(lifetimeSnapshot, "total") };
  }

  async function managerAction(uid, data) {
    const own = await readOwnProfile(uid);
    requireAge(own);
    const publicManagerId = requirePublicManagerId(data?.publicManagerId);
    const { uid: managerUid, profile } = await findManagerByPublicId(publicManagerId);
    if (managerUid !== uid && playerSafety && await playerSafety.isBlocked(uid, managerUid)) {
      fail("not-found", "この管理人は見つかりません。");
    }
    const now = currentTime();
    const monthKey = jstMonthKey(now);
    if (managerUid !== uid && profileIsHidden(profile, monthKey)) fail("not-found", "この管理人は見つかりません。");
    const [monthSnapshot, pairSnapshot, ranking] = await Promise.all([
      managerMonthRef(monthKey, managerUid).get(),
      managerUid === uid ? Promise.resolve(null) : pairRef(managerUid, uid).get(),
      managerRanking(managerUid, monthKey, uid),
    ]);
    const month = object(monthSnapshot.data());
    const pair = pairSnapshot?.exists ? object(pairSnapshot.data()) : {};
    return {
      ok: true,
      card: { ...publicCard(profile, monthKey, now), mine: managerUid === uid },
      month: {
        payers: integer(month.payers, 0, Number.MAX_SAFE_INTEGER, 0),
        tributeCount: integer(month.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0),
      },
      openContractId: CONTRACT_ID_PATTERN.test(String(pair.openContractId || "")) ? pair.openContractId : "",
      myTotal: integer(pair.total, 0, Number.MAX_SAFE_INTEGER, 0),
      ranking,
    };
  }

  async function applyAction(uid, data) {
    const publicManagerId = requirePublicManagerId(data?.publicManagerId);
    const { uid: managerUid } = await findManagerByPublicId(publicManagerId);
    if (managerUid === uid) fail("failed-precondition", "自分の管理人カードには申し込めません。");
    const expectedEntryFee = Number(data?.expectedEntryFee);
    const contractId = randomHex(20);
    let created = null;
    await firestore.runTransaction(async (transaction) => {
      created = null;
      const now = currentTime();
      const [payerSnapshot, managerSnapshot, pairSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(profileRef(managerUid)),
        transaction.get(pairRef(managerUid, uid)),
      ]);
      const payer = readProfile(payerSnapshot);
      const manager = readProfile(managerSnapshot);
      const pair = object(pairSnapshot.data());
      const openContractSnapshot = CONTRACT_ID_PATTERN.test(String(pair.openContractId || ""))
        ? await transaction.get(contractRef(pair.openContractId))
        : null;
      if (playerSafety) await playerSafety.assertAllowed(uid, managerUid, transaction);
      requireAge(payer);
      if (manager.ageConfirmedVersion !== TRIBUTE_AGE_VERSION || !manager.card || manager.publicManagerId !== publicManagerId) {
        fail("not-found", "この管理人は見つかりません。");
      }
      if (!manager.accepting) fail("failed-precondition", "この管理人は今、受付を止めています。");
      if (profileIsHidden(manager, jstMonthKey(now))) fail("not-found", "この管理人は見つかりません。");
      const entryFee = integer(manager.card.entryFee, 0, 1_000, 0);
      if (entryFee !== expectedEntryFee) fail("failed-precondition", "入場料が変わりました。管理人カードを開き直してください。");
      const normalized = normalizeApplication(data?.application, { entryFee });
      if (normalized.error) fail("invalid-argument", normalized.error);
      const application = normalized.application;
      if (openContractSnapshot?.exists && OPEN_STATUSES.includes(openContractSnapshot.get("status"))) {
        fail("failed-precondition", "この管理人とは、申込中か進行中の契約があります。");
      }
      // 申し込みと取り下げの繰り返しで、管理人の受付待ちを埋められないようにする。
      if (now - payer.lastApplyAt < APPLY_INTERVAL_MS) {
        fail("resource-exhausted", "申し込みは30秒に1回までです。少し待ってからお試しください。");
      }
      if (payer.counts.payerOpen >= LIMITS.payerOpenContracts) {
        fail("failed-precondition", "申込中・進行中の契約は3件までです。どれかを終えてから申し込んでください。");
      }
      if (manager.counts.managerPending >= LIMITS.managerPendingContracts) {
        fail("failed-precondition", "この管理人は受付待ちがいっぱいです。時間をおいてください。");
      }
      const renewal = integer(pair.contractsAccepted, 0, Number.MAX_SAFE_INTEGER, 0) > 0;
      const contract = {
        schemaVersion: TRIBUTE_SCHEMA_VERSION,
        contractId,
        managerUid,
        payerUid: uid,
        participants: [managerUid, uid],
        status: "pending",
        endReason: "",
        managerCard: cardSnapshot(manager.card),
        entryFee,
        payerWalletName: application.walletName,
        caps: application.caps,
        pendingCaps: null,
        pendingCapsEffectiveDateKey: "",
        durationDays: application.durationDays,
        tone: application.tone,
        ngWords: application.ngWords,
        allowReportRequests: application.allowReportRequests,
        rankOptIn: application.rankOptIn,
        allowSexualPurposes: application.allowSexualPurposes,
        purposeCounts: {},
        rewardCount: 0,
        awaitingReceipt: 0,
        renewal,
        createdAt: now,
        expiresAt: now + LIMITS.applicationTtlMs,
        acceptedAt: 0,
        endedAt: 0,
        totalTributed: 0,
        tributeCount: 0,
        todayKey: "",
        todayTributed: 0,
        escrowBalance: 0,
        escrowDeposited: 0,
        escrowWithdrawRequest: null,
        pendingRequests: {},
        reportRequestedAt: 0,
        readSeq: { manager: 0, payer: 1 },
        lastMessageAt: {},
        messageDay: {},
        recentOps: [],
        eventSeq: 1,
        lastEventAt: now,
        updatedAt: now,
      };
      transaction.create(contractRef(contractId), contract);
      transaction.create(eventRef(contractId, 1), {
        seq: 1,
        type: "applied",
        actor: "payer",
        caps: application.caps,
        durationDays: application.durationDays,
        tone: application.tone,
        entryFee,
        allowSexualPurposes: application.allowSexualPurposes,
        createdAt: now,
      });
      transaction.set(profileRef(uid), {
        walletName: application.walletName,
        lastApplyAt: now,
        counts: { ...payer.counts, payerOpen: payer.counts.payerOpen + 1 },
        updatedAt: now,
      }, { merge: true });
      transaction.set(profileRef(managerUid), {
        counts: { ...manager.counts, managerPending: manager.counts.managerPending + 1 },
        updatedAt: now,
      }, { merge: true });
      transaction.set(pairRef(managerUid, uid), {
        managerUid,
        payerUid: uid,
        openContractId: contractId,
        ...(pairSnapshot.exists ? {} : { total: 0, count: 0, createdAt: now }),
        updatedAt: now,
      }, { merge: true });
      created = viewContract(contract, uid, now);
    });
    return { ok: true, contract: created };
  }

  function messageRate(ctx) {
    const role = ctx.role;
    const last = integer(object(ctx.contract.lastMessageAt)[role], 0, Number.MAX_SAFE_INTEGER, 0);
    if (ctx.now - last < LIMITS.messageIntervalMs) fail("resource-exhausted", "連投は2秒に1回までです。");
    const day = object(object(ctx.contract.messageDay)[role]);
    const count = day.key === ctx.dateKey ? integer(day.count, 0, 1_000_000, 0) : 0;
    if (count >= LIMITS.messagesPerDay) fail("resource-exhausted", "この契約で今日送れる数（300件）に達しました。");
    setContract(ctx, {
      lastMessageAt: { ...object(ctx.contract.lastMessageAt), [role]: ctx.now },
      messageDay: { ...object(ctx.contract.messageDay), [role]: { key: ctx.dateKey, count: count + 1 } },
    });
  }

  function checkManagerText(ctx, text) {
    const reason = forbiddenReason(text);
    if (reason) fail("invalid-argument", FORBIDDEN_MESSAGES[reason]);
    if (ctx.role === "manager" && containsNgWord(text, ctx.contract.ngWords)) {
      fail("invalid-argument", FORBIDDEN_MESSAGES.ng_word);
    }
  }

  function markManagerActive(ctx) {
    if (ctx.role === "manager") patchProfile(ctx, "manager", { lastActiveAt: ctx.now });
  }

  function view(ctx) {
    return viewContract(ctx.contract, ctx.uid, ctx.now);
  }

  const contractActions = {
    withdraw: {
      roles: ["payer"],
      statuses: ["pending"],
      write(ctx) {
        stageEnd(ctx, "withdrawn");
        return { ok: true, contract: view(ctx) };
      },
    },
    decline: {
      roles: ["manager"],
      statuses: ["pending"],
      write(ctx) {
        stageEnd(ctx, "declined");
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    accept: {
      roles: ["manager"],
      statuses: ["pending"],
      ensureWallets: ["manager", "payer"],
      achievements: true,
      read: (transaction, ctx) => readTributeExtras(transaction, ctx, hashId("receipt", ctx.contractId, "entry")),
      write(ctx, extra) {
        const manager = ctx.profiles.manager.value;
        if (manager.counts.managerActive >= LIMITS.managerActiveContracts) {
          fail("failed-precondition", "進行中の契約は30件までです。");
        }
        const durationDays = integer(ctx.contract.durationDays, 1, 7, 1);
        setContract(ctx, {
          status: "active",
          acceptedAt: ctx.now,
          expiresAt: ctx.now + durationDays * DAY_MS,
        });
        adjustCounts(ctx, "manager", { managerPending: -1, managerActive: 1 });
        patchPair(ctx, {
          contractsAccepted: integer(ctx.pair.value.contractsAccepted, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
          rankOptIn: ctx.contract.rankOptIn === true,
          walletName: payerName(ctx),
          managerPersonaName: managerName(ctx),
        });
        const collarNo = ensureCollar(ctx);
        pushEvent(ctx, { type: "accepted", actor: "manager", expiresAt: ctx.contract.expiresAt, collarNo });
        markManagerActive(ctx);
        ctx.caps = effectiveCaps(ctx.contract, ctx.now).caps;
        const entryFee = integer(ctx.contract.entryFee, 0, 1_000, 0);
        let entry = null;
        if (entryFee > 0) {
          entry = stageTribute(ctx, extra, { kind: "entry", amount: entryFee, opKey: "entry" });
        }
        return { ok: true, contract: view(ctx), entryFeeCharged: entry ? entryFee : 0 };
      },
    },
    message: {
      roles: ["manager", "payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const normalized = normalizeMessage(data?.text);
        if (normalized.error) fail("invalid-argument", normalized.error);
        checkManagerText(ctx, normalized.text);
        messageRate(ctx);
        pushEvent(ctx, {
          type: "message",
          actor: ctx.role,
          text: normalized.text,
          ...(data?.template === true ? { template: true } : {}),
        });
        markManagerActive(ctx);
        return { ok: true, seq: ctx.seq };
      },
    },
    request: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const amount = requireAmount(data?.amount);
        const violation = capViolation(amount, ctx.contract, ctx.caps, ctx.now);
        if (violation) fail("failed-precondition", violation);
        const pending = pendingRequestList(ctx.contract);
        if (pending.length >= LIMITS.pendingRequests) fail("failed-precondition", "未払いの請求は3件までです。");
        const note = cleanLine(data?.note, LIMITS.requestNote);
        if (note) checkManagerText(ctx, note);
        const named = normalizePurpose(data?.purpose, { allowSexual: ctx.contract.allowSexualPurposes === true });
        if (named.error) fail("failed-precondition", named.error);
        const purpose = named.purpose;
        messageRate(ctx);
        const requestId = randomHex(8);
        setContract(ctx, {
          pendingRequests: {
            ...object(ctx.contract.pendingRequests),
            [requestId]: { amount, note, ...(purpose ? { purpose } : {}), createdAt: ctx.now },
          },
        });
        pushEvent(ctx, { type: "request", actor: "manager", requestId, amount, ...(note ? { note } : {}), ...(purpose ? { purpose } : {}) });
        markManagerActive(ctx);
        return { ok: true, requestId };
      },
    },
    cancel_request: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const requestId = String(data?.requestId || "");
        const requests = { ...object(ctx.contract.pendingRequests) };
        if (!requests[requestId]) fail("not-found", "その請求は残っていません。");
        delete requests[requestId];
        setContract(ctx, { pendingRequests: requests });
        pushEvent(ctx, { type: "request_cancelled", actor: "manager", requestId });
        return { ok: true };
      },
    },
    decline_request: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const requestId = String(data?.requestId || "");
        const requests = { ...object(ctx.contract.pendingRequests) };
        if (!requests[requestId]) fail("not-found", "その請求は残っていません。");
        delete requests[requestId];
        setContract(ctx, { pendingRequests: requests });
        pushEvent(ctx, { type: "request_declined", actor: "payer", requestId });
        return { ok: true };
      },
    },
    tribute: {
      roles: ["payer"],
      statuses: ["active"],
      ensureWallets: ["manager", "payer"],
      achievements: true,
      read: (transaction, ctx, data) => readTributeExtras(
        transaction,
        ctx,
        hashId("receipt", ctx.contractId, requireClientRequestId(data?.clientRequestId)),
      ),
      write(ctx, extra, data) {
        const clientRequestId = requireClientRequestId(data?.clientRequestId);
        if (extra.receipt) {
          return { ok: true, replayed: true, receipt: { receiptId: extra.receiptId, ...extra.receipt } };
        }
        const kind = data?.kind === "request" ? "request" : "silent";
        const allowSexual = ctx.contract.allowSexualPurposes === true;
        let amount;
        let requestId = "";
        let note = "";
        let purpose = "";
        if (kind === "request") {
          requestId = String(data?.requestId || "");
          const requests = { ...object(ctx.contract.pendingRequests) };
          const request = requests[requestId];
          if (!request) fail("not-found", "その請求は残っていません。");
          amount = integer(request.amount, 0, 1_000_000, 0);
          if (Number(data?.amount) !== amount) fail("failed-precondition", "請求の金額が変わりました。開き直してください。");
          note = cleanLine(request.note, LIMITS.requestNote);
          purpose = visiblePurpose(request.purpose, { allowSexual });
          delete requests[requestId];
          setContract(ctx, { pendingRequests: requests });
        } else {
          amount = requireAmount(data?.amount);
          const named = normalizePurpose(data?.purpose, { allowSexual });
          if (named.error) fail("failed-precondition", named.error);
          purpose = named.purpose;
        }
        const outcome = stageTribute(ctx, extra, { kind, amount, requestId, purpose, opKey: `client:${clientRequestId}` });
        return {
          ok: true,
          receipt: outcome.receipt,
          contract: view(ctx),
          walletBalance: ctx.wallets.payer.state.balance,
        };
      },
    },
    set_caps: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const next = normalizeCaps(data?.caps);
        if (!next) fail("invalid-argument", "上限は「1回 ≦ 1日 ≦ 合計」になるように選んでください。");
        const current = ctx.caps;
        const immediate = {
          perTribute: Math.min(next.perTribute, current.perTribute),
          perDay: Math.min(next.perDay, current.perDay),
          total: Math.min(next.total, current.total),
        };
        const lowered = !capsAreLowerOrEqual(current, immediate);
        const raising = !capsAreLowerOrEqual(next, immediate);
        if (!lowered && !raising) return { ok: true, contract: view(ctx), unchanged: true };
        if (lowered) {
          setContract(ctx, { caps: immediate });
          ctx.caps = immediate;
          pushEvent(ctx, { type: "caps_lowered", actor: "payer", caps: immediate });
          // 下げた上限を超える請求は、その場で無効にする。
          const requests = { ...object(ctx.contract.pendingRequests) };
          for (const [requestId, request] of Object.entries(requests)) {
            if (integer(request?.amount, 0, 1_000_000, 0) > immediate.perTribute) {
              delete requests[requestId];
              pushEvent(ctx, { type: "request_cancelled", actor: "system", requestId, reason: "caps" });
            }
          }
          setContract(ctx, { pendingRequests: requests });
          // 管理口座が新しい合計上限の残りを超えた分は、すぐ財布へ戻す。
          const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
          const room = Math.max(0, immediate.total - integer(ctx.contract.totalTributed, 0, Number.MAX_SAFE_INTEGER, 0));
          const excess = Math.max(0, escrow - room);
          if (excess > 0) returnEscrow(ctx, excess, `caps:${ctx.now}`, "caps");
        }
        if (raising) {
          const effectiveDateKey = nextJstDateKey(ctx.now);
          setContract(ctx, { pendingCaps: next, pendingCapsEffectiveDateKey: effectiveDateKey });
          pushEvent(ctx, { type: "caps_raise_scheduled", actor: "payer", caps: next, effectiveDateKey });
        } else if (ctx.contract.pendingCaps) {
          setContract(ctx, { pendingCaps: null, pendingCapsEffectiveDateKey: "" });
          pushEvent(ctx, { type: "caps_raise_cancelled", actor: "payer" });
        }
        return { ok: true, contract: view(ctx) };
      },
    },
    cancel_raise: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx) {
        if (!ctx.contract.pendingCaps) return { ok: true, contract: view(ctx) };
        setContract(ctx, { pendingCaps: null, pendingCapsEffectiveDateKey: "" });
        pushEvent(ctx, { type: "caps_raise_cancelled", actor: "payer" });
        return { ok: true, contract: view(ctx) };
      },
    },
    terminate: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx) {
        stageEnd(ctx, "terminated");
        return { ok: true, contract: view(ctx) };
      },
    },
    release: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        stageEnd(ctx, "released");
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    escrow_deposit: {
      roles: ["payer"],
      statuses: ["active"],
      ensureWallets: ["payer"],
      write(ctx, _extra, data) {
        const clientRequestId = requireClientRequestId(data?.clientRequestId);
        const opKey = `deposit:${clientRequestId}`;
        if (hasRecentOp(ctx, opKey)) return { ok: true, replayed: true, contract: view(ctx) };
        const amount = requireAmount(data?.amount);
        const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
        const room = Math.max(0, ctx.caps.total - integer(ctx.contract.totalTributed, 0, Number.MAX_SAFE_INTEGER, 0) - escrow);
        if (amount > room) fail("failed-precondition", `管理口座に預けられるのは、あと ${room} Pay までです（契約合計の上限 − 献上済み）。`);
        if (peekBalance(ctx, "payer") < amount) fail("failed-precondition", "AnjuPay残高が足りません。");
        const wallet = walletFor(ctx, "payer");
        const before = wallet.balance;
        debitPoints(wallet, amount);
        const groupId = anjuPayEntryId(`tribute-escrow:${ctx.contractId}:${opKey}`);
        appendEntry(ctx, "payer", {
          entryId: groupId,
          groupId,
          kind: "tribute_escrow_hold",
          labelKey: "anju_pay_tribute_escrow_hold",
          status: "held",
          delta: -amount,
          nominalAmount: amount,
          balanceBefore: before,
          balanceAfter: wallet.balance,
          components: [{ kind: "escrow_hold", labelKey: "anju_pay_tribute_escrow_hold", status: "held", delta: -amount, nominalAmount: amount }],
          details: { mode: "tribute", role: "payer", counterpartyName: managerName(ctx) },
        });
        setContract(ctx, {
          escrowBalance: escrow + amount,
          escrowDeposited: integer(ctx.contract.escrowDeposited, 0, Number.MAX_SAFE_INTEGER, 0) + amount,
        });
        rememberOp(ctx, opKey);
        pushEvent(ctx, { type: "escrow_deposit", actor: "payer", amount, escrowBalance: escrow + amount });
        return { ok: true, contract: view(ctx), walletBalance: wallet.balance };
      },
    },
    escrow_withdraw_request: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
        const amount = requireAmount(data?.amount);
        if (amount > escrow) fail("failed-precondition", "管理口座の残高を超えています。");
        if (ctx.contract.escrowWithdrawRequest) fail("failed-precondition", "使用許可の申請は1件ずつです。");
        setContract(ctx, { escrowWithdrawRequest: { amount, requestedAt: ctx.now } });
        pushEvent(ctx, { type: "escrow_withdraw_request", actor: "payer", amount });
        return { ok: true, contract: view(ctx) };
      },
    },
    escrow_withdraw_cancel: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx) {
        if (!ctx.contract.escrowWithdrawRequest) return { ok: true, contract: view(ctx) };
        setContract(ctx, { escrowWithdrawRequest: null });
        pushEvent(ctx, { type: "escrow_withdraw_cancelled", actor: "payer" });
        return { ok: true, contract: view(ctx) };
      },
    },
    escrow_decision: {
      roles: ["manager"],
      statuses: ["active"],
      ensureWallets: ["payer"],
      write(ctx, _extra, data) {
        const request = ctx.contract.escrowWithdrawRequest;
        if (!request) fail("failed-precondition", "使用許可の申請はありません。");
        const approve = data?.approve === true;
        setContract(ctx, { escrowWithdrawRequest: null });
        if (approve) {
          const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
          const amount = Math.min(escrow, integer(request.amount, 0, 1_000_000, 0));
          if (amount > 0) returnEscrow(ctx, amount, `approve:${integer(request.requestedAt, 0, Number.MAX_SAFE_INTEGER, 0)}`, "approved");
          pushEvent(ctx, { type: "escrow_approved", actor: "manager", amount });
        } else {
          pushEvent(ctx, { type: "escrow_denied", actor: "manager", amount: integer(request.amount, 0, 1_000_000, 0) });
        }
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    escrow_take: {
      roles: ["manager"],
      statuses: ["active"],
      ensureWallets: ["manager", "payer"],
      achievements: true,
      read: (transaction, ctx, data) => readTributeExtras(
        transaction,
        ctx,
        hashId("receipt", ctx.contractId, `take:${requireClientRequestId(data?.clientRequestId)}`),
      ),
      write(ctx, extra, data) {
        const clientRequestId = requireClientRequestId(data?.clientRequestId);
        if (extra.receipt) return { ok: true, replayed: true, contract: view(ctx) };
        const amount = requireAmount(data?.amount);
        stageTribute(ctx, extra, { kind: "escrow_take", amount, opKey: `take:${clientRequestId}` });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    report_balance: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx) {
        messageRate(ctx);
        const walletBalance = peekBalance(ctx, "payer");
        const escrowBalance = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
        setContract(ctx, { reportRequestedAt: 0 });
        pushEvent(ctx, { type: "report", actor: "payer", walletBalance, escrowBalance });
        return { ok: true };
      },
    },
    request_report: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        if (ctx.contract.allowReportRequests !== true) fail("failed-precondition", "この契約では、残高報告を求められません。");
        if (Number(ctx.contract.reportRequestedAt || 0) > 0) fail("failed-precondition", "報告の要求は1件ずつです。");
        messageRate(ctx);
        setContract(ctx, { reportRequestedAt: ctx.now });
        pushEvent(ctx, { type: "report_requested", actor: "manager" });
        markManagerActive(ctx);
        return { ok: true };
      },
    },
    // 性的な名目の許可。決めるのは預ける側だけ。外すと、性的な名目の未払いの請求はその場で無効になる。
    set_purposes: {
      roles: ["payer"],
      statuses: ["pending", "active"],
      write(ctx, _extra, data) {
        const allow = data?.allowSexualPurposes === true;
        if ((ctx.contract.allowSexualPurposes === true) === allow) return { ok: true, contract: view(ctx), unchanged: true };
        setContract(ctx, { allowSexualPurposes: allow });
        pushEvent(ctx, { type: "purposes_changed", actor: "payer", allowSexualPurposes: allow });
        if (!allow) {
          const requests = { ...object(ctx.contract.pendingRequests) };
          for (const [requestId, request] of Object.entries(requests)) {
            if (SEXUAL_PURPOSE_IDS.includes(String(request?.purpose || ""))) {
              delete requests[requestId];
              pushEvent(ctx, { type: "request_cancelled", actor: "system", requestId, reason: "purpose" });
            }
          }
          setContract(ctx, { pendingRequests: requests });
        }
        return { ok: true, contract: view(ctx) };
      },
    },
    // 財布から差し出された献上を、管理人が受け取る。1つの献上につき1回だけで、ご褒美の一言を添えられる。
    // Payは差し出した時点で移っている。受け取りは「相手が確かに見た」という記録で、お金は動かさない。
    receive: {
      roles: ["manager"],
      statuses: ["active"],
      read: async (transaction, ctx, data) => {
        const seq = integer(data?.tributeSeq, 0, Number.MAX_SAFE_INTEGER, 0);
        if (seq < 1 || seq > ctx.seq) return { seq, event: null, receiptExists: false };
        const snapshot = await transaction.get(eventRef(ctx.contractId, seq));
        const event = snapshot.exists ? object(snapshot.data()) : null;
        const receiptId = RECEIPT_ID_PATTERN.test(String(event?.receiptId || "")) ? event.receiptId : "";
        const receiptSnapshot = receiptId ? await transaction.get(receiptRef(ctx.payerUid, receiptId)) : null;
        return { seq, event, receiptId, receiptExists: receiptSnapshot?.exists === true };
      },
      write(ctx, extra, data) {
        const event = extra.event;
        if (!event || event.type !== "tribute" || !RECEIVABLE_KINDS.includes(event.kind)) {
          fail("not-found", "受け取れる献上が見つかりません。");
        }
        if (integer(event.receivedAt, 0, Number.MAX_SAFE_INTEGER, 0) > 0) fail("failed-precondition", "この献上はもう受け取っています。");
        const normalized = normalizeReward(data?.reward, { tone: ctx.contract.tone, ngWords: ctx.contract.ngWords });
        if (normalized.error) fail("invalid-argument", normalized.error);
        const reward = normalized.reward;
        const seal = sealFor(data?.seal, { seals: ctx.profiles.manager.value.card?.seals, ngWords: ctx.contract.ngWords });
        const marks = { receivedAt: ctx.now, seal, ...(reward ? { reward } : {}) };
        ctx.extraWrites.push((transaction) => transaction.update(eventRef(ctx.contractId, extra.seq), marks));
        if (extra.receiptExists) {
          ctx.extraWrites.push((transaction) => transaction.update(receiptRef(ctx.payerUid, extra.receiptId), marks));
        }
        setContract(ctx, {
          awaitingReceipt: Math.max(0, integer(ctx.contract.awaitingReceipt, 0, Number.MAX_SAFE_INTEGER, 0) - 1),
          ...(reward ? { rewardCount: integer(ctx.contract.rewardCount, 0, Number.MAX_SAFE_INTEGER, 0) + 1 } : {}),
        });
        pushEvent(ctx, {
          type: "received",
          actor: "manager",
          tributeSeq: extra.seq,
          amount: integer(event.amount, 0, Number.MAX_SAFE_INTEGER, 0),
          seal,
          ...(reward ? { reward } : {}),
        });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    mark_read: {
      roles: ["manager", "payer"],
      statuses: ["pending", "active", "ended"],
      lightweightMarkRead: true,
      write(ctx, _extra, data) {
        const seq = Math.min(ctx.seq, integer(data?.seq, 0, Number.MAX_SAFE_INTEGER, 0));
        const readSeq = object(ctx.contract.readSeq);
        if (seq > integer(readSeq[ctx.role], 0, Number.MAX_SAFE_INTEGER, 0)) {
          ctx.quiet = true;
          setContract(ctx, { readSeq: { ...readSeq, [ctx.role]: seq } });
        }
        return { ok: true, contractId: ctx.contractId, readSeq: integer(object(ctx.contract.readSeq)[ctx.role], 0, Number.MAX_SAFE_INTEGER, 0), eventSeq: ctx.seq };
      },
    },
    report_user: {
      roles: ["manager", "payer"],
      statuses: ["pending", "active", "ended"],
      read: async (transaction, ctx) => {
        const targetUid = ctx.role === "manager" ? ctx.payerUid : ctx.managerUid;
        const reportId = hashId("tribute-report", ctx.uid, targetUid, ctx.monthKey);
        const snapshot = await transaction.get(reportRef(reportId));
        return { reportId, exists: snapshot.exists, targetUid };
      },
      write(ctx, extra, data) {
        const reason = String(data?.reason || "");
        if (!REPORT_REASONS.includes(reason)) fail("invalid-argument", "通報の理由を選んでください。");
        if (extra.exists) return { ok: true, duplicate: true };
        const note = cleanLine(data?.note, 120);
        ctx.extraWrites.push((transaction) => transaction.create(reportRef(extra.reportId), {
          schemaVersion: TRIBUTE_SCHEMA_VERSION,
          reporterUid: ctx.uid,
          targetUid: extra.targetUid,
          targetRole: ctx.role === "manager" ? "payer" : "manager",
          contractId: ctx.contractId,
          reason,
          note,
          monthKey: ctx.monthKey,
          createdAt: ctx.now,
        }));
        if (SEVERE_REPORT_REASONS.includes(reason)) {
          const who = ctx.role === "manager" ? "payer" : "manager";
          const target = ctx.profiles[who].value;
          const count = target.severeReportMonthKey === ctx.monthKey ? target.severeReportCount : 0;
          patchProfile(ctx, who, { severeReportMonthKey: ctx.monthKey, severeReportCount: count + 1 });
        }
        return { ok: true };
      },
    },
  };

  function returnEscrow(ctx, amount, key, reason) {
    const wallet = walletFor(ctx, "payer");
    const before = wallet.balance;
    creditPoints(wallet, amount);
    const groupId = anjuPayEntryId(`tribute-escrow-return:${ctx.contractId}:${key}`);
    appendEntry(ctx, "payer", {
      entryId: groupId,
      groupId,
      kind: "tribute_escrow_return",
      labelKey: "anju_pay_tribute_escrow_return",
      delta: amount,
      nominalAmount: amount,
      balanceBefore: before,
      balanceAfter: wallet.balance,
      components: [{ kind: "escrow_return", labelKey: "anju_pay_tribute_escrow_return", status: "settled", delta: amount, nominalAmount: amount }],
      details: { mode: "tribute", role: "payer", counterpartyName: managerName(ctx) },
    });
    const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0) - amount;
    setContract(ctx, { escrowBalance: Math.max(0, escrow) });
    if (reason === "caps") pushEvent(ctx, { type: "escrow_returned", actor: "system", amount, reason });
  }

  async function runNamedContractAction(uid, action, data) {
    const spec = contractActions[action];
    return runContract(uid, data, {
      ...spec,
      read: spec.read ? (transaction, ctx) => spec.read(transaction, ctx, data) : null,
      write: (ctx, extra) => spec.write(ctx, extra, data),
    });
  }

  async function endBySystem(contractId, reason = "") {
    if (!CONTRACT_ID_PATTERN.test(String(contractId || ""))) return { ended: false };
    let ended = false;
    let wallets = [];
    await firestore.runTransaction(async (transaction) => {
      ended = false;
      wallets = [];
      const ctx = await loadContext(transaction, contractId, null);
      if (!OPEN_STATUSES.includes(ctx.contract.status)) return;
      if (reason === "blocked") {
        stageEnd(ctx, "blocked");
      } else if (!lazyTransition(ctx)) {
        return;
      }
      ended = true;
      flush(ctx);
      wallets = touchedWallets(ctx);
    });
    await mirrorTouched(wallets);
    return { ended };
  }

  async function receiptsAction(uid, data) {
    requireAge(await readOwnProfile(uid));
    const before = integer(data?.before, 0, Number.MAX_SAFE_INTEGER, 0);
    let query = firestore.collection("tributeReceipts").doc(uid).collection("items").orderBy("createdAt", "desc");
    if (before > 0) query = query.where("createdAt", "<", before);
    const snapshot = await query.limit(LIMITS.receiptsPage).get();
    const receipts = snapshot.docs.map((document) => {
      const value = object(document.data());
      return {
        receiptId: document.id,
        receiptNo: integer(value.receiptNo, 0, Number.MAX_SAFE_INTEGER, 0),
        contractId: String(value.contractId || ""),
        kind: String(value.kind || "silent"),
        amount: integer(value.amount, 0, Number.MAX_SAFE_INTEGER, 0),
        personaName: cleanLine(value.personaName, LIMITS.personaName),
        disclosure: String(value.disclosure || "undisclosed"),
        sigil: integer(value.sigil, 0, 5, 0),
        avatar: normalizeAvatar(value.avatar),
        purpose: PURPOSE_IDS.includes(value.purpose) ? value.purpose : "",
        receivedAt: integer(value.receivedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        reward: typeof value.reward === "string" && /^[a-z_]{1,24}$/.test(value.reward) ? value.reward : "",
        seal: SEAL_IDS.includes(value.seal) ? value.seal : "",
        collarNo: integer(value.collarNo, 0, Number.MAX_SAFE_INTEGER, 0),
        pairCount: integer(value.pairCount, 0, Number.MAX_SAFE_INTEGER, 0),
        createdAt: integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
      };
    });
    return { ok: true, receipts, more: receipts.length === LIMITS.receiptsPage };
  }

  // 貢ぎ報告の画像を作る時に、管理人のいまの許可とカードを確かめる。読むのは契約・自分・管理人（と自分のレシート1枚）だけで、書き込まない。
  // 許可がない時は名前とアイコンを返さず、画像では「管理人様」とシルエットにする。
  async function shareInfoAction(uid, data) {
    const contractId = requireContractId(data?.contractId);
    const [contractSnapshot, ownSnapshot] = await Promise.all([contractRef(contractId).get(), profileRef(uid).get()]);
    requireAge(readProfile(ownSnapshot));
    if (!contractSnapshot.exists) fail("not-found", "契約が見つかりません。");
    const contract = object(contractSnapshot.data());
    const managerUid = String(contract.managerUid || "");
    if (contract.payerUid !== uid || !managerUid) fail("permission-denied", "貢ぎ報告の画像を作れるのは、預ける側だけです。");
    const receiptId = RECEIPT_ID_PATTERN.test(String(data?.receiptId || "")) ? data.receiptId : "";
    const [managerSnapshot, receiptSnapshot] = await Promise.all([
      profileRef(managerUid).get(),
      receiptId ? receiptRef(uid, receiptId).get() : Promise.resolve(null),
    ]);
    const managerProfile = readProfile(managerSnapshot);
    const consent = managerProfile.card?.reportConsent === true;
    const card = cardSnapshot(managerProfile.card || contract.managerCard);
    const stored = receiptSnapshot?.exists ? object(receiptSnapshot.data()) : null;
    // 自分のレシートで、この契約のものだけを返す。
    const receipt = stored && stored.contractId === contractId
      ? {
        receiptId,
        receiptNo: integer(stored.receiptNo, 0, Number.MAX_SAFE_INTEGER, 0),
        kind: String(stored.kind || "silent"),
        amount: integer(stored.amount, 0, Number.MAX_SAFE_INTEGER, 0),
        purpose: PURPOSE_IDS.includes(stored.purpose) ? stored.purpose : "",
        pairCount: integer(stored.pairCount, 0, Number.MAX_SAFE_INTEGER, 0),
        createdAt: integer(stored.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
        receivedAt: integer(stored.receivedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        seal: SEAL_IDS.includes(stored.seal) ? stored.seal : "",
        reward: typeof stored.reward === "string" && /^[a-z_]{1,24}$/.test(stored.reward) ? stored.reward : "",
      }
      : null;
    return {
      receipt,
      ok: true,
      contractId,
      consent,
      manager: consent
        ? { personaName: card.personaName, disclosure: card.disclosure, style: card.style, sigil: card.sigil, avatar: card.avatar }
        : { personaName: "", disclosure: card.disclosure, sigil: 0, avatar: 0 },
      collarNo: integer(contract.collarNo, 0, Number.MAX_SAFE_INTEGER, 0),
      walletName: normalizeWalletName(contract.payerWalletName),
    };
  }

  async function ledgerAction(uid) {
    requireAge(await readOwnProfile(uid));
    const [asPayer, asManager] = await Promise.all([
      firestore.collection("tributePairs").where("payerUid", "==", uid).orderBy("lastAt", "desc").limit(50).get(),
      firestore.collection("tributePairs").where("managerUid", "==", uid).orderBy("lastAt", "desc").limit(50).get(),
    ]);
    const row = (pair, counterpartName) => ({
      counterpartName,
      total: integer(pair.total, 0, Number.MAX_SAFE_INTEGER, 0),
      count: integer(pair.count, 0, Number.MAX_SAFE_INTEGER, 0),
      firstAt: integer(pair.firstAt, 0, Number.MAX_SAFE_INTEGER, 0),
      lastAt: integer(pair.lastAt, 0, Number.MAX_SAFE_INTEGER, 0),
      openContractId: CONTRACT_ID_PATTERN.test(String(pair.openContractId || "")) ? pair.openContractId : "",
    });
    return {
      ok: true,
      asPayer: asPayer.docs.map((document) => object(document.data()))
        .filter((pair) => integer(pair.count, 0, Number.MAX_SAFE_INTEGER, 0) > 0)
        .map((pair) => row(pair, cleanLine(pair.managerPersonaName, LIMITS.personaName) || "管理人")),
      asManager: asManager.docs.map((document) => object(document.data()))
        .filter((pair) => integer(pair.count, 0, Number.MAX_SAFE_INTEGER, 0) > 0)
        .map((pair) => row(pair, normalizeWalletName(pair.walletName))),
    };
  }

  async function rankingsAction(uid, data) {
    requireAge(await readOwnProfile(uid));
    const now = currentTime();
    const monthKey = jstMonthKey(now);
    const snapshot = await firestore.collection("tributeManagerMonths")
      .where("monthKey", "==", monthKey)
      .orderBy("payers", "desc")
      .orderBy("rankScore", "desc")
      .limit(LIMITS.rankingLimit * 2)
      .get();
    const rows = snapshot.docs.map((document) => ({ uid: String(document.get("managerUid") || ""), value: object(document.data()) }));
    const profileSnapshots = rows.length
      ? await Promise.all(rows.map((row) => profileRef(row.uid).get()))
      : [];
    const visible = (await visibleRows(uid, rows.map((row, index) => ({ ...row, profile: readProfile(profileSnapshots[index]) }))))
      .filter((row) => row.uid && !profileIsHidden(row.profile, monthKey) && row.profile.publicManagerId)
      .slice(0, LIMITS.rankingLimit)
      .map((row, index) => ({
        rank: index + 1,
        publicManagerId: row.profile.publicManagerId,
        personaName: cleanLine(row.profile.card?.personaName || row.value.personaName, LIMITS.personaName) || "管理人",
        disclosure: String(row.profile.card?.disclosure || row.value.disclosure || "undisclosed"),
        sigil: integer(row.profile.card?.sigil ?? row.value.sigil, 0, 5, 0),
        avatar: normalizeAvatar(row.profile.card?.avatar ?? row.value.avatar),
        honor: honorFor(row.profile, monthKey),
        payers: integer(row.value.payers, 0, Number.MAX_SAFE_INTEGER, 0),
        rankScore: integer(row.value.rankScore, 0, Number.MAX_SAFE_INTEGER, 0),
        mine: row.uid === uid,
      }));
    let managerBoard = null;
    if (data?.publicManagerId) {
      const { uid: managerUid } = await findManagerByPublicId(requirePublicManagerId(data.publicManagerId));
      managerBoard = await managerRanking(managerUid, monthKey, uid);
    }
    return { ok: true, monthKey, managers: visible, managerBoard };
  }

  function honorSummary(honor) {
    const tier = honorTierFor(honor.offered);
    return {
      offered: integer(honor.offered, 0, Number.MAX_SAFE_INTEGER, 0),
      tier: tier ? { tierId: tier.id, label: tier.label, recommendationSlots: tier.recommendationSlots } : null,
      vote: POLICIES.includes(honor.vote) ? honor.vote : "",
      recommendations: Array.isArray(honor.recommendations)
        ? honor.recommendations.filter((id) => PUBLIC_MANAGER_ID_PATTERN.test(String(id))).slice(0, 3)
        : [],
    };
  }

  async function fundAction(uid, _data, context) {
    const profile = await readOwnProfile(uid);
    requireAge(profile);
    const now = currentTime();
    const monthKey = jstMonthKey(now);
    const [fundSnapshot, monthSnapshot, honorSnapshot] = await Promise.all([
      fundRef(monthKey).get(),
      managerMonthRef(monthKey, uid).get(),
      honorRef(monthKey, uid).get(),
    ]);
    const fund = object(fundSnapshot.data());
    const month = object(monthSnapshot.data());
    const honor = honorSummary(object(honorSnapshot.data()));
    const tributeCount = integer(month.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0);
    const payers = integer(month.payers, 0, Number.MAX_SAFE_INTEGER, 0);
    const receivedNet = integer(month.receivedNet, 0, Number.MAX_SAFE_INTEGER, 0);
    const offered = integer(month.offered, 0, Number.MAX_SAFE_INTEGER, 0);
    const recommendationRows = [];
    for (const id of honor.recommendations) {
      const snapshot = await firestore.collection("tributeProfiles").where("publicManagerId", "==", id).limit(1).get();
      const document = snapshot.docs[0];
      if (!document) continue;
      const card = readProfile(document).card;
      recommendationRows.push({ publicManagerId: id, personaName: cleanLine(card?.personaName, LIMITS.personaName) || "管理人" });
    }
    return {
      ok: true,
      monthKey,
      fund: {
        balance: integer(fund.balance, 0, Number.MAX_SAFE_INTEGER, 0),
        contributed: integer(fund.contributed, 0, Number.MAX_SAFE_INTEGER, 0),
        burned: integer(fund.burned, 0, Number.MAX_SAFE_INTEGER, 0),
        subsidized: integer(fund.subsidized, 0, Number.MAX_SAFE_INTEGER, 0),
        subsidyCount: integer(fund.subsidyCount, 0, Number.MAX_SAFE_INTEGER, 0),
        policy: fundPolicy(fund),
        votes: {
          both: integer(object(fund.votes).both, 0, Number.MAX_SAFE_INTEGER, 0),
          first: integer(object(fund.votes).first, 0, Number.MAX_SAFE_INTEGER, 0),
          renewal: integer(object(fund.votes).renewal, 0, Number.MAX_SAFE_INTEGER, 0),
        },
      },
      me: {
        googleProtected: context?.googleProtected === true,
        tributeCount,
        payers,
        receivedNet,
        offered,
        offerable: Math.max(0, receivedNet - offered),
        eligible: tributeCount >= LIMITS.honorEligibleTributes && payers >= LIMITS.honorEligiblePayers,
        honor: { ...honor, recommendations: recommendationRows },
      },
      tiers: HONOR_TIERS.map((tier) => ({ ...tier })),
    };
  }

  async function offerAction(uid, data, context) {
    if (context?.googleProtected !== true) {
      fail("failed-precondition", "上納は、Googleでアカウントを保護してから使えます。");
    }
    const amount = requireAmount(data?.amount);
    if (amount < MINIMUM_OFFER) fail("invalid-argument", `上納は${MINIMUM_OFFER} Payからです。`);
    const clientRequestId = requireClientRequestId(data?.clientRequestId);
    await ensureWallet(uid);
    let result = null;
    let balance = null;
    await firestore.runTransaction(async (transaction) => {
      result = null;
      balance = null;
      const now = currentTime();
      const monthKey = jstMonthKey(now);
      const [profileSnapshot, walletSnapshot, ledgerConfigSnapshot, monthSnapshot, fundSnapshot, honorSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(walletRef(uid)),
        transaction.get(anjuPayLedgerConfigRef()),
        transaction.get(managerMonthRef(monthKey, uid)),
        transaction.get(fundRef(monthKey)),
        transaction.get(honorRef(monthKey, uid)),
      ]);
      const profile = readProfile(profileSnapshot);
      requireAge(profile);
      const honorValue = object(honorSnapshot.data());
      const opKey = `offer:${clientRequestId}`;
      if (Array.isArray(honorValue.recentOps) && honorValue.recentOps.includes(opKey)) {
        result = { ok: true, replayed: true, honor: honorSummary(honorValue) };
        return;
      }
      const month = object(monthSnapshot.data());
      const tributeCount = integer(month.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0);
      const payers = integer(month.payers, 0, Number.MAX_SAFE_INTEGER, 0);
      if (tributeCount < LIMITS.honorEligibleTributes || payers < LIMITS.honorEligiblePayers) {
        fail("failed-precondition", "上納できるのは、今月3人以上から5回以上の献上を受けた管理人だけです。");
      }
      const offerable = integer(month.receivedNet, 0, Number.MAX_SAFE_INTEGER, 0) - integer(month.offered, 0, Number.MAX_SAFE_INTEGER, 0);
      if (amount > offerable) fail("failed-precondition", `今月上納できるのは、あと ${Math.max(0, offerable)} Pay までです。`);
      const wallet = walletData(walletSnapshot);
      if (wallet.balance < amount) fail("failed-precondition", "AnjuPay残高が足りません。");
      stageAnjuPayOpening(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, now);
      const before = wallet.balance;
      debitPoints(wallet, amount);
      const split = offerSplit(amount);
      const groupId = anjuPayEntryId(`tribute-offer:${uid}:${monthKey}:${clientRequestId}`);
      appendAnjuPayEntry(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, {
        entryId: groupId,
        groupId,
        kind: "tribute_offering",
        category: "tribute",
        labelKey: "anju_pay_tribute_offering",
        status: "settled",
        delta: -amount,
        nominalAmount: amount,
        balanceBefore: before,
        balanceAfter: wallet.balance,
        components: [
          { kind: "offering_burn", labelKey: "anju_pay_tribute_offering_burn", status: "settled", delta: -split.burned, nominalAmount: split.burned },
          { kind: "offering_fund", labelKey: "anju_pay_tribute_offering_fund", status: "settled", delta: -split.fund, nominalAmount: split.fund },
        ],
        details: { mode: "tribute", role: "manager", periodKey: monthKey },
        occurredAt: now,
      });
      transaction.set(walletRef(uid), { ...wallet, ...anjuPayWalletMetadataPatch(wallet), updatedAt: now }, { merge: true });
      const fund = object(fundSnapshot.data());
      transaction.set(fundRef(monthKey), {
        monthKey,
        balance: integer(fund.balance, 0, Number.MAX_SAFE_INTEGER, 0) + split.fund,
        contributed: integer(fund.contributed, 0, Number.MAX_SAFE_INTEGER, 0) + split.fund,
        burned: integer(fund.burned, 0, Number.MAX_SAFE_INTEGER, 0) + split.burned,
        offerCount: integer(fund.offerCount, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
        updatedAt: now,
      }, { merge: true });
      transaction.set(managerMonthRef(monthKey, uid), {
        offered: integer(month.offered, 0, Number.MAX_SAFE_INTEGER, 0) + amount,
        updatedAt: now,
      }, { merge: true });
      const offered = integer(honorValue.offered, 0, Number.MAX_SAFE_INTEGER, 0) + amount;
      const tier = honorTierFor(offered);
      const recentOps = Array.isArray(honorValue.recentOps) ? honorValue.recentOps.slice(-(RECENT_OPS_LIMIT - 1)) : [];
      const nextHonor = {
        schemaVersion: TRIBUTE_SCHEMA_VERSION,
        monthKey,
        uid,
        offered,
        tierId: tier?.id || "",
        recommendations: Array.isArray(honorValue.recommendations) ? honorValue.recommendations : [],
        vote: POLICIES.includes(honorValue.vote) ? honorValue.vote : "",
        recentOps: [...recentOps, opKey],
        updatedAt: now,
      };
      transaction.set(honorRef(monthKey, uid), nextHonor, { merge: true });
      transaction.set(profileRef(uid), {
        honorMonthKey: monthKey,
        honorTierId: tier?.id || "",
        updatedAt: now,
      }, { merge: true });
      balance = wallet.balance;
      result = { ok: true, offered: amount, split, honor: honorSummary(nextHonor), walletBalance: wallet.balance };
    });
    if (balance !== null) await mirrorTouched([{ uid, balance }]);
    return result;
  }

  async function voteAction(uid, data) {
    const policy = String(data?.policy || "");
    if (!POLICIES.includes(policy)) fail("invalid-argument", "方針を選んでください。");
    let result = null;
    await firestore.runTransaction(async (transaction) => {
      const now = currentTime();
      const monthKey = jstMonthKey(now);
      const [profileSnapshot, honorSnapshot, fundSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(honorRef(monthKey, uid)),
        transaction.get(fundRef(monthKey)),
      ]);
      requireAge(readProfile(profileSnapshot));
      const honor = object(honorSnapshot.data());
      if (!honorTierFor(honor.offered)) fail("failed-precondition", "方針への投票は、今月の称号を持つ管理人だけができます。");
      const previous = POLICIES.includes(honor.vote) ? honor.vote : "";
      const fund = object(fundSnapshot.data());
      const votes = { both: 0, first: 0, renewal: 0, ...object(fund.votes) };
      if (previous) votes[previous] = Math.max(0, integer(votes[previous], 0, 1_000_000, 0) - 1);
      votes[policy] = integer(votes[policy], 0, 1_000_000, 0) + 1;
      transaction.set(fundRef(monthKey), { monthKey, votes, updatedAt: now }, { merge: true });
      transaction.set(honorRef(monthKey, uid), { vote: policy, updatedAt: now }, { merge: true });
      result = { ok: true, policy: fundPolicy({ votes }), vote: policy };
    });
    return result;
  }

  async function recommendAction(uid, data, add) {
    const publicManagerId = requirePublicManagerId(data?.publicManagerId);
    const { uid: targetUid } = await findManagerByPublicId(publicManagerId);
    if (targetUid === uid) fail("failed-precondition", "自分は推薦できません。");
    let result = null;
    await firestore.runTransaction(async (transaction) => {
      const now = currentTime();
      const monthKey = jstMonthKey(now);
      const [profileSnapshot, honorSnapshot, targetSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(honorRef(monthKey, uid)),
        transaction.get(profileRef(targetUid)),
      ]);
      requireAge(readProfile(profileSnapshot));
      if (add && playerSafety) await playerSafety.assertAllowed(uid, targetUid, transaction);
      const honor = object(honorSnapshot.data());
      const tier = honorTierFor(honor.offered);
      if (!tier) fail("failed-precondition", "推薦は、今月の称号を持つ管理人だけができます。");
      const list = Array.isArray(honor.recommendations)
        ? honor.recommendations.filter((id) => PUBLIC_MANAGER_ID_PATTERN.test(String(id)))
        : [];
      const target = readProfile(targetSnapshot);
      const targetCount = target.recommendedMonthKey === monthKey ? target.recommendedCount : 0;
      if (add) {
        if (list.includes(publicManagerId)) {
          result = { ok: true, recommendations: list };
          return;
        }
        if (!target.card) fail("failed-precondition", "この管理人は推薦できません。");
        if (list.length >= tier.recommendationSlots) fail("failed-precondition", `今月の推薦は${tier.recommendationSlots}件までです。`);
        const next = [...list, publicManagerId];
        transaction.set(honorRef(monthKey, uid), { recommendations: next, updatedAt: now }, { merge: true });
        transaction.set(profileRef(targetUid), { recommendedMonthKey: monthKey, recommendedCount: targetCount + 1, updatedAt: now }, { merge: true });
        result = { ok: true, recommendations: next };
        return;
      }
      if (!list.includes(publicManagerId)) {
        result = { ok: true, recommendations: list };
        return;
      }
      const next = list.filter((id) => id !== publicManagerId);
      transaction.set(honorRef(monthKey, uid), { recommendations: next, updatedAt: now }, { merge: true });
      transaction.set(profileRef(targetUid), { recommendedMonthKey: monthKey, recommendedCount: Math.max(0, targetCount - 1), updatedAt: now }, { merge: true });
      result = { ok: true, recommendations: next };
    });
    return result;
  }

  async function performAction(uidValue, dataValue, context = {}) {
    const uid = String(uidValue || "");
    if (!uid) fail("unauthenticated", "ログインが必要です。");
    const data = object(dataValue);
    const action = String(data.action || "");
    if (!TRIBUTE_ACTIONS.includes(action)) fail("invalid-argument", "操作を確認できません。");
    switch (action) {
      case "state": return stateAction(uid);
      case "age_confirm": return ageConfirmAction(uid, data);
      case "save_profile": return saveProfileAction(uid, data);
      case "board": return boardAction(uid, data);
      case "manager": return managerAction(uid, data);
      case "apply": return applyAction(uid, data);
      case "receipts": return receiptsAction(uid, data);
      case "share_info": return shareInfoAction(uid, data);
      case "set_word": return setWordAction(uid, data);
      case "ledger": return ledgerAction(uid);
      case "rankings": return rankingsAction(uid, data);
      case "fund": return fundAction(uid, data, context);
      case "offer": return offerAction(uid, data, context);
      case "vote": return voteAction(uid, data);
      case "recommend": return recommendAction(uid, data, true);
      case "unrecommend": return recommendAction(uid, data, false);
      default: return runNamedContractAction(uid, action, data);
    }
  }

  // 15分ごとの後始末。期限切れの申し込みと契約を終え、管理口座を返す。
  async function expireContracts({ limit = 100 } = {}) {
    const now = currentTime();
    const [pending, active] = await Promise.all(OPEN_STATUSES.map((status) => firestore.collection("tributeContracts")
      .where("status", "==", status)
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt", "asc")
      .limit(limit)
      .get()));
    let ended = 0;
    for (const document of [...pending.docs, ...active.docs]) {
      try {
        const result = await endBySystem(document.id);
        if (result.ended) ended += 1;
      } catch (error) {
        console.error("tribute expiry failed", document.id, error);
      }
    }
    return { ended };
  }

  // ブロックが確定したら、その2人の申込中・進行中の契約を終える。
  async function endContractsBetween(firstUid, secondUid) {
    const pairs = await Promise.all([
      pairRef(firstUid, secondUid).get(),
      pairRef(secondUid, firstUid).get(),
    ]);
    let ended = 0;
    for (const snapshot of pairs) {
      const contractId = String(snapshot.exists ? snapshot.get("openContractId") || "" : "");
      if (!CONTRACT_ID_PATTERN.test(contractId)) continue;
      const result = await endBySystem(contractId, "blocked");
      if (result.ended) ended += 1;
    }
    return { ended };
  }

  // 安心設定（ブロック）の相手を、契約か管理人カードから特定する。
  async function resolveSafetyTarget(uid, data) {
    if (data?.contractId) {
      const contractId = requireContractId(data.contractId);
      const snapshot = await contractRef(contractId).get();
      const contract = object(snapshot.data());
      if (!snapshot.exists || ![contract.managerUid, contract.payerUid].includes(uid)) return null;
      const targetUid = contract.managerUid === uid ? contract.payerUid : contract.managerUid;
      const name = contract.managerUid === uid
        ? normalizeWalletName(contract.payerWalletName)
        : cardSnapshot(contract.managerCard).personaName;
      return { uid: targetUid, name, source: "tribute" };
    }
    if (data?.publicManagerId) {
      const publicManagerId = requirePublicManagerId(data.publicManagerId);
      const snapshot = await firestore.collection("tributeProfiles")
        .where("publicManagerId", "==", publicManagerId)
        .limit(1)
        .get();
      const document = snapshot.docs[0];
      if (!document) return null;
      return { uid: document.id, name: cardSnapshot(readProfile(document).card).personaName, source: "tribute" };
    }
    return null;
  }

  return Object.freeze({
    performAction,
    expireContracts,
    endContractsBetween,
    resolveSafetyTarget,
    ensureAchievementStats,
    achievementStatsRef,
  });
}

module.exports = {
  TRIBUTE_ACTIONS,
  createTributeService,
  viewContract,
  fundPolicy,
};
