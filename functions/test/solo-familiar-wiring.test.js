const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("familiar acceptance is derived from a verified completed solo match", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function loadCompletedSoloFamiliarMatch");
  const end = source.indexOf("async function removeOrBlockSoloFamiliar", start);
  const familiarAcceptance = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(familiarAcceptance, /VERIFIED_MATCH_MODES\.solo/);
  assert.match(
    familiarAcceptance,
    /validatedOutcomes\("solo", room, participants,\s*\{\s*requireServerFinalized:/,
  );
  assert.match(familiarAcceptance, /verifiedMatchClaimRef\(participantUid, "solo", roomId\)/);
  assert.match(familiarAcceptance, /claimsVerified/);
  assert.match(familiarAcceptance, /soloFamiliarIntentRef\(uid, match\.roomId\)/);
  assert.match(familiarAcceptance, /canReactivateSoloFamiliarPair/);
  assert.match(familiarAcceptance, /return \{ received: true \};/);
  assert.doesNotMatch(familiarAcceptance, /data\?\.targetUid|strategyRooms|teamRooms|royaleRooms/);
});

test("relationship pairs do not retain duplicated display names", () => {
  const source = read("functions/index.js");
  const pairWriteStart = source.indexOf("transaction.set(pairRef");
  const pairWriteEnd = source.indexOf("transaction.set(firstBookRef", pairWriteStart);
  const pairWrite = source.slice(pairWriteStart, pairWriteEnd);
  assert.ok(pairWriteStart >= 0 && pairWriteEnd > pairWriteStart);
  assert.doesNotMatch(pairWrite, /\bnames\s*:/);
  assert.match(source, /displayName: match\.names\[secondUid\]/);
  assert.match(source, /displayName: match\.names\[firstUid\]/);
});

test("familiar and block records remain behind a callable-only boundary", () => {
  const rules = read("firestore.rules");
  for (const collection of [
    "soloFamiliarIntents",
    "soloFamiliarPairs",
    "soloFamiliarBooks",
    "soloFamiliarBlocks",
    "soloFamiliarBlockPairs",
    "soloFamiliarReunions",
  ]) {
    assert.match(rules, new RegExp(`match /${collection}/`));
  }
  assert.ok(
    (rules.match(/allow read, write: if false;/g) || []).length >= 6,
    "new relationship collections must not be directly readable",
  );

  const rollout = require("../app-check-rollout");
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.soloFamiliarAction, true);
  const source = read("functions/index.js");
  assert.match(source, /exports\.soloFamiliarAction = onCall\(callableOptions\("soloFamiliarAction"\)/);
  assert.match(source, /if \(action === "try_match"\) return await trySoloServerMatch\(uid\);/);
  assert.doesNotMatch(source, /trySoloServerMatch\(uid,\s*request\.data/);
  assert.match(source, /if \(action === "get_blocks"\)/);
  assert.match(source, /requesterUid: uid/);
  assert.match(source, /\.where\("participants", "array-contains", participantUid\)/);
  assert.doesNotMatch(source, /querySoloPairDocuments[\s\S]{0,1200}array-contains-any/);
  assert.match(source, /const boundedQueue = boundedSoloServerQueue\(uid, queue, selectionNow\)/);
  assert.match(source, /blockedSoloPairIdsForQueue\(uid, boundedQueue, selectionNow\)/);
  assert.match(source, /soloFamiliarBlockPairRef\(uid, candidateUid\)/);
});

test("V2 server matchmaking materializes fenced room and offer records", () => {
  const backend = read("functions/index.js");
  const frontend = read("online.js");
  const start = backend.indexOf("async function trySoloSessionV2Match");
  const end = backend.indexOf("function soloSessionV2ResourcesFromStored", start);
  const materializer = backend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(materializer, /buildSoloSessionV2Resources/);
  assert.match(materializer, /readSoloSessionV2MaterializationFence/);
  assert.match(materializer, /realtime\.ref\("online"\)\.update/);
  assert.match(materializer, /\[`soloMatchPermitsV2\/\$\{roomId\}`\]: resources\.permit/);
  assert.match(materializer, /\[`rooms\/\$\{roomId\}`\]: resources\.room/);
  assert.match(materializer, /\[`activeV2\/\$\{selection\.host\.uid\}\/\$\{selection\.host\.sessionId\}`\]/);
  assert.match(materializer, /\[`offersV2\/\$\{selection\.candidate\.uid\}\/\$\{selection\.candidate\.sessionId\}\/\$\{roomId\}`\]/);
  assert.match(materializer, /outcome: "hosted"/);

  const attemptStart = frontend.indexOf("async function attemptSoloServerMatch");
  const attemptEnd = frontend.indexOf(
    "async function restoreHostedOfferToWaiting",
    attemptStart,
  );
  const attempt = frontend.slice(attemptStart, attemptEnd);
  assert.ok(attemptStart >= 0 && attemptEnd > attemptStart);
  assert.match(attempt, /soloSessionActionCallable\(\{\s*action: "try_match"/);
  assert.match(attempt, /result\.outcome !== "hosted"/);
  assert.match(attempt, /adoptSoloServerHostedMatch\(candidate/);
  assert.doesNotMatch(
    attempt,
    /\b(?:set|update|runTransaction)\(ref\(database, `online\/(?:rooms|activeV2|offersV2)/,
  );
});

test("cancelled or expired V2 offers are restored only by exact server fences", () => {
  const backend = read("functions/index.js");
  const cancelStart = backend.indexOf("async function cancelSoloSessionV2Match");
  const cancelEnd = backend.indexOf("async function dispatchSoloSessionAction", cancelStart);
  const cancel = backend.slice(cancelStart, cancelEnd);
  assert.ok(cancelStart >= 0 && cancelEnd > cancelStart);
  assert.match(cancel, /claim\.sessionId !== data\.sessionId/);
  assert.match(cancel, /claim\.leaseToken !== data\.leaseToken/);
  assert.match(cancel, /roomMatchesSessionV2/);
  assert.match(cancel, /if \(room\.status === "active"\)/);
  assert.match(cancel, /if \(room\.status !== "offered"\)/);
  assert.match(cancel, /cleanupSoloSessionV2Match\(resources, \{/);
  assert.match(cancel, /restoreQueue: !activeRoom/);
  assert.match(cancel, /transitionAction: priorAbort \? "" : action/);
  assert.match(cancel, /status: activeRoom \? "destroyed" : "expired"/);

  const frontend = read("online.js");
  const restoreStart = frontend.indexOf("async function restoreHostedOfferToWaiting");
  const restoreEnd = frontend.indexOf("async function finishHostedOfferAsTerminal", restoreStart);
  const restore = frontend.slice(restoreStart, restoreEnd);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.match(restore, /soloSessionActionCallable\(\{/);
  assert.match(restore, /action: "expire"/);
  assert.match(restore, /sessionId: expectedState\.clientSessionId/);
  assert.match(restore, /leaseToken: expectedState\.clientLeaseToken/);
  assert.match(restore, /roomId,/);
  assert.doesNotMatch(restore, /\b(?:set|update|remove|runTransaction)\(ref\(database/);
  const terminalStart = frontend.indexOf("async function finishHostedOfferAsTerminal");
  const terminalEnd = frontend.indexOf("function registerHostedOfferMonitor", terminalStart);
  const terminalCleanup = frontend.slice(terminalStart, terminalEnd);
  assert.ok(terminalStart >= 0 && terminalEnd > terminalStart);
  assert.match(terminalCleanup, /restoreHostedOfferToWaiting/);
  assert.match(terminalCleanup, /state\.pendingOffer = null/);
  assert.match(terminalCleanup, /attemptCurrentSoloMatchmaking/);
  assert.match(terminalCleanup, /pendingOffer\.terminalCleanupRunning = false/);
  const restoreIndex = terminalCleanup.indexOf("await restoreHostedOfferToWaiting");
  const stopPollingIndex = terminalCleanup.indexOf(
    "window.clearInterval(state.hostStatusPollTimer)",
    restoreIndex,
  );
  assert.ok(restoreIndex >= 0 && stopPollingIndex > restoreIndex);
  assert.doesNotMatch(terminalCleanup, /cancelActiveReservationDisconnect/);
  const monitorStart = terminalEnd;
  const monitorEnd = frontend.indexOf("async function adoptSoloServerHostedMatch", monitorStart);
  const monitor = frontend.slice(monitorStart, monitorEnd);
  assert.match(monitor, /if \(status === "active"\)/);
  assert.match(monitor, /if \(status === "offered"\) return/);
  assert.match(monitor, /finishHostedOfferAsTerminal/);
  assert.doesNotMatch(monitor, /status !== "expired"/);
  const expireStart = frontend.indexOf("async function expireOffer");
  const expireEnd = frontend.indexOf("async function acceptOffer", expireStart);
  const expire = frontend.slice(expireStart, expireEnd);
  assert.match(expire, /if \(status === "active" \|\| status === "offered"\) return/);
  assert.match(expire, /finishHostedOfferAsTerminal/);
  const frontendCleanupStart = frontend.indexOf("async function cleanupMatchmaking");
  const frontendCleanupEnd = frontend.indexOf(
    "async function cleanupOnlineResources",
    frontendCleanupStart,
  );
  const matchmakingCleanup = frontend.slice(frontendCleanupStart, frontendCleanupEnd);
  assert.doesNotMatch(matchmakingCleanup, /soloSessionActionCallable/);
  assert.doesNotMatch(matchmakingCleanup, /\b(?:remove|runTransaction)\(ref\(database/);
  assert.doesNotMatch(matchmakingCleanup, /online\/active(?:V2)?\//);

  const onlineCleanupEnd = frontend.indexOf("function releaseRemoteImage", frontendCleanupEnd);
  const onlineCleanup = frontend.slice(frontendCleanupEnd, onlineCleanupEnd);
  assert.match(
    onlineCleanup,
    /const cancelRoomId = activeRoomId \|\| targetState\.pendingOffer\?\.roomId \|\| ""/,
  );
  const cancelIndex = onlineCleanup.indexOf(
    "await cancelSoloSessionRoomOnce(cancelRoomId, targetState)",
  );
  const releaseIndex = onlineCleanup.indexOf(
    "await releaseSoloSessionLease(targetState)",
    cancelIndex,
  );
  assert.ok(cancelIndex >= 0 && releaseIndex > cancelIndex);
});

test("the initial V2 queue timestamp is preserved by fenced server recovery", () => {
  const frontend = read("online.js");
  const beginStart = frontend.indexOf("async function beginMatchmaking");
  const beginEnd = frontend.indexOf("async function startPublicPresence", beginStart);
  const begin = frontend.slice(beginStart, beginEnd);
  const queueRefIndex = begin.indexOf("const queueEntryRef");
  const joinedAtIndex = begin.indexOf("const joinedAt = serverNow()", queueRefIndex);
  const queueSetIndex = begin.indexOf("await set(queueEntryRef", joinedAtIndex);
  assert.ok(queueRefIndex >= 0 && joinedAtIndex > queueRefIndex && queueSetIndex > joinedAtIndex);
  const queueSetEnd = begin.indexOf("\n    });", queueSetIndex);
  assert.ok(queueSetEnd > queueSetIndex);
  const queueWrite = begin.slice(queueSetIndex, queueSetEnd);
  assert.match(queueWrite, /sessionId: expectedState\.clientSessionId/);
  assert.match(queueWrite, /leaseToken: expectedState\.clientLeaseToken/);
  assert.match(queueWrite, /generation: expectedState\.soloSessionGeneration/);
  assert.match(queueWrite, /joinedAt,\s+lastSeen: joinedAt/);

  const backend = read("functions/index.js");
  const restoreStart = backend.indexOf("async function restoreSoloSessionV2Queue");
  const restoreEnd = backend.indexOf("function recordAttemptMatches", restoreStart);
  const restore = backend.slice(restoreStart, restoreEnd);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.match(restore, /currentValue\?\.sessionId !== entry\.sessionId/);
  assert.match(restore, /currentValue\?\.generation !== entry\.generation/);
  assert.match(restore, /currentValue\.roomId !== resources\.hostLock\.roomId/);
  assert.match(restore, /currentValue\.attemptId !== resources\.hostLock\.attemptId/);
  assert.match(restore, /claimMatches\(claimSnapshot\.val\(\)/);
  assert.match(restore, /const next = \{\s*\.\.\.currentValue,\s*state: "waiting",\s*lastSeen: now,/);
  assert.doesNotMatch(restore, /joinedAt\s*:/);
});

test("V2 active reservations stay server-owned and client cleanup is callable-fenced", () => {
  const frontend = read("online.js");
  const cancelStart = frontend.indexOf("async function cancelSoloSessionRoomOnce");
  const releaseStart = frontend.indexOf("async function releaseActiveReservation", cancelStart);
  const armStart = frontend.indexOf("async function armActiveReservationDisconnect");
  const cancel = frontend.slice(cancelStart, releaseStart);
  const release = frontend.slice(releaseStart, armStart);
  const armEnd = frontend.indexOf("async function beginMatchmaking", armStart);
  const arm = frontend.slice(armStart, armEnd);
  assert.ok(cancelStart >= 0 && releaseStart > cancelStart && armStart > releaseStart && armEnd > armStart);
  assert.match(cancel, /soloSessionCancelRoomId === normalizedRoomId/);
  assert.match(cancel, /soloSessionCancelPromise/);
  assert.match(cancel, /soloSessionActionCallable\(\{/);
  assert.match(cancel, /action: "cancel"/);
  assert.match(cancel, /sessionId: expectedState\.clientSessionId/);
  assert.match(cancel, /leaseToken: expectedState\.clientLeaseToken/);
  assert.match(cancel, /roomId: normalizedRoomId/);
  assert.match(release, /cancelSoloSessionRoomOnce\(roomId, expectedState\)/);
  assert.doesNotMatch(release, /online\/activeV2/);
  assert.doesNotMatch(release, /\b(?:remove|set|update|runTransaction)\(ref\(database/);
  assert.match(arm, /expectedState\.soloSessionLeaseHeld/);
  assert.match(arm, /contextIsCurrent\(\)/);
  assert.doesNotMatch(arm, /\bonDisconnect\(|online\/activeV2|remove\(|set\(|update\(/);

  const adoptStart = frontend.indexOf("async function adoptSoloServerHostedMatch");
  const adoptEnd = frontend.indexOf("async function expireOffer", adoptStart);
  const adopt = frontend.slice(adoptStart, adoptEnd);
  assert.ok(
    adopt.indexOf("armActiveReservationDisconnect") < adopt.indexOf("online/rooms/${roomId}"),
  );
  assert.match(adopt, /releaseActiveReservation\(roomId, expectedState\)/);

  const acceptStart = frontend.indexOf("async function acceptOffer");
  const acceptEnd = frontend.indexOf("async function drainIncomingOffers", acceptStart);
  const accept = frontend.slice(acceptStart, acceptEnd);
  assert.match(accept, /soloSessionActionCallable\(\{\s*action: "accept"/);
  assert.match(accept, /sessionId: state\.clientSessionId/);
  assert.match(accept, /leaseToken: state\.clientLeaseToken/);
  assert.match(accept, /releaseActiveReservation\(roomId, expectedState\)/);
  assert.doesNotMatch(accept, /\b(?:set|update|runTransaction)\(ref\(database/);

  const enterStart = frontend.indexOf("async function enterRoom");
  const enterEnd = frontend.indexOf("function isCurrentRoomSetupContext", enterStart);
  const enter = frontend.slice(enterStart, enterEnd);
  assert.ok(enter.indexOf("armActiveReservationDisconnect") < enter.indexOf("online/rooms/${roomId}"));
  assert.ok(enter.indexOf("cleanupMatchmaking(true)") < enter.indexOf("setupRoomListeners"));
  assert.match(enter, /releaseActiveReservation\(roomId, expectedState\)/);

  const setupStart = frontend.indexOf("async function setupRoomListeners");
  const setupEnd = frontend.indexOf("function listenToRound", setupStart);
  const setup = frontend.slice(setupStart, setupEnd);
  assert.match(setup, /armActiveReservationDisconnect/);
  assert.match(setup, /state\.disconnectHandles\.push\(presenceDisconnect\)/);
  assert.match(setup, /soloRoomPresencePath\(/);
  assert.doesNotMatch(setup, /onDisconnect\(ref\(database, `online\/activeV2/);

  const cleanupStart = frontend.indexOf("async function cleanupMatchmaking");
  const cleanupEnd = frontend.indexOf("async function cleanupOnlineResources", cleanupStart);
  const cleanup = frontend.slice(cleanupStart, cleanupEnd);
  assert.doesNotMatch(cleanup, /online\/activeV2/);
  assert.doesNotMatch(cleanup, /\b(?:remove|runTransaction)\(ref\(database/);
  const onlineCleanupStart = cleanupEnd;
  const onlineCleanupEnd = frontend.indexOf("function releaseRemoteImage", onlineCleanupStart);
  const onlineCleanup = frontend.slice(onlineCleanupStart, onlineCleanupEnd);
  assert.match(onlineCleanup, /if \(!keepActive\) await releaseSoloSessionLease\(targetState\)/);
  assert.doesNotMatch(onlineCleanup, /online\/activeV2/);
});

test("rollout, matching index, and TTLs fail closed before reunion activation", () => {
  const source = read("functions/index.js");
  assert.match(source, /systemConfig"\)\.doc\("soloFamiliarRollout"\)/);
  assert.match(source, /online\/config\/soloServerMatchmaking/);
  assert.match(source, /if \(!rollout\.reunionEnabled\) return \{ outcome: "disabled" \};/);
  assert.match(source, /online\/soloMatchPermitLocks/);
  assert.match(source, /online\/soloMatchPermits\/\$\{roomId\}/);

  const indexes = JSON.parse(read("firestore.indexes.json"));
  const pairIndex = indexes.indexes.find((entry) => (
    entry.collectionGroup === "soloFamiliarPairs"
  ));
  assert.ok(pairIndex);
  assert.ok(pairIndex.fields.some((field) => (
    field.fieldPath === "participants" && field.arrayConfig === "CONTAINS"
  )));
  assert.ok(pairIndex.fields.some((field) => (
    field.fieldPath === "active" && field.order === "ASCENDING"
  )));
  for (const collectionGroup of [
    "soloFamiliarIntents",
    "soloFamiliarPairs",
    "familiarEntries",
    "soloFamiliarReunions",
  ]) {
    assert.ok(indexes.fieldOverrides.some((entry) => (
      entry.collectionGroup === collectionGroup
      && entry.fieldPath === "deleteAt"
      && entry.ttl === true
    )));
  }
});

test("Realtime Database keeps permits private and scopes the new queue field to a boolean", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  assert.equal(rules.config.soloServerMatchmaking[".read"], false);
  assert.equal(rules.config.soloServerMatchmaking[".write"], false);
  assert.equal(rules.soloMatchPermits[".read"], false);
  assert.equal(rules.soloMatchPermits[".write"], false);
  assert.deepEqual(rules.soloMatchPermits[".indexOn"], ["expiresAt"]);
  assert.equal(rules.soloMatchPermitLocks[".read"], false);
  assert.equal(rules.soloMatchPermitLocks[".write"], false);
  assert.equal(rules.soloMatchAttempts[".read"], false);
  assert.equal(rules.soloMatchAttempts[".write"], false);
  assert.deepEqual(rules.soloMatchAttempts[".indexOn"], ["expiresAt"]);
  assert.match(
    rules.queue.$uid.reunionPreference[".validate"],
    /newData\.isBoolean\(\)/,
  );
  assert.match(rules.offers.$targetUid.$roomId[".write"], /soloServerMatchmaking/);
  assert.match(
    rules.offers.$targetUid.$roomId[".write"],
    /status'\)\.val\(\) === 'active'.*status'\)\.val\(\) === 'expired'/,
  );
  assert.match(rules.rooms.$roomId.hostUid[".write"], /soloMatchPermits/);
  assert.match(rules.rooms.$roomId.reunion[".write"], /soloMatchPermits/);
  assert.match(rules.rooms.$roomId.reunion[".write"], /soloMatchPermitLocks/);
  assert.match(rules.rooms.$roomId.players.$uid[".validate"], /soloMatchPermits/);
  const statusWrite = rules.rooms.$roomId.status[".write"];
  assert.match(statusWrite, /soloServerMatchmaking'\)\.val\(\) !== true/);
  assert.match(statusWrite, /soloServerMatchmaking'\)\.val\(\) === true/);
  assert.match(statusWrite, /!data\.exists\(\) && newData\.val\(\) === 'offered'/);
  assert.match(statusWrite, /newData\.val\(\) === 'active'/);
  assert.match(statusWrite, /newData\.val\(\) === 'expired'/);
  assert.doesNotMatch(statusWrite, /newData\.val\(\) !== 'active'/);
  assert.match(
    statusWrite,
    /auth\.uid === root\.child\('online\/soloMatchPermits\/' \+ \$roomId \+ '\/guestUid'\)\.val\(\)/,
  );
  assert.match(statusWrite, /soloMatchPermitLocks/);
  assert.match(statusWrite, /members/);
  assert.match(statusWrite, /players/);
  assert.match(statusWrite, /offers/);
  assert.match(rules.queue.$uid[".validate"], /lastSeen'\)\.val\(\) <= now \+ 15000/);
});

test("relationship state also prevents treating a transfer target as pristine", () => {
  const source = read("functions/index.js");
  const start = source.indexOf("async function transferTargetIsPristine");
  const end = source.indexOf("async function registerTransferFailure", start);
  const pristineCheck = source.slice(start, end);
  assert.match(pristineCheck, /soloFamiliarBookRef\(uid\)\.get\(\)/);
  assert.match(pristineCheck, /soloFamiliarBlockRef\(uid\)\.get\(\)/);
  assert.match(pristineCheck, /!familiarBookSnapshot\.exists/);
  assert.match(pristineCheck, /!familiarBlockSnapshot\.exists/);
});

test("other online modes do not gain familiar or reunion behavior", () => {
  for (const relativePath of ["strategy.js", "team.js"]) {
    assert.doesNotMatch(read(relativePath), /\bsoloFamiliar|顔なじみ帳|再会マッチ/i);
  }
});
