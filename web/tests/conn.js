// Connection robustness: silent first channel, hanging adapter, cancel.
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const { JSDOM } = require('jsdom'); const fs = require('fs'); const { spawn } = require('child_process');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
function makeDom(device) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.github.io/scanner/',
    beforeParse(w) { w.TextEncoder = require('util').TextEncoder; w.URL.createObjectURL = () => 'blob:x'; Object.defineProperty(w.navigator, 'bluetooth', { value: { requestDevice: async () => device } }); w.performance.now = () => Date.now(); } });
  return dom;
}
function simChannel() {
  const sim = spawn(PY, ['-I', path.join(ROOT, 'web', 'sim_car.py'), 'tacoma2007', '--elm', '1.4b']);
  let notify = null, buf = '';
  sim.stdout.on('data', (d) => { const s = d.toString('latin1'); const dv = new DataView(new Uint8Array([...s].map((c) => c.charCodeAt(0))).buffer); setTimeout(() => notify && notify({ target: { value: dv } }), 2); });
  const rx = { properties: { notify: true }, startNotifications: async () => {}, stopNotifications: async () => {}, addEventListener: (e, f) => { notify = f; }, removeEventListener() { notify = null; } };
  const tx = { properties: { write: true }, writeValueWithResponse: async (b) => { buf += Buffer.from(b).toString('latin1'); let i; while ((i = buf.indexOf('\r')) >= 0) { sim.stdin.write(buf.slice(0, i) + '\n'); buf = buf.slice(i + 1); } } };
  return { sim, rx, tx };
}
let silentWrites = 0;
const silent = () => ({ rx: { properties: { notify: true }, startNotifications: async () => {}, stopNotifications: async () => {}, addEventListener() {}, removeEventListener() {} }, tx: { properties: { writeWithoutResponse: true }, writeValueWithoutResponse: async () => { silentWrites++; } } });
const alertText = (d) => d.querySelector('#alertscrim').classList.contains('on') ? d.querySelector('#al-t').textContent + ': ' + d.querySelector('#al-m').textContent : '';
(async () => {
  // A: first (preferred) channel is silent, the real one is on FFE0
  {
    const ch = simChannel(), s = silent();
    const dev = { name: 'V011', addEventListener() {}, gatt: { connected: true, disconnect() {}, connect: async () => ({ getPrimaryServices: async () => [
      { uuid: '0000ffe0-0000-1000-8000-00805f9b34fb', getCharacteristics: async () => [ch.rx, ch.tx] },
      { uuid: '0000fff0-0000-1000-8000-00805f9b34fb', getCharacteristics: async () => [s.rx, s.tx] }] }) } };
    const dom = makeDom(dev), d = dom.window.document; await sleep(300);
    d.querySelector('[data-act="connect"]').click();
    let saw = false;
    for (let i = 0; i < 300 && !/RPM/.test(d.querySelector('#carcard').textContent); i++) { await sleep(100); if (/another channel/.test(d.querySelector('#carcard').textContent)) saw = true; }
    ok(silentWrites > 0, 'A: tried the preferred (silent) channel first'); ok(/RPM/.test(d.querySelector('#carcard').textContent), 'A: connected on second channel');
    console.log('  A alert:', alertText(d).slice(0, 80)); ch.sim.kill(); 
  }
  // B: adapter busy (GATT connect never finishes) -> clear message, not endless spinner
  {
    const dev = { name: 'V011', addEventListener() {}, gatt: { connected: false, disconnect() {}, connect: () => new Promise(() => {}) } };
    const dom = makeDom(dev), d = dom.window.document; await sleep(300);
    d.querySelector('[data-act="connect"]').click(); await sleep(300);
    ok(/Cancel/.test(d.querySelector('#carcard').textContent), 'B: cancel button while connecting');
    await sleep(15500);
    const t = alertText(d); console.log('  B alert:', t.slice(0, 140));
    ok(/Car Scanner/.test(t), 'B: busy message after timeout'); ok(d.querySelector('[data-act="connect"]'), 'B: back to Connect');
    
  }
  // C: cancel while hanging
  {
    const dev = { name: 'V011', addEventListener() {}, gatt: { connected: false, disconnect() {}, connect: () => new Promise(() => {}) } };
    const dom = makeDom(dev), d = dom.window.document; await sleep(300);
    d.querySelector('[data-act="connect"]').click(); await sleep(300);
    d.querySelector('[data-act="cancelConnect"]').click(); await sleep(300);
    ok(d.querySelector('[data-act="connect"]') && !alertText(d), 'C: cancel returns to Connect with no error');
    await sleep(15500); ok(!alertText(d), 'C: no late error after cancel');
    
  }
  // D: all channels silent -> "didn't answer"
  {
    const s1 = silent(), s2 = silent();
    const dev = { name: 'V011', addEventListener() {}, gatt: { connected: true, disconnect() {}, connect: async () => ({ getPrimaryServices: async () => [
      { uuid: '0000fff0-0000-1000-8000-00805f9b34fb', getCharacteristics: async () => [s1.rx, s1.tx] }, { uuid: '0000ffe0-0000-1000-8000-00805f9b34fb', getCharacteristics: async () => [s2.rx, s2.tx] }] }) } };
    const dom = makeDom(dev), d = dom.window.document; await sleep(300);
    d.querySelector('[data-act="connect"]').click(); await sleep(11000);
    const t = alertText(d); console.log('  D alert:', t.slice(0, 160)); ok(/didn’t answer/.test(t), 'D: no-answer message');
    
  }
  {
    let asked = 0;
    const dev = { name: 'V011', addEventListener() {}, gatt: { connected: false, disconnect() {}, connect: () => new Promise(() => {}) } };
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.github.io/scanner/',
      beforeParse(w) { w.TextEncoder = require('util').TextEncoder; w.webkit = { messageHandlers: { ble: { postMessage() {} }, bluefy: { postMessage() {} } } };
        Object.defineProperty(w.navigator, 'bluetooth', { value: { requestDevice: async () => { asked++; return dev; } } }); } });
    const d = dom.window.document; await sleep(300);
    d.querySelector('[data-act="connect"]').click(); await sleep(400);
    ok(asked === 1, 'E: Bluefy shows its device list'); ok(/Choose your adapter|Connecting to V011/.test(d.querySelector('#carcard').textContent), 'E: web status, not native: ' + d.querySelector('#carcard .s').textContent);
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(0);
})();
