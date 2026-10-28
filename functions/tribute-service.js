"use strict";

// お貢ぎ牧場のサーバー処理。すべての移動はトランザクションで、預ける側の上限・残高・ブロックを確かめてから行う。
// 上限・期間・言葉の設定・解約は預ける側だけが触れる。管理する側の操作は、その範囲の中でだけ動く。

const crypto = require("node:crypto");
const {
  TRIBUTE_SCHEMA_VERSION,
  TRIBUTE_AGE_VERSION,
  REPORT_REASONS,
  SEVERE_REPORT_REASONS,
  LIMITS,
  WORK_ORDER_TARGETS,
  RECITE_TARGETS,
  DURATION_DAYS_OPTIONS,
  FORBIDDEN_MESSAGES,
  cleanLine,
  forbiddenReason,
  contractTextReason,
  containsNgWord,
  normalizeCaps,
  capsAreLowerOrEqual,
  normalizeManagerCard,
  normalizeTodayWord,
  normalizeCheer,
  normalizeSeals,
  normalizeStyles,
  sealFor,
  storedSeal,
  normalizeOwnWords,
  normalizeWordOffering,
  reciteKey,
  boardSexualWord,
  SEAL_IDS,
  DECORATION_PRODUCT_IDS,
  normalizeDecorations,
  normalizeCardAchievements,
  requiredDecorationProducts,
  requiredVaultTier,
  X_HANDLE_PATTERN,
  normalizeAvatar,
  normalizeWalletName,
  normalizeNickname,
  normalizeApplication,
  normalizeWantWords,
  normalizePurpose,
  visiblePurpose,
  normalizeReward,
  storedRewardText,
  MAX_DURATION_DAYS,
  PURPOSE_IDS,
  SEXUAL_PURPOSE_IDS,
  RECEIVABLE_KINDS,
  normalizeMessage,
  tributeFee,
  honorAchievementIds,
  vaultTierFor,
  vaultTierInfo,
  vaultQualification,
  jstDateKey,
  jstMonthKey,
  nextJstDateKey,
  effectiveCaps,
  todayUsed,
  tributeAllowance,
  capViolation,
  capsNeedGoogle,
  pairId,
  OTHELLO_RATES,
  OTHELLO_HANDICAPS,
  othelloSide,
  othelloInitialBoard,
  othelloBoardValid,
  othelloPlay,
  othelloCount,
  othelloNextTurn,
  othelloOutcome,
  normalizeOthelloStart,
} = require("./tribute-rules");
const {
  ACHIEVEMENT_BY_ID,
  eligibleAchievementIds,
  normalizeAchievementProfile,
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
  "set_screenshots",
  "set_nickname",
  "set_want_words",
  "set_holds",
  "hold",
  "unhold",
  "plea",
  "plea_withdraw",
  "plea_grant",
  "plea_deny",
  "resist",
  "set_own_words",
  "offer_words",
  "recite_order",
  "recite",
  "recite_withdraw",
  "recite_confirm",
  "extend_request",
  "extend_withdraw",
  "extend_accept",
  "extend_decline",
  "set_othello",
  "othello_start",
  "othello_move",
  "othello_resign",
  "othello_end",
  "othello_claim",
  "set_work_orders",
  "work_order",
  "work_withdraw",
  "work_report",
  "work_confirm",
  "work_progress",
  "receive",
  "share_info",
  "set_word",
  "decorations",
  "set_declaration",
  "mark_read",
  "report_user",
  "receipts",
  "ledger",
  "rankings",
  "set_cheer",
  "cheer_seen",
  "cheer_hide",
  "cheer_show",
  "vault",
  "vault_deposit",
  "vault_withdraw",
  "claim_refund",
]);
// 終わった牧場基金の操作。古い画面から届いた時は、読み込み直すよう伝える。
const RETIRED_FUND_ACTIONS = Object.freeze(["fund", "offer", "vote", "recommend", "unrecommend"]);
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
    refundPending: integer(data.refundPending, 0, Number.MAX_SAFE_INTEGER, 0),
    // 運営からの返金（2026-10-26: 請求の二重払いの不具合で、同じ請求に重ねて払われた分）。
    // 運営のスクリプト（grant-tribute-double-payment-refunds.cjs）が積み、本人が「財布へ受け取る」で受け取る。
    operatorRefundPending: integer(data.operatorRefundPending, 0, Number.MAX_SAFE_INTEGER, 0),
    operatorRefundClaimCount: integer(data.operatorRefundClaimCount, 0, Number.MAX_SAFE_INTEGER, 0),
    refundClaimCount: integer(data.refundClaimCount, 0, Number.MAX_SAFE_INTEGER, 0),
    collarCount: integer(data.collarCount, 0, Number.MAX_SAFE_INTEGER, 0),
    word: {
      text: cleanLine(object(data.word).text, LIMITS.todayWord),
      at: integer(object(data.word).at, 0, Number.MAX_SAFE_INTEGER, 0),
      dayKey: String(object(data.word).dayKey || ""),
      dayCount: integer(object(data.word).dayCount, 0, 1_000, 0),
    },
    receiveDayKey: String(data.receiveDayKey || ""),
    receiveDayTotal: integer(data.receiveDayTotal, 0, Number.MAX_SAFE_INTEGER, 0),
    highRequestAt: integer(data.highRequestAt, 0, Number.MAX_SAFE_INTEGER, 0),
    // 管理人の金庫（額は本人にしか返さない）。段階はいまの額で決まり、飾りはいちばん高く届いた段階で使える。
    vaultAmount: integer(data.vaultAmount, 0, Number.MAX_SAFE_INTEGER, 0),
    vaultTier: integer(data.vaultTier, 0, 5, 0),
    vaultTierAt: integer(data.vaultTierAt, 0, Number.MAX_SAFE_INTEGER, 0),
    vaultBestTier: integer(data.vaultBestTier, 0, 5, 0),
    vaultQualifiedAt: integer(data.vaultQualifiedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    vaultRecentOps: Array.isArray(data.vaultRecentOps) ? data.vaultRecentOps.map(String).slice(-LIMITS.vaultRecentOps) : [],
    honorRecordsChecked: data.honorRecordsChecked === true,
    // 管理人が財布（payerUid）ごとに付けた呼び名。管理人にだけ返す。空は外した呼び名。
    payerNicknames: Object.fromEntries(Object.entries(object(data.payerNicknames))
      .map(([payerUid, name]) => [payerUid, normalizeNickname(name)])
      .filter(([payerUid, name]) => payerUid && name)),
    severeReportMonthKey: String(data.severeReportMonthKey || ""),
    severeReportCount: integer(data.severeReportCount, 0, 1_000_000, 0),
    // 応援欄の「見たよ」を押していない応援の数（その月の分だけ）。管理人のやることに出す。
    cheerInbox: {
      monthKey: String(object(data.cheerInbox).monthKey || ""),
      unseen: integer(object(data.cheerInbox).unseen, 0, 1_000_000, 0),
    },
    // 管理人の自分の言葉（定型文・ご褒美）。管理人にだけ返し、カードには入れない（掲示板に出ない）。
    ownWords: normalizeOwnWords(object(data.ownWords)).ownWords || { lines: [], rewards: [] },
  };
}

function profileIsHidden(profile, monthKey) {
  return profile.severeReportMonthKey === monthKey && profile.severeReportCount >= LIMITS.severeReportHide;
}

// 金庫の段階（外に見せるのは段階だけ。額は本人にしか返さない）。
function vaultBadge(profile) {
  const tier = profile.vaultQualifiedAt > 0 ? vaultTierInfo(profile.vaultTier) : null;
  return tier ? { level: tier.level, id: tier.id, label: tier.label } : null;
}

// 今日のひとことは24時間だけ出す。期限の切れた言葉は返さない。
function activeWord(profile, now) {
  const word = profile.word || {};
  return word.text && word.at > 0 && now - word.at < LIMITS.todayWordTtlMs ? { text: word.text, at: word.at } : null;
}

// 牧場のカードに出す実績。いまの実績一覧にあるものだけを返す。
function cardAchievements(value) {
  return normalizeCardAchievements(value).filter((id) => ACHIEVEMENT_BY_ID.has(id));
}

// 牧場の画面で扱う実績（牧場の実績と、終わった牧場基金の限定称号）。
function isRanchAchievement(id) {
  const definition = ACHIEVEMENT_BY_ID.get(id);
  return definition?.scope === "tribute" || definition?.family === "tribute_honor";
}

// 受取印は、押した時の形と朱肉で残す。記録のない古い印は日付印・朱になる。
function sealLook(value) {
  const { sealShape, sealInk } = normalizeDecorations(value);
  return { sealShape, sealInk };
}

function publicCard(profile, monthKey, now) {
  const card = object(profile.card);
  return {
    publicManagerId: profile.publicManagerId,
    personaName: cleanLine(card.personaName, LIMITS.personaName),
    intro: cleanLine(card.intro, LIMITS.intro),
    disclosure: String(card.disclosure || "undisclosed"),
    styles: normalizeStyles(card.styles),
    entryFee: integer(card.entryFee, 0, 1_000, 0),
    sigil: integer(card.sigil, 0, 5, 0),
    avatar: normalizeAvatar(card.avatar),
    seals: normalizeSeals(card.seals),
    ...normalizeDecorations(card),
    achievements: cardAchievements(card.achievements),
    reportConsent: card.reportConsent === true,
    // 管理人の宣言「未払いは既読無視」「スクショを載せる」と、直近30日に3,000 Pay以上を請求した「高額請求」の札。
    ignoreUnpaid: card.ignoreUnpaid === true,
    postsScreenshots: card.postsScreenshots === true,
    highRequest: profile.highRequestAt > 0 && now - profile.highRequestAt < LIMITS.highRequestWindowMs,
    word: activeWord(profile, now),
    xHandle: X_HANDLE_PATTERN.test(String(card.xHandle || "")) ? card.xHandle : "",
    accepting: profile.accepting,
    vault: vaultBadge(profile),
    activeContracts: profile.counts.managerActive,
    // 最後に動いた時は、管理人が出すと選んだカードだけ相手に渡す。出さないカードも、掲示板は動いた順に並ぶ。
    showsActivity: card.showsActivity === true,
    lastActiveAt: card.showsActivity === true ? profile.lastActiveAt : 0,
  };
}

// 自分のプロフィール（state・save_profile・set_word で同じ形を返す）。
function ownProfileView(profile, monthKey, now) {
  return {
    walletName: profile.walletName,
    // 自分のカードには、出さない設定でも自分の最後に動いた時を入れる（カードの見え方と掲示板に出ていられる期限）。
    // 番付のひとことも自分にだけ返す（ほかの人には、貢がれ総額の番付で10位以内の時だけ番付に出る）。
    card: profile.card ? { ...publicCard(profile, monthKey, now), lastActiveAt: profile.lastActiveAt, rankingWord: cleanLine(profile.card.rankingWord, LIMITS.rankingWord) } : null,
    accepting: profile.accepting,
    publicManagerId: profile.publicManagerId,
    hidden: profileIsHidden(profile, monthKey),
    // 自分の金庫（額は本人にだけ）。いちばん高く届いた段階までの金庫の飾りを使える。
    vault: {
      qualified: profile.vaultQualifiedAt > 0,
      amount: profile.vaultAmount,
      tier: profile.vaultTier,
      bestTier: profile.vaultBestTier,
    },
    counts: profile.counts,
    cheersUnseen: profile.cheerInbox.monthKey === monthKey ? profile.cheerInbox.unseen : 0,
    ownWords: profile.ownWords,
    receiptCount: profile.receiptCount,
    refundPending: profile.refundPending,
    operatorRefundPending: profile.operatorRefundPending,
    wordsToday: profile.word?.dayKey === jstDateKey(now) ? profile.word.dayCount : 0,
    // 掲示板に出ていられる期限（受付中でカードがある時だけ）。過ぎると、動くまで掲示板に並ばない。
    boardUntil: profile.accepting && profile.card ? profile.lastActiveAt + LIMITS.boardActiveWindowMs : 0,
  };
}

function cardSnapshot(card) {
  const source = object(card);
  return {
    personaName: cleanLine(source.personaName, LIMITS.personaName) || "管理人",
    disclosure: String(source.disclosure || "undisclosed"),
    styles: normalizeStyles(source.styles),
    sigil: integer(source.sigil, 0, 5, 0),
    avatar: normalizeAvatar(source.avatar),
  };
}

// 財布の言われたい言葉。管理人にも見せる（言葉選びの手がかり）。
function wantWordList(contract) {
  return Array.isArray(contract.wantWords)
    ? contract.wantWords.map((word) => cleanLine(word, LIMITS.wantWordLength)).filter(Boolean).slice(0, LIMITS.wantWordCount)
    : [];
}

function pendingRequestList(contract) {
  return Object.entries(object(contract.pendingRequests))
    .map(([requestId, entry]) => ({
      requestId,
      amount: integer(entry?.amount, 0, 1_000_000, 0),
      note: cleanLine(entry?.note, LIMITS.requestNote),
      purpose: visiblePurpose(entry?.purpose, { allowSexual: contract.allowSexualPurposes === true }),
      // 財布が渋った回数（抵抗）。請求は断れないまま残る。
      resists: integer(entry?.resists, 0, LIMITS.resistsPerRequest, 0),
      createdAt: integer(entry?.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    }))
    .filter((entry) => REQUEST_ID_PATTERN.test(entry.requestId) && entry.amount > 0)
    .sort((left, right) => left.createdAt - right.createdAt);
}

// 出稼ぎ命令。果たした後も、管理人が確認するか次の命令を出すまで残す（done で見分ける）。
function workOrderView(contract) {
  const order = contract.workOrder && typeof contract.workOrder === "object" ? contract.workOrder : null;
  const target = integer(order?.target, 0, 1_000, 0);
  const orderSeq = integer(order?.orderSeq, 0, Number.MAX_SAFE_INTEGER, 0);
  if (!order || !WORK_ORDER_TARGETS.includes(target) || orderSeq < 1) return null;
  const doneAt = integer(order.doneAt, 0, Number.MAX_SAFE_INTEGER, 0);
  return {
    orderSeq,
    target,
    note: cleanLine(order.note, LIMITS.requestNote),
    issuedAt: integer(order.issuedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    reportedCount: integer(order.reportedCount, 0, target, 0),
    reportedAt: integer(order.reportedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    done: doneAt > 0,
    doneAt,
  };
}

// まだ果たしていない命令（報告を待っている命令）。
function openWorkOrder(contract) {
  const order = workOrderView(contract);
  return order && !order.done ? order : null;
}

// 復唱。管理人が言わせたい一言と回数。果たした後も、管理人が確認するか次の復唱を命じるまで残す（done で見分ける）。
function reciteOrderView(contract) {
  const order = contract.reciteOrder && typeof contract.reciteOrder === "object" ? contract.reciteOrder : null;
  const target = integer(order?.target, 0, 1_000, 0);
  const orderSeq = integer(order?.orderSeq, 0, Number.MAX_SAFE_INTEGER, 0);
  const text = cleanLine(order?.text, LIMITS.requestNote);
  if (!order || !RECITE_TARGETS.includes(target) || orderSeq < 1 || !text) return null;
  const doneAt = integer(order.doneAt, 0, Number.MAX_SAFE_INTEGER, 0);
  return { orderSeq, text, target, count: integer(order.count, 0, target, 0), issuedAt: integer(order.issuedAt, 0, Number.MAX_SAFE_INTEGER, 0), done: doneAt > 0, doneAt };
}

function openReciteOrder(contract) {
  const order = reciteOrderView(contract);
  return order && !order.done ? order : null;
}

// 貢ぎオセロ（設計書15.2）。進行中の対局・決着した罰金（未払い）・組の戦績。
function othelloView(contract) {
  const game = contract.othello && typeof contract.othello === "object" ? contract.othello : null;
  if (!game || !othelloBoardValid(game.board) || !["manager", "payer"].includes(game.turn)) return null;
  const last = game.lastMove && typeof game.lastMove === "object" ? game.lastMove : null;
  return {
    gameSeq: integer(game.gameSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    board: game.board,
    turn: game.turn,
    rate: OTHELLO_RATES.includes(Number(game.rate)) ? Number(game.rate) : OTHELLO_RATES[0],
    handicap: OTHELLO_HANDICAPS.includes(game.handicap) ? game.handicap : "none",
    startedAt: integer(game.startedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    lastMoveAt: integer(game.lastMoveAt, 0, Number.MAX_SAFE_INTEGER, 0),
    lastMove: last ? { index: integer(last.index, 0, 63, 0), flipped: integer(last.flipped, 0, 64, 0), role: last.role === "manager" ? "manager" : "payer" } : null,
    counts: othelloCount(game.board),
  };
}

function othelloResultView(contract) {
  const result = contract.othelloResult && typeof contract.othelloResult === "object" ? contract.othelloResult : null;
  const penalty = integer(result?.penalty, 0, 1_000_000, 0);
  if (!result || penalty <= 0) return null;
  return {
    gameSeq: integer(result.gameSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    penalty,
    stones: integer(result.stones, 0, 64, 0),
    rate: integer(result.rate, 0, 1_000, 0),
    resigned: result.resigned === true,
    finishedAt: integer(result.finishedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function othelloRecordView(value) {
  const record = value && typeof value === "object" ? value : {};
  const count = (key) => integer(record[key], 0, Number.MAX_SAFE_INTEGER, 0);
  return { played: count("played"), lost: count("lost"), won: count("won"), drawn: count("drawn"), streak: count("streak") };
}

// 延長の申し込み（財布が日数を選び、管理人が受けると、いまの期限から延びる）。
function extensionView(contract) {
  const extension = contract.extension && typeof contract.extension === "object" ? contract.extension : null;
  const days = integer(extension?.days, 0, 1_000, 0);
  if (!extension || !DURATION_DAYS_OPTIONS.includes(days)) return null;
  return { days, createdAt: integer(extension.createdAt, 0, Number.MAX_SAFE_INTEGER, 0) };
}

// お預け。管理人が「解く」まで続き、その間は財布から勝手に差し出せない（期限はない）。
function holdView(contract) {
  const hold = contract.hold && typeof contract.hold === "object" ? contract.hold : null;
  const since = integer(hold?.since, 0, Number.MAX_SAFE_INTEGER, 0);
  if (!hold || since < 1) return null;
  return { since, note: cleanLine(hold.note, LIMITS.requestNote) };
}

// 願い出（お預けの間に、財布が「貢がせてください」と願い出たもの）。許されると、その金額を1回だけ差し出せる。
function pleaView(contract) {
  const plea = contract.plea && typeof contract.plea === "object" ? contract.plea : null;
  const pleaSeq = integer(plea?.pleaSeq, 0, Number.MAX_SAFE_INTEGER, 0);
  const amount = integer(plea?.amount, 0, 1_000_000, 0);
  if (!plea || pleaSeq < 1 || amount < 1) return null;
  const grantedAt = integer(plea.grantedAt, 0, Number.MAX_SAFE_INTEGER, 0);
  return {
    pleaSeq,
    amount,
    purpose: visiblePurpose(plea.purpose, { allowSexual: contract.allowSexualPurposes === true }),
    note: cleanLine(plea.note, LIMITS.requestNote),
    createdAt: integer(plea.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    granted: grantedAt > 0,
    grantedAt,
  };
}

// 命令の後の完走数。命令した時の完走数（private/work）と、いまの完走数の差を、回数で頭打ちにする。
function workCount(order, work, matches) {
  if (!order || integer(work?.orderSeq, 0, Number.MAX_SAFE_INTEGER, 0) !== order.orderSeq) return null;
  const baseline = integer(work.baselineMatches, 0, Number.MAX_SAFE_INTEGER, 0);
  return Math.min(order.target, Math.max(0, integer(matches, 0, Number.MAX_SAFE_INTEGER, 0) - baseline));
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

// 限度額（caps）は財布だけに返す。管理人には、限度額も、そこから分かる残り枠も返さない。
function viewContract(contract, uid, now) {
  const role = contract.managerUid === uid ? "manager" : "payer";
  const status = String(contract.status || "ended");
  const caps = role === "payer" ? effectiveCaps(contract, now).caps : null;
  const pending = normalizeCaps(contract.pendingCaps);
  const pendingKey = String(contract.pendingCapsEffectiveDateKey || "");
  const pendingStillScheduled = role === "payer" && Boolean(pending && pendingKey && jstDateKey(now) < pendingKey);
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
    durationDays: integer(contract.durationDays, 1, MAX_DURATION_DAYS, 1),
    tone: String(contract.tone || "normal"),
    ngWords: Array.isArray(contract.ngWords) ? contract.ngWords.slice(0, LIMITS.ngWordCount) : [],
    wantWords: wantWordList(contract),
    // 終わった契約から「同じ条件で申し込む」ために、管理人の公開IDを持つ（この設定より前の契約は空）。
    managerPublicId: PUBLIC_MANAGER_ID_PATTERN.test(String(contract.managerPublicId || "")) ? contract.managerPublicId : "",
    allowReportRequests: contract.allowReportRequests === true,
    rankOptIn: contract.rankOptIn === true,
    allowSexualPurposes: contract.allowSexualPurposes === true,
    allowScreenshots: contract.allowScreenshots === true,
    allowWorkOrders: contract.allowWorkOrders === true,
    allowHolds: contract.allowHolds === true,
    allowOthello: contract.allowOthello === true,
    othello: status === "active" ? othelloView(contract) : null,
    othelloResult: status === "active" ? othelloResultView(contract) : null,
    othelloRecord: othelloRecordView(contract.othelloRecord),
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
    // 既読無視: 管理人が、まだ返していない財布のメッセージを読んだ時刻（返すと 0）。
    ignoredSince: integer(contract.ignoredSince, 0, Number.MAX_SAFE_INTEGER, 0),
    managerIgnoreUnpaid: contract.managerIgnoreUnpaid === true,
    pendingRequests: pendingRequestList(contract),
    reportRequested: Number(contract.reportRequestedAt || 0) > 0,
    workOrder: status === "active" ? workOrderView(contract) : null,
    workOrdersDone: integer(contract.workOrdersDone, 0, Number.MAX_SAFE_INTEGER, 0),
    hold: status === "active" ? holdView(contract) : null,
    plea: status === "active" ? pleaView(contract) : null,
    pleaCount: integer(contract.pleaCount, 0, Number.MAX_SAFE_INTEGER, 0),
    pleaGrantedCount: integer(contract.pleaGrantedCount, 0, Number.MAX_SAFE_INTEGER, 0),
    resistedTributes: integer(contract.resistedTributes, 0, Number.MAX_SAFE_INTEGER, 0),
    reciteOrder: status === "active" ? reciteOrderView(contract) : null,
    recitesDone: integer(contract.recitesDone, 0, Number.MAX_SAFE_INTEGER, 0),
    wordOfferings: integer(contract.wordOfferings, 0, Number.MAX_SAFE_INTEGER, 0),
    wordOffersToday: contract.wordOfferDayKey === jstDateKey(now) ? integer(contract.wordOfferDayCount, 0, 1_000, 0) : 0,
    extension: status === "active" ? extensionView(contract) : null,
    eventSeq,
    unread: Math.max(0, eventSeq - readSeq),
    peerReadSeq: Math.min(eventSeq, peerReadSeq),
  };
}

// 限度額は契約の記録ではなく、財布だけが読める tributeContracts/{id}/private/limits に置く。
const LIMIT_FIELDS = Object.freeze(["caps", "pendingCaps", "pendingCapsEffectiveDateKey"]);

function limitsOf(source) {
  return {
    caps: normalizeCaps(source?.caps),
    pendingCaps: normalizeCaps(source?.pendingCaps),
    pendingCapsEffectiveDateKey: String(source?.pendingCapsEffectiveDateKey || ""),
  };
}

// 移す前の古い契約は、契約の記録に残っている限度額を使う。
function withLimits(contract, limitsSnapshot) {
  const source = limitsSnapshot?.exists ? object(limitsSnapshot.data()) : contract;
  return { ...contract, ...limitsOf(source) };
}

function hasLegacyLimits(contract) {
  return Boolean(contract?.caps || contract?.pendingCaps || contract?.pendingCapsEffectiveDateKey);
}

// 既読無視の始まり。管理人が、まだ返していない財布のメッセージまで読んだ時刻を残す。
function ignoreStart(contract, role, nextReadSeq, now) {
  if (role !== "manager" || integer(contract.ignoredSince, 0, Number.MAX_SAFE_INTEGER, 0) > 0) return {};
  const payerSeq = integer(contract.lastPayerMessageSeq, 0, Number.MAX_SAFE_INTEGER, 0);
  const replySeq = integer(contract.lastManagerReplySeq, 0, Number.MAX_SAFE_INTEGER, 0);
  return payerSeq > replySeq && nextReadSeq >= payerSeq ? { ignoredSince: now } : {};
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
    // 出稼ぎ命令の数え方。マイスタジアムの観客と同じ正本（検証済みの正式完走数）を読む。
    economyProgressRef = null,
    totalVerifiedMatches = null,
  } = deps;
  const currentTime = typeof deps.now === "function" ? deps.now : Date.now;

  const fail = (code, message) => {
    throw new HttpsError(code, message);
  };

  const profileRef = (uid) => firestore.collection("tributeProfiles").doc(uid);
  const contractRef = (contractId) => firestore.collection("tributeContracts").doc(contractId);
  const limitsRef = (contractId) => contractRef(contractId).collection("private").doc("limits");
  // 出稼ぎ命令を出した時の完走数。管理人に財布の通算を見せないよう、財布だけが読める場所に置く。
  const workRef = (contractId) => contractRef(contractId).collection("private").doc("work");
  const eventRef = (contractId, seq) => contractRef(contractId).collection("events").doc(eventId(seq));
  const receiptRef = (uid, receiptId) => firestore.collection("tributeReceipts").doc(uid).collection("items").doc(receiptId);
  const pairRef = (managerUid, payerUid) => firestore.collection("tributePairs").doc(pairId(managerUid, payerUid));
  const managerMonthRef = (monthKey, managerUid) => firestore.collection("tributeManagerMonths").doc(`${monthKey}__${managerUid}`);
  const reportRef = (reportId) => firestore.collection("tributeReports").doc(reportId);
  const achievementStatsRef = (uid) => firestore.collection("tributeAchievementStats").doc(uid);
  const achievementProfileRef = (uid) => firestore.collection("achievementProfiles").doc(uid);
  const purchaseRef = (uid, productId) => firestore.collection("economyPurchases").doc(uid).collection("items").doc(productId);

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
      limitsSnapshot,
    ] = await Promise.all([
      transaction.get(profileRef(managerUid)),
      transaction.get(profileRef(payerUid)),
      transaction.get(walletRef(managerUid)),
      transaction.get(walletRef(payerUid)),
      transaction.get(anjuPayLedgerConfigRef()),
      transaction.get(pairRef(managerUid, payerUid)),
      transaction.get(limitsRef(contractId)),
    ]);
    const blocked = playerSafety ? await playerSafety.isBlocked(managerUid, payerUid, transaction) === true : false;
    return {
      transaction,
      now,
      dateKey: jstDateKey(now),
      monthKey: jstMonthKey(now),
      contractId,
      contractRef: contractReference,
      contract: withLimits(contract, limitsSnapshot),
      original: { ...contract },
      limits: { ref: limitsRef(contractId), exists: limitsSnapshot.exists, legacy: hasLegacyLimits(contract) },
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

  // 仕えた日数（設計書15.1）。献上か言葉の献上をした日本時間の日を、組ごとに1日1回まで数える。
  // 月は貢ぎ帳の monthKey と分けて持つ（言葉の献上だけの月に monthKey を進めると、貢がれ総額の財布の人数がずれるため）。
  function servedDayPatch(ctx) {
    const pair = ctx.pair.value;
    const sameMonth = pair.servedMonthKey === ctx.monthKey;
    const days = sameMonth ? integer(pair.servedDays, 0, 31, 0) : 0;
    const countedToday = sameMonth && pair.servedDayKey === ctx.dateKey;
    return { servedMonthKey: ctx.monthKey, servedDays: countedToday ? days : days + 1, servedDayKey: ctx.dateKey };
  }

  // 貢ぎオセロの決着（設計書15.2）。戦績は組と契約の両方に残し、財布が負けた時だけ罰金を残す（自動では引き落とさない）。
  function finishOthello(ctx, game, board, { resigned = false } = {}) {
    const outcome = othelloOutcome(board, game.rate, { resigned });
    const record = othelloRecordView(ctx.pair.value.othelloRecord || ctx.contract.othelloRecord);
    const next = {
      played: record.played + 1,
      lost: record.lost + (outcome.result === "lost" ? 1 : 0),
      won: record.won + (outcome.result === "won" ? 1 : 0),
      drawn: record.drawn + (outcome.result === "draw" ? 1 : 0),
      streak: outcome.result === "lost" ? record.streak + 1 : 0,
    };
    patchPair(ctx, { othelloRecord: next });
    setContract(ctx, {
      othello: null,
      othelloRecord: next,
      othelloResult: outcome.penalty > 0
        ? { gameSeq: game.gameSeq, penalty: outcome.penalty, stones: outcome.stones, rate: game.rate, resigned, finishedAt: ctx.now }
        : null,
    });
    pushEvent(ctx, {
      type: "othello_finish",
      actor: resigned ? "payer" : "system",
      gameSeq: game.gameSeq,
      result: outcome.result,
      manager: outcome.manager,
      payer: outcome.payer,
      stones: outcome.stones,
      rate: game.rate,
      penalty: outcome.penalty,
      resigned,
      board,
      record: next,
    });
  }

  // 一手に添える一言（60文字まで、会話と同じ確認）。添えた手は会話として数える（既読無視の判定）。
  function othelloNote(ctx, value) {
    const text = cleanLine(value, LIMITS.requestNote);
    if (!text) return "";
    const normalized = normalizeMessage(text);
    if (normalized.error) fail("invalid-argument", normalized.error);
    checkManagerText(ctx, normalized.text);
    return normalized.text;
  }

  // 願い出に答える（許す・退ける）。一言を添えられ、どちらも管理人の返事として既読無視を終える。
  function answerPlea(ctx, data, grant) {
    const plea = pleaView(ctx.contract);
    if (!plea || plea.granted) fail("failed-precondition", "答えられる願い出はありません。");
    const note = cleanLine(data?.note, LIMITS.requestNote);
    if (note) checkManagerText(ctx, note);
    messageRate(ctx);
    if (grant) {
      setContract(ctx, {
        plea: { ...object(ctx.contract.plea), grantedAt: ctx.now },
        pleaGrantedCount: integer(ctx.contract.pleaGrantedCount, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
      });
    } else {
      setContract(ctx, { plea: null });
    }
    pushEvent(ctx, { type: grant ? "plea_granted" : "plea_denied", actor: "manager", pleaSeq: plea.pleaSeq, amount: plea.amount, ...(note ? { note } : {}) });
    setContract(ctx, { lastManagerReplySeq: ctx.seq, ignoredSince: 0 });
    markManagerActive(ctx);
    return { ok: true, contract: view(ctx) };
  }

  // 受け取り・出稼ぎの確認に添えるご褒美。一覧は契約の強さ（上限）まで、言われたい言葉は言葉そのものを残す。
  function contractReward(ctx, data) {
    const normalized = normalizeReward(data?.reward, {
      tone: ctx.contract.tone,
      ngWords: ctx.contract.ngWords,
      wantWords: wantWordList(ctx.contract),
      ownRewards: ctx.profiles.manager.value.ownWords?.rewards,
      allowSexual: ctx.contract.allowSexualPurposes === true,
      text: data?.rewardText,
      // 型ごとのご褒美は、いまカードで選んでいる型の分だけ。
      styles: ctx.profiles.manager.value.card?.styles,
    });
    if (normalized.error) fail("invalid-argument", normalized.error);
    const reward = normalized.reward;
    return {
      reward,
      rewardMarks: reward ? { reward, ...(normalized.rewardText ? { rewardText: normalized.rewardText } : {}) } : {},
    };
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
    // 限度額は財布だけが読める場所へ書き、契約の記録には残さない（移す前の契約は、ここで消す）。
    const limitChanged = LIMIT_FIELDS.some((key) => key in ctx.patch);
    for (const key of LIMIT_FIELDS) delete ctx.patch[key];
    if (limitChanged || (ctx.limits.legacy && !ctx.limits.exists)) {
      transaction.set(ctx.limits.ref, { ...limitsOf(ctx.contract), contractId: ctx.contractId, payerUid: ctx.payerUid, updatedAt: ctx.now }, { merge: true });
    }
    if (ctx.limits.legacy) {
      if (!ctx.events.length && !Object.keys(ctx.patch).length) ctx.quiet = true;
      Object.assign(ctx.patch, { caps: null, pendingCaps: null, pendingCapsEffectiveDateKey: "" });
    }
    if (ctx.events.length || Object.keys(ctx.patch).length) {
      const contractWrite = {
        ...ctx.patch,
        eventSeq: ctx.seq,
        ...(ctx.events.length ? { lastEventAt: ctx.now } : {}),
        ...(ctx.quiet && !ctx.events.length ? {} : { updatedAt: ctx.now }),
      };
      // 書いた欄は丸ごと置き換える（mergeFields）。merge: true だと入れ子の地図が深く混ざり、
      // 払った・取り消した請求の鍵を pendingRequests から消しても残ってしまう（2026-10-26、二重払いの原因）。
      // 地図の欄は、どの操作も今の値を広げた丸ごとの地図を渡している。
      transaction.set(ctx.contractRef, contractWrite, { mergeFields: Object.keys(contractWrite) });
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
    // 限度額の変更は、管理人も読む出来事には残さない。
    if (applied) setContract(ctx, { caps, pendingCaps: null, pendingCapsEffectiveDateKey: "" });
    ctx.caps = caps;
  }

  // 契約を終える。管理口座は全額すぐ預ける側へ戻し、未払いの請求は無効にする。
  function stageEnd(ctx, reason) {
    const wasActive = ctx.contract.status === "active";
    const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
    const refund = escrow > 0 ? returnEscrow(ctx, escrow, "end", "ended") : { returned: 0, pending: 0 };
    setContract(ctx, {
      status: "ended",
      endReason: reason,
      endedAt: ctx.now,
      escrowBalance: 0,
      escrowWithdrawRequest: null,
      pendingRequests: {},
      reportRequestedAt: 0,
      workOrder: null,
      othello: null,
      othelloResult: null,
      pendingCaps: null,
      pendingCapsEffectiveDateKey: "",
      awaitingReceipt: 0,
    });
    adjustCounts(ctx, "payer", { payerOpen: -1 });
    adjustCounts(ctx, "manager", wasActive ? { managerActive: -1 } : { managerPending: -1 });
    if (ctx.pair.value.openContractId === ctx.contractId) patchPair(ctx, { openContractId: "" });
    pushEvent(ctx, { type: "ended", actor: "system", reason, escrowReturned: refund.returned, refundPending: refund.pending });
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
      return "契約期間が終わりました。管理口座の返金状況は「契約」画面で確認できます。";
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
    if (next > previous) transaction.set(reference, { readSeq: { ...readSeq, [role]: next }, ...ignoreStart(contract, role, next, now) }, { merge: true });
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
      receiptSnapshot,
      managerStatsSnapshot,
      payerStatsSnapshot,
      managerAchievementSnapshot,
      payerAchievementSnapshot,
    ] = await Promise.all([
      transaction.get(managerMonthRef(ctx.monthKey, ctx.managerUid)),
      receiptId ? transaction.get(receiptRef(ctx.payerUid, receiptId)) : Promise.resolve(null),
      transaction.get(achievementStatsRef(ctx.managerUid)),
      transaction.get(achievementStatsRef(ctx.payerUid)),
      transaction.get(achievementProfileRef(ctx.managerUid)),
      transaction.get(achievementProfileRef(ctx.payerUid)),
    ]);
    return {
      month: { exists: monthSnapshot.exists, value: object(monthSnapshot.data()) },
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


  // marks: 願い出て許された献上（granted）と、抵抗したあとの献上（resisted、渋った回数）。献上とレシートに残す。
  function stageTribute(ctx, extra, { kind, amount, requestId = "", note = "", purpose = "", opKey, marks = {} }) {
    const contract = ctx.contract;
    const caps = ctx.caps || effectiveCaps(contract, ctx.now).caps;
    const violation = capViolation(amount, contract, caps, ctx.now);
    // 管理人（管理口座からの徴収）には、財布の限度額の数字を見せない。
    if (violation) fail("failed-precondition", ctx.role === "manager" ? "財布の限度額を超えるため、いまは徴収できません。" : violation);
    const managerProfile = ctx.profiles.manager.value;
    const receivedToday = managerProfile.receiveDayKey === ctx.dateKey ? managerProfile.receiveDayTotal : 0;
    if (receivedToday + amount > LIMITS.managerDailyReceive) {
      fail("failed-precondition", `相手が今日受け取れる上限（全契約で${LIMITS.managerDailyReceive.toLocaleString("ja-JP")} Pay）に達しています。`);
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
    const net = amount - fee;
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
    const tributeMarks = {
      ...(marks.granted === true ? { granted: true } : {}),
      // 貢ぎオセロの罰金（何局目か）。記録の上は無言の献上で、名目は罰金。
      ...(integer(marks.othello, 0, Number.MAX_SAFE_INTEGER, 0) > 0 ? { othello: integer(marks.othello, 0, Number.MAX_SAFE_INTEGER, 0) } : {}),
      ...(integer(marks.resisted, 0, LIMITS.resistsPerRequest, 0) > 0 ? { resisted: integer(marks.resisted, 0, LIMITS.resistsPerRequest, 0) } : {}),
    };
    setContract(ctx, {
      ...(tributeMarks.resisted ? { resistedTributes: integer(contract.resistedTributes, 0, Number.MAX_SAFE_INTEGER, 0) + 1 } : {}),
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
      ...tributeMarks,
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
      ...servedDayPatch(ctx),
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
      updatedAt: ctx.now,
    };
    ctx.extraWrites.push((transaction) => transaction.set(managerMonthRef(ctx.monthKey, ctx.managerUid), monthPatch, { merge: true }));
    pushEvent(ctx, {
      type: "tribute",
      actor: fromEscrow ? "manager" : "payer",
      kind,
      amount,
      receiptId,
      ...(requestId ? { requestId } : {}),
      ...(note ? { note } : {}),
      ...(purpose ? { purpose } : {}),
      ...tributeMarks,
      ...(receivable ? {} : { receivedAt: ctx.now }),
    });
    stageTributeAchievements(ctx, extra, firstForPairToday);
    return { receipt: { receiptId, ...receipt }, fee, net };
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

  // checkHonors: まだ牧場基金の称号を確かめていない人だけ true（確かめ終えた人は、毎回の読み込みを増やさない）。
  async function ensureAchievementState(uid, { checkHonors = false } = {}) {
    const readState = () => firestore.runTransaction(async (transaction) => {
      const [statsSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(achievementStatsRef(uid)),
        transaction.get(achievementProfileRef(uid)),
      ]);
      // Ready users need only the atomic stats/profile read. Never carry a
      // preflight stats value into the transaction that unlocks achievements.
      if (!statsSnapshot.exists || statsSnapshot.get("historyBackfilled") !== true) return null;
      const stats = normalizeTributeStats(statsSnapshot.data());
      // 終わった牧場基金の称号（上納者・大上納者・牧場の主）を、限定称号として一度だけ実績に移す。
      const honorIds = [];
      if (checkHonors) {
        const honors = await transaction.get(firestore.collection("tributeHonors").where("uid", "==", uid).limit(100));
        for (const document of honors.docs) honorIds.push(...honorAchievementIds(object(document.data())));
      }
      const now = currentTime();
      const unlockResult = unlockAchievements(
        profileSnapshot.data(),
        [...eligibleAchievementIds({ tributeStats: stats, scope: "tribute" }), ...new Set(honorIds)],
        now,
      );
      if (unlockResult.newlyUnlocked.length) transaction.set(achievementProfileRef(uid), unlockResult.profile);
      if (checkHonors) transaction.set(profileRef(uid), { honorRecordsChecked: true, updatedAt: now }, { merge: true });
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
    let profile = await readOwnProfile(uid);
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
      profile = await readOwnProfile(uid);
    }
    // 財布として持つ契約だけ、財布だけが読める限度額を足して返す。
    const raw = snapshot.docs.map((document) => object(document.data()));
    const limits = await Promise.all(raw.map((contract) => (
      contract.payerUid === uid && OPEN_STATUSES.includes(contract.status) && CONTRACT_ID_PATTERN.test(String(contract.contractId || ""))
        ? limitsRef(contract.contractId).get()
        : Promise.resolve(null)
    )));
    // 管理している契約には、管理人が付けた呼び名を足す（財布には返さない）。
    const contracts = raw.map((contract, index) => {
      const view = viewContract(withLimits(contract, limits[index]), uid, now);
      return contract.managerUid === uid ? { ...view, nickname: profile.payerNicknames[contract.payerUid] || "" } : view;
    });
    let achievements = null;
    try {
      const achievementState = await ensureAchievementState(uid, { checkHonors: profile.exists && !profile.honorRecordsChecked });
      achievements = {
        stats: achievementState.stats,
        unlocked: Object.keys(achievementState.profile.unlocked).filter(isRanchAchievement),
        newlyUnlocked: Object.keys(achievementState.profile.pendingUnlocks).filter(isRanchAchievement),
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
    let declarationChanged = false;
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
        // 飾りは買ったものだけ、実績は解除したものだけをカードに出せる。
        const purchases = await Promise.all(requiredDecorationProducts(cardValues).map((productId) => transaction.get(purchaseRef(uid, productId))));
        if (purchases.some((snapshot) => !snapshot.exists)) {
          fail("failed-precondition", "持っていない飾りは保存できません。AnjuPayストアで買ってから選んでください。");
        }
        // 金庫の飾りは、金庫がその段階に一度でも届いていれば使える（ストアでは売らない）。
        const needTier = requiredVaultTier(cardValues);
        if (needTier > profile.vaultBestTier) {
          fail("failed-precondition", `この飾りは、金庫が「${vaultTierInfo(needTier).label}」に届くと使えます。`);
        }
        if (cardValues.achievements.length) {
          const unlocked = normalizeAchievementProfile((await transaction.get(achievementProfileRef(uid))).data()).unlocked;
          if (cardValues.achievements.some((id) => !unlocked[id] || !ACHIEVEMENT_BY_ID.has(id))) {
            fail("failed-precondition", "まだ解除していない実績は、カードに出せません。");
          }
        }
        card = cardValues;
        patch.card = cardValues;
        patch.cardUpdatedAt = now;
        // カードの保存も活動に数える（7日間動きがなく掲示板から外れたカードも、保存すると戻る）。
        patch.lastActiveAt = now;
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
      declarationChanged = Boolean(patch.card) && (profile.card?.ignoreUnpaid === true) !== (card?.ignoreUnpaid === true);
    });
    if (declarationChanged) await syncDeclaration(uid, saved.card?.ignoreUnpaid === true);
    const monthKey = jstMonthKey(now);
    const profile = readProfile({ exists: true, data: () => saved });
    return { ok: true, profile: ownProfileView(profile, monthKey, now) };
  }

  // 管理人カードの編集で使う、持っている牧場の飾りと解除済みの実績。編集を開いた時だけ読む（書き込まない）。
  async function decorationsAction(uid) {
    const profile = await readOwnProfile(uid);
    requireAge(profile);
    const [purchases, achievementSnapshot] = await Promise.all([
      firestore.collection("economyPurchases").doc(uid).collection("items")
        .where("productId", "in", [...DECORATION_PRODUCT_IDS])
        .get(),
      achievementProfileRef(uid).get(),
    ]);
    const owned = purchases.docs
      .map((document) => String(object(document.data()).productId || ""))
      .filter((productId) => DECORATION_PRODUCT_IDS.includes(productId));
    const unlocked = normalizeAchievementProfile(achievementSnapshot.data()).unlocked;
    const achievements = Object.keys(unlocked)
      .filter((id) => ACHIEVEMENT_BY_ID.has(id))
      .sort((left, right) => unlocked[right] - unlocked[left] || left.localeCompare(right));
    return { ok: true, owned: [...new Set(owned)].sort(), achievements, vaultBestTier: profile.vaultBestTier };
  }

  // 宣言「未払いは既読無視」を、管理人の申込中・進行中の契約へ写す（財布のスレッドに札を出すため）。
  // 失敗しても次の切り替えで写し直せるので、まとめて書くだけにする。
  async function syncDeclaration(uid, ignoreUnpaid) {
    const snapshot = await firestore.collection("tributeContracts")
      .where("participants", "array-contains", uid)
      .orderBy("updatedAt", "desc")
      .limit(200)
      .get();
    const targets = snapshot.docs.filter((document) => {
      const contract = object(document.data());
      return contract.managerUid === uid && OPEN_STATUSES.includes(contract.status)
        && (contract.managerIgnoreUnpaid === true) !== ignoreUnpaid;
    });
    await Promise.all(targets.map((document) => document.ref.set({ managerIgnoreUnpaid: ignoreUnpaid }, { merge: true })));
    return targets.length;
  }

  // 管理人の宣言の切り替え（スレッドの札のスイッチ）。カードを丸ごと保存し直さずに変える。
  async function setDeclarationAction(uid, data) {
    const ignoreUnpaid = data?.ignoreUnpaid === true;
    const now = currentTime();
    let saved = null;
    await firestore.runTransaction(async (transaction) => {
      saved = null;
      const snapshot = await transaction.get(profileRef(uid));
      const profile = readProfile(snapshot);
      requireAge(profile);
      if (!profile.card) fail("failed-precondition", "宣言は、管理人カードを作ってから出せます。");
      const card = { ...profile.card, ignoreUnpaid };
      transaction.set(profileRef(uid), { card, updatedAt: now }, { merge: true });
      saved = { ...object(snapshot.data()), card };
    });
    await syncDeclaration(uid, ignoreUnpaid);
    const profile = readProfile({ exists: true, data: () => saved });
    return { ok: true, profile: ownProfileView(profile, jstMonthKey(now), now) };
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

  // 管理人の自分の言葉（定型文・ご褒美）。管理人だけが読み、カードには入れないので掲示板に出ない。活動には数えない。
  async function setOwnWordsAction(uid, data) {
    const normalized = normalizeOwnWords(data?.ownWords);
    if (normalized.error) fail("invalid-argument", normalized.error);
    let saved = null;
    let now = 0;
    await firestore.runTransaction(async (transaction) => {
      saved = null;
      now = currentTime();
      const snapshot = await transaction.get(profileRef(uid));
      requireAge(readProfile(snapshot));
      const patch = { ownWords: normalized.ownWords, updatedAt: now };
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
    // 直近7日に動いた管理人だけを読む。放置されたカードは条件で外れ、読み込みにも数えない。
    const activeSince = now - LIMITS.boardActiveWindowMs;
    const boardSnapshot = await firestore.collection("tributeProfiles")
      .where("accepting", "==", true)
      .where("lastActiveAt", ">=", activeSince)
      .orderBy("lastActiveAt", "desc")
      .limit(LIMITS.boardLimit * 2)
      .get();
    const toRows = (snapshot) => snapshot.docs
      .map((document) => ({ uid: document.id, profile: readProfile(document) }))
      .filter((row) => row.profile.accepting
        && row.profile.publicManagerId
        && row.profile.ageConfirmedVersion === TRIBUTE_AGE_VERSION
        && !profileIsHidden(row.profile, monthKey));
    const nekamaOnly = data?.nekamaOnly === true;
    const badges = await rankBadges(monthKey, now);
    const board = (await visibleRows(uid, toRows(boardSnapshot).filter((row) => row.profile.lastActiveAt >= activeSince)))
      .filter((row) => !nekamaOnly || row.profile.card?.disclosure === "nekama")
      .slice(0, LIMITS.boardLimit)
      .map((row) => ({ ...publicCard(row.profile, monthKey, now), grossRank: badges.get(row.uid) || 0, mine: row.uid === uid }));
    return { ok: true, nekamaOnly, managers: board };
  }

  // 管理人ごとの番付（設計書15.1）。財布どうしを額で比べないよう、見せるのは仕えた日数の順だけにする。
  // 当月は仕えた日数の多い順（同じなら首輪番号の古い順）、累計は首輪番号の古い順。額の順位は管理人本人にだけ返す。
  async function managerRanking(managerUid, monthKey, uid) {
    const pairs = () => firestore.collection("tributePairs").where("managerUid", "==", managerUid).where("rankOptIn", "==", true);
    const read = async (label, query) => {
      try {
        return (await query.get()).docs.map((document) => object(document.data()));
      } catch (error) {
        // インデックスを作っている間などは、その欄だけ空にして詳細は開けるようにする。
        console.error(`tribute ranking ${label} failed`, error);
        return [];
      }
    };
    const isManager = managerUid === uid;
    const [monthPairs, lifetimePairs, amountMonth, amountLifetime] = await Promise.all([
      read("month", pairs().where("servedMonthKey", "==", monthKey).orderBy("servedDays", "desc").orderBy("collarNo", "asc").limit(LIMITS.rankingLimit)),
      read("lifetime", pairs().orderBy("collarNo", "asc").limit(LIMITS.rankingLimit)),
      isManager ? read("amount-month", pairs().where("monthKey", "==", monthKey).orderBy("monthTotal", "desc").limit(LIMITS.rankingLimit)) : [],
      isManager ? read("amount-lifetime", pairs().orderBy("total", "desc").limit(LIMITS.rankingLimit)) : [],
    ]);
    const count = (value) => integer(value, 0, Number.MAX_SAFE_INTEGER, 0);
    const ranked = (list, fields) => list.map((pair, index) => ({
      rank: index + 1,
      walletName: normalizeWalletName(pair.walletName),
      ...fields(pair),
      mine: pair.payerUid === uid,
    }));
    return {
      month: ranked(monthPairs.filter((pair) => count(pair.servedDays) > 0), (pair) => ({ days: count(pair.servedDays), collarNo: count(pair.collarNo) })),
      lifetime: ranked(lifetimePairs.filter((pair) => count(pair.count) > 0 && count(pair.collarNo) > 0), (pair) => ({ collarNo: count(pair.collarNo) })),
      ...(isManager ? {
        amounts: {
          month: ranked(amountMonth.filter((pair) => count(pair.monthTotal) > 0), (pair) => ({ amount: count(pair.monthTotal) })),
          lifetime: ranked(amountLifetime.filter((pair) => count(pair.total) > 0), (pair) => ({ amount: count(pair.total) })),
        },
      } : {}),
    };
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
    const [monthSnapshot, pairSnapshot, ranking, badges, cheers] = await Promise.all([
      managerMonthRef(monthKey, managerUid).get(),
      managerUid === uid ? Promise.resolve(null) : pairRef(managerUid, uid).get(),
      managerRanking(managerUid, monthKey, uid),
      rankBadges(monthKey, now),
      cheerList(managerUid, monthKey, uid),
    ]);
    const month = object(monthSnapshot.data());
    const pair = pairSnapshot?.exists ? object(pairSnapshot.data()) : {};
    return {
      ok: true,
      card: { ...publicCard(profile, monthKey, now), grossRank: badges.get(managerUid) || 0, mine: managerUid === uid },
      cheers,
      myCheer: managerUid === uid ? null : myCheerView(pair, monthKey, now),
      month: {
        payers: integer(month.payers, 0, Number.MAX_SAFE_INTEGER, 0),
        tributeCount: integer(month.tributeCount, 0, Number.MAX_SAFE_INTEGER, 0),
      },
      openContractId: CONTRACT_ID_PATTERN.test(String(pair.openContractId || "")) ? pair.openContractId : "",
      myTotal: integer(pair.total, 0, Number.MAX_SAFE_INTEGER, 0),
      ranking,
    };
  }

  async function applyAction(uid, data, context = {}) {
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
      if (capsNeedGoogle(application.caps) && context?.googleProtected !== true) {
        fail("failed-precondition", "1回の限度額を3,000 Pay以上にするには、AnjuPayウォレットを Google で保護してください。");
      }
      if (openContractSnapshot?.exists && OPEN_STATUSES.includes(openContractSnapshot.get("status"))) {
        fail("failed-precondition", "この管理人とは、申込中か進行中の契約があります。");
      }
      // 申し込みと取り下げの繰り返しで、管理人の受付待ちを埋められないようにする。
      if (now - payer.lastApplyAt < APPLY_INTERVAL_MS) {
        fail("resource-exhausted", "申し込みは30秒に1回までです。少し待ってからお試しください。");
      }
      if (payer.counts.payerOpen >= LIMITS.payerOpenContracts) {
        fail("failed-precondition", `申込中・進行中の契約は${LIMITS.payerOpenContracts}件までです。どれかを終えてから申し込んでください。`);
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
        managerPublicId: publicManagerId,
        entryFee,
        payerWalletName: application.walletName,
        managerIgnoreUnpaid: manager.card.ignoreUnpaid === true,
        durationDays: application.durationDays,
        tone: application.tone,
        ngWords: application.ngWords,
        wantWords: application.wantWords,
        allowReportRequests: application.allowReportRequests,
        rankOptIn: application.rankOptIn,
        allowSexualPurposes: application.allowSexualPurposes,
        allowScreenshots: application.allowScreenshots,
        allowWorkOrders: application.allowWorkOrders,
        allowHolds: application.allowHolds,
        allowOthello: application.allowOthello,
        othello: null,
        othelloSeq: 0,
        othelloResult: null,
        workOrder: null,
        workOrderSeq: 0,
        workOrdersDone: 0,
        hold: null,
        plea: null,
        pleaSeq: 0,
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
      // 限度額は財布だけが読める場所へ。管理人も読む「申し込み」の出来事には入れない。
      const limits = { caps: application.caps, pendingCaps: null, pendingCapsEffectiveDateKey: "" };
      transaction.create(limitsRef(contractId), { ...limits, contractId, payerUid: uid, updatedAt: now });
      transaction.create(eventRef(contractId, 1), {
        seq: 1,
        type: "applied",
        actor: "payer",
        durationDays: application.durationDays,
        tone: application.tone,
        entryFee,
        allowSexualPurposes: application.allowSexualPurposes,
        allowScreenshots: application.allowScreenshots,
        allowWorkOrders: application.allowWorkOrders,
        allowHolds: application.allowHolds,
        allowOthello: application.allowOthello,
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
      created = viewContract({ ...contract, ...limits }, uid, now);
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

  // 契約後の会話と請求の一言: 現実のお金の判定と、財布の「言われたくない言葉」だけ。
  function checkManagerText(ctx, text) {
    const reason = contractTextReason(text);
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

  function requireWorkCounting() {
    if (!economyProgressRef || typeof totalVerifiedMatches !== "function") {
      fail("unavailable", "出稼ぎ命令は今使えません。時間をおいてお試しください。");
    }
  }

  function matchesOf(progressSnapshot) {
    return integer(totalVerifiedMatches(progressSnapshot.exists ? progressSnapshot.data() : {}), 0, Number.MAX_SAFE_INTEGER, 0);
  }

  // 財布のいまの正式完走数（と、報告の時は命令した時の完走数）。対戦の確定処理には触れず、ここで読み直す。
  async function readPayerMatches(transaction, ctx, { withBaseline = false } = {}) {
    requireWorkCounting();
    const [progressSnapshot, workSnapshot] = await Promise.all([
      transaction.get(economyProgressRef(ctx.payerUid)),
      withBaseline ? transaction.get(workRef(ctx.contractId)) : null,
    ]);
    return { matches: matchesOf(progressSnapshot), work: workSnapshot?.exists ? object(workSnapshot.data()) : null };
  }

  function requireWorkCount(order, extra) {
    const count = workCount(order, extra.work, extra.matches);
    if (count === null) fail("failed-precondition", "出稼ぎ命令を確認できません。開き直してください。");
    return count;
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
          fail("failed-precondition", `進行中の契約は${LIMITS.managerActiveContracts}件までです。`);
        }
        const durationDays = integer(ctx.contract.durationDays, 1, MAX_DURATION_DAYS, 1);
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
        // 貢ぎオセロの戦績は組ごと（契約をまたぐ）。前の契約の戦績を、この契約に写して見せる。
        if (ctx.pair.value.othelloRecord) setContract(ctx, { othelloRecord: othelloRecordView(ctx.pair.value.othelloRecord) });
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
        // 既読無視の数え方: 財布の最後のメッセージと、管理人の最後の返事。返事をすると既読無視は終わる。
        if (ctx.role === "payer") setContract(ctx, { lastPayerMessageSeq: ctx.seq });
        else setContract(ctx, { lastManagerReplySeq: ctx.seq, ignoredSince: 0 });
        markManagerActive(ctx);
        return { ok: true, seq: ctx.seq };
      },
    },
    request: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        // 請求は財布の限度額に関係なく、1回10,000 Payまで。限度額を超える請求は、払えないまま残る。
        const amount = requireAmount(data?.amount);
        if (amount > LIMITS.requestMax) fail("invalid-argument", `請求は1回 ${LIMITS.requestMax.toLocaleString("ja-JP")} Pay までです。`);
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
        if (amount >= LIMITS.highRequest) patchProfile(ctx, "manager", { highRequestAt: ctx.now });
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
    // 請求は断れない。払うか、契約を解約するか（古い画面からの「断る」もここで止める）。
    decline_request: {
      roles: ["payer"],
      statuses: ["active"],
      write() {
        fail("failed-precondition", "請求は断れません。払うか、契約を解約してください。");
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
        // 種類: 請求に応える・無言の献上・願い出て許された献上（granted。記録の上は無言の献上）。
        const requested = String(data?.kind || "");
        const kind = requested === "request" ? "request" : "silent";
        const allowSexual = ctx.contract.allowSexualPurposes === true;
        let amount;
        let requestId = "";
        let note = "";
        let purpose = "";
        let marks = {};
        if (kind === "request") {
          requestId = String(data?.requestId || "");
          const requests = { ...object(ctx.contract.pendingRequests) };
          const request = requests[requestId];
          if (!request) fail("not-found", "その請求は残っていません。");
          amount = integer(request.amount, 0, 1_000_000, 0);
          if (Number(data?.amount) !== amount) fail("failed-precondition", "請求の金額が変わりました。開き直してください。");
          note = cleanLine(request.note, LIMITS.requestNote);
          purpose = visiblePurpose(request.purpose, { allowSexual });
          marks = { resisted: integer(request.resists, 0, LIMITS.resistsPerRequest, 0), othello: integer(request.othello, 0, Number.MAX_SAFE_INTEGER, 0) };
          delete requests[requestId];
          setContract(ctx, { pendingRequests: requests });
        } else if (requested === "othello") {
          // 貢ぎオセロの罰金。財布の1回の限度額までを、財布が長押しで差し出す（管理人に限度額は見せない）。
          const result = othelloResultView(ctx.contract);
          if (!result) fail("failed-precondition", "払う罰金はありません。開き直してください。");
          amount = Math.min(result.penalty, ctx.caps.perTribute);
          if (Number(data?.amount) !== amount) fail("failed-precondition", "罰金の額が変わりました。開き直してください。");
          purpose = "penalty";
          marks = { othello: result.gameSeq };
          setContract(ctx, { othelloResult: null });
        } else if (requested === "granted") {
          const plea = pleaView(ctx.contract);
          if (!plea?.granted) fail("failed-precondition", "許された願い出はありません。開き直してください。");
          amount = plea.amount;
          if (Number(data?.amount) !== amount) fail("failed-precondition", "許された金額が変わりました。開き直してください。");
          purpose = plea.purpose;
          marks = { granted: true };
          setContract(ctx, { plea: null });
        } else {
          // お預けの間は、財布から勝手に差し出せない（請求に応えるのと、許された願い出はできる）。
          if (holdView(ctx.contract)) fail("failed-precondition", "お預け中です。差し出すには、願い出て許してもらってください。");
          amount = requireAmount(data?.amount);
          const named = normalizePurpose(data?.purpose, { allowSexual });
          if (named.error) fail("failed-precondition", named.error);
          purpose = named.purpose;
        }
        const outcome = stageTribute(ctx, extra, { kind, amount, requestId, purpose, marks, opKey: `client:${clientRequestId}` });
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
        if (!next) fail("invalid-argument", "限度額は「1回 ≦ 1日 ≦ 合計」になるように選んでください。");
        if (capsNeedGoogle(next) && !capsNeedGoogle(ctx.caps) && ctx.context?.googleProtected !== true) {
          fail("failed-precondition", "1回の限度額を3,000 Pay以上にするには、AnjuPayウォレットを Google で保護してください。");
        }
        const current = ctx.caps;
        const immediate = {
          perTribute: Math.min(next.perTribute, current.perTribute),
          perDay: Math.min(next.perDay, current.perDay),
          total: Math.min(next.total, current.total),
        };
        const lowered = !capsAreLowerOrEqual(current, immediate);
        const raising = !capsAreLowerOrEqual(next, immediate);
        if (!lowered && !raising) return { ok: true, contract: view(ctx), unchanged: true };
        // 限度額の変更は管理人に知らせない（出来事に残さない）。下げても、払えない請求は未払いのまま残る。
        if (lowered) {
          setContract(ctx, { caps: immediate });
          ctx.caps = immediate;
          // 管理口座が新しい合計上限の残りを超えた分は、すぐ財布へ戻す。
          const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0);
          const room = Math.max(0, immediate.total - integer(ctx.contract.totalTributed, 0, Number.MAX_SAFE_INTEGER, 0));
          const excess = Math.max(0, escrow - room);
          if (excess > 0) returnEscrow(ctx, excess, `caps:${ctx.now}`, "caps");
        }
        if (raising) {
          const effectiveDateKey = nextJstDateKey(ctx.now);
          setContract(ctx, { pendingCaps: next, pendingCapsEffectiveDateKey: effectiveDateKey });
        } else if (ctx.contract.pendingCaps) {
          setContract(ctx, { pendingCaps: null, pendingCapsEffectiveDateKey: "" });
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
          const refund = amount > 0 ? returnEscrow(ctx, amount, `approve:${integer(request.requestedAt, 0, Number.MAX_SAFE_INTEGER, 0)}`, "approved") : { returned: 0, pending: 0 };
          pushEvent(ctx, { type: "escrow_approved", actor: "manager", amount: refund.returned, refundPending: refund.pending });
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
    // 呼び名。管理人が財布ごとに付け、管理人の記録（tributeProfiles、財布からは読めない）にだけ残す。
    // 同じ財布との次の契約にも引き継ぐ。契約の記録には書かないので、一覧の並びも変わらない。
    set_nickname: {
      roles: ["manager"],
      statuses: ["pending", "active", "ended"],
      write(ctx, _extra, data) {
        const nickname = normalizeNickname(data?.nickname);
        const names = ctx.profiles.manager.value.payerNicknames || {};
        const payerUid = ctx.contract.payerUid;
        if ((names[payerUid] || "") === nickname) return { ok: true, nickname, unchanged: true };
        if (nickname && !names[payerUid] && Object.keys(names).length >= LIMITS.nicknameEntries) {
          fail("resource-exhausted", `呼び名は${LIMITS.nicknameEntries}人までです。使わない呼び名を外してください。`);
        }
        patchProfile(ctx, "manager", { payerNicknames: { ...names, [payerUid]: nickname } });
        return { ok: true, nickname };
      },
    },
    // スクショ掲載の許可（管理人のXに、財布が写る画面を載せてよいか）。決めるのは預ける側だけで、いつでも変えられる。
    // 会話で頼まなくて済むよう、管理人にはスレッドの札で見せる。すでに載ったものは、アプリでは消せない。
    set_screenshots: {
      roles: ["payer"],
      statuses: ["pending", "active"],
      write(ctx, _extra, data) {
        const allow = data?.allowScreenshots === true;
        if ((ctx.contract.allowScreenshots === true) === allow) return { ok: true, contract: view(ctx), unchanged: true };
        setContract(ctx, { allowScreenshots: allow });
        pushEvent(ctx, { type: "screenshots_changed", actor: "payer", allowScreenshots: allow });
        return { ok: true, contract: view(ctx) };
      },
    },
    // 言われたい言葉。決めるのは預ける側だけで、申し込みの後もいつでも変えられる。管理人のスレッドに札として出る。
    set_want_words: {
      roles: ["payer"],
      statuses: ["pending", "active"],
      write(ctx, _extra, data) {
        const normalized = normalizeWantWords(data?.wantWords, { ngWords: ctx.contract.ngWords });
        if (normalized.error) fail("invalid-argument", normalized.error);
        const current = wantWordList(ctx.contract);
        if (current.length === normalized.words.length && current.every((word, index) => word === normalized.words[index])) {
          return { ok: true, contract: view(ctx), unchanged: true };
        }
        setContract(ctx, { wantWords: normalized.words });
        pushEvent(ctx, { type: "want_words_changed", actor: "payer", count: normalized.words.length });
        return { ok: true, contract: view(ctx) };
      },
    },
    // お預けを受けるか。決めるのは預ける側だけで、いつでも変えられる。外すと、お預けと願い出はその場で消える。
    set_holds: {
      roles: ["payer"],
      statuses: ["pending", "active"],
      write(ctx, _extra, data) {
        const allow = data?.allowHolds === true;
        if ((ctx.contract.allowHolds === true) === allow) return { ok: true, contract: view(ctx), unchanged: true };
        const held = holdView(ctx.contract);
        setContract(ctx, { allowHolds: allow });
        pushEvent(ctx, { type: "holds_changed", actor: "payer", allowHolds: allow });
        if (!allow && (held || ctx.contract.plea)) {
          setContract(ctx, { hold: null, plea: null });
          if (held) pushEvent(ctx, { type: "unhold", actor: "system", reason: "setting" });
        }
        return { ok: true, contract: view(ctx) };
      },
    },
    // お預け。管理する側が、財布から勝手に差し出すこと（無言の献上）を止める。期限はなく、「解く」まで続く。
    // 請求に応える献上と管理口座の出し入れは止めない。限度額と解約は、これまでどおり財布が持つ。
    hold: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        if (ctx.contract.allowHolds !== true) fail("failed-precondition", "この契約では、お預けにできません。");
        if (holdView(ctx.contract)) fail("failed-precondition", "もうお預けにしています。");
        const note = cleanLine(data?.note, LIMITS.requestNote);
        if (note) checkManagerText(ctx, note);
        messageRate(ctx);
        setContract(ctx, { hold: { since: ctx.now, note } });
        pushEvent(ctx, { type: "hold", actor: "manager", ...(note ? { note } : {}) });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    unhold: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        if (!holdView(ctx.contract)) fail("failed-precondition", "お預けにしていません。");
        // お預けが解けると、願い出（許したものも）は要らなくなるので消える。
        setContract(ctx, { hold: null, plea: null });
        pushEvent(ctx, { type: "unhold", actor: "manager", reason: "manager" });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    // 願い出。お預けの間に、財布が金額・名目・一言を付けて「貢がせてください」と願い出る。1件ずつ。
    // 財布の発言に数える（読んで返さなければ既読無視）。金額は1回の限度額まで（数字は財布にだけ返す）。
    plea: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        if (!holdView(ctx.contract)) fail("failed-precondition", "お預け中ではないので、願い出なくても差し出せます。");
        if (ctx.contract.plea) fail("failed-precondition", "願い出は1件ずつです。");
        const amount = requireAmount(data?.amount);
        const caps = ctx.caps || effectiveCaps(ctx.contract, ctx.now).caps;
        if (!caps || amount > caps.perTribute) fail("failed-precondition", `1回の限度額（${caps ? caps.perTribute : 0} Pay）を超えています。`);
        const named = normalizePurpose(data?.purpose, { allowSexual: ctx.contract.allowSexualPurposes === true });
        if (named.error) fail("failed-precondition", named.error);
        const note = cleanLine(data?.note, LIMITS.requestNote);
        if (note) checkManagerText(ctx, note);
        messageRate(ctx);
        const pleaSeq = integer(ctx.contract.pleaSeq, 0, Number.MAX_SAFE_INTEGER, 0) + 1;
        setContract(ctx, {
          pleaSeq,
          plea: { pleaSeq, amount, purpose: named.purpose, note, createdAt: ctx.now, grantedAt: 0 },
          pleaCount: integer(ctx.contract.pleaCount, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
        });
        pushEvent(ctx, { type: "plea", actor: "payer", pleaSeq, amount, ...(named.purpose ? { purpose: named.purpose } : {}), ...(note ? { note } : {}) });
        setContract(ctx, { lastPayerMessageSeq: ctx.seq });
        return { ok: true, contract: view(ctx) };
      },
    },
    plea_withdraw: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx) {
        const plea = pleaView(ctx.contract);
        if (!plea) fail("failed-precondition", "取り下げられる願い出はありません。");
        setContract(ctx, { plea: null });
        pushEvent(ctx, { type: "plea_withdrawn", actor: "payer", pleaSeq: plea.pleaSeq, reason: "withdrawn" });
        return { ok: true, contract: view(ctx) };
      },
    },
    // 許すと、財布はその金額をいつもの長押しで1回だけ差し出せる（差し出すかは財布が決める）。退けると願い出は消える。
    // どちらも管理人の返事に数え、既読無視を終える。
    plea_grant: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        return answerPlea(ctx, data, true);
      },
    },
    plea_deny: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        return answerPlea(ctx, data, false);
      },
    },
    // 抵抗。未払いの請求に、財布が渋る一言を返す（1件の請求に3回まで）。請求は断れず、未払いのまま残る。
    // 財布の発言に数える。払うと、渋った回数が献上とレシートに残る。
    resist: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const requestId = String(data?.requestId || "");
        const requests = { ...object(ctx.contract.pendingRequests) };
        const request = requests[requestId];
        if (!request) fail("not-found", "その請求は残っていません。");
        const resists = integer(request.resists, 0, LIMITS.resistsPerRequest, 0);
        if (resists >= LIMITS.resistsPerRequest) fail("failed-precondition", `抵抗は1つの請求に${LIMITS.resistsPerRequest}回までです。`);
        const text = cleanLine(data?.text, LIMITS.requestNote);
        if (!text) fail("invalid-argument", "渋る一言を入力してください。");
        checkManagerText(ctx, text);
        messageRate(ctx);
        setContract(ctx, { pendingRequests: { ...requests, [requestId]: { ...request, resists: resists + 1 } } });
        pushEvent(ctx, { type: "resist", actor: "payer", requestId, count: resists + 1, text, ...(data?.template === true ? { template: true } : {}) });
        setContract(ctx, { lastPayerMessageSeq: ctx.seq });
        return { ok: true, contract: view(ctx) };
      },
    },
    // 言葉の献上。Pay 0 で、告白・短い話・報告などの文（400文字まで）を差し出す。1つの契約で日本時間の1日3回まで。
    // 管理人は献上と同じく受取印とご褒美で受け取る。Pay を動かさないので、番付・貢がれ総額・応援欄・実績・限度額には数えない。
    offer_words: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const normalized = normalizeWordOffering(data?.text);
        if (normalized.error) fail("invalid-argument", normalized.error);
        const usedToday = ctx.contract.wordOfferDayKey === ctx.dateKey ? integer(ctx.contract.wordOfferDayCount, 0, 1_000, 0) : 0;
        if (usedToday >= LIMITS.wordOfferingsPerDay) {
          fail("resource-exhausted", `言葉の献上は1つの契約で1日${LIMITS.wordOfferingsPerDay}回までです。日本時間の0時に戻ります。`);
        }
        messageRate(ctx);
        setContract(ctx, {
          wordOfferDayKey: ctx.dateKey,
          wordOfferDayCount: usedToday + 1,
          wordOfferings: integer(ctx.contract.wordOfferings, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
          awaitingReceipt: integer(ctx.contract.awaitingReceipt, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
        });
        pushEvent(ctx, { type: "word_offering", actor: "payer", text: normalized.text });
        // 言葉の献上も、仕えた日として数える（Pay は動かないので、額の記録は変えない）。
        patchPair(ctx, { ...servedDayPatch(ctx), rankOptIn: ctx.contract.rankOptIn === true, walletName: payerName(ctx) });
        return { ok: true, contract: view(ctx) };
      },
    },
    // 復唱。管理人が言わせたい一言（60文字まで）と回数（1／3／5回）を送り、財布が一字一句同じに打つ。1つの契約に1件まで。
    // 性的な言葉は、財布が性的な名目を許した契約でだけ。復唱しなくても何も起きない。
    recite_order: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        if (openReciteOrder(ctx.contract)) fail("failed-precondition", "復唱は1件ずつです。");
        const target = Number(data?.target);
        if (!RECITE_TARGETS.includes(target)) fail("invalid-argument", "回数を選び直してください。");
        const text = reciteKey(data?.text);
        if (!text) fail("invalid-argument", "言わせたい一言を入力してください。");
        checkManagerText(ctx, text);
        if (boardSexualWord(text) && ctx.contract.allowSexualPurposes !== true) {
          fail("failed-precondition", "この契約では、性的な言葉を復唱させられません（財布が性的な名目を許していません）。");
        }
        messageRate(ctx);
        // 確認していない前の復唱は、ここで確認なしに閉じる。
        const orderSeq = integer(ctx.contract.reciteSeq, 0, Number.MAX_SAFE_INTEGER, 0) + 1;
        setContract(ctx, { reciteSeq: orderSeq, reciteOrder: { orderSeq, text, target, count: 0, issuedAt: ctx.now, doneAt: 0 } });
        pushEvent(ctx, { type: "recite_order", actor: "manager", orderSeq, text, target });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    // 財布が一字一句同じに打って送る。違えば送らない（NFKC にし、前後の空白と続く空白だけは無視）。
    // 出稼ぎの報告と同じく、財布の発言には数えない（既読無視を始めない）。
    recite: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const order = openReciteOrder(ctx.contract);
        if (!order) fail("failed-precondition", "復唱する一言はありません。");
        if (reciteKey(data?.text) !== order.text) fail("invalid-argument", "一字一句同じに打ってください。");
        messageRate(ctx);
        const count = order.count + 1;
        const done = count >= order.target;
        setContract(ctx, {
          reciteOrder: { ...object(ctx.contract.reciteOrder), count, ...(done ? { doneAt: ctx.now } : {}) },
          ...(done ? { recitesDone: integer(ctx.contract.recitesDone, 0, Number.MAX_SAFE_INTEGER, 0) + 1 } : {}),
        });
        pushEvent(ctx, { type: "recite", actor: "payer", orderSeq: order.orderSeq, count, target: order.target, text: order.text, done });
        return { ok: true, count, done, contract: view(ctx) };
      },
    },
    recite_withdraw: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        const order = openReciteOrder(ctx.contract);
        if (!order) fail("failed-precondition", "取り下げられる復唱はありません。");
        setContract(ctx, { reciteOrder: null });
        pushEvent(ctx, { type: "recite_withdrawn", actor: "manager", orderSeq: order.orderSeq });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    // 果たした復唱を、管理人が確かめる。受取印を1つ押し、ご褒美を1つ添えられる（出稼ぎの確認と同じ）。
    recite_confirm: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const order = reciteOrderView(ctx.contract);
        if (!order?.done) fail("failed-precondition", "確認できる復唱はありません。");
        const { reward, rewardMarks } = contractReward(ctx, data);
        const card = ctx.profiles.manager.value.card;
        const seal = sealFor(data?.seal, { seals: card?.seals, ngWords: ctx.contract.ngWords });
        setContract(ctx, { reciteOrder: null });
        pushEvent(ctx, { type: "recite_confirm", actor: "manager", orderSeq: order.orderSeq, target: order.target, seal, ...sealLook(card), ...rewardMarks });
        if (reward) setContract(ctx, { lastManagerReplySeq: ctx.seq, ignoredSince: 0 });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    // 延長。財布が日数（1／3／7／14／30日）を選んで申し込み、管理人が受けると、いまの期限から延びる。入場料は取らない。
    // 期間は財布が決めるので、管理人からは申し込めない。1件ずつで、受ける前に契約が終わると消える。
    extend_request: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        if (extensionView(ctx.contract)) fail("failed-precondition", "延長の申し込みは1件ずつです。");
        const days = Number(data?.days);
        if (!DURATION_DAYS_OPTIONS.includes(days)) fail("invalid-argument", "日数を選び直してください。");
        messageRate(ctx);
        setContract(ctx, { extension: { days, createdAt: ctx.now } });
        pushEvent(ctx, { type: "extend_request", actor: "payer", days });
        return { ok: true, contract: view(ctx) };
      },
    },
    extend_withdraw: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx) {
        const extension = extensionView(ctx.contract);
        if (!extension) fail("failed-precondition", "取り下げられる延長の申し込みはありません。");
        setContract(ctx, { extension: null });
        pushEvent(ctx, { type: "extend_withdrawn", actor: "payer", days: extension.days });
        return { ok: true, contract: view(ctx) };
      },
    },
    extend_accept: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        const extension = extensionView(ctx.contract);
        if (!extension) fail("failed-precondition", "受けられる延長の申し込みはありません。");
        const expiresAt = integer(ctx.contract.expiresAt, 0, Number.MAX_SAFE_INTEGER, ctx.now) + extension.days * DAY_MS;
        setContract(ctx, {
          expiresAt,
          extension: null,
          extendedDays: integer(ctx.contract.extendedDays, 0, Number.MAX_SAFE_INTEGER, 0) + extension.days,
        });
        pushEvent(ctx, { type: "extend_accepted", actor: "manager", days: extension.days, expiresAt });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    extend_decline: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        const extension = extensionView(ctx.contract);
        if (!extension) fail("failed-precondition", "断れる延長の申し込みはありません。");
        setContract(ctx, { extension: null });
        pushEvent(ctx, { type: "extend_declined", actor: "manager", days: extension.days });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    // 出稼ぎ命令を受けるか。決めるのは預ける側だけで、いつでも変えられる。外すと、まだ果たしていない命令はその場で消える。
    // 貢ぎオセロを受けるか（設計書15.2）。決めるのは財布。外すと、進行中の対局は罰金なしで終わる。
    set_othello: {
      roles: ["payer"],
      statuses: ["pending", "active"],
      write(ctx, _extra, data) {
        const allow = data?.allowOthello === true;
        if ((ctx.contract.allowOthello === true) === allow) return { ok: true, contract: view(ctx), unchanged: true };
        const game = othelloView(ctx.contract);
        setContract(ctx, { allowOthello: allow });
        pushEvent(ctx, { type: "othello_setting", actor: "payer", allowOthello: allow });
        if (!allow && game) {
          setContract(ctx, { othello: null });
          pushEvent(ctx, { type: "othello_stopped", actor: "payer", gameSeq: game.gameSeq });
        }
        return { ok: true, contract: view(ctx) };
      },
    },
    // 対局を始めるかどうか・1枚あたりの額・ハンデ・先手は、管理人だけが決める。財布は個々の対局を断れない。
    othello_start: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        if (ctx.contract.allowOthello !== true) fail("failed-precondition", "この契約では、貢ぎオセロを始められません。");
        if (othelloView(ctx.contract)) fail("failed-precondition", "対局は1つずつです。");
        if (othelloResultView(ctx.contract)) fail("failed-precondition", "前の対局の罰金が、まだ払われていません。");
        const options = normalizeOthelloStart(data);
        if (options.error) fail("invalid-argument", options.error);
        messageRate(ctx);
        const gameSeq = integer(ctx.contract.othelloSeq, 0, Number.MAX_SAFE_INTEGER, 0) + 1;
        setContract(ctx, {
          othelloSeq: gameSeq,
          othello: {
            gameSeq,
            board: othelloInitialBoard(options.handicap),
            turn: options.managerFirst ? "manager" : "payer",
            rate: options.rate,
            handicap: options.handicap,
            startedAt: ctx.now,
            lastMoveAt: ctx.now,
            lastMove: null,
          },
        });
        pushEvent(ctx, { type: "othello_start", actor: "manager", gameSeq, rate: options.rate, handicap: options.handicap, managerFirst: options.managerFirst });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    othello_move: {
      roles: ["manager", "payer"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const game = othelloView(ctx.contract);
        if (!game) fail("failed-precondition", "進行中の対局はありません。");
        if (game.turn !== ctx.role) fail("failed-precondition", "いまは相手の手番です。");
        if (Number(data?.gameSeq) !== game.gameSeq) fail("failed-precondition", "対局が変わりました。開き直してください。");
        const played = othelloPlay(game.board, othelloSide(ctx.role), Number(data?.index));
        if (played.error) fail("invalid-argument", played.error);
        const note = othelloNote(ctx, data?.note);
        messageRate(ctx);
        pushEvent(ctx, {
          type: "othello_move",
          actor: ctx.role,
          gameSeq: game.gameSeq,
          index: Number(data.index),
          flipped: played.flipped,
          corner: played.corner,
          ...othelloCount(played.board),
          ...(note ? { note } : {}),
        });
        if (note) {
          if (ctx.role === "payer") setContract(ctx, { lastPayerMessageSeq: ctx.seq });
          else setContract(ctx, { lastManagerReplySeq: ctx.seq, ignoredSince: 0 });
        }
        if (ctx.role === "manager") markManagerActive(ctx);
        const next = othelloNextTurn(played.board, ctx.role);
        if (!next.turn) {
          finishOthello(ctx, game, played.board);
          return { ok: true, contract: view(ctx) };
        }
        if (next.passed) pushEvent(ctx, { type: "othello_pass", actor: "system", gameSeq: game.gameSeq, passed: next.passed });
        setContract(ctx, {
          othello: {
            ...object(ctx.contract.othello),
            board: played.board,
            turn: next.turn,
            lastMoveAt: ctx.now,
            lastMove: { index: Number(data.index), flipped: played.flipped, role: ctx.role },
          },
        });
        return { ok: true, contract: view(ctx) };
      },
    },
    // 降参。その場で負けになり、罰金はその時の差と1枚分の大きい方。
    othello_resign: {
      roles: ["payer"],
      statuses: ["active"],
      write(ctx) {
        const game = othelloView(ctx.contract);
        if (!game) fail("failed-precondition", "進行中の対局はありません。");
        messageRate(ctx);
        finishOthello(ctx, game, game.board, { resigned: true });
        return { ok: true, contract: view(ctx) };
      },
    },
    // 止まった対局を、管理人が罰金なしで終わらせる。
    othello_end: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        const game = othelloView(ctx.contract);
        if (!game) fail("failed-precondition", "進行中の対局はありません。");
        setContract(ctx, { othello: null });
        pushEvent(ctx, { type: "othello_end", actor: "manager", gameSeq: game.gameSeq });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    // 払われない罰金を、管理人が同じ額の請求にする（請求は断れない決まりのまま。抵抗はできる）。
    othello_claim: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        const result = othelloResultView(ctx.contract);
        if (!result) fail("failed-precondition", "請求できる罰金はありません。");
        const pending = pendingRequestList(ctx.contract);
        if (pending.length >= LIMITS.pendingRequests) fail("failed-precondition", "未払いの請求は3件までです。");
        messageRate(ctx);
        const requestId = randomHex(8);
        const amount = Math.min(result.penalty, LIMITS.requestMax);
        const note = "貢ぎオセロの罰金";
        setContract(ctx, {
          othelloResult: null,
          pendingRequests: {
            ...object(ctx.contract.pendingRequests),
            [requestId]: { amount, note, purpose: "penalty", othello: result.gameSeq, createdAt: ctx.now },
          },
        });
        pushEvent(ctx, { type: "request", actor: "manager", requestId, amount, note, purpose: "penalty", othello: result.gameSeq });
        markManagerActive(ctx);
        return { ok: true, requestId };
      },
    },
    set_work_orders: {
      roles: ["payer"],
      statuses: ["pending", "active"],
      write(ctx, _extra, data) {
        const allow = data?.allowWorkOrders === true;
        if ((ctx.contract.allowWorkOrders === true) === allow) return { ok: true, contract: view(ctx), unchanged: true };
        const order = openWorkOrder(ctx.contract);
        setContract(ctx, { allowWorkOrders: allow });
        pushEvent(ctx, { type: "work_orders_changed", actor: "payer", allowWorkOrders: allow });
        if (!allow && order) {
          setContract(ctx, { workOrder: null });
          pushEvent(ctx, { type: "work_withdrawn", actor: "system", orderSeq: order.orderSeq, reason: "setting" });
        }
        return { ok: true, contract: view(ctx) };
      },
    },
    // 出稼ぎ命令。管理人が「1on1を○回完走してこい」と命じる。Payは動かさず、期限もない。
    // 命令した時の財布の完走数は、財布だけが読める private/work に残す（管理人に通算を見せない）。
    work_order: {
      roles: ["manager"],
      statuses: ["active"],
      read: (transaction, ctx) => readPayerMatches(transaction, ctx),
      write(ctx, extra, data) {
        if (ctx.contract.allowWorkOrders !== true) fail("failed-precondition", "この契約では、出稼ぎ命令を出せません。");
        if (openWorkOrder(ctx.contract)) fail("failed-precondition", "出稼ぎ命令は1件ずつです。");
        const target = Number(data?.target);
        if (!WORK_ORDER_TARGETS.includes(target)) fail("invalid-argument", "回数を選び直してください。");
        const note = cleanLine(data?.note, LIMITS.requestNote);
        if (note) checkManagerText(ctx, note);
        messageRate(ctx);
        // 確認していない前の命令は、ここで確認なしに閉じる。
        const orderSeq = integer(ctx.contract.workOrderSeq, 0, Number.MAX_SAFE_INTEGER, 0) + 1;
        setContract(ctx, {
          workOrderSeq: orderSeq,
          workOrder: { orderSeq, target, note, issuedAt: ctx.now, reportedCount: 0, reportedAt: 0, doneAt: 0 },
        });
        ctx.extraWrites.push((transaction) => transaction.set(workRef(ctx.contractId), {
          contractId: ctx.contractId,
          payerUid: ctx.payerUid,
          orderSeq,
          baselineMatches: extra.matches,
          updatedAt: ctx.now,
        }));
        pushEvent(ctx, { type: "work_order", actor: "manager", orderSeq, target, ...(note ? { note } : {}) });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    work_withdraw: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx) {
        const order = openWorkOrder(ctx.contract);
        if (!order) fail("failed-precondition", "取り下げられる出稼ぎ命令はありません。");
        setContract(ctx, { workOrder: null });
        pushEvent(ctx, { type: "work_withdrawn", actor: "manager", orderSeq: order.orderSeq, reason: "withdrawn" });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
      },
    },
    // 出稼ぎの報告。完走数はサーバーが記入し、端末からは受け取らない。回数に届いた報告で、命令を果たしたことになる。
    // 残高報告と同じく、財布の発言には数えない（既読無視を始めない）。
    work_report: {
      roles: ["payer"],
      statuses: ["active"],
      read: (transaction, ctx) => readPayerMatches(transaction, ctx, { withBaseline: true }),
      write(ctx, extra) {
        const order = openWorkOrder(ctx.contract);
        if (!order) fail("failed-precondition", "報告できる出稼ぎ命令はありません。");
        const count = requireWorkCount(order, extra);
        messageRate(ctx);
        const done = count >= order.target;
        setContract(ctx, {
          workOrder: { ...ctx.contract.workOrder, reportedCount: count, reportedAt: ctx.now, ...(done ? { doneAt: ctx.now } : {}) },
          ...(done ? { workOrdersDone: integer(ctx.contract.workOrdersDone, 0, Number.MAX_SAFE_INTEGER, 0) + 1 } : {}),
        });
        pushEvent(ctx, { type: "work_report", actor: "payer", orderSeq: order.orderSeq, target: order.target, count, done });
        return { ok: true, count, done, contract: view(ctx) };
      },
    },
    // 果たした命令を、管理人が確かめる。受取印を1つ押し、ご褒美を1つ添えられる（受け取りと同じ一覧と置き換え）。
    work_confirm: {
      roles: ["manager"],
      statuses: ["active"],
      write(ctx, _extra, data) {
        const order = workOrderView(ctx.contract);
        if (!order?.done) fail("failed-precondition", "確認できる出稼ぎ報告はありません。");
        const { reward, rewardMarks } = contractReward(ctx, data);
        const card = ctx.profiles.manager.value.card;
        const seal = sealFor(data?.seal, { seals: card?.seals, ngWords: ctx.contract.ngWords });
        setContract(ctx, { workOrder: null });
        pushEvent(ctx, {
          type: "work_confirm",
          actor: "manager",
          orderSeq: order.orderSeq,
          target: order.target,
          count: order.reportedCount,
          seal,
          ...sealLook(card),
          ...rewardMarks,
        });
        // ご褒美の一言は返事なので、既読無視を終える。
        if (reward) setContract(ctx, { lastManagerReplySeq: ctx.seq, ignoredSince: 0 });
        markManagerActive(ctx);
        return { ok: true, contract: view(ctx) };
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
          // 性的な名目の願い出（許したものも）は、その場で消える。
          const plea = object(ctx.contract.plea);
          if (SEXUAL_PURPOSE_IDS.includes(String(plea.purpose || ""))) {
            setContract(ctx, { plea: null });
            pushEvent(ctx, { type: "plea_withdrawn", actor: "system", pleaSeq: integer(plea.pleaSeq, 0, Number.MAX_SAFE_INTEGER, 0), reason: "purpose" });
          }
          // 性的な言葉の復唱（果たして確認待ちのものも）は、その場で取り下げる。
          const order = reciteOrderView(ctx.contract);
          if (order && boardSexualWord(order.text)) {
            setContract(ctx, { reciteOrder: null });
            pushEvent(ctx, { type: "recite_withdrawn", actor: "system", orderSeq: order.orderSeq, reason: "purpose" });
          }
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
        // 言葉の献上（Pay 0）も、献上と同じく受取印とご褒美で受け取る。レシートはない。
        const words = event?.type === "word_offering";
        if (!event || (!words && (event.type !== "tribute" || !RECEIVABLE_KINDS.includes(event.kind)))) {
          fail("not-found", "受け取れる献上が見つかりません。");
        }
        if (integer(event.receivedAt, 0, Number.MAX_SAFE_INTEGER, 0) > 0) fail("failed-precondition", "この献上はもう受け取っています。");
        const { reward, rewardMarks } = contractReward(ctx, data);
        const seal = sealFor(data?.seal, { seals: ctx.profiles.manager.value.card?.seals, ngWords: ctx.contract.ngWords });
        const marks = { receivedAt: ctx.now, seal, ...sealLook(ctx.profiles.manager.value.card), ...rewardMarks };
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
          amount: words ? 0 : integer(event.amount, 0, Number.MAX_SAFE_INTEGER, 0),
          ...(words ? { words: true } : {}),
          seal,
          ...rewardMarks,
        });
        // ご褒美の一言は返事なので、既読無視を終える。
        if (reward) setContract(ctx, { lastManagerReplySeq: ctx.seq, ignoredSince: 0 });
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
          setContract(ctx, { readSeq: { ...readSeq, [ctx.role]: seq }, ...ignoreStart(ctx.contract, ctx.role, seq, ctx.now) });
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
    const returned = Math.min(amount, walletCreditCapacity(wallet));
    const pending = amount - returned;
    if (pending > 0) patchProfile(ctx, "payer", { refundPending: ctx.profiles.payer.value.refundPending + pending });
    if (returned > 0) creditPoints(wallet, returned);
    const groupId = anjuPayEntryId(key === "end" ? `tribute-escrow-end:${ctx.contractId}` : `tribute-escrow-return:${ctx.contractId}:${key}`);
    if (returned > 0) appendEntry(ctx, "payer", {
      entryId: groupId,
      groupId,
      kind: "tribute_escrow_return",
      labelKey: "anju_pay_tribute_escrow_return",
      delta: returned,
      nominalAmount: returned,
      balanceBefore: before,
      balanceAfter: wallet.balance,
      components: [{ kind: "escrow_return", labelKey: "anju_pay_tribute_escrow_return", status: "settled", delta: returned, nominalAmount: returned }],
      details: { mode: "tribute", role: "payer", counterpartyName: managerName(ctx) },
    });
    const escrow = integer(ctx.contract.escrowBalance, 0, Number.MAX_SAFE_INTEGER, 0) - amount;
    setContract(ctx, { escrowBalance: Math.max(0, escrow) });
    if (reason === "caps") pushEvent(ctx, { type: "escrow_returned", actor: "system", amount: returned, refundPending: pending, reason });
    return { returned, pending };
  }

  async function runNamedContractAction(uid, action, data, context = {}) {
    const spec = contractActions[action];
    return runContract(uid, data, {
      ...spec,
      read: spec.read ? (transaction, ctx) => spec.read(transaction, ctx, data) : null,
      write: (ctx, extra) => {
        ctx.context = context;
        return spec.write(ctx, extra, data);
      },
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
    let query = firestore.collection("tributeReceipts").doc(uid).collection("items").orderBy("createdAt", "desc").orderBy("__name__", "desc");
    if (data?.cursor) {
      const cursor = data.cursor;
      if (!Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 1 || !RECEIPT_ID_PATTERN.test(String(cursor.receiptId || ""))) {
        fail("invalid-argument", "レシートの続きを確認できません。一覧を開き直してください。");
      }
      query = query.startAfter(cursor.createdAt, cursor.receiptId);
    } else if (before > 0) query = query.where("createdAt", "<", before);
    const snapshot = await query.limit(LIMITS.receiptsPage + 1).get();
    const receipts = snapshot.docs.slice(0, LIMITS.receiptsPage).map((document) => {
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
        rewardText: storedRewardText(value),
        granted: value.granted === true,
        othello: integer(value.othello, 0, Number.MAX_SAFE_INTEGER, 0),
        resisted: integer(value.resisted, 0, LIMITS.resistsPerRequest, 0),
        seal: storedSeal(value.seal),
        ...sealLook(value),
        collarNo: integer(value.collarNo, 0, Number.MAX_SAFE_INTEGER, 0),
        pairCount: integer(value.pairCount, 0, Number.MAX_SAFE_INTEGER, 0),
        createdAt: integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
      };
    });
    const more = snapshot.docs.length > LIMITS.receiptsPage;
    const last = receipts.at(-1);
    return { ok: true, receipts, more, nextCursor: more && last ? { createdAt: last.createdAt, receiptId: last.receiptId } : null };
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
        seal: storedSeal(stored.seal),
        ...sealLook(stored),
        reward: typeof stored.reward === "string" && /^[a-z_]{1,24}$/.test(stored.reward) ? stored.reward : "",
        rewardText: storedRewardText(stored),
        granted: stored.granted === true,
        othello: integer(stored.othello, 0, Number.MAX_SAFE_INTEGER, 0),
        resisted: integer(stored.resisted, 0, LIMITS.resistsPerRequest, 0),
      }
      : null;
    return {
      receipt,
      ok: true,
      contractId,
      consent,
      manager: consent
        ? { personaName: card.personaName, disclosure: card.disclosure, styles: normalizeStyles(card.styles), sigil: card.sigil, avatar: card.avatar }
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

  // ───────────── 貢がれ総額の番付と、1〜5位の札 ─────────────
  // 当月に貢がれた額（手数料を引く前）の多い順。財布3人以上から貢がれた管理人だけ（別アカウントでの水増しを避ける）。
  // 順位は見る人のブロックで詰めない（掲示板の札と同じ順位にする）。
  async function grossRanking(monthKey) {
    const snapshot = await firestore.collection("tributeManagerMonths")
      .where("monthKey", "==", monthKey)
      .orderBy("receivedGross", "desc")
      .limit(LIMITS.grossRankingScan)
      .get();
    const candidates = snapshot.docs
      .map((document) => ({ uid: String(document.get("managerUid") || ""), value: object(document.data()) }))
      .filter((row) => row.uid
        && integer(row.value.payers, 0, Number.MAX_SAFE_INTEGER, 0) >= LIMITS.grossRankingMinPayers
        && integer(row.value.receivedGross, 0, Number.MAX_SAFE_INTEGER, 0) > 0)
      .slice(0, LIMITS.grossRankingLimit + 5);
    const profiles = await Promise.all(candidates.map((row) => profileRef(row.uid).get()));
    return candidates
      .map((row, index) => ({ ...row, profile: readProfile(profiles[index]) }))
      .filter((row) => row.profile.publicManagerId && !profileIsHidden(row.profile, monthKey))
      .slice(0, LIMITS.grossRankingLimit)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  const rankCacheRef = (monthKey) => firestore.collection("tributeRankCache").doc(`gross-${monthKey}`);

  async function saveRankBadges(monthKey, now, rows) {
    const top = rows.filter((row) => row.rank <= LIMITS.rankBadgeTop).map((row) => ({ managerUid: row.uid, rank: row.rank }));
    await rankCacheRef(monthKey).set({ monthKey, computedAt: now, top });
    return new Map(top.map((entry) => [entry.managerUid, entry.rank]));
  }

  // 掲示板と管理人の詳細の札。毎回数えると重いので、10分まで前の順位を使う（番付を開くと数え直す）。
  // 数えられない時（インデックスの作成中など）は札を出さず、掲示板は止めない。
  async function rankBadges(monthKey, now) {
    try {
      const cached = object((await rankCacheRef(monthKey).get()).data());
      if (cached.monthKey === monthKey && now - integer(cached.computedAt, 0, Number.MAX_SAFE_INTEGER, 0) < LIMITS.rankBadgeCacheMs) {
        return new Map((Array.isArray(cached.top) ? cached.top : [])
          .map((entry) => [String(object(entry).managerUid || ""), integer(object(entry).rank, 0, LIMITS.rankBadgeTop, 0)])
          .filter(([managerUid, rank]) => managerUid && rank > 0));
      }
      return await saveRankBadges(monthKey, now, await grossRanking(monthKey));
    } catch (error) {
      console.error("tribute rank badges failed", error);
      return new Map();
    }
  }

  async function grossRankingsAction(uid, monthKey, now) {
    const rows = await grossRanking(monthKey);
    await saveRankBadges(monthKey, now, rows).catch((error) => console.error("tribute rank badge cache failed", error));
    const managers = (await visibleRows(uid, rows)).map((row) => {
      const card = object(row.profile.card);
      return {
        rank: row.rank,
        publicManagerId: row.profile.publicManagerId,
        personaName: cleanLine(card.personaName || row.value.personaName, LIMITS.personaName) || "管理人",
        disclosure: String(card.disclosure || row.value.disclosure || "undisclosed"),
        sigil: integer(card.sigil ?? row.value.sigil, 0, 5, 0),
        avatar: normalizeAvatar(card.avatar ?? row.value.avatar),
        vault: vaultBadge(row.profile),
        payers: integer(row.value.payers, 0, Number.MAX_SAFE_INTEGER, 0),
        receivedGross: integer(row.value.receivedGross, 0, Number.MAX_SAFE_INTEGER, 0),
        // 10位以内の特典: X のプロフィール（カードの自己申告）と番付のひとこと。
        xHandle: X_HANDLE_PATTERN.test(String(card.xHandle || "")) ? card.xHandle : "",
        rankingWord: cleanLine(card.rankingWord, LIMITS.rankingWord),
        mine: row.uid === uid,
      };
    });
    return { ok: true, kind: "gross", monthKey, managers };
  }

  // ───────────── 応援欄 ─────────────
  // 管理人の詳細に、今月その管理人に貢いだ財布だけが書ける。今月の献上額の多い順に並ぶ（額は出さない）。
  // 管理人は「見たよ」の印を返し、隠せる。隠した応援は、管理人と書いた財布にだけ見える（その月のあいだ）。
  const CHEER_ID_PATTERN = /^[0-9a-f]{16}$/;

  function cheerState(pair, monthKey) {
    const text = pair.cheerMonthKey === monthKey ? cleanLine(pair.cheerText, LIMITS.cheer) : "";
    const at = text ? integer(pair.cheerAt, 0, Number.MAX_SAFE_INTEGER, 0) : 0;
    const seenAt = text ? integer(pair.cheerSeenAt, 0, Number.MAX_SAFE_INTEGER, 0) : 0;
    const hidden = Boolean(text) && pair.cheerHidden === monthKey;
    return { text, at, seenAt, seen: Boolean(text) && seenAt >= at, hidden, unseen: Boolean(text) && !hidden && seenAt < at };
  }

  async function cheerList(managerUid, monthKey, uid) {
    try {
      // 新しい順（書いた・書き直した時刻）。額の順にすると、額を出さなくても財布どうしの比較になるため（設計書15.1）。
      const cheers = () => firestore.collection("tributePairs").where("managerUid", "==", managerUid).where("cheerMonthKey", "==", monthKey);
      let docs;
      try {
        docs = (await cheers().orderBy("cheerAt", "desc").limit(LIMITS.cheersLimit).get()).docs;
      } catch (error) {
        // 新しいインデックスを作っている間は、前のインデックスで読み、ここで並べ替える。
        console.error("tribute cheers by time failed", error);
        docs = (await cheers().orderBy("monthTotal", "desc").limit(LIMITS.cheersLimit).get()).docs;
      }
      const rows = docs
        .map((document) => object(document.data()))
        .map((pair) => ({ uid: String(pair.payerUid || ""), pair, cheer: cheerState(pair, monthKey) }))
        .filter((row) => row.uid && row.cheer.text && CHEER_ID_PATTERN.test(String(row.pair.cheerId || "")))
        .filter((row) => !row.cheer.hidden || managerUid === uid || row.uid === uid)
        .sort((left, right) => right.cheer.at - left.cheer.at);
      return (await visibleRows(uid, rows)).map((row) => ({
        cheerId: row.pair.cheerId,
        walletName: normalizeWalletName(row.pair.walletName),
        text: row.cheer.text,
        at: row.cheer.at,
        seen: row.cheer.seen,
        hidden: row.cheer.hidden,
        mine: row.uid === uid,
      }));
    } catch (error) {
      console.error("tribute cheers failed", error);
      return [];
    }
  }

  // 詳細を開いた財布が、応援欄に書けるか。今月この管理人に貢いでいれば書ける。
  function myCheerView(pair, monthKey, now) {
    const cheer = cheerState(pair, monthKey);
    const usedToday = pair.cheerDayKey === jstDateKey(now) ? integer(pair.cheerDayCount, 0, 1_000, 0) : 0;
    return {
      canWrite: pair.monthKey === monthKey && integer(pair.monthTotal, 0, Number.MAX_SAFE_INTEGER, 0) > 0,
      text: cheer.text,
      hidden: cheer.hidden,
      leftToday: Math.max(0, LIMITS.cheersPerDay - usedToday),
    };
  }

  // 管理人のやることに出す「見たよ」待ちの数を、応援が変わった分だけ動かす。
  function cheerInboxPatch(managerProfile, monthKey, delta) {
    const current = managerProfile.cheerInbox.monthKey === monthKey ? managerProfile.cheerInbox.unseen : 0;
    return { cheerInbox: { monthKey, unseen: Math.max(0, current + delta) } };
  }

  async function setCheerAction(uid, data) {
    requireAge(await readOwnProfile(uid));
    const publicManagerId = requirePublicManagerId(data?.publicManagerId);
    const { uid: managerUid } = await findManagerByPublicId(publicManagerId);
    if (managerUid === uid) fail("failed-precondition", "自分の応援欄には書けません。");
    if (playerSafety && await playerSafety.isBlocked(uid, managerUid)) fail("not-found", "この管理人は見つかりません。");
    const normalized = normalizeCheer(data?.text);
    if (normalized.error) fail("invalid-argument", normalized.error);
    let cheer = null;
    await firestore.runTransaction(async (transaction) => {
      const now = currentTime();
      const monthKey = jstMonthKey(now);
      const dateKey = jstDateKey(now);
      const [pairSnapshot, managerSnapshot] = await Promise.all([
        transaction.get(pairRef(managerUid, uid)),
        transaction.get(profileRef(managerUid)),
      ]);
      const pair = pairSnapshot.exists ? object(pairSnapshot.data()) : {};
      if (pair.monthKey !== monthKey || integer(pair.monthTotal, 0, Number.MAX_SAFE_INTEGER, 0) <= 0) {
        fail("failed-precondition", "応援欄に書けるのは、今月この管理人に貢いだ財布だけです。");
      }
      const before = cheerState(pair, monthKey);
      const usedToday = pair.cheerDayKey === dateKey ? integer(pair.cheerDayCount, 0, 1_000, 0) : 0;
      let patch;
      if (!normalized.text) {
        patch = { cheerMonthKey: "", cheerText: "", cheerAt: 0, cheerSeenAt: 0 };
      } else {
        if (usedToday >= LIMITS.cheersPerDay) fail("resource-exhausted", `応援は1日${LIMITS.cheersPerDay}回まで書けます。日本時間の0時に戻ります。`);
        patch = {
          cheerId: CHEER_ID_PATTERN.test(String(pair.cheerId || "")) ? pair.cheerId : randomHex(8),
          cheerMonthKey: monthKey,
          cheerText: normalized.text,
          cheerAt: now,
          // 書き直した応援は、もう一度「見たよ」を待つ。
          cheerSeenAt: 0,
          cheerDayKey: dateKey,
          cheerDayCount: usedToday + 1,
        };
      }
      const after = cheerState({ ...pair, ...patch }, monthKey);
      const delta = Number(after.unseen) - Number(before.unseen);
      transaction.set(pairRef(managerUid, uid), { ...patch, updatedAt: now }, { merge: true });
      if (delta) transaction.set(profileRef(managerUid), cheerInboxPatch(readProfile(managerSnapshot), monthKey, delta), { merge: true });
      cheer = { text: after.text, hidden: after.hidden, leftToday: Math.max(0, LIMITS.cheersPerDay - (patch.cheerDayCount ?? usedToday)) };
    });
    return { ok: true, cheer };
  }

  // 管理人の操作: 「見たよ」・隠す・戻す。応援は cheerId で選ぶ（財布の UID は返さない）。
  async function markCheerAction(uid, data, operation) {
    requireAge(await readOwnProfile(uid));
    const cheerId = String(data?.cheerId || "");
    if (!CHEER_ID_PATTERN.test(cheerId)) fail("invalid-argument", "応援を選び直してください。");
    const found = await firestore.collection("tributePairs")
      .where("managerUid", "==", uid)
      .where("cheerId", "==", cheerId)
      .limit(1)
      .get();
    if (found.empty) fail("not-found", "この応援は見つかりません。");
    const reference = found.docs[0].ref;
    let unseen = 0;
    await firestore.runTransaction(async (transaction) => {
      const now = currentTime();
      const monthKey = jstMonthKey(now);
      const [pairSnapshot, managerSnapshot] = await Promise.all([transaction.get(reference), transaction.get(profileRef(uid))]);
      const pair = pairSnapshot.exists ? object(pairSnapshot.data()) : {};
      const before = cheerState(pair, monthKey);
      if (pair.managerUid !== uid || pair.cheerId !== cheerId || !before.text) fail("not-found", "この応援は見つかりません。");
      const patch = operation === "seen"
        ? { cheerSeenAt: Math.max(now, before.at) }
        : { cheerHidden: operation === "hide" ? monthKey : "" };
      const after = cheerState({ ...pair, ...patch }, monthKey);
      const managerProfile = readProfile(managerSnapshot);
      const inbox = cheerInboxPatch(managerProfile, monthKey, Number(after.unseen) - Number(before.unseen));
      transaction.set(reference, patch, { merge: true });
      // 「見たよ」は管理人の返事なので、掲示板の並び（最後に動いた時）にも数える。
      transaction.set(profileRef(uid), { ...inbox, ...(operation === "seen" ? { lastActiveAt: now } : {}) }, { merge: true });
      unseen = inbox.cheerInbox.unseen;
    });
    return { ok: true, cheersUnseen: unseen };
  }

  async function rankingsAction(uid, data) {
    requireAge(await readOwnProfile(uid));
    const now = currentTime();
    const monthKey = jstMonthKey(now);
    if (data?.kind === "gross") return grossRankingsAction(uid, monthKey, now);
    // 番付加算（同じ組で1日500 Payまで）の多い順、同じなら財布の人数。毎日満額を貢ぐ財布を多く抱える管理人が上に来る。
    const snapshot = await firestore.collection("tributeManagerMonths")
      .where("monthKey", "==", monthKey)
      .orderBy("rankScore", "desc")
      .orderBy("payers", "desc")
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
        vault: vaultBadge(row.profile),
        payers: integer(row.value.payers, 0, Number.MAX_SAFE_INTEGER, 0),
        rankScore: integer(row.value.rankScore, 0, Number.MAX_SAFE_INTEGER, 0),
        mine: row.uid === uid,
      }));
    let managerBoard = null;
    if (data?.publicManagerId) {
      const { uid: managerUid } = await findManagerByPublicId(requirePublicManagerId(data.publicManagerId));
      managerBoard = await managerRanking(managerUid, monthKey, uid);
    }
    return { ok: true, kind: "score", monthKey, managers: visible, managerBoard };
  }

  // ───────────── 金庫 ─────────────
  // 牧場基金（上納・称号・推薦・方針の投票・手数料の補填）は終わり、管理人ごとの金庫に置き換えた。
  // 金庫の Pay は本人のもののままで、いつでも出し入れできる。外に見せるのは段階だけ（額は本人だけ）。

  function ownVaultView(profile) {
    return {
      qualified: profile.vaultQualifiedAt > 0,
      amount: profile.vaultAmount,
      tier: profile.vaultTier,
      bestTier: profile.vaultBestTier,
    };
  }

  // お貢ぎ牧場の組ごとの累計から、金庫を作れるかを数える（推し値市場の実績は数えない）。
  async function readVaultQualification(uid, transaction = null) {
    const query = firestore.collection("tributePairs").where("managerUid", "==", uid);
    const snapshot = transaction ? await transaction.get(query) : await query.get();
    return vaultQualification(snapshot.docs.map((document) => object(document.data())));
  }

  // 自分の金庫と金庫番付（読むだけ）。番付は段階の高い順、同じ段階なら先に届いた順。額は出さない。
  async function vaultAction(uid) {
    const profile = await readOwnProfile(uid);
    requireAge(profile);
    const now = currentTime();
    const monthKey = jstMonthKey(now);
    const hasCard = Boolean(profile.card);
    const progress = hasCard && !profile.vaultQualifiedAt ? await readVaultQualification(uid) : null;
    const snapshot = await firestore.collection("tributeProfiles")
      .where("vaultTier", ">=", 1)
      .orderBy("vaultTier", "desc")
      .orderBy("vaultTierAt", "asc")
      .limit(LIMITS.vaultRankingLimit * 2)
      .get();
    const rows = snapshot.docs
      .map((document) => ({ uid: document.id, profile: readProfile(document) }))
      .filter((row) => row.profile.vaultQualifiedAt > 0 && row.profile.publicManagerId && row.profile.card && !profileIsHidden(row.profile, monthKey));
    const ranking = (await visibleRows(uid, rows))
      .slice(0, LIMITS.vaultRankingLimit)
      .map((row, index) => ({
        rank: index + 1,
        publicManagerId: row.profile.publicManagerId,
        personaName: cleanLine(row.profile.card?.personaName, LIMITS.personaName) || "管理人",
        disclosure: String(row.profile.card?.disclosure || "undisclosed"),
        sigil: integer(row.profile.card?.sigil, 0, 5, 0),
        avatar: normalizeAvatar(row.profile.card?.avatar),
        vault: vaultBadge(row.profile),
        mine: row.uid === uid,
      }));
    return {
      ok: true,
      vault: {
        hasCard,
        ...ownVaultView(profile),
        // まだ金庫を作っていない管理人には、条件までの道のりを返す（満たしていれば、最初に入れた時に金庫ができる）。
        ...(progress ? {
          qualified: progress.qualified,
          progress: { payers: progress.payers, received: progress.received, needPayers: LIMITS.vaultQualifyPayers, needReceived: LIMITS.vaultQualifyReceived },
        } : {}),
      },
      ranking,
    };
  }

  async function vaultMoveAction(uid, data, direction) {
    const deposit = direction === "deposit";
    const amount = requireAmount(data?.amount);
    const clientRequestId = requireClientRequestId(data?.clientRequestId);
    const operationRef = profileRef(uid).collection("vaultOps").doc(hashId(clientRequestId));
    await ensureWallet(uid);
    let result = null;
    let balance = null;
    await firestore.runTransaction(async (transaction) => {
      result = null;
      balance = null;
      const now = currentTime();
      const [profileSnapshot, walletSnapshot, ledgerConfigSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(walletRef(uid)),
        transaction.get(anjuPayLedgerConfigRef()),
        transaction.get(operationRef),
      ]);
      const profile = readProfile(profileSnapshot);
      requireAge(profile);
      if (!profile.card) fail("failed-precondition", "金庫は、管理人カードのある管理人だけが使えます。");
      const opKey = `vault:${direction}:${clientRequestId}`;
      if (operationSnapshot.exists && (operationSnapshot.get("direction") !== direction || operationSnapshot.get("amount") !== amount)) {
        fail("invalid-argument", "同じ入出金の内容は変更できません。結果を確認してから新しく操作してください。");
      }
      if (operationSnapshot.exists || profile.vaultRecentOps.includes(opKey)) {
        result = { ok: true, replayed: true, vault: ownVaultView(profile), walletBalance: walletData(walletSnapshot).balance };
        return;
      }
      let qualifiedAt = profile.vaultQualifiedAt;
      if (!qualifiedAt) {
        if (!deposit) fail("failed-precondition", "まだ金庫がありません。");
        // 金庫を作れるかは、最初に入れる時に一度だけ確かめる。一度満たせば、ずっと使える。
        const qualification = await readVaultQualification(uid, transaction);
        if (!qualification.qualified) {
          fail("failed-precondition", `金庫を作れるのは、お貢ぎ牧場で累計${LIMITS.vaultQualifyPayers}人以上の財布から、合わせて${LIMITS.vaultQualifyReceived.toLocaleString("ja-JP")} Pay以上を受け取った管理人だけです。`);
        }
        qualifiedAt = now;
      }
      const wallet = walletData(walletSnapshot);
      if (deposit && wallet.balance < amount) fail("failed-precondition", "AnjuPay残高が足りません。");
      if (!deposit && profile.vaultAmount < amount) fail("failed-precondition", "金庫の残りが足りません。");
      if (!deposit && walletCreditCapacity(wallet) < amount) fail("failed-precondition", "AnjuPay残高が上限に近いため、金庫から出せません。");
      stageAnjuPayOpening(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, now);
      const before = wallet.balance;
      if (deposit) debitPoints(wallet, amount);
      else creditPoints(wallet, amount);
      const kind = deposit ? "tribute_vault_deposit" : "tribute_vault_withdraw";
      const labelKey = deposit ? "anju_pay_tribute_vault_deposit" : "anju_pay_tribute_vault_withdraw";
      const status = deposit ? "held" : "settled";
      const delta = deposit ? -amount : amount;
      const groupId = anjuPayEntryId(`tribute-vault:${uid}:${direction}:${clientRequestId}`);
      appendAnjuPayEntry(transaction, walletRef(uid), wallet, ledgerConfigSnapshot, {
        entryId: groupId,
        groupId,
        kind,
        category: "tribute",
        labelKey,
        status,
        delta,
        nominalAmount: amount,
        balanceBefore: before,
        balanceAfter: wallet.balance,
        components: [{ kind: deposit ? "vault_deposit" : "vault_withdraw", labelKey, status, delta, nominalAmount: amount }],
        details: { mode: "tribute", role: "manager" },
        occurredAt: now,
      });
      transaction.set(walletRef(uid), { ...wallet, ...anjuPayWalletMetadataPatch(wallet), updatedAt: now }, { merge: true });
      const vaultAmount = profile.vaultAmount + (deposit ? amount : -amount);
      const tier = vaultTierFor(vaultAmount);
      const patch = {
        vaultAmount,
        vaultTier: tier,
        // 同じ段階の中の番付の順（その段階に届いた時刻）。段階が変わった時だけ書き換える。
        vaultTierAt: tier !== profile.vaultTier || !profile.vaultTierAt ? now : profile.vaultTierAt,
        vaultBestTier: Math.max(profile.vaultBestTier, tier),
        vaultQualifiedAt: qualifiedAt,
        vaultRecentOps: [...profile.vaultRecentOps.slice(-(LIMITS.vaultRecentOps - 1)), opKey],
        updatedAt: now,
      };
      transaction.set(profileRef(uid), patch, { merge: true });
      transaction.create(operationRef, { direction, amount, createdAt: now });
      balance = wallet.balance;
      result = {
        ok: true,
        vault: ownVaultView({ ...profile, ...patch }),
        walletBalance: wallet.balance,
        ...(patch.vaultBestTier > profile.vaultBestTier ? { reachedTier: patch.vaultBestTier } : {}),
      };
    });
    if (balance !== null) await mirrorTouched([{ uid, balance }]);
    return result;
  }

  async function claimRefundAction(uid) {
    await ensureWallet(uid);
    let result;
    await firestore.runTransaction(async (transaction) => {
      const now = currentTime();
      const [profileSnapshot, walletSnapshot, ledgerConfig] = await Promise.all([
        transaction.get(profileRef(uid)), transaction.get(walletRef(uid)), transaction.get(anjuPayLedgerConfigRef()),
      ]);
      const profile = readProfile(profileSnapshot);
      requireAge(profile);
      const wallet = walletData(walletSnapshot);
      const amount = Math.min(profile.refundPending, walletCreditCapacity(wallet));
      // 運営からの返金は、管理口座の返金を受け取ったあとの残高上限の空きの分だけ。
      const operatorAmount = Math.min(profile.operatorRefundPending, Math.max(0, walletCreditCapacity(wallet) - amount));
      if (amount > 0 || operatorAmount > 0) stageAnjuPayOpening(transaction, walletRef(uid), wallet, ledgerConfig, now);
      if (amount > 0) {
        const before = wallet.balance;
        creditPoints(wallet, amount);
        const claimCount = profile.refundClaimCount + 1;
        const groupId = anjuPayEntryId(`tribute-refund-claim:${uid}:${claimCount}`);
        appendAnjuPayEntry(transaction, walletRef(uid), wallet, ledgerConfig, {
          entryId: groupId, groupId, kind: "tribute_escrow_return", category: "tribute",
          labelKey: "anju_pay_tribute_escrow_return", status: "settled", delta: amount, nominalAmount: amount,
          balanceBefore: before, balanceAfter: wallet.balance,
          components: [{ kind: "escrow_return", labelKey: "anju_pay_tribute_escrow_return", status: "settled", delta: amount, nominalAmount: amount }],
          details: { mode: "tribute", role: "payer" }, occurredAt: now,
        });
        profile.refundPending -= amount;
        profile.refundClaimCount = claimCount;
      }
      // 運営からの返金は、利用履歴に別の種類（運営からの返金）で残す。
      if (operatorAmount > 0) {
        const before = wallet.balance;
        creditPoints(wallet, operatorAmount);
        const claimCount = profile.operatorRefundClaimCount + 1;
        const groupId = anjuPayEntryId(`tribute-operator-refund-claim:${uid}:${claimCount}`);
        appendAnjuPayEntry(transaction, walletRef(uid), wallet, ledgerConfig, {
          entryId: groupId, groupId, kind: "tribute_operator_refund", category: "tribute",
          labelKey: "anju_pay_tribute_operator_refund", status: "settled", delta: operatorAmount, nominalAmount: operatorAmount,
          balanceBefore: before, balanceAfter: wallet.balance,
          components: [{ kind: "operator_refund", labelKey: "anju_pay_tribute_operator_refund", status: "settled", delta: operatorAmount, nominalAmount: operatorAmount }],
          details: { mode: "tribute", role: "payer", reason: "double_payment" }, occurredAt: now,
        });
        profile.operatorRefundPending -= operatorAmount;
        profile.operatorRefundClaimCount = claimCount;
      }
      if (amount > 0 || operatorAmount > 0) {
        transaction.set(walletRef(uid), { ...wallet, ...anjuPayWalletMetadataPatch(wallet), updatedAt: now }, { merge: true });
        transaction.set(profileRef(uid), {
          refundPending: profile.refundPending,
          refundClaimCount: profile.refundClaimCount,
          operatorRefundPending: profile.operatorRefundPending,
          operatorRefundClaimCount: profile.operatorRefundClaimCount,
          updatedAt: now,
        }, { merge: true });
      }
      result = { ok: true, amount: amount + operatorAmount, escrowAmount: amount, operatorAmount, walletBalance: wallet.balance, profile: ownProfileView(profile, jstMonthKey(now), now) };
    });
    if (result.amount > 0) await mirrorTouched([{ uid, balance: result.walletBalance }]);
    return result;
  }

  // 出稼ぎの進み具合。財布にだけ、その場で読み直して返す。読むだけで、何も書かない。
  // 管理人には返さない（管理人に見えるのは、財布が報告した数だけ）。
  async function workProgressAction(uid, data) {
    const contractId = requireContractId(data?.contractId);
    requireWorkCounting();
    const [contractSnapshot, profileSnapshot] = await Promise.all([
      contractRef(contractId).get(),
      profileRef(uid).get(),
    ]);
    if (!contractSnapshot.exists) fail("not-found", "契約が見つかりません。");
    const contract = object(contractSnapshot.data());
    if (contract.payerUid !== uid) fail("permission-denied", "この操作はできません。");
    requireAge(readProfile(profileSnapshot));
    const now = currentTime();
    const live = contract.status === "active" && integer(contract.expiresAt, 0, Number.MAX_SAFE_INTEGER, 0) > now;
    const order = live ? openWorkOrder(contract) : null;
    if (!order) return { ok: true, contractId, workOrder: null, count: 0 };
    const [workSnapshot, progressSnapshot] = await Promise.all([
      workRef(contractId).get(),
      economyProgressRef(uid).get(),
    ]);
    const count = workCount(order, workSnapshot.exists ? object(workSnapshot.data()) : null, matchesOf(progressSnapshot));
    if (count === null) fail("failed-precondition", "出稼ぎ命令を確認できません。開き直してください。");
    return { ok: true, contractId, workOrder: order, count };
  }

  async function performAction(uidValue, dataValue, context = {}) {
    const uid = String(uidValue || "");
    if (!uid) fail("unauthenticated", "ログインが必要です。");
    const data = object(dataValue);
    const action = String(data.action || "");
    if (RETIRED_FUND_ACTIONS.includes(action)) {
      fail("failed-precondition", "牧場基金は終わり、管理人の金庫に変わりました。画面を読み込み直してください。");
    }
    if (!TRIBUTE_ACTIONS.includes(action)) fail("invalid-argument", "操作を確認できません。");
    switch (action) {
      case "state": return stateAction(uid);
      case "age_confirm": return ageConfirmAction(uid, data);
      case "save_profile": return saveProfileAction(uid, data);
      case "decorations": return decorationsAction(uid);
      case "board": return boardAction(uid, data);
      case "manager": return managerAction(uid, data);
      case "apply": return applyAction(uid, data, context);
      case "set_declaration": return setDeclarationAction(uid, data);
      case "receipts": return receiptsAction(uid, data);
      case "share_info": return shareInfoAction(uid, data);
      case "set_word": return setWordAction(uid, data);
      case "set_own_words": return setOwnWordsAction(uid, data);
      case "ledger": return ledgerAction(uid);
      case "rankings": return rankingsAction(uid, data);
      case "set_cheer": return setCheerAction(uid, data);
      case "cheer_seen": return markCheerAction(uid, data, "seen");
      case "cheer_hide": return markCheerAction(uid, data, "hide");
      case "cheer_show": return markCheerAction(uid, data, "show");
      case "vault": return vaultAction(uid);
      case "vault_deposit": return vaultMoveAction(uid, data, "deposit");
      case "vault_withdraw": return vaultMoveAction(uid, data, "withdraw");
      case "claim_refund": return claimRefundAction(uid);
      case "work_progress": return workProgressAction(uid, data);
      default: return runNamedContractAction(uid, action, data, context);
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
  RETIRED_FUND_ACTIONS,
  createTributeService,
  viewContract,
};
