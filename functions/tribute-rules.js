"use strict";

// お貢ぎ牧場の純粋な規則。上限・入力・禁止表現・手数料・称号をここに集め、サービスとテストで共有する。
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
// 管理人の印のアイコン。0 はペルソナ名の1文字、1〜12 は用意したアイコン（画像のアップロードはない）。
const AVATAR_IDS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const AVATAR_MAX = 12;

// 保存済みの値を読む時も、範囲外は端のアイコンに寄せず文字の印に戻す（クライアントの avatarId と同じ）。
function normalizeAvatar(value) {
  return pickOption(value, AVATAR_IDS, 0);
}
// 請求と献上の名目。sexual の名目は、預ける側が契約で許した時だけ使え、許可を外すと表示もしない。
const PURPOSES = Object.freeze([
  Object.freeze({ id: "management", label: "管理費", sexual: false }),
  Object.freeze({ id: "reward_fee", label: "ご褒美代", sexual: false }),
  Object.freeze({ id: "penalty", label: "罰金", sexual: false }),
  Object.freeze({ id: "edging", label: "寸止め料", sexual: true }),
  Object.freeze({ id: "release", label: "射精料", sexual: true }),
  Object.freeze({ id: "leak_penalty", label: "お漏らし罰金", sexual: true }),
]);
const PURPOSE_IDS = Object.freeze(PURPOSES.map((purpose) => purpose.id));
const SEXUAL_PURPOSE_IDS = Object.freeze(PURPOSES.filter((purpose) => purpose.sexual).map((purpose) => purpose.id));
// 受け取った時に添える短い承認。押すのは毎回管理人で、システムからは出さない。言葉の強さごとに選べるものが変わる。
const REWARDS = Object.freeze([
  Object.freeze({ id: "gohoubi", label: "ご褒美♡", tones: Object.freeze(["sweet", "normal", "harsh"]) }),
  Object.freeze({ id: "fufu", label: "ふふ♡ご褒美♡", tones: Object.freeze(["sweet", "normal", "harsh"]) }),
  Object.freeze({ id: "iiko", label: "いい子♡", tones: Object.freeze(["sweet", "normal"]) }),
  Object.freeze({ id: "erai", label: "えらいね", tones: Object.freeze(["sweet", "normal"]) }),
  Object.freeze({ id: "arigato", label: "ありがと♡", tones: Object.freeze(["sweet"]) }),
  Object.freeze({ id: "yoku", label: "よくできました", tones: Object.freeze(["normal"]) }),
  Object.freeze({ id: "zako", label: "ざこ♡", tones: Object.freeze(["harsh"]) }),
  Object.freeze({ id: "soreppocchi", label: "それっぽっち？", tones: Object.freeze(["harsh"]) }),
  Object.freeze({ id: "tsugi", label: "次も持ってきな", tones: Object.freeze(["harsh"]) }),
]);
const RECEIVABLE_KINDS = Object.freeze(["request", "silent"]);
// 管理人の受取印。カードに一覧から3つまで登録し、受け取る時に1つ選んで押す。自由入力はない。
const SEALS = Object.freeze([
  Object.freeze({ id: "kakunin", label: "確認済" }),
  Object.freeze({ id: "juryo", label: "受領" }),
  Object.freeze({ id: "yoku", label: "よくできました" }),
  Object.freeze({ id: "gokaku", label: "合格" }),
  Object.freeze({ id: "zako", label: "雑魚" }),
  Object.freeze({ id: "youbun", label: "養分" }),
  Object.freeze({ id: "gokurou", label: "ご苦労" }),
]);
const SEAL_IDS = Object.freeze(SEALS.map((seal) => seal.id));
const DEFAULT_SEALS = Object.freeze(["juryo", "yoku", "kakunin"]);
const FALLBACK_SEAL = "juryo";
const MAX_SEALS = 3;
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
  Object.freeze({ id: "master", label: "牧場の主", threshold: 5_000, recommendationSlots: 3 }),
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
  meeting: "会う約束に関わる言葉は送れません。この牧場は会わない前提です。",
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

// 管理人カードの任意のXプロフィール。https://x.com/ユーザー名 か @ユーザー名 を受け取り、ユーザー名だけを保存する。
// リンクは表示の時に組み立てる。個別ポストや検索など、プロフィール以外のURLは受け付けない。
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
const X_PROFILE_HOSTS = Object.freeze(new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]));
const X_RESERVED_PATHS = Object.freeze(new Set([
  "home", "explore", "search", "notifications", "messages", "i", "intent", "settings", "compose",
  "login", "logout", "signup", "tos", "privacy", "hashtag", "share", "account", "jobs", "about",
  "help", "download", "communities", "lists", "bookmarks", "premium", "following", "followers",
]));
const X_PROFILE_ERROR = "Xのプロフィールは https://x.com/ユーザー名 か @ユーザー名 の形で入力してください（英数字と_の15文字以内）。";

function normalizeXProfile(value) {
  const raw = String(value ?? "").normalize("NFKC").trim();
  if (!raw) return { xHandle: "" };
  let handle = "";
  if (/^@?[A-Za-z0-9_]{1,15}$/u.test(raw)) {
    handle = raw.replace(/^@/u, "");
  } else {
    let url;
    try {
      url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
    } catch {
      return { error: X_PROFILE_ERROR };
    }
    if (!["https:", "http:"].includes(url.protocol)
      || !X_PROFILE_HOSTS.has(url.hostname.toLowerCase())
      || url.username
      || url.password
      || url.port) {
      return { error: X_PROFILE_ERROR };
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return { error: X_PROFILE_ERROR };
    handle = segments[0].replace(/^@/u, "");
  }
  if (!X_HANDLE_PATTERN.test(handle) || X_RESERVED_PATHS.has(handle.toLowerCase())) return { error: X_PROFILE_ERROR };
  return { xHandle: handle };
}

// カードに登録する受取印。一覧にあるものだけを、重複なく3つまで。空なら既定の3つ。
function normalizeSeals(value) {
  const list = Array.isArray(value) ? value : [];
  const seals = [...new Set(list.map(String).filter((id) => SEAL_IDS.includes(id)))].slice(0, MAX_SEALS);
  return seals.length ? seals : [...DEFAULT_SEALS];
}

// 受け取る時に押す印。管理人が登録した印だけを使い、財布の「言われたくない言葉」に当たる印は「受領」に置き換える。
function sealFor(value, { seals = DEFAULT_SEALS, ngWords = [] } = {}) {
  const registered = normalizeSeals(seals);
  const requested = String(value ?? "");
  const id = registered.includes(requested) ? requested : registered[0];
  const seal = SEALS.find((entry) => entry.id === id);
  return seal && !containsNgWord(seal.label, ngWords) ? id : FALLBACK_SEAL;
}

function normalizeManagerCard(value) {
  const personaName = cleanLine(value?.personaName, LIMITS.personaName);
  const intro = cleanLine(value?.intro, LIMITS.intro);
  const disclosure = pickEnum(value?.disclosure, DISCLOSURES);
  const style = pickEnum(value?.style, MANAGER_STYLES);
  const entryFee = pickOption(value?.entryFee, ENTRY_FEE_OPTIONS);
  const sigil = pickOption(value?.sigil, SIGIL_COLORS, 0);
  const avatar = normalizeAvatar(value?.avatar);
  if (!personaName) return { error: "ペルソナ名を1〜16文字で入力してください。" };
  if (!disclosure) return { error: "中の人の札を選んでください。" };
  if (!style) return { error: "管理の型を選んでください。" };
  if (entryFee === null) return { error: "入場料を選び直してください。" };
  for (const text of [personaName, intro]) {
    const reason = forbiddenReason(text);
    if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  }
  const x = normalizeXProfile(value?.xProfile ?? value?.xHandle);
  if (x.error) return { error: x.error };
  return {
    card: {
      personaName,
      intro,
      disclosure,
      style,
      entryFee,
      sigil,
      avatar,
      seals: normalizeSeals(value?.seals),
      // 財布の貢ぎ報告の画像に、名前とアイコンを出してよいか。決めていないカードは出さない。
      reportConsent: value?.reportConsent === true,
      xHandle: x.xHandle,
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
      allowSexualPurposes: value?.allowSexualPurposes === true,
      walletName: normalizeWalletName(value?.walletName),
    },
  };
}

// 名目なしは空文字。性的な名目は、契約で預ける側が許している時だけ通す。
function normalizePurpose(value, { allowSexual = false } = {}) {
  const purpose = String(value ?? "");
  if (!purpose) return { purpose: "" };
  if (!PURPOSE_IDS.includes(purpose)) return { error: "名目を選び直してください。" };
  if (SEXUAL_PURPOSE_IDS.includes(purpose) && allowSexual !== true) {
    return { error: "この契約では、預ける側が性的な名目を許していません。" };
  }
  return { purpose };
}

// 保存済みの名目を表示用に読む。許可が外れた契約では、性的な名目を出さない。
function visiblePurpose(value, { allowSexual = false } = {}) {
  const purpose = String(value ?? "");
  if (!PURPOSE_IDS.includes(purpose)) return "";
  return SEXUAL_PURPOSE_IDS.includes(purpose) && allowSexual !== true ? "" : purpose;
}

function rewardsFor(tone, ngWords = []) {
  const key = TONES.includes(tone) ? tone : "normal";
  return REWARDS.filter((reward) => reward.tones.includes(key) && !containsNgWord(reward.label, ngWords));
}

function normalizeReward(value, { tone = "normal", ngWords = [] } = {}) {
  const reward = String(value ?? "");
  if (!reward) return { reward: "" };
  if (!rewardsFor(tone, ngWords).some((entry) => entry.id === reward)) {
    return { error: "このご褒美は、この契約では選べません。" };
  }
  return { reward };
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
  PURPOSES,
  PURPOSE_IDS,
  SEXUAL_PURPOSE_IDS,
  REWARDS,
  RECEIVABLE_KINDS,
  SEALS,
  SEAL_IDS,
  DEFAULT_SEALS,
  FALLBACK_SEAL,
  AVATAR_IDS,
  AVATAR_MAX,
  normalizeAvatar,
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
  normalizeSeals,
  sealFor,
  normalizeXProfile,
  X_HANDLE_PATTERN,
  normalizeWalletName,
  normalizeApplication,
  normalizePurpose,
  visiblePurpose,
  rewardsFor,
  normalizeReward,
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
