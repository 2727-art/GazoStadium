"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const acorn=require("acorn");
const root=path.resolve(__dirname,"../..");
test("the built entry keeps demo payloads and detail styles out of the initial static graph",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"assets/ranch/manifest.json"),"utf8"));
  require("./helpers/ranch-release.cjs").assertRanchRelease(fs.readFileSync(path.join(root,"index.html"),"utf8"));
  const source=fs.readFileSync(path.join(root,manifest.entry),"utf8");
  const ast=acorn.parse(source,{sourceType:"module",ecmaVersion:"latest"});
  assert.ok(ast.body.filter(n=>n.type==="ImportDeclaration").every(n=>!/^\.\/ranch-[A-Z0-9]+\.js$/.test(n.source.value)),"the demo is not statically imported");
  assert.match(source,/import\("\.\/ranch-[A-Z0-9]+\.js"\)/);
  assert.ok(source.includes("tribute-details"));
  assert.ok(!source.includes("今月も一番に貢ぎます。見ててください。"),"development sample data lives in the lazy chunk");
  assert.ok(source.includes("pendingInvite")===false,"production minification is active");
  assert.ok(manifest.files.find(f=>f.file===manifest.entry).bytes < 470000);
});

test("every shipped manager avatar resolves to an existing public image after bundling", async () => {
  const { pathToFileURL } = require("node:url");
  const { AVATARS, avatarId } = await import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/ranch/manifest.json"), "utf8"));
  const source = fs.readFileSync(path.join(root, manifest.entry), "utf8");
  for (const origin of ["https://hariaistadium.com", "https://gazostadium.anjugames.workers.dev", "https://gazostadium.web.app", "https://gazostadium.firebaseapp.com", "http://127.0.0.1:8766"]) {
    const urlFor = require("./helpers/ranch-built-avatars.cjs").builtAvatarUrl(source, `${origin}/${manifest.entry}`, avatarId);
    for (const { id } of AVATARS) {
      const url = new URL(urlFor(id));
      const publicPath = `/assets/tribute-avatars/avatar-${String(id).padStart(2, "0")}.webp`;
      assert.equal(url.href, origin + publicPath);
      assert.ok(fs.existsSync(path.join(root, publicPath.slice(1))), url.pathname);
    }
    for (const value of [0, -1, 52, null, "../avatar-01.webp"]) assert.equal(urlFor(value), "");
  }
});
