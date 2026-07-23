export const MARKET_PUBLIC_PRESENCE_FRESH_MS = 60_000;

function freshTimestamp(value, now, freshAfter) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= freshAfter && timestamp <= now + 300_000;
}

export function summarizeMarketPresence(value, now = Date.now()) {
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const freshAfter = currentTime - MARKET_PUBLIC_PRESENCE_FRESH_MS;
  const queues = value?.queues && typeof value.queues === "object" ? Object.values(value.queues) : [];
  const rooms = value?.rooms && typeof value.rooms === "object" ? Object.values(value.rooms) : [];
  const summary = {
    sellerWaiting: 0,
    buyerWaiting: 0,
    negotiating: 0,
  };

  queues.forEach((entry) => {
    if (!freshTimestamp(entry?.lastSeen, currentTime, freshAfter)) return;
    if (entry?.role === "seller") summary.sellerWaiting += 1;
    else if (entry?.role === "buyer") summary.buyerWaiting += 1;
  });

  rooms.forEach((entry) => {
    if (entry?.closed === true) return;
    const sellerIsFresh = freshTimestamp(entry?.sellerSeenAt, currentTime, freshAfter);
    const buyerIsFresh = freshTimestamp(entry?.buyerSeenAt, currentTime, freshAfter);
    if (sellerIsFresh && buyerIsFresh) summary.negotiating += 1;
  });

  return summary;
}
