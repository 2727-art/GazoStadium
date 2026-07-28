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
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const trainingTabId = globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const trainingTabChannel = "BroadcastChannel" in window
  ? new BroadcastChannel("hariai-stadium-training-tab-v1")
  : null;

let active = false;
let state = createState();
let trainingTabLeaseHeld = false;
let trainingSharedStateOwned = false;
let trainingTabClaimConflict = false;
let trainingTabClaiming = false;

trainingTabChannel?.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.tabId === trainingTabId) return;
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
  if (document.hidden) return;
  queueMicrotask(() => {
    resumeTrainingAmbienceAfterVisibility().catch(() => {});
  });
});

function storedVolume() {
  const value = Number(localStorage.getItem(TRAINING_VOLUME_KEY));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.18;
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
    pendingIce: [],
    incomingImage: null,
    outgoingImageRounds: new Set(),
    outgoingImageBusy: false,
    imageExchangeTimer: null,
    imageExchangeRound: 0,
    incomingMessageChain: Promise.resolve(),
    iceServers: FALLBACK_ICE_SERVERS.map((item) => ({ ...item })),
    ticker: null,
    currentView: null,
    roundProgressWriting: null,
    giveUpArmed: false,
    scoreSubmitting: false,
    commandSubmitting: false,
    freeCheerDraft: "",
    freeCheerSentRound: 0,
    ambienceController,
    volume,
    muted,
    ambienceRevision: 0,
    ambienceUnlocked: false,
    ambienceResumeRequired: false,
    cheer: null,
    cheerTimer: null,
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
    hostUid: "",
    guestUid: "",
    createdAt: 0,
    status: "",
    members: {},
    players: {},
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
  state.authReady = true;
  render();
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
      failImageExchange("image_transfer_failed", error).catch(() => {});
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
      ${partnerWorkout
        ? renderTrainingImageByOwner(state.uid, "相手へ刺さった画像", false, view.roundIndex)
        : renderTrainingImageByOwner(opponentPlayer()?.uid, "今回DRAWされた相手画像", false, view.roundIndex)}
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
        <div class="training-cheer-overlay ${state.cheer ? "is-visible" : ""}" id="trainingCheerOverlay" role="status" aria-live="polite">${escapeHtml(state.cheer?.text || "")}</div>
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
      <div class="training-turn-actions">
        ${startedAt
          ? `<div class="training-base-promise"><strong>${context.scoreInfo.durationMs / 1000} SEC</strong><span>時間到達で自動COMPLETE</span></div>`
          : `<button class="button button-training training-start-button" id="trainingStartWorkout" type="button">${escapeHtml(card.exercise)}を開始</button>`}
      </div>
      <div class="training-give-up-dock ${state.giveUpArmed ? "is-armed" : ""}">
        <p>体調変化はNO CONTEST。続行可能だが指示を完遂しない場合はGIVE UP敗北です。</p>
        ${state.giveUpArmed ? `<button type="button" id="trainingCancelGiveUp">続ける</button>` : ""}
        <button type="button" id="trainingGiveUp">${state.giveUpArmed ? "もう一度押して敗北を確定" : "GIVE UP"}</button>
        ${renderHealthStopButton()}
      </div>
    </section>`;
}

function renderCoachRecovery(view, context = opponentWorkoutContext(view.roundIndex)) {
  const sent = state.freeCheerSentRound === view.roundIndex;
  return `
    <section class="training-coach-recovery" aria-label="相手を応援">
      <div class="training-recovery-panel">
        <span>YOUR IMAGE HIT / COACH</span>
        <strong>${escapeHtml(context?.card?.exercise || "筋トレ")}を見守る</strong>
        <p>画像厳選が刺さった結果です。相手の完遂をロールプレイで支えましょう。</p>
      </div>
      <div class="training-cheer-buttons" aria-label="相手へ掛け声を送る">
        ${Object.entries(CHEERS).map(([id, label]) => `<button type="button" data-training-cheer="${id}">${label}</button>`).join("")}
      </div>
      <div class="training-free-cheer"><label for="trainingFreeCheer">自由なロールプレイ応援 <span>各DRAW 1回</span></label><div>
        <input id="trainingFreeCheer" maxlength="40" value="${escapeHtml(sent ? "" : state.freeCheerDraft)}" placeholder="${sent ? "このDRAWは送信済み" : "例：その一回が明日の自信になる！"}" ${sent ? "disabled" : ""} />
        <button type="button" id="trainingSendFreeCheer" ${sent ? "disabled" : ""}>${sent ? "送信済み" : "応援する"}</button>
      </div></div>
    </section>`;
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
  document.querySelector("#trainingHealthStop")?.addEventListener("click", () => handleHealthStop().catch(handleRecoverableError));
  document.querySelector("#trainingCancelGiveUp")?.addEventListener("click", () => {
    state.giveUpArmed = false;
    render();
  });
  document.querySelectorAll("[data-training-cheer]").forEach((button) => button.addEventListener("click", () => sendCheer(button.dataset.trainingCheer)));
  document.querySelector("#trainingFreeCheer")?.addEventListener("input", (event) => {
    state.freeCheerDraft = event.target.value.slice(0, 40);
  });
  document.querySelector("#trainingSendFreeCheer")?.addEventListener("click", sendFreeCheer);
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

async function beginMatchmaking() {
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
    state.serverTimeOffset = Number(offset?.val() || 0);
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
      state.serverTimeOffset = Number(snapshot.val() || 0);
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

async function startPublicPresence() {
  await cleanupPublicPresence();
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("鍛え合い60の参加状況を登録できませんでした。");
  state.publicPresenceId = presenceId;
  const ownerRef = ref(database, `online/publicPresenceOwners/${presenceId}`);
  await set(ownerRef, state.uid);
  const ownerDisconnect = onDisconnect(ownerRef);
  await ownerDisconnect.remove();
  state.publicPresenceOwnerDisconnect = ownerDisconnect;
  state.publicPresenceState = "waiting";
  await writePublicPresence();
  const disconnect = onDisconnect(ref(database, `online/publicPresence/${presenceId}`));
  await disconnect.remove();
  state.publicPresenceDisconnect = disconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    writePublicPresence().catch(() => {});
  }, HEARTBEAT_MS);
}

async function writePublicPresence() {
  if (!state.publicPresenceId) return;
  await set(ref(database, `online/publicPresence/${state.publicPresenceId}`), {
    mode: "training",
    state: state.publicPresenceState || "waiting",
    lastSeen: firebaseNow(),
  });
}

async function updatePublicPresence(presenceState) {
  if (!state.publicPresenceId) return;
  state.publicPresenceState = presenceState === "playing" ? "playing" : "waiting";
  await writePublicPresence();
}

async function cleanupPublicPresence() {
  window.clearInterval(state.publicPresenceHeartbeat);
  state.publicPresenceHeartbeat = null;
  await state.publicPresenceDisconnect?.cancel?.().catch(() => {});
  state.publicPresenceDisconnect = null;
  await state.publicPresenceOwnerDisconnect?.cancel?.().catch(() => {});
  state.publicPresenceOwnerDisconnect = null;
  const presenceId = state.publicPresenceId;
  state.publicPresenceId = "";
  state.publicPresenceState = "";
  if (!presenceId || !state.uid || state.preview) return;
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
    "protocolVersion", "variant", "hostUid", "guestUid", "createdAt",
    "status", "members", "players", "accepted",
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
  if (state.roomId || state.enteringRoom) return;
  state.enteringRoom = true;
  let roomAssigned = false;
  try {
    const room = await readRoomSkeleton(roomId);
    if (room.status !== "active"
      || room.protocolVersion !== TRAINING_PROTOCOL_VERSION
      || room.variant !== TRAINING_VARIANT
      || room.members?.[state.uid] !== true
      || ![room.hostUid, room.guestUid].includes(state.uid)
      || room.hostUid === room.guestUid) {
      throw new Error("鍛え合い60の部屋へ参加できませんでした。");
    }
    await armActiveRoomDestroyedDisconnect(roomId);
    const targetSessionId = state.pendingInviteTargetSessionId;
    if (room.guestUid
      && targetSessionId
      && !await removeTrainingInviteReliably(
        room.guestUid,
        roomId,
        targetSessionId,
      )) {
      throw new Error(
        "対戦招待を終了できなかったため、入室を保留しました。通信を確認してください。",
      );
    }
    if (!await releaseMatchLockReliably(roomId)) {
      throw new Error(
        "対戦準備ロックを終了できなかったため、入室を保留しました。通信を確認してください。",
      );
    }
    if (!await cleanupMatchmakingReliably(true)) {
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
    await updatePublicPresence("playing");
    state.screen = "room";
    state.roomSyncing = true;
    setTrainingChrome("鍛え合い ACTIVE");
    render();
    await setupRoomListeners();
    state.roomSyncing = false;
    reactToRoomData();
    startImageExchangeWatchdog();
    try {
      const configuration = await window.HariaiOnline?.getP2pIceConfiguration?.();
      if (Array.isArray(configuration?.iceServers) && configuration.iceServers.length) {
        state.iceServers = configuration.iceServers;
      }
    } catch {
      state.iceServers = FALLBACK_ICE_SERVERS.map((item) => ({ ...item }));
    }
    if (!active || state.roomId !== roomId || state.room.destroyed || state.outcome) return;
    await setupPeerConnection();
  } catch (error) {
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
    state.enteringRoom = false;
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

async function setupRoomListeners() {
  const roomId = state.roomId;
  const base = `online/trainingRooms/${roomId}`;
  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    state.serverTimeOffset = Number(snapshot.val() || 0);
  }));
  const childKeys = ["status", "surrendered", "destroyed", "serverFinalized"];
  childKeys.forEach((key) => {
    state.roomUnsubscribers.push(onValue(ref(database, `${base}/${key}`), (snapshot) => {
      state.room[key] = snapshot.val() || null;
      reactToRoomData();
    }, handleRecoverableError));
  });
  for (let roundIndex = 1; roundIndex <= TRAINING_MAX_ROUNDS; roundIndex += 1) {
    const roundBase = `${base}/rounds/${roundIndex}`;
    ["createdAt", "draws", "imageReceived", "commandChoices", "workouts", "completedAt"].forEach((key) => {
      state.roomUnsubscribers.push(onValue(ref(database, `${roundBase}/${key}`), (snapshot) => {
        const round = ensureRoundLocal(roundIndex);
        round[key] = snapshot.val() || (["draws", "imageReceived", "commandChoices", "workouts"].includes(key) ? {} : 0);
        reactToRoomData();
      }, handleRecoverableError));
    });
    state.roomUnsubscribers.push(onValue(
      ref(database, `${roundBase}/scores/${state.uid}`),
      (snapshot) => {
        const score = normalizeScore(snapshot.val());
        const round = ensureRoundLocal(roundIndex);
        round.scores = { ...(round.scores || {}) };
        if (score) {
          round.scores[state.uid] = score;
          scheduleScorePoll(0);
        } else {
          delete round.scores[state.uid];
        }
        reactToRoomData();
      },
      handleRecoverableError,
    ));
  }
  if (state.activeDisconnectRoomId !== state.roomId) {
    await armTrainingActiveDisconnect(state.roomId);
  }
  const ownPresenceRef = ref(database, `${base}/presence/${state.uid}`);
  await set(ownPresenceRef, { online: true, updatedAt: serverTimestamp() });
  const presenceDisconnect = onDisconnect(ownPresenceRef);
  await presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() });
  state.disconnectHandles.push(presenceDisconnect);
  const opponentUid = opponentPlayer()?.uid;
  if (opponentUid) {
    state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${opponentUid}`), (snapshot) => {
      const presence = snapshot.val();
      if (presence?.online === true) state.opponentWasOnline = true;
      if (presence?.online === false && state.opponentWasOnline && !state.outcome && state.roomId) {
        markRoomDestroyed(`disconnect:${opponentUid}`).catch(() => {});
      }
    }, handleRecoverableError));
  }
  const refreshedRounds = await readTrainingRoundsBounded(roomId);
  if (active && state.roomId === roomId) mergeTrainingRounds(refreshedRounds);
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
    ensureLocalRoundDraw(view.roundIndex).catch((error) => failImageExchange("image_transfer_failed", error));
  }
  render();
}

async function setupPeerConnection() {
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
  peer.onicecandidate = (event) => {
    if (event.candidate) sendSignal("candidate", event.candidate.toJSON()).catch(handleRecoverableError);
  };
  peer.ondatachannel = (event) => {
    if (event.channel.label === IMAGE_CHANNEL_LABEL) configureDataChannel(event.channel);
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
    configureDataChannel(peer.createDataChannel(IMAGE_CHANNEL_LABEL, { ordered: true }));
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

function configureDataChannel(channel) {
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    ensureLocalRoundDraw(currentRoundIndex()).catch((error) => {
      failImageExchange("image_transfer_failed", error).catch(() => {});
    });
    render();
  };
  channel.onclose = () => {
    failImageExchange(
      "image_channel_closed",
      new Error("画像交換が終わる前にP2P接続が閉じました。"),
    ).catch(() => {});
  };
  channel.onerror = () => {
    failImageExchange(
      "image_channel_error",
      new Error("画像のP2P転送で通信エラーが発生しました。"),
    ).catch(() => {});
  };
  channel.onmessage = (event) => {
    state.incomingMessageChain = state.incomingMessageChain
      .catch(() => {})
      .then(() => handleChannelMessage(event.data))
      .catch((error) => {
        state.incomingImage = null;
        failImageExchange("image_receive_failed", error).catch(() => {});
      });
  };
}

async function sendLocalRoundImage(roundIndex, draw) {
  if (state.outgoingImageRounds.has(roundIndex)
    || state.channel?.readyState !== "open") return;
  const imageIndex = Number(draw?.imageIndex || 0);
  const image = state.localImages[imageIndex - 1];
  if (!image?.blob) throw new Error("DRAWした画像を端末で確認できませんでした。");
  state.outgoingImageRounds.add(roundIndex);
  const buffer = await image.blob.arrayBuffer();
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_TRANSFER_BYTES) {
    throw new Error("送信画像のサイズが鍛え合い60の上限を超えています。");
  }
  const mime = verifiedOnlineImageMime(buffer);
  state.channel.send(JSON.stringify({
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
    await waitForDataBuffer(state.channel);
    state.channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + IMAGE_CHUNK_BYTES)));
  }
  state.channel.send(JSON.stringify({
    type: "training-image-end",
    ownerUid: state.uid,
    round: roundIndex,
    imageIndex,
    bpm: Number(draw.bpm),
  }));
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

async function handleChannelMessage(data) {
  if (typeof data === "string") {
    if (data.length > 2048) throw new Error("P2P制御情報が大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "training-image-start") {
      const roundIndex = Number(message.round);
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
      await finishIncomingImage(message);
    } else if (message.type === "training-cheer" || message.type === "training-free-cheer") {
      receiveCheer(message);
    } else if (String(message.type || "").startsWith("training-finisher-")) {
      receiveFinisherMessage(message);
    }
    return;
  }
  if (!state.incomingImage) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  try {
    appendIncomingOnlineImageChunk(state.incomingImage, chunk);
  } catch (error) {
    state.incomingImage = null;
    throw error;
  }
}

async function finishIncomingImage(message) {
  const transfer = state.incomingImage;
  const endStatus = onlineImageEndStatus(transfer, message);
  if (endStatus === "orphan") return;
  const roundIndex = Number(message.round);
  const opponentUid = opponentPlayer()?.uid || "";
  if (endStatus !== "complete"
    || message.ownerUid !== opponentUid
    || Number(message.imageIndex) !== Number(transfer?.imageIndex)
    || Number(message.bpm) !== Number(transfer?.bpm)) {
    state.incomingImage = null;
    throw new Error("受信画像の完了情報が一致しません。");
  }
  const drawSnapshot = await get(
    ref(database, `online/trainingRooms/${state.roomId}/rounds/${roundIndex}/draws/${opponentUid}`),
  );
  const draw = drawSnapshot.val();
  if (Number(draw?.imageIndex) !== Number(transfer.imageIndex)
    || Number(draw?.bpm) !== Number(transfer.bpm)) {
    state.incomingImage = null;
    throw new Error("P2P画像とFirebaseのDRAW情報が一致しません。");
  }
  const mime = completeIncomingOnlineImageTransfer(transfer);
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
    ref(database, `online/trainingRooms/${state.roomId}/rounds/${roundIndex}/imageReceived/${state.uid}`),
    true,
  );
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

async function ensureLocalRoundDraw(roundIndex = currentRoundIndex()) {
  if (state.preview || !state.roomId || state.outcome || state.outgoingImageBusy) return;
  if (!Number.isInteger(roundIndex) || roundIndex < 1 || roundIndex > TRAINING_MAX_ROUNDS) return;
  let round = trainingRound(roundIndex);
  if (!Number(round.createdAt || 0)) {
    if (state.room.hostUid !== state.uid) return;
    const created = await runTransaction(
      ref(database, `online/trainingRooms/${state.roomId}/rounds/${roundIndex}/createdAt`),
      (current) => current == null ? firebaseNow() : undefined,
      { applyLocally: false },
    );
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
      ref(database, `online/trainingRooms/${state.roomId}/rounds/${roundIndex}/draws/${state.uid}`),
      (current) => current === null ? candidate : undefined,
    );
    draw = result.snapshot.val();
    if (!draw) throw new Error("ランダムDRAWを確定できませんでした。");
    ensureRoundLocal(roundIndex).draws = {
      ...(ensureRoundLocal(roundIndex).draws || {}),
      [state.uid]: draw,
    };
  }
  if (state.channel?.readyState !== "open" || state.outgoingImageRounds.has(roundIndex)) return;
  state.outgoingImageBusy = true;
  try {
    await sendLocalRoundImage(roundIndex, draw);
  } finally {
    state.outgoingImageBusy = false;
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
  if (!result.snapshot.val()?.startedAt) throw new Error("トレーニング開始を確定できませんでした。");
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
  if (state.preview) return;
  const view = viewOverride || trainingClientView();
  const context = ownWorkoutContext(view.roundIndex);
  const startedAt = Number(context?.workout?.startedAt || 0);
  if (!context || !startedAt || Number(context.workout.completedAt || 0)) return;
  const completedAt = startedAt + context.scoreInfo.durationMs;
  if (firebaseNow() < completedAt) return;
  await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/rounds/${view.roundIndex}/workouts/${state.uid}`),
    (current) => current
      && Number(current.startedAt) === startedAt
      && !current.completedAt
      ? { ...current, completedAt }
      : undefined,
  );
  state.ambienceController.disable();
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
  if (state.preview) return;
  if (!state.giveUpArmed) {
    state.giveUpArmed = true;
    render();
    return;
  }
  const surrendered = await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/surrendered`),
    (current) => current === null ? { uid: state.uid, at: firebaseNow() } : undefined,
  );
  if (!surrendered.snapshot.val()) throw new Error("GIVE UPを確定できませんでした。");
}

function sendCheer(id) {
  const view = trainingClientView();
  const partner = opponentWorkoutContext(view.roundIndex);
  if (!CHEERS[id]
    || !partner
    || !Number(partner.workout?.startedAt || 0)
    || Number(partner.workout?.completedAt || 0)) return;
  if (state.channel?.readyState !== "open") {
    showToast("掛け声用のP2P接続が閉じています。トレーニング進行は続けられます。");
    return;
  }
  state.channel.send(JSON.stringify({
    type: "training-cheer",
    cheerId: id,
    round: view.roundIndex,
  }));
}

function sendFreeCheer() {
  const view = trainingClientView();
  const partner = opponentWorkoutContext(view.roundIndex);
  const text = String(state.freeCheerDraft || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!text
    || state.freeCheerSentRound === view.roundIndex
    || !partner
    || !Number(partner.workout?.startedAt || 0)
    || Number(partner.workout?.completedAt || 0)) return;
  if (state.channel?.readyState !== "open") {
    showToast("自由応援用のP2P接続が閉じています。定型の応援なしでも進行は続けられます。");
    return;
  }
  state.channel.send(JSON.stringify({
    type: "training-free-cheer",
    text,
    round: view.roundIndex,
  }));
  state.freeCheerSentRound = view.roundIndex;
  state.freeCheerDraft = "";
  render();
}

function receiveCheer(message) {
  const view = trainingClientView();
  const text = message.type === "training-free-cheer"
    ? String(message.text || "").trim().replace(/\s+/g, " ").slice(0, 40)
    : CHEERS[message.cheerId];
  if (!text
    || Number(message.round) !== view.roundIndex
    || !TRAINING_RUNNING_PHASES.includes(view.phase)) return;
  state.cheer = { text, round: view.roundIndex };
  window.clearTimeout(state.cheerTimer);
  const overlay = document.querySelector("#trainingCheerOverlay");
  if (overlay) {
    overlay.textContent = state.cheer.text;
    overlay.classList.add("is-visible");
  }
  state.cheerTimer = window.setTimeout(() => {
    state.cheer = null;
    document.querySelector("#trainingCheerOverlay")?.classList.remove("is-visible");
  }, 2400);
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

async function cleanupMatchmaking(keepActive) {
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
  window.clearTimeout(state.cheerTimer);
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
  if (state.uid && state.roomId && !state.preview) {
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
