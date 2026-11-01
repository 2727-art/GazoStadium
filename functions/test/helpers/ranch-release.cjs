// Release markers were replaced by generated filenames. Check the actual source/artifact relationship instead.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"../../..");
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
module.exports.assertRanchRelease=function(html){
  const built=JSON.parse(fs.readFileSync(path.join(root,"assets/ranch/manifest.json"),"utf8"));
  const features=JSON.parse(html.match(/id="featureManifest">([\s\S]*?)<\/script>/)[1]);
  assert.equal(features.tribute.module,built.entry);
  assert.ok(html.includes(`data-feature-style="tribute.css" data-src="${built.baseCss}"`));
  assert.ok(html.includes(`data-feature-style="tribute-details.css" data-src="${built.detailCss}"`));
  for(const [file,expected]of Object.entries(built.inputs))assert.equal(sha(fs.readFileSync(path.join(root,file),"utf8").replace(/\r\n/g,"\n")),expected,`${file} changed without rebuilding the ranch`);
  for(const {file,sha256}of built.files)assert.equal(sha(fs.readFileSync(path.join(root,file))),sha256,file);
};
