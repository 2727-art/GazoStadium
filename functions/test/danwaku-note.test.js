"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DANWAKU_ACTIVE_NOTE_LIMIT,
  DANWAKU_ARCHIVED_NOTE_LIMIT,
  DANWAKU_RANKING_READ_LIMIT,
  DanwakuNoteError,
  continueDanwakuNote,
  createDanwakuOpaqueId,
  danwakuDayKey,
  danwakuMatchBadge,
  danwakuPublicEntry,
  deterministicDanwakuId,
  emptyDanwakuNote,
  emptyDanwakuProfile,
  nextDanwakuBoundaryAt,
  normalizeDanwakuActionData,
  rankDanwakuPublicEntries,
  resetDanwakuNote,
} = require("../danwaku-note");

const noteId = deterministicDanwakuId("note", "test-user", "operation-create-0001");
const at = (iso) => Date.parse(iso);

function profile(timestamp) {
  return emptyDanwakuProfile(timestamp);
}

function note(timestamp, overrides = {}) {
  return {
    ...emptyDanwakuNote({
      noteId,
      title: "夜のお菓子",
      commitment: "夜9時以降は食べない",
      timestamp,
    }),
    ...overrides,
  };
}

test("JST day changes at 04:00 and nextBoundaryAt is always the following boundary", () => {
  const before = at("2026-08-05T03:59:59.999+09:00");
  const boundary = at("2026-08-05T04:00:00.000+09:00");
  assert.equal(danwakuDayKey(before), "2026-08-04");
  assert.equal(danwakuDayKey(boundary), "2026-08-05");
  assert.equal(nextDanwakuBoundaryAt(before), boundary);
  assert.equal(
    nextDanwakuBoundaryAt(boundary),
    at("2026-08-06T04:00:00.000+09:00"),
  );
});

test("action contract is strict, bounded, and never accepts a client ranking name", () => {
  const valid = normalizeDanwakuActionData({
    action: "set_public",
    operationId: "operation-public-0001",
    noteId,
    rankingVisible: true,
    matchVisible: true,
    shareTitle: false,
  });
  assert.deepEqual(valid, {
    action: "set_public",
    operationId: "operation-public-0001",
    noteId,
    rankingVisible: true,
    matchVisible: true,
    shareTitle: false,
  });
  assert.throws(() => normalizeDanwakuActionData({
    ...valid,
    displayName: "偽名",
  }), (error) => error instanceof DanwakuNoteError && error.code === "invalid-argument");
  assert.deepEqual(normalizeDanwakuActionData({ action: "ranking" }), { action: "ranking" });
  assert.throws(() => normalizeDanwakuActionData({ action: "ranking", limit: 5 }), DanwakuNoteError);

  const thirtyEmoji = "🍜".repeat(30);
  assert.equal(normalizeDanwakuActionData({
    action: "create",
    operationId: "operation-create-0002",
    title: thirtyEmoji,
    commitment: "a".repeat(100),
  }).title, thirtyEmoji);
  assert.throws(() => normalizeDanwakuActionData({
    action: "create",
    operationId: "operation-create-0003",
    title: "🍜".repeat(31),
  }), DanwakuNoteError);
  assert.throws(() => normalizeDanwakuActionData({
    action: "create",
    operationId: "operation-create-0004",
    title: "正常\n改行",
  }), DanwakuNoteError);
});

test("continuation counts once per Danwaku day and an omitted day does not reset the run", () => {
  const firstAt = at("2026-08-01T12:00:00+09:00");
  const first = continueDanwakuNote(note(firstAt), profile(firstAt), firstAt);
  assert.equal(first.outcome, "recorded");
  assert.equal(first.note.currentDays, 1);
  assert.equal(first.note.totalContinuedDays, 1);

  const duplicate = continueDanwakuNote(
    first.note,
    first.profile,
    at("2026-08-02T03:59:59+09:00"),
  );
  assert.equal(duplicate.outcome, "already-recorded");
  assert.equal(duplicate.changed, false);

  const afterGap = continueDanwakuNote(
    first.note,
    first.profile,
    at("2026-08-04T12:00:00+09:00"),
  );
  assert.equal(afterGap.note.currentDays, 2);
  assert.equal(afterGap.note.totalContinuedDays, 2);
});

test("only reset returns days to zero and blocks a continuation for the same day", () => {
  const timestamp = at("2026-08-01T12:00:00+09:00");
  const first = continueDanwakuNote(note(timestamp), profile(timestamp), timestamp);
  const resetAt = at("2026-08-02T12:00:00+09:00");
  const reset = resetDanwakuNote(first.note, first.profile, resetAt);
  assert.equal(reset.outcome, "reset");
  assert.equal(reset.note.currentDays, 0);
  assert.equal(reset.note.bestDays, 1);
  assert.equal(reset.note.totalContinuedDays, 1);
  assert.equal(reset.note.resetCount, 1);

  const blocked = continueDanwakuNote(
    reset.note,
    reset.profile,
    at("2026-08-03T03:59:59+09:00"),
  );
  assert.equal(blocked.outcome, "reset-today");
  assert.equal(blocked.note.currentDays, 0);

  const nextDay = continueDanwakuNote(
    reset.note,
    reset.profile,
    at("2026-08-03T04:00:00+09:00"),
  );
  assert.equal(nextDay.outcome, "recorded");
  assert.equal(nextDay.note.currentDays, 1);

  const zeroReset = resetDanwakuNote(
    note(timestamp),
    profile(timestamp),
    timestamp,
  );
  assert.equal(zeroReset.changed, false);
  assert.equal(zeroReset.outcome, "already-zero");
  assert.equal(
    continueDanwakuNote(zeroReset.note, zeroReset.profile, timestamp).outcome,
    "recorded",
  );
});

test("public projections are minimal and ranking rows never reveal an entry id", () => {
  const timestamp = at("2026-08-05T12:00:00+09:00");
  const continued = continueDanwakuNote(note(timestamp), profile(timestamp), timestamp);
  const publicEntryId = deterministicDanwakuId("public", "viewer");
  const publicProfile = {
    ...continued.profile,
    publicNoteId: noteId,
    rankingVisible: true,
    matchVisible: true,
    shareTitle: true,
    displayName: "PLAYER",
    publicEntryId,
  };
  assert.deepEqual(danwakuPublicEntry(publicProfile, continued.note, timestamp), {
    days: 1,
    displayName: "PLAYER",
    title: "夜のお菓子",
    expiresAt: timestamp + (7 * 24 * 60 * 60 * 1000),
    lastContinuedDayKey: "2026-08-05",
  });
  assert.deepEqual(danwakuMatchBadge(publicProfile, continued.note), { days: 1 });

  const id = (number) => deterministicDanwakuId("ranking", number);
  const result = rankDanwakuPublicEntries([
    { entryId: id(1), days: 5, displayName: "A", expiresAt: timestamp + 1000, lastContinuedDayKey: "2026-08-05" },
    { entryId: id(2), days: 5, displayName: "B", title: "甘味", expiresAt: timestamp + 1000, lastContinuedDayKey: "2026-08-04" },
    { entryId: id(3), days: 3, displayName: "C", expiresAt: timestamp + 1000, lastContinuedDayKey: "2026-08-05" },
    { entryId: id(4), days: 2, displayName: "D", expiresAt: timestamp, lastContinuedDayKey: "2026-08-05" },
  ], { viewerEntryId: id(3), timestamp });
  assert.deepEqual(result.top.map(({ rank, days }) => ({ rank, days })), [
    { rank: 1, days: 5 },
    { rank: 1, days: 5 },
    { rank: 3, days: 3 },
  ]);
  assert.equal(result.viewerRank, 3);
  assert.equal(result.participantCount, 3);
  assert.equal(result.todayCount, 2);
  assert.equal(result.top.find((row) => row.isViewer).displayName, "C");
  for (const row of [...result.top, ...result.nearby]) {
    assert.equal(Object.hasOwn(row, "entryId"), false);
    assert.equal(Object.hasOwn(row, "uid"), false);
  }
});

test("opaque ids and response/query bounds are fixed", () => {
  const opaque = createDanwakuOpaqueId((size) => Buffer.alloc(size, 7));
  assert.match(opaque, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(DANWAKU_ACTIVE_NOTE_LIMIT, 10);
  assert.equal(DANWAKU_ARCHIVED_NOTE_LIMIT, 100);
  assert.equal(DANWAKU_RANKING_READ_LIMIT, 2000);
});
