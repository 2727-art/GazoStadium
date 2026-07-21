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

const MAX_HP = 30;
const MAX_ROUNDS = 5;
const TEAM_SIZE = 2;
const PLAYER_COUNT = 4;
const STRATEGY_TIME_MS = 20_000;
const SELECTION_TIME_MS = 10_000;
const SCORE_TIME_MS = 20_000;
const MATCH_TIMEOUT_MS = 30_000;
const QUEUE_FRESH_MS = 45_000;
const HEARTBEAT_MS = 20_000;
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const INITIAL_RATING = 1000;
const RATING_K_FACTOR = 32;
const DEFAULT_REACTIONS = ["すごい！", "かわいい", "センスいい", "もっと見たい"];
const SHOP_REACTIONS = [
  { id: "reaction_best_shot", reaction: "最高の一枚！" },
  { id: "reaction_healing", reaction: "癒やされる" },
  { id: "reaction_story", reaction: "物語を感じる" },
  { id: "reaction_masterpiece", reaction: "これは名作" },
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
    teamProfile: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, rating: INITIAL_RATING },
    economy: { points: 0, inventory: {}, daily: {} },
    deck: [],
    roomId: "",
    room: null,
    members: [],
    team: "",
    teams: createTeams(),
    round: 1,
    roundData: {},
    roundSelections: new Map(),
    selectedCardId: "",
    selectedScores: {},
    history: [],
    outcome: null,
    processedRounds: new Set(),
    continuedRounds: new Set(),
    sentImageRounds: new Set(),
    imageReadyRounds: new Set(),
    roundReadyRounds: new Set(),
    remoteImages: new Map(),
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
    serverTimeOffset: 0,
    timerPhase: "waiting",
    timerRemainingMs: 0,
    selectionLocking: false,
    scoreLocking: false,
    scoredRounds: new Set(),
    teamChatMessages: [],
    allChatMessages: [],
    seenTeamChatIds: new Set(),
    seenAllChatIds: new Set(),
    publicPresenceId: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    publicPresenceState: "",
    disconnectHandles: [],
    matchmakingUnsubscribers: [],
    roomUnsubscribers: [],
    roundUnsubscribe: null,
    statsCommitted: false,
    destroyed: false,
    errorMessage: "",
  };
}

function createTeams() {
  return {
    A: { hp: MAX_HP, totalScore: 0, criticals: 0, perfects: 0 },
    B: { hp: MAX_HP, totalScore: 0, criticals: 0, perfects: 0 },
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
    showToast("2on2対戦はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (window.HariaiOnline?.isActive?.()) {
    showToast("1on1画面を終了してから2on2を開始してください。");
    return;
  }
  active = true;
  state = createState();
  setTeamChrome("CONNECTING");
  render();
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
  const [profileSnapshot, teamProfileSnapshot, economySnapshot] = await Promise.all([
    get(ref(database, `online/profiles/${state.uid}`)),
    get(ref(database, `online/teamProfiles/${state.uid}`)),
    get(ref(database, `online/economy/${state.uid}`)),
  ]);
  if (profileSnapshot.exists()) {
    state.profile = { ...state.profile, ...profileSnapshot.val() };
    if (!localStorage.getItem(PROFILE_NAME_KEY) && state.profile.name) state.name = state.profile.name;
  }
  if (teamProfileSnapshot.exists()) state.teamProfile = { ...state.teamProfile, ...teamProfileSnapshot.val() };
  if (economySnapshot.exists()) state.economy = normalizeEconomy(economySnapshot.val());
  state.authReady = true;
  setTeamChrome("2ON2 READY");
  render();
}

function normalizeEconomy(value) {
  const source = value || {};
  const dateKey = jstDateKey(now());
  const sameDate = source.daily?.dateKey === dateKey;
  const inventory = {};
  SHOP_REACTIONS.forEach((item) => {
    if (source.inventory?.[item.id] === true) inventory[item.id] = true;
  });
  const daily = { dateKey, matches: 0, scores: 0, criticals: 0, claimed: {} };
  if (sameDate) {
    daily.matches = Math.min(1, Math.max(0, Math.floor(Number(source.daily.matches || 0))));
    daily.scores = Math.min(3, Math.max(0, Math.floor(Number(source.daily.scores || 0))));
    daily.criticals = Math.min(1, Math.max(0, Math.floor(Number(source.daily.criticals || 0))));
    ["complete_match", "score_three", "give_critical"].forEach((id) => {
      if (source.daily.claimed?.[id] === true) daily.claimed[id] = true;
    });
  }
  return { points: Math.min(999_999, Math.max(0, Math.floor(Number(source.points || 0)))), inventory, daily, updatedAt: now() };
}

function jstDateKey(timestamp = Date.now()) {
  return new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function setTeamChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "4人P2P画像転送";
  if (footerItems[0]) footerItems[0].textContent = "ONLINE 2ON2 / FIREBASE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "4人の画像はP2P転送し、Firebaseには保存しません";
}

function render() {
  if (!active) return;
  const renderers = {
    setup: renderSetup,
    matching: renderMatching,
    forming: renderForming,
    connecting: renderConnecting,
    strategy: renderStrategy,
    select: renderSelection,
    waitingPick: renderWaitingPick,
    waitingImages: renderWaitingImages,
    reveal: renderReveal,
    score: renderScoring,
    waitingScore: renderWaitingScore,
    result: renderResult,
    waitingContinue: renderWaitingContinue,
    gameover: renderGameOver,
    noContest: renderNoContest,
    error: renderError,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderSetup)();
  bindEvents();
  appRoot.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSetup() {
  const slots = Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const item = state.deck[index];
    if (!item) return `<div class="deck-slot empty" aria-label="空きスロット ${index + 1}">${String(index + 1).padStart(2, "0")}</div>`;
    return `<div class="deck-slot"><img src="${item.url}" alt="2on2選択画像 ${index + 1}" draggable="false" />
      <div class="deck-label"><span>TEAM ENTRY ${String(index + 1).padStart(2, "0")}</span><button class="remove-card" data-team-remove="${item.id}" aria-label="画像${index + 1}を削除">×</button></div></div>`;
  }).join("");
  const ready = state.authReady && state.deck.length === MAX_ROUNDS && state.name.trim();
  return `<section class="screen"><div class="section-head"><div><span class="eyebrow">ONLINE 2ON2 TEAM BATTLE</span><h1>2on2チーム対戦の準備</h1>
    <p>4人が集まると自動で2チームに分かれます。5ラウンドすべてで4人全員が画像を出します。</p></div>
    <button class="button button-ghost button-small" id="teamBackHome">タイトルへ</button></div>
    <div class="online-profile-strip"><span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● Firebase接続済み" : "○ Firebaseへ接続中…"}</span>
      <span>2ON2 RATE ${Number(state.teamProfile.rating || INITIAL_RATING)}</span><span>${state.teamProfile.wins}勝 ${state.teamProfile.losses}敗 ${state.teamProfile.draws}分</span>
      <span>🔥 ${state.teamProfile.streak}連勝中</span></div>
    <div class="team-rule-summary"><div><strong>4</strong><span>PLAYERS</span></div><div><strong>2</strong><span>TEAMS</span></div><div><strong>30</strong><span>SHARED HP</span></div><div><strong>20+10</strong><span>SEC</span></div></div>
    <div class="setup-layout"><aside class="setup-guide"><h2>2on2の流れ</h2><ol class="guide-list">
      <li><b>1</b><span>チーム専用チャットで20秒間、画像の方向性を相談します。</span></li><li><b>2</b><span>10秒以内に各自が秘密の画像を1枚選びます。</span></li>
      <li><b>3</b><span>相手チームの画像2枚を採点し、4票の平均でチーム得点を決めます。</span></li></ol>
      <div class="privacy-note">画像は最大1280pxへ変換し、Firebaseには保存しません。</div></aside>
      <div class="setup-panel"><label class="field-label">表示名<input class="text-input" id="teamPlayerName" maxlength="16" value="${escapeHtml(state.name)}" autocomplete="nickname" /></label>
        <div class="deck-toolbar"><div class="deck-counter"><strong>${state.deck.length}</strong> / 5 IMAGES</div><div class="upload-actions">
          <label class="button button-cyan button-small file-button">画像を追加<input id="teamImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple ${state.deck.length >= MAX_ROUNDS ? "disabled" : ""} /></label>
          <button class="button button-ghost button-small" id="teamFillSample">サンプル画像で埋める</button></div></div>
        <div class="deck-grid">${slots}</div><div class="setup-actions"><button class="button button-primary" id="findTeamMatch" ${ready ? "" : "disabled"}>4人マッチングを開始</button></div>
      </div></div></section>`;
}

function renderMatching() {
  return renderStatusCard("◎", "2ON2 MATCHING", "あと3人を待っています", "待機中のプレイヤーが4人揃うと、自動でランダムにチーム分けします。", `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">● 4人キュー参加中</span>`, `<button class="button button-ghost" id="cancelTeamMatching">マッチングをやめる</button>`);
}

function renderForming() {
  const accepted = Object.keys(state.room?.accepted || {}).length;
  return renderStatusCard("4", "TEAM FORMING", "4人の参加確認中", `${accepted} / 4人が参加を確定しました。全員揃うまでお待ちください。`, `<span class="connection-pill connected">● チーム分け完了</span>`, `<button class="button button-danger button-small" data-team-destroy>ルーム破棄</button>`);
}

function renderConnecting() {
  const connected = [...state.connections.values()].filter((connection) => connection.channel?.readyState === "open").length;
  return renderStatusCard("P2P", "4 PLAYER MESH", "4人の画像通信を準備中", `${connected} / 3人とP2P接続済みです。`, `<span class="connection-pill ${connected === 3 ? "connected" : ""}">● ${connected} / 3 CONNECTIONS</span>`, `<button class="button button-danger button-small" data-team-destroy>ルーム破棄</button>`);
}

function renderStatusCard(icon, eyebrow, title, body, details = "", actions = "") {
  return `<section class="screen handoff-wrap"><div class="handoff-card online-status-card"><div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
    <span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><div class="online-status-details">${details}</div><div class="button-row">${actions}</div></div></section>`;
}

function teamMembers(team) {
  return state.members.filter((player) => player.team === team).sort((first, second) => Number(first.slot) - Number(second.slot));
}

function opponentTeam() {
  return state.team === "A" ? "B" : "A";
}

function renderTeamHud() {
  const teamBlock = (team) => `<div class="team-hud ${team === state.team ? "local-team" : ""}"><div class="team-hud-head"><strong>TEAM ${team}${team === state.team ? "（あなた）" : ""}</strong><span>HP ${state.teams[team].hp} / ${MAX_HP}</span></div>
    <div class="hp-bar"><div class="hp-fill" style="--hp:${Math.max(0, (state.teams[team].hp / MAX_HP) * 100)}%"></div></div><small>${teamMembers(team).map((player) => escapeHtml(player.name)).join(" + ")}</small></div>`;
  return `<div class="team-round-hud">${teamBlock("A")}<div class="round-badge"><small>ROUND</small><strong>${state.round} / ${MAX_ROUNDS}</strong></div>${teamBlock("B")}</div>
    <div class="online-room-strip"><span>2ON2 ROOM ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span><span class="connection-pill connected">● 4 PLAYER P2P</span><span>あなたは TEAM ${state.team}</span></div>`;
}

function timerSeconds() {
  return Math.max(0, Math.ceil(state.timerRemainingMs / 1000));
}

function scoreTimerSeconds() {
  const startedAt = Number(state.roundData.scoringStartedAt || 0);
  if (!startedAt) return Math.ceil(SCORE_TIME_MS / 1000);
  return Math.max(0, Math.ceil((SCORE_TIME_MS - (now() - startedAt)) / 1000));
}

function renderStrategy() {
  return `<section class="screen">${renderTeamHud()}<div class="section-head"><div><span class="eyebrow">TEAM STRATEGY</span><h1>作戦会議</h1>
    <p>TEAM ${state.team}だけに見えるチャットです。「植物系で揃える」など方向性を相談しましょう。</p></div><div class="team-phase-timer"><small>STRATEGY</small><strong data-team-timer>${state.timerPhase === "strategy" ? timerSeconds() : "--"}</strong></div></div>
    <div class="team-strategy-layout"><div class="team-members-card">${teamMembers(state.team).map((player) => `<div class="team-member-row"><span>${player.uid === state.uid ? "YOU" : "MATE"}</span><strong>${escapeHtml(player.name)}</strong></div>`).join("")}</div>${renderTeamChat()}</div>
    <div class="screen-actions"><button class="button button-danger button-small" data-team-destroy>ルーム破棄</button></div></section>`;
}

function renderSelection() {
  const remaining = timerSeconds();
  const cards = state.deck.map((item, index) => `<button class="select-card ${item.used ? "used" : ""} ${state.selectedCardId === item.id ? "selected" : ""}" data-team-card="${item.id}" ${item.used ? "disabled" : ""} aria-pressed="${state.selectedCardId === item.id}">
    <img src="${item.url}" alt="2on2候補画像 ${index + 1}" draggable="false" /><span>${item.used ? "USED" : `ENTRY ${String(index + 1).padStart(2, "0")}`}</span></button>`).join("");
  return `<section class="screen">${renderTeamHud()}<div class="section-head"><div><span class="eyebrow">SECRET TEAM PICK</span><h1>画像を選択</h1><p>相方の画像も公開まで見えません。作戦チャットを参考に1枚選んでください。</p></div>
    <div class="team-phase-timer ${remaining <= 3 ? "warning" : ""}"><small>SELECT</small><strong data-team-timer>${remaining}</strong></div></div>
    <div class="select-panel"><div class="select-grid">${cards}</div><div class="selection-footer"><button class="button button-danger button-small" data-team-destroy>ルーム破棄</button>
      <button class="button button-primary" id="lockTeamSelection" ${state.selectedCardId ? "" : "disabled"}>この画像で決定</button></div></div>${renderTeamChat()}</section>`;
}

function renderWaitingPick() {
  const ready = Object.keys(state.roundData.picks || {}).length;
  return `<section class="screen">${renderTeamHud()}${renderStatusCardInner("⌛", "TEAM PICK LOCKED", "全員の選択を待っています", `${ready} / 4人が選択済みです。画像内容はまだ公開されません。`)}${renderTeamChat()}</section>`;
}

function renderWaitingImages() {
  const ready = Object.keys(state.roundData.imagesReady || {}).length;
  return `<section class="screen">${renderTeamHud()}${renderStatusCardInner("⇄", "P2P IMAGE TRANSFER", "4枚の画像を転送中", `${ready} / 4人が画像受信を完了しました。Firebaseには保存していません。`)}</section>`;
}

function renderStatusCardInner(icon, eyebrow, title, body) {
  return `<div class="handoff-card online-status-card team-inline-status"><div class="handoff-icon" aria-hidden="true">${icon}</div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${body}</p><div class="matching-pulse"><i></i><i></i><i></i></div><div class="screen-actions"><button class="button button-danger button-small" data-team-destroy>ルーム破棄</button></div></div>`;
}

function getRoundImage(uid, round = state.round) {
  if (uid === state.uid) {
    const cardId = state.roundSelections.get(round);
    return state.deck.find((item) => item.id === cardId);
  }
  return state.remoteImages.get(uid)?.get(round);
}

function renderFourImages(withScores = null) {
  const group = (team) => `<div class="team-image-group"><div class="team-image-group-head"><strong>TEAM ${team}</strong><span>${team === state.team ? "YOUR TEAM" : "OPPONENT"}</span></div>
    <div class="team-image-pair">${teamMembers(team).map((player) => { const item = getRoundImage(player.uid); const result = withScores?.images?.[player.uid]; return `<article class="team-image-card ${result?.perfect ? "perfect" : result?.critical ? "critical" : ""}">
      <div class="team-image-owner"><span>${escapeHtml(player.name)}</span>${result ? `<strong>${result.average.toFixed(1)}</strong>` : ""}</div><img src="${item?.url || ""}" alt="${escapeHtml(player.name)}の画像" draggable="false" />
      ${result ? `<div class="team-image-votes"><span>${result.votes.map((score) => `${score}点`).join(" / ")}</span><b>${result.perfect ? "PERFECT" : result.critical ? "CRITICAL" : ""}</b></div>` : ""}</article>`; }).join("")}</div></div>`;
  return `<div class="four-image-board">${group("A")}<div class="team-versus">VS</div>${group("B")}</div>`;
}

function renderReveal() {
  return `<section class="screen">${renderTeamHud()}<div class="section-head"><div><span class="eyebrow">FOUR IMAGE REVEAL</span><h1>4枚同時公開</h1><p>相手チームの2枚をそれぞれ採点します。時間切れの未採点は5点になります。</p></div>
    <div class="team-phase-timer"><small>SCORE</small><strong data-team-score-timer>${scoreTimerSeconds()}</strong></div></div>${renderFourImages()}
    <div class="screen-actions"><button class="button button-danger button-small" data-team-destroy>ルーム破棄</button><button class="button button-primary" id="beginTeamScoring">相手2枚を採点する</button></div>${renderAllChat()}</section>`;
}

function renderScoring() {
  const opponents = teamMembers(opponentTeam());
  const panels = opponents.map((player) => { const item = getRoundImage(player.uid); const current = Number(state.selectedScores[player.uid] || 0); return `<article class="team-score-card"><div class="team-score-image"><span>${escapeHtml(player.name)} / TEAM ${player.team}</span><img src="${item?.url || ""}" alt="採点する${escapeHtml(player.name)}の画像" draggable="false" /></div>
    <div class="team-score-controls"><strong>${current || "--"}</strong><div class="score-buttons">${Array.from({ length: 10 }, (_, index) => index + 1).map((score) => `<button class="score-button ${current === score ? "selected" : ""}" data-team-score-target="${player.uid}" data-team-score="${score}">${score}</button>`).join("")}</div></div></article>`; }).join("");
  return `<section class="screen">${renderTeamHud()}<div class="section-head"><div><span class="eyebrow">DOUBLE SCORING</span><h1>相手チームの2枚を採点</h1><p>各画像を1～10点で評価してください。2人分の採点平均が画像得点になります。</p></div>
    <div class="team-phase-timer ${scoreTimerSeconds() <= 5 ? "warning" : ""}"><small>SCORE</small><strong data-team-score-timer>${scoreTimerSeconds()}</strong></div></div><div class="team-score-grid">${panels}</div>
    <div class="screen-actions"><button class="button button-danger button-small" data-team-destroy>ルーム破棄</button><button class="button button-primary" id="lockTeamScores" ${opponents.every((player) => Number.isInteger(state.selectedScores[player.uid])) ? "" : "disabled"}>2枚の採点を確定</button></div>${renderAllChat()}</section>`;
}

function renderWaitingScore() {
  const ready = Object.keys(state.roundData.scores || {}).length;
  return `<section class="screen">${renderTeamHud()}${renderStatusCardInner("✦", "VOTE LOCKED", "4人の採点を集計中", `${ready} / 4人が採点済みです。`) }${renderAllChat()}</section>`;
}

function renderResult() {
  const result = state.history.at(-1);
  const damageText = result.winnerTeam ? `TEAM ${result.winnerTeam} WIN / ${result.damage} DAMAGE` : "DRAW / NO DAMAGE";
  return `<section class="screen">${renderTeamHud()}<div class="section-head"><div><span class="eyebrow">TEAM ROUND RESULT</span><h1>ROUND ${state.round} 結果</h1><p>各画像は相手2人の平均、チーム得点は2枚の平均です。</p></div></div>${renderFourImages(result)}
    <div class="team-result-score"><div><span>TEAM A</span><strong>${result.teamScores.A.toFixed(1)}</strong></div><b>${damageText}</b><div><span>TEAM B</span><strong>${result.teamScores.B.toFixed(1)}</strong></div></div>
    <div class="screen-actions"><button class="button button-danger button-small" data-team-destroy>ルーム破棄</button><button class="button button-primary" id="continueTeamRound">${isMatchOver() ? "試合結果を見る" : `ROUND ${state.round + 1}へ`}</button></div>${renderAllChat()}</section>`;
}

function renderWaitingContinue() {
  const ready = Object.keys(state.roundData.continue || {}).length;
  return `<section class="screen">${renderTeamHud()}${renderStatusCardInner("→", "NEXT ROUND", "全員の準備を待っています", `${ready} / 4人が次へ進む準備を完了しました。`) }${renderAllChat()}</section>`;
}

function renderGameOver() {
  const outcome = state.outcome;
  const title = outcome.winnerTeam ? `TEAM ${outcome.winnerTeam} WIN` : "DRAW";
  const teamCard = (team) => `<article class="team-final-card ${outcome.winnerTeam === team ? "winner" : ""}"><span>TEAM ${team}</span><h2>${teamMembers(team).map((player) => escapeHtml(player.name)).join(" + ")}</h2>
    <div class="stats-row"><div class="stat-box"><strong>${state.teams[team].hp}</strong><span>残りHP</span></div><div class="stat-box"><strong>${state.teams[team].totalScore.toFixed(1)}</strong><span>累計得点</span></div><div class="stat-box"><strong>${state.teams[team].criticals}</strong><span>CRITICAL</span></div></div></article>`;
  return `<section class="screen gameover-wrap"><div class="gameover-card team-gameover"><div class="winner-emblem">${outcome.winnerTeam || "="}</div><span class="eyebrow">2ON2 MATCH COMPLETE</span><h1>${title}</h1><p>共有HP、累計得点、CRITICAL、PERFECTの順で判定しました。</p>
    <div class="team-final-grid">${teamCard("A")}${teamCard("B")}</div><div class="online-profile-strip"><span>あなたの2ON2戦績</span><span>${state.teamProfile.wins}勝 ${state.teamProfile.losses}敗 ${state.teamProfile.draws}分</span><span>RATE ${state.teamProfile.rating}</span></div>
    <div class="gameover-actions"><button class="button button-primary" id="teamNewMatch">もう一度2on2</button><button class="button button-ghost" id="teamGameoverHome">タイトルへ戻る</button></div></div></section>`;
}

function renderNoContest() {
  return renderStatusCard("×", "2ON2 NO CONTEST", "チーム対戦を終了しました", "1人以上が退出または切断したため、戦績とミッションには影響しません。", "", `<button class="button button-primary" id="teamNoContestAgain">もう一度探す</button><button class="button button-ghost" id="teamNoContestHome">タイトルへ</button>`);
}

function renderError() {
  return renderStatusCard("!", "2ON2 CONNECTION ERROR", "2on2接続に失敗しました", state.errorMessage || "通信状態を確認してください。", "", `<button class="button button-primary" id="teamRetry">もう一度試す</button><button class="button button-ghost" id="teamErrorHome">タイトルへ</button>`);
}

function unlockedReactions() {
  return [...DEFAULT_REACTIONS, ...SHOP_REACTIONS.filter((item) => state.economy.inventory?.[item.id]).map((item) => item.reaction)];
}

function renderMessages(messages, emptyText) {
  return messages.length ? messages.map((message) => `<div class="chat-message ${message.authorUid === state.uid ? "player-one" : "player-two"}"><small>${escapeHtml(message.name)} / R${message.round}</small><p>${escapeHtml(message.text)}</p></div>`).join("") : `<div class="chat-empty">${escapeHtml(emptyText)}</div>`;
}

function renderTeamChat() {
  return `<aside class="chat-panel team-private-chat"><div class="chat-head"><strong>TEAM ${state.team} STRATEGY CHAT</strong><span>相手チームには非公開</span></div><div class="chat-messages" id="teamChatMessages">${renderMessages(state.teamChatMessages, "相方と画像の方向性を相談しましょう。")}</div>
    <div class="quick-reactions">${unlockedReactions().map((text) => `<button class="reaction-button" data-team-reaction="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}</div><form class="chat-form" id="teamChatForm"><input class="chat-input" id="teamChatInput" maxlength="80" placeholder="作戦を相談する…" aria-label="チーム作戦チャット" /><button class="button button-cyan button-small">送信</button></form></aside>`;
}

function renderAllChat() {
  return `<aside class="chat-panel online-chat-standalone"><div class="chat-head"><strong>ALL CHAT / 4 PLAYERS</strong><span>4人全員に表示</span></div><div class="chat-messages" id="teamAllChatMessages">${renderMessages(state.allChatMessages, "公開された画像について4人で話してみましょう。")}</div>
    <div class="quick-reactions">${unlockedReactions().map((text) => `<button class="reaction-button" data-all-reaction="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}</div><form class="chat-form" id="teamAllChatForm"><input class="chat-input" id="teamAllChatInput" maxlength="80" placeholder="4人へひとこと…" aria-label="4人共通チャット" /><button class="button button-cyan button-small">送信</button></form></aside>`;
}

function bindEvents() {
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("contextmenu", (event) => event.preventDefault());
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });
  document.querySelectorAll("[data-team-destroy]").forEach((button) => button.addEventListener("click", () => destroyDialog.showModal()));
  bindChatEvents();
  if (state.screen === "setup") bindSetupEvents();
  if (state.screen === "matching") document.querySelector("#cancelTeamMatching")?.addEventListener("click", cancelMatching);
  if (state.screen === "select") bindSelectionEvents();
  if (state.screen === "reveal") document.querySelector("#beginTeamScoring")?.addEventListener("click", () => { state.screen = "score"; render(); });
  if (state.screen === "score") bindScoreEvents();
  if (state.screen === "result") document.querySelector("#continueTeamRound")?.addEventListener("click", continueRound);
  if (state.screen === "gameover") {
    document.querySelector("#teamNewMatch")?.addEventListener("click", resetSetup);
    document.querySelector("#teamGameoverHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "noContest") {
    document.querySelector("#teamNoContestAgain")?.addEventListener("click", resetSetup);
    document.querySelector("#teamNoContestHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "error") {
    document.querySelector("#teamRetry")?.addEventListener("click", retryConnection);
    document.querySelector("#teamErrorHome")?.addEventListener("click", leaveToLanding);
  }
}

function bindSetupEvents() {
  document.querySelector("#teamBackHome")?.addEventListener("click", leaveToLanding);
  const nameInput = document.querySelector("#teamPlayerName");
  nameInput?.addEventListener("input", () => {
    state.name = nameInput.value.slice(0, 16);
    const button = document.querySelector("#findTeamMatch");
    if (button) button.disabled = !state.authReady || state.deck.length !== MAX_ROUNDS || !state.name.trim();
  });
  document.querySelector("#teamImageInput")?.addEventListener("change", handleImageInput);
  document.querySelector("#teamFillSample")?.addEventListener("click", fillSampleDeck);
  document.querySelectorAll("[data-team-remove]").forEach((button) => button.addEventListener("click", () => removeDeckItem(button.dataset.teamRemove)));
  document.querySelector("#findTeamMatch")?.addEventListener("click", beginMatchmaking);
}

function bindSelectionEvents() {
  document.querySelectorAll("[data-team-card]").forEach((button) => button.addEventListener("click", () => {
    state.selectedCardId = button.dataset.teamCard;
    render();
  }));
  document.querySelector("#lockTeamSelection")?.addEventListener("click", lockSelection);
}

function bindScoreEvents() {
  document.querySelectorAll("[data-team-score-target]").forEach((button) => button.addEventListener("click", () => {
    state.selectedScores[button.dataset.teamScoreTarget] = Number(button.dataset.teamScore);
    render();
  }));
  document.querySelector("#lockTeamScores")?.addEventListener("click", lockScores);
}

function bindChatEvents() {
  document.querySelectorAll("[data-team-reaction]").forEach((button) => button.addEventListener("click", () => sendTeamChat(button.dataset.teamReaction)));
  document.querySelectorAll("[data-all-reaction]").forEach((button) => button.addEventListener("click", () => sendAllChat(button.dataset.allReaction)));
  document.querySelector("#teamChatForm")?.addEventListener("submit", (event) => { event.preventDefault(); const input = document.querySelector("#teamChatInput"); sendTeamChat(input.value); input.value = ""; });
  document.querySelector("#teamAllChatForm")?.addEventListener("submit", (event) => { event.preventDefault(); const input = document.querySelector("#teamAllChatInput"); sendAllChat(input.value); input.value = ""; });
  scrollChats();
}

async function handleImageInput(event) {
  const files = Array.from(event.target.files || []);
  const remaining = MAX_ROUNDS - state.deck.length;
  if (!files.length || remaining <= 0) return;
  setBusy(true, "2on2用に画像を圧縮しています…");
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
  setBusy(false);
  render();
  showToast(errorMessage ? `${added}枚追加。${errorMessage}` : `${added}枚の画像を追加しました。`);
}

async function fillSampleDeck() {
  const remaining = MAX_ROUNDS - state.deck.length;
  if (remaining <= 0) return showToast("5枚すべて選択済みです。");
  setBusy(true, "2on2サンプル画像を生成しています…");
  state.deck.push(...await shared().createSampleItems(2, remaining, state.deck.length));
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
  setTeamChrome("2ON2 MATCHING");
  render();

  await Promise.allSettled([
    remove(ref(database, `online/teamActive/${state.uid}`)),
    remove(ref(database, `online/teamInvites/${state.uid}`)),
  ]);
  const queueRef = ref(database, `online/teamQueue/${state.uid}`);
  await set(queueRef, {
    uid: state.uid,
    name: state.name,
    rating: Number(state.teamProfile.rating || INITIAL_RATING),
    streak: Number(state.teamProfile.streak || 0),
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

  state.matchmakingUnsubscribers.push(onValue(ref(database, "online/teamQueue"), (snapshot) => {
    state.latestQueue = snapshot.val() || {};
    attemptToHost().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, "online/teamActive"), (snapshot) => {
    state.activeUsers = snapshot.val() || {};
    attemptToHost().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, `online/teamInvites/${state.uid}`), (snapshot) => {
    processInvites(snapshot.val() || {}).catch(handleRecoverableError);
  }, handleRecoverableError));
}

async function startPublicPresence() {
  await cleanupPublicPresence();
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  await set(ref(database, `online/publicPresenceOwners/${presenceId}`), state.uid);
  await set(ref(database, `online/publicPresence/${presenceId}`), { state: "waiting", lastSeen: Date.now() });
  const disconnect = onDisconnect(ref(database, `online/publicPresence/${presenceId}`));
  await disconnect.remove();
  state.publicPresenceId = presenceId;
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = disconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (!state.publicPresenceId) return;
    update(ref(database, `online/publicPresence/${state.publicPresenceId}`), { state: state.publicPresenceState, lastSeen: Date.now() }).catch(() => {});
  }, HEARTBEAT_MS);
}

async function updatePublicPresence(nextState) {
  if (!state.publicPresenceId) return;
  state.publicPresenceState = nextState;
  await update(ref(database, `online/publicPresence/${state.publicPresenceId}`), { state: nextState, lastSeen: Date.now() });
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
  await createTeamRoom(waiting.slice(0, PLAYER_COUNT));
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

async function createTeamRoom(group) {
  state.matchingBusy = true;
  const roomId = push(ref(database, "online/teamRooms")).key;
  try {
    const reservation = await runTransaction(ref(database, `online/teamActive/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const shuffled = shufflePlayers(group);
    const players = {};
    const members = {};
    shuffled.forEach((entry, index) => {
      const team = index < TEAM_SIZE ? "A" : "B";
      players[entry.uid] = { uid: entry.uid, name: entry.name, team, slot: (index % TEAM_SIZE) + 1, rating: Number(entry.rating || INITIAL_RATING), streak: Number(entry.streak || 0) };
      members[entry.uid] = true;
    });
    await set(ref(database, `online/teamRooms/${roomId}/hostUid`), state.uid);
    const roomUpdates = {
      createdAt: Date.now(),
      status: "forming",
    };
    Object.entries(members).forEach(([uid, value]) => { roomUpdates[`members/${uid}`] = value; });
    Object.entries(players).forEach(([uid, value]) => { roomUpdates[`players/${uid}`] = value; });
    await update(ref(database, `online/teamRooms/${roomId}`), roomUpdates);
    await set(ref(database, `online/teamRooms/${roomId}/accepted/${state.uid}`), true);
    await update(ref(database, `online/teamQueue/${state.uid}`), { state: "forming", roomId });
    await Promise.all(shuffled.filter((entry) => entry.uid !== state.uid).map((entry) => set(ref(database, `online/teamInvites/${entry.uid}/${roomId}`), {
      roomId,
      hostUid: state.uid,
      createdAt: Date.now(),
    })));
    state.pendingRoomId = roomId;
    state.room = { hostUid: state.uid, status: "forming", members, players, accepted: { [state.uid]: true } };
    state.screen = "forming";
    render();
    watchPendingRoom(roomId, true);
    state.matchTimer = window.setTimeout(() => expireTeamRoom(roomId), MATCH_TIMEOUT_MS);
  } catch (error) {
    await remove(ref(database, `online/teamActive/${state.uid}`)).catch(() => {});
    await runTransaction(ref(database, `online/teamRooms/${roomId}/status`), (current) => current === null ? "expired" : undefined).catch(() => {});
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
    const snapshot = await get(ref(database, `online/teamRooms/${roomId}`));
    const room = snapshot.val();
    if (!room || room.status !== "forming" || !room.members?.[state.uid] || invite.hostUid !== room.hostUid) {
      await remove(ref(database, `online/teamInvites/${state.uid}/${roomId}`));
      return;
    }
    const reservation = await runTransaction(ref(database, `online/teamActive/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    await set(ref(database, `online/teamRooms/${roomId}/accepted/${state.uid}`), true);
    await Promise.allSettled([
      remove(ref(database, `online/teamQueue/${state.uid}`)),
      remove(ref(database, `online/teamInvites/${state.uid}/${roomId}`)),
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
  const statusRef = ref(database, `online/teamRooms/${roomId}/status`);
  state.matchmakingUnsubscribers.push(onValue(ref(database, `online/teamRooms/${roomId}/accepted`), (snapshot) => {
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

async function expireTeamRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId || state.room?.hostUid !== state.uid) return;
  await runTransaction(ref(database, `online/teamRooms/${roomId}/status`), (current) => current === "forming" ? "expired" : undefined);
}

async function handleExpiredRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId) return;
  await Promise.allSettled([
    remove(ref(database, `online/teamActive/${state.uid}`)),
    remove(ref(database, `online/teamInvites/${state.uid}/${roomId}`)),
    remove(ref(database, `online/teamRooms/${roomId}/accepted/${state.uid}`)),
  ]);
  state.pendingRoomId = "";
  state.room = null;
  state.screen = "matching";
  await set(ref(database, `online/teamQueue/${state.uid}`), {
    uid: state.uid, name: state.name, rating: Number(state.teamProfile.rating || INITIAL_RATING), streak: Number(state.teamProfile.streak || 0), joinedAt: Date.now(), lastSeen: Date.now(), state: "waiting",
  });
  render();
}

async function enterRoom(roomId) {
  if (state.roomId) return;
  window.clearTimeout(state.matchTimer);
  const snapshot = await get(ref(database, `online/teamRooms/${roomId}`));
  const room = snapshot.val();
  if (!room || room.status !== "active" || !room.members?.[state.uid]) throw new Error("2on2ルームへ参加できませんでした。");
  state.roomId = roomId;
  state.pendingRoomId = "";
  state.room = room;
  state.members = Object.values(room.players || {}).sort((first, second) => first.team.localeCompare(second.team) || Number(first.slot) - Number(second.slot));
  if (state.members.length !== PLAYER_COUNT) throw new Error("4人のプレイヤー情報が揃っていません。");
  state.team = room.players[state.uid].team;
  state.teams = createTeams();
  await cleanupMatchmaking(true);
  await updatePublicPresence("playing");
  state.screen = "connecting";
  setTeamChrome("2ON2 BATTLE");
  render();
  await setupRoomListeners();
  await setupPeerMesh();
}

async function setupRoomListeners() {
  const base = `online/teamRooms/${state.roomId}`;
  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    state.serverTimeOffset = Number(snapshot.val() || 0);
  }));
  const activeDisconnect = onDisconnect(ref(database, `online/teamActive/${state.uid}`));
  await activeDisconnect.remove();
  state.disconnectHandles.push(activeDisconnect);
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() });
  state.disconnectHandles.push(presenceDisconnect);

  state.roomUnsubscribers.push(onValue(ref(database, `${base}/destroyed`), (snapshot) => {
    if (snapshot.exists() && snapshot.val().by !== state.uid) handleDestroyedRoom().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.members.filter((player) => player.uid !== state.uid).forEach((player) => {
    state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${player.uid}`), (snapshot) => {
      if (snapshot.exists() && snapshot.val()?.online === false && state.roomId && !state.outcome) markDisconnected(player.uid).catch(() => {});
    }));
  });

  const teamChatQuery = query(ref(database, `online/teamChats/${state.roomId}/${state.team}`), limitToLast(60));
  state.roomUnsubscribers.push(onChildAdded(teamChatQuery, (snapshot) => {
    if (state.seenTeamChatIds.has(snapshot.key)) return;
    state.seenTeamChatIds.add(snapshot.key);
    state.teamChatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.teamChatMessages.length > 60) state.teamChatMessages.shift();
    refreshChats();
  }, handleRecoverableError));
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
  if (state.destroyed || state.outcome) return;
  state.destroyed = true;
  await runTransaction(ref(database, `online/teamRooms/${state.roomId}/destroyed`), (current) => current || { by: state.uid, at: Date.now(), reason: `disconnect:${uid}` });
  await handleDestroyedRoom();
}

function listenToRound() {
  state.roundUnsubscribe?.();
  state.roundUnsubscribe = onValue(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}`), (snapshot) => {
    state.roundData = snapshot.val() || {};
    reactToRoundData().catch(handleRecoverableError);
  }, handleRecoverableError);
}

async function setupPeerMesh() {
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC画像転送に対応していません。");
  const signalsRef = ref(database, `online/teamRooms/${state.roomId}/signals/${state.uid}`);
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
      const channel = connection.peer.createDataChannel(`hariai-team-${state.uid}`, { ordered: true });
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
  const connection = { remoteUid, peer, channel: null, pendingIce: [], incoming: null };
  state.connections.set(remoteUid, connection);
  peer.onicecandidate = (event) => {
    if (event.candidate) sendSignal(remoteUid, "candidate", event.candidate.toJSON()).catch(handleRecoverableError);
  };
  peer.ondatachannel = (event) => configureChannel(remoteUid, event.channel);
  peer.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(peer.connectionState) && state.roomId && !state.outcome) markDisconnected(remoteUid).catch(() => {});
    if (state.screen === "connecting") render();
  };
}

async function sendSignal(targetUid, type, payload) {
  await set(push(ref(database, `online/teamRooms/${state.roomId}/signals/${targetUid}`)), {
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
    if (state.screen === "connecting") render();
    maybeStartRound().catch(handleRecoverableError);
  };
  channel.onclose = () => {
    if (state.roomId && !state.outcome) markDisconnected(remoteUid).catch(() => {});
  };
  channel.onerror = () => showToast("4人P2P画像転送で通信エラーが発生しました。");
  channel.onmessage = (event) => handleChannelMessage(remoteUid, event.data).catch(handleRecoverableError);
}

function openChannelCount() {
  return [...state.connections.values()].filter((connection) => connection.channel?.readyState === "open").length;
}

async function maybeStartRound() {
  if (openChannelCount() !== PLAYER_COUNT - 1 || state.roundReadyRounds.has(state.round)) return;
  state.screen = "strategy";
  render();
  await announceRoundReady();
}

async function announceRoundReady() {
  if (state.roundReadyRounds.has(state.round)) return;
  state.roundReadyRounds.add(state.round);
  await set(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}/roundReady/${state.uid}`), true);
}

async function handleChannelMessage(remoteUid, data) {
  const connection = state.connections.get(remoteUid);
  if (!connection) return;
  if (typeof data === "string") {
    const message = JSON.parse(data);
    if (message.type === "image-start") {
      connection.incoming = { round: Number(message.round), mime: message.mime || "image/webp", size: Number(message.size), chunks: [], received: 0 };
    } else if (message.type === "image-end") {
      await finishIncomingImage(remoteUid, Number(message.round));
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

async function finishIncomingImage(remoteUid, round) {
  const connection = state.connections.get(remoteUid);
  const incoming = connection?.incoming;
  if (!incoming || incoming.round !== round || incoming.received !== incoming.size) throw new Error("2on2画像の受信が完了していません。");
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
  return state.members.filter((player) => player.uid !== state.uid).every((player) => state.remoteImages.get(player.uid)?.has(round));
}

async function markImagesReadyIfComplete() {
  if (!hasAllRemoteImages() || state.imageReadyRounds.has(state.round)) return;
  state.imageReadyRounds.add(state.round);
  await set(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}/imagesReady/${state.uid}`), true);
}

async function sendSelectedImage() {
  if (state.sentImageRounds.has(state.round)) return;
  const item = getRoundImage(state.uid);
  if (!item?.blob) throw new Error("送信する画像を取得できませんでした。");
  state.sentImageRounds.add(state.round);
  state.screen = "waitingImages";
  render();
  try {
    const buffer = await item.blob.arrayBuffer();
    for (const connection of state.connections.values()) {
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
  const memberIds = state.members.map((player) => player.uid);
  const allReady = (collection) => memberIds.every((uid) => collection?.[uid]);
  if (state.room?.hostUid === state.uid && allReady(state.roundData.roundReady) && !state.roundData.strategyStartedAt) {
    await runTransaction(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}/strategyStartedAt`), (current) => current === null ? now() : undefined);
    return;
  }
  if (Number(state.roundData.strategyStartedAt)) startPhaseTimer();
  if (allReady(state.roundData.picks) && !state.sentImageRounds.has(state.round)) {
    await sendSelectedImage();
    return;
  }
  if (state.room?.hostUid === state.uid && allReady(state.roundData.imagesReady) && !state.roundData.scoringStartedAt) {
    await runTransaction(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}/scoringStartedAt`), (current) => current === null ? now() : undefined);
    return;
  }
  if (Number(state.roundData.scoringStartedAt)) startScoreTimer();
  if (allReady(state.roundData.imagesReady) && hasAllRemoteImages() && !["reveal", "score", "waitingScore", "result", "waitingContinue", "gameover"].includes(state.screen)) {
    stopPhaseTimer();
    state.screen = "reveal";
    render();
  }
  if (allReady(state.roundData.scores)) {
    stopScoreTimer();
    resolveRound(state.roundData.scores);
  }
  if (allReady(state.roundData.continue)) advanceRound();
}

function startPhaseTimer() {
  if (state.timerInterval) return;
  updatePhaseTimer();
  state.timerInterval = window.setInterval(updatePhaseTimer, 200);
}

function updatePhaseTimer() {
  const startedAt = Number(state.roundData.strategyStartedAt || 0);
  if (!startedAt) return;
  const elapsed = now() - startedAt;
  if (elapsed < STRATEGY_TIME_MS) {
    state.timerPhase = "strategy";
    state.timerRemainingMs = STRATEGY_TIME_MS - elapsed;
  } else if (elapsed < STRATEGY_TIME_MS + SELECTION_TIME_MS) {
    state.timerPhase = "selection";
    state.timerRemainingMs = STRATEGY_TIME_MS + SELECTION_TIME_MS - elapsed;
    if (state.screen === "strategy") {
      state.screen = "select";
      render();
    }
  } else {
    state.timerPhase = "expired";
    state.timerRemainingMs = 0;
    if (state.screen === "select" && !state.selectionLocking) autoLockSelection().catch(handleRecoverableError);
  }
  const timer = document.querySelector("[data-team-timer]");
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
  document.querySelectorAll("[data-team-score-timer]").forEach((timer) => { timer.textContent = String(remaining); });
  if (remaining > 0 || state.scoredRounds.has(state.round) || state.scoreLocking) return;
  const opponents = teamMembers(opponentTeam());
  let filled = false;
  opponents.forEach((player) => {
    if (!Number.isInteger(state.selectedScores[player.uid])) {
      state.selectedScores[player.uid] = 5;
      filled = true;
    }
  });
  if (filled) showToast("採点時間切れのため、未採点の画像は5点になりました。");
  lockScores().catch(handleRecoverableError);
}

function stopScoreTimer() {
  window.clearInterval(state.scoreTimerInterval);
  state.scoreTimerInterval = null;
}

async function lockSelection() {
  if (state.selectionLocking || state.roundSelections.has(state.round)) return;
  const available = state.deck.filter((item) => !item.used);
  const selected = available.find((item) => item.id === state.selectedCardId);
  if (!selected) return;
  state.selectionLocking = true;
  state.roundSelections.set(state.round, selected.id);
  state.screen = "waitingPick";
  render();
  try {
    await set(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}/picks/${state.uid}`), {
      ready: true,
      lockedAt: serverTimestamp(),
    });
  } catch (error) {
    state.roundSelections.delete(state.round);
    state.screen = "select";
    render();
    throw error;
  } finally {
    state.selectionLocking = false;
  }
}

async function autoLockSelection() {
  if (state.selectionLocking || state.roundSelections.has(state.round)) return;
  const available = state.deck.filter((item) => !item.used);
  if (!available.length) throw new Error("未使用画像がありません。");
  const selected = available.find((item) => item.id === state.selectedCardId)
    || available[Math.floor(Math.random() * available.length)];
  state.selectedCardId = selected.id;
  window.HariaiAudio?.playCountdown?.(0);
  showToast("選択時間切れのため、未使用画像を自動ロックしました。");
  await lockSelection();
}

async function lockScores() {
  if (state.scoreLocking || state.scoredRounds.has(state.round)) return;
  const opponents = teamMembers(opponentTeam());
  const values = {};
  for (const player of opponents) {
    const score = Number(state.selectedScores[player.uid]);
    if (!Number.isInteger(score) || score < 1 || score > 10) return;
    values[player.uid] = score;
  }
  state.scoreLocking = true;
  state.scoredRounds.add(state.round);
  stopScoreTimer();
  state.screen = "waitingScore";
  render();
  try {
    await set(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}/scores/${state.uid}`), {
      values,
      lockedAt: serverTimestamp(),
    });
    await recordDailyProgress({
      scores: opponents.length,
      criticals: Object.values(values).some((score) => score >= 8) ? 1 : 0,
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

function resolveRound(scores) {
  if (state.processedRounds.has(state.round)) return;
  const images = {};
  for (const player of state.members) {
    const voters = state.members.filter((candidate) => candidate.team !== player.team);
    const votes = voters.map((voter) => Number(scores[voter.uid]?.values?.[player.uid]));
    if (votes.length !== TEAM_SIZE || votes.some((score) => !Number.isInteger(score) || score < 1 || score > 10)) return;
    const average = votes.reduce((sum, score) => sum + score, 0) / votes.length;
    images[player.uid] = {
      uid: player.uid,
      team: player.team,
      votes,
      average,
      critical: average >= 8,
      perfect: votes.every((score) => score === 10),
    };
  }

  state.processedRounds.add(state.round);
  const teamScores = {};
  ["A", "B"].forEach((team) => {
    const teamImages = teamMembers(team).map((player) => images[player.uid]);
    teamScores[team] = teamImages.reduce((sum, image) => sum + image.average, 0) / teamImages.length;
    state.teams[team].totalScore += teamScores[team];
    state.teams[team].criticals += teamImages.filter((image) => image.critical).length;
    state.teams[team].perfects += teamImages.filter((image) => image.perfect).length;
  });
  const localItem = getRoundImage(state.uid);
  if (localItem) localItem.used = true;

  let winnerTeam = null;
  let loserTeam = null;
  let damage = 0;
  if (teamScores.A > teamScores.B) {
    winnerTeam = "A";
    loserTeam = "B";
  } else if (teamScores.B > teamScores.A) {
    winnerTeam = "B";
    loserTeam = "A";
  }
  if (winnerTeam) {
    damage = Math.round(teamScores[winnerTeam]);
    state.teams[loserTeam].hp = Math.max(0, state.teams[loserTeam].hp - damage);
  }
  const result = { round: state.round, images, teamScores, winnerTeam, loserTeam, damage };
  state.history.push(result);
  state.screen = "result";
  render();

  const allImages = Object.values(images);
  if (allImages.some((image) => image.perfect)) {
    window.HariaiAudio?.playResult?.(10);
    triggerCriticalFx("PERFECT!!");
  } else if (allImages.some((image) => image.critical)) {
    window.HariaiAudio?.playResult?.(8);
    triggerCriticalFx("CRITICAL!");
  }
}

async function continueRound() {
  if (state.continuedRounds.has(state.round)) return;
  state.screen = "waitingContinue";
  render();
  await set(ref(database, `online/teamRooms/${state.roomId}/rounds/${state.round}/continue/${state.uid}`), true);
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
  state.timerPhase = "waiting";
  state.timerRemainingMs = 0;
  state.screen = "strategy";
  listenToRound();
  render();
  announceRoundReady().catch(handleRecoverableError);
}

function isMatchOver() {
  return state.teams.A.hp <= 0 || state.teams.B.hp <= 0 || state.round >= MAX_ROUNDS;
}

function determineOutcome() {
  const first = state.teams.A;
  const second = state.teams.B;
  if (first.hp !== second.hp) return { winnerTeam: first.hp > second.hp ? "A" : "B", reason: "hp" };
  if (first.totalScore !== second.totalScore) return { winnerTeam: first.totalScore > second.totalScore ? "A" : "B", reason: "score" };
  if (first.criticals !== second.criticals) return { winnerTeam: first.criticals > second.criticals ? "A" : "B", reason: "critical" };
  if (first.perfects !== second.perfects) return { winnerTeam: first.perfects > second.perfects ? "A" : "B", reason: "perfect" };
  return { winnerTeam: null, reason: "draw" };
}

async function finishMatch() {
  if (state.outcome) return;
  state.outcome = determineOutcome();
  await Promise.all([
    commitTeamStats(),
    recordDailyProgress({ matches: 1 }).catch(() => showToast("ミッション進捗を更新できませんでした。")),
    set(ref(database, `online/teamRooms/${state.roomId}/finished/${state.uid}`), true),
  ]);
  state.screen = "gameover";
  setTeamChrome("2ON2 COMPLETE");
  render();
}

function calculateRating(currentRating, opponentRating, actualScore) {
  const expectedScore = 1 / (1 + (10 ** ((opponentRating - currentRating) / 400)));
  return Math.min(3000, Math.max(100, Math.round(currentRating + RATING_K_FACTOR * (actualScore - expectedScore))));
}

async function commitTeamStats() {
  if (state.statsCommitted) return;
  state.statsCommitted = true;
  const draw = state.outcome.winnerTeam === null;
  const won = state.outcome.winnerTeam === state.team;
  const opponentPlayers = teamMembers(opponentTeam());
  const opponentRating = opponentPlayers.reduce((sum, player) => sum + Number(player.rating || INITIAL_RATING), 0) / opponentPlayers.length;
  const actualScore = draw ? 0.5 : won ? 1 : 0;
  const result = await runTransaction(ref(database, `online/teamProfiles/${state.uid}`), (current) => {
    const record = {
      name: state.name,
      wins: Number(current?.wins || 0),
      losses: Number(current?.losses || 0),
      draws: Number(current?.draws || 0),
      streak: Number(current?.streak || 0),
      bestStreak: Number(current?.bestStreak || 0),
      rating: Number(current?.rating || INITIAL_RATING),
      updatedAt: now(),
    };
    if (draw) record.draws += 1;
    else if (won) {
      record.wins += 1;
      record.streak += 1;
      record.bestStreak = Math.max(record.bestStreak, record.streak);
    } else {
      record.losses += 1;
      record.streak = 0;
    }
    record.rating = calculateRating(record.rating, opponentRating, actualScore);
    return record;
  });
  if (result.committed) state.teamProfile = result.snapshot.val();
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

async function sendTeamChat(value) {
  const text = String(value || "").trim().slice(0, 80);
  if (!text || !state.roomId || !state.team) return;
  await set(push(ref(database, `online/teamChats/${state.roomId}/${state.team}`)), {
    authorUid: state.uid,
    name: state.name,
    text,
    round: state.round,
    createdAt: serverTimestamp(),
  }).catch(() => showToast("チームチャットを送信できませんでした。"));
}

async function sendAllChat(value) {
  const text = String(value || "").trim().slice(0, 80);
  if (!text || !state.roomId) return;
  await set(push(ref(database, `online/teamRooms/${state.roomId}/chat`)), {
    authorUid: state.uid,
    name: state.name,
    text,
    round: state.round,
    createdAt: serverTimestamp(),
  }).catch(() => showToast("4人チャットを送信できませんでした。"));
}

function refreshChats() {
  const teamList = document.querySelector("#teamChatMessages");
  if (teamList) teamList.innerHTML = renderMessages(state.teamChatMessages, "相方と画像の方向性を相談しましょう。");
  const allList = document.querySelector("#teamAllChatMessages");
  if (allList) allList.innerHTML = renderMessages(state.allChatMessages, "公開された画像について4人で話してみましょう。");
  scrollChats();
}

function scrollChats() {
  ["#teamChatMessages", "#teamAllChatMessages"].forEach((selector) => {
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
  else destroyDialog.showModal();
}

async function destroyRoom() {
  if (!active) return;
  const targetRoomId = state.roomId || state.pendingRoomId;
  if (targetRoomId) {
    await runTransaction(ref(database, `online/teamRooms/${targetRoomId}/destroyed`), (current) => current || {
      by: state.uid,
      at: Date.now(),
      reason: "user",
    }).catch(() => {});
    if (!state.roomId && state.room?.hostUid === state.uid) {
      await runTransaction(ref(database, `online/teamRooms/${targetRoomId}/status`), (current) => current === "forming" ? "expired" : undefined).catch(() => {});
    }
  }
  await cleanupRoomResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
  showToast("2on2ルームを破棄しました。戦績には影響しません。");
}

async function handleDestroyedRoom() {
  if (state.screen === "noContest") return;
  state.destroyed = true;
  await cleanupRoomResources(false);
  releaseAllImages();
  state.screen = "noContest";
  setTeamChrome("NO CONTEST");
  render();
}

async function cancelMatching() {
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  state.screen = "setup";
  setTeamChrome("2ON2 READY");
  render();
}

async function resetSetup() {
  const identity = {
    uid: state.uid,
    name: state.name,
    authReady: state.authReady,
    profile: state.profile,
    teamProfile: state.teamProfile,
    economy: state.economy,
    serverTimeOffset: state.serverTimeOffset,
  };
  await cleanupRoomResources(false);
  releaseAllImages();
  state = createState();
  Object.assign(state, identity);
  state.screen = "setup";
  setTeamChrome("2ON2 READY");
  render();
}

async function retryConnection() {
  const savedName = state.name;
  await cleanupRoomResources(false);
  releaseAllImages();
  state = createState();
  state.name = savedName;
  state.screen = "setup";
  setTeamChrome("CONNECTING");
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
    remove(ref(database, `online/teamQueue/${state.uid}`)),
    remove(ref(database, `online/teamInvites/${state.uid}`)),
  ];
  if (!keepActive) removals.push(remove(ref(database, `online/teamActive/${state.uid}`)));
  if (!keepActive && state.pendingRoomId) removals.push(remove(ref(database, `online/teamRooms/${state.pendingRoomId}/accepted/${state.uid}`)));
  if (state.room?.hostUid === state.uid && state.pendingRoomId) {
    Object.keys(state.room.members || {}).forEach((uid) => {
      if (uid !== state.uid) removals.push(remove(ref(database, `online/teamInvites/${uid}/${state.pendingRoomId}`)));
    });
  }
  await Promise.allSettled(removals);
}

async function cleanupRoomResources(keepActive) {
  stopPhaseTimer();
  stopScoreTimer();
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
      set(ref(database, `online/teamRooms/${state.roomId}/presence/${state.uid}`), { online: false, updatedAt: serverTimestamp() }),
      keepActive ? Promise.resolve() : remove(ref(database, `online/teamActive/${state.uid}`)),
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
  state.teamChatMessages = [];
  state.allChatMessages = [];
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "2on2通信処理に失敗しました。");
}

function handleFatalError(error) {
  console.error(error);
  state.errorMessage = friendlyFirebaseError(error);
  state.screen = "error";
  setTeamChrome("CONNECTION ERROR");
  render();
}

function friendlyFirebaseError(error) {
  if (error?.code === "auth/admin-restricted-operation") return "Firebaseの匿名ログインが無効です。Authentication設定を確認してください。";
  if (error?.code === "PERMISSION_DENIED" || String(error?.message).includes("PERMISSION_DENIED")) return "Realtime Databaseの2on2用セキュリティルールにより接続が拒否されました。";
  return error?.message || "Firebaseへ接続できませんでした。";
}

window.addEventListener("beforeunload", () => {
  releaseAllImages();
  state.connections.forEach((connection) => connection.peer.close());
});

window.HariaiTeam = { start, isActive, requestHome, destroyRoom };
window.dispatchEvent(new Event("hariai-team-ready"));
