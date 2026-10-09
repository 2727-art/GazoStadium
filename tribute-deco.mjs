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

export function normalizeDecorations(value) {
  const decorations = {};
  for (const [key, list] of Object.entries(SLOTS)) {
    const requested = String(value?.[key] ?? "");
    decorations[key] = list.some((entry) => entry.id === requested) ? requested : FALLBACKS[key];
  }
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

// 掲示板・詳細・編集のカードに付ける属性。枠のないカードには何も付けない。
export function frameAttr(frame) {
  const id = normalizeDecorations({ frame }).frame;
  return id ? ` data-frame="${id}"` : "";
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
