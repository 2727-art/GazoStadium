const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const frontendPath = path.join(root, "free-table.js");
const cssPath = path.join(root, "free-table.css");
const mediaPath = path.join(root, "free-table-media.mjs");
const frontendSource = fs.readFileSync(frontendPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");
const mediaSource = fs.readFileSync(mediaPath, "utf8");
const mediaModule = import(pathToFileURL(mediaPath).href);

function webpBytes(width = 320, height = 240) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  const write24 = (offset, value) => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
  };
  write(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  write(8, "WEBP");
  write(12, "VP8X");
  view.setUint32(16, 10, true);
  write24(24, width - 1);
  write24(27, height - 1);
  return bytes;
}

function wavBytes(seconds = 1, sampleRate = 8_000) {
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

function webmBytes(length = 40) {
  const bytes = new Uint8Array(length);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  return bytes;
}

function transferStart(overrides = {}) {
  return {
    type: "free-table-media-start",
    protocolVersion: 1,
    transferId: "ft_0123456789abcdef01234567",
    ownerUid: "peer_uid",
    sessionId: "session_123",
    kind: "image",
    mime: "image/webp",
    size: 30,
    duration: 0,
    createdAt: 123,
    ...overrides,
  };
}

test("free table media verifies actual WebP, WAV, and video container bytes", async () => {
  const { verifyFreeTableMediaBytes } = await mediaModule;
  assert.deepEqual(
    verifyFreeTableMediaBytes(webpBytes(), { kind: "image", mime: "image/webp" }),
    { mime: "image/webp", duration: 0 },
  );
  assert.equal(
    verifyFreeTableMediaBytes(wavBytes(1.25), {
      kind: "audio",
      mime: "audio/wav",
      duration: 1.25,
    }).duration,
    1.25,
  );
  assert.deepEqual(
    verifyFreeTableMediaBytes(webmBytes(), {
      kind: "video",
      mime: "video/webm",
      duration: 9.8,
    }),
    { mime: "video/webm", duration: 9.8 },
  );
  assert.throws(
    () => verifyFreeTableMediaBytes(Uint8Array.from([0x47, 0x49, 0x46]), {
      kind: "image",
      mime: "image/webp",
    }),
    /WebP/,
  );
  assert.throws(
    () => verifyFreeTableMediaBytes(webmBytes(), {
      kind: "video",
      mime: "video/mp4",
      duration: 9,
    }),
    /申告形式/,
  );
  assert.throws(
    () => verifyFreeTableMediaBytes(wavBytes(10.2), {
      kind: "audio",
      mime: "audio/wav",
      duration: 10,
    }),
    /10秒/,
  );
});

test("incoming free table media is fenced to the expected peer and session", async () => {
  const {
    appendIncomingFreeTableMediaChunk,
    createIncomingFreeTableMediaTransfer,
    FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES,
    finishIncomingFreeTableMediaTransfer,
    freeTableMediaEndStatus,
    releaseFreeTableMediaResource,
  } = await mediaModule;
  assert.throws(
    () => createIncomingFreeTableMediaTransfer(transferStart(), {
      expectedOwnerUid: "stranger",
      expectedSessionId: "session_123",
    }),
    /同席者以外/,
  );
  assert.throws(
    () => createIncomingFreeTableMediaTransfer(transferStart(), {
      expectedOwnerUid: "peer_uid",
      expectedSessionId: "other_session",
    }),
    /別の自由卓/,
  );
  const transfer = createIncomingFreeTableMediaTransfer(transferStart(), {
    expectedOwnerUid: "peer_uid",
    expectedSessionId: "session_123",
  });
  const bytes = webpBytes();
  await appendIncomingFreeTableMediaChunk(transfer, bytes.slice(0, 9));
  await appendIncomingFreeTableMediaChunk(transfer, new Blob([bytes.slice(9)]));
  const end = {
    ...transferStart(),
    type: "free-table-media-end",
  };
  assert.equal(freeTableMediaEndStatus(transfer, end), "complete");
  assert.equal(freeTableMediaEndStatus(null, end), "orphan");
  const revoked = [];
  const resource = await finishIncomingFreeTableMediaTransfer(transfer, end, {
    urlApi: {
      createObjectURL: () => "blob:free-table",
      revokeObjectURL: (url) => revoked.push(url),
    },
  });
  assert.equal(resource.url, "blob:free-table");
  releaseFreeTableMediaResource(resource, {
    urlApi: { revokeObjectURL: (url) => revoked.push(url) },
  });
  releaseFreeTableMediaResource(resource, {
    urlApi: { revokeObjectURL: (url) => revoked.push(url) },
  });
  assert.deepEqual(revoked, ["blob:free-table"]);
  assert.equal(resource.blob, null);

  const oversizedTransfer = createIncomingFreeTableMediaTransfer(transferStart({
    transferId: "ft_111111111111111111111111",
    size: FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES + 1,
  }), {
    expectedOwnerUid: "peer_uid",
    expectedSessionId: "session_123",
  });
  await assert.rejects(
    appendIncomingFreeTableMediaChunk(
      oversizedTransfer,
      new Uint8Array(FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES + 1),
    ),
    /1回の受信サイズ/,
  );
  assert.equal(oversizedTransfer.received, 0);
  assert.equal(oversizedTransfer.chunks.length, 0);
});

test("free table sender uses a dedicated ordered protocol and cancels interrupted transfers", async () => {
  const {
    FREE_TABLE_MEDIA_CHANNEL_LABEL,
    sendFreeTableMedia,
  } = await mediaModule;
  assert.equal(FREE_TABLE_MEDIA_CHANNEL_LABEL, "hariai-free-table-media-v1");
  const sent = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    send(value) {
      sent.push(value);
    },
  };
  await sendFreeTableMedia(channel, {
    kind: "image",
    mime: "image/webp",
    duration: 0,
    blob: new Blob([webpBytes()], { type: "image/webp" }),
  }, {
    transferId: "ft_0123456789abcdef01234567",
    ownerUid: "own_uid",
    sessionId: "session_123",
  }, {
    chunkBytes: 7,
    waitForBuffer: async () => {},
  });
  assert.equal(JSON.parse(sent[0]).type, "free-table-media-start");
  assert.equal(JSON.parse(sent.at(-1)).type, "free-table-media-end");
  assert.equal(sent.filter((value) => value instanceof ArrayBuffer).length, 5);

  const interrupted = [];
  let active = true;
  await assert.rejects(
    sendFreeTableMedia({
      readyState: "open",
      send(value) {
        interrupted.push(value);
        if (value instanceof ArrayBuffer) active = false;
      },
    }, {
      kind: "image",
      mime: "image/webp",
      duration: 0,
      blob: new Blob([webpBytes()], { type: "image/webp" }),
    }, {
      transferId: "ft_abcdef0123456789abcdef01",
      ownerUid: "own_uid",
      sessionId: "session_123",
    }, {
      chunkBytes: 7,
      waitForBuffer: async () => {},
      isActive: () => active,
    }),
    /中断/,
  );
  assert.equal(JSON.parse(interrupted.at(-1)).type, "free-table-media-cancel");
});

test("free table UI contains the agreed gentle flow and no competitive/public shelf leakage", () => {
  for (const copy of [
    "お迎え中",
    "帰る場所",
    "自分の部屋",
    "この人を迎える",
    "今回は見送る",
    "来訪札を取り下げる",
    "敗北して、いってきます",
    "いってらっしゃい",
    "今日はここまで",
    "安全に退出",
    "一席の記憶",
    "またここで会いたい",
  ]) {
    assert.match(frontendSource, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(frontendSource, /行ってきます|張り合い/);
  assert.doesNotMatch(frontendSource, /autoplay/i);
  assert.doesNotMatch(frontendSource, /ref\(database,\s*pathFor\("publicRooms"/);
  assert.match(frontendSource, /const FREE_TABLE_ROOT = "freeTables"/);
  assert.match(frontendSource, /FREE_TABLE_ACTIONS\.LIST/);
  assert.match(frontendSource, /data\.identity/);
  assert.match(frontendSource, /savedSpace\.growth/);
});

test("arrival is granted only from the dedicated DataChannel open path", () => {
  const enterStart = frontendSource.indexOf("async function enterSession");
  const enterEnd = frontendSource.indexOf("async function establishPresence", enterStart);
  const enterSource = frontendSource.slice(enterStart, enterEnd);
  assert.doesNotMatch(enterSource, /FREE_TABLE_ACTIONS\.ARRIVE/);
  assert.match(frontendSource, /channel\.onopen\s*=\s*\(\)\s*=>\s*\{[\s\S]*?confirmArrivalAfterP2p\(channel\)/);
  const confirmStart = frontendSource.indexOf("async function confirmArrivalAfterP2p");
  const confirmEnd = frontendSource.indexOf("async function handleMediaChannelMessage", confirmStart);
  const confirmSource = frontendSource.slice(confirmStart, confirmEnd);
  assert.match(confirmSource, /FREE_TABLE_ACTIONS\.ARRIVE/);
  assert.match(frontendSource, /result\.established === true/);
  assert.match(frontendSource, /FREE_TABLE_ARRIVAL_RETRY_DELAYS_MS = Object\.freeze\(\[1_000, 2_000, 5_000, 10_000, 20_000\]\)/);
  assert.match(confirmSource, /!arrivalFailureIsTerminal\(error\)[\s\S]*?contextIsCurrent\(\)[\s\S]*?isLiveSession\(\)/);
  assert.match(confirmSource, /Math\.min\(\s*attempt \+ 1,\s*FREE_TABLE_ARRIVAL_RETRY_DELAYS_MS\.length - 1/);
  assert.match(confirmSource, /FREE_TABLE_ARRIVAL_RETRY_DELAYS_MS\[retryIndex\]/);
  const terminalStart = frontendSource.indexOf("function arrivalFailureIsTerminal");
  const terminalEnd = frontendSource.indexOf("async function confirmArrivalAfterP2p", terminalStart);
  const terminalSource = frontendSource.slice(terminalStart, terminalEnd);
  assert.match(terminalSource, /"failed-precondition"/);
  assert.match(terminalSource, /"not-found"/);
  assert.match(terminalSource, /"invalid-argument"/);
  assert.doesNotMatch(terminalSource, /"permission-denied"|"unauthenticated"/);
});

test("frontend uses scoped TTLs, escapes custom copy, avoids autoplay, and exposes integration API", () => {
  assert.match(frontendSource, /currentRecordExpiry\(45_000\)/);
  assert.match(frontendSource, /currentRecordExpiry\(90_000\)/);
  assert.match(frontendSource, /currentRecordExpiry\(29 \* 60 \* 1000\)/);
  assert.match(frontendSource, /\.info\/serverTimeOffset/);
  assert.match(frontendSource, /escapeHtml\(entry\.text\)/);
  assert.match(frontendSource, /<audio controls preload="none"/);
  assert.match(frontendSource, /<video controls preload="metadata" playsinline/);
  assert.match(frontendSource, /window\.HariaiFreeTable\s*=\s*\{[\s\S]*?start,[\s\S]*?isActive,[\s\S]*?leave,[\s\S]*?requestHome/);
  assert.match(cssSource, /#freeTableButton/);
  assert.match(cssSource, /@media \(max-width: 760px\)/);
  assert.match(cssSource, /prefers-reduced-motion/);
});

test("visitor request captures its form before awaiting leave settlement", () => {
  const requestStart = frontendSource.indexOf("async function handleRequest");
  const requestEnd = frontendSource.indexOf(
    "async function resolveCancelledRequestRace",
    requestStart,
  );
  const requestHandler = frontendSource.slice(requestStart, requestEnd);

  assert.match(
    requestHandler,
    /const form = event\.currentTarget;\s+await waitForPendingLeaveSettlement\(\);/,
  );
  assert.match(requestHandler, /visitorCardFromForm\(form\)/);
  assert.doesNotMatch(
    requestHandler,
    /await waitForPendingLeaveSettlement\(\);[\s\S]*visitorCardFromForm\(event\.currentTarget\)/,
  );
});

test("both roles retain the server-negotiated media set before canonical RTDB refresh", () => {
  const normalizeStart = frontendSource.indexOf("function normalizeSession");
  const normalizeEnd = frontendSource.indexOf("function roomById", normalizeStart);
  const normalizeSource = frontendSource.slice(normalizeStart, normalizeEnd);
  const negotiatedStart = frontendSource.indexOf("function negotiatedSessionMedia");
  const negotiatedEnd = frontendSource.indexOf(
    "function sessionAllowsMediaKind",
    negotiatedStart,
  );
  const negotiatedSource = frontendSource.slice(negotiatedStart, negotiatedEnd);

  assert.match(normalizeSource, /negotiatedMedia: normalizeMedia\(source\.negotiatedMedia/);
  assert.match(normalizeSource, /ownRole === "visitor" \? you\.card/);
  assert.match(normalizeSource, /ownRole === "host" \? you\.card/);
  assert.match(negotiatedSource, /state\.session\?\.negotiatedMedia/);
  assert.match(negotiatedSource, /return normalizeMedia\(negotiatedMedia\)/);
});

test("safety exit disconnects locally and converges the exact server session", () => {
  const endStart = frontendSource.indexOf("async function endSession");
  const endEnd = frontendSource.indexOf("async function setRelationshipWanted", endStart);
  const safeExitSource = frontendSource.slice(endStart, endEnd);
  assert.ok(
    safeExitSource.indexOf("scheduleIgnoredSessionEnd(sessionId, reason)")
      < safeExitSource.indexOf("finishSessionLocally"),
  );
  assert.match(
    safeExitSource,
    /await callFreeTableAction\(FREE_TABLE_ACTIONS\.END,[\s\S]*?if \(!sessionContextIsCurrent\(sessionId, sessionGeneration\)\) return;[\s\S]*?finishSessionLocally/,
  );
  const leaveStart = frontendSource.indexOf("async function leave");
  const leaveEnd = frontendSource.indexOf("async function requestHome", leaveStart);
  const leaveSource = frontendSource.slice(leaveStart, leaveEnd);
  assert.ok(
    leaveSource.indexOf("scheduleIgnoredSessionEnd(sessionId, reason)")
      < leaveSource.indexOf("cleanupSession()"),
  );
  assert.match(frontendSource, /if \(!active \|\| !sessionId \|\| state\.ignoredSessionIds\.has\(sessionId\)\) return/);
  const retryStart = frontendSource.indexOf("function scheduleIgnoredSessionEnd");
  const retryEnd = frontendSource.indexOf("function defaultSpace", retryStart);
  const retrySource = frontendSource.slice(retryStart, retryEnd);
  assert.match(retrySource, /FREE_TABLE_END_RETRY_DELAYS_MS/);
  assert.match(retrySource, /rememberIgnoredSession\(normalizedSessionId\)/);
  assert.match(retrySource, /sessionId: normalizedSessionId/);
  assert.match(retrySource, /scheduleIgnoredSessionEnd\(normalizedSessionId, reason, attempt \+ 1, normalizedMessage\)/);
  const finishStart = frontendSource.indexOf("function finishSessionLocally");
  const finishEnd = frontendSource.indexOf("async function leave", finishStart);
  assert.match(
    frontendSource.slice(finishStart, finishEnd),
    /rememberIgnoredSession\(state\.sessionId\)[\s\S]*?cleanupSession\(\)/,
  );
  assert.match(frontendSource, /FREE_TABLE_IGNORED_SESSION_STORAGE_KEY/);
  assert.match(frontendSource, /ignoredSessionIds: new Set\(ignoredSessionTombstones\.keys\(\)\)/);
  assert.match(frontendSource, /window\.sessionStorage\.setItem/);
  const unloadStart = frontendSource.indexOf('window.addEventListener("beforeunload"');
  const unloadEnd = frontendSource.indexOf("window.HariaiFreeTable", unloadStart);
  assert.doesNotMatch(frontendSource.slice(unloadStart, unloadEnd), /rememberIgnoredSession/);
  assert.match(frontendSource.slice(unloadStart, unloadEnd), /cleanupSession\(\{ preserveOnDisconnect: true \}\)/);
  assert.match(frontendSource, /ref\(database, "\.info\/connected"\)/);
  assert.match(frontendSource, /if \(connected && !wasConnected\)[\s\S]*?\.then\(rearmPresence\)/);
  assert.match(frontendSource, /CANCEL_REQUEST: "cancel_request"/);
  assert.match(frontendSource, /ignoredRequestIds\.has\(pendingRequest\.id\)/);
  assert.match(frontendSource, /if \(result\.cancelled === true\) \{[\s\S]*?else \{\s*await resolveCancelledRequestRace\(\)/);
  assert.match(frontendSource, /applyMyState\(fresh, \{ suppressSessionResume: true \}\)/);
  assert.match(
    leaveSource,
    /cancelPendingRequest\(\{ bestEffort: true \}\)[\s\S]*?cleanupSession\(\)/,
  );
  assert.match(leaveSource, /else if \(!sessionId\) trackPendingLeaveSettlement\(settlePendingAfterLeave\(\)\)/);
  assert.match(frontendSource, /settlePendingAfterLeave\(attempt \+ 1\)/);
  assert.match(frontendSource, /await waitForPendingLeaveSettlement\(\)/);
  assert.match(leaveSource, /cleanupSession\(\)[\s\S]*?callRoomOpen\(false\)/);
  assert.match(frontendSource, /state\.screen === "hall" && state\.tab === "mine" && !state\.roomOpen/);
});

test("the last session remains reportable for fifteen minutes without storing chat bodies", () => {
  assert.match(frontendSource, /FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY = "hariaiFreeTableReportContextV1"/);
  assert.match(frontendSource, /FREE_TABLE_REPORT_CONTEXT_TTL_MS = 15 \* 60 \* 1000/);
  const rememberStart = frontendSource.indexOf("function rememberCurrentReportContext");
  const rememberEnd = frontendSource.indexOf("function defaultSpace", rememberStart);
  const rememberSource = frontendSource.slice(rememberStart, rememberEnd);
  assert.match(rememberSource, /reporterUid,\s*sessionId,\s*opponentUid,\s*messageIds: currentOpponentMessageIds\(opponentUid\),\s*createdAt,\s*expiresAt/);
  assert.doesNotMatch(rememberSource, /\btext\s*:/);
  assert.match(rememberSource, /sessionStorage\.setItem\(\s*FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY,\s*JSON\.stringify\(context\)/);
  assert.match(frontendSource, /function currentOpponentMessageIds[\s\S]*?\.sort\([\s\S]*?\.slice\(-FREE_TABLE_REPORT_MESSAGE_LIMIT\)/);
  assert.match(frontendSource, /expiresAt > createdAt \+ FREE_TABLE_REPORT_CONTEXT_TTL_MS/);
  assert.match(frontendSource, /function armReportContextExpiry[\s\S]*?current\.expiresAt > Date\.now\(\)[\s\S]*?clearReportContext/);
  assert.match(frontendSource, /data-action="report-recent-session">直前の席を通報/);
  assert.match(frontendSource, /else if \(action === "report-recent-session"\) await reportRecentSession\(\)/);
  assert.match(frontendSource, /reportingState\.reportedSessionIds\.add\(sessionId\);\s*clearReportContext\(\{ sessionId, reporterUid \}\)/);
  const finishStart = frontendSource.indexOf("function finishSessionLocally");
  const finishEnd = frontendSource.indexOf("async function leave", finishStart);
  assert.ok(
    frontendSource.slice(finishStart, finishEnd).indexOf("rememberCurrentReportContext()")
      < frontendSource.slice(finishStart, finishEnd).indexOf("cleanupSession()"),
  );
  const leaveStart = frontendSource.indexOf("async function leave");
  const leaveEnd = frontendSource.indexOf("async function requestHome", leaveStart);
  assert.ok(
    frontendSource.slice(leaveStart, leaveEnd).indexOf("rememberCurrentReportContext()")
      < frontendSource.slice(leaveStart, leaveEnd).indexOf("cleanupSession()"),
  );
  const enterStart = frontendSource.indexOf("async function enterSession");
  const enterEnd = frontendSource.indexOf("async function establishPresence", enterStart);
  assert.ok(
    frontendSource.slice(enterStart, enterEnd).indexOf("clearReportContext()")
      < frontendSource.slice(enterStart, enterEnd).indexOf("state.sessionId = sessionId"),
  );
});

test("canonical session expiry converges locally without letting stale timers close a new session", () => {
  const terminalStart = frontendSource.indexOf("function canonicalSessionErrorIsTerminal");
  const terminalEnd = frontendSource.indexOf("function handleCanonicalSessionError", terminalStart);
  const terminalSource = frontendSource.slice(terminalStart, terminalEnd);
  assert.match(terminalSource, /code === "permission-denied" \|\| code === "not-found"/);
  const canonicalStart = frontendSource.indexOf("function handleCanonicalSessionError");
  const canonicalEnd = frontendSource.indexOf("function clearSessionExpiryTimer", canonicalStart);
  const canonicalSource = frontendSource.slice(canonicalStart, canonicalEnd);
  assert.match(canonicalSource, /sessionContextIsCurrent\(sessionId, sessionGeneration\)/);
  assert.match(canonicalSource, /canonicalSessionErrorIsTerminal\(error\)[\s\S]*?finishSessionLocally/);
  assert.match(canonicalSource, /handleError\(error\)/);
  const expiryStart = frontendSource.indexOf("function armSessionExpiryTimer");
  const expiryEnd = frontendSource.indexOf("async function enterSession", expiryStart);
  const expirySource = frontendSource.slice(expiryStart, expiryEnd);
  assert.match(expirySource, /sessionContextIsCurrent\(sessionId, sessionGeneration\)/);
  assert.match(expirySource, /currentExpiresAt <= currentServerNow[\s\S]*?finishSessionLocally/);
  assert.match(expirySource, /armSessionExpiryTimer\(sessionId, sessionGeneration, currentExpiresAt\)/);
  assert.match(frontendSource, /onValue\(sessionRef,[\s\S]*?handleCanonicalSessionError\(error, sessionId, sessionGeneration\)/);
  const cleanupStart = frontendSource.indexOf("function cleanupSession");
  const cleanupEnd = frontendSource.indexOf("function finishSessionLocally", cleanupStart);
  assert.match(frontendSource.slice(cleanupStart, cleanupEnd), /clearSessionExpiryTimer\(\)/);
  assert.match(frontendSource, /\.info\/serverTimeOffset[\s\S]*?armSessionExpiryTimer/);
});

test("signals are generation-fenced, ordered, and recover with a fresh peer", () => {
  assert.match(frontendSource, /const FREE_TABLE_SIGNAL_SLOT_PREFIX = "S"\.repeat\(22\)/);
  assert.match(frontendSource, /const FREE_TABLE_SIGNAL_SLOT_ID_PATTERN = \/\^S\{22\}\[0-7\]\[0-9\]\$\//);
  assert.equal(`${"S".repeat(22)}79`.length, 24);
  assert.doesNotMatch(frontendSource, /^\s+push,\s*$/m);
  assert.doesNotMatch(frontendSource, /push\(ref\(database, pathFor\("(?:chat|signals)"/);
  assert.match(frontendSource, /function nextSignalSlotId\(sessionId, targetUid\)[\s\S]*?takeNextSlot\(signalSlotCounters, scope, FREE_TABLE_SIGNAL_SLOT_CAP\)/);
  assert.match(frontendSource, /pathFor\("signals", sessionId, opponentUid, signalId\)/);
  assert.match(frontendSource, /ref\(database, pathFor\("signals", sessionId, state\.uid\)\),\s*orderByChild\("createdAt"\),\s*limitToLast\(FREE_TABLE_SIGNAL_LIMIT\)/);
  assert.match(frontendSource, /onChildAdded\(signalsRef, handleSignalSnapshot, handleSignalError\)/);
  assert.match(frontendSource, /onChildChanged\(signalsRef, handleSignalSnapshot, handleSignalError\)/);
  assert.match(frontendSource, /function queueDeferredSignal\(snapshot\)[\s\S]*?state\.deferredSignals\.length <= FREE_TABLE_SIGNAL_LIMIT/);
  assert.match(frontendSource, /findIndex\(\(entry\) => entry\.key === snapshot\.key\)[\s\S]*?signalSnapshotCreatedAt\(state\.deferredSignals\[existingIndex\]\) >= signalSnapshotCreatedAt\(snapshot\)/);
  assert.match(frontendSource, /state\.deferredSignals\.sort\(\(first, second\) => \(\s*signalSnapshotCreatedAt\(first\) - signalSnapshotCreatedAt\(second\)/);
  assert.match(frontendSource, /type === "offer" \|\| type === "answer"/);
  assert.match(frontendSource, /if \(state\.pendingIce\.length >= FREE_TABLE_SIGNAL_LIMIT\) state\.pendingIce\.shift\(\)/);
  assert.match(frontendSource, /if \(state\.signalDraining \|\| !state\.peer \|\| !state\.deferredSignals\.length\) return/);
  assert.doesNotMatch(frontendSource, /signalChain/);
  const drainStart = frontendSource.indexOf("async function drainDeferredSignals");
  const drainEnd = frontendSource.indexOf("async function flushPendingIce", drainStart);
  assert.doesNotMatch(frontendSource.slice(drainStart, drainEnd), /remove\(snapshot\.ref\)/);
  assert.match(frontendSource, /signalCreatedAt < serverNow - FREE_TABLE_SIGNAL_MAX_AGE_MS/);
  assert.match(frontendSource, /state\.sessionId === sessionId[\s\S]*?state\.peer === peer/);
  assert.match(frontendSource, /signal\.fromUid !== opponentUid[\s\S]*?signal\.toUid !== uid/);
  assert.match(frontendSource, /signalExpiresAt <= serverNow/);
  assert.match(frontendSource, /signalExpiresAt > signalCreatedAt \+ FREE_TABLE_SIGNAL_TTL_MS/);
  assert.match(frontendSource, /protocolVersion: FREE_TABLE_SIGNAL_PROTOCOL_VERSION,[\s\S]*?negotiationId/);
  assert.match(frontendSource, /role !== "visitor"[\s\S]*?description\.type !== "offer"/);
  assert.match(frontendSource, /role !== "host"[\s\S]*?negotiationId !== state\.negotiationId[\s\S]*?description\.type !== "answer"/);
  assert.match(frontendSource, /if \(state\.negotiationId\) return \{ replacePeerFor: negotiationId \}/);
  assert.match(frontendSource, /preservePendingIce: true/);
  assert.match(frontendSource, /negotiationId !== state\.negotiationId && role !== "visitor"/);
  assert.match(frontendSource, /state\.pendingIce\.push\(\{ negotiationId, candidate, createdAt: signalCreatedAt \}\)/);
  assert.match(frontendSource, /const retained = \[\][\s\S]*?retained\.push\(entry\)[\s\S]*?state\.pendingIce = \[\.\.\.retained, \.\.\.state\.pendingIce\]/);
  assert.match(frontendSource, /resetPeerTransport\([\s\S]*?await setupPeerConnection\(\)/);
  assert.match(frontendSource, /schedulePeerRecovery\(peer,[\s\S]*?force: true/);
  assert.match(frontendSource, /const FREE_TABLE_PEER_RECOVERY_STEADY_MS = 30_000/);
  assert.match(frontendSource, /const FREE_TABLE_PEER_OFFER_WATCHDOG_MS = 15_000/);
  assert.match(frontendSource, /FREE_TABLE_PEER_RECOVERY_DELAYS_MS\[attempt\]\s*\?\?\s*FREE_TABLE_PEER_RECOVERY_STEADY_MS/);
  assert.match(frontendSource, /const delay = immediate \? 0 : Math\.max\(recoveryDelay, Number\(minimumDelayMs\) \|\| 0\)/);
  assert.doesNotMatch(frontendSource, /peerRecoveryAttempts >= FREE_TABLE_PEER_RECOVERY_DELAYS_MS\.length/);
  assert.match(frontendSource, /state\.peerRecoveryAttempts = Math\.min\(\s*attempt \+ 1,\s*FREE_TABLE_PEER_RECOVERY_DELAYS_MS\.length/);
  assert.match(frontendSource, /const offerSent = await createAndSendHostOffer[\s\S]*?if \(offerSent && contextIsCurrent\(\) && !state\.mediaReady\)[\s\S]*?force: true,[\s\S]*?minimumDelayMs: FREE_TABLE_PEER_OFFER_WATCHDOG_MS/);
  assert.match(frontendSource, /const failed = peer\.connectionState === "failed" \|\| peer\.iceConnectionState === "failed";[\s\S]*?immediate: failed,[\s\S]*?force: failed/);
  assert.match(frontendSource, /channel\.onopen = \(\) => \{[\s\S]*?clearPeerRecoveryTimer\(\);[\s\S]*?state\.peerRecoveryAttempts = 0/);
  assert.match(frontendSource, /if \(state\.peerRecoveryTimer\) \{\s*if \(!immediate && \(!force \|\| state\.peerRecoveryForced\)\) return;[\s\S]*?window\.clearTimeout\(state\.peerRecoveryTimer\)/);
  assert.match(frontendSource, /if \(!state\.peerRecoveryForced\) \{\s*clearPeerRecoveryTimer\(\)/);
  const cleanupStart = frontendSource.indexOf("function cleanupSession");
  const cleanupEnd = frontendSource.indexOf("function finishSessionLocally", cleanupStart);
  const cleanupSource = frontendSource.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupSource, /state\.hostOfferInFlight = false/);
  assert.match(cleanupSource, /state\.negotiationCreatedAt = 0/);
  assert.match(cleanupSource, /state\.negotiationOfferKey = ""/);
});

test("chat, media, arrival, and farewell callbacks cannot leak into a later session", () => {
  assert.match(frontendSource, /const FREE_TABLE_CHAT_SLOT_PREFIX = "C"\.repeat\(20\)/);
  assert.match(frontendSource, /const FREE_TABLE_CHAT_SLOT_ID_PATTERN = \/\^C\{20\}\[01\]\[0-4\]\[0-9\]\{2\}\$\//);
  assert.equal(`${"C".repeat(20)}0499`.length, 24);
  assert.match(frontendSource, /takeNextSlot\(chatSlotCounters, scope, FREE_TABLE_CHAT_SLOT_CAP\)/);
  assert.match(frontendSource, /if \(visibleIds\.has\(messageId\)\) continue/);
  assert.match(frontendSource, /previous\.authorUid === uid[\s\S]*?Number\(previous\.expiresAt\) <= serverNow/);
  assert.match(frontendSource, /ref\(database, pathFor\("chat", sessionId\)\),\s*orderByChild\("createdAt"\),\s*limitToLast\(FREE_TABLE_CHAT_LIMIT\)/);
  assert.match(frontendSource, /onChildAdded\([\s\S]*?applyChatSnapshot\(snapshot, sessionId, sessionGeneration\)/);
  assert.match(frontendSource, /onChildChanged\([\s\S]*?applyChatSnapshot\(snapshot, sessionId, sessionGeneration\)/);
  assert.match(frontendSource, /function pruneChatMessages\(\)[\s\S]*?state\.chatMessages\.size - FREE_TABLE_CHAT_LIMIT/);
  assert.match(frontendSource, /function applyChatSnapshot\([\s\S]*?state\.chatMessages\.set\(messageId,[\s\S]*?pruneChatMessages\(\)[\s\S]*?render\(\)/);
  assert.match(frontendSource, /!pending[\s\S]*?Number\(existing\.createdAt \|\| 0\) >= createdAt\) return/);
  const sendChatStart = frontendSource.indexOf("async function handleSendChat");
  const sendChatEnd = frontendSource.indexOf("function mediaDuration", sendChatStart);
  const sendChatSource = frontendSource.slice(sendChatStart, sendChatEnd);
  assert.match(sendChatSource, /const previousEntry = state\.chatMessages\.get\(messageId\)/);
  assert.match(sendChatSource, /state\.pendingChatMutations\.set\(messageId,[\s\S]*?state\.chatMessages\.set\(messageId, optimisticEntry\)/);
  assert.match(sendChatSource, /state\.chatDraft = "";\s*render\(\);\s*try \{\s*await set/);
  assert.match(
    sendChatSource,
    /catch \(error\) \{[\s\S]*?state\.pendingChatMutations\.get\(messageId\)\?\.token === pendingToken[\s\S]*?current\?\.pendingToken === pendingToken[\s\S]*?if \(previousEntry\) state\.chatMessages\.set\(messageId, previousEntry\);\s*else state\.chatMessages\.delete\(messageId\);[\s\S]*?state\.chatDraft = text;[\s\S]*?render\(\);/,
  );
  assert.doesNotMatch(sendChatSource, /form\.reset\(\)/);
  assert.match(frontendSource, /if \(!state\.incomingMedia\) return/);
  assert.match(frontendSource, /FREE_TABLE_INCOMING_MEDIA_TIMEOUT_MS/);
  assert.match(frontendSource, /roomMedia\.image === true && visitorMedia\.image === true/);
  assert.match(frontendSource, /if \(!sessionAllowsMediaKind\(message\.kind\)\)/);
  assert.match(frontendSource, /if \(!sessionAllowsMediaKind\(kind\)\)/);
  assert.match(frontendSource, /FREE_TABLE_RETAINED_MEDIA_MAX_BYTES/);
  assert.match(frontendSource, /actualDuration > FREE_TABLE_VIDEO_MAX_SECONDS/);
  assert.match(frontendSource, /actualDuration = await mediaDuration\(resource\.blob, "video"\)[\s\S]*?if \(!contextIsCurrent\(\)\) \{[\s\S]*?releaseFreeTableMediaResource\(resource\)/);
  assert.match(frontendSource, /finally \{\s*if \(contextIsCurrent\(\)\) state\.arrivalPending = false/);
  assert.match(frontendSource, /generation === state\.mediaGeneration[\s\S]*?channel === state\.mediaChannel/);
  const verifyStart = frontendSource.indexOf("async function verifyRemoteFarewell");
  const verifyEnd = frontendSource.indexOf("async function handleDeparture", verifyStart);
  const verifySource = frontendSource.slice(verifyStart, verifyEnd);
  assert.match(verifySource, /get\(ref\(database, pathFor\("sessions", sessionId\)\)\)/);
  assert.match(verifySource, /freshSession\.status === "ended"[\s\S]*?freshSession\.ending\.reason === "departure"/);
  assert.doesNotMatch(verifySource, /GET_MY_STATE/);
  assert.match(mediaSource, /FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES/);
});
