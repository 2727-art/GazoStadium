const BATTLE_PRESENCE_MODES = new Set(["solo", "strategy"]);
const BATTLE_PRESENCE_STATES = new Set(["waiting", "playing"]);

const PRESENCE_PREFERENCES = Object.freeze([
  ["illustration", "i", "アニメ・イラスト"],
  ["live_action", "l", "実写"],
  ["both", "b", "どちらも歓迎"],
  ["unknown", "", "未分類"],
]);

export function encodePresencePreference(preference) {
  return PRESENCE_PREFERENCES.find(([key]) => key === preference)?.[1] || "";
}

export function createWaitingPreferenceCounts(value = 0) {
  return Object.fromEntries(PRESENCE_PREFERENCES.map(([key]) => [key, value]));
}

export function renderWaitingPreferenceBreakdown(counts) {
  return `<span class="solo-waiting-breakdown" data-solo-waiting-breakdown><span class="solo-waiting-heading">待機中の好み</span><span class="solo-waiting-options">${PRESENCE_PREFERENCES.map(([key, , label]) => {
    const value = counts?.[key];
    return `<span class="solo-waiting-option" data-solo-waiting-pref="${key}"${key === "unknown" && !(value > 0) ? " hidden" : ""}>${label} <b>${Number.isInteger(value) ? value : "--"}</b>人</span>`;
  }).join("")}</span></span>`;
}

export function syncWaitingPreferenceBreakdowns(root, counts) {
  root.querySelectorAll("[data-solo-waiting-pref]").forEach((element) => {
    const key = element.dataset.soloWaitingPref;
    const value = counts?.[key];
    element.querySelector("b").textContent = Number.isInteger(value) ? String(value) : "--";
    if (key === "unknown") element.hidden = !(value > 0);
  });
}

export function summarizeBattlePresence(entries, {
  mode,
  now,
  freshMs,
  ownPresenceId = "",
} = {}) {
  if (!BATTLE_PRESENCE_MODES.has(mode)) throw new TypeError("Unsupported battle presence mode.");
  const normalizedNow = Number(now);
  const normalizedFreshMs = Number(freshMs);
  if (!Number.isFinite(normalizedNow) || !Number.isFinite(normalizedFreshMs) || normalizedFreshMs < 0) {
    throw new TypeError("Battle presence freshness is invalid.");
  }

  const freshAfter = normalizedNow - normalizedFreshMs;
  const normalizedOwnPresenceId = String(ownPresenceId || "");
  let waiting = 0;
  let playing = 0;
  let ownWaiting = false;
  const waitingByPreference = createWaitingPreferenceCounts();
  const otherWaitingByPreference = createWaitingPreferenceCounts();

  Object.entries(entries || {}).forEach(([presenceId, entry]) => {
    const lastSeen = Number(entry?.lastSeen);
    if (entry?.mode !== mode
        || !BATTLE_PRESENCE_STATES.has(entry?.state)
        || !Number.isFinite(lastSeen)
        || lastSeen < freshAfter) return;
    if (entry.state === "waiting") {
      waiting += 1;
      if (normalizedOwnPresenceId && presenceId === normalizedOwnPresenceId) ownWaiting = true;
      if (mode === "solo") {
        const preference = PRESENCE_PREFERENCES.find(([, code]) => code && code === entry.pref)?.[0] || "unknown";
        waitingByPreference[preference] += 1;
        if (presenceId !== normalizedOwnPresenceId) otherWaitingByPreference[preference] += 1;
      }
    } else {
      playing += 1;
    }
  });

  return {
    waiting,
    otherWaiting: Math.max(0, waiting - (ownWaiting ? 1 : 0)),
    playing,
    ...(mode === "solo" ? { waitingByPreference, otherWaitingByPreference } : {}),
  };
}
