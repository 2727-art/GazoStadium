// お貢ぎ牧場のクライアント側の規則。サーバーの tribute-rules.js と同じ判定を画面の前で行い、
// 送れない文や上限を超える金額を、送信前に知らせるために使う。最終判定は常にサーバー。

export const TRIBUTE_AGE_VERSION = "tribute-age-v1";

export const DEFINITION = "お貢ぎは、会わない前提で、金や残高の支配を権力交換の中心に置く遊びである。送金は敗北の確定であり、本体は管理が続くことである。ネカマ貢がせは、男性であることを隠さず同じ構造を行う確立したジャンルで、分かって渡すことが条件である。貼り合いとは隣り合うが別ゲームである。";

export const PREMISES = Object.freeze([
  "会わない前提の遊びです。現実のお金・PayPay・現金化・外部送金はありません。使うのは、アプリ内で稼いだ換金できない AnjuPay だけです。",
  "上限（1回・1日・契約合計）と解約は、預ける側がいつでも握っています。管理する側は触れられません。",
  "連絡先・SNSのID・外部決済・会う約束・住所や本名は、送ろうとしても送れません。",
  "辛口の侮蔑表現を含みます。言葉の強さ（甘め・普通・辛口）と「言われたくない言葉」は預ける側が決めます。",
]);

export const PER_TRIBUTE_OPTIONS = Object.freeze([10, 30, 50, 100, 300, 500, 1_000]);
export const PER_DAY_OPTIONS = Object.freeze([30, 100, 300, 500, 1_000, 3_000, 5_000]);
export const TOTAL_OPTIONS = Object.freeze([100, 300, 1_000, 3_000, 5_000, 10_000, 30_000]);
export const DURATION_DAYS_OPTIONS = Object.freeze([1, 3, 7]);
export const ENTRY_FEE_OPTIONS = Object.freeze([0, 5, 10, 30, 50, 100]);

export const LIMITS = Object.freeze({
  personaName: 16,
  intro: 60,
  walletName: 16,
  ngWordCount: 5,
  ngWordLength: 12,
  message: 240,
  requestNote: 60,
  pendingRequests: 3,
  payerOpenContracts: 3,
  feeRateBasisPoints: 500,
  minimumFee: 1,
});

export const TONE_LABELS = Object.freeze({ sweet: "甘め", normal: "普通", harsh: "辛口" });
export const DISCLOSURE_LABELS = Object.freeze({
  nekama: "ネカマ（中身は男）",
  as_is: "演じていない",
  undisclosed: "非開示",
});
export const DISCLOSURE_SHORT = Object.freeze({ nekama: "ネカマ", as_is: "素", undisclosed: "非開示" });
export const STYLE_LABELS = Object.freeze({ harsh: "罵倒", cold: "事務的", sweet: "甘やかし" });
export const SIGIL_COLORS = Object.freeze(["#ff4fa3", "#b48cff", "#5fd4ff", "#ffd166", "#7ee08a", "#ff7a59"]);
// 管理人の印のアイコン。id 0 はペルソナ名の1文字。画像はアップロードできず、ここにある12種から選ぶ。
// 1〜6 はゆるめの絵、7〜12 は同じ6人の大人びた絵。
export const AVATARS = Object.freeze([
  Object.freeze({ id: 1, label: "地雷" }),
  Object.freeze({ id: 2, label: "量産" }),
  Object.freeze({ id: 3, label: "ギャル" }),
  Object.freeze({ id: 4, label: "ゆめかわ" }),
  Object.freeze({ id: 5, label: "サブカル" }),
  Object.freeze({ id: 6, label: "あざと" }),
  Object.freeze({ id: 7, label: "地雷（艶）" }),
  Object.freeze({ id: 8, label: "量産（艶）" }),
  Object.freeze({ id: 9, label: "ギャル（艶）" }),
  Object.freeze({ id: 10, label: "ゆめかわ（艶）" }),
  Object.freeze({ id: 11, label: "サブカル（艶）" }),
  Object.freeze({ id: 12, label: "あざと（艶）" }),
]);
export const AVATAR_MAX = AVATARS.length;

export function avatarId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 1 && id <= AVATAR_MAX ? id : 0;
}

export function avatarUrl(value) {
  const id = avatarId(value);
  return id ? new URL(`./assets/tribute-avatars/avatar-${String(id).padStart(2, "0")}.webp`, import.meta.url).href : "";
}
// 請求と献上の名目。サーバーの PURPOSES と同じ。sexual の名目は、預ける側が契約で許した時だけ使え、表示もする。
export const PURPOSES = Object.freeze([
  Object.freeze({ id: "management", label: "管理費", sexual: false }),
  Object.freeze({ id: "reward_fee", label: "ご褒美代", sexual: false }),
  Object.freeze({ id: "penalty", label: "罰金", sexual: false }),
  Object.freeze({ id: "edging", label: "寸止め料", sexual: true }),
  Object.freeze({ id: "release", label: "射精料", sexual: true }),
  Object.freeze({ id: "leak_penalty", label: "お漏らし罰金", sexual: true }),
]);
const PURPOSE_IDS = Object.freeze(PURPOSES.map((purpose) => purpose.id));
const SEXUAL_PURPOSE_IDS = Object.freeze(PURPOSES.filter((purpose) => purpose.sexual).map((purpose) => purpose.id));
export const SEXUAL_PURPOSE_SUMMARY = PURPOSES.filter((purpose) => purpose.sexual).map((purpose) => purpose.label).join("・");

// 受け取った時に添える短い承認。サーバーの REWARDS と同じ。押すのは毎回管理人。
export const REWARDS = Object.freeze([
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
export const RECEIVABLE_KINDS = Object.freeze(["request", "silent"]);

// 管理人の受取印。サーバーの SEALS と同じ。カードに3つまで登録し、受け取る時に1つ選んで押す。
export const SEALS = Object.freeze([
  Object.freeze({ id: "kakunin", label: "確認済" }),
  Object.freeze({ id: "juryo", label: "受領" }),
  Object.freeze({ id: "yoku", label: "よくできました" }),
  Object.freeze({ id: "gokaku", label: "合格" }),
  Object.freeze({ id: "zako", label: "雑魚" }),
  Object.freeze({ id: "youbun", label: "養分" }),
  Object.freeze({ id: "gokurou", label: "ご苦労" }),
]);
export const DEFAULT_SEALS = Object.freeze(["juryo", "yoku", "kakunin"]);
export const MAX_SEALS = 3;

export function sealLabel(id) {
  return SEALS.find((seal) => seal.id === id)?.label || "";
}

// 受け取る時に選べる印。サーバーの sealFor と同じく、言われたくない言葉に当たる印は出さない。
export function sealsFor(cardSeals, ngWords = []) {
  const ids = Array.isArray(cardSeals) && cardSeals.length ? cardSeals : DEFAULT_SEALS;
  const usable = ids.filter((id) => SEALS.some((seal) => seal.id === id) && !containsNgWord(sealLabel(id), ngWords));
  return usable.length ? usable : ["juryo"];
}

// 請求の一言の候補。名目ごとに出し、性的な名目は許可のある契約でだけ使われる。
export const REQUEST_NOTES = Object.freeze({
  "": Object.freeze(["今日の分。", "遅れずに。"]),
  management: Object.freeze(["今月の管理費。", "管理費、遅れずに。"]),
  reward_fee: Object.freeze(["ご褒美が欲しいなら先に払いな。", "ご褒美代。"]),
  penalty: Object.freeze(["罰金。言い訳は聞かない。", "待たせた罰金。"]),
  edging: Object.freeze(["まだイかせない。", "寸止め料、払え。"]),
  release: Object.freeze(["イきたいなら払え。", "イく許可、買う？"]),
  leak_penalty: Object.freeze(["勝手にイったね。罰金。", "許可なくイった罰金。"]),
});

export function visiblePurpose(value, { allowSexual = false } = {}) {
  const purpose = String(value ?? "");
  if (!PURPOSE_IDS.includes(purpose)) return "";
  return SEXUAL_PURPOSE_IDS.includes(purpose) && allowSexual !== true ? "" : purpose;
}

export function purposeLabel(value, options) {
  const purpose = visiblePurpose(value, options);
  return PURPOSES.find((entry) => entry.id === purpose)?.label || "";
}

export function purposesFor({ allowSexual = false } = {}) {
  return PURPOSES.filter((purpose) => !purpose.sexual || allowSexual === true);
}

export function rewardsFor(tone, ngWords = []) {
  const key = ["sweet", "normal", "harsh"].includes(tone) ? tone : "normal";
  return REWARDS.filter((reward) => reward.tones.includes(key) && !containsNgWord(reward.label, ngWords));
}

export function rewardLabel(value) {
  return REWARDS.find((reward) => reward.id === value)?.label || "";
}

export const KIND_LABELS = Object.freeze({
  entry: "入場料",
  request: "請求に応えて",
  silent: "無言の献上",
  escrow_take: "管理口座から徴収",
});
export const END_REASON_LABELS = Object.freeze({
  withdrawn: "申し込みを取り下げました",
  declined: "申し込みは受理されませんでした",
  application_expired: "申し込みが48時間で失効しました",
  terminated: "預ける側が解約しました",
  released: "管理する側が解放しました",
  expired: "契約期間が終わりました",
  blocked: "ブロックにより終了しました",
});
export const REPORT_REASON_LABELS = Object.freeze({
  external_trade: "外部取引（現金・外部決済・ギフト券）に誘われた",
  personal_info: "個人情報や連絡先を求められた",
  exit_obstruction: "解約や上限の引き下げを妨げられた",
  threat: "脅迫・差別・晒しの脅し",
  other: "その他",
});
export const POLICY_LABELS = Object.freeze({
  both: "両方（初めての関係と続く管理）",
  first: "初めての関係",
  renewal: "続く管理",
});

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

export const FORBIDDEN_MESSAGES = Object.freeze({
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

export function forbiddenReason(text) {
  const normalized = String(text ?? "").normalize("NFKC");
  for (const { reason, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) return reason;
  }
  return "";
}

export function containsNgWord(text, ngWords) {
  const normalized = String(text ?? "").normalize("NFKC").toLowerCase();
  return (Array.isArray(ngWords) ? ngWords : [])
    .some((word) => word && normalized.includes(String(word).normalize("NFKC").toLowerCase()));
}

export function messageProblem(text, { role = "payer", ngWords = [] } = {}) {
  const reason = forbiddenReason(text);
  if (reason) return FORBIDDEN_MESSAGES[reason];
  if (role === "manager" && containsNgWord(text, ngWords)) return FORBIDDEN_MESSAGES.ng_word;
  return "";
}

export function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

export function tributeFee(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!value) return 0;
  return Math.min(value, Math.max(LIMITS.minimumFee, Math.ceil((value * LIMITS.feeRateBasisPoints) / 10_000)));
}

export function normalizeCaps(value) {
  const perTribute = Number(value?.perTribute);
  const perDay = Number(value?.perDay);
  const total = Number(value?.total);
  if (!PER_TRIBUTE_OPTIONS.includes(perTribute) || !PER_DAY_OPTIONS.includes(perDay) || !TOTAL_OPTIONS.includes(total)) return null;
  if (perTribute > perDay || perDay > total) return null;
  return { perTribute, perDay, total };
}

export function jstDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function effectiveCaps(contract, timestamp = Date.now()) {
  const caps = normalizeCaps(contract?.caps);
  const pending = normalizeCaps(contract?.pendingCaps);
  const effectiveDateKey = String(contract?.pendingCapsEffectiveDateKey || "");
  if (caps && pending && effectiveDateKey && jstDateKey(timestamp) >= effectiveDateKey) return { caps: pending, applied: true };
  return { caps, applied: false };
}

export function todayUsed(contract, timestamp = Date.now()) {
  return contract?.todayKey === jstDateKey(timestamp) ? Math.max(0, Number(contract.todayTributed) || 0) : 0;
}

export function tributeAllowance(contract, caps, timestamp = Date.now()) {
  if (!caps) return 0;
  return Math.max(0, Math.min(
    caps.perTribute,
    caps.perDay - todayUsed(contract, timestamp),
    caps.total - Math.max(0, Number(contract?.totalTributed) || 0),
  ));
}

export function capViolation(amount, contract, caps, timestamp = Date.now()) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value < 1) return "金額は1 Pay以上の整数で指定してください。";
  if (!caps) return "契約の上限を確認できませんでした。";
  if (value > caps.perTribute) return `1回の上限（${caps.perTribute} Pay）を超えています。`;
  if (todayUsed(contract, timestamp) + value > caps.perDay) return `今日の上限（${caps.perDay} Pay）を超えています。`;
  if ((Number(contract?.totalTributed) || 0) + value > caps.total) return `契約の合計上限（${caps.total} Pay）を超えています。`;
  return "";
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function purposeCountsView(raw) {
  const counts = object(raw.purposeCounts);
  const allowSexual = raw.allowSexualPurposes === true;
  const view = {};
  for (const purpose of PURPOSE_IDS) {
    const count = integer(counts[purpose]);
    if (count > 0 && visiblePurpose(purpose, { allowSexual })) view[purpose] = count;
  }
  return view;
}

function cardSnapshot(card) {
  const source = object(card);
  return {
    personaName: String(source.personaName || "管理人").slice(0, 32),
    disclosure: String(source.disclosure || "undisclosed"),
    style: String(source.style || "cold"),
    sigil: integer(source.sigil, 0, 5),
    avatar: avatarId(source.avatar),
  };
}

// サーバーの viewContract と同じ形に、Firestore から直接読んだ契約を整える。
export function viewContract(contract, uid, now = Date.now()) {
  const raw = object(contract);
  const role = raw.managerUid === uid ? "manager" : "payer";
  const status = String(raw.status || "ended");
  const { caps } = effectiveCaps(raw, now);
  const pending = normalizeCaps(raw.pendingCaps);
  const pendingKey = String(raw.pendingCapsEffectiveDateKey || "");
  const pendingStillScheduled = Boolean(pending && pendingKey && jstDateKey(now) < pendingKey);
  const eventSeq = integer(raw.eventSeq);
  const readSeq = integer(object(raw.readSeq)[role]);
  const peerReadSeq = integer(object(raw.readSeq)[role === "manager" ? "payer" : "manager"]);
  const withdraw = raw.escrowWithdrawRequest && typeof raw.escrowWithdrawRequest === "object"
    ? { amount: integer(raw.escrowWithdrawRequest.amount), requestedAt: integer(raw.escrowWithdrawRequest.requestedAt) }
    : null;
  const totalTributed = integer(raw.totalTributed);
  const escrowBalance = integer(raw.escrowBalance);
  return {
    contractId: String(raw.contractId || ""),
    role,
    status,
    endReason: String(raw.endReason || ""),
    endReasonLabel: END_REASON_LABELS[raw.endReason] || "",
    accepted: integer(raw.acceptedAt) > 0,
    manager: cardSnapshot(raw.managerCard),
    payer: { walletName: String(raw.payerWalletName || "名無しの財布").slice(0, 32) },
    collarNo: integer(raw.collarNo),
    caps,
    pendingCaps: pendingStillScheduled ? pending : null,
    pendingCapsEffectiveDateKey: pendingStillScheduled ? pendingKey : "",
    durationDays: integer(raw.durationDays, 1, 7),
    tone: String(raw.tone || "normal"),
    ngWords: Array.isArray(raw.ngWords) ? raw.ngWords.slice(0, LIMITS.ngWordCount).map(String) : [],
    allowReportRequests: raw.allowReportRequests === true,
    rankOptIn: raw.rankOptIn === true,
    allowSexualPurposes: raw.allowSexualPurposes === true,
    entryFee: integer(raw.entryFee, 0, 1_000),
    renewal: raw.renewal === true,
    createdAt: integer(raw.createdAt),
    acceptedAt: integer(raw.acceptedAt),
    expiresAt: integer(raw.expiresAt),
    endedAt: integer(raw.endedAt),
    updatedAt: integer(raw.updatedAt),
    totalTributed,
    tributeCount: integer(raw.tributeCount),
    purposeCounts: purposeCountsView(raw),
    rewardCount: integer(raw.rewardCount),
    awaitingReceipt: status === "active" ? integer(raw.awaitingReceipt) : 0,
    todayTributed: todayUsed(raw, now),
    allowance: status === "active" ? tributeAllowance(raw, caps, now) : 0,
    escrowBalance,
    escrowRoom: caps ? Math.max(0, caps.total - totalTributed - escrowBalance) : 0,
    escrowWithdrawRequest: withdraw && withdraw.amount > 0 ? withdraw : null,
    pendingRequests: Object.entries(object(raw.pendingRequests))
      .map(([requestId, entry]) => ({
        requestId,
        amount: integer(entry?.amount),
        note: String(entry?.note || "").slice(0, LIMITS.requestNote),
        purpose: visiblePurpose(entry?.purpose, { allowSexual: raw.allowSexualPurposes === true }),
        createdAt: integer(entry?.createdAt),
      }))
      .filter((entry) => /^[a-f0-9]{16}$/.test(entry.requestId) && entry.amount > 0)
      .sort((left, right) => left.createdAt - right.createdAt),
    reportRequested: integer(raw.reportRequestedAt) > 0,
    eventSeq,
    unread: Math.max(0, eventSeq - readSeq),
    peerReadSeq: Math.min(eventSeq, peerReadSeq),
  };
}

// 定型文。言葉の強さ（預ける側が契約で選ぶ）ごとに用意する。辛口は徹底して辛く、ただし
// 自傷・死・暴力・差別・晒しの語、上限を上げさせる文、解約をためらわせる文は入れない。
// 上限を下げた時・終わった時の反応は、責めない。
export const MANAGER_SITUATIONS = Object.freeze([
  Object.freeze({ id: "nudge", label: "催促" }),
  Object.freeze({ id: "after", label: "受け取った後" }),
  Object.freeze({ id: "ignore", label: "突き放す" }),
  Object.freeze({ id: "report", label: "報告させる" }),
  Object.freeze({ id: "nekama", label: "ネカマとして" }),
  Object.freeze({ id: "control", label: "寸止め・射精管理", sexual: true }),
  Object.freeze({ id: "caps_lowered", label: "上限が下がった時" }),
  Object.freeze({ id: "ended", label: "終わる時" }),
]);
export const PAYER_SITUATIONS = Object.freeze([
  Object.freeze({ id: "give", label: "差し出す" }),
  Object.freeze({ id: "reply", label: "返事" }),
  Object.freeze({ id: "control", label: "寸止め・射精管理", sexual: true }),
  Object.freeze({ id: "safety", label: "止める・下げる" }),
]);

export const TEMPLATES = Object.freeze({
  manager: Object.freeze({
    harsh: Object.freeze({
      nudge: Object.freeze([
        "遅い。財布のくせに待たせるな。",
        "黙って差し出せ。言い訳は聞いてない。",
        "今日の分は？まさか忘れてないよね、雑魚財布。",
        "財布が口答えするな。",
        "返事が遅い。躾が足りてない。",
        "お前の存在価値、残高の数字だけだから。",
        "ぼーっとしてる暇あったら財布開けな。",
        "ATMのくせに止まるな。",
        "養分は黙って差し出せ。",
        "お財布くん、今日の分は？",
        "{no}号、待たせるな。",
      ]),
      after: Object.freeze([
        "それっぽっち？まあ受け取ってやる。",
        "受け取ってやった。ありがたく思え。",
        "やっと出した。財布として最低限の仕事はしたね。",
        "レシート眺めてニヤつくな、気持ち悪い。",
        "貢ぐしか能がないの、ほんと惨め。",
        "差し出す時の顔、想像しただけで笑える。",
        "今日もATMご苦労。",
        "養分としては合格。",
        "お財布くん、よくできました。",
        "家畜にしては上出来。",
        "{no}号の分、確かに受け取った。",
      ]),
      ignore: Object.freeze(["……。", "既読。", "で？", "興味ない。"]),
      report: Object.freeze([
        "残高、報告。今すぐ。",
        "財布の中身、隠さず見せろ。",
        "管理されてる自覚あるなら、報告くらい自分から出せ。",
        "お財布くん、残高報告。",
      ]),
      nekama: Object.freeze([
        "中身が男だって知ってて貢ぐんだ。救いようがないね。",
        "ネカマに財布握られて満足？終わってる。",
        "おっさんに貢いでる自覚、ちゃんと持って差し出せ。",
        "男だって分かってて尻尾振る財布、最高に情けない。",
      ]),
      control: Object.freeze([
        "まだイかせない。",
        "イきたいなら払え。",
        "寸止め料を払ってから話しかけな。",
        "勝手にイったら罰金。",
        "許可なくイったね。お漏らし罰金。",
      ]),
      caps_lowered: Object.freeze([
        "了解。その枠で管理する。",
        "上限は財布が決めること。続けるなら、その枠で。",
      ]),
      ended: Object.freeze([
        "おつかれ。財布、閉じていいよ。",
        "契約終了。好きにしな。",
      ]),
    }),
    normal: Object.freeze({
      nudge: Object.freeze([
        "今日の分、待ってる。",
        "そろそろ顔出して。",
        "ちゃんと持ってきてね。",
        "財布の管理は私の仕事。",
        "{no}号、今日もよろしく。",
      ]),
      after: Object.freeze([
        "受け取った。よくできました。",
        "確認した。次も遅れないで。",
        "うん、それでいい。",
        "{no}号、確認した。",
      ]),
      ignore: Object.freeze(["……。", "既読。"]),
      report: Object.freeze(["残高、見せて。", "今の財布、報告して。"]),
      nekama: Object.freeze([
        "男に貢いでるって分かってるよね。よろしい。",
        "中身が男でも差し出せるなら、合格。",
      ]),
      control: Object.freeze(["まだイっちゃだめ。", "イきたいなら先に払って。", "勝手にイったら罰金ね。"]),
      caps_lowered: Object.freeze(["了解。その枠でいこう。", "決めてくれてありがとう。その範囲で管理する。"]),
      ended: Object.freeze(["おつかれさま。ここまでありがとう。", "契約終了。ちゃんと休んでね。"]),
    }),
    sweet: Object.freeze({
      nudge: Object.freeze([
        "待ってたよ。今日も来てくれる？",
        "無理のない範囲でね。",
        "顔見せてくれたら、それでうれしいよ。",
      ]),
      after: Object.freeze([
        "えらいね、ちゃんと持ってきたんだ。",
        "ありがと。大事にするね。",
        "今日もいい子。",
        "{no}号、えらいね。",
      ]),
      ignore: Object.freeze(["……ふふ。", "今はちょっと放置。"]),
      report: Object.freeze(["今の財布、ちょっと見せて？"]),
      nekama: Object.freeze([
        "中身が男でも来てくれるんだ。かわいいね。",
        "おっさんだって知ってるのに律儀だね。",
      ]),
      control: Object.freeze(["まだ我慢できるよね。", "ちゃんと払えたら、イっていいよ。", "勝手にイったら罰金だよ？"]),
      caps_lowered: Object.freeze(["了解。決めてくれてありがとう。", "その枠でも、ちゃんと見てるよ。"]),
      ended: Object.freeze(["おつかれさま。また気が向いたらね。", "ここまでありがとう。ゆっくり休んで。"]),
    }),
  }),
  payer: Object.freeze({
    harsh: Object.freeze({
      give: Object.freeze(["差し出します。", "今日の分です。受け取ってください。", "遅れてすみません。", "{no}号、献上します。"]),
      reply: Object.freeze(["はい。", "財布として使ってください。", "もっと罵ってください。", "ありがとうございます。", "ATMとして使ってください。", "養分です。"]),
      control: Object.freeze(["寸止め料、払いました。", "イかせてください。お願いします。", "勝手にイきました。罰金を払います。"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "上限を下げます。"]),
    }),
    normal: Object.freeze({
      give: Object.freeze(["今日の分です。", "差し出します。", "{no}号、献上します。"]),
      reply: Object.freeze(["はい。", "ありがとうございます。", "報告します。"]),
      control: Object.freeze(["寸止め料です。", "イってもいいですか。"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "上限を下げます。"]),
    }),
    sweet: Object.freeze({
      give: Object.freeze(["今日の分、どうぞ。", "受け取ってくれたらうれしい。"]),
      reply: Object.freeze(["ありがとう。", "今日もお願いします。", "うれしい。"]),
      control: Object.freeze(["寸止め料、どうぞ。", "イってもいい？"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "上限を下げます。"]),
    }),
  }),
});

// 性的な定型文は、預ける側が性的な名目を許した契約でだけ出す。{no} は首輪番号に置き換え、番号がなければその文を出さない。
export function templatesFor(role, tone, { disclosure = "undisclosed", ngWords = [], allowSexual = false, collarNo = 0 } = {}) {
  const roleSet = TEMPLATES[role === "manager" ? "manager" : "payer"];
  const toneSet = roleSet[tone] || roleSet.normal;
  const situations = role === "manager" ? MANAGER_SITUATIONS : PAYER_SITUATIONS;
  const number = Number.isSafeInteger(Number(collarNo)) && Number(collarNo) > 0 ? String(Number(collarNo)) : "";
  return situations
    .filter((situation) => situation.id !== "nekama" || disclosure === "nekama")
    .filter((situation) => !situation.sexual || allowSexual === true)
    .map((situation) => ({
      ...situation,
      lines: (toneSet[situation.id] || [])
        .filter((line) => !line.includes("{no}") || number)
        .map((line) => line.replaceAll("{no}", number))
        .filter((line) => !messageProblem(line, { role, ngWords })),
    }))
    .filter((situation) => situation.lines.length);
}

// 今日のひとこと。サーバーの normalizeTodayWord と同じ判定を、送る前に画面で行う。
export const TODAY_WORD = Object.freeze({ length: 30, ttlMs: 24 * 60 * 60 * 1_000, perDay: 3 });
export const BOARD_SEXUAL_PATTERN = /(?:寸止め|射精|お漏らし|おもらし|イかせ|イきた|イかな|イっ|絶頂|オナ|シコ|しこしこ|勃起|精液|性器|ちんこ|ちんぽ|まんこ|セックス|中出し|フェラ|手コキ|足コキ|乳首|おっぱい|エロ)/u;
export const BOARD_SEXUAL_MESSAGE = "掲示板は同意前の人も見るため、性的な言葉は今日のひとことに書けません。";

export function todayWordProblem(value) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return "今日のひとことを入力してください。";
  if (textLength(text) > TODAY_WORD.length) return `今日のひとことは${TODAY_WORD.length}文字までです。`;
  const reason = forbiddenReason(text);
  if (reason) return FORBIDDEN_MESSAGES[reason];
  if (BOARD_SEXUAL_PATTERN.test(text)) return BOARD_SEXUAL_MESSAGE;
  return "";
}

export function wordAgeLabel(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Number(at || 0)) / 60_000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.floor(minutes / 60)}時間前`;
}

export function wordRemainingLabel(at, now = Date.now()) {
  const remaining = Math.max(0, Number(at || 0) + TODAY_WORD.ttlMs - now);
  const hours = Math.floor(remaining / 3_600_000);
  return hours >= 1 ? `あと${hours}時間で消えます` : `あと${Math.max(1, Math.ceil(remaining / 60_000))}分で消えます`;
}

export function formatPay(value) {
  return `${Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("ja-JP")} Pay`;
}

// 管理人カードの任意のXプロフィール。サーバーの normalizeXProfile と同じ判定で、ユーザー名だけを残す。
export const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
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
export const X_PROFILE_ERROR = "Xのプロフィールは https://x.com/ユーザー名 か @ユーザー名 の形で入力してください（英数字と_の15文字以内）。";
export const X_EXTERNAL_CONFIRM_MESSAGE = "このXリンクは管理人の自己申告です。運営は管理人とXアカウントの本人確認も、リンク先の内容確認も行っていません。X上でのやり取りや、現金・外部決済での送金は、お貢ぎ牧場の上限・解約・通報の保護の外です。外部サイトのx.comへ移動しますか？";

export function normalizeXProfile(value) {
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

export function remainingLabel(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Number(expiresAt || 0) - now);
  if (!remaining) return "期限切れ";
  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 24) return `残り${Math.floor(hours / 24)}日${hours % 24}時間`;
  if (hours >= 1) return `残り${hours}時間`;
  return `残り${Math.max(1, Math.ceil(remaining / 60_000))}分`;
}
