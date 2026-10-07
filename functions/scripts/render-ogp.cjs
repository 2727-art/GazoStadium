"use strict";

// One-time, local rendering of the share card (functions/scripts/ogp-card.html) into a static PNG.
// Not imported by the website or Cloud Functions. Uses an installed Chrome or Edge in headless
// mode (OGP_BROWSER_PATH overrides the browser) and needs network access for Google Fonts.
// Writes assets/ogp/ogp.<first 12 hex of SHA-256>.png and prints the public URL for index.html.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const template = path.join(__dirname, "ogp-card.html");
const outputDir = path.join(root, "assets", "ogp");
const canonical = "https://gazostadium.anjugames.workers.dev/";
const width = 1200;
const height = 630;
const browsers = [
  process.env.OGP_BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);

function findBrowser() {
  const found = browsers.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge is required; set OGP_BROWSER_PATH.");
  return found;
}

function waitForFile(file, timeoutMs = 20_000) {
  // Edge の起動役は先に終わることがあるので、書き出しを待つ。
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > 0 && size === lastSize) return;
      lastSize = size;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error("The browser did not write the screenshot.");
}

function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hariai-ogp-"));
  const screenshot = path.join(workDir, "card.png");
  try {
    execFileSync(findBrowser(), [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      `--window-size=${width},${height}`, "--virtual-time-budget=10000",
      "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(workDir, "profile")}`,
      `--screenshot=${screenshot}`, pathToFileURL(template).href,
    ], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true, timeout: 60_000 });
    waitForFile(screenshot);
    const png = fs.readFileSync(screenshot);
    if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
      throw new Error(`The screenshot is not a ${width}x${height} PNG.`);
    }
    const sha256 = crypto.createHash("sha256").update(png).digest("hex");
    const name = `ogp.${sha256.slice(0, 12)}.png`;
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, name), png);
    console.log(JSON.stringify({ file: `assets/ogp/${name}`, url: `${canonical}assets/ogp/${name}`, width, height, bytes: png.length, sha256 }));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
