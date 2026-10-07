const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const mediaBlock = (source, query) => {
  const start = source.indexOf(`@media ${query} {`);
  assert.ok(start >= 0, `missing media block: ${query}`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end);
};

test("desktop landing aligns the entrances to one column and stacks two gap-free columns below", () => {
  const velvet = read("velvet.css");
  const styles = read("styles.css");
  const desktop = mediaBlock(velvet, "(min-width: 900px)");

  assert.match(desktop, /\.hero\.vl-landing\s*\{[^}]*display:\s*flow-root;[^}]*max-width:\s*1120px;/s);
  assert.match(
    desktop,
    /\.hero\.vl-landing > \.vl-hero,\s*\.hero\.vl-landing > \.hero-actions,\s*\.hero\.vl-landing > \.vl-board,\s*\.hero\.vl-landing > \.vl-others,\s*\.hero\.vl-landing > \.vl-tabbar\s*\{[^}]*width:\s*min\(880px,\s*100%\);[^}]*margin-inline:\s*auto;/s,
    "the hero, main button, open tables, other modes, and menu row share one centered width",
  );
  assert.doesNotMatch(desktop, /\.vl-board-list\s*\{/, "the open tables stay one timeline on desktop");
  assert.match(
    desktop,
    /\.vl-others-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/s,
    "the four other modes fill one desktop row",
  );
  assert.match(velvet, /\.vl-main-button\s*\{[^}]*grid-column:\s*1 \/ -1;/s, "normal 1on1 stays the widest entrance");
  // 左右の列は独立して上から積むので、隣の区画の高さで隙間ができない
  assert.match(desktop, /\.hero\.vl-landing > \.landing-flea,[\s\S]*?\{[^}]*float:\s*left;[^}]*clear:\s*left;/s);
  assert.doesNotMatch(velvet, /training-lights/);
  assert.match(desktop, /\.hero\.vl-landing > \.landing-community,[\s\S]*?\{[^}]*float:\s*right;[^}]*clear:\s*right;/s);
  assert.match(
    styles,
    /\.mode-lobby-stats\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    "the two desktop battle status cards should divide the row equally",
  );
  assert.match(styles, /\.lobby-mode-card\.free-table-status\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.match(styles, /\.lobby-mode-card\.market\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
});

test("mobile landing uses two-up mode tiles and a thumb-reach tab bar clear of the home indicator", () => {
  const velvet = read("velvet.css");
  const mobile = mediaBlock(velvet, "(max-width: 760px)");

  assert.match(velvet, /\.vl-others-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(mobile, /\.vl-tabbar\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;[^}]*env\(safe-area-inset-bottom/s);
  assert.match(mobile, /body:has\(\.vl-landing\)\s*\{[^}]*padding-bottom:/s);
});

test("the landing layout ships with its stylesheet and viewport-fit cache markers", () => {
  const html = read("index.html");
  assert.match(html, /velvet\.css\?v=velvet-stage-v1/);
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/);
});
