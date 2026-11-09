"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const { redirectFor, LEGACY_HOSTS } = require("../route.cjs");
const root = path.resolve(__dirname, "../..");
const guides = ["modes", "how-to-play", "strategy", "solo-training", "safety", "faq"];
const worker = () => import(pathToFileURL(path.join(root, "scripts/legacy-worker.mjs")).href);

test("legacy root and guide URLs keep their path and query on the new origin", async () => {
  const { default: handler } = await worker();
  for (const host of LEGACY_HOSTS) for (const p of ["/", "/index.html", ...guides.map(g => `/${g}/`)]) {
    const r = await handler.fetch(new Request(`https://${host}${p}?utm_source=old`), {});
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), `https://hariaistadium.com${p === "/index.html" ? "/" : p}?utm_source=old`);
    assert.match(r.headers.get("cache-control"), /no-store/);
  }
});

test("wallet entry stays on the old origin, including index aliases and query ordering", () => {
  for (const host of LEGACY_HOSTS) for (const p of ["/", "/index", "/index.html"]) {
    const r = redirectFor(new URL(`https://${host}${p}?utm_source=guide&account=1`));
    assert.equal(r.status, 302);
    assert.equal(new URL(r.location, `https://${host}`).origin, `https://${host}`);
    assert.equal(r.location, "/account-transfer.html?utm_source=guide&account=1");
  }
});

test("auth helpers, ownership verification, account guide and app dependencies are retained", async () => {
  const { default: handler } = await worker();
  for (const p of ["/account-guide/", "/account-guide/guide.css", "/account-transfer.html", "/account-transfer", "/__/auth/handler", "/__/auth/iframe", "/google89c894c09edab89b.html", "/robots.txt", "/sitemap.xml", "/app.js", "/account.js", "/assets/firebase/firebase-auth-BU4OMZEH.js", "/styles.css", "/assets/photo.png"]) {
    let seen;
    const request = new Request(`https://gazostadium.anjugames.workers.dev${p}`);
    const r = await handler.fetch(request, { ASSETS: { fetch: req => { seen = req; return new Response("asset"); } } });
    assert.equal(r.status, 200, p);
    assert.equal(seen, request);
  }
});

test("primary and preview domains never get redirected by the legacy rule", async () => {
  const { default: handler } = await worker();
  for (const host of ["hariaistadium.com", "preview.gazostadium.anjugames.workers.dev", "localhost"]) {
    const r = await handler.fetch(new Request(`https://${host}/?account=1`), { ASSETS: { fetch: () => new Response("new site") } });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "new site");
  }
});

test("untrusted URL parameters cannot change the redirect destination", () => {
  for (const p of ["/?next=https://evil.example", "//evil.example/a", "/faq/?account=1"]) {
    const r = redirectFor(new URL(`https://gazostadium.web.app${p}`));
    assert.equal(new URL(r.location).origin, "https://hariaistadium.com");
    assert.equal(r.status, 301);
  }
});

test("deployment configurations intercept pages while preserving Firebase reserved paths", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
  assert.ok(config.hosting.ignore.includes("index.html"));
  assert.equal(config.hosting.rewrites[0].function.functionId, "legacySiteRedirect");
  assert.ok(!config.hosting.redirects.some(r => ["/", "**", "/__/**"].includes(r.source)));
  for (const g of guides) assert.ok(config.hosting.redirects.some(r => r.source === `/${g}/:path*`));
  const wrangler = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8").replace(/^\/\/.*$/gm, ""));
  for (const p of ["/", "/index.html", ...guides.map(g => `/${g}/*`)]) assert.ok(wrangler.assets.run_worker_first.includes(p));
  assert.equal(wrangler.assets.binding, "ASSETS");
});

test("wallet reload reopens the account even after the account query was removed", () => {
  const source = fs.readFileSync(path.join(root, "account.js"), "utf8");
  const start = source.indexOf("function openRequestedAccountRecovery()");
  const body = source.slice(start);
  const fn = body.slice(0, /\n\}\r?\n/.exec(body).index + 2);
  for (const p of ["/account-transfer.html", "/account-transfer.html?account=1", "/account-transfer"]) {
    const href = `https://gazostadium.web.app${p}`;
    let opened = 0, replaced = 0;
    const c = vm.createContext({ URL, location: { href },
      history: { replaceState() { replaced++; } },
      sessionStorage: { getItem: () => null, removeItem() {} }, start: () => opened++ });
    vm.runInContext(fn + "\nopenRequestedAccountRecovery();", c);
    assert.equal(opened, 1, p);
    assert.equal(replaced, 0, p);
  }
});
