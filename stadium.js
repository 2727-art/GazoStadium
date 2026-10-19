import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  functions,
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1";
import { formatAnjuPay } from "./anju-pay-format.mjs?v=anju-pay-format-v1";
import {
  DAILY_COLLECT_LIMIT,
  FANS_PER_MATCH,
  HOUR_MS,
  MILLI_PER_PAY,
  buildStadium,
  collectStadium,
  createStadiumRecord,
  settleStadium,
  stadiumView,
} from "./stadium-core.mjs?v=my-stadium-v1";

// マイスタジアム。1on1を完走した数だけ観客が来て、離れている間も金庫に売上が貯まる。
// 金額・観客数はすべてサーバー（stadiumAction）が計算する。画面は返ってきた値を出し、金庫の数字だけを時間で補間する。

const appRoot = document.querySelector("#app");
const stadiumActionCallable = httpsCallable(functions, "stadiumAction");
const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TICK_MS = 5_000;

const previewScenario = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("stadiumPreview") || !PREVIEW_HOSTS.has(window.location.hostname)) return "";
    return params.get("stadiumPreview") || "growing";
  } catch {
    return "";
  }
})();

let active = false;
let lifecycleGeneration = 0;
let tickTimer = null;
let state = createState();

function createState() {
  return {
    screen: "loading",
    view: null,
    fetchedAt: 0,
    fatalError: "",
    busy: "",
    confirm: "",
    arrival: 0,
    notice: null,
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

function friendlyError(error, fallback = "マイスタジアムの処理を完了できませんでした。") {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("unauthenticated")) return "アカウントを確認できませんでした。ページを読み直してください。";
  if (code.includes("app-check") || (code.includes("permission-denied") && /App Check/i.test(String(error?.message)))) {
    return "通信保護を確認できませんでした。ページを再読み込みしてください。";
  }
  const message = String(error?.message || "").replace(/^Firebase:\s*/u, "").slice(0, 200);
  if (message && !/^internal$/iu.test(message)) return message;
  return fallback;
}

function isCurrent(generation) {
  return active && lifecycleGeneration === generation;
}

async function ensureUser() {
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady?.();
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function call(action, payload = {}) {
  if (previewScenario) return previewCall(action, payload);
  const response = await stadiumActionCallable({ action, ...payload });
  return response.data || {};
}

function count(value) {
  return Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("ja-JP");
}

function formatRate(milliPerHour) {
  const pay = Math.max(0, Number(milliPerHour) || 0) / MILLI_PER_PAY;
  return pay < 1 ? pay.toFixed(2) : pay.toFixed(1);
}

function formatDuration(ms) {
  const minutes = Math.max(1, Math.ceil(Number(ms) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}分`;
  return rest ? `${hours}時間${rest}分` : `${hours}時間`;
}

function setChrome(statusLabel = "MY STADIUM") {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(statusLabel)}`;
  if (privacy) privacy.textContent = "AnjuPayだけ・換金なし";
  if (footerItems[0]) footerItems[0].textContent = "MY STADIUM / ANJUPAY ONLY";
  if (footerItems[1]) footerItems[1].textContent = "観客は検証済みの1on1の完走でだけ増えます。現金・換金はありません";
}

function modeIsActiveElsewhere() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiAiTextTraining?.isActive?.()
    || window.HariaiRouletteTraining?.isActive?.()
    || window.HariaiDanwakuNote?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiAccount?.isActive?.()
    || window.HariaiTribute?.isActive?.(),
  );
}

// 金庫の中身を、最後に受け取った時からの経過で補間する（表示だけ。回収額はサーバーが決める）。
function liveVaultMilli(view = state.view) {
  if (!view?.vault) return 0;
  const { milli, capMilli } = view.vault;
  if (milli >= capMilli || !view.rateMilliPerHour) return milli;
  const elapsed = Math.max(0, Date.now() - state.fetchedAt);
  return Math.min(capMilli, milli + Math.floor((view.rateMilliPerHour * elapsed) / HOUR_MS));
}

function vaultStatusText(view, vaultMilli) {
  if (!view.rateMilliPerHour) return "観客が来ると、売上が貯まり始めます。";
  if (vaultMilli >= view.vault.capMilli) return "満杯なので、ここで止まっています。";
  const remaining = ((view.vault.capMilli - vaultMilli) * HOUR_MS) / view.rateMilliPerHour;
  return `満杯まで あと${formatDuration(remaining)}`;
}

// ───────────── スタジアムの絵 ─────────────

const STAND_SHAPES = Object.freeze([
  { rows: 2, from: 232, to: 308 },
  { rows: 3, from: 214, to: 326 },
  { rows: 4, from: 198, to: 342 },
  { rows: 5, from: 190, to: 350 },
  { rows: 6, from: 186, to: 354 },
  { rows: 6, from: 182, to: 358 },
]);

function seatPositions(standLevel) {
  const shape = STAND_SHAPES[Math.min(STAND_SHAPES.length, Math.max(1, standLevel)) - 1];
  const seats = [];
  for (let row = 0; row < shape.rows; row += 1) {
    const rx = 104 + row * 11;
    const ry = 34 + row * 7;
    const span = ((shape.to - shape.from) * Math.PI) / 180;
    const length = span * ((rx + ry) / 2);
    const total = Math.max(4, Math.floor(length / 7));
    for (let index = 0; index <= total; index += 1) {
      const angle = ((shape.from + ((shape.to - shape.from) * index) / total) * Math.PI) / 180;
      seats.push({ x: 160 + rx * Math.cos(angle), y: 122 + ry * Math.sin(angle), row });
    }
  }
  return seats;
}

function stadiumSvg(view, { empty = false } = {}) {
  const standLevel = view?.facilities?.find((facility) => facility.id === "stand")?.level || 1;
  const shopLevel = view?.facilities?.find((facility) => facility.id === "shop")?.level || 1;
  const seats = seatPositions(standLevel);
  const ratio = empty || !view?.capacity ? 0 : Math.min(1, view.seated / view.capacity);
  const filled = Math.round(seats.length * ratio);
  // 入場した観客は、決まった順で散らして埋める（毎回同じ並び。運では変わらない）。
  const order = seats.map((_, index) => index).sort((a, b) => ((a * 7919) % seats.length) - ((b * 7919) % seats.length));
  const filledSet = new Set(order.slice(0, filled));
  const seatDots = seats.map((seat, index) => {
    const className = filledSet.has(index) ? `stadium-fan is-tone-${index % 3}` : "stadium-seat";
    return `<circle class="${className}" cx="${seat.x.toFixed(1)}" cy="${seat.y.toFixed(1)}" r="2.1" />`;
  }).join("");
  const topRow = STAND_SHAPES[Math.min(STAND_SHAPES.length, standLevel) - 1].rows;
  const roofRx = 104 + topRow * 11 + 6;
  const roofRy = 34 + topRow * 7 + 6;
  const roof = standLevel >= 5
    ? `<path class="stadium-roof" d="M ${160 - roofRx} 122 A ${roofRx} ${roofRy} 0 0 1 ${160 + roofRx} 122" />`
    : "";
  const dome = standLevel >= 6
    ? `<path class="stadium-dome" d="M 22 128 C 40 18, 280 18, 298 128" />`
    : "";
  const stalls = Array.from({ length: shopLevel }, (_, index) => {
    const x = 18 + index * 22;
    return `<g class="stadium-stall" transform="translate(${x} 150)"><rect x="0" y="6" width="18" height="12" rx="2" /><path d="M -2 7 L 9 0 L 20 7 Z" /></g>`;
  }).join("");
  const vaultRatio = empty || !view?.vault?.capMilli ? 0 : Math.min(1, liveVaultMilli(view) / view.vault.capMilli);
  const vaultFill = (16 * vaultRatio).toFixed(1);
  const queueCount = empty ? 0 : Math.min(18, Math.ceil((view?.waiting || 0) / 60));
  const queue = Array.from({ length: queueCount }, (_, index) => `<circle class="stadium-queue" cx="${118 + index * 6}" cy="172" r="2" />`).join("");
  const label = empty
    ? "まだ観客のいないスタジアムの絵"
    : `スタジアムの絵。収容${count(view.capacity)}人のうち${count(view.seated)}人が入場${view.waiting ? `、外で${count(view.waiting)}人が待っています` : ""}`;
  return `<svg class="stadium-art" viewBox="0 0 320 180" role="img" aria-label="${escapeHtml(label)}">
    <defs>
      <radialGradient id="stadiumGlowLeft" cx="0.15" cy="0.05" r="0.6"><stop offset="0" stop-color="#bfe8ff" stop-opacity="0.28" /><stop offset="1" stop-color="#bfe8ff" stop-opacity="0" /></radialGradient>
      <radialGradient id="stadiumGlowRight" cx="0.85" cy="0.05" r="0.6"><stop offset="0" stop-color="#bfe8ff" stop-opacity="0.28" /><stop offset="1" stop-color="#bfe8ff" stop-opacity="0" /></radialGradient>
    </defs>
    <rect class="stadium-sky" x="0" y="0" width="320" height="180" rx="14" />
    <rect x="0" y="0" width="320" height="180" fill="url(#stadiumGlowLeft)" />
    <rect x="0" y="0" width="320" height="180" fill="url(#stadiumGlowRight)" />
    ${dome}
    <g class="stadium-light"><path d="M 30 140 L 30 26" /><rect x="22" y="18" width="16" height="9" rx="2" /></g>
    <g class="stadium-light"><path d="M 290 140 L 290 26" /><rect x="282" y="18" width="16" height="9" rx="2" /></g>
    ${roof}
    <g class="stadium-seats">${seatDots}</g>
    <ellipse class="stadium-field" cx="160" cy="132" rx="92" ry="26" />
    <ellipse class="stadium-field-line" cx="160" cy="132" rx="60" ry="15" />
    <path class="stadium-field-line" d="M 160 106 L 160 158" />
    ${stalls}
    <g class="stadium-vault-icon" transform="translate(282 146)"><rect x="0" y="0" width="22" height="24" rx="3" /><rect class="stadium-vault-fill" x="3" y="${(23 - Number(vaultFill)).toFixed(1)}" width="16" height="${vaultFill}" rx="1.5" data-stadium-vault-fill /></g>
    ${queue}
  </svg>`;
}

// ───────────── 画面 ─────────────

function frame(content) {
  const balance = state.view?.walletBalance;
  return `<section class="screen stadium-screen" aria-busy="${state.busy ? "true" : "false"}">
    <header class="stadium-header">
      <div class="stadium-brand"><span class="stadium-brand-mark" aria-hidden="true"></span><div><small>MY STADIUM${previewScenario ? " / PREVIEW" : ""}</small><strong>マイスタジアム</strong></div></div>
      ${balance === null || balance === undefined ? "" : `<span class="stadium-wallet-chip">残高 <b>${escapeHtml(formatAnjuPay(balance))}</b></span>`}
      <nav class="stadium-nav"><button type="button" data-s="home">トップへ</button></nav>
    </header>
    ${content}
  </section>`;
}

function renderLoading() {
  return `<section class="screen stadium-screen stadium-loading" aria-busy="true"><span class="stadium-brand-mark is-large" aria-hidden="true"></span><p>マイスタジアムを開いています…</p></section>`;
}

function renderError() {
  return frame(`<div class="stadium-panel stadium-error" role="alert"><h2>開けませんでした</h2><p>${escapeHtml(state.fatalError || "通信状態を確かめて、もう一度お試しください。")}</p>
    <div class="stadium-actions"><button class="button stadium-button-primary" type="button" data-s="retry">もう一度読み込む</button></div></div>`);
}

function renderUnopened() {
  const busy = state.busy === "open";
  return frame(`<div class="stadium-panel stadium-intro">
    <figure class="stadium-figure">${stadiumSvg(null, { empty: true })}</figure>
    <div class="stadium-intro-copy">
      <p class="stadium-eyebrow">開業の前に</p>
      <h1>あなたのスタジアムを開業する</h1>
      <ul class="stadium-points">
        <li>開業した後に完走した1on1（通常型・戦略型）の数だけ、観客が来ます。1回の完走で${FANS_PER_MATCH}人です。勝ち負けは関係ありません。</li>
        <li>観客は客席に入って売上を落とし、あなたが離れている間も金庫に貯まります。金庫から回収した売上はAnjuPayになります。</li>
        <li>スタンド・売店・金庫は、Payで1段ずつ建てて育てます。</li>
        <li>開業前の完走は数えません。全員、観客0人から始まります。</li>
      </ul>
      <div class="stadium-actions"><button class="button stadium-button-primary" type="button" data-s="open" ${busy ? "disabled" : ""}>${busy ? "開業しています…" : "開業する"}</button></div>
      <small>AnjuPayはアプリ内ポイントです。現金・換金はありません。</small>
    </div>
  </div>`);
}

function nextHint(view) {
  if (view.fans === 0) {
    return `<div class="stadium-hint"><p>1on1を1回完走すると、観客が${FANS_PER_MATCH}人来ます。</p><button class="button stadium-button-ghost" type="button" data-s="play">1on1を選ぶ</button></div>`;
  }
  if (view.fans < view.capacity) {
    return `<div class="stadium-hint"><p>あと${count(view.matchesToFull)}回完走すると満席です（1回で観客 +${FANS_PER_MATCH}人）。</p><button class="button stadium-button-ghost" type="button" data-s="play">1on1を選ぶ</button></div>`;
  }
  const stand = view.facilities.find((facility) => facility.id === "stand");
  if (view.waiting > 0 && stand?.next) {
    const gain = Math.min(view.waiting, stand.next.value - stand.value);
    return `<div class="stadium-hint"><p>スタンドを広げると、外で待つ${count(view.waiting)}人のうち${count(gain)}人が入れます。</p></div>`;
  }
  return "";
}

function facilityEffect(facility) {
  if (facility.id === "stand") return `収容 ${count(facility.value)}人`;
  if (facility.id === "shop") return `入場者1,000人あたり 時給 ${formatRate(facility.value)} Pay`;
  return `${facility.value}時間分を貯められる`;
}

function facilityNextEffect(facility, view) {
  const next = facility.next;
  if (facility.id === "vault") {
    return `貯められる時間 ${facility.value} → ${next.value}時間（1日1回しか開かない人向け。朝晩に開くならLv1で足ります）`;
  }
  const delta = next.rateMilliPerHour - view.rateMilliPerHour;
  if (facility.id === "stand") {
    if (delta <= 0) return `収容 ${count(facility.value)} → ${count(next.value)}人（観客が客席より多くなると効きます）`;
    return `収容 ${count(facility.value)} → ${count(next.value)}人・時給 +${formatRate(delta)} Pay（いまの観客なら）`;
  }
  if (delta <= 0) return `単価 ${formatRate(facility.value)} → ${formatRate(next.value)} Pay（観客が来ると効きます）`;
  return `単価 ${formatRate(facility.value)} → ${formatRate(next.value)} Pay・時給 +${formatRate(delta)} Pay（いまの観客なら）`;
}

function renderFacility(facility, view) {
  const balance = Number(view.walletBalance) || 0;
  const head = `<div class="stadium-facility-head"><span class="stadium-facility-label">${escapeHtml(facility.label)}</span><strong>Lv${facility.level} ${escapeHtml(facility.name)}</strong><small>${escapeHtml(facilityEffect(facility))}</small></div>`;
  if (!facility.next) {
    return `<li class="stadium-facility is-complete">${head}<p class="stadium-complete">完成</p></li>`;
  }
  const next = facility.next;
  const short = Math.max(0, next.cost - balance);
  const confirming = state.confirm === facility.id;
  const busy = state.busy === `build:${facility.id}`;
  let action;
  if (confirming) {
    const after = [];
    after.push(`建てた後の残高 ${formatAnjuPay(balance - next.cost)}`);
    if (facility.id === "vault") after.push(`金庫の上限 ${formatAnjuPay(Math.floor(next.capMilli / MILLI_PER_PAY))}`);
    else after.push(`建てた後の時給 ${formatRate(next.rateMilliPerHour)} Pay`);
    action = `<div class="stadium-confirm" role="group" aria-label="${escapeHtml(`${facility.label}をLv${next.level}にする確認`)}">
      <p><b>${escapeHtml(formatAnjuPay(next.cost))}</b> で <b>Lv${next.level} ${escapeHtml(next.name)}</b> を建てます。代金は戻りません。</p>
      <small>${escapeHtml(after.join(" ・ "))}</small>
      <div class="stadium-actions">
        <button class="button stadium-button-primary" type="button" data-s="build" data-facility="${facility.id}" data-level="${next.level}" ${busy ? "disabled" : ""}>${busy ? "建てています…" : "建てる"}</button>
        <button class="button stadium-button-ghost" type="button" data-s="cancel-build" ${busy ? "disabled" : ""}>やめる</button>
      </div>
    </div>`;
  } else if (short > 0) {
    action = `<div class="stadium-facility-buy"><button class="button stadium-button-ghost" type="button" disabled>建てる（${escapeHtml(formatAnjuPay(next.cost))}）</button><small>あと ${escapeHtml(formatAnjuPay(short))}。デイリーミッションとデイリープレイ報酬でも貯められます。</small></div>`;
  } else {
    action = `<div class="stadium-facility-buy"><button class="button stadium-button-ghost" type="button" data-s="confirm-build" data-facility="${facility.id}" ${state.busy ? "disabled" : ""}>建てる（${escapeHtml(formatAnjuPay(next.cost))}）</button></div>`;
  }
  return `<li class="stadium-facility${confirming ? " is-confirming" : ""}">${head}
    <p class="stadium-facility-next">次: Lv${next.level} ${escapeHtml(next.name)} — ${escapeHtml(facilityNextEffect(facility, view))}</p>
    ${action}
  </li>`;
}

function renderCollect(view) {
  const vaultPay = Math.floor(liveVaultMilli(view) / MILLI_PER_PAY);
  const remaining = view.daily.remaining;
  const amount = Math.min(vaultPay, remaining);
  const busy = state.busy === "collect";
  let note = "";
  if (remaining <= 0) note = `今日の回収はここまでです（1日${count(DAILY_COLLECT_LIMIT)} Payまで）。残りは金庫に残ります。`;
  else if (vaultPay <= 0) note = "金庫はまだ空です。";
  else if (vaultPay > remaining) note = `今日はあと ${formatAnjuPay(remaining)} まで回収できます。残りは金庫に残ります。`;
  return `<div class="stadium-collect">
    <button class="button stadium-button-primary stadium-collect-button" type="button" data-s="collect" data-stadium-collect ${amount <= 0 || state.busy ? "disabled" : ""}>${busy ? "回収しています…" : `<span>金庫から回収する（<span data-stadium-collect-amount>${escapeHtml(formatAnjuPay(Math.max(0, amount)))}</span>）</span>`}</button>
    ${note ? `<small data-stadium-collect-note>${escapeHtml(note)}</small>` : ""}
  </div>`;
}

function renderNotice() {
  const notice = state.notice;
  if (!notice) return "";
  return `<div class="stadium-notice" role="status"><b>${escapeHtml(notice.title)}</b>${notice.body ? `<span>${escapeHtml(notice.body)}</span>` : ""}</div>`;
}

function renderMain() {
  const view = state.view;
  const vaultMilli = liveVaultMilli(view);
  const vaultRatio = view.vault.capMilli ? Math.min(1, vaultMilli / view.vault.capMilli) : 0;
  const stand = view.facilities.find((facility) => facility.id === "stand");
  return frame(`
    ${state.arrival > 0 ? `<div class="stadium-arrival" role="status">前回から <b>+${count(state.arrival)}人</b> 来場</div>` : ""}
    ${renderNotice()}
    <figure class="stadium-figure">${stadiumSvg(view)}<figcaption>Lv${stand.level} ${escapeHtml(stand.name)}</figcaption></figure>
    <dl class="stadium-stats">
      <div><dt>観客</dt><dd>${count(view.fans)}人</dd><small>入場 ${count(view.seated)}人 / 収容 ${count(view.capacity)}人${view.waiting ? `・外で待つ ${count(view.waiting)}人` : ""}</small></div>
      <div><dt>時給</dt><dd>${formatRate(view.rateMilliPerHour)} Pay</dd><small>入場者 × 売店の単価</small></div>
      <div class="stadium-stat-vault"><dt>金庫</dt><dd><span data-stadium-vault-pay>${count(Math.floor(vaultMilli / MILLI_PER_PAY))}</span> / ${count(view.vault.capPay)} Pay</dd>
        <span class="stadium-meter" aria-hidden="true"><i data-stadium-vault-bar style="width:${(vaultRatio * 100).toFixed(1)}%"></i></span>
        <small data-stadium-vault-status>${escapeHtml(vaultStatusText(view, vaultMilli))}</small></div>
      <div><dt>今日の回収</dt><dd>${count(view.daily.collected)} / ${count(view.daily.limit)} Pay</dd><small>日本時間の0時に戻ります</small></div>
    </dl>
    ${renderCollect(view)}
    ${nextHint(view)}
    <section class="stadium-facilities" aria-labelledby="stadiumFacilitiesTitle">
      <h2 id="stadiumFacilitiesTitle">施設 <small>Payで1段ずつ建てます。取り壊し・払い戻しはありません</small></h2>
      <ul>${view.facilities.map((facility) => renderFacility(facility, view)).join("")}</ul>
    </section>
    <p class="stadium-footnote">マイスタジアムの売上はAnjuPay（アプリ内ポイント）です。現金・換金はありません。観客は、開業した後に検証済みの1on1を完走した数で決まります。</p>
  `);
}

function render() {
  if (!active || !appRoot) return;
  if (state.screen === "loading") {
    appRoot.innerHTML = renderLoading();
    return;
  }
  if (state.screen === "error") appRoot.innerHTML = renderError();
  else if (state.screen === "unopened") appRoot.innerHTML = renderUnopened();
  else appRoot.innerHTML = renderMain();
}

// 金庫の数字・ゲージ・回収ボタンだけを書き換える（画面全体は描き直さない）。
function tick() {
  if (!active || state.screen !== "main" || !state.view) return;
  const view = state.view;
  const vaultMilli = liveVaultMilli(view);
  const vaultPay = Math.floor(vaultMilli / MILLI_PER_PAY);
  const ratio = view.vault.capMilli ? Math.min(1, vaultMilli / view.vault.capMilli) : 0;
  appRoot.querySelectorAll("[data-stadium-vault-pay]").forEach((node) => { node.textContent = count(vaultPay); });
  appRoot.querySelectorAll("[data-stadium-vault-bar]").forEach((node) => { node.style.width = `${(ratio * 100).toFixed(1)}%`; });
  appRoot.querySelectorAll("[data-stadium-vault-status]").forEach((node) => { node.textContent = vaultStatusText(view, vaultMilli); });
  appRoot.querySelectorAll("[data-stadium-vault-fill]").forEach((node) => {
    const height = 16 * ratio;
    node.setAttribute("height", height.toFixed(1));
    node.setAttribute("y", (23 - height).toFixed(1));
  });
  const amount = Math.max(0, Math.min(vaultPay, view.daily.remaining));
  appRoot.querySelectorAll("[data-stadium-collect-amount]").forEach((node) => { node.textContent = formatAnjuPay(amount); });
  const button = appRoot.querySelector("[data-stadium-collect]");
  if (button && !state.busy) button.disabled = amount <= 0;
}

function applyView(view, { keepArrival = false } = {}) {
  state.view = view;
  state.fetchedAt = Date.now();
  if (!view?.opened) {
    state.screen = "unopened";
    return;
  }
  state.screen = "main";
  if (!keepArrival) state.arrival = Number(view.newFans) || 0;
}

async function refresh(generation = lifecycleGeneration) {
  const view = await call("get");
  if (!isCurrent(generation)) return;
  applyView(view);
  render();
}

// ───────────── 操作 ─────────────

async function runAction(busyKey, work) {
  if (state.busy) return;
  state.busy = busyKey;
  render();
  const generation = lifecycleGeneration;
  try {
    await work(generation);
  } catch (error) {
    if (isCurrent(generation)) showToast(friendlyError(error));
  } finally {
    if (isCurrent(generation)) {
      state.busy = "";
      render();
    }
  }
}

async function handleClick(target) {
  const action = target.dataset.s;
  if (action === "home") {
    requestHome();
    return;
  }
  if (action === "play") {
    requestHome();
    return;
  }
  if (action === "retry") {
    await openStadiumScreen();
    return;
  }
  if (action === "open") {
    await runAction("open", async (generation) => {
      const view = await call("open");
      if (!isCurrent(generation)) return;
      applyView(view);
      state.notice = view.justOpened ? { title: "開業しました", body: "ここから数えた完走が、観客になります。" } : null;
    });
    return;
  }
  if (action === "collect") {
    await runAction("collect", async (generation) => {
      const view = await call("collect");
      if (!isCurrent(generation)) return;
      applyView(view, { keepArrival: true });
      if (view.collected > 0) {
        state.notice = {
          title: `+${formatAnjuPay(view.collected)} を回収しました`,
          body: `残高 ${formatAnjuPay(view.walletBalance)}・今日 ${count(view.daily.collected)} / ${count(view.daily.limit)} Pay`,
        };
      } else {
        const reasons = {
          empty: "金庫はまだ空です。",
          daily_limit: `今日の回収はここまでです（1日${count(DAILY_COLLECT_LIMIT)} Payまで）。`,
          wallet_full: "AnjuPayの残高が上限に達しているため、回収できませんでした。",
        };
        state.notice = { title: reasons[view.reason] || "回収できる売上はありませんでした。", body: "" };
      }
    });
    return;
  }
  if (action === "confirm-build") {
    state.confirm = target.dataset.facility || "";
    state.notice = null;
    render();
    return;
  }
  if (action === "cancel-build") {
    state.confirm = "";
    render();
    return;
  }
  if (action === "build") {
    const facility = target.dataset.facility || "";
    const level = Number(target.dataset.level);
    await runAction(`build:${facility}`, async (generation) => {
      const view = await call("build", { facility, level });
      if (!isCurrent(generation)) return;
      applyView(view, { keepArrival: true });
      state.confirm = "";
      const built = view.facilities?.find((row) => row.id === facility);
      state.notice = built
        ? { title: `${built.label}を Lv${built.level} ${built.name} にしました`, body: `残高 ${formatAnjuPay(view.walletBalance)}` }
        : null;
    });
  }
}

if (appRoot) {
  appRoot.addEventListener("click", (event) => {
    if (!active) return;
    const target = event.target.closest?.("[data-s]");
    if (!target || !target.closest(".stadium-screen")) return;
    if (target.disabled) return;
    event.preventDefault();
    handleClick(target);
  });
}

// ───────────── 起動と終了 ─────────────

async function openStadiumScreen() {
  const generation = lifecycleGeneration;
  state.screen = "loading";
  state.fatalError = "";
  render();
  try {
    if (!previewScenario) await ensureUser();
    if (!isCurrent(generation)) return;
    await refresh(generation);
    if (isCurrent(generation)) setChrome();
  } catch (error) {
    if (!isCurrent(generation)) return;
    state.screen = "error";
    state.fatalError = friendlyError(error, "マイスタジアムへ接続できませんでした。");
    setChrome("MY STADIUM / ERROR");
    render();
  }
}

async function start() {
  if (active) return;
  if (location.protocol === "file:") {
    showToast("マイスタジアムはローカルサーバーまたは公開URLから開いてください。");
    return;
  }
  if (modeIsActiveElsewhere()) {
    showToast("ほかのモードを終了してからマイスタジアムを開いてください。");
    return;
  }
  active = true;
  lifecycleGeneration += 1;
  state = createState();
  setChrome("MY STADIUM / CONNECTING");
  window.clearInterval(tickTimer);
  tickTimer = window.setInterval(tick, TICK_MS);
  await openStadiumScreen();
}

function isActive() {
  return active;
}

function requestHome() {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  window.clearInterval(tickTimer);
  tickTimer = null;
  state = createState();
  window.HariaiApp?.returnHome?.();
}

window.addEventListener("visibilitychange", () => {
  if (!active || document.visibilityState !== "visible" || state.screen !== "main" || state.busy) return;
  refresh().catch(() => {});
});

window.addEventListener("beforeunload", () => {
  active = false;
  lifecycleGeneration += 1;
  window.clearInterval(tickTimer);
});

// ───────────── プレビュー（localhost の ?stadiumPreview=… だけ。Firebase に触れない） ─────────────

let preview = null;

function previewSetup(scenario) {
  const now = Date.now();
  const hour = HOUR_MS;
  const levels = (stand, shop, vault) => ({ stand, shop, vault });
  const base = (overrides) => ({ ...createStadiumRecord({ now: now - 30 * 24 * hour, baselineMatches: 0 }), ...overrides });
  const scenarios = {
    unopened: { record: null, matches: 40, balance: 1_200 },
    new: { record: null, matches: 40, balance: 300, openNow: true },
    growing: {
      record: base({ settledAt: now - 5 * hour, fansAtSettle: 420, lastSeenFans: 330 }),
      matches: 14,
      balance: 1_250,
    },
    "full-outside": {
      record: base({ facilities: levels(2, 2, 1), settledAt: now - 6 * hour, fansAtSettle: 2_400, lastSeenFans: 2_400 }),
      matches: 80,
      balance: 1_800,
    },
    "vault-full": {
      record: base({ settledAt: now - 20 * hour, fansAtSettle: 1_200, lastSeenFans: 1_200 }),
      matches: 40,
      balance: 900,
    },
    "daily-cap": {
      record: base({
        facilities: levels(6, 4, 4),
        settledAt: now - 9 * hour,
        fansAtSettle: 6_000,
        lastSeenFans: 6_000,
        daily: { dateKey: "", collected: 0 },
      }),
      matches: 200,
      balance: 4_200,
      collectedToday: 190,
    },
    maxed: {
      record: base({ facilities: levels(6, 4, 4), settledAt: now - 3 * hour, fansAtSettle: 6_300, lastSeenFans: 6_000 }),
      matches: 210,
      balance: 12_000,
    },
  };
  const chosen = scenarios[scenario] || scenarios.growing;
  const record = chosen.record ? structuredClone(chosen.record) : null;
  if (record && chosen.collectedToday) {
    record.daily = { dateKey: stadiumView(record, { now, fans: 0 }).daily.dateKey, collected: chosen.collectedToday };
  }
  preview = { record, matches: chosen.matches, balance: chosen.balance, baselineAtOpen: 0 };
  if (chosen.openNow) {
    preview.record = createStadiumRecord({ now, baselineMatches: chosen.matches });
  }
}

function previewFans() {
  if (!preview.record) return 0;
  return Math.max(0, preview.matches - preview.record.baselineMatches) * FANS_PER_MATCH;
}

function previewCall(action, payload) {
  if (!preview) previewSetup(previewScenario);
  const now = Date.now();
  const fans = previewFans();
  if (action === "get") {
    if (!preview.record) return Promise.resolve({ opened: false, fansPerMatch: FANS_PER_MATCH, walletBalance: preview.balance });
    const seen = preview.record.lastSeenFans;
    const { record } = settleStadium(preview.record, { now, fans });
    preview.record = { ...record, lastSeenFans: fans };
    return Promise.resolve(stadiumView(record, { now, fans, previousSeenFans: seen, walletBalance: preview.balance }));
  }
  if (action === "open") {
    if (!preview.record) preview.record = createStadiumRecord({ now, baselineMatches: preview.matches });
    return Promise.resolve({ ...stadiumView(preview.record, { now, fans: 0, walletBalance: preview.balance }), justOpened: true });
  }
  if (action === "collect") {
    const result = collectStadium(preview.record, { now, fans, walletCapacity: 999_999_999 - preview.balance });
    preview.record = result.record;
    preview.balance += result.amount;
    return Promise.resolve({ ...stadiumView(result.record, { now, fans, walletBalance: preview.balance }), collected: result.amount, reason: result.reason });
  }
  if (action === "build") {
    const outcome = buildStadium(preview.record, { now, fans, facility: payload.facility, level: payload.level, balance: preview.balance });
    if (outcome.error) {
      return Promise.reject(Object.assign(new Error(outcome.error === "balance" ? "AnjuPay残高が足りません。" : "建てられませんでした。"), { code: "preview" }));
    }
    preview.record = outcome.record;
    preview.balance -= outcome.cost;
    return Promise.resolve({ ...stadiumView(outcome.record, { now, fans, walletBalance: preview.balance }), built: { facility: payload.facility, level: payload.level, cost: outcome.cost } });
  }
  return Promise.reject(Object.assign(new Error("見本では送信しません。"), { code: "preview" }));
}

window.HariaiStadium = Object.freeze({
  start,
  isActive,
  requestHome,
});
window.dispatchEvent(new Event("hariai-stadium-ready"));
