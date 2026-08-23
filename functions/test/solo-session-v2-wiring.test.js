"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("soloSessionAction is a dedicated App-Check-enforced callable", () => {
  const rollout = require("../app-check-rollout");
  const source = read("functions/index.js");
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.soloSessionAction, true);
  assert.match(
    source,
    /exports\.soloSessionAction = onCall\(callableOptions\("soloSessionAction"\)/,
  );
  for (const action of [
    "claim",
    "heartbeat",
    "release",
    "try_match",
    "accept",
    "cancel",
    "expire",
  ]) {
    assert.match(source, new RegExp(`data\\.action === "${action}"`));
  }
});

test("V2 matching uses the bounded server index and point-validates canonical V2 records", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function trySoloSessionV2Match");
  const end = source.indexOf("function soloSessionV2ResourcesFromStored", start);
  const matcher = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(matcher, /soloSessionV2QueueIndex\.publish/);
  assert.match(matcher, /soloSessionV2QueueIndex\.loadFresh/);
  assert.match(matcher, /soloSessionQueueRef\(uid, claim\.sessionId\)\.get/);
  assert.match(matcher, /online\/soloSessionClaims/);
  assert.match(matcher, /soloSessionActiveRef\(\s*candidateSelection\.candidate\.uid/);
  assert.match(matcher, /offersV2\//);
  assert.match(matcher, /soloMatchPermitsV2\//);
  assert.match(matcher, /online\/soloMatchLocksV2/);
  assert.doesNotMatch(matcher, /realtime\.ref\("online\/queueV2"\)\.get/);
  assert.doesNotMatch(matcher, /realtime\.ref\("online\/activeV2"\)\.get/);
  assert.doesNotMatch(matcher, /realtime\.ref\("online\/soloMatchLocksV2"\)\.get/);
  assert.doesNotMatch(matcher, /realtime\.ref\("online\/active"\)\.get/);
  assert.doesNotMatch(matcher, /boundedSoloServerQueue\(uid/);
  assert.doesNotMatch(matcher, /realtime\.ref\("online\/queue"\)\.get/);
  assert.match(matcher, /for \(let attempt = 0; attempt < 8; attempt \+= 1\)/);
  assert.match(
    matcher,
    /liveLegacySoloRoom\(candidateSelection\.candidate\.uid, Date\.now\(\)\)/,
  );
  assert.match(matcher, /reselectSoloSessionV2Match/);
  assert.match(matcher, /host: hostQueue/);
  assert.match(matcher, /candidate: guestQueue/);
  assert.match(matcher, /lockedUids: \[\.\.\.unavailableUids\]/);
  assert.match(matcher, /rebuildSoloSessionV2Resources\(selection, resources\)/);
  assert.match(matcher, /waitingSoloSessionV2ReservationEntry\(reservedHost\)/);
  assert.match(matcher, /readSoloSessionV2MaterializationFence/);
  assert.match(matcher, /cleanupSoloSessionV2Match/);
  const insufficientQueueReturn = matcher.indexOf(
    "if (!boundedQueue[uid] || Object.keys(boundedQueue).length < 2)",
  );
  const reunionRolloutRead = matcher.indexOf("readSoloFamiliarReunionEnabled()");
  assert.ok(insufficientQueueReturn >= 0);
  assert.ok(reunionRolloutRead > insufficientQueueReturn);
  assert.match(
    matcher,
    /reunionEnabled\s*\? soloFamiliarPairRef\(selection\.host\.uid, selection\.candidate\.uid\)\.get\(\)/,
  );
  assert.match(matcher, /const canonicalFamiliarPairs = reunionEnabled/);
  assert.doesNotMatch(matcher, /rollout\.reunionEnabled/);
  assert.doesNotMatch(matcher, /loadSoloFamiliarRollout\(\)/);
});

test("stale legacy active pointers require a grace observation and exact-value cleanup", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function liveLegacySoloRoom");
  const end = source.indexOf("async function liveSoloSessionV2Room", start);
  const inspector = source.slice(start, end);
  assert.match(inspector, /legacySoloRoomPreparationIsLive/);
  assert.match(inspector, /SOLO_MATCH_CONTEXT_RECOVERY_GRACE_MS/);
  assert.match(inspector, /roomFingerprint/);
  assert.match(inspector, /activeRecheck/);
  assert.match(inspector, /presenceUpdatedAt >= now - SOLO_LEGACY_PRESENCE_FRESH_MS/);
  assert.match(inspector, /presenceUpdatedAt <= now \+ 15_000/);
  assert.match(inspector, /removeStaleLegacySoloActive\(uid, activeValue\)/);
  const removalStart = source.indexOf("async function removeStaleLegacySoloActive");
  const removalEnd = start;
  const removal = source.slice(removalStart, removalEnd);
  assert.match(removal, /legacySoloActiveValueMatches\(currentValue, expectedValue\)/);
  assert.doesNotMatch(inspector, /remove\(realtime\.ref\(`online\/active/);
});

test("stale V2 active reservations are fenced, bounded, and terminate abandoned rooms", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("function exactSoloSessionV2ActiveIdentity");
  const end = source.indexOf("function soloSessionClaimResponse", start);
  const inspector = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(inspector, /connectionGeneration === expected\?\.connectionGeneration/);
  assert.match(inspector, /\.slice\(0, 50\)/);
  assert.match(inspector, /roomPresence\.updatedAt/);
  assert.match(inspector, /now - SOLO_SESSION_LEASE_TTL_MS - 15_000/);
  assert.match(inspector, /!room\.destroyed/);
  assert.match(inspector, /removeExpiredSoloSessionV2Active/);
  assert.match(inspector, /markAbandonedSoloSessionV2RoomDestroyed/);
  assert.match(inspector, /destroyed: \{\s*by: uid,\s*at: Date\.now\(\)/s);
  assert.doesNotMatch(inspector, /\.remove\(\)/);
});

test("claim treats live legacy rooms as occupied without deleting legacy state", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function claimSoloSessionV2");
  const end = source.indexOf("async function heartbeatSoloSessionV2", start);
  const claim = source.slice(start, end);
  assert.match(claim, /liveLegacySoloRoom/);
  assert.match(claim, /acquireSoloSessionClaimGuard/);
  assert.match(claim, /rollbackClaimValue/);
  assert.match(claim, /\? rollbackClaimValue : undefined/);
  assert.match(claim, /reason: "occupied"/);
  assert.doesNotMatch(claim, /online\/active\/\$\{uid\}.*(?:remove|transaction)/s);
  assert.doesNotMatch(claim, /remove\(.*online\/rooms/s);
});

test("claim replacement cleans only resources carrying the exact prior fence", () => {
  const source = read("functions/index.js");
  const cleanupStart = source.indexOf(
    "async function removeReplacedSoloSessionV2Resource",
  );
  const cleanupEnd = source.indexOf("async function claimSoloSessionV2", cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.match(
    cleanup,
    /replacedClaimResourceFence\(previousClaim, committedClaim\)/,
  );
  assert.match(cleanup, /soloSessionQueueRef\(uid, fence\.sessionId\)/);
  assert.match(cleanup, /soloSessionActiveRef\(uid, fence\.sessionId\)/);
  assert.match(
    cleanup,
    /resourceFenceMatches\(currentValue, fence\) \? null : undefined/,
  );
  assert.doesNotMatch(cleanup, /!resourceFenceMatches\(currentValue, fence\)/);

  const claimStart = source.indexOf("async function claimSoloSessionV2");
  const claimEnd = source.indexOf("async function heartbeatSoloSessionV2", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  assert.match(
    claim,
    /cleanupReplacedSoloSessionV2ClaimResources\(\s*uid,\s*rollbackClaimValue,\s*committedClaim/s,
  );
  assert.match(claim, /solo session replacement cleanup failed/);
  assert.doesNotMatch(claim, /decision\.reason === "same-session-takeover"/);
});

test("claim guard outlives the callable and is safely renewed before commit", () => {
  const source = read("functions/index.js");
  const guardTtl = Number(
    source.match(/const SOLO_SESSION_CLAIM_GUARD_TTL_MS = ([\d_]+);/)?.[1]
      ?.replaceAll("_", ""),
  );
  const callableTimeoutSeconds = Number(
    source.match(/const CALLABLE_BASE_OPTIONS = Object\.freeze\(\{\s*timeoutSeconds: (\d+)/s)?.[1],
  );
  assert.ok(guardTtl > callableTimeoutSeconds * 1_000);
  const renewStart = source.indexOf("async function renewSoloSessionClaimGuard");
  const renewEnd = source.indexOf("async function releaseSoloSessionClaimGuard", renewStart);
  const renew = source.slice(renewStart, renewEnd);
  assert.match(renew, /if \(currentValue == null\) return null/);
  assert.match(renew, /soloSessionClaimGuardMatches/);
  assert.match(renew, /Number\(currentValue\.expiresAt \|\| 0\) <= now/);
  assert.match(renew, /now \+ SOLO_SESSION_CLAIM_GUARD_TTL_MS/);

  const claimStart = source.indexOf("async function claimSoloSessionV2");
  const claimEnd = source.indexOf("async function heartbeatSoloSessionV2", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  const renewal = claim.indexOf(
    "const renewedClaimGuard = await renewSoloSessionClaimGuard",
  );
  const commit = claim.indexOf("const result = await claimRef.transaction");
  assert.ok(renewal >= 0 && commit > renewal);
  assert.match(claim, /const claimGuard = needsClaimGuard/);
  assert.doesNotMatch(claim, /claimGuard = await renewSoloSessionClaimGuard/);
  assert.doesNotMatch(claim, /claimGuard = renewedClaimGuard/);
  assert.match(claim, /claimGuardAfterClaimSnapshot/);
  assert.match(claim, /claimGuardStillOwned/);
  assert.match(claim, /legacyLockAfterClaimSnapshot/);
});

test("claim guard renewal retries a cold-cache null without stealing another operation", async () => {
  const source = read("functions/index.js");
  const matchesStart = source.indexOf("function soloSessionClaimGuardMatches");
  const matchesEnd = source.indexOf("async function acquireSoloSessionClaimGuard", matchesStart);
  const renewStart = source.indexOf("async function renewSoloSessionClaimGuard");
  const renewEnd = source.indexOf("async function releaseSoloSessionClaimGuard", renewStart);
  assert.ok(matchesStart >= 0 && matchesEnd > matchesStart);
  assert.ok(renewStart >= 0 && renewEnd > renewStart);

  const now = 1_780_000_000_000;
  const ownGuard = {
    protocolVersion: 2,
    kind: "claim",
    operationId: "own-operation",
    sessionId: "session-token",
    leaseToken: "lease-token",
    acquiredAt: now - 1_000,
    expiresAt: now + 20_000,
  };
  const otherGuard = {
    ...ownGuard,
    operationId: "other-operation",
  };

  const runRenewal = async (serverGuard) => {
    const callbackInputs = [];
    const reference = {
      transaction: async (update) => {
        callbackInputs.push(null);
        const initialOutput = update(null);
        assert.equal(initialOutput, null);

        callbackInputs.push(serverGuard);
        const serverOutput = update(serverGuard);
        return {
          committed: serverOutput !== undefined,
          snapshot: {
            val: () => serverOutput === undefined ? serverGuard : serverOutput,
          },
        };
      },
    };
    const context = {
      Date: { now: () => now },
      realtime: { ref: () => reference },
      SOLO_SESSION_CLAIM_GUARD_TTL_MS: 60_000,
      SOLO_SESSION_PROTOCOL_VERSION: 2,
    };
    vm.createContext(context);
    vm.runInContext(
      `${source.slice(matchesStart, matchesEnd)}
${source.slice(renewStart, renewEnd)}
this.renewSoloSessionClaimGuard = renewSoloSessionClaimGuard;`,
      context,
    );
    return {
      callbackInputs,
      result: await context.renewSoloSessionClaimGuard("owner", ownGuard),
    };
  };

  const ownResult = await runRenewal(ownGuard);
  assert.equal(ownResult.callbackInputs.length, 2);
  assert.equal(ownResult.result.operationId, ownGuard.operationId);
  assert.equal(ownResult.result.expiresAt, now + 60_000);

  const otherResult = await runRenewal(otherGuard);
  assert.equal(otherResult.callbackInputs.length, 2);
  assert.equal(otherResult.result, null);
});

test("heartbeat retries cold-cache null before refreshing the exact claim and resources", async () => {
  const source = read("functions/index.js");
  const heartbeatStart = source.indexOf("async function heartbeatSoloSessionV2");
  const heartbeatEnd = source.indexOf(
    "async function removeSoloSessionResourceIfFenced",
    heartbeatStart,
  );
  assert.ok(heartbeatStart >= 0 && heartbeatEnd > heartbeatStart);

  const {
    heartbeatDecision,
    normalizeClaim,
    resourceFenceMatches,
  } = require("../solo-session-v2");
  const now = 1_780_000_000_000;
  const ownClaim = {
    protocolVersion: 2,
    sessionId: "session-token-12345678",
    leaseToken: "lease-token-1234567890",
    generation: "generation-token-123456",
    claimedAt: now - 10_000,
    heartbeatAt: now - 10_000,
    expiresAt: now + 20_000,
  };
  const exactResource = {
    ...ownClaim,
    uid: "owner",
    state: "waiting",
    joinedAt: now - 10_000,
    lastSeen: now - 10_000,
  };

  const callbackInputs = {
    claim: [],
    queue: [],
    active: [],
  };
  const committedValues = {};
  const coldReference = (key, serverValue) => ({
    transaction: async (updateValue) => {
      callbackInputs[key].push(null);
      const coldOutput = updateValue(null);
      assert.equal(coldOutput, null);
      if (serverValue == null) {
        committedValues[key] = null;
        return {
          committed: true,
          snapshot: { val: () => null },
        };
      }
      callbackInputs[key].push(serverValue);
      const serverOutput = updateValue(serverValue);
      committedValues[key] = serverOutput === undefined ? serverValue : serverOutput;
      return {
        committed: serverOutput !== undefined,
        snapshot: {
          val: () => committedValues[key],
        },
      };
    },
  });
  const context = {
    Date: { now: () => now },
    SOLO_SESSION_LEASE_TTL_MS: 60_000,
    heartbeatDecision,
    normalizeClaim,
    resourceFenceMatches,
    queueEntryMatchesClaim: () => false,
    soloSessionV2QueueIndex: {
      publish: async () => null,
      remove: async () => true,
    },
    soloSessionClaimRef: () => coldReference("claim", ownClaim),
    soloSessionQueueRef: () => coldReference("queue", exactResource),
    soloSessionActiveRef: () => coldReference("active", exactResource),
    soloSessionClaimResponse: (claim, reason) => ({
      claimed: true,
      reason,
      lease: claim,
      sessionGeneration: claim.generation,
    }),
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(heartbeatStart, heartbeatEnd)}
this.heartbeatSoloSessionV2 = heartbeatSoloSessionV2;`,
    context,
  );

  const result = await context.heartbeatSoloSessionV2("owner", {
    sessionId: ownClaim.sessionId,
    leaseToken: ownClaim.leaseToken,
    generation: ownClaim.generation,
  });

  assert.equal(result.claimed, true);
  assert.equal(result.reason, "refreshed");
  assert.equal(result.sessionGeneration, ownClaim.generation);
  assert.equal(result.lease.expiresAt, now + 60_000);
  assert.equal(callbackInputs.claim.length, 2);
  assert.equal(callbackInputs.queue.length, 2);
  assert.equal(callbackInputs.active.length, 2);
  assert.equal(committedValues.queue.expiresAt, now + 60_000);
  assert.equal(committedValues.queue.lastSeen, now);
  assert.equal(committedValues.active.expiresAt, now + 60_000);
  assert.equal(committedValues.active.lastSeen, now);
});

test("heartbeat cold-cache probe never steals a missing or different claim", async () => {
  const source = read("functions/index.js");
  const heartbeatStart = source.indexOf("async function heartbeatSoloSessionV2");
  const heartbeatEnd = source.indexOf(
    "async function removeSoloSessionResourceIfFenced",
    heartbeatStart,
  );
  const {
    heartbeatDecision,
    normalizeClaim,
    resourceFenceMatches,
  } = require("../solo-session-v2");
  const now = 1_780_000_000_000;
  const requested = {
    sessionId: "session-token-12345678",
    leaseToken: "lease-token-1234567890",
    generation: "generation-token-123456",
  };
  const runHeartbeat = async (serverClaim) => {
    const callbackInputs = [];
    const claimReference = {
      transaction: async (updateValue) => {
        callbackInputs.push(null);
        const coldOutput = updateValue(null);
        assert.equal(coldOutput, null);
        if (serverClaim == null) {
          return {
            committed: true,
            snapshot: { val: () => null },
          };
        }
        callbackInputs.push(serverClaim);
        const serverOutput = updateValue(serverClaim);
        return {
          committed: serverOutput !== undefined,
          snapshot: {
            val: () => serverOutput === undefined ? serverClaim : serverOutput,
          },
        };
      },
    };
    const context = {
      Date: { now: () => now },
      SOLO_SESSION_LEASE_TTL_MS: 60_000,
      heartbeatDecision,
      normalizeClaim,
      resourceFenceMatches,
      soloSessionClaimRef: () => claimReference,
      soloSessionQueueRef: () => {
        throw new Error("lost claim must not touch queue");
      },
      soloSessionActiveRef: () => {
        throw new Error("lost claim must not touch active");
      },
      soloSessionClaimResponse: () => {
        throw new Error("lost claim must not return a refreshed lease");
      },
    };
    vm.createContext(context);
    vm.runInContext(
      `${source.slice(heartbeatStart, heartbeatEnd)}
this.heartbeatSoloSessionV2 = heartbeatSoloSessionV2;`,
      context,
    );
    return {
      callbackInputs,
      result: await context.heartbeatSoloSessionV2("owner", requested),
    };
  };

  const missing = await runHeartbeat(null);
  assert.equal(missing.callbackInputs.length, 1);
  assert.equal(missing.result.claimed, false);
  assert.equal(missing.result.reason, "lease-lost");

  const different = await runHeartbeat({
    protocolVersion: 2,
    ...requested,
    generation: "other-generation-123456",
    claimedAt: now - 10_000,
    heartbeatAt: now - 10_000,
    expiresAt: now + 20_000,
  });
  assert.equal(different.callbackInputs.length, 2);
  assert.equal(different.result.claimed, false);
  assert.equal(different.result.reason, "lease-lost");
});

test("failed claim guard renewal still releases the originally acquired guard", async () => {
  const source = read("functions/index.js");
  const claimStart = source.indexOf("async function claimSoloSessionV2");
  const claimEnd = source.indexOf("async function heartbeatSoloSessionV2", claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);

  const nullSnapshot = { val: () => null };
  const acquiredGuard = {
    protocolVersion: 2,
    kind: "claim",
    operationId: "own-operation",
    sessionId: "session-token",
    leaseToken: "lease-token",
    acquiredAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  const releaseCalls = [];
  const context = {
    acquireSoloSessionClaimGuard: async () => acquiredGuard,
    isValidSoloServerQueueEntry: () => false,
    liveLegacySoloRoom: async () => null,
    liveSoloSessionV2Room: async () => null,
    normalizeClaim: () => null,
    realtime: {
      ref: () => ({ get: async () => nullSnapshot }),
    },
    releaseSoloSessionClaimGuard: async (uid, guard) => {
      releaseCalls.push({ uid, guard });
      return true;
    },
    renewSoloSessionClaimGuard: async () => null,
    soloProfileProjectionClientUpgradeRequired: async () => false,
    soloSessionClaimRef: () => ({ get: async () => nullSnapshot }),
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(claimStart, claimEnd)}
this.claimSoloSessionV2 = claimSoloSessionV2;`,
    context,
  );

  const result = await context.claimSoloSessionV2("owner", {
    sessionId: acquiredGuard.sessionId,
    leaseToken: acquiredGuard.leaseToken,
  });

  assert.equal(result.claimed, false);
  assert.equal(result.reason, "occupied");
  assert.equal(releaseCalls.length, 1);
  assert.equal(releaseCalls[0].uid, "owner");
  assert.equal(releaseCalls[0].guard, acquiredGuard);
});

test("claim checks fresh legacy waiting state before, under, and after its guard", () => {
  const source = read("functions/index.js");
  const claimStart = source.indexOf("async function claimSoloSessionV2");
  const claimEnd = source.indexOf("async function heartbeatSoloSessionV2", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  assert.ok(
    (claim.match(/online\/queue\/\$\{uid\}/g) || []).length >= 3,
    "legacy queue must be re-read at every claim fence",
  );
  assert.ok(
    (claim.match(/isValidSoloServerQueueEntry/g) || []).length >= 3,
    "legacy queue freshness must be checked at every claim fence",
  );
  assert.match(claim, /const lockCheckNow = Date\.now\(\)/);
  assert.match(claim, /reason: "legacy-waiting"/);
});

test("legacy and V2 matchmaking mutually fence rolling-upgrade sessions", () => {
  const source = read("functions/index.js");
  const legacyStart = source.indexOf("async function trySoloServerMatch");
  const legacyEnd = source.indexOf(
    "async function confirmSoloFamiliarReunionFromRoom",
    legacyStart,
  );
  const legacy = source.slice(legacyStart, legacyEnd);
  assert.ok(legacyStart >= 0 && legacyEnd > legacyStart);
  assert.match(legacy, /soloSessionClaimRef\(uid\)\.get\(\)/);
  assert.match(legacy, /liveSoloSessionV2Room\(uid, requestStartedAt\)/);
  assert.match(legacy, /soloSessionClaimRef\(selection\.host\.uid\)\.get\(\)/);
  assert.match(legacy, /soloSessionClaimRef\(selection\.candidate\.uid\)\.get\(\)/);
  assert.match(legacy, /online\/soloMatchLocksV2\/\$\{selection\.host\.uid\}/);
  assert.match(legacy, /online\/soloMatchLocksV2\/\$\{selection\.candidate\.uid\}/);
  assert.match(legacy, /liveSoloSessionV2Room\(selection\.host\.uid/);
  assert.match(legacy, /liveSoloSessionV2Room\(selection\.candidate\.uid/);
  assert.match(legacy, /if \(!freshAndWaiting \|\| v2SessionConflict/);
  assert.match(legacy, /releaseSoloMatchPermitLocks\(roomId, participantUids\)/);

  const claimStart = source.indexOf("async function claimSoloSessionV2");
  const claimEnd = source.indexOf("async function heartbeatSoloSessionV2", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  assert.match(claim, /online\/soloMatchPermitLocks\/\$\{uid\}/);
  assert.match(claim, /legacyLockUnderGuardSnapshot/);
  assert.match(claim, /Number\(legacyLockUnderGuardSnapshot\.val\(\)\?\.expiresAt \|\| 0\)/);
});

test("rollout deploys every existing callable carrying a V2 compatibility fence", () => {
  const readme = read("README.md");
  const command = readme.match(
    /firebase-tools deploy --only (functions:soloSessionAction[^\r\n]+) --non-interactive/,
  )?.[1] || "";
  for (const functionName of [
    "functions:soloSessionAction",
    "functions:getP2pIceServers",
    "functions:reportP2pConnectivity",
    "functions:cleanupP2pDiagnostics",
    "functions:soloFamiliarAction",
    "functions:accountTransfer",
  ]) {
    assert.match(command, new RegExp(`(?:^|,)${functionName}(?:,|$)`));
  }
  assert.match(readme, /Functions配備完了から90秒以上待つ/);
});

test("release and failed selection clean only exact V2 fences", () => {
  const source = read("functions/index.js");
  const releaseStart = source.indexOf("async function releaseSoloSessionV2");
  const releaseEnd = source.indexOf("function boundedSoloSessionV2Queue", releaseStart);
  const release = source.slice(releaseStart, releaseEnd);
  assert.match(release, /current\.sessionId !== data\.sessionId/);
  assert.match(release, /current\.leaseToken !== data\.leaseToken/);
  assert.match(release, /current\.generation !== data\.generation/);
  assert.match(release, /releasedClaim\.generation !== data\.generation/);
  assert.match(release, /removeSoloSessionResourceIfFenced/);

  const cleanupStart = source.indexOf("async function cleanupSoloSessionV2Match");
  const cleanupEnd = source.indexOf("async function readSoloSessionV2MaterializationFence", cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /recordAttemptMatches/);
  assert.match(cleanup, /restoreSoloSessionV2Queue/);
  assert.match(cleanup, /releaseSoloSessionV2Locks/);
});

test("accept refreshes exact active children before publishing and preserves active cleanup retries", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function acceptSoloSessionV2Match");
  const end = source.indexOf("async function cancelSoloSessionV2Match", start);
  const accept = source.slice(start, end);
  assert.match(accept, /queueEntryMatchesClaim/);
  assert.match(accept, /\{ allowedStates: \["reserved"\] \}/);
  assert.match(accept, /soloSessionActiveRef\(uid, data\.sessionId\)\s*\.transaction/);
  assert.match(accept, /acquireSoloSessionV2RoomTransition/);
  assert.match(accept, /roomTransitionOwned\(finalRoom\.val\(\), "accept", transition\.token\)/);
  assert.match(accept, /activateSoloSessionV2Room/);
  assert.match(accept, /completeAcceptedSoloSessionV2Match/);
  assert.match(accept, /reuseExistingAction: true/);
  assert.match(accept, /preserveOrAbortIncompleteSoloSessionV2Acceptance/);
  assert.match(accept, /recoverSoloSessionV2PreActiveMatch/);
  const recoveryStart = source.indexOf("async function recoverSoloSessionV2PreActiveMatch");
  const recoveryEnd = source.indexOf("async function finalizeAcceptedSoloSessionV2Match", recoveryStart);
  const recovery = source.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /cleanupSoloSessionV2Match\(resources, \{/);
  assert.match(recovery, /restoreQueue: true/);
  assert.match(recovery, /transitionAction: "accept"/);
  assert.doesNotMatch(accept, /abortFailedSoloSessionV2Activation/);
  assert.ok(
    accept.lastIndexOf("refreshSoloSessionV2ActivePair")
      < accept.lastIndexOf("activateSoloSessionV2Room"),
  );
  assert.doesNotMatch(accept, /rooms\/\$\{data\.roomId\}\/status/);
  assert.doesNotMatch(accept, /realtime\.ref\("online"\)\.update/);
  assert.match(accept, /acceptedSoloSessionV2Response/);
});

test("expired claims do not count toward the V2 matching read cap", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function trySoloSessionV2Match");
  const end = source.indexOf("function soloSessionV2ActiveMatchesRoom", start);
  const matcher = source.slice(start, end);
  assert.match(matcher, /orderByChild\("expiresAt"\)/);
  assert.match(matcher, /\.startAt\(selectionNow \+ 1\)/);
  assert.match(matcher, /\.limitToFirst\(2_000\)/);
  assert.doesNotMatch(matcher, /claimsSnapshot\.numChildren\(\)/);
});

test("the V2 queue index has only bounded indexed cleanup", () => {
  const source = read("functions/index.js");
  const indexSource = read("functions/solo-session-v2-queue-index.js");
  const start = source.indexOf("exports.cleanupSoloSessionV2QueueIndex = onSchedule");
  const end = source.indexOf("async function saveMarketPublicProfile", start);
  const scheduled = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(scheduled, /soloSessionV2QueueIndex\.cleanupExpired\(Date\.now\(\)\)/);
  assert.doesNotMatch(scheduled, /queueV2|activeV2|soloSessionClaims|soloMatchLocksV2/);
  assert.match(indexSource, /orderByChild\("expiresAt"\)/);
  assert.match(indexSource, /\.endAt\(now\)/);
  assert.match(indexSource, /\.limitToFirst\(cleanupBatchSize\)/);
  assert.match(indexSource, /queueIndexEntryMatchesFence\(currentValue, expected\)/);
  assert.match(indexSource, /Number\(currentValue\.expiresAt \|\| 0\) <= now/);
});

test("expired V2 claims and active pointers use a separate bounded CAS cleanup", () => {
  const source = read("functions/index.js");
  const cleanupSource = read("functions/solo-session-v2-resource-cleanup.js");
  const start = source.indexOf("exports.cleanupSoloSessionV2Leases = onSchedule");
  const end = source.indexOf("exports.cleanupSoloSessionV2QueueIndex = onSchedule", start);
  const scheduled = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(scheduled, /schedule: "every 5 minutes"/);
  assert.match(scheduled, /timeZone: "Asia\/Tokyo"/);
  assert.match(scheduled, /timeoutSeconds: 60/);
  assert.match(scheduled, /memory: "256MiB"/);
  assert.match(scheduled, /maxInstances: 1/);
  assert.match(scheduled, /cleanupSoloSessionV2Resources\(Date\.now\(\)\)/);
  assert.doesNotMatch(scheduled, /online\/rooms|destroyed|serverFinalized/);

  assert.match(cleanupSource, /orderByChild\("expiresAt"\)/);
  assert.match(cleanupSource, /\.startAt\(1\)/);
  assert.match(cleanupSource, /\.endAt\(cutoff\)/);
  assert.match(cleanupSource, /\.limitToFirst\(batchSize\)/);
  assert.match(cleanupSource, /staleCleanupV1/);
  assert.match(cleanupSource, /isDeepStrictEqual\(currentValue, candidate\.value\)/);
  assert.match(cleanupSource, /isDeepStrictEqual\(currentValue, expected\)/);
  assert.match(cleanupSource, /Number\(currentValue\.expiresAt\) > cutoff/);
  assert.doesNotMatch(cleanupSource, /realtime\.ref\(`online\/rooms\/\$\{[^}]+\}`\)\.transaction/);
  assert.doesNotMatch(cleanupSource, /realtime\.ref\("online\/activeV2"\)/);
});

test("cleanup never restores queues or releases locks after a fenced cleanup failure", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function cleanupSoloSessionV2Match");
  const end = source.indexOf("async function readSoloSessionV2MaterializationFence", start);
  const cleanup = source.slice(start, end);
  const cleanupGate = cleanup.indexOf("cleanupChecks.some");
  const restore = cleanup.indexOf("restoreSoloSessionV2Queue");
  const release = cleanup.indexOf("releaseSoloSessionV2Locks");
  assert.ok(cleanupGate >= 0 && restore > cleanupGate && release > restore);
  assert.match(cleanup, /if \(cleanupChecks\.some\(\(safe\) => !safe\)\) return false/);
  assert.match(cleanup, /if \(restored\.some\(\(safe\) => !safe\)\) return false/);
});

test("expire cannot terminate active V2 rooms and finalized matches reject active aborts", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function cancelSoloSessionV2Match");
  const end = source.indexOf("async function dispatchSoloSessionAction", start);
  const cancel = source.slice(start, end);
  assert.match(cancel, /expireOnly = false/);
  assert.match(cancel, /data\.abort === true/);
  assert.match(cancel, /if \(room\.status === "active"\)/);
  assert.match(cancel, /if \(room\.serverFinalized\)/);
  assert.match(cancel, /reason: "finalized"/);
  assert.match(cancel, /if \(!activeAbortRequested\)/);
  assert.match(cancel, /destroyActive: activeRoom/);
  const cleanupStart = source.indexOf("async function cleanupSoloSessionV2Match");
  const cleanupEnd = source.indexOf("async function readSoloSessionV2MaterializationFence", cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /currentValue\.status === "active" && currentValue\.serverFinalized/);
  assert.ok(
    cleanup.indexOf('currentValue.status === "active" && currentValue.serverFinalized')
      < cleanup.indexOf('reason: "session-abort"'),
  );
  const dispatchStart = source.indexOf("async function dispatchSoloSessionAction");
  const dispatchEnd = source.indexOf("exports.soloSessionAction", dispatchStart);
  assert.match(
    source.slice(dispatchStart, dispatchEnd),
    /cancelSoloSessionV2Match\(uid, data, \{ expireOnly: true \}\)/,
  );
});

test("V2 reunion confirmation is tied to the stored V2 permit before cleanup", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("function soloSessionV2ReunionPermitMatchesRoom");
  const end = source.indexOf("function acceptedSoloSessionV2Response", start);
  const confirmation = source.slice(start, end);
  assert.match(confirmation, /permit\?\.protocolVersion !== SOLO_SESSION_PROTOCOL_VERSION/);
  assert.match(confirmation, /room\.pairId !== pairId \|\| permit\.pairId !== pairId/);
  assert.match(confirmation, /room\.sessions\?\.\[participantUid\]\?\.sessionId/);
  assert.match(confirmation, /confirmSoloFamiliarReunionFromRoom/);
  assert.match(confirmation, /resources\.permitWasStored !== true/);
  const confirmIndex = confirmation.indexOf("confirmSoloFamiliarReunionV2");
  const permitRemovalIndex = confirmation.indexOf("soloMatchPermitsV2", confirmIndex);
  assert.ok(confirmIndex >= 0 && permitRemovalIndex > confirmIndex);
});

test("solo session errors never add authenticated UIDs to logs", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("exports.soloSessionAction");
  const end = source.indexOf("exports.economyAction", start);
  const callable = source.slice(start, end);
  assert.match(callable, /console\.error\("soloSessionAction failed"/);
  const logStart = callable.indexOf('console.error("soloSessionAction failed"');
  const logEnd = callable.indexOf(");", logStart);
  assert.doesNotMatch(callable.slice(logStart, logEnd), /\buid\b/);
});
