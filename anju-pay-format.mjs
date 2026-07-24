export const ANJU_PAY_UNIT = "Pay";

function normalizeAnjuPayAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : null;
}

export function formatAnjuPayNumber(value, { sign = false, fallback = "--" } = {}) {
  const amount = normalizeAnjuPayAmount(value);
  if (amount === null) return fallback;
  const prefix = sign && amount > 0 ? "+" : "";
  return `${prefix}${amount.toLocaleString("ja-JP")}`;
}

export function formatAnjuPay(value, options = {}) {
  return `${formatAnjuPayNumber(value, options)} ${ANJU_PAY_UNIT}`;
}
