"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "free-table.js"), "utf8");

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("free-table P2P diagnostics use the dedicated App Check callable and preserve TURN status", () => {
  assert.match(
    source,
    /reportFreeTableP2pConnectivityCallable = httpsCallable\(\s*functions,\s*"reportFreeTableP2pConnectivity"/,
  );
  const loader = sourceBetween(
    "async function loadIceConfiguration",
    "async function selectedFreeTableCandidateSummary",
  );
  assert.match(loader, /turnAvailable: configuration\.turnAvailable === true/);
  assert.match(
    loader,
    /iceServers: \[\{ urls: "stun:stun\.l\.google\.com:19302" \}\],[\s\S]*?turnAvailable: false/,
  );
  const setup = sourceBetween(
    "async function setupPeerConnection",
    "async function sendSignal",
  );
  assert.match(setup, /const iceConfiguration = await loadIceConfiguration\(\)/);
  assert.match(setup, /new RTCPeerConnection\(\{ iceServers: iceConfiguration\.iceServers \}\)/);
  assert.match(setup, /state\.peerTurnAvailable = iceConfiguration\.turnAvailable === true/);
});

test("free-table diagnostics are fire-and-forget, bounded, and contain no communication content", () => {
  const reporter = sourceBetween(
    "async function reportFreeTableP2pDiagnostic",
    "function createNegotiationId",
  );
  assert.match(reporter, /phase: "free_table"/);
  assert.match(reporter, /reportFreeTableP2pConnectivityCallable\(\{/);
  assert.match(reporter, /\}\)\.catch\(\(\) => \{\}\)/);
  assert.match(reporter, /Math\.min\(\s*10 \* 60 \* 1000/);
  assert.match(reporter, /peerDiagnosticSent\.has\(dedupeKey\)/);
  assert.doesNotMatch(
    reporter,
    /\b(?:uid|roomId|userAgent|browser|sdp|localDescription|remoteDescription|image|audio|message|text):/,
  );

  for (const event of [
    "peer_created",
    "turn_unavailable",
    "connection_timeout",
    "ice_disconnected",
    "ice_failed",
    "restart_started",
    "channel_open",
  ]) {
    assert.match(source, new RegExp(`"${event}"`));
  }
});

test("free-table diagnostic lifecycle state is reset when the session closes", () => {
  const cleanup = sourceBetween(
    "function cleanupSession",
    "function finishSessionLocally",
  );
  assert.match(cleanup, /state\.peerTurnAvailable = false/);
  assert.match(cleanup, /state\.peerStartedAt = 0/);
  assert.match(cleanup, /state\.peerDiagnosticSent\.clear\(\)/);
});
