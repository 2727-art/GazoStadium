import { getApps, initializeApp } from "./assets/firebase/firebase-app-JUANUHIC.js";
import {
  browserLocalPersistence, browserPopupRedirectResolver, connectAuthEmulator,
  inMemoryPersistence, initializeAuth, setPersistence, signInWithPopup, updateCurrentUser,
} from "./assets/firebase/firebase-auth-BU4OMZEH.js";
import { auth } from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1-lazy-loading-v1-mobile-loading-v1";
import { runHariaiAccountTransition } from "./auth-session.js?v=auth-session-v1-lazy-loading-v1-mobile-loading-v1";

// Separate SDK-managed sessions: OAuth selection never changes the active game,
// and the previous session survives reloads on this browser/origin. No game data
// or raw credentials are copied into application storage or sent to the server.
function separateAuth(name, persistence) {
  const app = getApps().find(candidate => candidate.name === name)
    || initializeApp(auth.app.options, name);
  const instance = initializeAuth(app, { persistence });
  if (auth.emulatorConfig && !instance.emulatorConfig) {
    const { protocol, host, port } = auth.emulatorConfig;
    connectAuthEmulator(instance, `${protocol}://${host}:${port}`, { disableWarnings: true });
  }
  return instance;
}

let returnAuth;
let selectionAuth;
const previousAuth = () => returnAuth ||= separateAuth("hariai-account-return-v1", browserLocalPersistence);

export async function getPreviousAccount() {
  const saved = previousAuth();
  await saved.authStateReady();
  return saved.currentUser?.uid !== auth.currentUser?.uid ? saved.currentUser : null;
}

export function selectGoogleAccount(provider) {
  selectionAuth ||= separateAuth("hariai-account-selection-v1", inMemoryPersistence);
  // Called synchronously from the button click to retain popup user activation.
  return signInWithPopup(selectionAuth, provider, browserPopupRedirectResolver);
}

export function useSelectedAccount(user) {
  return updateCurrentUser(auth, user).then(() => ({ user: auth.currentUser }));
}

export function runSafeAccountSwitch(expectedUid, operation) {
  const withSwitchLock = (action) => globalThis.navigator?.locks?.request
    ? navigator.locks.request("hariai-account-switch-v1", action) : action();
  return runHariaiAccountTransition(() => withSwitchLock(async () => {
    const current = auth.currentUser;
    const assertUnchanged = () => {
      if (!current?.uid || current.uid !== expectedUid || auth.currentUser?.uid !== expectedUid) {
        throw new Error("確認中にログイン状態が変わりました。ページを再読み込みしてください。");
      }
    };
    assertUnchanged();
    // Fail closed if durable return-session storage is unavailable. This probe
    // contains no credentials; Firebase owns the actual session persistence.
    const key = "hariai-account-return-storage-check-v1";
    try {
      localStorage.setItem(key, expectedUid);
      if (localStorage.getItem(key) !== expectedUid) throw new Error("unavailable");
      localStorage.removeItem(key);
    } catch {
      throw new Error("切り替え前のログイン情報を保存できないため、切り替えを中止しました。サイトデータを削除せず、ブラウザの保存設定を確認してください。");
    }
    const saved = previousAuth();
    await saved.authStateReady();
    // Initialization can fall back to memory if storage was temporarily blocked.
    // Explicitly require durable persistence before retaining the old session.
    await setPersistence(saved, browserLocalPersistence);
    await current.getIdToken(true);
    assertUnchanged();
    const previous = saved.currentUser;
    await updateCurrentUser(saved, current);
    if (saved.currentUser?.uid !== expectedUid) throw new Error("切り替え前のログイン情報を保存できませんでした。");
    try {
      assertUnchanged();
      return await operation();
    } catch (error) {
      // Preserve the older return session when authentication itself failed.
      // If the main session changed, keep its predecessor available instead.
      if (auth.currentUser?.uid === expectedUid) await updateCurrentUser(saved, previous).catch(() => {});
      throw error;
    }
  }));
}
