import {
  connectAuthEmulator,
  getAuth,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  connectDatabaseEmulator,
  getDatabase,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import {
  connectFirestoreEmulator,
  getFirestore,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  connectFunctionsEmulator,
  getFunctions,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { firebaseApp } from "./firebase-client.js?v=app-check-v2";

const isLocalhost = ["127.0.0.1", "localhost"].includes(location.hostname);
const searchParams = new URLSearchParams(location.search);

export const useFirebaseEmulators = isLocalhost && searchParams.has("firebaseEmulators");
export const useOfflineMarketPreview = isLocalhost
  && searchParams.has("marketPreview")
  && !useFirebaseEmulators;

export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, "us-central1");

if (useFirebaseEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(database, "127.0.0.1", 9000);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
