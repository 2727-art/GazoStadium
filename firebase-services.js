import {
  connectAuthEmulator,
  getAuth,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { database } from "./firebase-database-client.mjs?v=lazy-loading-v1";
import {
  connectFirestoreEmulator,
  getFirestore,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  connectFunctionsEmulator,
  getFunctions,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { firebaseApp } from "./firebase-client.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1";

const isLocalhost = ["127.0.0.1", "localhost"].includes(location.hostname);
const searchParams = new URLSearchParams(location.search);

export const useFirebaseEmulators = isLocalhost && searchParams.has("firebaseEmulators");
export const useOfflineMarketPreview = isLocalhost
  && (searchParams.has("marketPreview")
    || searchParams.has("aiTextTrainingPreview")
    || searchParams.has("rouletteTrainingPreview"))
  && !useFirebaseEmulators;

export const auth = getAuth(firebaseApp);
export { database };
export const firestore = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, "us-central1");

if (useFirebaseEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
