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
  assert.match(familiarAcceptance, /validatedOutcomes\("solo", room, participants\)/);
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

test("server matchmaking creates the room and offer instead of handing an unused permit to a client", () => {
  const backend = read("functions/index.js");
  const frontend = read("online.js");
  const start = backend.indexOf("async function materializeSoloHostedMatch");
  const end = backend.indexOf("async function trySoloServerMatch", start);
  const materializer = backend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(materializer, /online\/active\/\$\{permit\.hostUid\}/);
  assert.match(materializer, /online\/queue\/\$\{permit\.hostUid\}/);
  assert.match(materializer, /soloHostedRoomPayload\(permit\)/);
  assert.match(materializer, /soloHostedOfferPayload\(roomId, permit\)/);
  assert.match(backend, /outcome: "hosted"/);
  assert.match(backend, /const lockAcquiredAt = Date\.now\(\)/);
  assert.match(backend, /const permitIssuedAt = Date\.now\(\)/);
  assert.match(frontend, /result\.outcome !== "hosted"/);
  assert.match(frontend, /adoptSoloServerHostedMatch\(candidate/);
  assert.doesNotMatch(
    frontend.slice(
      frontend.indexOf("async function attemptSoloServerMatch"),
      frontend.indexOf("async function attemptToHost"),
    ),
    /createOffer\(/,
  );
});

test("cancelled or expired hosted offers restore the host queue conditionally", () => {
  const backend = read("functions/index.js");
  const cleanupStart = backend.indexOf("async function cleanupSoloMatchContext");
  const cleanupEnd = backend.indexOf("async function cancelPendingSoloMatchPermit", cleanupStart);
  const cleanup = backend.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /online\/active\/\$\{participantUid\}/);
  assert.match(cleanup, /currentValue === roomId \? null : undefined/);
  assert.match(cleanup, /online\/queue\/\$\{hostUid\}/);
  assert.match(cleanup, /currentValue\.roomId !== roomId/);
  assert.match(cleanup, /state: "waiting"/);

  const frontend = read("online.js");
  assert.match(frontend, /async function restoreHostedOfferToWaiting/);
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
  assert.match(matchmakingCleanup, /current === "offered" \? "expired" : undefined/);
  assert.match(matchmakingCleanup, /pendingHostedOffer\.targetUid/);
});

test("the initial queue timestamp is taken immediately before registration and preserved on recovery", () => {
  const frontend = read("online.js");
  const beginStart = frontend.indexOf("async function beginMatchmaking");
  const beginEnd = frontend.indexOf("async function startPublicPresence", beginStart);
  const begin = frontend.slice(beginStart, beginEnd);
  const queueRefIndex = begin.indexOf("const queueEntryRef");
  const joinedAtIndex = begin.indexOf("const joinedAt = serverNow()", queueRefIndex);
  const queueSetIndex = begin.indexOf("await set(queueEntryRef", joinedAtIndex);
  assert.ok(queueRefIndex >= 0 && joinedAtIndex > queueRefIndex && queueSetIndex > joinedAtIndex);
  assert.match(begin.slice(joinedAtIndex, queueSetIndex + 500), /joinedAt,\s+lastSeen: joinedAt/);

  const restoreStart = frontend.indexOf("async function restoreHostedOfferToWaiting");
  const restoreEnd = frontend.indexOf("async function finishHostedOfferAsTerminal", restoreStart);
  const restore = frontend.slice(restoreStart, restoreEnd);
  assert.match(restore, /lastSeen: restoredLastSeen/);
  assert.doesNotMatch(restore, /joinedAt: restoredLastSeen/);
  assert.match(restore, /releaseActiveReservation\(roomId, expectedState\)/);
  assert.doesNotMatch(restore, /runTransaction\(ref\(database, `online\/active/);
});

test("active reservations are disconnect-protected before room setup and safely handed off", () => {
  const frontend = read("online.js");
  const cancelStart = frontend.indexOf("async function cancelActiveReservationDisconnect");
  const armStart = frontend.indexOf("async function armActiveReservationDisconnect");
  const disconnectHelpers = frontend.slice(cancelStart, armStart);
  const armEnd = frontend.indexOf("async function beginMatchmaking", armStart);
  const arm = frontend.slice(armStart, armEnd);
  assert.ok(cancelStart >= 0 && armStart > cancelStart && armEnd > armStart);
  assert.ok(
    disconnectHelpers.indexOf("await handle.cancel()")
      < disconnectHelpers.indexOf("expectedState.activeReservationDisconnect = null"),
  );
  const releaseStart = disconnectHelpers.indexOf("async function releaseActiveReservation");
  const releaseEnd = disconnectHelpers.indexOf("async function clearActiveReservation", releaseStart);
  const release = disconnectHelpers.slice(releaseStart, releaseEnd);
  assert.match(release, /const result = await runTransaction/);
  assert.match(release, /if \(result\.snapshot\.exists\(\)\) return false/);
  assert.ok(
    release.indexOf("const result = await runTransaction")
      < release.indexOf("await cancelActiveReservationDisconnect"),
  );
  const clearStart = releaseEnd;
  const clear = disconnectHelpers.slice(clearStart);
  assert.ok(
    clear.indexOf("await remove(") < clear.indexOf("await cancelActiveReservationDisconnect"),
  );
  assert.match(arm, /onDisconnect\(ref\(database, `online\/active\/\$\{expectedState\.uid\}`\)\)/);
  assert.match(arm, /await handle\.remove\(\)/);
  assert.match(arm, /await handle\.cancel\(\)\.catch/);

  const adoptStart = frontend.indexOf("async function adoptSoloServerHostedMatch");
  const adoptEnd = frontend.indexOf("async function createOffer", adoptStart);
  const adopt = frontend.slice(adoptStart, adoptEnd);
  assert.ok(
    adopt.indexOf("armActiveReservationDisconnect") < adopt.indexOf("online/rooms/${roomId}"),
  );
  assert.match(adopt, /releaseActiveReservation\(roomId, expectedState\)/);
  const createStart = frontend.indexOf("async function createOffer");
  const createEnd = frontend.indexOf("async function expireOffer", createStart);
  const create = frontend.slice(createStart, createEnd);
  assert.ok(
    create.indexOf("const reservation = await runTransaction")
      < create.indexOf("armActiveReservationDisconnect"),
  );
  assert.match(create, /releaseActiveReservation\(roomId, expectedState\)/);

  const acceptStart = frontend.indexOf("async function acceptOffer");
  const acceptEnd = frontend.indexOf("async function drainIncomingOffers", acceptStart);
  const accept = frontend.slice(acceptStart, acceptEnd);
  const reservationIndex = accept.indexOf("const reservation = await runTransaction");
  const disconnectIndex = accept.indexOf("armActiveReservationDisconnect", reservationIndex);
  const activateIndex = accept.indexOf('await set(roomStatusRef, "active")', disconnectIndex);
  assert.ok(reservationIndex >= 0 && disconnectIndex > reservationIndex && activateIndex > disconnectIndex);
  assert.match(accept, /releaseActiveReservation\(roomId, expectedState\)/);

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
  assert.doesNotMatch(setup, /onDisconnect\(ref\(database, `online\/active/);

  const cleanupStart = frontend.indexOf("async function cleanupMatchmaking");
  const cleanupEnd = frontend.indexOf("async function cleanupOnlineResources", cleanupStart);
  const cleanup = frontend.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /if \(!keepActive\) removals\.push\(clearActiveReservation\(targetState\)\)/);
  assert.doesNotMatch(cleanup, /await Promise\.allSettled\(removals\);\s+if \(!keepActive\).*cancelActiveReservationDisconnect/);
  const onlineCleanupStart = cleanupEnd;
  const onlineCleanupEnd = frontend.indexOf("function releaseRemoteImage", onlineCleanupStart);
  const onlineCleanup = frontend.slice(onlineCleanupStart, onlineCleanupEnd);
  assert.match(onlineCleanup, /keepActive \? Promise\.resolve\(\) : clearActiveReservation\(targetState\)/);
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
  for (const relativePath of ["strategy.js", "team.js", "royale.js"]) {
    assert.doesNotMatch(read(relativePath), /\bsoloFamiliar|顔なじみ帳|再会マッチ/i);
  }
});
