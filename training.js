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
  TRAINING_MAX_TURNS,
  TRAINING_PROTOCOL_VERSION,
  TRAINING_QUEUE_FRESH_MS,
  TRAINING_TURN_DURATION_MS,
  TRAINING_VARIANT,
  continueVotePairForTurn,
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
  trainingServerFinalizedResult,
  validTrainingQueueEntries,
} from "./training-core.mjs?v=kitaeai-60-v1";

const MATCH_TIMEOUT_MS = 30_000;
const MATCH_LOCK_TTL_MS = MATCH_TIMEOUT_MS + 10_000;
const HEARTBEAT_MS = 20_000;
const TRAINING_QUEUE_RECLAIM_MS = 60_000;
const IMAGE_EXCHANGE_TIMEOUT_MS = 45_000;
const IMAGE_CHANNEL_LABEL = "hariai-training-image-v1";
const IMAGE_ROUND = 1;
const MAX_IMAGE_TRANSFER_BYTES = 8 * 1024 * 1024;
const IMAGE_CHUNK_BYTES = 64 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const TRAINING_VOLUME_KEY = "hariai-training-volume-v1";
const TRAINING_MUTED_KEY = "hariai-training-muted-v1";
const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost"]);
const FALLBACK_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
  Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
]);
const CHEERS = Object.freeze({
  twenty: "あと20秒",
  good: "その調子",
  more: "まだ終わってないぞ",
  complete: "よくやり切った",
});
const INTENSITY_LABELS = Object.freeze({
  light: "軽め",
  standard: "標準",
  strong: "しっかり",
});
const PRESETS = Object.freeze({
  pushup: Object.freeze({
    exercise: "腕立て伏せ",
    completion: "60秒間、自分のペースで続ける",
    command: "メトロノームに合わせて、できる範囲で腕立て伏せを続けてください。",
    bpm: 80,
    beatsPerRep: 4,
  }),
  squat: Object.freeze({
    exercise: "スクワット",
    completion: "60秒間、止まらずに続ける",
    command: "姿勢を意識しながら、拍に合わせてスクワットを続けてください。",
    bpm: 100,
    beatsPerRep: 2,
  }),
  situp: Object.freeze({
    exercise: "腹筋",
    completion: "60秒間、自分のリズムで続ける",
    command: "無理のない可動域で、呼吸を止めずに腹筋を続けてください。",
    bpm: 60,
    beatsPerRep: 2,
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
    localImage: null,
    remoteImage: null,
    profile: null,
    daily: null,
    roomId: "",
    pendingRoomId: "",
    room: emptyRoom(),
    latestQueue: {},
    latestInvites: {},
    queueSessionId: "",
    pendingInviteTargetSessionId: "",
    startingMatchmaking: false,
    matchingBusy: false,
    acceptingInvite: false,
    inviteRetryTimer: null,
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
    disconnectHandles: [],
    activeDisconnect: null,
    activeDisconnectRoomId: "",
    activeRoomDestroyedDisconnect: null,
    activeRoomDestroyedDisconnectRoomId: "",
    peer: null,
    channel: null,
    pendingIce: [],
    incomingImage: null,
    outgoingImageSent: false,
    imageExchangeTimer: null,
    incomingMessageChain: Promise.resolve(),
    iceServers: FALLBACK_ICE_SERVERS.map((item) => ({ ...item })),
    ticker: null,
    currentView: null,
    timeoutWriting: null,
    giveUpArmed: false,
    draftTurnIndex: 0,
    draftInstruction: normalizeTrainingInstruction(PRESETS.squat),
    ambienceController,
    volume,
    muted,
    ambienceRevision: 0,
    ambienceUnlocked: false,
    ambienceResumeRequired: false,
    cheer: null,
    cheerTimer: null,
    outcome: null,
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
    firstTrainerUid: "",
    members: {},
    players: {},
    accepted: {},
    imageReceived: {},
    turns: {},
    continueVotes: {},
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

function isPreviewRequest() {
  if (!LOCAL_PREVIEW_HOSTS.has(location.hostname)) return "";
  const requested = new URLSearchParams(location.search).get("trainingPreview") || "";
  return ["setup", "active", "result"].includes(requested) ? requested : "";
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
  if (body) body.textContent = "進行中のセットはNO CONTESTになります。RATEへの影響はありません。";
  if (confirm) confirm.textContent = "トレーニングを終了";
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
  const ready = state.authReady && normalizeTrainingName(state.name) && state.localImage?.blob;
  const preview = state.localImage?.url
    ? `<img src="${escapeHtml(state.localImage.url)}" alt="選んだニンジン画像のプレビュー" />`
    : `<div class="training-image-placeholder" aria-hidden="true"><span>YOUR CARROT</span><strong>画像を1枚選ぶ</strong></div>`;
  return `
    <section class="screen training-screen training-setup" aria-labelledby="trainingTitle">
      <div class="training-heading">
        <span class="eyebrow">ROLEPLAY RHYTHM TRAINING / RATE FREE</span>
        <h1 id="trainingTitle">鍛え合い<span>60</span></h1>
        <p>相手の自由な指示を60秒。やり切ったら、今度はあなたが指示役です。</p>
      </div>
      <div class="training-setup-grid">
        <section class="training-carrot-card" aria-labelledby="trainingCarrotTitle">
          <div class="training-section-head">
            <span>01</span>
            <div><h2 id="trainingCarrotTitle">ニンジン画像</h2><p>食べ物でも、推しでも、何でもOK。</p></div>
          </div>
          <div class="training-setup-image">${preview}</div>
          <div class="training-image-actions">
            <label class="button button-training training-file-button">
              画像を選ぶ
              <input id="trainingImageInput" type="file" accept="image/*" />
            </label>
            <button class="button button-ghost" id="trainingSampleImage" type="button">サンプルを使う</button>
            ${state.localImage ? `<button class="button button-ghost" id="trainingRemoveImage" type="button">画像を外す</button>` : ""}
          </div>
          <p class="training-privacy">最大1280pxのWebPへ端末内で変換。画像はP2Pで相手に一度だけ届き、Firebaseには保存されません。</p>
        </section>
        <form class="training-profile-card" id="trainingSetupForm">
          <div class="training-section-head">
            <span>02</span>
            <div><h2>今日の自分</h2><p>善意の指示役へ、今の調子を伝えます。</p></div>
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
            <strong>カメラ・センサーなし</strong>
            <p>フォームの監視はしません。お互いのロールプレイと自己申告で鍛え合うモードです。ギブアップは、その一戦の負けになるだけです。</p>
            <p>痛み・めまい・体調の変化を感じたら、勝敗より中止を優先してください。</p>
          </div>
          ${renderSetupTrainingRecord()}
          <button class="button button-training training-find-button" id="trainingFindMatch" type="submit" ${ready ? "" : "disabled"}>
            1対1の相手を探す
          </button>
          <p class="training-rate-note">RATE・ランキングは変動しません。</p>
        </form>
      </div>
    </section>`;
}

function renderSetupTrainingRecord() {
  const profile = state.profile || {};
  const missionComplete = Number(state.daily?.trainingSets || 0) >= 1;
  return `
    <section class="training-setup-record" aria-label="鍛え合い記録">
      <header><h3>鍛え合い記録</h3><span>NO RATE</span></header>
      <dl>
        <div><dt>累計完了セット</dt><dd>${Number(profile.completedSets || 0)}</dd></div>
        <div><dt>続けた日数</dt><dd>${Number(profile.completeDays || 0)}日</dd></div>
        <div><dt>現在の連続</dt><dd>${Number(profile.currentStreak || 0)}日</dd></div>
        <div><dt>最長連続</dt><dd>${Number(profile.bestStreak || 0)}日</dd></div>
        <div class="training-setup-mission"><dt>今日の専用ミッション</dt><dd>${missionComplete ? "達成 1/1" : "未達 0/1"}</dd></div>
      </dl>
    </section>`;
}

function renderMatching() {
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingMatchingTitle">
      <div class="training-pulse-mark" aria-hidden="true"><i></i><i></i><i></i></div>
      <span class="eyebrow">ONE QUEUE / ROLEPLAY MATCH</span>
      <h1 id="trainingMatchingTitle">鍛え合う相手を探しています</h1>
      <p>古くから待っている2人を順番に結びます。画像はまだ送信されていません。</p>
      <dl class="training-waiting-profile">
        <div><dt>NAME</dt><dd>${escapeHtml(state.name)}</dd></div>
        <div><dt>INTENSITY</dt><dd>${escapeHtml(INTENSITY_LABELS[state.intensity])}</dd></div>
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
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  state.currentView = view;
  configureAmbienceForView(view);
  if (view.phase === "destroyed") {
    state.screen = "cancelled";
    queueMicrotask(render);
    return "";
  }
  if (view.phase === "result") {
    state.outcome = view;
    state.screen = "result";
    state.ambienceController.disable();
    queueMicrotask(() => {
      render();
      ensureFinalization();
    });
    return "";
  }
  if (!["ready", "active", "expired"].includes(view.phase)) state.ambienceController.disable();
  if (view.phase === "waiting_images" || view.phase === "forming") return renderConnecting(view);
  if (view.phase === "compose") return renderInstructionComposer(view);
  if (view.phase === "waiting_instruction") return renderWaitingInstruction(view);
  if (view.phase === "continue_vote") return renderContinueVote(view);
  if (["ready", "active", "expired"].includes(view.phase)) return renderTrainingHud(view);
  return renderConnecting(view);
}

function renderConnecting() {
  const opponent = opponentPlayer();
  const ownReceived = state.room.imageReceived?.[state.uid] === true;
  const otherReceived = state.room.imageReceived?.[opponent?.uid] === true;
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingConnectTitle">
      <div class="training-transfer-orbit" aria-hidden="true"><span>IMAGE</span><i></i><span>IMAGE</span></div>
      <span class="eyebrow">P2P IMAGE HANDSHAKE</span>
      <h1 id="trainingConnectTitle">${state.channel?.readyState === "open" ? "ニンジン画像を交換中" : "相手のブラウザへ接続中"}</h1>
      <p>${escapeHtml(opponent?.name || "相手")}さんと、画像を保存しない1本のP2P接続を作っています。</p>
      <ul class="training-transfer-checks" aria-label="画像受信状況">
        <li class="${ownReceived ? "complete" : ""}"><i></i>あなたが相手画像を受信</li>
        <li class="${otherReceived ? "complete" : ""}"><i></i>相手があなたの画像を受信</li>
      </ul>
      <p class="training-subtle">画像の実バイト形式とサイズを確認してから開始します。</p>
    </section>`;
}

function seedDraftForTurn(view) {
  if (state.draftTurnIndex === view.turnIndex) return;
  state.draftTurnIndex = view.turnIndex;
  state.draftInstruction = normalizeTrainingInstruction(PRESETS.squat);
}

function renderInstructionComposer(view) {
  seedDraftForTurn(view);
  const trainee = playerByUid(view.traineeUid);
  const draft = state.draftInstruction;
  return `
    <section class="screen training-screen training-command-screen" aria-labelledby="trainingCommandTitle">
      <header class="training-turn-header">
        <span>TURN ${view.turnIndex} / ${TRAINING_MAX_TURNS}</span>
        <strong>あなたが指示役</strong>
      </header>
      <div class="training-command-grid">
        ${renderOpponentImage("指示を受ける相手のニンジン画像", false)}
        <form class="training-command-card" id="trainingInstructionForm">
          <span class="eyebrow">YOUR FREE COMMAND</span>
          <h1 id="trainingCommandTitle">${escapeHtml(trainee?.name || "相手")}さんへ、60秒の指示を。</h1>
          <div class="training-trainee-state">
            <span>${escapeHtml(INTENSITY_LABELS[trainee?.intensity] || "標準")}</span>
            <p>${escapeHtml(trainee?.conditions || "今日の条件：指定なし")}</p>
          </div>
          <p class="training-command-lead">自由な指示が主役です。下のプリセットは入力のきっかけとしてだけ使えます。</p>
          <div class="training-presets" aria-label="入力補助">
            <button type="button" data-training-preset="pushup">腕立て伏せ</button>
            <button type="button" data-training-preset="squat">スクワット</button>
            <button type="button" data-training-preset="situp">腹筋</button>
          </div>
          <label class="training-field">
            <span>自由な指示 <small><b id="trainingCommandCount">${draft.command.length}</b> / ${TRAINING_LIMITS.command}</small></span>
            <textarea id="trainingCommand" maxlength="${TRAINING_LIMITS.command}" rows="3">${escapeHtml(draft.command)}</textarea>
          </label>
          <div class="training-command-fields">
            <label class="training-field">
              <span>種目名</span>
              <input id="trainingExercise" maxlength="${TRAINING_LIMITS.exercise}" value="${escapeHtml(draft.exercise)}" />
            </label>
            <label class="training-field">
              <span>コンプリート条件</span>
              <input id="trainingCompletion" maxlength="${TRAINING_LIMITS.completion}" value="${escapeHtml(draft.completion)}" />
            </label>
          </div>
          <div class="training-rhythm-fields">
            <label class="training-field">
              <span>BPM（0で無音）</span>
              <input id="trainingBpm" type="number" min="0" max="160" step="1" value="${draft.bpm}" />
            </label>
            <fieldset>
              <legend>1回あたりの拍</legend>
              ${[1, 2, 4].map((beats) => `
                <label><input type="radio" name="trainingBeats" value="${beats}" ${draft.beatsPerRep === beats ? "checked" : ""} /><span>${beats}拍</span></label>
              `).join("")}
            </fieldset>
          </div>
          <button class="button button-training" id="trainingSendInstruction" type="submit">この指示を送る</button>
        </form>
      </div>
    </section>`;
}

function renderWaitingInstruction(view) {
  const trainer = playerByUid(view.trainerUid);
  return `
    <section class="screen training-screen training-waiting-command" aria-labelledby="trainingWaitingCommandTitle">
      <header class="training-turn-header">
        <span>TURN ${view.turnIndex} / ${TRAINING_MAX_TURNS}</span>
        <strong>あなたはチャレンジャー</strong>
      </header>
      ${renderOpponentImage("指示を考えている相手のニンジン画像", false)}
      <div class="training-waiting-copy">
        <span class="eyebrow">COMMAND INCOMING</span>
        <h1 id="trainingWaitingCommandTitle">${escapeHtml(trainer?.name || "相手")}さんが指示を考えています</h1>
        <p>画像を眺めながら、呼吸を整えて待ちましょう。</p>
      </div>
    </section>`;
}

function renderContinueVote(view) {
  const pair = view.pair || continueVotePairForTurn(view.turnIndex);
  const ownVote = state.room.continueVotes?.[pair]?.[state.uid] || "";
  const otherVote = state.room.continueVotes?.[pair]?.[view.opponentUid] || "";
  return `
    <section class="screen training-screen training-centred training-continue" aria-labelledby="trainingContinueTitle">
      <span class="eyebrow">PAIR ${pair} COMPLETE</span>
      <h1 id="trainingContinueTitle">もう1往復、鍛え合いますか？</h1>
      <p>ここまでで2人ともコンプリートです。どちらかが終了を選べば、気持ちよく完了になります。</p>
      <div class="training-complete-count"><strong>${view.completedSets}</strong><span>COMPLETED SETS</span></div>
      ${ownVote ? `
        <div class="training-vote-wait">
          <strong>${ownVote === "continue" ? "もう1往復を希望しました" : "ここで完了を選びました"}</strong>
          <p>${otherVote ? "相手の回答を受け取りました。" : "相手の回答を待っています…"}</p>
        </div>
      ` : `
        <div class="training-vote-actions">
          <button class="button button-training" type="button" data-training-vote="continue">もう1往復する</button>
          <button class="button button-ghost" type="button" data-training-vote="finish">ここで二人ともCOMPLETE</button>
        </div>
      `}
    </section>`;
}

function renderTrainingHud(view) {
  const turn = view.turn;
  const instruction = normalizeTrainingInstruction(turn?.instruction);
  const isTrainer = view.trainerUid === state.uid;
  const isTrainee = view.traineeUid === state.uid;
  const startedAt = Number(turn?.startedAt || 0);
  const remaining = startedAt
    ? Math.max(0, TRAINING_TURN_DURATION_MS - (firebaseNow() - startedAt))
    : TRAINING_TURN_DURATION_MS;
  const seconds = Math.ceil(remaining / 1000);
  const progress = (remaining / TRAINING_TURN_DURATION_MS) * 100;
  const beats = instruction.beatsPerRep || 1;
  const giveUpCopy = state.giveUpArmed ? "もう一度押して、負けを確定" : "GIVE UP";
  const controls = isTrainee
    ? (view.phase === "ready"
      ? `<button class="button button-training training-start-button" id="trainingStartTurn" type="button">60秒を開始</button>`
      : `<button class="button button-training training-complete-button" id="trainingCompleteTurn" type="button" ${view.phase === "expired" ? "disabled" : ""}>COMPLETE</button>`)
    : renderCheerButtons(view);
  return `
    <section class="screen training-screen training-hud ${isTrainer ? "is-trainer" : "is-trainee"}" aria-labelledby="trainingHudTitle">
      <header class="training-hud-header">
        <div><span>TURN ${view.turnIndex} / ${TRAINING_MAX_TURNS}</span><strong>${isTrainer ? "指示役" : "チャレンジャー"}</strong></div>
        <div class="training-hud-name">${escapeHtml(playerByUid(view.opponentUid)?.name || "PARTNER")}</div>
      </header>
      <div class="training-image-arena">
        <div
          class="training-countdown-progress"
          id="trainingCountdownProgress"
          role="progressbar"
          aria-label="残り${seconds}秒"
          aria-valuemin="0"
          aria-valuemax="60"
          aria-valuenow="${seconds}"
        ><i id="trainingCountdownFill" style="width:${progress}%"></i></div>
        ${renderOpponentImage("相手のニンジン画像", true)}
        <div class="training-countdown-clock" aria-hidden="true"><strong id="trainingCountdown">${seconds}</strong><span>SEC</span></div>
        <div class="training-cheer-overlay ${state.cheer ? "is-visible" : ""}" id="trainingCheerOverlay" role="status" aria-live="polite">
          ${escapeHtml(state.cheer?.text || "")}
        </div>
      </div>
      <section class="training-live-command" aria-labelledby="trainingHudTitle">
        <span>${escapeHtml(instruction.exercise)}</span>
        <h1 id="trainingHudTitle">${escapeHtml(instruction.command)}</h1>
        <p>COMPLETE：${escapeHtml(instruction.completion)}</p>
      </section>
      <section class="training-beat-panel" aria-label="拍レーン">
        <div class="training-beat-meta">
          <strong>${instruction.bpm ? `${instruction.bpm} BPM` : "FREE RHYTHM"}</strong>
          <span>${instruction.bpm ? `${beats}拍で1回` : "メトロノームなし"}</span>
        </div>
        <div class="training-beat-lane ${instruction.bpm ? "" : "is-off"}" id="trainingBeatLane" aria-hidden="true">
          ${Array.from({ length: beats }, (_, index) => `<i data-beat="${index + 1}"></i>`).join("")}
        </div>
        <div class="training-audio-controls">
          ${state.ambienceResumeRequired
            ? `<button type="button" id="trainingResumeAmbience">メトロノームを再開</button>`
            : ""}
          <button type="button" id="trainingMute" aria-pressed="${state.muted}">${state.muted ? "音を出す" : "ミュート"}</button>
          <label><span>音量</span><input id="trainingVolume" type="range" min="0" max="1" step="0.01" value="${state.volume}" /></label>
        </div>
      </section>
      <div class="training-turn-actions">${controls}</div>
      ${isTrainee ? `
        <div class="training-give-up-dock ${state.giveUpArmed ? "is-armed" : ""}">
          <p>痛み・めまい・体調の変化を感じたら、勝敗より中止を優先</p>
          ${state.giveUpArmed ? `<button type="button" id="trainingCancelGiveUp">続ける</button>` : ""}
          <button type="button" id="trainingGiveUp">${giveUpCopy}</button>
        </div>
      ` : ""}
    </section>`;
}

function renderCheerButtons(view) {
  if (view.phase !== "active") return `<p class="training-role-wait">相手が開始ボタンを押すと、60秒が始まります。</p>`;
  return `
    <div class="training-cheer-buttons" aria-label="相手へ掛け声を送る">
      ${Object.entries(CHEERS).map(([id, label]) => `<button type="button" data-training-cheer="${id}">${label}</button>`).join("")}
    </div>`;
}

function renderOpponentImage(alt, compact) {
  if (state.remoteImage?.url) {
    return `<figure class="training-opponent-image ${compact ? "is-compact" : ""}"><img src="${escapeHtml(state.remoteImage.url)}" alt="${escapeHtml(alt)}" /></figure>`;
  }
  return `<div class="training-opponent-image training-image-placeholder ${compact ? "is-compact" : ""}" aria-label="${escapeHtml(alt)}"><span>PARTNER IMAGE</span></div>`;
}

function renderResult() {
  const view = state.outcome || deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  const result = view.result || { type: "mutual_complete", reason: "mutual_complete" };
  const serverResult = state.finalization?.result;
  const completedSets = Number(serverResult?.completedSets ?? view.ownCompletedSets ?? 0);
  const heading = result.type === "win"
    ? "YOU WIN"
    : result.type === "loss"
      ? "TRAINING LOSS"
      : "MUTUAL COMPLETE";
  const japanese = result.type === "win"
    ? (result.reason === "timeout"
      ? "相手は60秒をコンプリートできませんでした。最後まで立っていたあなたの勝ちです。"
      : "相手のギブアップ。最後まで立っていたあなたの勝ちです。")
    : result.type === "loss"
      ? (result.reason === "timeout"
        ? "60秒をコンプリートできませんでした。今日はここまででも大丈夫です。"
        : "ギブアップを受け付けました。休んだら、また鍛え合いましょう。")
      : "二人とも、今日の鍛え合いをやり切りました。";
  const status = renderFinalizationStatus();
  return `
    <section class="screen training-screen training-result ${result.type}" aria-labelledby="trainingResultTitle">
      <span class="eyebrow">KITA EAI 60 / NO RATE</span>
      <h1 id="trainingResultTitle">${heading}</h1>
      <p class="training-result-copy">${escapeHtml(japanese)}</p>
      <div class="training-result-stats">
        <div><strong>${completedSets}</strong><span>あなたの完了セット</span></div>
        <div><strong>${Number(serverResult?.turnCount ?? view.turnIndex ?? 0)}</strong><span>今回の総ターン</span></div>
      </div>
      ${status}
      <div class="training-result-actions">
        <button class="button button-training" id="trainingToFreeTable" type="button">自由卓で一息つく</button>
        <button class="button button-ghost" id="trainingResultHome" type="button">タイトルへ戻る</button>
      </div>
      <p class="training-rate-note">この結果でRATEやランキングは変動しません。</p>
    </section>`;
}

function renderFinalizationStatus() {
  if (state.finalization?.result?.status === "final") {
    const profile = state.profile || {};
    const daily = state.daily || {};
    return `
      <section class="training-profile-result" aria-label="鍛え合い記録">
        <h2>今日の積み重ね</h2>
        <dl>
          <div><dt>累計完了セット</dt><dd>${Number(profile.completedSets || 0)}</dd></div>
          <div><dt>続けた日数</dt><dd>${Number(profile.completeDays || 0)}日</dd></div>
          <div><dt>現在の連続日数</dt><dd>${Number(profile.currentStreak || 0)}日</dd></div>
          <div><dt>今日の専用ミッション</dt><dd>${Number(daily.trainingSets || 0) >= 1 ? "達成 1/1" : "未達 0/1"}</dd></div>
        </dl>
      </section>`;
  }
  if (state.finalization?.error) {
    return `
      <div class="training-save-status is-error" role="status">
        <p>記録の確認に時間がかかっています。</p>
        <button type="button" id="trainingRetryFinalize">記録を再確認</button>
      </div>`;
  }
  return `<div class="training-save-status" role="status"><i></i>完了記録を確認しています…</div>`;
}

function renderCancelled() {
  return `
    <section class="screen training-screen training-centred" aria-labelledby="trainingCancelledTitle">
      <span class="eyebrow">NO CONTEST</span>
      <h1 id="trainingCancelledTitle">鍛え合いは中断されました</h1>
      <p>勝敗・RATE・完了記録には影響しません。画像はこの画面を離れると破棄されます。</p>
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

function bindEvents() {
  document.querySelector("#trainingImageInput")?.addEventListener("change", (event) => prepareImage(event.target.files?.[0]));
  document.querySelector("#trainingSampleImage")?.addEventListener("click", fillSampleImage);
  document.querySelector("#trainingRemoveImage")?.addEventListener("click", removeLocalImage);
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
  document.querySelector("#trainingInstructionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitInstruction().catch(handleRecoverableError);
  });
  document.querySelectorAll("[data-training-preset]").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.trainingPreset)));
  bindInstructionInputs();
  document.querySelector("#trainingStartTurn")?.addEventListener("click", () => startTurn().catch(handleRecoverableError));
  document.querySelector("#trainingCompleteTurn")?.addEventListener("click", () => completeTurn().catch(handleRecoverableError));
  document.querySelector("#trainingGiveUp")?.addEventListener("click", () => handleGiveUp().catch(handleRecoverableError));
  document.querySelector("#trainingCancelGiveUp")?.addEventListener("click", () => {
    state.giveUpArmed = false;
    render();
  });
  document.querySelectorAll("[data-training-cheer]").forEach((button) => button.addEventListener("click", () => sendCheer(button.dataset.trainingCheer)));
  document.querySelectorAll("[data-training-vote]").forEach((button) => button.addEventListener("click", () => {
    submitContinueVote(button.dataset.trainingVote).catch(handleRecoverableError);
  }));
  document.querySelector("#trainingMute")?.addEventListener("click", toggleMute);
  document.querySelector("#trainingResumeAmbience")?.addEventListener("click", () => {
    resumeTrainingAmbienceFromGesture().catch(handleRecoverableError);
  });
  document.querySelector("#trainingVolume")?.addEventListener("input", updateVolume);
  document.querySelector("#trainingRetryFinalize")?.addEventListener("click", () => ensureFinalization(true));
  document.querySelector("#trainingToFreeTable")?.addEventListener("click", () => moveToFreeTable().catch(handleRecoverableError));
  document.querySelector("#trainingResultHome")?.addEventListener("click", () => requestHome().catch(handleRecoverableError));
  document.querySelector("#trainingCancelledRetry")?.addEventListener("click", () => restartTraining().catch(handleRecoverableError));
  document.querySelector("#trainingCancelledHome")?.addEventListener("click", () => requestHome().catch(handleRecoverableError));
  document.querySelector("#trainingErrorHome")?.addEventListener("click", () => requestHome().catch(handleRecoverableError));
  if (state.currentView && ["active", "expired"].includes(state.currentView.phase)) startTurnTicker(state.currentView);
}

function bindInstructionInputs() {
  const mappings = [
    ["#trainingCommand", "command", TRAINING_LIMITS.command],
    ["#trainingExercise", "exercise", TRAINING_LIMITS.exercise],
    ["#trainingCompletion", "completion", TRAINING_LIMITS.completion],
  ];
  mappings.forEach(([selector, key, limit]) => {
    document.querySelector(selector)?.addEventListener("input", (event) => {
      state.draftInstruction[key] = event.target.value.slice(0, limit);
      if (key === "command") {
        const count = document.querySelector("#trainingCommandCount");
        if (count) count.textContent = String(state.draftInstruction.command.length);
      }
    });
  });
  document.querySelector("#trainingBpm")?.addEventListener("input", (event) => {
    state.draftInstruction.bpm = Number(event.target.value);
  });
  document.querySelectorAll('input[name="trainingBeats"]').forEach((input) => input.addEventListener("change", () => {
    state.draftInstruction.beatsPerRep = Number(input.value);
  }));
}

function updateSetupButton() {
  const button = document.querySelector("#trainingFindMatch");
  if (button) button.disabled = !(state.authReady && normalizeTrainingName(state.name) && state.localImage?.blob);
}

async function prepareImage(file) {
  if (!file) return;
  setBusy(true, "ニンジン画像を整えています…");
  try {
    const item = await shared().processImageFile(file, 0, { maxSide: 1280, quality: 0.82 });
    releaseImage(state.localImage);
    state.localImage = { ...item, mime: "image/webp" };
    showToast("鍛え合いのニンジン画像を選びました。");
  } catch (error) {
    showToast(error?.message || "画像を準備できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

async function fillSampleImage() {
  if (state.localImage) return;
  setBusy(true, "サンプル画像を準備しています…");
  try {
    const [item] = await shared().createSampleItems(3, 1, 0);
    state.localImage = { ...item, mime: "image/webp" };
  } catch (error) {
    showToast(error?.message || "サンプル画像を準備できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

function removeLocalImage() {
  releaseImage(state.localImage);
  state.localImage = null;
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
  const keys = ["createdAt", "status", "members", "presence", "destroyed", "serverFinalized"];
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
      throw new Error("別のタブで鍛え合い60が進行中です。そちらを終了してから開始してください。");
    }
    await removeTrainingActiveChild(observedRoomId);
  }
  if (typeof activeValue.roomId === "string") {
    await removeTrainingActiveParentIfOwned(activeValue.roomId);
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
  const transaction = await runTransaction(
    ref(database, `online/trainingQueue/${state.uid}`),
    (current) => {
      if (!queueEntryBelongsToSession(current, sessionId)) return undefined;
      return { ...current, ...patch, uid: state.uid, sessionId };
    },
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
    (current) => queueEntryBelongsToSession(current, sessionId) ? null : undefined,
  ).catch(() => null);
  return Boolean(transaction && (
    transaction.committed
    || transaction.snapshot.val() === null
  ));
}

async function removeTrainingInviteForSession(
  targetUid,
  roomId,
  targetSessionId = state.queueSessionId,
) {
  if (!targetUid || !roomId || !targetSessionId || state.preview) return false;
  const transaction = await runTransaction(
    ref(database, `online/trainingInvites/${targetUid}/${roomId}`),
    (current) => current?.targetSessionId === targetSessionId ? null : undefined,
  ).catch(() => null);
  return Boolean(transaction && (
    transaction.committed
    || transaction.snapshot.val() === null
  ));
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

async function beginMatchmaking() {
  state.name = normalizeTrainingName(state.name);
  state.conditions = normalizeTrainingConditions(state.conditions);
  state.intensity = normalizeTrainingIntensity(state.intensity);
  if (state.startingMatchmaking
    || !state.authReady
    || !state.uid
    || !state.name
    || !state.localImage?.blob) return;
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
      processInvites().catch(handleRecoverableError);
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
  const pair = selectTrainingPair(freshQueueEntries());
  if (pair.length !== 2 || pair[0].uid !== state.uid) return;
  await createTrainingRoom(pair);
}

async function refreshTrainingPair(expectedPair) {
  const snapshot = await get(ref(database, "online/trainingQueue"));
  const refreshedPair = selectTrainingPair(validTrainingQueueEntries(snapshot.val() || {}, {
    now: firebaseNow(),
    freshnessMs: TRAINING_QUEUE_FRESH_MS,
  }));
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
  return transaction.committed && lock?.uid === state.uid && lock?.roomId === roomId;
}

async function releaseMatchLock(roomId) {
  const transaction = await runTransaction(ref(database, "online/trainingMatchLock"), (current) => (
    current?.uid === state.uid && current?.roomId === roomId ? null : undefined
  )).catch(() => null);
  if (!transaction) return false;
  const current = transaction.snapshot.val();
  return transaction.committed
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
    (current) => current === true ? null : undefined,
  ).catch(() => null);
  return Boolean(transaction?.committed);
}

async function removeTrainingActiveParentIfOwned(roomId) {
  const transaction = await runTransaction(
    ref(database, `online/trainingActive/${state.uid}`),
    (current) => current?.roomId === roomId ? null : undefined,
  ).catch(() => null);
  return Boolean(transaction?.committed);
}

async function reserveTrainingActiveRoom(roomId) {
  const transaction = await runTransaction(
    ref(database, `online/trainingActive/${state.uid}`),
    (current) => {
      const sessions = current?.rooms && typeof current.rooms === "object"
        ? current.rooms
        : {};
      if (Object.values(sessions).some((claimed) => claimed === true)) return undefined;
      return { roomId, rooms: { [roomId]: true } };
    },
  );
  const reservation = transaction.snapshot.val();
  return transaction.committed
    && reservation?.roomId === roomId
    && reservation?.rooms?.[roomId] === true;
}

async function releaseTrainingActiveReservation(roomId) {
  await cancelTrainingActiveDisconnect(roomId);
  await removeTrainingActiveChild(roomId);
  return removeTrainingActiveParentIfOwned(roomId);
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
  let createdRoom = null;
  try {
    ownsLock = await acquireMatchLock(roomId);
    if (!ownsLock || state.screen !== "matching") return;
    const refreshedPair = await refreshTrainingPair(pair);
    const host = refreshedPair[0];
    const guest = refreshedPair[1];
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
      firstTrainerUid: randomlyChooseUid(host.uid, guest.uid),
      members: { [host.uid]: true, [guest.uid]: true },
      players,
      accepted: { [host.uid]: true },
    };
    await set(ref(database, `online/trainingRooms/${roomId}`), createdRoom);
    roomCreated = true;
    await armFormingRoomDisconnects(roomId, true, roomDisconnects);
    if (!await updateOwnedTrainingQueue({ state: "forming" }, host.sessionId)) {
      throw new Error("待機セッションが別の端末へ移ったため、部屋作成を中止しました。");
    }
    await set(ref(database, `online/trainingInvites/${guest.uid}/${roomId}`), {
      roomId,
      hostUid: host.uid,
      targetSessionId: guest.sessionId,
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      createdAt: firebaseNow(),
    });
    if (await releaseMatchLock(roomId)) ownsLock = false;
    state.pendingRoomId = roomId;
    state.pendingInviteTargetSessionId = guest.sessionId;
    state.room = { ...emptyRoom(), ...createdRoom, createdAt: firebaseNow() };
    state.screen = "forming";
    render();
    watchPendingRoom(roomId, true);
    state.matchTimer = window.setTimeout(() => expirePendingRoom(roomId), MATCH_TIMEOUT_MS);
  } catch (error) {
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
    if (guestUid) {
      await removeTrainingInviteForSession(guestUid, roomId, guestSessionId);
    }
    if (activeReserved) await releaseTrainingActiveReservation(roomId);
    if (state.pendingRoomId === roomId) state.pendingRoomId = "";
    if (state.pendingInviteTargetSessionId === guestSessionId) {
      state.pendingInviteTargetSessionId = "";
    }
    if (retryMatching) {
      await updateOwnedTrainingQueue({
        state: "waiting",
        lastSeen: firebaseNow(),
      });
    }
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

function scheduleInviteProcessing(delay = 500) {
  if (state.inviteRetryTimer
    || !active
    || state.screen !== "matching"
    || state.pendingRoomId
    || state.roomId) return;
  state.inviteRetryTimer = window.setTimeout(() => {
    state.inviteRetryTimer = null;
    processInvites().catch(handleRecoverableError);
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
    "status", "firstTrainerUid", "members", "players", "accepted",
  ];
  const snapshots = await Promise.all(keys.map((key) => get(ref(database, `${base}/${key}`))));
  return Object.fromEntries(keys.map((key, index) => [key, snapshots[index].val()]));
}

async function readRoomLifecycle(roomId) {
  const base = `online/trainingRooms/${roomId}`;
  const keys = ["status", "turns", "continueVotes", "destroyed", "serverFinalized"];
  const snapshots = await Promise.all(keys.map((key) => get(ref(database, `${base}/${key}`))));
  return {
    status: snapshots[0].val() || "",
    turns: snapshots[1].val() || {},
    continueVotes: snapshots[2].val() || {},
    destroyed: snapshots[3].val() || null,
    serverFinalized: snapshots[4].val() || null,
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
  cancelActiveRoomDestroyedDisconnect(state.roomId).catch(() => {});
  state.channel?.close();
  state.peer?.close();
  state.channel = null;
  state.peer = null;
  state.screen = "cancelled";
  state.ambienceController.disable();
  render();
}

function transitionToLocalNoContestPending() {
  clearImageExchangeWatchdog();
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
  if (!lifecycle.destroyed && outcomeView.phase === "expired") {
    await markTimeout(outcomeView);
    lifecycle = await readRoomLifecycle(roomId);
    if (!active || state.roomId !== roomId) return "stale";
    Object.assign(state.room, lifecycle);
    outcomeView = deriveTrainingRoomState(
      { ...state.room, destroyed: null },
      state.uid,
      firebaseNow(),
    );
    finalizedView = viewFromServerFinalized(lifecycle.serverFinalized, outcomeView);
    if (finalizedView) {
      transitionToTrainingResult(finalizedView);
      return "result";
    }
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
    await removeTrainingInviteForSession(state.uid, roomId, invite.targetSessionId);
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
    if (activeReserved) await releaseTrainingActiveReservation(roomId);
    if (guestQueueForming) {
      await updateOwnedTrainingQueue({
        state: "waiting",
        lastSeen: firebaseNow(),
      }, invite.targetSessionId);
    }
    if (active && state.screen === "matching" && !state.pendingRoomId && !state.roomId) {
      scheduleInviteProcessing(1_500);
    }
    throw error;
  }
  const acceptedSessionId = invite.targetSessionId;
  await removeTrainingInviteForSession(state.uid, roomId, acceptedSessionId);
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
  state.matchTimer = window.setTimeout(() => abandonPendingRoom(roomId), MATCH_TIMEOUT_MS + 5_000);
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
      runTransaction(ref(database, `${base}/status`), (current) => current === "forming" ? "active" : undefined)
        .catch(handleRecoverableError);
    }
    if (state.room.status === "active") enterRoom(roomId).catch(handleRecoverableError);
    if (state.room.status === "expired") returnToWaitingQueue(roomId).catch(handleRecoverableError);
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
    if (snapshot.exists() && state.pendingRoomId === roomId) returnToWaitingQueue(roomId).catch(handleRecoverableError);
  }, handleRecoverableError));
}

async function expirePendingRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId || state.room.hostUid !== state.uid) return;
  await runTransaction(ref(database, `online/trainingRooms/${roomId}/status`), (current) => (
    current === "forming" ? "expired" : undefined
  ));
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
    const statusTransaction = await runTransaction(
      ref(database, `online/trainingRooms/${roomId}/status`),
      (current) => current === "forming" ? "expired" : undefined,
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
    await Promise.allSettled([
      inviteTargetUid && targetSessionId
        ? removeTrainingInviteForSession(inviteTargetUid, roomId, targetSessionId)
        : Promise.resolve(),
      releaseMatchLock(roomId),
    ]);
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
    if (inviteTargetUid && targetSessionId) {
      await removeTrainingInviteForSession(inviteTargetUid, roomId, targetSessionId);
    }
    await cleanupMatchmaking(false);
    await cleanupPublicPresence();
    await releaseMatchLock(roomId);
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
    state.roomId = roomId;
    roomAssigned = true;
    window.clearTimeout(state.matchTimer);
    window.clearTimeout(state.enterRoomRetryTimer);
    state.matchTimer = null;
    state.enterRoomRetryTimer = null;
    state.enterRoomRetryAttempts = 0;
    const targetSessionId = state.pendingInviteTargetSessionId;
    state.pendingRoomId = "";
    state.pendingInviteTargetSessionId = "";
    state.room = { ...emptyRoom(), ...room };
    if (room.guestUid && targetSessionId) {
      await removeTrainingInviteForSession(room.guestUid, roomId, targetSessionId);
    }
    await releaseMatchLock(roomId);
    await cleanupMatchmaking(true);
    await updatePublicPresence("playing");
    state.screen = "room";
    setTrainingChrome("鍛え合い ACTIVE");
    render();
    await setupRoomListeners();
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
  if (state.enterRoomRetryAttempts > 6) return;
  window.clearTimeout(state.enterRoomRetryTimer);
  const delay = Math.min(4_000, 500 * (2 ** (state.enterRoomRetryAttempts - 1)));
  state.enterRoomRetryTimer = window.setTimeout(() => {
    state.enterRoomRetryTimer = null;
    enterRoom(roomId).catch(handleRecoverableError);
  }, delay);
}

async function setupRoomListeners() {
  const base = `online/trainingRooms/${state.roomId}`;
  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    state.serverTimeOffset = Number(snapshot.val() || 0);
  }));
  const childKeys = [
    "status", "imageReceived", "turns", "continueVotes", "destroyed", "serverFinalized",
  ];
  childKeys.forEach((key) => {
    state.roomUnsubscribers.push(onValue(ref(database, `${base}/${key}`), (snapshot) => {
      state.room[key] = snapshot.val()
        || (["imageReceived", "turns", "continueVotes"].includes(key) ? {} : null);
      reactToRoomData();
    }, handleRecoverableError));
  });
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
}

function reactToRoomData() {
  if (!active
    || !state.roomId
    || state.screen === "result"
    || state.screen === "error") return;
  let view = deriveTrainingRoomState(
    { ...state.room, destroyed: null },
    state.uid,
    firebaseNow(),
  );
  const finalizedView = viewFromServerFinalized(state.room.serverFinalized, view);
  if (finalizedView) {
    transitionToTrainingResult(finalizedView);
    return;
  }
  if (view.phase === "result") {
    transitionToTrainingResult(view);
    return;
  }
  if (state.screen === "cancelled") return;
  view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  state.currentView = view;
  if (allImagesReceived()) clearImageExchangeWatchdog();
  if (view.phase === "destroyed") {
    transitionToDestroyedRoom();
    return;
  }
  if (view.phase === "expired" && view.traineeUid === state.uid) markTimeout().catch(handleRecoverableError);
  if (view.phase === "result") {
    transitionToTrainingResult(view);
    return;
  }
  state.screen = "room";
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
      && !allImagesReceived()
      && state.roomId
      && !state.outcome) {
      failImageExchange(
        "p2p_image_connection_failed",
        new Error("画像を交換するP2P接続を確立できませんでした。"),
      ).catch(() => {});
    } else if (peer.connectionState === "failed" && allImagesReceived()) {
      showToast("P2P接続は切れましたが、受信済み画像とFirebaseの進行で鍛え合いを続けます。");
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
    sendLocalImageOnce().catch((error) => {
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

async function sendLocalImageOnce() {
  if (state.outgoingImageSent || state.channel?.readyState !== "open" || !state.localImage?.blob) return;
  state.outgoingImageSent = true;
  const buffer = await state.localImage.blob.arrayBuffer();
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_TRANSFER_BYTES) {
    throw new Error("送信画像のサイズが鍛え合い60の上限を超えています。");
  }
  const mime = verifiedOnlineImageMime(buffer);
  state.channel.send(JSON.stringify({
    type: "training-image-start",
    protocolVersion: TRAINING_PROTOCOL_VERSION,
    variant: TRAINING_VARIANT,
    ownerUid: state.uid,
    round: IMAGE_ROUND,
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
    round: IMAGE_ROUND,
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
      if (state.remoteImage || state.incomingImage) return;
      if (message.protocolVersion !== TRAINING_PROTOCOL_VERSION
        || message.variant !== TRAINING_VARIANT
        || message.ownerUid !== opponentPlayer()?.uid) {
        throw new Error("受信画像の送信者情報が一致しません。");
      }
      state.incomingImage = createIncomingOnlineImageTransfer(message, {
        expectedRound: IMAGE_ROUND,
        maxBytes: MAX_IMAGE_TRANSFER_BYTES,
      });
    } else if (message.type === "training-image-end") {
      await finishIncomingImage(message);
    } else if (message.type === "training-cheer") {
      receiveCheer(message);
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
  if (endStatus !== "complete" || message.ownerUid !== opponentPlayer()?.uid) {
    state.incomingImage = null;
    throw new Error("受信画像の完了情報が一致しません。");
  }
  const mime = completeIncomingOnlineImageTransfer(transfer);
  state.incomingImage = null;
  releaseImage(state.remoteImage);
  const blob = new Blob(transfer.chunks, { type: mime });
  state.remoteImage = { blob, url: URL.createObjectURL(blob), mime };
  await set(ref(database, `online/trainingRooms/${state.roomId}/imageReceived/${state.uid}`), true);
  render();
}

function allImagesReceived() {
  const uids = Object.keys(state.room.members || {});
  return uids.length === 2 && uids.every((uid) => state.room.imageReceived?.[uid] === true);
}

function clearImageExchangeWatchdog() {
  window.clearTimeout(state.imageExchangeTimer);
  state.imageExchangeTimer = null;
}

function startImageExchangeWatchdog() {
  clearImageExchangeWatchdog();
  if (!state.roomId || allImagesReceived() || state.outcome) return;
  const roomId = state.roomId;
  state.imageExchangeTimer = window.setTimeout(() => {
    state.imageExchangeTimer = null;
    if (!active || state.roomId !== roomId || allImagesReceived() || state.outcome) return;
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
    || state.outcome
    || allImagesReceived()) return;
  const roomId = state.roomId;
  const receipt = await get(ref(database, `online/trainingRooms/${roomId}/imageReceived`)).catch(() => null);
  if (receipt && active && state.roomId === roomId) {
    state.room.imageReceived = receipt.val() || {};
    if (allImagesReceived()) {
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

function applyPreset(id) {
  const preset = PRESETS[id];
  if (!preset) return;
  state.draftInstruction = normalizeTrainingInstruction(preset);
  const command = document.querySelector("#trainingCommand");
  const exercise = document.querySelector("#trainingExercise");
  const completion = document.querySelector("#trainingCompletion");
  const bpm = document.querySelector("#trainingBpm");
  if (command) command.value = state.draftInstruction.command;
  if (exercise) exercise.value = state.draftInstruction.exercise;
  if (completion) completion.value = state.draftInstruction.completion;
  if (bpm) bpm.value = String(state.draftInstruction.bpm);
  document.querySelectorAll('input[name="trainingBeats"]').forEach((input) => {
    input.checked = Number(input.value) === state.draftInstruction.beatsPerRep;
  });
  const count = document.querySelector("#trainingCommandCount");
  if (count) count.textContent = String(state.draftInstruction.command.length);
}

async function submitInstruction() {
  if (state.preview) return;
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (view.phase !== "compose" || view.trainerUid !== state.uid || view.turnIndex > TRAINING_MAX_TURNS) return;
  const instruction = normalizeTrainingInstruction(state.draftInstruction);
  if (!trainingInstructionIsReady(instruction)) {
    showToast("自由な指示・種目名・コンプリート条件をすべて入力してください。");
    return;
  }
  const turn = {
    trainerUid: state.uid,
    traineeUid: view.traineeUid,
    instruction,
    createdAt: firebaseNow(),
  };
  try {
    state.ambienceUnlocked = true;
    state.ambienceResumeRequired = false;
    primeTurnAmbience(view.turnIndex);
    await state.ambienceController.enable();
  } catch {
    showToast("メトロノーム音を準備できませんでした。無音でもトレーニングは続けられます。");
  }
  const result = await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/turns/${view.turnIndex}`),
    (current) => current === null ? turn : undefined,
  );
  if (!result.committed) showToast("相手と同時に進行が更新されました。現在のターンを確認します。");
}

async function startTurn() {
  if (state.preview) return;
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (view.phase !== "ready" || view.traineeUid !== state.uid) return;
  state.giveUpArmed = false;
  try {
    state.ambienceUnlocked = true;
    state.ambienceResumeRequired = false;
    await state.ambienceController.enable();
  } catch {
    showToast("メトロノーム音を開始できませんでした。無音でもトレーニングは続けられます。");
  }
  const startedAt = firebaseNow();
  const transaction = await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/turns/${view.turnIndex}/startedAt`),
    (current) => current === null ? startedAt : undefined,
  );
  const effectiveAt = Number(transaction.snapshot.val() || startedAt);
  if (transaction.committed) {
    setTurnAmbience(view.turnIndex, view.turn.instruction, effectiveAt);
  }
}

async function completeTurn() {
  if (state.preview) return;
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (view.phase !== "active" || view.traineeUid !== state.uid) return;
  const startedAt = Number(view.turn?.startedAt || 0);
  if (!startedAt || firebaseNow() >= startedAt + TRAINING_TURN_DURATION_MS) return markTimeout();
  await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/turns/${view.turnIndex}/completedAt`),
    (current) => current === null ? firebaseNow() : undefined,
  );
}

async function handleGiveUp() {
  if (state.preview) return;
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (!["ready", "active", "expired"].includes(view.phase) || view.traineeUid !== state.uid) return;
  if (!state.giveUpArmed) {
    state.giveUpArmed = true;
    render();
    return;
  }
  if (view.phase === "expired") return markTimeout();
  if (view.phase === "ready") {
    const startedAt = await runTransaction(
      ref(database, `online/trainingRooms/${state.roomId}/turns/${view.turnIndex}/startedAt`),
      (current) => current === null ? firebaseNow() : undefined,
    );
    if (!Number(startedAt.snapshot.val() || 0)) {
      throw new Error("ギブアップを確定するための開始時刻を記録できませんでした。");
    }
  }
  await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/turns/${view.turnIndex}/surrenderedAt`),
    (current) => current === null ? firebaseNow() : undefined,
  );
}

async function markTimeout(viewOverride = null) {
  if (state.preview) return;
  if (state.timeoutWriting) return state.timeoutWriting;
  if (!state.roomId) return;
  const view = viewOverride || deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (view.phase !== "expired") return;
  const timeoutWrite = runTransaction(
      ref(database, `online/trainingRooms/${state.roomId}/turns/${view.turnIndex}/timedOutAt`),
      (current) => current === null ? firebaseNow() : undefined,
  );
  state.timeoutWriting = timeoutWrite;
  try {
    await timeoutWrite;
  } finally {
    if (state.timeoutWriting === timeoutWrite) state.timeoutWriting = null;
  }
}

async function submitContinueVote(vote) {
  if (state.preview) return;
  const normalized = vote === "continue" ? "continue" : vote === "finish" ? "finish" : "";
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (!normalized || view.phase !== "continue_vote" || !view.pair) return;
  await runTransaction(
    ref(database, `online/trainingRooms/${state.roomId}/continueVotes/${view.pair}/${state.uid}`),
    (current) => current === null ? normalized : undefined,
  );
}

function sendCheer(id) {
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (!CHEERS[id] || view.phase !== "active" || view.trainerUid !== state.uid) return;
  if (state.channel?.readyState !== "open") {
    showToast("掛け声用のP2P接続が閉じています。トレーニング進行は続けられます。");
    return;
  }
  state.channel.send(JSON.stringify({
    type: "training-cheer",
    cheerId: id,
    turn: view.turnIndex,
  }));
}

function receiveCheer(message) {
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (!CHEERS[message.cheerId]
    || Number(message.turn) !== view.turnIndex
    || view.traineeUid !== state.uid
    || view.trainerUid !== opponentPlayer()?.uid
    || view.phase !== "active") return;
  state.cheer = { text: CHEERS[message.cheerId], turn: view.turnIndex };
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
  if (view.phase === "ready" && view.turn) {
    primeTurnAmbience(view.turnIndex);
    return;
  }
  const startedAt = Number(view.turn?.startedAt || 0);
  if (!startedAt || !["active", "expired"].includes(view.phase)) return;
  setTurnAmbience(view.turnIndex, view.turn.instruction, startedAt);
  if (enableAudio) state.ambienceController.enable().catch(() => {});
}

function primeTurnAmbience(turnIndex) {
  const revision = (turnIndex * 2) - 1;
  if (revision < state.ambienceRevision) return;
  state.ambienceController.setAmbience({
    metronomeBpm: 0,
    effectiveAt: firebaseNow(),
    revision,
  }, { serverTimeOffset: state.serverTimeOffset });
  state.ambienceRevision = revision;
}

function setTurnAmbience(turnIndex, instruction, effectiveAt) {
  const revision = turnIndex * 2;
  if (revision < state.ambienceRevision) return;
  try {
    state.ambienceController.setAmbience({
      metronomeBpm: normalizeTrainingInstruction(instruction).bpm,
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
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (!["ready", "active", "expired"].includes(view.phase)) return false;
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
  const view = deriveTrainingRoomState(state.room, state.uid, firebaseNow());
  if (!["ready", "active", "expired"].includes(view.phase)) return;
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
    const startedAt = Number(view.turn?.startedAt || 0);
    if (!startedAt) return;
    const remaining = Math.max(0, TRAINING_TURN_DURATION_MS - (firebaseNow() - startedAt));
    const seconds = Math.ceil(remaining / 1000);
    const fill = document.querySelector("#trainingCountdownFill");
    const clock = document.querySelector("#trainingCountdown");
    const progress = document.querySelector("#trainingCountdownProgress");
    if (fill) fill.style.width = `${(remaining / TRAINING_TURN_DURATION_MS) * 100}%`;
    if (clock) clock.textContent = String(seconds);
    if (progress) {
      progress.setAttribute("aria-valuenow", String(seconds));
      progress.setAttribute("aria-label", `残り${seconds}秒`);
    }
    const instruction = normalizeTrainingInstruction(view.turn?.instruction);
    const beat = trainingBeatState({
      startedAt,
      now: firebaseNow(),
      bpm: instruction.bpm,
      beatsPerRep: instruction.beatsPerRep,
    });
    document.querySelectorAll("#trainingBeatLane [data-beat]").forEach((item) => {
      item.classList.toggle("is-active", beat.enabled && Number(item.dataset.beat) === beat.beat);
    });
    if (remaining <= 0) markTimeout().catch(handleRecoverableError);
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
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  releaseTrainingTabOwnership();
  state.screen = "setup";
  setTrainingChrome("鍛え合い READY");
  render();
}

async function cancelPendingRoom() {
  const roomId = state.pendingRoomId;
  await teardownPendingRoom("player_cancelled");
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  releaseTrainingTabOwnership();
  if (roomId) await releaseMatchLock(roomId);
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
  state.queueHeartbeat = null;
  state.matchTimer = null;
  state.enterRoomRetryTimer = null;
  state.enterRoomRetryAttempts = 0;
  state.inviteRetryTimer = null;
  state.matchmakingUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  const handles = state.disconnectHandles.splice(0);
  await Promise.allSettled(handles.map((handle) => handle?.cancel?.()));
  if (!keepActive && expectedRoomId && state.uid && !state.preview) {
    await releaseTrainingActiveReservation(expectedRoomId);
  }
  if (!state.uid || state.preview || !trainingSharedStateOwned || !queueSessionId) return;
  const invitesCleared = await cleanupTrainingInvitesForSession(queueSessionId);
  if (!invitesCleared) return;
  const queueCleared = await removeOwnedTrainingQueue(queueSessionId);
  if (queueCleared && state.queueSessionId === queueSessionId) state.queueSessionId = "";
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
  await cancelActiveRoomDestroyedDisconnect(state.roomId);
  active = false;
  state.generation += 1;
  window.clearTimeout(state.finalizeTimer);
  window.clearTimeout(state.cheerTimer);
  clearImageExchangeWatchdog();
  clearTurnTicker();
  await cleanupMatchmaking(false);
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
  releaseImage(state.localImage);
  releaseImage(state.remoteImage);
  state.localImage = null;
  state.remoteImage = null;
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
  await cleanupMatchmaking(false).catch(() => {});
  await cleanupPublicPresence().catch(() => {});
  releaseTrainingTabOwnership();
  state.errorMessage = error?.message || "鍛え合い60を開始できませんでした。";
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
    sessions: 8,
    completedSets: 14,
    completeDays: 6,
    currentStreak: 3,
    bestStreak: 5,
  };
  state.daily = { trainingSets: 1 };
  state.localImage = {
    blob: new Blob(["preview"], { type: "image/webp" }),
    url: previewImageUrl("ICE COLD BEER", "#117f99", "#081322"),
  };
  if (preview === "setup") {
    state.screen = "setup";
    render();
    return;
  }
  const now = Date.now();
  state.remoteImage = {
    blob: new Blob(["preview"], { type: "image/webp" }),
    url: previewImageUrl("TONKOTSU RAMEN", "#e66a2c", "#2b1012"),
  };
  state.roomId = "training-preview-room";
  state.room = {
    ...emptyRoom(),
    protocolVersion: TRAINING_PROTOCOL_VERSION,
    variant: TRAINING_VARIANT,
    hostUid: "preview-partner",
    guestUid: "preview-self",
    status: "active",
    firstTrainerUid: "preview-partner",
    members: { "preview-partner": true, "preview-self": true },
    players: {
      "preview-partner": {
        uid: "preview-partner", name: "TRAINER", intensity: "standard", conditions: "指定なし",
      },
      "preview-self": {
        uid: "preview-self", name: "ANJU", intensity: "standard", conditions: "ジャンプなし",
      },
    },
    accepted: { "preview-partner": true, "preview-self": true },
    imageReceived: { "preview-partner": true, "preview-self": true },
    turns: {
      1: {
        trainerUid: "preview-partner",
        traineeUid: "preview-self",
        instruction: normalizeTrainingInstruction(PRESETS.squat),
        createdAt: now - 20_000,
        startedAt: now - 17_000,
        ...(preview === "result" ? { surrenderedAt: now - 1_000 } : {}),
      },
    },
  };
  if (preview === "result") {
    state.outcome = deriveTrainingRoomState(state.room, state.uid, now);
    state.finalization = {
      result: {
        status: "final",
        outcome: "loss",
        reason: "surrender",
        completedSets: 2,
        turnCount: 3,
      },
      profile: {
        sessions: 8,
        completedSets: 14,
        completeDays: 6,
        currentStreak: 3,
        bestStreak: 5,
      },
      daily: { trainingSets: 1 },
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
  clearImageExchangeWatchdog();
  clearTurnTicker();
  state.ambienceController.destroy();
  state.channel?.close();
  state.peer?.close();
  releaseImage(state.localImage);
  releaseImage(state.remoteImage);
}, { once: true });

window.HariaiTraining = {
  start,
  isActive,
  requestHome,
  destroyRoom,
};
window.dispatchEvent(new CustomEvent("hariai-training-ready"));

if (isPreviewRequest()) queueMicrotask(start);
