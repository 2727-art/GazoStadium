const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const browser = fs.readFileSync(path.join(root, "market.js"), "utf8");

test("favorite targeting aligns and validates the buyer budget", () => {
  assert.match(browser, /function marketFavoritePreviousPrice\(/);
  assert.match(browser, /function alignBudgetToMarketFavorite\(/);
  assert.match(
    browser,
    /state\.maxBudget\s*=\s*requiredBudget/,
    "an affordable regular-shop selection should raise the purchase cap",
  );
  assert.match(
    browser,
    /alignBudgetToMarketFavorite\(selectedFavorite,\s*\{\s*announce:\s*true\s*\}\)/,
    "selecting a regular shop should align its budget immediately",
  );
  assert.match(
    browser,
    /const budgetAlignment = alignBudgetToMarketFavorite\(selectedFavorite\);[\s\S]*?if \(!budgetAlignment\.ok\) \{[\s\S]*?return;/,
    "queue join should reject a stale or unaffordable favorite budget",
  );
  assert.match(browser, /const joinedMaxBudget = state\.maxBudget;/);
  assert.match(browser, /maxBudget:\s*joinedMaxBudget/);
});

test("ranking navigation returns to the terminal result room", () => {
  assert.match(browser, /rankingReturnScreen:\s*"setup"/);
  assert.match(browser, /openRankings\("room"\)/);
  assert.match(
    browser,
    /state\.rankingReturnScreen = returnScreen === "room" && state\.room \? "room" : "setup"/,
  );
  assert.match(
    browser,
    /function returnFromRankings\(\) \{\s*state\.screen = state\.rankingReturnScreen === "room" && state\.room \? "room" : "setup";/,
  );
  const returnFromRankingsBody = browser.match(
    /function returnFromRankings\(\) \{([\s\S]*?)\n\}/,
  )?.[1] || "";
  assert.doesNotMatch(
    returnFromRankingsBody,
    /resetForReplay\(/,
    "the ranking back button must not discard unsent relationship feedback",
  );
});

test("queue join is locked and snapshots its role and target", () => {
  assert.match(
    browser,
    /if \(!state\.authReady \|\| state\.busy \|\| state\.shopBusy \|\| state\.queueJoinPending\) return;/,
  );
  assert.match(
    browser,
    /data-market-role="seller"[\s\S]*?\$\{locked \? "disabled" : ""\}/,
  );
  assert.match(
    browser,
    /if \(state\.busy \|\| state\.shopBusy \|\| state\.queueJoinPending\) return;\s*state\.role = button\.dataset\.marketRole;/,
  );
  assert.match(browser, /const joinedRole = state\.role;/);
  assert.match(browser, /const joinedFavoritePublicSellerId =/);
  assert.match(browser, /role:\s*joinedRole/);
  assert.match(browser, /favoritePublicSellerId:\s*joinedFavoritePublicSellerId/);
});

test("stale queue responses cannot rewind a newer room or queue attempt", () => {
  assert.match(browser, /queueAttemptGeneration:\s*0/);
  assert.match(browser, /queueHeartbeatPending:\s*false/);
  assert.match(browser, /const queueAttemptGeneration = beginQueueAttempt\(\);/);
  assert.match(
    browser,
    /if \(!isCurrentQueueAttempt\(generation, queueAttemptGeneration\) \|\| state\.roomId\) return;/,
  );
  assert.match(
    browser,
    /\["canceled", "missing", "superseded"\]\.includes/,
  );
  assert.match(
    browser,
    /state\.screen !== "waiting"\s*\|\| state\.queueHeartbeatPending/,
  );
  assert.match(
    browser,
    /state\.roomId === roomId && state\.roomUnsubscribe[\s\S]*?state\.screen = "room"/,
  );
});

test("replay preserves the negotiated buyer and seller settings", () => {
  assert.match(browser, /const pitchStyle = state\.pitchStyle;/);
  assert.match(browser, /const maxBudget = state\.maxBudget;/);
  assert.match(browser, /askingPrice,\s*pitchStyle,\s*maxBudget,/);
  assert.match(browser, /normalizeBuyerBudget\(\);/);
});

test("relationship feedback drafts survive unrelated renders", () => {
  assert.match(
    browser,
    /input\[name="marketImpressionTag"\][\s\S]*?state\.relationshipFeedback\.impressionTag = normalizeShopOptionId\(input\.value\)/,
  );
  assert.match(
    browser,
    /#marketRelationshipFavorite[\s\S]*?state\.relationshipFeedback\.favorite = event\.currentTarget\.checked === true/,
  );
  assert.match(browser, /favoritePersisted:\s*favorite === true/);
  assert.match(
    browser,
    /favoriteBeforeBlock = state\.relationshipFeedback\.favoritePersisted/,
    "blocking must restore only a previously persisted favorite, not an unsaved checkbox draft",
  );
});

test("new sales invalidate the certificate collection cache", () => {
  const invalidations = browser.match(/state\.certificateStatus = "idle";/g) || [];
  assert.ok(invalidations.length >= 3, "preview buy, live buy, and sold snapshots should invalidate certificates");
  assert.match(
    browser,
    /if \(previousStatus !== "sold"\) state\.certificateStatus = "idle";/,
  );
});

test("failed shop saves stay visibly unsaved and cannot enter the seller queue", () => {
  assert.match(browser, /shopErrorMessage:\s*""/);
  assert.match(browser, /state\.shopStatus = "save-error";/);
  assert.match(browser, /<strong>未保存です。<\/strong>/);
  assert.match(
    browser,
    /joinedRole === "seller" && state\.shopStatus === "save-error"/,
  );
  assert.match(browser, /店主カードが未保存です。再保存してから待機してください。/);
});
