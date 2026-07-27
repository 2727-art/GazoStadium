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

function fakeWindow() {
  let nextId = 1;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    run(id) {
      const timer = timers.get(id);
      if (!timer) return;
      timers.delete(id);
      timer.callback();
    },
  };
}

function createProtocolHarness() {
  const window = fakeWindow();
  const peer = {};
  const sent = [];
  const channel = {
    readyState: "open",
    send(value) {
      sent.push(JSON.parse(value));
    },
  };
  const state = {
    roomId: "room-ack",
    peer,
    peerGeneration: 4,
    peerConnectionId: "connection-ack",
    channel,
    peerCapabilities: {
      channel,
      connectionId: "connection-ack",
      peerGeneration: 4,
      advertised: false,
      remoteOshijoDeliveryAck: false,
    },
    peerCapabilityWaiters: new Set(),
    pendingAssetAcks: new Map(),
  };
  const factory = new Function("deps", `
    const { window } = deps;
    const MARKET_OSHIJO_DELIVERY_PROTOCOL_VERSION = 1;
    const MARKET_P2P_CAPABILITY_WAIT_MS = 3_000;
    const MARKET_P2P_ASSET_ACK_TIMEOUT_MS = 15_000;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.state;
    ${extractFunction("isCurrentLifecycle")}
    ${extractFunction("isCurrentMarketPeer")}
    ${extractFunction("marketSignalConnectionMatches")}
    ${extractFunction("marketDataChannelContextIsCurrent")}
    ${extractFunction("settleMarketPeerCapabilityWaiters")}
    ${extractFunction("rejectMarketAssetAckWaiters")}
    ${extractFunction("resetMarketPeerDeliveryProtocol")}
    ${extractFunction("validMarketTransferId")}
    ${extractFunction("marketPeerCapabilityContextMatches")}
    ${extractFunction("advertiseMarketPeerCapabilities")}
    ${extractFunction("acceptMarketPeerCapabilities")}
    ${extractFunction("waitForMarketOshijoDeliveryCapability")}
    ${extractFunction("createMarketAssetAckWaiter")}
    ${extractFunction("armMarketAssetAckWaiter")}
    ${extractFunction("cancelMarketAssetAckWaiter")}
    ${extractFunction("acceptMarketAssetAck")}
    return {
      advertiseMarketPeerCapabilities,
      acceptMarketPeerCapabilities,
      waitForMarketOshijoDeliveryCapability,
      createMarketAssetAckWaiter,
      armMarketAssetAckWaiter,
      acceptMarketAssetAck,
      resetMarketPeerDeliveryProtocol,
    };
  `);
  return {
    runtime: factory({ window, state }),
    state,
    peer,
    channel,
    context: {
      generation: 1,
      roomId: "room-ack",
      connectionId: "connection-ack",
      peer,
      peerGeneration: 4,
    },
    sent,
    window,
  };
}

test("delivery capability negotiation falls back on timeout and resolves on an exact peer", async () => {
  const harness = createProtocolHarness();
  assert.equal(
    harness.runtime.advertiseMarketPeerCapabilities(harness.channel, harness.context),
    true,
  );
  assert.deepEqual(harness.sent, [{
    type: "market-capabilities",
    version: 1,
    oshijoDeliveryAck: true,
  }]);

  const supported = harness.runtime.waitForMarketOshijoDeliveryCapability(
    harness.channel,
    harness.context,
  );
  assert.equal(harness.runtime.acceptMarketPeerCapabilities({
    type: "market-capabilities",
    version: 1,
    oshijoDeliveryAck: true,
  }, harness.channel, harness.context), true);
  assert.equal(await supported, true);

  harness.state.peerCapabilities.remoteOshijoDeliveryAck = false;
  const legacy = harness.runtime.waitForMarketOshijoDeliveryCapability(
    harness.channel,
    harness.context,
  );
  const timeout = [...harness.window.timers.entries()]
    .find(([, timer]) => timer.delay === 3_000);
  assert.ok(timeout);
  harness.window.run(timeout[0]);
  assert.equal(await legacy, false);
});
test("asset ACK is exact, survives ACK-before-arm, and disconnect rejects pending waiters", async () => {
  const harness = createProtocolHarness();
  const transferId = "delivery-0000000200";
  const waiter = harness.runtime.createMarketAssetAckWaiter(
    transferId,
    "image",
    harness.channel,
    harness.context,
  );
  assert.equal(harness.runtime.acceptMarketAssetAck({
    type: "asset-delivered",
    transferId,
    kind: "audio",
  }, harness.channel, harness.context), false);
  assert.equal(harness.runtime.acceptMarketAssetAck({
    type: "asset-delivered",
    transferId: "delivery-0000000201",
    kind: "image",
  }, harness.channel, harness.context), false);
  assert.equal(harness.runtime.acceptMarketAssetAck({
    type: "asset-delivered",
    transferId,
    kind: "image",
  }, { readyState: "open" }, harness.context), false);
  assert.equal(harness.state.pendingAssetAcks.get(transferId), waiter);

  assert.equal(harness.runtime.acceptMarketAssetAck({
    type: "asset-delivered",
    transferId,
    kind: "image",
  }, harness.channel, harness.context), true);
  harness.runtime.armMarketAssetAckWaiter(waiter);
  assert.deepEqual(await waiter.promise, { transferId, mediaKind: "image" });
  assert.equal(harness.window.timers.size, 0, "ACK before arming must not leave a timeout");

  const pending = harness.runtime.createMarketAssetAckWaiter(
    "delivery-0000000202",
    "audio",
    harness.channel,
    harness.context,
  );
  const disconnected = new Error("channel replaced");
  harness.runtime.resetMarketPeerDeliveryProtocol(disconnected);
  await assert.rejects(pending.promise, /channel replaced/);
  assert.equal(harness.state.pendingAssetAcks.size, 0);
});

function createReceiverHarness({ ack, render } = {}) {
  const events = [];
  const urls = [];
  const revoked = [];
  const sent = [];
  const channel = {
    readyState: "open",
    send(value) {
      sent.push(JSON.parse(value));
      events.push("p2p-ack");
    },
  };
  const state = {
    roomId: "room-receiver",
    room: {
      status: "oshijo_closing",
      sellerUid: "seller-1",
      sellerName: "SELLER",
    },
    incomingTransfer: null,
    oshijoDecisionRequested: false,
    oshijoClosingImages: [],
    audioMessages: [],
    remoteImage: null,
  };
  const factory = new Function("deps", `
    const {
      URL, verifiedMarketImageMimeFromChunks, normalizeOshijoPhase,
      performOshijoDeliveryAction, marketDataChannelContextIsCurrent,
      render, releaseRemoteImage,
    } = deps;
    const OSHIJO_CLOSING_IMAGE_PREFIX = "oshijo-closing-image:";
    const OSHIJO_CLOSING_AUDIO_PREFIX = "oshijo-closing-audio:";
    let lifecycleGeneration = 1;
    let state = deps.state;
    ${extractFunction("finishIncomingAsset")}
    return { finishIncomingAsset };
  `);
  const runtime = factory({
    state,
    URL: {
      createObjectURL() {
        const url = `blob:test-${urls.length + 1}`;
        urls.push(url);
        events.push("url");
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
        events.push("revoke");
      },
    },
    verifiedMarketImageMimeFromChunks: () => {
      events.push("validated");
      return "image/webp";
    },
    normalizeOshijoPhase: (room) => (
      room?.status === "oshijo_closing" ? "closing" : "decision"
    ),
    performOshijoDeliveryAction: async (...args) => {
      events.push("server-ack");
      assert.equal(state.oshijoClosingImages.length, 1, "buyer must accept locally first");
      if (ack) return ack({ state, events, args });
      return {
        oshijoDelivery: {
          deliveryId: args[1].deliveryId,
          mediaKind: args[1].mediaKind,
          state: "finalized",
        },
      };
    },
    marketDataChannelContextIsCurrent: (candidate) => (
      candidate === channel && state.roomId === "room-receiver"
    ),
    render: () => {
      events.push("render");
      if (render) render({ state, events });
    },
    releaseRemoteImage: () => {},
  });
  return {
    runtime,
    state,
    channel,
    context: {
      generation: 1,
      roomId: "room-receiver",
      connectionId: "connection-receiver",
      peer: {},
      peerGeneration: 2,
    },
    events,
    urls,
    revoked,
    sent,
  };
}

function closingImageTransfer(deliveryId) {
  return {
    kind: "image",
    turn: 0,
    transferId: deliveryId,
    name: "oshijo-closing-image:1",
    mime: "image/webp",
    size: 4,
    received: 4,
    chunks: [Uint8Array.of(0x52, 0x49, 0x46, 0x46).buffer],
    createdAt: 1,
  };
}

test("buyer validates and renders before server ACK, then acknowledges the exact delivery once", async () => {
  const harness = createReceiverHarness();
  const transferId = "delivery-0000000300";
  harness.state.incomingTransfer = closingImageTransfer(transferId);
  await harness.runtime.finishIncomingAsset(harness.channel, harness.context);

  assert.deepEqual(harness.events, [
    "validated",
    "url",
    "render",
    "server-ack",
    "p2p-ack",
  ]);
  assert.equal(harness.state.oshijoClosingImages.length, 1);
  assert.equal(harness.state.oshijoClosingImages[0].transferId, transferId);
  assert.deepEqual(harness.sent, [{
    type: "asset-delivered",
    transferId,
    kind: "image",
  }]);
  assert.equal(harness.state.incomingTransfer, null);

  harness.state.incomingTransfer = closingImageTransfer(transferId);
  await harness.runtime.finishIncomingAsset(harness.channel, harness.context);
  assert.equal(harness.state.oshijoClosingImages.length, 1, "idempotent replay must not duplicate UI");
  assert.equal(harness.urls.length, 1, "idempotent replay must not leak another object URL");
});

test("buyer keeps a locally accepted asset when server ACK is ambiguous or the phase changes", async () => {
  const harness = createReceiverHarness({
    ack: async ({ state }) => {
      state.room.status = "decision";
      throw new Error("ACK response lost");
    },
  });
  harness.state.incomingTransfer = closingImageTransfer("delivery-0000000310");
  await assert.rejects(
    harness.runtime.finishIncomingAsset(harness.channel, harness.context),
    /ACK response lost/,
  );
  assert.equal(harness.state.oshijoClosingImages.length, 1);
  assert.equal(harness.state.incomingTransfer, null);
  assert.deepEqual(harness.sent, []);
  assert.deepEqual(harness.revoked, [], "a displayed asset must retain its URL after ambiguous ACK");
});

test("a render failure rolls back the local item and revokes its object URL before server ACK", async () => {
  const harness = createReceiverHarness({
    render: () => {
      throw new Error("render failed");
    },
  });
  harness.state.incomingTransfer = closingImageTransfer("delivery-0000000320");
  await assert.rejects(
    harness.runtime.finishIncomingAsset(harness.channel, harness.context),
    /render failed/,
  );
  assert.deepEqual(harness.state.oshijoClosingImages, []);
  assert.deepEqual(harness.revoked, ["blob:test-1"]);
  assert.equal(harness.events.includes("server-ack"), false);
  assert.equal(harness.state.incomingTransfer, null);
});

function createSenderHarness({
  supportsAck,
  callable,
  authorize = async () => true,
  armWaiter,
} = {}) {
  const calls = [];
  const sentAssets = [];
  const channel = { readyState: "open" };
  const peer = {};
  const state = {
    roomId: "room-sender",
    room: {
      status: "oshijo_closing",
      turn: 1,
      closingTurnsUsed: 0,
      oshijoClosingTurnCount: 0,
    },
    channel,
    peer,
    peerGeneration: 3,
    peerConnectionId: "connection-sender",
  };
  const factory = new Function("deps", `
    const {
      marketActionCallable, waitForMarketOshijoDeliveryCapability,
      authorizeOshijoClosingTurn, sendAsset, marketPeerConnectionId,
      marketDataChannelContextIsCurrent, normalizeOshijoPhase,
      createMarketAssetAckWaiter, armMarketAssetAckWaiter,
      cancelMarketAssetAckWaiter,
    } = deps;
    const useMarketPreview = false;
    const MARKET_P2P_ASSET_ACK_TIMEOUT_MS = 15_000;
    const MARKET_P2P_FINALIZE_MARGIN_MS = 5_000;
    let active = true;
    let lifecycleGeneration = 1;
    let state = deps.state;
    function isCurrentLifecycle(generation) {
      return active && generation === lifecycleGeneration;
    }
    function applyOshijoClosingActionResponse(data) {
      const count = Number(data?.oshijoClosingTurnCount);
      if (Number.isFinite(count)) state.room.oshijoClosingTurnCount = count;
    }
    ${extractFunction("validMarketTransferId")}
    ${extractFunction("marketOshijoDeliveryActionId")}
    ${extractFunction("performOshijoDeliveryAction")}
    ${extractFunction("deliverOshijoClosingAsset")}
    return { deliverOshijoClosingAsset };
  `);
  const runtime = factory({
    state,
    marketActionCallable: async (request) => {
      calls.push(request);
      return callable(request, state);
    },
    waitForMarketOshijoDeliveryCapability: async () => supportsAck,
    authorizeOshijoClosingTurn: authorize,
    sendAsset: async (_blob, options) => {
      sentAssets.push(options);
    },
    marketPeerConnectionId: () => "delivery-0000000400",
    marketDataChannelContextIsCurrent: (candidate, context) => (
      candidate === channel
      && context.peer === peer
      && context.peerGeneration === 3
      && context.connectionId === "connection-sender"
      && state.roomId === "room-sender"
    ),
    normalizeOshijoPhase: (room) => (
      room?.status === "oshijo_closing" ? "closing" : "decision"
    ),
    createMarketAssetAckWaiter: () => {
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      promise.catch(() => {});
      return { promise, resolve, reject };
    },
    armMarketAssetAckWaiter: (waiter) => armWaiter(waiter, state),
    cancelMarketAssetAckWaiter: () => {},
  });
  return { runtime, state, calls, sentAssets };
}

const senderOptions = {
  mediaKind: "image",
  turn: 0,
  name: "oshijo-closing-image:1",
  createdAt: 1,
  generation: 1,
  roomId: "room-sender",
};

test("legacy peers use the old immediate path without creating a reservation", async () => {
  let legacyAuthorizations = 0;
  const harness = createSenderHarness({
    supportsAck: false,
    callable: async () => {
      throw new Error("new callable must not run");
    },
    authorize: async () => {
      legacyAuthorizations += 1;
      return true;
    },
    armWaiter: () => {},
  });
  const result = await harness.runtime.deliverOshijoClosingAsset(
    new Blob([Uint8Array.of(1)]),
    senderOptions,
  );
  assert.equal(result.legacy, true);
  assert.equal(result.delivered, true);
  assert.equal(legacyAuthorizations, 1);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.sentAssets[0].transferId, undefined);
});

test("ACK timeout releases the reservation and does not consume a closing turn", async () => {
  const harness = createSenderHarness({
    supportsAck: true,
    callable: async (request) => {
      if (request.action === "oshijo_closing_turn_reserve") {
        return {
          data: {
            oshijoClosingTurnCount: 0,
            oshijoDelivery: {
              deliveryId: request.deliveryId,
              mediaKind: request.mediaKind,
              state: "reserved",
              expiresAt: Date.now() + 120_000,
            },
          },
        };
      }
      return {
        data: {
          status: "oshijo_closing",
          oshijoClosingTurnCount: 0,
          oshijoDelivery: {
            deliveryId: request.deliveryId,
            mediaKind: request.mediaKind,
            state: "released",
            expiresAt: 0,
          },
        },
      };
    },
    armWaiter: (waiter) => waiter.reject(new Error("ACK timeout")),
  });
  await assert.rejects(
    harness.runtime.deliverOshijoClosingAsset(
      new Blob([Uint8Array.of(1)]),
      senderOptions,
    ),
    /ACK timeout/,
  );
  assert.deepEqual(
    harness.calls.map(({ action, actionId }) => [action, actionId]),
    [
      ["oshijo_closing_turn_reserve", "delivery-0000000400-reserve"],
      ["oshijo_closing_turn_release", "delivery-0000000400-release"],
    ],
  );
  assert.equal(harness.state.room.oshijoClosingTurnCount, 0);
});

test("a lost reserve response triggers same-ID cleanup, while finalized release wins benignly", async () => {
  const reserveLost = createSenderHarness({
    supportsAck: true,
    callable: async (request) => {
      if (request.action === "oshijo_closing_turn_reserve") {
        throw new Error("reserve response lost");
      }
      throw new Error("reservation missing");
    },
    armWaiter: () => {},
  });
  await assert.rejects(
    reserveLost.runtime.deliverOshijoClosingAsset(
      new Blob([Uint8Array.of(1)]),
      senderOptions,
    ),
    /reserve response lost/,
  );
  assert.deepEqual(
    reserveLost.calls.map(({ action }) => action),
    ["oshijo_closing_turn_reserve", "oshijo_closing_turn_release"],
  );

  const phaseChanged = createSenderHarness({
    supportsAck: true,
    callable: async (request) => {
      if (request.action === "oshijo_closing_turn_reserve") {
        return {
          data: {
            oshijoDelivery: {
              deliveryId: request.deliveryId,
              mediaKind: request.mediaKind,
              state: "reserved",
              expiresAt: Date.now() + 120_000,
            },
          },
        };
      }
      return {
        data: {
          status: "decision",
          oshijoClosingTurnCount: 1,
          oshijoDelivery: {
            deliveryId: request.deliveryId,
            mediaKind: request.mediaKind,
            state: "finalized",
            expiresAt: 0,
          },
        },
      };
    },
    armWaiter: (waiter, state) => {
      state.room.status = "decision";
      waiter.resolve();
    },
  });
  const result = await phaseChanged.runtime.deliverOshijoClosingAsset(
    new Blob([Uint8Array.of(1)]),
    senderOptions,
  );
  assert.equal(result.delivered, true);
  assert.equal(result.legacy, false);
  assert.deepEqual(
    phaseChanged.calls.map(({ action }) => action),
    ["oshijo_closing_turn_reserve", "oshijo_closing_turn_release"],
  );
  assert.equal(phaseChanged.state.room.oshijoClosingTurnCount, 1);
});
