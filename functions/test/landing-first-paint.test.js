const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const acorn = require('acorn');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const body = acorn.parse(source, { ecmaVersion: 'latest' }).body[0].expression.callee.body.body;
const scheduler = body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'scheduleLandingPresence');

function harness({ idle = true, ready = 'loading', visible = true, landing = true } = {}) {
  const events = new Map(), frames = [], timers = [], idleTasks = [], loads = [];
  const state = { landing };
  const listen = (name, callback) => events.set(name, callback);
  const document = { readyState: ready, visibilityState: visible ? 'visible' : 'hidden', addEventListener: listen };
  const window = { addEventListener: listen, requestAnimationFrame: callback => frames.push(callback),
    HariaiFeatures: { load: name => { loads.push(name); return Promise.resolve(); } } };
  if (idle) window.requestIdleCallback = callback => idleTasks.push(callback);
  vm.runInNewContext(source.slice(scheduler.start, scheduler.end) + '; scheduleLandingPresence();', {
    window, document, app: { querySelector: () => state.landing ? {} : null },
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  return { state, document, events, frames, timers, idleTasks, loads,
    paint() { frames.shift()(); frames.shift()(); },
    finish() { timers.shift().callback(); if (idleTasks.length) idleTasks.shift()(); } };
}

test('presence imports only after load, a painted frame, the quiet period and idle', () => {
  const h = harness();
  assert.equal(h.frames.length, 0);
  h.document.readyState = 'complete'; h.events.get('load')();
  assert.deepEqual(h.loads, []);
  h.frames.shift()(); assert.equal(h.timers.length, 0);
  h.frames.shift()(); assert.ok(h.timers[0].delay >= 1000);
  h.timers.shift().callback(); assert.deepEqual(h.loads, []);
  h.idleTasks.shift()(); assert.deepEqual(h.loads, ['presence']);
  h.events.get('hariai-landing-rendered')(); h.events.get('visibilitychange')();
  assert.equal(h.frames.length, 0, 'returning home does not import a second time');
});

test('leaving the landing cancels pending counts and returning home reschedules once', () => {
  const h = harness({ ready: 'complete' });
  h.events.get('hariai-landing-rendered')(); assert.equal(h.frames.length, 1);
  h.paint(); h.state.landing = false; h.finish(); assert.deepEqual(h.loads, []);
  h.state.landing = true; h.events.get('hariai-landing-rendered')();
  h.paint(); h.finish(); assert.deepEqual(h.loads, ['presence']);
});

test('background tabs wait until visible; browsers without idle callbacks still load counts', () => {
  const h = harness({ idle: false, ready: 'complete', visible: false });
  assert.equal(h.frames.length, 0);
  h.document.visibilityState = 'visible'; h.events.get('visibilitychange')();
  h.paint(); h.document.visibilityState = 'hidden'; h.finish();
  assert.deepEqual(h.loads, []);
  h.document.visibilityState = 'visible'; h.events.get('visibilitychange')();
  h.paint(); h.finish(); assert.deepEqual(h.loads, ['presence']);
});

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bootstrap = html.match(/<script data-domain-bootstrap>([\s\S]*?)<\/script>/)[1];
test('the head chooses the host before either banner is rendered, including blocked storage', () => {
  for (const [host, kind] of [['hariaistadium.com', 'primary'], ['gazostadium.web.app', 'legacy'],
    ['gazostadium.firebaseapp.com', 'legacy'], ['gazostadium.anjugames.workers.dev', 'legacy'], ['localhost', 'hidden']]) {
    const dataset = {};
    vm.runInNewContext(bootstrap, { location: { hostname: host }, document: { documentElement: { dataset } },
      sessionStorage: { getItem() { throw new Error('blocked'); } } });
    assert.equal(dataset.domainHost, kind);
  }
});

for (const kind of ['primary', 'legacy']) {
  test(`${kind} banner keeps its static text, preserves dismissal and opens the existing wallet`, () => {
    const events = new Map(), saved = [], walletEvents = new Map(); let closed = false, opened = false;
    const wallet = { disabled: true, addEventListener: (name, callback) => walletEvents.set(name, callback) };
    const bar = { setAttribute() {}, set innerHTML(_) { throw new Error('must not replace painted text'); },
      remove() { closed = true; }, querySelector: selector => selector === '[data-domain-wallet]' ? wallet
        : { addEventListener: (name, callback) => events.set(name, callback) } };
    const window = { addEventListener: (name, callback) => events.set(name, callback) };
    const dataset = { domainHost: kind };
    const storage = { getItem: () => null, setItem: (...args) => saved.push(args) };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'domain-move.js'), 'utf8'), {
      window, document: { documentElement: { dataset }, getElementById: () => bar }, sessionStorage: storage });
    assert.equal(wallet.disabled, true);
    window.HariaiApp = { openAccount() { opened = true; } };
    events.get('hariai-app-ready')(); assert.equal(wallet.disabled, false);
    walletEvents.get('click')(); assert.equal(opened, true);
    events.get('click')(); assert.equal(closed, true);
    assert.deepEqual(saved, [[kind === 'primary' ? 'hariai-domain-returning-closed-v1' : 'hariai-domain-move-closed-v2', '1']]);
    const after = {};
    vm.runInNewContext(bootstrap, { location: { hostname: kind === 'primary' ? 'hariaistadium.com' : 'gazostadium.web.app' },
      document: { documentElement: { dataset: after } }, sessionStorage: { getItem: key => key === saved[0][0] ? '1' : null } });
    assert.equal(after.domainNotice, 'hidden');
  });
}
