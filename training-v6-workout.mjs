export const TRAINING_V6_WORKOUT_SECONDS = 60;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function trainingV6WorkoutProgress({
  startedAt,
  endsAt,
  now,
} = {}) {
  const start = Number(startedAt);
  const end = Number(endsAt);
  const current = Number(now);
  if (!Number.isFinite(start)
      || !Number.isFinite(end)
      || !Number.isFinite(current)
      || end <= start) {
    return Object.freeze({
      valid: false,
      elapsedMs: 0,
      remainingMs: 60_000,
      progress: 0,
      complete: false,
    });
  }
  const elapsedMs = clamp(current - start, 0, end - start);
  const remainingMs = clamp(end - current, 0, end - start);
  return Object.freeze({
    valid: true,
    elapsedMs,
    remainingMs,
    progress: elapsedMs / (end - start),
    complete: current >= end,
  });
}

export function createTrainingV6WorkoutClock({
  now = () => Date.now(),
  onTick = () => {},
  intervalMs = 200,
} = {}) {
  let timer = null;
  let workout = null;

  const tick = () => {
    if (!workout) return;
    onTick(trainingV6WorkoutProgress({
      ...workout,
      now: now(),
    }));
  };

  const stop = () => {
    if (timer != null) globalThis.clearInterval(timer);
    timer = null;
    workout = null;
  };

  const start = ({ startedAt, endsAt } = {}) => {
    stop();
    workout = {
      startedAt: Number(startedAt),
      endsAt: Number(endsAt),
    };
    tick();
    timer = globalThis.setInterval(tick, Math.max(100, Number(intervalMs) || 200));
  };

  return Object.freeze({
    start,
    stop,
    tick,
    isRunning: () => timer != null,
  });
}

export function createTrainingV6WakeLockController({
  wakeLock = globalThis.navigator?.wakeLock,
  documentObject = globalThis.document,
  onError = () => {},
} = {}) {
  let requested = false;
  let sentinel = null;

  const release = async () => {
    requested = false;
    const current = sentinel;
    sentinel = null;
    if (current) {
      try {
        await current.release();
      } catch (error) {
        onError(error);
      }
    }
  };

  const acquire = async () => {
    requested = true;
    if (!wakeLock?.request
        || documentObject?.visibilityState === "hidden"
        || sentinel) return false;
    try {
      const next = await wakeLock.request("screen");
      if (!requested) {
        await next.release().catch(() => {});
        return false;
      }
      sentinel = next;
      next.addEventListener?.("release", () => {
        if (sentinel === next) sentinel = null;
      }, { once: true });
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  };

  const handleVisibility = () => {
    if (!requested) return;
    if (documentObject?.visibilityState === "visible") acquire();
  };
  documentObject?.addEventListener?.("visibilitychange", handleVisibility);

  const destroy = async () => {
    documentObject?.removeEventListener?.("visibilitychange", handleVisibility);
    await release();
  };

  return Object.freeze({
    acquire,
    release,
    destroy,
    isHeld: () => Boolean(sentinel),
  });
}

export function createTrainingV6Metronome({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  onError = () => {},
} = {}) {
  let context = null;
  let timer = null;
  let bpm = 0;
  let beatsPerRep = 4;
  let volume = 0.28;
  let beatIndex = 0;
  let nextBeatAt = 0;

  const ensureContext = async () => {
    if (!AudioContextClass) return null;
    if (!context) context = new AudioContextClass();
    if (context.state === "suspended") await context.resume();
    return context;
  };

  const scheduleClick = (when, accent) => {
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 1_020 : 760, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, volume * (accent ? 1 : 0.72)),
      when + 0.004,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.055);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(when);
    oscillator.stop(when + 0.06);
  };

  const schedule = () => {
    if (!context || !timer || bpm < 40) return;
    const interval = 60 / bpm;
    while (nextBeatAt < context.currentTime + 0.12) {
      scheduleClick(nextBeatAt, beatIndex % beatsPerRep === 0);
      beatIndex += 1;
      nextBeatAt += interval;
    }
  };

  const stop = () => {
    if (timer != null) globalThis.clearInterval(timer);
    timer = null;
    beatIndex = 0;
  };

  const start = async (nextBpm, nextBeatsPerRep = 4) => {
    stop();
    const numericBpm = Number(nextBpm);
    if (!Number.isInteger(numericBpm) || numericBpm < 40 || numericBpm > 160) {
      throw new TypeError("BPMは40〜160で指定してください。");
    }
    const numericBeatsPerRep = Number(nextBeatsPerRep);
    if (![2, 4, 8].includes(numericBeatsPerRep)) {
      throw new TypeError("1回の拍数は2・4・8拍で指定してください。");
    }
    bpm = numericBpm;
    beatsPerRep = numericBeatsPerRep;
    try {
      await ensureContext();
      if (!context) return false;
      nextBeatAt = context.currentTime + 0.05;
      timer = globalThis.setInterval(schedule, 25);
      schedule();
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  };

  const setVolume = (nextVolume) => {
    volume = clamp(Number(nextVolume) || 0, 0, 0.8);
  };

  const destroy = async () => {
    stop();
    const current = context;
    context = null;
    if (current && current.state !== "closed") {
      await current.close().catch(onError);
    }
  };

  return Object.freeze({
    start,
    stop,
    destroy,
    setVolume,
    isRunning: () => timer != null,
  });
}
