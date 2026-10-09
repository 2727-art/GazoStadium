// お貢ぎ牧場の貢ぎ報告の画像と受取印。画像は財布が自分で作る時だけ、この端末の中で描く（サーバーへは送らない）。
// URL は入れず、「AnjuPay・換金不可・アプリ内ポイント」の表記は必ず入れる。見た目は牧場のもので、実在の決済サービスには似せない。

import {
  CROWN_JEWELS,
  CROWN_PATH,
  HEART_PATH,
  inkColor,
  mixColor,
  normalizeDecorations,
  sealDate,
  sealSvg,
  sealTextLayout,
  waxPoints,
} from "./tribute-deco.mjs?v=ranch-deco-v1";

export const SHARE_WIDTH = 1080;
export const SHARE_HEIGHT = 1350;
export const SHARE_TEXT = "#貢ぎ報告 #お貢ぎ牧場";
export const SEAL_INK = Object.freeze({ paper: inkColor("shu", "paper"), dark: inkColor("shu", "dark") });
export { sealSvg };

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

// ───────────── 受取印 ─────────────
// 形と文字の位置は tribute-deco.mjs と同じ（画面の SVG と、画像の canvas で同じ印にする）。

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

function sealTexts(seal, layout, at) {
  seal.textAlign = "center";
  seal.font = `800 ${layout.label.size}px ${MINCHO}`;
  seal.fillText(layout.label.text, 150, layout.label.y, layout.label.width);
  seal.font = `600 ${layout.date.size}px ${NUM}`;
  seal.fillText(sealDate(at), 150, layout.date.y, 250);
  seal.font = `800 ${layout.name.size}px ${MINCHO}`;
  seal.fillText(layout.name.text, 150, layout.name.y, layout.name.width);
}

function strokeLine(seal, x1, y1, x2, y2, width) {
  seal.lineWidth = width;
  seal.beginPath();
  seal.moveTo(x1, y1);
  seal.lineTo(x2, y2);
  seal.stroke();
}

function sealOutline(seal, shape) {
  seal.lineJoin = "round";
  if (shape === "square") {
    seal.lineWidth = 12;
    roundRectPath(seal, 20, 20, 260, 260, 12);
    seal.stroke();
    seal.lineWidth = 3;
    roundRectPath(seal, 38, 38, 224, 224, 4);
    seal.stroke();
    strokeLine(seal, 38, 94, 262, 94, 3);
    strokeLine(seal, 38, 210, 262, 210, 3);
  } else if (shape === "oval") {
    seal.lineWidth = 10;
    seal.beginPath();
    seal.ellipse(150, 150, 138, 104, 0, 0, Math.PI * 2);
    seal.stroke();
    seal.lineWidth = 2.5;
    seal.beginPath();
    seal.ellipse(150, 150, 122, 88, 0, 0, Math.PI * 2);
    seal.stroke();
    strokeLine(seal, 40, 154, 260, 154, 3);
  } else if (shape === "heart") {
    const heart = new Path2D(HEART_PATH);
    seal.lineWidth = 10;
    seal.stroke(heart);
    seal.save();
    seal.translate(150, 150);
    seal.scale(0.87, 0.87);
    seal.translate(-150, -150);
    seal.lineWidth = 3 / 0.87;
    seal.stroke(heart);
    seal.restore();
  } else if (shape === "crown") {
    seal.lineWidth = 10;
    seal.beginPath();
    seal.arc(150, 172, 118, 0, Math.PI * 2);
    seal.stroke();
    seal.lineWidth = 2.5;
    seal.beginPath();
    seal.arc(150, 172, 104, 0, Math.PI * 2);
    seal.stroke();
    strokeLine(seal, 52, 186, 248, 186, 3);
    const crown = new Path2D(CROWN_PATH);
    seal.lineWidth = 2;
    seal.fill(crown);
    seal.stroke(crown);
    for (const [x, y] of CROWN_JEWELS) {
      seal.beginPath();
      seal.arc(x, y, 7, 0, Math.PI * 2);
      seal.fill();
    }
  } else {
    seal.lineWidth = 10;
    seal.beginPath();
    seal.arc(150, 150, 138, 0, Math.PI * 2);
    seal.stroke();
    strokeLine(seal, 18, 112, 282, 112, 6);
    strokeLine(seal, 18, 188, 282, 188, 6);
  }
}

// 蝋封。朱肉の色を蝋の色にして、文字は浮き彫りにする（かすれは付けない）。
function drawWax(seal, { ink, layout, at }) {
  const base = inkColor(ink, "paper");
  const points = waxPoints();
  const fill = seal.createRadialGradient(108, 90, 0, 108, 90, 240);
  fill.addColorStop(0, mixColor(base, "#ffffff", 0.32));
  fill.addColorStop(0.55, base);
  fill.addColorStop(1, mixColor(base, "#000000", 0.45));
  seal.beginPath();
  points.forEach(([x, y], index) => (index ? seal.lineTo(x, y) : seal.moveTo(x, y)));
  seal.closePath();
  seal.fillStyle = fill;
  seal.fill();
  seal.lineWidth = 3;
  seal.strokeStyle = ink === "sumi" ? "rgba(255, 255, 255, 0.28)" : mixColor(base, "#000000", 0.3);
  seal.stroke();
  seal.lineWidth = 7;
  seal.strokeStyle = mixColor(base, "#000000", 0.38);
  seal.beginPath();
  seal.arc(150, 150, 98, 0, Math.PI * 2);
  seal.stroke();
  seal.globalAlpha = 0.6;
  seal.lineWidth = 2;
  seal.strokeStyle = mixColor(base, "#ffffff", 0.3);
  seal.beginPath();
  seal.arc(148.4, 148.4, 98, 0, Math.PI * 2);
  seal.stroke();
  seal.globalAlpha = 1;
  seal.fillStyle = mixColor(base, "#000000", 0.42);
  sealTexts(seal, layout, at);
  seal.save();
  seal.globalAlpha = 0.55;
  seal.translate(-1.6, -1.6);
  seal.fillStyle = mixColor(base, "#ffffff", 0.35);
  sealTexts(seal, layout, at);
  seal.restore();
}

// rough: かすれを付けるか（財布募集の画像では、読みやすさを優先して付けない）。
function drawSeal(ctx, { x, y, size, rotation = 0, label, name, at, shape, ink, surface = "dark", multiply = false, seed = 7, rough = true }) {
  const look = normalizeDecorations({ sealShape: shape, sealInk: ink });
  const layout = sealTextLayout(look.sealShape, label, name);
  const scale = 2;
  const sealCanvas = document.createElement("canvas");
  sealCanvas.width = 300 * scale;
  sealCanvas.height = 300 * scale;
  const seal = sealCanvas.getContext("2d");
  seal.scale(scale, scale);
  if (look.sealShape === "wax") {
    drawWax(seal, { ink: look.sealInk, layout, at });
  } else {
    const color = inkColor(look.sealInk, surface);
    seal.strokeStyle = color;
    seal.fillStyle = color;
    sealOutline(seal, look.sealShape);
    sealTexts(seal, layout, at);
  }
  if (look.sealShape !== "wax" && rough) {
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
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  if (multiply && look.sealShape !== "wax") ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = look.sealShape === "wax" ? 1 : 0.94;
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
      shape: data.sealShape,
      ink: data.sealInk,
      surface: "paper",
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
          shape: item.sealShape,
          ink: item.sealInk,
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

// ───────────── 財布募集の画像 ─────────────
// 管理人が自分のカードを X に貼るための画像。管理人の端末の中で描き、サーバーへは送らない。
// URL は入れない（招待リンクは投稿の文に付ける）。中の人の札は略さず全文で入れ、上限と解約は財布が握ることを必ず書く。
// 枠は SVG の画像を使わず canvas で描く（端末によっては、画像を重ねた canvas を書き出せなくなるため）。

const RECRUIT_CARD = Object.freeze({ x: 64, y: 206, width: 952, height: 880 });
const PANEL = "#17121c";

// 辺ごとの飾り。ローカルの x が辺に沿い、y が内側へ向くように回して描く。
function eachEdge(ctx, box, draw) {
  const edges = [
    { x: box.x, y: box.y, angle: 0, length: box.width },
    { x: box.x + box.width, y: box.y, angle: Math.PI / 2, length: box.height },
    { x: box.x + box.width, y: box.y + box.height, angle: Math.PI, length: box.width },
    { x: box.x, y: box.y + box.height, angle: -Math.PI / 2, length: box.height },
  ];
  for (const edge of edges) {
    ctx.save();
    ctx.translate(edge.x, edge.y);
    ctx.rotate(edge.angle);
    draw(edge.length);
    ctx.restore();
  }
}

function eachCorner(ctx, box, inset, draw) {
  const corners = [
    { x: box.x + inset, y: box.y + inset, angle: 0 },
    { x: box.x + box.width - inset, y: box.y + inset, angle: Math.PI / 2 },
    { x: box.x + box.width - inset, y: box.y + box.height - inset, angle: Math.PI },
    { x: box.x + inset, y: box.y + box.height - inset, angle: -Math.PI / 2 },
  ];
  corners.forEach((corner, index) => {
    ctx.save();
    ctx.translate(corner.x, corner.y);
    ctx.rotate(corner.angle);
    draw(index);
    ctx.restore();
  });
}

function goldGradient(ctx, box) {
  const gold = ctx.createLinearGradient(box.x, box.y, box.x + box.width, box.y + box.height);
  gold.addColorStop(0, "#7d5d1c");
  gold.addColorStop(0.22, "#f7e4a6");
  gold.addColorStop(0.45, "#b8892b");
  gold.addColorStop(0.62, "#fff2c4");
  gold.addColorStop(0.82, "#9a7224");
  gold.addColorStop(1, "#f0d48a");
  return gold;
}

function strokeMetal(ctx, path) {
  for (const [width, color, alpha] of [[9, "#3e424b", 1], [5, "#cfd4dd", 1], [1.6, "#ffffff", 0.7]]) {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    path();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintRose(ctx) {
  ctx.save();
  ctx.scale(1.7, 1.7);
  ctx.translate(-20, -20);
  ctx.fillStyle = "#3f7d4e";
  ctx.fill(new Path2D("M6 30 Q1 21 11 20 Q12 29 6 30Z"));
  ctx.fill(new Path2D("M30 35 Q39 31 35 23 Q28 27 30 35Z"));
  ctx.fillStyle = "#b0153f";
  ctx.beginPath();
  ctx.arc(20, 20, 11.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#e2557b";
  ctx.stroke(new Path2D("M11 15 Q20 5 29 15"));
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = "#6e0a26";
  ctx.stroke(new Path2D("M20 11.5 a8.5 8.5 0 1 1 -7.4 12.4 M20 15.5 a4.8 4.8 0 1 1 -4.2 7 M20 19.5 a1.6 1.6 0 1 1 1.1 1.3"));
  ctx.restore();
}

function paintCrown(ctx, centerX, top, width) {
  const scale = width / 58;
  ctx.save();
  ctx.translate(centerX - width / 2, top);
  ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  const fill = ctx.createLinearGradient(0, 0, 0, 36);
  fill.addColorStop(0, "#fff4c9");
  fill.addColorStop(0.55, "#e2b04f");
  fill.addColorStop(1, "#8a6a24");
  const crown = new Path2D("M8 32 L4 8 L17 19 L29 3 L41 19 L54 8 L50 32 Z");
  ctx.fillStyle = fill;
  ctx.fill(crown);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "#5c4210";
  ctx.stroke(crown);
  ctx.fillStyle = "#c99a3c";
  roundRectPath(ctx, 8, 29, 42, 5, 1.5);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const [x, y, radius, color] of [[29, 22, 3.4, "#d3264f"], [17, 24, 2.4, "#3a7bd5"], [41, 24, 2.4, "#3a7bd5"], [4, 8, 2.4, "#fff4c9"], [29, 3, 2.6, "#fff4c9"], [54, 8, 2.4, "#fff4c9"]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// カードの枠と背景。中の文字の色と位置は、どの枠でも同じ。
function paintFrame(ctx, frame, box, color) {
  const { x, y, width, height } = box;
  ctx.save();
  if (frame === "kurokawa") {
    const leather = ctx.createLinearGradient(x, y, x + width * 0.6, y + height);
    leather.addColorStop(0, "#2c201c");
    leather.addColorStop(0.58, "#171112");
    leather.addColorStop(1, "#120d0f");
    roundRectPath(ctx, x, y, width, height, 30);
    ctx.fillStyle = leather;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const random = seededRandom(11);
    for (let index = 0; index < 2_400; index += 1) {
      ctx.fillStyle = random() < 0.5 ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(x + random() * width, y + random() * height, 1.5, 1.5);
    }
    ctx.restore();
    roundRectPath(ctx, x, y, width, height, 30);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    ctx.stroke();
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(232, 194, 122, 0.62)";
    roundRectPath(ctx, x + 14, y + 14, width - 28, height - 28, 22);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (frame === "kusari") {
    const steel = ctx.createLinearGradient(x, y, x + width * 0.6, y + height);
    steel.addColorStop(0, "#23262e");
    steel.addColorStop(0.6, "#15161b");
    steel.addColorStop(1, "#15161b");
    roundRectPath(ctx, x, y, width, height, 8);
    ctx.fillStyle = steel;
    ctx.fill();
    const band = 30;
    eachEdge(ctx, box, (length) => {
      const usable = length - band * 2;
      const pairs = Math.max(1, Math.round(usable / 50));
      const pitch = usable / pairs;
      for (let index = 0; index < pairs; index += 1) {
        const start = band + index * pitch;
        strokeMetal(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(start - 4, band / 2);
          ctx.lineTo(start + pitch * 0.3, band / 2);
        });
        strokeMetal(ctx, () => {
          ctx.beginPath();
          ctx.ellipse(start + pitch * 0.64, band / 2, pitch * 0.34, 10, 0, 0, Math.PI * 2);
        });
      }
    });
    eachCorner(ctx, box, band / 2, () => strokeMetal(ctx, () => {
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
    }));
  } else if (frame === "bara") {
    const wine = ctx.createLinearGradient(x, y, x + width * 0.6, y + height);
    wine.addColorStop(0, "#3a0f1f");
    wine.addColorStop(0.62, "#1c0a12");
    wine.addColorStop(1, "#1c0a12");
    roundRectPath(ctx, x, y, width, height, 8);
    ctx.fillStyle = wine;
    ctx.fill();
    const glow = ctx.createRadialGradient(x, y, 0, x, y, width * 0.7);
    glow.addColorStop(0, "rgba(176, 21, 63, 0.4)");
    glow.addColorStop(1, "rgba(176, 21, 63, 0)");
    ctx.fillStyle = glow;
    ctx.fill();
    eachEdge(ctx, box, (length) => {
      ctx.strokeStyle = "rgba(245, 228, 234, 0.85)";
      ctx.fillStyle = "rgba(245, 228, 234, 0.85)";
      const count = Math.round(length / 22);
      const pitch = length / count;
      ctx.lineWidth = 3;
      for (let index = 0; index < count; index += 1) {
        const center = index * pitch + pitch / 2;
        ctx.beginPath();
        ctx.arc(center, 13, pitch / 2 - 1, Math.PI, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(center, 14, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 24);
      ctx.lineTo(length, 24);
      ctx.stroke();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 30);
      ctx.lineTo(length, 30);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    eachCorner(ctx, box, 4, (index) => {
      if (index === 0 || index === 2) paintRose(ctx);
    });
  } else if (frame === "kinbuchi") {
    roundRectPath(ctx, x, y, width, height, 4);
    const inside = ctx.createLinearGradient(x, y, x + width * 0.6, y + height);
    inside.addColorStop(0, "#221a14");
    inside.addColorStop(0.6, "#141016");
    inside.addColorStop(1, "#141016");
    ctx.fillStyle = inside;
    ctx.fill();
    const tint = ctx.createRadialGradient(x + width / 2, y, 0, x + width / 2, y, width * 0.7);
    tint.addColorStop(0, "rgba(232, 194, 122, 0.16)");
    tint.addColorStop(1, "rgba(232, 194, 122, 0)");
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.lineWidth = 22;
    ctx.strokeStyle = goldGradient(ctx, box);
    ctx.strokeRect(x + 11, y + 11, width - 22, height - 22);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeRect(x + 24, y + 24, width - 48, height - 48);
    ctx.strokeStyle = "rgba(232, 194, 122, 0.55)";
    ctx.strokeRect(x + 28, y + 28, width - 56, height - 56);
    const flourish = new Path2D("M3 3 H24 Q30 3 30 9 Q30 14 25 14 Q21 14 21 10 M3 3 V24 Q3 30 9 30 Q14 30 14 25 Q14 21 10 21");
    eachCorner(ctx, box, 34, () => {
      ctx.scale(2, 2);
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#e9c46f";
      ctx.stroke(flourish);
      ctx.fillStyle = "#f6dfa6";
      ctx.beginPath();
      ctx.arc(9, 9, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (frame === "gyokuza") {
    roundRectPath(ctx, x, y, width, height, 30);
    const velvet = ctx.createRadialGradient(x + width / 2, y, 0, x + width / 2, y, width * 1.05);
    velvet.addColorStop(0, "#6a1326");
    velvet.addColorStop(0.58, "#2c0812");
    velvet.addColorStop(1, "#190409");
    ctx.fillStyle = velvet;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "rgba(255, 255, 255, 0.022)";
    for (let stripe = x; stripe < x + width; stripe += 5) ctx.fillRect(stripe, y, 2, height);
    const shine = ctx.createLinearGradient(x, y, x + width, y + height * 0.55);
    shine.addColorStop(0, "rgba(255, 228, 160, 0)");
    shine.addColorStop(0.38, "rgba(255, 228, 160, 0)");
    shine.addColorStop(0.5, "rgba(255, 228, 160, 0.14)");
    shine.addColorStop(0.62, "rgba(255, 228, 160, 0)");
    shine.addColorStop(1, "rgba(255, 228, 160, 0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = "rgba(255, 196, 92, 0.32)";
    ctx.shadowBlur = 60;
    ctx.lineWidth = 7;
    ctx.strokeStyle = goldGradient(ctx, box);
    roundRectPath(ctx, x, y, width, height, 30);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 215, 130, 0.35)";
    roundRectPath(ctx, x + 6, y + 6, width - 12, height - 12, 25);
    ctx.stroke();
    paintCrown(ctx, x + width / 2, y - 58, 140);
  } else {
    const panel = ctx.createLinearGradient(x, y, x + width * 0.6, y + height);
    panel.addColorStop(0, mixColor(PANEL, color, 0.14));
    panel.addColorStop(0.55, PANEL);
    panel.addColorStop(1, PANEL);
    roundRectPath(ctx, x, y, width, height, 30);
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.stroke();
  }
  ctx.restore();
}

// 文字を幅で折り返す（日本語は1文字ずつ）。入りきらない時は最後の行を「…」で切る。
function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const char of Array.from(String(text || ""))) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line += char;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = Array.from(last).slice(0, -1).join("");
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

export async function renderRecruitImage(data) {
  const manager = managerPresentation(data.manager);
  const frame = normalizeDecorations({ frame: data.frame }).frame;
  const word = String(data.word || "");
  const intro = String(data.intro || "");
  const achievements = (Array.isArray(data.achievements) ? data.achievements : []).slice(0, 3);
  const honorLabel = String(data.honorLabel || "");
  const tags = [manager.disclosureLabel, manager.styleLabel, honorLabel].filter(Boolean);
  await loadFonts([manager.personaName, word, intro, tags.join(""), achievements.map((entry) => `${entry.icon}${entry.name}`).join(""), "財布募集中入場料管理中今月の財布人上限と解約は財布が握るだけ現金なし#WALLET WANTED"].join(""));
  const image = await loadImage(manager.avatarUrl);
  const canvas = canvasFor();
  const ctx = canvas.getContext("2d");
  paintBackdrop(ctx);
  paintHeader(ctx, "WALLET WANTED", "");
  // 右上の「財布募集」
  ctx.save();
  ctx.font = `400 44px ${DISPLAY}`;
  spacing(ctx, 4);
  const pillWidth = ctx.measureText("財布募集").width + 64;
  ctx.shadowColor = "rgba(255, 79, 163, 0.5)";
  ctx.shadowBlur = 34;
  const pill = ctx.createLinearGradient(SHARE_WIDTH - 64 - pillWidth, 56, SHARE_WIDTH - 64, 140);
  pill.addColorStop(0, PINK);
  pill.addColorStop(1, "#c13dff");
  ctx.fillStyle = pill;
  roundRectPath(ctx, SHARE_WIDTH - 64 - pillWidth, 56, pillWidth, 84, 42);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText("財布募集", SHARE_WIDTH - 64 - pillWidth + 34, 100);
  ctx.textBaseline = "alphabetic";
  spacing(ctx, 0);
  ctx.restore();

  const box = RECRUIT_CARD;
  paintFrame(ctx, frame, box, manager.color);
  const left = box.x + 64;
  const right = box.x + box.width - 64;
  const innerWidth = right - left;

  // 印（アイコン）・名前・札
  paintAvatar(ctx, { image, manager, x: left + 92, y: box.y + 64 + 92, radius: 92, ring: manager.color, ringWidth: 8 });
  const nameX = left + 220;
  ctx.fillStyle = TEXT;
  fitFont(ctx, manager.personaName, right - nameX, 88, MINCHO, 800, 40);
  ctx.fillText(manager.personaName, nameX, box.y + 64 + 92);
  let tagX = nameX;
  const tagY = box.y + 64 + 120;
  tags.forEach((label, index) => {
    const font = `700 27px ${SANS}`;
    ctx.font = font;
    const width = ctx.measureText(label).width + 40;
    // 中の人の札（最初の札）は必ず入れる。ほかの札は入りきる時だけ。
    if (index > 0 && tagX + width > right) return;
    const isDisclosure = index === 0;
    const isHonor = !isDisclosure && label === honorLabel;
    const nekama = manager.disclosureKey === "nekama";
    const color = isDisclosure ? (nekama ? "#9fe6ff" : TEXT) : isHonor ? "#f6dfa6" : TEXT;
    const border = isDisclosure ? (nekama ? "#5fd4ff" : "rgba(255, 255, 255, 0.45)") : isHonor ? GOLD : "rgba(255, 255, 255, 0.3)";
    tagX += paintPill(ctx, { x: tagX, y: tagY, text: label, height: 50, font, color, border, padding: 20, lineWidth: 3 }) + 12;
  });
  let cursor = box.y + 64 + 190;

  // 今日のひとこと
  if (word) {
    ctx.font = `900 36px ${SANS}`;
    const lines = wrapLines(ctx, word, innerWidth - 60, 2);
    const bubbleWidth = Math.min(innerWidth, Math.max(...lines.map((line) => ctx.measureText(line).width)) + 60);
    const bubbleHeight = 28 + lines.length * 48;
    cursor += 20;
    const fill = ctx.createLinearGradient(left, cursor, left + bubbleWidth, cursor + bubbleHeight);
    fill.addColorStop(0, "rgba(255, 79, 163, 0.3)");
    fill.addColorStop(1, "rgba(138, 43, 226, 0.26)");
    roundRectPath(ctx, left, cursor, bubbleWidth, bubbleHeight, [32, 32, 32, 10]);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 79, 163, 0.55)";
    ctx.stroke();
    ctx.fillStyle = TEXT;
    lines.forEach((line, index) => ctx.fillText(line, left + 30, cursor + 14 + 36 + index * 48));
    cursor += bubbleHeight;
  }

  // 紹介
  if (intro) {
    ctx.font = `400 30px ${SANS}`;
    ctx.fillStyle = "rgba(244, 236, 246, 0.86)";
    const lines = wrapLines(ctx, intro, innerWidth, 3);
    cursor += 22;
    lines.forEach((line, index) => ctx.fillText(line, left, cursor + 34 + index * 46));
    cursor += lines.length * 46 + 8;
  }

  // 入場料・管理中・今月の財布
  cursor += 24;
  const facts = [["入場料", formatPayNumber(data.entryFee), "Pay"], ["管理中", formatPayNumber(data.activeContracts), "人"], ["今月の財布", formatPayNumber(data.monthPayers), "人"]];
  const factWidth = (innerWidth - 32) / 3;
  facts.forEach(([label, value, unit], index) => {
    const factX = left + index * (factWidth + 16);
    roundRectPath(ctx, factX, cursor, factWidth, 104, 18);
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.stroke();
    ctx.fillStyle = MIST;
    ctx.font = `400 23px ${SANS}`;
    ctx.fillText(label, factX + 22, cursor + 34);
    ctx.fillStyle = TEXT;
    ctx.font = `600 50px ${NUM}`;
    ctx.fillText(value, factX + 22, cursor + 88);
    const valueWidth = ctx.measureText(value).width;
    ctx.font = `700 24px ${SANS}`;
    ctx.fillText(unit, factX + 30 + valueWidth, cursor + 88);
  });
  cursor += 104;

  // 牧場用の実績（3つまで）
  if (achievements.length) {
    cursor += 22;
    let chipX = left;
    for (const entry of achievements) {
      ctx.font = `700 26px ${SANS}`;
      const name = String(entry.name || "");
      const width = Math.min(innerWidth, ctx.measureText(name).width + 82);
      if (chipX + width > right && chipX > left) {
        chipX = left;
        cursor += 62;
      }
      roundRectPath(ctx, chipX, cursor, width, 54, 27);
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(232, 194, 122, 0.5)";
      ctx.stroke();
      const badge = ctx.createLinearGradient(chipX + 6, cursor + 6, chipX + 48, cursor + 48);
      badge.addColorStop(0, "#f6e3a3");
      badge.addColorStop(1, "#c79a3a");
      ctx.fillStyle = badge;
      ctx.beginPath();
      ctx.arc(chipX + 27, cursor + 27, 21, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2a1a00";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 23px ${SANS}`;
      ctx.fillText(Array.from(String(entry.icon || "")).slice(0, 2).join(""), chipX + 27, cursor + 28);
      ctx.textAlign = "left";
      ctx.fillStyle = TEXT;
      fitFont(ctx, name, width - 76, 26, SANS, 700, 16);
      ctx.fillText(name, chipX + 60, cursor + 28);
      ctx.textBaseline = "alphabetic";
      chipX += width + 12;
    }
  }

  // 管理人の受取印で「募集中」を押す。枠や文字に重ねず、カードの右下の外に押す。
  drawSeal(ctx, {
    x: SHARE_WIDTH - 64 - 80,
    y: box.y + box.height + 82,
    size: 156,
    rotation: -10,
    rough: false,
    label: "募集中",
    name: manager.personaName,
    at: data.at,
    shape: data.sealShape,
    ink: data.sealInk,
    seed: 5,
  });

  // 守ること（左に寄せ、右下の印と重ねない）
  const rulesY = box.y + box.height + 64;
  let ruleX = 64;
  for (const [text, strong] of [["上限と解約は", false], ["財布が握る", true], ["　AnjuPay だけ・", false], ["現金なし", true]]) {
    ctx.fillStyle = strong ? GREEN : MIST;
    ctx.font = `${strong ? 700 : 400} 24px ${SANS}`;
    ctx.fillText(text, ruleX, rulesY);
    ruleX += ctx.measureText(text).width;
  }
  ctx.fillStyle = GOLD;
  ctx.font = `700 24px ${SANS}`;
  ctx.fillText("#お貢ぎ牧場 #財布募集", 64, rulesY + 40);
  paintFooter(ctx);
  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("画像を作れませんでした。"))), "image/png");
  });
}
