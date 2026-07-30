export const TRAINING_SESSION_V5_PHASES = Object.freeze([
  "idle",
  "starting",
  "waiting",
  "reserved",
  "connecting",
  "active",
  "recovering",
  "terminal",
  "superseded",
]);

export const TRAINING_SESSION_V5_OWNER_STATUSES = Object.freeze([
  "unknown",
  "reclaimed",
  "owner-replaced",
]);

export const TRAINING_SESSION_V5_RESULT_TERMINAL_KINDS = Object.freeze([
  "completed",
  "result",
  "victory",
  "defeat",
  "draw",
]);

const STATE_KEYS = Object.freeze([
  "phase",
  "revision",
  "runId",
  "resumePhase",
  "roomId",
  "roomAttemptId",
  "transportEpoch",
  "recoveryReason",
  "terminalKind",
]);
const RESUMABLE_PHASES = Object.freeze([
  "starting",
  "waiting",
  "reserved",
  "connecting",
  "active",
]);
const ROOM_PHASES = new Set(["reserved", "connecting", "active"]);
const TOKEN_PATTERN = /^[-_0-9A-Za-z]{8,128}$/;

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function isNullableToken(value) {
  return value === null || isToken(value);
}

function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function freeze(value) {
  return Object.freeze(value);
}

function baseState(revision = 0) {
  return {
    phase: "idle",
    revision,
    runId: null,
    resumePhase: null,
    roomId: null,
    roomAttemptId: null,
    transportEpoch: null,
    recoveryReason: null,
    terminalKind: null,
  };
}

export function createTrainingSessionV5State({ revision = 0 } = {}) {
  if (!isCounter(revision)) {
    throw new TypeError("revision must be a non-negative safe integer");
  }
  return freeze(baseState(revision));
}

export function validateTrainingSessionV5State(state) {
  if (!exactKeys(state, STATE_KEYS)
      || !TRAINING_SESSION_V5_PHASES.includes(state.phase)
      || !isCounter(state.revision)
      || !isNullableToken(state.runId)
      || !isNullableToken(state.roomId)
      || !isNullableToken(state.roomAttemptId)
      || !isNullableToken(state.transportEpoch)
      || !isNullableToken(state.recoveryReason)
      || !isNullableToken(state.terminalKind)) {
    return false;
  }
  if (state.phase === "idle") {
    return state.runId === null
      && state.resumePhase === null
      && state.roomId === null
      && state.roomAttemptId === null
      && state.transportEpoch === null
      && state.recoveryReason === null
      && state.terminalKind === null;
  }
  if (!isToken(state.runId)) return false;
  if ((state.roomId === null) !== (state.roomAttemptId === null)) return false;
  if (ROOM_PHASES.has(state.phase)
      && (
        state.roomId === null
        || state.roomAttemptId === null
        || (
          ["connecting", "active"].includes(state.phase)
          && state.transportEpoch === null
        )
      )) {
    return false;
  }
  if (["starting", "waiting"].includes(state.phase)
      && (state.roomId !== null || state.roomAttemptId !== null)) {
    return false;
  }
  if (state.phase === "recovering") {
    if (!RESUMABLE_PHASES.includes(state.resumePhase)
        || state.recoveryReason === null) {
      return false;
    }
    const resumesRoom = ROOM_PHASES.has(state.resumePhase);
    if (resumesRoom !== (state.roomId !== null)) return false;
  } else if (state.resumePhase !== null || state.recoveryReason !== null) {
    return false;
  }
  if (["terminal", "superseded"].includes(state.phase)) {
    return state.terminalKind !== null;
  }
  return state.terminalKind === null;
}

export function normalizeTrainingSessionV5State(value) {
  return validateTrainingSessionV5State(value)
    ? freeze({ ...value })
    : null;
}

export function createTrainingSessionV5Fence(state) {
  if (!validateTrainingSessionV5State(state) || state.runId === null) {
    throw new TypeError("state must be a valid running training session");
  }
  return freeze({
    runId: state.runId,
    revision: state.revision,
  });
}

export function trainingSessionV5FenceMatches(state, fence) {
  return validateTrainingSessionV5State(state)
    && state.runId !== null
    && isRecord(fence)
    && fence.runId === state.runId
    && fence.revision === state.revision;
}

export function isTrainingSessionV5Phase(state, ...phases) {
  const expected = phases.flat();
  return validateTrainingSessionV5State(state)
    && expected.length > 0
    && expected.every((phase) => TRAINING_SESSION_V5_PHASES.includes(phase))
    && expected.includes(state.phase);
}

export function trainingSessionV5Screen(state) {
  if (!validateTrainingSessionV5State(state)) return "error";
  const phase = state.phase === "recovering" ? state.resumePhase : state.phase;
  if (phase === "idle") return "setup";
  if (["starting", "waiting"].includes(phase)) return "matching";
  if (phase === "reserved") return "forming";
  if (["connecting", "active"].includes(phase)) return "room";
  if (["terminal", "superseded"].includes(phase)) {
    return TRAINING_SESSION_V5_RESULT_TERMINAL_KINDS
      .includes(state.terminalKind)
      ? "result"
      : "error";
  }
  return "error";
}

function result(state, accepted, reason, previousPhase = state.phase) {
  return freeze({
    accepted,
    ignored: !accepted,
    reason,
    state,
    previousPhase,
    fence: state.runId === null
      ? null
      : freeze({ runId: state.runId, revision: state.revision }),
  });
}

function nextState(state, changes) {
  const next = freeze({
    ...state,
    ...changes,
    revision: state.revision + 1,
  });
  if (!validateTrainingSessionV5State(next)) {
    throw new TypeError("transition produced an invalid V5 training state");
  }
  return next;
}

function reject(state, reason) {
  return result(state, false, reason);
}

export function transitionTrainingSessionV5(state, event) {
  if (!validateTrainingSessionV5State(state)) {
    throw new TypeError("state must be a valid V5 training state");
  }
  if (!isRecord(event) || typeof event.type !== "string") {
    return reject(state, "event-invalid");
  }

  if (event.type === "BEGIN") {
    if (state.phase !== "idle") return reject(state, "phase-not-idle");
    if (event.revision !== state.revision) {
      return reject(state, "revision-stale");
    }
    if (!isToken(event.runId)) return reject(state, "run-id-invalid");
    return result(nextState(state, {
      phase: "starting",
      runId: event.runId,
    }), true, "run-started", state.phase);
  }

  if (!trainingSessionV5FenceMatches(state, event)) {
    return reject(
      state,
      event.runId === state.runId ? "revision-stale" : "run-stale",
    );
  }

  if (event.type === "RESET") {
    if (!["terminal", "superseded"].includes(state.phase)) {
      return reject(state, "phase-not-finished");
    }
    return result(
      freeze(baseState(state.revision + 1)),
      true,
      "run-reset",
      state.phase,
    );
  }

  if (["terminal", "superseded"].includes(state.phase)) {
    return reject(state, "run-finished");
  }

  if (event.type === "TERMINATE") {
    if (!isToken(event.terminalKind)) {
      return reject(state, "terminal-kind-invalid");
    }
    return result(nextState(state, {
      phase: "terminal",
      resumePhase: null,
      recoveryReason: null,
      terminalKind: event.terminalKind,
    }), true, "run-terminal", state.phase);
  }

  if (event.type === "OWNER_STATUS") {
    if (!TRAINING_SESSION_V5_OWNER_STATUSES.includes(event.status)) {
      return reject(state, "owner-status-invalid");
    }
    if (event.status === "owner-replaced") {
      return result(nextState(state, {
        phase: "superseded",
        resumePhase: null,
        recoveryReason: null,
        terminalKind: "owner-replaced",
      }), true, "owner-replaced", state.phase);
    }
    if (event.status === "reclaimed") {
      if (state.phase !== "recovering") {
        return reject(state, "owner-already-current");
      }
      return result(nextState(state, {
        phase: state.resumePhase,
        resumePhase: null,
        recoveryReason: null,
      }), true, "owner-reclaimed", state.phase);
    }
    if (state.phase === "recovering") {
      return reject(state, "already-recovering");
    }
    return result(nextState(state, {
      phase: "recovering",
      resumePhase: state.phase,
      recoveryReason: isToken(event.reason)
        ? event.reason
        : "owner-unknown",
    }), true, "owner-unknown", state.phase);
  }

  if (event.type === "RECOVER") {
    if (state.phase === "recovering") return reject(state, "already-recovering");
    if (!RESUMABLE_PHASES.includes(state.phase)) {
      return reject(state, "phase-not-recoverable");
    }
    if (!isToken(event.reason)) return reject(state, "recovery-reason-invalid");
    return result(nextState(state, {
      phase: "recovering",
      resumePhase: state.phase,
      recoveryReason: event.reason,
    }), true, "recovery-started", state.phase);
  }

  if (event.type === "CLAIMED") {
    if (state.phase !== "starting") return reject(state, "phase-not-starting");
    return result(nextState(state, {
      phase: "waiting",
    }), true, "owner-claimed", state.phase);
  }

  if (event.type === "WAIT") {
    if (!["starting", "reserved", "connecting"].includes(state.phase)) {
      return reject(state, "phase-cannot-wait");
    }
    return result(nextState(state, {
      phase: "waiting",
      roomId: null,
      roomAttemptId: null,
      transportEpoch: null,
    }), true, "waiting", state.phase);
  }

  if (event.type === "RESERVE") {
    if (state.phase !== "waiting") return reject(state, "phase-not-waiting");
    if (!isToken(event.roomId) || !isToken(event.roomAttemptId)) {
      return reject(state, "room-fence-invalid");
    }
    return result(nextState(state, {
      phase: "reserved",
      roomId: event.roomId,
      roomAttemptId: event.roomAttemptId,
      transportEpoch: null,
    }), true, "room-reserved", state.phase);
  }

  if (event.type === "CONNECT") {
    if (!["reserved", "connecting", "active"].includes(state.phase)) {
      return reject(state, "phase-cannot-connect");
    }
    const transportEpoch = event.transportEpoch;
    if (!isToken(transportEpoch)) {
      return reject(state, "transport-epoch-invalid");
    }
    return result(nextState(state, {
      phase: "connecting",
      transportEpoch,
    }), true, "transport-connecting", state.phase);
  }

  if (event.type === "ACTIVATE") {
    if (state.phase !== "connecting") {
      return reject(state, "phase-not-connecting");
    }
    return result(nextState(state, {
      phase: "active",
    }), true, "transport-active", state.phase);
  }

  return reject(state, "event-unsupported");
}
