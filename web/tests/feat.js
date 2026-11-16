const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const { JSDOM } = require('jsdom'); const fs = require('fs');
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.github.io/s/',
  beforeParse(w) { w.fetch = async (u) => ({ json: async () => {
    if (/vpic/.test(u)) return { Results: [{ Make: 'TOYOTA', Model: 'Tacoma', ModelYear: '2007', BodyClass: 'Pickup', DisplacementL: '4', EngineCylinders: '6', DriveType: '4x2' }] };
    if (/SafetyRatings\/modelyear/.test(u)) return { Count: 1, Results: [{ VehicleId: 2172, VehicleDescription: '2007 Toyota Tacoma 4-DR.' }] };
    if (/SafetyRatings\/VehicleId/.test(u)) return { Count: 1, Results: [{ FrontCrashPicture: 'x' }] };
    if (/commons/.test(u)) return { query: { pages: {
      1: { title: 'File:2005-2008 Toyota Tacoma Double Cab front.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.jpg', width: 1600, height: 1000, extmetadata: { Artist: { value: '<a href="x">IFCAR</a>' }, LicenseShortName: { value: 'Public domain' } } }] },
      2: { title: 'File:2007 Toyota Tacoma interior.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/b.jpg', width: 1600, height: 1000, extmetadata: {} }] },
      3: { title: 'File:2016 Toyota Tacoma TRD.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c.jpg', width: 1600, height: 1000, extmetadata: {} }] },
      4: { title: 'File:2007 Toyota Tacoma PreRunner.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/d.jpg', width: 1600, height: 1100, extmetadata: { Artist: { value: 'Someone' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } };
    return {}; } }); } });
const w = dom.window, d = w.document, errs = []; w.addEventListener('error', (e) => errs.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (s) => { const e = d.querySelector(s); if (!e) throw new Error('missing ' + s); e.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
(async () => {
  click('[data-act="demo"]'); await sleep(900);
  ok(d.querySelector('#carcard .carphoto.arrive'), 'arrival animation photo');
  const imgs = w.__scanner.getVEH().photos.map((p) => p.url); console.log('  photos:', imgs, '| credit:', d.querySelector('#carcard .credit') && d.querySelector('#carcard .credit').textContent);
  ok(imgs.length === 2 && imgs.some((u) => u.endsWith('a.jpg')) && imgs.some((u) => u.endsWith('d.jpg')), 'photo filtering (interior + wrong generation dropped)');
  await sleep(300);
  ok(/2007 Toyota Tacoma/.test(d.querySelector('#carcard b').textContent), 'vin lookup name: ' + d.querySelector('#carcard b').textContent);
  ok(/4\.0L V6/.test(d.querySelector('#carcard .s').textContent), 'sub: ' + d.querySelector('#carcard .s').textContent);
  ok(w.__scanner.getVEH().body === 'truck', 'body truck');
  await sleep(30000);
  const t = w.__scanner.F.trip; console.log('  trip after 30s:', t.miles.toFixed(3), 'mi', t.gal.toFixed(4), 'gal', 'mpg', (t.miles / t.gal).toFixed(1), 'card', d.querySelector('#fc-mpg').textContent, '|', d.querySelector('#fc-sub').textContent);
  ok(t.miles > 0.01 && t.gal > 0.001, 'trip integrates');
  click('[data-go="mpg"]'); await sleep(400);
  ok(d.querySelector('#mpg-trip') && d.querySelector('#mpgsvg path'), 'mpg screen');
  console.log('  instant:', d.querySelector('#mpg-inst').textContent, d.querySelector('#mpg-instl').textContent);
  click('[data-seg="mpg"] [data-val="fills"]'); await sleep(100);
  const addFill = async (date, gal, ppg, odo) => { click('[data-act="addFill"]'); await sleep(50); d.querySelector('#ff-date').value = date; d.querySelector('#ff-gal').value = gal; d.querySelector('#ff-ppg').value = ppg; d.querySelector('#ff-odo').value = odo; click('[data-act="saveFill"]'); await sleep(50); };
  const now = new Date(), ym = (o) => { const x = new Date(now.getFullYear(), now.getMonth() - o, 10); return x.toISOString().slice(0, 10); };
  await addFill(ym(2), 15, 3.1, 100000); await addFill(ym(1), 16, 3.2, 100288); await addFill(ym(0), 15.5, 3.3, 100567);
  const chips = [...d.querySelectorAll('#mpgbody .chip')].map((c) => c.textContent); console.log('  fill mpg chips:', chips);
  ok(chips.includes('18.0 mpg') && chips.includes('18.0 mpg'), 'fill mpg calc');
  click('[data-seg="mpg"] [data-val="spend"]'); await sleep(100);
  console.log('  spend:', [...d.querySelectorAll('#mpgbody .stat')].map((s) => s.textContent).join(' | '));
  ok(/\$51\.15/.test(d.querySelector('#mpgbody').textContent), 'this month spend');
  click('#v-mpg [data-pop]'); await sleep(300);
  click('#carcard .hero'); await sleep(100); ok(/Your Vehicle/.test(d.querySelector('#sh-t').textContent), 'vehicle sheet');
  ok(d.querySelectorAll('.ptile').length === 3, 'picture tiles');
  click('.ptile[data-k="1"]'); await sleep(50); ok(d.querySelector('#carcard img').src.endsWith('d.jpg'), 'choose photo 2');
  click('.ptile[data-k="art"]'); await sleep(50); ok(d.querySelector('#carcard .carsvg'), 'choose illustration');
  click('[data-act="setPaint"][data-c="#C21F32"]'); await sleep(50); ok(w.__scanner.getVEH().paint === '#C21F32', 'paint');
  click('[data-seg="body"] [data-val="suv"]'); await sleep(50); ok(w.__scanner.getVEH().body === 'suv', 'body change');
  click('#sheet [data-act="closeSheet"]');
  console.log('errors:', errs.length ? errs : 'none'); ok(!errs.length, 'no errors');
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message, errs); process.exit(2); });
