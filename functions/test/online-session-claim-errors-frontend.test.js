"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../../online.js"), "utf8");
const start = source.indexOf("async function claimSoloSessionLease(");
const end = source.indexOf("\nfunction clearSoloSessionHeartbeat(", start);
assert.ok(start >= 0 && end > start);
const claimSource = source.slice(start, end);

function claimHarness(callable, { ownerGone = false, ownerProbe } = {}) {
  const expectedState = {
    uid: "test-player",
    clientSessionId: "a".repeat(32),
    clientLeaseToken: "b".repeat(32),
    matchmakingGeneration: 1,
    screen: "matching",
    roomId: "",
    soloSessionLeaseHeld: false,
  };
  const calls = [];
  const toasts = [];
  const releases = [];
  let now = 0;
  let probes = 0;
  let heartbeats = 0;
  const context = {
    state: expectedState,
    active: true,
    SOLO_STATS_PROJECTION_VERSION: 2,
    document: { visibilityState: "visible" },
    navigator: { onLine: true },
    window: { setTimeout: (callback, delay) => { now += delay; callback(); } },
    p2pMonotonicNow: () => now,
    isCurrentMatchmakingGeneration: (generation) => (
      context.active && context.state === expectedState
      && expectedState.matchmakingGeneration === generation
      && expectedState.screen === "matching"
    ),
    soloSessionActionCallable: async (request) => {
      calls.push(request);
      return callable(request, calls.length, context);
    },
    confirmSameSessionOwnerGone: async () => {
      probes += 1;
      return ownerProbe ? ownerProbe(context) : ownerGone;
    },
    releaseSoloSessionClaimExact: async (claim) => { releases.push(claim); },
    isOnlineSessionLeaseOwner: (lease, owner) => (
      lease?.sessionId === owner.sessionId && lease?.leaseToken === owner.leaseToken
    ),
    scheduleSoloSessionLeaseHeartbeat: () => { heartbeats += 1; },
    showToast: (message) => { toasts.push(message); },
  };
  vm.createContext(context);
  vm.runInContext(`${claimSource}\nthis.claim = claimSoloSessionLease;`, context);
  return {
    context, calls, toasts, releases, expectedState,
    run: () => context.claim(),
    probeCount: () => probes,
    heartbeatCount: () => heartbeats,
    elapsedMs: () => now,
  };
}

function callableError(code, reason) {
  return Object.assign(new Error("private diagnostic must not appear in a toast"), {
    code,
    ...(reason ? { details: { reason } } : {}),
  });
}

function success(request) {
  return { data: {
    claimed: true,
    sessionGeneration: "g".repeat(22),
    lease: { sessionId: request.sessionId, leaseToken: request.leaseToken },
  } };
}

const failures = [
  ["functions/unavailable", /通信状態を確認/],
  ["functions/deadline-exceeded", /通信状態を確認/],
  ["functions/network-request-failed", /通信状態を確認/],
  ["functions/permission-denied", /接続が拒否.*再読み込み/],
  ["PERMISSION_DENIED", /接続が拒否.*再読み込み/],
  ["functions/unauthenticated", /ログイン状態.*再読み込み/],
  ["functions/resource-exhausted", /操作が短時間に集中.*少し待って/],
  ["functions/internal", /接続処理に失敗.*少し待って/],
  ["functions/unknown", /接続状態を確認できません/],
  [undefined, /接続状態を確認できません/],
];

for (const [code, expectedMessage] of failures) {
  test(`claim ${code || "missing error code"} is recoverable feedback without claiming another tab exists`, async () => {
    const harness = claimHarness(async () => { throw callableError(code); });
    assert.equal(await harness.run(), false);
    assert.equal(harness.toasts.length, 1);
    assert.match(harness.toasts[0], expectedMessage);
    assert.doesNotMatch(harness.toasts[0], /別の?タブ|使用中|private diagnostic/);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].sameSessionOwnerConfirmedGone, false);
    assert.equal(harness.probeCount(), 0);
    assert.equal(harness.expectedState.soloSessionLeaseHeld, false);
    assert.equal(harness.releases.length, 0);
    assert.equal(harness.heartbeatCount(), 0);
  });
}

for (const asException of [false, true]) {
  test(`explicit occupied ${asException ? "exception" : "response"} preserves the existing session`, async () => {
    const harness = claimHarness(async () => {
      if (asException) throw callableError("functions/failed-precondition", "occupied");
      return { data: { claimed: false, reason: "occupied" } };
    }, { ownerGone: true });
    assert.equal(await harness.run(), false);
    assert.match(harness.toasts[0], /接続がまだ使用中/);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.probeCount(), 0);
    assert.equal(harness.releases.length, 0);
    assert.equal(harness.expectedState.soloSessionLeaseHeld, false);
  });
}

for (const ownerProbe of [undefined, async () => { throw new Error("channel unavailable"); }]) {
  test(`same-session ownership ${ownerProbe ? "probe failure" : "unconfirmed"} does not assert a second tab exists`, async () => {
    const harness = claimHarness(async () => ({ data: { claimed: false, reason: "same-session-owned" } }), { ownerProbe });
    assert.equal(await harness.run(), false);
    assert.match(harness.toasts[0], /前の通常版1on1の接続.*確認できません.*少し待って/);
    assert.doesNotMatch(harness.toasts[0], /別の?タブ|使用中/);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.probeCount(), 1);
    assert.equal(harness.releases.length, 0);
  });
}

test("a confirmed old page gets one takeover attempt and adopts only the successful lease", async () => {
  const harness = claimHarness(async (request, count) => count === 1
    ? { data: { claimed: false, reason: "same-session-owned" } }
    : success(request), { ownerGone: true });
  assert.equal(await harness.run(), true);
  assert.deepEqual(harness.calls.map((call) => call.sameSessionOwnerConfirmedGone), [false, true]);
  assert.equal(harness.probeCount(), 1);
  assert.equal(harness.expectedState.soloSessionLeaseHeld, true);
  assert.equal(harness.heartbeatCount(), 1);
  assert.equal(harness.releases.length, 0);
  assert.equal(harness.toasts.length, 0);
});

for (const [code, expectedMessage] of failures) {
  test(`the confirmed-gone retry also classifies ${code || "missing error code"}`, async () => {
    const harness = claimHarness(async (request, count) => {
      if (count === 1) throw callableError("functions/failed-precondition", "same-session-owned-by-another-page");
      throw callableError(code);
    }, { ownerGone: true });
    assert.equal(await harness.run(), false);
    assert.equal(harness.toasts.length, 1);
    assert.match(harness.toasts[0], expectedMessage);
    assert.doesNotMatch(harness.toasts[0], /別の?タブ|使用中|private diagnostic/);
    assert.deepEqual(harness.calls.map((call) => call.sameSessionOwnerConfirmedGone), [false, true]);
    assert.equal(harness.probeCount(), 1);
    assert.equal(harness.releases.length, 0);
    assert.equal(harness.expectedState.soloSessionLeaseHeld, false);
  });
}

test("a still-owned session after the one takeover attempt stops without looping or releasing it", async () => {
  const harness = claimHarness(async () => ({ data: { claimed: false, reason: "same-session-owned" } }), { ownerGone: true });
  assert.equal(await harness.run(), false);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.probeCount(), 1);
  assert.equal(harness.releases.length, 0);
  assert.match(harness.toasts[0], /接続が終了したことを確認できません/);
});

test("upgrade-required and unknown denials stay blocked with their own recovery instructions", async () => {
  for (const [reason, message] of [
    ["client-upgrade-required", /更新されました.*再読み込み/],
    ["future-server-reason", /接続状態を確認できません/],
  ]) {
    const harness = claimHarness(async () => ({ data: { claimed: false, reason } }));
    assert.equal(await harness.run(), false);
    assert.equal(harness.calls.length, 1);
    assert.match(harness.toasts[0], message);
    assert.doesNotMatch(harness.toasts[0], /別の?タブ/);
    assert.equal(harness.releases.length, 0);
  }
});

test("legacy waiting retains its 50-second bound and never bypasses the existing session", async () => {
  const harness = claimHarness(async () => ({ data: { claimed: false, reason: "legacy-waiting" } }));
  assert.equal(await harness.run(), false);
  assert.equal(harness.elapsedMs(), 50_000);
  assert.equal(harness.calls.length, 11);
  assert.match(harness.toasts.at(-1), /前の通常版1on1の待機が残っています/);
  assert.equal(harness.releases.length, 0);
  assert.ok(harness.calls.every((call) => call.sameSessionOwnerConfirmedGone === false));
});

test("a cancelled launch never retries a confirmed-gone probe", async () => {
  const harness = claimHarness(async () => ({ data: { claimed: false, reason: "same-session-owned" } }), {
    ownerProbe: async (context) => { context.active = false; return true; },
  });
  assert.equal(await harness.run(), false);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.toasts.length, 0);
  assert.equal(harness.releases.length, 0);
});

test("a late error cannot notify or retry after its launch was cancelled", async () => {
  const harness = claimHarness(async (request, count, context) => {
    context.active = false;
    throw callableError("functions/unavailable");
  });
  assert.equal(await harness.run(), false);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.toasts.length, 0);
  assert.equal(harness.releases.length, 0);
  assert.equal(harness.probeCount(), 0);
});

test("a late successful claim still releases only the exact abandoned claim", async () => {
  const harness = claimHarness(async (request, count, context) => {
    context.active = false;
    return success(request);
  });
  assert.equal(await harness.run(), false);
  assert.equal(harness.releases.length, 1);
  assert.equal(harness.releases[0].sessionId, harness.expectedState.clientSessionId);
  assert.equal(harness.releases[0].leaseToken, harness.expectedState.clientLeaseToken);
  assert.equal(harness.releases[0].generation, "g".repeat(22));
  assert.equal(harness.toasts.length, 0);
  assert.equal(harness.expectedState.soloSessionLeaseHeld, false);
});
