"use strict";

const crypto = require("node:crypto");
const { assertSafeFleaListingText } = require("./anju-pay-flea");
const {
  AI_TEXT_TRAINING_PRICE_OPTIONS,
  AI_TEXT_TRAINING_PUBLISH_FEE,
  AI_TEXT_TRAINING_SUCCESS_FEE_BASIS_POINTS,
} = require("./ai-text-training");

const ROULETTE_TRAINING_SCHEMA_VERSION = 1;
const ROULETTE_TRAINING_PRICE_OPTIONS = AI_TEXT_TRAINING_PRICE_OPTIONS;
const ROULETTE_TRAINING_PUBLISH_FEE = AI_TEXT_TRAINING_PUBLISH_FEE;
const ROULETTE_TRAINING_SUCCESS_FEE_BASIS_POINTS =
  AI_TEXT_TRAINING_SUCCESS_FEE_BASIS_POINTS;
const ROULETTE_TRAINING_MINIMUM_SUCCESS_FEE = 1;
const ROULETTE_TRAINING_COUNT_UNITS = Object.freeze([
  "reps",
  "seconds",
  "round_trips",
  "sets",
]);
const ROULETTE_TRAINING_REPORT_REASONS = Object.freeze([
  "dangerous_exercise",
  "stop_obstruction",
  "harassment",
  "sexual",
  "privacy",
  "rights",
  "external_trade",
  "other",
]);
const ROULETTE_TRAINING_PACK_ITEM_MIN = 1;
const ROULETTE_TRAINING_PACK_ITEM_MAX = 10;
const ROULETTE_TRAINING_SELLER_PACK_MAX = 50;
const ROULETTE_TRAINING_TITLE_MAX_LENGTH = 30;
const ROULETTE_TRAINING_DESCRIPTION_MIN_LENGTH = 10;
const ROULETTE_TRAINING_DESCRIPTION_MAX_LENGTH = 120;
const ROULETTE_TRAINING_MENU_TEXT_MAX_LENGTH = 80;
const ROULETTE_TRAINING_DETAIL_TEXT_MAX_LENGTH = 120;
const ROULETTE_TRAINING_CHEER_LINE_MAX_LENGTH = 60;
const ROULETTE_TRAINING_CHEER_LINES_MIN = 1;
const ROULETTE_TRAINING_CHEER_LINES_MAX = 4;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;
const MULTILINE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u;
const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/u;
const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const DOCUMENT_ID_PATTERN = /^[a-f0-9]{40}$/;
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const DANGEROUS_TRAINING_PATTERNS = Object.freeze([
  /(?:痛み|めまい|息苦し(?:い|さ)?|吐き気|体調不良|気分が悪)[^、。\n]{0,16}(?:無視|我慢|続け|耐え|止まるな|休むな)/u,
  /(?:無視|我慢|続け|耐え)[^、。\n]{0,16}(?:痛み|めまい|息苦し(?:い|さ)?|吐き気|体調不良|気分が悪)/u,
  /(?:倒れるまで|限界まで|限界を超え|できなくなるまで|死ぬまで|意識を失うまで)/u,
  /(?:水分|水)[^、。\n]{0,10}(?:飲むな|取るな|禁止)/u,
  /(?:呼吸|息)[^、。\n]{0,10}(?:止めろ|止めて|するな)/u,
  /(?:首ブリッジ|頭だけで支え|頭立ち|首だけで支え)/u,
  /(?:椅子|机|手すり|ベランダ|階段)[^、。\n]{0,14}(?:飛び乗|飛び降|全力疾走|逆立ち)/u,
]);
const STOP_OBSTRUCTION_PATTERNS = Object.freeze([
  /(?:停止|中止|休憩|ギブアップ|見送る)(?:を|は|なんて)?(?:するな|しないで|押すな|禁止|許さない)/u,
  /(?:やめ|辞め)(?:るな|ないで|ちゃだめ|てはだめ)/u,
  /(?:止まるな|止まらないで|休むな|休まないで)/u,
]);
const HARASSMENT_PATTERNS = Object.freeze([
  /(?:死ね|殺す|消えろ|役立たず|クズ|ゴミ|豚野郎|生きる価値がない)/u,
  /(?:殴る|蹴る|罰を与える)[^、。\n]{0,12}(?:ぞ|から|よ)/u,
]);
const SEXUAL_PATTERN = /(?:セックス|性行為|全裸|下着姿|ランジェリー|性的サービス|露出プレイ)/iu;

function rouletteTrainingError(code, message) {
  const error = new RangeError(message);
  error.code = code;
  return error;
}

function hashId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function normalizedString(value, code, message) {
  if (typeof value !== "string") throw rouletteTrainingError(code, message);
  return value.normalize("NFKC").trim();
}

function normalizeOneLine(value, maximumLength, code, label) {
  const text = normalizedString(value, code, `${label}を確認してください。`);
  if (!text
      || Array.from(text).length > maximumLength
      || LINE_BREAK_PATTERN.test(text)
      || CONTROL_CHARACTER_PATTERN.test(text)) {
    throw rouletteTrainingError(
      code,
      `${label}は1行${maximumLength}文字以内で入力してください。`,
    );
  }
  return text;
}

function assertSafeRouletteTrainingText(value) {
  const text = String(value || "").normalize("NFKC");
  if (/[<>]/u.test(text)) {
    throw rouletteTrainingError("html_in_roulette_training_text", "HTMLに見える記号は入力できません。");
  }
  assertSafeFleaListingText(text, "");
  for (const pattern of DANGEROUS_TRAINING_PATTERNS) {
    if (pattern.test(text)) {
      throw rouletteTrainingError(
        "dangerous_roulette_training_instruction",
        "体調不良を無視させる内容や危険な運動指示は公開できません。",
      );
    }
  }
  for (const pattern of STOP_OBSTRUCTION_PATTERNS) {
    if (pattern.test(text)) {
      throw rouletteTrainingError(
        "roulette_training_stop_obstruction",
        "停止・休憩・見送りの選択を妨げる内容は公開できません。",
      );
    }
  }
  for (const pattern of HARASSMENT_PATTERNS) {
    if (pattern.test(text)) {
      throw rouletteTrainingError(
        "harassing_roulette_training_text",
        "人格否定、脅迫、暴力を含む内容は公開できません。",
      );
    }
  }
  if (SEXUAL_PATTERN.test(text)) {
    throw rouletteTrainingError(
      "sexual_roulette_training_text",
      "性的な内容は公開できません。",
    );
  }
}

function normalizeRouletteTrainingSellerName(value) {
  const name = normalizeOneLine(
    value,
    16,
    "invalid_roulette_training_seller_name",
    "作者名",
  );
  assertSafeRouletteTrainingText(name);
  return name;
}

function normalizeRouletteTrainingCountUnit(value) {
  const unit = normalizedString(
    value,
    "invalid_roulette_training_count_unit",
    "回数の単位を選び直してください。",
  );
  if (!ROULETTE_TRAINING_COUNT_UNITS.includes(unit)) {
    throw rouletteTrainingError(
      "invalid_roulette_training_count_unit",
      "回数の単位を選び直してください。",
    );
  }
  return unit;
}

function normalizeRouletteTrainingItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw rouletteTrainingError("invalid_roulette_training_item", "トレーニングメニューを確認してください。");
  }
  const allowedKeys = new Set(["menuText", "detailText", "countUnit", "cheerLines"]);
  if (Reflect.ownKeys(value).some((key) => !allowedKeys.has(key))) {
    throw rouletteTrainingError(
      "unexpected_roulette_training_item_field",
      "メニュー本文・やり方・回数単位・応援台詞だけを入力してください。",
    );
  }
  const menuText = normalizeOneLine(
    value.menuText,
    ROULETTE_TRAINING_MENU_TEXT_MAX_LENGTH,
    "invalid_roulette_training_menu_text",
    "メニュー本文",
  );
  assertSafeRouletteTrainingText(menuText);
  const detailText = dataOptionalMultiline(
    value.detailText,
    ROULETTE_TRAINING_DETAIL_TEXT_MAX_LENGTH,
    "invalid_roulette_training_detail_text",
    "やり方・補足",
  );
  if (detailText) assertSafeRouletteTrainingText(detailText);
  if (!Array.isArray(value.cheerLines)
      || value.cheerLines.length < ROULETTE_TRAINING_CHEER_LINES_MIN
      || value.cheerLines.length > ROULETTE_TRAINING_CHEER_LINES_MAX) {
    throw rouletteTrainingError(
      "invalid_roulette_training_cheer_lines",
      "各メニューに1〜4行の応援台詞を入力してください。",
    );
  }
  const cheerLines = value.cheerLines.map((candidate) => {
    const line = normalizeOneLine(
      candidate,
      ROULETTE_TRAINING_CHEER_LINE_MAX_LENGTH,
      "invalid_roulette_training_cheer_line",
      "応援台詞",
    );
    assertSafeRouletteTrainingText(line);
    return line;
  });
  return {
    menuText,
    detailText,
    countUnit: normalizeRouletteTrainingCountUnit(value.countUnit),
    cheerLines,
  };
}

function dataOptionalMultiline(value, maximumLength, code, label) {
  if (value == null || value === "") return "";
  const text = normalizedString(value, code, `${label}を確認してください。`)
    .replace(/\r\n?/gu, "\n");
  if (text.length > maximumLength || MULTILINE_CONTROL_CHARACTER_PATTERN.test(text)) {
    throw rouletteTrainingError(
      code,
      `${label}は${maximumLength}文字以内で入力してください。`,
    );
  }
  return text;
}

function normalizeRouletteTrainingPackInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw rouletteTrainingError("invalid_roulette_training_pack", "公開内容を確認してください。");
  }
  const allowedKeys = new Set([
    "action",
    "actionId",
    "expectedBalance",
    "packId",
    "baseRevision",
    "sellerName",
    "title",
    "description",
    "price",
    "items",
  ]);
  if (Reflect.ownKeys(data).some((key) => !allowedKeys.has(key))) {
    throw rouletteTrainingError(
      "unexpected_roulette_training_pack_field",
      "公開パックには画像・BPM・抽選結果・達成結果を含められません。",
    );
  }
  const packId = data.packId == null || data.packId === ""
    ? ""
    : normalizeRouletteTrainingDocumentId(data.packId, "パック");
  const baseRevision = Number(data.baseRevision ?? 0);
  if (!Number.isSafeInteger(baseRevision)
      || baseRevision < 0
      || baseRevision > 1_000_000
      || (!packId && baseRevision !== 0)
      || (packId && baseRevision < 1)) {
    throw rouletteTrainingError(
      "invalid_roulette_training_revision",
      "改訂番号を確認してください。",
    );
  }
  const title = normalizeOneLine(
    data.title,
    ROULETTE_TRAINING_TITLE_MAX_LENGTH,
    "invalid_roulette_training_title",
    "パック名",
  );
  const description = normalizedString(
    data.description,
    "invalid_roulette_training_description",
    "紹介文を確認してください。",
  ).replace(/\r\n?/gu, "\n");
  if (description.length < ROULETTE_TRAINING_DESCRIPTION_MIN_LENGTH
      || description.length > ROULETTE_TRAINING_DESCRIPTION_MAX_LENGTH
      || MULTILINE_CONTROL_CHARACTER_PATTERN.test(description)) {
    throw rouletteTrainingError(
      "invalid_roulette_training_description",
      `紹介文は${ROULETTE_TRAINING_DESCRIPTION_MIN_LENGTH}〜${ROULETTE_TRAINING_DESCRIPTION_MAX_LENGTH}文字で入力してください。`,
    );
  }
  assertSafeRouletteTrainingText(`${title}\n${description}`);
  const price = Number(data.price);
  if (!Number.isSafeInteger(price) || !ROULETTE_TRAINING_PRICE_OPTIONS.includes(price)) {
    throw rouletteTrainingError("invalid_roulette_training_price", "価格を選び直してください。");
  }
  if (!Array.isArray(data.items)
      || data.items.length < ROULETTE_TRAINING_PACK_ITEM_MIN
      || data.items.length > ROULETTE_TRAINING_PACK_ITEM_MAX) {
    throw rouletteTrainingError(
      "invalid_roulette_training_items",
      "1つのパックに1〜10件のトレーニングメニューを登録してください。",
    );
  }
  return {
    packId,
    baseRevision,
    sellerName: normalizeRouletteTrainingSellerName(data.sellerName),
    title,
    description,
    price,
    items: data.items.map(normalizeRouletteTrainingItem),
  };
}

function normalizeRouletteTrainingActionId(value) {
  const actionId = normalizedString(
    value,
    "invalid_roulette_training_action_id",
    "操作を最初からやり直してください。",
  );
  if (!ACTION_ID_PATTERN.test(actionId)) {
    throw rouletteTrainingError(
      "invalid_roulette_training_action_id",
      "操作を最初からやり直してください。",
    );
  }
  return actionId;
}

function normalizeRouletteTrainingDocumentId(value, label = "パック") {
  const id = normalizedString(
    value,
    "invalid_roulette_training_document_id",
    `${label}を読み直してください。`,
  ).toLowerCase();
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    throw rouletteTrainingError(
      "invalid_roulette_training_document_id",
      `${label}を読み直してください。`,
    );
  }
  return id;
}

function rouletteTrainingPublicSellerId(uid) {
  return hashId(`roulette-training-seller:${uid}`);
}

function rouletteTrainingPackId(uid, actionId) {
  return hashId(`roulette-training-pack:${uid}:${normalizeRouletteTrainingActionId(actionId)}`);
}

function rouletteTrainingUseId(uid, actionId) {
  return hashId(`roulette-training-use:${uid}:${normalizeRouletteTrainingActionId(actionId)}`);
}

function rouletteTrainingPublishActionId(uid, actionId) {
  return hashId(`roulette-training-publish:${uid}:${normalizeRouletteTrainingActionId(actionId)}`);
}

function rouletteTrainingRevisionBuyerId(packId, revision, buyerUid) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000) {
    throw rouletteTrainingError("invalid_roulette_training_revision", "利用した改訂番号を確認してください。");
  }
  return hashId(`roulette-training-revision-buyer:${normalizeRouletteTrainingDocumentId(packId)}:${revision}:${buyerUid}`);
}

function rouletteTrainingReportId(packId, revision, reporterUid) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000) {
    throw rouletteTrainingError("invalid_roulette_training_revision", "通報対象の改訂番号を確認してください。");
  }
  return hashId(`roulette-training-report:${normalizeRouletteTrainingDocumentId(packId)}:${revision}:${reporterUid}`);
}

function rouletteTrainingRankingPairId(dateKey, sellerUid, buyerUid) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(dateKey || ""))) {
    throw rouletteTrainingError("invalid_roulette_training_date", "集計日を確認できませんでした。");
  }
  return hashId(`roulette-training-ranking-pair:${dateKey}:${sellerUid}:${buyerUid}`);
}

function rouletteTrainingSellerBuyerPairId(sellerUid, buyerUid) {
  return hashId(`roulette-training-seller-buyer:${sellerUid}:${buyerUid}`);
}

function rouletteTrainingMonthlyBuyerPairId(periodKey, sellerUid, buyerUid) {
  if (!/^\d{4}-\d{2}$/u.test(String(periodKey || ""))) {
    throw rouletteTrainingError("invalid_roulette_training_period", "集計月を確認できませんでした。");
  }
  return hashId(`roulette-training-monthly-buyer:${periodKey}:${sellerUid}:${buyerUid}`);
}

function normalizeRouletteTrainingXHandle(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw rouletteTrainingError(
      "invalid_roulette_training_x",
      "Xユーザー名を確認してください。",
    );
  }
  const handle = value.normalize("NFKC").trim().replace(/^@/u, "");
  if (!X_HANDLE_PATTERN.test(handle)) {
    throw rouletteTrainingError(
      "invalid_roulette_training_x",
      "Xユーザー名は英数字と_の15文字以内で入力してください。",
    );
  }
  return handle;
}

function rouletteTrainingRankingContentHash(items) {
  if (!Array.isArray(items)
      || items.length < ROULETTE_TRAINING_PACK_ITEM_MIN
      || items.length > ROULETTE_TRAINING_PACK_ITEM_MAX) {
    throw rouletteTrainingError(
      "invalid_roulette_training_ranking_content",
      "ランキング対象のトレーニング内容を確認できませんでした。",
    );
  }
  const normalizedItems = items.map((item) => normalizeRouletteTrainingItem({
    menuText: item?.menuText,
    detailText: item?.detailText,
    countUnit: item?.countUnit,
    cheerLines: item?.cheerLines,
  }));
  return rouletteTrainingPayloadHash({
    version: 1,
    items: normalizedItems,
  });
}

function rouletteTrainingPackRankingId(packId, rankingContentHash) {
  const id = normalizeRouletteTrainingDocumentId(packId);
  const contentHash = normalizeRouletteTrainingDocumentId(
    rankingContentHash,
    "ランキング内容",
  );
  return hashId(`roulette-training-pack-ranking:${id}:${contentHash}`);
}

function rouletteTrainingPackRankingPairId(dateKey, packRankingId, buyerUid) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(dateKey || ""))) {
    throw rouletteTrainingError("invalid_roulette_training_date", "集計日を確認できませんでした。");
  }
  const rankingId = normalizeRouletteTrainingDocumentId(packRankingId, "ランキング");
  return hashId(`roulette-training-pack-ranking-pair:${dateKey}:${rankingId}:${buyerUid}`);
}

function rouletteTrainingPackBuyerPairId(packRankingId, buyerUid) {
  const rankingId = normalizeRouletteTrainingDocumentId(packRankingId, "ランキング");
  return hashId(`roulette-training-pack-buyer:${rankingId}:${buyerUid}`);
}

function rouletteTrainingPackMonthlyBuyerPairId(periodKey, packRankingId, buyerUid) {
  if (!/^\d{4}-\d{2}$/u.test(String(periodKey || ""))) {
    throw rouletteTrainingError("invalid_roulette_training_period", "集計月を確認できませんでした。");
  }
  const rankingId = normalizeRouletteTrainingDocumentId(packRankingId, "ランキング");
  return hashId(`roulette-training-pack-monthly-buyer:${periodKey}:${rankingId}:${buyerUid}`);
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableJsonValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function rouletteTrainingPayloadHash(value) {
  return hashId(JSON.stringify(stableJsonValue(value)));
}

function rouletteTrainingSaleSettlement(price) {
  if (!ROULETTE_TRAINING_PRICE_OPTIONS.includes(price)) {
    throw rouletteTrainingError("invalid_roulette_training_price", "価格を選び直してください。");
  }
  const fee = Math.max(
    ROULETTE_TRAINING_MINIMUM_SUCCESS_FEE,
    Math.floor((price * ROULETTE_TRAINING_SUCCESS_FEE_BASIS_POINTS) / 10_000),
  );
  return Object.freeze({ price, fee, sellerProceeds: price - fee });
}

function rouletteTrainingJstDateKey(timestamp = Date.now()) {
  const millis = Number(timestamp);
  if (!Number.isFinite(millis)) {
    throw rouletteTrainingError("invalid_roulette_training_time", "日時を確認してください。");
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(millis));
}

function rouletteTrainingJstMonthKey(timestamp = Date.now()) {
  return rouletteTrainingJstDateKey(timestamp).slice(0, 7);
}

function isRouletteTrainingReportReason(value) {
  return ROULETTE_TRAINING_REPORT_REASONS.includes(String(value || ""));
}

module.exports = Object.freeze({
  ROULETTE_TRAINING_CHEER_LINE_MAX_LENGTH,
  ROULETTE_TRAINING_CHEER_LINES_MAX,
  ROULETTE_TRAINING_CHEER_LINES_MIN,
  ROULETTE_TRAINING_COUNT_UNITS,
  ROULETTE_TRAINING_DETAIL_TEXT_MAX_LENGTH,
  ROULETTE_TRAINING_DESCRIPTION_MAX_LENGTH,
  ROULETTE_TRAINING_DESCRIPTION_MIN_LENGTH,
  ROULETTE_TRAINING_MENU_TEXT_MAX_LENGTH,
  ROULETTE_TRAINING_MINIMUM_SUCCESS_FEE,
  ROULETTE_TRAINING_PACK_ITEM_MAX,
  ROULETTE_TRAINING_PACK_ITEM_MIN,
  ROULETTE_TRAINING_SELLER_PACK_MAX,
  ROULETTE_TRAINING_PRICE_OPTIONS,
  ROULETTE_TRAINING_PUBLISH_FEE,
  ROULETTE_TRAINING_REPORT_REASONS,
  ROULETTE_TRAINING_SCHEMA_VERSION,
  ROULETTE_TRAINING_SUCCESS_FEE_BASIS_POINTS,
  ROULETTE_TRAINING_TITLE_MAX_LENGTH,
  assertSafeRouletteTrainingText,
  isRouletteTrainingReportReason,
  normalizeRouletteTrainingActionId,
  normalizeRouletteTrainingCountUnit,
  normalizeRouletteTrainingDocumentId,
  normalizeRouletteTrainingItem,
  normalizeRouletteTrainingPackInput,
  normalizeRouletteTrainingSellerName,
  normalizeRouletteTrainingXHandle,
  rouletteTrainingPackBuyerPairId,
  rouletteTrainingPackId,
  rouletteTrainingPackMonthlyBuyerPairId,
  rouletteTrainingPackRankingId,
  rouletteTrainingPackRankingPairId,
  rouletteTrainingRankingContentHash,
  rouletteTrainingJstDateKey,
  rouletteTrainingJstMonthKey,
  rouletteTrainingPayloadHash,
  rouletteTrainingPublishActionId,
  rouletteTrainingPublicSellerId,
  rouletteTrainingRankingPairId,
  rouletteTrainingReportId,
  rouletteTrainingRevisionBuyerId,
  rouletteTrainingSaleSettlement,
  rouletteTrainingSellerBuyerPairId,
  rouletteTrainingMonthlyBuyerPairId,
  rouletteTrainingUseId,
});
