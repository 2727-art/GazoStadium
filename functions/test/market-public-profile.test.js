const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MARKET_TAGLINE_MAX_LENGTH,
  createMarketRankingRow,
  hasRankedMarketStats,
  isMarketPublicProfilePrivacyReduction,
  isValidMarketTagline,
  isValidMarketXHandle,
  marketPublicProfileUpdateDecision,
  normalizeMarketXHandle,
  sanitizeStoredMarketPublicProfile,
} = require("../market-public-profile");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("market X handles allow only X-compatible account names", () => {
  assert.equal(normalizeMarketXHandle(" @valid_name "), "valid_name");
  assert.equal(isValidMarketXHandle("valid_name"), true);
  assert.equal(isValidMarketXHandle("A".repeat(15)), true);
  assert.equal(isValidMarketXHandle("A".repeat(16)), false);
  assert.equal(isValidMarketXHandle("https://x.com/name"), false);
  assert.equal(isValidMarketXHandle("name.example"), false);
  assert.equal(isValidMarketXHandle(["valid_name"]), false);
  assert.equal(isValidMarketXHandle(""), false);
});

test("market taglines are optional on output but valid only as one short line", () => {
  assert.equal(isValidMarketTagline("推しの価値を言葉で届けます"), true);
  assert.equal(isValidMarketTagline("あ".repeat(MARKET_TAGLINE_MAX_LENGTH)), true);
  assert.equal(isValidMarketTagline("あ".repeat(MARKET_TAGLINE_MAX_LENGTH + 1)), false);
  assert.equal(isValidMarketTagline("一行目\n二行目"), false);
  assert.equal(isValidMarketTagline(["配列は不可"]), false);
  assert.equal(isValidMarketTagline(""), false);
});

test("stored public profiles fail closed when fields are malformed", () => {
  assert.deepEqual(sanitizeStoredMarketPublicProfile({
    xHandle: "valid_name",
    tagline: "市場の一言",
  }), {
    xHandle: "valid_name",
    tagline: "市場の一言",
  });
  assert.deepEqual(sanitizeStoredMarketPublicProfile({
    xHandle: "javascript:alert(1)",
    tagline: "a".repeat(MARKET_TAGLINE_MAX_LENGTH + 1),
  }), {
    xHandle: "",
    tagline: "",
  });
});

test("only players with ranked sales or purchases can publish a market profile", () => {
  assert.equal(hasRankedMarketStats({ grossSales: 1, spent: 0 }), true);
  assert.equal(hasRankedMarketStats({ grossSales: 0, spent: 1 }), true);
  assert.equal(hasRankedMarketStats({ grossSales: 0, spent: 0, laborFees: 500 }), false);
  assert.equal(hasRankedMarketStats(null), false);
});

test("public market ranking rows expose no UID or document identifier", () => {
  const row = createMarketRankingRow({
    uid: "private-anonymous-uid",
    documentId: "private-document-id",
    name: " MARKET PLAYER ",
    grossSales: 1_280,
    salesCount: 9,
    bestSale: 300,
    publicProfile: {
      xHandle: "market_player",
      tagline: "推しの価値を伝えます",
    },
    publicAchievements: ["market_seller_10", "not_a_real_achievement"],
  }, "seller", true);
  assert.deepEqual(row, {
    name: "MARKET PLAYER",
    primary: 1_280,
    count: 9,
    best: 300,
    publicProfile: {
      xHandle: "market_player",
      tagline: "推しの価値を伝えます",
    },
    achievementShowcase: ["market_seller_10"],
    isViewer: true,
  });
  assert.equal(Object.hasOwn(row, "uid"), false);
  assert.equal(JSON.stringify(row).includes("private-anonymous-uid"), false);
  assert.equal(JSON.stringify(row).includes("private-document-id"), false);
});

test("market profile update decisions are idempotent and rate limited", () => {
  const now = 1_800_000_000_000;
  const cooldown = 10_000;
  const current = {
    xHandle: "valid_name",
    tagline: "同じ内容",
    updatedAt: now - 2_000,
  };
  assert.equal(marketPublicProfileUpdateDecision(current, current, now, cooldown).action, "noop");
  assert.deepEqual(marketPublicProfileUpdateDecision(current, {
    xHandle: "valid_name",
    tagline: "変更内容",
  }, now, cooldown), {
    action: "rate_limited",
    profile: { xHandle: "valid_name", tagline: "変更内容" },
    updatedAt: now,
    retryAfterMs: 8_000,
  });
  assert.deepEqual(marketPublicProfileUpdateDecision(current, {
    xHandle: "",
    tagline: "同じ内容",
  }, now, cooldown), {
    action: "write",
    profile: { xHandle: "", tagline: "同じ内容" },
    updatedAt: now,
    retryAfterMs: 0,
  });
  assert.equal(marketPublicProfileUpdateDecision(current, {
    xHandle: "",
    tagline: "別の内容",
  }, now, cooldown).action, "rate_limited");
  assert.equal(marketPublicProfileUpdateDecision(current, {
    xHandle: "valid_name",
    tagline: "変更内容",
  }, now + 8_000, cooldown).action, "write");
});

test("market profile privacy can only be reduced without ranked stats", () => {
  const current = { xHandle: "valid_name", tagline: "公開中" };
  assert.equal(isMarketPublicProfilePrivacyReduction(current, {
    xHandle: "",
    tagline: "公開中",
  }), true);
  assert.equal(isMarketPublicProfilePrivacyReduction(current, {
    xHandle: "",
    tagline: "",
  }), true);
  assert.equal(isMarketPublicProfilePrivacyReduction(current, {
    xHandle: "",
    tagline: "変更内容",
  }), false);
  assert.equal(isMarketPublicProfilePrivacyReduction(current, {
    xHandle: "other_name",
    tagline: "公開中",
  }), false);
});

test("market ranking wiring keeps profile writes server-authoritative and UIDs private", () => {
  const functionsSource = read("functions/index.js");
  const marketSource = read("market.js");
  const rulesSource = read("firestore.rules");
  const saveSource = functionsSource.slice(
    functionsSource.indexOf("async function saveMarketPublicProfile"),
    functionsSource.indexOf("function rankingRow"),
  );

  assert.match(functionsSource, /action === "save_public_profile"/);
  assert.match(functionsSource, /saved: true/);
  assert.match(functionsSource, /transaction\.set\(statsRef, \{ publicProfile \}, \{ merge: true \}\)/);
  assert.match(saveSource, /const statsRef = marketStatsRef\(uid\)/);
  assert.match(saveSource, /marketPublicProfileUpdateDecision/);
  assert.doesNotMatch(saveSource, /data\?\.(?:uid|name|grossSales|spent|updatedAt)/);
  assert.doesNotMatch(
    functionsSource.slice(
      functionsSource.indexOf("function rankingRow"),
      functionsSource.indexOf("exports.valueMarketRankings"),
    ),
    /uid:\s*snapshot\.id/,
  );
  assert.match(marketSource, /response\.data\?\.saved !== true/);
  assert.match(marketSource, /if \(!useMarketPreview\) \{\s*const response = await marketRankingsCallable/);
  assert.match(marketSource, /rel="noopener noreferrer nofollow ugc"/);
  assert.match(marketSource, /referrerpolicy="no-referrer"/);
  assert.match(rulesSource, /match \/valueMarketStats\/\{uid\} \{\s*allow read, write: if false;/);
});
