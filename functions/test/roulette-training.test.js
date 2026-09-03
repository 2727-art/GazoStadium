"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ROULETTE_TRAINING_COUNT_UNITS,
  ROULETTE_TRAINING_REPORT_REASONS,
  ROULETTE_TRAINING_PRICE_OPTIONS,
  ROULETTE_TRAINING_SELLER_PACK_MAX,
  isRouletteTrainingReportReason,
  normalizeRouletteTrainingPackInput,
  rouletteTrainingPackId,
  rouletteTrainingPayloadHash,
  rouletteTrainingReportId,
  rouletteTrainingSaleSettlement,
  rouletteTrainingUseId,
} = require("../roulette-training");
const {
  AI_TEXT_TRAINING_PRICE_OPTIONS,
  aiTextTrainingSaleSettlement,
} = require("../ai-text-training");

function validPack(overrides = {}) {
  return {
    action: "publish",
    actionId: "publish_action_0001",
    expectedBalance: 30,
    baseRevision: 0,
    sellerName: "作者A",
    title: "朝の元気トレーニング",
    description: "自分の体調に合わせて無理なく楽しむメニューです。",
    price: 10,
    items: [{
      menuText: "スクワット10回",
      detailText: "足を肩幅に開いて、無理のない深さで動きます。",
      countUnit: "reps",
      cheerLines: ["いい調子、そのペースです。"],
    }],
    ...overrides,
  };
}

test("roulette packs keep exercise and cheer text free while count units stay structured", () => {
  const normalized = normalizeRouletteTrainingPackInput(validPack());
  assert.equal(normalized.items[0].menuText, "スクワット10回");
  assert.equal(normalized.items[0].detailText, "足を肩幅に開いて、無理のない深さで動きます。");
  assert.equal(normalized.items[0].countUnit, "reps");
  assert.deepEqual(ROULETTE_TRAINING_COUNT_UNITS, [
    "reps",
    "seconds",
    "round_trips",
    "sets",
  ]);
  for (const countUnit of ROULETTE_TRAINING_COUNT_UNITS) {
    assert.equal(
      normalizeRouletteTrainingPackInput(validPack({
        items: [{
          menuText: `${countUnit} の自由メニュー`,
          detailText: "",
          countUnit,
          cheerLines: ["応援しています。"],
        }],
      })).items[0].countUnit,
      countUnit,
    );
  }
});

test("packs require one to ten items and one to four cheer lines", () => {
  assert.equal(ROULETTE_TRAINING_SELLER_PACK_MAX, 50);
  assert.throws(
    () => normalizeRouletteTrainingPackInput(validPack({ items: [] })),
    /1〜10件/,
  );
  assert.throws(
    () => normalizeRouletteTrainingPackInput(validPack({
      items: Array.from({ length: 11 }, (_, index) => ({
        menuText: `自由メニュー${index + 1}`,
        detailText: "",
        countUnit: "reps",
        cheerLines: ["応援しています。"],
      })),
    })),
    /1〜10件/,
  );
  const item = validPack().items[0];
  assert.throws(
    () => normalizeRouletteTrainingPackInput(validPack({
      items: [{ ...item, cheerLines: [] }],
    })),
    /1〜4行/,
  );
  assert.throws(
    () => normalizeRouletteTrainingPackInput(validPack({
      items: [{ ...item, countUnit: "minutes" }],
    })),
    /単位/,
  );
});

test("cheer limits count NFKC-normalized Unicode code points", () => {
  const item = validPack().items[0];
  const emojiCheer = "😀".repeat(31);
  const normalized = normalizeRouletteTrainingPackInput(validPack({
    items: [{ ...item, cheerLines: [emojiCheer] }],
  }));
  assert.equal(normalized.items[0].cheerLines[0], emojiCheer);
  assert.equal(
    normalizeRouletteTrainingPackInput(validPack({
      items: [{ ...item, cheerLines: ["㍍".repeat(15)] }],
    })).items[0].cheerLines[0],
    "メートル".repeat(15),
  );
  assert.throws(
    () => normalizeRouletteTrainingPackInput(validPack({
      items: [{ ...item, cheerLines: ["😀".repeat(61)] }],
    })),
    /60文字以内/,
  );
  assert.throws(
    () => normalizeRouletteTrainingPackInput(validPack({
      items: [{ ...item, cheerLines: ["㍍".repeat(16)] }],
    })),
    /60文字以内/,
  );
});

test("harassment remains a structured report reason alongside free-text validation", () => {
  assert.ok(ROULETTE_TRAINING_REPORT_REASONS.includes("harassment"));
  assert.equal(isRouletteTrainingReportReason("harassment"), true);
  assert.equal(isRouletteTrainingReportReason("custom_reason"), false);
});

test("strict publication shape excludes device-local gameplay and image data", () => {
  for (const [key, value] of [
    ["images", ["data:image/png;base64,secret"]],
    ["bpm", 180],
    ["rouletteWeights", { custom: 1 }],
    ["completed", true],
  ]) {
    assert.throws(
      () => normalizeRouletteTrainingPackInput(validPack({ [key]: value })),
      /画像・BPM・抽選結果・達成結果/,
    );
  }
  assert.throws(
    () => normalizeRouletteTrainingPackInput(validPack({
      items: [{ ...validPack().items[0], targetCount: 100 }],
    })),
    /メニュー本文・やり方・回数単位・応援台詞/,
  );
});

test("dangerous, coercive, HTML, contact, and extreme instructions are rejected", () => {
  for (const menuText of [
    "痛みは無視して続けるスクワット",
    "限界まで腕立て伏せ",
    "水分を飲むなランニング",
    "首ブリッジ",
    "<b>スクワット</b>",
  ]) {
    assert.throws(() => normalizeRouletteTrainingPackInput(validPack({
      items: [{
        ...validPack().items[0],
        menuText,
      }],
    })));
  }
  assert.throws(() => normalizeRouletteTrainingPackInput(validPack({
    items: [{
      ...validPack().items[0],
      cheerLines: ["休むな、最後まで続けて。"],
    }],
  })), /停止・休憩・見送り/);
});

test("pricing and fees exactly match the existing AI text training market", () => {
  assert.deepEqual(ROULETTE_TRAINING_PRICE_OPTIONS, AI_TEXT_TRAINING_PRICE_OPTIONS);
  for (const price of ROULETTE_TRAINING_PRICE_OPTIONS) {
    assert.deepEqual(rouletteTrainingSaleSettlement(price), aiTextTrainingSaleSettlement(price));
  }
});

test("IDs and payload hashes are deterministic and namespace separated", () => {
  const actionId = "action_identifier_0001";
  const packId = rouletteTrainingPackId("seller", actionId);
  assert.match(packId, /^[a-f0-9]{40}$/u);
  assert.equal(packId, rouletteTrainingPackId("seller", actionId));
  assert.notEqual(packId, rouletteTrainingUseId("seller", actionId));
  assert.notEqual(
    rouletteTrainingReportId(packId, 1, "buyer"),
    rouletteTrainingReportId(packId, 2, "buyer"),
  );
  assert.equal(
    rouletteTrainingPayloadHash({ title: "A", items: [{ b: 2, a: 1 }] }),
    rouletteTrainingPayloadHash({ items: [{ a: 1, b: 2 }], title: "A" }),
  );
});
