const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const acorn = require('acorn');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('ranch module starts with CSS and classic dependencies, but entry waits for all three', async () => {
 const module=deferred(),css=deferred(),classic=deferred(),events=[];
 const link={dataset:{src:'ranch.css'},set href(value){events.push('css');css.promise.then(()=>this.onload());}};
 const context={URL,Promise,Map,window:{},loadModule:()=>{events.push('module');return module.promise;},document:{baseURI:'https://example.test/',querySelector(selector){return selector==='#featureManifest'?{textContent:JSON.stringify({ranch:{depends:['achievements'],styles:['css'],module:'ranch.js',parallelModule:true},achievements:{classic:['achievements.js']}})}:link;},createElement:()=>({}),head:{appendChild(script){events.push('classic');classic.promise.then(()=>script.onload());}}}};
 vm.runInNewContext(read('feature-loader.js').replaceAll('import(new URL(config.module, document.baseURI).href)','loadModule(new URL(config.module, document.baseURI).href)'),context);
 let ready=false;const pending=context.window.HariaiFeatures.load('ranch');assert.equal(context.window.HariaiFeatures.load('ranch'),pending);
 pending.then(()=>{ready=true;});await tick();assert.deepEqual([...events].sort(),['classic','css','module']);
 module.resolve({});await tick();assert.equal(ready,false);classic.resolve();await tick();assert.equal(ready,false);
 css.resolve();await pending;assert.equal(ready,true);assert.equal(events.filter(x=>x==='module').length,1);
 const manifest=JSON.parse(read('index.html').match(/id="featureManifest">([\s\S]*?)<\/script>/)[1]);
 assert.deepEqual(Object.entries(manifest).filter(([,v])=>v.parallelModule).map(([k])=>k),['tribute']);
});

test('a failed parallel import can retry while entry remains blocked', async () => {
 let attempts=0;const context={URL,Promise,Map,window:{},loadModule:async()=>{if(++attempts===1)throw Error('offline');},document:{baseURI:'https://example.test/',querySelector:()=>({textContent:JSON.stringify({ranch:{module:'ranch.js',parallelModule:true}})})}};
 vm.runInNewContext(read('feature-loader.js').replaceAll('import(new URL(config.module, document.baseURI).href)','loadModule(new URL(config.module, document.baseURI).href)'),context);
 await assert.rejects(context.window.HariaiFeatures.load('ranch'),/offline/);await context.window.HariaiFeatures.load('ranch');assert.equal(attempts,2);
});

function recovery(){
 const source=read('tribute.js');const functions=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(x=>x.type==='FunctionDeclaration');
 const names=['needsPageReload','friendlyError','renderError','handleClick'];
 const state={screen:'error',fatalReloadRequired:true,fatalError:'protection failed',thread:{}};
 let reloads=0,retries=0;
 const context={state,window:{location:{reload(){reloads++;}}},lifecycleGeneration:0,active:true,start(){retries++;},frame:x=>x,escapeHtml:x=>x};
 vm.runInNewContext(functions.filter(x=>names.includes(x.id.name)).map(x=>source.slice(x.start,x.end)).join('\n'),context);
 return {context,state,counts:()=>({reloads,retries})};
}

test('SDK App Check failures and ambiguous callable 401 preserve data and offer full-page recovery', async () => {
 const {context,state,counts}=recovery();
 for(const code of ['appCheck/throttled','appCheck/initial-throttle','app-check/error','functions/unauthenticated']){
  assert.equal(context.needsPageReload({code}),true);
  assert.match(context.friendlyError({code}),/サイトデータやCookieを削除せず/);
 }
 assert.match(context.friendlyError({code:'functions/unauthenticated'}),/ログイン状態または通信保護/);
 assert.match(context.renderError(),/data-t="reload-page"/);
 await context.handleClick({dataset:{t:'reload-page'}});assert.deepEqual(counts(),{reloads:1,retries:0});
 state.screen='thread';await context.handleClick({dataset:{t:'reload-page'}});assert.equal(counts().reloads,1,'stale error controls cannot reload a transaction screen');
});

test('ordinary network or access failures retain in-page retry without claiming App Check rejection', async () => {
 const {context,state,counts}=recovery();
 for(const code of ['functions/unavailable','functions/permission-denied'])assert.equal(context.needsPageReload({code}),false);
 state.fatalReloadRequired=false;assert.match(context.renderError(),/data-t="retry"/);
 await context.handleClick({dataset:{t:'retry'}});assert.deepEqual(counts(),{reloads:0,retries:1});
});
