export const FREE_TABLE_AMBIENCE_BPM_MIN = 40;
export const FREE_TABLE_AMBIENCE_BPM_MAX = 160;
export const FREE_TABLE_AMBIENCE_TONE_FREQUENCY_HZ = 440;
export const FREE_TABLE_AMBIENCE_TONE_DURATION_SECONDS = 0.04;
export const FREE_TABLE_AMBIENCE_LOOKAHEAD_MS = 25;
export const FREE_TABLE_AMBIENCE_SCHEDULE_AHEAD_MS = 120;

const DEFAULT_VOLUME = 0.18;
const MINIMUM_GAIN = 0.0001;
const ATTACK_SECONDS = 0.006;
const TIME_EPSILON_MS = 0.001;

function validatedRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("自由卓の空気設定revisionが不正です。");
  }
  return revision;
}

function validatedMetronomeBpm(value) {
  const bpm = Number(value);
  const valid = bpm === 0 || (
    Number.isInteger(bpm)
    && bpm >= FREE_TABLE_AMBIENCE_BPM_MIN
    && bpm <= FREE_TABLE_AMBIENCE_BPM_MAX
  );
  if (!valid) throw new RangeError("自由卓の部屋の呼吸は0または40〜160の整数BPMで指定してください。");
  return bpm;
}

function validatedEffectiveAt(value) {
  const effectiveAt = Number(value);
  if (!Number.isFinite(effectiveAt) || effectiveAt < 0) {
    throw new TypeError("自由卓の空気設定effectiveAtが不正です。");
  }
  return effectiveAt;
}

function validatedServerTimeOffset(value) {
  const serverTimeOffset = Number(value);
  if (!Number.isFinite(serverTimeOffset)) {
    throw new TypeError("自由卓のサーバー時刻補正値が不正です。");
  }
  return serverTimeOffset;
}

function nextBeatAfter(serverNow, effectiveAt, intervalMs) {
  if (serverNow < effectiveAt) return effectiveAt;
  const elapsed = serverNow - effectiveAt;
  return effectiveAt + ((Math.floor(elapsed / intervalMs) + 1) * intervalMs);
}

function ignoreRejectedPromise(value) {
  if (value && typeof value.catch === "function") value.catch(() => {});
}

/**
 * Creates the local Web Audio controller for a free-table room's shared ambience.
 *
 * Calling setAmbience never starts audio. Audio is created and resumed only after
 * the local player explicitly calls enable(). Shared snapshots control timing,
 * while volume and mute stay local to this controller.
 */
export function createFreeTableAmbienceController({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  setIntervalFn = globalThis.setInterval?.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
  nowFn = () => Date.now(),
  documentRef = globalThis.document,
  lookaheadMs = FREE_TABLE_AMBIENCE_LOOKAHEAD_MS,
  scheduleAheadMs = FREE_TABLE_AMBIENCE_SCHEDULE_AHEAD_MS,
  initialVolume = DEFAULT_VOLUME,
} = {}) {
  if (typeof setIntervalFn !== "function" || typeof clearIntervalFn !== "function") {
    throw new TypeError("自由卓の部屋の呼吸に使うtimerがありません。");
  }
  if (typeof nowFn !== "function") throw new TypeError("自由卓の部屋の呼吸に使う時計がありません。");
  if (!Number.isFinite(lookaheadMs) || lookaheadMs <= 0) {
    throw new RangeError("自由卓のlookahead間隔が不正です。");
  }
  if (!Number.isFinite(scheduleAheadMs) || scheduleAheadMs <= 0) {
    throw new RangeError("自由卓の先読み時間が不正です。");
  }

  let metronomeBpm = 0;
  let revision = null;
  let effectiveAt = 0;
  let lightingIdentity = null;
  let updatedAtIdentity = null;
  let serverTimeOffset = 0;
  let enabled = false;
  let muted = false;
  let volume = Math.min(1, Math.max(0, Number(initialVolume) || 0));
  let visibilitySuspended = Boolean(documentRef?.hidden);
  let recordingSuspended = false;
  let destroyed = false;

  let audioContext = null;
  let masterGain = null;
  let schedulerId = null;
  let activeAmbience = null;
  let pendingAmbience = null;
  let activeNextBeatServerTime = null;
  let pendingNextBeatServerTime = null;
  let activationRevision = 0;
  const scheduledVoices = new Set();

  function getState() {
    return {
      enabled,
      volume,
      muted,
      metronomeBpm,
      revision,
      effectiveAt,
      serverTimeOffset,
      visibilitySuspended,
      recordingSuspended,
      destroyed,
    };
  }

  function setAudioParamValue(parameter, value, atTime) {
    if (!parameter) return;
    if (typeof parameter.setValueAtTime === "function") parameter.setValueAtTime(value, atTime);
    else parameter.value = value;
  }

  function applyLocalVolume() {
    if (!masterGain || !audioContext) return;
    setAudioParamValue(masterGain.gain, muted ? 0 : volume, audioContext.currentTime);
  }

  function ensureAudioContext() {
    if (audioContext) return audioContext;
    if (typeof AudioContextClass !== "function") return null;
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    applyLocalVolume();
    masterGain.connect(audioContext.destination);
    return audioContext;
  }

  function clearScheduler() {
    if (schedulerId !== null) {
      clearIntervalFn(schedulerId);
      schedulerId = null;
    }
    activeNextBeatServerTime = null;
    pendingNextBeatServerTime = null;
  }

  function releaseVoice(voice) {
    if (!scheduledVoices.delete(voice)) return;
    voice.oscillator.onended = null;
    try {
      voice.oscillator.disconnect();
    } catch {
      // The node may already have been disconnected by the browser.
    }
    try {
      voice.gain.disconnect();
    } catch {
      // The node may already have been disconnected by the browser.
    }
  }

  function stopScheduledVoice(voice) {
    voice.oscillator.onended = null;
    try {
      voice.oscillator.stop(audioContext?.currentTime);
    } catch {
      // A voice that has already ended needs no further cleanup.
    }
    releaseVoice(voice);
  }

  function stopScheduledVoices(predicate = () => true) {
    for (const voice of [...scheduledVoices]) {
      if (predicate(voice)) stopScheduledVoice(voice);
    }
  }

  function truncateScheduledVoice(voice, stopAtServerTime, serverNow) {
    if (!audioContext || stopAtServerTime <= serverNow + TIME_EPSILON_MS) {
      stopScheduledVoice(voice);
      return;
    }
    const stopTime = audioContext.currentTime + ((stopAtServerTime - serverNow) / 1000);
    try {
      voice.gain.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, stopTime);
      voice.oscillator.stop(stopTime);
      voice.stopServerTime = stopAtServerTime;
    } catch {
      stopScheduledVoice(voice);
    }
  }

  function stopScheduling() {
    activationRevision += 1;
    clearScheduler();
    stopScheduledVoices();
  }

  function suspendAudioContext() {
    if (!audioContext || audioContext.state === "closed" || typeof audioContext.suspend !== "function") return;
    try {
      ignoreRejectedPromise(audioContext.suspend());
    } catch {
      // Suspending is best-effort after a lifecycle interruption.
    }
  }

  function scheduleTone(startServerTime, serverNow, ambience, stopAtServerTime = Infinity) {
    if (!audioContext || !masterGain) return;
    const maximumDurationSeconds = Number.isFinite(stopAtServerTime)
      ? Math.max(0, (stopAtServerTime - startServerTime) / 1000)
      : FREE_TABLE_AMBIENCE_TONE_DURATION_SECONDS;
    const durationSeconds = Math.min(
      FREE_TABLE_AMBIENCE_TONE_DURATION_SECONDS,
      maximumDurationSeconds,
    );
    if (durationSeconds <= TIME_EPSILON_MS / 1000) return;
    const startTime = audioContext.currentTime
      + Math.max(0, (startServerTime - serverNow) / 1000);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const stopTime = startTime + durationSeconds;
    const attackSeconds = Math.min(ATTACK_SECONDS, durationSeconds / 2);
    const voice = {
      oscillator,
      gain,
      revision: ambience.revision,
      startServerTime,
      stopServerTime: startServerTime + (durationSeconds * 1000),
    };

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(FREE_TABLE_AMBIENCE_TONE_FREQUENCY_HZ, startTime);
    gain.gain.setValueAtTime(MINIMUM_GAIN, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + attackSeconds);
    gain.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, stopTime);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.onended = () => releaseVoice(voice);
    scheduledVoices.add(voice);
    oscillator.start(startTime);
    oscillator.stop(stopTime);
  }

  function currentServerNow() {
    const localNow = Number(nowFn());
    if (!Number.isFinite(localNow)) return null;
    return localNow + serverTimeOffset;
  }

  function hasSchedulerWork() {
    return Boolean(
      activeAmbience?.metronomeBpm
      || pendingAmbience?.metronomeBpm,
    );
  }

  function promotePendingAmbience(serverNow) {
    if (
      !pendingAmbience
      || serverNow + TIME_EPSILON_MS < pendingAmbience.effectiveAt
    ) {
      return false;
    }
    const next = pendingAmbience;
    stopScheduledVoices((voice) => (
      voice.revision !== next.revision
      && voice.stopServerTime > next.effectiveAt + TIME_EPSILON_MS
    ));
    activeAmbience = next;
    pendingAmbience = null;
    activeNextBeatServerTime = pendingNextBeatServerTime;
    pendingNextBeatServerTime = null;
    return true;
  }

  function scheduleAmbienceGrid(
    ambience,
    nextBeatServerTime,
    serverNow,
    scheduleThrough,
    stopAtServerTime = Infinity,
  ) {
    if (!ambience?.metronomeBpm) return nextBeatServerTime;
    const intervalMs = 60_000 / ambience.metronomeBpm;
    let nextBeat = nextBeatServerTime;
    if (
      nextBeat === null
      || nextBeat <= serverNow + TIME_EPSILON_MS
    ) {
      nextBeat = nextBeatAfter(serverNow, ambience.effectiveAt, intervalMs);
    }
    while (
      nextBeat <= scheduleThrough + TIME_EPSILON_MS
      && nextBeat < stopAtServerTime - TIME_EPSILON_MS
    ) {
      scheduleTone(nextBeat, serverNow, ambience, stopAtServerTime);
      nextBeat += intervalMs;
    }
    return nextBeat;
  }

  function scheduleLookahead() {
    if (
      !enabled
      || destroyed
      || visibilitySuspended
      || recordingSuspended
      || !audioContext
      || audioContext.state !== "running"
    ) {
      return;
    }

    const serverNow = currentServerNow();
    if (serverNow === null) return;
    promotePendingAmbience(serverNow);
    if (!hasSchedulerWork()) {
      clearScheduler();
      return;
    }
    const scheduleThrough = serverNow + scheduleAheadMs;
    const cutoverAt = pendingAmbience?.effectiveAt ?? Infinity;
    activeNextBeatServerTime = scheduleAmbienceGrid(
      activeAmbience,
      activeNextBeatServerTime,
      serverNow,
      scheduleThrough,
      cutoverAt,
    );
    if (pendingAmbience && pendingAmbience.effectiveAt <= scheduleThrough + TIME_EPSILON_MS) {
      pendingNextBeatServerTime = scheduleAmbienceGrid(
        pendingAmbience,
        pendingNextBeatServerTime,
        serverNow,
        scheduleThrough,
      );
    }
  }

  function beginScheduler() {
    if (schedulerId !== null) return;
    scheduleLookahead();
    if (enabled && hasSchedulerWork() && schedulerId === null) {
      schedulerId = setIntervalFn(scheduleLookahead, lookaheadMs);
    }
  }

  function requestActivation() {
    const activation = ++activationRevision;
    const context = ensureAudioContext();
    if (!context) {
      enabled = false;
      return Promise.resolve(false);
    }

    const beginIfCurrent = () => {
      if (
        activation !== activationRevision
        || !enabled
        || destroyed
        || visibilitySuspended
        || recordingSuspended
      ) {
        return false;
      }
      if (hasSchedulerWork()) beginScheduler();
      return true;
    };

    const activationFailed = () => {
      if (activation === activationRevision) {
        enabled = false;
        stopScheduling();
      }
      return false;
    };

    if (context.state === "closed") return Promise.resolve(activationFailed());
    if (context.state !== "running" && typeof context.resume === "function") {
      try {
        return Promise.resolve(context.resume()).then(
          beginIfCurrent,
          activationFailed,
        );
      } catch {
        return Promise.resolve(activationFailed());
      }
    }
    return Promise.resolve(beginIfCurrent());
  }

  function restartForCurrentAmbience() {
    stopScheduling();
    if (!enabled || destroyed || visibilitySuspended || recordingSuspended) return;
    ignoreRejectedPromise(requestActivation());
  }

  function continueCurrentCadence() {
    if (!enabled || destroyed || visibilitySuspended || recordingSuspended) return;
    if (!audioContext || audioContext.state !== "running") {
      ignoreRejectedPromise(requestActivation());
      return;
    }
    if (!hasSchedulerWork()) return;
    beginScheduler();
    scheduleLookahead();
  }

  function normalizedLightingIdentity(value) {
    return value == null ? null : String(value);
  }

  function normalizedUpdatedAtIdentity(value) {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }

  function sameCanonicalAmbience(snapshot) {
    return Number(snapshot?.metronomeBpm) === metronomeBpm
      && Number(snapshot?.effectiveAt) === effectiveAt
      && normalizedLightingIdentity(snapshot?.lightingId) === lightingIdentity
      && normalizedUpdatedAtIdentity(snapshot?.updatedAt) === updatedAtIdentity;
  }

  function installFutureAmbience(nextAmbience, serverNow) {
    const previousPendingRevision = pendingAmbience?.revision ?? null;
    for (const voice of [...scheduledVoices]) {
      if (previousPendingRevision !== null && voice.revision === previousPendingRevision) {
        stopScheduledVoice(voice);
        continue;
      }
      if (voice.revision !== activeAmbience?.revision) continue;
      if (voice.startServerTime >= nextAmbience.effectiveAt - TIME_EPSILON_MS) {
        stopScheduledVoice(voice);
      } else if (voice.stopServerTime > nextAmbience.effectiveAt + TIME_EPSILON_MS) {
        truncateScheduledVoice(voice, nextAmbience.effectiveAt, serverNow);
      }
    }
    pendingAmbience = nextAmbience;
    pendingNextBeatServerTime = null;
    if (!enabled || destroyed || visibilitySuspended || recordingSuspended) return;
    if (!audioContext || audioContext.state !== "running") {
      ignoreRejectedPromise(requestActivation());
      return;
    }
    beginScheduler();
    scheduleLookahead();
  }

  function setAmbience(snapshot, {
    serverTimeOffset: nextServerTimeOffset = serverTimeOffset,
  } = {}) {
    const nextRevision = validatedRevision(snapshot?.revision);
    if (revision !== null && nextRevision < revision) return false;
    if (revision !== null && nextRevision === revision) {
      if (!sameCanonicalAmbience(snapshot)) return false;
      const normalizedServerTimeOffset = validatedServerTimeOffset(nextServerTimeOffset);
      if (normalizedServerTimeOffset === serverTimeOffset) return false;
      serverTimeOffset = normalizedServerTimeOffset;
      const serverNow = currentServerNow();
      if (serverNow !== null) promotePendingAmbience(serverNow);
      restartForCurrentAmbience();
      return true;
    }

    const nextMetronomeBpm = validatedMetronomeBpm(snapshot?.metronomeBpm);
    const nextEffectiveAt = validatedEffectiveAt(snapshot?.effectiveAt);
    const normalizedServerTimeOffset = validatedServerTimeOffset(nextServerTimeOffset);
    const hadCanonicalAmbience = revision !== null;
    const previousMetronomeBpm = metronomeBpm;
    const serverTimeOffsetChanged = normalizedServerTimeOffset !== serverTimeOffset;
    const nextAmbience = {
      metronomeBpm: nextMetronomeBpm,
      revision: nextRevision,
      effectiveAt: nextEffectiveAt,
    };

    metronomeBpm = nextMetronomeBpm;
    revision = nextRevision;
    effectiveAt = nextEffectiveAt;
    lightingIdentity = normalizedLightingIdentity(snapshot?.lightingId);
    updatedAtIdentity = normalizedUpdatedAtIdentity(snapshot?.updatedAt);
    serverTimeOffset = normalizedServerTimeOffset;
    if (hadCanonicalAmbience && nextMetronomeBpm === previousMetronomeBpm) {
      if (serverTimeOffsetChanged) restartForCurrentAmbience();
      else continueCurrentCadence();
      return true;
    }
    const serverNow = currentServerNow();
    if (
      activeAmbience
      && serverNow !== null
      && nextEffectiveAt > serverNow + TIME_EPSILON_MS
    ) {
      installFutureAmbience(nextAmbience, serverNow);
      return true;
    }
    activeAmbience = nextAmbience;
    pendingAmbience = null;
    restartForCurrentAmbience();
    return true;
  }

  async function enable() {
    if (destroyed || visibilitySuspended || recordingSuspended) return false;
    if (enabled) return true;
    enabled = true;
    const serverNow = currentServerNow();
    if (serverNow !== null) promotePendingAmbience(serverNow);
    // Even at BPM 0, resume the context inside this explicit user gesture.
    // Keeping the unlocked context running silently lets a later room BPM
    // follow automatically without a second autoplay-gated gesture.
    return requestActivation();
  }

  function disable() {
    enabled = false;
    stopScheduling();
    suspendAudioContext();
  }

  function setVolume(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new TypeError("自由卓の音量が不正です。");
    volume = Math.min(1, Math.max(0, numeric));
    applyLocalVolume();
    return volume;
  }

  function setMuted(value) {
    muted = Boolean(value);
    applyLocalVolume();
    return muted;
  }

  function suspendForVisibility(hidden = true) {
    visibilitySuspended = Boolean(hidden);
    if (visibilitySuspended) disable();
  }

  function suspendForRecording() {
    recordingSuspended = true;
    disable();
  }

  function resumeAfterRecording() {
    recordingSuspended = false;
    // Lifecycle recovery never opts the player back into audio.
  }

  function handleVisibilityChange() {
    suspendForVisibility(Boolean(documentRef?.hidden));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    enabled = false;
    stopScheduling();
    suspendAudioContext();
    documentRef?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    try {
      masterGain?.disconnect();
    } catch {
      // The output node may already have been disconnected.
    }
    if (audioContext && audioContext.state !== "closed" && typeof audioContext.close === "function") {
      try {
        ignoreRejectedPromise(audioContext.close());
      } catch {
        // The controller is already inert even if closing fails.
      }
    }
  }

  documentRef?.addEventListener?.("visibilitychange", handleVisibilityChange);

  return Object.freeze({
    setAmbience,
    enable,
    disable,
    setVolume,
    setMuted,
    suspendForVisibility,
    suspendForRecording,
    resumeAfterRecording,
    destroy,
    getState,
  });
}
