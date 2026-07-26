import {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js?v=app-check-v2";
import { initializeHariaiAppCheck } from "./firebase-app-check.js?v=app-check-v2";

const isLocalhost = ["127.0.0.1", "localhost"].includes(location.hostname);
const useFirebaseEmulators = isLocalhost
  && new URLSearchParams(location.search).has("firebaseEmulators");
const clientConfig = useFirebaseEmulators
  ? {
      apiKey: "demo-api-key",
      authDomain: "demo-gazostadium.firebaseapp.com",
      databaseURL: "https://demo-gazostadium-default-rtdb.firebaseio.com",
      projectId: "demo-gazostadium",
      storageBucket: "demo-gazostadium.appspot.com",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:0000000000000000000000",
    }
  : firebaseConfig;

// すべてのFirebaseサービスより先に、このモジュールでApp Checkを初期化します。
// 各ゲームモードは同じdefault appを共有し、個別にinitializeAppしません。
export const firebaseApp = getApps().length ? getApp() : initializeApp(clientConfig);
export const hariaiAppCheck = initializeHariaiAppCheck(firebaseApp);
