import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js";
import { appCheckRecaptchaEnterpriseSiteKey } from "./firebase-config.js?v=app-check-v2";

let appCheck = null;

export function initializeHariaiAppCheck(firebaseApp) {
  const siteKey = String(appCheckRecaptchaEnterpriseSiteKey || "").trim();
  if (!siteKey || appCheck) return appCheck;
  const isLocalhost = ["127.0.0.1", "localhost"].includes(location.hostname);
  const searchParams = new URLSearchParams(location.search);
  // Emulator検証中は本番App Checkへ接続しません。
  if (isLocalhost && (searchParams.has("firebaseEmulators") || searchParams.has("marketPreview"))) return null;
  if (isLocalhost && searchParams.has("appCheckDebug")) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  appCheck = initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return appCheck;
}
