// Tab bar, per-tab stacks, code lookup, swipe back, sheet drag, remembered tab (demo mode, no simulator needed)
const path = require('path'), fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };

function open(pre) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.github.io/s/',
    beforeParse(w) { Object.keys(pre || {}).forEach((k) => w.localStorage.setItem('scanner.' + k, pre[k])); } });
  const w = dom.window, d = w.document, errs = [];
  w.addEventListener('error', (e) => errs.push(e.message));
  const $ = (s) => d.querySelector(s);
  const click = (s) => { const el = typeof s === 'string' ? $(s) : s; el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const ptr = (type, el, x, y) => { const E = w.PointerEvent || w.MouseEvent; el.dispatchEvent(new E(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); };
  return { w, d, $, click, ptr, errs, X: () => w.__scanner };
}

(async () => {
  const t = open();
  const { $, click, ptr, d, X } = t;
  const active = () => [...d.querySelectorAll('.view.active')].map((v) => v.id);

  // first launch: Home tab
  ok(X().S.tab === 'home' && $('#tabbar [data-tab="home"]').classList.contains('on'), 'starts on Home tab');
  ok(d.querySelectorAll('#tabbar [data-tab]').length === 4, 'four tabs');
  ok(active().join() === 'v-home', 'only home view active');

  // Diagnose tab works offline: code lookup
  click('#tabbar [data-tab="diag"]'); await sleep(50);
  ok(X().S.tab === 'diag' && active().join() === 'v-diag', 'Diagnose tab opens');
  const q = $('#dtcq'); q.value = 'p0441'; q.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  ok(/P0441/.test($('#dtcres').textContent) && /purge/i.test($('#dtcres').textContent), 'lookup finds P0441');
  q.value = 'brake'; q.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  ok(/P0504/.test($('#dtcres').textContent), 'word search finds P0504');
  q.value = 'P1234'; q.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  ok(/P1234/.test($('#dtcres').textContent) && /Manufacturer/.test($('#dtcres').textContent), 'unknown valid code still offered');
  q.value = 'P0455'; q.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  click('#dtcres [data-act="lookupCode"]'); await sleep(50);
  ok($('#sheet').classList.contains('on') && $('#sh-t').textContent === 'P0455', 'lookup opens the code sheet offline');
  ok(d.body.classList.contains('sheeton'), 'tab bar hides while a sheet is open');

  // drag the sheet down to close it
  ptr('pointerdown', $('#sheet .grab'), 200, 100);
  ptr('pointermove', d, 200, 160); ptr('pointermove', d, 200, 700); ptr('pointerup', d, 200, 700);
  ok(!$('#sheet').classList.contains('on') && !d.body.classList.contains('sheeton'), 'dragging the sheet down closes it');
  await sleep(400);

  // Live tab offline shows the connect card; Log tab has its rows
  click('#tabbar [data-tab="live"]'); await sleep(50);
  ok(active().join() === 'v-livetab' && /Connect Adapter/.test($('#livetabbody').textContent), 'Live tab offline asks to connect');
  click('#tabbar [data-tab="log"]'); await sleep(50);
  ok(/Trips & MPG/.test($('#logbody').textContent) && /Past Drives/.test($('#logbody').textContent), 'Log tab rows');
  click('#logbody [data-mode="fills"]'); await sleep(50);
  ok(X().S.stacks.log.join() === 'log,mpg' && X().S.mpgMode === 'fills', 'Fill-Ups opens fuel on the Fill-Ups tab');
  ok($('#v-mpg .back span').textContent === 'Log', 'back button says Log');
  click('#tabbar [data-tab="log"]'); await sleep(50);
  ok(X().S.stacks.log.join() === 'log', 'tapping the open tab pops to its root');

  // connect the demo
  click('#tabbar [data-tab="home"]'); await sleep(50);
  X().ACT.demo(); await sleep(2500);
  ok(X().S.mode === 'demo', 'demo connected');
  const t0 = Date.now(); while (Date.now() - t0 < 8000 && !X().S.codes) await sleep(100);
  const n = X().S.codes ? X().S.codes.stored.length + X().S.codes.pending.length : 0;
  ok(n > 0 && $('#tb-badge').textContent === String(n) && $('#tb-badge').style.display === 'flex', 'Diagnose badge shows ' + n + ' codes');

  // each tab keeps its own stack
  click('#v-home [data-go="live"]'); await sleep(50);
  ok(X().S.stacks.home.join() === 'home,live', 'Home stack: home > live');
  click('#tabbar [data-tab="diag"]'); await sleep(50);
  click('#diagbody [data-go="codes"]'); await sleep(300);
  ok(X().S.stacks.diag.join() === 'diag,codes' && active().join() === 'v-codes', 'Diagnose stack: diag > codes');
  ok($('#v-codes .back span').textContent === 'Diagnose', 'codes back button says Diagnose');
  ok(/\d/.test($('#diagbody').textContent), 'Diagnose rows show status');
  click('#tabbar [data-tab="home"]'); await sleep(50);
  ok(active().join() === 'v-live' && X().S.stacks.diag.join() === 'diag,codes', 'switching tabs keeps both stacks');
  ok(d.querySelector('#v-home').classList.contains('behind'), 'home sits behind live');
  click('#tabbar [data-tab="diag"]'); await sleep(50);
  ok(active().join() === 'v-codes', 'back on Diagnose: codes still open');

  // swipe back from the left edge
  const cur = $('#v-codes');
  ptr('pointerdown', cur, 5, 300); ptr('pointermove', d, 40, 302); await sleep(150); ptr('pointermove', d, 60, 302); await sleep(150); ptr('pointerup', d, 60, 302);
  ok(X().S.stacks.diag.join() === 'diag,codes' && !cur.style.transform, 'short slow swipe springs back');
  await sleep(400);
  ptr('pointerdown', cur, 5, 300); ptr('pointermove', d, 300, 300); ptr('pointermove', d, 700, 300); ptr('pointerup', d, 700, 300);
  ok(X().S.stacks.diag.join() === 'diag' && active().join() === 'v-diag', 'swipe back pops');
  await sleep(400);
  ptr('pointerdown', $('#v-diag'), 5, 300); ptr('pointermove', d, 700, 300); ptr('pointerup', d, 700, 300);
  ok(X().S.stacks.diag.join() === 'diag', 'no swipe back on a tab root');

  // Live tab shows numbers while connected
  await sleep(400);
  click('#tabbar [data-tab="live"]'); await sleep(1500);
  ok(/\d/.test($('#lt-rpm .nvv').textContent) && /\d/.test($('#lt-volt .nvv').textContent), 'Live tab gauges update');
  ok(/B1 [+-]/.test($('#lt-trim').textContent), 'Live tab fuel trim row');
  click('#v-livetab .linkrow'); await sleep(100);
  ok(X().S.stacks.live.join() === 'livetab,live', 'All gauges opens Live Data');

  // remembered for next launch
  click('.seg[data-seg="live"] [data-val="list"]'); await sleep(50);
  ok(t.w.localStorage.getItem('scanner.tab') === 'live' && t.w.localStorage.getItem('scanner.seg.live') === 'list', 'tab and segment saved');
  ok(t.errs.length === 0, 'no page errors: ' + t.errs.join('; '));

  const t2 = open({ tab: 'log', 'seg.live': 'graph', 'seg.mpg': 'spend' });
  ok(t2.X().S.tab === 'log' && t2.d.querySelector('#v-log').classList.contains('active') && t2.d.querySelector('#tabbar [data-tab="log"]').classList.contains('on'), 'relaunch opens the last tab');
  ok(t2.X().S.liveMode === 'graph' && t2.d.querySelector('#p-graph').classList.contains('on') && t2.X().S.mpgMode === 'spend', 'relaunch restores segment choices');
  ok(t2.errs.length === 0, 'no page errors on relaunch');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH ' + e.stack); process.exit(1); });
