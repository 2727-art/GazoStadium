import {
  TRAINING_V6_PHASES,
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_VARIANT,
  isTrainingV6TerminalPhase,
  trainingV6ParticipantUidsFromMemberOrder,
  validateTrainingV6P2PEvent,
} from "./training-v6-domain.mjs";

export const TRAINING_V6_TRANSPORT_STATES = Object.freeze([
  "idle",
  "online",
  "recovering",
]);

const REQUIRED_SNAPSHOT_KEYS = Object.freeze([
  "protocolVersion",
  "variant",
  "roomId",
  "members",
  "memberOrder",
  "phase",
  "revision",
  "roundNumber",
  "rounds",
  "workoutQueue",
  "activeWorkoutIndex",
]);
const PROJECTED_SNAPSHOT_KEYS = Object.freeze([
  ...REQUIRED_SNAPSHOT_KEYS,
  "instruction",
  "workout",
  "result",
]);
const CLIENT_STATE_KEYS = Object.freeze([
  "snapshot",
  "transportState",
  "recoveryReason",
]);
const SAFE_TOKEN = /^[-_0-9A-Za-z]{8,128}$/;
const SAFE_REASON = /^[-_0-9A-Za-z]{1,64}$/;

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneJsonValue(value, seen = new WeakSet()) {
  if (value === null
      || typeof value === "string"
      || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite JSON number");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new TypeError("snapshot must contain acyclic JSON values");
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((child) => cloneJsonValue(child, seen));
  } else {
    result = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined
          || typeof child === "function"
          || typeof child === "symbol"
          || typeof child === "bigint") {
        throw new TypeError("snapshot must contain JSON values");
      }
      result[key] = cloneJsonValue(child, seen);
    }
  }
  seen.delete(value);
  return result;
}

function jsonEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && jsonEqual(left[key], right[key])
    ));
}

function validMembership(members, memberOrder) {
  const participantUids = trainingV6ParticipantUidsFromMemberOrder(memberOrder);
  return participantUids.length === 2
    && hasExactKeys(members, participantUids)
    && participantUids.every((uid) => members[uid] === true);
}

function nullableRecord(value) {
  return value === null || isRecord(value);
}

function normalizeIndexedObject(value) {
  if (isRecord(value)) return value;
  if (!Array.isArray(value)) return null;
  return Object.fromEntries(
    value
      .map((child, index) => [String(index), child])
      .filter(([, child]) => child != null),
  );
}

function normalizeMemberOrder(value) {
  const participantUids = trainingV6ParticipantUidsFromMemberOrder(value);
  return participantUids.length === 2
    ? { 0: participantUids[0], 1: participantUids[1] }
    : null;
}

function normalizeWorkoutQueue(value) {
  if (Array.isArray(value)) return value.filter((child) => child != null);
  const indexed = normalizeIndexedObject(value);
  if (!indexed) return null;
  const keys = Object.keys(indexed).sort((left, right) => Number(left) - Number(right));
  if (keys.some((key, index) => key !== String(index))) return null;
  return keys.map((key) => indexed[key]);
}

function validActiveWorkoutIndex(value, workoutQueue) {
  if (value === null || value === -1) return true;
  return Number.isInteger(value)
    && value >= 0
    && value < workoutQueue.length;
}

export function normalizeTrainingV6ServerSnapshot(value) {
  if (!isRecord(value)) return null;
  const memberOrder = normalizeMemberOrder(value.memberOrder);
  const rounds = normalizeIndexedObject(value.rounds);
  const workoutQueue = normalizeWorkoutQueue(value.workoutQueue);
  const candidate = {
    ...value,
    memberOrder,
    rounds,
    workoutQueue,
  };
  if (!REQUIRED_SNAPSHOT_KEYS.every((key) => Object.hasOwn(value, key))
      || value.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
      || value.variant !== TRAINING_V6_VARIANT
      || typeof value.roomId !== "string"
      || !SAFE_TOKEN.test(value.roomId)
      || !validMembership(candidate.members, memberOrder)
      || !TRAINING_V6_PHASES.includes(value.phase)
      || !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || !Number.isInteger(value.roundNumber)
      || value.roundNumber < 1
      || value.roundNumber > 5
      || !isRecord(rounds)
      || !Array.isArray(workoutQueue)
      || !validActiveWorkoutIndex(candidate.activeWorkoutIndex, workoutQueue)
      || !nullableRecord(value.instruction ?? null)
      || !nullableRecord(value.workout ?? null)
      || !nullableRecord(value.result ?? null)) {
    return null;
  }
  try {
    const projected = Object.fromEntries(PROJECTED_SNAPSHOT_KEYS.map((key) => [
      key,
      ["instruction", "workout", "result"].includes(key)
        ? candidate[key] ?? null
        : candidate[key],
    ]));
    return deepFreeze(cloneJsonValue(projected));
  } catch {
    return null;
  }
}

export function validateTrainingV6ServerSnapshot(value) {
  return normalizeTrainingV6ServerSnapshot(value) !== null;
}

export function trainingV6SnapshotParticipantUids(snapshot) {
  const normalized = normalizeTrainingV6ServerSnapshot(snapshot);
  return normalized
    ? trainingV6ParticipantUidsFromMemberOrder(normalized.memberOrder)
    : [];
}

export function createTrainingV6ClientState() {
  return deepFreeze({
    snapshot: null,
    transportState: "idle",
    recoveryReason: null,
  });
}

export function validateTrainingV6ClientState(value) {
  if (!hasExactKeys(value, CLIENT_STATE_KEYS)
      || !TRAINING_V6_TRANSPORT_STATES.includes(value.transportState)
      || (
        value.snapshot !== null
        && !validateTrainingV6ServerSnapshot(value.snapshot)
      )) {
    return false;
  }
  if (value.transportState === "recovering") {
    return typeof value.recoveryReason === "string"
      && SAFE_REASON.test(value.recoveryReason);
  }
  return value.recoveryReason === null;
}

function frozenState(snapshot, transportState, recoveryReason = null) {
  const state = deepFreeze({ snapshot, transportState, recoveryReason });
  if (!validateTrainingV6ClientState(state)) {
    throw new TypeError("transition produced invalid Training V6 client state");
  }
  return state;
}

function decision(state, accepted, reason, effect = null) {
  return deepFreeze({
    accepted,
    ignored: !accepted,
    reason,
    state,
    effect,
  });
}

export function transitionTrainingV6ClientState(state, event) {
  if (!validateTrainingV6ClientState(state)) {
    throw new TypeError("state must be a valid Training V6 client state");
  }
  if (!isRecord(event) || typeof event.type !== "string") {
    return decision(state, false, "event-invalid");
  }

  if (event.type === "SERVER_SNAPSHOT") {
    const snapshot = normalizeTrainingV6ServerSnapshot(event.snapshot);
    if (!snapshot) return decision(state, false, "snapshot-invalid");
    const current = state.snapshot;
    if (current && current.roomId !== snapshot.roomId) {
      return decision(state, false, "room-mismatch");
    }
    if (current && snapshot.revision < current.revision) {
      return decision(state, false, "snapshot-stale");
    }
    if (current && snapshot.revision === current.revision) {
      return decision(
        state,
        false,
        jsonEqual(current, snapshot)
          ? "snapshot-duplicate"
          : "snapshot-revision-conflict",
      );
    }
    return decision(
      frozenState(
        snapshot,
        state.transportState === "idle" ? "online" : state.transportState,
        state.recoveryReason,
      ),
      true,
      "snapshot-applied",
    );
  }

  if (event.type === "TRANSPORT_INTERRUPTED") {
    if (!state.snapshot) return decision(state, false, "room-not-active");
    const reason = typeof event.reason === "string" && SAFE_REASON.test(event.reason)
      ? event.reason
      : "connection-unknown";
    if (state.transportState === "recovering"
        && state.recoveryReason === reason) {
      return decision(state, false, "recovery-duplicate");
    }
    return decision(
      frozenState(state.snapshot, "recovering", reason),
      true,
      "recovery-overlay-shown",
    );
  }

  if (event.type === "TRANSPORT_RESTORED") {
    if (!state.snapshot) return decision(state, false, "room-not-active");
    if (state.transportState === "online") {
      return decision(state, false, "transport-already-online");
    }
    return decision(
      frozenState(state.snapshot, "online"),
      true,
      "recovery-overlay-cleared",
    );
  }

  if (event.type === "P2P_EVENT") {
    if (!state.snapshot) return decision(state, false, "room-not-active");
    if (!validateTrainingV6P2PEvent(event.message)) {
      return decision(state, false, "p2p-event-invalid");
    }
    if (event.message.roomId !== state.snapshot.roomId) {
      return decision(state, false, "p2p-room-mismatch");
    }
    const participantUids = trainingV6ParticipantUidsFromMemberOrder(
      state.snapshot.memberOrder,
    );
    if (!participantUids.includes(event.message.fromUid)
        || !participantUids.includes(event.message.toUid)) {
      return decision(state, false, "p2p-member-mismatch");
    }
    return decision(
      state,
      true,
      "p2p-event-ephemeral",
      deepFreeze({ type: "display-p2p-event", message: event.message }),
    );
  }

  if (event.type === "CLEAR") {
    if (state.snapshot && !isTrainingV6TerminalPhase(state.snapshot.phase)) {
      return decision(state, false, "room-not-terminal");
    }
    return decision(createTrainingV6ClientState(), true, "client-cleared");
  }

  return decision(state, false, "event-unsupported");
}

export function trainingV6CanonicalPhase(state) {
  return validateTrainingV6ClientState(state)
    ? state.snapshot?.phase || null
    : null;
}

export function trainingV6CanonicalRevision(state) {
  return validateTrainingV6ClientState(state)
    ? state.snapshot?.revision ?? null
    : null;
}

export function trainingV6RecoveryOverlay(state) {
  if (!validateTrainingV6ClientState(state)
      || state.transportState !== "recovering") {
    return null;
  }
  return deepFreeze({
    kind: "recovering",
    reason: state.recoveryReason,
    phase: state.snapshot.phase,
    revision: state.snapshot.revision,
  });
}
