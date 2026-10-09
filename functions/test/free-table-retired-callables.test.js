"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { throwRetiredCommunityMode } = require("../retired-community-modes");
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const names = ["freeTableAction", "freeTableInviteAction", "freeTableInvitePreview", "freeTablePublicStats", "reportFreeTableP2pConnectivity"];
class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

function harness(name) {
  const start = source.indexOf(`exports.${name} = onCall(`);
  assert.ok(start >= 0);
  const end = source.indexOf("\n);", start);
  const singleLineEnd = source.indexOf("\n});", start);
  const stop = singleLineEnd >= 0 && singleLineEnd < end ? singleLineEnd + 4 : end + 3;
  const text = source.slice(start, stop);
  const context = { exports: {}, HttpsError, throwRetiredCommunityMode, Date,
    callableOptions: () => ({}), onCall: (_options, handler) => handler,
    requireUid: (request) => { if (!request.auth?.uid) throw new HttpsError("unauthenticated", "auth required"); return request.auth.uid; },
  };
  // Deliberately no services/Firestore/RTDB/secrets in the context. Any access fails.
  vm.runInNewContext(text, context);
  return context.exports[name];
}

test("all retired free-table action and invite paths reject before database access", async () => {
  for (const name of names.filter((name) => name !== "freeTablePublicStats")) {
    for (const action of ["list", "get_my_state", "open", "respond", "end", "issue", "rotate", "revoke", "report", "unknown"]) {
      await assert.rejects(harness(name)({ auth: { uid: "test-user" }, data: { action, retired: false } }), (error) =>
        error.code === "failed-precondition" && error.details.reason === "mode-retired" && error.details.mode === "free_table");
    }
  }
});

test("retired public stats are a zero-only compatibility response with no data access", async () => {
  const result = await harness("freeTablePublicStats")({ data: { bypass: true } });
  assert.equal(result.welcomingRooms, 0);
  assert.equal(result.seatedRooms, 0);
  assert.equal(result.retired, true);
  assert.equal(result.retiredVersion, "free-table-retired-v1");
  assert.equal(typeof result.updatedAt, "number");
});

test("authenticated boundaries and shared safety remain in place", async () => {
  for (const name of ["freeTableAction", "freeTableInviteAction", "reportFreeTableP2pConnectivity"]) {
    await assert.rejects(harness(name)({ data: {} }), { code: "unauthenticated" });
  }
  assert.match(source, /freeTableService\.closeBlockedPair\(context\)/);
  const scheduler = source.slice(source.indexOf("exports.cleanupExpiredFreeTables"), source.indexOf("async function commitCrownCircuitWrites"));
  assert.match(scheduler, /schedule: "every day 04:30"/);
  assert.match(scheduler, /cleanupRetiredFreeTableHistory/);
  assert.doesNotMatch(scheduler, /freeTableService\.cleanupExpired/);
});
