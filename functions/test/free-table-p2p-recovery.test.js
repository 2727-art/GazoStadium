const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const frontendPath = path.join(root, "free-table.js");
const frontendSource = fs.readFileSync(frontendPath, "utf8");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createTimerHarness() {
  let nextId = 1;
  const timers = new Map();
  const register = (callback, delay, repeat = false) => {
    const id = nextId;
    nextId += 1;
    timers.set(id, { callback, delay, repeat });
    return id;
  };
  return {
    timers,
    setTimeout: (callback, delay) => register(callback, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => register(callback, delay, true),
    clearInterval: (id) => timers.delete(id),
    async run(id) {
      const timer = timers.get(id);
      assert.ok(timer, `timer ${id} should exist`);
      if (!timer.repeat) timers.delete(id);
      return timer.callback();
    },
  };
}

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function createChannel(label, readyState = "connecting") {
  return {
    label,
    readyState,
    bufferedAmount: 0,
    binaryType: "",
    close() {
      this.readyState = "closed";
    },
    send() {},
  };
}

function createFrontendHarness() {
  const timerHarness = createTimerHarness();
  const peerInstances = [];
  const callableCalls = [];
  let transferSequence = 0;

  class MockPeerConnection {
    constructor() {
      this.connectionState = "new";
      this.iceConnectionState = "new";
      this.signalingState = "stable";
      this.localDescription = null;
      this.remoteDescription = null;
      this.remoteDescriptionGate = null;
      this.remoteDescriptionStarted = null;
      this.remoteDescriptionRejections = 0;
      this.addIceCandidateGate = null;
      this.addedIce = [];
      this.closed = false;
      peerInstances.push(this);
    }

    createDataChannel(label) {
      return createChannel(label);
    }

    async createOffer() {
      return { type: "offer", sdp: "mock-offer" };
    }

    async createAnswer() {
      return { type: "answer", sdp: "mock-answer" };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
      this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    }

    async setRemoteDescription(description) {
      this.remoteDescriptionStarted?.resolve();
      if (this.remoteDescriptionGate) await this.remoteDescriptionGate;
      if (this.closed) {
        this.remoteDescriptionRejections += 1;
        throw new Error("peer was closed");
      }
      this.remoteDescription = description;
      this.signalingState = "stable";
    }

    async addIceCandidate(candidate) {
      if (this.addIceCandidateGate) await this.addIceCandidateGate;
      if (this.closed) throw new Error("peer was closed");
      this.addedIce.push(candidate);
    }

    restartIce() {}

    close() {
      this.closed = true;
      this.connectionState = "closed";
      this.iceConnectionState = "closed";
    }
  }

  const sessionStorage = createStorage();
  const localStorage = createStorage();
  const window = {
    ...timerHarness,
    sessionStorage,
    localStorage,
    HariaiOnline: {
      getP2pIceConfiguration: async () => ({
        iceServers: [{ urls: "turn:example.invalid" }],
      }),
    },
    addEventListener() {},
    dispatchEvent() {},
  };
  const document = {
    visibilityState: "visible",
    querySelector: () => null,
    addEventListener() {},
  };
  const noop = () => {};
  const asyncNoop = async () => {};
  const context = vm.createContext({
    console: {
      log: noop,
      warn: noop,
      error: noop,
    },
    window,
    document,
    location: { search: "", origin: "https://example.invalid" },
    navigator: {},
    Event: class {},
    URL,
    URLSearchParams,
    Blob,
    Map,
    Set,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    Date,
    JSON,
    RegExp,
    Error,
    TypeError,
    queueMicrotask,
    setImmediate,
    RTCPeerConnection: MockPeerConnection,
    browserLocalPersistence: {},
    setPersistence: asyncNoop,
    signInAnonymously: async () => ({ user: { uid: "mock-user" } }),
    get: async () => ({ exists: () => false, val: () => null }),
    limitToLast: (value) => value,
    onChildAdded: () => noop,
    onChildChanged: () => noop,
    onChildRemoved: () => noop,
    onDisconnect: () => ({ remove: asyncNoop, cancel: asyncNoop }),
    onValue: () => noop,
    orderByChild: (value) => value,
    query: (value) => value,
    ref: (_database, value) => ({ path: value }),
    remove: asyncNoop,
    serverTimestamp: () => Date.now(),
    set: asyncNoop,
    httpsCallable: (_functions, name) => async (payload) => {
      callableCalls.push({ name, payload });
      return { data: { ok: true } };
    },
    auth: {},
    database: {},
    functions: {},
    FREE_TABLE_AUDIO_MAX_SECONDS: 10,
    FREE_TABLE_IMAGE_MAX_SIDE: 2_048,
    FREE_TABLE_MEDIA_CHANNEL_LABEL: "hariai-free-table-media-v1",
    FREE_TABLE_VIDEO_MAX_BYTES: 8 * 1024 * 1024,
    FREE_TABLE_VIDEO_MAX_SECONDS: 15,
    appendIncomingFreeTableMediaChunk: asyncNoop,
    createFreeTableMediaTransferId: () => {
      transferSequence += 1;
      return `ft_${transferSequence.toString(16).padStart(24, "0")}`;
    },
    createIncomingFreeTableMediaTransfer: () => ({}),
    createLocalFreeTableMediaResource: async () => ({}),
    finishIncomingFreeTableMediaTransfer: async () => null,
    freeTableMediaEndStatus: () => "orphan",
    isFreeTableMediaCancelFor: () => false,
    releaseFreeTableMediaResource: noop,
    releaseFreeTableMediaResources: noop,
    sendFreeTableMedia: asyncNoop,
    createFreeTableAmbienceController: () => ({
      destroy: noop,
      getState: () => ({ enabled: false }),
      setVolume: noop,
    }),
  });
  window.window = window;

  const executableSource = frontendSource.replace(
    /^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";\s*/gm,
    "",
  );
  const hookSource = `
    globalThis.__freeTableP2pTest = {
      getState: () => state,
      setActive: (value) => { active = Boolean(value); },
      queueDeferredSignal,
      drainDeferredSignals,
      flushPendingIce,
      configureMediaDataChannel,
      resetPeerTransport,
      schedulePeerRecovery,
      armSessionExpiryTimer,
    };
  `;
  new vm.Script(`${executableSource}\n${hookSource}`, {
    filename: "free-table.js",
  }).runInContext(context);

  return {
    hooks: context.__freeTableP2pTest,
    callableCalls,
    peerInstances,
    timers: timerHarness,
    MockPeerConnection,
  };
}

function signalSnapshot(slot, value, counter = null) {
  return {
    key: `${"S".repeat(22)}${String(slot).padStart(2, "0")}`,
    val() {
      if (counter) counter.count += 1;
      return value;
    },
  };
}

function validSignal({
  type,
  fromUid = "visitor_uid",
  toUid = "host_uid",
  negotiationId,
  payload,
  createdAt = Date.now(),
}) {
  return {
    fromUid,
    toUid,
    type,
    payload: JSON.stringify({
      protocolVersion: 1,
      negotiationId,
      ...(type === "candidate" ? { candidate: payload } : { description: payload }),
    }),
    createdAt,
    expiresAt: createdAt + 90_000,
  };
}

async function settleMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("forced peer recovery releases an old signal drain and the replacement peer drains queued signals", async () => {
  const {
    hooks,
    peerInstances,
    timers,
    MockPeerConnection,
  } = createFrontendHarness();
  const state = hooks.getState();
  const oldNegotiationId = "neg_111111111111111111111111";
  const oldPeer = new MockPeerConnection();
  const remoteStarted = createDeferred();
  const remoteGate = createDeferred();
  oldPeer.remoteDescriptionStarted = remoteStarted;
  oldPeer.remoteDescriptionGate = remoteGate.promise;
  oldPeer.signalingState = "have-local-offer";
  const oldSignalReads = { count: 0 };

  hooks.setActive(true);
  Object.assign(state, {
    sessionId: "session_123",
    sessionGeneration: 4,
    session: { status: "active", ending: {} },
    uid: "host_uid",
    opponentUid: "visitor_uid",
    role: "host",
    peer: oldPeer,
    peerGeneration: 7,
    negotiationId: oldNegotiationId,
    deferredSignals: [
      signalSnapshot(1, validSignal({
        type: "answer",
        negotiationId: oldNegotiationId,
        payload: { type: "answer", sdp: "old-answer" },
      }), oldSignalReads),
    ],
  });

  const oldDrain = hooks.drainDeferredSignals();
  await remoteStarted.promise;
  assert.equal(state.signalDraining, true);

  hooks.queueDeferredSignal(signalSnapshot(2, {
    fromUid: "visitor_uid",
    toUid: "host_uid",
    type: "invalid",
    payload: "{}",
    createdAt: Date.now() + 1,
    expiresAt: Date.now() + 90_001,
  }));
  hooks.schedulePeerRecovery(oldPeer, {
    sessionId: state.sessionId,
    peerGeneration: state.peerGeneration,
    immediate: true,
    force: true,
  });
  const recoveryTimer = state.peerRecoveryTimer;
  await timers.run(recoveryTimer);

  assert.notEqual(state.peer, oldPeer);
  assert.equal(peerInstances.length, 2);
  assert.equal(state.deferredSignals.length, 0);
  assert.equal(state.signalDraining, false);
  assert.equal(state.signalDrainOwner, null);

  remoteGate.resolve();
  await oldDrain;
  await settleMicrotasks();

  assert.equal(
    oldPeer.remoteDescriptionRejections,
    1,
    "a signal rejected by the closed old peer follows the stale-context retry path",
  );
  assert.equal(oldSignalReads.count, 2, "the interrupted signal is retried on the replacement peer");
  assert.equal(state.deferredSignals.length, 0);
  assert.equal(state.signalDraining, false);
  assert.equal(state.signalDrainOwner, null);
});

test("pending ICE is replayed on the replacement peer when context changes during await", async () => {
  const {
    hooks,
    MockPeerConnection,
  } = createFrontendHarness();
  const state = hooks.getState();
  const negotiationId = "neg_222222222222222222222222";
  const oldPeer = new MockPeerConnection();
  const firstCandidateGate = createDeferred();
  oldPeer.addIceCandidateGate = firstCandidateGate.promise;
  oldPeer.remoteDescription = { type: "offer", sdp: "remote-offer" };
  const first = { negotiationId, candidate: { candidate: "candidate:first" }, createdAt: 1 };
  const second = { negotiationId, candidate: { candidate: "candidate:second" }, createdAt: 2 };

  hooks.setActive(true);
  Object.assign(state, {
    sessionId: "session_ice",
    sessionGeneration: 8,
    session: { status: "active", ending: {} },
    uid: "visitor_uid",
    opponentUid: "host_uid",
    role: "visitor",
    peer: oldPeer,
    peerGeneration: 11,
    negotiationId,
    pendingIce: [first, second],
  });

  const flush = hooks.flushPendingIce(oldPeer, state.sessionId, negotiationId, state.peerGeneration);
  await settleMicrotasks();
  hooks.resetPeerTransport({
    preserveDeferredSignals: true,
    preserveRecoveryAttempts: true,
    preservePendingIce: true,
  });
  firstCandidateGate.resolve();
  await flush;

  assert.deepEqual(
    Array.from(state.pendingIce, (entry) => entry.candidate.candidate),
    ["candidate:first", "candidate:second"],
  );

  const replacementPeer = new MockPeerConnection();
  replacementPeer.remoteDescription = { type: "offer", sdp: "replacement-offer" };
  state.peer = replacementPeer;
  state.peerGeneration += 1;
  state.negotiationId = negotiationId;
  await hooks.flushPendingIce(
    replacementPeer,
    state.sessionId,
    negotiationId,
    state.peerGeneration,
  );
  assert.deepEqual(
    Array.from(replacementPeer.addedIce, (candidate) => candidate.candidate),
    ["candidate:first", "candidate:second"],
  );
  assert.equal(state.pendingIce.length, 0);
});

test("stale recovery timers cannot clear a newer timer and an already-open channel clears recovery state", async () => {
  const {
    hooks,
    callableCalls,
    timers,
    MockPeerConnection,
  } = createFrontendHarness();
  const state = hooks.getState();
  const peer = new MockPeerConnection();
  hooks.setActive(true);
  Object.assign(state, {
    sessionId: "session_timer",
    sessionGeneration: 12,
    session: { status: "active", ending: {} },
    uid: "host_uid",
    opponentUid: "visitor_uid",
    role: "host",
    peer,
    peerGeneration: 13,
  });

  hooks.schedulePeerRecovery(peer, {
    sessionId: state.sessionId,
    peerGeneration: state.peerGeneration,
    force: false,
  });
  const staleTimerId = state.peerRecoveryTimer;
  const staleCallback = timers.timers.get(staleTimerId).callback;
  hooks.schedulePeerRecovery(peer, {
    sessionId: state.sessionId,
    peerGeneration: state.peerGeneration,
    immediate: true,
    force: true,
  });
  const currentTimerId = state.peerRecoveryTimer;
  assert.notEqual(currentTimerId, staleTimerId);

  await staleCallback();
  assert.equal(state.peerRecoveryTimer, currentTimerId);
  assert.equal(state.peerRecoveryForced, true);

  state.arrived = false;
  state.peerRecoveryAttempts = 3;
  const openChannel = createChannel("hariai-free-table-media-v1", "open");
  hooks.configureMediaDataChannel(openChannel, {
    sessionId: state.sessionId,
    sessionGeneration: state.sessionGeneration,
    peer,
    peerGeneration: state.peerGeneration,
  });

  assert.equal(state.mediaReady, true);
  assert.equal(state.peerRecoveryTimer, null);
  assert.equal(state.peerRecoveryForced, false);
  assert.equal(state.peerRecoveryAttempts, 0);
  await settleMicrotasks();
  assert.equal(
    callableCalls.filter((call) => (
      call.name === "freeTableAction" && call.payload?.action === "arrive"
    )).length,
    1,
  );
  const diagnostics = callableCalls.filter((call) => (
    call.name === "reportFreeTableP2pConnectivity"
  ));
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(
    Object.keys(diagnostics[0].payload).sort(),
    ["diagnostic", "sessionId"],
  );
  assert.equal(diagnostics[0].payload.sessionId, state.sessionId);
  assert.deepEqual(
    Object.keys(diagnostics[0].payload.diagnostic).sort(),
    [
      "attempt",
      "candidateType",
      "connectionState",
      "elapsedMs",
      "event",
      "iceConnectionState",
      "iceGatheringState",
      "phase",
      "transport",
      "turnAvailable",
    ],
  );
  assert.equal(diagnostics[0].payload.diagnostic.event, "channel_open");
  assert.equal(diagnostics[0].payload.diagnostic.phase, "free_table");
  for (const forbidden of ["uid", "roomId", "userAgent", "sdp", "candidate", "ip"]) {
    assert.equal(Object.hasOwn(diagnostics[0].payload.diagnostic, forbidden), false);
  }
});

test("stale session-expiry callbacks cannot replace the current session timer", async () => {
  const {
    hooks,
    timers,
  } = createFrontendHarness();
  const state = hooks.getState();
  const expiresAt = Date.now() + 60_000;
  hooks.setActive(true);
  Object.assign(state, {
    sessionId: "session_expiry",
    sessionGeneration: 15,
    session: { status: "active", ending: {}, expiresAt },
  });

  hooks.armSessionExpiryTimer(state.sessionId, state.sessionGeneration, expiresAt);
  const staleTimerId = state.sessionExpiryTimer;
  const staleCallback = timers.timers.get(staleTimerId).callback;
  hooks.armSessionExpiryTimer(state.sessionId, state.sessionGeneration, expiresAt);
  const currentTimerId = state.sessionExpiryTimer;
  assert.notEqual(currentTimerId, staleTimerId);

  await staleCallback();
  assert.equal(state.sessionExpiryTimer, currentTimerId);
});
