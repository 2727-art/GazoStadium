"use strict";

// マイスタジアムの画面・入口・利用履歴・台帳・公開除外のつながり。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const rollout = require("../app-check-rollout");
const { nextAnjuPayEntry } = require("../anju-pay-ledger");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const index = read("index.html");
const app = read("app.js");
const client = read("stadium.js");
const account = read("account.js");
const functionsIndex = read("functions/index.js");

test("index.html loads the stadium screen and styles with cache tokens", () => {
  assert.match(index, /<link rel="stylesheet" href="stadium\.css\?v=my-stadium-v1[^"]*" \/>/);
  assert.match(index, /<script type="module" src="stadium\.js\?v=my-stadium-v1[^"]*"><\/script>/);
  assert.match(index, /stadium\.js\?v=[^"]*-diorama-v1"/);
  assert.match(index, /stadium\.css\?v=[^"]*-diorama-v1"/);
  assert.match(index, /app\.js\?v=[^"]*-my-stadium-v1"/);
  assert.match(index, /velvet\.css\?v=[^"]*-my-stadium-v1-header-contact-v1"/);
  assert.match(index, /account\.js\?v=[^"]*-my-stadium-v1-ranch-vault-v1"/);
  assert.match(client, /from "\.\/stadium-core\.mjs\?v=my-stadium-v1"/);
});

test("the landing tile starts the stadium and the header link returns home from it", () => {
  assert.match(app, /id="stadiumButton"[^>]*><small>完走した数だけ観客が増える<\/small><span>マイスタジアム<\/span>/);
  assert.match(app, /querySelector\("#stadiumButton"\)\?\.addEventListener\("click", \(\) => startStadium\(\)\)/);
  assert.match(app, /"hariai-stadium-ready"/);
  assert.match(app, /window\.HariaiStadium\?\.isActive\?\.\(\)\) \{\s*window\.HariaiStadium\.requestHome\(\);/);
  assert.match(client, /window\.HariaiStadium = Object\.freeze\(\{\s*start,\s*isActive,\s*requestHome,\s*\}\)/);
  assert.match(client, /window\.dispatchEvent\(new Event\("hariai-stadium-ready"\)\)/);
});

test("the client sends only the action, facility and level, and previews stay on localhost", () => {
  assert.match(client, /httpsCallable\(functions, "stadiumAction"\)/);
  assert.match(client, /call\("build", \{ facility, level \}\)/);
  assert.doesNotMatch(client, /call\("collect", \{/);
  assert.match(client, /params\.has\("stadiumPreview"\) \|\| !PREVIEW_HOSTS\.has\(window\.location\.hostname\)/);
  assert.match(client, /if \(previewScenario\) return previewCall\(action, payload\);/);
  // 運で変わる演出を作らない。観客の並びも決まった順で埋める。
  assert.doesNotMatch(client, /Math\.random/);
});

test("the callable is exported with App Check enforced from day one", () => {
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.stadiumAction, true);
  assert.match(functionsIndex, /exports\.stadiumAction = onCall\(callableOptions\("stadiumAction"\)/);
  assert.match(functionsIndex, /totalVerifiedMatches: \(progress\) => normalizeEconomyProgress\(progress\)\.achievementStats\.totalMatches/);
});

test("AnjuPay history names the stadium entries and shows the facility level", () => {
  assert.match(account, /anju_pay_stadium_revenue: "マイスタジアムの売上を回収"/);
  assert.match(account, /anju_pay_stadium_build: "マイスタジアムの施設を建設"/);
  assert.match(account, /facility: String\(source\.details\.facility \|\| ""\)\.slice\(0, 16\)/);
  assert.match(account, /details\.mode === "stadium" && STADIUM_FACILITY_LABELS\[details\.facility\]/);
});

test("the ledger keeps the facility and level of a build", () => {
  const wallet = { balance: 700, ledgerVersion: 1, ledgerSequence: 3, historyStartedAt: 1 };
  const next = nextAnjuPayEntry(wallet, {
    entryId: "a".repeat(40),
    groupId: "a".repeat(40),
    kind: "stadium_build",
    category: "spend",
    labelKey: "anju_pay_stadium_build",
    status: "posted",
    delta: -500,
    nominalAmount: 500,
    balanceBefore: 1_200,
    balanceAfter: 700,
    components: [],
    details: { mode: "stadium", facility: "stand", facilityLevel: 2 },
    occurredAt: 1,
  });
  assert.deepEqual(next.entry.details, { mode: "stadium", facility: "stand", facilityLevel: 2 });
});

test("the design document stays out of both public routes", () => {
  assert.ok(JSON.parse(read("firebase.json")).hosting.ignore.includes("STADIUM_DESIGN.md"));
  assert.match(read(".assetsignore"), /^STADIUM_DESIGN\.md\r?$/m);
  assert.ok(fs.existsSync(path.join(root, "STADIUM_DESIGN.md")));
});

test("the Blender script stays out of both public routes while its renders are published", () => {
  const ignore = JSON.parse(read("firebase.json")).hosting.ignore;
  assert.ok(ignore.includes("tools") && ignore.includes("tools/**"));
  assert.match(read(".assetsignore"), /^tools\/\r?$/m);
  assert.ok(fs.existsSync(path.join(root, "tools/stadium-art/build_stadium.py")));
  assert.ok(!ignore.some((entry) => entry.startsWith("assets")));
});

test("the diorama art covers every facility level with the same canvas and in-frame seats", () => {
  const { FACILITIES } = require("../stadium-rules");
  const art = JSON.parse(read("assets/stadium/stadium-art.json"));
  assert.equal(art.width, 1600);
  assert.equal(art.height, 1200);
  assert.ok(art.seatRadius > 0 && art.seatRadius < 0.02);
  const inFrame = ([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
  for (const [facility, definition] of Object.entries(FACILITIES)) {
    assert.deepEqual(Object.keys(art[facility]).map(Number), definition.levels.map((row) => row.level), facility);
    for (const row of definition.levels) {
      const entry = art[facility][String(row.level)];
      const image = facility === "stand" ? `base-stand-${row.level}.webp` : `${facility}-${row.level}.webp`;
      assert.equal(entry.image, image);
      assert.ok(fs.statSync(path.join(root, "assets/stadium", image)).size > 1_000, image);
      assert.ok(entry.lights.every(inFrame), `${facility} ${row.level} lights`);
    }
  }
  const seatCounts = FACILITIES.stand.levels.map((row) => art.stand[String(row.level)].seats.length);
  assert.ok(seatCounts.every((total) => total > 20 && total < 7_919), "seat order uses a prime larger than any level");
  assert.ok(seatCounts[5] > seatCounts[0] * 10, "the dome has far more visible seats than the temporary stand");
  for (const row of FACILITIES.stand.levels) {
    assert.ok(art.stand[String(row.level)].seats.every(inFrame), `stand ${row.level} seats`);
  }
  for (const kind of ["stand", "shop", "vault"]) {
    assert.ok(fs.existsSync(path.join(root, `assets/stadium/scaffold-${kind}.webp`)), kind);
    assert.ok(art.anchors[kind]);
  }
});

test("the diorama falls back, fills seats deterministically, and plays build effects only with motion allowed", () => {
  assert.match(client, /if \(!artMeta\) return stadiumSvg\(view, \{ empty \}\);/);
  assert.match(client, /function seatRank\(index, total\) \{\s*return \(index \* 7919\) % total;/);
  assert.match(client, /if \(!artMeta \|\| prefersReducedMotion\(\)\) \{\s*state\.buildFx = null;/);
  assert.match(client, /phase: "scaffold"/);
  assert.match(client, /phase: "reveal"/);
  assert.match(client, /const ART_BASE = "assets\/stadium\/";/);
  const styles = read("stadium.css");
  assert.match(styles, /\.stadium-screen\.is-settled \{\s*animation: none;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.stadium-crowd \.stadium-fan\.is-new/);
});
