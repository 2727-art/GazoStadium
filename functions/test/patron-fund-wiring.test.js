"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const server = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return server.slice(start, end);
}

test("patron upgrades atomically recognize the 80/20 split in the monthly fund", () => {
  const source = sourceBetween(
    "async function upgradePatronage",
    "async function initializeEconomy",
  );
  assert.match(source, /transaction\.get\(fundRef\)/);
  assert.match(source, /transaction\.get\(contributorRef\)/);
  assert.match(source, /stagePatronFundRecognition\(\{/);
  assert.match(source, /splitPatronPayment\(upgrade\.cost\)/);
  assert.match(source, /patronFundContribution: paymentSplit\.contributionAmount/);
  assert.match(source, /patronBurnAmount: paymentSplit\.burnAmount/);
  assert.match(source, /transaction\.set\(fundRef, staged\.fund\)/);
  assert.match(source, /transaction\.set\(contributorRef, staged\.contributor\)/);
});

test("sale subsidies are protected, bounded, and settled atomically with the sale", () => {
  const source = sourceBetween(
    "async function performMarketAction",
    "exports.valueMarketAction",
  );
  assert.match(source, /room\.appCheckVerified === true[\s\S]*appCheckVerified === true/);
  assert.match(source, /&& !pairSnapshot\.exists/);
  assert.match(source, /walletCreditCapacity\(sellerWallet\) - settlement\.sellerProceeds/);
  assert.match(source, /patronFundSubsidyDecision\(\{/);
  assert.match(source, /pairAlreadySubsidized: marketPatronPairSnapshot\?\.exists === true/);
  assert.match(source, /transaction\.set\(marketPatronFundRef/);
  assert.match(source, /transaction\.set\(marketPatronSellerImpactRef/);
  assert.match(source, /transaction\.create\(marketPatronPairRef/);
  assert.match(source, /"patron_fund_subsidy"/);
  assert.match(source, /room\.effectiveMarketFee = effectiveMarketFee/);
  assert.match(source, /patronFundSubsidy: patronSubsidy/);
  assert.match(source, /sellerProceeds: actualSellerProceeds/);
  assert.match(source, /action === "buy"[\s\S]*patronProgram = await readPatronProgram\(uid\)/);
  assert.match(source, /\.\.\.\(patronProgram \|\| \{\}\)/);
  assert.match(server, /const participants = \[sellerUid, buyerUid\]\.sort\(\);[\s\S]*eventId\(`\$\{seasonKey\}:\$\{participants\.join\(":"\)\}`\)/);
});

test("monthly policy votes require a protected current patron identity", () => {
  const source = sourceBetween(
    "async function votePatronPolicy",
    "exports.economyAction",
  );
  assert.match(source, /if \(!request\.app\)/);
  assert.match(source, /hasGoogleIdentity\(request\)/);
  assert.match(source, /hasLiveGoogleIdentity\(uid\)/);
  assert.match(source, /if \(patron\.tier < 1\)/);
  assert.match(source, /normalizePolicyVote\(data\?\.policyId\)/);
  assert.match(source, /policy\.votes\[policyId\] \+= 1/);
  assert.match(source, /transaction\.set\(voteRef/);
  assert.match(source, /transaction\.get\(actionRef\)/);
  assert.match(source, /if \(actionSnapshot\.exists\)/);
  assert.match(source, /transaction\.create\(actionRef/);
  assert.match(server, /action === "patron_policy_vote"/);
});

test("shop recommendations are non-Pay, relationship-gated, capped, and UID-private", () => {
  const source = sourceBetween(
    "async function updatePatronRecommendation",
    "async function getMarketShop",
  );
  assert.match(source, /if \(!appCheckVerified\)/);
  assert.match(source, /if \(patron\.tier < 1\)/);
  assert.match(source, /favoriteMatches/);
  assert.match(source, /relationshipSaleCount < 1/);
  assert.match(source, /if \(blockSnapshot\.exists\)/);
  assert.match(source, /profile\.recommendations\.length >= patronRecommendationLimit\(patron\.tier\)/);
  assert.match(source, /recommendationCount: remove/);
  assert.match(source, /remove\s*\?\s*Promise\.resolve\(null\)/);
  assert.doesNotMatch(source, /creditPoints\(|debitPoints\(|transferPoints\(/);
  assert.match(server, /\.where\("recommendationCount", ">=", PATRON_RECOMMENDED_SHELF_MINIMUM\)/);
  assert.doesNotMatch(server, /\.where\("recommendationCount", ">=", PATRON_RECOMMENDED_SHELF_MINIMUM\)\s*\.limit\(/);
  assert.match(server, /const PATRON_RECOMMENDED_SHELF_MINIMUM = 3/);
  assert.match(server, /return shop;/);
  assert.match(server, /unavailable: true/);
  assert.match(server, /action === "recommend_shop"/);
  assert.match(server, /action === "remove_recommendation"/);
});

test("market shop initialization returns fund impact and both recommendation surfaces", () => {
  const source = sourceBetween("async function getMarketShop", "function marketShopValidationMessage");
  assert.match(source, /ensurePatronFundRecognition\(uid, patron\)/);
  assert.match(source, /listPatronRecommendations\(uid, seasonKey\)/);
  assert.match(source, /listRecommendedShopShelf\(seasonKey\)/);
  assert.match(source, /recommendations,/);
  assert.match(source, /recommendedShelf,/);
  assert.match(source, /\.\.\.patronProgram/);
});

test("patron account, market, and shared styles use one cache generation", () => {
  assert.match(index, /styles\.css\?v=[^"]*patron-circulation-v1/);
  assert.match(index, /market\.css\?v=[^"]*patron-circulation-v1/);
  assert.match(index, /account\.js\?v=[^"]*patron-circulation-v1/);
  assert.match(index, /market\.js\?v=[^"]*patron-circulation-v1/);
});

test("certificate output re-applies the half-fee and 10 Pay subsidy ceiling", () => {
  const source = sourceBetween(
    "function publicMarketCertificate",
    "async function listMarketCertificates",
  );
  assert.match(source, /Math\.floor\(marketFee \/ 2\)/);
  assert.match(source, /PATRON_FUND_MAX_SUBSIDY_PER_SALE/);
  assert.match(source, /marketFee - 1/);
  assert.match(source, /effectiveMarketFee: marketFee - patronFundSubsidy/);
});
