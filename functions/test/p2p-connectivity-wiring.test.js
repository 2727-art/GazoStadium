"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const rollout = require("../app-check-rollout");

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("P2P callables are authenticated and always App Check enforced", () => {
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.getP2pIceServers, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.reportP2pConnectivity, true);

  const turnCallable = sourceBetween(
    "exports.getP2pIceServers",
    "exports.reportP2pConnectivity",
  );
  const diagnosticCallable = sourceBetween(
    "exports.reportP2pConnectivity",
    "function cleanText",
  );
  assert.match(turnCallable, /const uid = requireUid\(request\)/);
  assert.match(diagnosticCallable, /const uid = requireUid\(request\)/);
  assert.match(
    turnCallable,
    /callableOptions\("getP2pIceServers", \[\s*CLOUDFLARE_TURN_KEY_ID,\s*CLOUDFLARE_TURN_API_TOKEN,\s*\]\)/,
  );
  assert.match(
    diagnosticCallable,
    /callableOptions\("reportP2pConnectivity", \[P2P_DIAGNOSTIC_HMAC_SECRET\]\)/,
  );
  assert.doesNotMatch(turnCallable, /P2P_DIAGNOSTIC_HMAC_SECRET/);
  assert.doesNotMatch(diagnosticCallable, /CLOUDFLARE_TURN_(?:KEY_ID|API_TOKEN)/);
});

test("TURN credential proxy is bounded, validated, and returns only client ICE metadata", () => {
  const requestHelper = sourceBetween(
    "async function requestCloudflareTurnIceServers",
    "exports.getP2pIceServers",
  );
  const turnCallable = sourceBetween(
    "exports.getP2pIceServers",
    "exports.reportP2pConnectivity",
  );
  assert.match(requestHelper, /new AbortController\(\)/);
  assert.match(requestHelper, /TURN_CREDENTIAL_REQUEST_TIMEOUT_MS/);
  assert.match(requestHelper, /method: "POST"/);
  assert.match(requestHelper, /Authorization: `Bearer \$\{apiToken\}`/);
  assert.match(requestHelper, /cloudflareTurnCredentialRequestBody\(\)/);
  assert.match(requestHelper, /validateCloudflareTurnCredentialResponse\(/);
  assert.match(requestHelper, /P2P_TURN_RESPONSE_MAX_BYTES/);
  assert.match(turnCallable, /TURN_CREDENTIAL_RATE_LIMIT_POLICY/);
  assert.match(turnCallable, /iceServers: credentials\.iceServers/);
  assert.match(turnCallable, /issuedAt: credentials\.issuedAt/);
  assert.match(turnCallable, /refreshAt: credentials\.refreshAt/);
  assert.match(turnCallable, /expiresAt: credentials\.expiresAt/);
  assert.doesNotMatch(turnCallable, /apiToken|credential:/);
});

test("P2P rate limits are transactional and keyed by a one-way UID digest", () => {
  const rateLimitHelper = sourceBetween(
    "function p2pRateLimitPath",
    "async function requestCloudflareTurnIceServers",
  );
  assert.match(rateLimitHelper, /createHash\("sha256"\)/);
  assert.match(rateLimitHelper, /online\/p2pRateLimits\/\$\{scope\}\/\$\{uidHash\}/);
  assert.match(rateLimitHelper, /\.transaction\(\(currentValue\) =>/);
  assert.match(rateLimitHelper, /p2pConnectivityRateLimitDecision\(/);
  assert.match(rateLimitHelper, /"resource-exhausted"/);
  assert.doesNotMatch(rateLimitHelper, /console\.(?:warn|error)\([^)]*uid/s);
});

test("diagnostics are sanitized, pseudonymized, indexed, and marked for retention", () => {
  const diagnosticContext = sourceBetween(
    "async function requireCurrentP2pDiagnosticContext",
    "function readCloudflareTurnApiToken",
  );
  const diagnosticCallable = sourceBetween(
    "exports.reportP2pConnectivity",
    "function cleanText",
  );
  assert.match(diagnosticContext, /online\/soloSessionClaims\/\$\{uid\}/);
  assert.match(diagnosticContext, /online\/rooms\/\$\{data\.roomId\}/);
  assert.match(diagnosticContext, /claim\.sessionId !== data\.sessionId/);
  assert.match(diagnosticContext, /roomMatchesSessionV2/);
  assert.match(diagnosticCallable, /await requireCurrentP2pDiagnosticContext\(uid, data\)/);
  assert.match(diagnosticCallable, /createP2PDiagnosticRecord\(\{/);
  assert.match(diagnosticCallable, /P2P_DIAGNOSTIC_RATE_LIMIT_POLICY/);
  assert.match(
    diagnosticCallable,
    /realtime\.ref\(`online\/p2pDiagnostics\/\$\{record\.day\}`\)\.push\(\)/,
  );
  assert.match(diagnosticCallable, /online\/p2pDiagnosticDays\/\$\{record\.day\}/);
  assert.match(diagnosticCallable, /retentionDays: P2P_DIAGNOSTIC_RETENTION_DAYS/);
  assert.match(diagnosticCallable, /deleteAt: now \+ P2P_DIAGNOSTIC_RETENTION_MS/);
  assert.match(diagnosticCallable, /await maybeCleanupExpiredP2pDiagnostics\(now\)/);
  assert.match(
    diagnosticCallable,
    /catch \(error\) \{\s*console\.warn\(\s*"P2P diagnostic retention cleanup unavailable",\s*safeP2PConnectivityError\(error, "retention_cleanup"\)/s,
  );
  assert.match(diagnosticCallable, /return \{ accepted: true \}/);
  assert.ok(
    diagnosticCallable.indexOf("return { accepted: true }")
      > diagnosticCallable.indexOf("await maybeCleanupExpiredP2pDiagnostics(now)"),
  );
  assert.doesNotMatch(diagnosticCallable, /\.\.\.data/);
});

test("diagnostic cleanup is fenced, bounded, retryable, and deletes only indexed days", () => {
  const cleanupHelper = sourceBetween(
    "async function maybeCleanupExpiredP2pDiagnostics",
    "exports.getP2pIceServers",
  );
  assert.match(
    cleanupHelper,
    /realtime\.ref\("online\/p2pMaintenance\/diagnosticCleanup"\)/,
  );
  assert.match(cleanupHelper, /maintenanceRef\.transaction\(\(currentValue\) =>/);
  assert.match(cleanupHelper, /P2P_DIAGNOSTIC_CLEANUP_INTERVAL_MS/);
  assert.match(cleanupHelper, /previousMarkerValue = currentValue == null \? null : currentValue/);
  assert.match(cleanupHelper, /markerClaimed = claim\.committed/);
  assert.match(cleanupHelper, /p2pDiagnosticRetentionCutoffDay\(now\)/);
  assert.match(cleanupHelper, /realtime\.ref\("online\/p2pDiagnosticDays"\)/);
  assert.match(cleanupHelper, /\.orderByKey\(\)/);
  assert.match(cleanupHelper, /\.endBefore\(cutoffDay\)/);
  assert.match(cleanupHelper, /selectExpiredP2PDiagnosticDayKeys\(/);
  assert.match(
    cleanupHelper,
    /maximum: P2P_DIAGNOSTIC_CLEANUP_MAX_DAYS/,
  );
  assert.match(cleanupHelper, /removals\[`online\/p2pDiagnostics\/\$\{day\}`\] = null/);
  assert.match(cleanupHelper, /removals\[`online\/p2pDiagnosticDays\/\$\{day\}`\] = null/);
  assert.match(
    cleanupHelper,
    /p2pDiagnosticCleanupMarkerRollbackValue\(\s*currentValue,\s*now,\s*previousMarkerValue/s,
  );
  assert.match(cleanupHelper, /throw error/);
  assert.match(
    cleanupHelper,
    /safeP2PConnectivityError\(error, "retention_cleanup"\)/,
  );
  assert.match(cleanupHelper, /exports\.cleanupP2pDiagnostics = onSchedule\(\{/);
  assert.match(cleanupHelper, /schedule: "every day 03:30"/);
  assert.match(cleanupHelper, /timeZone: P2P_DIAGNOSTIC_TIME_ZONE/);
  assert.match(cleanupHelper, /await maybeCleanupExpiredP2pDiagnostics\(Date\.now\(\)\)/);
  assert.match(
    cleanupHelper,
    /throw new Error\("P2P diagnostic retention cleanup failed"\)/,
  );
  assert.doesNotMatch(cleanupHelper, /console\.(?:warn|error)\([^;]*(?:day|snapshot|payload)/s);
});

test("P2P error logs emit only classified metadata, never raw caught errors", () => {
  const p2pSource = sourceBetween(
    "function isPlainCallableObject",
    "function cleanText",
  );
  assert.match(p2pSource, /safeP2PConnectivityError\(error,/);
  assert.doesNotMatch(
    p2pSource,
    /console\.(?:warn|error)\([^;]*\berror\b(?!,\s*")[^;]*\);/s,
  );
});
