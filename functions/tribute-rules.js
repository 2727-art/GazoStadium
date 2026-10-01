"use strict";

// お貢ぎ界隈の純粋な規則。上限・入力・禁止表現・手数料・称号をここに集め、サービスとテストで共有する。
// 上限と離脱は預ける側が持つ。ここにある関数は、預ける側の上限を超える移動を通さないためにある。

const TRIBUTE_SCHEMA_VERSION = 1;
const TRIBUTE_AGE_VERSION = "tribute-age-v1";

const PER_TRIBUTE_OPTIONS = Object.freeze([10, 30, 50, 100, 300, 500, 1_000]);
const PER_DAY_OPTIONS = Object.freeze([30, 100, 300, 500, 1_000, 3_000, 5_000]);
const TOTAL_OPTIONS = Object.freeze([100, 300, 1_000, 3_000, 5_000, 10_000, 30_000]);
const DURATION_DAYS_OPTIONS = Object.freeze([1, 3, 7]);
const ENTRY_FEE_OPTIONS = Object.freeze([0, 5, 10, 30, 50, 100]);
const TONES = Object.freeze(["sweet", "normal", "harsh"]);
const DISCLOSURES = Object.freeze(["nekama", "as_is", "undisclosed"]);
const MANAGER_STYLES = Object.freeze(["harsh", "cold", "sweet"]);
const SIGIL_COLORS = Object.freeze([0, 1, 2, 3, 4, 5]);
const REPORT_REASONS = Object.freeze([
  "external_trade",
  "personal_info",
  "exit_obstruction",
  "threat",
  "other",
]);
const SEVERE_REPORT_REASONS = Object.freeze(["external_trade", "personal_info", "exit_obstruction", "threat"]);
const POLICIES = Object.freeze(["both", "first", "renewal"]);

const LIMITS = Object.freeze({
  personaName: 16,
  intro: 60,
  walletName: 16,
  ngWordCount: 5,
  ngWordLength: 12,
  message: 240,
  requestNote: 60,
  pendingRequests: 3,
  payerOpenContracts: 3,
  managerActiveContracts: 30,
  managerPendingContracts: 30,
  messageIntervalMs: 2_000,
  messagesPerDay: 300,
  applicationTtlMs: 48 * 60 * 60 * 1_000,
  managerDailyReceive: 20_000,
  rankDailyPairCap: 500,
  feeRateBasisPoints: 500,
  minimumFee: 1,
  subsidyMaximum: 10,
  subsidyManagerMonthly: 50,
  offerBurnBasisPoints: 8_000,
  honorEligibleTributes: 5,
  honorEligiblePayers: 3,
  rankingLimit: 20,
  boardLimit: 30,
  recommendedLimit: 10,
  eventsPage: 100,
  receiptsPage: 50,
  severeReportHide: 3,
});

const HONOR_TIERS = Object.freeze([
  Object.freeze({ id: "offerer", label: "上納者", threshold: 300, recommendationSlots: 1 }),
  Object.freeze({ id: "grand_offerer", label: "大上納者", threshold: 1_500, recommendationSlots: 2 }),
  Object.freeze({ id: "master", label: "界隈の主", threshold: 5_000, recommendationSlots: 3 }),
]);

function cleanLine(value, maximumLength) {
  return Array.from(String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()).slice(0, maximumLength).join("");
}

// 会話は打った文字のまま残す（全角の？！も保つ）。禁止表現の判定は forbiddenReason が NFKC で行う。
function cleanMultiline(value, maximumLength) {
  const text = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return Array.from(text).slice(0, maximumLength).join("");
}

function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

function pickOption(value, options, fallback = null) {
  const number = Number(value);
  return options.includes(number) ? number : fallback;
}

function pickEnum(value, options, fallback = null) {
  const text = String(value ?? "");
  return options.includes(text) ? text : fallback;
}

// 外部連絡先・外部決済・現金・会う約束・住所や本名・晒しの脅しを拒否する。理由コードを返し、問題がなければ空文字。
const FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze({ reason: "email", pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu }),
  Object.freeze({ reason: "url", pattern: /https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|jp|me|io|app|link|ly|gg|co|info|xyz|cc|to|tv)\b/iu }),
  Object.freeze({ reason: "phone", pattern: /(?:\d[\s-]?){10,}/u }),
  Object.freeze({ reason: "contact_app", pattern: /(?:\bline\s?(?:id|交換|で|やって|追加)|ライン(?:id|ＩＤ|交換|で話|やって|追加|教)|discord|ディスコード|telegram|テレグラム|kakao|カカオトーク|skype|スカイプ|instagram|インスタ|tiktok|ティックトック|twitter|ツイッター|threads|xのid|ＩＤ交換|id交換|連絡先|アカウント教え|裏垢)/iu }),
  Object.freeze({ reason: "handle", pattern: /(?:^|[\s(（「])@[a-z0-9_]{3,}/iu }),
  Object.freeze({ reason: "external_payment", pattern: /(?:paypay|ペイペイ|ぺいぺい|paypal|ペイパル|kyash|キャッシュアプリ|cash\s?app|venmo|楽天ペイ|メルペイ|d払い|au\s?pay|line\s?pay|ラインペイ|振込|振り込|口座|銀行|送金アプリ|アマギフ|amazon\s?ギフト|アマゾンギフト|itunes|google\s?play\s?ギフト|ギフト券|ギフトコード|プリペイド|電子マネー|ビットコイン|bitcoin|仮想通貨|暗号資産|現金|キャッシュバック|換金|リアルマネー|rmt)/iu }),
  Object.freeze({ reason: "real_money", pattern: /\d[\d,]*\s?(?:円|万円|千円|ドル|＄|\$)|(?:円|万円)\s?\d/u }),
  Object.freeze({ reason: "meeting", pattern: /(?:(?<!出)会(?:おう|いたい|える|お(?:う|か)|って)|オフ会|待ち合わせ|直接会|リアルで会|ホテル|家に来|家行)/u }),
  Object.freeze({ reason: "personal_info", pattern: /(?:住所|本名|電話番号|勤務先|学校名|顔写真|免許証|マイナンバー|生年月日)/u }),
  Object.freeze({ reason: "exposure_threat", pattern: /(?:晒す|晒して|晒し上げ|晒すぞ|特定する|特定して|特定した|ばらす|バラす|拡散する)/u }),
]);

function forbiddenReason(text) {
  const normalized = String(text ?? "").normalize("NFKC");
  for (const { reason, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) return reason;
  }
  return "";
}

const FORBIDDEN_MESSAGES = Object.freeze({
  url: "URLやドメインは送れません。",
  email: "メールアドレスは送れません。",
  phone: "電話番号のような数字の並びは送れません。",
  contact_app: "外部の連絡先やSNSへ誘う言葉は送れません。",
  handle: "SNSのIDのような文字は送れません。",
  external_payment: "外部の決済・現金・ギフト券に関わる言葉は送れません。",
  real_money: "現実のお金の金額は送れません。使えるのはAnjuPayだけです。",
  meeting: "会う約束に関わる言葉は送れません。この界隈は会わない前提です。",
  personal_info: "住所・本名などの個人情報に関わる言葉は送れません。",
  exposure_threat: "晒し・特定の脅しは送れません。",
  ng_word: "相手が登録した「言われたくない言葉」を含むため送れません。",
});

function normalizeNgWords(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\n,、]/u);
  return [...new Set(list
    .map((word) => cleanLine(word, LIMITS.ngWordLength))
    .filter(Boolean))].slice(0, LIMITS.ngWordCount);
}

function containsNgWord(text, ngWords) {
  const normalized = String(text ?? "").normalize("NFKC").toLowerCase();
  return (Array.isArray(ngWords) ? ngWords : [])
    .some((word) => word && normalized.includes(String(word).normalize("NFKC").toLowerCase()));
}

function normalizeCaps(value) {
  const perTribute = pickOption(value?.perTribute, PER_TRIBUTE_OPTIONS);
  const perDay = pickOption(value?.perDay, PER_DAY_OPTIONS);
  const total = pickOption(value?.total, TOTAL_OPTIONS);
  if (perTribute === null || perDay === null || total === null) return null;
  if (perTribute > perDay || perDay > total) return null;
  return { perTribute, perDay, total };
}

function capsAreLowerOrEqual(next, current) {
  return next.perTribute <= current.perTribute
    && next.perDay <= current.perDay
    && next.total <= current.total;
}

function normalizeManagerCard(value) {
  const personaName = cleanLine(value?.personaName, LIMITS.personaName);
  const intro = cleanLine(value?.intro, LIMITS.intro);
  const disclosure = pickEnum(value?.disclosure, DISCLOSURES);
  const style = pickEnum(value?.style, MANAGER_STYLES);
  const entryFee = pickOption(value?.entryFee, ENTRY_FEE_OPTIONS);
  const sigil = pickOption(value?.sigil, SIGIL_COLORS, 0);
  if (!personaName) return { error: "ペルソナ名を1〜16文字で入力してください。" };
  if (!disclosure) return { error: "中の人の札を選んでください。" };
  if (!style) return { error: "管理の型を選んでください。" };
  if (entryFee === null) return { error: "入場料を選び直してください。" };
  for (const text of [personaName, intro]) {
    const reason = forbiddenReason(text);
    if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  }
  return {
    card: {
      personaName,
      intro,
      disclosure,
      style,
      entryFee,
      sigil,
      accepting: value?.accepting === true,
    },
  };
}

function normalizeWalletName(value) {
  const name = cleanLine(value, LIMITS.walletName);
  if (!name) return "名無しの財布";
  return forbiddenReason(name) ? "名無しの財布" : name;
}

function normalizeApplication(value, { entryFee = 0 } = {}) {
  const caps = normalizeCaps(value?.caps);
  if (!caps) return { error: "上限は「1回 ≦ 1日 ≦ 合計」になるように選んでください。" };
  const durationDays = pickOption(value?.durationDays, DURATION_DAYS_OPTIONS);
  if (durationDays === null) return { error: "期間を選び直してください。" };
  const tone = pickEnum(value?.tone, TONES);
  if (!tone) return { error: "言葉の強さを選び直してください。" };
  if (Number(entryFee) > caps.perTribute) {
    return { error: "この管理人の入場料が、あなたの1回の上限を超えています。" };
  }
  const ngWords = normalizeNgWords(value?.ngWords);
  return {
    application: {
      caps,
      durationDays,
      tone,
      ngWords,
      allowReportRequests: value?.allowReportRequests === true,
      rankOptIn: value?.rankOptIn === true,
      walletName: normalizeWalletName(value?.walletName),
    },
  };
}

function normalizeMessage(value) {
  const text = cleanMultiline(value, LIMITS.message);
  if (!text) return { error: "メッセージを入力してください。" };
  const reason = forbiddenReason(text);
  if (reason) return { error: FORBIDDEN_MESSAGES[reason], reason };
  return { text };
}

function tributeFee(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!value) return 0;
  return Math.min(value, Math.max(LIMITS.minimumFee, Math.ceil((value * LIMITS.feeRateBasisPoints) / 10_000)));
}

function subsidyFor(fee) {
  const normalizedFee = Math.max(0, Math.floor(Number(fee) || 0));
  return Math.max(0, Math.min(LIMITS.subsidyMaximum, Math.floor(normalizedFee / 2), normalizedFee - LIMITS.minimumFee));
}

function offerSplit(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  const burned = Math.ceil((value * LIMITS.offerBurnBasisPoints) / 10_000);
  return { burned, fund: value - burned };
}

function honorTierFor(offeredTotal) {
  const total = Math.max(0, Number(offeredTotal) || 0);
  return [...HONOR_TIERS].reverse().find((tier) => total >= tier.threshold) || null;
}

function jstDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function jstMonthKey(timestamp = Date.now()) {
  return jstDateKey(timestamp).slice(0, 7);
}

function nextJstDateKey(timestamp = Date.now()) {
  return jstDateKey(Number(timestamp) + 24 * 60 * 60 * 1_000);
}

// 上げる変更は翌日0時（日本時間）から効く。その日を過ぎていれば予約中の上限を適用する。
function effectiveCaps(contract, timestamp = Date.now()) {
  const caps = normalizeCaps(contract?.caps);
  const pending = normalizeCaps(contract?.pendingCaps);
  const effectiveDateKey = String(contract?.pendingCapsEffectiveDateKey || "");
  if (caps && pending && effectiveDateKey && jstDateKey(timestamp) >= effectiveDateKey) {
    return { caps: pending, applied: true };
  }
  return { caps, applied: false };
}

function todayUsed(contract, timestamp = Date.now()) {
  const todayKey = jstDateKey(timestamp);
  return contract?.todayKey === todayKey ? Math.max(0, Number(contract.todayTributed) || 0) : 0;
}

// 1回・1日・合計の上限から、この献上で渡せる最大額を出す。
function tributeAllowance(contract, caps, timestamp = Date.now()) {
  if (!caps) return 0;
  const usedToday = todayUsed(contract, timestamp);
  const usedTotal = Math.max(0, Number(contract?.totalTributed) || 0);
  return Math.max(0, Math.min(
    caps.perTribute,
    caps.perDay - usedToday,
    caps.total - usedTotal,
  ));
}

function capViolation(amount, contract, caps, timestamp = Date.now()) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value < 1) return "金額は1 Pay以上の整数で指定してください。";
  if (!caps) return "契約の上限を確認できませんでした。";
  if (value > caps.perTribute) return `1回の上限（${caps.perTribute} Pay）を超えています。`;
  if (todayUsed(contract, timestamp) + value > caps.perDay) return `今日の上限（${caps.perDay} Pay）を超えています。`;
  if ((Number(contract?.totalTributed) || 0) + value > caps.total) return `契約の合計上限（${caps.total} Pay）を超えています。`;
  return "";
}

function pairId(managerUid, payerUid) {
  return `${managerUid}__${payerUid}`;
}

module.exports = {
  TRIBUTE_SCHEMA_VERSION,
  TRIBUTE_AGE_VERSION,
  PER_TRIBUTE_OPTIONS,
  PER_DAY_OPTIONS,
  TOTAL_OPTIONS,
  DURATION_DAYS_OPTIONS,
  ENTRY_FEE_OPTIONS,
  TONES,
  DISCLOSURES,
  MANAGER_STYLES,
  SIGIL_COLORS,
  REPORT_REASONS,
  SEVERE_REPORT_REASONS,
  POLICIES,
  LIMITS,
  HONOR_TIERS,
  FORBIDDEN_MESSAGES,
  cleanLine,
  cleanMultiline,
  textLength,
  forbiddenReason,
  normalizeNgWords,
  containsNgWord,
  normalizeCaps,
  capsAreLowerOrEqual,
  normalizeManagerCard,
  normalizeWalletName,
  normalizeApplication,
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
};
