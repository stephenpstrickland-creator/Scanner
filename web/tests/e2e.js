// End-to-end: index.html in jsdom with a fake Web Bluetooth device backed by sim_car.py
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const { JSDOM } = require('jsdom'); const fs = require('fs'); const { spawn } = require('child_process');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const car = process.argv[2] || 'tacoma2007', ver = process.argv[3] || '1.4b', NATIVE = process.argv[4] === 'native';
const sim = spawn(PY, ['-I', path.join(ROOT, 'web', 'sim_car.py'), car, '--elm', ver]);
let gauges = [], notify = null, txbuf = '', log = [], shared = null, theme = null;
sim.stdout.on('data', (d) => { const s = d.toString('latin1'); for (let i = 0; i < s.length; i += 20) { const part = s.slice(i, i + 20); const dv = new DataView(new Uint8Array([...part].map((c) => c.charCodeAt(0))).buffer); setTimeout(() => { if (NATIVE) { dom.window.__nativeBle && dom.window.__nativeBle.onData(part); } else if (notify) notify({ target: { value: dv } }); }, 2); } });
const rx = { properties: { notify: true }, startNotifications: async () => {}, addEventListener: (ev, fn) => { notify = fn; } };
const tx = { properties: { write: true }, writeValueWithResponse: async (b) => { txbuf += Buffer.from(b).toString('latin1'); let i; while ((i = txbuf.indexOf('\r')) >= 0) { const c = txbuf.slice(0, i); txbuf = txbuf.slice(i + 1); log.push(c); sim.stdin.write(c + '\n'); } } };
const device = { name: 'V011', addEventListener() {}, gatt: { connected: true, connect: async () => ({ getPrimaryServices: async () => [{ getCharacteristics: async () => [rx, tx] }] }), disconnect() {} } };
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.github.io/scanner/',
  beforeParse(w) { if (NATIVE) { w.__scannerNative = true; w.webkit = { messageHandlers: { scannerApp: { postMessage: (m) => { if (m.op === 'connect') { setTimeout(() => w.__nativeBle.onStatus('Looking for adapters...'), 5); setTimeout(() => w.__nativeBle.onConnected('V011'), 30); } else if (m.op === 'write') { const c = m.data.replace(/\r$/, ''); log.push(c); sim.stdin.write(c + '\n'); } else if (m.op === 'share') { shared = m; } else if (m.op === 'theme') { theme = m.value; } else if (m.op === 'gauges') { gauges.push(m); } } } } }; } w.TextEncoder = require('util').TextEncoder; w.URL.createObjectURL = () => 'blob:x'; if (!NATIVE) Object.defineProperty(w.navigator, 'bluetooth', { value: { requestDevice: async () => device } }); w.performance.now = () => Date.now(); } });
const w = dom.window, d = w.document, errs = [];
w.addEventListener('error', (e) => errs.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => { const e = d.querySelector(sel); if (!e) throw new Error('missing ' + sel); e.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const txt = (sel) => (d.querySelector(sel) || {}).textContent;
const until = async (fn, ms = 15000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); } throw new Error('timeout waiting for ' + what); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
(async () => {
  click('[data-act="connect"]');
  try { await until(() => w.__scanner.S.mode === 'live', 20000, 'connect'); } catch (e) { console.log('mode', w.__scanner.S.mode, 'status', w.__scanner.S.status, 'log', log.slice(0,20), 'alert', txt('#al-m')); throw e; }
  await until(() => w.__scanner.S.codes && !w.__scanner.S.codesLoading, 20000, 'codes');
  ok(/2007 Toyota/.test(txt('#carcard')), 'vehicle name: ' + txt('#carcard b'));
  ok(txt('#t-codes') === '3 found', 'tile codes ' + txt('#t-codes'));
  await until(() => txt('#h-rpm') !== '—', 8000, 'home rpm');
  ok(txt('#h-rpm') === '700', 'rpm ' + txt('#h-rpm'));
  // test results load in the background after codes and show on the Readiness tile
  await until(() => w.__scanner.S.tests && !w.__scanner.S.testsLoading, 20000, 'background tests');
  ok(/7\/8 ready · 2 tests failed/.test(txt('#t-ready')), 'ready tile ' + txt('#t-ready'));
  // codes screen + sheet
  click('[data-go="codes"]'); await sleep(200);
  ok(d.querySelectorAll('#codesbody [data-act="openCode"]').length === 3, 'codes rows');
  click('[data-code="P0441"]'); await sleep(100);
  ok(/1,840/.test(txt('#sh-b')) && /Purge valve/.test(txt('#sh-b')), 'freeze frame sheet');
  ok(/Related test results/.test(txt('#sh-b')) && /Purge flow/.test(txt('#sh-b')) && /Fail/.test(txt('#sh-b')) && !/Leak test/.test(txt('#sh-b')), 'P0441 related test');
  click('#sh-b [data-act="openTests"]'); await sleep(400);
  ok(!d.querySelector('#sheet').classList.contains('on') && w.__scanner.S.stack.join() === 'home,codes,tests', 'related test opens tests ' + w.__scanner.S.stack);
  ok(txt('#tr-title') === 'EVAP system' && d.querySelectorAll('#testsbody .cap').length === 1 && /Show all/.test(txt('#testsbody')), 'filtered to EVAP');
  click('#testsbody [data-act="openTests"]'); await sleep(100);
  ok(txt('#tr-title') === 'Test Results' && d.querySelectorAll('#testsbody .cap').length > 4, 'show all');
  click('#v-tests [data-pop]'); await sleep(200);
  click('[data-code="P0455"]'); await sleep(100);
  ok(/Leak test \(0\.090"\)/.test(txt('#sh-b')) && !/Purge flow/.test(txt('#sh-b')), 'P0455 related test');
  click('#sheet [data-act="closeSheet"]'); click('#v-codes [data-pop]'); await sleep(100);
  // live gauges / list / graph
  click('[data-go="live"]'); await until(() => txt('#gv-rpm') === '700', 8000, 'gauge');
  click('[data-seg="live"] [data-val="list"]'); await until(() => txt('#lv-volt') === '14.1', 8000, 'list volt');
  click('[data-seg="live"] [data-val="graph"]'); await sleep(800); ok(d.querySelector('#gsvg path') !== null, 'graph drawn');
  click('#recbtn'); await sleep(700); click('#recbtn'); if (NATIVE) ok(shared && /time_s/.test(shared.data), 'native share');
  click('#v-live [data-pop]'); await sleep(100);
  // readiness
  click('[data-go="ready"]'); await until(() => /not ready/.test(txt('#readybody')), 10000, 'ready');
  ok(/EVAP system/.test(txt('#readybody')) && /7\/8/.test(txt('#readybody')), 'readiness ' + txt('.ringcard b'));
  // tap a monitor: EVAP -> its tests, Misfire -> misfire screen, Components -> not tappable
  ok(/2 failed/.test(txt('#readybody [data-mon="EVAP system"]')) && !d.querySelector('#readybody [data-mon="Components"]'), 'monitor rows');
  click('#readybody [data-mon="EVAP system"]'); await sleep(300);
  ok(txt('#tr-title') === 'EVAP system' && /Purge flow/.test(txt('#testsbody')) && !/O2 sensor/.test(txt('#testsbody')), 'EVAP monitor -> tests');
  click('#v-tests [data-pop]'); await sleep(200);
  click('#readybody [data-mon="Misfire"]'); await sleep(300);
  ok(w.__scanner.S.stack.join() === 'home,ready,misfire', 'misfire monitor -> misfire');
  click('#v-misfire [data-pop]'); await sleep(200);
  // all test results
  click('#readybody [data-act="openTests"]'); await until(() => /failed/.test(txt('#testsbody')), 15000, 'monitor tests');
  ok(/2 failed/.test(txt('#testsbody .ringcard')) && /Purge flow/.test(txt('#testsbody')) && /Not run/.test(txt('#testsbody')), 'tests summary');
  ok(d.querySelector('#testsbody .cap').textContent === 'EVAP system' && /gas cap/.test(txt('#testsbody .tip')), 'failed group first + tip');
  click('#v-tests [data-pop]'); await sleep(200);
  ok(/2 failed/.test(txt('#readybody [data-act="openTests"]')), 'readiness row chip');
  click('#v-ready [data-pop]'); await sleep(100);
  // misfire
  click('[data-go="misfire"]'); await until(() => d.querySelectorAll('#misbody .bar').length === 6, 10000, 'misfire');
  ok(/Cylinder 3/.test(txt('#misbody')), 'misfire tip');
  click('#v-misfire [data-pop]'); await sleep(100);
  // fuel
  click('[data-go="fuel"]'); await until(() => txt('#f-b1') !== '—', 8000, 'fuel');
  ok(txt('#f-b1') === '+5.5%', 'fuel b1 ' + txt('#f-b1')); click('#v-fuel [data-pop]'); await sleep(100);
  // all systems
  click('[data-go="systems"]'); await sleep(100);
  click('#sysbody [data-act="startScan"]');
  await until(() => w.__scanner.S.scan.state === 'done', 60000, 'scan');
  const names = [...d.querySelectorAll('#sysbody .row .grow')].map((e) => e.textContent);
  ok(names.length === 4 && names.some((n) => /ABS/.test(n)), 'scan rows ' + names);
  const absIdx = names.findIndex((n) => /ABS/.test(n));
  click('#sysbody [data-i="' + absIdx + '"]'); await sleep(300);
  ok(/C0200/.test(txt('#modbody')) && /brake light switch/.test(txt('#modbody')), 'abs module + tip');
  click('#modbody [data-act="clearModule"]'); await sleep(100);
  ok(/C1336/.test(txt('#al-m')), 'abs warning'); click('#al-ok');
  await until(() => /No codes stored/.test(txt('#modbody')), 15000, 'abs cleared');
  click('#v-module [data-pop]'); await sleep(200); click('#v-systems [data-pop]'); await sleep(200);
  // extra
  click('[data-go="extra"]'); await until(() => w.__scanner.S.extra.filter((x) => x.state === 2).length === 3 && w.__scanner.S.extra.filter((x) => x.state === 1).length === 2, 20000, 'extra');
  ok(/175/.test(txt('#xb0') + txt('#xb1')) && /160/.test(txt('#xb0') + txt('#xb1')), 'atf ' + txt('#xb0') + '/' + txt('#xb1'));
  click('#v-extra [data-pop]'); await sleep(400);
  await until(() => txt('#h-rpm') === '700', 8000, 'polling resumes after extra');
  // adapter check
  click('[data-act="settings"]'); await sleep(100); click('[data-act="check"]');
  await until(() => /Engine answers/.test(txt('#sh-b')), 20000, 'check');
  console.log('  check verdict:', txt('#sh-b .tip'));
  // clear engine codes
  click('#sheet [data-act="closeSheet"]'); click('[data-act="clearEngine"]'); await sleep(50); click('#al-ok');
  await until(() => w.__scanner.S.codes && w.__scanner.S.codes.stored.length === 0, 20000, 'engine clear');
  ok(txt('#t-codes') === 'No codes', 'cleared tile');
  console.log(`  commands sent: ${log.length}; errors: ${errs.length ? errs : 'none'}`);
  ok(!errs.length, 'no js errors');
  if (NATIVE) {
    const ups = gauges.filter((g) => g.action === 'update'), lastU = ups[ups.length - 1];
    console.log('  gauges:', ups.length, 'updates; last:', lastU && JSON.stringify(lastU.items.map((i) => i.label + '=' + i.value + i.unit)), '| alert:', lastU && lastU.alert, '| cfg fuel:', lastU && lastU.cfg.fuel, lastU && lastU.cfg.vehicle);
    ok(ups.length >= 2 && lastU.items.length === 4, 'gauges sent to app');
    ok(lastU && lastU.items.some((i) => i.label === 'Coolant' && i.value !== '—'), 'coolant gauge has a value');
    // phone locks: page must pause polling and hand off, then resume with trip totals
    const w = dom.window;
    Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => true });
    w.document.dispatchEvent(new w.Event('visibilitychange')); await new Promise((r) => setTimeout(r, 2800));
    const ho = gauges.find((g) => g.action === 'handoff'); ok(!!ho && ho.cfg.keys.length === 4, 'handoff on lock');
    const n0 = log.length; await new Promise((r) => setTimeout(r, 800)); ok(log.length === n0, 'page stops polling while locked (' + (log.length - n0) + ' cmds)');
    const m0 = w.__scanner.F.trip.miles;
    Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => false });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    w.__nativeBle.onResume(JSON.stringify({ miles: 2.5, gal: 0.12, secs: 300 })); await new Promise((r) => setTimeout(r, 900));
    ok(Math.abs(w.__scanner.F.trip.miles - m0 - 2.5) < 0.2, 'background miles added to trip');
    ok(log.length > n0, 'polling resumed');
    disconnectBtn: { const b = w.document.querySelector('[data-act="disconnect"]'); }
    w.__scanner.ACT.disconnect(); await new Promise((r) => setTimeout(r, 100));
    ok(gauges[gauges.length - 1].action === 'end', 'card ended on disconnect');
  }
  if (NATIVE) ok(theme === 'dark', 'theme posted'); console.log(`${car} ${ver}${NATIVE ? ' native' : ''}: ${pass} passed, ${fail} failed`);
  sim.stdin.end(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message, errs); process.exit(2); });
