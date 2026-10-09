// お貢ぎ牧場の飾り（カードの枠・受取印の形・朱肉の色）。AnjuPayストアで買い切り、管理人カードで選ぶ。
// 商品ID・値段は functions/product-catalog.js、選べる値は functions/tribute-rules.js の DECORATION_SLOTS と揃える。
// 飾りが変えるのは見た目だけで、中の人の札・入場料・管理中の人数・掲示板の並び順・手数料には触れない。

export const RANCH_DECORATION_PRODUCTS = Object.freeze([
  Object.freeze({ id: "ranch_frame_kurokawa", type: "ranchFrame", deco: "kurokawa", name: "黒革", price: 5000, description: "縫い目の走る黒い革。静かに威圧する枠。" }),
  Object.freeze({ id: "ranch_frame_kusari", type: "ranchFrame", deco: "kusari", name: "鎖", price: 8000, description: "銀の鎖でカードを囲う。逃がさない枠。" }),
  Object.freeze({ id: "ranch_frame_bara", type: "ranchFrame", deco: "bara", name: "薔薇とレース", price: 10000, description: "深い赤に白いレースと薔薇。甘く囲う枠。" }),
  Object.freeze({ id: "ranch_frame_kinbuchi", type: "ranchFrame", deco: "kinbuchi", name: "金縁の額", price: 15000, description: "金の額縁に入れて飾る。格上を見せる枠。" }),
  Object.freeze({ id: "ranch_frame_gyokuza", type: "ranchFrame", deco: "gyokuza", name: "玉座", price: 30000, special: true, description: "赤いビロードと金の冠。光がゆっくり流れる最高級の枠。" }),
  Object.freeze({ id: "ranch_seal_square", type: "ranchSealShape", deco: "square", name: "角印", price: 3000, description: "四角い角印。事務的な受領に。" }),
  Object.freeze({ id: "ranch_seal_oval", type: "ranchSealShape", deco: "oval", name: "小判", price: 4000, description: "横長の楕円の検印。" }),
  Object.freeze({ id: "ranch_seal_heart", type: "ranchSealShape", deco: "heart", name: "ハート", price: 5000, description: "ハートの形の受取印。" }),
  Object.freeze({ id: "ranch_seal_crown", type: "ranchSealShape", deco: "crown", name: "王冠", price: 6000, description: "冠を戴いた受取印。" }),
  Object.freeze({ id: "ranch_seal_wax", type: "ranchSealShape", deco: "wax", name: "蝋封", price: 8000, description: "封蝋で封じる印。朱肉の色が蝋の色になる。" }),
  Object.freeze({ id: "ranch_ink_ai", type: "ranchSealInk", deco: "ai", name: "藍の朱肉", price: 1000, description: "藍色で押す。どの形の印にも使える。" }),
  Object.freeze({ id: "ranch_ink_sumi", type: "ranchSealInk", deco: "sumi", name: "墨の朱肉", price: 1000, description: "墨色で押す。どの形の印にも使える。" }),
  Object.freeze({ id: "ranch_ink_sakura", type: "ranchSealInk", deco: "sakura", name: "桜の朱肉", price: 2000, description: "桜色で押す。どの形の印にも使える。" }),
  Object.freeze({ id: "ranch_ink_kin", type: "ranchSealInk", deco: "kin", name: "金の朱肉", price: 3000, description: "金の朱肉。レシートでは金茶、画面では金に光る。" }),
]);

// 売上のうち牧場基金に積む割合（%）。サーバーの DECORATION_FUND_BASIS_POINTS と同じ。
export const DECORATION_FUND_PERCENT = 20;

export const DEFAULT_FRAME = "";
export const DEFAULT_SEAL_SHAPE = "date";
export const DEFAULT_SEAL_INK = "shu";

// 朱肉の色。paper はレシートの紙の上、dark は暗い画面の上で使う。
const INK_COLORS = Object.freeze({
  shu: Object.freeze({ paper: "#d3261f", dark: "#ff5a4e" }),
  ai: Object.freeze({ paper: "#1f3f8f", dark: "#7aa2ff" }),
  sumi: Object.freeze({ paper: "#24202b", dark: "#d9d3e2" }),
  sakura: Object.freeze({ paper: "#d4447e", dark: "#ff8fbf" }),
  kin: Object.freeze({ paper: "#a8781c", dark: "#f0c66b" }),
});

const productsOf = (type) => RANCH_DECORATION_PRODUCTS.filter((product) => product.type === type);
const choice = (product) => Object.freeze({ id: product.deco, productId: product.id, name: product.name, price: product.price, special: product.special === true });

export const CARD_FRAMES = Object.freeze([
  Object.freeze({ id: DEFAULT_FRAME, productId: "", name: "標準", price: 0, special: false }),
  ...productsOf("ranchFrame").map(choice),
]);
export const SEAL_SHAPES = Object.freeze([
  Object.freeze({ id: DEFAULT_SEAL_SHAPE, productId: "", name: "日付印", price: 0, special: false }),
  ...productsOf("ranchSealShape").map(choice),
]);
export const SEAL_INKS = Object.freeze([
  Object.freeze({ id: DEFAULT_SEAL_INK, productId: "", name: "朱", price: 0, special: false, ...INK_COLORS.shu }),
  ...productsOf("ranchSealInk").map((product) => Object.freeze({ ...choice(product), name: product.name.replace("の朱肉", ""), ...INK_COLORS[product.deco] })),
]);

const SLOTS = Object.freeze({
  frame: CARD_FRAMES,
  sealShape: SEAL_SHAPES,
  sealInk: SEAL_INKS,
});
const FALLBACKS = Object.freeze({ frame: DEFAULT_FRAME, sealShape: DEFAULT_SEAL_SHAPE, sealInk: DEFAULT_SEAL_INK });

// ───────────── 枠の色 ─────────────
// 持っている枠なら、どの色も追加料金なし。どの枠にもピンク系を入れ、1色目はいまの色。
// 背景はどの色でも暗いまま（白い文字が読めるように）。サーバーの FRAME_COLORS と同じ並び。
// a/b/c は背景、metal は金属（明→暗）、m は金縁と玉座の縁のグラデーション、dot は色の丸。
export const FRAME_PALETTES = Object.freeze({
  kurokawa: Object.freeze([
    Object.freeze({ id: "black", name: "黒", a: "#2c201c", b: "#171112", c: "#120d0f", stitch: "rgba(232, 194, 122, 0.62)", dot: ["#2c201c", "#e8c27a"] }),
    Object.freeze({ id: "pink", name: "ピンク", a: "#5c1a3e", b: "#2e0c20", c: "#200816", stitch: "rgba(255, 170, 210, 0.78)", dot: ["#7a2452", "#ffaad2"] }),
    Object.freeze({ id: "brown", name: "焦げ茶", a: "#4a2e1c", b: "#24160d", c: "#1a0f08", stitch: "rgba(241, 220, 176, 0.66)", dot: ["#5a3822", "#f1dcb0"] }),
    Object.freeze({ id: "bordeaux", name: "ボルドー", a: "#4e1222", b: "#260810", c: "#1a050b", stitch: "rgba(232, 194, 122, 0.62)", dot: ["#5e1628", "#e8c27a"] }),
    Object.freeze({ id: "navy", name: "濃紺", a: "#1c2a48", b: "#0e1526", c: "#0a0f1c", stitch: "rgba(207, 212, 221, 0.66)", dot: ["#22325a", "#cfd4dd"] }),
  ]),
  kusari: Object.freeze([
    Object.freeze({ id: "silver", name: "銀", a: "#23262e", b: "#15161b", metal: ["#f4f6fa", "#a3a9b4", "#585d68"], dot: ["#23262e", "#cfd4dd"] }),
    Object.freeze({ id: "pinkgold", name: "ピンクゴールド", a: "#2e1724", b: "#180b13", metal: ["#ffe6f0", "#f29bbf", "#9a4566"], dot: ["#2e1724", "#f29bbf"] }),
    Object.freeze({ id: "gold", name: "金", a: "#2a2418", b: "#16120b", metal: ["#fff4c9", "#d9ac4c", "#7d5d1c"], dot: ["#2a2418", "#d9ac4c"] }),
    Object.freeze({ id: "iron", name: "黒鉄", a: "#18181c", b: "#0c0c0f", metal: ["#8a8f99", "#4a4e57", "#1e2026"], dot: ["#18181c", "#6a6f79"] }),
    Object.freeze({ id: "chrome", name: "クローム青", a: "#152233", b: "#0b111b", metal: ["#e8f4ff", "#7fb2e6", "#2f5582"], dot: ["#152233", "#7fb2e6"] }),
  ]),
  bara: Object.freeze([
    Object.freeze({ id: "red", name: "赤薔薇", a: "#3a0f1f", b: "#1c0a12", glow: "rgba(176, 21, 63, 0.4)", lace: "#f5e4ea", rose: ["#b0153f", "#6e0a26", "#e2557b"], dot: ["#3a0f1f", "#b0153f"] }),
    Object.freeze({ id: "pink", name: "桃薔薇", a: "#3a1430", b: "#1c0a18", glow: "rgba(255, 110, 170, 0.35)", lace: "#ffe4f0", rose: ["#ff7fb0", "#b8346c", "#ffc0d8"], dot: ["#3a1430", "#ff7fb0"] }),
    Object.freeze({ id: "black", name: "黒薔薇", a: "#1e1420", b: "#0f0a10", glow: "rgba(120, 40, 90, 0.3)", lace: "#c9c0cc", rose: ["#2a1420", "#0a0408", "#7a3a5a"], dot: ["#1e1420", "#7a3a5a"] }),
    Object.freeze({ id: "white", name: "白薔薇", a: "#2a2430", b: "#141018", glow: "rgba(240, 230, 240, 0.16)", lace: "#ffffff", rose: ["#f4eef0", "#b9aab4", "#ffffff"], dot: ["#2a2430", "#f4eef0"] }),
    Object.freeze({ id: "blue", name: "青薔薇", a: "#14203e", b: "#0a0f20", glow: "rgba(60, 110, 230, 0.35)", lace: "#dde8ff", rose: ["#2b5fd9", "#16337a", "#7fa6ff"], dot: ["#14203e", "#2b5fd9"] }),
  ]),
  kinbuchi: Object.freeze([
    Object.freeze({ id: "gold", name: "金", a: "#221a14", b: "#141016", glow: "rgba(232, 194, 122, 0.16)", line: "rgba(232, 194, 122, 0.55)", m: ["#7d5d1c", "#f7e4a6", "#b8892b", "#fff2c4", "#9a7224", "#f0d48a"], metal: ["#fff2c4", "#d9ac4c", "#8a6a24"], dot: ["#221a14", "#e8c27a"] }),
    Object.freeze({ id: "pinkgold", name: "ピンクゴールド", a: "#26141c", b: "#150b10", glow: "rgba(255, 150, 200, 0.18)", line: "rgba(255, 170, 210, 0.55)", m: ["#8c3f5c", "#ffd6e6", "#e08aae", "#fff0f6", "#a8506f", "#f7b6cf"], metal: ["#fff0f6", "#f08cb4", "#8c3f5c"], dot: ["#26141c", "#f08cb4"] }),
    Object.freeze({ id: "silver", name: "銀", a: "#1a1c22", b: "#101116", glow: "rgba(210, 220, 235, 0.14)", line: "rgba(210, 220, 235, 0.5)", m: ["#5d626c", "#f4f6fa", "#9aa0ab", "#ffffff", "#6c717b", "#d9dde6"], metal: ["#ffffff", "#b9bfca", "#5d626c"], dot: ["#1a1c22", "#d9dde6"] }),
    Object.freeze({ id: "rosegold", name: "ローズゴールド", a: "#24161a", b: "#140d10", glow: "rgba(240, 170, 170, 0.16)", line: "rgba(240, 175, 170, 0.55)", m: ["#7a3f3a", "#ffd9cf", "#c47e72", "#ffe8e0", "#8f4c45", "#f0b8a8"], metal: ["#ffe8e0", "#d99a8c", "#7a3f3a"], dot: ["#24161a", "#d99a8c"] }),
    Object.freeze({ id: "blackgold", name: "黒金", a: "#141210", b: "#0a0908", glow: "rgba(232, 194, 122, 0.1)", line: "rgba(232, 194, 122, 0.45)", m: ["#0e0d0c", "#3a3328", "#18150f", "#4a4130", "#0e0d0c", "#2e2820"], metal: ["#fff2c4", "#d9ac4c", "#8a6a24"], dot: ["#0e0d0c", "#d9ac4c"] }),
  ]),
  gyokuza: Object.freeze([
    Object.freeze({ id: "crimson", name: "深紅", a: "#6a1326", b: "#2c0812", c: "#190409", glow: "rgba(255, 196, 92, 0.28)", line: "rgba(255, 215, 130, 0.35)", m: ["#8a6a24", "#fff0bf", "#c79a3a", "#fff3c8"], metal: ["#fff4c9", "#e2b04f", "#8a6a24"], crownLine: "#5c4210", jewels: ["#d3264f", "#3a7bd5"], dot: ["#6a1326", "#e2b04f"] }),
    Object.freeze({ id: "pink", name: "ピンク", a: "#7a1a52", b: "#3a0a26", c: "#200514", glow: "rgba(255, 120, 190, 0.3)", line: "rgba(255, 190, 220, 0.4)", m: ["#8c3f5c", "#ffe0ec", "#e48fb4", "#fff2f8"], metal: ["#fff2f8", "#f0a0c4", "#8c3f5c"], crownLine: "#6e2a48", jewels: ["#ff4fa3", "#b48cff"], dot: ["#7a1a52", "#f0a0c4"] }),
    Object.freeze({ id: "jet", name: "漆黒", a: "#2a2430", b: "#0f0c12", c: "#060508", glow: "rgba(255, 196, 92, 0.22)", line: "rgba(255, 215, 130, 0.35)", m: ["#8a6a24", "#fff0bf", "#c79a3a", "#fff3c8"], metal: ["#fff4c9", "#e2b04f", "#8a6a24"], crownLine: "#5c4210", jewels: ["#d3264f", "#3a7bd5"], dot: ["#2a2430", "#e2b04f"] }),
    Object.freeze({ id: "violet", name: "紫紺", a: "#3e1a5c", b: "#1a0b2a", c: "#0e0618", glow: "rgba(200, 150, 255, 0.26)", line: "rgba(220, 190, 255, 0.35)", m: ["#8a6a24", "#fff0bf", "#c79a3a", "#fff3c8"], metal: ["#fff4c9", "#e2b04f", "#8a6a24"], crownLine: "#5c4210", jewels: ["#9b5cff", "#ff4fa3"], dot: ["#3e1a5c", "#e2b04f"] }),
    Object.freeze({ id: "lapis", name: "瑠璃", a: "#163a7a", b: "#0a1a3a", c: "#060e22", glow: "rgba(170, 200, 255, 0.26)", line: "rgba(210, 225, 255, 0.38)", m: ["#5d626c", "#f4f6fa", "#9aa0ab", "#ffffff"], metal: ["#ffffff", "#b9bfca", "#5d626c"], crownLine: "#3e434c", jewels: ["#3a7bd5", "#9fe6ff"], dot: ["#163a7a", "#d9dde6"] }),
  ]),
});

export function framePalette(frame, color) {
  const list = FRAME_PALETTES[frame];
  if (!list) return null;
  return list.find((entry) => entry.id === color) || list[0];
}

export function normalizeDecorations(value) {
  const decorations = {};
  for (const [key, list] of Object.entries(SLOTS)) {
    const requested = String(value?.[key] ?? "");
    decorations[key] = list.some((entry) => entry.id === requested) ? requested : FALLBACKS[key];
  }
  decorations.frameColor = decorations.frame ? framePalette(decorations.frame, String(value?.frameColor ?? "")).id : "";
  return decorations;
}

export function decorationChoice(slot, id) {
  const list = SLOTS[slot] || [];
  return list.find((entry) => entry.id === id) || list[0] || null;
}

// 既定ではない飾りの商品ID（持っていないと保存できないもの）。
export function requiredDecorationProducts(decorations) {
  const normalized = normalizeDecorations(decorations);
  return Object.keys(SLOTS).map((key) => decorationChoice(key, normalized[key])?.productId || "").filter(Boolean);
}

// ───────────── 枠の色の CSS 変数 ─────────────
// tribute.css の枠は var(--fr-…) で描く。色ごとの値（鎖・レース・薔薇・飾り・冠の絵を含む）は、
// 初めて使う時に1度だけ <style id="tribute-frame-colors"> へ足す。

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, " ").trim()).replace(/'/g, "%27")}")`;

function chainArt([high, middle, low]) {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 72 72'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${high}'/><stop offset='.45' stop-color='${middle}'/><stop offset='1' stop-color='${low}'/></linearGradient></defs>
    <g fill='none' stroke='url(#g)' stroke-width='3.4' stroke-linecap='round'>
      <circle cx='12' cy='12' r='6.5'/><circle cx='60' cy='12' r='6.5'/><circle cx='12' cy='60' r='6.5'/><circle cx='60' cy='60' r='6.5'/>
      <path d='M18.5 12H24M12 18.5V24M53.5 12H48M60 18.5V24M18.5 60H24M12 53.5V48M53.5 60H48M60 53.5V48' stroke-width='4'/>
      <ellipse cx='36' cy='12' rx='8.6' ry='5.4'/><ellipse cx='36' cy='60' rx='8.6' ry='5.4'/><ellipse cx='12' cy='36' rx='5.4' ry='8.6'/><ellipse cx='60' cy='36' rx='5.4' ry='8.6'/>
      <path d='M24 12H27.4M44.6 12H48M24 60H27.4M44.6 60H48M12 24V27.4M12 44.6V48M60 24V27.4M60 44.6V48' stroke-width='4'/>
    </g></svg>`);
}

function laceArt(color) {
  const top = `<g fill='none' stroke='${color}' stroke-opacity='.85'>
    <path d='M20 9 A5 5 0 0 1 30 9 A5 5 0 0 1 40 9' stroke-width='1.6'/><line x1='20' y1='15' x2='40' y2='15' stroke-width='1.2'/>
    <circle cx='25' cy='9.6' r='1.3' fill='${color}' stroke='none'/><circle cx='35' cy='9.6' r='1.3' fill='${color}' stroke='none'/>
    <path d='M20 18 H40' stroke-width='.8' stroke-dasharray='1.5 2'/></g>`;
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'>
    ${top}<g transform='rotate(90 30 30)'>${top}</g><g transform='rotate(180 30 30)'>${top}</g><g transform='rotate(270 30 30)'>${top}</g>
    <g fill='${color}' fill-opacity='.85'><circle cx='12' cy='12' r='4'/><circle cx='48' cy='12' r='4'/><circle cx='12' cy='48' r='4'/><circle cx='48' cy='48' r='4'/></g></svg>`);
}

// 薔薇の形（canvas でも同じ形を描く）。
export const ROSE_PATHS = Object.freeze({
  leaves: Object.freeze(["M6 30 Q1 21 11 20 Q12 29 6 30Z", "M30 35 Q39 31 35 23 Q28 27 30 35Z"]),
  highlight: "M11 15 Q20 5 29 15",
  spiral: "M20 11.5 a8.5 8.5 0 1 1 -7.4 12.4 M20 15.5 a4.8 4.8 0 1 1 -4.2 7 M20 19.5 a1.6 1.6 0 1 1 1.1 1.3",
});
export const FLOURISH_PATH = "M3 3 H24 Q30 3 30 9 Q30 14 25 14 Q21 14 21 10 M3 3 V24 Q3 30 9 30 Q14 30 14 25 Q14 21 10 21";
export const THRONE_CROWN_PATH = "M8 32 L4 8 L17 19 L29 3 L41 19 L54 8 L50 32 Z";

function roseArt([petal, dark, light]) {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>
    ${ROSE_PATHS.leaves.map((d) => `<path d='${d}' fill='#3f7d4e'/>`).join("")}
    <circle cx='20' cy='20' r='11.5' fill='${petal}'/><path d='${ROSE_PATHS.highlight}' fill='none' stroke='${light}' stroke-width='1.6'/>
    <path d='${ROSE_PATHS.spiral}' fill='none' stroke='${dark}' stroke-width='1.7'/></svg>`);
}

function flourishArt([high, middle, low], transform) {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><defs><linearGradient id='k' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${high}'/><stop offset='.5' stop-color='${middle}'/><stop offset='1' stop-color='${low}'/></linearGradient></defs>
    <g transform='${transform}' fill='none' stroke='url(#k)' stroke-width='2.4' stroke-linecap='round'><path d='${FLOURISH_PATH}'/><circle cx='9' cy='9' r='3.2' fill='url(#k)' stroke='none'/></g></svg>`);
}

function crownArt(palette) {
  const [high, middle, low] = palette.metal;
  const [center, side] = palette.jewels;
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 58 36'><defs><linearGradient id='c' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${high}'/><stop offset='.55' stop-color='${middle}'/><stop offset='1' stop-color='${low}'/></linearGradient></defs>
    <path d='${THRONE_CROWN_PATH}' fill='url(#c)' stroke='${palette.crownLine}' stroke-width='1.2'/><rect x='8' y='29' width='42' height='5' rx='1.5' fill='${middle}' stroke='${palette.crownLine}' stroke-width='1'/>
    <circle cx='29' cy='22' r='3.4' fill='${center}'/><circle cx='17' cy='24' r='2.4' fill='${side}'/><circle cx='41' cy='24' r='2.4' fill='${side}'/>
    <circle cx='4' cy='8' r='2.4' fill='${high}'/><circle cx='29' cy='3' r='2.6' fill='${high}'/><circle cx='54' cy='8' r='2.4' fill='${high}'/></svg>`);
}

// 枠と色の CSS 変数（値は決まった色と、上の絵だけ。カードの文字には触れない）。
export function frameVars(frame, color) {
  const palette = framePalette(frame, color);
  if (!palette) return {};
  const vars = { "--fr-a": palette.a, "--fr-b": palette.b, "--fr-c": palette.c || palette.b };
  if (frame === "kurokawa") vars["--fr-stitch"] = palette.stitch;
  if (frame === "kusari") vars["--fr-chain"] = chainArt(palette.metal);
  if (frame === "bara") Object.assign(vars, { "--fr-glow": palette.glow, "--fr-lace": laceArt(palette.lace), "--fr-rose": roseArt(palette.rose) });
  if (frame === "kinbuchi" || frame === "gyokuza") {
    Object.assign(vars, { "--fr-glow": palette.glow, "--fr-line": palette.line });
    palette.m.forEach((value, index) => {
      vars[`--fr-m${index + 1}`] = value;
    });
  }
  if (frame === "kinbuchi") {
    Object.assign(vars, {
      "--fr-fl-tl": flourishArt(palette.metal, ""),
      "--fr-fl-tr": flourishArt(palette.metal, "translate(40 0) scale(-1 1)"),
      "--fr-fl-bl": flourishArt(palette.metal, "translate(0 40) scale(1 -1)"),
      "--fr-fl-br": flourishArt(palette.metal, "translate(40 40) scale(-1 -1)"),
    });
  }
  if (frame === "gyokuza") vars["--fr-crown"] = crownArt(palette);
  return vars;
}

export function frameColorRule(frame, color) {
  const palette = framePalette(frame, color);
  if (!palette) return "";
  const body = Object.entries(frameVars(frame, palette.id)).map(([name, value]) => `${name}: ${value};`).join(" ");
  return `[data-frame="${frame}"][data-frame-color="${palette.id}"] { ${body} }`;
}

const injectedFrameRules = new Set();

function ensureFrameRule(frame, color) {
  const key = `${frame}:${color}`;
  if (injectedFrameRules.has(key) || typeof document === "undefined" || typeof document.createElement !== "function" || !document.head) return;
  injectedFrameRules.add(key);
  let sheet = document.getElementById("tribute-frame-colors");
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = "tribute-frame-colors";
    document.head.appendChild(sheet);
  }
  sheet.appendChild(document.createTextNode(`${frameColorRule(frame, color)}\n`));
}

// 掲示板・詳細・編集・ストアのカードに付ける属性。枠のないカードには何も付けない。値は決まった一覧からだけ選ぶ。
export function frameAttr(frame, color = "") {
  const look = normalizeDecorations({ frame, frameColor: color });
  if (!look.frame) return "";
  ensureFrameRule(look.frame, look.frameColor);
  return ` data-frame="${look.frame}" data-frame-color="${look.frameColor}"`;
}

export function inkColor(ink, surface = "dark") {
  const entry = SEAL_INKS.find((candidate) => candidate.id === ink) || SEAL_INKS[0];
  return surface === "paper" ? entry.paper : entry.dark;
}

export function mixColor(hex, other, amount) {
  const parse = (value) => String(value).replace("#", "").match(/\w\w/g).map((pair) => parseInt(pair, 16));
  const from = parse(hex);
  const to = parse(other);
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

// ───────────── 受取印の形 ─────────────
// 300×300 の座標で描き、SVG（画面）と canvas（貢ぎ報告の画像）で同じ形と文字の位置にする。

export const HEART_PATH = "M150 272 C 58 206 16 150 16 100 C 16 54 50 24 92 24 C 120 24 140 40 150 62 C 160 40 180 24 208 24 C 250 24 284 54 284 100 C 284 150 242 206 150 272 Z";
export const CROWN_PATH = "M94 64 L84 18 L120 42 L150 6 L180 42 L216 18 L206 64 Z";
export const CROWN_JEWELS = Object.freeze([[84, 18], [150, 6], [216, 18]]);

// 蝋のふち。決まった波で、毎回同じ形にする。
export function waxPoints() {
  const points = [];
  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    const radius = 134 + 6 * Math.sin(angle * 5 + 1) + 4 * Math.sin(angle * 9 + 2) + 3 * Math.sin(angle * 14);
    points.push([150 + radius * Math.cos(angle), 150 + radius * Math.sin(angle)]);
  }
  return points;
}

const labelText = (label) => Array.from(String(label || "受領")).slice(0, 8).join("");
const ownerText = (name) => Array.from(String(name || "管理人様")).slice(0, 6).join("");
const count = (text) => Array.from(text).length;

// 文字の位置と大きさ。fit の時は幅に詰める（SVG は textLength、canvas は maxWidth）。
export function sealTextLayout(shape, label, name) {
  const top = labelText(label);
  const owner = ownerText(name);
  const length = count(top);
  const pick = (sizes) => sizes[Math.min(length, sizes.length) - 1];
  const ownerFit = count(owner) >= 5;
  switch (shape) {
    case "square":
      return {
        label: { text: top, y: length <= 2 ? 182 : 172, size: pick([86, 80, 64, 50, 40]), width: 206, fit: length >= 5 },
        date: { y: 250, size: 42 },
        name: { text: owner, y: 80, size: 40, width: 200, fit: ownerFit },
      };
    case "oval":
      return {
        label: { text: top, y: 136, size: pick([64, 56, 46, 38, 32]), width: 190, fit: length >= 5 },
        date: { y: 194, size: 36 },
        name: { text: owner, y: 228, size: 27, width: 120, fit: ownerFit },
      };
    case "heart":
      return {
        label: { text: top, y: 138, size: pick([62, 56, 46, 38, 32]), width: 180, fit: length >= 5 },
        date: { y: 180, size: 34 },
        name: { text: owner, y: 215, size: 27, width: 110, fit: ownerFit },
      };
    case "crown":
      return {
        label: { text: top, y: 168, size: pick([62, 56, 46, 38, 32]), width: 188, fit: length >= 5 },
        date: { y: 224, size: 36 },
        name: { text: owner, y: 260, size: 28, width: 110, fit: ownerFit },
      };
    case "wax":
      return {
        label: { text: top, y: 152, size: pick([64, 56, 46, 38, 32]), width: 170, fit: length >= 5 },
        date: { y: 192, size: 30 },
        name: { text: owner, y: 226, size: 26, width: 110, fit: ownerFit },
      };
    default:
      return {
        label: { text: top, y: length >= 6 ? 92 : 98, size: length >= 6 ? 30 : length >= 4 ? 40 : 52, width: 226, fit: length >= 6 },
        date: { y: 171, size: 54 },
        name: { text: owner, y: 246, size: 44, width: 200, fit: ownerFit },
      };
  }
}

export function sealDate(timestamp) {
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "2-digit", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Number(timestamp) || Date.now()));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const SVG_MINCHO = "'Shippori Mincho B1', 'Hiragino Mincho ProN', 'Yu Mincho', serif";
const SVG_NUM = "'Oswald', 'Arial Narrow', sans-serif";
let sealSerial = 0;

function svgTexts(layout, at) {
  const fit = (entry) => (entry.fit ? ` textLength="${entry.width}" lengthAdjust="spacingAndGlyphs"` : "");
  return `<text x="150" y="${layout.label.y}" font-family="${SVG_MINCHO}" font-weight="800" font-size="${layout.label.size}"${fit(layout.label)}>${escapeXml(layout.label.text)}</text>
      <text x="150" y="${layout.date.y}" font-family="${SVG_NUM}" font-weight="600" font-size="${layout.date.size}" letter-spacing="2">${escapeXml(sealDate(at))}</text>
      <text x="150" y="${layout.name.y}" font-family="${SVG_MINCHO}" font-weight="800" font-size="${layout.name.size}"${fit(layout.name)}>${escapeXml(layout.name.text)}</text>`;
}

function svgOutline(shape, color) {
  switch (shape) {
    case "square":
      return `<rect x="20" y="20" width="260" height="260" rx="12" stroke-width="12"/><rect x="38" y="38" width="224" height="224" rx="4" stroke-width="3"/>
      <line x1="38" y1="94" x2="262" y2="94" stroke-width="3"/><line x1="38" y1="210" x2="262" y2="210" stroke-width="3"/>`;
    case "oval":
      return `<ellipse cx="150" cy="150" rx="138" ry="104" stroke-width="10"/><ellipse cx="150" cy="150" rx="122" ry="88" stroke-width="2.5"/>
      <line x1="40" y1="154" x2="260" y2="154" stroke-width="3"/>`;
    case "heart":
      return `<path d="${HEART_PATH}" stroke-width="10" stroke-linejoin="round"/><path d="${HEART_PATH}" transform="translate(150 150) scale(.87) translate(-150 -150)" stroke-width="3"/>`;
    case "crown":
      return `<circle cx="150" cy="172" r="118" stroke-width="10"/><circle cx="150" cy="172" r="104" stroke-width="2.5"/>
      <line x1="52" y1="186" x2="248" y2="186" stroke-width="3"/>
      <path d="${CROWN_PATH}" fill="${color}" stroke-width="2" stroke-linejoin="round"/>
      ${CROWN_JEWELS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${color}" stroke="none"/>`).join("")}`;
    default:
      return `<circle cx="150" cy="150" r="138" stroke-width="10"/>
      <line x1="18" y1="112" x2="282" y2="112" stroke-width="6"/><line x1="18" y1="188" x2="282" y2="188" stroke-width="6"/>`;
  }
}

// 受取印の SVG。shape は形、ink は朱肉の色、surface は押す面（"dark" 画面 / "paper" 紙）。
// rough: インクのかすれ（SVG フィルター）を付けるか。スレッドの小さな印は、描く負担を軽くするため付けない。
export function sealSvg({ label, name, at, size = 120, shape = DEFAULT_SEAL_SHAPE, ink = DEFAULT_SEAL_INK, surface = "dark", rough = true }) {
  const { sealShape, sealInk } = normalizeDecorations({ sealShape: shape, sealInk: ink });
  const id = `tribute-seal-ink-${(sealSerial += 1)}`;
  const layout = sealTextLayout(sealShape, label, name);
  const open = `<svg class="tribute-seal is-${sealShape}" width="${size}" height="${size}" viewBox="0 0 300 300" aria-hidden="true" focusable="false">`;
  if (sealShape === "wax") {
    const base = inkColor(sealInk, "paper");
    const points = waxPoints().map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const texts = svgTexts(layout, at);
    return `${open}<defs><radialGradient id="${id}" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${mixColor(base, "#ffffff", 0.32)}"/><stop offset=".55" stop-color="${base}"/><stop offset="1" stop-color="${mixColor(base, "#000000", 0.45)}"/></radialGradient></defs>
    <polygon points="${points}" fill="url(#${id})" stroke="${sealInk === "sumi" ? "rgba(255,255,255,.28)" : mixColor(base, "#000000", 0.3)}" stroke-width="3"/>
    <circle cx="150" cy="150" r="98" fill="none" stroke="${mixColor(base, "#000000", 0.38)}" stroke-width="7"/>
    <circle cx="148.4" cy="148.4" r="98" fill="none" stroke="${mixColor(base, "#ffffff", 0.3)}" stroke-width="2" opacity=".6"/>
    <g text-anchor="middle"><g fill="${mixColor(base, "#000000", 0.42)}">${texts}</g><g fill="${mixColor(base, "#ffffff", 0.35)}" transform="translate(-1.6 -1.6)" opacity=".55">${texts}</g></g>
  </svg>`;
  }
  const color = inkColor(sealInk, surface);
  return `${open}
    ${rough ? `<defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="2" result="blotch"/>
      <feColorMatrix in="blotch" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.2 1.45" result="mask"/>
      <feComposite in="rough" in2="mask" operator="in"/>
    </filter></defs>` : ""}
    <g ${rough ? `filter="url(#${id})" ` : ""}fill="none" stroke="${color}">
      ${svgOutline(sealShape, color)}
      <g fill="${color}" stroke="none" text-anchor="middle">${svgTexts(layout, at)}</g>
    </g>
  </svg>`;
}
