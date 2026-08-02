"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  aggregateCount,
  compareServerOverallRankingKeys,
  crownCustomizationOptions,
  fallbackCrownCustomization,
  fallbackServerOverallStanding,
  sameServerOverallRankingKey,
  serverOverallRankingKey,
} = require("../ranking-dashboard");
const { normalizeSignatureIds } = require("../crown-circuit");

const functionsSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const indexes = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "..", "firestore.indexes.json"),
  "utf8",
));

test("overall ranking key rejects non-participants and incomplete profiles", () => {
  assert.equal(serverOverallRankingKey(null), null);
  assert.equal(serverOverallRankingKey({ enabled: false, rating: 1000, entryId: "abcdefghijklmnop" }), null);
  assert.equal(serverOverallRankingKey({ enabled: true, rating: 1000 }), null);
  assert.equal(serverOverallRankingKey({ enabled: true, rating: 1000, entryId: "short" }), null);
  assert.equal(serverOverallRankingKey({ enabled: true, rating: "1000", entryId: "abcdefghijklmnop" }), null);
  assert.deepEqual(
    serverOverallRankingKey({ enabled: true, rating: 1000, entryId: "abcdefghijklmnop" }),
    { rating: 1000, entryId: "abcdefghijklmnop" },
  );
});

test("same-RATE entries use entryId ascending as their deterministic tie break", () => {
  const entries = [
    { rating: 1100, entryId: "zzzzzzzzzzzzzzzz" },
    { rating: 1200, entryId: "aaaaaaaaaaaaaaaa" },
    { rating: 1200, entryId: "________________" },
    { rating: 1200, entryId: "ZZZZZZZZZZZZZZZZ" },
    { rating: 1200, entryId: "AAAAAAAAAAAAAAAA" },
    { rating: 1200, entryId: "0000000000000000" },
    { rating: 1200, entryId: "----------------" },
  ].sort(compareServerOverallRankingKeys);
  assert.deepEqual(entries.map((entry) => entry.entryId), [
    "----------------",
    "0000000000000000",
    "AAAAAAAAAAAAAAAA",
    "ZZZZZZZZZZZZZZZZ",
    "________________",
    "aaaaaaaaaaaaaaaa",
    "zzzzzzzzzzzzzzzz",
  ]);
  assert.equal(sameServerOverallRankingKey(entries[0], { ...entries[0] }), true);
  assert.equal(sameServerOverallRankingKey(entries[0], entries[1]), false);
});

test("aggregate counts fail closed on malformed values", () => {
  assert.equal(aggregateCount({ data: () => ({ count: 755 }) }), 755);
  assert.equal(aggregateCount({ data: () => ({ count: -1 }) }), 0);
  assert.equal(aggregateCount({ data: () => ({ count: "invalid" }) }), 0);
});

test("optional ranking context falls back without disabling Crown proof", () => {
  assert.deepEqual(fallbackServerOverallStanding(1234), {
    rank: 0,
    participantCount: 0,
    rating: 1234,
    nextSeatGap: 0,
    neighbors: [],
  });
  assert.deepEqual(fallbackCrownCustomization({
    crownTheme: "gold",
    crownSignatureId: "daily_champion",
  }), {
    availableThemes: ["rose", "gold"],
    availableSignatureIds: ["daily_champion"],
  });
});

test("crown options preserve earned themes and de-duplicate signatures", () => {
  assert.deepEqual(crownCustomizationOptions(), {
    availableThemes: ["rose"],
    availableSignatureIds: [],
  });
  assert.deepEqual(crownCustomizationOptions({
    completedRun: true,
    topThreeAward: true,
    signatureIds: ["upset", "monthly_champion", "upset"],
  }), {
    availableThemes: ["rose", "aqua", "violet", "gold"],
    availableSignatureIds: ["upset", "monthly_champion"],
  });
});

test("crown run signature storage remains array-only as in the prior reader", () => {
  assert.deepEqual(normalizeSignatureIds("upset"), []);
  assert.deepEqual(normalizeSignatureIds(["upset", "unknown", "upset"]), ["upset"]);
  assert.match(functionsSource, /signatureIds:\s*run\.signatureIds/);
});

test("dashboard uses aggregate rank counts and bounded neighbor queries", () => {
  assert.doesNotMatch(functionsSource, /\.where\("enabled", "==", true\)\s*\.limit\(2_000\)/);
  assert.match(
    functionsSource,
    /\.where\("enabled", "==", true\)[\s\S]*?\.orderBy\("rating", "desc"\)[\s\S]*?\.orderBy\("entryId", "asc"\)/,
  );
  assert.match(functionsSource, /beforeQuery\.count\(\)\.get\(\)/);
  assert.match(functionsSource, /beforeQuery\.limitToLast\(3\)\.get\(\)/);
  assert.match(functionsSource, /afterQuery\.limit\(3\)\.get\(\)/);
  assert.match(functionsSource, /sameServerOverallRankingKey\(key, verifiedKey\)/);
  assert.match(functionsSource, /Promise\.allSettled\(\[\s*loadServerOverallStanding/);
  assert.match(functionsSource, /fallbackServerOverallStanding\(profile\.rating\)/);
  assert.match(functionsSource, /contextAvailable:\s*standingAvailable/);
  assert.doesNotMatch(functionsSource, /top:\s*rankedProfiles\.slice/);
});

test("ranking failures no longer surface as AnjuPay failures", () => {
  assert.match(functionsSource, /RANKING_ECONOMY_ACTIONS/);
  assert.match(functionsSource, /ランキング情報を処理できませんでした/);
  assert.match(functionsSource, /economyActionInternalMessage\(action\)/);
});

test("crown customization uses fixed existence queries instead of 90 plus 90 scans", () => {
  assert.doesNotMatch(functionsSource, /collection\("crownRuns"\)[\s\S]{0,160}\.limit\(90\)/);
  assert.doesNotMatch(functionsSource, /collection\("awards"\)[\s\S]{0,160}\.limit\(90\)/);
  assert.match(functionsSource, /where\("matchCount", ">=", CROWN_DAILY_MATCH_LIMIT\)\.limit\(1\)/);
  assert.match(functionsSource, /where\("signatureIds", "array-contains", signatureId\)\.limit\(1\)/);
  assert.match(functionsSource, /where\("rank", "in", \[1, 2, 3\]\)/);
  assert.match(functionsSource, /where\("tier", "==", tier\)\.limit\(1\)/);
});

test("required Firestore indexes are declared", () => {
  const signature = (index) => index.fields.map((field) => (
    `${field.fieldPath}:${field.order || field.arrayConfig}`
  )).join(",");
  const declared = indexes.indexes.map((index) => `${index.collectionGroup}|${signature(index)}`);
  assert.ok(declared.includes(
    "serverRankingProfiles|enabled:ASCENDING,rating:DESCENDING,entryId:ASCENDING",
  ));
  assert.ok(declared.includes(
    "serverRankingProfiles|enabled:ASCENDING,rating:ASCENDING,entryId:DESCENDING",
  ));
  assert.ok(declared.includes("awards|rank:ASCENDING,participantCount:ASCENDING"));
});
