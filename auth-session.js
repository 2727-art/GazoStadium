import { browserLocalPersistence, onAuthStateChanged, setPersistence, signInAnonymously } from "./assets/firebase/firebase-auth-BU4OMZEH.js";
import { auth } from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1-lazy-loading-v1-mobile-loading-v1";
import { AUTH_SESSION_LOCK, createAuthSessionController } from "./auth-session-core.mjs?v=auth-session-v1";

const controller = createAuthSessionController({
  auth,
  storage: () => globalThis.localStorage,
  configurePersistence: () => setPersistence(auth, browserLocalPersistence),
  signInAnonymous: () => signInAnonymously(auth),
  withLock: (operation) => globalThis.navigator?.locks?.request
    ? navigator.locks.request(AUTH_SESSION_LOCK, operation)
    : operation(),
});

let recoveryDialog = null;
let activeUid = "";
let accountTransitions = 0;
let mustReload = false;

function showRecoveryHelp(error) {
  if (!String(error?.code || "").startsWith("hariai-auth/") || !document.body) return;
  if (error.code === "hariai-auth/account-changed") mustReload = true;
  if (!recoveryDialog) {
    recoveryDialog = document.createElement("dialog");
    recoveryDialog.className = "confirm-dialog";
    recoveryDialog.style.padding = "24px";
    recoveryDialog.setAttribute("aria-labelledby", "authRecoveryTitle");
    recoveryDialog.innerHTML = `<h2 id="authRecoveryTitle">ログイン情報を確認できません</h2>
      <p data-auth-recovery-message></p>
      <p>ブラウザの履歴から以前と同じURLを開いてみてください。サイトデータは削除しないでください。</p>
      <p>Google連携や有効な引き継ぎコードを使う場合は、復元手続き用のゲストを用意してウォレットへ進めます。以前のデータは削除・合算しません。</p>
      <p data-auth-recovery-error role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="button button-primary" data-auth-retry>再読み込み</button>
        <button type="button" class="button button-ghost" data-auth-recover>復元手続きへ</button>
        <button type="button" class="button button-ghost" data-auth-close>閉じる</button>
      </div>`;
    document.body.appendChild(recoveryDialog);
    recoveryDialog.addEventListener("cancel", (event) => { if (mustReload) event.preventDefault(); });
    recoveryDialog.querySelector("[data-auth-retry]").addEventListener("click", () => location.reload());
    recoveryDialog.querySelector("[data-auth-close]").addEventListener("click", () => { if (!mustReload) recoveryDialog.close(); });
    recoveryDialog.querySelector("[data-auth-recover]").addEventListener("click", async (event) => {
      if (!window.confirm("復元手続きのため、現在のログイン状態を確認し、必要なら空のゲストを作成します。ウォレットで以前連携したGoogleアカウント、または有効な引き継ぎコードを使用してください。続けますか？")) return;
      event.currentTarget.disabled = true;
      const button = event.currentTarget;
      try {
        await controller.ensureUser({ explicitNewGuest: true });
        // Reload to discard every mode's previous in-memory UID before recovery.
        sessionStorage.setItem("hariai-open-account-recovery-v1", "1");
        const destination = new URL("/", location.href);
        if (["localhost", "127.0.0.1"].includes(destination.hostname)
            && new URLSearchParams(location.search).has("firebaseEmulators")) {
          destination.searchParams.set("firebaseEmulators", "");
        }
        location.assign(destination.href);
      } catch (recoveryError) {
        recoveryDialog.querySelector("[data-auth-recovery-error]").textContent = recoveryError.message;
        button.disabled = false;
      }
    });
  }
  recoveryDialog.querySelector("[data-auth-recovery-message]").textContent = error.message;
  recoveryDialog.querySelector("[data-auth-recovery-error]").textContent = "";
  recoveryDialog.querySelector("[data-auth-close]").hidden = mustReload;
  recoveryDialog.querySelector("[data-auth-recover]").disabled = error.code !== "hariai-auth/recovery-required";
  if (!recoveryDialog.open) recoveryDialog.showModal();
}

export async function ensureHariaiUser() {
  try {
    const user = await controller.ensureUser();
    activeUid = user.uid;
    return user;
  } catch (error) {
    showRecoveryHelp(error);
    throw error;
  }
}

export function assertHariaiUser() {
  try {
    return controller.assertCurrentUser();
  } catch (error) {
    showRecoveryHelp(error);
    throw error;
  }
}

export function runHariaiAccountTransition(operation) {
  accountTransitions += 1;
  return controller.runAccountTransition(operation).then((result) => {
    activeUid = result.user.uid;
    return result;
  }).finally(() => { accountTransitions -= 1; });
}

onAuthStateChanged(auth, () => {
  // Local explicit switches are handled by the wallet. Other tabs must reload
  // before an active game can issue more actions with its previous UID.
  setTimeout(() => {
    if (!activeUid || accountTransitions || auth.currentUser?.uid === activeUid) return;
    showRecoveryHelp(Object.assign(new Error("ログイン状態が変わりました。以前の画面のまま操作を続けず、ページを再読み込みしてください。"), {
      code: "hariai-auth/account-changed",
    }));
  }, 0);
});
