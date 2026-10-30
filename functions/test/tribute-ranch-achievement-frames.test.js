"use strict";

// 牧場の実績の枠（設計書17）。2026-10-30 のユーザーの決定:
// 実績名は提案どおり。枠は全部共通ではなく、実績の系統に応じた枠にし、段階が上がるほど豪華にする。「豪華＝冠」ではない。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const styles = read("tribute.css");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

const BLOCK = client.slice(client.indexOf("// ───────────── 牧場の実績の枠（設計書17）"), client.indexOf("// 枠の見本（?tributePreview=achievement-frames）"));

async function frames() {
  const core = await loadCore();
  const context = vm.createContext({ ...core, escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") });
  vm.runInContext(`${/const RANK_HEART_PATH = [^\n]*\n/.exec(client)[0]}${BLOCK}`, context);
  return { core, context };
}

test("the frame code loads before RANK_HEART_PATH exists (the ranch module must not fail at load)", () => {
  const context = vm.createContext({ escapeHtml: String });
  assert.doesNotThrow(() => vm.runInContext(BLOCK, context), "nothing in the frame block may read RANK_HEART_PATH while the module loads");
});

test("every ranch achievement family has its own frame, and every secret its own seal color", async () => {
  const { core, context } = await frames();
  const families = ["tribute_manager", "tribute_wallet", ...core.RANCH_ACHIEVEMENT_FAMILIES.map((entry) => entry.family)];
  const specs = vm.runInContext("RF_FAMILIES", context);
  assert.deepEqual(Object.keys(specs).sort(), [...families].sort(), "one frame design per family, no common frame");
  const tones = vm.runInContext("RF_SECRET_TONES", context);
  assert.deepEqual(Object.keys(tones).sort(), core.RANCH_ACHIEVEMENT_SECRETS.map((entry) => entry.id).sort());
  assert.equal(new Set(Object.values(tones)).size, core.RANCH_ACHIEVEMENT_SECRETS.length, "each secret has its own wax color");
  // 同じ段階でも、系統が違えば絵が違う（字を除いて比べる）。
  const strip = (svg) => svg.replace(/<text[\s\S]*?<\/text>/, "").replace(/ is-tribute-[a-z-]+/, "");
  for (const tier of [1, 3, 5]) {
    const drawn = families.map((family) => strip(context.ranchAchievementFrame({ family, icon: "字", tier, side: "manager" })));
    assert.equal(new Set(drawn).size, families.length, `tier ${tier}: every family looks different`);
  }
});

test("each family grows richer level by level, and the crown is only the gold crown accessory", async () => {
  const { core, context } = await frames();
  const families = ["tribute_manager", "tribute_wallet", ...core.RANCH_ACHIEVEMENT_FAMILIES.map((entry) => entry.family)];
  for (const family of families) {
    const drawn = [1, 2, 3, 4, 5].map((tier) => context.ranchAchievementFrame({ family, icon: "字", tier, side: "wallet" }));
    assert.equal(new Set(drawn).size, 5, `${family}: five different frames`);
    for (let tier = 2; tier <= 5; tier += 1) {
      // なつきの最後は、牧場の動物と同じく金の王冠が花かんむりの代わりに付く（花の部品は減る）。
      if (family === "tribute_wal_fondness" && tier === 5) continue;
      const parts = (svg) => (svg.match(/<(?:path|circle|ellipse|rect|text)\b/g) || []).length;
      assert.ok(parts(drawn[tier - 1]) >= parts(drawn[tier - 2]), `${family}: tier ${tier} keeps or adds decorations`);
    }
    assert.match(drawn[4], /class="spark"/, `${family}: the top level shines`);
    for (const [index, svg] of drawn.entries()) {
      const crowned = /royal-crown/.test(svg);
      assert.equal(crowned, family === "tribute_wal_fondness" && index === 4, `${family} tier ${index + 1}: no crown unless it is the gold crown accessory`);
    }
  }
  assert.doesNotMatch(BLOCK, /class="crown"/, "the old crown-on-everything frame is gone");
  assert.deepEqual([5, 4, 10].map((max) => Array.from({ length: max }, (_, index) => core.ranchAchievementTier(index + 1, max)).join("")), ["12345", "2345", "1122334455"]);
});

test("frames carry their side, level and family as classes for the styles; locked frames show a question mark", async () => {
  const { context } = await frames();
  const svg = context.ranchAchievementFrame({ family: "tribute_mgr_deny", icon: "退", tier: 5, side: "manager" });
  assert.match(svg, /^<svg class="tribute-ach-frame is-manager is-lv-5 is-tribute-mgr-deny"/);
  assert.match(context.ranchAchievementFrame({ family: "tribute_wal_words", icon: "言", tier: 2, side: "wallet", locked: true }), /is-locked[\s\S]*>\?<\/text>/);
  assert.match(context.ranchAchievementFrame({ family: "tribute_secret_named", icon: "名", side: "manager", secret: true }), /is-secret is-tone-rose/);
  for (const level of [1, 2, 3, 4, 5]) assert.ok(styles.includes(`.tribute-ach-frame.is-lv-${level} {`), `material for level ${level}`);
  for (const side of ["manager", "wallet"]) assert.ok(styles.includes(`.tribute-ach-frame.is-${side} {`), side);
  assert.match(styles, /\.tribute-ach-frame\.is-tribute-mgr-deny\.is-lv-5 \{ --m: #bfe6ff;/, "the cold manager's top frame is ice, not gold");
  assert.match(client, /"achievement-frames": \(\) => navigate\("hub"\),/);
});
