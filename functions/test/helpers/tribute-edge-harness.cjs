"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../../..");
const source = fs.readFileSync(path.join(root, "tribute.js"), "utf8");

function extract(source, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\r?\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}
function prefixHarness(file, names) {
  const filename = path.join(root, "functions/test", file);
  const text = fs.readFileSync(filename, "utf8");
  const end = text.indexOf('\ntest("');
  assert.ok(end > 0);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(`${text.slice(0, end)}\nmodule.exports = {${names.join(",")}};`, filename);
  return loaded.exports;
}
const server = prefixHarness("tribute-service-runtime.test.js", ["createHarness", "openManager", "startContract", "nextRequestId", "confirmAge", "FakeHttpsError"]);
const client = prefixHarness("tribute-cost-client-runtime.test.js", ["harness", "deferred", "flush"]);
function addFunctions(context, names) { vm.runInContext(names.map(name => extract(source, name)).join("\n"), context); }

// Use the production wallet cap and reservedIncoming logic in boundary tests.
function productionWalletHarness(options) {
  const text = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");
  const MAX_POINTS = require("../../anju-pay-ledger").ANJU_PAY_MAX_BALANCE;
  const wallet = vm.createContext({ MAX_POINTS, HttpsError: server.FakeHttpsError });
  vm.runInContext(["integer", "safeBalance", "walletCreditCapacity", "creditPoints", "debitPoints"].map(name => extract(text, name)).join("\n"), wallet);
  const filename = path.join(root, "functions/test/tribute-service-runtime.test.js");
  const original = fs.readFileSync(filename, "utf8");
  const createSource = extract(original, "createHarness")
    .replace('walletCreditCapacity: (wallet) => wallet.maxBalance - wallet.balance,', 'walletCreditCapacity: productionWallet.walletCreditCapacity,')
    .replace(/creditPoints\(wallet, amount\) \{[\s\S]*?\n    \},/, 'creditPoints: productionWallet.creditPoints,');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(original.slice(0, original.indexOf('\ntest("')).replace(extract(original, "createHarness"), createSource)
    + '\nlet productionWallet; module.exports = wallet => { productionWallet = wallet; return createHarness; };', filename);
  return { h: loaded.exports(wallet)(options), MAX_POINTS };
}

async function fixture({ production = false } = {}) {
  const balances = { payer: 2000, manager: 2000 };
  const { h, MAX_POINTS } = production ? productionWalletHarness({ balances }) : { h: server.createHarness({ balances }) };
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, {}, 0);
  return { h, contractId, publicManagerId, MAX_POINTS };
}
const core = import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const deco = import(pathToFileURL(path.join(root, "tribute-deco.mjs")).href);
module.exports = { root, source, server, client, addFunctions, fixture, core, deco };
