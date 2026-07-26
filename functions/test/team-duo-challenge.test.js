"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TEAM_BATTLE_SIGNAL_KEYS,
  TEAM_DUO_VARIANT,
  deriveTeamDuoChallengeResult,
} = require("../team-duo-challenge");

const oshiJozuUid = "oshi";
const challengerUids = ["first", "second"];

function roomWithScores({
  firstToOshi = 8,
  secondToOshi = 8,
  oshiToFirst = 6,
  oshiToSecond = 6,
} = {}) {
  return {
    protocolVersion: 2,
    variant: TEAM_DUO_VARIANT,
    createdAt: 1_800_000_000_000,
    hostUid: oshiJozuUid,
    roster: {
      soloUid: oshiJozuUid,
      challenger1Uid: challengerUids[0],
      challenger2Uid: challengerUids[1],
    },
    members: {
      [oshiJozuUid]: true,
      [challengerUids[0]]: true,
      [challengerUids[1]]: true,
    },
    players: {
      [oshiJozuUid]: {
        uid: oshiJozuUid, role: "oshi_jouzu", team: "A", slot: 1,
      },
      [challengerUids[0]]: {
        uid: challengerUids[0], role: "challenger", team: "B", slot: 1,
      },
      [challengerUids[1]]: {
        uid: challengerUids[1], role: "challenger", team: "B", slot: 2,
      },
    },
    rounds: {
      1: {
        scores: {
          [oshiJozuUid]: {
            values: {
              [challengerUids[0]]: oshiToFirst,
              [challengerUids[1]]: oshiToSecond,
            },
          },
          [challengerUids[0]]: { values: { [oshiJozuUid]: firstToOshi } },
          [challengerUids[1]]: { values: { [oshiJozuUid]: secondToOshi } },
        },
      },
    },
  };
}

test("one-versus-two scores produce a clean 推し上手 defense from the two side averages", () => {
  const result = deriveTeamDuoChallengeResult(roomWithScores({
    firstToOshi: 9,
    secondToOshi: 9,
    oshiToFirst: 6,
    oshiToSecond: 7,
  }));
  assert.equal(result.soloScore, 9);
  assert.equal(result.duoScore, 6.5);
  assert.equal(result.scoreDifference, 2.5);
  assert.equal(result.clean, true);
  assert.equal(result.winnerRole, "oshi_jouzu");
  assert.deepEqual(result.outcomes, {
    first: "loss",
    oshi: "win",
    second: "loss",
  });
  assert.deepEqual(result.signalsByUid.oshi, {
    [TEAM_BATTLE_SIGNAL_KEYS.OSHI_JOUZU_DEFENSE]: true,
    [TEAM_BATTLE_SIGNAL_KEYS.OSHI_JOUZU_CLEAN_DEFENSE]: true,
  });
  assert.deepEqual(result.signalsByUid.first, {});
});

test("both challengers receive the same clean breakthrough signals", () => {
  const result = deriveTeamDuoChallengeResult(roomWithScores({
    firstToOshi: 5,
    secondToOshi: 6,
    oshiToFirst: 8,
    oshiToSecond: 9,
  }));
  assert.equal(result.soloScore, 5.5);
  assert.equal(result.duoScore, 8.5);
  assert.equal(result.winnerRole, "challenger");
  for (const uid of challengerUids) {
    assert.deepEqual(result.signalsByUid[uid], {
      [TEAM_BATTLE_SIGNAL_KEYS.DUO_BREAKTHROUGH]: true,
      [TEAM_BATTLE_SIGNAL_KEYS.DUO_CLEAN_BREAKTHROUGH]: true,
    });
    assert.equal(result.outcomes[uid], "win");
  }
  assert.equal(result.outcomes[oshiJozuUid], "loss");
});

test("an exact average tie is a draw with no battle signals", () => {
  const result = deriveTeamDuoChallengeResult(roomWithScores({
    firstToOshi: 7,
    secondToOshi: 8,
    oshiToFirst: 6,
    oshiToSecond: 9,
  }));
  assert.equal(result.soloScore, 7.5);
  assert.equal(result.duoScore, 7.5);
  assert.equal(result.winnerRole, "draw");
  assert.deepEqual(Object.values(result.outcomes), ["draw", "draw", "draw"]);
  assert.deepEqual(result.signalsByUid, { first: {}, oshi: {}, second: {} });
});

test("the official result rejects missing, extra, out-of-range, and wrong-role scores", () => {
  const missing = roomWithScores();
  delete missing.rounds[1].scores.first;
  assert.throws(() => deriveTeamDuoChallengeResult(missing), /exactly three score submissions/);

  const outsider = roomWithScores();
  outsider.rounds[1].scores.outsider = { values: { [oshiJozuUid]: 10 } };
  assert.throws(() => deriveTeamDuoChallengeResult(outsider), /exactly three score submissions/);

  const extra = roomWithScores();
  extra.rounds[1].scores.first.values.second = 7;
  assert.throws(() => deriveTeamDuoChallengeResult(extra), /targets are incomplete/);

  const outOfRange = roomWithScores({ oshiToFirst: 11 });
  assert.throws(() => deriveTeamDuoChallengeResult(outOfRange), /integers from 1 to 10/);

  const wrongRoles = roomWithScores();
  wrongRoles.players.first.role = "oshi_jouzu";
  assert.throws(() => deriveTeamDuoChallengeResult(wrongRoles), /team A slot 1|one versus two/);

  const duplicateSlots = roomWithScores();
  duplicateSlots.players.second.slot = 1;
  assert.throws(() => deriveTeamDuoChallengeResult(duplicateSlots), /distinct team B slots/);

  const forgedRoster = roomWithScores();
  [forgedRoster.roster.challenger1Uid, forgedRoster.roster.challenger2Uid] = [
    forgedRoster.roster.challenger2Uid,
    forgedRoster.roster.challenger1Uid,
  ];
  assert.throws(() => deriveTeamDuoChallengeResult(forgedRoster), /roster does not match roles/);

  const forgedHost = roomWithScores();
  forgedHost.hostUid = challengerUids[0];
  assert.throws(() => deriveTeamDuoChallengeResult(forgedHost), /roster does not match roles/);
});

test("the 推し上手 role needs no rating, ranking, award, or eligibility metadata", () => {
  const room = roomWithScores();
  room.players[oshiJozuUid].rating = 100;
  room.players[oshiJozuUid].serverMatches = 0;
  room.players[oshiJozuUid].rankingAwards = [];
  assert.equal(room.eligibilitySnapshot, undefined);

  const result = deriveTeamDuoChallengeResult(room);
  assert.equal(result.winnerRole, "oshi_jouzu");
  assert.equal(result.outcomes[oshiJozuUid], "win");
  assert.deepEqual(result.signalsByUid[oshiJozuUid], {
    [TEAM_BATTLE_SIGNAL_KEYS.OSHI_JOUZU_DEFENSE]: true,
    [TEAM_BATTLE_SIGNAL_KEYS.OSHI_JOUZU_CLEAN_DEFENSE]: true,
  });
});
