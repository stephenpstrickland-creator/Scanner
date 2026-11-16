// Runs every test: node web/tests/run-all.js  (or: npm test)
const { spawnSync } = require('child_process');
const path = require('path');
const R = (...a) => path.join(__dirname, ...a);
const runs = [
  ['core (ELM/OBD logic vs simulator)', [R('..', 'test_core.js')]],
  ['end-to-end, Web Bluetooth (Bluefy)', [R('e2e.js'), 'tacoma2007', '1.4b']],
  ['end-to-end, iPhone app bridge + gauges', [R('e2e.js'), 'tacoma2007', '1.4b', 'native']],
  ['connection: timeouts, channel fallback, cancel, Bluefy detection', [R('conn.js')]],
  ['vehicle photos, fuel & MPG', [R('feat.js')]],
  ['demo mode, both themes', [R('demo.js')]],
];
let bad = 0;
for (const [name, args] of runs) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const last = (r.stdout || '').trim().split('\n').pop();
  const ok = r.status === 0 && !/FAIL|CRASH|[1-9]\d* failed/.test(out);
  if (!ok) bad++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + '  |  ' + last);
  if (!ok) console.log(out.split('\n').filter((l) => /FAIL|CRASH|Error/.test(l)).slice(0, 10).join('\n'));
}
process.exit(bad ? 1 : 0);
