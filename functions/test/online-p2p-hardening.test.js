const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const hardeningModule = import(
  pathToFileURL(path.join(root, "online-p2p-hardening.mjs")).href
);

const CONFIG = Object.freeze({
  connectionTimeoutMs: 100,
  disconnectedGraceMs: 20,
  restartTimeoutMs: 40,
  opponentCooldownMs: 200,
});

async function createState(overrides = {}) {
  const {
    createOnlineP2pGenerationToken,
    createOnlineP2pRecoveryState,
  } = await hardeningModule;
  const generationToken = overrides.generationToken
    || createOnlineP2pGenerationToken({
      matchmakingGeneration: 7,
      roomId: "room-a",
      sessionId: "session-a",
    });
  return createOnlineP2pRecoveryState({
    generationToken,
    isHost: overrides.isHost ?? true,
    opponentUid: overrides.opponentUid ?? "opponent-a",
    startedAt: overrides.startedAt ?? 1_000,
    autoRequeueCount: overrides.autoRequeueCount ?? 0,
    visible: overrides.visible ?? true,
    online: overrides.online ?? true,
    config: CONFIG,
  });
}

function event(state, type, now, overrides = {}) {
  return {
    type,
    now,
    generationToken: state.generationToken,
    ...overrides,
  };
}

test("host connection timeout performs exactly one ICE restart", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  const initial = await createState({ isHost: true });
  const connectionTimer = getOnlineP2pRecoveryTimer(initial);

  const restarted = transitionOnlineP2pRecovery(initial, event(
    initial,
    "TIMER_EXPIRED",
    connectionTimer.deadlineAt,
    { timerToken: connectionTimer.timerToken },
  ));

  assert.equal(restarted.state.phase, "restarting");
  assert.equal(restarted.state.iceRestartCount, 1);
  assert.deepEqual(restarted.effects.map(({ type }) => type), ["restart-ice"]);

  const restartTimer = getOnlineP2pRecoveryTimer(restarted.state);
  const failed = transitionOnlineP2pRecovery(restarted.state, event(
    restarted.state,
    "TIMER_EXPIRED",
    restartTimer.deadlineAt,
    { timerToken: restartTimer.timerToken },
  ));

  assert.equal(failed.state.phase, "cleaning-up");
  assert.equal(failed.state.iceRestartCount, 1);
  assert.deepEqual(failed.effects.map(({ type }) => type), ["cleanup-failed-room"]);
});

test("duplicate failed notifications cannot skip the bounded restart wait", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  const initial = await createState({ isHost: true });
  const restarting = transitionOnlineP2pRecovery(
    initial,
    event(initial, "ICE_FAILED", 1_010),
  );
  const restartTimer = getOnlineP2pRecoveryTimer(restarting.state);

  const duplicate = transitionOnlineP2pRecovery(
    restarting.state,
    event(restarting.state, "ICE_FAILED", 1_011),
  );
  assert.equal(duplicate.ignored, true);
  assert.equal(duplicate.state.phase, "restarting");
  assert.strictEqual(
    getOnlineP2pRecoveryTimer(duplicate.state).timerToken,
    restartTimer.timerToken,
  );
  assert.deepEqual(duplicate.effects, []);

  const timedOut = transitionOnlineP2pRecovery(duplicate.state, event(
    duplicate.state,
    "TIMER_EXPIRED",
    restartTimer.deadlineAt,
    { timerToken: restartTimer.timerToken },
  ));
  assert.equal(timedOut.state.phase, "cleaning-up");
  assert.deepEqual(timedOut.effects.map(({ type }) => type), ["cleanup-failed-room"]);
});

test("guest waits for the host restart and never emits restart-ice", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  const initial = await createState({ isHost: false });
  const timer = getOnlineP2pRecoveryTimer(initial);
  const waiting = transitionOnlineP2pRecovery(initial, event(
    initial,
    "TIMER_EXPIRED",
    timer.deadlineAt,
    { timerToken: timer.timerToken },
  ));

  assert.equal(waiting.state.phase, "awaiting-host-restart");
  assert.equal(waiting.state.iceRestartCount, 0);
  assert.deepEqual(waiting.effects, []);

  const repeatedFailure = transitionOnlineP2pRecovery(
    waiting.state,
    event(waiting.state, "ICE_FAILED", 1_105),
  );
  assert.equal(repeatedFailure.ignored, true);
  assert.strictEqual(
    getOnlineP2pRecoveryTimer(repeatedFailure.state).timerToken,
    getOnlineP2pRecoveryTimer(waiting.state).timerToken,
  );

  const received = transitionOnlineP2pRecovery(
    repeatedFailure.state,
    event(repeatedFailure.state, "RESTART_OFFER_RECEIVED", 1_110),
  );
  assert.equal(received.state.phase, "restarting");
  assert.equal(received.state.iceRestartCount, 1);
  assert.deepEqual(received.effects, []);

  const restartTimer = getOnlineP2pRecoveryTimer(received.state);
  const failed = transitionOnlineP2pRecovery(received.state, event(
    received.state,
    "TIMER_EXPIRED",
    restartTimer.deadlineAt,
    { timerToken: restartTimer.timerToken },
  ));
  assert.equal(failed.state.phase, "cleaning-up");
});

test("a delayed restart offer cannot re-arm recovery after the channel opened", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let state = await createState({ isHost: false });
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "CHANNEL_OPENED", 1_010),
  ).state;

  const delayedOffer = transitionOnlineP2pRecovery(
    state,
    event(state, "RESTART_OFFER_RECEIVED", 1_020),
  );
  assert.equal(delayedOffer.ignored, true);
  assert.equal(delayedOffer.state.phase, "connected");
  assert.equal(delayedOffer.state.channelWasOpened, true);
  assert.equal(getOnlineP2pRecoveryTimer(delayedOffer.state), null);
});

test("a brief disconnection is tolerated and its obsolete timer cannot fire", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let state = await createState();
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "CHANNEL_OPENED", 1_010),
  ).state;
  const disconnected = transitionOnlineP2pRecovery(
    state,
    event(state, "ICE_DISCONNECTED", 1_020),
  );
  const graceTimer = getOnlineP2pRecoveryTimer(disconnected.state);

  const recovered = transitionOnlineP2pRecovery(
    disconnected.state,
    event(disconnected.state, "ICE_CONNECTED", 1_030),
  );
  assert.equal(recovered.state.phase, "connected");
  assert.equal(getOnlineP2pRecoveryTimer(recovered.state), null);

  const stale = transitionOnlineP2pRecovery(recovered.state, event(
    recovered.state,
    "TIMER_EXPIRED",
    graceTimer.deadlineAt,
    { timerToken: graceTimer.timerToken },
  ));
  assert.equal(stale.ignored, true);
  assert.equal(stale.state.phase, "connected");
  assert.deepEqual(stale.effects, []);
});

test("ICE recovery during the initial handshake resumes its remaining connection timeout", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  const initial = await createState();
  const disconnected = transitionOnlineP2pRecovery(
    initial,
    event(initial, "ICE_DISCONNECTED", 1_040),
  );
  const graceTimer = getOnlineP2pRecoveryTimer(disconnected.state);
  const recovered = transitionOnlineP2pRecovery(
    disconnected.state,
    event(disconnected.state, "ICE_CONNECTED", 1_050),
  );
  const resumedTimer = getOnlineP2pRecoveryTimer(recovered.state);

  assert.equal(recovered.state.phase, "connecting");
  assert.equal(recovered.state.channelWasOpened, false);
  assert.equal(resumedTimer.deadlineAt, 1_110);
  assert.notStrictEqual(resumedTimer.timerToken, graceTimer.timerToken);
});

test("disconnected grace expiry starts recovery only on the host", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let host = await createState({ isHost: true });
  host = transitionOnlineP2pRecovery(
    host,
    event(host, "CHANNEL_OPENED", 1_005),
  ).state;
  host = transitionOnlineP2pRecovery(
    host,
    event(host, "ICE_DISCONNECTED", 1_010),
  ).state;
  const hostTimer = getOnlineP2pRecoveryTimer(host);
  const hostRecovery = transitionOnlineP2pRecovery(host, event(
    host,
    "TIMER_EXPIRED",
    hostTimer.deadlineAt,
    { timerToken: hostTimer.timerToken },
  ));
  assert.equal(hostRecovery.state.phase, "restarting");
  assert.deepEqual(hostRecovery.effects.map(({ type }) => type), ["restart-ice"]);

  let guest = await createState({ isHost: false });
  guest = transitionOnlineP2pRecovery(
    guest,
    event(guest, "CHANNEL_OPENED", 1_005),
  ).state;
  guest = transitionOnlineP2pRecovery(
    guest,
    event(guest, "ICE_DISCONNECTED", 1_010),
  ).state;
  const guestTimer = getOnlineP2pRecoveryTimer(guest);
  const guestRecovery = transitionOnlineP2pRecovery(guest, event(
    guest,
    "TIMER_EXPIRED",
    guestTimer.deadlineAt,
    { timerToken: guestTimer.timerToken },
  ));
  assert.equal(guestRecovery.state.phase, "awaiting-host-restart");
  assert.deepEqual(guestRecovery.effects, []);
});

test("guest fails cleanly if no host restart arrives before its bounded wait", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let state = await createState({ isHost: false });
  let timer = getOnlineP2pRecoveryTimer(state);
  state = transitionOnlineP2pRecovery(state, event(
    state,
    "TIMER_EXPIRED",
    timer.deadlineAt,
    { timerToken: timer.timerToken },
  )).state;
  timer = getOnlineP2pRecoveryTimer(state);

  const failed = transitionOnlineP2pRecovery(state, event(
    state,
    "TIMER_EXPIRED",
    timer.deadlineAt,
    { timerToken: timer.timerToken },
  ));
  assert.equal(failed.state.phase, "cleaning-up");
  assert.deepEqual(failed.effects.map(({ type }) => type), ["cleanup-failed-room"]);
});

test("cleanup must complete before the one allowed auto-requeue is emitted", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let state = await createState({ isHost: true });
  let timer = getOnlineP2pRecoveryTimer(state);
  state = transitionOnlineP2pRecovery(state, event(
    state,
    "TIMER_EXPIRED",
    timer.deadlineAt,
    { timerToken: timer.timerToken },
  )).state;
  timer = getOnlineP2pRecoveryTimer(state);
  const cleanup = transitionOnlineP2pRecovery(state, event(
    state,
    "TIMER_EXPIRED",
    timer.deadlineAt,
    { timerToken: timer.timerToken },
  ));

  assert.equal(cleanup.state.phase, "cleaning-up");
  assert.deepEqual(cleanup.effects.map(({ type }) => type), ["cleanup-failed-room"]);
  assert.equal(cleanup.state.opponentCooldown.opponentUid, "opponent-a");
  assert.equal(cleanup.state.opponentCooldown.expiresAt, timer.deadlineAt + 200);

  const requeue = transitionOnlineP2pRecovery(
    cleanup.state,
    event(cleanup.state, "CLEANUP_COMPLETED", timer.deadlineAt + 1),
  );
  assert.equal(requeue.state.phase, "terminal");
  assert.equal(requeue.state.resolution, "auto-requeue");
  assert.equal(requeue.effects[0].type, "auto-requeue");
  assert.equal(requeue.effects[0].autoRequeueCount, 1);
  assert.deepEqual(
    requeue.effects[0].opponentCooldown,
    cleanup.state.opponentCooldown,
  );
});

test("manual cancel, a hidden page, offline state, and the retry limit block requeue", async (t) => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  const cases = [
    {
      name: "manual cancel",
      prepare: (state) => transitionOnlineP2pRecovery(
        state,
        event(state, "MANUAL_CANCELLED", 1_001),
      ).state,
      expectedReason: "manual-cancel",
    },
    {
      name: "hidden page",
      prepare: (state) => transitionOnlineP2pRecovery(
        state,
        event(state, "VISIBILITY_CHANGED", 1_001, { visible: false }),
      ).state,
      expectedReason: "page-hidden",
    },
    {
      name: "offline",
      prepare: (state) => transitionOnlineP2pRecovery(
        state,
        event(state, "NETWORK_CHANGED", 1_001, { online: false }),
      ).state,
      expectedReason: "offline",
    },
    {
      name: "auto-requeue already used",
      stateOverrides: { autoRequeueCount: 1 },
      prepare: (state) => state,
      expectedReason: "auto-requeue-limit",
    },
  ];

  for (const current of cases) {
    await t.test(current.name, async () => {
      let state = await createState(current.stateOverrides);
      state = current.prepare(state);
      state = transitionOnlineP2pRecovery(
        state,
        event(state, "ICE_FAILED", 1_010),
      ).state;
      const restartTimer = getOnlineP2pRecoveryTimer(state);
      state = transitionOnlineP2pRecovery(
        state,
        event(state, "TIMER_EXPIRED", restartTimer.deadlineAt, {
          timerToken: restartTimer.timerToken,
        }),
      ).state;
      assert.equal(state.phase, "cleaning-up");

      const completed = transitionOnlineP2pRecovery(
        state,
        event(state, "CLEANUP_COMPLETED", 1_021),
      );
      assert.equal(completed.state.resolution, current.expectedReason);
      assert.equal(completed.effects[0].type, "show-connection-failure");
      assert.equal(completed.effects[0].reason, current.expectedReason);
    });
  }
});

test("page visibility and connectivity are rechecked after asynchronous cleanup", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let state = await createState();
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "ICE_FAILED", 1_010),
  ).state;
  const restartTimer = getOnlineP2pRecoveryTimer(state);
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "TIMER_EXPIRED", restartTimer.deadlineAt, {
      timerToken: restartTimer.timerToken,
    }),
  ).state;
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "VISIBILITY_CHANGED", 1_021, { visible: false }),
  ).state;

  const completed = transitionOnlineP2pRecovery(
    state,
    event(state, "CLEANUP_COMPLETED", 1_022),
  );
  assert.equal(completed.effects[0].type, "show-connection-failure");
  assert.equal(completed.effects[0].reason, "page-hidden");
});

test("a DataChannel that opens during cleanup blocks automatic requeue without reviving the room", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let state = await createState();
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "ICE_FAILED", 1_010),
  ).state;
  const restartTimer = getOnlineP2pRecoveryTimer(state);
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "TIMER_EXPIRED", restartTimer.deadlineAt, {
      timerToken: restartTimer.timerToken,
    }),
  ).state;
  assert.equal(state.phase, "cleaning-up");

  const lateOpen = transitionOnlineP2pRecovery(
    state,
    event(state, "CHANNEL_OPENED", restartTimer.deadlineAt + 1),
  );
  assert.equal(lateOpen.ignored, false);
  assert.equal(lateOpen.state.phase, "cleaning-up");
  assert.equal(lateOpen.state.channelWasOpened, true);
  assert.deepEqual(lateOpen.effects, []);

  const completed = transitionOnlineP2pRecovery(
    lateOpen.state,
    event(lateOpen.state, "CLEANUP_COMPLETED", restartTimer.deadlineAt + 2),
  );
  assert.equal(completed.state.phase, "terminal");
  assert.equal(completed.state.resolution, "connection-was-established");
  assert.equal(completed.effects[0].type, "show-connection-failure");
  assert.equal(completed.effects[0].reason, "connection-was-established");
});

test("the immediately failed opponent stays excluded until cooldown expiry", async () => {
  const { isOnlineP2pOpponentCoolingDown } = await hardeningModule;
  const cooldown = Object.freeze({
    opponentUid: "opponent-a",
    expiresAt: 1_200,
  });

  assert.equal(
    isOnlineP2pOpponentCoolingDown(cooldown, "opponent-a", 1_199),
    true,
  );
  assert.equal(
    isOnlineP2pOpponentCoolingDown(cooldown, "opponent-a", 1_200),
    false,
  );
  assert.equal(
    isOnlineP2pOpponentCoolingDown(cooldown, "opponent-b", 1_100),
    false,
  );
});

test("callbacks from an old generation and replaced timers are ignored", async () => {
  const {
    createOnlineP2pGenerationToken,
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  const state = await createState();
  const oldTimer = getOnlineP2pRecoveryTimer(state);
  const oldGeneration = createOnlineP2pGenerationToken({
    matchmakingGeneration: 6,
    roomId: "old-room",
  });

  const staleGeneration = transitionOnlineP2pRecovery(state, {
    type: "ICE_FAILED",
    now: 1_050,
    generationToken: oldGeneration,
  });
  assert.equal(staleGeneration.ignored, true);
  assert.strictEqual(staleGeneration.state, state);

  const disconnected = transitionOnlineP2pRecovery(
    state,
    event(state, "ICE_DISCONNECTED", 1_010),
  );
  const staleTimer = transitionOnlineP2pRecovery(disconnected.state, event(
    disconnected.state,
    "TIMER_EXPIRED",
    1_100,
    { timerToken: oldTimer.timerToken },
  ));
  assert.equal(staleTimer.ignored, true);
  assert.equal(staleTimer.state.phase, "disconnected");
  assert.deepEqual(staleTimer.effects, []);
});

test("an established match is never silently auto-requeued after failure", async () => {
  const {
    getOnlineP2pRecoveryTimer,
    transitionOnlineP2pRecovery,
  } = await hardeningModule;
  let state = await createState();
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "CHANNEL_OPENED", 1_010),
  ).state;
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "ICE_FAILED", 1_020),
  ).state;
  const restartTimer = getOnlineP2pRecoveryTimer(state);
  state = transitionOnlineP2pRecovery(
    state,
    event(state, "TIMER_EXPIRED", restartTimer.deadlineAt, {
      timerToken: restartTimer.timerToken,
    }),
  ).state;
  const completed = transitionOnlineP2pRecovery(
    state,
    event(state, "CLEANUP_COMPLETED", 1_031),
  );

  assert.equal(completed.state.resolution, "connection-was-established");
  assert.equal(completed.effects[0].type, "show-connection-failure");
});
