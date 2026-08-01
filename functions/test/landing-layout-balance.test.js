const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("desktop landing balances surviving mode buttons and lobby cards", () => {
  const styles = read("styles.css");
  const marketStyles = read("market.css");

  assert.match(
    styles,
    /\.hero-mode-button\s*\{[^}]*grid-column:\s*span 4;/s,
    "the three desktop mode buttons should divide the 12-column grid equally",
  );
  assert.match(
    styles,
    /\.mode-lobby-stats\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    "the two desktop battle status cards should divide the row equally",
  );
  assert.match(marketStyles, /\.hero-market-button\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.match(styles, /\.lobby-mode-card\.free-table-status\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.match(styles, /\.lobby-mode-card\.market\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
});

test("mobile landing remains a single equal-width column", () => {
  const styles = read("styles.css");
  const mobileStyles = styles.match(
    /@media \(max-width: 760px\) \{\r?\n  \.site-header,[\s\S]*?(?=\r?\n@media \(max-width:)/,
  )?.[0] ?? "";

  assert.notEqual(mobileStyles, "");
  assert.match(mobileStyles, /\.hero-actions\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(
    mobileStyles,
    /\.hero-mode-button,[\s\S]*?\.hero-audio-tool-button\s*\{[^}]*grid-column:\s*1;/s,
  );
  assert.match(mobileStyles, /\.mode-lobby-stats\s*\{[^}]*grid-template-columns:\s*1fr;/s);
});

test("the balanced layout ships with a fresh stylesheet cache marker", () => {
  const html = read("index.html");
  assert.match(html, /styles\.css\?v=[^"]*desktop-layout-balance-v1/);
});
