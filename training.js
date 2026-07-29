import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  get,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  database,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1";
import {
  appendIncomingOnlineImageChunk,
  completeIncomingOnlineImageTransfer,
  createIncomingOnlineImageTransfer,
  onlineImageEndStatus,
  verifiedOnlineImageMime,
} from "./online-image-transfer.mjs?v=online-image-transfer-v1";
import {
  createFreeTableAmbienceController,
} from "./free-table-ambience.mjs?v=free-table-ambience-v1";
import {
  ONLINE_P2P_RECOVERY_PHASES,
  createOnlineP2pGenerationToken,
  createOnlineP2pRecoveryState,
  getOnlineP2pRecoveryTimer,
  transitionOnlineP2pRecovery,
} from "./online-p2p-hardening.mjs?v=online-p2p-hardening-v2";
import {
  ONLINE_SESSION_LEASE_DEFAULTS,
  createOnlineSessionToken,
  decideOnlineSessionHeartbeatResult,
  isOnlineSessionLeaseOwner,
  resolveOnlineSessionId,
} from "./online-session-guard.mjs?v=online-session-guard-v2";
import {
  CHAT_FRAME_PRODUCTS,
  chatCosmeticClassNames,
  getEquippedChatCosmetics,
} from "./chat-cosmetics.js?v=chat-cosmetics-v1";
import {
  TRAINING_SESSION_STORAGE_KEY,
  createTrainingSessionPresencePayload,
  createTrainingSessionSignalEnvelope,
  decideTrainingSessionOffer,
  decideTrainingSessionSignal,
  shouldConsumeTrainingSessionSignal,
  trainingImageRoundsNeedingResend,
  trainingSessionOfferPath as buildTrainingSessionOfferPath,
  trainingSessionPresencePath as buildTrainingSessionPresencePath,
  trainingSessionRoomMemberMatches,
  trainingSessionSignalPath as buildTrainingSessionSignalPath,
} from "./training-session-v2.mjs?v=training-session-v2-rtdb-array-v1";
import {
  TRAINING_LIMITS,
  TRAINING_PROTOCOL_VERSION,
  TRAINING_QUEUE_FRESH_MS,
  TRAINING_VARIANT,
  createTrainingAcceptanceUpdates,
  deriveTrainingRoomState,
  normalizeTrainingConditions,
  normalizeTrainingInstruction,
  normalizeTrainingIntensity,
  normalizeTrainingName,
  normalizeTrainingSessionId,
  selectTrainingPair,
  trainingActiveRoomAppearsLive,
  trainingBeatState,
  trainingInstructionIsReady,
  trainingQueueEntryKey,
  trainingServerFinalizedResult,
  validTrainingQueueEntries,
} from "./training-core.mjs?v=kitaeai-hp-v3-matchmaking-v1";

const MATCH_TIMEOUT_MS = 30_000;
const MATCH_LOCK_TTL_MS = MATCH_TIMEOUT_MS + 10_000;
const MATCH_LOCK_RETRY_GRACE_MS = 100;
const HEARTBEAT_MS = 20_000;
const TRAINING_QUEUE_RECLAIM_MS = 60_000;
const MATCHMAKING_CLEANUP_RETRY_DELAYS_MS = Object.freeze([0, 250, 750]);
const TRAINING_SESSION_RESTART_QUEUE_DELAYS_MS = Object.freeze([
  0, 100, 250, 500, 1_000, 2_000,
]);
const TRAINING_CANDIDATE_SKIP_MS = TRAINING_QUEUE_FRESH_MS;
const TRAINING_HOST_TAKEOVER_MS = 8_000;
const IMAGE_EXCHANGE_TIMEOUT_MS = 45_000;
const IMAGE_CHANNEL_LABEL = "hariai-training-image-v3";
const MAX_IMAGE_TRANSFER_BYTES = 8 * 1024 * 1024;
const IMAGE_CHUNK_BYTES = 64 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const TRAINING_VOLUME_KEY = "hariai-training-volume-v1";
const TRAINING_MUTED_KEY = "hariai-training-muted-v1";
const TRAINING_IMAGE_COUNT = 5;
const TRAINING_COMMAND_COUNT = 3;
const TRAINING_MAX_ROUNDS = 5;
const TRAINING_START_HP = 30;
const SCORE_POLL_MS = 800;
const FINISHER_DURATION_MS = 30_000;
const TRAINING_SCORE_CONFIG = Object.freeze({
  8: Object.freeze({ label: "HIT 8", damage: 10, durationMs: 60_000 }),
  9: Object.freeze({ label: "CRITICAL 9", damage: 15, durationMs: 75_000 }),
  10: Object.freeze({ label: "PERFECT 10", damage: 20, durationMs: 90_000 }),
});
const TRAINING_HUD_PHASES = Object.freeze([
  "workout_ready",
  "workout_active",
  "workout_expired",
]);
const TRAINING_RUNNING_PHASES = Object.freeze([
  "workout_active",
  "workout_expired",
]);
const TRAINING_WORKOUT_MESSAGE_HISTORY_LIMIT = 20;
const TRAINING_WORKOUT_MESSAGE_OVERLAY_LIMIT = 3;
const TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS = 800;
const TRAINING_WORKOUT_MESSAGE_OVERLAY_MS = 5_200;
const TRAINING_WORKOUT_MESSAGE_RETRY_DELAYS_MS = Object.freeze([900, 1_600]);
const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost"]);
const FALLBACK_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
  Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
]);
const CHEERS = Object.freeze({
  go: "いける！",
  halfway: "あと半分！",
  last: "ラスト！",
  complete: "よくやり切った！",
});
const WORKOUT_REPLIES = Object.freeze({
  heard: "届いてる！",
  thanks: "ありがとう！",
  still: "まだいける！",
  tough: "きつい！",
  last: "ラスト！",
  finish: "完遂する！",
});
const WORKOUT_QUICK_MESSAGES = Object.freeze({
  ...CHEERS,
  ...WORKOUT_REPLIES,
});
const INTENSITY_LABELS = Object.freeze({
  light: "軽め",
  standard: "標準",
  strong: "しっかり",
});
const PRESETS = Object.freeze({
  pushup: Object.freeze({
    exercise: "腕立て伏せ",
    completion: "時間いっぱい、自分のペースで続ける",
    command: "メトロノームに合わせて、できる範囲で腕立て伏せを続けてください。",
    beatsPerRep: 4,
  }),
  squat: Object.freeze({
    exercise: "スクワット",
    completion: "時間いっぱい、無理のない範囲で続ける",
    command: "姿勢を意識しながら、拍に合わせてスクワットを続けてください。",
    beatsPerRep: 2,
  }),
  situp: Object.freeze({
    exercise: "腹筋",
    completion: "時間いっぱい、呼吸を止めずに続ける",
    command: "無理のない可動域で、呼吸を止めずに腹筋を続けてください。",
    beatsPerRep: 8,
  }),
});

const trainingActionCallable = httpsCallable(functions, "trainingAction");
const trainingSessionActionCallable = httpsCallable(functions, "trainingSessionAction");
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const trainingTabId = globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const trainingTabChannel = "BroadcastChannel" in window
  ? new BroadcastChannel("hariai-stadium-training-tab-v1")
  : null;
const TRAINING_SESSION_OWNER_PROBE_VERSION = 1;

let active = false;
let state = createState();
let trainingTabLeaseHeld = false;
let trainingSharedStateOwned = false;
let trainingTabClaimConflict = false;
let trainingTabClaiming = false;

trainingTabChannel?.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.tabId === trainingTabId) return;
  if (message.type === "probe"
      && message.sessionOwnerProbeVersion === TRAINING_SESSION_OWNER_PROBE_VERSION
      && message.sessionId) {
    if (state.sessionLeaseHeld
        && message.sessionId === state.clientSessionId
        && typeof message.leaseToken === "string"
        && message.leaseToken !== state.clientLeaseToken) {
      trainingTabChannel.postMessage({
        type: "probe-response",
        sessionOwnerProbeVersion: TRAINING_SESSION_OWNER_PROBE_VERSION,
        probeId: message.probeId,
        tabId: trainingTabId,
        sessionId: state.clientSessionId,
        leaseToken: state.clientLeaseToken,
      });
    }
    return;
  }
  if (message.type === "probe" && trainingTabLeaseHeld) {
    trainingTabChannel.postMessage({
      type: "probe-response",
      probeId: message.probeId,
      tabId: trainingTabId,
    });
    return;
  }
  if (message.type === "claim" && trainingTabLeaseHeld) {
    if (trainingTabClaiming && String(message.tabId || "") < trainingTabId) {
      trainingTabClaimConflict = true;
      trainingTabLeaseHeld = false;
    } else {
      trainingTabChannel.postMessage({
        type: "claim-denied",
        targetTabId: message.tabId,
        tabId: trainingTabId,
      });
    }
    return;
  }
  if (message.type === "claim-denied"
    && message.targetTabId === trainingTabId
    && trainingTabClaiming) {
    trainingTabClaimConflict = true;
    trainingTabLeaseHeld = false;
  }
});

document.addEventListener("visibilitychange", () => {
  const targetState = state;
  dispatchTrainingP2pRecoveryEvent?.("VISIBILITY_CHANGED", state, {
    visible: document.visibilityState === "visible",
  });
  if (document.hidden) {
    releaseTrainingWorkoutWakeLock(targetState);
    return;
  }
  if (active
      && targetState.sessionLeaseHeld
      && !targetState.sessionHeartbeatInFlight) {
    clearTrainingSessionHeartbeat(targetState);
    refreshTrainingSessionLease(targetState).catch((error) => {
      if (active && state === targetState) handleRecoverableError(error);
    });
  }
  queueMicrotask(() => {
    resumeTrainingAmbienceAfterVisibility().catch(() => {});
    syncTrainingWorkoutWakeLock(targetState);
  });
});
window.addEventListener("online", () => {
  dispatchTrainingP2pRecoveryEvent?.("NETWORK_CHANGED", state, { online: true });
});
window.addEventListener("offline", () => {
  dispatchTrainingP2pRecoveryEvent?.("NETWORK_CHANGED", state, { online: false });
});

function storedVolume() {
  const value = Number(localStorage.getItem(TRAINING_VOLUME_KEY));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.18;
}

function resolveTrainingSessionId() {
  const storedSessionId = sessionStorage.getItem(TRAINING_SESSION_STORAGE_KEY);
  const resolution = resolveOnlineSessionId({
    storedSessionId,
    generatedSessionId: createOnlineSessionToken(globalThis.crypto),
  });
  if (resolution.shouldPersist) {
    sessionStorage.setItem(TRAINING_SESSION_STORAGE_KEY, resolution.sessionId);
  }
  return resolution.sessionId;
}

function createState() {
  const volume = storedVolume();
  const muted = localStorage.getItem(TRAINING_MUTED_KEY) === "true";
  const ambienceController = createFreeTableAmbienceController({ initialVolume: volume });
  ambienceController.setMuted(muted);
  return {
    generation: 0,
    screen: "setup",
    authReady: false,
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    intensity: "standard",
    conditions: "",
    localImages: Array(TRAINING_IMAGE_COUNT).fill(null),
    remoteImages: {},
    commandDeck: [
      normalizeCommandCard(PRESETS.pushup),
      normalizeCommandCard(PRESETS.squat),
      normalizeCommandCard(PRESETS.situp),
    ],
    profile: null,
    daily: null,
    roomId: "",
    pendingRoomId: "",
    room: emptyRoom(),
    latestQueue: {},
    latestInvites: {},
    queueSessionId: "",
    clientSessionId: resolveTrainingSessionId(),
    clientLeaseToken: createOnlineSessionToken(globalThis.crypto),
    sessionLeaseHeld: false,
    sessionLease: null,
    sessionGeneration: "",
    sessionHeartbeat: null,
    sessionHeartbeatInFlight: false,
    matchmakingGeneration: "",
    opponentSessionId: "",
    roomConnectionGeneration: "",
    signalingAttemptId: "",
    sessionOfferRoomId: "",
    sessionOfferHandling: false,
    sessionOfferRetryTimer: null,
    sessionTryMatchTimer: null,
    sessionTryMatchBusy: false,
    sessionRestartPromise: null,
    sessionAvoidUid: "",
    sessionAutoRequeueCount: 0,
    pendingInviteTargetSessionId: "",
    unavailableQueueEntries: {},
    startingMatchmaking: false,
    matchingBusy: false,
    acceptingInvite: false,
    inviteRetryTimer: null,
    hostTakeoverTimer: null,
    hostTakeoverDueAt: 0,
    enteringRoom: false,
    returningToQueue: false,
    pendingTeardown: null,
    queueHeartbeat: null,
    matchTimer: null,
    enterRoomRetryTimer: null,
    enterRoomRetryAttempts: 0,
    serverTimeOffset: 0,
    serverTimeOffsetKnown: false,
    publicPresenceId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    publicPresenceOwnerDisconnect: null,
    matchmakingUnsubscribers: [],
    roomUnsubscribers: [],
    scorePoll: null,
    scorePollBusy: false,
    resultScoreHydration: null,
    resultScoreHydrationRetryAt: 0,
    roomSyncing: false,
    disconnectHandles: [],
    activeDisconnect: null,
    activeDisconnectRoomId: "",
    activeRoomDestroyedDisconnect: null,
    activeRoomDestroyedDisconnectRoomId: "",
    peer: null,
    channel: null,
    channelWasOpened: false,
    pendingIce: [],
    p2pGenerationToken: null,
    p2pRecovery: null,
    p2pRecoveryTimer: null,
    p2pRestartIce: null,
    p2pCleanupPromise: null,
    incomingImage: null,
    outgoingImageRounds: new Set(),
    outgoingImageBusy: false,
    outgoingImageChannel: null,
    imageExchangeTimer: null,
    imageExchangeRound: 0,
    incomingMessageChain: Promise.resolve(),
    iceServers: FALLBACK_ICE_SERVERS.map((item) => ({ ...item })),
    ticker: null,
    currentView: null,
    roundProgressWriting: null,
    workoutCompletion: null,
    workoutWakeLock: null,
    workoutWakeLockRequest: null,
    giveUpArmed: false,
    scoreSubmitting: false,
    commandSubmitting: false,
    workoutMessageRoomId: "",
    workoutMessageRound: 0,
    workoutMessageDraft: "",
    workoutMessages: [],
    workoutMessageIds: new Set(),
    workoutMessageAcks: {},
    workoutMessageOverlayIds: [],
    workoutMessageOverlayTimers: new Map(),
    workoutMessageRetryTimers: new Map(),
    workoutMessageLastSentAt: 0,
    workoutMessageCooldownTimer: null,
    chatFrameInventory: {},
    selectedChatFrameId: "",
    chatFramesReady: false,
    chatFrameSaving: false,
    chatFrameSavePromise: null,
    ambienceController,
    volume,
    muted,
    ambienceRevision: 0,
    ambienceUnlocked: false,
    ambienceResumeRequired: false,
    outcome: null,
    finisher: null,
    finisherTicker: null,
    finisherOfferTimer: null,
    finalizing: false,
    finalization: null,
    finalizeTimer: null,
    finalizeAttempts: 0,
    errorMessage: "",
    opponentWasOnline: false,
    destroying: null,
    preview: "",
  };
}

function emptyRoom() {
  return {
    protocolVersion: 0,
    variant: "",
    sessionProtocolVersion: 0,
    signalingVersion: 0,
    attemptId: "",
    connectionGeneration: "",
    sessions: {},
    hostUid: "",
    guestUid: "",
    createdAt: 0,
    status: "",
    members: {},
    players: {},
    chatFrames: {},
    accepted: {},
    rounds: {},
    surrendered: null,
    presence: {},
    destroyed: null,
    serverFinalized: null,
  };
}

const shared = () => window.HariaiApp?.shared;
const showToast = (message) => shared()?.showToast?.(message);
const setBusy = (busy, message) => shared()?.setBusy?.(busy, message);
const firebaseNow = () => Date.now() + Number(state.serverTimeOffset || 0);

function applyTrainingServerTimeOffset(targetState, snapshot) {
  const offset = snapshot?.val?.();
  if (typeof offset !== "number" || !Number.isFinite(offset)) return false;
  targetState.serverTimeOffset = offset;
  targetState.serverTimeOffsetKnown = true;
  return true;
}

function trainingWorkoutNeedsWakeLock(targetState = state) {
  if (!active
      || state !== targetState
      || targetState.preview
      || targetState.screen !== "room"
      || !targetState.roomId
      || targetState.outcome
      || document.visibilityState !== "visible") return false;
  const view = trainingClientView();
  if (!TRAINING_RUNNING_PHASES.includes(view.phase)) return false;
  const context = ownWorkoutContext(view.roundIndex);
  return Boolean(
    Number(context?.workout?.startedAt || 0)
      && !Number(context?.workout?.completedAt || 0),
  );
}

async function releaseTrainingWorkoutWakeLock(targetState = state) {
  const sentinel = targetState.workoutWakeLock;
  targetState.workoutWakeLock = null;
  if (!sentinel || sentinel.released) return false;
  try {
    await sentinel.release();
    return true;
  } catch {
    return false;
  }
}

async function acquireTrainingWorkoutWakeLock(targetState = state) {
  if (!trainingWorkoutNeedsWakeLock(targetState)
      || !("wakeLock" in navigator)
      || typeof navigator.wakeLock?.request !== "function") return false;
  if (targetState.workoutWakeLock && !targetState.workoutWakeLock.released) {
    return true;
  }
  if (targetState.workoutWakeLockRequest) {
    return targetState.workoutWakeLockRequest;
  }
  const request = (async () => {
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!trainingWorkoutNeedsWakeLock(targetState)) {
        await sentinel.release().catch(() => {});
        return false;
      }
      targetState.workoutWakeLock = sentinel;
      sentinel.addEventListener?.("release", () => {
        if (targetState.workoutWakeLock === sentinel) {
          targetState.workoutWakeLock = null;
        }
      }, { once: true });
      return true;
    } catch {
      return false;
    }
  })();
  targetState.workoutWakeLockRequest = request;
  try {
    return await request;
  } finally {
    if (targetState.workoutWakeLockRequest === request) {
      targetState.workoutWakeLockRequest = null;
    }
  }
}

function syncTrainingWorkoutWakeLock(targetState = state) {
  if (trainingWorkoutNeedsWakeLock(targetState)) {
    return acquireTrainingWorkoutWakeLock(targetState);
  }
  return releaseTrainingWorkoutWakeLock(targetState);
}

function escapeHtml(value) {
  if (shared()?.escapeHtml) return shared().escapeHtml(value);
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeImageBpm(value) {
  const bpm = Number(value);
  return Number.isInteger(bpm) && bpm >= 40 && bpm <= 160 ? bpm : bpm === 0 ? 0 : -1;
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 10 ? score : 0;
}

function scoreConfig(value) {
  return TRAINING_SCORE_CONFIG[normalizeScore(value)] || Object.freeze({
    label: "MISS",
    damage: 0,
    durationMs: 0,
  });
}

function normalizeCommandCard(value = {}) {
  const instruction = normalizeTrainingInstruction({ ...value, bpm: 0 });
  return {
    exercise: instruction.exercise,
    completion: instruction.completion,
    command: instruction.command,
    beatsPerRep: [2, 4, 8].includes(Number(value.beatsPerRep))
      ? Number(value.beatsPerRep)
      : 2,
  };
}

function commandCardIsReady(value) {
  const card = normalizeCommandCard(value);
  return Boolean(card.exercise && card.completion && card.command);
}

function commandDeckPayload(deck = state.commandDeck) {
  return Object.fromEntries(
    deck.map((card, index) => [index + 1, normalizeCommandCard(card)]),
  );
}

function imageBpmsPayload(images = state.localImages) {
  return Object.fromEntries(
    images.map((image, index) => [index + 1, normalizeImageBpm(image?.bpm)]),
  );
}

function setupIsReady() {
  return Boolean(
    state.authReady
    && !state.chatFrameSaving
    && normalizeTrainingName(state.name)
    && state.localImages.length === TRAINING_IMAGE_COUNT
    && state.localImages.every((image) => image?.blob && normalizeImageBpm(image.bpm) >= 0)
    && state.commandDeck.length === TRAINING_COMMAND_COUNT
    && state.commandDeck.every(commandCardIsReady),
  );
}

function memberUids() {
  return Object.entries(state.room.members || {})
    .filter(([, included]) => included === true)
    .map(([uid]) => uid)
    .sort();
}

function trainingRound(roundIndex) {
  return state.room.rounds?.[roundIndex]
    || state.room.rounds?.[String(roundIndex)]
    || {};
}

function roundDraw(round, uid) {
  return round?.draws?.[uid] || null;
}

function roundScore(round, uid) {
  return normalizeScore(round?.scores?.[uid]);
}

function currentRoundIndex() {
  for (let index = 1; index <= TRAINING_MAX_ROUNDS; index += 1) {
    const round = trainingRound(index);
    if (!Number(round.completedAt || 0)) return index;
  }
  return TRAINING_MAX_ROUNDS;
}

function completedRoundCount() {
  return Array.from({ length: TRAINING_MAX_ROUNDS }, (_, index) => trainingRound(index + 1))
    .filter((round) => Number(round.completedAt || 0) > 0)
    .length;
}

function damageTakenBy(uid) {
  return Array.from({ length: TRAINING_MAX_ROUNDS }, (_, index) => {
    const score = roundScore(trainingRound(index + 1), uid);
    return scoreConfig(score).damage;
  }).reduce((total, damage) => total + damage, 0);
}

function hpFor(uid) {
  return Math.max(0, TRAINING_START_HP - damageTakenBy(uid));
}

function usedCommandIndexes(trainerUid) {
  const used = new Set();
  for (let index = 1; index <= TRAINING_MAX_ROUNDS; index += 1) {
    const choices = trainingRound(index).commandChoices || {};
    Object.values(choices).forEach((choice) => {
      if (choice?.trainerUid === trainerUid) used.add(Number(choice.cardIndex));
    });
  }
  return used;
}

function commandCardFor(uid, cardIndex) {
  return normalizeCommandCard(
    state.room.players?.[uid]?.commandDeck?.[cardIndex]
    || state.room.players?.[uid]?.commandDeck?.[String(cardIndex)],
  );
}

function ownWorkoutContext(roundIndex = currentRoundIndex()) {
  const round = trainingRound(roundIndex);
  const score = roundScore(round, state.uid);
  const choice = round.commandChoices?.[state.uid];
  const workout = round.workouts?.[state.uid];
  if (score < 8 || !choice) return null;
  const trainerUid = choice.trainerUid || opponentPlayer()?.uid || "";
  const draw = roundDraw(round, trainerUid);
  return {
    roundIndex,
    round,
    score,
    scoreInfo: scoreConfig(score),
    choice,
    workout: workout || {},
    trainerUid,
    card: commandCardFor(trainerUid, choice.cardIndex),
    bpm: normalizeImageBpm(draw?.bpm) >= 0 ? Number(draw.bpm) : 0,
  };
}

function workoutElapsed(workout, now = firebaseNow()) {
  const startedAt = Number(workout?.startedAt || 0);
  return startedAt ? Math.max(0, Number(now) - startedAt) : 0;
}

function allRoundDrawsReady(round) {
  const uids = memberUids();
  return uids.length === 2 && uids.every((uid) => {
    const draw = roundDraw(round, uid);
    return Number.isInteger(Number(draw?.imageIndex))
      && Number(draw.imageIndex) >= 1
      && Number(draw.imageIndex) <= TRAINING_IMAGE_COUNT
      && normalizeImageBpm(draw.bpm) >= 0;
  });
}

function allRoundImagesReceived(round) {
  const uids = memberUids();
  return uids.length === 2 && uids.every((uid) => round?.imageReceived?.[uid] === true);
}

function allRoundScoresReady(round) {
  const uids = memberUids();
  return uids.length === 2 && uids.every((uid) => roundScore(round, uid));
}

function requiredRoundWorkoutsComplete(round) {
  return memberUids().every((uid) => {
    if (roundScore(round, uid) < 8) return true;
    return Number(round?.workouts?.[uid]?.completedAt || 0) > 0;
  });
}

function hpResultView() {
  const uids = memberUids();
  if (uids.length !== 2) return null;
  const surrenderedUid = String(state.room.surrendered?.uid || "");
  if (uids.includes(surrenderedUid)) {
    const winnerUid = uids.find((uid) => uid !== surrenderedUid) || "";
    return {
      phase: "result",
      roundIndex: currentRoundIndex(),
      result: { type: winnerUid === state.uid ? "win" : "loss", winnerUid, loserUid: surrenderedUid, reason: "surrender" },
    };
  }
  return null;
}

function trainingClientView() {
  const result = hpResultView();
  if (result) return result;
  const roundIndex = currentRoundIndex();
  const round = trainingRound(roundIndex);
  const opponentUid = memberUids().find((uid) => uid !== state.uid) || "";
  const base = { roundIndex, round, opponentUid, result: null };
  if (!allRoundDrawsReady(round) || !allRoundImagesReceived(round)) return { ...base, phase: "drawing" };
  if (!allRoundScoresReady(round)) return { ...base, phase: "scoring" };
  const opponentScore = roundScore(round, opponentUid);
  const ownScore = roundScore(round, state.uid);
  if (opponentScore >= 8 && !round.commandChoices?.[opponentUid]) {
    return { ...base, phase: "command_select", traineeUid: opponentUid, trainerUid: state.uid };
  }
  if (ownScore >= 8 && !round.commandChoices?.[state.uid]) {
    return { ...base, phase: "waiting_command", traineeUid: state.uid, trainerUid: opponentUid };
  }
  const context = ownWorkoutContext(roundIndex);
  if (context && !Number(context.workout?.completedAt || 0)) {
    if (!Number(context.workout?.startedAt || 0)) return { ...base, phase: "workout_ready", ...context };
    if (workoutElapsed(context.workout) >= context.scoreInfo.durationMs) {
      return { ...base, phase: "workout_expired", ...context };
    }
    return { ...base, phase: "workout_active", ...context };
  }
  if (!requiredRoundWorkoutsComplete(round)) return { ...base, phase: "waiting_workout" };
  return { ...base, phase: "round_complete" };
}

function completedTrainingSeconds(rounds) {
  return Object.values(rounds || {}).reduce((total, round) => (
    total + Object.entries(round?.workouts || {}).reduce((roundTotal, [uid, workout]) => {
      if (uid !== state.uid || !Number(workout?.completedAt || 0)) return roundTotal;
      return roundTotal + Math.floor(scoreConfig(roundScore(round, uid)).durationMs / 1000);
    }, 0)
  ), 0);
}

function imageScoreMetrics(uid) {
  const scorerUid = memberUids().find((memberUid) => memberUid !== uid) || "";
  const scores = Array.from({ length: TRAINING_MAX_ROUNDS }, (_, index) => (
    roundScore(trainingRound(index + 1), scorerUid)
  )).filter(Boolean);
  return {
    total: scores.reduce((sum, score) => sum + score, 0),
    tens: scores.filter((score) => score === 10).length,
    nines: scores.filter((score) => score === 9).length,
  };
}

function resultImageScoreMetrics(view, uid) {
  const fallback = imageScoreMetrics(uid);
  const total = Number(view?.scoreTotalByUid?.[uid]);
  const tens = Number(view?.score10CountByUid?.[uid]);
  const nines = Number(view?.score9CountByUid?.[uid]);
  return {
    total: Number.isFinite(total) ? total : fallback.total,
    tens: Number.isFinite(tens) ? tens : fallback.tens,
    nines: Number.isFinite(nines) ? nines : fallback.nines,
  };
}

function isPreviewRequest() {
  if (!LOCAL_PREVIEW_HOSTS.has(location.hostname)) return "";
  const requested = new URLSearchParams(location.search).get("trainingPreview") || "";
  return ["setup", "draw", "score", "command", "workout", "result"].includes(requested)
    ? requested
    : "";
}

function start() {
  if (active) return;
  const preview = isPreviewRequest();
  if (!preview && useOfflineMarketPreview) {
    showToast("LOCAL UI PREVIEW中は鍛え合い60へ接続しません。");
    return;
  }
  if (!preview && location.protocol === "file:") {
    showToast("鍛え合い60はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (!preview && anotherModeIsActive()) {
    showToast("ほかの画面を終了してから、鍛え合い60を開始してください。");
    return;
  }

  active = true;
  state.ambienceController?.destroy();
  state = createState();
  state.generation += 1;
  state.preview = preview;
  setTrainingChrome("鍛え合い READY");
  if (preview) {
    installPreview(preview);
    return;
  }
  render();
  ensureAuthenticated().catch(handleFatalError);
}

function anotherModeIsActive() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiFreeTable?.isActive?.()
    || window.HariaiAccount?.isActive?.()
  );
}

function isActive() {
  return active;
}

async function ensureAuthenticated() {
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!active) return;
  state.uid = credential.user.uid;
  const initialized = await trainingActionCallable({ action: "initialize" });
  if (!active) return;
  state.profile = initialized.data?.profile || null;
  state.daily = initialized.data?.daily || null;
  await loadTrainingChatFrameLoadout(state);
  if (!active) return;
  state.authReady = true;
  render();
}

function ownedTrainingChatFrames(targetState = state) {
  const inventory = targetState.chatFrameInventory || {};
  return CHAT_FRAME_PRODUCTS.filter((product) => inventory[product.id] === true);
}

function validOwnedTrainingChatFrameId(
  chatFrameId,
  targetState = state,
) {
  const normalized = String(chatFrameId || "");
  if (!normalized) return "";
  return ownedTrainingChatFrames(targetState).some((product) => product.id === normalized)
    ? normalized
    : "";
}

async function loadTrainingChatFrameLoadout(targetState = state) {
  try {
    const snapshot = await get(ref(database, `online/economy/${targetState.uid}`));
    if (state !== targetState || !active) return;
    const economy = snapshot.val() || {};
    targetState.chatFrameInventory = economy.inventory && typeof economy.inventory === "object"
      ? economy.inventory
      : {};
    const equipped = getEquippedChatCosmetics(economy);
    targetState.selectedChatFrameId = validOwnedTrainingChatFrameId(
      equipped.chatFrameId,
      targetState,
    );
  } catch (error) {
    console.warn("鍛え合い60のチャット枠を読み込めませんでした。", error);
    if (state === targetState) {
      targetState.chatFrameInventory = {};
      targetState.selectedChatFrameId = "";
    }
  } finally {
    if (state === targetState) targetState.chatFramesReady = true;
  }
}

async function saveTrainingChatFrame(chatFrameId) {
  const targetState = state;
  const nextChatFrameId = validOwnedTrainingChatFrameId(chatFrameId, targetState);
  if (String(chatFrameId || "") && !nextChatFrameId) {
    throw new Error("購入済みのチャット枠を確認できませんでした。");
  }
  if (!targetState.uid || targetState.chatFrameSaving) return;
  if (nextChatFrameId === targetState.selectedChatFrameId) return;
  if (targetState.preview) {
    targetState.selectedChatFrameId = nextChatFrameId;
    refreshTrainingChatFramePreview();
    return;
  }
  const previousChatFrameId = targetState.selectedChatFrameId;
  targetState.chatFrameSaving = true;
  document.querySelector("#trainingChatFrame")?.setAttribute("disabled", "");
  updateSetupButton();
  const operation = runTransaction(
    ref(database, `online/economy/${targetState.uid}/equipped/chatFrame`),
    () => nextChatFrameId,
  );
  targetState.chatFrameSavePromise = operation;
  try {
    const result = await operation;
    if (state !== targetState) return;
    if (!result.committed || String(result.snapshot.val() || "") !== nextChatFrameId) {
      throw new Error("チャット枠の選択を保存できませんでした。");
    }
    targetState.selectedChatFrameId = nextChatFrameId;
    refreshTrainingChatFramePreview();
  } catch (error) {
    if (state === targetState) {
      targetState.selectedChatFrameId = previousChatFrameId;
      const select = document.querySelector("#trainingChatFrame");
      if (select) select.value = previousChatFrameId;
    }
    throw error;
  } finally {
    if (state === targetState) {
      targetState.chatFrameSaving = false;
      targetState.chatFrameSavePromise = null;
      document.querySelector("#trainingChatFrame")?.removeAttribute("disabled");
      updateSetupButton();
    }
  }
}

function refreshTrainingChatFramePreview() {
  const preview = document.querySelector("#trainingChatFramePreview");
  if (!preview) return;
  const selectedFrame = validOwnedTrainingChatFrameId(state.selectedChatFrameId);
  const selectedProduct = CHAT_FRAME_PRODUCTS.find((product) => product.id === selectedFrame);
  preview.className = chatCosmeticClassNames(selectedFrame, "");
  preview.textContent = selectedProduct
    ? `${selectedProduct.name}で鍛え合う！`
    : "一緒に完遂しよう！";
}

function setTrainingChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "画像保存なし / RATE対象外";
  if (footerItems[0]) footerItems[0].textContent = "鍛え合い60 / 1対1リズムトレーニング";
  if (footerItems[1]) footerItems[1].textContent = "画像は相手へ直接転送し、Firebaseや運営サーバーへ保存しません";
  const title = destroyDialog?.querySelector("h2");
  const body = destroyDialog?.querySelector("p");
  const confirm = destroyDialog?.querySelector("#confirmDestroy");
  if (title) title.textContent = "鍛え合い60を終了しますか？";
  if (body) body.textContent = "進行中のHP対戦はNO CONTESTになります。RATEへの影響はありません。";
  if (confirm) confirm.textContent = "HP対戦を終了";
}

function render() {
  if (!active || !appRoot) return;
  clearTurnTicker();
  let content = "";
  if (state.screen === "setup") content = renderSetup();
  else if (state.screen === "matching") content = renderMatching();
  else if (state.screen === "forming") content = renderForming();
  else if (state.screen === "room") content = renderRoom();
  else if (state.screen === "result") content = renderResult();
  else if (state.screen === "cancelled") content = renderCancelled();
  else content = renderError();
  appRoot.innerHTML = content;
  bindEvents();
  appRoot.focus({ preventScroll: true });
  const renderedState = state;
  queueMicrotask(() => syncTrainingWorkoutWakeLock(renderedState));
}

function renderSetup() {
  const ready = setupIsReady();
  return `
    <section class="screen training-screen training-setup" aria-labelledby="trainingTitle">
      <div class="training-heading">
        <span class="eyebrow">IMAGE DRAW × HP30 × RHYTHM TRAINING</span>
        <h1 id="trainingTitle">鍛え合い<span>60</span></h1>
        <p>刺さる5枚を厳選してDRAW。相手画像へ高得点を付けた自分が、相手のCOMMANDで鍛えられます。</p>
      </div>
      <form class="training-hp-setup" id="trainingSetupForm">
        <section class="training-carrot-card training-deck-builder" aria-labelledby="trainingCarrotTitle">
          <div class="training-section-head">
            <span>01</span>
            <div><h2 id="trainingCarrotTitle">IMAGE DECK / 5</h2><p>相手へ刺す5枚を厳選し、画像ごとのリズムを決めます。</p></div>
          </div>
          <div class="training-image-deck">
            ${state.localImages.map((image, index) => `
              <article class="training-image-slot ${image ? "is-ready" : ""}">
                <header><span>CARD ${index + 1}</span><strong>${image ? (normalizeImageBpm(image.bpm) >= 40 ? `${normalizeImageBpm(image.bpm)} BPM` : "FREE") : "EMPTY"}</strong></header>
                <div class="training-setup-image">
                  ${image?.url
                    ? `<img src="${escapeHtml(image.url)}" alt="画像カード${index + 1}のプレビュー" />`
                    : `<div class="training-image-placeholder" aria-hidden="true"><span>DRAW ${index + 1}</span><strong>画像を選ぶ</strong></div>`}
                </div>
                <label class="button button-training training-file-button">
                  ${image ? "画像を差し替え" : "画像を選ぶ"}
                  <input type="file" accept="image/*" data-training-image-input="${index}" />
                </label>
                <label class="training-image-bpm">
                  <span>この画像のBPM</span>
                  <input type="number" min="0" max="160" step="1" value="${image ? Math.max(0, normalizeImageBpm(image.bpm)) : 0}" data-training-image-bpm="${index}" ${image ? "" : "disabled"} />
                  <small>0＝無音 / 40～160</small>
                </label>
                ${image ? `<button class="training-slot-remove" type="button" data-training-remove-image="${index}">外す</button>` : ""}
              </article>
            `).join("")}
          </div>
          <div class="training-image-actions training-deck-actions">
            <label class="button button-training training-file-button">
              空き枠へ画像を追加
              <input id="trainingImageInput" type="file" accept="image/*" multiple />
            </label>
            <button class="button button-ghost" id="trainingSampleImage" type="button">5枚のサンプルを使う</button>
          </div>
          <p class="training-privacy">毎ラウンド未使用の1枚をランダムDRAW。最大1280pxのWebPへ端末内変換し、画像本体はP2Pで相手へ直接送りFirebaseへ保存しません。</p>
        </section>
        <section class="training-command-card training-command-deck" aria-labelledby="trainingCommandDeckTitle">
          <div class="training-section-head">
            <span>02</span>
            <div><h2 id="trainingCommandDeckTitle">COMMAND DECK / 3</h2><p>相手に刺した時に選ぶ3つの筋トレ。各カードは1試合1回です。</p></div>
          </div>
          <div class="training-command-deck-list">
            ${state.commandDeck.map((card, index) => renderSetupCommandCard(card, index)).join("")}
          </div>
        </section>
        <section class="training-profile-card">
          <div class="training-section-head">
            <span>03</span>
            <div><h2>今日の自分</h2><p>指示を受ける相手へ、強度と配慮条件を伝えます。</p></div>
          </div>
          <label class="training-field">
            <span>名前</span>
            <input id="trainingPlayerName" maxlength="${TRAINING_LIMITS.name}" value="${escapeHtml(state.name)}" autocomplete="nickname" />
          </label>
          <fieldset class="training-intensity">
            <legend>今日の強度</legend>
            ${["light", "standard", "strong"].map((value) => `
              <label>
                <input type="radio" name="trainingIntensity" value="${value}" ${state.intensity === value ? "checked" : ""} />
                <span>${INTENSITY_LABELS[value]}</span>
              </label>`).join("")}
          </fieldset>
          <label class="training-field">
            <span>今日の条件 <small><b id="trainingConditionsCount">${state.conditions.length}</b> / ${TRAINING_LIMITS.conditions}</small></span>
            <textarea id="trainingConditions" maxlength="${TRAINING_LIMITS.conditions}" rows="3" placeholder="例：ジャンプなし／手首は軽め／今日は元気">${escapeHtml(state.conditions)}</textarea>
          </label>
          ${renderTrainingChatFrameSelector()}
          <div class="training-trust-note">
            <strong>ロールプレイを信頼する対戦です</strong>
            <p>カメラやセンサーでフォームを監視しません。無理な指示で勝とうとせず、事前登録した3枚から相手の状態に合うCOMMANDを選びます。</p>
            <p>痛み・めまい・体調変化は即NO CONTEST。単なるGIVE UPは敗北です。</p>
          </div>
          ${renderSetupTrainingRecord()}
          <button class="button button-training training-find-button" id="trainingFindMatch" type="submit" ${ready ? "" : "disabled"}>
            HP30の相手を探す
          </button>
          <p class="training-rate-note">RATE・ランキングは変動しません。</p>
        </section>
      </form>
    </section>`;
}

function renderTrainingChatFrameSelector() {
  const ownedFrames = ownedTrainingChatFrames();
  const selectedFrame = validOwnedTrainingChatFrameId(state.selectedChatFrameId);
  const selectedProduct = CHAT_FRAME_PRODUCTS.find((product) => product.id === selectedFrame);
  const previewClasses = chatCosmeticClassNames(selectedFrame, "");
  return `
    <section class="training-chat-frame-loadout" aria-labelledby="trainingChatFrameTitle">
      <div>
        <span>WORKOUT CHAT FRAME</span>
        <strong id="trainingChatFrameTitle">応援メッセージの枠</strong>
        <p>AnjuPayストアで購入した枠から選択。全モード共通の装備として保存し、対戦中は固定されます。</p>
      </div>
      <label for="trainingChatFrame">
        <span>使用するチャット枠</span>
        <select id="trainingChatFrame" ${state.chatFrameSaving ? "disabled" : ""}>
          <option value="" ${selectedFrame ? "" : "selected"}>標準</option>
          ${ownedFrames.map((product) => `<option value="${escapeHtml(product.id)}" ${selectedFrame === product.id ? "selected" : ""}>${escapeHtml(product.name)}</option>`).join("")}
        </select>
      </label>
      <div class="training-chat-frame-preview chat-message">
        <p id="trainingChatFramePreview" class="${previewClasses}">${escapeHtml(selectedProduct ? `${selectedProduct.name}で鍛え合う！` : "一緒に完遂しよう！")}</p>
      </div>
      <small>${state.chatFramesReady
        ? ownedFrames.length
          ? `購入済み ${ownedFrames.length}枠`
          : "購入済み枠はありません。標準枠を使用します。"
        : "購入済み枠を確認しています…"}</small>
    </section>`;
}

function renderSetupCommandCard(cardValue, index) {
  const card = normalizeCommandCard(cardValue);
  const cardNumber = index + 1;
  return `
    <article class="training-command-deck-card">
      <header><span>COMMAND ${cardNumber}</span><strong>${escapeHtml(card.exercise || "未設定")}</strong></header>
      <div class="training-presets" aria-label="COMMAND ${cardNumber}の入力補助">
        ${Object.keys(PRESETS).map((id) => `<button type="button" data-training-command-preset="${index}:${id}">${escapeHtml(PRESETS[id].exercise)}</button>`).join("")}
      </div>
      <label class="training-field"><span>種目名</span><input maxlength="${TRAINING_LIMITS.exercise}" value="${escapeHtml(card.exercise)}" data-training-command-field="${index}:exercise" /></label>
      <label class="training-field"><span>指示 <small>${card.command.length}/${TRAINING_LIMITS.command}</small></span><textarea maxlength="${TRAINING_LIMITS.command}" rows="2" data-training-command-field="${index}:command">${escapeHtml(card.command)}</textarea></label>
      <label class="training-field"><span>コンプリート条件</span><input maxlength="${TRAINING_LIMITS.completion}" value="${escapeHtml(card.completion)}" data-training-command-field="${index}:completion" /></label>
      <fieldset class="training-command-beats">
        <legend>1回あたりの拍</legend>
        ${[2, 4, 8].map((beats) => `<label><input type="radio" name="trainingCommandBeats${index}" value="${beats}" data-training-command-beats="${index}" ${card.beatsPerRep === beats ? "checked" : ""} /><span>${beats}拍</span></label>`).join("")}
      </fieldset>
    </article>`;
}

function renderSetupTrainingRecord() {
  const profile = state.profile || {};
  const matchesToday = Math.min(1, Number(state.daily?.trainingMatches || 0));
  return `
    <section class="training-setup-record" aria-label="鍛え合い記録">
      <header><h3>鍛え合い記録</h3><span>NO RATE</span></header>
      <dl>
        <div><dt>完遂ワークアウト</dt><dd>${Number(profile.hpCompletedWorkouts || 0)}</dd></div>
        <div><dt>鍛え合い対戦</dt><dd>${Number(profile.hpSessions || 0)}</dd></div>
        <div><dt>指示を受けた回数</dt><dd>${Number(profile.hpHitsTaken || 0)}</dd></div>
        <div><dt>運動時間</dt><dd>${Number(profile.hpCompletedSeconds || 0)}秒</dd></div>
        <div><dt>HP勝利</dt><dd>${Number(profile.hpWins || 0)}</dd></div>
        <div class="training-setup-mission"><dt>今日のHP対戦</dt><dd>${matchesToday}/1</dd></div>
      </dl>
    </section>`;
}

function renderMatching() {
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingMatchingTitle">
      <div class="training-pulse-mark" aria-hidden="true"><i></i><i></i><i></i></div>
      <span class="eyebrow">ONE QUEUE / ROLEPLAY MATCH</span>
      <h1 id="trainingMatchingTitle">鍛え合う相手を探しています</h1>
      <p>古くから待っている2人を順番に結びます。5枚の画像本体はまだ送信されていません。</p>
      <dl class="training-waiting-profile">
        <div><dt>NAME</dt><dd>${escapeHtml(state.name)}</dd></div>
        <div><dt>INTENSITY</dt><dd>${escapeHtml(INTENSITY_LABELS[state.intensity])}</dd></div>
        <div><dt>DECK</dt><dd>5 IMAGES / 3 COMMANDS</dd></div>
        <div><dt>CONDITION</dt><dd>${escapeHtml(state.conditions || "指定なし")}</dd></div>
      </dl>
      <button class="button button-ghost" id="trainingCancelMatch" type="button">準備画面へ戻る</button>
    </section>`;
}

function renderForming() {
  const accepted = Object.keys(state.room.accepted || {}).length;
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingFormingTitle">
      <div class="training-pair-mark" aria-hidden="true"><span>1</span><i></i><span>1</span></div>
      <span class="eyebrow">PAIR FOUND</span>
      <h1 id="trainingFormingTitle">鍛え合いの約束を結んでいます</h1>
      <p><strong>${accepted} / 2</strong> 人が参加を確認しました。</p>
      <div class="training-forming-bar" role="progressbar" aria-label="参加確認" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${accepted}">
        <i style="width:${accepted * 50}%"></i>
      </div>
      <p class="training-subtle">成立後にだけ、2人のブラウザをP2Pでつないで画像を交換します。</p>
      <button class="button button-ghost" id="trainingCancelPending" type="button">参加を取り消す</button>
    </section>`;
}

function renderRoom() {
  const canonicalView = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  const finalizedView = viewFromServerFinalized(state.room.serverFinalized, canonicalView);
  if (finalizedView) {
    clearImageExchangeWatchdog();
    clearScorePoll();
    cancelActiveRoomDestroyedDisconnect(state.roomId).catch(() => {});
    state.currentView = finalizedView;
    state.outcome = finalizedView;
    state.screen = "result";
    state.ambienceController.disable();
    queueMicrotask(() => {
      render();
      ensureFinalization();
    });
    return "";
  }
  if (state.roomSyncing) return renderRoomSyncing();
  if (completedRoundIndexesMissingScores().length
    && !["health_stop", "surrender"].includes(canonicalView.result?.reason)) {
    requestCompletedRoundScoreHydration();
    return renderRoomSyncing();
  }
  const view = trainingClientView();
  state.currentView = view;
  configureAmbienceForView(view);
  if (canonicalView.phase === "destroyed" || canonicalView.phase === "no_contest") {
    state.screen = "cancelled";
    queueMicrotask(render);
    return "";
  }
  if (canonicalView.phase === "result" || view.phase === "result") {
    const resultView = canonicalView.phase === "result" ? canonicalView : view;
    clearImageExchangeWatchdog();
    clearScorePoll();
    cancelActiveRoomDestroyedDisconnect(state.roomId).catch(() => {});
    state.currentView = resultView;
    state.outcome = resultView;
    state.screen = "result";
    state.ambienceController.disable();
    queueMicrotask(() => {
      render();
      ensureFinalization();
    });
    return "";
  }
  if (!TRAINING_HUD_PHASES.includes(view.phase)) state.ambienceController.disable();
  if (view.phase === "drawing") return renderConnecting(view);
  if (view.phase === "scoring") return renderCarrotChoice(view);
  if (view.phase === "command_select") return renderInstructionComposer(view);
  if (view.phase === "waiting_command" || view.phase === "waiting_workout" || view.phase === "round_complete") {
    return renderWaitingInstruction(view);
  }
  if (TRAINING_HUD_PHASES.includes(view.phase)) return renderTrainingHud(view);
  return renderConnecting(view);
}

function renderRoomSyncing() {
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingSyncTitle">
      <div class="training-pair-mark" aria-hidden="true"><span>HP</span><i></i><span>✓</span></div>
      <span class="eyebrow">SYNCING VERIFIED DRAW DATA</span>
      <h1 id="trainingSyncTitle">対戦記録を再確認しています</h1>
      <p>完了したDRAWの採点と筋トレ時刻を、許可された範囲だけ読み直しています。</p>
      <p class="training-subtle">確認が終わるまで、次のDRAWや結果確定は開始しません。</p>
    </section>`;
}

function renderConnecting(view = trainingClientView()) {
  const opponent = opponentPlayer();
  const round = view.round || trainingRound(view.roundIndex);
  const ownDrawn = Boolean(roundDraw(round, state.uid));
  const otherDrawn = Boolean(roundDraw(round, opponent?.uid));
  const ownReceived = round.imageReceived?.[state.uid] === true;
  const otherReceived = round.imageReceived?.[opponent?.uid] === true;
  queueMicrotask(() => {
    ensureLocalRoundDraw(view.roundIndex).catch((error) => {
      handleTrainingImageTransferFailure(
        "image_transfer_failed",
        error,
      ).catch(() => {});
    });
  });
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingConnectTitle">
      ${renderHpHeader(view.roundIndex)}
      <div class="training-transfer-orbit" aria-hidden="true"><span>DRAW</span><i></i><span>${view.roundIndex}</span></div>
      <span class="eyebrow">RANDOM DRAW / P2P IMAGE</span>
      <h1 id="trainingConnectTitle">${state.channel?.readyState === "open" ? `DRAW ${view.roundIndex}を交換中` : "相手のブラウザへ接続中"}</h1>
      <p>未使用の5枚から1枚ずつランダムにDRAW。画像とBPMは公開まで相手に見えません。</p>
      <ul class="training-transfer-checks" aria-label="画像受信状況">
        <li class="${ownDrawn ? "complete" : ""}"><i></i>あなたのカードをDRAW</li>
        <li class="${otherDrawn ? "complete" : ""}"><i></i>${escapeHtml(opponent?.name || "相手")}がDRAW</li>
        <li class="${ownReceived ? "complete" : ""}"><i></i>相手画像を受信・検証</li>
        <li class="${otherReceived ? "complete" : ""}"><i></i>自分の画像が相手へ到着</li>
      </ul>
      <p class="training-subtle">実画像はFirebaseへ保存しません。実バイト形式・サイズ・DRAW番号・BPMを確認してから同時公開します。</p>
      ${renderHealthStopButton()}
    </section>`;
}

function renderCancelled() {
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingCancelledTitle">
      <span class="eyebrow">NO CONTEST</span>
      <h1 id="trainingCancelledTitle">鍛え合いは中断されました</h1>
      <p>体調中止または通信中断のため、勝敗・RATEには影響しません。受信画像はこの画面を離れると破棄されます。</p>
      <div class="training-result-actions">
        <button class="button button-training" id="trainingCancelledRetry" type="button">準備画面でもう一度</button>
        <button class="button button-ghost" id="trainingCancelledHome" type="button">タイトルへ戻る</button>
      </div>
    </section>`;
}

function renderError() {
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingErrorTitle">
      <span class="eyebrow">CONNECTION PAUSED</span>
      <h1 id="trainingErrorTitle">鍛え合い60を開始できませんでした</h1>
      <p>${escapeHtml(state.errorMessage || "通信状態を確認して、もう一度お試しください。")}</p>
      <button class="button button-training" id="trainingErrorHome" type="button">タイトルへ戻る</button>
    </section>`;
}

function renderHpHeader(roundIndex = currentRoundIndex()) {
  const opponentUid = opponentPlayer()?.uid || "";
  const ownHp = hpFor(state.uid);
  const opponentHp = hpFor(opponentUid);
  const hpBar = (uid, hp, label, side) => `
    <div class="training-hp-player is-${side}">
      <div><span>${escapeHtml(label)}</span><strong>HP ${hp}</strong></div>
      <div class="training-hp-track" role="progressbar" aria-label="${escapeHtml(label)} HP ${hp}" aria-valuemin="0" aria-valuemax="${TRAINING_START_HP}" aria-valuenow="${hp}"><i style="width:${(hp / TRAINING_START_HP) * 100}%"></i></div>
    </div>`;
  return `
    <header class="training-hp-header">
      ${hpBar(state.uid, ownHp, state.name || "YOU", "self")}
      <div class="training-round-counter"><span>DRAW</span><strong>${roundIndex}</strong><small>/ ${TRAINING_MAX_ROUNDS}</small></div>
      ${hpBar(opponentUid, opponentHp, opponentPlayer()?.name || "RIVAL", "rival")}
    </header>`;
}

function renderHealthStopButton() {
  return `<button class="training-health-stop" id="trainingHealthStop" type="button">体調変化のため中止（NO CONTEST）</button>`;
}

function renderCarrotChoice(view = trainingClientView()) {
  const round = view.round || trainingRound(view.roundIndex);
  const ownScore = roundScore(round, state.uid);
  const remoteImage = state.remoteImages[view.roundIndex];
  const opponent = opponentPlayer();
  return `
    <section class="screen training-screen training-score-screen" aria-labelledby="trainingScoreTitle">
      ${renderHpHeader(view.roundIndex)}
      <header class="training-turn-header">
        <span>DRAW ${view.roundIndex} / SECRET SCORE</span>
        <strong>刺さった自分がダメージを受ける</strong>
      </header>
      <div class="training-score-layout">
        <div class="training-score-image">
          ${renderTrainingImageByOwner(opponent?.uid, "相手がDRAWした画像", false, view.roundIndex)}
          <div class="training-bpm-reveal"><span>IMAGE RHYTHM</span><strong>${remoteImage?.bpm ? `${remoteImage.bpm} BPM` : "FREE RHYTHM"}</strong></div>
        </div>
        <section class="training-score-panel">
          ${ownScore ? `
            <span class="eyebrow">SCORE LOCKED</span>
            <h1 id="trainingScoreTitle">${ownScore >= 8 ? scoreConfig(ownScore).label : `${ownScore} / MISS`}</h1>
            <p>${ownScore >= 8
              ? `自分へ${scoreConfig(ownScore).damage}ダメージ。${scoreConfig(ownScore).durationMs / 1000}秒の指示が発動します。`
              : "筋トレは発動しません。相手の秘密採点を待っています。"}</p>
            <div class="training-score-lock"><i></i><span>相手が採点するまで点数は互いに非公開</span></div>
          ` : `
            <span class="eyebrow">HOW DEEP DID IT HIT?</span>
            <h1 id="trainingScoreTitle">この画像は、どこまで刺さった？</h1>
            <p>1～7はMISS。8以上を付けると、あなたのHPが減り、${escapeHtml(opponent?.name || "相手")}のCOMMANDで鍛えます。</p>
            <div class="training-score-grid" aria-label="相手画像を1点から10点で採点">
              ${Array.from({ length: 10 }, (_, index) => index + 1).map((score) => {
                const info = scoreConfig(score);
                return `<button type="button" data-training-score="${score}" class="${score >= 8 ? `is-hit score-${score}` : ""}" ${state.scoreSubmitting ? "disabled" : ""}><strong>${score}</strong><span>${score >= 8 ? `${info.damage} DMG / ${info.durationMs / 1000}s` : "MISS"}</span></button>`;
              }).join("")}
            </div>
            <p class="training-choice-privacy">秘密採点は一度だけ。双方が確定するまで相手の点数は読み込みません。</p>
          `}
          ${renderHealthStopButton()}
        </section>
      </div>
    </section>`;
}

function renderInstructionComposer(view = trainingClientView()) {
  const round = view.round || trainingRound(view.roundIndex);
  const traineeUid = view.traineeUid || opponentPlayer()?.uid || "";
  const trainee = playerByUid(traineeUid);
  const score = roundScore(round, traineeUid);
  const info = scoreConfig(score);
  const used = usedCommandIndexes(state.uid);
  return `
    <section class="screen training-screen training-command-screen" aria-labelledby="trainingCommandTitle">
      ${renderHpHeader(view.roundIndex)}
      <header class="training-turn-header">
        <span>${escapeHtml(info.label)} / COMMAND SELECT</span>
        <strong>${escapeHtml(trainee?.name || "相手")}へ${info.durationMs / 1000}秒の指示</strong>
      </header>
      <div class="training-command-grid">
        ${renderTrainingImageByOwner(state.uid, "相手へ刺さった自分の画像", false, view.roundIndex)}
        <section class="training-command-card">
          <span class="eyebrow">CHOOSE 1 OF YOUR UNUSED CARDS</span>
          <h1 id="trainingCommandTitle">どのCOMMANDで鍛える？</h1>
          <div class="training-trainee-state">
            <span>${info.damage} DAMAGE / ${info.durationMs / 1000} SEC</span>
            <p>希望強度：${escapeHtml(INTENSITY_LABELS[trainee?.intensity] || INTENSITY_LABELS.standard)}<br />配慮：${escapeHtml(trainee?.conditions || "指定なし")}</p>
          </div>
          <div class="training-command-choice-list">
            ${state.commandDeck.map((cardValue, index) => {
              const card = normalizeCommandCard(cardValue);
              const cardIndex = index + 1;
              const disabled = used.has(cardIndex);
              return `<button type="button" data-training-command-choice="${cardIndex}" ${disabled || state.commandSubmitting ? "disabled" : ""}>
                <span>COMMAND ${cardIndex}${disabled ? " / USED" : ""}</span>
                <strong>${escapeHtml(card.exercise)}</strong>
                <p>${escapeHtml(card.command)}</p>
                <small>${card.beatsPerRep}拍で1回</small>
              </button>`;
            }).join("")}
          </div>
          <p class="training-subtle">対戦中に負荷を盛ることはできません。準備画面で登録した3枚から選びます。</p>
          ${renderHealthStopButton()}
        </section>
      </div>
    </section>`;
}

function opponentWorkoutContext(roundIndex = currentRoundIndex()) {
  const round = trainingRound(roundIndex);
  const opponentUid = opponentPlayer()?.uid || "";
  const score = roundScore(round, opponentUid);
  const choice = round.commandChoices?.[opponentUid];
  if (score < 8 || !choice) return null;
  return {
    roundIndex,
    score,
    info: scoreConfig(score),
    workout: round.workouts?.[opponentUid] || {},
    opponentUid,
    card: commandCardFor(state.uid, choice.cardIndex),
  };
}

function workoutIsActive(round, uid) {
  const workout = round?.workouts?.[uid] || {};
  return Number(workout.startedAt || 0) > 0
    && !Number(workout.completedAt || 0);
}

function workoutCommunicationContext(view = trainingClientView()) {
  const roundIndex = Number(view?.roundIndex || currentRoundIndex());
  const round = view?.round || trainingRound(roundIndex);
  const opponentUid = opponentPlayer()?.uid || "";
  const ownActive = workoutIsActive(round, state.uid);
  const opponentActive = workoutIsActive(round, opponentUid);
  return {
    round,
    roundIndex,
    opponentUid,
    ownActive,
    opponentActive,
    enabled: Boolean(opponentUid && (ownActive || opponentActive)),
    workoutUid: ownActive ? state.uid : opponentActive ? opponentUid : "",
  };
}

function clearWorkoutMessageOverlayTimers(targetState = state) {
  targetState.workoutMessageOverlayTimers.forEach((timer) => window.clearTimeout(timer));
  targetState.workoutMessageOverlayTimers.clear();
  targetState.workoutMessageOverlayIds = [];
}

function clearWorkoutMessageRetryTimers(targetState = state) {
  targetState.workoutMessageRetryTimers.forEach((timer) => window.clearTimeout(timer));
  targetState.workoutMessageRetryTimers.clear();
}

function ensureWorkoutMessageRound(roundIndex) {
  const normalizedRound = Number(roundIndex);
  const roomId = String(state.roomId || "");
  if (state.workoutMessageRoomId === roomId
    && state.workoutMessageRound === normalizedRound) return;
  clearWorkoutMessageOverlayTimers();
  clearWorkoutMessageRetryTimers();
  state.workoutMessageRoomId = roomId;
  state.workoutMessageRound = normalizedRound;
  state.giveUpArmed = false;
  state.workoutMessageDraft = "";
  state.workoutMessages = [];
  state.workoutMessageIds = new Set();
  state.workoutMessageAcks = {};
  state.workoutMessageLastSentAt = 0;
  window.clearTimeout(state.workoutMessageCooldownTimer);
  state.workoutMessageCooldownTimer = null;
}

function verifiedTrainingChatFrameId(uid) {
  const chatFrameId = String(state.room.chatFrames?.[uid] || "");
  return chatCosmeticClassNames(chatFrameId, "") ? chatFrameId : "";
}

function workoutMessageDeliveryLabel(message) {
  if (message.fromUid !== state.uid) return "";
  return state.workoutMessageAcks[message.messageId] === "displayed"
    ? "相手画面に表示済み"
    : "送信済み";
}

function renderWorkoutMessage(message, { overlay = false } = {}) {
  const own = message.fromUid === state.uid;
  const sender = playerByUid(message.fromUid);
  const roleLabel = message.workoutUid === message.fromUid ? "WORKOUT" : "CHEER";
  const frameClasses = chatCosmeticClassNames(
    verifiedTrainingChatFrameId(message.fromUid),
    "",
  );
  const delivery = workoutMessageDeliveryLabel(message);
  return `
    <article class="training-workout-message chat-message ${own ? "is-own" : "is-partner"} ${overlay ? "is-overlay" : ""}" data-workout-message-id="${escapeHtml(message.messageId)}">
      <div class="training-workout-message-meta">
        <span>${escapeHtml(own ? "自分" : sender?.name || "相手")} · ${roleLabel}</span>
        ${delivery ? `<small>${escapeHtml(delivery)}</small>` : ""}
      </div>
      <p class="training-workout-message-bubble ${frameClasses}">${escapeHtml(message.text)}</p>
    </article>`;
}

function workoutMessagesForRound(roundIndex) {
  return state.workoutMessages.filter((message) => message.round === Number(roundIndex));
}

function renderWorkoutMessageHistory(roundIndex) {
  const messages = workoutMessagesForRound(roundIndex);
  if (!messages.length) {
    return `<p class="training-workout-message-empty">最初の一言を送って、一緒に完遂を目指しましょう。</p>`;
  }
  return messages.map((message) => renderWorkoutMessage(message)).join("");
}

function renderWorkoutMessageOverlay(roundIndex) {
  const visibleIds = new Set(state.workoutMessageOverlayIds);
  return workoutMessagesForRound(roundIndex)
    .filter((message) => visibleIds.has(message.messageId))
    .slice(-TRAINING_WORKOUT_MESSAGE_OVERLAY_LIMIT)
    .map((message) => renderWorkoutMessage(message, { overlay: true }))
    .join("");
}

function renderWorkoutCommunication(
  view = trainingClientView(),
  { role = "coach" } = {},
) {
  const context = workoutCommunicationContext(view);
  ensureWorkoutMessageRound(context.roundIndex);
  const quickMessages = role === "trainee" ? WORKOUT_REPLIES : CHEERS;
  const inputPlaceholder = role === "trainee"
    ? "例：届いてる、ここから完遂する！"
    : "例：その一回が明日の自信になる！";
  const coolingDown = Date.now() - state.workoutMessageLastSentAt
    < TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS;
  return `
    <section class="training-workout-communication ${role === "trainee" ? "is-trainee" : "is-coach"}" data-training-workout-communication aria-label="ワークアウトチャット">
      <header>
        <div><span>TWO-WAY P2P</span><strong>${role === "trainee" ? "筋トレ中の一言を返す" : "相手を応援する"}</strong></div>
        <small>回数上限なし · 保存なし</small>
      </header>
      <div class="training-workout-quick-buttons" aria-label="${role === "trainee" ? "ワンタップ返信" : "ワンタップ応援"}">
        ${Object.entries(quickMessages).map(([id, label]) => `<button type="button" data-training-workout-quick="${id}" ${!context.enabled || coolingDown ? "disabled" : ""}>${escapeHtml(label)}</button>`).join("")}
      </div>
      <div class="training-workout-free-message">
        <label for="trainingWorkoutMessage">自由な一言 <span>40文字以内</span></label>
        <div>
          <input id="trainingWorkoutMessage" maxlength="40" value="${escapeHtml(state.workoutMessageDraft)}" placeholder="${escapeHtml(inputPlaceholder)}" ${context.enabled ? "" : "disabled"} />
          <button type="button" id="trainingSendWorkoutMessage" ${!context.enabled || coolingDown ? "disabled" : ""}>送信</button>
        </div>
      </div>
      <div class="training-workout-message-history" id="trainingWorkoutMessageHistory" role="log" aria-live="polite">
        ${renderWorkoutMessageHistory(context.roundIndex)}
      </div>
      <p class="training-workout-delivery-note">「表示済み」は相手のブラウザに表示された合図です。返信は任意です。</p>
    </section>`;
}

function renderWaitingInstruction(view = trainingClientView()) {
  const ownScore = roundScore(view.round, state.uid);
  const partnerWorkout = opponentWorkoutContext(view.roundIndex);
  const partnerActive = Number(partnerWorkout?.workout?.startedAt || 0) > 0
    && !Number(partnerWorkout?.workout?.completedAt || 0);
  const title = view.phase === "waiting_command"
    ? `${escapeHtml(opponentPlayer()?.name || "相手")}がCOMMANDを選んでいます`
    : view.phase === "round_complete"
      ? "ラウンド結果を確定しています"
      : partnerActive
        ? `${escapeHtml(opponentPlayer()?.name || "相手")}が鍛えています`
        : "相手の進行を待っています";
  queueMicrotask(() => ensureRoundProgress().catch(handleRecoverableError));
  return `
    <section class="screen training-screen training-waiting-command" aria-labelledby="trainingWaitingCommandTitle">
      ${renderHpHeader(view.roundIndex)}
      <header class="training-turn-header">
        <span>DRAW ${view.roundIndex} / ${ownScore >= 8 ? scoreConfig(ownScore).label : "STANDBY"}</span>
        <strong>${partnerActive ? "COACH THE RIVAL" : "SYNCING ROUND"}</strong>
      </header>
      <div class="training-workout-image-stage">
        ${partnerWorkout
          ? renderTrainingImageByOwner(state.uid, "相手へ刺さった画像", false, view.roundIndex)
          : renderTrainingImageByOwner(opponentPlayer()?.uid, "今回DRAWされた相手画像", false, view.roundIndex)}
        <div class="training-workout-message-overlay" id="trainingWorkoutMessageOverlay" aria-hidden="true">${renderWorkoutMessageOverlay(view.roundIndex)}</div>
      </div>
      <div class="training-waiting-copy">
        <span class="eyebrow">${partnerActive ? "P2P CHEER AVAILABLE" : "PLEASE WAIT"}</span>
        <h1 id="trainingWaitingCommandTitle">${title}</h1>
        <p>${partnerActive
          ? "自分のターンが終わっていても、P2Pの掛け声で相手を応援できます。"
          : "画像・採点・COMMAND・完遂を二人のブラウザで確認しています。"}</p>
        ${partnerActive ? renderCoachRecovery(view, partnerWorkout) : ""}
        ${renderHealthStopButton()}
      </div>
    </section>`;
}

function renderTrainingHud(view = trainingClientView()) {
  const context = ownWorkoutContext(view.roundIndex);
  if (!context) return renderWaitingInstruction(view);
  const startedAt = Number(context.workout?.startedAt || 0);
  const elapsed = workoutElapsed(context.workout);
  const remaining = Math.max(0, context.scoreInfo.durationMs - elapsed);
  const seconds = Math.ceil(remaining / 1000);
  const progress = context.scoreInfo.durationMs
    ? (remaining / context.scoreInfo.durationMs) * 100
    : 0;
  const trainer = playerByUid(context.trainerUid);
  const card = normalizeCommandCard(context.card);
  return `
    <section class="screen training-screen training-hud is-trainee is-hp-workout" aria-labelledby="trainingHudTitle">
      ${renderHpHeader(view.roundIndex)}
      <header class="training-hud-header">
        <div><span>${escapeHtml(context.scoreInfo.label)} / ${context.scoreInfo.damage} DAMAGE</span><strong>${startedAt ? "WORKOUT ACTIVE" : "COMMAND RECEIVED"}</strong></div>
        <div class="training-hud-name">${escapeHtml(trainer?.name || "TRAINER")}</div>
      </header>
      <div class="training-image-arena">
        <div class="training-countdown-progress" id="trainingCountdownProgress" role="progressbar" aria-label="筋トレ 残り${seconds}秒" aria-valuemin="0" aria-valuemax="${context.scoreInfo.durationMs / 1000}" aria-valuenow="${seconds}"><i id="trainingCountdownFill" style="width:${progress}%"></i></div>
        ${renderTrainingImageByOwner(context.trainerUid, "自分へ刺さった相手画像", true, view.roundIndex)}
        <div class="training-stage-badge" id="trainingStageBadge">${escapeHtml(context.scoreInfo.label)}</div>
        <div class="training-countdown-clock" aria-hidden="true"><strong id="trainingCountdown">${seconds}</strong><span>SEC</span></div>
        <div class="training-workout-message-overlay" id="trainingWorkoutMessageOverlay" aria-hidden="true">${renderWorkoutMessageOverlay(view.roundIndex)}</div>
      </div>
      <section class="training-live-command">
        <span>${escapeHtml(card.exercise)}</span>
        <h1 id="trainingHudTitle">${escapeHtml(card.command)}</h1>
        <p>COMPLETE：${escapeHtml(card.completion)}</p>
      </section>
      <section class="training-beat-panel" aria-label="拍レーン">
        <div class="training-beat-meta">
          <strong>${context.bpm ? `${context.bpm} BPM` : "FREE RHYTHM"}</strong>
          <span>${context.bpm ? `${card.beatsPerRep}拍で1回` : "この画像はメトロノームなし"}</span>
        </div>
        <div class="training-beat-lane ${context.bpm ? "" : "is-off"}" id="trainingBeatLane" aria-hidden="true">${Array.from({ length: card.beatsPerRep }, (_, index) => `<i data-beat="${index + 1}"></i>`).join("")}</div>
        <div class="training-audio-controls">
          ${state.ambienceResumeRequired ? `<button type="button" id="trainingResumeAmbience">メトロノームを再開</button>` : ""}
          <button type="button" id="trainingMute" aria-pressed="${state.muted}">${state.muted ? "音を出す" : "ミュート"}</button>
          <label><span>音量</span><input id="trainingVolume" type="range" min="0" max="1" step="0.01" value="${state.volume}" /></label>
        </div>
      </section>
      ${renderWorkoutCommunication(view, { role: startedAt ? "trainee" : "coach" })}
      <div class="training-turn-actions">
        ${startedAt
          ? `<div class="training-base-promise"><strong>${context.scoreInfo.durationMs / 1000} SEC</strong><span>時間到達で自動COMPLETE</span></div>`
          : `<button class="button button-training training-start-button" id="trainingStartWorkout" type="button">${escapeHtml(card.exercise)}を開始</button>`}
      </div>
      ${renderTrainingSafetyBar()}
    </section>`;
}

function renderCoachRecovery(view, context = opponentWorkoutContext(view.roundIndex)) {
  return `
    <section class="training-coach-recovery" aria-label="相手を応援">
      <div class="training-recovery-panel">
        <span>YOUR IMAGE HIT / COACH</span>
        <strong>${escapeHtml(context?.card?.exercise || "筋トレ")}を見守る</strong>
        <p>画像厳選が刺さった結果です。相手の完遂をロールプレイで支えましょう。</p>
      </div>
      ${renderWorkoutCommunication(view, { role: "coach" })}
    </section>`;
}

function renderTrainingSafetyBar() {
  return `
    <div class="training-safety-bar" aria-label="トレーニング中止操作">
      <button type="button" id="trainingHealthStop">体調変化で中止 <span>NO CONTEST</span></button>
      <button type="button" id="trainingGiveUp">GIVE UP</button>
    </div>
    ${state.giveUpArmed ? `
      <div class="training-give-up-confirm-backdrop" id="trainingGiveUpConfirmBackdrop">
        <section class="training-give-up-confirm" role="dialog" aria-modal="true" aria-labelledby="trainingGiveUpConfirmTitle">
          <span>GIVE UP / 敗北</span>
          <h2 id="trainingGiveUpConfirmTitle">筋トレを完遂せず、敗北を確定しますか？</h2>
          <p>痛み・めまい・体調変化がある場合は戻って「体調変化で中止」を選んでください。NO CONTESTになります。</p>
          <div>
            <button type="button" id="trainingCancelGiveUp">トレーニングへ戻る</button>
            <button type="button" id="trainingGiveUpConfirm">GIVE UPを確定</button>
          </div>
        </section>
      </div>` : ""}`;
}

function renderTrainingImageByOwner(ownerUid, alt, compact, roundIndex = currentRoundIndex()) {
  const ownImage = ownerUid === state.uid;
  const draw = roundDraw(trainingRound(roundIndex), ownerUid);
  const image = ownImage
    ? state.localImages[Number(draw?.imageIndex || 0) - 1]
    : state.remoteImages[roundIndex];
  if (image?.url) {
    return `<figure class="training-opponent-image ${ownImage ? "is-own-carrot" : "is-partner-carrot"} ${compact ? "is-compact" : ""}"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(alt)}" /><figcaption>DRAW ${roundIndex} · ${Number(draw?.bpm || image.bpm) ? `${Number(draw?.bpm || image.bpm)} BPM` : "FREE RHYTHM"}</figcaption></figure>`;
  }
  return `<div class="training-opponent-image training-image-placeholder ${compact ? "is-compact" : ""}" aria-label="${escapeHtml(alt)}"><span>DRAW ${roundIndex}</span><strong>画像を検証中</strong></div>`;
}

function resultOverkill(view) {
  const canonical = Number(view?.result?.finisher?.overkill);
  if (Number.isFinite(canonical) && canonical >= 0) return canonical;
  const loserUid = view?.result?.loserUid || "";
  if (!loserUid) return 0;
  return Math.max(0, damageTakenBy(loserUid) - TRAINING_START_HP);
}

function renderFinisher(view) {
  const overkill = resultOverkill(view);
  if (view?.result?.finisher && view.result.finisher.eligible !== true) return "";
  if (overkill <= 0 || !["win", "loss"].includes(view?.result?.type)) return "";
  const winner = view.result.type === "win";
  const finisher = state.finisher;
  if (!finisher && winner) {
    return `<section class="training-finisher"><span class="eyebrow">OVERKILL +${overkill}</span><h2>追い込みトレーニングを提案できます</h2><p>勝敗と記録はすでに確定。相手が自由に断れる、30秒の任意フィニッシュです。</p><div class="training-finisher-cards">${state.commandDeck.map((card, index) => `<button type="button" data-training-finisher-offer="${index + 1}"><strong>${escapeHtml(card.exercise)}</strong><span>30 SEC / 任意</span></button>`).join("")}</div></section>`;
  }
  if (!finisher) return `<section class="training-finisher"><span class="eyebrow">OVERKILL +${overkill}</span><p>相手から任意の追い込み提案が届く場合があります。勝敗・記録には影響しません。</p></section>`;
  if (finisher.status === "offered" && !winner) {
    const offerSeconds = Math.max(0, Math.ceil((Number(finisher.expiresAt || 0) - firebaseNow()) / 1000));
    return `<section class="training-finisher"><span class="eyebrow">OPTIONAL FINISHER / ${offerSeconds} SEC TO ANSWER</span><h2>${escapeHtml(finisher.card?.exercise || "追い込み")}・30秒</h2><p>断っても敗北結果は変わらず、不利益はありません。</p><div><button class="button button-training" id="trainingFinisherAccept" type="button">受ける</button><button class="button button-ghost" id="trainingFinisherDecline" type="button">今回は断る</button></div></section>`;
  }
  if (finisher.status === "accepted" && !winner && !finisher.startedAt) {
    return `<section class="training-finisher"><span class="eyebrow">FINISHER ACCEPTED</span><h2>${escapeHtml(finisher.card?.exercise || "追い込み")}・30秒</h2><button class="button button-training" id="trainingFinisherStart" type="button">追い込みを開始</button></section>`;
  }
  if (finisher.status === "active" && !winner) {
    const remaining = Math.max(0, FINISHER_DURATION_MS - (firebaseNow() - Number(finisher.startedAt || 0)));
    return `<section class="training-finisher is-active"><span class="eyebrow">OPTIONAL FINISHER</span><h2>${Math.ceil(remaining / 1000)} SEC</h2><p>${escapeHtml(finisher.card?.command || "")}</p></section>`;
  }
  const offerSeconds = Math.max(0, Math.ceil((Number(finisher.expiresAt || 0) - firebaseNow()) / 1000));
  const labels = { offered: `相手の返答を待っています（残り${offerSeconds}秒）`, accepted: "相手が追い込みを受けました", active: "相手が追い込み中", complete: "追い込み完遂", declined: "相手は今回は断りました", expired: "提案の15秒が終了しました" };
  return `<section class="training-finisher"><span class="eyebrow">OPTIONAL FINISHER</span><h2>${escapeHtml(labels[finisher.status] || "提案を終了しました")}</h2><p>勝敗・RATE・記録には影響しません。</p></section>`;
}

function renderResult() {
  const view = state.outcome || trainingClientView();
  const result = view.result || { type: "draw", reason: "round_limit" };
  const rivalUid = opponentPlayer()?.uid || "";
  const ownHp = Number(view.hpByUid?.[state.uid] ?? hpFor(state.uid));
  const rivalHp = Number(view.hpByUid?.[rivalUid] ?? hpFor(rivalUid));
  const finalizedRoundCount = Number(
    view.roundCount
    ?? (state.room.serverFinalized?.version === TRAINING_PROTOCOL_VERSION ? view.roundIndex : NaN),
  );
  const drawCount = Number.isSafeInteger(finalizedRoundCount)
    && finalizedRoundCount >= 0
    && finalizedRoundCount <= TRAINING_MAX_ROUNDS
    ? finalizedRoundCount
    : completedRoundCount();
  const finalizedWorkoutSeconds = Number(view.workoutSecondsByUid?.[state.uid]);
  const workoutSeconds = Number.isFinite(finalizedWorkoutSeconds) && finalizedWorkoutSeconds >= 0
    ? finalizedWorkoutSeconds
    : completedTrainingSeconds(state.room.rounds);
  const ownImageScores = resultImageScoreMetrics(view, state.uid);
  const rivalImageScores = resultImageScoreMetrics(view, rivalUid);
  const showTieBreak = ownHp === rivalHp
    && !result.noContest
    && !["health_stop", "surrender"].includes(result.reason);
  const heading = result.noContest || result.reason === "health_stop"
    ? "NO CONTEST"
    : result.type === "win"
      ? "YOU WIN"
      : result.type === "loss"
        ? "TRAINING LOSS"
        : "DRAW";
  const copy = result.reason === "health_stop"
    ? "体調変化を最優先し、勝敗なしで終了しました。"
    : result.reason === "surrender"
    ? (result.type === "win" ? "相手がGIVE UPしました。" : "GIVE UPが確定しました。")
    : result.reason === "hp_zero" && ownHp === 0 && rivalHp === 0
      ? "同じDRAWで二人のHPが0になりました。"
      : result.reason === "round_limit"
        ? "5枚をすべてDRAWしました。残りHPと画像の刺さり方で判定しました。"
        : "画像厳選と筋トレのHP勝負が決着しました。";
  return `
    <section class="screen training-screen training-result ${result.type}" aria-labelledby="trainingResultTitle">
      <span class="eyebrow">HP BATTLE COMPLETE / NO RATE</span>
      <h1 id="trainingResultTitle">${heading}</h1>
      <p class="training-result-copy">${copy} RATE・ランキングは変動しません。</p>
      <div class="training-result-stats">
        <div><strong>${ownHp}</strong><span>YOUR HP</span></div>
        <div><strong>${rivalHp}</strong><span>RIVAL HP</span></div>
        <div><strong>${ownImageScores.total}</strong><span>YOUR IMAGE SCORE</span></div>
        <div><strong>${rivalImageScores.total}</strong><span>RIVAL IMAGE SCORE</span></div>
        <div><strong>${drawCount}</strong><span>DRAWS</span></div>
        <div><strong>${workoutSeconds}</strong><span>WORKOUT SEC</span></div>
      </div>
      ${showTieBreak ? `
        <section class="training-tiebreak" aria-label="同HPの判定根拠">
          <span class="eyebrow">SAME HP / TIE BREAK</span>
          <h2>画像の刺さり方で判定</h2>
          <div class="training-tiebreak-grid">
            <div><strong>YOU</strong><span>合計 ${ownImageScores.total}点</span><span>10点 × ${ownImageScores.tens}</span><span>9点 × ${ownImageScores.nines}</span></div>
            <div><strong>RIVAL</strong><span>合計 ${rivalImageScores.total}点</span><span>10点 × ${rivalImageScores.tens}</span><span>9点 × ${rivalImageScores.nines}</span></div>
          </div>
          <p>HP → 画像の合計点 → 10点の数 → 9点の数の順で判定します。</p>
        </section>` : ""}
      ${renderFinisher(view)}
      ${renderFinalizationStatus()}
      <div class="training-result-actions">
        <button class="button button-training" id="trainingToFreeTable" type="button">自由卓で一息つく</button>
        <button class="button button-ghost" id="trainingResultHome" type="button">タイトルへ戻る</button>
      </div>
    </section>`;
}

function renderFinalizationStatus() {
  if (state.preview) return `<div class="training-save-status"><i></i>UI PREVIEW / Firebase書き込みなし</div>`;
  if (trainingServerFinalizedResult(state.room.serverFinalized, state.uid)) {
    return `<div class="training-save-status is-complete">対戦結果と完遂した運動を記録しました</div>`;
  }
  if (state.finalization?.error) return `<div class="training-save-status is-error"><p>${escapeHtml(state.finalization.error)}</p><button type="button" id="trainingRetryFinalize">記録を再確認</button></div>`;
  if (state.finalization?.result?.status === "final") return `<div class="training-save-status is-complete">対戦結果と完遂した運動を記録しました</div>`;
  return `<div class="training-save-status" role="status"><i></i>対戦記録を確認しています…</div>`;
}

function bindEvents() {
  document.querySelector("#trainingImageInput")?.addEventListener("change", (event) => prepareImages(event.target.files));
  document.querySelectorAll("[data-training-image-input]").forEach((input) => input.addEventListener("change", (event) => {
    prepareImage(event.target.files?.[0], Number(input.dataset.trainingImageInput)).catch(handleRecoverableError);
  }));
  document.querySelector("#trainingSampleImage")?.addEventListener("click", () => fillSampleImages().catch(handleRecoverableError));
  document.querySelectorAll("[data-training-remove-image]").forEach((button) => button.addEventListener("click", () => {
    removeLocalImage(Number(button.dataset.trainingRemoveImage));
  }));
  document.querySelectorAll("[data-training-image-bpm]").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.trainingImageBpm);
      const bpm = normalizeImageBpm(input.value);
      if (state.localImages[index]) state.localImages[index].bpm = bpm;
      input.setCustomValidity(bpm < 0 ? "BPMは0、または40～160で入力してください。" : "");
      updateSetupButton();
    });
    input.addEventListener("change", () => {
      const index = Number(input.dataset.trainingImageBpm);
      if (state.localImages[index] && normalizeImageBpm(state.localImages[index].bpm) < 0) {
        state.localImages[index].bpm = 0;
      }
      render();
    });
  });
  document.querySelectorAll("[data-training-command-field]").forEach((input) => input.addEventListener("input", () => {
    const [indexValue, key] = String(input.dataset.trainingCommandField).split(":");
    const index = Number(indexValue);
    const limit = TRAINING_LIMITS[key] || TRAINING_LIMITS.command;
    if (!state.commandDeck[index]) return;
    state.commandDeck[index][key] = input.value.slice(0, limit);
    updateSetupButton();
  }));
  document.querySelectorAll("[data-training-command-beats]").forEach((input) => input.addEventListener("change", () => {
    const index = Number(input.dataset.trainingCommandBeats);
    if (state.commandDeck[index]) state.commandDeck[index].beatsPerRep = Number(input.value);
    updateSetupButton();
  }));
  document.querySelectorAll("[data-training-command-preset]").forEach((button) => button.addEventListener("click", () => {
    const [indexValue, presetId] = String(button.dataset.trainingCommandPreset).split(":");
    applyCommandPreset(Number(indexValue), presetId);
  }));
  document.querySelector("#trainingPlayerName")?.addEventListener("input", (event) => {
    state.name = event.target.value.slice(0, TRAINING_LIMITS.name);
    updateSetupButton();
  });
  document.querySelector("#trainingConditions")?.addEventListener("input", (event) => {
    state.conditions = event.target.value.slice(0, TRAINING_LIMITS.conditions);
    const count = document.querySelector("#trainingConditionsCount");
    if (count) count.textContent = String(state.conditions.length);
  });
  document.querySelectorAll('input[name="trainingIntensity"]').forEach((input) => input.addEventListener("change", () => {
    state.intensity = normalizeTrainingIntensity(input.value);
  }));
  document.querySelector("#trainingChatFrame")?.addEventListener("change", (event) => {
    saveTrainingChatFrame(event.target.value).catch(handleRecoverableError);
  });
  document.querySelector("#trainingSetupForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    beginMatchmaking().catch(handleFatalError);
  });
  document.querySelector("#trainingCancelMatch")?.addEventListener("click", () => cancelMatchmaking().catch(handleRecoverableError));
  document.querySelector("#trainingCancelPending")?.addEventListener("click", () => cancelPendingRoom().catch(handleRecoverableError));
  document.querySelectorAll("[data-training-score]").forEach((button) => button.addEventListener("click", () => {
    submitScore(Number(button.dataset.trainingScore)).catch(handleRecoverableError);
  }));
  document.querySelectorAll("[data-training-command-choice]").forEach((button) => button.addEventListener("click", () => {
    submitCommandChoice(Number(button.dataset.trainingCommandChoice)).catch(handleRecoverableError);
  }));
  document.querySelector("#trainingStartWorkout")?.addEventListener("click", () => startWorkout().catch(handleRecoverableError));
  document.querySelector("#trainingGiveUp")?.addEventListener("click", () => handleGiveUp().catch(handleRecoverableError));
  document.querySelector("#trainingGiveUpConfirm")?.addEventListener("click", () => handleGiveUp().catch(handleRecoverableError));
  document.querySelector("#trainingHealthStop")?.addEventListener("click", () => handleHealthStop().catch(handleRecoverableError));
  document.querySelector("#trainingCancelGiveUp")?.addEventListener("click", () => {
    state.giveUpArmed = false;
    render();
  });
  document.querySelector("#trainingGiveUpConfirmBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id !== "trainingGiveUpConfirmBackdrop") return;
    state.giveUpArmed = false;
    render();
  });
  document.querySelectorAll("[data-training-workout-quick]").forEach((button) => button.addEventListener("click", () => {
    sendWorkoutMessage({ kind: "quick", quickId: button.dataset.trainingWorkoutQuick });
  }));
  document.querySelector("#trainingWorkoutMessage")?.addEventListener("input", (event) => {
    state.workoutMessageDraft = event.target.value.slice(0, 40);
  });
  document.querySelector("#trainingWorkoutMessage")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    sendFreeCheer();
  });
  document.querySelector("#trainingSendWorkoutMessage")?.addEventListener("click", sendFreeCheer);
  document.querySelector("#trainingMute")?.addEventListener("click", toggleMute);
  document.querySelector("#trainingResumeAmbience")?.addEventListener("click", () => {
    resumeTrainingAmbienceFromGesture().catch(handleRecoverableError);
  });
  document.querySelector("#trainingVolume")?.addEventListener("input", updateVolume);
  document.querySelectorAll("[data-training-finisher-offer]").forEach((button) => button.addEventListener("click", () => {
    offerFinisher(Number(button.dataset.trainingFinisherOffer));
  }));
  document.querySelector("#trainingFinisherAccept")?.addEventListener("click", () => respondFinisher(true));
  document.querySelector("#trainingFinisherDecline")?.addEventListener("click", () => respondFinisher(false));
  document.querySelector("#trainingFinisherStart")?.addEventListener("click", startFinisher);
  document.querySelector("#trainingRetryFinalize")?.addEventListener("click", () => ensureFinalization(true));
  document.querySelector("#trainingToFreeTable")?.addEventListener("click", () => moveToFreeTable().catch(handleRecoverableError));
  document.querySelector("#trainingResultHome")?.addEventListener("click", () => requestHome().catch(handleRecoverableError));
  document.querySelector("#trainingCancelledRetry")?.addEventListener("click", () => restartTraining().catch(handleRecoverableError));
  document.querySelector("#trainingCancelledHome")?.addEventListener("click", () => requestHome().catch(handleRecoverableError));
  document.querySelector("#trainingErrorHome")?.addEventListener("click", () => requestHome().catch(handleRecoverableError));
  if (state.currentView && TRAINING_RUNNING_PHASES.includes(state.currentView.phase)) startTurnTicker(state.currentView);
}

function updateSetupButton() {
  const button = document.querySelector("#trainingFindMatch");
  if (button) button.disabled = !setupIsReady();
}

async function prepareImage(file, requestedIndex = -1, { deferRender = false } = {}) {
  if (!file) return;
  const openIndex = requestedIndex >= 0
    ? requestedIndex
    : state.localImages.findIndex((image) => !image);
  if (openIndex < 0 || openIndex >= TRAINING_IMAGE_COUNT) {
    showToast("画像デッキは5枚そろっています。差し替えるカードを選んでください。");
    return;
  }
  setBusy(true, `画像カード${openIndex + 1}を整えています…`);
  try {
    const item = await shared().processImageFile(file, 0, { maxSide: 1280, quality: 0.82 });
    releaseImage(state.localImages[openIndex]);
    state.localImages[openIndex] = { ...item, mime: "image/webp", bpm: 0 };
    showToast(`画像カード${openIndex + 1}をデッキへ加えました。`);
  } catch (error) {
    showToast(error?.message || "画像を準備できませんでした。");
  } finally {
    setBusy(false);
    if (!deferRender) render();
  }
}

async function prepareImages(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files.slice(0, TRAINING_IMAGE_COUNT)) {
    const openIndex = state.localImages.findIndex((image) => !image);
    if (openIndex < 0) break;
    await prepareImage(file, openIndex, { deferRender: true });
  }
  render();
}

async function fillSampleImages() {
  setBusy(true, "5枚のサンプル画像を準備しています…");
  try {
    const items = await shared().createSampleItems(3, TRAINING_IMAGE_COUNT, 0);
    state.localImages.forEach(releaseImage);
    const bpms = [80, 100, 120, 140, 0];
    state.localImages = items.slice(0, TRAINING_IMAGE_COUNT).map((item, index) => ({
      ...item,
      mime: "image/webp",
      bpm: bpms[index],
    }));
  } catch (error) {
    showToast(error?.message || "サンプル画像を準備できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

function removeLocalImage(index) {
  if (!Number.isInteger(index) || index < 0 || index >= TRAINING_IMAGE_COUNT) return;
  releaseImage(state.localImages[index]);
  state.localImages[index] = null;
  render();
}

function applyCommandPreset(index, presetId) {
  const preset = PRESETS[presetId];
  if (!preset || !Number.isInteger(index) || index < 0 || index >= TRAINING_COMMAND_COUNT) return;
  state.commandDeck[index] = normalizeCommandCard(preset);
  render();
}

function releaseImage(image) {
  if (image?.url && !String(image.url).startsWith("data:")) URL.revokeObjectURL(image.url);
}

async function claimTrainingTabOwnership() {
  if (trainingSharedStateOwned) return;
  if (!trainingTabChannel) {
    trainingTabLeaseHeld = true;
    trainingSharedStateOwned = true;
    return;
  }
  const probeId = `${trainingTabId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let ownerResponded = false;
  const listener = (event) => {
    const message = event.data || {};
    if (message.type === "probe-response"
      && message.probeId === probeId
      && message.tabId !== trainingTabId) {
      ownerResponded = true;
    }
  };
  trainingTabChannel.addEventListener("message", listener);
  trainingTabChannel.postMessage({ type: "probe", probeId, tabId: trainingTabId });
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  trainingTabChannel.removeEventListener("message", listener);
  if (ownerResponded) throw new Error("別のタブで鍛え合い60が進行中です。そちらを終了してから開始してください。");

  trainingTabClaimConflict = false;
  trainingTabClaiming = true;
  trainingTabLeaseHeld = true;
  trainingTabChannel.postMessage({ type: "claim", tabId: trainingTabId });
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  trainingTabClaiming = false;
  if (trainingTabClaimConflict || !trainingTabLeaseHeld) {
    trainingTabLeaseHeld = false;
    throw new Error("別のタブでも同時に鍛え合い60が開始されました。開始するタブを1つにしてください。");
  }
  trainingSharedStateOwned = true;
}

function releaseTrainingTabOwnership() {
  trainingTabLeaseHeld = false;
  trainingSharedStateOwned = false;
  trainingTabClaimConflict = false;
  trainingTabClaiming = false;
}

async function confirmSameTrainingSessionOwnerGone(expectedState = state) {
  if (!trainingTabChannel) return false;
  const probeId = createOnlineSessionToken(globalThis.crypto);
  let ownerResponded = false;
  let responseWasUnverifiable = false;
  const listener = (event) => {
    const message = event.data || {};
    if (message.type !== "probe-response"
        || message.probeId !== probeId
        || message.tabId === trainingTabId) return;
    const exactOwnerResponse = message.sessionOwnerProbeVersion
        === TRAINING_SESSION_OWNER_PROBE_VERSION
      && message.sessionId === expectedState.clientSessionId
      && typeof message.leaseToken === "string"
      && message.leaseToken.length > 0
      && message.leaseToken !== expectedState.clientLeaseToken;
    if (exactOwnerResponse) ownerResponded = true;
    else responseWasUnverifiable = true;
  };
  trainingTabChannel.addEventListener("message", listener);
  trainingTabChannel.postMessage({
    type: "probe",
    sessionOwnerProbeVersion: TRAINING_SESSION_OWNER_PROBE_VERSION,
    probeId,
    tabId: trainingTabId,
    sessionId: expectedState.clientSessionId,
    leaseToken: expectedState.clientLeaseToken,
  });
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  trainingTabChannel.removeEventListener("message", listener);
  return !ownerResponded && !responseWasUnverifiable;
}

async function readTrainingActiveRoomState(roomId) {
  const base = `online/trainingRooms/${roomId}`;
  const keys = [
    "protocolVersion", "variant", "createdAt", "status",
    "members", "presence", "destroyed", "serverFinalized",
  ];
  const snapshots = await Promise.all(keys.map((key) => get(ref(database, `${base}/${key}`))));
  return Object.fromEntries(keys.map((key, index) => [key, snapshots[index].val()]));
}

async function clearStaleTrainingActiveBeforeMatchmaking() {
  const activeRef = ref(database, `online/trainingActive/${state.uid}`);
  const activeSnapshot = await get(activeRef);
  const activeValue = activeSnapshot.val() || {};
  const sessions = activeValue.rooms || {};
  const roomIds = Object.entries(sessions)
    .filter(([, claimed]) => claimed === true)
    .map(([roomId]) => roomId);
  for (const observedRoomId of roomIds) {
    let room = null;
    try {
      room = await readTrainingActiveRoomState(observedRoomId);
    } catch (error) {
      if (!String(error?.code || "").toLowerCase().includes("permission")) throw error;
    }
    const live = trainingActiveRoomAppearsLive(room, state.uid, firebaseNow());
    if (live) {
      if (room.protocolVersion !== TRAINING_PROTOCOL_VERSION
        || room.variant !== TRAINING_VARIANT) {
        throw new Error(
          "旧バージョンの鍛え合いが進行中です。元のタブで最後まで進めてください。"
          + "難しい場合は、そのタブから退出してから新しく開始してください。",
        );
      }
      throw new Error("別のタブで鍛え合い60が進行中です。そちらを終了してから開始してください。");
    }
    if (!await removeTrainingActiveChild(observedRoomId)) {
      throw new Error(
        "以前の鍛え合い予約を解除できませんでした。通信を確認して、もう一度開始してください。",
      );
    }
  }
  if (typeof activeValue.roomId === "string") {
    if (!await removeTrainingActiveParentIfOwned(activeValue.roomId)) {
      throw new Error(
        "以前の鍛え合い予約を解除できませんでした。通信を確認して、もう一度開始してください。",
      );
    }
  }
  const remainingSnapshot = await get(activeRef);
  if (remainingSnapshot.exists()) {
    throw new Error(
      "鍛え合い予約の解除を確認できませんでした。別の端末を確認して、もう一度開始してください。",
    );
  }
}

function createTrainingQueueSessionId() {
  return normalizeTrainingSessionId(globalThis.crypto?.randomUUID?.())
    || normalizeTrainingSessionId(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function queueEntryBelongsToSession(entry, sessionId = state.queueSessionId) {
  return Boolean(
    sessionId
    && normalizeTrainingSessionId(entry?.sessionId) === sessionId
    && entry?.uid === state.uid
  );
}

async function claimTrainingQueueSession() {
  const sessionId = createTrainingQueueSessionId();
  if (!sessionId) throw new Error("待機セッションを作成できませんでした。");
  const now = firebaseNow();
  const queueEntry = {
    uid: state.uid,
    sessionId,
    name: state.name,
    intensity: state.intensity,
    commandDeck: commandDeckPayload(),
    imageBpms: imageBpmsPayload(),
    protocolVersion: TRAINING_PROTOCOL_VERSION,
    variant: TRAINING_VARIANT,
    joinedAt: now,
    lastSeen: now,
    state: "waiting",
  };
  state.queueSessionId = sessionId;
  const transaction = await runTransaction(
    ref(database, `online/trainingQueue/${state.uid}`),
    (current) => {
      const lastSeen = Number(current?.lastSeen || 0);
      const otherFreshSession = current
        && normalizeTrainingSessionId(current.sessionId) !== sessionId
        && Number.isFinite(lastSeen)
        && lastSeen >= now - TRAINING_QUEUE_RECLAIM_MS;
      if (otherFreshSession) return undefined;
      return queueEntry;
    },
  );
  const claimed = transaction.snapshot.val();
  if (!transaction.committed || !queueEntryBelongsToSession(claimed, sessionId)) {
    if (state.queueSessionId === sessionId) state.queueSessionId = "";
    throw new Error("別の端末で鍛え合い60の参加待ちが進行中です。そちらを終了してから開始してください。");
  }
  return queueEntry;
}

async function updateOwnedTrainingQueue(patch, sessionId = state.queueSessionId) {
  if (!state.uid || !sessionId || state.preview) return false;
  const lastSeen = firebaseNow();
  const transaction = await runTransaction(
    ref(database, `online/trainingQueue/${state.uid}`),
    (current) => {
      if (current == null) return null;
      if (!queueEntryBelongsToSession(current, sessionId)) return undefined;
      return {
        ...current,
        ...patch,
        uid: state.uid,
        sessionId,
        lastSeen,
      };
    },
    { applyLocally: false },
  ).catch(() => null);
  return Boolean(
    transaction?.committed
    && queueEntryBelongsToSession(transaction.snapshot.val(), sessionId)
  );
}

async function removeOwnedTrainingQueue(sessionId = state.queueSessionId) {
  if (!state.uid || !sessionId || state.preview) return false;
  const transaction = await runTransaction(
    ref(database, `online/trainingQueue/${state.uid}`),
    (current) => {
      if (current == null) return null;
      return queueEntryBelongsToSession(current, sessionId) ? null : undefined;
    },
    { applyLocally: false },
  ).catch(() => null);
  return Boolean(
    transaction?.committed
    && transaction.snapshot.val() === null
  );
}

async function removeTrainingInviteForSession(
  targetUid,
  roomId,
  targetSessionId = state.queueSessionId,
) {
  if (!targetUid || !roomId || !targetSessionId || state.preview) return false;
  const inviteRef = ref(database, `online/trainingInvites/${targetUid}/${roomId}`);
  if (targetUid !== state.uid) {
    try {
      await remove(inviteRef);
      return true;
    } catch {
      return false;
    }
  }
  const transaction = await runTransaction(
    inviteRef,
    (current) => {
      if (current == null) return null;
      return current.targetSessionId === targetSessionId ? null : undefined;
    },
    { applyLocally: false },
  ).catch(() => null);
  return Boolean(
    transaction?.committed
    && transaction.snapshot.val() === null
  );
}

async function cleanupTrainingInvitesForSession(targetSessionId = state.queueSessionId) {
  if (!state.uid || !targetSessionId || state.preview) return true;
  const snapshot = await get(ref(database, `online/trainingInvites/${state.uid}`)).catch(() => null);
  if (!snapshot) return false;
  const invites = snapshot.val() || {};
  const removals = await Promise.all(
    Object.entries(invites)
      .filter(([, invite]) => invite?.targetSessionId === targetSessionId)
      .map(([roomId]) => removeTrainingInviteForSession(state.uid, roomId, targetSessionId)),
  );
  return removals.every(Boolean);
}

async function removeStaleTrainingInvite(roomId, observedInvite, currentSessionId) {
  if (!state.uid || !roomId || !currentSessionId || state.preview) return false;
  const transaction = await runTransaction(
    ref(database, `online/trainingInvites/${state.uid}/${roomId}`),
    (current) => {
      if (current == null) return null;
      if (current.targetSessionId === currentSessionId) return undefined;
      const unchanged = [
        "roomId", "hostUid", "targetSessionId", "protocolVersion", "variant", "createdAt",
      ].every((key) => current[key] === observedInvite?.[key]);
      return unchanged ? null : undefined;
    },
    { applyLocally: false },
  ).catch(() => null);
  const remaining = transaction?.snapshot?.val();
  return Boolean(transaction && (
    (transaction.committed && remaining === null)
    || remaining?.targetSessionId === currentSessionId
  ));
}

async function cleanupStaleTrainingInvites(currentSessionId) {
  if (!state.uid || !currentSessionId || state.preview) return true;
  const snapshot = await get(ref(database, `online/trainingInvites/${state.uid}`)).catch(() => null);
  if (!snapshot) return false;
  const removals = await Promise.all(
    Object.entries(snapshot.val() || {})
      .filter(([, invite]) => invite?.targetSessionId !== currentSessionId)
      .map(([roomId, invite]) => (
        removeStaleTrainingInvite(roomId, invite, currentSessionId)
      )),
  );
  return removals.every(Boolean);
}

function trainingSessionOfferPath(
  uid = state.uid,
  sessionId = state.clientSessionId,
) {
  return buildTrainingSessionOfferPath(uid, sessionId);
}

function trainingSessionSignalPath(roomId, uid, sessionId) {
  return buildTrainingSessionSignalPath(roomId, uid, sessionId);
}

function trainingSessionPresencePath(roomId, uid, sessionId) {
  return buildTrainingSessionPresencePath(roomId, uid, sessionId);
}

function ownTrainingSessionPresence(online = true) {
  return createTrainingSessionPresencePayload({
    sessionId: state.clientSessionId,
    leaseToken: state.clientLeaseToken,
    generation: state.sessionGeneration,
    online,
    updatedAt: firebaseNow(),
  });
}

function trainingSessionContextIsCurrent(expectedGeneration, expectedState = state) {
  return active
    && state === expectedState
    && state.sessionLeaseHeld
    && state.matchmakingGeneration === expectedGeneration;
}

function trainingMatchmakingGenerationIsCurrent(
  expectedGeneration,
  expectedState = state,
) {
  return active
    && state === expectedState
    && state.matchmakingGeneration === expectedGeneration;
}

async function releaseTrainingSessionClaimExact({
  sessionId,
  leaseToken,
  generation,
} = {}) {
  if (!sessionId || !leaseToken || !generation) return false;
  try {
    const response = await trainingSessionActionCallable({
      action: "release",
      sessionId,
      leaseToken,
      generation,
    });
    const result = response?.data || {};
    return result.released === true || result.reason === "lease-lost";
  } catch {
    return false;
  }
}

async function claimTrainingSessionLease(
  expectedGeneration,
  expectedState = state,
) {
  const sessionId = expectedState.clientSessionId;
  const leaseToken = expectedState.clientLeaseToken;
  const contextIsCurrent = () => trainingMatchmakingGenerationIsCurrent(
    expectedGeneration,
    expectedState,
  );
  const ownershipConflictError = () => new Error(
    "鍛え合い60は別のタブまたは端末で使用中です。そちらを閉じてからお試しください。",
  );
  const request = (sameSessionOwnerConfirmedGone = false) => (
    trainingSessionActionCallable({
      action: "claim",
      sessionId,
      leaseToken,
      sameSessionOwnerConfirmedGone,
    })
  );
  const requestWithLegacyDrain = async (sameSessionOwnerConfirmedGone = false) => {
    const deadline = Date.now() + 50_000;
    let response;
    do {
      response = await request(sameSessionOwnerConfirmedGone);
      if (response?.data?.claimed !== false
          || response.data.reason !== "legacy-waiting"
          || !trainingMatchmakingGenerationIsCurrent(
            expectedGeneration,
            expectedState,
          )
          || document.visibilityState !== "visible"
          || !navigator.onLine
          || Date.now() + 5_000 >= deadline) return response;
      showToast("前の鍛え合い待機が終了するのを確認しています。少しお待ちください。");
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
    } while (trainingMatchmakingGenerationIsCurrent(
      expectedGeneration,
      expectedState,
    ));
    return response;
  };
  const abandonStaleResponse = async (candidateResponse) => {
    if (contextIsCurrent()) return false;
    const staleGeneration = String(
      candidateResponse?.data?.sessionGeneration || "",
    );
    const newerAttemptMayAdopt = active
      && state === expectedState
      && state.clientSessionId === sessionId
      && state.clientLeaseToken === leaseToken
      && (
        state.sessionLeaseHeld
        || (state.startingMatchmaking
          && state.matchmakingGeneration !== expectedGeneration)
      );
    if (candidateResponse?.data?.claimed === true && !newerAttemptMayAdopt) {
      await releaseTrainingSessionClaimExact({
        sessionId,
        leaseToken,
        generation: staleGeneration,
      });
    }
    return true;
  };

  let response;
  try {
    response = await requestWithLegacyDrain(false);
  } catch (error) {
    if (!contextIsCurrent()) return false;
    const reason = String(error?.details?.reason || "");
    if (reason !== "same-session-owned-by-another-page"
        || !await confirmSameTrainingSessionOwnerGone(expectedState)) {
      if (reason === "same-session-owned-by-another-page") {
        throw ownershipConflictError();
      }
      throw error;
    }
    if (!contextIsCurrent()) return false;
    response = await requestWithLegacyDrain(true);
  }
  if (await abandonStaleResponse(response)) return false;
  if (response?.data?.claimed === false
      && response.data.reason === "same-session-owned") {
    if (!await confirmSameTrainingSessionOwnerGone(expectedState)) {
      throw ownershipConflictError();
    }
    if (!contextIsCurrent()) return false;
    response = await requestWithLegacyDrain(true);
  }
  if (await abandonStaleResponse(response)) return false;
  if (response?.data?.claimed !== true) {
    const reason = String(response?.data?.reason || "");
    throw new Error(
      reason === "legacy-waiting"
        ? "前の鍛え合い待機が残っています。別のタブを閉じ、少し待ってからお試しください。"
        : reason === "occupied"
          ? "別のタブまたは端末で鍛え合い60が進行中です。"
          : "鍛え合い60は別のタブまたは端末で使用中です。そちらを閉じてからお試しください。",
    );
  }
  const lease = response.data.lease;
  const sessionGeneration = String(response.data.sessionGeneration || "");
  if (!isOnlineSessionLeaseOwner(lease, { sessionId, leaseToken })
      || !/^[-_0-9A-Za-z]{20,80}$/.test(sessionGeneration)) {
    throw new Error("鍛え合い60のセッション所有権を確認できませんでした。");
  }
  if (!contextIsCurrent()) {
    await releaseTrainingSessionClaimExact({
      sessionId,
      leaseToken,
      generation: sessionGeneration,
    });
    return false;
  }
  expectedState.sessionLeaseHeld = true;
  expectedState.sessionLease = lease;
  expectedState.sessionGeneration = sessionGeneration;
  scheduleTrainingSessionHeartbeat(expectedState);
  return true;
}

function clearTrainingSessionHeartbeat(expectedState = state) {
  window.clearTimeout(expectedState.sessionHeartbeat);
  expectedState.sessionHeartbeat = null;
}

function scheduleTrainingSessionHeartbeat(
  expectedState = state,
  delayMs = ONLINE_SESSION_LEASE_DEFAULTS.heartbeatIntervalMs,
) {
  clearTrainingSessionHeartbeat(expectedState);
  if (!active
      || state !== expectedState
      || !expectedState.sessionLeaseHeld) return;
  const serverTimeKnown = expectedState.serverTimeOffsetKnown === true;
  const now = Date.now() + Number(expectedState.serverTimeOffset || 0);
  const remainingMs = Number(expectedState.sessionLease?.expiresAt || 0) - now;
  if (serverTimeKnown && remainingMs <= 0) {
    handleTrainingSessionLeaseLost(expectedState);
    return;
  }
  const requestedDelay = Number.isFinite(Number(delayMs))
    ? Math.max(1, Math.floor(Number(delayMs)))
    : ONLINE_SESSION_LEASE_DEFAULTS.retryIntervalMs;
  const boundedDelay = serverTimeKnown
    ? Math.max(1, Math.min(requestedDelay, remainingMs))
    : requestedDelay;
  const timer = window.setTimeout(() => {
    if (expectedState.sessionHeartbeat !== timer) return;
    expectedState.sessionHeartbeat = null;
    refreshTrainingSessionLease(expectedState).catch((error) => {
      if (active && state === expectedState) handleRecoverableError(error);
    });
  }, boundedDelay);
  expectedState.sessionHeartbeat = timer;
}

async function refreshTrainingSessionLease(expectedState = state) {
  if (!active
      || state !== expectedState
      || !expectedState.sessionLeaseHeld
      || expectedState.sessionHeartbeatInFlight) return false;
  expectedState.sessionHeartbeatInFlight = true;
  let responseData = null;
  try {
    try {
      const response = await trainingSessionActionCallable({
        action: "heartbeat",
        sessionId: expectedState.clientSessionId,
        leaseToken: expectedState.clientLeaseToken,
        generation: expectedState.sessionGeneration,
      });
      responseData = response?.data || null;
    } catch {
      responseData = null;
    }
    if (!active
        || state !== expectedState
        || !expectedState.sessionLeaseHeld) return false;
    const observedNow = Date.now() + Number(expectedState.serverTimeOffset || 0);
    const currentExpiresAt = Number(expectedState.sessionLease?.expiresAt || 0);
    const now = expectedState.serverTimeOffsetKnown === true
      ? observedNow
      : Math.min(observedNow, Math.max(0, currentExpiresAt - 1));
    const decision = decideOnlineSessionHeartbeatResult({
      responseData,
      currentLease: expectedState.sessionLease,
      sessionId: expectedState.clientSessionId,
      leaseToken: expectedState.clientLeaseToken,
      sessionGeneration: expectedState.sessionGeneration,
      now,
      retryIntervalMs: ONLINE_SESSION_LEASE_DEFAULTS.retryIntervalMs,
    });
    if (decision.action === "lost") {
      handleTrainingSessionLeaseLost(expectedState);
      return false;
    }
    if (decision.action === "retry") {
      scheduleTrainingSessionHeartbeat(
        expectedState,
        expectedState.serverTimeOffsetKnown === true
          ? decision.retryDelayMs
          : ONLINE_SESSION_LEASE_DEFAULTS.retryIntervalMs,
      );
      return false;
    }
    expectedState.sessionLease = decision.lease;
    const refreshes = [];
    if (expectedState.roomId) {
      refreshes.push(set(ref(database, trainingSessionPresencePath(
        expectedState.roomId,
        expectedState.uid,
        expectedState.clientSessionId,
      )), createTrainingSessionPresencePayload({
        sessionId: expectedState.clientSessionId,
        leaseToken: expectedState.clientLeaseToken,
        generation: expectedState.sessionGeneration,
        online: true,
        updatedAt: now,
      })));
    }
    await Promise.allSettled(refreshes);
    if (!active
        || state !== expectedState
        || !expectedState.sessionLeaseHeld) return false;
    scheduleTrainingSessionHeartbeat(expectedState);
    return true;
  } finally {
    expectedState.sessionHeartbeatInFlight = false;
  }
}

function handleTrainingSessionLeaseLost(targetState = state) {
  if (!targetState.sessionLeaseHeld) return;
  targetState.sessionLeaseHeld = false;
  clearTrainingSessionHeartbeat(targetState);
  if (!active || state !== targetState) return;
  const roomId = targetState.roomId;
  const message = new Error(
    roomId
      ? "別のタブまたは端末へ鍛え合い60の接続が移ったため、対戦を終了します。"
      : "別のタブまたは端末へ鍛え合い60の待機が移ったため、検索を終了します。",
  );
  (async () => {
    if (roomId && !targetState.outcome) {
      const beforeDestroy = await refreshRoomBeforeDestroy(roomId)
        .catch(() => "live");
      if (beforeDestroy === "result") return;
      await markRoomDestroyed("session_lease_lost").catch(() => {});
      const afterDestroy = await refreshRoomBeforeDestroy(roomId)
        .catch(() => "live");
      if (afterDestroy === "result") return;
    }
    await handleFatalError(message);
  })().catch(handleRecoverableError);
}

async function enqueueTrainingSessionQueue(
  expectedGeneration,
  expectedState = state,
) {
  let lastError = null;
  for (const delayMs of TRAINING_SESSION_RESTART_QUEUE_DELAYS_MS) {
    if (delayMs) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) return false;
    let response;
    try {
      response = await trainingSessionActionCallable(
        trainingSessionPreparationPayload(expectedState),
      );
      lastError = null;
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) return false;
    const result = response?.data || {};
    if (result.queued === true
        && /^[-_0-9A-Za-z]{8,128}$/.test(
          String(result.connectionGeneration || ""),
        )) {
      expectedState.matchmakingGeneration = String(result.connectionGeneration);
      return true;
    }
    if (result.reason === "lease-lost") {
      handleTrainingSessionLeaseLost(expectedState);
      return false;
    }
    if (result.reason === "active") {
      // The enqueue response may have been lost after the server activated a
      // room. Let try_match recover the exact active room and generation.
      return true;
    }
    if (result.reason !== "busy") {
      throw new Error("鍛え合い60の待機情報を準備できませんでした。");
    }
  }
  if (lastError) throw lastError;
  throw new Error(
    "鍛え合い60の再検索準備を確認できませんでした。通信を確認して、もう一度お試しください。",
  );
}

function trainingSessionPreparationPayload(targetState = state) {
  return {
    action: "enqueue",
    sessionId: targetState.clientSessionId,
    leaseToken: targetState.clientLeaseToken,
    name: targetState.name,
    intensity: targetState.intensity,
    commandDeck: commandDeckPayload(targetState.commandDeck),
    imageBpms: imageBpmsPayload(targetState.localImages),
    chatFrameId: validOwnedTrainingChatFrameId(
      targetState.selectedChatFrameId,
      targetState,
    ),
  };
}

function clearTrainingSessionTryMatchTimer(targetState = state) {
  window.clearTimeout(targetState.sessionTryMatchTimer);
  targetState.sessionTryMatchTimer = null;
}

function scheduleTrainingSessionTryMatch(delayMs = 1_200) {
  const expectedState = state;
  clearTrainingSessionTryMatchTimer(expectedState);
  const generation = expectedState.matchmakingGeneration;
  if (!trainingSessionContextIsCurrent(generation, expectedState)
      || expectedState.screen !== "matching"
      || expectedState.pendingRoomId
      || expectedState.roomId) return;
  expectedState.sessionTryMatchTimer = window.setTimeout(() => {
    expectedState.sessionTryMatchTimer = null;
    if (!trainingSessionContextIsCurrent(generation, expectedState)) return;
    tryTrainingSessionMatch(generation).catch(handleRecoverableError);
  }, Math.max(0, delayMs));
}

async function tryTrainingSessionMatch(expectedGeneration = state.matchmakingGeneration) {
  const expectedState = state;
  if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)
      || state.screen !== "matching"
      || state.sessionTryMatchBusy
      || state.pendingRoomId
      || state.roomId) return;
  expectedState.sessionTryMatchBusy = true;
  try {
    const response = await trainingSessionActionCallable({
      action: "try_match",
      sessionId: expectedState.clientSessionId,
      leaseToken: expectedState.clientLeaseToken,
      avoidUid: expectedState.sessionAvoidUid || "",
      conditions: expectedState.conditions,
    });
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) return;
    const payload = response?.data || {};
    if (payload.outcome === "lease-lost") {
      handleTrainingSessionLeaseLost(expectedState);
      return;
    }
    if (["offered", "join"].includes(payload.outcome) && payload.roomId) {
      const connectionGeneration = String(payload.connectionGeneration || "");
      if (!/^[-_0-9A-Za-z]{8,128}$/.test(connectionGeneration)) {
        throw new Error("鍛え合い60の接続世代を確認できませんでした。");
      }
      await prepareTrainingSessionRoom(
        payload.roomId,
        payload,
        payload.role === "guest" ? "guest" : "host",
      );
      return;
    }
  } catch (error) {
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) return;
    throw error;
  } finally {
    expectedState.sessionTryMatchBusy = false;
    if (trainingSessionContextIsCurrent(expectedGeneration, expectedState)
        && state.screen === "matching"
        && !state.pendingRoomId
        && !state.roomId) {
      scheduleTrainingSessionTryMatch();
    }
  }
}

async function acceptTrainingSessionOffer(roomId, offer) {
  const expectedState = state;
  if (state.sessionOfferHandling
      || state.pendingRoomId
      || state.roomId
      || state.screen !== "matching"
      || !state.sessionLeaseHeld) return false;
  const expectedGeneration = state.matchmakingGeneration;
  expectedState.sessionOfferHandling = true;
  try {
    let response;
    try {
      response = await trainingSessionActionCallable({
        action: "accept",
        sessionId: expectedState.clientSessionId,
        leaseToken: expectedState.clientLeaseToken,
        roomId,
        conditions: expectedState.conditions,
      });
    } catch (error) {
      scheduleTrainingSessionOfferRetry(
        roomId,
        offer,
        2_000,
        expectedGeneration,
        expectedState,
      );
      if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) {
        return false;
      }
      throw error;
    }
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)
        || state.screen !== "matching") return false;
    const payload = response?.data || {};
    if (payload.accepted !== true) {
      if (payload.reason === "lease-lost") {
        handleTrainingSessionLeaseLost(expectedState);
      } else if (payload.reason === "transition-busy") {
        scheduleTrainingSessionOfferRetry(
          roomId,
          offer,
          2_000,
          expectedGeneration,
          expectedState,
        );
      }
      return false;
    }
    window.clearTimeout(state.sessionOfferRetryTimer);
    state.sessionOfferRetryTimer = null;
    await prepareTrainingSessionRoom(roomId, { ...offer, ...payload }, "guest");
    return true;
  } catch (error) {
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) {
      return false;
    }
    throw error;
  } finally {
    expectedState.sessionOfferHandling = false;
  }
}

function scheduleTrainingSessionOfferRetry(
  roomId,
  offer,
  delayMs = 2_000,
  expectedGeneration = state.matchmakingGeneration,
  expectedState = state,
) {
  if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) return;
  window.clearTimeout(expectedState.sessionOfferRetryTimer);
  expectedState.sessionOfferRetryTimer = window.setTimeout(() => {
    expectedState.sessionOfferRetryTimer = null;
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)
        || state.screen !== "matching"
        || state.pendingRoomId
        || state.roomId) return;
    acceptTrainingSessionOffer(roomId, offer).catch(handleRecoverableError);
  }, Math.max(250, delayMs));
}

function watchTrainingSessionOffers(
  expectedGeneration,
  expectedState = state,
) {
  if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) return;
  const offsetUnsubscribe = onValue(
    ref(database, ".info/serverTimeOffset"),
    (snapshot) => {
      if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)) return;
      applyTrainingServerTimeOffset(expectedState, snapshot);
    },
    () => {},
  );
  const offersRef = ref(database, trainingSessionOfferPath(
    expectedState.uid,
    expectedState.clientSessionId,
  ));
  const unsubscribe = onChildAdded(offersRef, (snapshot) => {
    if (!trainingSessionContextIsCurrent(expectedGeneration, expectedState)
        || state.screen !== "matching") return;
    const offer = snapshot.val() || {};
    const decision = decideTrainingSessionOffer({
      offer,
      roomId: snapshot.key,
      ownUid: expectedState.uid,
      ownSessionId: expectedState.clientSessionId,
      ownGeneration: expectedState.sessionGeneration,
      now: Date.now() + Number(expectedState.serverTimeOffset || 0),
      isCurrentLeaseOwner: expectedState.sessionLeaseHeld,
    });
    if (!decision.accepted) return;
    acceptTrainingSessionOffer(snapshot.key, offer).catch(handleRecoverableError);
  }, (error) => {
    if (trainingSessionContextIsCurrent(expectedGeneration, expectedState)) {
      handleRecoverableError(error);
    }
  });
  expectedState.matchmakingUnsubscribers.push(offsetUnsubscribe, unsubscribe);
}

async function prepareTrainingSessionRoom(roomId, context, role) {
  const expectedState = state;
  if (!state.sessionLeaseHeld || state.pendingRoomId || state.roomId) return false;
  const expectedMatchmakingGeneration = state.matchmakingGeneration;
  const expectedSessionGeneration = state.sessionGeneration;
  const expectedSessionId = state.clientSessionId;
  const room = await readRoomSkeleton(roomId);
  if (!active
      || state !== expectedState
      || !state.sessionLeaseHeld
      || state.matchmakingGeneration !== expectedMatchmakingGeneration
      || state.sessionGeneration !== expectedSessionGeneration
      || state.clientSessionId !== expectedSessionId
      || state.pendingRoomId
      || state.roomId) return false;
  const ownSession = room.sessions?.[state.uid];
  if (!trainingSessionRoomMemberMatches(room, {
    uid: state.uid,
    sessionId: state.clientSessionId,
    generation: state.sessionGeneration,
    attemptId: context.attemptId,
    connectionGeneration: context.connectionGeneration,
  }) || ownSession?.sessionId !== state.clientSessionId) {
    throw new Error("現在の鍛え合いセッションに一致する対戦ルームを確認できませんでした。");
  }
  // Commit the server generation only after the room can be read and its
  // immutable session fence is verified. A transient read failure must leave
  // the current offer watcher and try_match retry generation usable.
  state.matchmakingGeneration = String(room.connectionGeneration);
  const opponentUid = room.hostUid === state.uid ? room.guestUid : room.hostUid;
  state.sessionAvoidUid = "";
  state.opponentSessionId = String(room.sessions?.[opponentUid]?.sessionId || "");
  state.roomConnectionGeneration = room.connectionGeneration;
  state.signalingAttemptId = room.attemptId;
  state.pendingRoomId = roomId;
  state.sessionOfferRoomId = roomId;
  state.pendingInviteTargetSessionId = state.clientSessionId;
  state.room = { ...emptyRoom(), ...room };
  state.screen = "forming";
  clearTrainingSessionTryMatchTimer();
  render();
  watchTrainingSessionRoom(roomId, role);
  state.matchTimer = window.setTimeout(() => {
    expireTrainingSessionRoom(roomId).catch(handleFatalError);
  }, MATCH_TIMEOUT_MS + 5_000);
  if (room.status === "active") await enterRoom(roomId);
  return true;
}

function watchTrainingSessionRoom(roomId) {
  const context = Object.freeze({
    expectedState: state,
    sessionId: state.clientSessionId,
    sessionGeneration: state.sessionGeneration,
    attemptId: state.signalingAttemptId,
    connectionGeneration: state.roomConnectionGeneration,
  });
  const contextIsCurrent = () => (
    active
    && state === context.expectedState
    && state.sessionLeaseHeld
    && state.pendingRoomId === roomId
    && !state.roomId
    && state.clientSessionId === context.sessionId
    && state.sessionGeneration === context.sessionGeneration
    && state.signalingAttemptId === context.attemptId
    && state.roomConnectionGeneration === context.connectionGeneration
    && state.room.attemptId === context.attemptId
    && state.room.connectionGeneration === context.connectionGeneration
  );
  const handleContextError = (error) => {
    if (contextIsCurrent()) handleRecoverableError(error);
  };
  const base = `online/trainingRooms/${roomId}`;
  let lastKnownStatus = state.room.status;
  const react = ({ roomMissing = false } = {}) => {
    if (!contextIsCurrent()) return;
    if (state.room.status === "active") {
      enterRoom(roomId).catch(handleRecoverableError);
    } else if (roomMissing
        || ["expired", "cancelled"].includes(state.room.status)
        || state.room.destroyed) {
      restartTrainingSessionSearch(roomId).catch(handleFatalError);
    } else {
      render();
    }
  };
  state.matchmakingUnsubscribers.push(onValue(
    ref(database, `${base}/status`),
    (snapshot) => {
      if (!contextIsCurrent()) return;
      const status = snapshot.val() || "";
      const roomMissing = status === "" && lastKnownStatus === "offered";
      if (status) lastKnownStatus = status;
      state.room.status = status;
      react({ roomMissing });
    },
    handleContextError,
  ));
  state.matchmakingUnsubscribers.push(onValue(
    ref(database, `${base}/destroyed`),
    (snapshot) => {
      if (!contextIsCurrent()) return;
      state.room.destroyed = snapshot.val() || null;
      react();
    },
    handleContextError,
  ));
}

async function expireTrainingSessionRoom(roomId) {
  if (state.pendingRoomId !== roomId || state.roomId) return;
  const response = await trainingSessionActionCallable({
    action: "expire",
    sessionId: state.clientSessionId,
    leaseToken: state.clientLeaseToken,
    roomId,
  });
  if (state.pendingRoomId !== roomId || state.roomId) return;
  const result = response?.data || {};
  if (result.status === "active" || result.reason === "active") {
    state.room.status = "active";
    await enterRoom(roomId);
    return;
  }
  if (result.cancelled === true
      || ["terminal", "not-owner"].includes(String(result.reason || ""))
      || ["expired", "cancelled"].includes(String(result.status || ""))) {
    await restartTrainingSessionSearch(roomId);
    return;
  }
  if (result.status === "offered"
      || ["transition-busy", "stale", "room-changed"].includes(
        String(result.reason || ""),
      )) {
    window.clearTimeout(state.matchTimer);
    state.matchTimer = window.setTimeout(() => {
      expireTrainingSessionRoom(roomId).catch(handleFatalError);
    }, 2_000);
    return;
  }
  throw new Error("鍛え合い60の対戦準備状態を確認できませんでした。");
}

async function restartTrainingSessionSearch(roomId, { avoidUid = "" } = {}) {
  const expectedState = state;
  if (expectedState.sessionRestartPromise) {
    return expectedState.sessionRestartPromise;
  }
  if (!active
      || state !== expectedState
      || !expectedState.sessionLeaseHeld
      || (roomId && (
        expectedState.roomId
        || !expectedState.pendingRoomId
        || expectedState.pendingRoomId !== roomId
      ))) return false;
  const contextIsCurrent = () => active
    && state === expectedState
    && expectedState.sessionLeaseHeld;
  const restart = (async () => {
    window.clearTimeout(expectedState.matchTimer);
    window.clearTimeout(expectedState.sessionOfferRetryTimer);
    expectedState.matchTimer = null;
    expectedState.sessionOfferRetryTimer = null;
    expectedState.matchmakingUnsubscribers.splice(0)
      .forEach((unsubscribe) => unsubscribe?.());
    expectedState.pendingRoomId = "";
    expectedState.sessionOfferRoomId = "";
    expectedState.opponentSessionId = "";
    expectedState.roomConnectionGeneration = "";
    expectedState.signalingAttemptId = "";
    expectedState.room = emptyRoom();
    expectedState.sessionAvoidUid = avoidUid;

    const expectedGeneration = expectedState.matchmakingGeneration;
    if (!await enqueueTrainingSessionQueue(
      expectedGeneration,
      expectedState,
    ) || !contextIsCurrent()) return false;
    expectedState.screen = "matching";
    render();
    watchTrainingSessionOffers(
      expectedState.matchmakingGeneration,
      expectedState,
    );
    scheduleTrainingSessionTryMatch(0);
    updatePublicPresence("waiting", expectedState).catch((error) => {
      if (contextIsCurrent()) handleRecoverableError(error);
    });
    return true;
  })();
  expectedState.sessionRestartPromise = restart;
  try {
    return await restart;
  } finally {
    if (expectedState.sessionRestartPromise === restart) {
      expectedState.sessionRestartPromise = null;
    }
  }
}

async function beginMatchmaking() {
  const expectedState = state;
  expectedState.name = normalizeTrainingName(expectedState.name);
  expectedState.conditions = normalizeTrainingConditions(expectedState.conditions);
  expectedState.intensity = normalizeTrainingIntensity(expectedState.intensity);
  if (expectedState.startingMatchmaking
    || !expectedState.authReady
    || !expectedState.uid
    || !expectedState.name
    || !setupIsReady()) return;
  if (expectedState.preview) {
    showToast("UIプレビューではFirebaseへ接続しません。");
    return;
  }
  const contextIsCurrent = () => active && state === expectedState;
  expectedState.startingMatchmaking = true;
  expectedState.matchmakingGeneration = createOnlineSessionToken(globalThis.crypto);
  try {
    if (expectedState.chatFrameSavePromise) {
      await expectedState.chatFrameSavePromise;
    }
    if (!contextIsCurrent()) return;
    await claimTrainingTabOwnership();
    if (!contextIsCurrent()) return;
    const offset = await get(ref(database, ".info/serverTimeOffset")).catch(() => null);
    if (!contextIsCurrent()) return;
    applyTrainingServerTimeOffset(expectedState, offset);
    if (!await claimTrainingSessionLease(
      expectedState.matchmakingGeneration,
      expectedState,
    )) {
      throw new Error("鍛え合い60の待機セッションを開始できませんでした。");
    }
    if (!contextIsCurrent()) return;
    if (!await enqueueTrainingSessionQueue(
      expectedState.matchmakingGeneration,
      expectedState,
    )) {
      throw new Error("鍛え合い60の待機情報を準備できませんでした。");
    }
    if (!contextIsCurrent()) return;
    localStorage.setItem(PROFILE_NAME_KEY, expectedState.name);
    expectedState.screen = "matching";
    setTrainingChrome("鍛え合い MATCHING");
    render();
    watchTrainingSessionOffers(
      expectedState.matchmakingGeneration,
      expectedState,
    );
    scheduleTrainingSessionTryMatch(0);
    // Public lobby presence is observational; a counter update must never
    // prevent the private server-owned matcher from starting.
    await startPublicPresence(expectedState).catch((error) => {
      if (contextIsCurrent()) handleRecoverableError(error);
    });
  } catch (error) {
    if (!contextIsCurrent()) return;
    if (expectedState.sessionLeaseHeld) {
      const released = await releaseTrainingSessionClaimExact({
        sessionId: expectedState.clientSessionId,
        leaseToken: expectedState.clientLeaseToken,
        generation: expectedState.sessionGeneration,
      });
      if (!contextIsCurrent()) return;
      if (released) {
        expectedState.sessionLeaseHeld = false;
        expectedState.sessionLease = null;
        expectedState.sessionGeneration = "";
        clearTrainingSessionHeartbeat(expectedState);
      }
    }
    if (!expectedState.sessionLeaseHeld) releaseTrainingTabOwnership();
    throw error;
  } finally {
    expectedState.startingMatchmaking = false;
  }
}

async function beginLegacyTrainingMatchmaking() {
  state.name = normalizeTrainingName(state.name);
  state.conditions = normalizeTrainingConditions(state.conditions);
  state.intensity = normalizeTrainingIntensity(state.intensity);
  if (state.startingMatchmaking
    || !state.authReady
    || !state.uid
    || !state.name
    || !setupIsReady()) return;
  if (state.preview) {
    showToast("UIプレビューではFirebaseへ接続しません。");
    return;
  }
  state.startingMatchmaking = true;
  try {
    await claimTrainingTabOwnership();
    await clearStaleTrainingActiveBeforeMatchmaking();
    const offset = await get(ref(database, ".info/serverTimeOffset")).catch(() => null);
    applyTrainingServerTimeOffset(state, offset);
    const queueEntry = await claimTrainingQueueSession();
    if (!await cleanupStaleTrainingInvites(queueEntry.sessionId)) {
      const queueRemoved = await removeOwnedTrainingQueue(queueEntry.sessionId);
      if (queueRemoved && state.queueSessionId === queueEntry.sessionId) {
        state.queueSessionId = "";
      }
      throw new Error(
        "以前の鍛え合い招待を整理できませんでした。通信を確認して、もう一度開始してください。",
      );
    }
    localStorage.setItem(PROFILE_NAME_KEY, state.name);
    state.screen = "matching";
    setTrainingChrome("鍛え合い MATCHING");
    render();
    await startPublicPresence();
    state.queueHeartbeat = window.setInterval(() => {
      updateOwnedTrainingQueue({ lastSeen: firebaseNow() }, queueEntry.sessionId)
        .then((owned) => {
          if (owned) attemptToHost().catch(handleRecoverableError);
          else if (state.screen === "matching" && state.queueSessionId === queueEntry.sessionId) {
            handleFatalError(new Error("別の端末へ参加待ちが移ったため、この画面の待機を終了しました。"));
          }
        })
        .catch(() => {});
    }, HEARTBEAT_MS);
    state.matchmakingUnsubscribers.push(onValue(ref(database, "online/trainingQueue"), (snapshot) => {
      state.latestQueue = snapshot.val() || {};
      scheduleInviteProcessing(0);
      attemptToHost().catch(handleRecoverableError);
    }, handleRecoverableError));
    state.matchmakingUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
      applyTrainingServerTimeOffset(state, snapshot);
    }));
    state.matchmakingUnsubscribers.push(onValue(ref(database, "online/trainingMatchLock"), () => {
      attemptToHost().catch(handleRecoverableError);
    }));
    state.matchmakingUnsubscribers.push(onValue(ref(database, `online/trainingInvites/${state.uid}`), (snapshot) => {
      state.latestInvites = snapshot.val() || {};
      scheduleInviteProcessing(0);
    }, handleRecoverableError));
  } finally {
    state.startingMatchmaking = false;
  }
}

async function startPublicPresence(targetState = state) {
  await cleanupPublicPresence(targetState);
  if (!active || state !== targetState) return false;
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("鍛え合い60の参加状況を登録できませんでした。");
  targetState.publicPresenceId = presenceId;
  const ownerRef = ref(database, `online/publicPresenceOwners/${presenceId}`);
  await set(ownerRef, targetState.uid);
  if (!active || state !== targetState) {
    await cleanupPublicPresence(targetState);
    return false;
  }
  const ownerDisconnect = onDisconnect(ownerRef);
  await ownerDisconnect.remove();
  if (!active || state !== targetState) {
    await ownerDisconnect.cancel().catch(() => {});
    await cleanupPublicPresence(targetState);
    return false;
  }
  targetState.publicPresenceOwnerDisconnect = ownerDisconnect;
  targetState.publicPresenceState = "waiting";
  await writePublicPresence(targetState);
  if (!active || state !== targetState) {
    await cleanupPublicPresence(targetState);
    return false;
  }
  const disconnect = onDisconnect(ref(database, `online/publicPresence/${presenceId}`));
  await disconnect.remove();
  if (!active || state !== targetState) {
    await disconnect.cancel().catch(() => {});
    await cleanupPublicPresence(targetState);
    return false;
  }
  targetState.publicPresenceDisconnect = disconnect;
  targetState.publicPresenceHeartbeat = window.setInterval(() => {
    if (!active || state !== targetState) return;
    writePublicPresence(targetState).catch(() => {});
  }, HEARTBEAT_MS);
  return true;
}

async function writePublicPresence(targetState = state) {
  if (!targetState.publicPresenceId) return;
  await set(ref(database, `online/publicPresence/${targetState.publicPresenceId}`), {
    mode: "training",
    state: targetState.publicPresenceState || "waiting",
    lastSeen: Date.now() + Number(targetState.serverTimeOffset || 0),
  });
}

async function updatePublicPresence(presenceState, targetState = state) {
  if (!active || state !== targetState || !targetState.publicPresenceId) return false;
  targetState.publicPresenceState = presenceState === "playing" ? "playing" : "waiting";
  await writePublicPresence(targetState);
  return active && state === targetState;
}

async function cleanupPublicPresence(targetState = state) {
  window.clearInterval(targetState.publicPresenceHeartbeat);
  targetState.publicPresenceHeartbeat = null;
  const presenceDisconnect = targetState.publicPresenceDisconnect;
  const ownerDisconnect = targetState.publicPresenceOwnerDisconnect;
  targetState.publicPresenceDisconnect = null;
  targetState.publicPresenceOwnerDisconnect = null;
  await Promise.allSettled([
    presenceDisconnect?.cancel?.(),
    ownerDisconnect?.cancel?.(),
  ]);
  const presenceId = targetState.publicPresenceId;
  targetState.publicPresenceId = "";
  targetState.publicPresenceState = "";
  if (!presenceId || !targetState.uid || targetState.preview) return;
  await Promise.allSettled([
    remove(ref(database, `online/publicPresence/${presenceId}`)),
    remove(ref(database, `online/publicPresenceOwners/${presenceId}`)),
  ]);
}

function freshQueueEntries() {
  return validTrainingQueueEntries(state.latestQueue, {
    now: firebaseNow(),
    freshnessMs: TRAINING_QUEUE_FRESH_MS,
  });
}

function activeTrainingCandidateSkipKeys(entries) {
  const availableKeys = new Set((entries || []).map(trainingQueueEntryKey).filter(Boolean));
  const now = firebaseNow();
  Object.entries(state.unavailableQueueEntries).forEach(([key, expiresAt]) => {
    if (!availableKeys.has(key) || Number(expiresAt || 0) <= now) {
      delete state.unavailableQueueEntries[key];
    }
  });
  return Object.keys(state.unavailableQueueEntries);
}

function markTrainingCandidateUnavailable(entry) {
  const key = trainingQueueEntryKey(entry);
  if (!key || entry?.uid === state.uid) return;
  state.unavailableQueueEntries[key] = firebaseNow() + TRAINING_CANDIDATE_SKIP_MS;
}

function clearTrainingHostTakeoverTimer() {
  window.clearTimeout(state.hostTakeoverTimer);
  state.hostTakeoverTimer = null;
  state.hostTakeoverDueAt = 0;
}

function scheduleTrainingHostTakeover(dueAt) {
  const due = Number(dueAt || 0);
  if (!Number.isFinite(due) || due <= 0) return;
  if (state.hostTakeoverTimer && state.hostTakeoverDueAt <= due) return;
  clearTrainingHostTakeoverTimer();
  state.hostTakeoverDueAt = due;
  state.hostTakeoverTimer = window.setTimeout(() => {
    state.hostTakeoverTimer = null;
    state.hostTakeoverDueAt = 0;
    attemptToHost().catch(handleRecoverableError);
  }, Math.max(0, due - firebaseNow()));
}

function selectCurrentTrainingPair(entries, forceHostTakeover = false) {
  const ownEntry = (entries || []).find((entry) => entry.uid === state.uid);
  const takeoverAt = Number(ownEntry?.joinedAt || 0) + TRAINING_HOST_TAKEOVER_MS;
  const allowHostTakeover = forceHostTakeover
    || (takeoverAt > 0 && firebaseNow() >= takeoverAt);
  return selectTrainingPair(entries, {
    requesterUid: state.uid,
    excludedEntryKeys: activeTrainingCandidateSkipKeys(entries),
    allowHostTakeover,
  });
}

function isTrainingPermissionError(error) {
  return String(error?.code || error?.message || "").toLowerCase().includes("permission");
}

async function attemptToHost() {
  if (!active
    || state.screen !== "matching"
    || state.matchingBusy
    || state.acceptingInvite
    || state.pendingRoomId) return;
  if (!queueEntryBelongsToSession(state.latestQueue?.[state.uid])) return;
  if (hasCurrentTrainingInvite()) {
    await processInvites();
    return;
  }
  const entries = freshQueueEntries();
  const pair = selectCurrentTrainingPair(entries);
  if (pair.length !== 2 || pair[0].uid !== state.uid) {
    const takeoverPair = selectCurrentTrainingPair(entries, true);
    const ownEntry = entries.find((entry) => entry.uid === state.uid);
    if (takeoverPair.length === 2 && takeoverPair[0].uid === state.uid && ownEntry) {
      scheduleTrainingHostTakeover(ownEntry.joinedAt + TRAINING_HOST_TAKEOVER_MS);
    }
    return;
  }
  clearTrainingHostTakeoverTimer();
  await createTrainingRoom(pair);
}

async function refreshTrainingPair(expectedPair) {
  const snapshot = await get(ref(database, "online/trainingQueue"));
  const entries = validTrainingQueueEntries(snapshot.val() || {}, {
    now: firebaseNow(),
    freshnessMs: TRAINING_QUEUE_FRESH_MS,
  });
  const refreshedPair = selectCurrentTrainingPair(entries);
  if (refreshedPair.length !== 2 || expectedPair.length !== 2) return [];
  const unchanged = refreshedPair.every((entry, index) => (
    entry.uid === expectedPair[index]?.uid
    && entry.sessionId === expectedPair[index]?.sessionId
  ));
  return unchanged ? refreshedPair : [];
}

async function acquireMatchLock(roomId) {
  const transaction = await runTransaction(ref(database, "online/trainingMatchLock"), (current) => {
    const now = firebaseNow();
    if (current && current.uid !== state.uid && Number(current.expiresAt || 0) > now) return undefined;
    return { uid: state.uid, roomId, createdAt: now, expiresAt: now + MATCH_LOCK_TTL_MS };
  });
  const lock = transaction.snapshot.val();
  const lockExpiresAt = Number(lock?.expiresAt || 0);
  if (!transaction.committed
    && lock?.uid
    && lock.uid !== state.uid
    && lockExpiresAt > firebaseNow()) {
    scheduleTrainingHostTakeover(lockExpiresAt + MATCH_LOCK_RETRY_GRACE_MS);
  }
  return transaction.committed && lock?.uid === state.uid && lock?.roomId === roomId;
}

async function releaseMatchLock(roomId) {
  const transaction = await runTransaction(
    ref(database, "online/trainingMatchLock"),
    (current) => {
      if (current == null) return null;
      return current.uid === state.uid && current.roomId === roomId
        ? null
        : undefined;
    },
    { applyLocally: false },
  ).catch(() => null);
  if (!transaction) return false;
  const current = transaction.snapshot.val();
  return (transaction.committed && current === null)
    || current?.uid !== state.uid
    || current?.roomId !== roomId;
}

async function armTrainingActiveDisconnect(roomId) {
  if (state.activeDisconnect) {
    await cancelTrainingActiveDisconnect();
  }
  const disconnect = onDisconnect(
    ref(database, `online/trainingActive/${state.uid}/rooms/${roomId}`),
  );
  await disconnect.remove();
  state.activeDisconnect = disconnect;
  state.activeDisconnectRoomId = roomId;
}

async function cancelTrainingActiveDisconnect(roomId = "") {
  if (roomId && state.activeDisconnectRoomId !== roomId) return false;
  const disconnect = state.activeDisconnect;
  if (!disconnect) {
    if (!roomId || state.activeDisconnectRoomId === roomId) {
      state.activeDisconnectRoomId = "";
    }
    return true;
  }
  let cancelled = false;
  try {
    await disconnect.cancel();
    cancelled = true;
  } catch (error) {
    console.error(error);
  } finally {
    if (state.activeDisconnect === disconnect) {
      state.activeDisconnect = null;
      state.activeDisconnectRoomId = "";
    }
  }
  return cancelled;
}

async function armActiveRoomDestroyedDisconnect(roomId) {
  await cancelActiveRoomDestroyedDisconnect();
  const disconnect = onDisconnect(
    ref(database, `online/trainingRooms/${roomId}/destroyed`),
  );
  await disconnect.set({
    by: state.uid,
    at: serverTimestamp(),
    reason: "active_member_disconnected",
  });
  state.activeRoomDestroyedDisconnect = disconnect;
  state.activeRoomDestroyedDisconnectRoomId = roomId;
}

async function cancelActiveRoomDestroyedDisconnect(roomId = "") {
  if (roomId && state.activeRoomDestroyedDisconnectRoomId !== roomId) return false;
  const disconnect = state.activeRoomDestroyedDisconnect;
  if (!disconnect) {
    if (!roomId || state.activeRoomDestroyedDisconnectRoomId === roomId) {
      state.activeRoomDestroyedDisconnectRoomId = "";
    }
    return true;
  }
  let cancelled = false;
  try {
    await disconnect.cancel();
    cancelled = true;
  } catch (error) {
    console.error(error);
  } finally {
    if (state.activeRoomDestroyedDisconnect === disconnect) {
      state.activeRoomDestroyedDisconnect = null;
      state.activeRoomDestroyedDisconnectRoomId = "";
    }
  }
  return cancelled;
}

async function removeTrainingActiveChild(roomId) {
  const transaction = await runTransaction(
    ref(database, `online/trainingActive/${state.uid}/rooms/${roomId}`),
    (current) => current == null || current === true ? null : undefined,
    { applyLocally: false },
  ).catch(() => null);
  return Boolean(
    transaction?.committed
    && transaction.snapshot.val() === null
  );
}

async function removeTrainingActiveParentIfOwned(roomId) {
  const transaction = await runTransaction(
    ref(database, `online/trainingActive/${state.uid}`),
    (current) => {
      if (current == null) return null;
      const rooms = current?.rooms && typeof current.rooms === "object"
        ? current.rooms
        : {};
      const hasClaimedRoom = Object.values(rooms).some((claimed) => claimed === true);
      return current?.roomId === roomId && !hasClaimedRoom ? null : undefined;
    },
    { applyLocally: false },
  ).catch(() => null);
  const current = transaction?.snapshot?.val();
  return Boolean(transaction && (
    (transaction.committed && current === null)
    || (current != null && current.roomId !== roomId)
  ));
}

async function reserveTrainingActiveRoom(roomId) {
  const reservedAt = firebaseNow();
  const transaction = await runTransaction(
    ref(database, `online/trainingActive/${state.uid}`),
    (current) => {
      const sessions = current?.rooms && typeof current.rooms === "object"
        ? current.rooms
        : {};
      if (Object.values(sessions).some((claimed) => claimed === true)) return undefined;
      return { roomId, reservedAt, rooms: { [roomId]: true } };
    },
  );
  const reservation = transaction.snapshot.val();
  return transaction.committed
    && reservation?.roomId === roomId
    && reservation?.reservedAt === reservedAt
    && reservation?.rooms?.[roomId] === true;
}

async function releaseTrainingActiveReservation(roomId) {
  const childReleased = await removeTrainingActiveChild(roomId);
  const parentReleased = childReleased
    ? await removeTrainingActiveParentIfOwned(roomId)
    : false;
  if (!childReleased || !parentReleased) return false;
  const remaining = await get(
    ref(database, `online/trainingActive/${state.uid}`),
  ).catch(() => null);
  if (!remaining) return false;
  const released = remaining.val()?.rooms?.[roomId] !== true;
  if (released) await cancelTrainingActiveDisconnect(roomId);
  return released;
}

async function armFormingRoomDisconnects(roomId, isHost, handles = []) {
  try {
    if (isHost) {
      const statusDisconnect = onDisconnect(ref(database, `online/trainingRooms/${roomId}/status`));
      await statusDisconnect.set("expired");
      handles.push(statusDisconnect);
      state.disconnectHandles.push(statusDisconnect);
    }
    const destroyedDisconnect = onDisconnect(ref(database, `online/trainingRooms/${roomId}/destroyed`));
    await destroyedDisconnect.set({
      by: state.uid,
      at: serverTimestamp(),
      reason: isHost ? "forming_host_disconnected" : "forming_guest_disconnected",
    });
    handles.push(destroyedDisconnect);
    state.disconnectHandles.push(destroyedDisconnect);
    return handles;
  } catch (error) {
    throw error;
  }
}

async function cancelDisconnectHandles(handles) {
  await Promise.allSettled((handles || []).map((handle) => handle?.cancel?.()));
  state.disconnectHandles = state.disconnectHandles.filter((handle) => !handles?.includes(handle));
}

function randomlyChooseUid(firstUid, secondUid) {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] % 2 === 0 ? firstUid : secondUid;
  }
  return Math.random() < 0.5 ? firstUid : secondUid;
}

async function createTrainingRoom(pair) {
  state.matchingBusy = true;
  const roomId = push(ref(database, "online/trainingRooms")).key;
  if (!roomId) {
    state.matchingBusy = false;
    throw new Error("鍛え合いの部屋を作れませんでした。");
  }
  let ownsLock = false;
  let activeReserved = false;
  let roomCreated = false;
  let retryMatching = false;
  let roomDisconnects = [];
  let guestUid = "";
  let guestSessionId = "";
  let guestEntry = null;
  let createdRoom = null;
  let candidatePermissionPhase = "";
  try {
    ownsLock = await acquireMatchLock(roomId);
    if (!ownsLock || state.screen !== "matching") return;
    const refreshedPair = await refreshTrainingPair(pair);
    const host = refreshedPair[0];
    const guest = refreshedPair[1];
    guestEntry = guest || null;
    guestUid = guest?.uid || "";
    guestSessionId = guest?.sessionId || "";
    if (host?.uid !== state.uid
      || host.sessionId !== state.queueSessionId
      || !guestUid
      || !guestSessionId
      || host.uid === guestUid) return;
    if (!await reserveTrainingActiveRoom(roomId)) return;
    activeReserved = true;
    await armTrainingActiveDisconnect(roomId);
    const players = {
      [host.uid]: playerFromQueue(host, state.conditions),
      [guest.uid]: playerFromQueue(guest, ""),
    };
    createdRoom = {
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      hostUid: host.uid,
      guestUid: guest.uid,
      createdAt: serverTimestamp(),
      status: "forming",
      members: { [host.uid]: true, [guest.uid]: true },
      players,
      accepted: { [host.uid]: true },
    };
    candidatePermissionPhase = "room_bootstrap";
    await set(ref(database, `online/trainingRooms/${roomId}`), createdRoom);
    candidatePermissionPhase = "";
    roomCreated = true;
    await armFormingRoomDisconnects(roomId, true, roomDisconnects);
    if (!await updateOwnedTrainingQueue({ state: "forming" }, host.sessionId)) {
      throw new Error("待機セッションが別の端末へ移ったため、部屋作成を中止しました。");
    }
    candidatePermissionPhase = "invite_create";
    await set(ref(database, `online/trainingInvites/${guest.uid}/${roomId}`), {
      roomId,
      hostUid: host.uid,
      targetSessionId: guest.sessionId,
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      createdAt: firebaseNow(),
    });
    candidatePermissionPhase = "";
    if (!await releaseMatchLockReliably(roomId)) {
      throw new Error("対戦準備ロックを終了できませんでした。");
    }
    ownsLock = false;
    state.pendingRoomId = roomId;
    state.pendingInviteTargetSessionId = guest.sessionId;
    state.room = { ...emptyRoom(), ...createdRoom, createdAt: firebaseNow() };
    state.screen = "forming";
    render();
    watchPendingRoom(roomId, true);
    state.matchTimer = window.setTimeout(() => {
      expirePendingRoom(roomId).catch(handleRecoverableError);
    }, MATCH_TIMEOUT_MS);
  } catch (error) {
    const failedCandidatePermissionPhase = candidatePermissionPhase;
    candidatePermissionPhase = "";
    retryMatching = active
      && state.screen === "matching"
      && !state.pendingRoomId
      && !state.roomId;
    if (roomCreated) {
      try {
        await confirmPendingRoomTerminal(roomId, "forming_setup_failed", true);
      } catch (terminalError) {
        retryMatching = false;
        state.pendingRoomId = roomId;
        state.pendingInviteTargetSessionId = guestSessionId;
        state.room = {
          ...emptyRoom(),
          ...(createdRoom || {}),
          createdAt: firebaseNow(),
        };
        state.screen = "forming";
        render();
        throw terminalError;
      }
    }
    await cancelDisconnectHandles(roomDisconnects);
    const inviteCleared = !roomCreated
      || !guestUid
      || await removeTrainingInviteReliably(guestUid, roomId, guestSessionId);
    const activeReleased = !activeReserved
      || await releaseTrainingActiveReservation(roomId);
    const queueReturnedToWaiting = !retryMatching
      || await updateOwnedTrainingQueue({ state: "waiting" });
    if (!inviteCleared || !activeReleased || !queueReturnedToWaiting) {
      retryMatching = false;
      if (roomCreated) {
        state.pendingRoomId = roomId;
        state.pendingInviteTargetSessionId = guestSessionId;
        state.room = {
          ...emptyRoom(),
          ...(createdRoom || {}),
          createdAt: firebaseNow(),
        };
        state.screen = "forming";
        render();
      }
      await handleFatalError(new Error(
        "対戦準備の後始末を確認できませんでした。通信を確認して、もう一度開始してください。",
      ));
      return;
    }
    if (state.pendingRoomId === roomId) state.pendingRoomId = "";
    if (state.pendingInviteTargetSessionId === guestSessionId) {
      state.pendingInviteTargetSessionId = "";
    }
    const permissionError = isTrainingPermissionError(error);
    const candidatePermissionFailure = permissionError
      && ["room_bootstrap", "invite_create"].includes(failedCandidatePermissionPhase);
    let currentInviteStatus = hasCurrentTrainingInvite() ? true : false;
    if (guestEntry && candidatePermissionFailure && !currentInviteStatus) {
      currentInviteStatus = await refreshCurrentTrainingInviteStatus();
    }
    const candidateUnavailable = Boolean(
      guestEntry
      && candidatePermissionFailure
      && currentInviteStatus === false
    );
    if (candidateUnavailable) {
      markTrainingCandidateUnavailable(guestEntry);
    }
    if (candidateUnavailable
      || (candidatePermissionFailure && currentInviteStatus === true)) return;
    throw error;
  } finally {
    if (ownsLock) {
      await releaseMatchLock(roomId);
    }
    state.matchingBusy = false;
    if (hasCurrentTrainingInvite()) {
      scheduleInviteProcessing(0);
    } else if (retryMatching) {
      window.setTimeout(() => attemptToHost().catch(handleRecoverableError), 2_000);
    }
  }
}

function playerFromQueue(entry, conditions = "") {
  return {
    uid: entry.uid,
    name: normalizeTrainingName(entry.name),
    intensity: normalizeTrainingIntensity(entry.intensity),
    conditions: normalizeTrainingConditions(conditions),
    commandDeck: Object.fromEntries(
      Array.from({ length: TRAINING_COMMAND_COUNT }, (_, index) => {
        const cardIndex = index + 1;
        return [cardIndex, normalizeCommandCard(entry.commandDeck?.[cardIndex])];
      }),
    ),
    imageBpms: Object.fromEntries(
      Array.from({ length: TRAINING_IMAGE_COUNT }, (_, index) => {
        const imageIndex = index + 1;
        return [imageIndex, normalizeImageBpm(entry.imageBpms?.[imageIndex])];
      }),
    ),
  };
}

function hasCurrentTrainingInvite() {
  return Object.values(state.latestInvites || {}).some((invite) => (
    invite?.roomId
    && invite?.hostUid
    && invite.targetSessionId === state.queueSessionId
    && invite.protocolVersion === TRAINING_PROTOCOL_VERSION
    && invite.variant === TRAINING_VARIANT
  ));
}

async function refreshCurrentTrainingInviteStatus() {
  try {
    const snapshot = await get(ref(database, `online/trainingInvites/${state.uid}`));
    state.latestInvites = snapshot.val() || {};
    return hasCurrentTrainingInvite();
  } catch {
    return null;
  }
}

function scheduleInviteProcessing(delay = 500) {
  if (state.inviteRetryTimer
    || !active
    || state.screen !== "matching"
    || state.pendingRoomId
    || state.roomId) return;
  state.inviteRetryTimer = window.setTimeout(() => {
    state.inviteRetryTimer = null;
    processInvites().catch((error) => {
      handleRecoverableError(error);
      scheduleInviteProcessing(2_000);
    });
  }, Math.max(0, delay));
}

async function processInvites() {
  if (state.matchingBusy) {
    scheduleInviteProcessing();
    return;
  }
  if (state.acceptingInvite || state.pendingRoomId || state.roomId || state.screen !== "matching") return;
  if (!queueEntryBelongsToSession(state.latestQueue?.[state.uid])) return;
  state.acceptingInvite = true;
  try {
    const invites = Object.entries(state.latestInvites)
      .filter(([, invite]) => (
        invite?.roomId
        && invite?.hostUid
        && invite.targetSessionId === state.queueSessionId
        && invite.protocolVersion === TRAINING_PROTOCOL_VERSION
        && invite.variant === TRAINING_VARIANT
      ))
      .sort(([, first], [, second]) => Number(first.createdAt || 0) - Number(second.createdAt || 0));
    for (const [roomId, invite] of invites) {
      if (await acceptInvite(roomId, invite)) return;
    }
  } finally {
    state.acceptingInvite = false;
  }
}

async function readRoomSkeleton(roomId) {
  const base = `online/trainingRooms/${roomId}`;
  const keys = [
    "protocolVersion", "variant", "sessionProtocolVersion", "signalingVersion",
    "attemptId", "connectionGeneration", "sessions", "hostUid", "guestUid",
    "createdAt", "expiresAt", "status", "members", "players", "chatFrames", "accepted",
  ];
  const snapshots = await Promise.all(keys.map((key) => get(ref(database, `${base}/${key}`))));
  return Object.fromEntries(keys.map((key, index) => [key, snapshots[index].val()]));
}

async function readRoundScoresBounded(roomId, roundIndex) {
  const base = `online/trainingRooms/${roomId}/rounds/${roundIndex}/scores`;
  const scores = {};
  const ownSnapshot = await get(ref(database, `${base}/${state.uid}`)).catch(() => null);
  const ownScore = normalizeScore(ownSnapshot?.val());
  if (!ownScore) return scores;
  scores[state.uid] = ownScore;

  const opponentUid = opponentPlayer()?.uid || "";
  if (!opponentUid) return scores;
  const combinedSnapshot = await get(ref(database, base)).catch(() => null);
  const combinedScores = combinedSnapshot?.val() || {};
  const combinedOpponentScore = normalizeScore(combinedScores[opponentUid]);
  if (combinedOpponentScore) {
    scores[opponentUid] = combinedOpponentScore;
    return scores;
  }
  const opponentSnapshot = await get(ref(database, `${base}/${opponentUid}`)).catch(() => null);
  const opponentScore = normalizeScore(opponentSnapshot?.val());
  if (opponentScore) scores[opponentUid] = opponentScore;
  return scores;
}

async function readTrainingRoundBounded(roomId, roundIndex) {
  const base = `online/trainingRooms/${roomId}/rounds/${roundIndex}`;
  const keys = ["createdAt", "draws", "imageReceived", "commandChoices", "workouts", "completedAt"];
  const snapshots = await Promise.all(keys.map((key) => get(ref(database, `${base}/${key}`))));
  const scores = await readRoundScoresBounded(roomId, roundIndex);
  const round = {};
  keys.forEach((key, index) => {
    if (snapshots[index].exists()) round[key] = snapshots[index].val();
  });
  if (Object.keys(scores).length) round.scores = scores;
  return Object.keys(round).length ? round : null;
}

async function readTrainingRoundsBounded(roomId) {
  const rounds = await Promise.all(
    Array.from({ length: TRAINING_MAX_ROUNDS }, (_, index) => (
      readTrainingRoundBounded(roomId, index + 1)
    )),
  );
  return Object.fromEntries(
    rounds.flatMap((round, index) => round ? [[index + 1, round]] : []),
  );
}

function mergeTrainingRounds(rounds) {
  state.room.rounds ||= {};
  Object.entries(rounds || {}).forEach(([roundIndex, round]) => {
    const current = state.room.rounds[roundIndex] || {};
    state.room.rounds[roundIndex] = {
      ...current,
      ...round,
      ...(round.scores ? { scores: { ...(current.scores || {}), ...round.scores } } : {}),
    };
  });
}

async function readRoomLifecycle(roomId) {
  const base = `online/trainingRooms/${roomId}`;
  const keys = ["status", "surrendered", "destroyed", "serverFinalized"];
  const [snapshots, rounds] = await Promise.all([
    Promise.all(keys.map((key) => get(ref(database, `${base}/${key}`)))),
    readTrainingRoundsBounded(roomId),
  ]);
  return {
    status: snapshots[0].val() || "",
    rounds,
    surrendered: snapshots[1].val() || null,
    destroyed: snapshots[2].val() || null,
    serverFinalized: snapshots[3].val() || null,
  };
}

function viewFromServerFinalized(serverFinalized, fallbackView) {
  const finalizedResult = trainingServerFinalizedResult(serverFinalized, state.uid);
  if (!finalizedResult) return null;
  return {
    ...fallbackView,
    phase: "result",
    ...finalizedResult,
  };
}

function transitionToTrainingResult(view) {
  clearImageExchangeWatchdog();
  clearScorePoll();
  cancelActiveRoomDestroyedDisconnect(state.roomId).catch(() => {});
  state.currentView = view;
  state.outcome = view;
  state.screen = "result";
  state.ambienceController.disable();
  render();
  ensureFinalization();
}

function transitionToDestroyedRoom() {
  clearImageExchangeWatchdog();
  clearScorePoll();
  cancelActiveRoomDestroyedDisconnect(state.roomId).catch(() => {});
  state.channel?.close();
  state.peer?.close();
  state.channel = null;
  state.peer = null;
  state.ambienceController.disable();
  state.screen = "cancelled";
  render();
}

function transitionToLocalNoContestPending() {
  clearImageExchangeWatchdog();
  clearScorePoll();
  state.channel?.close();
  state.peer?.close();
  state.channel = null;
  state.peer = null;
  state.screen = "cancelled";
  state.ambienceController.disable();
  render();
}

async function refreshRoomBeforeDestroy(roomId) {
  let lifecycle = await readRoomLifecycle(roomId);
  if (!active || state.roomId !== roomId) return "stale";
  Object.assign(state.room, lifecycle);

  let outcomeView = deriveTrainingRoomState(
    { ...state.room, destroyed: null },
    state.uid,
    firebaseNow(),
  );
  let finalizedView = viewFromServerFinalized(lifecycle.serverFinalized, outcomeView);
  if (finalizedView) {
    transitionToTrainingResult(finalizedView);
    return "result";
  }
  if (outcomeView.phase === "result") {
    transitionToTrainingResult(outcomeView);
    return "result";
  }
  if (lifecycle.destroyed) {
    transitionToDestroyedRoom();
    return "destroyed";
  }
  state.currentView = outcomeView;
  return "live";
}

async function acceptInvite(roomId, invite) {
  const [room, queueSnapshot] = await Promise.all([
    readRoomSkeleton(roomId),
    get(ref(database, `online/trainingQueue/${state.uid}`)),
  ]);
  if (invite.targetSessionId !== state.queueSessionId
    || !queueEntryBelongsToSession(queueSnapshot.val(), invite.targetSessionId)) {
    return false;
  }
  if (room.protocolVersion !== TRAINING_PROTOCOL_VERSION
    || room.variant !== TRAINING_VARIANT
    || room.status !== "forming"
    || room.guestUid !== state.uid
    || room.members?.[state.uid] !== true
    || room.players?.[state.uid]?.uid !== state.uid
    || invite.hostUid !== room.hostUid) {
    if (!await removeTrainingInviteReliably(
      state.uid,
      roomId,
      invite.targetSessionId,
    )) {
      handleRecoverableError(new Error(
        "無効な対戦招待の整理を再試行します。",
      ));
      scheduleInviteProcessing(2_000);
    }
    return false;
  }
  let activeReserved = false;
  let guestQueueForming = false;
  let roomDisconnects = [];
  try {
    if (!await reserveTrainingActiveRoom(roomId)) {
      scheduleInviteProcessing(1_500);
      return false;
    }
    activeReserved = true;
    await armTrainingActiveDisconnect(roomId);
    await armFormingRoomDisconnects(roomId, false, roomDisconnects);
    if (!await updateOwnedTrainingQueue({ state: "forming" }, invite.targetSessionId)) {
      throw new Error("この端末の待機セッションを確認できませんでした。");
    }
    guestQueueForming = true;
    const acceptanceUpdates = createTrainingAcceptanceUpdates(state.uid, state.conditions);
    await update(ref(database, `online/trainingRooms/${roomId}`), acceptanceUpdates);
  } catch (error) {
    await cancelDisconnectHandles(roomDisconnects);
    const activeReleased = !activeReserved
      || await releaseTrainingActiveReservation(roomId);
    const queueReturnedToWaiting = !guestQueueForming
      || await updateOwnedTrainingQueue(
        { state: "waiting" },
        invite.targetSessionId,
      );
    if (!activeReleased || !queueReturnedToWaiting) {
      await handleFatalError(new Error(
        "対戦参加の後始末を確認できませんでした。通信を確認して、もう一度開始してください。",
      ));
      return false;
    }
    if (active && state.screen === "matching" && !state.pendingRoomId && !state.roomId) {
      scheduleInviteProcessing(1_500);
    }
    throw error;
  }
  const acceptedSessionId = invite.targetSessionId;
  if (!await removeTrainingInviteReliably(state.uid, roomId, acceptedSessionId)) {
    handleRecoverableError(new Error(
      "受け取った対戦招待の整理を入室時に再試行します。",
    ));
  }
  state.pendingRoomId = roomId;
  state.pendingInviteTargetSessionId = acceptedSessionId;
  state.room = {
    ...emptyRoom(),
    ...room,
    players: {
      ...(room.players || {}),
      [state.uid]: {
        ...(room.players?.[state.uid] || {}),
        conditions: normalizeTrainingConditions(state.conditions),
      },
    },
    accepted: { ...(room.accepted || {}), [state.uid]: true },
  };
  state.screen = "forming";
  render();
  watchPendingRoom(roomId, false);
  state.matchTimer = window.setTimeout(() => {
    abandonPendingRoom(roomId).catch(handleFatalError);
  }, MATCH_TIMEOUT_MS + 5_000);
  return true;
}

function watchPendingRoom(roomId, isHost) {
  const base = `online/trainingRooms/${roomId}`;
  const react = () => {
    if (state.pendingRoomId !== roomId) return;
    if (state.screen === "forming") render();
    if (isHost
      && state.room.status === "forming"
      && Object.keys(state.room.accepted || {}).length === 2) {
      transitionTrainingRoomStatus(roomId, "forming", "active")
        .catch(handleRecoverableError);
    }
    if (state.room.status === "active") enterRoom(roomId).catch(handleRecoverableError);
    if (state.room.status === "expired") returnToWaitingQueue(roomId).catch(handleFatalError);
  };
  state.matchmakingUnsubscribers.push(onValue(ref(database, `${base}/accepted`), (snapshot) => {
    state.room.accepted = snapshot.val() || {};
    react();
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, `${base}/status`), (snapshot) => {
    state.room.status = snapshot.val() || "";
    react();
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, `${base}/destroyed`), (snapshot) => {
    if (snapshot.exists() && state.pendingRoomId === roomId) {
      returnToWaitingQueue(roomId).catch(handleFatalError);
    }
  }, handleRecoverableError));
}

function transitionTrainingRoomStatus(roomId, expected, next) {
  return runTransaction(
    ref(database, `online/trainingRooms/${roomId}/status`),
    (current) => (
      current == null || current === expected ? next : undefined
    ),
    { applyLocally: false },
  );
}

async function expirePendingRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId || state.room.hostUid !== state.uid) return;
  const transaction = await transitionTrainingRoomStatus(roomId, "forming", "expired");
  if (transaction.snapshot.val() === "expired") {
    const guestUid = state.room.guestUid;
    const acceptedSnapshot = guestUid
      ? await get(ref(
        database,
        `online/trainingRooms/${roomId}/accepted/${guestUid}`,
      )).catch(() => null)
      : null;
    if (acceptedSnapshot && acceptedSnapshot.val() !== true) {
      markTrainingCandidateUnavailable({
        uid: guestUid,
        sessionId: state.pendingInviteTargetSessionId,
      });
    }
  }
  await releaseMatchLock(roomId);
}

async function destroyPendingRoom(roomId, reason) {
  if (!roomId || !state.uid) return false;
  const transaction = await runTransaction(
    ref(database, `online/trainingRooms/${roomId}/destroyed`),
    (current) => current || {
      by: state.uid,
      at: firebaseNow(),
      reason: String(reason || "forming_cancelled").slice(0, 80),
    },
  );
  return Boolean(transaction.snapshot.val());
}

async function confirmPendingRoomTerminal(roomId, reason, isHost) {
  let statusTerminal = false;
  let destroyedTerminal = false;
  if (isHost) {
    const statusTransaction = await transitionTrainingRoomStatus(
      roomId,
      "forming",
      "expired",
    ).catch(() => null);
    statusTerminal = statusTransaction?.snapshot?.val() === "expired";
  }
  destroyedTerminal = await destroyPendingRoom(roomId, reason).catch(() => false);
  if (!statusTerminal && !destroyedTerminal) {
    const [statusSnapshot, destroyedSnapshot] = await Promise.all([
      get(ref(database, `online/trainingRooms/${roomId}/status`)).catch(() => null),
      get(ref(database, `online/trainingRooms/${roomId}/destroyed`)).catch(() => null),
    ]);
    statusTerminal = statusSnapshot?.val() === "expired";
    destroyedTerminal = Boolean(destroyedSnapshot?.val());
  }
  if (!statusTerminal && !destroyedTerminal) {
    throw new Error("対戦準備中の部屋を終了できませんでした。通信を確認して、もう一度終了してください。");
  }
  return true;
}

async function teardownPendingRoom(reason = "player_exit") {
  if (state.pendingTeardown) return state.pendingTeardown;
  const roomId = state.pendingRoomId;
  if (!roomId || !state.uid || state.preview) return true;
  if (state.sessionLease) {
    const sessionTeardown = trainingSessionActionCallable({
      action: "cancel",
      sessionId: state.clientSessionId,
      leaseToken: state.clientLeaseToken,
      roomId,
      abort: false,
    }).then((response) => {
      const result = response?.data || {};
      if (result.cancelled !== true
          && !["terminal", "not-owner"].includes(String(result.reason || ""))) {
        throw new Error(
          "対戦準備の後始末を確認できませんでした。通信を確認して、もう一度終了してください。",
        );
      }
      if (state.pendingRoomId === roomId) state.pendingRoomId = "";
      state.sessionOfferRoomId = "";
      return true;
    });
    state.pendingTeardown = sessionTeardown;
    try {
      return await sessionTeardown;
    } finally {
      if (state.pendingTeardown === sessionTeardown) state.pendingTeardown = null;
    }
  }
  const targetSessionId = state.pendingInviteTargetSessionId;
  const pendingTeardown = (async () => {
    const isHost = state.room.hostUid === state.uid;
    await confirmPendingRoomTerminal(roomId, reason, isHost);
    const inviteTargetUid = isHost ? state.room.guestUid : state.uid;
    const [inviteCleared, lockReleased] = await Promise.all([
      inviteTargetUid && targetSessionId
        ? removeTrainingInviteReliably(inviteTargetUid, roomId, targetSessionId)
        : Promise.resolve(true),
      releaseMatchLockReliably(roomId),
    ]);
    if (!inviteCleared || !lockReleased) {
      throw new Error(
        "対戦準備の後始末を確認できませんでした。通信を確認して、もう一度終了してください。",
      );
    }
    return true;
  })();
  state.pendingTeardown = pendingTeardown;
  try {
    await pendingTeardown;
    if (state.pendingRoomId === roomId) state.pendingRoomId = "";
    if (state.pendingInviteTargetSessionId === targetSessionId) {
      state.pendingInviteTargetSessionId = "";
    }
    return true;
  } finally {
    if (state.pendingTeardown === pendingTeardown) state.pendingTeardown = null;
  }
}

async function abandonPendingRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId) return;
  const status = (await get(ref(database, `online/trainingRooms/${roomId}/status`))).val();
  if (status === "active") return enterRoom(roomId);
  await destroyPendingRoom(roomId, "forming_timeout");
  await returnToWaitingQueue(roomId);
}

async function returnToWaitingQueue(roomId) {
  if (state.returningToQueue || state.pendingTeardown) return;
  state.returningToQueue = true;
  const targetSessionId = state.pendingInviteTargetSessionId;
  const inviteTargetUid = state.room.hostUid === state.uid
    ? state.room.guestUid
    : state.uid;
  try {
    if (inviteTargetUid
      && targetSessionId
      && !await removeTrainingInviteReliably(
        inviteTargetUid,
        roomId,
        targetSessionId,
      )) {
      throw new Error(
        "対戦招待の終了を確認できませんでした。通信を確認して、もう一度お試しください。",
      );
    }
    const matchmakingCleared = await cleanupMatchmakingReliably(false);
    if (!matchmakingCleared) {
      throw new Error(
        "以前の待機セッションを終了できませんでした。通信を確認して、もう一度開始してください。",
      );
    }
    await cleanupPublicPresence();
    if (!await releaseMatchLockReliably(roomId)) {
      throw new Error(
        "対戦準備ロックの終了を確認できませんでした。通信を確認して、もう一度お試しください。",
      );
    }
    state.pendingRoomId = "";
    state.pendingInviteTargetSessionId = "";
    state.room = emptyRoom();
    state.screen = "matching";
    await beginMatchmaking();
  } finally {
    state.returningToQueue = false;
  }
}

async function enterRoom(roomId) {
  const expectedState = state;
  const contextIsCurrent = () => active && state === expectedState;
  if (expectedState.roomId || expectedState.enteringRoom) return;
  expectedState.enteringRoom = true;
  let roomAssigned = false;
  try {
    const room = await readRoomSkeleton(roomId);
    if (!contextIsCurrent()) return;
    const sessionV2 = room.sessionProtocolVersion === 2;
    if (room.status !== "active"
      || room.protocolVersion !== TRAINING_PROTOCOL_VERSION
      || room.variant !== TRAINING_VARIANT
      || (sessionV2 && (
        !state.sessionLeaseHeld
        || room.signalingVersion !== 2
        || room.sessions?.[state.uid]?.sessionId !== state.clientSessionId
        || room.sessions?.[state.uid]?.generation !== state.sessionGeneration
        || room.attemptId !== state.signalingAttemptId
        || room.connectionGeneration !== state.roomConnectionGeneration
      ))
      || (!sessionV2 && state.sessionLeaseHeld)
      || (!sessionV2 && (
        room.sessionProtocolVersion != null
        || room.signalingVersion != null
      ))
      || room.members?.[state.uid] !== true
      || ![room.hostUid, room.guestUid].includes(state.uid)
      || room.hostUid === room.guestUid) {
      throw new Error("鍛え合い60の部屋へ参加できませんでした。");
    }
    if (sessionV2) {
      await cancelActiveRoomDestroyedDisconnect();
    } else {
      await armActiveRoomDestroyedDisconnect(roomId);
    }
    if (!contextIsCurrent()) return;
    const targetSessionId = state.pendingInviteTargetSessionId;
    if (!state.sessionLeaseHeld && room.guestUid && targetSessionId) {
      const inviteRemoved = await removeTrainingInviteReliably(
        room.guestUid,
        roomId,
        targetSessionId,
      );
      if (!contextIsCurrent()) return;
      if (!inviteRemoved) {
        throw new Error(
          "対戦招待を終了できなかったため、入室を保留しました。通信を確認してください。",
        );
      }
    }
    if (!state.sessionLeaseHeld) {
      const lockReleased = await releaseMatchLockReliably(roomId);
      if (!contextIsCurrent()) return;
      if (!lockReleased) {
        throw new Error(
          "対戦準備ロックを終了できなかったため、入室を保留しました。通信を確認してください。",
        );
      }
    }
    const matchmakingCleaned = await cleanupMatchmakingReliably(true);
    if (!contextIsCurrent()) return;
    if (!matchmakingCleaned) {
      throw new Error(
        "待機セッションを終了できなかったため、対戦開始を中止しました。通信を確認してください。",
      );
    }
    state.roomId = roomId;
    roomAssigned = true;
    window.clearTimeout(state.matchTimer);
    window.clearTimeout(state.enterRoomRetryTimer);
    state.matchTimer = null;
    state.enterRoomRetryTimer = null;
    state.enterRoomRetryAttempts = 0;
    state.pendingRoomId = "";
    state.pendingInviteTargetSessionId = "";
    state.room = { ...emptyRoom(), ...room };
    await updatePublicPresence("playing").catch(handleRecoverableError);
    if (!contextIsCurrent() || state.roomId !== roomId) return;
    state.screen = "room";
    state.roomSyncing = true;
    setTrainingChrome("鍛え合い ACTIVE");
    render();
    const roomSetupContext = createTrainingRoomRuntimeContext(roomId);
    const roomReady = await setupRoomListeners(roomSetupContext);
    if (!roomReady || !trainingRoomRuntimeContextIsCurrent(roomSetupContext)) return;
    state.roomSyncing = false;
    reactToRoomData();
    startImageExchangeWatchdog();
    try {
      const configuration = await window.HariaiOnline?.getP2pIceConfiguration?.();
      if (!contextIsCurrent() || state.roomId !== roomId) return;
      if (Array.isArray(configuration?.iceServers) && configuration.iceServers.length) {
        state.iceServers = configuration.iceServers;
      }
    } catch {
      state.iceServers = FALLBACK_ICE_SERVERS.map((item) => ({ ...item }));
    }
    if (!active || state.roomId !== roomId || state.room.destroyed || state.outcome) return;
    await setupPeerConnection();
  } catch (error) {
    if (!contextIsCurrent()) return;
    state.roomSyncing = false;
    if (!roomAssigned || state.roomId !== roomId) {
      scheduleEnterRoomRetry(roomId, error);
      return;
    }
    clearImageExchangeWatchdog();
    await markRoomDestroyed("room_setup_failed").catch(() => {});
    if (state.outcome) return;
    state.channel?.close();
    state.peer?.close();
    state.channel = null;
    state.peer = null;
    state.ambienceController.disable();
    state.errorMessage = error?.message || "相手との接続を準備できませんでした。";
    state.screen = "error";
    render();
  } finally {
    expectedState.enteringRoom = false;
  }
}

function scheduleEnterRoomRetry(roomId, error) {
  if (!active || state.pendingRoomId !== roomId || state.room.status !== "active") {
    handleRecoverableError(error);
    return;
  }
  handleRecoverableError(error);
  state.enterRoomRetryAttempts += 1;
  if (state.enterRoomRetryAttempts > 6) {
    handleFatalError(new Error(
      "対戦開始の再確認を完了できませんでした。通信を確認して、もう一度開始してください。",
    )).catch(handleRecoverableError);
    return;
  }
  window.clearTimeout(state.enterRoomRetryTimer);
  const delay = Math.min(4_000, 500 * (2 ** (state.enterRoomRetryAttempts - 1)));
  state.enterRoomRetryTimer = window.setTimeout(() => {
    state.enterRoomRetryTimer = null;
    enterRoom(roomId).catch(handleRecoverableError);
  }, delay);
}

function createTrainingRoomRuntimeContext(roomId = state.roomId) {
  const sessionV2 = state.sessionLeaseHeld
    && state.room.sessionProtocolVersion === 2;
  return Object.freeze({
    expectedState: state,
    roomId,
    uid: state.uid,
    sessionV2,
    sessionId: sessionV2 ? state.clientSessionId : "",
    leaseToken: sessionV2 ? state.clientLeaseToken : "",
    opponentSessionId: sessionV2 ? state.opponentSessionId : "",
    sessionGeneration: sessionV2 ? state.sessionGeneration : "",
    attemptId: sessionV2 ? state.signalingAttemptId : "",
    connectionGeneration: sessionV2 ? state.roomConnectionGeneration : "",
  });
}

function trainingRoomRuntimeContextIsCurrent(context) {
  if (!context
      || !active
      || state !== context.expectedState
      || state.roomId !== context.roomId
      || state.uid !== context.uid) return false;
  if (!context.sessionV2) {
    return !state.sessionLeaseHeld
      && state.room.sessionProtocolVersion !== 2;
  }
  return state.sessionLeaseHeld
    && state.clientSessionId === context.sessionId
    && state.clientLeaseToken === context.leaseToken
    && state.opponentSessionId === context.opponentSessionId
    && state.sessionGeneration === context.sessionGeneration
    && state.signalingAttemptId === context.attemptId
    && state.roomConnectionGeneration === context.connectionGeneration
    && state.room.sessionProtocolVersion === 2
    && state.room.attemptId === context.attemptId
    && state.room.connectionGeneration === context.connectionGeneration;
}

async function setupRoomListeners(
  context = createTrainingRoomRuntimeContext(state.roomId),
) {
  const roomId = context.roomId;
  const contextIsCurrent = () => trainingRoomRuntimeContextIsCurrent(context);
  const handleContextError = (error) => {
    if (contextIsCurrent()) handleRecoverableError(error);
  };
  const awaitCurrent = async (operation) => {
    try {
      const value = await operation;
      return { current: contextIsCurrent(), value };
    } catch (error) {
      if (!contextIsCurrent()) return { current: false, value: null };
      throw error;
    }
  };
  if (!contextIsCurrent()) return false;
  const base = `online/trainingRooms/${roomId}`;
  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    if (!contextIsCurrent()) return;
    applyTrainingServerTimeOffset(state, snapshot);
  }));
  const childKeys = ["status", "chatFrames", "surrendered", "destroyed", "serverFinalized"];
  childKeys.forEach((key) => {
    state.roomUnsubscribers.push(onValue(ref(database, `${base}/${key}`), (snapshot) => {
      if (!contextIsCurrent()) return;
      state.room[key] = snapshot.val() || (key === "chatFrames" ? {} : null);
      reactToRoomData();
    }, handleContextError));
  });
  for (let roundIndex = 1; roundIndex <= TRAINING_MAX_ROUNDS; roundIndex += 1) {
    const roundBase = `${base}/rounds/${roundIndex}`;
    ["createdAt", "draws", "imageReceived", "commandChoices", "workouts", "completedAt"].forEach((key) => {
      state.roomUnsubscribers.push(onValue(ref(database, `${roundBase}/${key}`), (snapshot) => {
        if (!contextIsCurrent()) return;
        const round = ensureRoundLocal(roundIndex);
        round[key] = snapshot.val() || (["draws", "imageReceived", "commandChoices", "workouts"].includes(key) ? {} : 0);
        reactToRoomData();
      }, handleContextError));
    });
    state.roomUnsubscribers.push(onValue(
      ref(database, `${roundBase}/scores/${context.uid}`),
      (snapshot) => {
        if (!contextIsCurrent()) return;
        const score = normalizeScore(snapshot.val());
        const round = ensureRoundLocal(roundIndex);
        round.scores = { ...(round.scores || {}) };
        if (score) {
          round.scores[context.uid] = score;
          scheduleScorePoll(0);
        } else {
          delete round.scores[context.uid];
        }
        reactToRoomData();
      },
      handleContextError,
    ));
  }
  if (!context.sessionV2 && state.activeDisconnectRoomId !== roomId) {
    if (!(await awaitCurrent(armTrainingActiveDisconnect(roomId))).current) {
      return false;
    }
  }
  const ownPresenceRef = ref(database, context.sessionV2
    ? trainingSessionPresencePath(
      roomId,
      context.uid,
      context.sessionId,
    )
    : `${base}/presence/${context.uid}`);
  const ownPresence = (online, useServerTimestamp = false) => {
    const updatedAt = useServerTimestamp ? serverTimestamp() : firebaseNow();
    if (!context.sessionV2) return { online, updatedAt };
    const payload = createTrainingSessionPresencePayload({
      sessionId: context.sessionId,
      leaseToken: context.leaseToken,
      generation: context.sessionGeneration,
      online,
      updatedAt: firebaseNow(),
    });
    return useServerTimestamp ? { ...payload, updatedAt } : payload;
  };
  let presenceWritten = false;
  let presenceDisconnect = null;
  const abandonPresence = async () => {
    await Promise.allSettled([
      presenceDisconnect?.cancel?.(),
      presenceWritten
        ? set(ownPresenceRef, ownPresence(false))
        : Promise.resolve(),
    ]);
  };
  try {
    await set(ownPresenceRef, ownPresence(true));
    presenceWritten = true;
    if (!contextIsCurrent()) {
      await abandonPresence();
      return false;
    }
    presenceDisconnect = onDisconnect(ownPresenceRef);
    await presenceDisconnect.set(ownPresence(false, true));
    if (!contextIsCurrent()) {
      await abandonPresence();
      return false;
    }
  } catch (error) {
    await abandonPresence();
    if (!contextIsCurrent()) return false;
    throw error;
  }
  state.disconnectHandles.push(presenceDisconnect);
  const opponentUid = opponentPlayer()?.uid;
  if (opponentUid) {
    const opponentPresencePath = context.sessionV2
      ? trainingSessionPresencePath(
        roomId,
        opponentUid,
        context.opponentSessionId,
      )
      : `${base}/presence/${opponentUid}`;
    state.roomUnsubscribers.push(onValue(ref(database, opponentPresencePath), (snapshot) => {
      if (!contextIsCurrent()) return;
      const presence = snapshot.val();
      if (presence?.online === true) state.opponentWasOnline = true;
      if (!context.sessionV2
          && presence?.online === false
          && state.opponentWasOnline
          && !state.outcome
          && state.roomId) {
        markRoomDestroyed(`disconnect:${opponentUid}`).catch(() => {});
      }
    }, handleContextError));
  }
  const refreshedRounds = await awaitCurrent(readTrainingRoundsBounded(roomId));
  if (!refreshedRounds.current) return false;
  mergeTrainingRounds(refreshedRounds.value);
  return true;
}

function ensureRoundLocal(roundIndex) {
  state.room.rounds ||= {};
  const key = String(roundIndex);
  state.room.rounds[key] ||= {};
  return state.room.rounds[key];
}

function clearScorePoll() {
  window.clearTimeout(state.scorePoll);
  state.scorePoll = null;
}

function completedRoundIndexesMissingScores() {
  const uids = memberUids();
  if (uids.length !== 2) return [];
  return Array.from({ length: TRAINING_MAX_ROUNDS }, (_, index) => index + 1)
    .filter((roundIndex) => {
      const round = trainingRound(roundIndex);
      return Number(round.completedAt || 0) > 0
        && uids.some((uid) => !roundScore(round, uid));
    });
}

function oldestPendingOpponentScoreRoundIndex() {
  const opponentUid = opponentPlayer()?.uid || "";
  if (!opponentUid) return 0;
  for (let roundIndex = 1; roundIndex <= TRAINING_MAX_ROUNDS; roundIndex += 1) {
    const round = trainingRound(roundIndex);
    if (roundScore(round, state.uid) && !roundScore(round, opponentUid)) return roundIndex;
  }
  return 0;
}

function scheduleScorePoll(delay = SCORE_POLL_MS) {
  if (state.scorePoll && delay > 0) return;
  clearScorePoll();
  if (!state.roomId || !oldestPendingOpponentScoreRoundIndex()) return;
  state.scorePoll = window.setTimeout(() => {
    state.scorePoll = null;
    pollOpponentScore().catch(() => scheduleScorePoll());
  }, Math.max(0, delay));
}

async function pollOpponentScore() {
  if (state.scorePollBusy || !state.roomId) return;
  const roundIndex = oldestPendingOpponentScoreRoundIndex();
  if (!roundIndex) return;
  const roomId = state.roomId;
  const opponentUid = opponentPlayer()?.uid;
  if (!opponentUid) return;
  state.scorePollBusy = true;
  try {
    const scores = await readRoundScoresBounded(roomId, roundIndex);
    const score = normalizeScore(scores[opponentUid]);
    if (active && state.roomId === roomId && score) {
      const localRound = ensureRoundLocal(roundIndex);
      localRound.scores = { ...(localRound.scores || {}), ...scores };
      reactToRoomData();
    }
  } finally {
    state.scorePollBusy = false;
  }
  scheduleScorePoll();
}

function requestCompletedRoundScoreHydration() {
  const roundIndexes = completedRoundIndexesMissingScores();
  if (!roundIndexes.length
    || state.resultScoreHydration
    || firebaseNow() < Number(state.resultScoreHydrationRetryAt || 0)
    || !state.roomId) return;
  const roomId = state.roomId;
  const operation = Promise.all(
    roundIndexes.map(async (roundIndex) => ({
      roundIndex,
      scores: await readRoundScoresBounded(roomId, roundIndex),
    })),
  );
  state.resultScoreHydration = operation;
  operation
    .then((results) => {
      if (!active || state.roomId !== roomId) return;
      results.forEach(({ roundIndex, scores }) => {
        if (!Object.keys(scores).length) return;
        const round = ensureRoundLocal(roundIndex);
        round.scores = { ...(round.scores || {}), ...scores };
      });
    })
    .catch(handleRecoverableError)
    .finally(() => {
      if (state.resultScoreHydration === operation) state.resultScoreHydration = null;
      if (!active || state.roomId !== roomId || state.screen === "result") return;
      if (completedRoundIndexesMissingScores().length) {
        clearScorePoll();
        state.resultScoreHydrationRetryAt = firebaseNow() + SCORE_POLL_MS;
        state.scorePoll = window.setTimeout(() => {
          state.scorePoll = null;
          state.resultScoreHydrationRetryAt = 0;
          requestCompletedRoundScoreHydration();
        }, SCORE_POLL_MS);
        return;
      }
      state.resultScoreHydrationRetryAt = 0;
      reactToRoomData();
    });
}

function reactToRoomData() {
  if (!active
    || !state.roomId
    || state.screen === "error") return;
  const canonicalView = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  const finalizedView = viewFromServerFinalized(state.room.serverFinalized, canonicalView);
  if (finalizedView) {
    if (state.screen === "result") {
      state.currentView = finalizedView;
      state.outcome = finalizedView;
      render();
    } else {
      transitionToTrainingResult(finalizedView);
    }
    return;
  }
  if (state.screen === "result") return;
  if (state.roomSyncing) {
    render();
    return;
  }
  const immediateResult = canonicalView.phase === "result"
    && ["health_stop", "surrender"].includes(canonicalView.result?.reason);
  if (immediateResult) {
    transitionToTrainingResult(canonicalView);
    return;
  }
  if (completedRoundIndexesMissingScores().length) {
    clearImageExchangeWatchdog();
    requestCompletedRoundScoreHydration();
    render();
    return;
  }
  if (canonicalView.phase === "result") {
    transitionToTrainingResult(canonicalView);
    return;
  }
  if (state.screen === "cancelled") return;
  const view = trainingClientView();
  state.currentView = view;
  if (allRoundImagesReceived(trainingRound(view.roundIndex))) clearImageExchangeWatchdog();
  if (canonicalView.phase === "destroyed" || canonicalView.phase === "no_contest") {
    transitionToDestroyedRoom();
    return;
  }
  if (view.phase === "workout_expired") {
    completeWorkout(view).catch(handleRecoverableError);
  }
  if (canonicalView.actions?.canSettleRound || view.phase === "round_complete") {
    ensureRoundProgress().catch(handleRecoverableError);
  }
  if (view.phase === "result") {
    transitionToTrainingResult(view);
    return;
  }
  state.screen = "room";
  if (view.phase === "drawing") {
    startImageExchangeWatchdog(view.roundIndex);
    ensureLocalRoundDraw(view.roundIndex).catch((error) => (
      handleTrainingImageTransferFailure("image_transfer_failed", error)
    ));
  }
  render();
}

function clearTrainingP2pRecoveryTimer(targetState = state) {
  window.clearTimeout(targetState.p2pRecoveryTimer);
  targetState.p2pRecoveryTimer = null;
}

function preserveResolvedTrainingResultFromP2pRecovery(targetState = state, {
  notify = false,
} = {}) {
  if (state !== targetState || !targetState.outcome) return false;
  clearTrainingP2pRecoveryTimer(targetState);
  targetState.p2pRestartIce = null;
  targetState.p2pRecovery = null;
  targetState.p2pGenerationToken = null;
  if (notify) {
    showToast("P2P接続は切れましたが、確定済みの鍛え合い結果は保持しています。");
  }
  return true;
}

async function preserveResolvedTrainingMatchBeforeP2pCleanup(targetState = state) {
  if (preserveResolvedTrainingResultFromP2pRecovery(targetState)) return true;
  if (state !== targetState || !targetState.roomId) return false;
  const resolution = await refreshRoomBeforeDestroy(targetState.roomId)
    .catch(() => "live");
  return resolution === "result"
    && preserveResolvedTrainingResultFromP2pRecovery(targetState, { notify: true });
}

function scheduleTrainingP2pRecoveryTimer(targetState = state) {
  clearTrainingP2pRecoveryTimer(targetState);
  const timer = getOnlineP2pRecoveryTimer(targetState.p2pRecovery);
  if (!timer) return;
  targetState.p2pRecoveryTimer = window.setTimeout(() => {
    dispatchTrainingP2pRecoveryEvent("TIMER_EXPIRED", targetState, {
      timerToken: timer.timerToken,
    });
  }, Math.max(0, timer.deadlineAt - Date.now()));
}

function dispatchTrainingP2pRecoveryEvent(type, targetState = state, detail = {}) {
  const recovery = targetState.p2pRecovery;
  if (!recovery || state !== targetState) return;
  const result = transitionOnlineP2pRecovery(recovery, {
    type,
    generationToken: recovery.generationToken,
    now: Date.now(),
    ...detail,
  });
  if (result.ignored) {
    if (type === "TIMER_EXPIRED"
        && detail.timerToken === recovery.timerToken
        && Number.isFinite(recovery.deadlineAt)
        && Date.now() < recovery.deadlineAt) {
      scheduleTrainingP2pRecoveryTimer(targetState);
    }
    return;
  }
  targetState.p2pRecovery = result.state;
  scheduleTrainingP2pRecoveryTimer(targetState);
  result.effects.forEach((effect) => {
    handleTrainingP2pRecoveryEffect(effect, targetState)
      .catch(handleRecoverableError);
  });
}

async function cleanupFailedTrainingSessionRoom(targetState, effect) {
  if (await preserveResolvedTrainingMatchBeforeP2pCleanup(targetState)) return;
  if (targetState.p2pCleanupPromise) return targetState.p2pCleanupPromise;
  const roomId = targetState.roomId;
  targetState.p2pCleanupPromise = (async () => {
    if (await preserveResolvedTrainingMatchBeforeP2pCleanup(targetState)) return;
    const response = await trainingSessionActionCallable({
      action: "cancel",
      sessionId: targetState.clientSessionId,
      leaseToken: targetState.clientLeaseToken,
      roomId,
      abort: true,
    }).catch(() => null);
    const cancellation = response?.data || {};
    if (["finalized", "resolved"].includes(String(cancellation.reason || ""))) {
      await retryTrainingCleanup(() => (
        preserveResolvedTrainingMatchBeforeP2pCleanup(targetState)
      ));
      return;
    }
    if (cancellation.cancelled !== true
        && !["terminal", "not-owner"].includes(String(cancellation.reason || ""))) {
      targetState.p2pRecovery = null;
      targetState.p2pGenerationToken = null;
      transitionToLocalNoContestPending();
      showToast("接続先の終了を確認できなかったため、自動再検索を停止しました。");
      return;
    }
    const recovery = targetState.p2pRecovery;
    if (state !== targetState
        || recovery?.generationToken !== effect.generationToken
        || recovery.phase !== ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP) return;
    dispatchTrainingP2pRecoveryEvent("CLEANUP_COMPLETED", targetState);
  })();
  try {
    await targetState.p2pCleanupPromise;
  } finally {
    targetState.p2pCleanupPromise = null;
  }
}

async function resetTrainingRoomForAutoRequeue(targetState, effect) {
  if (state !== targetState || !active || !targetState.sessionLeaseHeld) return;
  const failedOpponentUid = opponentPlayer()?.uid || "";
  clearTrainingP2pRecoveryTimer(targetState);
  targetState.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  const disconnects = targetState.disconnectHandles.splice(0);
  await Promise.allSettled(disconnects.map((handle) => handle?.cancel?.()));
  if (targetState.roomId) {
    await Promise.allSettled([
      remove(ref(database, trainingSessionPresencePath(
        targetState.roomId,
        targetState.uid,
        targetState.clientSessionId,
      ))),
      remove(ref(database, trainingSessionSignalPath(
        targetState.roomId,
        targetState.uid,
        targetState.clientSessionId,
      ))),
    ]);
  }
  targetState.channel?.close();
  targetState.peer?.close();
  targetState.channel = null;
  targetState.peer = null;
  targetState.pendingIce = [];
  targetState.p2pRestartIce = null;
  targetState.p2pRecovery = null;
  targetState.p2pGenerationToken = null;
  targetState.roomId = "";
  targetState.pendingRoomId = "";
  targetState.sessionOfferRoomId = "";
  targetState.room = emptyRoom();
  targetState.outgoingImageRounds.clear();
  targetState.outgoingImageBusy = false;
  targetState.outgoingImageChannel = null;
  targetState.incomingImage = null;
  targetState.incomingMessageChain = Promise.resolve();
  targetState.channelWasOpened = false;
  targetState.sessionAutoRequeueCount = effect.autoRequeueCount;
  showToast("接続先を切り替えて、鍛え合う相手をもう一度探しています。");
  await restartTrainingSessionSearch("", {
    avoidUid: effect.opponentCooldown?.opponentUid || failedOpponentUid,
  });
}

async function handleTrainingP2pRecoveryEffect(effect, targetState = state) {
  const recovery = targetState.p2pRecovery;
  if (state !== targetState
      || recovery?.generationToken !== effect.generationToken) return;
  if (effect.type === "restart-ice") {
    try {
      await targetState.p2pRestartIce?.();
    } catch {
      dispatchTrainingP2pRecoveryEvent("ICE_FAILED", targetState);
    }
    return;
  }
  if (effect.type === "cleanup-failed-room") {
    await cleanupFailedTrainingSessionRoom(targetState, effect);
    return;
  }
  if (effect.type === "auto-requeue") {
    await resetTrainingRoomForAutoRequeue(targetState, effect);
    return;
  }
  if (effect.type === "show-connection-failure") {
    targetState.p2pRecovery = null;
    targetState.p2pGenerationToken = null;
    transitionToLocalNoContestPending();
  }
}

function trainingSessionPeerContextIsCurrent(context, peer = state.peer) {
  return active
    && state === context.expectedState
    && state.roomId === context.roomId
    && state.peer === peer
    && state.sessionLeaseHeld
    && state.sessionGeneration === context.sessionGeneration
    && state.signalingAttemptId === context.attemptId
    && state.roomConnectionGeneration === context.connectionGeneration;
}

async function setupTrainingSessionPeerConnection() {
  if (!("RTCPeerConnection" in window)) {
    throw new Error("このブラウザはP2P画像転送に対応していません。");
  }
  const opponentUid = opponentPlayer()?.uid;
  if (!opponentUid || !state.opponentSessionId) {
    throw new Error("鍛え合う相手の接続セッションを確認できませんでした。");
  }
  const context = Object.freeze({
    expectedState: state,
    roomId: state.roomId,
    ownUid: state.uid,
    opponentUid,
    ownSessionId: state.clientSessionId,
    opponentSessionId: state.opponentSessionId,
    sessionGeneration: state.sessionGeneration,
    attemptId: state.signalingAttemptId,
    connectionGeneration: state.roomConnectionGeneration,
  });
  const peer = new RTCPeerConnection({
    iceServers: state.iceServers,
    iceTransportPolicy: "all",
  });
  state.peer = peer;
  const channelContext = Object.freeze({
    ...createTrainingRoomRuntimeContext(context.roomId),
    peer,
  });
  state.pendingIce = [];
  const contextIsCurrent = () => trainingSessionPeerContextIsCurrent(context, peer);
  const sendRoomSignal = async (type, payload) => {
    if (!contextIsCurrent()) return;
    const envelope = createTrainingSessionSignalEnvelope({
      fromUid: context.ownUid,
      fromSessionId: context.ownSessionId,
      toUid: context.opponentUid,
      toSessionId: context.opponentSessionId,
      connectionGeneration: context.connectionGeneration,
      attemptId: context.attemptId,
      type,
      payload: JSON.stringify(payload),
      createdAt: firebaseNow(),
    });
    await set(push(ref(database, trainingSessionSignalPath(
      context.roomId,
      context.opponentUid,
      context.opponentSessionId,
    ))), envelope);
  };

  state.p2pGenerationToken = createOnlineP2pGenerationToken({
    matchmakingGeneration: state.matchmakingGeneration,
    roomId: context.roomId,
    sessionId: context.ownSessionId,
  });
  state.p2pRecovery = createOnlineP2pRecoveryState({
    generationToken: state.p2pGenerationToken,
    isHost: state.room.hostUid === state.uid,
    opponentUid,
    startedAt: Date.now(),
    autoRequeueCount: state.sessionAutoRequeueCount,
    visible: document.visibilityState === "visible",
    online: navigator.onLine,
  });
  state.p2pRestartIce = async () => {
    const recovery = state.p2pRecovery;
    if (!contextIsCurrent()
        || state.room.hostUid !== state.uid
        || recovery?.phase !== ONLINE_P2P_RECOVERY_PHASES.RESTARTING) return;
    if (!state.channel
        || ["closing", "closed"].includes(state.channel.readyState)) {
      const replacementChannel = peer.createDataChannel(
        IMAGE_CHANNEL_LABEL,
        { ordered: true },
      );
      configureDataChannel(replacementChannel, channelContext);
    }
    peer.restartIce?.();
    const offer = await peer.createOffer({ iceRestart: true });
    if (!contextIsCurrent()) return;
    await peer.setLocalDescription(offer);
    if (!contextIsCurrent()) return;
    await sendRoomSignal("offer", {
      type: offer.type,
      sdp: offer.sdp,
      iceRestart: true,
    });
  };
  scheduleTrainingP2pRecoveryTimer(state);

  peer.onicecandidate = (event) => {
    if (event.candidate && contextIsCurrent()) {
      sendRoomSignal("candidate", event.candidate.toJSON())
        .catch(handleRecoverableError);
    }
  };
  const handlePeerState = () => {
    if (!contextIsCurrent()) return;
    const disconnected = peer.connectionState === "disconnected"
      || peer.iceConnectionState === "disconnected";
    const failed = ["failed", "closed"].includes(peer.connectionState)
      || peer.iceConnectionState === "failed";
    if (peer.connectionState === "connected"
        || ["connected", "completed"].includes(peer.iceConnectionState)) {
      dispatchTrainingP2pRecoveryEvent("ICE_CONNECTED", state);
    } else if (disconnected) {
      dispatchTrainingP2pRecoveryEvent("ICE_DISCONNECTED", state);
    } else if (failed) {
      dispatchTrainingP2pRecoveryEvent("ICE_FAILED", state);
    }
  };
  peer.onconnectionstatechange = handlePeerState;
  peer.oniceconnectionstatechange = handlePeerState;
  peer.ondatachannel = (event) => {
    if (!contextIsCurrent() || event.channel.label !== IMAGE_CHANNEL_LABEL) {
      event.channel.close();
      return;
    }
    configureDataChannel(event.channel, channelContext);
  };

  let signalChain = Promise.resolve();
  const signalUnsubscribe = onChildAdded(
    ref(database, trainingSessionSignalPath(
      context.roomId,
      context.ownUid,
      context.ownSessionId,
    )),
    (snapshot) => {
      signalChain = signalChain.catch(() => {}).then(async () => {
        if (!contextIsCurrent()) return;
        const signal = snapshot.val();
        const decision = decideTrainingSessionSignal({
          envelope: signal,
          ownUid: context.ownUid,
          remoteUid: context.opponentUid,
          ownSessionId: context.ownSessionId,
          remoteSessionId: context.opponentSessionId,
          connectionGeneration: context.connectionGeneration,
          attemptId: context.attemptId,
          isCurrentLeaseOwner: state.sessionLeaseHeld,
          now: firebaseNow(),
        });
        if (!decision.accepted) return;
        let handledSuccessfully = false;
        try {
          await handleTrainingSessionSignal(signal, {
            context,
            peer,
            sendRoomSignal,
          });
          handledSuccessfully = true;
        } catch (error) {
          if (contextIsCurrent()) handleRecoverableError(error);
        }
        if (shouldConsumeTrainingSessionSignal(decision, {
          handledSuccessfully,
          contextStillCurrent: contextIsCurrent(),
        })) {
          await remove(snapshot.ref).catch(() => {});
        }
      });
    },
    handleRecoverableError,
  );
  state.roomUnsubscribers.push(signalUnsubscribe);

  if (state.room.hostUid === state.uid) {
    const channel = peer.createDataChannel(IMAGE_CHANNEL_LABEL, { ordered: true });
    configureDataChannel(channel, channelContext);
    const offer = await peer.createOffer();
    if (!contextIsCurrent()) return false;
    await peer.setLocalDescription(offer);
    if (!contextIsCurrent()) return false;
    await sendRoomSignal("offer", {
      type: offer.type,
      sdp: offer.sdp,
      iceRestart: false,
    });
  }
  return true;
}

async function handleTrainingSessionSignal(signal, {
  context,
  peer,
  sendRoomSignal,
}) {
  const contextIsCurrent = () => trainingSessionPeerContextIsCurrent(context, peer);
  if (!contextIsCurrent()
      || signal?.fromUid !== context.opponentUid
      || signal?.toUid !== context.ownUid
      || signal?.attemptId !== context.attemptId
      || typeof signal.payload !== "string"
      || signal.payload.length > 30_000) {
    throw new Error("現在の接続試行と異なるP2P接続情報です。");
  }
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    if (payload?.iceRestart === true) {
      dispatchTrainingP2pRecoveryEvent("RESTART_OFFER_RECEIVED", state);
    }
    await peer.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    if (!contextIsCurrent()) return;
    await flushTrainingSessionPendingIce(peer, contextIsCurrent);
    const answer = await peer.createAnswer();
    if (!contextIsCurrent()) return;
    await peer.setLocalDescription(answer);
    if (!contextIsCurrent()) return;
    await sendRoomSignal("answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    await peer.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    if (!contextIsCurrent()) return;
    await flushTrainingSessionPendingIce(peer, contextIsCurrent);
  } else if (signal.type === "candidate") {
    if (peer.remoteDescription) await peer.addIceCandidate(payload);
    else state.pendingIce.push(payload);
  } else {
    throw new Error("未対応のP2P接続情報です。");
  }
}

async function flushTrainingSessionPendingIce(peer, contextIsCurrent) {
  while (state.pendingIce.length && contextIsCurrent()) {
    await peer.addIceCandidate(state.pendingIce.shift());
  }
}

async function setupPeerConnection() {
  if (state.sessionLeaseHeld) return setupTrainingSessionPeerConnection();
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはP2P画像転送に対応していません。");
  const opponentUid = opponentPlayer()?.uid;
  if (!opponentUid) throw new Error("鍛え合う相手を確認できませんでした。");
  const signalsRef = ref(database, `online/trainingRooms/${state.roomId}/signals/${state.uid}`);
  state.roomUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try {
      await handleSignal(snapshot.val());
    } catch (error) {
      handleRecoverableError(error);
    } finally {
      await remove(snapshot.ref).catch(() => {});
    }
  }, handleRecoverableError));
  const peer = new RTCPeerConnection({ iceServers: state.iceServers });
  state.peer = peer;
  const channelContext = Object.freeze({
    ...createTrainingRoomRuntimeContext(state.roomId),
    peer,
  });
  peer.onicecandidate = (event) => {
    if (event.candidate) sendSignal("candidate", event.candidate.toJSON()).catch(handleRecoverableError);
  };
  peer.ondatachannel = (event) => {
    if (event.channel.label === IMAGE_CHANNEL_LABEL) {
      configureDataChannel(event.channel, channelContext);
    }
    else event.channel.close();
  };
  peer.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(peer.connectionState)
      && state.roomId
      && !state.outcome) {
      failImageExchange(
        "p2p_image_connection_failed",
        new Error("次のDRAWを交換するP2P接続を維持できませんでした。"),
      ).catch(() => {});
    }
  };
  if (state.room.hostUid === state.uid) {
    configureDataChannel(
      peer.createDataChannel(IMAGE_CHANNEL_LABEL, { ordered: true }),
      channelContext,
    );
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendSignal("offer", { type: offer.type, sdp: offer.sdp });
  }
}

async function sendSignal(type, payload) {
  const targetUid = opponentPlayer()?.uid;
  if (!targetUid || !state.roomId) return;
  await set(push(ref(database, `online/trainingRooms/${state.roomId}/signals/${targetUid}`)), {
    fromUid: state.uid,
    type,
    payload: JSON.stringify(payload),
    createdAt: firebaseNow(),
  });
}

async function handleSignal(signal) {
  if (!signal || signal.fromUid !== opponentPlayer()?.uid || !state.peer) return;
  if (typeof signal.payload !== "string" || signal.payload.length > 100_000) throw new Error("P2P接続情報が不正です。");
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    await state.peer.setRemoteDescription(payload);
    await flushPendingIce();
    const answer = await state.peer.createAnswer();
    await state.peer.setLocalDescription(answer);
    await sendSignal("answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    await state.peer.setRemoteDescription(payload);
    await flushPendingIce();
  } else if (signal.type === "candidate") {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(payload);
    else state.pendingIce.push(payload);
  }
}

async function flushPendingIce() {
  while (state.pendingIce.length) await state.peer.addIceCandidate(state.pendingIce.shift());
}

function trainingDataChannelContextIsCurrent(context, channel) {
  return trainingRoomRuntimeContextIsCurrent(context)
    && state.peer === context.peer
    && state.channel === channel;
}

function rearmTrainingImageTransferForReplacement(targetState = state) {
  const opponentUid = Object.keys(targetState.room?.members || {})
    .find((uid) => uid !== targetState.uid) || "";
  const roundsToResend = trainingImageRoundsNeedingResend({
    outgoingRoundIndexes: [...targetState.outgoingImageRounds],
    rounds: targetState.room?.rounds || {},
    opponentUid,
  });
  roundsToResend.forEach((roundIndex) => {
    targetState.outgoingImageRounds.delete(roundIndex);
  });
  targetState.incomingImage = null;
  targetState.incomingMessageChain = Promise.resolve();
  return roundsToResend;
}

function trainingImageTransferRecoveryPending(targetState = state) {
  return Boolean(
    state === targetState
      && targetState.sessionLeaseHeld
      && targetState.p2pRecovery
      && !targetState.outcome
      && [
        ONLINE_P2P_RECOVERY_PHASES.DISCONNECTED,
        ONLINE_P2P_RECOVERY_PHASES.RESTARTING,
        ONLINE_P2P_RECOVERY_PHASES.AWAITING_HOST_RESTART,
      ].includes(targetState.p2pRecovery.phase),
  );
}

function handleTrainingImageTransferFailure(
  reason,
  error,
  targetState = state,
) {
  if (state === targetState
      && targetState.sessionLeaseHeld
      && targetState.channel?.readyState !== "open"
      && targetState.p2pRecovery?.phase
        === ONLINE_P2P_RECOVERY_PHASES.CONNECTED) {
    dispatchTrainingP2pRecoveryEvent("ICE_FAILED", targetState);
  }
  if (trainingImageTransferRecoveryPending(targetState)) {
    rearmTrainingImageTransferForReplacement(targetState);
    return Promise.resolve(false);
  }
  return failImageExchange(reason, error);
}

function configureDataChannel(
  channel,
  context = Object.freeze({
    ...createTrainingRoomRuntimeContext(state.roomId),
    peer: state.peer,
  }),
) {
  if (!trainingRoomRuntimeContextIsCurrent(context)
      || state.peer !== context.peer) {
    channel.close();
    return false;
  }
  const previousChannel = state.channel;
  const replacement = Boolean(
    state.channelWasOpened
      && previousChannel
      && previousChannel !== channel,
  );
  if (replacement) {
    rearmTrainingImageTransferForReplacement(state);
  }
  state.channel = channel;
  if (replacement && previousChannel.readyState !== "closed") {
    previousChannel.close();
  }
  const contextIsCurrent = () => (
    trainingDataChannelContextIsCurrent(context, channel)
  );
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    if (!contextIsCurrent()) {
      channel.close();
      return;
    }
    state.channelWasOpened = true;
    if (context.sessionV2) {
      dispatchTrainingP2pRecoveryEvent("CHANNEL_OPENED", state);
    }
    if (replacement) {
      startImageExchangeWatchdog(currentRoundIndex());
    }
    ensureLocalRoundDraw(currentRoundIndex(), contextIsCurrent).catch((error) => {
      if (contextIsCurrent()) {
        handleTrainingImageTransferFailure(
          "image_transfer_failed",
          error,
        ).catch(() => {});
      }
    });
    render();
  };
  channel.onclose = () => {
    if (!contextIsCurrent()) return;
    if (context.sessionV2 && state.roomId && !state.outcome) {
      dispatchTrainingP2pRecoveryEvent("ICE_FAILED", state);
      return;
    }
    failImageExchange(
      "image_channel_closed",
      new Error("画像交換が終わる前にP2P接続が閉じました。"),
    ).catch(() => {});
  };
  channel.onerror = () => {
    if (!contextIsCurrent()) return;
    if (context.sessionV2 && state.roomId && !state.outcome) {
      dispatchTrainingP2pRecoveryEvent("ICE_FAILED", state);
      return;
    }
    failImageExchange(
      "image_channel_error",
      new Error("画像のP2P転送で通信エラーが発生しました。"),
    ).catch(() => {});
  };
  channel.onmessage = (event) => {
    if (!contextIsCurrent()) return;
    const payload = event.data;
    state.incomingMessageChain = state.incomingMessageChain
      .catch(() => {})
      .then(() => {
        if (!contextIsCurrent()) return;
        return handleChannelMessage(payload, contextIsCurrent);
      })
      .catch((error) => {
        if (!contextIsCurrent()) return;
        state.incomingImage = null;
        handleTrainingImageTransferFailure(
          "image_receive_failed",
          error,
        ).catch(() => {});
      });
  };
  return true;
}

async function sendLocalRoundImage(
  roundIndex,
  draw,
  contextIsCurrent = () => true,
) {
  const targetState = state;
  const channel = targetState.channel;
  if (!contextIsCurrent()
    || targetState.outgoingImageRounds.has(roundIndex)
    || channel?.readyState !== "open") return false;
  const imageIndex = Number(draw?.imageIndex || 0);
  const image = targetState.localImages[imageIndex - 1];
  if (!image?.blob) throw new Error("DRAWした画像を端末で確認できませんでした。");
  try {
    const buffer = await image.blob.arrayBuffer();
    if (!contextIsCurrent()
        || state !== targetState
        || targetState.channel !== channel
        || channel.readyState !== "open") return false;
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_TRANSFER_BYTES) {
      throw new Error("送信画像のサイズが鍛え合い60の上限を超えています。");
    }
    const mime = verifiedOnlineImageMime(buffer);
    channel.send(JSON.stringify({
      type: "training-image-start",
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      ownerUid: state.uid,
      round: roundIndex,
      imageIndex,
      bpm: Number(draw.bpm),
      size: buffer.byteLength,
      mime,
    }));
    for (let offset = 0; offset < buffer.byteLength; offset += IMAGE_CHUNK_BYTES) {
      await waitForDataBuffer(channel);
      if (!contextIsCurrent()
          || state !== targetState
          || targetState.channel !== channel
          || channel.readyState !== "open") return false;
      channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + IMAGE_CHUNK_BYTES)));
    }
    if (!contextIsCurrent()
        || state !== targetState
        || targetState.channel !== channel
        || channel.readyState !== "open") return false;
    channel.send(JSON.stringify({
      type: "training-image-end",
      ownerUid: state.uid,
      round: roundIndex,
      imageIndex,
      bpm: Number(draw.bpm),
    }));
    targetState.outgoingImageRounds.add(roundIndex);
    return true;
  } catch (error) {
    targetState.outgoingImageRounds.delete(roundIndex);
    throw error;
  }
}

function waitForDataBuffer(channel) {
  if (!channel || channel.readyState !== "open") return Promise.reject(new Error("画像転送のP2P接続が切れました。"));
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("画像転送の待機時間を超えました。")), 10_000);
    const finish = (error) => {
      window.clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onLow = () => finish();
    const onClose = () => finish(new Error("画像転送中にP2P接続が切れました。"));
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
  });
}

async function handleChannelMessage(data, contextIsCurrent = () => true) {
  if (!contextIsCurrent()) return;
  if (typeof data === "string") {
    if (data.length > 2048) throw new Error("P2P制御情報が大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "training-image-start") {
      const roundIndex = Number(message.round);
      if (!contextIsCurrent()) return;
      if (state.remoteImages[roundIndex] || state.incomingImage) return;
      if (message.protocolVersion !== TRAINING_PROTOCOL_VERSION
        || message.variant !== TRAINING_VARIANT
        || message.ownerUid !== opponentPlayer()?.uid
        || !Number.isInteger(roundIndex)
        || roundIndex < 1
        || roundIndex > TRAINING_MAX_ROUNDS
        || !Number.isInteger(Number(message.imageIndex))
        || Number(message.imageIndex) < 1
        || Number(message.imageIndex) > TRAINING_IMAGE_COUNT
        || normalizeImageBpm(message.bpm) < 0) {
        throw new Error("受信画像の送信者情報が一致しません。");
      }
      state.incomingImage = createIncomingOnlineImageTransfer(message, {
        expectedRound: roundIndex,
        maxBytes: MAX_IMAGE_TRANSFER_BYTES,
      });
      state.incomingImage.imageIndex = Number(message.imageIndex);
      state.incomingImage.bpm = Number(message.bpm);
    } else if (message.type === "training-image-end") {
      await finishIncomingImage(message, contextIsCurrent);
    } else if (message.type === "training-workout-message") {
      if (!contextIsCurrent()) return;
      receiveWorkoutMessage(message);
    } else if (message.type === "training-workout-message-ack") {
      if (!contextIsCurrent()) return;
      receiveWorkoutMessageAck(message);
    } else if (message.type === "training-cheer" || message.type === "training-free-cheer") {
      if (!contextIsCurrent()) return;
      receiveCheer(message);
    } else if (String(message.type || "").startsWith("training-finisher-")) {
      if (!contextIsCurrent()) return;
      receiveFinisherMessage(message);
    }
    return;
  }
  if (!state.incomingImage) return;
  const transfer = state.incomingImage;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  if (!contextIsCurrent() || state.incomingImage !== transfer) return;
  try {
    appendIncomingOnlineImageChunk(transfer, chunk);
  } catch (error) {
    if (contextIsCurrent() && state.incomingImage === transfer) {
      state.incomingImage = null;
    }
    throw error;
  }
}

async function finishIncomingImage(message, contextIsCurrent = () => true) {
  if (!contextIsCurrent()) return;
  const transfer = state.incomingImage;
  const endStatus = onlineImageEndStatus(transfer, message);
  if (endStatus === "orphan") return;
  const roundIndex = Number(message.round);
  const opponentUid = opponentPlayer()?.uid || "";
  const roomId = state.roomId;
  const ownUid = state.uid;
  if (endStatus !== "complete"
    || message.ownerUid !== opponentUid
    || Number(message.imageIndex) !== Number(transfer?.imageIndex)
    || Number(message.bpm) !== Number(transfer?.bpm)) {
    state.incomingImage = null;
    throw new Error("受信画像の完了情報が一致しません。");
  }
  const drawSnapshot = await get(
    ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/draws/${opponentUid}`),
  );
  if (!contextIsCurrent() || state.incomingImage !== transfer) return;
  const draw = drawSnapshot.val();
  if (Number(draw?.imageIndex) !== Number(transfer.imageIndex)
    || Number(draw?.bpm) !== Number(transfer.bpm)) {
    state.incomingImage = null;
    throw new Error("P2P画像とFirebaseのDRAW情報が一致しません。");
  }
  const mime = completeIncomingOnlineImageTransfer(transfer);
  if (!contextIsCurrent() || state.incomingImage !== transfer) return;
  state.incomingImage = null;
  const blob = new Blob(transfer.chunks, { type: mime });
  releaseImage(state.remoteImages[roundIndex]);
  state.remoteImages[roundIndex] = {
    blob,
    url: URL.createObjectURL(blob),
    mime,
    bpm: Number(draw.bpm),
    imageIndex: Number(draw.imageIndex),
  };
  await set(
    ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/imageReceived/${ownUid}`),
    true,
  );
  if (!contextIsCurrent()) return;
  render();
}

function clearImageExchangeWatchdog() {
  window.clearTimeout(state.imageExchangeTimer);
  state.imageExchangeTimer = null;
}

function startImageExchangeWatchdog(roundIndex = currentRoundIndex()) {
  clearImageExchangeWatchdog();
  const round = trainingRound(roundIndex);
  if (!state.roomId || allRoundImagesReceived(round) || state.outcome) return;
  const roomId = state.roomId;
  state.imageExchangeRound = roundIndex;
  state.imageExchangeTimer = window.setTimeout(() => {
    state.imageExchangeTimer = null;
    if (!active
      || state.roomId !== roomId
      || allRoundImagesReceived(trainingRound(roundIndex))
      || state.outcome) return;
    failImageExchange(
      "image_exchange_timeout",
      new Error("45秒以内に画像交換を完了できなかったため、NO CONTESTにしました。"),
    ).catch(() => {});
  }, IMAGE_EXCHANGE_TIMEOUT_MS);
}

async function failImageExchange(reason, error) {
  if (!active
    || !state.roomId
    || state.room.destroyed
    || state.outcome) return;
  const roomId = state.roomId;
  const roundIndex = state.imageExchangeRound || currentRoundIndex();
  const receipt = await get(
    ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/imageReceived`),
  ).catch(() => null);
  if (receipt && active && state.roomId === roomId) {
    ensureRoundLocal(roundIndex).imageReceived = receipt.val() || {};
    if (allRoundImagesReceived(trainingRound(roundIndex))) {
      clearImageExchangeWatchdog();
      return;
    }
  }
  clearImageExchangeWatchdog();
  if (error) handleRecoverableError(error);
  try {
    await markRoomDestroyed(reason);
  } catch (destroyError) {
    handleRecoverableError(destroyError);
    if (active && state.roomId === roomId && !state.outcome) {
      transitionToLocalNoContestPending();
    }
  }
}

function secureRandomChoice(values) {
  if (!values.length) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const sample = new Uint32Array(1);
    globalThis.crypto.getRandomValues(sample);
    return values[sample[0] % values.length];
  }
  return values[Math.floor(Math.random() * values.length)];
}

async function ensureLocalRoundDraw(
  roundIndex = currentRoundIndex(),
  contextIsCurrent = () => true,
) {
  if (state.preview
      || !contextIsCurrent()
      || !state.roomId
      || state.outcome
      || (state.outgoingImageBusy
        && state.outgoingImageChannel === state.channel)) return;
  if (!Number.isInteger(roundIndex) || roundIndex < 1 || roundIndex > TRAINING_MAX_ROUNDS) return;
  const targetState = state;
  const roomId = state.roomId;
  const ownUid = state.uid;
  let round = trainingRound(roundIndex);
  if (!Number(round.createdAt || 0)) {
    if (state.room.hostUid !== state.uid) return;
    const created = await runTransaction(
      ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/createdAt`),
      (current) => current == null ? firebaseNow() : undefined,
      { applyLocally: false },
    );
    if (!contextIsCurrent() || state.roomId !== roomId || state.uid !== ownUid) return;
    const createdAt = Number(created.snapshot.val() || 0);
    if (!createdAt) throw new Error("ランダムDRAWの開始時刻を確定できませんでした。");
    ensureRoundLocal(roundIndex).createdAt = createdAt;
    round = trainingRound(roundIndex);
  }
  let draw = roundDraw(round, state.uid);
  if (!draw) {
    const used = new Set(
      Array.from({ length: roundIndex - 1 }, (_, index) => (
        Number(roundDraw(trainingRound(index + 1), state.uid)?.imageIndex || 0)
      )).filter(Boolean),
    );
    const available = Array.from({ length: TRAINING_IMAGE_COUNT }, (_, index) => index + 1)
      .filter((imageIndex) => !used.has(imageIndex));
    const imageIndex = secureRandomChoice(available);
    const image = state.localImages[imageIndex - 1];
    const bpm = normalizeImageBpm(image?.bpm);
    if (!image?.blob || bpm < 0) throw new Error("5枚の画像デッキを端末で確認できませんでした。");
    const candidate = { imageIndex, bpm, drawnAt: firebaseNow() };
    const result = await runTransaction(
      ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/draws/${ownUid}`),
      (current) => current === null ? candidate : undefined,
    );
    if (!contextIsCurrent() || state.roomId !== roomId || state.uid !== ownUid) return;
    draw = result.snapshot.val();
    if (!draw) throw new Error("ランダムDRAWを確定できませんでした。");
    ensureRoundLocal(roundIndex).draws = {
      ...(ensureRoundLocal(roundIndex).draws || {}),
      [ownUid]: draw,
    };
  }
  const channel = state.channel;
  if (channel?.readyState !== "open" || state.outgoingImageRounds.has(roundIndex)) return;
  state.outgoingImageBusy = true;
  state.outgoingImageChannel = channel;
  try {
    await sendLocalRoundImage(roundIndex, draw, contextIsCurrent);
  } finally {
    if (targetState.outgoingImageChannel === channel) {
      targetState.outgoingImageBusy = false;
      targetState.outgoingImageChannel = null;
    }
  }
}

async function submitScore(value) {
  if (state.preview) return;
  const score = normalizeScore(value);
  const view = trainingClientView();
  if (!score
    || view.phase !== "scoring"
    || !allRoundImagesReceived(view.round)
    || roundScore(view.round, state.uid)
    || state.scoreSubmitting) return;
  state.scoreSubmitting = true;
  render();
  try {
    const result = await runTransaction(
      ref(database, `online/trainingRooms/${state.roomId}/rounds/${view.roundIndex}/scores/${state.uid}`),
      (current) => current === null ? score : undefined,
    );
    const committedScore = normalizeScore(result.snapshot.val());
    if (!committedScore) throw new Error("秘密採点を確定できませんでした。");
    const round = ensureRoundLocal(view.roundIndex);
    round.scores = { ...(round.scores || {}), [state.uid]: committedScore };
    scheduleScorePoll(0);
  } finally {
    state.scoreSubmitting = false;
    render();
  }
}

async function submitCommandChoice(cardIndex) {
  if (state.preview) return;
  const view = trainingClientView();
  const victimUid = view.traineeUid;
  if (view.phase !== "command_select"
    || view.trainerUid !== state.uid
    || !victimUid
    || !Number.isInteger(cardIndex)
    || cardIndex < 1
    || cardIndex > TRAINING_COMMAND_COUNT
    || usedCommandIndexes(state.uid).has(cardIndex)
    || state.commandSubmitting) return;
  state.commandSubmitting = true;
  render();
  try {
    const choice = {
      trainerUid: state.uid,
      cardIndex,
      selectedAt: firebaseNow(),
    };
    const result = await runTransaction(
      ref(database, `online/trainingRooms/${state.roomId}/rounds/${view.roundIndex}/commandChoices/${victimUid}`),
      (current) => current === null ? choice : undefined,
    );
    if (!result.snapshot.val()) throw new Error("COMMANDを確定できませんでした。");
  } finally {
    state.commandSubmitting = false;
    render();
  }
}

async function startWorkout() {
  if (state.preview) return;
  const view = trainingClientView();
  const context = ownWorkoutContext(view.roundIndex);
  if (view.phase !== "workout_ready" || !context || context.workout?.startedAt) return;
  const startedAt = firebaseNow();
  const result = await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/rounds/${view.roundIndex}/workouts/${state.uid}`),
    (current) => current === null ? { startedAt } : undefined,
  );
  const storedStartedAt = Number(result.snapshot.val()?.startedAt || 0);
  if (!storedStartedAt) throw new Error("トレーニング開始を確定できませんでした。");
  const round = ensureRoundLocal(view.roundIndex);
  round.workouts = {
    ...(round.workouts || {}),
    [state.uid]: {
      ...(round.workouts?.[state.uid] || {}),
      startedAt: storedStartedAt,
    },
  };
  await syncTrainingWorkoutWakeLock(state);
  try {
    state.ambienceUnlocked = true;
    state.ambienceResumeRequired = false;
    setWorkoutAmbience(context, startedAt);
    await state.ambienceController.enable();
  } catch {
    showToast("メトロノームを再生できませんでした。無音でも進行できます。");
  }
}

async function completeWorkout(viewOverride = null) {
  if (state.preview) return false;
  const targetState = state;
  const view = viewOverride || trainingClientView();
  const context = ownWorkoutContext(view.roundIndex);
  const roomId = targetState.roomId;
  const uid = targetState.uid;
  const roundIndex = Number(view.roundIndex);
  const startedAt = Number(context?.workout?.startedAt || 0);
  if (!active
      || !context
      || !roomId
      || !uid
      || !Number.isInteger(roundIndex)
      || roundIndex < 1
      || roundIndex > TRAINING_MAX_ROUNDS
      || !startedAt
      || Number(context.workout.completedAt || 0)) return false;
  const completedAt = startedAt + context.scoreInfo.durationMs;
  if (firebaseNow() < completedAt) return false;
  const completionKey = `${roomId}:${roundIndex}:${uid}:${startedAt}:${completedAt}`;
  const pending = targetState.workoutCompletion;
  if (pending) {
    return pending.key === completionKey ? pending.promise : false;
  }

  const completionPath =
    `online/trainingRooms/${roomId}/rounds/${roundIndex}/workouts/${uid}/completedAt`;
  const operation = (async () => {
    const result = await runTransaction(
      ref(database, completionPath),
      (current) => current == null ? completedAt : undefined,
      { applyLocally: false },
    );
    const storedCompletedAt = result.snapshot.val();
    if (storedCompletedAt !== completedAt) {
      throw new Error("トレーニング完了時刻を確定できませんでした。");
    }
    await releaseTrainingWorkoutWakeLock(targetState);
    if (!active
        || state !== targetState
        || targetState.roomId !== roomId
        || targetState.uid !== uid) return true;
    const round = ensureRoundLocal(roundIndex);
    const localWorkout = round.workouts?.[uid];
    if (Number(localWorkout?.startedAt || 0) === startedAt) {
      round.workouts = {
        ...(round.workouts || {}),
        [uid]: { ...localWorkout, completedAt },
      };
      targetState.ambienceController.disable();
      reactToRoomData();
    }
    return true;
  })();
  targetState.workoutCompletion = { key: completionKey, promise: operation };
  try {
    return await operation;
  } finally {
    if (targetState.workoutCompletion?.promise === operation) {
      targetState.workoutCompletion = null;
    }
  }
}

function roundCreatesNaturalResult(roundIndex) {
  const round = trainingRound(roundIndex);
  if (!allRoundScoresReady(round) || !requiredRoundWorkoutsComplete(round)) return false;
  const uids = memberUids();
  if (uids.some((uid) => hpFor(uid) <= 0)) return true;
  return roundIndex >= TRAINING_MAX_ROUNDS;
}

async function ensureRoundProgress() {
  if (state.preview || state.roundProgressWriting || state.room.hostUid !== state.uid || !state.roomId) return;
  const roundIndex = currentRoundIndex();
  const round = trainingRound(roundIndex);
  if (!Number(round.createdAt || 0)) {
    await ensureLocalRoundDraw(roundIndex);
    return;
  }
  if (!allRoundScoresReady(round)
    || !requiredRoundWorkoutsComplete(round)
    || Number(round.completedAt || 0)) return;
  const completedAt = firebaseNow();
  const updates = { [`rounds/${roundIndex}/completedAt`]: completedAt };
  if (!roundCreatesNaturalResult(roundIndex) && roundIndex < TRAINING_MAX_ROUNDS) {
    updates[`rounds/${roundIndex + 1}/createdAt`] = completedAt;
  }
  const operation = update(ref(database, `online/trainingRooms/${state.roomId}`), updates);
  state.roundProgressWriting = operation;
  try {
    await operation;
  } finally {
    if (state.roundProgressWriting === operation) state.roundProgressWriting = null;
  }
}

async function handleHealthStop() {
  if (state.preview) return;
  state.giveUpArmed = false;
  await markRoomDestroyed("health_stop");
}

function sendFinisherMessage(payload) {
  if (state.channel?.readyState !== "open") {
    showToast("P2P接続が閉じているため、任意の追い込みは利用できません。");
    return false;
  }
  state.channel.send(JSON.stringify({
    ...payload,
    protocolVersion: TRAINING_PROTOCOL_VERSION,
    variant: TRAINING_VARIANT,
    fromUid: state.uid,
  }));
  return true;
}

function scheduleFinisherOfferExpiry(expiresAt) {
  window.clearInterval(state.finisherOfferTimer);
  state.finisherOfferTimer = null;
  const remaining = Number(expiresAt || 0) - firebaseNow();
  if (remaining <= 0) {
    if (state.finisher?.status === "offered") {
      state.finisher = { ...state.finisher, status: "expired" };
      render();
    }
    return;
  }
  state.finisherOfferTimer = window.setInterval(() => {
    if (state.finisher?.status !== "offered") {
      window.clearInterval(state.finisherOfferTimer);
      state.finisherOfferTimer = null;
      return;
    }
    if (firebaseNow() >= Number(state.finisher.expiresAt || 0)) {
      window.clearInterval(state.finisherOfferTimer);
      state.finisherOfferTimer = null;
      state.finisher = { ...state.finisher, status: "expired" };
    }
    render();
  }, 1_000);
}

function offerFinisher(cardIndex) {
  if (state.outcome?.result?.type !== "win" || resultOverkill(state.outcome) <= 0 || state.finisher) return;
  const card = normalizeCommandCard(state.commandDeck[cardIndex - 1]);
  if (!commandCardIsReady(card)) return;
  const expiresAt = firebaseNow() + 15_000;
  if (!sendFinisherMessage({ type: "training-finisher-offer", cardIndex, expiresAt })) return;
  state.finisher = { status: "offered", cardIndex, card, expiresAt };
  scheduleFinisherOfferExpiry(expiresAt);
  render();
}

function respondFinisher(accepted) {
  if (state.outcome?.result?.type !== "loss"
    || state.finisher?.status !== "offered"
    || firebaseNow() >= Number(state.finisher.expiresAt || 0)) {
    scheduleFinisherOfferExpiry(0);
    return;
  }
  const status = accepted ? "accepted" : "declined";
  window.clearInterval(state.finisherOfferTimer);
  state.finisherOfferTimer = null;
  sendFinisherMessage({ type: "training-finisher-response", status });
  state.finisher = { ...state.finisher, status };
  render();
}

function startFinisher() {
  if (state.outcome?.result?.type !== "loss" || state.finisher?.status !== "accepted") return;
  const startedAt = firebaseNow();
  state.finisher = { ...state.finisher, status: "active", startedAt };
  sendFinisherMessage({ type: "training-finisher-start", startedAt });
  const roundIndex = Number(state.outcome?.roundIndex || currentRoundIndex());
  const draw = roundDraw(trainingRound(roundIndex), opponentPlayer()?.uid || "");
  state.ambienceController.setAmbience({
    metronomeBpm: Number(draw?.bpm || 0),
    effectiveAt: firebaseNow(),
    revision: 10_000 + roundIndex,
  }, { serverTimeOffset: state.serverTimeOffset });
  state.ambienceController.enable().catch(() => {});
  window.clearInterval(state.finisherTicker);
  state.finisherTicker = window.setInterval(() => {
    if (!state.finisher?.startedAt || firebaseNow() - state.finisher.startedAt < FINISHER_DURATION_MS) {
      render();
      return;
    }
    window.clearInterval(state.finisherTicker);
    state.finisherTicker = null;
    state.finisher = { ...state.finisher, status: "complete" };
    state.ambienceController.disable();
    sendFinisherMessage({ type: "training-finisher-complete" });
    render();
  }, 1_000);
  render();
}

function receiveFinisherMessage(message) {
  if (message.protocolVersion !== TRAINING_PROTOCOL_VERSION
    || message.variant !== TRAINING_VARIANT
    || message.fromUid !== opponentPlayer()?.uid
    || !state.outcome) return;
  if (message.type === "training-finisher-offer"
    && state.outcome.result?.type === "loss"
    && resultOverkill(state.outcome) > 0
    && !state.finisher) {
    const cardIndex = Number(message.cardIndex);
    const expiresAt = Number(message.expiresAt);
    const now = firebaseNow();
    const card = commandCardFor(opponentPlayer()?.uid || "", cardIndex);
    if (!commandCardIsReady(card)
      || !Number.isFinite(expiresAt)
      || expiresAt < now + 1_000
      || expiresAt > now + 20_000) return;
    state.finisher = { status: "offered", cardIndex, card, expiresAt };
    scheduleFinisherOfferExpiry(expiresAt);
  } else if (message.type === "training-finisher-response"
    && state.outcome.result?.type === "win"
    && ["accepted", "declined"].includes(message.status)
    && state.finisher?.status === "offered"
    && firebaseNow() < Number(state.finisher.expiresAt || 0)) {
    window.clearInterval(state.finisherOfferTimer);
    state.finisherOfferTimer = null;
    state.finisher = { ...state.finisher, status: message.status };
  } else if (message.type === "training-finisher-start"
    && state.outcome.result?.type === "win"
    && state.finisher?.status === "accepted") {
    state.finisher = { ...state.finisher, status: "active", startedAt: Number(message.startedAt || firebaseNow()) };
  } else if (message.type === "training-finisher-complete"
    && state.outcome.result?.type === "win") {
    state.finisher = { ...(state.finisher || {}), status: "complete" };
  }
  render();
}

async function handleGiveUp() {
  if (!state.giveUpArmed) {
    state.giveUpArmed = true;
    render();
    queueMicrotask(() => document.querySelector("#trainingCancelGiveUp")?.focus());
    return;
  }
  if (state.preview) return;
  const surrendered = await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/surrendered`),
    (current) => current === null ? { uid: state.uid, at: firebaseNow() } : undefined,
  );
  if (!surrendered.snapshot.val()) throw new Error("GIVE UPを確定できませんでした。");
}

function normalizeWorkoutMessageText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function createWorkoutMessageId() {
  const generated = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `workout-${generated}`.slice(0, 96);
}

function validWorkoutMessageId(value) {
  return /^[-_0-9A-Za-z]{8,128}$/.test(String(value || ""));
}

function scheduleWorkoutMessageOverlay(messageId) {
  const targetState = state;
  const currentTimer = targetState.workoutMessageOverlayTimers.get(messageId);
  if (currentTimer) window.clearTimeout(currentTimer);
  targetState.workoutMessageOverlayIds = [
    ...targetState.workoutMessageOverlayIds.filter((id) => id !== messageId),
    messageId,
  ].slice(-TRAINING_WORKOUT_MESSAGE_OVERLAY_LIMIT);
  const timer = window.setTimeout(() => {
    if (state !== targetState) return;
    targetState.workoutMessageOverlayTimers.delete(messageId);
    targetState.workoutMessageOverlayIds = targetState.workoutMessageOverlayIds
      .filter((id) => id !== messageId);
    refreshWorkoutCommunication();
  }, TRAINING_WORKOUT_MESSAGE_OVERLAY_MS);
  targetState.workoutMessageOverlayTimers.set(messageId, timer);
}

function addWorkoutMessage(message) {
  ensureWorkoutMessageRound(message.round);
  if (state.workoutMessageIds.has(message.messageId)) return false;
  const nextMessages = [...state.workoutMessages, message]
    .slice(-TRAINING_WORKOUT_MESSAGE_HISTORY_LIMIT);
  const retainedIds = new Set(nextMessages.map((item) => item.messageId));
  Object.keys(state.workoutMessageAcks).forEach((messageId) => {
    if (!retainedIds.has(messageId)) delete state.workoutMessageAcks[messageId];
  });
  state.workoutMessages = nextMessages;
  state.workoutMessageIds = retainedIds;
  scheduleWorkoutMessageOverlay(message.messageId);
  return true;
}

function refreshWorkoutCommunication() {
  if (!active || state.screen !== "room" || !state.currentView) return;
  const view = state.currentView;
  const context = workoutCommunicationContext(view);
  if (state.workoutMessageRound !== context.roundIndex) return;
  const overlay = document.querySelector("#trainingWorkoutMessageOverlay");
  if (overlay) overlay.innerHTML = renderWorkoutMessageOverlay(context.roundIndex);
  const history = document.querySelector("#trainingWorkoutMessageHistory");
  if (history) {
    history.innerHTML = renderWorkoutMessageHistory(context.roundIndex);
    history.scrollTop = history.scrollHeight;
  }
  const coolingDown = Date.now() - state.workoutMessageLastSentAt
    < TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS;
  document.querySelectorAll("[data-training-workout-quick]").forEach((button) => {
    button.disabled = !context.enabled || coolingDown;
  });
  const input = document.querySelector("#trainingWorkoutMessage");
  if (input) input.disabled = !context.enabled;
  const sendButton = document.querySelector("#trainingSendWorkoutMessage");
  if (sendButton) sendButton.disabled = !context.enabled || coolingDown;
}

function scheduleWorkoutMessageCooldownRefresh() {
  window.clearTimeout(state.workoutMessageCooldownTimer);
  const remaining = Math.max(
    0,
    TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS
      - (Date.now() - state.workoutMessageLastSentAt),
  );
  state.workoutMessageCooldownTimer = window.setTimeout(() => {
    state.workoutMessageCooldownTimer = null;
    refreshWorkoutCommunication();
  }, remaining + 20);
}

function scheduleWorkoutMessageRetry(payload, retryIndex = 0, targetState = state) {
  if (retryIndex >= TRAINING_WORKOUT_MESSAGE_RETRY_DELAYS_MS.length) return;
  const messageId = payload.messageId;
  const expectedRoomId = String(targetState.roomId || "");
  const timer = window.setTimeout(() => {
    targetState.workoutMessageRetryTimers.delete(messageId);
    if (state !== targetState
      || String(targetState.roomId || "") !== expectedRoomId
      || targetState.workoutMessageRound !== payload.round
      || targetState.workoutMessageAcks[messageId] === "displayed"
      || !targetState.workoutMessageIds.has(messageId)
      || targetState.channel?.readyState !== "open") return;
    const context = workoutCommunicationContext();
    if (context.roundIndex !== payload.round
      || !workoutIsActive(context.round, payload.workoutUid)) return;
    try {
      targetState.channel.send(JSON.stringify(payload));
    } catch {
      return;
    }
    scheduleWorkoutMessageRetry(payload, retryIndex + 1, targetState);
  }, TRAINING_WORKOUT_MESSAGE_RETRY_DELAYS_MS[retryIndex]);
  targetState.workoutMessageRetryTimers.set(messageId, timer);
}

function sendWorkoutMessage({ kind, quickId = "", text = "" }) {
  const view = trainingClientView();
  const context = workoutCommunicationContext(view);
  ensureWorkoutMessageRound(context.roundIndex);
  if (!context.enabled || !context.opponentUid || !context.workoutUid) return false;
  const now = Date.now();
  if (now - state.workoutMessageLastSentAt
    < TRAINING_WORKOUT_MESSAGE_SEND_INTERVAL_MS) return false;
  const normalizedKind = kind === "quick" ? "quick" : kind === "text" ? "text" : "";
  const normalizedQuickId = normalizedKind === "quick" && WORKOUT_QUICK_MESSAGES[quickId]
    ? quickId
    : "";
  const normalizedText = normalizedQuickId
    ? WORKOUT_QUICK_MESSAGES[normalizedQuickId]
    : normalizedKind === "text"
      ? normalizeWorkoutMessageText(text)
      : "";
  if (!normalizedKind || !normalizedText) return false;
  if (state.channel?.readyState !== "open") {
    showToast("ワークアウトチャットのP2P接続が閉じています。筋トレ進行は続けられます。");
    return false;
  }
  const messageId = createWorkoutMessageId();
  const payload = {
    type: "training-workout-message",
    protocolVersion: TRAINING_PROTOCOL_VERSION,
    variant: TRAINING_VARIANT,
    messageId,
    round: context.roundIndex,
    workoutUid: context.workoutUid,
    fromUid: state.uid,
    toUid: context.opponentUid,
    kind: normalizedKind,
    ...(normalizedQuickId ? { quickId: normalizedQuickId } : { text: normalizedText }),
    sentAt: firebaseNow(),
  };
  try {
    state.channel.send(JSON.stringify(payload));
  } catch (error) {
    handleRecoverableError(error);
    return false;
  }
  state.workoutMessageLastSentAt = now;
  state.workoutMessageAcks[messageId] = "sent";
  addWorkoutMessage({
    ...payload,
    text: normalizedText,
    receivedAt: now,
  });
  if (normalizedKind === "text") {
    state.workoutMessageDraft = "";
    const input = document.querySelector("#trainingWorkoutMessage");
    if (input) input.value = "";
  }
  refreshWorkoutCommunication();
  scheduleWorkoutMessageCooldownRefresh();
  scheduleWorkoutMessageRetry(payload);
  return true;
}

function sendCheer(id) {
  return sendWorkoutMessage({ kind: "quick", quickId: id });
}

function sendFreeCheer() {
  return sendWorkoutMessage({
    kind: "text",
    text: state.workoutMessageDraft,
  });
}

function sendWorkoutMessageAck(message) {
  if (state.channel?.readyState !== "open") return false;
  try {
    state.channel.send(JSON.stringify({
      type: "training-workout-message-ack",
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      messageId: message.messageId,
      round: message.round,
      fromUid: state.uid,
      toUid: message.fromUid,
      status: "displayed",
    }));
    return true;
  } catch {
    return false;
  }
}

function receiveWorkoutMessage(message) {
  const view = trainingClientView();
  const context = workoutCommunicationContext(view);
  const roundIndex = Number(message.round);
  const messageId = String(message.messageId || "");
  const workoutUid = String(message.workoutUid || "");
  const fromUid = String(message.fromUid || "");
  const toUid = String(message.toUid || "");
  const normalizedKind = message.kind === "quick"
    ? "quick"
    : message.kind === "text"
      ? "text"
      : "";
  const quickId = normalizedKind === "quick" && WORKOUT_QUICK_MESSAGES[message.quickId]
    ? String(message.quickId)
    : "";
  const text = quickId
    ? WORKOUT_QUICK_MESSAGES[quickId]
    : normalizedKind === "text"
      ? normalizeWorkoutMessageText(message.text)
      : "";
  if (message.protocolVersion !== TRAINING_PROTOCOL_VERSION
    || message.variant !== TRAINING_VARIANT
    || !validWorkoutMessageId(messageId)
    || roundIndex !== context.roundIndex
    || fromUid !== context.opponentUid
    || toUid !== state.uid
    || !memberUids().includes(workoutUid)
    || !workoutIsActive(context.round, workoutUid)
    || !normalizedKind
    || !text) return false;
  ensureWorkoutMessageRound(roundIndex);
  const added = addWorkoutMessage({
    type: "training-workout-message",
    messageId,
    round: roundIndex,
    workoutUid,
    fromUid,
    toUid,
    kind: normalizedKind,
    ...(quickId ? { quickId } : {}),
    text,
    sentAt: Number(message.sentAt || 0),
    receivedAt: Date.now(),
  });
  refreshWorkoutCommunication();
  sendWorkoutMessageAck(message);
  return added;
}

function receiveWorkoutMessageAck(message) {
  const messageId = String(message.messageId || "");
  const roundIndex = Number(message.round);
  const ownMessage = state.workoutMessages.find((item) => (
    item.messageId === messageId
      && item.fromUid === state.uid
      && item.round === roundIndex
  ));
  if (message.protocolVersion !== TRAINING_PROTOCOL_VERSION
    || message.variant !== TRAINING_VARIANT
    || !ownMessage
    || String(message.fromUid || "") !== opponentPlayer()?.uid
    || String(message.toUid || "") !== state.uid
    || message.status !== "displayed") return false;
  state.workoutMessageAcks[messageId] = "displayed";
  const retryTimer = state.workoutMessageRetryTimers.get(messageId);
  if (retryTimer) window.clearTimeout(retryTimer);
  state.workoutMessageRetryTimers.delete(messageId);
  refreshWorkoutCommunication();
  return true;
}

function receiveCheer(message) {
  const view = trainingClientView();
  const context = workoutCommunicationContext(view);
  const text = message.type === "training-free-cheer"
    ? normalizeWorkoutMessageText(message.text)
    : CHEERS[message.cheerId];
  if (!text
    || Number(message.round) !== context.roundIndex
    || !context.ownActive) return false;
  ensureWorkoutMessageRound(context.roundIndex);
  addWorkoutMessage({
    type: message.type,
    messageId: createWorkoutMessageId(),
    round: context.roundIndex,
    workoutUid: state.uid,
    fromUid: context.opponentUid,
    toUid: state.uid,
    kind: message.type === "training-free-cheer" ? "text" : "quick",
    text,
    sentAt: firebaseNow(),
    receivedAt: Date.now(),
    legacy: true,
  });
  refreshWorkoutCommunication();
  return true;
}

function configureAmbienceForView(view, { enableAudio = true } = {}) {
  const context = ownWorkoutContext(view.roundIndex);
  if (view.phase === "workout_ready" && context) {
    primeWorkoutAmbience(view.roundIndex);
    return;
  }
  const startedAt = Number(context?.workout?.startedAt || 0);
  if (!startedAt || !TRAINING_RUNNING_PHASES.includes(view.phase)) return;
  setWorkoutAmbience(context, startedAt);
  if (enableAudio) state.ambienceController.enable().catch(() => {});
}

function primeWorkoutAmbience(roundIndex) {
  const revision = (roundIndex * 2) - 1;
  if (revision < state.ambienceRevision) return;
  state.ambienceController.setAmbience({
    metronomeBpm: 0,
    effectiveAt: firebaseNow(),
    revision,
  }, { serverTimeOffset: state.serverTimeOffset });
  state.ambienceRevision = revision;
}

function setWorkoutAmbience(context, effectiveAt) {
  const revision = context.roundIndex * 2;
  if (revision < state.ambienceRevision) return;
  try {
    state.ambienceController.setAmbience({
      metronomeBpm: context.bpm,
      effectiveAt,
      revision,
    }, { serverTimeOffset: state.serverTimeOffset });
    state.ambienceRevision = revision;
  } catch (error) {
    console.error(error);
  }
}

async function resumeTrainingAmbienceFromGesture() {
  state.ambienceUnlocked = true;
  const view = trainingClientView();
  if (!TRAINING_HUD_PHASES.includes(view.phase)) return false;
  configureAmbienceForView(view, { enableAudio: false });
  const enabled = await state.ambienceController.enable();
  state.ambienceResumeRequired = !enabled;
  if (enabled) render();
  return enabled;
}

async function resumeTrainingAmbienceAfterVisibility() {
  if (document.hidden
    || !active
    || !state.ambienceUnlocked
    || !state.roomId
    || state.screen !== "room") return;
  const view = trainingClientView();
  if (!TRAINING_HUD_PHASES.includes(view.phase)) return;
  configureAmbienceForView(view, { enableAudio: false });
  const enabled = await state.ambienceController.enable();
  if (enabled) {
    state.ambienceResumeRequired = false;
    return;
  }
  state.ambienceResumeRequired = true;
  render();
  showToast("メトロノームを再開するには「メトロノームを再開」をタップしてください。");
}

function toggleMute() {
  state.ambienceUnlocked = true;
  state.ambienceResumeRequired = false;
  state.ambienceController.enable().catch(() => {});
  state.muted = !state.muted;
  state.ambienceController.setMuted(state.muted);
  localStorage.setItem(TRAINING_MUTED_KEY, String(state.muted));
  const button = document.querySelector("#trainingMute");
  if (button) {
    button.textContent = state.muted ? "音を出す" : "ミュート";
    button.setAttribute("aria-pressed", String(state.muted));
  }
}

function updateVolume(event) {
  state.ambienceUnlocked = true;
  state.volume = state.ambienceController.setVolume(event.target.value);
  localStorage.setItem(TRAINING_VOLUME_KEY, String(state.volume));
}

function startTurnTicker(view) {
  clearTurnTicker();
  const updateTimer = () => {
    if (!active || state.screen !== "room") return;
    const context = ownWorkoutContext(view.roundIndex);
    const startedAt = Number(context?.workout?.startedAt || 0);
    if (!startedAt) return;
    const elapsed = Math.max(0, firebaseNow() - startedAt);
    const targetDuration = context.scoreInfo.durationMs;
    const remaining = Math.max(0, targetDuration - elapsed);
    const seconds = Math.ceil(remaining / 1000);
    const fill = document.querySelector("#trainingCountdownFill");
    const clock = document.querySelector("#trainingCountdown");
    const progress = document.querySelector("#trainingCountdownProgress");
    if (fill) fill.style.width = `${(remaining / targetDuration) * 100}%`;
    if (clock) clock.textContent = String(seconds);
    if (progress) {
      progress.setAttribute("aria-valuenow", String(seconds));
      progress.setAttribute("aria-valuemax", String(targetDuration / 1000));
      progress.setAttribute("aria-label", `筋トレ 残り${seconds}秒`);
    }
    const beat = trainingBeatState({
      startedAt,
      now: firebaseNow(),
      bpm: context.bpm,
      beatsPerRep: context.card.beatsPerRep,
    });
    document.querySelectorAll("#trainingBeatLane [data-beat]").forEach((item) => {
      item.classList.toggle("is-active", beat.enabled && Number(item.dataset.beat) === beat.beat);
    });
    if (elapsed >= targetDuration) {
      completeWorkout(view).catch(handleRecoverableError);
    }
  };
  updateTimer();
  state.ticker = window.setInterval(updateTimer, 100);
}

function clearTurnTicker() {
  window.clearInterval(state.ticker);
  state.ticker = null;
}

async function ensureFinalization(force = false) {
  if (!active || !state.roomId || !state.outcome || state.preview) return;
  if (state.finalizing || (state.finalization?.result?.status === "final" && !force)) return;
  window.clearTimeout(state.finalizeTimer);
  if (force) state.finalizeAttempts = 0;
  state.finalizing = true;
  state.finalization = force ? null : state.finalization;
  render();
  try {
    const response = await trainingActionCallable({ action: "finalize", roomId: state.roomId });
    const payload = response.data || {};
    state.finalization = payload;
    if (payload.result?.status === "final") {
      state.profile = payload.profile || state.profile;
      state.daily = payload.daily || state.daily;
      window.HariaiAchievements?.notify?.(payload.achievements?.pendingUnlocks || []);
    } else if (payload.result?.status === "pending" && state.finalizeAttempts < 8) {
      state.finalizeAttempts += 1;
      const delay = Math.min(10_000, Math.max(500, Number(payload.result.retryAfterMs || 1500)));
      state.finalizeTimer = window.setTimeout(() => ensureFinalization(), delay);
    } else if (payload.result?.status === "pending") {
      state.finalization = {
        ...payload,
        error: "完了記録の確認が長引いています。",
      };
    }
  } catch (error) {
    console.error(error);
    state.finalization = { error: error?.message || "記録を確認できませんでした。" };
  } finally {
    state.finalizing = false;
    render();
  }
}

async function markRoomDestroyed(reason) {
  if (state.outcome) return "result";
  if (!state.roomId) return "noop";
  if (state.destroying) return state.destroying;
  const roomId = state.roomId;
  const destruction = (async () => {
    const refreshed = await refreshRoomBeforeDestroy(roomId);
    if (refreshed !== "live") return refreshed;
    const transaction = await runTransaction(ref(database, `online/trainingRooms/${roomId}/destroyed`), (current) => current || {
      by: state.uid,
      at: firebaseNow(),
      reason: String(reason || "ended").slice(0, 80),
    });
    if (active && state.roomId === roomId && !state.outcome) {
      state.room.destroyed = transaction.snapshot.val() || { by: state.uid, reason };
      transitionToDestroyedRoom();
    }
    return "marked";
  })();
  state.destroying = destruction;
  try {
    return await destruction;
  } finally {
    if (state.destroying === destruction) state.destroying = null;
  }
}

async function cancelMatchmaking() {
  if (!await cleanupMatchmakingReliably(false)) {
    throw new Error(
      "参加待ちの終了を確認できませんでした。通信を確認して、もう一度お試しください。",
    );
  }
  await cleanupPublicPresence();
  releaseTrainingTabOwnership();
  state.screen = "setup";
  setTrainingChrome("鍛え合い READY");
  render();
}

async function cancelPendingRoom() {
  await teardownPendingRoom("player_cancelled");
  if (!await cleanupMatchmakingReliably(false)) {
    throw new Error(
      "対戦準備の終了を確認できませんでした。通信を確認して、もう一度お試しください。",
    );
  }
  await cleanupPublicPresence();
  releaseTrainingTabOwnership();
  state.room = emptyRoom();
  state.screen = "setup";
  setTrainingChrome("鍛え合い READY");
  render();
}

async function cleanupTrainingSessionMatchmaking(keepActive) {
  const roomId = state.roomId || state.pendingRoomId || state.sessionOfferRoomId;
  clearTrainingSessionTryMatchTimer();
  window.clearTimeout(state.sessionOfferRetryTimer);
  state.sessionOfferRetryTimer = null;
  window.clearTimeout(state.matchTimer);
  window.clearTimeout(state.enterRoomRetryTimer);
  state.matchTimer = null;
  state.enterRoomRetryTimer = null;
  state.matchmakingUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  if (keepActive) return true;

  const disconnects = state.disconnectHandles.splice(0);
  await Promise.allSettled(disconnects.map((handle) => handle?.cancel?.()));
  if (roomId) {
    await Promise.allSettled([
      remove(ref(database, trainingSessionPresencePath(
        roomId,
        state.uid,
        state.clientSessionId,
      ))),
      remove(ref(database, trainingSessionSignalPath(
        roomId,
        state.uid,
        state.clientSessionId,
      ))),
    ]);
  }
  if (roomId) {
    const response = await trainingSessionActionCallable({
      action: "cancel",
      sessionId: state.clientSessionId,
      leaseToken: state.clientLeaseToken,
      roomId,
      abort: Boolean(state.roomId && !state.outcome),
    }).catch(() => null);
    const cancellation = response?.data || {};
    if (cancellation.cancelled !== true
        && !["finalized", "resolved", "terminal", "not-owner"].includes(
          String(cancellation.reason || ""),
        )) return false;
  }
  const released = await releaseTrainingSessionClaimExact({
    sessionId: state.clientSessionId,
    leaseToken: state.clientLeaseToken,
    generation: state.sessionGeneration,
  });
  if (!released) return false;
  state.sessionLeaseHeld = false;
  state.sessionLease = null;
  state.sessionGeneration = "";
  state.matchmakingGeneration = "";
  state.opponentSessionId = "";
  state.roomConnectionGeneration = "";
  state.signalingAttemptId = "";
  state.sessionOfferRoomId = "";
  state.pendingRoomId = "";
  clearTrainingSessionHeartbeat();
  return true;
}

async function cleanupMatchmaking(keepActive) {
  if (state.sessionLease) {
    return cleanupTrainingSessionMatchmaking(keepActive);
  }
  const expectedRoomId = state.roomId
    || state.pendingRoomId
    || state.activeDisconnectRoomId;
  const queueSessionId = state.queueSessionId;
  window.clearInterval(state.queueHeartbeat);
  window.clearTimeout(state.matchTimer);
  window.clearTimeout(state.enterRoomRetryTimer);
  window.clearTimeout(state.inviteRetryTimer);
  clearTrainingHostTakeoverTimer();
  state.queueHeartbeat = null;
  state.matchTimer = null;
  state.enterRoomRetryTimer = null;
  if (!keepActive) state.enterRoomRetryAttempts = 0;
  state.inviteRetryTimer = null;
  state.matchmakingUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  const handles = state.disconnectHandles.splice(0);
  await Promise.allSettled(handles.map((handle) => handle?.cancel?.()));
  if (!keepActive && expectedRoomId && state.uid && !state.preview) {
    if (!await releaseTrainingActiveReservation(expectedRoomId)) return false;
  }
  if (!state.uid || state.preview || !trainingSharedStateOwned || !queueSessionId) return true;
  const invitesCleared = await cleanupTrainingInvitesForSession(queueSessionId);
  if (!invitesCleared) return false;
  const queueCleared = await removeOwnedTrainingQueue(queueSessionId);
  if (queueCleared && state.queueSessionId === queueSessionId) state.queueSessionId = "";
  return queueCleared;
}

async function retryTrainingCleanup(operation) {
  for (const delay of MATCHMAKING_CLEANUP_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    try {
      if (await operation()) return true;
    } catch (error) {
      console.error(error);
    }
  }
  return false;
}

function cleanupMatchmakingReliably(keepActive) {
  return retryTrainingCleanup(() => cleanupMatchmaking(keepActive));
}

function removeTrainingInviteReliably(targetUid, roomId, targetSessionId) {
  return retryTrainingCleanup(() => (
    removeTrainingInviteForSession(targetUid, roomId, targetSessionId)
  ));
}

function releaseMatchLockReliably(roomId) {
  return retryTrainingCleanup(() => releaseMatchLock(roomId));
}

async function requestHome() {
  if (!active) return;
  const liveRoom = (state.roomId || state.pendingRoomId)
    && !state.outcome
    && !["cancelled", "error"].includes(state.screen);
  if (liveRoom && !state.preview && destroyDialog?.showModal) {
    setTrainingChrome("鍛え合い ACTIVE");
    destroyDialog.showModal();
    return;
  }
  await deactivate({ returnHome: true });
}

async function destroyRoom() {
  if (!active) return;
  if (state.roomId && !state.outcome && !state.preview) {
    const resolution = await markRoomDestroyed("player_exit");
    if (resolution === "result") {
      destroyDialog?.close?.();
      return;
    }
  }
  await deactivate({ returnHome: true });
}

async function moveToFreeTable() {
  if (!await deactivate({ returnHome: false })) return;
  if (window.HariaiFreeTable?.start) {
    window.HariaiFreeTable.start();
    return;
  }
  showToast("貼り合い自由卓を読み込んでいます…");
  window.addEventListener("hariai-free-table-ready", () => window.HariaiFreeTable?.start?.(), { once: true });
}

async function restartTraining() {
  if (!await deactivate({ returnHome: false })) return;
  start();
}

async function deactivate({ returnHome }) {
  if (!active) return;
  try {
    await teardownPendingRoom("player_exit");
  } catch (error) {
    handleRecoverableError(error);
    return false;
  }
  if (state.roomId && !state.outcome && !state.preview) {
    let resolution = "";
    try {
      resolution = await markRoomDestroyed("player_exit");
    } catch (error) {
      handleRecoverableError(error);
      return false;
    }
    if (!["marked", "destroyed", "result"].includes(resolution)) {
      handleRecoverableError(new Error("鍛え合い60の終了を確認できませんでした。もう一度お試しください。"));
      return false;
    }
  }
  if (!await cleanupMatchmakingReliably(false)) {
    handleRecoverableError(new Error(
      "鍛え合い60の終了を確認できませんでした。通信を確認して、もう一度お試しください。",
    ));
    return false;
  }
  await cancelActiveRoomDestroyedDisconnect(state.roomId);
  active = false;
  state.generation += 1;
  window.clearTimeout(state.finalizeTimer);
  window.clearTimeout(state.workoutMessageCooldownTimer);
  clearWorkoutMessageOverlayTimers(state);
  clearWorkoutMessageRetryTimers(state);
  window.clearInterval(state.finisherTicker);
  window.clearInterval(state.finisherOfferTimer);
  state.finisherTicker = null;
  state.finisherOfferTimer = null;
  clearImageExchangeWatchdog();
  clearScorePoll();
  clearTurnTicker();
  await cleanupPublicPresence();
  state.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  const disconnects = state.disconnectHandles.splice(0);
  await Promise.allSettled(disconnects.map((handle) => handle?.cancel?.()));
  if (state.uid
      && state.roomId
      && !state.preview
      && state.room.sessionProtocolVersion !== 2) {
    await Promise.allSettled([
      set(ref(database, `online/trainingRooms/${state.roomId}/presence/${state.uid}`), {
        online: false,
        updatedAt: serverTimestamp(),
      }),
      remove(ref(database, `online/trainingRooms/${state.roomId}/signals/${state.uid}`)),
    ]);
  }
  state.channel?.close();
  state.peer?.close();
  await releaseTrainingWorkoutWakeLock(state);
  state.ambienceController.destroy();
  state.localImages.forEach(releaseImage);
  Object.values(state.remoteImages).forEach(releaseImage);
  state.localImages = Array(TRAINING_IMAGE_COUNT).fill(null);
  state.remoteImages = {};
  state.roomId = "";
  state.pendingRoomId = "";
  releaseTrainingTabOwnership();
  if (returnHome) window.HariaiApp?.returnHome?.();
  return true;
}

function playerByUid(uid) {
  return state.room.players?.[uid] || null;
}

function opponentPlayer() {
  const opponentUid = Object.keys(state.room.members || {}).find((uid) => uid !== state.uid);
  return opponentUid ? playerByUid(opponentUid) : null;
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "鍛え合い60の通信を確認できませんでした。");
}

async function handleFatalError(error) {
  console.error(error);
  try {
    await teardownPendingRoom("fatal_error");
  } catch (teardownError) {
    handleRecoverableError(teardownError);
    return;
  }
  const matchmakingCleared = await cleanupMatchmakingReliably(false)
    .catch(() => false);
  await cleanupPublicPresence().catch(() => {});
  if (matchmakingCleared) releaseTrainingTabOwnership();
  state.errorMessage = matchmakingCleared
    ? error?.message || "鍛え合い60を開始できませんでした。"
    : "通信が不安定なため、待機情報の終了を確認できませんでした。"
      + "接続を戻してから「タイトルへ戻る」をもう一度押してください。";
  state.screen = "error";
  render();
}

function previewImageUrl(label, colorA, colorB) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colorA}"/><stop offset="1" stop-color="${colorB}"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#g)"/>
      <circle cx="600" cy="430" r="230" fill="none" stroke="rgba(255,255,255,.24)" stroke-width="18"/>
      <text x="600" y="445" text-anchor="middle" fill="white" font-family="system-ui" font-size="74" font-weight="800">${label}</text>
      <text x="600" y="535" text-anchor="middle" fill="rgba(255,255,255,.7)" font-family="system-ui" font-size="30">KITA EAI 60 PREVIEW</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function installPreview(preview) {
  state.uid = "preview-self";
  state.authReady = true;
  state.chatFramesReady = true;
  state.chatFrameInventory = {
    chat_frame_heart_ribbon: true,
    chat_frame_neon: true,
  };
  state.selectedChatFrameId = "chat_frame_heart_ribbon";
  state.name = "ANJU";
  state.conditions = "ジャンプなし／今日は標準";
  state.profile = {
    hpSessions: 8,
    hpCompletedWorkouts: 14,
    hpHitsTaken: 14,
    hpCompletedSeconds: 960,
    hpWins: 4,
    completeDays: 6,
  };
  state.daily = { trainingMatches: 1 };
  const previewCards = [
    ["ICE COLD BEER", "#117f99", "#081322", 120],
    ["GYUDON", "#d46d25", "#32130b", 100],
    ["STEAK", "#a32b35", "#26070d", 80],
    ["TONKOTSU", "#e8b567", "#2c1a10", 140],
    ["LEMON SOUR", "#b5d84b", "#14260b", 0],
  ];
  state.localImages = previewCards.map(([label, colorA, colorB, bpm]) => ({
    blob: new Blob(["preview"], { type: "image/webp" }),
    url: previewImageUrl(label, colorA, colorB),
    mime: "image/webp",
    bpm,
  }));
  if (preview === "setup") {
    state.screen = "setup";
    render();
    return;
  }
  const now = Date.now();
  state.remoteImages[1] = {
    blob: new Blob(["preview"], { type: "image/webp" }),
    url: previewImageUrl("TONKOTSU RAMEN", "#e66a2c", "#2b1012"),
    mime: "image/webp",
    bpm: 128,
    imageIndex: 2,
  };
  state.remoteImages[2] = {
    blob: new Blob(["preview"], { type: "image/webp" }),
    url: previewImageUrl("DRAFT BEER", "#d9a321", "#151d28"),
    mime: "image/webp",
    bpm: 140,
    imageIndex: 4,
  };
  state.roomId = "training-preview-room";
  const partnerDeck = commandDeckPayload([
    PRESETS.squat,
    PRESETS.pushup,
    PRESETS.situp,
  ]);
  const ownDeck = commandDeckPayload();
  const roundOne = {
    createdAt: now - 120_000,
    draws: {
      "preview-self": { imageIndex: 1, bpm: 120, drawnAt: now - 119_000 },
      "preview-partner": { imageIndex: 2, bpm: 128, drawnAt: now - 119_000 },
    },
    imageReceived: { "preview-self": true, "preview-partner": true },
    scores: {},
    commandChoices: {},
    workouts: {},
  };
  if (preview === "command") {
    roundOne.scores = { "preview-self": 7, "preview-partner": 9 };
  } else if (preview === "workout") {
    roundOne.scores = { "preview-self": 9, "preview-partner": 7 };
    roundOne.commandChoices["preview-self"] = {
      trainerUid: "preview-partner",
      cardIndex: 1,
      selectedAt: now - 20_000,
    };
    roundOne.workouts["preview-self"] = { startedAt: now - 17_000 };
  }
  if (preview === "result") {
    roundOne.scores = { "preview-self": 10, "preview-partner": 8 };
    roundOne.commandChoices = {
      "preview-self": { trainerUid: "preview-partner", cardIndex: 1, selectedAt: now - 110_000 },
      "preview-partner": { trainerUid: "preview-self", cardIndex: 1, selectedAt: now - 110_000 },
    };
    roundOne.workouts = {
      "preview-self": { startedAt: now - 108_000, completedAt: now - 18_000 },
      "preview-partner": { startedAt: now - 108_000, completedAt: now - 48_000 },
    };
    roundOne.completedAt = now - 17_000;
  }
  const rounds = preview === "draw" ? { 1: { createdAt: now - 2_000 } } : { 1: roundOne };
  if (preview === "result") {
    rounds[2] = {
      createdAt: now - 16_000,
      draws: {
        "preview-self": { imageIndex: 3, bpm: 80, drawnAt: now - 15_000 },
        "preview-partner": { imageIndex: 4, bpm: 140, drawnAt: now - 15_000 },
      },
      imageReceived: { "preview-self": true, "preview-partner": true },
      scores: { "preview-self": 9, "preview-partner": 6 },
      commandChoices: {
        "preview-self": { trainerUid: "preview-partner", cardIndex: 2, selectedAt: now - 14_000 },
      },
      workouts: {
        "preview-self": { startedAt: now - 90_000, completedAt: now - 15_000 },
      },
      completedAt: now - 1_000,
    };
  }
  state.room = {
    ...emptyRoom(),
    protocolVersion: TRAINING_PROTOCOL_VERSION,
    variant: TRAINING_VARIANT,
    hostUid: "preview-partner",
    guestUid: "preview-self",
    status: "active",
    members: { "preview-partner": true, "preview-self": true },
    chatFrames: {
      "preview-partner": "chat_frame_neon",
      "preview-self": "chat_frame_heart_ribbon",
    },
    players: {
      "preview-partner": {
        uid: "preview-partner", name: "TRAINER", intensity: "standard", conditions: "指定なし",
        commandDeck: partnerDeck,
        imageBpms: { 1: 90, 2: 128, 3: 110, 4: 140, 5: 0 },
      },
      "preview-self": {
        uid: "preview-self", name: "ANJU", intensity: "standard", conditions: "ジャンプなし",
        commandDeck: ownDeck,
        imageBpms: imageBpmsPayload(),
      },
    },
    accepted: { "preview-partner": true, "preview-self": true },
    rounds,
  };
  if (preview === "workout") {
    state.workoutMessageRoomId = state.roomId;
    state.workoutMessageRound = 1;
    state.workoutMessages = [
      {
        type: "training-workout-message",
        messageId: "preview-message-1",
        round: 1,
        workoutUid: "preview-self",
        fromUid: "preview-partner",
        toUid: "preview-self",
        kind: "quick",
        text: "いける！",
        sentAt: now - 3_000,
        receivedAt: now - 3_000,
      },
      {
        type: "training-workout-message",
        messageId: "preview-message-2",
        round: 1,
        workoutUid: "preview-self",
        fromUid: "preview-self",
        toUid: "preview-partner",
        kind: "quick",
        text: "届いてる！",
        sentAt: now - 1_000,
        receivedAt: now - 1_000,
      },
    ];
    state.workoutMessageIds = new Set(state.workoutMessages.map((message) => message.messageId));
    state.workoutMessageAcks = { "preview-message-2": "displayed" };
    state.workoutMessageOverlayIds = state.workoutMessages.map((message) => message.messageId);
  }
  if (preview === "result") {
    state.outcome = deriveTrainingRoomState(state.room, state.uid, now);
    state.finalization = {
      result: {
        status: "final",
        outcome: "loss",
        reason: "hp_zero",
        completedWorkouts: 2,
        roundCount: 2,
      },
      profile: state.profile,
      daily: state.daily,
    };
    state.profile = state.finalization.profile;
    state.daily = state.finalization.daily;
    state.screen = "result";
  } else {
    state.screen = "room";
  }
  render();
}

window.addEventListener("pagehide", () => {
  releaseTrainingTabOwnership();
  if (!active) return;
  window.clearInterval(state.finisherTicker);
  window.clearInterval(state.finisherOfferTimer);
  state.finisherTicker = null;
  state.finisherOfferTimer = null;
  clearImageExchangeWatchdog();
  clearScorePoll();
  clearTurnTicker();
  releaseTrainingWorkoutWakeLock(state);
  state.ambienceController.destroy();
  state.channel?.close();
  state.peer?.close();
  state.localImages.forEach(releaseImage);
  Object.values(state.remoteImages).forEach(releaseImage);
}, { once: true });

window.HariaiTraining = {
  start,
  isActive,
  requestHome,
  destroyRoom,
};
window.dispatchEvent(new CustomEvent("hariai-training-ready"));

if (isPreviewRequest()) queueMicrotask(start);
