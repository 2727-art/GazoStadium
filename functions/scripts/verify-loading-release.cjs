"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync}=require('node:child_process');
const acorn=require('acorn');
const {ORIGINS}=require('./verify-player-safety-release.cjs');
const root=path.resolve(__dirname,'../..');
const source=file=>execFileSync('git',['show',`HEAD:${file}`],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
const hash=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const html=source('index.html');
const font=JSON.parse(source('assets/fonts/landing-subset.json'));
const fontPath='/assets/fonts/'+font.file;
const immutable=new Set(JSON.parse(source('assets/firebase/manifest.json')).files.filter(file=>file.file.endsWith('.js')).map(file=>'/'+file.file));
const manifest=JSON.parse(html.match(/id="featureManifest">([\s\S]*?)<\/script>/)[1]);
const assets=new Map();
function add(raw,base='https://local.example/'){
 const url=new URL(raw,base);if(url.origin!=='https://local.example')return;
 if(assets.has(url.pathname))return;
 const file=url.pathname.slice(1);const body=source(file);assets.set(url.pathname,{url:url.pathname+url.search,hash:hash(body)});
 if(/\.m?js$/.test(file)){
  const walk=node=>{if(!node||typeof node!=='object')return;if(['ImportDeclaration','ImportExpression','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source?.value)add(node.source.value,url.href);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}};
  walk(acorn.parse(body,{ecmaVersion:'latest',sourceType:'module'}));
 }
}
for(const m of html.matchAll(/(?:src|href|data-src)="([^"]+\.(?:m?js|css)\?v=[^"]+)"/g))add(m[1]);
for(const value of Object.values(manifest)){if(value.module)add(value.module);for(const script of value.classic||[])add(script);}
const excluded=['/market.js','/market.css','/market-transfer.mjs','/flea-market.js','/flea-market.css','/danwaku-note.js','/danwaku-note.css','/free-table.js','/free-table.css','/scripts/market-records-shell.js','/database.rules.json','/functions/creator-card-refund.js'];
async function request(origin,url){const r=await fetch(origin+url,{cache:'no-store',signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.text(),cacheControl:r.headers.get('cache-control')};}
(async()=>{
 const result={checkedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),routes:[]};
 for(const origin of ORIGINS){
  const index=await request(origin,'/?loadingCheck='+Date.now());
  const results=[];
  // Small bounded groups keep the release check from becoming a traffic spike.
  const entries=[...assets];
  for(let i=0;i<entries.length;i+=4)results.push(...await Promise.all(entries.slice(i,i+4).map(async([file,expected])=>{const r=await request(origin,expected.url);return {file,ok:r.status===200&&hash(r.body)===expected.hash&&(!immutable.has(file)||/max-age=31536000.*immutable/.test(r.cacheControl||''))};})));
  const retired=[];for(const file of excluded)retired.push({file,status:(await request(origin,file)).status});
  const icon=await request(origin,'/favicon.ico');
  const fontResponse=await fetch(origin+fontPath,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  const fontOk=fontResponse.status===200&&crypto.createHash('sha256').update(Buffer.from(await fontResponse.arrayBuffer())).digest('hex')===font.sha256&&/max-age=31536000.*immutable/.test(fontResponse.headers.get('cache-control')||'');
  const fixtureStatus=(await request(origin,'/functions/test/fixtures/mobile-sdk-session.html')).status;
  result.routes.push({origin,ok:index.status===200&&hash(index.body)===hash(html)&&results.every(r=>r.ok)&&retired.every(r=>r.status===404)&&icon.status===200&&fontOk&&fixtureStatus===404,assets:results,excluded:retired,faviconStatus:icon.status,fontOk,fixtureStatus});
 }
 result.ok=result.routes.every(r=>r.ok);
 const out=process.argv[2];if(out)fs.writeFileSync(out,JSON.stringify(result,null,2));
 console.log(JSON.stringify({ok:result.ok,checkedAt:result.checkedAt,routes:result.routes.map(r=>({origin:r.origin,ok:r.ok,assets:r.assets.length,failed:r.assets.filter(a=>!a.ok),excludedFailures:r.excluded.filter(a=>a.status!==404),faviconStatus:r.faviconStatus,fontOk:r.fontOk,fixtureStatus:r.fixtureStatus}))},null,2));
 if(!result.ok)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
