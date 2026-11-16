// Drive Health logic against synthetic drives: each fault must be caught, a healthy drive must stay quiet.
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'health.js'), 'utf8') + '\nglobalThis.DH = DriveHealth;');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// Seeded noise so runs are repeatable
let seed = 1;
const rnd = (a) => { seed = (seed * 16807) % 2147483647; return ((seed / 2147483647) * 2 - 1) * a; };

// A 25-minute drive: 2 min idle warm-up, then 4 x (20 s accelerate, 4 min cruise, 20 s slow down, 1 min idle).
// The app polls rpm + speed every second and rotates through the other readings, so we do the same.
function drive(fault = {}, opt = {}) {
  seed = 7;
  const h = new DH(Object.assign({ temp: (c) => Math.round(c) + '°C' }, opt));
  const rot = ['cool', 'volt', 'stft1', 'ltft1', 'stft2', 'ltft2', 'o2b', 'timing', 'load'];
  const phase = (s) => {
    if (s < 120) return 'idle';
    const c = (s - 120) % 360;
    return c < 20 ? 'accel' : c < 260 ? 'cruise' : c < 280 ? 'decel' : 'idle';
  };
  if (fault.restVolt) { h.feed(0, 'rpm', 0); h.feed(0, 'volt', fault.restVolt); }
  const mins = fault.mins || 25;
  for (let s = 1, i = 0; s <= mins * 60; s++) {
    const t = s * 1000, ph = phase(s);
    const speed = ph === 'idle' ? 0 : ph === 'cruise' ? 80 + rnd(3) : 40;
    const idleRpm = 700 + (fault.roughIdle ? rnd(120) : rnd(8));
    const rpm = ph === 'idle' ? idleRpm : ph === 'accel' ? 2600 : ph === 'cruise' ? 1900 + rnd(30) : 1200;
    const load = ph === 'idle' ? 20 : ph === 'accel' ? 65 : ph === 'cruise' ? 35 + rnd(3) : 12;
    let cool = Math.min(fault.coolMax || 90, 30 + s / 6);
    if (fault.overheat && s > 600) cool = Math.min(113, 90 + (s - 600) / 10);
    const trim = (b) => (fault.trim ? fault.trim(b, ph) : 0);
    const val = {
      rpm, speed, load, cool,
      volt: fault.volt || 14.2 + rnd(0.05),
      stft1: trim(1) + rnd(2), ltft1: 1, stft2: trim(2) + rnd(2), ltft2: 1,
      o2b: fault.cat ? (s % 2 ? 0.1 : 0.8) + rnd(0.05) : 0.7 + rnd(0.03),
      timing: ph === 'idle' ? 10 : ph === 'accel' ? (fault.knock ? -2 : 15) : 30,
    };
    h.feed(t, 'rpm', val.rpm); h.feed(t, 'speed', val.speed);
    for (let j = 0; j < 2; j++) { const k = rot[i++ % rot.length]; h.feed(t, k, val[k]); }
    if (s === 180) { h.setPending([]); h.setMisfire([1, 2, 3, 4, 5, 6].map((c) => ({ cyl: c, cur: 0 }))); }
    if (s === 900 && fault.pending) h.setPending(fault.pending);
    if (s === 900 && fault.misfire) h.setMisfire([1, 2, 3, 4, 5, 6].map((c) => ({ cyl: c, cur: c === fault.misfire ? 40 : 1 })));
  }
  return h;
}
const ids = (h) => h.list().map((f) => f.id).sort().join(',');

console.log('== healthy drive stays quiet');
let h = drive();
ok(ids(h) === '', 'healthy findings: ' + ids(h));
const ch = h.checks(), byId = (id) => ch.find((c) => c.id === id);
ok(['cool', 'warmup', 'charge', 'trims', 'banks', 'cat', 'knock', 'idle', 'misfire', 'codes'].every((id) => byId(id) && byId(id).state === 'ok'), 'all checks ok: ' + JSON.stringify(ch.filter((c) => c.state !== 'ok')));
ok(byId('battery').state === 'wait', 'battery waits without a resting reading');
const sm = h.summary(); ok(sm.secs >= 1495 && sm.runMin > 20 && sm.stats.coolMax === 90 && sm.stats.trimIdle1 !== null && sm.findings.length === 0, 'summary ' + JSON.stringify(sm.stats));

console.log('== faults');
h = drive({ trim: (b, ph) => (b === 1 ? (ph === 'idle' ? 13 : 3) : 0) });
ok(h.found.vacuum1 && h.found.banks && !h.found.vacuum2 && !h.found.leanall1, 'vacuum leak bank 1: ' + ids(h));
ok(/vacuum leak/.test(h.found.vacuum1.detail) && /bank 1 is at \+1[34]%/.test(h.found.banks.detail), 'vacuum wording');

h = drive({ trim: (b, ph) => (ph === 'idle' ? 12 : 11) });
ok(h.found.leanall1 && h.found.leanall2 && !h.found.vacuum1 && !h.found.banks, 'lean everywhere: ' + ids(h));

h = drive({ trim: (b, ph) => (ph === 'cruise' ? 12 : 1) });
ok(h.found.leanload1 && !h.found.vacuum1, 'lean under load: ' + ids(h));

h = drive({ trim: () => -13 });
ok(h.found.rich1 && h.found.rich2, 'rich: ' + ids(h));

h = drive({ trim: () => 7.5 });
ok(h.found.trimhigh1 && h.found.trimhigh1.level === 'watch' && h.list().every((f) => f.level === 'watch'), 'trim a little high: ' + ids(h));

h = drive({ coolMax: 62 });
ok(h.found.thermostat && /P0128/.test(h.found.thermostat.detail) && ids(h) === 'thermostat', 'thermostat: ' + ids(h));
h = drive({ coolMax: 62, mins: 8 });
ok(!h.found.thermostat, 'thermostat waits for 10 minutes');

h = drive({ overheat: true });
ok(h.found.overheat && h.found.overheat.level === 'urgent', 'overheat: ' + ids(h));
ok(h.events.some((e) => e.id === 'overheat') && h.drain().length >= 1 && h.drain().length === 0, 'events drain once');

h = drive({ volt: 12.2 });
ok(h.found.nocharge && h.found.nocharge.level === 'urgent' && h.worst().id === 'nocharge', 'not charging: ' + ids(h));
h = drive({ volt: 12.85 });
ok(h.found.lowcharge && !h.found.nocharge, 'low charging: ' + ids(h));
h = drive({ volt: 15.4 });
ok(h.found.overcharge, 'overcharging: ' + ids(h));

h = drive({ restVolt: 11.9 });
ok(h.found.battery && h.found.battery.level === 'watch', 'battery low at rest: ' + ids(h));
h = drive({ restVolt: 12.6 });
ok(!h.found.battery && h.checks().find((c) => c.id === 'battery').state === 'ok', 'battery fine at rest');

h = drive({ cat: true });
ok(h.found.cat && ids(h) === 'cat', 'catalyst: ' + ids(h));

h = drive({ knock: true });
ok(h.found.knock && ids(h) === 'knock', 'knock: ' + ids(h));

h = drive({ roughIdle: true });
ok(h.found.roughidle && ids(h) === 'roughidle', 'rough idle: ' + ids(h));

h = drive({ misfire: 3 });
ok(h.found.misfire && /Cylinder 3/.test(h.found.misfire.title), 'misfire: ' + ids(h));

h = drive({ pending: ['P0171'] }, { describe: (c) => c === 'P0171' ? 'System too lean (bank 1)' : c });
ok(h.found.pending_P0171 && /too lean/.test(h.found.pending_P0171.detail), 'new pending code: ' + ids(h));

console.log('== unsupported readings are hidden, not failed');
h = drive({}, { has: (k) => !['stft2', 'o2b', 'misfire'].includes(k) });
ok(!h.checks().some((c) => ['banks', 'cat', 'misfire'].includes(c.id)), 'hidden checks');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
