// お貢ぎ牧場の貢ぎ報告の画像と受取印。画像は財布が自分で作る時だけ、この端末の中で描く（サーバーへは送らない）。
// URL は入れず、「AnjuPay・換金不可・アプリ内ポイント」の表記は必ず入れる。見た目は牧場のもので、実在の決済サービスには似せない。

export const SHARE_WIDTH = 1080;
export const SHARE_HEIGHT = 1350;
export const SHARE_TEXT = "#貢ぎ報告 #お貢ぎ牧場";
export const SEAL_INK = Object.freeze({ paper: "#d3261f", dark: "#ff5a4e" });

const SANS = '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
const MINCHO = '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif';
const DISPLAY = `"Dela Gothic One", ${SANS}`;
const NUM = `"Oswald", "Arial Narrow", ${SANS}`;
const MONO = 'ui-monospace, "Consolas", "Menlo", monospace';
const NIGHT = "#0d0a10";
const TEXT = "#f4ecf6";
const MIST = "rgba(244, 236, 246, 0.66)";
const PINK = "#ff4fa3";
const GOLD = "#e8c27a";
const PAPER = "#f6f0e4";
const INK = "#2a2230";
const GREEN = "#3ddc97";
const DISCLOSURE_COLORS = Object.freeze({ nekama: "#3aa0d8", as_is: "#8a8290", undisclosed: "#8a8290" });

// ───────────── 受取印（日付印）─────────────
// 上段に印の言葉、中段に日付、下段に管理人名。300×300 の座標で描き、SVG と canvas で同じ形にする。

function sealTopFont(label) {
  const length = Array.from(label).length;
  return length >= 6 ? 30 : length >= 4 ? 40 : 52;
}

function sealDate(timestamp) {
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "2-digit", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Number(timestamp) || Date.now()));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

let sealSerial = 0;

// rough: インクのかすれ（SVG フィルター）を付けるか。スレッドの小さな印は、描く負担を軽くするため付けない。
export function sealSvg({ label, name, at, size = 120, ink = SEAL_INK.dark, rough = true }) {
  const id = `tribute-seal-ink-${(sealSerial += 1)}`;
  const top = Array.from(String(label || "受領")).slice(0, 8).join("");
  const length = Array.from(top).length;
  const fit = length >= 6 ? ' textLength="226" lengthAdjust="spacingAndGlyphs"' : "";
  const owner = Array.from(String(name || "管理人様")).slice(0, 6).join("");
  const ownerFit = Array.from(owner).length >= 5 ? ' textLength="200" lengthAdjust="spacingAndGlyphs"' : "";
  return `<svg class="tribute-seal" width="${size}" height="${size}" viewBox="0 0 300 300" aria-hidden="true" focusable="false">
    ${rough ? `<defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="2" result="blotch"/>
      <feColorMatrix in="blotch" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.2 1.45" result="mask"/>
      <feComposite in="rough" in2="mask" operator="in"/>
    </filter></defs>` : ""}
    <g ${rough ? `filter="url(#${id})" ` : ""}fill="none" stroke="${ink}">
      <circle cx="150" cy="150" r="138" stroke-width="10"/>
      <line x1="18" y1="112" x2="282" y2="112" stroke-width="6"/><line x1="18" y1="188" x2="282" y2="188" stroke-width="6"/>
      <g fill="${ink}" stroke="none" text-anchor="middle">
        <text x="150" y="${length >= 6 ? 92 : 98}" font-family='${MINCHO}' font-weight="800" font-size="${sealTopFont(top)}"${fit}>${escapeXml(top)}</text>
        <text x="150" y="171" font-family='${NUM}' font-weight="600" font-size="54" letter-spacing="2">${escapeXml(sealDate(at))}</text>
        <text x="150" y="246" font-family='${MINCHO}' font-weight="800" font-size="44"${ownerFit}>${escapeXml(owner)}</text>
      </g>
    </g>
  </svg>`;
}

// canvas 用。インクのかすれは、小さな点を抜いて表す（毎回同じ形になるよう、決まった種から作る）。
function seededRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) % 10_000) / 10_000;
  };
}

function drawSeal(ctx, { x, y, size, rotation = 0, label, name, at, ink, multiply = false, seed = 7 }) {
  const scale = 2;
  const sealCanvas = document.createElement("canvas");
  sealCanvas.width = 300 * scale;
  sealCanvas.height = 300 * scale;
  const seal = sealCanvas.getContext("2d");
  seal.scale(scale, scale);
  seal.strokeStyle = ink;
  seal.fillStyle = ink;
  seal.lineWidth = 10;
  seal.beginPath();
  seal.arc(150, 150, 138, 0, Math.PI * 2);
  seal.stroke();
  seal.lineWidth = 6;
  for (const lineY of [112, 188]) {
    seal.beginPath();
    seal.moveTo(18, lineY);
    seal.lineTo(282, lineY);
    seal.stroke();
  }
  seal.textAlign = "center";
  const top = Array.from(String(label || "受領")).slice(0, 8).join("");
  const length = Array.from(top).length;
  seal.font = `800 ${sealTopFont(top)}px ${MINCHO}`;
  seal.fillText(top, 150, length >= 6 ? 92 : 98, 226);
  seal.font = `600 54px ${NUM}`;
  seal.fillText(sealDate(at), 150, 171, 250);
  const owner = Array.from(String(name || "管理人様")).slice(0, 6).join("");
  seal.font = `800 44px ${MINCHO}`;
  seal.fillText(owner, 150, 246, 200);
  // かすれ: 大きめのむらと細かい点を抜く。
  const random = seededRandom(seed);
  seal.globalCompositeOperation = "destination-out";
  for (let index = 0; index < 26; index += 1) {
    seal.globalAlpha = 0.25 + random() * 0.45;
    seal.beginPath();
    seal.arc(random() * 300, random() * 300, 6 + random() * 22, 0, Math.PI * 2);
    seal.fill();
  }
  seal.globalAlpha = 1;
  for (let index = 0; index < 900; index += 1) {
    seal.beginPath();
    seal.arc(random() * 300, random() * 300, 0.6 + random() * 1.6, 0, Math.PI * 2);
    seal.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  if (multiply) ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.94;
  ctx.drawImage(sealCanvas, -size / 2, -size / 2, size, size);
  ctx.restore();
}

// ───────────── 共通の描画 ─────────────

function spacing(ctx, value) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${value}px`;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const radii = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
  const [tl, tr, br, bl] = radii.map((value) => Math.min(value, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + width - tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + tr);
  ctx.lineTo(x + width, y + height - br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - br, y + height);
  ctx.lineTo(x + bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function fitFont(ctx, text, maxWidth, size, family, weight = 400, minimum = 18) {
  let current = size;
  ctx.font = `${weight} ${current}px ${family}`;
  while (current > minimum && ctx.measureText(text).width > maxWidth) {
    current -= 2;
    ctx.font = `${weight} ${current}px ${family}`;
  }
  return current;
}

function formatPayNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("ja-JP");
}

function jstParts(timestamp) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(Number(timestamp) || Date.now()));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}.${get("month")}.${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

// decode() は画面が隠れている間は終わらないことがあるため、load を待つ。届かなければ印は文字かシルエットで描く。
function loadImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(null), 4_000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

// フォントは使う文字だけを読み込む（Google Fonts は文字の範囲ごとに分かれている）。待ちすぎないよう打ち切る。
async function loadFonts(text) {
  if (!document.fonts?.load) return;
  // 見出しと最下部の固定の文字は毎回入れる（ここが別のフォントで描かれないように）。
  const sample = `${String(text || "")}お貢ぎ牧場OMITSUGI RANCH・貢ぎ報告管理の記録AnjuPay換金不可アプリ内ポイントで管理されています0123456789.:Pay→♡号の財布`;
  const requests = [
    `800 40px "Shippori Mincho B1"`,
    `400 40px "Dela Gothic One"`,
    `600 40px "Oswald"`,
    `500 40px "Oswald"`,
  ].map((font) => document.fonts.load(font, sample).catch(() => []));
  await Promise.race([Promise.all(requests), new Promise((resolve) => window.setTimeout(resolve, 3_000))]);
}

function paintBackdrop(ctx) {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
  const top = ctx.createRadialGradient(540, -110, 40, 540, -110, 980);
  top.addColorStop(0, "rgba(255, 79, 163, 0.32)");
  top.addColorStop(0.62, "rgba(255, 79, 163, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
  const corner = ctx.createRadialGradient(SHARE_WIDTH, SHARE_HEIGHT, 20, SHARE_WIDTH, SHARE_HEIGHT, 720);
  corner.addColorStop(0, "rgba(193, 61, 255, 0.2)");
  corner.addColorStop(1, "rgba(193, 61, 255, 0)");
  ctx.fillStyle = corner;
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
}

function paintHeader(ctx, subtitle, dateText) {
  ctx.save();
  ctx.shadowColor = "rgba(255, 79, 163, 0.55)";
  ctx.shadowBlur = 28;
  const mark = ctx.createLinearGradient(64, 56, 128, 120);
  mark.addColorStop(0, PINK);
  mark.addColorStop(1, "#8a2be2");
  ctx.fillStyle = mark;
  roundRectPath(ctx, 64, 66, 64, 64, 18);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 36px ${SANS}`;
  ctx.fillText("貢", 96, 99);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEXT;
  ctx.font = `400 40px ${DISPLAY}`;
  spacing(ctx, 1.5);
  ctx.fillText("お貢ぎ牧場", 146, 100);
  ctx.fillStyle = "rgba(244, 236, 246, 0.62)";
  ctx.font = `600 17px ${NUM}`;
  spacing(ctx, 5);
  ctx.fillText(`OMITSUGI RANCH · ${subtitle}`, 146, 138);
  spacing(ctx, 2);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(244, 236, 246, 0.7)";
  ctx.font = `500 30px ${NUM}`;
  ctx.fillText(dateText, SHARE_WIDTH - 64, 112);
  spacing(ctx, 0);
  ctx.textAlign = "left";
}

// どの画像にも必ず入れる表記。
function paintFooter(ctx) {
  const y = SHARE_HEIGHT - 98;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, y);
  ctx.lineTo(SHARE_WIDTH - 64, y);
  ctx.stroke();
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 22px ${SANS}`;
  spacing(ctx, 1);
  ctx.fillStyle = GOLD;
  ctx.fillText("AnjuPay", 64, y + 52);
  const width = ctx.measureText("AnjuPay").width;
  ctx.font = `400 22px ${SANS}`;
  ctx.fillStyle = MIST;
  ctx.fillText("・換金不可・アプリ内ポイント", 64 + width, y + 52);
  ctx.textAlign = "right";
  ctx.fillText("お貢ぎ牧場で管理されています", SHARE_WIDTH - 64, y + 52);
  ctx.textAlign = "left";
  spacing(ctx, 0);
}

// 管理人の印（アイコン）。許可がない時はシルエット。
function paintAvatar(ctx, { image, manager, x, y, radius, ring = PINK, ringWidth = 6 }) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius + ringWidth, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else if (manager?.anonymous) {
    ctx.fillStyle = "#3a3340";
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = "#6c6472";
    ctx.beginPath();
    ctx.arc(x, y - radius * 0.22, radius * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.78, radius * 0.72, radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const color = manager?.color || PINK;
    const fill = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.4, 2, x, y, radius);
    fill.addColorStop(0, "#ffffff");
    fill.addColorStop(0.25, color);
    fill.addColorStop(1, color);
    ctx.fillStyle = fill;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = "#160b14";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.round(radius * 0.95)}px ${SANS}`;
    ctx.fillText(Array.from(manager?.personaName || "管")[0] || "管", x, y + radius * 0.04);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

function paintPill(ctx, { x, y, text, height, font, color, border, fill = "transparent", padding = 16, lineWidth = 2 }) {
  ctx.font = font;
  const width = ctx.measureText(text).width + padding * 2;
  roundRectPath(ctx, x, y, width, height, height / 2);
  if (fill !== "transparent") {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = border;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padding, y + height / 2 + 1);
  ctx.textBaseline = "alphabetic";
  return width;
}

function heartPath(ctx, x, y, width, height) {
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y + height);
  ctx.bezierCurveTo(x + width * 0.1, y + height * 0.66, x - width * 0.02, y + height * 0.36, x + width * 0.1, y + height * 0.18);
  ctx.bezierCurveTo(x + width * 0.22, y, x + width * 0.44, y + height * 0.02, x + width / 2, y + height * 0.22);
  ctx.bezierCurveTo(x + width * 0.56, y + height * 0.02, x + width * 0.78, y, x + width * 0.9, y + height * 0.18);
  ctx.bezierCurveTo(x + width * 1.02, y + height * 0.36, x + width * 0.9, y + height * 0.66, x + width / 2, y + height);
  ctx.closePath();
}

// 首輪: 黒い革のバンドと、番号の入った金のハート。
function paintCollar(ctx, { x, y, owner, collarNo }) {
  const label = `${owner}の財布`;
  ctx.font = `700 26px ${SANS}`;
  spacing(ctx, 1.5);
  const textWidth = ctx.measureText(label).width;
  const width = textWidth + 92;
  roundRectPath(ctx, x, y, width, 54, 27);
  ctx.fillStyle = "#1a1418";
  ctx.fill();
  roundRectPath(ctx, x + 4, y + 4, width - 8, 46, 23);
  ctx.strokeStyle = "rgba(232, 194, 122, 0.55)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const studX of [x + 26, x + width - 26]) {
    const stud = ctx.createRadialGradient(studX - 2, y + 25, 1, studX, y + 27, 7);
    stud.addColorStop(0, "#fff3c9");
    stud.addColorStop(1, "#c9a14f");
    ctx.fillStyle = stud;
    ctx.beginPath();
    ctx.arc(studX, y + 27, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f6e7c8";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 46, y + 28);
  spacing(ctx, 0);
  if (collarNo > 0) {
    const heartX = x + width - 12;
    heartPath(ctx, heartX, y - 14, 92, 84);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.strokeStyle = "#a87b2a";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#4a2c00";
    ctx.textAlign = "center";
    const number = String(collarNo);
    ctx.font = `600 ${number.length >= 3 ? 26 : 34}px ${NUM}`;
    const numberWidth = ctx.measureText(number).width;
    ctx.font = `700 18px ${SANS}`;
    const unitWidth = ctx.measureText("号").width;
    const startX = heartX + 46 - (numberWidth + unitWidth) / 2;
    ctx.textAlign = "left";
    ctx.font = `600 ${number.length >= 3 ? 26 : 34}px ${NUM}`;
    ctx.fillText(number, startX, y + 22);
    ctx.font = `700 18px ${SANS}`;
    ctx.fillText("号", startX + numberWidth, y + 26);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

function paintRewardBubble(ctx, { image, manager, label, right, centerY, size = 46, avatarRadius = 39, rotation = 0 }) {
  ctx.save();
  ctx.font = `900 ${size}px ${SANS}`;
  spacing(ctx, 1);
  const textWidth = ctx.measureText(label).width;
  const bubbleWidth = textWidth + 68;
  const bubbleHeight = size + 44;
  const bubbleX = right - bubbleWidth;
  const avatarX = bubbleX - 16 - avatarRadius;
  ctx.translate((avatarX + right) / 2, centerY);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-(avatarX + right) / 2, -centerY);
  paintAvatar(ctx, { image, manager, x: avatarX, y: centerY, radius: avatarRadius, ringWidth: 4 });
  ctx.shadowColor = "rgba(255, 79, 163, 0.55)";
  ctx.shadowBlur = 36;
  const fill = ctx.createLinearGradient(bubbleX, centerY - bubbleHeight / 2, right, centerY + bubbleHeight / 2);
  fill.addColorStop(0, PINK);
  fill.addColorStop(1, "#c13dff");
  ctx.fillStyle = fill;
  roundRectPath(ctx, bubbleX, centerY - bubbleHeight / 2, bubbleWidth, bubbleHeight, [30, 30, 30, 8]);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, bubbleX + 34, centerY + 2);
  ctx.restore();
}

function canvasFor() {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_WIDTH;
  canvas.height = SHARE_HEIGHT;
  return canvas;
}

function managerPresentation(manager) {
  const anonymous = !manager?.personaName;
  return {
    anonymous,
    personaName: anonymous ? "管理人様" : manager.personaName,
    color: manager?.color || PINK,
    avatarUrl: anonymous ? "" : manager?.avatarUrl || "",
    disclosureKey: manager?.disclosureKey || "undisclosed",
    disclosureLabel: manager?.disclosureLabel || "",
    styleLabel: manager?.styleLabel || "",
  };
}

// ───────────── 単発レシート ─────────────

export async function renderReceiptImage(data, options = {}) {
  const show = { purpose: true, amount: true, marks: true, ...options };
  const manager = managerPresentation(data.manager);
  const created = jstParts(data.createdAt);
  const received = data.receivedAt ? jstParts(data.receivedAt) : null;
  const purposeLabel = show.purpose ? String(data.purposeLabel || "") : "";
  await loadFonts([manager.personaName, purposeLabel, data.sealLabel, data.rewardLabel, data.kindLabel, data.walletLabel, "献上レシート受け取り待ち非譲渡換金不可アプリ内ポイント貢ぎ報告"].join(""));
  const image = await loadImage(manager.avatarUrl);
  const canvas = canvasFor();
  const ctx = canvas.getContext("2d");
  paintBackdrop(ctx);
  paintHeader(ctx, "貢ぎ報告", created.date);

  const paperX = 110;
  const paperY = 190;
  const paperWidth = 860;
  const paperHeight = 1000;
  ctx.save();
  ctx.translate(paperX + paperWidth / 2, paperY + paperHeight / 2);
  ctx.rotate((-1.4 * Math.PI) / 180);
  ctx.translate(-paperWidth / 2, -paperHeight / 2);
  // 紙（下端はギザギザ）
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 30;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(paperWidth, 0);
  ctx.lineTo(paperWidth, paperHeight - 14);
  for (let toothX = paperWidth; toothX > 0; toothX -= 22) {
    ctx.lineTo(toothX - 11, paperHeight);
    ctx.lineTo(Math.max(0, toothX - 22), paperHeight - 14);
  }
  ctx.closePath();
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = INK;
  ctx.font = `800 34px ${MINCHO}`;
  spacing(ctx, 6);
  ctx.fillText("献上レシート", 58, 80);
  spacing(ctx, 1.5);
  ctx.textAlign = "right";
  ctx.font = `500 30px ${NUM}`;
  ctx.fillText(data.receiptNo ? `No.${String(data.receiptNo).padStart(5, "0")}` : "No.—", paperWidth - 58, 80);
  ctx.textAlign = "left";
  spacing(ctx, 0);
  const dashed = (y) => {
    ctx.strokeStyle = "rgba(42, 34, 48, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(58, y);
    ctx.lineTo(paperWidth - 58, y);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  dashed(104);

  paintAvatar(ctx, { image, manager, x: 124, y: 196, radius: 66 });
  ctx.fillStyle = INK;
  fitFont(ctx, manager.personaName, 560, 66, MINCHO, 800, 36);
  ctx.fillText(manager.personaName, 214, 190);
  let tagX = 214;
  if (manager.disclosureLabel) {
    const color = DISCLOSURE_COLORS[manager.disclosureKey] || "#8a8290";
    tagX += paintPill(ctx, { x: tagX, y: 214, text: manager.disclosureLabel, height: 40, font: `700 22px ${SANS}`, color, border: color }) + 10;
  }
  if (manager.styleLabel) {
    paintPill(ctx, { x: tagX, y: 214, text: manager.styleLabel, height: 40, font: `700 22px ${SANS}`, color: INK, border: "rgba(42, 34, 48, 0.4)" });
  }
  if (data.collarNo > 0) paintCollar(ctx, { x: 58, y: 290, owner: manager.personaName, collarNo: data.collarNo });

  if (purposeLabel) {
    ctx.font = `800 40px ${MINCHO}`;
    spacing(ctx, 5);
    const width = ctx.measureText(purposeLabel).width + 68;
    const x = (paperWidth - width) / 2;
    roundRectPath(ctx, x, 380, width, 64, 32);
    ctx.fillStyle = "rgba(255, 79, 163, 0.1)";
    ctx.fill();
    ctx.strokeStyle = "#e0397f";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#b8155a";
    ctx.textBaseline = "middle";
    ctx.fillText(purposeLabel, x + 34, 414);
    ctx.textBaseline = "alphabetic";
    spacing(ctx, 0);
  }

  // 金額。伏せる時は、桁の分からない帯にする。
  ctx.fillStyle = INK;
  if (show.amount) {
    const number = formatPayNumber(data.amount);
    const numberSize = fitFont(ctx, number, 560, 196, NUM, 600, 90);
    const numberWidth = ctx.measureText(number).width;
    ctx.font = `600 64px ${NUM}`;
    const unitWidth = ctx.measureText("Pay").width;
    const startX = (paperWidth - (numberWidth + 14 + unitWidth)) / 2;
    ctx.font = `600 ${numberSize}px ${NUM}`;
    ctx.fillText(number, startX, 640);
    ctx.font = `600 64px ${NUM}`;
    ctx.fillText("Pay", startX + numberWidth + 14, 640);
  } else {
    roundRectPath(ctx, 250, 520, 260, 120, 18);
    ctx.fillStyle = "rgba(42, 34, 48, 0.85)";
    ctx.fill();
    ctx.font = `600 64px ${NUM}`;
    ctx.fillText("Pay", 530, 640);
  }

  const facts = [
    ["種類", data.kindLabel || "献上", INK],
    ["日時", `${created.date} ${created.time}`, INK],
    ["この管理人へ", data.pairCount ? `${data.pairCount}回目` : "—", INK],
    ["受け取り", received ? `${received.time} ✓` : "受け取り待ち", received ? "#12704a" : "#9a6a12"],
  ];
  facts.forEach(([label, value, color], index) => {
    const y = 712 + index * 44;
    ctx.font = `400 27px ${SANS}`;
    ctx.fillStyle = INK;
    ctx.fillText(label, 70, y);
    const labelWidth = ctx.measureText(label).width;
    ctx.font = `700 27px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillStyle = color;
    ctx.fillText(value, paperWidth - 66, y);
    const valueWidth = ctx.measureText(value).width;
    ctx.textAlign = "left";
    ctx.strokeStyle = "rgba(42, 34, 48, 0.35)";
    ctx.lineWidth = 3;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(70 + labelWidth + 12, y - 8);
    ctx.lineTo(paperWidth - 66 - valueWidth - 12, y - 8);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  dashed(900);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(42, 34, 48, 0.75)";
  ctx.font = `400 21px ${MONO}`;
  ctx.fillText("非譲渡・換金不可・アプリ内ポイント ／ AnjuPay only", paperWidth / 2, 942);
  ctx.textAlign = "left";

  if (show.marks && data.sealLabel && received) {
    drawSeal(ctx, {
      x: paperWidth - 22 - 135,
      y: 318 + 135,
      size: 270,
      rotation: -13,
      label: data.sealLabel,
      name: manager.personaName,
      at: data.receivedAt,
      ink: SEAL_INK.paper,
      multiply: true,
      seed: Number(data.receiptNo) || 7,
    });
  }
  ctx.restore();

  if (show.marks && data.rewardLabel) {
    paintRewardBubble(ctx, { image, manager, label: data.rewardLabel, right: SHARE_WIDTH - 64, centerY: SHARE_HEIGHT - 160, rotation: 2 });
  }
  paintFooter(ctx);
  return canvas;
}

// ───────────── やりとり切り抜き ─────────────

function itemHeight(item) {
  if (item.type === "request") return item.note ? 150 : 112;
  if (item.type === "tribute") return 158;
  return 70;
}

export async function renderExcerptImage(data, options = {}) {
  const show = { purpose: true, amount: true, marks: true, ...options };
  const manager = managerPresentation(data.manager);
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter((item) => show.marks || item.type !== "reward")
    .map((item) => ({ ...item, purposeLabel: show.purpose ? item.purposeLabel || "" : "" }));
  const created = jstParts(data.at);
  await loadFonts([manager.personaName, data.walletLabel, data.headline?.label, ...items.map((item) => `${item.purposeLabel}${item.note || ""}${item.label || ""}${item.sealLabel || ""}`), "この契約で回ご褒美献上受け取り待ちの請求管理の記録財布号"].join(""));
  const image = await loadImage(manager.avatarUrl);
  const canvas = canvasFor();
  const ctx = canvas.getContext("2d");
  paintBackdrop(ctx);
  paintHeader(ctx, "管理の記録", created.date);

  paintAvatar(ctx, { image, manager, x: 110, y: 214, radius: 46, ringWidth: 5 });
  ctx.fillStyle = TEXT;
  fitFont(ctx, manager.personaName, 520, 48, MINCHO, 800, 30);
  ctx.fillText(manager.personaName, 180, 214);
  let tagX = 180;
  if (manager.disclosureLabel) {
    tagX += paintPill(ctx, { x: tagX, y: 230, text: manager.disclosureLabel, height: 44, font: `700 22px ${SANS}`, color: manager.disclosureKey === "nekama" ? "#9fe6ff" : TEXT, border: manager.disclosureKey === "nekama" ? "#5fd4ff" : "rgba(255,255,255,0.3)" }) + 10;
  }
  if (data.collarNo > 0) {
    const label = `${manager.personaName}の財布`;
    ctx.font = `700 22px ${SANS}`;
    const labelWidth = ctx.measureText(label).width;
    const chipWidth = labelWidth + 104;
    roundRectPath(ctx, tagX, 230, chipWidth, 44, 22);
    ctx.fillStyle = "#1a1418";
    ctx.fill();
    ctx.strokeStyle = "rgba(232, 194, 122, 0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(tagX + 20, 252, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6e7c8";
    ctx.textBaseline = "middle";
    ctx.fillText(label, tagX + 34, 253);
    roundRectPath(ctx, tagX + 42 + labelWidth, 238, 54, 28, 8);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.fillStyle = "#3a2400";
    ctx.textAlign = "center";
    ctx.fillText(`${data.collarNo}号`, tagX + 69 + labelWidth, 253);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  // 見出し: 「寸止め料 10回 → ご褒美 3回」
  roundRectPath(ctx, 64, 296, SHARE_WIDTH - 128, 134, 22);
  ctx.fillStyle = "rgba(255, 79, 163, 0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 79, 163, 0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = MIST;
  ctx.font = `400 22px ${SANS}`;
  spacing(ctx, 2);
  ctx.fillText("この契約で", 94, 338);
  spacing(ctx, 0);
  const headline = data.headline || {};
  const parts = [
    { text: show.purpose && headline.label ? headline.label : "献上", color: "#ff8fc4" },
    { text: ` ${Number(show.purpose && headline.label ? headline.count : headline.tributeCount) || 0}回`, color: TEXT },
  ];
  if (show.marks && Number(headline.rewardCount) > 0) {
    parts.push({ text: " → ", color: GOLD }, { text: `ご褒美 ${Number(headline.rewardCount)}回`, color: TEXT });
  }
  let headlineSize = 50;
  const measure = () => {
    ctx.font = `400 ${headlineSize}px ${DISPLAY}`;
    return parts.reduce((sum, part) => sum + ctx.measureText(part.text).width, 0);
  };
  while (headlineSize > 30 && measure() > SHARE_WIDTH - 200) headlineSize -= 2;
  let cursorX = 94;
  for (const part of parts) {
    ctx.fillStyle = part.color;
    ctx.fillText(part.text, cursorX, 404);
    cursorX += ctx.measureText(part.text).width;
  }

  // 本文: 収まらない時は古い方から落とす。
  const top = 460;
  const bottom = SHARE_HEIGHT - 120;
  const gap = 18;
  const shown = [...items];
  const total = () => shown.reduce((sum, item) => sum + itemHeight(item), 0) + Math.max(0, shown.length - 1) * gap;
  while (shown.length > 1 && total() > bottom - top) shown.shift();
  let y = top;
  for (const item of shown) {
    const height = itemHeight(item);
    const time = jstParts(item.at).time;
    if (item.type === "request") {
      ctx.font = `700 20px ${SANS}`;
      const label = `${item.purposeLabel || ""}${item.purposeLabel ? "の" : ""}請求`;
      const amountText = show.amount ? `${formatPayNumber(item.amount)} Pay` : "＊＊＊ Pay";
      ctx.font = `600 42px ${NUM}`;
      const amountWidth = ctx.measureText(amountText).width;
      ctx.font = `400 26px ${SANS}`;
      const note = item.note ? `「${item.note}」` : "";
      const noteWidth = note ? ctx.measureText(note).width : 0;
      const width = Math.min(620, Math.max(amountWidth, noteWidth, 160) + 48);
      roundRectPath(ctx, 64, y, width, height, 22);
      ctx.fillStyle = "rgba(232, 194, 122, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(232, 194, 122, 0.7)";
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff8fc4";
      ctx.font = `700 20px ${SANS}`;
      ctx.fillText(label, 88, y + 36);
      ctx.fillStyle = GOLD;
      ctx.font = `600 42px ${NUM}`;
      ctx.fillText(amountText, 88, y + 84);
      if (note) {
        ctx.fillStyle = TEXT;
        fitFont(ctx, note, width - 40, 26, SANS, 400, 18);
        ctx.fillText(note, 84, y + 128);
      }
      ctx.fillStyle = "rgba(244, 236, 246, 0.5)";
      ctx.font = `400 18px ${SANS}`;
      ctx.fillText(time, 64 + width + 12, y + height - 6);
    } else if (item.type === "tribute") {
      const width = 460;
      const x = (SHARE_WIDTH - width) / 2;
      const received = item.receivedAt ? jstParts(item.receivedAt).time : "";
      ctx.save();
      ctx.translate(SHARE_WIDTH / 2, y + height / 2);
      ctx.rotate((-2 * Math.PI) / 180);
      ctx.translate(-SHARE_WIDTH / 2, -(y + height / 2));
      roundRectPath(ctx, x, y + 4, width, height - 8, 20);
      ctx.fillStyle = "rgba(255, 79, 163, 0.07)";
      ctx.fill();
      ctx.strokeStyle = received ? GREEN : PINK;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.textAlign = "center";
      let lineY = y + 46;
      if (item.purposeLabel) {
        ctx.font = `700 22px ${SANS}`;
        const pillWidth = ctx.measureText(item.purposeLabel).width + 36;
        roundRectPath(ctx, SHARE_WIDTH / 2 - pillWidth / 2, y + 18, pillWidth, 34, 17);
        ctx.strokeStyle = "rgba(255, 79, 163, 0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#ffb3d6";
        ctx.textBaseline = "middle";
        ctx.fillText(item.purposeLabel, SHARE_WIDTH / 2, y + 36);
        ctx.textBaseline = "alphabetic";
        lineY = y + 100;
      } else {
        ctx.fillStyle = PINK;
        ctx.font = `700 20px ${SANS}`;
        ctx.fillText(item.kindLabel || "献上", SHARE_WIDTH / 2, y + 44);
        lineY = y + 98;
      }
      ctx.fillStyle = "#ff6fb4";
      ctx.font = `600 46px ${NUM}`;
      ctx.fillText(show.amount ? `${formatPayNumber(item.amount)} Pay` : "＊＊＊ Pay", SHARE_WIDTH / 2, lineY);
      ctx.textAlign = "left";
      const flow = `${data.walletLabel} → ${manager.personaName}`;
      ctx.font = `400 20px ${SANS}`;
      const flowWidth = ctx.measureText(flow).width;
      const chip = received ? `✓ 受け取り ${received}` : "受け取り待ち";
      ctx.font = `900 20px ${SANS}`;
      const chipWidth = ctx.measureText(chip).width + 32;
      const rowX = SHARE_WIDTH / 2 - (flowWidth + 14 + chipWidth) / 2;
      ctx.fillStyle = "rgba(244, 236, 246, 0.72)";
      ctx.font = `400 20px ${SANS}`;
      ctx.fillText(flow, rowX, y + 136);
      roundRectPath(ctx, rowX + flowWidth + 14, y + 114, chipWidth, 32, 16);
      if (received) {
        ctx.fillStyle = GREEN;
        ctx.fill();
        ctx.fillStyle = "#08261a";
      } else {
        ctx.strokeStyle = "rgba(232, 194, 122, 0.7)";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = GOLD;
      }
      ctx.font = `900 20px ${SANS}`;
      ctx.fillText(chip, rowX + flowWidth + 30, y + 137);
      if (show.marks && received && item.sealLabel) {
        drawSeal(ctx, {
          x: x + width + 6,
          y: y + 34,
          size: 140,
          rotation: item.sealRotation ?? -12,
          label: item.sealLabel,
          name: manager.personaName,
          at: item.receivedAt,
          ink: SEAL_INK.dark,
          seed: Number(item.seq) || 3,
        });
      }
      ctx.restore();
    } else if (item.type === "reward") {
      ctx.font = `900 32px ${SANS}`;
      const textWidth = ctx.measureText(item.label).width;
      paintAvatar(ctx, { image, manager, x: 89, y: y + 35, radius: 25, ringWidth: 3 });
      ctx.save();
      ctx.shadowColor = "rgba(255, 79, 163, 0.45)";
      ctx.shadowBlur = 24;
      const fill = ctx.createLinearGradient(126, y, 126 + textWidth + 48, y + 64);
      fill.addColorStop(0, PINK);
      fill.addColorStop(1, "#c13dff");
      ctx.fillStyle = fill;
      roundRectPath(ctx, 126, y + 3, textWidth + 48, 64, [26, 26, 26, 8]);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.font = `900 32px ${SANS}`;
      ctx.fillText(item.label, 150, y + 36);
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(244, 236, 246, 0.5)";
      ctx.font = `400 18px ${SANS}`;
      ctx.fillText(time, 126 + textWidth + 60, y + 62);
    }
    y += height + gap;
  }
  paintFooter(ctx);
  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("画像を作れませんでした。"))), "image/png");
  });
}
