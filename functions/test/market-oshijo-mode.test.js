const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MARKET_CLOSING_MODE_OSHIJO,
  marketClosingAllowsExtension,
  marketClosingAuditMode,
  marketClosingDecision,
  marketClosingLeaveReason,
} = require("../market-closing");

const functionsRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(functionsRoot, "..");
const indexSource = fs.readFileSync(path.join(functionsRoot, "index.js"), "utf8");
const marketSource = fs.readFileSync(path.join(projectRoot, "market.js"), "utf8");
const marketCss = fs.readFileSync(path.join(projectRoot, "market.css"), "utf8");
const readmeSource = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");

test("normal market pitch uses an empty closing mode", () => {
  for (const closingMode of [undefined, null, "", "   "]) {
    assert.deepEqual(
      marketClosingDecision({ closingMode, serviceStyles: [] }),
      { allowed: true, closingMode: "", errorCode: "" },
    );
  }
  assert.equal(marketClosingAuditMode(""), "");
  assert.equal(marketClosingAllowsExtension(""), true);
  assert.equal(marketClosingLeaveReason(""), "buyer_left");
});

test("oshijo closing requires the equipped service style", () => {
  assert.equal(MARKET_CLOSING_MODE_OSHIJO, "oshijo");
  assert.deepEqual(
    marketClosingDecision({
      closingMode: "oshijo",
      serviceStyles: ["careful", "oshijo"],
    }),
    { allowed: true, closingMode: "oshijo", errorCode: "" },
  );
  assert.deepEqual(
    marketClosingDecision({ closingMode: "oshijo", serviceStyles: ["careful"] }),
    { allowed: false, closingMode: "", errorCode: "failed-precondition" },
  );
  assert.deepEqual(
    marketClosingDecision({ closingMode: "oshijo", serviceStyles: null }),
    { allowed: false, closingMode: "", errorCode: "failed-precondition" },
  );
});

test("unknown non-empty closing modes are invalid", () => {
  for (const closingMode of ["hard_sell", "OSHIJO", 1, {}, true]) {
    assert.deepEqual(
      marketClosingDecision({ closingMode, serviceStyles: ["oshijo"] }),
      { allowed: false, closingMode: "", errorCode: "invalid-argument" },
    );
  }
});

test("oshijo closing blocks extensions and records a distinct decline", () => {
  assert.equal(marketClosingAuditMode("oshijo"), "oshijo");
  assert.equal(marketClosingAuditMode("unknown"), "");
  assert.equal(marketClosingAllowsExtension("oshijo"), false);
  assert.equal(marketClosingLeaveReason("oshijo"), "oshijo_declined");
});

test("valueMarketAction wires oshijo decisions into the existing transaction", () => {
  assert.match(
    indexSource,
    /const closingDecision = marketClosingDecision\(\{\s*closingMode: data\?\.closingMode,\s*serviceStyles: room\.sellerShop\?\.serviceStyles,\s*\}\);/,
  );
  assert.match(
    indexSource,
    /closingDecision\.errorCode === "failed-precondition"[\s\S]*?new HttpsError\(\s*"failed-precondition"/,
  );
  assert.match(
    indexSource,
    /new HttpsError\("invalid-argument", "未対応の営業クロージングモードです。"\)/,
  );
  assert.match(indexSource, /room\.closingMode = closingDecision\.closingMode;/);
  assert.match(
    indexSource,
    /room\.closingActivatedAt = closingDecision\.closingMode \? pitchCompletedAt : 0;/,
  );
  assert.match(
    indexSource,
    /action === "request_extension"[\s\S]*?!marketClosingAllowsExtension\(room\.closingMode\)[\s\S]*?new HttpsError\("failed-precondition"/,
  );
  assert.match(
    indexSource,
    /action === "leave"[\s\S]*?room\.endReason = marketClosingLeaveReason\(room\.closingMode\);/,
  );
});

test("certificate, market ledger, and response retain the audit mode", () => {
  const auditAssignments = indexSource.match(
    /closingMode: marketClosingAuditMode\((?:room|result\.room)\.closingMode\)/g,
  ) || [];
  assert.equal(
    auditAssignments.length,
    3,
    "certificate, valueMarketLedger, and callable response should each expose closingMode",
  );
  assert.match(
    indexSource,
    /transaction\.create\(certificateRef,[\s\S]*?closingMode: marketClosingAuditMode\(room\.closingMode\)/,
  );
  assert.match(
    indexSource,
    /transaction\.create\(ledgerRef,[\s\S]*?closingMode: marketClosingAuditMode\(room\.closingMode\)/,
  );
  assert.match(
    indexSource,
    /return \{[\s\S]*?closingMode: marketClosingAuditMode\(result\.room\.closingMode\)/,
  );
  assert.match(
    indexSource,
    /function publicMarketCertificate\(snapshot\)[\s\S]*?closingMode: marketClosingAuditMode\(value\?\.closingMode\)/,
  );
});

test("idempotent pitch retries validate and match the requested closing mode", () => {
  assert.match(
    indexSource,
    /if \(ledgerSnapshot\.exists\)[\s\S]*?const replayClosingDecision = marketClosingDecision\(\{[\s\S]*?closingMode: data\?\.closingMode,[\s\S]*?serviceStyles: room\.sellerShop\?\.serviceStyles/,
  );
  assert.match(
    indexSource,
    /marketClosingAuditMode\(ledger\.closingMode\) !== replayClosingDecision\.closingMode[\s\S]*?市場操作IDの営業クロージングモードが一致しません/,
  );
});

test("oshijo UI gives advance notice, an explicit final confirmation, and a decline path", () => {
  assert.match(marketSource, /推し嬢＝筋と人情で背中を押す熱血お嬢スタイル/);
  assert.match(marketSource, /追加検討は使えず、購入か見送り/);
  assert.match(marketSource, /自動購入や時間切れ購入はありません/);
  assert.match(marketSource, /Payは貴重です。/);
  assert.match(marketSource, /購入後残高/);
  assert.match(marketSource, /画像データ・著作権・所有権は移りません/);
  assert.match(marketSource, /const fundCopy = status === "sold" && settlement\.patronFundSubsidy > 0/);
  assert.match(
    marketSource,
    /data-market-oshijo-review aria-expanded="false" aria-controls="marketOshijoFinalConfirm"/,
  );
  assert.match(marketSource, /id="marketOshijoFinalConfirm"[\s\S]*?hidden/);
  assert.match(marketSource, /data-market-action="buy"[\s\S]*?購入を確定/);
  assert.match(marketSource, /data-market-action="leave"[\s\S]*?今回は見送る/);
  assert.match(
    marketSource,
    /if \(role === "buyer" && pitchAccepted\) previewBalance -= ENTRY_FEE/,
  );
  const oshijoDecision = marketSource.match(
    /if \(oshijoClosing\) \{([\s\S]*?)\r?\n\s*\}\r?\n\s*const canExtend/,
  )?.[1] || "";
  assert.ok(oshijoDecision, "buyer oshijo decision block should exist");
  assert.doesNotMatch(oshijoDecision, /data-market-action="request_extension"/);
  assert.doesNotMatch(oshijoDecision, /setTimeout|setInterval|auto(?:matic)?Purchase/i);
});

test("oshijo presentation announces state changes and respects reduced motion", () => {
  assert.match(marketSource, /aria-live="polite"/);
  assert.match(marketSource, /OSHIJO MODE \/ 筋と人情の熱血お嬢/);
  assert.match(marketSource, /id="marketOshijoDecision"/);
  assert.match(marketSource, /id="marketResultPanel"/);
  assert.match(marketSource, /lastRenderedMarketFocusKey/);
  assert.match(marketSource, /const oshijoFocusSelector =/);
  assert.match(marketSource, /const oshijoResultFocusSelector =/);
  assert.match(marketSource, /state\.relationshipFeedback\?\.busy\) return "#marketResultPanel"/);
  assert.match(marketSource, /focused\.matches\("\[data-market-block-counterparty\]"\)/);
  assert.match(marketSource, /focusPresentation\.selector\)\?\.focus\(\)/);
  assert.match(
    marketCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.market-oshijo-flare i[\s\S]*?animation: none/,
  );
  assert.match(marketCss, /\.market-oshijo-confirm > div\[hidden\]\s*\{\s*display: none;/);
  assert.match(readmeSource, /自動購入や時間切れ購入は行わず/);
});
