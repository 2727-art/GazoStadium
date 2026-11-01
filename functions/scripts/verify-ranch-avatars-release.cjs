"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { ORIGINS } = require("./verify-player-safety-release.cjs");
const { builtAvatarUrl } = require("../test/helpers/ranch-built-avatars.cjs");
const root = path.resolve(__dirname, "../..");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const options = () => ({ cache: "no-store", signal: AbortSignal.timeout(20000) });
(async () => {
  const { AVATARS, avatarId } = await import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/ranch/manifest.json"), "utf8"));
  const expected = fs.readFileSync(path.join(root, manifest.entry), "utf8").replace(/\r\n/g, "\n");
  const result = { checkedAt: new Date().toISOString(), routes: [] };
  for (const origin of ORIGINS) {
    const index = await fetch(`${origin}/?avatarCheck=${Date.now()}`, options());
    const html = await index.text();
    const entry = JSON.parse(html.match(/id="featureManifest">([\s\S]*?)<\/script>/)[1]).tribute.module;
    const moduleUrl = new URL(entry, origin + "/").href;
    const response = await fetch(moduleUrl, options());
    const source = await response.text();
    const resolveAvatar = builtAvatarUrl(source, moduleUrl, avatarId);
    const images = [];
    for (let i = 0; i < AVATARS.length; i += 4) {
      images.push(...await Promise.all(AVATARS.slice(i, i + 4).map(async ({ id }) => {
        const publicPath = `/assets/tribute-avatars/avatar-${String(id).padStart(2, "0")}.webp`;
        const url = resolveAvatar(id);
        if (url !== origin + publicPath) return { id, ok: false, reason: "wrong image URL", url };
        const image = await fetch(url, options());
        const bytes = Buffer.from(await image.arrayBuffer());
        return { id, ok: image.status === 200 && /^image\/webp(?:;|$)/.test(image.headers.get("content-type") || "")
          && hash(bytes) === hash(fs.readFileSync(path.join(root, publicPath.slice(1)))), status: image.status };
      })));
    }
    const entryMatches = index.ok && response.ok && entry === manifest.entry && hash(source.replace(/\r\n/g, "\n")) === hash(expected);
    result.routes.push({ origin, entry, entryMatches, images, ok: entryMatches && images.every(image => image.ok) });
  }
  result.ok = result.routes.every(route => route.ok);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, routes: result.routes.map(route => ({ origin: route.origin, ok: route.ok, entryMatches: route.entryMatches, images: route.images.length, failed: route.images.filter(image => !image.ok) })) }, null, 2));
  if (!result.ok) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
