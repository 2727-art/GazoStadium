"use strict";

const { anjuPayEntryId } = require("./anju-pay-ledger");

const CREATOR_CARD_REFUND_AMOUNT = 500;
const CREATOR_CARD_REFUND_FIELD = "creatorCardRetirementRefund";

// Only the administrator migration grants an entitlement. Normal wallet access
// settles an existing grant, without reading purchase or public-card records.
function planCreatorCardRefund(wallet, { grant = false, now = Date.now(), maximum = 999_999_999 } = {}) {
  const stored = wallet[CREATOR_CARD_REFUND_FIELD];
  if (!stored && !grant) return null;
  if (stored && (stored.version !== 1 || stored.amount !== CREATOR_CARD_REFUND_AMOUNT
      || !Number.isSafeInteger(stored.credited) || stored.credited < 0 || stored.credited > CREATOR_CARD_REFUND_AMOUNT
      || !Number.isSafeInteger(stored.claimCount) || stored.claimCount < 0)) {
    throw new Error("Invalid creator-card retirement refund record.");
  }
  const balance = wallet.balance;
  const reserved = wallet.reservedIncoming ?? 0;
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > maximum
      || !Number.isSafeInteger(reserved) || reserved < 0 || balance + reserved > maximum) {
    throw new Error("Invalid wallet for creator-card retirement refund.");
  }
  const previous = stored || { version: 1, amount: CREATOR_CARD_REFUND_AMOUNT, credited: 0, claimCount: 0, grantedAt: now };
  const pending = previous.amount - previous.credited;
  const credit = Math.min(pending, maximum - balance - reserved);
  if (stored && credit === 0) return null;
  const record = { ...previous, credited: previous.credited + credit,
    claimCount: previous.claimCount + (credit > 0 ? 1 : 0), updatedAt: now };
  return { credit, pending: record.amount - record.credited, record, balance: balance + credit };
}

function stageCreatorCardRefund({ transaction, walletRef, wallet, configSnapshot, now,
  stageOpening, appendEntry, metadataPatch, grant = false }) {
  const plan = planCreatorCardRefund(wallet, { grant, now });
  if (!plan) return null;
  if (plan.credit > 0) {
    stageOpening(transaction, walletRef, wallet, configSnapshot, now);
    const entryId = anjuPayEntryId(`creator-card-retirement-v1:${plan.record.claimCount}`);
    const entry = appendEntry(transaction, walletRef, wallet, configSnapshot, {
      entryId, groupId: anjuPayEntryId("creator-card-retirement-v1"),
      kind: "creator_card_refund", category: "adjustment", labelKey: "anju_pay_creator_card_refund",
      status: plan.pending ? "partial" : "refunded", delta: plan.credit, nominalAmount: plan.credit,
      balanceBefore: wallet.balance, balanceAfter: plan.balance,
      details: { productId: "feature_top_message" }, occurredAt: now,
    });
    if (!entry) throw new Error("An active AnjuPay ledger is required for creator-card refunds.");
  }
  const patch = { balance: plan.balance, [CREATOR_CARD_REFUND_FIELD]: plan.record,
    ...metadataPatch(wallet), updatedAt: now };
  transaction.set(walletRef, patch, { merge: true });
  Object.assign(wallet, patch);
  return plan;
}

module.exports = { CREATOR_CARD_REFUND_AMOUNT, CREATOR_CARD_REFUND_FIELD, planCreatorCardRefund, stageCreatorCardRefund };
