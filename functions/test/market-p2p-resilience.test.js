"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const marketSource = fs.readFileSync(path.join(root, "market.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const rolloutSource = fs.readFileSync(path.join(root, "functions", "app-check-rollout.js"), "utf8");
const databaseRules = JSON.parse(fs.readFileSync(path.join(root, "database.rules.json"), "utf8"));

test("VALUE MARKET obtains validated TURN credentials with a safe STUN fallback", () => {
  assert.match(marketSource, /httpsCallable\(functions,\s*"getP2pIceServers"\)/);
  assert.match(marketSource, /validateMarketIceServers\(response\.data\?\.iceServers\)/);
  assert.match(marketSource, /turns:turn\\\.cloudflare\\\.com/);
  assert.match(marketSource, /iceServers:\s*iceConfiguration\.iceServers/);
  assert.match(marketSource, /iceTransportPolicy:\s*"all"/);
  assert.match(marketSource, /MARKET_FALLBACK_ICE_SERVERS/);
});

test("VALUE MARKET recovers P2P without terminating the authoritative negotiation", () => {
  assert.match(marketSource, /MARKET_P2P_CONNECT_TIMEOUT_MS\s*=\s*35_000/);
  assert.match(marketSource, /heartbeatDelay\s*=\s*20_000\s*\+\s*Math\.floor\(Math\.random\(\)\s*\*\s*5_000\)/);
  assert.match(marketSource, /MARKET_P2P_DISCONNECT_GRACE_MS\s*=\s*8_000/);
  assert.match(marketSource, /MARKET_P2P_MAX_RECOVERY_ATTEMPTS\s*=\s*3/);
  assert.match(marketSource, /MARKET_MAX_PENDING_ICE_CANDIDATES\s*=\s*128/);
  assert.match(marketSource, /scheduleMarketPeerRecovery\(peer,\s*generation,\s*roomId/);
  assert.match(marketSource, /peer\.connectionState\s*===\s*"disconnected"/);
  assert.match(marketSource, /\["failed",\s*"closed"\]\.includes\(peer\.connectionState\)/);
  assert.doesNotMatch(
    marketSource,
    /P2P接続を確立できませんでした[^]*?handleFatalError/,
  );
  assert.match(
    marketSource,
    /文字での交渉と取引操作は継続できます/,
  );
});

test("reconnections fence stale signaling and clean up their timers", () => {
  assert.match(marketSource, /connectionId,\s*createdAt:\s*serverTimestamp\(\)/);
  assert.match(marketSource, /signalCreatedAt\s*<\s*peerStartedAt\s*-\s*60_000/);
  assert.match(marketSource, /incomingConnectionId\s*!==\s*state\.peerConnectionId/);
  assert.match(marketSource, /clearMarketPeerRecoveryTimer\(\)/);
  assert.match(marketSource, /state\.peerRecoveryAttempts\s*=\s*0/);

  const signalRules = databaseRules.rules.online.valueMarketRooms.$roomId
    .signals.$targetUid.$signalId;
  assert.equal(
    signalRules.connectionId[".validate"],
    "newData.isString() && (newData.val().length === 0 || (newData.val().length <= 64 && newData.val().matches(/^[A-Za-z0-9-]+$/)))",
  );
  assert.equal(signalRules.$other[".validate"], false);
});

test("transient Firestore listener errors retry without dropping an active deal", () => {
  assert.match(marketSource, /activeSnapshotRetry\s*=\s*window\.setTimeout/);
  assert.match(marketSource, /walletSnapshotRetry\s*=\s*window\.setTimeout/);
  assert.match(marketSource, /roomSnapshotRetry\s*=\s*window\.setTimeout/);
  assert.match(marketSource, /取引状態を再同期しています…交渉内容は保持されています/);
  assert.doesNotMatch(
    marketSource,
    /valueMarketRooms",\s*roomId\)[^]*?},\s*\(error\)\s*=>\s*handleFatalError/,
  );
});

test("market P2P failures emit sanitized participant-only diagnostics", () => {
  const diagnosticStart = marketSource.indexOf("async function reportMarketP2pDiagnostic");
  const diagnosticEnd = marketSource.indexOf("function clearMarketPeerRecoveryTimer", diagnosticStart);
  const diagnosticSource = marketSource.slice(diagnosticStart, diagnosticEnd);
  assert.match(marketSource, /httpsCallable\(functions,\s*"reportMarketP2pConnectivity"\)/);
  assert.match(diagnosticSource, /phase:\s*"market"/);
  assert.match(diagnosticSource, /candidateType:\s*candidate\.candidateType/);
  assert.doesNotMatch(diagnosticSource, /\b(?:sdp|uid|name|ip):/);
  assert.match(functionsSource, /exports\.reportMarketP2pConnectivity\s*=\s*onCall/);
  assert.match(functionsSource, /room\?\.participants\?\.\[uid\]\s*!==\s*true/);
  assert.match(functionsSource, /createP2PDiagnosticRecord\(\{/);
  assert.match(rolloutSource, /reportMarketP2pConnectivity:\s*true/);
});

test("hosting cache key exposes the resilient market client", () => {
  assert.match(htmlSource, /market\.js\?v=[^"]*p2p-resilience-v1/);
  assert.match(htmlSource, /market\.js\?v=[^"]*market-rematch-resilience-v1/);
  assert.match(htmlSource, /market\.js\?v=[^"]*oshijo-delivery-ack-v1/);
});
