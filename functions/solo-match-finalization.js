"use strict";

const SOLO_MAX_ROUNDS = 5;
const SOLO_MIN_SCORE = 1;
const SOLO_MAX_SCORE = 10;
const SOLO_MIN_STARTING_HP = 5;
const SOLO_MAX_STARTING_HP = 30;

function objectValue(value) {
  return value && typeof value === "object" ? value : {};
}

function playerStartingHp(room, uid) {
  const startingHp = Number(room?.players?.[uid]?.startingHp);
  if (!Number.isInteger(startingHp)
      || startingHp < SOLO_MIN_STARTING_HP
      || startingHp > SOLO_MAX_STARTING_HP
      || startingHp % 5 !== 0) {
    throw new TypeError("通常型1on1の開始HPが不正です。");
  }
  return startingHp;
}

function roundScore(round, uid) {
  const value = round?.scores?.[uid];
  if (value === undefined || value === null) return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < SOLO_MIN_SCORE || score > SOLO_MAX_SCORE) {
    throw new TypeError("通常型1on1の採点が不正です。");
  }
  return score;
}

function determineSoloWinner(hostUid, guestUid, hp, totals, criticals, perfects) {
  const comparisons = [
    [hp[hostUid], hp[guestUid]],
    [totals[hostUid], totals[guestUid]],
    [criticals[hostUid], criticals[guestUid]],
    [perfects[hostUid], perfects[guestUid]],
  ];
  for (const [hostValue, guestValue] of comparisons) {
    if (hostValue !== guestValue) return hostValue > guestValue ? hostUid : guestUid;
  }
  return null;
}

function deriveSoloMatchResult(roomValue) {
  const room = objectValue(roomValue);
  const hostUid = typeof room.hostUid === "string" ? room.hostUid : "";
  const guestUid = typeof room.guestUid === "string" ? room.guestUid : "";
  if (!hostUid || !guestUid || hostUid === guestUid
      || room.members?.[hostUid] !== true
      || room.members?.[guestUid] !== true) {
    throw new TypeError("通常型1on1の参加者が不正です。");
  }

  const hp = {
    [hostUid]: playerStartingHp(room, hostUid),
    [guestUid]: playerStartingHp(room, guestUid),
  };
  const totals = { [hostUid]: 0, [guestUid]: 0 };
  const criticals = { [hostUid]: 0, [guestUid]: 0 };
  const perfects = { [hostUid]: 0, [guestUid]: 0 };
  const rounds = objectValue(room.rounds);

  for (let roundNumber = 1; roundNumber <= SOLO_MAX_ROUNDS; roundNumber += 1) {
    const round = objectValue(rounds[roundNumber]);
    const hostGivenScore = roundScore(round, hostUid);
    const guestGivenScore = roundScore(round, guestUid);
    if (hostGivenScore === null || guestGivenScore === null) {
      return {
        status: "pending",
        nextRound: roundNumber,
      };
    }

    const hostReceivedScore = guestGivenScore;
    const guestReceivedScore = hostGivenScore;
    totals[hostUid] += hostReceivedScore;
    totals[guestUid] += guestReceivedScore;
    if (hostReceivedScore >= 8) criticals[hostUid] += 1;
    if (guestReceivedScore >= 8) criticals[guestUid] += 1;
    if (hostReceivedScore === 10) perfects[hostUid] += 1;
    if (guestReceivedScore === 10) perfects[guestUid] += 1;

    if (hostReceivedScore > guestReceivedScore) {
      hp[guestUid] = Math.max(0, hp[guestUid] - hostReceivedScore);
    } else if (guestReceivedScore > hostReceivedScore) {
      hp[hostUid] = Math.max(0, hp[hostUid] - guestReceivedScore);
    }

    const lethal = hp[hostUid] <= 0 || hp[guestUid] <= 0;
    if (!lethal && roundNumber < SOLO_MAX_ROUNDS) continue;

    const winnerUid = determineSoloWinner(
      hostUid,
      guestUid,
      hp,
      totals,
      criticals,
      perfects,
    );
    const outcomes = winnerUid
      ? {
          [hostUid]: winnerUid === hostUid ? "win" : "loss",
          [guestUid]: winnerUid === guestUid ? "win" : "loss",
        }
      : {
          [hostUid]: "draw",
          [guestUid]: "draw",
        };
    return {
      status: "final",
      round: roundNumber,
      reason: lethal ? "hp" : winnerUid ? "rounds" : "draw",
      winnerUid,
      outcomes,
      hp,
      totals,
      criticals,
      perfects,
    };
  }

  return {
    status: "pending",
    nextRound: SOLO_MAX_ROUNDS,
  };
}

module.exports = {
  SOLO_MAX_ROUNDS,
  deriveSoloMatchResult,
};
