"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after: ${startMarker}`);
  return source.slice(start, end);
}

test("every existing mode entry guard reciprocally excludes Roulette Training", () => {
  const relativePaths = [
    "account.js",
    "ai-text-training.js",
    "danwaku-note.js",
    "free-table.js",
    "flea-market.js",
    "market.js",
    "online.js",
    "strategy.js",
  ];

  for (const relativePath of relativePaths) {
    assert.match(
      read(relativePath),
      /window\.HariaiRouletteTraining\?\.isActive\?\.\(\)/,
      `${relativePath} must refuse to start over Roulette Training`,
    );
  }

  const roulette = read("roulette-training.js");
  assert.match(roulette, /window\.HariaiRouletteTraining = Object\.freeze\(\{/);
  assert.match(roulette, /\bisActive,\s*\n/);
});

test("AnjuPay history gives roulette publish, use, and sale their own Japanese labels", () => {
  const source = read("account.js");
  const labels = sourceBetween(
    source,
    "const ANJU_PAY_LABELS = Object.freeze(",
    "const ANJU_PAY_STATUS_LABELS",
  );
  const historyLabel = sourceBetween(
    source,
    "function historyLabel(entry)",
    "function resetHistoryState",
  );
  const context = {};
  vm.runInNewContext(
    `"use strict";\n${labels}\n${historyLabel}\nthis.historyLabel = historyLabel;`,
    context,
  );

  const expected = new Map([
    ["anju_pay_roulette_training_publish", "ルーレットトレーニングメニューの公開・改訂料"],
    ["anju_pay_roulette_training_publish_fee", "ルーレットトレーニングメニューの公開・改訂料"],
    ["anju_pay_roulette_training_use", "ルーレットトレーニングメニューを1回利用"],
    ["anju_pay_roulette_training_sale", "ルーレットトレーニングメニューが1回利用された"],
  ]);
  for (const [labelKey, label] of expected) {
    assert.equal(context.historyLabel({
      labelKey,
      category: "market",
      status: "settled",
      delta: labelKey.endsWith("sale") ? 4 : -5,
    }), label);
  }

  assert.match(historyLabel, /key\.includes\("roulette_training_publish"\)/);
  assert.match(historyLabel, /key\.includes\("roulette_training_use"\)/);
  assert.match(historyLabel, /key\.includes\("roulette_training_sale"\)/);
});
