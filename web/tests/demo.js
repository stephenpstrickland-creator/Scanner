const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const { JSDOM } = require('jsdom'); const fs = require('fs');
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.github.io/s/' });
const w = dom.window, d = w.document, errs = []; w.addEventListener('error', (e) => errs.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (s) => d.querySelector(s).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
(async () => {
  console.log('no-bluetooth note:', d.querySelector('.foot').textContent.slice(0, 40));
  click('[data-go="live"]'); await sleep(50); console.log('alert when off:', d.querySelector('#al-t').textContent); click('#al-no');
  await sleep(1500); console.log('mode', w.__scanner.S.mode, '| car:', d.querySelector('#carcard b').textContent);
  for (const v of ['codes', 'live', 'ready', 'misfire', 'fuel', 'extra', 'systems', 'health', 'alerts']) { click('[data-go="' + v + '"]'); await sleep(1600); click('#v-' + v + ' [data-pop]'); await sleep(500); }
  click('[data-go="ready"]'); await sleep(1200); click('#readybody [data-act="openTests"]'); await sleep(1500);
  console.log('monitor tests summary:', d.querySelector('#testsbody .ringcard b').textContent.replace('failed', 'not passing')); click('#v-tests [data-pop]'); await sleep(400); click('#v-ready [data-pop]'); await sleep(400);
  click('[data-go="systems"]'); await sleep(100); click('#sysbody [data-act="startScan"]'); await sleep(5000);
  console.log('scan:', w.__scanner.S.scan.state, w.__scanner.S.scan.results.length, '| tiles:', ['#t-codes', '#t-live', '#t-ready', '#t-sys', '#t-mis', '#t-fuel', '#t-extra'].map((s) => d.querySelector(s).textContent).join(' | '));
  // demo has a small vacuum leak on bank 1 at idle: Drive Health should catch it
  const t0 = Date.now(); while (Date.now() - t0 < 60000 && !(w.__scanner.HL.d && w.__scanner.HL.d.found.vacuum1)) await sleep(250);
  click('[data-go="health"]'); await sleep(300);
  console.log('health card:', d.querySelector('#hc-sub').textContent, '| findings:', w.__scanner.HL.d.list().map((f) => f.id).join(' '));
  if (!/Running lean at idle \(bank 1\)/.test(d.querySelector('#healthbody').textContent)) errs.push('demo health finding missing');
  click('#v-health [data-pop]'); await sleep(300);
  click('[data-act="settings"]'); await sleep(50); click('[data-seg="theme"] [data-val="light"]'); click('[data-seg="temp"] [data-val="C"]');
  console.log('theme', d.documentElement.dataset.theme, 'errors:', errs.length ? errs : 'none'); process.exit(0);
})();
