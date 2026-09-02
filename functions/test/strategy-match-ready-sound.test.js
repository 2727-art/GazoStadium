"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const audioSource = read("audio.js");
const strategySource = read("strategy.js");
const indexHtml = read("index.html");

function namedFunction(source, name) {
  const markers = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
  const markerIndex = markers.findIndex((match) => match[1] === name);
  assert.ok(markerIndex >= 0, `function is available: ${name}`);
  return source.slice(markers[markerIndex].index, markers[markerIndex + 1]?.index ?? source.length);
}

function loadAudio({ storedEnabled = null, supported = true } = {}) {
  const oscillators = [];
  const gains = [];
  let contextCount = 0;
  let bufferCount = 0;

  class FakeAudioContext {
    constructor() {
      contextCount += 1;
      this.currentTime = 12;
      this.sampleRate = 48_000;
      this.state = "running";
      this.destination = {};
    }

    createGain() {
      const record = { events: [] };
      const node = {
        gain: {
          value: 0,
          setValueAtTime(value, time) {
            record.events.push({ method: "set", value, time });
          },
          exponentialRampToValueAtTime(value, time) {
            record.events.push({ method: "ramp", value, time });
          },
        },
        connect() {},
      };
      gains.push(record);
      return node;
    }

    createOscillator() {
      const record = { frequency: 0, start: null, stop: null, node: null };
      const node = {
        type: "sine",
        frequency: {
          setValueAtTime(value) { record.frequency = value; },
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        start(time) { record.start = time; },
        stop(time) { record.stop = time; },
      };
      record.node = node;
      oscillators.push(record);
      return node;
    }

    createBuffer() {
      bufferCount += 1;
      return { getChannelData: () => new Float32Array(1) };
    }

    createBufferSource() {
      return { connect() {}, start() {} };
    }

    createBiquadFilter() {
      return { type: "", frequency: { value: 0 }, connect() {} };
    }

    resume() {
      this.state = "running";
      return Promise.resolve();
    }
  }

  const stored = new Map();
  if (storedEnabled !== null) {
    stored.set("hariai-stadium-sound-enabled-v1", String(storedEnabled));
  }
  const window = {};
  if (supported) window.AudioContext = FakeAudioContext;
  const context = vm.createContext({
    window,
    document: {
      readyState: "complete",
      addEventListener() {},
      querySelector() { return null; },
    },
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, String(value)); },
    },
  });
  vm.runInContext(audioSource, context);
  return {
    api: window.HariaiAudio,
    oscillators,
    gains,
    contextCount: () => contextCount,
    bufferCount: () => bufferCount,
  };
}

test("match-ready audio is a short, gentle two-tone cue", () => {
  const harness = loadAudio();

  assert.equal(typeof harness.api.playMatchReady, "function");
  harness.api.playMatchReady();

  assert.equal(harness.contextCount(), 1);
  assert.equal(harness.oscillators.length, 2, "the cue must stay to two tones");
  assert.equal(harness.bufferCount(), 0, "the lightweight cue must not add a noise burst");
  assert.ok(
    harness.oscillators[0].frequency < harness.oscillators[1].frequency,
    "the ready cue should rise instead of sounding like an error",
  );
  for (const oscillator of harness.oscillators) {
    assert.ok(["sine", "triangle"].includes(oscillator.node.type), "the cue uses a gentle waveform");
    assert.ok(oscillator.start >= 12);
    assert.ok(oscillator.stop > oscillator.start);
    assert.ok(oscillator.stop <= 12.6, "the ready cue finishes promptly");
  }

  const toneGains = harness.gains.filter((gain) => gain.events.length > 0);
  assert.equal(toneGains.length, 2);
  for (const gain of toneGains) {
    const peak = Math.max(...gain.events.map((event) => Number(event.value) || 0));
    assert.ok(peak <= 0.08, `ready cue peak ${peak} must remain gentle`);
  }
});

test("match-ready audio honors the shared SE switch and unsupported browsers stay silent", () => {
  const disabled = loadAudio({ storedEnabled: false });
  assert.equal(disabled.api.isEnabled(), false);
  assert.doesNotThrow(() => disabled.api.playMatchReady());
  assert.equal(disabled.contextCount(), 0);
  assert.equal(disabled.oscillators.length, 0);

  const unsupported = loadAudio({ supported: false });
  assert.equal(typeof unsupported.api.playMatchReady, "function");
  assert.doesNotThrow(() => unsupported.api.playMatchReady());
  assert.equal(unsupported.contextCount(), 0);
  assert.equal(unsupported.oscillators.length, 0);
});

test("Strategy emits the match-ready cue once per validated room before P2P setup", () => {
  assert.match(strategySource, /matchReadySoundRoomId:\s*""/u);
  const notify = namedFunction(strategySource, "playStrategyMatchReadySound");
  const createOffer = namedFunction(strategySource, "createOffer");
  const acceptOffer = namedFunction(strategySource, "acceptOffer");
  const enterRoom = namedFunction(strategySource, "enterRoom");
  const validation = enterRoom.indexOf("if (!room || Number(room.protocolVersion) !== STRATEGY_PROTOCOL_VERSION");
  const notification = enterRoom.indexOf("playStrategyMatchReadySound(roomId)");
  const peerSetup = enterRoom.indexOf("await setupPeerConnection()");

  assert.ok(validation >= 0, "enterRoom validates both player records");
  assert.match(enterRoom, /!room\.players\?\.\[room\.hostUid\] \|\| !room\.players\?\.\[room\.guestUid\]/u);
  assert.ok(validation < notification, "invalid or incomplete rooms cannot emit the cue");
  assert.ok(notification < peerSetup, "P2P delay or failure cannot gate the match notification");
  assert.match(enterRoom, /generation\s*=\s*state\.matchmakingGeneration/u);
  assert.ok(
    (enterRoom.match(/isCurrentStrategyMatchmakingGeneration\(generation\)/gu) || []).length >= 2,
    "cancellation or a newer search must invalidate entry before and after the room read",
  );
  assert.match(createOffer, /await enterRoom\(roomId, generation\);/u);
  assert.match(acceptOffer, /await enterRoom\(roomId, generation\);/u);
  assert.equal(
    (strategySource.match(/\bplayStrategyMatchReadySound\(/gu) || []).length,
    2,
    "the helper has exactly one production call site",
  );

  let playCount = 0;
  const context = vm.createContext({
    state: { matchReadySoundRoomId: "" },
    window: { HariaiAudio: { playMatchReady() { playCount += 1; } } },
  });
  vm.runInContext(`${notify}\nglobalThis.playStrategyMatchReadySoundForTest = playStrategyMatchReadySound;`, context);
  context.playStrategyMatchReadySoundForTest("room-one");
  context.playStrategyMatchReadySoundForTest("room-one");
  assert.equal(playCount, 1, "repeated callbacks for one room cannot replay the cue");
  assert.equal(context.state.matchReadySoundRoomId, "room-one");

  context.playStrategyMatchReadySoundForTest("room-two");
  assert.equal(playCount, 2, "a different room gets its own cue");
  assert.equal(context.state.matchReadySoundRoomId, "room-two");
});

test("opening the Strategy data channel does not replay the match-ready cue", () => {
  const configureDataChannel = namedFunction(strategySource, "configureDataChannel");
  assert.match(configureDataChannel, /channel\.onopen\s*=\s*\(\)\s*=>/u);
  assert.doesNotMatch(configureDataChannel, /playMatchReady|playStrategyMatchReadySound/u);
});

test("the matching screen explains that the match cue uses the shared SE switch", () => {
  const matching = namedFunction(strategySource, "renderMatching");
  assert.match(matching, /SE ONなら、マッチ成立時に短い準備完了音が1度鳴ります。/u);
  assert.doesNotMatch(strategySource, /matchReadySoundEnabled|strategy-match-ready-sound-enabled/iu);
  assert.match(audioSource, /const STORAGE_KEY = "hariai-stadium-sound-enabled-v1";/u);
});

test("audio and Strategy browser assets share the match-ready cache marker", () => {
  const marker = "strategy-match-ready-sound-v1";
  assert.match(
    indexHtml,
    new RegExp(`<script src="audio\\.js\\?v=[^"]*${marker}[^"]*" defer></script>`),
  );
  assert.match(
    indexHtml,
    new RegExp(`<script type="module" src="strategy\\.js\\?v=[^"]*${marker}[^"]*"></script>`),
  );
  assert.equal((indexHtml.match(new RegExp(marker, "g")) || []).length, 2);
  assert.doesNotMatch(indexHtml, /<script src="audio\.js" defer><\/script>/u);
});
