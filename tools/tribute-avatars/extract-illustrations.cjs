"use strict";

// Slice the two supplied icon sheets without redrawing their contents.
// Usage: NODE_PATH=<directory containing sharp> node tools/tribute-avatars/extract-illustrations.cjs <mini.png> <portrait.png>
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "../..");
const SIZE = 256;
// Inscribed circles in each source, left to right and top to bottom.
const CIRCLES = [
  [[264, 244, 242], [768, 245, 241], [1272, 245, 241], [264, 744, 244], [768, 747, 244], [1278, 744, 244]],
  [[258, 244, 239], [768, 244, 239], [1276, 244, 240], [258, 746, 239], [768, 747, 239], [1278, 747, 240]],
];
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function main() {
  const sources = process.argv.slice(2);
  if (sources.length !== 2) throw new Error("Pass the mini and portrait PNG sheets, in that order.");
  const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="128" cy="128" r="127.5" fill="white"/></svg>`);
  const icons = [];
  const previews = [];
  for (let sheet = 0; sheet < sources.length; sheet += 1) {
    const source = await fs.readFile(sources[sheet]);
    const metadata = await sharp(source).metadata();
    if (metadata.width !== 1536 || metadata.height !== 1024) throw new Error("Expected a 1536 x 1024 source sheet.");
    for (let slot = 0; slot < 6; slot += 1) {
      const id = 24 + sheet * 6 + slot;
      const [x, y, radius] = CIRCLES[sheet][slot];
      const crop = { left: x - radius, top: y - radius, width: radius * 2, height: radius * 2 };
      const pixels = await sharp(source).extract(crop).resize(SIZE, SIZE)
        .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
      let bytes;
      let quality = 88;
      for (; quality >= 60; quality -= 2) {
        bytes = await sharp(pixels).webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer();
        if (bytes.length < 20_000) break;
      }
      if (bytes.length >= 20_000) throw new Error(`Icon ${id} exceeds the asset budget.`);
      const file = `assets/tribute-avatars/avatar-${id}.webp`;
      await fs.writeFile(path.join(ROOT, file), bytes);
      icons.push({ id, file, sourceFile: path.basename(sources[sheet]), sourceSha256: sha256(source), crop, width: SIZE, height: SIZE, quality, bytes: bytes.length, sha256: sha256(bytes) });
      const preview = await sharp(bytes).resize(160, 160).toBuffer();
      previews.push({ input: preview, left: 16 + (slot % 3) * 180, top: 16 + (sheet * 2 + Math.floor(slot / 3)) * 180 });
    }
  }
  await sharp({ create: { width: 556, height: 736, channels: 4, background: "#221c2b" } }).composite(previews).png()
    .toFile(path.join(ROOT, "functions/docs/tribute-illustration-icons-preview.png"));
  await fs.writeFile(path.join(ROOT, "functions/docs/TRIBUTE_ILLUSTRATION_ICONS_ASSETS.json"), `${JSON.stringify({ method: "Source extraction, circular alpha mask, resize, WebP encoding. No generative redraw.", icons }, null, 2)}\n`);
  console.log(JSON.stringify({ count: icons.length, totalBytes: icons.reduce((sum, icon) => sum + icon.bytes, 0), icons: icons.map(({ id, bytes, quality }) => ({ id, bytes, quality })) }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
