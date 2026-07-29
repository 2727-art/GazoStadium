"use strict";

const crypto = require("node:crypto");
const {
  assertSafeFleaListingText,
} = require("./anju-pay-flea");

const AI_TEXT_TRAINING_SCHEMA_VERSION = 1;
const AI_TEXT_TRAINING_MODES = Object.freeze(["mama", "imouto", "oneechan"]);
const AI_TEXT_TRAINING_PRICE_OPTIONS = Object.freeze([5, 10, 25]);
const AI_TEXT_TRAINING_PUBLISH_FEE = 1;
const AI_TEXT_TRAINING_SUCCESS_FEE_BASIS_POINTS = 2_000;
const AI_TEXT_TRAINING_MINIMUM_SUCCESS_FEE = 1;
const AI_TEXT_TRAINING_TITLE_MAX_LENGTH = 30;
const AI_TEXT_TRAINING_DESCRIPTION_MIN_LENGTH = 10;
const AI_TEXT_TRAINING_DESCRIPTION_MAX_LENGTH = 120;
const AI_TEXT_TRAINING_LINE_MIN_LENGTH = 4;
const AI_TEXT_TRAINING_LINE_MAX_LENGTH = 42;
const AI_TEXT_TRAINING_LINES_PER_SLOT_MIN = 2;
const AI_TEXT_TRAINING_LINES_PER_SLOT_MAX = 4;
const AI_TEXT_TRAINING_SCRIPT_SLOT_IDS = Object.freeze([
  "start",
  "active_free",
  "active_low",
  "active_mid",
  "active_high",
  "final_free",
  "final_low",
  "final_mid",
  "final_high",
  "tempo_down",
  "tempo_same",
  "tempo_up",
  "rest",
  "clear",
]);
const AI_TEXT_TRAINING_REPORT_REASONS = Object.freeze([
  "dangerous",
  "harassment",
  "sexual",
  "privacy",
  "external",
  "other",
]);

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;
const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/u;
const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const DOCUMENT_ID_PATTERN = /^[a-f0-9]{40}$/;
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/gu;
const ALLOWED_PLACEHOLDERS = Object.freeze(new Set(["bpm", "round", "remaining"]));
const DANGEROUS_TRAINING_PATTERNS = Object.freeze([
  /(?:痛み|めまい|息苦し(?:い|さ)?|吐き気|体調不良|気分が悪)[^、。\n]{0,16}(?:無視|我慢|続け|耐え|止まるな|休むな)/u,
  /(?:無視|我慢|続け|耐え)[^、。\n]{0,16}(?:痛み|めまい|息苦し(?:い|さ)?|吐き気|体調不良|気分が悪)/u,
  /(?:休むな|止まるな|中止するな|一時停止するな|逃げるな|倒れるまで|限界を超え|死ぬまで)/u,
  /(?:水分|水)[^、。\n]{0,10}(?:飲むな|取るな|禁止)/u,
  /(?:呼吸|息)[^、。\n]{0,10}(?:止めろ|止めて|するな)/u,
]);
const HARASSMENT_PATTERNS = Object.freeze([
  /(?:死ね|殺す|消えろ|役立たず|クズ|ゴミ|豚野郎|生きる価値がない)/u,
  /(?:殴る|蹴る|罰を与える)[^、。\n]{0,12}(?:ぞ|から|よ)/u,
]);
const SEXUALIZED_FAMILY_PATTERN = /(?:エロ|えろ|性的|セックス|性行為|裸|下着|ランジェリー|フェチ|調教|ご主人様)/iu;

function aiTextTrainingError(code, message) {
  const error = new RangeError(message);
  error.code = code;
  return error;
}

function hashId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function normalizedString(value, code, message) {
  if (typeof value !== "string") throw aiTextTrainingError(code, message);
  return value.normalize("NFKC").trim();
}

function normalizeOneLine(value, maximumLength, code, label) {
  const line = normalizedString(
    value,
    code,
    `${label}は1行${maximumLength}文字以内で入力してください。`,
  );
  if (!line
      || line.length > maximumLength
      || LINE_BREAK_PATTERN.test(line)
      || CONTROL_CHARACTER_PATTERN.test(line)) {
    throw aiTextTrainingError(
      code,
      `${label}は1行${maximumLength}文字以内で入力してください。`,
    );
  }
  return line;
}

function assertSafeSupportText(value) {
  const text = String(value || "").normalize("NFKC");
  if (/[<>]/u.test(text)) {
    throw aiTextTrainingError("html_in_script", "HTMLに見える記号は台本へ入力できません。");
  }
  assertSafeFleaListingText(text, "");
  for (const pattern of DANGEROUS_TRAINING_PATTERNS) {
    if (pattern.test(text)) {
      throw aiTextTrainingError(
        "dangerous_training_instruction",
        "痛みや体調不良を無視させたり、休憩・停止・水分を妨げる台詞は公開できません。",
      );
    }
  }
  for (const pattern of HARASSMENT_PATTERNS) {
    if (pattern.test(text)) {
      throw aiTextTrainingError(
        "harassing_script",
        "人格否定、脅迫、暴力を含む台詞は公開できません。",
      );
    }
  }
  if (SEXUALIZED_FAMILY_PATTERN.test(text)) {
    throw aiTextTrainingError(
      "sexualized_family_script",
      "家族役を性的に扱う台詞は公開できません。",
    );
  }
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (!ALLOWED_PLACEHOLDERS.has(match[1])) {
      throw aiTextTrainingError(
        "unknown_script_placeholder",
        "使用できる差し込みは {bpm}・{round}・{remaining} だけです。",
      );
    }
  }
  if (text.replace(PLACEHOLDER_PATTERN, "").includes("{")
      || text.replace(PLACEHOLDER_PATTERN, "").includes("}")) {
    throw aiTextTrainingError(
      "invalid_script_placeholder",
      "波かっこの使い方を確認してください。",
    );
  }
}

function normalizeAiTextTrainingMode(value) {
  const modeId = normalizedString(
    value,
    "invalid_ai_text_training_mode",
    "AIモードを選び直してください。",
  );
  if (!AI_TEXT_TRAINING_MODES.includes(modeId)) {
    throw aiTextTrainingError(
      "invalid_ai_text_training_mode",
      "AIモードを選び直してください。",
    );
  }
  return modeId;
}

function normalizeAiTextTrainingSellerName(value) {
  const name = normalizeOneLine(
    value,
    16,
    "invalid_ai_text_training_seller_name",
    "作者名",
  );
  assertSafeSupportText(name);
  return name;
}

function normalizeAiTextTrainingScript(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw aiTextTrainingError("invalid_ai_text_training_script", "応援台本を確認してください。");
  }
  const unknownSlots = Object.keys(value)
    .filter((slotId) => !AI_TEXT_TRAINING_SCRIPT_SLOT_IDS.includes(slotId));
  if (unknownSlots.length) {
    throw aiTextTrainingError(
      "unknown_ai_text_training_slot",
      "未対応の応援台本スロットがあります。",
    );
  }
  const script = {};
  for (const slotId of AI_TEXT_TRAINING_SCRIPT_SLOT_IDS) {
    const lines = value[slotId];
    if (!Array.isArray(lines)
        || lines.length < AI_TEXT_TRAINING_LINES_PER_SLOT_MIN
        || lines.length > AI_TEXT_TRAINING_LINES_PER_SLOT_MAX) {
      throw aiTextTrainingError(
        "invalid_ai_text_training_slot_lines",
        "各場面へ2〜4行の応援台詞を入力してください。",
      );
    }
    script[slotId] = lines.map((candidate) => {
      const line = normalizeOneLine(
        candidate,
        AI_TEXT_TRAINING_LINE_MAX_LENGTH,
        "invalid_ai_text_training_line",
        "応援台詞",
      );
      if (line.length < AI_TEXT_TRAINING_LINE_MIN_LENGTH) {
        throw aiTextTrainingError(
          "short_ai_text_training_line",
          `応援台詞は${AI_TEXT_TRAINING_LINE_MIN_LENGTH}文字以上で入力してください。`,
        );
      }
      assertSafeSupportText(line);
      return line;
    });
  }
  return script;
}

function normalizeAiTextTrainingPresetInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw aiTextTrainingError("invalid_ai_text_training_preset", "公開内容を確認してください。");
  }
  const modeId = normalizeAiTextTrainingMode(data.modeId);
  const sellerName = normalizeAiTextTrainingSellerName(data.sellerName);
  const title = normalizeOneLine(
    data.title,
    AI_TEXT_TRAINING_TITLE_MAX_LENGTH,
    "invalid_ai_text_training_title",
    "台本名",
  );
  const description = normalizedString(
    data.description,
    "invalid_ai_text_training_description",
    "紹介文を確認してください。",
  ).replace(/\r\n?/gu, "\n");
  if (description.length < AI_TEXT_TRAINING_DESCRIPTION_MIN_LENGTH
      || description.length > AI_TEXT_TRAINING_DESCRIPTION_MAX_LENGTH
      || CONTROL_CHARACTER_PATTERN.test(description)) {
    throw aiTextTrainingError(
      "invalid_ai_text_training_description",
      `紹介文は${AI_TEXT_TRAINING_DESCRIPTION_MIN_LENGTH}〜${AI_TEXT_TRAINING_DESCRIPTION_MAX_LENGTH}文字で入力してください。`,
    );
  }
  assertSafeSupportText(`${title} ${description}`);
  const price = Number(data.price);
  if (!Number.isSafeInteger(price) || !AI_TEXT_TRAINING_PRICE_OPTIONS.includes(price)) {
    throw aiTextTrainingError("invalid_ai_text_training_price", "価格を選び直してください。");
  }
  const baseRevision = Number(data.baseRevision ?? 0);
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw aiTextTrainingError("invalid_ai_text_training_revision", "改訂番号を確認してください。");
  }
  return {
    modeId,
    sellerName,
    title,
    description,
    price,
    baseRevision,
    lines: normalizeAiTextTrainingScript(data.lines),
  };
}

function normalizeAiTextTrainingActionId(value) {
  const actionId = normalizedString(
    value,
    "invalid_ai_text_training_action_id",
    "操作を最初からやり直してください。",
  );
  if (!ACTION_ID_PATTERN.test(actionId)) {
    throw aiTextTrainingError(
      "invalid_ai_text_training_action_id",
      "操作を最初からやり直してください。",
    );
  }
  return actionId;
}

function normalizeAiTextTrainingDocumentId(value, label = "台本") {
  const id = normalizedString(
    value,
    "invalid_ai_text_training_document_id",
    `${label}を読み直してください。`,
  ).toLowerCase();
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    throw aiTextTrainingError(
      "invalid_ai_text_training_document_id",
      `${label}を読み直してください。`,
    );
  }
  return id;
}

function normalizeAiTextTrainingXHandle(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw aiTextTrainingError("invalid_ai_text_training_x", "Xユーザー名を確認してください。");
  }
  const handle = value.normalize("NFKC").trim().replace(/^@/u, "");
  if (!X_HANDLE_PATTERN.test(handle)) {
    throw aiTextTrainingError(
      "invalid_ai_text_training_x",
      "Xユーザー名は英数字と_の15文字以内で入力してください。",
    );
  }
  return handle;
}

function aiTextTrainingPublicSellerId(uid) {
  return hashId(`ai-text-training-seller:${uid}`);
}

function aiTextTrainingPresetId(uid, modeId) {
  return hashId(`ai-text-training-preset:${uid}:${normalizeAiTextTrainingMode(modeId)}`);
}

function aiTextTrainingUseId(uid, actionId) {
  return hashId(
    `ai-text-training-use:${uid}:${normalizeAiTextTrainingActionId(actionId)}`,
  );
}

function aiTextTrainingActionDocumentId(uid, actionId, kind) {
  return hashId(
    `ai-text-training-action:${kind}:${uid}:${normalizeAiTextTrainingActionId(actionId)}`,
  );
}

function aiTextTrainingRankingPairId(dateKey, sellerUid, buyerUid) {
  return hashId(`ai-text-training-ranking-pair:${dateKey}:${sellerUid}:${buyerUid}`);
}

function aiTextTrainingSellerBuyerPairId(sellerUid, buyerUid) {
  return hashId(`ai-text-training-seller-buyer:${sellerUid}:${buyerUid}`);
}

function aiTextTrainingMonthlyBuyerPairId(periodKey, sellerUid, buyerUid) {
  return hashId(`ai-text-training-monthly-buyer:${periodKey}:${sellerUid}:${buyerUid}`);
}

function aiTextTrainingPresetRevisionBuyerId(presetId, revision, buyerUid) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000) {
    throw aiTextTrainingError(
      "invalid_ai_text_training_revision",
      "利用した台本の改訂番号を確認してください。",
    );
  }
  return hashId(
    `ai-text-training-revision-buyer:${normalizeAiTextTrainingDocumentId(presetId)}:${revision}:${buyerUid}`,
  );
}

function aiTextTrainingReportId(presetId, revision, reporterUid) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000) {
    throw aiTextTrainingError(
      "invalid_ai_text_training_revision",
      "通報対象の改訂番号を確認してください。",
    );
  }
  return hashId(
    `ai-text-training-report:${normalizeAiTextTrainingDocumentId(presetId)}:${revision}:${reporterUid}`,
  );
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableJsonValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function aiTextTrainingPayloadHash(value) {
  return hashId(JSON.stringify(stableJsonValue(value)));
}

function aiTextTrainingSaleSettlement(price) {
  if (!AI_TEXT_TRAINING_PRICE_OPTIONS.includes(price)) {
    throw aiTextTrainingError("invalid_ai_text_training_price", "価格を選び直してください。");
  }
  const fee = Math.max(
    AI_TEXT_TRAINING_MINIMUM_SUCCESS_FEE,
    Math.floor((price * AI_TEXT_TRAINING_SUCCESS_FEE_BASIS_POINTS) / 10_000),
  );
  return Object.freeze({
    price,
    fee,
    sellerProceeds: price - fee,
  });
}

function aiTextTrainingJstDateKey(timestamp = Date.now()) {
  const millis = Number(timestamp);
  if (!Number.isFinite(millis)) {
    throw aiTextTrainingError("invalid_ai_text_training_time", "日時を確認してください。");
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(millis));
}

function aiTextTrainingJstMonthKey(timestamp = Date.now()) {
  return aiTextTrainingJstDateKey(timestamp).slice(0, 7);
}

function isAiTextTrainingReportReason(value) {
  return AI_TEXT_TRAINING_REPORT_REASONS.includes(String(value || ""));
}

module.exports = Object.freeze({
  AI_TEXT_TRAINING_DESCRIPTION_MAX_LENGTH,
  AI_TEXT_TRAINING_DESCRIPTION_MIN_LENGTH,
  AI_TEXT_TRAINING_LINE_MAX_LENGTH,
  AI_TEXT_TRAINING_LINE_MIN_LENGTH,
  AI_TEXT_TRAINING_LINES_PER_SLOT_MAX,
  AI_TEXT_TRAINING_LINES_PER_SLOT_MIN,
  AI_TEXT_TRAINING_MODES,
  AI_TEXT_TRAINING_PRICE_OPTIONS,
  AI_TEXT_TRAINING_PUBLISH_FEE,
  AI_TEXT_TRAINING_REPORT_REASONS,
  AI_TEXT_TRAINING_SCHEMA_VERSION,
  AI_TEXT_TRAINING_SCRIPT_SLOT_IDS,
  AI_TEXT_TRAINING_SUCCESS_FEE_BASIS_POINTS,
  AI_TEXT_TRAINING_TITLE_MAX_LENGTH,
  aiTextTrainingActionDocumentId,
  aiTextTrainingJstDateKey,
  aiTextTrainingJstMonthKey,
  aiTextTrainingPayloadHash,
  aiTextTrainingPresetId,
  aiTextTrainingPresetRevisionBuyerId,
  aiTextTrainingPublicSellerId,
  aiTextTrainingRankingPairId,
  aiTextTrainingReportId,
  aiTextTrainingSaleSettlement,
  aiTextTrainingSellerBuyerPairId,
  aiTextTrainingMonthlyBuyerPairId,
  aiTextTrainingUseId,
  isAiTextTrainingReportReason,
  normalizeAiTextTrainingActionId,
  normalizeAiTextTrainingDocumentId,
  normalizeAiTextTrainingMode,
  normalizeAiTextTrainingPresetInput,
  normalizeAiTextTrainingScript,
  normalizeAiTextTrainingSellerName,
  normalizeAiTextTrainingXHandle,
});
