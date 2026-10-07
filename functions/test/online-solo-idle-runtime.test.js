"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "online.js"), "utf8");
const modules = Promise.all(["online-solo-idle-guard.mjs", "online-room-lifecycle.mjs"]
  .map((file) => import(pathToFileURL(path.join(root, file)).href)));
function fn(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const body = source.slice(match.index);
  const end = /\n\}\r?\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 60; i += 1) await Promise.resolve(); }

async function harness(overrides = {}) {
  const [idle, lifecycle] = await modules;
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const target = {
    uid: "player", clientSessionId: "a".repeat(32), clientLeaseToken: "b".repeat(32),
    soloSessionGeneration: "G".repeat(22), soloSessionLease: { expiresAt: 999999999 },
    soloSessionLeaseHeld: true, soloSessionOwnershipLost: false,
    matchmakingGeneration: 1, screen: "matching", roomId: "",
    p2pAutoRequeueStartedAt: 0, matchUnsubscribers: [], roomUnsubscribers: [],
    disconnectHandles: [], pendingOffer: null, pendingIncomingOffer: null,
    deck: [{ id: "kept-card", caption: "keep" }], name: "KEEP NAME", profile: { wins: 7 },
    soloSessionCleanupPending: false,
  };
  const window = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    clearInterval(id) { timers.delete(id); },
  };
  const context = vm.createContext({
    ...idle, ...lifecycle, window, state: target, active: true,
    Date: { now: () => now }, document: { visibilityState: "visible" },
    navigator: { onLine: true }, console: { error() {} },
    matchmakingGenerationCounter: 1, ONLINE_P2P_RECOVERY_PHASES: { CLEANING_UP: "cleaning" },
    ONLINE_CLEANUP_WAIT_MS: 15000, ONLINE_CLEANUP_AUXILIARY_WAIT_MS: 3000,
    setOnlineChrome() {}, render() { calls.push("render"); },
    dispatchP2pRecoveryEvent() {}, clearP2pRecoveryTimer() {}, clearActiveContact() {},
    clearFinishCutIn() {}, clearPendingFinishReplyAcks() {}, clearImageAckWatchdog() {},
    stopSelectionTimer() {}, notifyEngawaDeparture() {}, releaseEngawaMedia() {},
    clearSoloServerMatchRetry() {}, scheduleSoloServerMatchRetry() {}, notifySoloMatchRecovery() {},
    normalizeSoloPermitCandidate: (candidate) => candidate,
    soloSessionActionCallable: async (request) => {
      calls.push(request);
      return { data: request.action === "release" ? { released: true } : { outcome: "waiting" } };
    },
    scheduleSoloSessionLeaseHeartbeat() { calls.push("heartbeat-scheduled"); },
    cleanupPublicPresence: async () => { calls.push("presence-cleaned"); },
    cancelSoloSessionRoomOnce: async () => { calls.push("room-cancelled"); return { cancelled: true }; },
    releaseSoloSessionLease: async () => { calls.push("unconditional-release"); return true; },
    drainIncomingOffers: async () => { calls.push("drain-offer"); },
    handleRecoverableError() {},
    enterRoom: async (roomId) => { target.roomId = roomId; target.screen = "connecting"; target.soloHiddenWaitGuard?.dispose(); },
    adoptSoloServerHostedMatch: async (_candidate, match) => { target.pendingOffer = match; },
    ...overrides,
  });
  const names = [
    "soloHiddenWaitContext", "startSoloHiddenWaitGuard", "stopSoloHiddenMatchmaking",
    "clearSoloSessionHeartbeat", "cancelMatching", "cleanupMatchmaking", "cleanupOnlineResources",
    "waitForOnlineOperation", "showSoloCleanupPending", "retrySoloCleanupOperation",
    "isCurrentMatchmakingGeneration", "attemptSoloServerMatch", "beginMatchmaking",
    "refreshSoloSessionLease",
  ];
  vm.runInContext(names.map(fn).join("\n"), context);
  context.startSoloHiddenWaitGuard(target, 1);
  return {
    context, target, calls, timers,
    async visible(value) {
      context.document.visibilityState = value ? "visible" : "hidden";
      target.soloHiddenWaitGuard?.sync();
      await flush();
    },
    async advance(ms, { frozen = false } = {}) {
      const until = now + ms;
      if (!frozen) {
        for (;;) {
          await flush();
          const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
          if (!next) break;
          now = next[1].at; timers.delete(next[0]); next[1].callback();
        }
      }
      now = until;
      await flush();
    },
    requests() { return calls.filter((entry) => entry?.action); },
  };
}

async function useRealHeartbeatLifecycle(h) {
  const session = await import(pathToFileURL(path.join(root, "online-session-guard.mjs")).href);
  Object.assign(h.context, {
    ONLINE_SESSION_LEASE_DEFAULTS: session.ONLINE_SESSION_LEASE_DEFAULTS,
    decideOnlineSessionHeartbeatResult: session.decideOnlineSessionHeartbeatResult,
    serverNow: () => h.context.Date.now(),
    showToast: () => h.calls.push("lease-loss-toast"),
  });
  h.target.soloSessionLease = {
    protocolVersion: 2, sessionId: h.target.clientSessionId, leaseToken: h.target.clientLeaseToken,
    claimedAt: 1000, heartbeatAt: 1000, expiresAt: 61000,
  };
  vm.runInContext([
    "scheduleSoloSessionLeaseHeartbeat", "markSoloSessionLeaseLost", "handleSoloSessionLeaseLost",
  ].map(fn).join("\n"), h.context);
}

test("visible inactivity never stops searching; hidden periods shorter than five minutes reset", async () => {
  const h = await harness();
  await h.advance(3600000);
  assert.equal(h.requests().length, 0);
  await h.visible(false);
  await h.advance(299999);
  await h.visible(true);
  await h.visible(false);
  await h.advance(299999);
  assert.equal(h.requests().length, 0);
  await h.advance(1);
  assert.equal(h.requests().length, 1);
  assert.equal(h.target.screen, "setup");
});

test("frozen timer expiration is caught on visible return and does not automatically resume", async () => {
  const h = await harness();
  const deck = h.target.deck;
  const profile = h.target.profile;
  await h.visible(false);
  await h.advance(300001, { frozen: true });
  await h.visible(true);
  assert.equal(h.target.screen, "setup");
  assert.equal(h.target.soloHiddenWaitStopped, true);
  assert.equal(h.target.deck, deck);
  assert.equal(h.target.profile, profile);
  assert.equal(h.target.name, "KEEP NAME");
  assert.equal(h.target.soloSessionLeaseHeld, false);
  assert.equal(h.target.soloSessionLease, null);
  assert.equal(h.target.soloHiddenWaitGuard, null);
  assert.equal(h.requests()[0].onlyWaiting, true);
  assert.equal(h.requests()[0].generation, "G".repeat(22));
  assert.ok(h.calls.includes("presence-cleaned"));
  assert.ok(!h.calls.includes("unconditional-release"));
  await h.advance(3600000);
  assert.equal(h.requests().length, 1);
});

for (const busy of ["soloHiddenWaitInitializationBusy", "soloServerMatchBusy", "matchingBusy", "acceptingOffer", "acceptingOfferRoomId", "pendingOffer", "pendingIncomingOffer", "soloSessionHeartbeatInFlight"]) {
  test(`expiration waits for ${busy} and then stops only if still waiting`, async () => {
    const h = await harness();
    h.target[busy] = true;
    await h.visible(false);
    await h.advance(300000);
    await h.visible(true);
    assert.equal(h.requests().length, 0);
    h.target[busy] = false;
    await h.advance(1000);
    assert.equal(h.target.screen, "setup");
    assert.equal(h.requests().length, 1);
  });
}

for (const screen of ["connecting", "select", "result", "setup"]) {
  test(`expiration never stops ${screen} or an assigned room`, async () => {
    const h = await harness();
    await h.visible(false);
    h.target.screen = screen;
    await h.advance(300000);
    assert.equal(h.requests().length, 0);
  });
}

test("a room assignment at the deadline wins even before connecting is rendered", async () => {
  const h = await harness();
  await h.visible(false);
  h.target.roomId = "assigned";
  await h.advance(300000);
  assert.equal(h.requests().length, 0);
});

for (const outcome of ["waiting", "join", "hosted"]) {
  test(`in-flight try_match ${outcome} result is processed before expiration cleanup`, async () => {
    const response = deferred();
    const h = await harness();
    h.context.soloSessionActionCallable = async (request) => {
      h.calls.push(request);
      return request.action === "try_match" ? response.promise : { data: { released: true } };
    };
    const request = h.context.attemptSoloServerMatch(1);
    await h.visible(false);
    await h.advance(300000);
    assert.deepEqual(h.requests().map((r) => r.action), ["try_match"]);
    response.resolve({ data: { outcome, roomId: "r".repeat(20), candidate: { uid: "peer" } } });
    await request;
    await flush();
    if (outcome === "waiting") {
      assert.deepEqual(h.requests().map((r) => r.action), ["try_match", "release"]);
      assert.equal(h.target.screen, "setup");
    } else {
      assert.equal(h.requests().length, 1);
      assert.ok(h.target.roomId || h.target.pendingOffer);
    }
  });
}

for (const reason of ["occupied", "match-in-progress", "resource-changed"]) {
  test(`conditional release ${reason} never falls through to ordinary release or restart`, async () => {
    const h = await harness();
    h.context.soloSessionActionCallable = async (request) => { h.calls.push(request); return { data: { released: false, reason } }; };
    await h.visible(false);
    await h.advance(300000);
    assert.equal(h.target.soloSessionLeaseHeld, true);
    assert.equal(h.target.screen, "matching");
    assert.equal(h.target.soloHiddenWaitGuard.blocksNewSearch(), true);
    await h.visible(true);
    await h.context.attemptSoloServerMatch(1);
    await h.advance(19999);
    assert.equal(h.requests().length, 1);
    await h.advance(1);
    assert.equal(h.requests().length, 2);
    assert.ok(h.requests().every((r) => r.action === "release" && r.onlyWaiting));
    assert.ok(!h.calls.includes("unconditional-release"));
  });
}

test("transport failure keeps a persistent pending display; only same-fence conditional retry can clear it", async () => {
  const h = await harness();
  let fail = true;
  h.context.soloSessionActionCallable = async (request) => {
    h.calls.push(request);
    if (fail) throw Error("network");
    return { data: { released: true } };
  };
  await h.visible(false);
  await h.advance(300000);
  assert.equal(h.target.soloHiddenWaitStopError, true);
  assert.equal(h.target.soloSessionCleanupPending, true);
  assert.equal(h.target.soloSessionLeaseHeld, true);
  await h.context.attemptSoloServerMatch(1);
  assert.equal(h.requests().length, 1);
  fail = false;
  h.target.soloHiddenWaitGuard.retry();
  await flush();
  assert.equal(h.target.screen, "setup");
  assert.equal(h.target.soloSessionCleanupPending, false);
  assert.ok(h.requests().every((r) => r.onlyWaiting));
});

test("a lost success response can settle via exact-fence lease-lost without touching a replacement claim", async () => {
  const h = await harness();
  h.context.soloSessionActionCallable = async (request) => { h.calls.push(request); return { data: { released: false, reason: "lease-lost" } }; };
  await h.visible(false);
  await h.advance(300000);
  assert.equal(h.target.screen, "setup");
  assert.equal(h.target.soloSessionOwnershipLost, true);
  assert.equal(h.target.soloSessionLeaseHeld, false);
  assert.ok(!h.calls.includes("unconditional-release"));
});

for (const change of ["state", "generation", "transition", "room"]) {
  test(`late conditional result cannot change a new ${change}`, async () => {
    const release = deferred();
    const h = await harness();
    h.context.soloSessionActionCallable = async (request) => { h.calls.push(request); return release.promise; };
    await h.visible(false);
    await h.advance(300000);
    assert.equal(h.requests().length, 1);
    if (change === "state") h.context.state = { ...h.target };
    if (change === "generation") h.target.matchmakingGeneration += 1;
    if (change === "transition") h.target.lifecycleTransitionToken = {};
    if (change === "room") h.target.roomId = "new-room";
    release.resolve({ data: { released: true } });
    await flush();
    assert.equal(h.target.soloSessionLeaseHeld, true);
    assert.equal(h.target.soloHiddenWaitStopped, undefined);
    assert.ok(!h.calls.includes("presence-cleaned"));
  });
}

test("heartbeat is disabled before slow presence cleanup, and no local restart passes cleanupPending", async () => {
  const presence = deferred();
  const h = await harness({ cleanupPublicPresence: () => presence.promise });
  await h.visible(false);
  await h.advance(300000);
  assert.equal(h.target.soloSessionLeaseHeld, false);
  assert.equal(h.target.soloSessionHeartbeat, null);
  assert.equal(h.target.soloSessionCleanupPending, true);
  assert.ok(h.target.cleanupPromise);
  await h.context.beginMatchmaking();
  assert.equal(h.target.screen, "error");
  assert.equal(h.requests().length, 1);
  presence.resolve();
  await flush();
  assert.equal(h.target.screen, "setup");
});

test("cleanup failure retains the stopped reason and blocks manual restart until cleanup is confirmed", async () => {
  const h = await harness({ clearFinishCutIn() { throw Error("cleanup failed"); } });
  await h.visible(false);
  await h.advance(300000);
  assert.equal(h.target.screen, "error");
  assert.equal(h.target.soloSessionCleanupPending, true);
  assert.equal(h.target.soloHiddenWaitStopped, true);
  assert.equal(h.target.soloSessionLeaseHeld, false);
  await h.context.beginMatchmaking();
  assert.equal(h.requests().length, 1);
});

test("manual restart claims a fresh fence and re-arms the clock, while automatic restart stays blocked", async () => {
  const h = await harness();
  await h.visible(false);
  await h.advance(300000);
  await h.visible(true);
  h.target.imagePreference = "both";
  Object.assign(h.context, {
    normalizeImagePreference: (value) => value, isOnlineDeckReady: () => true,
    getDeckSampleCount: () => 0, getStartingHp: () => 30,
    normalizePursuitLine: (value) => value, normalizeFinishLine: (value) => value,
    normalizeFinishReplyLine: (value) => value,
    CUSTOM_PURSUIT_VALUE: "custom", FINISH_LINE_DISABLED_VALUE: "off",
    CUSTOM_FINISH_VALUE: "custom", FINISH_REPLY_DISABLED_VALUE: "off", CUSTOM_FINISH_REPLY_VALUE: "custom",
    PROFILE_NAME_KEY: "name", IMAGE_PREFERENCE_KEY: "preference", INITIAL_RATING: 1200,
    localStorage: { setItem() {} }, persistRoleplayLineSettings() {},
    reconcileSoloProfileBeforeMatchmaking: async () => true,
    claimSoloSessionLease: async (target) => {
      h.calls.push("new-claim");
      target.soloSessionLease = { expiresAt: 999999999 };
      target.soloSessionLeaseHeld = true;
      target.soloSessionGeneration = "N".repeat(22);
      return true;
    },
    refreshSoloFamiliarBook: async () => {}, createOnlineSessionFence: (value) => value,
    database: {}, ref: (_db, value) => value,
    soloOfferPath: () => "offers", soloQueueEntryPath: () => "queue",
    serverNow: () => h.context.Date.now(), set: async () => {}, update: async () => {},
    ONLINE_SESSION_PROTOCOL_VERSION: 2, SOLO_STATS_PROJECTION_VERSION: 1,
    soloServerMatchmakingEnabled: () => true,
    startPublicPresence: async () => true, subscribeToOwnOffers() {}, watchSoloMatchConnectivity() {},
    attemptCurrentSoloMatchmaking: (generation) => h.context.attemptSoloServerMatch(generation),
  });
  await h.context.beginMatchmaking({ automatic: true });
  assert.equal(h.target.screen, "setup");
  assert.ok(!h.calls.includes("new-claim"));
  await h.context.beginMatchmaking();
  await flush();
  assert.equal(h.target.screen, "matching");
  assert.equal(h.target.soloHiddenWaitStopped, false);
  assert.equal(h.target.soloHiddenWaitGuard.expired, false);
  assert.equal(h.target.soloSessionGeneration, "N".repeat(22));
  assert.equal(h.requests().filter((r) => r.action === "try_match").length, 1);
  await h.advance(300000);
  assert.equal(h.requests().filter((r) => r.action === "release").length, 1);
});

test("a conditional release holds new heartbeats, then protected sessions resume their heartbeat", async () => {
  const release = deferred();
  const h = await harness();
  h.context.soloSessionActionCallable = async (request) => { h.calls.push(request); return release.promise; };
  await h.visible(false);
  await h.advance(300000);
  assert.equal(await h.context.refreshSoloSessionLease(h.target), false);
  assert.deepEqual(h.requests().map((r) => r.action), ["release"]);
  release.resolve({ data: { released: false, reason: "match-in-progress" } });
  await flush();
  assert.equal(h.target.soloSessionLeaseHeld, true);
  assert.ok(h.calls.includes("heartbeat-scheduled"));
});

test("expiration waits through heartbeat response and pending queue write before fenced cleanup", async () => {
  const heartbeat = deferred();
  const queueWrite = deferred();
  const h = await harness();
  Object.assign(h.context, {
    serverNow: () => h.context.Date.now(), ONLINE_SESSION_LEASE_DEFAULTS: { retryIntervalMs: 3000 },
    database: {}, ref: (_db, value) => value, soloQueueEntryPath: () => "queue",
    decideOnlineSessionHeartbeatResult: () => ({ action: "renew", lease: { expiresAt: 999999999 } }),
    update: () => queueWrite.promise,
    soloSessionActionCallable: async (request) => {
      h.calls.push(request);
      return request.action === "heartbeat" ? heartbeat.promise : { data: { released: true } };
    },
  });
  const running = h.context.refreshSoloSessionLease(h.target);
  await h.visible(false);
  await h.advance(300000);
  heartbeat.resolve({ data: {} });
  await flush();
  assert.deepEqual(h.requests().map((r) => r.action), ["heartbeat"]);
  assert.equal(h.target.soloSessionHeartbeatInFlight, true);
  queueWrite.resolve();
  await running;
  await h.advance(1000);
  assert.deepEqual(h.requests().map((r) => r.action), ["heartbeat", "release"]);
  assert.equal(h.target.screen, "setup");
  assert.equal(h.target.soloSessionLeaseHeld, false);
});

test("a late heartbeat cannot recreate queue or reschedule after the exact session has stopped", async () => {
  const heartbeat = deferred();
  const h = await harness();
  Object.assign(h.context, {
    serverNow: () => h.context.Date.now(),
    soloSessionActionCallable: () => heartbeat.promise,
    decideOnlineSessionHeartbeatResult: () => { throw Error("late heartbeat must be ignored"); },
  });
  const running = h.context.refreshSoloSessionLease(h.target);
  h.target.soloSessionLeaseHeld = false;
  heartbeat.resolve({ data: { lease: { expiresAt: 999999999 } } });
  assert.equal(await running, false);
  assert.ok(!h.calls.includes("heartbeat-scheduled"));
});

test("overdue heartbeat before visibilitychange uses waiting-only stop, not lease-lost cleanup", async () => {
  const h = await harness();
  Object.assign(h.context, {
    serverNow: () => h.context.Date.now(),
    markSoloSessionLeaseLost() { throw Error("must not take ordinary lost-lease cleanup"); },
  });
  h.target.soloSessionLease.expiresAt = 61000;
  await h.visible(false);
  await h.advance(300001, { frozen: true });
  h.context.document.visibilityState = "visible";
  assert.equal(await h.context.refreshSoloSessionLease(h.target), false);
  assert.equal(h.target.screen, "setup");
  assert.deepEqual(h.requests().map((r) => r.action), ["release"]);
  assert.equal(h.requests()[0].onlyWaiting, true);
});

for (const failure of ["protected", "network"]) {
  test(`expired waiting during ${failure} retry still renews its heartbeat`, async () => {
    const h = await harness();
    Object.assign(h.context, {
      serverNow: () => h.context.Date.now(), ONLINE_SESSION_LEASE_DEFAULTS: { retryIntervalMs: 3000 },
      database: {}, ref: (_db, value) => value, soloQueueEntryPath: () => "queue",
      decideOnlineSessionHeartbeatResult: () => ({ action: "renew", lease: { expiresAt: 999999999 } }),
      update: async () => {},
      soloSessionActionCallable: async (request) => {
        h.calls.push(request);
        if (request.action === "heartbeat") return { data: {} };
        if (failure === "network") throw Error("network");
        return { data: { released: false, reason: "match-in-progress" } };
      },
    });
    await h.visible(false);
    await h.advance(300000);
    assert.equal(h.target.soloHiddenWaitGuard.expired, true);
    assert.equal(await h.context.refreshSoloSessionLease(h.target), true);
    assert.deepEqual(h.requests().map((r) => r.action), ["release", "heartbeat"]);
    assert.equal(h.target.soloSessionLeaseHeld, true);
    assert.ok(h.calls.includes("heartbeat-scheduled"));
  });
}

for (const reason of ["match-in-progress", "occupied", "network"]) {
  test(`real expired heartbeat lifecycle after frozen return keeps ${reason} conditional-only with bounded retry`, async () => {
    const h = await harness();
    await useRealHeartbeatLifecycle(h);
    let confirmed = false;
    h.context.soloSessionActionCallable = async (request) => {
      h.calls.push(request);
      if (confirmed) return { data: { released: false, reason: "lease-lost" } };
      if (reason === "network") throw Error("network");
      return { data: { released: false, reason } };
    };
    await h.visible(false);
    await h.advance(300001, { frozen: true });
    h.context.document.visibilityState = "visible";
    assert.equal(await h.context.refreshSoloSessionLease(h.target), false);
    await flush();
    assert.equal(h.target.soloSessionLeaseHeld, true);
    assert.equal(h.target.soloSessionCleanupPending, true);
    assert.equal(h.target.soloHiddenWaitStopError, true);
    assert.equal(h.target.screen, "matching");
    assert.equal(h.requests().length, 1);
    assert.equal(h.requests()[0].onlyWaiting, true);
    assert.ok(!h.calls.includes("lease-loss-toast"));
    assert.ok(!h.calls.includes("unconditional-release"));
    assert.ok(!h.calls.includes("presence-cleaned"));
    // Exercise schedule and refresh expiry repeatedly: neither may reset the
    // controller's 20-second backoff or invoke ordinary lease-loss cleanup.
    h.context.scheduleSoloSessionLeaseHeartbeat(h.target);
    h.context.scheduleSoloSessionLeaseHeartbeat(h.target);
    await h.context.refreshSoloSessionLease(h.target);
    await h.advance(19999);
    assert.equal(h.requests().length, 1);
    await h.advance(1);
    assert.equal(h.requests().length, 2);
    assert.ok(h.requests().every((request) => request.action === "release" && request.onlyWaiting));
    assert.ok(!h.calls.includes("unconditional-release"));
    confirmed = true;
    h.target.soloHiddenWaitGuard.retry();
    await flush();
    assert.equal(h.target.screen, "setup");
    assert.equal(h.target.soloSessionLeaseHeld, false);
    assert.equal(h.target.soloHiddenWaitStopped, true);
    assert.ok(!h.calls.includes("unconditional-release"));
  });
}

test("real lost heartbeat response after frozen expiry cannot bypass conditional-only stopping", async () => {
  const heartbeat = deferred();
  const h = await harness();
  await useRealHeartbeatLifecycle(h);
  h.context.soloSessionActionCallable = async (request) => {
    h.calls.push(request);
    if (request.action === "heartbeat") return heartbeat.promise;
    return { data: { released: false, reason: "match-in-progress" } };
  };
  const running = h.context.refreshSoloSessionLease(h.target);
  await h.visible(false);
  await h.advance(300001, { frozen: true });
  heartbeat.resolve({ data: { claimed: false, reason: "lease-lost" } });
  assert.equal(await running, false);
  await h.advance(1000);
  assert.equal(h.target.soloHiddenWaitGuard.expired, true);
  assert.equal(h.target.soloSessionLeaseHeld, true);
  assert.deepEqual(h.requests().map((request) => request.action), ["heartbeat", "release"]);
  assert.ok(h.requests().filter((request) => request.action === "release").every((request) => request.onlyWaiting));
  assert.ok(!h.calls.includes("lease-loss-toast"));
  assert.ok(!h.calls.includes("unconditional-release"));
});

test("ordinary visible waiting lease expiry still uses the existing lost-session cleanup", async () => {
  const h = await harness();
  await useRealHeartbeatLifecycle(h);
  await h.advance(61000, { frozen: true });
  assert.equal(h.context.scheduleSoloSessionLeaseHeartbeat(h.target), false);
  await flush();
  assert.equal(h.target.soloSessionLeaseHeld, false);
  assert.equal(h.target.screen, "setup");
  assert.ok(h.calls.includes("lease-loss-toast"));
  assert.ok(h.calls.includes("unconditional-release"));
});

test("explicit manual cancellation still works after protected hidden-stop lease expiry", async () => {
  const h = await harness();
  await useRealHeartbeatLifecycle(h);
  h.context.soloSessionActionCallable = async (request) => {
    h.calls.push(request);
    return { data: { released: false, reason: "match-in-progress" } };
  };
  await h.visible(false);
  await h.advance(300001, { frozen: true });
  await h.visible(true);
  assert.equal(h.target.soloSessionLeaseHeld, true);
  await h.context.cancelMatching();
  assert.equal(h.target.screen, "setup");
  assert.ok(h.calls.includes("unconditional-release"));
});

test("assigned rooms and connecting phases are not captured by the hidden-wait lease-loss gate", async () => {
  for (const target of [{ screen: "connecting", roomId: "" }, { screen: "matching", roomId: "room" }]) {
    const h = await harness();
    await useRealHeartbeatLifecycle(h);
    await h.visible(false);
    await h.advance(300001, { frozen: true });
    h.target.soloHiddenWaitGuard.sync();
    Object.assign(h.target, target);
    h.context.handleSoloSessionLeaseLost = async () => { h.calls.push("ordinary-room-lease-loss"); };
    h.context.markSoloSessionLeaseLost(h.target);
    assert.equal(h.target.soloSessionLeaseHeld, false);
    assert.ok(h.calls.includes("ordinary-room-lease-loss"));
  }
});

test("visibility wiring preserves immediate automatic-P2P cancellation and setup has an explicit resume action", () => {
  const listener = source.slice(source.indexOf('document.addEventListener("visibilitychange"'), source.indexOf('window.addEventListener("hariai-player-safety-updated"'));
  assert.ok(listener.indexOf("cancelUnavailableAutomaticMatchmaking();") < listener.indexOf("state.soloHiddenWaitGuard?.sync();"));
  assert.match(fn("renderSetup"), /検索は自動では再開しません/);
  assert.match(fn("renderSetup"), /resumeSoloHiddenWait/);
  assert.match(fn("bindSoloCrownMatchmakingActions"), /resumeSoloHiddenWait[\s\S]*requestMatchmaking\(\{ intent: "regular" \}\)/);
  assert.match(fn("beginMatchmaking"), /automatic[\s\S]*expectedState\.soloHiddenWaitStopped/);
  assert.match(fn("beginMatchmaking"), /soloHiddenWaitStopped = false/);
  assert.match(fn("resetOnlineState"), /soloHiddenWaitStopped: expectedState\.soloHiddenWaitStopped/);
});
