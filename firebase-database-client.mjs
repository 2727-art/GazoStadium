// One protected Realtime Database instance for the landing and lazy features.
import { connectDatabaseEmulator, getDatabase } from "./assets/firebase/firebase-database-W4EXZUO6.js";
import { firebaseApp } from "./firebase-client.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1-mobile-loading-v1";
export const database = getDatabase(firebaseApp);
if (["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).has("firebaseEmulators")) {
  connectDatabaseEmulator(database, "127.0.0.1", 9000);
}
