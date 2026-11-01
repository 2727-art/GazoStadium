// Keep editable source and its fixtures together; publish a minified entry with a lazy demo chunk.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const acorn = require("../functions/node_modules/acorn");
const esbuild = require("../functions/node_modules/esbuild");
const postcss = require("../functions/node_modules/postcss");
const read = file => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const hash = text => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
const walk = (node, visit, parent = null) => { if (!node || typeof node !== "object") return; if (node.type) visit(node, parent); for (const [key,value] of Object.entries(node)) { if (["start","end"].includes(key)) continue; if (Array.isArray(value)) value.forEach(n => walk(n,visit,node)); else if(value && typeof value === "object") walk(value,visit,node); } };
const parse = text => acorn.parse(text, { ecmaVersion: "latest", sourceType: "module" });
function names(ast) {
  return new Set(ast.body.flatMap(n => n.type === "ImportDeclaration" ? n.specifiers.map(s=>s.local.name) : n.type === "FunctionDeclaration" ? [n.id.name] : n.type === "VariableDeclaration" ? n.declarations.map(d=>d.id.name).filter(Boolean) : []));
}
function rewrite(text, edits) { for (const e of edits.sort((a,b)=>b.start-a.start)) text = text.slice(0,e.start)+e.text+text.slice(e.end); return text; }

async function build() {
  const source = read("tribute.js");
  const start = source.indexOf("function previewNow()");
  const end = source.indexOf("window.HariaiTribute =");
  if (start < 0 || end <= start) throw Error("Ranch preview boundaries changed");
  // Invite handling is production code embedded between the two original sample sections.
  const inviteStart = source.indexOf("let pendingInvite =", start), inviteEnd = source.indexOf("// 見本で保存したカード", inviteStart);
  if(inviteStart < start || inviteEnd >= end) throw Error("Ranch invitation boundaries changed");
  const fixture = source.slice(start,inviteStart)+source.slice(inviteEnd,end), fixtureAst = parse(fixture), fixtureNames = names(fixtureAst);
  const main = source.slice(0,start)+source.slice(inviteStart,inviteEnd)+source.slice(end), mainNames = names(parse(source));
  const used = new Set(), external = new Set(), stateEdits=[];
  walk(parse(main), n => { if(n.type === "Identifier" && fixtureNames.has(n.name)) used.add(n.name); });
  walk(fixtureAst, (n,parent) => {
    if(n.type !== "Identifier") return;
    if(mainNames.has(n.name) && !fixtureNames.has(n.name)) external.add(n.name);
    if(n.name !== "state") return;
    if(parent.type === "MemberExpression" && parent.property === n && !parent.computed) return;
    if(parent.type === "Property" && parent.key === n && !parent.computed && !parent.shorthand) return;
    if(parent.type === "Property" && parent.shorthand && parent.key !== n) return;
    stateEdits.push({start:n.start,end:n.end,text:parent.type === "Property" && parent.shorthand ? "state: runtime.state" : "runtime.state"});
  });
  external.delete("state");
  const preview = `export function createPreview(runtime) {\nconst {${[...external].sort().join(",")}} = runtime;\n${rewrite(fixture,stateEdits)}\nreturn {${[...used].join(",")}};\n}\n`;
  const edits=[];
  walk(parse(main), n => { if(n.type === "Identifier" && used.has(n.name) && !["DEMO_CONTRACT_ID","previewCall"].includes(n.name)) edits.push({start:n.start,end:n.end,text:`previewImplementation.${n.name}`}); });
  let entry = rewrite(main,edits);
  const bridge = `\nconst DEMO_CONTRACT_ID = "demo";\nlet previewImplementation, previewRequest;\nfunction loadPreviewImplementation() {\nreturn previewRequest ||= import("ranch-preview").then(module => previewImplementation = module.createPreview({ get state() { return state; }, ${[...external].sort().join(",")} })).catch(error => { previewRequest = null; throw error; });\n}\nfunction previewCall(...args) { return loadPreviewImplementation().then(module => module.previewCall(...args)); }\n`;
  entry = entry.replace("window.HariaiTribute =", bridge+"\nwindow.HariaiTribute =");
  const demo = 'case "open-demo":\n      openThread(DEMO_CONTRACT_ID);\n      return;';
  if(!entry.includes(demo)) throw Error("Ranch demo entry changed");
  entry = entry.replace(demo, 'case "open-demo": {\n      const demoGeneration = lifecycleGeneration, demoState = state;\n      await loadPreviewImplementation();\n      if (isCurrent(demoGeneration) && state === demoState) openThread(DEMO_CONTRACT_ID);\n      return;\n    }');

  // Detailed styles are needed only when these screens are first rendered. Keep the shared frame visible while loading.
  const renderHead = "function render() {";
  if(!entry.includes(renderHead)) throw Error("Ranch renderer changed");
  entry = entry.replace(renderHead, `${renderHead}\n  if (active && ["thread", "card", "apply"].includes(state.screen) && !detailStylesReady) {\n    appRoot.innerHTML = frame('<p class="tribute-empty">画面を読み込んでいます…</p>', { title: "読み込み中" });\n    if (!detailStylesRequest) loadDetailStyles().then(() => { if (active) render(); }).catch(error => { if (active) showToast(friendlyError(error)); });\n    return;\n  }`);
  entry = entry.replace("window.HariaiTribute =", 'let detailStylesReady = false, detailStylesRequest;\nfunction loadDetailStyles() { return detailStylesRequest ||= window.HariaiFeatures.load("tribute-details").then(() => { detailStylesReady = true; }).catch(error => { detailStylesRequest = null; throw error; }); }\nwindow.HariaiTribute =');
  const built = await esbuild.build({ stdin:{contents:entry,resolveDir:root,sourcefile:"tribute.js"},bundle:true,splitting:true,format:"esm",target:"es2022",minify:true,write:false,outdir:path.join(root,"assets/ranch"),entryNames:"tribute-[hash]",chunkNames:"ranch-[hash]",plugins:[{
    name:"ranch-source",setup(build){
      build.onResolve({filter:/^ranch-preview$/},()=>({path:"preview",namespace:"ranch"}));
      build.onLoad({filter:/.*/,namespace:"ranch"},()=>({contents:preview,loader:"js",resolveDir:root}));
      build.onResolve({filter:/tribute-core\.mjs\?v=/},args=>({path:path.join(root,"tribute-core.mjs")}));
      build.onResolve({filter:/^\.\.?\//},args=>({path:"/"+path.relative(root,path.resolve(args.resolveDir,args.path.split("?")[0])).replaceAll("\\","/")+(args.path.includes("?")?"?"+args.path.split("?").slice(1).join("?"):""),external:true}));
    }
  }] });
  const css = postcss.parse(read("tribute.css")), detailed = css.clone();
  const deferred = rule => rule.selectors.every(selector => /\.tribute-(?:thread|event|timeline|othello|recite|contest|card-editor|avatar-choice|avatar-choices|avatars|avatar-trial|frame-trial)(?:[\s.:#>+~\[-]|$)/.test(selector));
  css.walkRules(rule=>{if(rule.parent.type!=="atrule"||! /keyframes$/.test(rule.parent.name)){if(deferred(rule))rule.remove();}});
  detailed.walkRules(rule=>{if(rule.parent.type==="atrule"&&/keyframes$/.test(rule.parent.name))rule.remove();else if(!deferred(rule))rule.remove();});
  const outputs=built.outputFiles.map(f=>({file:path.relative(root,f.path).replaceAll("\\","/"),body:f.contents}));
  const cssNames=[];
  for(const [name,tree]of [["base",css],["details",detailed]]){
    tree.walkComments(n=>n.remove());tree.walkAtRules(n=>{if(n.nodes&&!n.nodes.length)n.remove();});
    const text=(await esbuild.transform(tree.toString(),{loader:"css",minify:true,target:"es2022"})).code;
    const file=`assets/ranch/${name}-${hash(text)}.css`;outputs.push({file,body:Buffer.from(text)});cssNames.push(file);
  }
  const jsEntry=outputs.find(f=>/tribute-[^/]+\.js$/.test(f.file)).file;
  const inputs=Object.fromEntries(["tribute.js","tribute-core.mjs","tribute.css","scripts/build-ranch-client.cjs"].map(file=>[file,crypto.createHash("sha256").update(read(file)).digest("hex")]));
  const manifest={entry:jsEntry,baseCss:cssNames[0],detailCss:cssNames[1],inputs,files:outputs.map(f=>({file:f.file,bytes:f.body.length,sha256:crypto.createHash("sha256").update(f.body).digest("hex")}))};
  let html=read("index.html");
  html=html.replace(/(data-feature-style="tribute\.css" data-src=")[^"]+("\s*\/?>)/,`$1${cssNames[0]}$2`);
  const detailLink=`    <link data-feature-style="tribute-details.css" data-src="${cssNames[1]}" />`;
  html=html.includes('data-feature-style="tribute-details.css"')?html.replace(/^.*data-feature-style="tribute-details\.css".*$/m,detailLink):html.replace(/(^.*data-feature-style="tribute\.css".*$)/m,`$1\n${detailLink}`);
  const featureMatch=html.match(/id="featureManifest">([\s\S]*?)<\/script>/);const features=JSON.parse(featureMatch[1]);features.tribute.module=jsEntry;features["tribute-details"]={styles:["tribute-details.css"]};
  html=html.replace(featureMatch[1],"\n"+JSON.stringify(features,null,2)+"\n");
  outputs.push({file:"assets/ranch/manifest.json",body:Buffer.from(JSON.stringify(manifest,null,2)+"\n")},{file:"index.html",body:Buffer.from(html)});
  const headerStart="# BEGIN GENERATED RANCH CACHE",headerEnd="# END GENERATED RANCH CACHE";
  const headerBlock=headerStart+"\n"+manifest.files.map(f=>`/${f.file}\n  Cache-Control: public, max-age=31536000, immutable\n`).join("\n")+headerEnd+"\n";
  const headers=read("_headers").replace(new RegExp(headerStart+"[\\s\\S]*?"+headerEnd+"\\n?"),"").trimEnd()+"\n\n"+headerBlock;
  const firebase=JSON.parse(read("firebase.json"));firebase.hosting.headers=firebase.hosting.headers.filter(h=>!h.source.startsWith("/assets/ranch/"));
  firebase.hosting.headers.push(...manifest.files.map(f=>({source:"/"+f.file,headers:[{key:"Cache-Control",value:"public, max-age=31536000, immutable"}]})));
  outputs.push({file:"_headers",body:Buffer.from(headers)},{file:"firebase.json",body:Buffer.from(JSON.stringify(firebase,null,2)+"\n")});
  if(!process.argv.includes("--check") && fs.existsSync(path.join(root,"assets/ranch/manifest.json"))){
    const previous=JSON.parse(read("assets/ranch/manifest.json"));
    for(const old of previous.files){const absolute=path.resolve(root,old.file);if(path.dirname(absolute)!==path.join(root,"assets/ranch")||!/^(tribute-|ranch-|base-|details-)[a-zA-Z0-9-]+\.(js|css)$/.test(path.basename(absolute)))throw Error("Unexpected generated ranch path");if(!outputs.some(f=>f.file===old.file)&&fs.existsSync(absolute))fs.unlinkSync(absolute);}
  }
  for(const output of outputs){if(process.argv.includes("--check")){if(!fs.existsSync(path.join(root,output.file))||!fs.readFileSync(path.join(root,output.file)).equals(output.body))throw Error(`${output.file} needs regeneration`);}else{fs.mkdirSync(path.dirname(path.join(root,output.file)),{recursive:true});fs.writeFileSync(path.join(root,output.file),output.body);}}
  console.log(JSON.stringify({entry:jsEntry,previewBindings:[...used],runtimeBindings:[...external],files:manifest.files}));
}
build().catch(error=>{console.error(error);process.exitCode=1;});
