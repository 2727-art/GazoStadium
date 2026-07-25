const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CREATOR_CARD_FREE_THEMES,
  CREATOR_CARD_PREMIUM_PRODUCT_ID,
  CREATOR_CARD_PREMIUM_THEMES,
  creatorCardActivityCount,
  creatorCardGrowthLevel,
  isCreatorCardTheme,
  isCreatorCardType,
  isPremiumCreatorCardTheme,
  isValidCreatorCardText,
  normalizeCreatorCardXHandle,
} = require("../creator-card");

test("creator card growth counts verified play and ranked market activity", () => {
  assert.equal(creatorCardActivityCount(
    { totalMatches: 12 },
    { salesCount: 3, purchases: 4 },
  ), 19);
  assert.equal(creatorCardActivityCount(
    { totalMatches: -2 },
    { salesCount: 2.9, purchases: "invalid" },
  ), 2);
  for (const [activity, expectedLevel] of [
    [0, 1],
    [1, 2],
    [9, 2],
    [10, 3],
    [29, 3],
    [30, 4],
    [99, 4],
    [100, 5],
  ]) {
    assert.equal(creatorCardGrowthLevel(activity), expectedLevel);
  }
});

test("creator card themes keep four free choices and three owned premium choices", () => {
  assert.equal(CREATOR_CARD_PREMIUM_PRODUCT_ID, "feature_top_message");
  assert.deepEqual(CREATOR_CARD_FREE_THEMES, [
    "basic-rose",
    "basic-aqua",
    "basic-violet",
    "basic-sunset",
  ]);
  assert.deepEqual(CREATOR_CARD_PREMIUM_THEMES, [
    "premium-hologram",
    "premium-stardust",
    "premium-royal",
  ]);
  for (const theme of [...CREATOR_CARD_FREE_THEMES, ...CREATOR_CARD_PREMIUM_THEMES]) {
    assert.equal(isCreatorCardTheme(theme), true);
  }
  assert.equal(isPremiumCreatorCardTheme("basic-rose"), false);
  assert.equal(isPremiumCreatorCardTheme("premium-hologram"), true);
  assert.equal(isCreatorCardTheme(["basic-rose"]), false);
  assert.equal(isCreatorCardType("illustration"), true);
  assert.equal(isCreatorCardType("photo"), true);
  assert.equal(isCreatorCardType(["photo"]), false);
});

test("creator card introduction accepts ordinary r and n but rejects public contact details", () => {
  for (const value of [
    "Xでイラストを投稿しています",
    "tiktoker",
    "runner",
    "あ".repeat(30),
  ]) {
    assert.equal(isValidCreatorCardText(value), true, value);
  }
  for (const value of [
    "",
    " ",
    "あ".repeat(31),
    "一行目\n二行目",
    "一行目\r二行目",
    "https://example.com",
    "www.example.com",
    "x.com/example",
    "mail@example.com",
    ["runner"],
  ]) {
    assert.equal(isValidCreatorCardText(value), false, String(value));
  }
});

test("creator card X handles use only X-compatible account names", () => {
  assert.equal(normalizeCreatorCardXHandle(" @Anju_123 "), "Anju_123");
  assert.equal(normalizeCreatorCardXHandle("A".repeat(15)), "A".repeat(15));
  assert.equal(normalizeCreatorCardXHandle("A".repeat(16)), "");
  assert.equal(normalizeCreatorCardXHandle("anju-name"), "");
  assert.equal(normalizeCreatorCardXHandle("https://x.com/anju"), "");
  assert.equal(normalizeCreatorCardXHandle(["Anju_123"]), "");
});
