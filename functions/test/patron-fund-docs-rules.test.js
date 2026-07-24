const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("patron circulation state and recommendation aggregates are server-only", () => {
  const rules = read("firestore.rules");
  for (const pattern of [
    /match \/valueMarketPatronFunds\/\{seasonKey\} \{\s*allow read, write: if false;/,
    /match \/valueMarketPatronFundContributors\/\{contributorId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketPatronFundPairs\/\{pairId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketPatronSellerImpacts\/\{impactId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketPatronPolicies\/\{seasonKey\} \{\s*allow read, write: if false;/,
    /match \/valueMarketPatronPolicyVotes\/\{voteId\} \{\s*allow read, write: if false;[\s\S]*?match \/actions\/\{actionId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketPatronRecommendationProfiles\/\{profileId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketPatronRecommendationSeasons\/\{seasonKey\} \{\s*allow read, write: if false;[\s\S]*?match \/shops\/\{publicSellerId\} \{\s*allow read, write: if false;/,
  ]) {
    assert.match(rules, pattern);
  }
});

test("README defines the bounded patron circulation program", () => {
  const readme = read("README.md");
  for (const text of [
    "80%を消却",
    "20%を日本時間の当月だけ使う循環基金",
    "通常5%手数料の半分（端数切り捨て）",
    "最大10 Pay",
    "実質手数料を最低1 Pay",
    "同じ売り手・買い手ペアへの補填は月1回",
    "同じ売り手への補填は月合計50 Pay",
    "App Check確認済み",
    "出会いと常連 / 新しい出会い / 常連の信頼",
    "本人や買い手への直接付与、購入代金の返金、自由送金には使わない",
    "PATRON BACKED",
  ]) {
    assert.ok(readme.includes(text), `README should include: ${text}`);
  }
});

test("README defines non-Pay recommendations without exposing UID", () => {
  const readme = read("README.md");
  for (const text of [
    "1店 / 2店 / 3店まで推薦",
    "推薦枠の購入や推薦に応じたAnjuPay報酬は設けない",
    "異なるパトロン3人以上",
    "パトロン推薦棚",
    "待機開始後20秒だけその商店を優先",
    "一般の新規商店検索へ自動で広がり",
    "Firebase Authentication UID",
  ]) {
    assert.ok(readme.includes(text), `README should include: ${text}`);
  }
});
