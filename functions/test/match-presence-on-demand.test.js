"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("fresh battle presence counts filter mode and state and exclude only the current waiting row", async () => {
  const moduleUrl = pathToFileURL(path.join(root, "battle-presence-stats.mjs")).href;
  const { summarizeBattlePresence } = await import(moduleUrl);
  const now = 100_000;
  const entries = {
    own: { mode: "solo", state: "waiting", lastSeen: now - 45_000 },
    other: { mode: "solo", state: "waiting", lastSeen: now - 1 },
    playing: { mode: "solo", state: "playing", lastSeen: now },
    stale: { mode: "solo", state: "waiting", lastSeen: now - 45_001 },
    strategy: { mode: "strategy", state: "waiting", lastSeen: now },
    invalid: { mode: "solo", state: "review", lastSeen: now },
    missingTime: { mode: "solo", state: "waiting" },
  };

  assert.deepEqual(summarizeBattlePresence(entries, {
    mode: "solo",
    now,
    freshMs: 45_000,
    ownPresenceId: "own",
  }), {
    waiting: 2,
    otherWaiting: 1,
    playing: 1,
  });
  assert.deepEqual(summarizeBattlePresence(entries, {
    mode: "solo",
    now,
    freshMs: 45_000,
    ownPresenceId: "not-in-snapshot",
  }), {
    waiting: 2,
    otherWaiting: 2,
    playing: 1,
  });
});

test("the player count refresh is a server-time-bounded one-shot query with cooldown and in-flight sharing", () => {
  const online = read("online.js");
  const refresh = sourceBetween(
    online,
    "async function refreshBattlePresenceCheck(mode, { phase = \"setup\" } = {})",
    "function getLeaderboard()",
  );

  assert.match(online, /\bstartAt,\s*\n\s*update,/);
  assert.match(online, /const BATTLE_PRESENCE_CHECK_COOLDOWN_MS = 30_000;/);
  assert.match(refresh, /if \(check\.request\) return check\.request;/);
  assert.match(refresh, /const serverNow = await loadBattlePresenceServerNow\(\);/);
  assert.match(refresh, /const freshAfter = serverNow - PUBLIC_PRESENCE_FRESH_MS;/);
  assert.match(
    refresh,
    /get\(query\(\s*ref\(database, "online\/publicPresence"\),\s*orderByChild\("lastSeen"\),\s*startAt\(freshAfter\),\s*\)\)/s,
  );
  assert.doesNotMatch(refresh, /onValue\(|setInterval\(|refreshLobbyPublicStats\(/);

  const serverTime = sourceBetween(
    online,
    "async function loadBattlePresenceServerNow()",
    "async function refreshBattlePresenceCheck(mode, { phase = \"setup\" } = {})",
  );
  assert.match(serverTime, /get\(ref\(database, "\.info\/serverTimeOffset"\)\)/);
});

test("normal and strategy setup and matching screens share the on-demand panel", () => {
  const online = read("online.js");
  const strategy = read("strategy.js");

  assert.match(online, /renderBattlePresenceCheck\(\{ mode: "solo", phase: "setup" \}\)/);
  assert.match(online, /renderBattlePresenceCheck\(\{ mode: "solo", phase: "matching" \}\)/);
  assert.match(strategy, /renderBattlePresenceCheck\?\.\(\{ mode: "strategy", phase: "setup" \}\)/);
  assert.match(strategy, /renderBattlePresenceCheck\?\.\(\{ mode: "strategy", phase: "matching" \}\)/);
  assert.match(online, /getOwnPresenceId: \(\) => state\.publicPresenceId \|\| state\.publicPresencePendingId/);
  assert.match(strategy, /getOwnPresenceId: \(\) => state\.publicPresenceId \|\| state\.publicPresencePendingId/);
  assert.match(online, /waitingLabel: matching \? "ほかに待機中" : "待機中"/);
  assert.match(online, /<button class="button button-ghost" type="button" data-battle-presence-refresh=/);
  assert.match(online, /取得時点の参考値です。好み条件や直前の成立・退出により、マッチングを保証するものではありません。/);
});

test("matching waits for an exact current or pending presence id before enabling the count check", () => {
  const online = read("online.js");
  const strategy = read("strategy.js");
  const normalStartPresence = sourceBetween(
    online,
    "async function startPublicPresence(generation)",
    "async function updatePublicPresence(nextState)",
  );
  const strategyStartPresence = sourceBetween(
    strategy,
    "async function startPublicPresence(generation)",
    "async function writePublicPresence(presenceRef, presenceState)",
  );
  const normalCleanupPresence = sourceBetween(
    online,
    "async function cleanupPublicPresence(targetState = state)",
    "function processIncomingOffers(snapshot)",
  );
  const strategyCleanupPresence = sourceBetween(
    strategy,
    "async function cleanupPublicPresence()",
    "function requestHome()",
  );

  assert.match(online, /const awaitingOwnPresence = matching && !getBattlePresenceOwnId\(mode\);/);
  assert.match(online, /disabled: !available \|\| check\.loading \|\| awaitingOwnPresence \|\| coolingDown/);
  assert.match(online, /phase === "matching" && !getBattlePresenceOwnId\(mode\)/);
  assert.ok(
    normalStartPresence.indexOf("state.publicPresencePendingId = presenceId;")
      < normalStartPresence.indexOf("await writePublicPresence(presenceRef, \"solo\", \"waiting\");"),
  );
  assert.ok(
    strategyStartPresence.indexOf("state.publicPresencePendingId = presenceId;")
      < strategyStartPresence.indexOf("await writePublicPresence(presenceRef, \"waiting\");"),
  );
  assert.match(normalStartPresence, /state\.publicPresenceId = presenceId;\s*state\.publicPresencePendingId = "";/);
  assert.match(strategyStartPresence, /state\.publicPresenceId = presenceId;\s*state\.publicPresencePendingId = "";/);
  assert.match(normalCleanupPresence, /targetState\.publicPresenceId \|\| targetState\.publicPresencePendingId/);
  assert.match(normalCleanupPresence, /targetState\.publicPresencePendingId = "";/);
  assert.match(strategyCleanupPresence, /state\.publicPresenceId \|\| state\.publicPresencePendingId/);
  assert.match(strategyCleanupPresence, /state\.publicPresencePendingId = "";/);
});

test("the on-demand panel keeps its query indexed and ships fresh static assets", () => {
  const rules = JSON.parse(read("database.rules.json"));
  const html = read("index.html");
  const styles = read("styles.css");
  const online = read("online.js");

  assert.equal(rules.rules.online.publicPresence[".read"], true);
  assert.deepEqual(rules.rules.online.publicPresence[".indexOn"], ["lastSeen"]);
  assert.match(styles, /\.battle-presence-check\s*\{/);
  assert.match(styles, /\.battle-presence-counts\s*\{/);
  for (const asset of ["styles.css", "strategy.js", "online.js"]) {
    assert.match(
      html,
      new RegExp(`${asset.replace(".", "\\.")}\\?v=[^"]*presence-check-v1`),
    );
  }
  assert.match(online, /battle-presence-stats\.mjs\?v=presence-check-v1/);
});
