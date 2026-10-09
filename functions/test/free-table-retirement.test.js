"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");
const { createFreeTableService, FREE_TABLE_ENDED_RETENTION_MS } = require("../free-table");
const { pairIdFor } = require("../player-safety");
const {
  FREE_TABLE_RETIREMENT_VERSION, FREE_TABLE_RETIREMENT_QUIET_MS,
  createFreeTableRetirementDrain, cleanupRetiredFreeTableRuntime,
} = require("../free-table-retirement");
const { parseArguments, verifyDeployment, DEPLOYED_FUNCTIONS, SCHEDULER_JOB } = require("../scripts/retire-free-table-runtime.cjs");

const NOW = 1_800_000_000_000;
const ID = "S".repeat(24);
const ROOM = "R".repeat(24);
const PROJECT = "gazostadium";
const PAIR = pairIdFor("host", "visitor");
const GRANT = crypto.createHash("sha256").update(JSON.stringify(["free_table", ID, ID])).digest("hex");
const options = { apply: true, project: PROJECT, confirmRetired: true };
const gate = (at = NOW) => ({ retired: true, version: FREE_TABLE_RETIREMENT_VERSION,
  quiescedAt: at - FREE_TABLE_RETIREMENT_QUIET_MS });

function fixture() {
  const memory = createPlayerSafetyMemory();
  const reads = [];
  const writes = [];
  const queries = [];
  let at = NOW;
  let verifiedGate = gate();
  let coldTransactions = false;
  const snapshot = (value) => ({ val: () => structuredClone(value),
    exists: () => value !== null,
    child: (name) => snapshot(value?.[name] ?? null) });
  function reference(path, query = {}) {
    const raw = memory.realtime.ref(path);
    return {
      ...raw,
      get: async () => {
        reads.push(path);
        const data = memory.rtRead(path);
        if (!query.field) return snapshot(data);
        queries.push({ path, ...query });
        return snapshot(Object.fromEntries(Object.entries(data || {})
          .filter(([, value]) => Number(value[query.field]) <= query.endAt)
          .sort(([, left], [, right]) => left[query.field] - right[query.field])
          .slice(0, query.limit)));
      },
      transaction: async (callback) => {
        writes.push(path);
        if (coldTransactions && callback(null) === undefined) {
          return { committed: false, snapshot: snapshot(memory.rtRead(path)) };
        }
        const result = await raw.transaction(callback);
        return { ...result, snapshot: snapshot(result.snapshot.val()) };
      },
      remove: async () => { writes.push(path); memory.rtWrite(path, null); },
      update: async (values) => {
        for (const [child, value] of Object.entries(values)) {
          writes.push(`${path}/${child}`);
          memory.rtWrite(`${path}/${child}`, value);
        }
      },
      child: (child) => reference(`${path}/${child}`),
      orderByChild: (field) => reference(path, { ...query, field }),
      endAt: (value) => reference(path, { ...query, endAt: value }),
      limitToFirst: (limit) => reference(path, { ...query, limit }),
    };
  }
  const realtime = { ref: reference };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const service = createFreeTableService({ firestore: memory.firestore, realtime, HttpsError,
    Timestamp: { fromMillis: (milliseconds) => ({ toMillis: () => milliseconds }) },
    now: () => at, playerSafety: null });
  const drain = createFreeTableRetirementDrain({ realtime, service, now: () => at,
    verifyRetired: async () => verifiedGate });
  const session = { sessionId: ID, hostUid: "host", visitorUid: "visitor",
    participants: { host: true, visitor: true }, status: "active", roomId: ROOM,
    createdAt: NOW - 100_000, expiresAt: NOW + 100_000,
    safetyPairId: PAIR, safetyVersion: 4, safetyGrantId: GRANT };
  memory.rtWrite(`freeTables/sessions/${ID}`, session);
  memory.rtWrite(`freeTables/chat/${ID}`, { message: { text: "PRIVATE_TEXT_DO_NOT_PRINT" } });
  memory.rtWrite(`freeTables/presence/${ID}`, { host: { online: true } });
  memory.rtWrite(`freeTables/signals/${ID}`, { host: { description: "PRIVATE_SDP" } });
  memory.rtWrite("freeTables/active/host", { sessionId: ID });
  memory.rtWrite("freeTables/active/visitor", { sessionId: ID });
  memory.rtWrite("freeTables/hostActive/host", { sessionId: ID });
  memory.rtWrite("freeTables/engagements/host", { sessionId: ID });
  memory.rtWrite("freeTables/publicRooms/public", { roomId: ROOM });
  memory.rtWrite(`freeTables/roomStates/${ROOM}`, { roomId: ROOM, hostUid: "host" });
  memory.rtWrite("freeTables/invites/invite", { roomId: ROOM });
  memory.rtWrite(`online/contactGates/${PAIR}`, {
    initialized: true, version: 4, blocked: false, participants: { host: true, visitor: true },
    grants: {
      [GRANT]: { mode: "free_table", roomId: ID, attemptId: ID, firstUid: "host", secondUid: "visitor",
        safetyVersion: 4, active: true, createdAt: NOW - 20, expiresAt: NOW - 1 },
      solo: { mode: "solo", roomId: "solo-room", active: false, expiresAt: NOW - 1 },
      strategy: { mode: "strategy", roomId: "strategy-room", active: true },
      market: { mode: "market", roomId: "market-room", active: false, expiresAt: NOW - 1 },
    },
    retired: { previous: { mode: "solo", cleanupCaptured: true, revokedAt: 1 } },
  });
  memory.rtWrite("online/soloRooms/kept", { balance: 123 });
  for (const path of ["freeTableProfiles/host", "freeTableSpaces/host", "freeTableBookmarks/host/rooms/a",
    "freeTableRelationships/pair", "freeTableVisitLedger/historical", "freeTableReports/report",
    "freeTablePublicCardReports/report", "freeTableBlocks/host/users/other",
    "playerSafetyUsers/host/blocks/other", "playerContactPolicies/pair", "anjuPayWallets/host"]) {
    memory.fsWrite(path, { preserved: true, contents: "PRIVATE_HISTORY" });
  }
  return { ...memory, reads, writes, queries, realtime, service, drain, session,
    setTime(value) { at = value; }, setGate(value) { verifiedGate = value; },
    setColdTransactions(value) { coldTransactions = value; } };
}

test("dry-run inventories counts, performs no writes or gate check, and leaks no private values", async () => {
  const f = fixture();
  f.setGate(null);
  const result = await f.drain.run({ project: PROJECT });
  assert.equal(result.dryRun, true);
  assert.equal(result.before.liveSessions, 1);
  assert.equal(result.before.freeTableGrants, 1);
  assert.deepEqual(f.writes, []);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(result).includes(ID), false);
  assert(f.reads.every((path) => path.startsWith("freeTables/") || path === "online/contactGates"));
  assert(!f.reads.includes("freeTables"));
});

test("apply requires fixed project, explicit confirmation, retired version and elapsed quiet fence", async () => {
  const f = fixture();
  await assert.rejects(f.drain.run({ ...options, project: "other" }), { code: "wrong-project" });
  await assert.rejects(f.drain.run({ ...options, confirmRetired: false }), { code: "retirement-confirmation-required" });
  f.setGate({ ...gate(), quiescedAt: NOW });
  await assert.rejects(f.drain.run(options), { code: "retirement-fence-unverified" });
  f.setGate({ ...gate(), version: "another-version" });
  await assert.rejects(f.drain.run(options), { code: "retirement-fence-unverified" });
  assert.deepEqual(f.writes, []);
});

test("canonical safe_exit precedes grant revocation; other modes, blocks, wallets and history survive", async () => {
  const f = fixture();
  const documents = structuredClone([...f.documents]);
  const originalGate = f.rtRead(`online/contactGates/${PAIR}`);
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (path === `online/contactGates/${PAIR}` && !value.grants[GRANT]) {
      assert.equal(f.rtRead(`freeTables/sessions/${ID}`).status, "ended");
      assert.equal(f.rtRead(`freeTables/sessions/${ID}`).ending.kind, "safe_exit");
    }
  };
  const result = await f.drain.run(options);
  const ended = f.rtRead(`freeTables/sessions/${ID}`);
  assert.equal(result.complete, true);
  assert.equal(result.retentionPending, true);
  assert.equal(result.applied.endedSessions, 1);
  assert.equal(ended.endedAt, NOW);
  assert.equal(ended.expiresAt, NOW + FREE_TABLE_ENDED_RETENTION_MS);
  assert.equal(ended.cleanupFinalizedAt, NOW);
  assert(f.rtRead(`freeTables/chat/${ID}`));
  assert.deepEqual([...f.documents], documents);
  const nextGate = f.rtRead(`online/contactGates/${PAIR}`);
  for (const mode of ["solo", "strategy", "market"]) assert.deepEqual(nextGate.grants[mode], originalGate.grants[mode]);
  assert.deepEqual(nextGate.retired.previous, originalGate.retired.previous);
  assert.equal(nextGate.retired[GRANT].cleanupCaptured, true);
  assert.deepEqual(f.rtRead("online/soloRooms/kept"), { balance: 123 });
  assert(f.writes.every((path) => path.startsWith("freeTables/") || path === `online/contactGates/${PAIR}`));
});

test("reruns are idempotent and preserve retained chat until the complete 15 minutes elapses", async () => {
  const f = fixture();
  await f.drain.run(options);
  const ended = f.rtRead(`freeTables/sessions/${ID}`);
  const second = await f.drain.run(options);
  assert.equal(second.applied.endedSessions, 0);
  assert.equal(second.applied.revokedGrants, 0);
  assert.deepEqual(f.rtRead(`freeTables/sessions/${ID}`), ended);
  f.setTime(NOW + FREE_TABLE_ENDED_RETENTION_MS - 1);
  await f.drain.run(options);
  assert(f.rtRead(`freeTables/chat/${ID}`));
  f.setTime(NOW + FREE_TABLE_ENDED_RETENTION_MS);
  const expired = await f.drain.run(options);
  assert.equal(expired.applied.removedExpiredSessions, 1);
  assert.equal(expired.applied.removedChatRecords, 1);
  assert.equal(f.rtRead(`freeTables/sessions/${ID}`), null);
  assert.equal(f.rtRead(`freeTables/chat/${ID}`), null);
});

test("partial session finalization failure is resumable without extending retention", async () => {
  const f = fixture();
  const performAction = f.service.performAction;
  let fail = true;
  const service = { async performAction(...args) {
    const result = await performAction(...args);
    if (fail) { fail = false; throw new Error("injected failure after end commit"); }
    return result;
  } };
  const drain = createFreeTableRetirementDrain({ realtime: f.realtime, service, now: () => NOW,
    verifyRetired: async () => gate() });
  await assert.rejects(drain.run(options), /injected/);
  assert(f.rtRead(`online/contactGates/${PAIR}`).grants[GRANT]);
  const ended = f.rtRead(`freeTables/sessions/${ID}`);
  const result = await drain.run(options);
  assert.equal(result.complete, true);
  assert.equal(f.rtRead(`freeTables/sessions/${ID}`).endedAt, ended.endedAt);
});

test("CAS preserves newly replaced runtime records and reports an incomplete drain", async () => {
  const f = fixture();
  let changed = false;
  f.hooks.beforeRealtimeCommit = async ({ path }) => {
    if (path === "freeTables/invites/invite" && !changed) {
      changed = true;
      f.rtWrite(path, { roomId: "new-generation" });
    }
  };
  const result = await f.drain.run(options);
  assert.equal(result.complete, false);
  assert.equal(result.changedRecordsPreserved, 1);
  assert.deepEqual(f.rtRead("freeTables/invites/invite"), { roomId: "new-generation" });
});

test("grant mode changes during CAS cannot revoke another mode", async () => {
  const f = fixture();
  let changed = false;
  f.hooks.beforeRealtimeCommit = async ({ path }) => {
    if (path === `online/contactGates/${PAIR}` && !changed) {
      changed = true;
      const current = f.rtRead(path);
      current.grants[GRANT].mode = "solo";
      f.rtWrite(path, current);
    }
  };
  const result = await f.drain.run(options);
  assert.equal(result.applied.revokedGrants, 0);
  assert.equal(result.changedRecordsPreserved, 1);
  assert.equal(f.rtRead(`online/contactGates/${PAIR}`).grants[GRANT].mode, "solo");
});

test("invalid sessions or spoofed grant identity fail before any mutation", async () => {
  const f = fixture();
  const current = f.rtRead(`online/contactGates/${PAIR}`);
  current.grants[GRANT].attemptId = "spoofed";
  f.rtWrite(`online/contactGates/${PAIR}`, current);
  await assert.rejects(f.drain.run(options), { code: "invalid-runtime-records" });
  assert.deepEqual(f.writes, []);
});

test("orphan chat is retained for review, not silently erased", async () => {
  const f = fixture();
  f.rtWrite("freeTables/chat/unknown", { message: "private" });
  const result = await f.drain.run(options);
  assert.equal(result.orphanChatNeedsReview, true);
  assert.equal(result.complete, false);
  assert.deepEqual(f.rtRead("freeTables/chat/unknown"), { message: "private" });
});

test("retention helper uses bounded expiry query and touches only finalized ended session resources", async () => {
  const f = fixture();
  await f.drain.run(options);
  const future = "F".repeat(24);
  const live = "L".repeat(24);
  const unfinished = "U".repeat(24);
  const expiredAt = NOW + FREE_TABLE_ENDED_RETENTION_MS;
  f.rtWrite(`freeTables/sessions/${future}`, { ...f.rtRead(`freeTables/sessions/${ID}`), sessionId: future,
    expiresAt: expiredAt + 100 });
  f.rtWrite(`freeTables/sessions/${live}`, { ...f.session, sessionId: live, expiresAt: NOW - 1 });
  f.rtWrite(`freeTables/sessions/${unfinished}`, { ...f.rtRead(`freeTables/sessions/${ID}`), sessionId: unfinished,
    cleanupFinalizedAt: 0 });
  f.writes.length = 0;
  const documents = structuredClone([...f.documents]);
  const result = await cleanupRetiredFreeTableRuntime({ realtime: f.realtime, now: expiredAt, limit: 20 });
  assert.deepEqual(result, { examined: 3, removed: 1, changed: 0, skipped: 2 });
  assert.deepEqual(f.queries, [{ path: "freeTables/sessions", field: "expiresAt", endAt: expiredAt, limit: 20 }]);
  assert.equal(f.rtRead(`freeTables/sessions/${ID}`), null);
  assert.equal(f.rtRead(`freeTables/chat/${ID}`), null);
  for (const id of [future, live, unfinished]) assert(f.rtRead(`freeTables/sessions/${id}`));
  assert.deepEqual([...f.documents], documents);
  assert(f.writes.every((path) => ["sessions", "chat", "presence", "signals"].some(
    (branch) => path === `freeTables/${branch}/${ID}`)));
});

test("retention helper does not remove replaced sessions", async () => {
  const f = fixture();
  await f.drain.run(options);
  const at = NOW + FREE_TABLE_ENDED_RETENTION_MS;
  let replaced = false;
  f.hooks.beforeRealtimeCommit = async ({ path }) => {
    if (path === `freeTables/sessions/${ID}` && !replaced) {
      replaced = true;
      f.rtWrite(path, { ...f.session, expiresAt: at + 1000 });
    }
  };
  const result = await cleanupRetiredFreeTableRuntime({ realtime: f.realtime, now: at });
  assert.equal(result.changed, 1);
  assert.equal(result.removed, 0);
  assert.equal(f.rtRead(`freeTables/sessions/${ID}`).status, "active");
  assert(f.rtRead(`freeTables/chat/${ID}`));
});

test("retention helper resumes a partial purge after a failed chat removal", async () => {
  const f = fixture();
  await f.drain.run(options);
  const at = NOW + FREE_TABLE_ENDED_RETENTION_MS;
  let failed = false;
  f.hooks.beforeRealtimeCommit = async ({ path }) => {
    if (path === `freeTables/chat/${ID}` && !failed) {
      failed = true;
      throw new Error("injected chat removal failure");
    }
  };
  await assert.rejects(cleanupRetiredFreeTableRuntime({ realtime: f.realtime, now: at }), /injected/);
  assert(f.rtRead(`freeTables/sessions/${ID}`).retirementPurgeToken);
  assert(f.rtRead(`freeTables/chat/${ID}`));
  const result = await cleanupRetiredFreeTableRuntime({ realtime: f.realtime, now: at });
  assert.equal(result.removed, 1);
  assert.equal(f.rtRead(`freeTables/sessions/${ID}`), null);
  assert.equal(f.rtRead(`freeTables/chat/${ID}`), null);
});

test("Admin SDK cold null transaction callbacks reconcile before claiming and purging ended resources", async () => {
  const f = fixture();
  await f.drain.run(options);
  f.setColdTransactions(true);
  f.rtWrite(`freeTables/presence/${ID}`, { host: { online: false } });
  f.rtWrite(`freeTables/signals/${ID}`, { host: { description: "retained signal" } });
  const result = await cleanupRetiredFreeTableRuntime({ realtime: f.realtime, now: NOW + FREE_TABLE_ENDED_RETENTION_MS });
  assert.equal(result.removed, 1);
  assert.equal(result.changed, 0);
  for (const branch of ["sessions", "chat", "presence", "signals"]) assert.equal(f.rtRead(`freeTables/${branch}/${ID}`), null);
});

test("CLI defaults to dry-run and rejects arbitrary projects, paths, duplicate or ambiguous write flags", () => {
  assert.deepEqual(parseArguments(["--project", PROJECT]), {
    project: PROJECT, apply: false, initializeGate: false, confirmRetired: false,
  });
  for (const args of [[], ["--project", "other"], ["--project", PROJECT, "--path", "/"],
    ["--project", PROJECT, "--apply"], ["--project", PROJECT, "--project", PROJECT],
    ["--project", PROJECT, "--apply", "--initialize-gate", "--confirm-retired"],
    ["--project", PROJECT, "--initialize-gate", "--confirm-retired"]]) {
    assert.throws(() => parseArguments(args));
  }
  const initialized = parseArguments(["--project", PROJECT, "--initialize-gate", "--confirm-retired",
    "--deployed-after", new Date(NOW - 1000).toISOString(), "--deployment-verified-at", new Date(NOW).toISOString()]);
  assert.equal(initialized.deployedAfter, NOW - 1000);
  assert.equal(initialized.deploymentVerifiedAt, NOW);
});

function metadataFixture(transform = () => {}) {
  const requests = [];
  return { requests, args: {
    getAccessToken: async () => ({ access_token: "synthetic-test-token" }),
    deployedAfter: NOW - 1000, deploymentVerifiedAt: NOW, now: NOW,
    fetchImpl: async (url, options) => {
      requests.push(url);
      assert.equal(options.headers.Authorization, "Bearer synthetic-test-token");
      let value;
      if (url.startsWith("https://cloudfunctions.googleapis.com/v2/")) {
        const name = url.split("/").at(-1);
        value = { name: `projects/${PROJECT}/locations/us-central1/functions/${name}`, state: "ACTIVE",
          updateTime: new Date(NOW - 10).toISOString(), buildConfig: { runtime: "nodejs22", entryPoint: name },
          serviceConfig: { revision: `${name.toLowerCase()}-00001-test` } };
      } else {
        assert(url.startsWith("https://cloudscheduler.googleapis.com/v1/"));
        value = { name: `projects/${PROJECT}/locations/us-central1/jobs/${SCHEDULER_JOB}`,
          state: "ENABLED", schedule: "30 4 * * *", timeZone: "Asia/Tokyo" };
      }
      transform(value, url);
      return { ok: true, json: async () => value };
    },
  } };
}

test("deployment fence verifies exact six function revisions and daily retention schedule without calling App Check endpoints", async () => {
  const fixture = metadataFixture();
  const result = await verifyDeployment(fixture.args);
  assert.equal(result.functions, 6);
  assert.match(result.deploymentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fixture.requests.length, DEPLOYED_FUNCTIONS.length + 1);
  assert(fixture.requests.every((url) => /googleapis\.com\/(v1|v2)\//.test(url)));
  assert.equal(JSON.stringify(result).includes("synthetic-test-token"), false);
  const changed = metadataFixture((value) => {
    if (value.buildConfig?.entryPoint === "freeTableAction") value.serviceConfig.revision = "changed-revision";
  });
  assert.notEqual((await verifyDeployment(changed.args)).deploymentFingerprint, result.deploymentFingerprint);
});

test("deployment fence rejects old/inactive function revisions, changed schedules and verification timestamps in future", async () => {
  for (const transform of [
    (value) => { if (value.buildConfig) value.state = "DEPLOYING"; },
    (value) => { if (value.buildConfig) value.updateTime = new Date(NOW - 2000).toISOString(); },
    (value) => { if (value.buildConfig) value.buildConfig.runtime = "nodejs20"; },
    (value) => { if (value.buildConfig) delete value.serviceConfig.revision; },
    (value) => { if (value.schedule) value.schedule = "every 2 minutes"; },
    (value) => { if (value.schedule) value.timeZone = "UTC"; },
  ]) {
    await assert.rejects(verifyDeployment(metadataFixture(transform).args));
  }
  await assert.rejects(verifyDeployment({ ...metadataFixture().args, deploymentVerifiedAt: NOW + 1 }),
    { code: "invalid-deployment-verification-window" });
});
