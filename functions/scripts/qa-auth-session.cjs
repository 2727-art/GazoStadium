"use strict";

// Isolated browser QA: real Firebase Auth SDK/persistence + Auth emulator;
// wallet/transfer RPC responses are local fixtures. No production data access.
// Run under emulators:exec --only auth --project demo-gazostadium.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const root = path.resolve(__dirname, "../..");
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(authHost || "")) throw new Error("A loopback Auth emulator is required.");
if (process.env.GCLOUD_PROJECT !== "demo-gazostadium") throw new Error("Only demo-gazostadium is allowed.");
const sdk = "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
const output = path.join(root, ".firebase/auth-session-qa");
fs.mkdirSync(output, { recursive: true });
const fixture = { fail: false, rejectWallet: false, rejectTransfer: false, sourceUid: "", balance: 875, calls: 0 };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const customToken = (uid) => `${encode({ alg: "none", typ: "JWT" })}.${encode({
  uid, iss: "qa@example.test", sub: "qa@example.test",
  aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
})}.`;
let port;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type,x-firebase-appcheck,x-firebase-gmpid");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.end(); return; }
  if (url.pathname.startsWith("/demo-gazostadium/us-central1/")) {
    fixture.calls++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString()).data || {};
    assert.ok(req.headers.authorization?.startsWith("Bearer "), "fixture RPC requires a real emulator ID token");
    const claims = JSON.parse(Buffer.from(req.headers.authorization.split(".")[1], "base64url"));
    assert.equal(data.expectedUid, claims.user_id || claims.sub, "wallet/transfer requests must match their real authenticated UID");
    res.setHeader("Content-Type", "application/json");
    const transfer = url.pathname.endsWith("/accountTransfer");
    if ((transfer && fixture.rejectTransfer) || (!transfer && fixture.rejectWallet)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { status: "UNAUTHENTICATED", message: "Unauthenticated" } }));
    } else if (fixture.fail) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { status: "UNAVAILABLE", message: "QA: 一時的な通信エラー" } }));
    } else if (url.pathname.endsWith("/accountTransfer")) {
      assert.equal(data.action, "redeem");
      res.end(JSON.stringify({ result: { token: customToken(fixture.sourceUid) } }));
    } else {
      res.end(JSON.stringify({ result: { balance: fixture.balance, available: true, entries: [], historyStartedAt: 0 } }));
    }
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="account.css"><link rel="stylesheet" href="velvet.css">
      <main id="app" tabindex="-1"></main>
      <script>window.qa={cancelGoogle:false,googleSubject:'qa-existing-google'}; window.HariaiApp={shared:{},returnHome(){}};</script>
      <script type="module">
        import {auth} from './firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1';
        import * as sdk from '${sdk}';
        window.qa.auth=auth; window.qa.sdk=sdk;
        await auth.authStateReady();
        if(new URLSearchParams(location.search).has('legacy') && !auth.currentUser){
          await sdk.setPersistence(auth,sdk.browserLocalPersistence); await sdk.signInAnonymously(auth);
        }
        await import('./account.js?v=auth-session-qa'); window.qa.ready=true;
      </script></html>`);
    return;
  }
  if (url.pathname === "/qa-auth-facade.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(`export * from '${sdk}'; import {GoogleAuthProvider,linkWithCredential,signInWithCredential} from '${sdk}';
      export function signInWithPopup(auth){
        if(window.qa.cancelGoogle) return Promise.reject(Object.assign(new Error('cancelled'),{code:'auth/popup-closed-by-user'}));
        const token=JSON.stringify({sub:window.qa.googleSubject,email:window.qa.googleSubject+'@example.test',email_verified:true});
        return signInWithCredential(auth,GoogleAuthProvider.credential(token));
      }
      export function linkWithPopup(user){
        if(window.qa.cancelGoogle) return Promise.reject(Object.assign(new Error('cancelled'),{code:'auth/popup-closed-by-user'}));
        const token=JSON.stringify({sub:window.qa.googleSubject,email:window.qa.googleSubject+'@example.test',email_verified:true});
        return linkWithCredential(user,GoogleAuthProvider.credential(token)).catch(error=>{
          // Popup errors carry the returned OAuth credential; credential-only
          // emulator errors omit it. Reproduce that popup contract locally.
          if(error.code==='auth/credential-already-in-use'){
            error.customData={...error.customData,_tokenResponse:{oauthIdToken:token,providerId:'google.com'}};
          }
          throw error;
        });
      }`);
    return;
  }
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(root + path.sep) || !/\.(?:js|mjs|css)$/.test(file) || !fs.existsSync(file)) {
    res.statusCode = 404; res.end(); return;
  }
  let body = fs.readFileSync(file, "utf8");
  if (url.pathname === "/firebase-services.js") {
    body = body.replace('127.0.0.1:9099', authHost)
      .replace('"127.0.0.1", 5001', `"127.0.0.1", ${port}`);
  }
  if (["/account.js", "/account-switch.js"].includes(url.pathname)) body = body.replace(sdk, "/qa-auth-facade.js");
  res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/javascript");
  res.end(body);
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const checks = [];
  const recordCheck = (check) => { checks.push(check); console.log(`PASS: ${check}`); };
  const pages = [];
  const errors = [];
  let anonymousRequests = 0;
  async function newPage(extra = "") {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(15000);
    await context.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if (target.host === authHost && /accounts:signUp/.test(target.pathname)) anonymousRequests++;
      if (target.origin === origin || target.host === authHost || target.hostname === "www.gstatic.com") return route.continue();
      if (/googleapis\.com|firebaseapp\.com|firebasedatabase/.test(target.hostname)) errors.push(`Unexpected remote service: ${target.hostname}`);
      return route.abort();
    });
    const page = await context.newPage();
    pages.push(page);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(`${origin}/?firebaseEmulators${extra}`);
    await page.waitForFunction(() => window.qa?.ready);
    return page;
  }
  const uid = (page) => page.evaluate(() => window.qa.auth.currentUser?.uid);
  const openWallet = async (page) => {
    await page.evaluate(() => window.HariaiAccount.start());
    await page.waitForSelector(".account-wallet");
  };
  try {
    const page = await newPage("&legacy=1");
    fixture.sourceUid = await uid(page);
    const before = anonymousRequests;
    await openWallet(page);
    assert.equal(await uid(page), fixture.sourceUid);
    assert.equal(anonymousRequests, before);
    assert.match(await page.locator(".account-wallet").innerText(), /875/);
    await page.evaluate(() => history.replaceState(null, "", "/?firebaseEmulators"));
    recordCheck("legacy anonymous identity adopted without a new account");

    fixture.fail = true;
    await page.reload(); await page.waitForFunction(() => window.qa?.ready); await openWallet(page);
    assert.match(await page.locator(".account-wallet").innerText(), /残高は未確認/);
    assert.match(await page.locator(".account-wallet strong").innerText(), /--/);
    await page.screenshot({ path: path.join(output, "wallet-unavailable.png"), fullPage: true });
    fixture.fail = false;
    await page.click("#accountReload");
    await page.waitForFunction(() => document.querySelector(".account-wallet strong")?.textContent.includes("875"));
    assert.equal(await uid(page), fixture.sourceUid);
    recordCheck("read failure displays unknown and retry restores the same account balance");

    await page.evaluate(() => window.qa.sdk.signOut(window.qa.auth));
    await page.reload(); await page.waitForFunction(() => window.qa?.ready); await openWallet(page);
    await page.waitForSelector("#authRecoveryTitle");
    assert.equal(anonymousRequests, before);
    await page.screenshot({ path: path.join(output, "recovery-required.png") });
    recordCheck("lost authentication with retained history blocks automatic guest creation");
    await Promise.all([
      page.waitForNavigation(),
      page.click("[data-auth-recover]"),
    ]);
    await page.waitForFunction(() => window.qa?.ready && document.querySelector(".account-wallet"));
    assert.notEqual(await uid(page), fixture.sourceUid);
    assert.equal(anonymousRequests, before + 1);
    recordCheck("explicit recovery creates one guest and opens the wallet after reload");

    // Seed an existing Google identity in another isolated browser context.
    const google = await newPage();
    await google.evaluate(async () => {
      const token=JSON.stringify({sub:'qa-existing-google',email:'qa-existing-google@example.test',email_verified:true});
      await window.qa.sdk.signInWithCredential(window.qa.auth,window.qa.sdk.GoogleAuthProvider.credential(token));
    });
    const googleUid = await uid(google);
    await openWallet(google);
    assert.match(await google.locator(".account-wallet").innerText(), /PROTECTED ANJUPAY/);
    recordCheck("existing Google identity is adopted without conversion to a guest");

    const guestUid = await uid(page);
    await page.evaluate(() => { window.qa.cancelGoogle=true; });
    await page.click("#accountRestoreGoogle");
    await page.waitForFunction(() => document.querySelector(".account-error")?.textContent.includes("キャンセル"));
    assert.equal(await uid(page), guestUid);
    await page.evaluate(() => { window.qa.cancelGoogle=false; });
    await page.click("#accountRestoreGoogle");
    await page.waitForSelector("#accountUseExistingGoogle");
    assert.equal(await uid(page), guestUid);
    fixture.rejectWallet = true;
    await page.click("#accountUseExistingGoogle");
    await page.waitForFunction((expected) => window.qa.auth.currentUser?.uid === expected && document.querySelector(".account-notice")?.textContent.includes("保護済み"), googleUid);
    await page.waitForSelector("#accountPageReload");
    assert.match(await page.locator(".account-wallet strong").innerText(), /--/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("hariai-auth-session-v1")).uid), googleUid);
    recordCheck("Google cancellation and collision preserve the guest until an explicit successful switch");
    recordCheck("existing Google sign-in success remains visible when the wallet is rejected");
    fixture.rejectWallet = false;
    await page.click("#accountReload");
    await page.waitForFunction(() => document.querySelector(".account-wallet strong")?.textContent.includes("875"));
    assert.match(await page.locator("[data-account-auth-notice]").innerText(), /保護済み/);

    const linked = await newPage();
    await openWallet(linked);
    const linkUid = await uid(linked);
    await linked.evaluate(() => { window.qa.googleSubject='qa-new-google'; });
    fixture.rejectWallet = true;
    await linked.click("#accountProtectGoogle");
    await linked.waitForSelector("#accountPageReload");
    assert.match(await linked.locator("[data-account-auth-notice]").innerText(), /Google連携が完了/);
    assert.match(await linked.locator(".account-error").innerText(), /ログイン状態またはブラウザの安全性/);
    assert.equal(await uid(linked), linkUid);
    await linked.screenshot({ path: path.join(output, "google-success-wallet-rejected.png"), animations: "disabled" });
    await linked.locator('[aria-label="安全性確認の案内"]').screenshot({ path: path.join(output, "access-help.png"), animations: "disabled" });
    recordCheck("new Google protection links in place without changing UID");
    fixture.rejectWallet = false;
    await linked.click("#accountReload");
    await linked.waitForFunction(() => document.querySelector(".account-wallet strong")?.textContent.includes("875"));
    assert.match(await linked.locator("[data-account-auth-notice]").innerText(), /Google連携が完了/);
    assert.equal(await uid(linked), linkUid);
    recordCheck("Google success and wallet failure are separate; wallet retry preserves the success");

    const transferred = await newPage();
    await openWallet(transferred);
    const beforeTransferUid = await uid(transferred);
    fixture.rejectTransfer = true;
    await transferred.fill("#transferCodeInput", "7KMP-9RDX-W4HZ-3QCV");
    await transferred.locator("#redeemTransferForm button").click();
    await transferred.waitForSelector("#accountPageReload");
    assert.equal(await uid(transferred), beforeTransferUid);
    assert.equal(await transferred.locator("[data-account-auth-notice]").count(), 0);
    recordCheck("a rejected transfer shows safety guidance without switching the guest");
    fixture.rejectTransfer = false;
    fixture.rejectWallet = true;
    await transferred.fill("#transferCodeInput", "7KMP-9RDX-W4HZ-3QCV");
    await transferred.locator("#redeemTransferForm button").click();
    await transferred.waitForFunction((expected) => window.qa.auth.currentUser?.uid === expected && document.querySelector("[data-account-auth-notice]")?.textContent.includes("引き継ぎが完了"), fixture.sourceUid);
    await transferred.waitForSelector("#accountPageReload");
    assert.match(await transferred.locator(".account-wallet strong").innerText(), /--/);
    recordCheck("successful handoff stays successful despite a later rejected wallet read");
    fixture.rejectWallet = false;
    await Promise.all([transferred.waitForNavigation(), transferred.click("#accountPageReload")]);
    await transferred.waitForFunction(() => window.qa?.ready);
    await transferred.waitForFunction(() => document.querySelector(".account-wallet strong")?.textContent.includes("875"));
    assert.equal(await uid(transferred), fixture.sourceUid);
    assert.equal(await transferred.evaluate(() => JSON.parse(localStorage.getItem("hariai-auth-session-v1")).uid), fixture.sourceUid);
    recordCheck("custom-token handoff restores the original UID and survives a full page reload");

    const acceptDialogs = target => { target.removeAllListeners("dialog"); target.on("dialog", dialog => dialog.accept()); };
    const rejectNextConfirmation = target => {
      target.removeAllListeners("dialog");
      target.once("dialog", dialog => {
        assert.match(dialog.message(), /合算・削除しません/);
        assert.match(dialog.message(), /Google連携も変更しません/);
        return dialog.dismiss();
      });
    };
    const waitForSwitch = async (target, expectedUid, action) => {
      await Promise.all([target.waitForNavigation(), action()]);
      await target.waitForFunction(() => window.qa?.ready);
      await target.waitForSelector("#accountReturnPrevious");
      assert.equal(await uid(target), expectedUid);
    };

    await page.waitForSelector("#accountReturnPrevious");
    rejectNextConfirmation(page);
    await page.click("#accountReturnPrevious");
    assert.equal(await uid(page), googleUid);
    acceptDialogs(page);
    await waitForSwitch(page, guestUid, () => page.click("#accountReturnPrevious"));
    assert.equal(await page.evaluate(() => window.qa.auth.currentUser.isAnonymous), true);
    recordCheck("return confirmation can be canceled; the played anonymous session is recoverable after reload");

    await linked.evaluate(() => { window.qa.googleSubject='qa-existing-google'; window.qa.cancelGoogle=true; });
    await linked.click("#accountRestoreGoogle");
    await linked.waitForFunction(() => document.querySelector(".account-error")?.textContent.includes("キャンセル"));
    assert.equal(await uid(linked), linkUid);
    await linked.evaluate(() => { window.qa.cancelGoogle=false; });
    rejectNextConfirmation(linked);
    await linked.click("#accountRestoreGoogle");
    await linked.waitForFunction(() => !document.querySelector("#accountRestoreGoogle").disabled);
    assert.equal(await uid(linked), linkUid);
    recordCheck("Google-linked account survives OAuth cancellation and cancellation after selecting another Google identity");
    acceptDialogs(linked);
    await waitForSwitch(linked, googleUid, () => linked.click("#accountRestoreGoogle"));
    assert.match(await linked.locator("[data-account-auth-notice]").innerText(), /切り替えが完了/);
    await waitForSwitch(linked, linkUid, () => linked.click("#accountReturnPrevious"));
    assert.equal(await linked.evaluate(() => window.qa.auth.currentUser.providerData[0].providerId), "google.com");
    recordCheck("Google-to-Google switching and return preserve both Google identities across full reloads");

    const beforeBlockedSwitch = fixture.calls;
    await linked.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.qa.restoreStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function(key, value) {
        if (key === "hariai-account-return-storage-check-v1") throw new Error("storage blocked for QA");
        return original.call(this, key, value);
      };
    });
    await linked.fill("#transferCodeInput", "7KMP-9RDX-W4HZ-3QCV");
    await linked.locator("#redeemTransferForm button").click();
    await linked.waitForFunction(() => document.querySelector(".account-error")?.textContent.includes("切り替えを中止"));
    assert.equal(await uid(linked), linkUid);
    assert.equal(fixture.calls, beforeBlockedSwitch);
    await linked.evaluate(() => window.qa.restoreStorage());
    recordCheck("unavailable backup storage aborts before any code is redeemed or identity changes");

    rejectNextConfirmation(linked);
    await linked.fill("#transferCodeInput", "7KMP-9RDX-W4HZ-3QCV");
    await linked.locator("#redeemTransferForm button").click();
    assert.equal(await uid(linked), linkUid);
    assert.equal(fixture.calls, beforeBlockedSwitch);
    acceptDialogs(linked);
    await waitForSwitch(linked, fixture.sourceUid, () => linked.locator("#redeemTransferForm button").click());
    assert.equal(await linked.evaluate(() => window.qa.auth.currentUser.providerData.length), 0);
    await linked.screenshot({ path: path.join(output, "switch-with-return-mobile.png"), animations: "disabled", fullPage: true });
    await waitForSwitch(linked, linkUid, () => linked.click("#accountReturnPrevious"));
    assert.equal(await linked.evaluate(() => window.qa.auth.currentUser.providerData[0].providerId), "google.com");
    recordCheck("a played Google-linked account can switch by code and return with its original Google link intact");
    assert.deepEqual(errors, []);
    const report = { ok: true, project: "demo-gazostadium", checks, anonymousRequests, rpcFixtureCalls: fixture.calls, errors };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    for (const [index, page] of pages.entries()) {
      if (!page.isClosed()) {
        console.error(`Page ${index}:`, await page.locator(".account-error, [data-auth-recovery-error]").allTextContents());
        await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
      }
    }
    console.error("Page errors:", errors);
    throw error;
  } finally {
    server.closeAllConnections(); server.close();
    // Some Windows drivers leave close() pending after the browser exits.
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
}
main().then(() => process.exit(0)).catch((error) => {
  console.error(error); server.closeAllConnections(); server.close(); process.exit(1);
});
