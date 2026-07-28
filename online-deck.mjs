export const ONLINE_REQUIRED_IMAGE_COUNT = 5;
export const ONLINE_RESERVE_IMAGE_LIMIT = 3;
export const ONLINE_MAX_IMAGE_COUNT = ONLINE_REQUIRED_IMAGE_COUNT + ONLINE_RESERVE_IMAGE_LIMIT;

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function isOnlineDeckReady(value) {
  const count = normalizeCount(value);
  return count >= ONLINE_REQUIRED_IMAGE_COUNT && count <= ONLINE_MAX_IMAGE_COUNT;
}

export function onlineRequiredImageCount(value) {
  return Math.min(ONLINE_REQUIRED_IMAGE_COUNT, normalizeCount(value));
}

export function onlineReserveImageCount(value) {
  return Math.min(
    ONLINE_RESERVE_IMAGE_LIMIT,
    Math.max(0, normalizeCount(value) - ONLINE_REQUIRED_IMAGE_COUNT),
  );
}

export function onlineSampleFillCount(value) {
  return Math.max(0, ONLINE_REQUIRED_IMAGE_COUNT - normalizeCount(value));
}

export function getDefaultAvailableCardId(items, selectedCardId = "") {
  const cards = Array.isArray(items) ? items : [];
  const selected = cards.find((item) => item?.id === selectedCardId && item.used !== true);
  if (selected) return selected.id;
  return cards.find((item) => item?.id && item.used !== true)?.id || "";
}
