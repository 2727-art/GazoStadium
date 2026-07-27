"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ACHIEVEMENT_DEFINITIONS,
  ACTIVE_BATTLE_MODES,
  BATTLE_MODES,
} = require("../achievements");

const functionsRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(functionsRoot, "..");
const read = (relativePath) => fs.readFileSync(path.join(functionsRoot, relativePath), "utf8");
const readProject = (relativePath) => (
  fs.readFileSync(path.join(projectRoot, relativePath), "utf8")
);

test("retired team modes have no callable result derivation or active-session path", () => {
  const source = read("index.js");
  const verifiedModes = source.slice(
    source.indexOf("const VERIFIED_MATCH_MODES"),
    source.indexOf("function objectValue", source.indexOf("const VERIFIED_MATCH_MODES")),
  );

  assert.equal(fs.existsSync(path.join(functionsRoot, "team-duo-challenge.js")), false);
  assert.doesNotMatch(source, /team-duo-challenge|deriveTeamDuoChallengeResult/);
  assert.doesNotMatch(source, /prepareTeamChallenge|prepare_team_challenge/);
  assert.doesNotMatch(source, /online\/teamDuoScores|verifiedTeamDuoResults/);
  assert.doesNotMatch(verifiedModes, /\bteam\s*:/);
  assert.doesNotMatch(source, /teamActive|teamQueue|teamRooms/);
  assert.match(source, /trainingActive/);
  assert.match(source, /trainingQueue/);
  assert.match(source, /trainingRooms/);
});

test("retired team matches cannot enter rewards, tips, rankings, crowns, or achievements", () => {
  const source = read("index.js");
  const verifiedModes = source.slice(
    source.indexOf("const VERIFIED_MATCH_MODES"),
    source.indexOf("function objectValue", source.indexOf("const VERIFIED_MATCH_MODES")),
  );
  const tipValidation = source.slice(
    source.indexOf("function validatePostMatchTipRequest"),
    source.indexOf("async function sendPostMatchTip"),
  );

  assert.doesNotMatch(verifiedModes, /team/);
  assert.match(tipValidation, /VERIFIED_MATCH_MODES\[mode\]/);
  assert.deepEqual(ACTIVE_BATTLE_MODES, ["solo", "strategy"]);
  for (const definition of ACHIEVEMENT_DEFINITIONS.filter((entry) => (
    entry.condition?.mode === "team"
    || entry.id.startsWith("team_")
    || entry.id.startsWith("battle_variety_three_")
  ))) {
    assert.equal(definition.legacy, true, definition.id);
  }
});

test("historical team records stay in normalization schemas while new writes are closed", () => {
  const source = read("index.js");
  assert.match(source, /team:\s*integer\(source\?\.modeMatches\?\.team/);
  assert.match(source, /teamDuo:\s*integer\(source\?\.variantMatches\?\.teamDuo/);
  assert.ok(BATTLE_MODES.includes("team"));
  assert.ok(BATTLE_MODES.includes("team_duo"));
  assert.ok(BATTLE_MODES.includes("royale"));
});

test("retired multiplayer titles remain compatible for owners but reject new purchases", () => {
  const source = read("index.js");
  const catalog = read("product-catalog.js");
  const productIds = [
    "title_team_link_active",
    "title_trust_my_partner",
    "title_combo_romance",
    "title_last_image",
    "title_still_surviving",
  ];
  for (const productId of productIds) {
    assert.match(catalog, new RegExp(`"${productId}"`), productId);
    assert.match(source, new RegExp(`"${productId}"`), productId);
  }
  const purchase = source.slice(
    source.indexOf("async function purchaseProduct"),
    source.indexOf("async function claimPeriods"),
  );
  assert.ok(
    purchase.indexOf("purchaseSnapshot.exists || alreadyOwned")
      < purchase.indexOf("RETIRED_TEAM_PRODUCT_IDS.has(productId)"),
    "existing Firestore and legacy owners must migrate before the retirement rejection",
  );
  assert.match(purchase, /RETIRED_TEAM_PRODUCT_IDS\.has\(productId\)/);
  assert.match(purchase, /new HttpsError\(\s*"failed-precondition"/);
  assert.match(purchase, /outcome:\s*"owned"/);
  assert.match(purchase, /migrated:\s*true/);
});

test("retired multiplayer titles are hidden from new buyers but stay visible to owners", () => {
  const titles = readProject("player-titles.js");
  const online = readProject("online.js");
  for (const productId of [
    "title_team_link_active",
    "title_trust_my_partner",
    "title_combo_romance",
    "title_last_image",
    "title_still_surviving",
  ]) {
    assert.match(
      titles,
      new RegExp(`id:\\s*"${productId}"[^\\n]*retired:\\s*true`),
      productId,
    );
  }
  assert.match(
    online,
    /product\.retired !== true \|\| state\.economy\.inventory\?\.\[product\.id\] === true/,
  );
});
