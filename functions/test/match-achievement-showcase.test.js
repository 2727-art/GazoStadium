"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildMatchAchievementShowcases,
  matchAchievementParticipantUids,
  normalizeMatchAchievementShowcases,
  settleMatchAchievementShowcaseRead,
  strategyAchievementShowcaseRevealReady,
} = require("../match-achievement-showcase");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hostUid = "host-user";
const guestUid = "guest-user";

function profile(unlockedIds, customShowcase = unlockedIds) {
  return {
    schemaVersion: 1,
    unlocked: Object.fromEntries(unlockedIds.map((id, index) => [id, 1_000 + index])),
    pendingUnlocks: {},
    customShowcase,
    initializedAt: 1_000,
    updatedAt: 2_000,
  };
}

test("room snapshots are derived from normalized unlocked showcases and capped at three", () => {
  const snapshot = buildMatchAchievementShowcases([
    hostUid,
    guestUid,
  ], [
    profile([
      "battle_total_1",
      "battle_solo_1",
      "battle_strategy_1",
      "battle_losses_1",
    ]),
    profile(["battle_total_10"], ["battle_total_10", "market_seller_1"]),
  ], 12_345);

  assert.deepEqual(snapshot, {
    version: 1,
    capturedAt: 12_345,
    players: {
      [hostUid]: {
        ids: "battle_total_1,battle_solo_1,battle_strategy_1",
      },
      [guestUid]: {
        ids: "battle_total_10",
      },
    },
  });
  assert.deepEqual(
    normalizeMatchAchievementShowcases(snapshot, [hostUid, guestUid]),
    snapshot,
  );
});

test("snapshot validation rejects unknown, duplicate, extra, or mismatched player data", () => {
  const valid = buildMatchAchievementShowcases(
    [hostUid, guestUid],
    [null, null],
    12_345,
  );
  assert.equal(valid.players[hostUid].ids, "");
  assert.equal(normalizeMatchAchievementShowcases({
    ...valid,
    extra: true,
  }, [hostUid, guestUid]), null);
  assert.equal(normalizeMatchAchievementShowcases({
    ...valid,
    players: {
      ...valid.players,
      [hostUid]: { ids: "unknown-achievement" },
    },
  }, [hostUid, guestUid]), null);
  assert.equal(normalizeMatchAchievementShowcases({
    ...valid,
    players: {
      ...valid.players,
      [hostUid]: { ids: "battle_total_1,battle_total_1" },
    },
  }, [hostUid, guestUid]), null);
  assert.equal(normalizeMatchAchievementShowcases(valid, [hostUid, "other-user"]), null);
});

test("room participant extraction requires both canonical members and player identities", () => {
  const room = {
    hostUid,
    guestUid,
    members: { [hostUid]: true, [guestUid]: true },
    players: {
      [hostUid]: { uid: hostUid },
      [guestUid]: { uid: guestUid },
    },
  };
  assert.deepEqual(matchAchievementParticipantUids(room), [hostUid, guestUid]);
  assert.equal(matchAchievementParticipantUids({
    ...room,
    players: { ...room.players, [guestUid]: { uid: "other-user" } },
  }), null);
});

test("strategy snapshots stay unavailable until both canonical players finish deck setup", () => {
  const room = {
    deckReady: {
      [hostUid]: { ready: true },
      [guestUid]: { ready: true },
    },
  };
  assert.equal(
    strategyAchievementShowcaseRevealReady(room, [hostUid, guestUid]),
    true,
  );
  assert.equal(
    strategyAchievementShowcaseRevealReady({
      ...room,
      deckReady: { [hostUid]: { ready: true } },
    }, [hostUid, guestUid]),
    false,
  );
  assert.equal(
    strategyAchievementShowcaseRevealReady(room, [hostUid, hostUid]),
    false,
  );
});

test("optional normal-match reads settle quickly and fail open", async () => {
  assert.deepEqual(
    await settleMatchAchievementShowcaseRead(() => Promise.resolve("ready"), 50),
    { status: "fulfilled", value: "ready" },
  );
  const rejected = await settleMatchAchievementShowcaseRead(
    () => Promise.reject(new Error("offline")),
    50,
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.error.message, "offline");
  const startedAt = Date.now();
  const timedOut = await settleMatchAchievementShowcaseRead(
    () => new Promise(() => {}),
    5,
  );
  assert.deepEqual(timedOut, { status: "timeout" });
  assert.ok(Date.now() - startedAt < 100);
});

test("callable, materialization, App Check, and server-only room rules are wired", () => {
  const backend = read("functions/index.js");
  const rollout = require("../app-check-rollout");
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  const callableStart = backend.indexOf("exports.matchAchievementShowcase = onCall(");
  const callableEnd = backend.indexOf("const RANKING_ECONOMY_ACTIONS", callableStart);
  const callable = backend.slice(callableStart, callableEnd);
  const v2Start = backend.indexOf("async function trySoloSessionV2Match");
  const v2End = backend.indexOf("function soloSessionV2ActiveMatchesRoom", v2Start);
  const v2Materialization = backend.slice(v2Start, v2End);

  assert.equal(rollout.APP_CHECK_ENFORCEMENT.matchAchievementShowcase, true);
  assert.match(callable, /callableOptions\("matchAchievementShowcase"\)/);
  assert.match(callable, /return await ensureMatchAchievementShowcases\(context\)/);
  assert.match(backend, /strategyActive\/\$\{room\.hostUid\}/);
  assert.match(backend, /strategyActive\/\$\{room\.guestUid\}/);
  assert.match(backend, /soloMatchPermitsV2\/\$\{roomId\}/);
  assert.match(backend, /readMatchAchievementShowcasesBestEffort/);
  assert.match(backend, /revalidateMatchAchievementContext\(context\)/);
  assert.match(backend, /strategyAchievementShowcaseRevealReady\(room, participantUids\)/);
  assert.ok(
    v2Materialization.indexOf("resources.room = {")
      < v2Materialization.indexOf("await realtime.ref(\"online\").update({"),
  );
  assert.match(backend, /function soloHostedRoomPayload\(permit, achievementShowcases = null\)/);
  assert.match(backend, /achievementProfileRef\(participantUid\)\.get\(\)/);
  assert.equal(rules.rooms.$roomId.achievementShowcases[".write"], false);
  assert.equal(rules.strategyRooms.$roomId.achievementShowcases[".write"], false);
  assert.equal(rules.rooms.$roomId.achievementShowcases[".read"], undefined);
  assert.equal(rules.strategyRooms.$roomId.achievementShowcases[".read"], undefined);
  assert.match(rules.rooms.$roomId[".read"], /hostUid[\s\S]*guestUid/);
  assert.match(rules.strategyRooms.$roomId[".read"], /hostUid[\s\S]*guestUid/);
});
