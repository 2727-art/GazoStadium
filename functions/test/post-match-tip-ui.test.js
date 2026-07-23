const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadTipUi(callableResponses = [{ data: {} }]) {
  const filePath = path.resolve(__dirname, "..", "..", "post-match-tip.js");
  const source = fs.readFileSync(filePath, "utf8");
  const body = source
    .slice(source.indexOf("const TIP_OPTIONS"))
    .replaceAll("export function ", "function ");
  let responseIndex = 0;
  const sandbox = {
    crypto: { randomUUID: () => "test-action-id" },
    functions: {},
    httpsCallable: () => async () => {
      const response = callableResponses[Math.min(responseIndex++, callableResponses.length - 1)];
      if (response instanceof Error) throw response;
      return response;
    },
    window: {
      confirm: () => true,
      setTimeout,
    },
  };
  vm.runInNewContext(`${body}
    globalThis.__tipUi = {
      normalizeContext,
      renderPostMatchTip,
      stateFor,
      updatePanel,
      hydrateTip,
      bindPostMatchTip,
      setExitButtonsBusy,
    };
  `, sandbox);
  return sandbox.__tipUi;
}

test("tip controls stay disabled until a verified match claim is confirmed", () => {
  const ui = loadTipUi();
  const options = {
    mode: "solo",
    roomId: "-0123456789ABCDEFGHI",
    viewerUid: "viewer",
    recipients: [
      { uid: "viewer", name: "自分" },
      { uid: "recipient", name: "相手" },
    ],
    balance: 100,
  };
  const context = ui.normalizeContext(options);
  const value = ui.stateFor(context);

  const pending = ui.renderPostMatchTip(options);
  assert.match(pending, /対戦記録を確認中/);
  assert.match(pending.match(/<button[^>]*data-post-match-tip-send[^>]*>/)?.[0] || "", /\bdisabled\b/);
  assert.match(pending.match(/<input[^>]*value="5"[^>]*>/)?.[0] || "", /\bdisabled\b/);

  value.eligibilityChecked = true;
  value.eligible = false;
  const unavailable = ui.renderPostMatchTip(options);
  assert.match(unavailable.match(/post-match-tip-controls[^>]*>/)?.[0] || "", /\bhidden\b/);
  assert.match(unavailable.match(/<button[^>]*data-post-match-tip-send[^>]*>/)?.[0] || "", /\bhidden\b/);

  value.eligible = true;
  const eligible = ui.renderPostMatchTip(options);
  const sendButton = eligible.match(/<button[^>]*data-post-match-tip-send[^>]*>/)?.[0] || "";
  assert.doesNotMatch(sendButton, /\bdisabled\b/);
  assert.doesNotMatch(sendButton, /\bhidden\b/);
});

test("an old match response cannot mutate a newly rendered tip panel", () => {
  const ui = loadTipUi();
  const oldContext = ui.normalizeContext({
    mode: "solo",
    roomId: "-0123456789ABCDEFGHI",
    viewerUid: "viewer",
    recipients: [{ uid: "recipient", name: "相手" }],
  });
  const value = ui.stateFor(oldContext);
  value.eligibilityChecked = true;
  value.eligible = true;
  let mutationCount = 0;
  const panel = {
    dataset: {
      postMatchTipMode: "solo",
      postMatchTipRoom: "-JIHGFEDCBA987654321",
      postMatchTipViewer: "viewer",
    },
    classList: { toggle: () => { mutationCount += 1; } },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const root = { querySelector: () => panel };

  ui.updatePanel(root, oldContext, value);
  assert.equal(mutationCount, 0);
});

test("an unavailable claim can be checked again and become eligible", async () => {
  const ui = loadTipUi([
    { data: { sent: false, eligible: false } },
    { data: { sent: false, eligible: true } },
  ]);
  const context = ui.normalizeContext({
    mode: "solo",
    roomId: "-0123456789ABCDEFGHI",
    viewerUid: "viewer",
    recipients: [{ uid: "recipient", name: "相手" }],
  });
  const value = ui.stateFor(context);
  const controls = { hidden: false };
  const sendButton = { hidden: false, disabled: false, textContent: "" };
  const retryButton = { hidden: true };
  const status = { setAttribute: () => {}, textContent: "" };
  const panel = {
    dataset: {
      postMatchTipMode: context.mode,
      postMatchTipRoom: context.roomId,
      postMatchTipViewer: context.viewerUid,
    },
    classList: { toggle: () => {} },
    querySelectorAll: () => [],
    querySelector: (selector) => ({
      ".post-match-tip-controls": controls,
      "[data-post-match-tip-send]": sendButton,
      "[data-post-match-tip-retry]": retryButton,
      "[data-post-match-tip-status]": status,
    }[selector] || null),
  };
  const root = { querySelector: () => panel };

  await ui.hydrateTip(root, context, value);
  assert.equal(value.eligible, false);
  assert.equal(retryButton.hidden, false);

  value.loaded = false;
  value.eligibilityChecked = false;
  value.eligible = false;
  value.error = "";
  await ui.hydrateTip(root, context, value);
  assert.equal(value.eligible, true);
  assert.equal(sendButton.disabled, false);
  assert.equal(retryButton.hidden, true);
});

test("rebinding during a send keeps newly rendered result actions locked", () => {
  const ui = loadTipUi();
  const options = {
    mode: "solo",
    roomId: "-0123456789ABCDEFGHI",
    viewerUid: "viewer",
    recipients: [{ uid: "recipient", name: "相手" }],
  };
  const context = ui.normalizeContext(options);
  const value = ui.stateFor(context);
  value.busy = true;
  value.loaded = true;
  const resultButton = { disabled: false, dataset: {} };
  const panel = {
    dataset: {
      postMatchTipMode: context.mode,
      postMatchTipRoom: context.roomId,
      postMatchTipViewer: context.viewerUid,
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const root = {
    querySelector: () => panel,
    querySelectorAll: () => [resultButton],
  };

  ui.bindPostMatchTip(root, options);
  assert.equal(resultButton.disabled, true);
  assert.equal(resultButton.dataset.postMatchTipWasDisabled, "0");
  ui.bindPostMatchTip(root, options);
  assert.equal(resultButton.dataset.postMatchTipWasDisabled, "0");
  ui.setExitButtonsBusy(root, false);
  assert.equal(resultButton.disabled, false);
});

test("a successful eligibility refresh clears an earlier network error", async () => {
  const ui = loadTipUi([
    new Error("offline"),
    { data: { sent: false, eligible: true } },
  ]);
  const context = ui.normalizeContext({
    mode: "solo",
    roomId: "-0123456789ABCDEFGHI",
    viewerUid: "viewer",
    recipients: [{ uid: "recipient", name: "相手" }],
  });
  const value = ui.stateFor(context);
  const panel = {
    dataset: {
      postMatchTipMode: context.mode,
      postMatchTipRoom: context.roomId,
      postMatchTipViewer: context.viewerUid,
    },
    classList: { toggle: () => {} },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const root = { querySelector: () => panel };

  await ui.hydrateTip(root, context, value);
  assert.notEqual(value.error, "");
  await ui.hydrateTip(root, context, value);
  assert.equal(value.eligible, true);
  assert.equal(value.error, "");
});
