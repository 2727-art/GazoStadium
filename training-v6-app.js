import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
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
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_VARIANT,
  createTrainingV6P2PEvent,
  trainingV6ParticipantUidsFromMemberOrder,
} from "./training-v6-domain.mjs?v=training-v6-mvp-1";
import {
  createTrainingV6ClientState,
  transitionTrainingV6ClientState,
} from "./training-v6-machine.mjs?v=training-v6-mvp-1";
import {
  createTrainingV6SessionAdapter,
} from "./training-v6-session.mjs?v=training-v6-mvp-1";
import {
  createTrainingV6P2PController,
} from "./training-v6-p2p.mjs?v=training-v6-mvp-1";
import {
  createTrainingV6LocalStore,
} from "./training-v6-store.mjs?v=training-v6-mvp-1";
import {
  createTrainingV6Metronome,
  createTrainingV6WakeLockController,
  createTrainingV6WorkoutClock,
} from "./training-v6-workout.mjs?v=training-v6-mvp-1";
import {
  EXERCISE_LABELS,
  renderTrainingV6Error,
  renderTrainingV6Loading,
  renderTrainingV6Matching,
  renderTrainingV6Room,
  renderTrainingV6Setup,
} from "./training-v6-view.mjs?v=training-v6-mvp-1";

const CLIENT_VERSION = "training-v6-mvp-1";
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const SAFETY_KEY = "hariai-training-v6-safety";
const MATCH_REFRESH_MS = 15_000;
const PUBLIC_PRESENCE_HEARTBEAT_MS = 30_000;
const ROOM_RETRY_DELAYS_MS = Object.freeze([500, 1_000, 2_000, 4_000]);
const P2P_RETRY_DELAY_MS = 2_500;
const FALLBACK_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
  Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
]);
const PRESET_INSTRUCTIONS = Object.freeze({
  push_up: Object.freeze({
    exercise: "腕立て伏せ",
    completion: "60秒、自分のペースで続ける",
    command: "呼吸を止めず、無理のない可動域で腕立て伏せを続けてください。",
  }),
  squat: Object.freeze({
    exercise: "スクワット",
    completion: "60秒、自分のペースで続ける",
    command: "膝とつま先の向きを意識し、無理のない深さで続けてください。",
  }),
  sit_up: Object.freeze({
    exercise: "腹筋",
    completion: "60秒、呼吸を止めずに続ける",
    command: "首へ力を入れすぎず、できる範囲で腹筋を続けてください。",
  }),
  custom: Object.freeze({
    exercise: "",
    completion: "60秒、自分のペースで続ける",
    command: "無理のない範囲で、リズムに合わせて続けてください。",
  }),
});

const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const trainingV6Callable = httpsCallable(functions, "trainingV6Action");
const localStore = createTrainingV6LocalStore();

let active = false;
let generation = 0;
let state = createState();
let releaseTabLock = null;

function createToken() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function readSafetySettings() {
  try {
    const value = JSON.parse(localStorage.getItem(SAFETY_KEY) || "{}");
    const allowed = Array.isArray(value.allowedExercises)
      ? value.allowedExercises.filter((id) => Object.hasOwn(EXERCISE_LABELS, id))
      : [];
    return {
      allowedExercises: allowed.length ? [...new Set(allowed)] : ["push_up", "squat", "sit_up"],
      maxBpm: [40, 60, 80, 100, 120, 140, 160].includes(Number(value.maxBpm))
        ? Number(value.maxBpm)
        : 100,
      conditionText: String(value.conditionText || "").slice(0, 80),
    };
  } catch {
    return {
      allowedExercises: ["push_up", "squat", "sit_up"],
      maxBpm: 100,
      conditionText: "",
    };
  }
}

function createState() {
  const safety = readSafetySettings();
  const nextGeneration = generation + 1;
  generation = nextGeneration;
  const metronome = createTrainingV6Metronome({
    onError: () => showFriendlyToast("BPM音を再生できませんでした。画面表示は継続します。"),
  });
  const wakeLock = createTrainingV6WakeLockController({
    onError: () => {},
  });
  const next = {
    generation: nextGeneration,
    connectionId: createToken(),
    screen: "loading",
    authReady: false,
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    allowedExercises: safety.allowedExercises,
    maxBpm: safety.maxBpm,
    conditionText: safety.conditionText,
    images: [],
    restoredDeck: false,
    missingDeck: false,
    busy: false,
    error: null,
    updateRequired: false,
    clientState: createTrainingV6ClientState(),
    rawRoom: null,
    ticket: null,
    matchStartedAt: 0,
    matchTicker: null,
    matchRefreshTimer: null,
    ticketUnsubscribe: null,
    roomUnsubscribe: null,
    roomRetryIndex: 0,
    roomRetryTimer: null,
    serverTimeOffset: 0,
    offsetUnsubscribe: null,
    presenceDisconnect: null,
    publicPresenceId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    publicPresenceOwnerDisconnect: null,
    p2p: null,
    p2pSignature: "",
    p2pRetryTimer: null,
    localSendSignature: "",
    localImageAcknowledged: new Set(),
    remoteImages: {},
    roundSelections: {},
    ownScores: {},
    imageReadyBusy: new Set(),
    roomActionBusy: false,
    safetyStopBusy: false,
    transportClaimed: false,
    ownerReplaced: false,
    session: null,
    messages: [],
    messageIds: new Set(),
    messageWorkoutId: "",
    initialCheerWorkoutIds: new Set(),
    workoutProgress: {
      remainingMs: 60_000,
      progress: 0,
      complete: false,
    },
    workoutClock: null,
    workoutClockSignature: "",
    metronome,
    wakeLock,
    lockHeld: false,
    leaving: false,
  };
  next.workoutClock = createTrainingV6WorkoutClock({
    now: () => firebaseNow(next),
    onTick: (progress) => {
      if (!contextIsCurrent(next)) return;
      next.workoutProgress = progress;
      updateWorkoutTimerDom(next);
    },
  });
  return next;
}

function contextIsCurrent(target = state) {
  return active && state === target && target.generation === generation;
}

function shared() {
  return window.HariaiApp?.shared || {};
}

function showFriendlyToast(message) {
  shared().showToast?.(String(message || "通信状態を確認しています。"));
}

function setTrainingChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${String(label || "鍛え合い V6")}`;
  if (privacy) privacy.textContent = "画像保存なし / RATE対象外";
  if (footerItems[0]) footerItems[0].textContent = "鍛え合い60 V6 / 1対1伴走トレーニング";
  if (footerItems[1]) footerItems[1].textContent = "画像と応援本文は相手の端末へ直接送り、運営サーバーへ保存しません";
  const title = destroyDialog?.querySelector("h2");
  const body = destroyDialog?.querySelector("p");
  const confirm = destroyDialog?.querySelector("#confirmDestroy");
  if (title) title.textContent = "鍛え合い60を安全に終了しますか？";
  if (body) body.textContent = "進行中の伴走はNO CONTESTになります。RATEや不利益はありません。";
  if (confirm) confirm.textContent = "NO CONTESTで終了";
}

function anotherModeIsActive() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiAiTextTraining?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiFreeTable?.isActive?.()
    || window.HariaiAccount?.isActive?.(),
  );
}

async function acquireTabLock(target) {
  if (!navigator.locks?.request) return true;
  return new Promise((resolve) => {
    navigator.locks.request(
      "hariai-training-v6",
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        target.lockHeld = true;
        let release;
        const held = new Promise((heldResolve) => {
          release = heldResolve;
        });
        releaseTabLock = () => {
          releaseTabLock = null;
          target.lockHeld = false;
          release();
        };
        resolve(true);
        await held;
      },
    ).catch(() => resolve(false));
  });
}

async function start() {
  if (active) return;
  if (useOfflineMarketPreview) {
    showFriendlyToast("LOCAL UI PREVIEW中は鍛え合い60へ接続しません。");
    return;
  }
  if (location.protocol === "file:") {
    showFriendlyToast("鍛え合い60は公開URLまたはローカルサーバーから起動してください。");
    return;
  }
  if (anotherModeIsActive()) {
    showFriendlyToast("ほかの画面を終了してから、鍛え合い60を開始してください。");
    return;
  }
  active = true;
  state = createState();
  const target = state;
  setTrainingChrome("鍛え合い V6 READY");
  render();
  const lockAcquired = await acquireTabLock(target);
  if (!contextIsCurrent(target)) return;
  if (!lockAcquired) {
    showFatal(
      "別のタブで鍛え合い60が進行中です",
      "進行中のタブを終了してから、もう一度お試しください。",
    );
    return;
  }
  try {
    await authenticateAndInspect(target);
  } catch (error) {
    if (contextIsCurrent(target)) handleFatalError(error);
  }
}

async function retryInitialization() {
  const target = state;
  if (!contextIsCurrent(target)) return;
  target.error = null;
  target.updateRequired = false;
  target.authReady = false;
  target.screen = "loading";
  render();
  if (!target.lockHeld) {
    const lockAcquired = await acquireTabLock(target);
    if (!contextIsCurrent(target)) return;
    if (!lockAcquired) {
      showFatal(
        "別のタブで鍛え合い60が進行中です",
        "進行中のタブを終了してから、もう一度お試しください。",
      );
      return;
    }
  }
  await authenticateAndInspect(target);
}

async function authenticateAndInspect(target) {
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser
    ? { user: auth.currentUser }
    : await signInAnonymously(auth);
  if (!contextIsCurrent(target)) return;
  target.uid = credential.user.uid;
  target.session = createTrainingV6SessionAdapter({
    transport: (request) => trainingV6Callable(request),
    createActionId: createToken,
    clientVersion: CLIENT_VERSION,
  });
  const handshake = await target.session.handshake();
  if (!contextIsCurrent(target)) return;
  if (!handshake.handshake.compatible) {
    target.updateRequired = true;
    showFatal(
      "最新版への更新が必要です",
      "鍛え合い60 V6の新しい画面を読み込んでください。",
      true,
    );
    return;
  }
  target.authReady = true;
  const [stored, inspection] = await Promise.all([
    localStore.load(target.uid).catch(() => null),
    target.session.request("inspect", {
      expectedRevision: 0,
      roomId: null,
      payload: {},
    }),
  ]);
  if (!contextIsCurrent(target)) return;
  captureSessionResponse(target, inspection);
  if (stored) installStoredDeck(target, stored);
  if (inspection.snapshot) {
    if (!stored && ["media_exchange", "scoring"].includes(inspection.snapshot.phase)) {
      target.missingDeck = true;
    }
    await enterRoom(target, inspection.response.room || inspection.response.snapshot);
    return;
  }
  if (inspection.response?.outcome === "waiting") {
    if (!stored) {
      await cancelWaitingSession(target).catch(() => {});
      target.screen = "setup";
      render();
      return;
    }
    target.screen = "matching";
    target.matchStartedAt = Date.now();
    await startPublicPresence(target, "waiting").catch(() => false);
    startMatchingWatch(target);
    render();
    return;
  }
  target.screen = "setup";
  render();
}

function installStoredDeck(target, stored) {
  releaseImages(target);
  target.images = stored.images.map((blob, index) => ({
    blob,
    url: URL.createObjectURL(blob),
    index: index + 1,
  }));
  target.name = stored.name || target.name;
  target.allowedExercises = Array.isArray(stored.safety?.allowedExercises)
    ? stored.safety.allowedExercises
    : target.allowedExercises;
  target.maxBpm = Number(stored.safety?.maxBpm) || target.maxBpm;
  target.conditionText = String(stored.safety?.conditionText || "");
  target.restoredDeck = true;
}

function captureRenderContinuity() {
  const focused = document.activeElement;
  const focusInsideApp = Boolean(focused && appRoot?.contains(focused));
  let selection = null;
  if (focusInsideApp && typeof focused.selectionStart === "number") {
    selection = {
      start: focused.selectionStart,
      end: focused.selectionEnd,
      direction: focused.selectionDirection,
    };
  }
  const controls = [...appRoot.querySelectorAll(
    "input[id], textarea[id], select[id]",
  )]
    .filter((element) => String(element.type || "").toLowerCase() !== "file")
    .map((element) => ({
      id: element.id,
      value: element.value,
      checked: Boolean(element.checked),
      checkable: ["checkbox", "radio"].includes(
        String(element.type || "").toLowerCase(),
      ),
    }));
  const scrollAreas = [...appRoot.querySelectorAll(
    "#trainingV6Messages, [data-training-v6-preserve-scroll]",
  )].filter((element) => element.id).map((element) => ({
    id: element.id,
    scrollTop: element.scrollTop,
    atBottom: element.scrollHeight - element.clientHeight - element.scrollTop <= 8,
  }));
  return {
    controls,
    scrollAreas,
    focusId: focusInsideApp ? String(focused.id || "") : "",
    selection,
    windowX: Number(globalThis.scrollX || 0),
    windowY: Number(globalThis.scrollY || 0),
  };
}

function restoreRenderContinuity(continuity) {
  for (const saved of continuity.controls) {
    const element = document.getElementById(saved.id);
    if (!element || !appRoot.contains(element)
        || String(element.type || "").toLowerCase() === "file") continue;
    element.value = saved.value;
    if (saved.checkable) element.checked = saved.checked;
  }
  const exerciseSelect = document.getElementById("trainingV6ExerciseId");
  const customExercise = appRoot.querySelector(".training-v6-custom-exercise");
  if (exerciseSelect && customExercise) {
    customExercise.hidden = exerciseSelect.value !== "custom";
  }
  for (const saved of continuity.scrollAreas) {
    const element = document.getElementById(saved.id);
    if (!element || !appRoot.contains(element)) continue;
    element.scrollTop = saved.atBottom ? element.scrollHeight : saved.scrollTop;
  }
  const focusTarget = continuity.focusId
    ? document.getElementById(continuity.focusId)
    : null;
  if (focusTarget && appRoot.contains(focusTarget)) {
    focusTarget.focus({ preventScroll: true });
    if (continuity.selection
        && typeof focusTarget.setSelectionRange === "function") {
      try {
        focusTarget.setSelectionRange(
          continuity.selection.start,
          continuity.selection.end,
          continuity.selection.direction,
        );
      } catch {
        // Number/select inputs do not expose text selection in every browser.
      }
    }
  } else {
    appRoot.focus({ preventScroll: true });
  }
  globalThis.scrollTo?.(continuity.windowX, continuity.windowY);
}

function render() {
  if (!active || !appRoot) return;
  const continuity = captureRenderContinuity();
  if (state.screen === "loading") appRoot.innerHTML = renderTrainingV6Loading();
  else if (state.screen === "setup") {
    appRoot.innerHTML = renderTrainingV6Setup({
      authReady: state.authReady,
      name: state.name,
      images: state.images,
      allowedExercises: state.allowedExercises,
      maxBpm: state.maxBpm,
      conditionText: state.conditionText,
      busy: state.busy,
      restored: state.restoredDeck,
    });
  } else if (state.screen === "matching") {
    appRoot.innerHTML = renderTrainingV6Matching({
      waitedSeconds: Math.floor((Date.now() - state.matchStartedAt) / 1_000),
      connectionLabel: state.ticket?.state === "matched"
        ? "ルームへ接続中"
        : "安全な相手を検索中",
    });
  } else if (state.screen === "room" && state.clientState.snapshot) {
    appRoot.innerHTML = renderTrainingV6Room(roomViewModel(state));
  } else {
    appRoot.innerHTML = renderTrainingV6Error({
      title: state.error?.title,
      message: state.error?.message,
      updateRequired: state.updateRequired,
      ownerReplaced: state.ownerReplaced,
    });
  }
  bindEvents();
  restoreRenderContinuity(continuity);
}

function bindEvents() {
  document.querySelector("#trainingV6SetupForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    beginMatchmaking().catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6Images")?.addEventListener("change", (event) => {
    chooseImages(event.target.files).catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6Name")?.addEventListener("input", (event) => {
    state.name = event.target.value;
  });
  document.querySelector("#trainingV6MaxBpm")?.addEventListener("change", (event) => {
    state.maxBpm = Number(event.target.value);
  });
  document.querySelector("#trainingV6Condition")?.addEventListener("input", (event) => {
    state.conditionText = event.target.value;
  });
  document.querySelectorAll("input[name='trainingV6Exercise']").forEach((input) => {
    input.addEventListener("change", () => {
      state.allowedExercises = [...document.querySelectorAll(
        "input[name='trainingV6Exercise']:checked",
      )].map((element) => element.value);
    });
  });
  document.querySelector("#trainingV6CancelMatch")?.addEventListener("click", () => {
    cancelWaitingSession(state).catch(handleRecoverableError);
  });
  document.querySelectorAll("[data-training-v6-score]").forEach((button) => {
    button.addEventListener("click", () => {
      submitScore(Number(button.dataset.trainingV6Score)).catch(handleRecoverableError);
    });
  });
  document.querySelector("#trainingV6ExerciseId")?.addEventListener("change", (event) => {
    const preset = PRESET_INSTRUCTIONS[event.target.value] || PRESET_INSTRUCTIONS.custom;
    const custom = document.querySelector(".training-v6-custom-exercise");
    if (custom) custom.hidden = event.target.value !== "custom";
    const exercise = document.querySelector("#trainingV6Exercise");
    const completion = document.querySelector("#trainingV6Completion");
    const command = document.querySelector("#trainingV6Command");
    if (exercise && event.target.value !== "custom") exercise.value = preset.exercise;
    if (completion) completion.value = preset.completion;
    if (command) command.value = preset.command;
  });
  document.querySelector("#trainingV6InstructionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitInstruction().catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6Ready")?.addEventListener("click", () => {
    confirmReady().catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6StartWorkout")?.addEventListener("click", () => {
    startWorkout().catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6CompleteWorkout")?.addEventListener("click", () => {
    completeWorkout().catch(handleRecoverableError);
  });
  document.querySelectorAll("[data-training-v6-message]").forEach((button) => {
    button.addEventListener("click", () => {
      sendCompanionMessage(button.dataset.trainingV6Message).catch(handleRecoverableError);
    });
  });
  document.querySelector("#trainingV6MessageForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#trainingV6MessageText");
    const text = String(input?.value || "").trim();
    if (input) input.value = "";
    if (text) sendCompanionMessage(text).catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6HealthStop")?.addEventListener("click", () => {
    requestHealthStop().catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6Finish")?.addEventListener("click", () => {
    finishAndReturnHome().catch(handleRecoverableError);
  });
  document.querySelector("#trainingV6Reload")?.addEventListener("click", () => {
    location.reload();
  });
  document.querySelector("#trainingV6Retry")?.addEventListener("click", () => {
    const target = state;
    retryInitialization().catch((error) => {
      if (contextIsCurrent(target)) handleFatalError(error);
    });
  });
  document.querySelector("#trainingV6ErrorHome")?.addEventListener("click", () => {
    exitToHome().catch(() => {});
  });
}

async function chooseImages(fileList) {
  const files = [...(fileList || [])].slice(0, 5);
  if (files.length !== 5) {
    showFriendlyToast("画像を5枚まとめて選んでください。");
    return;
  }
  if (typeof shared().processImageFile !== "function") {
    throw new Error("画像変換の準備ができていません。");
  }
  state.busy = true;
  render();
  try {
    const images = [];
    for (let index = 0; index < files.length; index += 1) {
      const processed = await shared().processImageFile(files[index], index, {
        maxSide: 1280,
        quality: 0.82,
      });
      images.push({
        blob: processed.blob,
        url: processed.url,
        index: index + 1,
      });
    }
    releaseImages(state);
    state.images = images;
    state.restoredDeck = false;
  } finally {
    state.busy = false;
    render();
  }
}

function setupProfile() {
  const name = String(state.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
  const conditionText = String(state.conditionText || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const allowedExercises = [...new Set(state.allowedExercises)]
    .filter((id) => Object.hasOwn(EXERCISE_LABELS, id));
  if (!name || state.images.length !== 5 || !allowedExercises.length) {
    throw new Error("名前・画像5枚・受け入れ可能な種目を確認してください。");
  }
  return {
    displayName: name,
    maxBpm: Number(state.maxBpm),
    allowedExercises,
    conditionText,
  };
}

async function beginMatchmaking() {
  if (state.busy || !state.session) return;
  const target = state;
  const profile = setupProfile();
  target.busy = true;
  render();
  try {
    target.name = profile.displayName;
    localStorage.setItem(PROFILE_NAME_KEY, target.name);
    localStorage.setItem(SAFETY_KEY, JSON.stringify({
      allowedExercises: profile.allowedExercises,
      maxBpm: profile.maxBpm,
      conditionText: profile.conditionText,
    }));
    await localStore.save({
      uid: target.uid,
      name: target.name,
      safety: profile,
      images: target.images.map((image) => image.blob),
    });
    if (!contextIsCurrent(target)) return;
    const joined = await sendSessionRequest(target, "join", {
      expectedRevision: 0,
      roomId: null,
      payload: { profile },
    });
    if (!contextIsCurrent(target)) return;
    if (joined.snapshot) {
      await startPublicPresence(target, "playing").catch(() => false);
      await enterRoom(target, joined.response.room || joined.response.snapshot);
      return;
    }
    target.screen = "matching";
    target.matchStartedAt = Date.now();
    target.ticket = { state: "waiting" };
    await startPublicPresence(target, "waiting").catch(() => false);
    startMatchingWatch(target);
  } finally {
    if (contextIsCurrent(target)) {
      target.busy = false;
      render();
    }
  }
}

function startMatchingWatch(target) {
  stopMatchingWatch(target);
  target.ticketUnsubscribe = onValue(
    ref(database, `online/trainingV6/state/tickets/${target.uid}`),
    (snapshot) => {
      if (!contextIsCurrent(target) || target.screen !== "matching") return;
      target.ticket = snapshot.val() || { state: "waiting" };
      if (target.ticket.state === "matched" && target.ticket.roomId) {
        inspectAndEnterRoom(target, target.ticket.roomId).catch(handleRecoverableError);
      }
    },
    () => {
      if (contextIsCurrent(target)) {
        showFriendlyToast("待機状態を再確認しています。");
      }
    },
  );
  target.matchRefreshTimer = window.setInterval(() => {
    if (!contextIsCurrent(target) || target.screen !== "matching" || target.busy) return;
    refreshMatch(target).catch(() => {});
  }, MATCH_REFRESH_MS);
  target.matchTicker = window.setInterval(() => {
    if (contextIsCurrent(target) && target.screen === "matching") render();
  }, 1_000);
}

function stopMatchingWatch(target) {
  target.ticketUnsubscribe?.();
  target.ticketUnsubscribe = null;
  window.clearInterval(target.matchRefreshTimer);
  window.clearInterval(target.matchTicker);
  target.matchRefreshTimer = null;
  target.matchTicker = null;
}

async function refreshMatch(target) {
  const profile = setupProfile();
  const result = await sendSessionRequest(target, "join", {
    expectedRevision: 0,
    roomId: null,
    payload: { profile },
  });
  if (contextIsCurrent(target) && result.snapshot) {
    await enterRoom(target, result.response.room || result.response.snapshot);
  }
}

async function inspectAndEnterRoom(target, roomId) {
  if (target.busy) return;
  target.busy = true;
  try {
    const result = await sendSessionRequest(target, "inspect", {
      expectedRevision: 0,
      roomId,
      payload: {},
    });
    if (contextIsCurrent(target) && result.snapshot) {
      await enterRoom(target, result.response.room || result.response.snapshot);
    }
  } finally {
    target.busy = false;
  }
}

async function cancelWaitingSession(target) {
  stopMatchingWatch(target);
  await sendSessionRequest(target, "leave", {
    expectedRevision: 0,
    roomId: null,
    payload: {},
  }).catch(() => {});
  if (!contextIsCurrent(target)) return;
  target.ticket = null;
  await cleanupPublicPresence(target).catch(() => {});
  target.screen = "setup";
  render();
}

async function sendSessionRequest(target, action, options, {
  actionId = createToken(),
  retryUnknown = true,
} = {}) {
  try {
    const response = await target.session.request(action, { ...options, actionId });
    captureSessionResponse(target, response);
    return response;
  } catch (error) {
    const code = String(error?.code || "");
    if (retryUnknown && /unavailable|deadline-exceeded|internal/.test(code)) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (!contextIsCurrent(target)) throw error;
      const response = await target.session.request(action, { ...options, actionId });
      captureSessionResponse(target, response);
      return response;
    }
    throw error;
  }
}

function captureSessionResponse(target, dispatched) {
  const response = dispatched?.response;
  const roundNumber = Number(
    response?.room?.roundNumber
    || response?.snapshot?.roundNumber
    || target.clientState.snapshot?.roundNumber,
  );
  const ownScore = Number(response?.ownScore);
  if (roundNumber >= 1 && roundNumber <= 5 && ownScore >= 1 && ownScore <= 10) {
    target.ownScores[roundNumber] = ownScore;
  }
}

function applyServerRoom(target, rawRoom) {
  if (!rawRoom || typeof rawRoom !== "object") return false;
  if (target.transportClaimed
      && !["complete", "no_contest"].includes(rawRoom.phase)
      && rawRoom.connections?.[target.uid]?.connectionId
        !== target.connectionId) {
    handleOwnerReplacement(target);
    return false;
  }
  target.rawRoom = rawRoom;
  const canonicalInput = {
    ...rawRoom,
    rounds: rawRoom.rounds || {},
    workoutQueue: Array.isArray(rawRoom.workoutQueue)
      ? rawRoom.workoutQueue
      : rawRoom.workoutQueue && typeof rawRoom.workoutQueue === "object"
        ? Object.keys(rawRoom.workoutQueue)
          .sort((left, right) => Number(left) - Number(right))
          .map((key) => rawRoom.workoutQueue[key])
        : [],
  };
  const transition = transitionTrainingV6ClientState(target.clientState, {
    type: "SERVER_SNAPSHOT",
    snapshot: canonicalInput,
  });
  if (transition.accepted) {
    target.clientState = transition.state;
    return true;
  }
  return ["snapshot-duplicate", "snapshot-revision-conflict"].includes(transition.reason);
}

async function enterRoom(target, rawRoom) {
  if (!contextIsCurrent(target) || !applyServerRoom(target, rawRoom)) {
    throw new Error("鍛え合い60 V6のルーム情報を確認できませんでした。");
  }
  const terminal = ["complete", "no_contest"].includes(
    target.clientState.snapshot?.phase,
  );
  stopMatchingWatch(target);
  target.screen = "room";
  target.matchStartedAt = 0;
  subscribeServerOffset(target);
  subscribeRoom(target);
  if (terminal) {
    await cleanupPublicPresence(target).catch(() => {});
    setTrainingChrome("鍛え合い V6 COMPLETE");
    render();
    syncRoomRuntime(target);
    return;
  }
  const connecting = transitionTrainingV6ClientState(target.clientState, {
    type: "TRANSPORT_INTERRUPTED",
    reason: "p2p-connecting",
  });
  if (connecting.accepted) target.clientState = connecting.state;
  if (target.publicPresenceId) {
    await updatePublicPresence(target, "playing").catch(() => false);
  } else {
    await startPublicPresence(target, "playing").catch(() => false);
  }
  await localStore.updateBinding(target.uid, {
    roomId: target.clientState.snapshot.roomId,
    ticketId: String(target.ticket?.ticketId || ""),
  }).catch(() => {});
  await claimTransport(target);
  if (!contextIsCurrent(target)) return;
  setTrainingChrome("鍛え合い V6 ACTIVE");
  render();
  syncRoomRuntime(target);
}

function subscribeServerOffset(target) {
  target.offsetUnsubscribe?.();
  target.offsetUnsubscribe = onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    if (contextIsCurrent(target)) target.serverTimeOffset = Number(snapshot.val()) || 0;
  });
}

function subscribeRoom(target) {
  target.roomUnsubscribe?.();
  const roomId = target.clientState.snapshot?.roomId;
  if (!roomId) return;
  target.roomUnsubscribe = onValue(
    ref(database, `online/trainingV6/state/rooms/${roomId}`),
    (snapshot) => {
      if (!contextIsCurrent(target)
          || target.clientState.snapshot?.roomId !== roomId) return;
      const rawRoom = snapshot.val();
      if (!rawRoom) {
        recoverRoomSubscription(target, "room-missing");
        return;
      }
      target.roomRetryIndex = 0;
      applyServerRoom(target, rawRoom);
      render();
      syncRoomRuntime(target);
    },
    () => {
      if (contextIsCurrent(target)) recoverRoomSubscription(target, "room-read-paused");
    },
  );
}

function recoverRoomSubscription(target, reason) {
  if (!contextIsCurrent(target) || target.leaving) return;
  const interruption = transitionTrainingV6ClientState(target.clientState, {
    type: "TRANSPORT_INTERRUPTED",
    reason,
  });
  if (interruption.accepted) target.clientState = interruption.state;
  render();
  window.clearTimeout(target.roomRetryTimer);
  const delay = ROOM_RETRY_DELAYS_MS[
    Math.min(target.roomRetryIndex, ROOM_RETRY_DELAYS_MS.length - 1)
  ];
  target.roomRetryIndex += 1;
  target.roomRetryTimer = window.setTimeout(async () => {
    if (!contextIsCurrent(target)) return;
    try {
      const inspected = await sendSessionRequest(target, "inspect", {
        expectedRevision: 0,
        roomId: target.clientState.snapshot?.roomId || null,
        payload: {},
      });
      if (!contextIsCurrent(target) || !inspected.snapshot) return;
      applyServerRoom(target, inspected.response.room || inspected.response.snapshot);
      subscribeRoom(target);
      const restored = transitionTrainingV6ClientState(target.clientState, {
        type: "TRANSPORT_RESTORED",
      });
      if (restored.accepted) target.clientState = restored.state;
      render();
      syncRoomRuntime(target);
    } catch {
      recoverRoomSubscription(target, reason);
    }
  }, delay);
}

async function claimTransport(target) {
  const snapshot = target.clientState.snapshot;
  if (!snapshot || !contextIsCurrent(target)) return;
  const connectionId = createToken();
  target.transportClaimed = false;
  target.connectionId = connectionId;
  const response = await sendSessionRequest(target, "claim_transport", {
    roomId: snapshot.roomId,
    expectedRevision: 0,
    payload: { connectionId },
  });
  if (!contextIsCurrent(target)) return;
  target.transportClaimed = true;
  const raw = response.response.room || response.response.snapshot;
  if (raw) {
    target.rawRoom = raw;
    applyServerRoom(target, raw);
  }
  await establishPresence(target);
  if (contextIsCurrent(target)) {
    render();
    syncRoomRuntime(target);
  }
}

function handleOwnerReplacement(target) {
  if (!contextIsCurrent(target) || target.ownerReplaced) return;
  target.ownerReplaced = true;
  target.p2p?.stop();
  target.p2p = null;
  target.p2pSignature = "";
  target.localSendSignature = "";
  window.clearTimeout(target.p2pRetryTimer);
  target.p2pRetryTimer = null;
  target.workoutClock.stop();
  target.metronome.stop();
  target.wakeLock.release();
  target.presenceDisconnect?.cancel?.().catch(() => {});
  const roomId = target.clientState.snapshot?.roomId;
  if (roomId && target.uid) {
    remove(ref(
      database,
      `online/trainingV6/presence/${roomId}/${target.uid}`,
    )).catch(() => {});
  }
  showFatal(
    "別の端末で鍛え合い60が再開されました",
    "この画面からは進行を変更しません。再開した端末でそのまま続けてください。",
  );
}

async function establishPresence(target) {
  const roomId = target.clientState.snapshot?.roomId;
  if (!roomId) return;
  const presenceRef = ref(database, `online/trainingV6/presence/${roomId}/${target.uid}`);
  await target.presenceDisconnect?.cancel?.().catch(() => {});
  target.presenceDisconnect = onDisconnect(presenceRef);
  await target.presenceDisconnect.set({
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    connectionId: target.connectionId,
    online: false,
    updatedAt: serverTimestamp(),
  });
  await set(presenceRef, {
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    connectionId: target.connectionId,
    online: true,
    updatedAt: serverTimestamp(),
  });
}

async function startPublicPresence(target, presenceState) {
  await cleanupPublicPresence(target);
  if (!contextIsCurrent(target) || !target.uid) return false;
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) return false;
  target.publicPresenceId = presenceId;
  target.publicPresenceState = presenceState === "playing" ? "playing" : "waiting";
  const ownerRef = ref(database, `online/publicPresenceOwners/${presenceId}`);
  const presenceRef = ref(database, `online/publicPresence/${presenceId}`);
  await set(ownerRef, target.uid);
  if (!contextIsCurrent(target)) {
    await cleanupPublicPresence(target);
    return false;
  }
  target.publicPresenceOwnerDisconnect = onDisconnect(ownerRef);
  await target.publicPresenceOwnerDisconnect.remove();
  await writePublicPresence(target);
  if (!contextIsCurrent(target)) {
    await cleanupPublicPresence(target);
    return false;
  }
  target.publicPresenceDisconnect = onDisconnect(presenceRef);
  await target.publicPresenceDisconnect.remove();
  target.publicPresenceHeartbeat = window.setInterval(() => {
    if (contextIsCurrent(target)) writePublicPresence(target).catch(() => {});
  }, PUBLIC_PRESENCE_HEARTBEAT_MS);
  return true;
}

async function writePublicPresence(target) {
  if (!target.publicPresenceId || !contextIsCurrent(target)) return;
  await set(ref(database, `online/publicPresence/${target.publicPresenceId}`), {
    mode: "training",
    state: target.publicPresenceState || "waiting",
    lastSeen: firebaseNow(target),
  });
}

async function updatePublicPresence(target, presenceState) {
  if (!target.publicPresenceId || !contextIsCurrent(target)) return false;
  target.publicPresenceState = presenceState === "playing" ? "playing" : "waiting";
  await writePublicPresence(target);
  return true;
}

async function cleanupPublicPresence(target) {
  window.clearInterval(target.publicPresenceHeartbeat);
  target.publicPresenceHeartbeat = null;
  const presenceId = target.publicPresenceId;
  const presenceDisconnect = target.publicPresenceDisconnect;
  const ownerDisconnect = target.publicPresenceOwnerDisconnect;
  target.publicPresenceId = "";
  target.publicPresenceState = "";
  target.publicPresenceDisconnect = null;
  target.publicPresenceOwnerDisconnect = null;
  await Promise.allSettled([
    presenceDisconnect?.cancel?.(),
    ownerDisconnect?.cancel?.(),
  ]);
  if (!presenceId || !target.uid) return;
  await Promise.allSettled([
    remove(ref(database, `online/publicPresence/${presenceId}`)),
    remove(ref(database, `online/publicPresenceOwners/${presenceId}`)),
  ]);
}

function firebaseNow(target = state) {
  return Date.now() + Number(target.serverTimeOffset || 0);
}

function roomParticipants(target = state) {
  return trainingV6ParticipantUidsFromMemberOrder(target.rawRoom?.memberOrder);
}

function opponentUid(target = state) {
  return roomParticipants(target).find((uid) => uid !== target.uid) || "";
}

function roomRound(target = state) {
  const number = Number(target.clientState.snapshot?.roundNumber || 1);
  return target.clientState.snapshot?.rounds?.[number]
    || target.clientState.snapshot?.rounds?.[String(number)]
    || {};
}

function currentWorkout(target = state) {
  const snapshot = target.clientState.snapshot;
  const index = Number(snapshot?.activeWorkoutIndex);
  return Number.isInteger(index) && index >= 0
    ? snapshot.workoutQueue?.[index] || null
    : null;
}

function roomViewModel(target) {
  const snapshot = target.clientState.snapshot;
  const remoteUid = opponentUid(target);
  const ownProfile = target.rawRoom?.players?.[target.uid]?.profile || {};
  const remoteProfile = target.rawRoom?.players?.[remoteUid]?.profile || {};
  const round = roomRound(target);
  const ownScore = Number(round.scores?.[target.uid]?.value || 0)
    || Number(round.scores?.[target.uid] || 0)
    || Number(target.ownScores[snapshot.roundNumber] || 0);
  const workout = currentWorkout(target);
  const isTrainer = workout?.trainerUid === target.uid;
  const isVictim = workout?.victimUid === target.uid;
  const remoteImage = target.remoteImages[snapshot.roundNumber] || null;
  return {
    snapshot,
    transportState: target.clientState.transportState,
    ownName: ownProfile.displayName || target.name,
    opponentName: remoteProfile.displayName || "PARTNER",
    localImageAcknowledged: target.localImageAcknowledged.has(snapshot.roundNumber),
    remoteImage,
    ownScore,
    isTrainer,
    isVictim,
    victimProfile: target.rawRoom?.players?.[workout?.victimUid]?.profile || {},
    instruction: snapshot.instruction,
    workout: snapshot.workout,
    messages: target.messages,
    remainingMs: target.workoutProgress.remainingMs,
    progress: target.workoutProgress.progress,
    workoutComplete: target.workoutProgress.complete,
  };
}

function syncRoomRuntime(target) {
  if (!contextIsCurrent(target) || !target.clientState.snapshot) return;
  const phase = target.clientState.snapshot.phase;
  const workoutId = currentWorkout(target)?.workoutId || "";
  if (target.messageWorkoutId !== workoutId) {
    target.messageWorkoutId = workoutId;
    target.messages = [];
    target.messageIds.clear();
  }
  if (["complete", "no_contest"].includes(phase)) {
    cleanupPublicPresence(target).catch(() => {});
    target.p2p?.stop();
    target.p2p = null;
    target.p2pSignature = "";
    target.localSendSignature = "";
    window.clearTimeout(target.p2pRetryTimer);
    target.p2pRetryTimer = null;
  }
  if (!["complete", "no_contest"].includes(phase)) {
    ensureP2p(target).catch(() => scheduleP2pRetry(target));
  }
  if (["media_exchange", "scoring"].includes(phase)) {
    ensureRoundImageExchange(target).catch(handleRecoverableError);
  }
  syncWorkoutRuntime(target);
}

async function ensureP2p(target) {
  const room = target.rawRoom;
  const remoteUid = opponentUid(target);
  const ownConnection = room?.connections?.[target.uid]?.connectionId;
  const remoteConnection = room?.connections?.[remoteUid]?.connectionId;
  if (!remoteUid || ownConnection !== target.connectionId || !remoteConnection) return;
  const signature = `${room.roomId}:${ownConnection}:${remoteConnection}`;
  if (target.p2pSignature === signature && target.p2p) return;
  target.p2p?.stop();
  target.p2p = null;
  target.p2pSignature = signature;
  target.localSendSignature = "";
  let iceServers = FALLBACK_ICE_SERVERS.map((item) => ({ ...item }));
  try {
    const configuration = await window.HariaiOnline?.getP2pIceConfiguration?.();
    if (Array.isArray(configuration?.iceServers) && configuration.iceServers.length) {
      iceServers = configuration.iceServers;
    }
  } catch {
    // STUN fallback keeps local/network-compatible sessions available.
  }
  if (!contextIsCurrent(target) || target.p2pSignature !== signature) return;
  const controller = createTrainingV6P2PController({
    roomId: room.roomId,
    ownUid: target.uid,
    remoteUid,
    ownConnectionId: ownConnection,
    remoteConnectionId: remoteConnection,
    initiator: roomParticipants(target)[0] === target.uid,
    iceServers,
    signalTransport: trainingSignalTransport(target, remoteUid),
    now: () => firebaseNow(target),
    onStatus: ({ status }) => {
      if (!contextIsCurrent(target) || target.p2p !== controller) return;
      const event = status === "connected"
        ? { type: "TRANSPORT_RESTORED" }
        : status === "recovering"
          ? { type: "TRANSPORT_INTERRUPTED", reason: "p2p-reconnecting" }
          : null;
      if (event) {
        const transition = transitionTrainingV6ClientState(target.clientState, event);
        if (transition.accepted) target.clientState = transition.state;
      }
      if (status === "connected") {
        window.clearTimeout(target.p2pRetryTimer);
        target.p2pRetryTimer = null;
        render();
        ensureRoundImageExchange(target).catch(handleRecoverableError);
      } else if (status === "recovering") {
        render();
        scheduleP2pRetry(target);
      }
    },
    onImage: (image) => receiveRoundImage(target, image),
    onCompanionMessage: (message) => receiveCompanionMessage(target, message),
    onError: () => {
      if (contextIsCurrent(target)) scheduleP2pRetry(target);
    },
  });
  target.p2p = controller;
  await controller.start();
}

function trainingSignalTransport(target, remoteUid) {
  const roomId = target.clientState.snapshot.roomId;
  return Object.freeze({
    send: async (signal) => {
      const signalId = push(ref(
        database,
        `online/trainingV6/signals/${roomId}/${remoteUid}/${target.uid}`,
      )).key;
      if (!signalId) throw new Error("P2P接続情報を作成できませんでした。");
      await set(
        ref(
          database,
          `online/trainingV6/signals/${roomId}/${remoteUid}/${target.uid}/${signalId}`,
        ),
        {
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          fromConnectionId: signal.fromConnectionId,
          toConnectionId: signal.toConnectionId,
          fromUid: target.uid,
          toUid: remoteUid,
          type: signal.type,
          ...(signal.type === "candidate" ? {
            candidate: signal.candidate,
            sdpMid: signal.sdpMid,
            sdpMLineIndex: signal.sdpMLineIndex,
          } : {
            sdp: signal.sdp,
          }),
          createdAt: serverTimestamp(),
        },
      );
    },
    subscribe: (handler) => onChildAdded(
      ref(
        database,
        `online/trainingV6/signals/${roomId}/${target.uid}/${remoteUid}`,
      ),
      (snapshot) => {
        handler({
          id: snapshot.key,
          value: {
            roomId,
            ...snapshot.val(),
          },
          consume: () => remove(snapshot.ref),
        });
      },
      () => {
        if (contextIsCurrent(target)) scheduleP2pRetry(target);
      },
    ),
  });
}

function scheduleP2pRetry(target) {
  if (!contextIsCurrent(target)
      || ["complete", "no_contest"].includes(target.clientState.snapshot?.phase)) return;
  const interruption = transitionTrainingV6ClientState(target.clientState, {
    type: "TRANSPORT_INTERRUPTED",
    reason: "p2p-reconnecting",
  });
  if (interruption.accepted) target.clientState = interruption.state;
  window.clearTimeout(target.p2pRetryTimer);
  target.p2pRetryTimer = window.setTimeout(async () => {
    if (!contextIsCurrent(target)) return;
    target.p2p?.stop();
    target.p2p = null;
    target.p2pSignature = "";
    try {
      await claimTransport(target);
      await ensureP2p(target);
    } catch {
      scheduleP2pRetry(target);
    }
  }, P2P_RETRY_DELAY_MS);
}

function usedImageNumbers(target) {
  const result = new Set();
  for (const round of Object.values(target.clientState.snapshot?.rounds || {})) {
    const number = Number(round?.images?.[target.uid]?.imageNumber);
    if (number >= 1 && number <= 5) result.add(number);
  }
  return result;
}

function localRoundSelection(target, roundNumber) {
  const serverNumber = Number(roomRound(target)?.images?.[target.uid]?.imageNumber);
  if (serverNumber >= 1 && serverNumber <= 5) {
    target.roundSelections[roundNumber] = serverNumber;
    return serverNumber;
  }
  if (target.roundSelections[roundNumber]) return target.roundSelections[roundNumber];
  const choices = [1, 2, 3, 4, 5].filter((number) => !usedImageNumbers(target).has(number));
  const choice = choices[Math.floor(Math.random() * choices.length)] || choices[0];
  target.roundSelections[roundNumber] = choice;
  return choice;
}

async function ensureRoundImageExchange(target) {
  const snapshot = target.clientState.snapshot;
  if (!snapshot
      || !["media_exchange", "scoring"].includes(snapshot.phase)
      || !target.p2p?.isConnected()
      || target.missingDeck) return;
  const roundNumber = snapshot.roundNumber;
  const imageNumber = localRoundSelection(target, roundNumber);
  const image = target.images[imageNumber - 1];
  if (!image?.blob) {
    target.missingDeck = true;
    showFriendlyToast("この端末の画像デッキを復元できません。安全終了を選べます。");
    render();
    return;
  }
  const sendSignature = `${target.p2pSignature}:${roundNumber}:${imageNumber}`;
  if (target.localSendSignature === sendSignature) return;
  target.localSendSignature = sendSignature;
  try {
    await target.p2p.sendImage({
      blob: image.blob,
      roundNumber,
      imageIndex: imageNumber,
    });
    if (!contextIsCurrent(target)
        || target.clientState.snapshot?.roundNumber !== roundNumber) return;
    target.localImageAcknowledged.add(roundNumber);
    render();
    await maybeConfirmImageReady(target, roundNumber, imageNumber);
  } catch (error) {
    if (contextIsCurrent(target) && target.localSendSignature === sendSignature) {
      target.localSendSignature = "";
      scheduleP2pRetry(target);
    }
    throw error;
  }
}

async function receiveRoundImage(target, image) {
  if (!contextIsCurrent(target)) return;
  const roundNumber = Number(image.roundNumber);
  if (roundNumber !== target.clientState.snapshot?.roundNumber) return;
  const previous = target.remoteImages[roundNumber];
  if (previous?.url) URL.revokeObjectURL(previous.url);
  target.remoteImages[roundNumber] = {
    ...image,
    url: URL.createObjectURL(image.blob),
  };
  render();
  const imageNumber = localRoundSelection(target, roundNumber);
  await maybeConfirmImageReady(target, roundNumber, imageNumber);
}

async function maybeConfirmImageReady(target, roundNumber, imageNumber) {
  if (!target.localImageAcknowledged.has(roundNumber)
      || !target.remoteImages[roundNumber]
      || target.imageReadyBusy.has(roundNumber)) return;
  const round = roomRound(target);
  if (round.images?.[target.uid]) return;
  target.imageReadyBusy.add(roundNumber);
  try {
    await performRoomAction(target, "image_ready", {
      roundNumber,
      imageNumber,
    });
  } finally {
    target.imageReadyBusy.delete(roundNumber);
  }
}

async function submitScore(score) {
  const target = state;
  if (!target.remoteImages[target.clientState.snapshot?.roundNumber]) {
    showFriendlyToast("相手画像の再受信が完了するまでお待ちください。");
    return;
  }
  const roundNumber = target.clientState.snapshot.roundNumber;
  const response = await performRoomAction(target, "score", {
    roundNumber,
    score,
  });
  if (response?.response?.ownScore) {
    target.ownScores[roundNumber] = Number(response.response.ownScore);
    render();
  }
}

async function submitInstruction() {
  const target = state;
  const workout = currentWorkout(target);
  if (!workout || workout.trainerUid !== target.uid) return;
  if (!target.p2p?.isConnected()) {
    showFriendlyToast("最初の応援を相手へ届けられるまで、指示の確定を待ちます。");
    return;
  }
  const initialCheer = String(
    document.querySelector("#trainingV6InitialCheer")?.value || "",
  ).trim().slice(0, 40);
  const exerciseId = document.querySelector("#trainingV6ExerciseId")?.value || "";
  const preset = PRESET_INSTRUCTIONS[exerciseId] || PRESET_INSTRUCTIONS.custom;
  const exercise = exerciseId === "custom"
    ? document.querySelector("#trainingV6Exercise")?.value
    : preset.exercise;
  if (initialCheer
      && !target.initialCheerWorkoutIds.has(workout.workoutId)) {
    const delivered = await sendCompanionMessage(initialCheer);
    if (!delivered) {
      showFriendlyToast("最初の応援を再送しています。接続後にもう一度お試しください。");
      return;
    }
    target.initialCheerWorkoutIds.add(workout.workoutId);
  }
  await performRoomAction(target, "instruction", {
    workoutIndex: target.clientState.snapshot.activeWorkoutIndex,
    exerciseId,
    exercise: String(exercise || "").trim(),
    completion: String(document.querySelector("#trainingV6Completion")?.value || "").trim(),
    command: String(document.querySelector("#trainingV6Command")?.value || "").trim(),
    bpm: Number(document.querySelector("#trainingV6Bpm")?.value),
    beatsPerRep: Number(document.querySelector("#trainingV6Beats")?.value),
  });
}

async function confirmReady() {
  if (!state.p2p?.isConnected()) {
    showFriendlyToast("伴走相手との応援通信を再接続してから確認します。");
    return;
  }
  await performRoomAction(state, "ready", {
    workoutIndex: state.clientState.snapshot.activeWorkoutIndex,
  });
}

async function startWorkout() {
  const target = state;
  if (!target.p2p?.isConnected()) {
    showFriendlyToast("伴走相手との応援通信を再接続してから開始します。");
    return;
  }
  const bpm = Number(target.clientState.snapshot?.instruction?.bpm);
  const beatsPerRep = Number(
    target.clientState.snapshot?.instruction?.beatsPerRep,
  );
  await target.metronome.start(bpm, beatsPerRep).catch(() => false);
  await target.wakeLock.acquire();
  try {
    await performRoomAction(target, "workout_started", {
      workoutIndex: target.clientState.snapshot.activeWorkoutIndex,
    });
  } catch (error) {
    target.metronome.stop();
    await target.wakeLock.release();
    throw error;
  }
}

async function completeWorkout() {
  if (!state.workoutProgress.complete) {
    showFriendlyToast("60秒の終了後に完遂を確定できます。");
    return;
  }
  await performRoomAction(state, "workout_completed", {
    workoutIndex: state.clientState.snapshot.activeWorkoutIndex,
  });
}

async function performRoomAction(target, action, payload) {
  if (!contextIsCurrent(target)) return null;
  const safetyStop = action === "no_contest";
  if (safetyStop ? target.safetyStopBusy : target.roomActionBusy) return null;
  if (safetyStop) target.safetyStopBusy = true;
  else target.roomActionBusy = true;
  const actionId = createToken();
  const actionPayload = action === "finish"
    ? { ...payload }
    : { ...payload, connectionId: target.connectionId };
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = target.clientState.snapshot;
      if (!snapshot) return null;
      try {
        const response = await sendSessionRequest(target, action, {
          roomId: snapshot.roomId,
          expectedRevision: snapshot.revision,
          payload: actionPayload,
        }, { actionId });
        if (!contextIsCurrent(target)) return response;
        const raw = response.response.room || response.response.snapshot;
        if (raw) {
          applyServerRoom(target, raw);
          render();
          syncRoomRuntime(target);
        }
        return response;
      } catch (error) {
        const reason = String(
          error?.details?.reason
          || error?.customData?.details?.reason
          || "",
        );
        if (reason === "owner-replaced") {
          handleOwnerReplacement(target);
          return null;
        }
        const unknownOutcome = requestOutcomeIsUnknown(error);
        const canReconcile = reason === "revision-conflict"
          || reason === "already-applied"
          || unknownOutcome;
        if (!canReconcile) throw error;
        await refreshCanonicalRoom(target);
        if (!contextIsCurrent(target)
            || target.clientState.snapshot?.roomId !== snapshot.roomId) {
          return null;
        }
        if (roomActionIsReflected(target, action, actionPayload)) {
          return {
            response: {
              outcome: target.clientState.snapshot.phase,
              room: target.rawRoom,
              snapshot: target.rawRoom,
              ...(action === "score"
                ? { ownScore: target.ownScores[actionPayload.roundNumber] }
                : {}),
            },
            snapshot: target.clientState.snapshot,
          };
        }
        if (attempt >= 2) throw error;
      }
    }
    return null;
  } finally {
    if (safetyStop) target.safetyStopBusy = false;
    else target.roomActionBusy = false;
  }
}

async function refreshCanonicalRoom(target) {
  const roomId = target.clientState.snapshot?.roomId;
  if (!roomId) return null;
  const inspected = await sendSessionRequest(target, "inspect", {
    expectedRevision: 0,
    roomId,
    payload: {},
  });
  const raw = inspected.response.room || inspected.response.snapshot;
  if (raw && contextIsCurrent(target)) {
    applyServerRoom(target, raw);
    render();
    syncRoomRuntime(target);
  }
  return inspected;
}

function requestOutcomeIsUnknown(error) {
  return /unavailable|deadline-exceeded|internal/.test(String(error?.code || ""));
}

function roomActionIsReflected(target, action, payload) {
  const snapshot = target.clientState.snapshot;
  const rawRoom = target.rawRoom;
  if (!snapshot || !rawRoom) return false;
  const round = rawRoom.rounds?.[payload.roundNumber]
    || rawRoom.rounds?.[String(payload.roundNumber)]
    || {};
  const workout = rawRoom.workoutQueue?.[payload.workoutIndex]
    || rawRoom.workoutQueue?.[String(payload.workoutIndex)]
    || {};
  if (action === "image_ready") return Boolean(round.images?.[target.uid]);
  if (action === "score") {
    return Number(target.ownScores[payload.roundNumber]) >= 1
      || Number(round.scores?.[target.uid]?.value || round.scores?.[target.uid]) >= 1;
  }
  if (action === "instruction") {
    return Boolean(workout.instruction)
      || (snapshot.phase !== "instruction"
        && Number(snapshot.activeWorkoutIndex) === payload.workoutIndex);
  }
  if (action === "ready") {
    return Number(workout.readyAt) > 0
      || ["workout", "complete", "no_contest"].includes(snapshot.phase);
  }
  if (action === "workout_started") {
    return Number(workout.startedAt || rawRoom.workout?.startedAt) > 0;
  }
  if (action === "workout_completed") {
    return Number(workout.completedAt) > 0
      || ["complete", "no_contest"].includes(snapshot.phase)
      || Number(snapshot.activeWorkoutIndex) > payload.workoutIndex;
  }
  if (action === "no_contest") return snapshot.phase === "no_contest";
  return false;
}

function syncWorkoutRuntime(target) {
  const snapshot = target.clientState.snapshot;
  const workout = snapshot?.workout;
  const signature = snapshot?.phase === "workout" && Number(workout?.startedAt) > 0
    ? `${snapshot.roomId}:${snapshot.activeWorkoutIndex}:${workout.startedAt}`
    : "";
  if (target.workoutClockSignature === signature) return;
  target.workoutClockSignature = signature;
  target.workoutClock.stop();
  target.metronome.stop();
  target.wakeLock.release();
  target.workoutProgress = {
    remainingMs: 60_000,
    progress: 0,
    complete: false,
  };
  if (!signature) return;
  const endsAt = Number(workout.endsAt)
    || Number(workout.startedAt) + 60_000;
  target.workoutClock.start({
    startedAt: Number(workout.startedAt),
    endsAt,
  });
  const current = currentWorkout(target);
  target.wakeLock.acquire();
  if (current?.victimUid === target.uid) {
    target.metronome.start(
      Number(snapshot.instruction?.bpm),
      Number(snapshot.instruction?.beatsPerRep),
    ).catch(() => false);
  }
}

function updateWorkoutTimerDom(target) {
  const seconds = document.querySelector("#trainingV6Seconds");
  const progress = document.querySelector("#trainingV6Progress");
  if (seconds) seconds.textContent = String(
    Math.max(0, Math.ceil(target.workoutProgress.remainingMs / 1_000)),
  );
  if (progress) progress.style.width = `${Math.round(target.workoutProgress.progress * 100)}%`;
  if (target.workoutProgress.complete
      && currentWorkout(target)?.victimUid === target.uid
      && !document.querySelector("#trainingV6CompleteWorkout")) {
    render();
  }
}

async function sendCompanionMessage(text) {
  const target = state;
  const workout = currentWorkout(target);
  if (!workout || !target.p2p?.isConnected()) {
    showFriendlyToast("応援通信を再接続しています。");
    return false;
  }
  const event = createTrainingV6P2PEvent({
    kind: workout.trainerUid === target.uid ? "cheer" : "reaction",
    eventId: createToken(),
    roomId: target.clientState.snapshot.roomId,
    roundNumber: target.clientState.snapshot.roundNumber,
    workoutId: workout.workoutId,
    fromUid: target.uid,
    toUid: opponentUid(target),
    text: String(text || "").trim().slice(0, 40),
    createdAt: firebaseNow(target),
  });
  addCompanionMessage(target, event, true, true);
  render();
  const acknowledged = await target.p2p.sendCompanionMessage(event);
  const message = target.messages.find((item) => item.eventId === event.eventId);
  if (message) message.pending = !acknowledged;
  render();
  return acknowledged === true;
}

function receiveCompanionMessage(target, message) {
  if (!contextIsCurrent(target)) return;
  const workout = currentWorkout(target);
  if (!workout
      || message.roundNumber !== target.clientState.snapshot?.roundNumber
      || message.workoutId !== workout.workoutId) return;
  const transition = transitionTrainingV6ClientState(target.clientState, {
    type: "P2P_EVENT",
    message,
  });
  if (!transition.accepted) return;
  addCompanionMessage(target, message, false, false);
  render();
}

function addCompanionMessage(target, message, own, pending) {
  if (target.messageIds.has(message.eventId)) return;
  target.messageIds.add(message.eventId);
  target.messages.push({
    eventId: message.eventId,
    kind: message.kind,
    text: message.text,
    own,
    pending,
  });
  while (target.messages.length > 20) {
    const removed = target.messages.shift();
    target.messageIds.delete(removed.eventId);
  }
}

async function requestHealthStop() {
  if (!window.confirm("体調と安全を優先してNO CONTESTで終了しますか？")) return;
  await performRoomAction(state, "no_contest", {
    reason: "health",
    note: "",
  });
}

async function finishAndReturnHome() {
  const target = state;
  const snapshot = target.clientState.snapshot;
  if (snapshot && ["complete", "no_contest"].includes(snapshot.phase)) {
    await sendSessionRequest(target, "finish", {
      roomId: snapshot.roomId,
      expectedRevision: snapshot.revision,
      payload: {},
    }).catch(() => {});
  }
  await localStore.remove(target.uid).catch(() => {});
  await exitToHome();
}

function requestHome() {
  const phase = state.clientState.snapshot?.phase;
  if (phase && !["complete", "no_contest"].includes(phase)) {
    destroyDialog?.showModal?.();
    return;
  }
  if (["complete", "no_contest"].includes(phase)) {
    finishAndReturnHome().catch(() => exitToHome().catch(() => {}));
    return;
  }
  exitToHome().catch(() => {});
}

async function destroyRoom() {
  const phase = state.clientState.snapshot?.phase;
  if (["complete", "no_contest"].includes(phase)) {
    await finishAndReturnHome();
    return;
  }
  if (!phase) {
    await exitToHome();
    return;
  }
  await performRoomAction(state, "no_contest", {
    reason: "other",
    note: "player requested safe exit",
  });
}

function isActive() {
  return active;
}

async function exitToHome() {
  const target = state;
  if (!active) return;
  active = false;
  target.leaving = true;
  stopMatchingWatch(target);
  target.roomUnsubscribe?.();
  target.offsetUnsubscribe?.();
  window.clearTimeout(target.roomRetryTimer);
  window.clearTimeout(target.p2pRetryTimer);
  target.p2p?.stop();
  target.workoutClock.stop();
  await target.metronome.destroy();
  await target.wakeLock.destroy();
  target.presenceDisconnect?.cancel?.().catch(() => {});
  await cleanupPublicPresence(target).catch(() => {});
  const roomId = target.clientState.snapshot?.roomId;
  if (roomId && target.uid) {
    await remove(ref(database, `online/trainingV6/presence/${roomId}/${target.uid}`))
      .catch(() => {});
  }
  releaseImages(target);
  releaseTabLock?.();
  setTrainingChrome("オンライン待機中");
  window.HariaiApp?.returnHome?.();
}

function releaseImages(target) {
  for (const image of target.images || []) {
    if (image?.url) URL.revokeObjectURL(image.url);
  }
  for (const image of Object.values(target.remoteImages || {})) {
    if (image?.url) URL.revokeObjectURL(image.url);
  }
  target.images = [];
  target.remoteImages = {};
}

function handleRecoverableError(error) {
  const code = String(error?.code || "");
  if (/permission-denied/.test(code)) {
    showFriendlyToast("参加状態を安全に再確認しています。");
    refreshCanonicalRoom(state).catch(() => recoverRoomSubscription(state, "permission-paused"));
    return;
  }
  if (/unavailable|deadline-exceeded|internal/.test(code)) {
    showFriendlyToast("通信を再確認しています。進行は保持されています。");
    return;
  }
  if (/invalid-argument/.test(code)) {
    showFriendlyToast("入力内容を確認してください。");
    return;
  }
  const message = String(error?.message || "");
  if (message && !/permission|firebase|internal/i.test(message)) {
    showFriendlyToast(message);
  } else {
    showFriendlyToast("通信状態を確認しています。");
  }
}

function handleFatalError(error) {
  const code = String(error?.code || "");
  if (/permission-denied|unavailable|deadline-exceeded/.test(code)
      && state.clientState.snapshot) {
    recoverRoomSubscription(state, "canonical-check");
    return;
  }
  showFatal(
    "鍛え合い60を開始できませんでした",
    "通信状態を確認して、設定画面からもう一度お試しください。",
  );
}

function showFatal(title, message, updateRequired = false) {
  state.error = { title, message };
  state.updateRequired = updateRequired;
  state.screen = "error";
  render();
}

window.addEventListener("online", () => {
  if (!active || !state.clientState.snapshot) return;
  refreshCanonicalRoom(state)
    .then(() => claimTransport(state))
    .catch(() => recoverRoomSubscription(state, "network-resume"));
});

window.addEventListener("offline", () => {
  if (!active || !state.clientState.snapshot) return;
  const transition = transitionTrainingV6ClientState(state.clientState, {
    type: "TRANSPORT_INTERRUPTED",
    reason: "network-offline",
  });
  if (transition.accepted) state.clientState = transition.state;
  render();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !active || !state.clientState.snapshot) return;
  refreshCanonicalRoom(state)
    .then(() => claimTransport(state))
    .then(() => {
      if (!contextIsCurrent(state)) return;
      syncRoomRuntime(state);
    })
    .catch(() => recoverRoomSubscription(state, "page-resume"));
});

window.addEventListener("pagehide", () => {
  if (!active) return;
  state.p2p?.stop();
  state.p2p = null;
  state.p2pSignature = "";
  state.localSendSignature = "";
  window.clearTimeout(state.p2pRetryTimer);
  state.p2pRetryTimer = null;
  state.workoutClock.stop();
  state.workoutClockSignature = "";
  state.metronome.stop();
  state.wakeLock.release();
});

window.HariaiTraining = {
  start,
  isActive,
  requestHome,
  destroyRoom,
};
window.dispatchEvent(new CustomEvent("hariai-training-ready"));
