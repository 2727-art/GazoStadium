const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("successful market buys atomically charge a fee and issue a metadata-only certificate", () => {
  const server = read("functions/index.js");
  const buyStart = server.indexOf('} else if (action === "buy")');
  const buyEnd = server.indexOf('} else if (action === "leave")', buyStart);
  const buySource = server.slice(buyStart, buyEnd);
  assert.ok(buyStart >= 0 && buyEnd > buyStart);
  assert.match(buySource, /marketSaleSettlement\(price\)/);
  assert.match(buySource, /debitPoints\(buyerWallet, settlement\.grossAmount\)/);
  assert.match(buySource, /creditPoints\(sellerWallet, settlement\.sellerProceeds\)/);
  assert.match(buySource, /transaction\.create\(certificateRef/);
  assert.match(buySource, /nonTransferable: true/);
  assert.doesNotMatch(buySource, /\b(?:image|audio|chat)\b/i);
  assert.ok(buySource.indexOf("transaction.create(certificateRef") < server.indexOf("transaction.create(ledgerRef", buyStart));
});

test("market ranking uses one fixed JST date throughout a transaction retry", () => {
  const server = read("functions/index.js");
  const start = server.indexOf("async function performMarketAction");
  const end = server.indexOf("exports.valueMarketAction", start);
  const source = server.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /const transactionDateKey = jstDateKey\(\);/);
  assert.match(source, /const pairKey = eventId\([\s\S]*transactionDateKey/);
  assert.match(source, /const dateKey = transactionDateKey;/);
  assert.doesNotMatch(source, /const dateKey = jstDateKey\(\);/);
});

test("ambiguous extension escrow fails closed before any wallet mutation", () => {
  const server = read("functions/index.js");
  assert.match(
    server,
    /function requireReservedExtensionHold\(room, held\)[\s\S]*?room\?\.extensionReserved !== true[\s\S]*?延長内金の保留状態を確認できないため、取引を停止しました。/,
  );

  const acceptStart = server.indexOf('} else if (action === "accept_extension")');
  const declineStart = server.indexOf('} else if (action === "decline_extension")', acceptStart);
  const cancelStart = server.indexOf('} else if (action === "cancel")', declineStart);
  const actionEnd = server.indexOf("const marketGroupId", cancelStart);
  const acceptSource = server.slice(acceptStart, declineStart);
  const declineSource = server.slice(declineStart, cancelStart);
  const cancelSource = server.slice(cancelStart, actionEnd);

  assert.ok(acceptStart >= 0 && declineStart > acceptStart);
  assert.ok(cancelStart > declineStart && actionEnd > cancelStart);
  assert.ok(
    acceptSource.indexOf("requireReservedExtensionHold(room, held)")
      < acceptSource.indexOf("releaseIncoming(sellerWallet, held)"),
  );
  assert.doesNotMatch(acceptSource, /transferPoints\(sellerWallet, buyerWallet, held\)/);
  assert.ok(
    declineSource.indexOf("requireReservedExtensionHold(room, held)")
      < declineSource.indexOf("releaseIncoming(sellerWallet, held)"),
  );
  assert.ok(
    cancelSource.indexOf("requireReservedExtensionHold(room, extensionHeld)")
      < cancelSource.indexOf("const heldFee"),
  );
});

test("certificate list is UID-scoped and does not return private identifiers or media", () => {
  const server = read("functions/index.js");
  const start = server.indexOf("function publicMarketCertificate");
  const end = server.indexOf("exports.valueMarketRankings", start);
  const source = server.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /collection\("valueMarketCertificates"\)\s*\.doc\(uid\)\s*\.collection\("items"\)/);
  assert.match(source, /\.orderBy\("issuedAt", "desc"\)\s*\.limit\(100\)/);
  for (const privateField of ["buyerUid", "roomId", "sellerUid", "image", "audio", "chat"]) {
    assert.doesNotMatch(source, new RegExp(`${privateField}\\s*:`));
  }
});

test("post-match tips require verified claims and transfer one fixed amount once per sender and match", () => {
  const server = read("functions/index.js");
  const getStart = server.indexOf("async function getPostMatchTip");
  const start = server.indexOf("async function sendPostMatchTip");
  const end = server.indexOf("exports.economyAction", start);
  const getSource = server.slice(getStart, start);
  const source = server.slice(start, end);
  assert.ok(getStart >= 0 && start > getStart && end > start);
  assert.match(server, /postMatchTipRef\(uid, mode, roomId\)/);
  assert.match(server, /validatedOutcomes\(request\.mode, room, participants\)/);
  assert.match(getSource, /verifiedMatchClaimRef\(uid, mode, roomId\)\.get\(\)/);
  assert.match(getSource, /return \{ sent: false, eligible \}/);
  assert.match(source, /verifiedMatchClaimRef\(uid, verified\.mode, verified\.roomId\)/);
  assert.match(source, /verifiedMatchClaimRef\(verified\.targetUid, verified\.mode, verified\.roomId\)/);
  assert.match(source, /transferPoints\(senderWallet, recipientWallet, verified\.amount\)/);
  assert.match(source, /transaction\.create\(tipRef/);
  assert.match(source, /if \(tipSnapshot\.exists\)/);
});

test("post-match tip UI stays disabled until claim eligibility is confirmed and ignores stale panels", () => {
  const source = read("post-match-tip.js");
  const styles = read("styles.css");
  assert.match(source, /!value\.eligibilityChecked \|\| !value\.eligible/);
  assert.match(source, /response\.data\?\.eligible === true/);
  assert.match(source, /panel\.dataset\.postMatchTipMode !== context\.mode/);
  assert.match(source, /panel\.dataset\.postMatchTipRoom !== context\.roomId/);
  assert.match(source, /panel\.dataset\.postMatchTipViewer !== context\.viewerUid/);
  assert.match(source, /const panel = matchingPanel\(root, context\);/);
  assert.match(styles, /\.post-match-tip \[hidden\]\s*\{\s*display: none !important;/);
});

test("all four final-result screens use the shared post-match tip UI", () => {
  for (const [relativePath, mode] of [
    ["online.js", "solo"],
    ["strategy.js", "strategy"],
    ["team.js", "team"],
    ["royale.js", "royale"],
  ]) {
    const source = read(relativePath);
    assert.match(source, /post-match-tip\.js\?v=post-match-tip-v4/);
    assert.match(source, new RegExp(`renderPostMatchTip\\(\\{ mode: "${mode}"`));
    assert.match(source, new RegExp(`bindPostMatchTip\\([\\s\\S]*?mode: "${mode}"`));
    assert.equal((source.match(/renderPostMatchTip\(/g) || []).length, 1);
  }
});

test("new economy ledgers are server-only in Firestore Rules", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/postMatchTips\/\{tipId\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/valueMarketCertificates\/\{uid\}\/items\/\{certificateId\} \{\s*allow read, write: if false;/);
});
