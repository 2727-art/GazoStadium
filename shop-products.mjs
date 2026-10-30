import { AI_TEXT_TRAINING_STYLE_PRODUCTS } from "./ai-text-training-cosmetics.js?v=ai-text-training-cosmetics-v3";
import { STAMP_PRODUCTS } from "./stamps.js?v=stamps-v1-oshi-jouzu-duo-v1-restore-v1-remove-royale-v1";
import { PLAYER_TITLE_PRODUCTS } from "./player-titles.js?v=player-titles-v3-retire-team-v1-remove-royale-v1";
import { CHAT_COSMETIC_PRODUCTS } from "./chat-cosmetics.js?v=chat-cosmetics-v1";
import { RANCH_DECORATION_PRODUCTS } from "./tribute-deco.mjs?v=ranch-vault-v1-ranch-premium-icons-v1-ranch-premium-icons-v2";
export const SHOP_PRODUCTS = [
  ...AI_TEXT_TRAINING_STYLE_PRODUCTS,
  { id: "reaction_color", type: "reaction", name: "カラーパレット", reaction: "色づかいが好き！", description: "色の組み合わせを褒める追加リアクション", price: 120 },
  { id: "reaction_best_shot", type: "reaction", name: "ベストショット", reaction: "最高の一枚！", description: "力強く褒める追加リアクション", price: 150 },
  { id: "reaction_composition", type: "reaction", name: "コンポジション", reaction: "構図がうまい！", description: "画面構成に注目した追加リアクション", price: 160 },
  { id: "reaction_atmosphere", type: "reaction", name: "アトモスフィア", reaction: "空気感が最高", description: "画像全体の雰囲気を褒める追加リアクション", price: 200 },
  { id: "reaction_idea", type: "reaction", name: "アイデア賞", reaction: "発想がおもしろい！", description: "意外性や着眼点を褒める追加リアクション", price: 240 },
  { id: "reaction_healing", type: "reaction", name: "ヒーリング", reaction: "癒やされる", description: "穏やかな画像に似合う追加リアクション", price: 250 },
  { id: "reaction_keep_watching", type: "reaction", name: "ロングルック", reaction: "ずっと見ていたい", description: "見飽きない魅力を伝える追加リアクション", price: 300 },
  { id: "reaction_today_favorite", type: "reaction", name: "トゥデイズピック", reaction: "今日の推し！", description: "その日の一番を伝える追加リアクション", price: 350 },
  { id: "reaction_story", type: "reaction", name: "ストーリーテラー", reaction: "物語を感じる", description: "背景まで想像したときの追加リアクション", price: 400 },
  { id: "reaction_masterpiece", type: "reaction", name: "マスターピース", reaction: "これは名作", description: "ここぞという一枚に送る追加リアクション", price: 600 },
  ...STAMP_PRODUCTS,
  ...PLAYER_TITLE_PRODUCTS,
  ...CHAT_COSMETIC_PRODUCTS,
  ...RANCH_DECORATION_PRODUCTS,
];
export function getShopProductLabel(productId) {
  if (productId === "feature_top_message") return "推しカード プレミアム仕上げ（提供終了）";
  const product = SHOP_PRODUCTS.find((candidate) => candidate.id === String(productId || ""));
  return product ? String(product.reaction || product.title || product.name || "") : "";
}
