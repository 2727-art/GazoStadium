"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { FREE_TABLE_ENDED_RETENTION_MS } = require("./free-table");
const { pairIdFor } = require("./player-safety");

const FREE_TABLE_RETIREMENT_VERSION = "free-table-retired-v1";
const FREE_TABLE_RETIREMENT_PROJECT = "gazostadium";
// Also allow the previous 300-second cleanup schedule invocation to finish.
const FREE_TABLE_RETIREMENT_QUIET_MS = 360_000;
const FREE_TABLE_RETIREMENT_GATE_PATH = "freeTables/retirement";
const TRANSIENT_BRANCHES = Object.freeze([
  "publicRooms", "roomStates", "roomOwners", "openGenerations", "engagements",
  "hostActive", "visitorPending", "requests", "active", "invites", "hostInvites",
  "presence", "signals",
]);
const SNAPSHOT_BRANCHES = Object.freeze([...TRANSIENT_BRANCHES, "sessions", "chat"]);
const CHILD_ID = /^[A-Za-z0-9_-]{20,40}$/;
const UID = /^[^/.#$\[\]\u0000-\u001f\u007f]{1,128}$/;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const count = (value) => Object.keys(object(value)).length;

function failure(code) {
  const error = new Error(`Free table retirement stopped: ${code}.`);
  error.code = code;
  return error;
}

function validSession(id, session) {
  return CHILD_ID.test(id) && session?.sessionId === id
    && UID.test(String(session.hostUid || ""))
    && UID.test(String(session.visitorUid || ""))
    && session.hostUid !== session.visitorUid
    && session.participants?.[session.hostUid] === true
    && session.participants?.[session.visitorUid] === true
    && ["active", "connecting", "ended"].includes(session.status);
}

function retentionElapsed(session, at) {
  return session?.status === "ended"
    && Number.isSafeInteger(session.endedAt) && session.endedAt > 0
    && Number.isSafeInteger(session.expiresAt)
    && at >= Math.max(session.expiresAt, session.endedAt + FREE_TABLE_ENDED_RETENTION_MS);
}

function assertRetiredGate(gate, at) {
  if (gate?.retired !== true || gate.version !== FREE_TABLE_RETIREMENT_VERSION
      || !Number.isSafeInteger(gate.quiescedAt) || gate.quiescedAt <= 0
      || !Number.isSafeInteger(at) || at < gate.quiescedAt + FREE_TABLE_RETIREMENT_QUIET_MS) {
    throw failure("retirement-fence-unverified");
  }
}

// Daily retention work remains necessary after the admission/runtime functions
// retire. Query only a bounded expiry index; never enumerate chat or Firestore.
async function cleanupRetiredFreeTableRuntime({ realtime, now = Date.now(), limit = 200 }) {
  const at = typeof now === "function" ? now() : now;
  if (!Number.isSafeInteger(at) || at <= 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw failure("invalid-retention-options");
  }
  const sessions = object((await realtime.ref("freeTables/sessions")
    .orderByChild("expiresAt").endAt(at).limitToFirst(limit).get()).val());
  const report = { examined: count(sessions), removed: 0, changed: 0, skipped: 0 };
  for (const [id, session] of Object.entries(sessions)) {
    if (!CHILD_ID.test(id) || session?.sessionId !== id || !retentionElapsed(session, at)
        || !(Number(session.cleanupFinalizedAt) > 0)) {
      report.skipped += 1;
      continue;
    }
    const sessionReference = realtime.ref(`freeTables/sessions/${id}`);
    // The claim both fences a stale query result and leaves a resumable terminal
    // record if any of the subsequent targeted removals fails.
    const token = crypto.randomBytes(18).toString("hex");
    const claim = await sessionReference.transaction((current) => {
      // Admin .get() does not keep an active cache registration. Returning null
      // reconciles an initial cold-cache null with the server; undefined would
      // abort before the actual existing terminal record was examined.
      if (current === null) return null;
      return isDeepStrictEqual(current, session)
        ? { ...current, retirementPurgeToken: token } : undefined;
    }, undefined, false);
    if (!claim.committed || claim.snapshot.val()?.retirementPurgeToken !== token) {
      report.changed += 1;
      continue;
    }
    const claimed = claim.snapshot.val();
    let changed = false;
    for (const branch of ["chat", "presence", "signals"]) {
      const reference = realtime.ref(`freeTables/${branch}/${id}`);
      const expected = (await reference.get()).val();
      if (expected === null) continue;
      const result = await reference.transaction((current) => (
        current === null || isDeepStrictEqual(current, expected) ? null : undefined
      ), undefined, false);
      if (!result.committed && result.snapshot.val() !== null) changed = true;
    }
    if (changed) {
      report.changed += 1;
      continue;
    }
    const removed = await sessionReference.transaction((current) => (
      current === null || isDeepStrictEqual(current, claimed) ? null : undefined
    ), undefined, false);
    if (removed.committed) report.removed += 1;
    else if (removed.snapshot.val() !== null) report.changed += 1;
  }
  return report;
}

function validFreeTableGrant(pairId, grantId, gate, grant) {
  if (grant?.mode !== "free_table" || !CHILD_ID.test(String(grant.roomId || ""))
      || !CHILD_ID.test(String(grant.attemptId || ""))
      || !UID.test(String(grant.firstUid || "")) || !UID.test(String(grant.secondUid || ""))
      || grant.firstUid === grant.secondUid || !Number.isSafeInteger(gate.version)
      || gate.version < 0 || grant.safetyVersion !== gate.version
      || gate.participants?.[grant.firstUid] !== true || gate.participants?.[grant.secondUid] !== true
      || pairId !== pairIdFor(grant.firstUid, grant.secondUid)) return false;
  const expectedId = crypto.createHash("sha256")
    .update(JSON.stringify(["free_table", grant.roomId, grant.attemptId])).digest("hex");
  return grantId === expectedId;
}

async function readRuntime(realtime) {
  const entries = await Promise.all(SNAPSHOT_BRANCHES.map(async (branch) => [
    branch, object((await realtime.ref(`freeTables/${branch}`).get()).val()),
  ]));
  return Object.fromEntries(entries);
}

function runtimeCounts(runtime, gates, at) {
  const result = {
    branches: Object.fromEntries(SNAPSHOT_BRANCHES.map((branch) => [branch, count(runtime[branch])])),
    liveSessions: 0, unfinishedEndings: 0, invalidSessions: 0,
    retainedEndedSessions: 0, expiredEndedSessions: 0, orphanChat: 0,
    freeTableGrants: 0, invalidFreeTableGrants: 0,
  };
  for (const [id, session] of Object.entries(runtime.sessions)) {
    if (!validSession(id, session)) result.invalidSessions += 1;
    if (["active", "connecting"].includes(session?.status)) result.liveSessions += 1;
    if (session?.status === "ended") {
      if (!(Number(session.cleanupFinalizedAt) > 0)) result.unfinishedEndings += 1;
      if (retentionElapsed(session, at)) result.expiredEndedSessions += 1;
      else result.retainedEndedSessions += 1;
    }
  }
  for (const id of Object.keys(runtime.chat)) if (!runtime.sessions[id]) result.orphanChat += 1;
  for (const [pairId, gate] of Object.entries(gates)) {
    for (const [grantId, grant] of Object.entries(object(gate?.grants))) {
      if (grant?.mode !== "free_table") continue;
      result.freeTableGrants += 1;
      if (!validFreeTableGrant(pairId, grantId, gate, grant)) result.invalidFreeTableGrants += 1;
    }
  }
  return result;
}

/**
 * Admin-only, resumable drain. The caller must construct the existing free-table
 * service with playerSafety:null: session finalization is canonical, while this
 * module revokes only free_table grants without compacting other modes' grants.
 * No Firestore collection is enumerated or deleted. The existing end action may
 * advance an existing pair's lastEndedAt; its visit/history records are preserved.
 * verifyRetired must verify deployed writer stubs and the retention-only schedule.
 * Callables must stay retired throughout the operation and every later rerun.
 */
function createFreeTableRetirementDrain({ realtime, service, verifyRetired, now = Date.now }) {
  if (typeof realtime?.ref !== "function") throw new TypeError("Retirement RTDB dependency is required.");

  async function run({ apply = false, project, confirmRetired = false } = {}) {
    if (project !== FREE_TABLE_RETIREMENT_PROJECT) throw failure("wrong-project");
    if (typeof apply !== "boolean") throw failure("invalid-apply-option");
    const requireFence = async () => {
      if (!confirmRetired || typeof verifyRetired !== "function") throw failure("retirement-confirmation-required");
      assertRetiredGate(await verifyRetired(), now());
    };
    if (apply) {
      if (typeof service?.performAction !== "function") throw failure("retirement-service-required");
      await requireFence();
    }
    let runtime = await readRuntime(realtime);
    let gates = object((await realtime.ref("online/contactGates").get()).val());
    const before = runtimeCounts(runtime, gates, now());
    const report = {
      version: FREE_TABLE_RETIREMENT_VERSION, project, dryRun: !apply, before,
      applied: { endedSessions: 0, resumedEndings: 0, revokedGrants: 0,
        removedTransientRecords: 0, removedChatRecords: 0, removedExpiredSessions: 0 },
      changedRecordsPreserved: 0,
    };
    if (!apply) return { ...report, after: before };
    // Unknown or corrupt records require review; never erase them to make counts zero.
    if (before.invalidSessions || before.invalidFreeTableGrants) throw failure("invalid-runtime-records");
    for (const [id, session] of Object.entries(runtime.sessions)) {
      if (session.status === "ended" && Number(session.cleanupFinalizedAt) > 0) continue;
      await requireFence();
      await service.performAction(session.hostUid, { action: "end", sessionId: id, reason: "safe_exit" });
      report.applied[session.status === "ended" ? "resumedEndings" : "endedSessions"] += 1;
    }
    // Canonical ending is committed before any grants or residual state disappear.
    runtime = await readRuntime(realtime);
    if (runtimeCounts(runtime, {}, now()).liveSessions
        || runtimeCounts(runtime, {}, now()).unfinishedEndings
        || runtimeCounts(runtime, {}, now()).invalidSessions) throw failure("sessions-not-finalized");

    gates = object((await realtime.ref("online/contactGates").get()).val());
    for (const [pairId, gate] of Object.entries(gates)) {
      for (const [grantId, grant] of Object.entries(object(gate?.grants))) {
        if (grant?.mode !== "free_table") continue;
        if (!validFreeTableGrant(pairId, grantId, gate, grant)) throw failure("invalid-free-table-grant");
        await requireFence();
        const result = await realtime.ref(`online/contactGates/${pairId}`).transaction((current) => {
          if (current === null) return null;
          if (current?.version !== gate.version
              || !isDeepStrictEqual(current?.grants?.[grantId], grant)
              || !validFreeTableGrant(pairId, grantId, current, current.grants[grantId])) return undefined;
          const grants = { ...current.grants };
          delete grants[grantId];
          return { ...current, grants, retired: { ...object(current.retired), [grantId]: {
            ...grant, revokedAt: now(), revokedVersion: current.version, cleanupCaptured: true,
          } } };
        }, undefined, false);
        if (result.committed && result.snapshot.val()?.retired?.[grantId]?.mode === "free_table") report.applied.revokedGrants += 1;
        else if (result.snapshot.val()?.grants?.[grantId]) report.changedRecordsPreserved += 1;
      }
    }

    async function removeUnchanged(path, expected) {
      await requireFence();
      const result = await realtime.ref(path).transaction((current) => (
        current === null || isDeepStrictEqual(current, expected) ? null : undefined
      ), undefined, false);
      if (!result.committed && result.snapshot.val() !== null) report.changedRecordsPreserved += 1;
      return result.committed;
    }
    // Compare entire individual records, including generations, so a changed or
    // newly created record cannot be erased by a stale snapshot.
    for (const branch of TRANSIENT_BRANCHES) {
      for (const [id, value] of Object.entries(runtime[branch])) {
        if (await removeUnchanged(`freeTables/${branch}/${id}`, value)) report.applied.removedTransientRecords += 1;
      }
    }
    for (const [id, session] of Object.entries(runtime.sessions)) {
      if (!retentionElapsed(session, now())) continue;
      // Keep the ended session until its chat has been removed. A partial failure
      // remains discoverable and can be retried without deleting unknown orphans.
      const latest = (await realtime.ref(`freeTables/sessions/${id}`).get()).val();
      if (!isDeepStrictEqual(latest, session)) {
        report.changedRecordsPreserved += 1;
        continue;
      }
      if (Object.hasOwn(runtime.chat, id)) {
        if (!await removeUnchanged(`freeTables/chat/${id}`, runtime.chat[id])) continue;
        report.applied.removedChatRecords += 1;
      }
      if (await removeUnchanged(`freeTables/sessions/${id}`, session)) report.applied.removedExpiredSessions += 1;
    }
    const afterRuntime = await readRuntime(realtime);
    const afterGates = object((await realtime.ref("online/contactGates").get()).val());
    report.after = runtimeCounts(afterRuntime, afterGates, now());
    report.complete = TRANSIENT_BRANCHES.every((branch) => !report.after.branches[branch])
      && report.after.liveSessions === 0 && report.after.unfinishedEndings === 0
      && report.after.freeTableGrants === 0 && report.after.orphanChat === 0
      && report.changedRecordsPreserved === 0;
    // The daily retention-only schedule or a later explicit run expires ended chat.
    report.retentionPending = report.after.retainedEndedSessions > 0;
    report.orphanChatNeedsReview = report.after.orphanChat > 0;
    return report;
  }
  return Object.freeze({ run });
}

module.exports = Object.freeze({
  FREE_TABLE_RETIREMENT_VERSION, FREE_TABLE_RETIREMENT_PROJECT,
  FREE_TABLE_RETIREMENT_QUIET_MS, FREE_TABLE_RETIREMENT_GATE_PATH,
  TRANSIENT_BRANCHES, SNAPSHOT_BRANCHES, assertRetiredGate,
  createFreeTableRetirementDrain, cleanupRetiredFreeTableRuntime,
});
