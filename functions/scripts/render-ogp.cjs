"use strict";

// One-time, local rendering of the existing homepage UI into a static share PNG.
// Not imported by the website or Cloud Functions. Requires @napi-rs/canvas and a
// Japanese bold font (OGP_FONT_PATH, or the default Windows Meiryo Bold font).
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");

const root = path.resolve(__dirname, "../..");
const width = 1200;
const height = 630;
const fontPath = process.env.OGP_FONT_PATH || "C:/Windows/Fonts/meiryob.ttc";

async function main() {
  if (!GlobalFonts.registerFromPath(fontPath, "OgpJapanese")) {
    throw new Error("A Japanese bold font is required; set OGP_FONT_PATH.");
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const photo = await loadImage(path.join(root, "assets/landing/hero-example.d9a004076802.png"));
  const palette = { pearl: "#f8eef2", mist: "#bfaabb", rose: "#ff3f86", gold: "#e6c17a" };

  function box(x, y, w, h, radius, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  function text(value, x, y, size, color = palette.pearl, maxWidth) {
    ctx.font = `bold ${size}px OgpJapanese`;
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    const measured = ctx.measureText(value).width;
    if (maxWidth && measured > maxWidth) {
      throw new Error(`Text exceeds its layout: ${value} (${measured} > ${maxWidth})`);
    }
    ctx.fillText(value, x, y);
  }

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#0b0710");
  background.addColorStop(0.6, "#1b0d1b");
  background.addColorStop(1, "#30102a");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(880, 280, 40, 880, 280, 520);
  glow.addColorStop(0, "#ff3f861b");
  glow.addColorStop(1, "#ff3f8600");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  box(26, 26, 1148, 578, 28, "#100a1300", "#69404c");

  // The paired card mark, colors and copy come from the existing homepage.
  box(61, 67, 24, 34, 4, "#ff3f861a", palette.rose);
  box(72, 59, 24, 34, 4, "#160e1a", palette.rose);
  text("HARIAI STADIUM", 114, 65, 19, palette.mist, 360);
  text("貼り合いスタジアム", 60, 117, 44, palette.pearl, 570);
  text("貼って、刺して、", 58, 219, 60, palette.pearl, 610);
  text("点で返す。", 58, 298, 70, palette.rose, 600);
  text("好きな画像で、ひとことの対戦。", 62, 411, 26, palette.mist, 575);

  // Preserve the supplied image's 4:3 ratio; no cropping or AI repainting.
  box(702, 62, 432, 425, 24, "#140d18", "#412938");
  box(724, 81, 344, 258, 18, "#251a2c");
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(724, 81, 344, 258, 18);
  ctx.clip();
  ctx.drawImage(photo, 724, 81, 344, 258);
  ctx.restore();
  box(724, 349, 300, 44, 14, "#2c1b2f");
  text("ねぇ、これ好きでしょ？♡", 738, 359, 20, palette.pearl, 273);
  box(805, 407, 307, 54, 16, "#8a1a45");
  text("90", 822, 410, 38, palette.pearl, 64);
  text("点", 880, 429, 17, palette.pearl, 20);
  text("っ…90点。ずるい…♡", 910, 431, 16, palette.pearl, 191);
  const bands = ["#8a7486", "#8a7486", "#8a7486", "#8a7486", "#8a7486", "#8a7486", "#e6c17a", "#e6c17a", "#ff3f86", "#2c1b2f"];
  bands.forEach((color, i) => box(820 + i * 29, 469, 25, 6, 3, color));

  const modes = [
    ["通常型1on1", 62, 194, palette.rose],
    ["戦略型1on1", 270, 194, palette.gold],
    ["AI文字コラ", 478, 192, "#a88bff"],
    ["ルーレット", 684, 192, "#6fe3cf"],
  ];
  for (const [label, x, w, color] of modes) {
    box(x, 520, w, 48, 15, "#211523", "#493341");
    text(label, x + 17, 532, 23, color, w - 32);
  }
  text("IMAGE × GAME", 921, 538, 18, palette.mist, 208);

  const png = await canvas.encode("png");
  await fs.writeFile(path.join(root, "ogp.png"), png);
  console.log(JSON.stringify({ width, height, bytes: png.length,
    sha256: crypto.createHash("sha256").update(png).digest("hex") }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
