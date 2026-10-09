"use strict";

// お貢ぎ牧場の飾り（カードの枠・受取印の形・朱肉の色）と、牧場のカードに出す実績3つ。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");
const catalog = require("../product-catalog");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const client = read("tribute.js");
const share = read("tribute-share.mjs");
const styles = read("tribute.css");
const online = read("online.js");
const indexSource = read("functions/index.js");
const service = read("functions/tribute-service.js");
const design = read("TRIBUTE_DESIGN.md");
const loadDeco = () => import(pathToFileURL(path.join(root, "tribute-deco.mjs")).href);

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("the decoration catalog is the same in the browser, the store prices and the server rules", async () => {
  const deco = await loadDeco();
  const serverRanch = Object.values(catalog).filter((product) => rules.DECORATION_PRODUCT_TYPES.includes(product.type));
  const rows = (list) => list.map(({ id, type, price }) => [id, type, price]).sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(rows(deco.RANCH_DECORATION_PRODUCTS), rows(serverRanch));
  assert.deepEqual([...rules.DECORATION_PRODUCT_IDS].sort(), serverRanch.map((product) => product.id).sort());
  assert.deepEqual(Object.fromEntries(serverRanch.map((product) => [product.id, product.price])), {
    ranch_frame_kurokawa: 5_000,
    ranch_frame_kusari: 8_000,
    ranch_frame_bara: 10_000,
    ranch_frame_kinbuchi: 15_000,
    ranch_frame_gyokuza: 30_000,
    ranch_seal_square: 3_000,
    ranch_seal_oval: 4_000,
    ranch_seal_heart: 5_000,
    ranch_seal_crown: 6_000,
    ranch_seal_wax: 8_000,
    ranch_ink_ai: 1_000,
    ranch_ink_sumi: 1_000,
    ranch_ink_sakura: 2_000,
    ranch_ink_kin: 3_000,
  }, "the prices agreed for the ranch shelf");
  assert.deepEqual(deco.CARD_FRAMES.map((entry) => entry.id), [rules.DEFAULT_FRAME, ...rules.CARD_FRAMES]);
  assert.deepEqual(deco.SEAL_SHAPES.map((entry) => entry.id), [...rules.SEAL_SHAPES]);
  assert.deepEqual(deco.SEAL_INKS.map((entry) => entry.id), [...rules.SEAL_INKS]);
  assert.equal(deco.SEAL_SHAPES[0].id, rules.DEFAULT_SEAL_SHAPE);
  assert.equal(deco.SEAL_INKS[0].id, rules.DEFAULT_SEAL_INK);
  for (const list of [deco.CARD_FRAMES, deco.SEAL_SHAPES, deco.SEAL_INKS]) {
    assert.equal(list[0].price, 0, "the default of each slot is free");
    assert.equal(list[0].productId, "");
  }
  for (const value of [{}, null, { frame: "gyokuza", sealShape: "wax", sealInk: "kin" }, { frame: "<b>", sealShape: "star", sealInk: "#000" }, { frame: "kusari", sealShape: "date", sealInk: "ai" }]) {
    assert.deepEqual(deco.normalizeDecorations(value), rules.normalizeDecorations(value), JSON.stringify(value));
    assert.deepEqual(deco.requiredDecorationProducts(value), rules.requiredDecorationProducts(rules.normalizeDecorations(value)), JSON.stringify(value));
  }
  assert.equal(deco.DECORATION_FUND_PERCENT * 100, rules.DECORATION_FUND_BASIS_POINTS);

  // Realtime Database の持ち物の検証にも同じ ID が入っている（ストアの商品と同じ扱い）。
  const inventory = JSON.parse(read("database.rules.json")).rules.online.economy.$uid.inventory.$productId[".validate"];
  for (const id of rules.DECORATION_PRODUCT_IDS) {
    const [, prefix, suffix] = id.match(/^(ranch_(?:frame|seal|ink)_)(.+)$/);
    assert.match(inventory, new RegExp(`\\^${prefix}\\([^)]*\\b${suffix}\\b`), id);
  }
});

test("the manager card accepts decorations and up to three achievements, and the fund takes 20% of each sale", () => {
  const base = { personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0 };
  const plain = rules.normalizeManagerCard(base).card;
  assert.deepEqual({ frame: plain.frame, sealShape: plain.sealShape, sealInk: plain.sealInk, achievements: plain.achievements }, { frame: "", sealShape: "date", sealInk: "shu", achievements: [] });
  const decorated = rules.normalizeManagerCard({ ...base, frame: "kinbuchi", sealShape: "crown", sealInk: "kin", achievements: ["battle_total_10", "battle_total_10", "Bad Id", "tribute_manager_1", "tribute_wallet_3", "battle_total_30"] }).card;
  assert.deepEqual(decorated.achievements, ["battle_total_10", "tribute_manager_1", "tribute_wallet_3"]);
  assert.deepEqual(rules.requiredDecorationProducts(decorated), ["ranch_frame_kinbuchi", "ranch_seal_crown", "ranch_ink_kin"]);
  assert.deepEqual(rules.requiredDecorationProducts(plain), []);
  assert.equal(rules.decorationFundShare(30_000), 6_000);
  assert.equal(rules.decorationFundShare(1_000), 200);
  assert.equal(rules.decorationFundShare(0), 0);
  assert.equal(rules.decorationFundShare(-5), 0);

  // サーバー: 保存する時に、持っているか・解除しているかを確かめる。
  const save = sourceBlock(service, "async function saveProfileAction", "async function decorationsAction");
  assert.match(save, /requiredDecorationProducts\(cardValues\)\.map\(\(productId\) => transaction\.get\(purchaseRef\(uid, productId\)\)\)/);
  assert.match(save, /持っていない飾りは保存できません/);
  assert.match(save, /!unlocked\[id\] \|\| !ACHIEVEMENT_BY_ID\.has\(id\)/);
  assert.match(sourceBlock(service, "async function decorationsAction", "// 今日のひとこと"), /\.where\("productId", "in", \[\.\.\.DECORATION_PRODUCT_IDS\]\)/);
  assert.doesNotMatch(sourceBlock(service, "async function decorationsAction", "// 今日のひとこと"), /\.set\(|\.update\(|\.create\(/, "reading decorations never writes");
  assert.match(service, /const marks = \{ receivedAt: ctx\.now, seal, \.\.\.sealLook\(ctx\.profiles\.manager\.value\.card\)/, "the seal look is stamped when it is pressed");

  // 購入: 飾りの売上の20%を、同じトランザクションでその月の牧場基金へ。対戦の装備には付けない。
  const purchase = sourceBlock(indexSource, "async function purchaseProduct", "async function claimPeriods");
  assert.match(purchase, /const ranchDecoration = TRIBUTE_DECORATION_PRODUCT_TYPES\.includes\(product\.type\);/);
  assert.match(purchase, /fund \? transaction\.get\(fund\) : Promise\.resolve\(null\)/);
  assert.match(purchase, /const share = tributeDecorationFundShare\(product\.price\);[\s\S]*?balance: count\(fundValue\.balance\) \+ share,[\s\S]*?shopIncome: count\(fundValue\.shopIncome\) \+ share,/);
  const fundWrite = purchase.indexOf("transaction.set(fund,");
  assert.ok(fundWrite > purchase.indexOf("transaction.create(purchase,") && fundWrite < purchase.indexOf('result = { outcome: "purchased"'), "the fund share is written with the purchase");
  assert.match(purchase, /if \(!ranchDecoration\) await autoEquipProduct\(uid, product\);/);
});

test("seals keep one look per shape and ink, escape their words, and frames only take known names", async () => {
  const deco = await loadDeco();
  const at = Date.parse("2026-10-09T23:41:00+09:00");
  for (const shape of deco.SEAL_SHAPES) {
    const svg = deco.sealSvg({ label: "<b>", name: "a&b", at, size: 52, shape: shape.id, ink: "ai", rough: false });
    assert.match(svg, new RegExp(`class="tribute-seal is-${shape.id}"`));
    assert.match(svg, /&lt;b&gt;/);
    assert.match(svg, /a&amp;b/);
    assert.match(svg, /26\.10\.09/);
    assert.doesNotMatch(svg, /<b>|feTurbulence/);
  }
  assert.match(deco.sealSvg({ label: "受領", name: "ミオ様", at, shape: "heart", ink: "ai" }), /stroke="#7aa2ff"/, "a seal on the dark screen uses the bright ink");
  assert.match(deco.sealSvg({ label: "受領", name: "ミオ様", at, shape: "heart", ink: "ai", surface: "paper" }), /stroke="#1f3f8f"/, "a seal on paper uses the deep ink");
  assert.match(deco.sealSvg({ label: "受領", name: "ミオ様", at, shape: "wax", ink: "sakura" }), /<polygon[^>]*fill="url\(#/);
  assert.match(deco.sealSvg({ label: "受領", name: "ミオ様", at, shape: "unknown", ink: "unknown" }), /class="tribute-seal is-date"[\s\S]*stroke="#ff5a4e"/, "unknown looks fall back to 日付印・朱");
  assert.equal(deco.frameAttr("gyokuza"), ' data-frame="gyokuza" data-frame-color="crimson"', "no color means the frame's first color");
  assert.equal(deco.frameAttr("gyokuza", "pink"), ' data-frame="gyokuza" data-frame-color="pink"');
  assert.equal(deco.frameAttr("kusari", "crimson"), ' data-frame="kusari" data-frame-color="silver"', "a color of another frame falls back");
  assert.equal(deco.frameAttr(""), "");
  assert.equal(deco.frameAttr('" onmouseover="alert(1)'), "");
  assert.equal(deco.frameAttr("bara", '" onmouseover="alert(1)'), ' data-frame="bara" data-frame-color="red"');
  for (const id of rules.CARD_FRAMES) {
    assert.match(styles, new RegExp(`\\[data-frame="${id}"\\]`), id);
  }
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\[data-frame="gyokuza"\]::after \{ animation: none;/);
  // 共有画像の印は canvas で同じ形を描く。
  const tributeShare = await (async () => {
    globalThis.document = globalThis.document || {};
    return import(pathToFileURL(path.join(root, "tribute-share.mjs")).href);
  })();
  assert.equal(typeof tributeShare.renderRecruitImage, "function");
  assert.match(tributeShare.sealSvg({ label: "受領", name: "ミオ様", at, shape: "crown", ink: "kin", rough: false }), /class="tribute-seal is-crown"/, "the share module re-exports the shared seal");
  // 画面・ストア・共有画像は同じ URL で読み込み、ブラウザでは1つのモジュールになる。
  const specifier = './tribute-deco.mjs?v=ranch-frame-color-v1"';
  for (const [name, source] of [["tribute.js", client], ["tribute-share.mjs", share], ["online.js", online]]) {
    assert.ok(source.includes(`from "${specifier}`), name);
  }
  assert.match(share, /new Path2D\(HEART_PATH\)/);
  assert.match(share, /new Path2D\(CROWN_PATH\)/);
  assert.match(share, /waxPoints\(\)/);
});

test("the card shows the frame and up to three achievements, and the editor lets managers try before they buy", () => {
  const card = sourceBlock(client, "function renderManagerCard", "function renderBoard");
  assert.match(card, /\$\{frameAttr\(card\.frame, card\.frameColor\)\}/);
  assert.match(card, /\$\{cardAchievementsMarkup\(card\.achievements\)\}/);
  // 中の人の札・入場料・管理中の人数は、枠があっても同じ場所に出る。
  assert.match(card, /\$\{disclosureTag\(card\.disclosure\)\}/);
  assert.match(card, /入場料 <b>\$\{escapeHtml\(formatPay\(card\.entryFee\)\)\}<\/b>/);
  assert.match(card, /管理中 <b>\$\{Number\(card\.activeContracts \|\| 0\)\}<\/b>/);
  assert.match(sourceBlock(client, "function renderManagerDetail", "function renderApply"), /tribute-profile" style="--sigil:\$\{sigilColor\(card\)\}"\$\{frameAttr\(card\.frame, card\.frameColor\)\}/);
  const achievements = sourceBlock(client, "function cardAchievementsMarkup", "// preview:");
  assert.match(achievements, /\.slice\(0, CARD_ACHIEVEMENT_LIMIT\)/);
  assert.match(achievements, /escapeHtml\(entry\.name\)/);

  const editor = sourceBlock(client, "// ───────────── 牧場の飾り ─────────────", "function renderAvatarChoices");
  assert.match(editor, /試着中は保存できません/);
  assert.match(editor, /economyActionCallable\(\{ action: "purchase", productId \}\)/);
  assert.match(editor, /if \(previewScreen\) \{[\s\S]*?見本では Pay を動かさず/, "the preview never spends Pay");
  assert.match(editor, /window\.confirm\(/, "buying asks first");
  assert.match(editor, /買い切りで、払い戻しはありません。売上の\$\{DECORATION_FUND_PERCENT\}%は牧場基金に積まれます。/);
  assert.match(editor, /<input type="hidden" name="\$\{name\}" value="\$\{escapeHtml\(value\)\}" \/>/, "a card saved while items are loading keeps its decorations");
  assert.match(editor, /<input type="hidden" name="achievements" value=/);
  assert.match(sourceBlock(client, 'case "card": {', 'case "word": {'), /if \(decorationsTried\(formDecorations\(form\)\)\.length\) return setFormError\(form, "試着中の飾りがあります。/);
  assert.match(sourceBlock(client, "function renderCardEditor", "function renderSealSettings"), /data-card-save \$\{state\.busy \|\| decorationsTried\(normalizeDecorations\(card\)\)\.length \? "disabled" : ""\}/);
  assert.match(client, /if \(screen === "card"\) loadDecorations\(\);/, "items are read only when the editor opens");
  assert.match(client, /カードに出す実績は\$\{CARD_ACHIEVEMENT_LIMIT\}つまでです。/);

  // 受け取る時は管理人のいまの形と朱肉で押し、押した印はその献上の記録の形で描く。
  assert.match(sourceBlock(client, "function renderReceiveControls", "function renderTally"), /shape: look\.sealShape, ink: look\.sealInk/);
  assert.match(sourceBlock(client, "function renderEvent", "function renderThreadHead"), /shape: event\.sealShape, ink: event\.sealInk/);
  assert.match(client, /shape: receipt\.sealShape, ink: receipt\.sealInk, surface: "paper"/);
  // 管理人を伏せた貢ぎ報告の画像は、標準の印で描く。
  assert.match(sourceBlock(client, "function shareReceiptData", "function shareExcerptData"), /sealShape: info\.consent \? source\.sealShape : "",\s*sealInk: info\.consent \? source\.sealInk : ""/);
  assert.match(sourceBlock(client, "function shareExcerptData", "function shareFileName"), /sealShape: info\.consent \? tribute\.sealShape : "",\s*sealInk: info\.consent \? tribute\.sealInk : ""/);
});

test("the recruit image is drawn on the manager's device with the disclosure, the payer's control and no URL", () => {
  const recruit = sourceBlock(share, "// ───────────── 財布募集の画像 ─────────────", "export function canvasToPngBlob");
  assert.doesNotMatch(recruit, /https?:\/\/|x\.com|gazostadium|workers\.dev|web\.app/);
  assert.doesNotMatch(recruit, /new Image\(|drawImage\(svg|data:image\/svg/, "frames are drawn on the canvas, not from SVG images");
  assert.match(recruit, /manager\.disclosureLabel/);
  assert.match(recruit, /\/\/ 中の人の札（最初の札）は必ず入れる。/);
  assert.match(recruit, /\["上限と解約は", false\], \["財布が握る", true\]/);
  assert.match(recruit, /\["現金なし", true\]/);
  assert.match(recruit, /paintFooter\(ctx\);/, "the AnjuPay notice is on every image");
  for (const id of rules.CARD_FRAMES) assert.match(recruit, new RegExp(`frame === "${id}"`), id);

  const sheet = sourceBlock(client, "function openRecruit", "function downloadShareBlob");
  assert.match(sheet, /renderRecruitImage\(recruitData\(card, month\)\)/);
  assert.match(sheet, /disclosureLabel: DISCLOSURE_LABELS\[disclosureKey\]/, "the full disclosure label, not the short tag");
  assert.match(sheet, /text: `\$\{inviteText\(card\)\}\\n\$\{url\}`/, "the invite link goes in the post text");
  assert.match(sheet, /画像にURLは入りません/);
  assert.doesNotMatch(sheet, /fetch\(|uploadBytes|storage/i, "the image is never uploaded");
  assert.match(sourceBlock(client, "function renderInvite", "// 今日のひとこと（管理人だけ）"), /data-t="recruit-open">財布募集の画像を作る<\/button>/);
});

test("the AnjuPay store sells the ranch shelf with a confirmation and the fund share, and the design doc records the rules", () => {
  assert.match(online, /import \{ DECORATION_FUND_PERCENT, RANCH_DECORATION_PRODUCTS, frameAttr as ranchFrameAttr, sealSvg as ranchSealSvg \} from "\.\/tribute-deco\.mjs\?v=ranch-frame-color-v1";/);
  assert.match(online, /<span class="tribute-deco-swatch"\$\{ranchFrameAttr\(product\.deco\)\}><\/span>/, "store swatches get their color variables");
  assert.match(online, /枠は5色から選べ、どの枠にもピンクがあります（色は追加料金なし）。/);
  assert.match(online, /\.\.\.CHAT_COSMETIC_PRODUCTS,\r?\n  \.\.\.RANCH_DECORATION_PRODUCTS,\r?\n\];/);
  assert.match(online, /<h2 id="shopRanchTitle">お貢ぎ牧場の飾り<\/h2>/);
  assert.match(online, /売上の<b>\$\{DECORATION_FUND_PERCENT\}%<\/b>は牧場基金に積まれ/);
  assert.match(online, /飾りは見た目だけで、掲示板の並び順・手数料・番付には影響しません。/);
  assert.match(online, /if \(RANCH_DECORATION_TYPES\.has\(product\.type\)\) \{\s*const after = Math\.max\(0, state\.economy\.points - product\.price\);\s*const confirmed = window\.confirm\(/);
  assert.match(online, /購入済み・牧場のカード編集で選ぶ/);
  assert.match(client, /<div><dt>飾りの売上から<\/dt>/);

  assert.match(design, /牧場の飾り/);
  assert.match(design, /売上の20%/);
  assert.match(design, /財布募集の画像/);
  assert.match(design, /実績（3つまで）|実績を3つまで/);
});

test("each frame has five free colors with a pink one, mirrored on the server and drawn only through color variables", async () => {
  const deco = await loadDeco();
  assert.deepEqual(Object.keys(deco.FRAME_PALETTES), [...rules.CARD_FRAMES]);
  for (const frame of rules.CARD_FRAMES) {
    const ids = deco.FRAME_PALETTES[frame].map((palette) => palette.id);
    assert.deepEqual(ids, [...rules.FRAME_COLORS[frame]], frame);
    assert.equal(ids.length, 5, frame);
    assert.ok(ids.some((id) => id.includes("pink")), `${frame} has a pink color`);
    assert.ok(deco.FRAME_PALETTES[frame].some((palette) => /ピンク|桃/.test(palette.name)), `${frame} names its pink`);
    for (const value of [{ frame }, { frame, frameColor: ids[1] }, { frame, frameColor: "nope" }]) {
      assert.deepEqual(deco.normalizeDecorations(value), rules.normalizeDecorations(value), JSON.stringify(value));
    }
    // 色は無料: 色を変えても、持っている必要があるのは枠だけ。
    for (const color of ids) {
      assert.deepEqual(rules.requiredDecorationProducts(rules.normalizeDecorations({ frame, frameColor: color })), [`ranch_frame_${frame}`]);
    }
    for (const palette of deco.FRAME_PALETTES[frame]) {
      const rule = deco.frameColorRule(frame, palette.id);
      assert.ok(rule.startsWith(`[data-frame="${frame}"][data-frame-color="${palette.id}"] { `), `${frame}:${palette.id}`);
      assert.doesNotMatch(rule, /<|javascript:|expression\(/i);
      for (const [name] of Object.entries(deco.frameVars(frame, palette.id))) assert.match(name, /^--fr-[a-z0-9-]+$/);
    }
  }
  assert.deepEqual(rules.normalizeDecorations({ frame: "", frameColor: "pink" }).frameColor, "");
  // 1色目は、色を選ぶ前の見た目と同じ。
  assert.deepEqual(deco.FRAME_PALETTES.gyokuza[0].m, ["#8a6a24", "#fff0bf", "#c79a3a", "#fff3c8"]);
  assert.equal(deco.FRAME_PALETTES.kusari[0].metal.join(), "#f4f6fa,#a3a9b4,#585d68");

  // tribute.css は色を持たず、変数で描く（文字の色と位置には触れない）。
  const frames = sourceBlock(styles, "/* ───────────── 牧場の飾り：カードの枠", "/* 牧場のカードに出す実績（3つまで） */");
  assert.doesNotMatch(frames, /data:image\/svg/);
  for (const name of ["--fr-a", "--fr-chain", "--fr-lace", "--fr-rose", "--fr-crown", "--fr-stitch", "--fr-m1", "--fr-fl-tl"]) assert.ok(frames.includes(`var(${name})`), name);
  assert.doesNotMatch(frames, /\bcolor:\s*var\(--fr/, "frame colors never change the text color");

  const editor = sourceBlock(client, "// 枠の色。持っている枠なら", "function renderDecorationTrial");
  assert.match(editor, /name="frameColor" value="\$\{palette\.id\}"/);
  assert.match(editor, /どの色も追加料金なし/);
  assert.match(sourceBlock(client, "function formDecorations", "function decorationStatus"), /frameColor: pick\("frameColor"\)/);
  assert.match(share, /paintFrame\(ctx, look\.frame, box, manager\.color, look\.frameColor\);/);
  assert.match(sourceBlock(share, "function paintFrame", "// 文字を幅で折り返す"), /const palette = framePalette\(frame, frameColor\);/);
  assert.match(design, /枠の色/);
});
