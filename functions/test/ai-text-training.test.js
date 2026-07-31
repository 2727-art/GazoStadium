"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  AI_TEXT_TRAINING_PRODUCT_TYPES,
  AI_TEXT_TRAINING_SCRIPT_SLOT_IDS,
  AI_TEXT_TRAINING_STYLE_PRODUCT_IDS,
  AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS,
  aiTextTrainingJstDateKey,
  aiTextTrainingJstMonthKey,
  aiTextTrainingPayloadHash,
  aiTextTrainingPresetId,
  aiTextTrainingPresetRevisionBuyerId,
  aiTextTrainingPublicSellerId,
  aiTextTrainingReportId,
  aiTextTrainingSaleSettlement,
  aiTextTrainingUseId,
  normalizeAiTextTrainingPresetInput,
  normalizeAiTextTrainingCosmetics,
  normalizeAiTextTrainingXHandle,
} = require("../ai-text-training");

function validLines() {
  return Object.fromEntries(AI_TEXT_TRAINING_SCRIPT_SLOT_IDS.map((slotId) => [
    slotId,
    [`${slotId} 応援その1`, `${slotId} 応援その2`],
  ]));
}

function validZoneLines() {
  return Object.fromEntries(AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS.map((slotId) => [
    slotId,
    [`${slotId} 演出その1`, `${slotId} 演出その2`],
  ]));
}

function validPreset(overrides = {}) {
  return {
    modeId: "mama",
    sellerName: "応援作者",
    title: "ゆっくり見守り台本",
    description: "実際のBPMに合わせて、落ち着いた言葉で応援します。",
    price: 10,
    baseRevision: 0,
    lines: validLines(),
    ...overrides,
  };
}

test("AI text training preset validates every required phase and fixed price", () => {
  const normalized = normalizeAiTextTrainingPresetInput(validPreset());
  assert.equal(normalized.modeId, "mama");
  assert.equal(normalized.productType, "standard");
  assert.deepEqual(normalized.zoneLines, {});
  assert.equal(normalized.price, 10);
  assert.deepEqual(Object.keys(normalized.lines), AI_TEXT_TRAINING_SCRIPT_SLOT_IDS);
  assert.throws(
    () => normalizeAiTextTrainingPresetInput(validPreset({ price: 11 })),
    /価格/,
  );
  const missing = validLines();
  delete missing.final_low;
  assert.throws(
    () => normalizeAiTextTrainingPresetInput(validPreset({ lines: missing })),
    /各場面/,
  );
});

test("defeat-zone products require all five dedicated slots while standard products stay separate", () => {
  const zone = normalizeAiTextTrainingPresetInput(validPreset({
    productType: "defeat_zone",
    zoneLines: validZoneLines(),
  }));
  assert.equal(zone.productType, "defeat_zone");
  assert.deepEqual(Object.keys(zone.zoneLines), AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS);
  assert.deepEqual(AI_TEXT_TRAINING_PRODUCT_TYPES, ["standard", "defeat_zone"]);

  const missing = validZoneLines();
  delete missing.zone_cooldown;
  assert.throws(
    () => normalizeAiTextTrainingPresetInput(validPreset({
      productType: "defeat_zone",
      zoneLines: missing,
    })),
    /2〜4行/,
  );
  assert.throws(
    () => normalizeAiTextTrainingPresetInput(validPreset({
      productType: "standard",
      zoneLines: validZoneLines(),
    })),
    /通常台本/,
  );
});

test("user scripts cannot obstruct surrender, defeat, stop, or rest controls", () => {
  for (const unsafe of [
    "ギブアップするな、まだ続けろ",
    "ギブアップしないでね、まだ続けて",
    "ギブアップしちゃだめ、最後まで続けて",
    "敗北を認めるな、立ち上がれ",
    "負けを認めないでよ、まだ続けて",
    "緊急停止を押すな、進め",
    "休憩するな、最後まで動け",
    "休まないでね、最後まで続けて",
    "運動をやめないで、最後まで続けて",
    "やめないでね、最後まで続けて",
    "止まるな、最後まで続けて",
    "止まらないでね、最後まで続けて",
    "諦めないでね、まだ続けて",
    "ギブアップはダメ、そのまま続けて",
  ]) {
    const zoneLines = validZoneLines();
    zoneLines.zone_rush[0] = unsafe;
    assert.throws(
      () => normalizeAiTextTrainingPresetInput(validPreset({
        productType: "defeat_zone",
        zoneLines,
      })),
      /妨げる台詞/,
    );
  }
});

test("support scripts reject unknown placeholders, HTML, dangerous commands, and sexualized family roles", () => {
  for (const unsafe of [
    "あと{unknown}秒だよ",
    "<b>強く動いて</b>",
    "痛みは無視して続けよう",
    "水分を飲むな、そのまま続けて",
    "エロいお姉ちゃんが応援するよ",
  ]) {
    const lines = validLines();
    lines.start[0] = unsafe;
    assert.throws(
      () => normalizeAiTextTrainingPresetInput(validPreset({ lines })),
    );
  }
});

test("safe BPM-aware placeholders are retained", () => {
  const lines = validLines();
  lines.active_mid[0] = "{bpm} BPM、呼吸を止めないで";
  lines.active_mid[1] = "{bpm} BPM、ラウンド{round}を進もう";
  lines.final_mid[0] = "あと{remaining}秒、呼吸も大切に";
  const normalized = normalizeAiTextTrainingPresetInput(validPreset({ lines }));
  assert.equal(normalized.lines.active_mid[0], "{bpm} BPM、呼吸を止めないで");
  assert.equal(normalized.lines.active_mid[1], "{bpm} BPM、ラウンド{round}を進もう");
});

test("training cosmetics keep the two slots independent and reject unknown products", () => {
  const neonBeat = AI_TEXT_TRAINING_STYLE_PRODUCT_IDS[1];
  const crimsonAzure = AI_TEXT_TRAINING_STYLE_PRODUCT_IDS
    .find((productId) => productId === "ai_training_style_crimson_azure");
  assert.equal(crimsonAzure, "ai_training_style_crimson_azure");
  assert.deepEqual(normalizeAiTextTrainingCosmetics({
    panelThemeId: crimsonAzure,
    messageDecorationId: neonBeat,
  }), {
    panelThemeId: crimsonAzure,
    messageDecorationId: neonBeat,
  });
  assert.deepEqual(normalizeAiTextTrainingCosmetics({
    panelThemeId: "",
    messageDecorationId: "",
  }), {
    panelThemeId: "",
    messageDecorationId: "",
  });
  assert.throws(
    () => normalizeAiTextTrainingCosmetics({
      panelThemeId: "unknown_style",
      messageDecorationId: "",
    }),
    /画像ウィンドウ/,
  );
});

test("pricing absorbs 20 percent with a one Pay minimum", () => {
  assert.deepEqual(aiTextTrainingSaleSettlement(5), {
    price: 5,
    fee: 1,
    sellerProceeds: 4,
  });
  assert.deepEqual(aiTextTrainingSaleSettlement(10), {
    price: 10,
    fee: 2,
    sellerProceeds: 8,
  });
  assert.deepEqual(aiTextTrainingSaleSettlement(25), {
    price: 25,
    fee: 5,
    sellerProceeds: 20,
  });
});

test("public, preset, and use IDs are deterministic and namespace-separated", () => {
  const first = aiTextTrainingPublicSellerId("seller-uid");
  assert.match(first, /^[a-f0-9]{40}$/);
  assert.equal(first, aiTextTrainingPublicSellerId("seller-uid"));
  assert.notEqual(first, aiTextTrainingPresetId("seller-uid", "mama"));
  assert.equal(
    aiTextTrainingPresetId("seller-uid", "mama"),
    crypto.createHash("sha256")
      .update("ai-text-training-preset:seller-uid:mama")
      .digest("hex")
      .slice(0, 40),
  );
  assert.notEqual(
    aiTextTrainingPresetId("seller-uid", "mama"),
    aiTextTrainingPresetId("seller-uid", "mama", "defeat_zone"),
  );
  assert.notEqual(
    aiTextTrainingUseId("buyer-uid", "action_1234567890"),
    aiTextTrainingUseId("seller-uid", "action_1234567890"),
  );
  assert.notEqual(
    aiTextTrainingReportId("a".repeat(40), 1, "reporter-uid"),
    aiTextTrainingReportId("a".repeat(40), 2, "reporter-uid"),
  );
  assert.notEqual(
    aiTextTrainingPresetRevisionBuyerId("a".repeat(40), 1, "buyer-uid"),
    aiTextTrainingPresetRevisionBuyerId("a".repeat(40), 2, "buyer-uid"),
  );
  assert.equal(
    aiTextTrainingPayloadHash({
      lines: { start: ["進もう"], clear: ["完走だよ"] },
      title: "応援",
    }),
    aiTextTrainingPayloadHash({
      title: "応援",
      lines: { clear: ["完走だよ"], start: ["進もう"] },
    }),
  );
});

test("X profile accepts only a handle and JST keys cross boundaries correctly", () => {
  assert.equal(normalizeAiTextTrainingXHandle("@anju_123"), "anju_123");
  assert.throws(() => normalizeAiTextTrainingXHandle("https://x.com/anju"));
  const beforeMidnightUtc = Date.parse("2026-07-31T14:59:59.000Z");
  const afterMidnightUtc = Date.parse("2026-07-31T15:00:00.000Z");
  assert.equal(aiTextTrainingJstDateKey(beforeMidnightUtc), "2026-07-31");
  assert.equal(aiTextTrainingJstDateKey(afterMidnightUtc), "2026-08-01");
  assert.equal(aiTextTrainingJstMonthKey(afterMidnightUtc), "2026-08");
});
