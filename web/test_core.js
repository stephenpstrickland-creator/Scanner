// Node test of core.js against sim_car.py
const { spawn } = require('child_process');
const fs = require('fs');
eval(fs.readFileSync(__dirname + '/db.js', 'utf8') + '\n' + fs.readFileSync(__dirname + '/core.js', 'utf8').replace(/if \(typeof module[\s\S]*$/, '') + '\nglobalThis.C={Elm,AllSystems,makeFromVIN,modelYear,modulesFor,dtcText,DB:VEHICLE_DB};');
class SimTransport {
  constructor(car, ver) { this.p = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-I', __dirname + '/sim_car.py', car, '--elm', ver]); this.buf = ''; this.w = null;
    this.p.stdout.on('data', (d) => { this.buf += d.toString('latin1'); const i = this.buf.indexOf('>'); if (this.w && i >= 0) { const w = this.w; this.w = null; const o = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); w(o); } }); }
  request(cmd) { return new Promise((res) => { this.w = res; this.p.stdin.write(cmd + '\n'); }); }
  close() { this.p.stdin.end(); }
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
(async () => {
  console.log('== Tacoma, ELM v1.4b');
  let t = new SimTransport('tacoma2007', '1.4b'), e = new C.Elm(t), A = new C.AllSystems(e);
  await e.connect();
  ok(e.vin === '5TETU62N37Z412345', 'vin ' + e.vin);
  const mk = C.makeFromVIN(e.vin); ok(mk === 'toyota', 'make'); ok(C.modelYear(e.vin) === 2007, 'year');
  ok(e.sup[0x0C] && e.sup[0x42] && e.sup[0x2F], 'support bitmaps');
  const rpm = await e.readPID(0x0C); ok(rpm === 700, 'rpm ' + rpm);
  const v = await e.readPID(0x42); ok(Math.abs(v - 14.088) < 0.01, 'volt ' + v);
  const st = await e.readDTCs(3); ok(st.join() === 'P0441,P0455,P0504', 'codes ' + st);
  const rd = await e.readiness(); ok(rd.mil && rd.count === 3 && rd.monitors.length === 8 && rd.monitors.filter((m) => !m.ready).map((m) => m.name).join() === 'EVAP system', 'readiness ' + JSON.stringify(rd));
  const ff = await e.freezeFrame(); ok(ff && ff.code === 'P0441' && ff.rpm === 1840 && ff.speed === 38 && Math.abs(ff.ltft1 - 4.69) < 0.01, 'ff ' + JSON.stringify(ff));
  const mis = await e.misfire(); ok(mis && mis.length === 6 && mis[2].cur === 5 && mis[2].avg === 6 && mis[4].cur === 1, 'misfire ' + JSON.stringify(mis));
  ok(C.dtcText('C1249', 'toyota').startsWith('Open in stop light'), 'dtc text');
  const mods = C.modulesFor('toyota'); const found = [];
  e.enhBegin();
  for (const m of mods) { const r = await A.scanModule(m); if (r.present) found.push(r); }
  console.log('  found:', found.map((r) => r.mod.name + '[' + r.dtcs.map((d) => d.code).join(' ') + ']').join(', '));
  const abs = found.find((r) => /ABS/.test(r.mod.name));
  ok(found.length === 4 && abs && abs.dtcs.length === 2 && abs.mod.warn, 'scan');
  const live = C.DB.toyota.live; const a = await A.readLive(live[1]); ok(a !== null && Math.abs(a * 9 / 5 + 32 - 175) < 0.5, 'atf ' + a);
  ok((await A.readLive(live[2])) === null, '2182 unsupported');
  const cl = await A.clear(abs.mod, abs.svc); ok(cl.ok, 'clear abs');
  const body = found.find((r) => /Body/.test(r.mod.name)); const cb = await A.clear(body.mod, body.svc); ok(!cb.ok && /Conditions/.test(cb.msg), 'body refusal');
  await e.enhEnd();
  ok((await e.readDTCs(3)).length === 3, 'obd after enhEnd');
  const chk = await A.adapterCheck('toyota'); console.log('  check:', chk.map((c) => (c.ok === true ? '✓' : c.ok === false ? '✗' : '–') + ' ' + c.name + ': ' + c.detail).join('\n         '));
  ok(chk.every((c) => c.ok !== false), 'adapter check all pass');
  ok((await e.readPID(0x0C)) === 700, 'live after check');
  t.close();

  console.log('== Tacoma, old clone ELM v1.3a');
  t = new SimTransport('tacoma2007', '1.3a'); e = new C.Elm(t); A = new C.AllSystems(e);
  await e.connect();
  const chk2 = await A.adapterCheck('toyota'); const cea = chk2.find((c) => c.name === 'Extended addressing');
  ok(cea && cea.ok === false, 'cea flagged'); ok(chk2.find((c) => c.name === 'ABS module test').ok, 'abs ok on 1.3a');
  ok((await e.readDTCs(3)).length === 3, 'obd after check on 1.3a');
  t.close();

  console.log('== Honda');
  t = new SimTransport('honda', '1.4b'); e = new C.Elm(t); A = new C.AllSystems(e);
  await e.connect(); ok(C.makeFromVIN(e.vin) === 'honda', 'honda');
  const vsa = C.modulesFor('honda').find((m) => /VSA/.test(m.name)); const r = await A.scanModule(vsa);
  ok(r.svc === 'uds' && r.dtcs.map((d) => d.code).join() === 'C1031-13,C0122' && C.AllSystems.tag('uds', r.dtcs[0].status) === 'Active', 'uds ' + JSON.stringify(r.dtcs));
  await e.enhEnd(); ok(e.curProto === 6, 'proto restored');
  t.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('CRASH', err); process.exit(2); });
