import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  collection,
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  auth,
  firestore,
  functions,
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1";
import { renderBlockButton } from "./player-safety.js?v=global-player-block-v1-copy-v2";
import {
  DEFINITION,
  DISCLOSURE_LABELS,
  DISCLOSURE_SHORT,
  DURATION_DAYS_OPTIONS,
  END_REASON_LABELS,
  ENTRY_FEE_OPTIONS,
  KIND_LABELS,
  LIMITS,
  PER_DAY_OPTIONS,
  PER_TRIBUTE_OPTIONS,
  POLICY_LABELS,
  PREMISES,
  REPORT_REASON_LABELS,
  SIGIL_COLORS,
  STYLE_LABELS,
  TONE_LABELS,
  TOTAL_OPTIONS,
  TRIBUTE_AGE_VERSION,
  capViolation,
  formatPay,
  messageProblem,
  normalizeCaps,
  remainingLabel,
  templatesFor,
  textLength,
  tributeFee,
  viewContract,
} from "./tribute-core.mjs?v=tribute-v1";

const appRoot = document.querySelector("#app");
// 確認シートとレシートは画面の外側に置く。画面要素の入場アニメーションが transform を使うため、
// その中の position: fixed はビューポートではなく画面要素に固定されてしまう。
const layer = document.createElement("div");
layer.className = "tribute-layer";
document.body.appendChild(layer);
const tributeActionCallable = httpsCallable(functions, "tributeAction");
const HOLD_MS = 1_200;
const EVENTS_LIMIT = 100;
const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SCREENS = new Set(["age", "hub", "board", "manager", "apply", "card", "thread", "receipts", "ledger", "ranking", "fund", "error", "loading"]);
const NAV_ITEMS = Object.freeze([
  Object.freeze({ screen: "hub", label: "契約" }),
  Object.freeze({ screen: "board", label: "掲示板" }),
  Object.freeze({ screen: "ledger", label: "貢ぎ帳" }),
  Object.freeze({ screen: "ranking", label: "番付" }),
  Object.freeze({ screen: "fund", label: "界隈基金" }),
]);

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
let eventsUnsubscribe = null;
let walletUnsubscribe = null;
let markReadTimer = null;
let tickTimer = null;
let hold = null;

function createState() {
  return {
    screen: "loading",
    uid: "",
    fatalError: "",
    ageConfirmed: false,
    profile: null,
    contracts: [],
    walletBalance: null,
    board: { status: "idle", managers: [], recommended: [], nekamaOnly: false },
    manager: { status: "idle", publicManagerId: "", data: null },
    applyTarget: null,
    thread: { contractId: "", raw: null, view: null, events: [], status: "idle" },
    receipts: { status: "idle", items: [], more: false },
    ledger: { status: "idle", asPayer: [], asManager: [] },
    ranking: { status: "idle", managers: [], monthKey: "" },
    fund: { status: "idle", data: null },
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

function friendlyError(error, fallback = "お貢ぎ界隈の処理を完了できませんでした。") {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("unauthenticated")) return "アカウントを確認できませんでした。ページを読み直してください。";
  if (code.includes("app-check") || code.includes("permission-denied") && /App Check/i.test(String(error?.message))) {
    return "通信保護を確認できませんでした。ページを再読み込みしてください。";
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

function isCurrent(generation) {
  return active && lifecycleGeneration === generation;
}

async function ensureUser() {
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady?.();
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function call(action, payload = {}) {
  if (previewScreen) return previewCall(action, payload);
  const response = await tributeActionCallable({ action, ...payload });
  return response.data || {};
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

function sigil(card, size = "") {
  const name = String(card?.personaName || "管").trim();
  const color = SIGIL_COLORS[Number(card?.sigil) || 0] || SIGIL_COLORS[0];
  return `<span class="tribute-sigil ${size}" style="--sigil:${color}" aria-hidden="true">${escapeHtml(Array.from(name)[0] || "管")}</span>`;
}

function disclosureTag(disclosure) {
  const key = DISCLOSURE_SHORT[disclosure] ? disclosure : "undisclosed";
  return `<span class="tribute-tag is-${key}" title="${escapeHtml(DISCLOSURE_LABELS[key])}">${escapeHtml(DISCLOSURE_SHORT[key])}</span>`;
}

function honorTag(honor) {
  return honor?.label ? `<span class="tribute-tag is-honor">${escapeHtml(honor.label)}</span>` : "";
}

function optionList(options, selected, format = (value) => formatPay(value)) {
  return options.map((value) => `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${escapeHtml(format(value))}</option>`).join("");
}

function setChrome(statusLabel = "OMITSUGI") {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(statusLabel)}`;
  if (privacy) privacy.textContent = "会わない・換金できない・上限と解約は預ける側";
  if (footerItems[0]) footerItems[0].textContent = "OMITSUGI / ANJUPAY ONLY";
  if (footerItems[1]) footerItems[1].textContent = "現金・外部決済・換金・連絡先の交換はありません";
}

// ───────────── 画面 ─────────────

function frame(content, { title = "お貢ぎ界隈", screenClass = "" } = {}) {
  const nav = state.ageConfirmed
    ? `<nav class="tribute-nav" aria-label="お貢ぎ界隈の移動">
        ${NAV_ITEMS.map((item) => `<button type="button" data-t="nav" data-screen="${item.screen}" aria-current="${state.screen === item.screen ? "page" : "false"}">${escapeHtml(item.label)}${item.screen === "hub" && unreadTotal() ? `<b class="tribute-badge">${unreadTotal()}</b>` : ""}</button>`).join("")}
        <button type="button" data-t="home">トップへ</button>
      </nav>`
    : `<nav class="tribute-nav"><button type="button" data-t="home">トップへ</button></nav>`;
  return `<section class="screen tribute-screen ${screenClass}" aria-busy="${state.busy ? "true" : "false"}">
    <header class="tribute-header">
      <div class="tribute-brand"><span class="tribute-brand-mark" aria-hidden="true">貢</span><div><small>OMITSUGI${previewScreen ? " / PREVIEW" : ""}</small><strong>${escapeHtml(title)}</strong></div></div>
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
  return `<section class="screen tribute-screen tribute-loading" aria-busy="true"><span class="tribute-brand-mark is-large" aria-hidden="true">貢</span><p>お貢ぎ界隈を開いています…</p></section>`;
}

function renderError() {
  return frame(`<div class="tribute-panel tribute-error" role="alert"><h2>開けませんでした</h2><p>${escapeHtml(state.fatalError || "通信状態を確かめて、もう一度お試しください。")}</p>
    <div class="tribute-row"><button class="button button-primary" type="button" data-t="retry">もう一度読み込む</button></div></div>`);
}

function renderAge() {
  return frame(`<div class="tribute-age">
    <p class="tribute-eyebrow">入場前の確認</p>
    <h1>お貢ぎ界隈</h1>
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
  return contract.role === "payer"
    ? { name: contract.manager.personaName, card: contract.manager }
    : { name: contract.payer.walletName, card: { personaName: contract.payer.walletName, sigil: 5 } };
}

function statusChip(contract) {
  if (contract.status === "pending") return `<span class="tribute-chip is-pending">受付待ち</span>`;
  if (contract.status === "active") return `<span class="tribute-chip is-active">管理中</span>`;
  return `<span class="tribute-chip is-ended">終了</span>`;
}

function renderContractRow(contract) {
  const counterpart = contractCounterpart(contract);
  const numbers = contract.status === "active" && contract.caps
    ? `<small>今日 ${formatPay(contract.todayTributed)} / ${formatPay(contract.caps.perDay)} ・ 合計 ${formatPay(contract.totalTributed)} / ${formatPay(contract.caps.total)}</small>`
    : contract.status === "pending"
      ? `<small>${contract.role === "manager" ? "申し込みが届いています" : "受理を待っています"}</small>`
      : `<small>${escapeHtml(contract.endReasonLabel || END_REASON_LABELS[contract.endReason] || "終了")}</small>`;
  return `<button type="button" class="tribute-contract-row is-${contract.status}" data-t="open-thread" data-contract="${escapeHtml(contract.contractId)}">
    ${sigil(counterpart.card)}
    <span class="tribute-contract-main"><span class="tribute-contract-line"><strong>${escapeHtml(counterpart.name)}</strong>${contract.role === "payer" ? disclosureTag(contract.manager.disclosure) : ""}${statusChip(contract)}</span>${numbers}</span>
    ${contract.unread && contract.status !== "ended" ? `<b class="tribute-badge">${contract.unread}</b>` : ""}
  </button>`;
}

function renderHub() {
  const profile = state.profile || {};
  const asPayer = state.contracts.filter((contract) => contract.role === "payer");
  const asManager = state.contracts.filter((contract) => contract.role === "manager");
  const openPayer = asPayer.filter((contract) => contract.status !== "ended");
  const openManager = asManager.filter((contract) => contract.status !== "ended");
  const ended = state.contracts.filter((contract) => contract.status === "ended").slice(0, 10);
  const card = profile.card;
  return frame(`<div class="tribute-hub">
    <section class="tribute-panel tribute-me">
      <div class="tribute-me-wallet">
        <span class="tribute-eyebrow">財布として</span>
        <form class="tribute-inline-form" data-form="wallet-name">
          <label><span>財布名（番付に載る時だけ使います）</span><input name="walletName" maxlength="${LIMITS.walletName}" value="${escapeHtml(profile.walletName || "")}" /></label>
          <button class="button button-ghost button-small" type="submit">保存</button>
        </form>
        <button class="button button-primary" type="button" data-t="nav" data-screen="board">管理人を探す</button>
        <button class="button button-ghost button-small" type="button" data-t="nav" data-screen="receipts">献上レシート（${Number(profile.receiptCount || 0)}枚）</button>
      </div>
      <div class="tribute-me-manager">
        <span class="tribute-eyebrow">管理人として</span>
        ${card ? `<div class="tribute-me-card">${sigil(card)}<div><strong>${escapeHtml(card.personaName)}</strong>${disclosureTag(card.disclosure)}${honorTag(profile.honor)}<small>${profile.hidden ? "通報が重なったため、今月は掲示板に出ていません。" : profile.accepting ? "受付中（掲示板に出ています）" : "受付停止中"}</small></div></div>
          <div class="tribute-row">
            <button class="button button-ghost button-small" type="button" data-t="toggle-accepting">${profile.accepting ? "受付を止める" : "受付を始める"}</button>
            <button class="button button-ghost button-small" type="button" data-t="nav" data-screen="card">カードを編集</button>
          </div>`
    : `<p>管理する側になるには、管理人カードを作ります。画像はなく、印はペルソナ名の1文字と色です。</p>
          <button class="button button-ghost" type="button" data-t="nav" data-screen="card">管理人カードを作る</button>`}
      </div>
    </section>
    <section class="tribute-panel">
      <h2>預けている契約 <small>${openPayer.length} / ${LIMITS.payerOpenContracts}</small></h2>
      ${openPayer.length ? openPayer.map(renderContractRow).join("") : `<p class="tribute-empty">まだ誰にも預けていません。掲示板から管理人を探せます。</p>`}
    </section>
    <section class="tribute-panel">
      <h2>管理している契約</h2>
      ${openManager.length ? openManager.map(renderContractRow).join("") : `<p class="tribute-empty">${card ? "まだ申し込みはありません。" : "管理人カードを作ると、申し込みを受けられます。"}</p>`}
    </section>
    ${ended.length ? `<details class="tribute-panel tribute-ended"><summary>終わった契約（${ended.length}）</summary>${ended.map(renderContractRow).join("")}</details>` : ""}
    <section class="tribute-panel tribute-legacy">
      <h2>旧推し値市場</h2>
      <p>推し値市場は2026年10月に終了し、お貢ぎ界隈へ置き換わりました。進行中の商談は完了・返還まで進み、ランキング・永久実績・推し値証書は閲覧できます。</p>
      <div class="tribute-row">
        <button class="button button-ghost button-small" type="button" data-t="legacy-market" data-dest="rankings">旧推し値市場の記録</button>
        <button class="button button-ghost button-small" type="button" data-t="legacy-market" data-dest="setup">進行中の商談に戻る</button>
      </div>
    </section>
  </div>`, { title: "契約" });
}

function renderManagerCard(card, { compact = false } = {}) {
  const color = SIGIL_COLORS[Number(card.sigil) || 0] || SIGIL_COLORS[0];
  return `<article class="tribute-card${compact ? " is-compact" : ""}" style="--sigil:${color}">
    <button type="button" data-t="open-manager" data-id="${escapeHtml(card.publicManagerId)}">
      <span class="tribute-card-head">${sigil(card)}<span><strong>${escapeHtml(card.personaName)}</strong><span class="tribute-card-tags">${disclosureTag(card.disclosure)}<span class="tribute-tag">${escapeHtml(STYLE_LABELS[card.style] || "")}</span>${honorTag(card.honor)}${card.mine ? '<span class="tribute-tag is-mine">あなた</span>' : ""}</span></span></span>
      ${compact ? "" : `<span class="tribute-card-intro">${escapeHtml(card.intro || "（紹介文なし）")}</span>`}
      <span class="tribute-card-meta"><span>入場料 <b>${escapeHtml(formatPay(card.entryFee))}</b></span><span>管理中 <b>${Number(card.activeContracts || 0)}</b></span>${card.recommendedCount ? `<span>推薦 <b>${Number(card.recommendedCount)}</b></span>` : ""}</span>
    </button>
  </article>`;
}

function renderBoard() {
  const board = state.board;
  const body = board.status === "loading" && !board.managers.length
    ? `<p class="tribute-empty">掲示板を読み込んでいます…</p>`
    : board.status === "error"
      ? `<p class="tribute-empty">掲示板を読み込めませんでした。<button class="button button-ghost button-small" type="button" data-t="reload-board">再読み込み</button></p>`
      : board.managers.length
        ? `<div class="tribute-card-grid">${board.managers.map((card) => renderManagerCard(card)).join("")}</div>`
        : `<p class="tribute-empty">${board.nekamaOnly ? "ネカマ開示の管理人は、いま受付していません。" : "いま受付中の管理人はいません。"}</p>`;
  return frame(`<div class="tribute-board">
    <div class="tribute-board-tools">
      <label class="tribute-switch"><input type="checkbox" data-t="toggle-nekama" ${board.nekamaOnly ? "checked" : ""} /><span>ネカマ開示のみ</span></label>
      <small>性別で絞る機能はありません。中の人の札は、分かって渡すための札です。</small>
    </div>
    ${board.recommended.length ? `<section class="tribute-shelf"><h2>推薦棚 <small>上納した管理人たちの推薦</small></h2><div class="tribute-card-grid is-shelf">${board.recommended.map((card) => renderManagerCard(card, { compact: true })).join("")}</div></section>` : ""}
    <section><h2 class="tribute-section-title">受付中の管理人</h2>${body}</section>
  </div>`, { title: "掲示板" });
}

function renderRankingRows(rows, emptyText) {
  if (!rows?.length) return `<p class="tribute-empty">${escapeHtml(emptyText)}</p>`;
  return `<ol class="tribute-rank-list">${rows.map((row) => `<li class="${row.mine ? "is-mine" : ""}"><b>${row.rank}</b><span>${escapeHtml(row.walletName)}</span><em>${escapeHtml(formatPay(row.amount))}</em></li>`).join("")}</ol>`;
}

function renderManagerDetail() {
  const entry = state.manager;
  if (entry.status === "loading" || !entry.data) {
    return frame(`<p class="tribute-empty">${entry.status === "error" ? "この管理人を開けませんでした。" : "管理人カードを開いています…"}</p>`, { title: "管理人" });
  }
  const { card, month, openContractId, myTotal, ranking } = entry.data;
  const fundHonor = state.fund.data?.me?.honor;
  const canRecommend = !card.mine && fundHonor?.tier;
  const recommended = (fundHonor?.recommendations || []).some((row) => row.publicManagerId === card.publicManagerId);
  const action = card.mine
    ? `<p class="tribute-note">あなたの管理人カードです。</p>`
    : openContractId
      ? `<button class="button button-primary" type="button" data-t="open-thread" data-contract="${escapeHtml(openContractId)}">契約のスレッドを開く</button>`
      : card.accepting
        ? `<button class="button button-primary" type="button" data-t="open-apply">この管理人に申し込む</button>`
        : `<p class="tribute-note">この管理人は受付を止めています。</p>`;
  return frame(`<div class="tribute-manager-detail">
    <section class="tribute-panel tribute-profile" style="--sigil:${SIGIL_COLORS[card.sigil] || SIGIL_COLORS[0]}">
      <div class="tribute-profile-head">${sigil(card, "is-large")}<div><h1>${escapeHtml(card.personaName)}</h1><div class="tribute-card-tags">${disclosureTag(card.disclosure)}<span class="tribute-tag">${escapeHtml(STYLE_LABELS[card.style] || "")}</span>${honorTag(card.honor)}</div></div></div>
      <p class="tribute-profile-intro">${escapeHtml(card.intro || "（紹介文なし）")}</p>
      <dl class="tribute-facts">
        <div><dt>中の人の札</dt><dd>${escapeHtml(DISCLOSURE_LABELS[card.disclosure] || "非開示")}</dd></div>
        <div><dt>入場料</dt><dd>${escapeHtml(formatPay(card.entryFee))}</dd></div>
        <div><dt>今月の財布</dt><dd>${Number(month?.payers || 0)}人</dd></div>
        <div><dt>管理中</dt><dd>${Number(card.activeContracts || 0)}件</dd></div>
        ${myTotal ? `<div><dt>あなたの献上</dt><dd>${escapeHtml(formatPay(myTotal))}</dd></div>` : ""}
      </dl>
      <div class="tribute-row">${action}
        ${canRecommend ? `<button class="button button-ghost button-small" type="button" data-t="${recommended ? "unrecommend" : "recommend"}" data-id="${escapeHtml(card.publicManagerId)}">${recommended ? "推薦を外す" : "推薦する"}</button>` : ""}
        ${card.mine || previewScreen ? "" : renderBlockButton({ mode: "tribute", publicManagerId: card.publicManagerId }, "この管理人をブロック")}
      </div>
    </section>
    <section class="tribute-panel">
      <h2>${escapeHtml(card.personaName)}の番付 <small>番付に載ることを選んだ財布だけ</small></h2>
      <div class="tribute-two-col">
        <div><h3>今月</h3>${renderRankingRows(ranking?.month, "今月はまだいません。")}</div>
        <div><h3>累計</h3>${renderRankingRows(ranking?.lifetime, "まだいません。")}</div>
      </div>
    </section>
  </div>`, { title: card.personaName });
}

function renderApply() {
  const target = state.applyTarget;
  if (!target) return frame(`<p class="tribute-empty">申し込む管理人を選び直してください。</p>`, { title: "申し込み" });
  const profile = state.profile || {};
  const minPerTribute = PER_TRIBUTE_OPTIONS.find((value) => value >= target.entryFee) || PER_TRIBUTE_OPTIONS[0];
  const perTribute = Math.max(30, minPerTribute);
  return frame(`<form class="tribute-panel tribute-apply" data-form="apply">
    <div class="tribute-apply-head">${sigil(target)}<div><span class="tribute-eyebrow">管理を申し込む</span><h1>${escapeHtml(target.personaName)}</h1>${disclosureTag(target.disclosure)}</div></div>
    <p class="tribute-hold-note">上限と解約は、あなたが握ります。管理人は上限・期間・言葉の設定・解約に触れられません。</p>
    <fieldset><legend>上限（1回 ≦ 1日 ≦ 契約合計）</legend>
      <div class="tribute-three">
        <label><span>1回</span><select name="perTribute">${optionList(PER_TRIBUTE_OPTIONS, perTribute)}</select></label>
        <label><span>1日</span><select name="perDay">${optionList(PER_DAY_OPTIONS, 100)}</select></label>
        <label><span>契約合計</span><select name="total">${optionList(TOTAL_OPTIONS, 300)}</select></label>
      </div>
      <small>下げる変更はいつでも即時。上げる変更は日本時間の翌日0時から効きます。</small>
    </fieldset>
    <fieldset><legend>期間</legend><div class="tribute-radio-row">${DURATION_DAYS_OPTIONS.map((days, index) => `<label><input type="radio" name="durationDays" value="${days}" ${index === 0 ? "checked" : ""} /><span>${days}日</span></label>`).join("")}</div></fieldset>
    <fieldset><legend>言葉の強さ</legend><div class="tribute-radio-row">${Object.entries(TONE_LABELS).map(([tone, label]) => `<label><input type="radio" name="tone" value="${tone}" ${tone === "normal" ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`).join("")}</div>
      <small>辛口は徹底して辛く罵られます。自傷や死をすすめる言葉・脅し・差別語・晒しは、どの強さでもありません。</small></fieldset>
    <label class="tribute-field"><span>言われたくない言葉（最大${LIMITS.ngWordCount}語・各${LIMITS.ngWordLength}文字、読点区切り）</span><input name="ngWords" maxlength="80" placeholder="例：ブス、デブ" /></label>
    <label class="tribute-check"><input type="checkbox" name="allowReportRequests" /><span>残高報告を求められてもよい</span></label>
    <label class="tribute-check"><input type="checkbox" name="rankOptIn" /><span>この管理人の番付に財布名で載る</span></label>
    <label class="tribute-field"><span>財布名</span><input name="walletName" maxlength="${LIMITS.walletName}" value="${escapeHtml(profile.walletName || "")}" /></label>
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
    <label class="tribute-field"><span>ペルソナ名（1〜${LIMITS.personaName}文字）</span><input name="personaName" maxlength="${LIMITS.personaName}" required value="${escapeHtml(card.personaName || "")}" /></label>
    <label class="tribute-field"><span>紹介（${LIMITS.intro}文字まで）</span><input name="intro" maxlength="${LIMITS.intro}" value="${escapeHtml(card.intro || "")}" /></label>
    <fieldset><legend>中の人の札</legend><div class="tribute-radio-col">${Object.entries(DISCLOSURE_LABELS).map(([key, label]) => `<label><input type="radio" name="disclosure" value="${key}" ${card.disclosure === key ? "checked" : ""} required /><span>${escapeHtml(label)}</span></label>`).join("")}</div>
      <small>ネカマ貢がせは、男性であることを隠さず行うジャンルです。受け手の性別を女性に限る仕組みはありません。</small></fieldset>
    <fieldset><legend>管理の型</legend><div class="tribute-radio-row">${Object.entries(STYLE_LABELS).map(([key, label]) => `<label><input type="radio" name="style" value="${key}" ${(card.style || "harsh") === key ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`).join("")}</div></fieldset>
    <label class="tribute-field"><span>入場料</span><select name="entryFee">${optionList(ENTRY_FEE_OPTIONS, card.entryFee ?? 0)}</select></label>
    <fieldset><legend>印の色</legend><div class="tribute-swatches">${SIGIL_COLORS.map((color, index) => `<label style="--sigil:${color}"><input type="radio" name="sigil" value="${index}" ${Number(card.sigil || 0) === index ? "checked" : ""} /><span aria-label="色${index + 1}"></span></label>`).join("")}</div></fieldset>
    <label class="tribute-check"><input type="checkbox" name="accepting" ${profile.accepting || !profile.card ? "checked" : ""} /><span>受付する（掲示板に出す）</span></label>
    <p class="tribute-note">連絡先・SNSのID・外部決済・現金・会う約束・住所や本名に関わる言葉は、カードにも会話にも書けません。</p>
    <p class="tribute-form-error" data-form-error role="alert"></p>
    <div class="tribute-row"><button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>保存する</button>
      <button class="button button-ghost" type="button" data-t="nav" data-screen="hub">戻る</button></div>
  </form>`, { title: "管理人カード" });
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

function capsText(caps) {
  return caps ? `1回 ${formatPay(caps.perTribute)} ・ 1日 ${formatPay(caps.perDay)} ・ 合計 ${formatPay(caps.total)}` : "";
}

function renderEvent(event, view, statuses) {
  const mine = event.actor === view.role;
  const managerName = view.manager.personaName;
  const payerName = view.payer.walletName;
  const actorName = event.actor === "manager" ? managerName : event.actor === "payer" ? payerName : "";
  const time = `<time>${escapeHtml(formatDateTime(event.createdAt))}</time>`;
  const system = (text, extra = "") => `<li class="tribute-event is-system ${extra}"><p>${text}</p>${time}</li>`;
  switch (event.type) {
    case "message":
      return `<li class="tribute-event is-message ${mine ? "is-mine" : "is-theirs"} is-${event.actor}">
        <span class="tribute-bubble">${escapeHtml(event.text)}</span>${time}</li>`;
    case "applied":
      return system(`申し込み：${escapeHtml(capsText(event.caps))} ・ ${Number(event.durationDays)}日 ・ 言葉は${escapeHtml(TONE_LABELS[event.tone] || "普通")}${event.entryFee ? ` ・ 入場料 ${escapeHtml(formatPay(event.entryFee))}` : ""}`);
    case "accepted":
      return system(`受理されました。管理は ${escapeHtml(formatDateTime(event.expiresAt))} まで続きます。`, "is-strong");
    case "request": {
      const pendingNow = view.pendingRequests.find((entry) => entry.requestId === event.requestId);
      const status = pendingNow ? "pending" : statuses.get(event.requestId) || "closed";
      const statusLabel = { paid: "差し出し済み", declined: "断りました", cancelled: "取り消し", voided: "上限の変更で無効", closed: "終了" }[status] || "";
      const buttons = status === "pending" && view.status === "active"
        ? view.role === "payer"
          ? `<div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="give-request" data-request="${escapeHtml(event.requestId)}" data-amount="${Number(event.amount)}">差し出す</button><button class="button button-ghost button-small" type="button" data-t="decline-request" data-request="${escapeHtml(event.requestId)}">断る</button></div>`
          : `<div class="tribute-row"><button class="button button-ghost button-small" type="button" data-t="cancel-request" data-request="${escapeHtml(event.requestId)}">取り消す</button></div>`
        : `<span class="tribute-chip is-${status}">${escapeHtml(statusLabel)}</span>`;
      return `<li class="tribute-event is-request ${mine ? "is-mine" : "is-theirs"}"><div class="tribute-request-card"><span class="tribute-eyebrow">請求</span><strong>${escapeHtml(formatPay(event.amount))}</strong>${event.note ? `<p>「${escapeHtml(event.note)}」</p>` : ""}${buttons}</div>${time}</li>`;
    }
    case "tribute":
      return `<li class="tribute-event is-tribute"><div class="tribute-stamp"><span>${escapeHtml(KIND_LABELS[event.kind] || "献上")}</span><strong>${escapeHtml(formatPay(event.amount))}</strong><small>${escapeHtml(payerName)} → ${escapeHtml(managerName)}</small></div>${time}</li>`;
    case "report":
      return system(`残高報告：財布 <b>${escapeHtml(formatPay(event.walletBalance))}</b> ・ 管理口座 <b>${escapeHtml(formatPay(event.escrowBalance))}</b>（サーバーが記入）`, "is-report");
    case "report_requested":
      return system(`${escapeHtml(managerName)}が残高報告を求めています。${view.role === "payer" && view.reportRequested && view.status === "active" ? ' <button class="button button-ghost button-small" type="button" data-t="report-balance">報告する</button>' : ""}`);
    case "caps_lowered":
      return system(`上限を下げました（即時）：${escapeHtml(capsText(event.caps))}`, "is-caps");
    case "caps_raise_scheduled":
      return system(`上限を上げる予約：${escapeHtml(capsText(event.caps))}（${escapeHtml(event.effectiveDateKey)} 0時から）`, "is-caps");
    case "caps_raised":
      return system(`予約していた上限が効きました：${escapeHtml(capsText(event.caps))}`, "is-caps");
    case "caps_raise_cancelled":
      return system("上限を上げる予約を取り消しました。", "is-caps");
    case "request_cancelled":
      return event.reason === "caps" ? system("上限の変更で、超えていた請求を無効にしました。") : system("請求が取り消されました。");
    case "request_declined":
      return system("請求を断りました。");
    case "escrow_deposit":
      return system(`管理口座へ ${escapeHtml(formatPay(event.amount))} 預けました（残高 ${escapeHtml(formatPay(event.escrowBalance))}）。管理口座のPayは、まだ預ける側のものです。`, "is-escrow");
    case "escrow_withdraw_request":
      return system(`管理口座から ${escapeHtml(formatPay(event.amount))} の使用許可を申請しました。`, "is-escrow");
    case "escrow_withdraw_cancelled":
      return system("使用許可の申請を取り下げました。", "is-escrow");
    case "escrow_approved":
      return system(`使用許可：${escapeHtml(formatPay(event.amount))} が財布へ戻りました。`, "is-escrow");
    case "escrow_denied":
      return system(`使用許可は却下されました（${escapeHtml(formatPay(event.amount))}）。解約すれば、管理口座はいつでも全額戻ります。`, "is-escrow");
    case "escrow_returned":
      return system(`上限の変更に合わせて、管理口座から ${escapeHtml(formatPay(event.amount))} を財布へ戻しました。`, "is-escrow");
    case "ended":
      return system(`${escapeHtml(END_REASON_LABELS[event.reason] || "契約が終わりました")}。${event.escrowReturned ? `管理口座の ${escapeHtml(formatPay(event.escrowReturned))} は財布へ戻りました。` : ""}`, "is-ended");
    default:
      return "";
  }
}

function renderThreadHead(view) {
  const counterpart = contractCounterpart(view);
  const caps = view.caps;
  const endButton = view.status === "active"
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
  return `<div class="tribute-thread-title">${sigil(counterpart.card)}<div><span class="tribute-contract-line"><strong>${escapeHtml(counterpart.name)}</strong>
      ${view.role === "payer" ? disclosureTag(view.manager.disclosure) : '<span class="tribute-tag">あなたが管理</span>'}${statusChip(view)}</span>
      <small>${view.status === "active" ? `${escapeHtml(remainingLabel(view.expiresAt))} ・ 言葉は${escapeHtml(TONE_LABELS[view.tone] || "普通")}` : view.status === "pending" ? `申し込みの期限 ${escapeHtml(formatDateTime(view.expiresAt))}` : escapeHtml(view.endReasonLabel)}</small></div>
      <div class="tribute-thread-end">${endButton}</div></div>
    ${caps && view.status !== "ended" ? `<div class="tribute-meters">
      ${meter(view.todayTributed, caps.perDay, "今日")}
      ${meter(view.totalTributed, caps.total, "契約合計")}
      <div class="tribute-meter is-plain"><span>1回</span><b>${escapeHtml(formatPay(caps.perTribute))}</b></div>
      <div class="tribute-meter is-plain"><span>管理口座</span><b>${escapeHtml(formatPay(view.escrowBalance))}</b></div>
    </div>` : ""}
    ${view.pendingCaps ? `<p class="tribute-caps-pending">上限を上げる予約：${escapeHtml(capsText(view.pendingCaps))}（${escapeHtml(view.pendingCapsEffectiveDateKey)} 0時から）${view.role === "payer" ? ' <button class="button button-ghost button-small" type="button" data-t="cancel-raise">予約を取り消す</button>' : ""}</p>` : ""}
    ${view.ngWords.length && view.role === "manager" ? `<p class="tribute-ng">言われたくない言葉：${view.ngWords.map((word) => `<span>${escapeHtml(word)}</span>`).join("")}</p>` : ""}`;
}

function renderThreadActions(view) {
  if (view.status === "pending") {
    return view.role === "manager"
      ? `<div class="tribute-actions"><button class="button button-primary" type="button" data-t="accept">受理する${view.entryFee ? `（入場料 ${escapeHtml(formatPay(view.entryFee))}）` : ""}</button><button class="button button-ghost" type="button" data-t="decline">断る</button></div>`
      : `<p class="tribute-note">受理されると管理が始まります。${view.entryFee ? `入場料 ${escapeHtml(formatPay(view.entryFee))} は受理の時に移ります。` : ""}</p>`;
  }
  if (view.status !== "active") {
    return `<div class="tribute-actions"><button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="report">通報</button></div>`;
  }
  const withdraw = view.escrowWithdrawRequest;
  if (view.role === "payer") {
    return `<div class="tribute-actions">
      <button class="button button-primary tribute-give-button" type="button" data-t="sheet" data-sheet="give" ${view.allowance ? "" : "disabled"}>差し出す${view.allowance ? "" : "（今日の枠なし）"}</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="escrow">管理口座</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="caps">上限を変える</button>
      <button class="button button-ghost button-small" type="button" data-t="report-balance">残高を報告</button>
      <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="report">通報</button>
      ${previewScreen ? "" : renderBlockButton({ mode: "tribute", contractId: view.contractId }, "ブロック")}
    </div>
    ${withdraw ? `<p class="tribute-note">使用許可を申請中：${escapeHtml(formatPay(withdraw.amount))} <button class="button button-ghost button-small" type="button" data-t="cancel-withdraw">取り下げる</button></p>` : ""}`;
  }
  return `<div class="tribute-actions">
    <button class="button button-primary" type="button" data-t="sheet" data-sheet="request" ${view.allowance && view.pendingRequests.length < LIMITS.pendingRequests ? "" : "disabled"}>請求する</button>
    <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="take" ${view.escrowBalance && view.allowance ? "" : "disabled"}>管理口座から徴収</button>
    ${view.allowReportRequests ? `<button class="button button-ghost button-small" type="button" data-t="request-report" ${view.reportRequested ? "disabled" : ""}>${view.reportRequested ? "報告待ち" : "報告を求める"}</button>` : ""}
    <button class="button button-ghost button-small" type="button" data-t="sheet" data-sheet="report">通報</button>
    ${previewScreen ? "" : renderBlockButton({ mode: "tribute", contractId: view.contractId }, "ブロック")}
  </div>
  ${withdraw ? `<div class="tribute-withdraw-ask"><p>${escapeHtml(view.payer.walletName)}が管理口座から ${escapeHtml(formatPay(withdraw.amount))} の使用許可を求めています。</p><div class="tribute-row"><button class="button button-primary button-small" type="button" data-t="escrow-decision" data-approve="1">許可する</button><button class="button button-ghost button-small" type="button" data-t="escrow-decision" data-approve="0">却下する</button></div></div>` : ""}`;
}

function renderTemplates(view) {
  const groups = templatesFor(view.role, view.tone, { disclosure: view.manager.disclosure, ngWords: view.ngWords });
  return `<details class="tribute-templates"><summary>定型文（${escapeHtml(TONE_LABELS[view.tone] || "普通")}）</summary>
    ${groups.map((group) => `<div class="tribute-template-group"><span>${escapeHtml(group.label)}</span><div>${group.lines.map((line) => `<button type="button" data-t="template" data-text="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div></div>`).join("")}
  </details>`;
}

function renderThread() {
  const thread = state.thread;
  const view = thread.view;
  if (!view) {
    return frame(`<p class="tribute-empty">${thread.status === "error" ? "スレッドを開けませんでした。" : "スレッドを開いています…"}</p>`, { title: "スレッド", screenClass: "tribute-thread-screen" });
  }
  const statuses = requestStatusMap(thread.events);
  return frame(`<div class="tribute-thread">
    <div class="tribute-thread-head" id="tributeThreadHead">${renderThreadHead(view)}</div>
    <ol class="tribute-events" id="tributeThreadEvents" aria-live="polite">${thread.events.map((event) => renderEvent(event, view, statuses)).join("")}</ol>
    <div class="tribute-thread-actions" id="tributeThreadActions">${renderThreadActions(view)}</div>
    ${view.status === "active" ? `<form class="tribute-composer" data-form="message">
      <textarea name="text" maxlength="${LIMITS.message}" rows="2" placeholder="${view.role === "manager" ? "管理の言葉（相手の「言われたくない言葉」は送れません）" : "返事・報告・止める言葉"}"></textarea>
      <div class="tribute-composer-foot"><small data-composer-count>0 / ${LIMITS.message}</small><span class="tribute-form-error" data-form-error role="alert"></span><button class="button button-primary button-small" type="submit">送る</button></div>
      ${renderTemplates(view)}
    </form>` : ""}
  </div>`, { title: view.role === "payer" ? view.manager.personaName : view.payer.walletName, screenClass: "tribute-thread-screen" });
}

function updateThreadParts() {
  const view = state.thread.view;
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
  head.innerHTML = renderThreadHead(view);
  const statuses = requestStatusMap(state.thread.events);
  list.innerHTML = state.thread.events.map((event) => renderEvent(event, view, statuses)).join("");
  actions.innerHTML = renderThreadActions(view);
  if (nearBottom) scrollThreadToEnd();
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
  if (!sheet || !view) return "";
  const close = `<button class="tribute-sheet-close" type="button" data-t="sheet-close" aria-label="閉じる">×</button>`;
  const wrap = (title, body) => `<div class="tribute-sheet-backdrop" data-t="sheet-close"></div><div class="tribute-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><h2>${escapeHtml(title)}</h2>${close}</header>${body}</div>`;
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
          ${sheet.requestId ? `<p class="tribute-eyebrow">請求に応える</p>` : `<p class="tribute-eyebrow">無言の献上</p>`}
          <strong class="tribute-confirm-amount">${escapeHtml(formatPay(sheet.amount))}</strong>
          <dl class="tribute-facts">
            <div><dt>今日の残り枠</dt><dd>${escapeHtml(formatPay(Math.max(0, view.caps.perDay - view.todayTributed - sheet.amount)))}</dd></div>
            <div><dt>契約の残り枠</dt><dd>${escapeHtml(formatPay(Math.max(0, view.caps.total - view.totalTributed - sheet.amount)))}</dd></div>
            <div><dt>支払後の財布</dt><dd>${balanceAfter === null ? "確認中" : escapeHtml(formatPay(balanceAfter))}</dd></div>
            <div><dt>受け手の手数料（消却）</dt><dd>${escapeHtml(formatPay(fee))}</dd></div>
          </dl>
          <button type="button" class="tribute-hold" data-tribute-hold ${state.busy ? "disabled" : ""}><span class="tribute-hold-fill" aria-hidden="true"></span><span class="tribute-hold-label">長押しで差し出す</span></button>
          <small>指を離すと止まります。換金できないAnjuPayだけが動きます。</small>
          <button class="button button-ghost button-small" type="button" data-t="give-back">金額を変える</button>
        </div>`);
      }
      const maximum = view.allowance;
      return wrap("差し出す", `<form class="tribute-sheet-form" data-form="give">
        <p>今日あと <b>${escapeHtml(formatPay(Math.max(0, view.caps.perDay - view.todayTributed)))}</b> ・ 契約あと <b>${escapeHtml(formatPay(Math.max(0, view.caps.total - view.totalTributed)))}</b> ・ 1回 <b>${escapeHtml(formatPay(view.caps.perTribute))}</b> まで</p>
        ${amountChips(maximum)}
        <label class="tribute-field"><span>金額（Pay）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${maximum}" step="1" value="${Number(sheet.amount || "") || ""}" required /></label>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit">確認へ</button>
      </form>`);
    }
    case "request": {
      const maximum = Math.min(view.caps.perTribute, view.allowance);
      return wrap("請求する", `<form class="tribute-sheet-form" data-form="request">
        <p>${escapeHtml(view.payer.walletName)}の上限の範囲でだけ請求できます（いま最大 ${escapeHtml(formatPay(maximum))}）。未払いの請求は3件まで。</p>
        ${amountChips(maximum)}
        <label class="tribute-field"><span>金額（Pay）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${maximum}" step="1" required /></label>
        <label class="tribute-field"><span>一言（${LIMITS.requestNote}文字まで）</span><input name="note" maxlength="${LIMITS.requestNote}" /></label>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>請求を送る</button>
      </form>`);
    }
    case "take": {
      const maximum = Math.min(view.escrowBalance, view.allowance);
      return wrap("管理口座から徴収", `<form class="tribute-sheet-form" data-form="take">
        <p>管理口座 ${escapeHtml(formatPay(view.escrowBalance))} から、上限の範囲で徴収します（いま最大 ${escapeHtml(formatPay(maximum))}）。献上として数え、相手にレシートが出ます。</p>
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
          <label class="tribute-field"><span>預け入れ（契約合計の上限 − 献上済み まで）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${view.escrowRoom}" step="1" ${view.escrowRoom ? "" : "disabled"} /></label>
          <button class="button button-primary button-small" type="submit" ${view.escrowRoom && !state.busy ? "" : "disabled"}>預ける</button>
        </form>
        <form class="tribute-sheet-form" data-form="escrow-withdraw">
          <label class="tribute-field"><span>使用許可を申請する額</span><input name="amount" type="number" inputmode="numeric" min="1" max="${view.escrowBalance}" step="1" ${view.escrowBalance && !view.escrowWithdrawRequest ? "" : "disabled"} /></label>
          <button class="button button-ghost button-small" type="submit" ${view.escrowBalance && !view.escrowWithdrawRequest && !state.busy ? "" : "disabled"}>${view.escrowWithdrawRequest ? "申請中" : "申請する"}</button>
        </form>
        <p class="tribute-form-error" data-form-error role="alert"></p>
      </div>`);
    case "caps":
      return wrap("上限を変える", `<form class="tribute-sheet-form" data-form="caps">
        <p>下げる変更はすぐ効きます。上げる変更は日本時間の翌日0時から効き、それまで取り消せます。下げた上限を超える請求は無効になり、管理口座の超えた分は財布へ戻ります。</p>
        <div class="tribute-three">
          <label><span>1回</span><select name="perTribute">${optionList(PER_TRIBUTE_OPTIONS, view.caps.perTribute)}</select></label>
          <label><span>1日</span><select name="perDay">${optionList(PER_DAY_OPTIONS, view.caps.perDay)}</select></label>
          <label><span>契約合計</span><select name="total">${optionList(TOTAL_OPTIONS, view.caps.total)}</select></label>
        </div>
        <p class="tribute-form-error" data-form-error role="alert"></p>
        <button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>変更する</button>
      </form>`);
    case "end":
      return wrap(view.role === "payer" ? "解約する" : "解放する", `<div class="tribute-confirm">
        ${view.role === "payer"
    ? `<p>いつでも、すぐに終われます。罰も記録上の不利もありません。${view.escrowBalance ? `管理口座の <b>${escapeHtml(formatPay(view.escrowBalance))}</b> はすぐ財布へ戻ります。` : ""}未払いの請求は無効になります。</p>`
    : `<p>この財布の管理を終えます。管理口座の残りは、すぐ預ける側へ戻ります。</p>`}
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

function renderReceiptOverlay() {
  const receipt = state.receipt;
  if (!receipt) return "";
  return `<div class="tribute-receipt-overlay" role="dialog" aria-modal="true" aria-label="献上レシート">
    <div class="tribute-wallet-anim" aria-hidden="true"><span class="tribute-wallet-body"></span><span class="tribute-wallet-flap"></span><i></i><i></i><i></i></div>
    <article class="tribute-receipt">
      <header><span>献上レシート</span><b>No.${String(receipt.receiptNo || 0).padStart(5, "0")}</b></header>
      <p class="tribute-receipt-to">${sigil(receipt)} ${escapeHtml(receipt.personaName)} ${disclosureTag(receipt.disclosure)}</p>
      <strong class="tribute-receipt-amount">${escapeHtml(formatPay(receipt.amount))}</strong>
      <dl><div><dt>種類</dt><dd>${escapeHtml(KIND_LABELS[receipt.kind] || "献上")}</dd></div>
        <div><dt>日時</dt><dd>${escapeHtml(formatDateTime(receipt.createdAt))}</dd></div>
        <div><dt>この管理人へ</dt><dd>${Number(receipt.pairCount || 0)}回目の献上</dd></div></dl>
      <footer>非譲渡・換金不可 ・ AnjuPay only</footer>
    </article>
    <button class="button button-primary" type="button" data-t="receipt-close">閉じる</button>
  </div>`;
}

function renderReceipts() {
  const receipts = state.receipts;
  return frame(`<div class="tribute-receipts">
    <p class="tribute-note">献上レシートは、あなたにだけ見えます。譲渡も換金もできません。</p>
    ${receipts.status === "loading" && !receipts.items.length ? `<p class="tribute-empty">レシートを読み込んでいます…</p>`
    : receipts.items.length ? `<div class="tribute-receipt-list">${receipts.items.map((receipt) => `<article class="tribute-receipt is-small">
        <header><span>${escapeHtml(KIND_LABELS[receipt.kind] || "献上")}</span><b>No.${String(receipt.receiptNo).padStart(5, "0")}</b></header>
        <p class="tribute-receipt-to">${sigil(receipt)} ${escapeHtml(receipt.personaName)} ${disclosureTag(receipt.disclosure)}</p>
        <strong class="tribute-receipt-amount">${escapeHtml(formatPay(receipt.amount))}</strong>
        <footer>${escapeHtml(formatDateTime(receipt.createdAt))} ・ ${Number(receipt.pairCount)}回目</footer>
      </article>`).join("")}</div>${receipts.more ? `<button class="button button-ghost" type="button" data-t="receipts-more">もっと見る</button>` : ""}`
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
  return frame(`<div class="tribute-ranking">
    <p class="tribute-note">管理人番付：今月の異なる財布の人数、次に番付加算（同じ組で1日500 Payまで）で並べます。実際の献上額とレシートは制限しません。</p>
    ${ranking.status === "loading" ? `<p class="tribute-empty">番付を読み込んでいます…</p>` : ranking.managers.length
    ? `<ol class="tribute-manager-ranking">${ranking.managers.map((row) => `<li class="${row.mine ? "is-mine" : ""}"><b>${row.rank}</b>
        <button type="button" data-t="open-manager" data-id="${escapeHtml(row.publicManagerId)}">${sigil(row)}<span><strong>${escapeHtml(row.personaName)}</strong>${disclosureTag(row.disclosure)}${honorTag(row.honor)}</span></button>
        <em>${row.payers}人 ・ ${escapeHtml(formatPay(row.rankScore))}</em></li>`).join("")}</ol>`
    : `<p class="tribute-empty">今月の番付はまだありません。</p>`}
  </div>`, { title: "番付" });
}

function renderFund() {
  const data = state.fund.data;
  if (!data) return frame(`<p class="tribute-empty">${state.fund.status === "error" ? "界隈基金を開けませんでした。" : "界隈基金を読み込んでいます…"}</p>`, { title: "界隈基金" });
  const { fund, me, tiers, monthKey } = data;
  const honor = me.honor;
  const canOffer = me.googleProtected && me.eligible && me.offerable >= 10;
  return frame(`<div class="tribute-fund">
    <section class="tribute-panel">
      <span class="tribute-eyebrow">${escapeHtml(monthKey.replace("-", "年"))}月</span><h2>界隈基金</h2>
      <p>管理人が受け取った献上の一部を「上納」すると、80%は消却、20%がその月の基金に積まれます。基金は献上手数料の補填（手数料の半分・最大10 Pay・手数料は最低1 Pay残す）だけに使い、管理人へ直接配りません。</p>
      <dl class="tribute-facts">
        <div><dt>基金残高</dt><dd>${escapeHtml(formatPay(fund.balance))}</dd></div>
        <div><dt>今月の積み立て</dt><dd>${escapeHtml(formatPay(fund.contributed))}</dd></div>
        <div><dt>今月の消却</dt><dd>${escapeHtml(formatPay(fund.burned))}</dd></div>
        <div><dt>補填</dt><dd>${escapeHtml(formatPay(fund.subsidized))}（${fund.subsidyCount}件）</dd></div>
      </dl>
      <p>今月の方針：<b>${escapeHtml(POLICY_LABELS[fund.policy] || "両方")}</b>（両方 ${fund.votes.both} ・ 初めて ${fund.votes.first} ・ 続く ${fund.votes.renewal}）</p>
    </section>
    <section class="tribute-panel">
      <h2>あなたの上納</h2>
      <dl class="tribute-facts">
        <div><dt>今月の献上</dt><dd>${me.tributeCount}回 ・ ${me.payers}人</dd></div>
        <div><dt>受取（手数料後）</dt><dd>${escapeHtml(formatPay(me.receivedNet))}</dd></div>
        <div><dt>上納済み</dt><dd>${escapeHtml(formatPay(me.offered))}</dd></div>
        <div><dt>上納できる</dt><dd>${escapeHtml(formatPay(me.offerable))}</dd></div>
      </dl>
      ${!me.googleProtected ? `<p class="tribute-note">上納は、AnjuPayウォレットでGoogleによる保護をしてから使えます。</p>` : ""}
      ${!me.eligible ? `<p class="tribute-note">上納できるのは、今月3人以上から5回以上の献上を受けた管理人です。</p>` : ""}
      <form class="tribute-inline-form" data-form="offer">
        <label><span>上納する額（10 Pay から）</span><input name="amount" type="number" inputmode="numeric" min="10" max="${me.offerable}" step="1" ${canOffer ? "" : "disabled"} /></label>
        <button class="button button-primary button-small" type="submit" ${canOffer && !state.busy ? "" : "disabled"}>上納する</button>
      </form>
      <ul class="tribute-tiers">${tiers.map((tier) => `<li class="${honor.tier?.tierId === tier.id ? "is-current" : ""}"><b>${escapeHtml(tier.label)}</b><span>${escapeHtml(formatPay(tier.threshold))}</span><small>推薦 ${tier.recommendationSlots}件・方針へ1票</small></li>`).join("")}</ul>
      ${honor.tier ? `<div class="tribute-honor">
        <p>今月の称号：<b>${escapeHtml(honor.tier.label)}</b>（管理人カードに表示）</p>
        <div class="tribute-radio-row">${Object.entries(POLICY_LABELS).map(([policy, label]) => `<button type="button" class="tribute-policy ${honor.vote === policy ? "is-selected" : ""}" data-t="vote" data-policy="${policy}" aria-pressed="${honor.vote === policy}">${escapeHtml(label)}</button>`).join("")}</div>
        <p>推薦（${honor.recommendations.length} / ${honor.tier.recommendationSlots}）：${honor.recommendations.length ? honor.recommendations.map((row) => `<button type="button" class="tribute-link" data-t="open-manager" data-id="${escapeHtml(row.publicManagerId)}">${escapeHtml(row.personaName)}</button>`).join("・") : "管理人カードから推薦できます。"}</p>
      </div>` : ""}
    </section>
  </div>`, { title: "界隈基金" });
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
    fund: renderFund,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderHub)();
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

function applyState(payload) {
  state.ageConfirmed = payload.ageConfirmed === true;
  if (payload.profile) state.profile = payload.profile;
  if (Array.isArray(payload.contracts)) state.contracts = payload.contracts;
}

async function refreshState() {
  const generation = lifecycleGeneration;
  try {
    const payload = await call("state");
    if (!isCurrent(generation)) return;
    applyState(payload);
    if (["hub"].includes(state.screen)) render();
  } catch (error) {
    if (isCurrent(generation)) showToast(friendlyError(error));
  }
}

async function loadBoard() {
  const generation = lifecycleGeneration;
  state.board.status = "loading";
  render();
  try {
    const payload = await call("board", { nekamaOnly: state.board.nekamaOnly });
    if (!isCurrent(generation)) return;
    state.board = { ...state.board, status: "ready", managers: payload.managers || [], recommended: payload.recommended || [] };
  } catch (error) {
    if (!isCurrent(generation)) return;
    state.board.status = "error";
    showToast(friendlyError(error));
  }
  if (state.screen === "board") render();
}

async function openManager(publicManagerId) {
  const generation = lifecycleGeneration;
  stopThread();
  state.screen = "manager";
  state.manager = { status: "loading", publicManagerId, data: null };
  render();
  try {
    const [payload, fund] = await Promise.all([
      call("manager", { publicManagerId }),
      state.fund.data ? Promise.resolve(null) : call("fund").catch(() => null),
    ]);
    if (!isCurrent(generation)) return;
    if (fund) state.fund = { status: "ready", data: fund };
    state.manager = { status: "ready", publicManagerId, data: payload };
  } catch (error) {
    if (!isCurrent(generation)) return;
    state.manager.status = "error";
    showToast(friendlyError(error));
  }
  if (state.screen === "manager") render();
}

async function loadList(key, action, mapper) {
  const generation = lifecycleGeneration;
  state[key].status = "loading";
  render();
  try {
    const payload = await call(action);
    if (!isCurrent(generation)) return;
    state[key] = { ...state[key], status: "ready", ...mapper(payload) };
  } catch (error) {
    if (!isCurrent(generation)) return;
    state[key].status = "error";
    showToast(friendlyError(error));
  }
  render();
}

function navigate(screen) {
  if (!SCREENS.has(screen)) return;
  if (screen !== "thread") stopThread();
  state.sheet = null;
  state.screen = screen;
  window.scrollTo?.({ top: 0 });
  if (screen === "board") loadBoard();
  else if (screen === "receipts") loadList("receipts", "receipts", (payload) => ({ items: payload.receipts || [], more: payload.more === true }));
  else if (screen === "ledger") loadList("ledger", "ledger", (payload) => ({ asPayer: payload.asPayer || [], asManager: payload.asManager || [] }));
  else if (screen === "ranking") loadList("ranking", "rankings", (payload) => ({ managers: payload.managers || [], monthKey: payload.monthKey || "" }));
  else if (screen === "fund") loadList("fund", "fund", (payload) => ({ data: payload }));
  else {
    render();
    if (screen === "hub") refreshState();
  }
}

// ───────────── スレッドの購読 ─────────────

function stopThread() {
  contractUnsubscribe?.();
  eventsUnsubscribe?.();
  contractUnsubscribe = null;
  eventsUnsubscribe = null;
  window.clearTimeout(markReadTimer);
  markReadTimer = null;
}

function openThread(contractId) {
  stopThread();
  state.sheet = null;
  state.screen = "thread";
  const known = state.contracts.find((contract) => contract.contractId === contractId);
  state.thread = { contractId, raw: null, view: known || null, events: [], status: "loading" };
  render();
  if (previewScreen) {
    const fixture = previewThread(contractId);
    state.thread = { contractId, raw: fixture.raw, view: viewContract(fixture.raw, state.uid), events: fixture.events, status: "ready" };
    render();
    scrollThreadToEnd();
    return;
  }
  const generation = lifecycleGeneration;
  contractUnsubscribe = onSnapshot(doc(firestore, "tributeContracts", contractId), (snapshot) => {
    if (!isCurrent(generation) || state.thread.contractId !== contractId) return;
    if (!snapshot.exists()) return;
    state.thread.raw = snapshot.data();
    state.thread.view = viewContract(state.thread.raw, state.uid);
    state.thread.status = "ready";
    updateThreadParts();
    scheduleMarkRead();
  }, (error) => {
    if (!isCurrent(generation)) return;
    state.thread.status = "error";
    showToast(friendlyError(error, "スレッドを読み込めませんでした。"));
    render();
  });
  eventsUnsubscribe = onSnapshot(query(collection(firestore, "tributeContracts", contractId, "events"), orderBy("seq"), limitToLast(EVENTS_LIMIT)), (snapshot) => {
    if (!isCurrent(generation) || state.thread.contractId !== contractId) return;
    state.thread.events = snapshot.docs.map((entry) => entry.data());
    if (state.thread.view) updateThreadParts();
    scheduleMarkRead();
  }, () => {});
}

function scheduleMarkRead() {
  window.clearTimeout(markReadTimer);
  markReadTimer = window.setTimeout(() => {
    const view = state.thread.view;
    if (!active || state.screen !== "thread" || !view || !view.unread || document.visibilityState !== "visible") return;
    call("mark_read", { contractId: view.contractId, seq: view.eventSeq }).catch(() => {});
    const row = state.contracts.find((contract) => contract.contractId === view.contractId);
    if (row) row.unread = 0;
  }, 800);
}

// ───────────── 操作 ─────────────

async function mutate(action, payload, { success = "", after = null, form = null } = {}) {
  if (state.busy) return null;
  state.busy = action;
  const errorTarget = form?.querySelector?.("[data-form-error]")
    || (form ? layer.querySelector("[data-form-error]") : null);
  try {
    const result = await call(action, payload);
    state.busy = "";
    if (success) showToast(success);
    if (after) after(result);
    return result;
  } catch (error) {
    state.busy = "";
    const message = friendlyError(error);
    if (errorTarget?.isConnected) errorTarget.textContent = message;
    else showToast(message);
    return null;
  }
}

function contractPayload(extra = {}) {
  return { contractId: state.thread.view?.contractId || state.thread.contractId, ...extra };
}

function closeSheet() {
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
    kind: sheet.requestId ? "request" : "silent",
    requestId: sheet.requestId || undefined,
    amount: sheet.amount,
    clientRequestId: sheet.clientRequestId,
  }));
  if (!result) {
    rerenderSheet();
    return;
  }
  state.sheet = null;
  if (Number.isFinite(result.walletBalance)) {
    state.walletBalance = result.walletBalance;
    paintWallet();
  }
  state.receipt = result.receipt || null;
  rerenderSheet();
  rerenderReceipt();
  window.HariaiAudio?.playReveal?.();
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
      const result = await mutate("age_confirm", {
        version: TRIBUTE_AGE_VERSION,
        adult: form.elements.adult.checked,
        premise: form.elements.premise.checked,
      }, { form });
      if (!result) return;
      state.ageConfirmed = true;
      const payload = await call("state").catch(() => null);
      if (payload) applyState(payload);
      navigate("hub");
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
      await mutate("save_profile", {
        card: {
          personaName,
          intro: String(data.get("intro") || ""),
          disclosure: String(data.get("disclosure") || ""),
          style: String(data.get("style") || ""),
          entryFee: Number(data.get("entryFee")),
          sigil: Number(data.get("sigil") || 0),
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
    case "apply": {
      const target = state.applyTarget;
      const data = new FormData(form);
      const caps = normalizeCaps({ perTribute: data.get("perTribute"), perDay: data.get("perDay"), total: data.get("total") });
      if (!caps) return setFormError(form, "上限は「1回 ≦ 1日 ≦ 合計」になるように選んでください。");
      if (target.entryFee > caps.perTribute) return setFormError(form, "入場料が1回の上限を超えています。1回の上限を上げてください。");
      const result = await mutate("apply", {
        publicManagerId: target.publicManagerId,
        expectedEntryFee: target.entryFee,
        application: {
          caps,
          durationDays: Number(data.get("durationDays")),
          tone: String(data.get("tone") || "normal"),
          ngWords: String(data.get("ngWords") || ""),
          allowReportRequests: data.get("allowReportRequests") === "on",
          rankOptIn: data.get("rankOptIn") === "on",
          walletName: String(data.get("walletName") || ""),
        },
      }, { form, success: "申し込みました。受理を待ちます。" });
      if (result?.contract) {
        state.contracts = [result.contract, ...state.contracts.filter((row) => row.contractId !== result.contract.contractId)];
        openThread(result.contract.contractId);
      }
      return;
    }
    case "message": {
      const text = String(form.elements.text.value || "");
      if (!text.trim()) return;
      const problem = messageProblem(text, { role: view.role, ngWords: view.ngWords });
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
      if (state.walletBalance !== null && state.walletBalance < amount.value) return setFormError(form, "AnjuPay残高が足りません。");
      state.sheet = { ...state.sheet, amount: amount.value, step: "hold" };
      rerenderSheet();
      return;
    }
    case "request": {
      const amount = readAmount(form, Math.min(view.caps.perTribute, view.allowance));
      if (amount.error) return setFormError(form, amount.error);
      const note = String(form.elements.note.value || "");
      const problem = note ? messageProblem(note, { role: "manager", ngWords: view.ngWords }) : "";
      if (problem) return setFormError(form, problem);
      const result = await mutate("request", contractPayload({ amount: amount.value, note }), { form, success: "請求を送りました。" });
      if (result) closeSheet();
      return;
    }
    case "take": {
      const amount = readAmount(form, Math.min(view.escrowBalance, view.allowance));
      if (amount.error) return setFormError(form, amount.error);
      const result = await mutate("escrow_take", contractPayload({ amount: amount.value, clientRequestId: state.sheet.clientRequestId }), { form, success: "管理口座から徴収しました。" });
      if (result) closeSheet();
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
    case "caps": {
      const caps = normalizeCaps({ perTribute: form.elements.perTribute.value, perDay: form.elements.perDay.value, total: form.elements.total.value });
      if (!caps) return setFormError(form, "上限は「1回 ≦ 1日 ≦ 合計」になるように選んでください。");
      const result = await mutate("set_caps", contractPayload({ caps }), { form });
      if (result) {
        showToast(result.unchanged ? "上限は変わっていません。" : result.contract?.pendingCaps ? "下げた分はすぐ、上げた分は翌日0時から効きます。" : "上限を変更しました。");
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
    case "offer": {
      const amount = readAmount(form, state.fund.data?.me?.offerable || 0);
      if (amount.error) return setFormError(form, amount.error);
      const result = await mutate("offer", { amount: amount.value, clientRequestId: createRequestId() }, { form, success: "上納しました。" });
      if (result) {
        if (Number.isFinite(result.walletBalance)) {
    state.walletBalance = result.walletBalance;
    paintWallet();
  }
        navigate("fund");
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
    case "reload-board":
      loadBoard();
      return;
    case "toggle-nekama":
      state.board.nekamaOnly = target.checked;
      loadBoard();
      return;
    case "open-manager":
      openManager(target.dataset.id);
      return;
    case "open-apply": {
      const card = state.manager.data?.card;
      if (!card) return;
      state.applyTarget = { publicManagerId: card.publicManagerId, entryFee: card.entryFee, personaName: card.personaName, disclosure: card.disclosure, sigil: card.sigil };
      state.screen = "apply";
      render();
      return;
    }
    case "back-manager":
      if (state.applyTarget) openManager(state.applyTarget.publicManagerId);
      return;
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
      openSheet(target.dataset.sheet);
      return;
    case "sheet-close":
      closeSheet();
      return;
    case "give-request":
      openSheet("give", { requestId: target.dataset.request, amount: Number(target.dataset.amount), step: "hold" });
      return;
    case "give-back":
      state.sheet = { ...state.sheet, requestId: "", step: "amount" };
      rerenderSheet();
      return;
    case "pick-amount": {
      const input = target.closest("form")?.elements?.[target.dataset.name || "amount"];
      if (input) {
        input.value = target.dataset.amount;
        input.focus();
      }
      return;
    }
    case "decline-request":
      await mutate("decline_request", contractPayload({ requestId: target.dataset.request }));
      return;
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
    case "receipt-close":
      state.receipt = null;
      rerenderReceipt();
      return;
    case "receipts-more": {
      const last = state.receipts.items.at(-1);
      const payload = await call("receipts", { before: last?.createdAt || 0 }).catch((error) => {
        showToast(friendlyError(error));
        return null;
      });
      if (!payload) return;
      state.receipts.items = [...state.receipts.items, ...(payload.receipts || [])];
      state.receipts.more = payload.more === true;
      render();
      return;
    }
    case "vote":
      await mutate("vote", { policy: target.dataset.policy }, { success: "方針に投票しました。", after: () => navigate("fund") });
      return;
    case "recommend":
    case "unrecommend":
      await mutate(action, { publicManagerId: target.dataset.id }, {
        success: action === "recommend" ? "推薦しました。" : "推薦を外しました。",
        after: () => {
          state.fund = { status: "idle", data: null };
          openManager(target.dataset.id);
        },
      });
      return;
    case "legacy-market": {
      const destination = target.dataset.dest;
      requestHome();
      window.setTimeout(() => {
        if (destination === "rankings") window.HariaiMarket?.openRankingsFromLanding?.();
        else window.HariaiMarket?.start?.();
      }, 0);
      return;
    }
    default:
  }
}

function bindRoot(root) {
  if (!root) return;
  root.addEventListener("click", (event) => {
    if (!active) return;
    const target = event.target.closest?.("[data-t]");
    if (!target || !target.closest(".tribute-screen, .tribute-layer")) return;
    if (target.tagName === "INPUT") return;
    event.preventDefault();
    handleClick(target).finally(() => {
      if (active && ["accept", "decline", "withdraw", "terminate", "release", "toggle-accepting"].includes(target.dataset.t) && state.screen !== "thread") render();
    });
  });

  root.addEventListener("change", (event) => {
    if (!active) return;
    const target = event.target.closest?.('input[data-t="toggle-nekama"]');
    if (target) handleClick(target);
  });

  root.addEventListener("submit", (event) => {
    if (!active) return;
    const form = event.target.closest?.("form[data-form]");
    if (!form || !form.closest(".tribute-screen, .tribute-layer")) return;
    event.preventDefault();
    handleSubmit(form);
  });

  root.addEventListener("input", (event) => {
    if (!active || event.isComposing) return;
    const form = event.target.closest?.('form[data-form="message"]');
    if (form) {
      form.dataset.template = "";
      updateComposerCount(form);
    }
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
    || window.HariaiDanwakuNote?.isActive?.()
    || window.HariaiFreeTable?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiAccount?.isActive?.(),
  );
}

function paintWallet() {
  if (state.walletBalance === null) return;
  document.querySelectorAll("[data-tribute-wallet]").forEach((node) => {
    node.textContent = formatPay(state.walletBalance);
  });
}

function subscribeWallet() {
  walletUnsubscribe?.();
  walletUnsubscribe = null;
  if (previewScreen || !state.uid) return;
  walletUnsubscribe = onSnapshot(doc(firestore, "wallets", state.uid), (snapshot) => {
    if (!active) return;
    const balance = Number(snapshot.data()?.balance);
    state.walletBalance = Number.isSafeInteger(balance) ? balance : null;
    paintWallet();
  }, () => {});
}

async function start({ initialScreen = "" } = {}) {
  if (active) {
    if (initialScreen) navigate(initialScreen);
    return;
  }
  if (location.protocol === "file:") {
    showToast("お貢ぎ界隈はローカルサーバーまたは公開URLから開いてください。");
    return;
  }
  if (modeIsActiveElsewhere()) {
    showToast("ほかのモードを終了してからお貢ぎ界隈を開いてください。");
    return;
  }
  active = true;
  const generation = ++lifecycleGeneration;
  state = createState();
  setChrome("OMITSUGI / CONNECTING");
  render();
  try {
    if (previewScreen) {
      state.uid = "preview-me";
    } else {
      const user = await ensureUser();
      if (!isCurrent(generation)) return;
      state.uid = user.uid;
    }
    const payload = await call("state");
    if (!isCurrent(generation)) return;
    applyState(payload);
    setChrome();
    subscribeWallet();
    window.clearInterval(tickTimer);
    tickTimer = window.setInterval(() => {
      if (active && state.screen === "thread" && state.thread.raw) {
        state.thread.view = viewContract(state.thread.raw, state.uid);
        updateThreadParts();
      }
    }, 60_000);
    if (!state.ageConfirmed) {
      state.screen = "age";
      render();
      return;
    }
    if (previewScreen) {
      startPreview(previewScreen);
      return;
    }
    navigate(SCREENS.has(initialScreen) ? initialScreen : "hub");
  } catch (error) {
    if (!isCurrent(generation)) return;
    state.screen = "error";
    state.fatalError = friendlyError(error, "お貢ぎ界隈へ接続できませんでした。");
    setChrome("OMITSUGI / ERROR");
    render();
  }
}

function isActive() {
  return active;
}

function requestHome() {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  cancelHold();
  stopThread();
  walletUnsubscribe?.();
  walletUnsubscribe = null;
  window.clearInterval(tickTimer);
  tickTimer = null;
  state.sheet = null;
  state.receipt = null;
  layer.innerHTML = "";
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
  if (state.screen === "board") loadBoard();
  else if (state.screen === "hub") refreshState();
  else if (state.screen === "thread") navigate("hub");
});

// ───────────── 見本（localhost のみ・Firebase に触れない） ─────────────

function previewNow() {
  return Date.now();
}

const PREVIEW_MANAGER_CARD = Object.freeze({
  publicManagerId: "a1b2c3d4e5f6a1b2c3d4e5f6",
  personaName: "ミオ様",
  intro: "雑魚財布は黙って差し出せ。中身は男、分かって来な。",
  disclosure: "nekama",
  style: "harsh",
  entryFee: 10,
  sigil: 0,
  accepting: true,
  honor: { tierId: "offerer", label: "上納者" },
  recommendedCount: 2,
  activeContracts: 4,
  lastActiveAt: Date.now(),
});

function previewRaw(role, status = "active") {
  const now = previewNow();
  const me = "preview-me";
  return {
    contractId: role === "payer" ? "1".repeat(40) : status === "pending" ? "3".repeat(40) : "2".repeat(40),
    managerUid: role === "manager" ? me : "preview-other",
    payerUid: role === "payer" ? me : "preview-other",
    status,
    managerCard: role === "payer" ? PREVIEW_MANAGER_CARD : { personaName: "レイ", disclosure: "as_is", style: "cold", sigil: 2 },
    payerWalletName: role === "payer" ? "ポチ財布" : "しもべ3号",
    entryFee: 10,
    caps: { perTribute: 100, perDay: 300, total: 1_000 },
    pendingCaps: role === "payer" ? { perTribute: 300, perDay: 300, total: 1_000 } : null,
    pendingCapsEffectiveDateKey: role === "payer" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + 86_400_000)) : "",
    durationDays: 3,
    tone: "harsh",
    ngWords: ["ブス", "デブ"],
    allowReportRequests: true,
    rankOptIn: true,
    createdAt: now - 7_200_000,
    acceptedAt: status === "active" ? now - 7_000_000 : 0,
    expiresAt: status === "active" ? now + 2.5 * 86_400_000 : now + 40 * 3_600_000,
    totalTributed: 210,
    tributeCount: 3,
    todayKey: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)),
    todayTributed: 110,
    escrowBalance: 200,
    escrowWithdrawRequest: role === "manager" ? { amount: 50, requestedAt: now - 60_000 } : null,
    pendingRequests: { abcdef0123456789: { amount: 100, note: "今日の分。遅れたら倍の罵倒。", createdAt: now - 120_000 } },
    reportRequestedAt: role === "payer" ? now - 30_000 : 0,
    eventSeq: 14,
    readSeq: { manager: 12, payer: 12 },
  };
}

function previewEvents(raw) {
  const now = previewNow();
  const at = (minutes) => now - minutes * 60_000;
  if (raw.status === "pending") {
    return [{ seq: 1, type: "applied", actor: "payer", caps: raw.caps, durationDays: 3, tone: "harsh", entryFee: 10, createdAt: at(30) }];
  }
  return [
    { seq: 1, type: "applied", actor: "payer", caps: raw.caps, durationDays: 3, tone: "harsh", entryFee: 10, createdAt: at(120) },
    { seq: 2, type: "accepted", actor: "manager", expiresAt: raw.expiresAt, createdAt: at(117) },
    { seq: 3, type: "tribute", actor: "payer", kind: "entry", amount: 10, createdAt: at(117) },
    { seq: 4, type: "message", actor: "manager", text: "やっと来た。財布のくせに待たせるな。", createdAt: at(110) },
    { seq: 5, type: "message", actor: "payer", text: "遅れてすみません。", createdAt: at(108) },
    { seq: 6, type: "request", actor: "manager", requestId: "0123456789abcdef", amount: 100, note: "挨拶代わり。", createdAt: at(100) },
    { seq: 7, type: "tribute", actor: "payer", kind: "request", requestId: "0123456789abcdef", amount: 100, createdAt: at(98) },
    { seq: 8, type: "message", actor: "manager", text: "それっぽっち？まあ受け取ってやる。", createdAt: at(97) },
    { seq: 9, type: "escrow_deposit", actor: "payer", amount: 200, escrowBalance: 200, createdAt: at(60) },
    { seq: 10, type: "caps_raise_scheduled", actor: "payer", caps: { perTribute: 300, perDay: 300, total: 1_000 }, effectiveDateKey: raw.pendingCapsEffectiveDateKey || "2026-10-06", createdAt: at(40) },
    { seq: 11, type: "report_requested", actor: "manager", createdAt: at(5) },
    { seq: 12, type: "escrow_withdraw_request", actor: "payer", amount: 50, createdAt: at(1) },
    { seq: 13, type: "request", actor: "manager", requestId: "abcdef0123456789", amount: 100, note: "今日の分。遅れたら倍の罵倒。", createdAt: at(2) },
    { seq: 14, type: "message", actor: "manager", text: "中身が男だって知ってて貢ぐんだ。救いようがないね。", createdAt: at(1) },
  ];
}

function previewThread(contractId) {
  const role = contractId === "1".repeat(40) ? "payer" : "manager";
  const raw = previewRaw(role, contractId === "3".repeat(40) ? "pending" : "active");
  return { raw, events: previewEvents(raw) };
}

function previewCall(action, payload) {
  const now = previewNow();
  const monthKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date(now));
  switch (action) {
    case "state":
      return Promise.resolve({
        ok: true,
        ageConfirmed: previewScreen !== "age",
        profile: {
          walletName: "ポチ財布",
          card: { ...PREVIEW_MANAGER_CARD, personaName: "レイ", disclosure: "as_is", style: "cold", sigil: 2, mine: true },
          accepting: true,
          publicManagerId: "f".repeat(24),
          hidden: false,
          honor: null,
          counts: { payerOpen: 1, managerActive: 1, managerPending: 1 },
          receiptCount: 3,
        },
        contracts: [
          viewContract(previewRaw("payer"), "preview-me", now),
          viewContract(previewRaw("manager"), "preview-me", now),
          viewContract(previewRaw("manager", "pending"), "preview-me", now),
        ],
      });
    case "board":
      return Promise.resolve({
        ok: true,
        managers: [
          PREVIEW_MANAGER_CARD,
          { ...PREVIEW_MANAGER_CARD, publicManagerId: "b".repeat(24), personaName: "サキ", disclosure: "undisclosed", style: "cold", entryFee: 0, sigil: 1, honor: null, recommendedCount: 0, intro: "事務的に管理します。報告は毎日。" },
          { ...PREVIEW_MANAGER_CARD, publicManagerId: "c".repeat(24), personaName: "ユナ", disclosure: "as_is", style: "sweet", entryFee: 5, sigil: 3, honor: null, recommendedCount: 0, intro: "甘やかし担当。無理はさせない。" },
        ].filter((card) => !payload?.nekamaOnly || card.disclosure === "nekama"),
        recommended: [PREVIEW_MANAGER_CARD],
      });
    case "manager":
      return Promise.resolve({
        ok: true,
        card: PREVIEW_MANAGER_CARD,
        month: { payers: 4, tributeCount: 12 },
        openContractId: "",
        myTotal: 210,
        ranking: {
          month: [{ rank: 1, walletName: "しもべ3号", amount: 1_200, mine: false }, { rank: 2, walletName: "ポチ財布", amount: 210, mine: true }],
          lifetime: [{ rank: 1, walletName: "しもべ3号", amount: 5_400, mine: false }, { rank: 2, walletName: "ポチ財布", amount: 210, mine: true }],
        },
      });
    case "receipts":
      return Promise.resolve({
        ok: true,
        receipts: [
          { receiptId: "r3", receiptNo: 3, kind: "request", amount: 100, personaName: "ミオ様", disclosure: "nekama", sigil: 0, pairCount: 3, createdAt: now - 98 * 60_000 },
          { receiptId: "r2", receiptNo: 2, kind: "silent", amount: 100, personaName: "ミオ様", disclosure: "nekama", sigil: 0, pairCount: 2, createdAt: now - 3 * 86_400_000 },
          { receiptId: "r1", receiptNo: 1, kind: "entry", amount: 10, personaName: "ミオ様", disclosure: "nekama", sigil: 0, pairCount: 1, createdAt: now - 4 * 86_400_000 },
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
      return Promise.resolve({
        ok: true,
        monthKey,
        managers: [
          { rank: 1, publicManagerId: PREVIEW_MANAGER_CARD.publicManagerId, personaName: "ミオ様", disclosure: "nekama", sigil: 0, honor: { label: "上納者" }, payers: 4, rankScore: 1_850 },
          { rank: 2, publicManagerId: "b".repeat(24), personaName: "サキ", disclosure: "undisclosed", sigil: 1, honor: null, payers: 2, rankScore: 600 },
          { rank: 3, publicManagerId: "f".repeat(24), personaName: "レイ", disclosure: "as_is", sigil: 2, honor: null, payers: 1, rankScore: 1_200, mine: true },
        ],
      });
    case "fund":
      return Promise.resolve({
        ok: true,
        monthKey,
        fund: { balance: 58, contributed: 60, burned: 240, subsidized: 2, subsidyCount: 1, policy: "first", votes: { both: 1, first: 2, renewal: 0 } },
        me: {
          googleProtected: true,
          tributeCount: 9,
          payers: 3,
          receivedNet: 1_140,
          offered: 300,
          offerable: 840,
          eligible: true,
          honor: { offered: 300, tier: { tierId: "offerer", label: "上納者", recommendationSlots: 1 }, vote: "first", recommendations: [{ publicManagerId: "b".repeat(24), personaName: "サキ" }] },
        },
        tiers: [
          { id: "offerer", label: "上納者", threshold: 300, recommendationSlots: 1 },
          { id: "grand_offerer", label: "大上納者", threshold: 1_500, recommendationSlots: 2 },
          { id: "master", label: "界隈の主", threshold: 5_000, recommendationSlots: 3 },
        ],
      });
    case "tribute":
      return Promise.resolve({
        ok: true,
        walletBalance: (state.walletBalance ?? 1_000) - Number(payload.amount || 0),
        receipt: { receiptId: "preview", receiptNo: 4, kind: payload.kind, amount: Number(payload.amount), personaName: "ミオ様", disclosure: "nekama", sigil: 0, pairCount: 4, createdAt: now },
      });
    case "age_confirm":
      return Promise.resolve({ ok: true });
    default:
      showToast("見本では送信しません。");
      return Promise.resolve(null).then(() => {
        throw Object.assign(new Error("見本では送信しません。"), { code: "preview" });
      });
  }
}

function startPreview(screen) {
  state.walletBalance = 1_000;
  const map = {
    hub: () => navigate("hub"),
    board: () => navigate("board"),
    manager: () => openManager(PREVIEW_MANAGER_CARD.publicManagerId),
    apply: () => {
      state.applyTarget = { ...PREVIEW_MANAGER_CARD };
      state.screen = "apply";
      render();
    },
    card: () => navigate("card"),
    "thread-payer": () => openThread("1".repeat(40)),
    "thread-manager": () => openThread("2".repeat(40)),
    "thread-pending": () => openThread("3".repeat(40)),
    give: () => {
      openThread("1".repeat(40));
      openSheet("give", { requestId: "abcdef0123456789", amount: 100, step: "hold" });
    },
    receipt: () => {
      openThread("1".repeat(40));
      state.receipt = { receiptNo: 4, kind: "request", amount: 100, personaName: "ミオ様", disclosure: "nekama", sigil: 0, pairCount: 4, createdAt: Date.now() };
      rerenderReceipt();
    },
    receipts: () => navigate("receipts"),
    ledger: () => navigate("ledger"),
    ranking: () => navigate("ranking"),
    fund: () => navigate("fund"),
  };
  (map[screen] || map.hub)();
}

window.HariaiTribute = Object.freeze({
  start,
  isActive,
  requestHome,
});
window.dispatchEvent(new Event("hariai-tribute-ready"));
