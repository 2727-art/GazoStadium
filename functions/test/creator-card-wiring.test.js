"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const server = read("functions/index.js");
const { throwRetiredCommunityMode } = require("../retired-community-modes");
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
test("landing and online mode contain no creator-card UI, reads, publication or timers", () => {
  for (const file of ["app.js", "online.js"]) assert.doesNotMatch(read(file), /topMessage|TopMessage|creatorCard|CreatorCard|creator-card|TOP_MESSAGE|CREATOR_CARD|推しカード|FAVORITE CARD/);
  assert.match(read("app.js"), /ランキングに挑戦/);
  assert.match(read("online.js"), /normalizeMatchAchievementIds/);
  assert.match(read("online.js"), /renderOverallRankingParticipation/);
  assert.match(read("app.js"), /refreshRankingAtPeriodBoundary/);
  for (const file of ["styles.css", "velvet.css"]) assert.doesNotMatch(read(file), /\.creator-card|\.landing-community|\.community-message/);
});
test("old clients cannot publish, delete or buy creator cards before any database access", async () => {
  const source = server.slice(server.indexOf("exports.economyAction ="), server.indexOf("exports.redeemAchievementCode ="));
  const start = server.indexOf("async function purchaseProduct(");
  const end = server.indexOf("\nasync function ", start + 10);
  const context = { exports: {}, onCall: (_options, handler) => handler, callableOptions: () => ({}),
    requireUid: () => "owner", cleanText: (s) => s, HttpsError, throwRetiredCommunityMode,
    CREATOR_CARD_PREMIUM_PRODUCT_ID: "feature_top_message",
    readLegacyEconomy: () => { throw new Error("unexpected database access"); }, console };
  vm.createContext(context); vm.runInContext(server.slice(start, end) + "\n" + source, context);
  for (const data of [{ action: "publish_creator_card" }, { action: "delete_creator_card" }, { action: "purchase", productId: "feature_top_message" }]) {
    await assert.rejects(context.exports.economyAction({ data }), (e) => {
      assert.equal(e.code, "failed-precondition"); assert.equal(e.details.reason, "mode-retired"); assert.equal(e.details.mode, "creator_card"); return true;
    });
  }
});
test("retired cards are unreadable; ranking access and legacy ownership survive", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  for (const key of ["topMessages", "topMessageOwners", "topMessageEntriesByUser"]) assert.deepEqual(rules[key], { ".read": false, ".write": false });
  assert.equal(rules.leaderboard[".read"], true);
  assert.deepEqual(require("../product-catalog").feature_top_message, { id: "feature_top_message", type: "feature", price: 500 });
  assert.doesNotMatch(server, /syncCreatorCardGrowth|publishCreatorCard|ensureCreatorCardEntryId/);
  assert.match(server, /topMessageSnapshot/);
});
