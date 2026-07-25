export const ONLINE_SESSION_PROTOCOL_VERSION = 2;
export const ONLINE_SESSION_STORAGE_KEY = "hariai:normal-1on1:session-id:v2";

export const ONLINE_SESSION_LEASE_DEFAULTS = Object.freeze({
  ttlMs: 60_000,
  heartbeatIntervalMs: 15_000,
  retryIntervalMs: 3_000,
});

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_128_PATTERN = /^[0-9a-f]{32}$/;
const CONNECTION_GENERATION_PATTERN = /^[-_0-9A-Za-z]{8,128}$/;
const ROOM_ID_PATTERN = /^[-_0-9A-Za-z]{1,128}$/;
const LEASE_KEYS = Object.freeze([
  "claimedAt",
  "expiresAt",
  "heartbeatAt",
  "leaseToken",
  "protocolVersion",
  "sessionId",
]);
const FENCE_KEYS = Object.freeze([
  "connectionGeneration",
  "leaseToken",
  "protocolVersion",
  "sessionId",
]);
const SIGNAL_SCOPE_KEYS = Object.freeze([
  "connectionGeneration",
  "fromSessionId",
  "toSessionId",
]);

function frozen(value) {
  return Object.freeze(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function isFiniteTimestamp(value) {
  return Number.isFinite(value)
    && Number.isSafeInteger(value)
    && value >= 0;
}

function requireTimestamp(value, label) {
  if (!isFiniteTimestamp(value)) {
    throw new TypeError(`${label} must be a non-negative safe-integer timestamp`);
  }
  return value;
}

function requireDuration(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe-integer duration`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function requireSessionId(value, label) {
  if (!isValidOnlineSessionId(value)) {
    throw new TypeError(
      `${label} must be a canonical UUID v4 or 32-character lowercase hex id`,
    );
  }
  return value;
}

function requireConnectionGeneration(value, label) {
  if (!isValidOnlineConnectionGeneration(value)) {
    throw new TypeError(`${label} must be a safe positive integer or URL-safe token`);
  }
  return value;
}

function requireRoomId(value, label) {
  if (typeof value !== "string" || !ROOM_ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a URL-safe room id`);
  }
  return value;
}

function checkedExpiry(now, ttlMs) {
  const expiresAt = now + ttlMs;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new RangeError("lease expiry exceeds the safe-integer timestamp range");
  }
  return expiresAt;
}

function hasOnlyKeys(value, keys) {
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === keys.length
    && actualKeys.every((key, index) => key === keys[index]);
}

function sameConnectionGeneration(left, right) {
  return typeof left === typeof right && left === right;
}

function sameLease(left, right) {
  return left.protocolVersion === right.protocolVersion
    && left.sessionId === right.sessionId
    && left.leaseToken === right.leaseToken
    && left.claimedAt === right.claimedAt
    && left.heartbeatAt === right.heartbeatAt
    && left.expiresAt === right.expiresAt;
}

function makeLease({
  sessionId,
  leaseToken,
  claimedAt,
  heartbeatAt,
  expiresAt,
}) {
  return frozen({
    protocolVersion: ONLINE_SESSION_PROTOCOL_VERSION,
    sessionId,
    leaseToken,
    claimedAt,
    heartbeatAt,
    expiresAt,
  });
}

function makeLeaseDecision(action, reason, lease = null) {
  return frozen({
    action,
    allowed: action !== "block",
    reason,
    lease,
  });
}

function makeCleanupDecision(action, reason, protocol = null) {
  return frozen({
    action,
    remove: action === "remove",
    reason,
    protocol,
  });
}

function makeSignalDecision({
  action,
  reason,
  protocol = null,
  remoteSessionId = null,
}) {
  const accepted = action === "accept";
  return frozen({
    action,
    accepted,
    ignored: !accepted,
    consume: accepted ? "after-success" : "never",
    reason,
    protocol,
    remoteSessionId,
  });
}

/**
 * Session ids are generated once per browsing context and persisted in
 * sessionStorage by the integration layer. Canonical UUID v4 and lowercase
 * 128-bit hex values avoid ambiguous normalization between tabs and Firebase
 * records without depending on crypto.randomUUID(), which is absent in older
 * Safari releases that still provide Web Crypto getRandomValues().
 */
export function isValidOnlineSessionId(value) {
  return typeof value === "string"
    && (UUID_V4_PATTERN.test(value) || HEX_128_PATTERN.test(value));
}

/**
 * Generates one lowercase 128-bit token for session, page-lease, and liveness
 * probe identities. The caller may inject a Web Crypto-compatible provider for
 * deterministic tests.
 */
export function createOnlineSessionToken(
  cryptoProvider = typeof globalThis !== "undefined" ? globalThis.crypto : null,
) {
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== "function") {
    throw new TypeError("Web Crypto getRandomValues is required");
  }
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * A connection generation may be a local positive counter or a shared
 * URL-safe nonce (for example a Firebase push id). Equality remains type
 * sensitive, so "7" never aliases generation 7.
 */
export function isValidOnlineConnectionGeneration(value) {
  return (Number.isSafeInteger(value) && value > 0)
    || (typeof value === "string" && CONNECTION_GENERATION_PATTERN.test(value));
}

/**
 * Pure sessionStorage adapter decision. The caller supplies a freshly
 * generated 128-bit id only when the stored value might need replacement, then
 * persists the returned id iff shouldPersist is true.
 */
export function resolveOnlineSessionId({
  storedSessionId = null,
  generatedSessionId,
} = {}) {
  if (isValidOnlineSessionId(storedSessionId)) {
    return frozen({
      sessionId: storedSessionId,
      source: "stored",
      shouldPersist: false,
    });
  }
  requireSessionId(generatedSessionId, "generatedSessionId");
  return frozen({
    sessionId: generatedSessionId,
    source: "generated",
    shouldPersist: true,
  });
}

/**
 * Resource fences travel with queue/active records. leaseToken distinguishes
 * page instances even if a duplicated tab inherited the same sessionStorage.
 */
export function createOnlineSessionFence({
  sessionId,
  leaseToken,
  connectionGeneration,
} = {}) {
  requireSessionId(sessionId, "sessionId");
  requireSessionId(leaseToken, "leaseToken");
  requireConnectionGeneration(connectionGeneration, "connectionGeneration");
  return frozen({
    protocolVersion: ONLINE_SESSION_PROTOCOL_VERSION,
    sessionId,
    leaseToken,
    connectionGeneration,
  });
}

export function parseOnlineSessionLease(value) {
  if (!isRecord(value)
      || !hasOnlyKeys(value, LEASE_KEYS)
      || value.protocolVersion !== ONLINE_SESSION_PROTOCOL_VERSION
      || !isValidOnlineSessionId(value.sessionId)
      || !isValidOnlineSessionId(value.leaseToken)
      || !isFiniteTimestamp(value.claimedAt)
      || !isFiniteTimestamp(value.heartbeatAt)
      || !isFiniteTimestamp(value.expiresAt)
      || value.claimedAt > value.heartbeatAt
      || value.heartbeatAt >= value.expiresAt) {
    return null;
  }
  return makeLease(value);
}

/**
 * Intended for a Firebase transaction callback.
 *
 * Fresh leases belonging to any other page instance are never replaced.
 * A same-session/different-token takeover is possible only after the
 * integration layer has positively established that the previous page is
 * gone (for example with a BroadcastChannel liveness probe).
 */
export function decideOnlineSessionLease({
  currentLease = null,
  sessionId,
  leaseToken,
  now,
  ttlMs = ONLINE_SESSION_LEASE_DEFAULTS.ttlMs,
  sameSessionOwnerConfirmedGone = false,
} = {}) {
  requireSessionId(sessionId, "sessionId");
  requireSessionId(leaseToken, "leaseToken");
  requireTimestamp(now, "now");
  requireDuration(ttlMs, "ttlMs");
  requireBoolean(
    sameSessionOwnerConfirmedGone,
    "sameSessionOwnerConfirmedGone",
  );

  const expiresAt = checkedExpiry(now, ttlMs);
  if (currentLease === null || currentLease === undefined) {
    return makeLeaseDecision("claim", "lease-missing", makeLease({
      sessionId,
      leaseToken,
      claimedAt: now,
      heartbeatAt: now,
      expiresAt,
    }));
  }

  const parsed = parseOnlineSessionLease(currentLease);
  if (!parsed) {
    const knownExpiry = isRecord(currentLease) && isFiniteTimestamp(currentLease.expiresAt)
      ? currentLease.expiresAt
      : null;
    if (knownExpiry !== null && knownExpiry <= now) {
      return makeLeaseDecision("claim", "malformed-lease-expired", makeLease({
        sessionId,
        leaseToken,
        claimedAt: now,
        heartbeatAt: now,
        expiresAt,
      }));
    }
    return makeLeaseDecision("block", "malformed-lease-not-provably-expired");
  }

  const sameSession = parsed.sessionId === sessionId;
  const sameToken = parsed.leaseToken === leaseToken;
  if (sameSession && sameToken) {
    const wasExpired = parsed.expiresAt <= now;
    return makeLeaseDecision(
      wasExpired ? "claim" : "refresh",
      wasExpired ? "own-lease-expired" : "own-lease",
      makeLease({
        sessionId,
        leaseToken,
        claimedAt: wasExpired ? now : parsed.claimedAt,
        heartbeatAt: now,
        expiresAt,
      }),
    );
  }

  if (parsed.expiresAt <= now) {
    return makeLeaseDecision("claim", "lease-expired", makeLease({
      sessionId,
      leaseToken,
      claimedAt: now,
      heartbeatAt: now,
      expiresAt,
    }));
  }

  if (sameSession && sameSessionOwnerConfirmedGone) {
    return makeLeaseDecision("takeover", "same-session-owner-confirmed-gone", makeLease({
      sessionId,
      leaseToken,
      claimedAt: now,
      heartbeatAt: now,
      expiresAt,
    }));
  }

  return makeLeaseDecision(
    "block",
    sameSession
      ? "same-session-owned-by-another-page"
      : "another-session-holds-lease",
  );
}

export function isOnlineSessionLeaseOwner(
  lease,
  { sessionId, leaseToken } = {},
) {
  requireSessionId(sessionId, "sessionId");
  requireSessionId(leaseToken, "leaseToken");
  const parsed = parseOnlineSessionLease(lease);
  return Boolean(
    parsed
      && parsed.sessionId === sessionId
      && parsed.leaseToken === leaseToken,
  );
}

export function getOnlineSessionHeartbeatDecision({
  currentLease,
  sessionId,
  leaseToken,
  now,
  heartbeatIntervalMs = ONLINE_SESSION_LEASE_DEFAULTS.heartbeatIntervalMs,
} = {}) {
  requireSessionId(sessionId, "sessionId");
  requireSessionId(leaseToken, "leaseToken");
  requireTimestamp(now, "now");
  requireDuration(heartbeatIntervalMs, "heartbeatIntervalMs");
  const parsed = parseOnlineSessionLease(currentLease);
  if (!parsed) {
    return frozen({ action: "lost", due: false, reason: "lease-invalid" });
  }
  if (parsed.sessionId !== sessionId || parsed.leaseToken !== leaseToken) {
    return frozen({ action: "lost", due: false, reason: "lease-owner-changed" });
  }
  if (parsed.expiresAt <= now) {
    return frozen({ action: "reacquire", due: false, reason: "lease-expired" });
  }
  if (now - parsed.heartbeatAt < heartbeatIntervalMs) {
    return frozen({ action: "wait", due: false, reason: "heartbeat-not-due" });
  }
  return frozen({ action: "heartbeat", due: true, reason: "heartbeat-due" });
}

/**
 * Classifies one heartbeat callable result without turning a transient network
 * failure or malformed success response into an immediate lease loss.
 */
export function decideOnlineSessionHeartbeatResult({
  responseData = null,
  currentLease,
  sessionId,
  leaseToken,
  sessionGeneration,
  now,
  retryIntervalMs = ONLINE_SESSION_LEASE_DEFAULTS.retryIntervalMs,
} = {}) {
  requireSessionId(sessionId, "sessionId");
  requireSessionId(leaseToken, "leaseToken");
  requireConnectionGeneration(sessionGeneration, "sessionGeneration");
  requireTimestamp(now, "now");
  requireDuration(retryIntervalMs, "retryIntervalMs");
  const current = parseOnlineSessionLease(currentLease);
  if (!current
      || current.sessionId !== sessionId
      || current.leaseToken !== leaseToken) {
    return frozen({
      action: "lost",
      reason: "lease-invalid",
      lease: null,
      retryDelayMs: 0,
    });
  }
  if (isRecord(responseData)
      && responseData.claimed === false
      && responseData.reason === "lease-lost") {
    return frozen({
      action: "lost",
      reason: "lease-lost",
      lease: null,
      retryDelayMs: 0,
    });
  }
  const refreshed = isRecord(responseData)
    && responseData.claimed === true
    && responseData.sessionGeneration === sessionGeneration
    && isOnlineSessionLeaseOwner(responseData.lease, { sessionId, leaseToken })
    ? parseOnlineSessionLease(responseData.lease)
    : null;
  if (refreshed) {
    return frozen({
      action: "refresh",
      reason: "refreshed",
      lease: refreshed,
      retryDelayMs: 0,
    });
  }
  const remainingMs = current.expiresAt - now;
  if (remainingMs <= 0) {
    return frozen({
      action: "lost",
      reason: "lease-expired",
      lease: null,
      retryDelayMs: 0,
    });
  }
  return frozen({
    action: "retry",
    reason: "heartbeat-transient",
    lease: current,
    retryDelayMs: Math.max(1, Math.min(retryIntervalMs, remainingMs)),
  });
}

/**
 * Release compares the complete lease snapshot, not just sessionId/token.
 * Therefore a delayed unload callback cannot delete a lease that has since
 * been refreshed or replaced.
 */
export function decideOnlineSessionLeaseRelease({
  currentLease = null,
  expectedLease,
} = {}) {
  const expected = parseOnlineSessionLease(expectedLease);
  if (!expected) {
    throw new TypeError("expectedLease must be a valid V2 lease snapshot");
  }
  if (currentLease === null || currentLease === undefined) {
    return makeCleanupDecision("noop", "lease-missing", "v2");
  }
  const current = parseOnlineSessionLease(currentLease);
  if (!current) {
    return makeCleanupDecision("preserve", "lease-invalid", null);
  }
  if (!sameLease(current, expected)) {
    return makeCleanupDecision("preserve", "lease-snapshot-changed", "v2");
  }
  return makeCleanupDecision("remove", "exact-lease-owner", "v2");
}

function parseFenceFromRecord(value) {
  if (!isRecord(value)
      || value.protocolVersion !== ONLINE_SESSION_PROTOCOL_VERSION
      || !isValidOnlineSessionId(value.sessionId)
      || !isValidOnlineSessionId(value.leaseToken)
      || !isValidOnlineConnectionGeneration(value.connectionGeneration)) {
    return null;
  }
  return frozen({
    protocolVersion: value.protocolVersion,
    sessionId: value.sessionId,
    leaseToken: value.leaseToken,
    connectionGeneration: value.connectionGeneration,
  });
}

function fencesMatch(left, right) {
  return left.protocolVersion === right.protocolVersion
    && left.sessionId === right.sessionId
    && left.leaseToken === right.leaseToken
    && sameConnectionGeneration(
      left.connectionGeneration,
      right.connectionGeneration,
    );
}

function requireFence(value) {
  const fence = parseFenceFromRecord(value);
  if (!fence) {
    throw new TypeError("fence must contain a valid V2 session resource fence");
  }
  return fence;
}

/**
 * Only the exact page-and-generation owner may delete a V2 queue row.
 * Unscoped legacy rows require an external staleness check and an atomic
 * compare-and-remove transaction.
 */
export function decideOnlineQueueCleanup({
  queueEntry = null,
  fence,
  legacyEntryVerifiedStale = false,
} = {}) {
  const expected = requireFence(fence);
  requireBoolean(legacyEntryVerifiedStale, "legacyEntryVerifiedStale");
  if (queueEntry === null || queueEntry === undefined) {
    return makeCleanupDecision("noop", "queue-entry-missing");
  }
  if (!isRecord(queueEntry)) {
    return makeCleanupDecision("preserve", "queue-entry-invalid");
  }

  if (queueEntry.protocolVersion === ONLINE_SESSION_PROTOCOL_VERSION) {
    const actual = parseFenceFromRecord(queueEntry);
    if (!actual) {
      return makeCleanupDecision("preserve", "queue-v2-fence-invalid", "v2");
    }
    if (!fencesMatch(actual, expected)) {
      return makeCleanupDecision("preserve", "queue-owner-changed", "v2");
    }
    return makeCleanupDecision("remove", "exact-queue-owner", "v2");
  }

  if (hasOwn(queueEntry, "protocolVersion")) {
    return makeCleanupDecision("preserve", "queue-protocol-unsupported");
  }
  if (FENCE_KEYS.some((key) => key !== "protocolVersion" && hasOwn(queueEntry, key))) {
    return makeCleanupDecision("preserve", "queue-unversioned-scope-fields");
  }
  if (!legacyEntryVerifiedStale) {
    return makeCleanupDecision("preserve", "legacy-queue-not-owned", "legacy");
  }
  return makeCleanupDecision("remove", "verified-legacy-queue-stale", "legacy");
}

/**
 * V2 active records are objects containing roomId plus a resource fence.
 * The current production string shape is treated as legacy and removable only
 * when both the room id matches and room terminality was externally verified.
 */
export function decideOnlineActiveCleanup({
  activeEntry = null,
  expectedRoomId,
  fence,
  legacyRoomVerifiedTerminal = false,
} = {}) {
  requireRoomId(expectedRoomId, "expectedRoomId");
  const expected = requireFence(fence);
  requireBoolean(legacyRoomVerifiedTerminal, "legacyRoomVerifiedTerminal");
  if (activeEntry === null || activeEntry === undefined) {
    return makeCleanupDecision("noop", "active-entry-missing");
  }

  if (typeof activeEntry === "string") {
    if (activeEntry !== expectedRoomId) {
      return makeCleanupDecision("preserve", "legacy-active-room-changed", "legacy");
    }
    if (!legacyRoomVerifiedTerminal) {
      return makeCleanupDecision("preserve", "legacy-active-room-not-verified", "legacy");
    }
    return makeCleanupDecision("remove", "verified-legacy-active-terminal", "legacy");
  }

  if (!isRecord(activeEntry)) {
    return makeCleanupDecision("preserve", "active-entry-invalid");
  }
  if (activeEntry.protocolVersion !== ONLINE_SESSION_PROTOCOL_VERSION) {
    return makeCleanupDecision("preserve", hasOwn(activeEntry, "protocolVersion")
      ? "active-protocol-unsupported"
      : "legacy-active-object-unowned");
  }
  if (activeEntry.roomId !== expectedRoomId) {
    return makeCleanupDecision("preserve", "active-room-changed", "v2");
  }
  const actual = parseFenceFromRecord(activeEntry);
  if (!actual) {
    return makeCleanupDecision("preserve", "active-v2-fence-invalid", "v2");
  }
  if (!fencesMatch(actual, expected)) {
    return makeCleanupDecision("preserve", "active-owner-changed", "v2");
  }
  return makeCleanupDecision("remove", "exact-active-owner", "v2");
}

function isUnscopedLegacySignal(envelope) {
  return !hasOwn(envelope, "protocolVersion")
    && SIGNAL_SCOPE_KEYS.every((key) => !hasOwn(envelope, key));
}

/**
 * Returns whether a signal belongs to the current session/generation and when
 * it may be consumed. Ignored signals always have consume="never", allowing
 * the intended tab or generation to process them.
 */
export function decideOnlineSignalEnvelope({
  envelope,
  ownSessionId,
  remoteSessionId = null,
  connectionGeneration,
  isCurrentLeaseOwner,
  allowLegacy = false,
  legacyRoomVerifiedCurrent = false,
} = {}) {
  requireSessionId(ownSessionId, "ownSessionId");
  if (remoteSessionId !== null) {
    requireSessionId(remoteSessionId, "remoteSessionId");
  }
  requireConnectionGeneration(connectionGeneration, "connectionGeneration");
  requireBoolean(isCurrentLeaseOwner, "isCurrentLeaseOwner");
  requireBoolean(allowLegacy, "allowLegacy");
  requireBoolean(legacyRoomVerifiedCurrent, "legacyRoomVerifiedCurrent");

  if (!isRecord(envelope)) {
    return makeSignalDecision({
      action: "ignore",
      reason: "signal-invalid",
    });
  }
  if (!isCurrentLeaseOwner) {
    return makeSignalDecision({
      action: "ignore",
      reason: "session-lease-not-owned",
    });
  }

  if (isUnscopedLegacySignal(envelope)) {
    if (!allowLegacy || !legacyRoomVerifiedCurrent) {
      return makeSignalDecision({
        action: "ignore",
        reason: "legacy-signal-not-explicitly-authorized",
        protocol: "legacy",
      });
    }
    return makeSignalDecision({
      action: "accept",
      reason: "verified-current-legacy-room",
      protocol: "legacy",
    });
  }

  if (envelope.protocolVersion !== ONLINE_SESSION_PROTOCOL_VERSION) {
    return makeSignalDecision({
      action: "ignore",
      reason: hasOwn(envelope, "protocolVersion")
        ? "signal-protocol-unsupported"
        : "signal-unversioned-scope-fields",
    });
  }
  if (!isValidOnlineSessionId(envelope.fromSessionId)
      || !isValidOnlineSessionId(envelope.toSessionId)
      || !isValidOnlineConnectionGeneration(envelope.connectionGeneration)) {
    return makeSignalDecision({
      action: "ignore",
      reason: "signal-v2-scope-invalid",
      protocol: "v2",
    });
  }
  if (envelope.toSessionId !== ownSessionId) {
    return makeSignalDecision({
      action: "ignore",
      reason: "signal-target-session-mismatch",
      protocol: "v2",
      remoteSessionId: envelope.fromSessionId,
    });
  }
  if (!sameConnectionGeneration(
    envelope.connectionGeneration,
    connectionGeneration,
  )) {
    return makeSignalDecision({
      action: "ignore",
      reason: "signal-connection-generation-mismatch",
      protocol: "v2",
      remoteSessionId: envelope.fromSessionId,
    });
  }
  if (remoteSessionId !== null && envelope.fromSessionId !== remoteSessionId) {
    return makeSignalDecision({
      action: "ignore",
      reason: "signal-source-session-mismatch",
      protocol: "v2",
      remoteSessionId: envelope.fromSessionId,
    });
  }
  return makeSignalDecision({
    action: "accept",
    reason: "signal-v2-current",
    protocol: "v2",
    remoteSessionId: envelope.fromSessionId,
  });
}

/**
 * Accepted signals are deleted only after successful handling and a final
 * generation/lease recheck by the caller.
 */
export function shouldConsumeOnlineSignal(
  decision,
  { handledSuccessfully, contextStillCurrent } = {},
) {
  requireBoolean(handledSuccessfully, "handledSuccessfully");
  requireBoolean(contextStillCurrent, "contextStillCurrent");
  return Boolean(
    decision
      && decision.action === "accept"
      && decision.consume === "after-success"
      && handledSuccessfully
      && contextStillCurrent,
  );
}
