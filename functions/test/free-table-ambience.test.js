"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const modulePath = path.join(root, "free-table-ambience.mjs");
const ambienceModule = import(pathToFileURL(modulePath).href);

class FakeClock {
  constructor(now = 0) {
    this.now = now;
    this.nextId = 1;
    this.intervals = new Map();
  }

  setInterval = (callback, intervalMs) => {
    const id = this.nextId;
    this.nextId += 1;
    this.intervals.set(id, {
      callback,
      intervalMs,
      nextAt: this.now + intervalMs,
    });
    return id;
  };

  clearInterval = (id) => {
    this.intervals.delete(id);
  };

  advanceBy(durationMs) {
    const target = this.now + durationMs;
    while (true) {
      let nextId = null;
      let nextAt = Infinity;
      for (const [id, interval] of this.intervals) {
        if (interval.nextAt < nextAt) {
          nextId = id;
          nextAt = interval.nextAt;
        }
      }
      if (nextId === null || nextAt > target) break;
      this.now = nextAt;
      const interval = this.intervals.get(nextId);
      if (!interval) continue;
      interval.nextAt += interval.intervalMs;
      interval.callback();
    }
    this.now = target;
  }

  jumpBy(durationMs) {
    this.now += durationMs;
  }

  runIntervalsOnce() {
    for (const interval of [...this.intervals.values()]) {
      interval.nextAt = this.now + interval.intervalMs;
      interval.callback();
    }
  }
}

class FakeDocument {
  constructor() {
    this.hidden = false;
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  dispatch(type) {
    for (const callback of this.listeners.get(type) || []) callback();
  }
}

class FakeAudioParam {
  constructor() {
    this.value = 0;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ method: "setValueAtTime", value, time });
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ method: "linearRampToValueAtTime", value, time });
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ method: "exponentialRampToValueAtTime", value, time });
  }
}

class FakeGainNode {
  constructor() {
    this.gain = new FakeAudioParam();
    this.connections = [];
    this.disconnected = false;
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeOscillatorNode {
  constructor() {
    this.type = "";
    this.frequency = new FakeAudioParam();
    this.connections = [];
    this.starts = [];
    this.stops = [];
    this.onended = null;
    this.disconnected = false;
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnected = true;
  }

  start(time) {
    this.starts.push(time);
  }

  stop(time) {
    this.stops.push(time);
  }
}

function createAudioHarness(clock) {
  const contexts = [];

  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.destination = { type: "destination" };
      this.gains = [];
      this.oscillators = [];
      this.resumeCalls = 0;
      this.suspendCalls = 0;
      this.closeCalls = 0;
      this.rejectResume = false;
      contexts.push(this);
    }

    get currentTime() {
      return clock.now / 1000;
    }

    createGain() {
      const gain = new FakeGainNode();
      this.gains.push(gain);
      return gain;
    }

    createOscillator() {
      const oscillator = new FakeOscillatorNode();
      this.oscillators.push(oscillator);
      return oscillator;
    }

    resume() {
      this.resumeCalls += 1;
      if (this.rejectResume) return Promise.reject(new Error("resume blocked"));
      this.state = "running";
      return Promise.resolve();
    }

    suspend() {
      this.suspendCalls += 1;
      this.state = "suspended";
      return Promise.resolve();
    }

    close() {
      this.closeCalls += 1;
      this.state = "closed";
      return Promise.resolve();
    }
  }

  return { AudioContextClass: FakeAudioContext, contexts };
}

function snapshot(overrides = {}) {
  return {
    metronomeBpm: 60,
    lightingId: "moonlight",
    revision: 1,
    effectiveAt: 10_000,
    ...overrides,
  };
}

async function makeController({
  now = 0,
  hidden = false,
  initialVolume,
} = {}) {
  const {
    createFreeTableAmbienceController,
  } = await ambienceModule;
  const clock = new FakeClock(now);
  const audio = createAudioHarness(clock);
  const documentRef = new FakeDocument();
  documentRef.hidden = hidden;
  const controller = createFreeTableAmbienceController({
    AudioContextClass: audio.AudioContextClass,
    setIntervalFn: clock.setInterval,
    clearIntervalFn: clock.clearInterval,
    nowFn: () => clock.now,
    documentRef,
    lookaheadMs: 25,
    scheduleAheadMs: 100,
    ...(initialVolume === undefined ? {} : { initialVolume }),
  });
  return {
    controller,
    clock,
    contexts: audio.contexts,
    documentRef,
  };
}

function oscillatorStartTimes(context) {
  return context.oscillators.map((oscillator) => oscillator.starts[0]);
}

function roundedOscillatorStartTimes(context) {
  return oscillatorStartTimes(context).map((value) => Number(value.toFixed(6)));
}

test("setAmbience stays silent until explicit enable and schedules one constant tone per beat", async () => {
  const {
    FREE_TABLE_AMBIENCE_TONE_FREQUENCY_HZ,
  } = await ambienceModule;
  const {
    controller,
    clock,
    contexts,
  } = await makeController();

  assert.equal(controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 }), true);
  clock.advanceBy(500);
  assert.equal(contexts.length, 0);
  assert.equal(controller.getState().enabled, false);

  assert.equal(await controller.enable(), true);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumeCalls, 1);
  clock.advanceBy(2_600);

  assert.deepEqual(oscillatorStartTimes(contexts[0]), [1, 2, 3]);
  for (const oscillator of contexts[0].oscillators) {
    assert.equal(oscillator.type, "sine");
    assert.deepEqual(
      oscillator.frequency.events.map(({ method, value }) => ({ method, value })),
      [{ method: "setValueAtTime", value: FREE_TABLE_AMBIENCE_TONE_FREQUENCY_HZ }],
    );
  }
  const toneGainShapes = contexts[0].gains.slice(1).map((gain) => (
    gain.gain.events.map(({ method, value }) => ({ method, value }))
  ));
  assert.ok(toneGainShapes.length >= 3);
  for (const shape of toneGainShapes.slice(1)) assert.deepEqual(shape, toneGainShapes[0]);
});

test("an enabled controller follows a new BPM and realigns on its effectiveAt grid", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(1_200);
  assert.deepEqual(oscillatorStartTimes(contexts[0]), [1]);

  assert.equal(controller.setAmbience(snapshot({
    metronomeBpm: 120,
    revision: 2,
    effectiveAt: 11_000,
  }), { serverTimeOffset: 10_000 }), true);
  clock.advanceBy(1_400);

  assert.deepEqual(oscillatorStartTimes(contexts[0]), [1, 1.5, 2, 2.5]);
  assert.deepEqual(controller.getState(), {
    enabled: true,
    volume: 0.18,
    muted: false,
    metronomeBpm: 120,
    revision: 2,
    effectiveAt: 11_000,
    serverTimeOffset: 10_000,
    visibilitySuspended: false,
    recordingSuspended: false,
    destroyed: false,
  });
});

test("a future ambience keeps the old beat until one non-overlapping boundary cutover", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot({
    metronomeBpm: 120,
    effectiveAt: 10_000,
  }), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(100);

  assert.equal(controller.setAmbience(snapshot({
    metronomeBpm: 60,
    revision: 2,
    effectiveAt: 10_800,
  }), { serverTimeOffset: 10_000 }), true);
  clock.advanceBy(1_800);

  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [0.5, 0.8, 1.8]);
  const oldTone = contexts[0].oscillators.find(
    (oscillator) => Math.abs(oscillator.starts[0] - 0.5) < 0.000001,
  );
  const boundaryTone = contexts[0].oscillators.find(
    (oscillator) => Math.abs(oscillator.starts[0] - 0.8) < 0.000001,
  );
  assert.ok(oldTone.stops[0] <= boundaryTone.starts[0]);
  assert.equal(controller.getState().metronomeBpm, 60);
  assert.equal(controller.getState().revision, 2);
});

test("a lighting-only revision preserves the existing BPM grid across its future effectiveAt", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot({
    metronomeBpm: 60,
    lightingId: "moonlight",
    effectiveAt: 10_000,
  }), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(950);
  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [1]);

  controller.setAmbience(snapshot({
    metronomeBpm: 60,
    lightingId: "daylight",
    revision: 2,
    effectiveAt: 11_750,
  }), { serverTimeOffset: 10_000 });
  clock.advanceBy(1_100);

  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [1, 2]);
  assert.equal(controller.getState().revision, 2);
  assert.equal(controller.getState().effectiveAt, 11_750);
});

test("an identical ambience submitted as a new revision neither rephases nor duplicates tones", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot({
    metronomeBpm: 120,
    lightingId: "moonlight",
    effectiveAt: 10_000,
  }), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(450);
  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [0.5]);

  controller.setAmbience(snapshot({
    metronomeBpm: 120,
    lightingId: "moonlight",
    revision: 2,
    effectiveAt: 11_250,
  }), { serverTimeOffset: 10_000 });
  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [0.5]);
  clock.advanceBy(1_200);

  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [0.5, 1, 1.5]);
});

test("a late future snapshot truncates an in-flight old tone at the shared boundary, not on arrival", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot({
    metronomeBpm: 120,
    effectiveAt: 10_000,
  }), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(505);

  controller.setAmbience(snapshot({
    metronomeBpm: 60,
    revision: 2,
    effectiveAt: 10_520,
  }), { serverTimeOffset: 10_000 });
  clock.advanceBy(100);

  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [0.5, 0.52]);
  const oldTone = contexts[0].oscillators[0];
  const boundaryTone = contexts[0].oscillators[1];
  assert.equal(Number(oldTone.stops.at(-1).toFixed(6)), 0.52);
  assert.equal(Number(boundaryTone.starts[0].toFixed(6)), 0.52);
  assert.ok(oldTone.stops.at(-1) > 0.505);
});

test("a future BPM zero keeps the old beat until the boundary and retains opt-in silently", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot({
    metronomeBpm: 120,
    effectiveAt: 10_000,
  }), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(100);

  controller.setAmbience(snapshot({
    metronomeBpm: 0,
    revision: 2,
    effectiveAt: 10_800,
  }), { serverTimeOffset: 10_000 });
  clock.advanceBy(1_400);

  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [0.5]);
  assert.equal(controller.getState().metronomeBpm, 0);
  assert.equal(controller.getState().enabled, true);
  assert.equal(contexts[0].state, "running");
  assert.equal(clock.intervals.size, 0);
});

test("a throttled future cutover skips every missed old and new beat without a burst", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot({
    metronomeBpm: 120,
    effectiveAt: 10_000,
  }), { serverTimeOffset: 10_000 });
  await controller.enable();
  controller.setAmbience(snapshot({
    metronomeBpm: 60,
    revision: 2,
    effectiveAt: 10_800,
  }), { serverTimeOffset: 10_000 });

  clock.jumpBy(5_500);
  clock.runIntervalsOnce();
  assert.deepEqual(oscillatorStartTimes(contexts[0]), []);

  clock.advanceBy(400);
  assert.deepEqual(oscillatorStartTimes(contexts[0]), [5.8]);
});

test("BPM zero stops tones but keeps the local opt-in for a later valid room BPM", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(1_100);
  const scheduledBeforeZero = contexts[0].oscillators.length;

  controller.setAmbience(snapshot({
    metronomeBpm: 0,
    revision: 2,
    effectiveAt: 11_100,
  }), { serverTimeOffset: 10_000 });
  assert.equal(controller.getState().enabled, true);
  assert.equal(contexts[0].state, "running");
  clock.advanceBy(2_000);
  assert.equal(contexts[0].oscillators.length, scheduledBeforeZero);

  controller.setAmbience(snapshot({
    metronomeBpm: 60,
    revision: 3,
    effectiveAt: 13_100,
  }), { serverTimeOffset: 10_000 });
  await Promise.resolve();
  clock.advanceBy(1_000);
  assert.equal(controller.getState().enabled, true);
  assert.ok(contexts[0].oscillators.length > scheduledBeforeZero);
});

test("explicit opt-in at BPM zero unlocks audio and follows a later nonzero snapshot", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot({
    metronomeBpm: 0,
    effectiveAt: 10_000,
  }), { serverTimeOffset: 10_000 });

  assert.equal(contexts.length, 0);
  assert.equal(await controller.enable(), true);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumeCalls, 1);
  assert.equal(contexts[0].state, "running");
  assert.equal(contexts[0].oscillators.length, 0);

  controller.setAmbience(snapshot({
    metronomeBpm: 60,
    revision: 2,
    effectiveAt: 10_500,
  }), { serverTimeOffset: 10_000 });
  clock.advanceBy(1_600);

  assert.deepEqual(oscillatorStartTimes(contexts[0]), [0.5, 1.5]);
  assert.equal(controller.getState().enabled, true);
});

test("disable cancels lookahead tones and suspends the AudioContext", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(950);
  assert.equal(contexts[0].oscillators.length, 1);

  const scheduled = contexts[0].oscillators[0];
  controller.disable();
  assert.equal(controller.getState().enabled, false);
  assert.equal(clock.intervals.size, 0);
  assert.equal(contexts[0].state, "suspended");
  assert.ok(scheduled.stops.some((time) => time === 0.95));

  clock.advanceBy(3_000);
  assert.equal(contexts[0].oscillators.length, 1);
});

test("visibility and recording interruptions never restart without another enable", async () => {
  const {
    controller,
    clock,
    contexts,
    documentRef,
  } = await makeController();
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();

  documentRef.hidden = true;
  documentRef.dispatch("visibilitychange");
  assert.equal(controller.getState().enabled, false);
  assert.equal(controller.getState().visibilitySuspended, true);

  documentRef.hidden = false;
  documentRef.dispatch("visibilitychange");
  clock.advanceBy(2_000);
  assert.equal(contexts[0].oscillators.length, 0);
  assert.equal(controller.getState().visibilitySuspended, false);

  await controller.enable();
  controller.suspendForRecording();
  assert.equal(controller.getState().enabled, false);
  assert.equal(controller.getState().recordingSuspended, true);
  controller.resumeAfterRecording();
  clock.advanceBy(2_000);
  assert.equal(controller.getState().recordingSuspended, false);
  assert.equal(controller.getState().enabled, false);
  assert.equal(contexts[0].oscillators.length, 0);

  assert.equal(await controller.enable(), true);
});

test("destroy stops scheduling, closes audio, and makes later enable inert", async () => {
  const {
    controller,
    clock,
    contexts,
    documentRef,
  } = await makeController();
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(950);

  controller.destroy();
  assert.equal(controller.getState().destroyed, true);
  assert.equal(controller.getState().enabled, false);
  assert.equal(clock.intervals.size, 0);
  assert.equal(contexts[0].closeCalls, 1);
  assert.equal(documentRef.listeners.get("visibilitychange")?.size, 0);
  assert.equal(await controller.enable(), false);
});

test("stale or duplicate revisions are ignored before their payload can replace current ambience", async () => {
  const { controller } = await makeController();
  assert.equal(controller.setAmbience(snapshot({
    metronomeBpm: 80,
    revision: 5,
  }), { serverTimeOffset: 8_000 }), true);

  assert.equal(controller.setAmbience(snapshot({
    metronomeBpm: 39,
    revision: 4,
    effectiveAt: -1,
  }), { serverTimeOffset: Number.NaN }), false);
  assert.equal(controller.setAmbience(snapshot({
    metronomeBpm: 120,
    revision: 5,
  }), { serverTimeOffset: 9_000 }), false);
  assert.equal(controller.setAmbience(snapshot({
    metronomeBpm: 80,
    revision: 5,
    effectiveAt: 11_000,
  }), { serverTimeOffset: 9_000 }), false);
  assert.deepEqual(
    {
      metronomeBpm: controller.getState().metronomeBpm,
      revision: controller.getState().revision,
      effectiveAt: controller.getState().effectiveAt,
      serverTimeOffset: controller.getState().serverTimeOffset,
    },
    {
      metronomeBpm: 80,
      revision: 5,
      effectiveAt: 10_000,
      serverTimeOffset: 8_000,
    },
  );
});

test("the same canonical revision can update only its server-time offset and rephase", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  const sharedSnapshot = snapshot({
    metronomeBpm: 60,
    effectiveAt: 10_000,
  });
  controller.setAmbience(sharedSnapshot, { serverTimeOffset: 10_000 });
  await controller.enable();
  clock.advanceBy(200);

  assert.equal(controller.setAmbience(sharedSnapshot, { serverTimeOffset: 9_800 }), true);
  assert.equal(controller.getState().serverTimeOffset, 9_800);
  clock.advanceBy(1_100);

  assert.deepEqual(roundedOscillatorStartTimes(contexts[0]), [1.2]);
  assert.equal(controller.setAmbience(sharedSnapshot, { serverTimeOffset: 9_800 }), false);
});

test("an automatic resume failure turns the opt-in state off for frontend reconciliation", async () => {
  const {
    controller,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();
  controller.disable();
  assert.equal(controller.getState().enabled, false);

  // Re-enable successfully to restore opt-in, then simulate a browser lifecycle
  // suspension before the next canonical ambience arrives.
  await controller.enable();
  contexts[0].state = "suspended";
  contexts[0].rejectResume = true;
  assert.equal(controller.setAmbience(snapshot({
    metronomeBpm: 120,
    revision: 2,
    effectiveAt: 10_500,
  }), { serverTimeOffset: 10_000 }), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(controller.getState().enabled, false);
});

test("timer throttling skips missed beats instead of playing catch-up tones", async () => {
  const {
    controller,
    clock,
    contexts,
  } = await makeController();
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();

  clock.jumpBy(5_500);
  clock.runIntervalsOnce();
  assert.deepEqual(oscillatorStartTimes(contexts[0]), []);

  clock.advanceBy(400);
  assert.deepEqual(oscillatorStartTimes(contexts[0]), [6]);
});

test("volume and mute remain local, bounded, and do not alter shared ambience", async () => {
  const {
    controller,
    contexts,
  } = await makeController({ initialVolume: 0.25 });
  controller.setAmbience(snapshot(), { serverTimeOffset: 10_000 });
  await controller.enable();

  assert.equal(controller.setVolume(2), 1);
  assert.equal(controller.getState().volume, 1);
  assert.equal(contexts[0].gains[0].gain.value, 1);
  assert.equal(controller.setMuted(true), true);
  assert.equal(contexts[0].gains[0].gain.value, 0);
  assert.equal(controller.setVolume(-1), 0);
  assert.equal(controller.getState().metronomeBpm, 60);
  assert.equal(controller.setMuted(false), false);
  assert.equal(contexts[0].gains[0].gain.value, 0);
});

test("only BPM zero or integer BPM values from 40 through 160 are accepted", async () => {
  const { controller } = await makeController();
  assert.equal(controller.setAmbience(snapshot({ metronomeBpm: 0 })), true);
  assert.equal(controller.setAmbience(snapshot({ metronomeBpm: 40, revision: 2 })), true);
  assert.equal(controller.setAmbience(snapshot({ metronomeBpm: 160, revision: 3 })), true);
  assert.throws(
    () => controller.setAmbience(snapshot({ metronomeBpm: 39, revision: 4 })),
    /0または40〜160の整数BPM/,
  );
  assert.throws(
    () => controller.setAmbience(snapshot({ metronomeBpm: 80.5, revision: 5 })),
    /0または40〜160の整数BPM/,
  );
  assert.throws(
    () => controller.setAmbience(snapshot({ metronomeBpm: 161, revision: 6 })),
    /0または40〜160の整数BPM/,
  );
});
