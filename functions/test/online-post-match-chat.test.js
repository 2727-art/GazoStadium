const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const onlineSource = read("online.js");
const indexHtml = read("index.html");
const lifecycleModule = import(pathToFileURL(path.join(root, "online-room-lifecycle.mjs")).href);

function sourceBlock(startMarker, endMarker) {
  const start = onlineSource.indexOf(startMarker);
  const end = onlineSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source boundary: ${endMarker}`);
  return onlineSource.slice(start, end);
}

function createChatHarness(sendChat) {
  const inputListeners = {};
  const formListeners = {};
  const submitButton = { disabled: false };
  const input = {
    value: "",
    focusCalls: 0,
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: "none",
    selectionCalls: 0,
    addEventListener(type, listener) {
      inputListeners[type] = listener;
    },
    focus(options) {
      this.focusCalls += 1;
      this.lastFocusOptions = options;
    },
    setSelectionRange(start, end, direction) {
      this.selectionCalls += 1;
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
  };
  const form = {
    addEventListener(type, listener) {
      formListeners[type] = listener;
    },
    querySelector(selector) {
      if (selector === "#onlineChatInput") return input;
      if (selector === 'button[type="submit"]') return submitButton;
      return null;
    },
  };
  const state = {
    roomId: "room-a",
    chatDraft: "",
    chatDraftRevision: 0,
    chatSendInFlight: false,
  };
  const sandbox = {
    state,
    sendChat,
    scrollChat() {},
    handleRecoverableError(error) {
      throw error;
    },
    document: {
      querySelectorAll() {
        return [];
      },
      querySelector(selector) {
        if (selector === "#onlineChatInput") return input;
        if (selector === "#onlineChatForm") return form;
        if (selector === '#onlineChatForm button[type="submit"]') return submitButton;
        return null;
      },
    },
  };
  const bindingSource = sourceBlock("function bindChatEvents()", "async function handleImageInput");
  vm.runInNewContext(`${bindingSource}\nthis.bindChatEvents = bindChatEvents;`, sandbox);
  sandbox.bindChatEvents();
  const submit = () => formListeners.submit({
    preventDefault() {},
    currentTarget: form,
  });
  return {
    sandbox,
    state,
    input,
    inputListeners,
    submitButton,
    submit,
  };
}

test("timestamp-only opponent heartbeats do not update or defer the game-over UI", async () => {
  const { resolveOnlineOpponentPresence } = await lifecycleModule;
  const calls = { pill: 0, invitation: 0, close: 0 };
  const sandbox = {
    state: { screen: "gameover", opponentOnline: true },
    isCurrentRoomSetupContext: () => true,
    resolveOnlineOpponentPresence,
    refreshOpponentConnectionPill: () => { calls.pill += 1; },
    refreshEngawaInvitation: () => { calls.invitation += 1; },
    closeEngawaLocally: () => { calls.close += 1; },
  };
  const handlerSource = sourceBlock(
    "function handleOpponentPresenceValue",
    "function notifyEngawaDeparture",
  );
  vm.runInNewContext(`${handlerSource}\nthis.handleOpponentPresenceValue = handleOpponentPresenceValue;`, sandbox);

  sandbox.handleOpponentPresenceValue({}, { online: true, updatedAt: 1000 });
  sandbox.handleOpponentPresenceValue({}, { online: true, updatedAt: 2000 });

  assert.equal(sandbox.state.opponentOnline, true);
  assert.deepEqual(calls, { pill: 0, invitation: 0, close: 0 });
  assert.doesNotMatch(handlerSource, /\brender\(|scheduleEngawaAfterPostMatchTip|isPostMatchTipBusy/);
});

test("real opponent presence transitions refresh only the affected result UI", async () => {
  const { resolveOnlineOpponentPresence } = await lifecycleModule;
  const calls = { pill: 0, invitation: 0, close: 0 };
  let current = true;
  const sandbox = {
    state: { screen: "gameover", opponentOnline: true },
    isCurrentRoomSetupContext: () => current,
    resolveOnlineOpponentPresence,
    refreshOpponentConnectionPill: () => { calls.pill += 1; },
    refreshEngawaInvitation: () => { calls.invitation += 1; },
    closeEngawaLocally: () => { calls.close += 1; },
  };
  const handlerSource = sourceBlock(
    "function handleOpponentPresenceValue",
    "function notifyEngawaDeparture",
  );
  vm.runInNewContext(`${handlerSource}\nthis.handleOpponentPresenceValue = handleOpponentPresenceValue;`, sandbox);

  sandbox.handleOpponentPresenceValue({}, { online: false });
  assert.equal(sandbox.state.opponentOnline, false);
  assert.deepEqual(calls, { pill: 1, invitation: 1, close: 0 });

  sandbox.handleOpponentPresenceValue({}, { online: false, updatedAt: 2 });
  assert.deepEqual(calls, { pill: 1, invitation: 1, close: 0 });

  sandbox.handleOpponentPresenceValue({}, { online: true });
  assert.equal(sandbox.state.opponentOnline, true);
  assert.deepEqual(calls, { pill: 2, invitation: 2, close: 0 });

  sandbox.state.screen = "engawa";
  sandbox.handleOpponentPresenceValue({}, { online: false });
  assert.deepEqual(calls, { pill: 3, invitation: 2, close: 1 });

  current = false;
  sandbox.handleOpponentPresenceValue({}, { online: true });
  assert.equal(sandbox.state.opponentOnline, false);
  assert.deepEqual(calls, { pill: 3, invitation: 2, close: 1 });
});

test("the presence refresh replaces only the invitation and preserves the chat input node", () => {
  const input = {
    value: "変換中の下書き",
    selectionStart: 4,
    selectionEnd: 4,
  };
  const nextInvitation = { id: "next-invitation" };
  let currentInvitation = {
    replaceWith(next) {
      currentInvitation = next;
    },
  };
  let boundRoot = null;
  const appRoot = {
    querySelector(selector) {
      if (selector === "[data-engawa-invitation]") return currentInvitation;
      if (selector === "#onlineChatInput") return input;
      return null;
    },
  };
  const wrapper = {
    innerHTML: "",
    querySelector: () => nextInvitation,
  };
  const sandbox = {
    state: { screen: "gameover" },
    appRoot,
    document: { createElement: () => wrapper },
    renderEngawaInvitation: () => '<section data-engawa-invitation></section>',
    bindEngawaInvitationEvents: (rootNode) => { boundRoot = rootNode; },
  };
  const refreshSource = sourceBlock(
    "function refreshEngawaInvitation",
    "function refreshOpponentConnectionPill",
  );
  vm.runInNewContext(`${refreshSource}\nthis.refreshEngawaInvitation = refreshEngawaInvitation;`, sandbox);
  const originalInput = appRoot.querySelector("#onlineChatInput");

  sandbox.refreshEngawaInvitation();

  assert.equal(currentInvitation, nextInvitation);
  assert.equal(boundRoot, nextInvitation);
  assert.equal(appRoot.querySelector("#onlineChatInput"), originalInput);
  assert.equal(input.value, "変換中の下書き");
  assert.equal(input.selectionStart, 4);
  assert.equal(input.selectionEnd, 4);
  assert.doesNotMatch(refreshSource, /appRoot\.innerHTML|bindScreenEvents|renderOnlineChat/);
});

test("post-match chat stores the exact draft and restores it safely after a legitimate redraw", () => {
  assert.match(onlineSource, /chatMessages: \[\],[\s\S]*?chatDraft: "",[\s\S]*?chatDraftRevision: 0,[\s\S]*?chatSendInFlight: false/);
  assert.match(onlineSource, /id="onlineChatInput" maxlength="80" value="\$\{escapeHtml\(state\.chatDraft\)\}"/);
  assert.match(onlineSource, /addEventListener\("input", \(\) => captureOnlineChatDraft\(input\)\)/);
  assert.match(onlineSource, /addEventListener\("compositionend", \(\) => captureOnlineChatDraft\(input\)\)/);
  assert.match(onlineSource, /function normalizeOnlineChatDraft\(value\) \{\s*return String\(value \?\? ""\)\.slice\(0, 80\);/);
  assert.match(onlineSource, /function render\(\) \{[\s\S]*?state\.screen === "gameover"\) captureOnlineChatDraft\(\);[\s\S]*?appRoot\.innerHTML/);
  assert.match(onlineSource, /function releaseMatchMedia\(\)[\s\S]*?state\.chatDraft = "";[\s\S]*?state\.chatSendInFlight = false;/);
});

test("chat submission clears only a successfully sent unchanged draft", async () => {
  const failed = createChatHarness(async () => false);
  failed.input.value = "  送信失敗でも残す  ";
  failed.input.selectionStart = 5;
  failed.input.selectionEnd = 8;
  failed.input.selectionDirection = "forward";
  failed.inputListeners.input({ isComposing: true });
  const failedRevision = failed.state.chatDraftRevision;
  await failed.submit();
  assert.equal(failed.input.value, "  送信失敗でも残す  ");
  assert.equal(failed.state.chatDraft, "  送信失敗でも残す  ");
  assert.equal(failed.state.chatDraftRevision, failedRevision);
  assert.equal(failed.submitButton.disabled, false);
  assert.equal(failed.input.focusCalls, 1);
  assert.equal(failed.input.lastFocusOptions.preventScroll, true);
  assert.equal(failed.input.selectionCalls, 1);
  assert.deepEqual(
    [failed.input.selectionStart, failed.input.selectionEnd, failed.input.selectionDirection],
    [5, 8, "forward"],
  );

  const succeeded = createChatHarness(async () => true);
  succeeded.input.value = "送信する本文";
  succeeded.inputListeners.input({ isComposing: false });
  await succeeded.submit();
  assert.equal(succeeded.input.value, "");
  assert.equal(succeeded.state.chatDraft, "");
  assert.equal(succeeded.submitButton.disabled, false);
  assert.equal(succeeded.input.focusCalls, 1);
  assert.equal(succeeded.input.selectionCalls, 1);

  let resolveSend;
  let sendCalls = 0;
  const delayed = createChatHarness(() => {
    sendCalls += 1;
    return new Promise((resolve) => { resolveSend = resolve; });
  });
  delayed.input.value = "先に送る本文";
  delayed.inputListeners.input({ isComposing: false });
  const firstSubmit = delayed.submit();
  const duplicateSubmit = delayed.submit();
  assert.equal(delayed.submitButton.disabled, true);
  assert.equal(sendCalls, 1);
  await duplicateSubmit;
  delayed.input.value = "送信中に書いた次の下書き";
  delayed.inputListeners.input({ isComposing: true });
  resolveSend(true);
  await firstSubmit;
  assert.equal(delayed.input.value, "送信中に書いた次の下書き");
  assert.equal(delayed.state.chatDraft, "送信中に書いた次の下書き");
  assert.equal(delayed.submitButton.disabled, false);
  assert.equal(delayed.input.focusCalls, 1);
  assert.equal(delayed.input.selectionCalls, 1);

  const sendSource = sourceBlock("async function sendChat", "function refreshChat");
  assert.match(sendSource, /await set\(push\(ref\(database,[\s\S]*?return true;/);
  assert.match(sendSource, /catch \{[\s\S]*?showToast\("チャットを送信できませんでした。"\);[\s\S]*?return false;/);
  assert.doesNotMatch(sendSource, /\.catch\(\(\) => showToast\("チャットを送信できませんでした。"\)\)/);
});

test("incoming messages refresh only the list and the release is cache-busted", () => {
  const refreshSource = sourceBlock("function refreshChat()", "function scrollChat()");
  assert.match(refreshSource, /querySelector\("#onlineChatMessages"\)/);
  assert.match(refreshSource, /list\.innerHTML = next\.innerHTML/);
  assert.doesNotMatch(refreshSource, /\brender\(|appRoot\.innerHTML|onlineChatInput/);
  assert.match(indexHtml, /online\.js\?v=[^"]*post-match-chat-draft-v1/);
  assert.match(onlineSource, /online-room-lifecycle\.mjs\?v=online-room-lifecycle-v2/);
});
