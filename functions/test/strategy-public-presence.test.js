"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const strategySource = read("strategy.js");
const rules = JSON.parse(read("database.rules.json")).rules.online;

function section(start, end) {
  const startIndex = strategySource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = strategySource.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return strategySource.slice(startIndex, endIndex);
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} is missing: ${value}`);
  }
}

test("strategy public presence is derived from an owned queue or active room", () => {
  const validation = rules.publicPresence.$sessionId[".validate"];

  assert.ok(validation.startsWith("!newData.exists() ||"));
  includesAll(validation, [
    "data.child('mode').val() !== 'strategy' || newData.child('mode').val() === 'strategy'",
    "root.child('online/strategyQueue/' + auth.uid + '/uid').val() === auth.uid",
    "root.child('online/strategyQueue/' + auth.uid + '/state').val() === 'waiting'",
    "root.child('online/strategyQueue/' + auth.uid + '/state').val() === 'offering'",
    "root.child('online/strategyActive/' + auth.uid).isString()",
    "root.child('online/strategyActive/' + auth.uid).val() + '/status').val() === 'active'",
    "'/members/' + auth.uid).val() === true",
    "'/players/' + auth.uid + '/uid').val() === auth.uid",
    "'/destroyed').exists()",
    "'/finished/' + auth.uid).exists()",
    "!== 'withdraw'",
  ], "strategy presence validation");
  assert.doesNotMatch(validation, /reviewStartedAt|reviewEnded|\/presence\//);
  assert.equal(
    rules.publicPresence.$sessionId[".write"],
    "auth != null && root.child('online/publicPresenceOwners/' + $sessionId).val() === auth.uid",
  );
});

test("entering a room never waits for lobby presence before starting P2P", () => {
  const enterRoom = section("async function enterRoom(roomId,", "async function setupRoomListeners()");
  const publicUpdate = enterRoom.indexOf('updatePublicPresence("playing").catch(() => {});');
  const connecting = enterRoom.indexOf('state.screen = "connecting";');
  const roomListeners = enterRoom.indexOf("await setupRoomListeners();");
  const peerSetup = enterRoom.indexOf("await setupPeerConnection();");

  assert.ok(publicUpdate >= 0);
  assert.ok(publicUpdate < connecting && connecting < roomListeners && roomListeners < peerSetup);
  assert.doesNotMatch(enterRoom, /await updatePublicPresence\("playing"\)/);
});

test("a delayed old presence failure cannot clean a newer presence id", async () => {
  const updatePresence = section("async function updatePublicPresence(nextState)", "async function cleanupPublicPresence()");
  const capture = updatePresence.indexOf("const id = state.publicPresenceId;");
  const write = updatePresence.indexOf("online/publicPresence/${id}");
  const fence = updatePresence.indexOf("if (state.publicPresenceId === id) await cleanupPublicPresence();");

  assert.ok(capture >= 0 && capture < write && write < fence);
  assert.doesNotMatch(updatePresence, /online\/publicPresence\/\$\{state\.publicPresenceId\}/);

  const state = {
    publicPresenceId: "presence-old",
    publicPresenceState: "waiting",
  };
  let rejectOldWrite;
  const oldWrite = new Promise((resolve, reject) => {
    rejectOldWrite = reject;
  });
  let cleanupCalls = 0;
  const loadUpdatePublicPresence = new Function(
    "state",
    "writePublicPresence",
    "ref",
    "database",
    "cleanupPublicPresence",
    `"use strict"; return (${updatePresence.trim()});`,
  );
  const updatePublicPresence = loadUpdatePublicPresence(
    state,
    async (presenceRef, presenceState) => {
      assert.equal(presenceRef, "online/publicPresence/presence-old");
      assert.equal(presenceState, "playing");
      await oldWrite;
    },
    (_database, relativePath) => relativePath,
    {},
    async () => { cleanupCalls += 1; },
  );

  const pendingUpdate = updatePublicPresence("playing");
  assert.equal(state.publicPresenceState, "playing");
  state.publicPresenceId = "presence-new";
  state.publicPresenceState = "waiting";
  rejectOldWrite(new Error("delayed old write failure"));

  assert.equal(await pendingUpdate, false);
  assert.equal(cleanupCalls, 0);
  assert.equal(state.publicPresenceId, "presence-new");
  assert.equal(state.publicPresenceState, "waiting");
});

test("an active ownership mismatch stops only the lobby presence", () => {
  const listeners = section("async function setupRoomListeners()", "async function setupPeerConnection()");
  const activeWatchStart = listeners.indexOf('onValue(ref(database, `online/strategyActive/${state.uid}`)');
  const activeWatchEnd = listeners.indexOf("const presenceRef", activeWatchStart);
  assert.ok(activeWatchStart >= 0 && activeWatchEnd > activeWatchStart);
  const activeWatch = listeners.slice(activeWatchStart, activeWatchEnd);

  includesAll(activeWatch, [
    "state.roomId !== ownedRoomId",
    "snapshot.val() === ownedRoomId",
    "cleanupPublicPresence().catch(() => {})",
  ], "strategy active ownership watcher");
  assert.doesNotMatch(activeWatch, /cleanupOnlineResources|cleanupMatchmaking|destroyRoom|peer\.close|strategyRooms/);
});

test("finish and withdrawal stop lobby presence without ending the room or review", () => {
  const finishMatch = section("async function finishMatch()", "function calculateRating(");
  const resultWrite = finishMatch.indexOf("await update(ref(database");
  const publicCleanup = finishMatch.indexOf("cleanupPublicPresence().catch(() => {});");
  const stats = finishMatch.indexOf("await commitStrategyStats();");

  assert.ok(resultWrite >= 0 && resultWrite < publicCleanup && publicCleanup < stats);
  assert.doesNotMatch(finishMatch, /cleanupOnlineResources|cleanupMatchmaking|strategyActive|peer\.close/);

  const react = section("async function reactToRoomData()", "async function reactToRoundData()");
  const withdrawStart = react.indexOf('Object.values(decisions).includes("withdraw")');
  const withdrawEnd = react.indexOf("return;", withdrawStart);
  const withdraw = react.slice(withdrawStart, withdrawEnd);
  assert.match(withdraw, /cleanupPublicPresence\(\)\.catch/);
  assert.doesNotMatch(withdraw, /cleanupOnlineResources|cleanupMatchmaking|strategyActive|peer\.close/);

  assert.match(strategySource, /const REVIEW_DURATION_MS = 10 \* 60 \* 1000;/);
  assert.match(strategySource, /async function maybeStartStrategyReview\(\)/);
});

test("public cleanup detaches locally and removes presence before its owner", () => {
  const cleanup = section("async function cleanupPublicPresence()", "function requestHome()");
  const captureId = cleanup.indexOf("const id = state.publicPresenceId || state.publicPresencePendingId;");
  const clearId = cleanup.indexOf('state.publicPresenceId = "";');
  const clearPendingId = cleanup.indexOf('state.publicPresencePendingId = "";');
  const cancel = cleanup.indexOf("await disconnect?.cancel?.()");
  const removePresence = cleanup.indexOf("online/publicPresence/${id}");
  const removeOwner = cleanup.indexOf("online/publicPresenceOwners/${id}");

  assert.ok(captureId >= 0 && captureId < clearId && clearId < clearPendingId && clearPendingId < cancel);
  assert.ok(cancel < removePresence && removePresence < removeOwner);
  assert.doesNotMatch(cleanup, /Promise\.allSettled/);
});

test("the strategy asset cache key includes the ownership guard release", () => {
  assert.match(read("index.html"), /strategy\.js\?v=[^"]*strategy-presence-owner-v1/);
});
