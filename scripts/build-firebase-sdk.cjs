// Ship only the public SDK exports used by this application, at the existing SDK version.
// Shared ESM chunks ensure Auth, App Check and both databases see one Firebase registry.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('../functions/node_modules/esbuild');
const acorn = require('../functions/node_modules/acorn');
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
const version = require('../functions/node_modules/firebase-web/package.json').version;
if (version !== '12.16.0') throw Error('Review SDK upgrades separately from the loading optimization.');
const files = fs.readdirSync(root).filter(file => /\.m?js$/.test(file)).concat('scripts/market-records-shell.js');
const sources = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const exportsByModule = new Map();
const sdkModule = raw => raw.match(/(?:\/firebasejs\/12\.16\.0\/firebase-|\.\/assets\/firebase\/firebase-)(app-check|app|auth|database|firestore|functions)(?:-[A-Z0-9]+)?\.js(?:\?.*)?$/)?.[1];
for (const source of sources.values()) {
  for (const node of acorn.parse(source, {ecmaVersion:'latest',sourceType:'module'}).body) {
    if (node.type !== 'ImportDeclaration') continue;
    const name = sdkModule(node.source.value);
    if (!name) continue;
    if (!exportsByModule.has(name)) exportsByModule.set(name, new Set());
    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ImportSpecifier') throw Error('Use named Firebase imports.');
      exportsByModule.get(name).add(specifier.imported.name);
    }
  }
}
(async () => {
  const names = [...exportsByModule.keys()].sort();
  const outdir = path.join(root,'assets/firebase');
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: Object.fromEntries(names.map(name=>[name,'sdk:'+name])),
    bundle:true, splitting:true, format:'esm', platform:'browser', target:['es2020'],
    minify:true, legalComments:'external', write:false, metafile:true,
    outdir, entryNames:'firebase-[name]-[hash]', chunkNames:'chunk-[hash]',
    plugins:[{name:'sdk-exports',setup(build){
      build.onResolve({filter:/^sdk:/},args=>({path:args.path.slice(4),namespace:'sdk'}));
      build.onLoad({filter:/.*/,namespace:'sdk'},args=>({
        contents:`export { ${[...exportsByModule.get(args.path)].sort().join(', ')} } from "firebase-web/${args.path}";`,
        resolveDir:path.join(root,'functions'),loader:'js',
      }));
    }}],
  });
  const entries = Object.fromEntries(Object.entries(result.metafile.outputs).filter(([,value])=>value.entryPoint).map(([file,value])=>[value.entryPoint.replace(/^sdk:/,''),file.replaceAll('\\','/')]));
  const manifest={version,esbuild:esbuild.version,exports:Object.fromEntries(names.map(name=>[name,[...exportsByModule.get(name)].sort()])),entries,
    files:result.outputFiles.map(file=>({file:path.relative(root,file.path).replaceAll('\\','/'),bytes:file.contents.length,sha256:crypto.createHash('sha256').update(file.contents).digest('hex')}))};
  const write=(file,body)=>{const full=path.join(root,file);if(check){if(!fs.existsSync(full)||!fs.readFileSync(full).equals(Buffer.from(body)))throw Error(`${file} needs: node scripts/build-firebase-sdk.cjs`);}else{fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,body);}};
  for(const file of result.outputFiles)write(path.relative(root,file.path),file.contents);
  write('assets/firebase/manifest.json',JSON.stringify(manifest,null,2)+'\n');
  for(const [file,source] of sources){
    const next=source.replace(/(?:https:\/\/www\.gstatic\.com\/firebasejs\/12\.16\.0\/firebase-|\.\/assets\/firebase\/firebase-)(app-check|app|auth|database|firestore|functions)(?:-[A-Z0-9]+)?\.js(?:\?[^"']*)?/g,(_,name)=>'./'+entries[name]);
    if(source!==next){if(check)throw Error(`${file} has stale SDK imports`);write(file,next);}
  }
  console.log(JSON.stringify({version,entries,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
