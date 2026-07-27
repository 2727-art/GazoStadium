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
  assert.ok(closingParenthesis >= 0, `${name} must have a complete parameter list`);
  const openingBrace = marketSource.indexOf("{", closingParenthesis + 1);
  assert.ok(openingBrace >= 0, `${name} must have a function body`);

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

function replayState(overrides = {}) {
  return {
    uid: "buyer-1",
    role: "buyer",
    name: "BUYER",
    balance: 500,
    patron: null,
    patronFund: null,
    patronImpact: null,
    patronEligibility: null,
    recommendations: [],
    recommendedShelf: [],
    marketPolicy: {},
    image: null,
    listingTitle: "",
    askingPrice: 50,
    pitchStyle: "either",
    maxBudget: 100,
    shop: {},
    shopCatalog: {},
    shopReport: {},
    ownedTitleIds: [],
    ownedShopCharmIds: [],
    favorites: [],
    shopStatus: "ready",
    shopErrorMessage: "",
    shopSalesModeContractReady: true,
    matchMode: "discover",
    selectedFavoriteSellerId: "",
    roomId: "room-one",
    activeUnsubscribe: null,
    activeSnapshotRetry: null,
    walletUnsubscribe: null,
    walletSnapshotRetry: null,
    ...overrides,
  };
}

function createReplayHarness() {
  let timerSequence = 0;
  const timers = [];
  const listeners = [];
  const enterRoomCalls = [];
  const walletUpdates = [];
  const fakeWindow = {
    setTimeout(callback) {
      const timer = { id: ++timerSequence, callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
  const onSnapshot = (reference, next, error) => {
    const listener = {
      reference,
      next,
      error,
      unsubscribeCalls: 0,
    };
    listener.unsubscribe = () => {
      listener.unsubscribeCalls += 1;
    };
    listeners.push(listener);
    return listener.unsubscribe;
  };

  const factory = new Function("deps", `
    const {
      window, onSnapshot, doc, firestore, enterRoom, handleFatalError,
      updateMarketBalance, render, createState, preferredRecommendedShop,
      matchableMarketFavorite, cleanupRoom, normalizeBuyerBudget, auth,
      setMarketChrome, loadMarketShop,
    } = deps;
    const useMarketPreview = false;
    let active = true;
    let lifecycleGeneration = 0;
    let lastRenderedScreen = "";
    let state = deps.initialState;
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("subscribeToActiveRoom")}
    ${extractFunction("subscribeToWallet")}
    ${extractFunction("resetForReplay")}
    return {
      subscribeToActiveRoom,
      subscribeToWallet,
      resetForReplay,
      getState: () => state,
      getGeneration: () => lifecycleGeneration,
    };
  `);

  const runtime = factory({
    window: fakeWindow,
    onSnapshot,
    doc: (_firestore, collection, uid) => `${collection}/${uid}`,
    firestore: {},
    enterRoom: async (roomId, generation) => {
      enterRoomCalls.push({ roomId, generation });
    },
    handleFatalError: (error) => {
      throw error;
    },
    updateMarketBalance: (balance) => {
      walletUpdates.push(balance);
    },
    render: () => {},
    createState: () => replayState({
      uid: "",
      roomId: "",
      activeUnsubscribe: null,
      activeSnapshotRetry: null,
      walletUnsubscribe: null,
      walletSnapshotRetry: null,
    }),
    preferredRecommendedShop: () => null,
    matchableMarketFavorite: () => null,
    cleanupRoom: () => {},
    normalizeBuyerBudget: () => {},
    auth: { currentUser: { uid: "buyer-1" } },
    setMarketChrome: () => {},
    loadMarketShop: () => {},
    initialState: replayState(),
  });

  return { runtime, timers, listeners, enterRoomCalls, walletUpdates };
}

test("replay fences stale active and wallet retries and enters the second room", async () => {
  const {
    runtime,
    timers,
    listeners,
    enterRoomCalls,
    walletUpdates,
  } = createReplayHarness();
  runtime.subscribeToActiveRoom(0);
  runtime.subscribeToWallet(0);

  const oldActive = listeners.find(({ reference }) => reference === "valueMarketActive/buyer-1");
  const oldWallet = listeners.find(({ reference }) => reference === "wallets/buyer-1");
  oldActive.error(new Error("transient active listener failure"));
  oldWallet.error(new Error("transient wallet listener failure"));

  const oldActiveRetry = runtime.getState().activeSnapshotRetry;
  const oldWalletRetry = runtime.getState().walletSnapshotRetry;
  assert.ok(oldActiveRetry);
  assert.ok(oldWalletRetry);

  oldActiveRetry.callback();
  oldWalletRetry.callback();
  const retriedActive = listeners.filter(
    ({ reference }) => reference === "valueMarketActive/buyer-1",
  ).at(-1);
  const retriedWallet = listeners.filter(({ reference }) => reference === "wallets/buyer-1").at(-1);

  oldActive.next({
    exists: () => true,
    data: () => ({ roomId: "stale-room" }),
  });
  oldWallet.next({
    exists: () => true,
    data: () => ({ balance: 999_999 }),
  });
  await Promise.resolve();
  assert.deepEqual(enterRoomCalls, []);
  assert.deepEqual(walletUpdates, []);

  retriedActive.error(new Error("second active listener failure"));
  retriedWallet.error(new Error("second wallet listener failure"));
  const replayQueuedActiveRetry = runtime.getState().activeSnapshotRetry;
  const replayQueuedWalletRetry = runtime.getState().walletSnapshotRetry;

  runtime.resetForReplay();
  assert.equal(runtime.getGeneration(), 1);
  assert.equal(replayQueuedActiveRetry.cleared, true);
  assert.equal(replayQueuedWalletRetry.cleared, true);

  const newActive = listeners.filter(
    ({ reference }) => reference === "valueMarketActive/buyer-1",
  ).at(-1);
  const newWallet = listeners.filter(({ reference }) => reference === "wallets/buyer-1").at(-1);
  const listenerCountAfterReplay = listeners.length;

  // A timeout can already be queued when clearTimeout runs. Force both stale
  // callbacks to execute and verify their old generation cannot touch replay state.
  replayQueuedActiveRetry.callback();
  replayQueuedWalletRetry.callback();
  assert.equal(listeners.length, listenerCountAfterReplay);
  assert.equal(newActive.unsubscribeCalls, 0);
  assert.equal(newWallet.unsubscribeCalls, 0);
  assert.equal(runtime.getState().activeUnsubscribe, newActive.unsubscribe);
  assert.equal(runtime.getState().walletUnsubscribe, newWallet.unsubscribe);

  newActive.next({
    exists: () => true,
    data: () => ({ roomId: "room-two" }),
  });
  await Promise.resolve();
  assert.deepEqual(enterRoomCalls, [{ roomId: "room-two", generation: 1 }]);
  assert.equal(timers.length, 4, "replay should not create another retry timer");
});

function roomState(overrides = {}) {
  return {
    roomId: "",
    room: null,
    roomUnsubscribe: null,
    roomSnapshotRetry: null,
    roomSyncRetry: null,
    roomSyncRetryAttempts: 0,
    enteringRoomId: "",
    incomingTransfer: null,
    realtimeRoomId: "",
    oshijoDecisionRequested: false,
    screen: "setup",
    busy: false,
    peerStatus: "",
    certificateStatus: "idle",
    image: null,
    ...overrides,
  };
}

test("queued room listener and sync retries cannot tear down the next room", async () => {
  const listeners = [];
  const timers = [];
  const syncCalls = [];
  let releaseSlowSync;
  const slowSync = new Promise((resolve) => {
    releaseSlowSync = resolve;
  });
  const fakeWindow = {
    HariaiAudio: { playPhase: () => {} },
    setTimeout(callback) {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
  const onSnapshot = (reference, next, error) => {
    const listener = { reference, next, error, unsubscribeCalls: 0 };
    listener.unsubscribe = () => {
      listener.unsubscribeCalls += 1;
    };
    listeners.push(listener);
    return listener.unsubscribe;
  };
  const factory = new Function("deps", `
    const {
      window, onSnapshot, doc, firestore, beginQueueAttempt, stopRoomHeartbeat,
      setMarketChrome, render, normalizeMarketRoom, normalizeOshijoPhase,
      TERMINAL_STATES, refreshMarketAchievementNotifications, roomRole,
      setupPeerConnection, handleFatalError, connectMarketRoomServices,
    } = deps;
    const OSHIJO_CLOSING_IMAGE_PREFIX = "oshijo-closing-image:";
    const OSHIJO_CLOSING_AUDIO_PREFIX = "oshijo-closing-audio:";
    const useMarketPreview = false;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.initialState;
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("clearRoomSyncRetry")}
    ${extractFunction("scheduleRoomSyncRetry")}
    ${extractFunction("enterRoom")}
    return {
      enterRoom,
      scheduleRoomSyncRetry,
      getState: () => state,
      setState: (value) => { state = value; },
      setGeneration: (value) => { lifecycleGeneration = value; },
    };
  `);
  const runtime = factory({
    window: fakeWindow,
    onSnapshot,
    doc: (_firestore, collection, roomId) => `${collection}/${roomId}`,
    firestore: {},
    beginQueueAttempt: () => {},
    stopRoomHeartbeat: () => {},
    setMarketChrome: () => {},
    render: () => {},
    normalizeMarketRoom: (value) => value,
    normalizeOshijoPhase: () => "",
    TERMINAL_STATES: new Set(["sold", "declined", "canceled"]),
    refreshMarketAchievementNotifications: () => {},
    roomRole: () => "buyer",
    setupPeerConnection: async () => {},
    handleFatalError: (error) => {
      throw error;
    },
    connectMarketRoomServices: async (roomId, generation) => {
      syncCalls.push({ roomId, generation });
      if (roomId === "room-five") await slowSync;
    },
    initialState: roomState(),
  });

  await runtime.enterRoom("room-one", 1);
  const oldState = runtime.getState();
  const oldListener = listeners[0];
  oldListener.error(new Error("old room listener failed"));
  const oldSnapshotRetry = oldState.roomSnapshotRetry;
  assert.ok(oldSnapshotRetry);

  const nextState = roomState();
  runtime.setGeneration(2);
  runtime.setState(nextState);
  await runtime.enterRoom("room-two", 2);
  const nextListener = listeners[1];

  oldSnapshotRetry.callback();
  assert.equal(nextListener.unsubscribeCalls, 0);
  assert.equal(nextState.roomUnsubscribe, nextListener.unsubscribe);
  assert.equal(nextState.roomSnapshotRetry, null);

  nextListener.error(new Error("new room listener failed"));
  const nextSnapshotRetry = nextState.roomSnapshotRetry;
  oldSnapshotRetry.callback();
  assert.equal(nextState.roomSnapshotRetry, nextSnapshotRetry);
  assert.equal(listeners.length, 2);

  const oldSyncState = roomState({ roomId: "room-three" });
  runtime.setGeneration(3);
  runtime.setState(oldSyncState);
  runtime.scheduleRoomSyncRetry("room-three", 3);
  const oldSyncRetry = oldSyncState.roomSyncRetry;

  const nextSyncState = roomState({ roomId: "room-four" });
  runtime.setGeneration(4);
  runtime.setState(nextSyncState);
  runtime.scheduleRoomSyncRetry("room-four", 4);
  const nextSyncRetry = nextSyncState.roomSyncRetry;
  const callsBeforeStaleRetry = syncCalls.length;

  oldSyncRetry.callback();
  assert.equal(nextSyncState.roomSyncRetry, nextSyncRetry);
  assert.equal(syncCalls.length, callsBeforeStaleRetry);

  const slowState = roomState();
  runtime.setGeneration(5);
  runtime.setState(slowState);
  const slowEntry = runtime.enterRoom("room-five", 5);
  await Promise.resolve();
  const slowListener = listeners.at(-1);
  slowListener.error(new Error("listener failed while sync callable is pending"));
  const slowSnapshotRetry = slowState.roomSnapshotRetry;
  const listenerCountBeforeRetry = listeners.length;

  slowSnapshotRetry.callback();
  await Promise.resolve();
  assert.equal(
    listeners.length,
    listenerCountBeforeRetry + 1,
    "the retry must resubscribe even while the first sync callable keeps enteringRoomId set",
  );
  assert.equal(listeners.at(-1).reference, "valueMarketRooms/room-five");

  releaseSlowSync();
  await slowEntry;
  await new Promise((resolve) => setImmediate(resolve));
});

test("a pending room-A sync cannot block or mutate an active room-B transition", async () => {
  const listeners = [];
  const syncCalls = [];
  const heartbeatStarts = [];
  const realtimeStarts = [];
  const peerStarts = [];
  let realtimeUnsubscribeCalls = 0;
  let presenceCleanupCalls = 0;
  let oldPeerCloseCalls = 0;
  let oldChannelCloseCalls = 0;
  let resolveRoomA;
  let resolveRoomB;
  const roomAGate = new Promise((resolve) => {
    resolveRoomA = resolve;
  });
  const roomBGate = new Promise((resolve) => {
    resolveRoomB = resolve;
  });
  const marketQueueCallable = async ({ roomId }) => {
    syncCalls.push(roomId);
    if (roomId === "room-A") await roomAGate;
    if (roomId === "room-B") await roomBGate;
    return { data: { status: "active" } };
  };
  const sellerImage = { blob: {}, url: "seller-image-url" };
  const initialState = {
    uid: "seller-1",
    role: "seller",
    roomId: "",
    room: null,
    screen: "setup",
    busy: false,
    errorMessage: "",
    peerStatus: "",
    image: sellerImage,
    imageSent: false,
    queueHeartbeat: null,
    queueHeartbeatPending: false,
    queueAttemptGeneration: 0,
    roomHeartbeat: null,
    roomSyncRetry: null,
    roomSyncPending: false,
    roomSyncWarningShown: false,
    roomSyncRetryAttempts: 0,
    roomSnapshotRetry: null,
    roomUnsubscribe: null,
    realtimeUnsubscribers: [],
    realtimeRoomId: "",
    presenceConnections: [],
    enteringRoomId: "",
    peer: null,
    peerTimeout: null,
    peerRecoveryTimer: null,
    peerRecoveryAttempts: 0,
    peerConnectionId: "",
    peerTurnAvailable: false,
    peerWasConnected: false,
    peerStartedAt: 0,
    peerDiagnosticSent: new Set(),
    peerSignalChain: Promise.resolve(),
    channel: null,
    channelReady: false,
    pendingIce: [],
    outgoingTransfer: Promise.resolve(),
    incomingTransfer: null,
    remoteImage: null,
    audioMessages: [],
    chatMessages: [],
    seenChatIds: new Set(),
    pitchSentTurns: new Set(),
    pendingActionKey: "",
    pendingActionId: "",
    relationshipFeedback: { old: true },
    oshijoClaimOpen: false,
    oshijoClaimDraft: "",
    oshijoAudioMuted: false,
    oshijoClosingImages: [],
    oshijoShareChoice: "",
    oshijoDecisionRequested: false,
    restartGuide: null,
    certificateStatus: "idle",
  };
  const factory = new Function("deps", `
    const {
      window, onSnapshot, doc, firestore, beginQueueAttempt, stopRoomHeartbeat,
      setMarketChrome, render, normalizeMarketRoom, normalizeOshijoPhase,
      TERMINAL_STATES, refreshMarketAchievementNotifications, roomRole,
      handleFatalError, marketQueueCallable, startRoomHeartbeat, showToast,
      callableMessage, scheduleRoomSyncRetry, markPresenceOffline,
      createRelationshipFeedbackState, normalizeMarketRestartGuide,
    } = deps;
    const OSHIJO_CLOSING_IMAGE_PREFIX = "oshijo-closing-image:";
    const OSHIJO_CLOSING_AUDIO_PREFIX = "oshijo-closing-audio:";
    const useMarketPreview = false;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.initialState;
    const setupRealtimeRoom = async (generation, roomId) => {
      deps.realtimeStarts.push({ generation, roomId });
      if (isCurrentLifecycle(generation) && state.roomId === roomId) {
        state.realtimeRoomId = roomId;
      }
    };
    const setupPeerConnection = async (generation, roomId) => {
      deps.peerStarts.push({ generation, roomId });
    };
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("clearRoomSyncRetry")}
    ${extractFunction("clearMarketPeerRecoveryTimer")}
    ${extractFunction("settleMarketPeerCapabilityWaiters")}
    ${extractFunction("rejectMarketAssetAckWaiters")}
    ${extractFunction("resetMarketPeerDeliveryProtocol")}
    ${extractFunction("releaseLocalImage")}
    ${extractFunction("releaseRemoteImage")}
    ${extractFunction("cleanupRoom")}
    ${extractFunction("resetMarketRoomStateForSwitch")}
    ${extractFunction("connectMarketRoomServices")}
    ${extractFunction("enterRoom")}
    return {
      enterRoom,
      getState: () => state,
    };
  `);
  const runtime = factory({
    window: {
      HariaiAudio: { playPhase: () => {} },
      clearInterval: () => {},
      clearTimeout: () => {},
    },
    onSnapshot: (reference, next, error) => {
      const listener = { reference, next, error, unsubscribeCalls: 0 };
      listener.unsubscribe = () => {
        listener.unsubscribeCalls += 1;
      };
      listeners.push(listener);
      return listener.unsubscribe;
    },
    doc: (_firestore, collection, roomId) => `${collection}/${roomId}`,
    firestore: {},
    beginQueueAttempt: () => {},
    stopRoomHeartbeat: () => {},
    setMarketChrome: () => {},
    render: () => {},
    normalizeMarketRoom: (value) => value,
    normalizeOshijoPhase: () => "",
    TERMINAL_STATES: new Set(["sold", "declined", "canceled"]),
    refreshMarketAchievementNotifications: () => {},
    roomRole: () => "seller",
    handleFatalError: (error) => {
      throw error;
    },
    marketQueueCallable,
    startRoomHeartbeat: (roomId, generation) => {
      heartbeatStarts.push({ roomId, generation });
    },
    showToast: () => {},
    callableMessage: (_error, fallback) => fallback,
    scheduleRoomSyncRetry: () => {},
    markPresenceOffline: () => {
      presenceCleanupCalls += 1;
    },
    createRelationshipFeedbackState: () => ({ fresh: true }),
    normalizeMarketRestartGuide: () => null,
    initialState,
    realtimeStarts,
    peerStarts,
  });

  const roomAEntry = runtime.enterRoom("room-A", 1);
  await Promise.resolve();
  const state = runtime.getState();
  state.room = { status: "pitch", sellerUid: "seller-1", buyerUid: "buyer-1" };
  state.errorMessage = "room A error";
  state.peerStatus = "room A peer";
  state.imageSent = true;
  state.chatMessages = [{ id: "room-A-chat" }];
  state.seenChatIds = new Set(["room-A-chat"]);
  state.pitchSentTurns = new Set([1]);
  state.pendingActionKey = "room-A-action";
  state.pendingActionId = "room-A-action-id";
  state.relationshipFeedback = { old: true };
  state.oshijoClaimOpen = true;
  state.oshijoClaimDraft = "500";
  state.oshijoAudioMuted = true;
  state.oshijoClosingImages = [{ url: "" }];
  state.oshijoShareChoice = "share";
  state.oshijoDecisionRequested = true;
  state.restartGuide = { room: "A" };
  state.incomingTransfer = { name: "room-A-transfer" };
  state.realtimeUnsubscribers = [() => {
    realtimeUnsubscribeCalls += 1;
  }];
  state.presenceConnections = [{ reference: {}, disconnect: {} }];
  state.peer = { close: () => {
    oldPeerCloseCalls += 1;
  } };
  state.channel = { close: () => {
    oldChannelCloseCalls += 1;
  } };

  const roomBEntry = runtime.enterRoom("room-B", 1);
  await Promise.resolve();
  const roomBListener = listeners.find(({ reference }) => reference === "valueMarketRooms/room-B");
  assert.ok(roomBListener);
  roomBListener.next({
    exists: () => true,
    data: () => ({
      status: "pitch",
      sellerUid: "seller-1",
      buyerUid: "buyer-1",
      listing: { title: "room B" },
    }),
  });

  resolveRoomA();
  await roomAEntry;
  assert.equal(state.roomId, "room-B");
  assert.equal(state.roomSyncPending, true, "room A finally must not clear room B's pending sync");
  assert.equal(state.roomUnsubscribe, roomBListener.unsubscribe);

  resolveRoomB();
  await roomBEntry;
  assert.deepEqual(syncCalls, ["room-A", "room-B"]);
  assert.deepEqual(heartbeatStarts, [{ roomId: "room-B", generation: 1 }]);
  assert.deepEqual(realtimeStarts, [{ generation: 1, roomId: "room-B" }]);
  assert.deepEqual(peerStarts, [{ generation: 1, roomId: "room-B" }]);
  assert.equal(state.roomSyncPending, false);
  assert.equal(state.roomId, "room-B");
  assert.equal(state.room.listing.title, "room B");
  assert.equal(state.errorMessage, "");
  assert.equal(state.imageSent, false);
  assert.deepEqual(state.chatMessages, []);
  assert.deepEqual([...state.seenChatIds], []);
  assert.deepEqual([...state.pitchSentTurns], []);
  assert.equal(state.pendingActionKey, "");
  assert.equal(state.pendingActionId, "");
  assert.deepEqual(state.relationshipFeedback, { fresh: true });
  assert.equal(state.oshijoClaimOpen, false);
  assert.equal(state.oshijoClaimDraft, "");
  assert.equal(state.oshijoAudioMuted, false);
  assert.deepEqual(state.oshijoClosingImages, []);
  assert.equal(state.oshijoShareChoice, "");
  assert.equal(state.oshijoDecisionRequested, false);
  assert.equal(state.restartGuide, null);
  assert.equal(state.incomingTransfer, null);
  assert.equal(state.image, sellerImage, "seller listing image should survive a room switch");
  assert.equal(realtimeUnsubscribeCalls, 1);
  assert.equal(presenceCleanupCalls, 1);
  assert.equal(oldPeerCloseCalls, 1);
  assert.equal(oldChannelCloseCalls, 1);
  assert.equal(
    listeners.find(({ reference }) => reference === "valueMarketRooms/room-A").unsubscribeCalls,
    1,
  );
  assert.equal(roomBListener.unsubscribeCalls, 0);
});

test("a delayed room-A diagnostic is discarded after switching to room B", async () => {
  let resolveStats;
  let statsStarted = false;
  const statsGate = new Promise((resolve) => {
    resolveStats = resolve;
  });
  const callableRequests = [];
  const oldPeer = {
    connectionState: "connected",
    iceConnectionState: "connected",
    iceGatheringState: "complete",
    async getStats() {
      statsStarted = true;
      await statsGate;
      return new Map();
    },
  };
  const state = {
    roomId: "room-A",
    peer: oldPeer,
    peerRecoveryAttempts: 1,
    peerStartedAt: Date.now() - 1_000,
    peerTurnAvailable: true,
    peerDiagnosticSent: new Set(),
  };
  const factory = new Function("deps", `
    const { reportMarketP2pConnectivityCallable } = deps;
    const useMarketPreview = false;
    let state = deps.initialState;
    ${extractFunction("selectedMarketCandidateSummary")}
    ${extractFunction("reportMarketP2pDiagnostic")}
    return { reportMarketP2pDiagnostic, getState: () => state };
  `);
  const runtime = factory({
    reportMarketP2pConnectivityCallable: async (request) => {
      callableRequests.push(request);
    },
    initialState: state,
  });

  const diagnostic = runtime.reportMarketP2pDiagnostic("channel_open", oldPeer);
  await waitFor(() => statsStarted, "diagnostic candidate inspection should begin");
  state.roomId = "room-B";
  state.peer = { connectionState: "new" };
  resolveStats();
  await diagnostic;

  assert.deepEqual(callableRequests, []);
});

test("a delayed diagnostic is discarded after replacing the peer in the same room", async () => {
  let resolveStats;
  let statsStarted = false;
  const statsGate = new Promise((resolve) => {
    resolveStats = resolve;
  });
  const callableRequests = [];
  const oldPeer = {
    connectionState: "connected",
    iceConnectionState: "connected",
    iceGatheringState: "complete",
    async getStats() {
      statsStarted = true;
      await statsGate;
      return new Map();
    },
  };
  const state = {
    roomId: "room-A",
    peer: oldPeer,
    peerRecoveryAttempts: 1,
    peerStartedAt: Date.now() - 1_000,
    peerTurnAvailable: true,
    peerDiagnosticSent: new Set(),
  };
  const factory = new Function("deps", `
    const { reportMarketP2pConnectivityCallable } = deps;
    const useMarketPreview = false;
    let state = deps.initialState;
    ${extractFunction("selectedMarketCandidateSummary")}
    ${extractFunction("reportMarketP2pDiagnostic")}
    return { reportMarketP2pDiagnostic };
  `);
  const runtime = factory({
    reportMarketP2pConnectivityCallable: async (request) => {
      callableRequests.push(request);
    },
    initialState: state,
  });

  const diagnostic = runtime.reportMarketP2pDiagnostic("channel_open", oldPeer);
  await waitFor(() => statsStarted, "diagnostic candidate inspection should begin");
  state.peer = { connectionState: "new" };
  resolveStats();
  await diagnostic;

  assert.deepEqual(callableRequests, []);
});

function peerState(overrides = {}) {
  return {
    uid: "buyer-1",
    roomId: "room-one",
    room: { sellerUid: "seller-1", buyerUid: "buyer-1" },
    peer: null,
    peerStartedAt: 0,
    peerTurnAvailable: false,
    peerConnectionId: "",
    peerDiagnosticSent: new Set(),
    peerSignalChain: Promise.resolve(),
    peerTimeout: null,
    peerRecoveryAttempts: 0,
    peerWasConnected: false,
    peerRecoveryTimer: null,
    peerStatus: "",
    channel: null,
    channelReady: false,
    pendingIce: [],
    realtimeUnsubscribers: [],
    ...overrides,
  };
}

function compileSignalRuntime(initialState, extras = {}) {
  const factory = new Function("deps", `
    const {
      window, sendSignal, scheduleMarketPeerConnectTimeout, clearMarketPeerRecoveryTimer,
    } = deps;
    const MARKET_MAX_PENDING_ICE_CANDIDATES = 128;
    let active = true;
    let lifecycleGeneration = deps.initialGeneration;
    let state = deps.initialState;
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
    return {
      handleSignal,
      flushPendingIce,
      getState: () => state,
      setState: (value) => { state = value; },
      setGeneration: (value) => { lifecycleGeneration = value; },
    };
  `);
  return factory({
    initialState,
    initialGeneration: 1,
    window: { clearTimeout: () => {} },
    sendSignal: extras.sendSignal || (async () => {}),
    scheduleMarketPeerConnectTimeout: extras.scheduleMarketPeerConnectTimeout || (() => {}),
    clearMarketPeerRecoveryTimer: extras.clearMarketPeerRecoveryTimer || (() => {}),
  });
}

function signal(type, connectionId, payload, createdAt) {
  const value = {
    fromUid: "seller-1",
    type,
    payload: JSON.stringify(payload),
    createdAt,
  };
  if (connectionId !== undefined) value.connectionId = connectionId;
  return value;
}

function createBuyerPeer() {
  const remoteDescriptions = [];
  const localDescriptions = [];
  const candidateAttempts = [];
  return {
    connectionState: "new",
    signalingState: "stable",
    remoteDescription: null,
    remoteDescriptions,
    localDescriptions,
    candidateAttempts,
    async setRemoteDescription(description) {
      remoteDescriptions.push(description);
      this.remoteDescription = description;
      this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    },
    async createAnswer() {
      return { type: "answer", sdp: `answer-${localDescriptions.length + 1}` };
    },
    async setLocalDescription(description) {
      localDescriptions.push(description);
      this.signalingState = "stable";
    },
    async addIceCandidate(candidate) {
      candidateAttempts.push(candidate);
      if (candidate.fail) throw new Error("unsupported candidate");
    },
  };
}

test("pending ICE is connection-scoped, legacy-compatible, and failure-tolerant", async () => {
  const peer = createBuyerPeer();
  const state = peerState({
    peer,
    peerConnectionId: "connection-B",
    pendingIce: [
      { connectionId: "connection-A", candidate: { id: "stale-A" } },
      { connectionId: "connection-B", candidate: { id: "current-B" } },
      { connectionId: "", candidate: { id: "legacy" } },
      { connectionId: "connection-B", candidate: { id: "bad-B", fail: true } },
      { connectionId: "connection-B", candidate: { id: "after-bad-B" } },
    ],
  });
  const runtime = compileSignalRuntime(state);

  await runtime.flushPendingIce(peer, "room-one", 1);

  assert.deepEqual(
    peer.candidateAttempts.map(({ id }) => id),
    ["current-B", "legacy", "bad-B", "after-bad-B"],
  );
  assert.deepEqual(
    state.pendingIce,
    [
      { connectionId: "connection-A", candidate: { id: "stale-A" } },
      { connectionId: "connection-B", candidate: { id: "bad-B", fail: true } },
    ],
    "another connection and a transiently rejected current candidate must remain replayable",
  );
});

test("a delayed buyer supersedes a 20-second-old offer and answers the new connection", async () => {
  const sentSignals = [];
  const restartedTimeouts = [];
  const peer = createBuyerPeer();
  const state = peerState({ peer });
  const runtime = compileSignalRuntime(state, {
    sendSignal: async (...args) => sentSignals.push(args),
    scheduleMarketPeerConnectTimeout: (...args) => restartedTimeouts.push(args),
  });
  const peerStartedAt = 1_000_000;

  await runtime.handleSignal(
    signal("offer", "connection-A", { type: "offer", sdp: "offer-A" }, peerStartedAt),
    "seller-1",
    peer,
    "room-one",
    1,
    peerStartedAt,
  );
  await runtime.handleSignal(
    signal("offer", "connection-B", { type: "offer", sdp: "offer-B" }, peerStartedAt + 20_001),
    "seller-1",
    peer,
    "room-one",
    1,
    peerStartedAt,
  );

  assert.deepEqual(peer.remoteDescriptions.map(({ sdp }) => sdp), ["offer-A", "offer-B"]);
  assert.equal(state.peerConnectionId, "connection-B");
  assert.deepEqual(
    sentSignals.map((args) => ({ type: args[1], roomId: args[3], connectionId: args[5] })),
    [
      { type: "answer", roomId: "room-one", connectionId: "connection-A" },
      { type: "answer", roomId: "room-one", connectionId: "connection-B" },
    ],
  );
  assert.equal(restartedTimeouts.length, 1);

  const descriptionsBeforeMismatch = peer.remoteDescriptions.length;
  const candidatesBeforeMismatch = peer.candidateAttempts.length;
  await runtime.handleSignal(
    signal("answer", "connection-A", { type: "answer", sdp: "stale-answer" }, peerStartedAt + 20_002),
    "seller-1",
    peer,
    "room-one",
    1,
    peerStartedAt,
  );
  await runtime.handleSignal(
    signal("candidate", "connection-A", { id: "stale-candidate" }, peerStartedAt + 20_003),
    "seller-1",
    peer,
    "room-one",
    1,
    peerStartedAt,
  );
  assert.equal(peer.remoteDescriptions.length, descriptionsBeforeMismatch);
  assert.equal(peer.candidateAttempts.length, candidatesBeforeMismatch);

  await runtime.handleSignal(
    signal("candidate", undefined, { id: "legacy-candidate" }, peerStartedAt + 20_004),
    "seller-1",
    peer,
    "room-one",
    1,
    peerStartedAt,
  );
  await runtime.handleSignal(
    signal("candidate", "connection-B", { id: "bad-current", fail: true }, peerStartedAt + 20_005),
    "seller-1",
    peer,
    "room-one",
    1,
    peerStartedAt,
  );
  await runtime.handleSignal(
    signal("offer", "connection-B", { type: "offer", sdp: "offer-B-retry" }, peerStartedAt + 20_006),
    "seller-1",
    peer,
    "room-one",
    1,
    peerStartedAt,
  );
  assert.deepEqual(
    peer.candidateAttempts.map(({ id }) => id),
    ["legacy-candidate", "bad-current", "bad-current"],
    "legacy ICE is accepted and a rejected current candidate is retried after SDP",
  );
  assert.equal(sentSignals.at(-1)[5], "connection-B");
});

test("stale recovery timers cannot touch replay state, while an ICE-only connection recovers", async () => {
  const timers = [];
  const setupCalls = [];
  let unsubscribeCalls = 0;
  let closeCalls = 0;
  const oldPeer = {
    connectionState: "failed",
    close() {
      throw new Error("the stale peer must not be closed after replay");
    },
  };
  const newPeer = {
    connectionState: "connected",
    close() {
      closeCalls += 1;
    },
  };
  const oldState = peerState({
    peer: oldPeer,
    room: {
      sellerUid: "seller-1",
      buyerUid: "buyer-1",
      status: "negotiating",
    },
    channel: null,
    channelReady: false,
    pendingIce: [{ connectionId: "old", candidate: { id: "old" } }],
    realtimeUnsubscribers: [() => {
      unsubscribeCalls += 1;
    }],
  });
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
    let state = deps.initialState;
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
    return {
      scheduleMarketPeerRecovery,
      getState: () => state,
      setState: (value) => { state = value; },
      setGeneration: (value) => { lifecycleGeneration = value; },
    };
  `);
  const runtime = factory({
    window: {
      setTimeout(callback, delay) {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeout: () => {},
    },
    TERMINAL_STATES: new Set(["sold", "declined", "canceled"]),
    render: () => {},
    reportMarketP2pDiagnostic: () => {},
    setupRealtimeRoom: async (generation, roomId) => {
      setupCalls.push({ service: "realtime", generation, roomId });
    },
    setupPeerConnection: async (generation, roomId) => {
      setupCalls.push({ service: "peer", generation, roomId });
    },
    initialState: oldState,
  });

  runtime.scheduleMarketPeerRecovery(oldPeer, 1, "room-one", { immediate: true });
  const oldTimer = timers[0];

  const newState = peerState({
    peer: newPeer,
    roomId: "room-two",
    room: {
      sellerUid: "seller-1",
      buyerUid: "buyer-1",
      status: "negotiating",
    },
    channel: null,
    channelReady: false,
    pendingIce: [{ connectionId: "old", candidate: { id: "old" } }],
    realtimeUnsubscribers: [() => {
      unsubscribeCalls += 1;
    }],
  });
  runtime.setGeneration(2);
  runtime.setState(newState);
  runtime.scheduleMarketPeerRecovery(newPeer, 2, "room-two", { immediate: true });
  const newTimer = timers[1];

  oldTimer.callback();
  assert.equal(newState.peerRecoveryTimer, newTimer);
  assert.equal(closeCalls, 0);

  assert.equal(timers.length, 2);
  assert.equal(timers[0].delay, 0);
  assert.equal(timers[1].delay, 0);
  newTimer.callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(newState.peerRecoveryAttempts, 1);
  assert.equal(unsubscribeCalls, 0, "P2P recovery must not tear down text/presence listeners");
  assert.equal(closeCalls, 1);
  assert.equal(newState.peer, null);
  assert.deepEqual(
    newState.pendingIce,
    [{ connectionId: "old", candidate: { id: "old" } }],
    "remote ICE already seen by the old peer must remain replayable",
  );
  assert.deepEqual(setupCalls, [
    { service: "realtime", generation: 2, roomId: "room-two" },
    { service: "peer", generation: 2, roomId: "room-two" },
  ]);
});

function createPeerSetupHarness({ initialState, roomRole, handleSignal, useActualSendSignal = false }) {
  const childListeners = [];
  const writes = [];
  const removed = [];
  let connectionSequence = 0;
  let recoveryClearCalls = 0;

  class FakePeer {
    constructor() {
      this.connectionState = "new";
      this.signalingState = "stable";
      this.remoteDescription = null;
    }

    createDataChannel() {
      return { readyState: "connecting" };
    }

    async createOffer() {
      return { type: "offer", sdp: `offer-${initialState.roomId}` };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
    }
  }

  const functions = [
    extractFunction("isCurrentLifecycle"),
    extractFunction("isCurrentMarketPeer"),
    extractFunction("marketPeerNeedsRecovery"),
    extractFunction("marketSignalConnectionMatches"),
    extractFunction("marketDataChannelContextIsCurrent"),
    extractFunction("marketPeerCapabilityContextMatches"),
    extractFunction("advertiseMarketPeerCapabilities"),
    extractFunction("markMarketDataChannelReady"),
    extractFunction("setupPeerConnection"),
  ];
  if (useActualSendSignal) functions.push(extractFunction("sendSignal"));

  const sendSignalBinding = useActualSendSignal
    ? ""
    : "const sendSignal = sendSignalStub;";
  const factory = new Function("deps", `
    const {
      window, RTCPeerConnection, loadMarketIceServers, roomRole,
      marketPeerConnectionId, reportMarketP2pDiagnostic,
      scheduleMarketPeerConnectTimeout, sendSignalStub, handleRecoverableError,
      clearMarketPeerRecoveryTimer, scheduleMarketPeerRecovery, render,
      configureDataChannel, database, ref, onChildAdded, handleSignal,
      remove, set, push, serverTimestamp,
      sendListingImage,
    } = deps;
    const MARKET_P2P_CONNECT_TIMEOUT_MS = 35_000;
    const MARKET_OSHIJO_DELIVERY_PROTOCOL_VERSION = 1;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.initialState;
    ${sendSignalBinding}
    ${functions.join("\n")}
    return {
      setupPeerConnection,
      getState: () => state,
      setState: (value) => { state = value; },
      setGeneration: (value) => { lifecycleGeneration = value; },
    };
  `);

  const runtime = factory({
    window: {
      RTCPeerConnection: FakePeer,
      clearTimeout: () => {},
    },
    RTCPeerConnection: FakePeer,
    loadMarketIceServers: async () => ({ iceServers: [], turnAvailable: true }),
    roomRole,
    marketPeerConnectionId: () => `connection-${++connectionSequence}`,
    reportMarketP2pDiagnostic: () => {},
    scheduleMarketPeerConnectTimeout: () => {},
    sendSignalStub: async () => {},
    handleRecoverableError: () => {},
    clearMarketPeerRecoveryTimer: () => {
      recoveryClearCalls += 1;
    },
    scheduleMarketPeerRecovery: () => {},
    render: () => {},
    configureDataChannel: () => {},
    sendListingImage: async () => {},
    database: {},
    ref: (_database, value) => ({ path: value }),
    onChildAdded: (reference, callback) => {
      childListeners.push({ reference, callback });
      return () => {};
    },
    handleSignal,
    remove: async (reference) => {
      removed.push(reference);
    },
    set: async (reference, value) => {
      writes.push({ reference, value });
    },
    push: (reference) => ({ path: `${reference.path}/signal-key` }),
    serverTimestamp: () => "server-time",
    initialState,
    useActualSendSignal,
  });

  return {
    runtime,
    childListeners,
    writes,
    removed,
    getRecoveryClearCalls: () => recoveryClearCalls,
  };
}

test("ICE connected does not cancel recovery until the data channel is open", async () => {
  const state = peerState();
  const harness = createPeerSetupHarness({
    initialState: state,
    roomRole: () => "buyer",
    handleSignal: async () => {},
  });

  await harness.runtime.setupPeerConnection(1, "room-one");
  state.peer.connectionState = "connected";
  state.channel = null;
  state.peer.onconnectionstatechange();
  assert.equal(state.channelReady, false);
  assert.equal(harness.getRecoveryClearCalls(), 0);

  state.channel = { readyState: "open" };
  state.peer.onconnectionstatechange();
  assert.equal(state.channelReady, true);
  assert.equal(harness.getRecoveryClearCalls(), 1);
});

test("signal snapshots are handled sequentially by the peer that claimed them", async () => {
  let releaseFirst;
  let releaseSwitch;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const switchGate = new Promise((resolve) => {
    releaseSwitch = resolve;
  });
  const started = [];
  const finished = [];
  const state = peerState();
  const harness = createPeerSetupHarness({
    initialState: state,
    roomRole: () => "buyer",
    handleSignal: async (value) => {
      started.push(value.id);
      if (value.id === "first") await firstGate;
      if (value.id === "switch") await switchGate;
      finished.push(value.id);
    },
  });

  await harness.runtime.setupPeerConnection(1, "room-one");
  const listener = harness.childListeners[0];
  listener.callback({ ref: "first-ref", val: () => ({ id: "first" }) });
  listener.callback({ ref: "second-ref", val: () => ({ id: "second" }) });
  await Promise.resolve();
  assert.deepEqual(started, ["first"]);
  assert.deepEqual(finished, []);

  releaseFirst();
  await state.peerSignalChain;
  assert.deepEqual(started, ["first", "second"]);
  assert.deepEqual(finished, ["first", "second"]);
  assert.deepEqual(harness.removed, ["first-ref", "second-ref"]);

  listener.callback({ ref: "switch-ref", val: () => ({ id: "switch" }) });
  await Promise.resolve();
  assert.deepEqual(started, ["first", "second", "switch"]);
  harness.runtime.setGeneration(2);
  releaseSwitch();
  await state.peerSignalChain;
  assert.deepEqual(finished, ["first", "second", "switch"]);
  assert.deepEqual(
    harness.removed,
    ["first-ref", "second-ref"],
    "a snapshot whose peer became stale during handling must remain for the new peer",
  );

  listener.callback({ ref: "stale-ref", val: () => ({ id: "stale" }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["first", "second", "switch"]);
  assert.deepEqual(harness.removed, ["first-ref", "second-ref"]);
});

function createChannelHarness() {
  const finishedTransfers = [];
  const recoverableErrors = [];
  const factory = new Function("deps", `
    const {
      window, roomRole, sendListingImage, handleRecoverableError,
      clearMarketPeerRecoveryTimer, reportMarketP2pDiagnostic, render,
      scheduleMarketPeerRecovery, showToast, createIncomingMarketTransfer,
      marketAssetEndStatus, normalizeOshijoPhase,
    } = deps;
    const DATA_BUFFER_LIMIT = 512 * 1024;
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    const MAX_AUDIO_BYTES = 480 * 1024;
    const MAX_TURNS = 5;
    const OSHIJO_CLOSING_IMAGE_PREFIX = "oshijo-closing-image:";
    const OSHIJO_CLOSING_AUDIO_PREFIX = "oshijo-closing-audio:";
    const MARKET_OSHIJO_DELIVERY_PROTOCOL_VERSION = 1;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.initialState;
    async function finishIncomingAsset() {
      const transfer = state.incomingTransfer;
      if (transfer.name === "buyer-ack-reject") {
        state.incomingTransfer = null;
        throw new Error("buyer ACK rejected");
      }
      deps.finishedTransfers.push({
        roomId: state.roomId,
        name: transfer.name,
        bytes: transfer.chunks.flatMap((chunk) => Array.from(new Uint8Array(chunk))),
      });
      state.incomingTransfer = null;
    }
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("isCurrentMarketPeer")}
    ${extractFunction("marketPeerNeedsRecovery")}
    ${extractFunction("marketSignalConnectionMatches")}
    ${extractFunction("abortMarketIncomingTransfer")}
    ${extractFunction("settleMarketPeerCapabilityWaiters")}
    ${extractFunction("rejectMarketAssetAckWaiters")}
    ${extractFunction("resetMarketPeerDeliveryProtocol")}
    ${extractFunction("marketDataChannelContextIsCurrent")}
    ${extractFunction("marketPeerCapabilityContextMatches")}
    ${extractFunction("advertiseMarketPeerCapabilities")}
    ${extractFunction("markMarketDataChannelReady")}
    ${extractFunction("handleChannelMessage")}
    ${extractFunction("configureDataChannel")}
    return {
      configureDataChannel,
      getState: () => state,
      setGeneration: (value) => { lifecycleGeneration = value; },
    };
  `);
  const initialState = {
    role: "buyer",
    roomId: "room-order",
    room: { sellerUid: "seller-1", sellerName: "SELLER" },
    channel: null,
    channelReady: false,
    peerConnectionId: "connection-order",
    peerTimeout: null,
    peerRecoveryTimer: null,
    peerWasConnected: false,
    peerStatus: "",
    peer: {},
    incomingTransfer: null,
    oshijoDecisionRequested: false,
  };
  const runtime = factory({
    window: { clearTimeout: () => {} },
    roomRole: () => "buyer",
    sendListingImage: async () => {},
    handleRecoverableError: (error) => {
      recoverableErrors.push(error);
    },
    clearMarketPeerRecoveryTimer: () => {},
    reportMarketP2pDiagnostic: () => {},
    render: () => {},
    scheduleMarketPeerRecovery: () => {},
    showToast: () => {},
    createIncomingMarketTransfer: (message) => ({
      kind: message.kind,
      turn: message.turn,
      name: message.name,
      mime: message.mime,
      size: message.size,
      received: 0,
      chunks: [],
    }),
    marketAssetEndStatus: (transfer, message) => {
      if (!transfer) return "orphan";
      if (transfer.kind !== message.kind || transfer.turn !== message.turn) return "mismatch";
      return transfer.received === transfer.size ? "complete" : "mismatch";
    },
    normalizeOshijoPhase: () => "",
    initialState,
    finishedTransfers,
  });
  return { runtime, state: initialState, finishedTransfers, recoverableErrors };
}

function assetStart(name, size) {
  return JSON.stringify({
    type: "asset-start",
    kind: "image",
    turn: 0,
    name,
    mime: "image/png",
    size,
    createdAt: 1,
  });
}

const assetEnd = JSON.stringify({ type: "asset-end", kind: "image", turn: 0 });

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test("data-channel Blob messages stay ordered and an old channel cannot contaminate the next room", async () => {
  const { runtime, state, finishedTransfers, recoverableErrors } = createChannelHarness();
  const orderChannel = { readyState: "open" };
  runtime.configureDataChannel(orderChannel, 1, "room-order", "connection-order");

  let releaseFirstBlob;
  const firstBlobGate = new Promise((resolve) => {
    releaseFirstBlob = resolve;
  });
  const arrayBufferStarts = [];
  const firstBlob = new Blob([Uint8Array.of(1)]);
  firstBlob.arrayBuffer = async () => {
    arrayBufferStarts.push("first");
    await firstBlobGate;
    return Uint8Array.of(1).buffer;
  };
  const secondBlob = new Blob([Uint8Array.of(2)]);
  secondBlob.arrayBuffer = async () => {
    arrayBufferStarts.push("second");
    return Uint8Array.of(2).buffer;
  };

  orderChannel.onmessage({ data: assetStart("ordered", 2) });
  orderChannel.onmessage({ data: firstBlob });
  orderChannel.onmessage({ data: secondBlob });
  orderChannel.onmessage({ data: assetEnd });
  await waitFor(() => arrayBufferStarts.length === 1, "the first Blob should begin decoding");
  assert.deepEqual(arrayBufferStarts, ["first"]);
  assert.deepEqual(finishedTransfers, []);

  releaseFirstBlob();
  await waitFor(() => finishedTransfers.length === 1, "the ordered transfer should finish");
  assert.deepEqual(arrayBufferStarts, ["first", "second"]);
  assert.deepEqual(finishedTransfers[0], {
    roomId: "room-order",
    name: "ordered",
    bytes: [1, 2],
  });

  state.roomId = "room-old";
  state.peerConnectionId = "connection-old";
  const oldChannel = { readyState: "open" };
  runtime.configureDataChannel(oldChannel, 1, "room-old", "connection-old");
  let releaseOldBlob;
  const oldBlobGate = new Promise((resolve) => {
    releaseOldBlob = resolve;
  });
  let oldBlobStarted = false;
  const oldBlob = new Blob([Uint8Array.of(9)]);
  oldBlob.arrayBuffer = async () => {
    oldBlobStarted = true;
    await oldBlobGate;
    return Uint8Array.of(9).buffer;
  };
  oldChannel.onmessage({ data: assetStart("old-room", 1) });
  oldChannel.onmessage({ data: oldBlob });
  await waitFor(() => oldBlobStarted, "the old channel Blob should be awaiting decoding");

  // This mirrors room-switch cleanup before the next channel begins receiving.
  state.incomingTransfer = null;
  state.roomId = "room-new";
  state.room = { sellerUid: "seller-1", sellerName: "NEW SELLER" };
  state.peerConnectionId = "connection-new";
  const newChannel = { readyState: "open" };
  runtime.configureDataChannel(newChannel, 1, "room-new", "connection-new");
  const newBlob = new Blob([Uint8Array.of(7)]);
  newBlob.arrayBuffer = async () => Uint8Array.of(7).buffer;
  newChannel.onmessage({ data: assetStart("new-room", 1) });
  newChannel.onmessage({ data: newBlob });
  newChannel.onmessage({ data: assetEnd });
  await waitFor(() => finishedTransfers.length === 2, "the new room transfer should finish");

  releaseOldBlob();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(finishedTransfers[1], {
    roomId: "room-new",
    name: "new-room",
    bytes: [7],
  });
  assert.equal(finishedTransfers.length, 2);
  assert.equal(state.incomingTransfer, null);
  assert.deepEqual(recoverableErrors, []);
});

test("a rejected buyer delivery ACK is caught by the ordered channel chain", async () => {
  const { runtime, state, recoverableErrors } = createChannelHarness();
  const channel = { readyState: "open" };
  runtime.configureDataChannel(channel, 1, "room-order", "connection-order");
  channel.onmessage({ data: assetStart("buyer-ack-reject", 1) });
  channel.onmessage({ data: Uint8Array.of(1).buffer });
  channel.onmessage({ data: assetEnd });
  await waitFor(
    () => recoverableErrors.length === 1,
    "the channel wrapper should catch an asynchronous buyer ACK rejection",
  );
  assert.match(recoverableErrors[0].message, /buyer ACK rejected/);
  assert.equal(state.incomingTransfer, null);
});

test("the same pair gets distinct room paths and connection IDs on consecutive lifecycles", async () => {
  const firstState = peerState({
    uid: "seller-1",
    roomId: "room-one",
    room: { sellerUid: "seller-1", buyerUid: "buyer-1" },
  });
  const harness = createPeerSetupHarness({
    initialState: firstState,
    roomRole: () => "seller",
    handleSignal: async () => {},
    useActualSendSignal: true,
  });

  await harness.runtime.setupPeerConnection(1, "room-one");
  const firstConnectionId = firstState.peerConnectionId;

  const secondState = peerState({
    uid: "seller-1",
    roomId: "room-two",
    room: { sellerUid: "seller-1", buyerUid: "buyer-1" },
  });
  harness.runtime.setGeneration(2);
  harness.runtime.setState(secondState);
  await harness.runtime.setupPeerConnection(2, "room-two");
  const secondConnectionId = secondState.peerConnectionId;

  assert.match(firstConnectionId, /^[A-Za-z0-9-]+$/);
  assert.match(secondConnectionId, /^[A-Za-z0-9-]+$/);
  assert.notEqual(secondConnectionId, firstConnectionId);
  assert.deepEqual(
    harness.childListeners.map(({ reference }) => reference.path),
    [
      "online/valueMarketRooms/room-one/signals/seller-1",
      "online/valueMarketRooms/room-two/signals/seller-1",
    ],
  );
  assert.deepEqual(
    harness.writes.map(({ reference, value }) => ({
      path: reference.path,
      type: value.type,
      connectionId: value.connectionId,
    })),
    [
      {
        path: "online/valueMarketRooms/room-one/signals/buyer-1/signal-key",
        type: "offer",
        connectionId: firstConnectionId,
      },
      {
        path: "online/valueMarketRooms/room-two/signals/buyer-1/signal-key",
        type: "offer",
        connectionId: secondConnectionId,
      },
    ],
  );
});
