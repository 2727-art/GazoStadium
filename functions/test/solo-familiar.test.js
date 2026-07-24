const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SOLO_FAMILIAR_REUNION_COOLDOWN_MS,
  canReactivateSoloFamiliarPair,
  publicSoloFamiliarBlockEntry,
  publicSoloFamiliarBookEntry,
  selectSoloServerMatch,
  soloFamiliarEntryId,
  soloFamiliarPairId,
  soloFamiliarRolloutFlags,
  soloQueuePreferenceTier,
} = require("../solo-familiar");

function queueEntry(uid, now, overrides = {}) {
  return {
    uid,
    name: uid.slice(0, 16),
    pursuitLine: "いい勝負にしましょう",
    streak: 0,
    rating: 1000,
    ratingPreference: "both",
    allowPreferenceMismatch: false,
    reunionPreference: false,
    sampleCount: 0,
    startingHp: 30,
    state: "waiting",
    joinedAt: now,
    lastSeen: now,
    ...overrides,
  };
}

test("rollout fails closed and reunion also requires server authority", () => {
  assert.deepEqual(soloFamiliarRolloutFlags("unknown", true), {
    stage: "engawa_only",
    familiarBookEnabled: false,
    reunionEnabled: false,
  });
  assert.deepEqual(soloFamiliarRolloutFlags("reunion", false), {
    stage: "familiar_book",
    familiarBookEnabled: true,
    reunionEnabled: false,
  });
  assert.equal(soloFamiliarRolloutFlags("reunion", true).reunionEnabled, true);
});

test("pair ids are stable, order independent, and opaque", () => {
  const first = soloFamiliarPairId("uid-a", "uid-b");
  assert.equal(first, soloFamiliarPairId("uid-b", "uid-a"));
  assert.match(first, /^[a-f0-9]{40}$/);
  assert.doesNotMatch(first, /uid/);
});

test("client-visible entry ids come from random bytes instead of participant ids", () => {
  const first = soloFamiliarEntryId(() => Buffer.alloc(20, 0x11));
  const second = soloFamiliarEntryId(() => Buffer.alloc(20, 0x22));
  assert.equal(first, "11".repeat(20));
  assert.equal(second, "22".repeat(20));
  assert.notEqual(first, second);
  assert.throws(() => soloFamiliarEntryId(() => Buffer.alloc(19)));
});

test("old mutual intents cannot restore a removed relationship", () => {
  assert.equal(canReactivateSoloFamiliarPair({ endedAt: 200 }, 100, 300), false);
  assert.equal(canReactivateSoloFamiliarPair({ endedAt: 200 }, 201, 300), true);
});

test("public book and block entries never expose internal identifiers", () => {
  const book = publicSoloFamiliarBookEntry("a".repeat(40), {
    ownerUid: "owner",
    counterpartUid: "secret-opponent",
    pairId: "secret-pair",
    roomId: "secret-room",
    displayName: "  PLAYER  ",
    createdAt: 123,
    active: true,
  }, "owner");
  const block = publicSoloFamiliarBlockEntry("b".repeat(40), {
    ownerUid: "owner",
    targetUid: "secret-opponent",
    displayName: "BLOCKED",
  }, "owner");
  assert.deepEqual(book, { id: "a".repeat(40), name: "PLAYER", createdAt: 123 });
  assert.deepEqual(block, { id: "b".repeat(40), name: "BLOCKED" });
  assert.doesNotMatch(JSON.stringify({ book, block }), /secret/);
});

test("server matching keeps the existing preference compatibility", () => {
  assert.equal(soloQueuePreferenceTier(
    { ratingPreference: "illustration", allowPreferenceMismatch: false },
    { ratingPreference: "live_action", allowPreferenceMismatch: false },
  ), Number.POSITIVE_INFINITY);
  assert.equal(soloQueuePreferenceTier(
    { ratingPreference: "illustration", allowPreferenceMismatch: true },
    { ratingPreference: "live_action", allowPreferenceMismatch: true },
  ), 2);
});

test("an eligible familiar pair is preferred without splitting the queue", () => {
  const now = 2_000_000_000_000;
  const queue = {
    stranger: queueEntry("stranger", now, {
      joinedAt: now - 30_000,
      ratingPreference: "both",
      reunionPreference: true,
    }),
    familiarA: queueEntry("familiarA", now, {
      joinedAt: now - 20_000,
      ratingPreference: "illustration",
      reunionPreference: true,
    }),
    familiarB: queueEntry("familiarB", now, {
      joinedAt: now - 10_000,
      ratingPreference: "illustration",
      reunionPreference: true,
    }),
  };
  const pairId = soloFamiliarPairId("familiarA", "familiarB");
  const match = selectSoloServerMatch({
    requesterUid: "familiarA",
    queue,
    active: {},
    familiarPairs: [{
      id: pairId,
      data: {
        participants: ["familiarA", "familiarB"],
        active: true,
        lastReunionPriorityAt: now - SOLO_FAMILIAR_REUNION_COOLDOWN_MS - 1,
      },
    }],
    blockedPairIds: [],
    now,
  });
  assert.equal(match.reunion, true);
  assert.equal(match.host.uid, "familiarA");
  assert.equal(match.candidate.uid, "familiarB");
});

test("block, cooldown, stale entries, and opt-out all fall back immediately", () => {
  const now = 2_000_000_000_000;
  const queue = {
    first: queueEntry("first", now, {
      joinedAt: now - 20_000,
      ratingPreference: "both",
      reunionPreference: true,
    }),
    second: queueEntry("second", now, {
      joinedAt: now - 10_000,
      ratingPreference: "both",
      reunionPreference: false,
    }),
  };
  const pairId = soloFamiliarPairId("first", "second");
  const familiarPairs = [{
    id: pairId,
    data: {
      participants: ["first", "second"],
      active: true,
      lastReunionPriorityAt: now,
    },
  }];
  const normal = selectSoloServerMatch({
    requesterUid: "first",
    queue,
    active: {},
    familiarPairs,
    blockedPairIds: [],
    now,
  });
  assert.equal(normal.reunion, false);
  assert.equal(normal.host.uid, "first");
  assert.equal(selectSoloServerMatch({
    requesterUid: "first",
    queue,
    active: {},
    familiarPairs,
    blockedPairIds: [pairId],
    now,
  }), null);
  assert.equal(selectSoloServerMatch({
    requesterUid: "first",
    queue: { ...queue, second: { ...queue.second, lastSeen: now - 60_000 } },
    active: {},
    familiarPairs,
    blockedPairIds: [],
    now,
  }), null);
});

test("one stale or malicious queue entry cannot hold unrelated callers", () => {
  const now = 2_000_000_000_000;
  const queue = {
    attacker: queueEntry("attacker", now, {
      joinedAt: -1e15,
      lastSeen: now + (60 * 60 * 1000),
      ratingPreference: "both",
    }),
    caller: queueEntry("caller", now, {
      joinedAt: now - 5_000,
      ratingPreference: "both",
    }),
    candidate: queueEntry("candidate", now, {
      joinedAt: now - 4_000,
      ratingPreference: "both",
    }),
  };
  const match = selectSoloServerMatch({
    requesterUid: "caller",
    queue,
    active: {},
    familiarPairs: [],
    blockedPairIds: [],
    now,
  });
  assert.equal(match.host.uid, "caller");
  assert.equal(match.candidate.uid, "candidate");
});

test("server matching only selects a pair involving the authenticated requester", () => {
  const now = 2_000_000_000_000;
  const queue = Object.fromEntries(["a", "b", "c"].map((uid, index) => [uid, queueEntry(uid, now, {
    joinedAt: now - ((3 - index) * 1_000),
    ratingPreference: "both",
  })]));
  const match = selectSoloServerMatch({
    requesterUid: "c",
    queue,
    active: {},
    familiarPairs: [],
    blockedPairIds: [],
    now,
  });
  assert.equal(match.host.uid, "c");
  assert.ok(["a", "b"].includes(match.candidate.uid));
});

test("server matching skips users reserved by another permit", () => {
  const now = 2_000_000_000_000;
  const queue = Object.fromEntries(["caller", "reserved", "available"].map((uid, index) => [uid, queueEntry(uid, now, {
    joinedAt: now - ((3 - index) * 1_000),
    ratingPreference: "both",
  })]));
  const match = selectSoloServerMatch({
    requesterUid: "caller",
    queue,
    active: {},
    familiarPairs: [],
    blockedPairIds: [],
    excludedUids: ["reserved"],
    now,
  });
  assert.equal(match.candidate.uid, "available");
});

test("server matching skips a malformed priority candidate and uses the next valid one", () => {
  const now = 2_000_000_000_000;
  const match = selectSoloServerMatch({
    requesterUid: "caller",
    queue: {
      caller: queueEntry("caller", now, { joinedAt: now - 3_000 }),
      malformed: queueEntry("malformed", now, {
        joinedAt: now - 2_000,
        pursuitLine: "   ",
      }),
      valid: queueEntry("valid", now, { joinedAt: now - 1_000 }),
    },
    active: {},
    familiarPairs: [],
    blockedPairIds: [],
    now,
  });
  assert.equal(match.candidate.uid, "valid");
});
