"use strict";

const crypto = require("node:crypto");
const logger = require("firebase-functions/logger");
const { HttpsError } = require("firebase-functions/v2/https");

const OPERATIONS = new Set(["wallet_initialize", "wallet_history", "transfer_create", "transfer_redeem", "transfer_cancel", "transfer_other"]);
const REASONS = new Set(["account-mismatch", "invalid-expected-uid", "wallet-invalid", "wallet-disappeared", "legacy-balance-invalid", "transfer-source-changed", "transfer-source-mismatch"]);
const ORIGINS = new Map([
  ["https://hariaistadium.com", "primary"],
  ["https://gazostadium.anjugames.workers.dev", "legacy_worker"],
  ["https://gazostadium.web.app", "firebase_web"],
  ["https://gazostadium.firebaseapp.com", "firebase_app"],
]);

function integrityError(reason, message) {
  return new HttpsError("failed-precondition", message, { reason });
}

// The authenticated UID remains authoritative. Older clients omit this hint.
function assertExpectedAccount(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "ログイン状態を確認できません。");
  if (!Object.hasOwn(request.data || {}, "expectedUid")) return;
  const expected = request.data.expectedUid;
  if (typeof expected !== "string" || !expected || expected.length > 128) {
    throw integrityError("invalid-expected-uid", "ログイン状態を確認できません。ページ全体を再読み込みしてください。");
  }
  if (expected !== request.auth.uid) {
    throw integrityError("account-mismatch", "ログイン先が画面のアカウントと一致しません。操作を止め、ページ全体を再読み込みしてください。");
  }
}

// Permit legacy integer strings, but never silently turn malformed stored money
// into zero. Missing optional fields remain compatible with older wallets.
function isStoredAmount(value, maximum) {
  return (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= maximum;
}

function assertWalletIntegrity(value, maximum) {
  if (!value || !isStoredAmount(value.balance, maximum)
      || (value.reservedIncoming !== undefined && !isStoredAmount(value.reservedIncoming, maximum))) {
    throw integrityError("wallet-invalid", "保存済みの残高情報を確認できません。データは初期化せず、確認が必要な状態で停止しました。");
  }
}

function assertLegacyBalance(value, maximum) {
  if (value?.points !== undefined && !isStoredAmount(value.points, maximum)) {
    throw integrityError("legacy-balance-invalid", "以前の残高情報を確認できません。データは初期化せず、確認が必要な状態で停止しました。");
  }
}

function accountKey(uid) {
  return typeof uid === "string" && uid
    ? crypto.createHash("sha256").update(`hariai-account-diagnostics-v1\0${uid}`).digest("hex").slice(0, 24)
    : "unknown";
}

function createAccountDiagnostics({ write = (record) => logger.write(record), now = Date.now, randomId = crypto.randomUUID } = {}) {
  return async function diagnose(request, operation, handler) {
    const startedAt = now();
    const diagnosticId = randomId();
    const provider = request.auth?.token?.firebase?.sign_in_provider;
    const base = {
      event: "account_operation_v1", diagnosticId,
      operation: OPERATIONS.has(operation) ? operation : "transfer_other",
      accountKey: accountKey(request.auth?.uid),
      provider: ["anonymous", "google.com", "custom"].includes(provider) ? provider : "other",
      origin: ORIGINS.get(request.rawRequest?.headers?.origin) || "other",
      appCheck: request.app ? "verified" : "missing",
      appCheckReplay: request.app?.alreadyConsumed === true,
      expectedAccount: Object.hasOwn(request.data || {}, "expectedUid") ? "provided" : "legacy_client",
    };
    const log = (fields) => {
      // Diagnostics must never change the result of an account operation.
      try { write({ ...base, durationMs: Math.max(0, now() - startedAt), ...fields }); } catch { /* Best effort. */ }
    };
    try {
      assertExpectedAccount(request);
      const result = await handler();
      log({ severity: "INFO", outcome: "success" });
      return result;
    } catch (error) {
      const known = error instanceof HttpsError;
      const reason = REASONS.has(error?.details?.reason) ? error.details.reason : "";
      log({ severity: known ? "WARNING" : "ERROR", outcome: "failure", code: known ? error.code : "internal", ...(reason ? { reason } : {}) });
      const message = known ? error.message : "アカウント情報を処理できませんでした。時間を置いて再度お試しください。";
      // No input, UID, credential, code, balance, or raw exception is logged.
      throw new HttpsError(known ? error.code : "internal", message, {
        ...(known && error.details && typeof error.details === "object" ? error.details : {}),
        diagnosticId,
      });
    }
  };
}

module.exports = { assertExpectedAccount, assertWalletIntegrity, assertLegacyBalance, integrityError, accountKey, createAccountDiagnostics };
