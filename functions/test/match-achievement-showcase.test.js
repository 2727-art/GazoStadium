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

test("room snapshots contain capped achievements and only the public Danwaku day projection", () => {
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
  ], 12_345, [
    {
      days: 7,
      noteTitle: "private title",
      noteBody: "private promise",
      uid: hostUid,
    },
    { days: 365 },
  ]);

  assert.deepEqual(snapshot, {
    version: 1,
    capturedAt: 12_345,
    players: {
      [hostUid]: {
        ids: "battle_total_1,battle_solo_1,battle_strategy_1",
        danwakuDays: 7,
      },
      [guestUid]: {
        ids: "battle_total_10",
        danwakuDays: 365,
      },
    },
  });
  assert.deepEqual(Object.keys(snapshot.players[hostUid]).sort(), ["danwakuDays", "ids"]);
  assert.doesNotMatch(
    JSON.stringify(snapshot.players[hostUid]),
    /private title|private promise|host-user/,
  );
  assert.deepEqual(
    normalizeMatchAchievementShowcases(snapshot, [hostUid, guestUid]),
    snapshot,
  );
});

test("Danwaku day projection has bounded build inputs and remains optional", () => {
  const omitted = buildMatchAchievementShowcases(
    [hostUid, guestUid],
    [null, null],
    12_345,
  );
  assert.deepEqual(omitted.players, {
    [hostUid]: { ids: "" },
    [guestUid]: { ids: "" },
  });

  const bounded = buildMatchAchievementShowcases(
    [hostUid, guestUid],
    [null, null],
    12_345,
    [{ days: 1 }, { days: 1_000_000 }],
  );
  assert.equal(bounded.players[hostUid].danwakuDays, 1);
  assert.equal(bounded.players[guestUid].danwakuDays, 1_000_000);

  for (const invalidDays of [0, -1, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = buildMatchAchievementShowcases(
      [hostUid, guestUid],
      [null, null],
      12_345,
      [{ days: invalidDays }, null],
    );
    assert.equal("danwakuDays" in invalid.players[hostUid], false, String(invalidDays));
  }
  assert.throws(
    () => buildMatchAchievementShowcases([hostUid, guestUid], [null, null], 12_345, [{}]),
    TypeError,
  );
  assert.throws(
    () => buildMatchAchievementShowcases([hostUid, guestUid], [null, null], 12_345, {}),
    TypeError,
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

test("snapshot validation strictly accepts only canonical optional Danwaku days", () => {
  const valid = buildMatchAchievementShowcases(
    [hostUid, guestUid],
    [null, null],
    12_345,
    [{ days: 1 }, { days: 1_000_000 }],
  );
  assert.deepEqual(normalizeMatchAchievementShowcases(valid, [hostUid, guestUid]), valid);

  for (const invalidDays of [0, -1, 1_000_001, 1.5, "7", null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(normalizeMatchAchievementShowcases({
      ...valid,
      players: {
        ...valid.players,
        [hostUid]: { ids: "", danwakuDays: invalidDays },
      },
    }, [hostUid, guestUid]), null, String(invalidDays));
  }

  for (const privateField of ["noteTitle", "noteBody", "uid"]) {
    assert.equal(normalizeMatchAchievementShowcases({
      ...valid,
      players: {
        ...valid.players,
        [hostUid]: { ...valid.players[hostUid], [privateField]: "must-not-leak" },
      },
    }, [hostUid, guestUid]), null, privateField);
  }
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

test("strategy materialization rejects missing or expired freezes and deletes an expired snapshot", async () => {
  const backend = read("functions/index.js");
  const start = backend.indexOf("async function readFrozenStrategyMatchAchievementShowcases");
  const end = backend.indexOf("async function ensureMatchAchievementShowcases", start);
  assert.ok(start >= 0 && end > start);
  const source = backend.slice(start, end);
  assert.doesNotMatch(source, /readMatchAchievementShowcases\(/);

  class FakeHttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  let snapshotValue = null;
  let deleteCount = 0;
  const load = new Function(
    "strategyMatchAchievementFreezeRef",
    "strategyMatchAchievementFreezeExpired",
    "deleteStrategyMatchAchievementFreezeBestEffort",
    "normalizeStrategyMatchAchievementFreeze",
    "HttpsError",
    `"use strict"; ${source}; return readFrozenStrategyMatchAchievementShowcases;`,
  );
  const readFrozen = load(
    () => ({
      async get() {
        return {
          exists: snapshotValue !== null,
          data: () => snapshotValue,
        };
      },
    }),
    (value) => Number(value?.expiresAt) <= 10_000,
    async () => { deleteCount += 1; },
    () => {
      throw new Error("expired or missing freezes must not be normalized");
    },
    FakeHttpsError,
  );
  const context = { roomId: "-1234567890123456789" };

  await assert.rejects(
    readFrozen(context),
    (error) => error instanceof FakeHttpsError && error.code === "failed-precondition",
  );
  assert.equal(deleteCount, 0);

  snapshotValue = { expiresAt: 10_000 };
  await assert.rejects(
    readFrozen(context),
    (error) => error instanceof FakeHttpsError && error.code === "failed-precondition",
  );
  assert.equal(deleteCount, 1);
});

test("abandoned strategy freezes have a bounded scheduled cleanup", () => {
  const backend = read("functions/index.js");
  assert.match(backend, /const STRATEGY_MATCH_ACHIEVEMENT_FREEZE_CLEANUP_LIMIT = 200;/);
  assert.match(
    backend,
    /async function cleanupExpiredStrategyMatchAchievementFreezes\(now = Date\.now\(\)\)[\s\S]*?collection\("strategyMatchAchievementFreezes"\)[\s\S]*?\.where\("expiresAt", "<=", now\)[\s\S]*?\.limit\(STRATEGY_MATCH_ACHIEVEMENT_FREEZE_CLEANUP_LIMIT\)[\s\S]*?batch\.delete\(documentSnapshot\.ref\)/,
  );
  assert.match(
    backend,
    /exports\.cleanupStrategyMatchAchievementFreezes = onSchedule\(\{[\s\S]*?schedule: "every 6 hours"[\s\S]*?cleanupExpiredStrategyMatchAchievementFreezes\(Date\.now\(\)\)/,
  );
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
  const freezeStart = backend.indexOf("async function freezeStrategyMatchAchievementShowcases");
  const freezeEnd = backend.indexOf("async function ensureMatchAchievementShowcases", freezeStart);
  const freeze = backend.slice(freezeStart, freezeEnd);
  const freezeCreateEnd = backend.indexOf(
    "async function readFrozenStrategyMatchAchievementShowcases",
    freezeStart,
  );
  const freezeCreate = backend.slice(freezeStart, freezeCreateEnd);
  const ensureEnd = backend.indexOf("function soloSessionV2ReunionPermitMatchesRoom", freezeEnd);
  const ensure = backend.slice(freezeEnd, ensureEnd);

  assert.equal(rollout.APP_CHECK_ENFORCEMENT.matchAchievementShowcase, true);
  assert.match(callable, /callableOptions\("matchAchievementShowcase"\)/);
  assert.match(callable, /data\.phase === "freeze"/);
  assert.match(callable, /requireRevealReady: false/);
  assert.match(callable, /return await freezeStrategyMatchAchievementShowcases\(context\)/);
  assert.match(callable, /return await ensureMatchAchievementShowcases\(context\)/);
  assert.match(backend, /strategyActive\/\$\{room\.hostUid\}/);
  assert.match(backend, /strategyActive\/\$\{room\.guestUid\}/);
  assert.match(backend, /soloMatchPermitsV2\/\$\{roomId\}/);
  assert.match(backend, /readMatchAchievementShowcasesBestEffort/);
  assert.match(backend, /revalidateMatchAchievementContext\(context\)/);
  assert.match(backend, /strategyAchievementShowcaseRevealReady\(room, participantUids\)/);
  assert.match(backend, /!requireRevealReady[\s\S]*?strategyAchievementShowcaseRevealReady\(room, participantUids\)/);
  assert.ok(
    v2Materialization.indexOf("resources.room = {")
      < v2Materialization.indexOf("await realtime.ref(\"online\").update({"),
  );
  assert.match(backend, /function soloHostedRoomPayload\(permit, achievementShowcases = null\)/);
  assert.match(backend, /achievementProfileRef\(participantUid\)\.get\(\)/);
  assert.match(backend, /danwakuMatchBadgeRef\(participantUid\)\.get\(\)/);
  assert.match(backend, /danwakuBadgeSnapshots\.map\(\(snapshot\) => snapshot\.data\(\)\)/);
  assert.match(backend, /collection\("strategyMatchAchievementFreezes"\)\.doc\(roomId\)/);
  assert.match(freeze, /achievementShowcases = await readMatchAchievementShowcases\(/);
  assert.match(freeze, /expiresAt: capturedAt \+ STRATEGY_MATCH_ACHIEVEMENT_FREEZE_TTL_MS|const expiresAt = capturedAt \+ STRATEGY_MATCH_ACHIEVEMENT_FREEZE_TTL_MS/);
  assert.match(freeze, /deleteAt: Timestamp\.fromMillis\(expiresAt\)/);
  assert.match(freeze, /return \{ outcome: transactionState === "created" \? "frozen" : "already-frozen" \}/);
  assert.doesNotMatch(freezeCreate, /return achievementShowcases/);
  assert.match(freeze, /strategyMatchAchievementFreezeExpired\(stored\)[\s\S]*?deleteStrategyMatchAchievementFreezeBestEffort\(context\.roomId\)[\s\S]*?throw new HttpsError\("failed-precondition"/);
  assert.match(ensure, /context\.mode === "strategy"[\s\S]*?readFrozenStrategyMatchAchievementShowcases\(context\)[\s\S]*?: await readMatchAchievementShowcases\(context\.participantUids\)/);
  assert.match(ensure, /if \(finalValue\)[\s\S]*?deleteStrategyMatchAchievementFreezeBestEffort\(context\.roomId\)/);
  assert.equal(rules.rooms.$roomId.achievementShowcases[".write"], false);
  assert.equal(rules.strategyRooms.$roomId.achievementShowcases[".write"], false);
  assert.equal(rules.rooms.$roomId.achievementShowcases[".read"], undefined);
  assert.equal(rules.strategyRooms.$roomId.achievementShowcases[".read"], undefined);
  assert.match(rules.rooms.$roomId[".read"], /hostUid[\s\S]*guestUid/);
  assert.match(rules.strategyRooms.$roomId[".read"], /hostUid[\s\S]*guestUid/);
});
