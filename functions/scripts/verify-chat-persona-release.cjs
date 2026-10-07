"use strict";

// Read-only public delivery verification. Never signs in or invokes game APIs.
// Optional: --deployed-rules <file> compares a saved copy of the released RTDB rules
// (from `firebase database:get /.settings/rules`, run separately) with database.rules.json.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const MARKER = "chat-persona-v1";
const HTML_ASSETS = ["online.js", "chat-persona.css"];
const MODULE_ASSETS = [{ file: "chat-persona.mjs", importer: "online.js" }];
const PREVIOUS = ["lobby-initial-snapshot-v1", "retire-market-lobby-v1", "retire-training-lights-v1",
  "global-player-block-v1", "solo-match-cost-guard-v1", "velvet-stage-v1", "hariai-dm-v1", "tribute-ranch-v1"];
const PRIVATE = ["/functions/scripts/verify-chat-persona-release.cjs", "/functions/test/chat-persona-share.test.js",
  "/database.rules.json", "/README.md"];

function invariant(file, body) {
  if (file === "online.js") return body.includes('from "./chat-persona.mjs?v=chat-persona-v1";')
    && ["chat-typing", "chat-reaction", "share-consent-request", "share-consent"]
      .every((type) => body.includes(`message.type === "${type}"`))
    && body.includes("if (voiceSetId) message.voiceSetId = voiceSetId;")
    && body.includes("if (effect) message.effect = effect;")
    && body.includes("if (!target || target.authorUid !== targetState.uid) return;")
    && body.includes('id="onlineShareCard">名場面カードを作る</button>')
    && !body.includes("function renderChatCosmeticBubble(");
  if (file === "chat-persona.mjs") return body.includes('SHARE_CARD_HASHTAGS = "#貼り合い #貼り合いスタジアム"')
    && body.includes("export function buildShareCardModel(")
    && body.includes("export function openShareCardDialog(")
    && !/https?:\/\/|www\.|workers\.dev|web\.app/.test(body);
  return [".chat-persona-koakuma {", ".chat-fx-char {", ".chat-reaction-sticker {", ".share-card-dialog {",
    "@media (prefers-reduced-motion: reduce)"].every((marker) => body.includes(marker));
}

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error",
    cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error("Response exceeds verification size limit");
    chunks.push(Buffer.from(chunk));
  }
  return { url, status: response.status, contentType: response.headers.get("content-type") || "",
    text: Buffer.concat(chunks).toString("utf8") };
}

function metadata(item, expected) {
  return { url: item.url, status: item.status, contentType: item.contentType,
    actualSha256LF: sha256LF(item.text), expectedSha256LF: expected };
}

function withNonce(url, nonce) {
  const fresh = new URL(url);
  fresh.searchParams.set("releaseCheck", String(nonce));
  return fresh.href;
}

async function checkAsset(file, urls, expected, nonce) {
  if (!urls.every((url) => url && new URL(url).searchParams.get("v")?.includes(MARKER))) {
    throw new Error("Missing referenced asset or marker: " + file);
  }
  const responses = await Promise.all([read(urls[0]), read(withNonce(urls[1], nonce))]);
  const mime = file.endsWith(".css") ? /text\/css/i : /javascript|ecmascript/i;
  const checks = responses.map((response) => ({ ...metadata(response, expected[file]),
    ok: response.status === 200 && mime.test(response.contentType)
      && sha256LF(response.text) === expected[file] && invariant(file, response.text) }));
  return { file, responses: checks, ok: checks.every((check) => check.ok), bodies: responses.map((response) => response.text) };
}

function moduleReference(importerText, importerUrl, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = importerText.match(new RegExp(`from "(\\./${escaped}\\?v=[^"]+)"`));
  return match ? new URL(match[1], importerUrl).href : null;
}

async function compareDeployedRules(argv) {
  const index = argv.indexOf("--deployed-rules");
  if (index < 0) return null;
  const deployed = JSON.parse(await fs.readFile(path.resolve(argv[index + 1]), "utf8"));
  const local = JSON.parse(await fs.readFile(path.join(ROOT, "database.rules.json"), "utf8"));
  const chat = deployed?.rules?.online?.rooms?.$roomId?.chat?.$messageId || {};
  return {
    source: "firebase database:get /.settings/rules (read-only, run separately)",
    identicalToLocal: JSON.stringify(deployed) === JSON.stringify(local),
    deployedSha256: sha256LF(JSON.stringify(deployed)),
    chatVoiceSetIdValidate: chat.voiceSetId?.[".validate"] || null,
    chatEffectValidate: chat.effect?.[".validate"] || null,
  };
}

async function main() {
  const html = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const expectedHtml = sha256LF(html);
  const files = [...HTML_ASSETS, ...MODULE_ASSETS.map(({ file }) => file)];
  const expected = Object.fromEntries(await Promise.all(files.map(async (file) => {
    const body = await fs.readFile(path.join(ROOT, file), "utf8");
    if (!invariant(file, body)) throw new Error("Local invariant failed: " + file);
    return [file, sha256LF(body)];
  })));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const pages = await Promise.all([read(origin + "/"), read(origin + "/?releaseCheck=" + nonce)]);
      const index = pages.map((page) => ({ ...metadata(page, expectedHtml),
        ok: page.status === 200 && /text\/html/i.test(page.contentType) && sha256LF(page.text) === expectedHtml
          && PREVIOUS.every((marker) => page.text.includes(marker)) }));
      const htmlAssets = await Promise.all(HTML_ASSETS.map((file) => checkAsset(
        file, pages.map((page) => assetReference(page.text, file, origin)), expected, nonce)));
      const moduleAssets = await Promise.all(MODULE_ASSETS.map(({ file, importer }) => {
        const parent = htmlAssets.find((asset) => asset.file === importer);
        const urls = parent.responses.map((response, position) => moduleReference(parent.bodies[position], response.url, file));
        return checkAsset(file, urls, expected, nonce);
      }));
      const assets = [...htmlAssets, ...moduleAssets].map(({ bodies, ...asset }) => asset);
      const excluded = await Promise.all(PRIVATE.map(async (file) => {
        const response = await read(origin + file);
        return { file, status: response.status, ok: response.status === 404 };
      }));
      return { origin, index, assets, excluded,
        ok: index.every((check) => check.ok) && assets.every((check) => check.ok) && excluded.every((check) => check.ok) };
    } catch (error) { return { origin, ok: false, error: error.message }; }
  }));
  const rules = await compareDeployedRules(process.argv.slice(2));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, productionDataAccessed: false,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim(),
    marker: MARKER, normalization: "CRLF and CR converted to LF before SHA-256", routes, rules,
    ok: routes.every((route) => route.ok) && (!rules || rules.identicalToLocal) };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
module.exports = { invariant };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
