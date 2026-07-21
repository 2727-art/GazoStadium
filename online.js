import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getDatabase,
  get,
  limitToLast,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const MAX_HP = 30;
const MAX_ROUNDS = 5;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const MATCH_TIMEOUT_MS = 20_000;
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const PUBLIC_PRESENCE_FRESH_MS = 45_000;
const PUBLIC_PRESENCE_HEARTBEAT_MS = 20_000;

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const fxLayer = document.querySelector("#fxLayer");

let active = false;
let state = createOnlineState();
let lobbyPresenceEntries = {};
let lobbyStats = { online: null, waiting: null, playing: null };

function createOnlineState() {
  return {
    screen: "setup",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    profile: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 },
    authReady: false,
    deck: [],
    roomId: "",
    room: null,
    opponentUid: "",
    playerIndex: 0,
    players: [],
    round: 1,
    selectedCardId: "",
    selectedScore: null,
    remoteImages: new Map(),
    history: [],
    outcome: null,
    processedRounds: new Set(),
    continuedRounds: new Set(),
    sentImageRounds: new Set(),
    roundData: {},
    chatMessages: [],
    seenChatIds: new Set(),
    matchingBusy: false,
    acceptingOffer: false,
    pendingIncomingOffer: null,
    activeUsers: {},
    latestQueue: {},
    pendingOffer: null,
    matchTimer: null,
    queueHeartbeat: null,
    publicPresenceId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    offerPollTimer: null,
    hostStatusPollTimer: null,
    matchUnsubscribers: [],
    roomUnsubscribers: [],
    roundUnsubscribe: null,
    disconnectHandles: [],
    peer: null,
    channel: null,
    channelReady: false,
    peerStatus: "未接続",
    pendingIce: [],
    incomingTransfer: null,
    transferProgress: 0,
    opponentOnline: true,
    statsCommitted: false,
    destroyedByOpponent: false,
  };
}

const shared = () => window.HariaiApp?.shared;
const escapeHtml = (value) => shared()?.escapeHtml(value) ?? String(value);
const showToast = (message) => shared()?.showToast(message);
const setBusy = (busy, message) => shared()?.setBusy(busy, message);

function start() {
  if (active) return;
  if (location.protocol === "file:") {
    showToast("オンライン対戦はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  active = true;
  state = createOnlineState();
  setOnlineChrome("CONNECTING");
  render();
  ensureAuthenticated().catch(handleFatalError);
}

function isActive() {
  return active;
}

function getLobbyStats() {
  return { ...lobbyStats };
}

function refreshLobbyStats() {
  const freshAfter = Date.now() - PUBLIC_PRESENCE_FRESH_MS;
  const entries = Object.values(lobbyPresenceEntries).filter((entry) => (
    Number(entry?.lastSeen) >= freshAfter && (entry?.state === "waiting" || entry?.state === "playing")
  ));
  const waiting = entries.filter((entry) => entry.state === "waiting").length;
  const playing = entries.filter((entry) => entry.state === "playing").length;
  lobbyStats = { online: waiting + playing, waiting, playing };
  const values = {
    lobbyOnlineCount: lobbyStats.online,
    lobbyWaitingCount: lobbyStats.waiting,
    lobbyPlayingCount: lobbyStats.playing,
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = String(value);
  });
}

function watchLobbyStats() {
  onValue(ref(database, "online/publicPresence"), (snapshot) => {
    lobbyPresenceEntries = snapshot.val() || {};
    refreshLobbyStats();
  }, () => {
    lobbyPresenceEntries = {};
    lobbyStats = { online: null, waiting: null, playing: null };
  });
  window.setInterval(refreshLobbyStats, 10_000);
}

async function ensureAuthenticated() {
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!active) return;
  state.uid = credential.user.uid;
  const profileSnapshot = await get(ref(database, `online/profiles/${state.uid}`));
  if (profileSnapshot.exists()) {
    state.profile = { ...state.profile, ...profileSnapshot.val() };
    if (!localStorage.getItem(PROFILE_NAME_KEY) && state.profile.name) state.name = state.profile.name;
  }
  state.authReady = true;
  setOnlineChrome("ONLINE READY");
  render();
}

function setOnlineChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "P2P画像転送";
  if (footerItems[0]) footerItems[0].textContent = "ONLINE 1ON1 / FIREBASE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "画像本体は対戦相手へ直接送信し、サーバーへ保存しません";
}

function render() {
  if (!active) return;
  const renderers = {
    setup: renderSetup,
    matching: renderMatching,
    connecting: renderConnecting,
    select: renderRoundSelect,
    waitingPick: renderWaitingPick,
    waitingImage: renderWaitingImage,
    reveal: renderReveal,
    score: renderScore,
    waitingScore: renderWaitingScore,
    result: renderRoundResult,
    waitingContinue: renderWaitingContinue,
    gameover: renderGameOver,
    noContest: renderNoContest,
    error: renderError,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderSetup)();
  bindScreenEvents();
  appRoot.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSetup() {
  const slots = Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const item = state.deck[index];
    if (!item) return `<div class="deck-slot empty" aria-label="空きスロット ${index + 1}">${String(index + 1).padStart(2, "0")}</div>`;
    return `<div class="deck-slot">
      <img src="${item.url}" alt="選択画像 ${index + 1}" draggable="false" />
      <div class="deck-label"><span>ENTRY ${String(index + 1).padStart(2, "0")}</span>
        <button class="remove-card" data-online-remove="${item.id}" aria-label="画像${index + 1}を削除">×</button>
      </div>
    </div>`;
  }).join("");
  const ready = state.authReady && state.deck.length === MAX_ROUNDS && state.name.trim();
  const profile = state.profile;
  return `<section class="screen">
    <div class="section-head">
      <div><span class="eyebrow">ONLINE DECK SETUP</span><h1>オンライン対戦の準備</h1>
        <p>画像を5枚選んでから、待機中のプレイヤーとランダムに対戦します。</p></div>
      <button class="button button-ghost button-small" id="onlineBackHome">タイトルへ</button>
    </div>
    <div class="online-profile-strip">
      <span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● Firebase接続済み" : "○ Firebaseへ接続中…"}</span>
      <span>戦績 ${profile.wins}勝 ${profile.losses}敗 ${profile.draws}分</span>
      <span>🔥 ${profile.streak}連勝中 / 最高${profile.bestStreak}</span>
    </div>
    <div class="setup-layout">
      <aside class="setup-guide">
        <h2>オンライン画像の取り扱い</h2>
        <ol class="guide-list">
          <li><b>1</b><span>最大1600pxのWebPに変換し、EXIFなどの付随情報を除去します。</span></li>
          <li><b>2</b><span>画像はWebRTCで対戦相手へ直接送信し、Firebaseには保存しません。</span></li>
          <li><b>3</b><span>対戦終了・ルーム破棄・ページ終了時に画像参照を解放します。</span></li>
        </ol>
        <div class="privacy-note">スクリーンショットなど、相手側での保存を完全に防ぐことはできません。</div>
      </aside>
      <div class="setup-panel">
        <label class="field-label">表示名
          <input class="text-input" id="onlinePlayerName" maxlength="16" value="${escapeHtml(state.name)}" autocomplete="nickname" />
        </label>
        <div class="deck-toolbar">
          <div class="deck-counter"><strong>${state.deck.length}</strong> / 5 IMAGES</div>
          <div class="upload-actions">
            <label class="button button-cyan button-small file-button">画像を追加
              <input id="onlineImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple ${state.deck.length >= MAX_ROUNDS ? "disabled" : ""} />
            </label>
            <button class="button button-ghost button-small" id="onlineFillSample">サンプル画像で埋める</button>
          </div>
        </div>
        <div class="deck-grid">${slots}</div>
        <div class="setup-actions">
          <button class="button button-primary" id="findOpponent" ${ready ? "" : "disabled"}>ランダム対戦を探す</button>
        </div>
      </div>
    </div>
  </section>`;
}

function renderMatching() {
  return renderStatusCard({
    icon: "◎",
    eyebrow: "RANDOM MATCHING",
    title: "対戦相手を探しています",
    body: "待機中のプレイヤーからランダムにマッチングします。この画面を開いたままお待ちください。",
    details: `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">● 匿名ログイン済み</span>`,
    actions: `<button class="button button-ghost" id="cancelMatching">マッチングをやめる</button>`,
  });
}

function renderConnecting() {
  const opponent = getOpponent();
  return renderStatusCard({
    icon: "VS",
    eyebrow: "MATCH FOUND",
    title: `${escapeHtml(opponent?.name || "対戦相手")}とマッチング`,
    body: "画像を一時転送するためのP2P接続を準備しています。Firebaseには画像をアップロードしません。",
    details: `<span class="connection-pill ${state.channelReady ? "connected" : ""}">${escapeHtml(state.peerStatus)}</span>`,
    actions: `<button class="button button-danger button-small" data-online-destroy>ルーム破棄</button>`,
  });
}

function renderStatusCard({ icon, eyebrow, title, body, details = "", actions = "" }) {
  return `<section class="screen handoff-wrap"><div class="handoff-card online-status-card">
    <div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
    <span class="eyebrow">${escapeHtml(eyebrow)}</span>
    <h1>${title}</h1><p>${escapeHtml(body)}</p>
    <div class="online-status-details">${details}</div><div class="button-row">${actions}</div>
  </div></section>`;
}

function renderOnlineHud() {
  const playerHtml = (player, index) => `<div class="hud-player ${index === state.playerIndex ? "local-player" : ""}">
    <div class="hud-name-row"><span class="hud-name">${escapeHtml(player.name)}${index === state.playerIndex ? "（あなた）" : ""}</span>
      ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</div>
    <div class="hp-bar" aria-label="${escapeHtml(player.name)} HP ${player.hp}/${MAX_HP}"><div class="hp-fill" style="--hp:${Math.max(0, (player.hp / MAX_HP) * 100)}%"></div></div>
    <span class="hp-value">HP ${Math.max(0, player.hp)} / ${MAX_HP}</span>
  </div>`;
  return `<div class="round-topbar">${playerHtml(state.players[0], 0)}
    <div class="round-badge"><small>ROUND</small><strong>${state.round} / ${MAX_ROUNDS}</strong></div>
    ${playerHtml(state.players[1], 1)}</div>
    <div class="online-room-strip"><span>ROOM ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span>
      <span class="connection-pill ${state.channelReady ? "connected" : ""}">${state.channelReady ? "● P2P接続中" : "○ 再接続待ち"}</span>
      <span class="connection-pill ${state.opponentOnline ? "connected" : "warning"}">${state.opponentOnline ? "● 相手オンライン" : "○ 相手の接続切れ"}</span></div>`;
}

function renderRoundSelect() {
  const cards = state.deck.map((item, index) => `<button class="select-card ${item.used ? "used" : ""} ${state.selectedCardId === item.id ? "selected" : ""}"
    data-online-card="${item.id}" ${item.used ? "disabled" : ""} aria-pressed="${state.selectedCardId === item.id}">
    <img src="${item.url}" alt="候補画像 ${index + 1}" draggable="false" /><span>${item.used ? "USED" : `ENTRY ${String(index + 1).padStart(2, "0")}`}</span>
  </button>`).join("");
  return `<section class="screen">${renderOnlineHud()}
    <div class="section-head"><div><span class="eyebrow">SECRET PICK</span><h1>あなたの画像選択</h1>
      <p>相手の選択が完了するまで、どの画像を選んだかは送信されません。</p></div>
      <button class="button button-danger button-small" data-online-destroy>ルーム破棄</button></div>
    <div class="select-panel"><div class="select-grid">${cards}</div>
      <div class="selection-footer"><p>画像IDや画像本体はロック完了まで相手へ送られません。</p>
        <button class="button button-primary" id="onlineLockSelection" ${state.selectedCardId ? "" : "disabled"}>この画像でロック</button></div></div>
    <div class="online-chat-standalone">${renderOnlineChat()}</div>
  </section>`;
}

function renderWaitingPick() {
  return renderBattleWait("SECRET PICK", "相手の画像選択を待っています", "選んだ画像はまだ相手へ送信していません。");
}

function renderWaitingImage() {
  return renderBattleWait("P2P IMAGE TRANSFER", "画像を安全に転送しています", `転送状況 ${state.transferProgress}%`);
}

function renderWaitingScore() {
  return renderBattleWait("PRIVATE SCORE", "相手の採点を待っています", "あなたの点数は相手の確定まで非公開です。");
}

function renderWaitingContinue() {
  return renderBattleWait("ROUND READY", "相手の準備を待っています", "両者が準備すると次の画面へ進みます。");
}

function renderBattleWait(eyebrow, title, body) {
  return `<section class="screen">${renderOnlineHud()}${renderStatusCard({
    icon: "…", eyebrow, title, body,
    details: `<div class="matching-pulse"><i></i><i></i><i></i></div>`,
    actions: `<button class="button button-danger button-small" data-online-destroy>ルーム破棄</button>`,
  }).replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace('</section>', '</div>')}
    <div class="online-chat-standalone">${renderOnlineChat()}</div></section>`;
}

function renderReveal() {
  const localItem = getSelectedItem();
  const remoteItem = state.remoteImages.get(state.round);
  const itemFor = (index) => index === state.playerIndex ? localItem : remoteItem;
  return `<section class="screen">${renderOnlineHud()}
    <div class="section-head"><div><span class="eyebrow">IMAGE REVEAL</span><h1>画像、オープン。</h1>
      <p>相手の一枚について、チャットで話してみましょう。</p></div>
      <button class="button button-danger button-small" data-online-destroy>ルーム破棄</button></div>
    <div class="battle-layout"><div class="arena-panel"><div class="arena-grid">
      ${renderArenaCard(0, itemFor(0))}<div class="arena-vs">VS</div>${renderArenaCard(1, itemFor(1))}
    </div><div class="arena-actions"><button class="button button-primary" id="onlineBeginScoring">相手の画像を採点</button></div></div>
    ${renderOnlineChat()}</div></section>`;
}

function renderArenaCard(index, item) {
  const player = state.players[index];
  return `<article class="arena-card ${index === 0 ? "player-one" : "player-two"}">
    <div class="arena-image"><img src="${item?.url || ""}" alt="${escapeHtml(player.name)}が出した画像" draggable="false" /></div>
    <div class="arena-meta"><strong>${escapeHtml(player.name)}${index === state.playerIndex ? "（あなた）" : ""}</strong><span>ROUND ${state.round}</span></div>
  </article>`;
}

function renderScore() {
  const opponent = getOpponent();
  const item = state.remoteImages.get(state.round);
  const buttons = Array.from({ length: 10 }, (_, index) => index + 1).map((score) => `<button
    class="score-button ${score >= 8 ? "critical-zone" : ""} ${state.selectedScore === score ? "selected" : ""}"
    data-online-score="${score}" aria-pressed="${state.selectedScore === score}">${score}</button>`).join("");
  return `<section class="screen">${renderOnlineHud()}<div class="score-layout">
    <div class="score-image"><img src="${item?.url || ""}" alt="${escapeHtml(opponent?.name || "相手")}の採点対象画像" draggable="false" /></div>
    <div class="score-panel"><span class="eyebrow">YOUR PRIVATE SCORE</span><h2>${escapeHtml(opponent?.name || "相手")}の画像を採点</h2>
      <p>1～10点を選択してください。確定後の変更はできません。</p><div class="score-buttons">${buttons}</div>
      <button class="button button-primary button-wide score-lock" id="onlineLockScore" ${state.selectedScore ? "" : "disabled"}>この点数で確定</button>
      <button class="button button-danger button-small" data-online-destroy>ルーム破棄</button></div>
  </div></section>`;
}

function renderRoundResult() {
  const result = state.history.at(-1);
  const labelFor = (score) => score === 10 ? "PERFECT!!" : score >= 8 ? "CRITICAL!" : score >= 6 ? "GREAT" : score >= 4 ? "GOOD" : "HIT";
  const damageText = result.winnerIndex === null ? "同点。両者ノーダメージです。" : `${state.players[result.loserIndex].name}に ${result.damage} DAMAGE。`;
  return `<section class="screen result-wrap">${renderOnlineHud()}<div class="result-card">
    <span class="eyebrow">ROUND ${state.round} RESULT</span><h1>${result.winnerIndex === null ? "DRAW ROUND" : `${escapeHtml(state.players[result.winnerIndex].name)} TAKES IT`}</h1>
    <div class="result-scores">${resultPlayerHtml(0, result.scorePlayerOne, result.winnerIndex, labelFor(result.scorePlayerOne))}
      <div class="result-vs">VS</div>${resultPlayerHtml(1, result.scorePlayerTwo, result.winnerIndex, labelFor(result.scorePlayerTwo))}</div>
    <div class="damage-callout">${escapeHtml(damageText)}</div><div class="result-chat">${renderOnlineChat()}</div>
    <div class="button-row" style="justify-content:center"><button class="button button-danger" data-online-destroy>ルーム破棄</button>
      <button class="button button-primary" id="onlineContinue">${isMatchOver() ? "試合結果を見る" : `ROUND ${state.round + 1}へ`}</button></div>
  </div></section>`;
}

function resultPlayerHtml(index, score, winnerIndex, label) {
  return `<div class="result-player ${winnerIndex === index ? "winner" : ""}"><strong>${escapeHtml(state.players[index].name)}</strong>
    <span>${score}</span><small>${escapeHtml(label)}</small></div>`;
}

function renderGameOver() {
  const outcome = state.outcome;
  const title = outcome.winnerIndex === null ? "引き分け" : `${escapeHtml(state.players[outcome.winnerIndex].name)} WIN`;
  const subtitle = outcome.reason === "hp" ? "HPが0になり、決着しました。" : outcome.reason === "draw" ? "すべての判定項目が同点でした。" : "5ラウンド終了。残りHPと獲得点で判定しました。";
  return `<section class="screen gameover-wrap"><div class="gameover-card"><div class="winner-emblem" aria-hidden="true">${outcome.winnerIndex === null ? "=" : "✦"}</div>
    <span class="eyebrow">ONLINE MATCH COMPLETE</span><h1>${title}</h1><p>${escapeHtml(subtitle)}</p>
    <div class="final-stats">${state.players.map((player, index) => `<div class="final-player ${outcome.winnerIndex === index ? "winner" : ""}">
      <h2>${escapeHtml(player.name)} ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</h2>
      <div class="stats-row"><div class="stat-box"><strong>${player.hp}</strong><span>残りHP</span></div>
      <div class="stat-box"><strong>${player.totalReceived}</strong><span>合計獲得点</span></div><div class="stat-box"><strong>${player.criticals}</strong><span>CRITICAL</span></div></div>
    </div>`).join("")}</div>
    <div class="gameover-actions"><button class="button button-primary" id="onlineNewMatch">別の相手を探す</button>
      <button class="button button-ghost" id="onlineGameoverHome">タイトルへ戻る</button></div>
  </div></section>`;
}

function renderNoContest() {
  return renderStatusCard({
    icon: "×", eyebrow: "NO CONTEST", title: "ルームが破棄されました",
    body: "この対戦は勝敗・勝率・連勝数に影響しません。画像とチャットへの参照を破棄しました。",
    actions: `<button class="button button-primary" id="onlineNoContestAgain">別の相手を探す</button><button class="button button-ghost" id="onlineNoContestHome">タイトルへ</button>`,
  });
}

function renderError() {
  return renderStatusCard({
    icon: "!", eyebrow: "CONNECTION ERROR", title: "オンライン接続に失敗しました",
    body: state.errorMessage || "通信状態を確認して、もう一度お試しください。",
    actions: `<button class="button button-primary" id="onlineRetry">もう一度試す</button><button class="button button-ghost" id="onlineErrorHome">タイトルへ</button>`,
  });
}

function renderOnlineChat() {
  const messages = state.chatMessages.length ? state.chatMessages.map((message) => {
    const authorIndex = state.players.findIndex((player) => player.uid === message.authorUid);
    return `<div class="chat-message ${authorIndex === 1 ? "player-two" : "player-one"}"><small>${escapeHtml(message.name)} / R${message.round}</small><p>${escapeHtml(message.text)}</p></div>`;
  }).join("") : `<div class="chat-empty">画像について話してみましょう。<br />チャットはルーム内の2人だけに表示されます。</div>`;
  return `<aside class="chat-panel"><div class="chat-head"><strong>ONLINE CHAT</strong><span>ルーム終了後に非表示</span></div>
    <div class="chat-messages" id="onlineChatMessages">${messages}</div>
    <div class="quick-reactions">${["すごい！", "かわいい", "センスいい", "もっと見たい"].map((text) => `<button class="reaction-button" data-online-reaction="${text}">${text}</button>`).join("")}</div>
    <form class="chat-form" id="onlineChatForm"><input class="chat-input" id="onlineChatInput" maxlength="80" placeholder="ひとこと送る…" autocomplete="off" aria-label="チャットメッセージ" />
      <button class="button button-cyan button-small" type="submit">送信</button></form></aside>`;
}

function bindScreenEvents() {
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("contextmenu", (event) => event.preventDefault());
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });
  document.querySelectorAll("[data-online-destroy]").forEach((button) => button.addEventListener("click", () => destroyDialog.showModal()));
  bindChatEvents();

  if (state.screen === "setup") bindSetupEvents();
  if (state.screen === "matching") document.querySelector("#cancelMatching")?.addEventListener("click", cancelMatching);
  if (state.screen === "select") bindSelectEvents();
  if (state.screen === "reveal") document.querySelector("#onlineBeginScoring")?.addEventListener("click", () => { state.screen = "score"; render(); });
  if (state.screen === "score") bindScoreEvents();
  if (state.screen === "result") document.querySelector("#onlineContinue")?.addEventListener("click", continueRound);
  if (state.screen === "gameover") {
    document.querySelector("#onlineNewMatch")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineGameoverHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "noContest") {
    document.querySelector("#onlineNoContestAgain")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineNoContestHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "error") {
    document.querySelector("#onlineRetry")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineErrorHome")?.addEventListener("click", leaveToLanding);
  }
}

function bindSetupEvents() {
  document.querySelector("#onlineBackHome")?.addEventListener("click", leaveToLanding);
  const nameInput = document.querySelector("#onlinePlayerName");
  nameInput?.addEventListener("input", () => {
    state.name = nameInput.value.slice(0, 16);
    const button = document.querySelector("#findOpponent");
    if (button) button.disabled = !state.authReady || state.deck.length !== MAX_ROUNDS || !state.name.trim();
  });
  document.querySelector("#onlineImageInput")?.addEventListener("change", handleImageInput);
  document.querySelector("#onlineFillSample")?.addEventListener("click", fillSampleDeck);
  document.querySelectorAll("[data-online-remove]").forEach((button) => button.addEventListener("click", () => removeDeckItem(button.dataset.onlineRemove)));
  document.querySelector("#findOpponent")?.addEventListener("click", beginMatchmaking);
}

function bindSelectEvents() {
  document.querySelectorAll("[data-online-card]").forEach((button) => button.addEventListener("click", () => {
    state.selectedCardId = button.dataset.onlineCard;
    render();
  }));
  document.querySelector("#onlineLockSelection")?.addEventListener("click", lockSelection);
}

function bindScoreEvents() {
  document.querySelectorAll("[data-online-score]").forEach((button) => button.addEventListener("click", () => {
    state.selectedScore = Number(button.dataset.onlineScore);
    render();
  }));
  document.querySelector("#onlineLockScore")?.addEventListener("click", lockScore);
}

function bindChatEvents() {
  document.querySelectorAll("[data-online-reaction]").forEach((button) => button.addEventListener("click", () => sendChat(button.dataset.onlineReaction)));
  document.querySelector("#onlineChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#onlineChatInput");
    sendChat(input.value);
    input.value = "";
    input.focus();
  });
  scrollChat();
}

async function handleImageInput(event) {
  const files = Array.from(event.target.files || []);
  const remaining = MAX_ROUNDS - state.deck.length;
  if (!files.length || remaining <= 0) return;
  setBusy(true, "画像を安全な形式に変換しています…");
  let added = 0;
  let firstError = "";
  for (const file of files.slice(0, remaining)) {
    try {
      state.deck.push(await shared().processImageFile(file, state.deck.length));
      added += 1;
    } catch (error) {
      firstError ||= error.message;
    }
  }
  setBusy(false);
  render();
  showToast(firstError ? `${added}枚追加。${firstError}` : `${added}枚の画像を追加しました。`);
}

async function fillSampleDeck() {
  const remaining = MAX_ROUNDS - state.deck.length;
  if (remaining <= 0) return showToast("5枚すべて選択済みです。");
  setBusy(true, "サンプル画像を生成しています…");
  state.deck.push(...await shared().createSampleItems(0, remaining, state.deck.length));
  setBusy(false);
  render();
}

function removeDeckItem(id) {
  const item = state.deck.find((candidate) => candidate.id === id);
  if (item?.url) URL.revokeObjectURL(item.url);
  state.deck = state.deck.filter((candidate) => candidate.id !== id);
  state.deck.forEach((candidate, index) => { candidate.position = index; });
  render();
}

async function beginMatchmaking() {
  state.name = state.name.trim().slice(0, 16);
  if (!state.uid || state.deck.length !== MAX_ROUNDS || !state.name) return;
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  state.screen = "matching";
  setOnlineChrome("MATCHING");
  render();

  const ownActiveRef = ref(database, `online/active/${state.uid}`);
  const staleActive = await get(ownActiveRef);
  if (staleActive.exists()) await remove(ownActiveRef);
  const ownOffersRef = ref(database, `online/offers/${state.uid}`);
  const staleOffers = await get(ownOffersRef);
  if (staleOffers.exists()) {
    await Promise.allSettled(Object.keys(staleOffers.val()).map((roomId) => (
      remove(ref(database, `online/offers/${state.uid}/${roomId}`))
    )));
  }
  const queueEntryRef = ref(database, `online/queue/${state.uid}`);
  await set(queueEntryRef, {
    uid: state.uid,
    name: state.name,
    streak: Number(state.profile.streak || 0),
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    state: "waiting",
  });
  await startPublicPresence();
  const queueDisconnect = onDisconnect(queueEntryRef);
  await queueDisconnect.remove();
  state.disconnectHandles.push(queueDisconnect);
  state.queueHeartbeat = window.setInterval(() => {
    update(queueEntryRef, { lastSeen: Date.now() })
      .then(() => attemptToHost(state.latestQueue))
      .catch(() => {});
  }, 20_000);

  state.matchUnsubscribers.push(onValue(ownOffersRef, processIncomingOffers, handleRecoverableError));
  state.offerPollTimer = window.setInterval(() => {
    if (!active || state.screen !== "matching" || state.roomId) return;
    get(ownOffersRef).then(processIncomingOffers).catch(handleRecoverableError);
  }, 1_500);
  state.matchUnsubscribers.push(onValue(ref(database, "online/active"), (snapshot) => {
    state.activeUsers = snapshot.val() || {};
    attemptToHost(state.latestQueue).catch(handleRecoverableError);
  }));
  state.matchUnsubscribers.push(onValue(ref(database, "online/queue"), (snapshot) => {
    state.latestQueue = snapshot.val() || {};
    attemptToHost(state.latestQueue).catch(handleRecoverableError);
  }));
}

async function startPublicPresence() {
  await cleanupPublicPresence();
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  const ownerRef = ref(database, `online/publicPresenceOwners/${presenceId}`);
  const presenceRef = ref(database, `online/publicPresence/${presenceId}`);
  await set(ownerRef, state.uid);
  await set(presenceRef, { state: "waiting", lastSeen: Date.now() });
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.remove();
  state.publicPresenceId = presenceId;
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = presenceDisconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (!state.publicPresenceId) return;
    update(ref(database, `online/publicPresence/${state.publicPresenceId}`), {
      state: state.publicPresenceState,
      lastSeen: Date.now(),
    }).catch(() => {});
  }, PUBLIC_PRESENCE_HEARTBEAT_MS);
}

async function updatePublicPresence(nextState) {
  if (!state.publicPresenceId) return;
  state.publicPresenceState = nextState;
  await update(ref(database, `online/publicPresence/${state.publicPresenceId}`), {
    state: nextState,
    lastSeen: Date.now(),
  });
}

async function cleanupPublicPresence() {
  window.clearInterval(state.publicPresenceHeartbeat);
  state.publicPresenceHeartbeat = null;
  await state.publicPresenceDisconnect?.cancel?.().catch(() => {});
  state.publicPresenceDisconnect = null;
  const presenceId = state.publicPresenceId;
  state.publicPresenceId = "";
  state.publicPresenceState = "";
  if (!presenceId || !state.uid) return;
  await remove(ref(database, `online/publicPresence/${presenceId}`)).catch(() => {});
  await remove(ref(database, `online/publicPresenceOwners/${presenceId}`)).catch(() => {});
}

function processIncomingOffers(snapshot) {
  const offers = snapshot.val() || {};
  const newest = Object.entries(offers).sort(([, first], [, second]) => Number(second.createdAt) - Number(first.createdAt))[0];
  state.pendingIncomingOffer = newest ? { roomId: newest[0], offer: newest[1] } : null;
  drainIncomingOffers().catch(handleRecoverableError);
}

async function attemptToHost(queue) {
  if (!active || state.screen !== "matching" || state.matchingBusy || state.acceptingOffer || state.pendingOffer) return;
  const freshAfter = Date.now() - 45_000;
  const waiting = Object.values(queue).filter((entry) => entry?.state === "waiting" && Number(entry.lastSeen) >= freshAfter && !state.activeUsers[entry.uid]);
  if (waiting.length < 2) return;
  waiting.sort((a, b) => (Number(a.joinedAt) - Number(b.joinedAt)) || String(a.uid).localeCompare(String(b.uid)));
  if (waiting[0].uid !== state.uid) return;
  const candidates = waiting.filter((entry) => entry.uid !== state.uid);
  if (!candidates.length) return;
  const candidate = candidates[Math.floor(Math.random() * candidates.length)];
  await createOffer(candidate);
}

async function createOffer(candidate) {
  state.matchingBusy = true;
  const roomId = push(ref(database, "online/rooms")).key;
  const ownActiveRef = ref(database, `online/active/${state.uid}`);
  try {
    const reservation = await runTransaction(ownActiveRef, (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const roomRef = ref(database, `online/rooms/${roomId}`);
    await set(ref(database, `online/rooms/${roomId}/hostUid`), state.uid);
    await update(roomRef, {
      guestUid: candidate.uid,
      createdAt: Date.now(),
      status: "offered",
      [`members/${state.uid}`]: true,
      [`members/${candidate.uid}`]: true,
      [`players/${state.uid}`]: { uid: state.uid, name: state.name, streak: Number(state.profile.streak || 0) },
      [`players/${candidate.uid}`]: { uid: candidate.uid, name: candidate.name, streak: Number(candidate.streak || 0) },
    });
    await set(ref(database, `online/offers/${candidate.uid}/${roomId}`), {
      roomId,
      fromUid: state.uid,
      toUid: candidate.uid,
      fromName: state.name,
      createdAt: Date.now(),
    });
    await update(ref(database, `online/queue/${state.uid}`), { state: "offering", roomId });
    state.pendingOffer = { roomId, targetUid: candidate.uid };
    const roomStatusRef = ref(database, `online/rooms/${roomId}/status`);
    const handleHostedRoomStatus = async (snapshot) => {
      if (snapshot.val() !== "active" || state.roomId) return;
      await remove(ref(database, `online/offers/${candidate.uid}/${roomId}`)).catch(() => {});
      await enterRoom(roomId);
    };
    const unsubscribe = onValue(roomStatusRef, (snapshot) => {
      handleHostedRoomStatus(snapshot).catch(handleRecoverableError);
    }, handleRecoverableError);
    state.matchUnsubscribers.push(unsubscribe);
    state.hostStatusPollTimer = window.setInterval(() => {
      if (!active || state.screen !== "matching" || state.roomId || state.pendingOffer?.roomId !== roomId) return;
      get(roomStatusRef).then(handleHostedRoomStatus).catch(handleRecoverableError);
    }, 1_500);
    state.matchTimer = window.setTimeout(() => expireOffer(roomId, candidate.uid), MATCH_TIMEOUT_MS);
  } finally {
    state.matchingBusy = false;
  }
}

async function expireOffer(roomId, targetUid) {
  if (state.roomId || state.pendingOffer?.roomId !== roomId) return;
  const result = await runTransaction(ref(database, `online/rooms/${roomId}/status`), (current) => current === "offered" ? "expired" : undefined);
  if (!result.committed) return;
  await Promise.allSettled([
    remove(ref(database, `online/offers/${targetUid}/${roomId}`)),
    remove(ref(database, `online/active/${state.uid}`)),
    update(ref(database, `online/queue/${state.uid}`), { state: "waiting", roomId: null }),
  ]);
  state.pendingOffer = null;
}

async function acceptOffer(roomId, offer) {
  if (!active || state.screen !== "matching" || state.roomId) return;
  if (!offer || offer.toUid !== state.uid) return;
  state.acceptingOffer = true;
  try {
    const roomSnapshot = await get(ref(database, `online/rooms/${roomId}`));
    const room = roomSnapshot.val();
    if (!room || room.status !== "offered" || !room.members?.[state.uid]) {
      await remove(ref(database, `online/offers/${state.uid}/${roomId}`));
      return;
    }
    const reservation = await runTransaction(ref(database, `online/active/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const roomStatusRef = ref(database, `online/rooms/${roomId}/status`);
    const currentStatus = await get(roomStatusRef);
    if (currentStatus.val() !== "offered") {
      await remove(ref(database, `online/active/${state.uid}`));
      return;
    }
    await set(roomStatusRef, "active");
    await Promise.allSettled([
      remove(ref(database, `online/offers/${state.uid}/${roomId}`)),
      remove(ref(database, `online/queue/${state.uid}`)),
    ]);
    await enterRoom(roomId);
  } finally {
    state.acceptingOffer = false;
  }
}

async function drainIncomingOffers() {
  if (state.acceptingOffer) return;
  while (active && state.screen === "matching" && !state.roomId && state.pendingIncomingOffer) {
    const incoming = state.pendingIncomingOffer;
    state.pendingIncomingOffer = null;
    await acceptOffer(incoming.roomId, incoming.offer);
  }
}

async function enterRoom(roomId) {
  if (state.roomId) return;
  window.clearTimeout(state.matchTimer);
  state.roomId = roomId;
  const snapshot = await get(ref(database, `online/rooms/${roomId}`));
  const room = snapshot.val();
  if (!room || !room.members?.[state.uid]) throw new Error("ルーム情報を取得できませんでした。");
  state.room = room;
  state.opponentUid = room.hostUid === state.uid ? room.guestUid : room.hostUid;
  state.playerIndex = room.hostUid === state.uid ? 0 : 1;
  state.players = [room.players[room.hostUid], room.players[room.guestUid]].map((player) => ({
    ...player,
    hp: MAX_HP,
    totalReceived: 0,
    criticals: 0,
    perfects: 0,
  }));
  await cleanupMatchmaking(true);
  await updatePublicPresence("playing");
  state.screen = "connecting";
  state.peerStatus = "P2P接続を準備中…";
  setOnlineChrome("ONLINE BATTLE");
  render();
  await setupRoomListeners();
  await setupPeerConnection();
}

async function setupRoomListeners() {
  const base = `online/rooms/${state.roomId}`;
  const activeDisconnect = onDisconnect(ref(database, `online/active/${state.uid}`));
  await activeDisconnect.remove();
  state.disconnectHandles.push(activeDisconnect);
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() });
  state.disconnectHandles.push(presenceDisconnect);

  state.roomUnsubscribers.push(onValue(ref(database, `${base}/destroyed`), (snapshot) => {
    if (snapshot.exists() && snapshot.val().by !== state.uid) handleOpponentDestroyed();
  }));
  state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${state.opponentUid}`), (snapshot) => {
    state.opponentOnline = snapshot.val()?.online !== false;
    document.querySelectorAll(".online-room-strip .connection-pill")[1]?.classList.toggle("warning", !state.opponentOnline);
  }));
  const chatQuery = query(ref(database, `${base}/chat`), limitToLast(50));
  state.roomUnsubscribers.push(onChildAdded(chatQuery, (snapshot) => {
    if (state.seenChatIds.has(snapshot.key)) return;
    state.seenChatIds.add(snapshot.key);
    state.chatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.chatMessages.length > 50) state.chatMessages.shift();
    refreshChat();
  }));
  listenToRound();
}

function listenToRound() {
  state.roundUnsubscribe?.();
  state.roundUnsubscribe = onValue(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}`), (snapshot) => {
    state.roundData = snapshot.val() || {};
    reactToRoundData().catch(handleRecoverableError);
  });
}

async function setupPeerConnection() {
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC画像転送に対応していません。");
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  state.peer = peer;
  peer.onicecandidate = (event) => {
    if (event.candidate) sendSignal("candidate", event.candidate.toJSON()).catch(handleRecoverableError);
  };
  peer.onconnectionstatechange = () => {
    state.peerStatus = peer.connectionState === "connected" ? "● P2P接続済み" : `P2P: ${peer.connectionState}`;
    if (["failed", "closed"].includes(peer.connectionState) && active && state.screen !== "noContest") {
      showToast("P2P接続が切れました。ルーム破棄で退出できます。");
    }
    if (state.screen === "connecting") render();
  };
  peer.ondatachannel = (event) => configureDataChannel(event.channel);

  const signalsRef = ref(database, `online/rooms/${state.roomId}/signals/${state.uid}`);
  state.roomUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try {
      await handleSignal(snapshot.val());
    } finally {
      await remove(snapshot.ref).catch(() => {});
    }
  }));

  if (state.playerIndex === 0) {
    const channel = peer.createDataChannel("hariai-images", { ordered: true });
    configureDataChannel(channel);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendSignal("offer", { type: offer.type, sdp: offer.sdp });
  }
}

async function sendSignal(type, payload) {
  await set(push(ref(database, `online/rooms/${state.roomId}/signals/${state.opponentUid}`)), {
    fromUid: state.uid,
    type,
    payload: JSON.stringify(payload),
    createdAt: Date.now(),
  });
}

async function handleSignal(signal) {
  if (!signal || signal.fromUid !== state.opponentUid || !state.peer) return;
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
    state.channelReady = true;
    state.peerStatus = "● P2P接続済み";
    if (state.screen === "connecting") {
      state.screen = "select";
      render();
    }
  };
  channel.onclose = () => {
    state.channelReady = false;
    state.peerStatus = "P2P接続が切れました";
  };
  channel.onerror = () => showToast("画像転送で通信エラーが発生しました。");
  channel.onmessage = (event) => handleChannelMessage(event.data).catch(handleRecoverableError);
}

async function handleChannelMessage(data) {
  if (typeof data === "string") {
    const message = JSON.parse(data);
    if (message.type === "image-start") {
      state.incomingTransfer = { round: message.round, mime: message.mime, size: message.size, chunks: [], received: 0 };
    } else if (message.type === "image-end") {
      await finishIncomingImage(message.round);
    }
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  state.incomingTransfer.chunks.push(chunk);
  state.incomingTransfer.received += chunk.byteLength;
  state.transferProgress = Math.min(99, Math.round((state.incomingTransfer.received / state.incomingTransfer.size) * 100));
  if (state.screen === "waitingImage") updateTransferText();
}

async function finishIncomingImage(round) {
  const transfer = state.incomingTransfer;
  if (!transfer || transfer.round !== round || transfer.received !== transfer.size) throw new Error("受信画像のサイズが一致しませんでした。");
  const previous = state.remoteImages.get(round);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  const blob = new Blob(transfer.chunks, { type: transfer.mime || "image/webp" });
  state.remoteImages.set(round, { blob, url: URL.createObjectURL(blob) });
  state.incomingTransfer = null;
  state.transferProgress = 100;
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${round}/imagesReceived/${state.uid}`), true);
}

async function lockSelection() {
  if (!state.selectedCardId || !state.channelReady) return;
  state.screen = "waitingPick";
  render();
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}/picks/${state.uid}`), {
    ready: true,
    lockedAt: serverTimestamp(),
  });
}

async function reactToRoundData() {
  const picks = state.roundData.picks || {};
  if (picks[state.uid]?.ready && picks[state.opponentUid]?.ready && !state.sentImageRounds.has(state.round)) {
    await sendSelectedImage();
  }
  const received = state.roundData.imagesReceived || {};
  if (received[state.uid] && received[state.opponentUid] && state.remoteImages.has(state.round)
      && ["waitingPick", "waitingImage"].includes(state.screen)) {
    state.screen = "reveal";
    render();
  }
  const scores = state.roundData.scores || {};
  if (Number.isInteger(scores[state.uid]) && Number.isInteger(scores[state.opponentUid])) resolveRound(scores);
  const continued = state.roundData.continue || {};
  if (continued[state.uid] && continued[state.opponentUid]) advanceAfterRound();
}

async function sendSelectedImage() {
  const item = getSelectedItem();
  if (!item?.blob || !state.channel || state.channel.readyState !== "open") return;
  state.sentImageRounds.add(state.round);
  state.screen = "waitingImage";
  state.transferProgress = 0;
  render();
  const buffer = await item.blob.arrayBuffer();
  try {
    state.channel.send(JSON.stringify({ type: "image-start", round: state.round, size: buffer.byteLength, mime: item.blob.type || "image/webp" }));
    for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
      await waitForDataBuffer();
      state.channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
      state.transferProgress = Math.round((Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES) / buffer.byteLength) * 100);
      updateTransferText();
    }
    state.channel.send(JSON.stringify({ type: "image-end", round: state.round }));
  } catch (error) {
    state.sentImageRounds.delete(state.round);
    throw error;
  }
}

function waitForDataBuffer() {
  if (!state.channel || state.channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { state.channel?.removeEventListener("bufferedamountlow", done); resolve(); };
    state.channel.addEventListener("bufferedamountlow", done, { once: true });
  });
}

function updateTransferText() {
  const card = document.querySelector(".online-status-card p");
  if (card && state.screen === "waitingImage") card.textContent = `転送状況 ${state.transferProgress}%`;
}

async function lockScore() {
  if (!state.selectedScore) return;
  const score = state.selectedScore;
  state.selectedScore = null;
  state.screen = "waitingScore";
  render();
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}/scores/${state.uid}`), score);
}

function resolveRound(scores) {
  if (state.processedRounds.has(state.round)) return;
  state.processedRounds.add(state.round);
  const scorePlayerOne = state.playerIndex === 0 ? scores[state.opponentUid] : scores[state.uid];
  const scorePlayerTwo = state.playerIndex === 0 ? scores[state.uid] : scores[state.opponentUid];
  state.players[0].totalReceived += scorePlayerOne;
  state.players[1].totalReceived += scorePlayerTwo;
  [scorePlayerOne, scorePlayerTwo].forEach((score, index) => {
    if (score >= 8) state.players[index].criticals += 1;
    if (score === 10) state.players[index].perfects += 1;
  });
  getSelectedItem().used = true;
  let winnerIndex = null;
  let loserIndex = null;
  let damage = 0;
  if (scorePlayerOne > scorePlayerTwo) { winnerIndex = 0; loserIndex = 1; damage = scorePlayerOne; }
  else if (scorePlayerTwo > scorePlayerOne) { winnerIndex = 1; loserIndex = 0; damage = scorePlayerTwo; }
  if (loserIndex !== null) state.players[loserIndex].hp = Math.max(0, state.players[loserIndex].hp - damage);
  state.history.push({ round: state.round, scorePlayerOne, scorePlayerTwo, winnerIndex, loserIndex, damage });
  state.screen = "result";
  render();
  const topScore = Math.max(scorePlayerOne, scorePlayerTwo);
  if (topScore >= 8) {
    window.HariaiAudio?.playResult(topScore);
    triggerCriticalFx(topScore === 10 ? "PERFECT!!" : "CRITICAL!");
  }
}

async function continueRound() {
  state.screen = "waitingContinue";
  render();
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}/continue/${state.uid}`), true);
}

function advanceAfterRound() {
  if (state.continuedRounds.has(state.round) || !state.processedRounds.has(state.round)) return;
  state.continuedRounds.add(state.round);
  if (isMatchOver()) {
    finishOnlineMatch().catch(handleRecoverableError);
    return;
  }
  releaseRemoteImage(state.round);
  state.round += 1;
  state.selectedCardId = "";
  state.selectedScore = null;
  state.roundData = {};
  state.transferProgress = 0;
  state.screen = "select";
  listenToRound();
  render();
}

function isMatchOver() {
  return state.players.some((player) => player.hp <= 0) || state.round >= MAX_ROUNDS;
}

function determineOutcome() {
  const [first, second] = state.players;
  if (first.hp !== second.hp) return { winnerIndex: first.hp > second.hp ? 0 : 1, reason: first.hp <= 0 || second.hp <= 0 ? "hp" : "rounds" };
  if (first.totalReceived !== second.totalReceived) return { winnerIndex: first.totalReceived > second.totalReceived ? 0 : 1, reason: "rounds" };
  if (first.criticals !== second.criticals) return { winnerIndex: first.criticals > second.criticals ? 0 : 1, reason: "rounds" };
  if (first.perfects !== second.perfects) return { winnerIndex: first.perfects > second.perfects ? 0 : 1, reason: "rounds" };
  return { winnerIndex: null, reason: "draw" };
}

async function finishOnlineMatch() {
  if (state.outcome) return;
  state.outcome = determineOutcome();
  await commitOnlineStats();
  await set(ref(database, `online/rooms/${state.roomId}/finished/${state.uid}`), true);
  state.screen = "gameover";
  render();
}

async function commitOnlineStats() {
  if (state.statsCommitted) return;
  state.statsCommitted = true;
  const myWon = state.outcome.winnerIndex === state.playerIndex;
  const draw = state.outcome.winnerIndex === null;
  const result = await runTransaction(ref(database, `online/profiles/${state.uid}`), (current) => {
    const record = {
      name: state.name,
      wins: Number(current?.wins || 0),
      losses: Number(current?.losses || 0),
      draws: Number(current?.draws || 0),
      streak: Number(current?.streak || 0),
      bestStreak: Number(current?.bestStreak || 0),
      updatedAt: Date.now(),
    };
    if (draw) record.draws += 1;
    else if (myWon) { record.wins += 1; record.streak += 1; record.bestStreak = Math.max(record.bestStreak, record.streak); }
    else { record.losses += 1; record.streak = 0; }
    return record;
  });
  if (result.committed) state.profile = result.snapshot.val();
  state.players.forEach((player, index) => {
    if (draw) return;
    player.streak = state.outcome.winnerIndex === index ? Number(player.streak || 0) + 1 : 0;
  });
}

async function sendChat(value) {
  const text = String(value || "").trim().slice(0, 80);
  if (!text || !state.roomId) return;
  await set(push(ref(database, `online/rooms/${state.roomId}/chat`)), {
    authorUid: state.uid,
    name: state.name,
    text,
    round: state.round,
    createdAt: serverTimestamp(),
  }).catch(() => showToast("チャットを送信できませんでした。"));
}

function refreshChat() {
  const list = document.querySelector("#onlineChatMessages");
  if (!list) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderOnlineChat();
  const next = wrapper.querySelector("#onlineChatMessages");
  if (next) list.innerHTML = next.innerHTML;
  scrollChat();
}

function scrollChat() {
  const list = document.querySelector("#onlineChatMessages");
  if (list) list.scrollTop = list.scrollHeight;
}

function getSelectedItem() {
  return state.deck.find((item) => item.id === state.selectedCardId);
}

function getOpponent() {
  return state.players[state.playerIndex === 0 ? 1 : 0];
}

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
}

function requestHome() {
  if (["setup", "matching", "gameover", "noContest", "error"].includes(state.screen)) {
    leaveToLanding();
  } else {
    destroyDialog.showModal();
  }
}

async function destroyRoom() {
  if (!active) return;
  if (state.roomId) {
    await runTransaction(ref(database, `online/rooms/${state.roomId}/destroyed`), (current) => current || { by: state.uid, at: Date.now() }).catch(() => {});
  }
  await cleanupOnlineResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
  showToast("ルームを破棄しました。戦績には影響しません。");
}

async function handleOpponentDestroyed() {
  if (state.destroyedByOpponent) return;
  state.destroyedByOpponent = true;
  await cleanupOnlineResources(false);
  releaseAllImages();
  state.screen = "noContest";
  setOnlineChrome("NO CONTEST");
  render();
}

async function cancelMatching() {
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  state.screen = "setup";
  setOnlineChrome("ONLINE READY");
  render();
}

async function resetOnlineSetup() {
  const identity = { uid: state.uid, profile: state.profile, authReady: state.authReady, name: state.name };
  await cleanupOnlineResources(false);
  releaseAllImages();
  state = createOnlineState();
  Object.assign(state, identity);
  state.screen = "setup";
  setOnlineChrome("ONLINE READY");
  render();
}

async function leaveToLanding() {
  await cleanupOnlineResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
}

async function cleanupMatchmaking(keepActive) {
  window.clearTimeout(state.matchTimer);
  window.clearInterval(state.queueHeartbeat);
  window.clearInterval(state.offerPollTimer);
  window.clearInterval(state.hostStatusPollTimer);
  state.matchTimer = null;
  state.queueHeartbeat = null;
  state.offerPollTimer = null;
  state.hostStatusPollTimer = null;
  state.matchUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  const removals = [remove(ref(database, `online/queue/${state.uid}`))];
  if (!keepActive) removals.push(remove(ref(database, `online/active/${state.uid}`)));
  if (state.pendingOffer) removals.push(remove(ref(database, `online/offers/${state.pendingOffer.targetUid}/${state.pendingOffer.roomId}`)));
  await Promise.allSettled(removals);
  state.pendingOffer = null;
  state.pendingIncomingOffer = null;
}

async function cleanupOnlineResources(keepActive) {
  await cleanupMatchmaking(keepActive);
  await cleanupPublicPresence();
  state.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.roundUnsubscribe?.();
  state.roundUnsubscribe = null;
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  if (state.peer) {
    state.peer.onicecandidate = null;
    state.peer.ondatachannel = null;
    state.peer.close();
  }
  state.channel?.close();
  state.peer = null;
  state.channel = null;
  if (state.roomId) {
    await Promise.allSettled([
      set(ref(database, `online/rooms/${state.roomId}/presence/${state.uid}`), { online: false, updatedAt: serverTimestamp() }),
      keepActive ? Promise.resolve() : remove(ref(database, `online/active/${state.uid}`)),
    ]);
  }
}

function releaseRemoteImage(round) {
  const item = state.remoteImages.get(round);
  if (item?.url) URL.revokeObjectURL(item.url);
  state.remoteImages.delete(round);
}

function releaseAllImages() {
  state.deck.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = "";
    item.blob = null;
  });
  state.remoteImages.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  state.remoteImages.clear();
  state.chatMessages = [];
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "通信処理に失敗しました。");
}

function handleFatalError(error) {
  console.error(error);
  state.errorMessage = friendlyFirebaseError(error);
  state.screen = "error";
  setOnlineChrome("CONNECTION ERROR");
  render();
}

function friendlyFirebaseError(error) {
  if (error?.code === "auth/admin-restricted-operation") return "Firebaseの匿名ログインが無効です。Authentication設定を確認してください。";
  if (error?.code === "PERMISSION_DENIED" || String(error?.message).includes("PERMISSION_DENIED")) return "Realtime Databaseのセキュリティルールにより接続が拒否されました。";
  return error?.message || "Firebaseへ接続できませんでした。";
}

window.addEventListener("beforeunload", () => {
  releaseAllImages();
  state.peer?.close();
});

watchLobbyStats();

window.HariaiOnline = { start, isActive, requestHome, destroyRoom, getLobbyStats };
window.dispatchEvent(new Event("hariai-online-ready"));
