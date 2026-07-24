import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  functions,
} from "./firebase-services.js?v=app-check-v2";

const TIP_OPTIONS = Object.freeze([
  Object.freeze({ amount: 5, label: "おつかれ" }),
  Object.freeze({ amount: 10, label: "ナイス" }),
  Object.freeze({ amount: 20, label: "推せる" }),
]);
const economyActionCallable = httpsCallable(functions, "economyAction");
const tipStates = new Map();

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizedRecipients(value, viewerUid) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((player) => {
    const uid = String(player?.uid || "").slice(0, 128);
    if (!uid || uid === viewerUid || seen.has(uid)) return [];
    seen.add(uid);
    return [{ uid, name: String(player?.name || "PLAYER").trim().slice(0, 16) || "PLAYER" }];
  });
}

function matchKey(mode, roomId, viewerUid) {
  return `${String(mode || "")}:${String(roomId || "")}:${String(viewerUid || "")}`;
}

function stateFor(context) {
  const key = matchKey(context.mode, context.roomId, context.viewerUid);
  if (!tipStates.has(key)) {
    tipStates.set(key, {
      actionId: "",
      amount: 10,
      targetUid: context.recipients[0]?.uid || "",
      busy: false,
      eligible: false,
      eligibilityChecked: false,
      sent: false,
      loaded: false,
      loading: false,
      recipientName: "",
      sentAmount: 0,
      error: "",
    });
  }
  const value = tipStates.get(key);
  if (!context.recipients.some((recipient) => recipient.uid === value.targetUid)) {
    value.targetUid = context.recipients[0]?.uid || "";
  }
  return value;
}

function normalizeContext(value) {
  const mode = String(value?.mode || "").slice(0, 16);
  const roomId = String(value?.roomId || "").slice(0, 80);
  const viewerUid = String(value?.viewerUid || "").slice(0, 128);
  return {
    mode,
    roomId,
    viewerUid,
    recipients: normalizedRecipients(value?.recipients, viewerUid),
    balance: Number.isFinite(Number(value?.balance))
      ? Math.max(0, Math.floor(Number(value.balance)))
      : null,
  };
}

function selectedRecipient(context, value) {
  return context.recipients.find((recipient) => recipient.uid === value.targetUid)
    || context.recipients[0]
    || null;
}

function buttonText(context, value) {
  if (value.busy) return "差し入れを送っています…";
  if (value.sent) return `${value.recipientName || "参加者"}へ${value.sentAmount || value.amount}PT送付済み`;
  if (!value.eligibilityChecked) return "対戦記録を確認中…";
  if (!value.eligible) return "この試合では利用できません";
  const recipient = selectedRecipient(context, value);
  return `${recipient?.name || "参加者"}へ${value.amount}PT差し入れる`;
}

function statusText(value) {
  if (value.sent) return `${value.recipientName}へ${value.sentAmount}PTのAnjuPayを差し入れました。`;
  if (value.error) return value.error;
  if (!value.eligibilityChecked) return "検証済みの対戦記録を確認しています。";
  if (!value.eligible) return "対戦記録がまだ確定していません。相手の結果確定後に再確認してください。";
  return "勝敗・RATE・実績には影響しません。送信後の取り消しはできません。";
}

export function renderPostMatchTip(options = {}) {
  const context = normalizeContext(options);
  if (!context.mode || !context.roomId || !context.viewerUid || !context.recipients.length) return "";
  const value = stateFor(context);
  const controlsDisabled = value.busy || value.sent || !value.eligibilityChecked || !value.eligible;
  const unavailable = value.eligibilityChecked && !value.eligible && !value.sent;
  const recipient = selectedRecipient(context, value);
  const recipientControl = context.recipients.length === 1
    ? `<div class="post-match-tip-fixed-recipient"><span>差し入れ先</span><strong>${escapeHtml(recipient.name)}</strong></div>`
    : `<label class="post-match-tip-recipient"><span>差し入れ先</span><select data-post-match-tip-recipient ${controlsDisabled ? "disabled" : ""}>${context.recipients.map((candidate) => `<option value="${escapeHtml(candidate.uid)}" ${candidate.uid === value.targetUid ? "selected" : ""}>${escapeHtml(candidate.name)}</option>`).join("")}</select></label>`;
  const balance = context.balance === null
    ? ""
    : `<span class="post-match-tip-balance">AnjuPay残高 ${context.balance.toLocaleString("ja-JP")} PT</span>`;
  return `<section class="post-match-tip ${value.sent ? "is-sent" : ""}" id="postMatchTipPanel" data-post-match-tip-mode="${escapeHtml(context.mode)}" data-post-match-tip-room="${escapeHtml(context.roomId)}" data-post-match-tip-viewer="${escapeHtml(context.viewerUid)}">
    <div class="post-match-tip-head"><div><span>AFTER MATCH</span><h2>対戦後の差し入れ</h2></div>${balance}</div>
    <p>印象に残った参加者へ、自分のAnjuPayを一度だけ贈れます。</p>
    <div class="post-match-tip-controls" ${unavailable ? "hidden" : ""}>
      ${recipientControl}
      <fieldset><legend>AnjuPay</legend><div>${TIP_OPTIONS.map((option) => `<label><input type="radio" name="postMatchTipAmount" value="${option.amount}" ${option.amount === value.amount ? "checked" : ""} ${controlsDisabled ? "disabled" : ""} /><span><b>${option.amount} PT</b><small>${option.label}</small></span></label>`).join("")}</div></fieldset>
    </div>
    <button class="button button-cyan post-match-tip-send" type="button" data-post-match-tip-send ${unavailable ? "hidden" : ""} ${controlsDisabled ? "disabled" : ""}>${escapeHtml(buttonText(context, value))}</button>
    <button class="button button-ghost post-match-tip-retry" type="button" data-post-match-tip-retry ${unavailable ? "" : "hidden"}>対戦記録を再確認</button>
    <p class="post-match-tip-status" data-post-match-tip-status role="${value.error ? "alert" : "status"}" aria-live="polite">${escapeHtml(statusText(value))}</p>
  </section>`;
}

function setExitButtonsBusy(root, busy) {
  root.querySelectorAll(".gameover-actions button, .strategy-final-actions button").forEach((button) => {
    if (busy) {
      if (button.dataset.postMatchTipWasDisabled === undefined) {
        button.dataset.postMatchTipWasDisabled = button.disabled ? "1" : "0";
      }
      button.disabled = true;
    } else if (button.dataset.postMatchTipWasDisabled !== undefined) {
      button.disabled = button.dataset.postMatchTipWasDisabled === "1";
      delete button.dataset.postMatchTipWasDisabled;
    }
  });
}

function matchingPanel(root, context) {
  const panel = root.querySelector("#postMatchTipPanel");
  if (!panel
      || panel.dataset.postMatchTipMode !== context.mode
      || panel.dataset.postMatchTipRoom !== context.roomId
      || panel.dataset.postMatchTipViewer !== context.viewerUid) {
    return null;
  }
  return panel;
}

function updatePanel(root, context, value) {
  const panel = matchingPanel(root, context);
  if (!panel) return;
  const unavailable = !value.eligibilityChecked || !value.eligible;
  const permanentlyUnavailable = value.eligibilityChecked && !value.eligible && !value.sent;
  panel.classList.toggle("is-sent", value.sent);
  const controls = panel.querySelector(".post-match-tip-controls");
  if (controls) controls.hidden = permanentlyUnavailable;
  panel.querySelectorAll("input, select").forEach((control) => {
    control.disabled = value.busy || value.sent || unavailable;
  });
  const button = panel.querySelector("[data-post-match-tip-send]");
  if (button) {
    button.hidden = permanentlyUnavailable;
    button.disabled = value.busy || value.sent || unavailable;
    button.textContent = buttonText(context, value);
  }
  const retryButton = panel.querySelector("[data-post-match-tip-retry]");
  if (retryButton) retryButton.hidden = !permanentlyUnavailable;
  const status = panel.querySelector("[data-post-match-tip-status]");
  if (status) {
    status.setAttribute("role", value.error ? "alert" : "status");
    status.textContent = statusText(value);
  }
}

function callableMessage(error, fallback) {
  const message = String(error?.message || "");
  const detail = message.includes(":") ? message.slice(message.lastIndexOf(":") + 1).trim() : message;
  return (detail || fallback)
    .replaceAll("ポイント残高", "AnjuPay残高")
    .replaceAll("ポイント", "AnjuPay");
}

async function hydrateTip(root, context, value) {
  if (value.loaded || value.loading || value.sent) return;
  value.loading = true;
  try {
    const response = await economyActionCallable({
      action: "get_match_tip",
      mode: context.mode,
      roomId: context.roomId,
    });
    value.loaded = true;
    value.eligibilityChecked = true;
    value.eligible = response.data?.eligible === true;
    value.error = "";
    if (response.data?.sent === true) {
      value.sent = true;
      value.recipientName = String(response.data?.recipientName || "参加者").slice(0, 16);
      value.sentAmount = Number(response.data?.amount || 0);
    }
    updatePanel(root, context, value);
  } catch {
    value.eligibilityChecked = true;
    value.eligible = false;
    value.error = "差し入れの利用可否を確認できませんでした。";
    updatePanel(root, context, value);
  } finally {
    value.loading = false;
  }
}

async function sendTip(root, context, value, onBalanceChange) {
  if (value.busy || value.sent || !value.eligibilityChecked || !value.eligible) return;
  const recipient = selectedRecipient(context, value);
  if (!recipient || !TIP_OPTIONS.some((option) => option.amount === value.amount)) return;
  if (!window.confirm(`${recipient.name}へ${value.amount}PTのAnjuPayを差し入れます。送信後は取り消せません。`)) return;
  value.actionId ||= crypto.randomUUID();
  value.busy = true;
  value.error = "";
  setExitButtonsBusy(root, true);
  updatePanel(root, context, value);
  try {
    const response = await economyActionCallable({
      action: "send_match_tip",
      mode: context.mode,
      roomId: context.roomId,
      targetUid: recipient.uid,
      amount: value.amount,
      actionId: value.actionId,
    });
    value.sent = true;
    value.loaded = true;
    value.sentAmount = Number(response.data?.amount || value.amount);
    value.recipientName = String(response.data?.recipientName || recipient.name).slice(0, 16);
    value.error = "";
    if (Number.isFinite(Number(response.data?.balance))) {
      const balance = Math.max(0, Math.floor(Number(response.data.balance)));
      onBalanceChange?.(balance);
      const balanceLabel = matchingPanel(root, context)?.querySelector(".post-match-tip-balance");
      if (balanceLabel) balanceLabel.textContent = `AnjuPay残高 ${balance.toLocaleString("ja-JP")} PT`;
    }
  } catch (error) {
    value.error = callableMessage(error, "差し入れを送れませんでした。もう一度お試しください。");
  } finally {
    value.busy = false;
    setExitButtonsBusy(root, false);
    updatePanel(root, context, value);
  }
}

export function bindPostMatchTip(root, options = {}) {
  const context = normalizeContext(options);
  const panel = root?.querySelector ? matchingPanel(root, context) : null;
  if (!panel || !context.recipients.length) return;
  const value = stateFor(context);
  if (value.busy) setExitButtonsBusy(root, true);
  panel.querySelector("[data-post-match-tip-recipient]")?.addEventListener("change", (event) => {
    value.targetUid = String(event.currentTarget.value || "");
    value.error = "";
    updatePanel(root, context, value);
  });
  panel.querySelectorAll('input[name="postMatchTipAmount"]').forEach((input) => {
    input.addEventListener("change", () => {
      value.amount = Number(input.value);
      value.error = "";
      updatePanel(root, context, value);
    });
  });
  panel.querySelector("[data-post-match-tip-send]")?.addEventListener("click", () => {
    sendTip(root, context, value, options.onBalanceChange);
  });
  panel.querySelector("[data-post-match-tip-retry]")?.addEventListener("click", () => {
    value.loaded = false;
    value.eligibilityChecked = false;
    value.eligible = false;
    value.error = "";
    updatePanel(root, context, value);
    hydrateTip(root, context, value);
  });
  hydrateTip(root, context, value);
}

export function isPostMatchTipBusy(mode, roomId, viewerUid) {
  return tipStates.get(matchKey(mode, roomId, viewerUid))?.busy === true;
}
