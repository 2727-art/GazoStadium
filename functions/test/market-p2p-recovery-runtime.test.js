"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const marketSource = fs.readFileSync(path.join(root, "market.js"), "utf8");

function extractFunction(name) {
  const match = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(marketSource);
  assert.ok(match, `market.js must define ${name}`);
  const start = match.index;
  const openingParenthesis = start + match[0].length - 1;
  let parenthesisDepth = 0;
  let closingParenthesis = -1;
  for (let index = openingParenthesis; index < marketSource.length; index += 1) {
    if (marketSource[index] === "(") parenthesisDepth += 1;
    if (marketSource[index] === ")") {
      parenthesisDepth -= 1;
      if (parenthesisDepth === 0) {
        closingParenthesis = index;
        break;
      }
    }
  }
  const openingBrace = marketSource.indexOf("{", closingParenthesis + 1);
  let depth = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBrace; index < marketSource.length; index += 1) {
    const character = marketSource[index];
    const next = marketSource[index + 1];
    const previous = marketSource[index - 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote && previous !== "\\") quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return marketSource.slice(start, index + 1);
    }
  }
  assert.fail(`could not extract ${name}`);
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("a disconnected peer is replaced even while its stale data channel still says open", async () => {
  const timers = new Map();
  let nextTimer = 1;
  let textUnsubscribed = 0;
  let signalUnsubscribed = 0;
  const setupCalls = [];
  const oldPeer = {
    connectionState: "disconnected",
    iceConnectionState: "disconnected",
    close() {
      this.closed = true;
    },
  };
  const oldChannel = {
    readyState: "open",
    close() {
      this.readyState = "closed";
    },
  };
  const processedCandidate = {
    connectionId: "connection-A",
    candidate: { candidate: "candidate:processed" },
  };
  const state = {
    roomId: "room-one",
    room: { status: "negotiating" },
    peer: oldPeer,
    peerGeneration: 4,
    peerTimeout: null,
    peerRecoveryTimer: null,
    peerRecoveryForced: false,
    peerRecoveryAttempts: 0,
    peerConnectionId: "connection-A",
    peerSignalChain: Promise.resolve(),
    peerSignalUnsubscribe: () => {
      signalUnsubscribed += 1;
    },
    channel: oldChannel,
    channelReady: true,
    peerWasConnected: true,
    peerStatus: "",
    incomingTransfer: { received: 1, size: 2 },
    outgoingTransfer: Promise.resolve(),
    pendingIce: [],
    peerIceCandidates: [processedCandidate],
    realtimeRoomId: "room-one",
    realtimeUnsubscribers: [() => {
      textUnsubscribed += 1;
    }],
  };
  const factory = new Function("deps", `
    const {
      window, TERMINAL_STATES, render, reportMarketP2pDiagnostic,
      setupRealtimeRoom, setupPeerConnection,
    } = deps;
    const MARKET_P2P_DISCONNECT_GRACE_MS = 8_000;
    const MARKET_P2P_MAX_RECOVERY_ATTEMPTS = 3;
    const MARKET_P2P_RECOVERY_SETUP_TIMEOUT_MS = 20_000;
    const MARKET_MAX_PENDING_ICE_CANDIDATES = 128;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.state;
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("clearMarketPeerRecoveryTimer")}
    ${extractFunction("marketPeerNeedsRecovery")}
    ${extractFunction("abortMarketIncomingTransfer")}
    ${extractFunction("settleMarketPeerCapabilityWaiters")}
    ${extractFunction("rejectMarketAssetAckWaiters")}
    ${extractFunction("resetMarketPeerDeliveryProtocol")}
    ${extractFunction("marketIceCandidateKey")}
    ${extractFunction("mergeMarketIceCandidateEntries")}
    ${extractFunction("resetMarketPeerTransport")}
    ${extractFunction("scheduleMarketPeerRecovery")}
    return { scheduleMarketPeerRecovery };
  `);
  const runtime = factory({
    state,
    window: {
      setTimeout(callback, delay) {
        const id = nextTimer++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    TERMINAL_STATES: new Set(["sold", "ended", "canceled"]),
    render: () => {},
    reportMarketP2pDiagnostic: () => {},
    setupRealtimeRoom: async () => setupCalls.push("realtime"),
    setupPeerConnection: async () => setupCalls.push("peer"),
  });

  runtime.scheduleMarketPeerRecovery(oldPeer, 1, "room-one");
  const recoveryTimer = state.peerRecoveryTimer;
  assert.equal(timers.get(recoveryTimer).delay, 8_000);
  timers.get(recoveryTimer).callback();
  await settle();
  await settle();

  assert.equal(state.peerRecoveryAttempts, 1);
  assert.equal(oldPeer.closed, true);
  assert.equal(oldChannel.readyState, "closed");
  assert.equal(state.peer, null);
  assert.equal(state.channel, null);
  assert.equal(state.incomingTransfer, null);
  assert.deepEqual(state.pendingIce, [processedCandidate]);
  assert.equal(signalUnsubscribed, 1);
  assert.equal(textUnsubscribed, 0);
  assert.deepEqual(setupCalls, ["realtime", "peer"]);
});

function createChannelRuntime(state, diagnostics) {
  const factory = new Function("deps", `
    const {
      window, roomRole, sendListingImage, handleRecoverableError,
      reportMarketP2pDiagnostic, render, scheduleMarketPeerRecovery, showToast,
    } = deps;
    const DATA_BUFFER_LIMIT = 512 * 1024;
    const MARKET_OSHIJO_DELIVERY_PROTOCOL_VERSION = 1;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.state;
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("isCurrentMarketPeer")}
    ${extractFunction("marketPeerNeedsRecovery")}
    ${extractFunction("marketSignalConnectionMatches")}
    ${extractFunction("abortMarketIncomingTransfer")}
    ${extractFunction("settleMarketPeerCapabilityWaiters")}
    ${extractFunction("rejectMarketAssetAckWaiters")}
    ${extractFunction("resetMarketPeerDeliveryProtocol")}
    ${extractFunction("clearMarketPeerRecoveryTimer")}
    ${extractFunction("marketDataChannelContextIsCurrent")}
    ${extractFunction("marketPeerCapabilityContextMatches")}
    ${extractFunction("advertiseMarketPeerCapabilities")}
    ${extractFunction("markMarketDataChannelReady")}
    ${extractFunction("configureDataChannel")}
    return { configureDataChannel };
  `);
  return factory({
    state,
    window: { clearTimeout: () => {} },
    roomRole: () => "buyer",
    sendListingImage: async () => {},
    handleRecoverableError: () => {},
    reportMarketP2pDiagnostic: (event) => diagnostics.push(event),
    render: () => {},
    scheduleMarketPeerRecovery: () => {},
    showToast: () => {},
  });
}

test("an already-open replacement channel uses the shared ready path exactly once", () => {
  const diagnostics = [];
  const peer = { connectionState: "connected", iceConnectionState: "connected" };
  const state = {
    roomId: "room-one",
    room: { buyerUid: "buyer-1" },
    peer,
    peerGeneration: 5,
    peerConnectionId: "connection-B",
    peerTimeout: 11,
    peerRecoveryTimer: 12,
    peerRecoveryForced: true,
    peerRecoveryAttempts: 2,
    peerWasConnected: false,
    channel: null,
    channelReady: false,
    incomingTransfer: null,
    outgoingTransfer: Promise.resolve(),
  };
  const runtime = createChannelRuntime(state, diagnostics);
  const channel = {
    readyState: "open",
    close() {
      this.readyState = "closed";
    },
  };

  runtime.configureDataChannel(channel, 1, "room-one", "connection-B", peer, 5);
  channel.onopen();

  assert.equal(state.channelReady, true);
  assert.equal(state.peerRecoveryAttempts, 0);
  assert.equal(state.peerRecoveryTimer, null);
  assert.equal(state.peerTimeout, null);
  assert.deepEqual(diagnostics, ["channel_open"]);
});

function createSignalRuntime(state, hooks = {}) {
  const factory = new Function("deps", `
    const {
      window, sendSignal, scheduleMarketPeerConnectTimeout, clearMarketPeerRecoveryTimer,
    } = deps;
    const MARKET_MAX_PENDING_ICE_CANDIDATES = 128;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.state;
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("isCurrentMarketPeer")}
    ${extractFunction("marketSignalConnectionId")}
    ${extractFunction("marketSignalConnectionMatches")}
    ${extractFunction("canSupersedeMarketOffer")}
    ${extractFunction("abortMarketIncomingTransfer")}
    ${extractFunction("settleMarketPeerCapabilityWaiters")}
    ${extractFunction("rejectMarketAssetAckWaiters")}
    ${extractFunction("resetMarketPeerDeliveryProtocol")}
    ${extractFunction("marketIceCandidateKey")}
    ${extractFunction("mergeMarketIceCandidateEntries")}
    ${extractFunction("rememberMarketIceCandidate")}
    ${extractFunction("bufferMarketIceCandidate")}
    ${extractFunction("addMarketIceCandidate")}
    ${extractFunction("flushPendingIce")}
    ${extractFunction("handleSignal")}
    return { handleSignal, flushPendingIce };
  `);
  return factory({
    state,
    window: { clearTimeout: () => {} },
    sendSignal: hooks.sendSignal || (async () => {}),
    scheduleMarketPeerConnectTimeout: hooks.scheduleMarketPeerConnectTimeout || (() => {}),
    clearMarketPeerRecoveryTimer: hooks.clearMarketPeerRecoveryTimer || (() => {}),
  });
}

function offerSignal(connectionId, sdp = "offer") {
  return {
    fromUid: "seller-1",
    type: "offer",
    payload: JSON.stringify({ type: "offer", sdp }),
    connectionId,
    createdAt: Date.now(),
  };
}

test("a superseding or legacy Safari offer detaches channel A before SDP can expose channel B", async () => {
  for (const connectionId of ["connection-B", undefined]) {
    let oldCloseCount = 0;
    let remoteSawDetached = false;
    const oldChannel = {
      readyState: "open",
      close() {
        oldCloseCount += 1;
        this.readyState = "closed";
      },
    };
    const peer = {
      connectionState: "connected",
      signalingState: "stable",
      remoteDescription: null,
      async setRemoteDescription(description) {
        remoteSawDetached = state.channel === null && oldChannel.readyState === "closed";
        this.remoteDescription = description;
      },
      async createAnswer() {
        return { type: "answer", sdp: "answer" };
      },
      async setLocalDescription() {},
      async addIceCandidate() {},
    };
    const state = {
      uid: "buyer-1",
      roomId: "room-one",
      room: { sellerUid: "seller-1", buyerUid: "buyer-1" },
      peer,
      peerGeneration: 6,
      peerConnectionId: "connection-A",
      peerRecoveryTimer: null,
      channel: oldChannel,
      channelReady: false,
      incomingTransfer: { received: 1, size: 2 },
      outgoingTransfer: Promise.resolve(),
      pendingIce: [],
      peerIceCandidates: [],
    };
    const sent = [];
    const runtime = createSignalRuntime(state, {
      sendSignal: async (...args) => sent.push(args),
    });

    const consumed = await runtime.handleSignal(
      offerSignal(connectionId),
      "seller-1",
      peer,
      "room-one",
      1,
      Date.now() - 1_000,
      6,
    );

    assert.equal(consumed, true);
    assert.equal(remoteSawDetached, true);
    assert.equal(oldCloseCount, 1);
    assert.equal(state.channel, null);
    assert.equal(state.incomingTransfer, null);
    assert.equal(
      state.peerConnectionId,
      connectionId || "connection-A",
      "ID-less legacy offers remain compatible without losing the active epoch",
    );
    assert.equal(sent.length, 1);
  }
});

test("an old asynchronous SDP result cannot mutate the replacement peer generation", async () => {
  const remoteStarted = deferred();
  const remoteGate = deferred();
  let answerCount = 0;
  const oldPeer = {
    connectionState: "connected",
    signalingState: "have-local-offer",
    remoteDescription: null,
    closed: false,
    async setRemoteDescription(description) {
      remoteStarted.resolve();
      await remoteGate.promise;
      if (this.closed) throw new Error("old peer closed");
      this.remoteDescription = description;
    },
    async createAnswer() {
      answerCount += 1;
      return { type: "answer", sdp: "should-not-exist" };
    },
    async setLocalDescription() {},
    async addIceCandidate() {},
  };
  const state = {
    uid: "seller-1",
    roomId: "room-one",
    room: { sellerUid: "seller-1", buyerUid: "buyer-1" },
    peer: oldPeer,
    peerGeneration: 2,
    peerConnectionId: "connection-A",
    peerRecoveryTimer: null,
    channel: null,
    channelReady: false,
    incomingTransfer: null,
    outgoingTransfer: Promise.resolve(),
    pendingIce: [],
    peerIceCandidates: [],
  };
  const sent = [];
  const runtime = createSignalRuntime(state, {
    sendSignal: async (...args) => sent.push(args),
  });
  const handling = runtime.handleSignal(
    {
      fromUid: "buyer-1",
      type: "answer",
      payload: JSON.stringify({ type: "answer", sdp: "old-answer" }),
      connectionId: "connection-A",
      createdAt: Date.now(),
    },
    "buyer-1",
    oldPeer,
    "room-one",
    1,
    Date.now() - 1_000,
    2,
  );
  await remoteStarted.promise;

  const replacementPeer = {
    connectionState: "connected",
    signalingState: "stable",
    remoteDescription: {},
    async addIceCandidate() {},
  };
  const replacementChannel = { readyState: "open" };
  oldPeer.closed = true;
  state.peer = replacementPeer;
  state.peerGeneration = 3;
  state.peerConnectionId = "connection-B";
  state.channel = replacementChannel;
  state.channelReady = true;
  remoteGate.resolve();

  await assert.rejects(handling, /old peer closed/);
  assert.equal(state.peer, replacementPeer);
  assert.equal(state.channel, replacementChannel);
  assert.equal(state.peerConnectionId, "connection-B");
  assert.equal(answerCount, 0);
  assert.deepEqual(sent, []);
});

test("ICE shifted by an old peer is restored and replayed once by its replacement", async () => {
  const firstCandidateStarted = deferred();
  const firstCandidateGate = deferred();
  const first = { connectionId: "connection-A", candidate: { candidate: "candidate:first" } };
  const second = { connectionId: "connection-A", candidate: { candidate: "candidate:second" } };
  const oldPeer = {
    remoteDescription: {},
    added: [],
    async addIceCandidate(candidate) {
      this.added.push(candidate.candidate);
      if (candidate.candidate === "candidate:first") {
        firstCandidateStarted.resolve();
        await firstCandidateGate.promise;
      }
    },
  };
  const state = {
    uid: "buyer-1",
    roomId: "room-one",
    room: { sellerUid: "seller-1", buyerUid: "buyer-1" },
    peer: oldPeer,
    peerGeneration: 1,
    peerConnectionId: "connection-A",
    pendingIce: [first, second],
    peerIceCandidates: [first, second],
  };
  const runtime = createSignalRuntime(state);
  const oldFlush = runtime.flushPendingIce(oldPeer, "room-one", 1, 1);
  await firstCandidateStarted.promise;

  const replacementPeer = {
    remoteDescription: {},
    added: [],
    async addIceCandidate(candidate) {
      this.added.push(candidate.candidate);
    },
  };
  state.peer = replacementPeer;
  state.peerGeneration = 2;
  firstCandidateGate.resolve();
  await oldFlush;

  assert.deepEqual(
    state.pendingIce.map((entry) => entry.candidate.candidate),
    ["candidate:first", "candidate:second"],
  );
  await runtime.flushPendingIce(replacementPeer, "room-one", 1, 2);
  assert.deepEqual(replacementPeer.added, ["candidate:first", "candidate:second"]);
  assert.deepEqual(state.pendingIce, []);
});

test("a delayed setup timeout from attempt A cannot restart an already-open attempt B", async () => {
  const timers = new Map();
  let nextTimer = 1;
  const never = new Promise(() => {});
  const oldPeer = {
    connectionState: "failed",
    iceConnectionState: "failed",
    close() {
      this.closed = true;
    },
  };
  const state = {
    roomId: "room-one",
    room: { status: "negotiating", buyerUid: "buyer-1" },
    peer: oldPeer,
    peerGeneration: 1,
    peerTimeout: null,
    peerRecoveryTimer: null,
    peerRecoveryForced: false,
    peerRecoverySetupOwner: null,
    peerRecoveryAttempts: 0,
    peerConnectionId: "connection-A",
    peerSignalChain: Promise.resolve(),
    peerSignalUnsubscribe: null,
    channel: null,
    channelReady: false,
    incomingTransfer: null,
    outgoingTransfer: Promise.resolve(),
    pendingIce: [],
    peerIceCandidates: [],
  };
  const factory = new Function("deps", `
    const {
      window, TERMINAL_STATES, render, reportMarketP2pDiagnostic,
      setupRealtimeRoom, setupPeerConnection,
    } = deps;
    const MARKET_P2P_DISCONNECT_GRACE_MS = 8_000;
    const MARKET_P2P_MAX_RECOVERY_ATTEMPTS = 3;
    const MARKET_P2P_RECOVERY_SETUP_TIMEOUT_MS = 20_000;
    const MARKET_MAX_PENDING_ICE_CANDIDATES = 128;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.state;
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("clearMarketPeerRecoveryTimer")}
    ${extractFunction("marketPeerNeedsRecovery")}
    ${extractFunction("abortMarketIncomingTransfer")}
    ${extractFunction("settleMarketPeerCapabilityWaiters")}
    ${extractFunction("rejectMarketAssetAckWaiters")}
    ${extractFunction("resetMarketPeerDeliveryProtocol")}
    ${extractFunction("marketIceCandidateKey")}
    ${extractFunction("mergeMarketIceCandidateEntries")}
    ${extractFunction("resetMarketPeerTransport")}
    ${extractFunction("scheduleMarketPeerRecovery")}
    return { scheduleMarketPeerRecovery };
  `);
  const runtime = factory({
    state,
    window: {
      setTimeout(callback, delay) {
        const id = nextTimer++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    TERMINAL_STATES: new Set(["sold", "ended", "canceled"]),
    render: () => {},
    reportMarketP2pDiagnostic: () => {},
    setupRealtimeRoom: async () => {},
    setupPeerConnection: async () => never,
  });

  runtime.scheduleMarketPeerRecovery(oldPeer, 1, "room-one", {
    immediate: true,
    force: true,
  });
  const recoveryTimer = state.peerRecoveryTimer;
  timers.get(recoveryTimer).callback();
  await settle();
  const setupTimeout = Array.from(timers.entries())
    .find(([, timer]) => timer.delay === 20_000);
  assert.ok(setupTimeout, "attempt A must have a bounded setup timer");

  let healthyCloseCount = 0;
  const healthyPeer = {
    connectionState: "connected",
    iceConnectionState: "connected",
    close() {
      healthyCloseCount += 1;
    },
  };
  state.peer = healthyPeer;
  state.peerGeneration += 1;
  state.peerConnectionId = "connection-B";
  state.channel = { readyState: "open" };
  state.channelReady = true;
  state.peerRecoveryAttempts = 0;
  state.peerRecoverySetupOwner = null;
  setupTimeout[1].callback();
  await settle();
  await settle();

  assert.equal(state.peer, healthyPeer);
  assert.equal(state.channelReady, true);
  assert.equal(state.peerRecoveryTimer, null);
  assert.equal(healthyCloseCount, 0);
});
