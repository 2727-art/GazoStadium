"use strict";

// Read-only public delivery check for the お貢ぎ牧場 既読無視 release
// (read receipts, 既読無視 while a request is unpaid, the manager's declaration,
// requests that cannot be declined, hidden payer limits, 高額請求).
// No sign-in, game APIs, production data access, or filesystem writes.
// With FIREBASE_TOOLS_AUTH_MODULE (absolute path to firebase-tools lib/auth.js) it also reads
// the live Cloud Firestore ruleset through the Firebase Rules API and compares it with firestore.rules.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const PROJECT = "gazostadium";
const MARKER = "ranch-kidoku-v1";
// index.html が読み込むファイルのうち、今回キャッシュキーが変わったもの（online.js は変更なし）。
const PAGE_FILES = Object.freeze(["tribute.js", "tribute.css"]);
const PREVIOUS_MARKERS = Object.freeze(["ranch-frame-color-v1", "ranch-deco-v1", "ranch-wallet-v1", "ranch-invite-v1", "ranch-word-v1", "ranch-collar-v1", "ranch-gohoubi-v1", "tribute-cost-guard-v1", "retire-free-table-v1"]);
// 招待リンクの形（?ranch=公開ID）で開いても、同じページが返ること。IDはダミー。
const INVITE_PATH = "/?ranch=000000000000000000000000";
const PRIVATE = Object.freeze([
  "/TRIBUTE_DESIGN.md",
  "/firebase.json",
  "/firestore.rules",
  "/database.rules.json",
  "/functions/tribute-service.js",
  "/functions/tribute-rules.js",
  "/functions/scripts/migrate-tribute-limits.cjs",
  "/functions/scripts/verify-tribute-kidoku-release.cjs",
  "/functions/test/tribute-kidoku.test.js",
  "/.claude/mocks/kidoku-mushi.html",
  "/.claude/mocks/recruit-render.html",
]);
const TIMEOUT_MS = 20_000;

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

function moduleVersion(source, name) {
  return source.match(new RegExp(`from "\\./${name.replace(".", "\\.")}\\?v=([^"]+)"`))?.[1] || "";
}

const isScript = (result) => /javascript|ecmascript/i.test(result.contentType);

async function verifyOrigin(origin, expected, nonce) {
  const html = await fetchText(`${origin}/`);
  const freshHtml = await fetchText(`${origin}/?releaseCheck=${nonce}`);
  const invite = await fetchText(`${origin}${INVITE_PATH}`);
  const indexOk = [html, freshHtml, invite].every((result) => result.status === 200
    && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expected.html);
  const previousMarkers = PREVIOUS_MARKERS.every((marker) => html.body.includes(marker));
  const files = [];
  for (const name of PAGE_FILES) {
    const url = assetReference(html.body, name, origin);
    if (!url?.includes(MARKER)) {
      files.push({ file: name, url, ok: false, error: "Missing release marker" });
      continue;
    }
    const result = await fetchText(url);
    const typeOk = name.endsWith(".js") ? isScript(result) : /text\/css/i.test(result.contentType);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && typeOk && sha256LF(result.body) === expected.text[name] });
  }
  // 牧場の画面と共有画像が import するモジュールを、同じキャッシュキーで取りに行く。
  for (const [name, version] of Object.entries(expected.versions)) {
    const url = `${origin}/${name}?v=${version}`;
    const result = await fetchText(url);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && isScript(result) && sha256LF(result.body) === expected.text[name] });
  }
  const excluded = await Promise.all(PRIVATE.map(async (file) => ({ file, status: (await fetchText(`${origin}${file}`)).status })));
  return {
    origin,
    indexOk,
    previousMarkers,
    files,
    excluded,
    ok: indexOk && previousMarkers && files.every((entry) => entry.ok) && excluded.every((entry) => entry.status === 404),
  };
}

// 本番の Cloud Firestore ルールを読み取りだけで取り出し、手元の firestore.rules と比べる（認証がある時だけ）。
async function verifyFirestoreRules(localRules) {
  const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
  if (!authModule) return { checked: false, reason: "FIREBASE_TOOLS_AUTH_MODULE is not set" };
  if (!path.isAbsolute(authModule)) throw new Error("FIREBASE_TOOLS_AUTH_MODULE must be an absolute path.");
  const auth = require(authModule);
  const account = auth.getProjectDefaultAccount(ROOT) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Log in with firebase-tools first.");
  const api = require(path.join(path.dirname(authModule), "api.js"));
  const { UserRefreshClient } = require("google-auth-library");
  const client = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
  const base = "https://firebaserules.googleapis.com/v1";
  const release = (await client.request({ url: `${base}/projects/${PROJECT}/releases/cloud.firestore`, method: "GET" })).data;
  const ruleset = (await client.request({ url: `${base}/${release.rulesetName}`, method: "GET" })).data;
  const live = (ruleset.source?.files || []).map((file) => file.content).join("\n");
  const payerOnlyLimits = /match \/private\/\{docId\}[^}]*request\.auth\.uid == get\(\/databases\/\$\(database\)\/documents\/tributeContracts\/\$\(contractId\)\)\.data\.payerUid;/.test(live);
  return {
    checked: true,
    rulesetName: release.rulesetName,
    releaseUpdateTime: release.updateTime,
    rulesetCreateTime: ruleset.createTime,
    matchesLocal: sha256LF(live) === sha256LF(localRules),
    payerOnlyLimits,
  };
}

async function main() {
  const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");
  const [client, share, online] = await Promise.all([read("tribute.js"), read("tribute-share.mjs"), read("online.js")]);
  const versions = {
    "tribute-core.mjs": moduleVersion(client, "tribute-core.mjs"),
    "tribute-share.mjs": moduleVersion(client, "tribute-share.mjs"),
    "tribute-deco.mjs": moduleVersion(client, "tribute-deco.mjs"),
  };
  // tribute-deco.mjs は変更がないため前回のキー。3か所とも同じキーで読む（ブラウザで1つのモジュールになる）。
  if (!versions["tribute-core.mjs"].endsWith(MARKER)
    || versions["tribute-share.mjs"] !== MARKER
    || versions["tribute-deco.mjs"] !== "ranch-frame-color-v1"
    || moduleVersion(share, "tribute-deco.mjs") !== versions["tribute-deco.mjs"]
    || moduleVersion(online, "tribute-deco.mjs") !== versions["tribute-deco.mjs"]) {
    throw new Error("the release modules are not imported with the release cache key");
  }
  const expected = {
    html: sha256LF(await read("index.html")),
    versions,
    text: Object.fromEntries(await Promise.all([...PAGE_FILES, ...Object.keys(versions)]
      .map(async (file) => [file, sha256LF(await read(file))]))),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce)
    .catch((error) => ({ origin, ok: false, error: error.message }))));
  const firestoreRules = await verifyFirestoreRules(await read("firestore.rules"))
    .catch((error) => ({ checked: true, error: error.message }));
  const rulesOk = !firestoreRules.checked || (firestoreRules.matchesLocal === true && firestoreRules.payerOnlyLimits === true);
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, routes, firestoreRules, ok: routes.every((route) => route.ok) && rulesOk };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = { verifyFirestoreRules };

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
