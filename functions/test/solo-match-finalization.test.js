"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { deriveSoloMatchResult } = require("../solo-match-finalization");

const hostUid = "host-user";
const guestUid = "guest-user";

function room({
  hostHp = 30,
  guestHp = 30,
  rounds = {},
} = {}) {
  return {
    status: "active",
    hostUid,
    guestUid,
    members: {
      [hostUid]: true,
      [guestUid]: true,
    },
    players: {
      [hostUid]: { uid: hostUid, startingHp: hostHp },
      [guestUid]: { uid: guestUid, startingHp: guestHp },
    },
    rounds: Object.fromEntries(Object.entries(rounds).map(([roundNumber, scores]) => [
      roundNumber,
      { scores },
    ])),
  };
}

test("solo result remains pending until both scores exist in every preceding round", () => {
  assert.deepEqual(
    deriveSoloMatchResult(room({
      rounds: {
        1: { [hostUid]: 10 },
        2: { [hostUid]: 10, [guestUid]: 1 },
      },
    })),
    { status: "pending", nextRound: 1 },
  );
});

test("solo result derives an early lethal outcome from starting HP and cumulative damage", () => {
  const result = deriveSoloMatchResult(room({
    guestHp: 15,
    rounds: {
      1: { [hostUid]: 1, [guestUid]: 8 },
      2: { [hostUid]: 2, [guestUid]: 7 },
    },
  }));

  assert.equal(result.status, "final");
  assert.equal(result.round, 2);
  assert.equal(result.reason, "hp");
  assert.equal(result.winnerUid, hostUid);
  assert.equal(result.outcomes[hostUid], "win");
  assert.equal(result.outcomes[guestUid], "loss");
  assert.equal(result.hp[guestUid], 0);
});

test("solo round-five result follows HP, received total, critical, and perfect tie breakers", () => {
  const result = deriveSoloMatchResult(room({
    rounds: {
      1: { [hostUid]: 1, [guestUid]: 8 },
      2: { [hostUid]: 8, [guestUid]: 7 },
      3: { [hostUid]: 8, [guestUid]: 8 },
      4: { [hostUid]: 4, [guestUid]: 4 },
      5: { [hostUid]: 5, [guestUid]: 5 },
    },
  }));

  assert.equal(result.status, "final");
  assert.equal(result.round, 5);
  assert.equal(result.reason, "rounds");
  assert.equal(result.winnerUid, hostUid);
  assert.deepEqual(result.outcomes, {
    [hostUid]: "win",
    [guestUid]: "loss",
  });
});

test("solo round-five exact tie is a draw", () => {
  const result = deriveSoloMatchResult(room({
    rounds: {
      1: { [hostUid]: 6, [guestUid]: 6 },
      2: { [hostUid]: 7, [guestUid]: 7 },
      3: { [hostUid]: 8, [guestUid]: 8 },
      4: { [hostUid]: 9, [guestUid]: 9 },
      5: { [hostUid]: 10, [guestUid]: 10 },
    },
  }));

  assert.equal(result.status, "final");
  assert.equal(result.reason, "draw");
  assert.equal(result.winnerUid, null);
  assert.deepEqual(result.outcomes, {
    [hostUid]: "draw",
    [guestUid]: "draw",
  });
});

test("solo result rejects invalid player HP and scores", () => {
  assert.throws(
    () => deriveSoloMatchResult(room({ hostHp: 29 })),
    /開始HP/,
  );
  assert.throws(
    () => deriveSoloMatchResult(room({
      rounds: {
        1: { [hostUid]: 11, [guestUid]: 1 },
      },
    })),
    /採点/,
  );
});
