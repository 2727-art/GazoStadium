"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CLOUDFLARE_TURN_API_ORIGIN,
  P2P_CONNECTIVITY_PUBLIC_ERROR,
  P2P_DIAGNOSTIC_HASH_HEX_LENGTH,
  TURN_CREDENTIAL_RATE_LIMIT_POLICY,
  TURN_CREDENTIAL_REFRESH_SKEW_SECONDS,
  TURN_CREDENTIAL_TTL_SECONDS,
  cloudflareTurnCredentialRequestBody,
  cloudflareTurnCredentialsUrl,
  createDailyP2PParticipantHash,
  createP2PDiagnosticIdentity,
  createP2PDiagnosticRecord,
  diagnosticDateKey,
  p2pDiagnosticCleanupMarkerRollbackValue,
  p2pDiagnosticRetentionCutoffDay,
  p2pConnectivityRateLimitDecision,
  safeP2PConnectivityError,
  selectExpiredP2PDiagnosticDayKeys,
  sanitizeP2PDiagnosticPayload,
  validateCloudflareTurnCredentialResponse,
} = require("../p2p-connectivity");

const TURN_KEY_ID = "0123456789abcdef0123456789abcdef";
const HMAC_SECRET = "test-only-secret-that-is-at-least-thirty-two-bytes";
const NOW = Date.parse("2026-07-25T03:00:00.000Z");
const VALID_CLOUDFLARE_RESPONSE = Object.freeze({
  iceServers: [
    {
      urls: [
        "stun:stun.cloudflare.com:3478",
        "stun:stun.cloudflare.com:53",
      ],
    },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turn:turn.cloudflare.com:80?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "a".repeat(96),
      credential: "b".repeat(96),
    },
  ],
});

function validateResponse(overrides = {}) {
  return validateCloudflareTurnCredentialResponse({
    status: 201,
    contentType: "application/json; charset=utf-8",
    payload: VALID_CLOUDFLARE_RESPONSE,
    now: NOW,
    ...overrides,
  });
}

test("Cloudflare TURN endpoint and TTL request are fixed and contain no secret", () => {
  assert.equal(
    cloudflareTurnCredentialsUrl(TURN_KEY_ID),
    `${CLOUDFLARE_TURN_API_ORIGIN}/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`,
  );
  assert.deepEqual(cloudflareTurnCredentialRequestBody(), {
    ttl: TURN_CREDENTIAL_TTL_SECONDS,
  });
  assert.equal(Object.isFrozen(cloudflareTurnCredentialRequestBody()), true);
  assert.throws(() => cloudflareTurnCredentialsUrl("../credentials/revoke"), TypeError);
  assert.throws(() => cloudflareTurnCredentialsUrl(`${TURN_KEY_ID}?token=secret`), TypeError);
});

test("Cloudflare TURN response is strictly normalized with server-side expiry", () => {
  const result = validateResponse();
  assert.deepEqual(result.iceServers, VALID_CLOUDFLARE_RESPONSE.iceServers);
  assert.equal(result.ttlSeconds, TURN_CREDENTIAL_TTL_SECONDS);
  assert.equal(result.issuedAt, NOW);
  assert.equal(result.refreshAt, NOW
    + ((TURN_CREDENTIAL_TTL_SECONDS - TURN_CREDENTIAL_REFRESH_SKEW_SECONDS) * 1000));
  assert.equal(result.expiresAt, NOW + (TURN_CREDENTIAL_TTL_SECONDS * 1000));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.iceServers), true);
  assert.equal(Object.isFrozen(result.iceServers[1].urls), true);
});

test("Cloudflare TURN response rejects status, content type, extra data, and untrusted urls", () => {
  assert.throws(() => validateResponse({ status: 200 }), TypeError);
  assert.throws(() => validateResponse({ contentType: "text/html" }), TypeError);
  assert.throws(() => validateResponse({
    payload: { ...VALID_CLOUDFLARE_RESPONSE, token: "must-not-pass" },
  }), TypeError);
  assert.throws(() => validateResponse({
    payload: {
      iceServers: [
        VALID_CLOUDFLARE_RESPONSE.iceServers[0],
        {
          ...VALID_CLOUDFLARE_RESPONSE.iceServers[1],
          urls: ["turn:attacker.example:3478?transport=udp"],
        },
      ],
    },
  }), TypeError);
  assert.throws(() => validateResponse({
    payload: {
      iceServers: [
        VALID_CLOUDFLARE_RESPONSE.iceServers[0],
        {
          urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
          username: "a".repeat(96),
        },
      ],
    },
  }), TypeError);
  assert.throws(() => validateResponse({
    payload: {
      iceServers: [{
        urls: ["stun:stun.cloudflare.com:3478"],
      }, {
        ...VALID_CLOUDFLARE_RESPONSE.iceServers[1],
        internal: "must-not-pass",
      }],
    },
  }), TypeError);
});

test("safe connectivity errors never expose upstream bodies, secrets, or stack text", () => {
  const secret = "TURN_API_TOKEN_DO_NOT_EXPOSE";
  const error = Object.assign(new Error(`upstream body contains ${secret}`), {
    status: 503,
    code: "UPSTREAM_SECRET_CODE",
    response: { body: secret },
  });
  const safe = safeP2PConnectivityError(error, "turn_response");
  assert.deepEqual(safe, {
    stage: "turn_response",
    category: "upstream_http",
    status: 503,
  });
  assert.equal(JSON.stringify(safe).includes(secret), false);
  assert.equal(JSON.stringify(P2P_CONNECTIVITY_PUBLIC_ERROR).includes(secret), false);
  assert.deepEqual(safeP2PConnectivityError({
    name: "AbortError",
    message: secret,
  }, "turn_request"), {
    stage: "turn_request",
    category: "timeout",
    status: 0,
  });
  assert.equal(safeP2PConnectivityError(error, secret).stage, "unknown");
});

test("anonymous diagnostics retain only connection state, candidate type, transport, and timing", () => {
  assert.deepEqual(sanitizeP2PDiagnosticPayload({
    event: "channel_open",
    phase: "select",
    turnAvailable: true,
    connectionState: "connected",
    iceConnectionState: "completed",
    iceGatheringState: "complete",
    candidateType: "relay",
    transport: "tcp",
    attempt: 1,
    elapsedMs: 12_345,
    gatheringMs: 2_000,
    connectionMs: 12_000,
    disconnectedMs: 0,
  }), {
    schemaVersion: 1,
    event: "channel_open",
    phase: "select",
    turnAvailable: true,
    connectionState: "connected",
    iceConnectionState: "completed",
    iceGatheringState: "complete",
    candidateType: "relay",
    transport: "tcp",
    attempt: 1,
    elapsedMs: 12_345,
    gatheringMs: 2_000,
    connectionMs: 12_000,
    disconnectedMs: 0,
  });
});

test("free-table diagnostics use the shared sanitized schema", () => {
  assert.deepEqual(sanitizeP2PDiagnosticPayload({
    event: "connection_timeout",
    phase: "free_table",
    turnAvailable: true,
    connectionState: "connecting",
    iceConnectionState: "checking",
    attempt: 2,
    elapsedMs: 35_000,
  }), {
    schemaVersion: 1,
    event: "connection_timeout",
    phase: "free_table",
    turnAvailable: true,
    connectionState: "connecting",
    iceConnectionState: "checking",
    attempt: 2,
    elapsedMs: 35_000,
  });
});

test("anonymous diagnostics reject raw IP, SDP, ICE candidate, identity, and arbitrary fields", () => {
  const base = {
    event: "ice_failed",
    phase: "connecting",
    turnAvailable: false,
    connectionState: "failed",
    iceConnectionState: "failed",
  };
  for (const forbidden of [
    { ip: "203.0.113.4" },
    { address: "2001:db8::1" },
    { sdp: "v=0\r\no=- 0 0 IN IP4 203.0.113.4" },
    { candidate: "candidate:1 1 UDP 1 203.0.113.4 3478 typ host" },
    { localCandidate: { address: "203.0.113.4" } },
    { remoteCandidate: "candidate:secret" },
    { uid: "private-firebase-uid" },
    { userAgent: "private browser fingerprint" },
    { iceServers: VALID_CLOUDFLARE_RESPONSE.iceServers },
    { unexpected: "not allowed" },
  ]) {
    assert.throws(() => sanitizeP2PDiagnosticPayload({
      ...base,
      ...forbidden,
    }), TypeError);
  }
  assert.throws(() => sanitizeP2PDiagnosticPayload({
    candidateType: "relay",
    transport: "udp",
  }), TypeError);
  assert.throws(() => sanitizeP2PDiagnosticPayload({
    ...base,
    event: "raw_candidate",
  }), TypeError);
  assert.throws(() => sanitizeP2PDiagnosticPayload({
    ...base,
    phase: "private_room",
  }), TypeError);
  assert.throws(() => sanitizeP2PDiagnosticPayload({
    ...base,
    turnAvailable: "yes",
  }), TypeError);
  assert.throws(() => sanitizeP2PDiagnosticPayload({
    ...base,
    candidateType: "private",
  }), TypeError);
  assert.throws(() => sanitizeP2PDiagnosticPayload({
    ...base,
    elapsedMs: 999_999_999,
  }), TypeError);
});

test("daily participant, session, and room HMACs are deterministic but unlinkable by raw id", () => {
  const input = {
    uid: "firebaseAnonymousUid123456",
    sessionId: "b735c15e-5d68-4b61-8334-4f3bff21f509",
    roomId: "-OT8P2p2Wm06zABCDEF1",
    hmacSecret: HMAC_SECRET,
    now: NOW,
  };
  const identity = createP2PDiagnosticIdentity(input);
  assert.deepEqual(createP2PDiagnosticIdentity(input), identity);
  assert.equal(identity.day, "2026-07-25");
  for (const hash of [
    identity.participantHash,
    identity.sessionHash,
    identity.roomHash,
  ]) {
    assert.match(hash, new RegExp(`^[a-f0-9]{${P2P_DIAGNOSTIC_HASH_HEX_LENGTH}}$`));
    assert.equal(JSON.stringify(identity).includes(input.uid), false);
    assert.equal(JSON.stringify(identity).includes(input.sessionId), false);
    assert.equal(JSON.stringify(identity).includes(input.roomId), false);
  }
  assert.equal(
    createDailyP2PParticipantHash(input.uid, HMAC_SECRET, NOW),
    identity.participantHash,
  );
  assert.notEqual(createP2PDiagnosticIdentity({
    ...input,
    sessionId: "c845c15e-5d68-4b61-8334-4f3bff21f509",
  }).sessionHash, identity.sessionHash);
  assert.notEqual(createP2PDiagnosticIdentity({
    ...input,
    roomId: "-OT8P2p2Wm06zABCDEG2",
  }).roomHash, identity.roomHash);
});

test("diagnostic HMAC day rotates at JST midnight", () => {
  const beforeMidnight = Date.parse("2026-07-25T14:59:59.999Z");
  const atMidnight = Date.parse("2026-07-25T15:00:00.000Z");
  assert.equal(diagnosticDateKey(beforeMidnight), "2026-07-25");
  assert.equal(diagnosticDateKey(atMidnight), "2026-07-26");
  assert.notEqual(
    createDailyP2PParticipantHash("firebaseAnonymousUid123456", HMAC_SECRET, beforeMidnight),
    createDailyP2PParticipantHash("firebaseAnonymousUid123456", HMAC_SECRET, atMidnight),
  );
});

test("diagnostic retention cutoff follows JST days without deleting the cutoff day", () => {
  const beforeMidnight = Date.parse("2026-07-25T14:59:59.999Z");
  const atMidnight = Date.parse("2026-07-25T15:00:00.000Z");
  assert.equal(p2pDiagnosticRetentionCutoffDay(beforeMidnight), "2026-07-11");
  assert.equal(p2pDiagnosticRetentionCutoffDay(atMidnight), "2026-07-12");
  assert.deepEqual(
    selectExpiredP2PDiagnosticDayKeys([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ], { now: beforeMidnight }),
    ["2026-07-10"],
  );
});

test("diagnostic cleanup selects only valid older day keys in a bounded stable order", () => {
  const result = selectExpiredP2PDiagnosticDayKeys([
    "2026-07-10",
    "2026-07-08",
    "2026-07-09",
    "2026-07-08",
    "2026-07-11",
    "2026-02-30",
    "not-a-day",
    "2025-12-31/raw",
  ], {
    now: NOW,
    maximum: 2,
  });
  assert.deepEqual(result, ["2026-07-08", "2026-07-09"]);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(
    () => selectExpiredP2PDiagnosticDayKeys("2026-07-10", { now: NOW }),
    TypeError,
  );
  assert.throws(
    () => selectExpiredP2PDiagnosticDayKeys([], { now: NOW, maximum: 100 }),
    TypeError,
  );
});

test("diagnostic cleanup rollback restores only the marker owned by the failed run", () => {
  const previous = {
    lastStartedAt: NOW - 86_400_000,
    lastCompletedAt: NOW - 86_399_000,
    removedDayCount: 3,
  };
  assert.deepEqual(
    p2pDiagnosticCleanupMarkerRollbackValue(
      { lastStartedAt: NOW, lastCompletedAt: 0, removedDayCount: 3 },
      NOW,
      previous,
    ),
    previous,
  );
  assert.equal(
    p2pDiagnosticCleanupMarkerRollbackValue(
      { lastStartedAt: NOW + 1, lastCompletedAt: 0, removedDayCount: 0 },
      NOW,
      previous,
    ),
    undefined,
  );
  assert.equal(
    p2pDiagnosticCleanupMarkerRollbackValue(null, NOW, previous),
    undefined,
  );
  assert.equal(
    p2pDiagnosticCleanupMarkerRollbackValue(
      { lastStartedAt: NOW, lastCompletedAt: 0, removedDayCount: 0 },
      NOW,
      null,
    ),
    null,
  );
  assert.throws(
    () => p2pDiagnosticCleanupMarkerRollbackValue({}, Number.NaN, previous),
    TypeError,
  );
});

test("diagnostic records contain hashes and sanitized values but no raw identifiers", () => {
  const record = createP2PDiagnosticRecord({
    uid: "firebaseAnonymousUid123456",
    sessionId: "b735c15e-5d68-4b61-8334-4f3bff21f509",
    roomId: "-OT8P2p2Wm06zABCDEF1",
    hmacSecret: HMAC_SECRET,
    now: NOW,
    payload: {
      event: "ice_failed",
      phase: "connecting",
      turnAvailable: false,
      connectionState: "failed",
      iceConnectionState: "failed",
      candidateType: "none",
      transport: "none",
      attempt: 2,
      elapsedMs: 25_000,
    },
  });
  assert.equal(record.recordedAt, NOW);
  assert.equal(record.connectionState, "failed");
  assert.equal(record.iceConnectionState, "failed");
  assert.equal(Object.hasOwn(record, "uid"), false);
  assert.equal(Object.hasOwn(record, "sessionId"), false);
  assert.equal(Object.hasOwn(record, "roomId"), false);
  assert.equal(JSON.stringify(record).includes("firebaseAnonymousUid123456"), false);
  assert.equal(JSON.stringify(record).includes("-OT8P2p2Wm06zABCDEF1"), false);
});

test("rate-limit decision is pure, bounded, and resets after a block", () => {
  const policy = { windowMs: 1_000, limit: 2, blockMs: 5_000 };
  const empty = {};
  const first = p2pConnectivityRateLimitDecision(empty, 10_000, policy);
  assert.deepEqual(empty, {});
  assert.deepEqual(first, {
    action: "allow",
    allowed: true,
    retryAfterMs: 0,
    state: {
      windowStartedAt: 10_000,
      count: 1,
      blockedUntil: 0,
    },
  });
  const second = p2pConnectivityRateLimitDecision(first.state, 10_100, policy);
  assert.equal(second.allowed, true);
  assert.equal(second.state.count, 2);
  const denied = p2pConnectivityRateLimitDecision(second.state, 10_200, policy);
  assert.deepEqual(denied, {
    action: "rate_limited",
    allowed: false,
    retryAfterMs: 5_000,
    state: {
      windowStartedAt: 10_000,
      count: 2,
      blockedUntil: 15_200,
    },
  });
  assert.equal(p2pConnectivityRateLimitDecision(denied.state, 12_000, policy).retryAfterMs, 3_200);
  assert.deepEqual(p2pConnectivityRateLimitDecision(denied.state, 15_200, policy).state, {
    windowStartedAt: 15_200,
    count: 1,
    blockedUntil: 0,
  });
  assert.equal(TURN_CREDENTIAL_RATE_LIMIT_POLICY.limit >= 2, true);
});
