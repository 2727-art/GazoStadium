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
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1";
import {
  appendIncomingOnlineImageChunk,
  completeIncomingOnlineImageTransfer,
  createIncomingOnlineImageTransfer,
  onlineImageEndStatus,
  verifiedOnlineImageMime,
} from "./online-image-transfer.mjs?v=online-image-transfer-v1";
import {
  createFreeTableAmbienceController,
} from "./free-table-ambience.mjs?v=free-table-ambience-v2";
import {
  ONLINE_P2P_RECOVERY_PHASES,
  createOnlineP2pGenerationToken,
  createOnlineP2pRecoveryState,
  getOnlineP2pRecoveryTimer,
  transitionOnlineP2pRecovery,
} from "./online-p2p-hardening.mjs?v=online-p2p-hardening-v2";
import {
  CHAT_FRAME_PRODUCTS,
  chatCosmeticClassNames,
  getEquippedChatCosmetics,
} from "./chat-cosmetics.js?v=chat-cosmetics-v1";
import {
  TRAINING_SESSION_V5_PROTOCOL_VERSION,
  TRAINING_SESSION_V5_SIGNALING_VERSION,
  createTrainingSessionV5PresencePayload,
  createTrainingSessionV5SignalEnvelope,
  decideTrainingSessionV5Signal,
  shouldConsumeTrainingSessionV5Signal,
  trainingImageRoundsNeedingResend,
  trainingSessionV5AttemptPath,
  trainingSessionV5PresencePath,
  trainingSessionV5SignalPath,
} from "./training-session-v5.mjs?v=training-session-v5-canonical-v1";
import {
  createTrainingSessionV5State,
  trainingSessionV5Screen,
  transitionTrainingSessionV5,
} from "./training-session-v5-machine.mjs?v=training-session-v5-canonical-v1";
import {
  TRAINING_LIMITS,
  TRAINING_PROTOCOL_VERSION,
  TRAINING_VARIANT,
  deriveTrainingRoomState,
  normalizeTrainingConditions,
  normalizeTrainingInstruction,
  normalizeTrainingIntensity,
  normalizeTrainingName,
  trainingBeatState,
  trainingServerFinalizedResult,
} from "./training-core.mjs?v=kitaeai-hp-v3-matchmaking-v1";

const PUBLIC_PRESENCE_HEARTBEAT_MS = 20_000;
const MATCHMAKING_CLEANUP_RETRY_DELAYS_MS = Object.freeze([0, 250, 750]);
const TRAINING_V5_RUN_STORAGE_KEY = "hariai-training-v5-run-id";
const TRAINING_V5_ENDPOINT_STORAGE_KEY = "hariai-training-v5-endpoint-id";
const TRAINING_V5_HEARTBEAT_MS = 15_000;
const TRAINING_V5_MATCH_RETRY_MS = 1_200;
const TRAINING_V5_RECOVERY_MAX_MS = 8_000;
const TRAINING_V5_ROOM_CONVERGENCE_DELAYS_MS = Object.freeze([
  0, 200, 500, 1_000, 2_000, 4_000,
]);
const IMAGE_EXCHANGE_TIMEOUT_MS = 45_000;
const IMAGE_CHANNEL_LABEL = "hariai-training-image-v3";
const MAX_IMAGE_TRANSFER_BYTES = 8 * 1024 * 1024;
const IMAGE_CHUNK_BYTES = 60 * 1024;
const MAX_IMAGE_CHANNEL_FRAME_BYTES = 65_535;
const TRAINING_IMAGE_CHUNK_MAGIC = Object.freeze([0x48, 0x54, 0x49, 0x31]);
const TRAINING_IMAGE_TRANSFER_ID_MIN_LENGTH = 20;
const TRAINING_IMAGE_TRANSFER_ID_MAX_LENGTH = 80;
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
  ? new BroadcastChannel("hariai-stadium-training-tab-v5")
  : null;
const TRAINING_TAB_LOCK_NAME = "hariai-stadium-training-v5";

let active = false;
let trainingLifecycleGeneration = 0;
let state = createState();
let trainingSharedStateOwned = false;
let releaseTrainingTabLock = null;
let trainingTabLockRequest = null;

trainingTabChannel?.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.tabId === trainingTabId) return;
  if (message.type === "probe" && trainingSharedStateOwned) {
    trainingTabChannel.postMessage({
      type: "probe-response",
      probeId: message.probeId,
      tabId: trainingTabId,
    });
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
      && !targetState.trainingAttemptHeartbeatBusy
      && !targetState.trainingAttemptInspectBusy) {
    inspectTrainingSessionV5(targetState, { immediate: true }).catch(() => {});
  }
  queueMicrotask(() => {
    resumeTrainingAmbienceAfterVisibility().catch(() => {});
    syncTrainingWorkoutWakeLock(targetState);
  });
});
window.addEventListener("online", () => {
  dispatchTrainingP2pRecoveryEvent?.("NETWORK_CHANGED", state, { online: true });
  inspectTrainingSessionV5(state, { immediate: true }).catch(() => {});
});
window.addEventListener("offline", () => {
  dispatchTrainingP2pRecoveryEvent?.("NETWORK_CHANGED", state, { online: false });
  enterTrainingSessionV5Recovery(state, "network-offline");
});

function storedVolume() {
  const value = Number(localStorage.getItem(TRAINING_VOLUME_KEY));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.18;
}

function createTrainingSessionV5Token() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${
      Math.random().toString(36).slice(2)
    }`;
}

function resolveTrainingSessionV5EndpointId() {
  const stored = sessionStorage.getItem(TRAINING_V5_ENDPOINT_STORAGE_KEY);
  if (/^[-_0-9A-Za-z]{20,80}$/.test(String(stored || ""))) return stored;
  const endpointId = createTrainingSessionV5Token();
  sessionStorage.setItem(TRAINING_V5_ENDPOINT_STORAGE_KEY, endpointId);
  return endpointId;
}

function resolveTrainingSessionV5RunId() {
  const stored = sessionStorage.getItem(TRAINING_V5_RUN_STORAGE_KEY);
  return /^[-_0-9A-Za-z]{20,80}$/.test(String(stored || "")) ? stored : "";
}

function createState() {
  const volume = storedVolume();
  const muted = localStorage.getItem(TRAINING_MUTED_KEY) === "true";
  const ambienceController = createFreeTableAmbienceController({ initialVolume: volume });
  ambienceController.setMuted(muted);
  return {
    generation: ++trainingLifecycleGeneration,
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
    sessionV5: createTrainingSessionV5State(),
    trainingRunId: "",
    trainingRunRestored: false,
    trainingEndpointId: resolveTrainingSessionV5EndpointId(),
    trainingOwnerEpoch: "",
    trainingAttemptRevision: 0,
    trainingAttemptState: "",
    trainingAttempt: null,
    trainingAttemptUnsubscribe: null,
    trainingAttemptHeartbeat: null,
    trainingAttemptHeartbeatBusy: false,
    trainingAttemptMatchTimer: null,
    trainingAttemptMatchBusy: false,
    trainingAttemptInspectTimer: null,
    trainingAttemptInspectBusy: false,
    trainingAttemptRecoveryCount: 0,
    trainingSessionCancelling: false,
    trainingOwnerSuperseded: false,
    opponentRunId: "",
    opponentEndpointId: "",
    opponentOwnerEpoch: "",
    roomAttemptId: "",
    transportEpoch: "",
    trainingSignalUnsubscribe: null,
    trainingReconnectPromise: null,
    trainingReconnectTimer: null,
    trainingTransportRefreshPromise: null,
    trainingTransportRefreshEpoch: "",
    trainingTransportRefreshSequence: 0,
    trainingTransportReadyEpoch: "",
    trainingResultRtdbRelease: null,
    trainingProtectedRtdbReleased: false,
    sessionLeaseHeld: false,
    sessionAutoRequeueCount: 0,
    startingMatchmaking: false,
    enteringRoom: false,
    enterRoomRetryTimer: null,
    enterRoomRetryAttempts: 0,
    serverTimeOffset: 0,
    publicPresenceId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    publicPresenceOwnerDisconnect: null,
    roomUnsubscribers: [],
    scorePoll: null,
    scorePollBusy: false,
    resultScoreHydration: null,
    resultScoreHydrationRetryAt: 0,
    roomSyncing: false,
    disconnectHandles: [],
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
    localRoundDrawFlights: new Map(),
    outgoingImageFlights: new Map(),
    outgoingImageSendQueues: new Map(),
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
    roomAttemptId: "",
    transportEpoch: "",
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
  state.preview = preview;
  setTrainingChrome("鍛え合い READY");
  if (preview) {
    installPreview(preview);
    return;
  }
  render();
  const targetState = state;
  const generation = targetState.generation;
  ensureAuthenticated(targetState, generation).catch((error) => {
    if (active
        && state === targetState
        && targetState.generation === generation) {
      handleFatalError(error);
    }
  });
}

function anotherModeIsActive() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiAiTextTraining?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiFreeTable?.isActive?.()
    || window.HariaiAccount?.isActive?.()
  );
}

function isActive() {
  return active;
}

async function ensureAuthenticated(
  targetState = state,
  generation = targetState.generation,
) {
  const contextIsCurrent = () => (
    active
    && state === targetState
    && targetState.generation === generation
    && !targetState.trainingSessionCancelling
  );
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!contextIsCurrent()) return;
  targetState.uid = credential.user.uid;
  const initialized = await trainingActionCallable({ action: "initialize" });
  if (!contextIsCurrent()) return;
  targetState.profile = initialized.data?.profile || null;
  targetState.daily = initialized.data?.daily || null;
  await loadTrainingChatFrameLoadout(targetState);
  if (!contextIsCurrent()) return;
  targetState.authReady = true;
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
  const recovering = state.sessionV5.phase === "recovering";
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingMatchingTitle">
      <div class="training-pulse-mark" aria-hidden="true"><i></i><i></i><i></i></div>
      <span class="eyebrow">${recovering ? "SESSION RECOVERING" : "ONE QUEUE / ROLEPLAY MATCH"}</span>
      <h1 id="trainingMatchingTitle">${recovering
        ? "同じ参加待ちへ戻っています"
        : "鍛え合う相手を探しています"}</h1>
      <p>${recovering
        ? "通信状態をサーバーへ確認しています。待機を終了したり、別の対戦を作り直したりはしません。"
        : "古くから待っている2人を順番に結びます。5枚の画像本体はまだ送信されていません。"}</p>
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
  const recovering = state.sessionV5.phase === "recovering";
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingFormingTitle">
      <div class="training-pair-mark" aria-hidden="true"><span>1</span><i></i><span>1</span></div>
      <span class="eyebrow">${recovering ? "ROOM RECOVERING" : "PAIR FOUND"}</span>
      <h1 id="trainingFormingTitle">${recovering
        ? "成立した対戦ルームを確認しています"
        : "鍛え合いの約束を結んでいます"}</h1>
      <p><strong>${accepted} / 2</strong> 人が参加を確認しました。</p>
      <div class="training-forming-bar" role="progressbar" aria-label="参加確認" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${accepted}">
        <i style="width:${accepted * 50}%"></i>
      </div>
      <p class="training-subtle">${recovering
        ? "通信が戻り次第、同じ相手・同じ対戦ルームへ接続します。"
        : "成立後にだけ、2人のブラウザをP2Pでつないで画像を交換します。"}</p>
      <button class="button button-ghost" id="trainingCancelPending" type="button">参加を取り消す</button>
    </section>`;
}

function renderRoom() {
  const canonicalView = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  const finalizedView = viewFromServerFinalized(state.room.serverFinalized, canonicalView);
  if (finalizedView) {
    clearImageExchangeWatchdog();
    clearScorePoll();
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
  if (!navigator.locks?.request) {
    throw new Error(
      "このブラウザでは鍛え合い60の多重起動を安全に防げません。"
      + "Web Locks対応ブラウザでお試しください。",
    );
  }
  let resolveAcquired;
  const acquired = new Promise((resolve) => {
    resolveAcquired = resolve;
  });
  trainingTabLockRequest = navigator.locks.request(
    TRAINING_TAB_LOCK_NAME,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      resolveAcquired(Boolean(lock));
      if (!lock) return;
      await new Promise((resolve) => {
        releaseTrainingTabLock = resolve;
      });
    },
  ).catch((error) => {
    resolveAcquired(false);
    throw error;
  });
  if (!await acquired) {
    trainingTabLockRequest?.catch(() => {});
    trainingTabLockRequest = null;
    throw new Error("別のタブで鍛え合い60が進行中です。そちらを終了してから開始してください。");
  }
  trainingSharedStateOwned = true;
  trainingTabChannel?.postMessage({ type: "active", tabId: trainingTabId });
}

function releaseTrainingTabOwnership() {
  trainingSharedStateOwned = false;
  releaseTrainingTabLock?.();
  releaseTrainingTabLock = null;
  trainingTabLockRequest?.catch(() => {});
  trainingTabLockRequest = null;
}

function trainingSessionV5ContextIsCurrent(targetState = state) {
  return active
    && state === targetState
    && Boolean(targetState.trainingRunId)
    && Boolean(targetState.trainingEndpointId)
    && !targetState.trainingSessionCancelling
    && !["idle", "terminal", "superseded"].includes(targetState.sessionV5.phase)
    && targetState.sessionV5.runId === targetState.trainingRunId
    && !targetState.trainingOwnerSuperseded;
}

function createTrainingSessionV5RequestFence(targetState = state) {
  return Object.freeze({
    generation: targetState.generation,
    runId: targetState.trainingRunId,
    endpointId: targetState.trainingEndpointId,
    ownerEpoch: targetState.trainingOwnerEpoch,
  });
}

function trainingSessionV5RequestFenceIsCurrent(
  targetState,
  requestFence,
) {
  return trainingSessionV5ContextIsCurrent(targetState)
    && targetState.generation === requestFence.generation
    && targetState.trainingRunId === requestFence.runId
    && targetState.trainingEndpointId === requestFence.endpointId
    && (
      !requestFence.ownerEpoch
      || targetState.trainingOwnerEpoch === requestFence.ownerEpoch
    );
}

function beginTrainingSessionV5Cancellation(targetState = state) {
  if (state !== targetState) return false;
  if (!targetState.trainingSessionCancelling) {
    targetState.trainingSessionCancelling = true;
    targetState.generation = ++trainingLifecycleGeneration;
  }
  return true;
}

function applyTrainingSessionV5Transition(targetState, type, detail = {}) {
  if (state !== targetState) return false;
  const current = targetState.sessionV5;
  const event = type === "BEGIN"
    ? { type, runId: detail.runId, revision: current.revision }
    : {
      type,
      runId: current.runId,
      revision: current.revision,
      ...detail,
    };
  const transition = transitionTrainingSessionV5(current, event);
  if (!transition.accepted) return false;
  targetState.sessionV5 = transition.state;
  if (!targetState.outcome && !targetState.roomId) {
    targetState.screen = trainingSessionV5Screen(transition.state);
  }
  return true;
}

function trainingSessionV5AttemptView(payload = {}) {
  const source = payload?.attempt && typeof payload.attempt === "object"
    ? payload.attempt
    : payload;
  const explicitReason = String(payload?.reason || "");
  return {
    outcome: String(
      payload?.outcome
      || source?.state
      || (["owner-replaced", "not-started"].includes(explicitReason)
        ? explicitReason
        : ""),
    ),
    reason: String(source?.terminalReason || payload?.reason || ""),
    uid: String(source?.uid || payload?.uid || ""),
    runId: String(source?.runId || payload?.runId || ""),
    endpointId: String(source?.endpointId || payload?.endpointId || ""),
    ownerEpoch: String(source?.ownerEpoch || payload?.ownerEpoch || ""),
    revision: source?.revision ?? payload?.revision ?? 0,
    state: String(source?.state || payload?.state || payload?.outcome || ""),
    roomId: String(source?.roomId || payload?.roomId || ""),
    roomAttemptId: String(
      source?.roomAttemptId || payload?.roomAttemptId || "",
    ),
    transportEpoch: String(
      source?.transportEpoch || payload?.transportEpoch || "",
    ),
    role: String(source?.role || payload?.role || ""),
    opponentUid: String(source?.opponentUid || payload?.opponentUid || ""),
    preparation: source?.preparation || payload?.preparation || null,
  };
}

function trainingSessionV5TokenIsValid(value) {
  return /^[-_0-9A-Za-z]{20,80}$/.test(String(value || ""));
}

function trainingSessionV5AttemptRevisionMatches(left, right) {
  if (!left || !right) return false;
  const keys = [
    "ownerEpoch",
    "state",
    "roomId",
    "roomAttemptId",
    "transportEpoch",
    "role",
    "opponentUid",
  ];
  return keys.every((key) => String(left[key] || "") === String(right[key] || ""))
    && (
      left.state !== "terminal"
      || String(left.reason || "") === String(right.reason || "")
    );
}

function clearTrainingSessionV5MatchTimer(targetState = state) {
  window.clearTimeout(targetState.trainingAttemptMatchTimer);
  targetState.trainingAttemptMatchTimer = null;
}

function clearTrainingSessionV5InspectTimer(targetState = state) {
  window.clearTimeout(targetState.trainingAttemptInspectTimer);
  targetState.trainingAttemptInspectTimer = null;
}

function clearTrainingSessionV5Heartbeat(targetState = state) {
  window.clearTimeout(targetState.trainingAttemptHeartbeat);
  targetState.trainingAttemptHeartbeat = null;
}

function clearTrainingSessionV5ReconnectTimer(targetState = state) {
  window.clearTimeout(targetState.trainingReconnectTimer);
  targetState.trainingReconnectTimer = null;
}

function scheduleTrainingSessionV5Heartbeat(
  targetState = state,
  delayMs = TRAINING_V5_HEARTBEAT_MS,
) {
  clearTrainingSessionV5Heartbeat(targetState);
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || !targetState.trainingOwnerEpoch) return;
  targetState.trainingAttemptHeartbeat = window.setTimeout(() => {
    targetState.trainingAttemptHeartbeat = null;
    heartbeatTrainingSessionV5(targetState).catch(() => {});
  }, Math.max(500, delayMs));
}

function scheduleTrainingSessionV5Match(
  targetState = state,
  delayMs = TRAINING_V5_MATCH_RETRY_MS,
) {
  clearTrainingSessionV5MatchTimer(targetState);
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || !targetState.trainingOwnerEpoch
      || targetState.trainingAttemptState !== "waiting"
      || targetState.sessionV5.phase === "recovering"
      || !navigator.onLine
      || targetState.roomId
      || targetState.pendingRoomId) return;
  targetState.trainingAttemptMatchTimer = window.setTimeout(() => {
    targetState.trainingAttemptMatchTimer = null;
    matchTrainingSessionV5(targetState).catch(() => {});
  }, Math.max(0, delayMs));
}

function scheduleTrainingSessionV5Inspect(targetState = state, immediate = false) {
  clearTrainingSessionV5InspectTimer(targetState);
  if (!trainingSessionV5ContextIsCurrent(targetState)) return;
  const exponent = Math.min(4, targetState.trainingAttemptRecoveryCount);
  const delay = immediate
    ? 0
    : Math.min(TRAINING_V5_RECOVERY_MAX_MS, 500 * (2 ** exponent));
  targetState.trainingAttemptInspectTimer = window.setTimeout(() => {
    targetState.trainingAttemptInspectTimer = null;
    inspectTrainingSessionV5(targetState).catch(() => {});
  }, delay);
}

function enterTrainingSessionV5Recovery(
  targetState = state,
  reason = "network-unknown",
) {
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || ["terminal", "superseded"].includes(targetState.sessionV5.phase)) return;
  if (targetState.sessionV5.phase !== "recovering") {
    applyTrainingSessionV5Transition(targetState, "RECOVER", {
      reason: trainingSessionV5TokenIsValid(reason)
        ? reason
        : "network-unknown",
    });
  }
  targetState.trainingAttemptRecoveryCount += 1;
  scheduleTrainingSessionV5Inspect(targetState);
}

function trainingPermissionWasRevoked(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("permission-denied")
    || code.includes("permission_denied")
    || message.includes("permission denied")
    || message.includes("permission_denied");
}

function handleTrainingRtdbListenerError(
  error,
  contextIsCurrent,
  targetState = state,
) {
  if (!contextIsCurrent()) return;
  if (!trainingPermissionWasRevoked(error)) {
    handleRecoverableError(error);
    return;
  }
  if (targetState.outcome || targetState.trainingProtectedRtdbReleased) {
    console.info("Training 60 listener closed after the canonical result.");
    return;
  }
  if (!trainingSessionV5ContextIsCurrent(targetState)) return;
  console.info(
    "Training 60 protected listener permission changed; inspecting the canonical session.",
  );
  if (targetState.sessionV5.phase !== "recovering"
      || targetState.sessionV5.recoveryReason !== "room-permission-revoked") {
    enterTrainingSessionV5Recovery(
      targetState,
      "room-permission-revoked",
    );
  }
  invalidateTrainingTransportRefreshes(targetState);
  scheduleTrainingSessionV5Inspect(targetState, true);
}

function handleTrainingRtdbOperationError(error, contextIsCurrent) {
  if (contextIsCurrent()) handleRecoverableError(error);
}

function createTrainingPresenceDisconnectHandle({
  disconnect,
  presenceRef,
  presencePayload,
}) {
  let released = false;
  return {
    async cancel() {
      if (released) return;
      released = true;
      await disconnect?.cancel?.();
    },
    async deactivate(overrides = {}) {
      if (released) return;
      await set(presenceRef, {
        ...presencePayload,
        ...overrides,
        online: false,
        updatedAt: firebaseNow(),
      });
      released = true;
      await disconnect?.cancel?.();
    },
  };
}

async function releaseTrainingDisconnectHandles(
  targetState = state,
  overrides = {},
) {
  const disconnects = targetState.disconnectHandles.splice(0);
  await Promise.allSettled(disconnects.map((handle) => (
    handle?.deactivate?.(overrides) || handle?.cancel?.()
  )));
}

function detachTrainingSessionV5RtdbTransport(
  targetState = state,
  presenceOverrides = {},
) {
  targetState.roomUnsubscribers.splice(0)
    .forEach((unsubscribe) => unsubscribe?.());
  targetState.trainingSignalUnsubscribe?.();
  targetState.trainingSignalUnsubscribe = null;
  targetState.trainingTransportReadyEpoch = "";
  return releaseTrainingDisconnectHandles(targetState, presenceOverrides);
}

function releaseTrainingProtectedRtdbTransport(
  targetState = state,
  presenceOverrides = {},
) {
  targetState.trainingProtectedRtdbReleased = true;
  return detachTrainingSessionV5RtdbTransport(
    targetState,
    presenceOverrides,
  );
}

async function stopTrainingSessionV5LocalTransport(targetState = state) {
  clearTrainingSessionV5Heartbeat(targetState);
  clearTrainingSessionV5MatchTimer(targetState);
  clearTrainingSessionV5InspectTimer(targetState);
  window.clearTimeout(targetState.enterRoomRetryTimer);
  targetState.enterRoomRetryTimer = null;
  clearTrainingSessionV5ReconnectTimer(targetState);
  targetState.trainingAttemptUnsubscribe?.();
  targetState.trainingAttemptUnsubscribe = null;
  invalidateTrainingTransportRefreshes(targetState);
  await releaseTrainingProtectedRtdbTransport(targetState);
  targetState.channel?.close();
  targetState.peer?.close();
  targetState.channel = null;
  targetState.peer = null;
  targetState.pendingIce = [];
  clearImageExchangeWatchdog();
  clearScorePoll();
  clearTurnTicker();
  clearTrainingP2pRecoveryTimer(targetState);
  targetState.p2pRestartIce = null;
  targetState.p2pRecovery = null;
  targetState.p2pGenerationToken = null;
  targetState.ambienceController.disable();
  await releaseTrainingWorkoutWakeLock(targetState);
}

async function handleTrainingSessionV5OwnerReplaced(targetState = state) {
  if (state !== targetState || targetState.trainingOwnerSuperseded) return;
  targetState.trainingOwnerSuperseded = true;
  applyTrainingSessionV5Transition(targetState, "OWNER_STATUS", {
    status: "owner-replaced",
  });
  await stopTrainingSessionV5LocalTransport(targetState);
  await cleanupPublicPresence(targetState).catch(() => {});
  releaseTrainingTabOwnership();
  sessionStorage.removeItem(TRAINING_V5_RUN_STORAGE_KEY);
  targetState.errorMessage = targetState.roomId
    ? "別の端末で同じ鍛え合い60が再開されました。この画面は接続だけを停止し、対戦ルームには変更を加えていません。"
    : "別の端末で同じ鍛え合い60が開始されました。この画面の待機を終了しました。";
  targetState.screen = "error";
  render();
}

function syncTrainingSessionV5Machine(targetState, attempt) {
  if (targetState.sessionV5.phase === "recovering") {
    applyTrainingSessionV5Transition(targetState, "OWNER_STATUS", {
      status: "reclaimed",
    });
  }
  if (targetState.sessionV5.phase === "starting") {
    applyTrainingSessionV5Transition(targetState, "CLAIMED");
  }
  if (attempt.state === "waiting"
      && ["reserved", "connecting"].includes(targetState.sessionV5.phase)) {
    applyTrainingSessionV5Transition(targetState, "WAIT");
  }
  if (["reserved", "active"].includes(attempt.state)
      && targetState.sessionV5.phase === "waiting") {
    applyTrainingSessionV5Transition(targetState, "RESERVE", {
      roomId: attempt.roomId,
      roomAttemptId: attempt.roomAttemptId,
    });
  }
  const transportChanged = targetState.sessionV5.transportEpoch
    !== attempt.transportEpoch;
  if (attempt.state === "active"
      && (
        targetState.sessionV5.phase === "reserved"
        || (
          ["connecting", "active"].includes(targetState.sessionV5.phase)
          && transportChanged
        )
      )) {
    applyTrainingSessionV5Transition(targetState, "CONNECT", {
      transportEpoch: attempt.transportEpoch,
    });
  }
}

function finishTrainingSessionV5ResultOwnership(
  targetState,
  attempt = targetState.trainingAttempt,
) {
  if (state !== targetState || !targetState.outcome) return false;
  targetState.trainingResultRtdbRelease ||= releaseTrainingProtectedRtdbTransport(
    targetState,
    { transportEpoch: targetState.transportEpoch },
  );
  targetState.trainingAttemptState = "terminal";
  targetState.trainingAttempt = attempt || targetState.trainingAttempt;
  if (!["terminal", "superseded"].includes(targetState.sessionV5.phase)) {
    applyTrainingSessionV5Transition(targetState, "TERMINATE", {
      terminalKind: "result",
    });
  }
  clearTrainingSessionV5Heartbeat(targetState);
  clearTrainingSessionV5MatchTimer(targetState);
  clearTrainingSessionV5InspectTimer(targetState);
  clearTrainingSessionV5ReconnectTimer(targetState);
  targetState.trainingAttemptUnsubscribe?.();
  targetState.trainingAttemptUnsubscribe = null;
  targetState.trainingAttemptRecoveryCount = 0;
  releaseTrainingTabOwnership();
  sessionStorage.removeItem(TRAINING_V5_RUN_STORAGE_KEY);
  return true;
}

async function finishTrainingSessionV5TerminalLocally(
  targetState,
  attempt,
) {
  void releaseTrainingProtectedRtdbTransport(
    targetState,
    { transportEpoch: targetState.transportEpoch },
  );
  if (targetState.roomId) {
    const resolution = await recoverTrainingResultAfterTerminal(
      targetState.roomId,
    ).catch(() => "live");
    if (resolution === "result") {
      return finishTrainingSessionV5ResultOwnership(targetState, attempt);
    }
  }
  targetState.trainingAttemptState = "terminal";
  applyTrainingSessionV5Transition(targetState, "TERMINATE", {
    terminalKind: "cancelled",
  });
  await stopTrainingSessionV5LocalTransport(targetState);
  await cleanupPublicPresence(targetState).catch(() => {});
  releaseTrainingTabOwnership();
  sessionStorage.removeItem(TRAINING_V5_RUN_STORAGE_KEY);
  targetState.errorMessage = ["room-destroyed", "room_destroyed"].includes(attempt.reason)
    ? "対戦ルームの終了を確認しました。"
    : attempt.reason === "opponent-cancelled"
      ? "相手が鍛え合い60を終了しました。"
      : "鍛え合い60の参加は終了しています。";
  targetState.screen = "error";
  render();
  return true;
}

async function applyTrainingSessionV5Attempt(
  payload,
  targetState = state,
) {
  if (!trainingSessionV5ContextIsCurrent(targetState)) return false;
  const attempt = trainingSessionV5AttemptView(payload);
  const previousRoomId = targetState.roomId;
  const previousRoomAttemptId = targetState.roomAttemptId;
  const previousTransportEpoch = targetState.transportEpoch;
  if (attempt.outcome === "owner-replaced"
      || payload?.reason === "owner-replaced") {
    await handleTrainingSessionV5OwnerReplaced(targetState);
    return false;
  }
  if (attempt.outcome === "not-started") {
    if (!targetState.roomId && !targetState.pendingRoomId) {
      targetState.trainingOwnerEpoch = "";
      targetState.sessionLeaseHeld = false;
    }
    enterTrainingSessionV5Recovery(targetState, "attempt-not-started");
    return false;
  }
  if (attempt.runId && (
    attempt.runId !== targetState.trainingRunId
    || attempt.endpointId !== targetState.trainingEndpointId
  )) {
    if (targetState.trainingOwnerEpoch) {
      await handleTrainingSessionV5OwnerReplaced(targetState);
    }
    return false;
  }
  if (attempt.outcome === "terminal"
      && !trainingSessionV5TokenIsValid(attempt.ownerEpoch)) {
    enterTrainingSessionV5Recovery(targetState, "terminal-response-unfenced");
    return false;
  }
  if (!trainingSessionV5TokenIsValid(attempt.ownerEpoch)
      || !["waiting", "reserved", "active", "terminal"].includes(
        attempt.state,
      )) return false;
  if (!Number.isSafeInteger(attempt.revision) || attempt.revision < 1) {
    enterTrainingSessionV5Recovery(targetState, "attempt-revision-invalid");
    return false;
  }
  if (attempt.revision < targetState.trainingAttemptRevision) return false;
  if (attempt.revision === targetState.trainingAttemptRevision
      && targetState.trainingAttempt
      && !trainingSessionV5AttemptRevisionMatches(
        targetState.trainingAttempt,
        attempt,
      )) {
    enterTrainingSessionV5Recovery(targetState, "attempt-revision-conflict");
    return false;
  }
  if (targetState.trainingOwnerEpoch
      && targetState.trainingOwnerEpoch !== attempt.ownerEpoch) {
    await handleTrainingSessionV5OwnerReplaced(targetState);
    return false;
  }
  const effectivePhase = targetState.sessionV5.phase === "recovering"
    ? targetState.sessionV5.resumePhase
    : targetState.sessionV5.phase;
  if (attempt.state === "waiting" && effectivePhase === "active") {
    enterTrainingSessionV5Recovery(targetState, "active-state-regression");
    return false;
  }
  targetState.trainingOwnerEpoch = attempt.ownerEpoch;
  targetState.trainingAttemptRevision = attempt.revision;
  targetState.trainingAttemptState = attempt.state;
  targetState.trainingAttempt = attempt;
  targetState.sessionLeaseHeld = true;
  syncTrainingSessionV5Machine(targetState, attempt);
  targetState.trainingAttemptRecoveryCount = 0;
  clearTrainingSessionV5InspectTimer(targetState);
  scheduleTrainingSessionV5Heartbeat(targetState);
  if (attempt.state === "terminal") {
    if (targetState.outcome) {
      return finishTrainingSessionV5ResultOwnership(targetState, attempt);
    }
    return finishTrainingSessionV5TerminalLocally(targetState, attempt);
  }
  if (attempt.state === "waiting") {
    targetState.trainingRunRestored = false;
    targetState.pendingRoomId = "";
    targetState.roomAttemptId = "";
    targetState.transportEpoch = "";
    targetState.opponentRunId = "";
    targetState.opponentEndpointId = "";
    targetState.opponentOwnerEpoch = "";
    if (!targetState.roomId) targetState.room = emptyRoom();
    targetState.screen = "matching";
    setTrainingChrome("鍛え合い MATCHING");
    render();
    scheduleTrainingSessionV5Match(targetState, 0);
    return true;
  }
  if (!trainingSessionV5TokenIsValid(attempt.roomId)
      || !trainingSessionV5TokenIsValid(attempt.roomAttemptId)
      || !trainingSessionV5TokenIsValid(attempt.transportEpoch)) {
    enterTrainingSessionV5Recovery(targetState, "room-fence-missing");
    return false;
  }
  if (attempt.state === "active"
      && targetState.roomId === attempt.roomId
      && targetState.roomAttemptId === attempt.roomAttemptId
      && targetState.transportEpoch === attempt.transportEpoch
      && targetState.room.roomAttemptId === attempt.roomAttemptId
      && targetState.room.transportEpoch === attempt.transportEpoch) {
    targetState.pendingRoomId = "";
    const expectedTransport = {
      roomId: attempt.roomId,
      roomAttemptId: attempt.roomAttemptId,
      transportEpoch: attempt.transportEpoch,
    };
    if (targetState.trainingTransportRefreshPromise
        && targetState.trainingTransportRefreshEpoch
          === attempt.transportEpoch) {
      return await targetState.trainingTransportRefreshPromise;
    }
    if (trainingSessionV5TransportIsReady(targetState, expectedTransport)) {
      return true;
    }
    return await refreshTrainingSessionV5Transport(
      targetState,
      expectedTransport,
    );
  }
  targetState.pendingRoomId = attempt.roomId;
  targetState.roomAttemptId = attempt.roomAttemptId;
  targetState.transportEpoch = attempt.transportEpoch;
  const sameRoomAttempt = previousRoomId === attempt.roomId
    && previousRoomAttemptId === attempt.roomAttemptId;
  targetState.screen = sameRoomAttempt ? "room" : "forming";
  render();
  if (attempt.state === "reserved") {
    scheduleTrainingSessionV5Match(targetState, 0);
    return true;
  }
  return await prepareTrainingSessionV5Room(attempt, targetState, {
    previousTransportEpoch,
  });
}

function watchTrainingSessionV5Attempt(targetState = state) {
  targetState.trainingAttemptUnsubscribe?.();
  const watchFence = createTrainingSessionV5RequestFence(targetState);
  targetState.trainingAttemptUnsubscribe = onValue(
    ref(database, trainingSessionV5AttemptPath(targetState.uid)),
    (snapshot) => {
      if (!trainingSessionV5RequestFenceIsCurrent(
        targetState,
        watchFence,
      )) return;
      const attempt = snapshot.val();
      if (!attempt) return;
      applyTrainingSessionV5Attempt(attempt, targetState).catch(
        handleRecoverableError,
      );
    },
    () => enterTrainingSessionV5Recovery(targetState, "attempt-watch-failed"),
  );
}

function trainingSessionV5Preparation(targetState = state) {
  return {
    name: targetState.name,
    intensity: targetState.intensity,
    conditions: targetState.conditions,
    commandDeck: commandDeckPayload(targetState.commandDeck),
    imageBpms: imageBpmsPayload(targetState.localImages),
    chatFrameId: validOwnedTrainingChatFrameId(
      targetState.selectedChatFrameId,
      targetState,
    ),
  };
}

function restoreTrainingSessionV5ImageBpms(room, targetState = state) {
  const canonicalBpms = room.players?.[targetState.uid]?.imageBpms;
  const bpms = Array.from(
    { length: TRAINING_IMAGE_COUNT },
    (_, index) => normalizeImageBpm(canonicalBpms?.[index + 1]),
  );
  if (bpms.some((bpm) => bpm < 0)
      || targetState.localImages.some((image) => !image?.blob)) {
    throw new Error("中断前の画像デッキ設定を確認できませんでした。");
  }
  targetState.localImages.forEach((image, index) => {
    image.bpm = bpms[index];
  });
  targetState.trainingRunRestored = false;
  showToast("中断した対戦を、選び直した5枚で再開します。BPMは対戦開始時の設定に合わせました。");
}

async function startTrainingSessionV5(targetState = state) {
  if (!trainingSessionV5ContextIsCurrent(targetState)) return false;
  const requestFence = createTrainingSessionV5RequestFence(targetState);
  try {
    const response = await trainingSessionActionCallable({
      action: "start",
      runId: requestFence.runId,
      endpointId: requestFence.endpointId,
      preparation: trainingSessionV5Preparation(targetState),
    });
    if (!trainingSessionV5RequestFenceIsCurrent(
      targetState,
      requestFence,
    )) return false;
    const applied = await applyTrainingSessionV5Attempt(
      response?.data || {},
      targetState,
    );
    if (applied
        && targetState.roomId
        && targetState.roomAttemptId
        && targetState.transportEpoch) {
      await set(ref(database, trainingSessionV5PresencePath(
        targetState.roomId,
        targetState.uid,
        targetState.trainingRunId,
      )), createTrainingSessionV5PresencePayload({
        runId: targetState.trainingRunId,
        endpointId: targetState.trainingEndpointId,
        ownerEpoch: targetState.trainingOwnerEpoch,
        roomAttemptId: targetState.roomAttemptId,
        transportEpoch: targetState.transportEpoch,
        online: true,
        updatedAt: firebaseNow(),
      })).catch(() => {});
    }
    return applied;
  } catch {
    if (trainingSessionV5RequestFenceIsCurrent(targetState, requestFence)) {
      enterTrainingSessionV5Recovery(targetState, "start-response-unknown");
    }
    return false;
  }
}

async function heartbeatTrainingSessionV5(targetState = state) {
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || !targetState.trainingOwnerEpoch
      || targetState.trainingAttemptHeartbeatBusy) return false;
  targetState.trainingAttemptHeartbeatBusy = true;
  const requestFence = createTrainingSessionV5RequestFence(targetState);
  try {
    const response = await trainingSessionActionCallable({
      action: "heartbeat",
      runId: requestFence.runId,
      endpointId: requestFence.endpointId,
      ownerEpoch: requestFence.ownerEpoch,
    });
    if (!trainingSessionV5RequestFenceIsCurrent(
      targetState,
      requestFence,
    )) return false;
    const applied = await applyTrainingSessionV5Attempt(
      response?.data || {},
      targetState,
    );
    if (applied
        && targetState.roomId
        && targetState.roomAttemptId
        && targetState.transportEpoch) {
      await set(ref(database, trainingSessionV5PresencePath(
        targetState.roomId,
        targetState.uid,
        targetState.trainingRunId,
      )), createTrainingSessionV5PresencePayload({
        runId: targetState.trainingRunId,
        endpointId: targetState.trainingEndpointId,
        ownerEpoch: targetState.trainingOwnerEpoch,
        roomAttemptId: targetState.roomAttemptId,
        transportEpoch: targetState.transportEpoch,
        online: true,
        updatedAt: firebaseNow(),
      })).catch(() => {});
    }
    return applied;
  } catch {
    if (trainingSessionV5RequestFenceIsCurrent(targetState, requestFence)) {
      enterTrainingSessionV5Recovery(
        targetState,
        "heartbeat-response-unknown",
      );
    }
    return false;
  } finally {
    if (targetState.generation === requestFence.generation) {
      targetState.trainingAttemptHeartbeatBusy = false;
    }
  }
}

async function matchTrainingSessionV5(targetState = state) {
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || !targetState.trainingOwnerEpoch
      || targetState.trainingAttemptMatchBusy) return false;
  targetState.trainingAttemptMatchBusy = true;
  const requestFence = createTrainingSessionV5RequestFence(targetState);
  try {
    const response = await trainingSessionActionCallable({
      action: "match",
      runId: requestFence.runId,
      endpointId: requestFence.endpointId,
      ownerEpoch: requestFence.ownerEpoch,
    });
    if (!trainingSessionV5RequestFenceIsCurrent(
      targetState,
      requestFence,
    )) return false;
    return await applyTrainingSessionV5Attempt(
      response?.data || {},
      targetState,
    );
  } catch {
    if (trainingSessionV5RequestFenceIsCurrent(targetState, requestFence)) {
      enterTrainingSessionV5Recovery(targetState, "match-response-unknown");
    }
    return false;
  } finally {
    if (targetState.generation === requestFence.generation) {
      targetState.trainingAttemptMatchBusy = false;
    }
    if (trainingSessionV5RequestFenceIsCurrent(targetState, requestFence)
        && targetState.trainingAttemptState === "waiting") {
      scheduleTrainingSessionV5Match(targetState);
    }
  }
}

async function inspectTrainingSessionV5(
  targetState = state,
  { immediate = false } = {},
) {
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || targetState.trainingAttemptInspectBusy) return false;
  clearTrainingSessionV5InspectTimer(targetState);
  if (!navigator.onLine) {
    scheduleTrainingSessionV5Inspect(targetState);
    return false;
  }
  if (!targetState.trainingOwnerEpoch) {
    return startTrainingSessionV5(targetState);
  }
  targetState.trainingAttemptInspectBusy = true;
  const requestFence = createTrainingSessionV5RequestFence(targetState);
  try {
    const response = await trainingSessionActionCallable({
      action: "inspect",
      runId: requestFence.runId,
      endpointId: requestFence.endpointId,
      ownerEpoch: requestFence.ownerEpoch,
    });
    if (!trainingSessionV5RequestFenceIsCurrent(
      targetState,
      requestFence,
    )) return false;
    return await applyTrainingSessionV5Attempt(
      response?.data || {},
      targetState,
    );
  } catch {
    if (trainingSessionV5RequestFenceIsCurrent(targetState, requestFence)) {
      enterTrainingSessionV5Recovery(
        targetState,
        immediate ? "resume-response-unknown" : "inspect-response-unknown",
      );
    }
    return false;
  } finally {
    if (targetState.generation === requestFence.generation) {
      targetState.trainingAttemptInspectBusy = false;
    }
  }
}

function trainingSessionV5ActiveRoomFenceIsCurrent(
  targetState,
  expected = {},
) {
  return trainingSessionV5ContextIsCurrent(targetState)
    && targetState.trainingAttemptState === "active"
    && targetState.roomId === expected.roomId
    && targetState.roomAttemptId === expected.roomAttemptId
    && targetState.transportEpoch === expected.transportEpoch
    && targetState.room.roomAttemptId === expected.roomAttemptId
    && targetState.room.transportEpoch === expected.transportEpoch
    && !targetState.room.destroyed
    && !targetState.outcome;
}

function beginTrainingTransportRefresh(targetState, transportEpoch) {
  const ticket = Object.freeze({
    sequence: targetState.trainingTransportRefreshSequence + 1,
    transportEpoch,
  });
  targetState.trainingTransportRefreshSequence = ticket.sequence;
  targetState.trainingTransportReadyEpoch = "";
  return ticket;
}

function trainingTransportRefreshIsLatest(targetState, ticket) {
  return targetState.trainingTransportRefreshSequence === ticket.sequence
    && targetState.transportEpoch === ticket.transportEpoch;
}

function commitTrainingTransportRefresh(targetState, ticket) {
  if (!trainingTransportRefreshIsLatest(targetState, ticket)) return false;
  targetState.trainingTransportReadyEpoch = ticket.transportEpoch;
  return true;
}

function invalidateTrainingTransportRefreshes(targetState) {
  targetState.trainingTransportRefreshSequence += 1;
  targetState.trainingTransportReadyEpoch = "";
}

async function runTrainingTransportRefreshSteps(steps) {
  const isLatest = steps.isLatest;
  const detach = steps.detach;
  const resetPeer = steps.resetPeer;
  const clearSignals = steps.clearSignals;
  const setupRoom = steps.setupRoom;
  const setupPeer = steps.setupPeer;
  const commit = steps.commit;
  if (!isLatest()) return false;
  await detach();
  if (!isLatest()) return false;
  await resetPeer();
  if (!isLatest()) return false;
  await clearSignals();
  if (!isLatest()) return false;
  const roomReady = await setupRoom();
  if (!roomReady || !isLatest()) return false;
  const peerReady = await setupPeer();
  if (!peerReady || !isLatest()) return false;
  return commit();
}

function trainingSessionV5TransportIsReady(targetState, expected = {}) {
  return trainingSessionV5ActiveRoomFenceIsCurrent(targetState, expected)
    && targetState.trainingTransportReadyEpoch === expected.transportEpoch
    && Boolean(targetState.peer)
    && Boolean(targetState.trainingSignalUnsubscribe)
    && targetState.roomUnsubscribers.length > 0
    && targetState.disconnectHandles.length > 0;
}

async function refreshTrainingSessionV5Transport(
  targetState,
  expected,
) {
  const refreshTicket = beginTrainingTransportRefresh(
    targetState,
    expected.transportEpoch,
  );
  const refreshIsCurrent = () => (
    trainingTransportRefreshIsLatest(targetState, refreshTicket)
    && trainingSessionV5ActiveRoomFenceIsCurrent(targetState, expected)
  );
  const previousRefresh = targetState.trainingTransportRefreshPromise;
  const refresh = Promise.resolve(previousRefresh)
    .catch(() => false)
    .then(async () => {
      clearTrainingSessionV5ReconnectTimer(targetState);
      clearTrainingP2pRecoveryTimer(targetState);
      clearImageExchangeWatchdog();
      let roomContext = null;
      return runTrainingTransportRefreshSteps({
        isLatest: refreshIsCurrent,
        detach: () => detachTrainingSessionV5RtdbTransport(
          targetState,
          { transportEpoch: expected.transportEpoch },
        ),
        resetPeer: () => {
          rearmTrainingImageTransferForReplacement(targetState);
          const previousChannel = targetState.channel;
          const previousPeer = targetState.peer;
          targetState.channel = null;
          targetState.peer = null;
          previousChannel?.close();
          previousPeer?.close();
          targetState.pendingIce = [];
          targetState.p2pRestartIce = null;
          targetState.p2pRecovery = null;
          targetState.p2pGenerationToken = null;
          targetState.incomingImage = null;
          targetState.incomingMessageChain = Promise.resolve();
        },
        clearSignals: () => remove(ref(
          database,
          `online/trainingRooms/${expected.roomId}/signalsV5/${
            targetState.uid
          }/${targetState.trainingRunId}`,
        )).catch(() => {}),
        setupRoom: async () => {
          targetState.roomSyncing = true;
          render();
          roomContext = createTrainingRoomRuntimeContext(expected.roomId);
          const roomReady = await setupRoomListeners(roomContext);
          if (!roomReady
              || !trainingRoomRuntimeContextIsCurrent(roomContext)) {
            return false;
          }
          targetState.roomSyncing = false;
          reactToRoomData();
          startImageExchangeWatchdog();
          return true;
        },
        setupPeer: () => setupPeerConnection(),
        commit: () => (
          commitTrainingTransportRefresh(targetState, refreshTicket)
          && trainingSessionV5TransportIsReady(targetState, expected)
        ),
      });
    });
  targetState.trainingTransportRefreshPromise = refresh;
  targetState.trainingTransportRefreshEpoch = expected.transportEpoch;
  try {
    return await refresh;
  } finally {
    if (targetState.trainingTransportRefreshPromise === refresh) {
      targetState.trainingTransportRefreshPromise = null;
      targetState.trainingTransportRefreshEpoch = "";
    }
  }
}

function scheduleTrainingSessionV5Reconnect(
  targetState = state,
  delayMs = TRAINING_V5_MATCH_RETRY_MS,
) {
  clearTrainingSessionV5ReconnectTimer(targetState);
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || targetState.trainingAttemptState !== "active"
      || !targetState.roomId
      || !targetState.roomAttemptId
      || !targetState.transportEpoch
      || targetState.room.destroyed
      || targetState.outcome) return;
  targetState.trainingReconnectTimer = window.setTimeout(() => {
    targetState.trainingReconnectTimer = null;
    requestTrainingSessionV5Reconnect(targetState).catch(() => {});
  }, Math.max(500, delayMs));
}

async function requestTrainingSessionV5Reconnect(targetState = state) {
  if (targetState.trainingReconnectPromise) {
    return targetState.trainingReconnectPromise;
  }
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || targetState.trainingAttemptState !== "active"
      || !targetState.trainingOwnerEpoch
      || !targetState.roomId
      || !targetState.roomAttemptId
      || !targetState.transportEpoch
      || targetState.room.destroyed
      || targetState.outcome) return false;
  const previousTransportEpoch = targetState.transportEpoch;
  const requestFence = Object.freeze({
    ...createTrainingSessionV5RequestFence(targetState),
    roomId: targetState.roomId,
    roomAttemptId: targetState.roomAttemptId,
    transportEpoch: previousTransportEpoch,
  });
  clearTrainingSessionV5ReconnectTimer(targetState);
  enterTrainingSessionV5Recovery(targetState, "transport-reconnecting");
  const reconnect = (async () => {
    let response = null;
    try {
      response = await trainingSessionActionCallable({
        action: "reconnect",
        runId: requestFence.runId,
        endpointId: requestFence.endpointId,
        ownerEpoch: requestFence.ownerEpoch,
        roomAttemptId: requestFence.roomAttemptId,
        transportEpoch: requestFence.transportEpoch,
      });
    } catch {
      response = null;
    }
    if (!trainingSessionV5RequestFenceIsCurrent(
      targetState,
      requestFence,
    )) return false;
    if (response) {
      await applyTrainingSessionV5Attempt(response.data || {}, targetState);
    } else {
      await inspectTrainingSessionV5(targetState, { immediate: true });
    }
    if (!trainingSessionV5RequestFenceIsCurrent(targetState, requestFence)
        || targetState.trainingAttemptState !== "active"
        || targetState.roomId !== requestFence.roomId
        || targetState.roomAttemptId !== requestFence.roomAttemptId
        || targetState.room.destroyed
        || targetState.outcome) return false;
    if (targetState.transportEpoch !== previousTransportEpoch) {
      return true;
    }
    enterTrainingSessionV5Recovery(targetState, "reconnect-response-unknown");
    scheduleTrainingSessionV5Reconnect(
      targetState,
      Math.min(
        TRAINING_V5_RECOVERY_MAX_MS,
        TRAINING_V5_MATCH_RETRY_MS
          * (2 ** Math.min(3, targetState.trainingAttemptRecoveryCount)),
      ),
    );
    return false;
  })();
  targetState.trainingReconnectPromise = reconnect;
  try {
    return await reconnect;
  } finally {
    if (targetState.trainingReconnectPromise === reconnect) {
      targetState.trainingReconnectPromise = null;
    }
  }
}

async function prepareTrainingSessionV5Room(
  attempt,
  targetState = state,
  { previousTransportEpoch = "" } = {},
) {
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || attempt.state !== "active") return false;
  const requestFence = createTrainingSessionV5RequestFence(targetState);
  const attemptIsCurrent = () => (
    trainingSessionV5RequestFenceIsCurrent(targetState, requestFence)
    && targetState.trainingAttemptState === "active"
    && targetState.trainingAttempt?.roomId === attempt.roomId
    && targetState.trainingAttempt?.roomAttemptId === attempt.roomAttemptId
    && targetState.trainingAttempt?.transportEpoch === attempt.transportEpoch
  );
  if (targetState.roomId === attempt.roomId
      && targetState.roomAttemptId === attempt.roomAttemptId
      && targetState.transportEpoch === attempt.transportEpoch
      && targetState.room.roomAttemptId === attempt.roomAttemptId
      && targetState.room.transportEpoch === attempt.transportEpoch) {
    return targetState.trainingTransportRefreshPromise || true;
  }
  try {
    const room = await readTrainingSessionV5ConvergedRoom(
      attempt,
      targetState,
      attemptIsCurrent,
    );
    if (!room || !attemptIsCurrent()) return false;
    const ownSession = room.sessions?.[targetState.uid];
    const valid = room.status === "active"
      && room.protocolVersion === TRAINING_PROTOCOL_VERSION
      && room.variant === TRAINING_VARIANT
      && room.sessionProtocolVersion === TRAINING_SESSION_V5_PROTOCOL_VERSION
      && room.signalingVersion === TRAINING_SESSION_V5_SIGNALING_VERSION
      && room.roomAttemptId === attempt.roomAttemptId
      && room.transportEpoch === attempt.transportEpoch
      && room.members?.[targetState.uid] === true
      && [room.hostUid, room.guestUid].includes(targetState.uid)
      && room.hostUid !== room.guestUid
      && ownSession?.runId === targetState.trainingRunId
      && ownSession?.endpointId === targetState.trainingEndpointId
      && ownSession?.ownerEpoch === targetState.trainingOwnerEpoch;
    if (!valid) {
      throw new Error("現在の鍛え合いセッションに一致する対戦ルームを確認できませんでした。");
    }
    const opponentUid = room.hostUid === targetState.uid
      ? room.guestUid
      : room.hostUid;
    const opponentSession = room.sessions?.[opponentUid] || {};
    if (!trainingSessionV5TokenIsValid(opponentSession.runId)
        || !trainingSessionV5TokenIsValid(opponentSession.endpointId)
        || !trainingSessionV5TokenIsValid(opponentSession.ownerEpoch)) {
      throw new Error("鍛え合う相手の接続識別子を確認できませんでした。");
    }
    if (targetState.trainingRunRestored) {
      restoreTrainingSessionV5ImageBpms(room, targetState);
    }
    targetState.opponentRunId = opponentSession.runId;
    targetState.opponentEndpointId = opponentSession.endpointId;
    targetState.opponentOwnerEpoch = opponentSession.ownerEpoch;
    targetState.roomAttemptId = room.roomAttemptId;
    targetState.transportEpoch = room.transportEpoch;
    targetState.pendingRoomId = attempt.roomId;
    const existingRefresh = targetState.trainingTransportRefreshPromise;
    const existingRefreshEpoch = targetState.trainingTransportRefreshEpoch;
    const replacingTransport = targetState.roomId === attempt.roomId;
    const localRoomAlreadyCurrent = targetState.room.roomAttemptId
        === room.roomAttemptId
      && targetState.room.transportEpoch === room.transportEpoch;
    const roomBase = replacingTransport && previousTransportEpoch
      ? targetState.room
      : emptyRoom();
    targetState.room = { ...roomBase, ...room };
    targetState.screen = replacingTransport ? "room" : "forming";
    render();
    if (replacingTransport) {
      targetState.pendingRoomId = "";
      if (existingRefresh && existingRefreshEpoch === room.transportEpoch) {
        return await existingRefresh;
      }
      if (localRoomAlreadyCurrent && trainingSessionV5TransportIsReady(
        targetState,
        {
          roomId: attempt.roomId,
          roomAttemptId: room.roomAttemptId,
          transportEpoch: room.transportEpoch,
        },
      )) return true;
      return await refreshTrainingSessionV5Transport(targetState, {
        roomId: attempt.roomId,
        roomAttemptId: room.roomAttemptId,
        transportEpoch: room.transportEpoch,
      });
    }
    return await enterRoom(attempt.roomId);
  } catch (error) {
    if (!attemptIsCurrent()) return false;
    enterTrainingSessionV5Recovery(
      targetState,
      trainingPermissionWasRevoked(error)
        ? "room-epoch-converging"
        : "room-read-unknown",
    );
    if (targetState.roomId === attempt.roomId) {
      if (!trainingPermissionWasRevoked(error)) handleRecoverableError(error);
      scheduleTrainingSessionV5Inspect(targetState);
    } else {
      scheduleEnterRoomRetry(
        attempt.roomId,
        trainingPermissionWasRevoked(error) ? null : error,
      );
    }
    return false;
  }
}

async function beginMatchmaking() {
  const expectedState = state;
  const expectedGeneration = expectedState.generation;
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
  const contextIsCurrent = () => (
    active
    && state === expectedState
    && expectedState.generation === expectedGeneration
    && !expectedState.trainingSessionCancelling
  );
  expectedState.startingMatchmaking = true;
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
    clearTrainingSessionV5Heartbeat(expectedState);
    clearTrainingSessionV5MatchTimer(expectedState);
    clearTrainingSessionV5InspectTimer(expectedState);
    clearTrainingSessionV5ReconnectTimer(expectedState);
    expectedState.trainingAttemptHeartbeatBusy = false;
    expectedState.trainingAttemptMatchBusy = false;
    expectedState.trainingAttemptInspectBusy = false;
    expectedState.trainingAttemptRecoveryCount = 0;
    expectedState.trainingReconnectPromise = null;
    expectedState.trainingTransportRefreshPromise = null;
    expectedState.trainingTransportRefreshEpoch = "";
    const restoredRunId = resolveTrainingSessionV5RunId();
    expectedState.trainingRunId = restoredRunId
      || createTrainingSessionV5Token();
    expectedState.trainingRunRestored = Boolean(restoredRunId);
    sessionStorage.setItem(
      TRAINING_V5_RUN_STORAGE_KEY,
      expectedState.trainingRunId,
    );
    expectedState.trainingOwnerEpoch = "";
    expectedState.trainingOwnerSuperseded = false;
    expectedState.trainingAttemptRevision = 0;
    expectedState.trainingAttemptState = "";
    expectedState.trainingAttempt = null;
    expectedState.sessionV5 = createTrainingSessionV5State({
      revision: expectedState.sessionV5.revision,
    });
    applyTrainingSessionV5Transition(expectedState, "BEGIN", {
      runId: expectedState.trainingRunId,
    });
    localStorage.setItem(PROFILE_NAME_KEY, expectedState.name);
    expectedState.screen = "matching";
    setTrainingChrome("鍛え合い MATCHING");
    render();
    watchTrainingSessionV5Attempt(expectedState);
    // Public lobby presence is observational; a counter update must never
    // prevent the private server-owned matcher from starting.
    startPublicPresence(expectedState).catch((error) => {
      if (contextIsCurrent()) handleRecoverableError(error);
    });
    await startTrainingSessionV5(expectedState);
  } catch (error) {
    if (!contextIsCurrent()) return;
    if (!expectedState.trainingOwnerEpoch) releaseTrainingTabOwnership();
    throw error;
  } finally {
    if (expectedState.generation === expectedGeneration) {
      expectedState.startingMatchmaking = false;
    }
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
  }, PUBLIC_PRESENCE_HEARTBEAT_MS);
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

async function readRoomSkeleton(roomId) {
  const base = `online/trainingRooms/${roomId}`;
  const keys = [
    "protocolVersion", "variant", "sessionProtocolVersion", "signalingVersion",
    "roomAttemptId", "transportEpoch", "sessions", "hostUid", "guestUid",
    "createdAt", "status", "members", "players", "chatFrames", "accepted",
  ];
  const snapshots = await Promise.all(keys.map((key) => get(ref(database, `${base}/${key}`))));
  return Object.fromEntries(keys.map((key, index) => [key, snapshots[index].val()]));
}

async function readTrainingSessionV5ConvergedRoom(
  attempt,
  targetState,
  attemptIsCurrent,
) {
  let lastError = null;
  for (const delayMs of TRAINING_V5_ROOM_CONVERGENCE_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    if (!attemptIsCurrent()) return null;
    try {
      const room = await readRoomSkeleton(attempt.roomId);
      if (!attemptIsCurrent()) return null;
      if (room.roomAttemptId === attempt.roomAttemptId
          && room.transportEpoch === attempt.transportEpoch) {
        return room;
      }
      lastError = new Error(
        "対戦ルームの通信世代が揃うまで待機しています。",
      );
    } catch (error) {
      if (!attemptIsCurrent()) return null;
      lastError = error;
    }
  }
  throw lastError || new Error(
    "対戦ルームの通信世代を確認できませんでした。",
  );
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

async function recoverTrainingResultAfterTerminal(roomId) {
  const snapshot = await get(ref(
    database,
    `online/trainingRooms/${roomId}/serverFinalized`,
  ));
  if (!active || state.roomId !== roomId) return "stale";
  const serverFinalized = snapshot.val() || null;
  const fallbackView = deriveTrainingRoomState(
    { ...state.room, destroyed: null },
    state.uid,
    firebaseNow(),
  );
  const finalizedView = viewFromServerFinalized(
    serverFinalized,
    fallbackView,
  );
  if (!finalizedView) return "live";
  state.room.serverFinalized = serverFinalized;
  transitionToTrainingResult(finalizedView);
  return "result";
}

function transitionToTrainingResult(view) {
  clearImageExchangeWatchdog();
  clearScorePoll();
  state.currentView = view;
  state.outcome = view;
  state.trainingResultRtdbRelease ||= releaseTrainingProtectedRtdbTransport(
    state,
    { transportEpoch: state.transportEpoch },
  );
  state.screen = "result";
  state.ambienceController.disable();
  render();
  ensureFinalization();
}

function transitionToDestroyedRoom() {
  clearImageExchangeWatchdog();
  clearScorePoll();
  state.channel?.close();
  state.peer?.close();
  state.channel = null;
  state.peer = null;
  state.ambienceController.disable();
  state.screen = "cancelled";
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

async function enterRoom(roomId) {
  const expectedState = state;
  const requestFence = createTrainingSessionV5RequestFence(expectedState);
  const expectedRoomAttemptId = expectedState.roomAttemptId;
  const expectedTransportEpoch = expectedState.transportEpoch;
  const contextIsCurrent = () => (
    trainingSessionV5RequestFenceIsCurrent(expectedState, requestFence)
    && ["", roomId].includes(expectedState.roomId)
    && expectedState.roomAttemptId === expectedRoomAttemptId
    && expectedState.transportEpoch === expectedTransportEpoch
  );
  if (expectedState.roomId || expectedState.enteringRoom) return;
  expectedState.enteringRoom = true;
  let roomAssigned = false;
  try {
    const room = await readRoomSkeleton(roomId);
    if (!contextIsCurrent()) return;
    const ownSession = room.sessions?.[state.uid] || {};
    if (room.status !== "active"
      || room.protocolVersion !== TRAINING_PROTOCOL_VERSION
      || room.variant !== TRAINING_VARIANT
      || room.sessionProtocolVersion !== TRAINING_SESSION_V5_PROTOCOL_VERSION
      || room.signalingVersion !== TRAINING_SESSION_V5_SIGNALING_VERSION
      || room.roomAttemptId !== state.roomAttemptId
      || room.transportEpoch !== state.transportEpoch
      || ownSession.runId !== state.trainingRunId
      || ownSession.endpointId !== state.trainingEndpointId
      || ownSession.ownerEpoch !== state.trainingOwnerEpoch
      || room.members?.[state.uid] !== true
      || ![room.hostUid, room.guestUid].includes(state.uid)
      || room.hostUid === room.guestUid) {
      throw new Error("鍛え合い60の部屋へ参加できませんでした。");
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
    window.clearTimeout(state.enterRoomRetryTimer);
    state.enterRoomRetryTimer = null;
    state.enterRoomRetryAttempts = 0;
    state.pendingRoomId = "";
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
    const peerReady = await setupPeerConnection();
    if (peerReady && contextIsCurrent() && state.roomId === roomId) {
      state.trainingTransportReadyEpoch = expectedTransportEpoch;
    }
  } catch (error) {
    if (!contextIsCurrent()) return;
    state.roomSyncing = false;
    if (!roomAssigned || state.roomId !== roomId) {
      scheduleEnterRoomRetry(roomId, error);
      return;
    }
    clearImageExchangeWatchdog();
    state.channel?.close();
    state.peer?.close();
    state.channel = null;
    state.peer = null;
    state.roomUnsubscribers.splice(0)
      .forEach((unsubscribe) => unsubscribe?.());
    await releaseTrainingDisconnectHandles(
      state,
      { transportEpoch: state.transportEpoch },
    );
    state.roomId = "";
    state.pendingRoomId = roomId;
    state.ambienceController.disable();
    enterTrainingSessionV5Recovery(state, "room-setup-unknown");
    handleRecoverableError(error);
    scheduleEnterRoomRetry(roomId, error);
  } finally {
    if (expectedState.generation === requestFence.generation) {
      expectedState.enteringRoom = false;
    }
  }
}

function scheduleEnterRoomRetry(roomId, error) {
  if (!active
      || state.trainingOwnerSuperseded
      || ![state.pendingRoomId, state.roomId].includes(roomId)) return;
  if (error) handleRecoverableError(error);
  state.enterRoomRetryAttempts += 1;
  window.clearTimeout(state.enterRoomRetryTimer);
  const delay = Math.min(
    TRAINING_V5_RECOVERY_MAX_MS,
    500 * (2 ** Math.min(4, state.enterRoomRetryAttempts - 1)),
  );
  state.enterRoomRetryTimer = window.setTimeout(() => {
    state.enterRoomRetryTimer = null;
    inspectTrainingSessionV5(state, { immediate: true }).catch(() => {});
    if (!state.roomId) {
      prepareTrainingSessionV5Room(state.trainingAttempt, state).catch(() => {});
    } else if (!state.peer) {
      requestTrainingSessionV5Reconnect(state).catch(() => {});
    }
  }, delay);
}

function createTrainingRoomRuntimeContext(roomId = state.roomId) {
  const opponentUid = state.room.hostUid === state.uid
    ? state.room.guestUid
    : state.room.hostUid;
  const opponentSession = state.room.sessions?.[opponentUid] || {};
  return Object.freeze({
    expectedState: state,
    generation: state.generation,
    roomId,
    uid: state.uid,
    runId: state.trainingRunId,
    endpointId: state.trainingEndpointId,
    ownerEpoch: state.trainingOwnerEpoch,
    opponentUid,
    opponentRunId: opponentSession.runId || state.opponentRunId,
    opponentEndpointId: opponentSession.endpointId || state.opponentEndpointId,
    opponentOwnerEpoch: opponentSession.ownerEpoch || state.opponentOwnerEpoch,
    roomAttemptId: state.roomAttemptId,
    transportEpoch: state.transportEpoch,
  });
}

function trainingRoomRuntimeContextIsCurrent(context) {
  return Boolean(context)
    && active
    && state === context.expectedState
    && state.generation === context.generation
    && !state.trainingSessionCancelling
    && state.roomId === context.roomId
    && state.uid === context.uid
    && state.sessionLeaseHeld
    && !state.trainingOwnerSuperseded
    && state.trainingRunId === context.runId
    && state.trainingEndpointId === context.endpointId
    && state.trainingOwnerEpoch === context.ownerEpoch
    && state.opponentRunId === context.opponentRunId
    && state.opponentEndpointId === context.opponentEndpointId
    && state.opponentOwnerEpoch === context.opponentOwnerEpoch
    && state.roomAttemptId === context.roomAttemptId
    && state.transportEpoch === context.transportEpoch
    && state.room.sessionProtocolVersion === TRAINING_SESSION_V5_PROTOCOL_VERSION
    && state.room.signalingVersion === TRAINING_SESSION_V5_SIGNALING_VERSION
    && state.room.roomAttemptId === context.roomAttemptId
    && state.room.transportEpoch === context.transportEpoch;
}

async function setupRoomListeners(
  context = createTrainingRoomRuntimeContext(state.roomId),
) {
  const roomId = context.roomId;
  const contextIsCurrent = () => trainingRoomRuntimeContextIsCurrent(context);
  const handleContextError = (error) => {
    handleTrainingRtdbListenerError(error, contextIsCurrent, state);
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
  const ownPresenceRef = ref(database, trainingSessionV5PresencePath(
    roomId,
    context.uid,
    context.runId,
  ));
  const ownPresence = (online, useServerTimestamp = false) => {
    const updatedAt = useServerTimestamp ? serverTimestamp() : firebaseNow();
    const payload = createTrainingSessionV5PresencePayload({
      runId: context.runId,
      endpointId: context.endpointId,
      ownerEpoch: context.ownerEpoch,
      roomAttemptId: context.roomAttemptId,
      transportEpoch: context.transportEpoch,
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
  state.disconnectHandles.push(createTrainingPresenceDisconnectHandle({
    disconnect: presenceDisconnect,
    presenceRef: ownPresenceRef,
    presencePayload: ownPresence(false),
  }));
  const opponentUid = opponentPlayer()?.uid;
  if (opponentUid) {
    const opponentPresencePath = trainingSessionV5PresencePath(
      roomId,
      opponentUid,
      context.opponentRunId,
    );
    state.roomUnsubscribers.push(onValue(ref(database, opponentPresencePath), (snapshot) => {
      if (!contextIsCurrent()) return;
      const presence = snapshot.val();
      if (presence?.online === true) state.opponentWasOnline = true;
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
  targetState.p2pCleanupPromise = (async () => {
    if (await preserveResolvedTrainingMatchBeforeP2pCleanup(targetState)) return;
    enterTrainingSessionV5Recovery(targetState, "p2p-status-unknown");
    await inspectTrainingSessionV5(targetState, { immediate: true });
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
  targetState.sessionAutoRequeueCount = effect.autoRequeueCount;
  showToast("同じ対戦ルームへの接続を確認し直しています。");
  await requestTrainingSessionV5Reconnect(targetState);
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
    await resetTrainingRoomForAutoRequeue(targetState, {
      ...effect,
      autoRequeueCount: targetState.sessionAutoRequeueCount,
    });
  }
}

function trainingSessionPeerContextIsCurrent(context, peer = state.peer) {
  return active
    && state === context.expectedState
    && state.generation === context.generation
    && !state.trainingSessionCancelling
    && state.roomId === context.roomId
    && state.peer === peer
    && state.sessionLeaseHeld
    && !state.trainingOwnerSuperseded
    && state.trainingRunId === context.ownRunId
    && state.trainingEndpointId === context.ownEndpointId
    && state.trainingOwnerEpoch === context.ownOwnerEpoch
    && state.opponentRunId === context.opponentRunId
    && state.opponentEndpointId === context.opponentEndpointId
    && state.roomAttemptId === context.roomAttemptId
    && state.transportEpoch === context.transportEpoch;
}

async function setupTrainingSessionPeerConnection() {
  if (!("RTCPeerConnection" in window)) {
    throw new Error("このブラウザはP2P画像転送に対応していません。");
  }
  const opponentUid = opponentPlayer()?.uid;
  if (!opponentUid
      || !state.opponentRunId
      || !state.opponentEndpointId
      || !state.opponentOwnerEpoch) {
    throw new Error("鍛え合う相手の接続セッションを確認できませんでした。");
  }
  const context = Object.freeze({
    expectedState: state,
    generation: state.generation,
    roomId: state.roomId,
    ownUid: state.uid,
    opponentUid,
    ownRunId: state.trainingRunId,
    ownEndpointId: state.trainingEndpointId,
    ownOwnerEpoch: state.trainingOwnerEpoch,
    opponentRunId: state.opponentRunId,
    opponentEndpointId: state.opponentEndpointId,
    opponentOwnerEpoch: state.opponentOwnerEpoch,
    roomAttemptId: state.roomAttemptId,
    transportEpoch: state.transportEpoch,
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
  let connectionCycleId = state.room.hostUid === state.uid
    ? createTrainingSessionV5Token()
    : "";
  let connectionCycleStartedAt = 0;
  const pendingIceByCycle = new Map();
  const purgePendingIceCycles = () => {
    const cutoff = firebaseNow() - 60_000;
    for (const [cycleId, entries] of pendingIceByCycle) {
      const fresh = entries.filter((entry) => entry.createdAt >= cutoff);
      if (fresh.length) pendingIceByCycle.set(cycleId, fresh.slice(-128));
      else pendingIceByCycle.delete(cycleId);
    }
    while (pendingIceByCycle.size > 4) {
      pendingIceByCycle.delete(pendingIceByCycle.keys().next().value);
    }
  };
  const queuePendingCandidate = (cycleId, candidate, createdAt) => {
    if (!trainingSessionV5TokenIsValid(cycleId)
        || !Number.isSafeInteger(Number(createdAt))) return false;
    purgePendingIceCycles();
    const entries = pendingIceByCycle.get(cycleId) || [];
    entries.push({ candidate, createdAt: Number(createdAt) });
    pendingIceByCycle.set(cycleId, entries.slice(-128));
    purgePendingIceCycles();
    return true;
  };
  const takePendingCandidates = (cycleId) => {
    purgePendingIceCycles();
    const entries = pendingIceByCycle.get(cycleId) || [];
    pendingIceByCycle.delete(cycleId);
    return entries.map((entry) => entry.candidate);
  };
  const adoptConnectionCycle = (nextCycleId, createdAt) => {
    if (!trainingSessionV5TokenIsValid(nextCycleId)
        || !Number.isSafeInteger(Number(createdAt))
        || (connectionCycleId
          && Number(createdAt) < connectionCycleStartedAt)) return false;
    if (connectionCycleId && connectionCycleId !== nextCycleId) {
      state.pendingIce = [];
    }
    connectionCycleId = nextCycleId;
    connectionCycleStartedAt = Number(createdAt);
    return true;
  };
  const sendRoomSignal = async (type, payload) => {
    if (!contextIsCurrent()
        || !trainingSessionV5TokenIsValid(connectionCycleId)) return;
    const signalId = createTrainingSessionV5Token();
    const envelope = createTrainingSessionV5SignalEnvelope({
      roomAttemptId: context.roomAttemptId,
      transportEpoch: context.transportEpoch,
      fromUid: context.ownUid,
      toUid: context.opponentUid,
      fromRunId: context.ownRunId,
      toRunId: context.opponentRunId,
      fromEndpointId: context.ownEndpointId,
      toEndpointId: context.opponentEndpointId,
      type,
      payload: JSON.stringify({ ...payload, connectionCycleId }),
      createdAt: firebaseNow(),
    });
    await set(ref(database, trainingSessionV5SignalPath(
      context.roomId,
      context.opponentUid,
      context.opponentRunId,
      signalId,
    )), envelope);
  };

  state.p2pGenerationToken = createOnlineP2pGenerationToken({
    matchmakingGeneration: state.trainingRunId,
    roomId: context.roomId,
    sessionId: context.transportEpoch,
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
        .catch((error) => handleTrainingRtdbOperationError(
          error,
          contextIsCurrent,
        ));
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
    ref(
      database,
      `online/trainingRooms/${context.roomId}/signalsV5/${
        context.ownUid
      }/${context.ownRunId}`,
    ),
    (snapshot) => {
      signalChain = signalChain.catch(() => {}).then(async () => {
        if (!contextIsCurrent()) return;
        const signal = snapshot.val();
        const decision = decideTrainingSessionV5Signal({
          envelope: signal,
          ownUid: context.ownUid,
          ownRunId: context.ownRunId,
          ownEndpointId: context.ownEndpointId,
          remoteUid: context.opponentUid,
          remoteRunId: context.opponentRunId,
          remoteEndpointId: context.opponentEndpointId,
          roomAttemptId: context.roomAttemptId,
          transportEpoch: context.transportEpoch,
          now: firebaseNow(),
        });
        if (!decision.accepted) {
          if (contextIsCurrent()) {
            await remove(snapshot.ref).catch(() => {});
          }
          return;
        }
        let handledSuccessfully = false;
        try {
          await handleTrainingSessionSignal(signal, {
            context,
            peer,
            sendRoomSignal,
            getConnectionCycleId: () => connectionCycleId,
            adoptConnectionCycle,
            queuePendingCandidate,
            takePendingCandidates,
          });
          handledSuccessfully = true;
        } catch (error) {
          handleTrainingRtdbOperationError(error, contextIsCurrent);
        }
        if (shouldConsumeTrainingSessionV5Signal(decision, {
          handledSuccessfully,
          contextStillCurrent: contextIsCurrent(),
        })) {
          await remove(snapshot.ref).catch(() => {});
        }
      });
    },
    (error) => handleTrainingRtdbListenerError(
      error,
      contextIsCurrent,
      state,
    ),
  );
  state.trainingSignalUnsubscribe?.();
  state.trainingSignalUnsubscribe = signalUnsubscribe;

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
  getConnectionCycleId,
  adoptConnectionCycle,
  queuePendingCandidate,
  takePendingCandidates,
}) {
  const contextIsCurrent = () => trainingSessionPeerContextIsCurrent(context, peer);
  if (!contextIsCurrent()
      || signal?.fromUid !== context.opponentUid
      || signal?.toUid !== context.ownUid
      || signal?.fromRunId !== context.opponentRunId
      || signal?.toRunId !== context.ownRunId
      || signal?.fromEndpointId !== context.opponentEndpointId
      || signal?.toEndpointId !== context.ownEndpointId
      || signal?.roomAttemptId !== context.roomAttemptId
      || signal?.transportEpoch !== context.transportEpoch
      || typeof signal.payload !== "string"
      || signal.payload.length > 30_000) {
    throw new Error("現在の接続試行と異なるP2P接続情報です。");
  }
  const payload = JSON.parse(signal.payload);
  const receivedCycleId = String(payload?.connectionCycleId || "");
  if (signal.type === "offer") {
    if (state.room.hostUid === context.ownUid
        || !adoptConnectionCycle(receivedCycleId, signal.createdAt)) {
      throw new Error("以前のP2P接続試行から届いたofferです。");
    }
    if (payload?.iceRestart === true) {
      dispatchTrainingP2pRecoveryEvent("RESTART_OFFER_RECEIVED", state);
    }
    await peer.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    if (!contextIsCurrent()) return;
    state.pendingIce.push(...takePendingCandidates(receivedCycleId));
    await flushTrainingSessionPendingIce(peer, contextIsCurrent);
    const answer = await peer.createAnswer();
    if (!contextIsCurrent()) return;
    await peer.setLocalDescription(answer);
    if (!contextIsCurrent()) return;
    await sendRoomSignal("answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    if (state.room.hostUid !== context.ownUid
        || receivedCycleId !== getConnectionCycleId()) {
      throw new Error("以前のP2P接続試行から届いたanswerです。");
    }
    await peer.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    if (!contextIsCurrent()) return;
    await flushTrainingSessionPendingIce(peer, contextIsCurrent);
  } else if (signal.type === "candidate") {
    const candidate = {
      candidate: payload.candidate,
      sdpMid: payload.sdpMid,
      sdpMLineIndex: payload.sdpMLineIndex,
      usernameFragment: payload.usernameFragment,
    };
    if (receivedCycleId !== getConnectionCycleId()) {
      if (state.room.hostUid === context.ownUid
          || !queuePendingCandidate(
            receivedCycleId,
            candidate,
            signal.createdAt,
          )) {
        throw new Error("現在のP2P接続試行と異なるcandidateです。");
      }
      return;
    }
    if (peer.remoteDescription) await peer.addIceCandidate(candidate);
    else state.pendingIce.push(candidate);
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
  return setupTrainingSessionPeerConnection();
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
  if (state === targetState
      && targetState.trainingRunId
      && targetState.roomId
      && !targetState.outcome) {
    rearmTrainingImageTransferForReplacement(targetState);
    enterTrainingSessionV5Recovery(targetState, "image-transport-unknown");
    dispatchTrainingP2pRecoveryEvent("ICE_FAILED", targetState);
    handleRecoverableError(error || new Error(reason));
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
    dispatchTrainingP2pRecoveryEvent("CHANNEL_OPENED", state);
    if (state.sessionV5.phase === "connecting") {
      applyTrainingSessionV5Transition(state, "ACTIVATE");
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
    if (state.roomId && !state.outcome) {
      dispatchTrainingP2pRecoveryEvent("ICE_FAILED", state);
      return;
    }
  };
  channel.onerror = () => {
    if (!contextIsCurrent()) return;
    if (state.roomId && !state.outcome) {
      dispatchTrainingP2pRecoveryEvent("ICE_FAILED", state);
      return;
    }
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

function runTrainingRoundChannelFlight(
  flights,
  channel,
  roundIndex,
  operation,
) {
  let channelFlights = flights.get(channel);
  if (!channelFlights) {
    channelFlights = new Map();
    flights.set(channel, channelFlights);
  }
  const existing = channelFlights.get(roundIndex);
  if (existing) return existing;
  const flight = Promise.resolve().then(operation);
  channelFlights.set(roundIndex, flight);
  const release = () => {
    if (channelFlights.get(roundIndex) !== flight) return;
    channelFlights.delete(roundIndex);
    if (!channelFlights.size && flights.get(channel) === channelFlights) {
      flights.delete(channel);
    }
  };
  flight.then(release, release);
  return flight;
}

function runTrainingImageSendFlight(
  targetState,
  channel,
  roundIndex,
  operation,
) {
  let queue = targetState.outgoingImageSendQueues.get(channel);
  if (!queue) {
    queue = {
      roundFlights: new Map(),
      tail: Promise.resolve(),
    };
    targetState.outgoingImageSendQueues.set(channel, queue);
  }
  const existing = queue.roundFlights.get(roundIndex);
  if (existing) return existing;
  const flight = queue.tail.then(operation);
  const tail = flight.then(() => undefined, () => undefined);
  queue.roundFlights.set(roundIndex, flight);
  queue.tail = tail;
  const release = () => {
    if (queue.roundFlights.get(roundIndex) === flight) {
      queue.roundFlights.delete(roundIndex);
    }
    if (!queue.roundFlights.size
        && queue.tail === tail
        && targetState.outgoingImageSendQueues.get(channel) === queue) {
      targetState.outgoingImageSendQueues.delete(channel);
    }
  };
  flight.then(release, release);
  return flight;
}

function runLocalRoundDrawFlight(
  targetState,
  roomId,
  roundIndex,
  operation,
) {
  const key = `${roomId}:${roundIndex}`;
  const existing = targetState.localRoundDrawFlights.get(key);
  if (existing) return existing;
  const flight = Promise.resolve().then(operation);
  targetState.localRoundDrawFlights.set(key, flight);
  const release = () => {
    if (targetState.localRoundDrawFlights.get(key) === flight) {
      targetState.localRoundDrawFlights.delete(key);
    }
  };
  flight.then(release, release);
  return flight;
}

function validTrainingImageTransferId(value) {
  const transferId = String(value || "");
  return transferId.length >= TRAINING_IMAGE_TRANSFER_ID_MIN_LENGTH
    && transferId.length <= TRAINING_IMAGE_TRANSFER_ID_MAX_LENGTH
    && /^[-_0-9A-Za-z]+$/.test(transferId);
}

function createTrainingImageTransferId() {
  const transferId = createTrainingSessionV5Token();
  if (!validTrainingImageTransferId(transferId)) {
    throw new Error("画像転送IDを作成できませんでした。");
  }
  return transferId;
}

function trainingImageChunkCount(size) {
  const bytes = Number(size);
  if (!Number.isSafeInteger(bytes)
      || bytes <= 0
      || bytes > MAX_IMAGE_TRANSFER_BYTES) return 0;
  return Math.ceil(bytes / IMAGE_CHUNK_BYTES);
}

function encodeTrainingImageChunkFrame(transferId, sequence, value) {
  if (!validTrainingImageTransferId(transferId)
      || !Number.isSafeInteger(sequence)
      || sequence < 0) {
    throw new Error("送信画像のチャンク情報が不正です。");
  }
  const payload = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!payload?.byteLength || payload.byteLength > IMAGE_CHUNK_BYTES) {
    throw new Error("送信画像のチャンクサイズが不正です。");
  }
  const transferBytes = Uint8Array.from(
    transferId,
    (character) => character.charCodeAt(0),
  );
  const headerLength = 9 + transferBytes.byteLength;
  const frame = new Uint8Array(headerLength + payload.byteLength);
  if (frame.byteLength > MAX_IMAGE_CHANNEL_FRAME_BYTES) {
    throw new Error("送信画像のP2Pフレームサイズが上限を超えています。");
  }
  frame.set(TRAINING_IMAGE_CHUNK_MAGIC, 0);
  frame[4] = transferBytes.byteLength;
  frame.set(transferBytes, 5);
  new DataView(frame.buffer).setUint32(5 + transferBytes.byteLength, sequence);
  frame.set(payload, headerLength);
  return frame.buffer;
}

function decodeTrainingImageChunkFrame(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes || bytes.byteLength < 10
      || bytes.byteLength > MAX_IMAGE_CHANNEL_FRAME_BYTES
      || TRAINING_IMAGE_CHUNK_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("受信画像のチャンク形式が不正です。");
  }
  const transferLength = Number(bytes[4]);
  const headerLength = 9 + transferLength;
  if (transferLength < TRAINING_IMAGE_TRANSFER_ID_MIN_LENGTH
      || transferLength > TRAINING_IMAGE_TRANSFER_ID_MAX_LENGTH
      || bytes.byteLength <= headerLength) {
    throw new Error("受信画像の転送IDが不正です。");
  }
  let transferId = "";
  for (let index = 0; index < transferLength; index += 1) {
    transferId += String.fromCharCode(bytes[5 + index]);
  }
  if (!validTrainingImageTransferId(transferId)) {
    throw new Error("受信画像の転送IDが不正です。");
  }
  const sequence = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(5 + transferLength);
  const payload = bytes.slice(headerLength);
  if (!payload.byteLength || payload.byteLength > IMAGE_CHUNK_BYTES) {
    throw new Error("受信画像のチャンクサイズが不正です。");
  }
  return {
    transferId,
    sequence,
    payload: payload.buffer,
  };
}

function appendTrainingImageChunkFrame(targetState, frame) {
  const transfer = targetState.incomingImage;
  if (!transfer || frame.transferId !== transfer.transferId) return "drained";
  if (frame.sequence < transfer.nextChunkSequence) return "duplicate";
  if (frame.sequence !== transfer.nextChunkSequence
      || frame.sequence >= transfer.chunkCount) {
    targetState.incomingImage = null;
    throw new Error("受信画像のチャンク順序が一致しません。");
  }
  const expectedBytes = frame.sequence === transfer.chunkCount - 1
    ? transfer.size - (frame.sequence * IMAGE_CHUNK_BYTES)
    : IMAGE_CHUNK_BYTES;
  if (frame.payload.byteLength !== expectedBytes) {
    targetState.incomingImage = null;
    throw new Error("受信画像のチャンクサイズが宣言値と一致しません。");
  }
  try {
    appendIncomingOnlineImageChunk(transfer, frame.payload);
    transfer.nextChunkSequence += 1;
    return "accepted";
  } catch (error) {
    if (targetState.incomingImage === transfer) {
      targetState.incomingImage = null;
    }
    throw error;
  }
}

function trainingImageEndDisposition(transfer, message) {
  const transferId = String(message?.transferId || "");
  if (!validTrainingImageTransferId(transferId)) {
    throw new Error("受信画像の完了転送IDが不正です。");
  }
  return !transfer || transferId !== transfer.transferId
    ? "drained"
    : "accepted";
}

function trainingRoundImageSendIsCurrent(
  targetState,
  channel,
  roundIndex,
  contextIsCurrent = () => true,
) {
  const opponentUid = Object.keys(targetState.room?.members || {})
    .find((uid) => uid !== targetState.uid) || "";
  const round = targetState.room?.rounds?.[roundIndex] || {};
  return contextIsCurrent()
    && state === targetState
    && targetState.channel === channel
    && channel?.readyState === "open"
    && targetState.roomId
    && !targetState.outcome
    && currentRoundIndex() === roundIndex
    && !targetState.outgoingImageRounds.has(roundIndex)
    && Boolean(opponentUid)
    && round.imageReceived?.[opponentUid] !== true;
}

function sendLocalRoundImage(
  roundIndex,
  draw,
  contextIsCurrent = () => true,
) {
  const targetState = state;
  const channel = targetState.channel;
  if (!contextIsCurrent()
      || targetState.outgoingImageRounds.has(roundIndex)
      || channel?.readyState !== "open") return Promise.resolve(false);
  return runTrainingImageSendFlight(
    targetState,
    channel,
    roundIndex,
    () => sendLocalRoundImageOnce(
      targetState,
      channel,
      roundIndex,
      draw,
      contextIsCurrent,
    ),
  );
}

async function sendLocalRoundImageOnce(
  targetState,
  channel,
  roundIndex,
  draw,
  contextIsCurrent = () => true,
) {
  if (!trainingRoundImageSendIsCurrent(
    targetState,
    channel,
    roundIndex,
    contextIsCurrent,
  )) return false;
  const imageIndex = Number(draw?.imageIndex || 0);
  const image = targetState.localImages[imageIndex - 1];
  if (!image?.blob) throw new Error("DRAWした画像を端末で確認できませんでした。");
  try {
    const buffer = await image.blob.arrayBuffer();
    if (!trainingRoundImageSendIsCurrent(
      targetState,
      channel,
      roundIndex,
      contextIsCurrent,
    )) return false;
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_TRANSFER_BYTES) {
      throw new Error("送信画像のサイズが鍛え合い60の上限を超えています。");
    }
    const mime = verifiedOnlineImageMime(buffer);
    const transferId = createTrainingImageTransferId();
    const chunkCount = trainingImageChunkCount(buffer.byteLength);
    channel.send(JSON.stringify({
      type: "training-image-start",
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      ownerUid: state.uid,
      transferId,
      round: roundIndex,
      imageIndex,
      bpm: Number(draw.bpm),
      size: buffer.byteLength,
      chunkCount,
      mime,
    }));
    for (
      let offset = 0, sequence = 0;
      offset < buffer.byteLength;
      offset += IMAGE_CHUNK_BYTES, sequence += 1
    ) {
      await waitForDataBuffer(channel);
      if (!contextIsCurrent()
          || state !== targetState
          || targetState.channel !== channel
          || channel.readyState !== "open") return false;
      channel.send(encodeTrainingImageChunkFrame(
        transferId,
        sequence,
        buffer.slice(offset, Math.min(buffer.byteLength, offset + IMAGE_CHUNK_BYTES)),
      ));
    }
    if (!trainingRoundImageSendIsCurrent(
      targetState,
      channel,
      roundIndex,
      contextIsCurrent,
    )) return false;
    channel.send(JSON.stringify({
      type: "training-image-end",
      ownerUid: state.uid,
      transferId,
      round: roundIndex,
      imageIndex,
      bpm: Number(draw.bpm),
      chunkCount,
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

async function acknowledgeTrainingRoundImageReceipt(
  targetState,
  roomId,
  roundIndex,
  ownUid,
  contextIsCurrent = () => true,
) {
  if (!contextIsCurrent()
      || state !== targetState
      || targetState.roomId !== roomId
      || targetState.uid !== ownUid) return false;
  const result = await runTransaction(
    ref(
      database,
      `online/trainingRooms/${roomId}/rounds/${roundIndex}/imageReceived/${ownUid}`,
    ),
    (current) => current == null ? true : undefined,
  );
  if (!contextIsCurrent()
      || state !== targetState
      || targetState.roomId !== roomId
      || targetState.uid !== ownUid) return false;
  if (result.snapshot.val() !== true) {
    throw new Error("画像の受信確認を確定できませんでした。");
  }
  return true;
}

async function acknowledgeExistingTrainingRoundImage(
  message,
  existingImage,
  contextIsCurrent = () => true,
) {
  if (!contextIsCurrent()) return false;
  const targetState = state;
  const roomId = targetState.roomId;
  const roundIndex = Number(message.round);
  const opponentUid = opponentPlayer()?.uid || "";
  const ownUid = targetState.uid;
  if (!roomId
      || !opponentUid
      || targetState.remoteImages[roundIndex] !== existingImage
      || Number(existingImage?.imageIndex) !== Number(message.imageIndex)
      || Number(existingImage?.bpm) !== Number(message.bpm)) {
    throw new Error("受信済み画像と再送された画像情報が一致しません。");
  }
  const drawSnapshot = await get(
    ref(
      database,
      `online/trainingRooms/${roomId}/rounds/${roundIndex}/draws/${opponentUid}`,
    ),
  );
  if (!contextIsCurrent()
      || state !== targetState
      || targetState.roomId !== roomId
      || targetState.remoteImages[roundIndex] !== existingImage) return false;
  const draw = drawSnapshot.val();
  if (Number(draw?.imageIndex) !== Number(existingImage.imageIndex)
      || Number(draw?.bpm) !== Number(existingImage.bpm)) {
    throw new Error("受信済み画像とFirebaseのDRAW情報が一致しません。");
  }
  const acknowledged = await acknowledgeTrainingRoundImageReceipt(
    targetState,
    roomId,
    roundIndex,
    ownUid,
    contextIsCurrent,
  );
  return acknowledged
    && contextIsCurrent()
    && state === targetState
    && targetState.roomId === roomId
    && targetState.remoteImages[roundIndex] === existingImage;
}

async function handleChannelMessage(data, contextIsCurrent = () => true) {
  if (!contextIsCurrent()) return;
  if (typeof data === "string") {
    if (data.length > 2048) throw new Error("P2P制御情報が大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "training-image-start") {
      const roundIndex = Number(message.round);
      const transferId = String(message.transferId || "");
      const declaredChunkCount = trainingImageChunkCount(message.size);
      if (!contextIsCurrent()) return;
      if (message.protocolVersion !== TRAINING_PROTOCOL_VERSION
        || message.variant !== TRAINING_VARIANT
        || message.ownerUid !== opponentPlayer()?.uid
        || !validTrainingImageTransferId(transferId)
        || !Number.isInteger(roundIndex)
        || roundIndex < 1
        || roundIndex > TRAINING_MAX_ROUNDS
        || !Number.isInteger(Number(message.imageIndex))
        || Number(message.imageIndex) < 1
        || Number(message.imageIndex) > TRAINING_IMAGE_COUNT
        || normalizeImageBpm(message.bpm) < 0
        || !declaredChunkCount
        || Number(message.chunkCount) !== declaredChunkCount) {
        throw new Error("受信画像の送信者情報が一致しません。");
      }
      if (state.incomingImage) {
        const activeTransfer = state.incomingImage;
        if (activeTransfer.transferId === transferId
            && (activeTransfer.round !== roundIndex
              || activeTransfer.size !== Number(message.size)
              || activeTransfer.chunkCount !== declaredChunkCount
              || Number(activeTransfer.imageIndex) !== Number(message.imageIndex)
              || Number(activeTransfer.bpm) !== Number(message.bpm))) {
          throw new Error("受信中画像の再送情報が一致しません。");
        }
        return;
      }
      const existingImage = state.remoteImages[roundIndex];
      if (existingImage) {
        await acknowledgeExistingTrainingRoundImage(
          message,
          existingImage,
          contextIsCurrent,
        );
        return;
      }
      state.incomingImage = createIncomingOnlineImageTransfer(message, {
        expectedRound: roundIndex,
        maxBytes: MAX_IMAGE_TRANSFER_BYTES,
      });
      state.incomingImage.imageIndex = Number(message.imageIndex);
      state.incomingImage.bpm = Number(message.bpm);
      state.incomingImage.transferId = transferId;
      state.incomingImage.chunkCount = declaredChunkCount;
      state.incomingImage.nextChunkSequence = 0;
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
  const encodedChunk = data instanceof Blob ? await data.arrayBuffer() : data;
  const frame = decodeTrainingImageChunkFrame(encodedChunk);
  if (!contextIsCurrent()) return;
  appendTrainingImageChunkFrame(state, frame);
}

async function finishIncomingImage(message, contextIsCurrent = () => true) {
  if (!contextIsCurrent()) return;
  const targetState = state;
  const transfer = targetState.incomingImage;
  if (trainingImageEndDisposition(transfer, message) === "drained") return;
  const endStatus = onlineImageEndStatus(transfer, message);
  const roundIndex = Number(message.round);
  const opponentUid = opponentPlayer()?.uid || "";
  const roomId = targetState.roomId;
  const ownUid = targetState.uid;
  if (endStatus !== "complete"
    || message.ownerUid !== opponentUid
    || Number(message.imageIndex) !== Number(transfer?.imageIndex)
    || Number(message.bpm) !== Number(transfer?.bpm)
    || Number(message.chunkCount) !== transfer.chunkCount
    || transfer.nextChunkSequence !== transfer.chunkCount) {
    targetState.incomingImage = null;
    throw new Error("受信画像の完了情報が一致しません。");
  }
  const drawSnapshot = await get(
    ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/draws/${opponentUid}`),
  );
  if (!contextIsCurrent()
      || state !== targetState
      || targetState.incomingImage !== transfer) return;
  const draw = drawSnapshot.val();
  if (Number(draw?.imageIndex) !== Number(transfer.imageIndex)
    || Number(draw?.bpm) !== Number(transfer.bpm)) {
    targetState.incomingImage = null;
    throw new Error("P2P画像とFirebaseのDRAW情報が一致しません。");
  }
  const mime = completeIncomingOnlineImageTransfer(transfer);
  if (!contextIsCurrent()
      || state !== targetState
      || targetState.incomingImage !== transfer) return;
  targetState.incomingImage = null;
  const blob = new Blob(transfer.chunks, { type: mime });
  releaseImage(targetState.remoteImages[roundIndex]);
  targetState.remoteImages[roundIndex] = {
    blob,
    url: URL.createObjectURL(blob),
    mime,
    bpm: Number(draw.bpm),
    imageIndex: Number(draw.imageIndex),
  };
  await acknowledgeTrainingRoundImageReceipt(
    targetState,
    roomId,
    roundIndex,
    ownUid,
    contextIsCurrent,
  );
  if (!contextIsCurrent() || state !== targetState) return;
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
    handleTrainingImageTransferFailure(
      "image_exchange_timeout",
      new Error("画像交換を確認し直しています。対戦ルームは終了していません。"),
    ).catch(() => {});
  }, IMAGE_EXCHANGE_TIMEOUT_MS);
}

async function failImageExchange(reason, error) {
  if (!active
    || !state.roomId
    || state.room.destroyed
    || state.outcome) return;
  if (error) handleRecoverableError(error);
  enterTrainingSessionV5Recovery(
    state,
    trainingSessionV5TokenIsValid(reason) ? reason : "image-status-unknown",
  );
  dispatchTrainingP2pRecoveryEvent("ICE_FAILED", state);
  await inspectTrainingSessionV5(state, { immediate: true }).catch(() => {});
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

function localRoundDrawContextIsCurrent(
  targetState,
  roomId,
  ownUid,
  generation,
) {
  return state === targetState
    && targetState.generation === generation
    && targetState.roomId === roomId
    && targetState.uid === ownUid
    && !targetState.outcome;
}

function ensureLocalRoundDrawMetadata(
  targetState,
  roomId,
  ownUid,
  roundIndex,
) {
  const generation = targetState.generation;
  return runLocalRoundDrawFlight(
    targetState,
    roomId,
    roundIndex,
    () => ensureLocalRoundDrawMetadataOnce(
      targetState,
      roomId,
      ownUid,
      roundIndex,
      generation,
    ),
  );
}

async function ensureLocalRoundDrawMetadataOnce(
  targetState,
  roomId,
  ownUid,
  roundIndex,
  generation,
) {
  const metadataContextIsCurrent = () => localRoundDrawContextIsCurrent(
    targetState,
    roomId,
    ownUid,
    generation,
  );
  if (!metadataContextIsCurrent()) return null;
  let round = trainingRound(roundIndex);
  if (!Number(round.createdAt || 0)) {
    if (targetState.room.hostUid !== ownUid) return null;
    const created = await runTransaction(
      ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/createdAt`),
      (current) => current == null ? firebaseNow() : undefined,
      { applyLocally: false },
    );
    if (!metadataContextIsCurrent()) return null;
    const createdAt = Number(created.snapshot.val() || 0);
    if (!createdAt) throw new Error("ランダムDRAWの開始時刻を確定できませんでした。");
    ensureRoundLocal(roundIndex).createdAt = createdAt;
    round = trainingRound(roundIndex);
  }
  let draw = roundDraw(round, ownUid);
  if (!draw) {
    const used = new Set(
      Array.from({ length: roundIndex - 1 }, (_, index) => (
        Number(roundDraw(trainingRound(index + 1), ownUid)?.imageIndex || 0)
      )).filter(Boolean),
    );
    const available = Array.from({ length: TRAINING_IMAGE_COUNT }, (_, index) => index + 1)
      .filter((imageIndex) => !used.has(imageIndex));
    const imageIndex = secureRandomChoice(available);
    const image = targetState.localImages[imageIndex - 1];
    const bpm = normalizeImageBpm(image?.bpm);
    if (!image?.blob || bpm < 0) throw new Error("5枚の画像デッキを端末で確認できませんでした。");
    const candidate = { imageIndex, bpm, drawnAt: firebaseNow() };
    const result = await runTransaction(
      ref(database, `online/trainingRooms/${roomId}/rounds/${roundIndex}/draws/${ownUid}`),
      (current) => current === null ? candidate : undefined,
    );
    if (!metadataContextIsCurrent()) return null;
    draw = result.snapshot.val();
    if (!draw) throw new Error("ランダムDRAWを確定できませんでした。");
    ensureRoundLocal(roundIndex).draws = {
      ...(ensureRoundLocal(roundIndex).draws || {}),
      [ownUid]: draw,
    };
  }
  return draw;
}

function ensureLocalRoundDraw(
  roundIndex = currentRoundIndex(),
  contextIsCurrent = () => true,
) {
  const targetState = state;
  const channel = targetState.channel;
  if (state.preview
      || !contextIsCurrent()
      || !targetState.roomId
      || targetState.outcome
      || !Number.isInteger(roundIndex)
      || roundIndex < 1
      || roundIndex > TRAINING_MAX_ROUNDS) return Promise.resolve(false);
  const roomId = targetState.roomId;
  const ownUid = targetState.uid;
  return runTrainingRoundChannelFlight(
    targetState.outgoingImageFlights,
    channel,
    roundIndex,
    async () => {
      const draw = await ensureLocalRoundDrawMetadata(
        targetState,
        roomId,
        ownUid,
        roundIndex,
      );
      if (!draw
          || !contextIsCurrent()
          || state !== targetState
          || targetState.roomId !== roomId
          || targetState.uid !== ownUid
          || targetState.channel !== channel
          || channel?.readyState !== "open"
          || targetState.outgoingImageRounds.has(roundIndex)) return false;
      return sendLocalRoundImage(roundIndex, draw, contextIsCurrent);
    },
  );
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

function resetTrainingSessionV5AfterCancellation(targetState = state) {
  targetState.sessionLeaseHeld = false;
  targetState.trainingOwnerEpoch = "";
  targetState.trainingAttemptRevision = 0;
  targetState.trainingAttemptState = "";
  targetState.trainingAttempt = null;
  targetState.trainingAttemptHeartbeatBusy = false;
  targetState.trainingAttemptMatchBusy = false;
  targetState.trainingAttemptInspectBusy = false;
  targetState.trainingAttemptRecoveryCount = 0;
  targetState.trainingOwnerSuperseded = false;
  targetState.opponentRunId = "";
  targetState.opponentEndpointId = "";
  targetState.opponentOwnerEpoch = "";
  targetState.roomAttemptId = "";
  targetState.transportEpoch = "";
  targetState.roomId = "";
  targetState.pendingRoomId = "";
  targetState.room = emptyRoom();
  targetState.roomSyncing = false;
  targetState.startingMatchmaking = false;
  targetState.enteringRoom = false;
  targetState.enterRoomRetryAttempts = 0;
  targetState.trainingReconnectPromise = null;
  targetState.trainingTransportRefreshPromise = null;
  targetState.trainingTransportRefreshEpoch = "";
  invalidateTrainingTransportRefreshes(targetState);
  targetState.trainingResultRtdbRelease = null;
  targetState.trainingProtectedRtdbReleased = false;
  targetState.channelWasOpened = false;
  targetState.incomingImage = null;
  targetState.incomingMessageChain = Promise.resolve();
  targetState.outgoingImageRounds.clear();
  targetState.localRoundDrawFlights.clear();
  targetState.outgoingImageFlights.clear();
  targetState.outgoingImageSendQueues.clear();
  Object.values(targetState.remoteImages).forEach(releaseImage);
  targetState.remoteImages = {};
  targetState.outcome = null;
  targetState.currentView = null;
  targetState.trainingRunId = "";
  targetState.trainingRunRestored = false;
  targetState.sessionV5 = createTrainingSessionV5State({
    revision: targetState.sessionV5.revision + 1,
  });
  sessionStorage.removeItem(TRAINING_V5_RUN_STORAGE_KEY);
  targetState.trainingSessionCancelling = false;
}

async function cleanupTrainingSessionMatchmaking(keepActive) {
  const targetState = state;
  clearTrainingSessionV5MatchTimer(targetState);
  clearTrainingSessionV5InspectTimer(targetState);
  if (keepActive) return true;
  if (!beginTrainingSessionV5Cancellation(targetState)) return false;
  const cancellationIdentity = Object.freeze({
    roomId: targetState.roomId || targetState.pendingRoomId,
    uid: targetState.uid,
    runId: targetState.trainingRunId,
    endpointId: targetState.trainingEndpointId,
    ownerEpoch: targetState.trainingOwnerEpoch,
    roomAttemptId: targetState.roomAttemptId,
    transportEpoch: targetState.transportEpoch,
  });
  await stopTrainingSessionV5LocalTransport(targetState);
  if (cancellationIdentity.roomId && cancellationIdentity.runId) {
    const cleanupOperations = [
      remove(ref(
        database,
        `online/trainingRooms/${cancellationIdentity.roomId}/signalsV5/${
          cancellationIdentity.uid
        }/${cancellationIdentity.runId}`,
      )),
    ];
    if (cancellationIdentity.ownerEpoch
        && cancellationIdentity.roomAttemptId
        && cancellationIdentity.transportEpoch) {
      cleanupOperations.push(set(
        ref(database, trainingSessionV5PresencePath(
          cancellationIdentity.roomId,
          cancellationIdentity.uid,
          cancellationIdentity.runId,
        )),
        createTrainingSessionV5PresencePayload({
          runId: cancellationIdentity.runId,
          endpointId: cancellationIdentity.endpointId,
          ownerEpoch: cancellationIdentity.ownerEpoch,
          roomAttemptId: cancellationIdentity.roomAttemptId,
          transportEpoch: cancellationIdentity.transportEpoch,
          online: false,
          updatedAt: firebaseNow(),
        }),
      ));
    }
    await Promise.allSettled(cleanupOperations);
  }
  if (cancellationIdentity.runId
      && cancellationIdentity.ownerEpoch
      && !targetState.trainingOwnerSuperseded) {
    let response;
    try {
      response = await trainingSessionActionCallable({
        action: "cancel",
        runId: cancellationIdentity.runId,
        endpointId: cancellationIdentity.endpointId,
        ownerEpoch: cancellationIdentity.ownerEpoch,
      });
    } catch {
      return false;
    }
    const cancellation = response?.data || {};
    if (cancellation.outcome === "owner-replaced"
        || cancellation.reason === "owner-replaced") {
      await handleTrainingSessionV5OwnerReplaced(targetState);
    } else if (cancellation.cancelled !== true
        && !["terminal", "cancelled", "not-started"].includes(
          String(cancellation.outcome || cancellation.reason || ""),
        )) {
      return false;
    }
  }
  await stopTrainingSessionV5LocalTransport(targetState);
  resetTrainingSessionV5AfterCancellation(targetState);
  return true;
}

async function cleanupMatchmaking(keepActive) {
  return cleanupTrainingSessionMatchmaking(keepActive);
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
  if (state.trainingOwnerSuperseded) {
    await deactivate({ returnHome: true });
    return;
  }
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
  if (state.trainingOwnerSuperseded) {
    beginTrainingSessionV5Cancellation(state);
    await stopTrainingSessionV5LocalTransport(state);
    await cleanupPublicPresence().catch(() => {});
    active = false;
    releaseTrainingTabOwnership();
    if (returnHome) window.HariaiApp?.returnHome?.();
    return true;
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
  void releaseTrainingProtectedRtdbTransport(
    state,
    { transportEpoch: state.transportEpoch },
  );
  if (!await cleanupMatchmakingReliably(false)) {
    handleRecoverableError(new Error(
      "鍛え合い60の終了を確認できませんでした。通信を確認して、もう一度お試しください。",
    ));
    return false;
  }
  active = false;
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
  await releaseTrainingDisconnectHandles(state);
  state.trainingSignalUnsubscribe?.();
  state.trainingSignalUnsubscribe = null;
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

window.addEventListener("pagehide", (event) => {
  if (!active) return;
  releaseTrainingWorkoutWakeLock(state);
  if (event.persisted) return;
  releaseTrainingTabOwnership();
  window.clearInterval(state.finisherTicker);
  window.clearInterval(state.finisherOfferTimer);
  state.finisherTicker = null;
  state.finisherOfferTimer = null;
  clearImageExchangeWatchdog();
  clearScorePoll();
  clearTurnTicker();
  state.ambienceController.destroy();
  state.channel?.close();
  state.peer?.close();
  state.localImages.forEach(releaseImage);
  Object.values(state.remoteImages).forEach(releaseImage);
});

function trainingSessionV5TransportNeedsReconnect(targetState = state) {
  if (!trainingSessionV5ContextIsCurrent(targetState)
      || targetState.trainingAttemptState !== "active"
      || !targetState.roomId
      || targetState.room.destroyed
      || targetState.outcome
      || targetState.enteringRoom
      || targetState.trainingTransportRefreshPromise) return false;
  const peerUnavailable = (targetState.channelWasOpened && !targetState.peer)
    || ["failed", "closed"].includes(targetState.peer?.connectionState)
    || ["failed", "closed"].includes(targetState.peer?.iceConnectionState);
  const channelUnavailable = (targetState.channelWasOpened && !targetState.channel)
    || ["closing", "closed"].includes(targetState.channel?.readyState);
  return peerUnavailable || channelUnavailable;
}

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !active || state.preview) return;
  const targetState = state;
  if (trainingSessionV5ContextIsCurrent(targetState)) {
    claimTrainingTabOwnership()
      .then(async () => {
        await inspectTrainingSessionV5(targetState, { immediate: true });
        if (trainingSessionV5TransportNeedsReconnect(targetState)) {
          await requestTrainingSessionV5Reconnect(targetState);
        }
      })
      .catch(() => {
        if (!trainingSessionV5ContextIsCurrent(targetState)) return;
        enterTrainingSessionV5Recovery(targetState, "page-resume-unknown");
        showToast("鍛え合い60の接続状態を確認しています。");
      });
  }
  queueMicrotask(() => {
    resumeTrainingAmbienceAfterVisibility().catch(() => {});
    syncTrainingWorkoutWakeLock(state);
  });
});

window.HariaiTraining = {
  start,
  isActive,
  requestHome,
  destroyRoom,
};
window.dispatchEvent(new CustomEvent("hariai-training-ready"));

if (isPreviewRequest()) queueMicrotask(start);
