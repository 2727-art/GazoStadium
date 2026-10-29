// Protected one-shot lobby counts, shared by the landing and the lazy game UI.
// Do not import firebase-services: counts need neither Auth, Firestore nor Functions.
import { get, ref } from "./assets/firebase/firebase-database-W4EXZUO6.js";
import { database } from "./firebase-database-client.mjs?v=lazy-loading-v1-mobile-loading-v1";
import { summarizeBattlePresence } from "./battle-presence-stats.mjs?v=presence-check-v1";

const params = new URLSearchParams(location.search);
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const preview = local && !params.has("firebaseEmulators") && ["marketPreview", "aiTextTrainingPreview", "rouletteTrainingPreview"].some(key => params.has(key));
let request;
let stats = { solo: { waiting: null, playing: null }, strategy: { waiting: null, playing: null } };
const getStats = () => Object.fromEntries(Object.entries(stats).map(([mode, value]) => [mode, { ...value }]));
function render() {
  for (const [mode, ids] of Object.entries({ solo: ["heroSolo", "boardSolo"], strategy: ["boardStrategy"] })) {
    for (const prefix of ids) for (const kind of ["waiting", "playing"]) {
      const element = document.getElementById(`${prefix}${kind === "waiting" ? "Waiting" : "Playing"}Count`);
      if (element) element.textContent = Number.isInteger(stats[mode][kind]) ? stats[mode][kind] : "--";
    }
  }
}
const bounded = (value, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Lobby snapshot timed out")), ms);
  Promise.resolve(value).then(resolve, reject).finally(() => clearTimeout(timer));
});
export function loadInitialLobbyStats() {
  if (new URLSearchParams(location.search).has("freeTableInvite")) return Promise.resolve(getStats());
  if (request) return request;
  request = Promise.resolve().then(async () => {
    if (preview) return;
    let offset = 0;
    try { offset = Number((await bounded(get(ref(database, ".info/serverTimeOffset")), 3000)).val()) || 0; } catch { /* Device clock fallback. */ }
    const snapshot = await bounded(get(ref(database, "online/publicPresence")), 6000);
    stats = Object.fromEntries(["solo", "strategy"].map(mode => {
      const value = summarizeBattlePresence(snapshot.val(), { mode, now: Date.now() + offset, freshMs: 45000 });
      return [mode, { waiting: value.waiting, playing: value.playing }];
    }));
  }).catch(() => {}).then(() => {
    render();
    window.dispatchEvent(new CustomEvent("hariai-lobby-stats-updated", { detail: getStats() }));
    return getStats();
  });
  return request;
}
window.HariaiLobby = Object.freeze({ getStats, load: loadInitialLobbyStats });
window.addEventListener("hariai-landing-rendered", () => { render(); loadInitialLobbyStats(); });
loadInitialLobbyStats();
