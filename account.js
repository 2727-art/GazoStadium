import {
  GoogleAuthProvider,
  browserLocalPersistence,
  linkWithPopup,
  onIdTokenChanged,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v2";
import {
  ANJU_PAY_UNIT,
  formatAnjuPay,
  formatAnjuPayNumber,
} from "./anju-pay-format.mjs?v=anju-pay-format-v1";

const appRoot = document.querySelector("#app");
const economyActionCallable = httpsCallable(functions, "economyAction");
const accountTransferCallable = httpsCallable(functions, "accountTransfer", {
  limitedUseAppCheckTokens: true,
});
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
const TRANSFER_SESSION_KEY = "hariaiActiveTransferCodeV1";
const ANJU_PAY_HISTORY_PAGE_SIZE = 20;
const ANJU_PAY_MAX_BALANCE = 999_999;
const ANJU_PAY_CATEGORIES = new Set(["opening", "earn", "spend", "market", "tip"]);
const ANJU_PAY_STATUSES = new Set(["posted", "held", "settled", "refunded", "partial", "capped"]);
const ANJU_PAY_LABELS = Object.freeze({
  opening: "AnjuPay開始残高",
  opening_balance: "AnjuPay開始残高",
  anju_pay_opening: "AnjuPay開始残高",
  daily_mission: "デイリーミッション報酬",
  daily_reward: "デイリーミッション報酬",
  daily_play: "デイリープレイ報酬",
  daily_play_reward: "デイリープレイ報酬",
  period_reward: "期間戦績報酬",
  period_rewards: "期間戦績報酬",
  shop_purchase: "AnjuPayストアで購入",
  purchase: "AnjuPayストアで購入",
  patron_upgrade: "VALUE MARKET パトロン支援",
  patronage: "VALUE MARKET パトロン支援",
  post_match_tip_sent: "対戦後の応援",
  post_match_tip_received: "対戦後に受けた応援",
  tip_sent: "対戦後の応援",
  tip_received: "対戦後に受けた応援",
  market_sale: "推し値市場で販売",
  market_purchase: "推し値市場で購入",
  market_hold: "推し値市場でお預かり",
  market_settlement: "推し値市場の取引成立",
  market_refund: "推し値市場から返却",
  market_cancel: "推し値市場の取引取消",
});
const ANJU_PAY_STATUS_LABELS = Object.freeze({
  posted: "反映済み",
  held: "保留開始",
  settled: "成立",
  refunded: "返還済み",
  partial: "一部反映",
  capped: "上限精算",
});

const PATRON_TIERS = Object.freeze([
  Object.freeze({ level: 0, id: "guest", label: "MARKET GUEST", threshold: 0, icon: "◇" }),
  Object.freeze({ level: 1, id: "supporter", label: "SUPPORTER", threshold: 300, icon: "✦" }),
  Object.freeze({ level: 2, id: "patron", label: "PATRON", threshold: 1_500, icon: "◆" }),
  Object.freeze({ level: 3, id: "grand_patron", label: "GRAND PATRON", threshold: 5_000, icon: "♛" }),
]);
const useAccountPreview = useOfflineMarketPreview;
const previewKind = new URLSearchParams(location.search).get("accountPreview") || "guest";

let active = false;
let countdownTimer = null;
let unsubscribeAuth = null;
let state = createState();

function createState() {
  return {
    loading: true,
    busyAction: "",
    user: null,
    balance: 0,
    patron: normalizePatronage(null),
    historyAvailable: null,
    historyEntries: [],
    historyStartedAt: 0,
    historyNextCursor: null,
    historyHasMore: false,
    historyLoading: false,
    historyError: "",
    historyRequestId: 0,
    pendingGoogleCredential: null,
    transferCode: "",
    transferExpiresAt: 0,
    notice: "",
    error: "",
  };
}

function shared() {
  return window.HariaiApp?.shared;
}

function escapeHtml(value) {
  const appEscape = shared()?.escapeHtml;
  if (typeof appEscape === "function") return appEscape(value);
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showToast(message) {
  shared()?.showToast(message);
}

function finiteInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function timestampMillis(value) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const seconds = finiteInteger(value.seconds ?? value._seconds, null);
    if (seconds !== null) {
      const millis = seconds * 1000;
      return millis > 0 && millis <= 8_640_000_000_000_000 ? millis : 0;
    }
    if (typeof value.toMillis === "function") {
      const millis = finiteInteger(value.toMillis(), 0);
      return millis > 0 && millis <= 8_640_000_000_000_000 ? millis : 0;
    }
  }
  const number = finiteInteger(value, 0);
  if (number <= 0) return 0;
  const millis = number < 100_000_000_000 ? number * 1000 : number;
  return millis <= 8_640_000_000_000_000 ? millis : 0;
}

function formatHistoryTime(value, { dateOnly = false } = {}) {
  const millis = timestampMillis(value);
  if (!millis) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(new Date(millis));
}

function historyDateTime(value) {
  const millis = timestampMillis(value);
  return millis ? new Date(millis).toISOString() : "";
}

function normalizeHistoryEntry(value, index = 0) {
  const source = value && typeof value === "object" ? value : {};
  const categoryValue = String(source.category || "").toLowerCase();
  const statusValue = String(source.status || "").toLowerCase();
  const sequence = Math.max(0, finiteInteger(source.sequence, 0));
  const delta = Math.max(-ANJU_PAY_MAX_BALANCE, Math.min(ANJU_PAY_MAX_BALANCE, finiteInteger(source.delta, 0)));
  const openingBalance = Math.max(0, Math.min(ANJU_PAY_MAX_BALANCE, finiteInteger(source.openingBalance, 0)));
  const balanceAfterValue = finiteInteger(source.balanceAfter, null);
  return {
    key: String(source.id || source.entryId || `${sequence}-${index}`).slice(0, 100),
    sequence,
    category: ANJU_PAY_CATEGORIES.has(categoryValue) ? categoryValue : "other",
    status: ANJU_PAY_STATUSES.has(statusValue) ? statusValue : "posted",
    labelKey: String(source.labelKey || source.kind || source.type || "").slice(0, 80),
    label: String(source.label || "").slice(0, 80),
    detail: typeof source.detail === "string" ? source.detail.slice(0, 240) : "",
    details: source.details && typeof source.details === "object" && !Array.isArray(source.details)
      ? {
        productId: String(source.details.productId || "").slice(0, 80),
        missionId: String(source.details.missionId || "").slice(0, 80),
        dateKey: String(source.details.dateKey || "").slice(0, 16),
        periods: (Array.isArray(source.details.periods) ? source.details.periods : [])
          .map((period) => {
            if (typeof period === "string") {
              return { period: period.slice(0, 16), key: "", nominalAmount: null };
            }
            if (!period || typeof period !== "object") return null;
            const nominalAmount = finiteInteger(period.nominalAmount, null);
            return {
              period: String(period.period || "").slice(0, 16),
              key: String(period.key || "").slice(0, 16),
              nominalAmount: nominalAmount === null
                ? null
                : Math.max(0, Math.min(ANJU_PAY_MAX_BALANCE, nominalAmount)),
            };
          })
          .filter((period) => period?.period)
          .slice(0, 50),
        tierIds: (Array.isArray(source.details.tierIds) ? source.details.tierIds : [])
          .map((tierId) => String(tierId || "").slice(0, 40)).slice(0, 100),
        dailyPlayClaims: (Array.isArray(source.details.dailyPlayClaims)
          ? source.details.dailyPlayClaims
          : [])
          .map((claim) => {
            if (!claim || typeof claim !== "object") return null;
            const credited = finiteInteger(claim.credited, 0);
            const nominalAmount = finiteInteger(claim.nominalAmount, 0);
            return {
              dateKey: String(claim.dateKey || "").slice(0, 16),
              tierId: String(claim.tierId || "").slice(0, 40),
              credited: Math.max(0, Math.min(ANJU_PAY_MAX_BALANCE, credited)),
              nominalAmount: Math.max(0, Math.min(ANJU_PAY_MAX_BALANCE, nominalAmount)),
              status: ANJU_PAY_STATUSES.has(String(claim.status || "").toLowerCase())
                ? String(claim.status).toLowerCase()
                : "posted",
            };
          })
          .filter((claim) => claim?.dateKey && claim?.tierId)
          .slice(0, 100),
        targetTier: finiteInteger(source.details.targetTier, null),
        mode: String(source.details.mode || "").slice(0, 24),
        role: String(source.details.role || "").slice(0, 24),
        counterpartyName: String(source.details.counterpartyName || "").slice(0, 40),
        publicSellerId: String(source.details.publicSellerId || "").slice(0, 40),
        listingTitle: String(source.details.listingTitle || "").slice(0, 80),
      }
      : {},
    delta,
    openingBalance,
    balanceAfter: balanceAfterValue === null ? null : Math.max(0, Math.min(ANJU_PAY_MAX_BALANCE, balanceAfterValue)),
    occurredAt: timestampMillis(source.occurredAt || source.createdAt || source.timestamp),
  };
}

function historyDetail(entry) {
  if (entry.detail) return entry.detail;
  const details = entry.details || {};
  const parts = [];
  if (details.productId) {
    const productLabel = window.HariaiOnline?.getShopProductLabel?.(details.productId);
    parts.push(productLabel ? `商品「${productLabel}」` : "AnjuPayストアの商品");
  }
  if (details.missionId) parts.push("デイリーミッション達成");
  if (details.dailyPlayClaims?.length) {
    const dates = [...new Set(details.dailyPlayClaims.map((claim) => claim.dateKey))];
    parts.push(`${details.dailyPlayClaims.length}段階分${dates.length > 1 ? `（${dates.length}日分）` : ""}`);
  } else if (details.tierIds?.length) {
    parts.push(`${details.tierIds.length}段階分`);
  }
  if (details.periods?.length) {
    const periodLabels = { daily: "デイリー", weekly: "ウィークリー", monthly: "マンスリー" };
    const labels = details.periods
      .map((period) => {
        const label = periodLabels[period.period] || "";
        if (!label) return "";
        const key = period.key ? ` ${period.key}` : "";
        const amount = Number(period.nominalAmount) > 0
          ? ` ${formatAnjuPay(period.nominalAmount)}`
          : "";
        return `${label}${key}${amount}`;
      })
      .filter(Boolean);
    if (labels.length) {
      const visible = labels.slice(0, 3);
      const rest = labels.length > visible.length ? `ほか${labels.length - visible.length}件` : "";
      parts.push(`${visible.join("・")}${rest}の戦績報酬`);
    }
  }
  if (details.targetTier !== null && details.targetTier !== undefined) {
    parts.push(`${tierForLevel(details.targetTier).label}へ昇格`);
  }
  if (details.listingTitle) parts.push(`「${details.listingTitle}」`);
  if (details.counterpartyName) parts.push(`相手: ${details.counterpartyName}`);
  if (details.role === "seller") parts.push("販売側");
  if (details.role === "buyer") parts.push("購入側");
  if (details.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(details.dateKey)) parts.push(details.dateKey);
  if (parts.length) return parts.join(" / ");
  if (entry.category === "opening") return "この残高からAnjuPay利用履歴の記録を開始しました。";
  if (entry.status === "capped") return "所持上限に合わせて精算されました。";
  return "";
}

function historyLabel(entry) {
  const key = String(entry.labelKey || "").trim().toLowerCase().replace(/[.\-\s]+/g, "_");
  if (ANJU_PAY_LABELS[key]) return ANJU_PAY_LABELS[key];
  if (key.includes("opening")) return ANJU_PAY_LABELS.opening;
  if (key.includes("daily_play")) return ANJU_PAY_LABELS.daily_play;
  if (key.includes("daily") || key.includes("mission")) return ANJU_PAY_LABELS.daily_mission;
  if (key.includes("period")) return ANJU_PAY_LABELS.period_reward;
  if (key.includes("patron")) return ANJU_PAY_LABELS.patron_upgrade;
  if (!key.includes("market") && (key.includes("purchase") || key.includes("shop"))) {
    return ANJU_PAY_LABELS.shop_purchase;
  }
  if (key.includes("tip") && entry.delta < 0) return ANJU_PAY_LABELS.tip_sent;
  if (key.includes("tip")) return ANJU_PAY_LABELS.tip_received;
  if (key.includes("entry_fee_hold") || key.includes("market_accept_pitch")) {
    return "推し値市場の着手料を保留";
  }
  if (key.includes("extension_hold") || key.includes("market_offer_extension")) {
    return "追加営業の内金を保留";
  }
  if (key.includes("entry_fee_refund")) return "推し値市場の着手料を返還";
  if (key.includes("extension_refund") || key.includes("market_decline_extension")) {
    return "追加営業の内金を返還";
  }
  if (key.includes("entry_fee_settlement")) {
    return entry.details?.role === "buyer"
      ? "推し値市場の着手料を支払確定"
      : "推し値市場の着手料を受取";
  }
  if (key.includes("entry_fee_compensation")) {
    return entry.details?.role === "buyer"
      ? "取引取消の着手料を支払確定"
      : "取引取消の着手料を受取";
  }
  if (key.includes("market_pitch_complete")) {
    if (entry.details?.role === "buyer") {
      return entry.delta > 0
        ? "推し値市場の着手料を精算・一部返還"
        : "推し値市場の着手料を支払確定";
    }
    return entry.delta > 0
      ? "推し値市場の着手料を受取"
      : "推し値市場の着手料を精算";
  }
  if (key.includes("extension_incentive") || key.includes("market_accept_extension")) {
    return entry.delta > 0 ? "追加営業の内金を受取" : "追加営業の内金を支払確定";
  }
  if (key.includes("market_cancel")) {
    if (entry.status === "refunded") return "推し値市場からAnjuPayを返還";
    if (entry.status === "settled") return "推し値市場の支払を確定";
    return "推し値市場の取引終了精算";
  }
  if (key.includes("market_buy")) {
    return entry.details?.role === "seller"
      ? ANJU_PAY_LABELS.market_sale
      : ANJU_PAY_LABELS.market_purchase;
  }
  if (key.includes("refund") || key.includes("cancel")) return ANJU_PAY_LABELS.market_refund;
  if (key.includes("market") && entry.status === "held") return "推し値市場でAnjuPayを保留";
  if (key.includes("market") && entry.status === "refunded") return "推し値市場からAnjuPayを返還";
  if (key.includes("market") && entry.delta < 0) return ANJU_PAY_LABELS.market_purchase;
  if (key.includes("market")) return ANJU_PAY_LABELS.market_sale;
  if (entry.label) return entry.label;
  if (entry.category === "opening") return ANJU_PAY_LABELS.opening;
  if (entry.category === "earn") return "AnjuPayを獲得";
  if (entry.category === "spend") return "AnjuPayを利用";
  if (entry.category === "market") return "推し値市場";
  if (entry.category === "tip") return entry.delta < 0 ? "対戦後の応援" : "対戦後に受けた応援";
  return "AnjuPay残高の更新";
}

function resetHistoryState() {
  state.historyRequestId += 1;
  state.historyAvailable = null;
  state.historyEntries = [];
  state.historyStartedAt = 0;
  state.historyNextCursor = null;
  state.historyHasMore = false;
  state.historyLoading = false;
  state.historyError = "";
}

function previewHistory(protectedPreview) {
  const startedAt = Date.now() - (protectedPreview ? 12 : 4) * 86_400_000;
  const samples = protectedPreview
    ? [
      { sequence: 4, category: "earn", status: "posted", labelKey: "daily_play_reward", details: { tierIds: ["daily_play_10"] }, delta: 40, balanceAfter: 6_400, occurredAt: Date.now() - 50 * 60_000 },
      { sequence: 3, category: "spend", status: "posted", labelKey: "shop_purchase", detail: "トップメッセージ枠", delta: -500, balanceAfter: 6_360, occurredAt: Date.now() - 22 * 60 * 60_000 },
      { sequence: 2, category: "tip", status: "posted", labelKey: "post_match_tip_sent", details: { counterpartyName: "ANJU FAN" }, delta: -10, balanceAfter: 6_860, occurredAt: Date.now() - 2 * 86_400_000 },
      { sequence: 1, category: "market", status: "settled", labelKey: "market_sale", detail: "推し値市場で取引成立", delta: 800, balanceAfter: 6_870, occurredAt: Date.now() - 5 * 86_400_000 },
      { sequence: 0, category: "opening", status: "posted", labelKey: "opening_balance", detail: "この日時から利用履歴の記録を開始", delta: 0, openingBalance: 6_070, balanceAfter: 6_070, occurredAt: startedAt },
    ]
    : [
      { sequence: 3, category: "market", status: "settled", labelKey: "market_sale", details: { role: "seller", listingTitle: "推し画像セレクト" }, delta: 10, balanceAfter: 2_100, occurredAt: Date.now() - 40 * 60_000 },
      { sequence: 2, category: "tip", status: "posted", labelKey: "post_match_tip_sent", details: { counterpartyName: "RIVAL" }, delta: -10, balanceAfter: 2_090, occurredAt: Date.now() - 18 * 60 * 60_000 },
      { sequence: 1, category: "earn", status: "posted", labelKey: "daily_mission", details: { missionId: "complete_match" }, delta: 100, balanceAfter: 2_100, occurredAt: Date.now() - 2 * 86_400_000 },
      { sequence: 0, category: "opening", status: "posted", labelKey: "opening_balance", detail: "この日時から利用履歴の記録を開始", delta: 0, openingBalance: 2_000, balanceAfter: 2_000, occurredAt: startedAt },
    ];
  return {
    available: true,
    balance: protectedPreview ? 6_400 : 2_100,
    historyStartedAt: startedAt,
    entries: samples,
    nextCursor: null,
    hasMore: false,
  };
}

function applyHistoryResponse(value, { append = false } = {}) {
  const response = value && typeof value === "object" ? value : {};
  state.historyAvailable = response.available !== false;
  const balance = finiteInteger(response.availableBalance ?? response.balance, null);
  if (balance !== null) state.balance = Math.max(0, Math.min(ANJU_PAY_MAX_BALANCE, balance));
  state.historyStartedAt = timestampMillis(response.historyStartedAt);
  const incoming = (Array.isArray(response.entries) ? response.entries : [])
    .map(normalizeHistoryEntry)
    .sort((left, right) => right.sequence - left.sequence || right.occurredAt - left.occurredAt);
  const combined = append ? [...state.historyEntries, ...incoming] : incoming;
  const unique = new Map();
  combined.forEach((entry) => {
    const dedupeKey = entry.key || `${entry.sequence}:${entry.occurredAt}`;
    if (!unique.has(dedupeKey)) unique.set(dedupeKey, entry);
  });
  state.historyEntries = [...unique.values()]
    .sort((left, right) => right.sequence - left.sequence || right.occurredAt - left.occurredAt);
  state.historyNextCursor = response.nextCursor ?? null;
  state.historyHasMore = response.hasMore === true && state.historyNextCursor !== null;
}

function addPreviewHistoryEntry(entry) {
  const sequence = Math.max(0, ...state.historyEntries.map((item) => item.sequence)) + 1;
  state.historyEntries = [
    normalizeHistoryEntry({
      ...entry,
      entryId: `preview-${sequence}`,
      sequence,
      occurredAt: Date.now(),
      balanceAfter: state.balance,
    }),
    ...state.historyEntries,
  ];
}

function historyRequestIsCurrent(requestState, requestId, operationUid) {
  if (!active || state !== requestState || requestState.historyRequestId !== requestId) return false;
  return useAccountPreview
    || (requestState.user?.uid === operationUid && auth.currentUser?.uid === operationUid);
}

async function loadAnjuPayHistory({
  append = false,
  showLoading = false,
  force = false,
} = {}) {
  if ((state.historyLoading && !force) || (append && !state.historyHasMore)) return false;
  const requestState = state;
  const operationUid = requestState.user?.uid || "";
  const requestId = requestState.historyRequestId + 1;
  const focusTargetId = append ? "anjuPayHistoryMore" : "anjuPayHistoryReload";
  requestState.historyRequestId = requestId;
  requestState.historyLoading = true;
  requestState.historyError = "";
  if (showLoading) {
    const trigger = document.querySelector(`#${focusTargetId}`);
    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = "読み込み中…";
      trigger.setAttribute("aria-busy", "true");
    }
    const liveStatus = document.querySelector(".account-live-status");
    if (liveStatus) liveStatus.textContent = "AnjuPay利用履歴を読み込んでいます。";
  }
  try {
    if (useAccountPreview) {
      if (historyRequestIsCurrent(requestState, requestId, operationUid)) {
        applyHistoryResponse(previewHistory(isGoogleLinked()), { append: false });
      }
      return true;
    }
    const request = {
      action: "get_anju_pay_wallet",
      limit: ANJU_PAY_HISTORY_PAGE_SIZE,
    };
    if (append && requestState.historyNextCursor !== null) {
      request.cursor = requestState.historyNextCursor;
    }
    const response = await economyActionCallable(request);
    requireOperationUid(operationUid);
    if (!historyRequestIsCurrent(requestState, requestId, operationUid)) return false;
    applyHistoryResponse(response.data, { append });
    return true;
  } catch (error) {
    if (historyRequestIsCurrent(requestState, requestId, operationUid)) {
      requestState.historyError = friendlyError(error, "AnjuPay利用履歴を読み込めませんでした。");
    }
    return false;
  } finally {
    if (historyRequestIsCurrent(requestState, requestId, operationUid)) {
      requestState.historyLoading = false;
      if (showLoading) {
        render({ focus: false });
        const liveStatus = document.querySelector(".account-live-status");
        if (liveStatus && !requestState.historyError) {
          liveStatus.textContent = "AnjuPay利用履歴を更新しました。";
        }
        window.setTimeout(() => {
          if (!active || state !== requestState) return;
          const target = document.querySelector(`#${focusTargetId}`)
            || document.querySelector("#anjuPayHistoryReload");
          target?.focus({ preventScroll: true });
        }, 0);
      }
    }
  }
}

function currentSeasonKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function tierForLevel(level) {
  return PATRON_TIERS.find((tier) => tier.level === Number(level)) || PATRON_TIERS[0];
}

function tierForSpent(spent) {
  return [...PATRON_TIERS].reverse().find((tier) => spent >= tier.threshold) || PATRON_TIERS[0];
}

function normalizePatronage(value) {
  const seasonKey = currentSeasonKey();
  const sameSeason = String(value?.seasonKey || "") === seasonKey;
  const seasonSpent = sameSeason
    ? Math.max(0, Math.min(5_000, Math.floor(Number(value?.seasonSpent || 0))))
    : 0;
  const tier = tierForSpent(seasonSpent);
  return {
    seasonKey,
    seasonSpent,
    tier: tier.level,
    tierId: tier.id,
    tierLabel: tier.label,
    lifetimeSpent: Math.max(0, Math.floor(Number(value?.lifetimeSpent || 0))),
  };
}

function isGoogleLinked(user = state.user) {
  return Boolean(user?.providerData?.some((provider) => provider?.providerId === "google.com"));
}

function requireCurrentAccount({ google = false, anonymous = false } = {}) {
  if (useAccountPreview) return state.user;
  const current = auth.currentUser;
  if (!current || !state.user || current.uid !== state.user.uid) {
    throw new Error("ログイン状態が別のタブで変わりました。画面を開き直してから操作してください。");
  }
  if (google && !isGoogleLinked(current)) {
    throw new Error("Google保護状態を確認できません。画面を開き直してください。");
  }
  if (anonymous && current.isAnonymous !== true) {
    throw new Error("コードの復元先には、新しいゲストデータを使用してください。");
  }
  return current;
}

function requireOperationUid(uid) {
  if (!useAccountPreview && auth.currentUser?.uid !== uid) {
    throw new Error("操作中にログイン状態が変わりました。新しいアカウント情報を読み直してください。");
  }
}

function detachTransferCode() {
  state.transferCode = "";
  state.transferExpiresAt = 0;
}

function clearTransferCode() {
  detachTransferCode();
  try {
    sessionStorage.removeItem(TRANSFER_SESSION_KEY);
  } catch {
    // Session storage can be unavailable in hardened privacy modes.
  }
}

function persistTransferCode() {
  if (!state.user?.uid || !state.transferCode || state.transferExpiresAt <= Date.now()) return;
  try {
    sessionStorage.setItem(TRANSFER_SESSION_KEY, JSON.stringify({
      uid: state.user.uid,
      code: state.transferCode,
      expiresAt: state.transferExpiresAt,
    }));
  } catch {
    // The visible code remains usable even when this convenience storage is unavailable.
  }
}

function restoreTransferCode(uid) {
  detachTransferCode();
  try {
    const saved = JSON.parse(sessionStorage.getItem(TRANSFER_SESSION_KEY) || "null");
    if (saved?.uid === uid && typeof saved.code === "string" && Number(saved.expiresAt) > Date.now()) {
      state.transferCode = saved.code;
      state.transferExpiresAt = Number(saved.expiresAt);
      return;
    }
    if (saved) sessionStorage.removeItem(TRANSFER_SESSION_KEY);
  } catch {
    try {
      sessionStorage.removeItem(TRANSFER_SESSION_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
}

function maskedEmail(user = state.user) {
  const email = String(user?.providerData?.find((provider) => provider?.providerId === "google.com")?.email || "");
  const [name, domain] = email.split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}${name.length > 2 ? "•••" : ""}@${domain}`;
}

function accountKind() {
  if (isGoogleLinked()) return "protected";
  if (state.user && state.user.isAnonymous === false) return "transferred";
  return "guest";
}

function setAccountChrome() {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = "<i></i> ANJUPAY WALLET";
  if (privacy) privacy.textContent = "スタジアム内専用";
  if (footerItems[0]) footerItems[0].textContent = "ANJUPAY WALLET + ACCOUNT PROTECTION";
  if (footerItems[1]) footerItems[1].textContent = "現金購入・換金・自由送金・ゲーム外利用は今後も追加しません";
}

function modesAreActive() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiTeam?.isActive?.()
    || window.HariaiRoyale?.isActive?.()
    || window.HariaiMarket?.isActive?.(),
  );
}

async function ensureUser() {
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady?.();
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function loadAccountData({ notice = "" } = {}) {
  const requestState = state;
  const requestIsCurrent = () => active && state === requestState;
  if (useAccountPreview) {
    const protectedPreview = previewKind === "protected";
    requestState.user = {
      uid: "local-account-preview",
      isAnonymous: !protectedPreview,
      providerData: protectedPreview ? [{ providerId: "google.com", email: "player@example.com" }] : [],
    };
    requestState.balance = protectedPreview ? 6_400 : 2_100;
    requestState.patron = normalizePatronage(protectedPreview
      ? { seasonKey: currentSeasonKey(), seasonSpent: 1_500, lifetimeSpent: 4_800 }
      : null);
    resetHistoryState();
    await loadAnjuPayHistory();
    if (!requestIsCurrent()) return false;
    if (protectedPreview) clearTransferCode();
    else restoreTransferCode(requestState.user.uid);
    requestState.loading = false;
    requestState.notice = notice;
    render();
    return true;
  }
  requestState.loading = true;
  requestState.error = "";
  render();
  const previousUid = requestState.user?.uid || "";
  try {
    const user = await ensureUser();
    if (!requestIsCurrent()) return false;
    requestState.user = user;
    if (previousUid && previousUid !== user.uid) {
      requestState.balance = 0;
      requestState.patron = normalizePatronage(null);
      resetHistoryState();
    }
    if (isGoogleLinked(user)) clearTransferCode();
    else restoreTransferCode(user.uid);
    const response = await economyActionCallable({ action: "initialize" });
    if (!requestIsCurrent()) return false;
    requestState.balance = Math.max(0, Math.floor(Number(response.data?.balance || 0)));
    requestState.patron = normalizePatronage(response.data?.patron);
    await loadAnjuPayHistory();
    if (!requestIsCurrent()) return false;
    requestState.notice = notice;
    return true;
  } catch (error) {
    if (!requestIsCurrent()) return false;
    requestState.balance = 0;
    requestState.patron = normalizePatronage(null);
    resetHistoryState();
    throw error;
  } finally {
    if (requestIsCurrent()) {
      requestState.loading = false;
      render();
    }
  }
}

function renderAccountStatus() {
  const kind = accountKind();
  const status = kind === "protected"
    ? {
      className: "is-protected",
      eyebrow: "GOOGLE PROTECTED",
      title: "ゲームデータは保護済みです",
      copy: `${maskedEmail() || "Googleアカウント"}で別端末から同じデータを開けます。`,
      icon: "✓",
    }
    : kind === "transferred"
      ? {
        className: "is-transferred",
        eyebrow: "TRANSFERRED GUEST",
        title: "引き継ぎコードで復元しました",
        copy: "この端末では利用できますが、Googleで保護すると再復元が簡単になります。",
        icon: "↗",
      }
      : {
        className: "is-guest",
        eyebrow: "GUEST DATA",
        title: "現在はゲストデータです",
        copy: "サイトデータを削除すると、AnjuPay残高・購入品・戦績を復元できません。",
        icon: "!",
      };
  const pendingChoice = state.pendingGoogleCredential
    ? `<div class="account-collision" role="alert">
        <strong>このGoogleアカウントには既存のゲームデータがあります</strong>
        <p>現在のゲストデータと自動合算はしません。既存データを開く場合だけ切り替えてください。</p>
        <div><button class="button button-primary" type="button" id="accountUseExistingGoogle">既存のGoogleデータを開く</button>
        <button class="button button-ghost" type="button" id="accountCancelGoogleChoice">現在のゲストデータへ戻る</button></div>
      </div>`
    : "";
  const actions = kind === "protected"
    ? `<div class="account-protected-note"><span>PRIVATE</span><p>Googleの名前・メールアドレスはゲーム内表示名やランキングへ使用しません。</p></div>`
    : `<div class="account-auth-actions">
        <button class="button button-primary" type="button" id="accountProtectGoogle" ${state.busyAction ? "disabled" : ""}>${state.busyAction === "protect" ? "Googleへ接続中…" : "Googleでこのデータを保護"}</button>
        <button class="button button-ghost" type="button" id="accountRestoreGoogle" ${state.busyAction ? "disabled" : ""}>${state.busyAction === "restore" ? "復元中…" : "別端末のGoogleデータを復元"}</button>
      </div>`;
  return `<section class="account-protection-card ${status.className}">
    <div class="account-status-icon" aria-hidden="true">${escapeHtml(status.icon)}</div>
    <div class="account-status-copy"><span>${escapeHtml(status.eyebrow)}</span><h2>${escapeHtml(status.title)}</h2><p>${escapeHtml(status.copy)}</p>${actions}
      <p class="account-device-local-note">別端末へ戻るのはAnjuPay残高・購入品・実績・戦績です。プロフィール画像、対戦画像・音声、端末設定はこの端末だけに残ります。</p>
    </div>
    ${pendingChoice}
  </section>`;
}

function renderPatronage() {
  const patron = state.patron;
  const currentTier = tierForLevel(patron.tier);
  const nextTier = PATRON_TIERS.find((tier) => tier.level > currentTier.level) || currentTier;
  const nextCost = Math.max(0, nextTier.threshold - patron.seasonSpent);
  const progressMaximum = Math.max(1, nextTier.threshold);
  const progress = currentTier.level === PATRON_TIERS.at(-1).level
    ? 100
    : Math.min(100, (patron.seasonSpent / progressMaximum) * 100);
  const protectedData = isGoogleLinked();
  const seasonLabel = `${patron.seasonKey.replace("-", "年")}月シーズン`;
  const tierCards = PATRON_TIERS.slice(1).map((tier) => {
    const owned = patron.tier >= tier.level;
    const required = Math.max(0, tier.threshold - patron.seasonSpent);
    const affordable = state.balance >= required;
    return `<article class="patron-tier-card tier-${tier.id} ${owned ? "is-owned" : ""}">
      <span class="patron-tier-icon" aria-hidden="true">${tier.icon}</span>
      <div><small>LEVEL ${tier.level}</small><h3>${tier.label}</h3><strong>${formatAnjuPay(tier.threshold)}</strong></div>
      <button class="button ${owned ? "button-ghost" : "button-primary"} button-small" type="button" data-patron-tier="${tier.level}"
        ${owned || !protectedData || !affordable || state.busyAction ? "disabled" : ""}>${owned ? "獲得済み" : affordable ? `${formatAnjuPay(required)}で昇格` : `あと${formatAnjuPay(required - state.balance)}`}</button>
    </article>`;
  }).join("");
  return `<section class="account-patron-section" id="accountPatronSection" tabindex="-1">
    <div class="account-section-head"><div><span class="eyebrow">ANJUPAY PATRONAGE</span><h2>VALUE MARKET パトロン</h2>
      <p>AnjuPayをシステムへ納めて、月替わりの市場支援者バッジを獲得します。勝敗や採点には影響しません。</p></div>
      <div class="patron-current-badge tier-${currentTier.id}"><span>${currentTier.icon}</span><small>CURRENT</small><strong>${currentTier.label}</strong></div></div>
    <div class="patron-progress-card">
      <div><span>${seasonLabel}</span><strong>${formatAnjuPay(patron.seasonSpent)} 支援</strong></div>
      <div class="patron-progress" role="progressbar" aria-label="次のパトロンランクまでの進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
      <p>${currentTier.level === PATRON_TIERS.at(-1).level ? "今月の最高ランクを獲得済みです。" : `次の ${nextTier.label} まであと ${formatAnjuPay(nextCost)}`}</p>
    </div>
    ${!protectedData ? `<div class="patron-protection-lock"><strong>先にゲームデータを保護してください</strong><p>多額のAnjuPay利用は取り消せないため、Google保護後に昇格できます。</p></div>` : ""}
    <div class="patron-tier-grid">${tierCards}</div>
    <p class="account-fine-print">ランクは日本時間の毎月1日に更新されます。利用したAnjuPayの払い戻しはなく、市場ウォレットと商談相手にバッジが表示されます。累計支援 ${formatAnjuPay(patron.lifetimeSpent)}。</p>
  </section>`;
}

function transferCountdownText() {
  if (!state.transferCode || !state.transferExpiresAt) return "";
  const remaining = Math.max(0, state.transferExpiresAt - Date.now());
  if (!remaining) return "期限切れ";
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `残り ${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderTransfer() {
  const codePanel = state.transferCode
    ? `<div class="transfer-code-result">
        <span>ONE-TIME CODE</span><strong>${escapeHtml(state.transferCode)}</strong>
        <div><time id="transferCodeCountdown">${transferCountdownText()}</time><button class="button button-ghost button-small" type="button" id="copyTransferCode">コードをコピー</button><button class="button button-danger button-small" type="button" id="cancelTransferCode">コードを無効化</button></div>
      </div>`
    : "";
  const canRedeem = accountKind() === "guest";
  const canCreate = !isGoogleLinked();
  const sourcePanel = canCreate
    ? `<p>16文字・1回限り・10分間有効です。新しく発行すると前のコードは無効になります。</p>
        <button class="button button-cyan" type="button" id="createTransferCode" ${state.busyAction || state.transferCode ? "disabled" : ""}>${state.busyAction === "create-code" ? "発行中…" : state.transferCode ? "発行済み" : "引き継ぎコードを発行"}</button>${codePanel}`
    : `<div class="transfer-protected-note">このデータはGoogleで保護済みです。別端末ではGoogleから復元できるため、コードは発行しません。</div>`;
  return `<section class="account-transfer-section">
    <div class="account-section-head"><div><span class="eyebrow">OPTIONAL DEVICE HANDOFF</span><h2>使い捨て引き継ぎコード</h2>
      <p>Googleを使えない場合に、同じ匿名UIDを別端末で開くための補助手段です。</p></div></div>
    <div class="account-transfer-grid">
      <article><span>OLD DEVICE</span><h3>このデータからコードを発行</h3>${sourcePanel}</article>
      <article><span>NEW DEVICE</span><h3>コードで同じデータを開く</h3><p>現在この端末で使っているゲストデータとは合算されず、発行元のデータへ切り替わります。</p>
        ${canRedeem ? `<form id="redeemTransferForm"><label for="transferCodeInput">引き継ぎコード</label><input id="transferCodeInput" maxlength="19" inputmode="text" autocomplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" required />
          <button class="button button-primary" ${state.busyAction ? "disabled" : ""}>${state.busyAction === "redeem-code" ? "引き継ぎ中…" : "コードで復元"}</button></form>` : `<div class="transfer-protected-note">${accountKind() === "protected" ? "Google保護済みのデータを使用中です。別端末ではGoogleから復元してください。" : "別のコードを復元する場合は、対戦や購入をしていない新しいゲスト端末で入力してください。"}</div>`}
      </article>
    </div>
    <p class="account-fine-print">コードを知った人はゲームデータへアクセスできます。SNSやチャットへ投稿しないでください。復元後も元端末は自動ログアウトされません。</p>
  </section>`;
}

function renderAnjuPayPolicy() {
  return `<section class="anju-pay-policy" aria-labelledby="anjuPayPolicyTitle">
    <div class="anju-pay-policy-mark" aria-hidden="true">A</div>
    <div><span class="eyebrow">IN-STADIUM CURRENCY</span><h2 id="anjuPayPolicyTitle">貼り合いスタジアムの中だけで使えるAnjuPay</h2>
      <p>対戦やミッションで稼ぎ、AnjuPayストア、推し値市場、対戦後の応援など、ゲーム内で用意された用途に使うゲーム内通貨です。</p>
      <strong>現金での購入・チャージ、換金、自由送金、ゲーム外での利用には対応せず、今後も追加しません。</strong>
    </div>
  </section>`;
}

function renderAnjuPayQuickActions() {
  return `<nav class="anju-pay-quick-actions" aria-label="AnjuPayの主な使い方">
    <button type="button" data-anju-pay-destination="missions"><span aria-hidden="true">＋</span><small>稼ぐ</small><strong>デイリーミッション</strong></button>
    <button type="button" data-anju-pay-destination="shop"><span aria-hidden="true">◇</span><small>使う</small><strong>AnjuPayストア</strong></button>
    <button type="button" data-anju-pay-destination="market"><span aria-hidden="true">↔</span><small>商う</small><strong>推し値市場</strong></button>
    <button type="button" data-anju-pay-destination="patron"><span aria-hidden="true">◆</span><small>支援する</small><strong>市場パトロン</strong></button>
  </nav>`;
}

function renderHistoryEntry(entry) {
  const opening = entry.category === "opening";
  const amount = opening ? entry.openingBalance : entry.delta;
  const amountText = formatAnjuPay(amount, { sign: !opening });
  const detail = historyDetail(entry);
  const balanceAfter = entry.balanceAfter === null
    ? ""
    : `<small>反映後 ${formatAnjuPay(entry.balanceAfter)}</small>`;
  const dateTime = historyDateTime(entry.occurredAt);
  return `<li class="anju-pay-history-entry is-${entry.category} ${amount > 0 ? "is-positive" : amount < 0 ? "is-negative" : "is-neutral"}">
    <div class="anju-pay-history-icon" aria-hidden="true">${entry.category === "earn" ? "＋" : entry.category === "spend" ? "－" : entry.category === "market" ? "↔" : entry.category === "tip" ? "♡" : "A"}</div>
    <div class="anju-pay-history-copy"><div><time${dateTime ? ` datetime="${escapeHtml(dateTime)}"` : ""}>${escapeHtml(formatHistoryTime(entry.occurredAt))}</time><span>${escapeHtml(ANJU_PAY_STATUS_LABELS[entry.status] || "反映済み")}</span></div>
      <strong>${escapeHtml(historyLabel(entry))}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}</div>
    <div class="anju-pay-history-amount"><strong>${escapeHtml(amountText)}</strong>${balanceAfter}</div>
  </li>`;
}

function renderAnjuPayHistory() {
  const startedAt = state.historyStartedAt
    || state.historyEntries.find((entry) => entry.category === "opening")?.occurredAt
    || 0;
  const headingMeta = startedAt
    ? `記録開始 ${escapeHtml(formatHistoryTime(startedAt))}`
    : "記録開始日時を確認中";
  let content = "";
  if (state.historyAvailable === false) {
    content = `<div class="anju-pay-history-state"><strong>利用履歴を準備しています</strong><p>AnjuPay残高と既存機能は通常どおり利用できます。履歴の記録が有効になると、開始残高から表示します。</p></div>`;
  } else if (!state.historyEntries.length && state.historyLoading) {
    content = `<div class="anju-pay-history-state"><div class="loader"></div><strong>利用履歴を読み込んでいます</strong></div>`;
  } else if (!state.historyEntries.length && state.historyError) {
    content = `<div class="anju-pay-history-state is-error"><strong>利用履歴を読み込めませんでした</strong><p>${escapeHtml(state.historyError)}</p></div>`;
  } else if (!state.historyEntries.length) {
    content = `<div class="anju-pay-history-state"><strong>この期間の履歴はありません</strong><p>次にAnjuPay残高が動くと、ここへ記録されます。</p></div>`;
  } else {
    content = `<ol class="anju-pay-history-list" aria-label="AnjuPay利用履歴、新しい順">${state.historyEntries.map(renderHistoryEntry).join("")}</ol>`;
  }
  const reloadLabel = state.historyLoading ? "読み込み中…" : "再読み込み";
  const liveMessage = state.historyLoading
    ? "AnjuPay利用履歴を読み込んでいます。"
    : state.historyError
      ? "AnjuPay利用履歴の読み込みでエラーが発生しました。"
      : "";
  return `<section class="anju-pay-history-section" aria-labelledby="anjuPayHistoryTitle">
    <div class="account-section-head anju-pay-history-head"><div><span class="eyebrow">ANJUPAY ACTIVITY</span><h2 id="anjuPayHistoryTitle">AnjuPay利用履歴</h2>
      <p>残高の増減を新しい順に表示します。${headingMeta}。</p></div>
      <button class="button button-ghost button-small" type="button" id="anjuPayHistoryReload" ${state.historyLoading ? "disabled" : ""}>${reloadLabel}</button></div>
    <div>${content}</div>
    <p class="account-live-status" role="status" aria-live="polite">${escapeHtml(liveMessage)}</p>
    ${state.historyError && state.historyEntries.length ? `<p class="anju-pay-history-inline-error" role="alert">${escapeHtml(state.historyError)}</p>` : ""}
    ${state.historyHasMore ? `<button class="button button-ghost anju-pay-history-more" type="button" id="anjuPayHistoryMore" ${state.historyLoading ? "disabled" : ""}>${state.historyLoading ? "読み込み中…" : "さらに前の履歴を表示"}</button>` : ""}
    <p class="anju-pay-history-boundary"><strong>履歴の範囲について</strong> 記録開始より前の増減をさかのぼった完全な履歴はありません。開始時点の残高を1件記録し、それ以降の増減をすべて保存します。</p>
  </section>`;
}

function render({ focus = true } = {}) {
  if (!active) return;
  if (state.loading) {
    appRoot.innerHTML = `<section class="screen account-screen account-loading"><div class="loader"></div><span class="eyebrow">ANJUPAY WALLET</span><h1>AnjuPayウォレットを確認しています</h1><p>残高、利用履歴、データ保護状態を読み込んでいます。</p></section>`;
    return;
  }
  const kind = accountKind();
  appRoot.innerHTML = `<section class="screen account-screen">
    <div class="account-hero">
      <div><span class="eyebrow">ANJUPAY WALLET</span><h1>AnjuPayウォレット</h1><p>貼り合いスタジアムで稼いだ価値を、残高と利用履歴で確かめられます。</p></div>
      <div class="account-wallet"><span>${kind === "protected" ? "PROTECTED ANJUPAY" : kind === "transferred" ? "TRANSFERRED ANJUPAY" : "GUEST ANJUPAY"}</span><strong>${formatAnjuPayNumber(state.balance)} <small>${ANJU_PAY_UNIT}</small></strong><em>利用可能残高</em><button class="button button-ghost button-small" type="button" id="accountBackHome">トップへ戻る</button></div>
    </div>
    ${state.notice ? `<div class="account-notice" role="status">${escapeHtml(state.notice)}</div>` : ""}
    ${state.error ? `<div class="account-error" role="alert">${escapeHtml(state.error)}</div>` : ""}
    ${renderAnjuPayPolicy()}
    ${renderAnjuPayQuickActions()}
    ${renderAnjuPayHistory()}
    ${renderAccountStatus()}
    ${renderPatronage()}
    ${renderTransfer()}
  </section>`;
  bindEvents();
  updateCountdown();
  if (focus) appRoot.focus({ preventScroll: true });
}

function friendlyError(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "Google認証をキャンセルしました。";
  if (code.includes("popup-blocked")) return "Google認証のポップアップがブロックされました。ブラウザ設定を確認してください。";
  if (code.includes("operation-not-allowed")) return "Firebase AuthenticationでGoogleログインを有効にしてください。";
  if (code.includes("unauthorized-domain")) return "この公開ドメインをFirebase Authenticationの承認済みドメインへ追加してください。";
  if (code.includes("resource-exhausted")) return "操作回数が多すぎます。表示された時間をおいてください。";
  return error?.message || fallback;
}

async function protectWithGoogle() {
  if (state.busyAction || isGoogleLinked()) return;
  try {
    requireCurrentAccount();
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  state.busyAction = "protect";
  state.error = "";
  state.pendingGoogleCredential = null;
  render();
  try {
    if (useAccountPreview) {
      state.user = { ...state.user, isAnonymous: false, providerData: [{ providerId: "google.com", email: "player@example.com" }] };
      clearTransferCode();
      state.notice = "Google保護のプレビュー状態へ切り替えました。";
      return;
    }
    const user = requireCurrentAccount();
    const result = await linkWithPopup(user, googleProvider);
    state.user = result.user;
    await result.user.getIdToken(true);
    await loadAccountData({ notice: "現在のAnjuPay残高・購入品・戦績を同じUIDのままGoogleで保護しました。" });
  } catch (error) {
    const credential = GoogleAuthProvider.credentialFromError(error);
    if (credential && ["auth/credential-already-in-use", "auth/email-already-in-use"].includes(error?.code)) {
      state.pendingGoogleCredential = credential;
      state.error = "";
    } else {
      state.error = friendlyError(error, "Googleでデータを保護できませんでした。");
    }
  } finally {
    state.busyAction = "";
    render();
  }
}

async function restoreWithGoogle() {
  if (state.busyAction || isGoogleLinked()) return;
  try {
    requireCurrentAccount();
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  if (!window.confirm(`この端末の現在のデータ（AnjuPay残高 ${formatAnjuPay(state.balance)}）から、選択したGoogleアカウントのデータへ切り替えます。AnjuPay残高は合算されません。続けますか？`)) return;
  state.busyAction = "restore";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.user = { ...state.user, isAnonymous: false, providerData: [{ providerId: "google.com", email: "restored@example.com" }] };
      state.balance = 6_400;
      state.patron = normalizePatronage({ seasonKey: currentSeasonKey(), seasonSpent: 1_500, lifetimeSpent: 4_800 });
      applyHistoryResponse(previewHistory(true));
      clearTransferCode();
      state.notice = "Googleデータを復元したプレビュー状態です。";
      return;
    }
    const user = requireCurrentAccount();
    const result = await linkWithPopup(user, googleProvider);
    state.user = result.user;
    await result.user.getIdToken(true);
    await loadAccountData({ notice: "このGoogleアカウントには既存データがなかったため、現在のデータを同じUIDのまま保護しました。" });
  } catch (error) {
    const credential = GoogleAuthProvider.credentialFromError(error);
    if (credential && ["auth/credential-already-in-use", "auth/email-already-in-use"].includes(error?.code)) {
      state.pendingGoogleCredential = credential;
      state.error = "";
    } else {
      state.error = friendlyError(error, "Googleデータを復元できませんでした。");
    }
  } finally {
    state.busyAction = "";
    render();
  }
}

async function useExistingGoogleData() {
  if (!state.pendingGoogleCredential || state.busyAction) return;
  if (!window.confirm("現在のゲストデータは合算せず、Google側の既存データへ切り替えます。続けますか？")) return;
  state.busyAction = "restore";
  state.error = "";
  render();
  try {
    const result = await signInWithCredential(auth, state.pendingGoogleCredential);
    state.pendingGoogleCredential = null;
    state.user = result.user;
    state.balance = 0;
    state.patron = normalizePatronage(null);
    resetHistoryState();
    clearTransferCode();
    await result.user.getIdToken(true);
    await loadAccountData({ notice: "Googleで保護済みのゲームデータを開きました。" });
  } catch (error) {
    state.error = friendlyError(error, "既存のGoogleデータを開けませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

function newActionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const random = crypto.getRandomValues(new Uint32Array(4));
  return [...random].map((value) => value.toString(16).padStart(8, "0")).join("");
}

async function upgradePatron(targetTier) {
  if (state.busyAction || !isGoogleLinked()) return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount({ google: true }).uid;
  } catch (error) {
    state.error = friendlyError(error, "Google保護状態を確認できませんでした。");
    render();
    return;
  }
  const target = tierForLevel(targetTier);
  const required = Math.max(0, target.threshold - state.patron.seasonSpent);
  if (!required || state.balance < required) return;
  if (!window.confirm(`${formatAnjuPay(required)}を払い戻しなしで支払い、今月の${target.label}へ昇格します。続けますか？`)) return;
  state.busyAction = "patron";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.balance -= required;
      state.patron = normalizePatronage({
        seasonKey: currentSeasonKey(),
        seasonSpent: target.threshold,
        lifetimeSpent: state.patron.lifetimeSpent + required,
      });
      addPreviewHistoryEntry({
        category: "spend",
        status: "posted",
        labelKey: "patron_upgrade",
        details: { targetTier: target.level },
        delta: -required,
      });
      state.notice = `${target.label}へ昇格したプレビュー状態です。`;
      return;
    }
    const response = await economyActionCallable({
      action: "patron_upgrade",
      targetTier: target.level,
      actionId: newActionId(),
    });
    requireOperationUid(operationUid);
    if (response.data?.outcome === "short") throw new Error("AnjuPay残高が不足しています。");
    state.balance = Math.max(0, Math.floor(Number(response.data?.balance || 0)));
    state.patron = normalizePatronage(response.data?.patron);
    await loadAnjuPayHistory({ force: true });
    state.notice = `${target.label}へ昇格しました。市場で新しいバッジが表示されます。`;
  } catch (error) {
    state.error = friendlyError(error, "パトロンランクを更新できませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function createTransfer() {
  if (state.busyAction || state.transferCode) return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount().uid;
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  if (!window.confirm("10分間有効な使い捨てコードを発行します。コードを他人へ見せないでください。")) return;
  state.busyAction = "create-code";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.transferCode = "7KMP-9RDX-W4HZ-3QCV";
      state.transferExpiresAt = Date.now() + (10 * 60 * 1000);
    } else {
      const response = await accountTransferCallable({ action: "create" });
      requireOperationUid(operationUid);
      state.transferCode = String(response.data?.code || "");
      state.transferExpiresAt = Number(response.data?.expiresAt || 0);
    }
    persistTransferCode();
    state.notice = "引き継ぎコードを発行しました。新しい端末で10分以内に入力してください。";
  } catch (error) {
    state.error = friendlyError(error, "引き継ぎコードを発行できませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function cancelTransfer() {
  if (state.busyAction || !state.transferCode) return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount().uid;
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  state.busyAction = "cancel-code";
  state.error = "";
  render();
  try {
    if (!useAccountPreview) {
      await accountTransferCallable({ action: "cancel" });
      requireOperationUid(operationUid);
    }
    clearTransferCode();
    state.notice = "引き継ぎコードを無効にしました。";
  } catch (error) {
    state.error = friendlyError(error, "引き継ぎコードを無効にできませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function redeemTransfer(code) {
  if (state.busyAction || accountKind() !== "guest") return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount({ anonymous: true }).uid;
  } catch (error) {
    state.error = friendlyError(error, "復元先のゲスト状態を確認できませんでした。");
    render();
    return;
  }
  if (!window.confirm(`現在の端末データ（AnjuPay残高 ${formatAnjuPay(state.balance)}）から、コード発行元のデータへ切り替えます。AnjuPay残高は合算されません。続けますか？`)) return;
  state.busyAction = "redeem-code";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.user = { ...state.user, isAnonymous: false, providerData: [] };
      state.balance = 3_800;
      state.patron = normalizePatronage({ seasonKey: currentSeasonKey(), seasonSpent: 300, lifetimeSpent: 900 });
      const startedAt = Date.now() - 3 * 86_400_000;
      applyHistoryResponse({
        available: true,
        balance: 3_800,
        historyStartedAt: startedAt,
        entries: [{ sequence: 0, category: "opening", status: "posted", labelKey: "opening_balance", openingBalance: 3_800, balanceAfter: 3_800, occurredAt: startedAt }],
        nextCursor: null,
        hasMore: false,
      });
      clearTransferCode();
      state.notice = "引き継ぎコードで発行元データを復元したプレビュー状態です。";
      return;
    }
    const response = await accountTransferCallable({ action: "redeem", code });
    requireOperationUid(operationUid);
    const token = String(response.data?.token || "");
    if (!token) throw new Error("引き継ぎ用の認証情報を受け取れませんでした。");
    const credential = await signInWithCustomToken(auth, token);
    state.user = credential.user;
    state.balance = 0;
    state.patron = normalizePatronage(null);
    resetHistoryState();
    clearTransferCode();
    await credential.user.getIdToken(true);
    await loadAccountData({ notice: "引き継ぎコードで発行元のゲームデータを復元しました。" });
  } catch (error) {
    state.error = friendlyError(error, "引き継ぎコードで復元できませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

function updateCountdown() {
  const countdown = document.querySelector("#transferCodeCountdown");
  if (!countdown) return;
  countdown.textContent = transferCountdownText();
  if (state.transferExpiresAt <= Date.now()) {
    clearTransferCode();
    window.clearInterval(countdownTimer);
    countdownTimer = null;
    render();
  }
}

function openAccountDestination(destination) {
  if (destination === "patron") {
    const section = document.querySelector("#accountPatronSection");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => section?.focus({ preventScroll: true }), 320);
    return;
  }
  const config = destination === "missions"
    ? { globalName: "HariaiOnline", method: "openDailyMissions", readyEvent: "hariai-online-ready", loading: "デイリーミッションを読み込んでいます…" }
    : destination === "shop"
      ? { globalName: "HariaiOnline", method: "openPointShop", readyEvent: "hariai-online-ready", loading: "AnjuPayストアを読み込んでいます…" }
      : destination === "market"
        ? { globalName: "HariaiMarket", method: "start", readyEvent: "hariai-market-ready", loading: "推し値市場を読み込んでいます…" }
        : null;
  if (!config || !active) return;
  let opened = false;
  const invoke = () => {
    if (opened) return true;
    const method = window[config.globalName]?.[config.method];
    if (typeof method !== "function") return false;
    opened = true;
    method();
    return true;
  };
  const readyNow = typeof window[config.globalName]?.[config.method] === "function";
  let readyHandler = null;
  let fallbackTimer = null;
  if (!readyNow) {
    showToast(config.loading);
    readyHandler = () => {
      window.clearTimeout(fallbackTimer);
      window.setTimeout(() => {
        if (!invoke()) showToast("機能を開けませんでした。ページを読み直してお試しください。");
      }, 0);
    };
    window.addEventListener(config.readyEvent, readyHandler, { once: true });
  }
  requestHome();
  if (readyNow) {
    window.setTimeout(() => {
      if (!invoke()) showToast("機能を開けませんでした。ページを読み直してお試しください。");
    }, 0);
    return;
  }
  fallbackTimer = window.setTimeout(() => {
    window.removeEventListener(config.readyEvent, readyHandler);
    if (!invoke()) showToast("機能の読み込みに時間がかかっています。ページを読み直してお試しください。");
  }, 3_000);
}

function bindEvents() {
  document.querySelector("#accountBackHome")?.addEventListener("click", requestHome);
  document.querySelectorAll("[data-anju-pay-destination]").forEach((button) => {
    button.addEventListener("click", () => openAccountDestination(button.dataset.anjuPayDestination));
  });
  document.querySelector("#anjuPayHistoryReload")?.addEventListener("click", () => loadAnjuPayHistory({
    append: false,
    showLoading: true,
    force: true,
  }));
  document.querySelector("#anjuPayHistoryMore")?.addEventListener("click", () => loadAnjuPayHistory({
    append: true,
    showLoading: true,
  }));
  document.querySelector("#accountProtectGoogle")?.addEventListener("click", protectWithGoogle);
  document.querySelector("#accountRestoreGoogle")?.addEventListener("click", restoreWithGoogle);
  document.querySelector("#accountUseExistingGoogle")?.addEventListener("click", useExistingGoogleData);
  document.querySelector("#accountCancelGoogleChoice")?.addEventListener("click", () => {
    state.pendingGoogleCredential = null;
    state.notice = "現在のゲストデータを維持しています。別のGoogleアカウントなら保護に使用できます。";
    render();
  });
  document.querySelectorAll("[data-patron-tier]").forEach((button) => {
    button.addEventListener("click", () => upgradePatron(Number(button.dataset.patronTier)));
  });
  document.querySelector("#createTransferCode")?.addEventListener("click", createTransfer);
  document.querySelector("#cancelTransferCode")?.addEventListener("click", cancelTransfer);
  document.querySelector("#copyTransferCode")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.transferCode);
      showToast("引き継ぎコードをコピーしました。");
    } catch {
      showToast("コピーできませんでした。コードを選択してコピーしてください。");
    }
  });
  document.querySelector("#redeemTransferForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#transferCodeInput");
    redeemTransfer(input?.value || "");
  });
  const input = document.querySelector("#transferCodeInput");
  input?.addEventListener("input", () => {
    const compact = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    input.value = compact.match(/.{1,4}/g)?.join("-") || "";
  });
}

function startCountdown() {
  window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(updateCountdown, 1000);
}

function subscribeToAuthChanges() {
  unsubscribeAuth?.();
  if (useAccountPreview) {
    unsubscribeAuth = null;
    return;
  }
  unsubscribeAuth = onIdTokenChanged(auth, (user) => {
    if (!active) return;
    const displayedUid = state.user?.uid || "";
    const nextUid = user?.uid || "";
    const authTransitionAction = ["protect", "restore", "redeem-code"].includes(state.busyAction);
    if (!displayedUid || displayedUid === nextUid || authTransitionAction) {
      state.user = user;
      if (displayedUid === nextUid && !state.loading) render();
      return;
    }
    state.user = user;
    state.balance = 0;
    state.patron = normalizePatronage(null);
    resetHistoryState();
    detachTransferCode();
    state.loading = true;
    state.notice = "別のタブでログイン状態が変わったため、データを読み直しています。";
    state.error = "";
    render();
    const reloadState = state;
    loadAccountData({ notice: "別のタブで変更されたログイン状態へ更新しました。" }).catch((error) => {
      if (!active || state !== reloadState) return;
      reloadState.loading = false;
      reloadState.error = friendlyError(error, "変更後のアカウント情報を読み込めませんでした。");
      render();
    });
  });
}

function start() {
  if (active) return;
  if (modesAreActive()) {
    showToast("対戦・市場を終了してからAnjuPayウォレットを開いてください。");
    return;
  }
  active = true;
  state = createState();
  subscribeToAuthChanges();
  setAccountChrome();
  render();
  startCountdown();
  const startState = state;
  loadAccountData().catch((error) => {
    if (!active || state !== startState) return;
    startState.loading = false;
    startState.error = friendlyError(error, "アカウント情報を読み込めませんでした。");
    render();
  });
}

function requestHome() {
  if (!active) return;
  active = false;
  state.historyRequestId += 1;
  state.historyLoading = false;
  window.clearInterval(countdownTimer);
  countdownTimer = null;
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  state.pendingGoogleCredential = null;
  window.HariaiApp?.returnHome?.();
}

window.HariaiAccount = Object.freeze({
  isActive: () => active,
  requestHome,
  start,
});
window.dispatchEvent(new Event("hariai-account-ready"));
