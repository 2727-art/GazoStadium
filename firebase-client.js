import {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js?v=app-check-v2";
import { initializeHariaiAppCheck } from "./firebase-app-check.js?v=app-check-v2";

// すべてのFirebaseサービスより先に、このモジュールでApp Checkを初期化します。
// 各ゲームモードは同じdefault appを共有し、個別にinitializeAppしません。
export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const hariaiAppCheck = initializeHariaiAppCheck(firebaseApp);
