const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const {
  isIncomingMarketRoomStateOlder,
  nextPublicMarketRoomHeartbeat,
  nextPublicMarketRoomState,
} = require("../market-presence-state");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const presenceModule = import(pathToFileURL(path.join(root, "market-presence.mjs")).href);

test("market presence counts only fresh queues and two-sided active rooms", async () => {
  const { summarizeMarketPresence } = await presenceModule;
  const now = 1_800_000_000_000;
  const result = summarizeMarketPresence({
    queues: {
      sellerFresh: { role: "seller", lastSeen: now - 20_000 },
      buyerFresh: { role: "buyer", lastSeen: now - 59_999 },
      sellerStale: { role: "seller", lastSeen: now - 60_001 },
      unknownRole: { role: "observer", lastSeen: now },
      invalidTime: { role: "buyer", lastSeen: "not-a-time" },
    },
    rooms: {
      bothFresh: { sellerSeenAt: now - 50_000, buyerSeenAt: now - 10_000 },
      sellerOnly: { sellerSeenAt: now - 10_000 },
      buyerStale: { sellerSeenAt: now - 10_000, buyerSeenAt: now - 60_001 },
      closedWithOldFields: { closed: true, sellerSeenAt: now, buyerSeenAt: now },
    },
  }, now);

  assert.deepEqual(result, {
    sellerWaiting: 1,
    buyerWaiting: 1,
    negotiating: 1,
  });
});

test("market presence rejects timestamps too far in the future", async () => {
  const { summarizeMarketPresence } = await presenceModule;
  const now = 1_800_000_000_000;
  assert.deepEqual(summarizeMarketPresence({
    queues: {
      futureSeller: { role: "seller", lastSeen: now + 300_001 },
    },
    rooms: {
      futureRoom: { sellerSeenAt: now + 300_001, buyerSeenAt: now },
    },
  }, now), {
    sellerWaiting: 0,
    buyerWaiting: 0,
    negotiating: 0,
  });
});

test("terminal room state cannot be reopened by a stale heartbeat or mirror", () => {
  const terminal = nextPublicMarketRoomState({
    closed: false,
    stateVersion: 2,
    sellerSeenAt: 100,
    buyerSeenAt: 100,
  }, {
    stateVersion: 3,
  }, {
    now: 200,
    terminal: true,
  });

  assert.deepEqual(terminal, {
    closed: true,
    stateVersion: 3,
    updatedAt: 200,
  });
  assert.equal(nextPublicMarketRoomHeartbeat(terminal, { stateVersion: 2 }, "seller", 210), undefined);
  assert.equal(nextPublicMarketRoomState(terminal, { stateVersion: 2 }, {
    now: 210,
    terminal: false,
  }), undefined);
  assert.equal(isIncomingMarketRoomStateOlder({ stateVersion: 3 }, { stateVersion: 2 }), true);
  assert.equal(isIncomingMarketRoomStateOlder({ stateVersion: 3 }, { stateVersion: 4 }), false);
});

test("room heartbeat preserves the other role without changing business state", () => {
  assert.deepEqual(nextPublicMarketRoomHeartbeat({
    closed: false,
    stateVersion: 4,
    sellerSeenAt: 300,
    updatedAt: 300,
  }, {
    stateVersion: 4,
  }, "buyer", 320), {
    closed: false,
    stateVersion: 4,
    sellerSeenAt: 300,
    buyerSeenAt: 320,
    updatedAt: 320,
  });
});

test("retired market lobby stats are absent while historical server mirror, heartbeat, and rules stay intact", () => {
  const appSource = read("app.js");
  const onlineSource = read("online.js");
  const marketSource = read("market.js");
  const functionsSource = read("functions/index.js");
  const rules = JSON.parse(read("database.rules.json"));

  for (const id of [
    "lobbyMarketSellerWaitingCount",
    "lobbyMarketBuyerWaitingCount",
    "lobbyMarketNegotiatingCount",
  ]) {
    assert.doesNotMatch(appSource, new RegExp(`id="${id}"`));
    assert.doesNotMatch(onlineSource, new RegExp(`${id}:`));
  }
  assert.doesNotMatch(onlineSource, /online\/publicMarketPresence|summarizeMarketPresence|market-presence\.mjs|marketPresenceEntries|lobbyStats\.market/);
  assert.doesNotMatch(appSource, /lobbyStats\.market|class="lobby-mode-card market"|market-counts/);
  assert.match(appSource, /id="valueMarketRankingButton"[^>]*>[\s\S]*?旧推し値市場の記録<\/button>/);
  assert.match(functionsSource, /crypto\.randomBytes\(20\)\.toString\("hex"\)/);
  assert.doesNotMatch(functionsSource, /eventId\(`(?:queue|room):\$\{/);
  assert.match(functionsSource, /\.orderByChild\("lastSeen"\)/);
  assert.match(functionsSource, /\.orderByChild\("updatedAt"\)/);
  assert.match(functionsSource, /marketPublicQueueRef\(presenceId\)\.set\(\{\s*role: entry\.role,\s*lastSeen: Number\(entry\.lastSeen\),\s*\}\)/);
  assert.match(marketSource, /function startRoomHeartbeat/);
  assert.match(marketSource, /marketQueueCallable\(\{ action: "sync_room", roomId \}\)/);
  assert.match(marketSource, /marketQueueCallable\(\{ action: "heartbeat_room", roomId \}\)/);
  assert.match(marketSource, /function scheduleRoomSyncRetry/);
  const enterRoomSource = marketSource.slice(
    marketSource.indexOf("async function enterRoom"),
    marketSource.indexOf("function markPresenceOffline"),
  );
  assert.ok(enterRoomSource.indexOf("onSnapshot(") < enterRoomSource.indexOf("connectMarketRoomServices("));
  const syncRoomSource = functionsSource.slice(
    functionsSource.indexOf("async function syncMarketRoom"),
    functionsSource.indexOf("exports.valueMarketQueue"),
  );
  assert.match(syncRoomSource, /if \(recoverPrivate \|\| isTerminalMarketState\(room\.status\)\)/);
  assert.match(syncRoomSource, /touchMarketRoomPublicPresence\(room, role\)/);

  const publicRules = rules.rules.online.publicMarketPresence;
  assert.equal(publicRules[".read"], true);
  assert.equal(publicRules[".write"], false);
  assert.equal(rules.rules.online.valueMarketRooms.$roomId.stateVersion[".write"], false);
});
