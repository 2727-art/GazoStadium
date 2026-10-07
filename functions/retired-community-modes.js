"use strict";

const RETIRED_MODE_MESSAGES = Object.freeze({
  anju_pay_flea: "AnjuPayフリマは提供を終了しました。",
  danwaku_note: "断惑NOTEは提供を終了しました。",
});

// Keep the callable endpoints available to old clients, but reject every action
// before services, wallets, or databases are touched. There is no request flag
// that can bypass retirement; the mode is selected by the server-side caller.
function throwRetiredCommunityMode(HttpsError, mode) {
  const modeId = typeof mode === "string" ? mode : "unknown";
  const message = Object.prototype.hasOwnProperty.call(RETIRED_MODE_MESSAGES, modeId)
    ? RETIRED_MODE_MESSAGES[modeId]
    : "このモードは提供を終了しました。";
  throw new HttpsError("failed-precondition", message, {
    reason: "mode-retired",
    mode: modeId,
  });
}

module.exports = Object.freeze({ throwRetiredCommunityMode });
