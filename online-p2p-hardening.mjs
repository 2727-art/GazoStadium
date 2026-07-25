export const ONLINE_P2P_RECOVERY_DEFAULTS = Object.freeze({
  connectionTimeoutMs: 15_000,
  disconnectedGraceMs: 5_000,
  restartTimeoutMs: 10_000,
  opponentCooldownMs: 120_000,
});

export const ONLINE_P2P_RECOVERY_PHASES = Object.freeze({
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  RESTARTING: "restarting",
  AWAITING_HOST_RESTART: "awaiting-host-restart",
  CLEANING_UP: "cleaning-up",
  TERMINAL: "terminal",
});

const MAX_ICE_RESTARTS = 1;
const MAX_AUTO_REQUEUES = 1;

function finiteTimestamp(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite timestamp`);
  }
  return value;
}

function positiveDuration(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive duration`);
  }
  return value;
}

function normalizeConfig(overrides = {}) {
  return Object.freeze({
    connectionTimeoutMs: positiveDuration(
      overrides.connectionTimeoutMs ?? ONLINE_P2P_RECOVERY_DEFAULTS.connectionTimeoutMs,
      "connectionTimeoutMs",
    ),
    disconnectedGraceMs: positiveDuration(
      overrides.disconnectedGraceMs ?? ONLINE_P2P_RECOVERY_DEFAULTS.disconnectedGraceMs,
      "disconnectedGraceMs",
    ),
    restartTimeoutMs: positiveDuration(
      overrides.restartTimeoutMs ?? ONLINE_P2P_RECOVERY_DEFAULTS.restartTimeoutMs,
      "restartTimeoutMs",
    ),
    opponentCooldownMs: positiveDuration(
      overrides.opponentCooldownMs ?? ONLINE_P2P_RECOVERY_DEFAULTS.opponentCooldownMs,
      "opponentCooldownMs",
    ),
  });
}

function makeTimer(generationToken, kind, deadlineAt) {
  const timerToken = Object.freeze({ generationToken, kind });
  return {
    timerKind: kind,
    timerToken,
    deadlineAt,
  };
}

function clearTimer() {
  return {
    timerKind: null,
    timerToken: null,
    deadlineAt: null,
  };
}

function result(state, effects = [], ignored = false) {
  return Object.freeze({
    state: Object.freeze(state),
    effects: Object.freeze(effects.map((effect) => Object.freeze(effect))),
    ignored,
  });
}

/**
 * The token is intentionally compared by identity. Replacing it for every room
 * connection generation makes callbacks captured by an older room harmless,
 * even if a backend room id is accidentally reused.
 */
export function createOnlineP2pGenerationToken({
  matchmakingGeneration,
  roomId,
  sessionId = null,
} = {}) {
  return Object.freeze({
    type: "online-p2p-generation",
    matchmakingGeneration,
    roomId,
    sessionId,
  });
}

export function isOnlineP2pGenerationCurrent(expectedToken, currentToken) {
  return Boolean(expectedToken && expectedToken === currentToken);
}

export function createOnlineP2pRecoveryState({
  generationToken,
  isHost,
  opponentUid,
  startedAt,
  autoRequeueCount = 0,
  visible = true,
  online = true,
  config: configOverrides,
} = {}) {
  if (!generationToken) throw new TypeError("generationToken is required");
  if (!Number.isInteger(autoRequeueCount) || autoRequeueCount < 0) {
    throw new TypeError("autoRequeueCount must be a non-negative integer");
  }
  const now = finiteTimestamp(startedAt, "startedAt");
  const config = normalizeConfig(configOverrides);
  const timer = makeTimer(
    generationToken,
    "connection",
    now + config.connectionTimeoutMs,
  );
  return Object.freeze({
    generationToken,
    isHost: Boolean(isHost),
    opponentUid: opponentUid ?? null,
    phase: ONLINE_P2P_RECOVERY_PHASES.CONNECTING,
    config,
    ...timer,
    resumePhase: null,
    resumeRemainingMs: null,
    iceRestartCount: 0,
    autoRequeueCount,
    visible: Boolean(visible),
    online: Boolean(online),
    manuallyCancelled: false,
    channelWasOpened: false,
    failureReason: null,
    opponentCooldown: null,
    resolution: null,
  });
}

/**
 * Returns the exact tokens that a timeout callback must echo back in a
 * TIMER_EXPIRED event. Both tokens are checked, so a replaced timer in the same
 * room generation cannot advance the state machine.
 */
export function getOnlineP2pRecoveryTimer(state) {
  if (!state?.timerToken || !Number.isFinite(state.deadlineAt)) return null;
  return Object.freeze({
    generationToken: state.generationToken,
    timerToken: state.timerToken,
    kind: state.timerKind,
    deadlineAt: state.deadlineAt,
  });
}

export function isOnlineP2pOpponentCoolingDown(cooldown, opponentUid, now) {
  return Boolean(
    cooldown
      && opponentUid
      && cooldown.opponentUid === opponentUid
      && finiteTimestamp(now, "now") < cooldown.expiresAt,
  );
}

export function evaluateOnlineP2pAutoRequeue(state, now) {
  finiteTimestamp(now, "now");
  if (state.manuallyCancelled) {
    return Object.freeze({ allowed: false, reason: "manual-cancel" });
  }
  if (!state.visible) {
    return Object.freeze({ allowed: false, reason: "page-hidden" });
  }
  if (!state.online) {
    return Object.freeze({ allowed: false, reason: "offline" });
  }
  if (state.channelWasOpened) {
    return Object.freeze({ allowed: false, reason: "connection-was-established" });
  }
  if (state.autoRequeueCount >= MAX_AUTO_REQUEUES) {
    return Object.freeze({ allowed: false, reason: "auto-requeue-limit" });
  }
  return Object.freeze({
    allowed: true,
    reason: "eligible",
    nextAutoRequeueCount: state.autoRequeueCount + 1,
    opponentCooldown: state.opponentCooldown,
  });
}

function startRecoveryAttempt(state, now, reason) {
  if (state.isHost && state.iceRestartCount < MAX_ICE_RESTARTS) {
    const timer = makeTimer(
      state.generationToken,
      "restart",
      now + state.config.restartTimeoutMs,
    );
    return result({
      ...state,
      phase: ONLINE_P2P_RECOVERY_PHASES.RESTARTING,
      ...timer,
      resumePhase: null,
      resumeRemainingMs: null,
      iceRestartCount: state.iceRestartCount + 1,
      failureReason: reason,
    }, [{
      type: "restart-ice",
      generationToken: state.generationToken,
      reason,
    }]);
  }

  if (!state.isHost
      && state.phase === ONLINE_P2P_RECOVERY_PHASES.AWAITING_HOST_RESTART) {
    // Repeated ICE failure notifications must not keep extending the guest's
    // wait forever. The existing timer remains authoritative.
    return result(state, [], true);
  }

  if (!state.isHost && state.iceRestartCount < MAX_ICE_RESTARTS) {
    const timer = makeTimer(
      state.generationToken,
      "await-host-restart",
      now + state.config.restartTimeoutMs,
    );
    return result({
      ...state,
      phase: ONLINE_P2P_RECOVERY_PHASES.AWAITING_HOST_RESTART,
      ...timer,
      resumePhase: null,
      resumeRemainingMs: null,
      failureReason: reason,
    });
  }

  return beginFailureCleanup(state, now, reason);
}

function beginFailureCleanup(state, now, reason) {
  const opponentCooldown = state.opponentUid
    ? Object.freeze({
      opponentUid: state.opponentUid,
      expiresAt: now + state.config.opponentCooldownMs,
    })
    : null;
  return result({
    ...state,
    phase: ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP,
    ...clearTimer(),
    resumePhase: null,
    resumeRemainingMs: null,
    failureReason: reason,
    opponentCooldown,
  }, [{
    type: "cleanup-failed-room",
    generationToken: state.generationToken,
    reason,
  }]);
}

function handleTimerExpired(state, event, now) {
  if (event.timerToken !== state.timerToken
      || !state.deadlineAt
      || now < state.deadlineAt) {
    return result(state, [], true);
  }

  if (state.phase === ONLINE_P2P_RECOVERY_PHASES.CONNECTING) {
    return startRecoveryAttempt(state, now, "connection-timeout");
  }
  if (state.phase === ONLINE_P2P_RECOVERY_PHASES.DISCONNECTED) {
    return startRecoveryAttempt(state, now, "disconnected-timeout");
  }
  if (state.phase === ONLINE_P2P_RECOVERY_PHASES.RESTARTING
      || state.phase === ONLINE_P2P_RECOVERY_PHASES.AWAITING_HOST_RESTART) {
    return beginFailureCleanup(state, now, "restart-timeout");
  }
  return result(state, [], true);
}

function handleDisconnected(state, now) {
  if (state.phase === ONLINE_P2P_RECOVERY_PHASES.DISCONNECTED
      || state.phase === ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP
      || state.phase === ONLINE_P2P_RECOVERY_PHASES.TERMINAL) {
    return result(state, [], true);
  }
  const resumeRemainingMs = Number.isFinite(state.deadlineAt)
    ? Math.max(0, state.deadlineAt - now)
    : null;
  const timer = makeTimer(
    state.generationToken,
    "disconnected-grace",
    now + state.config.disconnectedGraceMs,
  );
  return result({
    ...state,
    phase: ONLINE_P2P_RECOVERY_PHASES.DISCONNECTED,
    ...timer,
    resumePhase: state.phase,
    resumeRemainingMs,
  });
}

function handleConnectionRecovered(state, now, channelOpened) {
  if (state.phase === ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP) {
    if (!channelOpened || state.channelWasOpened) {
      return result(state, [], true);
    }
    return result({
      ...state,
      channelWasOpened: true,
    });
  }
  if (state.phase === ONLINE_P2P_RECOVERY_PHASES.TERMINAL) {
    return result(state, [], true);
  }

  if (channelOpened || state.channelWasOpened) {
    return result({
      ...state,
      phase: ONLINE_P2P_RECOVERY_PHASES.CONNECTED,
      ...clearTimer(),
      resumePhase: null,
      resumeRemainingMs: null,
      channelWasOpened: state.channelWasOpened || channelOpened,
      failureReason: null,
    });
  }

  if (state.phase !== ONLINE_P2P_RECOVERY_PHASES.DISCONNECTED) {
    return result(state, [], true);
  }

  const resumePhase = state.resumePhase || ONLINE_P2P_RECOVERY_PHASES.CONNECTING;
  const duration = Math.max(1, state.resumeRemainingMs ?? state.config.connectionTimeoutMs);
  const timerKind = resumePhase === ONLINE_P2P_RECOVERY_PHASES.RESTARTING
    ? "restart"
    : resumePhase === ONLINE_P2P_RECOVERY_PHASES.AWAITING_HOST_RESTART
      ? "await-host-restart"
      : "connection";
  return result({
    ...state,
    phase: resumePhase,
    ...makeTimer(state.generationToken, timerKind, now + duration),
    resumePhase: null,
    resumeRemainingMs: null,
  });
}

/**
 * Pure reducer for the normal 1on1 P2P recovery lifecycle.
 *
 * Every event must carry the generationToken captured by its callback. Timer
 * events must additionally carry the timerToken returned by
 * getOnlineP2pRecoveryTimer().
 */
export function transitionOnlineP2pRecovery(state, event) {
  if (!state || !event || !event.type) {
    throw new TypeError("state and event.type are required");
  }
  if (!isOnlineP2pGenerationCurrent(event.generationToken, state.generationToken)) {
    return result(state, [], true);
  }
  const now = finiteTimestamp(event.now, "event.now");

  switch (event.type) {
    case "CHANNEL_OPENED":
      return handleConnectionRecovered(state, now, true);
    case "ICE_CONNECTED":
      return handleConnectionRecovered(state, now, false);
    case "ICE_DISCONNECTED":
      return handleDisconnected(state, now);
    case "ICE_FAILED":
      if (state.phase === ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP
          || state.phase === ONLINE_P2P_RECOVERY_PHASES.TERMINAL
          || state.phase === ONLINE_P2P_RECOVERY_PHASES.RESTARTING
          || state.phase === ONLINE_P2P_RECOVERY_PHASES.AWAITING_HOST_RESTART) {
        return result(state, [], true);
      }
      return startRecoveryAttempt(state, now, "ice-failed");
    case "TIMER_EXPIRED":
      return handleTimerExpired(state, event, now);
    case "RESTART_OFFER_RECEIVED":
      if (state.isHost
          || state.channelWasOpened
          || state.phase === ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP
          || state.phase === ONLINE_P2P_RECOVERY_PHASES.TERMINAL) {
        return result(state, [], true);
      }
      return result({
        ...state,
        phase: ONLINE_P2P_RECOVERY_PHASES.RESTARTING,
        ...makeTimer(
          state.generationToken,
          "restart",
          now + state.config.restartTimeoutMs,
        ),
        resumePhase: null,
        resumeRemainingMs: null,
        iceRestartCount: MAX_ICE_RESTARTS,
      });
    case "MANUAL_CANCELLED":
      return result({
        ...state,
        manuallyCancelled: true,
      });
    case "VISIBILITY_CHANGED":
      return result({
        ...state,
        visible: Boolean(event.visible),
      });
    case "NETWORK_CHANGED":
      return result({
        ...state,
        online: Boolean(event.online),
      });
    case "CLEANUP_COMPLETED": {
      if (state.phase !== ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP) {
        return result(state, [], true);
      }
      const decision = evaluateOnlineP2pAutoRequeue(state, now);
      const terminalState = {
        ...state,
        phase: ONLINE_P2P_RECOVERY_PHASES.TERMINAL,
        resolution: decision.allowed ? "auto-requeue" : decision.reason,
      };
      if (!decision.allowed) {
        return result(terminalState, [{
          type: "show-connection-failure",
          generationToken: state.generationToken,
          reason: decision.reason,
          failureReason: state.failureReason,
        }]);
      }
      return result(terminalState, [{
        type: "auto-requeue",
        generationToken: state.generationToken,
        autoRequeueCount: decision.nextAutoRequeueCount,
        opponentCooldown: decision.opponentCooldown,
      }]);
    }
    default:
      throw new TypeError(`Unknown online P2P recovery event: ${event.type}`);
  }
}
