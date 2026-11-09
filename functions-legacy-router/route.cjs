"use strict";

const PRIMARY_ORIGIN = "https://hariaistadium.com";
const LEGACY_HOSTS = new Set([
  "gazostadium.anjugames.workers.dev",
  "gazostadium.web.app",
  "gazostadium.firebaseapp.com",
]);
const APP_PATHS = new Set(["/", "/index", "/index.html"]);
const TRANSFER_PATH = "/account-transfer.html";

function redirectFor(url) {
  if (APP_PATHS.has(url.pathname) && url.searchParams.get("account") === "1") {
    // Keep the origin: Firebase Auth persistence and the previous-account backup
    // belong to the old origin. A permanent URL would be cached too aggressively.
    return { status: 302, location: TRANSFER_PATH + url.search };
  }
  const path = APP_PATHS.has(url.pathname) ? "/" : url.pathname;
  return { status: 301, location: PRIMARY_ORIGIN + path + url.search };
}

function keepLegacyAsset(path) {
  return path === "/account-guide" || path.startsWith("/account-guide/")
    || path.startsWith("/__/")
    || path === TRANSFER_PATH || path === "/account-transfer"
    || path === "/robots.txt" || path === "/sitemap.xml"
    || path === "/google89c894c09edab89b.html"
    || path === "/google89c894c09edab89b"
    || /\.(?:js|mjs|css|json|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|mp3|wav|ogg|mp4|webm)$/i.test(path);
}

module.exports = { PRIMARY_ORIGIN, LEGACY_HOSTS, APP_PATHS, TRANSFER_PATH, redirectFor, keepLegacyAsset };
