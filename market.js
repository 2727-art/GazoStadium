import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  limitToLast,
  onChildAdded,
  onDisconnect,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import {
  auth,
  database,
  firestore,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v2";

const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const MARKET_ROLE_KEY = "hariai-stadium-value-market-role-v1";
const ENTRY_FEE = 5;
const MAX_TURNS = 3;
const MARKET_PRICES = Object.freeze([10, 25, 50, 100, 200, 300, 500]);
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 480 * 1024;
const TERMINAL_STATES = new Set(["sold", "ended", "canceled"]);

const useMarketPreview = useOfflineMarketPreview;
const economyActionCallable = httpsCallable(functions, "economyAction");
const marketQueueCallable = httpsCallable(functions, "valueMarketQueue");
const marketActionCallable = httpsCallable(functions, "valueMarketAction");
const marketRankingsCallable = httpsCallable(functions, "valueMarketRankings");
const appRoot = document.querySelector("#app");

let active = false;
let state = createState();
let lastRenderedScreen = "";
let lifecycleGeneration = 0;

function createState() {
  return {
    screen: "setup",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    role: localStorage.getItem(MARKET_ROLE_KEY) === "buyer" ? "buyer" : "seller",
    authReady: false,
    balance: 0,
    listingTitle: "",
    askingPrice: 50,
    pitchStyle: "either",
    maxBudget: 100,
    image: null,
    roomId: "",
    room: null,
    busy: false,
    queueJoinPending: false,
    errorMessage: "",
    queueHeartbeat: null,
    roomHeartbeat: null,
    roomHeartbeatPending: false,
    roomSyncRetry: null,
    roomSyncPending: false,
    roomSyncWarningShown: false,
    roomSyncRetryAttempts: 0,
    activeUnsubscribe: null,
    walletUnsubscribe: null,
    roomUnsubscribe: null,
    realtimeUnsubscribers: [],
    realtimeRoomId: "",
    presenceConnections: [],
    enteringRoomId: "",
    peer: null,
    peerTimeout: null,
    channel: null,
    channelReady: false,
    peerStatus: "P2P接続を準備中…",
    pendingIce: [],
    imageSent: false,
    outgoingTransfer: Promise.resolve(),
    incomingTransfer: null,
    remoteImage: null,
    chatMessages: [],
    seenChatIds: new Set(),
    pitchSentTurns: new Set(),
    audioMessages: [],
    pendingActionKey: "",
    pendingActionId: "",
    rankings: { sellers: [], buyers: [] },
    rankingsStatus: "idle",
  };
}

function isCurrentLifecycle(generation) {
  return active && generation === lifecycleGeneration;
}

function normalizeBuyerBudget() {
  if (state.role !== "buyer") return;
  const affordable = MARKET_PRICES.filter((price) => price + ENTRY_FEE <= state.balance);
  if (!affordable.length) {
    state.maxBudget = MARKET_PRICES[0];
    return;
  }
  if (!affordable.includes(Number(state.maxBudget))) state.maxBudget = affordable.at(-1);
}

function updateMarketBalance(value) {
  const balance = Number(value);
  if (!Number.isFinite(balance)) return;
  state.balance = Math.min(999_999, Math.max(0, Math.floor(balance)));
  normalizeBuyerBudget();
}

function marketActionIdentity(action, roomId, turn, extra = {}) {
  const actionKey = JSON.stringify([roomId, action, turn, Object.entries(extra).sort(([left], [right]) => left.localeCompare(right))]);
  if (state.pendingActionKey !== actionKey || !state.pendingActionId) {
    state.pendingActionKey = actionKey;
    state.pendingActionId = crypto.randomUUID();
  }
  return { actionId: state.pendingActionId, actionKey };
}

function clearMarketActionIdentity(actionId) {
  if (state.pendingActionId !== actionId) return;
  state.pendingActionKey = "";
  state.pendingActionId = "";
}

function shared() {
  return window.HariaiApp?.shared;
}

function escapeHtml(value) {
  return shared()?.escapeHtml?.(value) || String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeMarketName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 16) || "PLAYER";
}

function showToast(message) {
  shared()?.showToast?.(message);
}

function callableMessage(error, fallback) {
  const message = String(error?.message || "");
  const detail = message.includes(":") ? message.slice(message.lastIndexOf(":") + 1).trim() : message;
  return detail || fallback;
}

function setMarketChrome(status = "VALUE MARKET") {
  const statusBadge = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (statusBadge) statusBadge.innerHTML = `<i></i> ${escapeHtml(status)}`;
  if (privacy) privacy.textContent = "画像・音声保存なし";
  if (footerItems[0]) footerItems[0].textContent = "VALUE MARKET / CLOUD FUNCTIONS + FIRESTORE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "取引だけを記録し、画像と音声はP2Pで一時転送します";
}

function isActive() {
  return active;
}

async function start() {
  if (active) return;
  if (location.protocol === "file:") {
    showToast("VALUE MARKETはローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (window.HariaiOnline?.isActive?.() || window.HariaiStrategy?.isActive?.()
      || window.HariaiTeam?.isActive?.() || window.HariaiRoyale?.isActive?.()) {
    showToast("ほかのモードを終了してからVALUE MARKETを開始してください。");
    return;
  }
  active = true;
  const generation = ++lifecycleGeneration;
  state = createState();
  lastRenderedScreen = "";
  setMarketChrome("CONNECTING");
  render();
  ensureAuthenticated(generation).catch((error) => handleFatalError(error, generation));
}

async function ensureAuthenticated(generation) {
  if (useMarketPreview) {
    state.uid = "local-preview-user";
    updateMarketBalance(500);
    state.authReady = true;
    setMarketChrome("VALUE MARKET PREVIEW");
    render();
    return;
  }
  await setPersistence(auth, browserLocalPersistence);
  if (!isCurrentLifecycle(generation)) return;
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!isCurrentLifecycle(generation)) return;
  state.uid = credential.user.uid;
  const response = await economyActionCallable({ action: "initialize" });
  if (!isCurrentLifecycle(generation)) return;
  updateMarketBalance(response.data?.balance || 0);
  state.authReady = true;
  subscribeToActiveRoom(generation);
  subscribeToWallet(generation);
  setMarketChrome("VALUE MARKET");
  render();
}

function subscribeToActiveRoom(generation = lifecycleGeneration) {
  state.activeUnsubscribe?.();
  const uid = state.uid;
  state.activeUnsubscribe = onSnapshot(doc(firestore, "valueMarketActive", state.uid), (snapshot) => {
    if (!isCurrentLifecycle(generation) || state.uid !== uid) return;
    const roomId = snapshot.exists() ? String(snapshot.data()?.roomId || "") : "";
    if (roomId && roomId !== state.roomId) {
      enterRoom(roomId, generation).catch((error) => handleFatalError(error, generation));
    }
  }, (error) => handleFatalError(error, generation));
}

function subscribeToWallet(generation = lifecycleGeneration) {
  state.walletUnsubscribe?.();
  const uid = state.uid;
  state.walletUnsubscribe = onSnapshot(doc(firestore, "wallets", uid), (snapshot) => {
    if (!isCurrentLifecycle(generation) || state.uid !== uid || !snapshot.exists()) return;
    const previousBalance = state.balance;
    updateMarketBalance(snapshot.data()?.balance);
    if (state.balance !== previousBalance) render();
  }, (error) => handleFatalError(error, generation));
}

function render() {
  if (!active) return;
  const draft = document.querySelector("#marketChatInput")?.value ?? null;
  const playingAudio = [...document.querySelectorAll("audio[data-market-audio-key]")]
    .find((audio) => !audio.paused && !audio.ended);
  const playback = playingAudio ? {
    key: playingAudio.dataset.marketAudioKey,
    currentTime: playingAudio.currentTime,
  } : null;
  const screenChanged = lastRenderedScreen !== state.screen;
  if (state.screen === "setup") appRoot.innerHTML = renderSetup();
  else if (state.screen === "waiting") appRoot.innerHTML = renderWaiting();
  else if (state.screen === "rankings") appRoot.innerHTML = renderRankings();
  else if (state.screen === "room") appRoot.innerHTML = renderRoom();
  else appRoot.innerHTML = renderError();
  lastRenderedScreen = state.screen;
  bindEvents();
  const restoredDraft = document.querySelector("#marketChatInput");
  if (!screenChanged && restoredDraft && draft !== null) restoredDraft.value = draft;
  if (!screenChanged && playback) {
    const restoredAudio = [...document.querySelectorAll("audio[data-market-audio-key]")]
      .find((audio) => audio.dataset.marketAudioKey === playback.key);
    if (restoredAudio) {
      const resume = () => {
        try {
          restoredAudio.currentTime = playback.currentTime;
          restoredAudio.play().catch(() => {});
        } catch {
          // The next render can retry after metadata becomes available.
        }
      };
      if (restoredAudio.readyState >= 1) resume();
      else restoredAudio.addEventListener("loadedmetadata", resume, { once: true });
    }
  }
  if (screenChanged) {
    window.scrollTo(0, 0);
    appRoot.focus({ preventScroll: true });
  }
}

function renderWallet() {
  return `<div class="market-wallet"><span>MARKET WALLET</span><strong>${Math.floor(state.balance).toLocaleString("ja-JP")}<small>PT</small></strong><p>Functions管理の取引残高</p></div>`;
}

function renderSetup() {
  const seller = state.role === "seller";
  const imagePreview = state.image?.url
    ? `<figure class="market-listing-preview"><img src="${escapeHtml(state.image.url)}" alt="出品する画像のプレビュー" /><figcaption>${escapeHtml(state.listingTitle || "無題の推し")} / ${state.askingPrice}PT</figcaption></figure>`
    : `<div class="market-image-empty"><span>♡</span><strong>推し画像を1枚選択</strong><small>画像はFirebaseへ保存されません</small></div>`;
  return `<section class="screen market-screen market-setup">
    <div class="market-hero">
      <div><span class="eyebrow">END CONTENT / VALUE ROLEPLAY</span><h1>推し値市場 <small>VALUE MARKET</small></h1>
      <p>画像の魅力を営業し、点数ではなく実際のポイント価値で競うエンドコンテンツです。</p></div>
      ${renderWallet()}
    </div>
    <div class="market-role-tabs" role="tablist" aria-label="市場でのロール">
      <button type="button" class="${seller ? "is-active" : ""}" data-market-role="seller" role="tab" aria-selected="${seller}"><span>SELLER</span><strong>売り手</strong><small>画像の魅力を言葉や10秒音声で営業</small></button>
      <button type="button" class="${!seller ? "is-active" : ""}" data-market-role="buyer" role="tab" aria-selected="${!seller}"><span>BUYER</span><strong>買い手</strong><small>自分のポイントで推し値を評価</small></button>
    </div>
    <div class="market-entry-grid">
      <form class="market-entry-card" id="marketEntryForm">
        <label class="field"><span>プレイヤーネーム</span><input id="marketName" maxlength="16" value="${escapeHtml(state.name)}" required /></label>
        ${seller ? `<label class="market-image-picker">${imagePreview}<input id="marketImageInput" type="file" accept="image/*" /></label>
          <label class="field"><span>出品タイトル（30文字）</span><input id="marketListingTitle" maxlength="30" value="${escapeHtml(state.listingTitle)}" placeholder="この一枚の呼び名" required /></label>
          <div class="market-inline-fields">
            <label class="field"><span>販売価格</span><select id="marketAskingPrice">${MARKET_PRICES.map((price) => `<option value="${price}" ${price === Number(state.askingPrice) ? "selected" : ""}>${price} PT</option>`).join("")}</select></label>
            <label class="field"><span>営業方法</span><select id="marketPitchStyle"><option value="either" ${state.pitchStyle === "either" ? "selected" : ""}>チャット／10秒音声</option><option value="chat" ${state.pitchStyle === "chat" ? "selected" : ""}>チャット中心</option><option value="audio" ${state.pitchStyle === "audio" ? "selected" : ""}>10秒音声中心</option></select></label>
          </div>`
          : `<label class="field"><span>購入上限</span><select id="marketMaxBudget">${MARKET_PRICES.map((price) => `<option value="${price}" ${price === Number(state.maxBudget) ? "selected" : ""} ${price + ENTRY_FEE > state.balance ? "disabled" : ""}>${price} PT</option>`).join("")}</select><small>販売価格が上限以内の売り手だけとマッチします。着手料${ENTRY_FEE}PTは別途必要です。</small></label>`}
        <button class="button button-primary market-join-button" type="submit" ${!state.authReady || state.busy || (seller && !state.image) || (!seller && state.balance < 15) ? "disabled" : ""}>${state.busy ? "参加処理中…" : seller ? "売り手として待機する" : "買い手として待機する"}</button>
      </form>
      <aside class="market-rule-card">
        <span class="eyebrow">FAIR DEAL FLOW</span><h2>取引の流れ</h2>
        <ol><li><b>1</b><span>マッチ後、買い手は画像と価格を無料で確認します。</span></li><li><b>2</b><span>「営業を受ける」を選ぶと、着手料${ENTRY_FEE}PTをFunctionsが一時預かりします。</span></li><li><b>3</b><span>売り手がチャットまたは10秒音声で営業し、完了時に着手料を受け取ります。</span></li><li><b>4</b><span>購入・退室・追加検討を選択。追加検討は売り手が内金を買い手へ提示します。</span></li></ol>
        <div class="market-safety-note"><strong>POINT AUTHORITY</strong><p>残高移動はCloud Functionsだけが確定し、売買と独立ランキングをFirestoreの同一トランザクションで更新します。</p></div>
        <p class="market-roleplay-note">売買はTRPGとしてのロールプレイです。画像データや著作権・所有権は移転しません。画像の一時判定、音声通報機能は設けません。</p>
        <button class="button button-ghost" type="button" id="marketRankingsButton">売り手・買い手ランキング</button>
        ${useMarketPreview ? `<div class="market-preview-controls"><small>LOCAL UI PREVIEW</small><button type="button" data-market-preview-room="preview:buyer">買い手プレビュー画面</button><button type="button" data-market-preview-room="pitch:seller">売り手営業画面</button><button type="button" data-market-preview-room="decision:buyer">買い手決済画面</button><button type="button" data-market-preview-room="extension_offer:buyer">内金確認画面</button><button type="button" data-market-preview-room="sold:buyer">成立結果画面</button></div>` : ""}
      </aside>
    </div>
  </section>`;
}

function renderWaiting() {
  return `<section class="screen market-screen market-waiting"><div class="market-waiting-card">
    <div class="market-radar" aria-hidden="true"><i></i><i></i><span>♡</span></div>
    <span class="eyebrow">SEARCHING VALUE PARTNER</span><h1>${state.role === "seller" ? "買い手を探しています" : "売り手を探しています"}</h1>
    <p>${state.role === "seller" ? `${escapeHtml(state.listingTitle)} / ${state.askingPrice}PT` : `購入上限 ${state.maxBudget}PT`}で待機中です。</p>
    <small>ブラウザを閉じるかキャンセルすると待機列から外れます。</small>
    <button class="button button-ghost" id="marketCancelQueueButton" ${state.busy ? "disabled" : ""}>待機をキャンセル</button>
  </div></section>`;
}

function renderRankings() {
  const row = (entry, index, role) => `<li><span class="market-rank-number">${index + 1}</span><strong>${escapeHtml(entry.name)}</strong><em>${Number(entry.primary || 0).toLocaleString("ja-JP")} PT</em><small>${role === "seller" ? `成立${entry.count}件 / 最高${entry.best}PT` : `購入${entry.count}件 / 最高${entry.best}PT`}</small></li>`;
  const list = (entries, role) => entries.length
    ? entries.map((entry, index) => row(entry, index, role)).join("")
    : `<li class="market-ranking-empty">集計対象の売買はまだありません。</li>`;
  return `<section class="screen market-screen market-rankings">
    <div class="market-section-head"><div><span class="eyebrow">INDEPENDENT VALUE RANKING</span><h1>VALUE MARKET ランキング</h1><p>総合ランキングには含まれない、売り手と買い手それぞれの市場実績です。</p></div><button class="button button-ghost" id="marketRankingBack">市場へ戻る</button></div>
    ${state.rankingsStatus === "loading" ? `<div class="market-ranking-loading">ランキングを読み込んでいます…</div>` : `<div class="market-ranking-grid">
      <article><span>SELLER RANKING</span><h2>売上ランキング</h2><ol>${list(state.rankings.sellers, "seller")}</ol></article>
      <article><span>BUYER RANKING</span><h2>購入評価ランキング</h2><ol>${list(state.rankings.buyers, "buyer")}</ol></article>
    </div>`}
    <p class="market-ranking-note">同じ売り手・買い手の組み合わせは、日本時間の1日につき最初の成立取引だけランキングへ加算します。ポイント移動自体は通常どおり実行されます。</p>
  </section>`;
}

function roomRole() {
  return state.uid === state.room?.sellerUid ? "seller" : state.uid === state.room?.buyerUid ? "buyer" : "";
}

function renderMarketImage() {
  const source = roomRole() === "seller" ? (state.image?.url || state.remoteImage?.url) : state.remoteImage?.url;
  if (source) return `<img src="${escapeHtml(source)}" alt="市場で提示された画像" />`;
  return `<div class="market-transfer-wait"><div class="loader"></div><strong>画像をP2P転送中…</strong><small>${escapeHtml(state.peerStatus)}</small></div>`;
}

function renderMarketMessages() {
  const messages = [
    ...state.chatMessages.map((message) => ({ ...message, kind: "text" })),
    ...state.audioMessages.map((message) => ({ ...message, kind: "audio" })),
  ].sort((first, second) => (
    Number(first.turn || 1) - Number(second.turn || 1)
    || Number(first.createdAt || 0) - Number(second.createdAt || 0)
    || String(first.id || "").localeCompare(String(second.id || ""))
  ));
  if (!messages.length) return `<li class="market-chat-empty">営業メッセージはまだありません。</li>`;
  return messages.map((message) => message.kind === "audio"
    ? `<li class="${message.uid === state.uid ? "is-mine" : ""} is-audio"><span>${escapeHtml(message.name)}</span><p>10秒音声</p><audio controls preload="metadata" data-market-audio-key="${escapeHtml(`${message.turn}:${message.createdAt}`)}" src="${escapeHtml(message.url)}"></audio><small>TURN ${Number(message.turn || 1)}</small></li>`
    : `<li class="${message.uid === state.uid ? "is-mine" : ""}"><span>${escapeHtml(message.name)}</span><p>${escapeHtml(message.text)}</p><small>TURN ${Number(message.turn || 1)}</small></li>`).join("");
}

function renderRoomControls(room, role) {
  const status = room.status;
  const terminal = TERMINAL_STATES.has(status);
  if (terminal) {
    const title = status === "sold" ? "売買成立" : status === "canceled" ? "取引中止" : "今回は見送り";
    const copy = status === "sold"
      ? `${room.salePrice}PTで成立しました。${room.rankingCounted === false ? "同一ペア本日2回目以降のためランキング対象外です。" : "独立ランキングへ反映されます。"}`
      : "このルームでのポイント移動と営業履歴はここで終了です。";
    return `<div class="market-result-panel ${status}"><span>${status === "sold" ? "DEAL COMPLETE" : "MARKET CLOSED"}</span><h2>${title}</h2><p>${copy}</p><div><button class="button button-primary" id="marketPlayAgain">もう一度参加</button><button class="button button-ghost" id="marketResultRanking">ランキングを見る</button><button class="button button-ghost" id="marketReturnHome">トップへ戻る</button></div></div>`;
  }
  if (status === "preview") {
    if (role === "buyer") {
      return `<div class="market-decision-panel"><span>FREE PREVIEW</span><h2>この画像の営業を受けますか？</h2><p>受けると着手料${room.entryFee || ENTRY_FEE}PTを一時預け、営業完了時に売り手へ支払います。画像確認だけなら無料です。</p><div><button class="button button-primary" data-market-action="accept_pitch" ${!state.remoteImage || state.busy ? "disabled" : ""}>${room.entryFee || ENTRY_FEE}PTで営業を受ける</button><button class="button button-ghost" data-market-action="decline_preview" ${state.busy ? "disabled" : ""}>営業を受けず退室</button></div></div>`;
    }
    return `<div class="market-wait-panel"><span>BUYER PREVIEW</span><h2>買い手が画像を確認中です</h2><p>営業を受けるまでは着手料は発生しません。</p></div>`;
  }
  if (status === "pitch") {
    if (role === "seller") {
      const sent = state.pitchSentTurns.has(Number(room.turn || 1));
      return `<div class="market-pitch-panel"><span>SALES TURN ${Number(room.turn || 1)} / ${room.maxTurns || MAX_TURNS}</span><h2>画像の魅力を営業する</h2>
        <form id="marketChatForm"><textarea id="marketChatInput" maxlength="240" placeholder="この画像だからこそ伝わる魅力を240文字以内で…" ${state.busy ? "disabled" : ""}></textarea><button class="button button-cyan" ${state.busy ? "disabled" : ""}>チャットを送る</button></form>
        <div class="market-audio-pitch"><label class="button button-ghost">10秒音声を送る<input id="marketAudioInput" type="file" accept="audio/*" ${state.busy || !state.channelReady ? "disabled" : ""} /></label><small>トップページの10秒音声メーカーで作成したWAVも使えます。</small></div>
        <button class="button button-primary market-complete-pitch" data-market-action="pitch_complete" ${!sent || state.busy ? "disabled" : ""}>このターンの営業を完了</button></div>`;
    }
    return `<div class="market-wait-panel"><span>SALES TURN ${Number(room.turn || 1)}</span><h2>売り手の営業を受けています</h2><p>営業完了後に、購入・退室・追加検討を選択できます。</p></div>`;
  }
  if (status === "decision") {
    if (role === "buyer") {
      const canExtend = Number(room.turn || 1) < Number(room.maxTurns || MAX_TURNS);
      return `<div class="market-decision-panel"><span>VALUE DECISION</span><h2>この推し値で購入しますか？</h2><p>販売価格 ${room.listing?.askingPrice}PT。購入はロールプレイで、画像データの所有権は移りません。</p><div><button class="button button-primary" data-market-action="buy" ${state.busy ? "disabled" : ""}>${room.listing?.askingPrice}PTで購入</button>${canExtend ? `<button class="button button-cyan" data-market-action="request_extension" ${state.busy ? "disabled" : ""}>もう1ターン検討</button>` : ""}<button class="button button-ghost" data-market-action="leave" ${state.busy ? "disabled" : ""}>今回は見送る</button></div></div>`;
    }
    return `<div class="market-wait-panel"><span>BUYER DECISION</span><h2>買い手の判断を待っています</h2><p>購入・退室・追加検討のいずれかが選ばれます。</p></div>`;
  }
  if (status === "extension_request") {
    if (role === "seller") {
      return `<div class="market-extension-panel"><span>ANOTHER TURN REQUEST</span><h2>追加営業の内金を提示</h2><p>買い手が受け取って次ターンへ進むためのポイントです。</p><div><select id="marketExtensionIncentive"><option value="5">5 PT</option><option value="10">10 PT</option><option value="20">20 PT</option></select><button class="button button-primary" id="marketOfferExtension" ${state.busy ? "disabled" : ""}>内金を提示する</button><button class="button button-ghost" data-market-action="cancel" ${state.busy ? "disabled" : ""}>取引を終了</button></div></div>`;
    }
    return `<div class="market-wait-panel"><span>EXTENSION REQUESTED</span><h2>売り手が内金を検討中です</h2><p>提示された内金を受け取るか選択できます。</p></div>`;
  }
  if (status === "extension_offer") {
    if (role === "buyer") {
      return `<div class="market-decision-panel"><span>EXTENSION OFFER</span><h2>${room.extensionIncentive}PTを受け取り、次の営業へ？</h2><p>承諾すると売り手から買い手へ内金が移動し、ターン${Number(room.turn || 1) + 1}へ進みます。</p><div><button class="button button-primary" data-market-action="accept_extension" ${state.busy ? "disabled" : ""}>${room.extensionIncentive}PTを受け取り続行</button><button class="button button-ghost" data-market-action="decline_extension" ${state.busy ? "disabled" : ""}>受け取らず退室</button></div></div>`;
    }
    return `<div class="market-wait-panel"><span>EXTENSION OFFERED</span><h2>買い手の返答を待っています</h2><p>${room.extensionIncentive}PTの内金を提示中です。</p></div>`;
  }
  return `<div class="market-wait-panel"><h2>市場の状態を同期しています</h2></div>`;
}

function renderRoom() {
  if (!state.room) return `<section class="screen market-screen market-waiting"><div class="market-waiting-card"><div class="loader"></div><h1>市場ルームを準備しています</h1></div></section>`;
  const room = state.room;
  const role = roomRole();
  const counterpart = role === "seller" ? room.buyerName : room.sellerName;
  return `<section class="screen market-screen market-room">
    <div class="market-room-head"><div><span class="eyebrow">VALUE MARKET / TURN ${Number(room.turn || 1)}</span><h1>${escapeHtml(room.listing?.title || "無題の推し")}</h1><p>${role === "seller" ? "SELLER" : "BUYER"} / 相手：${escapeHtml(counterpart)}</p></div>${renderWallet()}</div>
    <div class="market-room-status"><span class="market-price">${room.listing?.askingPrice}<small>PT</small></span><span class="market-p2p ${state.channelReady ? "is-connected" : ""}">${escapeHtml(state.peerStatus)}</span><button type="button" id="marketExitRoom">取引を終了</button></div>
    <div class="market-room-grid">
      <figure class="market-main-image">${renderMarketImage()}<figcaption>画像はこの対戦中だけP2Pで表示されます</figcaption></figure>
      <section class="market-sales-log"><div class="market-sales-log-head"><span>SALES LOG</span><strong>営業メッセージ</strong></div><ol id="marketMessageList">${renderMarketMessages()}</ol></section>
    </div>
    ${renderRoomControls(room, role)}
  </section>`;
}

function renderError() {
  const inRoom = Boolean(state.roomId);
  return `<section class="screen market-screen market-error"><div><span class="eyebrow">VALUE MARKET ERROR</span><h1>${inRoom ? "取引を継続できません" : "市場へ接続できませんでした"}</h1><p>${escapeHtml(state.errorMessage || "通信処理に失敗しました。")}</p><button class="button button-primary" id="marketErrorBack">${inRoom ? "取引を終了して戻る" : "トップへ戻る"}</button></div></section>`;
}

function bindEvents() {
  document.querySelectorAll("[data-market-role]").forEach((button) => button.addEventListener("click", () => {
    state.role = button.dataset.marketRole;
    normalizeBuyerBudget();
    localStorage.setItem(MARKET_ROLE_KEY, state.role);
    render();
  }));
  document.querySelector("#marketEntryForm")?.addEventListener("submit", joinQueue);
  document.querySelector("#marketName")?.addEventListener("input", (event) => { state.name = event.target.value.slice(0, 16); });
  document.querySelector("#marketListingTitle")?.addEventListener("input", (event) => { state.listingTitle = event.target.value.slice(0, 30); });
  document.querySelector("#marketAskingPrice")?.addEventListener("change", (event) => { state.askingPrice = Number(event.target.value); });
  document.querySelector("#marketPitchStyle")?.addEventListener("change", (event) => { state.pitchStyle = event.target.value; });
  document.querySelector("#marketMaxBudget")?.addEventListener("change", (event) => { state.maxBudget = Number(event.target.value); });
  document.querySelector("#marketImageInput")?.addEventListener("change", handleImageInput);
  document.querySelector("#marketRankingsButton")?.addEventListener("click", openRankings);
  document.querySelectorAll("[data-market-preview-room]").forEach((button) => button.addEventListener("click", () => {
    const [status, role] = button.dataset.marketPreviewRoom.split(":");
    previewRoom(status, role);
  }));
  document.querySelector("#marketRankingBack")?.addEventListener("click", returnFromRankings);
  document.querySelector("#marketCancelQueueButton")?.addEventListener("click", () => cancelQueue());
  document.querySelector("#marketExitRoom")?.addEventListener("click", requestHome);
  document.querySelector("#marketChatForm")?.addEventListener("submit", sendChatPitch);
  document.querySelector("#marketAudioInput")?.addEventListener("change", sendAudioPitch);
  document.querySelectorAll("[data-market-action]").forEach((button) => button.addEventListener("click", () => performAction(button.dataset.marketAction)));
  document.querySelector("#marketOfferExtension")?.addEventListener("click", () => performAction("offer_extension", { incentive: Number(document.querySelector("#marketExtensionIncentive")?.value || 5) }));
  document.querySelector("#marketPlayAgain")?.addEventListener("click", resetForReplay);
  document.querySelector("#marketResultRanking")?.addEventListener("click", openRankings);
  document.querySelector("#marketReturnHome")?.addEventListener("click", returnHome);
  document.querySelector("#marketErrorBack")?.addEventListener("click", requestHome);
}

async function handleImageInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const generation = lifecycleGeneration;
  state.busy = true;
  render();
  let processedImage = null;
  try {
    releaseLocalImage();
    processedImage = await shared().processImageFile(file, 0, { maxSide: 1600 });
    if (!isCurrentLifecycle(generation)) {
      if (processedImage?.url) URL.revokeObjectURL(processedImage.url);
      return;
    }
    state.image = processedImage;
    state.imageSent = false;
    showToast("市場用の画像を準備しました。");
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(error.message || "画像を準備できませんでした。");
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.busy = false;
      render();
    }
  }
}

async function joinQueue(event) {
  event.preventDefault();
  if (!state.authReady || state.busy) return;
  const generation = lifecycleGeneration;
  state.name = normalizeMarketName(document.querySelector("#marketName")?.value || state.name);
  state.listingTitle = String(document.querySelector("#marketListingTitle")?.value || state.listingTitle).trim().slice(0, 30);
  state.askingPrice = Number(document.querySelector("#marketAskingPrice")?.value || state.askingPrice);
  state.pitchStyle = document.querySelector("#marketPitchStyle")?.value || state.pitchStyle;
  state.maxBudget = Number(document.querySelector("#marketMaxBudget")?.value || state.maxBudget);
  if (state.role === "seller" && (!state.image || !state.listingTitle)) return showToast("出品画像とタイトルを準備してください。");
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  state.busy = true;
  state.queueJoinPending = true;
  render();
  try {
    if (useMarketPreview) {
      state.screen = "waiting";
      return;
    }
    const response = await marketQueueCallable({
      action: "join",
      role: state.role,
      name: state.name,
      listing: state.role === "seller" ? { title: state.listingTitle, askingPrice: state.askingPrice, pitchStyle: state.pitchStyle } : null,
      maxBudget: state.maxBudget,
    });
    if (!isCurrentLifecycle(generation)) return;
    updateMarketBalance(response.data?.balance ?? state.balance);
    if (response.data?.roomId) {
      await enterRoom(String(response.data.roomId), generation);
      return;
    }
    state.screen = "waiting";
    startQueueHeartbeat();
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(callableMessage(error, "市場の待機列へ参加できませんでした。"));
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.busy = false;
      state.queueJoinPending = false;
      render();
    }
  }
}

function startQueueHeartbeat() {
  window.clearInterval(state.queueHeartbeat);
  state.queueHeartbeat = window.setInterval(async () => {
    if (!active || state.screen !== "waiting") return;
    const generation = lifecycleGeneration;
    try {
      const response = await marketQueueCallable({ action: "heartbeat" });
      if (!isCurrentLifecycle(generation)) return;
      if (response.data?.roomId) {
        await enterRoom(String(response.data.roomId), generation);
        return;
      }
      if (response.data?.status === "missing") {
        window.clearInterval(state.queueHeartbeat);
        state.queueHeartbeat = null;
        state.screen = "setup";
        showToast("待機情報の有効期限が切れました。もう一度参加してください。");
        render();
      }
    } catch {
      // The next heartbeat or active-room listener retries.
    }
  }, 20_000);
}

function stopRoomHeartbeat() {
  window.clearInterval(state.roomHeartbeat);
  state.roomHeartbeat = null;
  state.roomHeartbeatPending = false;
}

function startRoomHeartbeat(roomId, generation = lifecycleGeneration) {
  stopRoomHeartbeat();
  state.roomHeartbeat = window.setInterval(async () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId
        || TERMINAL_STATES.has(state.room?.status) || state.roomHeartbeatPending) return;
    state.roomHeartbeatPending = true;
    try {
      const response = await marketQueueCallable({ action: "heartbeat_room", roomId });
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
      if (TERMINAL_STATES.has(String(response.data?.status || ""))) stopRoomHeartbeat();
    } catch {
      // Firestoreのルーム監視と次の同期で再試行する。
    } finally {
      if (isCurrentLifecycle(generation) && state.roomId === roomId && state.roomHeartbeat) {
        state.roomHeartbeatPending = false;
      }
    }
  }, 20_000);
}

function clearRoomSyncRetry({ resetWarning = false } = {}) {
  window.clearTimeout(state.roomSyncRetry);
  state.roomSyncRetry = null;
  if (resetWarning) {
    state.roomSyncWarningShown = false;
    state.roomSyncRetryAttempts = 0;
  }
}

function scheduleRoomSyncRetry(roomId, generation) {
  clearRoomSyncRetry();
  const delay = Math.min(20_000, 3_000 * (2 ** Math.min(state.roomSyncRetryAttempts, 3)));
  state.roomSyncRetryAttempts += 1;
  state.roomSyncRetry = window.setTimeout(() => {
    state.roomSyncRetry = null;
    connectMarketRoomServices(roomId, generation);
  }, delay);
}

async function connectMarketRoomServices(roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.roomSyncPending) return;
  state.roomSyncPending = true;
  let shouldRetry = false;
  try {
    const syncResponse = await marketQueueCallable({ action: "sync_room", roomId });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    if (TERMINAL_STATES.has(String(syncResponse.data?.status || ""))) {
      stopRoomHeartbeat();
      clearRoomSyncRetry({ resetWarning: true });
      return;
    }
    startRoomHeartbeat(roomId, generation);
    await setupRealtimeRoom(generation, roomId);
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    clearRoomSyncRetry({ resetWarning: true });
    if (state.room && state.screen === "room") {
      setupPeerConnection(generation, roomId).catch((error) => handleFatalError(error, generation));
    }
  } catch (error) {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    shouldRetry = true;
    state.peerStatus = "ルーム同期を再試行中…";
    if (!state.roomSyncWarningShown) {
      state.roomSyncWarningShown = true;
      showToast(callableMessage(error, "市場ルームの同期を再試行しています。"));
    }
    render();
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.roomSyncPending = false;
      if (shouldRetry && !TERMINAL_STATES.has(state.room?.status)) {
        scheduleRoomSyncRetry(roomId, generation);
      }
    }
  }
}

async function cancelQueue({ cancelMatchedRoom = false } = {}) {
  if (state.busy) return "busy";
  const generation = lifecycleGeneration;
  state.busy = true;
  render();
  try {
    if (useMarketPreview) {
      state.screen = "setup";
      return "canceled";
    }
    const response = await marketQueueCallable({ action: "cancel" });
    if (!isCurrentLifecycle(generation)) return "stale";
    if (response.data?.roomId) {
      const roomId = String(response.data.roomId);
      if (cancelMatchedRoom) {
        const turn = 1;
        const { actionId } = marketActionIdentity("cancel", roomId, turn);
        const cancelResponse = await marketActionCallable({ action: "cancel", roomId, actionId, turn });
        if (!isCurrentLifecycle(generation)) return "stale";
        clearMarketActionIdentity(actionId);
        updateMarketBalance(cancelResponse.data?.balance ?? state.balance);
        return "canceled";
      }
      await enterRoom(roomId, generation);
      return "matched";
    }
    window.clearInterval(state.queueHeartbeat);
    state.queueHeartbeat = null;
    state.screen = "setup";
    return "canceled";
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(callableMessage(error, "待機をキャンセルできませんでした。"));
    return "failed";
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.busy = false;
      render();
    }
  }
}

async function enterRoom(roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || !roomId) return;
  if ((state.roomId === roomId && state.roomUnsubscribe) || state.enteringRoomId === roomId) return;
  state.enteringRoomId = roomId;
  window.clearInterval(state.queueHeartbeat);
  state.queueHeartbeat = null;
  stopRoomHeartbeat();
  state.roomId = roomId;
  state.screen = "room";
  state.busy = false;
  setMarketChrome("VALUE DEAL");
  render();
  state.roomUnsubscribe?.();
  state.roomUnsubscribe = onSnapshot(doc(firestore, "valueMarketRooms", roomId), (snapshot) => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !snapshot.exists()) return;
    const previousStatus = state.room?.status;
    state.room = snapshot.data();
    if (TERMINAL_STATES.has(state.room.status)) {
      stopRoomHeartbeat();
      clearRoomSyncRetry();
    }
    if (previousStatus !== state.room.status) window.HariaiAudio?.playPhase?.();
    if (!useMarketPreview && roomRole() === "seller" && !state.image?.blob
        && !TERMINAL_STATES.has(state.room.status)) {
      state.errorMessage = "再読み込みで出品画像が端末メモリから消えたため、この取引は継続できません。「取引を終了して戻る」から安全に精算してください。";
      state.screen = "error";
      setMarketChrome("MARKET RECOVERY");
      render();
      return;
    }
    render();
    if (state.realtimeRoomId === roomId) {
      setupPeerConnection(generation, roomId).catch((error) => handleFatalError(error, generation));
    }
  }, (error) => handleFatalError(error, generation));
  await connectMarketRoomServices(roomId, generation);
  if (isCurrentLifecycle(generation) && state.enteringRoomId === roomId) state.enteringRoomId = "";
}

function markPresenceOffline(connection) {
  if (!connection?.reference || !connection?.disconnect) return Promise.resolve();
  return set(connection.reference, { online: false, updatedAt: serverTimestamp() })
    .then(() => connection.disconnect.cancel?.())
    .catch(() => {
      // If the explicit update fails, keep onDisconnect armed as a fallback.
    });
}

async function setupRealtimeRoom(generation = lifecycleGeneration, roomId = state.roomId) {
  if (!isCurrentLifecycle(generation) || !roomId || state.realtimeRoomId === roomId) return;
  const base = `online/valueMarketRooms/${roomId}`;
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  const disconnect = onDisconnect(presenceRef);
  const connection = { reference: presenceRef, disconnect };
  let unsubscribeChat = null;
  try {
    await disconnect.set({ online: false, updatedAt: serverTimestamp() });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) {
      await markPresenceOffline(connection);
      return;
    }
    await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) {
      await markPresenceOffline(connection);
      return;
    }
    const chatQuery = query(ref(database, `${base}/chat`), limitToLast(60));
    unsubscribeChat = onChildAdded(chatQuery, (snapshot) => {
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
      if (state.seenChatIds.has(snapshot.key)) return;
      state.seenChatIds.add(snapshot.key);
      const message = { id: snapshot.key, ...snapshot.val() };
      state.chatMessages.push(message);
      if (message.uid === state.uid && roomRole() === "seller") {
        state.pitchSentTurns.add(Number(message.turn || 1));
      }
      if (state.chatMessages.length > 60) state.chatMessages.shift();
      render();
    });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) {
      unsubscribeChat();
      await markPresenceOffline(connection);
      return;
    }
    state.realtimeUnsubscribers.push(unsubscribeChat);
    state.presenceConnections.push(connection);
    state.realtimeRoomId = roomId;
  } catch (error) {
    unsubscribeChat?.();
    await markPresenceOffline(connection);
    if (state.realtimeRoomId === roomId) state.realtimeRoomId = "";
    throw error;
  }
}

async function setupPeerConnection(generation = lifecycleGeneration, roomId = state.roomId) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer || !state.room) return;
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC転送に対応していません。");
  const opponentUid = state.uid === state.room.sellerUid ? state.room.buyerUid : state.room.sellerUid;
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  state.peer = peer;
  window.clearTimeout(state.peerTimeout);
  state.peerTimeout = window.setTimeout(() => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer || state.channelReady) return;
    handleFatalError(new Error("P2P接続を確立できませんでした。通信環境を確認するか、取引を終了してください。"), generation);
  }, 20_000);
  peer.onicecandidate = (event) => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    if (event.candidate) {
      sendSignal(opponentUid, "candidate", event.candidate.toJSON(), roomId, generation).catch(handleRecoverableError);
    }
  };
  peer.onconnectionstatechange = () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    state.peerStatus = peer.connectionState === "connected" ? "● P2P接続済み" : `P2P: ${peer.connectionState}`;
    state.channelReady = state.channel?.readyState === "open";
    render();
  };
  peer.ondatachannel = (event) => {
    if (isCurrentLifecycle(generation) && state.roomId === roomId && state.peer === peer) {
      configureDataChannel(event.channel, generation, roomId);
    }
  };
  const signalsRef = ref(database, `online/valueMarketRooms/${roomId}/signals/${state.uid}`);
  state.realtimeUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try {
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
      await handleSignal(snapshot.val(), opponentUid, peer, roomId, generation);
    } catch (error) {
      if (isCurrentLifecycle(generation)) handleRecoverableError(error);
    } finally {
      await remove(snapshot.ref).catch(() => {});
    }
  }));
  if (roomRole() === "seller") {
    const channel = peer.createDataChannel("value-market-assets", { ordered: true });
    configureDataChannel(channel, generation, roomId);
    const offer = await peer.createOffer();
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    await peer.setLocalDescription(offer);
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    await sendSignal(opponentUid, "offer", { type: offer.type, sdp: offer.sdp }, roomId, generation);
  }
}

async function sendSignal(targetUid, type, payload, roomId = state.roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
  await set(push(ref(database, `online/valueMarketRooms/${roomId}/signals/${targetUid}`)), {
    fromUid: state.uid,
    type,
    payload: JSON.stringify(payload),
    createdAt: serverTimestamp(),
  });
}

async function handleSignal(signal, opponentUid, peer = state.peer, roomId = state.roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !signal || signal.fromUid !== opponentUid || !peer) return;
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    await peer.setRemoteDescription(payload);
    if (!isCurrentLifecycle(generation) || state.peer !== peer) return;
    await flushPendingIce(peer);
    const answer = await peer.createAnswer();
    if (!isCurrentLifecycle(generation) || state.peer !== peer) return;
    await peer.setLocalDescription(answer);
    await sendSignal(opponentUid, "answer", { type: answer.type, sdp: answer.sdp }, roomId, generation);
  } else if (signal.type === "answer") {
    await peer.setRemoteDescription(payload);
    if (!isCurrentLifecycle(generation) || state.peer !== peer) return;
    await flushPendingIce(peer);
  } else if (signal.type === "candidate") {
    if (peer.remoteDescription) await peer.addIceCandidate(payload);
    else state.pendingIce.push(payload);
  }
}

async function flushPendingIce(peer = state.peer) {
  while (peer && state.pendingIce.length) await peer.addIceCandidate(state.pendingIce.shift());
}

function configureDataChannel(channel, generation = lifecycleGeneration, roomId = state.roomId) {
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) return;
    window.clearTimeout(state.peerTimeout);
    state.peerTimeout = null;
    state.channelReady = true;
    state.peerStatus = "● P2P接続済み";
    if (roomRole() === "seller") sendListingImage().catch(handleRecoverableError);
    render();
  };
  channel.onclose = () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) return;
    state.channelReady = false;
    state.peerStatus = "P2P接続が切れました";
    render();
  };
  channel.onerror = () => {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) showToast("P2P転送で通信エラーが発生しました。");
  };
  channel.onmessage = (event) => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) return;
    handleChannelMessage(event.data).catch(handleRecoverableError);
  };
}

async function sendListingImage() {
  if (state.imageSent || !state.image?.blob) return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  await sendAsset(state.image.blob, {
    kind: "image",
    turn: 0,
    name: state.room?.listing?.title || "推し画像",
    createdAt: Date.now(),
    generation,
    roomId,
  });
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
  state.imageSent = true;
}

function sendAsset(blob, options) {
  const transferState = state;
  const request = {
    ...options,
    createdAt: options.createdAt ?? Date.now(),
    generation: options.generation ?? lifecycleGeneration,
    roomId: options.roomId ?? state.roomId,
  };
  const task = transferState.outgoingTransfer
    .catch(() => {})
    .then(() => sendAssetNow(blob, request));
  transferState.outgoingTransfer = task;
  return task;
}

async function sendAssetNow(blob, {
  kind,
  turn,
  name,
  createdAt,
  generation,
  roomId,
}) {
  const channel = state.channel;
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !channel || channel.readyState !== "open") {
    throw new Error("P2P接続が完了していません。");
  }
  const buffer = await blob.arrayBuffer();
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) {
    throw new Error("P2P転送が中断されました。");
  }
  channel.send(JSON.stringify({ type: "asset-start", kind, turn, name, mime: blob.type, size: buffer.byteLength, createdAt }));
  for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
    await waitForDataBuffer(channel, generation, roomId);
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) {
      throw new Error("P2P転送が中断されました。");
    }
    channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
  }
  channel.send(JSON.stringify({ type: "asset-end", kind, turn }));
}

function waitForDataBuffer(channel = state.channel, generation = lifecycleGeneration, roomId = state.roomId) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !channel || channel.readyState !== "open") {
    return Promise.reject(new Error("P2P接続が閉じました。"));
  }
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("P2P転送がタイムアウトしました。")), 10_000);
    channel.addEventListener("bufferedamountlow", () => {
      window.clearTimeout(timer);
      if (isCurrentLifecycle(generation) && state.roomId === roomId && state.channel === channel) resolve();
      else reject(new Error("P2P転送が中断されました。"));
    }, { once: true });
  });
}

async function handleChannelMessage(data) {
  if (typeof data === "string") {
    if (data.length > 4_096) throw new Error("P2P制御データが大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "asset-start") {
      if (roomRole() !== "buyer") throw new Error("買い手以外は市場素材を受信できません。");
      if (!["image", "audio"].includes(message.kind)) throw new Error("受信データの種類が不正です。");
      if (state.incomingTransfer) throw new Error("別のP2P転送が進行中です。");
      const maximum = message.kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
      const size = Number(message.size || 0);
      if (!Number.isFinite(size) || size <= 0 || size > maximum) throw new Error("受信データのサイズが不正です。");
      if (message.kind === "image" && message.mime !== "image/webp") throw new Error("画像形式が不正です。");
      if (message.kind === "audio" && message.mime !== "audio/wav") throw new Error("音声形式が不正です。");
      const turn = Number(message.turn || 0);
      if ((message.kind === "image" && turn !== 0)
          || (message.kind === "audio" && (!Number.isInteger(turn) || turn < 1 || turn > MAX_TURNS))) {
        throw new Error("受信データのターンが不正です。");
      }
      const createdAt = Number(message.createdAt || Date.now());
      state.incomingTransfer = {
        kind: message.kind,
        turn,
        name: String(message.name || "").slice(0, 80),
        mime: message.mime,
        size,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        received: 0,
        chunks: [],
      };
    } else if (message.type === "asset-end") {
      if (!state.incomingTransfer || message.kind !== state.incomingTransfer.kind
          || Number(message.turn || 0) !== state.incomingTransfer.turn) {
        throw new Error("P2P転送の終端情報が一致しません。");
      }
      finishIncomingAsset();
    }
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  state.incomingTransfer.chunks.push(chunk);
  state.incomingTransfer.received += chunk.byteLength;
  if (state.incomingTransfer.received > state.incomingTransfer.size) {
    state.incomingTransfer = null;
    throw new Error("受信データのサイズが一致しません。");
  }
}

function finishIncomingAsset() {
  const transfer = state.incomingTransfer;
  if (!transfer || transfer.received !== transfer.size) throw new Error("P2P受信が完了していません。");
  const blob = new Blob(transfer.chunks, { type: transfer.mime });
  if (transfer.kind === "image") {
    releaseRemoteImage();
    state.remoteImage = { blob, url: URL.createObjectURL(blob) };
  } else {
    state.audioMessages.push({
      uid: state.room?.sellerUid,
      name: state.room?.sellerName || "SELLER",
      turn: transfer.turn,
      blob,
      url: URL.createObjectURL(blob),
      createdAt: transfer.createdAt,
    });
  }
  state.incomingTransfer = null;
  render();
}

async function sendChatPitch(event) {
  event.preventDefault();
  if (roomRole() !== "seller" || state.room?.status !== "pitch") return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Number(state.room.turn || 1);
  const input = document.querySelector("#marketChatInput");
  const text = String(input?.value || "").trim().slice(0, 240);
  if (!text) return;
  state.busy = true;
  render();
  try {
    await set(push(ref(database, `online/valueMarketRooms/${roomId}/chat`)), {
      uid: state.uid,
      name: normalizeMarketName(state.room?.sellerName || state.name),
      text,
      turn,
      createdAt: serverTimestamp(),
    });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    state.pitchSentTurns.add(turn);
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast("営業チャットを送信できませんでした。");
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

async function sendAudioPitch(event) {
  const file = event.target.files?.[0];
  if (!file || roomRole() !== "seller" || state.room?.status !== "pitch") return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Number(state.room.turn || 1);
  state.busy = true;
  render();
  let processed = null;
  const createdAt = Date.now();
  try {
    processed = await shared().processGameAudioFile(file, { audioName: file.name });
    await sendAsset(processed.audioBlob, {
      kind: "audio",
      turn,
      name: processed.audioName,
      createdAt,
      generation,
      roomId,
    });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    state.audioMessages.push({
      uid: state.uid,
      name: state.name,
      turn,
      blob: processed.audioBlob,
      url: processed.audioUrl,
      createdAt,
    });
    processed.audioUrl = "";
    state.pitchSentTurns.add(turn);
    showToast("10秒音声をP2Pで送りました。");
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(error.message || "10秒音声を送信できませんでした。");
  } finally {
    if (processed?.audioUrl) URL.revokeObjectURL(processed.audioUrl);
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

function performPreviewAction(action, extra = {}) {
  const room = state.room;
  if (!room) return false;
  if (action === "accept_pitch") {
    updateMarketBalance(state.balance - (room.entryFee || ENTRY_FEE));
    room.status = "pitch";
  } else if (action === "decline_preview") {
    room.status = "ended";
  } else if (action === "pitch_complete") {
    updateMarketBalance(state.balance + (room.entryFee || ENTRY_FEE));
    room.status = "decision";
  } else if (action === "buy") {
    updateMarketBalance(state.balance - Number(room.listing?.askingPrice || 0));
    room.status = "sold";
    room.salePrice = Number(room.listing?.askingPrice || 0);
  } else if (action === "leave") {
    room.status = "ended";
  } else if (action === "request_extension") {
    room.status = "extension_request";
  } else if (action === "offer_extension") {
    const incentive = Number(extra.incentive || 5);
    updateMarketBalance(state.balance - incentive);
    room.extensionIncentive = incentive;
    room.status = "extension_offer";
  } else if (action === "accept_extension") {
    updateMarketBalance(state.balance + Number(room.extensionIncentive || 0));
    room.extensionFeesPaid = Number(room.extensionFeesPaid || 0) + Number(room.extensionIncentive || 0);
    room.extensionIncentive = 0;
    room.turn = Number(room.turn || 1) + 1;
    room.status = "pitch";
  } else if (action === "decline_extension") {
    room.status = "ended";
  } else if (action === "cancel") {
    room.status = "canceled";
  } else {
    return false;
  }
  render();
  return true;
}

async function performAction(action, extra = {}) {
  if (!state.roomId || state.busy) return false;
  if (useMarketPreview) return performPreviewAction(action, extra);
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Math.max(1, Number(state.room?.turn || 1));
  const { actionId } = marketActionIdentity(action, roomId, turn, extra);
  state.busy = true;
  render();
  try {
    const response = await marketActionCallable({ action, roomId, ...extra, actionId, turn });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return false;
    clearMarketActionIdentity(actionId);
    updateMarketBalance(response.data?.balance ?? state.balance);
    if (action === "accept_pitch") showToast(`${state.room?.entryFee || ENTRY_FEE}PTの着手料を一時預けました。`);
    if (action === "buy") showToast("売買が成立しました。");
    if (action === "offer_extension") showToast("内金を一時預け、買い手へ提示しました。");
    if (action === "accept_extension") showToast("内金を受け取り、次の営業ターンへ進みます。");
    return true;
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(callableMessage(error, "市場操作を完了できませんでした。"));
    return false;
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

async function openRankings() {
  const generation = lifecycleGeneration;
  state.screen = "rankings";
  state.rankingsStatus = useMarketPreview ? "ready" : "loading";
  if (useMarketPreview) {
    state.rankings = {
      sellers: [{ name: "SELLER TEST", primary: 1280, count: 9, best: 300 }],
      buyers: [{ name: "BUYER TEST", primary: 960, count: 7, best: 250 }],
    };
    render();
    return;
  }
  render();
  try {
    const response = await marketRankingsCallable({});
    if (!isCurrentLifecycle(generation)) return;
    state.rankings = {
      sellers: Array.isArray(response.data?.sellers) ? response.data.sellers : [],
      buyers: Array.isArray(response.data?.buyers) ? response.data.buyers : [],
    };
    state.rankingsStatus = "ready";
  } catch (error) {
    if (!isCurrentLifecycle(generation)) return;
    state.rankingsStatus = "error";
    showToast(callableMessage(error, "市場ランキングを読み込めませんでした。"));
  }
  if (isCurrentLifecycle(generation)) render();
}

async function requestHome() {
  if (!active) return;
  if (useMarketPreview) {
    returnHome();
    return;
  }
  if (state.queueJoinPending) {
    showToast("待機列への参加処理が終わってから、もう一度トップへ戻ってください。");
    return;
  }
  if (state.screen === "waiting") {
    const outcome = await cancelQueue({ cancelMatchedRoom: true });
    if (outcome === "canceled") returnHome();
    return;
  }
  if (state.roomId && (!state.room || !TERMINAL_STATES.has(state.room.status))) {
    if (!window.confirm("現在の市場取引を終了しますか？ 未完了営業の着手料は、売り手終了なら買い手へ返金、買い手終了なら売り手へ支払われます。確定済みの内金は返金されません。")) return;
    if (!await performAction("cancel")) return;
  }
  returnHome();
}

function returnFromRankings() {
  if (state.roomId && TERMINAL_STATES.has(state.room?.status)) {
    resetForReplay();
    return;
  }
  state.screen = "setup";
  render();
}

function resetForReplay() {
  const generation = ++lifecycleGeneration;
  const role = state.role;
  const name = state.name;
  const balance = state.balance;
  const image = role === "seller" ? state.image : null;
  const listingTitle = state.listingTitle;
  const askingPrice = state.askingPrice;
  state.activeUnsubscribe?.();
  state.activeUnsubscribe = null;
  state.walletUnsubscribe?.();
  state.walletUnsubscribe = null;
  cleanupRoom({ preserveLocalImage: role === "seller" });
  state = {
    ...createState(),
    uid: useMarketPreview ? "local-preview-user" : (auth.currentUser?.uid || ""),
    authReady: true,
    role,
    name,
    balance,
    image,
    listingTitle,
    askingPrice,
  };
  normalizeBuyerBudget();
  active = true;
  lastRenderedScreen = "";
  if (!useMarketPreview) {
    subscribeToActiveRoom(generation);
    subscribeToWallet(generation);
  }
  setMarketChrome("VALUE MARKET");
  render();
}

function returnHome() {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  state.activeUnsubscribe?.();
  state.activeUnsubscribe = null;
  state.walletUnsubscribe?.();
  state.walletUnsubscribe = null;
  cleanupRoom();
  window.HariaiApp?.returnHome?.();
}

function cleanupRoom({ preserveLocalImage = false, preserveOnDisconnect = false } = {}) {
  window.clearInterval(state.queueHeartbeat);
  state.queueHeartbeat = null;
  stopRoomHeartbeat();
  clearRoomSyncRetry({ resetWarning: true });
  state.roomSyncPending = false;
  state.roomUnsubscribe?.();
  state.roomUnsubscribe = null;
  state.realtimeUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  const presenceConnections = state.presenceConnections.splice(0);
  if (!preserveOnDisconnect) presenceConnections.forEach(markPresenceOffline);
  state.peer?.close();
  state.channel?.close();
  window.clearTimeout(state.peerTimeout);
  state.peerTimeout = null;
  state.peer = null;
  state.channel = null;
  state.channelReady = false;
  state.pendingIce = [];
  state.outgoingTransfer = Promise.resolve();
  state.incomingTransfer = null;
  state.enteringRoomId = "";
  state.realtimeRoomId = "";
  state.audioMessages.forEach((message) => message.url && URL.revokeObjectURL(message.url));
  state.audioMessages = [];
  releaseRemoteImage();
  if (!preserveLocalImage) releaseLocalImage();
}

function releaseLocalImage() {
  if (state.image?.url) URL.revokeObjectURL(state.image.url);
  state.image = null;
}

function releaseRemoteImage() {
  if (state.remoteImage?.url) URL.revokeObjectURL(state.remoteImage.url);
  state.remoteImage = null;
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "市場の通信処理に失敗しました。");
}

function handleFatalError(error, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation)) return;
  console.error(error);
  state.errorMessage = callableMessage(error, "市場へ接続できませんでした。");
  state.screen = "error";
  setMarketChrome("MARKET ERROR");
  render();
}

function previewRoom(status = "preview", role = "buyer") {
  if (!useMarketPreview) return;
  const sellerUid = "local-preview-seller";
  const buyerUid = "local-preview-buyer";
  state.role = role;
  state.uid = role === "seller" ? sellerUid : buyerUid;
  updateMarketBalance(500);
  state.roomId = "local-preview-room";
  state.screen = "room";
  state.channelReady = true;
  state.peerStatus = "● P2P接続済み";
  state.room = {
    roomId: state.roomId,
    participants: { [sellerUid]: true, [buyerUid]: true },
    sellerUid,
    buyerUid,
    sellerName: "SELLER TEST",
    buyerName: "BUYER TEST",
    listing: { title: "夕焼けの推し", askingPrice: 100, pitchStyle: "either" },
    status,
    turn: status === "extension_offer" ? 2 : 1,
    maxTurns: MAX_TURNS,
    entryFee: ENTRY_FEE,
    extensionIncentive: 10,
    salePrice: 100,
    rankingCounted: true,
  };
  if (status === "pitch" && role === "seller") state.pitchSentTurns.add(1);
  const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#ff6b9c"/><stop offset=".55" stop-color="#7d4ba8"/><stop offset="1" stop-color="#102b4d"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="880" cy="210" r="92" fill="#ffd36d"/><path d="M0 570L260 420 480 560 720 350 1200 610V800H0Z" fill="#101827" opacity=".78"/><text x="55" y="90" fill="white" font-family="sans-serif" font-size="42" font-weight="700">VALUE MARKET PREVIEW</text></svg>`;
  releaseRemoteImage();
  state.remoteImage = { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSvg)}` };
  setMarketChrome("VALUE MARKET PREVIEW");
  render();
}

window.addEventListener("beforeunload", () => {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  state.activeUnsubscribe?.();
  state.walletUnsubscribe?.();
  cleanupRoom({ preserveOnDisconnect: true });
});

window.HariaiMarket = {
  start,
  isActive,
  requestHome,
};
if (useMarketPreview) window.HariaiMarket.previewRoom = previewRoom;
window.dispatchEvent(new Event("hariai-market-ready"));
