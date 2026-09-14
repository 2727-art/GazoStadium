import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { onValue, ref } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { auth, database, functions, useOfflineMarketPreview } from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1";

const callable = httpsCallable(functions, "playerSafetyAction");
const contacts = new Map();
const controls = new Set();
const LAST_CONTACT_MS = 24 * 60 * 60 * 1000;
let ownerUid = "";
let generation = 0;
let eventsUnsubscribe = null;
let panel = null;
let returnFocus = null;
let pending = null;
let operationTimer = null;
let operationBusy = false;
let authPromise = null;
let recentContact = null;
let lastEventVersion = null;

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const operationKey = (uid) => `hariai-player-safety-pending-v1:${uid}`;
const recentKey = (uid) => `hariai-player-safety-recent-v1:${uid}`;
const requestId = () => globalThis.crypto.randomUUID().replaceAll("-", "");

function readStored(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function writeStored(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch { /* Session memory still preserves retries when storage is unavailable. */ }
}

async function ensureUser() {
  if (useOfflineMarketPreview) throw new Error("プレビューでは安心設定を変更できません。");
  if (!auth.currentUser) {
    authPromise ||= signInAnonymously(auth).finally(() => { authPromise = null; });
    await authPromise;
  }
  return auth.currentUser;
}

export async function requestSafety(action, data = {}) {
  const user = await ensureUser();
  const uid = user.uid;
  const expectedGeneration = generation;
  const response = await callable({ ...data, action });
  if (auth.currentUser?.uid !== uid || generation !== expectedGeneration) {
    throw new Error("アカウントが切り替わりました。安心設定を開き直してください。");
  }
  return response.data || {};
}

function currentRecent() {
  return recentContact && recentContact.uid === ownerUid
    && Date.now() - recentContact.updatedAt < LAST_CONTACT_MS ? recentContact : null;
}

export function setActiveContact(mode, value) {
  if (!value?.roomId || !auth.currentUser?.uid) return clearActiveContact(mode);
  const contact = { ...value, mode, uid: auth.currentUser.uid };
  contacts.set(mode, contact);
  const previous = currentRecent();
  if (!previous || previous.mode !== mode || previous.roomId !== value.roomId) {
    recentContact = { uid: contact.uid, mode, roomId: value.roomId, name: String(value.name || "対戦・交流した相手").slice(0, 40), updatedAt: Date.now() };
    writeStored(recentKey(contact.uid), recentContact);
  }
}

export function clearActiveContact(mode) { contacts.delete(mode); }

export function renderBlockButton(spec, label = "このプレイヤーをブロック") {
  return `<button class="button button-ghost button-small player-safety-context-button" type="button" data-player-safety-context="${escape(encodeURIComponent(JSON.stringify(spec)))}">${escape(label)}</button>`;
}

export function renderContactControls(mode) {
  const contact = contacts.get(mode);
  if (!contact) return "";
  return `<aside class="player-safety-contact" aria-label="相手との安心設定"><span>${escape(contact.name || "この相手")}との交流</span><button class="button button-ghost button-small" type="button" data-player-safety-contact="${escape(mode)}">${contact.stopContact ? "ブロックして退出" : "この相手をブロック"}</button>${contact.leave ? `<button class="button button-ghost button-small" type="button" data-player-safety-leave="${escape(mode)}">退出する</button>` : ""}</aside>`;
}

function getPanel() {
  if (panel) return panel;
  panel = document.createElement("dialog");
  panel.id = "playerSafetyDialog";
  panel.className = "player-safety-dialog";
  panel.setAttribute("aria-labelledby", "playerSafetyTitle");
  panel.addEventListener("close", () => returnFocus?.isConnected && returnFocus.focus?.());
  document.body.appendChild(panel);
  return panel;
}

function showPanel(body) {
  const dialog = getPanel();
  if (!dialog.open) returnFocus = document.activeElement;
  dialog.innerHTML = `<div class="player-safety-card"><header><h2 id="playerSafetyTitle">安心設定</h2><button class="player-safety-close" type="button" data-player-safety-close aria-label="安心設定を閉じる">×</button></header>${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

function showError(error, fallback = "安心設定を確認できませんでした。通信状態を確認して、もう一度お試しください。") {
  const message = String(error?.message || "");
  const text = message && !/internal|INTERNAL|Firebase|permission|NOT_FOUND|not-found/i.test(message) ? message : fallback;
  showPanel(`<p role="alert">${escape(text)}</p><button class="button button-primary" type="button" data-player-safety-open>安心設定を読み直す</button>`);
}

function pendingText(value) {
  if (value?.status === "complete") return value.blocked ? "ブロックしました。" : "ブロックを解除しました。";
  if (value?.saved === true || value?.status === "pending") return "設定を保存しました。各モードに反映しています。";
  return "ブロックの保存を確認できません。再試行してください。";
}

function showOperation(value, { failed = false } = {}) {
  const saved = value?.status === "pending" || value?.status === "complete";
  const message = failed && !saved
    ? `${pending?.localContactStopped ? "交流を止めました。" : ""}設定の保存を確認できません。再試行してください。`
    : pendingText(value);
  showPanel(`<p class="player-safety-operation" role="status" aria-live="polite">${escape(message)}</p>${value?.settlementPending ? "<p>預かり金を精算しています。履歴から確認できます。</p>" : ""}${pending ? '<button class="button button-primary" type="button" data-player-safety-retry>状態を確認・再試行</button>' : '<button class="button button-primary" type="button" data-player-safety-open>ブロックしたプレイヤー</button>'}<p class="player-safety-note">確定済みの戦績・購入記録・支払済みの利用分は残ります。</p>`);
}

function operationCompleted(result, uid) {
  if (uid !== ownerUid || auth.currentUser?.uid !== uid) return;
  pending = null;
  writeStored(operationKey(uid), null);
  window.dispatchEvent(new CustomEvent("hariai-player-safety-updated", { detail: { version: result.version } }));
}

async function sendPending({ inspectFirst = false, visible = true } = {}) {
  if (!pending || operationBusy || pending.uid !== ownerUid) return;
  const saved = pending;
  const uid = saved.uid;
  operationBusy = true;
  try {
    let result = null;
    if (inspectFirst) {
      try { result = await requestSafety("get_operation", { requestId: saved.requestId }); }
      catch (error) {
        if (uid !== ownerUid) throw error;
        if (!String(error?.code || "").includes("not-found")) throw error;
      }
    }
    if (!result?.status) {
      result = await requestSafety(saved.action, saved.payload);
    }
    if (uid !== ownerUid || pending !== saved) return;
    saved.result = result;
    writeStored(operationKey(uid), saved);
    if (result.status === "complete") operationCompleted(result, uid);
    else scheduleOperationCheck();
    if (visible && panel?.open) showOperation(result);
  } catch (error) {
    if (uid !== ownerUid || pending !== saved) return;
    if (!saved.result && /invalid-argument|failed-precondition|aborted/.test(String(error?.code || ""))) {
      pending = null;
      writeStored(operationKey(uid), null);
      if (visible && panel?.open) showError(error, "設定が更新されています。安心設定を読み直してから操作してください。");
      return;
    }
    if (visible && panel?.open) showOperation(saved.result, { failed: true });
  } finally { operationBusy = false; }
}

function scheduleOperationCheck() {
  window.clearTimeout(operationTimer);
  operationTimer = window.setTimeout(() => { sendPending({ inspectFirst: true, visible: true }); }, 2500);
}

function stopContactNow(contact) {
  if (!contact || contact.uid !== ownerUid) return;
  const current = contacts.get(contact.mode);
  if (!current || current.roomId !== contact.roomId || current.uid !== contact.uid) return;
  contacts.delete(contact.mode);
  try { Promise.resolve(current.stopContact?.()).catch(() => {}); } catch { /* Server operation still proceeds. */ }
}

export async function openBlock(spec, { name = "このプレイヤー", stopContact = null } = {}) {
  if (pending) { showOperation(pending.result, { failed: !pending.result }); return; }
  const uidBefore = auth.currentUser?.uid || "";
  showPanel('<p role="status">相手を確認しています…</p>');
  try {
    const context = await requestSafety("get_context", spec);
    if (uidBefore && uidBefore !== ownerUid) return;
    if (!panel?.open) return;
    if (!context.contextId) throw new Error("この相手の情報を確認できませんでした。");
    const expectedUid = ownerUid;
    showPanel(`<h3>${escape(context.name || name)}をブロックしますか？</h3><p>すべてのモードで、この相手との新しい対戦・交流・購入を停止します。相手に通知は届きません。</p><p>確定済みの戦績・購入記録・支払済みの利用分は残ります。</p>${spec.mode === "market" ? '<p class="player-safety-note">進行中の着手料・預かり金は、現在の終了条件に従って精算されます。</p>' : ""}<div class="player-safety-actions"><button class="button button-danger" type="button" data-player-safety-confirm>${stopContact ? "ブロックして退出" : "ブロックする"}</button><button class="button button-ghost" type="button" data-player-safety-close>戻る</button></div>`);
    panel.querySelector("[data-player-safety-confirm]").addEventListener("click", () => {
      if (pending || ownerUid !== expectedUid) return;
      const id = requestId();
      pending = { uid: expectedUid, requestId: id, action: "block", localContactStopped: Boolean(stopContact), payload: { contextId: context.contextId, requestId: id, expectedVersion: context.version }, createdAt: Date.now() };
      writeStored(operationKey(expectedUid), pending);
      if (stopContact) {
        try { Promise.resolve(stopContact()).catch(() => {}); } catch { /* Continue saving even after local teardown failure. */ }
      }
      showPanel('<p role="status" aria-live="polite">ブロックを保存しています…</p>');
      sendPending();
    }, { once: true });
  } catch (error) { showError(error); }
}

function renderList(entries) {
  if (!entries.length) return "<p>ブロックしたプレイヤーはいません。</p>";
  return `<ul class="player-safety-list">${entries.map((entry) => `<li><div><strong>${escape(entry.name || "プレイヤー")}</strong><small>${escape(entry.createdAt ? new Date(Number(entry.createdAt)).toLocaleString("ja-JP") : "登録済み")}${entry.source ? ` · ${escape(sourceLabel(entry.source))}` : ""}</small></div><button class="button button-ghost button-small" type="button" data-player-safety-unblock="${escape(entry.id)}" data-version="${escape(entry.version)}">解除</button></li>`).join("")}</ul>`;
}

function sourceLabel(source) {
  return ({ solo: "通常型1on1", strategy: "戦略型1on1", free_table: "貼り合い自由卓", freeTable: "貼り合い自由卓", market: "推し値市場", flea: "AnjuPayフリマ", ai_preset: "AI文字コラ", roulette_pack: "ルーレット", card: "推しカード", ranking: "ランキング", danwaku: "断惑NOTE" })[source] || "プレイヤー設定";
}

export async function openSettings() {
  if (pending) { showOperation(pending.result, { failed: !pending.result }); return; }
  showPanel('<p role="status">安心設定を読み込んでいます…</p>');
  try {
    const result = await requestSafety("list");
    if (!panel?.open) return;
    if (result.enabled !== true) {
      showPanel('<p>ブロック機能は公開準備中です。</p><p>進行中の交流は、各モードの退出ボタンから終了できます。</p>');
      return;
    }
    const migrationNotice = result.migrationNotice === true
      ? "以前の各モードのブロック設定を引き継いでいます。一覧から確認できます。"
      : typeof result.migrationNotice === "string" ? result.migrationNotice : "";
    const recent = currentRecent();
    const contact = [...contacts.values()].find((entry) => entry.uid === ownerUid);
    showPanel(`<p>一度の設定で、すべてのモードの新しい対戦・交流・購入を停止します。</p>${contact ? renderContactControls(contact.mode) : recent ? `<section class="player-safety-recent"><h3>直前に交流した相手</h3><p>${escape(recent.name)}</p>${renderBlockButton({ mode: recent.mode, roomId: recent.roomId }, "この相手をブロック")}</section>` : ""}<h3>ブロックしたプレイヤー</h3><div data-player-safety-list>${renderList(result.entries || [])}</div>${result.cursor ? `<button class="button button-ghost" type="button" data-player-safety-more="${escape(result.cursor)}">さらに読み込む</button>` : ""}${migrationNotice ? `<p role="status">${escape(migrationNotice)}</p>` : ""}<p class="player-safety-note">解除しても相手側の設定は変わりません。顔なじみ・常連・しおりや終了した交流は自動では戻りません。公開済み情報や別アカウントまで見えなくする機能ではありません。</p>`);
  } catch (error) { showError(error); }
}

export async function filterPublicEntries(kind, entries, idField = "entryId", { mask = false } = {}) {
  if (!Array.isArray(entries) || !entries.length || !auth.currentUser || useOfflineMarketPreview) return entries || [];
  const ids = [...new Set(entries.map((entry) => String(entry?.[idField] || "")).filter(Boolean))];
  const hidden = new Set();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await requestSafety("filter_public", { kind, ids: ids.slice(offset, offset + 100) });
    (result.hiddenIds || []).forEach((id) => hidden.add(id));
  }
  if (!mask) return entries.filter((entry) => !hidden.has(String(entry?.[idField] || "")));
  return entries.map((entry) => hidden.has(String(entry?.[idField] || ""))
    ? { ...entry, name: "非表示のプレイヤー", displayName: "非表示のプレイヤー", sellerName: "非表示のプレイヤー", xHandle: "", text: "", title: "", tagline: "", pursuitLine: "", commentsEnabled: false, publicProfile: {}, safetyHidden: true }
    : entry);
}

export function observeSessionControl(mode, roomId, onUnavailable) {
  const registration = { mode, roomId, onUnavailable, uid: auth.currentUser?.uid, busy: false };
  controls.add(registration);
  return () => controls.delete(registration);
}

async function checkContacts() {
  const registered = [...controls, ...contacts.values()];
  await Promise.allSettled(registered.map(async (contact) => {
    if (contact.uid !== ownerUid || contact.busy || !contact.roomId) return;
    contact.busy = true;
    try {
      const result = await requestSafety("contact_status", { mode: contact.mode, roomId: contact.roomId });
      if (result.available === false && contact.uid === ownerUid) {
        if (contact.onUnavailable) { controls.delete(contact); contact.onUnavailable(); }
        else stopContactNow(contact);
      }
    } finally { contact.busy = false; }
  }));
}

export function bindSafetyButtons() { /* Delegation preserves existing forms and IME composition. */ }

document.addEventListener("click", async (event) => {
  const target = event.target.closest?.("button");
  if (!target) return;
  if (target.matches("[data-player-safety-open]")) { event.preventDefault(); openSettings(); }
  else if (target.matches("[data-player-safety-close]")) getPanel().close();
  else if (target.matches("[data-player-safety-retry]")) { target.disabled = true; await sendPending({ inspectFirst: true }); }
  else if (target.matches("[data-player-safety-contact]")) {
    const contact = contacts.get(target.dataset.playerSafetyContact);
    if (contact) openBlock({ mode: contact.mode, roomId: contact.roomId }, { name: contact.name, stopContact: contact.stopContact ? () => stopContactNow(contact) : null });
  } else if (target.matches("[data-player-safety-leave]")) {
    const contact = contacts.get(target.dataset.playerSafetyLeave);
    if (contact?.leave) { getPanel().close(); await contact.leave(); }
  } else if (target.matches("[data-player-safety-context]")) {
    try { openBlock(JSON.parse(decodeURIComponent(target.dataset.playerSafetyContext))); } catch (error) { showError(error); }
  } else if (target.matches("[data-player-safety-unblock]")) {
    if (pending || !window.confirm("このプレイヤーのブロックを解除しますか？")) return;
    const id = requestId();
    pending = { uid: ownerUid, requestId: id, action: "unblock", payload: { blockId: target.dataset.playerSafetyUnblock, requestId: id, expectedVersion: Number(target.dataset.version) }, createdAt: Date.now() };
    writeStored(operationKey(ownerUid), pending);
    showPanel('<p role="status">解除を保存しています…</p>');
    sendPending();
  } else if (target.matches("[data-player-safety-more]")) {
    const expectedGeneration = generation;
    target.disabled = true;
    try {
      const result = await requestSafety("list", { cursor: target.dataset.playerSafetyMore });
      if (!panel?.open || expectedGeneration !== generation) return;
      panel.querySelector("[data-player-safety-list]")?.insertAdjacentHTML("beforeend", renderList(result.entries || []));
      if (result.cursor) { target.dataset.playerSafetyMore = result.cursor; target.disabled = false; } else target.remove();
    } catch (error) { target.disabled = false; showError(error); }
  }
});

onAuthStateChanged(auth, (user) => {
  const nextUid = user?.uid || "";
  if (nextUid === ownerUid) return;
  const previousUid = ownerUid;
  generation += 1;
  ownerUid = nextUid;
  eventsUnsubscribe?.();
  eventsUnsubscribe = null;
  window.clearTimeout(operationTimer);
  operationBusy = false;
  contacts.clear();
  controls.clear();
  recentContact = nextUid ? readStored(recentKey(nextUid)) : null;
  pending = nextUid ? readStored(operationKey(nextUid)) : null;
  if (pending?.uid !== nextUid) pending = null;
  lastEventVersion = null;
  if (previousUid && panel?.open) panel.close();
  if (nextUid && !useOfflineMarketPreview) {
    eventsUnsubscribe = onValue(ref(database, `online/playerSafetyEvents/${nextUid}`), (snapshot) => {
      if (ownerUid !== nextUid) return;
      const version = Number(snapshot.val()?.version || 0);
      const changed = lastEventVersion !== null && version !== lastEventVersion;
      lastEventVersion = version;
      if (changed) {
        checkContacts();
        window.dispatchEvent(new Event("hariai-player-safety-updated"));
      }
    }, () => {});
    if (pending) sendPending({ inspectFirst: true, visible: false });
  }
  window.dispatchEvent(new Event("hariai-player-safety-auth-changed"));
});

window.addEventListener("online", () => { if (pending) sendPending({ inspectFirst: true }); });
window.HariaiPlayerSafety = Object.freeze({ openSettings, openBlock, setActiveContact, clearActiveContact, renderBlockButton, renderContactControls, bindSafetyButtons, requestSafety, filterPublicEntries, observeSessionControl });
