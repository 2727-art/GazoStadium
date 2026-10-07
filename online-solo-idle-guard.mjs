export const SOLO_HIDDEN_WAIT_LIMIT_MS = 5 * 60 * 1000;

// This clock only decides when waiting should stop. The caller must confirm a
// fenced, waiting-only server release before cleaning up a live session.
export function createSoloHiddenWaitGuard({
  getContext,
  stopWaiting,
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  limitMs = SOLO_HIDDEN_WAIT_LIMIT_MS,
}) {
  let hiddenSince = null;
  let expired = false;
  let disposed = false;
  let stopping = false;
  let pendingStop = null;
  let timer = null;
  let retryAt = 0;

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(delay) {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      sync();
    }, Math.max(1, delay));
  }

  function dispose() {
    disposed = true;
    cancelTimer();
  }

  function sync() {
    if (disposed) return;
    const context = getContext();
    if (!context.current) {
      dispose();
      return;
    }
    const time = now();
    // Check elapsed wall time before resetting on visibility. Background tabs
    // may freeze timers and deliver visibilitychange before the overdue timer.
    if (hiddenSince !== null && time - hiddenSince >= limitMs) expired = true;
    if (!expired) {
      if (context.visible) {
        hiddenSince = null;
        cancelTimer();
        return;
      }
      if (hiddenSince === null) hiddenSince = time;
      schedule(limitMs - (time - hiddenSince));
      return;
    }
    cancelTimer();
    if (stopping) return;
    if (context.busy) {
      schedule(1000);
      return;
    }
    if (retryAt > time) {
      schedule(retryAt - time);
      return;
    }
    stopping = true;
    // Run after this turn so a simultaneous offer callback can establish its
    // protection first. stopWaiting rechecks identity and busy state itself.
    pendingStop = Promise.resolve().then(stopWaiting).then((retryDelay) => {
      retryAt = now() + Math.max(1000, Number(retryDelay) || 20_000);
    }, () => {
      // Unconfirmed cleanup is never considered a successful stop.
      retryAt = now() + 20_000;
    }).finally(() => {
      stopping = false;
      pendingStop = null;
      sync();
    });
  }

  return {
    sync,
    dispose,
    retry() {
      retryAt = 0;
      sync();
    },
    blocksNewSearch() {
      sync();
      return expired;
    },
    get expired() { return expired; },
    get disposed() { return disposed; },
    get stopping() { return stopping; },
    get pendingStop() { return pendingStop; },
  };
}
