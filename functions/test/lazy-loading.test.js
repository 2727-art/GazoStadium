const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {execFileSync} = require('node:child_process');
const acorn = require('acorn');
const root = path.resolve(__dirname,'../..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const manifest = JSON.parse(read('index.html').match(/id="featureManifest">([\s\S]*?)<\/script>/)[1]);
const tick = async () => {for(let i=0;i<40;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('initial document excludes game and retired requests, and every lazy import has one canonical URL', () => {
 const index=read('index.html');
 const initial=[...index.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>m[1].split('?')[0]);
 assert.deepEqual(initial,['domain-move.js','audio.js','feature-loader.js','app.js','landing-hero.mjs']);
 assert.ok(index.includes('<main id="app" tabindex="-1"><section class="screen hero vl-landing">'));
 const seen=new Map();const visited=new Set();
 function walk(raw){
  const url=new URL(raw,'https://test.example/');if(url.origin!=='https://test.example')return;
  const old=seen.get(url.pathname);assert.ok(!old||old===url.href,`duplicate module ${url.pathname}: ${old} vs ${url.href}`);seen.set(url.pathname,url.href);
  if(visited.has(url.href))return;visited.add(url.href);
  const ast=acorn.parse(read(url.pathname.slice(1)),{ecmaVersion:'latest',sourceType:'module'});
  const imports=node=>{if(!node||typeof node!=='object')return;if(['ImportDeclaration','ImportExpression','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source?.value)walk(node.source.value);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(imports);else if(value&&typeof value==='object')imports(value);}};
  imports(ast);
 }
 for(const entry of Object.values(manifest))if(entry.module)walk(entry.module);
 assert.ok(!seen.has('/market.js'));assert.ok(!seen.has('/market-transfer.mjs'));
 for(const source of ['flea-market.js','danwaku-note.js','free-table.js','market.js','market.css']){
  assert.ok(read('.assetsignore').split(/\r?\n/).includes(source));
  assert.ok(JSON.parse(read('firebase.json')).hosting.ignore.includes(source));
 }
 assert.deepEqual(manifest.strategy.depends,['online']);
});

test('generated landing and record assets stay synchronized with their source renderers', () => {
 for(const script of ['build-landing.cjs','build-market-records.cjs','build-ranch-css.cjs']) execFileSync(process.execPath,[`scripts/${script}`,'--check'],{cwd:root,stdio:'pipe'});
});

test('parallel feature loads coalesce and await their dependencies/styles; a failed stylesheet can retry', async () => {
 const css=deferred();const fetched=[];const inserted=[];let attempts=0;
 const link={dataset:{src:'game.css?v=1'},removeAttribute(){},set href(value){attempts++; if(attempts===1)queueMicrotask(()=>this.onerror());else css.promise.then(()=>this.onload());}};
 const sandbox={URL,Promise,Map,window:{},document:{baseURI:'https://test.example/',querySelector(selector){return selector==='#featureManifest'?{textContent:JSON.stringify({common:{classic:['base.js']},game:{depends:['common'],styles:['game.css'],module:'game.js'}})}:link;},createElement(){return {remove(){}};},head:{appendChild(script){inserted.push(script.src);queueMicrotask(()=>script.onload());}}},loadModule:async url=>{fetched.push(url);}};
 const source=read('feature-loader.js').replace('await import(new URL(config.module, document.baseURI).href)','await loadModule(new URL(config.module, document.baseURI).href)');
 vm.runInNewContext(source,sandbox);
 const load=sandbox.window.HariaiFeatures.load;
 const first=load('game');assert.strictEqual(first,load('game'));await assert.rejects(first);
 const retry=load('game');assert.strictEqual(retry,load('game'));await tick();assert.deepEqual(fetched,[]);
 css.resolve();await retry;
 assert.deepEqual(inserted,['base.js']);assert.deepEqual(fetched,['https://test.example/game.js']);assert.equal(attempts,2);
 await load('game');assert.equal(fetched.length,1);
});

test('canceling a pending feature keeps its eventual import from navigating; later retry succeeds', async () => {
 const source=read('app.js');const ast=acorn.parse(source,{ecmaVersion:'latest'});const body=ast.body[0].expression.callee.body.body;
 const node=body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='launchFeature');assert.ok(node);
 const pending=deferred();const launched=[];const busy=[];let cancel;
 const context={navigationVersion:0,window:{HariaiFeatures:{load:()=>pending.promise}},document:{createElement(){return {};},querySelector(){return {appendChild(button){cancel=button.onclick;}};}},setBusy:value=>busy.push(value),showToast:message=>{throw Error(message);}};
 vm.runInNewContext(source.slice(node.start,node.end)+';this.launchFeature=launchFeature',context);
 const first=context.launchFeature('online',()=>launched.push('old'));cancel();pending.resolve();await first;assert.deepEqual(launched,[]);
 await context.launchFeature('online',()=>launched.push('new'));assert.deepEqual(launched,['new']);assert.equal(busy.at(-1),false);
});

for (const regular of [false, true]) {
 test(`initial landing retains its painted nodes and binds navigation${regular ? ' with the saved ranch shortcut' : ''}`, () => {
  const source=read('app.js');const body=acorn.parse(source,{ecmaVersion:'latest'}).body[0].expression.callee.body.body;
  const node=body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='renderLandingScreen');
  const bindings=new Map();const inserted=[];let replacements=0;
  const landing={dataset:{},querySelector:()=>null,prepend:node=>inserted.push(node)};
  const resume={id:'tributeResumeButton'};
  const context={navigationVersion:0,setBusy(){},clearRetiredFreeTableInvite(){},setLandingChrome(){},renderLanding:()=>'<button id="tributeResumeButton">saved shortcut</button>',
   app:{querySelector:()=>landing,set innerHTML(value){replacements++;},focus(){}},
   window:{localStorage:{getItem:()=>regular?'1':null},dispatchEvent(){},scrollTo(){}},Event:class{},
   document:{querySelector:selector=>({addEventListener:(_,fn)=>bindings.set(selector,fn)}),createElement:()=>({content:{querySelector:()=>resume}})},
   startStrategyLab(){},startOnlineBattle(){},startAiTextTraining(){},startRouletteTraining(){},startValueMarketRankings(){},startAccount(){},openAudioStudio(){}};
  vm.runInNewContext(source.slice(node.start,node.end)+';this.render=renderLandingScreen;',context);
  context.render();assert.equal(replacements,0);assert.equal(landing.dataset.landingBound,'1');
  assert.equal(bindings.get('#onlineButton'),context.startOnlineBattle);assert.equal(bindings.get('#strategyLabButton'),context.startStrategyLab);
  assert.deepEqual(inserted,regular?[resume]:[]);
  context.render();assert.equal(replacements,1,'subsequent home renders rebuild and rebind the screen');
 });
}

function recordsHarness(){
 const calls=[];const responses=new Map();const app={innerHTML:'',focus(){},insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelectorAll:()=>[]};
 const element={addEventListener(){},set disabled(v){},isConnected:true};
 const window={HariaiApp:{shared:{showToast(){},escapeHtml:v=>String(v||'').replaceAll('<','&lt;')},returnHome(){}},dispatchEvent(){}};
 const context={window,URLSearchParams,Date,console,localStorage:{getItem:()=>null},useOfflineMarketPreview:false,functions:{},document:{querySelector:selector=>selector==='#app'?app:element,querySelectorAll:()=>[],getElementById:()=>element},Event:class{},formatAnjuPay:v=>`${v} Pay`,formatAnjuPayNumber:String,ANJU_PAY_UNIT:'Pay',getPlayerTitlePresentation:()=>null,getPlayerTitleProduct:()=>null,getStamp:()=>null,renderBlockButton:()=>'',ensureHariaiUser:async()=>({uid:'alice'}),httpsCallable:()=>payload=>{calls.push(payload);const d=deferred();responses.set(payload.action+':'+(payload.period||''),d);return d.promise;}};
 const source=read('market-records.js').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(source+';this.api={start,requestHome,selectMarketRankingPeriod,openCertificates,state:()=>state};',context);
 return {api:context.api,calls,responses,app};
}
test('record reads coalesce, switching periods preserves data, and leaving rejects stale paints', async () => {
 const h=recordsHarness();const first=h.api.start();await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'list');
 const duplicate=h.api.selectMarketRankingPeriod('monthly');await tick();assert.equal(h.calls.length,1);
 h.responses.get('list:monthly').resolve({data:{period:'monthly',sellers:[{name:'Alice',primary:500,count:1}],buyers:[],monthlyAchievements:{seller:{months:3,level:2}}}});await Promise.all([first,duplicate]);assert.ok(h.app.innerHTML.includes('Alice'));assert.equal(h.api.state().rankingMonthlyAchievements.seller.months,3);
 const next=h.api.selectMarketRankingPeriod('lifetime');await tick();h.api.requestHome();h.app.innerHTML='HOME';h.responses.get('list:lifetime').resolve({data:{period:'lifetime',sellers:[{name:'Late'}]}});await next;assert.equal(h.app.innerHTML,'HOME');
});
test('certificate reads preserve historical price, fee, subsidy and seller proceeds without transaction calls', async () => {
 const h=recordsHarness();const first=h.api.start();await tick();h.responses.get('list:monthly').resolve({data:{sellers:[],buyers:[]}});await first;
 const collection=h.api.openCertificates();const duplicate=h.api.openCertificates();await tick();assert.equal(h.calls.filter(c=>c.action==='collection').length,1);
 h.responses.get('collection:').resolve({data:{certificates:[{certificateNumber:'OSHI-SAVED',purchasePrice:100,marketFee:5,sellerProceeds:97,patronFundSubsidy:2,sellerName:'Saved seller',issuedAt:Date.now()}]}});await Promise.all([collection,duplicate]);
 for(const text of ['OSHI-SAVED','100 Pay','5 Pay','97 Pay','2 Pay','Saved seller'])assert.ok(h.app.innerHTML.includes(text),text);
 assert.deepEqual(h.calls.map(c=>c.action),['list','collection']);
});

test('wallet product labels do not depend on loading the battle UI, including the retired premium purchase', async () => {
 const source=read('shop-products.mjs');const catalog={AI_TEXT_TRAINING_STYLE_PRODUCTS:[],STAMP_PRODUCTS:[],PLAYER_TITLE_PRODUCTS:[],CHAT_COSMETIC_PRODUCTS:[],RANCH_DECORATION_PRODUCTS:[]};
 vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+';this.label=getShopProductLabel;',catalog);
 assert.equal(catalog.label('reaction_color'),'色づかいが好き！');assert.match(catalog.label('feature_top_message'),/推しカード プレミアム仕上げ/);
 assert.match(read('account.js'),/getShopProductLabel\(details.productId\)/);assert.doesNotMatch(read('account.js'),/HariaiOnline\?\.getShopProductLabel/);
});
