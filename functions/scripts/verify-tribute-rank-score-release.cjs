"use strict";

// Read-only public delivery check for the お貢ぎ牧場 番付 release
// (managers ranked by ranking points first, then by wallets; 「1on1で稼ぐ」 first among the earn shortcuts).
// No sign-in, game APIs, production data access, or filesystem writes.
// With FIREBASE_TOOLS_AUTH_MODULE (absolute path to firebase-tools lib/auth.js) it also reads the
// Cloud Firestore index definitions (metadata only, no documents) and checks the new ranking index is READY.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const PROJECT = "gazostadium";
const MARKER = "ranch-rank-score-v1";
// 今回キャッシュキーが変わったのは tribute.js だけ。tribute.css は前回のキーのまま、中身も同じであること。
const PAGE_FILES = Object.freeze(["tribute.js"]);
const UNCHANGED_PAGE_FILES = Object.freeze({ "tribute.css": "ranch-photo-icons-v1" });
const PREVIOUS_MARKERS = Object.freeze(["ranch-photo-icons-v1", "ranch-board-fresh-v1", "ranch-kidoku-v1", "ranch-frame-color-v1", "ranch-deco-v1", "ranch-wallet-v1", "ranch-invite-v1", "ranch-word-v1", "ranch-collar-v1", "ranch-gohoubi-v1", "tribute-cost-guard-v1", "retire-free-table-v1", "my-stadium-v1", "my-stadium-v1-diorama-v1"]);
// 招待リンクの形（?ranch=公開ID）で開いても、同じページが返ること。IDはダミー。
const INVITE_PATH = "/?ranch=000000000000000000000000";
const PRIVATE = Object.freeze([
  "/TRIBUTE_DESIGN.md",
  "/firebase.json",
  "/firestore.rules",
  "/firestore.indexes.json",
  "/functions/tribute-service.js",
  "/functions/tribute-rules.js",
  "/functions/scripts/verify-tribute-rank-score-release.cjs",
  "/functions/test/tribute-service-runtime.test.js",
]);
const RANKING_INDEX = Object.freeze(["monthKey:ASCENDING", "rankScore:DESCENDING", "payers:DESCENDING"]);
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
  const pageFiles = [...PAGE_FILES.map((name) => [name, MARKER]), ...Object.entries(UNCHANGED_PAGE_FILES)];
  for (const [name, marker] of pageFiles) {
    const url = assetReference(html.body, name, origin);
    if (!url?.endsWith(marker)) {
      files.push({ file: name, url, ok: false, error: `Missing cache key ending ${marker}` });
      continue;
    }
    const result = await fetchText(url);
    const typeOk = name.endsWith(".js") ? isScript(result) : /text\/css/i.test(result.contentType);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && typeOk && sha256LF(result.body) === expected.text[name] });
  }
  // 牧場の画面と共有画像が import するモジュール（今回は変更なし）を、同じキャッシュキーで取りに行く。
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

// 番付の並べ替え用インデックスの状態（定義だけを読む。文書は読まない）。認証がある時だけ。
async function verifyRankingIndex() {
  const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
  if (!authModule) return { checked: false, reason: "FIREBASE_TOOLS_AUTH_MODULE is not set" };
  if (!path.isAbsolute(authModule)) throw new Error("FIREBASE_TOOLS_AUTH_MODULE must be an absolute path.");
  const auth = require(authModule);
  const account = auth.getProjectDefaultAccount(ROOT) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Log in with firebase-tools first.");
  const api = require(path.join(path.dirname(authModule), "api.js"));
  const { UserRefreshClient } = require("google-auth-library");
  const client = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/tributeManagerMonths/indexes`;
  // この API は全部のコレクションの索引を返すことがあるので、名前で番付の分だけに絞る。
  const indexes = ((await client.request({ url, method: "GET" })).data.indexes || [])
    .filter((index) => String(index.name || "").includes("/collectionGroups/tributeManagerMonths/"));
  const shape = (index) => (index.fields || []).filter((field) => field.fieldPath !== "__name__").map((field) => `${field.fieldPath}:${field.order || field.arrayConfig}`);
  const ranking = indexes.find((index) => index.queryScope === "COLLECTION" && shape(index).join(",") === RANKING_INDEX.join(","));
  return {
    checked: true,
    indexes: indexes.map((index) => ({ fields: shape(index).join(","), state: index.state })),
    rankingIndexState: ranking?.state || "missing",
    ready: ranking?.state === "READY",
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
  if (!versions["tribute-core.mjs"].endsWith("ranch-photo-icons-v1")
    || versions["tribute-share.mjs"] !== "ranch-kidoku-v1"
    || versions["tribute-deco.mjs"] !== "ranch-frame-color-v1"
    || moduleVersion(share, "tribute-deco.mjs") !== versions["tribute-deco.mjs"]
    || moduleVersion(online, "tribute-deco.mjs") !== versions["tribute-deco.mjs"]) {
    throw new Error("the ranch modules are not imported with the expected cache keys");
  }
  const expected = {
    html: sha256LF(await read("index.html")),
    versions,
    text: Object.fromEntries(await Promise.all([...PAGE_FILES, ...Object.keys(UNCHANGED_PAGE_FILES), ...Object.keys(versions)]
      .map(async (file) => [file, sha256LF(await read(file))]))),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce)
    .catch((error) => ({ origin, ok: false, error: error.message }))));
  const rankingIndex = await verifyRankingIndex().catch((error) => ({ checked: true, error: error.message }));
  const indexOk = !rankingIndex.checked || rankingIndex.ready === true;
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, routes, rankingIndex, ok: routes.every((route) => route.ok) && indexOk };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = { verifyRankingIndex };

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
