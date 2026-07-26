"use strict";

const crypto = require("node:crypto");

const FLEA_SCHEMA_VERSION = 1;
const FLEA_LISTING_FEE = 1;
const FLEA_PRICE_OPTIONS = Object.freeze([10, 25, 50]);
const FLEA_SUCCESS_FEE_BASIS_POINTS = 500;
const FLEA_CATEGORIES = Object.freeze([
  "illustration",
  "photo",
  "outfit",
]);
const FLEA_TITLE_MAX_LENGTH = 30;
const FLEA_DESCRIPTION_MIN_LENGTH = 20;
const FLEA_DESCRIPTION_MAX_LENGTH = 240;
const FLEA_REPORT_REASONS = Object.freeze([
  "rights",
  "privacy",
  "adult",
  "external_trade",
  "other",
]);
const FLEA_LISTING_STATUSES = Object.freeze([
  "active",
  "sold",
  "canceled",
  "expired",
  "hidden",
]);

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/iu;
const URL_PATTERN = /(?:https?:\/\/|www\.|(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+(?:app|biz|com|dev|gg|info|io|jp|me|net|org|xyz)(?:[/?#][^\s]*)?)/iu;
const PHONE_PATTERN = /(?:^|[^\d])(?:0\d{1,4}[-‐‑‒–—―ー−]\d{1,4}[-‐‑‒–—―ー−]\d{3,4}|0[789]0\d{8})(?:$|[^\d])/u;
const POSTAL_CODE_PATTERN = /(?:〒\s*)?\d{3}[-‐‑‒–—―ー−]\d{4}/u;
const PRECISE_ADDRESS_PATTERN = /(?:(?:東京都|北海道|(?:京都|大阪)府|[一-龠々]{2,3}県)[^\s、。\n]{0,28}(?:市|区|郡|町|村)[^\s、。\n]{0,24}(?:\d{1,4}[-‐‑‒–—―ー−]\d{1,4}(?:[-‐‑‒–—―ー−]\d{1,4})?|[0-9〇一二三四五六七八九十百千]+\s*(?:丁目|番地|番\s*[0-9〇一二三四五六七八九十百千]+\s*号|号室)))/u;
const LABELED_PERSONAL_INFORMATION_PATTERN = /(?:住所|電話番号|携帯番号|本名|氏名|学校名|勤務先)\s*[:：]/u;
const PERSONAL_INFORMATION_REQUEST_PATTERN = /(?:(?:住所|電話番号|携帯番号|本名|氏名|学校名|勤務先|連絡先).{0,16}(?:教えて|送って|書いて|公開して|交換して|知らせて|ください|下さい)|(?:教えて|送って|書いて|公開して|交換して|知らせて).{0,16}(?:住所|電話番号|携帯番号|本名|氏名|学校名|勤務先|連絡先))/u;
const SOCIAL_HANDLE_PATTERN = /(?:^|[^\p{L}\p{N}_])@[A-Za-z0-9_]{1,32}\b/u;
const SOCIAL_SEARCH_DIRECTION_PATTERN = /(?:(?:\bX\b|Twitter|ツイッター)(?:で|から|を|へ|に)?[^、。\n]{0,18}(?:検索(?:して|してください|して下さい)?|探して|見て|確認して|アクセスして|移動して|飛んで|来て|連絡して|\bDM\b)|(?:固定ポスト|固定ツイート)[^、。\n]{0,16}(?:見て|確認して|検索して)|(?:プロフィール|プロフ)[^、。\n]{0,16}(?:連絡して|\bDM\b|メッセージして|送金して|支払って))/iu;
const CONTACT_SOLICITATION_PATTERN = /(?:(?:\bDM\b|ダイレクトメッセージ|(?:\bLINE\b|ライン)(?:\s*ID)?|(?:\bDiscord\b|ディスコード)(?:\s*ID)?|メール|電話|SMS).{0,18}(?:連絡|送信|メッセージ|追加|登録|交換|教えて|送って|ください|下さい)|(?:連絡|送信|メッセージ|追加|登録|交換|教えて|送って).{0,18}(?:\bDM\b|ダイレクトメッセージ|(?:\bLINE\b|ライン)(?:\s*ID)?|(?:\bDiscord\b|ディスコード)(?:\s*ID)?|メール|電話|SMS))/iu;
const EXTERNAL_PAYMENT_PATTERN = /(?:(?:PayPay|楽天(?:Pay|ペイ)|LINE\s*Pay|メルペイ|d払い|au\s*PAY|Apple\s*Pay|Google\s*Pay|銀行(?:口座|振込)|口座振込|現金|クレジットカード|クレカ|デビットカード|電子マネー|暗号資産|仮想通貨|ギフト(?:カード|コード)|プリペイド(?:カード|コード))[^、。\n]{0,20}(?:のみ|払|支払|振り込|振込|送金|決済|代金|購入|注文|取引)|(?:払|支払|振り込|振込|送金|決済|代金)[^、。\n]{0,20}(?:PayPay|楽天(?:Pay|ペイ)|LINE\s*Pay|メルペイ|d払い|au\s*PAY|Apple\s*Pay|Google\s*Pay|銀行(?:口座|振込)|口座振込|現金|クレジットカード|クレカ|デビットカード|電子マネー|暗号資産|仮想通貨|ギフト(?:カード|コード)|プリペイド(?:カード|コード)))/iu;
const EXTERNAL_MARKET_PATTERN = /(?:(?:メルカリ|ヤフオク|ラクマ|BOOTH|FANBOX|外部サイト|別サイト).{0,18}(?:購入|注文|取引|販売|出品|移動|買って|ください|下さい)|(?:購入|注文|取引|販売|出品|移動|買って).{0,18}(?:メルカリ|ヤフオク|ラクマ|BOOTH|FANBOX|外部サイト|別サイト))/iu;
const DIRECT_TRADE_PATTERN = /(?:直接(?:の)?取引|外部取引)(?:を|は|で|に|\s)*(?:希望|募集|します|しましょう|してください|お願いします)/u;
const DELIVERY_SOLICITATION_PATTERN = /(?:発送|郵送|手渡し|実物を送付)(?:を|は|で|に|\s)*(?:します|いたします|できます|しましょう|希望|募集)/u;
const PHYSICAL_FULFILLMENT_PATTERN = /(?:(?:実物|現物|本物(?:の)?(?:服|衣服|衣類|洋服|商品|品物))[^、。\n]{0,20}(?:発送|郵送|宅配|配送|送付|手渡|受け渡|お渡|引き渡|受け取|取りに来|引き取)|(?:発送|郵送|宅配|配送|送付|手渡|受け渡|お渡|引き渡|受け取|取りに来|引き取)[^、。\n]{0,20}(?:実物|現物|本物(?:の)?(?:服|衣服|衣類|洋服|商品|品物))|送料(?:込み|込|別|負担|無料)|着払い|元払い)/u;
const PICKUP_OR_MEETING_PATTERN = /(?:(?:駅|改札|駅前|公園|コンビニ|カフェ|店頭|駐車場|ロッカー)[^、。\n]{0,20}(?:待ち合わせ|集合|会って|会おう|会いましょう|受け取|受け渡|手渡|引き取|取りに来|お渡)|(?:待ち合わせ|集合|会って|会おう|会いましょう|受け取|受け渡|手渡|引き取|取りに来|お渡)[^、。\n]{0,20}(?:駅|改札|駅前|公園|コンビニ|カフェ|店頭|駐車場|ロッカー))/u;
const ADULT_OR_PRIVACY_CONTENT_PATTERN = /(?:R-?18|18禁|成人向け|アダルト|ポルノ|NSFW|エロ|えろ|性的(?:サービス|描写|画像|写真|ディープフェイク)?|セックス|性行為|ヌード|全裸|半裸|裸(?:体|の|姿|身)|下着|ランジェリー|フェティッシュ|盗撮|児童ポルノ|児童性的|未成年.{0,8}性的|性的.{0,8}未成年|使用済み(?:下着|衣類)|援助交際|売春|ロリ(?:画像|写真|動画|裸|性的|きわどい)|ショタ(?:画像|写真|動画|裸|性的|きわどい)|(?:JK|女子高生|未成年)[^、。\n]{0,10}(?:きわどい|性的|ヌード|下着|無修正|エロ)|(?:きわどい|性的|ヌード|下着|無修正|エロ)[^、。\n]{0,10}(?:JK|女子高生|未成年))/iu;
const REGULATED_GOODS_TRADE_PATTERN = /(?:(?:拳銃|実銃|銃器|銃|弾薬|ナイフ|刀剣|爆弾|爆発物|火薬|大麻|麻薬|覚醒剤|違法薬物|盗品|偽造品)[^、。\n]{0,24}(?:売|買|販売|購入|取引|譲|渡|発送|郵送|配送|送付|手渡|受け取|引き取|注文|在庫)|(?:売|買|販売|購入|取引|譲|渡|発送|郵送|配送|送付|手渡|受け取|引き取|注文|在庫)[^、。\n]{0,24}(?:拳銃|実銃|銃器|銃|弾薬|ナイフ|刀剣|爆弾|爆発物|火薬|大麻|麻薬|覚醒剤|違法薬物|盗品|偽造品))/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u;
const SINGLE_LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/u;
const X_POST_PATH_PATTERN = /^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]+)$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fleaError(code, message) {
  const error = new RangeError(message);
  error.code = code;
  return error;
}

function normalizedString(value, code, message) {
  if (typeof value !== "string") throw fleaError(code, message);
  return value.normalize("NFKC").trim();
}

function validTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp)) {
    throw fleaError("invalid_timestamp", "日時を確認してください。");
  }
  return timestamp;
}

function validDateKey(value) {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const start = Date.parse(`${value}T00:00:00+09:00`);
  if (!Number.isFinite(start)) return false;
  return fleaJstDateKey(start) === value;
}

function fleaJstDateKey(timestamp = Date.now()) {
  const millis = validTimestamp(timestamp);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(millis));
}

function fleaExpiresAt(timestamp = Date.now()) {
  const dateKey = fleaJstDateKey(timestamp);
  const startsAt = Date.parse(`${dateKey}T00:00:00+09:00`);
  if (!Number.isFinite(startsAt)) {
    throw fleaError("invalid_timestamp", "日時を確認してください。");
  }
  return startsAt + (24 * 60 * 60 * 1000);
}

function normalizeFleaXPostUrl(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw fleaError("invalid_x_post_url", "XポストのURLを確認してください。");
  }
  const source = value.normalize("NFKC").trim();
  if (!source) return "";

  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw fleaError("invalid_x_post_url", "XポストのURLを確認してください。");
  }
  const hostname = parsed.hostname.toLowerCase();
  const pathMatch = X_POST_PATH_PATTERN.exec(parsed.pathname);
  if (
    parsed.protocol !== "https:"
    || !["x.com", "www.x.com"].includes(hostname)
    || parsed.username
    || parsed.password
    || parsed.port
    || !pathMatch
  ) {
    throw fleaError("invalid_x_post_url", "XポストのURLを確認してください。");
  }
  return `https://x.com/${pathMatch[1]}/status/${pathMatch[2]}`;
}

function assertSafeFleaListingText(title, description) {
  const text = `${title}\n${description}`;
  const scanText = text.replace(/\s+/gu, " ");
  const compactText = text.replace(/\s+/gu, "");
  const matches = (pattern) => pattern.test(scanText) || pattern.test(compactText);
  if (matches(EMAIL_PATTERN)) {
    throw fleaError("email_in_listing_text", "メールアドレスは説明文へ入力できません。");
  }
  if (matches(URL_PATTERN)) {
    throw fleaError("url_in_listing_text", "URLはXポストの専用欄だけに入力してください。");
  }
  if (
    matches(PHONE_PATTERN)
    || matches(POSTAL_CODE_PATTERN)
    || matches(PRECISE_ADDRESS_PATTERN)
    || matches(LABELED_PERSONAL_INFORMATION_PATTERN)
    || matches(PERSONAL_INFORMATION_REQUEST_PATTERN)
  ) {
    throw fleaError("personal_information_in_listing_text", "個人情報やその交換を求める内容は入力できません。");
  }
  if (
    matches(SOCIAL_HANDLE_PATTERN)
    || matches(SOCIAL_SEARCH_DIRECTION_PATTERN)
    || matches(CONTACT_SOLICITATION_PATTERN)
  ) {
    throw fleaError("contact_solicitation_in_listing_text", "ゲーム外の連絡を求める内容は入力できません。");
  }
  if (
    matches(EXTERNAL_PAYMENT_PATTERN)
    || matches(EXTERNAL_MARKET_PATTERN)
    || matches(DIRECT_TRADE_PATTERN)
    || matches(DELIVERY_SOLICITATION_PATTERN)
    || matches(PHYSICAL_FULFILLMENT_PATTERN)
    || matches(PICKUP_OR_MEETING_PATTERN)
  ) {
    throw fleaError("external_trade_in_listing_text", "ゲーム外の取引や実物の受け渡しを求める内容は入力できません。");
  }
  if (
    matches(ADULT_OR_PRIVACY_CONTENT_PATTERN)
    || matches(REGULATED_GOODS_TRADE_PATTERN)
  ) {
    throw fleaError("restricted_trade_in_listing_text", "成人向けまたは違法・規制対象の内容は入力できません。");
  }
}

function normalizeFleaSellerName(value) {
  const name = normalizedString(
    value,
    "invalid_flea_seller_name",
    "表示名は1行16文字以内で入力してください。",
  );
  if (
    !name
    || name.length > 16
    || SINGLE_LINE_BREAK_PATTERN.test(name)
    || CONTROL_CHARACTER_PATTERN.test(name)
  ) {
    throw fleaError(
      "invalid_flea_seller_name",
      "表示名は1行16文字以内で入力してください。",
    );
  }
  assertSafeFleaListingText(name, "");
  return name;
}

function normalizeFleaListingInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw fleaError("invalid_listing_input", "出品内容を確認してください。");
  }
  const category = normalizedString(
    data.category,
    "invalid_flea_category",
    "カテゴリを選び直してください。",
  );
  if (!FLEA_CATEGORIES.includes(category)) {
    throw fleaError("invalid_flea_category", "カテゴリを選び直してください。");
  }
  if (!Number.isSafeInteger(data.price) || !FLEA_PRICE_OPTIONS.includes(data.price)) {
    throw fleaError("invalid_flea_price", "価格を選び直してください。");
  }

  const title = normalizedString(
    data.title,
    "invalid_flea_title",
    `タイトルは1行${FLEA_TITLE_MAX_LENGTH}文字以内で入力してください。`,
  );
  if (
    !title
    || title.length > FLEA_TITLE_MAX_LENGTH
    || SINGLE_LINE_BREAK_PATTERN.test(title)
    || CONTROL_CHARACTER_PATTERN.test(title)
  ) {
    throw fleaError(
      "invalid_flea_title",
      `タイトルは1行${FLEA_TITLE_MAX_LENGTH}文字以内で入力してください。`,
    );
  }

  const rawDescription = normalizedString(
    data.description,
    "invalid_flea_description",
    `説明文は${FLEA_DESCRIPTION_MIN_LENGTH}〜${FLEA_DESCRIPTION_MAX_LENGTH}文字で入力してください。`,
  );
  const description = rawDescription.replace(/\r\n?/gu, "\n");
  if (
    description.length < FLEA_DESCRIPTION_MIN_LENGTH
    || description.length > FLEA_DESCRIPTION_MAX_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(description)
  ) {
    throw fleaError(
      "invalid_flea_description",
      `説明文は${FLEA_DESCRIPTION_MIN_LENGTH}〜${FLEA_DESCRIPTION_MAX_LENGTH}文字で入力してください。`,
    );
  }

  assertSafeFleaListingText(title, description);
  const xPostUrl = normalizeFleaXPostUrl(data.xPostUrl);
  if (xPostUrl && data.xConsent !== true) {
    throw fleaError(
      "x_post_consent_required",
      "Xポストを判断材料として案内することに同意してください。",
    );
  }
  return Object.freeze({
    category,
    title,
    description,
    price: data.price,
    xPostUrl,
    xConsent: Boolean(xPostUrl),
  });
}

function fleaSaleSettlement(price) {
  if (!Number.isSafeInteger(price) || !FLEA_PRICE_OPTIONS.includes(price)) {
    throw fleaError("invalid_flea_price", "価格を選び直してください。");
  }
  const feeAmount = Math.max(
    1,
    Math.ceil((price * FLEA_SUCCESS_FEE_BASIS_POINTS) / 10_000),
  );
  return Object.freeze({
    grossAmount: price,
    feeAmount,
    sellerProceeds: price - feeAmount,
  });
}

function effectiveFleaListingStatus(listing, now = Date.now()) {
  const currentTime = validTimestamp(now);
  const source = listing && typeof listing === "object" ? listing : {};
  const status = typeof source.status === "string" ? source.status : "";
  if (status !== "active") {
    return FLEA_LISTING_STATUSES.includes(status) ? status : "expired";
  }
  const expiresAt = Number(source.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > currentTime
    ? "active"
    : "expired";
}

function deterministicFleaId(namespace, values) {
  return crypto
    .createHash("sha256")
    .update(`anju-pay-flea:${namespace}:v${FLEA_SCHEMA_VERSION}\0`)
    .update(values.join("\0"))
    .digest("hex")
    .slice(0, 40);
}

function normalizedUid(uid) {
  if (
    typeof uid !== "string"
    || !uid
    || uid.length > 128
    || CONTROL_CHARACTER_PATTERN.test(uid)
  ) {
    throw fleaError("invalid_flea_uid", "プレイヤー情報を確認してください。");
  }
  return uid;
}

function fleaListingId(uid, dateKey) {
  const normalizedUserId = normalizedUid(uid);
  if (typeof dateKey !== "string" || !validDateKey(dateKey)) {
    throw fleaError("invalid_flea_date_key", "出品日を確認してください。");
  }
  return deterministicFleaId("listing", [normalizedUserId, dateKey]);
}

function fleaPublicSellerId(uid) {
  return deterministicFleaId("seller", [normalizedUid(uid)]);
}

function isFleaReportReason(value) {
  return typeof value === "string" && FLEA_REPORT_REASONS.includes(value);
}

module.exports = Object.freeze({
  FLEA_CATEGORIES,
  FLEA_DESCRIPTION_MAX_LENGTH,
  FLEA_DESCRIPTION_MIN_LENGTH,
  FLEA_LISTING_FEE,
  FLEA_LISTING_STATUSES,
  FLEA_PRICES: FLEA_PRICE_OPTIONS,
  FLEA_PRICE_OPTIONS,
  FLEA_REPORT_REASONS,
  FLEA_SCHEMA_VERSION,
  FLEA_SUCCESS_FEE_BASIS_POINTS,
  FLEA_TITLE_MAX_LENGTH,
  assertSafeFleaListingText,
  effectiveFleaListingStatus,
  fleaExpiresAt,
  fleaJstDateKey,
  fleaListingId,
  fleaPublicSellerId,
  fleaSaleSettlement,
  isFleaReportReason,
  normalizeFleaListingInput,
  normalizeFleaSellerName,
  normalizeFleaXPostUrl,
});
