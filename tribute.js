import { ensureHariaiUser } from "./auth-session.js?v=auth-session-v1-lazy-loading-v1-mobile-loading-v1";
import {
  httpsCallable,
} from "./assets/firebase/firebase-functions-TFNFZUKR.js";
import {
  collection,
  doc,
  endBefore,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  startAt,
} from "./assets/firebase/firebase-firestore-QNR56A4P.js";
import {
  auth,
  firestore,
  functions,
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1-lazy-loading-v1-mobile-loading-v1";
import { renderBlockButton } from "./player-safety.js?v=global-player-block-v1-copy-v2-auth-session-v1-lazy-loading-v1-mobile-loading-v1";
import {
  AVATAR_GROUPS,
  AVATARS,
  BOARD_SEXUAL_PATTERN,
  CHEER,
  CONTEST_DAYS,
  CONTEST_PENALTIES,
  CONTEST_TARGETS,
  DEFAULT_SEALS,
  DEFINITION,
  DISCLOSURE_LABELS,
  DISCLOSURE_SHORT,
  DURATION_DAYS_OPTIONS,
  END_REASON_LABELS,
  ENTRY_FEE_OPTIONS,
  GROSS_RANKING,
  LIMITS,
  PER_DAY_OPTIONS,
  PER_TRIBUTE_OPTIONS,
  PREMISES,
  MANAGER_STYLES,
  MAX_MANAGER_STYLES,
  MAX_SEALS,
  OTHELLO_HANDICAPS,
  OTHELLO_RATES,
  OTHELLO_SITUATIONS,
  PURPOSES,
  RECEIVABLE_KINDS,
  RECITE_TARGETS,
  RANCH_ACHIEVEMENT_FAMILIES,
  RANCH_ACHIEVEMENT_SECRETS,
  RANCH_ANIMALS,
  RANCH_ANIMAL_LABELS,
  RANCH_FACILITIES,
  RANCH_FONDNESS,
  RANCH_LAYOUT,
  RANCH_ART_LEVELS,
  RANCH_MOO,
  RANCH_NAME,
  REWARD_WORD,
  SEAL_WORD_PREFIX,
  REPORT_REASON_LABELS,
  SEALS,
  SEXUAL_PURPOSE_SUMMARY,
  SIGIL_COLORS,
  STYLE_LABELS,
  TONE_CEILING_LABELS,
  TONE_LABELS,
  INVITE_QUERY_KEY,
  RANCH_OPEN_QUERY,
  RANKING_WORD,
  TODAY_WORD,
  TOTAL_OPTIONS,
  TRIAL_DURATION_DAYS,
  TRIBUTE_AGE_VERSION,
  VAULT_QUALIFY,
  VAULT_TIERS,
  WORK_ORDER_TARGETS,
  capViolation,
  cheerProblem,
  mooProblem,
  ranchNameProblem,
  ranchTitle,
  X_EXTERNAL_CONFIRM_MESSAGE,
  X_HANDLE_PATTERN,
  avatarId,
  avatarUrl,
  contestExpired,
  contractTodos,
  forbiddenReason,
  formatPay,
  ignoreLabel,
  inviteFromUrl,
  inviteText,
  inviteUrl,
  jstDateKey,
  contractTextProblem,
  messageProblem,
  nextTodoContract,
  normalizeCaps,
  normalizeOwnWords,
  normalizeWantWords,
  ownWordUsable,
  reciteKey,
  sealWordId,
  sealWordProblem,
  wordOfferingProblem,
  normalizeStyles,
  othelloCount,
  othelloInitialBoard,
  othelloLinesFor,
  othelloMoves,
  othelloNextTurn,
  othelloOutcome,
  othelloPlay,
  othelloSide,
  requestNotesFor,
  styleTemplatesFor,
  stylesLabel,
  normalizeXProfile,
  purposeLabel,
  ranchAnimalMood,
  ranchDiary,
  ranchAchievementTier,
  ranchFondness,
  ranchLevelFor,
  ranchProgress,
  ranchSnapshot,
  ranchSpot,
  ranchTimeOfDay,
  ranchWeather,
  purposesFor,
  ranchOpenUrl,
  rankingWordProblem,
  remainingLabel,
  resistedLabel,
  rewardText,
  rewardsFor,
  sealLabel,
  wantsRanchOpen,
  sealsFor,
  sheetLinesFor,
  templatesFor,
  textLength,
  todayWordProblem,
  tonesUpTo,
  trialCaps,
  tributeFee,
  tributeKindLabel,
  vaultTierFor,
  vaultTierInfo,
  viewContract,
  wordAgeLabel,
  wordRemainingLabel,
  workOrderNotesFor,
} from "./tribute-core.mjs?v=tribute-ranch-v1-ranch-avatar-v1-ranch-gohoubi-v1-ranch-collar-v1-ranch-word-v1-ranch-invite-v1-ranch-wallet-v1-ranch-kidoku-v1-ranch-board-fresh-v1-ranch-photo-icons-v1-ranch-vault-v1-ranch-illustration-icons-v1-ranch-nav-v1-ranch-free-talk-v1-ranch-screenshot-v1-ranch-thread-ux-v1-ranch-work-orders-v1-ranch-cheers-v1-ranch-wallet-words-v1-ranch-hold-v1-ranch-premium-icons-v1-ranch-recite-v1-ranch-safari-regex-v1-ranch-styles-v1-ranch-style-words-v1-ranch-othello-v1-ranch-contest-v1-ranch-pasture-v1-ranch-growth-v1-ranch-peek-v1-ranch-pat-v1-ranch-photo-v1-ranch-achievements-v1-ranch-premium-icons-v2";
// 写真・受付カード・レシートの描画器は、画像を作る時だけ読み込む。
let shareRendererRequest;
function loadShareRenderer() {
  if (shareRendererRequest) return shareRendererRequest;
  const fonts = window.HariaiFeatures?.load("display-fonts");
  const fontReady = fonts ? new Promise((resolve) => {
    const timer = setTimeout(resolve, 1800);
    fonts.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
  }) : Promise.resolve();
  return shareRendererRequest ||= Promise.all([
    fontReady,
    import("./tribute-share.mjs?v=ranch-vault-v1-ranch-screenshot-v1-ranch-wallet-words-v1-ranch-premium-icons-v1-ranch-report-marks-v1-ranch-othello-v1-ranch-reception-card-v1-ranch-photo-v1-ranch-premium-icons-v2"),
  ]).then(([, module]) => module)
    .catch((error) => { shareRendererRequest = null; throw error; });
}
const SHARE_TEXT = "#貢ぎ報告 #お貢ぎ牧場";
const RANCH_PHOTO_TEXT = "#お貢ぎ牧場 #わたしの牧場";
const canvasToPngBlob = (...args) => loadShareRenderer().then((module) => module.canvasToPngBlob(...args));
const renderExcerptImage = (...args) => loadShareRenderer().then((module) => module.renderExcerptImage(...args));
const renderOthelloImage = (...args) => loadShareRenderer().then((module) => module.renderOthelloImage(...args));
const renderReceiptImage = (...args) => loadShareRenderer().then((module) => module.renderReceiptImage(...args));
const renderRecruitImage = (...args) => loadShareRenderer().then((module) => module.renderRecruitImage(...args));
const renderRanchPhotoImage = (...args) => loadShareRenderer().then((module) => module.renderRanchPhotoImage(...args));
import {
  CARD_FRAMES,
  FRAME_PALETTES,
  PREMIUM_AVATARS,
  SEAL_INKS,
  SEAL_SHAPES,
  VAULT_DECORATION_ITEMS,
  decorationChoice,
  frameAttr,
  isPremiumAvatar,
  normalizeDecorations,
  premiumAvatar,
  requiredDecorationProducts,
  sealSvg,
} from "./tribute-deco.mjs?v=ranch-vault-v1-ranch-premium-icons-v1-ranch-premium-icons-v2";

const appRoot = document.querySelector("#app");
// 確認シートとレシートは画面の外側に置く。画面要素の入場アニメーションが transform を使うため、
// その中の position: fixed はビューポートではなく画面要素に固定されてしまう。
const layer = document.createElement("div");
layer.className = "tribute-layer";
document.body.appendChild(layer);
const tributeActionCallable = httpsCallable(functions, "tributeAction");
const economyActionCallable = httpsCallable(functions, "economyAction");
const HOLD_MS = 1_200;
const EVENTS_LIMIT = 100;
const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SCREENS = new Set(["age", "hub", "board", "manager", "apply", "card", "thread", "receipts", "ledger", "ranking", "vault", "error", "loading"]);
const NAV_ITEMS = Object.freeze([
  Object.freeze({ screen: "hub", label: "契約" }),
  Object.freeze({ screen: "board", label: "掲示板" }),
  Object.freeze({ screen: "ledger", label: "貢ぎ帳" }),
  Object.freeze({ screen: "ranking", label: "番付" }),
  Object.freeze({ screen: "vault", label: "金庫" }),
]);
// 牧場基金は2026年10月に終わり、金庫に変わった（古い入口から来た時は金庫を開く）。
const SCREEN_ALIASES = Object.freeze({ fund: "vault" });

const previewScreen = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("tributePreview") || !PREVIEW_HOSTS.has(window.location.hostname)) return "";
    return params.get("tributePreview") || "hub";
  } catch {
    return "";
  }
})();

let active = false;
let lifecycleGeneration = 0;
let state = createState();
let contractUnsubscribe = null;
// 財布の限度額（private/limits）。財布として開いた契約だけ購読する。
let limitsUnsubscribe = null;
let eventsUnsubscribe = null;
let walletUnsubscribe = null;
let markReadTimer = null;
let tickTimer = null;
let hold = null;
let stateRequest = null;
let threadGeneration = 0;
let markReadProgress = new Map();

function createState() {
  return {
    screen: "loading",
    uid: "",
    fatalError: "",
    fatalReloadRequired: false,
    ageConfirmed: false,
    profile: null,
    contracts: [],
    ended: { more: false, cursor: null, loading: false },
    readRequests: new Map(),
    achievements: null,
    walletBalance: null,
    board: { status: "idle", managers: [], nekamaOnly: false, feeZeroOnly: false, style: "" },
    manager: { status: "idle", publicManagerId: "", data: null },
    applyTarget: null,
    // 終わった契約の「同じ条件で申し込む」で写す設定（その管理人の申し込みでだけ使う）。
    applyPrefill: null,
    thread: { contractId: "", raw: null, view: null, events: [], status: "idle" },
    receipts: { status: "idle", items: [], more: false, cursor: null, loadingMore: false },
    ledger: { status: "idle", asPayer: [], asManager: [] },
    // kind: 番付加算（score）か貢がれ総額（gross）か。画面を移っても選んだ方を覚えておく。
    ranking: { status: "idle", managers: [], monthKey: "", kind: "score" },
    // わたしの牧場（設計書16）: 押した動物と、この画面を開いた時に作った日報。
    ranch: { selected: "", diary: null, heart: null, naming: false },
    vault: { status: "idle", data: null, pendingMove: null, moveError: "" },
    // 管理人カードの編集で使う、持っている飾り・解除済みの実績・金庫のいちばん高い段階（編集を開いた時に読む）。
    decorations: { status: "idle", owned: [], achievements: [], vaultBestTier: 0 },
    sheet: null,
    receipt: null,
    busy: "",
  };
}

// ───────────── 共通 ─────────────

function shared() {
  return window.HariaiApp?.shared || null;
}

function escapeHtml(value) {
  const sharedEscape = shared()?.escapeHtml;
  if (typeof sharedEscape === "function") return sharedEscape(value);
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = shared()?.showToast;
  if (typeof toast === "function") toast(message);
  else window.alert(message);
}

function needsPageReload(error) {
  const code = String(error?.code || "").toLowerCase();
  return code.includes("unauthenticated") || code.includes("app-check") || code.startsWith("appcheck/")
    || code.includes("permission-denied") && /App Check/i.test(String(error?.message));
}

function friendlyError(error, fallback = "お貢ぎ牧場の処理を完了できませんでした。") {
  const code = String(error?.code || "").toLowerCase();
  if (needsPageReload(error)) {
    const reason = code.includes("unauthenticated")
      ? "ログイン状態または通信保護を確認できませんでした。"
      : "通信保護を確認できませんでした。";
    return `${reason}サイトデータやCookieを削除せず、ページ全体を再読み込みしてください。繰り返す場合は、利用URLと発生時刻を添えてお問い合わせください。`;
  }
  const message = String(error?.message || "").replace(/^Firebase:\s*/u, "").slice(0, 200);
  if (message && !/^internal$/iu.test(message)) return message;
  return fallback;
}

function createRequestId() {
  const cryptoApi = window.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return `tr_${cryptoApi.randomUUID().replaceAll("-", "")}`;
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return `tr_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function storedVaultMove(value) {
  if (!state.uid || previewScreen) return null;
  try {
    const key = `tribute-vault-move:${state.uid}`;
    if (value === null) window.sessionStorage.removeItem(key);
    else if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else {
      const pending = JSON.parse(window.sessionStorage.getItem(key) || "null");
      if (pending && ["deposit", "withdraw"].includes(pending.direction) && Number.isSafeInteger(pending.amount) && pending.amount > 0 && /^[A-Za-z0-9_-]{12,80}$/.test(pending.clientRequestId)) return pending;
    }
  } catch { /* Storage may be unavailable; the in-memory operation still survives navigation. */ }
  return null;
}

function isCurrent(generation) {
  return active && lifecycleGeneration === generation;
}

async function ensureUser() {
  return ensureHariaiUser();
}

async function call(action, payload = {}) {
  if (previewScreen || payload?.contractId === DEMO_CONTRACT_ID) return previewCall(action, payload);
  const response = await tributeActionCallable({ action, ...payload });
  return response.data || {};
}

// 完了した結果はキャッシュせず、同じ利用者の実行中の読み取りだけを共有する。
function readOnce(action, payload = {}) {
  const target = state;
  const uid = target.uid;
  const generation = lifecycleGeneration;
  if (!previewScreen && auth.currentUser?.uid !== uid) return Promise.reject(new Error("アカウントを確認できませんでした。"));
  const key = JSON.stringify([uid, action, payload]);
  const pending = target.readRequests.get(key);
  if (pending) return pending;
  const request = call(action, payload).then((result) => {
    if (!isCurrent(generation) || state !== target || target.readRequests.get(key) !== request
      || (!previewScreen && auth.currentUser?.uid !== uid)) return null;
    return result;
  }).finally(() => {
    if (target.readRequests.get(key) === request) target.readRequests.delete(key);
  });
  target.readRequests.set(key, request);
  return request;
}

function formatDateTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function sigilColor(card) {
  return SIGIL_COLORS[Number(card?.sigil) || 0] || SIGIL_COLORS[0];
}

// 管理人の印。アイコンを選んでいればその絵を印の色の縁で囲み、選んでいなければペルソナ名の1文字を出す。
// 有料アイコンは丸く切らず、四角に金の縁で出す。
function sigil(card, size = "") {
  const name = String(card?.personaName || "管").trim();
  const avatar = avatarId(card?.avatar);
  if (avatar) {
    return `<span class="tribute-sigil has-avatar${isPremiumAvatar(avatar) ? " is-premium" : ""} ${size}" style="--sigil:${sigilColor(card)}" aria-hidden="true"><img src="${escapeHtml(avatarUrl(avatar))}" alt="" width="112" height="112" decoding="async" draggable="false" /></span>`;
  }
  return `<span class="tribute-sigil ${size}" style="--sigil:${sigilColor(card)}" aria-hidden="true">${escapeHtml(Array.from(name)[0] || "管")}</span>`;
}

function disclosureTag(disclosure) {
  const key = DISCLOSURE_SHORT[disclosure] ? disclosure : "undisclosed";
  return `<span class="tribute-tag is-${key}" title="${escapeHtml(DISCLOSURE_LABELS[key])}">${escapeHtml(DISCLOSURE_SHORT[key])}</span>`;
}

// 金庫の段階（外に見せるのは段階だけ）。
// 牧場レベルの札（設計書16.3）。関係の積み重ねで上がり、Pay の額では上がらない。
function ranchTag(card) {
  const level = Number(card?.ranchLevel) || 0;
  // 牧場の名前があれば「○○牧場 Lv.N」（設計書16.15）。
  const name = String(card?.ranchName || "").trim();
  return level > 0 ? `<span class="tribute-tag is-ranch" title="牧場レベル：財布との関係の積み重ねで上がります"><i aria-hidden="true">牧</i>${name ? `<b>${escapeHtml(ranchTitle(name))}</b> ` : ""}Lv.${level}</span>` : "";
}

function vaultTag(vault) {
  const tier = vaultTierInfo(vault?.level);
  return tier ? `<span class="tribute-tag is-vault is-vault-${escapeHtml(tier.id)}" title="金庫の段階：${escapeHtml(tier.label)}"><i aria-hidden="true">庫</i>${escapeHtml(tier.label)}</span>` : "";
}

function cardXHandle(card) {
  const handle = String(card?.xHandle || "");
  return X_HANDLE_PATTERN.test(handle) ? handle : "";
}

// Xのリンクは本人確認のない外部サイトなので、ボタンにして確認を挟んでから開く。
function xProfileButton(card) {
  const handle = cardXHandle(card);
  if (!handle) return "";
  const label = `管理人が自己申告したXプロフィール @${handle} を新しいタブで開く（外部サイト）`;
  return `<span class="tribute-x-link"><button type="button" data-t="open-x" data-handle="${escapeHtml(handle)}" aria-label="${escapeHtml(label)}"><b aria-hidden="true">X</b><span>@${escapeHtml(handle)}</span><i aria-hidden="true">↗</i></button><small>管理人の自己申告・本人未確認</small></span>`;
}

function optionList(options, selected, format = (value) => formatPay(value)) {
  return options.map((value) => `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${escapeHtml(format(value))}</option>`).join("");
}

function setChrome(statusLabel = "OMITSUGI RANCH") {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(statusLabel)}`;
  if (privacy) privacy.textContent = "会わない・換金できない・AnjuPayだけ";
  if (footerItems[0]) footerItems[0].textContent = "OMITSUGI RANCH / ANJUPAY ONLY";
  if (footerItems[1]) footerItems[1].textContent = "現金・外部決済・換金はありません";
}

// ───────────── 画面 ─────────────

function frame(content, { title = "お貢ぎ牧場", screenClass = "" } = {}) {
  const nav = state.ageConfirmed
    ? `<nav class="tribute-nav" aria-label="お貢ぎ牧場の移動">
        ${NAV_ITEMS.map((item) => `<button type="button" data-t="nav" data-screen="${item.screen}" aria-current="${state.screen === item.screen ? "page" : "false"}">${escapeHtml(item.label)}${item.screen === "hub" && unreadTotal() ? `<b class="tribute-badge">${unreadTotal()}</b>` : ""}</button>`).join("")}
        <button type="button" data-t="home">トップへ</button>
      </nav>`
    : `<nav class="tribute-nav"><button type="button" data-t="home">トップへ</button></nav>`;
  return `<section class="screen tribute-screen ${screenClass}" aria-busy="${state.busy ? "true" : "false"}">
    <header class="tribute-header">
      <div class="tribute-brand"><span class="tribute-brand-mark" aria-hidden="true">貢</span><div><small>OMITSUGI RANCH${previewScreen ? " / PREVIEW" : ""}</small><strong>${escapeHtml(title)}</strong></div></div>
      ${state.walletBalance !== null && state.ageConfirmed ? `<span class="tribute-wallet-chip">財布 <b data-tribute-wallet>${escapeHtml(formatPay(state.walletBalance))}</b></span>` : ""}
      ${nav}
    </header>
    ${content}
  </section>`;
}

function unreadTotal() {
  return state.contracts.reduce((sum, contract) => sum + (contract.status !== "ended" ? contract.unread : 0), 0);
}

function renderLoading() {
  return `<section class="screen tribute-screen tribute-loading" aria-busy="true"><span class="tribute-brand-mark is-large" aria-hidden="true">貢</span><p>お貢ぎ牧場を開いています…</p></section>`;
}

function renderError() {
  return frame(`<div class="tribute-panel tribute-error" role="alert"><h2>開けませんでした</h2><p>${escapeHtml(state.fatalError || "通信状態を確かめて、もう一度お試しください。")}</p>
    <div class="tribute-row"><button class="button button-primary" type="button" data-t="${state.fatalReloadRequired ? "reload-page" : "retry"}">${state.fatalReloadRequired ? "ページ全体を再読み込み" : "もう一度読み込む"}</button></div></div>`);
}

function renderAge() {
  return frame(`<div class="tribute-age">
    <p class="tribute-eyebrow">入場前の確認</p>
    <h1>お貢ぎ牧場</h1>
    <blockquote class="tribute-definition">${escapeHtml(DEFINITION)}</blockquote>
    <ul class="tribute-premises">${PREMISES.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
    <form class="tribute-panel tribute-age-form" data-form="age">
      <label class="tribute-check"><input type="checkbox" name="adult" required /> <span>18歳以上です</span></label>
      <label class="tribute-check"><input type="checkbox" name="premise" required /> <span>上の前提を理解し、辛口の表現を含む遊びに同意します</span></label>
      <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>入場する</button>
      <small>確認は自己申告です。いつでもトップへ戻れます。</small>
    </form>
  </div>`, { title: "入場の確認", screenClass: "tribute-age-screen" });
}

function contractCounterpart(contract) {
  if (contract.role === "payer") return { name: contract.manager.personaName, card: contract.manager };
  const name = managerNickname(contract) || contract.payer.walletName;
  return { name, card: { personaName: name, sigil: 5 } };
}

// 管理人が付けた呼び名（管理人にだけ見える）。スレッドの契約は Firestore から直接読むので、一覧の行から引く。
function managerNickname(contract) {
  if (contract?.role !== "manager") return "";
  const own = typeof contract.nickname === "string" ? contract.nickname : state.contracts.find((row) => row.contractId === contract.contractId)?.nickname;
  return String(own || "");
}

function statusChip(contract) {
  if (contract.status === "pending") return `<span class="tribute-chip is-pending">受付待ち</span>`;
  if (contract.status === "active") return `<span class="tribute-chip is-active">管理中</span>`;
  return `<span class="tribute-chip is-ended">終了</span>`;
}

function renderContractRow(contract) {
  const counterpart = contractCounterpart(contract);
  // 限度額は財布にしか見えない。管理人の行は、受け取った額だけを出す（限度額がないのを「終了」と取り違えない）。
  const numbers = contract.status === "active" && contract.caps
    ? `<small>今日 ${formatPay(contract.todayTributed)} / ${formatPay(contract.caps.perDay)} ・ 合計 ${formatPay(contract.totalTributed)} / ${formatPay(contract.caps.total)}</small>`
    : contract.status === "active"
      ? `<small>今日 ${formatPay(contract.todayTributed)} ・ 合計 ${formatPay(contract.totalTributed)}</small>`
    : contract.status === "pending"
      ? `<small>${contract.role === "manager" ? "申し込みが届いています" : "受理を待っています"}</small>`
      : `<small>${escapeHtml(contract.endReasonLabel || END_REASON_LABELS[contract.endReason] || "終了")}</small>`;
  return `<button type="button" class="tribute-contract-row is-${contract.status}" data-t="open-thread" data-contract="${escapeHtml(contract.contractId)}">
    ${sigil(counterpart.card)}
    <span class="tribute-contract-main"><span class="tribute-contract-line"><strong>${escapeHtml(counterpart.name)}</strong>${contract.role === "payer" ? disclosureTag(contract.manager.disclosure) : ""}${statusChip(contract)}${contract.collarNo ? `<span class="tribute-collar is-mini"><b>${Number(contract.collarNo)}号</b></span>` : ""}${contract.role === "manager" && contract.awaitingReceipt ? `<span class="tribute-chip is-awaiting">受け取り待ち ${Number(contract.awaitingReceipt)}</span>` : ""}</span>${numbers}</span>
    ${contract.unread && contract.status !== "ended" ? `<b class="tribute-badge">${contract.unread}</b>` : ""}
  </button>`;
}

// 契約の画面。契約のある人は「やること → 契約の一覧 → 自分の設定」の順にし、毎日の確認でスクロールしなくて済むようにする。
// 契約がまだない人は、財布・管理人の始め方（自分の設定）を先に出す。
function renderHub() {
  const profile = state.profile || {};
  const open = state.contracts.filter((contract) => contract.status !== "ended");
  const ended = state.contracts.filter((contract) => contract.status === "ended");
  const hasContracts = state.contracts.length > 0;
  // 返金待ち: 管理口座の返金（残高上限で戻せなかった分）と、運営からの返金（請求の二重払いの不具合の分）。
  const escrowRefund = Number(profile.refundPending || 0);
  const operatorRefund = Number(profile.operatorRefundPending || 0);
  const refund = escrowRefund + operatorRefund > 0 ? `<section class="tribute-panel tribute-refund"><h2>返金待ち ${escapeHtml(formatPay(escrowRefund + operatorRefund))}</h2>
    ${operatorRefund > 0 ? `<p><b>運営からの返金 ${escapeHtml(formatPay(operatorRefund))}</b>：請求を二重に払えてしまう不具合があり、同じ請求に重ねて払われた分をお返しします。ご迷惑をおかけしました。</p>` : ""}
    ${escrowRefund > 0 ? `<p><b>管理口座の返金 ${escapeHtml(formatPay(escrowRefund))}</b>：財布の残高上限で戻せなかったPayを保管しています。</p>` : ""}
    <p class="tribute-note">財布の残高上限に空きがある分だけ受け取れます。</p>
    <button class="button button-primary button-small" type="button" data-t="claim-refund" ${state.busy ? "disabled" : ""}>財布へ受け取る</button></section>` : "";
  const lists = renderContractLists(open, profile);
  const me = renderMyPanel(profile, { boardNotice: !hasContracts });
  const firstSteps = isFirstTimeWallet(profile) ? renderStartGuide() : "";
  const endedPanel = ended.length ? `<details class="tribute-panel tribute-ended"${state.ended.open ? " open" : ""}><summary>終わった契約（${ended.length}${state.ended.more ? "件以上" : "件"}）</summary>${ended.map(renderContractRow).join("")}${state.ended.more ? `<button class="button button-ghost button-small" type="button" data-t="ended-more" ${state.ended.loading ? "disabled" : ""}>${state.ended.loading ? "読み込み中…" : "前の契約を読む"}</button>` : ""}</details>` : "";
  return frame(`<div class="tribute-hub">
    ${renderRanch(open, profile)}
    ${previewScreen === "achievement-frames" ? renderAchievementFrameGallery() : ""}
    ${refund}
    ${firstSteps}
    ${hasContracts ? `${renderTodo(open, profile)}${lists}${me}` : `${me}${lists}`}
    ${endedPanel}
    ${renderAchievementPanel()}
    <section class="tribute-panel tribute-legacy">
      <h2>旧推し値市場</h2>
      <p>推し値市場は2026年10月に終了し、お貢ぎ牧場へ置き換わりました。進行中の商談は完了・返還まで進み、ランキング・永久実績・推し値証書は閲覧できます。</p>
      <div class="tribute-row">
        <button class="button button-ghost button-small" type="button" data-t="legacy-market" data-dest="rankings">旧推し値市場の記録</button>
        <button class="button button-ghost button-small" type="button" data-t="legacy-market" data-dest="setup">進行中の商談に戻る</button>
      </div>
    </section>
  </div>`, { title: "契約" });
}

// やること（申し込み・未払いの請求・受け取り待ち・使用許可の申請・残高報告の依頼・未読）。押すと、その種類の最初の契約を開く。
// 掲示板から外れそうな時の知らせも、ここに出す（自分の設定は一覧の下にあるため）。
function renderTodo(open, profile) {
  const todos = contractTodos(open);
  const notice = renderBoardNotice(profile);
  // 応援欄に「見たよ」を押していない応援があれば、自分の管理人の詳細へ案内する。
  const cheers = Number(profile?.cheersUnseen || 0) > 0 && profile?.publicManagerId
    ? `<button type="button" class="tribute-todo-chip is-cheer" data-t="open-manager" data-id="${escapeHtml(profile.publicManagerId)}">応援 <b>${Number(profile.cheersUnseen)}</b></button>`
    : "";
  return `<section class="tribute-todo" aria-labelledby="tributeTodoTitle">
    <h2 class="tribute-eyebrow" id="tributeTodoTitle">やること</h2>
    ${todos.length || cheers
      ? `<div class="tribute-todo-list">${todos.map((todo) => `<button type="button" class="tribute-todo-chip is-${todo.kind}" data-t="open-thread" data-contract="${escapeHtml(todo.contractId)}">${escapeHtml(todo.label)} <b>${todo.total}</b></button>`).join("")}${cheers}</div>`
      : `<p class="tribute-todo-clear">いま、やることはありません。</p>`}
    ${notice}
  </section>`;
}

// 契約の一覧。管理人と財布の両方の契約がある人は「管理している／預けている」を切り替え、選んだ方を端末に覚える。
const HUB_ROLE_STORAGE_KEY = "hariai.tribute.hubRole.v1";

function storedHubRole() {
  try {
    const role = window.localStorage.getItem(HUB_ROLE_STORAGE_KEY);
    return role === "manager" || role === "payer" ? role : "";
  } catch {
    return "";
  }
}

function rememberHubRole(role) {
  try {
    window.localStorage.setItem(HUB_ROLE_STORAGE_KEY, role);
  } catch {
    // 覚えられなくても、切り替えはこの画面で効く。
  }
}

function renderContractLists(open, profile) {
  const card = profile.card;
  const rows = { manager: open.filter((contract) => contract.role === "manager"), payer: open.filter((contract) => contract.role === "payer") };
  const roles = [
    ...(rows.manager.length || card ? ["manager"] : []),
    ...(rows.payer.length || !card ? ["payer"] : []),
  ];
  const urgent = (role) => contractTodos(rows[role]).reduce((sum, todo) => sum + todo.total, 0);
  const role = roles.length === 1 ? roles[0]
    : roles.includes(state.hubRole) ? state.hubRole
      : storedHubRole() || (urgent("payer") > urgent("manager") ? "payer" : "manager");
  const unread = (list) => list.reduce((sum, contract) => sum + Number(contract.unread || 0), 0);
  const label = (each) => (each === "manager" ? "管理している" : "預けている");
  const count = (each) => (each === "payer" ? `${rows.payer.length} / ${LIMITS.payerOpenContracts}` : `${rows.manager.length}`);
  const head = roles.length > 1
    ? `<div class="tribute-role-switch" role="group" aria-label="契約の立場">${roles.map((each) => `<button type="button" data-t="hub-role" data-role="${each}" aria-pressed="${each === role ? "true" : "false"}">${label(each)} <small>${rows[each].length}</small>${unread(rows[each]) ? `<b class="tribute-badge">${unread(rows[each])}</b>` : ""}</button>`).join("")}</div>`
    : `<h2>${label(role)}契約 <small>${count(role)}</small></h2>`;
  const empty = role === "payer"
    ? "まだ誰にも預けていません。掲示板から管理人を探せます。"
    : card ? "まだ申し込みはありません。" : "管理人カードを作ると、申し込みを受けられます。";
  return `<section class="tribute-panel tribute-contracts">
    ${head}
    ${rows[role].length ? rows[role].map(renderContractRow).join("") : `<p class="tribute-empty">${empty}</p>`}
  </section>`;
}

// 自分の設定（財布名・掲示板・レシート・管理人カード・今日のひとこと・招待リンク・牧場を直接開くURL）。
function renderMyPanel(profile, { boardNotice = true } = {}) {
  const card = profile.card;
  return `<section class="tribute-panel tribute-me" aria-labelledby="tributeMeTitle">
      <h2 class="tribute-me-title" id="tributeMeTitle">自分の設定</h2>
      <div class="tribute-me-wallet">
        <span class="tribute-eyebrow">財布として</span>
        <form class="tribute-inline-form" data-form="wallet-name">
          <label><span>財布名（管理人のスレッドと番付に出ます）</span><input name="walletName" maxlength="${LIMITS.walletName}" value="${escapeHtml(profile.walletName || "")}" /></label>
          <button class="button button-ghost button-small" type="submit">保存</button>
        </form>
        <button class="button button-primary" type="button" data-t="nav" data-screen="board">管理人を探す</button>
        <button class="button button-ghost button-small" type="button" data-t="nav" data-screen="receipts">献上レシート（${Number(profile.receiptCount || 0)}枚）</button>
      </div>
      <div class="tribute-me-manager">
        <span class="tribute-eyebrow">管理人として</span>
        ${card ? `<div class="tribute-me-card">${sigil(card)}<div><strong>${escapeHtml(card.personaName)}</strong>${disclosureTag(card.disclosure)}${vaultTag(card.vault)}${ranchTag(card)}${cardXHandle(card) ? `<span class="tribute-tag is-x">X @${escapeHtml(cardXHandle(card))}</span>` : ""}<small>${escapeHtml(boardStatusLabel(profile))}</small></div></div>
          <div class="tribute-row">
            <button class="button button-ghost button-small" type="button" data-t="toggle-accepting">${profile.accepting ? "受付を止める" : "受付を始める"}</button>
            <button class="button button-ghost button-small" type="button" data-t="nav" data-screen="card">カードを編集</button>
          </div>
          ${styleReselectNotice(profile)}
          ${boardNotice ? renderBoardNotice(profile) : ""}
          ${renderWordForm(profile)}
          ${renderInvite(profile)}`
    : `<p>管理する側になるには、管理人カードを作ります。印は${AVATARS.length}種のアイコンか、ペルソナ名の1文字から選べます。</p>
          <button class="button button-ghost" type="button" data-t="nav" data-screen="card">管理人カードを作る</button>`}
      </div>
      ${renderOpenLink()}
    </section>`;
}

// 牧場を直接開くURL。いま開いている場所（web.app・独自ドメインなど）のURLにする。
// 場所が変わると別の匿名アカウントになり、契約が見えなくなるため、正規のURLには寄せない。
function ranchOpenUrlHere() {
  return ranchOpenUrl(`${window.location.origin}${window.location.pathname}`);
}

function renderOpenLink() {
  return `<div class="tribute-open-link">
      <span class="tribute-eyebrow">牧場を直接開くURL</span>
      <p>ブックマークやホーム画面に追加すると、トップを通らずにこの契約の画面を開けます。いま開いている場所のURLなので、同じ端末・同じブラウザで使ってください。</p>
      <div class="tribute-invite-link"><input readonly value="${escapeHtml(ranchOpenUrlHere())}" aria-label="牧場を直接開くURL" data-open-url /><button class="button button-ghost button-small" type="button" data-t="copy-open-url">コピー</button></div>
    </div>`;
}

// まだ財布として契約したことがない人。財布の始め方と見学の入口を出す。
function isNewWallet() {
  return !state.contracts.some((contract) => contract.role === "payer");
}

// はじめての方へ（管理人カードがなく、財布としてまだ一度も管理されていない人）。
// 2026-10 の集計: 年齢確認をした587人のうち68%が、カードも申し込みもなく帰っていた（その6割が 0 Pay）。
// 申し込みが48時間で失効した・受理されなかった人にも、もう一度ここから案内する。
function isFirstTimeWallet(profile) {
  if (profile?.card) return false;
  return !state.contracts.some((contract) => contract.role === "payer" && (contract.status !== "ended" || Number(contract.acceptedAt) > 0));
}

// 終わった申し込みの理由（受理されなかったもの）。掲示板の上のほう（最近動いた管理人）へ案内し直す。
function retryReasonText(endReason) {
  return { application_expired: "48時間のうちに受理されず、失効しました", declined: "受理されませんでした" }[endReason] || "";
}

function renderStartGuide() {
  const trial = trialCaps(0);
  // 契約は最後に動いた順なので、最初に見つかった終わった申し込みがいちばん新しい。
  const last = state.contracts.find((contract) => contract.role === "payer" && contract.status === "ended");
  const retry = last && retryReasonText(last.endReason)
    ? `<p class="tribute-first-steps-retry">前の申し込みは${retryReasonText(last.endReason)}。掲示板は最近動いた管理人から並んでいます。上のほうの管理人に申し込むと、受理されやすくなります。</p>`
    : "";
  return `<section class="tribute-panel tribute-first-steps" aria-labelledby="tributeFirstStepsTitle">
    <span class="tribute-eyebrow">はじめての方へ</span>
    <h2 id="tributeFirstStepsTitle">Payが0でも、今日から管理されます</h2>
    <p>入場料0の管理人なら、申し込んで受理されれば、その日から管理が始まります。払えない請求を抱えた財布として管理されるのも、お貢ぎの遊び方のひとつです。</p>
    ${retry}
    <ol class="tribute-first-steps-list">
      <li><button class="button button-ghost" type="button" data-t="open-demo"><b>1</b><span>見学する<small>見本の契約で、受取印やご褒美の届き方を見る（Payは動きません）</small></span></button></li>
      <li><button class="button button-primary" type="button" data-t="board-free"><b>2</b><span>入場料0の管理人を見る<small>掲示板は最近動いた順。上のほうほど受理されやすい</small></span></button></li>
      <li><button class="button button-ghost" type="button" data-t="nav" data-screen="board"><b>3</b><span>すべての管理人を見る<small>申し込みは「お試しの設定」なら、${TRIAL_DURATION_DAYS}日・1回${trial.perTribute} Pay・合計${trial.total} Payから</small></span></button></li>
    </ol>
    <p class="tribute-note">限度額と解約は、いつでもあなたが決められます（管理人には見えません）。</p>
    <p class="tribute-note" data-start-guide-balance>${guideBalanceMarkup()}</p>
  </section>`;
}

// 管理人が最後に動いた時（受理・返事・請求・カードの保存など）。申し込みが受理されやすいかの目安。
function activityLabel(at, now = Date.now()) {
  const value = Number(at) || 0;
  if (!value) return "";
  const hours = Math.floor(Math.max(0, now - value) / 3_600_000);
  if (hours < 1) return "1時間以内";
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

// 最後に動いた時は、管理人がカードで「出す」を選んだ時だけ出す（初期は出さない。出さないカードは時刻も届かない）。
function cardActivityLabel(card) {
  return card?.showsActivity === true ? activityLabel(card.lastActiveAt) : "";
}

// 財布の始め方の「いまの財布」。残高は後から届くので、届いたらここだけ書き換える（paintWallet）。
function guideBalanceMarkup() {
  const balance = state.walletBalance;
  const trial = trialCaps(0);
  return `いまの財布：${balance === null ? "確認中" : escapeHtml(formatPay(balance))}。AnjuPayはデイリーミッションや毎日のプレイで貯まります（現金では買えません）。${balance !== null && balance < trial.perTribute ? ' <button class="tribute-link" type="button" data-t="open-missions">デイリーミッションを見る</button>' : ""}`;
}

// 招待リンク（管理人だけ）。Xのフォロワーを、自分の管理人カードへ直接案内する。牧場の中へ向かう一方通行のリンク。
function inviteUrlFor(publicManagerId) {
  const base = document.querySelector('link[rel="canonical"]')?.href || `${window.location.origin}/`;
  return inviteUrl(base, publicManagerId);
}

function renderInvite(profile) {
  const url = inviteUrlFor(profile.publicManagerId || profile.card?.publicManagerId);
  if (!url) return "";
  return `<div class="tribute-invite">
    <span class="tribute-eyebrow">招待リンク</span>
    <p>Xのフォロワーを、あなたの管理人カードへ直接案内できます。開いた人は年齢確認のあと、このカードに着きます。</p>
    <div class="tribute-invite-link"><input readonly value="${escapeHtml(url)}" aria-label="招待リンク" data-invite-url /><button class="button button-ghost button-small" type="button" data-t="copy-invite">コピー</button></div>
    <div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="post-invite">Xで告知する</button><button class="button button-ghost button-small" type="button" data-t="recruit-open">受付カードを作る</button></div>
    <small>告知の文には、中の人の札が必ず入ります。受付カードは、飾った管理人カードを1枚の画像にして X に貼れます。${profile.accepting ? "" : "いまは受付を止めているので、受付を始めてから告知してください。"}</small>
  </div>`;
}

// 掲示板に出ていられるか。受付中のカードは、直近7日に動いた時だけ掲示板に並ぶ（サーバーの boardUntil まで）。
function boardStanding(profile, now = Date.now()) {
  if (!profile?.card || !profile.accepting || profile.hidden) return { state: "none", left: 0 };
  const until = Number(profile.boardUntil) || 0;
  if (!until) return { state: "listed", left: 0 };
  const left = until - now;
  if (left <= 0) return { state: "stale", left: 0 };
  return { state: left <= LIMITS.boardNoticeMs ? "ending" : "listed", left };
}

function boardLeftLabel(left) {
  return left < 86_400_000 ? `${Math.max(1, Math.ceil(left / 3_600_000))}時間` : `${Math.ceil(left / 86_400_000)}日`;
}

function boardStatusLabel(profile) {
  if (profile.hidden) return "通報が重なったため、今月は掲示板に出ていません。";
  if (!profile.accepting) return "受付停止中";
  const standing = boardStanding(profile);
  if (standing.state === "stale") return "受付中（7日間動きがないため、掲示板に出ていません）";
  if (standing.state === "ending") return `受付中（掲示板に出ています・あと${boardLeftLabel(standing.left)}で外れます）`;
  return "受付中（掲示板に出ています）";
}

// 7日間動きがないと掲示板から外れることを、外れる2日前から管理人にだけ知らせる。
function renderBoardNotice(profile) {
  const standing = boardStanding(profile);
  if (standing.state === "stale") {
    return `<p class="tribute-note tribute-board-notice is-stale" role="status"><b>掲示板に出ていません</b>7日間動きがなかったため、掲示板から外れています。今日のひとことを出すか、カードを保存すると、掲示板の一番上に戻ります（契約での返事や受け取りでも戻ります）。招待リンクからは、これまでどおり開けます。</p>`;
  }
  if (standing.state === "ending") {
    return `<p class="tribute-note tribute-board-notice" role="status"><b>あと${escapeHtml(boardLeftLabel(standing.left))}で掲示板から外れます</b>7日間動きがないと、掲示板に並ばなくなります。今日のひとことを出すか、カードを保存すると延びます（契約での返事や受け取りでも延びます）。</p>`;
  }
  return "";
}

// ───────────── わたしの牧場（設計書16） ─────────────
// 管理人の「契約」画面のいちばん上。放牧に同意した財布が動物になって歩き、契約の今の状態から決まったしぐさと、
// 語り手の一言（三人称の事実だけ）が出る。牧場レベルは関係の積み重ねで上がり、Pay の額では上がらない。
// 来ないと減る・弱る仕組み、通知、連続日数は入れない。絵は art/tribute-ranch/render_ranch.py で描いた。
// 第2段: 財布の鳴き声（吹き出しに語り手の一言と交互に出る）、天気と季節、財布の「牧場をのぞく」（自分の動物だけ）。
const RANCH_ASSET_KEY = "ranch-growth-v1";
const RANCH_WANDER = Object.freeze([[0.06, 0.025], [-0.06, 0.03], [0.05, -0.03], [-0.05, -0.025]]);

function ranchImage(name) {
  return `assets/tribute-ranch/${name}.webp?v=${RANCH_ASSET_KEY}`;
}

function ranchName(contract) {
  return managerNickname(contract) || contract.payer.walletName;
}

// 放牧されている財布（管理人の進行中の契約で、財布が同意したものだけ）。
function ranchHerd(contracts) {
  return contracts
    .filter((contract) => contract.role === "manager" && contract.status === "active" && contract.allowGrazing)
    .sort((left, right) => left.contractId.localeCompare(right.contractId));
}

function ranchPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

// 日報は、この画面を開いた時に一度だけ作る（前に見た時の数は、この端末にだけ残す）。
function ranchDiaryLines(herd) {
  if (state.ranch.diary) return state.ranch.diary;
  const rows = herd.map((contract) => ({
    contractId: contract.contractId,
    name: ranchName(contract),
    tributeCount: contract.tributeCount,
    totalTributed: contract.totalTributed,
    wordOfferings: contract.wordOfferings,
    workOrdersDone: contract.workOrdersDone,
    contestWon: contract.contestRecord?.won,
    servedTotal: contract.servedTotal,
  }));
  const current = ranchSnapshot(rows);
  const key = `tribute-ranch-seen:${state.uid}`;
  let previous = null;
  try {
    previous = JSON.parse(window.localStorage.getItem(key) || "null");
  } catch {
    previous = null;
  }
  // 見本では、前に見た時を少し前の数にして、日報の見え方を確かめる。
  if (previewScreen) previous = ranchSnapshot(rows.slice(1).map((row, index) => ({ ...row, tributeCount: Math.max(0, row.tributeCount - (index === 0 ? 2 : 0)), totalTributed: Math.max(0, row.totalTributed - (index === 0 ? 150 : 0)), wordOfferings: Math.max(0, row.wordOfferings - (index === 1 ? 1 : 0)) })));
  const lines = ranchDiary(previous, current);
  try {
    window.localStorage.setItem(key, JSON.stringify(current));
  } catch { /* 残せない時は、次に開いた時に日報が出ないだけ。 */ }
  state.ranch.diary = lines;
  return lines;
}

function renderRanchAnimal(entry, index) {
  const { contract, mood, spot } = entry;
  const name = entry.name || ranchName(contract);
  const animal = contract.ranchAnimal;
  const light = entry.light;
  const still = ["sleep", "tied", "plea", "gaze", "eat"].includes(mood.mood);
  const wander = RANCH_WANDER[index % RANCH_WANDER.length];
  const pose = mood.mood === "sleep" ? "sleep" : mood.mood === "eat" ? "eat" : "stand";
  // なつき（通算で仕えた日数）の飾り。0 は飾りなしの絵（名前に段階を付けない）。
  const tier = ranchFondness(contract.servedTotal).tier;
  const art = (shape) => ranchImage(`${animal}-${shape}${tier ? `-t${tier}` : ""}-${light}`);
  const sprite = still
    ? `<img src="${escapeHtml(art(pose))}" alt="" draggable="false" />`
    : `<img class="is-step-b" src="${escapeHtml(art("walk2"))}" alt="" draggable="false" /><img class="is-step-a" src="${escapeHtml(art("walk1"))}" alt="" draggable="false" /><img class="is-still" src="${escapeHtml(art("stand"))}" alt="" draggable="false" />`;
  const props = [
    mood.mood === "eat" ? `<img class="tribute-ranch-prop is-hay" src="${escapeHtml(ranchImage(`prop-hay-${light}`))}" alt="" draggable="false" />` : "",
    mood.mood === "letter" ? `<img class="tribute-ranch-prop is-letter" src="${escapeHtml(ranchImage(`prop-letter-${light}`))}" alt="" draggable="false" />` : "",
    mood.mood === "sleep" ? '<span class="tribute-ranch-zz" aria-hidden="true">z<b>z</b></span>' : "",
    // なでた時のハート（管理人の画面では押した直後に一度だけ浮かぶ。財布の画面では、今日なでてもらった印）。
    entry.heart ? `<span class="tribute-ranch-heart${entry.heart === "today" ? " is-today" : ""}" aria-hidden="true">♥</span>` : "",
  ].join("");
  const line = mood.line.replaceAll("{name}", name);
  // 財布の鳴き声（設計書16.5）。語り手の一言と交互に「」で出す（眠っている時は出さない）。どれを出すかは開いた時刻で順に変わる。
  const moos = mood.mood === "sleep" ? [] : contract.mooLines || [];
  const moo = moos.length ? moos[(Math.floor(Number(entry.now || 0) / 60_000) + index) % moos.length] : "";
  const bubble = moo
    ? `<span class="tribute-ranch-bubble has-moo" aria-hidden="true"><span class="is-fact">${escapeHtml(line)}</span><span class="is-moo">「${escapeHtml(moo)}」</span></span>`
    : `<span class="tribute-ranch-bubble" aria-hidden="true">${escapeHtml(line)}</span>`;
  const selected = !entry.peek && state.ranch.selected === contract.contractId;
  const style = [
    `--x1:${ranchPercent(spot[0])}`,
    `--y1:${ranchPercent(spot[1])}`,
    `--x2:${ranchPercent(spot[0] + (still ? 0 : wander[0]))}`,
    `--y2:${ranchPercent(spot[1] + (still ? 0 : wander[1]))}`,
    `--face:${wander[0] > 0 ? -1 : 1}`,
    `--delay:${-(index * 3.7).toFixed(1)}s`,
    `--bubble-delay:${(index * 6).toFixed(0)}s`,
    `z-index:${Math.round(spot[1] * 100)}`,
  ].join(";");
  const inner = `<span class="tribute-ranch-sprite">${sprite}</span>${props}<span class="tribute-ranch-name">${escapeHtml(name)}</span>${bubble}`;
  if (entry.peek) {
    return `<span class="tribute-ranch-animal is-${mood.mood}${still ? " is-still" : ""}" style="${style}" role="img" aria-label="${escapeHtml(`${name}（${RANCH_ANIMAL_LABELS[animal] || ""}）：${line}`)}">${inner}</span>`;
  }
  return `<button type="button" class="tribute-ranch-animal is-${mood.mood}${still ? " is-still" : ""}${selected ? " is-selected" : ""}" data-t="ranch-animal" data-contract="${escapeHtml(contract.contractId)}" style="${style}" aria-pressed="${selected}" aria-label="${escapeHtml(`${name}（${RANCH_ANIMAL_LABELS[animal] || ""}）：${line}`)}">
      ${inner}
    </button>`;
}

// 吹き出しは1頭ずつ順に出す（1頭6秒の持ち回りで、出ているのは約4.5秒。2頭が同時に出ない）。
// 頭数で1周の長さが変わるので、その頭数での出方をここで作る。
function ranchBubbleStyle(slots) {
  const percent = (seconds) => ((seconds / (slots * 6)) * 100).toFixed(2);
  return `<style>@keyframes ranch-bubble-${slots} { 0% { opacity: 0; } ${percent(0.4)}%, ${percent(4.6)}% { opacity: 1; } ${percent(5)}%, 100% { opacity: 0; } }</style>`;
}

// 天気と季節の重ね（雲・雨・雪・花びら・落ち葉）。絵は変えず、画面側で重ねる。
function renderRanchWeather() {
  return '<span class="tribute-ranch-weather-fx" aria-hidden="true"></span>';
}

// 牧場の動物の並び（管理人の欄と記念写真で同じ）。出かけている財布は牧場にいない。
function ranchPlacements(herd, now) {
  const time = ranchTimeOfDay(now);
  const light = time === "morning" ? "day" : time;
  const placed = [];
  const away = [];
  let next = 0;
  let staked = false;
  let fenced = false;
  for (const contract of herd) {
    const mood = ranchAnimalMood(contract, now);
    if (mood.mood === "away") {
      away.push(contract);
      continue;
    }
    let spot;
    if (mood.mood === "tied" && !staked) {
      spot = [RANCH_LAYOUT.stake[0] + 0.045, RANCH_LAYOUT.stake[1] + 0.02];
      staked = true;
    } else if (mood.mood === "plea" && !fenced) {
      spot = RANCH_LAYOUT.fence;
      fenced = true;
    } else {
      spot = ranchSpot(next);
      next += 1;
    }
    placed.push({ contract, mood, spot, light, now });
  }
  return { time, light, placed, away, staked };
}

function renderRanch(open, profile) {
  if (!profile.card) return "";
  const now = Date.now();
  const progress = ranchProgress(profile.ranch?.xp);
  const weather = ranchWeather(now);
  const herd = ranchHerd(open);
  const { time, light, placed, away, staked } = ranchPlacements(herd, now);
  // なでた直後だけ、その動物の上にハートが浮かぶ。
  for (const entry of placed) entry.heart = state.ranch.heart?.contractId === entry.contract.contractId && now - state.ranch.heart.at < 4_000 ? "pop" : "";
  const name = String(profile.ranch?.name || "");
  const selected = placed.find((entry) => entry.contract.contractId === state.ranch.selected)
    || (away.find((contract) => contract.contractId === state.ranch.selected) ? { contract: away.find((contract) => contract.contractId === state.ranch.selected), mood: { mood: "away", line: "{name}は出稼ぎに出ている。" } } : null);
  const diary = ranchDiaryLines(herd);
  const upcoming = RANCH_FACILITIES.find((facility) => facility.level > progress.level);
  const stake = staked ? `<img class="tribute-ranch-prop is-stake" style="--x1:${ranchPercent(RANCH_LAYOUT.stake[0])};--y1:${ranchPercent(RANCH_LAYOUT.stake[1])};z-index:${Math.round(RANCH_LAYOUT.stake[1] * 100)}" src="${escapeHtml(ranchImage(`prop-stake-${light}`))}" alt="" draggable="false" />` : "";
  const card = selected ? (() => {
    const name = ranchName(selected.contract);
    const fondness = ranchFondness(selected.contract.servedTotal);
    const fondnessText = `なつき：${fondness.label || "まだ飾りなし"}（仕えた日 ${fondness.days}日）${fondness.next ? `・あと${fondness.next.left}日で${fondness.next.label}` : ""}`;
    // なでる（設計書16.14）: 1日1回。出かけている動物は牧場にいないので、なでられない。
    const pattedToday = Number(selected.contract.pattedAt) > 0 && jstDateKey(selected.contract.pattedAt) === jstDateKey(now);
    const pat = selected.mood.mood === "away"
      ? ""
      : `<button class="button ${pattedToday ? "button-ghost" : "button-primary"} button-small" type="button" data-t="ranch-pat" data-contract="${escapeHtml(selected.contract.contractId)}" ${pattedToday || state.busy ? "disabled" : ""}>${pattedToday ? "今日はなでました" : "なでる"}</button>`;
    return `<div class="tribute-ranch-card">
      <div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(RANCH_ANIMAL_LABELS[selected.contract.ranchAnimal] || "")}</small></div>
      <p>${escapeHtml(selected.mood.line.replaceAll("{name}", name))}</p>
      <p class="tribute-ranch-fondness">${escapeHtml(fondnessText)}</p>
      ${selected.contract.mooLines?.length ? `<p class="tribute-ranch-moo">鳴き声：${selected.contract.mooLines.map((moo) => `「${escapeHtml(moo)}」`).join("")}</p>` : ""}
      <div class="tribute-ranch-kinds" role="group" aria-label="動物を選ぶ">${RANCH_ANIMALS.map((animal) => `<button type="button" data-t="ranch-kind" data-contract="${escapeHtml(selected.contract.contractId)}" data-animal="${animal}" aria-pressed="${selected.contract.ranchAnimal === animal}" ${state.busy ? "disabled" : ""}>${escapeHtml(RANCH_ANIMAL_LABELS[animal])}</button>`).join("")}</div>
      <div class="tribute-ranch-card-actions">${pat}<button class="button button-ghost button-small" type="button" data-t="open-thread" data-contract="${escapeHtml(selected.contract.contractId)}">スレッドへ</button></div>
    </div>`;
  })() : "";
  return `<section class="tribute-panel tribute-ranch is-${time} is-${weather.season} is-${weather.weather}" aria-label="わたしの牧場">
    <div class="tribute-ranch-head"><span class="tribute-eyebrow">わたしの牧場</span><strong>${escapeHtml(ranchTitle(name))} Lv.${progress.level}</strong><small>次の Lv まで あと ${progress.toNext}</small><small class="tribute-ranch-weather">${escapeHtml(weather.label)}</small></div>
    <div class="tribute-ranch-meter" aria-hidden="true"><i style="--ratio:${ranchPercent(progress.ratio)}"></i></div>
    ${ranchBubbleStyle(Math.max(3, placed.length))}
    <div class="tribute-ranch-scene${placed.length > RANCH_LAYOUT.spots.length ? " is-crowded" : ""}" style="--cycle:${Math.max(3, placed.length) * 6}s;--bubble:ranch-bubble-${Math.max(3, placed.length)}">
      <img class="tribute-ranch-ground" src="${escapeHtml(ranchImage(`ranch-lv${progress.artLevel}-${light}`))}" alt="牧場 Lv.${progress.level}の芝の島" draggable="false" />
      ${stake}${placed.map((entry, index) => renderRanchAnimal(entry, index)).join("")}
      ${renderRanchWeather()}
    </div>
    <div class="tribute-ranch-tools"><button class="button button-ghost button-small" type="button" data-t="ranch-photo">記念写真</button><button class="button button-ghost button-small" type="button" data-t="ranch-naming" aria-expanded="${state.ranch.naming === true}">${name ? "名前を変える" : "名前を付ける"}</button></div>
    ${state.ranch.naming ? `<form class="tribute-ranch-name-form" data-form="ranch-name">
      <label class="tribute-field"><span>牧場の名前（「○○牧場」の○○。${RANCH_NAME.length}文字まで）</span><input name="ranchName" maxlength="${RANCH_NAME.length + 2}" value="${escapeHtml(name)}" autocomplete="off" /></label>
      <p class="tribute-note">管理人カードの札（掲示板にも出ます）・財布の「牧場をのぞく」・記念写真に出ます。連絡先や性的な言葉は書けません。空にすると外れます。</p>
      <p class="tribute-form-error" data-form-error role="alert"></p>
      <div class="tribute-row"><button class="button button-primary button-small" type="submit" ${state.busy ? "disabled" : ""}>保存</button><button class="button button-ghost button-small" type="button" data-t="ranch-naming">やめる</button></div>
    </form>` : ""}
    ${card}
    ${away.length ? `<p class="tribute-ranch-away">出稼ぎに出ている：${away.map((contract) => `<button type="button" class="tribute-link" data-t="ranch-animal" data-contract="${escapeHtml(contract.contractId)}">${escapeHtml(ranchName(contract))}</button>`).join("・")}</p>` : ""}
    ${herd.length ? "" : '<p class="tribute-note">放牧に同意した財布が、ここで暮らします。財布は申し込みとスレッドの設定で選べます。</p>'}
    <div class="tribute-ranch-diary"><h3>日報</h3>${diary.length ? `<ul>${diary.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : '<p>前に見た時から、変わったことはありません。</p>'}</div>
    <small class="tribute-ranch-rule">牧場は、財布を迎える・仕えた日・受け取り・確認・願い出への返事・延長で育ちます。Pay の額では上がらず、来なくても何も減りません。${upcoming ? ` 次は Lv.${upcoming.level} で「${escapeHtml(upcoming.label)}」。` : " Lv30 から先は、施設は増えずにレベルの数字だけ上がり続けます。"}動物は、その財布が仕えた日数（7日・30日・100日・365日）で飾りが増えます。吹き出しの「」は、その財布が自分で書いた鳴き声です。動物を押すと、1日1回なでられます（財布の「牧場をのぞく」に、なでた日が出ます）。</small>
  </section>`;
}

// 牧場の記念写真（設計書16.15）。いまの牧場を1枚の画像にする。動物は、スクショ掲載を許した財布の分だけ、
// 名前を入れずに写す（許していない財布は写らず、並びもその財布たちだけで決める）。描くのはこの端末の中だけ。
function ranchPhotoData(profile, now = Date.now()) {
  const card = profile.card;
  const progress = ranchProgress(profile.ranch?.xp);
  const weather = ranchWeather(now);
  const herd = ranchHerd(state.contracts).filter((contract) => contract.allowScreenshots === true);
  const { time, light, placed, staked } = ranchPlacements(herd, now);
  const width = placed.length > RANCH_LAYOUT.spots.length ? 0.14 : 0.17;
  const disclosureKey = DISCLOSURE_SHORT[card.disclosure] ? card.disclosure : "undisclosed";
  return {
    manager: {
      personaName: card.personaName,
      avatarUrl: avatarUrl(card.avatar),
      premiumAvatar: isPremiumAvatar(card.avatar),
      color: sigilColor(card),
      disclosureKey,
      disclosureLabel: DISCLOSURE_LABELS[disclosureKey],
    },
    title: ranchTitle(profile.ranch?.name),
    level: progress.level,
    weatherLabel: weather.label,
    scene: {
      time,
      season: weather.season,
      weather: weather.weather,
      ground: ranchImage(`ranch-lv${progress.artLevel}-${light}`),
      stake: staked ? { url: ranchImage(`prop-stake-${light}`), x: RANCH_LAYOUT.stake[0], y: RANCH_LAYOUT.stake[1] } : null,
      animals: placed.map(({ contract, mood, spot }) => {
        const pose = mood.mood === "sleep" ? "sleep" : mood.mood === "eat" ? "eat" : "stand";
        const tier = ranchFondness(contract.servedTotal).tier;
        return {
          url: ranchImage(`${contract.ranchAnimal}-${pose}${tier ? `-t${tier}` : ""}-${light}`),
          x: spot[0],
          y: spot[1],
          width,
          hay: mood.mood === "eat" ? ranchImage(`prop-hay-${light}`) : "",
          letter: mood.mood === "letter" ? ranchImage(`prop-letter-${light}`) : "",
        };
      }),
    },
    at: now,
  };
}

function openRanchPhoto() {
  if (!state.profile?.card) return;
  closeSharePreview();
  state.sheet = { type: "ranch-photo", status: "ready", error: "", previewUrl: "", blob: null, fileName: "", rendering: true };
  renderLayer();
  loadRanchPhoto(state.sheet);
}

async function loadRanchPhoto(sheet) {
  try {
    const canvas = await renderRanchPhotoImage(ranchPhotoData(state.profile));
    const blob = await canvasToPngBlob(canvas);
    if (state.sheet !== sheet) return;
    sheet.blob = blob;
    sheet.previewUrl = URL.createObjectURL(blob);
    const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
    sheet.fileName = `omitsugi-ranch-${stamp}.png`;
  } catch (error) {
    if (state.sheet !== sheet) return;
    sheet.error = friendlyError(error, "画像を作れませんでした。");
  }
  sheet.rendering = false;
  paintSharePreview();
}

function renderRanchPhotoSheet(sheet, wrap) {
  const shown = ranchHerd(state.contracts).filter((contract) => contract.allowScreenshots === true).length;
  return wrap("牧場の記念写真", `<div class="tribute-share">
    <div class="tribute-share-body">
      <div class="tribute-share-preview" data-share-preview>${sharePreviewMarkup(sheet)}</div>
      <div class="tribute-share-options"><p class="tribute-note">いまの牧場（名前・レベル・施設・季節と天気・時間帯）を1枚の写真にします。</p>
        <p class="tribute-note">動物は、スクショ掲載を許している財布の分だけ、名前を入れずに写します。許していない財布は写りません。${shown ? "" : "いまは写る動物がいないので、牧場だけの写真になります。"}</p></div>
    </div>
    <p class="tribute-note">画像にURLは入りません。「AnjuPay・換金不可」の表記とお貢ぎ牧場の名前は必ず入ります。</p>
    <div class="tribute-row"><button class="button button-primary" type="button" data-t="ranch-photo-send" data-share-action ${sheet.blob && !sheet.rendering ? "" : "disabled"}>共有（X など）</button><button class="button button-ghost" type="button" data-t="ranch-photo-save" data-share-action ${sheet.blob && !sheet.rendering ? "" : "disabled"}>画像で保存</button></div>
    <small>スマホは共有から画像ごとXへ送れます。PCは保存してから、Xの投稿に添付します。</small>
  </div>`);
}

async function sendRanchPhoto(saveOnly) {
  const sheet = state.sheet;
  if (sheet?.type !== "ranch-photo" || !sheet.blob || sheet.rendering) return;
  const file = new File([sheet.blob], sheet.fileName, { type: "image/png" });
  if (!saveOnly && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: RANCH_PHOTO_TEXT });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  downloadShareBlob(sheet.blob, sheet.fileName);
  showToast(saveOnly ? "画像を保存しました。Xの投稿に添付できます。" : "この端末では共有が使えないため、画像を保存しました。Xの投稿に添付できます。");
}

// 飼育記録（設計書16.15）。財布の「牧場をのぞく」に出す、自分の動物の記録。ほかの財布と比べる形にはしない。
// 飾りが付いた日は、記録を始めてから付いたものだけ分かる（その前のものは日数だけ）。
function renderRanchRecord(view) {
  const day = (at) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(at));
  const fondness = ranchFondness(view.servedTotal);
  const rows = [
    ["この契約で迎えられた日", view.acceptedAt ? day(view.acceptedAt) : "まだ（申し込み中）"],
    ["仕えた日（通算）", `${fondness.days}日`],
    ...RANCH_FONDNESS.filter((step) => fondness.days >= step.days).map((step) => [step.label, view.fondnessAt?.[step.tier] ? `${day(view.fondnessAt[step.tier])}に付いた` : `仕えた日${step.days}日で付いた`]),
    fondness.next ? ["次の飾り", `${fondness.next.label}（あと${fondness.next.left}日）`] : null,
    ["なでてもらった日", `${Number(view.patDays) || 0}日`],
  ].filter(Boolean);
  return `<div class="tribute-ranch-record"><h3>飼育記録</h3><dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><p class="tribute-note">あなたの動物の記録です。ほかの財布とは比べません。</p></div>`;
}

// 財布の「牧場をのぞく」（設計書16.2）。管理人の牧場（レベルと施設）に、自分の動物だけを置く。
// ほかの財布の動物・頭数は出さない。管理人の画面にだけ出る事実（未払い・3日以上なにもない）も出さない。
// 名前の札は財布名（呼び名は管理人だけのもの）。鳴き声を書く欄と、放牧の設定もここにある。
function renderRanchPeek(view, sheet) {
  const now = Date.now();
  const time = ranchTimeOfDay(now);
  const light = time === "morning" ? "day" : time;
  const weather = ranchWeather(now);
  const name = view.payer.walletName;
  const grazing = view.allowGrazing === true;
  const grazed = grazing && view.status === "active";
  let scene;
  if (sheet.status === "loading") {
    scene = '<p class="tribute-note" role="status">牧場を読み込んでいます…</p>';
  } else if (sheet.status === "error") {
    scene = `<p class="tribute-form-error" role="alert">${escapeHtml(sheet.error)}</p>`;
  } else {
    const level = Math.max(1, Number(sheet.level) || 1);
    const artLevel = Math.min(level, RANCH_ART_LEVELS);
    const mood = grazed ? ranchAnimalMood(view, now, { payer: true }) : null;
    const tied = mood?.mood === "tied";
    const spot = tied ? [RANCH_LAYOUT.stake[0] + 0.045, RANCH_LAYOUT.stake[1] + 0.02] : mood?.mood === "plea" ? RANCH_LAYOUT.fence : RANCH_LAYOUT.spots[0];
    const stake = tied ? `<img class="tribute-ranch-prop is-stake" style="--x1:${ranchPercent(RANCH_LAYOUT.stake[0])};--y1:${ranchPercent(RANCH_LAYOUT.stake[1])};z-index:${Math.round(RANCH_LAYOUT.stake[1] * 100)}" src="${escapeHtml(ranchImage(`prop-stake-${light}`))}" alt="" draggable="false" />` : "";
    const pattedAt = Number(view.pattedAt) || 0;
    const pattedToday = pattedAt > 0 && jstDateKey(pattedAt) === jstDateKey(now);
    const animal = mood && mood.mood !== "away" ? renderRanchAnimal({ contract: view, mood, spot, light, now, name, peek: true, heart: pattedToday ? "today" : "" }, 0) : "";
    const fondness = ranchFondness(view.servedTotal);
    const patLine = !grazing || !pattedAt
      ? ""
      : pattedToday
        ? `今日、${view.manager.personaName}になでてもらった。`
        : `${view.manager.personaName}に最後になでてもらった日：${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(new Date(pattedAt))}`;
    const status = !grazing
      ? "いまは放牧されていません。"
      : view.status !== "active"
        ? "申し込みが受けられると、この牧場に放牧されます。"
        : mood.line.replaceAll("{name}", name);
    scene = `<div class="tribute-ranch tribute-ranch-peek is-${time} is-${weather.season} is-${weather.weather}">
      <div class="tribute-ranch-head"><strong>${escapeHtml(ranchTitle(sheet.ranchName))} Lv.${level}</strong><small class="tribute-ranch-weather">${escapeHtml(weather.label)}</small></div>
      <div class="tribute-ranch-scene" style="--cycle:6s">
        <img class="tribute-ranch-ground" src="${escapeHtml(ranchImage(`ranch-lv${artLevel}-${light}`))}" alt="${escapeHtml(`${view.manager.personaName}の牧場 Lv.${level}`)}" draggable="false" />
        ${stake}${animal}
        ${renderRanchWeather()}
      </div>
      <p>${escapeHtml(status)}</p>
      ${patLine ? `<p class="tribute-ranch-pat">${escapeHtml(patLine)}</p>` : ""}
      ${grazing ? `<p class="tribute-ranch-fondness">${escapeHtml(`なつき：${fondness.label || "まだ飾りなし"}（仕えた日 ${fondness.days}日）${fondness.next ? `・あと${fondness.next.left}日で${fondness.next.label}` : ""}`)}</p>` : ""}
    </div>`;
  }
  const lines = view.mooLines || [];
  return `<div class="tribute-ranch-peek-body">
    <p>${escapeHtml(view.manager.personaName)}の牧場をのぞきます。見えるのは牧場とあなたの動物だけで、ほかの財布の動物は見えません。あなたの動物を見られるのは、管理人とあなただけです。管理人が牧場であなたの動物をなでると、ここに出ます。</p>
    ${scene}
    ${renderRanchRecord(view)}
    <form class="tribute-sheet-form" data-form="moo">
      <h3>鳴き声</h3>
      <p class="tribute-note">管理人の牧場で、あなたの動物の吹き出しに、語り手の一言と交互に出ます。1つ${RANCH_MOO.length}文字まで、${RANCH_MOO.lines}つまで。応援欄と同じく、連絡先や性的な言葉は書けません。空にすると消えます。</p>
      ${Array.from({ length: RANCH_MOO.lines }, (_, index) => `<label class="tribute-field"><span>鳴き声${index + 1}</span><input name="moo${index}" maxlength="${RANCH_MOO.length}" value="${escapeHtml(lines[index] || "")}" autocomplete="off" /></label>`).join("")}
      <p class="tribute-form-error" data-form-error role="alert"></p>
      <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>鳴き声を保存</button>
    </form>
    <div class="tribute-confirm">
      <h3>放牧</h3>
      <p>いま：<b>${grazing ? "放牧されている" : "放牧されていない"}</b></p>
      <p class="tribute-note">放牧されると、あなたの献上・言葉の献上・お預けなどの今の状態が、動物のしぐさになります。決めるのはあなただけで、いつでも変えられます。外すと、その場で牧場からいなくなります。</p>
      <button class="button ${grazing ? "button-ghost" : "button-primary"}" type="button" data-t="set-grazing" data-allow="${grazing ? "0" : "1"}" ${state.busy ? "disabled" : ""}>${grazing ? "放牧されないようにする" : "放牧される"}</button>
      <button class="button button-ghost" type="button" data-t="sheet-close">閉じる</button>
    </div>
  </div>`;
}

function openRanchPeek() {
  const view = state.thread.view;
  if (!view || view.role !== "payer") return;
  state.sheet = { type: "ranch-peek", step: "", clientRequestId: createRequestId(), status: "loading", level: 0, error: "" };
  // 鳴き声の欄に自動で入らない（スマホでキーボードが開かないように）。
  renderLayer();
  loadRanchPeek(state.sheet, view.contractId);
}

async function loadRanchPeek(sheet, contractId) {
  try {
    const result = await call("ranch_peek", { contractId });
    if (state.sheet !== sheet) return;
    sheet.level = Math.max(1, Number(result?.ranchLevel) || 1);
    sheet.ranchName = String(result?.ranchName || "");
    sheet.status = "ready";
  } catch (error) {
    if (state.sheet !== sheet) return;
    sheet.status = "error";
    sheet.error = friendlyError(error, "牧場を読み込めませんでした。");
  }
  renderLayer();
}

// 今日のひとこと（管理人だけ）。掲示板のカードに24時間出て、出すとカードが上に並ぶ。
function renderWordForm(profile) {
  const word = profile.card?.word;
  const left = Math.max(0, TODAY_WORD.perDay - Number(profile.wordsToday || 0));
  return `<form class="tribute-word-form" data-form="word">
    <span class="tribute-eyebrow">今日のひとこと</span>
    ${word ? `<p class="tribute-word-current"><span class="tribute-word-bubble">${escapeHtml(word.text)}</span><small>${escapeHtml(wordRemainingLabel(word.at))}</small><button class="tribute-link" type="button" data-t="clear-word">消す</button></p>` : ""}
    <div class="tribute-word-input"><input name="word" maxlength="${TODAY_WORD.length}" autocomplete="off" placeholder="例：今夜は機嫌がいい。財布は並びな。" aria-label="今日のひとこと（${TODAY_WORD.length}文字まで）" ${left ? "" : "disabled"} /><button class="button button-ghost button-small" type="submit" ${left && !state.busy ? "" : "disabled"}>出す</button></div>
    <small>掲示板のカードに24時間出て、出すとカードが上に並びます。今日あと${left}回（日本時間の0時に戻ります）。連絡先・外部決済・性的な言葉は書けません。</small>
    <p class="tribute-form-error" data-form-error role="alert"></p>
  </form>`;
}

function wordBubble(word, extra = "") {
  return word?.text
    ? `<span class="tribute-card-word${extra}"><span>${escapeHtml(word.text)}</span><small>今日のひとこと ・ ${escapeHtml(wordAgeLabel(word.at))}</small></span>`
    : "";
}

const ACHIEVEMENT_SIDES = Object.freeze([
  Object.freeze({ family: "tribute_manager", side: "管理する側", statKey: "managerPairDays", unit: "受け取った献上" }),
  Object.freeze({ family: "tribute_wallet", side: "財布の側", statKey: "walletPairDays", unit: "差し出した献上" }),
]);

// ───────────── 牧場の実績の枠（設計書17） ─────────────
// 枠は実績の系統ごとに形と飾りが違う（ユーザー決定 2026-10-30「系統に応じた枠」「豪華＝冠ではない」）。
// 段階（1〜5）が上がるほど、その系統の飾り（柵・帳簿・鎖・吹き出し・門・音・車輪・盤・首輪・景色・ハート、
// 財布側は硬貨・贈り物・印・縄・錠・茨・手紙・巻物・籠・石・鈴・足あと）が増え、縁の素材が 木・革 → 銅 → 銀 → 金 → 金と光 になる。
// 冠は「金の王冠の財布」（なつきの飾りそのもの）にだけ使う。シークレットは、それぞれ色の違う封蝋。
// 色は class で CSS が決める（管理人の地は薔薇色、財布の地は琥珀色）。形は決まった数から作る（毎回同じ）。
const RF = Object.freeze({ x: 32, y: 35 });

function rfPoint(angle, radius, center = RF) {
  const rad = (angle * Math.PI) / 180;
  return [Number((center.x + radius * Math.cos(rad)).toFixed(2)), Number((center.y - radius * Math.sin(rad)).toFixed(2))];
}

function rfSpark(x, y, size) {
  const d = size * 0.28;
  return `<path class="spark" d="M${x} ${y - size}L${x + d} ${y - d}L${x + size} ${y}L${x + d} ${y + d}L${x} ${y + size}L${x - d} ${y + d}L${x - size} ${y}L${x - d} ${y - d}Z"/>`;
}

function rfSparks(points) {
  return points.map(([x, y, size]) => rfSpark(x, y, size)).join("");
}

function rfHeart(x, y, size, cls) {
  const scale = size / 32;
  return `<path class="${cls}" d="${RANK_HEART_PATH}" transform="translate(${(x - 16 * scale).toFixed(2)} ${(y - 16 * scale).toFixed(2)}) scale(${scale.toFixed(3)})"/>`;
}

function rfFlower(x, y, size, cls = "petal") {
  const petals = [90, 162, 234, 306, 18].map((angle) => {
    const [px, py] = rfPoint(angle, size * 0.62, { x, y });
    return `<circle class="${cls}" cx="${px}" cy="${py}" r="${(size * 0.48).toFixed(2)}"/>`;
  }).join("");
  return `${petals}<circle class="flower-heart" cx="${x}" cy="${y}" r="${(size * 0.36).toFixed(2)}"/>`;
}

function rfLeaf(x, y, angle, length = 3.4, cls = "leaf") {
  return `<ellipse class="${cls}" cx="${x}" cy="${y}" rx="${length}" ry="${(length * 0.45).toFixed(2)}" transform="rotate(${angle} ${x} ${y})"/>`;
}

function rfNote(x, y, size = 1) {
  return `<ellipse class="note" cx="${x}" cy="${y}" rx="${(2.2 * size).toFixed(2)}" ry="${(1.6 * size).toFixed(2)}" transform="rotate(-22 ${x} ${y})"/><path class="note-stem" d="M${(x + 2 * size).toFixed(2)} ${y}V${(y - 8 * size).toFixed(2)}Q${(x + 5 * size).toFixed(2)} ${(y - 6.5 * size).toFixed(2)} ${(x + 5.2 * size).toFixed(2)} ${(y - 3.6 * size).toFixed(2)}"/>`;
}

function rfAround(count, radius, start, draw) {
  return Array.from({ length: count }, (_, index) => {
    const angle = start + (360 / count) * index;
    const [x, y] = rfPoint(angle, radius);
    return draw(x, y, angle, index);
  }).join("");
}

function rfArc(radius, from, to, cls, sweep) {
  const [x1, y1] = rfPoint(from, radius);
  const [x2, y2] = rfPoint(to, radius);
  return `<path class="${cls}" d="M${x1} ${y1}A${radius} ${radius} 0 0 ${sweep} ${x2} ${y2}"/>`;
}

function rfCoin(x, y, r) {
  return `<circle class="coin" cx="${x}" cy="${y}" r="${r}"/><circle class="coin-in" cx="${x}" cy="${y}" r="${(r * 0.6).toFixed(2)}"/>`;
}

function rfPaw(x, y, size = 1) {
  const toes = [[-3.2, -3.6], [-1.1, -5.2], [1.1, -5.2], [3.2, -3.6]].map(([dx, dy]) => `<ellipse class="paw" cx="${(x + dx * size).toFixed(2)}" cy="${(y + dy * size).toFixed(2)}" rx="${(1.15 * size).toFixed(2)}" ry="${(1.45 * size).toFixed(2)}"/>`).join("");
  return `<ellipse class="paw" cx="${x}" cy="${y}" rx="${(3 * size).toFixed(2)}" ry="${(2.5 * size).toFixed(2)}"/>${toes}`;
}

function rfSnowflake(x, y, size) {
  return `<path class="ice" d="M${x} ${y - size}V${y + size}M${(x - size * 0.87).toFixed(2)} ${(y - size / 2).toFixed(2)}L${(x + size * 0.87).toFixed(2)} ${(y + size / 2).toFixed(2)}M${(x - size * 0.87).toFixed(2)} ${(y + size / 2).toFixed(2)}L${(x + size * 0.87).toFixed(2)} ${(y - size / 2).toFixed(2)}"/>`;
}

function rfRose(x, y, size) {
  return `<circle class="rose" cx="${x}" cy="${y}" r="${size}"/><circle class="rose-in" cx="${x}" cy="${y}" r="${(size * 0.55).toFixed(2)}"/><path class="rose-curl" d="M${(x - size * 0.4).toFixed(2)} ${y}A${(size * 0.4).toFixed(2)} ${(size * 0.4).toFixed(2)} 0 1 1 ${(x + size * 0.3).toFixed(2)} ${(y + size * 0.3).toFixed(2)}"/>`;
}

const RF_BUBBLE = "M18 18H46Q50 18 50 22V44Q50 48 46 48H28L20 55L22 48H18Q14 48 14 44V22Q14 18 18 18Z";
const RF_SHEET = "M16 18H43L49 24V54H16Z";
const RF_ARCH = "M15 54V34Q15 17 32 17Q49 17 49 34V54Z";
const RF_OCTAGON = "M25 17H39L50 28V42L39 53H25L14 42V28Z";
const RF_STAMP = (() => {
  const bumps = 18;
  return Array.from({ length: bumps * 2 }, (_, index) => {
    const [x, y] = rfPoint((index / (bumps * 2)) * 360, index % 2 ? 16.6 : 18.4);
    return `${index ? "L" : "M"}${x} ${y}`;
  }).join("") + "Z";
})();
const RF_WAX = Array.from({ length: 40 }, (_, index) => {
  const [x, y] = rfPoint((index / 40) * 360, 21 + 1.3 * Math.sin(index * 2.1) + 0.7 * Math.cos(index * 3.3));
  return `${index ? "L" : "M"}${x} ${y}`;
}).join("") + "Z";

// 地の形。glyph はその形の中で字を置く高さ。
const RF_PLATES = Object.freeze({
  circle: { glyph: 35, svg: '<circle class="plate" cx="32" cy="35" r="17.5"/>' },
  coin: { glyph: 35, svg: '<circle class="plate" cx="32" cy="35" r="17.5"/><circle class="plate-in" cx="32" cy="35" r="14.6"/>' },
  square: { glyph: 35, svg: '<rect class="plate" x="14.5" y="17.5" width="35" height="35" rx="5"/>' },
  board: { glyph: 35, svg: '<rect class="plate" x="14.5" y="17.5" width="35" height="35" rx="3"/><path class="grid" d="M23.25 17.5V52.5M32 17.5V52.5M40.75 17.5V52.5M14.5 26.25H49.5M14.5 35H49.5M14.5 43.75H49.5"/>' },
  paper: { glyph: 37, svg: `<path class="plate" d="${RF_SHEET}"/><path class="fold" d="M43 18V24H49"/>` },
  bubble: { glyph: 33, svg: `<path class="plate" d="${RF_BUBBLE}"/>` },
  arch: { glyph: 38, svg: `<path class="plate" d="${RF_ARCH}"/>` },
  octagon: { glyph: 35, svg: `<path class="plate" d="${RF_OCTAGON}"/>` },
  // ハートの形は RANK_HEART_PATH（このファイルの後ろで決める）を使うので、描く時に作る。
  heart: { glyph: 35, get svg() { return rfHeart(32, 37, 40, "plate"); } },
  stamp: { glyph: 35, svg: `<path class="plate" d="${RF_STAMP}"/>` },
  lock: { glyph: 40, svg: '<path class="shackle" d="M23 26V18Q23 9.5 31.5 9.5Q40 9.5 40 18V20"/><rect class="plate" x="15.5" y="25" width="33" height="28" rx="5"/>' },
  envelope: { glyph: 41, svg: '<rect class="plate" x="12.5" y="21" width="39" height="29" rx="3"/><path class="fold" d="M13 22L32 34L51 22"/>' },
  scroll: { glyph: 34, svg: '<rect class="plate" x="17" y="19" width="30" height="31"/><rect class="roll" x="11.5" y="17" width="6.5" height="35" rx="3"/><rect class="roll" x="46" y="17" width="6.5" height="35" rx="3"/>' },
});

// 系統ごとの形と飾り。t は枠の段階（1〜5）。back は地の後ろ、front は地の上（字の下）に描く。
const RF_FAMILIES = Object.freeze({
  // 牧場の管理: 柵の杭が増え、白く塗られ、花が咲き、金の杭と灯りになる。
  tribute_manager: { plate: "circle", draw: (t) => {
    const count = [6, 8, 10, 12, 12][t - 1];
    const posts = Array.from({ length: count }, (_, index) => `<rect class="${t >= 3 ? "post is-paint" : "post"}" x="30.4" y="7.6" width="3.2" height="9.6" rx="1.2" transform="rotate(${((360 / count) * (index + 0.5)).toFixed(1)} 32 35)"/>`).join("");
    const flowers = t >= 3 ? [[13, 55], [51, 55], ...(t >= 4 ? [[7, 35], [57, 35], [13, 15], [51, 15]] : [])].map(([x, y]) => rfFlower(x, y, 2.6)).join("") : "";
    return {
      back: `<circle class="rail" cx="32" cy="35" r="21"/>${t >= 2 ? '<circle class="rail" cx="32" cy="35" r="24.4"/>' : ""}${posts}`,
      front: `${flowers}${t === 5 ? `${[[32, 3.6], [5, 47], [59, 47]].map(([x, y]) => `<circle class="lantern" cx="${x}" cy="${y}" r="2.3"/>`).join("")}${rfSparks([[9, 9, 2.6], [56, 59, 2.2]])}` : ""}`,
    };
  } },
  // 請求: 帳簿の紙が重なり、しおり・背表紙・金の角が付き、最後は羽根ペンと封蝋。
  tribute_mgr_request: { plate: "paper", draw: (t) => ({
    back: [
      t >= 2 ? `<path class="sheet" d="${RF_SHEET}" transform="rotate(8 32 36)"/>` : "",
      t >= 3 ? `<path class="sheet" d="${RF_SHEET}" transform="rotate(-9 32 36)"/>` : "",
      t >= 4 ? '<rect class="mf" x="11.5" y="16.5" width="5.5" height="39" rx="1.6"/>' : "",
      t === 5 ? '<path class="quill" d="M60 3Q49 12 43 25L45.6 26.4Q54 15 60 3Z"/><path class="quill-vein" d="M59 4.5L44.3 25.6"/>' : "",
    ].join(""),
    front: [
      t >= 3 ? '<path class="ribbon" d="M37.5 18V28L40 25.4L42.5 28V18Z"/>' : "",
      t >= 4 ? '<path class="mf" d="M16 18H21.5L16 23.5Z"/><path class="mf" d="M16 54H21.5L16 48.5Z"/>' : "",
      t === 5 ? `<circle class="wax-seal" cx="47" cy="52" r="5.2"/><circle class="wax-seal-in" cx="47" cy="52" r="3.2"/>${rfSparks([[7, 10, 2.6], [58, 40, 2]])}` : "",
    ].join(""),
  }) },
  // 抵抗を折る: 地のひび → 切れた鎖 → 切れ目が増え、破片が散り、金の鎖が砕けて光る。
  tribute_mgr_break: { plate: "circle", draw: (t) => {
    const crack = '<path class="crack" d="M43.5 21L39.5 27L44 31L38.5 37"/>';
    if (t === 1) return { back: "", front: crack };
    const gaps = t === 2 ? [3] : t === 3 ? [3, 10] : [3, 7, 11];
    const links = rfAround(14, 23.2, 90, (x, y, angle, index) => (gaps.includes(index) ? "" : `<ellipse class="chain" cx="${x}" cy="${y}" rx="3.3" ry="${index % 2 ? 1.5 : 2}" transform="rotate(${(-angle - 90).toFixed(1)} ${x} ${y})"/>`));
    const shards = t >= 3 ? gaps.map((gap) => {
      const angle = 90 + (360 / 14) * gap;
      return [-9, 9].map((offset) => {
        const [x, y] = rfPoint(angle + offset, 28.4);
        return `<path class="shard" d="M${x} ${(y - 2).toFixed(2)}L${(x + 1.8).toFixed(2)} ${(y + 1.4).toFixed(2)}L${(x - 1.7).toFixed(2)} ${(y + 1.2).toFixed(2)}Z"/>`;
      }).join("");
    }).join("") : "";
    return { back: links, front: `${crack}${shards}${t === 5 ? rfSparks([[8, 8, 2.8], [57, 10, 2.2], [57, 58, 2.4]]) : ""}` };
  } },
  // 既読無視: 吹き出しの横に「既読」。返さない吹き出しが重なり、夜の月と星が出て、月明かりで光る。
  tribute_mgr_ignore: { plate: "bubble", draw: (t) => ({
    back: [
      t >= 3 ? `<path class="bubble-back" d="${RF_BUBBLE}" transform="translate(-6 -7)"/>` : "",
      t >= 2 ? `<path class="bubble-back" d="${RF_BUBBLE}" transform="translate(-3 -3.5)"/>` : "",
      t >= 4 ? '<path class="moon" d="M55 4.5A7.5 7.5 0 1 0 61.5 15.5A6 6 0 1 1 55 4.5Z"/>' : "",
    ].join(""),
    front: `<text class="tag-text" x="51" y="58.5" text-anchor="end">既読</text>${t >= 4 ? rfSparks([[46, 7, 1.8], [8, 56, 1.6]]) : ""}${t === 5 ? rfSparks([[6, 12, 2.4], [60, 30, 2], [40, 61, 1.8]]) : ""}`,
  }) },
  // 許す: 門の下に鍵 → 蝶番 → 扉が開き → つるが絡み → 金の門から光が差し、花びらが舞う。
  tribute_mgr_grant: { plate: "arch", draw: (t) => ({
    back: [
      t === 5 ? rfAround(9, 29, 10, (x, y, angle) => (angle > 0 && angle < 180 ? `<path class="ray" d="M${rfPoint(angle, 22).join(" ")}L${x} ${y}"/>` : "")) : "",
      t >= 3 ? '<path class="door" d="M15 22L7 27V57L15 54Z"/><path class="door" d="M49 22L57 27V57L49 54Z"/>' : "",
    ].join(""),
    front: [
      '<circle class="key-bow" cx="18.5" cy="59" r="2.8"/><path class="key" d="M21.3 59H40M36 59V62M39 59V61.5"/>',
      t >= 2 ? '<rect class="mf" x="13.4" y="30" width="3.2" height="5" rx="1"/><rect class="mf" x="47.4" y="30" width="3.2" height="5" rx="1"/>' : "",
      t >= 4 ? [[17, 26, -60], [21, 20.5, -35], [27, 17.6, -12], [37, 17.6, 12], [43, 20.5, 35], [47, 26, 60]].map(([x, y, angle]) => rfLeaf(x, y, angle, 2.8)).join("") + rfFlower(32, 15.6, 2.4) : "",
      t === 5 ? `${[[10, 12], [54, 10], [57, 44]].map(([x, y]) => rfLeaf(x, y, 30, 2, "petal-fall")).join("")}${rfSparks([[6, 20, 2.4], [59, 22, 2]])}` : "",
    ].join(""),
  }) },
  // 退ける: 止まれの八角形。×の棒 → 鉄格子 → 槍先 → 霜と氷の粒 → 雪の結晶が囲み、冷たく光る。
  tribute_mgr_deny: { plate: "octagon", draw: (t) => ({
    back: [
      t === 1 ? '<path class="bar" d="M11 14L53 56M53 14L11 56"/>' : "",
      t >= 2 ? '<path class="bar" d="M9 11V59M15.5 9V61M48.5 9V61M55 11V59"/>' : "",
      t >= 3 ? [9, 15.5, 48.5, 55].map((x) => `<path class="mf" d="M${x - 2.2} ${x === 9 || x === 55 ? 11.6 : 9.6}L${x} ${x === 9 || x === 55 ? 6.6 : 4.6}L${x + 2.2} ${x === 9 || x === 55 ? 11.6 : 9.6}Z"/>`).join("") : "",
    ].join(""),
    front: [
      t >= 4 ? [[9, 33, 2.6], [55, 33, 2.6], [32, 59, 2.4]].map(([x, y, size]) => rfSnowflake(x, y, size)).join("") : "",
      t === 5 ? `${[[32, 9.5, 3.2], [8, 52, 2.8], [56, 52, 2.8], [6, 18, 2.4], [58, 18, 2.4]].map(([x, y, size]) => rfSnowflake(x, y, size)).join("")}${rfSparks([[20, 6, 1.8], [44, 62, 1.6]])}` : "",
    ].join(""),
  }) },
  // 復唱: 声の波が1本ずつ増え、音符が出て、最後は金の音符が囲む。
  tribute_mgr_recite: { plate: "circle", draw: (t) => {
    const arcs = Array.from({ length: Math.min(t, 3) }, (_, index) => {
      const radius = 21 + index * 4;
      return rfArc(radius, 148, 212, "wave", 0) + rfArc(radius, 32, -32, "wave", 1);
    }).join("");
    const notes = t >= 3 ? [[50, 15, 1], ...(t >= 4 ? [[12, 17, 0.9], [50, 59, 0.85]] : []), ...(t === 5 ? [[14, 58, 0.85], [32, 8, 0.9], [59, 38, 0.75]] : [])].map(([x, y, size]) => rfNote(x, y, size)).join("") : "";
    return { back: arcs, front: `${notes}${t === 5 ? rfSparks([[5, 30, 2.2], [40, 4, 1.8]]) : ""}` };
  } },
  // 出稼ぎ: 荷車の車輪。輻が増え、留め金、ランタン、朝日の光、金の車輪が光る。
  tribute_mgr_work: { plate: "circle", draw: (t) => {
    const spokes = rfAround(t === 1 ? 6 : 8, 25, 90, (x, y, angle) => `<path class="spoke" d="M${rfPoint(angle, 17.5).join(" ")}L${x} ${y}"/>`);
    return {
      back: [
        t >= 4 ? rfAround(12, 30.5, 7.5, (x, y, angle) => (angle > 0 && angle < 180 ? `<path class="ray" d="M${rfPoint(angle, 27.5).join(" ")}L${x} ${y}"/>` : "")) : "",
        `${spokes}<circle class="rim" cx="32" cy="35" r="25.4"/>`,
      ].join(""),
      front: [
        t >= 2 ? rfAround(8, 21.4, 112.5, (x, y) => `<circle class="bolt" cx="${x}" cy="${y}" r="1.2"/>`) : "",
        t >= 3 ? '<path class="m" d="M55 2.5V7"/><rect class="lantern-body" x="52" y="7" width="6" height="8.2" rx="1.6"/><circle class="lantern" cx="55" cy="11.1" r="1.6"/>' : "",
        t === 5 ? rfSparks([[6, 8, 2.6], [8, 60, 2], [58, 58, 2.2]]) : "",
      ].join(""),
    };
  } },
  // 盤上: オセロ盤の地。四隅から石が増え、縁が金になり、最後は全部の石が金に返る。
  tribute_mgr_othello: { plate: "board", draw: (t) => {
    const spots = [[9, 12], [55, 12], [9, 58], [55, 58], [32, 9.5], [32, 60.5], [7.5, 35], [56.5, 35], [20, 8], [44, 8], [20, 62], [44, 62]];
    const count = [2, 4, 8, 12, 12][t - 1];
    const stones = spots.slice(0, count).map(([x, y], index) => {
      const kind = t === 5 ? "is-gold" : t === 4 && index % 2 ? "is-gold" : index % 2 ? "is-white" : "is-black";
      return `<circle class="stone ${kind}" cx="${x}" cy="${y}" r="3.3"/>`;
    }).join("");
    return { back: "", front: `${stones}${t === 5 ? rfSparks([[21, 3.5, 1.8], [62, 24, 1.8]]) : ""}` };
  } },
  // 首輪: 革の首輪と留め金 → 鋲 → 名札 → 金の鋲とハートの名札 → 宝石と鎖。
  tribute_mgr_collar: { plate: "circle", draw: (t) => ({
    back: '<circle class="collar-band" cx="32" cy="35" r="21.2"/>',
    front: [
      '<rect class="buckle" x="26.5" y="10.5" width="11" height="7.5" rx="1.4"/><path class="buckle-pin" d="M32 10.5V18"/>',
      t >= 2 ? rfAround(10, 21.2, 126, (x, y, angle) => (angle > 70 && angle < 110 ? "" : `<circle class="${t === 5 && Math.round(angle / 36) % 2 ? "gem-b" : t === 5 ? "gem-a" : "stud"}" cx="${x}" cy="${y}" r="${t === 5 ? 1.5 : 1.3}"/>`)) : "",
      t >= 3 ? `<circle class="mf" cx="32" cy="57" r="1.4"/>${t >= 4 ? rfHeart(32, 61.5, 10, "tag") : '<circle class="tag" cx="32" cy="61" r="3.6"/>'}` : "",
      t === 5 ? `${[[41, 59], [45, 61], [49, 62], [53, 61.5], [57, 59.5]].map(([x, y]) => `<circle class="chain-link" cx="${x}" cy="${y}" r="1.5"/>`).join("")}${rfSparks([[7, 9, 2.4], [58, 12, 2]])}` : "",
    ].join(""),
  }) },
  // 牧場: 丘の景色。柵 → 風車 → サイロ → 虹とお城の塔（牧場の施設と同じもの）。
  tribute_mgr_ranch: { plate: "circle", draw: (t) => ({
    back: [
      t === 5 ? ["rainbow-1", "rainbow-2", "rainbow-3"].map((cls, index) => rfArc(29.5 - index * 2.6, 168, 12, cls, 1)).join("") : "",
      t === 5 ? '<path class="tower" d="M27 15V3H29V5H31V3H33V5H35V3H37V15Z"/><path class="tower-roof" d="M26 3L32 -3L38 3Z"/>' : "",
      t >= 3 ? '<path class="mill" d="M8.5 56L10 33H14.4L16 56Z"/><path class="mill-blade" d="M5 26L19.5 40M19.5 26L5 40"/>' : "",
      t >= 4 ? '<rect class="silo" x="49" y="32" width="8" height="24" rx="1"/><path class="silo-roof" d="M49 32Q53 25 57 32Z"/>' : "",
      '<path class="grass" d="M2 58Q32 47 62 58V63H2Z"/>',
    ].join(""),
    front: [
      t >= 2 ? '<path class="fence" d="M7 57.5H57M7 60.5H57M10 55V62M18 54V62M26 53.4V62M38 53.4V62M46 54V62M54 55V62"/>' : "",
      t === 5 ? rfSparks([[5, 8, 2.4], [59, 10, 2.2]]) : "",
    ].join(""),
  }) },
  // なでる: ハートの地。小さなハート → なでる手 → ハートの輪 → 光るハートの輪。
  tribute_mgr_pat: { plate: "heart", draw: (t) => ({
    back: t >= 4 ? rfAround(6, 27, 90, (x, y) => rfHeart(x, y, t === 5 ? 9 : 7.5, "heart-small")) : "",
    front: [
      t >= 2 && t < 4 ? rfHeart(52, 13, 9, "heart-small") : "",
      t >= 3 ? '<path class="hand" d="M4 22Q4 15 10 14.5L19 13.5Q21.5 13.3 21.3 15.4Q21 17 18.6 17.2L14.5 17.6L20.8 17.4Q23.2 17.4 23 19.4Q22.8 21.2 20.4 21.2L13 21.6Q8 25 4 22Z"/>' : "",
      t === 5 ? rfSparks([[58, 30, 2.2], [8, 52, 2], [50, 60, 1.8]]) : "",
    ].join(""),
  }) },
  // 財布の献上: 硬貨の地。硬貨が1枚 → 積み → 両側 → 輪 → 宝石と光。
  tribute_wallet: { plate: "coin", draw: (t) => {
    const piles = [[[51, 54, 4.6]], [[51, 56, 4.6], [53, 51, 4.6], [50, 46.5, 4.6]], [[51, 56, 4.6], [53, 51, 4.6], [13, 56, 4.6], [11, 51, 4.6]]];
    const coins = t <= 3 ? piles[t - 1].map(([x, y, r]) => rfCoin(x, y, r)).join("") : rfAround(10, 25, 90, (x, y) => rfCoin(x, y, 3.8));
    return { back: t >= 4 ? coins : "", front: `${t <= 3 ? coins : ""}${t === 5 ? `${rfAround(5, 29.4, 108, (x, y, angle, index) => `<path class="${index % 2 ? "gem-b" : "gem-a"}" d="M${x} ${y - 2.4}L${x + 2} ${y}L${x} ${y + 2.4}L${x - 2} ${y}Z"/>`)}${rfSparks([[6, 8, 2.4], [58, 60, 2]])}` : ""}` };
  } },
  // 自分から: 贈り物の箱。蝶結び → 垂れ → 小箱 → もう1つと紙吹雪 → 金のリボンと光。
  tribute_wal_silent: { plate: "square", draw: (t) => ({
    back: t >= 2 ? '<path class="ribbon" d="M29.5 17.5V52.5H34.5V17.5Z"/>' : "",
    front: [
      `<path class="bow" d="M32 17Q24 8 21 12.5Q19 17 32 17Q45 17 43 12.5Q40 8 32 17Z"/><circle class="bow-knot" cx="32" cy="16.6" r="${t >= 2 ? 2.4 : 1.8}"/>`,
      t >= 3 ? '<rect class="gift-small" x="3.5" y="49" width="10" height="9" rx="1.5"/><path class="ribbon-line" d="M8.5 49V58"/>' : "",
      t >= 4 ? `<rect class="gift-small" x="50.5" y="50" width="10" height="9" rx="1.5"/><path class="ribbon-line" d="M55.5 50V59"/>${[[8, 12], [56, 14], [58, 36]].map(([x, y], index) => `<rect class="confetti${index % 2 ? " is-b" : ""}" x="${x}" y="${y}" width="2.6" height="1.4" transform="rotate(${30 * (index + 1)} ${x} ${y})"/>`).join("")}` : "",
      t === 5 ? rfSparks([[6, 30, 2.4], [58, 26, 2], [32, 61, 1.8]]) : "",
    ].join(""),
  }) },
  // 請求に応える: 切手のような縁。「済」の印が1つずつ増え、最後は領収の紙が扇に開く。
  tribute_wal_request: { plate: "stamp", draw: (t) => {
    const seals = [[50, 54], [14, 17], [50, 16]].slice(0, Math.max(0, t - 1)).map(([x, y]) => `<circle class="paid-seal" cx="${x}" cy="${y}" r="6"/><text class="paid-text" x="${x}" y="${y + 0.4}" text-anchor="middle" dominant-baseline="central">済</text>`).join("");
    return {
      back: t === 5 ? [-24, 0, 24].map((angle) => `<rect class="sheet" x="20" y="10" width="24" height="34" rx="1.5" transform="rotate(${angle} 32 46)"/>`).join("") : "",
      front: `${seals}${t === 5 ? rfSparks([[6, 40, 2.2], [58, 34, 2]]) : ""}`,
    };
  } },
  // 抵抗: 縄。ほつれた縄 → 一周 → 結び目 → 結び目が3つ → 金の組紐と房。
  tribute_wal_resist: { plate: "circle", draw: (t) => {
    const rope = t === 1
      ? `${rfArc(22, 150, 390, "rope", 1)}${rfArc(22, 150, 390, "rope-twist", 1)}<path class="rope-fray" d="M12.5 23.5L9 21M12.5 23.5L10 26.5M13.3 22L11.5 18.5"/>`
      : `<circle class="rope" cx="32" cy="35" r="22"/><circle class="rope-twist" cx="32" cy="35" r="22"/>${rfAround(4, 22, 45, (x, y, angle) => `<rect class="rope-band" x="${(x - 1.3).toFixed(2)}" y="${(y - 2.6).toFixed(2)}" width="2.6" height="5.2" rx="0.8" transform="rotate(${(-angle).toFixed(1)} ${x} ${y})"/>`)}`;
    const knots = t >= 3 ? (t >= 4 ? [210, 270, 330] : [270]).map((angle) => {
      const [x, y] = rfPoint(angle, 22);
      return `<circle class="knot" cx="${x}" cy="${y}" r="3.4"/><path class="knot-line" d="M${x - 2.2} ${y - 1}Q${x} ${y + 1.8} ${x + 2.2} ${y - 1}"/>`;
    }).join("") : "";
    return {
      back: rope,
      front: `${knots}${t === 5 ? `<path class="tassel" d="M22 56L19 63H25ZM42 56L39 63H45Z"/><circle class="knot" cx="22" cy="55.5" r="2"/><circle class="knot" cx="42" cy="55.5" r="2"/>${rfSparks([[7, 9, 2.4], [57, 9, 2.2]])}` : ""}`,
    };
  } },
  // 許された: 開いた錠前。鍵 → リボン → 角の花 → 宝石の錠と2本の鍵。
  tribute_wal_granted: { plate: "lock", draw: (t) => ({
    back: "",
    front: [
      t >= 2 ? '<circle class="key-bow" cx="55" cy="47" r="2.7"/><path class="key" d="M55 49.7V62M55 57H58M55 60H57.5"/>' : "",
      t === 5 ? '<circle class="key-bow" cx="9" cy="47" r="2.7"/><path class="key" d="M9 49.7V62M9 57H6M9 60H6.5"/>' : "",
      t >= 3 ? '<path class="bow" d="M40 18.5Q35 12 33 15Q32 18.5 40 18.5Q48 18.5 47 15Q45 12 40 18.5Z"/><circle class="bow-knot" cx="40" cy="18.3" r="1.7"/>' : "",
      t >= 4 ? `${rfFlower(18, 28, 2.4)}${rfFlower(46, 50, 2.4)}` : "",
      t === 5 ? `<path class="gem-a" d="M18 49.6L20 52L18 54.4L16 52Z"/><path class="gem-b" d="M46 25.6L48 28L46 30.4L44 28Z"/>${rfSparks([[6, 12, 2.4], [58, 10, 2]])}` : "",
    ].join(""),
  }) },
  // 退けられた: 茨。小枝 → 半分 → 一周 → つぼみ → 薔薇が咲き、花びらが舞う（突き放されて咲く）。
  tribute_wal_denied: { plate: "circle", draw: (t) => {
    const span = [[230, 310], [180, 360], [0, 360], [0, 360], [0, 360]][t - 1];
    const vine = span[1] - span[0] >= 360 ? '<circle class="vine" cx="32" cy="35" r="22.4"/>' : rfArc(22.4, span[0], span[1], "vine", 0);
    const thornCount = [3, 6, 12, 12, 12][t - 1];
    const thorns = Array.from({ length: thornCount }, (_, index) => {
      const angle = span[0] + ((span[1] - span[0]) / thornCount) * (index + 0.5);
      const [x1, y1] = rfPoint(angle - 3, 23.6);
      const [x2, y2] = rfPoint(angle, 27.4);
      const [x3, y3] = rfPoint(angle + 3, 23.6);
      return `<path class="thorn" d="M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}Z"/>`;
    }).join("");
    const buds = t === 4 ? [90, 210, 330].map((angle) => {
      const [x, y] = rfPoint(angle, 22.4);
      return `<ellipse class="bud" cx="${x}" cy="${y}" rx="2.2" ry="3" transform="rotate(${-angle + 90} ${x} ${y})"/>`;
    }).join("") : "";
    const roses = t === 5 ? rfAround(5, 22.4, 90, (x, y) => rfRose(x, y, 3.6)) + [[8, 8], [58, 60], [56, 6]].map(([x, y]) => rfLeaf(x, y, 40, 2, "petal-fall")).join("") + rfSparks([[6, 60, 2]]) : "";
    return { back: `${vine}${thorns}`, front: `${buds}${roses}` };
  } },
  // 言葉: 手紙。封蝋 → もう1通 → 羽根ペン → 束ねたリボンと金の封蝋。
  tribute_wal_words: { plate: "envelope", draw: (t) => ({
    back: [
      t >= 3 ? '<rect class="sheet" x="12.5" y="21" width="39" height="29" rx="3" transform="rotate(-10 32 35)"/>' : "",
      t === 5 ? '<rect class="sheet" x="12.5" y="21" width="39" height="29" rx="3" transform="rotate(9 32 35)"/>' : "",
      t >= 4 ? '<path class="quill" d="M61 3Q50 10 44 21L46.4 22.6Q54.5 13 61 3Z"/><path class="quill-vein" d="M60 4.4L45.2 21.8"/>' : "",
    ].join(""),
    front: [
      t >= 2 ? `<circle class="${t === 5 ? "wax-seal is-gold" : "wax-seal"}" cx="46" cy="47" r="4.4"/>` : "",
      t === 5 ? `<path class="ribbon" d="M10 37H54V40.5H10Z"/><path class="bow" d="M32 38.8Q25 32 23 35Q22 39 32 38.8Q42 39 41 35Q39 32 32 38.8Z"/>${rfSparks([[6, 12, 2.4], [58, 58, 2]])}` : "",
    ].join(""),
  }) },
  // 復唱（財布）: 巻物。習字の線 → 筆 → 房 → 金の軸と墨の光。
  tribute_wal_recite: { plate: "scroll", draw: (t) => ({
    back: t >= 3 ? '<path class="brush" d="M60 4L50 18"/><path class="brush-tip" d="M50 18Q47 23 48.5 26Q51.5 23.5 52.2 19.4Z"/>' : "",
    front: [
      t >= 2 ? '<path class="ink" d="M21.5 45.5H42.5M21.5 48.5H36"/>' : "",
      t >= 4 ? '<path class="tassel" d="M14.75 52V57M49.25 52V57"/><path class="tassel" d="M12.8 57L14.75 63L16.7 57ZM47.3 57L49.25 63L51.2 57Z"/>' : "",
      t === 5 ? rfSparks([[6, 10, 2.4], [58, 40, 1.8], [36, 6, 1.6]]) : "",
    ].join(""),
  }) },
  // 出稼ぎ（財布）: 籠。干し草 → 熊手 → 干し草の束 → 金の籠と朝日。
  tribute_wal_work: { plate: "circle", draw: (t) => ({
    back: [
      t === 5 ? rfAround(10, 30.5, 9, (x, y, angle) => (angle > 0 && angle < 180 ? `<path class="ray" d="M${rfPoint(angle, 26.5).join(" ")}L${x} ${y}"/>` : "")) : "",
      t >= 3 ? '<path class="fork" d="M58 4L44 30"/><path class="fork" d="M55.5 2.3L61.8 5.7M55.5 2.3L54 6.5M58.6 4L57.2 8.2M61.8 5.7L60.4 9.9"/>' : "",
    ].join(""),
    front: [
      t >= 2 ? '<path class="hay" d="M20 50Q22 44 25 49M27 49Q30 42 33 49M35 49Q38 43 41 50M24 50Q26 45 29 50"/>' : "",
      '<path class="basket" d="M17 50H47L43.5 62H20.5Z"/><path class="basket-weave" d="M18.2 54H45.8M19.3 58H44.7M25 50L26 62M32 50V62M39 50L38 62"/>',
      t >= 4 ? '<rect class="bale" x="2.5" y="50" width="12" height="9" rx="2.5"/><path class="bale-line" d="M6.5 50V59M10.5 50V59"/>' : "",
      t === 5 ? rfSparks([[6, 30, 2.2], [60, 46, 2]]) : "",
    ].join(""),
  }) },
  // 盤上（財布）: 石が1つ → 3つ → 白黒の輪 → 金の硬貨に変わる石 → 石から芽が出て花が咲く（盤上の養分）。
  tribute_wal_othello: { plate: "circle", draw: (t) => {
    if (t <= 2) {
      const stones = (t === 1 ? [[51, 54, "is-black"]] : [[51, 54, "is-black"], [55, 47, "is-white"], [13, 54, "is-black"]]).map(([x, y, kind]) => `<circle class="stone ${kind}" cx="${x}" cy="${y}" r="3.6"/>`).join("");
      return { back: "", front: stones };
    }
    const ring = rfAround(8, 24.5, 90, (x, y, angle, index) => {
      const kind = t >= 4 && index % 3 === 0 ? "is-gold" : index % 2 ? "is-white" : "is-black";
      const sprout = t === 5 ? `<path class="sprout" d="M${x} ${y - 3.2}V${y - 6.4}"/>${rfLeaf(x - 1.6, y - 6, -30, 1.8)}${rfLeaf(x + 1.6, y - 6.6, 30, 1.8)}` : "";
      return `<circle class="stone ${kind}" cx="${x}" cy="${y}" r="3.5"/>${sprout}`;
    });
    return { back: "", front: `${ring}${t === 5 ? rfFlower(32, 4.5, 2.2) + rfSparks([[6, 8, 2.2], [58, 60, 2]]) : ""}` };
  } },
  // なつき: 動物に付く飾りそのもの。鈴 → リボン → 花かんむり → 金の王冠（花かんむりの代わり）。
  tribute_wal_fondness: { plate: "circle", draw: (t) => ({
    back: "",
    front: [
      rfArc(19.2, 205, 335, "fond-collar", 0),
      '<path class="bell" d="M28.2 59Q28 52.6 32 52.4Q36 52.6 35.8 59Z"/><circle class="bell-clapper" cx="32" cy="59.6" r="1.1"/>',
      t >= 3 ? '<path class="bow is-pink" d="M47 17.5Q41 11 39 14.5Q38.5 18.5 47 17.5Q55.5 18.5 55 14.5Q53 11 47 17.5Z"/><circle class="bow-knot is-pink" cx="47" cy="17.3" r="1.8"/>' : "",
      t === 4 ? rfAround(7, 21, 30, (x, y, angle) => (angle <= 150 ? rfFlower(x, y, 2.6, angle % 40 ? "petal" : "petal is-b") : "")) : "",
      t === 5 ? '<path class="royal-crown" d="M20 16L18 4L25 9.5L32 1.5L39 9.5L46 4L44 16Z"/><path class="royal-band" d="M20 14.6H44V18H20Z"/><circle class="gem-a" cx="32" cy="16.3" r="1.5"/><circle class="gem-b" cx="25" cy="16.3" r="1.1"/><circle class="gem-b" cx="39" cy="16.3" r="1.1"/>' + rfSparks([[8, 8, 2.4], [57, 7, 2.2], [58, 54, 1.8]]) : "",
    ].join(""),
  }) },
  // なでられた: 足あと。1つ → ハート → 2つ → 足あとの輪 → ハートと足あとの輪が光る。
  tribute_wal_patted: { plate: "circle", draw: (t) => ({
    back: "",
    front: t >= 4
      ? rfAround(t === 5 ? 8 : 6, 24.5, 90, (x, y) => rfPaw(x, y + 1, 0.62)) + (t === 5 ? [[6.5, 9], [57.5, 9], [6.5, 61], [57.5, 61]].map(([x, y]) => rfHeart(x, y, 7.5, "heart-small")).join("") + rfSparks([[32, 3.5, 2.2], [3, 35, 1.8]]) : "")
      : `${rfPaw(51, 56, 0.7)}${t >= 2 ? rfHeart(13, 17, 8, "heart-small") : ""}${t >= 3 ? rfPaw(13, 56, 0.7) : ""}`,
  }) },
});

// シークレットの封蝋の色（系統ごとに違う色）。
const RF_SECRET_TONES = Object.freeze({
  tribute_secret_resist3: "crimson",
  tribute_secret_both: "indigo",
  tribute_secret_second_plea: "emerald",
  tribute_secret_moo: "amber",
  tribute_secret_mood: "violet",
  tribute_secret_ignored_paid: "midnight",
  tribute_secret_named: "rose",
});

function ranchAchievementFrame({ family = "", icon = "", tier = 1, side = "manager", secret = false, locked = false } = {}) {
  const sideClass = side === "wallet" ? "wallet" : "manager";
  if (secret) {
    const tone = RF_SECRET_TONES[family] || "crimson";
    return `<svg class="tribute-ach-frame is-${sideClass} is-secret is-tone-${tone}${locked ? " is-locked" : ""}" viewBox="0 0 64 64" aria-hidden="true"><path class="wax" d="${RF_WAX}"/><circle class="wax-ring" cx="32" cy="35" r="15"/><text class="glyph" x="32" y="35.5" text-anchor="middle" dominant-baseline="central">${escapeHtml(locked ? "?" : icon)}</text></svg>`;
  }
  const spec = RF_FAMILIES[family] || RF_FAMILIES.tribute_manager;
  const plate = RF_PLATES[spec.plate] || RF_PLATES.circle;
  const level = Math.min(5, Math.max(1, Math.floor(Number(tier) || 1)));
  const { back = "", front = "" } = spec.draw(level);
  const glyph = `<text class="glyph" x="32" y="${plate.glyph + 0.5}" text-anchor="middle" dominant-baseline="central">${escapeHtml(locked ? "?" : icon)}</text>`;
  return `<svg class="tribute-ach-frame is-${sideClass} is-lv-${level} is-${family.replaceAll("_", "-")}${locked ? " is-locked" : ""}" viewBox="0 0 64 64" aria-hidden="true">${back}${plate.svg}${front}${glyph}</svg>`;
}

// 枠の見本（?tributePreview=achievement-frames）。系統ごとに、すべての段階の枠と名前を並べる。
function renderAchievementFrameGallery() {
  const catalog = window.HariaiAchievements?.catalog || [];
  const existing = ["tribute_manager", "tribute_wallet"].map((family) => {
    const levels = catalog.filter((definition) => definition.family === family).sort((a, b) => a.level - b.level);
    return levels.length ? { family, side: family === "tribute_manager" ? "manager" : "wallet", icon: levels[0].icon, label: levels[0].familyLabel, names: levels.map((definition) => definition.name), thresholds: levels.map((definition) => definition.target) } : null;
  }).filter(Boolean);
  const families = [...existing, ...RANCH_ACHIEVEMENT_FAMILIES];
  const row = (entry) => `<div class="tribute-ach-gallery-row"><h4>${escapeHtml(entry.label)}<small>${escapeHtml(entry.icon)}・${entry.names.length}段階</small></h4><div class="tribute-ach-gallery-levels">${entry.names.map((name, index) => {
    const tier = ranchAchievementTier(index + 1, entry.names.length);
    return `<figure class="tribute-ach-gallery-cell">${ranchAchievementFrame({ family: entry.family, icon: entry.icon, tier, side: entry.side })}<figcaption><b>Lv.${index + 1}</b>${escapeHtml(name)}</figcaption></figure>`;
  }).join("")}</div></div>`;
  const side = (key, title) => `<div class="tribute-ach-gallery-side"><h3>${title}</h3>${families.filter((entry) => entry.side === key).map(row).join("")}
    <div class="tribute-ach-gallery-row"><h4>シークレット<small>封蝋</small></h4><div class="tribute-ach-gallery-levels">${RANCH_ACHIEVEMENT_SECRETS.filter((entry) => entry.side === key).map((entry) => `<figure class="tribute-ach-gallery-cell">${ranchAchievementFrame({ family: entry.id, icon: entry.icon, side: entry.side, secret: true })}<figcaption><b>SECRET</b>${escapeHtml(entry.name)}</figcaption></figure>`).join("")}</div></div></div>`;
  return `<section class="tribute-panel tribute-ach-gallery" aria-label="牧場の実績の枠">
    <h2>牧場の実績の枠 <small>見本</small></h2>
    <p class="tribute-note">系統ごとに形と飾りが違い、段階が上がるほど飾りが増えて、縁が 木・革 → 銅 → 銀 → 金 → 金と光 になります。シークレットは色の違う封蝋です。</p>
    ${side("manager", "管理人（貢がせ側）")}
    ${side("wallet", "財布（貢ぐ側）")}
  </section>`;
}

// 牧場の実績（設計書17）。管理人の型・財布の型（今の2つの記録を含む）とシークレットを、系統ごとの枠で並べる。
// 数は額ではなく回数や日数。見つけていないシークレットは、条件を隠して「？？？」の封蝋にする。
function renderAchievementPanel() {
  const catalog = window.HariaiAchievements?.catalog;
  if (!state.achievements || !Array.isArray(catalog)) return "";
  const unlocked = new Set(state.achievements.unlocked);
  const stats = state.achievements.stats || {};
  const families = [
    ...ACHIEVEMENT_SIDES.map((entry) => ({ family: entry.family, side: entry.family === "tribute_manager" ? "manager" : "wallet", stat: entry.statKey, unit: `${entry.unit}（回）` })),
    ...RANCH_ACHIEVEMENT_FAMILIES,
  ];
  const card = (entry) => {
    const levels = catalog.filter((definition) => definition.family === entry.family).sort((a, b) => a.level - b.level);
    if (!levels.length) return "";
    const current = levels.filter((definition) => unlocked.has(definition.id)).at(-1) || null;
    const counted = Math.max(0, Math.floor(Number(stats[entry.stat]) || 0));
    const maximum = levels.at(-1).level;
    return `<div class="tribute-achievement ${current ? "is-unlocked" : "is-locked"}${current?.level === maximum ? " is-final" : ""}">
      <span class="tribute-achievement-icon is-ranch-frame" aria-hidden="true">${ranchAchievementFrame({ family: entry.family, icon: levels[0].icon, tier: current ? ranchAchievementTier(current.level, maximum) : 1, side: entry.side, locked: !current })}</span>
      <span class="tribute-achievement-copy">
        <small>${escapeHtml(levels[0].familyLabel)}</small>
        <strong>${escapeHtml(current ? current.name : "未解除")}</strong>
        <em>${current ? `Lv.${current.level} / ${maximum}` : `最大Lv.${maximum}`} ・ ${escapeHtml(entry.unit)} ${counted.toLocaleString("ja-JP")}</em>
      </span>
    </div>`;
  };
  const block = (side, title, open) => {
    const list = families.filter((entry) => entry.side === side);
    const secrets = RANCH_ACHIEVEMENT_SECRETS.filter((entry) => entry.side === side);
    const found = secrets.filter((entry) => unlocked.has(entry.id));
    const started = list.filter((entry) => catalog.some((definition) => definition.family === entry.family && unlocked.has(definition.id))).length;
    const seals = secrets.map((entry) => (unlocked.has(entry.id)
      ? `<span class="tribute-achievement-secret" title="${escapeHtml(`${entry.name}：${entry.condition}`)}">${ranchAchievementFrame({ family: entry.id, icon: entry.icon, side, secret: true })}<b>${escapeHtml(entry.name)}</b></span>`
      : `<span class="tribute-achievement-secret is-locked">${ranchAchievementFrame({ family: entry.id, icon: entry.icon, side, secret: true, locked: true })}<b>？？？</b></span>`)).join("");
    return `<details class="tribute-achievement-side"${open ? " open" : ""}>
      <summary><b>${title}</b><small>${started} / ${list.length} 系統 ・ シークレット ${found.length} / ${secrets.length}</small></summary>
      <div class="tribute-achievement-grid">${list.map(card).join("")}</div>
      <div class="tribute-achievement-secrets" aria-label="${title}のシークレット">${seals}</div>
    </details>`;
  };
  const walletSide = state.contracts.some((contract) => contract.role === "payer") || Number(stats.walletPairDays) > 0;
  return `<section class="tribute-panel tribute-achievements">
    <h2>牧場の実績 <small>同じ相手とは日本時間の1日1回だけ数えます</small></h2>
    ${block("manager", "管理人の型", Boolean(state.profile?.card))}
    ${block("wallet", "財布の型", walletSide)}
    <p class="tribute-note">金額や順位ではなく、管理が続いた記録と遊び方の型です。実績は自動では公開されず、展示するかは実績コレクションで選べます。</p>
    <div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="open-achievements">実績コレクションを見る</button></div>
  </section>`;
}

// 牧場のカードに出す実績（3つまで）。実績の一覧にないものは出さない。
const CARD_ACHIEVEMENT_LIMIT = 3;

function achievementEntry(id) {
  const catalog = window.HariaiAchievements?.catalog;
  return Array.isArray(catalog) ? catalog.find((definition) => definition.id === id) || null : null;
}

function cardAchievementsMarkup(ids, extra = "") {
  const entries = (Array.isArray(ids) ? ids : []).map(achievementEntry).filter(Boolean).slice(0, CARD_ACHIEVEMENT_LIMIT);
  if (!entries.length) return "";
  return `<span class="tribute-card-achievements${extra}" aria-label="実績">${entries.map((entry) => `<span title="${escapeHtml(entry.description || entry.name)}">${cardAchievementIcon(entry)}${escapeHtml(entry.name)}</span>`).join("")}</span>`;
}

// 牧場の実績は、段階に合った枠で出す（ほかのモードの実績は、これまでどおりの丸い札）。
function cardAchievementIcon(entry) {
  if (entry.scope !== "tribute") return `<i aria-hidden="true">${escapeHtml(entry.icon)}</i>`;
  const catalog = window.HariaiAchievements?.catalog || [];
  const maximum = Math.max(1, ...catalog.filter((definition) => definition.family === entry.family).map((definition) => definition.level));
  const side = /wallet|_wal_/.test(entry.family) ? "wallet" : "manager";
  return `<i class="is-ranch-frame" aria-hidden="true">${ranchAchievementFrame({ family: entry.secret ? entry.id : entry.family, icon: entry.icon, tier: entry.secret ? 1 : ranchAchievementTier(entry.level, maximum), side, secret: entry.secret === true })}</i>`;
}

// preview: カード編集の見本（押しても開かない）。
// 貢がれ総額の今月の順位（1〜5位）の札。上の順位ほどハートが豪華になる（5位は輪郭だけ、1位は王冠と金の縁）。
const RANK_HEART_PATH = "M16 28.5 4.6 17.4C1.4 14.2 1.4 9.1 4.6 6c3.1-3 8-2.9 11 .3l.4.4.4-.4c3-3.2 7.9-3.3 11-.3 3.2 3.1 3.2 8.2 0 11.4L16 28.5Z";

function rankHeartSvg(rank) {
  const sparkle = (x, y, size) => `<path class="spark" d="M${x} ${y - size}L${x + size * 0.28} ${y - size * 0.28}L${x + size} ${y}L${x + size * 0.28} ${y + size * 0.28}L${x} ${y + size}L${x - size * 0.28} ${y + size * 0.28}L${x - size} ${y}L${x - size * 0.28} ${y - size * 0.28}Z"/>`;
  const gloss = '<ellipse class="gloss" cx="10.5" cy="10.5" rx="3.6" ry="2.4" transform="rotate(-35 10.5 10.5)"/>';
  if (rank === 5) return `<svg viewBox="0 0 32 32" aria-hidden="true"><path class="rim" d="${RANK_HEART_PATH}"/></svg>`;
  if (rank === 4) return `<svg viewBox="0 0 32 32" aria-hidden="true"><path class="fill" d="${RANK_HEART_PATH}"/></svg>`;
  if (rank === 3) return `<svg viewBox="0 0 32 32" aria-hidden="true"><path class="fill" d="${RANK_HEART_PATH}"/><path class="inner" d="${RANK_HEART_PATH}" transform="translate(16 16) scale(0.62) translate(-16 -15)"/>${gloss}</svg>`;
  if (rank === 2) return `<svg viewBox="0 0 32 32" aria-hidden="true"><path class="fill" d="${RANK_HEART_PATH}"/><path class="inner" d="${RANK_HEART_PATH}" transform="translate(16 16) scale(0.62) translate(-16 -15)"/>${gloss}${sparkle(27, 5, 3.4)}${sparkle(4, 26, 2.4)}</svg>`;
  return `<svg viewBox="0 -7 32 39" aria-hidden="true"><path class="crown" d="M8.6 4.6 7.4 -3 12 0.8 16 -5.2 20 0.8 24.6 -3 23.4 4.6Z"/><circle class="jewel" cx="16" cy="2" r="1.3"/><path class="fill" d="${RANK_HEART_PATH}"/><path class="inner" d="${RANK_HEART_PATH}" transform="translate(16 16) scale(0.62) translate(-16 -15)"/>${gloss}${sparkle(28, 9, 3.8)}${sparkle(3.5, 25, 2.8)}${sparkle(28.5, 25.5, 2)}</svg>`;
}

function rankHeart(rank, extra = "") {
  const value = Number(rank) || 0;
  if (value < 1 || value > GROSS_RANKING.badgeTop) return "";
  return `<span class="tribute-rank-heart is-rank-${value}${extra}" title="貢がれ総額 今月${value}位">${rankHeartSvg(value)}<b>${value}位</b></span>`;
}

function renderManagerCard(card, { compact = false, preview = false } = {}) {
  const face = preview
    ? `<div class="tribute-card-face"${frameAttr(card.frame, card.frameColor)}>`
    : `<button type="button" class="tribute-card-face" data-t="open-manager" data-id="${escapeHtml(card.publicManagerId)}"${frameAttr(card.frame, card.frameColor)}>`;
  return `<article class="tribute-card${compact ? " is-compact" : ""}" style="--sigil:${sigilColor(card)}">
    ${face}
      <span class="tribute-card-head">${sigil(card, compact ? "" : "is-card")}<span><strong>${escapeHtml(card.personaName)}</strong><span class="tribute-card-tags">${rankHeart(card.grossRank)}${disclosureTag(card.disclosure)}${styleTag(card)}${vaultTag(card.vault)}${ranchTag(card)}${declarationTags(card)}${cardXHandle(card) ? '<span class="tribute-tag is-x" title="Xのプロフィールあり（自己申告）">X</span>' : ""}${card.mine ? '<span class="tribute-tag is-mine">あなた</span>' : ""}</span></span></span>
      ${cardAchievementsMarkup(card.achievements)}
      ${wordBubble(card.word)}
      ${compact ? "" : `<span class="tribute-card-intro">${escapeHtml(card.intro || "（紹介文なし）")}</span>`}
      <span class="tribute-card-meta"><span>入場料 <b>${escapeHtml(formatPay(card.entryFee))}</b></span><span>管理中 <b>${Number(card.activeContracts || 0)}</b></span>${cardActivityLabel(card) ? `<span>動き <b>${escapeHtml(cardActivityLabel(card))}</b></span>` : ""}</span>
    ${preview ? "</div>" : "</button>"}
  </article>`;
}

// 管理の型の札。選び直す前のカード（型なし）には出さない。
function styleTag(card) {
  const label = stylesLabel(card);
  return label ? `<span class="tribute-tag is-style">${escapeHtml(label)}</span>` : "";
}

// 2026-10-27 に管理の型を5つにした時、それまでの型は解除した。カードがあって型がない管理人に、選び直しを頼む。
function needsStyles(profile) {
  return Boolean(profile?.card) && normalizeStyles(profile.card.styles).length === 0;
}

function styleReselectNotice(profile) {
  return needsStyles(profile)
    ? `<p class="tribute-form-hint is-alert">管理の型が新しくなりました（${MANAGER_STYLES.length}つから${MAX_MANAGER_STYLES}つまで）。カードを編集して選び直してください。選ぶまで、カードに型の札は出ません。</p>`
    : "";
}

function renderBoard() {
  const board = state.board;
  // 入場料0のみ・管理の型: 読み込んだ掲示板を画面の上で絞る（入場料0は、Payが0の財布でも受理される管理人）。
  const managers = board.managers
    .filter((card) => !board.feeZeroOnly || !Number(card.entryFee))
    .filter((card) => !board.style || normalizeStyles(card.styles).includes(board.style));
  const emptyText = board.style
    ? `「${STYLE_LABELS[board.style] || ""}」の管理人は、いま受付していません。型を「すべて」にすると、ほかの管理人も見られます。`
    : board.feeZeroOnly
      ? "入場料0の管理人は、いま受付していません。「入場料0のみ」を外すと、ほかの管理人も見られます。"
      : board.nekamaOnly ? "ネカマ開示の管理人は、いま受付していません。" : "いま受付中の管理人はいません。";
  const body = board.status === "loading" && !board.managers.length
    ? `<p class="tribute-empty">掲示板を読み込んでいます…</p>`
    : board.status === "error"
      ? `<p class="tribute-empty">掲示板を読み込めませんでした。<button class="button button-ghost button-small" type="button" data-t="reload-board">再読み込み</button></p>`
      : managers.length
        ? `<div class="tribute-card-grid">${managers.map((card) => renderManagerCard(card)).join("")}</div>`
        : `<p class="tribute-empty">${emptyText}</p>`;
  return frame(`<div class="tribute-board">
    <div class="tribute-board-tools">
      <label class="tribute-switch"><input type="checkbox" data-t="toggle-nekama" ${board.nekamaOnly ? "checked" : ""} /><span>ネカマ開示のみ</span></label>
      <label class="tribute-switch"><input type="checkbox" data-t="toggle-fee-zero" ${board.feeZeroOnly ? "checked" : ""} /><span>入場料0のみ</span></label>
      <label class="tribute-board-style"><span>管理の型</span><select data-t="board-style"><option value="">すべて</option>${MANAGER_STYLES.map((style) => `<option value="${style.id}" ${board.style === style.id ? "selected" : ""}>${escapeHtml(style.label)}</option>`).join("")}</select></label>
      <small>性別で絞る機能はありません。中の人の札は、分かって渡すための札です。</small>
      ${isNewWallet() ? '<button class="tribute-link" type="button" data-t="open-demo">初めてなら、見本の契約を見学できます</button>' : ""}
    </div>
    <section><h2 class="tribute-section-title">受付中の管理人</h2>${body}</section>
  </div>`, { title: "掲示板" });
}

// 番付の行。財布どうしに見せるのは仕えた日数と首輪番号だけで、額は管理人本人の欄にだけ出す（設計書15.1）。
function rankingValue(row) {
  if (Number(row.days) > 0) return `${Number(row.days)}日`;
  if (Number.isFinite(Number(row.amount)) && row.amount !== undefined) return formatPay(row.amount);
  return Number(row.collarNo) > 0 ? `${Number(row.collarNo)}号` : "";
}

function renderRankingRows(rows, emptyText) {
  if (!rows?.length) return `<p class="tribute-empty">${escapeHtml(emptyText)}</p>`;
  return `<ol class="tribute-rank-list">${rows.map((row) => `<li class="${row.mine ? "is-mine" : ""}"><b>${row.rank}</b><span>${escapeHtml(row.walletName)}</span><em>${escapeHtml(rankingValue(row))}</em></li>`).join("")}</ol>`;
}

function renderManagerDetail() {
  const entry = state.manager;
  if (entry.status === "loading" || !entry.data) {
    return frame(`<p class="tribute-empty">${entry.status === "error" ? "この管理人を開けませんでした。" : "管理人カードを開いています…"}</p>`, { title: "管理人" });
  }
  const { card, month, openContractId, myTotal, ranking, cheers, myCheer } = entry.data;
  const welcome = entry.invited && !card.mine
    ? `<div class="tribute-invite-welcome" role="note"><b>${escapeHtml(card.personaName)}の招待で来ました</b><span>初めてなら、見本の契約で流れを見てから「お試しの設定」で申し込めます。限度額と解約は、いつでも自分で設定できます（管理人には見えません）。</span><button class="button button-ghost button-small" type="button" data-t="open-demo">見学する</button></div>`
    : "";
  const action = card.mine
    ? `<p class="tribute-note">あなたの管理人カードです。</p>`
    : openContractId
      ? `<button class="button button-primary" type="button" data-t="open-thread" data-contract="${escapeHtml(openContractId)}">契約のスレッドを開く</button>`
      : card.accepting
        ? state.applyPrefill?.publicManagerId === card.publicManagerId
          ? `<button class="button button-primary" type="button" data-t="open-apply">同じ条件で申し込む</button><small class="tribute-note">前の契約と同じ設定で、申し込みの画面を開きます。</small>`
          : `<button class="button button-primary" type="button" data-t="open-apply">この管理人に申し込む</button>`
        : `<p class="tribute-note">この管理人は受付を止めています。</p>`;
  return frame(`<div class="tribute-manager-detail">
    ${welcome}
    <section class="tribute-panel tribute-profile" style="--sigil:${sigilColor(card)}"${frameAttr(card.frame, card.frameColor)}>
      <div class="tribute-profile-head">${sigil(card, "is-large")}<div><h1>${escapeHtml(card.personaName)}</h1><div class="tribute-card-tags">${rankHeart(card.grossRank, " is-large")}${disclosureTag(card.disclosure)}${styleTag(card)}${vaultTag(card.vault)}${ranchTag(card)}${declarationTags(card)}</div></div></div>
      ${cardAchievementsMarkup(card.achievements, " is-large")}
      ${wordBubble(card.word, " is-large")}
      <p class="tribute-profile-intro">${escapeHtml(card.intro || "（紹介文なし）")}</p>
      <dl class="tribute-facts">
        <div><dt>中の人の札</dt><dd>${escapeHtml(DISCLOSURE_LABELS[card.disclosure] || "非開示")}</dd></div>
        <div><dt>入場料</dt><dd>${escapeHtml(formatPay(card.entryFee))}</dd></div>
        ${cardActivityLabel(card) ? `<div><dt>最後に動いた</dt><dd>${escapeHtml(cardActivityLabel(card))}</dd></div>` : ""}
        <div><dt>今月の財布</dt><dd>${Number(month?.payers || 0)}人</dd></div>
        <div><dt>管理中</dt><dd>${Number(card.activeContracts || 0)}件</dd></div>
        ${myTotal ? `<div><dt>あなたの献上</dt><dd>${escapeHtml(formatPay(myTotal))}</dd></div>` : ""}
      </dl>
      ${xProfileButton(card)}
      <div class="tribute-row">${action}
        ${card.mine || previewScreen ? "" : renderBlockButton({ mode: "tribute", publicManagerId: card.publicManagerId }, "この管理人をブロック")}
      </div>
    </section>
    ${renderCheers(card, cheers, myCheer)}
    <section class="tribute-panel">
      <h2>${escapeHtml(card.personaName)}の番付 <small>番付に載ることを選んだ財布だけ・額ではなく仕えた日数の順</small></h2>
      <div class="tribute-two-col">
        <div><h3>今月 <small>献上か言葉の献上をした日の数</small></h3>${renderRankingRows(ranking?.month, "今月はまだいません。")}</div>
        <div><h3>累計 <small>長く仕えている順（首輪番号）</small></h3>${renderRankingRows(ranking?.lifetime, "まだいません。")}</div>
      </div>
    </section>
    ${ranking?.amounts ? `<section class="tribute-panel tribute-amount-ranking">
      <h2>献上額の順位 <small>あなただけに見えます</small></h2>
      <div class="tribute-two-col">
        <div><h3>今月</h3>${renderRankingRows(ranking.amounts.month, "今月はまだいません。")}</div>
        <div><h3>累計</h3>${renderRankingRows(ranking.amounts.lifetime, "まだいません。")}</div>
      </div>
    </section>` : ""}
  </div>`, { title: card.personaName });
}

// 応援欄。今月この管理人に貢いだ財布だけが書け、新しい順に並ぶ（額の順にはしない。設計書15.1）。
// 管理人は「見たよ」の印を返し、隠せる。隠した応援は、管理人と書いた財布にだけ見える。
function renderCheers(card, cheers, myCheer) {
  const list = Array.isArray(cheers) ? cheers : [];
  const manager = card.mine === true;
  const rows = list.length
    ? `<ol class="tribute-cheer-list">${list.map((cheer) => `<li class="${cheer.mine ? "is-mine" : ""}${cheer.hidden ? " is-hidden" : ""}">
        <span class="tribute-cheer-name">${escapeHtml(cheer.walletName)}</span>
        <p>${escapeHtml(cheer.text)}</p>
        <small>${escapeHtml(formatDateTime(cheer.at))}${cheer.seen ? ' <b class="tribute-cheer-seen">見たよ</b>' : ""}${cheer.hidden ? (manager ? " ・ 隠しています" : " ・ 管理人が隠しています（あなたにだけ見えます）") : ""}</small>
        ${manager ? `<span class="tribute-cheer-actions">${cheer.seen || cheer.hidden ? "" : `<button class="button button-primary button-small" type="button" data-t="cheer-seen" data-cheer="${escapeHtml(cheer.cheerId)}">見たよ</button>`}<button class="tribute-link" type="button" data-t="${cheer.hidden ? "cheer-show" : "cheer-hide"}" data-cheer="${escapeHtml(cheer.cheerId)}">${cheer.hidden ? "戻す" : "隠す"}</button></span>` : ""}
      </li>`).join("")}</ol>`
    : `<p class="tribute-empty">今月の応援はまだありません。</p>`;
  const note = manager
    ? `<p class="tribute-note">今月あなたに貢いだ財布が書けます。「見たよ」を押すと、応援に印が付きます（誰にでも見えます）。隠した応援は、あなたと書いた財布にだけ見えます。</p>`
    : "";
  return `<section class="tribute-panel tribute-cheers" aria-labelledby="tributeCheersTitle">
    <h2 id="tributeCheersTitle">応援欄 <small>今月貢いだ財布だけ・新しい順</small></h2>
    ${note}
    ${manager ? "" : renderCheerForm(card, myCheer)}
    ${rows}
  </section>`;
}

function renderCheerForm(card, myCheer) {
  if (!myCheer?.canWrite) return `<p class="tribute-note">今月${escapeHtml(card.personaName)}に貢ぐと、応援欄に書けます。今月の献上額の多い順に並びます。</p>`;
  const left = Number(myCheer.leftToday || 0);
  return `<form class="tribute-word-form tribute-cheer-form" data-form="cheer">
    <div class="tribute-word-input"><input name="cheer" maxlength="${CHEER.length}" autocomplete="off" value="${escapeHtml(myCheer.text || "")}" placeholder="例：今月も一番に貢ぎます" aria-label="応援（${CHEER.length}文字まで）" ${left ? "" : "disabled"} /><button class="button button-ghost button-small" type="submit" ${left && !state.busy ? "" : "disabled"}>${myCheer.text ? "書き直す" : "書く"}</button></div>
    <small>今月の献上額の多い順に並びます。管理人が「見たよ」を返すと印が付きます。今日あと${left}回（日本時間の0時に戻ります）。連絡先・外部決済・性的な言葉は書けません。${myCheer.text ? ' <button class="tribute-link" type="button" data-t="clear-cheer">消す</button>' : ""}</small>
    <p class="tribute-form-error" data-form-error role="alert"></p>
  </form>`;
}

function renderApply() {
  const target = state.applyTarget;
  if (!target) return frame(`<p class="tribute-empty">申し込む管理人を選び直してください。</p>`, { title: "申し込み" });
  const profile = state.profile || {};
  const minPerTribute = PER_TRIBUTE_OPTIONS.find((value) => value >= target.entryFee) || PER_TRIBUTE_OPTIONS[0];
  const trial = trialCaps(target.entryFee);
  // 終わった契約の「同じ条件で申し込む」から来た時は、前の契約の設定を写す。請求は断れないことの確認と、
  // 性的な名目・スクショ掲載の許可（既定は許さない同意）は写さず、申し込みのたびに財布が選ぶ。
  const prefill = state.applyPrefill?.publicManagerId === target.publicManagerId ? state.applyPrefill : null;
  const prefillCaps = prefill?.caps && normalizeCaps(prefill.caps);
  // 初めての申し込みは、お試しの設定から始める。
  const firstTime = !prefill && isNewWallet();
  const defaults = prefillCaps && prefillCaps.perTribute >= target.entryFee
    ? prefillCaps
    : firstTime ? trial : { perTribute: Math.max(30, minPerTribute), perDay: 100, total: 300 };
  const perTribute = defaults.perTribute;
  const durationDays = DURATION_DAYS_OPTIONS.includes(Number(prefill?.durationDays)) ? Number(prefill.durationDays) : DURATION_DAYS_OPTIONS[0];
  const tone = TONE_CEILING_LABELS[prefill?.tone] ? prefill.tone : "normal";
  const checked = (key, fallback = false) => ((prefill ? prefill[key] === true : fallback) ? "checked" : "");
  // 入場料が今の財布より多いと、受理の時に払えず、管理人は受理できない（申し込みは48時間で失効する）。先に知らせる。
  const balance = state.walletBalance;
  const feeShort = target.entryFee > 0 && balance !== null && balance < target.entryFee;
  return frame(`<form class="tribute-panel tribute-apply" data-form="apply">
    <div class="tribute-apply-head">${sigil(target)}<div><span class="tribute-eyebrow">管理を申し込む</span><h1>${escapeHtml(target.personaName)}</h1>${disclosureTag(target.disclosure)}${declarationTags(target)}</div></div>
    <p class="tribute-note">${target.ignoreUnpaid ? `${escapeHtml(target.personaName)}は「未払いは既読無視」を宣言しています。` : ""}${target.postsScreenshots ? `${escapeHtml(target.personaName)}は「スクショを載せる」管理人です。` : ""}請求は断れません。払うか、解約するかです。</p>
    ${prefill ? `<p class="tribute-note tribute-prefill-note">前の契約と同じ設定にしています。変えてから申し込めます。請求は断れないことの確認と、性的な名目・スクショ掲載の許可は、もう一度選んでください。</p>` : ""}
    ${feeShort ? `<p class="tribute-fee-warning" role="status"><b>入場料 ${escapeHtml(formatPay(target.entryFee))} ／ いまの財布 ${escapeHtml(formatPay(balance))}</b>受理される時に入場料を払えないと、管理人は受理できず、申し込みは48時間で失効します。先に Pay を貯めるか、入場料0の管理人を選んでください。<button class="tribute-link" type="button" data-t="board-free">入場料0の管理人を見る</button></p>` : ""}
    <fieldset><legend>あなたの限度額（管理人には見えません・1回 ≦ 1日 ≦ 契約合計）</legend>
      <div class="tribute-three">
        <label><span>1回</span><select name="perTribute">${optionList(PER_TRIBUTE_OPTIONS, perTribute)}</select></label>
        <label><span>1日</span><select name="perDay">${optionList(PER_DAY_OPTIONS, defaults.perDay)}</select></label>
        <label><span>契約合計</span><select name="total">${optionList(TOTAL_OPTIONS, defaults.total)}</select></label>
      </div>
      <div class="tribute-trial"><button class="button button-ghost button-small" type="button" data-t="apply-trial">お試しの設定にする（${TRIAL_DURATION_DAYS}日・1回${trial.perTribute}・1日${trial.perDay}・合計${trial.total} Pay）</button>
        ${firstTime ? "<small>初めての申し込みなので、お試しの設定にしています。</small>" : ""}</div>
      <small>下げる変更はいつでも即時。上げる変更は日本時間の翌日0時から効きます。1回の限度額を${escapeHtml(formatPay(LIMITS.googleCapThreshold))}以上にできるのは、AnjuPayウォレットを Google で保護したアカウントだけです。</small>
    </fieldset>
    <fieldset><legend>期間</legend><div class="tribute-radio-row">${DURATION_DAYS_OPTIONS.map((days) => `<label><input type="radio" name="durationDays" value="${days}" ${days === durationDays ? "checked" : ""} /><span>${days}日</span></label>`).join("")}</div>
      <small>続けたい時は、終わった契約から「同じ条件で申し込む」で、前と同じ設定のまま申し込めます。</small></fieldset>
    <fieldset><legend>言われてもいい強さ（ここまで）</legend><div class="tribute-radio-row">${Object.entries(TONE_CEILING_LABELS).map(([key, label]) => `<label><input type="radio" name="tone" value="${key}" ${key === tone ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`).join("")}</div>
      <small>管理人は、この強さまでの言葉から選びます。辛口までにすると、甘い言葉も辛い言葉も来ます。辛口は徹底して辛く罵られます。自傷や死をすすめる言葉・脅し・差別語・晒しは、どの強さでもありません。</small></fieldset>
    <label class="tribute-field"><span>言われたくない言葉（最大${LIMITS.ngWordCount}語・各${LIMITS.ngWordLength}文字、読点区切り）</span><input name="ngWords" maxlength="80" placeholder="例：ブス、デブ" value="${escapeHtml((prefill?.ngWords || []).join("、"))}" /></label>
    <label class="tribute-field is-want"><span>言われたい言葉（任意・最大${LIMITS.wantWordCount}語・各${LIMITS.wantWordLength}文字、読点区切り）</span><input name="wantWords" maxlength="80" placeholder="例：ざこ、養分、いい子" value="${escapeHtml((prefill?.wantWords || []).join("、"))}" />
      <small>管理人のスレッドに出て、言葉選びの手がかりになります。ご褒美にも使われます。契約の「言われたい言葉」でいつでも変えられます。</small></label>
    <label class="tribute-check"><input type="checkbox" name="allowReportRequests" ${checked("allowReportRequests")} /><span>残高報告を求められてもよい</span></label>
    <label class="tribute-check is-hold"><input type="checkbox" name="allowHolds" ${checked("allowHolds", true)} /><span>お預けを受ける<small>管理人が「お預け」にすると、自分からは差し出せなくなり、「貢がせてください」と願い出て許されると1回だけ差し出せます。請求に応えるのはいつもどおりです。契約の「お預けの設定」でいつでも外せます。</small></span></label>
    <label class="tribute-check is-grazing"><input type="checkbox" name="allowGrazing" ${checked("allowGrazing", true)} /><span>牧場に放牧される<small>管理人の牧場で、あなたが動物（牛・豚・羊）になって暮らします。見られるのは管理人だけで、ほかの財布には見えません。契約の「牧場の設定」でいつでも外せます。</small></span></label>
    <label class="tribute-check is-othello"><input type="checkbox" name="allowOthello" ${checked("allowOthello", true)} /><span>貢ぎオセロを受ける<small>管理人と交互に打つオセロです。始めるかどうかと1枚あたりの額は管理人が決め、終わった時の石の差が罰金になります（1回の限度額まで）。降参でき、契約の「貢ぎオセロの設定」で外すと進行中の対局は罰金なしで終わります。</small></span></label>
    <label class="tribute-check is-work"><input type="checkbox" name="allowWorkOrders" ${checked("allowWorkOrders", true)} /><span>出稼ぎ命令を受ける<small>管理人が「1on1を○回完走して稼いでこい」と命じられます。命令ではPayは動かず、期限も罰もありません。命令の後に完走した数を、あなたが報告します。契約の「出稼ぎの設定」でいつでも外せます。</small></span></label>
    <label class="tribute-check"><input type="checkbox" name="rankOptIn" ${checked("rankOptIn")} /><span>この管理人の番付に財布名で載る</span></label>
    <label class="tribute-check is-consent"><input type="checkbox" name="acceptNoDecline" required /><span>請求は断れず、払うか解約するかであることを確かめました<small>限度額を超える請求は、払えないまま残ります。限度額と解約は、いつでも自分で設定できます。</small></span></label>
    <label class="tribute-check is-sexual"><input type="checkbox" name="allowSexualPurposes" /><span>性的な名目（${escapeHtml(SEXUAL_PURPOSE_SUMMARY)}）で請求されてもよい<small>許すと、管理人はこの名目で請求でき、あなたも無言の献上に付けられます。契約の「名目の設定」でいつでも外せます。</small></span></label>
    <label class="tribute-check is-shot"><input type="checkbox" name="allowScreenshots" /><span>管理人のXに、スクショを載せられてもいい<small>スレッドや献上レシートなど、あなたが写る画面です。財布名や会話が写ることがあります。管理人のスレッドに「スクショ掲載 可」の札が出るので、会話で頼まれることはありません。契約の「スクショの設定」でいつでも外せますが、すでに載ったものはアプリでは消せません。</small></span></label>
    <label class="tribute-field"><span>財布名（管理人のスレッドに出ます）</span><input name="walletName" maxlength="${LIMITS.walletName}" value="${escapeHtml(profile.walletName === "名無しの財布" ? "" : profile.walletName || "")}" placeholder="例：ポチ財布" />
      <small>空のままだと「名無しの財布」になり、管理人があなたを見分けにくくなります。</small></label>
    <dl class="tribute-facts">
      <div><dt>入場料</dt><dd>${escapeHtml(formatPay(target.entryFee))}${target.entryFee ? "（受理された時に1回の献上として移ります）" : ""}</dd></div>
      <div><dt>申し込みの期限</dt><dd>48時間（いつでも取り下げできます）</dd></div>
    </dl>
    <p class="tribute-form-error" data-form-error role="alert"></p>
    <div class="tribute-row"><button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>申し込む</button>
      <button class="button button-ghost" type="button" data-t="back-manager">戻る</button></div>
  </form>`, { title: "申し込み" });
}

function renderCardEditor() {
  const profile = state.profile || {};
  const card = profile.card || {};
  return frame(`<form class="tribute-panel tribute-card-editor" data-form="card">
    <span class="tribute-eyebrow">管理人カード</span>
    <h1>${profile.card ? "カードを編集" : "管理人カードを作る"}</h1>
    <div class="tribute-editor-preview"><small>掲示板での見え方</small><div class="tribute-card-grid" data-card-preview>${renderCardPreview(card)}</div></div>
    <label class="tribute-field"><span>ペルソナ名（1〜${LIMITS.personaName}文字）</span><input name="personaName" maxlength="${LIMITS.personaName}" required value="${escapeHtml(card.personaName || "")}" /></label>
    <fieldset><legend>印のアイコン</legend><div class="tribute-avatar-picker" data-avatar-picker style="--sigil:${sigilColor(card)}">${renderAvatarChoices(card)}</div>
      <div data-avatar-trial>${renderAvatarTrial({ avatar: card.avatar })}</div>
      <small>用意した${AVATARS.length}種から選びます（画像のアップロードはできません）。イラストは、ゆるめと大人びた絵を用意しています。有料の四角いアイコンは試着でき、買うと保存できます（1枚 ${escapeHtml(formatPay(PREMIUM_AVATARS[0]?.price))} の買い切り）。</small></fieldset>
    <fieldset><legend>印の色</legend><div class="tribute-swatches">${SIGIL_COLORS.map((color, index) => `<label style="--sigil:${color}"><input type="radio" name="sigil" value="${index}" ${Number(card.sigil || 0) === index ? "checked" : ""} /><span aria-label="色${index + 1}"></span></label>`).join("")}</div>
      <small>アイコンの縁（有料アイコンは金の縁）と、掲示板のカードの色になります。</small></fieldset>
    ${renderSealSettings(card)}
    <div data-deco-section>${renderDecorationSettings(card)}</div>
    <div data-achievement-section>${renderCardAchievementPicker(card)}</div>
    <fieldset><legend>宣言</legend>
      <label class="tribute-check"><input type="checkbox" name="ignoreUnpaid" ${card.ignoreUnpaid === true ? "checked" : ""} /><span>「未払いは既読無視」を宣言する<small>財布の画面と、掲示板のカードに札が出ます。返事をするかどうかは、いつでもあなたが決められます。</small></span></label>
      <label class="tribute-check"><input type="checkbox" name="postsScreenshots" ${card.postsScreenshots === true ? "checked" : ""} /><span>「スクショを載せる」を宣言する<small>掲示板のカード・申し込み・受付カードに札が出ます。財布が写る画面を X に載せてよいのは、財布が申し込みで許した契約だけです（スレッドに「スクショ掲載 可」の札が出ます）。</small></span></label>
    </fieldset>
    <fieldset><legend>最後に動いた時</legend>
      <label class="tribute-check"><input type="checkbox" name="showsActivity" ${card.showsActivity === true ? "checked" : ""} /><span>掲示板と管理人の詳細に、最後に動いた時を出す<small>「動き 1時間以内／○時間前／○日前」と出ます。財布が、受理してもらえそうかの目安にします。出さなくても、掲示板は動いた順に並びます。</small></span></label>
    </fieldset>
    <fieldset><legend>貢ぎ報告</legend>
      <label class="tribute-check"><input type="checkbox" name="reportConsent" ${(profile.card ? card.reportConsent === true : true) ? "checked" : ""} /><span>財布の貢ぎ報告の画像に、名前とアイコンを出してよい<small>外すと「管理人様」とシルエットになります。画像を作れるのは財布だけで、URLは入りません。</small></span></label>
    </fieldset>
    <label class="tribute-field"><span>紹介（${LIMITS.intro}文字まで）</span><input name="intro" maxlength="${LIMITS.intro}" value="${escapeHtml(card.intro || "")}" /></label>
    <label class="tribute-field"><span>Xのプロフィール（任意）</span><input name="xProfile" maxlength="80" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://x.com/ユーザー名 または @ユーザー名" value="${cardXHandle(card) ? escapeHtml(`https://x.com/${cardXHandle(card)}`) : ""}" />
      <small>管理人カードと掲示板に「自己申告・本人未確認」として表示され、開く前に外部サイトである確認が出ます。空にすると外します。紹介文・ペルソナ名には、SNSのIDやリンクを書けません。</small></label>
    <label class="tribute-field"><span>番付のひとこと（任意・${RANKING_WORD.length}文字まで）</span><input name="rankingWord" maxlength="${RANKING_WORD.length}" autocomplete="off" placeholder="例：今月も財布を受付中。覚悟して貢ぎな。" value="${escapeHtml(card.rankingWord || "")}" />
      <small>貢がれ総額の番付で${GROSS_RANKING.limit}位以内に入ると、X のプロフィールと一緒に番付に載ります。連絡先・外部決済・性的な言葉は書けません。</small></label>
    <fieldset><legend>中の人の札</legend><div class="tribute-radio-col">${Object.entries(DISCLOSURE_LABELS).map(([key, label]) => `<label><input type="radio" name="disclosure" value="${key}" ${card.disclosure === key ? "checked" : ""} required /><span>${escapeHtml(label)}</span></label>`).join("")}</div>
      <small>ネカマ貢がせは、男性であることを隠さず行うジャンルです。受け手の性別を女性に限る仕組みはありません。</small></fieldset>
    <fieldset class="tribute-style-picker" data-style-picker><legend>管理の型（${MAX_MANAGER_STYLES}つまで）</legend>${styleReselectNotice(profile)}<div class="tribute-radio-col">${MANAGER_STYLES.map((style) => `<label><input type="checkbox" name="styles" value="${style.id}" ${normalizeStyles(card.styles).includes(style.id) ? "checked" : ""} /><span>${escapeHtml(style.label)}<small>${escapeHtml(style.hint)}</small></span></label>`).join("")}</div>
      <small>1つか2つ選びます。2つ選んでも、カードには並べて出すだけで、どちらが主かは出しません。選んだ型の一言が、請求の一言の候補に出ます。</small></fieldset>
    <label class="tribute-field"><span>入場料</span><select name="entryFee">${optionList(ENTRY_FEE_OPTIONS, card.entryFee ?? 0)}</select></label>
    <label class="tribute-check"><input type="checkbox" name="accepting" ${profile.accepting || !profile.card ? "checked" : ""} /><span>受付する（掲示板に出す）</span></label>
    <p class="tribute-note">連絡先・SNSのID・外部決済・現金・会う約束・住所や本名に関わる言葉は、カードに書けません。契約後の会話で送れないのは、外部決済・現金・現実の金額だけです。</p>
    <p class="tribute-form-error" data-form-error role="alert"></p>
    <div class="tribute-row"><button class="button button-primary" type="submit" data-card-save ${state.busy || decorationsTried(normalizeDecorations(card)).length || vaultDecorationsLocked(card).length ? "disabled" : ""}>保存する</button>
      <button class="button button-ghost" type="button" data-t="nav" data-screen="hub">戻る</button></div>
  </form>${renderOwnWordsEditor(profile)}`, { title: "管理人カード" });
}

// 管理人の自分の言葉（定型文・ご褒美）。管理人だけが見て、カードには入らず、掲示板にも出ない。
function renderOwnWordsEditor(profile) {
  if (!profile.card) return "";
  const own = profile.ownWords || { lines: [], rewards: [] };
  const toneSelect = (name, value) => `<select name="${name}" aria-label="強さ">${Object.entries(TONE_LABELS).map(([key, label]) => `<option value="${key}" ${key === (value || "harsh") ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
  const rows = (kind, count, length, list) => Array.from({ length: count }, (_, index) => `<div class="tribute-own-row"><input name="${kind}Text${index}" maxlength="${length}" autocomplete="off" value="${escapeHtml(list[index]?.text || "")}" />${toneSelect(`${kind}Tone${index}`, list[index]?.tone)}</div>`).join("");
  return `<form class="tribute-panel tribute-own-words" data-form="own-words">
    <span class="tribute-eyebrow">自分の言葉</span>
    <h2>契約の中だけで使う言葉</h2>
    <p class="tribute-note">あなただけが見る言葉です。カードには入らず、掲示板にも出ません。定型文とご褒美の候補に、一覧の言葉と並んで出ます。強さの札が財布の「言われてもいい強さ」を超える言葉、言われたくない言葉を含む言葉、性的な言葉（性的な名目を許していない契約）は出しません。</p>
    <fieldset><legend>自分の定型文（${LIMITS.ownLines}個まで・各${LIMITS.ownLineLength}文字）</legend>${rows("line", LIMITS.ownLines, LIMITS.ownLineLength, own.lines || [])}</fieldset>
    <fieldset><legend>自分のご褒美（${LIMITS.ownRewards}個まで・各${LIMITS.ownRewardLength}文字）</legend>${rows("reward", LIMITS.ownRewards, LIMITS.ownRewardLength, own.rewards || [])}</fieldset>
    <p class="tribute-form-error" data-form-error role="alert"></p>
    <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>自分の言葉を保存する</button>
  </form>`;
}

// 自分の定型文とご褒美のうち、この契約で出せるもの（強さの上限・言われたくない言葉・性的な名目の許可）。
function ownWordsFor(view, kind) {
  if (view.role !== "manager") return [];
  const list = state.profile?.ownWords?.[kind] || [];
  return list.filter((entry) => ownWordUsable(entry, { tone: view.tone, ngWords: view.ngWords, allowSexual: view.allowSexualPurposes })).map((entry) => entry.text);
}

// 受取印。一覧から3つまで選び、受け取る時にこの中から1つ押す。
function renderSealSettings(card) {
  const selected = Array.isArray(card.seals) && card.seals.length ? card.seals : DEFAULT_SEALS;
  return `<fieldset><legend>受取印（${MAX_SEALS}つまで）</legend>
    <div class="tribute-seal-choices">${SEALS.map((seal) => `<label><input type="checkbox" name="seals" value="${seal.id}" ${selected.includes(seal.id) ? "checked" : ""} /><span>${escapeHtml(seal.label)}</span></label>`).join("")}</div>
    <label class="tribute-field"><span>自分の言葉の印（任意・各${LIMITS.sealWordLength}文字・読点区切り。一覧の印と合わせて${MAX_SEALS}つまで）</span><input name="sealWords" maxlength="40" autocomplete="off" value="${escapeHtml(selected.filter((id) => String(id).startsWith(SEAL_WORD_PREFIX)).map(sealLabel).join("、"))}" placeholder="例：よく貢いだ、合格だ" />
      <small>レシートと貢ぎ報告の画像に残るので、連絡先・外部決済・性的な言葉は使えません。</small></label>
    <div class="tribute-seal-preview" data-seal-preview>${sealPreview(selected[0], card.personaName, normalizeDecorations(card))}</div>
    <small>受け取る時に、この中から1つ選んで押します。財布の「言われたくない言葉」に当たる印は「受領」になります。</small>
  </fieldset>`;
}

function sealPreview(id, personaName, look = {}) {
  return sealSvg({ label: sealLabel(id) || "受領", name: String(personaName || "").trim() || "管理人", at: Date.now(), size: 128, shape: look.sealShape, ink: look.sealInk });
}

function updateSealPreview(form) {
  const preview = form.querySelector("[data-seal-preview]");
  if (!preview) return;
  const first = form.querySelector('input[name="seals"]:checked')?.value || DEFAULT_SEALS[0];
  preview.innerHTML = sealPreview(first, form.elements.personaName?.value, formDecorations(form));
}

// ───────────── 牧場の飾り ─────────────
// 枠・受取印の形・朱肉の色。持っていない飾りも選んで試着でき、買うまで保存はできない。

function ownedDecorations() {
  return new Set(state.decorations.owned);
}

// 選んでいるうち、まだ持っていない飾り（試着中）。
function decorationsTried(decorations) {
  if (state.decorations.status !== "ready") return [];
  const owned = ownedDecorations();
  return requiredDecorationProducts(decorations).filter((productId) => !owned.has(productId));
}

function decorationByProduct(productId) {
  return [...CARD_FRAMES, ...SEAL_SHAPES, ...SEAL_INKS, ...PREMIUM_AVATARS].find((entry) => entry.productId === productId) || null;
}

const isAvatarProduct = (productId) => PREMIUM_AVATARS.some((entry) => entry.productId === productId);

// 金庫のいちばん高く届いた段階（その段階までの金庫の飾りを使える）。
function vaultBestTier() {
  return Number(state.decorations.vaultBestTier) || 0;
}

// 選んでいるうち、金庫がまだその段階に届いていない金庫の飾り（試着中）。
function vaultDecorationsLocked(decorations) {
  if (state.decorations.status !== "ready") return [];
  const look = normalizeDecorations(decorations);
  return ["frame", "sealShape", "sealInk"]
    .map((slot) => decorationChoice(slot, look[slot]))
    .filter((entry) => entry?.vaultTier && entry.vaultTier > vaultBestTier());
}

function formDecorations(form) {
  const card = state.profile?.card || {};
  const data = new FormData(form);
  const pick = (name) => (data.has(name) ? String(data.get(name)) : card[name]);
  return { ...normalizeDecorations({ frame: pick("frame"), frameColor: pick("frameColor"), sealShape: pick("sealShape"), sealInk: pick("sealInk") }), avatar: avatarId(pick("avatar")) };
}

function decorationStatus(entry, selected) {
  if (entry.vaultTier) {
    if (vaultBestTier() >= entry.vaultTier) return { key: "owned", label: "金庫で解放" };
    if (selected) return { key: "trying", label: "試着中" };
    return { key: "locked", label: `金庫「${vaultTierInfo(entry.vaultTier)?.label || ""}」` };
  }
  if (!entry.productId) return { key: "free", label: "無料" };
  if (ownedDecorations().has(entry.productId)) return { key: "owned", label: "持っている" };
  if (selected) return { key: "trying", label: "試着中" };
  return { key: "locked", label: formatPay(entry.price) };
}

function decorationTile(slot, entry, selectedId, art) {
  const selected = entry.id === selectedId;
  const status = decorationStatus(entry, selected);
  return `<label class="tribute-deco-tile is-${status.key}${entry.special ? " is-special" : ""}${entry.vaultTier ? " is-vault" : ""}" data-deco-slot="${slot}" data-deco-id="${escapeHtml(entry.id)}">
    <input type="radio" name="${slot}" value="${escapeHtml(entry.id)}" ${selected ? "checked" : ""} />
    <span class="tribute-deco-art" data-deco-art>${art}</span><b>${escapeHtml(entry.name)}</b><small data-deco-status>${escapeHtml(status.label)}</small>
  </label>`;
}

function shapeArt(shape, look, name) {
  return sealSvg({ label: "受領", name: String(name || "").trim() || "管理人", at: Date.now(), size: 54, shape, ink: look.sealInk, rough: false });
}

function renderDecorationSettings(card) {
  const look = normalizeDecorations(card);
  const deco = state.decorations;
  if (deco.status !== "ready") {
    // 読み込み中も、いまの飾りのまま保存できるようにする。
    return `<fieldset class="tribute-deco"><legend>牧場の飾り</legend>
      ${Object.entries(look).map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`).join("")}
      <p class="tribute-empty">${deco.status === "error" ? "持っている飾りを読み込めませんでした。いまの飾りのまま保存できます。" : "持っている飾りを確かめています…"}</p>
    </fieldset>`;
  }
  return `<fieldset class="tribute-deco"><legend>牧場の飾り</legend>
    <div class="tribute-deco-group"><h3>カードの枠 <small>掲示板・詳細・招待・受付カード</small></h3>
      <div class="tribute-deco-tiles">${CARD_FRAMES.map((frame) => decorationTile("frame", frame, look.frame, frameSwatch(frame.id, look))).join("")}</div></div>
    <div class="tribute-deco-group" data-frame-colors>${renderFrameColors(look)}</div>
    <div class="tribute-deco-group"><h3>受取印の形 <small>受け取る時の印・レシート・貢ぎ報告の画像</small></h3>
      <div class="tribute-deco-tiles">${SEAL_SHAPES.map((shape) => decorationTile("sealShape", shape, look.sealShape, shapeArt(shape.id, look, card.personaName))).join("")}</div></div>
    <div class="tribute-deco-group"><h3>朱肉の色</h3>
      <div class="tribute-deco-tiles is-inks">${SEAL_INKS.map((ink) => decorationTile("sealInk", ink, look.sealInk, `<i class="tribute-deco-ink" style="--ink:${ink.dark}"></i>`)).join("")}</div></div>
    <div data-deco-trial>${renderDecorationTrial(look)}</div>
    <small>飾りが変えるのは見た目だけです。中の人の札・入場料・管理中の人数は、どの飾りでも同じ位置に出ます。AnjuPayストアの「お貢ぎ牧場の飾り」でも買えます。古金・千両箱・蔵・宝物庫・金の城は、金庫がその段階に届くと使える非売品です。</small>
  </fieldset>`;
}

// 枠の見本。選んでいる枠は、選んでいる色で見せる。
function frameSwatch(frame, look) {
  return `<span class="tribute-deco-swatch"${frameAttr(frame, frame === look.frame ? look.frameColor : "")}></span>`;
}

// 枠の色。持っている枠なら、どの色も追加料金なし（試着中の枠でも色を選べる）。
function renderFrameColors(look) {
  const palettes = FRAME_PALETTES[look.frame];
  if (!palettes) return "";
  const name = decorationChoice("frame", look.frame)?.name || "枠";
  return `<h3>${escapeHtml(name)}の色 <small>持っている枠は、どの色も追加料金なし</small></h3>
    <div class="tribute-frame-colors" role="radiogroup" aria-label="${escapeHtml(name)}の色">${palettes.map((palette) => `<label class="tribute-frame-color"><input type="radio" name="frameColor" value="${palette.id}" ${palette.id === look.frameColor ? "checked" : ""} /><i style="--dot-fill:${palette.dot[0]};--dot-ring:${palette.dot[1]}" aria-hidden="true"></i>${escapeHtml(palette.name)}</label>`).join("")}</div>`;
}

// 枠を選び直したら、その枠の色の丸に替える（保存してある枠に戻した時は、保存してある色）。
function refreshFrameColors(form) {
  const group = form.querySelector("[data-frame-colors]");
  if (!group) return;
  const saved = normalizeDecorations(state.profile?.card);
  const frame = form.querySelector('input[name="frame"]:checked')?.value || "";
  group.innerHTML = renderFrameColors(normalizeDecorations({ frame, frameColor: frame === saved.frame ? saved.frameColor : "" }));
}

function renderDecorationTrial(look) {
  const tried = decorationsTried(look).filter((productId) => !isAvatarProduct(productId)).map(decorationByProduct).filter(Boolean);
  return trialBox(tried, vaultDecorationsLocked(look));
}

// 有料アイコンの試着。飾りの試着とは分けて、アイコンの欄のすぐ下に出す。
function renderAvatarTrial(look) {
  return trialBox(decorationsTried(look).filter(isAvatarProduct).map(decorationByProduct).filter(Boolean), []);
}

function trialBox(tried, locked) {
  if (!tried.length && !locked.length) return "";
  const balance = state.walletBalance;
  const total = tried.reduce((sum, entry) => sum + entry.price, 0);
  const after = !tried.length || balance === null ? "" : balance >= total ? `財布 ${escapeHtml(formatPay(balance))} → 買ったあと <em>${escapeHtml(formatPay(balance - total))}</em>` : `財布 ${escapeHtml(formatPay(balance))}（あと ${escapeHtml(formatPay(total - balance))} 足りません）`;
  const lockedNote = locked.map((entry) => `「${escapeHtml(entry.name)}」は金庫が「${escapeHtml(vaultTierInfo(entry.vaultTier)?.label || "")}」に届くと使えます`).join("。");
  return `<div class="tribute-deco-trial" role="status">
    <b>試着中：${[...tried, ...locked].map((entry) => escapeHtml(entry.name)).join("・")}</b>
    ${after ? `<span>${after}</span>` : ""}
    ${lockedNote ? `<span>${lockedNote}（ストアでは売っていません）。</span>` : ""}
    <div class="tribute-row">${tried.map((entry) => `<button class="button button-primary button-small" type="button" data-t="buy-deco" data-product="${escapeHtml(entry.productId)}" ${state.busy || (balance !== null && balance < entry.price) ? "disabled" : ""}>${escapeHtml(entry.name)}を${escapeHtml(formatPay(entry.price))}で買う</button>`).join("")}
      <button class="button button-ghost button-small" type="button" data-t="stop-trial">試着をやめる</button></div>
    <small>試着中は保存できません。${tried.length ? "ストアの飾りは買い切りです。" : ""}</small>
  </div>`;
}

// 選び直した時に、札（無料・持っている・試着中・値段）と試着の案内、保存ボタンだけを書き換える。
function updateDecorations(form) {
  const look = formDecorations(form);
  for (const tile of form.querySelectorAll("[data-deco-slot]")) {
    const slot = tile.dataset.decoSlot;
    const list = slot === "frame" ? CARD_FRAMES : slot === "sealShape" ? SEAL_SHAPES : SEAL_INKS;
    const entry = list.find((candidate) => candidate.id === tile.dataset.decoId);
    if (!entry) continue;
    const status = decorationStatus(entry, entry.id === look[slot]);
    tile.classList.remove("is-free", "is-owned", "is-trying", "is-locked");
    tile.classList.add(`is-${status.key}`);
    const label = tile.querySelector("[data-deco-status]");
    if (label) label.textContent = status.label;
    const art = tile.querySelector("[data-deco-art]");
    if (art && slot === "sealShape") art.innerHTML = shapeArt(entry.id, look, form.elements.personaName?.value);
    if (art && slot === "frame") art.innerHTML = frameSwatch(entry.id, look);
  }
  for (const tile of form.querySelectorAll("[data-avatar-premium]")) {
    const entry = premiumAvatar(tile.dataset.avatarPremium);
    if (!entry) continue;
    const status = avatarStatus(entry, entry.id === look.avatar);
    tile.classList.remove("is-free", "is-owned", "is-trying", "is-locked");
    tile.classList.add(`is-${status.key}`);
    const label = tile.querySelector("[data-avatar-status]");
    if (label) label.textContent = status.label;
  }
  const trial = form.querySelector("[data-deco-trial]");
  if (trial) trial.innerHTML = renderDecorationTrial(look);
  const avatarTrial = form.querySelector("[data-avatar-trial]");
  if (avatarTrial) avatarTrial.innerHTML = renderAvatarTrial(look);
  const save = form.querySelector("[data-card-save]");
  if (save) save.disabled = Boolean(state.busy) || decorationsTried(look).length > 0 || vaultDecorationsLocked(look).length > 0;
}

// 実績は種類ごとに一番高い段だけを並べる（いま選んでいるものは必ず残す）。
function cardAchievementChoices(selected) {
  const best = new Map();
  for (const id of state.decorations.achievements) {
    const entry = achievementEntry(id);
    if (!entry) continue;
    const current = best.get(entry.family);
    if (!current || entry.level > current.level) best.set(entry.family, entry);
  }
  const list = [...best.values()];
  for (const id of selected) {
    const entry = achievementEntry(id);
    if (entry && !list.includes(entry)) list.push(entry);
  }
  // 牧場の実績と、牧場基金の限定称号を先に並べる。
  const ranch = (entry) => Number(entry.category === "tribute_ranch" || entry.category === "tribute_honor");
  return list.sort((left, right) => ranch(right) - ranch(left) || right.level - left.level);
}

function renderCardAchievementPicker(card) {
  const selected = (Array.isArray(card.achievements) ? card.achievements : []).slice(0, CARD_ACHIEVEMENT_LIMIT);
  const legend = `<legend>牧場のカードに出す実績（${CARD_ACHIEVEMENT_LIMIT}つまで）</legend>`;
  if (state.decorations.status !== "ready") {
    return `<fieldset class="tribute-card-achievement-pick">${legend}${selected.map((id) => `<input type="hidden" name="achievements" value="${escapeHtml(id)}" />`).join("")}<p class="tribute-empty">${state.decorations.status === "error" ? "実績を読み込めませんでした。いまの実績のまま保存できます。" : "解除した実績を確かめています…"}</p></fieldset>`;
  }
  const choices = cardAchievementChoices(selected);
  if (!choices.length) {
    return `<fieldset class="tribute-card-achievement-pick">${legend}<p class="tribute-note">対戦・トレーニング・牧場などで実績を解除すると、ここから${CARD_ACHIEVEMENT_LIMIT}つまで選んでカードに飾れます。</p></fieldset>`;
  }
  return `<fieldset class="tribute-card-achievement-pick">${legend}
    <div class="tribute-achievement-choices">${choices.map((entry) => `<label><input type="checkbox" name="achievements" value="${escapeHtml(entry.id)}" ${selected.includes(entry.id) ? "checked" : ""} /><span><i aria-hidden="true">${escapeHtml(entry.icon)}</i><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(entry.familyLabel || "")} ${entry.legacy ? "限定" : `Lv.${Number(entry.level) || 1}`}</small></span></label>`).join("")}</div>
    <small>牧場のカードにだけ出ます。実績コレクションの展示とは別に選べます。</small>
  </fieldset>`;
}

async function loadDecorations() {
  const generation = lifecycleGeneration;
  const target = state.decorations = { ...state.decorations, status: "loading" };
  try {
    const payload = await readOnce("decorations");
    if (!payload || !isCurrent(generation) || state.decorations !== target) return;
    state.decorations = {
      status: "ready",
      owned: Array.isArray(payload?.owned) ? payload.owned.map(String) : [],
      achievements: Array.isArray(payload?.achievements) ? payload.achievements.map(String) : [],
      vaultBestTier: Math.max(0, Math.min(VAULT_TIERS.length, Number(payload?.vaultBestTier) || 0)),
    };
  } catch (error) {
    if (!isCurrent(generation) || state.decorations !== target) return;
    state.decorations = { ...state.decorations, status: "error" };
  }
  refreshDecorationSections();
}

// 読み込みが終わったら、飾りと実績の欄だけを差し替える（ほかの欄の入力は消さない）。
function refreshDecorationSections() {
  const form = document.querySelector('form[data-form="card"]');
  if (!form || state.screen !== "card") return;
  const card = state.profile?.card || {};
  const deco = form.querySelector("[data-deco-section]");
  if (deco) deco.innerHTML = renderDecorationSettings({ ...card, personaName: form.elements.personaName?.value || card.personaName });
  const achievements = form.querySelector("[data-achievement-section]");
  if (achievements) achievements.innerHTML = renderCardAchievementPicker(card);
  updateDecorations(form);
  updateCardPreview(form);
  updateSealPreview(form);
}

async function buyDecoration(productId) {
  const entry = decorationByProduct(productId);
  const form = document.querySelector('form[data-form="card"]');
  if (!entry || state.busy) return;
  const balance = state.walletBalance;
  const confirmed = window.confirm(
    `${entry.name}を${formatPay(entry.price)}で買いますか？\n\n`
    + (balance === null ? "" : `いまの財布：${formatPay(balance)}\n買ったあと：${formatPay(Math.max(0, balance - entry.price))}\n\n`)
    + "買い切りで、払い戻しはありません。",
  );
  if (!confirmed) return;
  state.busy = "buy-deco";
  if (form) updateDecorations(form);
  try {
    let result;
    if (previewScreen) {
      // 見本では Pay を動かさず、画面の上でだけ持っていることにする。
      result = { outcome: (balance ?? 0) >= entry.price ? "purchased" : "short", balance: Math.max(0, (balance ?? 0) - entry.price) };
      if (result.outcome === "purchased") {
        state.walletBalance = result.balance;
        paintWallet();
      }
    } else {
      result = (await economyActionCallable({ action: "purchase", productId })).data || {};
    }
    if (result.outcome === "purchased" || result.outcome === "owned") {
      state.decorations = { ...state.decorations, owned: [...new Set([...state.decorations.owned, productId])] };
      showToast(`${entry.name}を手に入れました。保存するとカードに付きます。`);
    } else if (result.outcome === "short") {
      showToast("AnjuPayが足りません。デイリーミッションや毎日のプレイで貯められます。");
    }
  } catch (error) {
    showToast(friendlyError(error, "飾りを買えませんでした。"));
  } finally {
    state.busy = "";
    if (form?.isConnected) updateDecorations(form);
  }
}

// 試着をやめる: 持っていない飾りを、保存してある飾り（なければ標準）に戻す。
function stopDecorationTrial(form) {
  const saved = normalizeDecorations(state.profile?.card);
  const owned = ownedDecorations();
  const look = formDecorations(form);
  let frameReset = false;
  for (const slot of ["frame", "sealShape", "sealInk"]) {
    const entry = decorationChoice(slot, look[slot]);
    const lockedStore = entry?.productId && !owned.has(entry.productId);
    const lockedVault = entry?.vaultTier && entry.vaultTier > vaultBestTier();
    if (!lockedStore && !lockedVault) continue;
    const input = form.querySelector(`input[name="${slot}"][value="${CSS.escape(saved[slot])}"]`);
    if (input) input.checked = true;
    if (slot === "frame") frameReset = true;
  }
  if (frameReset) refreshFrameColors(form);
  const avatar = premiumAvatar(look.avatar);
  if (avatar && !owned.has(avatar.productId)) {
    const input = form.querySelector(`input[name="avatar"][value="${avatarId(state.profile?.card?.avatar)}"]`);
    if (input) input.checked = true;
  }
  updateDecorations(form);
  updateCardPreview(form);
  updateSealPreview(form);
}

// 有料アイコンの札。スマホでは絵の幅が36px ほどなので、「持っている」は短く「購入済」にする。
function avatarStatus(entry, selected) {
  const status = decorationStatus(entry, selected);
  return status.key === "owned" ? { ...status, label: "購入済" } : status;
}

function renderAvatarChoices(card) {
  const selected = avatarId(card.avatar);
  const letter = Array.from(String(card.personaName || "管").trim())[0] || "管";
  const icon = (avatar) => {
    const paid = premiumAvatar(avatar.id);
    const status = paid ? avatarStatus(paid, selected === avatar.id) : null;
    return `<label title="${escapeHtml(avatar.label)}"${paid ? ` class="is-premium is-${status.key}" data-avatar-premium="${paid.id}"` : ""}><input type="radio" name="avatar" value="${avatar.id}" aria-label="印：${escapeHtml(avatar.label)}${paid ? `（${escapeHtml(formatPay(paid.price))}）` : ""}" ${selected === avatar.id ? "checked" : ""} /><span class="tribute-avatar-choice${paid ? " is-premium" : ""}"><img src="${escapeHtml(avatarUrl(avatar.id))}" alt="" width="112" height="112" decoding="async" draggable="false" /></span>${paid ? `<small data-avatar-status>${escapeHtml(status.label)}</small>` : ""}</label>`;
  };
  // 有料・イラスト・写真の地雷系・写真の夜ギャルの段に分けて並べる。有料は持っていなくても試着できる。
  const groups = AVATAR_GROUPS.map((group) => {
    const icons = AVATARS.filter((avatar) => avatar.group === group.id).map(icon).join("");
    return icons ? `<span class="tribute-avatar-group">${escapeHtml(group.label)}</span><div class="tribute-avatar-grid">${icons}</div>` : "";
  }).join("");
  return `${groups}
    <label class="tribute-avatar-letter"><input type="radio" name="avatar" value="0" ${selected ? "" : "checked"} /><span class="tribute-avatar-choice is-letter" data-avatar-letter aria-hidden="true">${escapeHtml(letter)}</span><span>アイコンを使わず、ペルソナ名の1文字にする</span></label>`;
}

// 掲示板のカードと同じ形の見本。今日のひとこと・称号・管理中の人数は、いまのカードのまま。
function renderCardPreview(card) {
  const current = state.profile?.card || {};
  return renderManagerCard({
    ...current,
    ...card,
    personaName: String(card.personaName || "").trim() || "ペルソナ名",
    activeContracts: current.activeContracts || 0,
    word: current.word || null,
    vault: current.vault || null,
    mine: false,
  }, { preview: true });
}

// 編集中のカードの印を、保存する前に見せる。form.style は要素のスタイルと紛らわしいので、
// 色は印の見本と選択欄に直接置く。
function updateCardPreview(form) {
  const preview = form.querySelector("[data-card-preview]");
  if (!preview) return;
  const data = new FormData(form);
  const card = {
    personaName: String(data.get("personaName") || ""),
    avatar: Number(data.get("avatar") || 0),
    sigil: Number(data.get("sigil") || 0),
    intro: String(data.get("intro") || ""),
    disclosure: String(data.get("disclosure") || state.profile?.card?.disclosure || "undisclosed"),
    styles: normalizeStyles(data.getAll("styles")),
    entryFee: Number(data.get("entryFee") || 0),
    xHandle: normalizeXProfile(data.get("xProfile")).xHandle || "",
    ignoreUnpaid: data.get("ignoreUnpaid") === "on",
    postsScreenshots: data.get("postsScreenshots") === "on",
    showsActivity: data.get("showsActivity") === "on",
    lastActiveAt: state.profile?.card?.lastActiveAt || Date.now(),
    ...formDecorations(form),
    achievements: data.has("achievements") ? data.getAll("achievements").map(String).slice(0, CARD_ACHIEVEMENT_LIMIT) : state.profile?.card?.achievements || [],
  };
  preview.innerHTML = renderCardPreview(card);
  form.querySelector("[data-avatar-picker]")?.style.setProperty("--sigil", sigilColor(card));
  const letter = form.querySelector("[data-avatar-letter]");
  if (letter) letter.textContent = Array.from(card.personaName.trim())[0] || "管";
}

// ───────────── スレッド ─────────────

function requestStatusMap(events) {
  const map = new Map();
  for (const event of events) {
    if (event.type === "tribute" && event.requestId) map.set(event.requestId, "paid");
    if (event.type === "request_declined") map.set(event.requestId, "declined");
    if (event.type === "request_cancelled") map.set(event.requestId, event.reason === "caps" ? "voided" : "cancelled");
  }
  return map;
}

function purposeTag(purpose, view) {
  const label = purposeLabel(purpose, { allowSexual: view.allowSexualPurposes });
  if (!label) return "";
  const sexual = PURPOSES.some((entry) => entry.id === purpose && entry.sexual);
  return `<span class="tribute-purpose-tag${sexual ? " is-sexual" : ""}">${escapeHtml(label)}</span>`;
}

// 名目の選択。性的な名目は、預ける側が許した契約でだけ並べる。
function purposeChoices({ allowSexual, selected = "", role }) {
  const options = [{ id: "", label: "なし", sexual: false }, ...purposesFor({ allowSexual })];
  const hint = allowSexual
    ? ""
    : role === "payer"
      ? `<small>${escapeHtml(SEXUAL_PURPOSE_SUMMARY)}は、契約の「名目の設定」で許すと使えます。</small>`
      : `<small>${escapeHtml(SEXUAL_PURPOSE_SUMMARY)}は、預ける側が許した契約でだけ使えます。</small>`;
  return `<fieldset class="tribute-purpose-field"><legend>名目</legend><div class="tribute-radio-row tribute-purposes">${options.map((purpose) => `<label${purpose.sexual ? ' class="is-sexual"' : ""}><input type="radio" name="purpose" value="${purpose.id}" ${purpose.id === selected ? "checked" : ""} /><span>${escapeHtml(purpose.label)}</span></label>`).join("")}</div>${hint}</fieldset>`;
}

// 受け取る時に選んだ印。スレッドが描き直されても選択が戻らないよう、献上ごとに覚えておく。
const sealChoices = new Map();

// 財布から差し出された献上に、管理人が押す受取印とご褒美。押すのは毎回管理人。
function renderReceiveControls(event, view) {
  const seals = sealsFor(state.profile?.card?.seals, view.ngWords);
  const seq = Number(event.seq);
  const chips = rewardChips(view, "receive", ` data-seq="${seq}"`);
  const chosen = seals.includes(sealChoices.get(seq)) ? sealChoices.get(seq) : seals[0];
  // いまのカードの形と朱肉で押す（押した時の見た目が、その献上に残る）。
  const look = normalizeDecorations(state.profile?.card);
  return `<div class="tribute-receive">
    <div class="tribute-seal-pick" role="radiogroup" aria-label="押す印">${seals.map((id) => `<label><input type="radio" name="seal-${seq}" value="${id}" ${id === chosen ? "checked" : ""} /><span>${sealSvg({ label: sealLabel(id), name: view.manager.personaName, at: Date.now(), size: 52, shape: look.sealShape, ink: look.sealInk, rough: false })}<small>${escapeHtml(sealLabel(id))}</small></span></label>`).join("")}</div>
    <button class="button button-primary button-small" type="button" data-t="receive" data-seq="${seq}">印を押して受け取る</button>
    ${chips ? `<div class="tribute-reward-chips" role="group" aria-label="ご褒美を添えて受け取る">${chips}</div>` : ""}
  </div>`;
}

function renderTally(view) {
  const collar = view.collarNo
    ? [`<span class="tribute-collar"><i aria-hidden="true"></i>${escapeHtml(view.role === "payer" ? `${view.manager.personaName}の財布` : "財布")}<b>${Number(view.collarNo)}号</b></span>`]
    : [];
  const parts = [...collar, ...PURPOSES
    .filter((purpose) => view.purposeCounts?.[purpose.id])
    .map((purpose) => `<span class="${purpose.sexual ? "is-sexual" : ""}">${escapeHtml(purpose.label)} <b>${Number(view.purposeCounts[purpose.id])}回</b></span>`)];
  if (view.rewardCount) parts.push(`<span class="is-reward">ご褒美 <b>${Number(view.rewardCount)}回</b></span>`);
  if (view.workOrdersDone) parts.push(`<span class="is-work">出稼ぎ <b>${Number(view.workOrdersDone)}回</b></span>`);
  if (view.pleaCount) parts.push(`<span class="is-plea">願い出 <b>${Number(view.pleaCount)}回</b> → 許された <b>${Number(view.pleaGrantedCount)}回</b></span>`);
  if (view.resistedTributes) parts.push(`<span class="is-resist">抵抗のすえ献上 <b>${Number(view.resistedTributes)}回</b></span>`);
  if (view.wordOfferings) parts.push(`<span class="is-words">言葉の献上 <b>${Number(view.wordOfferings)}回</b></span>`);
  if (view.recitesDone) parts.push(`<span class="is-words">復唱 <b>${Number(view.recitesDone)}回</b></span>`);
  if (view.role === "manager" && view.awaitingReceipt) parts.push(`<span class="is-awaiting">受け取り待ち <b>${Number(view.awaitingReceipt)}</b></span>`);
  if (view.allowSexualPurposes) parts.push('<span class="is-sexual">性的な名目 可</span>');
  // スクショ掲載の許可。管理人には「不可」も出す（載せてよいかを、会話で確かめなくて済むように）。
  if (view.allowScreenshots) parts.push('<span class="is-shot">スクショ掲載 可</span>');
  else if (view.role === "manager") parts.push('<span class="is-shot-off">スクショ掲載 不可</span>');
  if (view.allowWorkOrders) parts.push('<span class="is-work">出稼ぎ命令 可</span>');
  if (view.hold) parts.push('<span class="is-hold">お預け中</span>');
  else if (view.allowHolds) parts.push('<span class="is-hold-ok">お預け 可</span>');
  if (view.othelloRecord?.played) parts.push(`<span class="is-othello">オセロ ${escapeHtml(othelloRecordText(view.othelloRecord))}</span>`);
  if (view.contestRecord?.won || view.contestRecord?.lost) parts.push(`<span class="is-contest">勝負 ${Number(view.contestRecord.won)}勝${Number(view.contestRecord.lost)}敗</span>`);
  return parts.length ? `<p class="tribute-tally">${parts.join("")}</p>` : "";
}

function capsText(caps) {
  return caps ? `1回 ${formatPay(caps.perTribute)} ・ 1日 ${formatPay(caps.perDay)} ・ 合計 ${formatPay(caps.total)}` : "";
}

function renderEvent(event, view, statuses) {
  const mine = event.actor === view.role;
  const managerName = view.manager.personaName;
  const payerName = view.role === "manager" ? contractCounterpart(view).name : view.payer.walletName;
  const actorName = event.actor === "manager" ? managerName : event.actor === "payer" ? payerName : "";
  const time = `<time>${escapeHtml(formatDateTime(event.createdAt))}</time>`;
  const system = (text, extra = "") => `<li class="tribute-event is-system ${extra}"><p>${text}</p>${time}</li>`;
  switch (event.type) {
    case "message":
      // 財布の自分のメッセージには、管理人が読むと「既読」が付く（返事がなければ既読無視）。
      return `<li class="tribute-event is-message ${mine ? "is-mine" : "is-theirs"} is-${event.actor}">
        <span class="tribute-bubble">${escapeHtml(event.text)}</span>${mine && view.role === "payer" && view.peerReadSeq >= Number(event.seq) ? '<span class="tribute-read">既読</span>' : ""}${time}</li>`;
    case "applied":
      // 限度額は出さない（管理人も読む出来事のため）。
      return system(`申し込み：${Number(event.durationDays)}日 ・ 言葉は${escapeHtml(TONE_CEILING_LABELS[event.tone] || "普通まで")}${event.entryFee ? ` ・ 入場料 ${escapeHtml(formatPay(event.entryFee))}` : ""}${event.allowSexualPurposes ? " ・ 性的な名目 可" : ""}${event.allowScreenshots ? " ・ スクショ掲載 可" : ""}${event.allowWorkOrders ? " ・ 出稼ぎ命令 可" : ""}${event.allowHolds ? " ・ お預け 可" : ""}${event.allowOthello ? " ・ 貢ぎオセロ 可" : ""}${event.allowGrazing ? " ・ 放牧 可" : ""}`);
    case "accepted": {
      const collarNo = Number(event.collarNo) || 0;
      const collar = collarNo
        ? view.role === "payer" ? `あなたは${escapeHtml(managerName)}の財布 ${collarNo}号です。` : `この財布は ${collarNo}号です。`
        : "";
      return system(`受理されました。管理は ${escapeHtml(formatDateTime(event.expiresAt))} まで続きます。${collar}`, "is-strong");
    }
    case "request": {
      const pendingNow = view.pendingRequests.find((entry) => entry.requestId === event.requestId);
      const status = pendingNow ? "pending" : statuses.get(event.requestId) || "closed";
      const statusLabel = { paid: "差し出し済み", declined: "断りました", cancelled: "取り消し", voided: "無効", closed: "終了" }[status] || "";
      const purpose = purposeLabel(event.purpose, { allowSexual: view.allowSexualPurposes }) ? event.purpose : "";
      const open = status === "pending" && view.status === "active";
      const buttons = open
        ? view.role === "payer"
          ? renderPayableRequest(event, view, purpose)
          : `<span class="tribute-chip is-pending">未払い ・ ${escapeHtml(elapsedLabel(event.createdAt))}</span>${Number(event.resists) ? `<span class="tribute-chip is-resist">抵抗 ${Number(event.resists)}回</span>` : ""}<div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="cancel-request" data-request="${escapeHtml(event.requestId)}">取り消す</button></div>`
        : `<span class="tribute-chip is-${status}">${escapeHtml(statusLabel)}</span>`;
      return `<li class="tribute-event is-request ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-request-card${open && view.role === "payer" ? " is-owed" : ""}"><span class="tribute-eyebrow">請求</span>${purposeTag(purpose, view)}<strong>${escapeHtml(formatPay(event.amount))}</strong>${event.note ? `<p>「${escapeHtml(event.note)}」</p>` : ""}${buttons}</div>${time}</li>`;
    }
    case "tribute": {
      const receivable = RECEIVABLE_KINDS.includes(event.kind);
      const receivedAt = Number(event.receivedAt || 0);
      // 既読: 管理人がこの献上まで読んだのに、まだ受け取っていない。
      const seen = !receivedAt && receivable && view.role === "payer" && view.peerReadSeq >= Number(event.seq);
      const receipt = receivedAt
        ? `<span class="tribute-received"><i aria-hidden="true">✓</i>受け取り完了 <time>${escapeHtml(formatDateTime(receivedAt))}</time></span>`
        : receivable ? `<span class="tribute-awaiting${seen ? " is-seen" : ""}">${seen ? "<b>既読</b>" : ""}受け取り待ち</span>` : "";
      const seal = receivedAt && sealLabel(event.seal)
        ? `<span class="tribute-stamp-seal">${sealSvg({ label: sealLabel(event.seal), name: managerName, at: receivedAt, size: 76, shape: event.sealShape, ink: event.sealInk, rough: false })}</span>`
        : "";
      const controls = !receivedAt && receivable && view.role === "manager" && view.status === "active"
        ? renderReceiveControls(event, view)
        : "";
      const save = view.role === "payer"
        ? `<button class="tribute-save-image" type="button" data-t="share-open" data-seq="${Number(event.seq)}">画像で保存</button>`
        : "";
      return `<li class="tribute-event is-tribute${receivedAt ? " is-received" : ""}"><div class="tribute-stamp">${purposeTag(event.purpose, view)}<span>${escapeHtml(tributeKindLabel(event))}</span><strong>${escapeHtml(formatPay(event.amount))}</strong>${resistedLabel(event) ? `<em class="tribute-resisted">${escapeHtml(resistedLabel(event))}</em>` : ""}<small>${escapeHtml(payerName)} → ${escapeHtml(managerName)}</small>${receipt}${seal}</div>${controls}${save}${time}</li>`;
    }
    case "received": {
      const reward = rewardText(event);
      if (reward) {
        return `<li class="tribute-event is-message is-reward ${mine ? "is-mine" : "is-theirs"} is-manager"><span class="tribute-bubble"><span class="tribute-visually-hidden">${escapeHtml(managerName)}からのご褒美：</span>${escapeHtml(reward)}</span>${time}</li>`;
      }
      return system(event.words ? `${escapeHtml(managerName)}が言葉の献上を受け取りました。` : `${escapeHtml(managerName)}が ${escapeHtml(formatPay(event.amount))} を受け取りました。`, "is-received");
    }
    // 言葉の献上（Pay 0）。献上と同じく、管理人が受取印とご褒美で受け取る。
    case "word_offering": {
      const receivedAt = Number(event.receivedAt || 0);
      const seen = !receivedAt && view.role === "payer" && view.peerReadSeq >= Number(event.seq);
      const status = receivedAt
        ? `<span class="tribute-received"><i aria-hidden="true">✓</i>受け取り完了 <time>${escapeHtml(formatDateTime(receivedAt))}</time></span>`
        : `<span class="tribute-awaiting${seen ? " is-seen" : ""}">${seen ? "<b>既読</b>" : ""}受け取り待ち</span>`;
      const seal = receivedAt && sealLabel(event.seal)
        ? `<span class="tribute-stamp-seal">${sealSvg({ label: sealLabel(event.seal), name: managerName, at: receivedAt, size: 64, shape: event.sealShape, ink: event.sealInk, rough: false })}</span>`
        : "";
      const controls = !receivedAt && view.role === "manager" && view.status === "active" ? renderReceiveControls(event, view) : "";
      const save = view.role === "payer"
        ? `<button class="tribute-save-image" type="button" data-t="share-open" data-seq="${Number(event.seq)}">画像で保存</button>`
        : "";
      return `<li class="tribute-event is-word-offering ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-letter"><span class="tribute-eyebrow">言葉の献上</span><p>${escapeHtml(event.text).replace(/\n/g, "<br>")}</p><small>${escapeHtml(payerName)} → ${escapeHtml(managerName)}</small>${status}${seal}</div>${controls}${save}${time}</li>`;
    }
    case "recite_order":
      return `<li class="tribute-event is-recite-order ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-recite-card"><span class="tribute-eyebrow">復唱 ${Number(event.target)}回</span><strong>「${escapeHtml(event.text)}」</strong></div>${time}</li>`;
    case "recite":
      return `<li class="tribute-event is-message is-recite ${mine ? "is-mine" : "is-theirs"} is-payer"><span class="tribute-bubble"><i class="tribute-recite-mark">復唱 ${Number(event.count)}/${Number(event.target)}</i>${escapeHtml(event.text)}</span>${time}</li>`;
    case "recite_confirm": {
      const seal = sealLabel(event.seal)
        ? `<span class="tribute-stamp-seal">${sealSvg({ label: sealLabel(event.seal), name: managerName, at: event.createdAt, size: 64, shape: event.sealShape, ink: event.sealInk, rough: false })}</span>`
        : "";
      const reward = rewardText(event);
      return `<li class="tribute-event is-system is-work-confirm"><p>${escapeHtml(managerName)}が復唱（${Number(event.target)}回）を確かめました。</p>${seal}${time}</li>${reward
        ? `<li class="tribute-event is-message is-reward ${mine ? "is-mine" : "is-theirs"} is-manager"><span class="tribute-bubble"><span class="tribute-visually-hidden">${escapeHtml(managerName)}から復唱へのご褒美：</span>${escapeHtml(reward)}</span>${time}</li>`
        : ""}`;
    }
    case "recite_withdrawn":
      return system(event.reason === "purpose"
        ? "性的な名目の許可が外れたので、性的な言葉の復唱を取り下げました。"
        : `${escapeHtml(managerName)}が復唱を取り下げました。`);
    case "grazing_changed":
      return system(`${escapeHtml(payerName)}が牧場に${event.allowGrazing ? "放牧されるようにしました" : "放牧されないようにしました"}。`);
    case "othello_setting":
      return system(`${escapeHtml(payerName)}が貢ぎオセロを${event.allowOthello ? "受ける" : "受けない"}ようにしました。`);
    case "othello_start":
      return system(`${escapeHtml(managerName)}が貢ぎオセロを始めました：1枚 ${escapeHtml(formatPay(event.rate))}・${escapeHtml(OTHELLO_HANDICAP_LABELS[event.handicap] || "ハンデなし")}・${event.managerFirst ? "管理人" : "財布"}が先手`, "is-othello");
    case "othello_move": {
      const who = event.actor === "manager" ? managerName : payerName;
      const flipped = event.actor === "manager" ? `${Number(event.flipped)}枚奪った` : `${Number(event.flipped)}枚取り返した`;
      const move = `<span class="tribute-othello-move">${escapeHtml(who)}が ${othelloCellName(Number(event.index))} に打った・${flipped}${event.corner ? "（角）" : ""}・財布 ${Number(event.payer)}枚／${escapeHtml(managerName)} ${Number(event.manager)}枚</span>`;
      return event.note
        ? `<li class="tribute-event is-message is-othello ${mine ? "is-mine" : "is-theirs"} is-${event.actor}">${move}<span class="tribute-bubble">${escapeHtml(event.note)}</span>${time}</li>`
        : `<li class="tribute-event is-system is-othello"><p>${move}</p>${time}</li>`;
    }
    case "othello_pass":
      return system(`${escapeHtml(event.passed === "manager" ? managerName : payerName)}は打てる所がないので、パスしました。`, "is-othello");
    case "othello_finish": {
      const verdict = event.result === "lost" ? `${Number(event.stones)}枚差で財布の負け` : event.result === "won" ? "財布の勝ち" : "引き分け";
      const save = view.role === "payer"
        ? `<button class="tribute-save-image" type="button" data-t="othello-share" data-seq="${Number(event.seq)}">画像で保存</button>`
        : "";
      return `<li class="tribute-event is-othello-finish"><div class="tribute-othello-finish"><span class="tribute-eyebrow">貢ぎオセロ ${event.resigned ? "降参" : "決着"}</span><strong>${escapeHtml(verdict)}</strong><small>財布 ${Number(event.payer)}枚／${escapeHtml(managerName)} ${Number(event.manager)}枚${Number(event.penalty) > 0 ? `・罰金 ${escapeHtml(formatPay(event.penalty))}` : "・罰金なし"}${othelloRecordText(event.record) ? `・${escapeHtml(othelloRecordText(event.record))}` : ""}</small></div>${save}${time}</li>`;
    }
    case "othello_end":
      return system(`${escapeHtml(managerName)}が対局をやめました（罰金なし）。`, "is-othello");
    case "othello_stopped":
      return system(`${escapeHtml(payerName)}が貢ぎオセロを止めました。進行中の対局は罰金なしで終わりました。`, "is-othello");
    case "extend_request":
      return system(`${escapeHtml(payerName)}が ${Number(event.days)}日の延長を申し込みました。`, "is-caps");
    case "extend_withdrawn":
      return system(`${escapeHtml(payerName)}が延長の申し込みを取り下げました。`, "is-caps");
    case "extend_accepted":
      return system(`${escapeHtml(managerName)}が延長を受けました（${Number(event.days)}日）。管理は ${escapeHtml(formatDateTime(event.expiresAt))} まで続きます。`, "is-strong");
    case "extend_declined":
      return system(`${escapeHtml(managerName)}は延長（${Number(event.days)}日）を受けませんでした。`, "is-caps");
    case "work_order":
      if (event.kind === "contest") {
        return `<li class="tribute-event is-work-order is-contest ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-work-card"><span class="tribute-eyebrow">出稼ぎの勝負</span><strong>${Number(event.days)}日以内に1on1で ${Number(event.target)}勝</strong><p class="tribute-contest-terms">負けたら罰金 ${escapeHtml(formatPay(event.penalty))}</p>${event.note ? `<p>「${escapeHtml(event.note)}」</p>` : ""}</div>${time}</li>`;
      }
      return `<li class="tribute-event is-work-order ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-work-card"><span class="tribute-eyebrow">出稼ぎ命令</span><strong>1on1を ${Number(event.target)}回 完走</strong>${event.note ? `<p>「${escapeHtml(event.note)}」</p>` : ""}</div>${time}</li>`;
    case "work_report":
      if (event.kind === "contest") {
        return system(`勝負の報告：受けた後の1on1 <b>${Number(event.count)} / ${Number(event.target)}勝</b>（サーバーが記入）${event.done ? " ・ 勝ちました" : ""}`, "is-report");
      }
      return system(`出稼ぎ報告：命令の後の1on1 <b>${Number(event.count)} / ${Number(event.target)}回</b>（サーバーが記入）${event.done ? " ・ 果たしました" : ""}`, "is-report");
    case "work_accept":
      return system(`${escapeHtml(payerName)}が勝負を受けました（${Number(event.target)}勝・期限 ${escapeHtml(formatDateTime(event.deadline))}）。`, "is-strong");
    case "work_declined":
      return system(`${escapeHtml(payerName)}は勝負を断りました。`, "is-caps");
    case "work_contest_lost":
      return `<li class="tribute-event is-contest-lost"><div class="tribute-work-card"><span class="tribute-eyebrow">勝負の負け</span><strong>${Number(event.wins)} / ${Number(event.target)}勝のまま期限が過ぎました</strong><p class="tribute-contest-terms">罰金 ${escapeHtml(formatPay(event.penalty))}</p></div>${time}</li>`;
    case "work_confirm": {
      const seal = sealLabel(event.seal)
        ? `<span class="tribute-stamp-seal">${sealSvg({ label: sealLabel(event.seal), name: managerName, at: event.createdAt, size: 64, shape: event.sealShape, ink: event.sealInk, rough: false })}</span>`
        : "";
      const reward = rewardText(event);
      const confirmed = event.kind === "contest" ? `勝負の勝ち（${Number(event.count)} / ${Number(event.target)}勝）` : `出稼ぎ（${Number(event.count)} / ${Number(event.target)}回）`;
      return `<li class="tribute-event is-system is-work-confirm"><p>${escapeHtml(managerName)}が${confirmed}を確かめました。</p>${seal}${time}</li>${reward
        ? `<li class="tribute-event is-message is-reward ${mine ? "is-mine" : "is-theirs"} is-manager"><span class="tribute-bubble"><span class="tribute-visually-hidden">${escapeHtml(managerName)}から出稼ぎへのご褒美：</span>${escapeHtml(reward)}</span>${time}</li>`
        : ""}`;
    }
    case "work_withdrawn":
      return system(event.reason === "setting"
        ? `${escapeHtml(payerName)}が出稼ぎ命令を受けるのをやめたので、命令は消えました。`
        : `${escapeHtml(managerName)}が出稼ぎ命令を取り下げました。`);
    // お預け・願い出・抵抗（2026-10-27）。
    case "hold":
      return `<li class="tribute-event is-hold-event ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-hold-card"><span class="tribute-eyebrow">お預け</span><strong>${view.role === "manager" ? "財布は、あなたが許すまで自分からは差し出せません" : `${escapeHtml(managerName)}に許されるまで、自分からは差し出せません`}</strong>${event.note ? `<p>「${escapeHtml(event.note)}」</p>` : ""}</div>${time}</li>`;
    case "unhold":
      return system(event.reason === "setting"
        ? `${escapeHtml(payerName)}がお預けを受けるのをやめたので、お預けは解けました。`
        : `${escapeHtml(managerName)}がお預けを解きました。`, "is-strong");
    case "holds_changed":
      return system(event.allowHolds
        ? `${escapeHtml(payerName)}がお預けを受けるようにしました。`
        : `${escapeHtml(payerName)}がお預けを受けるのをやめました。`, "is-caps");
    case "plea": {
      const read = mine && view.role === "payer" && view.peerReadSeq >= Number(event.seq) ? '<span class="tribute-read">既読</span>' : "";
      return `<li class="tribute-event is-plea-event ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-plea-card"><span class="tribute-eyebrow">願い出</span>${purposeTag(event.purpose, view)}<strong>${escapeHtml(formatPay(event.amount))}</strong>${event.note ? `<p>「${escapeHtml(event.note)}」</p>` : "<p>貢がせてください。</p>"}</div>${read}${time}</li>`;
    }
    case "plea_withdrawn":
      return system(event.reason === "purpose"
        ? "性的な名目の許可が外れたので、その名目の願い出を消しました。"
        : `${escapeHtml(payerName)}が願い出を取り下げました。`);
    case "plea_granted":
    case "plea_denied": {
      const granted = event.type === "plea_granted";
      return `<li class="tribute-event is-plea-answer ${granted ? "is-granted" : "is-denied"} ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-plea-card"><span class="tribute-eyebrow">${granted ? "許す" : "退ける"}</span>${granted ? `<strong>${escapeHtml(formatPay(event.amount))}</strong>` : ""}${event.note ? `<p>「${escapeHtml(event.note)}」</p>` : ""}${granted && view.role === "payer" ? "<small>1回だけ、この金額を差し出せます。</small>" : ""}</div>${time}</li>`;
    }
    case "resist": {
      const read = mine && view.role === "payer" && view.peerReadSeq >= Number(event.seq) ? '<span class="tribute-read">既読</span>' : "";
      return `<li class="tribute-event is-message is-resist ${mine ? "is-mine" : "is-theirs"} is-payer"><span class="tribute-bubble"><i class="tribute-resist-mark">抵抗 ${Number(event.count) || 1}</i>${escapeHtml(event.text)}</span>${read}${time}</li>`;
    }
    case "want_words_changed":
      return system(Number(event.count) > 0
        ? `${escapeHtml(payerName)}が言われたい言葉を変えました（${Number(event.count)}語）。`
        : `${escapeHtml(payerName)}が言われたい言葉を外しました。`, "is-caps");
    case "work_orders_changed":
      return system(event.allowWorkOrders
        ? `${escapeHtml(payerName)}が出稼ぎ命令を受けるようにしました。`
        : `${escapeHtml(payerName)}が出稼ぎ命令を受けるのをやめました。`, "is-caps");
    case "screenshots_changed":
      return system(event.allowScreenshots
        ? `${escapeHtml(payerName)}が、管理人のXにスクショを載せることを許しました。`
        : `${escapeHtml(payerName)}がスクショ掲載の許可を外しました。`, "is-caps");
    case "purposes_changed":
      return system(event.allowSexualPurposes
        ? `${escapeHtml(payerName)}が性的な名目（${escapeHtml(SEXUAL_PURPOSE_SUMMARY)}）を許しました。`
        : `${escapeHtml(payerName)}が性的な名目の許可を外しました。`, "is-caps");
    case "report":
      return system(`残高報告：財布 <b>${escapeHtml(formatPay(event.walletBalance))}</b> ・ 管理口座 <b>${escapeHtml(formatPay(event.escrowBalance))}</b>（サーバーが記入）`, "is-report");
    case "report_requested":
      return system(`${escapeHtml(managerName)}が残高報告を求めています。${view.role === "payer" && view.reportRequested && view.status === "active" ? ' <button class="button button-ghost button-small" type="button" data-t="report-balance">報告する</button>' : ""}`);
    // 限度額の変更は、管理人も読む出来事には出さない（以前の記録も出さない）。
    case "caps_lowered":
    case "caps_raise_scheduled":
    case "caps_raised":
    case "caps_raise_cancelled":
      return "";
    case "request_cancelled":
      if (event.reason === "purpose") return system("性的な名目の許可が外れたので、その名目の請求を無効にしました。");
      return event.reason === "caps" ? system("請求が無効になりました。") : system("請求が取り消されました。");
    case "request_declined":
      return system("請求を断りました。");
    case "escrow_deposit":
      return system(`管理口座へ ${escapeHtml(formatPay(event.amount))} 預けました（残高 ${escapeHtml(formatPay(event.escrowBalance))}）。管理口座のPayは、まだ預ける側のものです。`, "is-escrow");
    case "escrow_withdraw_request":
      return system(`管理口座から ${escapeHtml(formatPay(event.amount))} の使用許可を申請しました。`, "is-escrow");
    case "escrow_withdraw_cancelled":
      return system("使用許可の申請を取り下げました。", "is-escrow");
    case "escrow_approved":
      return system(`使用許可：${escapeHtml(formatPay(event.amount))} が財布へ戻りました。${refundPendingText(event)}`, "is-escrow");
    case "escrow_denied":
      return system(`使用許可は却下されました（${escapeHtml(formatPay(event.amount))}）。解約すれば、管理口座はいつでも全額戻ります。`, "is-escrow");
    case "escrow_returned":
      return system(`管理口座から ${escapeHtml(formatPay(event.amount))} を財布へ戻しました。${refundPendingText(event)}`, "is-escrow");
    case "ended":
      return system(`${escapeHtml(END_REASON_LABELS[event.reason] || "契約が終わりました")}。${event.escrowReturned ? `管理口座の ${escapeHtml(formatPay(event.escrowReturned))} は財布へ戻りました。` : ""}${refundPendingText(event)}`, "is-ended");
    default:
      return "";
  }
}

function refundPendingText(event) {
  return event.refundPending > 0 ? `残高上限のため ${escapeHtml(formatPay(event.refundPending))} を返金待ちとして保管しました。財布の持ち主が「契約」画面から受け取れます。` : "";
}

function renderThreadHead(view) {
  const counterpart = contractCounterpart(view);
  const caps = view.caps;
  const endButton = state.thread.demo ? "" : view.status === "active"
    ? view.role === "payer"
      ? `<button class="button button-danger button-small" type="button" data-t="sheet" data-sheet="end">解約</button>`
      : `<button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="end">解放</button>`
    : view.status === "pending" && view.role === "payer"
      ? `<button class="button button-ghost button-small" type="button" data-t="withdraw">取り下げる</button>`
      : "";
  const meter = (used, max, label) => {
    const ratio = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    return `<div class="tribute-meter"><span>${label}</span><b>${escapeHtml(formatPay(used))} / ${escapeHtml(formatPay(max))}</b><i style="--ratio:${ratio}%"></i></div>`;
  };
  // 管理人には呼び名の入口と、呼び名を付けた時の元の財布名を出す（呼び名は財布には見えない）。
  const nickname = view.role === "manager" && !state.thread.demo
    ? `<button class="tribute-link tribute-nickname-edit" type="button" data-t="sheet" data-sheet="nickname">${managerNickname(view) ? "呼び名を変える" : "呼び名を付ける"}</button>${managerNickname(view) ? `<small class="tribute-nickname-origin">財布名：${escapeHtml(view.payer.walletName)}</small>` : ""}`
    : "";
  return `<div class="tribute-thread-title">${sigil(counterpart.card)}<div><span class="tribute-contract-line"><strong>${escapeHtml(counterpart.name)}</strong>${nickname}
      ${view.role === "payer" ? disclosureTag(view.manager.disclosure) : '<span class="tribute-tag">あなたが管理</span>'}${statusChip(view)}</span>
      <small>${view.status === "active" ? `${escapeHtml(remainingLabel(view.expiresAt))} ・ 言葉は${escapeHtml(TONE_CEILING_LABELS[view.tone] || "普通まで")}` : view.status === "pending" ? `申し込みの期限 ${escapeHtml(formatDateTime(view.expiresAt))}` : escapeHtml(view.endReasonLabel)}</small></div>
      <div class="tribute-thread-end">${endButton}</div></div>
    ${renderThreadNext()}
    ${renderTally(view)}
    ${renderIgnoreState(view)}
    ${caps && view.status !== "ended" ? `<div class="tribute-limits"><small>あなたの限度額（${escapeHtml(view.manager.personaName)}には見えません）</small><div class="tribute-meters">
      ${meter(view.todayTributed, caps.perDay, "今日")}
      ${meter(view.totalTributed, caps.total, "契約合計")}
      <div class="tribute-meter is-plain"><span>1回</span><b>${escapeHtml(formatPay(caps.perTribute))}</b></div>
      <div class="tribute-meter is-plain"><span>管理口座</span><b>${escapeHtml(formatPay(view.escrowBalance))}</b></div>
    </div></div>` : view.role === "manager" && view.status === "active" && view.escrowBalance
      ? `<div class="tribute-meters"><div class="tribute-meter is-plain"><span>管理口座</span><b>${escapeHtml(formatPay(view.escrowBalance))}</b></div></div>`
      : ""}
    ${view.pendingCaps ? `<p class="tribute-caps-pending">限度額を上げる予約：${escapeHtml(capsText(view.pendingCaps))}（${escapeHtml(view.pendingCapsEffectiveDateKey)} 0時から）${view.role === "payer" ? ' <button class="button button-ghost button-small" type="button" data-t="cancel-raise">予約を取り消す</button>' : ""}</p>` : ""}
    ${view.ngWords.length && view.role === "manager" ? `<p class="tribute-ng">言われたくない言葉：${view.ngWords.map((word) => `<span>${escapeHtml(word)}</span>`).join("")}</p>` : ""}
    ${view.wantWords.length && view.role === "manager" ? `<p class="tribute-want">言われたい言葉：${view.wantWords.map((word) => `<span>${escapeHtml(word)}</span>`).join("")}</p>` : ""}`;
}

// 「次へ」。一覧に戻らずに、やることのある次の契約（未読・申し込み・受け取り待ちなど）を開く。見学の見本では出さない。
function renderThreadNext() {
  if (state.thread.demo) return "";
  const next = nextTodoContract(state.contracts, state.thread.contractId);
  if (!next) return "";
  const name = contractCounterpart(next.contract).name;
  return `<div class="tribute-thread-next"><button type="button" class="tribute-link" data-t="open-thread" data-contract="${escapeHtml(next.contract.contractId)}">次へ：${escapeHtml(name)}（${escapeHtml(next.label)}${["applied", "withdraw", "report", "work", "work_done", "plea", "granted", "recite", "recite_done", "extend"].includes(next.kind) ? "" : ` ${next.count}`}）</button></div>`;
}

// スレッドで変わった「やること」を、契約の一覧の行にも写す（一覧に戻る前に「次へ」が古い行を選ばないため）。
function syncContractRow(view) {
  const row = state.contracts.find((contract) => contract.contractId === state.thread.contractId);
  if (!row || !view) return;
  Object.assign(row, {
    status: view.status,
    awaitingReceipt: view.awaitingReceipt,
    pendingRequests: view.pendingRequests,
    escrowWithdrawRequest: view.escrowWithdrawRequest,
    reportRequested: view.reportRequested,
    workOrder: view.workOrder,
  });
}

// 宣言の札と既読無視。財布: 管理人の札と、未払いの請求がある間の「既読無視 ○日目」。管理人: 宣言のスイッチと未払いの合計。
function renderIgnoreState(view) {
  if (view.status !== "active") return "";
  const owed = view.pendingRequests.reduce((sum, request) => sum + request.amount, 0);
  if (view.role === "manager") {
    const on = state.profile?.card?.ignoreUnpaid === true;
    return `<label class="tribute-declaration-toggle"><span><b>未払いは既読無視</b><small>財布の画面と、掲示板のあなたのカードに出ます</small></span><input type="checkbox" data-t="toggle-declaration" ${on ? "checked" : ""} ${state.busy || state.thread.demo ? "disabled" : ""} /><i aria-hidden="true"></i></label>
      ${owed ? `<div class="tribute-owed"><span>未払いの請求</span><b>${escapeHtml(formatPay(owed))}</b></div>` : ""}`;
  }
  const oath = view.managerIgnoreUnpaid ? `<div><span class="tribute-oath">未払いは既読無視</span></div>` : "";
  const label = owed && view.ignoredSince ? ignoreLabel(view.ignoredSince) : "";
  return `${oath}${label ? `<div class="tribute-ignored" role="status"><strong>${escapeHtml(label)}</strong><span>未払い <b>${escapeHtml(formatPay(owed))}</b></span></div>` : ""}`;
}

// 管理人の宣言と「高額請求」の札（掲示板・詳細・申し込み）。
function declarationTags(card) {
  return `${card?.ignoreUnpaid ? '<span class="tribute-oath">未払いは既読無視</span>' : ""}${card?.postsScreenshots ? '<span class="tribute-shot">スクショを載せる</span>' : ""}${card?.highRequest ? '<span class="tribute-high">高額請求</span>' : ""}`;
}

// 経った時間（請求の未払い）。
function elapsedLabel(since, now = Date.now()) {
  const elapsed = Math.max(0, now - (Number(since) || now));
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}分`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}時間`;
  return `${Math.floor(elapsed / 86_400_000)}日`;
}

// 財布だけに見える、請求が限度額で払えない理由（管理人には見えない）。
function requestLimitProblem(amount, view) {
  const caps = view.caps;
  if (!caps) return "";
  if (amount > caps.perTribute) return `1回の限度額（${formatPay(caps.perTribute)}）より大きいので、いまは払えません。`;
  if (amount > caps.perDay - view.todayTributed) return `今日の限度額の残り（${formatPay(Math.max(0, caps.perDay - view.todayTributed))}）を超えるので、今日は払えません。`;
  if (amount > caps.total - view.totalTributed) return `契約合計の限度額の残り（${formatPay(Math.max(0, caps.total - view.totalTributed))}）を超えるので、いまは払えません。`;
  return "";
}

// 財布の側の請求。断るボタンはなく、払うか解約するか。あと何 Pay か、限度額が足りるか、Payの貯め方を出す。
function renderPayableRequest(event, view, purpose) {
  const amount = Number(event.amount) || 0;
  const demo = state.thread.demo === true;
  const balance = demo ? Math.max(amount, Number(state.walletBalance) || 0) : state.walletBalance;
  const short = balance === null ? 0 : Math.max(0, amount - balance);
  const problem = requestLimitProblem(amount, view);
  const payable = !problem && balance !== null && short === 0;
  const ratio = balance === null || !amount ? 0 : Math.min(100, Math.round((balance / amount) * 100));
  return `${balance === null ? "" : `<div class="tribute-request-progress"><i style="--ratio:${ratio}%"></i><span>${short ? `財布 ${escapeHtml(formatPay(balance))} ・ あと <b>${escapeHtml(formatPay(short))}</b>` : "財布で払えます"}</span></div>`}
    ${problem ? `<div class="tribute-limit-warn"><b>限度額が足りません。</b>${escapeHtml(problem)}限度額を上げると、日本時間の翌日0時から効きます。<button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="caps">限度額を変える</button></div>` : ""}
    ${short && !demo ? `<div class="tribute-earn"><small>Payを貯める</small><button type="button" data-t="earn" data-mode="battle">1on1で稼ぐ</button><button type="button" data-t="earn" data-mode="missions">デイリーミッション</button><button type="button" data-t="earn" data-mode="ai">文字コラトレーニング</button><button type="button" data-t="earn" data-mode="roulette">ルーレットの台本</button></div>` : ""}
    <button class="button button-primary button-small" type="button" data-t="give-request" data-request="${escapeHtml(event.requestId)}" data-amount="${amount}" data-purpose="${escapeHtml(purpose)}" ${payable ? "" : "disabled"}>差し出す（${escapeHtml(formatPay(amount))}）</button>
    ${renderResistRow(event, demo)}
    <small class="tribute-request-two">払うか、解約するか。請求を断ることはできません。</small>`;
}

// 抵抗。未払いの請求に、渋る一言を3回まで返せる。請求は未払いのまま残り、払うと渋った回数がレシートに残る。
function renderResistRow(event, demo = false) {
  const resists = Number(event.resists) || 0;
  const left = LIMITS.resistsPerRequest - resists;
  if (demo && !resists) return "";
  return `<div class="tribute-resist-row">${resists ? `<span class="tribute-chip is-resist">抵抗 ${resists}回</span>` : ""}${left > 0 && !demo ? `<button class="button button-ghost button-small" type="button" data-t="resist-open" data-request="${escapeHtml(event.requestId)}">抵抗する（あと${left}回）</button>` : ""}</div>`;
}

function renderThreadActions(view) {
  return `${renderThreadActionButtons(view)}${renderShotButton(view)}`;
}

function renderThreadActionButtons(view) {
  if (state.thread.demo) {
    return `<div class="tribute-actions"><button class="button button-primary tribute-give-button" type="button" data-t="sheet" data-sheet="give" ${view.allowance ? "" : "disabled"}>差し出す（見本）</button></div>
      <p class="tribute-note">見本では、差し出す・請求に応える・画像で保存を試せます。Payは動きません。</p>`;
  }
  if (view.status === "pending") {
    return view.role === "manager"
      ? `<div class="tribute-actions"><button class="button button-primary" type="button" data-t="accept">受理する${view.entryFee ? `（入場料 ${escapeHtml(formatPay(view.entryFee))}）` : ""}</button><button class="button button-ghost" type="button" data-t="decline">断る</button></div>`
      : `<p class="tribute-note">受理されると管理が始まります。${view.entryFee ? `入場料 ${escapeHtml(formatPay(view.entryFee))} は受理の時に移ります。` : ""}</p>
        <div class="tribute-actions"><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="want-words">言われたい言葉</button><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="holds-settings">お預けの設定</button><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="purposes">名目の設定</button><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="screenshots">スクショの設定</button><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="work-settings">出稼ぎの設定</button></div>`;
  }
  if (view.status !== "active") {
    // 受理されなかった申し込みには、掲示板の上のほう（最近動いた管理人）・入場料0の管理人へ案内し直す。
    const retry = view.role === "payer" && retryReasonText(view.endReason)
      ? `<div class="tribute-retry"><p>この申し込みは${retryReasonText(view.endReason)}。掲示板は最近動いた管理人から並んでいます。上のほうの管理人や、入場料0の管理人に申し込めます。</p><div class="tribute-actions"><button class="button button-primary button-small" type="button" data-t="nav" data-screen="board">管理人を探す</button><button class="button button-ghost button-small" type="button" data-t="board-free">入場料0の管理人を見る</button></div></div>`
      : "";
    // 受理された契約が終わった後は、同じ管理人に同じ条件で申し込み直せる（受理と入場料はこれまでどおり）。
    const again = view.role === "payer" && view.accepted && view.managerPublicId
      ? `<div class="tribute-again"><p>${escapeHtml(view.manager.personaName)}の管理を続けたい時は、前と同じ設定のまま申し込めます。</p><div class="tribute-actions"><button class="button button-primary button-small" type="button" data-t="reapply">同じ条件で申し込む</button></div></div>`
      : "";
    return `${retry}${again}<div class="tribute-actions"><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="report">通報</button></div>`;
  }
  const withdraw = view.escrowWithdrawRequest;
  if (view.role === "payer") {
    return `<div class="tribute-actions">
      ${renderGiveButton(view)}
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="offer-words" ${view.wordOffersToday >= LIMITS.wordOfferingsPerDay ? "disabled" : ""}>言葉を献上する</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="extend" ${view.extension ? "disabled" : ""}>${view.extension ? "延長を申し込み中" : "延長を申し込む"}</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="escrow">管理口座</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="caps">限度額を変える</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="want-words">言われたい言葉</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="holds-settings">お預けの設定</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="othello-settings">貢ぎオセロの設定</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="ranch-peek">牧場をのぞく</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="purposes">名目の設定</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="screenshots">スクショの設定</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="work-settings">出稼ぎの設定</button>
      <button class="button button-ghost button-small" type="button" data-t="report-balance">残高を報告</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="report">通報</button>
      ${previewScreen ? "" : renderBlockButton({ mode: "tribute", contractId: view.contractId }, "ブロック")}
    </div>
    ${withdraw ? `<p class="tribute-note">使用許可を申請中：${escapeHtml(formatPay(withdraw.amount))} <button class="button button-ghost button-small" type="button" data-t="cancel-withdraw">取り下げる</button></p>` : ""}`;
  }
  return `<div class="tribute-actions">
    <button class="button button-primary" type="button" data-t="sheet" data-sheet="request" ${view.pendingRequests.length < LIMITS.pendingRequests ? "" : "disabled"}>請求する</button>
    ${view.allowWorkOrders ? `<button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="work" ${view.workOrder && !view.workOrder.done ? "disabled" : ""}>${view.workOrder && !view.workOrder.done ? "出稼ぎ中" : "出稼ぎに行かせる"}</button>` : ""}
    <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="recite-order" ${view.reciteOrder && !view.reciteOrder.done ? "disabled" : ""}>${view.reciteOrder && !view.reciteOrder.done ? "復唱させています" : "復唱させる"}</button>
    ${view.allowHolds ? view.hold
    ? '<button class="button button-ghost button-small" type="button" data-t="unhold">お預けを解く</button>'
    : '<button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="hold">お預けにする</button>' : ""}
    <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="take" ${view.escrowBalance ? "" : "disabled"}>管理口座から徴収</button>
    ${view.allowReportRequests ? `<button class="button button-ghost button-small" type="button" data-t="request-report" ${view.reportRequested ? "disabled" : ""}>${view.reportRequested ? "報告待ち" : "報告を求める"}</button>` : ""}
    <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="report">通報</button>
    ${previewScreen ? "" : renderBlockButton({ mode: "tribute", contractId: view.contractId }, "ブロック")}
  </div>
  ${withdraw ? `<div class="tribute-withdraw-ask"><p>${escapeHtml(contractCounterpart(view).name)}が管理口座から ${escapeHtml(formatPay(withdraw.amount))} の使用許可を求めています。</p><div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="escrow-decision" data-approve="1">許可する</button><button class="button button-ghost button-small" type="button" data-t="escrow-decision" data-approve="0">却下する</button></div></div>` : ""}`;
}

// 管理人の定型文は、契約の強さ（財布が決めた上限）までの中から、管理人が強さを選んで出す。財布は契約の強さのまま。
function templateTone(view) {
  const allowed = tonesUpTo(view.tone);
  if (view.role !== "manager") return { tone: view.tone, allowed: [] };
  const chosen = state.thread.templateTone;
  return { tone: allowed.includes(chosen) ? chosen : allowed.at(-1), allowed };
}

// 財布の「差し出す」。お預けの間は、願い出る・願い出中・許された献上に変わる。
function renderGiveButton(view) {
  if (view.hold) {
    if (!view.plea) return '<button class="button button-primary tribute-give-button" type="button" data-t="sheet" data-sheet="plea">願い出る</button>';
    if (!view.plea.granted) return '<button class="button button-primary tribute-give-button" type="button" disabled>願い出中</button>';
    return `<button class="button button-primary tribute-give-button" type="button" data-t="give-granted">許された献上を差し出す（${escapeHtml(formatPay(view.plea.amount))}）</button>`;
  }
  return `<button class="button button-primary tribute-give-button" type="button" data-t="sheet" data-sheet="give" ${view.allowance ? "" : "disabled"}>差し出す${view.allowance ? "" : "（今日の枠なし）"}</button>`;
}

// 貢ぎオセロ（設計書15.2）。財布の石は Pay のコインで、ひっくり返されるたびに管理人の色になる。
// 始めるかどうかは管理人だけが決め、財布は契約で受けるかを選ぶ。手番の期限はない。
const OTHELLO_HANDICAP_LABELS = Object.freeze({ none: "ハンデなし", manager_corner: "管理人が角を1つ持って始める", payer_corner: "財布に角を1つあげる" });
const OTHELLO_COLUMNS = "abcdefgh";

function othelloCellName(index) {
  return `${OTHELLO_COLUMNS[index % 8]}${Math.floor(index / 8) + 1}`;
}

function othelloRecordText(record) {
  if (!record?.played) return "";
  return `通算${Number(record.played)}戦${Number(record.lost)}敗${Number(record.streak) > 1 ? `（${Number(record.streak)}連敗中）` : ""}`;
}

// 財布が差し出す罰金。財布の1回の限度額まで（限度額は財布の画面にだけある）。
function othelloPayable(view, result) {
  const cap = Number(view?.caps?.perTribute) || 0;
  return cap > 0 ? Math.min(result.penalty, cap) : result.penalty;
}

function renderOthelloNoteChips(view) {
  const situation = OTHELLO_SITUATIONS.some((entry) => entry.id === state.thread.othelloSituation) ? state.thread.othelloSituation : "flip";
  const lines = othelloLinesFor({ styles: state.profile?.card?.styles, tone: view.tone, situation, ngWords: view.ngWords });
  return `<div class="tribute-othello-situations" role="group" aria-label="一言の場面">${OTHELLO_SITUATIONS.map((entry) => `<button type="button" data-t="othello-situation" data-situation="${entry.id}" aria-pressed="${entry.id === situation}">${escapeHtml(entry.label)}</button>`).join("")}</div>
    <div class="tribute-note-chips">${lines.map((line) => `<button type="button" data-t="othello-note-pick" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div>`;
}

function renderOthello(view) {
  if (view.status !== "active" || state.thread.demo) return "";
  const manager = view.role === "manager";
  const record = othelloRecordText(view.othelloRecord);
  const game = view.othello;
  const result = view.othelloResult;
  if (!game) {
    if (result) {
      const payable = othelloPayable(view, result);
      return `<section class="tribute-othello is-result">
        <span class="tribute-eyebrow">貢ぎオセロ ${result.resigned ? "降参" : "決着"}</span>
        <p><b>${Number(result.stones)}枚差</b> × ${escapeHtml(formatPay(result.rate))} ＝ 罰金 <b>${escapeHtml(formatPay(result.penalty))}</b>${record ? ` <small>${escapeHtml(record)}</small>` : ""}</p>
        ${manager
          ? `<p class="tribute-note">財布が差し出すのを待っています。払われない時は、同じ額の請求にできます。</p>
            <div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="othello-claim">罰金を請求する</button><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="recite-order">復唱させる</button></div>`
          : `<button class="button button-primary tribute-give-button" type="button" data-t="give-othello">罰金 ${escapeHtml(formatPay(payable))} を差し出す</button>
            ${payable < result.penalty ? `<p class="tribute-note">1回の限度額までを差し出します（この額は管理人には見えません）。</p>` : ""}`}
      </section>`;
    }
    if (!view.allowOthello) return "";
    if (manager) {
      return `<section class="tribute-othello is-idle"><span class="tribute-eyebrow">貢ぎオセロ</span>
        <p>財布の石は Pay のコインです。終わった時の石の差 × 1枚あたりの額が罰金になります（財布の1回の限度額まで）。${record ? ` ${escapeHtml(record)}` : ""}</p>
        <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="othello-start">貢ぎオセロを始める</button></section>`;
    }
    return record ? `<section class="tribute-othello is-idle"><span class="tribute-eyebrow">貢ぎオセロ</span><p>${escapeHtml(record)}</p></section>` : "";
  }
  const myTurn = game.turn === view.role;
  const playable = myTurn ? new Set(othelloMoves(game.board, othelloSide(view.role))) : new Set();
  const cells = game.board.split("").map((cell, index) => {
    const canPlay = playable.has(index);
    const owner = cell === "M" ? " is-manager" : cell === "P" ? " is-payer" : "";
    const label = cell === "M" ? "管理人の石" : cell === "P" ? "財布のコイン" : canPlay ? "打てる" : "空き";
    return `<button type="button" class="tribute-othello-cell${owner}${canPlay ? " is-playable" : ""}${game.lastMove?.index === index ? " is-last" : ""}" ${canPlay ? `data-t="othello-move" data-index="${index}"` : "disabled"} aria-label="${othelloCellName(index)} ${label}"></button>`;
  }).join("");
  const last = game.lastMove
    ? game.lastMove.role === "manager"
      ? manager ? `${game.lastMove.flipped}枚奪った` : `${game.lastMove.flipped}枚奪われた`
      : manager ? `${game.lastMove.flipped}枚取り返された` : `${game.lastMove.flipped}枚取り返した`
    : "";
  const turnText = myTurn ? "あなたの手番" : manager ? "財布の手番" : `${view.manager.personaName}の手番`;
  return `<section class="tribute-othello" style="--sigil:${sigilColor(view.manager)}">
    <div class="tribute-othello-head"><span class="tribute-eyebrow">貢ぎオセロ</span><b>${escapeHtml(turnText)}</b><small>1枚 ${escapeHtml(formatPay(game.rate))}・${escapeHtml(OTHELLO_HANDICAP_LABELS[game.handicap] || "")}</small></div>
    <div class="tribute-othello-score"><span class="is-payer">財布 ${Number(game.counts.payer)}枚</span><span class="is-manager">${escapeHtml(view.manager.personaName)} ${Number(game.counts.manager)}枚</span>${last ? `<em>${escapeHtml(last)}</em>` : ""}</div>
    <div class="tribute-othello-board" role="group" aria-label="貢ぎオセロの盤">${cells}</div>
    ${myTurn ? `<label class="tribute-field"><span>一手に添える一言（任意・${LIMITS.requestNote}文字まで）</span><input data-othello-note maxlength="${LIMITS.requestNote}" autocomplete="off" /></label>${manager ? renderOthelloNoteChips(view) : ""}` : `<p class="tribute-note">相手の手番です。手番に期限はありません。</p>`}
    <div class="tribute-row">${manager
      ? '<button class="button button-ghost button-small" type="button" data-t="othello-end">対局をやめる（罰金なし）</button>'
      : '<button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="othello-resign">降参する</button>'}</div>
    ${record ? `<small class="tribute-othello-record">${escapeHtml(record)}</small>` : ""}
  </section>`;
}

// 復唱の欄。財布には言わせたい一言と回数、管理人には進み具合と、果たした復唱の確認を出す。
function renderRecite(view) {
  const order = view.status === "active" ? view.reciteOrder : null;
  if (!order) return "";
  const head = (eyebrow, title) => `<div class="tribute-work-head"><span class="tribute-eyebrow">${eyebrow}</span><strong>${title}</strong></div>`;
  const line = `<p class="tribute-recite-line">「${escapeHtml(order.text)}」</p>`;
  if (view.role === "manager") {
    if (order.done) {
      return `<section class="tribute-panel tribute-recite-panel is-done">${head("復唱の確認", `果たしました（${Number(order.target)} / ${Number(order.target)}回）`)}${line}${renderReciteConfirmControls(view)}</section>`;
    }
    return `<section class="tribute-panel tribute-recite-panel">${head("復唱させています", `いま ${Number(order.count)} / ${Number(order.target)}回`)}${line}<div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="recite-withdraw">取り下げる</button></div></section>`;
  }
  if (order.done) {
    return `<section class="tribute-panel tribute-recite-panel is-done">${head("復唱", `果たしました（${Number(order.target)} / ${Number(order.target)}回）`)}${line}<p class="tribute-work-reported">${escapeHtml(view.manager.personaName)}の確認を待っています。</p></section>`;
  }
  return `<section class="tribute-panel tribute-recite-panel">${head("復唱", `一字一句同じに ${Number(order.target)}回`)}${line}
    <p class="tribute-work-reported">いま <b>${Number(order.count)} / ${Number(order.target)}回</b></p>
    <div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="sheet" data-sheet="recite">復唱する</button></div>
    <small class="tribute-work-rule">復唱しなくても何も起きません。</small></section>`;
}

// 果たした復唱に、管理人が押す受取印とご褒美（受け取りと同じ一覧）。
function renderReciteConfirmControls(view) {
  const seals = sealsFor(state.profile?.card?.seals, view.ngWords);
  const chips = rewardChips(view, "recite-confirm");
  const chosen = seals.includes(sealChoices.get("recite")) ? sealChoices.get("recite") : seals[0];
  const look = normalizeDecorations(state.profile?.card);
  return `<div class="tribute-receive tribute-recite-confirm">
    <div class="tribute-seal-pick" role="radiogroup" aria-label="押す印">${seals.map((id) => `<label><input type="radio" name="seal-recite" value="${escapeHtml(id)}" ${id === chosen ? "checked" : ""} /><span>${sealSvg({ label: sealLabel(id), name: view.manager.personaName, at: Date.now(), size: 52, shape: look.sealShape, ink: look.sealInk, rough: false })}<small>${escapeHtml(sealLabel(id))}</small></span></label>`).join("")}</div>
    <button class="button button-primary button-small" type="button" data-t="recite-confirm">印を押して確かめる</button>
    ${chips ? `<div class="tribute-reward-chips" role="group" aria-label="ご褒美を添えて確かめる">${chips}</div>` : ""}
  </div>`;
}

// 延長の申し込み。財布には取り下げ、管理人には受ける・断るを出す。
function renderExtension(view) {
  const extension = view.status === "active" ? view.extension : null;
  if (!extension) return "";
  if (view.role === "manager") {
    return `<section class="tribute-panel tribute-extension-panel"><span class="tribute-eyebrow">延長の申し込み</span><p>${escapeHtml(contractCounterpart(view).name)}が <b>${Number(extension.days)}日</b> の延長を申し込んでいます。受けると、いまの期限（${escapeHtml(formatDateTime(view.expiresAt))}）から延びます。入場料はかかりません。</p>
      <div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="extend-accept">受ける</button><button class="button button-ghost button-small" type="button" data-t="extend-decline">断る</button></div></section>`;
  }
  return `<section class="tribute-panel tribute-extension-panel"><span class="tribute-eyebrow">延長を申し込み中</span><p><b>${Number(extension.days)}日</b> の延長を申し込んでいます。${escapeHtml(view.manager.personaName)}が受けると、いまの期限から延びます。</p>
    <div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="extend-withdraw">取り下げる</button></div></section>`;
}

// お預けの欄。財布には願い出の流れ、管理人には願い出への答えと「解く」を出す。
function renderHold(view) {
  if (view.status !== "active" || !view.hold) return "";
  const plea = view.plea;
  const manager = view.role === "manager";
  const name = manager ? contractCounterpart(view).name : view.manager.personaName;
  const note = view.hold.note ? `<p class="tribute-hold-note">「${escapeHtml(view.hold.note)}」</p>` : "";
  const summary = (entry) => `<div class="tribute-plea-line">${purposeTag(entry.purpose, view)}<strong>${escapeHtml(formatPay(entry.amount))}</strong>${entry.note ? `<span>「${escapeHtml(entry.note)}」</span>` : ""}</div>`;
  let body;
  if (manager) {
    body = plea && !plea.granted
      ? `<div class="tribute-plea-ask"><span class="tribute-eyebrow">${escapeHtml(name)}の願い出</span>${summary(plea)}<div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="plea-answer-open" data-decision="grant">許す</button><button class="button button-ghost button-small" type="button" data-t="plea-answer-open" data-decision="deny">退ける</button></div></div>`
      : plea?.granted
        ? `<p class="tribute-hold-state">${escapeHtml(formatPay(plea.amount))} の願い出を許しました。差し出すかどうかは、財布が決めます。</p>`
        : '<p class="tribute-hold-state">財布は自分からは差し出せません。願い出を待っています（請求はいつもどおり送れます）。</p>';
    body += '<div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="unhold">お預けを解く</button></div>';
  } else if (!plea) {
    body = `<p class="tribute-hold-state">${escapeHtml(name)}に許されるまで、自分からは差し出せません。請求に応えるのは、いつもどおりできます。</p><div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="sheet" data-sheet="plea">願い出る</button></div>`;
  } else if (!plea.granted) {
    body = `<div class="tribute-plea-mine"><span class="tribute-eyebrow">願い出中</span>${summary(plea)}<small>${escapeHtml(name)}の答えを待っています。</small></div><div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="plea-withdraw">取り下げる</button></div>`;
  } else {
    const problem = requestLimitProblem(plea.amount, view);
    body = `<div class="tribute-plea-mine is-granted"><span class="tribute-eyebrow">許されました</span>${summary(plea)}<small>1回だけ、この金額を差し出せます。差し出すかどうかは、あなたが決めます。</small></div>
      ${problem ? `<div class="tribute-limit-warn"><b>限度額が足りません。</b>${escapeHtml(problem)}</div>` : ""}
      <div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="give-granted" ${problem ? "disabled" : ""}>差し出す（${escapeHtml(formatPay(plea.amount))}）</button><button class="button button-ghost button-small" type="button" data-t="plea-withdraw">取り下げる</button></div>`;
  }
  return `<section class="tribute-panel tribute-hold-panel"><div class="tribute-hold-head"><span class="tribute-eyebrow">お預け中</span><small>${escapeHtml(formatDateTime(view.hold.since))}から</small></div>${note}${body}</section>`;
}

function renderTemplates(view) {
  const { tone, allowed } = templateTone(view);
  const groups = templatesFor(view.role, tone, {
    disclosure: view.manager.disclosure,
    ngWords: view.ngWords,
    allowSexual: view.allowSexualPurposes,
    collarNo: view.collarNo,
  });
  const tabs = allowed.length > 1
    ? `<div class="tribute-tone-tabs" role="group" aria-label="定型文の強さ">${[...allowed].reverse().map((key) => `<button type="button" data-t="template-tone" data-tone="${key}" aria-pressed="${key === tone}">${escapeHtml(TONE_LABELS[key])}</button>`).join("")}</div>`
    : "";
  const summary = view.role === "manager" ? `定型文（${TONE_CEILING_LABELS[view.tone] || "普通まで"}）` : `定型文（${TONE_LABELS[view.tone] || "普通"}）`;
  const own = ownWordsFor(view, "lines");
  // 管理人が選んだ型の定型文（欄で選んでいる強さのもの）。一覧の定型文より先に出す。
  const typed = view.role === "manager" ? styleTemplatesFor(state.profile?.card?.styles, tone, { ngWords: view.ngWords, collarNo: view.collarNo }) : [];
  return `<details class="tribute-templates"${state.thread.templatesOpen ? " open" : ""}><summary>${escapeHtml(summary)}</summary>
    ${own.length ? `<div class="tribute-template-group is-own"><span>自分の定型文</span><div>${own.map((line) => `<button type="button" data-t="template" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div></div>` : ""}${tabs}
    ${typed.map((group) => `<div class="tribute-template-group is-style"><span>型：${escapeHtml(group.label)}</span><div>${group.lines.map((line) => `<button type="button" data-t="template" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div></div>`).join("")}
    ${groups.map((group) => `<div class="tribute-template-group"><span>${escapeHtml(group.label)}</span><div>${group.lines.map((line) => `<button type="button" data-t="template" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div></div>`).join("")}
  </details>`;
}

// 管理人の入力欄の上に、財布の言われたい言葉を札で並べる。押すと入力欄に入る。
function renderWantChips(view) {
  if (view.role !== "manager" || !view.wantWords.length) return "";
  return `<div class="tribute-want-chips" role="group" aria-label="言われたい言葉を入れる"><small>言われたい言葉</small>${view.wantWords.map((word) => `<button type="button" data-t="want-insert" data-text="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join("")}</div>`;
}

// 受け取り・出稼ぎの確認に添えるご褒美の札。一覧は契約の強さまで、続けて財布の言われたい言葉。
function rewardChips(view, action, extra = "") {
  // 型ごとのご褒美は、管理人がカードで選んでいる型の分だけ（is-style）。
  const rewards = rewardsFor(view.tone, view.ngWords, view.role === "manager" ? state.profile?.card?.styles : []);
  const labels = new Set(rewards.map((reward) => reward.label));
  const own = ownWordsFor(view, "rewards").filter((text) => !labels.has(text));
  const words = view.wantWords.filter((word) => !labels.has(word) && !own.includes(word));
  if (!rewards.length && !words.length && !own.length) return "";
  const wordChip = (text, className) => `<button class="${className}" type="button" data-t="${action}"${extra} data-reward="${REWARD_WORD}" data-text="${escapeHtml(text)}">${escapeHtml(text)}</button>`;
  return `${rewards.map((reward) => `<button${reward.style ? ' class="is-style"' : ""} type="button" data-t="${action}"${extra} data-reward="${escapeHtml(reward.id)}">${escapeHtml(reward.label)}</button>`).join("")}${own.map((text) => wordChip(text, "is-own")).join("")}${words.map((word) => wordChip(word, "is-want")).join("")}`;
}

function renderPendingRequests(view) {
  if (view.status !== "active" || !view.pendingRequests.length) return "";
  return `<section class="tribute-panel"><h2>未払いの請求</h2><ol class="tribute-pending-requests">${view.pendingRequests.map((request) => renderEvent({ ...request, type: "request", actor: "manager" }, view, new Map())).join("")}</ol></section>`;
}

// 出稼ぎ命令。Payは動かさず、期限も罰もない。財布には進み具合（その場で数え直す）と1on1への近道、
// 管理人には財布が報告した数だけを出す。果たした命令は、管理人が印とご褒美で確かめる。
function renderWorkOrder(view) {
  const order = view.status === "active" ? view.workOrder : null;
  if (!order) return renderContestResult(view);
  const head = (eyebrow, title) => `<div class="tribute-work-head"><span class="tribute-eyebrow">${eyebrow}</span><strong>${title}</strong></div>${order.note ? `<p class="tribute-work-note">「${escapeHtml(order.note)}」</p>` : ""}`;
  if (order.kind === "contest") return renderContestOrder(view, order, head);
  const goal = `1on1を ${Number(order.target)}回 完走`;
  if (view.role === "manager") {
    if (order.done) {
      return `<section class="tribute-panel tribute-work-order is-done">${head("出稼ぎの報告", `果たしました（${Number(order.reportedCount)} / ${Number(order.target)}回）`)}
        ${renderWorkConfirmControls(view)}</section>`;
    }
    const reported = order.reportedAt
      ? `報告 <b>${Number(order.reportedCount)} / ${Number(order.target)}回</b>（${escapeHtml(formatDateTime(order.reportedAt))}）`
      : "まだ報告はありません。";
    return `<section class="tribute-panel tribute-work-order">${head("出稼ぎ命令", goal)}
      <p class="tribute-work-reported">${reported}</p>
      <div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="work-withdraw">取り下げる</button></div></section>`;
  }
  if (order.done) {
    return `<section class="tribute-panel tribute-work-order is-done">${head("出稼ぎ命令", `果たしました（${Number(order.target)} / ${Number(order.target)}回）`)}
      <p class="tribute-work-reported">${escapeHtml(view.manager.personaName)}の確認を待っています。</p></section>`;
  }
  const work = state.thread.work?.orderSeq === order.orderSeq ? state.thread.work : null;
  const count = Number.isSafeInteger(work?.count) ? work.count : null;
  const ratio = count === null ? 0 : Math.min(100, Math.round((count / order.target) * 100));
  const progress = count === null
    ? `<span>${state.thread.workLoading || !work ? "数えています…" : "数えられませんでした"}</span>`
    : `<span>いま <b>${count} / ${Number(order.target)}回</b>（命令の後の完走）</span>`;
  const reached = count !== null && count >= order.target;
  const demo = state.thread.demo === true;
  return `<section class="tribute-panel tribute-work-order">${head("出稼ぎ命令", goal)}
    <div class="tribute-work-progress"><i style="--ratio:${ratio}%"></i>${progress}<button class="tribute-link" type="button" data-t="work-refresh" ${state.thread.workLoading ? "disabled" : ""}>数え直す</button></div>
    <div class="tribute-row">${demo ? "" : `<button class="button button-primary button-small" type="button" data-t="earn" data-mode="battle">1on1へ</button>`}<button class="button ${reached ? "button-primary" : "button-ghost"} button-small" type="button" data-t="work-report">${reached ? "果たしたと報告する" : "途中まで報告する"}</button></div>
    ${demo ? "" : `<div class="tribute-earn"><small>稼いだPayを受け取る</small><button type="button" data-t="earn" data-mode="missions">デイリーミッション</button></div>`}
    <small class="tribute-work-rule">${demo
    ? "見本では完走を数えず、何も送りません。実際の命令では、通常型・戦略型1on1の完走（勝ち負けは関係なし）を数え、報告の数はサーバーが記入します。"
    : "勝ち負けは関係なく、通常型・戦略型1on1の完走だけを数えます。報告の数はサーバーが記入します。"}期限はなく、果たさなくても何も起きません。</small></section>`;
}

// 出稼ぎの勝負（設計書15.3）。財布は受けるか断るかを選び、受けた後は「完走 − 負け」の勝ち数を期限までに報告する。
// 管理人には、財布が報告した勝ち数と期限だけを出す（財布の通算は見せない）。期限が過ぎて届いていなければ、管理人が判定できる。
function renderContestOrder(view, order, head) {
  const terms = `${Number(order.days)}日以内に1on1で ${Number(order.target)}勝`;
  const penalty = `負けたら罰金 ${escapeHtml(formatPay(order.penalty))}`;
  const section = (body, extra = "") => `<section class="tribute-panel tribute-work-order is-contest${extra}">${body}</section>`;
  const deadline = order.accepted ? `期限 ${escapeHtml(formatDateTime(order.deadline))}` : "";
  const expired = contestExpired(order, Date.now());
  if (view.role === "manager") {
    if (order.done) return section(`${head("勝負の報告", `勝ちました（${Number(order.reportedCount)} / ${Number(order.target)}勝）`)}${renderWorkConfirmControls(view)}`, " is-done");
    if (!order.accepted) {
      return section(`${head("出稼ぎの勝負", terms)}<p class="tribute-contest-terms">${penalty}</p>
        <p class="tribute-work-reported">財布の返事を待っています。</p>
        <div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="work-withdraw">取り下げる</button></div>`);
    }
    const reported = order.reportedAt
      ? `報告 <b>${Number(order.reportedCount)} / ${Number(order.target)}勝</b>（${escapeHtml(formatDateTime(order.reportedAt))}）`
      : "まだ報告はありません。";
    return section(`${head("出稼ぎの勝負", terms)}<p class="tribute-contest-terms">${penalty}・${deadline}</p>
      <p class="tribute-work-reported">${reported}</p>
      ${expired ? '<p class="tribute-note">期限が過ぎました。判定すると、報告された勝ち数で負けが決まります。</p>' : ""}
      <div class="tribute-row">${expired
        ? '<button class="button button-primary button-small" type="button" data-t="work-judge">判定する</button>'
        : '<button class="button button-ghost button-small" type="button" data-t="work-withdraw">取り下げる</button>'}</div>`);
  }
  if (order.done) {
    return section(`${head("出稼ぎの勝負", `勝ちました（${Number(order.target)} / ${Number(order.target)}勝）`)}
      <p class="tribute-work-reported">${escapeHtml(view.manager.personaName)}の確認を待っています。</p>`, " is-done");
  }
  const payable = contestPayable(view, { penalty: order.penalty });
  if (!order.accepted) {
    return section(`${head("出稼ぎの勝負", terms)}<p class="tribute-contest-terms">${penalty}</p>
      ${payable < order.penalty ? `<p class="tribute-note">負けた時に差し出すのは、1回の限度額（${escapeHtml(formatPay(payable))}）までです（この額は管理人には見えません）。</p>` : ""}
      <small class="tribute-work-rule">受けた時から数えます。勝ち数は、通常型・戦略型1on1の完走から負けを引いた数です（引き分けは勝ち）。期限までに報告した勝ち数で決まります。断っても何も起きません。</small>
      <div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="work-accept" data-seq="${Number(order.orderSeq)}">受ける</button><button class="button button-ghost button-small" type="button" data-t="work-decline" data-seq="${Number(order.orderSeq)}">断る</button></div>`);
  }
  const work = state.thread.work?.orderSeq === order.orderSeq ? state.thread.work : null;
  const count = Number.isSafeInteger(work?.count) ? work.count : null;
  const ratio = count === null ? 0 : Math.min(100, Math.round((count / order.target) * 100));
  const progress = count === null
    ? `<span>${state.thread.workLoading || !work ? "数えています…" : "数えられませんでした"}</span>`
    : `<span>いま <b>${count} / ${Number(order.target)}勝</b>（受けた後の完走 − 負け）</span>`;
  const reached = count !== null && count >= order.target;
  const label = expired ? "結果を確かめる" : reached ? "勝ったと報告する" : "途中まで報告する";
  return section(`${head("出稼ぎの勝負", terms)}<p class="tribute-contest-terms">${penalty}・${deadline}</p>
    <div class="tribute-work-progress"><i style="--ratio:${ratio}%"></i>${progress}<button class="tribute-link" type="button" data-t="work-refresh" ${state.thread.workLoading ? "disabled" : ""}>数え直す</button></div>
    <div class="tribute-row">${expired || state.thread.demo ? "" : '<button class="button button-ghost button-small" type="button" data-t="earn" data-mode="battle">1on1へ</button>'}<button class="button ${reached || expired ? "button-primary" : "button-ghost"} button-small" type="button" data-t="work-report">${label}</button></div>
    <small class="tribute-work-rule">期限までに報告した勝ち数で決まります（期限の後の対戦は数えません）。勝ち数は、通常型・戦略型1on1の完走から負けを引いた数です（引き分けは勝ち）。</small>`);
}

// 財布が差し出す勝負の罰金。財布の1回の限度額まで（限度額は財布の画面にだけある）。
function contestPayable(view, result) {
  const cap = Number(view?.caps?.perTribute) || 0;
  return cap > 0 ? Math.min(result.penalty, cap) : result.penalty;
}

// 負けた勝負の罰金。自動では引き落とさず、財布が長押しで差し出すか、管理人が同じ額の請求にする。
function renderContestResult(view) {
  const result = view.status === "active" ? view.workResult : null;
  if (!result) return "";
  const head = `<div class="tribute-work-head"><span class="tribute-eyebrow">勝負の負け</span><strong>${Number(result.wins)} / ${Number(result.target)}勝・罰金 ${escapeHtml(formatPay(result.penalty))}</strong></div>`;
  if (view.role === "manager") {
    return `<section class="tribute-panel tribute-work-order is-contest tribute-contest-result">${head}
      <p class="tribute-note">財布が差し出すのを待っています。払われない時は、同じ額の請求にできます。</p>
      <div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="work-claim">罰金を請求する</button></div></section>`;
  }
  const payable = contestPayable(view, result);
  return `<section class="tribute-panel tribute-work-order is-contest tribute-contest-result">${head}
    <button class="button button-primary tribute-give-button" type="button" data-t="give-contest">罰金 ${escapeHtml(formatPay(payable))} を差し出す</button>
    ${payable < result.penalty ? '<p class="tribute-note">1回の限度額までを差し出します（この額は管理人には見えません）。</p>' : ""}</section>`;
}

// 果たした出稼ぎに、管理人が押す受取印とご褒美（受け取りと同じ一覧）。押すのは毎回管理人。
function renderWorkConfirmControls(view) {
  const seals = sealsFor(state.profile?.card?.seals, view.ngWords);
  const chips = rewardChips(view, "work-confirm");
  const chosen = seals.includes(sealChoices.get("work")) ? sealChoices.get("work") : seals[0];
  const look = normalizeDecorations(state.profile?.card);
  return `<div class="tribute-receive tribute-work-confirm">
    <div class="tribute-seal-pick" role="radiogroup" aria-label="押す印">${seals.map((id) => `<label><input type="radio" name="seal-work" value="${id}" ${id === chosen ? "checked" : ""} /><span>${sealSvg({ label: sealLabel(id), name: view.manager.personaName, at: Date.now(), size: 52, shape: look.sealShape, ink: look.sealInk, rough: false })}<small>${escapeHtml(sealLabel(id))}</small></span></label>`).join("")}</div>
    <button class="button button-primary button-small" type="button" data-t="work-confirm">印を押して確かめる</button>
    ${chips ? `<div class="tribute-reward-chips" role="group" aria-label="ご褒美を添えて確かめる">${chips}</div>` : ""}
  </div>`;
}

// 出稼ぎの進み具合（財布だけ）。命令が変わった時と開き直した時、「数え直す」を押した時にだけ、サーバーで数え直す。
async function refreshWorkProgress({ force = false } = {}) {
  const thread = state.thread;
  const view = thread.view;
  const order = view?.workOrder;
  if (view?.role !== "payer" || view.status !== "active" || !order || order.done || thread.workLoading) return;
  if (order.kind === "contest" && !order.accepted) return;
  if (!force && thread.work?.orderSeq === order.orderSeq) return;
  thread.workLoading = true;
  if (state.screen === "thread") updateThreadParts();
  let work = { orderSeq: order.orderSeq, count: null };
  try {
    const result = await call("work_progress", { contractId: view.contractId });
    if (result?.workOrder) work = { orderSeq: result.workOrder.orderSeq, count: Number(result.count) || 0 };
  } catch {
    // 数えられなかった時は「数え直す」で試し直す。
  }
  thread.workLoading = false;
  if (state.thread !== thread || state.screen !== "thread") return;
  thread.work = work;
  updateThreadParts();
}

function renderThreadHistory() {
  const thread = state.thread;
  if (thread.demo || thread.historyExhausted && !thread.historyError || !(thread.events?.[0]?.seq > 1 || thread.historyError)) return "";
  return `<div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="history-more" ${thread.historyLoading ? "disabled" : ""}>${thread.historyLoading ? "読み込み中…" : thread.historyError ? "履歴を再読み込み" : "前の履歴を読む"}</button>${thread.view?.awaitingReceipt ? '<small>古い受け取り待ちも、履歴から受け取れます。</small>' : ""}</div>`;
}

function renderThreadEvents(view) {
  const statuses = requestStatusMap(state.thread.events);
  const pending = new Set(view.status === "active" ? view.pendingRequests.map((request) => request.requestId) : []);
  // 未払いの請求の本体は上の「未払いの請求」に出す。タイムラインには、送った時点に印付きの小さな行を残す。
  return state.thread.events
    .map((event) => (event.type === "request" && pending.has(event.requestId) ? renderRequestMark(event, view) : renderEvent(event, view, statuses))).join("");
}

// タイムラインに残す、未払いの請求の印（金額・名目・未払い）。払われると、ふつうの請求の行に変わる。
function renderRequestMark(event, view) {
  const mine = event.actor === view.role;
  const purpose = purposeLabel(event.purpose, { allowSexual: view.allowSexualPurposes }) ? event.purpose : "";
  return `<li class="tribute-event is-request-mark ${mine ? "is-mine" : "is-theirs"}"><span class="tribute-request-mark"><i aria-hidden="true">請</i><span>請求 <b>${escapeHtml(formatPay(event.amount))}</b></span>${purposeTag(purpose, view)}<span class="tribute-chip is-pending">未払い</span></span>${event.note ? `<span class="tribute-request-mark-note">${escapeHtml(event.note)}</span>` : ""}<time>${escapeHtml(formatDateTime(event.createdAt))}</time></li>`;
}

// 画面を描き直しても、打ちかけのメッセージを残す（呼び名の保存・スクショ表示の切り替えなど）。
function renderKeepingDraft() {
  const draft = document.querySelector('[data-form="message"] textarea')?.value || "";
  render();
  const box = document.querySelector('[data-form="message"] textarea');
  if (draft && box) {
    box.value = draft;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// スクショ表示。会話だけを画面いっぱいに出す（見出し・財布の額・操作・入力欄を隠す）。見た目だけで、掲載の許可の代わりにはならない。
// 管理人には、財布が「スクショ掲載 可」にしている契約でだけ出す。財布には常に出す。
function canShowShot(view) {
  if (state.thread.demo) return false;
  return view.role === "payer" || view.allowScreenshots === true;
}

function renderShotButton(view) {
  return canShowShot(view) ? `<div class="tribute-actions tribute-shot-actions"><button class="button button-ghost button-small" type="button" data-t="shot-on">スクショ表示</button></div>` : "";
}

function renderThread() {
  const thread = state.thread;
  const view = thread.view;
  if (!view) {
    return frame(`<p class="tribute-empty">${thread.status === "error" ? "スレッドを開けませんでした。" : "スレッドを開いています…"}</p>`, { title: "スレッド", screenClass: "tribute-thread-screen" });
  }
  const demoBanner = thread.demo
    ? `<div class="tribute-demo-banner" role="note"><b>見学用の見本の契約です</b><span>実際の契約ではなく、相手もいません。差し出してもPayは動きません。</span><div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="nav" data-screen="board">管理人を探す</button><button class="button button-ghost button-small" type="button" data-t="nav" data-screen="hub">見学をやめる</button></div></div>`
    : "";
  return frame(`<div class="tribute-thread">
    ${demoBanner}
    <div class="tribute-thread-head" id="tributeThreadHead">${renderThreadHead(view)}</div>
    <div id="tributePendingRequests">${renderPendingRequests(view)}</div>
    <div id="tributeWorkOrder">${renderWorkOrder(view)}</div>
    <div id="tributeHold">${renderHold(view)}</div>
    <div id="tributeRecite">${renderRecite(view)}</div>
    <div id="tributeExtension">${renderExtension(view)}</div>
    <div id="tributeOthello">${renderOthello(view)}</div>
    <div id="tributeThreadHistory">${renderThreadHistory()}</div>
    <ol class="tribute-events" id="tributeThreadEvents" aria-live="polite">${renderThreadEvents(view)}</ol>
    ${view.status === "active" && !thread.demo ? `<form class="tribute-composer" data-form="message">
      <div id="tributeWantChips">${renderWantChips(view)}</div>
      <textarea name="text" maxlength="${LIMITS.message}" rows="2" placeholder="${view.role === "manager" ? "管理の言葉（相手の「言われたくない言葉」は送れません）" : "返事・報告・止める言葉"}"></textarea>
      <div class="tribute-composer-foot"><small data-composer-count>0 / ${LIMITS.message}</small><span class="tribute-form-error" data-form-error role="alert"></span><button class="button button-primary button-small" type="submit">送る</button></div>
      ${renderTemplates(view)}
    </form>` : ""}
    <div class="tribute-thread-actions" id="tributeThreadActions">${renderThreadActions(view)}</div>
    ${thread.shot ? '<button class="tribute-shot-exit" type="button" data-t="shot-off">スクショ表示を終える</button>' : ""}
  </div>`, { title: contractCounterpart(view).name, screenClass: `tribute-thread-screen${thread.shot ? " is-shot" : ""}` });
}

function updateThreadParts() {
  const view = state.thread.view;
  // 財布がスクショ掲載の許可を外したら、管理人のスクショ表示もその場で終える。
  if (state.thread.shot && view && !canShowShot(view)) {
    state.thread.shot = false;
    renderKeepingDraft();
    scrollThreadToEnd();
    return;
  }
  const head = document.querySelector("#tributeThreadHead");
  const list = document.querySelector("#tributeThreadEvents");
  const actions = document.querySelector("#tributeThreadActions");
  const composerPresent = Boolean(document.querySelector('[data-form="message"]'));
  if (!view || !head || !list || !actions || composerPresent !== (view.status === "active")) {
    render();
    scrollThreadToEnd();
    return;
  }
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const previousHeight = list.scrollHeight;
  const previousTop = list.scrollTop;
  head.innerHTML = renderThreadHead(view);
  const pending = document.querySelector("#tributePendingRequests");
  const history = document.querySelector("#tributeThreadHistory");
  if (pending) pending.innerHTML = renderPendingRequests(view);
  const work = document.querySelector("#tributeWorkOrder");
  if (work) work.innerHTML = renderWorkOrder(view);
  const holdPanel = document.querySelector("#tributeHold");
  if (holdPanel) holdPanel.innerHTML = renderHold(view);
  const recitePanel = document.querySelector("#tributeRecite");
  if (recitePanel) recitePanel.innerHTML = renderRecite(view);
  const extensionPanel = document.querySelector("#tributeExtension");
  if (extensionPanel) extensionPanel.innerHTML = renderExtension(view);
  const othelloPanel = document.querySelector("#tributeOthello");
  if (othelloPanel) othelloPanel.innerHTML = renderOthello(view);
  const wantChips = document.querySelector("#tributeWantChips");
  if (wantChips) wantChips.innerHTML = renderWantChips(view);
  if (history) history.innerHTML = renderThreadHistory();
  list.innerHTML = renderThreadEvents(view);
  actions.innerHTML = renderThreadActions(view);
  if (state.thread.preserveHistoryScroll) {
    list.scrollTop = previousTop + Math.max(0, list.scrollHeight - previousHeight);
    state.thread.preserveHistoryScroll = false;
  } else if (nearBottom) scrollThreadToEnd();
}

function scrollThreadToEnd() {
  window.requestAnimationFrame(() => {
    const list = document.querySelector("#tributeThreadEvents");
    if (list) list.scrollTop = list.scrollHeight;
  });
}

// ───────────── シート（確認・入力） ─────────────

function renderSheet() {
  const sheet = state.sheet;
  const view = state.thread.view;
  if (!sheet) return "";
  const close = `<button class="tribute-sheet-close" type="button" data-t="sheet-close" aria-label="閉じる">×</button>`;
  const wrap = (title, body) => `<div class="tribute-sheet-backdrop" data-t="sheet-close"></div><div class="tribute-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><h2>${escapeHtml(title)}</h2>${close}</header>${body}</div>`;
  if (sheet.type === "share") return renderShareSheet(sheet, wrap);
  if (sheet.type === "recruit") return renderRecruitSheet(sheet, wrap);
  if (sheet.type === "ranch-photo") return renderRanchPhotoSheet(sheet, wrap);
  if (!view) return "";
  const amountChips = (maximum, name = "amount") => {
    const chips = [10, 30, 50, 100, 300, 500, 1_000].filter((value) => value <= maximum);
    if (maximum > 0 && !chips.includes(maximum)) chips.push(maximum);
    return `<div class="tribute-amount-chips">${chips.map((value) => `<button type="button" data-t="pick-amount" data-name="${name}" data-amount="${value}">${escapeHtml(formatPay(value))}</button>`).join("")}</div>`;
  };
  switch (sheet.type) {
    case "give": {
      if (sheet.step === "hold") {
        const fee = tributeFee(sheet.amount);
        const balanceAfter = state.walletBalance === null ? null : state.walletBalance - sheet.amount;
        return wrap("差し出す", `<div class="tribute-confirm">
          <p class="tribute-eyebrow">${sheet.othello ? "貢ぎオセロの罰金" : sheet.contest ? "勝負の罰金" : sheet.granted ? "願い出て許された献上" : sheet.requestId ? "請求に応える" : "無言の献上"}</p>
          ${sheet.purpose ? `<p class="tribute-confirm-purpose">${purposeTag(sheet.purpose, view)}として</p>` : ""}
          <strong class="tribute-confirm-amount">${escapeHtml(formatPay(sheet.amount))}</strong>
          <dl class="tribute-facts">
            <div><dt>今日の残り枠</dt><dd>${escapeHtml(formatPay(Math.max(0, view.caps.perDay - view.todayTributed - sheet.amount)))}</dd></div>
            <div><dt>契約の残り枠</dt><dd>${escapeHtml(formatPay(Math.max(0, view.caps.total - view.totalTributed - sheet.amount)))}</dd></div>
            <div><dt>支払後の財布</dt><dd>${state.thread.demo ? "見本（Payは動きません）" : balanceAfter === null ? "確認中" : escapeHtml(formatPay(balanceAfter))}</dd></div>
            <div><dt>受け手の手数料（消却）</dt><dd>${escapeHtml(formatPay(fee))}</dd></div>
          </dl>
          <button type="button" class="tribute-hold" data-tribute-hold ${state.busy ? "disabled" : ""}><span class="tribute-hold-fill" aria-hidden="true"></span><span class="tribute-hold-label">長押しで差し出す</span></button>
          <small>指を離すと止まります。換金できないAnjuPayだけが動きます。</small>
          ${sheet.granted || sheet.othello || sheet.contest ? "" : '<button class="button button-ghost button-small" type="button" data-t="give-back">金額を変える</button>'}
        </div>`);
      }
      const maximum = view.allowance;
      return wrap("差し出す", `<form class="tribute-sheet-form" data-form="give">
        <p>今日あと <b>${escapeHtml(formatPay(Math.max(0, view.caps.perDay - view.todayTributed)))}</b> ・ 契約あと <b>${escapeHtml(formatPay(Math.max(0, view.caps.total - view.totalTributed)))}</b> ・ 1回 <b>${escapeHtml(formatPay(view.caps.perTribute))}</b> まで</p>
        ${amountChips(maximum)}
        <label class="tribute-field"><span>金額（Pay）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${maximum}" step="1" value="${Number(sheet.amount || "") || ""}" required /></label>
        ${purposeChoices({ allowSexual: view.allowSexualPurposes, selected: sheet.purpose || "", role: "payer" })}
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit">確認へ</button>
      </form>`);
    }
    case "request": {
      // 請求は財布の限度額に関係なく10,000 Payまで。払われない請求は、取り消すまで残る。
      const maximum = LIMITS.requestMax;
      return wrap("請求する", `<form class="tribute-sheet-form" data-form="request">
        <div class="tribute-amount-chips">${[100, 300, 500, 1_000, 3_000, 5_000, 10_000].map((value) => `<button type="button" class="${value >= 3_000 ? "is-high" : ""}" data-t="pick-amount" data-name="amount" data-amount="${value}">${escapeHtml(formatPay(value))}</button>`).join("")}</div>
        <small class="tribute-request-two">財布の限度額は見えません。払われない請求は、取り消すまで残ります（未払いの請求は${LIMITS.pendingRequests}件まで）。</small>
        <label class="tribute-field"><span>金額（Pay）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${maximum}" step="1" required /></label>
        ${purposeChoices({ allowSexual: view.allowSexualPurposes, role: "manager" })}
        <label class="tribute-field"><span>一言（${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" /></label>
        <div class="tribute-note-chips" data-note-chips>${renderNoteChips("", view)}</div>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>請求を送る</button>
      </form>`);
    }
    case "take": {
      const maximum = view.escrowBalance;
      return wrap("管理口座から徴収", `<form class="tribute-sheet-form" data-form="take">
        <p>管理口座 ${escapeHtml(formatPay(view.escrowBalance))} から徴収します。財布の限度額を超える分は徴収できません。献上として数え、相手にレシートが出ます。</p>
        ${amountChips(maximum)}
        <label class="tribute-field"><span>金額（Pay）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${maximum}" step="1" required /></label>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>徴収する</button>
      </form>`);
    }
    case "escrow":
      return wrap("管理口座", `<div class="tribute-escrow">
        <p>管理口座のPayは、まだあなたのものです。使いたい時は使用許可を申請します。<b>解約すれば、いつでも全額すぐ戻ります。</b></p>
        <dl class="tribute-facts"><div><dt>管理口座</dt><dd>${escapeHtml(formatPay(view.escrowBalance))}</dd></div><div><dt>あと預けられる</dt><dd>${escapeHtml(formatPay(view.escrowRoom))}</dd></div></dl>
        <form class="tribute-sheet-form" data-form="escrow-deposit">
          <label class="tribute-field"><span>預け入れ（契約合計の限度額 − 献上済み まで）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${view.escrowRoom}" step="1" ${view.escrowRoom ? "" : "disabled"} /></label>
          <button class="button button-primary button-small" type="submit" ${view.escrowRoom && !state.busy ? "" : "disabled"}>預ける</button>
        </form>
        <form class="tribute-sheet-form" data-form="escrow-withdraw">
          <label class="tribute-field"><span>使用許可を申請する額</span><input name="amount" type="number" inputmode="numeric" min="1" max="${view.escrowBalance}" step="1" ${view.escrowBalance && !view.escrowWithdrawRequest ? "" : "disabled"} /></label>
          <button class="button button-ghost button-small" type="submit" ${view.escrowBalance && !view.escrowWithdrawRequest && !state.busy ? "" : "disabled"}>${view.escrowWithdrawRequest ? "申請中" : "申請する"}</button>
        </form>
        <p class="tribute-form-error" data-form-error role="alert"></p>
      </div>`);
    case "caps":
      return wrap("限度額を変える", `<form class="tribute-sheet-form" data-form="caps">
        <p>限度額は管理人には見えません。下げる変更はすぐ効きます。上げる変更は日本時間の翌日0時から効き、それまで取り消せます。下げても、払えない請求は未払いのまま残ります。管理口座の超えた分は財布へ戻ります。</p>
        <small>1回の限度額を${escapeHtml(formatPay(LIMITS.googleCapThreshold))}以上にできるのは、AnjuPayウォレットを Google で保護したアカウントだけです。</small>
        <div class="tribute-three">
          <label><span>1回</span><select name="perTribute">${optionList(PER_TRIBUTE_OPTIONS, view.caps.perTribute)}</select></label>
          <label><span>1日</span><select name="perDay">${optionList(PER_DAY_OPTIONS, view.caps.perDay)}</select></label>
          <label><span>契約合計</span><select name="total">${optionList(TOTAL_OPTIONS, view.caps.total)}</select></label>
        </div>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>変更する</button>
      </form>`);
    case "purposes": {
      if (view.role !== "payer") return "";
      const allow = view.allowSexualPurposes;
      return wrap("名目の設定", `<div class="tribute-confirm">
        <p>性的な名目（<b>${escapeHtml(SEXUAL_PURPOSE_SUMMARY)}</b>）をこの契約で使うかを決めます。決めるのはあなただけで、いつでも変えられます。</p>
        <p>いま：<b>${allow ? "許可している" : "許可していない"}</b></p>
        <p class="tribute-note">許すと、管理人はこの名目で請求でき、あなたも無言の献上に付けられます。外すと、その名目の未払いの請求はすぐ無効になり、スレッドと回数の表示からも消えます。上限や解約には関係しません。</p>
        <button class="button ${allow ? "button-ghost" : "button-primary"}" type="button" data-t="set-purposes" data-allow="${allow ? "0" : "1"}" ${state.busy ? "disabled" : ""}>${allow ? "許可を外す" : "許可する"}</button>
        <button class="button button-ghost" type="button" data-t="sheet-close">閉じる</button>
      </div>`);
    }
    case "nickname": {
      if (view.role !== "manager") return "";
      return wrap("呼び名", `<form class="tribute-sheet-form" data-form="nickname">
        <p>${escapeHtml(view.payer.walletName)}に、あなただけが見える呼び名を付けます。契約の一覧・スレッド・やることに、財布名の代わりに出ます。財布には見えません。同じ財布との次の契約にも引き継ぎます。</p>
        <label class="tribute-field"><span>呼び名（${LIMITS.nickname}文字まで・空にすると外します）</span><input name="nickname" maxlength="${LIMITS.nickname}" value="${escapeHtml(managerNickname(view))}" placeholder="例：ポチ" /></label>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>保存する</button>
      </form>`);
    }
    case "screenshots": {
      if (view.role !== "payer") return "";
      const allow = view.allowScreenshots;
      return wrap("スクショの設定", `<div class="tribute-confirm">
        <p>${escapeHtml(view.manager.personaName)}の X に、あなたが写る画面（スレッド・献上レシートなど）のスクショを載せてよいかを決めます。決めるのはあなただけで、いつでも変えられます。</p>
        <p>いま：<b>${allow ? "許可している" : "許可していない"}</b></p>
        <p class="tribute-note">許すと、管理人のスレッドに「スクショ掲載 可」の札が出ます。財布名や会話が写ることがあります。外すと、それより後は載せられなくなりますが、すでに載ったものはアプリでは消せません。</p>
        <button class="button ${allow ? "button-ghost" : "button-primary"}" type="button" data-t="set-screenshots" data-allow="${allow ? "0" : "1"}" ${state.busy ? "disabled" : ""}>${allow ? "許可を外す" : "許可する"}</button>
        <button class="button button-ghost" type="button" data-t="sheet-close">閉じる</button>
      </div>`);
    }
    case "work": {
      if (view.role !== "manager") return "";
      // 型: 完走（いままでの出稼ぎ命令）か勝負（設計書15.3）。前の勝負の罰金が払われるまで、勝負は出せない。
      const contestBlocked = Boolean(view.workResult);
      const kind = sheet.kind === "contest" && !contestBlocked ? "contest" : "run";
      const notes = workOrderNotesFor(view.tone, { collarNo: view.collarNo, ngWords: view.ngWords, kind });
      const radios = (name, values, chosen, label) => `<div class="tribute-radio-row">${values.map((value) => `<label><input type="radio" name="${name}" value="${value}" ${value === chosen ? "checked" : ""} /><span>${label(value)}</span></label>`).join("")}</div>`;
      const body = kind === "contest"
        ? `<p>${escapeHtml(contractCounterpart(view).name)}に、期限までに1on1で勝ってくる勝負を申し出ます。財布が受けた時から数え、勝ち数は完走から負けを引いた数です（引き分けは勝ち）。財布は受けるか断るかを選べます。</p>
          <fieldset><legend>勝ち数</legend>${radios("target", CONTEST_TARGETS, 3, (value) => `${value}勝`)}</fieldset>
          <fieldset><legend>期限（受けた時から）</legend>${radios("days", CONTEST_DAYS, 1, (value) => `${value}日以内`)}</fieldset>
          <fieldset><legend>負けた時の罰金</legend>${radios("penalty", CONTEST_PENALTIES, 30, (value) => escapeHtml(formatPay(value)))}</fieldset>`
        : `<p>${escapeHtml(contractCounterpart(view).name)}に、1on1を完走して稼いでくるよう命じます。数えるのは、命令の後に完走した通常型・戦略型1on1だけです（勝ち負けは関係ありません）。</p>
          <fieldset><legend>回数</legend>${radios("target", WORK_ORDER_TARGETS, 3, (value) => `${value}回`)}
            <small>10回は、毎日のプレイ報酬の「本日の基本目標」です。</small></fieldset>`;
      return wrap("出稼ぎに行かせる", `<form class="tribute-sheet-form" data-form="work-order">
        <fieldset><legend>型</legend><div class="tribute-radio-row">
          <label><input type="radio" name="kind" value="run" ${kind === "run" ? "checked" : ""} /><span>完走</span></label>
          <label><input type="radio" name="kind" value="contest" ${kind === "contest" ? "checked" : ""} ${contestBlocked ? "disabled" : ""} /><span>勝負</span></label></div>
          ${contestBlocked ? "<small>前の勝負の罰金が払われるまで、次の勝負は出せません。</small>" : ""}</fieldset>
        ${body}
        <label class="tribute-field"><span>一言（${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" /></label>
        ${notes.length ? `<div class="tribute-note-chips">${notes.map((line) => `<button type="button" data-t="pick-note" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div>` : ""}
        <p class="tribute-note">${kind === "contest"
          ? "罰金は自動では引き落とされず、財布が差し出します（財布の1回の限度額まで）。払われない時は、同じ額の請求にできます。期限が過ぎても届いていなければ、あなたが判定できます。Payは新しく出ません。"
          : "Payは動かず、期限もありません。財布が報告するまで、進み具合は見えません。命令は1件ずつで、いつでも取り下げられます。"}</p>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>${kind === "contest" ? "勝負を申し出る" : "命令する"}</button>
      </form>`);
    }
    case "offer-words": {
      if (view.role !== "payer") return "";
      const left = LIMITS.wordOfferingsPerDay - view.wordOffersToday;
      return wrap("言葉を献上する", `<form class="tribute-sheet-form" data-form="offer-words">
        <p>${escapeHtml(view.manager.personaName)}に、言葉を差し出します（告白・短い話・報告など）。Payは動きません。管理人が受取印とご褒美で受け取ります。</p>
        <label class="tribute-field"><span>言葉（${LIMITS.wordOffering}文字まで）</span><textarea name="text" maxlength="${LIMITS.wordOffering}" rows="6" required></textarea></label>
        <p class="tribute-note">この契約で今日あと ${Math.max(0, left)}回 差し出せます（日本時間の0時に戻ります）。番付や貢がれ総額には数えません。</p>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy || left < 1 ? "disabled" : ""}>差し出す</button>
      </form>`);
    }
    case "recite-order": {
      if (view.role !== "manager") return "";
      const notes = sheetLinesFor("manager", view.tone, "recite", { ngWords: view.ngWords, collarNo: view.collarNo });
      return wrap("復唱させる", `<form class="tribute-sheet-form" data-form="recite-order">
        <p>${escapeHtml(contractCounterpart(view).name)}に、言わせたい一言を一字一句同じに打たせます。</p>
        <label class="tribute-field"><span>言わせたい一言（${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" required /></label>
        ${notes.length ? `<div class="tribute-note-chips">${notes.map((line) => `<button type="button" data-t="pick-note" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div>` : ""}
        <fieldset><legend>回数</legend><div class="tribute-radio-row">${RECITE_TARGETS.map((target) => `<label><input type="radio" name="target" value="${target}" ${target === 3 ? "checked" : ""} /><span>${target}回</span></label>`).join("")}</div></fieldset>
        <p class="tribute-note">復唱しなくても何も起きません。性的な言葉は、財布が性的な名目を許した契約でだけ使えます。1件ずつで、いつでも取り下げられます。</p>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>復唱させる</button>
      </form>`);
    }
    case "recite": {
      const order = view.reciteOrder;
      if (view.role !== "payer" || !order || order.done) return "";
      return wrap("復唱する", `<form class="tribute-sheet-form" data-form="recite">
        <p>次の一言を、一字一句同じに打ってください（いま ${Number(order.count)} / ${Number(order.target)}回）。</p>
        <p class="tribute-recite-line">「${escapeHtml(order.text)}」</p>
        <label class="tribute-field"><span>復唱</span><input name="text" maxlength="${LIMITS.requestNote}" autocomplete="off" required /></label>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>送る</button>
      </form>`);
    }
    case "extend": {
      if (view.role !== "payer" || view.extension) return "";
      return wrap("延長を申し込む", `<form class="tribute-sheet-form" data-form="extend">
        <p>${escapeHtml(view.manager.personaName)}に、契約の延長を申し込みます。受けてもらえると、いまの期限（${escapeHtml(formatDateTime(view.expiresAt))}）から延びます。入場料はかかりません。</p>
        <fieldset><legend>延ばす日数</legend><div class="tribute-radio-row">${DURATION_DAYS_OPTIONS.map((days, index) => `<label><input type="radio" name="days" value="${days}" ${index === 2 ? "checked" : ""} /><span>${days}日</span></label>`).join("")}</div></fieldset>
        <p class="tribute-note">限度額はそのまま続きます（契約合計の限度額も同じ）。申し込みは1件ずつで、取り下げられます。</p>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>申し込む</button>
      </form>`);
    }
    case "hold": {
      if (view.role !== "manager") return "";
      const notes = sheetLinesFor("manager", view.tone, "hold", { ngWords: view.ngWords, collarNo: view.collarNo });
      return wrap("お預けにする", `<form class="tribute-sheet-form" data-form="hold">
        <p>${escapeHtml(contractCounterpart(view).name)}が、自分から差し出せないようにします。財布は「貢がせてください」と願い出て、あなたが許すと1回だけ差し出せます。</p>
        <label class="tribute-field"><span>一言（${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" /></label>
        ${notes.length ? `<div class="tribute-note-chips">${notes.map((line) => `<button type="button" data-t="pick-note" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div>` : ""}
        <p class="tribute-note">期限はなく、「お預けを解く」まで続きます。請求はいつもどおり送れ、財布はそれに応えられます。限度額と解約は、これまでどおり財布が決めます。</p>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>お預けにする</button>
      </form>`);
    }
    case "plea": {
      if (view.role !== "payer" || !view.caps) return "";
      const maximum = view.caps.perTribute;
      const notes = sheetLinesFor("payer", view.tone, "plea", { collarNo: view.collarNo });
      return wrap("願い出る", `<form class="tribute-sheet-form" data-form="plea">
        <p>${escapeHtml(view.manager.personaName)}に「貢がせてください」と願い出ます。許されると、その金額を1回だけ差し出せます。</p>
        ${amountChips(maximum)}
        <label class="tribute-field"><span>金額（Pay・1回 ${escapeHtml(formatPay(maximum))} まで）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${maximum}" step="1" required /></label>
        ${purposeChoices({ allowSexual: view.allowSexualPurposes, role: "payer" })}
        <label class="tribute-field"><span>一言（${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" /></label>
        ${notes.length ? `<div class="tribute-note-chips">${notes.map((line) => `<button type="button" data-t="pick-note" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div>` : ""}
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>願い出る</button>
      </form>`);
    }
    case "plea-answer": {
      if (view.role !== "manager" || !view.plea || view.plea.granted) return "";
      const grant = sheet.decision === "grant";
      return wrap(grant ? "願い出を許す" : "願い出を退ける", `<form class="tribute-sheet-form" data-form="plea-answer">
        <p>${escapeHtml(contractCounterpart(view).name)}の願い出：<b>${escapeHtml(formatPay(view.plea.amount))}</b>${view.plea.note ? `「${escapeHtml(view.plea.note)}」` : ""}</p>
        <p class="tribute-note">${grant ? "許すと、財布はこの金額を1回だけ差し出せます。差し出すかどうかは財布が決めます。" : "退けると、願い出は消えます。財布はまた願い出られます。"}</p>
        <label class="tribute-field"><span>一言（任意・${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" /></label>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button ${grant ? "button-primary" : "button-ghost"}" type="submit" ${state.busy ? "disabled" : ""}>${grant ? "許す" : "退ける"}</button>
      </form>`);
    }
    case "resist": {
      if (view.role !== "payer") return "";
      const request = view.pendingRequests.find((entry) => entry.requestId === sheet.requestId);
      if (!request) return "";
      const left = LIMITS.resistsPerRequest - (Number(request.resists) || 0);
      const notes = sheetLinesFor("payer", view.tone, "resist", { collarNo: view.collarNo });
      return wrap("抵抗する", `<form class="tribute-sheet-form" data-form="resist">
        <p>請求 <b>${escapeHtml(formatPay(request.amount))}</b> に、渋る一言を返します（あと${left}回）。請求は断れず、未払いのまま残ります。払うと、抵抗した回数がレシートに残ります。</p>
        <label class="tribute-field"><span>渋る一言（${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" required /></label>
        ${notes.length ? `<div class="tribute-note-chips">${notes.map((line) => `<button type="button" data-t="pick-note" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div>` : ""}
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy || left < 1 ? "disabled" : ""}>抵抗する</button>
      </form>`);
    }
    case "ranch-peek": {
      if (view.role !== "payer") return "";
      return wrap("牧場をのぞく", renderRanchPeek(view, sheet));
    }
    case "othello-settings": {
      if (view.role !== "payer") return "";
      const allow = view.allowOthello;
      return wrap("貢ぎオセロの設定", `<div class="tribute-confirm">
        <p>${escapeHtml(view.manager.personaName)}と「貢ぎオセロ」をするかを決めます。決めるのはあなただけで、いつでも変えられます。</p>
        <p>いま：<b>${allow ? "受けている" : "受けていない"}</b></p>
        <p class="tribute-note">受けている間は、始めるかどうか・1枚あたりの額・ハンデを管理人が決めます。終わった時の石の差が罰金になり、あなたが差し出します（1回の限度額まで）。受けるのをやめると、進行中の対局は罰金なしで終わります。</p>
        <button class="button ${allow ? "button-ghost" : "button-primary"}" type="button" data-t="set-othello" data-allow="${allow ? "0" : "1"}" ${state.busy ? "disabled" : ""}>${allow ? "受けるのをやめる" : "受ける"}</button>
        <button class="button button-ghost" type="button" data-t="sheet-close">閉じる</button>
      </div>`);
    }
    case "othello-start": {
      if (view.role !== "manager") return "";
      return wrap("貢ぎオセロを始める", `<form class="tribute-sheet-form" data-form="othello-start">
        <p>${escapeHtml(view.payer.walletName || "財布")}と交互に打ちます。財布の石は Pay のコインで、終わった時の石の差 × 1枚あたりの額が罰金になります（財布の1回の限度額まで）。財布は降参できます。</p>
        <fieldset><legend>1枚あたりの額</legend><div class="tribute-radio-row">${OTHELLO_RATES.map((rate, index) => `<label><input type="radio" name="rate" value="${rate}" ${index === 0 ? "checked" : ""} /><span>${escapeHtml(formatPay(rate))}</span></label>`).join("")}</div></fieldset>
        <fieldset><legend>ハンデ</legend><div class="tribute-radio-col">${OTHELLO_HANDICAPS.map((id) => `<label><input type="radio" name="handicap" value="${id}" ${id === "none" ? "checked" : ""} /><span>${escapeHtml(OTHELLO_HANDICAP_LABELS[id])}</span></label>`).join("")}</div></fieldset>
        <label class="tribute-check"><input type="checkbox" name="managerFirst" /><span>自分が先に打つ（外すと財布が先手）</span></label>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>始める</button>
      </form>`);
    }
    case "othello-resign": {
      if (view.role !== "payer" || !view.othello) return "";
      const counts = view.othello.counts;
      const stones = Math.max(counts.manager - counts.payer, 1);
      return wrap("降参する", `<div class="tribute-confirm">
        <p>降参すると、その場であなたの負けになります。</p>
        <p>罰金：<b>${stones}枚</b> × ${escapeHtml(formatPay(view.othello.rate))} ＝ <b>${escapeHtml(formatPay(stones * view.othello.rate))}</b><small>（いまの差と1枚分の大きい方）</small></p>
        <button class="button button-primary" type="button" data-t="othello-resign" ${state.busy ? "disabled" : ""}>降参する</button>
        <button class="button button-ghost" type="button" data-t="sheet-close">まだ打つ</button>
      </div>`);
    }
    case "holds-settings": {
      if (view.role !== "payer") return "";
      const allow = view.allowHolds;
      return wrap("お預けの設定", `<div class="tribute-confirm">
        <p>${escapeHtml(view.manager.personaName)}から「お預け」を受けるかを決めます。決めるのはあなただけで、いつでも変えられます。</p>
        <p>いま：<b>${allow ? "受けている" : "受けていない"}</b></p>
        <p class="tribute-note">お預けの間は、自分からは差し出せず、「貢がせてください」と願い出て許されると1回だけ差し出せます。請求に応えるのはいつもどおりできます。受けるのをやめると、お預けと願い出はすぐ消えます。</p>
        <button class="button ${allow ? "button-ghost" : "button-primary"}" type="button" data-t="set-holds" data-allow="${allow ? "0" : "1"}" ${state.busy ? "disabled" : ""}>${allow ? "受けるのをやめる" : "受ける"}</button>
        <button class="button button-ghost" type="button" data-t="sheet-close">閉じる</button>
      </div>`);
    }
    case "want-words": {
      if (view.role !== "payer") return "";
      return wrap("言われたい言葉", `<form class="tribute-sheet-form" data-form="want-words">
        <p>${escapeHtml(view.manager.personaName)}のスレッドに出る「言われたい言葉」です。管理人の言葉選びの手がかりになり、ご褒美にも使われます。決めるのはあなただけで、いつでも変えられます。</p>
        <label class="tribute-field"><span>言われたい言葉（最大${LIMITS.wantWordCount}語・各${LIMITS.wantWordLength}文字、読点区切り・空にすると外します）</span><input name="wantWords" maxlength="80" value="${escapeHtml(view.wantWords.join("、"))}" placeholder="例：ざこ、養分、いい子" /></label>
        <p class="tribute-note">「言われたくない言葉」を含む言葉は登録できません。外部の決済や現実の金額は書けません。</p>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>保存する</button>
      </form>`);
    }
    case "work-settings": {
      if (view.role !== "payer") return "";
      const allow = view.allowWorkOrders;
      return wrap("出稼ぎの設定", `<div class="tribute-confirm">
        <p>${escapeHtml(view.manager.personaName)}から、出稼ぎ命令（1on1を○回完走して稼いでこい）を受けるかを決めます。決めるのはあなただけで、いつでも変えられます。</p>
        <p>いま：<b>${allow ? "受けている" : "受けていない"}</b></p>
        <p class="tribute-note">命令ではPayは動かず、期限も罰もありません。命令の後に完走した数を、あなたが報告します（数はサーバーが記入）。受けるのをやめると、まだ果たしていない命令はすぐ消えます。</p>
        <button class="button ${allow ? "button-ghost" : "button-primary"}" type="button" data-t="set-work-orders" data-allow="${allow ? "0" : "1"}" ${state.busy ? "disabled" : ""}>${allow ? "受けるのをやめる" : "受ける"}</button>
        <button class="button button-ghost" type="button" data-t="sheet-close">閉じる</button>
      </div>`);
    }
    case "end":
      return wrap(view.role === "payer" ? "解約する" : "解放する", `<div class="tribute-confirm">
        ${view.role === "payer"
    ? `<p>いつでも、すぐに終われます。罰も記録上の不利もありません。${view.escrowBalance ? `管理口座の <b>${escapeHtml(formatPay(view.escrowBalance))}</b> を返金します。残高上限で戻せない分は返金待ちとして保管し、「契約」画面から受け取れます。` : ""}未払いの請求は無効になります。</p>`
    : `<p>この財布の管理を終えます。管理口座の残りを返金します。残高上限で戻せない分は、預ける側の返金待ちとして保管します。</p>`}
        <button class="button button-danger" type="button" data-t="${view.role === "payer" ? "terminate" : "release"}" ${state.busy ? "disabled" : ""}>${view.role === "payer" ? "解約する" : "解放する"}</button>
        <button class="button button-ghost" type="button" data-t="sheet-close">やめる</button>
      </div>`);
    case "report":
      return wrap("通報", `<form class="tribute-sheet-form" data-form="report">
        <div class="tribute-radio-col">${Object.entries(REPORT_REASON_LABELS).map(([key, label], index) => `<label><input type="radio" name="reason" value="${key}" ${index === 0 ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`).join("")}</div>
        <label class="tribute-field"><span>補足（任意・120文字）</span><input name="note" maxlength="120" /></label>
        <p class="tribute-note">同じ月に3人から重い理由で通報された管理人カードは、掲示板から外れます。相手には通知されません。</p>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>通報する</button>
      </form>`);
    default:
      return "";
  }
}

// 差し出した直後の献上完了の画面。金額・宛先・名目・時刻・支払後の財布を、改ざんできない記録として並べる。
// 見た目は牧場のもので、実在の決済サービスの画面には似せない。
// 請求の一言の候補。名目の一言と、管理人が選んだ型の一言（is-style）を、契約の強さの上限までで出す。
function renderNoteChips(purpose, view) {
  const notes = requestNotesFor({ purpose, tone: view.tone, styles: state.profile?.card?.styles, ngWords: view.ngWords });
  const chip = (line, extra = "") => `<button type="button"${extra} data-t="pick-note" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`;
  return notes.purpose.map((line) => chip(line)).join("") + notes.style.map((line) => chip(line, ' class="is-style"')).join("");
}

// ───────────── 貢ぎ報告の画像（財布だけ・この端末の中で作る） ─────────────

let shareRenderTicket = 0;

const SHARE_OPTIONS = Object.freeze([
  Object.freeze({ key: "purpose", label: "名目を入れる" }),
  Object.freeze({ key: "amount", label: "金額を入れる" }),
  Object.freeze({ key: "marks", label: "受取印とご褒美を入れる" }),
  Object.freeze({ key: "wallet", label: "財布名を入れる" }),
]);

function openShare({ contractId, receiptId = "", seq = 0, mode = "receipt" }) {
  if (!contractId) return;
  closeSharePreview();
  state.sheet = {
    type: "share",
    contractId,
    receiptId,
    seq: Number(seq) || 0,
    mode: mode === "excerpt" || mode === "othello" ? mode : "receipt",
    options: { purpose: true, amount: true, marks: true, wallet: false },
    info: null,
    status: "loading",
    error: "",
    previewUrl: "",
    blob: null,
    fileName: "",
    rendering: false,
  };
  rerenderSheet();
  loadShareInfo(state.sheet);
}

function closeSharePreview() {
  if (["share", "recruit", "ranch-photo"].includes(state.sheet?.type) && state.sheet.previewUrl) URL.revokeObjectURL(state.sheet.previewUrl);
}

async function loadShareInfo(sheet) {
  try {
    const info = await call("share_info", { contractId: sheet.contractId, ...(sheet.receiptId ? { receiptId: sheet.receiptId } : {}) });
    if (state.sheet !== sheet) return;
    sheet.info = info;
    sheet.status = "ready";
    renderLayer();
    await refreshSharePreview();
  } catch (error) {
    if (state.sheet !== sheet) return;
    sheet.status = "error";
    sheet.error = friendlyError(error, "画像の準備ができませんでした。");
    renderLayer();
  }
}

function shareManager(info) {
  const manager = info?.manager || {};
  const disclosureKey = DISCLOSURE_SHORT[manager.disclosure] ? manager.disclosure : "undisclosed";
  if (!info?.consent || !manager.personaName) {
    return { personaName: "", disclosureKey, disclosureLabel: DISCLOSURE_LABELS[disclosureKey] };
  }
  return {
    personaName: manager.personaName,
    avatarUrl: avatarUrl(manager.avatar),
    premiumAvatar: isPremiumAvatar(manager.avatar),
    color: SIGIL_COLORS[Number(manager.sigil) || 0] || SIGIL_COLORS[0],
    disclosureKey,
    disclosureLabel: DISCLOSURE_LABELS[disclosureKey],
    styleLabel: stylesLabel(manager),
  };
}

function shareWalletLabel(sheet) {
  const info = sheet.info || {};
  if (sheet.options.wallet && info.walletName) return info.walletName;
  return info.collarNo ? `財布 ${info.collarNo}号` : "財布";
}

// スレッドから作る時は、いまの契約の許可に合わせる。レシート一覧から作る時は、本人の記録なのでそのまま。
function shareAllowSexual(sheet) {
  return !sheet.seq || state.thread.view?.allowSexualPurposes === true;
}

// 貢ぎ報告の画像にできる出来事（献上と、Pay 0 の言葉の献上）。
const SHARE_EVENT_TYPES = Object.freeze(["tribute", "word_offering"]);

function shareTribute(sheet) {
  return sheet.seq ? state.thread.events.find((event) => event.type === "tribute" && Number(event.seq) === sheet.seq) || null : null;
}

// 画像の小さな札（「抵抗×2」）。抵抗していなければ空。
function resistedMark(record) {
  const count = Math.min(LIMITS.resistsPerRequest, Math.max(0, Math.floor(Number(record?.resisted) || 0)));
  return count > 0 ? `抵抗×${count}` : "";
}

function shareReceiptData(sheet) {
  const info = sheet.info || {};
  const stored = info.receipt || null;
  const event = shareTribute(sheet);
  const source = { ...(stored || {}), ...(event || {}) };
  return {
    receiptNo: stored?.receiptNo || 0,
    kind: source.kind,
    kindLabel: [tributeKindLabel(source), resistedMark(source)].filter(Boolean).join("・"),
    amount: source.amount,
    purposeLabel: purposeLabel(source.purpose, { allowSexual: shareAllowSexual(sheet) }),
    createdAt: source.createdAt,
    receivedAt: Number(source.receivedAt || 0),
    sealLabel: sealLabel(source.seal),
    // 管理人を伏せる時は標準の印にする（飾りから管理人が分からないように）。
    sealShape: info.consent ? source.sealShape : "",
    sealInk: info.consent ? source.sealInk : "",
    rewardLabel: rewardText(source),
    pairCount: stored?.pairCount || 0,
    collarNo: Number(info.collarNo) || 0,
    walletLabel: shareWalletLabel(sheet),
    manager: shareManager(info),
  };
}

// 切り抜き: 選んだ献上までの最大3回分を「請求 → 献上（受取印）→ ご褒美」で並べる。財布や管理人の会話の文は入れない。
// 言葉の献上も1回分に数え、便箋を差し出したことだけを出す（中の文は会話と同じく入れない）。
function shareExcerptData(sheet) {
  const info = sheet.info || {};
  const view = state.thread.view;
  const events = state.thread.events;
  const allowSexual = view?.allowSexualPurposes === true;
  const entries = events.filter((event) => SHARE_EVENT_TYPES.includes(event.type) && Number(event.seq) <= sheet.seq).slice(-3);
  const items = [];
  for (const entry of entries) {
    const received = events.find((event) => event.type === "received" && Number(event.tributeSeq) === Number(entry.seq));
    if (entry.type === "word_offering") {
      items.push({
        type: "words",
        seq: entry.seq,
        receivedAt: Number(entry.receivedAt || 0),
        sealLabel: sealLabel(entry.seal),
        sealShape: info.consent ? entry.sealShape : "",
        sealInk: info.consent ? entry.sealInk : "",
        sealRotation: Number(entry.seq) % 2 ? -10 : 8,
        at: entry.createdAt,
      });
      if (rewardText(received)) items.push({ type: "reward", label: rewardText(received), at: received.createdAt });
      continue;
    }
    const tribute = entry;
    const request = tribute.requestId ? events.find((event) => event.type === "request" && event.requestId === tribute.requestId) : null;
    if (request) {
      items.push({
        type: "request",
        purposeLabel: purposeLabel(request.purpose, { allowSexual }),
        amount: request.amount,
        // 契約後の一言は連絡先なども書けるので、外に出る画像にはカードと同じ判定を通った一言だけを入れる。
        note: info.consent && !forbiddenReason(String(request.note || "")) ? String(request.note || "") : "",
        at: request.createdAt,
      });
    }
    items.push({
      type: "tribute",
      seq: tribute.seq,
      purposeLabel: purposeLabel(tribute.purpose, { allowSexual }),
      kindLabel: tributeKindLabel(tribute),
      granted: tribute.granted === true,
      resistedMark: resistedMark(tribute),
      amount: tribute.amount,
      receivedAt: Number(tribute.receivedAt || 0),
      sealLabel: sealLabel(tribute.seal),
      sealShape: info.consent ? tribute.sealShape : "",
      sealInk: info.consent ? tribute.sealInk : "",
      sealRotation: Number(tribute.seq) % 2 ? -12 : 9,
      at: tribute.createdAt,
    });
    if (rewardText(received)) items.push({ type: "reward", label: rewardText(received), at: received.createdAt });
  }
  const counts = view?.purposeCounts || {};
  const top = PURPOSES.filter((purpose) => counts[purpose.id]).sort((left, right) => counts[right.id] - counts[left.id])[0];
  return {
    at: entries.at(-1)?.createdAt || Date.now(),
    collarNo: Number(info.collarNo) || 0,
    walletLabel: shareWalletLabel(sheet),
    manager: shareManager(info),
    headline: { label: top?.label || "", count: top ? counts[top.id] : 0, rewardCount: view?.rewardCount || 0, tributeCount: view?.tributeCount || 0, wordCount: view?.wordOfferings || 0 },
    items,
  };
}

// 貢ぎオセロの決着の画像。最後の盤面と石の差・罰金・戦績を、財布の端末で描く（URL は入れない）。
function shareOthelloData(sheet) {
  const info = sheet.info || {};
  const finish = state.thread.events.find((event) => event.type === "othello_finish" && Number(event.seq) === sheet.seq) || {};
  return {
    at: Number(finish.createdAt) || Date.now(),
    board: String(finish.board || ""),
    result: finish.result || "lost",
    resigned: finish.resigned === true,
    managerStones: Number(finish.manager) || 0,
    payerStones: Number(finish.payer) || 0,
    stones: Number(finish.stones) || 0,
    penalty: Number(finish.penalty) || 0,
    rate: Number(finish.rate) || 0,
    record: othelloRecordText(finish.record),
    collarNo: Number(info.collarNo) || 0,
    walletLabel: shareWalletLabel(sheet),
    manager: shareManager(info),
  };
}

function shareFileName(sheet) {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  if (sheet.mode === "excerpt") return `omitsugi-record-${stamp}.png`;
  if (sheet.mode === "othello") return `omitsugi-othello-${stamp}.png`;
  const number = sheet.info?.receipt?.receiptNo;
  return number ? `omitsugi-receipt-${String(number).padStart(5, "0")}.png` : `omitsugi-receipt-${stamp}.png`;
}

async function refreshSharePreview() {
  const sheet = state.sheet;
  if (sheet?.type !== "share" || !sheet.info) return;
  const ticket = (shareRenderTicket += 1);
  sheet.rendering = true;
  paintSharePreview();
  try {
    const canvas = sheet.mode === "othello"
      ? await renderOthelloImage(shareOthelloData(sheet), sheet.options)
      : sheet.mode === "excerpt"
        ? await renderExcerptImage(shareExcerptData(sheet), sheet.options)
        : await renderReceiptImage(shareReceiptData(sheet), sheet.options);
    const blob = await canvasToPngBlob(canvas);
    if (ticket !== shareRenderTicket || state.sheet !== sheet) return;
    if (sheet.previewUrl) URL.revokeObjectURL(sheet.previewUrl);
    sheet.blob = blob;
    sheet.previewUrl = URL.createObjectURL(blob);
    sheet.fileName = shareFileName(sheet);
    sheet.error = "";
  } catch (error) {
    if (ticket !== shareRenderTicket || state.sheet !== sheet) return;
    sheet.error = friendlyError(error, "画像を作れませんでした。");
  }
  sheet.rendering = false;
  paintSharePreview();
}

function sharePreviewMarkup(sheet) {
  if (sheet.error) return `<p class="tribute-form-error" role="alert">${escapeHtml(sheet.error)}</p>`;
  if (!sheet.previewUrl) return `<span class="tribute-share-wait">画像を作っています…</span>`;
  return `<img src="${escapeHtml(sheet.previewUrl)}" alt="${sheet.type === "recruit" ? "作った受付カード" : sheet.type === "ranch-photo" ? "作った牧場の記念写真" : "作った貢ぎ報告の画像"}" width="1080" height="1350" />${sheet.rendering ? '<span class="tribute-share-wait is-over">作り直しています…</span>' : ""}`;
}

// 見本だけを差し替える（シート全体を描き直すと、選んでいる項目の位置が飛ぶため）。
function paintSharePreview() {
  const sheet = state.sheet;
  if (!["share", "recruit", "ranch-photo"].includes(sheet?.type)) return;
  const preview = layer.querySelector("[data-share-preview]");
  if (preview) preview.innerHTML = sharePreviewMarkup(sheet);
  for (const button of layer.querySelectorAll("[data-share-action]")) button.disabled = !sheet.blob || sheet.rendering;
}

function renderShareSheet(sheet, wrap) {
  if (sheet.status === "loading") return wrap("貢ぎ報告の画像", `<p class="tribute-empty">画像の準備をしています…</p>`);
  if (sheet.status === "error") return wrap("貢ぎ報告の画像", `<p class="tribute-form-error" role="alert">${escapeHtml(sheet.error)}</p>`);
  const info = sheet.info || {};
  // 献上からは「レシート」と「切り抜き」を選べる。言葉の献上はレシートがないので切り抜きだけ。
  const canChoose = sheet.seq > 0 && Boolean(shareTribute(sheet));
  const plainWallet = info.collarNo ? `財布 ${info.collarNo}号` : "財布";
  // 貢ぎオセロの決着の画像には、名目・受取印・ご褒美がない（金額と財布名だけを選ぶ）。
  const options = sheet.mode === "othello" ? SHARE_OPTIONS.filter((option) => option.key === "amount" || option.key === "wallet") : SHARE_OPTIONS;
  return wrap("貢ぎ報告の画像", `<div class="tribute-share">
    ${canChoose ? `<div class="tribute-radio-row" role="radiogroup" aria-label="画像の種類">${[["receipt", "このレシート"], ["excerpt", "やりとりを切り抜く"]].map(([mode, label]) => `<label><input type="radio" name="shareMode" value="${mode}" data-share-mode ${sheet.mode === mode ? "checked" : ""} /><span>${label}</span></label>`).join("")}</div>` : ""}
    <div class="tribute-share-body">
      <div class="tribute-share-preview" data-share-preview>${sharePreviewMarkup(sheet)}</div>
      <div class="tribute-share-options">${options.map((option) => `<label class="tribute-check"><input type="checkbox" data-share-option="${option.key}" ${sheet.options[option.key] ? "checked" : ""} /><span>${escapeHtml(option.label)}${option.key === "wallet" ? `<small>入れない時は「${escapeHtml(plainWallet)}」</small>` : ""}</span></label>`).join("")}</div>
    </div>
    <p class="tribute-note">${info.consent ? "管理人の名前とアイコンは、管理人が「貢ぎ報告に出してよい」にしているので入ります。" : "管理人が名前とアイコンを出す許可をしていないので、「管理人様」とシルエットになります。"}「AnjuPay・換金不可」の表記とお貢ぎ牧場の名前は必ず入り、URLは入りません。</p>
    <div class="tribute-row"><button class="button button-primary" type="button" data-t="share-send" data-share-action ${sheet.blob && !sheet.rendering ? "" : "disabled"}>共有（X など）</button><button class="button button-ghost" type="button" data-t="share-save" data-share-action ${sheet.blob && !sheet.rendering ? "" : "disabled"}>画像で保存</button></div>
    <small>スマホは共有から画像ごとXへ送れます。PCは保存してから、Xの投稿に添付します。</small>
  </div>`);
}

function openRecruit() {
  const card = state.profile?.card;
  if (!card) return;
  closeSharePreview();
  state.sheet = { type: "recruit", status: "loading", error: "", previewUrl: "", blob: null, fileName: "", rendering: false };
  rerenderSheet();
  loadRecruit(state.sheet);
}

function recruitData(card, month) {
  const disclosureKey = DISCLOSURE_SHORT[card.disclosure] ? card.disclosure : "undisclosed";
  const look = normalizeDecorations(card);
  return {
    manager: {
      personaName: card.personaName,
      avatarUrl: avatarUrl(card.avatar),
      premiumAvatar: isPremiumAvatar(card.avatar),
      color: sigilColor(card),
      disclosureKey,
      disclosureLabel: DISCLOSURE_LABELS[disclosureKey],
      styleLabel: stylesLabel(card),
    },
    vaultLabel: vaultTierInfo(card.vault?.level)?.label || "",
    ignoreUnpaid: card.ignoreUnpaid === true,
    postsScreenshots: card.postsScreenshots === true,
    highRequest: card.highRequest === true,
    ...look,
    word: card.word?.text || "",
    intro: card.intro || "",
    entryFee: Number(card.entryFee) || 0,
    activeContracts: Number(card.activeContracts) || 0,
    monthPayers: Number(month?.payers) || 0,
    achievements: (card.achievements || []).map(achievementEntry).filter(Boolean).slice(0, CARD_ACHIEVEMENT_LIMIT).map((entry) => ({ icon: entry.icon, name: entry.name })),
    at: Date.now(),
  };
}

// 自分の管理人カードを開き直して（今月の財布の人数も）、画像を描く。描くのはこの端末の中だけ。
async function loadRecruit(sheet) {
  let card = state.profile?.card;
  let month = null;
  try {
    const publicManagerId = state.profile?.publicManagerId || card?.publicManagerId;
    if (publicManagerId) {
      const detail = await call("manager", { publicManagerId });
      if (detail?.card) card = { ...card, ...detail.card };
      month = detail?.month || null;
    }
  } catch {
    // 開き直せない時は、手元のカードで描く（今月の財布は 0 人になる）。
  }
  if (state.sheet !== sheet || !card) return;
  sheet.status = "ready";
  sheet.card = card;
  renderLayer();
  sheet.rendering = true;
  paintSharePreview();
  try {
    const canvas = await renderRecruitImage(recruitData(card, month));
    const blob = await canvasToPngBlob(canvas);
    if (state.sheet !== sheet) return;
    sheet.blob = blob;
    sheet.previewUrl = URL.createObjectURL(blob);
    const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
    sheet.fileName = `omitsugi-accepting-${stamp}.png`;
  } catch (error) {
    if (state.sheet !== sheet) return;
    sheet.error = friendlyError(error, "画像を作れませんでした。");
  }
  sheet.rendering = false;
  paintSharePreview();
}

function renderRecruitSheet(sheet, wrap) {
  if (sheet.status === "loading") return wrap("受付カード", `<p class="tribute-empty">あなたの管理人カードを開いています…</p>`);
  return wrap("受付カード", `<div class="tribute-share">
    <div class="tribute-share-body">
      <div class="tribute-share-preview" data-share-preview>${sharePreviewMarkup(sheet)}</div>
      <div class="tribute-share-options"><p class="tribute-note">あなたの管理人カード（枠・中の人の札・入場料・管理中の人数・今日のひとこと・実績）を1枚の画像にします。受取印の形と朱肉で「受付中」を押します。</p>
        ${state.profile?.accepting ? "" : '<p class="tribute-note">いまは受付を止めています。受付を始めてから告知してください。</p>'}</div>
    </div>
    <p class="tribute-note">画像にURLは入りません。招待リンクは投稿の文に付き、文には中の人の札が必ず入ります。「AnjuPayだけ・現金なし」の表記も必ず入ります。</p>
    <div class="tribute-row"><button class="button button-primary" type="button" data-t="recruit-send" data-share-action ${sheet.blob && !sheet.rendering ? "" : "disabled"}>共有（X など）</button><button class="button button-ghost" type="button" data-t="recruit-save" data-share-action ${sheet.blob && !sheet.rendering ? "" : "disabled"}>画像で保存</button><button class="button button-ghost" type="button" data-t="post-invite">Xの投稿画面を開く</button></div>
    <small>スマホは共有から、画像と告知の文をまとめてXへ送れます。PCは画像を保存してから「Xの投稿画面を開く」で文とリンクを入れ、画像を添付します。</small>
  </div>`);
}

async function sendRecruitImage(saveOnly) {
  const sheet = state.sheet;
  if (sheet?.type !== "recruit" || !sheet.blob || sheet.rendering) return;
  const card = sheet.card || state.profile?.card;
  const url = inviteUrlFor(state.profile?.publicManagerId || card?.publicManagerId);
  const file = new File([sheet.blob], sheet.fileName, { type: "image/png" });
  if (!saveOnly && card && url && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `${inviteText(card)}\n${url}` });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  downloadShareBlob(sheet.blob, sheet.fileName);
  showToast(saveOnly ? "画像を保存しました。「Xの投稿画面を開く」から添付できます。" : "この端末では共有が使えないため、画像を保存しました。「Xの投稿画面を開く」から添付できます。");
}

function downloadShareBlob(blob, fileName) {
  const download = shared()?.downloadBlob;
  if (typeof download === "function") {
    download(blob, fileName);
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function sendShareImage(saveOnly) {
  const sheet = state.sheet;
  if (sheet?.type !== "share" || !sheet.blob || sheet.rendering) return;
  const file = new File([sheet.blob], sheet.fileName, { type: "image/png" });
  if (!saveOnly && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: SHARE_TEXT });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  downloadShareBlob(sheet.blob, sheet.fileName);
  showToast(saveOnly ? "画像を保存しました。Xの投稿に添付できます。" : "この端末では共有が使えないため、画像を保存しました。Xの投稿に添付できます。");
}

function renderReceiptOverlay() {
  const receipt = state.receipt;
  if (!receipt) return "";
  const purpose = purposeLabel(receipt.purpose, { allowSexual: true });
  const waiting = RECEIVABLE_KINDS.includes(receipt.kind) && !Number(receipt.receivedAt || 0);
  return `<div class="tribute-receipt-overlay" role="dialog" aria-modal="true" aria-label="献上完了">
    <section class="tribute-done">
      <span class="tribute-done-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"></circle><path d="M15 27.5l7.5 7.5L37.5 19"></path></svg></span>
      <p class="tribute-done-title">献上完了${receipt.demo ? "（見本）" : ""}</p>
      <strong class="tribute-done-amount">${escapeHtml(formatPay(receipt.amount))}</strong>
      <p class="tribute-done-to">${sigil(receipt)}<span><b>${escapeHtml(receipt.personaName)}</b> へ</span>${disclosureTag(receipt.disclosure)}</p>
      ${purpose ? `<p class="tribute-done-purpose">${escapeHtml(purpose)}</p>` : ""}
      <dl class="tribute-done-facts">
        <div><dt>種類</dt><dd>${escapeHtml(tributeKindLabel(receipt))}${resistedLabel(receipt) ? `（${escapeHtml(resistedLabel(receipt))}）` : ""}</dd></div>
        <div><dt>日時</dt><dd>${escapeHtml(formatDateTime(receipt.createdAt))}</dd></div>
        ${Number.isFinite(receipt.walletAfter) ? `<div><dt>支払後の財布</dt><dd>${escapeHtml(formatPay(receipt.walletAfter))}</dd></div>` : ""}
        <div><dt>この管理人へ</dt><dd>${Number(receipt.pairCount || 0)}回目</dd></div>
        <div><dt>献上レシート</dt><dd>No.${String(receipt.receiptNo || 0).padStart(5, "0")}</dd></div>
      </dl>
      <p class="tribute-done-status${waiting ? "" : " is-received"}">${receipt.demo ? "見本なので、Payは動いていません。実際の契約では、ここで財布から管理人へPayが移り、管理人が受け取ると受取印が押されます。" : waiting ? "受け取り待ち。管理人が受け取ると、スレッドに「受け取り完了」が付きます。" : "受け取り済み"}</p>
      <footer>非譲渡・換金不可 ・ AnjuPay only</footer>
    </section>
    <button class="button button-primary" type="button" data-t="receipt-close">閉じる</button>
  </div>`;
}

function renderReceipts() {
  const receipts = state.receipts;
  return frame(`<div class="tribute-receipts">
    <p class="tribute-note">献上レシートは、あなたにだけ見えます。譲渡も換金もできません。</p>
    ${receipts.status === "loading" && !receipts.items.length ? `<p class="tribute-empty">レシートを読み込んでいます…</p>`
    : receipts.items.length ? `<div class="tribute-receipt-list">${receipts.items.map((receipt) => `<article class="tribute-receipt is-small">
        <header><span>${escapeHtml(tributeKindLabel(receipt))}${resistedLabel(receipt) ? ` ・ ${escapeHtml(resistedLabel(receipt))}` : ""}</span><b>No.${String(receipt.receiptNo).padStart(5, "0")}</b></header>
        <p class="tribute-receipt-to">${sigil(receipt)} ${escapeHtml(receipt.personaName)} ${disclosureTag(receipt.disclosure)}</p>
        ${purposeLabel(receipt.purpose, { allowSexual: true }) ? `<p class="tribute-receipt-purpose">${escapeHtml(purposeLabel(receipt.purpose, { allowSexual: true }))}</p>` : ""}
        <strong class="tribute-receipt-amount">${escapeHtml(formatPay(receipt.amount))}</strong>
        ${Number(receipt.receivedAt || 0) ? `<p class="tribute-receipt-received">受け取り済み ${escapeHtml(formatDateTime(receipt.receivedAt))}${rewardText(receipt) ? `<b>「${escapeHtml(rewardText(receipt))}」</b>` : ""}</p>` : ""}
        ${Number(receipt.collarNo || 0) ? `<p class="tribute-receipt-collar">${escapeHtml(receipt.personaName)}の財布 ${Number(receipt.collarNo)}号</p>` : ""}
        ${Number(receipt.receivedAt || 0) && sealLabel(receipt.seal) ? `<span class="tribute-receipt-seal">${sealSvg({ label: sealLabel(receipt.seal), name: receipt.personaName, at: receipt.receivedAt, size: 88, shape: receipt.sealShape, ink: receipt.sealInk, surface: "paper", rough: false })}</span>` : ""}
        <footer>${escapeHtml(formatDateTime(receipt.createdAt))} ・ ${Number(receipt.pairCount)}回目</footer>
        ${receipt.contractId ? `<button class="tribute-save-image is-paper" type="button" data-t="share-receipt" data-receipt="${escapeHtml(receipt.receiptId)}" data-contract="${escapeHtml(receipt.contractId)}">画像で保存</button>` : ""}
      </article>`).join("")}</div>${receipts.more ? `<button class="button button-ghost" type="button" data-t="receipts-more" ${receipts.loadingMore ? "disabled" : ""}>${receipts.loadingMore ? "読み込み中…" : "もっと見る"}</button>` : ""}`
      : `<p class="tribute-empty">まだ献上していません。</p>`}
  </div>`, { title: "献上レシート" });
}

function renderLedger() {
  const ledger = state.ledger;
  const rows = (items, emptyText) => items.length
    ? `<table class="tribute-table"><thead><tr><th>相手</th><th>合計</th><th>回数</th><th>最初</th><th>最後</th></tr></thead><tbody>${items.map((row) => `<tr><td>${escapeHtml(row.counterpartName)}${row.openContractId ? ' <span class="tribute-chip is-active">契約中</span>' : ""}</td><td>${escapeHtml(formatPay(row.total))}</td><td>${row.count}</td><td>${escapeHtml(formatDateTime(row.firstAt))}</td><td>${escapeHtml(formatDateTime(row.lastAt))}</td></tr>`).join("")}</tbody></table>`
    : `<p class="tribute-empty">${escapeHtml(emptyText)}</p>`;
  return frame(`<div class="tribute-ledger">
    ${ledger.status === "loading" ? `<p class="tribute-empty">貢ぎ帳を読み込んでいます…</p>` : ""}
    <section class="tribute-panel"><h2>貢いだ相手</h2>${rows(ledger.asPayer, "まだ献上していません。")}</section>
    <section class="tribute-panel"><h2>貢がせた財布</h2>${rows(ledger.asManager, "まだ受け取っていません。")}</section>
  </div>`, { title: "貢ぎ帳" });
}

function renderRanking() {
  const ranking = state.ranking;
  const tabs = `<div class="tribute-role-switch tribute-ranking-tabs" role="group" aria-label="番付の種類">${[["score", "番付加算"], ["gross", "貢がれ総額"]].map(([kind, label]) => `<button type="button" data-t="ranking-kind" data-kind="${kind}" aria-pressed="${ranking.kind === kind ? "true" : "false"}">${label}</button>`).join("")}</div>`;
  if (ranking.kind === "gross") return frame(`<div class="tribute-ranking">${tabs}${renderGrossRanking(ranking)}</div>`, { title: "番付" });
  return frame(`<div class="tribute-ranking">
    ${tabs}
    <p class="tribute-note">管理人番付：今月の番付加算（同じ財布から1日500 Payまで）の多い順、同じなら財布の人数で並べます。毎日満額を貢ぐ財布を多く抱える管理人が上に来ます。実際の献上額とレシートは制限しません。</p>
    ${ranking.status === "loading" ? `<p class="tribute-empty">番付を読み込んでいます…</p>` : ranking.managers.length
    ? `<ol class="tribute-manager-ranking">${ranking.managers.map((row) => `<li class="${row.mine ? "is-mine" : ""}"><b>${row.rank}</b>
        <button type="button" data-t="open-manager" data-id="${escapeHtml(row.publicManagerId)}">${sigil(row)}<span><strong>${escapeHtml(row.personaName)}</strong>${disclosureTag(row.disclosure)}${vaultTag(row.vault)}</span></button>
        <em>${escapeHtml(formatPay(row.rankScore))} ・ 財布${row.payers}人</em></li>`).join("")}</ol>`
    : `<p class="tribute-empty">今月の番付はまだありません。</p>`}
  </div>`, { title: "番付" });
}

// 貢がれ総額の番付（当月）。財布3人以上から貢がれた管理人だけ、上位10まで。10位以内は X のプロフィールと番付のひとこと、
// 1〜5位は掲示板のカードにハートの札。
function renderGrossRanking(ranking) {
  const note = `<p class="tribute-note">貢がれ総額：今月、財布から貢がれた額の多い順です。財布${GROSS_RANKING.minPayers}人以上から貢がれた管理人だけが載ります（上位${GROSS_RANKING.limit}まで）。${GROSS_RANKING.limit}位以内は X のプロフィールと番付のひとことが載り、1〜${GROSS_RANKING.badgeTop}位は掲示板のカードにハートの札が付きます。番付のひとことはカードの編集で書けます。</p>`;
  if (ranking.status === "loading") return `${note}<p class="tribute-empty">番付を読み込んでいます…</p>`;
  if (!ranking.managers.length) return `${note}<p class="tribute-empty">今月の貢がれ総額の番付はまだありません。</p>`;
  return `${note}<ol class="tribute-manager-ranking tribute-gross-ranking">${ranking.managers.map((row) => `<li class="${row.mine ? "is-mine" : ""}"><b>${Number(row.rank)}</b>
      <div class="tribute-gross-main">
        <button type="button" data-t="open-manager" data-id="${escapeHtml(row.publicManagerId)}">${sigil(row)}<span><strong>${escapeHtml(row.personaName)}</strong>${rankHeart(row.rank)}${disclosureTag(row.disclosure)}${vaultTag(row.vault)}</span></button>
        ${row.rankingWord ? `<span class="tribute-gross-word">${escapeHtml(row.rankingWord)}</span>` : ""}
        ${xProfileButton(row)}
      </div>
      <em>${escapeHtml(formatPay(row.receivedGross))}<small>財布${Number(row.payers || 0)}人</small></em></li>`).join("")}</ol>`;
}

// ───────────── 金庫 ─────────────
// 管理人の金庫。Pay は自分のもののままで、いつでも出し入れできる。外に見せるのは段階だけ（額は本人だけ）。
const VAULT_SLOT_LABELS = Object.freeze({ frame: "カードの枠", sealShape: "受取印の形", sealInk: "朱肉" });

function renderVault() {
  const data = state.vault.data;
  if (!data) return frame(`<p class="tribute-empty">${state.vault.status === "error" ? "金庫を開けませんでした。" : "金庫を読み込んでいます…"}</p>`, { title: "金庫" });
  const vault = data.vault || {};
  const ranking = Array.isArray(data.ranking) ? data.ranking : [];
  return frame(`<div class="tribute-vault">
    ${renderMyVault(vault)}
    <section class="tribute-panel">
      <h2>金庫番付 <small>段階の高い順・同じ段階は先に届いた順</small></h2>
      <p class="tribute-note">金庫の額は本人にしか見えません。番付に出るのは段階だけです。</p>
      ${ranking.length
    ? `<ol class="tribute-manager-ranking tribute-vault-ranking">${ranking.map((row) => `<li class="${row.mine ? "is-mine" : ""}"><b>${Number(row.rank)}</b>
        <button type="button" data-t="open-manager" data-id="${escapeHtml(row.publicManagerId)}">${sigil(row)}<span><strong>${escapeHtml(row.personaName)}</strong>${disclosureTag(row.disclosure)}</span></button>
        <em>${vaultTag(row.vault)}</em></li>`).join("")}</ol>`
    : `<p class="tribute-empty">まだ段階のある金庫はありません。</p>`}
    </section>
    <section class="tribute-panel">
      <h2>段階と金庫の飾り</h2>
      <ul class="tribute-vault-tiers">${VAULT_TIERS.map((tier) => {
    const item = VAULT_DECORATION_ITEMS.find((entry) => entry.tier === tier.level);
    const reached = Number(vault.bestTier) >= tier.level;
    return `<li class="${reached ? "is-reached" : ""}${Number(vault.tier) === tier.level ? " is-current" : ""}"><b><i aria-hidden="true">庫</i>${escapeHtml(tier.label)}</b><span>${escapeHtml(formatPay(tier.threshold))}〜</span><small>${item ? `${escapeHtml(VAULT_SLOT_LABELS[item.slot])}「${escapeHtml(item.name)}」` : ""}${reached ? " ・ 使える" : ""}</small></li>`;
  }).join("")}</ul>
      <small>段階は、いま金庫にある額で決まります。一度届いた段階の飾りは、金庫から出してもずっと使えます。飾りはカードの編集で選べます（ストアでは売っていません）。</small>
    </section>
  </div>`, { title: "金庫" });
}

function renderMyVault(vault) {
  const pending = state.vault.pendingMove;
  const qualify = `お貢ぎ牧場で累計${VAULT_QUALIFY.payers}人以上の財布から、合わせて${escapeHtml(formatPay(VAULT_QUALIFY.received))}以上を受け取った管理人が、金庫を作れます（推し値市場の実績は数えません）。`;
  if (!vault.hasCard) {
    return `<section class="tribute-panel tribute-vault-mine"><span class="tribute-eyebrow">あなたの金庫</span><h2>金庫は管理人のもの</h2>
      <p>${qualify}</p><button class="button button-ghost button-small" type="button" data-t="nav" data-screen="card">管理人カードを作る</button></section>`;
  }
  if (!vault.qualified) {
    const progress = vault.progress || { payers: 0, received: 0 };
    return `<section class="tribute-panel tribute-vault-mine"><span class="tribute-eyebrow">あなたの金庫</span><h2>金庫まで、あと少し</h2>
      <p>${qualify}</p>
      <dl class="tribute-facts">
        <div><dt>献上してくれた財布</dt><dd>${Number(progress.payers)} / ${VAULT_QUALIFY.payers}人</dd></div>
        <div><dt>受け取った累計</dt><dd>${escapeHtml(formatPay(progress.received))} / ${escapeHtml(formatPay(VAULT_QUALIFY.received))}</dd></div>
      </dl></section>`;
  }
  const amount = Number(vault.amount) || 0;
  const current = vaultTierInfo(vaultTierFor(amount));
  const next = VAULT_TIERS.find((tier) => tier.level === (current?.level || 0) + 1) || null;
  const floor = current?.threshold || 0;
  const ratio = next ? Math.min(1, Math.max(0, (amount - floor) / (next.threshold - floor))) : 1;
  const balance = state.walletBalance;
  const chips = [[1_000, "1,000"], [5_000, "5,000"], [10_000, "10,000"], ["wallet", "財布の全部"], ["vault", "金庫の全部"]];
  return `<section class="tribute-panel tribute-vault-mine is-tier-${escapeHtml(current?.id || "none")}"><span class="tribute-eyebrow">あなたの金庫</span>
    <div class="tribute-vault-head">${current ? vaultTag({ level: current.level }) : '<span class="tribute-tag is-vault is-empty">まだ段階なし</span>'}<strong>${escapeHtml(formatPay(amount))}</strong><small>金庫の額はあなたにしか見えません</small></div>
    ${next
    ? `<div class="tribute-vault-next"><div class="tribute-request-progress" aria-hidden="true"><i style="width:${Math.round(ratio * 100)}%"></i></div><small>「${escapeHtml(next.label)}」まで あと ${escapeHtml(formatPay(next.threshold - amount))}</small></div>`
    : `<p class="tribute-note">最高段階の「${escapeHtml(current.label)}」です。</p>`}
    <form class="tribute-vault-form" data-form="vault">
      <label class="tribute-field"><span>金額（Pay）</span><input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${pending ? pending.amount : ""}" ${pending ? "readonly" : ""} required /></label>
      ${pending ? `<p class="tribute-note">${escapeHtml(formatPay(pending.amount))}の${pending.direction === "deposit" ? "入金" : "出金"}結果を確認してください。再確認しても二重には移動しません。</p>` : `<div class="tribute-amount-chips">${chips.map(([value, label]) => `<button type="button" data-t="vault-chip" data-amount="${value}">${escapeHtml(label)}</button>`).join("")}</div>`}
      <div class="tribute-row"><button class="button button-primary button-small" type="submit" name="direction" value="deposit" ${state.busy || pending?.direction === "withdraw" ? "disabled" : ""}>${pending?.direction === "deposit" ? "入金結果を再確認" : "金庫に入れる"}</button><button class="button button-ghost button-small" type="submit" name="direction" value="withdraw" ${state.busy || pending?.direction === "deposit" || (!pending && !amount) ? "disabled" : ""}>${pending?.direction === "withdraw" ? "出金結果を再確認" : "金庫から出す"}</button></div>
      <small>財布 ${balance === null ? "確認中" : escapeHtml(formatPay(balance))}。金庫の Pay はあなたのもののままで、いつでも財布に出せます。献上や買い物に使う時は、財布に出してください。</small>
      <p class="tribute-form-error" data-form-error role="alert">${escapeHtml(state.vault.moveError || "")}</p>
    </form>
  </section>`;
}

function render() {
  if (!active) return;
  if (state.screen === "loading") {
    appRoot.innerHTML = renderLoading();
    return;
  }
  const renderers = {
    error: renderError,
    age: renderAge,
    hub: renderHub,
    board: renderBoard,
    manager: renderManagerDetail,
    apply: renderApply,
    card: renderCardEditor,
    thread: renderThread,
    receipts: renderReceipts,
    ledger: renderLedger,
    ranking: renderRanking,
    vault: renderVault,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderHub)();
  // スクショ表示の間は、サイトの見出しと足元も隠す。
  document.body?.classList.toggle("tribute-shot-mode", state.screen === "thread" && state.thread?.shot === true);
  renderLayer();
}

function renderLayer() {
  layer.innerHTML = active ? `${renderSheet()}${renderReceiptOverlay()}` : "";
}

function rerenderSheet() {
  renderLayer();
  window.requestAnimationFrame(() => layer.querySelector(".tribute-sheet input, .tribute-sheet select, [data-tribute-hold]")?.focus?.({ preventScroll: true }));
}

function rerenderReceipt() {
  renderLayer();
  window.requestAnimationFrame(() => layer.querySelector('[data-t="receipt-close"]')?.focus?.({ preventScroll: true }));
}

// ───────────── データの読み込み ─────────────

// トップの「お貢ぎ牧場の契約を開く」は、管理人カードか契約がある人の端末にだけ出す。app.js がこの印を読む（サーバーには聞かない）。
const RANCH_REGULAR_STORAGE_KEY = "hariai.ranch.regular.v1";

function rememberRanchRegular() {
  if (previewScreen) return;
  try {
    if (state.profile?.card || state.contracts.length) window.localStorage.setItem(RANCH_REGULAR_STORAGE_KEY, "1");
    else window.localStorage.removeItem(RANCH_REGULAR_STORAGE_KEY);
  } catch {
    // 覚えられない端末では、トップのボタンが出ないだけ。
  }
}

// 牧場にいる間は URL に ?open=ranch を付ける（読み直しやホーム画面への追加で、牧場に戻れる）。トップへ戻る時に外す。
function markRanchUrl(open) {
  if (previewScreen) return;
  try {
    const url = new URL(window.location.href);
    const marked = url.searchParams.get(RANCH_OPEN_QUERY.key) === RANCH_OPEN_QUERY.value;
    if (open === marked) return;
    if (open) url.searchParams.set(RANCH_OPEN_QUERY.key, RANCH_OPEN_QUERY.value);
    else url.searchParams.delete(RANCH_OPEN_QUERY.key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // URL を書き換えられなくても、牧場はそのまま使える。
  }
}

function applyState(payload) {
  state.ageConfirmed = payload.ageConfirmed === true;
  if (payload.profile) state.profile = payload.profile;
  if (Array.isArray(payload.contracts)) {
    state.contracts = payload.contracts;
    rememberRanchRegular();
    state.ended = { more: payload.endedMore === true, cursor: payload.endedCursor || null, loading: false };
  }
  if (payload.achievements && typeof payload.achievements === "object") {
    state.achievements = {
      stats: payload.achievements.stats || {},
      unlocked: Array.isArray(payload.achievements.unlocked) ? payload.achievements.unlocked : [],
    };
    notifyAchievementUnlocks(payload.achievements.newlyUnlocked);
  }
}

// 牧場で知らせる実績（牧場の実績と、終わった牧場基金の限定称号）。
function isRanchAchievement(definition) {
  return definition?.scope === "tribute" || definition?.family === "tribute_honor";
}

// 解除した実績は共通の演出で知らせ、表示済みとしてサーバーへ伝える（失敗しても次の読み込みで再通知される）。
function notifyAchievementUnlocks(value) {
  const catalog = window.HariaiAchievements;
  if (!catalog || !Array.isArray(value) || !value.length) return;
  const ids = (catalog.normalizeIds?.(value, catalog.catalog?.length || 400) || [])
    .filter((id) => isRanchAchievement(catalog.byId?.get?.(id)));
  if (!ids.length) return;
  if (state.achievements) {
    state.achievements.unlocked = [...new Set([...state.achievements.unlocked, ...ids])];
  }
  window.dispatchEvent(new CustomEvent("hariai-achievements-unlocked", { detail: { ids } }));
  if (previewScreen) return;
  economyActionCallable({ action: "ack_achievements", achievementIds: ids }).catch(() => {
    // 次に開いた時、未表示のまま残った実績をもう一度知らせる。
  });
}

// 同じ入場中・同じ利用者の進行中リクエストだけを共有する。完了後の再表示や手動更新は必ず再取得する。
function requestState({ fresh = false, summaryOnly = false } = {}) {
  const generation = lifecycleGeneration;
  const targetState = state;
  const uid = state.uid;
  if (!previewScreen && auth.currentUser?.uid !== uid) {
    return Promise.reject(Object.assign(new Error("アカウントを確認できませんでした。ページを読み直してください。"), { code: "unauthenticated" }));
  }
  if (!fresh && stateRequest?.generation === generation && stateRequest?.targetState === targetState && stateRequest?.uid === uid && stateRequest?.summaryOnly === summaryOnly) {
    return stateRequest.promise;
  }
  const request = { generation, targetState, uid, summaryOnly, promise: null };
  stateRequest = request;
  request.promise = (async () => {
    const payload = await call("state", summaryOnly ? { summaryOnly: true } : {});
    if (!isCurrent(generation) || state !== targetState || state.uid !== uid || stateRequest !== request
      || (!previewScreen && auth.currentUser?.uid !== uid)) return null;
    applyState(payload);
    return payload;
  })().finally(() => {
    if (stateRequest === request) stateRequest = null;
  });
  return request.promise;
}

async function refreshState() {
  const generation = lifecycleGeneration;
  const targetState = state;
  try {
    const payload = await requestState();
    if (!payload || !isCurrent(generation) || state !== targetState) return;
    if (["hub"].includes(state.screen)) render();
  } catch (error) {
    if (isCurrent(generation)) showToast(friendlyError(error));
  }
}

async function loadBoard() {
  const generation = lifecycleGeneration;
  const target = state.board = { ...state.board, status: "loading" };
  render();
  try {
    const payload = await readOnce("board", { nekamaOnly: state.board.nekamaOnly });
    if (!payload || !isCurrent(generation) || state.board !== target) return;
    state.board = { ...state.board, status: "ready", managers: payload.managers || [] };
  } catch (error) {
    if (!isCurrent(generation) || state.board !== target) return;
    state.board.status = "error";
    showToast(friendlyError(error));
  }
  if (state.screen === "board") render();
}

async function openManager(publicManagerId, { invited = false } = {}) {
  const generation = lifecycleGeneration;
  stopThread();
  state.screen = "manager";
  const target = state.manager = { status: "loading", publicManagerId, data: null, invited };
  render();
  try {
    const payload = await readOnce("manager", { publicManagerId });
    if (!payload || !isCurrent(generation) || state.manager !== target || state.screen !== "manager") return;
    state.manager = { status: "ready", publicManagerId, data: payload, invited };
  } catch (error) {
    if (!isCurrent(generation) || state.manager !== target || state.screen !== "manager") return;
    state.manager.status = "error";
    showToast(friendlyError(error));
  }
  if (state.screen === "manager") render();
}

async function loadList(key, action, mapper, payload = {}) {
  const generation = lifecycleGeneration;
  const target = state[key] = { ...state[key], status: "loading", loadingMore: false };
  render();
  try {
    const result = await readOnce(action, payload);
    if (!result || !isCurrent(generation) || state[key] !== target) return;
    state[key] = { ...state[key], status: "ready", ...mapper(result) };
  } catch (error) {
    if (!isCurrent(generation) || state[key] !== target) return;
    state[key].status = "error";
    showToast(friendlyError(error));
  }
  if (state.screen === key) render();
}

// 番付は「番付加算」と「貢がれ総額」を切り替える。読み込む間は、もう一方の行を出さない。
function loadRanking(kind = state.ranking.kind || "score") {
  state.ranking = { ...state.ranking, kind, managers: [] };
  loadList("ranking", "rankings", (payload) => ({ managers: payload.managers || [], monthKey: payload.monthKey || "" }), kind === "gross" ? { kind } : {});
}

function navigate(requested, { refresh = true } = {}) {
  const screen = SCREEN_ALIASES[requested] || requested;
  if (!SCREENS.has(screen)) return;
  if (screen !== "thread") stopThread();
  closeSharePreview();
  state.sheet = null;
  state.screen = screen;
  if (screen === "vault" && !state.vault.pendingMove) state.vault.pendingMove = storedVaultMove();
  window.scrollTo?.({ top: 0 });
  if (screen === "board") loadBoard();
  else if (screen === "receipts") loadList("receipts", "receipts", (payload) => ({ items: payload.receipts || [], more: payload.more === true, cursor: payload.nextCursor || null }));
  else if (screen === "ledger") loadList("ledger", "ledger", (payload) => ({ asPayer: payload.asPayer || [], asManager: payload.asManager || [] }));
  else if (screen === "ranking") loadRanking();
  else if (screen === "vault") loadList("vault", "vault", (payload) => ({ data: payload }));
  else {
    render();
    if (screen === "hub" && refresh) refreshState();
    if (screen === "card") loadDecorations();
  }
}

// ───────────── スレッドの購読 ─────────────

function stopThread() {
  threadGeneration += 1;
  contractUnsubscribe?.();
  eventsUnsubscribe?.();
  limitsUnsubscribe?.();
  for (const unsubscribe of state.thread?.historyUnsubscribes?.values() || []) unsubscribe();
  state.thread?.historyUnsubscribes?.clear();
  contractUnsubscribe = null;
  eventsUnsubscribe = null;
  limitsUnsubscribe = null;
  window.clearTimeout(markReadTimer);
  markReadTimer = null;
}

function openThread(contractId) {
  stopThread();
  closeSharePreview();
  state.sheet = null;
  state.screen = "thread";
  const known = state.contracts.find((contract) => contract.contractId === contractId);
  state.thread = { contractId, raw: null, view: known || null, events: [], status: "loading" };
  render();
  if (previewScreen || contractId === DEMO_CONTRACT_ID) {
    const demo = contractId === DEMO_CONTRACT_ID;
    const fixture = demo ? demoThread() : previewThread(contractId);
    state.thread = { contractId, raw: fixture.raw, view: viewContract(fixture.raw, state.uid), events: fixture.events, status: "ready", demo };
    render();
    scrollThreadToEnd();
    refreshWorkProgress();
    return;
  }
  const generation = lifecycleGeneration;
  const currentThreadGeneration = threadGeneration;
  const targetThread = state.thread;
  const uid = state.uid;
  const current = () => isCurrentThread(generation, currentThreadGeneration, targetThread, uid);
  contractUnsubscribe = onSnapshot(doc(firestore, "tributeContracts", contractId), (snapshot) => {
    if (!current()) return;
    if (!snapshot.exists()) return;
    state.thread.raw = snapshot.data();
    state.thread.view = viewContract(withThreadLimits(state.thread.raw), state.uid);
    // 財布として開いた時だけ、管理人には読めない限度額を購読する。
    if (state.thread.raw?.payerUid === uid && !limitsUnsubscribe) {
      limitsUnsubscribe = onSnapshot(doc(firestore, "tributeContracts", contractId, "private", "limits"), (limits) => {
        if (!current()) return;
        state.thread.limits = limits.exists() ? limits.data() : null;
        if (!state.thread.raw) return;
        state.thread.view = viewContract(withThreadLimits(state.thread.raw), state.uid);
        updateThreadParts();
      }, () => {});
    }
    applyReadAcknowledgement(contractId, markReadProgress.get(contractId)?.acknowledgedSeq || 0);
    syncContractRow(state.thread.view);
    state.thread.status = "ready";
    updateThreadParts();
    scheduleMarkRead();
    refreshWorkProgress();
  }, (error) => {
    if (!current()) return;
    state.thread.status = "error";
    showToast(friendlyError(error, "スレッドを読み込めませんでした。"));
    render();
  });
  subscribeThreadEvents();
}

function subscribeThreadEvents() {
  eventsUnsubscribe?.();
  const generation = lifecycleGeneration;
  const currentThreadGeneration = threadGeneration;
  const targetThread = state.thread;
  const uid = state.uid;
  const token = targetThread.eventsSubscription = {};
  const current = () => isCurrentThread(generation, currentThreadGeneration, targetThread, uid) && targetThread.eventsSubscription === token;
  eventsUnsubscribe = onSnapshot(query(collection(firestore, "tributeContracts", targetThread.contractId, "events"), orderBy("seq"), targetThread.liveFrom ? startAt(targetThread.liveFrom) : limitToLast(EVENTS_LIMIT)), (snapshot) => {
    if (!current()) return;
    targetThread.latestError = false;
    targetThread.historyError = Boolean(targetThread.historyFailures?.size);
    mergeEventPage(targetThread, "latest", snapshot);
    if (state.thread.view) updateThreadParts();
    scheduleMarkRead();
  }, (error) => {
    if (!current()) return;
    targetThread.latestError = true;
    targetThread.historyError = true;
    showToast(friendlyError(error, "履歴を読み込めませんでした。"));
    if (state.thread.view) updateThreadParts();
  });
}

function mergeEventPage(thread, key, snapshot) {
  thread.eventPages ||= new Map();
  thread.eventPages.set(key, snapshot.docs.map((entry) => entry.data()));
  const events = new Map();
  for (const page of thread.eventPages.values()) for (const event of page) events.set(event.seq, event);
  thread.events = [...events.values()].sort((a, b) => a.seq - b.seq);
}

// 古い履歴は重ならない100件ずつ。過去の受取印の変更も各ページの購読で反映する。
function loadOlderThreadEvents() {
  const thread = state.thread;
  if (thread.historyLoading) return;
  if (thread.latestError) {
    thread.historyError = false;
    subscribeThreadEvents();
    return;
  }
  const before = Number(thread.historyFailures?.values().next().value ?? thread.events[0]?.seq);
  if (!(before > 1)) return;
  thread.historyLoading = true;
  thread.historyError = false;
  // 最初の追加時だけ最新ページの下端を固定し、新着で古い行が抜け落ちないようにする。
  if (!thread.liveFrom) { thread.liveFrom = before; subscribeThreadEvents(); }
  const generation = lifecycleGeneration;
  const currentThreadGeneration = threadGeneration;
  const uid = state.uid;
  thread.historyTokens ||= new Map();
  thread.historyFailures ||= new Set();
  const token = {};
  thread.historyTokens.set(before, token);
  const current = () => isCurrentThread(generation, currentThreadGeneration, thread, uid) && thread.historyTokens.get(before) === token;
  thread.historyUnsubscribes ||= new Map();
  thread.historyUnsubscribes.get(before)?.();
  const unsubscribe = onSnapshot(query(collection(firestore, "tributeContracts", thread.contractId, "events"), orderBy("seq"), endBefore(before), limitToLast(EVENTS_LIMIT)), (snapshot) => {
    if (!current()) return;
    thread.preserveHistoryScroll = thread.historyLoading;
    thread.historyLoading = false;
    thread.historyFailures.delete(before);
    thread.historyError = thread.historyFailures.size > 0 || thread.latestError === true;
    if (!snapshot.docs.length) thread.historyExhausted = true;
    mergeEventPage(thread, before, snapshot);
    if (thread.view) updateThreadParts();
    scheduleMarkRead();
  }, (error) => {
    if (!current()) return;
    thread.historyLoading = false;
    thread.historyFailures.add(before);
    thread.historyError = true;
    showToast(friendlyError(error, "履歴を読み込めませんでした。"));
    if (thread.view) updateThreadParts();
  });
  thread.historyUnsubscribes.set(before, unsubscribe);
  updateThreadParts();
}

// 財布の限度額は private/limits にある（移す前の古い契約は、契約の記録に残っている）。財布の画面だけ足す。
function withThreadLimits(raw) {
  const limits = state.thread.limits;
  if (!limits || raw?.payerUid !== state.uid) return raw;
  return {
    ...raw,
    caps: limits.caps ?? null,
    pendingCaps: limits.pendingCaps ?? null,
    pendingCapsEffectiveDateKey: String(limits.pendingCapsEffectiveDateKey || ""),
  };
}

function isCurrentThread(generation, currentThreadGeneration, targetThread, uid) {
  return isCurrent(generation) && threadGeneration === currentThreadGeneration && state.thread === targetThread
    && state.screen === "thread" && state.uid === uid && (previewScreen || auth.currentUser?.uid === uid);
}

function visibleReadSequence(thread) {
  if (!thread.view || document.visibilityState !== "visible") return 0;
  const loadedSeq = thread.events.reduce((last, event) => Number.isSafeInteger(event.seq) ? Math.max(last, event.seq) : last, 0);
  return Math.min(thread.view.eventSeq, loadedSeq);
}

function applyReadAcknowledgement(contractId, readSeq) {
  if (!Number.isSafeInteger(readSeq) || readSeq < 1) return;
  const thread = state.thread;
  const threadView = thread.contractId === contractId ? thread.view : null;
  const row = state.contracts.find((contract) => contract.contractId === contractId);
  if (row) {
    const knownReadSeq = Math.max(row.eventSeq - row.unread, threadView ? threadView.eventSeq - threadView.unread : 0, readSeq);
    row.eventSeq = Math.max(row.eventSeq, threadView?.eventSeq || 0);
    row.unread = Math.max(0, row.eventSeq - knownReadSeq);
  }
  if (!threadView) return;
  thread.view.unread = Math.min(thread.view.unread, Math.max(0, thread.view.eventSeq - readSeq));
  if (thread.raw) {
    const role = thread.view.role;
    thread.raw.readSeq = { ...thread.raw.readSeq, [role]: Math.max(Number(thread.raw.readSeq?.[role]) || 0, readSeq) };
  }
}

function scheduleMarkRead() {
  window.clearTimeout(markReadTimer);
  const generation = lifecycleGeneration;
  const currentThreadGeneration = threadGeneration;
  const targetThread = state.thread;
  const uid = state.uid;
  markReadTimer = window.setTimeout(async () => {
    markReadTimer = null;
    if (!isCurrentThread(generation, currentThreadGeneration, targetThread, uid)) return;
    const view = targetThread.view;
    const seq = visibleReadSequence(targetThread);
    if (!view || !view.unread || seq < 1) return;
    const contractId = view.contractId;
    let progress = markReadProgress.get(contractId);
    if (!progress) {
      progress = { acknowledgedSeq: 0, promise: null };
      markReadProgress.set(contractId, progress);
    }
    const observedReadSeq = Math.max(0, view.eventSeq - view.unread);
    if (progress.promise || seq <= Math.max(progress.acknowledgedSeq, observedReadSeq)) return;
    let succeeded = false;
    progress.promise = call("mark_read", { contractId, seq });
    try {
      const result = await progress.promise;
      succeeded = result?.ok === true;
      if (!isCurrent(generation) || state.uid !== uid || (!previewScreen && auth.currentUser?.uid !== uid)) return;
      // 既読無視が始まると、牧場の実績（既読無視）が解除されることがある。
      notifyAchievementUnlocks(result?.newlyUnlocked);
      // 旧サーバーの { ok: true } は購読結果を待つ。送信成功だけで既読扱いにはしない。
      if (succeeded && result.contractId === contractId && Number.isSafeInteger(result.readSeq) && result.readSeq >= 0) {
        progress.acknowledgedSeq = Math.max(progress.acknowledgedSeq, Math.min(seq, result.readSeq));
        if (isCurrentThread(generation, currentThreadGeneration, targetThread, uid)) {
          applyReadAcknowledgement(contractId, progress.acknowledgedSeq);
        }
      }
    } catch {
      // 通信失敗では未読表示を維持する。次の購読通知・再表示で再試行する。
    } finally {
      progress.promise = null;
      if (succeeded && isCurrent(generation) && state.uid === uid && state.screen === "thread"
        && state.thread.contractId === contractId && visibleReadSequence(state.thread) > seq) scheduleMarkRead();
    }
  }, 800);
}

// ───────────── 操作 ─────────────

async function mutate(action, payload, { success = "", after = null, form = null, onError = null } = {}) {
  if (state.busy) return null;
  const generation = lifecycleGeneration;
  const targetState = state;
  const uid = state.uid;
  state.busy = action;
  const errorTarget = form?.querySelector?.("[data-form-error]")
    || (form ? layer.querySelector("[data-form-error]") : null);
  try {
    const result = await call(action, payload);
    targetState.busy = "";
    if (!isCurrent(generation) || state !== targetState || state.uid !== uid || (!previewScreen && auth.currentUser?.uid !== uid)) return null;
    // 書き込み前に開始した一覧取得は、成功後の画面遷移で再利用しない。
    if (stateRequest?.generation === generation && stateRequest?.targetState === targetState) stateRequest = null;
    targetState.readRequests.clear();
    if (success) showToast(success);
    // 牧場の実績（設計書17）は、どの操作でも解除されうる。ここで1回だけ知らせる（あとで知らせる画面には空で渡る）。
    if (Array.isArray(result?.newlyUnlocked) && result.newlyUnlocked.length) {
      notifyAchievementUnlocks(result.newlyUnlocked);
      result.newlyUnlocked = [];
    }
    if (after) after(result);
    return result;
  } catch (error) {
    targetState.busy = "";
    if (!isCurrent(generation) || state !== targetState || state.uid !== uid || (!previewScreen && auth.currentUser?.uid !== uid)) return null;
    const message = friendlyError(error);
    if (onError) onError(error);
    if (errorTarget?.isConnected) errorTarget.textContent = message;
    else showToast(message);
    return null;
  }
}

function contractPayload(extra = {}) {
  return { contractId: state.thread.view?.contractId || state.thread.contractId, ...extra };
}

function closeSheet() {
  closeSharePreview();
  state.sheet = null;
  cancelHold();
  rerenderSheet();
}

function openSheet(type, extra = {}) {
  const view = state.thread.view;
  if (!view) return;
  state.sheet = { type, step: "amount", clientRequestId: createRequestId(), ...extra };
  rerenderSheet();
}

async function completeGive() {
  const sheet = state.sheet;
  if (!sheet || sheet.type !== "give") return;
  const result = await mutate("tribute", contractPayload({
    kind: sheet.othello ? "othello" : sheet.contest ? "contest" : sheet.granted ? "granted" : sheet.requestId ? "request" : "silent",
    requestId: sheet.requestId || undefined,
    amount: sheet.amount,
    purpose: sheet.requestId || sheet.granted || sheet.othello || sheet.contest ? undefined : sheet.purpose || undefined,
    clientRequestId: sheet.clientRequestId,
  }));
  if (!result) {
    rerenderSheet();
    return;
  }
  state.sheet = null;
  const demo = state.thread.demo === true;
  if (!demo && Number.isFinite(result.walletBalance)) {
    state.walletBalance = result.walletBalance;
    paintWallet();
  }
  state.receipt = result.receipt
    ? { ...result.receipt, walletAfter: !demo && Number.isFinite(result.walletBalance) ? result.walletBalance : undefined, demo }
    : null;
  rerenderSheet();
  rerenderReceipt();
  window.HariaiAudio?.playReveal?.();
  notifyAchievementUnlocks(result.newlyUnlocked);
}

function beginHold(button) {
  if (hold || state.busy || !button) return;
  button.classList.add("is-holding");
  button.style.setProperty("--hold-ms", `${HOLD_MS}ms`);
  hold = {
    button,
    timer: window.setTimeout(() => {
      button.classList.remove("is-holding");
      button.classList.add("is-done");
      hold = null;
      completeGive();
    }, HOLD_MS),
  };
}

function cancelHold() {
  if (!hold) return;
  window.clearTimeout(hold.timer);
  hold.button.classList.remove("is-holding");
  hold = null;
}

function readAmount(form, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(form.elements.amount?.value);
  if (!Number.isSafeInteger(value) || value < 1) return { error: "金額は1 Pay以上の整数で入力してください。" };
  if (value > maximum) return { error: `いま指定できるのは ${formatPay(maximum)} までです。` };
  return { value };
}

function setFormError(form, message) {
  const target = form.querySelector("[data-form-error]") || layer.querySelector("[data-form-error]");
  if (target) target.textContent = message;
  else if (message) showToast(message);
}

async function handleSubmit(form) {
  const kind = form.dataset.form;
  const view = state.thread.view;
  setFormError(form, "");
  switch (kind) {
    case "age": {
      const generation = lifecycleGeneration;
      const targetState = state;
      const result = await mutate("age_confirm", {
        version: TRIBUTE_AGE_VERSION,
        adult: form.elements.adult.checked,
        premise: form.elements.premise.checked,
      }, { form });
      if (!result || !isCurrent(generation) || state !== targetState) return;
      state.ageConfirmed = true;
      const payload = await requestState({ fresh: true }).catch(() => null);
      if (!isCurrent(generation) || state !== targetState) return;
      subscribeWallet();
      if (pendingInvite) {
        const invite = pendingInvite;
        pendingInvite = "";
        openManager(invite, { invited: true });
        return;
      }
      navigate("hub", { refresh: !payload });
      return;
    }
    case "wallet-name":
      await mutate("save_profile", { walletName: form.elements.walletName.value }, {
        form,
        success: "財布名を保存しました。",
        after: (result) => {
          state.profile = result.profile;
          render();
        },
      });
      return;
    case "card": {
      const data = new FormData(form);
      const personaName = String(data.get("personaName") || "").trim();
      if (!personaName) return setFormError(form, "ペルソナ名を入力してください。");
      const problem = messageProblem(`${personaName} ${data.get("intro") || ""}`);
      if (problem) return setFormError(form, problem);
      const x = normalizeXProfile(data.get("xProfile"));
      if (x.error) return setFormError(form, x.error);
      const rankingWord = String(data.get("rankingWord") || "");
      const rankingWordError = rankingWordProblem(rankingWord);
      if (rankingWordError) return setFormError(form, rankingWordError);
      if (decorationsTried(formDecorations(form)).length) return setFormError(form, "試着中の飾りがあります。買うか、試着をやめてから保存してください。");
      if (vaultDecorationsLocked(formDecorations(form)).length) return setFormError(form, "金庫がまだその段階に届いていない飾りがあります。試着をやめてから保存してください。");
      const sealWords = String(data.get("sealWords") || "").split(/[\n,、]/u).map((word) => word.trim()).filter(Boolean);
      for (const word of sealWords) {
        const sealProblem = sealWordProblem(word);
        if (sealProblem) return setFormError(form, `受取印の言葉「${word}」: ${sealProblem}`);
      }
      const seals = [...new Set([...data.getAll("seals").map(String), ...sealWords.map(sealWordId)])];
      if (seals.length > MAX_SEALS) return setFormError(form, `受取印は、一覧の印と自分の言葉の印を合わせて${MAX_SEALS}つまでです。`);
      const styles = normalizeStyles(data.getAll("styles"));
      if (!styles.length || data.getAll("styles").length > MAX_MANAGER_STYLES) return setFormError(form, `管理の型を1つか${MAX_MANAGER_STYLES}つ選んでください。`);
      await mutate("save_profile", {
        card: {
          personaName,
          intro: String(data.get("intro") || ""),
          xProfile: x.xHandle,
          disclosure: String(data.get("disclosure") || ""),
          styles,
          entryFee: Number(data.get("entryFee")),
          sigil: Number(data.get("sigil") || 0),
          avatar: avatarId(data.get("avatar")),
          seals,
          ...formDecorations(form),
          achievements: data.getAll("achievements").map(String).slice(0, CARD_ACHIEVEMENT_LIMIT),
          reportConsent: data.get("reportConsent") === "on",
          ignoreUnpaid: data.get("ignoreUnpaid") === "on",
          postsScreenshots: data.get("postsScreenshots") === "on",
          showsActivity: data.get("showsActivity") === "on",
          rankingWord,
        },
        accepting: data.get("accepting") === "on",
      }, {
        form,
        success: "管理人カードを保存しました。",
        after: (result) => {
          state.profile = result.profile;
          navigate("hub");
        },
      });
      return;
    }
    // 牧場の名前（設計書16.15）。末尾の「牧場」は外して保存する。空なら外す。
    case "ranch-name": {
      const name = String(form.elements.ranchName.value || "");
      const problem = ranchNameProblem(name);
      if (problem) return setFormError(form, problem);
      await mutate("set_ranch_name", { name }, {
        form,
        after: (result) => {
          state.profile = result.profile;
          state.ranch.naming = false;
          const saved = String(result.profile?.ranch?.name || "");
          showToast(saved ? `「${ranchTitle(saved)}」にしました。` : "牧場の名前を外しました。");
          render();
        },
      });
      return;
    }
    // 財布の鳴き声（設計書16.5）。空の欄は外して保存する。
    case "moo": {
      const lines = Array.from({ length: RANCH_MOO.lines }, (_, index) => String(form.elements[`moo${index}`]?.value || "").trim());
      const problem = mooProblem(lines);
      if (problem) return setFormError(form, problem);
      const result = await mutate("set_moo", contractPayload({ lines: lines.filter(Boolean) }), { form, success: "鳴き声を保存しました。" });
      if (result?.contract && state.thread.view) {
        state.thread.view = { ...state.thread.view, mooLines: Array.isArray(result.contract.mooLines) ? result.contract.mooLines : [] };
        renderLayer();
      }
      return;
    }
    case "cheer": {
      const text = String(form.elements.cheer.value || "");
      const problem = cheerProblem(text);
      if (problem) return setFormError(form, problem);
      await mutate("set_cheer", { publicManagerId: state.manager.publicManagerId, text }, {
        form,
        success: "応援を書きました。",
        after: () => openManager(state.manager.publicManagerId),
      });
      return;
    }
    case "word": {
      const text = String(form.elements.word.value || "");
      const problem = todayWordProblem(text);
      if (problem) return setFormError(form, problem);
      await mutate("set_word", { text }, {
        form,
        success: "今日のひとことを出しました。掲示板で上に並びます。",
        after: (result) => {
          state.profile = result.profile;
          render();
        },
      });
      return;
    }
    case "apply": {
      const target = state.applyTarget;
      const data = new FormData(form);
      const caps = normalizeCaps({ perTribute: data.get("perTribute"), perDay: data.get("perDay"), total: data.get("total") });
      if (!caps) return setFormError(form, "限度額は「1回 ≦ 1日 ≦ 合計」になるように選んでください。");
      if (target.entryFee > caps.perTribute) return setFormError(form, "入場料が1回の限度額を超えています。1回の限度額を上げてください。");
      const ngWords = String(data.get("ngWords") || "");
      const want = normalizeWantWords(String(data.get("wantWords") || ""), { ngWords: ngWords.split(/[\n,、]/u).map((word) => word.trim()).filter(Boolean) });
      if (want.error) return setFormError(form, want.error);
      const result = await mutate("apply", {
        publicManagerId: target.publicManagerId,
        expectedEntryFee: target.entryFee,
        application: {
          caps,
          durationDays: Number(data.get("durationDays")),
          tone: String(data.get("tone") || "normal"),
          ngWords,
          wantWords: want.words,
          allowReportRequests: data.get("allowReportRequests") === "on",
          rankOptIn: data.get("rankOptIn") === "on",
          allowSexualPurposes: data.get("allowSexualPurposes") === "on",
          allowScreenshots: data.get("allowScreenshots") === "on",
          allowWorkOrders: data.get("allowWorkOrders") === "on",
          allowHolds: data.get("allowHolds") === "on",
          allowOthello: data.get("allowOthello") === "on",
          allowGrazing: data.get("allowGrazing") === "on",
          acceptNoDecline: data.get("acceptNoDecline") === "on",
          walletName: String(data.get("walletName") || ""),
        },
      }, { form, success: "申し込みました。受理を待ちます。" });
      if (result?.contract) {
        state.applyPrefill = null;
        state.contracts = [result.contract, ...state.contracts.filter((row) => row.contractId !== result.contract.contractId)];
        openThread(result.contract.contractId);
      }
      return;
    }
    case "message": {
      const text = String(form.elements.text.value || "");
      if (!text.trim()) return;
      const problem = contractTextProblem(text, { role: view.role, ngWords: view.ngWords });
      if (problem) return setFormError(form, problem);
      const result = await mutate("message", contractPayload({ text, template: form.dataset.template === "1" }), { form });
      if (result) {
        form.elements.text.value = "";
        form.dataset.template = "";
        updateComposerCount(form);
        scrollThreadToEnd();
      }
      return;
    }
    case "give": {
      const amount = readAmount(form, view.allowance);
      if (amount.error) return setFormError(form, amount.error);
      const violation = capViolation(amount.value, state.thread.raw || {}, view.caps);
      if (violation) return setFormError(form, violation);
      if (!state.thread.demo && state.walletBalance !== null && state.walletBalance < amount.value) return setFormError(form, "AnjuPay残高が足りません。");
      state.sheet = { ...state.sheet, amount: amount.value, purpose: String(new FormData(form).get("purpose") || ""), step: "hold" };
      rerenderSheet();
      return;
    }
    case "request": {
      // 管理人には財布の限度額を渡さない。請求自体の上限だけを確かめる。
      const amount = readAmount(form, LIMITS.requestMax);
      if (amount.error) return setFormError(form, amount.error);
      const note = String(form.elements.note.value || "");
      const problem = note ? contractTextProblem(note, { role: "manager", ngWords: view.ngWords }) : "";
      if (problem) return setFormError(form, problem);
      const purpose = String(new FormData(form).get("purpose") || "");
      const result = await mutate("request", contractPayload({ amount: amount.value, note, purpose }), { form, success: "請求を送りました。" });
      if (result) closeSheet();
      return;
    }
    case "work-order": {
      const data = new FormData(form);
      const target = Number(data.get("target"));
      const note = String(form.elements.note.value || "");
      const problem = note ? contractTextProblem(note, { role: "manager", ngWords: view.ngWords }) : "";
      if (problem) return setFormError(form, problem);
      if (data.get("kind") === "contest") {
        const days = Number(data.get("days"));
        const penalty = Number(data.get("penalty"));
        if (!CONTEST_TARGETS.includes(target) || !CONTEST_DAYS.includes(days) || !CONTEST_PENALTIES.includes(penalty)) return setFormError(form, "勝ち数・期限・罰金を選んでください。");
        const result = await mutate("work_order", contractPayload({ kind: "contest", target, days, penalty, note }), { form, success: `勝負を申し出ました（${days}日以内に${target}勝・罰金 ${formatPay(penalty)}）。` });
        if (result) closeSheet();
        return;
      }
      if (!WORK_ORDER_TARGETS.includes(target)) return setFormError(form, "回数を選んでください。");
      const result = await mutate("work_order", contractPayload({ target, note }), { form, success: `出稼ぎ命令を出しました（1on1を${target}回）。` });
      if (result) closeSheet();
      return;
    }
    case "take": {
      // 財布の非公開の限度額は、徴収を確定するサーバーで確かめる。
      const amount = readAmount(form, view.escrowBalance);
      if (amount.error) return setFormError(form, amount.error);
      const result = await mutate("escrow_take", contractPayload({ amount: amount.value, clientRequestId: state.sheet.clientRequestId }), { form, success: "管理口座から徴収しました。" });
      if (result) {
        closeSheet();
        notifyAchievementUnlocks(result.newlyUnlocked);
      }
      return;
    }
    case "escrow-deposit": {
      const amount = readAmount(form, view.escrowRoom);
      if (amount.error) return setFormError(form, amount.error);
      const result = await mutate("escrow_deposit", contractPayload({ amount: amount.value, clientRequestId: state.sheet.clientRequestId }), { form, success: "管理口座へ預けました。" });
      if (result) {
        if (Number.isFinite(result.walletBalance)) {
    state.walletBalance = result.walletBalance;
    paintWallet();
  }
        closeSheet();
      }
      return;
    }
    case "escrow-withdraw": {
      const amount = readAmount(form, view.escrowBalance);
      if (amount.error) return setFormError(form, amount.error);
      const result = await mutate("escrow_withdraw_request", contractPayload({ amount: amount.value }), { form, success: "使用許可を申請しました。" });
      if (result) closeSheet();
      return;
    }
    case "nickname": {
      const nickname = String(form.elements.nickname.value || "").trim().slice(0, LIMITS.nickname);
      const result = await mutate("set_nickname", contractPayload({ nickname }), { form });
      if (result) {
        const saved = typeof result.nickname === "string" ? result.nickname : nickname;
        const row = state.contracts.find((contract) => contract.contractId === state.thread.contractId);
        if (row) row.nickname = saved;
        showToast(saved ? "呼び名を付けました。財布には見えません。" : "呼び名を外しました。");
        closeSheet();
        renderKeepingDraft();
      }
      return;
    }
    case "own-words": {
      const data = new FormData(form);
      const read = (kind, count) => Array.from({ length: count }, (_, index) => ({ text: String(data.get(`${kind}Text${index}`) || ""), tone: String(data.get(`${kind}Tone${index}`) || "normal") }));
      const normalized = normalizeOwnWords({ lines: read("line", LIMITS.ownLines), rewards: read("reward", LIMITS.ownRewards) });
      if (normalized.error) return setFormError(form, normalized.error);
      await mutate("set_own_words", { ownWords: normalized.ownWords }, {
        form,
        success: "自分の言葉を保存しました。",
        after: (result) => {
          state.profile = result.profile;
        },
      });
      return;
    }
    case "othello-start": {
      const data = new FormData(form);
      const result = await mutate("othello_start", contractPayload({
        rate: Number(data.get("rate")),
        handicap: String(data.get("handicap") || "none"),
        managerFirst: data.get("managerFirst") === "on",
      }), { form, success: "貢ぎオセロを始めました。" });
      if (result) closeSheet();
      return;
    }
    case "offer-words": {
      const text = String(form.elements.text.value || "");
      const problem = wordOfferingProblem(text);
      if (problem) return setFormError(form, problem);
      const result = await mutate("offer_words", contractPayload({ text }), { form, success: "言葉を差し出しました。" });
      if (result) closeSheet();
      return;
    }
    case "recite-order": {
      const text = reciteKey(form.elements.note.value);
      if (!text) return setFormError(form, "言わせたい一言を入力してください。");
      const problem = contractTextProblem(text, { role: "manager", ngWords: view.ngWords });
      if (problem) return setFormError(form, problem);
      const target = Number(new FormData(form).get("target"));
      const result = await mutate("recite_order", contractPayload({ text, target }), { form, success: "復唱させました。" });
      if (result) closeSheet();
      return;
    }
    case "recite": {
      const order = view.reciteOrder;
      if (!order) return;
      if (reciteKey(form.elements.text.value) !== order.text) return setFormError(form, "一字一句同じに打ってください。");
      const result = await mutate("recite", contractPayload({ text: form.elements.text.value }), { form });
      if (result) {
        showToast(result.done ? `復唱しました（${Number(result.count)}回）。果たしました。` : `復唱しました（${Number(result.count)} / ${Number(order.target)}回）。`);
        closeSheet();
      }
      return;
    }
    case "extend": {
      const days = Number(new FormData(form).get("days"));
      const result = await mutate("extend_request", contractPayload({ days }), { form, success: `${days}日の延長を申し込みました。` });
      if (result) closeSheet();
      return;
    }
    case "hold": {
      const note = String(form.elements.note.value || "");
      const problem = note ? contractTextProblem(note, { role: "manager", ngWords: view.ngWords }) : "";
      if (problem) return setFormError(form, problem);
      const result = await mutate("hold", contractPayload({ note }), { form, success: "お預けにしました。" });
      if (result) closeSheet();
      return;
    }
    case "plea": {
      const amount = readAmount(form, view.caps?.perTribute || 0);
      if (amount.error) return setFormError(form, amount.error);
      const note = String(form.elements.note.value || "");
      const problem = note ? contractTextProblem(note, { role: "payer" }) : "";
      if (problem) return setFormError(form, problem);
      const purpose = String(new FormData(form).get("purpose") || "");
      const result = await mutate("plea", contractPayload({ amount: amount.value, purpose, note }), { form, success: "願い出ました。" });
      if (result) closeSheet();
      return;
    }
    case "plea-answer": {
      const grant = state.sheet?.decision === "grant";
      const note = String(form.elements.note.value || "");
      const problem = note ? contractTextProblem(note, { role: "manager", ngWords: view.ngWords }) : "";
      if (problem) return setFormError(form, problem);
      const result = await mutate(grant ? "plea_grant" : "plea_deny", contractPayload({ note }), { form, success: grant ? "願い出を許しました。" : "願い出を退けました。" });
      if (result) closeSheet();
      return;
    }
    case "resist": {
      const text = String(form.elements.note.value || "").trim();
      if (!text) return setFormError(form, "渋る一言を入力してください。");
      const problem = contractTextProblem(text, { role: "payer" });
      if (problem) return setFormError(form, problem);
      const result = await mutate("resist", contractPayload({ requestId: state.sheet?.requestId, text }), { form, success: "抵抗しました。請求は未払いのまま残ります。" });
      if (result) closeSheet();
      return;
    }
    case "want-words": {
      if (!view) return;
      const want = normalizeWantWords(String(form.elements.wantWords.value || ""), { ngWords: view.ngWords });
      if (want.error) return setFormError(form, want.error);
      const result = await mutate("set_want_words", contractPayload({ wantWords: want.words }), { form });
      if (result) {
        showToast(result.unchanged ? "言われたい言葉は変わっていません。" : want.words.length ? "言われたい言葉を保存しました。" : "言われたい言葉を外しました。");
        closeSheet();
      }
      return;
    }
    case "caps": {
      const caps = normalizeCaps({ perTribute: form.elements.perTribute.value, perDay: form.elements.perDay.value, total: form.elements.total.value });
      if (!caps) return setFormError(form, "限度額は「1回 ≦ 1日 ≦ 合計」になるように選んでください。");
      const result = await mutate("set_caps", contractPayload({ caps }), { form });
      if (result) {
        showToast(result.unchanged ? "限度額は変わっていません。" : result.contract?.pendingCaps ? "下げた分はすぐ、上げた分は翌日0時から効きます。" : "限度額を変更しました。");
        closeSheet();
      }
      return;
    }
    case "report": {
      const result = await mutate("report_user", contractPayload({ reason: form.elements.reason.value, note: form.elements.note.value }), { form });
      if (result) {
        showToast(result.duplicate ? "今月はすでに通報を受け付けています。" : "通報を受け付けました。");
        closeSheet();
      }
      return;
    }
    case "vault": {
      if (state.busy) return;
      // 金庫に入れる・出す。Pay は自分のもののままで、外に見せるのは段階だけ。
      const pending = state.vault.pendingMove;
      const direction = pending?.direction || (form.dataset.direction === "withdraw" ? "withdraw" : "deposit");
      const withdraw = direction === "withdraw";
      const vault = state.vault.data?.vault || {};
      const amount = pending ? { value: pending.amount } : readAmount(form, withdraw ? Number(vault.amount) || 0 : state.walletBalance ?? Number.MAX_SAFE_INTEGER);
      if (amount.error) return setFormError(form, amount.error);
      const operation = pending || { direction, amount: amount.value, clientRequestId: createRequestId() };
      state.vault.pendingMove = operation;
      state.vault.moveError = "";
      storedVaultMove(operation);
      const generation = lifecycleGeneration;
      const targetState = state;
      const result = await mutate(withdraw ? "vault_withdraw" : "vault_deposit", { amount: amount.value, clientRequestId: operation.clientRequestId }, {
        form,
        success: withdraw ? `金庫から ${formatPay(amount.value)} 出しました。` : `金庫に ${formatPay(amount.value)} 入れました。`,
        onError(error) {
          state.vault.moveError = friendlyError(error);
          if (["invalid-argument", "failed-precondition", "permission-denied", "unauthenticated", "not-found"].includes(String(error.code || "").replace(/^functions\//, ""))) {
            state.vault.pendingMove = null;
            storedVaultMove(null);
          }
        },
      });
      if (!isCurrent(generation) || state !== targetState) return;
      if (result) {
        state.vault.pendingMove = null;
        storedVaultMove(null);
        if (Number.isFinite(result.walletBalance)) {
          state.walletBalance = result.walletBalance;
          paintWallet();
        }
        if (result.vault && state.profile) state.profile = { ...state.profile, vault: result.vault, card: state.profile.card ? { ...state.profile.card, vault: result.vault.tier ? { level: result.vault.tier } : null } : null };
        const reached = vaultTierInfo(result.reachedTier);
        if (reached) {
          const item = VAULT_DECORATION_ITEMS.find((entry) => entry.tier === reached.level);
          showToast(`金庫が「${reached.label}」に届きました。${item ? `カードの飾りに「${item.name}」が加わりました。` : ""}`);
        }
        if (state.screen === "vault") navigate("vault");
      } else if (state.screen === "vault") {
        render();
      }
      return;
    }
    default:
  }
}

function updateComposerCount(form) {
  const counter = form.querySelector("[data-composer-count]");
  if (counter) counter.textContent = `${textLength(form.elements.text.value)} / ${LIMITS.message}`;
}

async function handleClick(target) {
  const action = target.dataset.t;
  const view = state.thread.view;
  switch (action) {
    case "claim-refund": {
      const result = await mutate("claim_refund", {});
      if (!result) return;
      state.profile = result.profile;
      state.walletBalance = result.walletBalance;
      paintWallet();
      showToast(result.amount ? `${formatPay(result.amount)}を財布へ戻しました。` : result.profile.refundPending || result.profile.operatorRefundPending ? "財布の残高上限に空きができたら、もう一度受け取ってください。" : "返金はすべて受け取り済みです。");
      if (state.screen === "hub") render();
      return;
    }
    case "history-more":
      loadOlderThreadEvents();
      return;
    case "ended-more":
      await loadMoreEndedContracts();
      return;
    case "home":
      requestHome();
      return;
    case "nav":
      navigate(target.dataset.screen);
      return;
    case "retry":
      lifecycleGeneration += 1;
      active = false;
      start();
      return;
    case "reload-page":
      if (state.screen === "error" && state.fatalReloadRequired) window.location.reload();
      return;
    case "reload-board":
      loadBoard();
      return;
    case "toggle-nekama":
      state.board.nekamaOnly = target.checked;
      loadBoard();
      return;
    case "toggle-fee-zero":
      state.board.feeZeroOnly = target.checked;
      render();
      return;
    case "board-style":
      state.board.style = STYLE_LABELS[target.value] ? target.value : "";
      render();
      return;
    case "board-free":
      state.board.feeZeroOnly = true;
      navigate("board");
      return;
    case "toggle-declaration":
      await mutate("set_declaration", { ignoreUnpaid: target.checked }, {
        success: target.checked ? "「未払いは既読無視」を宣言しました。" : "宣言を外しました。",
        after: (result) => {
          if (result?.profile) state.profile = result.profile;
          if (state.screen === "thread") updateThreadParts();
        },
      });
      return;
    // Payを貯める近道。ホームへ戻ってから、それぞれのモードを開く。
    case "earn": {
      const mode = target.dataset.mode;
      requestHome();
      window.setTimeout(() => {
        if (mode === "missions") {
          const open = () => window.HariaiApp.openOnlineFeature("openDailyMissions");
          if (typeof open === "function") open();
          else showToast("デイリーミッションを開けませんでした。ホームから開いてください。");
          return;
        }
        // 1on1 はトップの「いますぐ貼り合う」と同じ入口から始める。
        const button = document.querySelector(mode === "battle" ? "#onlineButton" : mode === "ai" ? "#aiTextTrainingButton" : "#rouletteTrainingButton");
        if (button) button.click();
        else showToast("開けませんでした。ホームから開いてください。");
      }, 0);
      return;
    }
    case "open-manager":
      openManager(target.dataset.id);
      return;
    case "open-apply": {
      const card = state.manager.data?.card;
      if (!card) return;
      // 申し込み画面にも、管理人の宣言（未払いは既読無視・スクショを載せる）と「高額請求」の札を出す。
      state.applyTarget = {
        publicManagerId: card.publicManagerId,
        entryFee: card.entryFee,
        personaName: card.personaName,
        disclosure: card.disclosure,
        sigil: card.sigil,
        avatar: card.avatar,
        ignoreUnpaid: card.ignoreUnpaid === true,
        postsScreenshots: card.postsScreenshots === true,
        highRequest: card.highRequest === true,
      };
      state.screen = "apply";
      render();
      return;
    }
    case "back-manager":
      if (state.applyTarget) openManager(state.applyTarget.publicManagerId);
      return;
    // 終わった契約の設定を写して、その管理人の詳細を開く（受付中なら「同じ条件で申し込む」が出る）。
    case "reapply": {
      if (!view?.managerPublicId || view.role !== "payer") return;
      state.applyPrefill = {
        publicManagerId: view.managerPublicId,
        caps: view.caps || null,
        durationDays: view.durationDays,
        tone: view.tone,
        ngWords: view.ngWords,
        wantWords: view.wantWords,
        allowReportRequests: view.allowReportRequests,
        allowWorkOrders: view.allowWorkOrders,
        allowHolds: view.allowHolds,
        rankOptIn: view.rankOptIn,
      };
      openManager(view.managerPublicId);
      return;
    }
    case "open-thread":
      openThread(target.dataset.contract);
      return;
    case "toggle-accepting":
      await mutate("save_profile", { accepting: !state.profile?.accepting }, {
        after: (result) => {
          state.profile = result.profile;
          render();
        },
      });
      return;
    case "accept":
      await mutate("accept", contractPayload(), {
        success: "受理しました。管理を始めます。",
        after: (result) => {
          if (result.entryFeeCharged) showToast(`入場料 ${formatPay(result.entryFeeCharged)} を受け取りました。`);
          notifyAchievementUnlocks(result.newlyUnlocked);
          if (previewScreen) updateThreadParts();
        },
      });
      return;
    case "decline":
      await mutate("decline", contractPayload(), { success: "申し込みを断りました。" });
      return;
    case "withdraw":
      await mutate("withdraw", contractPayload(), { success: "申し込みを取り下げました。" });
      return;
    case "terminate":
    case "release": {
      const result = await mutate(action, contractPayload(), { success: action === "terminate" ? "解約しました。おつかれさまでした。" : "解放しました。" });
      if (result) closeSheet();
      return;
    }
    case "sheet":
      if (target.dataset.sheet === "ranch-peek") openRanchPeek();
      else openSheet(target.dataset.sheet);
      return;
    case "sheet-close":
      closeSheet();
      return;
    case "give-request":
      openSheet("give", { requestId: target.dataset.request, amount: Number(target.dataset.amount), purpose: target.dataset.purpose || "", step: "hold" });
      return;
    case "give-back":
      state.sheet = { ...state.sheet, requestId: "", purpose: state.sheet?.requestId ? "" : state.sheet?.purpose || "", step: "amount" };
      rerenderSheet();
      return;
    case "receive": {
      const reward = target.dataset.reward || "";
      const rewardWord = reward === REWARD_WORD ? target.dataset.text || "" : "";
      const label = rewardText({ reward, rewardText: rewardWord });
      const seq = Number(target.dataset.seq);
      const seal = target.closest(".tribute-receive")?.querySelector(`input[name="seal-${seq}"]:checked`)?.value || sealChoices.get(seq) || "";
      const result = await mutate("receive", contractPayload({ tributeSeq: seq, reward, ...(rewardWord ? { rewardText: rewardWord } : {}), seal }), {
        success: label ? `「${sealLabel(seal) || "受領"}」の印に「${label}」を添えて受け取りました。` : `「${sealLabel(seal) || "受領"}」の印を押して受け取りました。`,
      });
      if (result) sealChoices.delete(seq);
      return;
    }
    case "share-open": {
      const event = state.thread.events.find((entry) => SHARE_EVENT_TYPES.includes(entry.type) && Number(entry.seq) === Number(target.dataset.seq));
      if (!event || !view) return;
      // 言葉の献上にはレシートがないので、切り抜きだけを作る。
      openShare({ contractId: view.contractId, receiptId: event.receiptId || "", seq: event.seq, mode: event.type === "tribute" ? "receipt" : "excerpt" });
      return;
    }
    case "open-demo":
      openThread(DEMO_CONTRACT_ID);
      return;
    case "open-missions":
      requestHome();
      window.setTimeout(() => {
        const open = () => window.HariaiApp.openOnlineFeature("openDailyMissions");
        if (typeof open === "function") open();
        else showToast("デイリーミッションを開けませんでした。ホームから開いてください。");
      }, 0);
      return;
    case "apply-trial": {
      const form = target.closest("form");
      const trial = trialCaps(state.applyTarget?.entryFee);
      if (!form) return;
      form.elements.perTribute.value = String(trial.perTribute);
      form.elements.perDay.value = String(trial.perDay);
      form.elements.total.value = String(trial.total);
      const duration = form.querySelector(`input[name="durationDays"][value="${TRIAL_DURATION_DAYS}"]`);
      if (duration) duration.checked = true;
      if (form.elements.allowSexualPurposes) form.elements.allowSexualPurposes.checked = false;
      showToast("お試しの設定にしました。");
      return;
    }
    case "hub-role":
      state.hubRole = target.dataset.role === "payer" ? "payer" : "manager";
      rememberHubRole(state.hubRole);
      render();
      return;
    case "copy-open-url": {
      const url = ranchOpenUrlHere();
      try {
        await navigator.clipboard.writeText(url);
        showToast("牧場を直接開くURLをコピーしました。");
      } catch {
        const input = document.querySelector("[data-open-url]");
        input?.focus();
        input?.select();
        showToast("URLを選びました。コピーしてください。");
      }
      return;
    }
    case "copy-invite": {
      const url = inviteUrlFor(state.profile?.publicManagerId || state.profile?.card?.publicManagerId);
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        showToast("招待リンクをコピーしました。");
      } catch {
        const input = document.querySelector("[data-invite-url]");
        input?.focus();
        input?.select();
        showToast("リンクを選びました。コピーしてください。");
      }
      return;
    }
    case "buy-deco":
      await buyDecoration(target.dataset.product);
      return;
    case "stop-trial": {
      const form = target.closest('form[data-form="card"]');
      if (form) stopDecorationTrial(form);
      return;
    }
    case "recruit-open":
      openRecruit();
      return;
    case "recruit-send":
    case "recruit-save":
      await sendRecruitImage(target.dataset.t === "recruit-save");
      return;
    case "post-invite": {
      const card = state.sheet?.type === "recruit" && state.sheet.card ? state.sheet.card : state.profile?.card;
      const url = inviteUrlFor(state.profile?.publicManagerId || card?.publicManagerId);
      if (!card || !url) return;
      const intent = new URL("https://x.com/intent/tweet");
      intent.searchParams.set("text", inviteText(card));
      intent.searchParams.set("url", url);
      window.open(intent.href, "_blank", "noopener,noreferrer");
      return;
    }
    case "ranking-kind": {
      const kind = target.dataset.kind === "gross" ? "gross" : "score";
      if (kind !== state.ranking.kind) loadRanking(kind);
      return;
    }
    case "clear-cheer":
      await mutate("set_cheer", { publicManagerId: state.manager.publicManagerId, text: "" }, {
        success: "応援を消しました。",
        after: () => openManager(state.manager.publicManagerId),
      });
      return;
    case "cheer-seen":
    case "cheer-hide":
    case "cheer-show": {
      const serverAction = { "cheer-seen": "cheer_seen", "cheer-hide": "cheer_hide", "cheer-show": "cheer_show" }[action];
      await mutate(serverAction, { cheerId: target.dataset.cheer }, {
        success: { cheer_seen: "「見たよ」を返しました。", cheer_hide: "応援を隠しました。", cheer_show: "応援を戻しました。" }[serverAction],
        after: (result) => {
          if (state.profile && Number.isFinite(Number(result?.cheersUnseen))) state.profile = { ...state.profile, cheersUnseen: Number(result.cheersUnseen) };
          openManager(state.manager.publicManagerId);
        },
      });
      return;
    }
    case "clear-word":
      await mutate("set_word", { clear: true }, {
        success: "今日のひとことを消しました。",
        after: (result) => {
          state.profile = result.profile;
          render();
        },
      });
      return;
    case "share-receipt":
      openShare({ contractId: target.dataset.contract, receiptId: target.dataset.receipt });
      return;
    case "share-send":
    case "share-save":
      await sendShareImage(action === "share-save");
      return;
    case "pick-note": {
      const input = target.closest("form")?.elements?.note;
      if (input) {
        input.value = target.dataset.text || "";
        input.focus();
      }
      return;
    }
    case "shot-on":
      if (state.screen !== "thread" || !state.thread.view || !canShowShot(state.thread.view)) return;
      state.thread.shot = true;
      renderKeepingDraft();
      window.scrollTo?.({ top: document.documentElement.scrollHeight });
      return;
    case "shot-off":
      state.thread.shot = false;
      renderKeepingDraft();
      scrollThreadToEnd();
      return;
    case "set-screenshots": {
      const allow = target.dataset.allow === "1";
      const result = await mutate("set_screenshots", contractPayload({ allowScreenshots: allow }), {
        success: allow ? "スクショの掲載を許しました。" : "スクショ掲載の許可を外しました。",
      });
      if (result) closeSheet();
      return;
    }
    case "recite-withdraw":
      await mutate("recite_withdraw", contractPayload(), { success: "復唱を取り下げました。" });
      return;
    case "recite-confirm": {
      const reward = target.dataset.reward || "";
      const rewardWord = reward === REWARD_WORD ? target.dataset.text || "" : "";
      const label = rewardText({ reward, rewardText: rewardWord });
      const seal = target.closest(".tribute-recite-confirm")?.querySelector('input[name="seal-recite"]:checked')?.value || sealChoices.get("recite") || "";
      const result = await mutate("recite_confirm", contractPayload({ reward, ...(rewardWord ? { rewardText: rewardWord } : {}), seal }), {
        success: label ? `「${sealLabel(seal) || "受領"}」の印に「${label}」を添えて、復唱を確かめました。` : `「${sealLabel(seal) || "受領"}」の印を押して、復唱を確かめました。`,
      });
      if (result) sealChoices.delete("recite");
      return;
    }
    case "extend-withdraw":
      await mutate("extend_withdraw", contractPayload(), { success: "延長の申し込みを取り下げました。" });
      return;
    case "extend-accept":
      await mutate("extend_accept", contractPayload(), { success: "延長を受けました。" });
      return;
    case "extend-decline":
      await mutate("extend_decline", contractPayload(), { success: "延長を断りました。" });
      return;
    case "set-holds": {
      const allow = target.dataset.allow === "1";
      const result = await mutate("set_holds", contractPayload({ allowHolds: allow }), {
        success: allow ? "お預けを受けるようにしました。" : "お預けを受けるのをやめました。",
      });
      if (result) closeSheet();
      return;
    }
    case "unhold":
      await mutate("unhold", contractPayload(), { success: "お預けを解きました。" });
      return;
    case "plea-withdraw":
      await mutate("plea_withdraw", contractPayload(), { success: "願い出を取り下げました。" });
      return;
    case "plea-answer-open":
      openSheet("plea-answer", { decision: target.dataset.decision === "grant" ? "grant" : "deny" });
      return;
    case "resist-open":
      openSheet("resist", { requestId: target.dataset.request });
      return;
    // 貢ぎオセロの罰金を差し出す。額は罰金（1回の上限まで）、名目は罰金のまま、いつもの長押しで差し出す。
    case "give-othello": {
      const result = view?.othelloResult;
      if (!result || view.role !== "payer") return;
      openSheet("give", { othello: true, amount: othelloPayable(view, result), purpose: "penalty", step: "hold" });
      return;
    }
    // 放牧の設定は「牧場をのぞく」の中にある。変えたら、その場で牧場の見え方を変える。
    case "set-grazing": {
      const allow = target.dataset.allow === "1";
      const result = await mutate("set_grazing", contractPayload({ allowGrazing: allow }), {
        success: allow ? "牧場に放牧されるようにしました。" : "牧場に放牧されないようにしました。",
      });
      if (!result) return;
      if (state.thread.view && result.contract) state.thread.view = { ...state.thread.view, allowGrazing: result.contract.allowGrazing === true };
      renderLayer();
      return;
    }
    // わたしの牧場: 動物を押すと、名前・ようす・動物を選ぶ・スレッドへが出る。もう一度押すと閉じる。
    case "ranch-animal":
      state.ranch.selected = state.ranch.selected === target.dataset.contract ? "" : String(target.dataset.contract || "");
      render();
      return;
    // なでる（設計書16.14）。1日1回。押した直後に、その動物の上にハートが浮かぶ。
    case "ranch-pat": {
      const contractId = String(target.dataset.contract || "");
      const row = state.contracts.find((contract) => contract.contractId === contractId);
      await mutate("ranch_pat", { contractId }, {
        after: (result) => {
          showToast(result?.unchanged ? "今日はもうなでました。" : `${row ? ranchName(row) : ""}をなでました。`);
          if (row) row.pattedAt = Number(result?.contract?.pattedAt) || Date.now();
          if (!result?.unchanged) state.ranch.heart = { contractId, at: Date.now() };
          if (state.screen === "hub") render();
        },
      });
      return;
    }
    case "ranch-photo":
      openRanchPhoto();
      return;
    case "ranch-photo-send":
    case "ranch-photo-save":
      await sendRanchPhoto(target.dataset.t === "ranch-photo-save");
      return;
    case "ranch-naming":
      state.ranch.naming = !state.ranch.naming;
      render();
      return;
    case "ranch-kind": {
      const contractId = String(target.dataset.contract || "");
      const animal = String(target.dataset.animal || "");
      await mutate("set_ranch_animal", { contractId, animal }, {
        success: `動物を「${RANCH_ANIMAL_LABELS[animal] || ""}」にしました。`,
        after: (result) => {
          const row = state.contracts.find((contract) => contract.contractId === contractId);
          if (row) row.ranchAnimal = result?.contract?.ranchAnimal || animal;
          if (state.screen === "hub") render();
        },
      });
      return;
    }
    case "set-othello": {
      const allow = target.dataset.allow === "1";
      const result = await mutate("set_othello", contractPayload({ allowOthello: allow }), {
        success: allow ? "貢ぎオセロを受けるようにしました。" : "貢ぎオセロを受けるのをやめました。",
      });
      if (result) closeSheet();
      return;
    }
    case "othello-move": {
      const game = view?.othello;
      if (!game || game.turn !== view.role) return;
      const note = String(document.querySelector("[data-othello-note]")?.value || "").trim();
      await mutate("othello_move", contractPayload({ gameSeq: game.gameSeq, index: Number(target.dataset.index), ...(note ? { note } : {}) }));
      return;
    }
    case "othello-situation":
      state.thread.othelloSituation = target.dataset.situation || "flip";
      if (state.screen === "thread") updateThreadParts();
      return;
    case "othello-note-pick": {
      const input = document.querySelector("[data-othello-note]");
      if (input) {
        input.value = String(target.dataset.text || "").slice(0, LIMITS.requestNote);
        input.focus();
      }
      return;
    }
    case "othello-resign": {
      const result = await mutate("othello_resign", contractPayload(), { success: "降参しました。" });
      if (result) closeSheet();
      return;
    }
    case "othello-end":
      await mutate("othello_end", contractPayload(), { success: "対局をやめました（罰金なし）。" });
      return;
    case "othello-claim":
      await mutate("othello_claim", contractPayload(), { success: "罰金を請求しました。" });
      return;
    case "othello-share": {
      if (!view || view.role !== "payer") return;
      openShare({ contractId: view.contractId, seq: Number(target.dataset.seq), mode: "othello" });
      return;
    }
    // 許された願い出を差し出す。金額と名目は願い出のまま、いつもの長押しで差し出す。
    case "give-granted": {
      const plea = view?.plea;
      if (!plea?.granted) return;
      openSheet("give", { granted: true, amount: plea.amount, purpose: plea.purpose || "", step: "hold" });
      return;
    }
    case "set-work-orders": {
      const allow = target.dataset.allow === "1";
      const result = await mutate("set_work_orders", contractPayload({ allowWorkOrders: allow }), {
        success: allow ? "出稼ぎ命令を受けるようにしました。" : "出稼ぎ命令を受けるのをやめました。",
      });
      if (result) closeSheet();
      return;
    }
    case "work-refresh":
      await refreshWorkProgress({ force: true });
      return;
    case "work-report": {
      const thread = state.thread;
      await mutate("work_report", contractPayload(), {
        after: (result) => {
          const count = Number(result?.count) || 0;
          if (state.thread === thread && result?.contract?.workOrder) thread.work = { orderSeq: result.contract.workOrder.orderSeq, count };
          const contest = result?.lost || result?.contract?.workOrder?.kind === "contest" || result?.contract?.workResult;
          showToast(result?.lost
            ? "期限が過ぎていたので、勝負は負けと決まりました。"
            : contest
              ? (result?.done ? `勝負を報告しました（${count}勝）。勝ちました。` : `勝負を報告しました（${count}勝）。`)
              : (result?.done ? `出稼ぎを報告しました（${count}回）。果たしました。` : `出稼ぎを報告しました（${count}回）。`));
          if (state.screen === "thread") updateThreadParts();
        },
      });
      return;
    }
    case "work-withdraw":
      await mutate("work_withdraw", contractPayload(), { success: view?.workOrder?.kind === "contest" ? "勝負を取り下げました。" : "出稼ぎ命令を取り下げました。" });
      return;
    // 出稼ぎの勝負（設計書15.3）。受ける・断るは財布、判定と罰金の請求は管理人。
    case "work-accept": {
      const result = await mutate("work_accept", contractPayload({ orderSeq: Number(target.dataset.seq) }), { success: "勝負を受けました。期限までに勝って、報告してください。" });
      if (result) refreshWorkProgress({ force: true });
      return;
    }
    case "work-decline":
      await mutate("work_decline", contractPayload({ orderSeq: Number(target.dataset.seq) }), { success: "勝負を断りました。" });
      return;
    case "work-judge":
      await mutate("work_judge", contractPayload(), { success: "期限が過ぎたので、勝負は負けと決まりました。" });
      return;
    case "work-claim":
      await mutate("work_claim", contractPayload(), { success: "勝負の罰金を請求しました。" });
      return;
    case "give-contest": {
      const result = view?.workResult;
      if (!result || view.role !== "payer") return;
      openSheet("give", { contest: true, amount: contestPayable(view, result), purpose: "penalty", step: "hold" });
      return;
    }
    case "work-confirm": {
      const reward = target.dataset.reward || "";
      const rewardWord = reward === REWARD_WORD ? target.dataset.text || "" : "";
      const label = rewardText({ reward, rewardText: rewardWord });
      const seal = target.closest(".tribute-work-confirm")?.querySelector('input[name="seal-work"]:checked')?.value || sealChoices.get("work") || "";
      const result = await mutate("work_confirm", contractPayload({ reward, ...(rewardWord ? { rewardText: rewardWord } : {}), seal }), {
        success: label ? `「${sealLabel(seal) || "受領"}」の印に「${label}」を添えて、出稼ぎを確かめました。` : `「${sealLabel(seal) || "受領"}」の印を押して、出稼ぎを確かめました。`,
      });
      if (result) sealChoices.delete("work");
      return;
    }
    case "set-purposes": {
      const allow = target.dataset.allow === "1";
      const result = await mutate("set_purposes", contractPayload({ allowSexualPurposes: allow }), {
        success: allow ? "性的な名目を許しました。" : "性的な名目の許可を外しました。",
      });
      if (result) closeSheet();
      return;
    }
    case "pick-amount": {
      const input = target.closest("form")?.elements?.[target.dataset.name || "amount"];
      if (input) {
        input.value = target.dataset.amount;
        input.focus();
      }
      return;
    }
    case "cancel-request":
      await mutate("cancel_request", contractPayload({ requestId: target.dataset.request }));
      return;
    case "escrow-decision":
      await mutate("escrow_decision", contractPayload({ approve: target.dataset.approve === "1" }), { success: target.dataset.approve === "1" ? "使用を許可しました。" : "却下しました。" });
      return;
    case "cancel-withdraw":
      await mutate("escrow_withdraw_cancel", contractPayload(), { success: "申請を取り下げました。" });
      return;
    case "cancel-raise":
      await mutate("cancel_raise", contractPayload(), { success: "上げる予約を取り消しました。" });
      return;
    case "report-balance":
      await mutate("report_balance", contractPayload(), { success: "残高を報告しました。" });
      return;
    case "request-report":
      await mutate("request_report", contractPayload(), { success: "残高報告を求めました。" });
      return;
    case "template": {
      const form = document.querySelector('[data-form="message"]');
      if (!form || !view) return;
      form.elements.text.value = target.dataset.text;
      form.dataset.template = "1";
      updateComposerCount(form);
      form.elements.text.focus();
      return;
    }
    // 管理人が定型文の強さを選ぶ（契約の強さまで）。開いたまま、定型文の欄だけ描き直す。
    case "template-tone": {
      const details = target.closest(".tribute-templates");
      if (!details || !view) return;
      state.thread.templateTone = target.dataset.tone;
      state.thread.templatesOpen = true;
      details.outerHTML = renderTemplates(view);
      return;
    }
    // 言われたい言葉を、入力欄のカーソルの位置に入れる。
    case "want-insert": {
      const form = document.querySelector('[data-form="message"]');
      const box = form?.elements?.text;
      if (!box) return;
      const word = target.dataset.text || "";
      const start = box.selectionStart ?? box.value.length;
      const end = box.selectionEnd ?? box.value.length;
      box.value = `${box.value.slice(0, start)}${word}${box.value.slice(end)}`.slice(0, LIMITS.message);
      delete form.dataset.template;
      updateComposerCount(form);
      box.focus();
      const caret = Math.min(box.value.length, start + word.length);
      box.setSelectionRange(caret, caret);
      return;
    }
    case "receipt-close":
      state.receipt = null;
      rerenderReceipt();
      return;
    case "receipts-more": {
      await loadMoreReceipts();
      return;
    }
    case "vault-chip": {
      // 金額の候補（財布の全部・金庫の全部も選べる）。
      const form = target.closest('form[data-form="vault"]');
      if (!form) return;
      const vault = state.vault.data?.vault || {};
      const preset = target.dataset.amount === "wallet" ? state.walletBalance : target.dataset.amount === "vault" ? vault.amount : Number(target.dataset.amount);
      if (Number.isSafeInteger(preset) && preset > 0) form.elements.amount.value = String(preset);
      return;
    }
    case "open-x": {
      const handle = String(target.dataset.handle || "");
      if (!X_HANDLE_PATTERN.test(handle) || !window.confirm(X_EXTERNAL_CONFIRM_MESSAGE)) return;
      const external = window.open(`https://x.com/${encodeURIComponent(handle)}`, "_blank", "noopener,noreferrer");
      if (external) external.opener = null;
      return;
    }
    case "open-achievements":
      requestHome();
      window.setTimeout(() => window.HariaiApp.openOnlineFeature("openAchievements"), 0);
      return;
    case "legacy-market": {
      requestHome();
      window.setTimeout(() => window.HariaiApp.openMarketRecords(), 0);
      return;
    }
    default:
  }
}

async function loadMoreReceipts() {
  const generation = lifecycleGeneration;
  const target = state.receipts;
  if (target.loadingMore || !target.more) return;
  target.loadingMore = true;
  if (state.screen === "receipts") render();
  const last = target.items.at(-1);
  try {
    const payload = await call("receipts", { cursor: target.cursor || { createdAt: last.createdAt, receiptId: last.receiptId } });
    if (!isCurrent(generation) || state.receipts !== target) return;
    const items = new Map(target.items.map((receipt) => [receipt.receiptId, receipt]));
    for (const receipt of payload.receipts || []) items.set(receipt.receiptId, receipt);
    target.items = [...items.values()];
    target.more = payload.more === true;
    target.cursor = payload.nextCursor || null;
  } catch (error) {
    if (!isCurrent(generation) || state.receipts !== target) return;
    showToast(friendlyError(error));
  } finally {
    target.loadingMore = false;
    if (isCurrent(generation) && state.receipts === target && state.screen === "receipts") render();
  }
}

async function loadMoreEndedContracts() {
  const target = state.ended;
  if (!target.more || target.loading) return;
  target.loading = true;
  target.open = true;
  render();
  try {
    const result = await readOnce("ended_contracts", { cursor: target.cursor });
    if (!result || state.ended !== target) return;
    const contracts = new Map(state.contracts.map((contract) => [contract.contractId, contract]));
    for (const contract of result.contracts || []) contracts.set(contract.contractId, contract);
    state.contracts = [...contracts.values()];
    target.more = result.more === true;
    target.cursor = result.nextCursor || null;
  } catch (error) {
    if (state.ended === target) showToast(friendlyError(error));
  } finally {
    target.loading = false;
    if (active && state.ended === target && state.screen === "hub") render();
  }
}

function bindRoot(root) {
  if (!root) return;
  root.addEventListener("click", (event) => {
    if (!active) return;
    const target = event.target.closest?.("[data-t]");
    if (!target || !target.closest(".tribute-screen, .tribute-layer")) return;
    // 入力欄とプルダウンは change で扱う。click で描き直すと、プルダウンが開いた途端に作り直されて閉じる（PC・スマホとも）。
    if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
    event.preventDefault();
    handleClick(target).finally(() => {
      if (active && ["accept", "decline", "withdraw", "terminate", "release", "toggle-accepting"].includes(target.dataset.t) && state.screen !== "thread") render();
    });
  });

  root.addEventListener("change", (event) => {
    if (!active) return;
    const target = event.target.closest?.('input[data-t="toggle-nekama"], input[data-t="toggle-fee-zero"], input[data-t="toggle-declaration"], select[data-t="board-style"]');
    if (target) handleClick(target);
    // 出稼ぎの型（完走・勝負）を切り替えると、選ぶものが変わるので描き直す。
    if (event.target.closest?.('form[data-form="work-order"]') && event.target.name === "kind" && state.sheet?.type === "work") {
      state.sheet.kind = event.target.value === "contest" ? "contest" : "run";
      rerenderSheet();
      return;
    }
    const cardForm = event.target.closest?.('form[data-form="card"]');
    if (cardForm && event.target.name === "styles" && cardForm.querySelectorAll('input[name="styles"]:checked').length > MAX_MANAGER_STYLES) {
      event.target.checked = false;
      showToast(`管理の型は${MAX_MANAGER_STYLES}つまでです。`);
    }
    if (cardForm && ["avatar", "sigil", "disclosure", "styles", "entryFee", "ignoreUnpaid", "postsScreenshots", "showsActivity"].includes(event.target.name)) updateCardPreview(cardForm);
    if (cardForm && event.target.name === "avatar") updateDecorations(cardForm);
    if (cardForm && ["frame", "frameColor", "sealShape", "sealInk"].includes(event.target.name)) {
      if (event.target.name === "frame") refreshFrameColors(cardForm);
      updateDecorations(cardForm);
      updateCardPreview(cardForm);
      updateSealPreview(cardForm);
    }
    if (cardForm && event.target.name === "achievements") {
      if (cardForm.querySelectorAll('input[name="achievements"]:checked').length > CARD_ACHIEVEMENT_LIMIT) {
        event.target.checked = false;
        showToast(`カードに出す実績は${CARD_ACHIEVEMENT_LIMIT}つまでです。`);
      }
      updateCardPreview(cardForm);
    }
    if (cardForm && event.target.name === "seals") {
      if (cardForm.querySelectorAll('input[name="seals"]:checked').length > MAX_SEALS) {
        event.target.checked = false;
        showToast(`受取印は${MAX_SEALS}つまでです。`);
      }
      updateSealPreview(cardForm);
    }
    const sealPick = String(event.target.name || "").match(/^seal-(\d+)$/);
    if (sealPick) sealChoices.set(Number(sealPick[1]), event.target.value);
    if (event.target.name === "seal-work") sealChoices.set("work", event.target.value);
    const requestForm = event.target.closest?.('form[data-form="request"]');
    if (requestForm && event.target.name === "purpose" && state.thread.view) {
      const chips = requestForm.querySelector("[data-note-chips]");
      if (chips) chips.innerHTML = renderNoteChips(event.target.value, state.thread.view);
    }
    const sheet = state.sheet;
    if (sheet?.type === "share" && event.target.matches?.("[data-share-option]")) {
      sheet.options[event.target.dataset.shareOption] = event.target.checked;
      refreshSharePreview();
    }
    if (sheet?.type === "share" && event.target.matches?.("[data-share-mode]")) {
      sheet.mode = event.target.value === "excerpt" ? "excerpt" : "receipt";
      refreshSharePreview();
    }
  });

  root.addEventListener("submit", (event) => {
    if (!active) return;
    const form = event.target.closest?.("form[data-form]");
    if (!form || !form.closest(".tribute-screen, .tribute-layer")) return;
    event.preventDefault();
    // 金庫の「入れる」「出す」のように、押したボタンで向きが変わるフォーム。
    if (event.submitter?.name === "direction") form.dataset.direction = event.submitter.value;
    handleSubmit(form).catch((error) => setFormError(form, friendlyError(error)));
  });

  root.addEventListener("input", (event) => {
    if (!active || event.isComposing) return;
    const form = event.target.closest?.('form[data-form="message"]');
    if (form) {
      form.dataset.template = "";
      updateComposerCount(form);
    }
    const cardForm = event.target.closest?.('form[data-form="card"]');
    if (cardForm && event.target.name === "personaName") {
      updateCardPreview(cardForm);
      updateSealPreview(cardForm);
    }
    if (cardForm && event.target.name === "intro") updateCardPreview(cardForm);
  });

  root.addEventListener("pointerdown", (event) => {
    if (!active) return;
    const button = event.target.closest?.("[data-tribute-hold]");
    if (!button || button.disabled) return;
    event.preventDefault();
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // 合成イベントなど、捕捉できないポインターでも長押しは続ける。
    }
    beginHold(button);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    root.addEventListener(type, (event) => {
      if (!hold || !event.target.closest?.("[data-tribute-hold]")) return;
      cancelHold();
    });
  }
  root.addEventListener("keydown", (event) => {
    if (!active || event.repeat || ![" ", "Enter"].includes(event.key)) return;
    const button = event.target.closest?.("[data-tribute-hold]");
    if (!button) return;
    event.preventDefault();
    beginHold(button);
  });
  root.addEventListener("keyup", (event) => {
    if (![" ", "Enter"].includes(event.key) || !event.target.closest?.("[data-tribute-hold]")) return;
    cancelHold();
  });
  root.addEventListener("contextmenu", (event) => {
    if (active && event.target.closest?.("[data-tribute-hold]")) event.preventDefault();
  });
}

bindRoot(appRoot);
bindRoot(layer);

// ───────────── 起動と終了 ─────────────

function modeIsActiveElsewhere() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiAiTextTraining?.isActive?.()
    || window.HariaiRouletteTraining?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiAccount?.isActive?.(),
  );
}

function paintWallet() {
  if (state.walletBalance === null) return;
  document.querySelectorAll("[data-tribute-wallet]").forEach((node) => {
    node.textContent = formatPay(state.walletBalance);
  });
  document.querySelectorAll("[data-start-guide-balance]").forEach((node) => {
    node.innerHTML = guideBalanceMarkup();
  });
}

function subscribeWallet() {
  walletUnsubscribe?.();
  walletUnsubscribe = null;
  if (previewScreen || !state.uid || !state.ageConfirmed) return;
  walletUnsubscribe = onSnapshot(doc(firestore, "wallets", state.uid), (snapshot) => {
    if (!active) return;
    const balance = Number(snapshot.data()?.balance);
    // まだ AnjuPay の財布がない人（はじめて来た人）は 0 Pay。献上の時にはサーバーが財布を用意する。
    state.walletBalance = !snapshot.exists() ? 0 : Number.isSafeInteger(balance) ? balance : null;
    paintWallet();
  }, () => {});
}

async function start({ initialScreen = "", inviteManager = "" } = {}) {
  if (active) {
    if (inviteManager) openManager(inviteManager, { invited: true });
    else if (initialScreen) navigate(initialScreen);
    return;
  }
  if (inviteManager) pendingInvite = inviteManager;
  if (location.protocol === "file:") {
    showToast("お貢ぎ牧場はローカルサーバーまたは公開URLから開いてください。");
    return;
  }
  if (modeIsActiveElsewhere()) {
    showToast("ほかのモードを終了してからお貢ぎ牧場を開いてください。");
    return;
  }
  active = true;
  markRanchUrl(true);
  const generation = ++lifecycleGeneration;
  state = createState();
  stateRequest = null;
  markReadProgress = new Map();
  setChrome("OMITSUGI RANCH / CONNECTING");
  render();
  try {
    if (previewScreen) {
      state.uid = "preview-me";
    } else {
      const user = await ensureUser();
      if (!isCurrent(generation)) return;
      state.uid = user.uid;
    }
    const payload = await requestState({ summaryOnly: initialScreen === "ranking" || Boolean(pendingInvite) });
    if (!payload || !isCurrent(generation)) return;
    setChrome();
    subscribeWallet();
    window.clearInterval(tickTimer);
    tickTimer = window.setInterval(() => {
      if (active && state.screen === "thread" && state.thread.raw) {
        state.thread.view = viewContract(withThreadLimits(state.thread.raw), state.uid);
        updateThreadParts();
      }
    }, 60_000);
    if (!state.ageConfirmed) {
      state.screen = "age";
      render();
      return;
    }
    if (pendingInvite) {
      const invite = pendingInvite;
      pendingInvite = "";
      openManager(invite, { invited: true });
      return;
    }
    if (previewScreen) {
      startPreview(previewScreen);
      return;
    }
    const screen = SCREEN_ALIASES[initialScreen] || initialScreen;
    navigate(SCREENS.has(screen) ? screen : "hub", { refresh: false });
  } catch (error) {
    if (!isCurrent(generation)) return;
    state.screen = "error";
    state.fatalReloadRequired = needsPageReload(error);
    state.fatalError = friendlyError(error, "お貢ぎ牧場へ接続できませんでした。");
    setChrome("OMITSUGI RANCH / ERROR");
    render();
  }
}

function isActive() {
  return active;
}

function requestHome() {
  pendingInvite = "";
  if (!active) return;
  active = false;
  document.body?.classList.remove("tribute-shot-mode");
  lifecycleGeneration += 1;
  cancelHold();
  stopThread();
  walletUnsubscribe?.();
  walletUnsubscribe = null;
  window.clearInterval(tickTimer);
  tickTimer = null;
  closeSharePreview();
  state.sheet = null;
  state.receipt = null;
  layer.innerHTML = "";
  markRanchUrl(false);
  window.HariaiApp?.returnHome?.();
}

window.addEventListener("visibilitychange", () => {
  if (!active || document.visibilityState !== "visible") return;
  if (state.screen === "hub") refreshState();
  if (state.screen === "thread") scheduleMarkRead();
});

window.addEventListener("beforeunload", () => {
  active = false;
  lifecycleGeneration += 1;
  stopThread();
  walletUnsubscribe?.();
});

window.addEventListener("hariai-player-safety-updated", () => {
  if (!active) return;
  state.readRequests.clear();
  if (state.screen === "board") loadBoard();
  else if (state.screen === "hub") refreshState();
  else if (state.screen === "thread") navigate("hub");
});

// ───────────── 見本（localhost のみ・Firebase に触れない） ─────────────

function previewNow() {
  return Date.now();
}

// 見学用の見本の契約。本番でも開けるが、サーバーには何も送らない（call() が見本の処理へ回す）。
// 性的な名目にまだ同意していない人も見るため、名目は管理費・ご褒美代・罰金だけにする。
const DEMO_CONTRACT_ID = "demo";
const DEMO_MANAGER_CARD = Object.freeze({ personaName: "ミオ様（見本）", disclosure: "nekama", styles: ["tease"], sigil: 0, avatar: 7 });

function demoThread() {
  const now = Date.now();
  const at = (minutes) => now - minutes * 60_000;
  const raw = {
    contractId: DEMO_CONTRACT_ID,
    managerUid: "demo-manager",
    payerUid: state.uid || "demo-wallet",
    status: "active",
    managerCard: DEMO_MANAGER_CARD,
    payerWalletName: "あなた",
    entryFee: 0,
    caps: { perTribute: 100, perDay: 300, total: 1_000 },
    pendingCaps: null,
    pendingCapsEffectiveDateKey: "",
    durationDays: 3,
    tone: "harsh",
    ngWords: [],
    allowReportRequests: false,
    rankOptIn: false,
    allowSexualPurposes: false,
    collarNo: 3,
    purposeCounts: { management: 1, reward_fee: 1 },
    rewardCount: 1,
    awaitingReceipt: 1,
    createdAt: at(180),
    acceptedAt: at(170),
    expiresAt: now + 2.5 * 86_400_000,
    totalTributed: 60,
    tributeCount: 2,
    todayKey: jstDateKey(now),
    todayTributed: 60,
    escrowBalance: 0,
    escrowWithdrawRequest: null,
    pendingRequests: { "0123456789abcdef": { amount: 30, note: "待たせた罰金。", purpose: "penalty", createdAt: at(3) } },
    reportRequestedAt: 0,
    allowWorkOrders: true,
    workOrderSeq: 1,
    workOrder: { orderSeq: 1, target: 3, note: "3号、出稼ぎの時間だ。", issuedAt: at(2), reportedCount: 0, reportedAt: 0, doneAt: 0 },
    eventSeq: 10,
    readSeq: { manager: 10, payer: 10 },
  };
  const events = [
    { seq: 1, type: "applied", actor: "payer", caps: raw.caps, durationDays: 3, tone: "harsh", entryFee: 0, createdAt: at(180) },
    { seq: 2, type: "accepted", actor: "manager", expiresAt: raw.expiresAt, collarNo: 3, createdAt: at(170) },
    { seq: 3, type: "message", actor: "manager", text: "やっと来た。財布のくせに待たせるな。", createdAt: at(168) },
    { seq: 4, type: "request", actor: "manager", requestId: "fedcba9876543210", amount: 30, note: "今日の管理費。", purpose: "management", createdAt: at(120) },
    { seq: 5, type: "tribute", actor: "payer", kind: "request", requestId: "fedcba9876543210", amount: 30, purpose: "management", receiptId: "d".repeat(40), receivedAt: at(117), seal: "yoku", reward: "gohoubi", createdAt: at(118) },
    { seq: 6, type: "received", actor: "manager", tributeSeq: 5, amount: 30, seal: "yoku", reward: "gohoubi", createdAt: at(117) },
    { seq: 7, type: "tribute", actor: "payer", kind: "silent", amount: 30, purpose: "reward_fee", receiptId: "c".repeat(40), createdAt: at(30) },
    { seq: 8, type: "message", actor: "manager", text: "それっぽっち？まあ、あとで受け取ってやる。", createdAt: at(20) },
    { seq: 9, type: "request", actor: "manager", requestId: "0123456789abcdef", amount: 30, note: "待たせた罰金。", purpose: "penalty", createdAt: at(3) },
    { seq: 10, type: "work_order", actor: "manager", orderSeq: 1, target: 3, note: "3号、出稼ぎの時間だ。", createdAt: at(2) },
  ];
  return { raw, events };
}

// 招待リンク（?ranch=公開ID）。読んだらすぐURLから消し、年齢確認のあと、その管理人の詳細を開く。
let pendingInvite = "";

function takeInviteFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(INVITE_QUERY_KEY)) return "";
    const invite = inviteFromUrl(url.href);
    url.searchParams.delete(INVITE_QUERY_KEY);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return invite;
  } catch {
    return "";
  }
}

// 見本で保存したカード。ページを読み直すまで、見本の state がこれを返す。
let previewSavedProfile = null;
// 見本で付けた呼び名（契約ID → 呼び名）。ページを読み直すまで、見本の state がこれを返す。
const previewNicknames = new Map();

// 見本のスレッドを画面の上でだけ進める（受け取る・ご褒美・名目の確認用）。
function previewThreadChange(change) {
  const thread = state.thread;
  if (!thread.raw) return null;
  const at = previewNow();
  const push = (event) => {
    thread.raw.eventSeq = Number(thread.raw.eventSeq || 0) + 1;
    thread.raw.readSeq = { ...thread.raw.readSeq, [thread.view?.role || "payer"]: thread.raw.eventSeq };
    thread.events = [...thread.events, { seq: thread.raw.eventSeq, createdAt: at, ...event }];
  };
  change(thread.raw, push, at);
  thread.view = viewContract(thread.raw, state.uid, at);
  window.setTimeout(() => updateThreadParts(), 0);
  return thread.view;
}

const previewOwnedDecorations = new Set(["ranch_frame_kurokawa", "ranch_seal_heart", "ranch_ink_sakura", "ranch_avatar_41"]);
// 見本の金庫（vault-new はまだ金庫を作れない管理人）。
const previewVault = { qualified: previewScreen !== "vault-new", amount: previewScreen === "vault-new" ? 0 : 12_400, tier: 0, bestTier: 0 };
previewVault.tier = vaultTierFor(previewVault.amount);
previewVault.bestTier = previewVault.tier;

function previewVaultView() {
  return { ...previewVault, hasCard: true, ...(previewVault.qualified ? {} : { progress: { payers: 2, received: 640, needPayers: VAULT_QUALIFY.payers, needReceived: VAULT_QUALIFY.received } }) };
}

const PREVIEW_MANAGER_CARD = Object.freeze({
  publicManagerId: "a1b2c3d4e5f6a1b2c3d4e5f6",
  personaName: "ミオ様",
  intro: "雑魚財布は黙って差し出せ。中身は男、分かって来な。",
  disclosure: "nekama",
  styles: ["insight", "tease"],
  entryFee: 10,
  sigil: 0,
  avatar: 7,
  seals: ["yoku", "zako", "kakunin"],
  ignoreUnpaid: true,
  postsScreenshots: true,
  highRequest: true,
  frame: "gyokuza",
  frameColor: "pink",
  sealShape: "heart",
  sealInk: "sakura",
  achievements: ["tribute_manager_10", "battle_total_10", "tribute_wallet_3"],
  reportConsent: true,
  word: { text: "今夜は機嫌がいい。財布は並びな。", at: Date.now() - 2 * 3_600_000 },
  xHandle: "mio_sama_ranch",
  accepting: true,
  vault: { level: 4, id: "treasury", label: "宝物庫" },
  ranchLevel: 6,
  activeContracts: 4,
  showsActivity: true,
  lastActiveAt: Date.now(),
});

// 見本の応援欄。manager は財布として、manager-mine は自分の管理人として見る。画面の上でだけ書き換える。
const PREVIEW_OWN_MANAGER_ID = "f".repeat(24);
const previewCheers = [
  { cheerId: "a1a1a1a1a1a1a1a1", walletName: "しもべ3号", text: "今月も一番に貢ぎます。見ててください。", at: Date.now() - 5 * 3_600_000, seen: true, hidden: false, mine: false },
  { cheerId: "b2b2b2b2b2b2b2b2", walletName: "ポチ財布", text: "請求、いつでも待ってます", at: Date.now() - 40 * 60_000, seen: false, hidden: false, mine: true },
  { cheerId: "c3c3c3c3c3c3c3c3", walletName: "名無しの財布", text: "はじめて貢ぎました。よろしくお願いします", at: Date.now() - 26 * 3_600_000, seen: false, hidden: false, mine: false },
];

function previewCheerView(mine) {
  return previewCheers
    .filter((cheer) => mine || !cheer.hidden || cheer.mine)
    .map((cheer) => ({ ...cheer, mine: !mine && cheer.mine }));
}

function previewRaw(role, status = "active") {
  const now = previewNow();
  const me = "preview-me";
  return {
    contractId: role === "payer" ? "1".repeat(40) : status === "pending" ? "3".repeat(40) : "2".repeat(40),
    managerUid: role === "manager" ? me : "preview-other",
    payerUid: role === "payer" ? me : "preview-other",
    status,
    managerCard: role === "payer" ? PREVIEW_MANAGER_CARD : { personaName: "レイ", disclosure: "as_is", styles: ["manage"], sigil: 2, avatar: 5 },
    payerWalletName: role === "payer" ? "ポチ財布" : "しもべ3号",
    entryFee: 10,
    caps: { perTribute: 100, perDay: 300, total: 1_000 },
    pendingCaps: role === "payer" ? { perTribute: 300, perDay: 300, total: 1_000 } : null,
    pendingCapsEffectiveDateKey: role === "payer" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + 86_400_000)) : "",
    durationDays: 3,
    tone: "harsh",
    ngWords: ["ブス", "デブ"],
    wantWords: ["ざこ", "3号", "養分"],
    managerPublicId: role === "payer" ? PREVIEW_MANAGER_CARD.publicManagerId : "",
    // お預け: 財布の見本は許された願い出、管理人の見本は答えを待つ願い出。
    allowHolds: true,
    hold: status === "active" ? { since: now - 3 * 3_600_000, note: role === "payer" ? "お預けだ。許すまで財布に触るな。" : "許すまで待ちなさい。" } : null,
    plea: status === "active"
      ? { pleaSeq: 1, amount: role === "payer" ? 100 : 300, purpose: role === "payer" ? "" : "management", note: "貢がせてください。", createdAt: now - 40 * 60_000, grantedAt: role === "payer" ? now - 10 * 60_000 : 0 }
      : null,
    pleaSeq: 1,
    pleaCount: 2,
    pleaGrantedCount: 1,
    resistedTributes: 1,
    // 復唱: 財布の見本は途中、管理人の見本は果たした（確認待ち）。延長: 管理人の見本に申し込みがある。
    reciteSeq: 1,
    reciteOrder: status === "active"
      ? { orderSeq: 1, text: "私は財布です。貢ぐことしかできません。", target: 3, count: role === "payer" ? 1 : 3, issuedAt: now - 30 * 60_000, doneAt: role === "payer" ? 0 : now - 5 * 60_000 }
      : null,
    recitesDone: 1,
    wordOfferings: 1,
    extension: status === "active" && role === "manager" ? { days: 7, createdAt: now - 15 * 60_000 } : null,
    allowReportRequests: true,
    rankOptIn: true,
    allowSexualPurposes: true,
    allowScreenshots: role === "manager",
    collarNo: 3,
    purposeCounts: { edging: 2 },
    rewardCount: 1,
    awaitingReceipt: 1,
    createdAt: now - 7_200_000,
    acceptedAt: status === "active" ? now - 7_000_000 : 0,
    expiresAt: status === "active" ? now + 2.5 * 86_400_000 : now + 40 * 3_600_000,
    totalTributed: 210,
    tributeCount: 3,
    todayKey: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)),
    todayTributed: 110,
    escrowBalance: 200,
    escrowWithdrawRequest: role === "manager" ? { amount: 50, requestedAt: now - 60_000 } : null,
    pendingRequests: { abcdef0123456789: { amount: 10_000, note: "払えないなら黙ってな。", purpose: "release", resists: 1, createdAt: now - 3 * 86_400_000 } },
    managerIgnoreUnpaid: true,
    ignoredSince: now - 2 * 86_400_000 - 3_600_000,
    reportRequestedAt: role === "payer" ? now - 30_000 : 0,
    allowWorkOrders: true,
    workOrderSeq: previewScreen.endsWith("-contest") ? 2 : 1,
    workOrder: previewWorkOrder(role, now),
    workOrdersDone: role === "payer" ? 0 : 1,
    // 貢ぎオセロ: 管理人の見本は自分の手番の対局、財布の見本は差し出す罰金。
    allowOthello: true,
    allowGrazing: true,
    othelloSeq: role === "payer" ? 2 : 3,
    othello: role === "manager" ? previewOthelloGame(now) : null,
    othelloResult: role === "payer" ? { gameSeq: 2, penalty: 15, stones: 3, rate: 5, resigned: false, finishedAt: now - 20 * 60_000 } : null,
    othelloRecord: { played: 2, lost: 2, won: 0, drawn: 0, streak: 2 },
    eventSeq: role === "payer" ? 18 : 17,
    readSeq: { manager: 16, payer: 14 },
  };
}

// 見本の出稼ぎ命令。thread-payer-contest は受ける前の勝負、thread-manager-contest は期限の過ぎた勝負（判定の確認用）。
function previewWorkOrder(role, now) {
  if (previewScreen === "thread-payer-contest" && role === "payer") {
    return { orderSeq: 2, kind: "contest", target: 3, days: 1, penalty: 300, note: "勝ってきなさい。負けたら罰金ね。", issuedAt: now - 10 * 60_000, acceptedAt: 0, deadline: 0, reportedCount: 0, reportedAt: 0, doneAt: 0 };
  }
  if (previewScreen === "thread-manager-contest" && role === "manager") {
    return { orderSeq: 2, kind: "contest", target: 3, days: 1, penalty: 50, note: "負けたら罰金。勝ってから顔を出せ。", issuedAt: now - 26 * 3_600_000, acceptedAt: now - 25 * 3_600_000, deadline: now - 3_600_000, reportedCount: 1, reportedAt: now - 5 * 3_600_000, doneAt: 0 };
  }
  return role === "payer"
    ? { orderSeq: 1, target: 3, note: "財布が空なら稼いでこい。", issuedAt: now - 50 * 60_000, reportedCount: 1, reportedAt: now - 20 * 60_000, doneAt: 0 }
    : { orderSeq: 1, target: 3, note: "稼いでから顔を出せ。", issuedAt: now - 50 * 60_000, reportedCount: 3, reportedAt: now - 4 * 60_000, doneAt: now - 4 * 60_000 };
}

// 見本の勝負の負け（サーバーの settleContestLoss と同じ）。
function previewSettleContest(raw, push, at, order) {
  raw.workOrder = null;
  raw.workResult = { orderSeq: order.orderSeq, penalty: order.penalty, target: order.target, wins: order.reportedCount || 0, settledAt: at };
  raw.contestLosses = Number(raw.contestLosses || 0) + 1;
  push({ type: "work_contest_lost", actor: "system", orderSeq: order.orderSeq, target: order.target, wins: order.reportedCount || 0, penalty: order.penalty });
}

// 見本の決着（サーバーの finishOthello と同じ）。
function previewFinishOthello(raw, push, game, board, resigned) {
  const outcome = othelloOutcome(board, game.rate, { resigned });
  const record = raw.othelloRecord || { played: 0, lost: 0, won: 0, drawn: 0, streak: 0 };
  const next = {
    played: record.played + 1,
    lost: record.lost + (outcome.result === "lost" ? 1 : 0),
    won: record.won + (outcome.result === "won" ? 1 : 0),
    drawn: record.drawn + (outcome.result === "draw" ? 1 : 0),
    streak: outcome.result === "lost" ? record.streak + 1 : 0,
  };
  raw.othello = null;
  raw.othelloRecord = next;
  raw.othelloResult = outcome.penalty > 0 ? { gameSeq: game.gameSeq, penalty: outcome.penalty, stones: outcome.stones, rate: game.rate, resigned, finishedAt: Date.now() } : null;
  push({ type: "othello_finish", actor: resigned ? "payer" : "system", gameSeq: game.gameSeq, result: outcome.result, manager: outcome.manager, payer: outcome.payer, stones: outcome.stones, rate: game.rate, penalty: outcome.penalty, resigned, board, record: next });
}

// 見本の対局（数手進めた盤）。管理人の手番で止める。
function previewOthelloGame(now) {
  let board = othelloInitialBoard("manager_corner");
  let turn = "payer";
  let lastMove = null;
  for (let step = 0; step < 5; step += 1) {
    const moves = othelloMoves(board, othelloSide(turn));
    if (!moves.length) break;
    const played = othelloPlay(board, othelloSide(turn), moves[moves.length - 1]);
    lastMove = { index: moves[moves.length - 1], flipped: played.flipped, role: turn };
    board = played.board;
    const next = othelloNextTurn(board, turn);
    if (!next.turn) break;
    turn = next.turn;
  }
  if (turn !== "manager") turn = othelloMoves(board, "M").length ? "manager" : turn;
  return { gameSeq: 3, board, turn, rate: 5, handicap: "manager_corner", startedAt: now - 30 * 60_000, lastMoveAt: now - 2 * 60_000, lastMove };
}

function previewEvents(raw) {
  const now = previewNow();
  const at = (minutes) => now - minutes * 60_000;
  if (raw.status === "pending") {
    return [{ seq: 1, type: "applied", actor: "payer", caps: raw.caps, durationDays: 3, tone: "harsh", entryFee: 10, createdAt: at(30) }];
  }
  return [
    { seq: 1, type: "applied", actor: "payer", caps: raw.caps, durationDays: 3, tone: "harsh", entryFee: 10, createdAt: at(120) },
    { seq: 2, type: "accepted", actor: "manager", expiresAt: raw.expiresAt, collarNo: 3, createdAt: at(117) },
    { seq: 3, type: "tribute", actor: "payer", kind: "entry", amount: 10, createdAt: at(117) },
    { seq: 4, type: "message", actor: "manager", text: "やっと来た。財布のくせに待たせるな。", createdAt: at(110) },
    { seq: 5, type: "message", actor: "payer", text: "遅れてすみません。", createdAt: at(108) },
    { seq: 6, type: "request", actor: "manager", requestId: "0123456789abcdef", amount: 100, note: "まだイかせない。", purpose: "edging", createdAt: at(100) },
    { seq: 7, type: "tribute", actor: "payer", kind: "request", requestId: "0123456789abcdef", amount: 100, purpose: "edging", receiptId: "7".repeat(40), receivedAt: at(97), seal: "yoku", reward: "gohoubi", createdAt: at(98) },
    { seq: 8, type: "received", actor: "manager", tributeSeq: 7, amount: 100, seal: "yoku", reward: "gohoubi", createdAt: at(97) },
    { seq: 9, type: "escrow_deposit", actor: "payer", amount: 200, escrowBalance: 200, createdAt: at(60) },
    { seq: 10, type: "caps_raise_scheduled", actor: "payer", caps: { perTribute: 300, perDay: 300, total: 1_000 }, effectiveDateKey: raw.pendingCapsEffectiveDateKey || "2026-10-06", createdAt: at(40) },
    { seq: 11, type: "report_requested", actor: "manager", createdAt: at(5) },
    { seq: 12, type: "escrow_withdraw_request", actor: "payer", amount: 50, createdAt: at(1) },
    { seq: 13, type: "message", actor: "manager", text: "中身が男だって知ってて貢ぐんだ。救いようがないね。", createdAt: at(3) },
    { seq: 14, type: "tribute", actor: "payer", kind: "silent", amount: 50, purpose: "edging", receiptId: "e".repeat(40), createdAt: at(2) },
    { seq: 15, type: "message", actor: "payer", text: "寸止め料です。", createdAt: at(2) },
    { seq: 16, type: "request", actor: "manager", requestId: "abcdef0123456789", amount: 10_000, note: "払えないなら黙ってな。", purpose: "release", createdAt: Date.now() - 3 * 86_400_000 },
    { seq: 17, type: "word_offering", actor: "payer", text: "今日も負けました。\n貢げなかった分、言葉だけ置いていきます。", createdAt: at(1) },
    // 財布の見本は、罰金の残る決着（画像で保存の確認用）。
    ...(raw.othelloResult ? [{ seq: 18, type: "othello_finish", actor: "system", gameSeq: raw.othelloResult.gameSeq, result: "lost", manager: 32, payer: 29, stones: 3, rate: 5, penalty: 15, resigned: false, board: previewFinishedBoard(), record: raw.othelloRecord, createdAt: at(0.5) }] : []),
  ];
}

// 見本の決着の盤（管理人32枚・財布29枚・空き3）。
function previewFinishedBoard() {
  const cells = Array.from({ length: 64 }, (_, index) => ((index * 7 + Math.floor(index / 8)) % 61 < 31 ? "M" : "P"));
  [5, 30, 58].forEach((index) => { cells[index] = "."; });
  let manager = cells.filter((cell) => cell === "M").length;
  for (let index = 0; manager > 32 && index < 64; index += 1) if (cells[index] === "M") { cells[index] = "P"; manager -= 1; }
  for (let index = 63; manager < 32 && index >= 0; index -= 1) if (cells[index] === "P") { cells[index] = "M"; manager += 1; }
  return cells.join("");
}

function previewThread(contractId) {
  // 4… は財布として受理された後に期限で終わった契約（「同じ条件で申し込む」の見本）。
  if (contractId === "4".repeat(40)) {
    const now = previewNow();
    const raw = { ...previewRaw("payer", "ended"), contractId, endReason: "expired", acceptedAt: now - 3 * 86_400_000, endedAt: now - 3_600_000, pendingRequests: {}, workOrder: null };
    return { raw, events: previewEvents({ ...raw, status: "active" }) };
  }
  const role = contractId === "1".repeat(40) ? "payer" : "manager";
  const raw = previewRaw(role, contractId === "3".repeat(40) ? "pending" : "active");
  return { raw, events: previewEvents(raw) };
}

// 見本の牧場の財布（管理人の進行中の契約）。食べる・届け物・つながれている・のんびり・出稼ぎ中を1頭ずつ。
// ranch-crowd は、立ち位置（12か所）より多い20頭で、並び方と吹き出しの持ち回りを確かめる見本。
function previewHerd(now, total = 6) {
  const base = (index, extra) => ({
    ...previewRaw("manager"),
    contractId: index < 6 ? "56789a"[index].repeat(40) : `c${String(index).padStart(2, "0")}`.repeat(14).slice(0, 40),
    payerWalletName: ["ポチ財布", "しもべ1号", "名無しの財布", "ミルク", "モブ財布", "こむぎ"][index] || `財布${index + 1}`,
    collarNo: 4 + index,
    allowGrazing: true,
    ranchAnimal: ["pig", "goat", "cow", "rabbit", "sheep", "chicken"][index % 6],
    servedTotal: [3, 12, 45, 120, 400, 30][index % 6],
    hold: null,
    plea: null,
    reciteOrder: null,
    extension: null,
    workOrder: null,
    pendingRequests: {},
    awaitingReceipt: 0,
    todayTributed: 0,
    totalTributed: 300 + index * 120,
    tributeCount: 4 + index,
    wordOfferings: index,
    ...extra,
  });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  return [
    base(0, { todayKey: today, todayTributed: 150, allowScreenshots: true }),
    base(1, { awaitingReceipt: 1, todayKey: today, allowScreenshots: true }),
    base(2, { hold: { since: now - 3_600_000, note: "" }, todayKey: today }),
    base(3, { todayKey: today, mooLines: ["見本の鳴き声です", "もう一つの鳴き声"], allowScreenshots: true }),
    base(4, { workOrder: { orderSeq: 1, target: 3, note: "", issuedAt: now - 3_600_000, reportedCount: 1, reportedAt: now - 600_000, doneAt: 0 } }),
    base(5, { todayKey: today, mooLines: ["見本の鳴き声です"], pattedAt: now - 3_600_000 }),
    ...Array.from({ length: Math.max(0, total - 6) }, (_, index) => base(index + 6, { todayKey: today })),
  ];
}

function previewCall(action, payload) {
  const now = previewNow();
  const monthKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date(now));
  switch (action) {
    case "state":
      return Promise.resolve({
        ok: true,
        ageConfirmed: previewScreen !== "age",
        profile: previewSavedProfile || {
          walletName: "ポチ財布",
          card: { ...PREVIEW_MANAGER_CARD, personaName: "レイ", disclosure: "as_is", styles: ["manage"], sigil: 2, avatar: 5, frame: "kurokawa", frameColor: "navy", sealShape: "heart", sealInk: "sakura", seals: ["yoku", "word:よく貢いだ", "kakunin"], achievements: ["tribute_manager_10"], mine: true },
          ownWords: { lines: [{ text: "跪いて差し出しな。", tone: "harsh" }, { text: "今日もちゃんと来たね。", tone: "sweet" }], rewards: [{ text: "上出来", tone: "normal" }, { text: "イっていいよ", tone: "harsh" }] },
          accepting: true,
          publicManagerId: "f".repeat(24),
          hidden: false,
          vault: { ...previewVault },
          // わたしの牧場: ranch は Lv30（絵がそろった牧場）、ほかは Lv5。
          ranch: { xp: previewScreen === "ranch" ? 31_000 : 230, level: ranchLevelFor(previewScreen === "ranch" ? 31_000 : 230), name: previewScreen === "ranch" ? "ひだまり" : "" },
          counts: { payerOpen: 1, managerActive: 1, managerPending: 1 },
          receiptCount: 3,
          // hub-refund: 返金待ち（運営からの返金と管理口座の返金）の見え方を確かめる。
          ...(previewScreen === "hub-refund" ? { operatorRefundPending: 90, refundPending: 20 } : {}),
          wordsToday: 1,
          boardUntil: previewBoardUntil(),
          cheersUnseen: previewCheers.filter((cheer) => !cheer.seen && !cheer.hidden).length,
          // first-steps: 管理人カードも契約もない、はじめての財布（はじめての方へを確かめる）。
          ...(previewScreen.startsWith("first-steps") ? { card: null, accepting: false, counts: { payerOpen: 0, managerActive: 0, managerPending: 0 }, receiptCount: 0, boardUntil: 0 } : {}),
        },
        // 見本の実績: 今の2つの記録と、型の実績（いろいろな段階）・シークレットを少し。
        achievements: (() => {
          const stats = { managerPairDays: 12, walletPairDays: 4, mgrRequestPaid: 34, mgrBreak: 4, mgrIgnore: 1, mgrGrant: 12, mgrDeny: 0, mgrRecite: 3, mgrCollar: 6, mgrRanchLevel: 30, mgrPatDays: 11, walSilentDays: 2, walWords: 120, walServedTop: 45, walPatted: 1, secretNamed: 1, secretMoo: 1 };
          const byStats = RANCH_ACHIEVEMENT_FAMILIES.flatMap((entry) => entry.thresholds.filter((target) => Number(stats[entry.stat]) >= target).map((target) => `${entry.family}_${target}`));
          return {
            stats,
            unlocked: ["tribute_manager_1", "tribute_manager_3", "tribute_manager_10", "tribute_wallet_1", "tribute_wallet_3", ...byStats, "tribute_secret_named", "tribute_secret_moo"],
            newlyUnlocked: [],
          };
        })(),
        // newcomer: まだ財布として契約したことがない人（財布の始め方と見学を確かめる）。
        // first-steps-expired: 前の申し込みが48時間で失効した、はじめての財布。
        contracts: previewScreen === "first-steps" ? []
          : previewScreen === "first-steps-expired" ? [viewContract({ ...previewRaw("payer"), status: "ended", endReason: "application_expired", acceptedAt: 0 }, "preview-me", now)]
            : [
              ...(previewScreen === "newcomer" ? [] : [viewContract(previewRaw("payer"), "preview-me", now)]),
              viewContract(previewRaw("manager"), "preview-me", now),
              viewContract(previewRaw("manager", "pending"), "preview-me", now),
              ...(["hub", "ranch", "ranch-crowd"].includes(previewScreen) ? previewHerd(now, previewScreen === "ranch-crowd" ? 20 : 6).map((raw) => viewContract(raw, "preview-me", now)) : []),
            ].map((contract) => (contract.role === "manager" ? { ...contract, nickname: previewNicknames.get(contract.contractId) || "" } : contract)),
      });
    case "board":
      return Promise.resolve({
        ok: true,
        managers: [
          { ...PREVIEW_MANAGER_CARD, grossRank: 1 },
          { ...PREVIEW_MANAGER_CARD, grossRank: 5, publicManagerId: "b".repeat(24), personaName: "サキ", disclosure: "undisclosed", styles: ["aloof"], entryFee: 0, sigil: 1, avatar: 0, word: null, vault: { level: 2 }, intro: "事務的に管理します。報告は毎日。", frame: "kinbuchi", frameColor: "silver", achievements: ["tribute_manager_3"], showsActivity: false, lastActiveAt: 0 },
          { ...PREVIEW_MANAGER_CARD, grossRank: 2, publicManagerId: "c".repeat(24), personaName: "ユナ", disclosure: "as_is", styles: ["pamper"], entryFee: 5, sigil: 3, avatar: 38, word: { text: "甘やかし受付中。無理はさせないよ。", at: now - 30 * 60_000 }, vault: { level: 5 }, intro: "甘やかし担当。無理はさせない。", frame: "kinjo", frameColor: "pink", achievements: [], lastActiveAt: now - 5 * 3_600_000 },
          { ...PREVIEW_MANAGER_CARD, grossRank: 3, publicManagerId: "d".repeat(24), personaName: "カイ", disclosure: "as_is", styles: ["insight"], entryFee: 50, sigil: 2, avatar: 11, word: null, vault: { level: 4 }, intro: "逃げられると思うな。解約ボタンはお前の手にあるけどな。", frame: "houmotsu", frameColor: "ruby", achievements: [], showsActivity: false, lastActiveAt: 0 },
          { ...PREVIEW_MANAGER_CARD, grossRank: 4, publicManagerId: "e".repeat(24), personaName: "ゆず", disclosure: "nekama", styles: ["manage", "pamper"], entryFee: 5, sigil: 3, avatar: 2, word: null, vault: { level: 3 }, intro: "毎日決まった額を、決まった時間に。", frame: "kura", frameColor: "pink", sealShape: "senryo", sealInk: "kogane", achievements: ["battle_total_1"] },
        ].filter((card) => !payload?.nekamaOnly || card.disclosure === "nekama"),
      });
    case "manager": {
      const mine = payload.publicManagerId === PREVIEW_OWN_MANAGER_ID;
      return Promise.resolve({
        ok: true,
        card: mine ? { ...(state.profile?.card || PREVIEW_MANAGER_CARD), publicManagerId: PREVIEW_OWN_MANAGER_ID, grossRank: 2, mine: true } : { ...PREVIEW_MANAGER_CARD, grossRank: 1 },
        cheers: previewCheerView(mine),
        myCheer: mine ? null : { canWrite: true, text: previewCheers.find((cheer) => cheer.mine)?.text || "", hidden: false, leftToday: 2 },
        month: { payers: 4, tributeCount: 12 },
        openContractId: "",
        myTotal: 210,
        ranking: {
          month: [{ rank: 1, walletName: "しもべ3号", days: 12, collarNo: 3, mine: false }, { rank: 2, walletName: "ポチ財布", days: 4, collarNo: 5, mine: true }],
          lifetime: [{ rank: 1, walletName: "しもべ3号", collarNo: 3, mine: false }, { rank: 2, walletName: "ポチ財布", collarNo: 5, mine: true }],
          // 額の順位は管理人本人にだけ返る（設計書15.1）。
          ...(mine ? {
            amounts: {
              month: [{ rank: 1, walletName: "しもべ3号", amount: 1_200, mine: false }, { rank: 2, walletName: "ポチ財布", amount: 210, mine: false }],
              lifetime: [{ rank: 1, walletName: "しもべ3号", amount: 5_400, mine: false }, { rank: 2, walletName: "ポチ財布", amount: 210, mine: false }],
            },
          } : {}),
        },
      });
    }
    case "set_cheer": {
      const text = String(payload.text || "").trim();
      const index = previewCheers.findIndex((cheer) => cheer.mine);
      if (!text) {
        if (index >= 0) previewCheers.splice(index, 1);
      } else if (index >= 0) {
        previewCheers[index] = { ...previewCheers[index], text, at: Date.now(), seen: false };
      } else {
        previewCheers.splice(1, 0, { cheerId: "d4d4d4d4d4d4d4d4", walletName: "ポチ財布", text, at: Date.now(), seen: false, hidden: false, mine: true });
      }
      return Promise.resolve({ ok: true, cheer: { text, hidden: false, leftToday: 1 } });
    }
    case "cheer_seen":
    case "cheer_hide":
    case "cheer_show": {
      const cheer = previewCheers.find((entry) => entry.cheerId === payload.cheerId);
      if (cheer && action === "cheer_seen") cheer.seen = true;
      if (cheer && action !== "cheer_seen") cheer.hidden = action === "cheer_hide";
      return Promise.resolve({ ok: true, cheersUnseen: previewCheers.filter((entry) => !entry.seen && !entry.hidden).length });
    }
    case "receipts":
      return Promise.resolve({
        ok: true,
        receipts: [
          { receiptId: "r3", contractId: "1".repeat(40), receiptNo: 3, kind: "request", amount: 100, purpose: "edging", receivedAt: now - 97 * 60_000, seal: "yoku", collarNo: 3, reward: "gohoubi", personaName: "ミオ様", disclosure: "nekama", sigil: 0, avatar: 7, pairCount: 3, createdAt: now - 98 * 60_000 },
          { receiptId: "r2", receiptNo: 2, kind: "silent", amount: 100, personaName: "ミオ様", disclosure: "nekama", sigil: 0, avatar: 7, pairCount: 2, createdAt: now - 3 * 86_400_000 },
          { receiptId: "r1", receiptNo: 1, kind: "entry", amount: 10, personaName: "ミオ様", disclosure: "nekama", sigil: 0, avatar: 7, pairCount: 1, createdAt: now - 4 * 86_400_000 },
        ],
        more: false,
      });
    case "ledger":
      return Promise.resolve({
        ok: true,
        asPayer: [{ counterpartName: "ミオ様", total: 210, count: 3, firstAt: now - 4 * 86_400_000, lastAt: now - 98 * 60_000, openContractId: "1".repeat(40) }],
        asManager: [{ counterpartName: "しもべ3号", total: 1_200, count: 9, firstAt: now - 9 * 86_400_000, lastAt: now - 3_600_000, openContractId: "2".repeat(40) }],
      });
    case "rankings":
      if (payload.kind === "gross") {
        return Promise.resolve({
          ok: true,
          kind: "gross",
          monthKey,
          managers: [
            { rank: 1, publicManagerId: PREVIEW_MANAGER_CARD.publicManagerId, personaName: "ミオ様", disclosure: "nekama", sigil: 0, avatar: 7, vault: { level: 4 }, payers: 6, receivedGross: 12_400, xHandle: "mio_sama_ranch", rankingWord: "今月も財布を受付中。覚悟して貢ぎな。" },
            { rank: 2, publicManagerId: PREVIEW_OWN_MANAGER_ID, personaName: "レイ", disclosure: "as_is", sigil: 2, avatar: 5, vault: null, payers: 4, receivedGross: 8_200, xHandle: "", rankingWord: "", mine: true },
            { rank: 3, publicManagerId: "d".repeat(24), personaName: "カイ", disclosure: "as_is", sigil: 2, avatar: 11, vault: { level: 4 }, payers: 5, receivedGross: 6_050, xHandle: "kai_kanri", rankingWord: "" },
            { rank: 4, publicManagerId: "e".repeat(24), personaName: "ゆず", disclosure: "nekama", sigil: 3, avatar: 2, vault: { level: 3 }, payers: 3, receivedGross: 3_300, xHandle: "", rankingWord: "毎日決まった額を、決まった時間に。" },
            { rank: 5, publicManagerId: "b".repeat(24), personaName: "サキ", disclosure: "undisclosed", sigil: 1, avatar: 0, vault: { level: 2 }, payers: 3, receivedGross: 1_900, xHandle: "", rankingWord: "" },
            { rank: 6, publicManagerId: "c".repeat(24), personaName: "ユナ", disclosure: "as_is", sigil: 3, avatar: 38, vault: { level: 5 }, payers: 3, receivedGross: 1_200, xHandle: "yuna_amayakashi", rankingWord: "甘やかし担当。無理はさせない。" },
          ],
        });
      }
      return Promise.resolve({
        ok: true,
        kind: "score",
        monthKey,
        managers: [
          { rank: 1, publicManagerId: PREVIEW_MANAGER_CARD.publicManagerId, personaName: "ミオ様", disclosure: "nekama", sigil: 0, avatar: 7, vault: { level: 4 }, payers: 4, rankScore: 1_850 },
          { rank: 2, publicManagerId: "f".repeat(24), personaName: "レイ", disclosure: "as_is", sigil: 2, avatar: 5, vault: previewVault.tier ? { level: previewVault.tier } : null, payers: 1, rankScore: 1_200, mine: true },
          { rank: 3, publicManagerId: "b".repeat(24), personaName: "サキ", disclosure: "undisclosed", sigil: 1, avatar: 0, vault: { level: 2 }, payers: 2, rankScore: 600 },
        ],
      });
    case "vault":
      return Promise.resolve({
        ok: true,
        vault: previewVaultView(),
        ranking: [
          { rank: 1, publicManagerId: "c".repeat(24), personaName: "ユナ", disclosure: "as_is", sigil: 3, avatar: 38, vault: { level: 5 } },
          { rank: 2, publicManagerId: PREVIEW_MANAGER_CARD.publicManagerId, personaName: "ミオ様", disclosure: "nekama", sigil: 0, avatar: 7, vault: { level: 4 } },
          { rank: 3, publicManagerId: "d".repeat(24), personaName: "カイ", disclosure: "as_is", sigil: 2, avatar: 11, vault: { level: 4 } },
          ...(previewVault.tier ? [{ rank: 4, publicManagerId: "f".repeat(24), personaName: "レイ", disclosure: "as_is", sigil: 2, avatar: 5, vault: { level: previewVault.tier }, mine: true }] : []),
          { rank: previewVault.tier ? 5 : 4, publicManagerId: "b".repeat(24), personaName: "サキ", disclosure: "undisclosed", sigil: 1, avatar: 0, vault: { level: 2 } },
        ],
      });
    case "vault_deposit":
    case "vault_withdraw": {
      // 見本では Pay を動かさず、画面の上でだけ金庫の額を変える。
      if (!previewVault.qualified) return Promise.reject(Object.assign(new Error("金庫を作れるのは、累計3人以上の財布から、合わせて1,000 Pay以上を受け取った管理人だけです。"), { code: "failed-precondition" }));
      const amount = Number(payload.amount) || 0;
      const deposit = action === "vault_deposit";
      const balance = state.walletBalance ?? 0;
      if (deposit && amount > balance) return Promise.reject(Object.assign(new Error("AnjuPay残高が足りません。"), { code: "failed-precondition" }));
      if (!deposit && amount > previewVault.amount) return Promise.reject(Object.assign(new Error("金庫の残りが足りません。"), { code: "failed-precondition" }));
      const before = previewVault.bestTier;
      previewVault.amount += deposit ? amount : -amount;
      previewVault.tier = vaultTierFor(previewVault.amount);
      previewVault.bestTier = Math.max(previewVault.bestTier, previewVault.tier);
      return Promise.resolve({ ok: true, vault: { ...previewVault }, walletBalance: balance + (deposit ? -amount : amount), ...(previewVault.bestTier > before ? { reachedTier: previewVault.bestTier } : {}) });
    }
    case "tribute": {
      const request = payload.requestId ? state.thread.raw?.pendingRequests?.[payload.requestId] : null;
      const granted = payload.kind === "granted";
      const othello = payload.kind === "othello" ? Number(state.thread.raw?.othelloResult?.gameSeq) || 1 : Number(request?.othello) || 0;
      const contest = payload.kind === "contest" ? Number(state.thread.raw?.workResult?.orderSeq) || 1 : Number(request?.contest) || 0;
      const penaltyKind = payload.kind === "othello" || payload.kind === "contest";
      const purpose = request ? request.purpose || "" : granted ? state.thread.raw?.plea?.purpose || "" : penaltyKind ? "penalty" : payload.purpose || "";
      const marks = { ...(granted ? { granted: true } : {}), ...(othello ? { othello } : {}), ...(contest ? { contest } : {}), ...(Number(request?.resists) ? { resisted: Number(request.resists) } : {}) };
      const othelloPenalty = payload.kind === "othello";
      const contestPenalty = payload.kind === "contest";
      payload = { ...payload, kind: granted || penaltyKind ? "silent" : payload.kind };
      previewThreadChange((raw, push) => {
        if (granted) raw.plea = null;
        if (othelloPenalty) raw.othelloResult = null;
        if (contestPenalty) raw.workResult = null;
        if (marks.resisted) raw.resistedTributes = Number(raw.resistedTributes || 0) + 1;
        if (payload.requestId && raw.pendingRequests) {
          const { [payload.requestId]: _paid, ...rest } = raw.pendingRequests;
          raw.pendingRequests = rest;
        }
        raw.totalTributed = Number(raw.totalTributed || 0) + Number(payload.amount);
        raw.todayTributed = Number(raw.todayTributed || 0) + Number(payload.amount);
        raw.awaitingReceipt = Number(raw.awaitingReceipt || 0) + 1;
        if (purpose) raw.purposeCounts = { ...raw.purposeCounts, [purpose]: Number(raw.purposeCounts?.[purpose] || 0) + 1 };
        push({ type: "tribute", actor: "payer", kind: payload.kind, amount: Number(payload.amount), receiptId: "9".repeat(40), ...(payload.requestId ? { requestId: payload.requestId } : {}), ...(purpose ? { purpose } : {}), ...marks });
      });
      const threadCard = state.thread.raw?.managerCard || PREVIEW_MANAGER_CARD;
      return Promise.resolve({
        ok: true,
        ...(payload.contractId === DEMO_CONTRACT_ID ? {} : { walletBalance: (state.walletBalance ?? 1_000) - Number(payload.amount || 0) }),
        receipt: { receiptId: "preview", receiptNo: 4, kind: payload.kind, amount: Number(payload.amount), ...(purpose ? { purpose } : {}), ...marks, personaName: threadCard.personaName, disclosure: threadCard.disclosure, sigil: threadCard.sigil, avatar: threadCard.avatar, collarNo: Number(state.thread.raw?.collarNo) || 0, pairCount: 4, createdAt: now },
      });
    }
    case "receive": {
      const view = previewThreadChange((raw, push, at) => {
        const target = state.thread.events.find((event) => event.seq === Number(payload.tributeSeq));
        if (!target || target.receivedAt) return;
        target.receivedAt = at;
        target.seal = payload.seal || "juryo";
        Object.assign(target, (({ sealShape, sealInk }) => ({ sealShape, sealInk }))(normalizeDecorations(state.profile?.card)));
        const rewardMarks = payload.reward ? { reward: payload.reward, ...(payload.rewardText ? { rewardText: payload.rewardText } : {}) } : {};
        Object.assign(target, rewardMarks);
        raw.awaitingReceipt = Math.max(0, Number(raw.awaitingReceipt || 0) - 1);
        if (payload.reward) raw.rewardCount = Number(raw.rewardCount || 0) + 1;
        push({ type: "received", actor: "manager", tributeSeq: target.seq, amount: target.amount || 0, ...(target.type === "word_offering" ? { words: true } : {}), seal: target.seal, ...rewardMarks });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_word": {
      const profile = { ...state.profile, card: { ...state.profile?.card } };
      if (payload.clear === true) {
        profile.card.word = null;
      } else {
        if (Number(profile.wordsToday || 0) >= TODAY_WORD.perDay) {
          return Promise.reject(Object.assign(new Error(`今日のひとことは1日${TODAY_WORD.perDay}回までです。日本時間の0時に戻ります。`), { code: "resource-exhausted" }));
        }
        profile.card.word = { text: String(payload.text || "").trim(), at: now };
        profile.wordsToday = Number(profile.wordsToday || 0) + 1;
        profile.boardUntil = profile.accepting ? now + LIMITS.boardActiveWindowMs : 0;
      }
      previewSavedProfile = profile;
      return Promise.resolve({ ok: true, profile });
    }
    case "share_info": {
      const listed = state.receipts.items.find((receipt) => receipt.receiptId === payload.receiptId);
      const event = state.thread.events.find((entry) => entry.type === "tribute" && entry.receiptId && entry.receiptId === payload.receiptId);
      const receipt = listed || (event ? { receiptId: event.receiptId, receiptNo: 40 + Number(event.seq), kind: event.kind, amount: event.amount, purpose: event.purpose || "", pairCount: 40 + Number(event.seq), createdAt: event.createdAt, receivedAt: event.receivedAt || 0, seal: event.seal || "", reward: event.reward || "" } : null);
      const card = state.thread.raw?.managerCard || PREVIEW_MANAGER_CARD;
      return Promise.resolve({
        ok: true,
        contractId: payload.contractId,
        consent: true,
        manager: { personaName: card.personaName, disclosure: card.disclosure, styles: card.styles, sigil: card.sigil, avatar: card.avatar },
        collarNo: Number(state.thread.raw?.collarNo) || 3,
        walletName: state.thread.raw?.payerWalletName || "ポチ財布",
        receipt,
      });
    }
    case "decline_request": {
      previewThreadChange((raw, push) => {
        const { [payload.requestId]: _declined, ...rest } = raw.pendingRequests || {};
        raw.pendingRequests = rest;
        push({ type: "request_declined", actor: "payer", requestId: payload.requestId });
      });
      return Promise.resolve({ ok: true });
    }
    case "set_nickname": {
      const nickname = String(payload.nickname || "").trim().slice(0, LIMITS.nickname);
      previewNicknames.set(payload.contractId, nickname);
      const row = state.contracts.find((contract) => contract.contractId === payload.contractId);
      if (row) row.nickname = nickname;
      return Promise.resolve({ ok: true, nickname });
    }
    // 出稼ぎ命令。見本では完走を数えず、報告のたびに1回ずつ進める。
    case "work_progress": {
      const view = state.thread.view;
      const order = view?.workOrder && !view.workOrder.done ? view.workOrder : null;
      const counted = state.thread.demo ? 0 : Math.min(order?.target || 0, (order?.reportedCount || 0) + 1);
      return Promise.resolve({ ok: true, contractId: payload.contractId, workOrder: order, count: order ? counted : 0 });
    }
    case "work_order": {
      const contest = payload.kind === "contest" ? { kind: "contest", days: Number(payload.days), penalty: Number(payload.penalty), acceptedAt: 0, deadline: 0 } : {};
      const view = previewThreadChange((raw, push, at) => {
        const orderSeq = Number(raw.workOrderSeq || 0) + 1;
        raw.workOrderSeq = orderSeq;
        raw.workOrder = { orderSeq, ...contest, target: Number(payload.target), note: String(payload.note || ""), issuedAt: at, reportedCount: 0, reportedAt: 0, doneAt: 0 };
        push({ type: "work_order", actor: "manager", orderSeq, ...(contest.kind ? { kind: "contest", days: contest.days, penalty: contest.penalty } : {}), target: Number(payload.target), ...(payload.note ? { note: payload.note } : {}) });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    // 出稼ぎの勝負。見本では、受けると期限を決め、報告のたびに1勝ずつ進める。
    case "work_accept": {
      const view = previewThreadChange((raw, push, at) => {
        const order = raw.workOrder;
        if (order?.kind !== "contest" || order.acceptedAt) return;
        raw.workOrder = { ...order, acceptedAt: at, deadline: at + order.days * 86_400_000 };
        push({ type: "work_accept", actor: "payer", orderSeq: order.orderSeq, target: order.target, days: order.days, penalty: order.penalty, deadline: raw.workOrder.deadline });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "work_decline": {
      const view = previewThreadChange((raw, push) => {
        const order = raw.workOrder;
        if (order?.kind !== "contest" || order.acceptedAt) return;
        raw.workOrder = null;
        push({ type: "work_declined", actor: "payer", orderSeq: order.orderSeq });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "work_judge": {
      const view = previewThreadChange((raw, push, at) => {
        const order = raw.workOrder;
        if (order?.kind !== "contest" || !order.acceptedAt || order.doneAt) return;
        previewSettleContest(raw, push, at, order);
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "work_claim": {
      const view = previewThreadChange((raw, push, at) => {
        const result = raw.workResult;
        if (!result) return;
        const requestId = "c".repeat(15) + String(result.orderSeq % 10);
        raw.pendingRequests = { ...(raw.pendingRequests || {}), [requestId]: { amount: result.penalty, note: "勝負の罰金", purpose: "penalty", contest: result.orderSeq, createdAt: at } };
        raw.workResult = null;
        push({ type: "request", actor: "manager", requestId, amount: result.penalty, note: "勝負の罰金", purpose: "penalty", contest: result.orderSeq });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "work_report": {
      let count = 0;
      let done = false;
      let lost = false;
      const view = previewThreadChange((raw, push, at) => {
        const order = raw.workOrder;
        if (!order || order.doneAt) return;
        const contest = order.kind === "contest";
        if (contest && order.deadline && at >= order.deadline) {
          lost = true;
          previewSettleContest(raw, push, at, order);
          return;
        }
        const known = state.thread.work?.orderSeq === order.orderSeq ? state.thread.work.count : order.reportedCount;
        count = Math.min(order.target, Number(known) || 0);
        done = count >= order.target;
        raw.workOrder = { ...order, reportedCount: count, reportedAt: at, ...(done ? { doneAt: at } : {}) };
        if (done && contest) raw.contestWins = Number(raw.contestWins || 0) + 1;
        else if (done) raw.workOrdersDone = Number(raw.workOrdersDone || 0) + 1;
        push({ type: "work_report", actor: "payer", orderSeq: order.orderSeq, ...(contest ? { kind: "contest" } : {}), target: order.target, count, done });
      });
      return Promise.resolve({ ok: true, count, done, ...(lost ? { lost } : {}), contract: view });
    }
    case "work_withdraw": {
      const view = previewThreadChange((raw, push) => {
        if (!raw.workOrder || raw.workOrder.doneAt) return;
        push({ type: "work_withdrawn", actor: "manager", orderSeq: raw.workOrder.orderSeq, reason: "withdrawn" });
        raw.workOrder = null;
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "work_confirm": {
      const view = previewThreadChange((raw, push) => {
        const order = raw.workOrder;
        if (!order?.doneAt) return;
        const look = normalizeDecorations(state.profile?.card);
        push({ type: "work_confirm", actor: "manager", orderSeq: order.orderSeq, ...(order.kind === "contest" ? { kind: "contest" } : {}), target: order.target, count: order.reportedCount, seal: payload.seal || "juryo", sealShape: look.sealShape, sealInk: look.sealInk, ...(payload.reward ? { reward: payload.reward, ...(payload.rewardText ? { rewardText: payload.rewardText } : {}) } : {}) });
        raw.workOrder = null;
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_own_words": {
      const profile = { ...state.profile, ownWords: payload.ownWords };
      previewSavedProfile = profile;
      return Promise.resolve({ ok: true, profile });
    }
    case "offer_words": {
      const view = previewThreadChange((raw, push, at) => {
        raw.wordOfferings = Number(raw.wordOfferings || 0) + 1;
        raw.awaitingReceipt = Number(raw.awaitingReceipt || 0) + 1;
        raw.wordOfferDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
        raw.wordOfferDayCount = Number(raw.wordOfferDayCount || 0) + 1;
        push({ type: "word_offering", actor: "payer", text: payload.text });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "recite_order": {
      const view = previewThreadChange((raw, push, at) => {
        raw.reciteSeq = Number(raw.reciteSeq || 0) + 1;
        raw.reciteOrder = { orderSeq: raw.reciteSeq, text: payload.text, target: Number(payload.target), count: 0, issuedAt: at, doneAt: 0 };
        push({ type: "recite_order", actor: "manager", orderSeq: raw.reciteSeq, text: payload.text, target: Number(payload.target) });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "recite": {
      let count = 0;
      let done = false;
      const view = previewThreadChange((raw, push, at) => {
        const order = raw.reciteOrder;
        if (!order) return;
        count = Number(order.count || 0) + 1;
        done = count >= order.target;
        raw.reciteOrder = { ...order, count, ...(done ? { doneAt: at } : {}) };
        if (done) raw.recitesDone = Number(raw.recitesDone || 0) + 1;
        push({ type: "recite", actor: "payer", orderSeq: order.orderSeq, count, target: order.target, text: order.text, done });
      });
      return Promise.resolve({ ok: true, count, done, contract: view });
    }
    case "recite_withdraw":
    case "recite_confirm": {
      const view = previewThreadChange((raw, push) => {
        const order = raw.reciteOrder;
        if (!order) return;
        const look = normalizeDecorations(state.profile?.card);
        push(action === "recite_withdraw"
          ? { type: "recite_withdrawn", actor: "manager", orderSeq: order.orderSeq }
          : { type: "recite_confirm", actor: "manager", orderSeq: order.orderSeq, target: order.target, seal: payload.seal || "juryo", sealShape: look.sealShape, sealInk: look.sealInk, ...(payload.reward ? { reward: payload.reward, ...(payload.rewardText ? { rewardText: payload.rewardText } : {}) } : {}) });
        raw.reciteOrder = null;
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "extend_request":
    case "extend_withdraw":
    case "extend_accept":
    case "extend_decline": {
      const view = previewThreadChange((raw, push, at) => {
        if (action === "extend_request") {
          raw.extension = { days: Number(payload.days), createdAt: at };
          push({ type: "extend_request", actor: "payer", days: Number(payload.days) });
          return;
        }
        const days = Number(raw.extension?.days || 0);
        if (action === "extend_accept") raw.expiresAt = Number(raw.expiresAt || at) + days * 86_400_000;
        raw.extension = null;
        push(action === "extend_accept"
          ? { type: "extend_accepted", actor: "manager", days, expiresAt: raw.expiresAt }
          : { type: action === "extend_withdraw" ? "extend_withdrawn" : "extend_declined", actor: action === "extend_withdraw" ? "payer" : "manager", days });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_othello": {
      const view = previewThreadChange((raw, push) => {
        raw.allowOthello = payload.allowOthello === true;
        push({ type: "othello_setting", actor: "payer", allowOthello: raw.allowOthello });
        if (!raw.allowOthello && raw.othello) {
          push({ type: "othello_stopped", actor: "payer", gameSeq: raw.othello.gameSeq });
          raw.othello = null;
        }
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "othello_start": {
      const view = previewThreadChange((raw, push, at) => {
        raw.othelloSeq = Number(raw.othelloSeq || 0) + 1;
        raw.othello = { gameSeq: raw.othelloSeq, board: othelloInitialBoard(payload.handicap), turn: payload.managerFirst ? "manager" : "payer", rate: Number(payload.rate), handicap: payload.handicap || "none", startedAt: at, lastMoveAt: at, lastMove: null };
        push({ type: "othello_start", actor: "manager", gameSeq: raw.othelloSeq, rate: Number(payload.rate), handicap: payload.handicap || "none", managerFirst: payload.managerFirst === true });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "othello_move": {
      // 見本では、相手の手もその場で打つ（相手がいないため）。
      const role = state.thread.view?.role || "payer";
      const view = previewThreadChange((raw, push, at) => {
        let game = raw.othello;
        if (!game) return;
        const playOne = (who, index, note) => {
          const played = othelloPlay(game.board, othelloSide(who), index);
          if (played.error) return false;
          push({ type: "othello_move", actor: who, gameSeq: game.gameSeq, index, flipped: played.flipped, corner: played.corner, ...othelloCount(played.board), ...(note ? { note } : {}) });
          const next = othelloNextTurn(played.board, who);
          if (!next.turn) {
            previewFinishOthello(raw, push, game, played.board, false);
            game = null;
            return true;
          }
          if (next.passed) push({ type: "othello_pass", actor: "system", gameSeq: game.gameSeq, passed: next.passed });
          game = { ...game, board: played.board, turn: next.turn, lastMoveAt: at, lastMove: { index, flipped: played.flipped, role: who } };
          raw.othello = game;
          return true;
        };
        if (!playOne(role, Number(payload.index), payload.note)) return;
        while (game && game.turn !== role) {
          const moves = othelloMoves(game.board, othelloSide(game.turn));
          if (!moves.length || !playOne(game.turn, moves[0], "")) break;
        }
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "othello_resign": {
      const view = previewThreadChange((raw, push) => {
        if (raw.othello) previewFinishOthello(raw, push, raw.othello, raw.othello.board, true);
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "othello_end": {
      const view = previewThreadChange((raw, push) => {
        if (!raw.othello) return;
        push({ type: "othello_end", actor: "manager", gameSeq: raw.othello.gameSeq });
        raw.othello = null;
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "othello_claim": {
      const view = previewThreadChange((raw, push, at) => {
        const result = raw.othelloResult;
        if (!result) return;
        const requestId = "0".repeat(15) + String(result.gameSeq % 10);
        raw.pendingRequests = { ...(raw.pendingRequests || {}), [requestId]: { amount: result.penalty, note: "貢ぎオセロの罰金", purpose: "penalty", othello: result.gameSeq, createdAt: at } };
        raw.othelloResult = null;
        push({ type: "request", actor: "manager", requestId, amount: result.penalty, note: "貢ぎオセロの罰金", purpose: "penalty", othello: result.gameSeq });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_grazing": {
      const view = previewThreadChange((raw, push) => {
        raw.allowGrazing = payload.allowGrazing === true;
        push({ type: "grazing_changed", actor: "payer", allowGrazing: raw.allowGrazing });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_moo": {
      const view = previewThreadChange((raw) => {
        raw.mooLines = (Array.isArray(payload.lines) ? payload.lines : []).map((line) => String(line).trim()).filter(Boolean).slice(0, RANCH_MOO.lines);
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "ranch_pat": {
      const row = state.contracts.find((contract) => contract.contractId === payload.contractId);
      return Promise.resolve({ ok: true, contract: { ...(row || {}), pattedAt: now } });
    }
    case "ranch_peek":
      return Promise.resolve({ ok: true, contractId: payload.contractId, ranchLevel: payload.contractId === DEMO_CONTRACT_ID ? 3 : 18, ranchName: payload.contractId === DEMO_CONTRACT_ID ? "" : "ひだまり" });
    case "set_ranch_name": {
      const name = Array.from(String(payload.name || "").trim().replace(/牧場$/u, "").trim()).slice(0, RANCH_NAME.length).join("");
      return Promise.resolve({ ok: true, profile: { ...state.profile, ranch: { ...state.profile?.ranch, name }, card: state.profile?.card ? { ...state.profile.card, ranchName: name } : null } });
    }
    case "set_ranch_animal": {
      const row = state.contracts.find((contract) => contract.contractId === payload.contractId);
      return Promise.resolve({ ok: true, contract: { ...(row || {}), ranchAnimal: payload.animal } });
    }
    case "set_holds": {
      const view = previewThreadChange((raw, push) => {
        raw.allowHolds = payload.allowHolds === true;
        push({ type: "holds_changed", actor: "payer", allowHolds: raw.allowHolds });
        if (!raw.allowHolds && raw.hold) {
          raw.hold = null;
          raw.plea = null;
          push({ type: "unhold", actor: "system", reason: "setting" });
        }
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "hold": {
      const view = previewThreadChange((raw, push, at) => {
        raw.hold = { since: at, note: payload.note || "" };
        push({ type: "hold", actor: "manager", ...(payload.note ? { note: payload.note } : {}) });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "unhold": {
      const view = previewThreadChange((raw, push) => {
        raw.hold = null;
        raw.plea = null;
        push({ type: "unhold", actor: "manager", reason: "manager" });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "plea": {
      const view = previewThreadChange((raw, push, at) => {
        raw.pleaSeq = Number(raw.pleaSeq || 0) + 1;
        raw.pleaCount = Number(raw.pleaCount || 0) + 1;
        raw.plea = { pleaSeq: raw.pleaSeq, amount: Number(payload.amount), purpose: payload.purpose || "", note: payload.note || "", createdAt: at, grantedAt: 0 };
        push({ type: "plea", actor: "payer", pleaSeq: raw.pleaSeq, amount: Number(payload.amount), ...(payload.purpose ? { purpose: payload.purpose } : {}), ...(payload.note ? { note: payload.note } : {}) });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "plea_withdraw": {
      const view = previewThreadChange((raw, push) => {
        const pleaSeq = raw.plea?.pleaSeq || 0;
        raw.plea = null;
        push({ type: "plea_withdrawn", actor: "payer", pleaSeq, reason: "withdrawn" });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "plea_grant":
    case "plea_deny": {
      const grant = action === "plea_grant";
      const view = previewThreadChange((raw, push, at) => {
        if (!raw.plea) return;
        const { pleaSeq, amount } = raw.plea;
        if (grant) {
          raw.plea = { ...raw.plea, grantedAt: at };
          raw.pleaGrantedCount = Number(raw.pleaGrantedCount || 0) + 1;
        } else {
          raw.plea = null;
        }
        push({ type: grant ? "plea_granted" : "plea_denied", actor: "manager", pleaSeq, amount, ...(payload.note ? { note: payload.note } : {}) });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "resist": {
      const view = previewThreadChange((raw, push) => {
        const request = raw.pendingRequests?.[payload.requestId];
        if (!request) return;
        const count = Number(request.resists || 0) + 1;
        raw.pendingRequests = { ...raw.pendingRequests, [payload.requestId]: { ...request, resists: count } };
        push({ type: "resist", actor: "payer", requestId: payload.requestId, count, text: payload.text || "" });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_want_words": {
      const view = previewThreadChange((raw, push) => {
        raw.wantWords = Array.isArray(payload.wantWords) ? payload.wantWords : [];
        push({ type: "want_words_changed", actor: "payer", count: raw.wantWords.length });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_work_orders": {
      const view = previewThreadChange((raw, push) => {
        raw.allowWorkOrders = payload.allowWorkOrders === true;
        push({ type: "work_orders_changed", actor: "payer", allowWorkOrders: raw.allowWorkOrders });
        if (raw.allowWorkOrders || !raw.workOrder || raw.workOrder.doneAt) return;
        push({ type: "work_withdrawn", actor: "system", orderSeq: raw.workOrder.orderSeq, reason: "setting" });
        raw.workOrder = null;
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_screenshots": {
      const view = previewThreadChange((raw, push) => {
        raw.allowScreenshots = payload.allowScreenshots === true;
        push({ type: "screenshots_changed", actor: "payer", allowScreenshots: raw.allowScreenshots });
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "set_purposes": {
      const view = previewThreadChange((raw, push) => {
        raw.allowSexualPurposes = payload.allowSexualPurposes === true;
        push({ type: "purposes_changed", actor: "payer", allowSexualPurposes: raw.allowSexualPurposes });
        if (raw.allowSexualPurposes) return;
        const sexual = new Set(PURPOSES.filter((purpose) => purpose.sexual).map((purpose) => purpose.id));
        for (const [requestId, request] of Object.entries(raw.pendingRequests || {})) {
          if (!sexual.has(request.purpose)) continue;
          const { [requestId]: _voided, ...rest } = raw.pendingRequests;
          raw.pendingRequests = rest;
          push({ type: "request_cancelled", actor: "system", requestId, reason: "purpose" });
        }
        if (raw.plea && sexual.has(raw.plea.purpose)) {
          push({ type: "plea_withdrawn", actor: "system", pleaSeq: raw.plea.pleaSeq, reason: "purpose" });
          raw.plea = null;
        }
        if (raw.reciteOrder && BOARD_SEXUAL_PATTERN.test(String(raw.reciteOrder.text || "").normalize("NFKC"))) {
          push({ type: "recite_withdrawn", actor: "system", orderSeq: raw.reciteOrder.orderSeq, reason: "purpose" });
          raw.reciteOrder = null;
        }
      });
      return Promise.resolve({ ok: true, contract: view });
    }
    case "request": {
      const requestId = Array.from({ length: 16 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
      previewThreadChange((raw, push, at) => {
        raw.pendingRequests = { ...raw.pendingRequests, [requestId]: { amount: Number(payload.amount), note: payload.note || "", ...(payload.purpose ? { purpose: payload.purpose } : {}), createdAt: at } };
        push({ type: "request", actor: "manager", requestId, amount: Number(payload.amount), ...(payload.note ? { note: payload.note } : {}), ...(payload.purpose ? { purpose: payload.purpose } : {}) });
      });
      return Promise.resolve({ ok: true, requestId });
    }
    case "age_confirm":
      return Promise.resolve({ ok: true });
    case "set_declaration": {
      const profile = { ...state.profile, card: { ...state.profile?.card, ignoreUnpaid: payload.ignoreUnpaid === true } };
      previewSavedProfile = profile;
      return Promise.resolve({ ok: true, profile });
    }
    case "decorations":
      // 見本: 黒革・ハート・桜を持っていて、実績は牧場と対戦のものを解除している。
      return Promise.resolve({
        ok: true,
        owned: [...previewOwnedDecorations],
        achievements: ["tribute_manager_10", "tribute_manager_3", "tribute_manager_1", "tribute_wallet_3", "tribute_wallet_1", "tribute_honor_grand_offerer", "tribute_honor_offerer", "battle_total_1", "battle_total_10", "battle_total_30"],
        vaultBestTier: previewVault.bestTier,
      });
    case "save_profile": {
      // 見本では保存せず、画面の上でだけカードを差し替える（印の見え方を確かめるため）。
      const profile = { ...state.profile };
      if (payload.walletName !== undefined) profile.walletName = String(payload.walletName || "名無しの財布");
      if (payload.card) {
        const { xProfile, ...card } = payload.card;
        profile.card = { ...profile.card, ...card, xHandle: xProfile || "", mine: true };
      }
      if (payload.accepting !== undefined) profile.accepting = payload.accepting === true;
      if (payload.card || profile.accepting) profile.boardUntil = profile.accepting && profile.card ? Date.now() + LIMITS.boardActiveWindowMs : 0;
      previewSavedProfile = profile;
      return Promise.resolve({ ok: true, profile });
    }
    default:
      showToast("見本では送信しません。");
      return Promise.resolve(null).then(() => {
        throw Object.assign(new Error("見本では送信しません。"), { code: "preview" });
      });
  }
}

// 見本: hub-board-ending は掲示板から外れる1日半前、hub-board-off は外れた後。
function previewBoardUntil(now = Date.now()) {
  if (previewScreen === "hub-board-off") return now - 3_600_000;
  if (previewScreen === "hub-board-ending") return now + 36 * 3_600_000;
  return now + 6 * 86_400_000;
}

function startPreview(screen) {
  state.walletBalance = screen === "newcomer" || screen.startsWith("first-steps") ? 0 : screen === "card" ? 18_420 : 1_000;
  const map = {
    hub: () => navigate("hub"),
    "hub-board-ending": () => navigate("hub"),
    "hub-board-off": () => navigate("hub"),
    "hub-refund": () => navigate("hub"),
    "first-steps": () => navigate("hub"),
    "first-steps-expired": () => navigate("hub"),
    newcomer: () => navigate("hub"),
    board: () => navigate("board"),
    manager: () => openManager(PREVIEW_MANAGER_CARD.publicManagerId),
    "manager-mine": () => openManager(PREVIEW_OWN_MANAGER_ID),
    apply: () => {
      state.applyTarget = { ...PREVIEW_MANAGER_CARD };
      state.screen = "apply";
      render();
    },
    card: () => navigate("card"),
    recruit: () => {
      navigate("hub");
      openRecruit();
    },
    "thread-payer": () => openThread("1".repeat(40)),
    "thread-manager": () => openThread("2".repeat(40)),
    "thread-payer-contest": () => openThread("1".repeat(40)),
    // 財布の「牧場をのぞく」（見本はウサギ・なつきはリボン・鳴き声2つ）。
    "ranch-peek": () => {
      openThread("1".repeat(40));
      Object.assign(state.thread.raw, { ranchAnimal: "rabbit", servedTotal: 45, mooLines: ["見本の鳴き声です", "もう一つの鳴き声"], workOrder: null, pattedAt: Date.now() - 3 * 3_600_000, patDays: 12, fondnessAt: { 2: Date.now() - 15 * 86_400_000 } });
      state.thread.view = viewContract(state.thread.raw, state.uid);
      openRanchPeek();
    },
    "thread-manager-contest": () => openThread("2".repeat(40)),
    "thread-pending": () => openThread("3".repeat(40)),
    "thread-ended": () => openThread("4".repeat(40)),
    give: () => {
      openThread("1".repeat(40));
      openSheet("give", { requestId: "abcdef0123456789", amount: 100, step: "hold" });
    },
    receipt: () => {
      openThread("1".repeat(40));
      state.receipt = { receiptNo: 4, kind: "request", amount: 100, personaName: "ミオ様", disclosure: "nekama", sigil: 0, avatar: 7, pairCount: 4, createdAt: Date.now() };
      rerenderReceipt();
    },
    receipts: () => navigate("receipts"),
    ledger: () => navigate("ledger"),
    ranking: () => navigate("ranking"),
    ranch: () => navigate("hub"),
    "achievement-frames": () => navigate("hub"),
    "ranch-photo": () => {
      navigate("hub");
      openRanchPhoto();
    },
    "ranch-crowd": () => navigate("hub"),
    "ranking-gross": () => {
      state.ranking.kind = "gross";
      navigate("ranking");
    },
    vault: () => navigate("vault"),
    "vault-new": () => navigate("vault"),
  };
  (map[screen] || map.hub)();
}

window.HariaiTribute = Object.freeze({
  start,
  isActive,
  requestHome,
  openRequestedLink,
});
window.dispatchEvent(new Event("hariai-tribute-ready"));

function openRequestedLink() {
  const initialInvite = takeInviteFromUrl();
  if (initialInvite) start({ inviteManager: initialInvite });
  else if (wantsRanchOpen(window.location.href)) start({ initialScreen: "hub" });
}
