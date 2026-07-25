"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("server profile projection remains participant-scoped to marked V2 rooms", () => {
  const server = read("functions/index.js");
  const eligibility = sourceBetween(
    server,
    "function soloProfileProjectionEligible",
    "function soloProfileProjectionJob",
  );
  assert.match(
    eligibility,
    /room\?\.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION/,
  );
  assert.match(
    eligibility,
    /room\?\.players\?\.\[uid\]\?\.profileProjectionVersion === SOLO_PROFILE_PROJECTION_VERSION/,
  );

  const recording = sourceBetween(
    server,
    "async function recordVerifiedMatch",
    "function validatePostMatchTipRequest",
  );
  assert.match(
    recording,
    /projectionEligibleUids = mode === "solo"[\s\S]*?participants\.filter\(\(participantUid\) => soloProfileProjectionEligible\(room, participantUid\)\)/,
  );
  assert.match(
    recording,
    /projectionQueueRefs = projectionEligibleUids[\s\S]*?\.map\(\(participantUid\) => soloProfileProjectionQueueRef\(participantUid\)\)/,
  );
  assert.match(
    recording,
    /projectionQueueSnapshotByUid = Object\.fromEntries\([\s\S]*?projectionEligibleUids\.map/,
  );
  assert.match(
    recording,
    /const projectionStatus = claimSnapshots\[index\]\.get\("profileProjectionStatus"\)[\s\S]*?projectionEligibleUidSet\.has\(participantUid\)[\s\S]*?projectionStatus === "pending" \|\| projectionStatus === "complete"[\s\S]*?projectionActivatedUidSet\.add\(participantUid\)/,
  );
  assert.match(
    recording,
    /const projectionSequence = projectionEligibleUidSet\.has\(participantUid\)[\s\S]*?nextSoloProjectionSequence\(projectionQueueSnapshot\)/,
  );
  const newClaimProjectionDecision = sourceBetween(
    recording,
    "const projectionQueueSnapshot = projectionQueueSnapshotByUid[participantUid]",
    "const progress = addVerifiedMatch",
  );
  assert.doesNotMatch(newClaimProjectionDecision, /profileProjectionEnrolled/);
  assert.match(
    recording,
    /profileProjectionStatus: "pending",[\s\S]*?projectionSequence,/,
  );
  assert.match(
    recording,
    /transaction\.create\(\s*soloProfileProjectionJobRef\(participantUid, claimRefs\[index\]\.id\),\s*\{[\s\S]*?projectionJobs\[participantUid\],[\s\S]*?projectionSequence,/,
  );
  assert.match(
    recording,
    /transaction\.set\(soloProfileProjectionQueueRef\(participantUid\), \{[\s\S]*?pending: true,[\s\S]*?profileProjectionEnrolled: true,[\s\S]*?profileProjectionVersion: SOLO_PROFILE_PROJECTION_VERSION,[\s\S]*?queueRevision: projectionSequence/,
  );
  assert.match(
    recording,
    /Number\.isFinite\(projectionQueueSnapshot\?\.get\("lastStartedAt"\)\)[\s\S]*?\? \{\}[\s\S]*?: \{ lastStartedAt: 0 \}/,
  );
  assert.match(
    recording,
    /const callerClaim = await claimRefs\[participants\.indexOf\(uid\)\]\.get\(\)[\s\S]*?callerClaim\.get\("profileProjectionStatus"\)[\s\S]*?projectionStatus === "pending" \|\| projectionStatus === "complete"/,
  );
  assert.match(
    recording,
    /\.\.\.\(callerProjectionActivated[\s\S]*?profileProjectionMode: "server-v2"/,
  );
});

test("projection retries fence stale workers and schedule pending queues fairly", () => {
  const server = read("functions/index.js");
  const reconciliation = sourceBetween(
    server,
    "async function acquireSoloProfileProjectionLease",
    "function requestedSoloFinalizationVersion",
  );
  assert.match(reconciliation, /snapshot\.get\("pending"\) !== true/);
  assert.match(reconciliation, /snapshot\.get\("leaseToken"\) !== lease\.token/);
  assert.match(reconciliation, /revisionChanged/);
  assert.match(reconciliation, /finalPending = pending === true \|\| revisionChanged/);
  assert.match(
    server,
    /function soloProjectionLeaseIsCurrent[\s\S]*?queueSnapshot\.get\("leaseToken"\) === lease\.token[\s\S]*?queueSnapshot\.get\("leaseUntil"\)[\s\S]*?> now/,
  );
  assert.match(
    reconciliation,
    /async function prepareSoloProfileProjectionJob\(jobSnapshot, lease\)[\s\S]*?transaction\.get\(queueRef\)[\s\S]*?transaction\.get\(jobSnapshot\.ref\)[\s\S]*?transaction\.get\(claimRef\)[\s\S]*?requirePending: true[\s\S]*?leaseUntil: checkedAt \+ SOLO_PROFILE_PROJECTION_LEASE_MS/,
  );
  assert.match(
    reconciliation,
    /async function completeSoloProfileProjectionJob\(jobSnapshot, job, lease\)[\s\S]*?soloProjectionLeaseIsCurrent\(queueSnapshot, job\.uid, lease, checkedAt\)[\s\S]*?sameSoloProjectionJob\(currentJob, job\)[\s\S]*?requirePending: true/,
  );
  assert.match(reconciliation, /transaction\.delete\(jobSnapshot\.ref\)/);
  assert.match(reconciliation, /jobSnapshot\.ref\.parent\.parent/);
  assert.ok(
    reconciliation.indexOf("await prepareSoloProfileProjectionJob(jobSnapshot, lease)")
      < reconciliation.indexOf("const soloRef = realtime.ref("),
  );
  assert.match(reconciliation, /projectionSequence: job\.projectionSequence/);
  assert.match(
    reconciliation,
    /let soloProjectionError = null[\s\S]*?projectNormalSoloProfile\(currentValue, event\)[\s\S]*?soloProjectionError = error[\s\S]*?return undefined[\s\S]*?if \(soloProjectionError\) throw soloProjectionError/,
  );
  assert.match(
    reconciliation,
    /let overallProjectionError = null[\s\S]*?projectOverallSoloProfile\(currentValue, soloProfile, event\)[\s\S]*?overallProjectionError = error[\s\S]*?return undefined[\s\S]*?if \(overallProjectionError\) throw overallProjectionError/,
  );
  assert.match(
    server,
    /function soloProjectionIsAppliedOrFenced[\s\S]*?serverProjectionReceiptOutcome\(profile, job\.resultToken\)[\s\S]*?profile\.serverProjectionSequence >= job\.projectionSequence/,
  );
  assert.match(reconciliation, /!soloProjectionIsAppliedOrFenced\(soloProfile, job\)/);
  assert.match(reconciliation, /!soloProjectionIsAppliedOrFenced\(overallProfile, job\)/);
  assert.match(reconciliation, /applySoloProfileProjectionJob\(jobSnapshot, lease\)/);
  assert.match(reconciliation, /quarantineSoloProfileProjectionJob\(jobSnapshot, lease\)/);
  assert.match(reconciliation, /\.orderBy\("projectionSequence", "asc"\)/);
  assert.match(
    reconciliation,
    /\.where\("pending", "==", true\)[\s\S]*?\.orderBy\("lastStartedAt", "asc"\)[\s\S]*?\.limit\(25\)/,
  );
  assert.match(reconciliation, /exports\.reconcileSoloProfileProjections = onSchedule\(\{/);
  assert.match(reconciliation, /schedule: "every 5 minutes"/);
  assert.match(reconciliation, /timeZone: "Asia\/Tokyo"/);
  assert.match(
    reconciliation,
    /for \(const queueSnapshot of queues\.docs\) \{[\s\S]*?try \{[\s\S]*?reconcileSoloProfileProjection\(queueSnapshot\.id\)[\s\S]*?catch \(error\)/,
  );
});

test("clients cannot inspect or mutate projection queues and reconciliation is caller-scoped", () => {
  const server = read("functions/index.js");
  const callable = sourceBetween(
    server,
    "exports.economyAction",
    "exports.valueMarketQueue",
  );
  assert.match(callable, /if \(action === "reconcile_solo_profile"\)/);
  assert.match(
    callable,
    /Reflect\.ownKeys\(request\.data\)\.some\(\(key\) => key !== "action"\)/,
  );
  assert.match(callable, /consumeSoloSessionActionRate\(uid, "reconcile_profile"\)/);
  assert.match(callable, /reconcileSoloProfileProjection\(uid\)/);
  assert.doesNotMatch(callable, /request\.data\?\.(?:uid|roomId|resultToken)/);

  const rules = read("firestore.rules");
  assert.match(
    rules,
    /match \/soloProfileProjectionQueues\/\{uid\} \{\s*allow read, write: if false;[\s\S]*?match \/jobs\/\{jobId\} \{\s*allow read, write: if false;/,
  );
});

test("new clients reconcile before queueing and never fall back while server projection is pending", () => {
  const client = read("online.js");
  const matchmaking = sourceBetween(
    client,
    "async function beginMatchmaking",
    "async function startPublicPresence",
  );
  assert.ok(
    matchmaking.indexOf("await reconcileSoloProfileBeforeMatchmaking(")
      < matchmaking.indexOf("await set(queueEntryRef, {"),
  );
  assert.match(matchmaking, /profileProjectionVersion: SOLO_STATS_PROJECTION_VERSION/);
  const claimLease = sourceBetween(
    client,
    "async function claimSoloSessionLease",
    "function clearSoloSessionHeartbeat",
  );
  assert.match(
    claimLease,
    /action: "claim",[\s\S]*?profileProjectionVersion: SOLO_STATS_PROJECTION_VERSION/,
  );
  assert.match(claimLease, /reason === "client-upgrade-required"/);

  const stats = sourceBetween(
    client,
    "async function commitOnlineStats",
    "async function sendChat",
  );
  assert.match(stats, /overallResult\?\.profileProjectionMode === "server-v2"/);
  assert.match(stats, /overallResult\.profileProjectionPending === true/);
  assert.match(
    stats,
    /current\?\.serverProjectionReceipts[\s\S]*?record\.serverProjectionReceipts = current\.serverProjectionReceipts/,
  );
  assert.match(
    stats,
    /Number\.isSafeInteger\(current\?\.serverProjectionSequence\)[\s\S]*?record\.serverProjectionSequence = current\.serverProjectionSequence/,
  );
  assert.ok(
    stats.indexOf('overallResult?.profileProjectionMode === "server-v2"')
      < stats.indexOf("runTransaction(ref(database, `online/profiles/"),
  );

  const overall = sourceBetween(
    client,
    "async function recordOverallResult",
    "function persistOverallRankingPreference",
  );
  assert.match(
    overall,
    /current\?\.serverProjectionReceipts[\s\S]*?record\.serverProjectionReceipts = current\.serverProjectionReceipts/,
  );
  assert.match(
    overall,
    /Number\.isSafeInteger\(current\?\.serverProjectionSequence\)[\s\S]*?record\.serverProjectionSequence = current\.serverProjectionSequence/,
  );
  const seed = sourceBetween(
    client,
    "function overallProfileSeed",
    "function normalizeOverallProfile",
  );
  assert.match(seed, /seed\.appliedResults = \{ \.\.\.soloProfile\.appliedResults \}/);
});

test("enrolled profiles reject markerless normal 1on1 claims before matchmaking", () => {
  const server = read("functions/index.js");
  const validation = sourceBetween(
    server,
    "function requireSoloSessionActionData",
    "function soloSessionActionRatePath",
  );
  assert.match(
    validation,
    /claim: new Set\(\[[\s\S]*?"profileProjectionVersion"[\s\S]*?\]\)/,
  );
  assert.match(
    validation,
    /value\.profileProjectionVersion !== SOLO_PROFILE_PROJECTION_VERSION/,
  );

  const claim = sourceBetween(
    server,
    "async function soloProfileProjectionClientUpgradeRequired",
    "async function heartbeatSoloSessionV2",
  );
  assert.match(claim, /soloProfileProjectionQueueRef\(uid\)\.get\(\)/);
  assert.match(claim, /profileProjectionEnrolled/);
  assert.match(claim, /serverProjectionSequence/);
  assert.match(claim, /reason: "client-upgrade-required"/);
  assert.ok(
    claim.indexOf("soloProfileProjectionClientUpgradeRequired(")
      < claim.indexOf("claimRef.transaction("),
  );
  assert.match(
    claim,
    /decision\.claim = \{[\s\S]*?profileProjectionVersion: SOLO_PROFILE_PROJECTION_VERSION/,
  );

  const session = read("functions/solo-session-v2.js");
  assert.match(
    session,
    /value\.profileProjectionVersion === 2[\s\S]*?normalizedClaim\?\.profileProjectionVersion === 2/,
  );
});

test("projection enrollment gate reads only markerless participants and honors the durable marker", async () => {
  const server = read("functions/index.js");
  const gate = sourceBetween(
    server,
    "async function soloProfileProjectionClientUpgradeRequired",
    "async function claimSoloSessionV2",
  );
  const reads = [];
  const published = [];
  const context = {
    SOLO_PROFILE_PROJECTION_VERSION: 2,
    publishSoloProfileProjectionEnrollment: async (uid) => {
      published.push(uid);
    },
    soloProfileProjectionEnrollmentRef: (uid) => ({
      get: async () => {
        reads.push(`enrollment:${uid}`);
        return { val: () => (uid === "legacy" ? 2 : null) };
      },
    }),
    soloProfileProjectionQueueRef: (uid) => ({
      get: async () => {
        reads.push(`queue:${uid}`);
        return {
          exists: uid === "queue-only",
          get: (field) => ({
            profileProjectionEnrolled: true,
            profileProjectionVersion: 2,
          })[field],
        };
      },
    }),
    realtime: {
      ref: (pathValue) => ({
        get: async () => {
          reads.push(pathValue);
          return { val: () => null };
        },
      }),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${gate}
this.soloProfileProjectionParticipantsUpgradeRequired =
  soloProfileProjectionParticipantsUpgradeRequired;`,
    context,
  );

  assert.equal(await context.soloProfileProjectionParticipantsUpgradeRequired([
    { uid: "current-a", profileProjectionVersion: 2 },
    { uid: "current-b", profileProjectionVersion: 2 },
  ]), false);
  assert.deepEqual(reads, []);

  assert.equal(await context.soloProfileProjectionParticipantsUpgradeRequired([
    { uid: "current-a", profileProjectionVersion: 2 },
    { uid: "legacy" },
  ]), true);
  assert.ok(reads.length >= 4);
  assert.equal(reads.some((entry) => entry.includes("current-a")), false);
  assert.equal(reads.includes("enrollment:legacy"), true);
  assert.deepEqual(published, []);

  assert.equal(await context.soloProfileProjectionParticipantsUpgradeRequired([
    { uid: "queue-only" },
  ]), true);
  assert.deepEqual(published, ["queue-only"]);
});

test("projection enrollment is re-gated at V2 and legacy room publication boundaries", () => {
  const server = read("functions/index.js");
  const v2Fence = sourceBetween(
    server,
    "async function readSoloSessionV2MaterializationFence",
    "async function trySoloSessionV2Match",
  );
  assert.match(v2Fence, /materializationFenceMatches/);
  assert.match(v2Fence, /soloProfileProjectionParticipantsUpgradeRequired/);

  const v2Matcher = sourceBetween(
    server,
    "async function trySoloSessionV2Match",
    "function soloSessionV2ActiveMatchesRoom",
  );
  assert.ok(
    (v2Matcher.match(/readSoloSessionV2MaterializationFence/g) || []).length >= 2,
    "V2 publication must recheck the projection fence before and after the multi-path write",
  );

  const accept = sourceBetween(
    server,
    "async function acceptSoloSessionV2Match",
    "async function cancelSoloSessionV2Match",
  );
  assert.match(
    accept,
    /room\?\.status === "offered"[\s\S]*?soloProfileProjectionParticipantsUpgradeRequired/,
  );

  const legacyMaterializer = sourceBetween(
    server,
    "async function materializeSoloHostedMatch",
    "async function trySoloServerMatch",
  );
  assert.ok(
    (legacyMaterializer.match(/soloProfileProjectionParticipantsUpgradeRequired/g) || [])
      .length >= 3,
    "legacy publication must gate before reservation, before room write, and before return",
  );
  const legacyMatcher = sourceBetween(
    server,
    "async function trySoloServerMatch",
    "async function confirmSoloFamiliarReunionFromRoom",
  );
  assert.ok(
    (legacyMatcher.match(/soloProfileProjectionParticipantsUpgradeRequired/g) || [])
      .length >= 2,
    "legacy requester and selected candidate must both be re-gated",
  );
});

test("projection publishes a durable enrollment fence and defers markerless live rooms", () => {
  const server = read("functions/index.js");
  const reconciliation = sourceBetween(
    server,
    "async function publishSoloProfileProjectionEnrollment",
    "async function reconcilePendingSoloProfileProjections",
  );
  assert.match(
    reconciliation,
    /soloProfileProjectionEnrollmentRef\(uid\)[\s\S]*?SOLO_PROFILE_PROJECTION_VERSION/,
  );
  const reconcile = sourceBetween(
    server,
    "async function reconcileSoloProfileProjection",
    "async function reconcilePendingSoloProfileProjections",
  );
  assert.ok(
    reconcile.indexOf("await publishSoloProfileProjectionEnrollment(uid)")
      < reconcile.indexOf("await soloProfileProjectionHasIncompatibleLiveRoom(uid)"),
  );
  assert.ok(
    reconcile.indexOf("await soloProfileProjectionHasIncompatibleLiveRoom(uid)")
      < reconcile.indexOf('queueRef.collection("jobs")'),
  );
  assert.match(
    reconcile,
    /releaseSoloProfileProjectionLease\(uid, lease, \{\s*pending: true/,
  );

  const rules = JSON.parse(read("database.rules.json")).rules.online;
  assert.equal(rules.soloProfileProjectionEnrollments.$uid[".read"], false);
  assert.equal(rules.soloProfileProjectionEnrollments.$uid[".write"], false);
  assert.match(
    rules.queue.$uid[".write"],
    /soloProfileProjectionEnrollments/,
  );
  assert.match(
    rules.queueV2.$uid.$sessionId[".write"],
    /soloProfileProjectionEnrollments[\s\S]*?profileProjectionVersion/,
  );
  assert.match(
    rules.active.$uid[".write"],
    /soloProfileProjectionEnrollments/,
  );
  assert.match(
    rules.rooms.$roomId.status[".validate"],
    /soloProfileProjectionEnrollments/,
  );
  assert.doesNotMatch(
    rules.strategyRooms.$roomId.status[".validate"],
    /soloProfileProjectionEnrollments/,
  );
});

test("projection live-room defer distinguishes legacy and marked V2 rooms", async () => {
  const server = read("functions/index.js");
  const liveRoomGate = sourceBetween(
    server,
    "async function soloProfileProjectionHasIncompatibleLiveRoom",
    "async function acquireSoloProfileProjectionLease",
  );
  async function run({ legacyRoom = null, v2Room = null, room = null } = {}) {
    const context = {
      SOLO_PROFILE_PROJECTION_VERSION: 2,
      liveLegacySoloRoom: async () => legacyRoom,
      liveSoloSessionV2Room: async () => v2Room,
      realtime: {
        ref: () => ({
          get: async () => ({ val: () => room }),
        }),
      },
    };
    vm.createContext(context);
    vm.runInContext(
      `${liveRoomGate}
this.soloProfileProjectionHasIncompatibleLiveRoom =
  soloProfileProjectionHasIncompatibleLiveRoom;`,
      context,
    );
    return context.soloProfileProjectionHasIncompatibleLiveRoom("owner", Date.now());
  }

  assert.equal(await run({
    legacyRoom: { roomId: "legacy-room", status: "active" },
  }), true);
  assert.equal(await run({
    v2Room: { roomId: "v2-room", status: "active" },
    room: {
      players: {
        owner: { uid: "owner", profileProjectionVersion: 2 },
      },
    },
  }), false);
  assert.equal(await run({
    v2Room: { roomId: "v2-room", status: "offered" },
    room: {
      players: {
        owner: { uid: "owner" },
      },
    },
  }), true);
});

test("Firestore indexes support fair pending projection queue scheduling", () => {
  const indexes = JSON.parse(read("firestore.indexes.json"));
  assert.ok(indexes.indexes.some((index) => (
    index.collectionGroup === "soloProfileProjectionQueues"
      && index.queryScope === "COLLECTION"
      && index.fields?.[0]?.fieldPath === "pending"
      && index.fields?.[0]?.order === "ASCENDING"
      && index.fields?.[1]?.fieldPath === "lastStartedAt"
      && index.fields?.[1]?.order === "ASCENDING"
  )));
});
