"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "online.js"), "utf8");
const modules = Promise.all(["online-p2p-hardening.mjs", "online-room-lifecycle.mjs"]
  .map((file) => import(pathToFileURL(path.join(root, file)).href)));
function fn(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const body = source.slice(match.index);
  const ending = /\n\}\r?\n/.exec(body);
  assert.ok(ending, name);
  return body.slice(0, ending.index + 2);
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 100; i += 1) await Promise.resolve(); }

async function harness(overrides = {}) {
  const [recovery, lifecycle] = await modules;
  let now = 1_000;
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const errors = [];
  const target = {
    uid: "host", clientSessionId: "a".repeat(32), clientLeaseToken: "1".repeat(32),
    soloSessionGeneration: "G".repeat(22), soloSessionLease: { owner: true },
    soloSessionLeaseHeld: true, soloSessionOwnershipLost: false,
    matchmakingGeneration: 1, screen: "matching", roomId: "", round: 1,
    p2pAutoRequeueStartedAt: 0, p2pAutoRequeueCount: 0, p2pDiagnosticSent: new Set(),
    matchUnsubscribers: [], roomUnsubscribers: [], disconnectHandles: [],
    pendingOffer: null, pendingIncomingOffer: null, deck: [],
    roomSetupAttempt: null, soloSessionCleanupPending: false,
  };
  const roomId = "-" + "r".repeat(19);
  const room = {
    protocolVersion: 2, signalingVersion: 2, connectionGeneration: "C".repeat(22), attemptId: "A".repeat(22),
    hostUid: "host", guestUid: "guest", status: "active", members: { host: true, guest: true },
    sessions: { host: { sessionId: target.clientSessionId, generation: target.soloSessionGeneration },
      guest: { sessionId: "b".repeat(32), generation: "H".repeat(22) } },
    players: { host: { uid: "host" }, guest: { uid: "guest" } },
  };
  class Peer {
    constructor() { calls.push("peer-created"); this.closed = false; }
    createDataChannel() { return { close() { calls.push("channel-close"); } }; }
    async createOffer() { calls.push("offer"); return { type: "offer", sdp: "fixture" }; }
    async setLocalDescription() { calls.push("local-description"); }
    close() { this.closed = true; calls.push("peer-close"); }
  }
  const window = {
    RTCPeerConnection: Peer,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval() {},
    HariaiApp: { returnHome() { calls.push("home"); } },
  };
  const sandbox = {
    ...recovery, ...lifecycle,
    state: target, active: true, database: {}, window, RTCPeerConnection: Peer,
    Date: { now: () => now }, document: { visibilityState: "visible" }, navigator: { onLine: true },
    ONLINE_SESSION_PROTOCOL_VERSION: 2, ONLINE_ROOM_SETUP_TIMEOUT_MS: 30_000,
    ONLINE_CLEANUP_WAIT_MS: 15_000, ONLINE_CLEANUP_AUXILIARY_WAIT_MS: 3_000,
    matchmakingGenerationCounter: 1, useOfflineMarketPreview: false,
    pendingSampleMatchmakingLaunch: null,
    console: { error(error) { errors.push(error); } },
    ref: (_db, name) => name, push: (name) => name + "/signal", serverTimestamp: () => 1,
    get: async (name) => ({ val: () => name.endsWith("/scores") ? {} : room }),
    set: async (name) => { calls.push(["set", name]); },
    remove: async () => {}, onChildAdded: () => () => {},
    runTransaction: async () => { calls.push("destroy"); },
    soloSessionActionCallable: async (request) => {
      calls.push(request);
      if (request.action === "release") return { data: { released: true } };
      if (request.action === "cancel") return { data: { cancelled: true } };
      return { data: { outcome: "join", roomId } };
    },
    clearSoloServerMatchRetry() {}, scheduleSoloServerMatchRetry() {}, notifySoloMatchRecovery() {},
    armActiveReservationDisconnect: async () => true, releaseActiveReservation: async () => true,
    isValidOnlineSessionId: (value) => /^[a-f0-9]{32}$/.test(value),
    normalizeSampleCount: (value) => Number(value || 0), getStartingHp: () => 30,
    normalizeRoomAchievementShowcases: () => ({}), normalizePursuitLine: (value) => value,
    setOnlineChrome() {}, render() {}, showToast() {},
    updatePublicPresence: async () => {}, setupRoomListeners: async () => true,
    loadP2pIceServers: async () => ({ iceServers: [], turnAvailable: true }),
    soloRoomSignalPath: (id, uid, sessionId) => `${id}/${uid}/${sessionId}`,
    soloRoomPresencePath: (id, uid, sessionId) => `${id}/presence/${uid}/${sessionId}`,
    configureDataChannel: (channel, expected) => { expected.channel = channel; },
    reportP2pDiagnostic: async () => {}, handleRecoverableError(error) { errors.push(error); },
    resetAfterP2pFailure: async (_expected, options = {}) => { calls.push(options.automatic ? "requeue" : "manual-retry"); },
    getResolvedMatchResultForRound: (_round, expected) => expected.resolvedResult || null,
    preserveResolvedFinishFromP2pRecovery(expected) {
      if (!expected.resolvedResult) return false;
      expected.p2pRecovery = null; calls.push("preserve-result"); return true;
    },
    roundScoresAreComplete: (scores) => Number.isInteger(scores?.host) && Number.isInteger(scores?.guest),
    resolveRound() { target.resolvedResult = { winner: "host" }; calls.push("resolve-round"); },
    clearSoloSessionHeartbeat() {}, clearActiveContact() {}, clearFinishCutIn() {},
    clearPendingFinishReplyAcks() {}, clearImageAckWatchdog() {}, stopSelectionTimer() {},
    notifyEngawaDeparture() {}, releaseEngawaMedia() {}, cleanupPublicPresence: async () => {},
    isPostMatchTipBusy: () => false, releaseAllImages() {}, releaseMatchMedia() {},
    ...overrides,
  };
  const context = vm.createContext(sandbox);
  const functions = [
    "attemptSoloServerMatch", "enterRoom", "isCurrentRoomSetupContext", "stopInitialOnlineTransport",
    "setupPeerConnection", "isCurrentMatchmakingGeneration", "cleanupMatchmaking",
    "waitForOnlineOperation", "showSoloCleanupPending", "retrySoloCleanupOperation",
    "releaseSoloSessionLease", "cancelSoloSessionRoomOnce", "cleanupOnlineResources",
    "clearP2pRecoveryTimer", "scheduleP2pRecoveryTimer", "dispatchP2pRecoveryEvent",
    "completeP2pFailureCleanup", "confirmResolvedMatchBeforeP2pCleanup", "handleP2pRecoveryEffect",
    "preserveResolvedMatchBeforeP2pCleanup", "cancelMatching", "leaveToLanding", "resetOnlineState",
    "prepareDeckForRematch",
  ];
  vm.runInContext(functions.map(fn).join("\n"), context);
  return {
    context, target, calls, errors, room, roomId, timers, Peer,
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        await flush();
        const next = [...timers.entries()].filter(([, item]) => item.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = until; await flush();
    },
    async enter() { await context.attemptSoloServerMatch(1); await flush(); },
  };
}

for (const fault of ["presence", "offer", "signal"]) {
  test(`initial ${fault} rejection cleans its exact reservation and lease before requeue`, async () => {
    const h = await harness();
    if (fault === "presence") h.context.updatePublicPresence = async () => { throw Error("presence"); };
    if (fault === "offer") h.Peer.prototype.createOffer = async () => { throw Error("offer"); };
    if (fault === "signal") h.context.set = async (name) => { if (name.endsWith("/signal")) throw Error("signal"); };
    await h.enter();
    const requests = h.calls.filter((value) => value?.action);
    assert.deepEqual(requests.map((value) => value.action), ["try_match", "cancel", "release"]);
    assert.equal(requests[1].roomId, h.roomId);
    assert.equal(requests[1].abort, true);
    assert.equal(requests[2].generation, "G".repeat(22));
    assert.equal(h.target.soloSessionLease, null);
    assert.equal(h.calls.filter((value) => value === "requeue").length, 1);
    assert.equal(h.target.peer, null);
    assert.equal(h.errors.length, 0);
  });
}

for (const step of ["presence", "room-listeners", "turn", "offer"]) {
  test(`hung initial ${step} expires, then late success cannot revive its transport`, async () => {
    const h = await harness();
    const delayed = deferred();
    if (step === "presence") h.context.updatePublicPresence = () => delayed.promise;
    if (step === "room-listeners") h.context.setupRoomListeners = () => delayed.promise;
    if (step === "turn") h.context.loadP2pIceServers = () => delayed.promise;
    if (step === "offer") h.Peer.prototype.createOffer = () => delayed.promise;
    const entering = h.context.attemptSoloServerMatch(1);
    await h.advance(30_000);
    await entering;
    assert.equal(h.target.soloSessionLease, null);
    assert.equal(h.calls.filter((value) => value === "requeue").length, 1);
    delayed.resolve(step === "turn" ? { iceServers: [], turnAvailable: true } : { type: "offer", sdp: "late" });
    await flush();
    assert.equal(h.target.peer, null);
    assert.equal(h.target.channelReady, false);
    assert.equal(h.calls.filter((value) => Array.isArray(value) && value[1].endsWith("/signal")).length, 0);
  });
}

test("failed or null release replies retain the exact fence and allow a confirmed retry", async () => {
  const h = await harness();
  let replies = [{ data: { released: false, reason: "occupied" } }, null, { data: { released: true } }];
  h.context.soloSessionActionCallable = async () => replies.shift();
  assert.equal(await h.context.releaseSoloSessionLease(h.target), false);
  assert.equal(h.target.soloSessionGeneration, "G".repeat(22));
  assert.notEqual(h.target.soloSessionLease, null);
  assert.equal(await h.context.releaseSoloSessionLease(h.target), false);
  assert.equal(await h.context.releaseSoloSessionLease(h.target), true);
  assert.equal(h.target.soloSessionLease, null);
});

test("failed cancel is retried instead of reusing a cached null reply", async () => {
  const h = await harness();
  let attempts = 0;
  h.context.soloSessionActionCallable = async () => { if (++attempts === 1) throw Error("offline"); return { data: { cancelled: true } }; };
  assert.equal(await h.context.cancelSoloSessionRoomOnce(h.roomId, h.target), null);
  assert.equal((await h.context.cancelSoloSessionRoomOnce(h.roomId, h.target)).cancelled, true);
  await h.context.cancelSoloSessionRoomOnce(h.roomId, h.target);
  assert.equal(attempts, 2);
});

test("unsettled release blocks cancel, reset and title transitions after the UI timeout", async () => {
  for (const action of ["cancelMatching", "resetOnlineState", "leaveToLanding"]) {
    const h = await harness();
    const delayed = deferred();
    h.context.soloSessionActionCallable = () => delayed.promise;
    const operation = h.context[action]("setup");
    const rejected = assert.rejects(operation, { code: "online-operation-timeout" });
    await h.advance(15_000); await rejected;
    assert.equal(h.context.state, h.target);
    assert.equal(h.context.active, true);
    assert.equal(h.target.screen, "error");
    assert.ok(h.target.soloSessionReleasePromise);
    assert.ok(h.target.cleanupPromise);
    assert.equal(h.calls.includes("home"), false);
    delayed.resolve({ data: { released: true } }); await flush();
    assert.equal(h.target.soloSessionReleasePromise, null);
    assert.equal(h.target.cleanupPromise, null);
    assert.equal(h.target.soloSessionLease, null);
  }
});

test("a missing lease needs no remote release to cancel or return to the title", async () => {
  const h = await harness();
  h.target.soloSessionLease = null;
  h.target.screen = "setup";
  await h.context.cancelMatching();
  await h.context.leaveToLanding();
  assert.equal(h.context.active, false);
  assert.equal(h.calls.includes("home"), true);
  assert.equal(h.calls.filter((value) => value?.action === "release").length, 0);
});

test("lease-lost is a settled loss of ownership and never schedules automatic requeue", async () => {
  const h = await harness();
  h.context.updatePublicPresence = async () => { throw Error("fixture"); };
  const callable = h.context.soloSessionActionCallable;
  h.context.soloSessionActionCallable = (request) => request.action === "release"
    ? Promise.resolve({ data: { released: false, reason: "lease-lost" } }) : callable(request);
  await h.enter();
  assert.equal(h.target.soloSessionOwnershipLost, true);
  assert.equal(h.target.soloSessionLease, null);
  assert.equal(h.calls.includes("requeue"), false);
  assert.equal(h.calls.includes("manual-retry"), true);
  await h.context.leaveToLanding();
  assert.equal(h.calls.includes("home"), true);
});

test("late disconnect cancellation cannot erase the next attempt's pending offer", async () => {
  const h = await harness();
  const delayed = deferred();
  h.target.disconnectHandles.push({ cancel: () => delayed.promise });
  const cleaning = h.context.cleanupMatchmaking(false, h.target);
  const outgoing = { roomId: "new-outgoing" };
  const incoming = { roomId: "new-incoming" };
  h.target.pendingOffer = outgoing; h.target.pendingIncomingOffer = incoming;
  delayed.resolve(); await cleaning;
  assert.equal(h.target.pendingOffer, outgoing);
  assert.equal(h.target.pendingIncomingOffer, incoming);
});

test("a timed-out score read cannot resolve a round later or release an unconfirmed room", async () => {
  const h = await harness();
  const delayed = deferred();
  h.context.updatePublicPresence = async () => { throw Error("fixture"); };
  const get = h.context.get;
  h.context.get = (name) => name.endsWith("/scores") ? delayed.promise : get(name);
  await h.enter();
  await h.advance(3_000);
  assert.equal(h.target.screen, "error");
  assert.equal(h.calls.filter((value) => ["cancel", "release"].includes(value?.action)).length, 0);
  delayed.resolve({ val: () => ({ host: 1, guest: 2 }) }); await flush();
  assert.equal(h.calls.includes("resolve-round"), false);
  assert.equal(h.target.screen, "error");
  h.context.get = get;
  await h.context.completeP2pFailureCleanup(h.target, { generationToken: h.target.p2pRecovery.generationToken });
  assert.equal(h.target.soloSessionLease, null);
  assert.equal(h.calls.includes("requeue"), false);
});

test("a rejected score read stays pending and a resolved final score is preserved", async () => {
  for (const rejected of [true, false]) {
    const h = await harness();
    h.context.updatePublicPresence = async () => { throw Error("fixture"); };
    const get = h.context.get;
    h.context.get = (name) => name.endsWith("/scores")
      ? (rejected ? Promise.reject(Error("offline")) : Promise.resolve({ val: () => ({ host: 1, guest: 2 }) })) : get(name);
    await h.enter();
    assert.equal(h.calls.filter((value) => ["cancel", "release"].includes(value?.action)).length, 0);
    assert.equal(h.calls.includes("resolve-round"), !rejected);
    assert.equal(h.calls.includes("preserve-result"), !rejected);
    if (rejected) assert.equal(h.target.screen, "error");
  }
});

test("setup failure and the existing recovery timer dispatch cleanup only once", async () => {
  const h = await harness();
  await h.enter();
  const token = h.target.p2pRecovery.timerToken;
  h.context.dispatchP2pRecoveryEvent("SETUP_FAILED", h.target);
  h.context.dispatchP2pRecoveryEvent("TIMER_EXPIRED", h.target, { timerToken: token });
  h.context.dispatchP2pRecoveryEvent("SETUP_FAILED", h.target);
  await flush();
  assert.equal(h.calls.filter((value) => value?.action === "release").length, 1);
  assert.equal(h.calls.filter((value) => value === "requeue").length, 1);
});

test("a current room whose listener setup returns false enters failure cleanup", async () => {
  const h = await harness();
  h.context.setupRoomListeners = async () => { h.target.soloSessionLeaseHeld = false; return false; };
  await h.enter();
  assert.equal(h.target.roomSetupAttempt.failed, true);
  assert.equal(h.calls.filter((value) => value?.action === "release").length, 1);
  assert.equal(h.calls.filter((value) => value === "requeue").length, 1);
});

test("confirmed cancellation resumes release after room read access has been revoked", async () => {
  const h = await harness();
  h.context.updatePublicPresence = async () => { throw Error("fixture"); };
  const callable = h.context.soloSessionActionCallable;
  const get = h.context.get;
  let cancelled = false;
  let releaseAttempts = 0;
  let deniedReads = 0;
  h.context.soloSessionActionCallable = async (request) => {
    if (request.action === "cancel") cancelled = true;
    if (request.action === "release" && ++releaseAttempts <= 3) throw Error("offline");
    return callable(request);
  };
  h.context.get = (name) => {
    if (cancelled && name.endsWith("/scores")) { deniedReads += 1; return Promise.reject(Error("permission-denied")); }
    return get(name);
  };
  await h.enter();
  await h.advance(750);
  assert.equal(cancelled, true);
  assert.equal(releaseAttempts, 3);
  assert.equal(h.target.screen, "error");
  const effect = { generationToken: h.target.p2pRecovery.generationToken };
  await h.context.completeP2pFailureCleanup(h.target, effect);
  assert.equal(releaseAttempts, 4);
  assert.equal(deniedReads, 0);
  assert.equal(h.target.soloSessionLease, null);
  assert.equal(h.calls.includes("requeue"), false);
});

test("a late score response cannot act after the same state switches room or round", async () => {
  for (const change of ["room", "round", "generation"]) {
    const h = await harness();
    h.target.roomId = h.roomId;
    h.target.opponentUid = "guest";
    const delayed = deferred();
    h.context.get = () => delayed.promise;
    const checking = h.context.preserveResolvedMatchBeforeP2pCleanup(h.target);
    if (change === "room") h.target.roomId = "new-room";
    if (change === "round") h.target.round += 1;
    if (change === "generation") h.target.matchmakingGeneration += 1;
    delayed.resolve({ val: () => ({ host: 1, guest: 2 }) });
    assert.equal(await checking, false);
    assert.equal(h.calls.includes("resolve-round"), false);
  }
});

test("a late initial signal rejection preserves a channel that already opened", async () => {
  const h = await harness();
  h.context.configureDataChannel = (channel, target) => {
    target.channel = channel;
    target.channelReady = true;
    h.context.dispatchP2pRecoveryEvent("CHANNEL_OPENED", target);
  };
  h.context.set = async (name) => { if (name.endsWith("/signal")) throw Error("late signal failure"); };
  await h.enter();
  assert.equal(h.target.peer.closed, false);
  assert.equal(h.target.channelReady, true);
  assert.equal(h.target.roomSetupAttempt.failed, false);
  assert.equal(h.target.roomSetupAttempt.settled, true);
  assert.equal(h.calls.some((value) => value?.action === "release"), false);
});

test("hung diagnostic collection cannot hold the existing P2P failure cleanup", async () => {
  const h = await harness();
  h.context.reportP2pDiagnostic = () => new Promise(() => {});
  await h.enter();
  await h.advance(25_000);
  assert.equal(h.calls.filter((value) => value?.action === "release").length, 1);
  assert.equal(h.calls.filter((value) => value === "requeue").length, 1);
});

test("late onDisconnect registration is cancelled after the setup watchdog", async () => {
  const h = await harness();
  const delayed = deferred();
  let cancelled = 0;
  h.context.onDisconnect = () => ({ set: () => delayed.promise, cancel: async () => { cancelled += 1; } });
  vm.runInContext(fn("setupRoomListeners"), h.context);
  const entering = h.context.attemptSoloServerMatch(1);
  await h.advance(30_000); await entering;
  delayed.resolve(); await flush();
  assert.equal(cancelled, 1);
  assert.equal(h.target.disconnectHandles.length, 0);
  assert.equal(h.target.roomUnsubscribers.length, 0);
  assert.equal(h.target.peer, null);
});
