import { getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  get,
  getDatabase,
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

const MAX_ROUNDS = 5;
const PLAYER_COUNT = 4;
const DECK_ROLES = ["opening", "middle", "final", "reserve-a", "reserve-b"];
const DECK_ROLE_LABELS = {
  opening: "OPENING",
  middle: "MIDDLE",
  final: "FINAL",
  "reserve-a": "RESERVE A",
  "reserve-b": "RESERVE B",
};
const SELECTION_TIME_MS = 10_000;
const SCORE_TIME_MS = 15_000;
const RESULT_TIME_MS = 8_000;
const RECONNECT_GRACE_MS = 30_000;
const MATCH_TIMEOUT_MS = 30_000;
const QUEUE_FRESH_MS = 45_000;
const HEARTBEAT_MS = 20_000;
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const INITIAL_RATING = 1000;
const DEFAULT_REACTIONS = ["すごい！", "かわいい", "センスいい", "もっと見たい"];
const MAX_EQUIPPED_REACTIONS = 8;
const SHOP_REACTIONS = [
  { id: "reaction_color", reaction: "色づかいが好き！" },
  { id: "reaction_best_shot", reaction: "最高の一枚！" },
  { id: "reaction_composition", reaction: "構図がうまい！" },
  { id: "reaction_atmosphere", reaction: "空気感が最高" },
  { id: "reaction_idea", reaction: "発想がおもしろい！" },
  { id: "reaction_healing", reaction: "癒やされる" },
  { id: "reaction_keep_watching", reaction: "ずっと見ていたい" },
  { id: "reaction_today_favorite", reaction: "今日の推し！" },
  { id: "reaction_story", reaction: "物語を感じる" },
  { id: "reaction_masterpiece", reaction: "これは名作" },
];
const SHOP_TITLES = [
  { id: "title_good_praiser", title: "ほめ上手" },
  { id: "title_plant_lover", title: "植物愛好家" },
  { id: "title_animal_lover", title: "どうぶつ派" },
  { id: "title_landscape_hunter", title: "風景ハンター" },
  { id: "title_image_sommelier", title: "画像ソムリエ" },
  { id: "title_hariai_master", title: "貼り合いマスター" },
  { id: "title_live_action_supremacy", title: "実写至上主義" },
  { id: "title_2d_lover", title: "二次元愛好家" },
  { id: "title_mushroom_side", title: "きのこ派" },
  { id: "title_bamboo_side", title: "たけのこ派" },
  { id: "title_image_folder_guardian", title: "画像フォルダの守護者" },
  { id: "title_cant_pick_five", title: "5枚に絞れない" },
  { id: "title_blur_connoisseur", title: "ピンぼけ鑑定士" },
  { id: "title_mostly_cats", title: "だいたい猫" },
  { id: "title_food_photo_alert", title: "飯テロ警戒中" },
  { id: "title_resolution_is_justice", title: "解像度は正義" },
  { id: "title_composition_lost", title: "構図迷子" },
  { id: "title_subjective_today", title: "今日も主観" },
];

const firebaseApp = getApp();
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const fxLayer = document.querySelector("#fxLayer");

let active = false;
let state = createState();

function createState() {
  return {
    screen: "setup",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    authReady: false,
    profile: { rating: INITIAL_RATING, streak: 0 },
    royaleProfile: { wins: 0, topTwo: 0, matches: 0, streak: 0, bestStreak: 0 },
    economy: { points: 0, inventory: {}, equipped: { reactions: {}, title: "" }, daily: {} },
    deck: [],
    roomId: "",
    room: null,
    members: [],
    round: 1,
    roundData: {},
    roundSelections: new Map(),
    selectedCardId: "",
    selectedScores: {},
    selectedAudienceUid: "",
    swapUsed: false,
    history: [],
    eliminated: {},
    forfeited: {},
    tiebreakUids: [],
    outcome: null,
    processedRounds: new Set(),
    continuedRounds: new Set(),
    sentImageRounds: new Set(),
    imageReadyRounds: new Set(),
    roundReadyRounds: new Set(),
    remoteImages: new Map(),
    remoteAvatars: new Map(),
    hideOtherAvatars: false,
    connections: new Map(),
    latestQueue: {},
    activeUsers: {},
    matchingBusy: false,
    acceptingInvite: false,
    pendingRoomId: "",
    queueHeartbeat: null,
    matchTimer: null,
    timerInterval: null,
    scoreTimerInterval: null,
    resultAdvanceTimeout: null,
    resultCountdownInterval: null,
    resultDeadline: 0,
    serverTimeOffset: 0,
    timerPhase: "waiting",
    timerRemainingMs: 0,
    selectionLocking: false,
    scoreLocking: false,
    scoredRounds: new Set(),
    audienceVotedRounds: new Set(),
    audienceLocking: false,
    allChatMessages: [],
    seenAllChatIds: new Set(),
    publicPresenceId: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    publicPresenceState: "",
    disconnectHandles: [],
    disconnectTimers: new Map(),
    matchmakingUnsubscribers: [],
    roomUnsubscribers: [],
    roundUnsubscribe: null,
    statsCommitted: false,
    leaving: false,
    errorMessage: "",
  };
}

const shared = () => window.HariaiApp?.shared;
const escapeHtml = (value) => shared()?.escapeHtml(value) ?? String(value);
const showToast = (message) => shared()?.showToast(message);
const setBusy = (busy, message) => shared()?.setBusy(busy, message);
const now = () => Date.now() + Number(state.serverTimeOffset || 0);

function start() {
  if (active) return;
  if (location.protocol === "file:") {
    showToast("バトルロワイヤル対戦はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (window.HariaiOnline?.isActive?.() || window.HariaiRoyale?.isActive?.() || window.HariaiTeam?.isActive?.()) {
    showToast("ほかの対戦画面を終了してからバトルロワイヤルを開始してください。");
    return;
  }
  active = true;
  state = createState();
  setRoyaleChrome("CONNECTING");
  render();
  Promise.resolve(shared()?.profileAvatar?.ready?.()).then(() => { if (active && state.screen === "setup") render(); });
  ensureAuthenticated().catch(handleFatalError);
}

function isActive() {
  return active;
}

async function ensureAuthenticated() {
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!active) return;
  state.uid = credential.user.uid;
  const [profileSnapshot, royaleProfileSnapshot, economySnapshot] = await Promise.all([
    get(ref(database, `online/profiles/${state.uid}`)),
    get(ref(database, `online/royaleProfiles/${state.uid}`)),
    get(ref(database, `online/economy/${state.uid}`)),
  ]);
  if (profileSnapshot.exists()) {
    state.profile = { ...state.profile, ...profileSnapshot.val() };
    if (!localStorage.getItem(PROFILE_NAME_KEY) && state.profile.name) state.name = state.profile.name;
  }
  if (royaleProfileSnapshot.exists()) state.royaleProfile = { ...state.royaleProfile, ...royaleProfileSnapshot.val() };
  if (economySnapshot.exists()) state.economy = normalizeEconomy(economySnapshot.val());
  state.authReady = true;
  setRoyaleChrome("ROYALE READY");
  render();
}

function normalizeEconomy(value) {
  const source = value || {};
  const dateKey = jstDateKey(now());
  const sameDate = source.daily?.dateKey === dateKey;
  const inventory = {};
  [...SHOP_REACTIONS, ...SHOP_TITLES].forEach((item) => {
    if (source.inventory?.[item.id] === true) inventory[item.id] = true;
  });
  const ownedReactions = SHOP_REACTIONS.filter((item) => inventory[item.id]);
  const hasSavedEquipment = source.equipped && typeof source.equipped === "object";
  const equipped = { reactions: {}, title: "" };
  const reactionIds = hasSavedEquipment
    ? ownedReactions.filter((item) => source.equipped?.reactions?.[item.id] === true).map((item) => item.id)
    : ownedReactions.map((item) => item.id);
  reactionIds.slice(0, MAX_EQUIPPED_REACTIONS).forEach((id) => { equipped.reactions[id] = true; });
  const savedTitle = String(source.equipped?.title || "");
  if (SHOP_TITLES.some((item) => item.id === savedTitle) && inventory[savedTitle]) equipped.title = savedTitle;
  const daily = { dateKey, matches: 0, scores: 0, criticals: 0, claimed: {} };
  if (sameDate) {
    daily.matches = Math.min(1, Math.max(0, Math.floor(Number(source.daily.matches || 0))));
    daily.scores = Math.min(3, Math.max(0, Math.floor(Number(source.daily.scores || 0))));
    daily.criticals = Math.min(1, Math.max(0, Math.floor(Number(source.daily.criticals || 0))));
    ["complete_match", "score_three", "give_critical"].forEach((id) => {
      if (source.daily.claimed?.[id] === true) daily.claimed[id] = true;
    });
  }
  return { points: Math.min(999_999, Math.max(0, Math.floor(Number(source.points || 0)))), inventory, equipped, daily, updatedAt: now() };
}

function titleLabel(titleId = state.economy.equipped?.title) {
  return SHOP_TITLES.find((item) => item.id === titleId)?.title || "";
}

function renderTitleBadge(titleId = state.economy.equipped?.title) {
  const label = titleLabel(titleId);
  return label ? `<span class="player-title-badge">◆ ${escapeHtml(label)}</span>` : "";
}

function jstDateKey(timestamp = Date.now()) {
  return new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function setRoyaleChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "4人P2P画像転送";
  if (footerItems[0]) footerItems[0].textContent = "ONLINE 4 PLAYER BATTLE ROYALE / FIREBASE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "4人の画像はP2P転送し、Firebaseには保存しません";
}

function render() {
  if (!active) return;
  const renderers = {
    setup: renderSetup,
    matching: renderMatching,
    forming: renderForming,
    connecting: renderConnecting,
    select: renderSelection,
    waitingPick: renderWaitingPick,
    waitingImages: renderWaitingImages,
    reveal: renderReveal,
    score: renderScoring,
    waitingScore: renderWaitingScore,
    result: renderResult,
    waitingContinue: renderWaitingContinue,
    gameover: renderGameOver,
    error: renderError,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderSetup)();
  bindEvents();
  appRoot.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSetup() {
  ensureDeckRoles();
  const slots = Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const item = state.deck[index];
    const roleLabel = DECK_ROLE_LABELS[DECK_ROLES[index]];
    if (!item) return `<div class="deck-slot empty" aria-label="${roleLabel} 空きスロット"><span>${roleLabel}</span><b>${String(index + 1).padStart(2, "0")}</b></div>`;
    return `<div class="deck-slot"><img src="${item.url}" alt="バトルロワイヤル選択画像 ${index + 1}" draggable="false" />
      <div class="deck-label"><span>${roleLabel}</span><button class="remove-card" data-royale-remove="${item.id}" aria-label="画像${index + 1}を削除">×</button></div></div>`;
  }).join("");
  const ready = state.authReady && state.deck.length === MAX_ROUNDS && state.name.trim();
  return `<section class="screen"><div class="section-head"><div><span class="eyebrow">ONLINE 4 PLAYER BATTLE ROYALE</span><h1>バトルロワイヤルの準備</h1>
    <p>匿名画像を順位投票し、各ラウンドの最下位が脱落。メイン3枚とリザーブ2枚の組み方が勝負を分けます。</p></div>
    <button class="button button-ghost button-small" id="royaleBackHome">タイトルへ</button></div>
    <div class="online-profile-strip"><span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● Firebase接続済み" : "○ Firebaseへ接続中…"}</span>
      ${renderTitleBadge()}
      <span>${state.royaleProfile.wins}回優勝</span><span>TOP2 ${state.royaleProfile.topTwo}回 / ${state.royaleProfile.matches}戦</span>
      <span>🔥 ${state.royaleProfile.streak}連勝中</span></div>
    ${window.HariaiOnline?.renderOverallRankingParticipation?.({ controlId: "royaleOverallRanking" }) || ""}
    <div class="royale-rule-summary"><div><strong>4</strong><span>PLAYERS</span></div><div><strong>3+2</strong><span>MAIN + RESERVE</span></div><div><strong>1</strong><span>DECK SWAP</span></div><div><strong>15</strong><span>VOTE SEC</span></div></div>
    <div class="setup-layout"><aside class="setup-guide"><h2>バトルロワイヤルの流れ</h2><ol class="guide-list">
      <li><b>1</b><span>OPENING・MIDDLE・FINALとRESERVE 2枚を順番に登録します。</span></li><li><b>2</b><span>匿名画像へ順位を付け、合計支持ポイントが最も低い1人が脱落します。</span></li>
      <li><b>3</b><span>1試合に1回だけメインをリザーブへ交換可能。FINALは脱落した2人が審査します。</span></li></ol>
      <div class="privacy-note">画像は最大1280pxへ変換し、Firebaseには保存しません。</div></aside>
      <div class="setup-panel"><label class="field-label">表示名<input class="text-input" id="royalePlayerName" maxlength="16" value="${escapeHtml(state.name)}" autocomplete="nickname" /></label>
        ${shared()?.profileAvatar?.renderSetting?.({ controlId: "royaleProfileAvatar", name: state.name }) || ""}
        <div class="deck-toolbar"><div class="deck-counter"><strong>${state.deck.length}</strong> / 5 IMAGES</div><div class="upload-actions">
          <label class="button button-cyan button-small file-button">画像を追加<input id="royaleImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple ${state.deck.length >= MAX_ROUNDS ? "disabled" : ""} /></label>
          <button class="button button-ghost button-small" id="royaleFillSample">サンプル画像で埋める</button></div></div>
        <div class="deck-grid">${slots}</div><div class="setup-actions"><button class="button button-primary" id="findRoyaleMatch" ${ready ? "" : "disabled"}>4人マッチングを開始</button></div>
      </div></div></section>`;
}

function renderMatching() {
  return renderStatusCard("◎", "BATTLE ROYALE MATCHING", "あと3人を待っています", "待機中のプレイヤーが4人揃うと、自動的に対戦ルームを作ります。", `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">● 4人キュー参加中</span>`, `<button class="button button-ghost" id="cancelRoyaleMatching">マッチングをやめる</button>`);
}

function renderForming() {
  const accepted = Object.keys(state.room?.accepted || {}).length;
  return renderStatusCard("4", "ROOM FORMING", "4人の参加確認中", `${accepted} / 4人が参加を確定しました。全員揃うまでお待ちください。`, `<span class="connection-pill connected">● 参加枠を確保済み</span>`, `<button class="button button-danger button-small" data-royale-destroy>参加を取り消す</button>`);
}

function renderConnecting() {
  const connected = [...state.connections.values()].filter((connection) => connection.channel?.readyState === "open").length;
  return renderStatusCard("P2P", "4 PLAYER MESH", "4人の画像通信を準備中", `${connected} / 3人とP2P接続済みです。`, `<span class="connection-pill ${connected === 3 ? "connected" : ""}">● ${connected} / 3 CONNECTIONS</span>`, `<button class="button button-danger button-small" data-royale-destroy>対戦から退出</button>`);
}

function renderStatusCard(icon, eyebrow, title, body, details = "", actions = "") {
  return `<section class="screen handoff-wrap"><div class="handoff-card online-status-card"><div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
    <span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><div class="online-status-details">${details}</div><div class="button-row">${actions}</div></div></section>`;
}

function memberByUid(uid) {
  return state.members.find((player) => player.uid === uid);
}

function isForfeited(uid) {
  return Boolean(state.forfeited[uid]);
}

function isEliminated(uid) {
  return Boolean(state.eliminated[uid]) || isForfeited(uid);
}

function availableMembers() {
  return state.members.filter((player) => !isForfeited(player.uid));
}

function alivePlayers() {
  return state.members.filter((player) => !isEliminated(player.uid));
}

function roundParticipants() {
  const alive = alivePlayers();
  if (!state.tiebreakUids.length) return alive;
  const tied = new Set(state.tiebreakUids);
  return alive.filter((player) => tied.has(player.uid));
}

function scoreTargets() {
  return voteTargetsFor(state.uid);
}

function isFinalJuryRound() {
  return !state.tiebreakUids.length && alivePlayers().length === 2 && roundParticipants().length === 2;
}

function survivalVoters() {
  if (isFinalJuryRound()) return availableMembers().filter((player) => isEliminated(player.uid));
  return alivePlayers();
}

function audienceVoters() {
  if (isFinalJuryRound()) return [];
  return availableMembers().filter((player) => isEliminated(player.uid));
}

function voteTargetsFor(uid) {
  const voter = memberByUid(uid);
  if (!voter || !survivalVoters().some((player) => player.uid === uid)) return [];
  return roundParticipants().filter((player) => player.uid !== uid);
}

function isLocalAudienceVoter() {
  return audienceVoters().some((player) => player.uid === state.uid);
}

function isLocalSurvivalVoter() {
  return survivalVoters().some((player) => player.uid === state.uid);
}

function ensureDeckRoles() {
  state.deck.forEach((item, index) => {
    item.position = index;
    item.role = DECK_ROLES[index] || item.role || `reserve-${index}`;
  });
}

function deckRoleLabel(item) {
  return DECK_ROLE_LABELS[item?.role] || "RESERVE";
}

function currentMainRole() {
  const aliveCount = alivePlayers().length || PLAYER_COUNT;
  if (aliveCount >= 4) return "opening";
  if (aliveCount === 3) return "middle";
  return "final";
}

function eligibleSelectionCards() {
  const unused = state.deck.filter((item) => !item.used);
  if (state.tiebreakUids.length) {
    const reserves = unused.filter((item) => item.role.startsWith("reserve"));
    return reserves.length ? reserves : unused;
  }
  const main = unused.find((item) => item.role === currentMainRole());
  const reserves = state.swapUsed ? [] : unused.filter((item) => item.role.startsWith("reserve"));
  return [main, ...reserves].filter(Boolean);
}

function prepareSelection() {
  if (!roundParticipants().some((player) => player.uid === state.uid)) {
    state.selectedCardId = "";
    return;
  }
  const eligible = eligibleSelectionCards();
  if (!eligible.some((item) => item.id === state.selectedCardId)) state.selectedCardId = eligible[0]?.id || "";
}

function stableRoundOrder(players = roundParticipants()) {
  const seed = `${state.roomId}:${state.round}:`;
  return [...players].sort((first, second) => stableHash(seed + first.uid) - stableHash(seed + second.uid) || first.uid.localeCompare(second.uid));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function renderRoyaleHud() {
  const slots = state.members.map((player) => {
    const eliminated = isEliminated(player.uid);
    const place = state.eliminated[player.uid]?.place || "OUT";
    const status = player.uid === state.uid ? (eliminated ? `YOU #${place}` : "YOU") : eliminated ? `#${place}` : "ALIVE";
    const role = eliminated ? (isFinalJuryRound() ? "FINAL JUDGE" : "SPECTATOR") : "SURVIVOR";
    const localPlayer = player.uid === state.uid;
    const avatarUrl = localPlayer ? shared()?.profileAvatar?.get?.().url : state.remoteAvatars.get(player.uid)?.url;
    return `<div class="royale-survivor ${eliminated ? "eliminated" : ""} ${localPlayer ? "local-player" : ""}">${shared()?.profileAvatar?.renderBattle?.(player.name, avatarUrl, { hidden: !localPlayer && state.hideOtherAvatars }) || ""}<div><span>${escapeHtml(status)}</span><strong>${escapeHtml(player.name)}</strong><small>${role}</small></div></div>`;
  }).join("");
  const mode = state.tiebreakUids.length ? "SUDDEN DEATH" : "ELIMINATION";
  return `<div class="royale-survivor-hud">${slots}<div class="round-badge"><small>${mode}</small><strong>R${state.round}</strong></div></div>
    <div class="online-room-strip"><span>ROYALE ROOM ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span><span class="connection-pill connected">● ${alivePlayers().length} SURVIVORS</span><span>${isFinalJuryRound() ? "脱落者2人がFINALを審査" : "脱落後は観客賞を選択"}</span>
      <button class="avatar-visibility-toggle" type="button" data-royale-avatar-visibility aria-pressed="${state.hideOtherAvatars}">${state.hideOtherAvatars ? "他プレイヤー画像を表示" : "他プレイヤー画像を隠す"}</button></div>`;
}

function timerSeconds() {
  if (!Number(state.roundData.selectionStartedAt || 0)) return Math.ceil(SELECTION_TIME_MS / 1000);
  return Math.max(0, Math.ceil(state.timerRemainingMs / 1000));
}

function scoreTimerSeconds() {
  const startedAt = Number(state.roundData.scoringStartedAt || 0);
  if (!startedAt) return Math.ceil(SCORE_TIME_MS / 1000);
  return Math.max(0, Math.ceil((SCORE_TIME_MS - (now() - startedAt)) / 1000));
}

function renderStrategy() {
  return renderSelection();
}

function renderSelection() {
  prepareSelection();
  const remaining = timerSeconds();
  const eligibleIds = new Set(eligibleSelectionCards().map((item) => item.id));
  const cards = state.deck.map((item, index) => {
    const unavailable = item.used || !eligibleIds.has(item.id);
    const swapCandidate = !state.tiebreakUids.length && item.role.startsWith("reserve") && !state.swapUsed;
    return `<button class="select-card ${item.used ? "used" : unavailable ? "locked" : ""} ${swapCandidate ? "swap-candidate" : ""} ${state.selectedCardId === item.id ? "selected" : ""}" data-royale-card="${item.id}" ${unavailable ? "disabled" : ""} aria-pressed="${state.selectedCardId === item.id}">
      <img src="${item.url}" alt="バトルロワイヤル候補画像 ${index + 1}" draggable="false" /><span>${item.used ? "USED" : `${deckRoleLabel(item)}${swapCandidate ? " / SWAP" : ""}`}</span></button>`;
  }).join("");
  const role = state.tiebreakUids.length ? "RESERVE" : DECK_ROLE_LABELS[currentMainRole()];
  const swapMessage = state.swapUsed ? "デッキ交換は使用済みです。" : "リザーブを選ぶと、1試合に1回のデッキ交換を使用します。";
  return `<section class="screen">${renderRoyaleHud()}<div class="section-head"><div><span class="eyebrow">SECRET SURVIVAL PICK / ${role}</span><h1>${state.tiebreakUids.length ? "サドンデス画像を選択" : `${role}を出す`}</h1><p>提出者名は投票完了まで伏せられます。${state.tiebreakUids.length ? "未使用のリザーブを選んでください。" : swapMessage}</p></div>
    <div class="royale-phase-timer ${remaining <= 3 ? "warning" : ""}"><small>SELECT</small><strong data-royale-timer>${remaining}</strong></div></div>
    <div class="select-panel"><div class="select-grid">${cards}</div><div class="selection-footer"><button class="button button-danger button-small" data-royale-destroy>対戦から退出</button>
      <button class="button button-primary" id="lockRoyaleSelection" ${state.selectedCardId ? "" : "disabled"}>この画像で決定</button></div></div>${renderAllChat(true)}</section>`;
}

function renderWaitingPick() {
  const ready = Object.keys(state.roundData.picks || {}).length;
  const required = roundParticipants().length;
  const title = roundParticipants().some((player) => player.uid === state.uid) ? "画像をロックしました" : "生存者の選択を待っています";
  return `<section class="screen">${renderRoyaleHud()}${renderStatusCardInner("⌛", "SECRET PICK", title, `${Math.min(ready, required)} / ${required}人が選択済みです。画像内容と提出者はまだ公開されません。`)}${renderAllChat(true)}</section>`;
}

function renderWaitingImages() {
  const ready = Object.keys(state.roundData.imagesReady || {}).length;
  const available = availableMembers().length;
  return `<section class="screen">${renderRoyaleHud()}${renderStatusCardInner("⇄", "P2P IMAGE TRANSFER", `${roundParticipants().length}枚の画像を転送中`, `${Math.min(ready, available)} / ${available}人が画像受信を完了しました。Firebaseには保存していません。`)}${renderAllChat(true)}</section>`;
}

function renderStatusCardInner(icon, eyebrow, title, body) {
  return `<div class="handoff-card online-status-card royale-inline-status"><div class="handoff-icon" aria-hidden="true">${icon}</div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${body}</p><div class="matching-pulse"><i></i><i></i><i></i></div><div class="screen-actions"><button class="button button-danger button-small" data-royale-destroy>対戦から退出</button></div></div>`;
}

function getRoundImage(uid, round = state.round) {
  if (uid === state.uid) {
    const cardId = state.roundSelections.get(round);
    return state.deck.find((item) => item.id === cardId);
  }
  return state.remoteImages.get(uid)?.get(round);
}

function renderFourImages(withScores = null) {
  const players = withScores?.participantUids
    ? withScores.participantUids.map(memberByUid).filter(Boolean)
    : stableRoundOrder();
  const ordered = withScores ? players : stableRoundOrder(players);
  const cards = ordered.map((player, index) => {
    const item = getRoundImage(player.uid, withScores?.round || state.round);
    const result = withScores?.images?.[player.uid];
    const label = result ? escapeHtml(player.name) : `IMAGE ${String(index + 1).padStart(2, "0")}`;
    const audienceFavorite = withScores?.audienceAwardUid === player.uid;
    const badge = result?.eliminated ? "ELIMINATED" : audienceFavorite ? "AUDIENCE" : result?.perfect ? "UNANIMOUS" : result?.critical ? "ROUND FAVORITE" : "";
    return `<article class="royale-image-card ${result?.eliminated ? "eliminated" : audienceFavorite ? "audience" : result?.perfect ? "perfect" : result?.critical ? "critical" : ""}">
      <div class="royale-image-owner"><span>${label}</span>${result ? `<strong>${result.points}P</strong>` : ""}</div>
      <img src="${item?.url || ""}" alt="${result ? `${escapeHtml(player.name)}の画像` : `匿名画像${index + 1}`}" draggable="false" />
      ${result ? `<div class="royale-image-votes"><span>1位票 ${result.firstVotes} / 支持率 ${Math.round(result.supportRate * 100)}%</span><b>${badge}</b></div>` : ""}</article>`;
  }).join("");
  return `<div class="royale-image-board count-${ordered.length}">${cards}</div>`;
}

function renderReveal() {
  const targets = scoreTargets();
  const audience = isLocalAudienceVoter();
  const finalWaiting = isFinalJuryRound() && !isLocalSurvivalVoter();
  const actionLabel = audience ? "観客賞を選ぶ" : isFinalJuryRound() ? "優勝画像を選ぶ" : `${targets.length}枚を順位投票する`;
  const instruction = audience ? "勝敗には影響しない観客賞を1枚選んでください。" : finalWaiting ? "脱落した2人のFINAL審査を待ちます。" : "提出者名は投票確定後に公開します。好きな順に順位を付けてください。";
  const action = audience || isLocalSurvivalVoter() ? `<button class="button button-primary" id="beginRoyaleScoring">${actionLabel}</button>` : `<span class="connection-pill">● FINAL JUDGING</span>`;
  return `<section class="screen">${renderRoyaleHud()}<div class="section-head"><div><span class="eyebrow">ANONYMOUS IMAGE REVEAL</span><h1>${roundParticipants().length}枚同時公開</h1><p>${instruction}</p></div>
    <div class="royale-phase-timer"><small>SCORE</small><strong data-royale-score-timer>${scoreTimerSeconds()}</strong></div></div>${renderFourImages()}
    <div class="screen-actions"><button class="button button-danger button-small" data-royale-destroy>対戦から退出</button>${action}</div>${renderAllChat(true)}</section>`;
}

function renderScoring() {
  const targets = stableRoundOrder(scoreTargets());
  if (isLocalAudienceVoter()) return renderAudienceVoting();
  const finalJury = isFinalJuryRound();
  const rankCount = targets.length;
  const panels = targets.map((player, index) => {
    const item = getRoundImage(player.uid);
    const current = Number(state.selectedScores[player.uid] || 0);
    const buttons = finalJury
      ? `<button class="button ${current === 1 ? "button-primary" : "button-ghost"}" data-royale-final-vote="${player.uid}">${current === 1 ? "✓ 優勝票" : "この画像に優勝票"}</button>`
      : `<div class="royale-rank-buttons">${Array.from({ length: rankCount }, (_, rankIndex) => rankIndex + 1).map((rank) => `<button class="royale-rank-button rank-${rank} ${current === rank ? "selected" : ""}" data-royale-score-target="${player.uid}" data-royale-rank="${rank}">${rank}位</button>`).join("")}</div>`;
    return `<article class="royale-score-card"><div class="royale-score-image"><span>ANONYMOUS IMAGE ${String(index + 1).padStart(2, "0")}</span><img src="${item?.url || ""}" alt="順位投票する匿名画像${index + 1}" draggable="false" /></div>
      <div class="royale-score-controls"><strong>${finalJury ? (current === 1 ? "WIN" : "--") : (current ? `${current}位` : "--")}</strong>${buttons}</div></article>`;
  }).join("");
  const ranksReady = finalJury
    ? Object.values(state.selectedScores).filter((rank) => rank === 1).length === 1
    : targets.every((player) => Number.isInteger(state.selectedScores[player.uid])) && new Set(targets.map((player) => state.selectedScores[player.uid])).size === targets.length;
  return `<section class="screen">${renderRoyaleHud()}<div class="section-head"><div><span class="eyebrow">SURVIVAL RANKING</span><h1>${finalJury ? "FINAL審査" : `${targets.length}枚を順位投票`}</h1><p>${finalJury ? "勝者にふさわしい画像を1枚選んでください。" : "同じ順位は選べません。1位から順に支持ポイントが加算されます。"}</p></div>
    <div class="royale-phase-timer ${scoreTimerSeconds() <= 5 ? "warning" : ""}"><small>SCORE</small><strong data-royale-score-timer>${scoreTimerSeconds()}</strong></div></div><div class="royale-score-grid">${panels}</div>
    <div class="screen-actions"><button class="button button-danger button-small" data-royale-destroy>対戦から退出</button><button class="button button-primary" id="lockRoyaleScores" ${ranksReady ? "" : "disabled"}>投票を確定</button></div>${renderAllChat(true)}</section>`;
}

function renderAudienceVoting() {
  const players = stableRoundOrder(roundParticipants());
  const cards = players.map((player, index) => {
    const item = getRoundImage(player.uid);
    const selected = state.selectedAudienceUid === player.uid;
    return `<article class="royale-audience-card ${selected ? "selected" : ""}"><span>ANONYMOUS IMAGE ${String(index + 1).padStart(2, "0")}</span><img src="${item?.url || ""}" alt="観客賞候補画像${index + 1}" draggable="false" /><button class="button ${selected ? "button-primary" : "button-ghost"}" data-royale-audience="${player.uid}">${selected ? "✓ 観客賞" : "観客賞に選ぶ"}</button></article>`;
  }).join("");
  return `<section class="screen">${renderRoyaleHud()}<div class="section-head"><div><span class="eyebrow">AUDIENCE AWARD</span><h1>観客賞を選択</h1><p>この投票は脱落判定には影響しません。最も好きな1枚を選んでください。</p></div><div class="royale-phase-timer ${scoreTimerSeconds() <= 5 ? "warning" : ""}"><small>VOTE</small><strong data-royale-score-timer>${scoreTimerSeconds()}</strong></div></div>
    <div class="royale-audience-grid">${cards}</div><div class="screen-actions"><button class="button button-danger button-small" data-royale-destroy>対戦から退出</button><button class="button button-primary" id="lockRoyaleAudience" ${state.selectedAudienceUid ? "" : "disabled"}>観客賞を確定</button></div>${renderAllChat(true)}</section>`;
}

function renderWaitingScore() {
  const ready = Object.keys(state.roundData.scores || {}).length;
  const required = survivalVoters().length;
  const audienceReady = Object.keys(state.roundData.audienceVotes || {}).length;
  const audienceRequired = audienceVoters().length;
  const detail = `${Math.min(ready, required)} / ${required}人が順位投票済み${audienceRequired ? `・観客賞 ${Math.min(audienceReady, audienceRequired)} / ${audienceRequired}` : ""}です。`;
  return `<section class="screen">${renderRoyaleHud()}${renderStatusCardInner("✦", "VOTE LOCKED", "投票を集計中", detail)}${renderAllChat(true)}</section>`;
}

function renderResult() {
  const result = state.history.at(-1);
  const loser = result.eliminatedUid ? memberByUid(result.eliminatedUid) : null;
  const headline = loser ? `${escapeHtml(loser.name)} 脱落` : "最下位同点・サドンデスへ";
  const reason = result.finalJury && result.fallback
    ? `FINAL審査が同票のため、過去ラウンドの支持率・1位票・ラウンド首位${result.lottery ? "・ルーム抽選" : ""}で決定しました。`
    : result.fallback
      ? `サドンデス同点のため、累計支持率・1位票・ラウンド首位${result.lottery ? "・ルーム抽選" : ""}で決定しました。`
      : loser
        ? `支持ポイント ${result.images[result.eliminatedUid].points}P で最下位となりました。`
        : "同点のプレイヤーだけがリザーブ画像でサドンデスを行います。";
  const autoSeconds = resultAutoSeconds();
  return `<section class="screen">${renderRoyaleHud()}<div class="section-head"><div><span class="eyebrow">SURVIVAL ROUND RESULT</span><h1>${headline}</h1><p>${reason}</p></div></div>${renderFourImages(result)}
    <div class="royale-result-banner ${loser ? "danger" : "sudden"}"><strong>${loser ? `#${result.eliminatedPlace} ${escapeHtml(loser.name)}` : "SUDDEN DEATH"}</strong><span>残り ${alivePlayers().length}人</span></div>
    <div class="screen-actions"><button class="button button-danger button-small" data-royale-destroy>対戦から退出</button><button class="button button-primary" id="continueRoyaleRound">${isMatchOver() ? "最終結果を見る" : `ROUND ${state.round + 1}へ`}（<span data-royale-result-timer>${autoSeconds}</span>）</button></div>${renderAllChat()}</section>`;
}

function resultAutoSeconds() {
  if (!state.resultDeadline) return Math.ceil(RESULT_TIME_MS / 1000);
  return Math.max(0, Math.ceil((state.resultDeadline - Date.now()) / 1000));
}

function audienceAwardCount(uid) {
  return state.history.filter((result) => result.audienceAwardUid === uid).length;
}

function renderWaitingContinue() {
  const ready = Object.keys(state.roundData.continue || {}).length;
  const required = availableMembers().length;
  return `<section class="screen">${renderRoyaleHud()}${renderStatusCardInner("→", "NEXT ROUND", "参加者の準備を待っています", `${Math.min(ready, required)} / ${required}人が次へ進む準備を完了しました。`)}${renderAllChat()}</section>`;
}

function renderGameOver() {
  const outcome = state.outcome;
  const winner = memberByUid(outcome.winnerUid);
  const standings = state.members.map((player) => ({ player, place: player.uid === outcome.winnerUid ? 1 : Number(state.eliminated[player.uid]?.place || 4) }))
    .sort((first, second) => first.place - second.place || first.player.uid.localeCompare(second.player.uid))
    .map(({ player, place }) => `<div class="royale-standing ${place === 1 ? "winner" : ""}"><strong>#${place}</strong><span>${escapeHtml(player.name)}${player.uid === state.uid ? "（あなた）" : ""}</span><small>${place === 1 ? "LAST SURVIVOR" : state.eliminated[player.uid]?.reason === "forfeit" ? "FORFEIT" : "ELIMINATED"}${audienceAwardCount(player.uid) ? ` / 観客賞 ${audienceAwardCount(player.uid)}` : ""}</small></div>`).join("");
  const localPlace = outcome.winnerUid === state.uid ? 1 : Number(state.eliminated[state.uid]?.place || 4);
  return `<section class="screen gameover-wrap"><div class="gameover-card royale-gameover"><div class="winner-emblem">1</div><span class="eyebrow">BATTLE ROYALE COMPLETE</span><h1>${escapeHtml(winner?.name || "SURVIVOR")} WIN</h1><p>最後まで生き残ったプレイヤーが勝者です。あなたは${localPlace}位でした。</p>
    <div class="royale-standings">${standings}</div><div class="online-profile-strip"><span>あなたのバトルロワイヤル戦績</span><span>${state.royaleProfile.wins}回優勝 / TOP2 ${state.royaleProfile.topTwo}回</span><span>${state.royaleProfile.matches}戦</span></div>
    <div class="gameover-actions"><button class="button button-primary" id="royaleNewMatch">もう一度バトルロワイヤル</button><button class="button button-ghost" id="royaleGameoverHome">タイトルへ戻る</button></div></div></section>`;
}

function renderNoContest() {
  return renderStatusCard("×", "BATTLE ROYALE CLOSED", "対戦を終了しました", "対戦ルームが利用できなくなりました。", "", `<button class="button button-primary" id="royaleNoContestAgain">もう一度探す</button><button class="button button-ghost" id="royaleNoContestHome">タイトルへ</button>`);
}

function renderError() {
  return renderStatusCard("!", "BATTLE ROYALE CONNECTION ERROR", "バトルロワイヤル接続に失敗しました", state.errorMessage || "通信状態を確認してください。", "", `<button class="button button-primary" id="royaleRetry">もう一度試す</button><button class="button button-ghost" id="royaleErrorHome">タイトルへ</button>`);
}

function unlockedReactions() {
  return [...DEFAULT_REACTIONS, ...SHOP_REACTIONS.filter((item) => state.economy.equipped?.reactions?.[item.id]).map((item) => item.reaction)];
}

function renderMessages(messages, emptyText) {
  return messages.length ? messages.map((message) => `<div class="chat-message ${message.authorUid === state.uid ? "player-one" : "player-two"}"><small>${escapeHtml(message.name)} / R${message.round}${message.titleId ? renderTitleBadge(message.titleId) : ""}</small><p>${escapeHtml(message.text)}</p></div>`).join("") : `<div class="chat-empty">${escapeHtml(emptyText)}</div>`;
}

function renderAllChat(locked = false) {
  const controls = locked
    ? `<div class="royale-chat-lock"><strong>匿名投票中</strong><span>画像の持ち主を伏せるため、投票確定後にチャットを再開します。</span></div>`
    : `<div class="quick-reactions">${unlockedReactions().map((text) => `<button class="reaction-button" data-all-reaction="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}</div><form class="chat-form" id="royaleAllChatForm"><input class="chat-input" id="royaleAllChatInput" maxlength="80" placeholder="4人へひとこと…" aria-label="4人共通チャット" /><button class="button button-cyan button-small">送信</button></form>`;
  return `<aside class="chat-panel online-chat-standalone ${locked ? "is-locked" : ""}"><div class="chat-head"><strong>ALL CHAT / 4 PLAYERS</strong><span>${locked ? "投票確定まで送信停止" : "脱落後も利用できます"}</span></div><div class="chat-messages" id="royaleAllChatMessages">${renderMessages(state.allChatMessages, "公開された画像について4人で話してみましょう。")}</div>${controls}</aside>`;
}

function bindEvents() {
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("contextmenu", (event) => event.preventDefault());
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });
  document.querySelectorAll("[data-royale-destroy]").forEach((button) => button.addEventListener("click", () => {
    configureExitDialog();
    destroyDialog.showModal();
  }));
  document.querySelector("[data-royale-avatar-visibility]")?.addEventListener("click", () => { state.hideOtherAvatars = !state.hideOtherAvatars; render(); });
  bindChatEvents();
  if (state.screen === "setup") bindSetupEvents();
  if (state.screen === "matching") document.querySelector("#cancelRoyaleMatching")?.addEventListener("click", cancelMatching);
  if (state.screen === "select") bindSelectionEvents();
  if (state.screen === "reveal") document.querySelector("#beginRoyaleScoring")?.addEventListener("click", () => { state.screen = "score"; render(); });
  if (state.screen === "score") bindScoreEvents();
  if (state.screen === "result") document.querySelector("#continueRoyaleRound")?.addEventListener("click", continueRound);
  if (state.screen === "gameover") {
    document.querySelector("#royaleNewMatch")?.addEventListener("click", resetSetup);
    document.querySelector("#royaleGameoverHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "noContest") {
    document.querySelector("#royaleNoContestAgain")?.addEventListener("click", resetSetup);
    document.querySelector("#royaleNoContestHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "error") {
    document.querySelector("#royaleRetry")?.addEventListener("click", retryConnection);
    document.querySelector("#royaleErrorHome")?.addEventListener("click", leaveToLanding);
  }
}

function bindSetupEvents() {
  document.querySelector("#royaleBackHome")?.addEventListener("click", leaveToLanding);
  window.HariaiOnline?.bindOverallRankingParticipation?.({
    controlId: "royaleOverallRanking",
    name: () => state.name,
    onUpdate: render,
  });
  shared()?.profileAvatar?.bindSetting?.({ controlId: "royaleProfileAvatar", onUpdate: render });
  const nameInput = document.querySelector("#royalePlayerName");
  nameInput?.addEventListener("input", () => {
    state.name = nameInput.value.slice(0, 16);
    const button = document.querySelector("#findRoyaleMatch");
    if (button) button.disabled = !state.authReady || state.deck.length !== MAX_ROUNDS || !state.name.trim();
  });
  document.querySelector("#royaleImageInput")?.addEventListener("change", handleImageInput);
  document.querySelector("#royaleFillSample")?.addEventListener("click", fillSampleDeck);
  document.querySelectorAll("[data-royale-remove]").forEach((button) => button.addEventListener("click", () => removeDeckItem(button.dataset.royaleRemove)));
  document.querySelector("#findRoyaleMatch")?.addEventListener("click", beginMatchmaking);
}

function bindSelectionEvents() {
  document.querySelectorAll("[data-royale-card]").forEach((button) => button.addEventListener("click", () => {
    state.selectedCardId = button.dataset.royaleCard;
    render();
  }));
  document.querySelector("#lockRoyaleSelection")?.addEventListener("click", lockSelection);
}

function bindScoreEvents() {
  document.querySelectorAll("[data-royale-score-target]").forEach((button) => button.addEventListener("click", () => {
    assignRank(button.dataset.royaleScoreTarget, Number(button.dataset.royaleRank));
    render();
  }));
  document.querySelectorAll("[data-royale-final-vote]").forEach((button) => button.addEventListener("click", () => {
    state.selectedScores = { [button.dataset.royaleFinalVote]: 1 };
    render();
  }));
  document.querySelectorAll("[data-royale-audience]").forEach((button) => button.addEventListener("click", () => {
    state.selectedAudienceUid = button.dataset.royaleAudience;
    render();
  }));
  document.querySelector("#lockRoyaleScores")?.addEventListener("click", lockScores);
  document.querySelector("#lockRoyaleAudience")?.addEventListener("click", lockAudienceVote);
}

function assignRank(targetUid, rank) {
  const previousRank = Number(state.selectedScores[targetUid] || 0);
  const occupiedUid = Object.entries(state.selectedScores).find(([uid, value]) => uid !== targetUid && Number(value) === rank)?.[0];
  if (occupiedUid) {
    if (previousRank) state.selectedScores[occupiedUid] = previousRank;
    else delete state.selectedScores[occupiedUid];
  }
  state.selectedScores[targetUid] = rank;
}

function bindChatEvents() {
  document.querySelectorAll("[data-all-reaction]").forEach((button) => button.addEventListener("click", () => sendAllChat(button.dataset.allReaction)));
  document.querySelector("#royaleAllChatForm")?.addEventListener("submit", (event) => { event.preventDefault(); const input = document.querySelector("#royaleAllChatInput"); sendAllChat(input.value); input.value = ""; });
  scrollChats();
}

function configureExitDialog() {
  const title = destroyDialog.querySelector("h2");
  const body = destroyDialog.querySelector("p");
  const confirm = destroyDialog.querySelector("#confirmDestroy");
  if (title) title.textContent = state.roomId ? "対戦から退出しますか？" : "参加を取り消しますか？";
  if (body) body.textContent = state.roomId ? "退出したプレイヤーだけが脱落扱いになります。残りのプレイヤーは対戦を続行します。" : "マッチングまたは参加確認を終了してタイトルへ戻ります。";
  if (confirm) confirm.textContent = state.roomId ? "脱落して退出" : "参加を取り消す";
}

async function handleImageInput(event) {
  const files = Array.from(event.target.files || []);
  const remaining = MAX_ROUNDS - state.deck.length;
  if (!files.length || remaining <= 0) return;
  setBusy(true, "バトルロワイヤル用に画像を圧縮しています…");
  let added = 0;
  let errorMessage = "";
  for (const file of files.slice(0, remaining)) {
    try {
      state.deck.push(await shared().processImageFile(file, state.deck.length, { maxSide: 1280, quality: 0.8 }));
      added += 1;
    } catch (error) {
      errorMessage ||= error.message;
    }
  }
  ensureDeckRoles();
  setBusy(false);
  render();
  showToast(errorMessage ? `${added}枚追加。${errorMessage}` : `${added}枚の画像を追加しました。`);
}

async function fillSampleDeck() {
  const remaining = MAX_ROUNDS - state.deck.length;
  if (remaining <= 0) return showToast("5枚すべて選択済みです。");
  setBusy(true, "バトルロワイヤルサンプル画像を生成しています…");
  state.deck.push(...await shared().createSampleItems(2, remaining, state.deck.length));
  ensureDeckRoles();
  setBusy(false);
  render();
}

function removeDeckItem(id) {
  const item = state.deck.find((candidate) => candidate.id === id);
  if (item?.url) URL.revokeObjectURL(item.url);
  state.deck = state.deck.filter((candidate) => candidate.id !== id);
  ensureDeckRoles();
  render();
}

async function beginMatchmaking() {
  state.name = state.name.trim().slice(0, 16);
  if (!state.uid || state.deck.length !== MAX_ROUNDS || !state.name) return;
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  state.screen = "matching";
  setRoyaleChrome("BATTLE ROYALE MATCHING");
  render();

  await Promise.allSettled([
    remove(ref(database, `online/royaleActive/${state.uid}`)),
    remove(ref(database, `online/royaleInvites/${state.uid}`)),
  ]);
  const queueRef = ref(database, `online/royaleQueue/${state.uid}`);
  await set(queueRef, {
    uid: state.uid,
    name: state.name,
    rating: INITIAL_RATING,
    streak: Number(state.royaleProfile.streak || 0),
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    state: "waiting",
  });
  const disconnect = onDisconnect(queueRef);
  await disconnect.remove();
  state.disconnectHandles.push(disconnect);
  await startPublicPresence();
  state.queueHeartbeat = window.setInterval(() => {
    update(queueRef, { lastSeen: Date.now() }).then(() => attemptToHost()).catch(() => {});
  }, HEARTBEAT_MS);

  state.matchmakingUnsubscribers.push(onValue(ref(database, "online/royaleQueue"), (snapshot) => {
    state.latestQueue = snapshot.val() || {};
    attemptToHost().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, "online/royaleActive"), (snapshot) => {
    state.activeUsers = snapshot.val() || {};
    attemptToHost().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, `online/royaleInvites/${state.uid}`), (snapshot) => {
    processInvites(snapshot.val() || {}).catch(handleRecoverableError);
  }, handleRecoverableError));
}

async function startPublicPresence() {
  await cleanupPublicPresence();
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  await set(ref(database, `online/publicPresenceOwners/${presenceId}`), state.uid);
  await writePublicPresence(ref(database, `online/publicPresence/${presenceId}`), "royale", "waiting");
  const disconnect = onDisconnect(ref(database, `online/publicPresence/${presenceId}`));
  await disconnect.remove();
  state.publicPresenceId = presenceId;
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = disconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (!state.publicPresenceId) return;
    writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), "royale", state.publicPresenceState).catch(() => {});
  }, HEARTBEAT_MS);
}

async function updatePublicPresence(nextState) {
  if (!state.publicPresenceId) return;
  state.publicPresenceState = nextState;
  await writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), "royale", nextState);
}

async function writePublicPresence(presenceRef, mode, presenceState) {
  const lastSeen = Date.now();
  try {
    await set(presenceRef, { mode, state: presenceState, lastSeen });
  } catch (error) {
    const detail = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (!detail.includes("permission_denied") && !detail.includes("permission-denied")) throw error;
    await set(presenceRef, { state: presenceState, lastSeen });
  }
}

async function cleanupPublicPresence() {
  window.clearInterval(state.publicPresenceHeartbeat);
  state.publicPresenceHeartbeat = null;
  await state.publicPresenceDisconnect?.cancel?.().catch(() => {});
  state.publicPresenceDisconnect = null;
  const id = state.publicPresenceId;
  state.publicPresenceId = "";
  if (!id || !state.uid) return;
  await Promise.allSettled([
    remove(ref(database, `online/publicPresence/${id}`)),
    remove(ref(database, `online/publicPresenceOwners/${id}`)),
  ]);
}

function freshWaitingPlayers() {
  const cutoff = Date.now() - QUEUE_FRESH_MS;
  return Object.values(state.latestQueue)
    .filter((entry) => entry?.state === "waiting" && Number(entry.lastSeen) >= cutoff && !state.activeUsers[entry.uid])
    .sort((first, second) => Number(first.joinedAt) - Number(second.joinedAt) || String(first.uid).localeCompare(String(second.uid)));
}

async function attemptToHost() {
  if (!active || state.screen !== "matching" || state.matchingBusy || state.acceptingInvite || state.pendingRoomId) return;
  const waiting = freshWaitingPlayers();
  if (waiting.length < PLAYER_COUNT || waiting[0].uid !== state.uid) return;
  await createRoyaleRoom(waiting.slice(0, PLAYER_COUNT));
}

function shufflePlayers(players) {
  const shuffled = [...players];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const target = random[0] % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

async function createRoyaleRoom(group) {
  state.matchingBusy = true;
  const roomId = push(ref(database, "online/royaleRooms")).key;
  try {
    const reservation = await runTransaction(ref(database, `online/royaleActive/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const shuffled = shufflePlayers(group);
    const players = {};
    const members = {};
    shuffled.forEach((entry, index) => {
      players[entry.uid] = { uid: entry.uid, name: entry.name, slot: index + 1, streak: Number(entry.streak || 0) };
      members[entry.uid] = true;
    });
    await set(ref(database, `online/royaleRooms/${roomId}/hostUid`), state.uid);
    const roomUpdates = {
      createdAt: Date.now(),
      status: "forming",
    };
    Object.entries(members).forEach(([uid, value]) => { roomUpdates[`members/${uid}`] = value; });
    Object.entries(players).forEach(([uid, value]) => { roomUpdates[`players/${uid}`] = value; });
    await update(ref(database, `online/royaleRooms/${roomId}`), roomUpdates);
    await set(ref(database, `online/royaleRooms/${roomId}/accepted/${state.uid}`), true);
    await update(ref(database, `online/royaleQueue/${state.uid}`), { state: "forming", roomId });
    await Promise.all(shuffled.filter((entry) => entry.uid !== state.uid).map((entry) => set(ref(database, `online/royaleInvites/${entry.uid}/${roomId}`), {
      roomId,
      hostUid: state.uid,
      createdAt: Date.now(),
    })));
    state.pendingRoomId = roomId;
    state.room = { hostUid: state.uid, status: "forming", members, players, accepted: { [state.uid]: true } };
    state.screen = "forming";
    render();
    watchPendingRoom(roomId, true);
    state.matchTimer = window.setTimeout(() => expireRoyaleRoom(roomId), MATCH_TIMEOUT_MS);
  } catch (error) {
    await remove(ref(database, `online/royaleActive/${state.uid}`)).catch(() => {});
    await runTransaction(ref(database, `online/royaleRooms/${roomId}/status`), (current) => current === null ? "expired" : undefined).catch(() => {});
    throw error;
  } finally {
    state.matchingBusy = false;
  }
}

async function processInvites(invites) {
  if (state.acceptingInvite || state.pendingRoomId || state.roomId || state.screen !== "matching") return;
  const first = Object.entries(invites).sort(([, a], [, b]) => Number(a.createdAt) - Number(b.createdAt))[0];
  if (!first) return;
  await acceptInvite(first[0], first[1]);
}

async function acceptInvite(roomId, invite) {
  state.acceptingInvite = true;
  try {
    const snapshot = await get(ref(database, `online/royaleRooms/${roomId}`));
    const room = snapshot.val();
    if (!room || room.status !== "forming" || !room.members?.[state.uid] || invite.hostUid !== room.hostUid) {
      await remove(ref(database, `online/royaleInvites/${state.uid}/${roomId}`));
      return;
    }
    const reservation = await runTransaction(ref(database, `online/royaleActive/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    await set(ref(database, `online/royaleRooms/${roomId}/accepted/${state.uid}`), true);
    await Promise.allSettled([
      remove(ref(database, `online/royaleQueue/${state.uid}`)),
      remove(ref(database, `online/royaleInvites/${state.uid}/${roomId}`)),
    ]);
    state.pendingRoomId = roomId;
    state.room = { ...room, accepted: { ...(room.accepted || {}), [state.uid]: true } };
    state.screen = "forming";
    render();
    watchPendingRoom(roomId, false);
  } finally {
    state.acceptingInvite = false;
  }
}

function watchPendingRoom(roomId, isHost) {
  const statusRef = ref(database, `online/royaleRooms/${roomId}/status`);
  state.matchmakingUnsubscribers.push(onValue(ref(database, `online/royaleRooms/${roomId}/accepted`), (snapshot) => {
    if (!state.room) return;
    state.room.accepted = snapshot.val() || {};
    if (state.screen === "forming") render();
    if (isHost && Object.keys(state.room.accepted).length === PLAYER_COUNT) set(statusRef, "active").catch(handleRecoverableError);
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(statusRef, (snapshot) => {
    const status = snapshot.val();
    if (status === "active") enterRoom(roomId).catch(handleRecoverableError);
    if (status === "expired") handleExpiredRoom(roomId).catch(handleRecoverableError);
  }, handleRecoverableError));
}

async function expireRoyaleRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId || state.room?.hostUid !== state.uid) return;
  await runTransaction(ref(database, `online/royaleRooms/${roomId}/status`), (current) => current === "forming" ? "expired" : undefined);
}

async function handleExpiredRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId) return;
  await Promise.allSettled([
    remove(ref(database, `online/royaleActive/${state.uid}`)),
    remove(ref(database, `online/royaleInvites/${state.uid}/${roomId}`)),
    remove(ref(database, `online/royaleRooms/${roomId}/accepted/${state.uid}`)),
  ]);
  state.pendingRoomId = "";
  state.room = null;
  state.screen = "matching";
  await set(ref(database, `online/royaleQueue/${state.uid}`), {
    uid: state.uid, name: state.name, rating: INITIAL_RATING, streak: Number(state.royaleProfile.streak || 0), joinedAt: Date.now(), lastSeen: Date.now(), state: "waiting",
  });
  render();
}

async function enterRoom(roomId) {
  if (state.roomId) return;
  window.clearTimeout(state.matchTimer);
  const snapshot = await get(ref(database, `online/royaleRooms/${roomId}`));
  const room = snapshot.val();
  if (!room || room.status !== "active" || !room.members?.[state.uid]) throw new Error("バトルロワイヤルルームへ参加できませんでした。");
  state.roomId = roomId;
  state.pendingRoomId = "";
  state.room = room;
  state.members = Object.values(room.players || {}).sort((first, second) => Number(first.slot) - Number(second.slot));
  if (state.members.length !== PLAYER_COUNT) throw new Error("4人のプレイヤー情報が揃っていません。");
  await cleanupMatchmaking(true);
  await updatePublicPresence("playing");
  state.screen = "connecting";
  setRoyaleChrome("BATTLE ROYALE BATTLE");
  render();
  await setupRoomListeners();
  await setupPeerMesh();
}

async function setupRoomListeners() {
  const base = `online/royaleRooms/${state.roomId}`;
  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    state.serverTimeOffset = Number(snapshot.val() || 0);
  }));
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  state.roomUnsubscribers.push(onValue(ref(database, ".info/connected"), (snapshot) => {
    if (snapshot.val() !== true || !state.roomId) return;
    Promise.all([
      set(presenceRef, { online: true, updatedAt: serverTimestamp() }),
      set(ref(database, `online/royaleActive/${state.uid}`), state.roomId),
    ]).catch(handleRecoverableError);
    const activeDisconnect = onDisconnect(ref(database, `online/royaleActive/${state.uid}`));
    activeDisconnect.remove().catch(() => {});
    const presenceDisconnect = onDisconnect(presenceRef);
    presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() }).catch(() => {});
    state.disconnectHandles.push(activeDisconnect, presenceDisconnect);
  }, handleRecoverableError));

  state.roomUnsubscribers.push(onValue(ref(database, `${base}/forfeits`), (snapshot) => {
    applyForfeits(snapshot.val() || {});
  }, handleRecoverableError));
  state.members.filter((player) => player.uid !== state.uid).forEach((player) => {
    state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${player.uid}`), (snapshot) => {
      if (!snapshot.exists() || snapshot.val()?.online !== false || !state.roomId || state.outcome) {
        cancelDisconnectForfeit(player.uid);
        return;
      }
      scheduleDisconnectForfeit(player.uid);
    }));
  });

  const allChatQuery = query(ref(database, `${base}/chat`), limitToLast(60));
  state.roomUnsubscribers.push(onChildAdded(allChatQuery, (snapshot) => {
    if (state.seenAllChatIds.has(snapshot.key)) return;
    state.seenAllChatIds.add(snapshot.key);
    state.allChatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.allChatMessages.length > 60) state.allChatMessages.shift();
    refreshChats();
  }, handleRecoverableError));
  listenToRound();
}

async function markDisconnected(uid) {
  if (!state.roomId || state.outcome || isForfeited(uid)) return;
  const presence = await get(ref(database, `online/royaleRooms/${state.roomId}/presence/${uid}`));
  if (presence.val()?.online !== false) return;
  await runTransaction(ref(database, `online/royaleRooms/${state.roomId}/forfeits/${uid}`), (current) => current || { by: state.uid, at: Date.now(), reason: "disconnect" });
}

function scheduleDisconnectForfeit(uid) {
  if (state.disconnectTimers.has(uid) || isForfeited(uid)) return;
  showToast(`${memberByUid(uid)?.name || "プレイヤー"}の再接続を30秒間待ちます。`);
  const timer = window.setTimeout(() => {
    state.disconnectTimers.delete(uid);
    markDisconnected(uid).catch(handleRecoverableError);
  }, RECONNECT_GRACE_MS);
  state.disconnectTimers.set(uid, timer);
}

function cancelDisconnectForfeit(uid) {
  const timer = state.disconnectTimers.get(uid);
  if (!timer) return;
  window.clearTimeout(timer);
  state.disconnectTimers.delete(uid);
  showToast(`${memberByUid(uid)?.name || "プレイヤー"}が再接続しました。`);
}

function eliminatePlayer(uid, reason, round = state.round) {
  if (state.eliminated[uid]) return;
  const place = alivePlayers().length;
  state.eliminated[uid] = { place, round, reason };
  state.tiebreakUids = state.tiebreakUids.filter((candidate) => candidate !== uid);
}

function applyForfeits(forfeits) {
  const added = Object.entries(forfeits)
    .filter(([uid]) => !state.forfeited[uid])
    .sort(([, first], [, second]) => Number(first?.at || 0) - Number(second?.at || 0));
  if (!added.length) return;
  for (const [uid, detail] of added) {
    cancelDisconnectForfeit(uid);
    state.forfeited[uid] = detail || { reason: "disconnect" };
    if (!state.eliminated[uid]) eliminatePlayer(uid, "forfeit");
  }
  if (alivePlayers().length <= 1) {
    finishMatch().catch(handleRecoverableError);
    return;
  }
  if (state.screen === "connecting") maybeStartRound().catch(handleRecoverableError);
  reactToRoundData().catch(handleRecoverableError);
  render();
}

function listenToRound() {
  state.roundUnsubscribe?.();
  state.roundUnsubscribe = onValue(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}`), (snapshot) => {
    state.roundData = snapshot.val() || {};
    reactToRoundData().catch(handleRecoverableError);
  }, handleRecoverableError);
}

async function setupPeerMesh() {
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC画像転送に対応していません。");
  const signalsRef = ref(database, `online/royaleRooms/${state.roomId}/signals/${state.uid}`);
  state.roomUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try {
      await handleSignal(snapshot.val());
    } finally {
      await remove(snapshot.ref).catch(() => {});
    }
  }, handleRecoverableError));

  state.members.filter((player) => player.uid !== state.uid).forEach((player) => createConnection(player.uid));
  for (const [remoteUid, connection] of state.connections) {
    if (state.uid.localeCompare(remoteUid) < 0) {
      const channel = connection.peer.createDataChannel(`hariai-royale-${state.uid}`, { ordered: true });
      configureChannel(remoteUid, channel);
      const offer = await connection.peer.createOffer();
      await connection.peer.setLocalDescription(offer);
      await sendSignal(remoteUid, "offer", { type: offer.type, sdp: offer.sdp });
    }
  }
}

function createConnection(remoteUid) {
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  const connection = { remoteUid, peer, channel: null, pendingIce: [], incoming: null, incomingAvatar: null, avatarSent: false };
  state.connections.set(remoteUid, connection);
  peer.onicecandidate = (event) => {
    if (event.candidate) sendSignal(remoteUid, "candidate", event.candidate.toJSON()).catch(handleRecoverableError);
  };
  peer.ondatachannel = (event) => configureChannel(remoteUid, event.channel);
  peer.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(peer.connectionState) && state.roomId && !state.outcome) scheduleDisconnectForfeit(remoteUid);
    if (["connected", "completed"].includes(peer.connectionState)) cancelDisconnectForfeit(remoteUid);
    if (state.screen === "connecting") render();
  };
}

async function sendSignal(targetUid, type, payload) {
  await set(push(ref(database, `online/royaleRooms/${state.roomId}/signals/${targetUid}`)), {
    fromUid: state.uid,
    type,
    payload: JSON.stringify(payload),
    createdAt: Date.now(),
  });
}

async function handleSignal(signal) {
  if (!signal?.fromUid || !state.connections.has(signal.fromUid)) return;
  const connection = state.connections.get(signal.fromUid);
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    await connection.peer.setRemoteDescription(payload);
    await flushPendingIce(connection);
    const answer = await connection.peer.createAnswer();
    await connection.peer.setLocalDescription(answer);
    await sendSignal(signal.fromUid, "answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    await connection.peer.setRemoteDescription(payload);
    await flushPendingIce(connection);
  } else if (signal.type === "candidate") {
    if (connection.peer.remoteDescription) await connection.peer.addIceCandidate(payload);
    else connection.pendingIce.push(payload);
  }
}

async function flushPendingIce(connection) {
  while (connection.pendingIce.length) await connection.peer.addIceCandidate(connection.pendingIce.shift());
}

function configureChannel(remoteUid, channel) {
  const connection = state.connections.get(remoteUid);
  if (!connection) return;
  connection.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    sendProfileAvatarTo(remoteUid).catch(handleRecoverableError);
    if (state.screen === "connecting") render();
    maybeStartRound().catch(handleRecoverableError);
  };
  channel.onclose = () => { if (state.roomId && !state.outcome && !isForfeited(remoteUid)) scheduleDisconnectForfeit(remoteUid); };
  channel.onerror = () => showToast("4人P2P画像転送で通信エラーが発生しました。");
  channel.onmessage = (event) => handleChannelMessage(remoteUid, event.data).catch(handleRecoverableError);
}

function openChannelCount() {
  return [...state.connections.values()].filter((connection) => !isForfeited(connection.remoteUid) && connection.channel?.readyState === "open").length;
}

async function maybeStartRound() {
  const expectedPeers = availableMembers().filter((player) => player.uid !== state.uid).length;
  if (openChannelCount() !== expectedPeers || state.roundReadyRounds.has(state.round) || alivePlayers().length <= 1) return;
  prepareSelection();
  state.screen = roundParticipants().some((player) => player.uid === state.uid) ? "select" : "waitingPick";
  render();
  await announceRoundReady();
}

async function announceRoundReady() {
  if (state.roundReadyRounds.has(state.round)) return;
  state.roundReadyRounds.add(state.round);
  await set(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/roundReady/${state.uid}`), true);
}

async function handleChannelMessage(remoteUid, data) {
  const connection = state.connections.get(remoteUid);
  if (!connection) return;
  if (typeof data === "string") {
    const message = JSON.parse(data);
    if (message.type === "profile-avatar-start") {
      const size = Number(message.size);
      if (!Number.isFinite(size) || size <= 0 || size > PROFILE_AVATAR_MAX_BYTES) throw new Error("プロフィール画像の受信サイズが不正です。");
      if (message.mime !== "image/webp") throw new Error("プロフィール画像の形式が不正です。");
      connection.incomingAvatar = { mime: "image/webp", size, chunks: [], received: 0 };
    } else if (message.type === "profile-avatar-end") {
      finishIncomingProfileAvatar(remoteUid);
    } else if (message.type === "profile-avatar-empty") {
      releaseRemoteAvatar(remoteUid);
    } else if (message.type === "image-start") {
      connection.incoming = { round: Number(message.round), mime: message.mime || "image/webp", size: Number(message.size), chunks: [], received: 0 };
    } else if (message.type === "image-end") {
      await finishIncomingImage(remoteUid, Number(message.round));
    }
    return;
  }
  if (connection.incomingAvatar) {
    const chunk = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(await data.arrayBuffer());
    connection.incomingAvatar.chunks.push(chunk);
    connection.incomingAvatar.received += chunk.byteLength;
    if (connection.incomingAvatar.received > connection.incomingAvatar.size) {
      connection.incomingAvatar = null;
      throw new Error("プロフィール画像の受信サイズが一致しませんでした。");
    }
    return;
  }
  if (!connection.incoming) return;
  const chunk = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(await data.arrayBuffer());
  connection.incoming.chunks.push(chunk);
  connection.incoming.received += chunk.byteLength;
  if (connection.incoming.received > connection.incoming.size + DATA_CHUNK_BYTES) {
    connection.incoming = null;
    throw new Error("受信画像サイズが不正です。");
  }
}

async function sendProfileAvatarTo(remoteUid) {
  const connection = state.connections.get(remoteUid);
  if (!connection || connection.avatarSent || connection.channel?.readyState !== "open") return;
  connection.avatarSent = true;
  await shared()?.profileAvatar?.ready?.();
  const avatar = shared()?.profileAvatar?.get?.();
  if (!avatar?.blob || avatar.blob.size > PROFILE_AVATAR_MAX_BYTES) {
    connection.channel.send(JSON.stringify({ type: "profile-avatar-empty" }));
    return;
  }
  const buffer = await avatar.blob.arrayBuffer();
  connection.channel.send(JSON.stringify({ type: "profile-avatar-start", size: buffer.byteLength, mime: avatar.blob.type || "image/webp" }));
  for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
    await waitForDataBuffer(connection.channel);
    connection.channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
  }
  connection.channel.send(JSON.stringify({ type: "profile-avatar-end" }));
}

function finishIncomingProfileAvatar(remoteUid) {
  const connection = state.connections.get(remoteUid);
  const transfer = connection?.incomingAvatar;
  if (!transfer || transfer.received !== transfer.size) throw new Error("プロフィール画像の受信が完了していません。");
  releaseRemoteAvatar(remoteUid);
  const blob = new Blob(transfer.chunks, { type: transfer.mime });
  state.remoteAvatars.set(remoteUid, { blob, url: URL.createObjectURL(blob) });
  connection.incomingAvatar = null;
  if (!["connecting", "gameover", "noContest", "error"].includes(state.screen)) render();
}

function releaseRemoteAvatar(remoteUid) {
  const avatar = state.remoteAvatars.get(remoteUid);
  if (avatar?.url) URL.revokeObjectURL(avatar.url);
  state.remoteAvatars.delete(remoteUid);
  const connection = state.connections.get(remoteUid);
  if (connection) connection.incomingAvatar = null;
}

async function finishIncomingImage(remoteUid, round) {
  const connection = state.connections.get(remoteUid);
  const incoming = connection?.incoming;
  if (!incoming || incoming.round !== round || incoming.received !== incoming.size) throw new Error("バトルロワイヤル画像の受信が完了していません。");
  const blob = new Blob(incoming.chunks, { type: incoming.mime });
  const url = URL.createObjectURL(blob);
  if (!state.remoteImages.has(remoteUid)) state.remoteImages.set(remoteUid, new Map());
  const previous = state.remoteImages.get(remoteUid).get(round);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  state.remoteImages.get(remoteUid).set(round, { blob, url });
  connection.incoming = null;
  await markImagesReadyIfComplete();
}

function hasAllRemoteImages(round = state.round) {
  return roundParticipants()
    .filter((player) => player.uid !== state.uid && !isForfeited(player.uid))
    .every((player) => state.remoteImages.get(player.uid)?.has(round));
}

async function markImagesReadyIfComplete() {
  if (!hasAllRemoteImages() || state.imageReadyRounds.has(state.round)) return;
  state.imageReadyRounds.add(state.round);
  await set(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/imagesReady/${state.uid}`), true);
}

async function sendSelectedImage() {
  if (state.sentImageRounds.has(state.round)) return;
  if (!roundParticipants().some((player) => player.uid === state.uid)) {
    state.sentImageRounds.add(state.round);
    await markImagesReadyIfComplete();
    return;
  }
  const item = getRoundImage(state.uid);
  if (!item?.blob) throw new Error("送信する画像を取得できませんでした。");
  state.sentImageRounds.add(state.round);
  state.screen = "waitingImages";
  render();
  try {
    const buffer = await item.blob.arrayBuffer();
    for (const connection of state.connections.values()) {
      if (isForfeited(connection.remoteUid)) continue;
      const channel = connection.channel;
      if (!channel || channel.readyState !== "open") throw new Error("P2P接続が切れています。");
      channel.send(JSON.stringify({ type: "image-start", round: state.round, size: buffer.byteLength, mime: item.blob.type || "image/webp" }));
      for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
        await waitForDataBuffer(channel);
        channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
      }
      channel.send(JSON.stringify({ type: "image-end", round: state.round }));
    }
    await markImagesReadyIfComplete();
  } catch (error) {
    state.sentImageRounds.delete(state.round);
    throw error;
  }
}

function waitForDataBuffer(channel) {
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve) => channel.addEventListener("bufferedamountlow", resolve, { once: true }));
}

async function reactToRoundData() {
  if (!state.roomId || state.outcome) return;
  const memberIds = availableMembers().map((player) => player.uid);
  const participantIds = roundParticipants().map((player) => player.uid);
  const voterIds = survivalVoters().map((player) => player.uid);
  const audienceIds = audienceVoters().map((player) => player.uid);
  const allReady = (collection, ids = memberIds) => ids.every((uid) => collection?.[uid]);
  if (allReady(state.roundData.roundReady) && !state.roundData.selectionStartedAt) {
    await runTransaction(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/selectionStartedAt`), (current) => current === null ? now() : undefined);
    return;
  }
  if (Number(state.roundData.selectionStartedAt)) startPhaseTimer();
  if (allReady(state.roundData.picks, participantIds) && !state.sentImageRounds.has(state.round)) {
    await sendSelectedImage();
    return;
  }
  if (allReady(state.roundData.imagesReady) && !state.roundData.scoringStartedAt) {
    await runTransaction(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/scoringStartedAt`), (current) => current === null ? now() : undefined);
    return;
  }
  if (Number(state.roundData.scoringStartedAt)) startScoreTimer();
  if (allReady(state.roundData.imagesReady) && hasAllRemoteImages() && !["reveal", "score", "waitingScore", "result", "waitingContinue", "gameover"].includes(state.screen)) {
    stopPhaseTimer();
    state.screen = "reveal";
    render();
  }
  if (allReady(state.roundData.scores, voterIds) && allReady(state.roundData.audienceVotes, audienceIds)) {
    stopScoreTimer();
    resolveRound(state.roundData.scores, state.roundData.audienceVotes || {});
  }
  if (allReady(state.roundData.continue)) advanceRound();
}

function startPhaseTimer() {
  if (state.timerInterval) return;
  updatePhaseTimer();
  state.timerInterval = window.setInterval(updatePhaseTimer, 200);
}

function updatePhaseTimer() {
  const startedAt = Number(state.roundData.selectionStartedAt || 0);
  if (!startedAt) return;
  const elapsed = now() - startedAt;
  if (elapsed < SELECTION_TIME_MS) {
    state.timerPhase = "selection";
    state.timerRemainingMs = SELECTION_TIME_MS - elapsed;
  } else {
    state.timerPhase = "expired";
    state.timerRemainingMs = 0;
    if (state.screen === "select" && !state.selectionLocking) autoLockSelection().catch(handleRecoverableError);
  }
  const timer = document.querySelector("[data-royale-timer]");
  if (timer) timer.textContent = String(timerSeconds());
}

function stopPhaseTimer() {
  window.clearInterval(state.timerInterval);
  state.timerInterval = null;
}

function startScoreTimer() {
  if (state.scoreTimerInterval || state.scoredRounds.has(state.round)) return;
  updateScoreTimer();
  state.scoreTimerInterval = window.setInterval(updateScoreTimer, 200);
}

function updateScoreTimer() {
  const remaining = scoreTimerSeconds();
  document.querySelectorAll("[data-royale-score-timer]").forEach((timer) => { timer.textContent = String(remaining); });
  if (remaining > 0) return;
  if (isLocalAudienceVoter()) {
    if (!state.audienceVotedRounds.has(state.round) && !state.audienceLocking) {
      showToast("投票時間切れのため、観客賞は選択なしになりました。");
      lockAudienceVote(true).catch(handleRecoverableError);
    }
    return;
  }
  if (!isLocalSurvivalVoter() || state.scoredRounds.has(state.round) || state.scoreLocking) return;
  const targets = scoreTargets();
  if (isFinalJuryRound()) {
    if (Object.values(state.selectedScores).filter((rank) => rank === 1).length !== 1 && targets.length) {
      state.selectedScores = { [stableRoundOrder(targets)[0].uid]: 1 };
      showToast("投票時間切れのため、ルーム順で優勝票を確定しました。");
    }
  } else {
    const usedRanks = new Set(Object.values(state.selectedScores).map(Number));
    const remainingRanks = Array.from({ length: targets.length }, (_, index) => index + 1).filter((rank) => !usedRanks.has(rank));
    targets.filter((player) => !Number.isInteger(state.selectedScores[player.uid])).forEach((player) => {
      state.selectedScores[player.uid] = remainingRanks.shift();
    });
    showToast("投票時間切れのため、未選択の順位を自動確定しました。");
  }
  lockScores().catch(handleRecoverableError);
}

function stopScoreTimer() {
  window.clearInterval(state.scoreTimerInterval);
  state.scoreTimerInterval = null;
}

async function lockSelection() {
  if (state.selectionLocking || state.roundSelections.has(state.round)) return;
  if (!roundParticipants().some((player) => player.uid === state.uid)) return;
  const eligible = eligibleSelectionCards();
  const selected = eligible.find((item) => item.id === state.selectedCardId);
  if (!selected) return;
  let swap = null;
  if (!state.tiebreakUids.length && selected.role !== currentMainRole()) {
    if (state.swapUsed || !selected.role.startsWith("reserve")) return;
    const main = state.deck.find((item) => item.role === currentMainRole());
    if (!main) return;
    swap = { main, selected, mainRole: main.role, reserveRole: selected.role };
    main.role = swap.reserveRole;
    selected.role = swap.mainRole;
    state.swapUsed = true;
  }
  state.selectionLocking = true;
  state.roundSelections.set(state.round, selected.id);
  state.screen = "waitingPick";
  render();
  try {
    await set(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/picks/${state.uid}`), {
      ready: true,
      lockedAt: serverTimestamp(),
    });
  } catch (error) {
    state.roundSelections.delete(state.round);
    if (swap) {
      swap.main.role = swap.mainRole;
      swap.selected.role = swap.reserveRole;
      state.swapUsed = false;
    }
    state.screen = "select";
    render();
    throw error;
  } finally {
    state.selectionLocking = false;
  }
}

async function autoLockSelection() {
  if (state.selectionLocking || state.roundSelections.has(state.round)) return;
  const eligible = eligibleSelectionCards();
  if (!eligible.length) throw new Error("使用できる画像がありません。");
  const selected = eligible.find((item) => item.id === state.selectedCardId) || eligible[0];
  state.selectedCardId = selected.id;
  window.HariaiAudio?.playCountdown?.(0);
  showToast("選択時間切れのため、未使用画像を自動ロックしました。");
  await lockSelection();
}

async function lockScores() {
  if (state.scoreLocking || state.scoredRounds.has(state.round)) return;
  const targets = scoreTargets();
  const values = {};
  if (isFinalJuryRound()) {
    const selected = targets.filter((player) => state.selectedScores[player.uid] === 1);
    if (selected.length !== 1) return;
    values[selected[0].uid] = 1;
  } else {
    const ranks = targets.map((player) => Number(state.selectedScores[player.uid]));
    if (ranks.some((rank) => !Number.isInteger(rank) || rank < 1 || rank > targets.length) || new Set(ranks).size !== targets.length) return;
    targets.forEach((player) => { values[player.uid] = Number(state.selectedScores[player.uid]); });
  }
  state.scoreLocking = true;
  state.scoredRounds.add(state.round);
  stopScoreTimer();
  state.screen = "waitingScore";
  render();
  try {
    await set(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/scores/${state.uid}`), {
      values,
      lockedAt: serverTimestamp(),
    });
    await recordDailyProgress({
      scores: isFinalJuryRound() ? 1 : targets.length,
      criticals: 0,
    }).catch(() => showToast("ミッション進捗を更新できませんでした。"));
  } catch (error) {
    state.scoredRounds.delete(state.round);
    state.screen = "score";
    startScoreTimer();
    render();
    throw error;
  } finally {
    state.scoreLocking = false;
  }
}

async function lockAudienceVote(pass = false) {
  if (state.audienceLocking || state.audienceVotedRounds.has(state.round) || !isLocalAudienceVoter()) return;
  const targetUid = pass ? "pass" : state.selectedAudienceUid;
  if (targetUid !== "pass" && !roundParticipants().some((player) => player.uid === targetUid)) return;
  state.audienceLocking = true;
  state.audienceVotedRounds.add(state.round);
  stopScoreTimer();
  state.screen = "waitingScore";
  render();
  try {
    await set(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/audienceVotes/${state.uid}`), targetUid);
  } catch (error) {
    state.audienceVotedRounds.delete(state.round);
    state.screen = "score";
    startScoreTimer();
    render();
    throw error;
  } finally {
    state.audienceLocking = false;
  }
}

function resolveRound(scores, audienceVotes = {}) {
  if (state.processedRounds.has(state.round)) return;
  const participants = roundParticipants();
  const voters = survivalVoters();
  const finalJury = isFinalJuryRound();
  const ballots = [];
  const images = {};
  for (const voter of voters) {
    const targets = voteTargetsFor(voter.uid);
    const values = scores[voter.uid]?.values || {};
    if (finalJury) {
      const selected = targets.filter((player) => Number(values[player.uid]) === 1);
      const winner = stableRoundOrder(selected.length ? selected : targets)[0];
      if (!winner) continue;
      ballots.push({ voterUid: voter.uid, targetCount: 1, points: Object.fromEntries(targets.map((player) => [player.uid, winner.uid === player.uid ? 1 : 0])), ranks: { [winner.uid]: 1 } });
      continue;
    }
    const normalizedRanks = {};
    const availableRanks = Array.from({ length: targets.length }, (_, index) => index + 1);
    stableRoundOrder(targets).forEach((player) => {
      const rank = Number(values[player.uid]);
      const availableIndex = availableRanks.indexOf(rank);
      if (!Number.isInteger(rank) || availableIndex < 0) return;
      normalizedRanks[player.uid] = rank;
      availableRanks.splice(availableIndex, 1);
    });
    stableRoundOrder(targets).filter((player) => !normalizedRanks[player.uid]).forEach((player) => {
      normalizedRanks[player.uid] = availableRanks.shift();
    });
    ballots.push({
      voterUid: voter.uid,
      targetCount: targets.length,
      points: Object.fromEntries(targets.map((player) => [player.uid, targets.length - normalizedRanks[player.uid] + 1])),
      ranks: normalizedRanks,
    });
  }
  for (const player of participants) {
    const received = ballots.filter((ballot) => Object.hasOwn(ballot.points, player.uid));
    const points = received.reduce((sum, ballot) => sum + Number(ballot.points[player.uid] || 0), 0);
    const maxPoints = received.reduce((sum, ballot) => sum + ballot.targetCount, 0);
    const firstVotes = received.filter((ballot) => ballot.ranks[player.uid] === 1).length;
    images[player.uid] = {
      uid: player.uid,
      points,
      maxPoints,
      firstVotes,
      supportRate: maxPoints ? points / maxPoints : 0,
      critical: false,
      perfect: received.length > 0 && firstVotes === received.length,
    };
  }
  const highest = Math.max(...Object.values(images).map((image) => image.points));
  const leaders = Object.values(images).filter((image) => image.points === highest);
  leaders.forEach((image) => { image.critical = leaders.length === 1; });

  const audienceCounts = {};
  Object.values(audienceVotes).forEach((uid) => {
    if (uid !== "pass" && participants.some((player) => player.uid === uid)) audienceCounts[uid] = Number(audienceCounts[uid] || 0) + 1;
  });
  const audienceMaximum = Math.max(0, ...Object.values(audienceCounts));
  const audienceLeaders = Object.entries(audienceCounts).filter(([, count]) => count === audienceMaximum);
  const audienceAwardUid = audienceMaximum > 0 && audienceLeaders.length === 1 ? audienceLeaders[0][0] : "";

  state.processedRounds.add(state.round);
  if (participants.some((player) => player.uid === state.uid)) {
    const localItem = getRoundImage(state.uid);
    if (localItem) localItem.used = true;
  }

  const wasTiebreak = state.tiebreakUids.length > 0;
  const minimum = Math.min(...Object.values(images).map((image) => image.points));
  const tied = participants.filter((player) => images[player.uid].points === minimum);
  let eliminatedUid = "";
  let lottery = false;
  let fallback = false;
  if (tied.length === 1) {
    eliminatedUid = tied[0].uid;
  } else if (finalJury) {
    const decision = chooseTiebreakLoser(tied, images);
    eliminatedUid = decision.uid;
    lottery = decision.lottery;
    fallback = true;
  } else if (!wasTiebreak && state.round < MAX_ROUNDS) {
    state.tiebreakUids = tied.map((player) => player.uid);
  } else {
    const decision = chooseTiebreakLoser(tied, images);
    eliminatedUid = decision.uid;
    lottery = decision.lottery;
    fallback = true;
  }

  let eliminatedPlace = null;
  if (eliminatedUid) {
    eliminatedPlace = alivePlayers().length;
    eliminatePlayer(eliminatedUid, lottery ? "lottery" : "score");
    state.tiebreakUids = [];
    images[eliminatedUid].eliminated = true;
  }
  const result = {
    round: state.round,
    participantUids: stableRoundOrder(participants).map((player) => player.uid),
    images,
    eliminatedUid,
    eliminatedPlace,
    lottery,
    fallback,
    finalJury,
    audienceAwardUid,
  };
  state.history.push(result);
  state.screen = "result";
  render();

  const allImages = Object.values(images);
  if (allImages.some((image) => image.perfect)) {
    window.HariaiAudio?.playResult?.(10);
    triggerCriticalFx("UNANIMOUS!");
  } else if (allImages.some((image) => image.critical)) {
    window.HariaiAudio?.playResult?.(8);
    triggerCriticalFx("ROUND FAVORITE!");
  }
  scheduleResultAdvance();
}

function chooseTiebreakLoser(tiedPlayers, currentImages) {
  const metrics = tiedPlayers.map((player) => {
    const previous = state.history.map((result) => result.images[player.uid]).filter(Boolean);
    const entries = [...previous, currentImages[player.uid]];
    return {
      uid: player.uid,
      support: entries.reduce((sum, image) => sum + Number(image.supportRate || 0), 0),
      firstVotes: entries.reduce((sum, image) => sum + Number(image.firstVotes || 0), 0),
      favorites: entries.filter((image) => image.critical).length,
    };
  }).sort((first, second) => first.support - second.support || first.firstVotes - second.firstVotes || first.favorites - second.favorites || first.uid.localeCompare(second.uid));
  const first = metrics[0];
  const tiedMetrics = metrics.filter((entry) => entry.support === first.support && entry.firstVotes === first.firstVotes && entry.favorites === first.favorites);
  if (tiedMetrics.length === 1) return { uid: first.uid, lottery: false };
  const ordered = tiedMetrics.map((entry) => entry.uid).sort();
  const index = stableHash(`${state.roomId}:lottery:${state.round}:${ordered.join(":")}`) % ordered.length;
  return { uid: ordered[index], lottery: true };
}

async function continueRound() {
  if (state.continuedRounds.has(state.round)) return;
  stopResultAdvance();
  state.screen = "waitingContinue";
  render();
  await set(ref(database, `online/royaleRooms/${state.roomId}/rounds/${state.round}/continue/${state.uid}`), true);
}

function scheduleResultAdvance() {
  stopResultAdvance();
  state.resultDeadline = Date.now() + RESULT_TIME_MS;
  state.resultAdvanceTimeout = window.setTimeout(() => continueRound().catch(handleRecoverableError), RESULT_TIME_MS);
  state.resultCountdownInterval = window.setInterval(() => {
    const timer = document.querySelector("[data-royale-result-timer]");
    if (timer) timer.textContent = String(resultAutoSeconds());
  }, 250);
}

function stopResultAdvance() {
  window.clearTimeout(state.resultAdvanceTimeout);
  window.clearInterval(state.resultCountdownInterval);
  state.resultAdvanceTimeout = null;
  state.resultCountdownInterval = null;
  state.resultDeadline = 0;
}

function advanceRound() {
  if (state.continuedRounds.has(state.round) || !state.processedRounds.has(state.round)) return;
  state.continuedRounds.add(state.round);
  if (isMatchOver()) {
    finishMatch().catch(handleRecoverableError);
    return;
  }
  releaseRoundImages(state.round);
  state.round += 1;
  state.roundData = {};
  state.selectedCardId = "";
  state.selectedScores = {};
  state.selectedAudienceUid = "";
  state.timerPhase = "waiting";
  state.timerRemainingMs = 0;
  prepareSelection();
  state.screen = roundParticipants().some((player) => player.uid === state.uid) ? "select" : "waitingPick";
  listenToRound();
  render();
  announceRoundReady().catch(handleRecoverableError);
}

function isMatchOver() {
  return alivePlayers().length <= 1;
}

function determineOutcome() {
  return { winnerUid: alivePlayers()[0]?.uid || "", reason: "last-survivor" };
}

async function finishMatch() {
  if (state.outcome) return;
  stopResultAdvance();
  state.outcome = determineOutcome();
  await Promise.all([
    commitRoyaleStats(),
    recordDailyProgress({ matches: 1 }).catch(() => showToast("ミッション進捗を更新できませんでした。")),
    set(ref(database, `online/royaleRooms/${state.roomId}/finished/${state.uid}`), true),
  ]);
  state.screen = "gameover";
  setRoyaleChrome("ROYALE COMPLETE");
  render();
}

async function commitRoyaleStats() {
  if (state.statsCommitted) return;
  const won = state.outcome.winnerUid === state.uid;
  const localPlace = won ? 1 : Number(state.eliminated[state.uid]?.place || 4);
  await commitPlacementStats(localPlace, won);
}

async function commitPlacementStats(localPlace, won) {
  if (state.statsCommitted) return;
  state.statsCommitted = true;
  const result = await runTransaction(ref(database, `online/royaleProfiles/${state.uid}`), (current) => {
    const record = {
      name: state.name,
      wins: Number(current?.wins || 0),
      topTwo: Number(current?.topTwo || 0),
      matches: Number(current?.matches || 0),
      streak: Number(current?.streak || 0),
      bestStreak: Number(current?.bestStreak || 0),
      updatedAt: now(),
    };
    record.matches += 1;
    if (localPlace <= 2) record.topTwo += 1;
    if (won) {
      record.wins += 1;
      record.streak += 1;
      record.bestStreak = Math.max(record.bestStreak, record.streak);
    } else {
      record.streak = 0;
    }
    return record;
  });
  if (result.committed) {
    state.royaleProfile = result.snapshot.val();
    const overallUpdate = window.HariaiOnline?.recordOverallResult?.({
      mode: "royale",
      outcome: localPlace === 1 ? "win" : localPlace === 2 ? "draw" : "loss",
      name: state.name,
      opponentRating: 1000,
    });
    if (overallUpdate) await overallUpdate.catch(() => showToast("総合ランキングを更新できませんでした。"));
  }
}

async function recordDailyProgress(changes) {
  if (!state.uid) return;
  const before = { ...(state.economy.daily || {}) };
  const result = await runTransaction(ref(database, `online/economy/${state.uid}`), (current) => {
    const record = normalizeEconomy(current);
    record.daily.matches = Math.min(1, record.daily.matches + Math.max(0, Number(changes.matches || 0)));
    record.daily.scores = Math.min(3, record.daily.scores + Math.max(0, Number(changes.scores || 0)));
    record.daily.criticals = Math.min(1, record.daily.criticals + Math.max(0, Number(changes.criticals || 0)));
    record.updatedAt = now();
    return record;
  });
  if (!result.committed) return;
  state.economy = normalizeEconomy(result.snapshot.val());
  const completed = [
    ["matches", 1, "1試合を完走"],
    ["scores", 3, "3回採点する"],
    ["criticals", 1, "8点以上をつける"],
  ].filter(([key, target]) => Number(before[key] || 0) < target && Number(state.economy.daily[key] || 0) >= target);
  if (completed.length) showToast(`デイリーミッション達成：${completed.map((entry) => entry[2]).join("・")}`);
}

async function sendAllChat(value) {
  if (["select", "waitingPick", "waitingImages", "reveal", "score", "waitingScore"].includes(state.screen)) {
    showToast("匿名投票が終わるまでチャットは利用できません。");
    return;
  }
  const text = String(value || "").trim().slice(0, 80);
  if (!text || !state.roomId) return;
  const message = {
    authorUid: state.uid,
    name: state.name,
    text,
    round: state.round,
    createdAt: serverTimestamp(),
  };
  if (titleLabel()) message.titleId = state.economy.equipped.title;
  await set(push(ref(database, `online/royaleRooms/${state.roomId}/chat`)), message).catch(() => showToast("4人チャットを送信できませんでした。"));
}

function refreshChats() {
  const allList = document.querySelector("#royaleAllChatMessages");
  if (allList) allList.innerHTML = renderMessages(state.allChatMessages, "公開された画像について4人で話してみましょう。");
  scrollChats();
}

function scrollChats() {
  ["#royaleAllChatMessages"].forEach((selector) => {
    const list = document.querySelector(selector);
    if (list) list.scrollTop = list.scrollHeight;
  });
}

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
}

function requestHome() {
  if (["setup", "matching", "gameover", "noContest", "error"].includes(state.screen)) leaveToLanding();
  else {
    configureExitDialog();
    destroyDialog.showModal();
  }
}

async function destroyRoom() {
  if (!active || state.leaving) return;
  state.leaving = true;
  const targetRoomId = state.roomId || state.pendingRoomId;
  if (state.roomId) {
    const place = Number(state.eliminated[state.uid]?.place || alivePlayers().length);
    if (!state.eliminated[state.uid]) eliminatePlayer(state.uid, "forfeit");
    await Promise.allSettled([
      runTransaction(ref(database, `online/royaleRooms/${state.roomId}/forfeits/${state.uid}`), (current) => current || { by: state.uid, at: Date.now(), reason: "user" }),
      commitPlacementStats(place, false),
    ]);
  } else if (targetRoomId) {
    if (state.room?.hostUid === state.uid) {
      await runTransaction(ref(database, `online/royaleRooms/${targetRoomId}/status`), (current) => current === "forming" ? "expired" : undefined).catch(() => {});
    }
  }
  await cleanupRoomResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
  showToast(state.roomId ? "バトルロワイヤルから退出しました。" : "参加を取り消しました。");
}

async function cancelMatching() {
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  state.screen = "setup";
  setRoyaleChrome("BATTLE ROYALE READY");
  render();
}

async function resetSetup() {
  const identity = {
    uid: state.uid,
    name: state.name,
    authReady: state.authReady,
    profile: state.profile,
    royaleProfile: state.royaleProfile,
    economy: state.economy,
    serverTimeOffset: state.serverTimeOffset,
  };
  await cleanupRoomResources(false);
  releaseAllImages();
  state = createState();
  Object.assign(state, identity);
  state.screen = "setup";
  setRoyaleChrome("BATTLE ROYALE READY");
  render();
}

async function retryConnection() {
  const savedName = state.name;
  await cleanupRoomResources(false);
  releaseAllImages();
  state = createState();
  state.name = savedName;
  state.screen = "setup";
  setRoyaleChrome("CONNECTING");
  render();
  await ensureAuthenticated().catch(handleFatalError);
}

async function leaveToLanding() {
  await cleanupRoomResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
}

async function cleanupMatchmaking(keepActive) {
  window.clearTimeout(state.matchTimer);
  window.clearInterval(state.queueHeartbeat);
  state.matchTimer = null;
  state.queueHeartbeat = null;
  state.matchmakingUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  if (!state.uid) return;
  const removals = [
    remove(ref(database, `online/royaleQueue/${state.uid}`)),
    remove(ref(database, `online/royaleInvites/${state.uid}`)),
  ];
  if (!keepActive) removals.push(remove(ref(database, `online/royaleActive/${state.uid}`)));
  if (!keepActive && state.pendingRoomId) removals.push(remove(ref(database, `online/royaleRooms/${state.pendingRoomId}/accepted/${state.uid}`)));
  if (state.room?.hostUid === state.uid && state.pendingRoomId) {
    Object.keys(state.room.members || {}).forEach((uid) => {
      if (uid !== state.uid) removals.push(remove(ref(database, `online/royaleInvites/${uid}/${state.pendingRoomId}`)));
    });
  }
  await Promise.allSettled(removals);
}

async function cleanupRoomResources(keepActive) {
  stopPhaseTimer();
  stopScoreTimer();
  stopResultAdvance();
  state.disconnectTimers.forEach((timer) => window.clearTimeout(timer));
  state.disconnectTimers.clear();
  await cleanupMatchmaking(keepActive);
  await cleanupPublicPresence();
  state.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.roundUnsubscribe?.();
  state.roundUnsubscribe = null;
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  state.connections.forEach((connection) => {
    if (connection.channel) {
      connection.channel.onclose = null;
      connection.channel.close();
    }
    connection.peer.onconnectionstatechange = null;
    connection.peer.close();
  });
  state.connections.clear();
  if (state.roomId) {
    await Promise.allSettled([
      set(ref(database, `online/royaleRooms/${state.roomId}/presence/${state.uid}`), { online: false, updatedAt: serverTimestamp() }),
      keepActive ? Promise.resolve() : remove(ref(database, `online/royaleActive/${state.uid}`)),
    ]);
  }
}

function releaseRoundImages(round) {
  state.remoteImages.forEach((rounds) => {
    const item = rounds.get(round);
    if (item?.url) URL.revokeObjectURL(item.url);
    rounds.delete(round);
  });
}

function releaseAllImages() {
  state.deck.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = "";
    item.blob = null;
  });
  state.remoteImages.forEach((rounds) => rounds.forEach((item) => item.url && URL.revokeObjectURL(item.url)));
  state.remoteImages.clear();
  state.remoteAvatars.forEach((avatar) => avatar.url && URL.revokeObjectURL(avatar.url));
  state.remoteAvatars.clear();
  state.allChatMessages = [];
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "バトルロワイヤル通信処理に失敗しました。");
}

function handleFatalError(error) {
  console.error(error);
  state.errorMessage = friendlyFirebaseError(error);
  state.screen = "error";
  setRoyaleChrome("CONNECTION ERROR");
  render();
}

function friendlyFirebaseError(error) {
  if (error?.code === "auth/admin-restricted-operation") return "Firebaseの匿名ログインが無効です。Authentication設定を確認してください。";
  if (error?.code === "PERMISSION_DENIED" || String(error?.message).includes("PERMISSION_DENIED")) return "Realtime Databaseのバトルロワイヤル用セキュリティルールにより接続が拒否されました。";
  return error?.message || "Firebaseへ接続できませんでした。";
}

window.addEventListener("beforeunload", () => {
  releaseAllImages();
  state.connections.forEach((connection) => connection.peer.close());
});

window.HariaiRoyale = { start, isActive, requestHome, destroyRoom };
window.dispatchEvent(new Event("hariai-royale-ready"));
