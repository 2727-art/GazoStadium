"use strict";

const TEAM_DUO_PROTOCOL_VERSION = 2;
const TEAM_DUO_VARIANT = "oshi_jouzu_duo";
const TEAM_ELIGIBILITY_VERSION = 1;
const TEAM_ELIGIBILITY_TTL_MS = 24 * 60 * 60 * 1000;
const TEAM_OSHI_JOUZU_ROLE = "oshi_jouzu";
const TEAM_CHALLENGER_ROLE = "challenger";
const TEAM_ELIGIBILITY_MINIMUM_RATING = 1200;
const TEAM_ELIGIBILITY_MINIMUM_MATCHES = 10;
const TEAM_ELIGIBILITY_AWARD_TIERS = Object.freeze([
  "weekly_top10",
  "weekly_top3",
  "weekly_champion",
  "monthly_top10",
  "monthly_top3",
  "monthly_champion",
]);
const TEAM_BEYOND_AWARD_TIERS = new Set([
  "weekly_champion",
  "monthly_top3",
  "monthly_champion",
]);
const TEAM_BATTLE_SIGNAL_KEYS = Object.freeze({
  OSHI_JOUZU_DEFENSE: "teamOshiJozuDefense",
  OSHI_JOUZU_CLEAN_DEFENSE: "teamOshiJozuCleanDefense",
  DUO_BREAKTHROUGH: "teamDuoBreakthrough",
  DUO_CLEAN_BREAKTHROUGH: "teamDuoCleanBreakthrough",
});

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedInteger(value, minimum, maximum, fallback = minimum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function memberIds(value) {
  return Object.entries(objectValue(value))
    .filter(([, present]) => present === true)
    .map(([uid]) => uid)
    .sort();
}

function sameIds(first, second) {
  return first.length === second.length
    && first.every((value, index) => value === second[index]);
}

function isTeamDuoChallengeRoom(room) {
  return Number(room?.protocolVersion) === TEAM_DUO_PROTOCOL_VERSION
    && room?.variant === TEAM_DUO_VARIANT;
}

function teamDuoChallengeRoles(room) {
  if (!isTeamDuoChallengeRoom(room)) {
    throw new TypeError("Unsupported team challenge protocol");
  }
  const members = memberIds(room?.members);
  if (members.length !== 3) throw new TypeError("Team challenge requires exactly three members");
  const players = objectValue(room?.players);
  if (!sameIds(members, Object.keys(players).sort())) {
    throw new TypeError("Team challenge players do not match members");
  }
  const oshiJozuUids = [];
  const challengerUids = [];
  const challengerSlots = new Set();
  for (const uid of members) {
    if (players[uid]?.uid !== uid) throw new TypeError("Team challenge player UID mismatch");
    const role = players[uid]?.role;
    const team = players[uid]?.team;
    const slot = Number(players[uid]?.slot);
    if (role === TEAM_OSHI_JOUZU_ROLE) {
      if (team !== "A" || slot !== 1) throw new TypeError("推し上手 must occupy team A slot 1");
      oshiJozuUids.push(uid);
    } else if (role === TEAM_CHALLENGER_ROLE) {
      if (team !== "B" || ![1, 2].includes(slot) || challengerSlots.has(slot)) {
        throw new TypeError("Challengers must occupy distinct team B slots");
      }
      challengerSlots.add(slot);
      challengerUids.push(uid);
    } else {
      throw new TypeError("Invalid team challenge role");
    }
  }
  if (oshiJozuUids.length !== 1 || challengerUids.length !== 2) {
    throw new TypeError("Team challenge roles must be one versus two");
  }
  challengerUids.sort((first, second) => Number(players[first].slot) - Number(players[second].slot));
  const roster = objectValue(room?.roster);
  if (room?.hostUid !== oshiJozuUids[0]
      || roster.soloUid !== oshiJozuUids[0]
      || roster.challenger1Uid !== challengerUids[0]
      || roster.challenger2Uid !== challengerUids[1]) {
    throw new TypeError("Team challenge roster does not match roles");
  }
  return {
    members,
    oshiJozuUid: oshiJozuUids[0],
    challengerUids,
  };
}

function scoreValuesFor(room, scorerUid) {
  const scoreEntry = objectValue(room?.rounds?.[1]?.scores?.[scorerUid]);
  const values = objectValue(scoreEntry.values);
  return values;
}

function validatedScores(values, expectedTargetUids) {
  const targetUids = Object.keys(values).sort();
  if (!sameIds(targetUids, expectedTargetUids.slice().sort())) {
    throw new TypeError("Team challenge score targets are incomplete");
  }
  return Object.fromEntries(expectedTargetUids.map((targetUid) => {
    const score = Number(values[targetUid]);
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      throw new TypeError("Team challenge scores must be integers from 1 to 10");
    }
    return [targetUid, score];
  }));
}

function teamDuoBattleSignals(result) {
  const signalsByUid = Object.fromEntries(result.members.map((uid) => [uid, {}]));
  if (result.winnerRole === TEAM_OSHI_JOUZU_ROLE) {
    signalsByUid[result.oshiJozuUid][TEAM_BATTLE_SIGNAL_KEYS.OSHI_JOUZU_DEFENSE] = true;
    if (result.clean) {
      signalsByUid[result.oshiJozuUid][TEAM_BATTLE_SIGNAL_KEYS.OSHI_JOUZU_CLEAN_DEFENSE] = true;
    }
  } else if (result.winnerRole === TEAM_CHALLENGER_ROLE) {
    for (const uid of result.challengerUids) {
      signalsByUid[uid][TEAM_BATTLE_SIGNAL_KEYS.DUO_BREAKTHROUGH] = true;
      if (result.clean) {
        signalsByUid[uid][TEAM_BATTLE_SIGNAL_KEYS.DUO_CLEAN_BREAKTHROUGH] = true;
      }
    }
  }
  return signalsByUid;
}

function deriveTeamDuoChallengeResult(room) {
  const roles = teamDuoChallengeRoles(room);
  const scorerUids = Object.keys(objectValue(room?.rounds?.[1]?.scores)).sort();
  if (!sameIds(scorerUids, roles.members)) {
    throw new TypeError("Team challenge requires exactly three score submissions");
  }
  const soloVotes = Object.fromEntries(roles.challengerUids.map((challengerUid) => {
    const values = validatedScores(scoreValuesFor(room, challengerUid), [roles.oshiJozuUid]);
    return [challengerUid, values[roles.oshiJozuUid]];
  }));
  const duoVotes = validatedScores(scoreValuesFor(room, roles.oshiJozuUid), roles.challengerUids);
  const soloScore = Object.values(soloVotes).reduce((sum, score) => sum + score, 0) / 2;
  const duoScore = Object.values(duoVotes).reduce((sum, score) => sum + score, 0) / 2;
  const scoreDifference = Math.abs(soloScore - duoScore);
  const winnerRole = soloScore > duoScore
    ? TEAM_OSHI_JOUZU_ROLE
    : duoScore > soloScore
      ? TEAM_CHALLENGER_ROLE
      : "draw";
  const outcomes = Object.fromEntries(roles.members.map((uid) => {
    if (winnerRole === "draw") return [uid, "draw"];
    const won = uid === roles.oshiJozuUid
      ? winnerRole === TEAM_OSHI_JOUZU_ROLE
      : winnerRole === TEAM_CHALLENGER_ROLE;
    return [uid, won ? "win" : "loss"];
  }));
  const result = {
    version: 1,
    ...roles,
    soloVotes,
    duoVotes,
    soloScore,
    duoScore,
    scoreDifference,
    clean: scoreDifference >= 2,
    winnerRole,
    outcomes,
  };
  result.signalsByUid = teamDuoBattleSignals(result);
  return result;
}

function strongestQualifyingAwardTier(awards) {
  const available = new Set(
    (Array.isArray(awards) ? awards : [])
      .map((award) => String(award?.tier || ""))
      .filter((tier) => TEAM_ELIGIBILITY_AWARD_TIERS.includes(tier)),
  );
  return TEAM_ELIGIBILITY_AWARD_TIERS
    .slice()
    .reverse()
    .find((tier) => available.has(tier)) || "";
}

function evaluateTeamEligibility(profileValue, awardsValue) {
  const profile = objectValue(profileValue);
  const rating = boundedInteger(profile.rating, 100, 3000, 1000);
  const serverMatches = boundedInteger(profile.serverMatches, 0, 100_000, 0);
  const awardTier = strongestQualifyingAwardTier(awardsValue);
  const qualifiedByRating = rating >= TEAM_ELIGIBILITY_MINIMUM_RATING
    && serverMatches >= TEAM_ELIGIBILITY_MINIMUM_MATCHES;
  const qualifiedByAward = Boolean(awardTier);
  const qualifiedForBeyond = (Array.isArray(awardsValue) ? awardsValue : [])
    .some((award) => TEAM_BEYOND_AWARD_TIERS.has(String(award?.tier || "")));
  const eligible = qualifiedByRating || qualifiedByAward;
  return {
    eligible,
    tier: eligible && qualifiedForBeyond
      ? "beyond"
      : eligible
        ? "oshi_jouzu"
        : "none",
    rating,
    serverMatches,
    reason: qualifiedByRating && qualifiedByAward
      ? "rating_and_award"
      : qualifiedByRating
        ? "rating"
        : qualifiedByAward
          ? "award"
          : "not_eligible",
  };
}

function createTeamEligibilityMirror(uid, profile, awards, now = Date.now()) {
  const issuedAt = Number(now);
  if (!uid || !Number.isFinite(issuedAt) || issuedAt <= 0) {
    throw new TypeError("Eligibility mirror identity and timestamp are required");
  }
  return {
    uid: String(uid),
    version: TEAM_ELIGIBILITY_VERSION,
    ...evaluateTeamEligibility(profile, awards),
    issuedAt,
    expiresAt: issuedAt + TEAM_ELIGIBILITY_TTL_MS,
  };
}

function sameTeamEligibility(firstValue, secondValue) {
  const first = objectValue(firstValue);
  const second = objectValue(secondValue);
  return [
    "uid",
    "version",
    "eligible",
    "tier",
    "rating",
    "serverMatches",
    "reason",
    "issuedAt",
    "expiresAt",
  ].every((key) => first[key] === second[key]);
}

function validateTeamEligibilityForRoom(room, mirrorValue, now = Date.now()) {
  const { oshiJozuUid } = teamDuoChallengeRoles(room);
  const snapshot = objectValue(room?.eligibilitySnapshot);
  const mirror = objectValue(mirrorValue);
  if (snapshot.uid !== oshiJozuUid
      || snapshot.version !== TEAM_ELIGIBILITY_VERSION
      || snapshot.eligible !== true
      || !sameTeamEligibility(snapshot, mirror)) {
    throw new TypeError("Team challenge eligibility snapshot does not match");
  }
  const timestamp = Number(now);
  const roomCreatedAt = Number(room?.createdAt);
  if (!Number.isFinite(timestamp)
      || !Number.isFinite(roomCreatedAt)
      || !Number.isFinite(Number(snapshot.issuedAt))
      || !Number.isFinite(Number(snapshot.expiresAt))
      || Number(snapshot.issuedAt) > roomCreatedAt
      || roomCreatedAt < Number(snapshot.issuedAt)
      || roomCreatedAt >= Number(snapshot.expiresAt)
      || roomCreatedAt > timestamp) {
    throw new TypeError("Team challenge eligibility has expired");
  }
  return snapshot;
}

module.exports = Object.freeze({
  TEAM_BATTLE_SIGNAL_KEYS,
  TEAM_CHALLENGER_ROLE,
  TEAM_DUO_PROTOCOL_VERSION,
  TEAM_DUO_VARIANT,
  TEAM_ELIGIBILITY_AWARD_TIERS,
  TEAM_ELIGIBILITY_MINIMUM_MATCHES,
  TEAM_ELIGIBILITY_MINIMUM_RATING,
  TEAM_ELIGIBILITY_TTL_MS,
  TEAM_ELIGIBILITY_VERSION,
  TEAM_OSHI_JOUZU_ROLE,
  createTeamEligibilityMirror,
  deriveTeamDuoChallengeResult,
  evaluateTeamEligibility,
  isTeamDuoChallengeRoom,
  sameTeamEligibility,
  teamDuoBattleSignals,
  teamDuoChallengeRoles,
  validateTeamEligibilityForRoom,
});
