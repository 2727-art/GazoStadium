export const STRATEGY_HIDDEN_SEARCH_LIMIT_MS = 5 * 60 * 1000;

// This clock never releases a queue or room itself. The caller must confirm a
// fenced server result before ending the local session.
function createGuard({ getContext, stop, delayUntilExpiry, latchExpiry = true, now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = clearTimeout }) {
  let timer = null;
  let expired = false;
  let disposed = false;
  let stopping = false;
  let pendingStop = null;
  let retryAt = 0;
  const cancelTimer = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const dispose = () => { disposed = true; cancelTimer(); };
  function schedule(delay) {
    cancelTimer();
    timer = setTimer(() => { timer = null; sync(); }, Math.max(1, delay));
  }
  function sync() {
    if (disposed) return;
    const context = getContext();
    if (!context.current || context.protected) { dispose(); return; }
    const time = now();
    if (!expired || !latchExpiry) {
      const delay = delayUntilExpiry(context, time);
      if (!Number.isFinite(delay)) { expired = false; cancelTimer(); return; }
      if (delay > 0) { expired = false; schedule(delay); return; }
      expired = true;
    }
    cancelTimer();
    if (stopping) return;
    if (context.busy) { schedule(1000); return; }
    if (retryAt > time) { schedule(retryAt - time); return; }
    stopping = true;
    pendingStop = Promise.resolve().then(stop).then((retryDelay) => {
      retryAt = now() + Math.max(1000, Number(retryDelay) || 20_000);
    }, () => { retryAt = now() + 20_000; }).finally(() => {
      stopping = false;
      pendingStop = null;
      sync();
    });
  }
  return { sync, dispose, retry() { retryAt = 0; sync(); },
    blocksProgress() { sync(); return expired && !disposed; },
    get expired() { return expired; }, get disposed() { return disposed; },
    get stopping() { return stopping; }, get pendingStop() { return pendingStop; } };
}

export function createStrategyHiddenSearchGuard(options) {
  let hiddenSince = null;
  const limit = options.limitMs ?? STRATEGY_HIDDEN_SEARCH_LIMIT_MS;
  return createGuard({ ...options, delayUntilExpiry(context, time) {
    // Evaluate elapsed wall time before a visible event resets the hidden clock:
    // mobile browsers can freeze all timers until the user returns.
    if (hiddenSince !== null && time - hiddenSince >= limit) return 0;
    if (context.visible) { hiddenSince = null; return Infinity; }
    if (hiddenSince === null) hiddenSince = time;
    return limit - (time - hiddenSince);
  } });
}

export function createStrategyPrestartGuard(options) {
  return createGuard({ ...options, latchExpiry: false, delayUntilExpiry(context, time) {
    const deadline = Number(context.deadline);
    return Number.isFinite(deadline) && deadline > 0 ? deadline - time : Infinity;
  } });
}

export function strategyRoomHasStarted(room) {
  if (!room || !room.hostUid || !room.guestUid) return false;
  return (room.battleReady?.[room.hostUid] === true && room.battleReady?.[room.guestUid] === true)
    || Boolean(room.moves || room.resultClaims || room.finished || room.serverFinalized);
}
