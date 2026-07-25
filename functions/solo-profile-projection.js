"use strict";

const INITIAL_RATING = 1000;
const RATING_K_FACTOR = 32;
const MIN_RATING = 100;
const MAX_RATING = 3000;
const PROFILE_NAME_MAX_LENGTH = 16;
const PURSUIT_LINE_MAX_LENGTH = 40;
const RESULT_TOKEN_PATTERN = /^[a-f0-9]{40}$/;
const ROOM_ID_PATTERN = /^[-0-9A-Z_a-z]{20}$/;
const OUTCOMES = Object.freeze(["win", "loss", "draw"]);
const OVERALL_MODES = Object.freeze(["solo", "strategy", "team", "royale"]);
const SERVER_PROJECTION_RECEIPT_LIMIT = 16;

class SoloProfileProjectionConflictError extends Error {
  constructor(resultToken, existingOutcome, requestedOutcome) {
    super("A verified result token already has a different outcome");
    this.name = "SoloProfileProjectionConflictError";
    this.code = "solo-profile-projection/outcome-conflict";
    this.resultToken = resultToken;
    this.existingOutcome = existingOutcome;
    this.requestedOutcome = requestedOutcome;
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonnegativeInteger(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, number);
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function normalizedRating(value, fallback = INITIAL_RATING) {
  const number = Number(value);
  const finite = Number.isFinite(number) ? number : fallback;
  return Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(finite)));
}

function normalizedName(value, fallback = "PLAYER") {
  return String(value || fallback || "PLAYER").trim().slice(0, PROFILE_NAME_MAX_LENGTH) || "PLAYER";
}

function normalizedPursuitLine(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PURSUIT_LINE_MAX_LENGTH);
}

function copiedAppliedResults(value) {
  return { ...objectValue(value) };
}

function serverProjectionReceipts(value) {
  const receipts = [];
  const seen = new Set();
  for (const entry of String(value || "").split(",")) {
    const match = /^([a-f0-9]{40}):(win|loss|draw)$/.exec(entry);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    receipts.push({ resultToken: match[1], outcome: match[2] });
  }
  return receipts.slice(-SERVER_PROJECTION_RECEIPT_LIMIT);
}

function serverProjectionReceiptOutcome(profileValue, resultToken) {
  return serverProjectionReceipts(
    objectValue(profileValue).serverProjectionReceipts,
  ).find((receipt) => receipt.resultToken === resultToken)?.outcome || "";
}

function appendedServerProjectionReceipts(currentValue, event) {
  const receipts = serverProjectionReceipts(
    objectValue(currentValue).serverProjectionReceipts,
  ).filter((receipt) => receipt.resultToken !== event.resultToken);
  receipts.push({
    resultToken: event.resultToken,
    outcome: event.outcome,
  });
  return receipts
    .slice(-SERVER_PROJECTION_RECEIPT_LIMIT)
    .map((receipt) => `${receipt.resultToken}:${receipt.outcome}`)
    .join(",");
}

function validateProjectionEvent(eventValue) {
  const event = objectValue(eventValue);
  const outcome = String(event.outcome || "");
  const resultToken = String(event.resultToken || "");
  const roomId = String(event.roomId || "");
  const updatedAt = Number(event.updatedAt);
  const projectionSequence = event.projectionSequence;
  if (!OUTCOMES.includes(outcome)) throw new TypeError("Invalid solo profile projection outcome");
  if (!RESULT_TOKEN_PATTERN.test(resultToken)) throw new TypeError("Invalid solo profile projection result token");
  if (!ROOM_ID_PATTERN.test(roomId)) throw new TypeError("Invalid solo profile projection room id");
  if (!Number.isFinite(updatedAt) || updatedAt < 0) {
    throw new TypeError("Invalid solo profile projection timestamp");
  }
  if (!positiveSafeInteger(projectionSequence)) {
    throw new TypeError("Invalid solo profile projection sequence");
  }
  return {
    outcome,
    resultToken,
    roomId,
    updatedAt,
    projectionSequence,
    name: normalizedName(event.name),
    pursuitLine: normalizedPursuitLine(event.pursuitLine),
    opponentRating: normalizedRating(event.opponentRating),
  };
}

function existingServerTokenOutcome(currentValue, event) {
  const existingOutcome = serverProjectionReceiptOutcome(
    currentValue,
    event.resultToken,
  );
  if (!existingOutcome) return "";
  if (existingOutcome !== event.outcome) {
    throw new SoloProfileProjectionConflictError(
      event.resultToken,
      existingOutcome,
      event.outcome,
    );
  }
  return existingOutcome;
}

function outcomeScore(outcome) {
  if (outcome === "win") return 1;
  if (outcome === "draw") return 0.5;
  return 0;
}

function calculateSoloProfileRating(currentRating, opponentRating, outcome) {
  if (!OUTCOMES.includes(outcome)) throw new TypeError("Invalid rating outcome");
  const own = normalizedRating(currentRating);
  const opponent = normalizedRating(opponentRating);
  const expectedScore = 1 / (1 + (10 ** ((opponent - own) / 400)));
  return normalizedRating(own + (RATING_K_FACTOR * (outcomeScore(outcome) - expectedScore)));
}

function applyOutcomeCounters(record, outcome) {
  if (outcome === "win") {
    record.wins += 1;
    record.streak += 1;
    record.bestStreak = Math.max(record.bestStreak, record.streak);
  } else if (outcome === "loss") {
    record.losses += 1;
    record.streak = 0;
  } else {
    record.draws += 1;
  }
}

function applyOutcomeCountsOnly(record, outcome) {
  if (outcome === "win") record.wins += 1;
  else if (outcome === "loss") record.losses += 1;
  else record.draws += 1;
}

function projectNormalSoloProfile(currentValue, eventValue) {
  const event = validateProjectionEvent(eventValue);
  const current = objectValue(currentValue);
  if (existingServerTokenOutcome(current, event)) {
    return {
      status: "already-applied",
      profile: currentValue,
    };
  }
  if (positiveSafeInteger(current.serverProjectionSequence) >= event.projectionSequence) {
    return {
      status: "obsolete",
      profile: currentValue,
    };
  }

  const currentUpdatedAt = Number(current.updatedAt);
  const currentIsNewer = Number.isFinite(currentUpdatedAt)
    && currentUpdatedAt > event.updatedAt;
  const pursuitLine = currentIsNewer
    ? normalizedPursuitLine(current.pursuitLine) || event.pursuitLine
    : event.pursuitLine || normalizedPursuitLine(current.pursuitLine);
  const record = {
    name: currentIsNewer
      ? normalizedName(current.name, event.name)
      : event.name,
    wins: nonnegativeInteger(current.wins),
    losses: nonnegativeInteger(current.losses),
    draws: nonnegativeInteger(current.draws),
    streak: nonnegativeInteger(current.streak),
    bestStreak: Math.max(
      nonnegativeInteger(current.bestStreak),
      nonnegativeInteger(current.streak),
    ),
    rating: normalizedRating(current.rating),
    updatedAt: currentIsNewer ? currentUpdatedAt : event.updatedAt,
    lastResultRoomId: currentIsNewer
      ? String(current.lastResultRoomId || "")
      : event.roomId,
    lastResultOutcome: currentIsNewer
      ? String(current.lastResultOutcome || "")
      : event.outcome,
    appliedResults: {
      ...copiedAppliedResults(current.appliedResults),
      [event.resultToken]: event.outcome,
    },
    serverProjectionReceipts: appendedServerProjectionReceipts(current, event),
    serverProjectionSequence: event.projectionSequence,
  };
  if (!record.lastResultRoomId) delete record.lastResultRoomId;
  if (!OUTCOMES.includes(record.lastResultOutcome)) delete record.lastResultOutcome;
  if (pursuitLine) record.pursuitLine = pursuitLine;
  if (currentIsNewer) {
    applyOutcomeCountsOnly(record, event.outcome);
  } else {
    applyOutcomeCounters(record, event.outcome);
    record.rating = calculateSoloProfileRating(
      record.rating,
      event.opponentRating,
      event.outcome,
    );
  }

  return {
    status: "applied",
    profile: record,
  };
}

function emptyModeRecord() {
  return { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 };
}

function normalizeModeRecord(value) {
  const source = objectValue(value);
  const wins = nonnegativeInteger(source.wins);
  const losses = nonnegativeInteger(source.losses);
  const draws = nonnegativeInteger(source.draws);
  return {
    wins,
    losses,
    draws,
    matches: wins + losses + draws,
    points: (wins * 3) + draws,
  };
}

function normalizedOverallModes(value) {
  const source = objectValue(value);
  const hasModes = source.modes && typeof source.modes === "object" && !Array.isArray(source.modes);
  const legacySolo = hasModes ? null : normalizeModeRecord(source);
  return Object.fromEntries(OVERALL_MODES.map((mode) => [
    mode,
    normalizeModeRecord(hasModes ? source.modes?.[mode] : mode === "solo" ? legacySolo : null),
  ]));
}

function overallProfileFromModes(currentValue, event) {
  const current = objectValue(currentValue);
  const currentUpdatedAt = Number(current.updatedAt);
  const currentIsNewer = Number.isFinite(currentUpdatedAt)
    && currentUpdatedAt > event.updatedAt;
  const modes = normalizedOverallModes(current);
  const wins = OVERALL_MODES.reduce((sum, mode) => sum + modes[mode].wins, 0);
  const losses = OVERALL_MODES.reduce((sum, mode) => sum + modes[mode].losses, 0);
  const draws = OVERALL_MODES.reduce((sum, mode) => sum + modes[mode].draws, 0);
  const streak = nonnegativeInteger(current.streak);
  return {
    name: currentIsNewer
      ? normalizedName(current.name, event.name)
      : event.name,
    wins,
    losses,
    draws,
    streak,
    bestStreak: Math.max(streak, nonnegativeInteger(current.bestStreak)),
    rating: normalizedRating(current.rating),
    modes,
    updatedAt: currentIsNewer ? currentUpdatedAt : event.updatedAt,
  };
}

function seedOverallProfileFromProjectedNormal(projectedNormalValue, event) {
  const normal = objectValue(projectedNormalValue);
  const normalOutcome = serverProjectionReceiptOutcome(normal, event.resultToken);
  if (normalOutcome !== event.outcome) {
    if (normalOutcome) {
      throw new SoloProfileProjectionConflictError(
        event.resultToken,
        normalOutcome,
        event.outcome,
      );
    }
    throw new TypeError("Projected normal profile does not contain the verified result token");
  }

  const solo = normalizeModeRecord(normal);
  const modes = Object.fromEntries(OVERALL_MODES.map((mode) => [
    mode,
    mode === "solo" ? solo : emptyModeRecord(),
  ]));
  return {
    name: normalizedName(normal.name, event.name),
    wins: solo.wins,
    losses: solo.losses,
    draws: solo.draws,
    streak: nonnegativeInteger(normal.streak),
    bestStreak: Math.max(
      nonnegativeInteger(normal.bestStreak),
      nonnegativeInteger(normal.streak),
    ),
    rating: normalizedRating(normal.rating),
    modes,
    updatedAt: Math.max(nonnegativeInteger(normal.updatedAt), event.updatedAt),
    lastResultRoomId: event.roomId,
    lastResultMode: "solo",
    lastResultOutcome: event.outcome,
    appliedResults: {
      [event.resultToken]: event.outcome,
    },
    serverProjectionReceipts: appendedServerProjectionReceipts(normal, event),
    serverProjectionSequence: event.projectionSequence,
  };
}

function overallMatchesConcurrentNormalSeed(currentValue, projectedNormalValue, event) {
  const current = objectValue(currentValue);
  const normal = objectValue(projectedNormalValue);
  const currentUpdatedAt = Number(current.updatedAt);
  if (!Number.isFinite(currentUpdatedAt) || currentUpdatedAt < event.updatedAt) return false;
  const modes = normalizedOverallModes(current);
  if (OVERALL_MODES.some((mode) => (
    mode !== "solo"
      && (modes[mode].wins || modes[mode].losses || modes[mode].draws)
  ))) return false;
  const solo = modes.solo;
  return solo.wins === nonnegativeInteger(normal.wins)
    && solo.losses === nonnegativeInteger(normal.losses)
    && solo.draws === nonnegativeInteger(normal.draws)
    && normalizedRating(current.rating) === normalizedRating(normal.rating)
    && nonnegativeInteger(current.streak) === nonnegativeInteger(normal.streak)
    && nonnegativeInteger(current.bestStreak) === nonnegativeInteger(normal.bestStreak);
}

function projectOverallSoloProfile(currentValue, projectedNormalValue, eventValue) {
  const event = validateProjectionEvent(eventValue);
  const currentExists = currentValue !== null && currentValue !== undefined;
  if (!currentExists) {
    return {
      status: "seeded",
      profile: seedOverallProfileFromProjectedNormal(projectedNormalValue, event),
    };
  }

  const current = objectValue(currentValue);
  if (existingServerTokenOutcome(current, event)) {
    return {
      status: "already-applied",
      profile: currentValue,
    };
  }
  if (positiveSafeInteger(current.serverProjectionSequence) >= event.projectionSequence) {
    return {
      status: "obsolete",
      profile: currentValue,
    };
  }

  if (overallMatchesConcurrentNormalSeed(current, projectedNormalValue, event)) {
    const record = overallProfileFromModes(current, event);
    record.lastResultRoomId = event.roomId;
    record.lastResultMode = "solo";
    record.lastResultOutcome = event.outcome;
    record.appliedResults = {
      ...copiedAppliedResults(current.appliedResults),
      [event.resultToken]: event.outcome,
    };
    record.serverProjectionReceipts = appendedServerProjectionReceipts(current, event);
    record.serverProjectionSequence = event.projectionSequence;
    return {
      status: "absorbed-concurrent-seed",
      profile: record,
    };
  }

  const currentUpdatedAt = Number(current.updatedAt);
  const currentIsNewer = Number.isFinite(currentUpdatedAt)
    && currentUpdatedAt > event.updatedAt;
  const record = overallProfileFromModes(current, event);
  const modeRecord = { ...record.modes.solo };
  if (currentIsNewer) applyOutcomeCountsOnly(record, event.outcome);
  else applyOutcomeCounters(record, event.outcome);
  if (event.outcome === "win") modeRecord.wins += 1;
  else if (event.outcome === "loss") modeRecord.losses += 1;
  else modeRecord.draws += 1;
  modeRecord.matches = modeRecord.wins + modeRecord.losses + modeRecord.draws;
  modeRecord.points = (modeRecord.wins * 3) + modeRecord.draws;
  record.modes.solo = modeRecord;
  if (!currentIsNewer) {
    record.rating = calculateSoloProfileRating(
      record.rating,
      event.opponentRating,
      event.outcome,
    );
    record.lastResultRoomId = event.roomId;
    record.lastResultMode = "solo";
    record.lastResultOutcome = event.outcome;
  } else {
    if (current.lastResultRoomId) record.lastResultRoomId = String(current.lastResultRoomId);
    if (OVERALL_MODES.includes(current.lastResultMode)) {
      record.lastResultMode = current.lastResultMode;
    }
    if (OUTCOMES.includes(current.lastResultOutcome)) {
      record.lastResultOutcome = current.lastResultOutcome;
    }
  }
  record.appliedResults = {
    ...copiedAppliedResults(current.appliedResults),
    [event.resultToken]: event.outcome,
  };
  record.serverProjectionReceipts = appendedServerProjectionReceipts(current, event);
  record.serverProjectionSequence = event.projectionSequence;

  return {
    status: "applied",
    profile: record,
  };
}

module.exports = {
  INITIAL_RATING,
  MAX_RATING,
  MIN_RATING,
  OUTCOMES,
  OVERALL_MODES,
  RATING_K_FACTOR,
  SERVER_PROJECTION_RECEIPT_LIMIT,
  SoloProfileProjectionConflictError,
  calculateSoloProfileRating,
  projectNormalSoloProfile,
  projectOverallSoloProfile,
  serverProjectionReceiptOutcome,
};
