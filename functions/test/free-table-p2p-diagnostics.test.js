"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  currentFreeTableP2pDiagnosticContext,
  freeTableP2pDiagnosticIdIsSafe,
} = require("../free-table-p2p-diagnostics");

const root = path.resolve(__dirname, "..", "..");
const functionsSource = fs.readFileSync(
  path.join(root, "functions", "index.js"),
  "utf8",
);
const rollout = require("../app-check-rollout");
const NOW = Date.parse("2026-07-28T06:00:00.000Z");
const UID = "firebaseAnonymousUid123456";
const PEER_UID = "firebaseAnonymousPeer654321";
const SESSION_ID = "-OTFreeTableSession01";
const ROOM_ID = "-OTFreeTableRoom00001";

function sourceBetween(start, end) {
  const startIndex = functionsSource.indexOf(start);
  const endIndex = functionsSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return functionsSource.slice(startIndex, endIndex);
}

function currentContext(overrides = {}) {
  return {
    uid: UID,
    sessionId: SESSION_ID,
    sessionValue: {
      protocolVersion: 1,
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      hostUid: UID,
      visitorUid: PEER_UID,
      participants: {
        [UID]: true,
        [PEER_UID]: true,
      },
      status: "connecting",
      generation: 4,
      expiresAt: NOW + 60_000,
      hardExpiresAt: NOW + 3_600_000,
    },
    activeValue: {
      state: "active",
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      role: "host",
      generation: 4,
      expiresAt: NOW + 60_000,
    },
    now: NOW,
    ...overrides,
  };
}

test("free-table diagnostics accept only the current canonical participant claim", () => {
  assert.equal(freeTableP2pDiagnosticIdIsSafe(SESSION_ID), true);
  assert.deepEqual(currentFreeTableP2pDiagnosticContext(currentContext()), {
    sessionId: SESSION_ID,
    roomId: ROOM_ID,
    role: "host",
  });
  assert.deepEqual(currentFreeTableP2pDiagnosticContext(currentContext({
    uid: PEER_UID,
    activeValue: {
      state: "active",
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      role: "visitor",
      generation: 4,
      expiresAt: NOW + 60_000,
    },
  })), {
    sessionId: SESSION_ID,
    roomId: ROOM_ID,
    role: "visitor",
  });
});

test("free-table diagnostics reject stale, ended, or mismatched membership", () => {
  const cases = [
    { sessionId: "../sessions/other" },
    {
      activeValue: {
        ...currentContext().activeValue,
        state: "visitor_pending",
      },
    },
    {
      activeValue: {
        ...currentContext().activeValue,
        roomId: "-OTOtherFreeTable001",
      },
    },
    {
      activeValue: {
        state: "active",
        sessionId: "-OTOtherFreeSession1",
        roomId: ROOM_ID,
        role: "host",
        generation: 4,
        expiresAt: NOW + 60_000,
      },
    },
    {
      activeValue: {
        state: "active",
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        role: "visitor",
        generation: 4,
        expiresAt: NOW + 60_000,
      },
    },
    {
      activeValue: {
        state: "active",
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        role: "host",
        generation: 3,
        expiresAt: NOW + 60_000,
      },
    },
    {
      sessionValue: {
        ...currentContext().sessionValue,
        participants: { [PEER_UID]: true },
      },
    },
    {
      sessionValue: {
        ...currentContext().sessionValue,
        status: "ended",
      },
    },
    {
      sessionValue: {
        ...currentContext().sessionValue,
        expiresAt: NOW,
      },
    },
    {
      activeValue: {
        ...currentContext().activeValue,
        expiresAt: NOW,
      },
    },
  ];
  for (const overrides of cases) {
    assert.equal(currentFreeTableP2pDiagnosticContext(currentContext(overrides)), null);
  }
});

test("legacy generation-free sessions remain diagnosable only with matching claims", () => {
  const context = currentContext();
  delete context.sessionValue.generation;
  delete context.activeValue.generation;
  assert.deepEqual(currentFreeTableP2pDiagnosticContext(context), {
    sessionId: SESSION_ID,
    roomId: ROOM_ID,
    role: "host",
  });

  context.activeValue.generation = 1;
  assert.equal(currentFreeTableP2pDiagnosticContext(context), null);
});

test("free-table diagnostics reject malformed generations and participant identities", () => {
  const cases = [
    {
      sessionValue: {
        ...currentContext().sessionValue,
        generation: "4",
      },
    },
    {
      sessionValue: {
        ...currentContext().sessionValue,
        generation: -1,
      },
      activeValue: {
        ...currentContext().activeValue,
        generation: -1,
      },
    },
    {
      sessionValue: {
        ...currentContext().sessionValue,
        visitorUid: UID,
      },
    },
    {
      sessionValue: {
        ...currentContext().sessionValue,
        visitorUid: "invalid/peer",
        participants: {
          [UID]: true,
          "invalid/peer": true,
        },
      },
    },
  ];
  for (const overrides of cases) {
    assert.equal(currentFreeTableP2pDiagnosticContext(currentContext(overrides)), null);
  }
});

test("free-table diagnostic callable is App Check enforced and server-context bounded", () => {
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.reportFreeTableP2pConnectivity, true);
  const requestHelper = sourceBetween(
    "function requireFreeTableP2pDiagnosticCallableData",
    "async function requireCurrentP2pDiagnosticContext",
  );
  const contextHelper = sourceBetween(
    "async function requireCurrentFreeTableP2pDiagnosticContext",
    "function readCloudflareTurnApiToken",
  );
  const callable = sourceBetween(
    "exports.reportFreeTableP2pConnectivity",
    "function cleanText",
  );
  const diagnosticWrite = callable.slice(
    callable.indexOf("const eventId ="),
    callable.indexOf("return { accepted: true }"),
  );

  assert.match(requestHelper, /new Set\(\["sessionId", "diagnostic"\]\)/);
  assert.doesNotMatch(requestHelper, /"roomId"/);
  assert.match(requestHelper, /value\.diagnostic\.phase !== "free_table"/);
  assert.match(contextHelper, /freeTables\/sessions\/\$\{data\.sessionId\}/);
  assert.match(contextHelper, /freeTables\/active\/\$\{uid\}/);
  assert.match(contextHelper, /currentFreeTableP2pDiagnosticContext\(\{/);
  assert.match(callable, /const uid = requireUid\(request\)/);
  assert.match(
    callable,
    /callableOptions\("reportFreeTableP2pConnectivity", \[P2P_DIAGNOSTIC_HMAC_SECRET\]\)/,
  );
  assert.match(callable, /await requireCurrentFreeTableP2pDiagnosticContext\(uid, data, now\)/);
  assert.match(callable, /sessionId: `free-table-session-\$\{context\.sessionId\}`/);
  assert.match(callable, /roomId: `free-table-session-\$\{context\.sessionId\}`/);
  assert.doesNotMatch(callable, /roomId: `free-table-[^`]*context\.roomId/);
  assert.match(callable, /createP2PDiagnosticRecord\(\{/);
  assert.match(callable, /payload: data\.diagnostic/);
  assert.match(callable, /P2P_DIAGNOSTIC_RATE_LIMIT_POLICY/);
  assert.match(callable, /retentionDays: P2P_DIAGNOSTIC_RETENTION_DAYS/);
  assert.match(callable, /deleteAt: now \+ P2P_DIAGNOSTIC_RETENTION_MS/);
  assert.match(diagnosticWrite, /\.\.\.record/);
  assert.doesNotMatch(diagnosticWrite, /\b(?:uid|sessionId|roomId):/);
  assert.doesNotMatch(callable, /\.\.\.data/);
});
