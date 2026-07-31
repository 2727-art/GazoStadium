export const FREE_TABLE_AMBIENCE_BPM_MIN = 40;
export const FREE_TABLE_AMBIENCE_BPM_MAX = 160;
export const FREE_TABLE_AMBIENCE_TONE_FREQUENCY_HZ = 440;
export const FREE_TABLE_AMBIENCE_TONE_DURATION_SECONDS = 0.04;
export const FREE_TABLE_AMBIENCE_LOOKAHEAD_MS = 25;
export const FREE_TABLE_AMBIENCE_SCHEDULE_AHEAD_MS = 120;
export const FREE_TABLE_AMBIENCE_DEFAULT_TONE_PROFILE_ID = "clear_tap";

const DEFAULT_VOLUME = 0.18;
const MINIMUM_GAIN = 0.0001;
const ATTACK_SECONDS = 0.006;
const TIME_EPSILON_MS = 0.001;

function frozenToneProfile({
  id,
  oscillatorType,
  frequencyHz,
  durationSeconds,
  attackSeconds,
  peakGain,
}) {
  return Object.freeze({
    id,
    oscillatorType,
    frequencyHz,
    durationSeconds,
    attackSeconds,
    peakGain,
  });
}

/**
 * Fixed, synthesis-only profiles. The default profile intentionally preserves
 * the original 440 Hz / 40 ms sine click exactly. The remaining profiles keep
 * frequencies, envelopes, and peak gain deliberately conservative so a caller
 * can offer timbral choice without accepting arbitrary audio parameters.
 */
export const FREE_TABLE_AMBIENCE_TONE_PROFILES = Object.freeze({
  heavy_pulse: frozenToneProfile({
    id: "heavy_pulse",
    oscillatorType: "triangle",
    frequencyHz: 220,
    durationSeconds: 0.052,
    attackSeconds: 0.008,
    peakGain: 1,
  }),
  soft_bell: frozenToneProfile({
    id: "soft_bell",
    oscillatorType: "sine",
    frequencyHz: 330,
    durationSeconds: 0.052,
    attackSeconds: 0.008,
    peakGain: 0.88,
  }),
  clear_tap: frozenToneProfile({
    id: "clear_tap",
    oscillatorType: "sine",
    frequencyHz: FREE_TABLE_AMBIENCE_TONE_FREQUENCY_HZ,
    durationSeconds: FREE_TABLE_AMBIENCE_TONE_DURATION_SECONDS,
    attackSeconds: ATTACK_SECONDS,
    peakGain: 1,
  }),
  glass_spark: frozenToneProfile({
    id: "glass_spark",
    oscillatorType: "sine",
    frequencyHz: 660,
    durationSeconds: 0.026,
    attackSeconds: 0.004,
    peakGain: 0.86,
  }),
  machine_ai: frozenToneProfile({
    id: "machine_ai",
    oscillatorType: "triangle",
    frequencyHz: 520,
    durationSeconds: 0.032,
    attackSeconds: 0.004,
    peakGain: 0.92,
  }),
});

export const FREE_TABLE_AMBIENCE_TONE_PROFILE_IDS = Object.freeze(
  Object.keys(FREE_TABLE_AMBIENCE_TONE_PROFILES),
);

export function normalizeFreeTableAmbienceToneProfileId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return Object.hasOwn(FREE_TABLE_AMBIENCE_TONE_PROFILES, normalized)
    ? normalized
    : FREE_TABLE_AMBIENCE_DEFAULT_TONE_PROFILE_ID;
}

function validatedRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("自由卓の空気設定revisionが不正です。");
  }
  return revision;
}

function validatedMetronomeBpm(
  value,
  minimumBpm = FREE_TABLE_AMBIENCE_BPM_MIN,
  maximumBpm = FREE_TABLE_AMBIENCE_BPM_MAX,
) {
  const bpm = Number(value);
  const valid = bpm === 0 || (
    Number.isInteger(bpm)
    && bpm >= minimumBpm
    && bpm <= maximumBpm
  );
  if (!valid) {
    throw new RangeError(
      `自由卓の部屋の呼吸は0または${minimumBpm}〜${maximumBpm}の整数BPMで指定してください。`,
    );
  }
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
  initialToneProfileId = FREE_TABLE_AMBIENCE_DEFAULT_TONE_PROFILE_ID,
  minimumBpm = FREE_TABLE_AMBIENCE_BPM_MIN,
  maximumBpm = FREE_TABLE_AMBIENCE_BPM_MAX,
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
  if (!Number.isInteger(minimumBpm)
      || !Number.isInteger(maximumBpm)
      || minimumBpm <= 0
      || maximumBpm < minimumBpm
      || maximumBpm > 600) {
    throw new RangeError("自由卓のBPM範囲が不正です。");
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
  let activeToneProfileId = normalizeFreeTableAmbienceToneProfileId(initialToneProfileId);
  let pendingToneProfile = null;

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

  function getToneProfileState() {
    const serverNow = currentServerNow();
    if (serverNow !== null) promotePendingToneProfile(serverNow);
    return {
      toneProfileId: activeToneProfileId,
      pendingToneProfileId: pendingToneProfile?.toneProfileId ?? null,
      pendingEffectiveAt: pendingToneProfile?.effectiveAt ?? null,
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

  function toneProfileForBeat(startServerTime) {
    const toneProfileId = (
      pendingToneProfile
      && startServerTime >= pendingToneProfile.effectiveAt - TIME_EPSILON_MS
    )
      ? pendingToneProfile.toneProfileId
      : activeToneProfileId;
    return FREE_TABLE_AMBIENCE_TONE_PROFILES[toneProfileId]
      || FREE_TABLE_AMBIENCE_TONE_PROFILES[FREE_TABLE_AMBIENCE_DEFAULT_TONE_PROFILE_ID];
  }

  function toneProfileBoundaryAfter(startServerTime, toneProfileId) {
    if (
      !pendingToneProfile
      || toneProfileId !== activeToneProfileId
      || startServerTime >= pendingToneProfile.effectiveAt - TIME_EPSILON_MS
    ) {
      return Infinity;
    }
    return pendingToneProfile.effectiveAt;
  }

  function scheduleTone(startServerTime, serverNow, ambience, stopAtServerTime = Infinity) {
    if (!audioContext || !masterGain) return;
    const toneProfile = toneProfileForBeat(startServerTime);
    const profileBoundary = toneProfileBoundaryAfter(startServerTime, toneProfile.id);
    const effectiveStopAtServerTime = Math.min(stopAtServerTime, profileBoundary);
    const maximumDurationSeconds = Number.isFinite(effectiveStopAtServerTime)
      ? Math.max(0, (effectiveStopAtServerTime - startServerTime) / 1000)
      : toneProfile.durationSeconds;
    const durationSeconds = Math.min(
      toneProfile.durationSeconds,
      maximumDurationSeconds,
    );
    if (durationSeconds <= TIME_EPSILON_MS / 1000) return;
    const startTime = audioContext.currentTime
      + Math.max(0, (startServerTime - serverNow) / 1000);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const stopTime = startTime + durationSeconds;
    const attackSeconds = Math.min(toneProfile.attackSeconds, durationSeconds / 2);
    const voice = {
      oscillator,
      gain,
      revision: ambience.revision,
      toneProfileId: toneProfile.id,
      startServerTime,
      stopServerTime: startServerTime + (durationSeconds * 1000),
    };

    oscillator.type = toneProfile.oscillatorType;
    oscillator.frequency.setValueAtTime(toneProfile.frequencyHz, startTime);
    gain.gain.setValueAtTime(MINIMUM_GAIN, startTime);
    gain.gain.linearRampToValueAtTime(toneProfile.peakGain, startTime + attackSeconds);
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

  function promotePendingToneProfile(serverNow) {
    if (
      !pendingToneProfile
      || serverNow + TIME_EPSILON_MS < pendingToneProfile.effectiveAt
    ) {
      return false;
    }
    activeToneProfileId = pendingToneProfile.toneProfileId;
    pendingToneProfile = null;
    return true;
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
    promotePendingToneProfile(serverNow);
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

  function installRephasedAmbience(nextAmbience) {
    // Training rounds may deliberately require a silent countdown even when the
    // next BPM matches the previous round. Removing the active grid here makes
    // the pending effectiveAt the one and only origin for the next cadence.
    activeAmbience = null;
    pendingAmbience = nextAmbience;
    restartForCurrentAmbience();
  }

  function setAmbience(snapshot, {
    serverTimeOffset: nextServerTimeOffset = serverTimeOffset,
    rephase = false,
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

    const nextMetronomeBpm = validatedMetronomeBpm(
      snapshot?.metronomeBpm,
      minimumBpm,
      maximumBpm,
    );
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
    const shouldRephase = rephase === true;
    if (
      hadCanonicalAmbience
      && nextMetronomeBpm === previousMetronomeBpm
      && !shouldRephase
    ) {
      if (serverTimeOffsetChanged) restartForCurrentAmbience();
      else continueCurrentCadence();
      return true;
    }
    const serverNow = currentServerNow();
    if (
      shouldRephase
      && serverNow !== null
      && nextEffectiveAt > serverNow + TIME_EPSILON_MS
    ) {
      installRephasedAmbience(nextAmbience);
      return true;
    }
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

  function rescheduleUpcomingTones(serverNow) {
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
    for (const voice of [...scheduledVoices]) {
      if (voice.startServerTime > serverNow + TIME_EPSILON_MS) {
        stopScheduledVoice(voice);
        continue;
      }
      if (
        pendingToneProfile
        && voice.toneProfileId === activeToneProfileId
        && voice.startServerTime < pendingToneProfile.effectiveAt - TIME_EPSILON_MS
        && voice.stopServerTime > pendingToneProfile.effectiveAt + TIME_EPSILON_MS
      ) {
        truncateScheduledVoice(voice, pendingToneProfile.effectiveAt, serverNow);
      }
    }
    activeNextBeatServerTime = null;
    pendingNextBeatServerTime = null;
    if (!hasSchedulerWork()) return;
    beginScheduler();
    scheduleLookahead();
  }

  /**
   * Selects one fixed local tone recipe. Supplying effectiveAt stages the change
   * on the same corrected server timeline used by ambience snapshots, allowing a
   * caller to switch only at a round boundary without rephasing the BPM grid.
   * Unknown or omitted IDs deliberately fall back to the legacy-compatible tap.
   */
  function setToneProfile(value, {
    effectiveAt: requestedEffectiveAt,
  } = {}) {
    const toneProfileId = normalizeFreeTableAmbienceToneProfileId(value);
    const serverNow = currentServerNow();
    if (serverNow !== null) promotePendingToneProfile(serverNow);
    const nextEffectiveAt = requestedEffectiveAt === undefined
      ? (serverNow ?? 0)
      : validatedEffectiveAt(requestedEffectiveAt);
    const appliesNow = serverNow === null
      || nextEffectiveAt <= serverNow + TIME_EPSILON_MS;

    if (appliesNow) {
      if (toneProfileId === activeToneProfileId && pendingToneProfile === null) {
        return toneProfileId;
      }
      activeToneProfileId = toneProfileId;
      pendingToneProfile = null;
    } else {
      if (
        pendingToneProfile?.toneProfileId === toneProfileId
        && pendingToneProfile.effectiveAt === nextEffectiveAt
      ) {
        return toneProfileId;
      }
      if (toneProfileId === activeToneProfileId && pendingToneProfile === null) {
        return toneProfileId;
      }
      pendingToneProfile = {
        toneProfileId,
        effectiveAt: nextEffectiveAt,
      };
    }

    if (serverNow !== null) rescheduleUpcomingTones(serverNow);
    return toneProfileId;
  }

  async function enable() {
    if (destroyed || visibilitySuspended || recordingSuspended) return false;
    if (enabled) return true;
    enabled = true;
    const serverNow = currentServerNow();
    if (serverNow !== null) {
      promotePendingAmbience(serverNow);
      promotePendingToneProfile(serverNow);
    }
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
    setToneProfile,
    enable,
    disable,
    setVolume,
    setMuted,
    suspendForVisibility,
    suspendForRecording,
    resumeAfterRecording,
    destroy,
    getState,
    getToneProfileState,
  });
}
