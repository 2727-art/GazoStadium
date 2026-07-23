import {
  GoogleAuthProvider,
  browserLocalPersistence,
  linkWithPopup,
  onIdTokenChanged,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v2";

const appRoot = document.querySelector("#app");
const economyActionCallable = httpsCallable(functions, "economyAction");
const accountTransferCallable = httpsCallable(functions, "accountTransfer", {
  limitedUseAppCheckTokens: true,
});
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
const TRANSFER_SESSION_KEY = "hariaiActiveTransferCodeV1";

const PATRON_TIERS = Object.freeze([
  Object.freeze({ level: 0, id: "guest", label: "MARKET GUEST", threshold: 0, icon: "◇" }),
  Object.freeze({ level: 1, id: "supporter", label: "SUPPORTER", threshold: 300, icon: "✦" }),
  Object.freeze({ level: 2, id: "patron", label: "PATRON", threshold: 1_500, icon: "◆" }),
  Object.freeze({ level: 3, id: "grand_patron", label: "GRAND PATRON", threshold: 5_000, icon: "♛" }),
]);
const useAccountPreview = useOfflineMarketPreview;
const previewKind = new URLSearchParams(location.search).get("accountPreview") || "guest";

let active = false;
let countdownTimer = null;
let unsubscribeAuth = null;
let state = createState();

function createState() {
  return {
    loading: true,
    busyAction: "",
    user: null,
    balance: 0,
    patron: normalizePatronage(null),
    pendingGoogleCredential: null,
    transferCode: "",
    transferExpiresAt: 0,
    notice: "",
    error: "",
  };
}

function shared() {
  return window.HariaiApp?.shared;
}

function escapeHtml(value) {
  return shared()?.escapeHtml(value) ?? String(value);
}

function showToast(message) {
  shared()?.showToast(message);
}

function currentSeasonKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function tierForLevel(level) {
  return PATRON_TIERS.find((tier) => tier.level === Number(level)) || PATRON_TIERS[0];
}

function tierForSpent(spent) {
  return [...PATRON_TIERS].reverse().find((tier) => spent >= tier.threshold) || PATRON_TIERS[0];
}

function normalizePatronage(value) {
  const seasonKey = currentSeasonKey();
  const sameSeason = String(value?.seasonKey || "") === seasonKey;
  const seasonSpent = sameSeason
    ? Math.max(0, Math.min(5_000, Math.floor(Number(value?.seasonSpent || 0))))
    : 0;
  const tier = tierForSpent(seasonSpent);
  return {
    seasonKey,
    seasonSpent,
    tier: tier.level,
    tierId: tier.id,
    tierLabel: tier.label,
    lifetimeSpent: Math.max(0, Math.floor(Number(value?.lifetimeSpent || 0))),
  };
}

function isGoogleLinked(user = state.user) {
  return Boolean(user?.providerData?.some((provider) => provider?.providerId === "google.com"));
}

function requireCurrentAccount({ google = false, anonymous = false } = {}) {
  if (useAccountPreview) return state.user;
  const current = auth.currentUser;
  if (!current || !state.user || current.uid !== state.user.uid) {
    throw new Error("ログイン状態が別のタブで変わりました。画面を開き直してから操作してください。");
  }
  if (google && !isGoogleLinked(current)) {
    throw new Error("Google保護状態を確認できません。画面を開き直してください。");
  }
  if (anonymous && current.isAnonymous !== true) {
    throw new Error("コードの復元先には、新しいゲストデータを使用してください。");
  }
  return current;
}

function requireOperationUid(uid) {
  if (!useAccountPreview && auth.currentUser?.uid !== uid) {
    throw new Error("操作中にログイン状態が変わりました。新しいアカウント情報を読み直してください。");
  }
}

function detachTransferCode() {
  state.transferCode = "";
  state.transferExpiresAt = 0;
}

function clearTransferCode() {
  detachTransferCode();
  try {
    sessionStorage.removeItem(TRANSFER_SESSION_KEY);
  } catch {
    // Session storage can be unavailable in hardened privacy modes.
  }
}

function persistTransferCode() {
  if (!state.user?.uid || !state.transferCode || state.transferExpiresAt <= Date.now()) return;
  try {
    sessionStorage.setItem(TRANSFER_SESSION_KEY, JSON.stringify({
      uid: state.user.uid,
      code: state.transferCode,
      expiresAt: state.transferExpiresAt,
    }));
  } catch {
    // The visible code remains usable even when this convenience storage is unavailable.
  }
}

function restoreTransferCode(uid) {
  detachTransferCode();
  try {
    const saved = JSON.parse(sessionStorage.getItem(TRANSFER_SESSION_KEY) || "null");
    if (saved?.uid === uid && typeof saved.code === "string" && Number(saved.expiresAt) > Date.now()) {
      state.transferCode = saved.code;
      state.transferExpiresAt = Number(saved.expiresAt);
      return;
    }
    if (saved) sessionStorage.removeItem(TRANSFER_SESSION_KEY);
  } catch {
    try {
      sessionStorage.removeItem(TRANSFER_SESSION_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
}

function maskedEmail(user = state.user) {
  const email = String(user?.providerData?.find((provider) => provider?.providerId === "google.com")?.email || "");
  const [name, domain] = email.split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}${name.length > 2 ? "•••" : ""}@${domain}`;
}

function accountKind() {
  if (isGoogleLinked()) return "protected";
  if (state.user && state.user.isAnonymous === false) return "transferred";
  return "guest";
}

function setAccountChrome() {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = "<i></i> ACCOUNT";
  if (privacy) privacy.textContent = "認証情報は非公開";
  if (footerItems[0]) footerItems[0].textContent = "ACCOUNT PROTECTION + VALUE MARKET PATRON";
  if (footerItems[1]) footerItems[1].textContent = "Google情報・匿名UID・引き継ぎコードは他プレイヤーへ公開しません";
}

function modesAreActive() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiTeam?.isActive?.()
    || window.HariaiRoyale?.isActive?.()
    || window.HariaiMarket?.isActive?.(),
  );
}

async function ensureUser() {
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady?.();
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function loadAccountData({ notice = "" } = {}) {
  if (useAccountPreview) {
    const protectedPreview = previewKind === "protected";
    state.user = {
      uid: "local-account-preview",
      isAnonymous: !protectedPreview,
      providerData: protectedPreview ? [{ providerId: "google.com", email: "player@example.com" }] : [],
    };
    state.balance = protectedPreview ? 6_400 : 2_100;
    state.patron = normalizePatronage(protectedPreview
      ? { seasonKey: currentSeasonKey(), seasonSpent: 1_500, lifetimeSpent: 4_800 }
      : null);
    if (protectedPreview) clearTransferCode();
    else restoreTransferCode(state.user.uid);
    state.loading = false;
    state.notice = notice;
    render();
    return;
  }
  state.loading = true;
  state.error = "";
  render();
  const previousUid = state.user?.uid || "";
  try {
    const user = await ensureUser();
    state.user = user;
    if (previousUid && previousUid !== user.uid) {
      state.balance = 0;
      state.patron = normalizePatronage(null);
    }
    if (isGoogleLinked(user)) clearTransferCode();
    else restoreTransferCode(user.uid);
    const response = await economyActionCallable({ action: "initialize" });
    state.balance = Math.max(0, Math.floor(Number(response.data?.balance || 0)));
    state.patron = normalizePatronage(response.data?.patron);
    state.notice = notice;
  } catch (error) {
    state.balance = 0;
    state.patron = normalizePatronage(null);
    throw error;
  } finally {
    state.loading = false;
    render();
  }
}

function renderAccountStatus() {
  const kind = accountKind();
  const status = kind === "protected"
    ? {
      className: "is-protected",
      eyebrow: "GOOGLE PROTECTED",
      title: "ゲームデータは保護済みです",
      copy: `${maskedEmail() || "Googleアカウント"}で別端末から同じデータを開けます。`,
      icon: "✓",
    }
    : kind === "transferred"
      ? {
        className: "is-transferred",
        eyebrow: "TRANSFERRED GUEST",
        title: "引き継ぎコードで復元しました",
        copy: "この端末では利用できますが、Googleで保護すると再復元が簡単になります。",
        icon: "↗",
      }
      : {
        className: "is-guest",
        eyebrow: "GUEST DATA",
        title: "現在はゲストデータです",
        copy: "サイトデータを削除すると、ポイント・購入品・戦績を復元できません。",
        icon: "!",
      };
  const pendingChoice = state.pendingGoogleCredential
    ? `<div class="account-collision" role="alert">
        <strong>このGoogleアカウントには既存のゲームデータがあります</strong>
        <p>現在のゲストデータと自動合算はしません。既存データを開く場合だけ切り替えてください。</p>
        <div><button class="button button-primary" type="button" id="accountUseExistingGoogle">既存のGoogleデータを開く</button>
        <button class="button button-ghost" type="button" id="accountCancelGoogleChoice">現在のゲストデータへ戻る</button></div>
      </div>`
    : "";
  const actions = kind === "protected"
    ? `<div class="account-protected-note"><span>PRIVATE</span><p>Googleの名前・メールアドレスはゲーム内表示名やランキングへ使用しません。</p></div>`
    : `<div class="account-auth-actions">
        <button class="button button-primary" type="button" id="accountProtectGoogle" ${state.busyAction ? "disabled" : ""}>${state.busyAction === "protect" ? "Googleへ接続中…" : "Googleでこのデータを保護"}</button>
        <button class="button button-ghost" type="button" id="accountRestoreGoogle" ${state.busyAction ? "disabled" : ""}>${state.busyAction === "restore" ? "復元中…" : "別端末のGoogleデータを復元"}</button>
      </div>`;
  return `<section class="account-protection-card ${status.className}">
    <div class="account-status-icon" aria-hidden="true">${status.icon}</div>
    <div class="account-status-copy"><span>${status.eyebrow}</span><h2>${status.title}</h2><p>${status.copy}</p>${actions}
      <p class="account-device-local-note">別端末へ戻るのはポイント・購入品・実績・戦績です。プロフィール画像、対戦画像・音声、端末設定はこの端末だけに残ります。</p>
    </div>
    ${pendingChoice}
  </section>`;
}

function renderPatronage() {
  const patron = state.patron;
  const currentTier = tierForLevel(patron.tier);
  const nextTier = PATRON_TIERS.find((tier) => tier.level > currentTier.level) || currentTier;
  const nextCost = Math.max(0, nextTier.threshold - patron.seasonSpent);
  const progressMaximum = Math.max(1, nextTier.threshold);
  const progress = currentTier.level === PATRON_TIERS.at(-1).level
    ? 100
    : Math.min(100, (patron.seasonSpent / progressMaximum) * 100);
  const protectedData = isGoogleLinked();
  const seasonLabel = `${patron.seasonKey.replace("-", "年")}月シーズン`;
  const tierCards = PATRON_TIERS.slice(1).map((tier) => {
    const owned = patron.tier >= tier.level;
    const required = Math.max(0, tier.threshold - patron.seasonSpent);
    const affordable = state.balance >= required;
    return `<article class="patron-tier-card tier-${tier.id} ${owned ? "is-owned" : ""}">
      <span class="patron-tier-icon" aria-hidden="true">${tier.icon}</span>
      <div><small>LEVEL ${tier.level}</small><h3>${tier.label}</h3><strong>${tier.threshold.toLocaleString("ja-JP")} PT</strong></div>
      <button class="button ${owned ? "button-ghost" : "button-primary"} button-small" type="button" data-patron-tier="${tier.level}"
        ${owned || !protectedData || !affordable || state.busyAction ? "disabled" : ""}>${owned ? "獲得済み" : affordable ? `${required.toLocaleString("ja-JP")}PTで昇格` : `あと${(required - state.balance).toLocaleString("ja-JP")}PT`}</button>
    </article>`;
  }).join("");
  return `<section class="account-patron-section">
    <div class="account-section-head"><div><span class="eyebrow">HIGH VALUE POINT SINK</span><h2>VALUE MARKET パトロン</h2>
      <p>ポイントをシステムへ納めて、月替わりの市場支援者バッジを獲得します。勝敗や採点には影響しません。</p></div>
      <div class="patron-current-badge tier-${currentTier.id}"><span>${currentTier.icon}</span><small>CURRENT</small><strong>${currentTier.label}</strong></div></div>
    <div class="patron-progress-card">
      <div><span>${seasonLabel}</span><strong>${patron.seasonSpent.toLocaleString("ja-JP")} PT 支援</strong></div>
      <div class="patron-progress" role="progressbar" aria-label="次のパトロンランクまでの進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
      <p>${currentTier.level === PATRON_TIERS.at(-1).level ? "今月の最高ランクを獲得済みです。" : `次の ${nextTier.label} まであと ${nextCost.toLocaleString("ja-JP")} PT`}</p>
    </div>
    ${!protectedData ? `<div class="patron-protection-lock"><strong>先にゲームデータを保護してください</strong><p>高額ポイントは取り消せないため、Google保護後に昇格できます。</p></div>` : ""}
    <div class="patron-tier-grid">${tierCards}</div>
    <p class="account-fine-print">ランクは日本時間の毎月1日に更新されます。消費ポイントの払い戻しはなく、市場ウォレットと商談相手にバッジが表示されます。累計支援 ${patron.lifetimeSpent.toLocaleString("ja-JP")} PT。</p>
  </section>`;
}

function transferCountdownText() {
  if (!state.transferCode || !state.transferExpiresAt) return "";
  const remaining = Math.max(0, state.transferExpiresAt - Date.now());
  if (!remaining) return "期限切れ";
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `残り ${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderTransfer() {
  const codePanel = state.transferCode
    ? `<div class="transfer-code-result">
        <span>ONE-TIME CODE</span><strong>${escapeHtml(state.transferCode)}</strong>
        <div><time id="transferCodeCountdown">${transferCountdownText()}</time><button class="button button-ghost button-small" type="button" id="copyTransferCode">コードをコピー</button><button class="button button-danger button-small" type="button" id="cancelTransferCode">コードを無効化</button></div>
      </div>`
    : "";
  const canRedeem = accountKind() === "guest";
  const canCreate = !isGoogleLinked();
  const sourcePanel = canCreate
    ? `<p>16文字・1回限り・10分間有効です。新しく発行すると前のコードは無効になります。</p>
        <button class="button button-cyan" type="button" id="createTransferCode" ${state.busyAction || state.transferCode ? "disabled" : ""}>${state.busyAction === "create-code" ? "発行中…" : state.transferCode ? "発行済み" : "引き継ぎコードを発行"}</button>${codePanel}`
    : `<div class="transfer-protected-note">このデータはGoogleで保護済みです。別端末ではGoogleから復元できるため、コードは発行しません。</div>`;
  return `<section class="account-transfer-section">
    <div class="account-section-head"><div><span class="eyebrow">OPTIONAL DEVICE HANDOFF</span><h2>使い捨て引き継ぎコード</h2>
      <p>Googleを使えない場合に、同じ匿名UIDを別端末で開くための補助手段です。</p></div></div>
    <div class="account-transfer-grid">
      <article><span>OLD DEVICE</span><h3>このデータからコードを発行</h3>${sourcePanel}</article>
      <article><span>NEW DEVICE</span><h3>コードで同じデータを開く</h3><p>現在この端末で使っているゲストデータとは合算されず、発行元のデータへ切り替わります。</p>
        ${canRedeem ? `<form id="redeemTransferForm"><label for="transferCodeInput">引き継ぎコード</label><input id="transferCodeInput" maxlength="19" inputmode="text" autocomplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" required />
          <button class="button button-primary" ${state.busyAction ? "disabled" : ""}>${state.busyAction === "redeem-code" ? "引き継ぎ中…" : "コードで復元"}</button></form>` : `<div class="transfer-protected-note">${accountKind() === "protected" ? "Google保護済みのデータを使用中です。別端末ではGoogleから復元してください。" : "別のコードを復元する場合は、対戦や購入をしていない新しいゲスト端末で入力してください。"}</div>`}
      </article>
    </div>
    <p class="account-fine-print">コードを知った人はゲームデータへアクセスできます。SNSやチャットへ投稿しないでください。復元後も元端末は自動ログアウトされません。</p>
  </section>`;
}

function render() {
  if (!active) return;
  if (state.loading) {
    appRoot.innerHTML = `<section class="screen account-screen account-loading"><div class="loader"></div><span class="eyebrow">ACCOUNT SECURITY</span><h1>ゲームデータを確認しています</h1><p>ポイント、保護状態、パトロンランクを読み込んでいます。</p></section>`;
    return;
  }
  const kind = accountKind();
  appRoot.innerHTML = `<section class="screen account-screen">
    <div class="account-hero">
      <div><span class="eyebrow">ACCOUNT & POINT VALUE</span><h1>データ保護・市場パトロン</h1><p>匿名の遊びやすさを保ったまま、大切なポイントを別端末でも使えるようにします。</p></div>
      <div class="account-wallet"><span>${kind === "protected" ? "PROTECTED WALLET" : kind === "transferred" ? "TRANSFERRED WALLET" : "GUEST WALLET"}</span><strong>${state.balance.toLocaleString("ja-JP")}<small>PT</small></strong><button class="button button-ghost button-small" type="button" id="accountBackHome">トップへ戻る</button></div>
    </div>
    ${state.notice ? `<div class="account-notice" role="status">${escapeHtml(state.notice)}</div>` : ""}
    ${state.error ? `<div class="account-error" role="alert">${escapeHtml(state.error)}</div>` : ""}
    ${renderAccountStatus()}
    ${renderPatronage()}
    ${renderTransfer()}
  </section>`;
  bindEvents();
  updateCountdown();
  appRoot.focus({ preventScroll: true });
}

function friendlyError(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "Google認証をキャンセルしました。";
  if (code.includes("popup-blocked")) return "Google認証のポップアップがブロックされました。ブラウザ設定を確認してください。";
  if (code.includes("operation-not-allowed")) return "Firebase AuthenticationでGoogleログインを有効にしてください。";
  if (code.includes("unauthorized-domain")) return "この公開ドメインをFirebase Authenticationの承認済みドメインへ追加してください。";
  if (code.includes("resource-exhausted")) return "操作回数が多すぎます。表示された時間をおいてください。";
  return error?.message || fallback;
}

async function protectWithGoogle() {
  if (state.busyAction || isGoogleLinked()) return;
  try {
    requireCurrentAccount();
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  state.busyAction = "protect";
  state.error = "";
  state.pendingGoogleCredential = null;
  render();
  try {
    if (useAccountPreview) {
      state.user = { ...state.user, isAnonymous: false, providerData: [{ providerId: "google.com", email: "player@example.com" }] };
      clearTransferCode();
      state.notice = "Google保護のプレビュー状態へ切り替えました。";
      return;
    }
    const user = requireCurrentAccount();
    const result = await linkWithPopup(user, googleProvider);
    state.user = result.user;
    await result.user.getIdToken(true);
    await loadAccountData({ notice: "現在のポイント・購入品・戦績を同じUIDのままGoogleで保護しました。" });
  } catch (error) {
    const credential = GoogleAuthProvider.credentialFromError(error);
    if (credential && ["auth/credential-already-in-use", "auth/email-already-in-use"].includes(error?.code)) {
      state.pendingGoogleCredential = credential;
      state.error = "";
    } else {
      state.error = friendlyError(error, "Googleでデータを保護できませんでした。");
    }
  } finally {
    state.busyAction = "";
    render();
  }
}

async function restoreWithGoogle() {
  if (state.busyAction || isGoogleLinked()) return;
  try {
    requireCurrentAccount();
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  if (!window.confirm(`この端末の現在のデータ（残高 ${state.balance.toLocaleString("ja-JP")}PT）から、選択したGoogleアカウントのデータへ切り替えます。ポイントは合算されません。続けますか？`)) return;
  state.busyAction = "restore";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.user = { ...state.user, isAnonymous: false, providerData: [{ providerId: "google.com", email: "restored@example.com" }] };
      state.balance = 6_400;
      state.patron = normalizePatronage({ seasonKey: currentSeasonKey(), seasonSpent: 1_500, lifetimeSpent: 4_800 });
      clearTransferCode();
      state.notice = "Googleデータを復元したプレビュー状態です。";
      return;
    }
    const user = requireCurrentAccount();
    const result = await linkWithPopup(user, googleProvider);
    state.user = result.user;
    await result.user.getIdToken(true);
    await loadAccountData({ notice: "このGoogleアカウントには既存データがなかったため、現在のデータを同じUIDのまま保護しました。" });
  } catch (error) {
    const credential = GoogleAuthProvider.credentialFromError(error);
    if (credential && ["auth/credential-already-in-use", "auth/email-already-in-use"].includes(error?.code)) {
      state.pendingGoogleCredential = credential;
      state.error = "";
    } else {
      state.error = friendlyError(error, "Googleデータを復元できませんでした。");
    }
  } finally {
    state.busyAction = "";
    render();
  }
}

async function useExistingGoogleData() {
  if (!state.pendingGoogleCredential || state.busyAction) return;
  if (!window.confirm("現在のゲストデータは合算せず、Google側の既存データへ切り替えます。続けますか？")) return;
  state.busyAction = "restore";
  state.error = "";
  render();
  try {
    const result = await signInWithCredential(auth, state.pendingGoogleCredential);
    state.pendingGoogleCredential = null;
    state.user = result.user;
    state.balance = 0;
    state.patron = normalizePatronage(null);
    clearTransferCode();
    await result.user.getIdToken(true);
    await loadAccountData({ notice: "Googleで保護済みのゲームデータを開きました。" });
  } catch (error) {
    state.error = friendlyError(error, "既存のGoogleデータを開けませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

function newActionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const random = crypto.getRandomValues(new Uint32Array(4));
  return [...random].map((value) => value.toString(16).padStart(8, "0")).join("");
}

async function upgradePatron(targetTier) {
  if (state.busyAction || !isGoogleLinked()) return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount({ google: true }).uid;
  } catch (error) {
    state.error = friendlyError(error, "Google保護状態を確認できませんでした。");
    render();
    return;
  }
  const target = tierForLevel(targetTier);
  const required = Math.max(0, target.threshold - state.patron.seasonSpent);
  if (!required || state.balance < required) return;
  if (!window.confirm(`${required.toLocaleString("ja-JP")}PTを払い戻しなしで消費し、今月の${target.label}へ昇格します。続けますか？`)) return;
  state.busyAction = "patron";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.balance -= required;
      state.patron = normalizePatronage({
        seasonKey: currentSeasonKey(),
        seasonSpent: target.threshold,
        lifetimeSpent: state.patron.lifetimeSpent + required,
      });
      state.notice = `${target.label}へ昇格したプレビュー状態です。`;
      return;
    }
    const response = await economyActionCallable({
      action: "patron_upgrade",
      targetTier: target.level,
      actionId: newActionId(),
    });
    requireOperationUid(operationUid);
    if (response.data?.outcome === "short") throw new Error("ポイントが不足しています。");
    state.balance = Math.max(0, Math.floor(Number(response.data?.balance || 0)));
    state.patron = normalizePatronage(response.data?.patron);
    state.notice = `${target.label}へ昇格しました。市場で新しいバッジが表示されます。`;
  } catch (error) {
    state.error = friendlyError(error, "パトロンランクを更新できませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function createTransfer() {
  if (state.busyAction || state.transferCode) return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount().uid;
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  if (!window.confirm("10分間有効な使い捨てコードを発行します。コードを他人へ見せないでください。")) return;
  state.busyAction = "create-code";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.transferCode = "7KMP-9RDX-W4HZ-3QCV";
      state.transferExpiresAt = Date.now() + (10 * 60 * 1000);
    } else {
      const response = await accountTransferCallable({ action: "create" });
      requireOperationUid(operationUid);
      state.transferCode = String(response.data?.code || "");
      state.transferExpiresAt = Number(response.data?.expiresAt || 0);
    }
    persistTransferCode();
    state.notice = "引き継ぎコードを発行しました。新しい端末で10分以内に入力してください。";
  } catch (error) {
    state.error = friendlyError(error, "引き継ぎコードを発行できませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function cancelTransfer() {
  if (state.busyAction || !state.transferCode) return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount().uid;
  } catch (error) {
    state.error = friendlyError(error, "ログイン状態を確認できませんでした。");
    render();
    return;
  }
  state.busyAction = "cancel-code";
  state.error = "";
  render();
  try {
    if (!useAccountPreview) {
      await accountTransferCallable({ action: "cancel" });
      requireOperationUid(operationUid);
    }
    clearTransferCode();
    state.notice = "引き継ぎコードを無効にしました。";
  } catch (error) {
    state.error = friendlyError(error, "引き継ぎコードを無効にできませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function redeemTransfer(code) {
  if (state.busyAction || accountKind() !== "guest") return;
  let operationUid = "";
  try {
    operationUid = requireCurrentAccount({ anonymous: true }).uid;
  } catch (error) {
    state.error = friendlyError(error, "復元先のゲスト状態を確認できませんでした。");
    render();
    return;
  }
  if (!window.confirm(`現在の端末データ（残高 ${state.balance.toLocaleString("ja-JP")}PT）から、コード発行元のデータへ切り替えます。ポイントは合算されません。続けますか？`)) return;
  state.busyAction = "redeem-code";
  state.error = "";
  render();
  try {
    if (useAccountPreview) {
      state.user = { ...state.user, isAnonymous: false, providerData: [] };
      state.balance = 3_800;
      state.patron = normalizePatronage({ seasonKey: currentSeasonKey(), seasonSpent: 300, lifetimeSpent: 900 });
      clearTransferCode();
      state.notice = "引き継ぎコードで発行元データを復元したプレビュー状態です。";
      return;
    }
    const response = await accountTransferCallable({ action: "redeem", code });
    requireOperationUid(operationUid);
    const token = String(response.data?.token || "");
    if (!token) throw new Error("引き継ぎ用の認証情報を受け取れませんでした。");
    const credential = await signInWithCustomToken(auth, token);
    state.user = credential.user;
    state.balance = 0;
    state.patron = normalizePatronage(null);
    clearTransferCode();
    await credential.user.getIdToken(true);
    await loadAccountData({ notice: "引き継ぎコードで発行元のゲームデータを復元しました。" });
  } catch (error) {
    state.error = friendlyError(error, "引き継ぎコードで復元できませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

function updateCountdown() {
  const countdown = document.querySelector("#transferCodeCountdown");
  if (!countdown) return;
  countdown.textContent = transferCountdownText();
  if (state.transferExpiresAt <= Date.now()) {
    clearTransferCode();
    window.clearInterval(countdownTimer);
    countdownTimer = null;
    render();
  }
}

function bindEvents() {
  document.querySelector("#accountBackHome")?.addEventListener("click", requestHome);
  document.querySelector("#accountProtectGoogle")?.addEventListener("click", protectWithGoogle);
  document.querySelector("#accountRestoreGoogle")?.addEventListener("click", restoreWithGoogle);
  document.querySelector("#accountUseExistingGoogle")?.addEventListener("click", useExistingGoogleData);
  document.querySelector("#accountCancelGoogleChoice")?.addEventListener("click", () => {
    state.pendingGoogleCredential = null;
    state.notice = "現在のゲストデータを維持しています。別のGoogleアカウントなら保護に使用できます。";
    render();
  });
  document.querySelectorAll("[data-patron-tier]").forEach((button) => {
    button.addEventListener("click", () => upgradePatron(Number(button.dataset.patronTier)));
  });
  document.querySelector("#createTransferCode")?.addEventListener("click", createTransfer);
  document.querySelector("#cancelTransferCode")?.addEventListener("click", cancelTransfer);
  document.querySelector("#copyTransferCode")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.transferCode);
      showToast("引き継ぎコードをコピーしました。");
    } catch {
      showToast("コピーできませんでした。コードを選択してコピーしてください。");
    }
  });
  document.querySelector("#redeemTransferForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#transferCodeInput");
    redeemTransfer(input?.value || "");
  });
  const input = document.querySelector("#transferCodeInput");
  input?.addEventListener("input", () => {
    const compact = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    input.value = compact.match(/.{1,4}/g)?.join("-") || "";
  });
}

function startCountdown() {
  window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(updateCountdown, 1000);
}

function subscribeToAuthChanges() {
  unsubscribeAuth?.();
  if (useAccountPreview) {
    unsubscribeAuth = null;
    return;
  }
  unsubscribeAuth = onIdTokenChanged(auth, (user) => {
    if (!active) return;
    const displayedUid = state.user?.uid || "";
    const nextUid = user?.uid || "";
    const authTransitionAction = ["protect", "restore", "redeem-code"].includes(state.busyAction);
    if (!displayedUid || displayedUid === nextUid || authTransitionAction) {
      state.user = user;
      if (displayedUid === nextUid && !state.loading) render();
      return;
    }
    state.user = user;
    state.balance = 0;
    state.patron = normalizePatronage(null);
    detachTransferCode();
    state.loading = true;
    state.notice = "別のタブでログイン状態が変わったため、データを読み直しています。";
    state.error = "";
    render();
    loadAccountData({ notice: "別のタブで変更されたログイン状態へ更新しました。" }).catch((error) => {
      state.loading = false;
      state.error = friendlyError(error, "変更後のアカウント情報を読み込めませんでした。");
      render();
    });
  });
}

function start() {
  if (active) return;
  if (modesAreActive()) {
    showToast("対戦・市場を終了してからデータ保護画面を開いてください。");
    return;
  }
  active = true;
  state = createState();
  subscribeToAuthChanges();
  setAccountChrome();
  render();
  startCountdown();
  loadAccountData().catch((error) => {
    state.loading = false;
    state.error = friendlyError(error, "アカウント情報を読み込めませんでした。");
    render();
  });
}

function requestHome() {
  if (!active) return;
  active = false;
  window.clearInterval(countdownTimer);
  countdownTimer = null;
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  state.pendingGoogleCredential = null;
  window.HariaiApp?.returnHome?.();
}

window.HariaiAccount = Object.freeze({
  isActive: () => active,
  requestHome,
  start,
});
window.dispatchEvent(new Event("hariai-account-ready"));
