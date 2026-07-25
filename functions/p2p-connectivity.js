"use strict";

const crypto = require("node:crypto");

const CLOUDFLARE_TURN_API_ORIGIN = "https://rtc.live.cloudflare.com";
const CLOUDFLARE_TURN_KEY_ID_PATTERN = /^[a-f0-9]{32}$/i;
const TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;
const TURN_CREDENTIAL_REFRESH_SKEW_SECONDS = 5 * 60;
const TURN_CREDENTIAL_REQUEST_TIMEOUT_MS = 8_000;
const P2P_DIAGNOSTIC_SCHEMA_VERSION = 1;
const P2P_DIAGNOSTIC_HASH_HEX_LENGTH = 40;
const P2P_DIAGNOSTIC_MAX_TIMING_MS = 10 * 60 * 1000;
const P2P_DIAGNOSTIC_TIME_ZONE = "Asia/Tokyo";
const P2P_DIAGNOSTIC_RETENTION_DAYS = 14;
const P2P_DIAGNOSTIC_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const P2P_DIAGNOSTIC_CLEANUP_MAX_DAYS = 8;
const P2P_CONNECTIVITY_PUBLIC_ERROR = Object.freeze({
  code: "unavailable",
  message: "P2P接続情報を準備できませんでした。時間をおいてもう一度お試しください。",
});
const TURN_CREDENTIAL_RATE_LIMIT_POLICY = Object.freeze({
  windowMs: 60 * 1000,
  limit: 4,
  blockMs: 5 * 60 * 1000,
});
const P2P_DIAGNOSTIC_RATE_LIMIT_POLICY = Object.freeze({
  windowMs: 60 * 1000,
  limit: 24,
  blockMs: 5 * 60 * 1000,
});

const CLOUDFLARE_TURN_URL_PATTERNS = Object.freeze([
  /^stun:stun\.cloudflare\.com:(?:3478|53)$/,
  /^turn:turn\.cloudflare\.com:(?:3478|53)\?transport=udp$/,
  /^turn:turn\.cloudflare\.com:(?:3478|53|80)\?transport=tcp$/,
  /^turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp$/,
]);
const CONNECTION_STATES = new Set([
  "new",
  "connecting",
  "connected",
  "disconnected",
  "failed",
  "closed",
  "unknown",
]);
const ICE_CONNECTION_STATES = new Set([
  "new",
  "checking",
  "connected",
  "completed",
  "disconnected",
  "failed",
  "closed",
  "unknown",
]);
const ICE_GATHERING_STATES = new Set([
  "new",
  "gathering",
  "complete",
  "unknown",
]);
const CANDIDATE_TYPES = new Set([
  "host",
  "srflx",
  "prflx",
  "relay",
  "none",
  "unknown",
]);
const TRANSPORTS = new Set([
  "udp",
  "tcp",
  "tls",
  "none",
  "unknown",
]);
const P2P_DIAGNOSTIC_EVENTS = new Set([
  "peer_created",
  "turn_unavailable",
  "connection_timeout",
  "ice_disconnected",
  "ice_failed",
  "restart_started",
  "restart_timeout",
  "channel_open",
  "cleanup",
]);
const P2P_DIAGNOSTIC_PHASES = new Set([
  "matchmaking",
  "signaling",
  "connecting",
  "select",
  "battle",
  "result",
  "cleanup",
  "unknown",
]);
const P2P_DIAGNOSTIC_INPUT_KEYS = new Set([
  "event",
  "phase",
  "turnAvailable",
  "connectionState",
  "iceConnectionState",
  "iceGatheringState",
  "candidateType",
  "transport",
  "attempt",
  "elapsedMs",
  "gatheringMs",
  "connectionMs",
  "disconnectedMs",
]);
const P2P_ERROR_STAGES = new Set([
  "turn_request",
  "turn_response",
  "diagnostic_write",
  "retention_cleanup",
  "rate_limit",
]);
const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowedKeys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.has(key))) {
    throw new TypeError(`${label} contains unsupported fields`);
  }
}

function requireTimestamp(value, label = "timestamp") {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new TypeError(`${label} must be a non-negative timestamp`);
  }
  return Math.floor(timestamp);
}

function cloudflareTurnCredentialsUrl(turnKeyId) {
  const keyId = String(turnKeyId || "").trim();
  if (!CLOUDFLARE_TURN_KEY_ID_PATTERN.test(keyId)) {
    throw new TypeError("Cloudflare TURN key id is invalid");
  }
  return `${CLOUDFLARE_TURN_API_ORIGIN}/v1/turn/keys/${keyId}/credentials/generate-ice-servers`;
}

function cloudflareTurnCredentialRequestBody() {
  return Object.freeze({ ttl: TURN_CREDENTIAL_TTL_SECONDS });
}

function isAllowedCloudflareTurnUrl(value) {
  return typeof value === "string"
    && CLOUDFLARE_TURN_URL_PATTERNS.some((pattern) => pattern.test(value));
}

function requireCredentialToken(value, label) {
  if (typeof value !== "string"
      || value.length < 8
      || value.length > 1024
      || !/^[\x21-\x7e]+$/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeCloudflareIceServer(value, seenUrls) {
  assertExactKeys(value, new Set(["urls", "username", "credential"]), "TURN ice server");
  if (!Array.isArray(value.urls) || value.urls.length < 1 || value.urls.length > 12) {
    throw new TypeError("TURN ice server urls are invalid");
  }
  const urls = value.urls.map((url) => {
    if (!isAllowedCloudflareTurnUrl(url) || seenUrls.has(url)) {
      throw new TypeError("TURN ice server url is invalid");
    }
    seenUrls.add(url);
    return url;
  });
  const hasStunUrl = urls.some((url) => url.startsWith("stun:"));
  const hasTurnUrl = urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  if (hasStunUrl === hasTurnUrl) {
    throw new TypeError("TURN ice server must not mix STUN and TURN urls");
  }
  if (hasTurnUrl) {
    return Object.freeze({
      urls: Object.freeze(urls),
      username: requireCredentialToken(value.username, "TURN username"),
      credential: requireCredentialToken(value.credential, "TURN credential"),
    });
  }
  if (Object.hasOwn(value, "username") || Object.hasOwn(value, "credential")) {
    throw new TypeError("STUN ice server must not contain credentials");
  }
  return Object.freeze({ urls: Object.freeze(urls) });
}

function validateCloudflareTurnCredentialResponse({
  status,
  contentType,
  payload,
  now = Date.now(),
} = {}) {
  if (status !== 201) throw new TypeError("Cloudflare TURN response status is invalid");
  if (typeof contentType !== "string"
      || !/^\s*application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new TypeError("Cloudflare TURN response content type is invalid");
  }
  assertExactKeys(payload, new Set(["iceServers"]), "Cloudflare TURN response");
  if (!Array.isArray(payload.iceServers)
      || payload.iceServers.length < 2
      || payload.iceServers.length > 4) {
    throw new TypeError("Cloudflare TURN response iceServers are invalid");
  }
  const seenUrls = new Set();
  const iceServers = payload.iceServers.map((server) => normalizeCloudflareIceServer(server, seenUrls));
  const urls = iceServers.flatMap((server) => server.urls);
  if (!urls.some((url) => url.startsWith("stun:"))
      || !urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"))) {
    throw new TypeError("Cloudflare TURN response requires STUN and TURN urls");
  }
  const issuedAt = requireTimestamp(now);
  return Object.freeze({
    iceServers: Object.freeze(iceServers),
    ttlSeconds: TURN_CREDENTIAL_TTL_SECONDS,
    issuedAt,
    refreshAt: issuedAt
      + ((TURN_CREDENTIAL_TTL_SECONDS - TURN_CREDENTIAL_REFRESH_SKEW_SECONDS) * 1000),
    expiresAt: issuedAt + (TURN_CREDENTIAL_TTL_SECONDS * 1000),
  });
}

function safeP2PConnectivityError(error, stage = "unknown") {
  const safeStage = P2P_ERROR_STAGES.has(stage) ? stage : "unknown";
  const possibleStatus = Number(error?.status ?? error?.statusCode);
  const status = Number.isInteger(possibleStatus)
    && possibleStatus >= 400
    && possibleStatus <= 599
    ? possibleStatus
    : 0;
  const name = typeof error?.name === "string" ? error.name : "";
  const code = typeof error?.code === "string" ? error.code : "";
  let category = "unknown";
  if (name === "AbortError" || code === "ABORT_ERR") category = "timeout";
  else if (status) category = "upstream_http";
  else if (name === "SyntaxError" || name === "TypeError") category = "invalid_response";
  else if (NETWORK_ERROR_CODES.has(code)) category = "network";
  return Object.freeze({ stage: safeStage, category, status });
}

function sanitizeEnumField(payload, key, allowed, output) {
  if (!Object.hasOwn(payload, key)) return;
  if (typeof payload[key] !== "string" || !allowed.has(payload[key])) {
    throw new TypeError(`P2P diagnostic ${key} is invalid`);
  }
  output[key] = payload[key];
}

function sanitizeIntegerField(payload, key, min, max, output) {
  if (!Object.hasOwn(payload, key)) return;
  const value = payload[key];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`P2P diagnostic ${key} is invalid`);
  }
  output[key] = value;
}

function sanitizeP2PDiagnosticPayload(payload) {
  assertExactKeys(payload, P2P_DIAGNOSTIC_INPUT_KEYS, "P2P diagnostic payload");
  if (!Object.hasOwn(payload, "event")
      || !Object.hasOwn(payload, "phase")
      || !Object.hasOwn(payload, "turnAvailable")
      || (!Object.hasOwn(payload, "connectionState")
      && !Object.hasOwn(payload, "iceConnectionState"))) {
    throw new TypeError("P2P diagnostic payload requires event, phase, TURN availability, and a connection state");
  }
  const output = { schemaVersion: P2P_DIAGNOSTIC_SCHEMA_VERSION };
  sanitizeEnumField(payload, "event", P2P_DIAGNOSTIC_EVENTS, output);
  sanitizeEnumField(payload, "phase", P2P_DIAGNOSTIC_PHASES, output);
  if (typeof payload.turnAvailable !== "boolean") {
    throw new TypeError("P2P diagnostic turnAvailable is invalid");
  }
  output.turnAvailable = payload.turnAvailable;
  sanitizeEnumField(payload, "connectionState", CONNECTION_STATES, output);
  sanitizeEnumField(payload, "iceConnectionState", ICE_CONNECTION_STATES, output);
  sanitizeEnumField(payload, "iceGatheringState", ICE_GATHERING_STATES, output);
  sanitizeEnumField(payload, "candidateType", CANDIDATE_TYPES, output);
  sanitizeEnumField(payload, "transport", TRANSPORTS, output);
  sanitizeIntegerField(payload, "attempt", 0, 3, output);
  sanitizeIntegerField(payload, "elapsedMs", 0, P2P_DIAGNOSTIC_MAX_TIMING_MS, output);
  sanitizeIntegerField(payload, "gatheringMs", 0, P2P_DIAGNOSTIC_MAX_TIMING_MS, output);
  sanitizeIntegerField(payload, "connectionMs", 0, P2P_DIAGNOSTIC_MAX_TIMING_MS, output);
  sanitizeIntegerField(payload, "disconnectedMs", 0, P2P_DIAGNOSTIC_MAX_TIMING_MS, output);
  return Object.freeze(output);
}

function diagnosticDateKey(now = Date.now()) {
  const timestamp = requireTimestamp(now);
  return new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function p2pDiagnosticRetentionCutoffDay(
  now = Date.now(),
  retentionDays = P2P_DIAGNOSTIC_RETENTION_DAYS,
) {
  const timestamp = requireTimestamp(now);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    throw new TypeError("P2P diagnostic retention days are invalid");
  }
  return diagnosticDateKey(timestamp - (retentionDays * 24 * 60 * 60 * 1000));
}

function isValidDiagnosticDayKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function selectExpiredP2PDiagnosticDayKeys(
  dayKeys,
  {
    now = Date.now(),
    retentionDays = P2P_DIAGNOSTIC_RETENTION_DAYS,
    maximum = P2P_DIAGNOSTIC_CLEANUP_MAX_DAYS,
  } = {},
) {
  if (!Array.isArray(dayKeys)) {
    throw new TypeError("P2P diagnostic day keys must be an array");
  }
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 31) {
    throw new TypeError("P2P diagnostic cleanup maximum is invalid");
  }
  const cutoffDay = p2pDiagnosticRetentionCutoffDay(now, retentionDays);
  return Object.freeze(
    [...new Set(dayKeys)]
      .filter((day) => isValidDiagnosticDayKey(day) && day < cutoffDay)
      .sort()
      .slice(0, maximum),
  );
}

function requireDiagnosticIdentifier(value, label) {
  if (typeof value !== "string"
      || value.length < 8
      || value.length > 160
      || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireHmacSecret(value) {
  const secret = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : typeof value === "string"
      ? Buffer.from(value, "utf8")
      : null;
  if (!secret || secret.length < 32) {
    throw new TypeError("P2P diagnostic HMAC secret must contain at least 32 bytes");
  }
  return secret;
}

function diagnosticHmac(secret, value) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("hex")
    .slice(0, P2P_DIAGNOSTIC_HASH_HEX_LENGTH);
}

function createDailyP2PParticipantHash(uid, hmacSecret, now = Date.now()) {
  const participantUid = requireDiagnosticIdentifier(uid, "P2P participant uid");
  const day = diagnosticDateKey(now);
  const secret = requireHmacSecret(hmacSecret);
  return diagnosticHmac(secret, `p2p-connectivity:participant:v1:${day}:${participantUid}`);
}

function createP2PDiagnosticIdentity({
  uid,
  sessionId,
  roomId,
  hmacSecret,
  now = Date.now(),
} = {}) {
  const participantUid = requireDiagnosticIdentifier(uid, "P2P participant uid");
  const clientSessionId = requireDiagnosticIdentifier(sessionId, "P2P client session id");
  const battleRoomId = requireDiagnosticIdentifier(roomId, "P2P room id");
  const day = diagnosticDateKey(now);
  const secret = requireHmacSecret(hmacSecret);
  return Object.freeze({
    day,
    participantHash: diagnosticHmac(
      secret,
      `p2p-connectivity:participant:v1:${day}:${participantUid}`,
    ),
    sessionHash: diagnosticHmac(
      secret,
      `p2p-connectivity:session:v1:${day}:${participantUid}:${clientSessionId}`,
    ),
    roomHash: diagnosticHmac(
      secret,
      `p2p-connectivity:room:v1:${day}:${battleRoomId}`,
    ),
  });
}

function createP2PDiagnosticRecord({
  uid,
  sessionId,
  roomId,
  hmacSecret,
  payload,
  now = Date.now(),
} = {}) {
  const recordedAt = requireTimestamp(now);
  const identity = createP2PDiagnosticIdentity({
    uid,
    sessionId,
    roomId,
    hmacSecret,
    now: recordedAt,
  });
  const diagnostic = sanitizeP2PDiagnosticPayload(payload);
  return Object.freeze({
    ...identity,
    ...diagnostic,
    recordedAt,
  });
}

function validateRateLimitPolicy(policy) {
  assertExactKeys(policy, new Set(["windowMs", "limit", "blockMs"]), "rate limit policy");
  if (!Number.isInteger(policy.windowMs) || policy.windowMs < 1
      || !Number.isInteger(policy.limit) || policy.limit < 1
      || !Number.isInteger(policy.blockMs) || policy.blockMs < 0) {
    throw new TypeError("rate limit policy is invalid");
  }
  return policy;
}

function normalizedRateLimitState(value) {
  if (!isPlainObject(value)) return { windowStartedAt: 0, count: 0, blockedUntil: 0 };
  return {
    windowStartedAt: Number.isFinite(Number(value.windowStartedAt))
      ? Math.max(0, Math.floor(Number(value.windowStartedAt)))
      : 0,
    count: Number.isInteger(Number(value.count))
      ? Math.max(0, Number(value.count))
      : 0,
    blockedUntil: Number.isFinite(Number(value.blockedUntil))
      ? Math.max(0, Math.floor(Number(value.blockedUntil)))
      : 0,
  };
}

function p2pConnectivityRateLimitDecision(
  currentValue,
  now,
  policy = TURN_CREDENTIAL_RATE_LIMIT_POLICY,
) {
  const timestamp = requireTimestamp(now);
  const limits = validateRateLimitPolicy(policy);
  const current = normalizedRateLimitState(currentValue);
  if (current.blockedUntil > timestamp) {
    return Object.freeze({
      action: "rate_limited",
      allowed: false,
      retryAfterMs: current.blockedUntil - timestamp,
      state: Object.freeze(current),
    });
  }
  const windowExpired = current.windowStartedAt < 1
    || current.windowStartedAt > timestamp
    || current.windowStartedAt + limits.windowMs <= timestamp
    || (current.blockedUntil > 0 && current.blockedUntil <= timestamp);
  const state = windowExpired
    ? { windowStartedAt: timestamp, count: 0, blockedUntil: 0 }
    : { ...current, blockedUntil: 0 };
  if (state.count >= limits.limit) {
    state.blockedUntil = limits.blockMs > 0
      ? timestamp + limits.blockMs
      : state.windowStartedAt + limits.windowMs;
    return Object.freeze({
      action: "rate_limited",
      allowed: false,
      retryAfterMs: Math.max(0, state.blockedUntil - timestamp),
      state: Object.freeze(state),
    });
  }
  state.count += 1;
  return Object.freeze({
    action: "allow",
    allowed: true,
    retryAfterMs: 0,
    state: Object.freeze(state),
  });
}

function p2pDiagnosticCleanupMarkerRollbackValue(
  currentValue,
  startedAt,
  previousValue,
) {
  const expectedStartedAt = requireTimestamp(startedAt);
  if (!isPlainObject(currentValue)
      || Number(currentValue.lastStartedAt) !== expectedStartedAt) return undefined;
  return previousValue == null ? null : previousValue;
}

module.exports = Object.freeze({
  CLOUDFLARE_TURN_API_ORIGIN,
  CLOUDFLARE_TURN_KEY_ID_PATTERN,
  P2P_CONNECTIVITY_PUBLIC_ERROR,
  P2P_DIAGNOSTIC_HASH_HEX_LENGTH,
  P2P_DIAGNOSTIC_CLEANUP_INTERVAL_MS,
  P2P_DIAGNOSTIC_CLEANUP_MAX_DAYS,
  P2P_DIAGNOSTIC_MAX_TIMING_MS,
  P2P_DIAGNOSTIC_RATE_LIMIT_POLICY,
  P2P_DIAGNOSTIC_RETENTION_DAYS,
  P2P_DIAGNOSTIC_SCHEMA_VERSION,
  P2P_DIAGNOSTIC_TIME_ZONE,
  TURN_CREDENTIAL_RATE_LIMIT_POLICY,
  TURN_CREDENTIAL_REFRESH_SKEW_SECONDS,
  TURN_CREDENTIAL_REQUEST_TIMEOUT_MS,
  TURN_CREDENTIAL_TTL_SECONDS,
  cloudflareTurnCredentialRequestBody,
  cloudflareTurnCredentialsUrl,
  createDailyP2PParticipantHash,
  createP2PDiagnosticIdentity,
  createP2PDiagnosticRecord,
  diagnosticDateKey,
  p2pDiagnosticRetentionCutoffDay,
  p2pDiagnosticCleanupMarkerRollbackValue,
  p2pConnectivityRateLimitDecision,
  safeP2PConnectivityError,
  selectExpiredP2PDiagnosticDayKeys,
  sanitizeP2PDiagnosticPayload,
  validateCloudflareTurnCredentialResponse,
});
