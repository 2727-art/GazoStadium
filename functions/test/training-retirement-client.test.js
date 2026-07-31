const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const retiredClientAssets = [
  "training.js",
  "training.css",
  "training-v6-app.js",
  "training-v6-domain.mjs",
  "training-v6-machine.mjs",
  "training-v6-p2p.mjs",
  "training-v6-session.mjs",
  "training-v6-store.mjs",
  "training-v6-view.mjs",
  "training-v6-workout.mjs",
  "training-core.mjs",
  "training-session-v2.mjs",
  "training-session-v5.mjs",
  "training-session-v5-machine.mjs",
  "TRAINING_60_DESIGN.md",
];

function seriesBlock(source, family) {
  const start = source.indexOf(`family: "${family}"`);
  assert.notEqual(start, -1, `${family} definition must remain for unlocked history`);
  const end = source.indexOf("\n  });", start);
  assert.notEqual(end, -1, `${family} definition must be complete`);
  return source.slice(start, end);
}

test("Training 60 has no playable browser asset or landing entry", () => {
  const html = read("index.html");
  const app = read("app.js");
  const online = read("online.js");
  const styles = read("styles.css");

  retiredClientAssets.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  });
  assert.doesNotMatch(
    html,
    /(?:src|href)=["'](?:\.\/)?training(?:-v6(?:-[^"'?]+)?)?\.(?:js|mjs|css)(?:[?"'])/i,
  );
  assert.doesNotMatch(html, /鍛え合い60|TRAINING 60/);
  assert.doesNotMatch(app, /HariaiTraining|hariai-training-ready|trainingButton|lobbyTraining|鍛え合い60/);
  assert.doesNotMatch(online, /HariaiTraining|lobbyTraining|鍛え合い60を終了/);
  assert.doesNotMatch(online, /LOBBY_MODES\s*=\s*\[[^\]]*["']training["']/);
  assert.doesNotMatch(styles, /\.lobby-mode-card\.training\b/);
});

test("all surviving mode entry points dropped the retired activity guard", () => {
  for (const relativePath of [
    "account.js",
    "strategy.js",
    "online.js",
    "free-table.js",
    "flea-market.js",
    "market.js",
    "ai-text-training.js",
  ]) {
    assert.doesNotMatch(read(relativePath), /HariaiTraining/, relativePath);
  }
});

test("retirement removes device-local Training 60 images and safety settings", () => {
  const app = read("app.js");
  assert.match(app, /RETIRED_TRAINING_DATABASE_NAME\s*=\s*"hariai-training-v6"/);
  assert.match(app, /"hariai-training-v6-safety"/);
  assert.match(app, /localStorage\.removeItem\(key\)/);
  assert.match(app, /globalThis\.indexedDB\?\.deleteDatabase\?\.\(RETIRED_TRAINING_DATABASE_NAME\)/);
  assert.match(app, /purgeRetiredTrainingLocalData\(\);/);
  assert.doesNotMatch(app, /removeItem\("hariai-stadium-online-name-v1"\)/);
});

test("the old daily mission is historical and unavailable from 2026-08-01", () => {
  const online = read("online.js");
  assert.match(
    online,
    /id:\s*"play_training"[^\n]*startsOn:\s*"2026-07-28"[^\n]*endsAfter:\s*"2026-08-01"/,
  );
  assert.match(online, /!mission\.endsAfter \|\| dateKey < mission\.endsAfter/);
  assert.doesNotMatch(online, /専用ミッションだけに加算/);
});

test("unlocked Training 60 achievements remain visible only as legacy history", () => {
  const achievements = read("achievements.js");
  for (const family of ["training_sessions", "training_workouts", "training_minutes"]) {
    const block = seriesBlock(achievements, family);
    assert.match(block, /legacy:\s*true/);
    assert.match(block, /hint:\s*"終了したモードの記録"/);
  }
  assert.match(achievements, /label:\s*"鍛え合い60（終了）"/);
  assert.match(achievements, /!definition\.legacy \|\| profile\.unlocked\[definition\.id\]/);
});

test("changed browser assets use the retirement cache marker", () => {
  const html = read("index.html");
  for (const assetName of [
    "styles.css",
    "achievements.js",
    "app.js",
    "account.js",
    "strategy.js",
    "online.js",
    "free-table.js",
    "flea-market.js",
    "market.js",
    "ai-text-training.js",
  ]) {
    assert.match(
      html,
      new RegExp(`${assetName.replace(".", "\\.")}\\?v=[^\"]*retire-training-v1`),
      assetName,
    );
  }
  assert.doesNotMatch(html, /training-v6-companion|kitaeai-hp/);
});

test("documentation describes permanent retirement without publishing the deleted design", () => {
  const readme = read("README.md");
  const aiDesign = read("AI_TEXT_TRAINING_DESIGN.md");
  const firebase = JSON.parse(read("firebase.json"));
  const workerIgnore = read(".assetsignore");

  assert.match(readme, /鍛え合い60は2026年8月1日に提供を終了/);
  assert.match(readme, /新規実績解除は再開しません/);
  assert.doesNotMatch(readme, /`training-v6-|`training\.js`|`training\.css`|TRAINING_60_DESIGN/);
  assert.match(aiDesign, /2026年8月1日に終了した旧P2Pコンテンツ「鍛え合い60」/);
  assert.equal(firebase.hosting.ignore.includes("TRAINING_60_DESIGN.md"), false);
  assert.doesNotMatch(workerIgnore, /^TRAINING_60_DESIGN\.md$/m);
});
