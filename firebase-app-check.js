import {
  CustomProvider,
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js";
import { appCheckRecaptchaEnterpriseSiteKey } from "./firebase-config.js?v=app-check-v3";

let appCheck = null;

function base64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function createEmulatorAppCheckToken(firebaseApp) {
  const projectId = String(firebaseApp?.options?.projectId || "");
  const appId = String(firebaseApp?.options?.appId || "");
  if (!projectId.startsWith("demo-") || !appId) {
    throw new Error("App Check emulator token requires an isolated demo project.");
  }
  const issuedAt = Math.floor(Date.now() / 1_000);
  return [
    base64UrlJson({ alg: "none", typ: "JWT" }),
    base64UrlJson({
      aud: [`projects/${projectId}`],
      exp: issuedAt + 3_600,
      iat: issuedAt,
      iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
      sub: appId,
    }),
    "emulator",
  ].join(".");
}

export function initializeHariaiAppCheck(firebaseApp) {
  if (appCheck) return appCheck;
  const isLocalhost = ["127.0.0.1", "localhost"].includes(location.hostname);
  const searchParams = new URLSearchParams(location.search);
  if (isLocalhost && searchParams.has("firebaseEmulators")) {
    const token = createEmulatorAppCheckToken(firebaseApp);
    appCheck = initializeAppCheck(firebaseApp, {
      provider: new CustomProvider({
        getToken: async () => ({
          token,
          expireTimeMillis: Date.now() + 3_600_000,
        }),
      }),
      isTokenAutoRefreshEnabled: false,
    });
    return appCheck;
  }
  // 読み取り専用previewは本番App Checkへ接続しません。
  if (isLocalhost && searchParams.has("marketPreview")) return null;
  const siteKey = String(appCheckRecaptchaEnterpriseSiteKey || "").trim();
  if (!siteKey) return null;
  if (isLocalhost && searchParams.has("appCheckDebug")) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  appCheck = initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return appCheck;
}
