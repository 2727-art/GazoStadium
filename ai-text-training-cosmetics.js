export const AI_TEXT_TRAINING_STYLE_PRODUCTS = Object.freeze([
  Object.freeze({
    id: "ai_training_style_soft_glow",
    type: "aiTextTrainingStyle",
    name: "ソフトグロウ",
    description: "やわらかな光の画像ウィンドウと、落ち着いたミルク色の応援カードを解放",
    panelLabel: "やわらかな光の窓",
    messageLabel: "ミルク応援カード",
    price: 300,
  }),
  Object.freeze({
    id: "ai_training_style_neon_beat",
    type: "aiTextTrainingStyle",
    name: "ネオンビート",
    description: "シアンとピンクのネオンHUDと、テンポを感じる応援ラインを解放",
    panelLabel: "ネオンHUD",
    messageLabel: "ビート応援ライン",
    price: 500,
  }),
  Object.freeze({
    id: "ai_training_style_crimson_azure",
    type: "aiTextTrainingStyle",
    name: "韓堕ちダークネオン",
    description: "黒・濃紺に赤青ネオンと太極リアクター風ラインを重ねる、韓堕ちモード配色の窓とセリフ枠を解放",
    panelLabel: "赤青太極ネオンHUD",
    messageLabel: "K-DROP黒ガラスカード",
    price: 800,
  }),
  Object.freeze({
    id: "ai_training_style_stardust_stage",
    type: "aiTextTrainingStyle",
    name: "スターダストステージ",
    description: "星空のプライベートステージと、金色にきらめく応援カードを解放",
    panelLabel: "星空ステージ",
    messageLabel: "スターダストボイス",
    price: 1_000,
  }),
]);

const PRODUCT_BY_ID = new Map(
  AI_TEXT_TRAINING_STYLE_PRODUCTS.map((product) => [product.id, product]),
);

export function getAiTextTrainingStyleProduct(productId) {
  return PRODUCT_BY_ID.get(String(productId || "")) || null;
}

export function normalizeAiTextTrainingStyleId(value) {
  const id = String(value || "");
  return PRODUCT_BY_ID.has(id) ? id : "";
}

export function normalizeAiTextTrainingCosmetics(
  value,
  { ownedStyleIds = [], allowUnowned = false } = {},
) {
  const source = value && typeof value === "object" ? value : {};
  const owned = ownedStyleIds instanceof Set
    ? ownedStyleIds
    : new Set(Array.isArray(ownedStyleIds) ? ownedStyleIds : []);
  const normalizeSlot = (candidate) => {
    const id = normalizeAiTextTrainingStyleId(candidate);
    if (!id || allowUnowned || owned.has(id)) return id;
    return "";
  };
  return Object.freeze({
    panelThemeId: normalizeSlot(source.panelThemeId),
    messageDecorationId: normalizeSlot(source.messageDecorationId),
  });
}

export function aiTextTrainingCosmeticsAreOwned(value, ownedStyleIds = []) {
  const source = normalizeAiTextTrainingCosmetics(value, { allowUnowned: true });
  const owned = ownedStyleIds instanceof Set
    ? ownedStyleIds
    : new Set(Array.isArray(ownedStyleIds) ? ownedStyleIds : []);
  return [source.panelThemeId, source.messageDecorationId]
    .every((id) => !id || owned.has(id));
}
