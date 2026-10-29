import {
  connectAuthEmulator,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "./assets/firebase/firebase-auth-BU4OMZEH.js";
import { database } from "./firebase-database-client.mjs?v=lazy-loading-v1-mobile-loading-v1";
import {
  connectFirestoreEmulator,
  getFirestore,
} from "./assets/firebase/firebase-firestore-QNR56A4P.js";
import {
  connectFunctionsEmulator,
  getFunctions,
} from "./assets/firebase/firebase-functions-TFNFZUKR.js";
import { firebaseApp } from "./firebase-client.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1-mobile-loading-v1";

const isLocalhost = ["127.0.0.1", "localhost"].includes(location.hostname);
const searchParams = new URLSearchParams(location.search);

export const useFirebaseEmulators = isLocalhost && searchParams.has("firebaseEmulators");
export const useOfflineMarketPreview = isLocalhost
  && (searchParams.has("marketPreview")
    || searchParams.has("aiTextTrainingPreview")
    || searchParams.has("rouletteTrainingPreview"))
  && !useFirebaseEmulators;

// Keep the same persistence search order as getAuth(), including existing users.
// Popup/redirect infrastructure is only needed when the user links Google.
export const auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});
export { database };
export const firestore = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, "us-central1");

if (useFirebaseEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
