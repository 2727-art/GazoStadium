const BATTLE_PRESENCE_MODES = new Set(["solo", "strategy"]);
const BATTLE_PRESENCE_STATES = new Set(["waiting", "playing"]);

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

  Object.entries(entries || {}).forEach(([presenceId, entry]) => {
    const lastSeen = Number(entry?.lastSeen);
    if (entry?.mode !== mode
        || !BATTLE_PRESENCE_STATES.has(entry?.state)
        || !Number.isFinite(lastSeen)
        || lastSeen < freshAfter) return;
    if (entry.state === "waiting") {
      waiting += 1;
      if (normalizedOwnPresenceId && presenceId === normalizedOwnPresenceId) ownWaiting = true;
    } else {
      playing += 1;
    }
  });

  return {
    waiting,
    otherWaiting: Math.max(0, waiting - (ownWaiting ? 1 : 0)),
    playing,
  };
}
