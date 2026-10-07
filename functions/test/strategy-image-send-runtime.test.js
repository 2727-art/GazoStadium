"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const source = fs.readFileSync(process.env.STRATEGY_IMAGE_TEST_SOURCE
  || path.resolve(__dirname, "../../strategy.js"), "utf8");
const markers = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
let imageApi;
before(async () => {
  imageApi = await import(pathToFileURL(path.resolve(__dirname, "../../online-image-transfer.mjs")));
});

function namedFunction(name) {
  const index = markers.findIndex((match) => match[1] === name);
  assert.ok(index >= 0, `missing runtime function ${name}`);
  return source.slice(markers[index].index, markers[index + 1]?.index ?? source.length);
}
function load(context, names) {
  vm.runInContext(names.map(namedFunction).join("\n"), context);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

// Valid WebP magic plus distinct payloads exercise the real MIME checks and let
// received bytes detect corruption without depending on an image decoder.
function card(index = 0, { audio = false, size = 32768 + index * 16384 } = {}) {
  const bytes = new Uint8Array(size).fill(index + 1);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const result = { blob: new Blob([bytes], { type: "image/webp" }) };
  if (audio) {
    result.audioBlob = new Blob([new Uint8Array(16384).fill(index + 10)], { type: "audio/wav" });
    result.audioDuration = 1;
    result.audioCueStart = 0;
  }
  return result;
}
function holdBlobRead(blob) {
  const started = deferred(), gate = deferred();
  const read = blob.arrayBuffer.bind(blob);
  Object.defineProperty(blob, "arrayBuffer", { value: () => {
    started.resolve();
    return gate.promise.then(() => read());
  } });
  return { started: started.promise, release: () => gate.resolve(), reject: (error) => gate.reject(error) };
}

const senderFunctions = [
  "imageKey", "getTransferableStrategyAudio", "ensureFinishImagesSent", "sendImage", "sendProfileAvatar",
];
const senderHelpers = [
  "strategyImageSendContextIsCurrent", "getStrategyImageSendCoordinator",
  "assertStrategyImageSendContext", "queueStrategyImageSend",
];
const receiverFunctions = [
  "imageKey", "normalizeIncomingStrategyImageStart", "handleChannelMessage", "finishIncomingImage",
  "finishIncomingAudio", "acknowledgeStrategyMedia", "finishIncomingProfileAvatar", "releaseRemoteAvatar",
];

function makeState(uid = "sender") {
  return {
    uid, opponentUid: uid === "sender" ? "receiver" : "sender", roomId: "room-1",
    channel: null, channelReady: true, imageSendCoordinator: null, sentImageKeys: new Set(), localFinishCards: new Map(),
    remoteImages: new Map(), ackedMediaKeys: new Set(), incomingTransfer: null,
    incomingAudioTransfer: null, incomingAvatarTransfer: null, remoteAvatar: null,
    avatarSent: false, roomData: { moves: { 1: { break: { by: "sender" }, finish: { count: 3 } } } },
  };
}
function fixture({ count = 2, audio = false } = {}) {
  const wire = [], writes = [], hooks = {}, urls = new Map();
  const senderState = makeState();
  const receiverState = makeState("receiver");
  let urlSequence = 0;
  const common = {
    ...imageApi, Blob, ArrayBuffer, Uint8Array, Promise, console,
    STRATEGY_DECK_IMAGE_MAX_BYTES: 15 * 1024 * 1024,
    STRATEGY_DECK_IMAGE_MIME_TYPES: ["image/webp", "image/png", "image/jpeg"],
    HARIAI_MAX_SLOTS: 30, HARIAI_FINISH_MAX: 3, MAX_AUDIO_TRANSFER_BYTES: 480 * 1024,
    MAX_AUDIO_SECONDS: 10, AUDIO_HIGHLIGHT_SECONDS: 3, PROFILE_AVATAR_MAX_BYTES: 256 * 1024,
    DATA_CHUNK_BYTES: 16 * 1024, DATA_BUFFER_LIMIT: 512 * 1024,
    refreshHariaiTransferProgress() {}, renderBattleIfChanged() {}, render() {}, releaseCardAudio() {},
    URL: { createObjectURL(blob) { const key = `blob:test-${++urlSequence}`; urls.set(key, blob); return key; },
      revokeObjectURL(key) { urls.delete(key); } },
    window: { setTimeout, clearTimeout },
  };
  const channel = {
    readyState: "open", bufferedAmount: 0,
    send(data) { hooks.beforeSend?.(data, wire.length); wire.push(data); },
    close() { this.readyState = "closed"; }, addEventListener() {}, removeEventListener() {},
  };
  senderState.channel = channel;
  const cards = Array.from({ length: count }, (_, index) => card(index, { audio }));
  cards.forEach((item, index) => senderState.localFinishCards.set(`1:${index}`, item));
  const avatar = card(4, { size: 32768 });
  const sender = vm.createContext({ ...common, state: senderState, active: true,
    shared: () => ({ profileAvatar: { ready: () => hooks.avatarReady?.(), get: () => avatar } }),
    waitForDataBuffer: async (targetChannel) => { await hooks.beforeBufferWait?.(targetChannel); },
  });
  load(sender, [...senderHelpers.filter((name) => markers.some((match) => match[1] === name)), ...senderFunctions]);
  const receiver = vm.createContext({ ...common, state: receiverState, database: {},
    ref: (_db, key) => key, set: async (key, value) => { writes.push({ key, value }); },
  });
  load(receiver, receiverFunctions);
  return {
    sender, senderState, receiver, receiverState, cards, avatar, channel, wire, writes, hooks,
    sendFinish: () => sender.ensureFinishImagesSent(1, count),
    send: (item, index = 0) => sender.sendImage(item, "finish", 1, index),
    sendAvatar: () => sender.sendProfileAvatar(),
    async receive() {
      for (const data of wire) await receiver.handleChannelMessage(data);
    },
    async assertReceived(indices, { withAvatar = false } = {}) {
      await this.receive();
      assert.equal(receiverState.remoteImages.size, indices.length);
      for (const index of indices) {
        const item = receiverState.remoteImages.get(`finish:1:${index}`);
        assert.ok(item, `received image ${index}`);
        assert.deepEqual(Buffer.from(await item.blob.arrayBuffer()), Buffer.from(await cards[index].blob.arrayBuffer()));
        assert.equal(item.awaitingAudio, false);
        if (cards[index].audioBlob) {
          assert.deepEqual(Buffer.from(await item.audioBlob.arrayBuffer()), Buffer.from(await cards[index].audioBlob.arrayBuffer()));
        }
        assert.ok(writes.some((write) => write.key === `online/strategyRooms/room-1/moves/1/finishReceived/${index}` && write.value === true));
      }
      assert.equal(writes.length, indices.length, "acknowledge each image exactly once");
      assert.equal(Boolean(receiverState.remoteAvatar), withAvatar);
      if (withAvatar) assert.deepEqual(Buffer.from(await receiverState.remoteAvatar.blob.arrayBuffer()), Buffer.from(await avatar.blob.arrayBuffer()));
    },
  };
}

for (const count of [1, 2, 3]) {
  test(`${count} finish image(s) complete when submit and room listener request the same batch`, async () => {
    const f = fixture({ count });
    await Promise.all([f.sendFinish(), f.sendFinish()]);
    await f.assertReceived(Array.from({ length: count }, (_, index) => index));
    const before = f.wire.length;
    await f.sendFinish();
    assert.equal(f.wire.length, before, "completed batch is not resent");
  });
}

test("different image keys cannot interleave their payloads", async () => {
  const f = fixture();
  await Promise.all([f.send(f.cards[0], 0), f.send(f.cards[1], 1)]);
  await f.assertReceived([0, 1]);
});

test("avatar and duplicate finish batches keep every image and attached audio together", async () => {
  const f = fixture({ count: 3, audio: true });
  await Promise.all([f.sendAvatar(), f.sendFinish(), f.sendFinish()]);
  await f.assertReceived([0, 1, 2], { withAvatar: true });
});

test("a pending image preparation does not block another ready image", async () => {
  const f = fixture();
  const held = holdBlobRead(f.cards[0].blob);
  const pending = f.send(f.cards[0], 0);
  await held.started;
  const ready = f.send(f.cards[1], 1);
  await turn();
  const sentIndices = f.wire.filter((data) => typeof data === "string").map((data) => JSON.parse(data)).filter((data) => data.type === "strategy-image-end").map((data) => data.index);
  held.release();
  await Promise.all([pending, ready]);
  assert.deepEqual(sentIndices, [1]);
  await f.assertReceived([0, 1]);
});

test("optional avatar readiness does not block a ready finish image", async () => {
  const f = fixture({ count: 1 });
  const gate = deferred();
  f.hooks.avatarReady = () => gate.promise;
  const avatar = f.sendAvatar();
  const image = f.sendFinish();
  await turn();
  const imageEnded = f.wire.some((data) => typeof data === "string" && JSON.parse(data).type === "strategy-image-end");
  gate.resolve();
  await Promise.all([avatar, image]);
  assert.equal(imageEnded, true);
  await f.assertReceived([0], { withAvatar: true });
});

test("avatar Blob preparation does not occupy the image send queue", async () => {
  const f = fixture({ count: 1 });
  const held = holdBlobRead(f.avatar.blob);
  const avatar = f.sendAvatar();
  await held.started;
  const image = f.sendFinish();
  await turn();
  const imageEnded = f.wire.some((data) => typeof data === "string" && JSON.parse(data).type === "strategy-image-end");
  held.release();
  await Promise.all([avatar, image]);
  assert.equal(imageEnded, true);
  await f.assertReceived([0], { withAvatar: true });
});

test("duplicate callers both observe the same preparation failure and the same key can retry", async () => {
  const f = fixture({ count: 1 });
  const held = holdBlobRead(f.cards[0].blob);
  const outcomes = Promise.allSettled([f.sendFinish(), f.sendFinish()]);
  await held.started;
  const failure = new Error("synthetic image read failure");
  held.reject(failure);
  const results = await outcomes;
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.ok(results.every((result) => result.reason === failure));
  assert.equal(f.wire.length, 0);
  assert.equal(f.senderState.sentImageKeys.size, 0);
  f.cards[0] = card(0);
  f.senderState.localFinishCards.set("1:0", f.cards[0]);
  await f.sendFinish();
  await f.assertReceived([0]);
});

for (const invalid of ["missing", "mime", "oversized"]) {
  test(`an invalid ${invalid} image fails before framing and does not block a later valid image`, async () => {
    const f = fixture({ count: 1 });
    const item = invalid === "missing" ? {} : invalid === "mime"
      ? { blob: new Blob([new Uint8Array(16)], { type: "image/webp" }) }
      : { blob: new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], { type: "image/webp" }) };
    await assert.rejects(f.send(item));
    assert.equal(f.wire.length, 0);
    assert.equal(f.senderState.sentImageKeys.size, 0);
    await f.sendFinish();
    await f.assertReceived([0]);
  });
}

test("avatar preparation failure leaves the image channel usable", async () => {
  const f = fixture({ count: 1 });
  f.hooks.avatarReady = () => Promise.reject(new Error("synthetic avatar preparation failure"));
  await assert.rejects(f.sendAvatar());
  assert.equal(f.wire.length, 0);
  await f.sendFinish();
  await f.assertReceived([0]);
});

test("a mid-frame send failure rejects duplicate waiters and blocks later payloads on that channel", async () => {
  const f = fixture();
  const failure = new Error("synthetic mid-frame send failure");
  f.hooks.beforeSend = (_data, count) => { if (count === 2) throw failure; };
  const results = await Promise.allSettled([f.sendFinish(), f.sendFinish()]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.ok(results.every((result) => result.reason === failure));
  assert.equal(f.senderState.sentImageKeys.size, 0);
  const afterFailure = f.wire.length;
  f.hooks.beforeSend = undefined;
  await assert.rejects(f.send(f.cards[1], 1));
  await f.sendAvatar();
  assert.equal(f.channel.readyState, "closed");
  assert.equal(f.senderState.avatarSent, false);
  assert.equal(f.wire.length, afterFailure, "never continue an incomplete frame with another payload");
});

for (const change of ["state", "room", "channel"]) {
  test(`a ${change} switch while image preparation is pending cannot send into either room`, async () => {
    const f = fixture({ count: 1 });
    const held = holdBlobRead(f.cards[0].blob);
    const outcome = Promise.allSettled([f.sendFinish(), f.sendFinish()]);
    await held.started;
    if (change === "state") f.sender.state = makeState();
    else if (change === "room") f.senderState.roomId = "room-2";
    else f.senderState.channel = { ...f.channel, send() { assert.fail("used replacement channel"); } };
    held.release();
    const results = await outcome;
    assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
    assert.equal(f.wire.length, 0);
    assert.equal(f.senderState.sentImageKeys.size, 0);
  });
}

test("a room switch during a frame stops both the current and queued image", async () => {
  const f = fixture();
  const blocked = deferred(), entered = deferred();
  let once = false;
  f.hooks.beforeBufferWait = async () => {
    if (!once) { once = true; entered.resolve(); await blocked.promise; }
  };
  const outcomes = Promise.allSettled([f.send(f.cards[0], 0), f.send(f.cards[1], 1)]);
  await entered.promise;
  f.senderState.roomId = "room-2";
  const before = f.wire.length;
  blocked.resolve();
  const results = await outcomes;
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(f.wire.length, before);
  assert.equal(f.senderState.sentImageKeys.size, 0);
});

for (const change of ["room", "channel"]) {
  test(`the same image key in a replacement ${change} does not reuse an old preparation promise`, async () => {
    const f = fixture({ count: 1 });
    const held = holdBlobRead(f.cards[0].blob);
    const oldOutcome = Promise.allSettled([f.sendFinish()]);
    await held.started;
    if (change === "room") f.senderState.roomId = "room-2";
    else f.senderState.channel = { ...f.channel, send(data) { f.wire.push(data); } };
    const newCard = card(6, { size: 32768 });
    const newOutcome = f.send(newCard);
    await turn();
    const newImageEnded = f.wire.some((data) => typeof data === "string" && JSON.parse(data).type === "strategy-image-end");
    const before = f.wire.length;
    held.release();
    await newOutcome;
    assert.equal((await oldOutcome)[0].status, "rejected");
    assert.equal(newImageEnded, true);
    assert.equal(f.wire.length, before, "old preparation must never send after the replacement transfer");
    await f.receive();
    assert.deepEqual(Buffer.from(await f.receiverState.remoteImages.get("finish:1:0").blob.arrayBuffer()), Buffer.from(await newCard.blob.arrayBuffer()));
  });
}

test("an old finish loop cannot pick up another room's second card", async () => {
  const f = fixture();
  const newState = makeState();
  newState.roomId = "room-2";
  const newWire = [];
  newState.channel = { ...f.channel, send(data) { newWire.push(data); } };
  newState.localFinishCards.set("1:1", card(7));
  f.hooks.beforeSend = (data) => {
    if (typeof data === "string" && JSON.parse(data).type === "strategy-image-end") f.sender.state = newState;
  };
  await assert.rejects(f.sendFinish());
  assert.equal(newWire.length, 0);
  assert.equal(newState.sentImageKeys.size, 0);
  assert.equal(f.wire.filter((data) => typeof data === "string" && JSON.parse(data).type === "strategy-image-start").length, 1);
});
