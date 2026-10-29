const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');
const root = path.resolve(__dirname,'../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('Auth retains the existing persistence search order without starting popup infrastructure', () => {
  const calls=[];
  const app={},idb={},local={},session={};
  const context={URLSearchParams,location:{hostname:'hariaistadium.com',search:''},firebaseApp:app,
    indexedDBLocalPersistence:idb,browserLocalPersistence:local,browserSessionPersistence:session,database:{},
    initializeAuth:(a,deps)=>{calls.push([a,deps]);return {};},getFirestore:()=>({}),getFunctions:()=>({}),
    connectAuthEmulator:()=>{throw Error('production emulator');},connectFirestoreEmulator(){},connectFunctionsEmulator(){}};
  vm.runInNewContext(read('firebase-services.js').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{ database \};\r?\n/gm,'').replace(/^export /gm,''),context);
  assert.equal(calls.length,1);assert.equal(calls[0][0],app);
  assert.deepEqual([...calls[0][1].persistence],[idb,local,session]);
  assert.equal(calls[0][1].popupRedirectResolver,undefined);
});

test('the pinned browser SDK has verifiable fingerprints and preserves every named imported API', async () => {
  const manifest=JSON.parse(read('assets/firebase/manifest.json'));
  assert.equal(manifest.version,'12.16.0');
  let bytes=0;
  for(const item of manifest.files){
    const data=fs.readFileSync(path.join(root,item.file));
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.sha256,item.file);
    if(item.file.endsWith('.js'))bytes+=data.length;
  }
  assert.ok(bytes<800000,'SDK must not accidentally grow back to full CDN modules');
  for(const [name,file] of Object.entries(manifest.entries)){
    const module=await import(require('node:url').pathToFileURL(path.join(root,file)).href);
    for(const exported of manifest.exports[name])assert.ok(exported in module,`${name}.${exported}`);
  }
});

test('initial font requests are a small local subset; full fonts remain available on demand', () => {
  const html=read('index.html'),manifest=JSON.parse(html.match(/id="featureManifest">([\s\S]*?)<\/script>/)[1]);
  const font=JSON.parse(read('assets/fonts/landing-subset.json'));
  const data=fs.readFileSync(path.join(root,'assets/fonts',font.file));
  assert.equal(data.length,font.bytes);assert.ok(data.length<10000);
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'),font.sha256);
  assert.match(read('landing-font.css'),/font-display: optional/);
  assert.doesNotMatch(html,/<link\b[^>]*rel="stylesheet"[^>]*href="https:\/\/fonts\./);
  assert.ok(manifest.common.optionalStyles.includes('display-fonts'));
  assert.ok(manifest.strategy.optionalStyles.includes('memo-fonts'));
  assert.ok(manifest.roulette.optionalStyles.includes('memo-fonts'));
  assert.ok(!manifest['ranch-common'].styles.some(name=>name.includes('fonts')));
  assert.match(read('tribute.js'),/HariaiFeatures\?\.load\("display-fonts"\)/);
  for(const character of '貼って、刺して、点で返す。いますぐ貼り合う')assert.ok(font.characters.includes(character));
});
