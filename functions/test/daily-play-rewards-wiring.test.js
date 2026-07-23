const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("daily play claims use verified period progress and one idempotent Firestore transaction", () => {
  const source = read("functions/index.js");
  const claimFunction = source.match(
    /async function claimDailyPlayRewards\(uid\) \{[\s\S]*?\r?\n\}\r?\n\r?\nasync function purchaseProduct/,
  )?.[0] || "";

  assert.match(claimFunction, /claimableDailyPlayRewards\(\s*progress\.periodRewards,\s*progress\.dailyPlayClaims,/);
  assert.match(claimFunction, /firestore\.runTransaction/);
  assert.match(claimFunction, /transaction\.get\(wallet\)/);
  assert.match(claimFunction, /transaction\.get\(progressRef\)/);
  assert.match(claimFunction, /transaction\.get\(claimRef\)/);
  assert.match(claimFunction, /eventId\(`\$\{dateKey\}:play:\$\{tier\.id\}`\)/);
  assert.match(claimFunction, /settleDailyPlayRewardClaims/);
  assert.match(claimFunction, /MAX_POINTS - reservedIncoming - before/);
  assert.match(claimFunction, /if \(!decision\.create\) return;/);
  assert.match(claimFunction, /transaction\.create\(claimRefs\[index\]/);
  assert.doesNotMatch(claimFunction, /request\.(?:data|rawRequest)/);
});

test("initialize, verified match recording, and claims all return the server summary", () => {
  const source = read("functions/index.js");

  assert.match(source, /dailyPlay:\s*dailyPlayRewardSummary\(progress\.periodRewards, progress\.dailyPlayClaims\)/);
  assert.match(source, /dailyPlay:\s*dailyPlayRewardSummary\(\s*progressResult\.periodRewards,\s*progressResult\.dailyPlayClaims,\s*Date\.now\(\),/);
  assert.match(source, /dailyPlay:\s*dailyPlayRewardSummary\(progressResult\.periodRewards, progressResult\.dailyPlayClaims, now\)/);
  assert.match(source, /action === "claim_daily_play"\) return await claimDailyPlayRewards\(uid\)/);
});

test("all four modes feed the shared verified-match reward path", () => {
  const online = read("online.js");
  const modeSources = [
    ["strategy", read("strategy.js")],
    ["team", read("team.js")],
    ["royale", read("royale.js")],
  ];
  assert.match(online, /mode:\s*"solo"[\s\S]*?recordOverallResult/);
  assert.match(online, /await recordPeriodRewardResult\(user\.uid, mode, outcome, roomId, resultTimestamp\)/);
  for (const [mode, source] of modeSources) {
    assert.match(source, new RegExp(`recordOverallResult\\?\\.\\(\\{\\s*mode:\\s*"${mode}"`));
    assert.match(source, /overallResult\?\.economyBalance !== null/);
    assert.match(source, /state\.economy\.points = Number\(overallResult\.economyBalance\)/);
  }
  assert.match(online, /action:\s*"record_match", mode, outcome, roomId/);
  assert.match(online, /settleDailyPlayRewards\(uid, \{ announce: true, renderAfter: false \}\)/);
  assert.match(online, /economyBalance:\s*periodResult\?\.economyBalance \?\? null/);
});

test("missions show one claim-all control, interval progress, and folded tier details", () => {
  const online = read("online.js");
  const css = read("styles.css");
  const html = read("index.html");
  const readme = read("README.md");

  assert.equal((online.match(/id="claimDailyPlayRewardsButton"/g) || []).length, 1);
  assert.match(online, /renderDailyPlayRewardPanel\(\)/);
  assert.match(online, /const reachedMaximum = dailyPlay\.matches >= dailyPlay\.maxMatches/);
  assert.match(online, /const previousTarget = reachedMaximum\s*\?\s*0/);
  assert.match(online, /role="progressbar"/);
  assert.match(online, /<details class="daily-play-reward-details">/);
  assert.match(online, /まとめて受け取る/);
  assert.match(online, /incomingDateKey < state\.dailyPlay\.dateKey/);
  assert.match(css, /\.daily-play-reward-panel/);
  assert.match(css, /\.daily-play-reward-details/);
  assert.match(html, /styles\.css\?v=[^"]*daily-play-v1/);
  assert.match(html, /online\.js\?v=[^"]*daily-play-v1/);
  for (const moduleName of ["strategy", "team", "royale"]) {
    assert.match(html, new RegExp(`${moduleName}\\.js\\?v=[^"]*daily-play-v1`));
  }
  assert.match(html, /id="toast"[^>]*aria-atomic="true"/);
  assert.match(readme, /正式完走1・3・5・10・20・30・50・75・100・150・200戦/);
  assert.match(readme, /合計最大300PT/);
  assert.match(readme, /終了後7日間/);
});
